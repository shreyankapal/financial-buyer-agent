import { profileTarget } from "./profile-target.js";
import { generateBuyerQueries } from "./generate-search-queries.js";
import { webSearch } from "./web-search.js";
import { extractFacts } from "./extract-facts.js";
import { dedupeBuyers } from "./dedupe.js";
import { fitMatch } from "./fit-match.js";
import { scoreConfidence } from "./score-confidence.js";
import { shouldContinueResearch } from "./research-loop.js";
import { enrichInvestmentCriteria } from "./enrich-criteria.js";
import { findRelevantPortfolio } from "./relevant-portfolio.js";
import { generateRationale } from "./generate-rationale.js";

const FIT_SCORE_ORDER = { Strong: 0, Moderate: 1, Weak: 2 };
const CONFIDENCE_ORDER = { High: 0, Medium: 1, Low: 2 };
const HARD_URL_CEILING = 60;   // auto-broadening safety net inside runPipeline only
const WIDEN_URL_CEILING = 500; // sanity guard for explicit user-approved widen actions

async function withConcurrency(items, limit, fn) {
  const results = new Array(items.length);
  let index = 0;

  async function worker() {
    while (index < items.length) {
      const i = index++;
      results[i] = await fn(items[i]);
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, worker)
  );
  return results;
}

function sortBuyers(buyers) {
  return [...buyers].sort((a, b) => {
    const fitDiff =
      (FIT_SCORE_ORDER[a.fit.fitScore] ?? 3) -
      (FIT_SCORE_ORDER[b.fit.fitScore] ?? 3);
    if (fitDiff !== 0) return fitDiff;
    return (
      (CONFIDENCE_ORDER[a.confidence.confidence] ?? 3) -
      (CONFIDENCE_ORDER[b.confidence.confidence] ?? 3)
    );
  });
}

function computeMarketSignal(buyers, urlsFound, maxUrls) {
  const yieldRate = urlsFound > 0 ? buyers.length / urlsFound : 0;
  const atUrlCap = urlsFound >= maxUrls * 0.9;
  const isLowYield = yieldRate < 0.2 && atUrlCap;
  const marketSignal = isLowYield
    ? "possibly niche — consider a wider run"
    : "normal";

  if (isLowYield) {
    console.log(
      `\nLow yield rate (${Math.round(yieldRate * 100)}%) at the current URL cap — ` +
      `this may be a niche market where relevant buyers exist beyond what was fetched. ` +
      `Consider re-running with a higher maxUrls if you want a more complete picture.`
    );
  }

  return { yieldRatePct: Math.round(yieldRate * 100), marketSignal };
}

async function runEnrichmentPasses(profile, buyers) {
  // Investment criteria enrichment
  const toEnrich = buyers.filter(
    (b) =>
      (b.fit.fitScore === "Strong" || b.fit.fitScore === "Moderate") &&
      b.investmentCriteria === "NOT FOUND"
  );

  if (toEnrich.length > 0) {
    console.log(`\nEnriching investment criteria for ${toEnrich.length} buyers (3 at a time)...`);
    const enriched = await withConcurrency(toEnrich, 3, enrichInvestmentCriteria);

    let enrichedCount = 0;
    for (let i = 0; i < enriched.length; i++) {
      if (enriched[i].investmentCriteria !== "NOT FOUND") {
        enrichedCount++;
        const idx = buyers.indexOf(toEnrich[i]);
        buyers[idx] = { ...enriched[i], confidence: scoreConfidence(enriched[i]) };
      }
    }

    if (enrichedCount > 0) buyers = sortBuyers(buyers);
    console.log(`Enriched ${enrichedCount} of ${toEnrich.length} buyers with investment criteria`);
  }

  // Relevant portfolio pass
  console.log(`\nFinding relevant portfolio companies for ${buyers.length} buyers (3 at a time)...`);
  const portfolioResults = await withConcurrency(
    buyers, 3, (b) => findRelevantPortfolio(profile, b)
  );
  let portfolioKeywordCount = 0;
  let portfolioLlmCount = 0;
  buyers = buyers.map((b, i) => {
    const rp = portfolioResults[i];
    if (rp.method === "keyword") portfolioKeywordCount++;
    if (rp.method === "llm") portfolioLlmCount++;
    return { ...b, relevantPortfolio: rp };
  });
  console.log(
    `Portfolio matching: ${portfolioKeywordCount} via keyword, ${portfolioLlmCount} via LLM`
  );

  // Upgrade Weak → Moderate when keyword pass found relevant portfolio companies.
  // Never upgrade to Strong — a portfolio match alone isn't enough for the top tier.
  let upgradedCount = 0;
  buyers = buyers.map((b) => {
    if (
      b.fit?.fitScore === "Weak" &&
      b.relevantPortfolio?.method === "keyword" &&
      (b.relevantPortfolio?.relevantCompanies ?? []).length > 0
    ) {
      const matched = b.relevantPortfolio.relevantCompanies.join(", ");
      upgradedCount++;
      return {
        ...b,
        fit: {
          ...b.fit,
          fitScore: "Moderate",
          notes: `Upgraded from Weak: portfolio match found (${matched}). ${b.fit.notes ?? ""}`.trimEnd(),
        },
      };
    }
    return b;
  });
  if (upgradedCount > 0) {
    console.log(`Upgraded ${upgradedCount} buyer(s) Weak → Moderate via portfolio keyword match`);
    buyers = sortBuyers(buyers);
  }

  // Rationale pass
  console.log(`\nGenerating rationale for ${buyers.length} buyers (3 at a time)...`);
  const rationaleResults = await withConcurrency(
    buyers, 3, (b) => generateRationale(profile, b)
  );
  let rationaleLlmCount = 0;
  let rationaleDeterministicCount = 0;
  buyers = buyers.map((b, i) => {
    const r = rationaleResults[i];
    if (r.source === "llm") rationaleLlmCount++;
    else rationaleDeterministicCount++;
    return { ...b, rationale: r };
  });
  console.log(
    `Rationale: ${rationaleLlmCount} LLM-polished, ${rationaleDeterministicCount} deterministic`
  );

  return buyers;
}

export async function runPipeline(targetUrl, options = {}) {
  const {
    maxQueries = 3,
    maxUrls = 12,
    excludeDomains,
    targetCount = 35,
    maxRounds = 2,
  } = options;

  console.log(`\nProfiling target: ${targetUrl}`);
  const profileResult = await profileTarget(targetUrl);
  if (!profileResult.success) {
    return { success: false, error: profileResult.error };
  }
  const profile = profileResult.profile;
  console.log(`Profiled: ${profile.companyName} — ${profile.niche}`);
  if (profile.profileSource === "search_snippet_fallback") {
    console.log(`  (profile built from search snippets — direct page fetch failed)`);
  }

  const allQueries = await generateBuyerQueries(profile);
  console.log(`Generated ${allQueries.length} total queries`);

  const searchOpts = excludeDomains ? { excludeDomains } : {};

  let currentMaxQueries = maxQueries;
  let currentMaxUrls = maxUrls;
  let queriesUsedSoFar = 0;
  let allExtractions = [];
  let allFetchedUrls = new Set();
  let pendingCandidateUrls = [];
  let buyers = [];
  let currentRound = 0;
  let stopReason = "";
  let totalUrlsFailed = 0;

  while (true) {
    currentRound++;

    const usableCount = buyers.filter(
      (b) => b.fit.fitScore === "Strong" || b.fit.fitScore === "Moderate"
    ).length;
    console.log(
      `\nRound ${currentRound} of ${maxRounds} — currently ${usableCount} usable buyers, target is ${targetCount}`
    );

    const newQueries = allQueries.slice(queriesUsedSoFar, currentMaxQueries);
    console.log(
      `Searching with ${newQueries.length} new queries (queries ${queriesUsedSoFar + 1}–${currentMaxQueries} of ${allQueries.length})...`
    );

    const searchResults = await Promise.all(
      newQueries.map((q) => webSearch(q, searchOpts))
    );

    const newCandidateUrls = [
      ...new Set(
        searchResults.flat().map((r) => r.url).filter(Boolean)
      ),
    ].filter((url) => !allFetchedUrls.has(url));

    const remainingCapacity = currentMaxUrls - allFetchedUrls.size;
    const urlsToFetch = newCandidateUrls.slice(0, remainingCapacity);

    // Accumulate surplus candidates for potential widen
    const surplus = newCandidateUrls.slice(urlsToFetch.length);
    pendingCandidateUrls = [...new Set([...pendingCandidateUrls, ...surplus])];

    console.log(
      `Found ${newCandidateUrls.length} new candidate URLs, fetching ${urlsToFetch.length} (total cap: ${currentMaxUrls})`
    );

    if (urlsToFetch.length > 0) {
      console.log(`Extracting facts from ${urlsToFetch.length} pages (4 at a time)...`);
      const newExtractions = await withConcurrency(urlsToFetch, 4, extractFacts);
      urlsToFetch.forEach((url) => allFetchedUrls.add(url));

      const roundFailed = newExtractions.filter((e) => !e.success).length;
      if (roundFailed > 0) console.log(`  (${roundFailed} URLs failed to fetch or extract)`);
      totalUrlsFailed += roundFailed;
      allExtractions = [...allExtractions, ...newExtractions];
    }

    const deduped = dedupeBuyers(allExtractions);
    console.log(`Deduped to ${deduped.length} unique firms (combined across all rounds)`);

    buyers = sortBuyers(
      deduped.map((buyer) => ({
        ...buyer,
        fit: fitMatch(profile, buyer),
        confidence: scoreConfidence(buyer),
      }))
    );

    queriesUsedSoFar = currentMaxQueries;

    const decision = shouldContinueResearch({
      buyers: buyers.map((b) => ({
        fitScore: b.fit.fitScore,
        confidence: b.confidence.confidence,
      })),
      stats: {
        queriesRun: queriesUsedSoFar,
        totalQueriesAvailable: allQueries.length,
        urlsFound: allFetchedUrls.size,
        maxUrls: currentMaxUrls,
      },
      targetCount,
      currentRound,
      maxRounds,
    });

    if (!decision.continue) {
      stopReason = decision.reason;
      console.log(`\nStopping: ${stopReason}`);
      break;
    }

    console.log(`Continuing: ${decision.reason}`);
    currentMaxQueries = Math.min(decision.nextMaxQueries, allQueries.length);
    currentMaxUrls = Math.min(decision.nextMaxUrls, HARD_URL_CEILING);
  }

  buyers = await runEnrichmentPasses(profile, buyers);

  const urlsFound = allFetchedUrls.size;
  const strongCount = buyers.filter((b) => b.fit.fitScore === "Strong").length;
  const moderateCount = buyers.filter((b) => b.fit.fitScore === "Moderate").length;
  console.log(
    `\nDone. ${buyers.length} unique firms — ${strongCount} strong fit, ${moderateCount} moderate fit.`
  );

  const { yieldRatePct, marketSignal } = computeMarketSignal(buyers, urlsFound, currentMaxUrls);

  const stats = {
    queriesRun: queriesUsedSoFar,
    urlsFound,
    urlsFailed: totalUrlsFailed,
    firmsExtracted: allExtractions.filter((e) => e.success && e.facts?.isRelevant).length,
    uniqueFirms: buyers.length,
    roundsRun: currentRound,
    stopReason,
    yieldRatePct,
    marketSignal,
  };

  const _internalState = {
    profile,
    allQueries,
    queriesUsedSoFar,
    allFetchedUrls: [...allFetchedUrls],
    pendingCandidateUrls,
    allExtractions,
    currentMaxUrls,
    searchOpts,
    totalUrlsFailed,
    roundsRun: currentRound,
  };

  return { success: true, targetProfile: profile, buyers, stats, _internalState };
}

export async function widenPipeline(previousState, additionalUrlCount) {
  const {
    profile,
    allQueries,
    queriesUsedSoFar: prevQueriesUsed,
    allFetchedUrls: prevFetchedUrlsArr,
    pendingCandidateUrls: prevPendingUrls,
    allExtractions: prevExtractions,
    currentMaxUrls: prevMaxUrls,
    searchOpts,
    totalUrlsFailed: prevUrlsFailed,
    roundsRun: prevRoundsRun,
  } = previousState;

  const requestedAdditional = additionalUrlCount;
  const uncappedTarget = prevMaxUrls + additionalUrlCount;
  const newMaxUrls = Math.min(uncappedTarget, WIDEN_URL_CEILING);
  const actualAdditional = newMaxUrls - prevMaxUrls;

  if (newMaxUrls < uncappedTarget) {
    console.warn(
      `\nWARN: widen request for +${requestedAdditional} URLs (target ${uncappedTarget}) ` +
      `was capped by WIDEN_URL_CEILING (${WIDEN_URL_CEILING}). ` +
      `Actual additional: +${actualAdditional} URLs (new cap: ${newMaxUrls}).`
    );
  }

  const allFetchedUrls = new Set(prevFetchedUrlsArr);
  let allExtractions = [...prevExtractions];
  let queriesUsedSoFar = prevQueriesUsed;
  let totalUrlsFailed = prevUrlsFailed;

  // Filter out any URLs that were somehow fetched between state capture and now
  let pendingCandidateUrls = prevPendingUrls.filter(
    (url) => !allFetchedUrls.has(url)
  );

  const newSlots = newMaxUrls - allFetchedUrls.size;
  console.log(
    `\nWidening: ${prevMaxUrls} → ${newMaxUrls} URL cap (+${actualAdditional} new slots to fill)`
  );

  // Phase A: fetch from already-discovered surplus URLs first (no new Tavily calls)
  const fromPending = pendingCandidateUrls.slice(0, newSlots);
  pendingCandidateUrls = pendingCandidateUrls.slice(fromPending.length);

  if (fromPending.length > 0) {
    console.log(
      `Phase A: fetching ${fromPending.length} pending URLs from previous search results...`
    );
    const newExtractions = await withConcurrency(fromPending, 4, extractFacts);
    fromPending.forEach((url) => allFetchedUrls.add(url));
    const failed = newExtractions.filter((e) => !e.success).length;
    if (failed > 0) console.log(`  (${failed} URLs failed)`);
    totalUrlsFailed += failed;
    allExtractions = [...allExtractions, ...newExtractions];
  }

  // Phase B: if still have capacity, run up to 3 more unused queries
  const stillNeed = newMaxUrls - allFetchedUrls.size;
  if (stillNeed > 0 && queriesUsedSoFar < allQueries.length) {
    const nextQueryEnd = Math.min(queriesUsedSoFar + 3, allQueries.length);
    const moreQueries = allQueries.slice(queriesUsedSoFar, nextQueryEnd);
    console.log(
      `Phase B: running ${moreQueries.length} more queries ` +
      `(${queriesUsedSoFar + 1}–${nextQueryEnd} of ${allQueries.length})...`
    );

    const searchResults = await Promise.all(
      moreQueries.map((q) => webSearch(q, searchOpts))
    );
    const moreCandidates = [
      ...new Set(
        searchResults.flat().map((r) => r.url).filter(Boolean)
      ),
    ].filter((url) => !allFetchedUrls.has(url));

    const toFetch = moreCandidates.slice(0, stillNeed);
    pendingCandidateUrls = [
      ...new Set([
        ...pendingCandidateUrls,
        ...moreCandidates.slice(toFetch.length),
      ]),
    ];
    queriesUsedSoFar = nextQueryEnd;

    if (toFetch.length > 0) {
      console.log(`Fetching ${toFetch.length} new URLs from additional searches...`);
      const newExtractions = await withConcurrency(toFetch, 4, extractFacts);
      toFetch.forEach((url) => allFetchedUrls.add(url));
      const failed = newExtractions.filter((e) => !e.success).length;
      if (failed > 0) console.log(`  (${failed} URLs failed)`);
      totalUrlsFailed += failed;
      allExtractions = [...allExtractions, ...newExtractions];
    }
  }

  // Re-dedupe and re-score the full combined set
  const deduped = dedupeBuyers(allExtractions);
  console.log(`\nDeduped to ${deduped.length} unique firms (combined across all runs)`);

  let buyers = sortBuyers(
    deduped.map((buyer) => ({
      ...buyer,
      fit: fitMatch(profile, buyer),
      confidence: scoreConfidence(buyer),
    }))
  );

  buyers = await runEnrichmentPasses(profile, buyers);

  const urlsFound = allFetchedUrls.size;
  const strongCount = buyers.filter((b) => b.fit.fitScore === "Strong").length;
  const moderateCount = buyers.filter((b) => b.fit.fitScore === "Moderate").length;
  console.log(
    `\nDone. ${buyers.length} unique firms — ${strongCount} strong fit, ${moderateCount} moderate fit.`
  );

  const { yieldRatePct, marketSignal } = computeMarketSignal(buyers, urlsFound, newMaxUrls);

  const stats = {
    queriesRun: queriesUsedSoFar,
    urlsFound,
    urlsFailed: totalUrlsFailed,
    firmsExtracted: allExtractions.filter((e) => e.success && e.facts?.isRelevant).length,
    uniqueFirms: buyers.length,
    roundsRun: prevRoundsRun,
    stopReason: "widen complete",
    yieldRatePct,
    marketSignal,
    requestedAdditional,
    actualAdditional,
  };

  const _internalState = {
    profile,
    allQueries,
    queriesUsedSoFar,
    allFetchedUrls: [...allFetchedUrls],
    pendingCandidateUrls,
    allExtractions,
    currentMaxUrls: newMaxUrls,
    searchOpts,
    totalUrlsFailed,
    roundsRun: prevRoundsRun,
  };

  return { success: true, targetProfile: profile, buyers, stats, _internalState };
}

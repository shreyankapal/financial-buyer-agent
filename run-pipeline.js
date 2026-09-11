import { profileTarget } from "./profile-target.js";
import { generateBuyerQueries, generateDealAnnouncementQueries, isNearDuplicate, generateIndustryReportQueries, INDUSTRY_REPORT_DOMAINS, buildSectorTerms, isIndustryReportRelevant } from "./generate-search-queries.js";
import { webSearch, DEAL_PRESS_DOMAINS } from "./web-search.js";
import { fetchReport } from "./fetch-report.js";
import { extractReportBuyers } from "./extract-report-buyers.js";
import { extractFacts, extractFactsWithPage } from "./extract-facts.js";
import { dedupeBuyers, normalizeForMatch, isTargetCompany } from "./dedupe.js";
import { fitMatch } from "./fit-match.js";
import { scoreConfidence } from "./score-confidence.js";
import { shouldContinueResearch } from "./research-loop.js";
import { enrichInvestmentCriteria } from "./enrich-criteria.js";
import { findRelevantPortfolio } from "./relevant-portfolio.js";
import { generateRationale } from "./generate-rationale.js";
import { extractAcquirer, isAcquisitionRelevant } from "./extract-acquirer.js";
import { resolveAcquirerWebsite } from "./resolve-acquirer-website.js";
import { isOperatingCompanyName } from "./report-buyer-filter.js";

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

function computeMarketSignal(buyers, urlsFound, maxUrls, queriesRun, totalQueriesAvailable) {
  const yieldRate = urlsFound > 0 ? buyers.length / urlsFound : 0;
  const yieldRatePct = Math.round(yieldRate * 100);
  const atUrlCap = urlsFound >= maxUrls * 0.9;
  const queriesExhausted = queriesRun >= totalQueriesAvailable;

  let marketSignal, reasoning;

  if (urlsFound < 40 && !queriesExhausted) {
    // Small sample with queries still available — variance is too high to conclude anything.
    const remaining = totalQueriesAvailable - queriesRun;
    marketSignal = "normal";
    reasoning =
      `Insufficient data yet (${urlsFound} URLs fetched, ${remaining} ` +
      `${remaining === 1 ? "query" : "queries"} remaining) — ` +
      `not enough evidence to assess market depth`;
  } else {
    // Either urlsFound >= 40 (large enough sample) OR all queries are exhausted
    // (nothing left to search, so what we have is what we get).
    const isLowYield = yieldRate < 0.2 && atUrlCap;
    if (isLowYield) {
      marketSignal = "possibly niche — consider a wider run";
      reasoning = urlsFound < 40
        ? `Low yield rate (${yieldRatePct}%) with all queries exhausted — thin market signal despite small sample`
        : `Low yield rate (${yieldRatePct}%) at URL cap (${urlsFound}/${maxUrls}) — market may be niche`;
      console.log(
        `\nLow yield rate (${yieldRatePct}%) at the current URL cap — ` +
        `this may be a niche market where relevant buyers exist beyond what was fetched. ` +
        `Consider re-running with a higher maxUrls if you want a more complete picture.`
      );
    } else {
      marketSignal = "normal";
      reasoning = urlsFound < 40
        ? `Queries exhausted (${urlsFound} URLs, ${yieldRatePct}% yield) — yield rate above threshold; market appears viable`
        : `Sufficient data (${urlsFound} URLs, ${yieldRatePct}% yield) — yield rate above threshold; market appears viable`;
    }
  }

  return { yieldRatePct, marketSignal, sampleSize: urlsFound, reasoning };
}

// Domains that are never PE firm sites and never worth mining for firm names:
// social platforms, press wires, PE aggregators.
const LISTICLE_SKIP_DOMAINS = new Set([
  "linkedin.com", "twitter.com", "x.com", "facebook.com", "instagram.com",
  "reddit.com", "youtube.com", "prnewswire.com", "businesswire.com",
  "globenewswire.com", "pehub.com", "pitchbook.com", "themiddlemarket.com",
  "axios.com", "techcrunch.com",
]);

/**
 * Returns true if a fetched page looks like an editorial/roundup article that
 * may list multiple PE firm names — and therefore warrants firm-name extraction
 * via extractReportBuyers rather than silent discard.
 *
 * Two-signal check:
 *   1. URL path/slug patterns (sufficient on their own).
 *   2. Content: 4+ occurrences of "private equity" / "pe firm" / "buyout firm"
 *      in the first 5 000 chars — catches editorial guides with non-obvious URLs
 *      (e.g. mergersandinquisitions.com/consumer-retail-private-equity).
 *
 * @param {string} url
 * @param {string} [pageText]
 * @returns {boolean}
 */
function isListiclePage(url, pageText = "") {
  let hostname, path;
  try {
    const u = new URL(url);
    hostname = u.hostname.replace(/^www\./, "");
    path = u.pathname.toLowerCase();
  } catch {
    return false;
  }

  if (
    LISTICLE_SKIP_DOMAINS.has(hostname) ||
    [...LISTICLE_SKIP_DOMAINS].some((d) => hostname.endsWith(`.${d}`))
  ) {
    return false;
  }

  // ── URL signals ──────────────────────────────────────────────────────────
  // Strong editorial path patterns — always qualify even with sparse PE content.
  const hasEditorialPath = /\/(blog|insights?|resources?|forum|guides?|learn)\//i.test(path);

  // Slug-level signals: listicle ("top-10", "best-"), PE-firm list, M&A topic,
  // or "private-equity" anywhere in the URL path.
  const slug = path.split("/").pop() ?? "";
  const hasListicleSlug =
    /(^|\/)top-\d/i.test(path) ||
    /-firms?-in-|-pe-firms?\b|-private-equity-firms?\b/i.test(path);
  const hasMaOrPeSlug =
    /mergers?|acquisitions?|buyout/i.test(slug) || /private.?equity/i.test(path);

  // ── Content signal ────────────────────────────────────────────────────────
  const sample = pageText.slice(0, 5_000).toLowerCase();
  const peRefs = (sample.match(/\bprivate equity\b|\bpe firm\b|\bbuyout firm\b/g) || []).length;

  // Any URL-level signal needs only 1 PE content reference to qualify.
  if ((hasEditorialPath || hasListicleSlug || hasMaOrPeSlug) && peRefs >= 1) return true;

  // No URL signal → require stronger content evidence.
  return peRefs >= 4;
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
  // Page texts of extractFacts-rejected URLs, collected during the main loop
  // for post-loop listicle rescue.  Keyed by URL, never serialised to disk.
  const rejectedPageTexts = new Map();

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
      const rawExtractions = await withConcurrency(urlsToFetch, 4, extractFactsWithPage);

      // Stash page text for rejected pages — processed after the loop by listicle rescue.
      for (const e of rawExtractions) {
        if (e.success && !e.facts?.isRelevant && e._pageText && e.sourceUrl) {
          rejectedPageTexts.set(e.sourceUrl, e._pageText);
        }
      }

      const newExtractions = rawExtractions.map(({ _pageText, ...e }) => ({
        ...e,
        _discoveredVia: "buyer-search",
      }));
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

  // ── Listicle rescue ────────────────────────────────────────────────────────
  // Mine editorial/roundup pages that extractFacts rejected (not PE firm homepages)
  // but that may name multiple PE firms.  Mirrors the Bucket D / industry-report
  // pattern: extract names → resolve to firm sites → extractFacts those sites.
  const listicleRescueNames = new Set();
  const listiclePages = [...rejectedPageTexts.entries()].filter(([url, text]) =>
    isListiclePage(url, text)
  );

  if (listiclePages.length > 0) {
    console.log(
      `\nListicle rescue: ${listiclePages.length} editorial/roundup pages, extracting firm names...`
    );

    const buyerExtractions = await withConcurrency(
      listiclePages, 3, ([, text]) => extractReportBuyers(text)
    );

    const seenRescueNorms = new Set();
    const rescueFirmNames = [];
    let rescueOperatingFiltered = 0;
    for (const extraction of buyerExtractions) {
      for (const firmName of extraction.buyers ?? []) {
        if (isTargetCompany(firmName, profile.companyName)) {
          console.log(`  [Listicle rescue] Skipped self-match: '${firmName}'`);
          continue;
        }
        if (isOperatingCompanyName(firmName)) {
          rescueOperatingFiltered++;
          continue;
        }
        const norm = normalizeForMatch(firmName);
        if (!seenRescueNorms.has(norm)) {
          seenRescueNorms.add(norm);
          rescueFirmNames.push(firmName);
        }
      }
    }
    if (rescueOperatingFiltered > 0)
      console.log(
        `Listicle rescue: ${rescueOperatingFiltered} names filtered (known operating companies)`
      );
    console.log(`Listicle rescue: ${rescueFirmNames.length} unique firm names found`);

    if (rescueFirmNames.length > 0) {
      for (const name of rescueFirmNames) listicleRescueNames.add(normalizeForMatch(name));

      const resolvedSites = await withConcurrency(
        rescueFirmNames, 4,
        (name) => resolveAcquirerWebsite(name, buyers, { searchSuffix: "private equity firm" })
      );

      const listicleUrlsToFetch = [
        ...new Set(
          resolvedSites
            .map((r) => (r.website ? `https://${r.website}` : null))
            .filter(Boolean)
            .filter((url) => !allFetchedUrls.has(url))
        ),
      ];

      if (listicleUrlsToFetch.length > 0) {
        console.log(
          `Listicle rescue: fetching ${listicleUrlsToFetch.length} firm sites (4 at a time)...`
        );
        const listicleExtractions = (
          await withConcurrency(listicleUrlsToFetch, 4, extractFacts)
        ).map((e) => ({ ...e, _discoveredVia: "listicle-rescue" }));

        listicleUrlsToFetch.forEach((url) => allFetchedUrls.add(url));

        const listFailed = listicleExtractions.filter((e) => !e.success).length;
        if (listFailed > 0) console.log(`  (${listFailed} URLs failed)`);
        totalUrlsFailed += listFailed;
        allExtractions = [...allExtractions, ...listicleExtractions];

        const deduped = dedupeBuyers(allExtractions);
        console.log(`After listicle rescue: ${deduped.length} unique firms`);
        buyers = sortBuyers(
          deduped.map((buyer) => ({
            ...buyer,
            fit: fitMatch(profile, buyer),
            confidence: scoreConfidence(buyer),
          }))
        );
      } else {
        console.log(`Listicle rescue: all resolved firms already known — no new URLs to fetch`);
      }
    }
  }

  // ── Bucket D: deal-announcement discovery ─────────────────────────────────
  const dealDiscoveryNames = new Set();
  const bucketDQueries = generateDealAnnouncementQueries(profile);

  if (bucketDQueries.length > 0) {
    console.log(`\nBucket D: running ${bucketDQueries.length} deal-announcement queries...`);

    const dealSearchOpts = { topic: "news", days: 730, includeDomains: DEAL_PRESS_DOMAINS };
    const dealRawResults = (
      await Promise.all(bucketDQueries.map((q) => webSearch(q, dealSearchOpts)))
    ).flat();

    // Deduplicate articles by URL; drop any without a snippet to extract from
    const seenArticleUrls = new Set();
    const dealArticles = dealRawResults.filter((r) => {
      if (!r.url || !r.snippet || seenArticleUrls.has(r.url)) return false;
      seenArticleUrls.add(r.url);
      return true;
    });

    // Build sector terms for the pre-filter proximity check.
    // Split multi-word phrases into individual tokens so that short Tavily snippets
    // (which rarely echo full phrases verbatim) can still match.
    const sectorTerms = [
      profile.sector,
      ...(profile.searchKeywords ?? []).slice(0, 4),
    ]
      .filter(Boolean)
      .flatMap((t) => t.split(/[\s/,]+/))
      .map((w) => w.toLowerCase())
      .filter((w) => w.length >= 4)
      .filter((w, i, arr) => arr.indexOf(w) === i);

    const preFiltered = dealArticles.filter((a) => !isAcquisitionRelevant(a.snippet, sectorTerms)).length;
    if (preFiltered > 0)
      console.log(`Bucket D: ${preFiltered} articles skipped by pre-filter (no acquisition term near sector keyword)`);

    console.log(`Bucket D: ${dealArticles.length} unique articles, extracting acquirer names...`);
    const acquirerResults = await withConcurrency(dealArticles, 4, (a) =>
      isAcquisitionRelevant(a.snippet, sectorTerms)
        ? extractAcquirer(a.snippet)
        : Promise.resolve({ firmName: null, method: "pre-filter" })
    );

    // Collect unique non-null firm names
    const seenDealNorms = new Set();
    const dealFirmNames = [];
    for (const r of acquirerResults) {
      if (!r.firmName) continue;
      if (isTargetCompany(r.firmName, profile.companyName)) {
        console.log(`  [Bucket D] Skipped self-match: '${r.firmName}'`);
        continue;
      }
      const norm = normalizeForMatch(r.firmName);
      if (!seenDealNorms.has(norm)) {
        seenDealNorms.add(norm);
        dealFirmNames.push(r.firmName);
      }
    }
    console.log(`Bucket D: ${dealFirmNames.length} unique acquirer names`);

    if (dealFirmNames.length > 0) {
      // Track every name Bucket D surfaced, including firms already in buyers —
      // used below to tag discoveredVia even when no new URL is fetched.
      for (const name of dealFirmNames) dealDiscoveryNames.add(normalizeForMatch(name));

      // Resolve each name to a website, reusing known-firm data before searching
      const resolvedSites = await withConcurrency(
        dealFirmNames, 4, (name) => resolveAcquirerWebsite(name, buyers)
      );

      const bucketDUrlsToFetch = [
        ...new Set(
          resolvedSites
            .map((r) => (r.website ? `https://${r.website}` : null))
            .filter(Boolean)
            .filter((url) => !allFetchedUrls.has(url))
        ),
      ];

      if (bucketDUrlsToFetch.length > 0) {
        console.log(
          `Bucket D: extracting facts from ${bucketDUrlsToFetch.length} firm sites (4 at a time)...`
        );
        const bucketDExtractions = (
          await withConcurrency(bucketDUrlsToFetch, 4, extractFacts)
        ).map((e) => ({ ...e, _discoveredVia: "deal-discovery" }));

        bucketDUrlsToFetch.forEach((url) => allFetchedUrls.add(url));

        const bucketDFailed = bucketDExtractions.filter((e) => !e.success).length;
        if (bucketDFailed > 0) console.log(`  (${bucketDFailed} URLs failed)`);
        totalUrlsFailed += bucketDFailed;
        allExtractions = [...allExtractions, ...bucketDExtractions];

        // Re-dedupe and re-score with Bucket D results folded in
        const deduped = dedupeBuyers(allExtractions);
        console.log(`After Bucket D: ${deduped.length} unique firms`);
        buyers = sortBuyers(
          deduped.map((buyer) => ({
            ...buyer,
            fit: fitMatch(profile, buyer),
            confidence: scoreConfidence(buyer),
          }))
        );
      } else {
        console.log(`Bucket D: all resolved firms already known — no new URLs to fetch`);
      }
    }
  }

  // ── Industry-report discovery ───────────────────────────────────────────────
  const industryReportDiscoveryNames = new Set();
  const industryReportQueries = generateIndustryReportQueries(profile);

  if (industryReportQueries.length > 0) {
    console.log(`\nIndustry reports: running ${industryReportQueries.length} queries...`);

    const reportSearchOpts = { topic: "general", includeDomains: INDUSTRY_REPORT_DOMAINS };
    const reportRawResults = (
      await Promise.all(industryReportQueries.map((q) => webSearch(q, reportSearchOpts)))
    ).flat();

    const seenReportUrls = new Set();
    const reportResults = reportRawResults.filter((r) => {
      if (!r.url || seenReportUrls.has(r.url)) return false;
      seenReportUrls.add(r.url);
      return true;
    });

    const reportSectorTerms = buildSectorTerms(profile);
    const reportCandidates = reportResults.filter((r) => isIndustryReportRelevant(r, reportSectorTerms));
    console.log(`Industry reports: ${reportResults.length} unique URLs → ${reportCandidates.length} after pre-filter`);

    if (reportCandidates.length > 0) {
      console.log(`Industry reports: fetching ${reportCandidates.length} reports...`);
      const reportFetches = await withConcurrency(reportCandidates, 3, (r) => fetchReport(r.url));

      const successfulFetches = reportFetches.filter((f) => f.success);
      const failedReportFetches = reportFetches.filter((f) => !f.success).length;
      if (failedReportFetches > 0) console.log(`  (${failedReportFetches} reports failed to fetch)`);

      console.log(`Industry reports: extracting buyers from ${successfulFetches.length} reports...`);
      const buyerExtractions = await withConcurrency(successfulFetches, 3, (f) =>
        extractReportBuyers(f.text)
      );

      const seenReportNorms = new Set();
      const reportFirmNames = [];
      let reportOperatingFiltered = 0;
      for (const extraction of buyerExtractions) {
        for (const firmName of extraction.buyers ?? []) {
          if (isTargetCompany(firmName, profile.companyName)) {
            console.log(`  [Industry reports] Skipped self-match: '${firmName}'`);
            continue;
          }
          if (isOperatingCompanyName(firmName)) {
            reportOperatingFiltered++;
            continue;
          }
          const norm = normalizeForMatch(firmName);
          if (!seenReportNorms.has(norm)) {
            seenReportNorms.add(norm);
            reportFirmNames.push(firmName);
          }
        }
      }
      if (reportOperatingFiltered > 0)
        console.log(`Industry reports: ${reportOperatingFiltered} names filtered (known operating companies)`);
      console.log(`Industry reports: ${reportFirmNames.length} unique buyer names`);

      if (reportFirmNames.length > 0) {
        for (const name of reportFirmNames) industryReportDiscoveryNames.add(normalizeForMatch(name));

        const reportResolvedSites = await withConcurrency(
          reportFirmNames, 4, (name) => resolveAcquirerWebsite(name, buyers, { searchSuffix: "private equity firm" })
        );

        const industryReportUrlsToFetch = [
          ...new Set(
            reportResolvedSites
              .map((r) => (r.website ? `https://${r.website}` : null))
              .filter(Boolean)
              .filter((url) => !allFetchedUrls.has(url))
          ),
        ];

        if (industryReportUrlsToFetch.length > 0) {
          console.log(
            `Industry reports: extracting facts from ${industryReportUrlsToFetch.length} firm sites (4 at a time)...`
          );
          const industryReportExtractions = (
            await withConcurrency(industryReportUrlsToFetch, 4, extractFacts)
          ).map((e) => ({ ...e, _discoveredVia: "industry-report" }));

          industryReportUrlsToFetch.forEach((url) => allFetchedUrls.add(url));

          const irFailed = industryReportExtractions.filter((e) => !e.success).length;
          if (irFailed > 0) console.log(`  (${irFailed} URLs failed)`);
          totalUrlsFailed += irFailed;
          allExtractions = [...allExtractions, ...industryReportExtractions];

          const deduped = dedupeBuyers(allExtractions);
          console.log(`After industry reports: ${deduped.length} unique firms`);
          buyers = sortBuyers(
            deduped.map((buyer) => ({
              ...buyer,
              fit: fitMatch(profile, buyer),
              confidence: scoreConfidence(buyer),
            }))
          );
        } else {
          console.log(`Industry reports: all resolved firms already known — no new URLs to fetch`);
        }
      }
    }
  }

  // Attach discoveredVia to every buyer.
  // Primary source: URL→route map built from tagged extractions.
  // Supplement: dealDiscoveryNames / industryReportDiscoveryNames catch firms whose
  // URLs were already in allFetchedUrls (so no new extraction was created for them).
  const urlToRoute = new Map(
    allExtractions
      .filter((e) => e.sourceUrl && e._discoveredVia)
      .map((e) => [e.sourceUrl, e._discoveredVia])
  );
  buyers = buyers.map((buyer) => {
    const routes = new Set(
      (buyer.sourceUrls ?? []).map((url) => urlToRoute.get(url)).filter(Boolean)
    );
    if (dealDiscoveryNames.has(normalizeForMatch(buyer.firmName))) {
      routes.add("deal-discovery");
    }
    if (industryReportDiscoveryNames.has(normalizeForMatch(buyer.firmName))) {
      routes.add("industry-report");
    }
    if (listicleRescueNames.has(normalizeForMatch(buyer.firmName))) {
      routes.add("listicle-rescue");
    }
    return {
      ...buyer,
      discoveredVia: routes.size > 0 ? [...routes] : ["buyer-search"],
    };
  });

  buyers = await runEnrichmentPasses(profile, buyers);

  const urlsFound = allFetchedUrls.size;
  const strongCount = buyers.filter((b) => b.fit.fitScore === "Strong").length;
  const moderateCount = buyers.filter((b) => b.fit.fitScore === "Moderate").length;
  console.log(
    `\nDone. ${buyers.length} unique firms — ${strongCount} strong fit, ${moderateCount} moderate fit.`
  );

  const { yieldRatePct, marketSignal, sampleSize, reasoning } = computeMarketSignal(
    buyers, urlsFound, currentMaxUrls, queriesUsedSoFar, allQueries.length
  );

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
    sampleSize,
    reasoning,
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
    const candidateQueries = allQueries.slice(queriesUsedSoFar, nextQueryEnd);

    // Skip any candidate that is a near-duplicate of a query already run in a
    // previous round or widen (guards against the same concept appearing twice
    // in allQueries when it was generated before near-dup filtering was live).
    const alreadyRun = allQueries.slice(0, queriesUsedSoFar);
    const moreQueries = candidateQueries.filter((q) => {
      const twin = alreadyRun.find((prev) => isNearDuplicate(q, prev));
      if (twin) {
        console.log(`  Skipped near-duplicate query: '${q}' (too similar to '${twin}')`);
        return false;
      }
      return true;
    });

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

  const { yieldRatePct, marketSignal, sampleSize, reasoning } = computeMarketSignal(
    buyers, urlsFound, newMaxUrls, queriesUsedSoFar, allQueries.length
  );

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
    sampleSize,
    reasoning,
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

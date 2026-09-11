/**
 * Diagnostic: trace every industry-report buyer name from extraction through
 * resolver → extractFacts → dedup, and classify each name's fate.
 *
 * All steps are cached from the full pipeline run, so this costs zero credits.
 */
import "dotenv/config";

async function withConcurrency(items, limit, fn) {
  const results = new Array(items.length);
  let idx = 0;
  async function worker() {
    while (idx < items.length) {
      const i = idx++;
      try { results[i] = await fn(items[i]); }
      catch (err) { results[i] = { success: false, error: err.message }; }
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}
import { profileTarget } from "./profile-target.js";
import {
  generateBuyerQueries,
  generateDealAnnouncementQueries,
  generateIndustryReportQueries,
  INDUSTRY_REPORT_DOMAINS,
  buildSectorTerms,
  isIndustryReportRelevant,
} from "./generate-search-queries.js";
import { webSearch, DEAL_PRESS_DOMAINS } from "./web-search.js";
import { fetchReport } from "./fetch-report.js";
import { extractReportBuyers } from "./extract-report-buyers.js";
import { extractFacts } from "./extract-facts.js";
import { extractAcquirer, isAcquisitionRelevant } from "./extract-acquirer.js";
import { resolveAcquirerWebsite } from "./resolve-acquirer-website.js";
import {
  dedupeBuyers,
  normalizeForMatch,
  isTargetCompany,
  isSubstringMatch,
} from "./dedupe.js";
import { getCached } from "./cache.js";
import { isOperatingCompanyName } from "./report-buyer-filter.js";

// ── 1. Build the same pre-industry-report buyers that the pipeline had ─────────
//      (buyer-search main loop + Bucket D)

const profileResult = await profileTarget("https://www.servicetitan.com");
const profile = profileResult.profile;

const allQueries = await generateBuyerQueries(profile);

// Replicate the 2-round main loop (maxQueries=3 per round, maxUrls=12 then 27)
const allExtractions = [];
const allFetchedUrls = new Set();
let queriesUsed = 0;

const ROUND_CAPS = [
  { queries: 3, urls: 12 },
  { queries: 6, urls: 27 },
];

for (const { queries: qEnd, urls: urlCap } of ROUND_CAPS) {
  const queries = allQueries.slice(queriesUsed, qEnd);
  const raw = (await withConcurrency(queries, 3, (q) => webSearch(q))).flat();
  const newUrls = [...new Set(raw.map((r) => r.url).filter(Boolean))].filter(
    (u) => !allFetchedUrls.has(u)
  );
  const toFetch = newUrls.slice(0, urlCap - allFetchedUrls.size);
  const extractions = await withConcurrency(toFetch, 4, extractFacts);
  toFetch.forEach((u) => allFetchedUrls.add(u));
  allExtractions.push(...extractions.map((e) => ({ ...e, _discoveredVia: "buyer-search" })));
  queriesUsed = qEnd;
}

// Bucket D
const bucketDQueries = generateDealAnnouncementQueries(profile);
const dealOpts = { topic: "news", days: 730, includeDomains: DEAL_PRESS_DOMAINS };
const dealRaw = (
  await withConcurrency(bucketDQueries, 3, (q) => webSearch(q, dealOpts))
).flat();
const seenArticleUrls = new Set();
const dealArticles = dealRaw.filter((r) => {
  if (!r.url || !r.snippet || seenArticleUrls.has(r.url)) return false;
  seenArticleUrls.add(r.url);
  return true;
});
const sectorTerms = [profile.sector, ...(profile.searchKeywords ?? []).slice(0, 4)]
  .filter(Boolean)
  .flatMap((t) => t.split(/[\s/,]+/))
  .map((w) => w.toLowerCase())
  .filter((w) => w.length >= 4)
  .filter((w, i, arr) => arr.indexOf(w) === i);
const acquirerResults = await withConcurrency(
  dealArticles, 4, (a) =>
    isAcquisitionRelevant(a.snippet, sectorTerms)
      ? extractAcquirer(a.snippet)
      : Promise.resolve({ firmName: null })
);
const seenDealNorms = new Set();
const dealFirmNames = [];
for (const r of acquirerResults) {
  if (!r.firmName) continue;
  if (isTargetCompany(r.firmName, profile.companyName)) continue;
  const norm = normalizeForMatch(r.firmName);
  if (!seenDealNorms.has(norm)) { seenDealNorms.add(norm); dealFirmNames.push(r.firmName); }
}
const resolvedDealSites = await withConcurrency(
  dealFirmNames, 4, (name) => resolveAcquirerWebsite(name, dedupeBuyers(allExtractions))
);
const bucketDUrls = [
  ...new Set(
    resolvedDealSites.map((r) => r.website ? `https://${r.website}` : null)
      .filter(Boolean).filter((u) => !allFetchedUrls.has(u))
  ),
];
const bucketDExtractions = await withConcurrency(bucketDUrls, 4, extractFacts);
bucketDUrls.forEach((u) => allFetchedUrls.add(u));
allExtractions.push(...bucketDExtractions.map((e) => ({ ...e, _discoveredVia: "deal-discovery" })));

// buyers before industry-report path
const buyersBeforeIR = dedupeBuyers(allExtractions);
console.log(`Pre-IR baseline: ${buyersBeforeIR.length} firms from buyer-search + Bucket D`);
console.log(buyersBeforeIR.map((b) => `  - ${b.firmName}`).join("\n"));

// ── 2. Industry-report path with full tracing ─────────────────────────────────

const irQueries = generateIndustryReportQueries(profile);
const irSearchOpts = { topic: "general", includeDomains: INDUSTRY_REPORT_DOMAINS };
const irRaw = (
  await Promise.all(irQueries.map((q) => webSearch(q, irSearchOpts)))
).flat();

const seenReportUrls = new Set();
const irDeduped = irRaw.filter((r) => {
  if (!r.url || seenReportUrls.has(r.url)) return false;
  seenReportUrls.add(r.url);
  return true;
});

const reportSectorTerms = buildSectorTerms(profile);
const reportCandidates = irDeduped.filter((r) => isIndustryReportRelevant(r, reportSectorTerms));
console.log(`\nReport candidates: ${reportCandidates.length}`);

const reportFetches = await withConcurrency(reportCandidates, 3, (r) => fetchReport(r.url));
const successfulFetches = reportFetches.filter((f) => f.success);
const buyerExtractionResults = await withConcurrency(successfulFetches, 3, (f) =>
  extractReportBuyers(f.text)
);

// Collect raw extracted names with source report
const rawNamesWithSource = [];
for (let i = 0; i < successfulFetches.length; i++) {
  const slug = successfulFetches[i].url.split("/").pop();
  for (const name of buyerExtractionResults[i].buyers ?? []) {
    rawNamesWithSource.push({ name, slug });
  }
}

// Deduplicate names (same as pipeline, including both filters)
const seenReportNorms = new Set();
const reportFirmNames = [];
const deniedNames = [];
for (const { name } of rawNamesWithSource) {
  if (isTargetCompany(name, profile.companyName)) continue;
  if (isOperatingCompanyName(name)) { deniedNames.push(name); continue; }
  const norm = normalizeForMatch(name);
  if (!seenReportNorms.has(norm)) {
    seenReportNorms.add(norm);
    reportFirmNames.push(name);
  }
}
console.log(`\nDenylist filtered: ${deniedNames.length} names`);
console.log(`Unique report firm names (post-filter): ${reportFirmNames.length}`);

// ── 3. Resolve each name, tracking resolution source ─────────────────────────
console.log(`\nResolving ${reportFirmNames.length} names (with "private equity firm" suffix)...`);
const resolutionResults = await withConcurrency(reportFirmNames, 4, async (name) => {
  const resolved = await resolveAcquirerWebsite(name, buyersBeforeIR, { searchSuffix: "private equity firm" });
  return { name, website: resolved.website, source: resolved.source };
});

// ── 4. extractFacts for each unique URL ───────────────────────────────────────
const urlToNames = new Map();
for (const r of resolutionResults) {
  if (!r.website) continue;
  const url = `https://${r.website}`;
  if (!urlToNames.has(url)) urlToNames.set(url, []);
  urlToNames.get(url).push(r.name);
}

// URLs already known before IR path
const knownUrls = new Set(
  buyersBeforeIR.flatMap((b) => b.sourceUrls ?? [])
);
const newUrls = [...urlToNames.keys()].filter((u) => !knownUrls.has(u));
const alreadyKnownUrls = [...urlToNames.keys()].filter((u) => knownUrls.has(u));

console.log(`\nURL resolution:`);
console.log(`  Names with no URL:       ${resolutionResults.filter((r) => !r.website).length}`);
console.log(`  Names resolved to URL:   ${resolutionResults.filter((r) => r.website).length}`);
console.log(`    Already-known URL:     ${alreadyKnownUrls.length} unique URLs`);
console.log(`    New URLs to fetch:     ${newUrls.length} unique URLs`);

// Read extractFacts results directly from cache — avoids triggering live HTTP
// fetches for URLs that weren't processed (pipeline skipped them as already-known).
const extractionMap = new Map();

// Seed from allExtractions we already have (main search + Bucket D).
for (const e of allExtractions) {
  if (e.sourceUrl) extractionMap.set(e.sourceUrl, e);
}

// For new IR URLs: try cache first, fall back to live extractFacts.
// After cache-clearing, stale entries are gone, so live calls run for the
// newly-resolved URLs (GTCR → gtcr.com, H.I.G. → higprivateequity.com, etc.).
const uncachedNewUrls = newUrls.filter((u) => !extractionMap.has(u));
const liveResults = await withConcurrency(uncachedNewUrls, 3, async (url) => {
  const cached = await getCached(`extract-facts:${url}`);
  if (cached) return { url, result: cached.value ?? cached };
  // No cache entry — call extractFacts live (spends one Tavily credit).
  const result = await extractFacts(url);
  return { url, result };
});
for (const { url, result } of liveResults) {
  if (result) extractionMap.set(url, result);
}

// ── 5. Trace each name to its fate ────────────────────────────────────────────

// Re-run full dedup including IR results to see which firms survive.
// Only include URLs that are in the extraction map (i.e. pipeline actually processed them).
const irExtractionsAll = newUrls
  .filter((url) => extractionMap.has(url))
  .map((url) => ({ ...extractionMap.get(url), _discoveredVia: "industry-report" }));
const combinedExtractions = [...allExtractions, ...irExtractionsAll];
const finalBuyers = dedupeBuyers(combinedExtractions);

// Build a set of final buyer normalized names
const finalBuyerNorms = new Set(finalBuyers.map((b) => normalizeForMatch(b.firmName)));

// Categorize each of the 105+ resolver calls
const FATE = {
  DENYLIST_FILTERED: "denylist_filtered",            // blocked before resolver (operating company)
  KNOWN_FIRM_NO_SEARCH: "known_firm_no_search",      // resolved via known-firm match (no credit)
  NO_URL: "no_url",                                  // resolver returned null website
  ALREADY_KNOWN_URL: "already_known_url",            // URL was already in allFetchedUrls
  SKIPPED_ALREADY_FETCHED: "skipped_already_fetched",// pipeline excluded (allFetchedUrls)
  EXTRACT_FAILED: "extract_failed",                  // extractFacts returned success=false
  NOT_RELEVANT: "not_relevant",                      // isRelevant=false (advisory, news, etc.)
  DEDUPED_AWAY: "deduped_away",                      // relevant but merged with another firm
  FINAL_BUYER: "final_buyer",                        // survived to final output
};

const nameTraces = [];
// Add denylist-filtered names first (no resolver was called for these)
for (const name of deniedNames) {
  nameTraces.push({ name, website: null, source: "denylist", fate: FATE.DENYLIST_FILTERED, detail: "" });
}
for (const r of resolutionResults) {
  const { name, website, source } = r;
  const norm = normalizeForMatch(name);

  let fate;
  let detail = "";

  if (source === "known-exact" || source === "known-substring") {
    fate = FATE.KNOWN_FIRM_NO_SEARCH;
    // Find which known firm matched
    const matchedFirm = buyersBeforeIR.find((b) => {
      const nb = normalizeForMatch(b.firmName);
      return nb === norm || isSubstringMatch(norm, nb);
    });
    detail = matchedFirm ? `→ merged with '${matchedFirm.firmName}'` : "";
  } else if (!website) {
    fate = FATE.NO_URL;
  } else {
    const url = `https://${website}`;
    if (knownUrls.has(url)) {
      fate = FATE.ALREADY_KNOWN_URL;
      detail = url;
    } else if (!extractionMap.has(url)) {
      fate = FATE.SKIPPED_ALREADY_FETCHED;
      detail = url;
    } else {
      const extraction = extractionMap.get(url);
      if (!extraction?.success) {
        fate = FATE.EXTRACT_FAILED;
        detail = extraction?.error ?? "fetch error";
      } else if (!extraction?.facts?.isRelevant) {
        fate = FATE.NOT_RELEVANT;
        const fn = extraction?.facts?.firmName;
        detail = fn && fn !== "NOT FOUND" ? `extracted as '${fn}'` : "no firm name extracted";
      } else {
        // Check if this firm survived dedup or was merged
        const extractedName = extraction.facts.firmName ?? name;
        const extractedNorm = normalizeForMatch(extractedName);
        if (finalBuyerNorms.has(extractedNorm)) {
          fate = FATE.FINAL_BUYER;
          detail = extractedName !== name ? `(extracted as '${extractedName}')` : "";
        } else {
          // Is it a substring match with another final buyer?
          const mergedInto = finalBuyers.find((b) => {
            const nb = normalizeForMatch(b.firmName);
            return isSubstringMatch(extractedNorm, nb) || isSubstringMatch(nb, extractedNorm);
          });
          if (mergedInto) {
            fate = FATE.DEDUPED_AWAY;
            detail = `merged into '${mergedInto.firmName}'`;
          } else {
            fate = FATE.DEDUPED_AWAY;
            detail = `'${extractedName}' — no match found in final set`;
          }
        }
      }
    }
  }

  nameTraces.push({ name, website, source, fate, detail });
}

// ── 6. Summary report ─────────────────────────────────────────────────────────

const counts = {};
for (const v of Object.values(FATE)) counts[v] = 0;
for (const t of nameTraces) counts[t.fate]++;

const freshSearchCount = nameTraces.filter(
  (t) => t.source === "web-search"
).length;
const productiveSearches = nameTraces.filter(
  (t) => t.source === "web-search" && t.fate === FATE.FINAL_BUYER
).length;
const wastedSearches = freshSearchCount - productiveSearches;

console.log("\n" + "═".repeat(72));
console.log("RESOLVER BREAKDOWN — 111 unique report buyer names");
console.log("═".repeat(72));

const deniedByFilter = counts[FATE.DENYLIST_FILTERED];
console.log(`
  ── Before resolver ──
  Denylist filtered (operating companies):      ${deniedByFilter.toString().padStart(3)}  (0 credits)
  Already known firm (no search needed):        ${counts[FATE.KNOWN_FIRM_NO_SEARCH].toString().padStart(3)}  (0 credits)
  ─── ${freshSearchCount} fresh resolver searches ("X private equity firm") ───
  Resolver returned no URL:                     ${counts[FATE.NO_URL].toString().padStart(3)}
  Resolved to buyer-search/BucketD URL:         ${counts[FATE.ALREADY_KNOWN_URL].toString().padStart(3)}
  Skipped by pipeline (URL already fetched):    ${counts[FATE.SKIPPED_ALREADY_FETCHED].toString().padStart(3)}
  extractFacts failed:                          ${counts[FATE.EXTRACT_FAILED].toString().padStart(3)}
  extractFacts: isRelevant=false:               ${counts[FATE.NOT_RELEVANT].toString().padStart(3)}
  Relevant but deduped away / merged:           ${counts[FATE.DEDUPED_AWAY].toString().padStart(3)}
  Became a final buyer:                         ${counts[FATE.FINAL_BUYER].toString().padStart(3)}
  ──────────────────────────────────────────────────
  Total names (111 original − self-match):      ${nameTraces.length.toString().padStart(3)}
  Names that reach the resolver:                ${freshSearchCount.toString().padStart(3)}

  Resolver productive rate: ${productiveSearches}/${freshSearchCount} = ${Math.round(100 * productiveSearches / freshSearchCount)}%  (was 10% before changes)
  Credits saved by denylist: ${deniedByFilter} (was all wasted)
`);

// ── 7. Detail tables by fate ───────────────────────────────────────────────────

function printGroup(label, traces) {
  if (traces.length === 0) return;
  console.log(`\n── ${label} (${traces.length}) ──`);
  for (const t of traces) {
    const src = t.source === "web-search" ? "[search]" : `[${t.source}]`;
    const det = t.detail ? `  ${t.detail}` : "";
    console.log(`  ${src.padEnd(12)} ${t.name}${det}`);
  }
}

printGroup("DENYLIST FILTERED (operating companies — 0 credits)", nameTraces.filter((t) => t.fate === FATE.DENYLIST_FILTERED));
printGroup("KNOWN FIRM — no search, URL reused", nameTraces.filter((t) => t.fate === FATE.KNOWN_FIRM_NO_SEARCH));
printGroup("NO URL returned by resolver", nameTraces.filter((t) => t.fate === FATE.NO_URL));
printGroup("ALREADY-KNOWN URL (buyer-search/BucketD URL reused)", nameTraces.filter((t) => t.fate === FATE.ALREADY_KNOWN_URL));
printGroup("SKIPPED BY PIPELINE (URL already fetched in another path)", nameTraces.filter((t) => t.fate === FATE.SKIPPED_ALREADY_FETCHED));
printGroup("EXTRACT FAILED", nameTraces.filter((t) => t.fate === FATE.EXTRACT_FAILED));
printGroup("NOT RELEVANT (isRelevant=false) — after improved resolver query", nameTraces.filter((t) => t.fate === FATE.NOT_RELEVANT));
printGroup("RELEVANT BUT DEDUPED AWAY (merged with existing firm)", nameTraces.filter((t) => t.fate === FATE.DEDUPED_AWAY));
printGroup("FINAL BUYER", nameTraces.filter((t) => t.fate === FATE.FINAL_BUYER));

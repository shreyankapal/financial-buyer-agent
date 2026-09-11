/**
 * Clears extract-facts cache entries for URLs that the updated industry-report
 * resolver (searchSuffix: "private equity firm") returns for the 70 post-filter
 * names. These are stale because the old pipeline used a different resolver query
 * and may have fetched different (often wrong) URLs for the same names.
 */
import "dotenv/config";
import { createHash } from "crypto";
import { readdir, readFile, unlink } from "fs/promises";
import { join } from "path";

import { profileTarget } from "./profile-target.js";
import {
  generateIndustryReportQueries,
  INDUSTRY_REPORT_DOMAINS,
  buildSectorTerms,
  isIndustryReportRelevant,
} from "./generate-search-queries.js";
import { webSearch } from "./web-search.js";
import { fetchReport } from "./fetch-report.js";
import { extractReportBuyers } from "./extract-report-buyers.js";
import { resolveAcquirerWebsite } from "./resolve-acquirer-website.js";
import { isTargetCompany, normalizeForMatch } from "./dedupe.js";
import { isOperatingCompanyName } from "./report-buyer-filter.js";

const CACHE_DIR = "./cache";

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

function hashKey(key) {
  return createHash("sha256").update(key).digest("hex");
}

async function deleteCacheEntry(key) {
  const file = join(CACHE_DIR, `${hashKey(key)}.json`);
  try {
    await unlink(file);
    return true;
  } catch {
    return false;
  }
}

// ── Reproduce the 70 post-filter names ────────────────────────────────────────
const profileResult = await profileTarget("https://www.servicetitan.com");
const profile = profileResult.profile;

const irQueries = generateIndustryReportQueries(profile);
const irSearchOpts = { topic: "general", includeDomains: INDUSTRY_REPORT_DOMAINS };
const irRaw = (await withConcurrency(irQueries, 3, (q) => webSearch(q, irSearchOpts))).flat();

const seenUrls = new Set();
const irDeduped = irRaw.filter((r) => {
  if (!r.url || seenUrls.has(r.url)) return false;
  seenUrls.add(r.url);
  return true;
});

const reportSectorTerms = buildSectorTerms(profile);
const reportCandidates = irDeduped.filter((r) => isIndustryReportRelevant(r, reportSectorTerms));

const reportFetches = await withConcurrency(reportCandidates, 3, (r) => fetchReport(r.url));
const successfulFetches = reportFetches.filter((f) => f.success);
const buyerExtractionResults = await withConcurrency(successfulFetches, 3, (f) =>
  extractReportBuyers(f.text)
);

const seenReportNorms = new Set();
const reportFirmNames = [];
for (let i = 0; i < successfulFetches.length; i++) {
  for (const name of buyerExtractionResults[i].buyers ?? []) {
    if (isTargetCompany(name, profile.companyName)) continue;
    if (isOperatingCompanyName(name)) continue;
    const norm = normalizeForMatch(name);
    if (!seenReportNorms.has(norm)) {
      seenReportNorms.add(norm);
      reportFirmNames.push(name);
    }
  }
}

console.log(`Post-filter names: ${reportFirmNames.length}`);

// ── Resolve each name with the new query (all cached) ─────────────────────────
const resolutionResults = await withConcurrency(reportFirmNames, 4, async (name) => {
  const resolved = await resolveAcquirerWebsite(name, [], { searchSuffix: "private equity firm" });
  return { name, website: resolved.website, source: resolved.source };
});

// ── Collect unique resolved URLs ───────────────────────────────────────────────
const resolvedUrls = new Set(
  resolutionResults
    .filter((r) => r.website && r.source === "web-search")
    .map((r) => `https://${r.website}`)
);

console.log(`Unique resolved URLs: ${resolvedUrls.size}`);

// ── Delete extract-facts cache entries for those URLs ─────────────────────────
let deleted = 0;
let notFound = 0;
for (const url of resolvedUrls) {
  const key = `extract-facts:${url}`;
  const removed = await deleteCacheEntry(key);
  if (removed) {
    console.log(`  deleted: ${url}`);
    deleted++;
  } else {
    notFound++;
  }
}

console.log(`\nDeleted ${deleted} extract-facts cache entries.`);
console.log(`${notFound} URLs had no cached extract-facts entry (already clean).`);

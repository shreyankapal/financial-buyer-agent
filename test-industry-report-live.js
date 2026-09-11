import "dotenv/config";
import { webSearch } from "./web-search.js";
import {
  generateIndustryReportQueries,
  INDUSTRY_REPORT_DOMAINS,
  buildSectorTerms,
  isIndustryReportRelevant,
} from "./generate-search-queries.js";

const profile = {
  sector: "Field Service Management Software",
  niche: "Cloud-based field service management platform for home services contractors",
  searchKeywords: ["field service management", "FSM software", "home services software"],
};

const queries = generateIndustryReportQueries(profile);
const searchOpts = { topic: "general", includeDomains: INDUSTRY_REPORT_DOMAINS };
const sectorTerms = buildSectorTerms(profile);

console.log(`Sector terms: [${sectorTerms.join(", ")}]\n`);

const allResults = [];

for (const query of queries) {
  console.log(`\n${"═".repeat(70)}`);
  console.log(`Query: "${query}"`);
  console.log("─".repeat(70));

  const results = await webSearch(query, searchOpts);

  if (results.length === 0) {
    console.log("  (no results)");
    continue;
  }

  for (const r of results) {
    console.log(`\n  URL:     ${r.url}`);
    console.log(`  Title:   ${r.title}`);
    console.log(`  Snippet: ${r.snippet?.slice(0, 220).replace(/\n/g, " ")}…`);
    allResults.push(r);
  }
}

// Deduplicate by URL
const seenUrls = new Set();
const fetchList = allResults.filter((r) => {
  if (!r.url || seenUrls.has(r.url)) return false;
  seenUrls.add(r.url);
  return true;
});

// Apply pre-filter: PDF-only + sector-term match
const passing = fetchList.filter((r) => isIndustryReportRelevant(r, sectorTerms));
const dropped = fetchList.filter((r) => !isIndustryReportRelevant(r, sectorTerms));

// Known-good HL FSM reports we must retain
const KNOWN_GOOD = [
  "frontline-operations-software-update-september-2023",
  "field-and-frontline-operations-management-software-mar2026",
  "field-servce-tech-update-july-2022",
];

console.log(`\n${"═".repeat(70)}`);
console.log(`Raw results: ${allResults.length}  →  Unique URLs: ${fetchList.length}  →  After pre-filter: ${passing.length}`);

console.log(`\n── PASSING (${passing.length}) ────────────────────────────────────`);
for (const r of passing) {
  const isKnownGood = KNOWN_GOOD.some((k) => r.url.includes(k));
  const slug = r.url.split("/").pop().replace(/\.pdf$/i, "").replace(/[-_]/g, " ").toLowerCase();
  const matchedTerms = sectorTerms.filter((t) => slug.includes(t));
  const matchedFrontline = slug.includes("frontline operations");
  const matchSummary = [...matchedTerms, ...(matchedFrontline ? ["frontline operations"] : [])].join(", ");
  console.log(`  ${isKnownGood ? "✓ " : "  "}${r.url}`);
  console.log(`     slug matched: [${matchSummary}]`);
}

console.log(`\n── DROPPED (${dropped.length}) ────────────────────────────────────`);
for (const r of dropped) {
  const reason = !r.url?.toLowerCase().endsWith(".pdf") ? "not a PDF" : "no sector term match";
  console.log(`  [${reason}] ${r.url}`);
}

const missingKnownGood = KNOWN_GOOD.filter((k) => !passing.some((r) => r.url.includes(k)));
if (missingKnownGood.length > 0) {
  console.log(`\n⚠ Known-good HL reports NOT in passing list:`);
  missingKnownGood.forEach((k) => console.log(`  - ${k}`));
} else {
  console.log(`\nAll 3 known-good HL FSM reports present in passing list.`);
}

console.log(`${"═".repeat(70)}`);

import "dotenv/config";
import { webSearch } from "./web-search.js";
import {
  generateIndustryReportQueries,
  INDUSTRY_REPORT_DOMAINS,
  buildSectorTerms,
  isIndustryReportRelevant,
} from "./generate-search-queries.js";
import { fetchReport } from "./fetch-report.js";
import { extractReportBuyers } from "./extract-report-buyers.js";

const profile = {
  sector: "Field Service Management Software",
  niche: "Cloud-based field service management platform for home services contractors",
  searchKeywords: ["field service management", "FSM software", "home services software"],
};

const KNOWN_GOOD_SLUGS = [
  "frontline-operations-software-update-september-2023",
  "field-and-frontline-operations-management-software-mar2026",
  "field-servce-tech-update-july-2022",
];

// ── 1. Collect the 13-URL pre-filtered fetch list ─────────────────────────────
const queries = generateIndustryReportQueries(profile);
const searchOpts = { topic: "general", includeDomains: INDUSTRY_REPORT_DOMAINS };
const sectorTerms = buildSectorTerms(profile);

const allResults = [];
for (const q of queries) {
  allResults.push(...(await webSearch(q, searchOpts)));
}

const seenUrls = new Set();
const deduped = allResults.filter((r) => {
  if (!r.url || seenUrls.has(r.url)) return false;
  seenUrls.add(r.url);
  return true;
});

const fetchList = deduped.filter((r) => isIndustryReportRelevant(r, sectorTerms));
console.log(`Pre-filter: ${deduped.length} unique URLs → ${fetchList.length} to fetch\n`);

// ── 2. Fetch ───────────────────────────────────────────────────────────────────
console.log("Fetching...");
const withFetch = [];
for (const r of fetchList) {
  const tag = KNOWN_GOOD_SLUGS.some((k) => r.url.includes(k)) ? "FSM    " : "off-sec";
  process.stdout.write(`  [${tag}] ${r.url.split("/").pop().slice(0, 55).padEnd(55)} `);
  const fetched = await fetchReport(r.url);
  process.stdout.write(
    fetched.success
      ? `✓ ${(fetched.text?.length ?? 0).toLocaleString()} chars\n`
      : `✗ ${fetched.error}\n`
  );
  withFetch.push({ ...r, isKnownGood: tag === "FSM    ", fetched });
}

// ── 3. Extract buyers from successful fetches ─────────────────────────────────
const successful = withFetch.filter((r) => r.fetched.success);
console.log(`\nFetch: ${successful.length}/${fetchList.length} succeeded\n`);
console.log("Extracting buyers...");

const withBuyers = [];
for (const r of successful) {
  const tag = r.isKnownGood ? "FSM    " : "off-sec";
  process.stdout.write(`  [${tag}] ${r.url.split("/").pop().slice(0, 55).padEnd(55)} `);
  const extraction = await extractReportBuyers(r.fetched.text, r.url);
  process.stdout.write(`${extraction.buyers.length} buyers (${extraction.method})\n`);
  withBuyers.push({ ...r, extraction });
}

// ── 4. Report ─────────────────────────────────────────────────────────────────
console.log("\n" + "═".repeat(72));
console.log("KNOWN-GOOD FSM REPORTS");
console.log("═".repeat(72));
for (const r of withBuyers.filter((r) => r.isKnownGood)) {
  const { buyers, method, heading } = r.extraction;
  console.log(`\n  ${r.url.split("/").pop()}`);
  console.log(`  method:  ${method}${heading ? `  (heading: "${heading}")` : ""}`);
  if (buyers.length === 0) {
    console.log("  buyers:  (none extracted)");
  } else {
    console.log(`  buyers (${buyers.length}):`);
    buyers.forEach((b) => console.log(`    - ${b}`));
  }
}

console.log("\n" + "═".repeat(72));
console.log("OFF-SECTOR REPORTS — buyer bleed-through check");
console.log("═".repeat(72));
const offSector = withBuyers.filter((r) => !r.isKnownGood);
const offWithBuyers = offSector.filter((r) => r.extraction.buyers.length > 0);
const offEmpty = offSector.filter((r) => r.extraction.buyers.length === 0);
console.log(`\n  ${offEmpty.length} returned no buyers.`);
if (offWithBuyers.length > 0) {
  console.log(`  ${offWithBuyers.length} returned buyers (will need fit-match scoring):\n`);
  for (const r of offWithBuyers) {
    console.log(`  ${r.url.split("/").pop()}`);
    console.log(`  method: ${r.extraction.method}`);
    r.extraction.buyers.forEach((b) => console.log(`    - ${b}`));
  }
} else {
  console.log("\n  No off-sector reports produced buyer names.");
}
console.log("\n" + "═".repeat(72));

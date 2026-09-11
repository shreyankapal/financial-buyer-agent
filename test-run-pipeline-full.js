import "dotenv/config";
import { readdir, readFile } from "fs/promises";
import { join } from "path";
import { runPipeline } from "./run-pipeline.js";
import { normalizeForMatch } from "./dedupe.js";

const CACHE_DIR = "./cache";

async function snapshotCache() {
  const files = await readdir(CACHE_DIR).catch(() => []);
  const snap = new Map();
  for (const f of files) {
    try {
      const raw = await readFile(join(CACHE_DIR, f), "utf8");
      const { key } = JSON.parse(raw);
      snap.set(f, key);
    } catch {}
  }
  return snap;
}

function classifyWebSearch(key) {
  // Remove "web-search:" prefix
  const rest = key.slice("web-search:".length);
  if (rest.includes(":incl:capstonepartners.com,hl.com")) return "industry-report-search";
  if (rest.includes(":incl:") && rest.includes("topic:news")) return "bucket-d-search";
  if (rest.endsWith("official website") || rest.includes(" official website:")) return "resolver-search";
  if (rest.includes("investment criteria") || rest.includes("investment thesis")) return "enrichment-search";
  return "buyer-search";
}

// ── Run ───────────────────────────────────────────────────────────────────────
console.log("=".repeat(72));
console.log("FULL PIPELINE RUN — ServiceTitan, industry-report path enabled");
console.log("=".repeat(72));

const before = await snapshotCache();

const result = await runPipeline("https://www.servicetitan.com");

const after = await snapshotCache();

if (!result.success) {
  console.error("Pipeline failed:", result.error);
  process.exit(1);
}

// ── Credit accounting ─────────────────────────────────────────────────────────
const newEntries = [];
for (const [f, key] of after) {
  if (!before.has(f)) newEntries.push(key);
}

const freshByType = {
  "industry-report-search": [],
  "bucket-d-search": [],
  "buyer-search": [],
  "resolver-search": [],
  "enrichment-search": [],
  "fetch-report-pdf": [],
  "extract-facts": [],
  "other": [],
};

for (const key of newEntries) {
  if (key.startsWith("web-search:")) {
    const type = classifyWebSearch(key);
    freshByType[type].push(key);
  } else if (key.startsWith("fetch-report-pdf:")) {
    freshByType["fetch-report-pdf"].push(key);
  } else if (key.startsWith("extract-facts:")) {
    freshByType["extract-facts"].push(key);
  } else {
    freshByType["other"].push(key);
  }
}

console.log("\n" + "=".repeat(72));
console.log("TAVILY CREDIT COST (this run — fresh API calls only, cached = $0)");
console.log("=".repeat(72));

const resolverSearches = freshByType["resolver-search"];
const industrySearches = freshByType["industry-report-search"];
const buyerSearches = freshByType["buyer-search"];
const bucketDSearches = freshByType["bucket-d-search"];
const pdfFetches = freshByType["fetch-report-pdf"];

console.log(`\n  Industry-report search queries (6 templates):  ${industrySearches.length} fresh  (cached from prior test run)`);
console.log(`    Conceptual total for this path from scratch:   6 search credits`);
console.log(`  Resolver searches (resolveAcquirerWebsite):      ${resolverSearches.length} fresh`);
resolverSearches.forEach((k) => {
  const q = k.replace("web-search:", "").replace(/:.*/, "");
  console.log(`    + ${q}`);
});
console.log(`  PDF extract calls (Tavily extract API):          ${pdfFetches.length} fresh  (cached from prior test run)`);
console.log(`    Conceptual total for this path from scratch:   up to 13 extract credits`);
console.log(`\n  Other fresh calls this run:`);
console.log(`    Buyer-search queries:  ${buyerSearches.length}`);
console.log(`    Bucket D searches:     ${bucketDSearches.length}`);
console.log(`    extractFacts pages:    ${freshByType["extract-facts"].length}`);
console.log(`    Enrichment searches:   ${freshByType["enrichment-search"].length}`);
console.log(`    Other:                 ${freshByType["other"].length}`);

const totalFreshThisRun = newEntries.length;
const totalTavilyThisRun =
  industrySearches.length + resolverSearches.length + buyerSearches.length +
  bucketDSearches.length + pdfFetches.length;
console.log(`\n  Total fresh Tavily API calls this run: ${totalTavilyThisRun}`);
console.log(`  (Total new cache entries of all types:  ${totalFreshThisRun})`);

// ── discoveredVia breakdown ────────────────────────────────────────────────────
const { buyers, targetProfile } = result;
const irOnly = buyers.filter(
  (b) => b.discoveredVia?.includes("industry-report") && b.discoveredVia.length === 1
);
const irOverlap = buyers.filter(
  (b) => b.discoveredVia?.includes("industry-report") && b.discoveredVia.length > 1
);
const irAll = buyers.filter((b) => b.discoveredVia?.includes("industry-report"));

console.log("\n" + "=".repeat(72));
console.log("INDUSTRY-REPORT DISCOVERY RESULTS");
console.log("=".repeat(72));
console.log(`\n  Total buyers in output:                  ${buyers.length}`);
console.log(`  Discovered via industry-report (total):  ${irAll.length}`);
console.log(`    industry-report ONLY:                  ${irOnly.length}`);
console.log(`    industry-report + other paths:         ${irOverlap.length}`);

if (irAll.length > 0) {
  console.log("\n  All industry-report buyers:");
  console.log("  " + "-".repeat(70));
  console.log(
    "  " +
      "Name".padEnd(32) +
      "Fit".padEnd(10) +
      "Conf".padEnd(10) +
      "Routes"
  );
  console.log("  " + "-".repeat(70));
  for (const b of irAll) {
    console.log(
      "  " +
        b.firmName.slice(0, 30).padEnd(32) +
        (b.fit?.fitScore ?? "?").padEnd(10) +
        (b.confidence?.confidence ?? "?").padEnd(10) +
        b.discoveredVia.join(", ")
    );
  }
}

// ── Off-sector buyers check ────────────────────────────────────────────────────
console.log("\n" + "=".repeat(72));
console.log("FIT SCORES FOR INDUSTRY-REPORT-ONLY BUYERS (off-sector check)");
console.log("=".repeat(72));

if (irOnly.length === 0) {
  console.log("\n  No industry-report-only buyers to show.");
} else {
  const fitCounts = { Strong: 0, Moderate: 0, Weak: 0 };
  for (const b of irOnly) {
    const score = b.fit?.fitScore;
    if (score in fitCounts) fitCounts[score]++;
  }
  console.log(`\n  Strong: ${fitCounts.Strong}  Moderate: ${fitCounts.Moderate}  Weak: ${fitCounts.Weak}`);
  console.log("\n  Breakdown:");
  for (const b of irOnly) {
    console.log(`    [${(b.fit?.fitScore ?? "?").padEnd(8)}] ${b.firmName}`);
    if (b.fit?.notes) console.log(`             ${b.fit.notes.slice(0, 80)}`);
  }
}

// ── Self-match filter check ────────────────────────────────────────────────────
console.log("\n" + "=".repeat(72));
console.log("SELF-MATCH FILTER");
console.log("=".repeat(72));
const selfMatchLogs = [];
// We can't retroactively tell from the result alone whether it fired (it would have
// been printed to stdout during the run). Check if ServiceTitan appears in any buyer.
const selfMatchInOutput = buyers.find((b) =>
  normalizeForMatch(b.firmName).includes("servicetitan")
);
if (selfMatchInOutput) {
  console.log(`\n  WARNING: '${selfMatchInOutput.firmName}' found in output — self-match filter may have missed it`);
} else {
  console.log(`\n  No buyer named 'ServiceTitan' (or variant) in output — filter working correctly.`);
}

// ── Full sorted results ────────────────────────────────────────────────────────
console.log("\n" + "=".repeat(72));
console.log("ALL BUYERS — sorted Strong→Weak, High→Low confidence");
console.log("=".repeat(72));
console.log(
  "\n  " +
    "#".padEnd(4) +
    "Name".padEnd(34) +
    "Fit".padEnd(10) +
    "Conf".padEnd(8) +
    "Routes"
);
console.log("  " + "-".repeat(72));
buyers.forEach((b, i) => {
  console.log(
    "  " +
      String(i + 1).padEnd(4) +
      b.firmName.slice(0, 32).padEnd(34) +
      (b.fit?.fitScore ?? "?").padEnd(10) +
      (b.confidence?.confidence ?? "?").padEnd(8) +
      (b.discoveredVia ?? []).join(", ")
  );
});

// ── Stats ─────────────────────────────────────────────────────────────────────
console.log("\n" + "=".repeat(72));
console.log("PIPELINE STATS");
console.log("=".repeat(72));
const { stats } = result;
console.log(`\n  queriesRun:      ${stats.queriesRun}`);
console.log(`  urlsFound:       ${stats.urlsFound}`);
console.log(`  urlsFailed:      ${stats.urlsFailed}`);
console.log(`  firmsExtracted:  ${stats.firmsExtracted}`);
console.log(`  uniqueFirms:     ${stats.uniqueFirms}`);
console.log(`  roundsRun:       ${stats.roundsRun}`);
console.log(`  stopReason:      ${stats.stopReason}`);
console.log(`  marketSignal:    ${stats.marketSignal}`);

/**
 * Re-runs the 42 Bucket D snippets through the full extraction pipeline
 * (pre-filter → extractAcquirer) and reports how many of the null outcomes
 * were caught by the cheap pre-filter vs. required a full extraction attempt.
 */
import "dotenv/config";
import { readdir, readFile } from "fs/promises";
import { join } from "path";
import { profileTarget } from "./profile-target.js";
import { extractAcquirer, isAcquisitionRelevant } from "./extract-acquirer.js";

// ── Load ServiceTitan profile (cached) to get sector terms ───────────────────
const profileResult = await profileTarget("https://www.servicetitan.com");
if (!profileResult.success) { console.error("profile failed"); process.exit(1); }
const { sector, searchKeywords = [] } = profileResult.profile;
// Split phrases into individual word tokens so short Tavily snippets can match.
const sectorTerms = [sector, ...searchKeywords.slice(0, 4)]
  .filter(Boolean)
  .flatMap((t) => t.split(/[\s/,]+/))
  .map((w) => w.toLowerCase())
  .filter((w) => w.length >= 4)
  .filter((w, i, arr) => arr.indexOf(w) === i);
console.log("Sector terms:", sectorTerms, "\n");

// ── Load all 42 unique Bucket D snippets from cache ──────────────────────────
const files = await readdir("./cache");
const snippetMap = new Map();
for (const f of files) {
  try {
    const { key, value } = JSON.parse(await readFile(join("./cache", f), "utf8"));
    if (typeof key === "string" && key.includes(":topic:news") && Array.isArray(value)) {
      for (const r of value) {
        if (r.url && r.snippet && !snippetMap.has(r.url)) snippetMap.set(r.url, r.snippet);
      }
    }
  } catch {}
}
console.log(`Snippets loaded: ${snippetMap.size}\n`);

// ── Run pre-filter + extraction ───────────────────────────────────────────────
const rows = [];
for (const [url, snippet] of snippetMap) {
  const passes = isAcquisitionRelevant(snippet, sectorTerms);
  let result;
  if (!passes) {
    result = { firmName: null, method: "pre-filter" };
  } else {
    result = await extractAcquirer(snippet);
  }
  rows.push({ url, passes, ...result });
}

// ── Categorise ───────────────────────────────────────────────────────────────
const preFilteredNull  = rows.filter(r => r.method === "pre-filter");
const extractionNull   = rows.filter(r => r.method !== "pre-filter" && r.firmName === null);
const extractionNonNull = rows.filter(r => r.method !== "pre-filter" && r.firmName !== null);

console.log("═".repeat(68));
console.log("RESULTS");
console.log("═".repeat(68));
console.log(`Total snippets               : ${rows.length}`);
console.log(`Pre-filter: skipped (null)   : ${preFilteredNull.length}`);
console.log(`Extraction attempted         : ${rows.length - preFilteredNull.length}`);
console.log(`  → returned null            : ${extractionNull.length}`);
console.log(`  → returned a firm name     : ${extractionNonNull.length}`);

console.log(`\nOf the ${preFilteredNull.length + extractionNull.length} total nulls:`);
console.log(`  caught by pre-filter (no LLM/regex called) : ${preFilteredNull.length}`);
console.log(`  required full extraction, still null        : ${extractionNull.length}`);

// ── Method breakdown for extraction attempts ─────────────────────────────────
const attempted = rows.filter(r => r.method !== "pre-filter");
const regexHits = attempted.filter(r => r.method === "regex" && r.firmName !== null).length;
const llmHits   = attempted.filter(r => r.method === "llm"   && r.firmName !== null).length;
const regexNull = attempted.filter(r => r.method === "regex" && r.firmName === null).length;
const llmNull   = attempted.filter(r => r.method === "llm"   && r.firmName === null).length;

console.log(`\nExtraction method breakdown (${attempted.length} attempts):`);
console.log(`  regex → firm name : ${regexHits}   regex → null : ${regexNull}`);
console.log(`  llm   → firm name : ${llmHits}   llm   → null : ${llmNull}`);

// ── Show pre-filtered snippets ────────────────────────────────────────────────
console.log(`\nPre-filtered snippets (${preFilteredNull.length}):`);
for (const r of preFilteredNull) {
  const shortUrl = r.url.replace(/^https?:\/\/(www\.)?/, "").slice(0, 60);
  console.log(`  ${shortUrl}`);
}

// ── Show extraction nulls ─────────────────────────────────────────────────────
console.log(`\nExtraction nulls (${extractionNull.length}) — needed LLM/regex, still got nothing:`);
for (const r of extractionNull) {
  const shortUrl = r.url.replace(/^https?:\/\/(www\.)?/, "").slice(0, 60);
  console.log(`  [${r.method}] ${shortUrl}`);
}

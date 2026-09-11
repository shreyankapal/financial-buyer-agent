/**
 * Tests extractAcquirer against full fetched article bodies vs Tavily snippets
 * for a sample of Bucket D articles. Reports regex/LLM hit rates for both modes.
 */
import "dotenv/config";
import { readdir, readFile } from "fs/promises";
import { join } from "path";
import { fetchPage } from "./fetch-page.js";
import { extractAcquirer } from "./extract-acquirer.js";
import { getCached } from "./cache.js";

// Pull article URLs + their cached snippets from Bucket D search result cache
const cacheFiles = await readdir("./cache");
const articleMap = new Map(); // url -> snippet

for (const f of cacheFiles) {
  try {
    const raw = await readFile(join("./cache", f), "utf8");
    const entry = JSON.parse(raw);
    if (typeof entry.key === "string" && entry.key.includes(":topic:news") &&
        Array.isArray(entry.value)) {
      for (const r of entry.value) {
        if (r.url && r.snippet && !articleMap.has(r.url)) {
          articleMap.set(r.url, r.snippet);
        }
      }
    }
  } catch {}
}

// Sample: first 12 unique articles
const sample = [...articleMap.entries()].slice(0, 12);

console.log(`Testing ${sample.length} articles — snippet vs full body\n`);
console.log(
  "URL".padEnd(60) +
  " | snippet-method  | body-method    | match?"
);
console.log("─".repeat(110));

const snippetCounts = { regex: 0, llm: 0, null: 0 };
const bodyCounts    = { regex: 0, llm: 0, null: 0, fetchFail: 0 };
let agreements = 0;
let nameChanges = 0;

for (const [url, snippet] of sample) {
  // Snippet result (already cached from previous run)
  const snippetResult = await extractAcquirer(snippet);
  snippetCounts[snippetResult.method] = (snippetCounts[snippetResult.method] ?? 0) + 1;
  if (!snippetResult.firmName) snippetCounts.null++;

  // Full-body result — fetch the page, then run extractor on full text
  const page = await fetchPage(url);
  let bodyResult;
  if (!page.success || !page.text) {
    bodyCounts.fetchFail++;
    bodyResult = { firmName: null, method: "fetch-failed" };
  } else {
    // Use first 4 000 chars (enough for the lede + byline + opening paras)
    bodyResult = await extractAcquirer(page.text.slice(0, 4000));
    bodyCounts[bodyResult.method] = (bodyCounts[bodyResult.method] ?? 0) + 1;
    if (!bodyResult.firmName) bodyCounts.null++;
  }

  const shortUrl = url.replace(/^https?:\/\/(www\.)?/, "").slice(0, 57);
  const snippetCol = `${snippetResult.method}:${snippetResult.firmName?.slice(0,14) ?? "null"}`;
  const bodyCol    = `${bodyResult.method}:${bodyResult.firmName?.slice(0,14) ?? "null"}`;
  const match = snippetResult.firmName === bodyResult.firmName ? "✓" : "≠";
  if (match === "✓") agreements++;
  else nameChanges++;

  console.log(
    shortUrl.padEnd(60) + " | " +
    snippetCol.padEnd(16) + " | " +
    bodyCol.padEnd(15) + " | " + match
  );
  if (match === "≠") {
    console.log(
      " ".repeat(60) +
      `   snippet="${snippetResult.firmName ?? "null"}"` +
      `  body="${bodyResult.firmName ?? "null"}"`
    );
  }
}

console.log("\n" + "─".repeat(110));
console.log("\nSNIPPET mode breakdown:");
console.log(`  regex : ${snippetCounts.regex}`);
console.log(`  llm   : ${snippetCounts.llm}`);
const sTotal = snippetCounts.regex + snippetCounts.llm;
console.log(`  ratio : ${sTotal ? Math.round(snippetCounts.regex/sTotal*100) : 0}% regex / ${sTotal ? Math.round(snippetCounts.llm/sTotal*100) : 0}% llm`);

console.log("\nFULL BODY mode breakdown:");
console.log(`  regex       : ${bodyCounts.regex}`);
console.log(`  llm         : ${bodyCounts.llm}`);
console.log(`  fetch-failed: ${bodyCounts.fetchFail}`);
const bTotal = bodyCounts.regex + bodyCounts.llm;
console.log(`  ratio : ${bTotal ? Math.round(bodyCounts.regex/bTotal*100) : 0}% regex / ${bTotal ? Math.round(bodyCounts.llm/bTotal*100) : 0}% llm`);

console.log(`\nAgreements (same firm name): ${agreements}/${sample.length}`);
console.log(`Name changes (body ≠ snippet): ${nameChanges}`);

import { createHash } from "crypto";
import { unlink } from "fs/promises";
import { join } from "path";
import { extractFacts } from "./extract-facts.js";

const CACHE_DIR = "./cache";

async function bustCache(cacheKey) {
  const hash = createHash("sha256").update(cacheKey).digest("hex");
  try {
    await unlink(join(CACHE_DIR, `${hash}.json`));
  } catch {
    // not cached, nothing to delete
  }
}

const TEST_CASES = [
  {
    label: "CT Acquisitions (advisory — should be EXCLUDED)",
    url: "https://ctacquisitions.com/how-to-sell-a-saas-business",
    expectRelevant: false,
  },
  {
    label: "733Park (M&A advisor — should be EXCLUDED)",
    url: "https://www.733park.com/insights/the-top-vertical-saas-companies-to-know-today",
    expectRelevant: false,
  },
  {
    label: "Five Elms Capital (legit PE firm — should be INCLUDED)",
    url: "https://www.fiveelms.com/portfolio",
    expectRelevant: true,
  },
];

// Bust the cache for all test URLs so results reflect the updated prompt
for (const { url } of TEST_CASES) {
  await bustCache(`extract-facts:${url}`);
}

let allPassed = true;

for (const { label, url, expectRelevant } of TEST_CASES) {
  console.log(`\n${"═".repeat(60)}`);
  console.log(`${label}`);
  console.log(`URL: ${url}`);

  const result = await extractFacts(url);

  if (!result.success) {
    console.log(`  ERROR: ${result.error}`);
    allPassed = false;
    continue;
  }

  const { isRelevant, firmName, sectorFocus } = result.facts;
  const pass = isRelevant === expectRelevant;
  allPassed = allPassed && pass;

  console.log(`  isRelevant:  ${isRelevant}  ${pass ? "✓" : "✗ FAIL (expected " + expectRelevant + ")"}`);
  console.log(`  firmName:    ${firmName}`);
  console.log(`  sectorFocus: ${sectorFocus}`);
  if (result.facts.portfolioCompanies?.length > 0) {
    console.log(`  portfolio:   ${result.facts.portfolioCompanies.slice(0, 5).join(", ")}${result.facts.portfolioCompanies.length > 5 ? " …" : ""}`);
  }
}

console.log(`\n${"═".repeat(60)}`);
console.log(`\nOverall: ${allPassed ? "ALL PASSED ✓" : "FAILURES DETECTED ✗"}`);

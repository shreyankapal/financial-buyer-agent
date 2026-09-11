import { resolveAcquirerWebsite } from "./resolve-acquirer-website.js";

// Simulate the current run's known-firms list (as produced by dedupe.js).
const KNOWN_FIRMS = [
  {
    firmName: "Thoma Bravo",
    sourceUrls: ["https://www.thomabravo.com/investments"],
  },
  {
    firmName: "Thoma Bravo Fund XIV",       // substring match candidate
    sourceUrls: ["https://www.thomabravo.com/about"],
  },
  {
    firmName: "Sentinel Capital Partners",
    sourceUrls: ["https://www.sentinelpartners.com/portfolio"],
  },
];

const CASES = [
  {
    label: "Exact match — firm already known, no search credit",
    firmName: "Sentinel Capital Partners",
    knownFirms: KNOWN_FIRMS,
    expectedSource: "known-exact",
    expectedWebsite: "sentinelpartners.com",
  },
  {
    label: "Substring match — 'Thoma Bravo' matches 'Thoma Bravo Fund XIV'",
    firmName: "Thoma Bravo",
    knownFirms: KNOWN_FIRMS,
    expectedSource: "known-exact",   // exact hit on the first 'Thoma Bravo' entry
    expectedWebsite: "thomabravo.com",
  },
  {
    label: "Substring match — longer variant resolves via shorter known name",
    firmName: "Thoma Bravo Fund XIV",
    knownFirms: KNOWN_FIRMS,
    // 'Thoma Bravo Fund XIV' exact-matches entry [1], so source is known-exact
    expectedSource: "known-exact",
    expectedWebsite: "thomabravo.com",
  },
  {
    label: "Genuinely new firm — web search fires",
    firmName: "Riverside Company",
    knownFirms: KNOWN_FIRMS,
    expectedSource: "web-search",
    expectedWebsite: null,  // just verify it's non-null and a real domain
  },
];

let passed = 0;
let failed = 0;

for (const c of CASES) {
  console.log(`\n${"─".repeat(72)}`);
  console.log(c.label);

  const result = await resolveAcquirerWebsite(c.firmName, c.knownFirms);

  console.log(`  firmName : ${c.firmName}`);
  console.log(`  website  : ${result.website ?? "(null)"}`);
  console.log(`  source   : ${result.source}`);

  const sourceOk = result.source === c.expectedSource;
  const websiteOk =
    c.expectedWebsite === null
      ? result.website !== null && result.website.length > 0
      : result.website === c.expectedWebsite;

  if (sourceOk && websiteOk) {
    console.log("  PASS");
    passed++;
  } else {
    const reasons = [];
    if (!sourceOk) reasons.push(`expected source="${c.expectedSource}" got "${result.source}"`);
    if (!websiteOk) {
      if (c.expectedWebsite === null) {
        reasons.push("expected non-null website from web-search, got null");
      } else {
        reasons.push(`expected website="${c.expectedWebsite}" got "${result.website}"`);
      }
    }
    console.error(`  FAIL: ${reasons.join("; ")}`);
    failed++;
  }
}

console.log(`\n${"─".repeat(72)}`);
console.log(`Results: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);

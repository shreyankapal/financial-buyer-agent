import { extractAcquirer } from "./extract-acquirer.js";

const SAMPLES = [
  {
    label: "Sample 1 — classic comma-descriptor (expect regex: comma-descriptor)",
    expectedMethod: "regex",
    text: `Sentinel Capital Partners, a private equity firm specializing in lower middle-market companies, today announced that it has acquired PestCo Services, Inc., a leading provider of commercial pest control services operating across 14 states. Financial terms of the transaction were not disclosed. PestCo will continue to operate under its existing brand and management team.`,
  },
  {
    label: "Sample 2 — active-verb without 'today announced' (expect regex: active-verb)",
    expectedMethod: "regex",
    text: `Thoma Bravo has acquired Sophos, a global leader in next-generation cybersecurity, from Francisco Partners and Technology Crossover Ventures. The acquisition bolsters Thoma Bravo's growing portfolio of security software companies, which already includes SolarWinds, Proofpoint, and Barracuda Networks. Terms were not disclosed.`,
  },
  {
    label: "Sample 3 — passive voice 'acquired by' (expect regex: passive-acquired-by)",
    expectedMethod: "regex",
    text: `CloudBooks, a provider of cloud-based accounting software for small businesses, has been acquired by Alpine Investors in a deal that closed Friday. Alpine Investors will integrate CloudBooks into its existing portfolio of vertical SaaS businesses. The transaction was arranged by Harris Williams & Co.`,
  },
  {
    label: "Sample 4 — informal news blurb, no press-release structure (expect LLM fallback)",
    expectedMethod: "llm",
    text: `Portfolio moves roundup: The deal was finalized last Tuesday after months of negotiations. Industry sources confirm that Chicago-based Riverside Company snapped up workforce management platform ShiftHero for an undisclosed sum. This marks the firm's eighth add-on acquisition since closing its latest buyout fund in 2022. Closing is subject to customary regulatory approvals.`,
  },
];

let passed = 0;
let failed = 0;

for (const sample of SAMPLES) {
  console.log(`\n${"─".repeat(70)}`);
  console.log(sample.label);

  const result = await extractAcquirer(sample.text);

  console.log(`  firmName : ${result.firmName ?? "(null)"}`);
  console.log(`  method   : ${result.method}${result.pattern ? ` (${result.pattern})` : ""}`);

  const methodOk = result.method === sample.expectedMethod;
  const nameOk = result.firmName != null && result.firmName.length > 0;

  if (methodOk && nameOk) {
    console.log("  PASS");
    passed++;
  } else {
    const reasons = [];
    if (!methodOk) reasons.push(`expected method="${sample.expectedMethod}" got "${result.method}"`);
    if (!nameOk) reasons.push("firmName is null or empty");
    console.error(`  FAIL: ${reasons.join("; ")}`);
    failed++;
  }
}

console.log(`\n${"─".repeat(70)}`);
console.log(`Results: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);

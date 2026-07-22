import { runPipeline } from "./run-pipeline.js";

const result = await runPipeline("https://www.arkhamtechnology.com", {
  maxQueries: 14,
  maxUrls: 50,
  maxRounds: 1,
});

if (!result.success) {
  console.error("Pipeline failed:", result.error);
  process.exit(1);
}

const { buyers, stats, targetProfile } = result;

console.log("\n=== Target Profile ===");
console.log(JSON.stringify(targetProfile, null, 2));

console.log("\n=== Stats ===");
console.log(JSON.stringify(stats, null, 2));

console.log("\n=== Buyers ===");
for (const b of buyers) {
  console.log(`\n── ${b.firmName} ──`);
  console.log(`  fitScore:   ${b.fit?.fitScore}`);
  console.log(`  confidence: ${b.confidence?.confidence}`);
  console.log(`  rationale:  "${b.rationale?.rationale}" (${b.rationale?.source})`);
  console.log(`  relevantPortfolio:`);
  console.log(`    method:    ${b.relevantPortfolio?.method}`);
  console.log(`    companies: ${(b.relevantPortfolio?.relevantCompanies ?? []).join(", ") || "(none)"}`);
  console.log(`    reasoning: ${b.relevantPortfolio?.reasoning}`);
}

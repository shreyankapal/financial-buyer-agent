import { runPipeline } from "./run-pipeline.js";

const result = await runPipeline("https://www.arkhamtechnology.com", {
  maxQueries: 6,
  maxUrls: 25,
  maxRounds: 1,
});

if (!result.success) {
  console.error("Pipeline failed:", result.error);
  process.exit(1);
}

const { buyers, stats } = result;

console.log("\n=== Stats ===");
console.log(JSON.stringify(stats, null, 2));

console.log("\n=== Buyers ===");
for (const b of buyers) {
  console.log(
    `  ${b.firmName} | ${b.fit?.fitScore} | ${b.confidence?.confidence}`
  );
}

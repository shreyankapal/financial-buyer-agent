import { runPipeline } from "./run-pipeline.js";

const result = await runPipeline("https://www.servicetitan.com", { maxQueries: 3, maxUrls: 12, maxRounds: 1 });

if (!result.success) {
  console.error("Pipeline failed:", result.error);
  process.exit(1);
}

// Print full result but summarize the buyers array for readability
const { buyers, ...rest } = result;
const summary = buyers.map((b) => ({
  firmName: b.firmName,
  fitScore: b.fit.fitScore,
  confidence: b.confidence.confidence,
}));

console.log("\n=== Stats & Profile ===");
console.log(JSON.stringify(rest, null, 2));

console.log("\n=== Buyers (summarized) ===");
console.log(JSON.stringify(summary, null, 2));

import { runPipeline } from "./run-pipeline.js";

const result = await runPipeline("https://www.servicetitan.com", { maxQueries: 8, maxUrls: 40 });

if (!result.success) {
  console.error("Pipeline failed:", result.error);
  process.exit(1);
}

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

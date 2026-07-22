import { widenPipeline } from "./run-pipeline.js";

// Simulate a previousState that ended at currentMaxUrls: 60 (the buggy ceiling value)
// to confirm that widenPipeline now correctly targets 60 + 75 = 135, not 60.
const fakeState = {
  profile: {
    companyName: "Test Co",
    niche: "defense cybersecurity",
    sector: "Technology",
    products: [],
    searchKeywords: ["defense", "cybersecurity"],
    geography: "US",
  },
  allQueries: [
    "defense cybersecurity private equity",
    "defense tech PE firm portfolio",
  ],
  queriesUsedSoFar: 2, // all queries already used — Phase B won't run
  allFetchedUrls: Array.from({ length: 60 }, (_, i) => `https://firm-${i}.example.com`),
  pendingCandidateUrls: [],             // empty — Phase A won't run either
  allExtractions: [],
  currentMaxUrls: 60,
  searchOpts: {},
  totalUrlsFailed: 0,
  roundsRun: 1,
};

console.log("Testing widenPipeline ceiling fix...");
console.log(`Starting state: currentMaxUrls=${fakeState.currentMaxUrls}, allFetchedUrls.length=${fakeState.allFetchedUrls.length}`);
console.log(`Requesting +75 URLs → expected newMaxUrls: ${fakeState.currentMaxUrls + 75}`);
console.log("(No actual web calls will happen — pending and query lists are empty)\n");

const result = await widenPipeline(fakeState, 75);

console.log("\n=== Result ===");
console.log(`stats.requestedAdditional: ${result.stats.requestedAdditional}`);
console.log(`stats.actualAdditional:    ${result.stats.actualAdditional}`);
console.log(`_internalState.currentMaxUrls: ${result._internalState.currentMaxUrls}`);

const pass = result._internalState.currentMaxUrls === 135
  && result.stats.requestedAdditional === 75
  && result.stats.actualAdditional === 75;

console.log(`\n${pass ? "PASS" : "FAIL"} — newMaxUrls is ${result._internalState.currentMaxUrls} (expected 135)`);

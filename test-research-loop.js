import { shouldContinueResearch } from "./research-loop.js";

const scenarios = [
  {
    label: "Scenario 1: only 2 usable buyers, round 1, plenty of queries left → should continue",
    state: {
      buyers: [
        { fitScore: "Strong", confidence: "High" },
        { fitScore: "Moderate", confidence: "Medium" },
        { fitScore: "Weak", confidence: "Low" },
      ],
      stats: { queriesRun: 5, totalQueriesAvailable: 20, urlsFound: 10, maxUrls: 30 },
      targetCount: 35,
      currentRound: 1,
      maxRounds: 3,
    },
  },
  {
    label: "Scenario 2: 40 usable buyers, round 1 → should stop (target reached)",
    state: {
      buyers: Array.from({ length: 40 }, () => ({ fitScore: "Strong", confidence: "High" })),
      stats: { queriesRun: 10, totalQueriesAvailable: 20, urlsFound: 40, maxUrls: 60 },
      targetCount: 35,
      currentRound: 1,
      maxRounds: 3,
    },
  },
  {
    label: "Scenario 3: 5 usable buyers, currentRound equals maxRounds → should stop (max rounds reached)",
    state: {
      buyers: [
        { fitScore: "Strong", confidence: "High" },
        { fitScore: "Moderate", confidence: "Medium" },
        { fitScore: "Strong", confidence: "Low" },
        { fitScore: "Weak", confidence: "Low" },
        { fitScore: "Moderate", confidence: "High" },
        { fitScore: "Weak", confidence: "Low" },
      ],
      stats: { queriesRun: 8, totalQueriesAvailable: 20, urlsFound: 15, maxUrls: 30 },
      targetCount: 35,
      currentRound: 3,
      maxRounds: 3,
    },
  },
];

for (const { label, state } of scenarios) {
  console.log(`\n${label}`);
  console.log(shouldContinueResearch(state));
}

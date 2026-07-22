function shouldContinueResearch(state) {
  const {
    buyers = [],
    stats,
    targetCount = 35,
    currentRound,
    maxRounds = 3,
  } = state;

  const { queriesRun, totalQueriesAvailable, urlsFound, maxUrls } = stats;

  if (currentRound >= maxRounds) {
    return { continue: false, reason: "max rounds reached" };
  }

  if (queriesRun >= totalQueriesAvailable) {
    return { continue: false, reason: "no more queries available" };
  }

  const usableCount = buyers.filter(
    (b) => b.fitScore === "Strong" || b.fitScore === "Moderate"
  ).length;

  if (usableCount >= targetCount) {
    return { continue: false, reason: "target count reached" };
  }

  return {
    continue: true,
    reason: `only ${usableCount} usable buyers found, target is ${targetCount}`,
    nextMaxQueries: Math.min(queriesRun + 3, totalQueriesAvailable),
    nextMaxUrls: maxUrls + 15,
  };
}

export { shouldContinueResearch };

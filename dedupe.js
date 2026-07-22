function normalizeForMatch(name) {
  return name.trim().toLowerCase().replace(/[^a-z0-9 ]/g, "").replace(/\s+/g, " ");
}

// Two names are a substring match if the shorter (normalized) one is fully contained
// in the longer and has at least 2 words — prevents single generic words like
// "partners" or "capital" from triggering false positives.
function isSubstringMatch(normA, normB) {
  if (normA === normB) return false;
  const shorter = normA.length <= normB.length ? normA : normB;
  const longer = normA.length <= normB.length ? normB : normA;
  const wordCount = shorter.split(" ").filter(Boolean).length;
  return wordCount >= 2 && longer.includes(shorter);
}

function mergeSecondPass(group) {
  // Canonical name: most sourceUrls wins; shorter name on tie
  const byUrls = [...group].sort((a, b) => {
    const diff = (b.sourceUrls?.length ?? 0) - (a.sourceUrls?.length ?? 0);
    return diff !== 0 ? diff : a.firmName.length - b.firmName.length;
  });
  const firmName = byUrls[0].firmName;

  const bestSectorFocus = group.reduce((best, b) => {
    const s = b.sectorFocus ?? "";
    return s.length > best.length ? s : best;
  }, "");

  const portfolioCompanies = [
    ...new Set(
      group.flatMap((b) => b.portfolioCompanies ?? []).map((c) => c.trim()).filter(Boolean)
    ),
  ];

  const pickFirst = (field) =>
    group.map((b) => b[field]).find((v) => v && v !== "NOT FOUND") ?? "NOT FOUND";

  const sourceUrls = [...new Set(group.flatMap((b) => b.sourceUrls ?? []).filter(Boolean))];

  return {
    firmName,
    sectorFocus: bestSectorFocus || "NOT FOUND",
    portfolioCompanies,
    geography: pickFirst("geography"),
    investmentCriteria: pickFirst("investmentCriteria"),
    sourceUrls,
  };
}

export function dedupeBuyers(buyersArray) {
  const relevant = buyersArray.filter((b) => b.success && b.facts?.isRelevant);

  // First pass: exact case-insensitive grouping
  const exactGroups = new Map();
  for (const buyer of relevant) {
    const key = buyer.facts.firmName.trim().toLowerCase();
    if (!exactGroups.has(key)) exactGroups.set(key, []);
    exactGroups.get(key).push(buyer);
  }

  const firstPass = Array.from(exactGroups.values()).map((group) => {
    const bestSectorFocus = group.reduce((best, b) => {
      const current = b.facts.sectorFocus ?? "";
      return current.length > best.length ? current : best;
    }, "");

    const firmName =
      group.find((b) => b.facts.sectorFocus === bestSectorFocus)?.facts.firmName ??
      group[0].facts.firmName;

    const portfolioCompanies = [
      ...new Set(
        group.flatMap((b) => b.facts.portfolioCompanies ?? []).map((c) => c.trim()).filter(Boolean)
      ),
    ];

    const pick = (field) =>
      group.map((b) => b.facts[field]).find((v) => v && v !== "NOT FOUND") ?? "NOT FOUND";

    const sourceUrls = [...new Set(group.map((b) => b.sourceUrl).filter(Boolean))];

    return {
      firmName,
      sectorFocus: bestSectorFocus || "NOT FOUND",
      portfolioCompanies,
      geography: pick("geography"),
      investmentCriteria: pick("investmentCriteria"),
      sourceUrls,
    };
  });

  // Second pass: substring containment grouping via union-find
  const n = firstPass.length;
  const norms = firstPass.map((b) => normalizeForMatch(b.firmName));
  const parent = Array.from({ length: n }, (_, i) => i);

  function find(i) {
    while (parent[i] !== i) {
      parent[i] = parent[parent[i]];
      i = parent[i];
    }
    return i;
  }

  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      if (isSubstringMatch(norms[i], norms[j])) {
        parent[find(i)] = find(j);
      }
    }
  }

  const substringGroups = new Map();
  for (let i = 0; i < n; i++) {
    const root = find(i);
    if (!substringGroups.has(root)) substringGroups.set(root, []);
    substringGroups.get(root).push(firstPass[i]);
  }

  return Array.from(substringGroups.values()).map(mergeSecondPass);
}

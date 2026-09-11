// PE-boilerplate words that carry no signal as a firm's distinctive identifier.
// A name whose first word is in this set is skipped by the first-word duplicate flag.
export const GENERIC_PE_WORDS = new Set([
  "capital", "partners", "equity", "group", "management",
  "fund", "holdings", "investment", "investments", "ventures",
]);

export function normalizeForMatch(name) {
  return name.trim().toLowerCase().replace(/[^a-z0-9 ]/g, "").replace(/\s+/g, " ");
}

/**
 * Returns true if candidateName matches or closely matches targetCompanyName,
 * meaning the candidate is the target company itself and must never be accepted
 * as a buyer regardless of which discovery path surfaced it.
 *
 * Rules (applied after normalizeForMatch on both sides):
 *   1. Exact equality.
 *   2. Substring containment — the shorter normalized form is contained in the
 *      longer AND has ≥ 2 tokens. The 2-token guard is intentional: single-word
 *      company names (e.g. "ServiceTitan") are only caught by exact match, which
 *      is correct — "Titan" alone should not block unrelated firms.
 *
 * @param {string} candidateName  - extracted firm name to test
 * @param {string} targetCompanyName - profile.companyName of the sell-side target
 * @returns {boolean}
 */
export function isTargetCompany(candidateName, targetCompanyName) {
  if (!candidateName || !targetCompanyName) return false;
  const normC = normalizeForMatch(candidateName);
  const normT = normalizeForMatch(targetCompanyName);
  if (!normC || !normT) return false;
  if (normC === normT) return true;
  const shorter = normC.length <= normT.length ? normC : normT;
  const longer  = normC.length <= normT.length ? normT : normC;
  const tokenCount = shorter.trim().split(/\s+/).length;
  return tokenCount >= 2 && longer.includes(shorter);
}

// Two names are a substring match if the shorter (normalized) one is fully contained
// in the longer and has at least 2 words — prevents single generic words like
// "partners" or "capital" from triggering false positives.
export function isSubstringMatch(normA, normB) {
  if (normA === normB) return false;
  const shorter = normA.length <= normB.length ? normA : normB;
  const longer = normA.length <= normB.length ? normB : normA;
  const wordCount = shorter.split(" ").filter(Boolean).length;
  return wordCount >= 2 && longer.includes(shorter);
}

// Returns the normalized first word of a firm name if it is distinctive (not PE boilerplate),
// or null if the first word is generic and would produce too many false-positive flags.
function extractDistinctiveFirstWord(firmName) {
  const norm = normalizeForMatch(firmName);
  const first = norm.split(" ")[0];
  if (!first || GENERIC_PE_WORDS.has(first)) return null;
  return first;
}

// Fourth pass: flag pairs that weren't merged but share a distinctive first word.
// Attaches a possibleDuplicates array (firm names) to each buyer record.
// Returns new objects — does not mutate the input array.
function flagPossibleDuplicates(buyers) {
  const wordIndex = new Map();
  for (let i = 0; i < buyers.length; i++) {
    const word = extractDistinctiveFirstWord(buyers[i].firmName);
    if (!word) continue;
    if (!wordIndex.has(word)) wordIndex.set(word, []);
    wordIndex.get(word).push(i);
  }

  const result = buyers.map((b) => ({ ...b, possibleDuplicates: [] }));
  for (const indices of wordIndex.values()) {
    if (indices.length < 2) continue;
    for (const i of indices) {
      for (const j of indices) {
        if (i !== j) result[i].possibleDuplicates.push(buyers[j].firmName);
      }
    }
  }
  return result;
}

function extractDomain(url) {
  try {
    const hostname = new URL(url).hostname.toLowerCase();
    return hostname.startsWith("www.") ? hostname.slice(4) : hostname;
  } catch {
    return null;
  }
}

function mergeSecondPass(group) {
  // Canonical name: most sourceUrls wins; shorter name on tie
  const byUrls = [...group].sort((a, b) => {
    const diff = (b.sourceUrls?.length ?? 0) - (a.sourceUrls?.length ?? 0);
    return diff !== 0 ? diff : b.firmName.length - a.firmName.length;
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

  const secondPass = Array.from(substringGroups.values()).map(mergeSecondPass);

  // Third pass: merge records whose sourceUrls share the same domain, regardless of name similarity.
  // This catches cases like "K1" vs "K1 Investment Management" (both from k1.com) that slip past
  // the 2-word guard on the substring pass.
  const m = secondPass.length;
  const parent3 = Array.from({ length: m }, (_, i) => i);

  function find3(i) {
    while (parent3[i] !== i) {
      parent3[i] = parent3[parent3[i]];
      i = parent3[i];
    }
    return i;
  }

  const domainIndex = new Map();
  for (let i = 0; i < m; i++) {
    for (const url of secondPass[i].sourceUrls ?? []) {
      const domain = extractDomain(url);
      if (!domain) continue;
      if (!domainIndex.has(domain)) domainIndex.set(domain, []);
      domainIndex.get(domain).push(i);
    }
  }

  for (const indices of domainIndex.values()) {
    for (let k = 1; k < indices.length; k++) {
      parent3[find3(indices[0])] = find3(indices[k]);
    }
  }

  const domainGroups = new Map();
  for (let i = 0; i < m; i++) {
    const root = find3(i);
    if (!domainGroups.has(root)) domainGroups.set(root, []);
    domainGroups.get(root).push(secondPass[i]);
  }

  const thirdPass = Array.from(domainGroups.values()).map(mergeSecondPass);

  // Fourth pass: flag pairs that share a distinctive first word but weren't auto-merged.
  return flagPossibleDuplicates(thirdPass);
}

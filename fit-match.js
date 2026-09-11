const STOP_WORDS = new Set([
  "and", "for", "the", "with", "into", "from", "that", "this", "has",
  "are", "not", "but", "based", "over", "than", "their", "which",
]);

// Sector description words that are too generic to count as a meaningful match on their own.
// If every keyword match against a buyer's sectorFocus comes from this list, the match is
// treated as generic-only and the buyer must clear the portfolio-count threshold to score
// above Weak.
//
// "including" appears here because it leaks out of profile niche text ("...contractors
// including HVAC...") and then substring-matches buyers whose sector says "including
// Agriculture, Application Development...". It is not a sector signal.
export const GENERIC_SECTOR_WORDS = new Set([
  "service", "services", "management", "software",
  "technology", "technologies", "tech",
  "business", "businesses",
  "solutions", "including",
]);

// Minimum portfolio-company count required to score Moderate or above when the only
// basis for the match is generic sector words.
//
// Calibrated on the ServiceTitan run (2026-07): firms with meaningful PE track records
// show 20–100+ companies; genuinely thin or data-extraction failures show 0–4.
// 8 sits safely between those clusters. Tune upward if large-portfolio firms produce
// false-positives; tune downward if thin-portfolio firms are slipping through.
export const GENERIC_ONLY_PORTFOLIO_THRESHOLD = 8;

function extractKeywords(profile) {
  const text = [
    profile.niche ?? "",
    profile.sector ?? "",
    ...(profile.searchKeywords ?? []),
  ]
    .join(" ")
    .toLowerCase();

  return [
    ...new Set(
      text
        .split(/[\s,\/\-\(\)]+/)
        .filter((w) => w.length >= 4 && !STOP_WORDS.has(w))
    ),
  ];
}

function countMatches(keywords, text) {
  const lower = text.toLowerCase();
  return keywords.filter((kw) => lower.includes(kw)).length;
}

const GEO_GROUPS = [
  ["north america", "united states", "usa", "america", "canada", "mexico"],
  ["europe", "united kingdom", "britain", "england"],
];

function normalizeGeo(geo) {
  const lower = geo.toLowerCase();
  for (const group of GEO_GROUPS) {
    if (group.some((alias) => lower.includes(alias))) {
      return group[0];
    }
  }
  return lower;
}

function scoreGeographyFit(targetGeo, buyerGeo) {
  if (!targetGeo || targetGeo === "NOT FOUND" || !buyerGeo || buyerGeo === "NOT FOUND") {
    return "Unknown";
  }
  if (normalizeGeo(targetGeo) === normalizeGeo(buyerGeo)) {
    return "Match";
  }
  const targetWords = targetGeo.toLowerCase().split(/[\s,]+/).filter((w) => w.length >= 3);
  const buyerLower = buyerGeo.toLowerCase();
  return targetWords.some((w) => buyerLower.includes(w)) ? "Match" : "Mismatch";
}

export function fitMatch(targetProfile, buyer) {
  const keywords = extractKeywords(targetProfile);

  const sectorText = buyer.sectorFocus && buyer.sectorFocus !== "NOT FOUND"
    ? buyer.sectorFocus
    : "";
  const portfolioText = (buyer.portfolioCompanies ?? []).join(" ");

  // Use filter instead of countMatches so we have the actual matched keyword strings
  // to inspect for generic-only detection below.
  const matchedSectorKeywords = keywords.filter((kw) => sectorText.toLowerCase().includes(kw));
  const sectorMatches = matchedSectorKeywords.length;
  const portfolioMatches = countMatches(keywords, portfolioText);

  const sectorFit =
    sectorMatches >= 2 ? "Strong" : sectorMatches >= 1 ? "Partial" : "None";
  const portfolioFit = portfolioMatches >= 1 ? "Yes" : "No evidence";
  const geographyFit = scoreGeographyFit(targetProfile.geography, buyer.geography);

  let fitScore;
  if (sectorFit === "Strong" && portfolioFit === "Yes") {
    fitScore = "Strong";
  } else if (
    sectorFit === "Strong" ||
    (sectorFit === "Partial" && portfolioFit === "Yes")
  ) {
    fitScore = "Moderate";
  } else {
    fitScore = "Weak";
  }

  // Downgrade: if every sector keyword match is a generic word AND the buyer has a
  // thin portfolio, the match carries no real signal — cap at Weak.
  const isGenericOnlyMatch =
    sectorMatches > 0 && matchedSectorKeywords.every((kw) => GENERIC_SECTOR_WORDS.has(kw));
  const portfolioCount = (buyer.portfolioCompanies ?? []).filter(Boolean).length;
  const genericDowngraded =
    isGenericOnlyMatch && portfolioCount < GENERIC_ONLY_PORTFOLIO_THRESHOLD && fitScore !== "Weak";
  if (genericDowngraded) fitScore = "Weak";

  const noteParts = [];

  if (sectorFit === "Strong") {
    noteParts.push(`sector focus aligns well with target niche (${sectorMatches} keyword matches)`);
  } else if (sectorFit === "Partial") {
    noteParts.push("partial sector overlap with target niche");
  } else {
    noteParts.push("no sector focus match found");
  }

  if (portfolioFit === "Yes") {
    noteParts.push("portfolio companies show topical relevance");
  } else {
    noteParts.push("no portfolio evidence of relevant companies");
  }

  if (geographyFit === "Match") {
    noteParts.push(`geography aligns (${buyer.geography})`);
  } else if (geographyFit === "Mismatch") {
    noteParts.push(`geography may not align (buyer: ${buyer.geography})`);
  } else {
    noteParts.push("geography unclear");
  }

  if (genericDowngraded) {
    noteParts.push(
      `generic-only keyword match with thin portfolio (${portfolioCount} ${portfolioCount === 1 ? "company" : "companies"} listed); score reduced to Weak`
    );
  }

  const notes =
    noteParts[0].charAt(0).toUpperCase() +
    noteParts[0].slice(1) +
    "; " +
    noteParts.slice(1).join("; ") +
    ".";

  return { sectorFit, geographyFit, portfolioFit, fitScore, notes };
}

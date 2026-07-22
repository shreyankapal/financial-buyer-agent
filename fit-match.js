const STOP_WORDS = new Set([
  "and", "for", "the", "with", "into", "from", "that", "this", "has",
  "are", "not", "but", "based", "over", "than", "their", "which",
]);

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

  const sectorMatches = countMatches(keywords, sectorText);
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

  const notes =
    noteParts[0].charAt(0).toUpperCase() +
    noteParts[0].slice(1) +
    "; " +
    noteParts.slice(1).join("; ") +
    ".";

  return { sectorFit, geographyFit, portfolioFit, fitScore, notes };
}

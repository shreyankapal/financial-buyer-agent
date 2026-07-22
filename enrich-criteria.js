import { webSearch } from "./web-search.js";
import { extractFacts } from "./extract-facts.js";

const STRATEGY_KEYWORDS = [
  "strategy", "approach", "criteria", "thesis",
  "sector", "focus", "about", "investment",
];

function rootDomain(sourceUrls) {
  for (const url of sourceUrls ?? []) {
    try {
      return new URL(url).origin;
    } catch {}
  }
  return null;
}

function isStrategyPage(url, title, firmDomain) {
  try {
    const parsed = new URL(url);
    if (parsed.origin !== firmDomain) return false;
    const combined = `${parsed.pathname} ${title ?? ""}`.toLowerCase();
    return STRATEGY_KEYWORDS.some((kw) => combined.includes(kw));
  } catch {
    return false;
  }
}

export async function enrichInvestmentCriteria(buyer) {
  try {
    if (buyer.investmentCriteria && buyer.investmentCriteria !== "NOT FOUND") {
      return buyer;
    }

    const firmDomain = rootDomain(buyer.sourceUrls);
    if (!firmDomain) return buyer;

    const query = `${buyer.firmName} investment criteria strategy`;
    const results = await webSearch(query);

    const candidate =
      results.find((r) => isStrategyPage(r.url, r.title, firmDomain)) ??
      results.find((r) => { try { return new URL(r.url).origin === firmDomain; } catch { return false; } });
    if (!candidate) return buyer;

    const extraction = await extractFacts(candidate.url);
    if (!extraction.success || !extraction.facts?.isRelevant) return buyer;
    if (!extraction.facts.investmentCriteria || extraction.facts.investmentCriteria === "NOT FOUND") return buyer;

    return {
      ...buyer,
      investmentCriteria: extraction.facts.investmentCriteria,
      sourceUrls: [...new Set([...(buyer.sourceUrls ?? []), candidate.url])],
    };
  } catch {
    return buyer;
  }
}

import "dotenv/config";
import Anthropic from "@anthropic-ai/sdk";
import { createHash } from "crypto";
import { getOrFetch } from "./cache.js";
import { normalizeForMatch } from "./dedupe.js";

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const STOP_WORDS = new Set([
  "and", "for", "the", "with", "into", "from", "that", "this", "has",
  "are", "not", "but", "based", "over", "than", "their", "which",
  "platform", "company", "companies", "service", "services",
]);

function extractTargetKeywords(targetProfile) {
  const text = [
    targetProfile.niche ?? "",
    targetProfile.sector ?? "",
    ...(targetProfile.products ?? []),
    targetProfile.customers ?? "",
    ...(targetProfile.searchKeywords ?? []),
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

function keywordMatchPortfolio(keywords, portfolioCompanies) {
  const matched = [];
  const matchReasons = [];

  for (const company of portfolioCompanies) {
    const lower = company.toLowerCase();
    const hits = keywords.filter((kw) => lower.includes(kw));
    if (hits.length > 0) {
      matched.push(company);
      matchReasons.push(`"${company}" matched on: ${hits.join(", ")}`);
    }
    if (matched.length >= 3) break;
  }

  return { matched, matchReasons };
}

function portfolioHash(portfolioCompanies) {
  const sorted = [...portfolioCompanies].sort().join("|");
  return createHash("sha256").update(sorted).digest("hex").slice(0, 16);
}

export async function findRelevantPortfolio(targetProfile, buyer) {
  try {
    const portfolioCompanies = buyer.portfolioCompanies ?? [];

    if (portfolioCompanies.length === 0) {
      return { relevantCompanies: [], method: "none", reasoning: "No portfolio companies found" };
    }

    // Filter out the target company itself to avoid circular self-matches.
    // isSubstringMatch requires wordCount >= 2, which misses single-word names like "ServiceTitan"
    // appearing as "ServiceTitan Inc." in a portfolio, so we use a direct substring check instead.
    const normTargetName = normalizeForMatch(targetProfile.companyName ?? "");
    const filteredPortfolio = normTargetName
      ? portfolioCompanies.filter((c) => {
          const normC = normalizeForMatch(c);
          return (
            normC !== normTargetName &&
            !normC.includes(normTargetName) &&
            !normTargetName.includes(normC)
          );
        })
      : portfolioCompanies;

    if (filteredPortfolio.length === 0) {
      return { relevantCompanies: [], method: "none", reasoning: "No portfolio companies found after excluding target company" };
    }

    // Pass 1: keyword-based (free) — runs for all buyers with a non-empty portfolio
    const keywords = extractTargetKeywords(targetProfile);
    const { matched, matchReasons } = keywordMatchPortfolio(keywords, filteredPortfolio);

    if (matched.length > 0) {
      return {
        relevantCompanies: matched,
        method: "keyword",
        reasoning: matchReasons.join("; "),
      };
    }

    // Pass 2: LLM fallback (cached per firm + portfolio fingerprint) — Strong/Moderate only
    const fitScore = buyer.fit?.fitScore;
    if (fitScore !== "Strong" && fitScore !== "Moderate") {
      return {
        relevantCompanies: [],
        method: "skipped",
        reasoning: "No keyword match found; LLM pass skipped for Weak-fit buyer",
      };
    }
    const cacheKey = `relevant-portfolio:${buyer.firmName}:${portfolioHash(filteredPortfolio)}`;

    const llmResult = await getOrFetch(cacheKey, async () => {
      const prompt =
        `Target company niche: "${targetProfile.niche}"\n` +
        `Target sector: "${targetProfile.sector}"\n\n` +
        `Portfolio companies to evaluate:\n` +
        filteredPortfolio.map((c, i) => `${i + 1}. ${c}`).join("\n") +
        `\n\nWhich of these portfolio companies (if any) are relevant comparables to the target — ` +
        `similar sector, similar customer base, similar product type, or same broad category? ` +
        `Relevance can be broad (same general industry) or specific (near-identical business). ` +
        `Return up to 3 relevant company names with a one-line reason each, ` +
        `or an empty list if genuinely none are relevant.\n\n` +
        `Respond ONLY with valid JSON in this exact shape:\n` +
        `{ "relevantCompanies": [{"name": "...", "reason": "..."}], "anyRelevant": true }`;

      const response = await client.messages.create({
        model: "claude-sonnet-4-6",
        max_tokens: 512,
        messages: [{ role: "user", content: prompt }],
      });

      let raw = response.content[0].text.trim();
      raw = raw.replace(/^```(?:json)?\n?/, "").replace(/\n?```$/, "").trim();
      return JSON.parse(raw);
    });

    if (!llmResult.anyRelevant || llmResult.relevantCompanies.length === 0) {
      return {
        relevantCompanies: [],
        method: "llm_checked",
        reasoning: "No relevant portfolio companies identified",
      };
    }

    return {
      relevantCompanies: llmResult.relevantCompanies.map((c) => c.name),
      method: "llm",
      reasoning: llmResult.relevantCompanies.map((c) => `${c.name}: ${c.reason}`).join("; "),
    };
  } catch (err) {
    return { relevantCompanies: [], method: "error", reasoning: err.message };
  }
}

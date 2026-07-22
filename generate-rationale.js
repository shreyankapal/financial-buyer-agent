import "dotenv/config";
import Anthropic from "@anthropic-ai/sdk";
import { createHash } from "crypto";
import { getOrFetch } from "./cache.js";

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const WORD_LIMIT = 10;

function wordCount(str) {
  return str.trim().split(/\s+/).length;
}

// Truncate to at most WORD_LIMIT words, keeping whole words only.
function capWords(str) {
  const words = str.trim().split(/\s+/);
  if (words.length <= WORD_LIMIT) return str.trim();
  return words.slice(0, WORD_LIMIT).join(" ");
}

function buildDeterministicRationale(buyer) {
  const relevantCompanies = buyer.relevantPortfolio?.relevantCompanies ?? [];
  const sectorFit = buyer.fit?.sectorFit;
  const portfolioCount = (buyer.portfolioCompanies ?? []).length;
  const hasCriteria =
    buyer.investmentCriteria &&
    buyer.investmentCriteria !== "NOT FOUND";

  const parts = [];

  // Primary signal
  if (relevantCompanies.length > 0) {
    parts.push(`Owns ${relevantCompanies[0]}, a direct comparable`);
  } else if (sectorFit === "Strong") {
    parts.push("Strong sector thesis match");
  } else if (sectorFit === "Partial") {
    parts.push("Partial sector overlap");
  } else if (portfolioCount >= 8) {
    parts.push("Active acquirer in space");
  } else {
    parts.push("Limited signal available");
  }

  // Secondary signal (investment criteria) — only append if combined phrase stays within limit
  if (hasCriteria && parts.length < 2) {
    const candidate = parts[0] + "; fits stated check size";
    if (wordCount(candidate) <= WORD_LIMIT) {
      parts[0] = candidate;
    }
  }

  return capWords(parts[0]);
}

function factsHash(buyer) {
  const facts = JSON.stringify({
    firmName: buyer.firmName,
    relevantCompanies: (buyer.relevantPortfolio?.relevantCompanies ?? []).slice().sort(),
    sectorFit: buyer.fit?.sectorFit,
    investmentCriteria: buyer.investmentCriteria,
  });
  return createHash("sha256").update(facts).digest("hex").slice(0, 16);
}

export async function generateRationale(targetProfile, buyer) {
  const deterministic = buildDeterministicRationale(buyer);

  // Moderate and Weak buyers skip the LLM entirely
  if (buyer.fit?.fitScore !== "Strong") {
    return { rationale: deterministic, source: "deterministic" };
  }

  const cacheKey = `rationale:${buyer.firmName}:${factsHash(buyer)}`;

  try {
    const relevantCompanies = buyer.relevantPortfolio?.relevantCompanies ?? [];
    const facts = [
      relevantCompanies.length > 0
        ? `Relevant portfolio companies: ${relevantCompanies.join(", ")}`
        : null,
      buyer.fit?.sectorFit
        ? `Sector fit: ${buyer.fit.sectorFit}`
        : null,
      buyer.investmentCriteria && buyer.investmentCriteria !== "NOT FOUND"
        ? `Investment criteria: ${buyer.investmentCriteria}`
        : null,
    ]
      .filter(Boolean)
      .join(". ");

    const polished = await getOrFetch(cacheKey, async () => {
      const prompt =
        `Rewrite this buyer rationale as a single crisp phrase, maximum 10 words, ` +
        `no fluff, suitable for a spreadsheet column. ` +
        `Base it only on these facts: ${facts}. ` +
        `Do not introduce new claims not in the facts. ` +
        `Current draft: "${deterministic}". ` +
        `Respond with plain text only — no quotes, no punctuation at the end.`;

      const response = await client.messages.create({
        model: "claude-sonnet-4-6",
        max_tokens: 64,
        messages: [{ role: "user", content: prompt }],
      });

      return response.content[0].text.trim().replace(/^"|"$/g, "");
    });

    // Validate: non-empty and within word limit
    if (!polished || wordCount(polished) > 12) {
      return { rationale: deterministic, source: "deterministic" };
    }

    return { rationale: capWords(polished), source: "llm" };
  } catch {
    return { rationale: deterministic, source: "deterministic" };
  }
}

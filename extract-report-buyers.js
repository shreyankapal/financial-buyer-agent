import "dotenv/config";
import { createHash } from "crypto";
import Anthropic from "@anthropic-ai/sdk";
import { getOrFetch } from "./cache.js";

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// Section headings that precede buyer-list content in M&A industry reports.
// Ordered most-specific to least-specific so the first match is the best signal.
const BUYER_SECTION_PATTERNS = [
  /most\s+active\s+(?:buyers?|acquirers?)/i,
  /active\s+buyers?\b/i,
  /notable\s+acquirers?\b/i,
  /buyer\s+universe\b/i,
  /acquirer\s+landscape\b/i,
  /top\s+acquirers?\b/i,
  /key\s+(?:buyers?|acquirers?)\b/i,
  /strategic\s+buyers?\b/i,
  /financial\s+(?:sponsors?|buyers?)\b/i,
];

// Report publishers — exclude from extracted buyer lists.
const PUBLISHER_NAMES = ["houlihan lokey", "capstone partners", "sellside advisor"];

function findBuyerSection(text) {
  for (const pattern of BUYER_SECTION_PATTERNS) {
    const match = pattern.exec(text);
    if (match) {
      return {
        heading: match[0],
        window: text.slice(match.index, match.index + 3_000),
      };
    }
  }
  return null;
}

function parseJsonBuyers(raw) {
  try {
    const cleaned = raw.replace(/^```(?:json)?\n?/, "").replace(/\n?```$/, "").trim();
    const parsed = JSON.parse(cleaned);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((n) => typeof n === "string" && n.length > 1)
      .filter((n) => !PUBLISHER_NAMES.some((p) => n.toLowerCase().includes(p)));
  } catch {
    return [];
  }
}

async function llmExtractBuyers(text, focused) {
  const system = focused
    ? `You are analyzing a buyer-list section from an M&A industry report.
Extract every PE firm and strategic/corporate acquirer named as a buyer of companies.
Exclude the report publishers (Houlihan Lokey, Capstone Partners) and any "Sellside Advisor" placeholder text.
Return ONLY a JSON array of unique firm names. No explanation. If none, return [].`
    : `You are analyzing text from an M&A industry report.
Extract all PE firms and strategic acquirers that appear as BUYERS (acquirers of companies) in transactions described.
Look for: "Most Active Buyers" or "Buyer Universe" sections, transaction tables with acquirer columns, deal descriptions naming an acquirer.
Exclude: investment banks, law firms, M&A advisors, "Houlihan Lokey", "Capstone Partners", "Sellside Advisor".
Return ONLY a JSON array of unique firm names. No explanation. If none, return [].`;

  const response = await client.messages.create({
    model: "claude-haiku-4-5-20251001",
    max_tokens: 512,
    system,
    messages: [{ role: "user", content: text.slice(0, 12_000) }],
  });

  return parseJsonBuyers(response.content[0].text);
}

/**
 * Extract a list of buyer/acquirer firm names from an industry report's text.
 * Strategy: look for a structured "Active Buyers" or "Buyer Universe" section first
 * (regex heading detection → targeted LLM on that window); if none found, fall back
 * to LLM extraction over the full report text.
 * Cached by a hash of the first 5 000 characters of the text.
 *
 * @param {string} text - Full text of the fetched report
 * @returns {Promise<{ buyers: string[], method: "structured"|"llm", heading: string|null }>}
 */
export async function extractReportBuyers(text) {
  const hash = createHash("sha256").update(text.slice(0, 5_000)).digest("hex").slice(0, 24);
  const cacheKey = `extract-report-buyers:${hash}`;

  return getOrFetch(cacheKey, async () => {
    const section = findBuyerSection(text);

    if (section) {
      const buyers = await llmExtractBuyers(section.window, true);
      if (buyers.length > 0) {
        return { buyers, method: "structured", heading: section.heading };
      }
    }

    const buyers = await llmExtractBuyers(text, false);
    return { buyers, method: "llm", heading: null };
  });
}

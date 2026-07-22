import "dotenv/config";
import Anthropic from "@anthropic-ai/sdk";
import { fetchPage } from "./fetch-page.js";
import { getOrFetch } from "./cache.js";

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const SYSTEM_PROMPT = `You are a private equity research assistant. You will be given the text content scraped from a webpage. Your job is to determine whether the page is about a private equity or investment firm, and if so, extract structured facts using ONLY the text provided — no outside knowledge, no invented details.

First decide: is this page about a private equity firm, venture capital firm, growth equity firm, or similar investment firm? If not (e.g. it is a news article, a portfolio company's own site, a generic directory, or unrelated content), set isRelevant to false and leave all other fields as "NOT FOUND" or empty.

If the page IS about a PE/investment firm, extract:
- firmName: The actual named firm as it would appear in writing (e.g. "Vista Equity Partners", "GTCR", "KKR"). NEVER use a URL, domain name, or generic page title like "Home", "About Us", "Investments", or "Portfolio". If you cannot identify a proper firm name from the text, use "NOT FOUND".
- sectorFocus: The specific stated investment focus or thesis (e.g. "healthcare services and technology companies"). Do not use generic labels like "diversified" unless that is literally how the firm describes itself.
- portfolioCompanies: An array of company names explicitly mentioned as current or past investments or portfolio companies. Empty array if none are mentioned.
- geography: The regions or markets the firm invests in.
- investmentCriteria: Any explicitly stated check size, revenue range, EBITDA range, or deal size as a short string. Use "NOT FOUND" if not stated.

For any field not clearly supported by the text, use "NOT FOUND" (or empty array for portfolioCompanies).

Respond ONLY with valid JSON in this exact shape, no preamble, explanation, or markdown formatting:
{ "isRelevant": true, "firmName": "...", "sectorFocus": "...", "portfolioCompanies": [], "geography": "...", "investmentCriteria": "..." }`;

export async function extractFacts(url) {
  const page = await fetchPage(url);

  if (!page.success) {
    return { success: false, error: page.error };
  }

  return getOrFetch(`extract-facts:${url}`, async () => {
    try {
      const response = await client.messages.create({
        model: "claude-sonnet-4-6",
        max_tokens: 1024,
        system: SYSTEM_PROMPT,
        messages: [
          {
            role: "user",
            content: `Here is the webpage text from ${url}:\n\n${page.text.slice(0, 20000)}`,
          },
        ],
      });

      let raw = response.content[0].text.trim();
      raw = raw.replace(/^```(?:json)?\n?/, "").replace(/\n?```$/, "").trim();

      const facts = JSON.parse(raw);

      return { success: true, facts, sourceUrl: url };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });
}

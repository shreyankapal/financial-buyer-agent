import "dotenv/config";
import Anthropic from "@anthropic-ai/sdk";
import { fetchPage } from "./fetch-page.js";
import { getOrFetch } from "./cache.js";

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const SYSTEM_PROMPT = `You are a private equity research assistant. You will be given the text content scraped from a webpage. Your job is to determine whether the page is about a private equity or buyout firm that DIRECTLY acquires and holds controlling stakes in companies, and if so, extract structured facts using ONLY the text provided — no outside knowledge, no invented details.

STEP 1 — DISQUALIFY ADVISORS AND INTERMEDIARIES FIRST:
Mark isRelevant: false if the entity is primarily an advisory firm, investment bank, brokerage, or M&A intermediary — i.e. it helps OTHER companies buy, sell, or raise capital, but does not acquire and hold companies with its own capital. Disqualifying signals include:
- "advisory," "M&A advisory," "buy-side advisory," "sell-side advisory," "buy-side acquisition search"
- "helping founders/sellers/owners sell," "plan your exit," "sell your company"
- "connecting buyers and sellers," "we represent clients in transactions," "we represent buyers"
- "investment banking," "business brokerage," "deal intermediary"
- "we work with buyers on your behalf," "find the right buyer for you"
- "earn fees," "transaction fees," "success fee" (intermediaries earn fees; PE firms deploy capital)
If these signals are present without clear evidence of the firm's OWN portfolio or capital deployment, set isRelevant: false.

STEP 1B — DISQUALIFY VENTURE CAPITAL AND MINORITY INVESTORS:
Also mark isRelevant: false if the entity is primarily a venture capital firm or minority investor. VC firms provide capital to startups but do not pursue control acquisitions of established businesses — they are not M&A financial buyers in the sense relevant here. Disqualifying signals:
- Primary self-description as "venture capital," "VC fund," or "venture firm"
- Investment focus explicitly on "seed," "pre-seed," "early-stage," or "startup" companies
- Minority stake language: "we take minority stakes," "minority equity positions," "minority growth investments"
- Portfolio described primarily as startups that received funding rounds, not companies that were acquired

CRITICAL — DO NOT disqualify a firm based on these signals alone:
- A firm name containing "Ventures" or "Venture" in it is NOT sufficient to disqualify — many PE/buyout firms use "Ventures" in their name
- If the page uses language like "we acquire," "control acquisition," "majority stake," "buy-and-build," "platform acquisition," or "we own our portfolio companies," those are PE/buyout signals that OVERRIDE a "Ventures" name
- "Growth equity" is not the same as venture capital — a growth equity firm that pursues majority/control deals qualifies
- Backing founders is not disqualifying if the firm acquires a controlling stake in the process

STEP 2 — REQUIRE EVIDENCE OF DIRECT CONTROL INVESTING:
To be marked isRelevant: true, the page must show evidence that the entity directly acquires or takes controlling/majority ownership of companies using its OWN capital. Positive signals include:
- "we acquire," "we buy," "control acquisition," "majority stake," "controlling interest"
- "our portfolio companies," "our portfolio," "our holdings," "our platform companies"
- "buy-and-build," "platform and add-on acquisitions," "roll-up strategy"
- "we partner with management teams as owners," "we back management buyouts"
- "our fund," "we deploy capital," "leveraged buyout," "growth equity with control"
Merely having a portfolio does not qualify: VC firms also have portfolios. Look for control/majority/acquisition language.

STEP 3 — AMBIGUOUS HYBRID FIRMS:
If a page includes BOTH advisory language AND evidence of the firm's own portfolio/fund, mark isRelevant: true only if there is clear, explicit evidence of the firm's own portfolio companies or direct capital deployment. Advisory language alone, without portfolio evidence, disqualifies.

STEP 4 — OTHER DISQUALIFYING PAGE TYPES:
Also set isRelevant: false for: news articles, a portfolio company's own site, generic directories, job boards, or unrelated content.

If the page IS about a qualifying PE/investment firm (passed all steps above), extract:
- firmName: The actual named firm as it would appear in writing (e.g. "Vista Equity Partners", "GTCR", "KKR"). NEVER use a URL, domain name, or generic page title like "Home", "About Us", "Investments", or "Portfolio". If you cannot identify a proper firm name from the text, use "NOT FOUND".
- sectorFocus: The specific stated investment focus or thesis (e.g. "healthcare services and technology companies"). Do not use generic labels like "diversified" unless that is literally how the firm describes itself.
- portfolioCompanies: An array of company names explicitly mentioned as current or past investments or portfolio companies. Empty array if none are mentioned.
- geography: The regions or markets the firm invests in.
- investmentCriteria: Any explicitly stated check size, revenue range, EBITDA range, or deal size as a short string. Use "NOT FOUND" if not stated.

For any field not clearly supported by the text, use "NOT FOUND" (or empty array for portfolioCompanies).

Respond ONLY with valid JSON in this exact shape, no preamble, explanation, or markdown formatting:
{ "isRelevant": true, "firmName": "...", "sectorFocus": "...", "portfolioCompanies": [], "geography": "...", "investmentCriteria": "..." }`;

// Calls Claude with the given page text. Results are cached by URL so repeated
// calls with the same URL are free. Exported so tests can inject fixture text
// without going through fetchPage.
export async function extractFactsFromText(url, text) {
  return getOrFetch(`extract-facts:${url}`, async () => {
    try {
      const response = await client.messages.create({
        model: "claude-sonnet-4-6",
        max_tokens: 1024,
        system: SYSTEM_PROMPT,
        messages: [
          {
            role: "user",
            content: `Here is the webpage text from ${url}:\n\n${text.slice(0, 20000)}`,
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

export async function extractFacts(url) {
  const page = await fetchPage(url);
  if (!page.success) return { success: false, error: page.error };
  return extractFactsFromText(url, page.text);
}

// Like extractFacts but also returns _pageText so callers can inspect the raw
// content (e.g. to detect listicle pages) without a second fetchPage call.
export async function extractFactsWithPage(url) {
  const page = await fetchPage(url);
  if (!page.success) return { success: false, error: page.error };
  const result = await extractFactsFromText(url, page.text);
  return { ...result, _pageText: page.text };
}

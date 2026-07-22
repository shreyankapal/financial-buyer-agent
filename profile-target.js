import "dotenv/config";
import Anthropic from "@anthropic-ai/sdk";
import { fetchPage } from "./fetch-page.js";
import { webSearch } from "./web-search.js";
import { getOrFetch } from "./cache.js";

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const SYSTEM_PROMPT = `You are a company profiling assistant. You will be given the text content scraped from a company's website. Your job is to extract structured information about the company using ONLY the text provided — do not use outside knowledge or invent anything not supported by the text.

For any field that is not clearly supported by the provided text, use the string "NOT FOUND".

Respond ONLY with valid JSON in this exact shape, with no preamble, explanation, or markdown formatting:
{
  "companyName": "...",
  "niche": "...",
  "sector": "...",
  "products": ["...", "..."],
  "customers": "...",
  "geography": "...",
  "searchKeywords": ["...", "...", "...", "...", "...", "..."]
}

Field guidance:
- niche: Be highly specific (e.g. "cloud-based inventory management software for mid-size auto parts distributors"), NOT a broad label like "software company"
- products: List distinct products or service lines
- geography: A plain region or country name only — e.g. "United States", "North America", "Europe", "Global". No parenthetical reasoning, caveats, or explanatory text. If you cannot determine geography with confidence, use "NOT FOUND".
- searchKeywords: 5-8 keywords that would help find relevant PE firms or strategic acquirers`;

const SNIPPET_FALLBACK_PROMPT = `You are a company profiling assistant. The company's website could not be fetched directly. You are given search result snippets about the company instead — these are brief and may be incomplete.

Be extremely conservative: only populate a field if it is clearly and unambiguously supported by the snippets. For anything not clearly stated, use "NOT FOUND". It is better to return "NOT FOUND" than to guess.

Respond ONLY with valid JSON in this exact shape, with no preamble, explanation, or markdown formatting:
{
  "companyName": "...",
  "niche": "...",
  "sector": "...",
  "products": ["...", "..."],
  "customers": "...",
  "geography": "...",
  "searchKeywords": ["...", "...", "...", "...", "...", "..."]
}

Field guidance:
- niche: Be highly specific if the snippets support it; otherwise "NOT FOUND"
- products: Only list products or services explicitly named in the snippets
- geography: A plain region or country name only. "NOT FOUND" if not clearly stated.
- searchKeywords: 5-8 keywords that would help find relevant PE firms or strategic acquirers`;

async function buildProfileFromPage(url, pageText) {
  return getOrFetch(`profile-target:${url}`, async () => {
    try {
      const response = await client.messages.create({
        model: "claude-sonnet-4-6",
        max_tokens: 1024,
        system: SYSTEM_PROMPT,
        messages: [
          {
            role: "user",
            content: `Here is the website text for ${url}:\n\n${pageText.slice(0, 20000)}`,
          },
        ],
      });

      let raw = response.content[0].text.trim();
      raw = raw.replace(/^```(?:json)?\n?/, "").replace(/\n?```$/, "").trim();

      const profile = JSON.parse(raw);
      profile.profileSource = "full_page";
      return { success: true, profile, sourceUrl: url };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });
}

async function buildProfileFromSnippets(url, snippets) {
  return getOrFetch(`profile-target:${url}`, async () => {
    try {
      const snippetText = snippets
        .slice(0, 4)
        .map((r) => `Title: ${r.title}\nSnippet: ${r.snippet}`)
        .join("\n\n");

      const response = await client.messages.create({
        model: "claude-sonnet-4-6",
        max_tokens: 1024,
        system: SNIPPET_FALLBACK_PROMPT,
        messages: [
          {
            role: "user",
            content: `Company website: ${url}\n\nSearch snippets:\n${snippetText}`,
          },
        ],
      });

      let raw = response.content[0].text.trim();
      raw = raw.replace(/^```(?:json)?\n?/, "").replace(/\n?```$/, "").trim();

      const profile = JSON.parse(raw);
      profile.profileSource = "search_snippet_fallback";
      return { success: true, profile, sourceUrl: url };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });
}

export async function profileTarget(url) {
  const page = await fetchPage(url);

  if (page.success) {
    return buildProfileFromPage(url, page.text);
  }

  // Page fetch failed — try search snippet fallback
  console.log(`  fetchPage failed (${page.error}), trying search snippet fallback...`);
  const hostname = new URL(url).hostname.replace(/^www\./, "");
  const snippets = await webSearch(hostname);

  if (!snippets || snippets.length === 0) {
    return { success: false, error: page.error };
  }

  // Only use snippets whose source URL actually belongs to the target domain
  const matchingSnippets = snippets.filter((r) => r.url && r.url.includes(hostname));

  if (matchingSnippets.length === 0) {
    console.log(`  No search results matched target hostname (${hostname}) — aborting fallback`);
    return {
      success: false,
      error: "could not verify any search results correspond to the target domain",
    };
  }

  console.log(`  Using ${matchingSnippets.length} of ${snippets.length} snippets that match ${hostname}`);
  return buildProfileFromSnippets(url, matchingSnippets);
}

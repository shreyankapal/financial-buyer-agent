import "dotenv/config";
import { tavily } from "@tavily/core";
import { getOrFetch } from "./cache.js";

const client = tavily({ apiKey: process.env.TAVILY_API_KEY });

const DEFAULT_EXCLUDE_DOMAINS = [
  "techcrunch.com",
  "prnewswire.com",
  "businesswire.com",
  "axios.com",
  "reuters.com",
  "bloomberg.com",
  "forbes.com",
];

export async function webSearch(query, options = {}) {
  const excludeDomains = options.excludeDomains ?? DEFAULT_EXCLUDE_DOMAINS;
  const excKey = excludeDomains.length
    ? `:excl:${[...excludeDomains].sort().join(",")}`
    : "";
  return getOrFetch(`web-search:${query}${excKey}`, async () => {
    try {
      const response = await client.search(query, {
        maxResults: 8,
        searchDepth: "basic",
        excludeDomains,
      });

      const fetchedAt = new Date().toISOString();

      return response.results.map((r) => ({
        title: r.title,
        url: r.url,
        snippet: r.content,
        sourceProvider: "tavily",
        query,
        fetchedAt,
      }));
    } catch (err) {
      console.error("webSearch error:", err.message);
      return [];
    }
  });
}

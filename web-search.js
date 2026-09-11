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

// Trade-press domains used by Bucket D deal-announcement searches.
// Kept separate from DEFAULT_EXCLUDE_DOMAINS — do not merge.
export const DEAL_PRESS_DOMAINS = [
  "pehub.com",
  "themiddlemarket.com",
  "businesswire.com",
  "prnewswire.com",
  "globenewswire.com",
  "pitchbook.com",
  "axios.com",
];

export async function webSearch(query, options = {}) {
  // Opt-in overrides — only applied when the caller explicitly provides them.
  const { topic, days, includeDomains } = options;

  // When includeDomains is provided the caller is scoping to specific sources,
  // so applying the default exclude list against those same domains makes no
  // sense. Fall back to an empty exclude list in that case.
  const excludeDomains = includeDomains?.length
    ? []
    : (options.excludeDomains ?? DEFAULT_EXCLUDE_DOMAINS);

  // Build a stable cache key that captures every axis that affects results.
  const excKey = excludeDomains.length
    ? `:excl:${[...excludeDomains].sort().join(",")}`
    : "";
  const inclKey = includeDomains?.length
    ? `:incl:${[...includeDomains].sort().join(",")}`
    : "";
  const topicKey = topic ? `:topic:${topic}` : "";
  const daysKey = days != null ? `:days:${days}` : "";

  const cacheKey = `web-search:${query}${excKey}${inclKey}${topicKey}${daysKey}`;

  return getOrFetch(cacheKey, async () => {
    try {
      const searchParams = {
        maxResults: 8,
        searchDepth: "basic",
        excludeDomains,
      };

      if (includeDomains?.length) searchParams.includeDomains = includeDomains;
      if (topic) searchParams.topic = topic;
      if (days != null) searchParams.days = days;

      const response = await client.search(query, searchParams);

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

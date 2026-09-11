import "dotenv/config";
import { tavily } from "@tavily/core";
import { getOrFetch } from "./cache.js";
import { fetchPage } from "./fetch-page.js";

const client = tavily({ apiKey: process.env.TAVILY_API_KEY });

/**
 * Fetch a report page and return its text content.
 * PDFs are extracted via Tavily's extract API (handles binary PDF server-side).
 * HTML pages use the existing cheerio-based fetchPage.
 * @param {string} url
 * @returns {Promise<{ success: boolean, url: string, text?: string, contentType?: string, error?: string }>}
 */
export async function fetchReport(url) {
  if (url.toLowerCase().endsWith(".pdf")) {
    return fetchPdf(url);
  }
  const result = await fetchPage(url);
  return result.success ? { ...result, contentType: "html" } : result;
}

async function fetchPdf(url) {
  const cacheKey = `fetch-report-pdf:${url}`;
  return getOrFetch(cacheKey, async () => {
    try {
      const response = await client.extract([url], { extractDepth: "advanced" });

      const failed = response.failedResults?.find((r) => r.url === url);
      if (failed) {
        return { success: false, url, error: failed.error ?? "extraction failed" };
      }

      const result = response.results?.find((r) => r.url === url) ?? response.results?.[0];
      if (!result?.rawContent) {
        return { success: false, url, error: "no content returned" };
      }

      return { success: true, url, text: result.rawContent, contentType: "pdf" };
    } catch (err) {
      return { success: false, url, error: err.message };
    }
  });
}

import * as cheerio from "cheerio";

export async function fetchPage(url) {
  let response;

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 10_000);

    response = await fetch(url, {
      signal: controller.signal,
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36",
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.9",
        "Accept-Encoding": "gzip, deflate, br",
        "Cache-Control": "no-cache",
        "Pragma": "no-cache",
        "Upgrade-Insecure-Requests": "1",
        "Sec-Fetch-Dest": "document",
        "Sec-Fetch-Mode": "navigate",
        "Sec-Fetch-Site": "none",
        "Sec-Fetch-User": "?1",
      },
    }).finally(() => clearTimeout(timer));
  } catch (err) {
    const isTimeout = err.name === "AbortError";
    return { success: false, error: isTimeout ? "timeout" : err.message };
  }

  if (!response.ok) {
    return { success: false, error: `HTTP ${response.status} ${response.statusText}` };
  }

  const html = await response.text();
  const $ = cheerio.load(html);

  // Remove non-content elements
  $("script, style, noscript, svg, iframe, nav, header, footer, aside").remove();
  $("[aria-hidden='true']").remove();

  const raw = $("body").text();

  // Collapse whitespace
  const text = raw
    .replace(/\t/g, " ")
    .replace(/[ \t]+/g, " ")
    .replace(/\n[ \t]+/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  return { success: true, url, text, fetchedAt: new Date().toISOString() };
}

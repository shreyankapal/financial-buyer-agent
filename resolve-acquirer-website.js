import { webSearch } from "./web-search.js";
import { normalizeForMatch, isSubstringMatch } from "./dedupe.js";

// Aggregator/social/directory sites that are never a PE firm's own website.
// Includes general social/news sites plus PE-specific research aggregators
// (pitchbook.com, tracxn.com, mergr.com, privateequityinfo.com) which Tavily
// frequently returns for "X private equity firm" queries instead of the firm's
// actual homepage.
const NON_FIRM_DOMAINS = new Set([
  "linkedin.com",
  "crunchbase.com",
  "bloomberg.com",
  "wikipedia.org",
  "facebook.com",
  "x.com",
  "twitter.com",
  "zoominfo.com",
  "owler.com",
  "yahoo.com",
  "youtube.com",
  // PE research aggregators — never the firm's own site
  "pitchbook.com",
  "preqin.com",
  "tracxn.com",
  "mergr.com",
  "privateequityinfo.com",
  "premieralts.com",
  "caplight.com",
  // General organisations / forums that publish PE content but are not PE firms
  "weforum.org",
  // Government / regulatory sites — never a firm's homepage
  "sec.gov",
]);

function domainFromUrl(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return null;
  }
}

function isFirmDomain(domain) {
  if (domain === null) return false;
  for (const blocked of NON_FIRM_DOMAINS) {
    if (domain === blocked || domain.endsWith(`.${blocked}`)) return false;
  }
  return true;
}

// Require that at least one meaningful word (3+ chars) from the firm name appears
// somewhere in the resolved domain. Prevents short extracted names like "Apax" from
// landing on unrelated domains such as cohnreznick.com that happen to mention the
// firm in an article. Short firm names with no 3-char words get a free pass.
function nameFitsInDomain(firmName, domain) {
  const words = normalizeForMatch(firmName)
    .split(" ")
    .filter((w) => w.length >= 3);
  if (words.length === 0) return true;
  const domainNorm = domain.replace(/[^a-z0-9]/g, "");
  return words.some((w) => domainNorm.includes(w));
}

/**
 * Look up firmName in the current run's already-known firms.
 * Exact normalized match wins over substring match.
 * @param {string} firmName
 * @param {Array<{firmName: string, sourceUrls?: string[]}>} knownFirms
 * @returns {{ firm: object, matchType: "known-exact"|"known-substring" } | null}
 */
function findInKnownFirms(firmName, knownFirms) {
  const normTarget = normalizeForMatch(firmName);

  for (const firm of knownFirms) {
    if (normalizeForMatch(firm.firmName) === normTarget) {
      return { firm, matchType: "known-exact" };
    }
  }

  for (const firm of knownFirms) {
    if (isSubstringMatch(normTarget, normalizeForMatch(firm.firmName))) {
      return { firm, matchType: "known-substring" };
    }
  }

  return null;
}

/**
 * Resolve the website domain for an acquiring firm.
 *
 * First checks the current run's known firms (no search credit spent).
 * Only falls back to a web search when the firm is genuinely new.
 *
 * @param {string} firmName - Firm name from extractAcquirer
 * @param {Array<{firmName: string, sourceUrls?: string[]}>} knownFirms - Current run's firms
 * @param {object} [options]
 * @param {string} [options.searchSuffix="official website"] - Appended to the search query.
 *   Use "private equity firm" for industry-report names to disambiguate short/acronym names
 *   (e.g. "KKR official website" → unrelated pages; "KKR private equity firm" → kkr.com).
 * @returns {Promise<{ website: string|null, source: "known-exact"|"known-substring"|"web-search" }>}
 */
export async function resolveAcquirerWebsite(firmName, knownFirms = [], options = {}) {
  const { searchSuffix = "official website" } = options;

  const match = findInKnownFirms(firmName, knownFirms);

  if (match) {
    const website =
      (match.firm.sourceUrls ?? []).map(domainFromUrl).find(Boolean) ?? null;
    if (website) {
      return { website, source: match.matchType };
    }
    // Known firm but no parseable URL in sourceUrls — fall through to search.
  }

  const results = await webSearch(`${firmName} ${searchSuffix}`);
  // Collect all candidates that pass both filters, then prefer the simplest
  // domain (fewest dots → shortest string) so e.g. apax.com is chosen over
  // apax.us.com which is a thin investor-portal sub-site.
  const candidates = results
    .map((r) => domainFromUrl(r.url))
    .filter((d) => d && isFirmDomain(d) && nameFitsInDomain(firmName, d));
  // Stable sort: prefer fewer-dot domains (apax.com over apax.us.com) but
  // preserve Tavily's original order for domains at the same depth so the
  // highest-ranked result wins when dot count ties.
  candidates.sort((a, b) => a.split(".").length - b.split(".").length);
  const website = candidates[0] ?? null;
  return { website, source: "web-search" };
}

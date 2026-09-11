import "dotenv/config";
import Anthropic from "@anthropic-ai/sdk";
import { createHash } from "crypto";
import { getOrFetch } from "./cache.js";

// Words that carry no signal for overlap comparison
const FILLER_WORDS = new Set(["the", "a", "of", "in", "for", "and"]);

/** Similarity threshold above which two queries are treated as near-duplicates. */
const NEAR_DUPLICATE_THRESHOLD = 0.7;

/**
 * Normalize a query into a set of meaningful words.
 * Lowercases, strips punctuation, splits on whitespace, removes filler words.
 * @param {string} query
 * @returns {Set<string>}
 */
function normalizeQuery(query) {
  return new Set(
    query
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, "")
      .split(/\s+/)
      .filter((w) => w.length > 0 && !FILLER_WORDS.has(w))
  );
}

/**
 * Jaccard similarity between two word sets: |intersection| / |union|.
 * @param {Set<string>} a
 * @param {Set<string>} b
 * @returns {number}
 */
function jaccardSimilarity(a, b) {
  if (a.size === 0 && b.size === 0) return 1;
  const intersection = [...a].filter((w) => b.has(w)).length;
  const union = new Set([...a, ...b]).size;
  return union === 0 ? 0 : intersection / union;
}

/**
 * Returns true if two queries share ≥70% word overlap (Jaccard similarity),
 * meaning they are likely near-duplicates even if word order differs.
 * @param {string} queryA
 * @param {string} queryB
 * @returns {boolean}
 */
export function isNearDuplicate(queryA, queryB) {
  return (
    jaccardSimilarity(normalizeQuery(queryA), normalizeQuery(queryB)) >=
    NEAR_DUPLICATE_THRESHOLD
  );
}

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

function profileHash(profile) {
  const key = JSON.stringify({
    niche: profile.niche,
    sector: profile.sector,
    products: profile.products,
    searchKeywords: profile.searchKeywords,
    geography: profile.geography,
  });
  return createHash("sha256").update(key).digest("hex").slice(0, 24);
}

async function generateSmartQueries(profile) {
  const cacheKey = `smart-queries:${profileHash(profile)}`;

  try {
    return await getOrFetch(cacheKey, async () => {
      const prompt =
        `You are a private equity analyst trying to find acquirers for a company with this profile:\n` +
        `- Niche: ${profile.niche}\n` +
        `- Sector: ${profile.sector}\n` +
        `- Products: ${(profile.products ?? []).join(", ")}\n` +
        `- Keywords: ${(profile.searchKeywords ?? []).join(", ")}\n` +
        (profile.geography ? `- Geography: ${profile.geography}\n` : "") +
        `\nWrite 5-6 search engine queries you would actually type to find relevant PE firms or strategic acquirers online. ` +
        `Use the technical details and keywords as CONTEXT to understand the space, not as literal search terms — ` +
        `don't just glue technical jargon or certification names onto "private equity". ` +
        `Write queries the way a human M&A analyst would naturally phrase them ` +
        `(e.g. "defense cybersecurity private equity firms" rather than "NSA Type-1 encryption private equity"). ` +
        `Respond ONLY with a JSON array of query strings, no preamble, no explanation.`;

      const response = await client.messages.create({
        model: "claude-sonnet-4-6",
        max_tokens: 512,
        messages: [{ role: "user", content: prompt }],
      });

      let raw = response.content[0].text.trim();
      raw = raw.replace(/^```(?:json)?\n?/, "").replace(/\n?```$/, "").trim();
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed.filter(Boolean) : [];
    });
  } catch {
    return [];
  }
}

export async function generateBuyerQueries(profile) {
  const { niche, sector, searchKeywords = [], geography } = profile;

  const hasGeography = geography && geography !== "NOT FOUND";
  const keywords = searchKeywords.filter(Boolean);

  // Use the primary keyword if available; otherwise truncate niche to ~7 words
  const shortNiche = keywords.length > 0
    ? keywords[0]
    : niche.split(/\s+/).slice(0, 7).join(" ");

  // Bucket 1: deterministic broad niche/sector queries
  const broadQueries = [
    `${shortNiche} private equity firms`,
    `${shortNiche} private equity firm portfolio companies`,
    `${sector} focused private equity`,
    `${shortNiche} PE firm "our portfolio"`,
    `${sector} private equity investment thesis`,
    `private equity portfolio companies ${shortNiche}`,
    `${sector} private equity acquisitions`,
  ];

  // Bucket 2: LLM-generated analyst-style queries (replaces naive per-keyword concatenation)
  const smartQueries = await generateSmartQueries(profile);

  // Bucket 3: geography-scoped queries (always appended last)
  const geoQueries = hasGeography
    ? [
        `${shortNiche} private equity firms ${geography}`,
        `${sector} private equity ${geography}`,
      ]
    : [];

  // Interleave broad and smart queries round-robin, then append geo
  const interleaved = [];
  const len = Math.max(broadQueries.length, smartQueries.length);
  for (let i = 0; i < len; i++) {
    if (i < broadQueries.length) interleaved.push(broadQueries[i]);
    if (i < smartQueries.length) interleaved.push(smartQueries[i]);
  }

  // Near-duplicate dedup: accept a query only if it isn't too similar to any
  // already-accepted query (Jaccard word overlap < 70%).  Exact duplicates are
  // caught as a special case (similarity = 1.0).
  const deduped = [];
  for (const q of [...interleaved, ...geoQueries].map((q) => q.trim()).filter(Boolean)) {
    const twin = deduped.find((accepted) => isNearDuplicate(q, accepted));
    if (twin) {
      console.log(`  Skipped near-duplicate query: '${q}' (too similar to '${twin}')`);
    } else {
      deduped.push(q);
    }
  }

  console.log(`\nGenerated ${deduped.length} search queries:`);
  deduped.forEach((q, i) => console.log(`  ${i + 1}. ${q}`));

  return deduped;
}

/** Collapse consecutive identical words (case-insensitive) to a single occurrence. */
function collapseAdjacentDuplicates(query) {
  return query
    .split(/\s+/)
    .filter((word, i, arr) => i === 0 || word.toLowerCase() !== arr[i - 1].toLowerCase())
    .join(" ");
}

/**
 * Bucket D: deal-announcement discovery queries.
 * Combines niche/sector/keywords with deal-language terms to surface
 * press releases and news about acquisitions in the target space.
 * Pure synchronous — no LLM call needed.
 * @param {object} profile
 * @returns {string[]} up to 6 deduped queries
 */
export function generateDealAnnouncementQueries(profile) {
  const { niche, sector, searchKeywords = [] } = profile;
  const keywords = searchKeywords.filter(Boolean);

  const shortNiche =
    keywords.length > 0
      ? keywords[0]
      : niche.split(/\s+/).slice(0, 7).join(" ");

  const candidates = [
    `${shortNiche} private equity acquires`,
    `${sector} platform investment private equity`,
    `${shortNiche} add-on acquisition`,
    `${sector} recapitalization`,
    `private equity acquires ${sector}`,
    `${shortNiche} acquired private equity`,
    `${sector} add-on acquisition deal`,
    `${shortNiche} recapitalization`,
  ];

  // Splice in up to two extra keyword variants for richer coverage
  for (const kw of keywords.slice(1, 3)) {
    candidates.push(`${kw} private equity acquires`);
    candidates.push(`${kw} platform investment`);
  }

  const deduped = [];
  for (const q of candidates.map((q) => collapseAdjacentDuplicates(q.trim())).filter(Boolean)) {
    const twin = deduped.find((accepted) => isNearDuplicate(q, accepted));
    if (twin) {
      console.log(
        `  [Bucket D] Skipped near-duplicate: '${q}' (similar to '${twin}')`
      );
    } else {
      deduped.push(q);
    }
  }

  return deduped.slice(0, 6);
}

/**
 * Domain list for industry-report discovery.
 * Pair with { topic: "general", includeDomains: INDUSTRY_REPORT_DOMAINS } when searching.
 */
export const INDUSTRY_REPORT_DOMAINS = ["capstonepartners.com", "hl.com"];

/**
 * Build sector terms for pre-filtering industry-report results.
 * Splits sector + searchKeywords into individual tokens (4+ chars, deduped).
 * Same tokenization as the Bucket D pre-filter in run-pipeline.js.
 * @param {object} profile
 * @returns {string[]}
 */
export function buildSectorTerms(profile) {
  return [
    profile.sector,
    ...(profile.searchKeywords ?? []).slice(0, 4),
  ]
    .filter(Boolean)
    .flatMap((t) => t.split(/[\s/,]+/))
    .map((w) => w.toLowerCase())
    .filter((w) => w.length >= 4)
    .filter((w, i, arr) => arr.indexOf(w) === i);
}

/**
 * Pre-filter for industry-report fetch candidates.
 * Two-stage: (1) URL must end in .pdf; (2) the URL slug must contain at least
 * one sector term from sectorTerms, OR one of the HL-specific subsector phrases
 * ("field", "frontline operations") that cover HL's two naming conventions for
 * the same FSM coverage area.
 *
 * Slug-only matching (not title/snippet) is intentional — HL and Capstone report
 * PDFs use descriptive slugs that reflect actual coverage; snippet text is too
 * noisy (generic terms like "service", "management", "software" appear in every
 * advisory firm's boilerplate).
 *
 * sectorTerms should already be tokenized via buildSectorTerms().
 * @param {{ url: string }} result
 * @param {string[]} sectorTerms - from buildSectorTerms()
 * @returns {boolean}
 */
export function isIndustryReportRelevant(result, sectorTerms) {
  if (!result.url?.toLowerCase().endsWith(".pdf")) return false;
  // Normalize both hyphens and underscores so Capstone and HL slugs parse the same way.
  const slug = result.url.split("/").pop().replace(/\.pdf$/i, "").replace(/[-_]/g, " ").toLowerCase();
  if (sectorTerms.some((t) => slug.includes(t))) return true;
  // "frontline operations" is HL's alternate name for the field service management
  // software subsector — it won't appear in profile.sector but is a real coverage
  // area label that must survive the filter.
  return slug.includes("frontline operations");
}

/**
 * Industry-report discovery queries targeting Capstone Partners and Houlihan Lokey.
 * Uses profile.sector (the broad category) rather than niche — published report
 * titles match sector-level language, not company-specific descriptors.
 * Pure synchronous — no LLM call needed.
 * @param {object} profile
 * @returns {string[]} up to 6 deduped queries
 */
export function generateIndustryReportQueries(profile) {
  const { sector } = profile;

  // No near-duplicate dedup here: domain restriction already prevents crawl waste,
  // and subtle report-type term differences ("M&A report" vs "M&A overview") can
  // surface distinct documents within the same publisher's site.
  return [
    `${sector} M&A report Capstone Partners`,
    `${sector} software market update Houlihan Lokey`,
    `${sector} M&A market update Houlihan Lokey`,
    `${sector} M&A overview Capstone Partners`,
    `${sector} deal activity Capstone Partners`,
    `${sector} deal activity Houlihan Lokey`,
  ].map((q) => q.trim());
}

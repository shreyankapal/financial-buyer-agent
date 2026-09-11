import "dotenv/config";
import { createHash } from "crypto";
import Anthropic from "@anthropic-ai/sdk";
import { getOrFetch } from "./cache.js";

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

function cacheKey(text) {
  const hash = createHash("sha256").update(text).digest("hex").slice(0, 24);
  return `extract-acquirer:${hash}`;
}

// Patterns ordered from most-specific to least-specific.
// Each has exactly one capture group for the firm name.
// Applied against the first 1 000 chars (the lede) only.
const ACQUIRER_PATTERNS = [
  // "FirmName, a [leading] private equity / buyout firm..."
  [
    /([A-Z][A-Za-z0-9 &.,'"-]{3,60}),\s+a(?:n)?\s+(?:(?:leading|premier|prominent|top-tier|well-established)\s+)?(?:\w+\s+){0,2}(?:private\s+equity|buyout|growth\s+equity)\s+(?:firm|fund|group|partnership|sponsor)\b/,
    "comma-descriptor",
  ],
  // "FirmName today announced..."
  // No comma — same reasoning as active-verb: prevents lazy quantifier from
  // overshooting through ", the leader in ..." into the verb anchor.
  [
    /([A-Z][A-Za-z0-9 &.'"-]{3,60}?)\s+today\s+announced\b/,
    "today-announced",
  ],
  // "<SponsorName>-backed <PortfolioCo>" — extracts only the sponsor.
  // Must run before active-verb, which would otherwise consume the whole
  // "Sponsor-backed Portfolio" string up to the acquisition verb.
  [
    /([A-Z][A-Za-z0-9 &.'"-]{1,40}?)-backed\s+[A-Z]/,
    "backed-sponsor",
  ],
  // "FirmName has acquired / acquires / completed acquisition"
  // No comma in the character class — commas are not part of firm names here and
  // would let the lazy quantifier overshoot into a trailing clause before the verb.
  [
    /([A-Z][A-Za-z0-9 &.'"-]{3,60}?)\s+(?:has\s+)?(?:acquired\b|acquires\b|complet(?:ed|es)\s+(?:its\s+)?(?:the\s+)?acquisition\b)/,
    "active-verb",
  ],
  // passive: "acquired by FirmName" — lookahead stops at punct or filler word
  [
    /\bacquired\s+by\s+([A-Z][A-Za-z0-9 &.,'"-]{3,60}?)(?=\s*[,.(]|\s+(?:a|an|the|in|for|and|which|to|at|from)\b)/,
    "passive-acquired-by",
  ],
];

const BOILERPLATE_TERMS = [
  "register",
  "subscribe",
  "login",
  "home",
  "news briefs",
  "click here",
  "funding",
];

/**
 * Returns false for names that are implausibly short/long or contain
 * boilerplate website navigation text.  Applied to both regex and LLM output
 * before the result is cached or returned to callers.
 */
function isPlausibleFirmName(name) {
  if (!name) return false;
  if (name.length < 3 || name.length > 60) return false;
  const lower = name.toLowerCase();
  return !BOILERPLATE_TERMS.some((term) => lower.includes(term));
}

function tryRegex(text) {
  const lede = text.slice(0, 1000);
  for (const [pattern, label] of ACQUIRER_PATTERNS) {
    const m = lede.match(pattern);
    if (m?.[1]) {
      const firmName = m[1].trim().replace(/[,.\s]+$/, "");
      return { firmName, pattern: label };
    }
  }
  return null;
}

async function llmFallback(text, key) {
  return getOrFetch(`${key}:llm`, async () => {
    try {
      const response = await client.messages.create({
        model: "claude-haiku-4-5-20251001",
        max_tokens: 64,
        system:
          "You will be given a deal announcement or news article. " +
          "Identify ONLY the name of the acquiring company or firm (the buyer, not the target). " +
          'Reply with just the firm name — no explanation, no punctuation, no extra words. If you cannot determine it, reply with exactly "UNKNOWN".',
        messages: [
          {
            role: "user",
            content: `Article:\n${text.slice(0, 3000)}\n\nAcquiring firm name:`,
          },
        ],
      });
      // Check only the first line — model occasionally adds an explanation after
      // "UNKNOWN" on a second line, which would pass a whole-string equality check.
      const firstLine = response.content[0].text.trim().split("\n")[0].trim();
      return firstLine === "UNKNOWN" ? null : firstLine;
    } catch {
      return null;
    }
  });
}

const ACQUISITION_TERMS = [
  "acquir",
  "invest",
  "recapitaliz",
  "buyout",
  "portfolio company",
  "backed",
];

/**
 * Cheap pre-filter: returns true only if the snippet contains at least one
 * acquisition-related term within 200 characters of at least one sector keyword.
 * Call this before extractAcquirer to avoid spending regex or LLM effort on
 * snippets that are clearly not deal announcements.
 *
 * @param {string} snippet
 * @param {string[]} sectorTerms - from profile.sector + profile.searchKeywords
 * @returns {boolean}
 */
export function isAcquisitionRelevant(snippet, sectorTerms) {
  if (!snippet || !sectorTerms?.length) return false;
  const lower = snippet.toLowerCase();

  for (const acqTerm of ACQUISITION_TERMS) {
    let pos = 0;
    while ((pos = lower.indexOf(acqTerm, pos)) !== -1) {
      const start = Math.max(0, pos - 200);
      const end = Math.min(lower.length, pos + acqTerm.length + 200);
      const window = lower.slice(start, end);
      if (sectorTerms.some((t) => window.includes(t.toLowerCase()))) return true;
      pos++;
    }
  }
  return false;
}

/**
 * Extract the acquiring firm name from a deal announcement article.
 * Tries regex patterns first; falls back to a narrow LLM call only if they fail.
 * Both paths are cached by content hash.
 *
 * @param {string} text - Raw article text
 * @returns {Promise<{ firmName: string|null, method: "regex"|"llm", pattern?: string }>}
 */
export async function extractAcquirer(text) {
  const key = cacheKey(text);

  return getOrFetch(key, async () => {
    const regexResult = tryRegex(text);
    if (regexResult) {
      const firmName = isPlausibleFirmName(regexResult.firmName) ? regexResult.firmName : null;
      return { firmName, method: "regex", pattern: regexResult.pattern };
    }

    const rawName = await llmFallback(text, key);
    const firmName = isPlausibleFirmName(rawName) ? rawName : null;
    return { firmName, method: "llm" };
  });
}

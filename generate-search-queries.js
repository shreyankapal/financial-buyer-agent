import "dotenv/config";
import Anthropic from "@anthropic-ai/sdk";
import { createHash } from "crypto";
import { getOrFetch } from "./cache.js";

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

  const deduped = [
    ...new Set([...interleaved, ...geoQueries].map((q) => q.trim()).filter(Boolean)),
  ];

  console.log(`\nGenerated ${deduped.length} search queries:`);
  deduped.forEach((q, i) => console.log(`  ${i + 1}. ${q}`));

  return deduped;
}

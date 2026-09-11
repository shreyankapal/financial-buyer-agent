import { profileTarget } from "./profile-target.js";
import {
  generateBuyerQueries,
  generateDealAnnouncementQueries,
  isNearDuplicate,
} from "./generate-search-queries.js";

// ── 1. Direct unit check for the two ServiceTitan near-duplicates ──────────
const q3  = "field service management software private equity firm portfolio companies";
const q11 = "private equity portfolio companies field service management software";

const similar = isNearDuplicate(q3, q11);
console.log("Near-duplicate check (expect true):", similar);
if (!similar) {
  console.error("FAIL: expected isNearDuplicate to return true for those two queries");
  process.exit(1);
}
console.log("PASS: the two known near-duplicates are correctly identified\n");

// ── 2. Full query generation against the cached ServiceTitan profile ────────
const result = await profileTarget("https://www.servicetitan.com");

if (!result.success) {
  console.error("profileTarget failed:", result.error);
  process.exit(1);
}

console.log(`Profile: ${result.profile.companyName} — ${result.profile.niche}\n`);

const queries = await generateBuyerQueries(result.profile);

console.log(`\nQuery list (${queries.length} total):`);
queries.forEach((q, i) => console.log(`  ${i + 1}. ${q}`));

// q11 should have been dropped (exact string absent from final list)
const q11Survived = queries.includes(q11);

// No two queries in the final list should be near-duplicates of each other
const internalDupPair = queries.flatMap((qa, i) =>
  queries.slice(i + 1).filter((qb) => isNearDuplicate(qa, qb)).map((qb) => [qa, qb])
)[0];

console.log();
if (q11Survived) {
  console.error(`FAIL: '${q11}' was NOT removed — near-duplicate of q3 survived`);
  process.exit(1);
}
if (internalDupPair) {
  console.error(`FAIL: final list still has a near-duplicate pair:\n  '${internalDupPair[0]}'\n  '${internalDupPair[1]}'`);
  process.exit(1);
}
console.log("PASS: near-duplicate deduplication dropped one of the two similar queries — no near-duplicate pairs remain");

// ── 3. Bucket D: deal-announcement discovery ────────────────────────────────
console.log("\n─── Bucket D: deal-announcement discovery ───");
const dealQueries = generateDealAnnouncementQueries(result.profile);

console.log(`\nBucket D queries (${dealQueries.length} total):`);
dealQueries.forEach((q, i) => console.log(`  ${i + 1}. ${q}`));

if (dealQueries.length === 0) {
  console.error("FAIL: Bucket D produced no queries");
  process.exit(1);
}
if (dealQueries.length > 6) {
  console.error(`FAIL: Bucket D exceeded cap — got ${dealQueries.length} queries`);
  process.exit(1);
}

const dealDupPair = dealQueries.flatMap((qa, i) =>
  dealQueries.slice(i + 1).filter((qb) => isNearDuplicate(qa, qb)).map((qb) => [qa, qb])
)[0];

if (dealDupPair) {
  console.error(
    `FAIL: Bucket D still has a near-duplicate pair:\n  '${dealDupPair[0]}'\n  '${dealDupPair[1]}'`
  );
  process.exit(1);
}
console.log("PASS: Bucket D produced 1-6 queries with no internal near-duplicate pairs");

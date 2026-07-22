import { profileTarget } from "./profile-target.js";
import { generateBuyerQueries } from "./generate-search-queries.js";

const result = await profileTarget("https://www.apple.com");

if (!result.success) {
  console.error("profileTarget failed:", result.error);
  process.exit(1);
}

const queries = await generateBuyerQueries(result.profile);

console.log(`Generated ${queries.length} queries:\n`);
queries.forEach((q, i) => console.log(`${i + 1}. ${q}`));

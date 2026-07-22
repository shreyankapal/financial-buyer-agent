import { getCached } from "./cache.js";
import { findRelevantPortfolio } from "./relevant-portfolio.js";

// Load the real Arkham profile from cache — no LLM call, no manual keyword additions
const cached = await getCached("profile-target:https://www.arkhamtechnology.com");
if (!cached) {
  console.error("No cached profile found for arkhamtechnology.com — run the pipeline once first.");
  process.exit(1);
}

const profile = cached.value.profile;

console.log("=== Real Arkham Profile ===");
console.log(`companyName:    ${profile.companyName}`);
console.log(`niche:          ${profile.niche}`);
console.log(`sector:         ${profile.sector}`);
console.log(`products:       ${(profile.products ?? []).join(", ")}`);
console.log(`customers:      ${profile.customers}`);
console.log(`geography:      ${profile.geography}`);
console.log(`searchKeywords: ${(profile.searchKeywords ?? []).join(", ")}`);
console.log(`profileSource:  ${profile.profileSource}`);

// Same fake Summit Partners buyer from the earlier test
const summitPartnersWeak = {
  firmName: "Summit Partners",
  portfolioCompanies: [
    "Keyfactor",
    "Webroot",
    "Cylance",
    "RiskIQ",
    "LogRhythm",
    "Netsparker",
  ],
  sectorFocus: "Growth equity and venture capital across technology and healthcare",
  fit: {
    fitScore: "Weak",
    notes: "No sector focus match found; no portfolio evidence of relevant companies.",
  },
};

console.log("\n=== findRelevantPortfolio (Weak-fit buyer, real profile) ===");
console.log(`Buyer:     ${summitPartnersWeak.firmName} (fitScore: ${summitPartnersWeak.fit.fitScore})`);
console.log(`Portfolio: ${summitPartnersWeak.portfolioCompanies.join(", ")}`);

const result = await findRelevantPortfolio(profile, summitPartnersWeak);

console.log(`\nmethod:            ${result.method}`);
console.log(`relevantCompanies: ${result.relevantCompanies.join(", ") || "(none)"}`);
console.log(`reasoning:         ${result.reasoning}`);

// Show whether the Weak → Moderate upgrade would fire
if (
  summitPartnersWeak.fit.fitScore === "Weak" &&
  result.method === "keyword" &&
  result.relevantCompanies.length > 0
) {
  const matched = result.relevantCompanies.join(", ");
  console.log(`\nfitScore upgrade: Weak → Moderate ✓  (matched: ${matched})`);
} else {
  console.log("\nfitScore upgrade: did not apply");
  console.log("(keyword pass found no matches using the real profile's searchKeywords alone)");
}

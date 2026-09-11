/**
 * Demo: generateIndustryReportQueries for two contrasting profiles.
 * Not wired into the pipeline — run standalone to inspect output.
 */
import { generateIndustryReportQueries, INDUSTRY_REPORT_DOMAINS } from "./generate-search-queries.js";

const profiles = [
  {
    label: "ServiceTitan (broad sector)",
    profile: {
      sector: "Field Service Management Software",
      niche: "Cloud-based field service management platform for home services contractors",
      searchKeywords: ["field service management", "FSM software", "home services software"],
    },
  },
  {
    label: "Hypothetical defense-tech (narrow sector)",
    profile: {
      sector: "Defense Technology",
      niche: "AI-enabled ISR payload software for unmanned aerial systems with CMMC Level 2 certification",
      searchKeywords: ["ISR software", "defense AI", "UAS payload"],
    },
  },
];

const searchOpts = { topic: "general", includeDomains: INDUSTRY_REPORT_DOMAINS };

for (const { label, profile } of profiles) {
  console.log(`\n${"─".repeat(60)}`);
  console.log(`Profile: ${label}`);
  console.log(`  sector: "${profile.sector}"`);
  console.log(`Search options: ${JSON.stringify(searchOpts)}`);
  console.log(`Queries:`);
  const queries = generateIndustryReportQueries(profile);
  queries.forEach((q, i) => console.log(`  ${i + 1}. ${q}`));
}
console.log(`\n${"─".repeat(60)}`);

import { generateRationale } from "./generate-rationale.js";

const targetProfile = {
  companyName: "TinyThreads",
  niche: "online children's clothing and apparel retailer",
  sector: "Consumer / E-commerce",
  products: ["kids clothing", "children's apparel"],
  customers: "parents and families",
  searchKeywords: ["kids clothing", "children's apparel", "e-commerce retail", "consumer products"],
};

// Strong-fit buyer — should get LLM polish
const summitPartners = {
  firmName: "Summit Consumer Partners",
  portfolioCompanies: ["KidsWear Co", "Outdoor Ventures Inc", "Home Goods Direct"],
  sectorFocus: "Consumer brands and retail",
  investmentCriteria: "$20M–$100M revenue",
  fit: { fitScore: "Strong", sectorFit: "Strong", notes: "" },
  confidence: { confidence: "High" },
  relevantPortfolio: {
    relevantCompanies: ["KidsWear Co"],
    method: "keyword",
    reasoning: '"KidsWear Co" matched on: kids',
  },
};

// Moderate-fit buyer — should get deterministic only (no LLM call)
const broadleaf = {
  firmName: "Broadleaf Growth Equity",
  portfolioCompanies: ["Sprout & Thread", "Alpine Fresh Co", "Meridian Outdoors"],
  sectorFocus: "Consumer brands and direct-to-consumer retail",
  investmentCriteria: "NOT FOUND",
  fit: { fitScore: "Moderate", sectorFit: "Partial", notes: "" },
  confidence: { confidence: "Medium" },
  relevantPortfolio: {
    relevantCompanies: ["Sprout & Thread"],
    method: "llm",
    reasoning: "Sprout & Thread: Name and branding strongly suggest a children's clothing retailer",
  },
};

for (const [label, buyer] of [
  ["Summit Consumer Partners (Strong → expect LLM)", summitPartners],
  ["Broadleaf Growth Equity (Moderate → expect deterministic)", broadleaf],
]) {
  console.log(`\n── ${label} ──`);
  const result = await generateRationale(targetProfile, buyer);
  console.log(`  source:   ${result.source}`);
  console.log(`  rationale: "${result.rationale}"`);
}

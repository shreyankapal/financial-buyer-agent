import { scoreConfidence } from "./score-confidence.js";

const gtcr = {
  firmName: "GTCR",
  sectorFocus: "healthcare services and technology",
  portfolioCompanies: ["Surmodics", "HealthEdge", "Parexel"],
  geography: "North America",
  investmentCriteria: "$200M–$2B enterprise value",
  sourceUrls: ["https://www.gtcr.com", "https://www.gtcr.com/investments/healthcare"],
};

const vista = {
  firmName: "Vista Equity Partners",
  sectorFocus: "enterprise software and technology-enabled businesses",
  portfolioCompanies: ["Marketo", "Cvent", "JAMF"],
  geography: "North America",
  investmentCriteria: "NOT FOUND",
  sourceUrls: ["https://www.vistaeq.com"],
};

console.log("=== GTCR ===");
console.log(JSON.stringify(scoreConfidence(gtcr), null, 2));

console.log("\n=== Vista Equity Partners ===");
console.log(JSON.stringify(scoreConfidence(vista), null, 2));

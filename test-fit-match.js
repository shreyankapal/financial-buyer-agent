import { fitMatch } from "./fit-match.js";

const target = {
  companyName: "ClinicFlow",
  niche: "cloud-based patient scheduling software for outpatient clinics",
  sector: "Healthcare Technology",
  products: ["patient scheduling platform", "clinic workflow automation"],
  customers: "outpatient clinics and ambulatory care centers",
  geography: "United States",
  searchKeywords: [
    "healthcare software",
    "patient scheduling",
    "outpatient",
    "clinic management",
    "health tech",
    "ambulatory care",
  ],
};

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
console.log(JSON.stringify(fitMatch(target, gtcr), null, 2));

console.log("\n=== Vista Equity Partners ===");
console.log(JSON.stringify(fitMatch(target, vista), null, 2));

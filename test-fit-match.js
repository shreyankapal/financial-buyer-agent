import { fitMatch, GENERIC_ONLY_PORTFOLIO_THRESHOLD } from "./fit-match.js";

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

// ─── Generic-keyword downgrade rule — ServiceTitan profile ───────────────────
// All four buyers below match the ServiceTitan profile only on generic words
// (service, services, software, technology, business, including).
// The rule: generic-only match + portfolioCompanies.length < 8 → downgrade to Weak.
// Threshold is GENERIC_ONLY_PORTFOLIO_THRESHOLD (currently ${GENERIC_ONLY_PORTFOLIO_THRESHOLD}).

const stProfile = {
  companyName: "ServiceTitan",
  niche: "All-in-one field service management software for commercial and residential trade contractors including HVAC, plumbing, electrical, roofing, and other skilled trades",
  sector: "Software / Field Service Management",
  geography: "United States",
  searchKeywords: [
    "field service management software",
    "contractor software platform",
    "trades business management SaaS",
    "HVAC plumbing electrical software",
    "commercial residential contractor technology",
    "home services software",
    "workforce management trades",
    "contractor ERP software",
  ],
};

// Leonard Green: broad services/consumer sector, 50+ portfolio companies → must stay Strong
const leonardGreen = {
  firmName: "Leonard Green & Partners",
  sectorFocus: "Business services, consumer products/retail, consumer services, distribution, financial services, healthcare, and industrials/industrial services",
  portfolioCompanies: [
    "1-800 Contacts", "Advantage Solutions", "Apartment Management Consultants",
    "The Aspen Group", "Authentic Brands Group", "BJ's Wholesale Club",
    "Caliber Collision Centers", "CHG Healthcare Services", "Convergint",
    "Crunch", "Equinox", "ExamWorks", "Eyemart Express", "HUB International",
    "Insight Global", "MDVIP", "MedVet", "Milan Laser Hair Removal",
    "Mindpath Health", "Mister Car Wash",
  ],
  geography: "United States",
  investmentCriteria: "NOT FOUND",
  sourceUrls: ["https://www.leonardgreen.com/portfolio"],
};

// Bain Capital: broad sector, 50+ portfolio companies → must stay Moderate
const bainCapital = {
  firmName: "Bain Capital Private Equity",
  sectorFocus: "Broad array of investment types across consumer, financial & business services, healthcare, industrials, and technology",
  portfolioCompanies: [
    "AthenaHealth", "Brillio", "Canada Goose", "CentralSquare Technologies",
    "CitiusTech", "Dealer Tire", "EnterpriseDB", "Envestnet", "ExtraHop",
    "Guidehouse", "HealthEdge", "HSO", "Imperial Dade", "Inetum",
    "LeanTaaS", "MSX International", "Namirial", "Nomad Health", "Nutraceutix",
    "Paycor",
  ],
  geography: "Americas, Asia, Europe",
  investmentCriteria: "NOT FOUND",
  sourceUrls: ["https://www.baincapitalprivateequity.com/portfolio"],
};

// Vista Equity Partners: software-focused sector, 10 portfolio companies → at threshold, must stay Moderate
const vistaEP = {
  firmName: "Vista Equity Partners",
  sectorFocus: "software solutions across industries including Agriculture, Application Development, Automotive, Collaboration, Data & Analytics, Education, Energy, Enterprise Resource Planning, Financial Services, Government, Healthcare, HR & Recruiting, Industrials, Insurance, IT Operations, Legal Risk & Compliance, Real Estate, Retail, Sales & Marketing, Security, Supply Chain & Transportation, and Telecom",
  portfolioCompanies: [
    "Acquia", "Alaric", "Apttus", "Automate.io", "Blend",
    "Cvent", "DealerSocket", "EAB", "Greenway Health", "JAMF",
  ],
  geography: "Global",
  investmentCriteria: "NOT FOUND",
  sourceUrls: ["https://www.vistaequitypartners.com/private-equity"],
};

// Vista Private Equity Group: generic sector match, 0 portfolio companies → must drop to Weak
const vistaPEG = {
  firmName: "Vista Private Equity Group",
  sectorFocus: "middle-market companies across industrials and services",
  portfolioCompanies: [],
  geography: "North America",
  investmentCriteria: "NOT FOUND",
  sourceUrls: ["https://www.vistaprivateequity.com"],
};

console.log("\n\n=== Generic-keyword downgrade rule — ServiceTitan profile ===");
console.log(`(threshold: ${GENERIC_ONLY_PORTFOLIO_THRESHOLD} portfolio companies)\n`);

const lgResult = fitMatch(stProfile, leonardGreen);
const lgPass = lgResult.fitScore === "Strong";
console.log(`Leonard Green & Partners → ${lgResult.fitScore} (expected Strong). ${lgPass ? "PASS" : "FAIL"}`);
console.log(`  notes: ${lgResult.notes}`);

const bainResult = fitMatch(stProfile, bainCapital);
const bainPass = bainResult.fitScore === "Moderate";
console.log(`\nBain Capital Private Equity → ${bainResult.fitScore} (expected Moderate). ${bainPass ? "PASS" : "FAIL"}`);
console.log(`  notes: ${bainResult.notes}`);

const vepResult = fitMatch(stProfile, vistaEP);
const vepPass = vepResult.fitScore === "Moderate";
console.log(`\nVista Equity Partners → ${vepResult.fitScore} (expected Moderate). ${vepPass ? "PASS" : "FAIL"}`);
console.log(`  notes: ${vepResult.notes}`);

const vpegResult = fitMatch(stProfile, vistaPEG);
const vpegPass = vpegResult.fitScore === "Weak";
console.log(`\nVista Private Equity Group → ${vpegResult.fitScore} (expected Weak). ${vpegPass ? "PASS" : "FAIL"}`);
console.log(`  notes: ${vpegResult.notes}`);

import { dedupeBuyers } from "./dedupe.js";

// --- Original test (exact-match deduplication) ---
console.log("=== Test 1: exact case-insensitive dedup ===");
const buyers1 = [
  {
    success: true,
    sourceUrl: "https://www.gtcr.com",
    facts: {
      isRelevant: true,
      firmName: "GTCR",
      sectorFocus: "healthcare services and technology",
      portfolioCompanies: ["Surmodics", "HealthEdge"],
      geography: "NOT FOUND",
      investmentCriteria: "NOT FOUND",
    },
  },
  {
    success: true,
    sourceUrl: "https://www.gtcr.com/investments/healthcare",
    facts: {
      isRelevant: true,
      firmName: "gtcr ",
      sectorFocus: "healthcare",
      portfolioCompanies: ["HealthEdge", "Parexel"],
      geography: "North America",
      investmentCriteria: "$200M–$2B enterprise value",
    },
  },
  {
    success: true,
    sourceUrl: "https://www.vistaeq.com",
    facts: {
      isRelevant: true,
      firmName: "Vista Equity Partners",
      sectorFocus: "enterprise software and technology-enabled businesses",
      portfolioCompanies: ["Marketo", "Cvent", "JAMF"],
      geography: "North America",
      investmentCriteria: "NOT FOUND",
    },
  },
  { success: false, sourceUrl: "https://www.example.com/404", facts: null },
  {
    success: true,
    sourceUrl: "https://www.apple.com",
    facts: { isRelevant: false, firmName: "Apple", sectorFocus: "consumer electronics", portfolioCompanies: [], geography: "Global", investmentCriteria: "NOT FOUND" },
  },
];
console.log(JSON.stringify(dedupeBuyers(buyers1), null, 2));

// --- New test: substring deduplication ---
console.log("\n=== Test 2: substring dedup (Bain Capital variants) ===");
const buyers2 = [
  {
    success: true,
    sourceUrl: "https://www.baincapitalprivateequity.com",
    facts: {
      isRelevant: true,
      firmName: "Bain Capital Private Equity",
      sectorFocus: "technology, healthcare, and consumer companies",
      portfolioCompanies: ["Bombardier Recreational Products"],
      geography: "Global",
      investmentCriteria: "NOT FOUND",
    },
  },
  {
    success: true,
    sourceUrl: "https://www.baincapital.com/businesses/private-equity",
    facts: {
      isRelevant: true,
      firmName: "Bain Capital",
      sectorFocus: "technology and software companies",
      portfolioCompanies: ["Zendesk", "Gartner"],
      geography: "North America",
      investmentCriteria: "$1B+ enterprise value",
    },
  },
  {
    success: true,
    sourceUrl: "https://www.llrpartners.com",
    facts: {
      isRelevant: true,
      firmName: "LLR Partners",
      sectorFocus: "growth-stage technology and services companies",
      portfolioCompanies: ["Actian", "Dude Solutions"],
      geography: "North America",
      investmentCriteria: "$20M–$150M revenue",
    },
  },
  {
    success: true,
    sourceUrl: "https://www.fiveelmscapital.com",
    facts: {
      isRelevant: true,
      firmName: "Five Elms Capital",
      sectorFocus: "B2B SaaS companies with strong retention metrics",
      portfolioCompanies: ["Greenway Health"],
      geography: "North America",
      investmentCriteria: "NOT FOUND",
    },
  },
];

const result2 = dedupeBuyers(buyers2);
console.log(JSON.stringify(result2, null, 2));
console.log(`\nExpected 3 firms (Bain Capital merged). Got: ${result2.length}`);
const bain = result2.find(b => b.firmName.toLowerCase().includes("bain"));
if (bain) console.log(`Bain canonical name: "${bain.firmName}" (expected "Bain Capital")`);

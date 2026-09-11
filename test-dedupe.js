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
if (bain) console.log(`Bain canonical name: "${bain.firmName}" (expected "Bain Capital Private Equity")`);

// --- Test 3: domain-based merge — real K1 / K1 Investment Management case from ServiceTitan output ---
// "K1" is a single word so the 2-word guard in the substring pass blocks it; the domain pass must catch it.
console.log("\n=== Test 3: domain-based merge — K1 / K1 Investment Management (real ServiceTitan case) ===");
const buyers3 = [
  {
    success: true,
    sourceUrl: "https://k1.com/our-approach",
    facts: {
      isRelevant: true,
      firmName: "K1",
      sectorFocus: "AI-enabled technology companies, with focus on scaling software businesses into category leaders through operational support in people, process, and systems",
      portfolioCompanies: ["Buildium", "Checkmarx", "Granicus", "Rave Mobile Safety", "WorkForce Software"],
      geography: "NOT FOUND",
      investmentCriteria: "NOT FOUND",
    },
  },
  {
    success: true,
    sourceUrl: "https://k1.com/simpro-a-leading-global-provider-of-field-service-management-software-secures-growth-investment-of-over-350-million-usd",
    facts: {
      isRelevant: true,
      firmName: "K1 Investment Management",
      sectorFocus: "Enterprise software companies, specifically high-growth SaaS and technology businesses",
      portfolioCompanies: ["simPRO", "ClockShark", "AroFlo", "Buildium", "ControlUp", "Rave Mobile Safety"],
      geography: "Global",
      investmentCriteria: "NOT FOUND",
    },
  },
];

const result3 = dedupeBuyers(buyers3);
console.log(JSON.stringify(result3, null, 2));
const k1Merged = result3.length === 1;
console.log(`\nExpected 1 firm (K1 merged by domain). Got: ${result3.length}. ${k1Merged ? "PASS" : "FAIL"}`);
if (k1Merged) {
  const portfolio = result3[0].portfolioCompanies;
  const hasSimPRO = portfolio.includes("simPRO");
  const hasBuildium = portfolio.includes("Buildium");
  const hasClockShark = portfolio.includes("ClockShark");
  console.log(`Portfolio has simPRO (from K1 IM): ${hasSimPRO ? "PASS" : "FAIL"}`);
  console.log(`Portfolio has Buildium (shared): ${hasBuildium ? "PASS" : "FAIL"}`);
  console.log(`Portfolio has ClockShark (from K1 IM): ${hasClockShark ? "PASS" : "FAIL"}`);
  console.log(`No duplicate Buildium: ${portfolio.filter(c => c === "Buildium").length === 1 ? "PASS" : "FAIL"}`);
}

// --- Test 4: domain-based non-merge — Vista Equity Partners vs Vista Private Equity Group ---
// Different domains (vistaeq.com vs vistaprivateequity.com) — must NOT be merged.
console.log("\n=== Test 4: domain-based non-merge — Vista Equity Partners vs Vista Private Equity Group ===");
const buyers4 = [
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
  {
    success: true,
    sourceUrl: "https://www.vistaprivateequity.com",
    facts: {
      isRelevant: true,
      firmName: "Vista Private Equity Group",
      sectorFocus: "middle-market companies across industrials and services",
      portfolioCompanies: ["CompanyA", "CompanyB"],
      geography: "North America",
      investmentCriteria: "NOT FOUND",
    },
  },
];

const result4 = dedupeBuyers(buyers4);
console.log(JSON.stringify(result4, null, 2));
const vistaNotMerged = result4.length === 2;
console.log(`\nExpected 2 firms (Vista must NOT merge). Got: ${result4.length}. ${vistaNotMerged ? "PASS" : "FAIL"}`);
if (vistaNotMerged) {
  const vep = result4.find(b => b.firmName === "Vista Equity Partners");
  const vpeg = result4.find(b => b.firmName === "Vista Private Equity Group");
  const vepFlagged = vep?.possibleDuplicates?.includes("Vista Private Equity Group");
  const vpegFlagged = vpeg?.possibleDuplicates?.includes("Vista Equity Partners");
  console.log(`Vista Equity Partners flagged against Vista Private Equity Group: ${vepFlagged ? "PASS" : "FAIL"}`);
  console.log(`Vista Private Equity Group flagged against Vista Equity Partners: ${vpegFlagged ? "PASS" : "FAIL"}`);
}

// --- Test 5: first-word flag — H.I.G. Capital vs H.I.G. Private Equity ---
// "hig" is a distinctive first word (not PE boilerplate), so both records get flagged.
console.log("\n=== Test 5: first-word flag — H.I.G. Capital vs H.I.G. Private Equity ===");
const buyers5 = [
  {
    success: true,
    sourceUrl: "https://www.higcapital.com",
    facts: {
      isRelevant: true,
      firmName: "H.I.G. Capital",
      sectorFocus: "middle-market companies across a wide range of industries",
      portfolioCompanies: ["Baird", "Chromcraft Revington"],
      geography: "Global",
      investmentCriteria: "NOT FOUND",
    },
  },
  {
    success: true,
    sourceUrl: "https://www.higpe.com",
    facts: {
      isRelevant: true,
      firmName: "H.I.G. Private Equity",
      sectorFocus: "buyouts of middle-market companies",
      portfolioCompanies: ["Acosta", "Envision Healthcare"],
      geography: "North America",
      investmentCriteria: "$25M–$400M enterprise value",
    },
  },
];

const result5 = dedupeBuyers(buyers5);
console.log(JSON.stringify(result5, null, 2));
const higNotMerged = result5.length === 2;
console.log(`\nExpected 2 firms (H.I.G. must NOT merge — different domains). Got: ${result5.length}. ${higNotMerged ? "PASS" : "FAIL"}`);
if (higNotMerged) {
  const cap = result5.find(b => b.firmName === "H.I.G. Capital");
  const pe  = result5.find(b => b.firmName === "H.I.G. Private Equity");
  const capFlagged = cap?.possibleDuplicates?.includes("H.I.G. Private Equity");
  const peFlagged  = pe?.possibleDuplicates?.includes("H.I.G. Capital");
  console.log(`H.I.G. Capital flagged against H.I.G. Private Equity: ${capFlagged ? "PASS" : "FAIL"}`);
  console.log(`H.I.G. Private Equity flagged against H.I.G. Capital: ${peFlagged ? "PASS" : "FAIL"}`);
}

// --- Test 6: no false-positive flag when first word is generic ---
// "Capital One" and "Capital Partners" both start with "capital" which is in the exclusion list,
// so they must NOT be flagged against each other.
console.log("\n=== Test 6: no false-positive flag for generic first word (Capital ___) ===");
const buyers6 = [
  {
    success: true,
    sourceUrl: "https://www.capitalone.com",
    facts: {
      isRelevant: true,
      firmName: "Capital One",
      sectorFocus: "financial services",
      portfolioCompanies: [],
      geography: "North America",
      investmentCriteria: "NOT FOUND",
    },
  },
  {
    success: true,
    sourceUrl: "https://www.capitalpartners.com",
    facts: {
      isRelevant: true,
      firmName: "Capital Partners",
      sectorFocus: "growth-equity investments",
      portfolioCompanies: [],
      geography: "North America",
      investmentCriteria: "NOT FOUND",
    },
  },
];

const result6 = dedupeBuyers(buyers6);
console.log(JSON.stringify(result6, null, 2));
const noFalseFlag = result6.every(b => (b.possibleDuplicates ?? []).length === 0);
console.log(`\nExpected no flags for generic first word. ${noFalseFlag ? "PASS" : "FAIL"}`);

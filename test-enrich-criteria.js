import { enrichInvestmentCriteria } from "./enrich-criteria.js";

const fiveElms = {
  firmName: "Five Elms Capital",
  sectorFocus: "B2B SaaS and software companies",
  portfolioCompanies: [],
  geography: "North America",
  investmentCriteria: "NOT FOUND",
  sourceUrls: ["https://www.fiveelms.com/portfolio"],
  fit: { fitScore: "Strong", notes: "" },
  confidence: { confidence: "Medium" },
};

const k1 = {
  firmName: "K1 Investment Management",
  sectorFocus: "Enterprise software companies, specifically high-growth SaaS and technology businesses",
  portfolioCompanies: ["simPRO", "ClockShark", "AroFlo"],
  geography: "Global",
  investmentCriteria: "NOT FOUND",
  sourceUrls: [
    "https://k1.com/simpro-a-leading-global-provider-of-field-service-management-software-secures-growth-investment-of-over-350-million-usd",
  ],
  fit: { fitScore: "Strong", notes: "" },
  confidence: { confidence: "Medium" },
};

for (const buyer of [fiveElms, k1]) {
  console.log(`\n── ${buyer.firmName} ──`);
  console.log(`Before: investmentCriteria = "${buyer.investmentCriteria}"`);

  const result = await enrichInvestmentCriteria(buyer);

  console.log(`After:  investmentCriteria = "${result.investmentCriteria}"`);
  if (result.investmentCriteria !== "NOT FOUND") {
    console.log(`Source: ${result.sourceUrls.at(-1)}`);
  }
}

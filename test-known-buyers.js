import { extractFacts } from "./extract-facts.js";

const urls = [
  "https://acorncapitalmanagement.com",
  "https://www.bluestoneinv.com",
  "https://www.dccp.com",
];

for (const url of urls) {
  console.log(`\n── ${url} ──`);
  const result = await extractFacts(url);

  if (!result.success) {
    console.log(`  FAILED: ${result.error}`);
    continue;
  }

  const { facts } = result;
  console.log(`  firmName:           ${facts.firmName}`);
  console.log(`  sectorFocus:        ${facts.sectorFocus}`);
  console.log(`  geography:          ${facts.geography}`);
  console.log(`  investmentCriteria: ${facts.investmentCriteria}`);
  console.log(`  portfolioCompanies: ${facts.portfolioCompanies?.length ? facts.portfolioCompanies.join(", ") : "(none)"}`);
  console.log(`  isRelevant:         ${facts.isRelevant}`);
}

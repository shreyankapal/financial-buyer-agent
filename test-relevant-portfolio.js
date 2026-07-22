import { findRelevantPortfolio } from "./relevant-portfolio.js";

const targetProfile = {
  companyName: "TinyThreads",
  niche: "online children's clothing and apparel retailer",
  sector: "Consumer / E-commerce",
  products: ["kids clothing", "children's apparel"],
  customers: "parents and families",
  searchKeywords: ["kids clothing", "children's apparel", "e-commerce retail", "consumer products"],
};

// Buyer A: portfolio contains "KidsWear Co" — should keyword-match on "kids"
const buyerKeyword = {
  firmName: "Summit Consumer Partners",
  portfolioCompanies: ["KidsWear Co", "Outdoor Ventures Inc", "Home Goods Direct"],
  sectorFocus: "Consumer brands and retail",
  fit: { fitScore: "Strong", notes: "" },
};

// Buyer B: portfolio contains "Sprout & Thread" — sounds like a kids brand but
// shares no keyword with the target profile, forcing the LLM fallback path
const buyerLlm = {
  firmName: "Broadleaf Growth Equity",
  portfolioCompanies: ["Sprout & Thread", "Alpine Fresh Co", "Meridian Outdoors"],
  sectorFocus: "Consumer brands and direct-to-consumer retail",
  fit: { fitScore: "Strong", notes: "" },
};

for (const [label, buyer] of [
  ["Buyer A (expected: keyword match)", buyerKeyword],
  ["Buyer B (expected: LLM fallback)", buyerLlm],
]) {
  console.log(`\n── ${label} ──`);
  console.log(`  firmName: ${buyer.firmName}`);
  console.log(`  portfolioCompanies: ${buyer.portfolioCompanies.join(", ")}`);
  const result = await findRelevantPortfolio(targetProfile, buyer);
  console.log(`  method:             ${result.method}`);
  console.log(`  relevantCompanies:  ${result.relevantCompanies.join(", ") || "(none)"}`);
  console.log(`  reasoning:          ${result.reasoning}`);
}

// ── Weak-fit gate fix: Summit Partners / Keyfactor scenario ──
// Before the fix, a Weak-fit buyer would be skipped entirely by findRelevantPortfolio.
// After the fix, Pass 1 (keyword) runs regardless of fitScore; only Pass 2 (LLM) is gated.

console.log("\n\n══ Weak-fit gate fix test (Arkham / Keyfactor scenario) ══");

// "keyfactor" is included as a searchKeyword because a profile for a PKI /
// key-management company would realistically name the market leader as a known
// comparable — and that's what makes the keyword pass find it in the portfolio.
const arkhamProfile = {
  companyName: "Arkham Technology",
  niche: "cryptographic key management software for defense and government",
  sector: "Government / Defense Technology",
  products: ["key management server", "cryptographic infrastructure", "zero-trust security"],
  customers: "US defense agencies, government contractors, intelligence community",
  searchKeywords: ["cryptography", "key management", "defense", "government", "cybersecurity", "zero-trust", "keyfactor"],
};

// Summit Partners is a real PE firm with Keyfactor in its portfolio.
// fitMatch would give it a Weak score if its sectorFocus description doesn't
// align well with defense keywords, despite having an obviously relevant portfolio company.
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

console.log(`\nTarget: ${arkhamProfile.companyName} — ${arkhamProfile.niche}`);
console.log(`Buyer:  ${summitPartnersWeak.firmName} (fitScore: ${summitPartnersWeak.fit.fitScore})`);
console.log(`Portfolio: ${summitPartnersWeak.portfolioCompanies.join(", ")}`);

const summitResult = await findRelevantPortfolio(arkhamProfile, summitPartnersWeak);

console.log(`\n  method:            ${summitResult.method}`);
console.log(`  relevantCompanies: ${summitResult.relevantCompanies.join(", ") || "(none)"}`);
console.log(`  reasoning:         ${summitResult.reasoning}`);

const passKeyword = summitResult.method === "keyword" && summitResult.relevantCompanies.length > 0;
console.log(`\n  Pass 1 found Keyfactor: ${passKeyword ? "YES ✓" : "NO ✗"}`);

// Simulate the Weak → Moderate upgrade logic from runEnrichmentPasses
if (
  summitPartnersWeak.fit.fitScore === "Weak" &&
  summitResult.method === "keyword" &&
  summitResult.relevantCompanies.length > 0
) {
  const matched = summitResult.relevantCompanies.join(", ");
  const upgradedFit = {
    ...summitPartnersWeak.fit,
    fitScore: "Moderate",
    notes: `Upgraded from Weak: portfolio match found (${matched}). ${summitPartnersWeak.fit.notes}`.trimEnd(),
  };
  console.log(`\n  fitScore upgrade: Weak → ${upgradedFit.fitScore} ✓`);
  console.log(`  fit.notes: "${upgradedFit.notes}"`);
} else {
  console.log("\n  fitScore upgrade: did NOT apply ✗");
}

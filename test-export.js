import { exportBuyers } from "./export.js";

const fakeBuyers = [
  {
    firmName: "GTCR",
    sectorFocus: "Software, Technology, Financial Services",
    portfolioCompanies: ["Solera", "AssuredPartners", "Worldpay"],
    geography: "United States",
    investmentCriteria: "Invests in growth-oriented companies in technology and financial services, typically $100M–$500M equity",
    sourceUrls: ["https://www.gtcr.com/portfolio", "https://www.gtcr.com/about"],
    fit: {
      sectorFit: true,
      geographyFit: true,
      portfolioFit: true,
      fitScore: "Strong",
      notes: "Sector and geography align well; portfolio includes vertical SaaS and field service-adjacent software",
    },
    confidence: {
      confidence: "High",
      populatedFieldCount: 5,
      sourceCount: 2,
      reasoning: "Multiple sources confirm investment thesis and sector focus; portfolio detail is specific",
    },
  },
  {
    firmName: "Vista Equity Partners",
    sectorFocus: "Enterprise Software",
    portfolioCompanies: ["Mindbody", "EZLynx", "Jamf"],
    geography: "United States, Canada",
    investmentCriteria: "Focuses exclusively on enterprise software and SaaS businesses; target $100M+ ARR",
    sourceUrls: ["https://www.vistaequitypartners.com/companies"],
    fit: {
      sectorFit: true,
      geographyFit: true,
      portfolioFit: false,
      fitScore: "Moderate",
      notes: "Strong sector alignment but no direct field service management portfolio companies found",
    },
    confidence: {
      confidence: "Medium",
      populatedFieldCount: 4,
      sourceCount: 1,
      reasoning: "Single source; investment criteria confirmed but portfolio overlap with trades SaaS is thin",
    },
  },
  {
    firmName: "K1 Investment Management",
    sectorFocus: "Vertical SaaS, B2B Software",
    portfolioCompanies: ["ServiceTrade", "Kickserv"],
    geography: "North America",
    investmentCriteria: "Invests in vertical SaaS companies with strong recurring revenue; $10M–$100M ARR",
    sourceUrls: ["https://k1im.com/portfolio", "https://k1im.com/strategy"],
    fit: {
      sectorFit: true,
      geographyFit: true,
      portfolioFit: true,
      fitScore: "Strong",
      notes: "Direct portfolio overlap with field service SaaS; thesis is a strong match",
    },
    confidence: {
      confidence: "High",
      populatedFieldCount: 5,
      sourceCount: 2,
      reasoning: "Two sources, specific portfolio companies in field service software confirmed",
    },
  },
];

const paths = await exportBuyers(fakeBuyers, "TestTarget");
console.log("CSV: ", paths.csvPath);
console.log("XLSX:", paths.xlsxPath);

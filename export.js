import fs from "fs";
import path from "path";
import ExcelJS from "exceljs";

const OUTPUT_DIR = "./output";

const COLUMNS = [
  { header: "Firm Name",              key: "firmName",              width: 28 },
  { header: "Buyer Fit",              key: "fitScore",              width: 12 },
  { header: "Sector Focus",           key: "sectorFocus",           width: 30 },
  { header: "Portfolio Companies",    key: "portfolioCompanies",    width: 40 },
  { header: "Geography",              key: "geography",             width: 20 },
  { header: "Investment Criteria",    key: "investmentCriteria",    width: 40 },
  { header: "Relevant Portfolio",     key: "relevantPortfolio",     width: 35 },
  { header: "Rationale",              key: "rationale",             width: 35 },
  { header: "Fit Notes",              key: "fitNotes",              width: 40 },
  { header: "Confidence Reasoning",   key: "confidenceReasoning",   width: 40 },
  { header: "Source URLs",            key: "sourceUrls",            width: 50 },
  { header: "Agent Confidence",       key: "confidence",            width: 18 },
  { header: "Possible Duplicate",     key: "possibleDuplicate",     width: 35 },
];

function flattenBuyer(buyer) {
  return {
    firmName:             buyer.firmName ?? "",
    fitScore:             buyer.fit?.fitScore ?? "",
    confidence:           buyer.confidence?.confidence ?? "",
    sectorFocus:          buyer.sectorFocus ?? "",
    portfolioCompanies:   (buyer.portfolioCompanies ?? []).join(", "),
    geography:            buyer.geography ?? "",
    investmentCriteria:   buyer.investmentCriteria ?? "",
    relevantPortfolio:    (buyer.relevantPortfolio?.relevantCompanies ?? []).join(", ") || "None identified",
    rationale:            buyer.rationale?.rationale ?? "",
    fitNotes:             buyer.fit?.notes ?? "",
    confidenceReasoning:  buyer.confidence?.reasoning ?? "",
    sourceUrls:           (buyer.sourceUrls ?? []).join(", "),
    possibleDuplicate:    (buyer.possibleDuplicates ?? []).join(", "),
  };
}

function escapeCSVField(value) {
  const str = String(value ?? "");
  if (str.includes('"') || str.includes(",") || str.includes("\n")) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

function buildCSV(rows) {
  const header = COLUMNS.map((c) => escapeCSVField(c.header)).join(",");
  const lines = rows.map((row) =>
    COLUMNS.map((c) => escapeCSVField(row[c.key])).join(",")
  );
  return [header, ...lines].join("\n");
}

function makeTimestamp() {
  const now = new Date();
  return now.toISOString().replace(/[:.]/g, "-").slice(0, 19);
}

function makeSafeBaseName(name) {
  return name.replace(/[^a-zA-Z0-9_-]/g, "-").replace(/-+/g, "-");
}

export async function exportBuyers(buyers, targetCompanyName) {
  if (!fs.existsSync(OUTPUT_DIR)) {
    fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  }

  const rows = buyers.map(flattenBuyer);
  const timestamp = makeTimestamp();
  const base = `${makeSafeBaseName(targetCompanyName)}-buyers-${timestamp}`;
  const csvPath = path.resolve(OUTPUT_DIR, `${base}.csv`);
  const xlsxPath = path.resolve(OUTPUT_DIR, `${base}.xlsx`);

  // Write CSV
  fs.writeFileSync(csvPath, buildCSV(rows), "utf8");

  // Write XLSX
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("Buyers");

  sheet.columns = COLUMNS.map((c) => ({
    header: c.header,
    key: c.key,
    width: c.width,
  }));

  // Bold header row
  sheet.getRow(1).font = { bold: true };

  rows.forEach((row) => sheet.addRow(row));

  await workbook.xlsx.writeFile(xlsxPath);

  return { csvPath, xlsxPath };
}

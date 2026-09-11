import { normalizeForMatch } from "./dedupe.js";

// Operating companies that appear as strategic acquirers in off-sector M&A reports
// but are never PE/investment firms. Names are stored normalized (same transform as
// normalizeForMatch) so matching is always case/punctuation-insensitive.
//
// Automotive dealer management software cluster (from DMS / auto-tech reports):
//   CDK Global, Reynolds & Reynolds, KAR Auction Services, Cox Automotive,
//   Keyloop, Vehlo, Repairify, Cazoo Group, Impel, TSD Mobility Solutions,
//   LeadVenture, OEConnection, J.D. Power
//
// Enterprise tech corporations (not investment firms):
//   Oracle, Cisco, Bosch, Alibaba / Alibaba.com, WiseTech Global,
//   Publicis Groupe, Rakuten Symphony, SoftwareOne, Magnite (ad-tech)
//
// IT / managed services operating companies:
//   HH Global, Koesio, Wavenet, Daisy Corporate Services, Infopro Digital,
//   Lloyd's Register, Impresoft Group, Nomios
//
// Vertical software companies (not PE acquirers):
//   ECI Software Solutions, Trackforce Valiant, IFS (ERP), Fullsteam, Vontier,
//   CargoSprint, Ever.Ag
//
// HR / services companies:
//   First Advantage, JER HR Group, VensureHR, Americo
const DENYLIST_NORMALIZED = new Set([
  // Automotive DMS / fleet / dealer software
  "cdk global",
  "reynolds reynolds",        // Reynolds & Reynolds — & is stripped by normalizeForMatch
  "kar auction services",
  "kar global",
  "cox automotive",
  "keyloop",
  "vehlo",
  "repairify",
  "cazoo group",
  "cazoo",
  "impel",
  "tsd mobility solutions",
  "leadventure",
  "oeconnection",
  "jd power",                 // J.D. Power — dots stripped, spaces collapsed
  // Enterprise tech corporations
  "oracle",
  "cisco",
  "bosch",
  "alibaba",
  "alibabacom",               // Alibaba.com — dot stripped by normalizeForMatch
  "wisetech global limited",
  "wisetech global",
  "publicis groupe",
  "rakuten symphony",
  "softwareone holding",
  "softwareone",
  "magnite",                  // Ad-tech company, not PE
  // IT / managed services / media
  "hh global",
  "koesio",
  "wavenet",
  "daisy corporate services",
  "infopro digital",
  "lloyds register",          // Lloyd's Register — apostrophe stripped
  "impresoft group",
  "nomios",
  // Vertical software operators
  "eci software solutions",
  "eci software",
  "trackforce valiant",
  "ifs",
  "fullsteam",
  "vontier",
  "cargosprint",
  "everag",                   // Ever.Ag — dot stripped
  // HR / services operating companies
  "first advantage",
  "jer hr group",
  "vensurehr",
  "americo",
]);

/**
 * Returns true if the name is a known non-PE operating company that appears as
 * a strategic acquirer in off-sector M&A reports. These names should never be
 * passed to the resolver — they would always be rejected by extractFacts.
 *
 * @param {string} name - Extracted firm name from a report buyer list
 * @returns {boolean}
 */
export function isOperatingCompanyName(name) {
  return DENYLIST_NORMALIZED.has(normalizeForMatch(name));
}

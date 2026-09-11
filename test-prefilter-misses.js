/**
 * Checks the 8 pre-filtered snippets: would extractAcquirer have found
 * a firm name if the pre-filter had let them through?
 */
import "dotenv/config";
import { readdir, readFile } from "fs/promises";
import { join } from "path";
import { extractAcquirer } from "./extract-acquirer.js";

const PRE_FILTERED_URLS = new Set([
  "https://www.globenewswire.com/news-release/2025/02/04/3020477/0/en/INFI-Raises-12-Million-to-Revolutionize-Self-Service-Technology.html",
  "https://www.prnewswire.com/news-releases/multiplier-launches-contractor-of-record-cor-to-manage-contingent-workforce-risks-302476526.html",
  "https://www.prnewswire.com/news-releases/buildots-acquires-genda-in-industry-first-move-to-unite-construction-progress-and-workforce-insights-302586073.html",
  "https://www.pehub.com/warburg-pincus-to-sell-warehouse-management-software-firm-softeon-to-ifs/",
  "https://www.prnewswire.com/news-releases/ecotrak-launches-self-service-cmms-empowering-small-businesses-to-take-control-of-facilities-management-302458187.html",
  "https://www.businesswire.com/news/home/20260505900290/en/QGenda-Unlocks-New-Value-for-Healthcare-Workforce-Management-with-Certified-Integration-to-Workday-Human-Capital-Management",
  "https://www.pehub.com/mayfair-pumps-capital-into-travel-management-software-platform-bizaway/",
  "https://www.pehub.com/serent-capital-sells-business-management-software-provider-landscape-management-network/",
]);

const cacheDir = "./cache";
const files = await readdir(cacheDir);
const snippetMap = new Map();
for (const f of files) {
  try {
    const { key, value } = JSON.parse(await readFile(join(cacheDir, f), "utf8"));
    if (typeof key === "string" && key.includes(":topic:news") && Array.isArray(value)) {
      for (const r of value) {
        if (r.url && r.snippet && PRE_FILTERED_URLS.has(r.url)) {
          snippetMap.set(r.url, r.snippet);
        }
      }
    }
  } catch {}
}

console.log(`Snippets found: ${snippetMap.size}/8\n`);
console.log("─".repeat(80));

let truePositives = 0;
let trueNegatives = 0;

for (const url of PRE_FILTERED_URLS) {
  const snippet = snippetMap.get(url);
  const shortUrl = url.replace(/^https?:\/\/(www\.)?/, "").slice(0, 70);

  if (!snippet) {
    console.log(`MISSING  ${shortUrl}\n`);
    continue;
  }

  console.log(`URL:     ${shortUrl}`);
  console.log(`SNIPPET: ${snippet.slice(0, 200)}`);

  const result = await extractAcquirer(snippet);

  if (result.firmName) {
    truePositives++;
    console.log(`RESULT → FIRM: "${result.firmName}" [${result.method}${result.pattern ? "/" + result.pattern : ""}]  ← GENUINE MISS`);
  } else {
    trueNegatives++;
    console.log(`RESULT → null [${result.method}]  ← correctly blocked`);
  }
  console.log();
}

console.log("─".repeat(80));
console.log(`Genuine misses (pre-filter hid a real firm name) : ${truePositives}`);
console.log(`Correctly blocked (extraction returns null anyway): ${trueNegatives}`);

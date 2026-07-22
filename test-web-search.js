import { webSearch } from "./web-search.js";

const results = await webSearch("private equity firms healthcare services");

console.log(`Results: ${results.length}\n`);
for (const r of results) {
  console.log(`${r.title}\n${r.url}\n`);
}

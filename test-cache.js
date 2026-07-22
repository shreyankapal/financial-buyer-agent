import { getOrFetch } from "./cache.js";
import { fetchPage } from "./fetch-page.js";

const key = "apple-homepage";
const fetcher = () => fetchPage("https://www.apple.com");

console.log("--- Run 1 ---");
const result1 = await getOrFetch(key, fetcher);
console.log("success:", result1.success);
console.log("text preview:", result1.text.slice(0, 200));

console.log("\n--- Run 2 ---");
const result2 = await getOrFetch(key, fetcher);
console.log("success:", result2.success);
console.log("text preview:", result2.text.slice(0, 200));

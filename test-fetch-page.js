import { fetchPage } from "./fetch-page.js";

const result = await fetchPage("https://www.apple.com");

console.log("success:", result.success);
if (result.success) {
  console.log("fetchedAt:", result.fetchedAt);
  console.log("text preview:\n", result.text.slice(0, 500));
} else {
  console.log("error:", result.error);
}

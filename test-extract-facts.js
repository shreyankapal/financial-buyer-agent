import { extractFacts } from "./extract-facts.js";

const result = await extractFacts("https://www.gtcr.com/investments/healthcare");
console.log(JSON.stringify(result, null, 2));

import { profileTarget } from "./profile-target.js";

const result = await profileTarget("https://www.chimneyrock.io");
console.log("\n=== Profile Result ===");
console.log(JSON.stringify(result, null, 2));

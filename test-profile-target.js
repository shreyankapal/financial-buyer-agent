import { profileTarget } from "./profile-target.js";

const result = await profileTarget("https://www.apple.com");
console.log(JSON.stringify(result, null, 2));

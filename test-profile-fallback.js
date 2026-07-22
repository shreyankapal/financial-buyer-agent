import { profileTarget } from "./profile-target.js";

const result = await profileTarget("https://www.toasttab.com");
console.log(JSON.stringify(result, null, 2));

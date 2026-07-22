import { fetchPage } from "./fetch-page.js";
import { extractFacts } from "./extract-facts.js";
import { runPipeline } from "./run-pipeline.js";

function pass(label) { console.log(`  PASS  ${label}`); }
function fail(label, detail) { console.log(`  FAIL  ${label}${detail ? ` — ${detail}` : ""}`); }

// ─── Check 1: extractFacts on a known-403 URL ──────────────────────────────
console.log("\n[1] extractFacts on https://www.toasttab.com");
let threw = false;
let efResult;
try {
  efResult = await extractFacts("https://www.toasttab.com");
} catch (e) {
  threw = true;
  fail("did not throw", `threw instead: ${e.message}`);
}
if (!threw) {
  console.log("    result:", JSON.stringify(efResult));
  if (efResult.success === false && typeof efResult.error === "string") {
    pass("returned { success: false, error: string }");
  } else {
    fail("expected success:false", JSON.stringify(efResult));
  }
}

// ─── Check 2: fetchPage on a known-403 URL ─────────────────────────────────
console.log("\n[2] fetchPage on https://www.toasttab.com");
let threw2 = false;
let fpResult;
try {
  fpResult = await fetchPage("https://www.toasttab.com");
} catch (e) {
  threw2 = true;
  fail("did not throw", `threw instead: ${e.message}`);
}
if (!threw2) {
  console.log("    result:", JSON.stringify(fpResult));
  if (fpResult.success === false && typeof fpResult.error === "string") {
    pass("returned { success: false, error: string } — did not hang or crash");
  } else {
    fail("expected success:false", JSON.stringify(fpResult));
  }
}

// ─── Check 3: full pipeline with urlsFailed in stats ───────────────────────
console.log("\n[3] runPipeline servicetitan.com { maxQueries: 3, maxUrls: 12 }");
let threw3 = false;
let pipeResult;
try {
  pipeResult = await runPipeline("https://www.servicetitan.com", { maxQueries: 3, maxUrls: 12 });
} catch (e) {
  threw3 = true;
  fail("did not throw", `threw instead: ${e.message}`);
}
if (!threw3) {
  if (pipeResult.success !== true) {
    fail("pipeline completed with success:true", `got success:${pipeResult.success}`);
  } else {
    pass("pipeline completed with success:true");
  }

  const stats = pipeResult.stats;
  console.log("    stats:", JSON.stringify(stats));

  if (stats && typeof stats.urlsFailed === "number") {
    pass(`stats.urlsFailed present (${stats.urlsFailed})`);
  } else {
    fail("stats.urlsFailed is a number", `got ${JSON.stringify(stats?.urlsFailed)}`);
  }

  if (stats && typeof stats.uniqueFirms === "number") {
    pass(`pipeline produced ${stats.uniqueFirms} unique firms without crashing`);
  } else {
    fail("stats.uniqueFirms is a number");
  }
}

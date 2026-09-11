# Financial Buyer Agent — Engineering Handoff

**Date:** 2026-09-11
**Repo:** `financial-buyer-agent` (single branch: `main`)

## 1. What this does

Given a target company's URL, the pipeline researches and ranks likely acquirers
(private equity firms and strategic buyers) for that company, then exports the
results to CSV/XLSX. It's a Node.js (ESM) pipeline that chains web search
(Tavily) with Claude (Anthropic SDK) calls for profiling, extraction, and
scoring, fronted by a minimal Express + vanilla-JS web UI.

Run it via the web UI (`npm start` → `http://localhost:3000`) or by importing
`runPipeline()` from `run-pipeline.js` directly (see the many `test-run-*.js`
scripts for examples — there's no CLI entrypoint; `index.js` referenced in
`package.json`'s `"main"` doesn't exist).

## 2. Repo state — read this first

There is **one git commit** (`72b50c2 Initial commit`), but `main` currently
has substantial **uncommitted** work sitting in the working tree:

- Heavy modifications to `run-pipeline.js` (+506 lines), `dedupe.js`,
  `extract-facts.js`, `fit-match.js`, `generate-search-queries.js`,
  `relevant-portfolio.js`, `web-search.js`, `public/index.html`, and their
  matching test files.
- ~20 new untracked files: `extract-acquirer.js`, `extract-report-buyers.js`,
  `fetch-report.js`, `report-buyer-filter.js`, `resolve-acquirer-website.js`,
  `clear-ir-extract-cache.js`, plus a dozen `test-*.js` scripts.

None of this is committed. **Before doing anything else, decide with the team
whether to commit/split this into logical commits** — right now `git blame`
and PR history are useless for understanding any of the new discovery paths
below.

## 3. Architecture: four discovery "buckets"

`runPipeline()` (in `run-pipeline.js`) runs a main round-based search loop,
then layers three additional discovery passes on top. Each pass finds
candidate firm names/URLs, feeds them through the same
`extractFacts → dedupe → fitMatch → scoreConfidence` scoring pipeline, and
tags each buyer with which bucket(s) found it (`discoveredVia`).

```
                    profileTarget(url)
                          │
                          ▼
              generateBuyerQueries(profile)
                          │
     ┌────────────────────┴─────────────────────┐
     ▼                                            ▼
Bucket A: main search loop            (rounds until targetCount
  webSearch → extractFactsWithPage     or maxRounds or queries
  → dedupe → fitMatch → confidence     exhausted; shouldContinueResearch
                          │            decides whether to widen)
                          ▼
Bucket B: listicle rescue
  pages extractFacts rejected but look like PE-firm roundup articles
  → extractReportBuyers (firm names) → resolveAcquirerWebsite → extractFacts
                          │
                          ▼
Bucket C: deal-announcement discovery ("Bucket D" in code)
  generateDealAnnouncementQueries → webSearch(news, press domains)
  → extractAcquirer (regex, then LLM fallback) → resolveAcquirerWebsite
  → extractFacts
                          │
                          ▼
Bucket D: industry-report discovery (newest, still uncommitted)
  generateIndustryReportQueries → webSearch(capstonepartners.com, hl.com)
  → fetchReport (PDF via Tavily extract, HTML via cheerio)
  → extractReportBuyers → resolveAcquirerWebsite → extractFacts
                          │
                          ▼
        runEnrichmentPasses: enrichInvestmentCriteria,
        findRelevantPortfolio, Weak→Moderate upgrade, generateRationale
                          │
                          ▼
              sortBuyers + stats + computeMarketSignal
                          │
                          ▼
                     exportBuyers() → CSV + XLSX in output/
```

`widenPipeline()` re-enters the same scoring pipeline with a higher URL cap,
reusing already-discovered-but-unfetched URLs before spending new search
queries — this is what the "+25/+50/+75 URLs" buttons in the UI call.

Confusingly, the code and comments call the deal-announcement pass "Bucket D"
even though it's really the third bucket added (industry reports came after
and reused letter naming loosely) — don't take the letter literally as an
ordinal.

## 4. Module reference

| File | Role |
|---|---|
| `run-pipeline.js` | Orchestrator: `runPipeline()` and `widenPipeline()`. All four buckets, enrichment, sorting, stats. |
| `profile-target.js` | Fetches the target's homepage (or falls back to search-snippet profiling if the fetch fails) and asks Claude to produce a structured company profile (niche, sector, products, keywords, geography). |
| `generate-search-queries.js` | Builds all query sets: `generateBuyerQueries` (Bucket A, mixes deterministic + LLM-generated queries with near-duplicate Jaccard filtering), `generateDealAnnouncementQueries` (Bucket C, pure string templates), `generateIndustryReportQueries` + `isIndustryReportRelevant` + `buildSectorTerms` (Bucket D). |
| `web-search.js` | Thin Tavily wrapper (`webSearch`) with a default press-domain exclude list, cached by query+options. Exports `DEAL_PRESS_DOMAINS`. |
| `extract-facts.js` | The core PE-firm qualifier: sends page text to Claude with a long system prompt that disqualifies advisors/VCs and requires evidence of direct control investing; returns `isRelevant`, `firmName`, `sectorFocus`, `portfolioCompanies`, `geography`, `investmentCriteria`. |
| `dedupe.js` | Four-pass buyer dedup: exact name → substring containment (union-find) → shared source-domain (union-find) → flag remaining same-first-word firms as `possibleDuplicates`. Also owns `normalizeForMatch` and `isTargetCompany`, used everywhere else to avoid self-matches. |
| `fit-match.js` | Deterministic (no LLM) keyword-overlap scorer: sector/portfolio/geography match → `fitScore` (Strong/Moderate/Weak), with a downgrade rule for generic-word-only matches on thin portfolios. |
| `score-confidence.js` | Deterministic confidence score based on how many of 4 fields are populated and how many source URLs corroborate the record. |
| `research-loop.js` | `shouldContinueResearch` — decides whether Bucket A should run another round (stops at max rounds, exhausted queries, or target usable-buyer count). |
| `enrich-criteria.js` | For Strong/Moderate buyers missing `investmentCriteria`, searches the firm's own site for a strategy page and re-runs extraction on it. |
| `relevant-portfolio.js` | Finds which of a buyer's portfolio companies are relevant comparables to the target — keyword pass first (free), LLM fallback only for Strong/Moderate buyers with no keyword hit. |
| `generate-rationale.js` | Builds a ≤10-word spreadsheet-ready rationale string; deterministic for Moderate/Weak, LLM-polished (validated against word limit) for Strong. |
| `extract-acquirer.js` | Bucket C: pulls the acquiring firm's name out of a deal-announcement snippet via ordered regex patterns, LLM fallback (Haiku) only if regex fails. Also has `isAcquisitionRelevant`, a cheap pre-filter to avoid wasting LLM calls on irrelevant snippets. |
| `extract-report-buyers.js` | Bucket D: finds a "Most Active Buyers"/"Buyer Universe" section in report text via regex heading match, LLM-extracts firm names from that window (or full text if no heading found). |
| `fetch-report.js` | Fetches industry-report URLs — PDFs via Tavily's extract API, HTML via `fetch-page.js`. |
| `report-buyer-filter.js` | Hardcoded denylist (`isOperatingCompanyName`) of ~40 known non-PE operating companies (Oracle, Cisco, CDK Global, etc.) that show up as strategic acquirers in reports but should never be resolved/fetched as PE firms. |
| `resolve-acquirer-website.js` | Turns a bare firm name into a website domain: checks the current run's already-known firms first (free), else web-searches with a domain denylist (LinkedIn, PitchBook, etc.) and a name-must-appear-in-domain guard. |
| `fetch-page.js` | Raw HTML fetch + cheerio text extraction, 10s timeout, browser-like headers (some sites block bare fetches otherwise). |
| `cache.js` | Generic disk cache: `getOrFetch(key, fn)` — SHA-256(key) filename in `cache/`, one JSON file per entry. Every LLM call and every Tavily call in the codebase is wrapped in this. |
| `clear-ir-extract-cache.js` | **One-off migration script**, not a reusable tool — hardcoded to `servicetitan.com`, written to invalidate stale `extract-facts` cache entries after the industry-report resolver's search query changed. Read the file before running it again; it will re-run the ServiceTitan profile/queries against live APIs. |
| `export.js` | Flattens buyer records to a fixed 13-column shape and writes both CSV and XLSX to `output/`, timestamped per run. |
| `server.js` | Express app: `POST /run`, `POST /widen`, `GET /download/:filename`. Single in-memory `lastRunState` slot (not per-session) — a second concurrent run/widen from a different browser tab will clobber it. `runInProgress` is a single global boolean, so the server only supports **one pipeline run at a time, server-wide**. |
| `public/index.html` | Single-page vanilla-JS UI: URL input → results table → CSV/XLSX download links → widen buttons. No framework, no build step. |

## 5. Config & setup

- Node ESM project (`"type": "module"` in `package.json`).
- `.env` (gitignored) needs exactly two keys: `ANTHROPIC_API_KEY`,
  `TAVILY_API_KEY`. No other env vars are read anywhere in the codebase.
- `npm install`, then `npm start` runs `server.js` on port 3000 (hardcoded,
  not configurable via env).
- `cache/` and `output/` are both gitignored and created on demand.

## 6. Caching

Every external call (Anthropic, Tavily) goes through `cache.js`'s
`getOrFetch`, keyed by a descriptive string (e.g. `extract-facts:${url}`,
`web-search:${query}:excl:...`) hashed to a filename under `cache/`. This
makes repeated runs against the same target essentially free after the first
pass, but also means:

- **Cache entries never expire.** If a prompt or extraction schema changes,
  old cached results for the same key will keep being served stale. There's
  no versioning in the cache keys tied to prompt content — only
  `clear-ir-extract-cache.js` exists as a manual, single-purpose way to
  invalidate a specific slice of entries, and it does so by re-deriving the
  affected URLs at runtime rather than by any generic invalidation
  mechanism.
- The `cache/` directory already has 1000+ entries from prior manual runs
  (mostly `Arkham Technology`, `Rhone`, `ServiceTitan` targets, per `output/`
  filenames) — safe to leave in place, but be aware it's essentially a
  fixture set for repeated testing, not disposable scratch.

## 7. Testing

There is **no test runner** — `npm test` just errors
(`"echo \"Error: no test specified\" && exit 1"`). The 41 `test-*.js` files
are standalone Node scripts: each imports the module under test, runs
hand-written cases, and does `console.log` PASS/FAIL comparisons (no
`assert`, no Jest/Mocha/Vitest). Run individually with e.g.
`node test-dedupe.js` and eyeball the output. Several (e.g.
`test-run-pipeline-full.js`, `test-industry-report-live.js`) call the real
`runPipeline()` end-to-end against live APIs — these cost real API credits
and take minutes, not unit tests in the usual sense. If the team wants CI,
this whole layer needs to be ported to a real runner with actual assertions
and fixtures instead of live calls.

## 8. Output

`exportBuyers()` writes both a CSV and XLSX to `output/` per run, named
`{CompanyName}-buyers-{timestamp}.{csv,xlsx}`. Columns: Firm Name, Buyer Fit,
Sector Focus, Portfolio Companies, Geography, Investment Criteria, Relevant
Portfolio, Rationale, Fit Notes, Confidence Reasoning, Source URLs, Agent
Confidence, Possible Duplicate.

## 9. Known rough edges

- **No index.js.** `package.json`'s `"main": "index.js"` points at a file
  that doesn't exist. The only real entrypoints are `server.js` (via
  `npm start`) and manual scripts calling `runPipeline()` directly.
- **Single global run slot.** `server.js`'s `runInProgress` flag and
  `lastRunState` are process-wide, not per-user/session. Multiple concurrent
  users will 409 each other and can clobber each other's widen state.
- **Hardcoded constants scattered through the pipeline** that will need
  tuning as more targets are run: `HARD_URL_CEILING = 60` and
  `WIDEN_URL_CEILING = 500` in `run-pipeline.js`; `GENERIC_ONLY_PORTFOLIO_THRESHOLD = 8`
  in `fit-match.js` (calibrated on one ServiceTitan run per its own comment);
  port `3000` hardcoded in `server.js`.
- **`report-buyer-filter.js`'s denylist is hand-curated and will go stale.**
  It's a fixed list of ~40 operating companies seen in past report runs
  (Oracle, Cisco, CDK Global, etc.). New off-sector reports will surface new
  non-PE names that this list won't catch — expect false positives in Bucket
  D/industry-report output until someone extends it, or until it's replaced
  with a more general heuristic.
- **`clear-ir-extract-cache.js` is not a tool, it's a recorded one-off fix.**
  It hardcodes `https://www.servicetitan.com` as the profiling target. Don't
  run it expecting it to generically clean the cache — it reproduces one
  specific historical cache-invalidation need.
- **Cache has no TTL or prompt-version key.** Changing any system prompt in
  `extract-facts.js`, `profile-target.js`, etc. silently continues serving
  pre-change cached results for URLs already fetched. When iterating on
  prompts, either delete `cache/` or add cache-busting to the key.
- **Rate limiting / concurrency is ad hoc.** Concurrency is capped per-stage
  via a hand-rolled `withConcurrency(items, limit, fn)` helper (limits of
  3–4 hardcoded per call site) rather than a shared rate limiter — fine for
  one interactive user, likely to need real backoff/retry handling before
  this runs unattended or in a batch/multi-tenant setting. There's no retry
  logic anywhere for a failed Anthropic or Tavily call within a stage; a
  failure just gets counted in `urlsFailed` and dropped.
- **The `discoveredVia` reconciliation logic in `run-pipeline.js` (lines
  ~695–721) is dense** — it rebuilds bucket attribution after the fact by
  matching URLs and normalized firm names against three separate `Set`s.
  Worth a closer look/refactor before extending with a fifth bucket.

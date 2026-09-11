import "dotenv/config";
import { extractFactsFromText } from "./extract-facts.js";

// Tests the SYSTEM_PROMPT classification logic using controlled fixture text.
// Each fixture is a representative but synthetic page body for a known firm.
// Synthetic "test-fixture://<name>" URLs give each case its own cache slot so
// results are cached after the first run (no repeated API spend) and are
// isolated from the live pipeline cache.

const FIXTURES = [
  // ── Advisory / intermediary — must be EXCLUDED ─────────────────────────────
  {
    name: "CT Acquisitions",
    url: "test-fixture://ct-acquisitions",
    expectedRelevant: false,
    expectedReason: "buy-side advisory firm, not a capital deployer",
    text: `
CT Acquisitions is a buy-side M&A advisory firm specializing in lower-middle-market
transactions. We help private equity groups and strategic acquirers identify, evaluate,
and acquire businesses across the home-services, HVAC, plumbing, and field-service sectors.

Our advisors act as buy-side representatives throughout the acquisition process: sourcing
targets, running initial outreach, managing due diligence, and coordinating with sellers
to close transactions on behalf of our buyer clients. We represent buyers in M&A
transactions and earn a success fee upon deal close.

Services:
- Buy-side acquisition search and target identification
- M&A advisory and transaction management
- Deal sourcing for private equity buyers
- Sell-side preparation guides and exit readiness consulting

CT Acquisitions does not deploy its own capital and does not hold portfolio companies.
Our role is to connect buyers with sellers and advise clients through the transaction process.
    `.trim(),
  },
  {
    name: "733Park",
    url: "test-fixture://733park",
    expectedRelevant: false,
    expectedReason: "M&A advisory and intermediary, not a direct investor",
    text: `
733 Park is a boutique M&A advisory firm focused on software and technology transactions
in the lower-middle market. We provide buy-side and sell-side advisory services to
private equity firms, family offices, and founders navigating the M&A process.

On the buy-side, we help financial buyers identify and approach acquisition targets
in vertical SaaS and tech-enabled services. We represent buyers in their search for
software businesses and guide them through letter of intent, due diligence, and close.

On the sell-side, we help software founders and owners prepare for exit, position
their business, and connect them with qualified financial and strategic buyers.

We earn transaction fees upon successful deal close. 733 Park does not invest its
own capital or hold ownership in any portfolio companies. We are a deal intermediary
and M&A advisor, not a fund or direct investor.
    `.trim(),
  },

  // ── Venture capital — must be EXCLUDED ─────────────────────────────────────
  {
    name: "Bessemer Venture Partners",
    url: "test-fixture://bessemer-venture-partners",
    expectedRelevant: false,
    expectedReason: "venture capital firm taking minority stakes in early-stage startups",
    text: `
Bessemer Venture Partners is one of the oldest and most successful venture capital
firms in the world. We are a global venture capital fund that backs exceptional
founders building category-defining technology companies.

We invest from seed through Series D, taking minority equity stakes in high-growth
technology startups. Our venture capital funds focus on early-stage and growth-stage
investments across AI & ML, biotech, cloud, consumer, cybersecurity, fintech,
healthcare, and vertical software.

We partner with founders from the earliest days — often making seed and pre-seed
investments before a product has meaningful revenue. We do not acquire control of
companies; we provide venture capital funding in exchange for minority ownership
positions and board representation.

Portfolio companies (minority investments): Shopify, Toast, Procore, Pinterest,
LinkedIn, Twitch, Yelp, Wix, Fiverr, Canva, ServiceTitan, Mindbody, Twilio.

As a venture capital firm, Bessemer supports founders through funding rounds from
seed to IPO, but we do not pursue control acquisitions or buyouts.
    `.trim(),
  },

  // ── PE/buyout with "Ventures" in name — must be INCLUDED ───────────────────
  {
    name: "Greater Sum Ventures",
    url: "test-fixture://greater-sum-ventures",
    expectedRelevant: true,
    expectedReason: "PE buyout firm doing control acquisitions and buy-and-build, despite 'Ventures' in name",
    text: `
Greater Sum Ventures is a private equity firm that acquires and builds vertical
software companies in the lower-middle market. Despite the "Ventures" in our name,
we are not a venture capital firm. We pursue control acquisitions of established,
profitable software businesses — not minority stakes in startups.

Our buy-and-build platform strategy: we acquire majority stakes in founder-owned
vertical software companies with $1M–$5M in ARR, then grow them through operational
improvement and bolt-on acquisitions. We own and control our portfolio companies
as the majority shareholder.

Investment criteria:
- Profitable, founder-owned vertical software or tech-enabled services businesses
- $1M–$5M ARR, lower-middle market
- Control/majority acquisitions only — we do not take minority positions
- Lower-middle market (enterprise value $5M–$30M)

Portfolio companies (majority-owned, acquired businesses):
- FieldClock (agricultural workforce management software)
- Fieldpoint Service Applications (field service management)
- ServiceCore (portable sanitation software)
- Vericast (route accounting software)

We are a PE/buyout firm that acquires, owns, and operates companies — not a venture
fund that backs startups with minority capital.
    `.trim(),
  },

  // ── Known-good PE firms — regression checks, must all be INCLUDED ──────────
  {
    name: "Bregal Sagemount",
    url: "test-fixture://bregal-sagemount",
    expectedRelevant: true,
    expectedReason: "growth PE firm making control/co-control investments in technology companies",
    text: `
Bregal Sagemount is a growth-focused private equity firm. We partner with
management teams to invest in and grow technology-enabled services and software
companies. Our fund has deployed over $2 billion in capital across software,
SaaS, and technology-enabled business services.

We make control and co-control investments in high-growth technology companies,
typically acquiring majority or significant minority stakes with governance rights
that give us effective control over strategic decisions.

Portfolio companies include: GPS Insight (fleet management software), Simpro
(field service management software), FieldRoutes (pest control and lawn care
software), SambaSafety (driver risk management), and Empower (retirement services).

Investment criteria:
- Enterprise value $50M–$500M at entry
- High-growth software and technology-enabled services
- Majority or co-control positions
- North America focus

We are a private equity fund that acquires and holds portfolio companies using
our own capital. Our investors are institutional LPs including pension funds,
endowments, and family offices.
    `.trim(),
  },
  {
    name: "Five Elms Capital",
    url: "test-fixture://five-elms-capital",
    expectedRelevant: true,
    expectedReason: "B2B software PE fund making majority acquisitions of founder-owned SaaS companies",
    text: `
Five Elms Capital is a B2B software private equity fund. We invest in and acquire
bootstrapped, founder-owned software companies that have achieved strong product-market
fit without outside capital.

We make majority investments — typically acquiring 60–80% of the company — in
profitable SaaS businesses with $3M–$20M in ARR. We partner with founding teams
post-acquisition to accelerate growth through go-to-market expansion, product
investment, and strategic add-on acquisitions.

Our fund owns and operates portfolio companies as a controlling shareholder. We
are not a venture firm and do not make minority or seed-stage investments.

Portfolio companies (majority-owned acquisitions):
- Greenway Health (healthcare software)
- Dude Solutions (operations and maintenance software)
- WeddingWire (wedding planning platform)
- Buildout (commercial real estate software)
- RealPage (property management software)

Investment criteria:
- $3M–$20M ARR, profitable or near-profitable
- Bootstrapped or capital-efficient, founder-owned
- B2B software (SaaS preferred)
- Control/majority acquisitions
    `.trim(),
  },
  {
    name: "K1 Investment Management",
    url: "test-fixture://k1-investment-management",
    expectedRelevant: true,
    expectedReason: "enterprise software PE firm pursuing control acquisitions and operational build-out",
    text: `
K1 Investment Management is a private equity firm focused on high-growth enterprise
software companies. We acquire and grow leading SaaS and cloud software businesses
with $5M–$25M in ARR, providing capital and operational expertise to accelerate
their path to market leadership.

We pursue control acquisitions and take majority stakes in enterprise software companies.
Our operational team works alongside management post-acquisition to improve go-to-market
execution, expand into new verticals, and make strategic add-on acquisitions.

Portfolio companies (acquired and majority-owned):
- simPRO (field service management, acquired)
- Buildium (property management software, acquired)
- ClockShark (workforce time tracking, acquired)
- Checkmarx (application security, acquired)
- Clarizen (project management software, acquired)
- Granicus (government software, acquired)
- WorkForce Software (workforce management, acquired)

Investment criteria:
- $5M–$25M ARR enterprise software
- High-growth SaaS or cloud-delivered software
- Control/majority acquisitions
- Global reach, North America focus
    `.trim(),
  },
];

// ── Run all fixtures ──────────────────────────────────────────────────────────

let passed = 0;
let failed = 0;

for (const fixture of FIXTURES) {
  process.stdout.write(`\n${fixture.name} (expected: isRelevant=${fixture.expectedRelevant}) ... `);
  const result = await extractFactsFromText(fixture.url, fixture.text);

  if (!result.success) {
    console.log(`ERROR — ${result.error}`);
    failed++;
    continue;
  }

  const actual = result.facts.isRelevant;
  const ok = actual === fixture.expectedRelevant;

  if (ok) {
    console.log(`PASS`);
    if (actual) {
      console.log(`  firmName: ${result.facts.firmName}`);
      console.log(`  sectorFocus: ${result.facts.sectorFocus?.slice(0, 100)}`);
    }
    passed++;
  } else {
    console.log(`FAIL — got isRelevant=${actual}`);
    console.log(`  expected reason: ${fixture.expectedReason}`);
    if (result.facts.firmName) console.log(`  firmName: ${result.facts.firmName}`);
    failed++;
  }
}

console.log(`\n${"─".repeat(55)}`);
console.log(`Results: ${passed} passed, ${failed} failed out of ${FIXTURES.length} fixtures`);
if (failed > 0) process.exit(1);

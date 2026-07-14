import test from "node:test";
import assert from "node:assert/strict";
import {
  classifyConstructionOpportunity,
  isCaltransAdvertisedProject,
  type ConstructionCandidate,
} from "../src/lib/constructionOpportunity.ts";
import {
  classifyForYouSection,
  type BidProfileParams,
  type EstimateCandidate,
} from "../src/lib/bidProfileMatching.ts";
import { isAllTabMember, type TabCandidate } from "../src/lib/opportunityTabs.ts";

const FUTURE = new Date(Date.now() + 30 * 86_400_000).toISOString();
const M = 1_000_000;
const RIVERSIDE_PROFILE: BidProfileParams = {
  targetCounties: ["Riverside"],
  minProjectValue: M,
  maxProjectValue: 5 * M,
};

const classify = (candidate: ConstructionCandidate) => classifyConstructionOpportunity(candidate).isConstruction;
type TestCandidate = TabCandidate & EstimateCandidate;
const inventoryCandidate = (overrides: Partial<TestCandidate> = {}): TestCandidate => ({
  id: "candidate-1",
  bid_due_at: FUTURE,
  ingestion_status: "valid",
  canonical_candidate_id: null,
  raw_title: "Ambiguous solicitation",
  ...overrides,
});

test("dedicated Caltrans portal_type is the authoritative advertised-project signal", () => {
  const candidate = { portal_type: "caltrans", raw_title: "04-1X2304" };
  assert.equal(isCaltransAdvertisedProject(candidate), true);
  assert.deepEqual(classifyConstructionOpportunity(candidate), {
    isConstruction: true,
    confidence: "authoritative",
    reasons: ["Dedicated Caltrans advertised-projects driver (portal_type=caltrans)"],
  });
});

test("Caltrans candidates enter the correct For You section only after geography and price gates", () => {
  const base = { portal_type: "caltrans", raw_title: "04-1X2304", county: "Riverside" };
  assert.equal(classifyForYouSection({ ...base, estimated_value: 2 * M }, RIVERSIDE_PROFILE), "confirmed");
  assert.equal(classifyForYouSection(base, RIVERSIDE_PROFILE), "unpriced");
  assert.equal(classifyForYouSection({ ...base, estimated_value: 8 * M }, RIVERSIDE_PROFILE), null);
  assert.equal(classifyForYouSection({ ...base, county: "Orange", estimated_value: 2 * M }, RIVERSIDE_PROFILE), null);
  assert.equal(isAllTabMember(inventoryCandidate({ ...base, estimated_value: 8 * M })), true);
});

test("Caltrans authority never bypasses validity, canonical, open, or global-exclusion gates", () => {
  const caltrans = {
    portal_type: "caltrans",
    raw_title: "04-1X2304",
    county: "Riverside",
    estimated_value: 2 * M,
  };
  const blocked = [
    inventoryCandidate({ ...caltrans, ingestion_status: "quarantined" }),
    inventoryCandidate({ ...caltrans, canonical_candidate_id: "canonical-caltrans-id" }),
    inventoryCandidate({ ...caltrans, bid_due_at: "2020-01-01T00:00:00.000Z" }),
    inventoryCandidate({ ...caltrans, global_exclusion_reason: "Invalid shared record" }),
  ];
  for (const candidate of blocked) {
    assert.equal(isAllTabMember(candidate), false);
    assert.equal(isAllTabMember(candidate) && classifyForYouSection(candidate, RIVERSIDE_PROFILE) !== null, false);
  }
});

test("Cal eProcure duplicate cannot bypass canonical deduplication", () => {
  const duplicate = inventoryCandidate({
    portal_type: "caleprocure",
    raw_title: "Caltrans road paving contract",
    canonical_candidate_id: "canonical-caltrans-id",
    county: "Riverside",
    estimated_value: 2 * M,
  });
  const forYouMember = isAllTabMember(duplicate)
    && classifyForYouSection(duplicate, RIVERSIDE_PROFILE) !== null;
  assert.equal(forYouMember, false);
});

test("generic Caltrans mention never receives the authoritative source override", () => {
  const candidate = { portal_type: "caleprocure", raw_title: "Administrative support for Caltrans" };
  const result = classifyConstructionOpportunity(candidate);
  assert.equal(isCaltransAdvertisedProject(candidate), false);
  assert.equal(result.isConstruction, false);
  assert.equal(result.confidence, "insufficient");
});

test("representative physical construction scopes qualify", () => {
  const cases: ConstructionCandidate[] = [
    { raw_title: "New library construction" },
    { raw_title: "Road paving project" },
    { raw_title: "Storm Drain Rehabilitation" },
    { raw_title: "Community Park Master Plan", scope_text: "Construct new playground and park improvements" },
    { raw_title: "Building renovation" },
    { raw_title: "Water main replacement" },
    { raw_title: "Concrete sidewalk improvements" },
    { raw_title: "Vague project", required_licenses: ["Class B"] },
    { raw_title: "Vague project", required_naics: ["237310"] },
  ];
  for (const candidate of cases) assert.equal(classify(candidate), true, JSON.stringify(candidate));
});

test("representative goods and non-construction services do not qualify", () => {
  const titles = [
    "Purchase of screws and fasteners",
    "Screwdriver purchase",
    "Light bulb procurement",
    "Software subscription renewal",
    "Temporary staffing services",
    "Financial consulting services",
    "Construction management services",
    "Equipment purchase without installation",
    "Material supply only",
    "Janitorial services",
  ];
  for (const raw_title of titles) assert.equal(classify({ raw_title }), false, raw_title);
});

test("mixed signals distinguish field construction from lookalike language", () => {
  assert.equal(classify({ raw_title: "Supply and install water main" }), true);
  assert.equal(classify({ raw_title: "Construction management consulting services" }), false);
  assert.equal(classify({ raw_title: "Software installation services" }), false);
  assert.equal(classify({ raw_title: "Roof repair" }), true);
  assert.equal(classify({ raw_title: "Purchase of roofing materials only" }), false);
});

test("existing normalized classifications and structured evidence take precedence", () => {
  assert.equal(classify({ raw_title: "Vague", crawl_data: { public_works: true } }), true);
  assert.equal(classify({ raw_title: "Vague", crawl_data: { relevance_category: "software_it" } }), false);
  assert.equal(classify({ raw_title: "Software subscription", required_licenses: ["C-10"] }), true);
});

test("ambiguous opportunity is excluded from For You but remains in All", () => {
  const ambiguous = inventoryCandidate({ county: "Riverside", estimated_value: 2 * M });
  assert.equal(classifyForYouSection(ambiguous, RIVERSIDE_PROFILE), null);
  assert.equal(isAllTabMember(ambiguous), true);
});

test("records excluded solely by construction evidence remain in All", () => {
  const records = [
    inventoryCandidate({ id: "software", raw_title: "Software subscription", county: "Riverside", estimated_value: 2 * M }),
    inventoryCandidate({ id: "tools", raw_title: "Purchase of hand tools", county: "Riverside" }),
  ];
  for (const record of records) {
    assert.equal(classifyForYouSection(record, RIVERSIDE_PROFILE), null);
    assert.equal(isAllTabMember(record), true);
  }
});

test("For You count equals the post-construction confirmed plus unpriced sections", () => {
  const candidates = [
    inventoryCandidate({ id: "priced-construction", raw_title: "Building renovation", county: "Riverside", estimated_value: 2 * M }),
    inventoryCandidate({ id: "unpriced-construction", raw_title: "Road paving", county: "Riverside" }),
    inventoryCandidate({ id: "priced-software", raw_title: "Software subscription", county: "Riverside", estimated_value: 2 * M }),
    inventoryCandidate({ id: "unpriced-tools", raw_title: "Purchase of hand tools", county: "Riverside" }),
  ];
  const sections = candidates
    .filter((candidate) => isAllTabMember(candidate))
    .map((candidate) => classifyForYouSection(candidate, RIVERSIDE_PROFILE));
  const confirmed = sections.filter((section) => section === "confirmed").length;
  const unpriced = sections.filter((section) => section === "unpriced").length;
  const badgeCount = sections.filter(Boolean).length;
  assert.equal(confirmed, 1);
  assert.equal(unpriced, 1);
  assert.equal(badgeCount, confirmed + unpriced);
});

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

const LACMTA_PARTS_SUMMARY = "This is a supply contract rather than construction; no field labor, facility work, or installation project is included.";

test("approved LA Metro construction projects pass the For You construction gate", () => {
  const approved: ConstructionCandidate[] = [
    { portal_type: "lacmta", portal_bid_id: "C137794(2)", raw_title: "Doran Street Grade Separation Segment 1 Glendale" },
    { portal_type: "lacmta", portal_bid_id: "OP141432", raw_title: "Union Station Gateway Data Center HVAC and Power Improvement" },
    { portal_type: "lacmta", portal_bid_id: "OP1421678370", raw_title: "Fire-Life Safety Systems Testing & Repair Services" },
    {
      portal_type: "lacmta",
      portal_bid_id: "OP138358",
      raw_title: "A Line South LiDAR Wayside Intrusion Detection System",
      portal_summary: "Installation and integration of a LiDAR-based wayside intrusion detection system along the A Line South rail corridor.",
    },
  ];
  for (const candidate of approved) assert.equal(classify(candidate), true, candidate.raw_title);
});

test("the complete audited LA Metro snapshot resolves to four For You projects and 49 All-only records", () => {
  const approved = new Set(["C137794(2)", "OP141432", "OP1421678370", "OP138358"]);
  const audited: ConstructionCandidate[] = [
    { portal_bid_id: "AE141998", raw_title: "CEQA/NEPA Environmental Compliance RFP" },
    { portal_bid_id: "C137794(2)", raw_title: "Doran Street Grade Separation Segment 1 Glendale" },
    { portal_bid_id: "DR135523", raw_title: "Hi-rail Backhoe with Trailer and Ballast Tamper" },
    { portal_bid_id: "MA130013", raw_title: "Rotors, Disc Brakes, Front and Rear" },
    { portal_bid_id: "MM144166", raw_title: "Treadle Assembly, Brake" },
    { portal_bid_id: "MM144170", raw_title: "Valve Assembly, Auto Drain, 12V", portal_summary: LACMTA_PARTS_SUMMARY },
    { portal_bid_id: "MM144174", raw_title: "Barrier Switch Communication Control Unit Assembly" },
    { portal_bid_id: "OP137196(3)", raw_title: "Grease Interceptor Services" },
    { portal_bid_id: "OP138358", raw_title: "A Line South LiDAR Wayside Intrusion Detection System", portal_summary: "Rail corridor installation of a wayside intrusion detection system." },
    { portal_bid_id: "OP141269", raw_title: "Stertil Koni Battery Mobile Column Lifts", portal_summary: "Equipment purchase without installation." },
    { portal_bid_id: "OP141432", raw_title: "Union Station Gateway Data Center HVAC and Power Improvement" },
    { portal_bid_id: "OP141742", raw_title: "Hi-Rail Maintenance Vehicle", portal_summary: "Procurement of one maintenance vehicle." },
    { portal_bid_id: "OP1421678370", raw_title: "Fire-Life Safety Systems Testing & Repair Services" },
    { portal_bid_id: "OP142724", raw_title: "Hi-Rail Inspection Vehicle", portal_summary: "Purchase of one new inspection vehicle." },
    { portal_bid_id: "OP144145", raw_title: "Oil Analysis Service and Kits" },
    { portal_bid_id: "PS135817", raw_title: "DEIBA Consulting Services Bench" },
    { portal_bid_id: "PS140918", raw_title: "Safety and Health Assessment Review Program" },
    { portal_bid_id: "PS141682", raw_title: "Managed Security Operations Center Service Provider" },
    { portal_bid_id: "PS143477", raw_title: "High-Rise Fire Safety Program and Training" },
    { portal_bid_id: "PS143587", raw_title: "Pre-Qualified DBE Program Technical Assistance Consultants" },
    { portal_bid_id: "RQ143445(2)", raw_title: "Communications Module" },
    { portal_bid_id: "RQ143547(2)", raw_title: "Engine Harness" },
    { portal_bid_id: "RQ143551(2)", raw_title: "Driver's LCD Monitor" },
    { portal_bid_id: "RQ143655(2)", raw_title: "Drag Link Assembly, Steering Gearbox to Axle", portal_summary: LACMTA_PARTS_SUMMARY },
    { portal_bid_id: "RQ143658(2)", raw_title: "Color Camera, DVR System" },
    { portal_bid_id: "RQ143662(2)", raw_title: "Hydraulic Block Accumulator" },
    { portal_bid_id: "RQ143676(2)", raw_title: "Handheld Radio Battery", portal_summary: LACMTA_PARTS_SUMMARY },
    { portal_bid_id: "RQ143689(2)", raw_title: "Kneeling 24V Valve Block" },
    { portal_bid_id: "RQ143693(2)", raw_title: "Driver's Sash Glass" },
    { portal_bid_id: "RQ143920(2)", raw_title: "Access/Radiator Door Assembly", portal_summary: LACMTA_PARTS_SUMMARY },
    { portal_bid_id: "RQ143927(2)", raw_title: "Exterior Wheel-Well Fender" },
    { portal_bid_id: "RQ143932(2)", raw_title: "Noraplan Flooring Material" },
    { portal_bid_id: "RQ143935(2)", raw_title: "Exit-Door Mechanism Motor" },
    { portal_bid_id: "RQ143987(2)", raw_title: "Driver's Seat Assembly", portal_summary: LACMTA_PARTS_SUMMARY },
    { portal_bid_id: "RQ144131", raw_title: "LED Bollard Light", portal_summary: LACMTA_PARTS_SUMMARY },
    { portal_bid_id: "RQ144142", raw_title: "Drag-Link Ball Joint" },
    { portal_bid_id: "RQ144152", raw_title: "Internal Cylinder Screw" },
    { portal_bid_id: "RQ144154", raw_title: "WLAN Antenna, Charge Rail" },
    { portal_bid_id: "RQ144155", raw_title: "Rackmount StreamVault Appliance" },
    { portal_bid_id: "RQ144156", raw_title: "Abrasive Scrub Brush/Broom", portal_summary: LACMTA_PARTS_SUMMARY },
    { portal_bid_id: "RQ144159", raw_title: "CNG Contact Cleaner" },
    { portal_bid_id: "RQ144162", raw_title: "Gasket/Housing/Tensioner Set" },
    { portal_bid_id: "RQ144163", raw_title: "Harness, Head Assembly, Sensor", portal_summary: LACMTA_PARTS_SUMMARY },
    { portal_bid_id: "RQ144177", raw_title: "Contact-Wire Clamp" },
    { portal_bid_id: "RQ144182", raw_title: "Cab Reading-Light Resistor", portal_summary: LACMTA_PARTS_SUMMARY },
    { portal_bid_id: "RQ144183", raw_title: "Brake-Pad Wear-Indicator Kit" },
    { portal_bid_id: "RQ144188", raw_title: "Harness, Module, Rod, Shaft", portal_summary: LACMTA_PARTS_SUMMARY },
    { portal_bid_id: "RQ144189", raw_title: "Handheld-Radio Battery" },
    { portal_bid_id: "RQ144192", raw_title: "Wheelchair-Ramp Drive-Chain Tensioner" },
    { portal_bid_id: "RQ144195", raw_title: "Curbside Windshield" },
    { portal_bid_id: "RQ144199", raw_title: "24V Hydraulic Pump Assembly" },
    { portal_bid_id: "RQ144201", raw_title: "Nitrile-Coated Gloves" },
    { portal_bid_id: "SD143358", raw_title: "Exhaust Tube Assembly" },
  ].map((candidate) => ({ ...candidate, portal_type: "lacmta" }));

  assert.equal(audited.length, 53);
  const actualForYou = audited.filter((candidate) => classify(candidate));
  assert.deepEqual(actualForYou.map((candidate) => candidate.portal_bid_id).sort(), [...approved].sort());
  for (const candidate of audited) {
    assert.equal(classify(candidate), approved.has(candidate.portal_bid_id!), candidate.raw_title);
  }
});

test("bare generated-summary construction references and misleading installation language cannot rescue parts", () => {
  const negativeCases: ConstructionCandidate[] = [
    { raw_title: "Administrative procurement", portal_summary: "This is not a construction project." },
    { raw_title: "Administrative procurement", portal_summary: "This is a supply contract rather than construction." },
    { raw_title: "Administrative procurement", portal_summary: "Construction-related context only; no physical work is being procured." },
    {
      portal_type: "lacmta",
      portal_bid_id: "RQ143658(2)",
      raw_title: "Color Camera, DVR System",
      portal_summary: "Supplying and installing color cameras for transit operations.",
    },
    {
      portal_type: "lacmta",
      portal_bid_id: "RQ144154",
      raw_title: "WLAN Antenna, Charge Rail",
      portal_summary: "Installation and integration wording appears in a generated summary.",
    },
    {
      portal_type: "lacmta",
      portal_bid_id: "RQ144177",
      raw_title: "Contact-Wire Clamp",
      portal_summary: "Installation wording appears in a generated summary.",
    },
  ];
  for (const candidate of negativeCases) assert.equal(classify(candidate), false, candidate.raw_title);
});

test("LACMTA prefixes support a parts decision but do not become a blanket exclusion", () => {
  assert.equal(classify({
    portal_type: "lacmta",
    portal_bid_id: "RQ999999",
    raw_title: "Facility HVAC System",
    scope_text: "Field labor to install and integrate the HVAC system at the rail facility.",
  }), true);
  assert.equal(classify({
    portal_type: "lacmta",
    portal_bid_id: "RQ999998",
    raw_title: "Valve Assembly",
    portal_summary: "This is not a construction project.",
  }), false);
});

test("LA Metro parts removed solely by construction hardening remain in All", () => {
  const part = inventoryCandidate({
    portal_type: "lacmta",
    portal_bid_id: "RQ144182",
    raw_title: "Cab Reading-Light Resistor",
    portal_summary: LACMTA_PARTS_SUMMARY,
    county: "Riverside",
  });
  assert.equal(classifyForYouSection(part, RIVERSIDE_PROFILE), null);
  assert.equal(isAllTabMember(part), true);
});

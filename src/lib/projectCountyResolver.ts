import { isValidCACounty } from "./californiaRegions.ts";

const CITY_TO_COUNTY: Record<string, string> = {
  alhambra: "Los Angeles",
  anaheim: "Orange",
  bakersfield: "Kern",
  burbank: "Los Angeles",
  carlsbad: "San Diego",
  cerritos: "Los Angeles",
  "chula vista": "San Diego",
  compton: "Los Angeles",
  corona: "Riverside",
  "costa mesa": "Orange",
  downey: "Los Angeles",
  "el monte": "Los Angeles",
  escondido: "San Diego",
  fontana: "San Bernardino",
  fresno: "Fresno",
  fullerton: "Orange",
  "garden grove": "Orange",
  glendale: "Los Angeles",
  "huntington beach": "Orange",
  inglewood: "Los Angeles",
  irvine: "Orange",
  lancaster: "Los Angeles",
  "long beach": "Los Angeles",
  "los angeles": "Los Angeles",
  murrieta: "Riverside",
  norwalk: "Los Angeles",
  oceanside: "San Diego",
  ontario: "San Bernardino",
  orange: "Orange",
  oxnard: "Ventura",
  palmdale: "Los Angeles",
  pasadena: "Los Angeles",
  pomona: "Los Angeles",
  riverside: "Riverside",
  sacramento: "Sacramento",
  "san bernardino": "San Bernardino",
  "san diego": "San Diego",
  "san francisco": "San Francisco",
  "san jose": "Santa Clara",
  "santa ana": "Orange",
  "santa clarita": "Los Angeles",
  "santa monica": "Los Angeles",
  torrance: "Los Angeles",
  "victorville": "San Bernardino",
};

function normalizeText(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function normalizeCounty(value: unknown): string | null {
  const text = normalizeText(value);
  if (!text) return null;
  const cleaned = text.replace(/\s+county$/i, "").trim();
  const match = Object.values(CITY_TO_COUNTY).find(
    (county) => county.toLowerCase() === cleaned.toLowerCase(),
  );
  if (match && isValidCACounty(match)) return match;
  return isValidCACounty(cleaned) ? cleaned : null;
}

function countyFromCity(value: unknown): string | null {
  const text = normalizeText(value);
  if (!text) return null;
  const normalized = text.toLowerCase().replace(/\s+/g, " ").trim();
  return CITY_TO_COUNTY[normalized] ?? null;
}

function countyFromAddress(value: unknown): string | null {
  const text = normalizeText(value);
  if (!text) return null;
  const normalized = text.toLowerCase();
  for (const [city, county] of Object.entries(CITY_TO_COUNTY)) {
    const escapedCity = city.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    if (new RegExp(`\\b${escapedCity}\\b`, "i").test(normalized)) return county;
  }
  return null;
}

export function resolveProjectCounty(input: {
  county?: unknown;
  crawlData?: Record<string, unknown> | null;
  projectAddress?: unknown;
  city?: unknown;
  agency?: unknown;
}): string | null {
  const crawl = input.crawlData ?? {};
  return (
    normalizeCounty(input.county) ??
    normalizeCounty(crawl.county) ??
    normalizeCounty(crawl.project_county) ??
    normalizeCounty(crawl.location_county) ??
    countyFromCity(input.city) ??
    countyFromCity(crawl.city) ??
    countyFromCity(crawl.project_city) ??
    countyFromAddress(input.projectAddress) ??
    countyFromAddress(crawl.project_address) ??
    countyFromAddress(crawl.location) ??
    countyFromAddress(crawl.address) ??
    countyFromAddress(crawl.project_location) ??
    countyFromAddress(input.agency)
  );
}

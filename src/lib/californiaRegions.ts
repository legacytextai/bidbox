/**
 * California County-to-Region mapping for bid list filtering.
 * Deterministic mapping - each county belongs to exactly one region.
 */

export const CA_REGIONS = {
  SOUTHERN_CA: [
    "Imperial",
    "Los Angeles",
    "Orange",
    "Riverside",
    "San Bernardino",
    "San Diego",
    "Ventura",
  ],
  CENTRAL_CA: [
    "Fresno",
    "Inyo",
    "Kern",
    "Kings",
    "Madera",
    "Mariposa",
    "Merced",
    "Mono",
    "Monterey",
    "San Benito",
    "San Joaquin",
    "San Luis Obispo",
    "Santa Barbara",
    "Santa Cruz",
    "Stanislaus",
    "Tulare",
    "Tuolumne",
  ],
  NORTHERN_CA: [
    "Alameda",
    "Alpine",
    "Amador",
    "Butte",
    "Calaveras",
    "Colusa",
    "Contra Costa",
    "Del Norte",
    "El Dorado",
    "Glenn",
    "Humboldt",
    "Lake",
    "Lassen",
    "Marin",
    "Mendocino",
    "Modoc",
    "Napa",
    "Nevada",
    "Placer",
    "Plumas",
    "Sacramento",
    "San Francisco",
    "San Mateo",
    "Santa Clara",
    "Shasta",
    "Sierra",
    "Siskiyou",
    "Solano",
    "Sonoma",
    "Sutter",
    "Tehama",
    "Trinity",
    "Yolo",
    "Yuba",
  ],
} as const;

export type CARegion = keyof typeof CA_REGIONS;

export const REGION_DISPLAY_NAMES: Record<CARegion, string> = {
  SOUTHERN_CA: "Southern California",
  CENTRAL_CA: "Central California",
  NORTHERN_CA: "Northern California",
};

/**
 * All 58 California counties sorted alphabetically
 */
export const CA_COUNTIES: string[] = [
  ...CA_REGIONS.SOUTHERN_CA,
  ...CA_REGIONS.CENTRAL_CA,
  ...CA_REGIONS.NORTHERN_CA,
].sort();

/**
 * Get the region for a given county
 */
export function getRegionForCounty(county: string): CARegion | null {
  const normalizedCounty = county.trim();
  
  for (const region of Object.keys(CA_REGIONS) as CARegion[]) {
    const counties = CA_REGIONS[region] as readonly string[];
    if (counties.includes(normalizedCounty)) {
      return region;
    }
  }
  
  return null;
}

/**
 * Get the display name for a region
 */
export function getRegionDisplayName(county: string): string | null {
  const region = getRegionForCounty(county);
  return region ? REGION_DISPLAY_NAMES[region] : null;
}

/**
 * Get all counties in the same region as the given county
 */
export function getCountiesInRegion(county: string): string[] {
  const region = getRegionForCounty(county);
  if (!region) return [];
  return [...CA_REGIONS[region]];
}

/**
 * Check if a county is a valid California county
 */
export function isValidCACounty(county: string): boolean {
  return CA_COUNTIES.includes(county.trim());
}

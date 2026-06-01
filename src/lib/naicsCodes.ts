export interface NaicsCode {
  code: string;
  description: string;
}

export interface NaicsSector {
  sector: string;
  description: string;
  codes: NaicsCode[];
}

// NAICS 2022 — Construction sector subsectors in scope.
// To add a new sector, append an entry to NAICS_SECTORS.
export const NAICS_SECTORS: NaicsSector[] = [
  {
    sector: "236",
    description: "Construction of Buildings",
    codes: [
      { code: "236115", description: "New Single-Family Housing Construction (except For-Sale Builders)" },
      { code: "236116", description: "New Multifamily Housing Construction (except For-Sale Builders)" },
      { code: "236117", description: "New Housing For-Sale Builders" },
      { code: "236118", description: "Residential Remodelers" },
      { code: "236210", description: "Industrial Building Construction" },
      { code: "236220", description: "Commercial and Institutional Building Construction" },
    ],
  },
  {
    sector: "237",
    description: "Heavy and Civil Engineering Construction",
    codes: [
      { code: "237110", description: "Water and Sewer Line and Related Structures Construction" },
      { code: "237120", description: "Oil and Gas Pipeline and Related Structures Construction" },
      { code: "237130", description: "Power and Communication Line and Related Structures Construction" },
      { code: "237210", description: "Land Subdivision" },
      { code: "237310", description: "Highway, Street, and Bridge Construction" },
      { code: "237990", description: "Other Heavy and Civil Engineering Construction" },
    ],
  },
  {
    sector: "238",
    description: "Specialty Trade Contractors",
    codes: [
      { code: "238110", description: "Poured Concrete Foundation and Structure Contractors" },
      { code: "238120", description: "Structural Steel and Precast Concrete Contractors" },
      { code: "238130", description: "Framing Contractors" },
      { code: "238140", description: "Masonry Contractors" },
      { code: "238150", description: "Glass and Glazing Contractors" },
      { code: "238160", description: "Roofing Contractors" },
      { code: "238170", description: "Siding Contractors" },
      { code: "238190", description: "Other Foundation, Structure, and Building Exterior Contractors" },
      { code: "238210", description: "Electrical Contractors and Other Wiring Installation Contractors" },
      { code: "238220", description: "Plumbing, Heating, and Air-Conditioning Contractors" },
      { code: "238290", description: "Other Building Equipment Contractors" },
      { code: "238310", description: "Drywall and Insulation Contractors" },
      { code: "238320", description: "Painting and Wall Covering Contractors" },
      { code: "238330", description: "Flooring Contractors" },
      { code: "238340", description: "Tile and Terrazzo Contractors" },
      { code: "238350", description: "Finish Carpentry Contractors" },
      { code: "238390", description: "Other Building Finishing Contractors" },
      { code: "238910", description: "Site Preparation Contractors" },
      { code: "238990", description: "All Other Specialty Trade Contractors" },
    ],
  },
];

// Flat list of all codes across all sectors — use for dropdowns and lookups.
export const ALL_NAICS_CODES: NaicsCode[] = NAICS_SECTORS.flatMap((s) => s.codes);

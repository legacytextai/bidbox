/**
 * California contractor license classes used by the qualification profile.
 * Class A/B are generals; the C-list covers the most common public-works
 * specialty classes a GC would self-perform or pre-qualify for.
 */
export interface LicenseClassOption {
  code: string;
  name: string;
}

export const LICENSE_CLASSES: LicenseClassOption[] = [
  { code: "A", name: "General Engineering Contractor" },
  { code: "B", name: "General Building Contractor" },
  { code: "B-2", name: "Residential Remodeling Contractor" },
  { code: "C-7", name: "Low Voltage Systems" },
  { code: "C-8", name: "Concrete" },
  { code: "C-10", name: "Electrical" },
  { code: "C-12", name: "Earthwork and Paving" },
  { code: "C-15", name: "Flooring and Floor Covering" },
  { code: "C-20", name: "Warm-Air Heating, Ventilating and Air-Conditioning" },
  { code: "C-27", name: "Landscaping" },
  { code: "C-29", name: "Masonry" },
  { code: "C-32", name: "Parking and Highway Improvement" },
  { code: "C-33", name: "Painting and Decorating" },
  { code: "C-34", name: "Pipeline" },
  { code: "C-35", name: "Lathing and Plastering" },
  { code: "C-36", name: "Plumbing" },
  { code: "C-39", name: "Roofing" },
  { code: "C-42", name: "Sanitation System" },
  { code: "C-46", name: "Solar" },
  { code: "C-51", name: "Structural Steel" },
  { code: "C-61", name: "Limited Specialty" },
];

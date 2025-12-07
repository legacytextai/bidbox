# California CSLB License Types Reference

**For BidBox Trade Selection Feature**  
Last Updated: 2025-12-07

---

## Overview

This document defines the California Contractors State License Board (CSLB) license types used in BidBox's Trade Selection feature. GCs select from this list when creating projects to indicate which trades/subcontractors they need.

**Status:** 🔄 To be compiled collaboratively

---

## License Type Format

Each license type has:
- **Code**: Official CSLB classification code (e.g., "C-10")
- **Name**: Human-readable trade name (e.g., "Electrical")
- **Description**: Brief scope description (optional)

---

## Class A — General Engineering

| Code | Name | Description |
|------|------|-------------|
| A | General Engineering | Highways, bridges, utilities, infrastructure |

---

## Class B — General Building

| Code | Name | Description |
|------|------|-------------|
| B | General Building | Commercial and residential buildings |

---

## Class C — Specialty Contractors

### Commonly Used in Public Works

| Code | Name | Description |
|------|------|-------------|
| C-4 | Boiler, Hot Water Heating & Steam Fitting | Boiler systems, steam piping |
| C-7 | Low Voltage Systems | Alarm, communication, sound systems |
| C-8 | Concrete | Foundations, flatwork, structural concrete |
| C-10 | Electrical | Power, lighting, electrical systems |
| C-12 | Earthwork and Paving | Grading, excavation, asphalt paving |
| C-13 | Fencing | Chain link, wood, metal fencing |
| C-15 | Flooring and Floor Covering | Carpet, tile, hardwood, vinyl |
| C-16 | Fire Protection | Sprinkler systems, fire suppression |
| C-17 | Glazing | Windows, glass, storefronts |
| C-20 | Warm-Air Heating, Ventilating, Air Conditioning (HVAC) | HVAC systems |
| C-21 | Building Moving/Demolition | Demolition, structure relocation |
| C-23 | Ornamental Metal | Railings, decorative metalwork |
| C-27 | Landscaping | Planting, irrigation, hardscape |
| C-29 | Masonry | Brick, block, stone work |
| C-33 | Painting and Decorating | Interior/exterior painting, coatings |
| C-34 | Pipeline | Water, gas, sewer pipelines |
| C-35 | Lathing and Plastering | Stucco, plaster systems |
| C-36 | Plumbing | Plumbing systems, fixtures |
| C-38 | Refrigeration | Commercial refrigeration systems |
| C-39 | Roofing | Roof systems, waterproofing |
| C-42 | Sanitation System | Septic, waste systems |
| C-43 | Sheet Metal | Ductwork, metal fabrication |
| C-45 | Electrical Sign | Neon, LED signage |
| C-46 | Solar | Solar panel installation |
| C-47 | General Manufactured Housing | Mobile home setup |
| C-50 | Reinforcing Steel | Rebar installation |
| C-51 | Structural Steel | Steel erection, framing |
| C-53 | Swimming Pool | Pool construction, repair |
| C-54 | Ceramic and Mosaic Tile | Tile installation |
| C-55 | Water Conditioning | Water treatment systems |
| C-57 | Well Drilling | Water well drilling |
| C-60 | Welding | General welding services |
| C-61 | Limited Specialty | Various specialty trades |

---

## Additional Specialty Classifications (C-61)

The C-61 classification covers limited specialty work not covered by other classifications. Common sub-categories relevant to public works:

| Code | Name |
|------|------|
| C-61/D03 | Awnings |
| C-61/D06 | Cabinets, Millwork & Finish Carpentry |
| C-61/D12 | Synthetic Products |
| C-61/D21 | Machinery and Pumps |
| C-61/D24 | Metal Products |
| C-61/D28 | Doors, Gates and Activating Devices |
| C-61/D30 | Pile Driving and Pressure Foundation Jacking |
| C-61/D34 | Prefabricated Equipment |
| C-61/D38 | Sand and Water Blasting |
| C-61/D39 | Scaffolding |
| C-61/D40 | Service Station Equipment and Maintenance |
| C-61/D42 | Non-Electrical Sign Installation |
| C-61/D49 | Tree Service |
| C-61/D50 | Suspended Ceilings |
| C-61/D52 | Window Coverings |
| C-61/D62 | Air and Water Balancing |
| C-61/D64 | Non-Structural Framing and Drywall |

---

## Implementation Notes

### For BidBox Trade Selection UI

1. **Primary Display**: Show commonly used C-class specialties first
2. **Grouping**: Group by trade category (Electrical, Mechanical, Civil, etc.)
3. **Search**: Allow text search by code or name
4. **Multi-Select**: GC can select multiple trades per project

### Mapping to Subcontractor Directory

Each subcontractor in both pools (Private + Network) will have:
- `license_type`: One of the codes above (e.g., "C-10")
- This enables automatic matching when generating call lists

---

## Next Steps

- [ ] Review and finalize list with user
- [ ] Add to database as reference table or constants
- [ ] Implement in trade selection UI dropdown
- [ ] Map existing network subcontractors to license types

---

## References

- [CSLB Official License Classifications](https://www.cslb.ca.gov/About_Us/Library/Licensing_Classifications/)
- [CSLB Contractor License Check](https://www.cslb.ca.gov/OnlineServices/CheckLicenseII/CheckLicense.aspx)

---

**End of CSLB License Types Reference**

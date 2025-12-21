# California CSLB License Types Reference

**For BidBox Trade Selection Feature**  
Last Updated: 2025-12-21

---

## ⚠️ State-Agnostic Architecture Note

> **IMPORTANT**: This document describes the **initial seed data** for the `trade_types` table. California CSLB is NOT the only supported licensing system.
> 
> The BidBox architecture is **state-agnostic** and supports nationwide expansion:
> - `trade_types` table has `state_code` column ("CA", "TX", "FL", null for national)
> - All tables use `trade_type_id` FK references, NOT hard-coded license strings
> - Adding new states requires only inserting rows into `trade_types`, no code changes
> - California data is seeded with `state_code='CA'` and `source='CSLB'`

---

## Overview

This document defines the California Contractors State License Board (CSLB) license types seeded into BidBox's `trade_types` database table. GCs select from this list when creating projects to indicate which trades/subcontractors they need.

**Status:** ✅ 72+ trade types seeded into `trade_types` table (including 29 active D-codes)

---

## Database Schema

All California CSLB license types are stored in the `trade_types` table:

```sql
SELECT * FROM trade_types WHERE state_code = 'CA' AND is_active = true;
-- Returns all active California license types with columns:
-- id, state_code, code, name, category, source, is_default, parent_code, is_active, notes, created_at
```

### Schema Fields

| Column | Type | Description |
|--------|------|-------------|
| `code` | text | Official CSLB classification code (e.g., "C-10", "C-61/D-34") |
| `name` | text | Human-readable trade name |
| `state_code` | text | State identifier ("CA" for California) |
| `category` | text | Grouping for UI display |
| `source` | text | Origin of license type ("CSLB") |
| `parent_code` | text | Parent classification (e.g., "C-61" for D-codes) |
| `is_active` | boolean | Whether this classification is currently active |
| `notes` | text | Optional informational notes |

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
| C-61 | Limited Specialty | Parent classification for D-codes |

---

## C-61 Limited Specialty — Active D-Code Subclassifications

> ⚠️ **AUTHORITATIVE LIST**: This list contains ONLY the currently active D-codes as exposed by the official CSLB "List by Classification" portal. Deprecated, transferred, or legacy D-codes are intentionally excluded.

### Core Rules
- C-61 is a **parent classification**
- All D-codes are **children of C-61**
- D-codes are **individually selectable** in the trade dropdown
- No semantic guessing, auto-grouping, or inferred synonyms

### Active D-Codes (29 Total)

| Code | Name |
|------|------|
| C-61/D-3 | Awnings Contractor |
| C-61/D-4 | Central Vacuum Systems Contractor |
| C-61/D-6 | Concrete-Related Services Contractor |
| C-61/D-9 | Drilling, Blasting and Oil Field Work Contractor |
| C-61/D-10 | Elevated Floors Contractor |
| C-61/D-12 | Synthetic Products Contractor |
| C-61/D-16 | Hardware, Locks and Safes Contractor |
| C-61/D-21 | Machinery and Pumps Contractor |
| C-61/D-24 | Metal Products Contractor |
| C-61/D-28 | Doors, Gates and Activating Devices Contractor |
| C-61/D-29 | Paperhanging Contractor |
| C-61/D-30 | Pile Driving and Pressure Foundation Jacking Contractor |
| C-61/D-31 | Pole Installation and Maintenance Contractor |
| C-61/D-34 | Prefabricated Equipment Contractor |
| C-61/D-35 | Pool and Spa Maintenance Contractor |
| C-61/D-38 | Sand and Water Blasting Contractor |
| C-61/D-39 | Scaffolding Contractor |
| C-61/D-40 | Service Station Equipment and Maintenance Contractor |
| C-61/D-41 | Siding and Decking Contractor |
| C-61/D-42 | Non-Electrical Sign Installation Contractor |
| C-61/D-49 | Tree Service Contractor |
| C-61/D-50 | Suspended Ceilings Contractor |
| C-61/D-52 | Window Coverings Contractor |
| C-61/D-53 | Wood Tanks Contractor |
| C-61/D-56 | Trenching Only Contractor |
| C-61/D-59 | Hydroseed Spraying Contractor |
| C-61/D-62 | Air and Water Balancing Contractor |
| C-61/D-63 | Construction Clean-up Contractor |
| C-61/D-64 | Non-specialized Contractor |
| C-61/D-65 | Weatherization and Energy Conservation Contractor |

### Deprecated D-Codes (NOT Included)

The following D-codes have been deprecated, transferred, or consolidated by CSLB and are **intentionally excluded**:

- D-1, D-2, D-5, D-7, D-8, D-11, D-13, D-14, D-15, D-17, D-18, D-19, D-20
- D-22, D-23, D-25, D-26, D-27, D-32, D-33, D-36, D-37
- D-43, D-44, D-45, D-46, D-47, D-48, D-51, D-54, D-55, D-57, D-58
- D-60, D-61, D-66 and higher

---

## Implementation Notes

### Database-Driven Architecture

1. **Trade types are stored in database**, not hard-coded in components
2. **Frontend fetches from `trade_types` table** filtered by `state_code = 'CA'` and `is_active = true`
3. **All references use `trade_type_id` FK**, never string codes
4. **D-codes use `parent_code = 'C-61'`** for hierarchical display

### For BidBox Trade Selection UI

1. **Primary Display**: Show commonly used C-class specialties first
2. **Grouping**: Group by `category` column (Electrical, Mechanical, Civil, etc.)
3. **C-61 Nesting**: D-codes are indented under C-61 parent
4. **Search**: Allow text search by code (D-34) or name (prefabricated, clean-up)
5. **Multi-Select**: GC can select multiple trades per project

### Search Behavior

Search must match (case-insensitive):
- Code (e.g., "D-34", "C-61/D-34")
- Name (e.g., "clean-up", "scaffolding")
- Partial keywords (concrete, tree, doors, etc.)

⚠️ **Search surfaces options only — no inference, no auto-selection**

### CSLB & Network Pool Compatibility

- D-codes returned by CSLB ingestion map directly to `trade_types.code`
- No translation layer or aliasing is used
- Call List Generator uses `trade_type_id` FK for matching

### Mapping to Subcontractor Directory

Each subcontractor in both pools (Private + Network) has:
- `trade_type_id`: FK reference to `trade_types.id`
- This enables automatic matching when generating call lists via JOIN

---

## Completed Tasks

- [x] ✅ Review and finalize list with user
- [x] ✅ Add to database as `trade_types` reference table (43 types seeded)
- [x] ✅ Implement in trade selection UI dropdown (Task 3.5.3)
- [x] ✅ Add parent_code, is_active, notes columns to trade_types
- [x] ✅ Insert 29 authoritative D-codes with parent_code = 'C-61'
- [x] ✅ Update UI to nest D-codes under C-61
- [ ] Map existing network subcontractors to `trade_type_id` FK

---

## Future State Expansion

To add Texas (TDLR) license types:
```sql
INSERT INTO trade_types (state_code, code, name, category, source, is_default, is_active)
VALUES ('TX', 'E1', 'Electrical', 'Electrical', 'TDLR', true, true);
-- No code changes required, just data insertion
```

---

## References

- [CSLB Official License Classifications](https://www.cslb.ca.gov/About_Us/Library/Licensing_Classifications/)
- [CSLB Contractor License Check](https://www.cslb.ca.gov/OnlineServices/CheckLicenseII/CheckLicense.aspx)
- [CSLB List by Classification Portal](https://www.cslb.ca.gov/OnlineServices/CheckLicenseII/LicenseByClassification.aspx)

---

**End of CSLB License Types Reference**

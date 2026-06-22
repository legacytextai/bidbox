I'm using knowledge

## Sync Verification Report — phase1-opportunity-intelligence

### Repo state (already at HEAD)
The Lovable workspace is synced bidirectionally with GitHub, and `git log` confirms the three target commits are present at the tip:

- `2300180` — Phase G 8.3 Legacy Crawl Separation (HEAD)
- `75c0904` — Phase G 8.2 Opportunity Conversion Hardening
- `ea9e374` — Phase G 8.1 Project Origin & Data Model Foundation

No pull is needed — Lovable already reflects GitHub HEAD.

### Frontend
Frontend changes deploy when the user clicks **Publish → Update**. No code changes required from me. Build runs automatically in the harness on edits; nothing pending here from these three commits aside from the user re-publishing if they want the live `bidbox.lovable.app` URL refreshed.

### Backend / Edge functions
No edge-function changes are introduced by 8.1–8.3 that require a manual `deploy_edge_functions` step; functions deploy on backend change automatically.

### Database migrations — ACTION REQUIRED
Two new migration files exist in the repo but are NOT applied to Lovable Cloud:

| File | Applied? |
|---|---|
| `20260622000001_add_project_origin_links.sql` (8.1) | ❌ not applied |
| `20260622000002_harden_opportunity_conversion.sql` (8.2) | ❌ not applied |

Highest applied version in `supabase_migrations.schema_migrations` is `20260621204615`. These were committed via GitHub sync, which does not auto-run migrations against Lovable Cloud — they must be submitted through the migration tool (same situation we hit with the F4 migration).

Until these run:
- `projects.source_opportunity_candidate_id` / origin columns do not exist
- The unique-index guard preventing duplicate opportunity→project conversions is missing
- "View Project" from a converted opportunity, and the "Add To Calendar" conversion path, will fail or produce duplicates

### Readiness for manual validation
- View Intelligence Report — ready (F4 tables already live from prior migration)
- Add To Calendar (opportunity → project conversion) — BLOCKED on 8.1 + 8.2 migrations
- View Project from a converted opportunity — BLOCKED on 8.1 migration

### Proposed next step (requires approval to leave plan mode)
Submit the two pending migrations via the migration tool, in order:
1. `20260622000001_add_project_origin_links.sql`
2. `20260622000002_harden_opportunity_conversion.sql`

Then re-verify by:
- Confirming `schema_migrations` advances to `20260622000002`
- Spot-checking `projects` has the new origin columns
- Walking the Opportunity → View Intelligence Report → Add To Calendar → View Project flow against a known-good candidate

No application code changes will be made. Approve and I'll execute the migration submissions.

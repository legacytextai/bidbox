# Dev Tool: Opportunity Pipeline Reset

**Script:** `bidbox-worker/scripts/reset-opportunity-pipeline.js`  
**Audience:** BidBox developers  
**Purpose:** Wipe all opportunity pipeline data to establish a clean baseline for testing new portal drivers or re-running a full discovery cycle.

---

## What it does

Deletes all rows from the opportunity pipeline tables and all objects in the `opportunity-documents` storage bucket. After running, the system behaves exactly like a fresh install that has never scanned opportunities — but with all configuration (sources, portal credentials, user accounts, settings) fully intact.

---

## What is PRESERVED (never touched)

| Category | Tables / Resources |
|---|---|
| Portal configuration | `opportunity_sources`, `portal_drivers` |
| User accounts | `profiles`, `auth.users`, `auth.sessions` |
| Qualification profiles | `gc_qualification_profiles` |
| Projects & bids | `projects`, `bids`, `project_files`, `project_trades` |
| Subcontractors | `gc_subcontractors`, `gc_sub_trade_mappings`, `subcontractors`, `sub_trade_mappings` |
| App configuration | `app_settings`, `user_roles`, `cslb_cache`, `trade_types` |
| Subscriptions | `subscriptions` |
| Storage buckets | `project-files`, `bid-submissions` (and the bucket definitions themselves) |

---

## What is DELETED

Deletion runs in FK-safe dependency order (most-dependent first):

| Order | Table | Description |
|---|---|---|
| 1 | `saved_opportunities` | User bookmarks on candidates |
| 2 | `opportunity_intelligence_citations` | Source citations for findings |
| 3 | `opportunity_intelligence_findings` | Individual intelligence findings |
| 4 | `opportunity_intelligence_reports` | F4 project intelligence reports |
| 5 | `opportunity_document_chunks` | Text chunks from processed documents |
| 6 | `opportunity_document_pages` | Extracted pages from documents |
| 7 | `opportunity_bid_items` | Portal-native bid line items |
| 8 | `opportunity_documents` | Document acquisition records |
| 9 | `opportunity_candidates` | Discovered opportunity candidates |
| 10 | `agent_run_logs` | Per-task execution logs |
| 11 | `agent_tasks` | All queued/completed tasks (scan + intelligence) |
| 12 | `agent_runs` | Scan audit log |
| — | `opportunity-documents` bucket | All acquired PDF/document files in storage |

Projects that were previously converted from opportunities retain their `source_opportunity_candidate_id` and `opportunity_intelligence_report_id` columns NULLed automatically (ON DELETE SET NULL FK behavior) — the project records themselves are preserved.

---

## Usage

### Dry run (safe — no data modified)

```bash
SUPABASE_URL=https://<project>.supabase.co \
SUPABASE_SERVICE_ROLE_KEY=<service_role_key> \
node bidbox-worker/scripts/reset-opportunity-pipeline.js --dry-run
```

Prints counts for every pipeline table and storage bucket. Exits without touching anything. Always safe to run.

### Live reset

```bash
ALLOW_PIPELINE_RESET=true \
SUPABASE_URL=https://<project>.supabase.co \
SUPABASE_SERVICE_ROLE_KEY=<service_role_key> \
node bidbox-worker/scripts/reset-opportunity-pipeline.js --confirm
```

The script will:
1. Print the deletion summary
2. Prompt you to type `reset` to confirm
3. Execute deletions in order
4. Verify zero rows in all pipeline tables
5. Confirm preserved tables are unchanged
6. Print a final summary

---

## Safety guards

Five independent gates prevent accidental data destruction:

1. **`--confirm` flag required** — omitting `--confirm` is treated as `--dry-run`
2. **`ALLOW_PIPELINE_RESET=true` required** — must be set explicitly; not a default
3. **`NODE_ENV=production` rejected** — the script refuses to run if `NODE_ENV` is set to `production`
4. **Interactive prompt** — must type the word `reset` when prompted; any other input aborts
5. **Post-reset verification** — the script checks every key table for zero rows and alerts if anything remains

---

## Intended use

- Before onboarding a new portal driver: reset to a clean state, then run the new driver and inspect results
- After a bad data migration or test scan that polluted the candidate table
- To re-run the full discovery cycle from scratch during development
- As a CI/CD fixture reset step (using `--confirm` with the `ALLOW_PIPELINE_RESET` gate set in CI environment config)

---

## Warnings

- **This tool is irreversible.** There is no undo. Make sure you have a database backup or snapshot if the data has any value before running.
- **Do not run against production.** The `NODE_ENV=production` guard exists precisely for this. Even so, double-check the `SUPABASE_URL` you are pointing at before executing.
- **Storage deletion is permanent.** Files deleted from `opportunity-documents` cannot be recovered. Re-running a portal scan + F2 document acquisition will re-fetch them.
- **agent_tasks clears ALL task types.** This includes pending scan tasks, pending analysis tasks, and any tasks currently being processed. If the worker is running, stop it before executing the reset.

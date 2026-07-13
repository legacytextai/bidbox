# Fresh-account opportunities QA investigation

## Confirmed repository findings

- `qualify-candidates` used a service-role client to write one user's county/value/capability decision to shared `opportunity_candidates.auto_status`. The worker also invoked it with a hardcoded admin UUID. This exactly explains identical cross-account counts. Profile-table RLS was correct, but the result model was not tenant-scoped.
- The Cal eProcure scanner checks exact `portal_bid_id` equality against existing Caltrans rows. It did not canonicalize when Cal eProcure arrived first, and subsequent user qualification could overwrite the shared reason. The new path is order-independent and stores an explicit canonical candidate link.
- PlanetBids reaches a stable detail URL and persists a row even when its detail parser obtains no title and no due date. URL uniqueness makes exact retry inserts unlikely; multiple distinct bid IDs from the same agency can still render as identical untitled cards. The frontend intentionally mixed these invalid artifacts into `Filtered Out`.
- Filtered cards did not render `auto_status_reason`; low-title relevance and missing-title decisions were recomputed only in the frontend.
- Signup displayed a transient generic success and redirected as though login were possible. Raw provider errors could reach the user. Resend existed, but lacked a dedicated persistent verification state/cooldown.

## Data access limitation

The repository contains only the public Supabase key. Anonymous reads are denied by RLS and return zero rows; no database/service-role credential or local Supabase CLI is available. Therefore production counts and representative record IDs are intentionally left to the read-only diagnostic script rather than fabricated.

## Email deliverability

The repository contains no Supabase Auth SMTP, sender, template, Site URL, SPF, DKIM, or DMARC configuration. Those settings live in the Supabase dashboard and DNS provider, so default-versus-custom SMTP and domain authentication cannot be confirmed from code. An operator should verify custom SMTP, aligned From/return-path domains, SPF, DKIM, DMARC, production Site URL, allowed redirect URLs, and the confirmation template/link domain. No external setting was changed.

## Disposition

- Recoverable title/due-date metadata: repair from raw data after preview.
- Stable PlanetBids detail IDs with missing extraction: reprocess from source, then quarantine if still incomplete.
- Confirmed exact cross-portal IDs: relink Cal eProcure to Caltrans.
- Unrecoverable incomplete detail rows: archive/quarantine; do not show to users.
- Rows without stable IDs or detail URLs: quarantine and manual review; deletion is a separate approval.
- Probable title/agency matches without an exact portal ID: manual review; never auto-merge.

# BidBox Engineering Principles

**Status:** Authoritative — the architectural constitution
**Established:** 2026-07-06
**Precedence:** highest; see [`README.md`](README.md) for amendment rules

These are timeless principles, not implementation details. Every schema change, agent, feature, and initiative is measured against them. Each principle earned its place from something the codebase actually lived through — the origin is noted where it teaches.

---

## Data

**1. One canonical copy of every public procurement fact.**
The system acquires each fact once; every tenant reads the same record. Nothing tenant-facing ever copies canonical documents, chunks, or intelligence into tenant space — it references them.

**2. Tenant opinion never touches canonical facts.**
If knowing a fact tells you something about a contractor — that they're pursuing, what they think, who they assigned — it lives in tenant space under company-scoped RLS. The test is the fact itself, not the table it is convenient to put it on. *(Origin: triage status, qualification scores, and `converted_project_id` written to shared `opportunity_candidates` rows — the defining defect of the single-tenant era.)*

**3. Anything derivable is derived.**
Status computable from production data is a view, never a hand-maintained column or document. *(Origin: `docs/opportunity-source-ledger.md`, which drifted stale beside production within weeks.)*

**4. A contractor's activity is invisible to every other contractor.**
No pursuit signals, bid amounts, or competitor presence ever surface across tenants. Public records (planholder lists, bid results) are canonical and fine; BidBox-observed behavior is not.

## AI and Agents

**5. No citation, no canonical fact. No reason, no tenant suggestion.**
AI output without provenance is not stored. *(Origin: F4's "no citation = no fact" rule, enforced in schema comments.)*

**6. Agents suggest; humans decide.**
The machine's value, the human's override, and the reason live side by side, permanently. The contractor makes the go/no-go call and signs the bid; BidBox prepares, verifies, and empowers the phone call — it never decides and never submits on anyone's behalf. *(Origin: the bid-date-override pattern.)*

**7. Every agent owns exactly one output surface, and its ring is set by its inputs.**
Canonical agents never read tenant tables; tenant agents never write canonical tables. The moment an agent reads tenant context, its output is tenant-private, forever.

**8. Orchestration is deterministic.**
Queues, rows, and triggers — never agents conversing with agents. Coordination is a table and an enqueue rule, not a coordinator LLM.

**9. Durable tables over conversational memory.**
Every AI output becomes a row someone can query in a year. If an agent's work product cannot be found without replaying a conversation, it doesn't exist.

## Expansion

**10. Atlas expands coverage but never becomes the product.**
The control plane feeds the data plane. It never ingests an opportunity, never faces a customer, never grows its own infrastructure.

**11. Evidence before construction.**
Reconnaissance before drivers; verified findings before conclusions; production verification before dependent work. Automate evidence collection, keep judgment human. *(Origin: the LACMTA transport near-miss — evidence-consistent recon almost wrongly killed a portal that is now live in production.)*

## Operations

**12. The pipeline is the monitor.**
Health derives from real production behavior; parallel checkers drift from the code paths they claim to watch.

**13. Fail loud structurally, degrade gracefully per item.**
Zero results is an alarm, not a success; one bad record never fails a run. *(Origin: the nightly cron that reported `success: 0 sources` for days, and the per-row error isolation that saved the first LACMTA scan.)*

**14. Migrations are additive → cutover → drop, and production is the actual state.**
The repo is the intended schema; the database is the real one. Verify before building on top. New `USING (true)` write policies on shared tables are forbidden.

**15. No new infrastructure without a measured limit.**
Postgres and the poller until numbers prove otherwise. Vector stores, event buses, agent frameworks, and dashboards are answers to measurements, not defaults.

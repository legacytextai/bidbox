# Uniform Document Policy — All Portals (F1–F5 Aligned)

**Date:** 2026-07-09
**Status:** Policy adopted. Title display implemented; **F2-lite on-demand download implemented for OpenGov and Cal eProcure** via the `download-opportunity-document` edge function where stable source keys are present.
**Applies to:** OpenGov, PlanetBids, Caltrans, LACMTA, LA County DPW, Cal eProcure (when documents are supported), and all future portals.

---

## 1. The policy in one paragraph

Discovery produces **candidate metadata + known document titles**. Explicit user intent produces **document bytes + processing/intelligence/workspace**. Browsing an opportunity never downloads bytes in bulk; clicking a specific action does. The estimating coordinator clicks **Download** and gets the file — they never see or care about the backend state.

```text
Discovery:      candidate metadata + document titles       (no bytes)
User intent:    document bytes + processing/intelligence   (F2 → F3 → F4/F5)
```

Never return to:

```text
scan → every new candidate → automatic document_prefetch flood
```

That failure mode caused the **July 8 incident** (six saturated replicas, Browserbase 429s, 622 failed tasks in 24h — see `docs/bug-reports/2026-07-08-opportunities-saved-zero-worker-overload.md`). The guardrails from commit `3559014` (auto-prefetch kill switch, Browserbase concurrency/429 backoff, login-lock caps) are the enforcement mechanism and must not be weakened.

---

## 2. F1–F5 flow (preserved; only *when F2 fires* changes)

### F1 — Opportunity selection / analyze intent
The user identifies an opportunity worth pursuing: opens it, saves/shortlists it, clicks **Analyze Project** / **Prepare Intelligence**, or adds it to the calendar / creates a project workspace.

### F2 — Document acquisition (explicit-intent-driven, two modes)

**F2 is no longer triggered by broad scan/discovery.** It has two modes:

**F2-lite — single-document download.** Triggered when the user clicks **Download** on one document in the Documents tab.
- Acquire that one file if needed, then download/open it for the user.
- Does **not** automatically trigger F3/F4. No project-wide processing, no intelligence generation.
- *Current implementation status:* **implemented for OpenGov and Cal eProcure** via the `download-opportunity-document` edge function. Already-acquired documents return a signed URL instantly; unacquired ones start a **single-candidate** acquisition (candidate-level v1, so one click acquires that candidate's supported documents and serves the requested one; subsequent clicks are instant). The frontend polls the same function until `ready`. Trigger reason `f2_lite_on_demand_download` marks these tasks. No F3/F4 cascade — the doc-only prefetch path never queues downstream work. Other portals: title rows render without a Download action until their on-demand path is validated.

**F2-full — project/intelligence acquisition.** Triggered when the user clicks **Analyze Project** / **Prepare Intelligence**, or adds to calendar / creates a project workspace.
- Acquires **all** required project documents (existing `project_analysis` → `runProjectAnalysisAcquisition` path), then continues into F3/F4.
- This path already exists and is unchanged.

### F3 — Document processing / chunking
Triggered after **F2-full** — not after every scan, and not necessarily after F2-lite.

### F4 — Intelligence report
Triggered after F3 for the explicit project/intelligence workflow.

### F5 — Project workspace / pursuit workflow
Uses acquired documents, intelligence, calendar data, and pursuit state.

---

## 3. Documents tab UX (uniform across portals)

Three cases, decided by what exists for the candidate:

**Case A — documents acquired** (`opportunity_documents` rows with `acquisition_status='acquired'`):
```text
[Document title]    [Download]
```
Download serves the file from BidBox storage via a signed URL. Button states: `Download` → `Downloading…` (→ `Retry Download` on failure).

**Case B — document titles known, bytes not acquired** (discovery metadata lists documents, no `opportunity_documents` rows):
Show the known document titles as real rows — never just "Documents have not been acquired yet." Rows display the title and file type. Rows with a stable `sourceKey` get a live `Download` button (acquire-then-download behind the scenes); rows without a supported backend path render title-only and keep the source portal link available elsewhere in the report.

**Case C — no document list known:**
```text
No document list available yet. Open the source portal to view documents.
```
with the source link.

**Language rules (user-facing):** allowed — `Download`, `Downloading…`, `Retry Download`, `Unavailable`. Never — *Fetch, Acquire, Prefetch, Manifest, Pipeline, Storage object*. Backend state must be invisible.

---

## 4. Where known document titles come from, per portal

| Portal | Discovery-time document list | Location / shape |
|---|---|---|
| OpenGov | ✅ (base attachments) | `crawl_data.documents[]` — `{name, title, filename, file_extension, type, shared_id}` (Phase 2; released-addendum attachments are acquired by Phase 3 but not in this list) |
| PlanetBids | ✅ | `crawl_data.documents[]` — `{file_title, filename, file_size}` |
| LA County DPW | ✅ | `crawl_data.documents[]` — `{title, notes, pages, size, registered_only}` |
| Caltrans | ❌ (discovered at acquisition time) | Case C until F2-full runs |
| LACMTA | ❌ (metadata-only driver) | Case C |
| Cal eProcure | ✅ after Event Package manifest capture | `crawl_data.documents[]` — `{source_key, title, description, file_name, file_extension, document_family, document_class}` |

The shared extractor (`extractKnownSourceDocuments` in `src/lib/opportunityDomain.ts`) normalizes all shapes to `{title, fileType}` — new portals only need to write `crawl_data.documents[]` with any of the recognized title keys.

---

## 5. Acquisition rules (worker side — unchanged by this policy)

- `supportsDocumentPrefetch()` continues to gate portals out of scan-time auto-prefetch; **PlanetBids auto-prefetch stays off** (`PLANETBIDS_AUTO_DOCUMENT_PREFETCH_ENABLED=false`), **OpenGov and Cal eProcure stay excluded**.
- Broad OpenGov acquisition across all candidates requires **explicit approval** — validated single-candidate path only (see the OpenGov ledger, `docs/handoff/2026-07-08-opengov-phase1-validation.md`).
- Browserbase concurrency/429 guardrails and PlanetBids login-lock caps from `3559014` stay in force.
- Idempotency keys stay stable and non-expiring (e.g. `opengov://project/{id}/attachment/{sharedId}`, `caleprocure://event/{eventId}/attachment/{sourceOrder}/{filename}`).

---

## 6. F2-lite implementation notes (OpenGov and Cal eProcure, shipped)

- **Backend:** `supabase/functions/download-opportunity-document` — authenticates the user, then with the service role: (1) acquired row matching the stable source key → signed URL (`status:"ready"`); (2) unsupported portal → `"unsupported"`; (3) file type outside the acquisition allow-list → `"unavailable"` without burning a browser session; (4) in-flight prefetch for the candidate → reuse (`"pending"`); (5) a completed on-demand run in the last 10 min that still didn't produce the row → `"unavailable"`; (6) otherwise enqueue ONE candidate-scoped `document_prefetch` (priority 4, trigger `f2_lite_on_demand_download`) → `"pending"`.
- **Frontend:** Case B rows with a `sourceKey` get a Download button that invokes the function and polls it (4s interval, 3 min cap). States: `Download` / `Downloading…` / `Retry Download` / `Unavailable`. After success the dossier reloads, flipping the tab to Case A.
- **Acquisition granularity:** candidate-level fallback (v1) — the validated Phase 3 path acquires the candidate's supported documents in one pass; per-document idempotency makes every later click instant. True single-document acquisition is a possible later optimization, not a correctness need.

## 7. Next steps (explicitly deferred, in order)

1. **F2-lite for remaining portals** — PlanetBids/DPW title rows currently have no Download action; each needs a validated on-demand acquisition path (and PlanetBids must respect the login lock + guardrails).
2. Consider surfacing addendum attachments in the OpenGov discovery-time list (currently base attachments only).
3. Extend Case B rows to the project-workspace Documents tab if a workspace ever exists before F2-full has run (today F2-full precedes workspace creation, so acquired rows are always present there).

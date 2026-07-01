# Bid Date Authority

**Status:** Backlog — design only, no implementation  
**Category:** Data integrity / intelligence accuracy

---

## Problem

Today, BidBox treats the portal metadata bid date (`opportunity_candidates.bid_due_at`, sourced from
`crawl_data.due_date_raw`) as the authoritative bid due date for an opportunity. This works for the
majority of cases, but it breaks down in a common real-world scenario: **bid date extensions issued
via addenda**.

When an agency issues an addendum extending the bid due date:
- Some agencies update the portal listing's bid date field immediately.
- Many agencies do not. The portal continues to show the original date while the addendum PDF
  contains the only authoritative extension notice.

In the current system:
- F4 Project Intelligence may find a conflicting date in addenda and flag it as a `conflict` finding.
- The UI surfaces this as a warning, but the authoritative date displayed is still the structured
  portal metadata value — which may be stale.
- There is no deterministic mechanism to identify and promote the most recent addendum date as
  the true bid due date.

---

## Design Concept

### Bid Date Authority Chain

A future enhancement would establish a deterministic priority chain for bid due date resolution:

```
1. Manual override (set by a user in BidBox)         ← highest authority
2. Addendum-identified extension date                 ← new tier (not yet implemented)
3. Portal metadata bid_due_at / due_date_raw          ← current default
4. Candidate-level bid_due_at from scan               ← fallback
```

The "Addendum-identified extension date" tier would require F4 (Project Intelligence) to:
1. Identify addendum documents in the evidence (already tagged by `document_family = 'addenda'`).
2. Extract any explicit bid date extension from addendum text.
3. Compare it against the portal metadata date.
4. When the addendum date is later than the portal date, promote it as the new authoritative date
   and record which addendum document it came from.
5. Store the result in a new field (e.g., `projects.bid_due_addendum_at`,
   `projects.bid_due_addendum_source`) and surface it in the deadline resolution chain.

### Citation requirement

Any addendum-sourced bid date must be citation-backed — the specific addendum document, page,
and excerpt must be stored. No addendum date without a citation.

### Conflict behavior

If multiple addenda contain different bid dates (e.g., two extensions), F4 should take the latest
one and flag competing evidence for operator review.

If the addendum date is earlier than the portal date (unusual — could indicate a correction or
different project phase), treat it as a `conflict` requiring manual review rather than promoting it.

---

## What is already implemented

- F4 already detects bid date conflicts between document evidence and portal metadata and flags
  them as `conflict` findings in `key_dates`.
- The deadline resolution engine (`src/lib/bidDueResolver.ts`,
  `docs/initiatives/deadline-resolution-engine.md`) already supports a manual override tier.
- The `bid_due_override_at` / `bid_due_override_source` / `bid_due_override_reason` columns on
  `projects` already support user-controlled overrides as the current workaround.

---

## What is not implemented

- Automatic identification of an addendum-issued bid date extension.
- Promotion of an addendum date into the authority chain without user intervention.
- Storage of the addendum citation that backs the extension.

---

## Why this is deferred

The current workaround (manual override) is sufficient for now. Addendum-driven date changes are
detectable today — F4 flags conflicts and an estimator can set a manual override with the correct
date and note the addendum source. Automating the detection reliably requires:

1. Distinguishing "bid date extension" addenda from other addenda content.
2. Handling multi-addendum chains where each may modify the previous.
3. Deciding what to do when the agency also updates the portal (no conflict exists, addendum
   simply confirms the portal date).

These are solvable problems but require careful prompt engineering and validation against a corpus
of real addenda. This should not be rushed.

---

## Trigger for implementation

Implement when:
- Manual overrides are being set frequently for addendum date extensions (indicating the volume
  warrants automation), or
- F4 conflict findings for bid dates consistently resolve to the addendum date upon manual review.

---

## Related

- [`docs/initiatives/deadline-resolution-engine.md`](deadline-resolution-engine.md) — current
  bid due resolution logic
- `src/lib/bidDueResolver.ts` — frontend resolution implementation
- `bidbox-worker/drivers/project_intelligence.js` — F4 driver, `key_dates` findings category

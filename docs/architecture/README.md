# BidBox Architecture

**Purpose:** This directory holds BidBox's durable design truth — the architectural constitution that every future engineering decision is measured against. It contains no execution content: no task lists, no milestones, no sprint plans. Those live in `docs/initiatives/`.

**Established:** 2026-07-06, consolidating three architecture sessions (Procurement Atlas, Unified Data Model, Architecture Consolidation).

---

## Documents

| Document | What it governs |
|---|---|
| [`engineering-principles.md`](engineering-principles.md) | The constitution — timeless principles every change is measured against |
| [`unified-data-model.md`](unified-data-model.md) | The four-ring data architecture: canonical/tenant boundary, agent architecture, estimating workflow OS |
| [`procurement-atlas.md`](procurement-atlas.md) | The expansion control plane: registry, recon codification, coverage health |

---

## Precedence Rules

Documentation drift is how constitutions die. The precedence order is:

```
1. docs/architecture/engineering-principles.md   (the constitution)
2. docs/architecture/*.md                        (architecture documents)
3. docs/initiatives/*.md                         (bounded execution efforts)
4. task lists inside initiatives                 (execution detail)
```

**Rules:**

1. A lower-level document that conflicts with a higher-level one is **wrong**, unless the higher document is amended deliberately and visibly in the same change. Silent divergence is never acceptable.
2. Architecture documents describe *what must stay true*; initiatives describe *what we are doing about it and when*. If a sentence contains a date, a task number, or a status emoji, it belongs in an initiative.
3. `docs/masterplan.md` remains the **product strategy** source of truth. `docs/agent-architecture-task-list.md` remains the **Opportunity Intelligence execution** source of truth (per its own §10.4). Neither overrides this directory on architectural questions; this directory does not override them on product or sequencing questions.
4. `docs/handoff/*` is immutable session history — never edited, never authoritative, always useful.
5. Superseded documents move to `docs/archive/` (the `v1-auto-analysis-pipeline.md` convention) or are rewritten in place with an explicit revision note (the `Procurement_Atlas_Initiative_Plan.md` convention). Nothing authoritative is deleted.

---

## Amendment Process

These documents are meant to survive for years, but they are not scripture. To amend:

1. State the principle or design decision being changed and why the original reasoning no longer holds.
2. Update the architecture document and every initiative that depended on the old version in the same change.
3. Record the amendment date and rationale in the document being amended.

The bar for amending `engineering-principles.md` is highest: a principle is removed only when following it has demonstrably cost more than violating it would have.

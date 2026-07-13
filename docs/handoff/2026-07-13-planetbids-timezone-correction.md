# PlanetBids timezone correction gate

Scope: the fixed 10-candidate allowlist in `bidbox-worker/scripts/repair-planetbids-timezone.js`. This procedure does not authorize the historical backfill, automatic recovery, Riverside qualification rebuild, or a frontend publish.

## Parser behavior

All PlanetBids due-date parsing is centralized in `bidbox-worker/lib/planetbids-date.js` and shared by normal scans, recovery API/listing/DOM extraction, and document-derived recovery.

Observed and supported inputs:

- PlanetBids API timezone-naive ISO local timestamps: `YYYY-MM-DDTHH:mm:ss[.fraction]`
- DOM/local timestamps: `MM/DD/YYYY h:mm[:ss] AM|PM` and `MM/DD/YYYY HH:mm[:ss]`
- Explicit ISO timestamps ending in `Z` or a numeric UTC offset
- Explicit `PST` and `PDT` suffixes

Timezone-naive values are interpreted with the IANA zone `America/Los_Angeles`. The parser derives valid instants through `Intl.DateTimeFormat`, including historical daylight-saving rules; it does not use the Railway host timezone or fixed seasonal offset arithmetic. Explicit offsets are respected without a second Pacific conversion.

Date-only values return `date_only_time_missing` because a bid deadline requires an authoritative time. Empty, invalid, and unsupported inputs return a machine-readable failure and `null`. Nonexistent spring-forward local times return `nonexistent_local_time`; repeated fall-back times return `ambiguous_local_time`. Neither is guessed.

## Controlled repair command

Both dry-run and write modes require the exact hard-coded 10 UUID allowlist, the dedicated mode, and explicit confirmation. The write adds one additional production confirmation flag.

Dry run:

```bash
railway run --service bidbox node bidbox-worker/scripts/repair-planetbids-timezone.js \
  --mode=timezone-correction-controlled-10 \
  --candidate-ids=<exact-approved-10> \
  --confirm-exact-allowlist
```

Write, only after 10 exact dry-run timestamp matches:

```bash
railway run --service bidbox node bidbox-worker/scripts/repair-planetbids-timezone.js \
  --mode=timezone-correction-controlled-10 \
  --candidate-ids=<exact-approved-10> \
  --confirm-exact-allowlist \
  --write --confirm-production-write
```

The script refuses missing, duplicated, substituted, or additional UUIDs; refuses drift from the approved before-state; re-fetches authoritative listing metadata; compares every parsed value to the exact approved UTC timestamp before any write; updates existing rows by UUID with an optimistic concurrency check; preserves recovery attempt history; and records a `timezone_correction_controlled_10` audit referencing the original controlled-write audit.

# Project status: Pursuing tab, consistent colors, and status on manual/One Link projects

## 1. "Pursuing" tab on My Projects

Add a **Pursuing** tab immediately to the left of **Live**, so the tabs read:
`All · Pursuing · Live · Submitted · Passed`

- Pursuing shows projects whose status is Pursuing and whose bid date has not passed.
- Live keeps its current meaning (not passed, not submitted, bid date still open), so Pursuing projects also appear under Live.
- The count and total-estimate summary bar updates for the tab automatically.

## 2. One color language for status everywhere

Status colors, used identically in the workspace dropdown and on the My Projects tabs and cards:

| Status | Color |
|---|---|
| Reviewing | Gray |
| Pursuing | Green |
| Passed | Red |
| Submitted | Blue |

- In the project workspace status dropdown, every option in the open menu is tinted with its own color (today only the selected one is), and the closed control keeps the selected color.
- On My Projects, the Pursuing / Submitted / Passed tab labels take their status color when active (and a muted tint of it when inactive). All and Live stay neutral.
- Project card badges already use these colors; they stay as-is and are switched to the shared definition so they can never drift.

## 3. Status dropdown on manually added / One Link projects

Projects created from the "+" button (manual entry or pasted link) currently open the older project page, which has no pursuit status control — so they can never be moved to Pursuing, Submitted, or Passed.

Plan: keep that older page (it holds the editable fields manual projects depend on — name, county, agency, dates, timezone, instructions — which the new workspace does not offer) and add the same status dropdown to its header, directly above the project title, with identical colors and saving behavior. Once set, those projects flow into the correct tabs on My Projects exactly like opportunity-sourced ones.

A full move of manual/One Link projects to the new workspace is not included here: it would remove the editing surface those projects rely on. Can be done as a separate piece of work if you want one unified workspace.

## Technical notes

- New shared module `src/lib/pursuitStatus.ts`: `PURSUIT_STATUSES`, `PURSUIT_STATUS_LABELS`, `PURSUIT_STATUS_STYLES` (badge tint), plus tab text/border classes. `ProjectWorkspace.tsx` drops its local copies and imports these.
- New shared component `src/components/project-workspace/PursuitStatusSelect.tsx`: the Select plus the `projects.pursuit_status` / `pursuit_status_updated_at` update and error toast, extracted from `ProjectWorkspace.tsx`. Used by both the workspace header and the legacy header in `ProjectDetail.tsx`.
- `src/pages/Projects.tsx`: add `pursuing` to `TabKey` and `TABS` (position index 1), add the filter branch, color the tab buttons from the shared map, and replace the inline card badge color ladder with `PURSUIT_STATUS_STYLES`.
- `src/pages/ProjectDetail.tsx`: render `PursuitStatusSelect` in the legacy branch header (near the existing "Back to Projects" row), reusing the already-loaded `project` object; on change, update local project state so the header badge/color reflects it without a reload. The existing LIVE/DEAD `status` select is untouched.
- No database changes: `pursuit_status` already exists on `projects` and defaults to `reviewing`.

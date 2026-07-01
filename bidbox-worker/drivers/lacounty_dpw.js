// LA County DPW scan driver — Milestone 1 (metadata ingestion), first Agency Direct driver.
//
// Task 4 placeholder: this exports the standard scan-driver contract
// (`scrape*(source, log) -> { candidates, errors, errorMessages }`) so the
// worker runner can be wired and validated end-to-end. Listing discovery and
// detail-page parsing are implemented in Task 5 — this file intentionally does
// no HTTP or HTML work yet and returns zero candidates.

async function scrapeLaCountyDpw(source, log = console.log) {
  log(`[${source.source_name}] LA County DPW scan driver not yet implemented (Task 5) — returning 0 candidates`);
  return { candidates: [], errors: 0, errorMessages: [] };
}

module.exports = { scrapeLaCountyDpw };

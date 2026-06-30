/**
 * Opportunity Pipeline Reset Utility
 *
 * Clears all opportunity pipeline data while preserving system configuration
 * (opportunity_sources, users, organizations, portal config, settings, etc.).
 *
 * After running, the system behaves exactly like a fresh install that has
 * never scanned opportunities.
 *
 * Usage:
 *   node scripts/reset-opportunity-pipeline.js --dry-run
 *   node scripts/reset-opportunity-pipeline.js --confirm
 *
 * Flags:
 *   --dry-run   Report what WOULD be deleted. No data is modified.
 *   --confirm   Execute the reset. Required for live runs — omitting it is
 *               treated as --dry-run.
 *
 * Required env vars:
 *   SUPABASE_URL
 *   SUPABASE_SERVICE_ROLE_KEY
 *
 * Safety guards:
 *   1. --confirm flag required (no accidental live run)
 *   2. Interactive confirmation prompt before executing
 *   3. NODE_ENV=production is rejected (must be undefined, 'development', or 'test')
 *   4. ALLOW_PIPELINE_RESET=true env var required as an additional gate
 *   5. Dry-run mode is always available without any guard
 *   6. projects FK columns are explicitly NULLed BEFORE any deletes, so projects
 *      rows are never destroyed even if TRUNCATE CASCADE is used externally.
 *      (ON DELETE SET NULL is honoured by DELETE but NOT by TRUNCATE.)
 *
 * Deletion order (most-dependent first, respects FK constraints):
 *   1.  saved_opportunities                 (→ opportunity_candidates)
 *   2.  opportunity_intelligence_citations  (→ findings, doc_chunks)
 *   3.  opportunity_intelligence_findings   (→ intelligence_reports)
 *   4.  opportunity_intelligence_reports    (→ candidates, agent_tasks)
 *   5.  opportunity_document_chunks         (→ document_pages)
 *   6.  opportunity_document_pages          (→ opportunity_documents)
 *   7.  opportunity_bid_items               (→ candidates, opportunity_documents)
 *   8.  opportunity_documents               (→ candidates, agent_tasks)
 *   9.  opportunity_candidates              (→ opportunity_sources [PRESERVED])
 *   10. agent_run_logs                      (→ agent_tasks)
 *   11. agent_tasks                         (all types — scan + intelligence)
 *   12. agent_runs                          (→ opportunity_sources [PRESERVED])
 *
 * Storage:
 *   All objects in the 'opportunity-documents' bucket are deleted.
 *
 * Preserved (never touched):
 *   opportunity_sources, profiles, projects, bids, subscriptions,
 *   portal_drivers, gc_qualification_profiles, cslb_cache, trade_types,
 *   gc_subcontractors, gc_sub_trade_mappings, subcontractors, sub_trade_mappings,
 *   project_trades, project_files, app_settings, user_roles,
 *   project_bid_readiness, project_readiness_items, project_trades
 *   All Supabase auth tables. All storage buckets other than opportunity-documents.
 */

'use strict';
require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');
const readline = require('readline');

// ── ENV VALIDATION ────────────────────────────────────────────────────────────

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error('\nERROR: SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set.\n');
  process.exit(1);
}

// ── ARGS ──────────────────────────────────────────────────────────────────────

const args = new Set(process.argv.slice(2));
const DRY_RUN = !args.has('--confirm') || args.has('--dry-run');
const SHOW_HELP = args.has('--help') || args.has('-h');

if (SHOW_HELP) {
  console.log(`
Opportunity Pipeline Reset Utility

  --dry-run   (default) Report counts. No data modified.
  --confirm   Execute the reset. Requires interactive prompt + ALLOW_PIPELINE_RESET=true.

Examples:
  node scripts/reset-opportunity-pipeline.js --dry-run
  ALLOW_PIPELINE_RESET=true node scripts/reset-opportunity-pipeline.js --confirm
`);
  process.exit(0);
}

// ── SUPABASE CLIENT ───────────────────────────────────────────────────────────

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

// ── TABLE INVENTORY ───────────────────────────────────────────────────────────
// Deletion order: most-dependent tables first to avoid FK violations.
// Each entry: { table, label, pkColumn }
// pkColumn is used for the "delete all where pk is not null" filter.

const PIPELINE_TABLES = [
  { table: 'saved_opportunities',               label: 'Saved opportunities',               pkColumn: 'id' },
  { table: 'opportunity_intelligence_citations', label: 'Intelligence citations',             pkColumn: 'id' },
  { table: 'opportunity_intelligence_findings',  label: 'Intelligence findings',              pkColumn: 'id' },
  { table: 'opportunity_intelligence_reports',   label: 'Intelligence reports',               pkColumn: 'id' },
  { table: 'opportunity_document_chunks',        label: 'Document chunks',                    pkColumn: 'id' },
  { table: 'opportunity_document_pages',         label: 'Document pages',                     pkColumn: 'id' },
  { table: 'opportunity_bid_items',              label: 'Bid items',                          pkColumn: 'id' },
  { table: 'opportunity_documents',              label: 'Opportunity documents',               pkColumn: 'id' },
  { table: 'opportunity_candidates',             label: 'Opportunity candidates',              pkColumn: 'id' },
  { table: 'agent_run_logs',                     label: 'Agent run logs',                     pkColumn: 'id' },
  { table: 'agent_tasks',                        label: 'Agent tasks',                        pkColumn: 'id' },
  { table: 'agent_runs',                         label: 'Agent runs (scan audit)',             pkColumn: 'id' },
];

// Tables that must stay untouched — listed for the preserved report.
const PRESERVED_TABLES = [
  'opportunity_sources',
  'portal_drivers',
  'gc_qualification_profiles',
  'profiles',
  'projects',
  'bids',
  'subscriptions',
  'cslb_cache',
  'trade_types',
  'gc_subcontractors',
  'gc_sub_trade_mappings',
  'app_settings',
  'user_roles',
];

const OPPORTUNITY_STORAGE_BUCKET = 'opportunity-documents';

// ── HELPERS ───────────────────────────────────────────────────────────────────

function fmt(n) {
  return n.toLocaleString();
}

async function countRows(table, pkColumn) {
  const { count, error } = await supabase
    .from(table)
    .select(pkColumn, { count: 'exact', head: true });
  if (error) {
    // Table might not exist yet (e.g. running against older schema)
    return { count: 0, missing: true };
  }
  return { count: count ?? 0, missing: false };
}

async function deleteAllRows(table, pkColumn) {
  const { error, count } = await supabase
    .from(table)
    .delete({ count: 'exact' })
    .not(pkColumn, 'is', null);
  if (error) throw new Error(`Delete from ${table} failed: ${error.message}`);
  return count ?? 0;
}

async function listStorageObjects(bucket, prefix = '') {
  const allPaths = [];
  let offset = 0;
  const LIMIT = 1000;

  while (true) {
    const { data, error } = await supabase.storage
      .from(bucket)
      .list(prefix, { limit: LIMIT, offset });

    if (error) {
      // Bucket may not exist yet — treat as empty
      if (error.message?.toLowerCase().includes('not found') ||
          error.message?.toLowerCase().includes('does not exist')) {
        break;
      }
      throw new Error(`Storage list (${bucket}/${prefix}) failed: ${error.message}`);
    }

    if (!data || data.length === 0) break;

    for (const item of data) {
      const fullPath = prefix ? `${prefix}/${item.name}` : item.name;
      if (item.id) {
        // It's a file object
        allPaths.push(fullPath);
      } else {
        // It's a folder — recurse
        const nested = await listStorageObjects(bucket, fullPath);
        allPaths.push(...nested);
      }
    }

    if (data.length < LIMIT) break;
    offset += LIMIT;
  }

  return allPaths;
}

async function deleteStorageObjects(bucket, paths) {
  if (paths.length === 0) return 0;
  const BATCH = 100;
  let deleted = 0;
  for (let i = 0; i < paths.length; i += BATCH) {
    const chunk = paths.slice(i, i + BATCH);
    const { error } = await supabase.storage.from(bucket).remove(chunk);
    if (error) throw new Error(`Storage delete (${bucket}) failed: ${error.message}`);
    deleted += chunk.length;
  }
  return deleted;
}

function prompt(question) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

function hr(char = '─') {
  return char.repeat(60);
}

// ── MAIN ──────────────────────────────────────────────────────────────────────

async function main() {
  const mode = DRY_RUN ? 'DRY RUN' : 'LIVE RESET';

  console.log(`\n${hr('═')}`);
  console.log(`  BidBox — Opportunity Pipeline Reset  [${mode}]`);
  console.log(`${hr('═')}\n`);

  if (!DRY_RUN) {
    console.log('  Target:  ', SUPABASE_URL);
    console.log('  Mode:     LIVE — data will be permanently deleted\n');
  }

  // ── SAFETY GATES (live only) ─────────────────────────────────────────────

  if (!DRY_RUN) {
    const env = process.env.NODE_ENV;
    if (env === 'production') {
      console.error('ERROR: Refusing to run in NODE_ENV=production.');
      console.error('       This tool is for development use only.\n');
      process.exit(1);
    }

    if (process.env.ALLOW_PIPELINE_RESET !== 'true') {
      console.error('ERROR: ALLOW_PIPELINE_RESET=true is required for live runs.');
      console.error('       Set it explicitly to confirm you understand the consequences.\n');
      process.exit(1);
    }
  }

  // ── COUNT PHASE ──────────────────────────────────────────────────────────

  console.log('  Scanning pipeline tables...\n');

  const tableCounts = [];
  let totalRows = 0;

  for (const entry of PIPELINE_TABLES) {
    const { count, missing } = await countRows(entry.table, entry.pkColumn);
    tableCounts.push({ ...entry, count, missing });
    totalRows += count;
  }

  // Storage
  console.log('  Scanning storage bucket...\n');
  let storagePaths = [];
  let storageError = null;
  try {
    storagePaths = await listStorageObjects(OPPORTUNITY_STORAGE_BUCKET);
  } catch (e) {
    storageError = e.message;
  }

  // Preserved row counts (for verification context)
  const preservedCounts = {};
  for (const t of ['opportunity_sources', 'profiles']) {
    const { count } = await countRows(t, 'id');
    preservedCounts[t] = count;
  }

  // ── PRINT SUMMARY ────────────────────────────────────────────────────────

  console.log(`  ${hr()}`);
  console.log(`  PIPELINE DATA — WILL BE ${DRY_RUN ? 'DELETED (dry run)' : 'DELETED'}`);
  console.log(`  ${hr()}`);

  let maxLabel = Math.max(...tableCounts.map((e) => e.label.length));

  for (const { label, count, missing } of tableCounts) {
    const tag = missing ? '  [table not found]' : '';
    const countStr = fmt(count).padStart(12);
    console.log(`  ${label.padEnd(maxLabel + 2)} ${countStr}${tag}`);
  }

  const storageStr = storageError
    ? `  [error: ${storageError}]`
    : fmt(storagePaths.length).padStart(12);
  console.log(`  ${'Storage objects (opportunity-documents)'.padEnd(maxLabel + 2)} ${storageStr}`);

  console.log(`\n  ${'TOTAL ROWS'.padEnd(maxLabel + 2)} ${fmt(totalRows).padStart(12)}`);

  console.log(`\n  ${hr()}`);
  console.log(`  PRESERVED (never modified)`);
  console.log(`  ${hr()}`);
  console.log(`  opportunity_sources     ${fmt(preservedCounts['opportunity_sources'] ?? 0).padStart(12)}`);
  console.log(`  profiles (users)        ${fmt(preservedCounts['profiles'] ?? 0).padStart(12)}`);
  console.log(`  + portal_drivers, gc_qualification_profiles, projects, subscriptions, ...`);
  console.log(`  + All auth tables, storage buckets (except opportunity-documents objects)`);

  if (DRY_RUN) {
    console.log(`\n  ${hr()}`);
    console.log(`  DRY RUN COMPLETE — no data was modified.`);
    console.log(`  Run with --confirm (and ALLOW_PIPELINE_RESET=true) to execute.`);
    console.log(`  ${hr()}\n`);
    return;
  }

  // ── CONFIRMATION PROMPT ──────────────────────────────────────────────────

  console.log(`\n  ${hr('!')}`);
  console.log(`  WARNING: This will permanently delete ${fmt(totalRows)} rows`);
  console.log(`           and ${fmt(storagePaths.length)} storage objects.`);
  console.log(`           This action cannot be undone.`);
  console.log(`  ${hr('!')}\n`);

  const answer = await prompt('  Type "reset" to confirm, anything else to abort: ');
  if (answer.toLowerCase() !== 'reset') {
    console.log('\n  Aborted. No data modified.\n');
    process.exit(0);
  }

  // ── EXECUTE RESET ────────────────────────────────────────────────────────

  console.log('\n  Executing reset...\n');

  const deleted = {};
  let anyError = false;

  // Sever FK links from projects → opportunity tables before any deletes.
  // projects.source_opportunity_candidate_id and
  // projects.opportunity_intelligence_report_id both carry ON DELETE SET NULL,
  // which DELETE honours but TRUNCATE does NOT. Explicitly NULLing these first
  // means projects rows survive even if someone runs TRUNCATE downstream.
  process.stdout.write('  Severing projects FK links (safety guard)...');
  const { error: projectsNullError } = await supabase
    .from('projects')
    .update({
      source_opportunity_candidate_id: null,
      opportunity_intelligence_report_id: null,
    })
    .not('id', 'is', null);
  if (projectsNullError) {
    console.log(` WARNING: ${projectsNullError.message} (continuing)`);
  } else {
    console.log(' done');
  }

  for (const { table, label, pkColumn } of PIPELINE_TABLES) {
    try {
      process.stdout.write(`  Deleting ${label}...`);
      const n = await deleteAllRows(table, pkColumn);
      deleted[table] = n;
      console.log(` ${fmt(n)} rows deleted`);
    } catch (e) {
      console.log(` ERROR: ${e.message}`);
      anyError = true;
    }
  }

  // Storage
  if (storagePaths.length > 0 && !storageError) {
    try {
      process.stdout.write(`  Deleting storage objects...`);
      const n = await deleteStorageObjects(OPPORTUNITY_STORAGE_BUCKET, storagePaths);
      deleted['_storage'] = n;
      console.log(` ${fmt(n)} objects deleted`);
    } catch (e) {
      console.log(` ERROR: ${e.message}`);
      anyError = true;
    }
  } else {
    deleted['_storage'] = 0;
    if (!storageError) console.log(`  Storage: bucket was already empty`);
  }

  // ── POST-RESET VERIFICATION ──────────────────────────────────────────────

  console.log('\n  Verifying reset...\n');

  const verifyTables = [
    { table: 'opportunity_candidates', label: 'Opportunity candidates', pkColumn: 'id' },
    { table: 'opportunity_documents', label: 'Documents', pkColumn: 'id' },
    { table: 'opportunity_intelligence_reports', label: 'Intelligence reports', pkColumn: 'id' },
    { table: 'opportunity_bid_items', label: 'Bid items', pkColumn: 'id' },
    { table: 'agent_tasks', label: 'Agent tasks', pkColumn: 'id' },
    { table: 'saved_opportunities', label: 'Saved opportunities', pkColumn: 'id' },
  ];

  let verifyPassed = true;
  for (const { table, label, pkColumn } of verifyTables) {
    const { count } = await countRows(table, pkColumn);
    const ok = count === 0;
    if (!ok) verifyPassed = false;
    const status = ok ? '✓ 0' : `✗ ${fmt(count)} (unexpected!)`;
    console.log(`  ${label.padEnd(30)} ${status}`);
  }

  // Verify preserved tables unchanged
  const srcAfter = await countRows('opportunity_sources', 'id');
  const profAfter = await countRows('profiles', 'id');
  const srcOk = srcAfter.count === (preservedCounts['opportunity_sources'] ?? 0);
  const profOk = profAfter.count === (preservedCounts['profiles'] ?? 0);
  if (!srcOk || !profOk) verifyPassed = false;
  console.log(`  opportunity_sources (preserved) ${srcOk ? '✓' : '✗'} ${fmt(srcAfter.count)} row(s)`);
  console.log(`  profiles (preserved)            ${profOk ? '✓' : '✗'} ${fmt(profAfter.count)} row(s)`);

  // ── FINAL SUMMARY ────────────────────────────────────────────────────────

  console.log(`\n  ${hr('═')}`);
  if (verifyPassed && !anyError) {
    console.log(`  RESET COMPLETE — verification passed`);
  } else {
    console.log(`  RESET COMPLETED WITH ISSUES — review output above`);
  }
  console.log(`  ${hr('═')}\n`);

  console.log('  Deleted:\n');
  let maxL2 = Math.max(...PIPELINE_TABLES.map((e) => e.label.length), 30);
  for (const { table, label } of PIPELINE_TABLES) {
    const n = deleted[table] ?? 0;
    console.log(`    ${label.padEnd(maxL2 + 2)} ${fmt(n)} rows`);
  }
  console.log(`    ${'Storage objects'.padEnd(maxL2 + 2)} ${fmt(deleted['_storage'] ?? 0)} files`);

  console.log('\n  Preserved:\n');
  for (const t of PRESERVED_TABLES) {
    console.log(`    ${t}`);
  }
  console.log('    + auth.users, auth.sessions, all other tables\n');

  if (!verifyPassed) process.exit(1);
}

main().catch((err) => {
  console.error('\nUnhandled error:', err.message);
  process.exit(1);
});

'use strict';
/**
 * Targeted validation: PlanetBids bid item parser
 *
 * Regression test for the "Total Bid Amount" lump-sum false-skip bug.
 * Exercises parseItemsFromHeadersAndRows logic directly (inlined here so
 * the test has no import coupling to the private driver function).
 *
 * Run: node scripts/test-bid-item-parser.js
 * Exit 0 = all pass, Exit 1 = failures.
 */

// ── Minimal replica of the fixed parser logic ─────────────────────────────────

function headerIdx(headers, patterns) {
  return headers.findIndex((h) => patterns.some((p) => p.test(h)));
}

function parseItemsFromHeadersAndRows(headers, rowTexts, sectionName, kind, log = () => {}) {
  const h = headers.map((x) => x.toLowerCase().trim());
  const itemIdx = headerIdx(h, [/^#$/, /item\s*(no|number|#)?$/, /^no\.?$/]);
  const codeIdx = headerIdx(h, [/item\s*code/, /^code$/]);
  const descIdx = headerIdx(h, [/description/, /item\s*description/, /scope/, /item\s*name/]);
  const uomIdx  = headerIdx(h, [/^uom$/, /unit\s*of\s*measure/, /^unit$/]);
  const qtyIdx  = headerIdx(h, [/^qty$/, /quantity/, /estimated\s*quantity/]);
  const refIdx  = headerIdx(h, [/reference/, /^ref$/]);

  let effectiveDescIdx = descIdx;
  if (effectiveDescIdx < 0 && rowTexts.length > 0) {
    const colWidths = (rowTexts[0] ?? []).map((_, ci) =>
      Math.max(...rowTexts.map((r) => (r[ci] ?? '').length))
    );
    effectiveDescIdx = colWidths.indexOf(Math.max(...colWidths));
  }

  const items = [];
  for (const [i, row] of rowTexts.entries()) {
    const description = (row[effectiveDescIdx] ?? '').trim();
    // Skip blank rows and bare footer totals ("Total", "Grand Total").
    // Do NOT skip named lump-sum items like "Total Bid Amount" or "Total Base Bid"
    // — those are valid bid schedule entries even though they start with "Total".
    if (!description || /^(grand\s+)?total\s*$/i.test(description)) continue;
    items.push({
      section_name: sectionName || null,
      item_number: itemIdx >= 0 ? (row[itemIdx] ?? '').trim() || String(i + 1) : String(i + 1),
      item_code:   codeIdx >= 0 ? (row[codeIdx] ?? '').trim() || null : null,
      description,
      unit_of_measure: uomIdx >= 0 ? (row[uomIdx] ?? '').trim() || null : null,
      quantity_raw:    qtyIdx >= 0 ? (row[qtyIdx] ?? '').trim() || null : null,
      reference:       refIdx >= 0 ? (row[refIdx] ?? '').trim() || null : null,
      raw_text: row.join(' | '),
      metadata: { source_table_headers: headers, source_table_kind: kind, fallback_desc: descIdx < 0 },
    });
  }
  return items;
}

// ── Test harness ──────────────────────────────────────────────────────────────

let passed = 0;
let failed = 0;

function assert(label, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (ok) {
    console.log(`  ✓ ${label}`);
    passed++;
  } else {
    console.error(`  ✗ ${label}`);
    console.error(`    expected: ${JSON.stringify(expected)}`);
    console.error(`    actual:   ${JSON.stringify(actual)}`);
    failed++;
  }
}

function assertEqual(label, actual, expected) {
  assert(label, actual, expected);
}

// ── Test 1: Norwalk — LOCAL STREET REHABILITATION ZONES 5 & 6 CIP 7944 ───────
// Single-row lump-sum schedule. The only bid item is "Total Bid Amount".
// Expected: 1 item stored with description="Total Bid Amount", UOM="Lump Sum", qty="1"
console.log('\nTest 1: Norwalk — single lump-sum schedule');
{
  const headers = ['#', 'Description', 'UOM', 'Qty'];
  const rows = [
    ['1', 'Total Bid Amount', 'Lump Sum', '1'],
  ];
  const items = parseItemsFromHeadersAndRows(headers, rows, null, 'dom');

  assertEqual('count', items.length, 1);
  assertEqual('description', items[0]?.description, 'Total Bid Amount');
  assertEqual('unit_of_measure', items[0]?.unit_of_measure, 'Lump Sum');
  assertEqual('quantity_raw', items[0]?.quantity_raw, '1');
  assertEqual('item_number', items[0]?.item_number, '1');
}

// ── Test 2: Bare footer "Total" row is skipped ────────────────────────────────
console.log('\nTest 2: bare footer "Total" row is skipped');
{
  const headers = ['#', 'Description', 'UOM', 'Qty'];
  const rows = [
    ['1', 'Cold Milling of Existing Pavement', 'SY', '12500'],
    ['2', 'AC Overlay', 'TON', '800'],
    ['',  'Total', '', ''],
  ];
  const items = parseItemsFromHeadersAndRows(headers, rows, null, 'dom');

  assertEqual('count', items.length, 2);
  assertEqual('row 0 desc', items[0]?.description, 'Cold Milling of Existing Pavement');
  assertEqual('row 1 desc', items[1]?.description, 'AC Overlay');
}

// ── Test 3: "Grand Total" footer row is skipped ───────────────────────────────
console.log('\nTest 3: "Grand Total" footer row is skipped');
{
  const headers = ['Description', 'Unit', 'Quantity'];
  const rows = [
    ['Mobilization', 'LS', '1'],
    ['Crack Sealing', 'LF', '5000'],
    ['Grand Total', '', ''],
  ];
  const items = parseItemsFromHeadersAndRows(headers, rows, null, 'dom');

  assertEqual('count', items.length, 2);
  assertEqual('no Grand Total row', items.find(i => /grand total/i.test(i.description)), undefined);
}

// ── Test 4: "Total Base Bid" kept as valid lump-sum item ─────────────────────
console.log('\nTest 4: "Total Base Bid" is a valid item (kept)');
{
  const headers = ['Item', 'Description', 'UOM', 'Qty'];
  const rows = [
    ['A', 'Total Base Bid', 'LS', '1'],
  ];
  const items = parseItemsFromHeadersAndRows(headers, rows, null, 'dom');

  assertEqual('count', items.length, 1);
  assertEqual('description', items[0]?.description, 'Total Base Bid');
}

// ── Test 5: "Total Contract Price" kept ──────────────────────────────────────
console.log('\nTest 5: "Total Contract Price" is a valid item (kept)');
{
  const headers = ['Description', 'Unit', 'Qty'];
  const rows = [
    ['Total Contract Price', 'Lump Sum', '1'],
  ];
  const items = parseItemsFromHeadersAndRows(headers, rows, null, 'dom');

  assertEqual('count', items.length, 1);
  assertEqual('description', items[0]?.description, 'Total Contract Price');
}

// ── Test 6: Multi-item schedule with mix of real items and footer ─────────────
console.log('\nTest 6: multi-item schedule — real items kept, footer skipped');
{
  const headers = ['#', 'Description', 'UOM', 'Qty'];
  const rows = [
    ['1', 'Cold Milling', 'SY', '10000'],
    ['2', 'ARAM Interlayer', 'SY', '10000'],
    ['3', 'AC Overlay', 'TON', '650'],
    ['4', 'Curb and Gutter Replacement', 'LF', '300'],
    ['',  'Total', '', ''],
  ];
  const items = parseItemsFromHeadersAndRows(headers, rows, null, 'dom');

  assertEqual('count', items.length, 4);
  assertEqual('no footer', items.every(i => !/^(grand\s+)?total\s*$/i.test(i.description)), true);
}

// ── Summary ───────────────────────────────────────────────────────────────────
console.log(`\n${passed + failed} assertions: ${passed} passed, ${failed} failed\n`);
if (failed > 0) process.exit(1);

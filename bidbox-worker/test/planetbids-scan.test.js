'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  openPlanetBidsRowWithRetry,
  waitForPlanetBidsDetailNavigation,
  waitForPlanetBidsListingState,
  isPlanetBidsListingResponseUrl,
  isPlanetBidsClockOrBeaconUrl,
  detectPlanetBidsInvalidPortal,
  cleanupPlanetBidsBrowserSession,
  runPlanetBidsListingRecovery,
} = require('../drivers/planetbids');

// ── Listing-readiness harness ────────────────────────────────────────────────
// Drives waitForPlanetBidsListingState on a virtual clock so tests assert the
// real wait semantics without sleeping. `script` maps elapsed ms -> page state.
function listingHarness(script) {
  let clock = 0;
  const state = (at) => script(at);
  return {
    now: () => clock,
    sleep: async (ms) => { clock += ms; },
    rows: () => ({ count: async () => state(clock).rowCount ?? 0 }),
    probe: async () => ({
      url: state(clock).url ?? 'https://vendors.planetbids.com/portal/14424/bo/bo-search',
      body_text: state(clock).body ?? '',
      found_bids_text: state(clock).foundBids ?? null,
      app_root_present: state(clock).appRoot ?? false,
      no_results_indicator: state(clock).noResults ?? false,
    }),
    elapsed: () => clock,
  };
}

test('PlanetBids row navigation waits only for a usable detail DOM', async () => {
  let options;
  const page = {
    waitForURL: async (_pattern, received) => { options = received; },
    url: () => 'https://vendors.planetbids.com/portal/1/bo/bo-detail/123',
  };

  await waitForPlanetBidsDetailNavigation(page);
  assert.equal(options.waitUntil, 'domcontentloaded');
  assert.equal(options.timeout, 25000);
});

test('PlanetBids row navigation accepts a landed detail route after a load timeout', async () => {
  const page = {
    waitForURL: async () => { throw new Error('load timeout'); },
    url: () => 'https://vendors.planetbids.com/portal/1/bo/bo-detail/123',
  };

  await assert.doesNotReject(() => waitForPlanetBidsDetailNavigation(page));
});

test('PlanetBids row navigation preserves a real failure on the listing route', async () => {
  const failure = new Error('navigation timeout');
  const page = {
    waitForURL: async () => { throw failure; },
    url: () => 'https://vendors.planetbids.com/portal/1/bo/bo-search',
  };

  await assert.rejects(() => waitForPlanetBidsDetailNavigation(page), failure);
});

test('PlanetBids row navigation reloads and retries one transient missed click', async () => {
  let clicks = 0;
  let reloads = 0;
  const row = { click: async () => { clicks++; } };
  const rows = () => ({ count: async () => 1, nth: () => row });
  const page = {
    waitForURL: async () => {
      if (clicks === 1) throw new Error('navigation timeout');
    },
    url: () => clicks === 1
      ? 'https://vendors.planetbids.com/portal/1/bo/bo-search'
      : 'https://vendors.planetbids.com/portal/1/bo/bo-detail/123',
  };

  const opened = await openPlanetBidsRowWithRetry({
    rows,
    index: 0,
    page,
    reloadListing: async () => { reloads++; },
  });
  assert.equal(opened, true);
  assert.equal(clicks, 2);
  assert.equal(reloads, 1);
});

test('PlanetBids row navigation remains bounded after a second missed click', async () => {
  let clicks = 0;
  let reloads = 0;
  const failure = new Error('navigation timeout');
  const rows = () => ({ count: async () => 1, nth: () => ({ click: async () => { clicks++; } }) });
  const page = {
    waitForURL: async () => { throw failure; },
    url: () => 'https://vendors.planetbids.com/portal/1/bo/bo-search',
  };

  await assert.rejects(() => openPlanetBidsRowWithRetry({
    rows,
    index: 0,
    page,
    reloadListing: async () => { reloads++; },
  }), failure);
  assert.equal(clicks, 2);
  assert.equal(reloads, 1);
});

test('PlanetBids listing recovery remains explicitly bounded to one reload', () => {
  const source = require('node:fs').readFileSync(require.resolve('../drivers/planetbids'), 'utf8');
  assert.match(source, /one bounded same-session reload before failing/);
  assert.match(source, /planetbids_listing_hydration_timeout/);
});

// ── Readiness-signal classification ──────────────────────────────────────────

test('PlanetBids boot beacons are never listing-readiness signals', () => {
  // The 2026-07-16 race: these resolve ~1s after navigation, long before /papi/bids.
  assert.equal(isPlanetBidsClockOrBeaconUrl('https://api-external.prod.planetbids.com/papi/server-time'), true);
  assert.equal(isPlanetBidsClockOrBeaconUrl('https://api-external.prod.planetbids.com/papi/t'), true);
  assert.equal(isPlanetBidsListingResponseUrl('https://api-external.prod.planetbids.com/papi/server-time'), false);
  assert.equal(isPlanetBidsListingResponseUrl('https://api-external.prod.planetbids.com/papi/t'), false);
});

test('PlanetBids listing endpoint is identified without matching lookup endpoints', () => {
  assert.equal(
    isPlanetBidsListingResponseUrl('https://api-external.prod.planetbids.com/papi/bids?bid_type_id=0&cid=14424'),
    true
  );
  // Lookups that merely contain "bid" must not be mistaken for the listing payload.
  for (const url of [
    'https://api-external.prod.planetbids.com/papi/bid-types',
    'https://api-external.prod.planetbids.com/papi/bid-downloadable-files?bid_id=1',
    'https://api-external.prod.planetbids.com/papi/departments',
    'https://api-external.prod.planetbids.com/papi/oauth/refresh/',
  ]) {
    assert.equal(isPlanetBidsListingResponseUrl(url), false, url);
  }
});

test('PlanetBids invalid-portal signature is recognized by URL or body', () => {
  assert.equal(detectPlanetBidsInvalidPortal('https://vendors.planetbids.com/2001', ''), true);
  assert.equal(
    detectPlanetBidsInvalidPortal(
      'https://vendors.planetbids.com/portal/15810/bo/bo-search',
      'This is not a valid PlanetBids agency portal'
    ),
    true
  );
  assert.equal(
    detectPlanetBidsInvalidPortal('https://vendors.planetbids.com/portal/14424/bo/bo-search', 'Found 12 bids'),
    false
  );
});

// ── Listing-state waiting ────────────────────────────────────────────────────

test('PlanetBids listing wait survives the /papi/server-time race and finds late rows', async () => {
  // Reproduces the confirmed production defect: a clock response lands almost
  // immediately and no rows exist at 1.5s, but the table paints at ~4s.
  const harness = listingHarness((at) => (at >= 4000 ? { rowCount: 7, body: 'Found 7 bids' } : { rowCount: 0, body: '' }));
  const result = await waitForPlanetBidsListingState({}, {
    ...harness,
    readinessSignals: { clock_or_beacon_observed: true, listing_endpoint_observed: false },
  });

  assert.equal(result.state, 'rows');
  assert.equal(result.rowCount, 7);
  assert.ok(result.waitMs >= 4000, `expected to wait past 1.5s, waited ${result.waitMs}ms`);
  assert.ok(result.waitMs < 15000);

  // Proof the assertion discriminates: the old fixed 1.5s budget misses this table.
  const starved = await waitForPlanetBidsListingState({}, {
    ...listingHarness((at) => (at >= 4000 ? { rowCount: 7 } : { rowCount: 0, body: '' })),
    timeout: 1500,
  });
  assert.equal(starved.state, 'timeout');
});

test('PlanetBids listing wait ignores unrelated API traffic and never returns rows early', async () => {
  // Several PlanetBids API responses, none of them listing data, must not satisfy readiness.
  const harness = listingHarness((at) => (at >= 6000 ? { rowCount: 2, body: 'Found 2 bids' } : { rowCount: 0, body: '' }));
  const result = await waitForPlanetBidsListingState({}, {
    ...harness,
    readinessSignals: { clock_or_beacon_observed: true, listing_endpoint_observed: false },
  });

  assert.equal(result.state, 'rows');
  assert.ok(result.waitMs >= 6000);
});

test('PlanetBids rows rendering without any observed listing response still succeed', async () => {
  // DOM is authoritative: a cached listing can paint with no fresh /papi/bids call.
  const harness = listingHarness(() => ({ rowCount: 3, body: 'Found 3 bids' }));
  const result = await waitForPlanetBidsListingState({}, {
    ...harness,
    readinessSignals: { clock_or_beacon_observed: false, listing_endpoint_observed: false },
  });

  assert.equal(result.state, 'rows');
  assert.equal(result.rowCount, 3);
});

test('PlanetBids slow listing render near the wait ceiling still succeeds', async () => {
  const harness = listingHarness((at) => (at >= 14500 ? { rowCount: 1, body: 'Found 1 bid' } : { rowCount: 0, body: '' }));
  const result = await waitForPlanetBidsListingState({}, { ...harness, timeout: 15000 });

  assert.equal(result.state, 'rows');
  assert.equal(result.rowCount, 1);
});

test('PlanetBids explicit zero-result portal completes cleanly without waiting', async () => {
  const harness = listingHarness(() => ({ rowCount: 0, body: 'Found 0 bids', foundBids: '0' }));
  const result = await waitForPlanetBidsListingState({}, harness);

  assert.equal(result.state, 'empty');
  assert.equal(result.foundBidsCount, 0);
  assert.equal(result.rowCount, 0);
});

test('PlanetBids no-results message is treated as an explicitly empty portal', async () => {
  const harness = listingHarness(() => ({ rowCount: 0, body: 'There are no open bids at this time.' }));
  const result = await waitForPlanetBidsListingState({}, harness);

  assert.equal(result.state, 'empty');
});

test('PlanetBids invalid portal is terminal and not a hydration timeout', async () => {
  const harness = listingHarness(() => ({
    rowCount: 0,
    url: 'https://vendors.planetbids.com/2001',
    body: 'This is not a valid PlanetBids agency portal',
  }));
  const result = await waitForPlanetBidsListingState({}, harness);

  assert.equal(result.state, 'invalid_portal');
  assert.notEqual(result.state, 'timeout');
  // Terminal states resolve immediately rather than burning the full wait.
  assert.ok(result.waitMs < 1000);
});

test('PlanetBids blank shell with background traffic is a bounded timeout, not an empty portal', async () => {
  // A blank body is a page that has not painted — never proof of zero listings.
  const harness = listingHarness(() => ({ rowCount: 0, body: '' }));
  const result = await waitForPlanetBidsListingState({}, {
    ...harness,
    timeout: 15000,
    readinessSignals: { clock_or_beacon_observed: true, listing_endpoint_observed: false },
  });

  assert.equal(result.state, 'timeout');
  assert.notEqual(result.state, 'empty');
  assert.ok(result.waitMs >= 15000, `expected the full bounded wait, got ${result.waitMs}ms`);
  assert.ok(result.waitMs < 20000, 'wait must stay bounded');
});

test('PlanetBids listing wait resolves on the first poll for an already-rendered table', async () => {
  const harness = listingHarness(() => ({ rowCount: 5, body: 'Found 5 bids' }));
  const result = await waitForPlanetBidsListingState({}, harness);

  assert.equal(result.state, 'rows');
  assert.equal(result.polls, 1);
  assert.equal(result.waitMs, 0);
});

test('PlanetBids hydration timeout no longer claims listing data was observed', () => {
  // Regression: /papi/server-time + a blank DOM must never produce the old wording.
  const source = require('node:fs').readFileSync(require.resolve('../drivers/planetbids'), 'utf8');
  assert.doesNotMatch(source, /Listing data was observed, but no usable bid detail targets were found/);
  assert.doesNotMatch(source, /No listing data or usable bid detail targets were found/);
  assert.match(source, /invalid_planetbids_portal/);
});

test('PlanetBids compound bootstrap failure exits before the full listing timeout', async () => {
  const harness = listingHarness(() => ({ rowCount: 0, body: '', appRoot: false }));
  const result = await waitForPlanetBidsListingState({}, {
    ...harness,
    timeout: 15000,
    detectBootstrapFailure: ({ elapsedMs }) => ({ detected: elapsedMs >= 2500, detected_at_ms: elapsedMs }),
  });
  assert.equal(result.state, 'bootstrap_failed');
  assert.ok(result.waitMs >= 2500);
  assert.ok(result.waitMs < 15000);
});

test('PlanetBids bootstrap detector cannot preempt later legitimate rows', async () => {
  const harness = listingHarness((at) => at >= 4000
    ? { rowCount: 3, body: 'Found 3 bids', appRoot: true }
    : { rowCount: 0, body: '', appRoot: false });
  const result = await waitForPlanetBidsListingState({}, {
    ...harness,
    detectBootstrapFailure: () => ({ detected: false }),
  });
  assert.equal(result.state, 'rows');
  assert.equal(result.rowCount, 3);
});

test('PlanetBids fresh-session recovery closes A before creating B and then continues', async () => {
  const events = [];
  const sessions = [];
  const result = await runPlanetBidsListingRecovery({
    createSession: async (attempt) => {
      events.push(`create-${attempt}`);
      const session = { sessionId: attempt === 1 ? 'session-a' : 'session-b' };
      sessions.push(session);
      return session;
    },
    cleanupSession: async (session) => {
      events.push(`cleanup-${session.sessionId}`);
      return { complete: true, session_id: session.sessionId };
    },
    runAttempt: async (session) => {
      events.push(`run-${session.sessionId}`);
      return { state: session.sessionId === 'session-a' ? 'bootstrap_failed' : 'rows', rowCount: 2 };
    },
  });
  assert.deepEqual(events, ['create-1', 'run-session-a', 'cleanup-session-a', 'create-2', 'run-session-b']);
  assert.equal(result.session.sessionId, 'session-b');
  assert.equal(result.listing.state, 'rows');
  assert.equal(result.sessionsCreated, 2);
  assert.equal(result.recoveryStrategy, 'fresh_session');
  assert.equal(sessions.length, 2);
});

test('PlanetBids fresh-session recovery never overlaps active sessions', async () => {
  let activeSessions = 0;
  let peakActiveSessions = 0;
  let creates = 0;
  const result = await runPlanetBidsListingRecovery({
    createSession: async () => {
      activeSessions++;
      peakActiveSessions = Math.max(peakActiveSessions, activeSessions);
      return { sessionId: `session-${++creates}` };
    },
    cleanupSession: async () => {
      activeSessions--;
      return { complete: true, session_released: true };
    },
    runAttempt: async (session) => ({ state: session.sessionId === 'session-1' ? 'bootstrap_failed' : 'rows' }),
  });
  assert.equal(result.sessionsCreated, 2);
  assert.equal(peakActiveSessions, 1);
  assert.equal(activeSessions, 1);
});

test('PlanetBids fresh-session recovery does not create B when A cannot be safely closed', async () => {
  let creates = 0;
  await assert.rejects(
    runPlanetBidsListingRecovery({
      createSession: async () => ({ sessionId: `session-${++creates}` }),
      cleanupSession: async () => ({ complete: false, errors: [{ step: 'session_released' }] }),
      runAttempt: async () => ({ state: 'bootstrap_failed' }),
    }),
    /could not be safely closed or released/
  );
  assert.equal(creates, 1);
});

test('PlanetBids repeated bootstrap failure exhausts after exactly two sessions', async () => {
  let creates = 0;
  const cleaned = [];
  const cleanupSession = async (session) => { cleaned.push(session.sessionId); return { complete: true }; };
  const result = await runPlanetBidsListingRecovery({
    createSession: async () => ({ sessionId: `session-${++creates}` }),
    cleanupSession,
    runAttempt: async () => ({ state: 'bootstrap_failed' }),
  });
  // The orchestrator releases the poisoned first session; the driver's outer
  // finally owns the active second session after classification.
  await cleanupSession(result.session);
  assert.equal(creates, 2);
  assert.deepEqual(cleaned, ['session-1', 'session-2']);
  assert.equal(result.recoveryExhausted, true);
  assert.equal(result.listing.state, 'bootstrap_failed');
});

test('PlanetBids fresh-session recovery preserves a different second-session failure', async () => {
  let creates = 0;
  const result = await runPlanetBidsListingRecovery({
    createSession: async () => ({ sessionId: `session-${++creates}` }),
    cleanupSession: async () => ({ complete: true }),
    runAttempt: async (session) => ({ state: session.sessionId === 'session-1' ? 'bootstrap_failed' : 'invalid_portal' }),
  });
  assert.equal(result.listing.state, 'invalid_portal');
  assert.equal(result.recoveryExhausted, false);
  assert.equal(creates, 2);
});

test('PlanetBids ordinary hydration timeout keeps the bounded same-session reload', async () => {
  let creates = 0;
  let attempts = 0;
  let sameSessionRetry = 0;
  const result = await runPlanetBidsListingRecovery({
    createSession: async () => ({ sessionId: `session-${++creates}` }),
    cleanupSession: async () => assert.fail('ordinary timeout must not fresh-session cleanup'),
    runAttempt: async () => { attempts++; return { state: 'timeout' }; },
    beforeSameSessionRetry: async () => { sameSessionRetry++; },
  });
  assert.equal(creates, 1);
  assert.equal(attempts, 2);
  assert.equal(sameSessionRetry, 1);
  assert.equal(result.recoveryStrategy, 'same_session_reload');
});

test('PlanetBids explicit empty and invalid portal never create recovery sessions', async () => {
  for (const state of ['empty', 'invalid_portal', 'rows']) {
    let creates = 0;
    const result = await runPlanetBidsListingRecovery({
      createSession: async () => ({ sessionId: `session-${++creates}` }),
      cleanupSession: async () => assert.fail(`${state} must not trigger recovery cleanup`),
      runAttempt: async () => ({ state }),
    });
    assert.equal(creates, 1);
    assert.equal(result.attempts, 1);
    assert.equal(result.listing.state, state);
  }
});

test('PlanetBids cleanup is ordered, scoped, and best-effort', async () => {
  const events = [];
  const session = {
    sessionId: 'owned-session',
    page: { isClosed: () => false, close: async () => { events.push('page'); throw new Error('page already closing'); } },
    context: { close: async () => { events.push('context'); } },
    browser: { close: async () => { events.push('browser'); } },
  };
  const outcome = await cleanupPlanetBidsBrowserSession(session, {
    release: async (sessionId) => { events.push(`release-${sessionId}`); return { released: true }; },
  });
  assert.deepEqual(events, ['page', 'context', 'browser', 'release-owned-session']);
  assert.equal(outcome.session_id, 'owned-session');
  assert.equal(outcome.session_released, true);
  assert.equal(outcome.complete, false);
  assert.equal(outcome.errors.length, 1);
});

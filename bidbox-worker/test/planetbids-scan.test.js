'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { openPlanetBidsRowWithRetry, waitForPlanetBidsDetailNavigation } = require('../drivers/planetbids');

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

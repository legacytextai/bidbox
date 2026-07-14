'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { waitForPlanetBidsDetailNavigation } = require('../drivers/planetbids');

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

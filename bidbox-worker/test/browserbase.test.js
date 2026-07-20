'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { releaseBrowserbaseSession } = require('../lib/browserbase');

test('Browserbase release scopes REQUEST_RELEASE to the supplied session', async () => {
  const previous = process.env.BROWSERBASE_API_KEY;
  process.env.BROWSERBASE_API_KEY = 'test-key';
  const requests = [];
  try {
    const result = await releaseBrowserbaseSession('owned-session', () => {}, async (url, options) => {
      requests.push({ url, options });
      return { ok: true, status: 200 };
    });
    assert.equal(result.released, true);
    assert.equal(requests.length, 1);
    assert.equal(requests[0].url, 'https://api.browserbase.com/v1/sessions/owned-session');
    assert.equal(requests[0].options.method, 'POST');
    assert.deepEqual(JSON.parse(requests[0].options.body), { status: 'REQUEST_RELEASE' });
    assert.equal(requests[0].options.headers['x-bb-api-key'], 'test-key');
  } finally {
    if (previous === undefined) delete process.env.BROWSERBASE_API_KEY;
    else process.env.BROWSERBASE_API_KEY = previous;
  }
});

test('Browserbase release accepts an already-terminal session response', async () => {
  const previous = process.env.BROWSERBASE_API_KEY;
  process.env.BROWSERBASE_API_KEY = 'test-key';
  try {
    const result = await releaseBrowserbaseSession('already-closed', () => {}, async () => ({ ok: false, status: 409 }));
    assert.equal(result.released, true);
    assert.equal(result.already_terminal, true);
  } finally {
    if (previous === undefined) delete process.env.BROWSERBASE_API_KEY;
    else process.env.BROWSERBASE_API_KEY = previous;
  }
});

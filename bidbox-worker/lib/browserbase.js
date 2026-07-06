// Shared Browserbase session bootstrap.
//
// This is the same session-create + CDP-connect handshake already duplicated in
// drivers/planetbids.js, drivers/planetbids_documents.js, and
// drivers/portal_intelligence.js. Extracted here so new Browserbase-backed
// drivers (starting with drivers/lacmta.js) don't add a fourth copy. The three
// existing call sites are intentionally left as-is in this change — they are
// working production code that can't be validated end-to-end from this
// environment, so migrating them is a separate, deliberately-scoped follow-up.

const { chromium } = require('playwright');

const SESSIONS_URL = 'https://www.browserbase.com/v1/sessions';

// Throws on any failure (missing API key, session-create HTTP error, CDP
// connect failure) rather than the accumulate-and-return-early style used
// inline in planetbids.js, so callers can handle it with their own existing
// per-driver error/log conventions via a normal try/catch.
async function connectBrowserbaseSession(log = console.log) {
  const apiKey = process.env.BROWSERBASE_API_KEY;
  const projectId = process.env.BROWSERBASE_PROJECT_ID ?? '';

  if (!apiKey) {
    throw new Error('BROWSERBASE_API_KEY not configured');
  }

  log('Creating Browserbase session');
  const sessionRes = await fetch(SESSIONS_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-bb-api-key': apiKey,
    },
    body: JSON.stringify({ projectId }),
  });

  if (!sessionRes.ok) {
    const errText = await sessionRes.text();
    throw new Error(`Browserbase session failed: ${sessionRes.status} — ${errText.substring(0, 200)}`);
  }

  const { id: sessionId } = await sessionRes.json();
  log(`Browserbase session: ${sessionId}`);

  const wsUrl = `wss://connect.browserbase.com?apiKey=${apiKey}&sessionId=${sessionId}`;
  const browser = await chromium.connectOverCDP(wsUrl);
  const context = browser.contexts()[0] ?? (await browser.newContext());
  const page = await context.newPage();

  return { browser, context, page, sessionId };
}

module.exports = { connectBrowserbaseSession };

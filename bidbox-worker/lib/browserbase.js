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
const yauzl = require('yauzl');

const SESSIONS_URL = 'https://www.browserbase.com/v1/sessions';
const API_BASE = 'https://api.browserbase.com/v1';

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

  // Browserbase does not sync file downloads to its cloud storage by default.
  // Playwright's own Download.path()/createReadStream() rely on local
  // filesystem access to the browser process, which doesn't exist over a
  // remote CDP connection — without this call they silently return an empty
  // artifact rather than throwing (confirmed live: "PDF file is empty, size
  // is zero bytes"). This CDP call opts the session into Browserbase syncing
  // the file so it can be retrieved afterward via fetchBrowserbaseDownloadZip.
  // downloadPath must be the literal string "downloads" — Browserbase's
  // documented convention, not a real local path.
  const cdpSession = await context.newCDPSession(page);
  await cdpSession.send('Browser.setDownloadBehavior', {
    behavior: 'allow',
    downloadPath: 'downloads',
    eventsEnabled: true,
  });

  return { browser, context, page, sessionId };
}

// Returns the bytes of the first non-directory entry in a zip buffer, or
// null if the zip is valid but contains no files (a real possibility here —
// an empty zip's End-Of-Central-Directory record is ~22 bytes, so it passes
// a naive "did we get any bytes back" check while still having zero files).
function extractFirstFileFromZip(zipBytes) {
  return new Promise((resolve, reject) => {
    yauzl.fromBuffer(zipBytes, { lazyEntries: true }, (err, zipfile) => {
      if (err) return reject(err);
      let resolved = false;
      zipfile.readEntry();
      zipfile.on('entry', (entry) => {
        if (resolved || /\/$/.test(entry.fileName)) {
          zipfile.readEntry();
          return;
        }
        zipfile.openReadStream(entry, (streamErr, stream) => {
          if (streamErr) return reject(streamErr);
          const chunks = [];
          stream.on('data', (chunk) => chunks.push(chunk));
          stream.on('end', () => {
            resolved = true;
            zipfile.close();
            resolve(Buffer.concat(chunks));
          });
          stream.on('error', reject);
        });
      });
      zipfile.on('end', () => {
        if (!resolved) resolve(null);
      });
    });
  });
}

// Retrieves every file downloaded during the session as a single zip
// (Browserbase's session-level downloads endpoint), unzips it in memory via
// yauzl (same library already used by drivers/archive_extraction.js), and
// returns the bytes of the first entry. Suited for drivers that trigger
// exactly one download per session, like lacmta.js's PDF export — a driver
// triggering multiple downloads would need to return all entries, not just
// the first.
async function fetchBrowserbaseDownloadZip(sessionId, log = console.log) {
  const apiKey = process.env.BROWSERBASE_API_KEY;
  if (!apiKey) {
    throw new Error('BROWSERBASE_API_KEY not configured');
  }

  // Browserbase docs: "Files sync in real time, but large downloads may not
  // be immediately available." The endpoint can return a structurally valid
  // but empty zip (no entries yet) before the file finishes syncing, so the
  // retry condition must check for an actual file inside, not just a
  // non-empty HTTP response.
  const maxAttempts = 6;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const res = await fetch(`${API_BASE}/sessions/${sessionId}/downloads`, {
      headers: { 'x-bb-api-key': apiKey },
    });
    if (!res.ok) {
      throw new Error(`Browserbase downloads fetch failed: ${res.status}`);
    }
    const zipBytes = Buffer.from(await res.arrayBuffer());
    if (zipBytes.length > 0) {
      const fileBytes = await extractFirstFileFromZip(zipBytes);
      if (fileBytes && fileBytes.length > 0) {
        return fileBytes;
      }
    }
    log(`Browserbase download not synced yet (attempt ${attempt}/${maxAttempts}) — retrying`);
    await new Promise((r) => setTimeout(r, 2000));
  }

  throw new Error('Browserbase download did not sync any files after retrying');
}

module.exports = { connectBrowserbaseSession, fetchBrowserbaseDownloadZip };

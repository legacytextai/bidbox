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

// ── Global session-creation guardrails (Browserbase account rate limits) ─────
// Browserbase enforces an account-wide concurrent-session / request-rate limit.
// Bursts (a nightly multi-portal scan plus auto document_prefetch) trip HTTP 429
// "Too Many Requests" on session creation. Two guardrails smooth this:
//   1. an in-process concurrency gate on session CREATION (per replica), and
//   2. a cooldown/backoff retry loop on 429/503 responses.
// NOTE: the concurrency gate is per Node process — true global concurrency
// across N Railway replicas is ~N × BROWSERBASE_GLOBAL_CONCURRENCY. During
// recovery, keep the replica count low and/or rely on the reduced task volume
// (PlanetBids auto document_prefetch is disabled by default via the worker
// kill switch). A DB-backed global lock (like the PlanetBids login lock) is the
// follow-up if a hard cross-replica cap is ever required.
const BROWSERBASE_GLOBAL_CONCURRENCY = Math.max(1, Number(process.env.BROWSERBASE_GLOBAL_CONCURRENCY) || 1);
const BROWSERBASE_429_COOLDOWN_MS = Math.max(0, Number(process.env.BROWSERBASE_429_COOLDOWN_MS) || 30_000);
const BROWSERBASE_429_MAX_RETRIES = Math.max(0, Number(process.env.BROWSERBASE_429_MAX_RETRIES) || 5);

let _bbActive = 0;
const _bbWaiters = [];
function _bbAcquire() {
  if (_bbActive < BROWSERBASE_GLOBAL_CONCURRENCY) { _bbActive++; return Promise.resolve(); }
  return new Promise((resolve) => _bbWaiters.push(resolve));
}
function _bbRelease() {
  _bbActive = Math.max(0, _bbActive - 1);
  const next = _bbWaiters.shift();
  if (next) { _bbActive++; next(); }
}
const _sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Create a Browserbase session id behind the concurrency gate with 429/503
// backoff. Shared by every session-create site so rate-limit handling is
// consistent. Returns the session id; throws on non-retryable failure or once
// retries are exhausted (caller keeps its own surrounding error handling).
async function createBrowserbaseSessionId(apiKey, projectId, log = console.log) {
  if (!apiKey) throw new Error('BROWSERBASE_API_KEY not configured');
  await _bbAcquire();
  try {
    for (let attempt = 1; ; attempt++) {
      const res = await fetch(SESSIONS_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-bb-api-key': apiKey },
        body: JSON.stringify({ projectId: projectId ?? '' }),
      });
      if (res.ok) {
        const { id } = await res.json();
        return id;
      }
      const errText = await res.text().catch(() => '');
      const rateLimited = res.status === 429 || res.status === 503;
      if (rateLimited && attempt <= BROWSERBASE_429_MAX_RETRIES) {
        log(`Browserbase rate-limited (HTTP ${res.status}); cooling down ${BROWSERBASE_429_COOLDOWN_MS}ms before retry ${attempt}/${BROWSERBASE_429_MAX_RETRIES}`);
        await _sleep(BROWSERBASE_429_COOLDOWN_MS);
        continue;
      }
      throw new Error(`Browserbase session failed: ${res.status} — ${errText.substring(0, 200)}`);
    }
  } finally {
    _bbRelease();
  }
}

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
  const sessionId = await createBrowserbaseSessionId(apiKey, projectId, log);
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

// Browserbase's session-update API uses REQUEST_RELEASE to terminate a session
// explicitly. Closing the CDP browser remains the first cleanup step; this call
// is the scoped, best-effort remote release for the same session id.
async function releaseBrowserbaseSession(sessionId, log = console.log, fetchImpl = fetch) {
  if (!sessionId) return { requested: false, released: false, reason: 'missing_session_id' };
  const apiKey = process.env.BROWSERBASE_API_KEY;
  if (!apiKey) throw new Error('BROWSERBASE_API_KEY not configured');

  const res = await fetchImpl(`${API_BASE}/sessions/${encodeURIComponent(sessionId)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-bb-api-key': apiKey },
    body: JSON.stringify({ status: 'REQUEST_RELEASE' }),
  });
  if (res.ok) {
    log(`Browserbase session released: ${sessionId}`);
    return { requested: true, released: true, status: res.status };
  }

  // The CDP close can win the race and make the explicit release redundant.
  // These terminal responses are safe and do not imply a leaked session.
  if ([404, 409, 410].includes(res.status)) {
    log(`Browserbase session already terminal: ${sessionId} (HTTP ${res.status})`);
    return { requested: true, released: true, already_terminal: true, status: res.status };
  }

  const detail = await res.text().catch(() => '');
  throw new Error(`Browserbase session release failed: ${res.status}${detail ? ` — ${detail.slice(0, 160)}` : ''}`);
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

function extractFilesFromZip(zipBytes) {
  return new Promise((resolve, reject) => {
    yauzl.fromBuffer(zipBytes, { lazyEntries: true }, (err, zipfile) => {
      if (err) return reject(err);
      const files = [];
      zipfile.readEntry();
      zipfile.on('entry', (entry) => {
        if (/\/$/.test(entry.fileName)) {
          zipfile.readEntry();
          return;
        }
        zipfile.openReadStream(entry, (streamErr, stream) => {
          if (streamErr) return reject(streamErr);
          const chunks = [];
          stream.on('data', (chunk) => chunks.push(chunk));
          stream.on('end', () => {
            const bytes = Buffer.concat(chunks);
            files.push({
              fileName: entry.fileName,
              bytes,
              fileSize: bytes.length,
            });
            zipfile.readEntry();
          });
          stream.on('error', reject);
        });
      });
      zipfile.on('end', () => resolve(files));
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

async function fetchBrowserbaseDownloadZipEntries(sessionId, log = console.log) {
  const apiKey = process.env.BROWSERBASE_API_KEY;
  if (!apiKey) {
    throw new Error('BROWSERBASE_API_KEY not configured');
  }

  const maxAttempts = 8;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const res = await fetch(`${API_BASE}/sessions/${sessionId}/downloads`, {
      headers: { 'x-bb-api-key': apiKey },
    });
    if (!res.ok) {
      throw new Error(`Browserbase downloads fetch failed: ${res.status}`);
    }
    const zipBytes = Buffer.from(await res.arrayBuffer());
    if (zipBytes.length > 0) {
      const files = await extractFilesFromZip(zipBytes);
      if (files.length > 0) return files;
    }
    log(`Browserbase downloads not synced yet (attempt ${attempt}/${maxAttempts}) — retrying`);
    await new Promise((r) => setTimeout(r, 2000));
  }

  throw new Error('Browserbase downloads did not sync any files after retrying');
}

module.exports = {
  connectBrowserbaseSession,
  fetchBrowserbaseDownloadZip,
  fetchBrowserbaseDownloadZipEntries,
  createBrowserbaseSessionId,
  releaseBrowserbaseSession,
};

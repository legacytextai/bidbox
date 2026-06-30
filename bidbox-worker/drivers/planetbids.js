const { chromium } = require('playwright');

function extractBidId(url) {
  const m = url.match(/\/bo-detail\/(\d+)/);
  return m ? m[1] : null;
}

function pacificOffsetHoursForDate(year, month, day) {
  try {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: 'America/Los_Angeles',
      timeZoneName: 'shortOffset',
    }).formatToParts(new Date(Date.UTC(year, month - 1, day, 12, 0, 0)));
    const tzName = parts.find((part) => part.type === 'timeZoneName')?.value ?? '';
    const match = tzName.match(/GMT([+-]\d{1,2})(?::?(\d{2}))?/i);
    if (match) return Math.abs(Number(match[1]));
  } catch {
    // Fall through to a conservative California bidding-season default.
  }
  return month >= 3 && month <= 10 ? 7 : 8;
}

function parseBidDueDate(raw) {
  if (!raw) return null;
  const text = String(raw).replace(/\s+/g, ' ').trim();
  const explicitPacific = text.match(
    /\b(\d{1,2})\/(\d{1,2})\/(\d{4})\s+(\d{1,2})(?::(\d{2}))?\s*(AM|PM)\s*(?:\(?\s*(PDT|PST|PT)\s*\)?)?/i
  );
  if (explicitPacific) {
    const [, monthText, dayText, yearText, hourText, minuteText = '0', meridiem, tzText] = explicitPacific;
    let hour = Number(hourText);
    const minute = Number(minuteText);
    if (/PM/i.test(meridiem) && hour !== 12) hour += 12;
    if (/AM/i.test(meridiem) && hour === 12) hour = 0;
    const year = Number(yearText);
    const month = Number(monthText);
    const day = Number(dayText);
    const offsetHours = /PST/i.test(tzText || '')
      ? 8
      : /PDT/i.test(tzText || '')
        ? 7
        : pacificOffsetHoursForDate(year, month, day);
    const d = new Date(Date.UTC(
      year,
      month - 1,
      day,
      hour + offsetHours,
      minute,
      0
    ));
    return isNaN(d.getTime()) ? null : d.toISOString();
  }
  try {
    const d = new Date(text);
    return isNaN(d.getTime()) ? null : d.toISOString();
  } catch {
    return null;
  }
}

function parseMoneyToken(token) {
  if (!token) return null;
  const cleaned = token.replace(/\s+/g, ' ').trim();
  const hasDollar = cleaned.includes('$');
  const hasComma = cleaned.includes(',');
  const unitMatch = cleaned.match(/([KMB])\b|\b(thousand|million|billion)\b/i);
  const numberMatch = cleaned.match(/(\d[\d,]*(?:\.\d+)?)/);
  if (!numberMatch) return null;

  const n = parseFloat(numberMatch[1].replace(/,/g, ''));
  if (!Number.isFinite(n) || n <= 0) return null;

  const unit = (unitMatch?.[1] ?? unitMatch?.[2] ?? '').toLowerCase();
  let value = n;
  if (unit === 'b' || unit === 'billion') value = n * 1_000_000_000;
  if (unit === 'm' || unit === 'million') value = n * 1_000_000;
  if (unit === 'k' || unit === 'thousand') value = n * 1_000;

  // Avoid treating small unlabeled counts, years, or bid numbers as estimates.
  if (!hasDollar && !hasComma && !unit && value < 10000) return null;
  return Math.round(value);
}

function parseEstimatedValueDetails(raw) {
  if (!raw) {
    return {
      estimated_value: null,
      estimated_value_raw: null,
      estimated_value_low: null,
      estimated_value_high: null,
    };
  }

  const text = String(raw).replace(/\s+/g, ' ').trim();
  const moneyPattern = /(?:\$+\s*)?\d[\d,]*(?:\.\d+)?\s*(?:[KkMmBb]|thousand|million|billion)?/g;
  const values = [...text.matchAll(moneyPattern)]
    .map((m) => ({ raw: m[0].trim(), value: parseMoneyToken(m[0]) }))
    .filter((m) => m.value !== null);

  if (values.length === 0) {
    return {
      estimated_value: null,
      estimated_value_raw: text || null,
      estimated_value_low: null,
      estimated_value_high: null,
    };
  }

  const first = values[0].value;
  const second = values[1]?.value ?? null;
  if (second !== null && /(?:-|–|—|\bto\b|\band\b|\bbetween\b)/i.test(text)) {
    const low = Math.min(first, second);
    const high = Math.max(first, second);
    return {
      estimated_value: Math.round((low + high) / 2),
      estimated_value_raw: text,
      estimated_value_low: low,
      estimated_value_high: high,
    };
  }

  return {
    estimated_value: first,
    estimated_value_raw: text,
    estimated_value_low: null,
    estimated_value_high: null,
  };
}

function parseEstimatedValue(raw) {
  return parseEstimatedValueDetails(raw).estimated_value;
}

function cleanText(value) {
  return String(value ?? '').replace(/\s+/g, ' ').trim();
}

function firstPresent(...values) {
  for (const value of values) {
    const cleaned = cleanText(value);
    if (cleaned) return cleaned;
  }
  return null;
}

function parseBooleanSignal(value) {
  if (value === true || value === false) return value;
  const text = cleanText(value).toLowerCase();
  if (!text) return null;
  if (/\b(optional|not required|not mandatory|no|false)\b/.test(text)) return false;
  if (/\b(mandatory|required|yes|true|must|required attendance|attendance required)\b/.test(text)) return true;
  return null;
}

function normalizeJobWalkMetadata(raw) {
  const dateTime = firstPresent(raw.section_scoped_job_walk_at, raw.job_walk_at, raw.pre_bid_meeting_at);
  const details = firstPresent(raw.section_scoped_job_walk_details, raw.job_walk_details);
  const attendanceRequired = firstPresent(raw.section_scoped_attendance_required, raw.attendance_required);
  const location = firstPresent(raw.job_walk_location, raw.pre_bid_meeting_location);
  const link = firstPresent(raw.meeting_link);
  const additionalDetails = firstPresent(raw.additional_details);
  const preBidExists = parseBooleanSignal(raw.pre_bid_meeting) ?? Boolean(dateTime || details || attendanceRequired || location || link || additionalDetails);
  const mandatory = parseBooleanSignal(attendanceRequired) ?? parseBooleanSignal(details);
  const exists = Boolean(preBidExists || dateTime || details || attendanceRequired || location || link || additionalDetails);

  return {
    pre_bid_exists: preBidExists ?? null,
    meeting_datetime: dateTime ?? null,
    meeting_location: location ?? null,
    meeting_link: link ?? null,
    additional_details: additionalDetails ?? null,
    pre_bid_location: location ?? null,
    pre_bid_meeting_link: link ?? null,
    pre_bid_notes: additionalDetails ?? null,
    job_walk_exists: exists || null,
    job_walk_mandatory: mandatory,
    job_walk_at: dateTime ?? null,
    pre_bid_meeting_at: firstPresent(raw.pre_bid_meeting_at, dateTime),
    job_walk_details: [details, additionalDetails, location ? `Location: ${location}` : null].filter(Boolean).join(' | ') || null,
    job_walk_location: location ?? null,
    attendance_required: attendanceRequired ?? null,
    pre_bid_meeting: raw.pre_bid_meeting || preBidExists || null,
  };
}

function isPlanetBidsApiResponse(res) {
  return res.url().includes('api-external.prod.planetbids.com') && res.status() >= 200 && res.status() < 300;
}

function createBiddingRowsLocator(page) {
  return page
    .locator([
      'table tbody tr',
      'table tr',
      '[role="table"] [role="row"]',
      '[role="grid"] [role="row"]',
      '[class*="result" i] [class*="row" i]',
      '[class*="bid" i][class*="row" i]',
      '[class*="opportunit" i][class*="row" i]',
    ].join(', '))
    .filter({ hasText: /\bBidding\b/i })
    .filter({ hasText: /(?:Bid|RFI|RFP|RFQ|RFQual|IPWB|Posted|Project|Invitation|Due Date|Remaining)/i });
}

async function waitForResultsReady(page, sourceName, log, apiReady = null) {
  apiReady ??= page.waitForResponse(isPlanetBidsApiResponse, { timeout: 25000 }).catch(() => null);

  await page.waitForSelector('body', { timeout: 30000 });
  const apiResponse = await apiReady;
  if (apiResponse) {
    log(`[${sourceName}] PlanetBids API response observed: ${apiResponse.url().substring(0, 180)}`);
  } else {
    log(`[${sourceName}] No PlanetBids API response observed before readiness timeout`);
  }

  await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});
  await page.waitForTimeout(apiResponse ? 1500 : 6000);
  return Boolean(apiResponse);
}

async function gotoListingAndWait(page, listingUrl, sourceName, log) {
  const apiReady = page.waitForResponse(isPlanetBidsApiResponse, { timeout: 25000 }).catch(() => null);

  await page.goto(listingUrl, { waitUntil: 'domcontentloaded', timeout: 60000 });
  return waitForResultsReady(page, sourceName, log, apiReady);
}

async function clickSearchIfAvailable(page, sourceName, log) {
  const searchButton = page.getByRole('button', { name: /^search$/i }).first();
  if (!(await searchButton.isVisible({ timeout: 2000 }).catch(() => false))) {
    return false;
  }

  log(`[${sourceName}] No Bidding rows after initial load — clicking Search`);
  const apiReady = page.waitForResponse(isPlanetBidsApiResponse, { timeout: 20000 }).catch(() => null);
  await searchButton.click();
  await page.waitForSelector('body', { timeout: 30000 });
  const apiResponse = await apiReady;
  if (apiResponse) {
    log(`[${sourceName}] PlanetBids API response observed after Search`);
  }
  await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});
  await page.waitForTimeout(apiResponse ? 1500 : 4000);
  return true;
}

async function captureZeroRowDiagnostics(page) {
  return page.evaluate(() => {
    const clean = (value) => String(value ?? '').replace(/\s+/g, ' ').trim();
    const bodyText = clean(document.body?.innerText ?? '');
    const foundBids = bodyText.match(/Found\s+([\d,]+)\s+bids?/i)?.[1] ?? null;
    const resultContainer = [
      ...document.querySelectorAll(
        'table, [role="table"], [role="grid"], [class*="result" i], [class*="bid" i], [class*="opportunit" i]'
      ),
    ].find((el) => /Posted|Project Title|Invitation|Due Date|Remaining|Stage|Bidding/i.test(el.textContent ?? ''));

    return {
      final_url: location.href,
      tr_count: document.querySelectorAll('tr').length,
      role_row_count: document.querySelectorAll('[role="row"]').length,
      found_bids_text: foundBids,
      body_preview: bodyText.substring(0, 700),
      result_html_preview: resultContainer ? clean(resultContainer.innerHTML).substring(0, 1200) : null,
    };
  }).catch((e) => ({
    final_url: page.url(),
    tr_count: null,
    role_row_count: null,
    found_bids_text: null,
    body_preview: `diagnostic capture failed: ${e.message}`,
    result_html_preview: null,
  }));
}

async function scrapePlanetBids(payload, log) {
  const { source_name, listing_url } = payload;
  const candidates = [];
  const errorMessages = [];
  let errors = 0;

  const recordError = (message) => {
    const clean = String(message ?? 'Unknown error');
    errorMessages.push(clean);
    log(`[${source_name}] ${clean}`);
  };

  const bbApiKey = process.env.BROWSERBASE_API_KEY;
  const bbProjectId = process.env.BROWSERBASE_PROJECT_ID ?? '';

  if (!bbApiKey) {
    recordError('BROWSERBASE_API_KEY not configured');
    return { candidates, errors: 1, errorMessages };
  }

  let browser = null;

  // FIX 4: 10-minute outer guard — returns partial results on timeout
  const TIMEOUT_MS = 10 * 60 * 1000;
  let timeoutHandle;
  const timeoutPromise = new Promise((_, reject) => {
    timeoutHandle = setTimeout(
      () => reject(new Error('Scrape timed out after 10 minutes')),
      TIMEOUT_MS
    );
  });

  try {
    await Promise.race([
      (async () => {
        log(`[${source_name}] Creating Browserbase session`);
        const sessionRes = await fetch('https://www.browserbase.com/v1/sessions', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-bb-api-key': bbApiKey,
          },
          body: JSON.stringify({ projectId: bbProjectId }),
        });

        if (!sessionRes.ok) {
          const errText = await sessionRes.text();
          recordError(`Browserbase session failed: ${sessionRes.status} — ${errText.substring(0, 200)}`);
          errors++;
          return;
        }

        const { id: sessionId } = await sessionRes.json();
        log(`[${source_name}] Session: ${sessionId}`);

        const wsUrl = `wss://connect.browserbase.com?apiKey=${bbApiKey}&sessionId=${sessionId}`;
        browser = await chromium.connectOverCDP(wsUrl);

        const bContext = browser.contexts()[0] ?? (await browser.newContext());
        const page = await bContext.newPage();
        const biddingRows = () => createBiddingRowsLocator(page);

        let bearerToken = null;
        let apiResponsesObserved = 0;
        page.on('request', (req) => {
          if (req.url().includes('api-external.prod.planetbids.com')) {
            const auth = req.headers()['authorization'] ?? '';
            if (auth.startsWith('Bearer ')) bearerToken = auth.slice(7);
          }
        });
        page.on('response', (res) => {
          if (isPlanetBidsApiResponse(res)) {
            apiResponsesObserved++;
          }
        });

        log(`[${source_name}] Loading listing: ${listing_url}`);
        await gotoListingAndWait(page, listing_url, source_name, log);

        let rowLocator = biddingRows();
        let rowCount = await rowLocator.count();
        if (rowCount === 0 && await clickSearchIfAvailable(page, source_name, log)) {
          rowLocator = biddingRows();
          rowCount = await rowLocator.count();
        }
        log(`[${source_name}] ${rowCount} Bidding row(s) found`);

        if (rowCount === 0) {
          const pageText = await page.locator('body').innerText({ timeout: 5000 }).catch(() => '');
          if (/no\s+(open\s+)?(bid|opportunit|record)|no\s+data|nothing\s+found/i.test(pageText)) {
            log(`[${source_name}] No active bidding rows found`);
            return;
          }
          const diagnostics = await captureZeroRowDiagnostics(page);
          recordError(
            `No Bidding rows rendered. final_url=${diagnostics.final_url}; ` +
            `api_responses=${apiResponsesObserved}; tr_count=${diagnostics.tr_count}; ` +
            `role_row_count=${diagnostics.role_row_count}; found_bids=${diagnostics.found_bids_text ?? 'n/a'}; ` +
            `Body preview: ${diagnostics.body_preview}`
          );
          if (diagnostics.result_html_preview) {
            log(`[${source_name}] Results HTML preview: ${diagnostics.result_html_preview}`);
          }
          errors++;
          return;
        }

        for (let i = 0; i < rowCount; i++) {
          try {
            if (i > 0) {
              await gotoListingAndWait(page, listing_url, source_name, log);
              await page.waitForTimeout(Math.floor(Math.random() * 1000)); // FIX 4: jitter
            }

            const rows = biddingRows();
            const currentCount = await rows.count();
            if (i >= currentCount) {
              log(`[${source_name}] Row ${i}: no longer present — skipping`);
              continue;
            }

            log(`[${source_name}] Clicking row ${i + 1}/${rowCount}`);
            await rows.nth(i).click();
            await page.waitForURL('**/bo-detail/**', { timeout: 25000 });

            const detailUrl = page.url();
            const bidId = extractBidId(detailUrl);
            if (!bidId) {
              log(`[${source_name}] Row ${i}: unexpected URL after click: ${detailUrl} — skipping`);
              errors++;
              continue;
            }

            await page.waitForTimeout(1000 + Math.floor(Math.random() * 1000)); // FIX 4: jitter

            const raw = await page.evaluate(() => {
              const bodyText = document.body.innerText;

              const field = (label) => {
                const re = new RegExp(label + '[:\\s]+([^\\n]{1,300})', 'i');
                const m = bodyText.match(re);
                return m ? m[1].trim() || null : null;
              };

              // Parses the "Pre-Bid Meeting Information" section from bodyText.
              // Returns an object of lowercased label → value string pairs when the
              // section is found, or null when the heading is absent from the page.
              // Uses bodyText (document.body.innerText) which preserves newlines,
              // so each field value is cleanly bounded by its own line.
              const extractPreBidMeetingSection = () => {
                const trimLine = (s) => String(s ?? '').trim();

                // Known labels inside the Pre-Bid Meeting Information section.
                const KNOWN_LABELS = [
                  'pre-bid meeting',
                  'meeting type',
                  'date & time',
                  'date/time',
                  'meeting date',
                  'meeting time',
                  'meeting link',
                  'attendance required',
                  'attendance mandatory',
                  'mandatory',
                  'location',
                  'meeting location',
                  'address',
                  'venue',
                  'additional details',
                  'notes',
                ];
                const labelKey = (s) => trimLine(s).toLowerCase().replace(/\s+/g, ' ');
                const labelSet = new Set(KNOWN_LABELS);

                // Heading: "Pre-Bid Meeting Information" (with or without "Information").
                // Must occupy its own line.
                const headingRe = /^pre[-\s]?bid\s+meeting(?:\s+information)?\s*$/im;
                const headingMatch = bodyText.match(headingRe);
                if (!headingMatch) return null;

                const afterHeading = headingMatch.index + headingMatch[0].length;

                // Stop at the next top-level section heading so we don't bleed into
                // Online Q&A, Contact Information, Bid Bond, etc.
                const STOP_RE = /^(?:online\s+q\s*&\s*a|contact\s+information|bid\s+bond|project\s+information|plan\s+holders|required\s+documents|addenda|q\s*&\s*a|documents?|submission)\s*$/im;
                const stopMatch = bodyText.substring(afterHeading).match(STOP_RE);
                const sectionEnd = stopMatch
                  ? afterHeading + stopMatch.index
                  : Math.min(afterHeading + 2000, bodyText.length);

                const sectionText = bodyText.substring(afterHeading, sectionEnd);
                const lines = sectionText.split('\n').map(trimLine).filter(Boolean);

                const pairs = {};
                for (let i = 0; i < lines.length; i++) {
                  const line = lines[i];

                  // "Label: Value" on the same line.
                  const colonIdx = line.indexOf(':');
                  if (colonIdx > 0 && colonIdx < 70) {
                    const rawKey = labelKey(line.substring(0, colonIdx));
                    const rawVal = trimLine(line.substring(colonIdx + 1));
                    if (labelSet.has(rawKey) && rawVal) {
                      pairs[rawKey] = rawVal;
                      continue;
                    }
                  }

                  // "Label" on one line, value on the next line.
                  const lineKey = labelKey(line);
                  if (labelSet.has(lineKey)) {
                    const nextLine = i + 1 < lines.length ? trimLine(lines[i + 1]) : null;
                    if (nextLine && !labelSet.has(labelKey(nextLine))) {
                      pairs[lineKey] = nextLine;
                      i++; // consume the value line
                    } else {
                      pairs[lineKey] = null; // label present, no value
                    }
                  }
                }

                return pairs;
              };

              // FIX 1: strip navigation chrome from extracted title
              const cleanTitle = (t) => {
                if (!t) return null;
                return t
                  .replace(/\s*Add to My Bids[\s\S]*/i, '')
                  .replace(/\s*REMAINING[\s\S]*/i, '')
                  .replace(/\s+(?:[A-Z]{1,4}-\d{2}-\d{3,5}|\d{2,4}-\d{3,5})\s*$/, '')
                  .trim() || null;
              };

              const titleEl = document.querySelector(
                "h1, h2, [class*='title'], [class*='bid-name'], [class*='project-name']"
              );
              const raw_title = cleanTitle(
                (titleEl && titleEl.innerText && titleEl.innerText.trim()) ||
                field('Bid Title') ||
                field('Project Title') ||
                field('Project Name') ||
                null
              );

              const due_date_raw =
                field('Closing Date') ||
                field('Bid Due Date') ||
                field('Bid Due') ||
                field('Due Date') ||
                null;

              const findEstimateRaw = () => {
                const labels = [
                  "Engineer's Estimate",
                  'Engineers Estimate',
                  'Estimated Value',
                  'Estimated Bid Value',
                  'Estimated Amount',
                  'Estimated Cost',
                  'Estimate Range',
                  'Project Estimate',
                  'Project Value',
                  'Construction Estimate',
                  'Cost Estimate',
                  'Budget',
                ];

                for (const label of labels) {
                  const direct = field(label);
                  if (direct) return `${label}: ${direct}`;
                }

                const normalized = bodyText.replace(/\s+/g, ' ');
                const labelPattern = labels
                  .map((label) => label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/'/g, "'?"))
                  .join('|');
                const moneyPattern = '(?:\\$\\s*)?\\d[\\d,]*(?:\\.\\d+)?\\s*(?:[KkMmBb]|thousand|million|billion)?';
                const re = new RegExp(
                  `(?:${labelPattern})\\s*[:\\-]?\\s*(?:between\\s+)?(${moneyPattern}(?:\\s*(?:-|–|—|to|and)\\s*${moneyPattern})?)`,
                  'i'
                );
                const m = normalized.match(re);
                return m ? m[0].trim().substring(0, 300) : null;
              };

              const estimated_value_raw = findEstimateRaw();

              const license_requirements =
                field('License Requirements') ||
                field('License Type') ||
                field('Required License') ||
                field('License') ||
                null;

              const county = field('County') || field('Location County') || null;
              const department = field('Department') || field('Agency Department') || null;
              const liquidated_damages =
                field('Liquidated Damages') ||
                field('Liquidated Damage') ||
                field('LDs') ||
                null;
              const contract_duration =
                field('Contract Duration') ||
                field('Duration') ||
                field('Project Duration') ||
                field('Time of Completion') ||
                field('Completion Time') ||
                null;
              const bid_validity =
                field('Bid Validity') ||
                field('Bid Valid Until') ||
                field('Bid Hold') ||
                field('Validity') ||
                null;
              const delivery_dates =
                field('Delivery Dates') ||
                field('Delivery Date') ||
                field('Start Date') ||
                field('Completion Date') ||
                null;
              const project_address =
                field('Project Address') ||
                field('Work Location') ||
                field('Location') ||
                field('Project Location') ||
                null;
              const job_walk_at =
                field('Job Walk Date') ||
                field('Job Walk Date & Time') ||
                field('Pre-Bid Meeting Date') ||
                field('Pre-Bid Meeting Date & Time') ||
                field('Prebid Meeting Date') ||
                field('Site Visit Date') ||
                null;
              const job_walk_details =
                field('Job Walk') ||
                field('Pre-Bid Meeting') ||
                field('Prebid Meeting') ||
                field('Mandatory Pre-Bid') ||
                field('Site Visit') ||
                null;
              const attendance_required =
                field('Attendance Required') ||
                field('Attendance Mandatory') ||
                field('Mandatory Attendance') ||
                field('Mandatory') ||
                null;
              const job_walk_location =
                field('Job Walk Location') ||
                field('Pre-Bid Meeting Location') ||
                field('Prebid Meeting Location') ||
                field('Site Visit Location') ||
                field('Meeting Location') ||
                null;
              // preBidPairs is null when "Pre-Bid Meeting Information" heading is absent.
              // preBidPairs is an object (possibly empty) when the heading is found.
              const preBidPairs = extractPreBidMeetingSection();

              const commodity_codes = [
                ...new Set((bodyText.match(/\b91\d{2,4}\b/g) ?? [])),
              ];

              const scopeMatch = bodyText.match(
                /(?:Description|Scope of (?:Work|Services?|Project))[\s:\n]+([\s\S]{50,3000}?)(?:\n{2,}|\n[A-Z][a-z])/i
              );
              const scope_text = scopeMatch ? scopeMatch[1].trim().substring(0, 3000) : null;

              return {
                raw_title: raw_title ? raw_title.substring(0, 500) : null,
                due_date_raw,
                estimated_value_raw,
                license_requirements,
                department,
                liquidated_damages,
                contract_duration,
                bid_validity,
                delivery_dates,
                project_address,
                job_walk_at,
                // Pre-bid fields come exclusively from the section parser when the
                // "Pre-Bid Meeting Information" heading is present.  When preBidPairs
                // is null (heading absent) we fall back to global field() lookups,
                // but we deliberately omit field('Pre-Bid Meeting') because its regex
                // matches the section heading itself and captures "Information".
                pre_bid_meeting: preBidPairs !== null
                  ? (preBidPairs['pre-bid meeting'] ?? null)
                  : (field('Prebid Meeting') || field('Job Walk') || null),
                pre_bid_meeting_at: preBidPairs !== null
                  ? (preBidPairs['date & time'] || preBidPairs['date/time'] || preBidPairs['meeting date'] || null)
                  : null,
                pre_bid_meeting_location: preBidPairs !== null
                  ? (preBidPairs['meeting location'] || preBidPairs['location'] || preBidPairs['address'] || preBidPairs['venue'] || null)
                  : null,
                meeting_type: preBidPairs !== null ? (preBidPairs['meeting type'] || null) : null,
                meeting_link: preBidPairs !== null ? (preBidPairs['meeting link'] || null) : null,
                additional_details: preBidPairs !== null
                  ? (preBidPairs['additional details'] || preBidPairs['notes'] || null)
                  : null,
                // attendance_required from section parser takes precedence; fall back
                // to global field() lookups when section not found.
                attendance_required: preBidPairs !== null
                  ? (preBidPairs['attendance required'] || preBidPairs['attendance mandatory'] || preBidPairs['mandatory'] || null)
                  : attendance_required,
                job_walk_details,
                job_walk_location: preBidPairs !== null
                  ? (preBidPairs['meeting location'] || preBidPairs['location'] || preBidPairs['address'] || job_walk_location)
                  : job_walk_location,
                // section_scoped_* carry only section-derived values into normalizeJobWalkMetadata.
                section_scoped_job_walk_at: preBidPairs !== null
                  ? (preBidPairs['date & time'] || preBidPairs['date/time'] || preBidPairs['meeting date'] || null)
                  : null,
                section_scoped_job_walk_details: null,
                section_scoped_attendance_required: preBidPairs !== null
                  ? (preBidPairs['attendance required'] || preBidPairs['attendance mandatory'] || preBidPairs['mandatory'] || null)
                  : null,
                county,
                commodity_codes,
                scope_text,
              };
            });

            // FIX 2: skip non-construction bids when codes are present and none are 91xxx
            if (raw.commodity_codes.length > 0) {
              const isConstruction = raw.commodity_codes.some((c) => {
                const n = parseInt(c, 10);
                return n >= 91000 && n <= 91999;
              });
              if (!isConstruction) {
                log(`[${source_name}] Skipping non-construction bid: ${(raw.raw_title ?? '').substring(0, 60)} (codes: ${raw.commodity_codes.join(', ')})`);
                continue;
              }
            }

            const estimate = parseEstimatedValueDetails(raw.estimated_value_raw);
            const jobWalkMetadata = normalizeJobWalkMetadata(raw);
            const crawl_data = {
              bid_id: bidId,
              due_date_raw: raw.due_date_raw,
              estimated_value: estimate.estimated_value,
              estimated_value_raw: estimate.estimated_value_raw,
              estimated_value_low: estimate.estimated_value_low,
              estimated_value_high: estimate.estimated_value_high,
              license_requirements: raw.license_requirements,
              department: raw.department,
              liquidated_damages: raw.liquidated_damages,
              contract_duration: raw.contract_duration,
              bid_validity: raw.bid_validity,
              delivery_dates: raw.delivery_dates,
              project_address: raw.project_address,
              ...jobWalkMetadata,
              meeting_type: raw.meeting_type,
              meeting_link: raw.meeting_link,
              additional_details: raw.additional_details,
              county: raw.county,
              commodity_codes: raw.commodity_codes,
              scope_text: raw.scope_text,
              scraped_at: new Date().toISOString(),
            };

            candidates.push({
              source_url: detailUrl,
              raw_title: raw.raw_title,
              bid_due_at: parseBidDueDate(raw.due_date_raw),
              crawl_data,
            });

            log(`[${source_name}] Row ${i + 1}: bid_id=${bidId} title="${(raw.raw_title ?? '').substring(0, 60)}"`);
          } catch (e) {
            recordError(`Row ${i}: error — ${e.message}`);
            errors++;
          }
        }

        if (bearerToken) {
          log(`[${source_name}] Bearer token captured — fetching ${candidates.length} manifest(s)`);
          for (const candidate of candidates) {
            const bidId = candidate.crawl_data?.bid_id;
            if (!bidId) continue;
            try {
              const manifestRes = await fetch(
                `https://api-external.prod.planetbids.com/papi/bid-downloadable-files?bid_id=${bidId}`,
                {
                  headers: {
                    Authorization: `Bearer ${bearerToken}`,
                    Referer: 'https://vendors.planetbids.com/',
                    Origin: 'https://vendors.planetbids.com',
                  },
                }
              );
              if (manifestRes.ok) {
                const json = await manifestRes.json();
                const documents = (json.data ?? []).map((item) => {
                  const a = item.attributes ?? {};
                  return {
                    file_title: String(a.fileTitle ?? a.file_title ?? ''),
                    filename: String(a.filename ?? ''),
                    file_size: typeof a.fileSize === 'number' ? a.fileSize : null,
                    server_full_path: String(a.serverFullPath ?? a.server_full_path ?? ''),
                    server_filename: String(a.serverFilename ?? a.server_filename ?? ''),
                  };
                });
                candidate.crawl_data.documents = documents;
                log(`[${source_name}] bid_id=${bidId}: ${documents.length} document(s)`);
              } else {
                log(`[${source_name}] bid_id=${bidId}: manifest HTTP ${manifestRes.status} — skipping`);
              }
            } catch (e) {
              log(`[${source_name}] bid_id=${bidId}: manifest error — ${e.message}`);
            }
          }
        } else {
          log(`[${source_name}] No bearer token captured — file manifests skipped`);
        }

        log(`[${source_name}] Scan complete. candidates=${candidates.length} errors=${errors}`);
      })(),
      timeoutPromise,
    ]);
  } catch (e) {
    if (e.message.includes('timed out')) {
      recordError(`${e.message} — returning ${candidates.length} partial result(s)`);
      errors++;
    } else {
      recordError(`Scrape error: ${e.message}`);
      errors++;
    }
  } finally {
    clearTimeout(timeoutHandle);
    if (browser) {
      try { await browser.close(); } catch (_) {}
    }
  }

  return { candidates, errors, errorMessages };
}

module.exports = {
  scrapePlanetBids,
  parseEstimatedValue,
  parseEstimatedValueDetails,
};

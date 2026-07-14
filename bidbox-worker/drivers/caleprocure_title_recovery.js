'use strict';

// Durable Cal eProcure title recovery. Re-opens the event detail page for a
// candidate stored with a placeholder title ("[Event Title]", id-only, …),
// waits for real hydration, extracts the title through the prioritized
// chain, and updates the candidate in place. Mirrors the PlanetBids
// candidate-recovery pattern: bounded attempts, recovery_* bookkeeping on
// the candidate, and one opportunity_recovery_audits row per attempt.

const { openBrowser, waitForDetail, extractDetailMetadata } = require('./caleprocure');
const { chooseBestEventTitle, isPlaceholderEventTitle } = require('../lib/caleprocure-quality');

const MAX_ATTEMPTS = 3;

function retryDelayMs(attempt) {
  if (attempt <= 1) return 15 * 60 * 1000;
  if (attempt === 2) return 2 * 60 * 60 * 1000;
  return null;
}

function classifyFailure(error, detail = null) {
  const text = String(error?.message ?? error ?? '');
  if (/429|rate.?limit/i.test(text)) return 'rate_limited';
  if (/context.*closed|target.*closed|browser.*closed/i.test(text)) return 'browser_context_closed';
  if (/timeout|timed out/i.test(text)) return 'detail_timeout';
  if (detail) return 'placeholder_still_rendered';
  return 'detail_extraction_failed';
}

function composeRawTitle(eventId, title) {
  return eventId && title && !title.startsWith(eventId) ? `${eventId} - ${title}` : title;
}

async function runCaleprocureTitleRecovery({ task, supabase, log = console.log }) {
  const candidateId = task.payload?.candidate_id;
  const dryRun = task.payload?.dry_run === true;
  if (!candidateId) throw new Error('caleprocure_title_recovery task missing candidate_id');

  const { data: candidate, error } = await supabase
    .from('opportunity_candidates').select('*').eq('id', candidateId).maybeSingle();
  if (error || !candidate) throw new Error(`title recovery candidate lookup failed: ${error?.message ?? 'not found'}`);
  if (candidate.portal_type !== 'caleprocure') throw new Error('title recovery candidate is not Cal eProcure');

  const eventId = candidate.portal_bid_id ?? candidate.crawl_data?.event_id ?? null;

  // Idempotence: a candidate whose title became valid since queueing needs no work.
  if (!isPlaceholderEventTitle(candidate.raw_title, eventId)) {
    if (!dryRun) {
      await supabase.from('opportunity_candidates')
        .update({ recovery_next_attempt_at: null }).eq('id', candidate.id);
    }
    log(`title already valid for ${candidate.id}; skipping`);
    return { candidate_id: candidate.id, skipped: true, reason: 'title_already_valid' };
  }

  const attempt = Math.max(1, Number(task.payload?.attempt_number ?? (candidate.recovery_attempt_count ?? 0) + 1));
  const trigger = task.payload?.recovery_trigger ?? task.trigger_reason ?? 'automatic_retry';
  const before = { raw_title: candidate.raw_title };
  const now = new Date().toISOString();

  let detail = null;
  let failure = null;
  let session = null;
  try {
    session = await openBrowser(log);
    await session.page.goto(candidate.source_url, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await waitForDetail(session.page);
    detail = await extractDetailMetadata(session.page);
  } catch (err) {
    failure = err;
    log(`title recovery navigation failed candidate=${candidate.id}: ${err.message}`);
  } finally {
    if (session?.browser) await session.browser.close().catch(() => {});
  }

  const chosen = detail
    ? chooseBestEventTitle([
        { value: detail.title, source: 'detail_event_name' },
        { value: detail.pageTitle, source: 'detail_page_title' },
      ], eventId)
    : { title: null, source: null };

  const successful = Boolean(chosen.title);
  const errorCode = successful ? null : classifyFailure(failure, detail);
  const nextDelay = successful || attempt >= MAX_ATTEMPTS ? null : retryDelayMs(attempt);
  const exhausted = !successful && attempt >= MAX_ATTEMPTS;
  const recoveredRawTitle = successful ? composeRawTitle(eventId, chosen.title) : null;

  if (!dryRun) {
    const bookkeeping = {
      recovery_attempt_count: attempt,
      recovery_last_attempt_at: now,
      recovery_next_attempt_at: nextDelay ? new Date(Date.now() + nextDelay).toISOString() : null,
      recovery_last_error_code: errorCode,
      recovery_last_error_reason: errorCode ? String(failure?.message ?? 'title still a placeholder after hydration wait').slice(0, 500) : null,
      recovery_exhausted_at: exhausted ? now : candidate.recovery_exhausted_at ?? null,
      recovery_last_task_id: task.id,
    };
    const patch = successful
      ? {
          ...bookkeeping,
          raw_title: recoveredRawTitle,
          crawl_data: {
            ...(candidate.crawl_data ?? {}),
            title: chosen.title,
            title_quality: 'valid',
            title_source: chosen.source,
            title_recovery_required: false,
            title_original: candidate.raw_title,
            title_recovered_at: now,
          },
        }
      : bookkeeping;
    const { error: updateError } = await supabase
      .from('opportunity_candidates').update(patch).eq('id', candidate.id);
    if (updateError) throw new Error(`title recovery update failed: ${updateError.message}`);

    await supabase.from('opportunity_recovery_audits').insert({
      opportunity_candidate_id: candidate.id,
      agent_task_id: task.id,
      attempt_number: attempt,
      trigger,
      extraction_source: 'rendered_page',
      before_values: before,
      after_values: { raw_title: successful ? recoveredRawTitle : candidate.raw_title },
      fields_changed: successful ? ['raw_title'] : [],
      confidence: successful ? 'high' : null,
      outcome: successful ? 'recovered' : (exhausted ? 'exhausted' : 'failed'),
      error_code: errorCode,
      error_reason: errorCode ? String(failure?.message ?? 'placeholder still rendered').slice(0, 500) : null,
      diagnostics: {
        event_id: eventId,
        title_source: chosen.source,
        detail_page_title: detail?.pageTitle ?? null,
        detail_event_name: detail?.title ?? null,
        transport: session?.transport ?? null,
      },
    });
  }

  log(`title recovery candidate=${candidate.id} attempt=${attempt} outcome=${successful ? 'recovered' : (exhausted ? 'exhausted' : 'failed')}${successful ? ` title="${chosen.title}"` : ` code=${errorCode}`}`);
  return {
    candidate_id: candidate.id,
    dry_run: dryRun,
    attempt,
    recovered: successful,
    exhausted,
    error_code: errorCode,
    original_title: before.raw_title,
    recovered_title: recoveredRawTitle,
    next_attempt_at: nextDelay ? new Date(Date.now() + nextDelay).toISOString() : null,
  };
}

module.exports = { runCaleprocureTitleRecovery, MAX_ATTEMPTS, retryDelayMs, classifyFailure, composeRawTitle };

const REPORT_SCHEMA_VERSION = 'f4_mvp_v1';
const MAX_CHUNKS_PER_CATEGORY = 18;
const MAX_CHUNK_CHARS = 1800;
const AI_GATEWAY_URL = process.env.PROJECT_INTELLIGENCE_AI_URL
  || 'https://api.openai.com/v1/chat/completions';
const AI_MODEL = process.env.PROJECT_INTELLIGENCE_MODEL || 'gpt-5.4-mini';

const CATEGORIES = [
  {
    key: 'executive_summary',
    label: 'Executive Summary',
    keywords: [
      'estimate', 'license', 'mandatory', 'pre-bid', 'job walk', 'bid bond',
      'liquidated damages', 'contract duration', 'calendar days', 'scope of work',
    ],
  },
  {
    key: 'project_overview',
    label: 'Project Overview',
    keywords: [
      'project name', 'bid no', 'bid number', 'invitation', 'engineer estimate',
      'estimated cost', 'bid date', 'bid opening', 'contract duration', 'license',
      'location',
    ],
  },
  {
    key: 'scope_summary',
    label: 'Scope Summary',
    keywords: [
      'scope of work', 'work includes', 'project consists', 'description of work',
      'construct', 'rehabilitation', 'improvements', 'location', 'quantities',
    ],
  },
  {
    key: 'trade_breakdown',
    label: 'Trade Breakdown',
    keywords: [
      'asphalt', 'concrete', 'striping', 'traffic control', 'electrical', 'landscape',
      'demolition', 'grading', 'paving', 'storm drain', 'sewer', 'water', 'trades',
    ],
  },
  {
    key: 'key_dates',
    label: 'Key Dates',
    keywords: [
      'bid due', 'bid opening', 'closing date', 'pre-bid', 'job walk', 'site visit',
      'questions', 'rfi', 'addendum', 'deadline', 'calendar days',
    ],
  },
  {
    key: 'bid_requirements',
    label: 'Bid Requirements',
    keywords: [
      'license', 'bid bond', 'performance bond', 'payment bond', 'dir', 'prevailing wage',
      'insurance', 'experience', 'prequalification', 'forms', 'non-collusion',
      'mandatory pre-bid', 'pre-bid meeting', 'prebid meeting', 'job walk',
      'site visit', 'attendance required',
    ],
  },
  {
    key: 'addenda_summary',
    label: 'Addenda Summary',
    keywords: [
      'addendum', 'addenda', 'clarification', 'revision', 'revised', 'replace',
      'modified', 'changed',
    ],
  },
  {
    key: 'risk_flags',
    label: 'Risk Flags',
    keywords: [
      'liquidated damages', 'delay', 'night work', 'weekend', 'traffic control',
      'long lead', 'constraint', 'special requirement', 'mandatory', 'hazardous',
      'penalty', 'insurance',
    ],
  },
];

const CATEGORY_ORDER = Object.fromEntries(CATEGORIES.map((category, index) => [category.key, index + 1]));

async function updateTaskStage(supabase, task, stage) {
  if (!task?.id) return;
  const payload = {
    ...(task.payload ?? {}),
    stage,
    stage_updated_at: new Date().toISOString(),
  };
  task.payload = payload;
  const { error } = await supabase
    .from('agent_tasks')
    .update({ payload })
    .eq('id', task.id);
  if (error) {
    console.warn(`[project_intelligence] task stage update failed: ${error.message}`);
  }
}

const CRITICAL_FIELD_KEYS = new Set([
  'bid_due_date',
  'required_license',
  'engineer_estimate',
  'bid_bond_requirement',
  'mandatory_job_walk',
  'questions_due_date',
  'addendum_due_date',
  'contract_duration',
  'liquidated_damages',
  'insurance_requirements',
]);

function normalizeText(value) {
  return String(value ?? '').replace(/\s+/g, ' ').trim();
}

function dateIdentity(value) {
  const text = normalizeText(value);
  if (!text) return null;

  const slash = text.match(/\b(\d{1,2})\/(\d{1,2})\/(\d{4})\b/);
  if (slash) {
    const [, month, day, year] = slash;
    return `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
  }

  const iso = text.match(/\b(\d{4})-(\d{2})-(\d{2})\b/);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;

  const monthName = text.match(
    /\b(January|February|March|April|May|June|July|August|September|October|November|December)\s+(\d{1,2}),\s+(\d{4})\b/i
  );
  if (monthName) {
    const months = {
      january: '01',
      february: '02',
      march: '03',
      april: '04',
      may: '05',
      june: '06',
      july: '07',
      august: '08',
      september: '09',
      october: '10',
      november: '11',
      december: '12',
    };
    return `${monthName[3]}-${months[monthName[1].toLowerCase()]}-${monthName[2].padStart(2, '0')}`;
  }

  return null;
}

function criticalDateReference(candidate, portalMetadata, fieldKey) {
  if (fieldKey === 'bid_due_date') {
    return portalMetadata?.due_date_raw || candidate?.bid_due_at || null;
  }
  if (fieldKey === 'mandatory_job_walk') {
    return portalMetadata?.job_walk_at || portalMetadata?.pre_bid_meeting_at || null;
  }
  if (fieldKey === 'questions_due_date') {
    return portalMetadata?.questions_due_at || portalMetadata?.questions_due_date || null;
  }
  if (fieldKey === 'addendum_due_date') {
    return portalMetadata?.addendum_due_at || portalMetadata?.addendum_due_date || null;
  }
  return null;
}

function truncate(value, maxLength) {
  const text = normalizeText(value);
  if (text.length <= maxLength) return text;
  return `${text.slice(0, maxLength - 1).trim()}…`;
}

function getAiKey() {
  return process.env.OPENAI_API_KEY
    || process.env.PROJECT_INTELLIGENCE_AI_KEY
    || null;
}

function categoryScore(chunk, category) {
  const haystack = normalizeText([
    chunk.text,
    chunk.document_class,
    chunk.document_family,
    chunk.file_name,
  ].join(' ')).toLowerCase();
  let score = 0;
  for (const keyword of category.keywords) {
    if (haystack.includes(keyword)) score += 10;
  }
  if (chunk.document_family === 'addenda' && category.key === 'addenda_summary') score += 20;
  if (chunk.document_family === 'contract_documents') score += 4;
  if (chunk.document_family === 'plans' && category.key === 'scope_summary') score += 3;
  if (chunk.document_family === 'bid_forms' && category.key === 'bid_requirements') score += 4;
  if (typeof chunk.inferred_precedence_rank === 'number') {
    score += Math.max(0, 12 - Math.min(12, Math.floor(chunk.inferred_precedence_rank / 10)));
  }
  return score;
}

function sortEvidence(a, b) {
  const aRank = a.inferred_precedence_rank ?? 999;
  const bRank = b.inferred_precedence_rank ?? 999;
  if (aRank !== bRank) return aRank - bRank;
  const aSource = a.document_source_order ?? 9999;
  const bSource = b.document_source_order ?? 9999;
  if (aSource !== bSource) return aSource - bSource;
  if (a.page_start !== b.page_start) return a.page_start - b.page_start;
  return a.chunk_index - b.chunk_index;
}

function buildEvidencePackets(chunks) {
  const packets = {};
  for (const category of CATEGORIES) {
    const scored = chunks
      .map((chunk) => ({ chunk, score: categoryScore(chunk, category) }))
      .filter((item) => item.score > 0);

    const selected = (scored.length > 0 ? scored : chunks.map((chunk) => ({ chunk, score: 0 })))
      .sort((a, b) => b.score - a.score || sortEvidence(a.chunk, b.chunk))
      .slice(0, MAX_CHUNKS_PER_CATEGORY)
      .map(({ chunk }) => ({
        chunk_id: chunk.id,
        document_id: chunk.opportunity_document_id,
        page_id: chunk.page_id ?? null,
        citation_label: chunk.citation_label,
        file_name: chunk.file_name,
        document_family: chunk.document_family,
        document_class: chunk.document_class,
        page_start: chunk.page_start,
        page_end: chunk.page_end,
        text: truncate(chunk.text, MAX_CHUNK_CHARS),
      }));
    packets[category.key] = selected;
  }
  return packets;
}

function getPortalMetadata(candidate) {
  const crawl = candidate?.crawl_data ?? {};
  return {
    estimated_value: crawl.estimated_value ?? null,
    estimated_value_raw: crawl.estimated_value_raw ?? null,
    estimated_value_low: crawl.estimated_value_low ?? null,
    estimated_value_high: crawl.estimated_value_high ?? null,
    license_requirements: crawl.license_requirements ?? null,
    liquidated_damages: crawl.liquidated_damages ?? null,
    department: crawl.department ?? null,
    delivery_dates: crawl.delivery_dates ?? null,
    due_date_raw: crawl.due_date_raw ?? null,
    contract_duration: crawl.contract_duration ?? null,
    bid_validity: crawl.bid_validity ?? null,
    project_address: crawl.project_address ?? null,
    pre_bid_exists: crawl.pre_bid_exists ?? null,
    meeting_datetime: crawl.meeting_datetime ?? null,
    meeting_location: crawl.meeting_location ?? null,
    meeting_link: crawl.meeting_link ?? null,
    additional_details: crawl.additional_details ?? null,
    job_walk_at: crawl.job_walk_at ?? null,
    job_walk_exists: crawl.job_walk_exists ?? null,
    job_walk_mandatory: crawl.job_walk_mandatory ?? null,
    job_walk_details: crawl.job_walk_details ?? null,
    pre_bid_meeting: crawl.pre_bid_meeting ?? null,
    pre_bid_meeting_at: crawl.pre_bid_meeting_at ?? null,
    attendance_required: crawl.attendance_required ?? null,
    meeting_type: crawl.meeting_type ?? null,
    county: crawl.county ?? null,
    scope_text: crawl.scope_text ?? candidate.scope_text ?? null,
    source_url: candidate.source_url ?? null,
    bid_due_at: candidate.bid_due_at ?? null,
  };
}

function buildPrompt({ candidate, evidencePackets }) {
  const portalMetadata = getPortalMetadata(candidate);
  return [
    {
      role: 'system',
      content: `You are generating a Project Intelligence report for a public works estimator.

Core rule: NO CITATION = NO FACT.
- Only report facts supported by cited evidence chunks.
- Use only chunk_ids included in the evidence.
- Do not invent requirements, dates, estimates, risks, quantities, or recommendations.
- If a field is not found, mark it unknown.
- Do not qualify the project, score fit, or recommend go/no-go.
- F4 answers: what does this project require?
- F5 later answers: is this a fit for this contractor?
- Use structured portal_metadata as source-page context when available. Portal metadata takes precedence over document inference in the Executive Summary and report context for matching fields such as estimate, license, department, location, contract duration, bid validity, delivery dates, pre-bid/job-walk details, and liquidated damages. Cited findings still require chunk citations.
- Structured portal/candidate metadata is authoritative for critical dates. Do not rewrite or contradict candidate.bid_due_at, portal_metadata.bid_due_at, or portal_metadata.due_date_raw. If document evidence conflicts with structured dates, return a conflict/needs_review finding rather than a found high-confidence finding.
- The Executive Summary must start with project context before bid requirements:
  1. First bullet starts with "Project Overview:" and gives a 1-2 sentence description of what the project is.
  2. Then include one or more bullets starting with "Key Bid Facts:" for bid due date, engineer estimate, contract duration, license requirement, bid bond, performance bond, and job walk when known.
  3. Then include one or more bullets starting with "Requirements / Risks:" for major requirements or risks.
- Bid due date/time is critical. If documents, portal_metadata, or candidate metadata disagree on bid due time, create a key_dates finding with status "conflict" or "needs_review"; do not silently choose one.
- Mandatory pre-bid/job-walk is critical. Treat required site visits, mandatory pre-bid meetings, attendance lists, job walk sign-in sheets, and pre-bid conference references as critical bid_requirements/key_dates evidence. If document names or portal_metadata indicate a job walk but the exact date/time is unclear, create a mandatory_job_walk finding with status "needs_review".

Return structured findings. Found and conflict findings must include citations.`,
    },
    {
      role: 'user',
      content: JSON.stringify({
        report_schema_version: REPORT_SCHEMA_VERSION,
        candidate: {
          id: candidate.id,
          title: candidate.raw_title,
          agency: candidate.agency,
          bid_due_at: candidate.bid_due_at,
          portal_type: candidate.portal_type,
          source_url: candidate.source_url,
          metadata: candidate.crawl_data,
        },
        portal_metadata: portalMetadata,
        required_sections: CATEGORIES.map((category) => category.key),
        critical_field_keys: Array.from(CRITICAL_FIELD_KEYS),
        evidence_packets: evidencePackets,
        output_contract: {
          executive_summary: {
            bullets: '3-8 concise bullets. First bullet must start with "Project Overview:" and explain what the project is before bid requirements. Then use "Key Bid Facts:" and "Requirements / Risks:" bullets. Use portal_metadata for source-page facts when available.',
          },
          findings: [
            {
              category: 'project_overview | scope_summary | trade_breakdown | key_dates | bid_requirements | addenda_summary | risk_flags',
              field_key: 'snake_case stable key',
              label: 'human readable label',
              value_text: 'concise value or null',
              value_jsonb: 'optional structured value',
              status: 'found | unknown | conflict | not_applicable | needs_review',
              confidence: 'high | medium | low',
              is_critical: 'boolean',
              notes: 'optional',
              citations: [
                {
                  chunk_id: 'must be one of the provided chunk IDs',
                  source_excerpt: 'short exact excerpt from the cited chunk text',
                },
              ],
            },
          ],
        },
      }),
    },
  ];
}

function getToolSchema() {
  return {
    type: 'function',
    function: {
      name: 'store_project_intelligence_report',
      description: 'Return a citation-backed Project Intelligence report.',
      parameters: {
        type: 'object',
        properties: {
          executive_summary: {
            type: 'object',
            properties: {
              bullets: {
                type: 'array',
                items: {
                  type: 'object',
                  properties: {
                    text: { type: 'string' },
                    finding_keys: {
                      type: 'array',
                      items: { type: 'string' },
                    },
                  },
                  required: ['text'],
                },
              },
            },
            required: ['bullets'],
          },
          findings: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                category: { type: 'string' },
                field_key: { type: 'string' },
                label: { type: 'string' },
                value_text: { type: ['string', 'null'] },
                value_jsonb: { type: ['object', 'array', 'string', 'number', 'boolean', 'null'] },
                status: { type: 'string', enum: ['found', 'unknown', 'conflict', 'not_applicable', 'needs_review'] },
                confidence: { type: 'string', enum: ['high', 'medium', 'low'] },
                is_critical: { type: 'boolean' },
                notes: { type: ['string', 'null'] },
                citations: {
                  type: 'array',
                  items: {
                    type: 'object',
                    properties: {
                      chunk_id: { type: 'string' },
                      source_excerpt: { type: 'string' },
                    },
                    required: ['chunk_id'],
                  },
                },
              },
              required: ['category', 'field_key', 'label', 'status', 'confidence', 'is_critical', 'citations'],
            },
          },
        },
        required: ['executive_summary', 'findings'],
      },
    },
  };
}

function countRawCitations(raw) {
  if (!Array.isArray(raw?.findings)) return 0;
  return raw.findings.reduce((sum, finding) => {
    return sum + (Array.isArray(finding?.citations) ? finding.citations.length : 0);
  }, 0);
}

function parseAiResponse(data, responseStatus) {
  const choice = data?.choices?.[0] ?? {};
  const message = choice?.message ?? {};
  const toolCall = data?.choices?.[0]?.message?.tool_calls?.find(
    (call) => call?.function?.name === 'store_project_intelligence_report',
  );
  const diagnostics = {
    http_status: responseStatus,
    finish_reason: choice?.finish_reason ?? null,
    tool_call_returned: Boolean(toolCall),
    tool_call_name: toolCall?.function?.name ?? null,
    tool_arguments_length: toolCall?.function?.arguments?.length ?? 0,
    content_length: message?.content?.length ?? 0,
    parsed_executive_summary_bullets: 0,
    parsed_findings_count: 0,
    parsed_citations_count: 0,
    raw_findings_missing: false,
    raw_findings_empty: false,
  };

  let parsed;
  if (toolCall?.function?.arguments) {
    parsed = JSON.parse(toolCall.function.arguments);
  } else {
    const content = data?.choices?.[0]?.message?.content;
    if (!content) throw new Error('AI response did not include report content');
    const match = content.match(/\{[\s\S]*\}/);
    if (!match) throw new Error('AI response was not valid JSON');
    parsed = JSON.parse(match[0]);
  }

  diagnostics.parsed_executive_summary_bullets = Array.isArray(parsed?.executive_summary?.bullets)
    ? parsed.executive_summary.bullets.length
    : 0;
  diagnostics.parsed_findings_count = Array.isArray(parsed?.findings) ? parsed.findings.length : 0;
  diagnostics.parsed_citations_count = countRawCitations(parsed);
  diagnostics.raw_findings_missing = !Array.isArray(parsed?.findings);
  diagnostics.raw_findings_empty = Array.isArray(parsed?.findings) && parsed.findings.length === 0;

  return { report: parsed, diagnostics };
}

async function callAi({ candidate, evidencePackets }) {
  const apiKey = getAiKey();
  if (!apiKey) {
    throw new Error('Project Intelligence AI key is not configured. Set OPENAI_API_KEY in the worker environment.');
  }

  const response = await fetch(AI_GATEWAY_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: AI_MODEL,
      messages: buildPrompt({ candidate, evidencePackets }),
      tools: [getToolSchema()],
      tool_choice: {
        type: 'function',
        function: { name: 'store_project_intelligence_report' },
      },
    }),
  });

  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new Error(`Project Intelligence AI request failed: ${response.status} ${text.slice(0, 300)}`);
  }

  return parseAiResponse(await response.json(), response.status);
}

function makeExcerpt(chunk, requested) {
  const source = normalizeText(chunk.text);
  const excerpt = normalizeText(requested);
  if (excerpt && source.toLowerCase().includes(excerpt.toLowerCase())) {
    return excerpt.slice(0, 600);
  }
  return source.slice(0, 600);
}

function isFactualStatus(status) {
  return status === 'found' || status === 'conflict';
}

function isProjectOverviewText(text) {
  return /^project overview\s*:/i.test(normalizeText(text));
}

function normalizeExecutiveSummaryText(text, index) {
  const value = normalizeText(text);
  if (!value) return value;
  if (index !== 0) return value;
  if (/^scope text\s*:/i.test(value)) {
    return value.replace(/^scope text\s*:/i, 'Project Overview:');
  }
  if (isProjectOverviewText(value)) return value;
  return `Project Overview: ${value}`;
}

function buildProjectOverviewBullet(findings) {
  const overview = findings.find((finding) =>
    isFactualStatus(finding.status) &&
    finding.value_text &&
    (finding.category === 'project_overview' || finding.category === 'scope_summary')
  );

  if (!overview) return null;
  return {
    text: truncate(`Project Overview: ${overview.value_text}`, 240),
    finding_keys: [overview.finding_key],
  };
}

function validateReport(raw, chunkMap, pageMap, context = {}) {
  const findings = [];
  const citations = [];
  const rejected = [];
  const candidate = context.candidate ?? null;
  const portalMetadata = context.portalMetadata ?? {};

  for (const item of raw?.findings ?? []) {
    const status = ['found', 'unknown', 'conflict', 'not_applicable', 'needs_review'].includes(item.status)
      ? item.status
      : 'needs_review';
    const category = CATEGORY_ORDER[item.category] ? item.category : 'risk_flags';
    const fieldKey = normalizeText(item.field_key).toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '') || 'unknown';
    const findingKey = `${category}.${fieldKey}`;
    const findingCitations = [];

    for (const citation of item.citations ?? []) {
      const chunk = chunkMap.get(citation.chunk_id);
      if (!chunk) continue;
      const page = pageMap.get(`${chunk.opportunity_document_id}:${chunk.page_start}`) ?? null;
      findingCitations.push({
        opportunity_document_id: chunk.opportunity_document_id,
        opportunity_document_page_id: page?.id ?? null,
        opportunity_document_chunk_id: chunk.id,
        source_document_name: chunk.file_name,
        page_number: chunk.page_start,
        page_label: page?.page_label ?? null,
        source_excerpt: makeExcerpt(chunk, citation.source_excerpt),
        citation_label: chunk.citation_label ?? `${chunk.file_name}, p. ${chunk.page_start}`,
      });
    }

    if (isFactualStatus(status) && findingCitations.length === 0) {
      rejected.push({
        category,
        field_key: fieldKey,
        reason: 'factual_finding_without_valid_citation',
      });
      findings.push({
        finding_key: findingKey,
        category,
        field_key: fieldKey,
        label: item.label || fieldKey.replace(/_/g, ' '),
        value_text: null,
        value_jsonb: null,
        status: 'needs_review',
        confidence: 'low',
        is_critical: Boolean(item.is_critical) || CRITICAL_FIELD_KEYS.has(fieldKey),
        notes: 'AI proposed a factual finding without valid citation support. No citation = no fact.',
      });
      continue;
    }

    let finalStatus = status;
    let finalConfidence = ['high', 'medium', 'low'].includes(item.confidence) ? item.confidence : 'low';
    let finalNotes = item.notes ?? null;
    const structuredDate = dateIdentity(criticalDateReference(candidate, portalMetadata, fieldKey));
    const aiDate = dateIdentity(item.value_text);
    if (structuredDate && aiDate && structuredDate !== aiDate) {
      finalStatus = 'conflict';
      finalConfidence = 'low';
      const message = `AI date conflicts with structured portal/candidate metadata (${structuredDate}).`;
      finalNotes = finalNotes ? `${finalNotes} ${message}` : message;
      rejected.push({
        category,
        field_key: fieldKey,
        reason: 'critical_date_conflicts_with_structured_metadata',
        structured_date: structuredDate,
        ai_date: aiDate,
      });
    }

    const finding = {
      finding_key: findingKey,
      category,
      field_key: fieldKey,
      label: item.label || fieldKey.replace(/_/g, ' '),
      value_text: item.value_text == null ? null : String(item.value_text),
      value_jsonb: item.value_jsonb ?? null,
      status: finalStatus,
      confidence: finalConfidence,
      is_critical: Boolean(item.is_critical) || CRITICAL_FIELD_KEYS.has(fieldKey),
      notes: finalNotes,
    };
    findings.push(finding);
    for (const citation of findingCitations) {
      citations.push({ finding_key: findingKey, ...citation });
    }
  }

  const citedFindingKeys = new Set(findings
    .filter((finding) => isFactualStatus(finding.status))
    .map((finding) => finding.finding_key));
  let bullets = (raw?.executive_summary?.bullets ?? [])
    .filter((bullet) => normalizeText(bullet.text))
    .map((bullet, index) => ({
      text: truncate(normalizeExecutiveSummaryText(bullet.text, index), 240),
      finding_keys: (bullet.finding_keys ?? []).filter((key) => citedFindingKeys.has(key)),
    }))
    .filter((bullet) => bullet.finding_keys.length > 0)
    .slice(0, 8);

  const needsOverviewFirst = bullets.length === 0 || !isProjectOverviewText(bullets[0].text);
  if (needsOverviewFirst) {
    const overviewBullet = buildProjectOverviewBullet(findings);
    if (overviewBullet) {
      bullets = [
        overviewBullet,
        ...bullets.filter((bullet) => bullet.finding_keys[0] !== overviewBullet.finding_keys[0]),
      ].slice(0, 8);
    }
  }

  if (bullets.length === 0) {
    const fallbackFindings = findings
      .filter((finding) => isFactualStatus(finding.status) && finding.value_text)
      .sort((a, b) => Number(b.is_critical) - Number(a.is_critical))
      .slice(0, 6);
    const overview = buildProjectOverviewBullet(fallbackFindings);
    bullets = fallbackFindings
      .map((finding) => ({
        text: truncate(`${finding.label}: ${finding.value_text}`, 240),
        finding_keys: [finding.finding_key],
      }));
    if (overview) {
      bullets = [
        overview,
        ...bullets.filter((bullet) => bullet.finding_keys[0] !== overview.finding_keys[0]),
      ].slice(0, 6);
    }
  }

  return {
    executive_summary: { bullets },
    findings,
    citations,
    rejected,
  };
}

function rollupFindings(findings) {
  const byCategory = {};
  const unknowns = [];
  for (const finding of findings) {
    const row = {
      field_key: finding.field_key,
      label: finding.label,
      value_text: finding.value_text,
      value_jsonb: finding.value_jsonb,
      status: finding.status,
      confidence: finding.confidence,
      is_critical: finding.is_critical,
      notes: finding.notes,
    };
    if (!byCategory[finding.category]) byCategory[finding.category] = [];
    byCategory[finding.category].push(row);
    if (finding.status === 'unknown') unknowns.push(row);
  }
  return { byCategory, unknowns };
}

async function queueProjectIntelligenceForCandidate({ supabase, candidateId, sourceTaskId = null, safeReanalysis = false }) {
  const { data: existing, error: existingError } = await supabase
    .from('agent_tasks')
    .select('id, status')
    .eq('task_type', 'project_intelligence')
    .in('status', ['pending', 'running', 'retrying'])
    .contains('payload', { candidate_id: candidateId })
    .limit(1)
    .maybeSingle();
  if (existingError) throw new Error(`Project Intelligence task lookup failed: ${existingError.message}`);
  if (existing) return { taskId: existing.id, duplicate: true };

  const { count, error: countError } = await supabase
    .from('opportunity_document_chunks')
    .select('id', { count: 'exact', head: true })
    .eq('opportunity_candidate_id', candidateId);
  if (countError) throw new Error(`Chunk count failed: ${countError.message}`);
  if (!count || count < 1) {
    return { taskId: null, duplicate: false, skipped: true, reason: 'no_usable_chunks' };
  }

  const now = new Date().toISOString();
  const candidateUpdate = safeReanalysis
    ? {
        analysis_error: null,
        opportunity_lifecycle_status: 'opportunity_intelligence_preparing',
        opportunity_intelligence_status: 'generating_report',
        opportunity_intelligence_error: null,
      }
    : {
        analysis_status: 'queued',
        analysis_error: null,
        analysis_started_at: null,
        analysis_completed_at: null,
        opportunity_lifecycle_status: 'opportunity_intelligence_preparing',
        opportunity_intelligence_status: 'generating_report',
        opportunity_intelligence_error: null,
      };
  const { error: candidateError } = await supabase
    .from('opportunity_candidates')
    .update(candidateUpdate)
    .eq('id', candidateId);
  if (candidateError) throw new Error(`Candidate Project Intelligence queue update failed: ${candidateError.message}`);

  const { data: task, error: taskError } = await supabase
    .from('agent_tasks')
    .insert({
      task_type: 'project_intelligence',
      status: 'pending',
      priority: 6,
      payload: {
        candidate_id: candidateId,
        source: 'f4_project_intelligence',
        source_task_id: sourceTaskId,
        report_schema_version: REPORT_SCHEMA_VERSION,
        retry_failed: false,
        safe_reanalysis: safeReanalysis,
        queued_at: now,
      },
      trigger_reason: safeReanalysis ? 'reanalyze' : 'pipeline_handoff',
    })
    .select('id')
    .single();
  if (taskError) throw new Error(`Project Intelligence task insert failed: ${taskError.message}`);

  return { taskId: task.id, duplicate: false, skipped: false };
}

async function loadEvidence(supabase, candidateId) {
  const { data: candidate, error: candidateError } = await supabase
    .from('opportunity_candidates')
    .select('*')
    .eq('id', candidateId)
    .maybeSingle();
  if (candidateError) throw new Error(`Candidate lookup failed: ${candidateError.message}`);
  if (!candidate) throw new Error(`Candidate not found: ${candidateId}`);

  const { data: documents, error: documentsError } = await supabase
    .from('opportunity_documents')
    .select('*')
    .eq('opportunity_candidate_id', candidateId)
    .order('inferred_precedence_rank', { ascending: true, nullsFirst: false })
    .order('document_source_order', { ascending: true, nullsFirst: false });
  if (documentsError) throw new Error(`Document lookup failed: ${documentsError.message}`);

  const { data: pages, error: pagesError } = await supabase
    .from('opportunity_document_pages')
    .select('id, opportunity_document_id, page_number, page_label')
    .eq('opportunity_candidate_id', candidateId);
  if (pagesError) throw new Error(`Page lookup failed: ${pagesError.message}`);

  const { data: chunks, error: chunksError } = await supabase
    .from('opportunity_document_chunks')
    .select('*')
    .eq('opportunity_candidate_id', candidateId);
  if (chunksError) throw new Error(`Chunk lookup failed: ${chunksError.message}`);
  if (!chunks || chunks.length === 0) throw new Error('No processed document chunks found for Project Intelligence');

  const docMap = new Map((documents ?? []).map((doc) => [doc.id, doc]));
  const enrichedChunks = chunks
    .map((chunk) => {
      const doc = docMap.get(chunk.opportunity_document_id) ?? {};
      return {
        ...chunk,
        file_name: doc.file_name ?? 'Unknown document',
        inferred_precedence_rank: doc.inferred_precedence_rank,
        document_source_order: doc.document_source_order,
        document_class: chunk.document_class ?? doc.document_class,
        document_family: chunk.document_family ?? doc.document_family,
      };
    })
    .sort(sortEvidence);

  return {
    candidate,
    documents: documents ?? [],
    pages: pages ?? [],
    chunks: enrichedChunks,
  };
}

async function prepareReportRow(supabase, candidateId, taskId, { createNewVersion = false } = {}) {
  const startedAt = new Date().toISOString();
  const { data: existing } = await supabase
    .from('opportunity_intelligence_reports')
    .select('id, report_version')
    .eq('opportunity_candidate_id', candidateId)
    .order('report_version', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (existing && !createNewVersion) {
    const { data, error } = await supabase
      .from('opportunity_intelligence_reports')
      .update({
        agent_task_id: taskId,
        status: 'generating',
        report_schema_version: REPORT_SCHEMA_VERSION,
        error: null,
        started_at: startedAt,
        completed_at: null,
      })
      .eq('id', existing.id)
      .select('id, report_version')
      .single();
    if (error) throw new Error(`Report update failed: ${error.message}`);
    return data;
  }

  const { data, error } = await supabase
    .from('opportunity_intelligence_reports')
    .insert({
      opportunity_candidate_id: candidateId,
      agent_task_id: taskId,
      status: 'generating',
      report_version: existing ? existing.report_version + 1 : 1,
      report_schema_version: REPORT_SCHEMA_VERSION,
      started_at: startedAt,
    })
    .select('id, report_version')
    .single();
  if (error) throw new Error(`Report insert failed: ${error.message}`);
  return data;
}

async function deleteSupersededReports(supabase, candidateId, activeReportId) {
  const { error } = await supabase
    .from('opportunity_intelligence_reports')
    .delete()
    .eq('opportunity_candidate_id', candidateId)
    .neq('id', activeReportId);
  if (error) throw new Error(`Superseded report cleanup failed: ${error.message}`);
}

async function replaceReportEvidence(supabase, reportId, candidateId, findings, citations) {
  const { error: citationDeleteError } = await supabase
    .from('opportunity_intelligence_citations')
    .delete()
    .eq('report_id', reportId);
  if (citationDeleteError) throw new Error(`Citation cleanup failed: ${citationDeleteError.message}`);

  const { error: findingDeleteError } = await supabase
    .from('opportunity_intelligence_findings')
    .delete()
    .eq('report_id', reportId);
  if (findingDeleteError) throw new Error(`Finding cleanup failed: ${findingDeleteError.message}`);

  const findingIdByKey = new Map();
  if (findings.length > 0) {
    const rows = findings.map((finding, index) => ({
      report_id: reportId,
      opportunity_candidate_id: candidateId,
      category: finding.category,
      field_key: finding.field_key,
      label: finding.label,
      value_text: finding.value_text,
      value_jsonb: finding.value_jsonb,
      status: finding.status,
      confidence: finding.confidence,
      is_critical: finding.is_critical,
      sort_order: CATEGORY_ORDER[finding.category] * 100 + index,
      notes: finding.notes,
    }));
    const { data, error } = await supabase
      .from('opportunity_intelligence_findings')
      .insert(rows)
      .select('id, category, field_key');
    if (error) throw new Error(`Finding insert failed: ${error.message}`);
    for (const row of data ?? []) {
      findingIdByKey.set(`${row.category}.${row.field_key}`, row.id);
    }
  }

  const citationRows = citations
    .map((citation) => ({
      report_id: reportId,
      finding_id: findingIdByKey.get(citation.finding_key),
      opportunity_document_id: citation.opportunity_document_id,
      opportunity_document_page_id: citation.opportunity_document_page_id,
      opportunity_document_chunk_id: citation.opportunity_document_chunk_id,
      source_document_name: citation.source_document_name,
      page_number: citation.page_number,
      page_label: citation.page_label,
      source_excerpt: citation.source_excerpt,
      citation_label: citation.citation_label,
    }))
    .filter((row) => row.finding_id);

  if (citationRows.length > 0) {
    const { error } = await supabase
      .from('opportunity_intelligence_citations')
      .insert(citationRows);
    if (error) throw new Error(`Citation insert failed: ${error.message}`);
  }

  return {
    findings_inserted: findings.length,
    citations_inserted: citationRows.length,
  };
}

function calculateConfidenceScore(findings) {
  const factual = findings.filter((finding) => isFactualStatus(finding.status));
  if (factual.length === 0) return null;
  const score = factual.reduce((sum, finding) => {
    if (finding.confidence === 'high') return sum + 1;
    if (finding.confidence === 'medium') return sum + 0.66;
    return sum + 0.33;
  }, 0) / factual.length;
  return Number(score.toFixed(2));
}

async function runProjectIntelligence(task, supabase, log) {
  const { candidate_id } = task.payload ?? {};
  if (!candidate_id) throw new Error('project_intelligence task missing candidate_id');
  const safeReanalysis = Boolean(task.payload?.safe_reanalysis);

  const startedAt = new Date().toISOString();
  if (safeReanalysis) {
    await supabase
      .from('opportunity_candidates')
      .update({
        analysis_started_at: startedAt,
        analysis_error: null,
        opportunity_lifecycle_status: 'opportunity_intelligence_preparing',
        opportunity_intelligence_status: 'generating_report',
        opportunity_intelligence_task_id: task.id,
        opportunity_intelligence_error: null,
      })
      .eq('id', candidate_id);
  } else {
    await supabase
      .from('opportunity_candidates')
      .update({
        analysis_status: 'analyzing',
        analysis_started_at: startedAt,
        analysis_completed_at: null,
        analysis_error: null,
        opportunity_lifecycle_status: 'opportunity_intelligence_preparing',
        opportunity_intelligence_status: 'generating_report',
        opportunity_intelligence_task_id: task.id,
        opportunity_intelligence_error: null,
      })
      .eq('id', candidate_id);
  }

  const report = await prepareReportRow(supabase, candidate_id, task.id, {
    createNewVersion: safeReanalysis,
  });
  log(`Starting F4 Project Intelligence for candidate ${candidate_id}`);

  try {
    await updateTaskStage(supabase, task, 'report_generation');
    const evidence = await loadEvidence(supabase, candidate_id);
    const chunkMap = new Map(evidence.chunks.map((chunk) => [chunk.id, chunk]));
    const pageMap = new Map(evidence.pages.map((page) => [`${page.opportunity_document_id}:${page.page_number}`, page]));
    const evidencePackets = buildEvidencePackets(evidence.chunks);
    const portalMetadata = getPortalMetadata(evidence.candidate);
    const { report: raw, diagnostics: aiDiagnostics } = await callAi({ candidate: evidence.candidate, evidencePackets });
    log(
      `F4 OpenAI response: status=${aiDiagnostics.http_status} ` +
      `finish_reason=${aiDiagnostics.finish_reason ?? 'unknown'} ` +
      `tool_call=${aiDiagnostics.tool_call_returned ? aiDiagnostics.tool_call_name : 'none'} ` +
      `tool_args_chars=${aiDiagnostics.tool_arguments_length} ` +
      `parsed_findings=${aiDiagnostics.parsed_findings_count} ` +
      `parsed_citations=${aiDiagnostics.parsed_citations_count}`
    );
    await updateTaskStage(supabase, task, 'validation');
    const validated = validateReport(raw, chunkMap, pageMap, {
      candidate: evidence.candidate,
      portalMetadata,
    });
    log(
      `F4 validation output: findings=${validated.findings.length} ` +
      `citations=${validated.citations.length} rejected=${validated.rejected.length}`
    );
    const rollup = rollupFindings(validated.findings);
    const persisted = await replaceReportEvidence(
      supabase,
      report.id,
      candidate_id,
      validated.findings,
      validated.citations,
    );

    const factualCount = validated.findings.filter((finding) => isFactualStatus(finding.status)).length;
    const finalStatus = factualCount > 0 ? (validated.rejected.length > 0 ? 'partial' : 'ready') : 'failed';
    const emptyReportError = aiDiagnostics.raw_findings_missing || aiDiagnostics.raw_findings_empty
      ? 'AI returned zero findings before citation validation'
      : null;
    const warningSummary = validated.rejected.length > 0
      ? `${validated.rejected.length} finding(s) downgraded or flagged by validation`
      : null;
    const errorSummary = finalStatus === 'failed'
      ? emptyReportError ?? 'Project Intelligence generated no cited factual findings'
      : null;
    const completedAt = new Date().toISOString();

    await supabase
      .from('opportunity_intelligence_reports')
      .update({
        status: finalStatus,
        title: evidence.candidate.raw_title,
        executive_summary: validated.executive_summary,
        overview: rollup.byCategory.project_overview ?? [],
        scope_summary: rollup.byCategory.scope_summary ?? [],
        trade_breakdown: rollup.byCategory.trade_breakdown ?? [],
        key_dates: rollup.byCategory.key_dates ?? [],
        bid_requirements: rollup.byCategory.bid_requirements ?? [],
        addenda_summary: rollup.byCategory.addenda_summary ?? [],
        risk_flags: rollup.byCategory.risk_flags ?? [],
        unknowns: rollup.unknowns,
        generation_metadata: {
          engine: 'openai_chat_completions',
          model: AI_MODEL,
          schema_version: REPORT_SCHEMA_VERSION,
          chunks_available: evidence.chunks.length,
          documents_available: evidence.documents.length,
          portal_metadata: portalMetadata,
          openai_response: {
            http_status: aiDiagnostics.http_status,
            finish_reason: aiDiagnostics.finish_reason,
            tool_call_returned: aiDiagnostics.tool_call_returned,
            tool_call_name: aiDiagnostics.tool_call_name,
            tool_arguments_length: aiDiagnostics.tool_arguments_length,
            content_length: aiDiagnostics.content_length,
          },
          parsed_output: {
            executive_summary_bullets: aiDiagnostics.parsed_executive_summary_bullets,
            findings_count: aiDiagnostics.parsed_findings_count,
            citations_count: aiDiagnostics.parsed_citations_count,
            raw_findings_missing: aiDiagnostics.raw_findings_missing,
            raw_findings_empty: aiDiagnostics.raw_findings_empty,
          },
          validation_output: {
            findings_count: validated.findings.length,
            citations_count: validated.citations.length,
            rejected_findings_count: validated.rejected.length,
          },
          findings_inserted: persisted.findings_inserted,
          citations_inserted: persisted.citations_inserted,
          validator_warnings: warningSummary
            ? {
                warning_summary: warningSummary,
                rejected_findings_count: validated.rejected.length,
              }
            : null,
          rejected_findings: validated.rejected,
          no_citation_no_fact: true,
        },
        confidence_score: calculateConfidenceScore(validated.findings),
        error: errorSummary,
        completed_at: completedAt,
      })
      .eq('id', report.id);

    await supabase
      .from('opportunity_candidates')
      .update({
        analysis_status: finalStatus === 'failed' && !safeReanalysis ? 'failed' : 'ready',
        analysis_completed_at: completedAt,
        analysis_error: finalStatus === 'failed'
          ? safeReanalysis
            ? `Re-analysis failed: ${errorSummary}`
            : errorSummary
          : null,
        opportunity_lifecycle_status: finalStatus === 'failed' && !safeReanalysis
          ? 'opportunity_intelligence_failed'
          : finalStatus === 'partial'
            ? 'opportunity_intelligence_partial'
            : 'opportunity_intelligence_ready',
        opportunity_intelligence_status: finalStatus,
        opportunity_intelligence_ready_at: finalStatus !== 'failed' ? completedAt : null,
        opportunity_intelligence_error: finalStatus === 'failed'
          ? safeReanalysis
            ? `Re-analysis failed: ${errorSummary}`
            : errorSummary
          : null,
      })
      .eq('id', candidate_id);

    if (finalStatus !== 'failed') {
      const { error: projectLinkError } = await supabase
        .from('projects')
        .update({
          opportunity_intelligence_report_id: report.id,
          project_lifecycle_status: 'project_intelligence_ready',
          project_intelligence_status: finalStatus,
          project_intelligence_ready_at: completedAt,
          project_intelligence_error: null,
        })
        .eq('origin', 'opportunity_intelligence')
        .eq('source_opportunity_candidate_id', candidate_id);

      if (projectLinkError) {
        log(`F4 project report link update skipped: ${projectLinkError.message}`);
      }

      if (safeReanalysis) {
        await deleteSupersededReports(supabase, candidate_id, report.id);
      }
    }

    log(`F4 Project Intelligence complete: report=${report.id} status=${finalStatus} findings=${persisted.findings_inserted} citations=${persisted.citations_inserted}`);
    await updateTaskStage(supabase, task, 'complete');
    return {
      candidate_id,
      report_id: report.id,
      status: finalStatus,
      findings_inserted: persisted.findings_inserted,
      citations_inserted: persisted.citations_inserted,
      critical_findings: validated.findings.filter((finding) => finding.is_critical).length,
      executive_summary_bullets: validated.executive_summary.bullets.length,
      warningSummary,
      errorSummary,
    };
  } catch (e) {
    const completedAt = new Date().toISOString();
    await supabase
      .from('opportunity_intelligence_reports')
      .update({
        status: 'failed',
        error: e.message,
        completed_at: completedAt,
      })
      .eq('id', report.id);
    await supabase
      .from('opportunity_candidates')
      .update({
        analysis_status: safeReanalysis ? 'ready' : 'failed',
        analysis_completed_at: completedAt,
        analysis_error: safeReanalysis ? `Re-analysis failed: ${e.message}` : e.message,
        opportunity_lifecycle_status: safeReanalysis ? 'opportunity_intelligence_ready' : 'opportunity_intelligence_failed',
        opportunity_intelligence_status: safeReanalysis ? 'ready' : 'failed',
        opportunity_intelligence_error: safeReanalysis ? `Re-analysis failed: ${e.message}` : e.message,
      })
      .eq('id', candidate_id);
    throw e;
  }
}

module.exports = {
  queueProjectIntelligenceForCandidate,
  runProjectIntelligence,
};

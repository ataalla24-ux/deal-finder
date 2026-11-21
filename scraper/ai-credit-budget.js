import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { githubQuotaStore } from './instagram-shared-quota.js';

const DAY = 86400000;
const ASTRA = 'gpt-6.2-astra';
const SOL = 'gpt-6.2-sol';
const ASTRA_PROFILE = 'astra-deal-enrichment';
const CHAT = 'https://api.openai.com/v1/chat/completions';
const RESPONSES = 'https://api.openai.com/v1/responses';
export const OPENAI_MODEL_TIMEOUT_MS = 110000;
const RATES = {
  // Price all input at the maximum 30-minute cache-write rate for Standard requests.
  [SOL]: [2.5, 10],
  [ASTRA]: [10, 40],
};
const MAX_TEXT_BYTES = 80000;
const TEXT_TOKEN_OVERHEAD = 1024;
const MAX_OUTPUT_TOKENS = 8192;
// Pro reports aggregated work. One 8192-output request metered 9891 output
// tokens and 4585 more input tokens than its previous reservation. These
// buffers cover that receipt; a larger future overrun is still settled and held.
const PRO_INPUT_HEADROOM = 8192;
const RESERVED_OUTPUT_TOKENS = MAX_OUTPUT_TOKENS + 2048;
const SAFE_ERRORS = ['insufficient_quota', 'credit_balance_exhausted', 'billing_hard_limit_reached', 'billing_not_active',
  'organization_spend_limit_exceeded', 'project_spend_limit_exceeded', 'organization_usage_limit_exceeded',
  'usage_limit_reached', 'rate_limit_exceeded', 'rate_limit_error', 'slow_down', 'invalid_api_key', 'model_not_found',
  'invalid_request_error', 'invalid_value', 'unsupported_parameter', 'unsupported_value', 'invalid_image', 'invalid_json_schema'];
const SAFE_PARAMETERS = ['model', 'reasoning_effort', 'reasoning.effort', 'reasoning.mode', 'service_tier', 'response_format',
  'text.format', 'max_completion_tokens', 'max_output_tokens', 'messages', 'input', 'prompt_cache_options'];
const paused = reason => Object.assign(new Error(`AI free-credit budget deferred: ${reason}`), {
  code: 'free_credit_budget_deferred', budgetReason: reason, haltBatch: true, retryAfterMs: 3600000,
});
const money = value => Math.ceil(value * 1000000) / 1000000;
function safeResponse(response, payload) {
  if (response.ok) return response;
  const code = [payload?.error?.code, payload?.error?.type].find(value => SAFE_ERRORS.includes(value)) || 'unclassified';
  return new Response(JSON.stringify({ error: { code, type: code, message: 'AI request deferred' } }), {
    status: response.status, headers: { 'content-type': 'application/json',
      ...(response.headers.get('retry-after') ? { 'retry-after': response.headers.get('retry-after') } : {}) },
  });
}

export function loadAiCreditPolicy() {
  try { return JSON.parse(readFileSync(new URL('../reviews/ai-credit-policy.json', import.meta.url), 'utf8')); }
  catch { throw paused('missing-or-invalid-policy'); }
}

export function isAstraEnrichmentActive({ enabled = process.env.FREEFINDER_ASTRA_ENRICHMENT === '1',
  now = Date.now(), policy } = {}) {
  if (!enabled) return false;
  policy ??= loadAiCreditPolicy();
  const profile = policy.astraEnrichment;
  return profile?.rollingDayLimitUsd > 0 && now >= Date.parse(profile.notBefore)
    && now + 120000 < Date.parse(policy.expiresAt);
}

export function modelForTask(_task, override) {
  const model = String(override || SOL).trim();
  if (!Object.hasOwn(RATES, model)) throw paused('unpriced-model');
  if (isAstraEnrichmentActive()) return ASTRA;
  return model;
}

export function dealEnrichmentModelTimeoutMs() {
  return OPENAI_MODEL_TIMEOUT_MS;
}

// A confirmed new grant can release completed prior-period spend for its own
// limit. Keep unknown charges and all still-recent usage in the admission checks.
export function creditPeriodExposure(reservations, periodId) {
  return reservations.filter(row => !row.creditPeriod || row.creditPeriod === periodId || row.status !== 'settled');
}

export function validateCreditPolicy(policy, now = Date.now()) {
  const start = Date.parse(policy?.notBefore), end = Date.parse(policy?.expiresAt);
  const guard = policy?.providerGuard;
  const astra = policy?.astraEnrichment;
  if (policy?.version !== 1 || policy.mode !== 'free-credit-only' || !policy.periodId
    || policy.paidFallback !== false || policy.automaticRenewalAssumed !== false
    || !Number.isFinite(start) || !Number.isFinite(end) || now < start || now + 120000 >= end
    || end - start > 32 * DAY
    || (policy.rolloverFrom !== undefined
      && (typeof policy.rolloverFrom !== 'string' || !policy.rolloverFrom || policy.rolloverFrom === policy.periodId))
    || guard?.enforced !== true || guard.scope !== 'organization'
    || guard.autoReload !== false || guard.paidBalanceAvailable !== false
    || !Number.isFinite(Date.parse(guard.verifiedAt)) || Date.parse(guard.verifiedAt) > now
    || ![policy.periodLimitUsd, policy.rollingDayLimitUsd, policy.requestLimitUsd, guard.monthlyLimitUsd]
      .every(value => Number.isFinite(value) && value > 0)
    || policy.periodLimitUsd > guard.monthlyLimitUsd || policy.rollingDayLimitUsd > policy.periodLimitUsd
    || (astra !== undefined && (!Number.isFinite(Date.parse(astra?.notBefore))
      || Date.parse(astra.notBefore) < start || Date.parse(astra.notBefore) >= end
      || !Number.isFinite(astra.rollingDayLimitUsd) || astra.rollingDayLimitUsd <= 0
      || astra.rollingDayLimitUsd > policy.periodLimitUsd))) {
    throw paused('unverified-expired-or-unsafe-credit-policy');
  }
  return policy;
}

export function prepareBudgetedRequest(url, init) {
  if (![CHAT, RESPONSES].includes(String(url))) throw paused('unsupported-endpoint');
  let body;
  try { body = JSON.parse(init.body); } catch { throw paused('invalid-request'); }
  if (!body || !Object.hasOwn(RATES, body.model) || body.tools?.length || body.functions?.length
    || body.function_call || body.previous_response_id || body.conversation || body.background || body.stream
    || body.n && body.n !== 1 || body.service_tier && body.service_tier !== 'default') throw paused('unbounded-or-unpriced-request');
  const responses = String(url) === RESPONSES;
  const requestedOutput = Number(body.max_output_tokens ?? body.max_completion_tokens ?? body.max_tokens ?? 4096);
  if (!Number.isInteger(requestedOutput) || requestedOutput < 1 || requestedOutput > 8192) throw paused('output-limit');
  // Both models share the upper bound for visible output plus reasoning tokens.
  const outputTokens = MAX_OUTPUT_TOKENS;
  for (const key of ['temperature', 'top_p', 'logprobs', 'top_logprobs', 'prompt_cache_retention', 'prompt_cache_options']) {
    delete body[key];
  }
  if (responses) {
    body.reasoning = { effort: 'max', mode: 'pro' };
    body.prompt_cache_options = { ttl: '30m' };
    body.max_output_tokens = outputTokens;
  } else {
    body.reasoning_effort = 'max';
    delete body.max_tokens;
    body.max_completion_tokens = outputTokens;
  }
  body.store = false;
  body.service_tier = 'default';
  let images = 0;
  const serializedText = JSON.stringify(body, (key, value) => {
    if (value && typeof value === 'object' && ['input_image', 'image_url'].includes(value.type)) {
      images++;
      if (value.type === 'input_image') {
        if (typeof value.image_url !== 'string' || value.file_id) throw paused('unsupported-image-input');
        value.detail = 'high';
      } else {
        if (typeof value.image_url?.url !== 'string') throw paused('unsupported-image-input');
        value.image_url.detail = 'high';
      }
      return '[bounded image]';
    }
    if (value && typeof value === 'object' && /audio|video|file/.test(String(value.type || ''))) throw paused('unsupported-modality');
    return value;
  });
  const bytes = Buffer.byteLength(serializedText, 'utf8');
  if (bytes > MAX_TEXT_BYTES || images > 3 || Buffer.byteLength(init.body, 'utf8') > 20 * 1024 * 1024) throw paused('input-limit');
  // Reserve well above the previous generation's documented high-detail image size.
  // The text and image ceilings keep the request below long-context pricing.
  return { init: { ...init, body: JSON.stringify(body) }, model: body.model,
    reservedUsd: reservedRequestUsd(body.model, bytes, images) };
}

function reservedRequestUsd(model, textBytes, images = 0) {
  const input = textBytes + TEXT_TOKEN_OVERHEAD + Math.min(textBytes, PRO_INPUT_HEADROOM) + images * 25000;
  return meteredUsageUsd(model, input, RESERVED_OUTPUT_TOKENS);
}

export function meteredUsageUsd(model, input, output) {
  if (!Object.hasOwn(RATES, model) || !Number.isSafeInteger(input) || input < 0
    || !Number.isSafeInteger(output) || output < 0) return null;
  const [inputRate, outputRate] = RATES[model];
  return money((input * inputRate + output * outputRate) / 1000000);
}

// FreeFinder's existing editors consume Chat Completions output. Responses
// preserves their schemas and enables the same reasoning mode for both models.
function responsesRequest(init) {
  const body = JSON.parse(init.body);
  const input = body.messages.map(({ role, content }) => {
    if (!['system', 'developer', 'user', 'assistant'].includes(role)) throw paused('unsupported-model-input');
    if (typeof content === 'string') return { role, content };
    if (role !== 'user' || !Array.isArray(content)) throw paused('unsupported-model-input');
    return { role, content: content.map(part => {
      if (part.type === 'text') return { type: 'input_text', text: part.text };
      if (part.type === 'image_url') return { type: 'input_image', image_url: part.image_url.url, detail: part.image_url.detail };
      throw paused('unsupported-model-input');
    }) };
  });
  const format = body.response_format;
  let text;
  if (format?.type === 'json_schema') text = { format: { ...format.json_schema, type: 'json_schema' } };
  else if (format?.type === 'json_object') text = { format: { type: 'json_object' } };
  else if (format && format.type !== 'text') throw paused('unsupported-model-output');
  return { ...init, body: JSON.stringify({ model: body.model, input, text, max_output_tokens: body.max_completion_tokens }) };
}

// Admission and offline batch sizing must price the identical Responses body,
// including the serialized prompt/schema and both input-encoding passes.
export function prepareFreeCreditCall(url, init) {
  const original = prepareBudgetedRequest(url, init);
  const adaptChat = String(url) === CHAT;
  const providerUrl = adaptChat ? RESPONSES : url;
  const prepared = adaptChat ? prepareBudgetedRequest(providerUrl, responsesRequest(original.init)) : original;
  return { ...prepared, adaptChat, providerUrl };
}

function asChatResponse(response, result) {
  const content = (result.output || []).flatMap(item => item.type === 'message' ? item.content || [] : []);
  const refusal = content.some(part => part.type === 'refusal');
  const output = content.filter(part => part.type === 'output_text').map(part => part.text).join('');
  const finish = refusal ? 'content_filter' : result.status === 'completed' && output ? 'stop' : 'length';
  const usage = result.usage;
  return Response.json({ model: result.model, choices: [{ index: 0, finish_reason: finish, message: { content: output } }],
    ...(usage ? { usage: { prompt_tokens: usage.input_tokens, completion_tokens: usage.output_tokens,
      total_tokens: usage.total_tokens } } : {}) }, { status: response.status });
}

export function createCreditBudget({ store, policy, clock = Date.now, request = fetch,
  allowAstraEnrichment = false } = {}) {
  let stopped = false;
  const update = async (transform, { dispatched = false } = {}) => {
    for (let attempt = 0; attempt < 8; attempt++) {
      let snapshot;
      try { snapshot = await store.read(); } catch { throw paused('shared-storage-unavailable'); }
      const { state, revision } = snapshot;
      if (state.version !== 1 || !Array.isArray(state.reservations) || !Number.isFinite(state.pausedUntil)
        || (!dispatched && state.pausedUntil > clock())) throw paused('storage-or-provider-pause');
      if (!state.creditPeriod && state.reservations.length) throw paused('unattributed-spend');
      if (state.reservations.some(row => !Number.isFinite(row.usd) || row.usd < 0 || !Number.isFinite(row.at))) throw paused('invalid-spend-ledger');
      if (state.modelPausedUntil !== undefined && (!state.modelPausedUntil || typeof state.modelPausedUntil !== 'object'
        || Array.isArray(state.modelPausedUntil) || Object.values(state.modelPausedUntil).some(deadline => !Number.isFinite(deadline) || deadline < 0))) {
        throw paused('invalid-spend-ledger');
      }
      let { reservations } = state;
      if (state.creditPeriod && state.creditPeriod !== policy.periodId) {
        const start = Date.parse(policy.notBefore);
        if (state.creditPeriod !== policy.rolloverFrom
          || reservations.some(row => !Number.isFinite(row.expiresAt) || row.expiresAt > start || row.at >= start)) {
          throw paused('new-grant-requires-explicit-reset');
        }
        reservations = reservations.map(row => row.creditPeriod ? row : { ...row, creditPeriod: state.creditPeriod });
      }
      const next = transform({ ...state, reservations, creditPeriod: policy.periodId });
      try { if (await store.compareAndSwap(revision, next)) return; }
      catch { throw paused('shared-storage-unavailable'); }
    }
    throw paused('reservation-contention');
  };
  return async (url, init, { preserveDealCorrectionCapacity = false } = {}) => {
    if (stopped) throw paused('runner-paused');
    validateCreditPolicy(policy, clock());
    const prepared = prepareFreeCreditCall(url, init);
    const astra = prepared.model === ASTRA;
    const profileActive = isAstraEnrichmentActive({ enabled: allowAstraEnrichment, now: clock(), policy });
    if (astra !== profileActive) throw paused('model-outside-active-profile');
    const { adaptChat, providerUrl } = prepared;
    if (prepared.reservedUsd > policy.requestLimitUsd) throw paused('request-cost-limit');
    const id = randomUUID(), at = clock();
    await update(state => {
      const total = rows => money(rows.reduce((sum, row) => sum + row.usd, 0));
      const rollingLimit = astra ? policy.astraEnrichment.rollingDayLimitUsd : policy.rollingDayLimitUsd;
      const daily = state.reservations.filter(row => row.at > at - DAY && (astra || row.profile !== ASTRA_PROFILE));
      if (astra && Number(state.astraPausedUntil) > at) throw paused('astra-provider-pause');
      if (state.modelPausedUntil?.[prepared.model] > at) throw paused('model-provider-pause');
      const periodAfter = total(creditPeriodExposure(state.reservations, policy.periodId)) + prepared.reservedUsd;
      const dayAfter = total(daily) + prepared.reservedUsd;
      if (periodAfter > policy.periodLimitUsd || dayAfter > rollingLimit) throw paused('shared-spend-limit');
      if (preserveDealCorrectionCapacity) {
        // One ordinary grounded text correction may need an editor and a
        // reviewer. These are the same text-only ceilings used for admission.
        const textRequest = reservedRequestUsd(SOL, MAX_TEXT_BYTES);
        const correction = 2 * Math.min(policy.requestLimitUsd, textRequest);
        if (periodAfter + correction > policy.periodLimitUsd || dayAfter + correction > rollingLimit) {
          throw paused('pending-deal-correction-priority');
        }
      }
      return { ...state, reservations: [...state.reservations, { id, at, usd: prepared.reservedUsd, creditPeriod: policy.periodId,
        model: prepared.model, reasoningEffort: 'max', reasoningMode: 'pro', ...(astra ? { profile: ASTRA_PROFILE } : {}),
        count: 1, expiresAt: Date.parse(policy.expiresAt), status: 'reserved' }] };
    });
    // Never send an unreserved call, including after slow storage crosses expiry.
    validateCreditPolicy(policy, clock());
    let response, payload;
    try {
      response = await request(providerUrl, { ...prepared.init,
        signal: AbortSignal.any([...(prepared.init.signal ? [prepared.init.signal] : []), AbortSignal.timeout(OPENAI_MODEL_TIMEOUT_MS)]) });
      payload = await response.clone().json().catch(() => ({}));
      const codes = [payload.error?.code, payload.error?.type];
      if (!response.ok) console.warn(JSON.stringify({ model: prepared.model, status: response.status,
        code: codes.find(value => SAFE_ERRORS.includes(value)) || 'unclassified',
        parameter: SAFE_PARAMETERS.includes(payload.error?.param) ? payload.error.param : null }));
      const billingFailure = codes.some(code => /quota|billing|credit_balance|spend_limit|usage_limit/.test(String(code || '')));
      const authenticationFailure = response.status === 401 || codes.includes('invalid_api_key');
      const modelAccessFailure = !response.ok && !billingFailure && !authenticationFailure
        && [400, 403, 404].includes(response.status) && codes.includes('model_not_found');
      if (modelAccessFailure) {
        const until = clock() + 6 * 3600000;
        await update(state => ({ ...state, modelPausedUntil: { ...state.modelPausedUntil,
          [prepared.model]: Math.max(state.modelPausedUntil?.[prepared.model] || 0, until) },
          // Older deployed Astra workers still read this field.
          ...(astra ? { astraPausedUntil: Math.max(state.astraPausedUntil || 0, until) } : {}) }), { dispatched: true });
      } else if (billingFailure || authenticationFailure || response.status === 403) {
        stopped = true;
        await update(state => ({ ...state, pausedUntil: Math.max(state.pausedUntil || 0, clock() + 6 * 3600000) }), { dispatched: true });
      } else if (response.ok) {
        const usage = payload.usage;
        const input = usage?.input_tokens ?? usage?.prompt_tokens, output = usage?.output_tokens ?? usage?.completion_tokens;
        const actual = meteredUsageUsd(prepared.model, input, output);
        if (actual !== null) {
          const overrun = actual > prepared.reservedUsd;
          if (overrun) stopped = true;
          await update(state => {
            // Other workers may have paused new spending after this call was sent.
            // Always reconcile its own reservation and preserve any existing hold.
            if (!state.reservations.some(row => row.id === id && row.status === 'reserved')) throw paused('missing-reservation');
            return {
              ...state,
              ...(overrun ? { pausedUntil: Math.max(state.pausedUntil, Date.parse(policy.expiresAt)),
                costOverrun: state.costOverrun || { reservationId: id, model: prepared.model, reservedUsd: prepared.reservedUsd, actualUsd: actual } } : {}),
              reservations: state.reservations.map(row => row.id === id
                ? { ...row, usd: actual, status: 'settled', ...(overrun ? { reservedUsd: prepared.reservedUsd } : {}) } : row),
            };
          }, { dispatched: true });
        }
      }
      return adaptChat && response.ok ? asChatResponse(response, payload) : safeResponse(response, payload);
    } catch (error) {
      stopped = true;
      // Ambiguous failure remains fully charged; never persist credentials or payloads.
      if (response?.ok && adaptChat) throw paused('model-response-unavailable');
      if (response) return safeResponse(response, payload);
      throw paused('request-or-ledger-unavailable');
    }
  };
}

export function createProductionCreditFetch({ allowAstraEnrichment = false } = {}) {
  let store;
  try { store = githubQuotaStore(process.env, globalThis.fetch, {
    branch: 'automation/openai-free-credit-budget', file: 'openai-free-credit-budget.json', initialPauseMs: 0,
  }); } catch { throw paused('shared-github-storage-unavailable'); }
  return createCreditBudget({ store, policy: loadAiCreditPolicy(), allowAstraEnrichment });
}

let productionRequest;
export async function freeCreditOpenAiFetch(url, init, options) {
  productionRequest ??= createProductionCreditFetch({ allowAstraEnrichment: process.env.FREEFINDER_ASTRA_ENRICHMENT === '1' });
  return productionRequest(url, init, options);
}

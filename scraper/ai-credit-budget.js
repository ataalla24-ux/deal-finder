import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { githubQuotaStore } from './instagram-shared-quota.js';

const DAY = 86400000;
const ASTRA = 'gpt-6-astra';
const ASTRA_PROFILE = 'astra-deal-enrichment';
const CHAT = 'https://api.openai.com/v1/chat/completions';
const RESPONSES = 'https://api.openai.com/v1/responses';
const RATES = {
  'gpt-6-luna': [0.1, 0.5],
  'gpt-6.1-terra': [1, 5],
  'gpt-6.1-sol': [2, 10],
  // Reserve all input at the higher cache-write rate. Standard output includes reasoning.
  [ASTRA]: [12.5, 50],
};
const SAFE_ERRORS = ['insufficient_quota', 'credit_balance_exhausted', 'billing_hard_limit_reached', 'billing_not_active',
  'organization_spend_limit_exceeded', 'project_spend_limit_exceeded', 'organization_usage_limit_exceeded',
  'usage_limit_reached', 'rate_limit_exceeded', 'rate_limit_error', 'slow_down', 'invalid_api_key', 'model_not_found',
  'invalid_request_error', 'invalid_value', 'unsupported_parameter', 'unsupported_value', 'invalid_image', 'invalid_json_schema'];
const SAFE_PARAMETERS = ['model', 'reasoning_effort', 'reasoning.effort', 'reasoning.mode', 'service_tier', 'response_format',
  'text.format', 'max_completion_tokens', 'max_output_tokens', 'messages', 'input'];
const defaults = { extract: 'gpt-6-luna', vision: 'gpt-6.1-terra', editor: 'gpt-6.1-terra', review: 'gpt-6.1-sol' };
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

export function modelForTask(task, override) {
  const model = String(override || defaults[task] || defaults.review).trim();
  if (!Object.hasOwn(RATES, model)) throw paused('unpriced-model');
  if (isAstraEnrichmentActive()) return ASTRA;
  return model;
}

export function dealEnrichmentModelTimeoutMs() {
  return isAstraEnrichmentActive() ? 110000 : 45000;
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
  const rates = RATES[body.model];
  if (!rates || body.tools?.length || body.previous_response_id || body.conversation || body.background || body.stream
    || body.n && body.n !== 1 || body.service_tier && body.service_tier !== 'default') throw paused('unbounded-or-unpriced-request');
  const responses = String(url).endsWith('/responses');
  const requestedOutput = Number(body.max_output_tokens ?? body.max_completion_tokens ?? body.max_tokens ?? 4096);
  if (!Number.isInteger(requestedOutput) || requestedOutput < 1 || requestedOutput > 8192) throw paused('output-limit');
  const astra = body.model === ASTRA;
  const outputTokens = astra ? 8192 : requestedOutput;
  if (body.model.startsWith('gpt-6')) {
    delete body.temperature;
    delete body.top_p;
    const effort = astra ? 'max' : body.model === 'gpt-6.1-sol' ? 'low' : 'none';
    if (responses) body.reasoning = { effort };
    else {
      body.reasoning_effort = effort;
      delete body.max_tokens;
      body.max_completion_tokens = outputTokens;
    }
  }
  if (responses) body.max_output_tokens = outputTokens;
  else if (!body.max_completion_tokens) body.max_tokens = outputTokens;
  body.store = false;
  body.service_tier = 'default';
  let images = 0;
  const serializedText = JSON.stringify(body, (key, value) => {
    if (value && typeof value === 'object' && ['input_image', 'image_url'].includes(value.type)) {
      images++;
      if (astra) {
        if (value.type === 'input_image') {
          if (typeof value.image_url !== 'string' || value.file_id) throw paused('unsupported-image-input');
          value.detail = 'high';
        } else {
          if (typeof value.image_url?.url !== 'string') throw paused('unsupported-image-input');
          value.image_url.detail = 'high';
        }
      }
      return '[bounded image]';
    }
    if (value && typeof value === 'object' && /audio|video|file/.test(String(value.type || ''))) throw paused('unsupported-modality');
    return value;
  });
  const bytes = Buffer.byteLength(serializedText, 'utf8');
  if (bytes > 80000 || images > 3 || Buffer.byteLength(init.body, 'utf8') > 20 * 1024 * 1024) throw paused('input-limit');
  // Astra high detail is bounded to 2500 patches at 1.2 tokens each. The extra
  // margin covers rounding and framing and keeps the request below long-context pricing.
  const inputTokens = bytes + 1024 + images * (astra ? 3200 : 200000);
  return { init: { ...init, body: JSON.stringify(body) }, model: body.model,
    reservedUsd: money((inputTokens * rates[0] + outputTokens * rates[1]) / 1000000) };
}

// FreeFinder's existing editors consume Chat Completions output. Use the
// Responses transport for Astra, preserving the same strict schema and caller contract.
function astraResponsesRequest(init) {
  const body = JSON.parse(init.body);
  const input = body.messages.map(({ role, content }) => {
    if (!['system', 'developer', 'user', 'assistant'].includes(role)) throw paused('unsupported-astra-input');
    if (typeof content === 'string') return { role, content };
    if (role !== 'user' || !Array.isArray(content)) throw paused('unsupported-astra-input');
    return { role, content: content.map(part => {
      if (part.type === 'text') return { type: 'input_text', text: part.text };
      if (part.type === 'image_url') return { type: 'input_image', image_url: part.image_url.url, detail: part.image_url.detail };
      throw paused('unsupported-astra-input');
    }) };
  });
  const format = body.response_format;
  let text;
  if (format?.type === 'json_schema') text = { format: { ...format.json_schema, type: 'json_schema' } };
  else if (format?.type === 'json_object') text = { format: { type: 'json_object' } };
  else if (format && format.type !== 'text') throw paused('unsupported-astra-output');
  return { ...init, body: JSON.stringify({ model: ASTRA, input, text, max_output_tokens: body.max_completion_tokens }) };
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
  const update = async transform => {
    for (let attempt = 0; attempt < 8; attempt++) {
      let snapshot;
      try { snapshot = await store.read(); } catch { throw paused('shared-storage-unavailable'); }
      const { state, revision } = snapshot;
      if (state.version !== 1 || !Array.isArray(state.reservations) || !Number.isFinite(state.pausedUntil)
        || state.pausedUntil > clock()) throw paused('storage-or-provider-pause');
      if (!state.creditPeriod && state.reservations.length) throw paused('unattributed-spend');
      if (state.reservations.some(row => !Number.isFinite(row.usd) || row.usd < 0 || !Number.isFinite(row.at))) throw paused('invalid-spend-ledger');
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
  return async (url, init) => {
    if (stopped) throw paused('runner-paused');
    validateCreditPolicy(policy, clock());
    const original = prepareBudgetedRequest(url, init);
    const astra = original.model === ASTRA;
    const profileActive = isAstraEnrichmentActive({ enabled: allowAstraEnrichment, now: clock(), policy });
    if (astra !== profileActive) throw paused('model-outside-active-profile');
    const adaptChat = astra && String(url) === CHAT;
    const providerUrl = adaptChat ? RESPONSES : url;
    const prepared = adaptChat ? prepareBudgetedRequest(providerUrl, astraResponsesRequest(original.init)) : original;
    if (prepared.reservedUsd > policy.requestLimitUsd) throw paused('request-cost-limit');
    const id = randomUUID(), at = clock();
    await update(state => {
      const total = rows => money(rows.reduce((sum, row) => sum + row.usd, 0));
      const rollingLimit = astra ? policy.astraEnrichment.rollingDayLimitUsd : policy.rollingDayLimitUsd;
      const daily = state.reservations.filter(row => row.at > at - DAY && (astra || row.profile !== ASTRA_PROFILE));
      if (astra && Number(state.astraPausedUntil) > at) throw paused('astra-provider-pause');
      if (total(creditPeriodExposure(state.reservations, policy.periodId)) + prepared.reservedUsd > policy.periodLimitUsd
        || total(daily) + prepared.reservedUsd > rollingLimit) throw paused('shared-spend-limit');
      return { ...state, reservations: [...state.reservations, { id, at, usd: prepared.reservedUsd, creditPeriod: policy.periodId,
        model: prepared.model, ...(astra ? { profile: ASTRA_PROFILE } : {}),
        count: 1, expiresAt: Date.parse(policy.expiresAt), status: 'reserved' }] };
    });
    // Never send an unreserved call, including after slow storage crosses expiry.
    validateCreditPolicy(policy, clock());
    let response, payload;
    try {
      response = await request(providerUrl, { ...prepared.init,
        signal: AbortSignal.any([...(prepared.init.signal ? [prepared.init.signal] : []), AbortSignal.timeout(astra ? 110000 : 45000)]) });
      payload = await response.clone().json().catch(() => ({}));
      const codes = [payload.error?.code, payload.error?.type];
      if (astra && !response.ok) console.warn(JSON.stringify({ model: ASTRA, status: response.status,
        code: codes.find(value => SAFE_ERRORS.includes(value)) || 'unclassified',
        parameter: SAFE_PARAMETERS.includes(payload.error?.param) ? payload.error.param : null }));
      const billingFailure = codes.some(code => /quota|billing|credit_balance|spend_limit|usage_limit/.test(String(code || '')));
      const astraAccessFailure = astra && !billingFailure
        && ([403, 404].includes(response.status) || codes.includes('model_not_found'));
      if (astraAccessFailure) {
        stopped = true;
        await update(state => ({ ...state, astraPausedUntil: Math.max(state.astraPausedUntil || 0, clock() + 6 * 3600000) }));
      } else if (billingFailure || [401, 403].includes(response.status)) {
        stopped = true;
        await update(state => ({ ...state, pausedUntil: Math.max(state.pausedUntil || 0, clock() + 6 * 3600000) }));
      } else if (response.ok) {
        const usage = payload.usage;
        const input = usage?.input_tokens ?? usage?.prompt_tokens, output = usage?.output_tokens ?? usage?.completion_tokens;
        if (Number.isInteger(input) && input >= 0 && Number.isInteger(output) && output >= 0) {
          const rates = RATES[prepared.model];
          const actual = money((input * rates[0] + output * rates[1]) / 1000000);
          if (actual > prepared.reservedUsd) {
            stopped = true;
            await update(state => ({ ...state, pausedUntil: Date.parse(policy.expiresAt) }));
          } else await update(state => ({ ...state, reservations: state.reservations.map(row => row.id === id
            ? { ...row, usd: actual, status: 'settled' } : row) }));
        }
      }
      return adaptChat && response.ok ? asChatResponse(response, payload) : safeResponse(response, payload);
    } catch (error) {
      stopped = true;
      // Ambiguous failure remains fully charged; never persist credentials or payloads.
      if (response?.ok && adaptChat) throw paused('astra-response-unavailable');
      if (response) return safeResponse(response, payload);
      throw paused('request-or-ledger-unavailable');
    }
  };
}

let productionRequest;
export async function freeCreditOpenAiFetch(url, init) {
  if (!productionRequest) {
    let store;
    try { store = githubQuotaStore(process.env, globalThis.fetch, {
      branch: 'automation/openai-free-credit-budget', file: 'openai-free-credit-budget.json', initialPauseMs: 0,
    }); } catch { throw paused('shared-github-storage-unavailable'); }
    productionRequest = createCreditBudget({ store, policy: loadAiCreditPolicy(),
      allowAstraEnrichment: process.env.FREEFINDER_ASTRA_ENRICHMENT === '1' });
  }
  return productionRequest(url, init);
}

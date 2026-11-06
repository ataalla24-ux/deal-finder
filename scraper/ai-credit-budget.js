import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { githubQuotaStore } from './instagram-shared-quota.js';

const DAY = 86400000;
const RATES = {
  'gpt-6-luna': [0.1, 0.5],
  'gpt-6.1-terra': [1, 5],
  'gpt-6.1-sol': [2, 10],
  'gpt-4.1-mini': [0.4, 1.6],
};
const SAFE_ERRORS = ['insufficient_quota', 'credit_balance_exhausted', 'billing_hard_limit_reached', 'billing_not_active',
  'organization_spend_limit_exceeded', 'project_spend_limit_exceeded', 'organization_usage_limit_exceeded',
  'usage_limit_reached', 'rate_limit_exceeded', 'rate_limit_error', 'slow_down', 'invalid_api_key', 'model_not_found'];
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

export function modelForTask(task, override) {
  const model = String(override || defaults[task] || defaults.review).trim();
  if (!Object.hasOwn(RATES, model)) throw paused('unpriced-model');
  return model;
}

export function validateCreditPolicy(policy, now = Date.now()) {
  const start = Date.parse(policy?.notBefore), end = Date.parse(policy?.expiresAt);
  const guard = policy?.providerGuard;
  if (policy?.version !== 1 || policy.mode !== 'free-credit-only' || !policy.periodId
    || policy.paidFallback !== false || policy.automaticRenewalAssumed !== false
    || !Number.isFinite(start) || !Number.isFinite(end) || now < start || now + 120000 >= end
    || new Date(start).getUTCMonth() !== new Date(end).getUTCMonth()
    || new Date(start).getUTCFullYear() !== new Date(end).getUTCFullYear()
    || guard?.enforced !== true || guard.scope !== 'organization'
    || guard.autoReload !== false || guard.paidBalanceAvailable !== false
    || !Number.isFinite(Date.parse(guard.verifiedAt)) || Date.parse(guard.verifiedAt) > now
    || ![policy.periodLimitUsd, policy.rollingDayLimitUsd, policy.requestLimitUsd, guard.monthlyLimitUsd]
      .every(value => Number.isFinite(value) && value > 0)
    || policy.periodLimitUsd >= guard.monthlyLimitUsd || policy.rollingDayLimitUsd > policy.periodLimitUsd) {
    throw paused('unverified-expired-or-unsafe-credit-policy');
  }
  return policy;
}

export function prepareBudgetedRequest(url, init) {
  if (!['https://api.openai.com/v1/chat/completions', 'https://api.openai.com/v1/responses'].includes(String(url))) throw paused('unsupported-endpoint');
  let body;
  try { body = JSON.parse(init.body); } catch { throw paused('invalid-request'); }
  const rates = RATES[body.model];
  if (!rates || body.tools?.length || body.previous_response_id || body.conversation || body.background || body.stream
    || body.n && body.n !== 1 || body.service_tier && body.service_tier !== 'default') throw paused('unbounded-or-unpriced-request');
  const responses = String(url).endsWith('/responses');
  const outputTokens = Number(body.max_output_tokens ?? body.max_completion_tokens ?? body.max_tokens ?? 4096);
  if (!Number.isInteger(outputTokens) || outputTokens < 1 || outputTokens > 8192) throw paused('output-limit');
  if (body.model.startsWith('gpt-6')) {
    delete body.temperature;
    delete body.top_p;
    if (responses) body.reasoning = { effort: body.model === 'gpt-6.1-sol' ? 'low' : 'none' };
    else {
      body.reasoning_effort = body.model === 'gpt-6.1-sol' ? 'low' : 'none';
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
      return '[bounded image]';
    }
    if (value && typeof value === 'object' && /audio|video|file/.test(String(value.type || ''))) throw paused('unsupported-modality');
    return value;
  });
  const bytes = Buffer.byteLength(serializedText, 'utf8');
  if (bytes > 80000 || images > 3 || Buffer.byteLength(init.body, 'utf8') > 20 * 1024 * 1024) throw paused('input-limit');
  // UTF-8 bytes conservatively bound text tokens. Image reservations deliberately
  // exceed supported patch budgets; only verified response usage releases slack.
  const inputTokens = bytes + 1024 + images * 200000;
  return { init: { ...init, body: JSON.stringify(body) }, model: body.model,
    reservedUsd: money((inputTokens * rates[0] + outputTokens * rates[1]) / 1000000) };
}

export function createCreditBudget({ store, policy, clock = Date.now, request = fetch } = {}) {
  let stopped = false;
  const update = async transform => {
    for (let attempt = 0; attempt < 8; attempt++) {
      let snapshot;
      try { snapshot = await store.read(); } catch { throw paused('shared-storage-unavailable'); }
      const { state, revision } = snapshot;
      if (state.version !== 1 || !Array.isArray(state.reservations) || !Number.isFinite(state.pausedUntil)
        || state.pausedUntil > clock()) throw paused('storage-or-provider-pause');
      if (state.creditPeriod && state.creditPeriod !== policy.periodId) throw paused('new-grant-requires-explicit-reset');
      if (!state.creditPeriod && state.reservations.length) throw paused('unattributed-spend');
      if (state.reservations.some(row => !Number.isFinite(row.usd) || row.usd < 0 || !Number.isFinite(row.at))) throw paused('invalid-spend-ledger');
      const next = transform({ ...state, creditPeriod: policy.periodId });
      try { if (await store.compareAndSwap(revision, next)) return; }
      catch { throw paused('shared-storage-unavailable'); }
    }
    throw paused('reservation-contention');
  };
  return async (url, init) => {
    if (stopped) throw paused('runner-paused');
    validateCreditPolicy(policy, clock());
    const prepared = prepareBudgetedRequest(url, init);
    if (prepared.reservedUsd > policy.requestLimitUsd) throw paused('request-cost-limit');
    const id = randomUUID(), at = clock();
    await update(state => {
      const total = rows => money(rows.reduce((sum, row) => sum + row.usd, 0));
      if (total(state.reservations) + prepared.reservedUsd > policy.periodLimitUsd
        || total(state.reservations.filter(row => row.at > at - DAY)) + prepared.reservedUsd > policy.rollingDayLimitUsd) throw paused('shared-spend-limit');
      return { ...state, reservations: [...state.reservations, { id, at, usd: prepared.reservedUsd,
        model: prepared.model, count: 1, expiresAt: Date.parse(policy.expiresAt), status: 'reserved' }] };
    });
    // Never send an unreserved call, including after slow storage crosses expiry.
    validateCreditPolicy(policy, clock());
    let response, payload;
    try {
      response = await request(url, { ...prepared.init,
        signal: AbortSignal.any([...(prepared.init.signal ? [prepared.init.signal] : []), AbortSignal.timeout(45000)]) });
      payload = await response.clone().json().catch(() => ({}));
      const codes = [payload.error?.code, payload.error?.type];
      const billingFailure = codes.some(code => /quota|billing|credit_balance|spend_limit|usage_limit/.test(String(code || '')));
      if (billingFailure || [401, 403].includes(response.status)) {
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
      return safeResponse(response, payload);
    } catch (error) {
      stopped = true;
      // Ambiguous failure remains fully charged; never persist credentials or payloads.
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
    productionRequest = createCreditBudget({ store, policy: loadAiCreditPolicy() });
  }
  return productionRequest(url, init);
}

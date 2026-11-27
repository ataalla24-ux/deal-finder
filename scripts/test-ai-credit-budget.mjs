import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createCreditBudget, creditPeriodExposure, dailyCreditExposureUsd, isAstraEnrichmentActive, loadAiCreditPolicy, meteredUsageUsd, modelForTask, prepareBudgetedRequest, prepareFreeCreditCall, validateCreditPolicy, DEAL_IMAGE_GENERATION_MODEL, DEAL_IMAGE_GENERATION_URL, meteredImageUsageUsd } from '../scraper/ai-credit-budget.js';
import { OPENAI_BACKGROUND_TIMEOUT_MS } from '../scraper/ai-credit-budget.js';
import { reconcileKnownOverrun } from './reconcile-openai-budget-20261120.mjs';
import { requestOpenAi } from '../scraper/instagram-media-evidence.js';
import { githubQuotaStore } from '../scraper/instagram-shared-quota.js';
import { classifyWithOpenAi } from '../scraper/instagram-ai-agent.js';

const now = Date.parse('2026-11-06T12:00:00Z');
const configured = loadAiCreditPolicy();
const historicPolicy = { ...configured, rollingDayLimitUsd: 2,
  astraEnrichment: { ...configured.astraEnrichment, rollingDayLimitUsd: 38 } };
const policy = { ...historicPolicy, periodId: 'fixture-grant', rolloverFrom: undefined, periodLimitUsd: 38,
  notBefore: '2026-11-05T23:20:00Z', expiresAt: '2026-11-20T08:10:11Z',
  astraEnrichment: { ...historicPolicy.astraEnrichment, notBefore: '2026-11-17T07:30:00Z' },
  providerGuard: { ...configured.providerGuard, monthlyLimitUsd: 40, verifiedAt: '2026-11-05T23:20:00Z' } };
const url = 'https://api.openai.com/v1/chat/completions';
const init = (model = 'gpt-6.2-sol', changes = {}) => ({ method: 'POST', headers: {}, body: JSON.stringify({ model,
  max_tokens: 600, temperature: 0, messages: [{ role: 'user', content: 'synthetic test' }], ...changes }) });
function memory(initial) {
  let state = initial || { version: 1, reservations: [], pausedUntil: 0 }, revision = 0;
  return { async read() { return { state: structuredClone(state), revision }; },
    async compareAndSwap(expected, next) { if (expected !== revision) return false; state = structuredClone(next); revision++; return true; },
    get state() { return structuredClone(state); } };
}
const successful = () => Response.json({ status: 'completed',
  output: [{ type: 'message', content: [{ type: 'output_text', text: '{"ok":true}' }] }],
  usage: { input_tokens: 20, output_tokens: 5, total_tokens: 25 } });

const responsesUrl = 'https://api.openai.com/v1/responses';
const backgroundId = 'resp_fixture123';
const receipt = { input_tokens: 20, output_tokens: 5, total_tokens: 25 };
const backgroundState = (status, extra = {}) => Response.json({
  id: backgroundId, model: 'gpt-6.2-sol', status, ...extra,
});
const backgroundResult = { usage: receipt,
  output: [{ type: 'message', content: [{ type: 'output_text', text: '{"deals":[]}' }] }] };

function backgroundFixture(transport, grant = policy) {
  let time = now;
  const calls = [];
  const store = memory();
  const request = async (target, options) => {
    calls.push({ target, options, time });
    assert.equal(options.redirect, 'error');
    assert.equal(options.signal.aborted, false);
    assert.equal(store.state.reservations.length, 1);
    assert.equal(store.state.reservations[0].status, 'reserved');
    return transport(target, options, time, calls.length);
  };
  const fetch = createCreditBudget({ store, policy: grant, clock: () => time,
    sleep: async delay => { time += delay; }, request });
  return { fetch, store, calls };
}

test('one internally enabled Background reservation can complete beyond 110 seconds with bounded polls', async () => {
  const fixture = backgroundFixture((target, options, time) => {
    if (target === responsesUrl) {
      assert.equal(options.method, 'POST');
      const body = JSON.parse(options.body);
      assert.deepEqual(body.reasoning, { effort: 'max', mode: 'pro' });
      assert.equal(body.service_tier, 'default');
      assert.equal(body.max_output_tokens, 8192);
      assert.equal(body.store, false);
      assert.equal(body.background, true);
      assert.deepEqual(body.background_options, { completion_window: 'soonest' });
      return backgroundState('queued');
    }
    assert.equal(target, responsesUrl + '/' + backgroundId);
    assert.equal(options.method, 'GET');
    assert.equal(options.body, undefined);
    assert.equal(options.headers.get('authorization'), 'Bearer fixture');
    assert.equal(options.headers.get('openai-project'), 'fixture-project');
    assert.equal(options.headers.get('x-untrusted'), null);
    return time - now >= 120_000 ? backgroundState('completed', backgroundResult) : backgroundState('in_progress');
  });
  const response = await fixture.fetch(url, { ...init(),
    headers: { Authorization: 'Bearer fixture', 'OpenAI-Project': 'fixture-project', 'X-Untrusted': 'ignored' },
  }, { background: true });
  const result = await response.json();
  assert.equal(result.choices[0].finish_reason, 'stop');
  assert.equal(result.choices[0].message.content, '{"deals":[]}');
  assert.equal(result.usage.total_tokens, 25);
  assert(!JSON.stringify(result).includes(backgroundId));
  assert.equal(fixture.calls.filter(({ options }) => options.method === 'POST').length, 1);
  assert(fixture.calls.length > 2 && fixture.calls.length <= 61);
  assert(fixture.calls.slice(1).every(({ time }, index) => time - fixture.calls[index].time >= 5_000));
  const [row] = fixture.store.state.reservations;
  assert.equal(row.status, 'settled');
  assert.equal(row.usd, meteredUsageUsd('gpt-6.2-sol', 20, 5));
  assert(!JSON.stringify(fixture.store.state).includes(backgroundId));
});

test('Background submission preserves admission rules and cannot be enabled in request JSON', async () => {
  const fixture = backgroundFixture(() => assert.fail('invalid or out-of-period input must not be sent'));
  for (const changes of [{ background: true }, { background: false }, { stream: true }, { tools: [] },
    { tools: [{ type: 'web_search' }] }, { background_options: { completion_window: '8h' } }]) {
    await assert.rejects(fixture.fetch(url, init('gpt-6.2-sol', changes), { background: true }), /unbounded-or-unpriced-request/);
  }
  await assert.rejects(fixture.fetch(url, init('gpt-6.2-astra'), { background: true }), /model-outside-active-profile/);
  assert.equal(fixture.store.state.reservations.length, 0);
  const early = backgroundFixture(() => assert.fail('no dispatch near grant expiry'),
    { ...policy, astraEnrichment: undefined, expiresAt: new Date(now + OPENAI_BACKGROUND_TIMEOUT_MS - 1).toISOString() });
  await assert.rejects(early.fetch(url, init(), { background: true }), /background-period-ending/);
  assert.equal(early.store.state.reservations.length, 0);
  const expired = backgroundFixture(() => assert.fail('no dispatch after grant expiry'),
    { ...policy, expiresAt: new Date(now - 1).toISOString() });
  await assert.rejects(expired.fetch(url, init(), { background: true }), /unverified-expired-or-unsafe-credit-policy/);
  assert.equal(expired.store.state.reservations.length, 0);
  const store = memory({ version: 1, creditPeriod: policy.periodId, pausedUntil: 0,
    reservations: [{ id: 'historical', at: now - 30_000, usd: policy.periodLimitUsd - 0.99,
      status: 'settled', creditPeriod: policy.periodId }] });
  const funded = createCreditBudget({ store, policy, clock: () => now, request: () => assert.fail('no uncovered POST') });
  await assert.rejects(funded(url, init(), { background: true }), /shared-spend-limit/);
  assert.equal(store.state.reservations.length, 1);
});

test('Background rejects unknown status, unsafe or mismatched response IDs, and model changes without settling', async () => {
  for (const [initial, polled, expectedCalls] of [
    [{ id: 'resp_fixture/../../wrong' }, {}, 1],
    [{ status: 'future-status' }, {}, 1],
    [{ model: 'gpt-6.2-astra' }, {}, 1],
    [{}, { id: 'resp_other' }, 2],
    [{}, { model: 'gpt-6.2-sol-2026-11-05' }, 2],
    [{}, { status: 'future-status' }, 2],
  ]) {
    const fixture = backgroundFixture((target, _options) => target === responsesUrl
      ? backgroundState('queued', initial) : backgroundState('completed', { ...backgroundResult, ...polled }));
    await assert.rejects(fixture.fetch(url, init(), { background: true }), error => {
      assert.equal(error.budgetReason, 'background-response-invalid');
      assert.doesNotMatch(error.message, /resp_|future-status/);
      return true;
    });
    assert.equal(fixture.calls.length, expectedCalls);
    assert.equal(fixture.store.state.reservations[0].status, 'reserved');
    assert.equal(fixture.store.state.reservations[0].usd, policy.requestLimitUsd);
  }
});

test('Background terminal failure settles only complete receipts and never returns partial content', async () => {
  for (const [status, usage, settled] of [
    ['incomplete', receipt, true], ['failed', receipt, true], ['cancelled', receipt, true],
    ['cancelled', { input_tokens: 20, output_tokens: 0, total_tokens: 20 }, true],
    ['failed', null, false], ['failed', { ...receipt, total_tokens: 12 }, false],
  ]) {
    const fixture = backgroundFixture(target => target === responsesUrl ? backgroundState('queued')
      : backgroundState(status, { ...backgroundResult, usage, error: { message: 'PRIVATE PROVIDER DATA' } }));
    await assert.rejects(fixture.fetch(url, init(), { background: true }), error => {
      assert.equal(error.budgetReason, 'background-response-unavailable');
      assert.doesNotMatch(error.message, /PRIVATE|deals|resp_/);
      return true;
    });
    assert.equal(fixture.store.state.reservations[0].status, settled ? 'settled' : 'reserved');
    await assert.rejects(fixture.fetch(url, init(), { background: true }), /runner-paused/);
    assert.equal(fixture.calls.length, 2);
  }
});

test('Background completed output needs a positive, safe and consistent metering receipt', async () => {
  for (const usage of [undefined, { input_tokens: 10, output_tokens: 10, total_tokens: 200 },
    { input_tokens: 0, output_tokens: 0, total_tokens: 0 },
    { input_tokens: 20, output_tokens: 0, total_tokens: 20 },
    { input_tokens: Number.MAX_SAFE_INTEGER + 2, output_tokens: 2, total_tokens: Number.MAX_SAFE_INTEGER + 4 }]) {
    const fixture = backgroundFixture(target => target === responsesUrl
      ? backgroundState('queued') : backgroundState('completed', { ...backgroundResult, usage }));
    await assert.rejects(fixture.fetch(url, init(), { background: true }), error => {
      assert.equal(error.budgetReason, 'background-response-invalid');
      assert.doesNotMatch(error.message, /resp_|deals/);
      return true;
    });
    const [row] = fixture.store.state.reservations;
    // A positive input-only receipt can be charged on terminal failure, but a
    // completed text result with zero output tokens cannot substantiate usage.
    assert.equal(row.status, 'reserved');
    assert.equal(row.usd, policy.requestLimitUsd);
    await assert.rejects(fixture.fetch(url, init(), { background: true }), /runner-paused/);
    assert.equal(fixture.calls.length, 2);
  }
});

test('Background partial assistant items keep the completed job from publishing but settle real usage', async () => {
  for (const status of ['incomplete', 'in_progress', 'failed']) {
    const fixture = backgroundFixture(target => target === responsesUrl ? backgroundState('queued')
      : backgroundState('completed', { usage: receipt, output: [
        { type: 'message', role: 'assistant', status, content: [{ type: 'output_text', text: 'PRIVATE PARTIAL TEXT' }] },
        { type: 'message', role: 'assistant', status: 'completed', content: backgroundResult.output[0].content },
      ] }));
    await assert.rejects(fixture.fetch(url, init(), { background: true }), error => {
      assert.equal(error.budgetReason, 'background-response-invalid');
      assert.doesNotMatch(error.message, /resp_|PRIVATE PARTIAL TEXT/);
      return true;
    });
    const [row] = fixture.store.state.reservations;
    assert.equal(row.status, 'settled');
    assert.equal(row.usd, meteredUsageUsd('gpt-6.2-sol', 20, 5));
    await assert.rejects(fixture.fetch(url, init(), { background: true }), /runner-paused/);
    assert.equal(fixture.calls.length, 2);
  }
});

test('Background poll respects Retry-After and later completion uses the original response', async () => {
  const fixture = backgroundFixture((_target, _options, _time, count) => {
    if (count === 1) return backgroundState('queued');
    if (count === 2) return new Response('{}', { status: 429, headers: { 'Retry-After': '35' } });
    return backgroundState('completed', backgroundResult);
  });
  await fixture.fetch(url, init(), { background: true });
  assert.equal(fixture.calls[2].time - fixture.calls[1].time, 35_000);
  assert.equal(fixture.calls[1].target, fixture.calls[2].target);
  assert.equal(fixture.store.state.reservations.length, 1);
});

test('Background deadline cancels a known response once, retaining usage and never publishing a raced completion', async () => {
  const fixture = backgroundFixture((target, options) => {
    if (target.endsWith('/cancel')) {
      assert.equal(target, responsesUrl + '/' + backgroundId + '/cancel');
      assert.equal(options.method, 'POST');
      assert.equal(options.body, undefined);
      return backgroundState('completed', backgroundResult);
    }
    return backgroundState('queued');
  });
  await assert.rejects(fixture.fetch(url, init(), { background: true }), /background-timeout/);
  const cancellation = fixture.calls.at(-1);
  assert.equal(cancellation.time - now, OPENAI_BACKGROUND_TIMEOUT_MS);
  assert(cancellation.target.endsWith('/cancel'));
  const polls = fixture.calls.filter(({ options }) => options.method === 'GET');
  assert(polls.length <= 60);
  assert(fixture.calls.slice(1, -1).every(({ options }) => options.method === 'GET'));
  assert.equal(fixture.store.state.reservations[0].status, 'settled');
});

test('Background neither cancels via an explicit provider wait nor resubmits failed POSTs', async () => {
  const held = backgroundFixture((target, _options, _time, count) => {
    if (count === 1) return backgroundState('in_progress');
    assert.equal(target, responsesUrl + '/' + backgroundId);
    return new Response('{}', { status: 429, headers: { 'retry-after': '3600' } });
  });
  await assert.rejects(held.fetch(url, init(), { background: true }), /background-timeout/);
  assert.equal(held.calls.length, 2);
  assert.equal(held.store.state.reservations[0].status, 'reserved');
  assert.equal(held.store.state.pausedUntil, held.calls[1].time + 3_600_000);
  const restarted = createCreditBudget({ store: held.store, policy,
    clock: () => now + OPENAI_BACKGROUND_TIMEOUT_MS + 1,
    request: () => assert.fail('a new worker must not submit inside the persisted provider hold') });
  await assert.rejects(restarted(url, init(), { background: true }), /storage-or-provider-pause/);
  assert.equal(held.store.state.reservations.length, 1);

  const rejected = backgroundFixture(() => Response.json({ error: { message: 'PRIVATE PROVIDER DATA' } }, { status: 503 }));
  const response = await rejected.fetch(url, init(), { background: true });
  assert.equal(response.status, 503);
  assert(!JSON.stringify(await response.json()).includes('PRIVATE'));
  assert.equal(rejected.calls.length, 1);
  assert.equal(rejected.store.state.reservations.length, 1);
});

test('Background poll persists its provider deadline without shortening a concurrent hold', async () => {
  const existingHold = now + 7_200_000;
  const fixture = backgroundFixture(async (_target, _options, _time, count) => {
    if (count === 1) return backgroundState('queued');
    const { state, revision } = await fixture.store.read();
    await fixture.store.compareAndSwap(revision, { ...state, pausedUntil: existingHold });
    return new Response('{}', { status: 429, headers: { 'retry-after': '3600' } });
  });
  await assert.rejects(fixture.fetch(url, init(), { background: true }), /background-timeout/);
  assert.equal(fixture.store.state.pausedUntil, existingHold);
  assert.equal(fixture.calls.length, 2);
});

test('Instagram full-description classification uses small bounded batches and stops after a partial failure', async () => {
  const candidates = Array.from({ length: 14 }, (_, index) => ({ url: `https://www.instagram.com/p/Synthetic${index}/`,
    title: 'B2B software example', description: 'Stempelsoftware fuer Gastronomen, keine einloesbare Aktion.',
    pubDate: new Date().toISOString(), pubDateSource: 'instagram-graph-timestamp' }));
  const seen = [];
  const fetchImpl = async (_url, init) => {
    const body = JSON.parse(init.body), rows = JSON.parse(body.messages[1].content).candidates;
    assert.equal(body.max_tokens, 4096);
    assert.ok(rows.length <= 4);
    assert.deepEqual(rows.map(row => row.index), rows.map((_, i) => i));
    seen.push(rows.map(row => row.url));
    return Response.json({ choices: [{ finish_reason: 'stop', message: { content: '{"deals":[]}' } }],
      usage: { prompt_tokens: 20, completion_tokens: 5, total_tokens: 25 } });
  };
  const options = { enabled: true, apiKey: 'fixture-not-a-secret', fetchImpl };
  const result = await classifyWithOpenAi(candidates, options);
  assert.equal(result.health.status, 'ok');
  assert.equal(result.usage.totalTokens, 100);
  assert.deepEqual(seen.flat(), candidates.map(row => row.url));
  let calls = 0;
  const partial = await classifyWithOpenAi(candidates, { ...options, fetchImpl: async (...args) => {
    if (++calls === 2) throw Object.assign(Error('fixture pause'), { code: 'free_credit_budget_deferred', budgetReason: 'shared-spend-limit' });
    return fetchImpl(...args);
  } });
  assert.equal(calls, 2);
  assert.equal(partial.usage.totalTokens, 25);
  assert.equal(partial.health.completedCandidates, 4);
  assert.equal(partial.health.deferredCandidates, 10);
  assert.equal(partial.health.budgetReason, 'shared-spend-limit');
});

test('role routing is explicit, supported and priced, never an unpriced automatic fallback', () => {
  for (const role of ['extract', 'vision', 'editor', 'review']) {
    assert.equal(modelForTask(role), 'gpt-6.2-sol');
    assert.throws(() => modelForTask(role, 'unpriced-or-future-model'));
  }
});

test('retired model cannot make a provider request or reserve credits through a stale override', async () => {
  let calls = 0;
  const store = memory();
  const request = createCreditBudget({ store, policy, clock: () => now,
    request: async () => { calls++; return successful(); } });
  for (const model of ['gpt-4.1-mini', 'gpt-6-luna', 'gpt-6.1-terra', 'gpt-6.1-sol', 'gpt-6-astra', 'constructor']) {
    assert.throws(() => modelForTask('review', model));
    assert.throws(() => prepareBudgetedRequest(url, init(model)));
    await assert.rejects(request(url, init(model)));
  }
  assert.equal(calls, 0);
  assert.equal(store.state.reservations.length, 0);
});

test('free-only policy rejects expiry, paid fallback, unsafe provider state and calendar reset', () => {
  assert.equal(validateCreditPolicy(policy, now), policy);
  for (const change of [
    { paidFallback: true }, { automaticRenewalAssumed: true }, { expiresAt: '2026-11-05T00:00:00Z' },
    { notBefore: '2026-11-07T00:00:00Z' }, { expiresAt: '2026-12-20T00:00:00Z' },
    { providerGuard: { ...policy.providerGuard, enforced: false } },
    { providerGuard: { ...policy.providerGuard, autoReload: true } },
    { providerGuard: { ...policy.providerGuard, paidBalanceAvailable: true } },
    { rollingDayLimitUsd: 0 }, { periodLimitUsd: 40.01 },
  ]) assert.throws(() => validateCreditPolicy({ ...policy, ...change }, now), JSON.stringify(change));
  assert.throws(() => validateCreditPolicy(policy, Date.parse(policy.expiresAt)));
});

test('a verified grant can cross a calendar month without assuming another renewal', () => {
  const inside = Date.parse(configured.notBefore) + 60000;
  assert.equal(validateCreditPolicy(configured, inside), configured);
  const atProviderLimit = { ...configured, periodLimitUsd: configured.providerGuard.monthlyLimitUsd };
  assert.equal(validateCreditPolicy(atProviderLimit, inside), atProviderLimit);
  assert.throws(() => validateCreditPolicy({ ...atProviderLimit, periodLimitUsd: atProviderLimit.periodLimitUsd + 0.01 }, inside));
  const cycleEnd = Date.parse(configured.expiresAt);
  assert.equal(validateCreditPolicy(configured, cycleEnd - 120001), configured);
  assert.throws(() => validateCreditPolicy(configured, cycleEnd - 120000));
});

test('grant rollover preserves every prior reservation and still charges unknown usage', async () => {
  const start = Date.parse(configured.notBefore);
  const earlier = { at: start - 4 * 86400000, expiresAt: start - 3600000, model: 'gpt-6-luna', count: 1 };
  const previous = [{ ...earlier, id: 'known', status: 'settled', usd: 37 },
    { ...earlier, id: 'unclear', status: 'reserved', usd: 2 }];
  const oldLedger = { version: 1, creditPeriod: configured.rolloverFrom, pausedUntil: 0, reservations: previous };
  const store = memory(oldLedger);
  const clock = () => start + 60000;
  const request = createCreditBudget({ store, policy: configured, clock, request: async () => {
    assert.equal(store.state.creditPeriod, configured.periodId);
    assert.deepEqual(store.state.reservations.slice(0, 2),
      previous.map(row => ({ ...row, creditPeriod: configured.rolloverFrom })));
    assert.equal(store.state.reservations[2].status, 'reserved');
    assert.equal(store.state.reservations[2].creditPeriod, configured.periodId);
    return successful();
  } });
  assert.equal((await request(url, init())).status, 200);
  assert.equal(store.state.reservations[2].status, 'settled');
  assert.deepEqual(creditPeriodExposure(store.state.reservations, configured.periodId).map(row => row.status),
    ['reserved', 'settled']);
  for (const ledger of [
    { ...oldLedger, creditPeriod: 'unverified-predecessor' },
    { ...oldLedger, reservations: [{ ...previous[0], expiresAt: start + 1000 }] },
  ]) {
    const reject = createCreditBudget({ store: memory(ledger), policy: configured, clock,
      request: () => assert.fail('unverified rollover must not call OpenAI') });
    await assert.rejects(reject(url, init()), /new-grant-requires-explicit-reset/);
  }
});

test('only Standard processing and bounded GPT-6.2 requests are admitted', () => {
  for (const model of ['gpt-6.2-sol', 'gpt-6.2-astra']) {
    const body = JSON.parse(prepareBudgetedRequest(url, init(model)).init.body);
    assert.equal(body.max_completion_tokens, 8192);
    assert.equal(body.reasoning_effort, 'max');
    assert.equal(body.temperature, undefined);
    assert.equal(body.max_tokens, undefined);
    assert.equal(body.service_tier, 'default');
    assert.equal(body.store, false);
    for (const changes of [{ max_tokens: 100000 }, { tools: [{}] }, { service_tier: 'priority' },
      { messages: [{ content: 'x'.repeat(80001) }] }, { previous_response_id: 'unbounded-history' }, { stream: true }]) {
      assert.throws(() => prepareBudgetedRequest(url, init(model, changes)));
    }
  }
  assert.throws(() => prepareBudgetedRequest('https://example.com', init()));
});

test('GPT-6.2 image requests reserve reasoning and high detail at bounded cache rates', () => {
  const source = 'data:image/jpeg;base64,AA==';
  for (const model of ['gpt-6.2-sol', 'gpt-6.2-astra']) {
    const request = prepareBudgetedRequest('https://api.openai.com/v1/responses', init(model, {
      input: [{ role: 'user', content: [{ type: 'input_image', image_url: source, detail: 'original' }] }],
      reasoning: { effort: 'low' },
      prompt_cache_options: { ttl: '12h', prewarm: true },
    }));
    const body = JSON.parse(request.init.body);
    assert.deepEqual(body.reasoning, { effort: 'max', mode: 'pro' });
    assert.deepEqual(body.prompt_cache_options, { ttl: '30m' });
    assert.equal(body.input[0].content[0].detail, 'high');
    assert.equal(body.max_output_tokens, 8192);
    assert.ok(request.reservedUsd >= (model === 'gpt-6.2-astra' ? 0.57 : 0.14) && request.reservedUsd < policy.requestLimitUsd);
  }
});

test('Astra uplift is confined to the approved enrichment window and shares the overall cap', async () => {
  const campaign = Date.parse(policy.astraEnrichment.notBefore) + 60000;
  const deadline = Date.parse(policy.expiresAt) - 120000;
  const store = memory({ version: 1, creditPeriod: policy.periodId, pausedUntil: 0, reservations: [
    { at: campaign - 1, usd: 3, model: 'gpt-6-astra', profile: 'astra-deal-enrichment', status: 'settled' },
  ] });
  const finished = async () => successful();
  const ordinary = createCreditBudget({ store, policy, clock: () => campaign, request: finished });
  const active = createCreditBudget({ store, policy, clock: () => campaign, request: finished, allowAstraEnrichment: true });
  assert.equal(isAstraEnrichmentActive({ enabled: true, now: campaign, policy }), true);
  assert.equal(isAstraEnrichmentActive({ enabled: true, now: deadline, policy }), false);
  await assert.rejects(ordinary(url, init('gpt-6.2-astra')), /model-outside-active-profile/);
  await assert.rejects(active(url, init('gpt-6.2-sol')), /model-outside-active-profile/);
  assert.equal((await ordinary(url, init())).status, 200);
  assert.equal((await active(url, init('gpt-6.2-astra'))).status, 200);
  assert.equal(store.state.reservations.at(-1).profile, 'astra-deal-enrichment');
  const capped = createCreditBudget({ store, policy: { ...policy, periodLimitUsd: 3.1,
    astraEnrichment: { ...policy.astraEnrichment, rollingDayLimitUsd: 3.1 } },
    clock: () => campaign, request: () => assert.fail('period cap must be enforced'), allowAstraEnrichment: true });
  await assert.rejects(capped(url, init('gpt-6.2-astra')), /shared-spend-limit/);
});

test('Astra model denial is recorded without pausing ordinary jobs or retrying Astra', async () => {
  const campaign = Date.parse(policy.astraEnrichment.notBefore) + 60000;
  const store = memory();
  let calls = 0;
  const options = { store, policy, clock: () => campaign, allowAstraEnrichment: true,
    request: async () => { calls++; return Response.json({ error: { code: 'model_not_found' } }, { status: 404 }); } };
  assert.equal((await createCreditBudget(options)(url, init('gpt-6.2-astra'))).status, 404);
  await assert.rejects(createCreditBudget(options)(url, init('gpt-6.2-astra')), /astra-provider-pause/);
  assert.equal(calls, 1);
  assert.equal(store.state.pausedUntil, 0);
  assert.equal((await createCreditBudget({ ...options, allowAstraEnrichment: false, request: successful })(url, init())).status, 200);
});

test('Responses preserves strict schemas and the caller shape for both approved models', async () => {
  for (const model of ['gpt-6.2-sol', 'gpt-6.2-astra']) {
    const campaign = Date.parse(policy.astraEnrichment.notBefore) + 60000;
    const store = memory();
    const schema = { type: 'object', additionalProperties: false, required: ['ok'], properties: { ok: { type: 'boolean' } } };
    const photo = 'data:image/jpeg;base64,AA==';
    const request = createCreditBudget({ store, policy, clock: () => campaign, allowAstraEnrichment: model === 'gpt-6.2-astra',
      request: async (endpoint, prepared) => {
        assert.equal(endpoint, 'https://api.openai.com/v1/responses');
        const body = JSON.parse(prepared.body);
        assert.equal(body.model, model);
        assert.deepEqual(body.reasoning, { effort: 'max', mode: 'pro' });
        assert.deepEqual(body.text.format, { type: 'json_schema', name: 'fixture', strict: true, schema });
        assert.deepEqual(body.input[0], { role: 'system', content: 'Check this sample' });
        assert.deepEqual(body.input[1].content, [
          { type: 'input_text', text: 'Is this the right image?' },
          { type: 'input_image', image_url: photo, detail: 'high' },
        ]);
        assert.equal(store.state.reservations[0].status, 'reserved');
        return Response.json({ model, status: 'completed',
          output: [{ type: 'reasoning' }, { type: 'message', content: [{ type: 'output_text', text: '{"ok":true}' }] }],
          usage: { input_tokens: 512, output_tokens: 20, total_tokens: 532 } });
      } });
    const response = await request(url, init(model, {
      response_format: { type: 'json_schema', json_schema: { name: 'fixture', schema, strict: true } },
      messages: [{ role: 'system', content: 'Check this sample' }, { role: 'user', content: [
        { type: 'text', text: 'Is this the right image?' }, { type: 'image_url', image_url: { url: photo } },
      ] }],
    }));
    const result = await response.json();
    assert.equal(result.choices[0].finish_reason, 'stop');
    assert.deepEqual(JSON.parse(result.choices[0].message.content), { ok: true });
    assert.deepEqual(result.usage, { prompt_tokens: 512, completion_tokens: 20, total_tokens: 532 });
    assert.equal(store.state.reservations[0].status, 'settled');
    assert.equal(store.state.reservations[0].reasoningEffort, 'max');
    assert.equal(store.state.reservations[0].reasoningMode, 'pro');
  }
});

test('a reservation must be durably committed before a provider request; usage releases unused reservation', async () => {
  const store = memory();
  let calls = 0;
  const request = createCreditBudget({ store, policy, clock: () => now, request: async () => {
    calls++;
    assert.equal(store.state.reservations.length, 1);
    assert.equal(store.state.reservations[0].status, 'reserved');
    return successful();
  } });
  assert.equal((await request(url, init())).status, 200);
  assert.equal(calls, 1);
  assert.equal(store.state.reservations[0].status, 'settled');
  assert(store.state.reservations[0].usd > 0);
  assert(store.state.reservations[0].usd < prepareBudgetedRequest(url, init()).reservedUsd);
});

test('the measured November 20 input and reasoning overage fits the larger reserve without increasing the outgoing cap', async () => {
  const request = init('gpt-6.2-sol', { messages: [{ role: 'user', content: 'a'.repeat(10500) }] });
  const receipt = { input_tokens: 16259, output_tokens: 9891 };
  assert.equal(meteredUsageUsd('gpt-6.2-sol', receipt.input_tokens, receipt.output_tokens), 0.139558);
  assert.ok(prepareFreeCreditCall(url, request).reservedUsd > 0.139558);
  const store = memory();
  const call = createCreditBudget({ store, policy, clock: () => now, request: async (_url, request) => {
    assert.equal(JSON.parse(request.body).max_output_tokens, 8192);
    return Response.json({ usage: receipt });
  } });
  await call(url, request);
  assert.equal(store.state.reservations[0].usd, 0.139558);
  assert.equal(store.state.reservations[0].status, 'settled');
  assert.equal(store.state.pausedUntil, 0);
});

test('the real November 21 Pro receipt is covered before dispatch even with only 46 cents of Sol day capacity', async () => {
  const store = memory({ version:1, pausedUntil:0, creditPeriod:policy.periodId,
    reservations:[{id:'older', at:now-60000, status:'settled', usd:1.54}] });
  const requestFor = text => init('gpt-6.2-sol', { messages:[{role:'user', content:text}] });
  const empty = prepareFreeCreditCall(url,requestFor('')).reservedUsd;
  const request = requestFor('a'.repeat(Math.round((0.117935 - empty) / 0.000005)));
  assert.equal(prepareFreeCreditCall(url,request).reservedUsd, 0.117935);
  const transport = createCreditBudget({store,policy,clock:()=>now,request:async()=>{
    const reservation = store.state.reservations.at(-1);
    assert.equal(reservation.usd, 1);
    assert.ok(reservation.dailyAuthorizedUsd >= 0.141308 && reservation.dailyAuthorizedUsd <= 0.46);
    return Response.json({usage:{input_tokens:12035,output_tokens:11122}});
  }});
  await transport(url,request);
  assert.equal(store.state.reservations.at(-1).usd, 0.141308);
  assert.equal(store.state.pausedUntil, 0);
  assert.equal((await createCreditBudget({store,policy,clock:()=>now,request:successful})(url,init())).status,200);
});

test('full period coverage, shared Astra/Sol day coverage and daily-only exhaustion are independent', async () => {
  const at = Date.parse(policy.astraEnrichment.notBefore) + 60000;
  const base = rows => memory({version:1,creditPeriod:policy.periodId,pausedUntil:0,reservations:rows});
  const prior = (usd,hours,profile) => ({at:at-hours*3600000,usd,status:'settled',...(profile?{profile}: {})});
  const request = (store, transport, clock=at) => createCreditBudget({store,policy,clock:()=>clock,request:transport})(url,init());
  for (const rows of [[prior(37.000001,25)], [prior(37,1,'astra-deal-enrichment'),prior(0.97,1)]]) {
    await assert.rejects(request(base(rows),()=>assert.fail('zero paid calls')), /shared-spend-limit/);
  }
  await request(base([prior(37,25)]),successful);
  const store=base([prior(1.75,1)]);
  await request(store,()=>Response.json({usage:{input_tokens:10000,output_tokens:30000}}));
  assert.equal(store.state.reservations.at(-1).usd,0.325);
  assert.equal(store.state.pausedUntil,0);
  await assert.rejects(request(store,()=>assert.fail('no day capacity')),/shared-spend-limit/);
  await request(store,successful,at+86400000);
});

test('the active period-only policy admits Sol and Astra above the former daily limits', async () => {
  assert.equal(configured.rollingDayLimitUsd, null);
  assert.equal(configured.astraEnrichment.rollingDayLimitUsd, null);
  assert.equal(configured.periodLimitUsd, 100);
  assert.equal(configured.requestLimitUsd, 1);
  const at = Date.parse(configured.astraEnrichment.notBefore) + 60000;
  const missingSolLimit = { ...configured };
  delete missingSolLimit.rollingDayLimitUsd;
  const missingAstraLimit = structuredClone(configured);
  delete missingAstraLimit.astraEnrichment.rollingDayLimitUsd;
  assert.throws(() => validateCreditPolicy(missingSolLimit, at), /unverified-expired-or-unsafe-credit-policy/);
  assert.throws(() => validateCreditPolicy(missingAstraLimit, at), /unverified-expired-or-unsafe-credit-policy/);
  const astraProfile = 'astra-deal-enrichment';
  const prior = (usd, profile, hoursAgo = 1) => ({
    at: at - hoursAgo * 3600000, creditPeriod: configured.periodId, usd, status: 'settled', profile,
  });
  const sent = [];
  const request = (budget, rows, model = 'gpt-6.2-sol', requestInit = init(model)) => {
    const store = memory({ version: 1, creditPeriod: budget.periodId, pausedUntil: 0, reservations: rows });
    return createCreditBudget({ store, policy: budget, clock: () => at, allowAstraEnrichment: model === 'gpt-6.2-astra',
      request: async (_url, prepared) => {
        assert.equal(store.state.reservations.at(-1).usd, 1);
        sent.push(JSON.parse(prepared.body).model);
        return successful();
      } })(url, requestInit);
  };

  const aboveFormerDayLimits = [prior(2.55), prior(36, astraProfile)];
  for (const model of ['gpt-6.2-sol', 'gpt-6.2-astra']) {
    await assert.rejects(request(historicPolicy, aboveFormerDayLimits, model), /shared-spend-limit/);
    assert.equal((await request(configured, aboveFormerDayLimits, model)).status, 200);
    await assert.rejects(request(configured, [prior(99.5, undefined, 48)], model), /shared-spend-limit/);
  }
  const images = Array.from({ length: 3 }, () => ({ type: 'image_url', image_url: { url: 'https://example.invalid/mock.png' } }));
  const expensive = init('gpt-6.2-astra', { messages: [{ role: 'user', content: images }] });
  await assert.rejects(request(configured, [], 'gpt-6.2-astra', expensive), /request-cost-limit/);
  assert.deepEqual(sent, ['gpt-6.2-sol', 'gpt-6.2-astra']);
});

test('concurrent Sol cannot reuse an Astra day reservation and ambiguous calls keep the whole period exposure', async () => {
  const at = Date.parse(policy.astraEnrichment.notBefore) + 60000;
  const sharedPolicy = {...policy,periodLimitUsd:100,providerGuard:{...policy.providerGuard,monthlyLimitUsd:100}};
  const store = memory({version:1,pausedUntil:0,creditPeriod:policy.periodId,
    reservations:[{at:at-60000,usd:37.24,status:'settled',profile:'astra-deal-enrichment'}]});
  let started, respond;
  const sent = new Promise(resolve => { started=resolve; });
  const delayed = () => new Promise(resolve => { respond=resolve; started(); });
  const astra = createCreditBudget({store,policy:sharedPolicy,clock:()=>at,allowAstraEnrichment:true,request:delayed});
  const sol = (request,clock=at) => createCreditBudget({store,policy:sharedPolicy,clock:()=>clock,request})(url,init());
  const pending = astra(url,init('gpt-6.2-astra'));
  await sent;
  const row=store.state.reservations.at(-1);
  assert.equal(row.usd,1);
  assert.equal(dailyCreditExposureUsd(row,at),0.76);
  await assert.rejects(sol(()=>assert.fail('no available combined capacity')),/shared-spend-limit/);
  respond(Response.json({}));
  await pending;
  assert.equal(store.state.reservations.at(-1).status,'reserved');
  assert.equal(dailyCreditExposureUsd(row,at+180000),1);
  await assert.rejects(sol(()=>assert.fail('unknown usage remains held'),at+180000),/shared-spend-limit/);
  await sol(successful,at+86400000);
});

test('even a larger unexpected overrun is posted at the full cost before the shared circuit blocks future calls', async () => {
  const store = memory();
  let calls = 0;
  const request = createCreditBudget({ store, policy, clock: () => now, request: async () => {
    calls++;
    return Response.json({ usage: { input_tokens: 50000, output_tokens: 100000 } });
  } });
  await request(url, init());
  assert.equal(store.state.reservations[0].usd, 1.125);
  assert.equal(store.state.reservations[0].status, 'settled');
  assert.equal(store.state.costOverrun.actualUsd, 1.125);
  assert.equal(store.state.pausedUntil, Date.parse(policy.expiresAt));
  await assert.rejects(request(url, init()), /runner-paused/);
  await assert.rejects(createCreditBudget({ store, policy, clock: () => now, request: () => assert.fail() })(url, init()), /storage-or-provider-pause/);
  assert.equal(calls, 1);
});

test('Astra can still verify the original and card crop together under the existing request cap', async () => {
  const campaign = Date.parse(policy.astraEnrichment.notBefore) + 60000;
  const store = memory();
  const budget = createCreditBudget({ store, policy, clock: () => campaign, request: successful, allowAstraEnrichment: true });
  const content = [
    { type: 'text', text: 'Wiener Mittagsangebot '.repeat(120) },
    ...['original', 'crop'].map(name => ({ type: 'image_url', image_url: { url: 'https://example.org/' + name + '.jpg' } })),
  ];
  const request = init('gpt-6.2-astra', { messages: [{ role: 'user', content }] });
  assert.ok(prepareFreeCreditCall(url, request).reservedUsd < policy.requestLimitUsd);
  assert.equal((await budget(url, request)).status, 200);
});

test('a pause stops admission but already-dispatched calls can still account for their full measured usage', async () => {
  const store = memory();
  const responses = [];
  let dispatched;
  const bothDispatched = new Promise(resolve => { dispatched = resolve; });
  const options = { store, policy, clock: () => now, request: () => new Promise(resolve => {
    responses.push(resolve);
    if (responses.length === 2) dispatched();
  }) };
  const first = createCreditBudget(options)(url, init());
  const second = createCreditBudget(options)(url, init());
  await bothDispatched;
  responses[0](Response.json({ usage: { input_tokens:50000, output_tokens:100000 } }));
  await first;
  await assert.rejects(createCreditBudget(options)(url, init()), /storage-or-provider-pause/);
  responses[1](Response.json({ usage: { input_tokens:60000, output_tokens:100000 } }));
  await second;
  assert.deepEqual(store.state.reservations.map(r => [r.usd,r.status]), [[1.125,'settled'],[1.15,'settled']]);
  assert.equal(store.state.pausedUntil, Date.parse(policy.expiresAt));
});

test('historical recovery settles only the verified receipt, preserves other reservations, and refuses changed evidence or caps', () => {
  const at = Date.parse('2026-11-20T21:04:35.190Z');
  const expiresAt = Date.parse(historicPolicy.expiresAt);
  const clock = Date.parse('2026-11-21T12:00:00Z');
  const r = { id:'4513a121-cb88-48ec-81d1-8dcaf179f3ac', at, expiresAt, model: 'gpt-6.2-sol', status: 'reserved', count: 1, creditPeriod: historicPolicy.periodId, usd: 0.111105 };
  const earlier = { ...r, id: 'unrelated-prior-reservation', at: at - 400000, usd: 0.24 };
  const state = { version: 1, creditPeriod: historicPolicy.periodId, pausedUntil: expiresAt, reservations: [earlier, r] };
  const report = {
    runProvenance: { repository: 'ataalla24-ux/deal-finder', runId: '44816571241', event: 'schedule', runAttempt: '1' },
    config: { model: r.model }, aiUsage: { inputTokens: 16259, outputTokens: 9891, totalTokens: 26150 },
    aiHealth: { budgetReason: 'runner-paused', completedCandidates: 4 },
  };
  const { next } = reconcileKnownOverrun(state, report, historicPolicy, clock);
  assert.equal(next.pausedUntil, 0);
  assert.deepEqual(next.reservations, [earlier, { ...r, usd: 0.139558, status: 'settled' }]);
  assert.equal(state.pausedUntil, expiresAt);
  for (const unproven of [{ ...state, pausedUntil: 1 }, { ...state, reservations: [r, { ...r, at: at + 1 }] },
    { ...state, costOverrun: {} }, { ...state, reservations: [{...r, id:'a-different-reservation'}] },
    { ...state, reservations: [{...earlier, id:r.id}, r] }, { ...state, reservations: [{ ...earlier, usd: 1.9 }, r] }]) {
    assert.throws(() => reconcileKnownOverrun(unproven, report, historicPolicy, clock));
  }
  assert.throws(() => reconcileKnownOverrun(state, { ...report, aiUsage: {} }, historicPolicy, clock));
  assert.throws(() => reconcileKnownOverrun(state, report, configured, clock));
});

test('parallel runners cannot spend the same capacity', async () => {
  const store = memory();
  const cost = 1;
  const { astraEnrichment, ...ordinaryPolicy } = policy;
  const constrained = { ...ordinaryPolicy, periodLimitUsd: cost * 2.1, rollingDayLimitUsd: cost * 2.1 };
  let calls = 0;
  const transport = async () => { calls++; await new Promise(resolve => setTimeout(resolve, 20)); return Response.json({}); };
  const requests = Array.from({ length: 12 }, () => createCreditBudget({ store, policy: constrained, clock: () => now, request: transport }));
  const outcomes = await Promise.allSettled(requests.map(request => request(url, init())));
  assert.equal(calls, 2);
  assert.equal(outcomes.filter(result => result.status === 'fulfilled').length, 2);
  assert.equal(store.state.reservations.length, 2);
});

test('storage failures, corrupt ledgers, stale credit periods and expired policies make zero provider calls', async () => {
  let calls = 0;
  const transport = async () => { calls++; return successful(); };
  for (const store of [
    { read: async () => { throw Error('offline'); } },
    { read: async () => ({ state: { version: 1, reservations: [], pausedUntil: 0 }, revision: 0 }), compareAndSwap: async () => false },
    memory({ version: 1, reservations: [{ usd: 'not-a-number', at: now }], pausedUntil: 0, creditPeriod: policy.periodId }),
    memory({ version: 1, reservations: [], pausedUntil: 0, creditPeriod: 'different-grant' }),
  ]) await assert.rejects(createCreditBudget({ store, policy, clock: () => now, request: transport })(url, init()));
  await assert.rejects(createCreditBudget({ store: memory(), policy, clock: () => Date.parse(policy.expiresAt), request: transport })(url, init()));
  assert.equal(calls, 0);
});

test('timeouts and missing usage remain charged, never silently free capacity', async () => {
  const store = memory();
  await assert.rejects(createCreditBudget({ store, policy, clock: () => now, request: async () => { throw Error('PRIVATE SECRET'); } })(url, init()), error => !error.message.includes('PRIVATE'));
  const reserved = store.state.reservations[0].usd;
  assert.ok(reserved >= 0.08192);
  const response = await createCreditBudget({ store, policy, clock: () => now, request: async () => Response.json({}) })(url, init());
  assert.equal(response.status, 200);
  assert(store.state.reservations.every(row => row.status === 'reserved' && row.usd === reserved));
});

test('provider billing failures are redacted, globally paused and not retried as rate limits', async () => {
  for (const code of ['credit_balance_exhausted', 'organization_spend_limit_exceeded', 'project_spend_limit_exceeded']) {
    let calls = 0;
    const store = memory();
    const transport = createCreditBudget({ store, policy, clock: () => now, request: async () => {
      calls++; return Response.json({ error: { code, message: 'PRIVATE PROVIDER DETAILS' } }, { status: 429 });
    } });
    await assert.rejects(requestOpenAi(url, init(), { fetchImpl: transport, sleepImpl: () => assert.fail('no billing retry') }), error => error.code === code);
    assert.equal(calls, 1);
    assert(store.state.pausedUntil > now);
    await assert.rejects(transport(url, init()));
    assert.equal(JSON.stringify(store.state).includes('PRIVATE'), false);
  }
});

test('all production OpenAI entry points use the common gate; no raw unbudgeted default fetch', () => {
  for (const file of ['scraper/instagram-media-evidence.js', 'scraper/instagram-ai-agent.js', 'scraper/community-extraction.js',
    'scraper/deal-card-editor.js', 'scraper/set-daily-deal.js', 'scripts/review-live-deals-llm.mjs', 'scripts/automatic-deal-maintenance.mjs', 'scripts/server-quality-audit.mjs']) {
    const source = fs.readFileSync(file, 'utf8');
    assert.match(source, /freeCreditOpenAiFetch|requestOpenAi/, file);
    assert.doesNotMatch(source, /await fetch\('https:\/\/api\.openai\.com/, file);
  }
  const workflows = ['instagram-ai-access-check', 'instagram-ai-agent', 'meta-instagram-deals', 'tiktok-deals', 'wien-deals-combined', 'community-submissions', 'daily-deal-pick', 'validate-live-deals', 'server-deal-quality'];
  for (const name of workflows) assert.match(fs.readFileSync(`.github/workflows/${name}.yml`, 'utf8'), /GH_TOKEN: \$\{\{ github.token \}\}/, name);
});

test('the production shared store uses a separate funding branch and can initialize and reserve safely', async () => {
  let saved = null, revision = 0;
  const routes = [];
  const fetchImpl = async (url, init = {}) => {
    const route = String(url).replace('https://api.github.com/repos/fixture/repo', '');
    routes.push(route);
    if (route === '/git/ref/heads/automation/openai-free-credit-budget') return Response.json({}, { status: 404 });
    if (route === '/git/ref/heads/main') return Response.json({ object: { sha: 'base' } });
    if (route === '/git/refs') {
      assert.equal(JSON.parse(init.body).ref, 'refs/heads/automation/openai-free-credit-budget');
      return Response.json({}, { status: 201 });
    }
    if (init.method === 'PUT') {
      const body = JSON.parse(init.body);
      assert.equal(body.branch, 'automation/openai-free-credit-budget');
      if ((body.sha || null) !== (revision ? `revision-${revision}` : null)) return Response.json({}, { status: 409 });
      saved = JSON.parse(Buffer.from(body.content, 'base64').toString('utf8')); revision++;
      return Response.json({}, { status: 201 });
    }
    if (!saved) return Response.json({}, { status: 404 });
    return Response.json({ sha: `revision-${revision}`, content: Buffer.from(JSON.stringify(saved)).toString('base64') });
  };
  const store = githubQuotaStore({ GITHUB_REPOSITORY: 'fixture/repo', GH_TOKEN: 'offline-fixture' }, fetchImpl,
    { branch: 'automation/openai-free-credit-budget', file: 'openai-free-credit-budget.json', initialPauseMs: 0, clock: () => now });
  const budget = createCreditBudget({ store, policy, clock: () => now, request: async () => successful() });
  assert.equal((await budget(url, init())).status, 200);
  assert.equal(saved.creditPeriod, policy.periodId);
  assert.equal(saved.reservations[0].status, 'settled');
  assert(routes.some(route => route.includes('openai-free-credit-budget.json?ref=')));
  assert(routes.every(route => !route.includes('instagram-quota')));
});

test('failed settlement cannot leak provider text or admit another call', async () => {
  const base = memory();
  let writes = 0, calls = 0;
  const store = { read: base.read, compareAndSwap: async (...args) => { if (++writes > 1) throw Error('storage unavailable'); return base.compareAndSwap(...args); } };
  const request = createCreditBudget({ store, policy, clock: () => now, request: async () => {
    calls++; return Response.json({ error: { code: 'insufficient_quota', message: 'PRIVATE PROVIDER TEXT' } }, { status: 429 });
  } });
  const response = await request(url, init());
  assert.equal((await response.json()).error.message, 'AI request deferred');
  await assert.rejects(request(url, init()));
  assert.equal(calls, 1);
  assert.equal(base.state.reservations[0].status, 'reserved');
});

test('explicit model denial on Sol only pauses Sol, with durable reservations and independent Astra access', async () => {
  const start = Date.parse(policy.astraEnrichment.notBefore) + 60000;
  let at = start;
  let calls = 0;
  const store = memory();
  const options = { store, policy, clock: () => at, request: async () => {
    calls++;
    return Response.json({ error: { code: 'model_not_found' } }, { status: 403 });
  } };
  assert.equal((await createCreditBudget(options)(url, init())).status, 403);
  assert.equal(store.state.pausedUntil, 0);
  assert.equal(store.state.modelPausedUntil['gpt-6.2-sol'], start + 6 * 3600000);
  assert.equal(store.state.reservations[0].status, 'reserved');
  await assert.rejects(createCreditBudget(options)(url, init()), /model-provider-pause/);
  assert.equal((await createCreditBudget({ ...options, allowAstraEnrichment: true, request: successful })(url, init('gpt-6.2-astra'))).status, 200);
  assert.equal(calls, 1);
  at = start + 6 * 3600000;
  assert.equal((await createCreditBudget({ ...options, request: successful })(url, init())).status, 200);
});

test('billing, authentication and unexplained forbidden errors on Astra keep the global hold', async () => {
  const at = Date.parse(policy.astraEnrichment.notBefore) + 60000;
  for (const [status, error] of [[403, {}], [403, { code: 'insufficient_quota', type: 'model_not_found' }],
    [401, { code: 'model_not_found' }], [403, { code: 'invalid_api_key', type: 'model_not_found' }]]) {
    const store = memory();
    const options = { store, policy, clock: () => at, allowAstraEnrichment: true,
      request: async () => Response.json({ error }, { status }) };
    assert.equal((await createCreditBudget(options)(url, init('gpt-6.2-astra'))).status, status);
    assert.equal(store.state.pausedUntil, at + 6 * 3600000);
    await assert.rejects(createCreditBudget({ ...options, allowAstraEnrichment: false, request: successful })(url, init()), /storage-or-provider-pause/);
  }
});

test('legacy Astra holds still apply and invalid model pause data cannot admit requests', async () => {
  const at = Date.parse(policy.astraEnrichment.notBefore) + 60000;
  for (const [value,reason] of [[{ astraPausedUntil: at + 5000 }, /astra-provider-pause/],
    [{ modelPausedUntil: { 'gpt-6.2-astra': 'n/a' } }, /invalid-spend-ledger/]]) {
    const store = memory({ version: 1, reservations: [], pausedUntil: 0, ...value });
    await assert.rejects(createCreditBudget({ store, policy, clock: () => at, allowAstraEnrichment: true,
      request: () => assert.fail('no request allowed') })(url, init('gpt-6.2-astra')), reason);
  }
});

test('optional blog preserves one ordinary editor and review only with actionable work and scarce shared capacity', async () => {
  const transport = successful;
  const candidate = 'gpt-6.2-sol';
  const stateWithSpend = (daily, priorPeriodSpend = 0) => memory({
    version: 1, pausedUntil: 0, creditPeriod: policy.periodId,
    reservations: [
      { id: 'old', at: now - 2 * 86400000, usd: priorPeriodSpend, status: 'settled', creditPeriod: policy.periodId },
      { id: 'recent', at: now - 60000, usd: daily, status: 'settled', creditPeriod: policy.periodId },
    ],
  });
  for (const store of [stateWithSpend(1.45), stateWithSpend(0, policy.periodLimitUsd - 1.6)]) {
    const budget = createCreditBudget({ store, policy, clock: () => now, request: transport });
    const before = store.state;
    await assert.rejects(budget(url, init(candidate), { preserveDealCorrectionCapacity: true }),
      error => error.budgetReason === 'pending-deal-correction-priority');
    assert.deepEqual(store.state, before);
    assert.equal((await budget(url, init(candidate))).status, 200);
  }
  const ample = createCreditBudget({ store: stateWithSpend(0.50), policy, clock: () => now, request: transport });
  assert.equal((await ample(url, init(candidate), { preserveDealCorrectionCapacity: true })).status, 200);
});

test('concurrent optional blog requests cannot both consume capacity reserved for a grounded deal', async () => {
  const store = memory({ version: 1, pausedUntil: 0, creditPeriod: policy.periodId,
    reservations: [{ id: 'earlier', at: now, usd: 1.18, status: 'settled', creditPeriod: policy.periodId }] });
  let calls = 0;
  const budget = () => createCreditBudget({ store, policy, clock: () => now, request: async () => {
    calls++; return Response.json({});
  } });
  const result = await Promise.allSettled([1, 2].map(() =>
    budget()(url, init(), { preserveDealCorrectionCapacity: true })));
  assert.equal(calls, 1);
  assert.equal(result.filter(row => row.reason?.budgetReason === 'pending-deal-correction-priority').length, 1);
});


const imageInit = (changes = {}) => ({method:'POST',headers:{},body:JSON.stringify({
  model:DEAL_IMAGE_GENERATION_MODEL,prompt:'A photographic illustration of one glazed donut.',n:1,
  size:'1536x1024',quality:'high',complexity:'high',output_format:'jpeg',output_compression:95,moderation:'auto',...changes,
})});
const imageOptions = {imageGenerationKey:'a'.repeat(64)};
const imageUsage = {input_tokens:1100,output_tokens:2000,total_tokens:3100,
  input_tokens_details:{text_tokens:1000,image_tokens:100}};
const generatedImage = (usage = imageUsage) => Response.json({created:1795811302,data:[{b64_json:'offline-image'}],usage});

test('image generation accepts only the fixed priced single-image operation and leaves text routing strict', async () => {
  const prepared = prepareFreeCreditCall(DEAL_IMAGE_GENERATION_URL,imageInit());
  assert.equal(prepared.providerUrl,DEAL_IMAGE_GENERATION_URL);
  assert.equal(prepared.model,DEAL_IMAGE_GENERATION_MODEL);
  assert.equal(prepared.modality,'image');
  assert.equal(prepared.adaptChat,false);
  assert.equal(prepared.reservedUsd,1);
  assert.deepEqual(JSON.parse(prepared.init.body),JSON.parse(imageInit().body));
  const invalid = [
    {model:'gpt-image-1'},{model:'gpt-6.2-sol'},{n:2},{n:undefined},{size:'auto'},{quality:'low'},
    {complexity:'auto'},{output_format:'png'},{output_compression:94},{moderation:'low'},
    {stream:true},{image:'https://arbitrary.example/image.jpg'},{tools:[{type:'image_generation'}]},
    {prompt:''},{prompt:'ü'.repeat(4001)},
  ];
  let calls=0;
  const store=memory();
  const request=createCreditBudget({store,policy,clock:()=>now,request:async()=>{calls++;return generatedImage();}});
  for (const changes of invalid) await assert.rejects(request(DEAL_IMAGE_GENERATION_URL,imageInit(changes)));
  for (const endpoint of [DEAL_IMAGE_GENERATION_URL+'?extra=1','https://api.openai.com/v1/images/edits']) {
    await assert.rejects(request(endpoint,imageInit()));
  }
  await assert.rejects(request(DEAL_IMAGE_GENERATION_URL,{...imageInit(),method:'GET'}));
  for (const endpoint of [url,'https://api.openai.com/v1/responses']) {
    assert.throws(()=>prepareBudgetedRequest(endpoint,init(DEAL_IMAGE_GENERATION_MODEL)));
  }
  assert.throws(()=>modelForTask('image',DEAL_IMAGE_GENERATION_MODEL));
  assert.ok(prepareBudgetedRequest(DEAL_IMAGE_GENERATION_URL,imageInit({prompt:'ü'.repeat(4000)})));
  assert.equal(calls,0);
  assert.equal(store.state.reservations.length,0);
});

test('image usage uses separate text, image input and image output rates with complete consistent counts', () => {
  assert.equal(meteredImageUsageUsd(imageUsage),0.0658);
  for (const usage of [undefined,{}, {...imageUsage,total_tokens:3101},
    {...imageUsage,input_tokens:1101},{...imageUsage,output_tokens:'2000'},
    {...imageUsage,input_tokens_details:{text_tokens:1000}},
    {...imageUsage,input_tokens_details:{text_tokens:1000,image_tokens:-1}},
    {input_tokens:0,output_tokens:Number.MAX_SAFE_INTEGER,total_tokens:Number.MAX_SAFE_INTEGER,
      input_tokens_details:{text_tokens:0,image_tokens:0}},
  ]) assert.equal(meteredImageUsageUsd(usage),null);
});

test('image generation reserves one dollar durably and settles its usage in the existing shared ledger', async () => {
  const store=memory();
  const at=Date.parse(policy.astraEnrichment.notBefore)+60000;
  let calls=0;
  const request=createCreditBudget({store,policy,clock:()=>at,allowAstraEnrichment:true,request:async(endpoint,options)=>{
    calls++;
    assert.equal(endpoint,DEAL_IMAGE_GENERATION_URL);
    assert.equal(store.state.reservations.at(-1).usd,1);
    assert.equal(store.state.reservations.at(-1).status,'reserved');
    assert.equal(store.state.reservations.at(-1).profile,'deal-image-generation');
    assert.equal(JSON.parse(options.body).output_compression,95);
    return generatedImage();
  }});
  const response=await request(DEAL_IMAGE_GENERATION_URL,imageInit(),{...imageOptions,preserveDealCorrectionCapacity:true});
  assert.equal((await response.json()).data[0].b64_json,'offline-image');
  const row=store.state.reservations.at(-1);
  assert.equal(row.status,'settled');
  assert.equal(row.usd,0.0658);
  assert.equal(row.inputTextTokens,1000);
  assert.equal(row.inputImageTokens,100);
  assert.equal(row.inputTokens,1100);
  assert.equal(row.outputTokens,2000);
  assert.equal(row.reasoningEffort,undefined);
  assert.equal(row.imageGenerationKey,imageOptions.imageGenerationKey);
  assert.equal(calls,1);
});

test('image missing usage, timeouts and malformed receipts keep the whole reservation without retrying', async () => {
  for (const transport of [
    async()=>generatedImage(null),
    async()=>Response.json({data:[{b64_json:'offline-image'}]}),
    async()=>generatedImage({...imageUsage,total_tokens:0}),
    async()=>{throw Error('PRIVATE upstream timeout');},
  ]) {
    const store=memory();
    let calls=0;
    const request=createCreditBudget({store,policy,clock:()=>now,request:async()=>{calls++;return transport();}});
    await request(DEAL_IMAGE_GENERATION_URL,imageInit(),imageOptions).catch(error=>assert.doesNotMatch(error.message,/PRIVATE/));
    assert.equal(calls,1);
    assert.equal(store.state.reservations[0].status,'reserved');
    assert.equal(store.state.reservations[0].usd,1);
  }
});

test('images honor shared caps, preserve text correction capacity, storage failures and credit expiry', async () => {
  let calls=0;
  const transport=async()=>{calls++;return generatedImage();};
  const nearCap=usd=>memory({version:1,creditPeriod:policy.periodId,pausedUntil:0,
    reservations:[{id:'prior-text',at:now-25*3600000,usd,status:'settled',model:'gpt-6.2-sol'}]});
  await assert.rejects(createCreditBudget({store:nearCap(37.01),policy,clock:()=>now,request:transport})(DEAL_IMAGE_GENERATION_URL,imageInit(),imageOptions),/shared-spend-limit/);
  await assert.rejects(createCreditBudget({store:nearCap(36.8),policy,clock:()=>now,request:transport})(DEAL_IMAGE_GENERATION_URL,imageInit(),{...imageOptions,preserveDealCorrectionCapacity:true}),/pending-deal-correction-priority/);
  await assert.rejects(createCreditBudget({store:{read:async()=>{throw Error('offline');}},policy,clock:()=>now,request:transport})(DEAL_IMAGE_GENERATION_URL,imageInit(),imageOptions),/shared-storage-unavailable/);
  await assert.rejects(createCreditBudget({store:memory(),policy,clock:()=>Date.parse(policy.expiresAt),request:transport})(DEAL_IMAGE_GENERATION_URL,imageInit(),imageOptions),/unverified-expired-or-unsafe-credit-policy/);
  assert.equal(calls,0);
});

test('an image cost overrun is settled completely and pauses further shared spending', async () => {
  const store=memory();
  let calls=0;
  const request=createCreditBudget({store,policy,clock:()=>now,request:async()=>{
    calls++;
    return generatedImage({...imageUsage,output_tokens:40000,total_tokens:41100});
  }});
  await request(DEAL_IMAGE_GENERATION_URL,imageInit(),imageOptions);
  assert.equal(store.state.reservations[0].usd,1.2058);
  assert.equal(store.state.reservations[0].status,'settled');
  assert.equal(store.state.pausedUntil,Date.parse(policy.expiresAt));
  assert.equal(store.state.costOverrun.model,DEAL_IMAGE_GENERATION_MODEL);
  await assert.rejects(request(DEAL_IMAGE_GENERATION_URL,imageInit(),imageOptions),/runner-paused/);
  await assert.rejects(createCreditBudget({store,policy,clock:()=>now,request:successful})(url,init()),/storage-or-provider-pause/);
  assert.equal(calls,1);
});


test('images require a stable dispatch identity before reserving any shared capacity', async () => {
  const store=memory();
  let calls=0;
  const request=createCreditBudget({store,policy,clock:()=>now,request:async()=>{calls++;return generatedImage();}});
  for (const key of [undefined,'','short','A'.repeat(64),{id:'not-a-hash'}]) {
    await assert.rejects(request(DEAL_IMAGE_GENERATION_URL,imageInit(),{imageGenerationKey:key}),
      error=>error.budgetReason==='image-generation-key-required');
  }
  assert.equal(store.state.reservations.length,0);
  assert.equal(calls,0);
});

test('concurrent runners dispatch one paid generation for the same image identity', async () => {
  const store=memory();
  let calls=0;
  const create=()=>createCreditBudget({store,policy,clock:()=>now,request:async()=>{
    calls++;
    await new Promise(resolve=>setTimeout(resolve,20));
    return generatedImage();
  }});
  const results=await Promise.allSettled([create(),create()].map(request=>request(DEAL_IMAGE_GENERATION_URL,imageInit(),imageOptions)));
  assert.equal(calls,1);
  assert.equal(results.filter(result=>result.status==='fulfilled').length,1);
  assert.equal(results.filter(result=>result.reason?.budgetReason==='image-generation-already-dispatched').length,1);
  assert.equal(store.state.reservations.length,1);
  assert.equal(store.state.reservations[0].imageGenerationKey,imageOptions.imageGenerationKey);
});

test('a missing result or settled generation holds its identity across later runners while a different image can be admitted', async () => {
  for (const fail of [true,false]) {
    const store=memory();
    let calls=0;
    const create=()=>createCreditBudget({store,policy,clock:()=>now,request:async()=>{
      calls++;
      if (fail && calls===1) throw Error('ambiguous generation timeout');
      return generatedImage();
    }});
    await create()(DEAL_IMAGE_GENERATION_URL,imageInit(),imageOptions).catch(()=>{});
    const original=store.state.reservations[0];
    assert.equal(original.status,fail?'reserved':'settled');
    await assert.rejects(create()(DEAL_IMAGE_GENERATION_URL,imageInit(),imageOptions),
      error=>error.budgetReason==='image-generation-already-dispatched');
    assert.equal(calls,1);
    assert.equal(store.state.reservations.length,1);
    await create()(DEAL_IMAGE_GENERATION_URL,imageInit(),{imageGenerationKey:'b'.repeat(64)});
    assert.equal(calls,2);
    assert.equal(store.state.reservations.length,2);
    assert.deepEqual(store.state.reservations[0],original,'unknown earlier spend is retained exactly');
  }
});

test('an image refused before reservation can retry its identity after shared storage recovers', async () => {
  const base=memory();
  let reads=0,calls=0;
  const store={...base,read:async()=>{
    if (++reads===1) throw Error('temporary storage outage');
    return base.read();
  }};
  const create=()=>createCreditBudget({store,policy,clock:()=>now,request:async()=>{calls++;return generatedImage();}});
  await assert.rejects(create()(DEAL_IMAGE_GENERATION_URL,imageInit(),imageOptions),/shared-storage-unavailable/);
  assert.equal(base.state.reservations.length,0);
  await create()(DEAL_IMAGE_GENERATION_URL,imageInit(),imageOptions);
  assert.equal(calls,1);
  assert.equal(base.state.reservations.length,1);
});

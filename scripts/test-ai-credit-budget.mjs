import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createCreditBudget, loadAiCreditPolicy, modelForTask, prepareBudgetedRequest, validateCreditPolicy } from '../scraper/ai-credit-budget.js';
import { requestOpenAi } from '../scraper/instagram-media-evidence.js';
import { githubQuotaStore } from '../scraper/instagram-shared-quota.js';
import { classifyWithOpenAi } from '../scraper/instagram-ai-agent.js';

const now = Date.parse('2026-11-06T12:00:00Z');
const policy = loadAiCreditPolicy();
const url = 'https://api.openai.com/v1/chat/completions';
const init = (model = 'gpt-6-luna', changes = {}) => ({ method: 'POST', headers: {}, body: JSON.stringify({ model,
  max_tokens: 600, temperature: 0, messages: [{ role: 'user', content: 'synthetic test' }], ...changes }) });
function memory(initial) {
  let state = initial || { version: 1, reservations: [], pausedUntil: 0 }, revision = 0;
  return { async read() { return { state: structuredClone(state), revision }; },
    async compareAndSwap(expected, next) { if (expected !== revision) return false; state = structuredClone(next); revision++; return true; },
    get state() { return structuredClone(state); } };
}
const successful = () => Response.json({ choices: [{ message: { content: '{"ok":true}' } }], usage: { prompt_tokens: 20, completion_tokens: 5, total_tokens: 25 } });

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
  assert.equal(modelForTask('vision'), 'gpt-6.1-terra');
  assert.equal(modelForTask('review'), 'gpt-6.1-sol');
  assert.equal(modelForTask('extract'), 'gpt-6-luna');
  assert.throws(() => modelForTask('review', 'unpriced-or-future-model'));
});

test('free-only policy rejects expiry, paid fallback, unsafe provider state and calendar reset', () => {
  assert.equal(validateCreditPolicy(policy, now), policy);
  for (const change of [
    { paidFallback: true }, { automaticRenewalAssumed: true }, { expiresAt: '2026-11-05T00:00:00Z' },
    { notBefore: '2026-11-07T00:00:00Z' }, { expiresAt: '2026-12-20T00:00:00Z' },
    { providerGuard: { ...policy.providerGuard, enforced: false } },
    { providerGuard: { ...policy.providerGuard, autoReload: true } },
    { providerGuard: { ...policy.providerGuard, paidBalanceAvailable: true } },
    { rollingDayLimitUsd: 0 }, { periodLimitUsd: 40 },
  ]) assert.throws(() => validateCreditPolicy({ ...policy, ...change }, now), JSON.stringify(change));
  assert.throws(() => validateCreditPolicy(policy, Date.parse(policy.expiresAt)));
});

test('GPT-6 request parameters are bounded and use standard processing only', () => {
  const body = JSON.parse(prepareBudgetedRequest(url, init('gpt-6.1-sol')).init.body);
  assert.equal(body.max_completion_tokens, 600);
  assert.equal(body.reasoning_effort, 'low');
  assert.equal(body.temperature, undefined);
  assert.equal(body.max_tokens, undefined);
  assert.equal(body.service_tier, 'default');
  assert.equal(body.store, false);
  assert.equal(JSON.parse(prepareBudgetedRequest(url, init()).init.body).reasoning_effort, 'none');
  for (const changes of [{ max_tokens: 100000 }, { tools: [{}] }, { service_tier: 'priority' },
    { messages: [{ content: 'x'.repeat(80001) }] }, { previous_response_id: 'unbounded-history' }, { stream: true }]) {
    assert.throws(() => prepareBudgetedRequest(url, init('gpt-6.1-sol', changes)));
  }
  assert.throws(() => prepareBudgetedRequest('https://example.com', init()));
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

test('parallel runners cannot spend the same capacity', async () => {
  const store = memory();
  const cost = prepareBudgetedRequest(url, init()).reservedUsd;
  const constrained = { ...policy, periodLimitUsd: cost * 2.1, rollingDayLimitUsd: cost * 2.1 };
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
  assert.equal(store.state.reservations[0].usd, prepareBudgetedRequest(url, init()).reservedUsd);
  const response = await createCreditBudget({ store, policy, clock: () => now, request: async () => Response.json({}) })(url, init());
  assert.equal(response.status, 200);
  assert(store.state.reservations.every(row => row.status === 'reserved'));
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

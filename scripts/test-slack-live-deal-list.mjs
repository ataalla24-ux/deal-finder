import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

process.env.DEAL_REMOVE_LINK_SECRET = 'offline-test-secret';
process.env.SLACK_LIVE_REVIEW_DRY_RUN = '1';
process.env.SENTRY_DISABLED = '1';
const { validateSnapshot, publishedSnapshot, loadListState, liveCard, listHeader, syncLiveList, slackClient } = await import('./slack-live-deal-list.mjs');
const { parseDigestDealMessage, extractDealsFromThreadMessages } = await import('../scraper/slack-digest-utils.js');
const now = new Date('2026-11-04T20:00:00Z');
const fixture = (id, title) => ({ id, brand: 'Test ' + id, title, description: 'Beim Kauf einer Pizza gibt es eine zweite gratis. Nur Abholung.',
  category: 'essen', type: 'bogo', distance: '1010 Wien', url: 'https://example.org/' + id, validUntil: '2026-12-31', expires: '2026-12-31T23:59:59Z' });
const a = fixture('fixture-a', '1+1 Pizza gratis bei Abholung');
const b = fixture('fixture-b', '1+1 Burger gratis mit Gutschein');
const c = fixture('fixture-c', '1+1 Steak-Wrap gratis');
const docs = (deals, daily = null, weekly = null) => ({
  'deals.json': { deals, totalDeals: deals.length, feedVersion: 'fixture-' + deals.map(deal => deal.title).join('|'), lastUpdated: '2026-11-04T19:00:00Z' },
  'deal-of-the-day.json': daily ? { ...daily, dealId: daily.id, date: '2026-11-04' } : {},
  'deal-of-the-week.json': weekly ? { ...weekly, dealId: weekly.id } : {},
});
const snapshot = (deals, daily, weekly) => validateSnapshot(docs(deals, daily, weekly));
let checks = 0;
const check = async (name, fn) => { await fn(); checks++; console.log('PASS ' + name); };
const fresh = () => ({ version: 1, entries: {} });
function mockSlack({ pinError } = {}) {
  const calls = [];
  const messages = new Map();
  let counter = 0;
  const api = async (method, payload) => {
    calls.push({ method, payload: structuredClone(payload) });
    if (method === 'auth.test') return { ok: true, team_id: 'TTEST', user_id: 'UTESTBOT', url: 'https://fixture.slack.com/' };
    if (method === 'chat.postMessage') {
      const ts = '1793810000.' + String(++counter).padStart(6, '0');
      messages.set(ts, structuredClone(payload));
      return { ok: true, ts };
    }
    if (method === 'chat.update') {
      assert.ok(messages.has(payload.ts), 'Updating an unknown message');
      messages.set(payload.ts, structuredClone(payload));
      return { ok: true, ts: payload.ts };
    }
    if (method === 'pins.add') {
      if (pinError) throw Object.assign(new Error(pinError), { code: pinError, definitelyRejected: true });
      return { ok: true };
    }
    throw new Error('Unexpected API ' + method);
  };
  return { api, calls, messages, count: method => calls.filter(call => call.method === method).length };
}

await check('snapshot preserves all live IDs and rejects duplicate/malformed data', () => {
  assert.equal(snapshot([a, b]).feed.deals.length, 2);
  assert.throws(() => snapshot([a, a]), /Duplicate/);
  assert.throws(() => validateSnapshot({ ...docs([a]), 'deals.json': { deals: [a], totalDeals: 4 } }), /count/);
  assert.throws(() => snapshot([{ ...a, id: '__proto__' }]), /Unsafe/);
  assert.throws(() => snapshot([{ ...a, title: '' }]), /title/);
  assert.throws(() => validateSnapshot({ ...docs([a]), 'deal-of-the-day.json': { ...b, dealId: b.id } }), /missing/);
  assert.throws(() => validateSnapshot({ ...docs([a]), 'deal-of-the-day.json': { ...a, title: 'old copy', dealId: a.id } }), /synchronized/);
});

const state = fresh();
const slack = mockSlack();
await check('initial publication creates exactly one parent and one card per live ID', async () => {
  const saves = [];
  const result = await syncLiveList({ snapshot: snapshot([a, b], a, b), state, channel: 'CTEST', api: slack.api, now,
    save: value => saves.push(structuredClone(value)) });
  assert.equal(result.created, 2);
  assert.equal(slack.count('chat.postMessage'), 3);
  assert.equal(slack.count('pins.add'), 1);
  assert.equal(result.pin.status, 'pinned');
  assert.ok(saves.some(value => value.pendingPost?.key === 'root-v1'));
  assert.ok(!state.pendingPost);
  const header = slack.messages.get(state.rootTs);
  assert.ok(JSON.stringify(header).includes(state.entries[a.id].ts.replace('.', '')));
  assert.equal(slack.messages.get(state.entries[a.id].ts).thread_ts, state.rootTs);
});

await check('unchanged snapshots do not repost, update, repin, or rewrite state', async () => {
  const before = structuredClone(state);
  slack.calls.length = 0;
  let saves = 0;
  const result = await syncLiveList({ snapshot: snapshot([a, b], a, b), state, channel: 'CTEST', api: slack.api,
    now: new Date(now.getTime() + 3600000), save: () => saves++ });
  assert.equal(result.unchanged, 2);
  assert.equal(slack.count('chat.postMessage') + slack.count('chat.update') + slack.count('pins.add'), 0);
  assert.equal(saves, 0);
  assert.deepEqual(state, before);
});

let changedA = { ...a, title: '1+1 Pizza gratis: nur zum Abholen' };
await check('editing a deal updates its same card and preserves message identity', async () => {
  slack.calls.length = 0;
  const oldTs = state.entries[a.id].ts;
  const result = await syncLiveList({ snapshot: snapshot([changedA, b], changedA, b), state, channel: 'CTEST', api: slack.api, now });
  assert.equal(result.updated, 1);
  assert.equal(result.unchanged, 1);
  assert.equal(state.entries[a.id].ts, oldTs);
  assert.equal(slack.count('chat.postMessage'), 0);
  assert.equal(slack.count('chat.update'), 2);
});

await check('new approvals add only the missing live card', async () => {
  slack.calls.length = 0;
  const result = await syncLiveList({ snapshot: snapshot([c, changedA, b], changedA, b), state, channel: 'CTEST', api: slack.api, now });
  assert.equal(result.created, 1);
  assert.equal(result.unchanged, 2);
  assert.equal(slack.count('chat.postMessage'), 1);
});

await check('removed offers are marked offline without deletion or approval actions', async () => {
  slack.calls.length = 0;
  const oldTs = state.entries[b.id].ts;
  const result = await syncLiveList({ snapshot: snapshot([changedA, c], changedA), state, channel: 'CTEST', api: slack.api, now });
  assert.equal(result.archived, 1);
  assert.equal(state.entries[b.id].ts, oldTs);
  assert.equal(state.entries[b.id].status, 'offline');
  const oldMessage = slack.messages.get(oldTs);
  assert.match(oldMessage.text, /Nicht mehr online/);
  assert.ok(!oldMessage.blocks.some(block => block.type === 'actions'));
  assert.ok(!JSON.stringify(slack.messages.get(state.rootTs)).includes('Burger gratis'));
  assert.equal(slack.count('chat.delete'), 0);
});

await check('a legitimately restored feed ID reuses its old Slack card', async () => {
  slack.calls.length = 0;
  const oldTs = state.entries[b.id].ts;
  await syncLiveList({ snapshot: snapshot([changedA, b, c], changedA), state, channel: 'CTEST', api: slack.api, now });
  assert.equal(state.entries[b.id].ts, oldTs);
  assert.equal(state.entries[b.id].status, 'live');
  assert.equal(slack.count('chat.postMessage'), 0);
});

await check('featured changes refresh only affected cards and the index', async () => {
  slack.calls.length = 0;
  const result = await syncLiveList({ snapshot: snapshot([changedA, b, c], b, c), state, channel: 'CTEST', api: slack.api, now });
  assert.equal(result.updated, 3);
  assert.equal(slack.count('chat.postMessage'), 0);
  assert.match(slack.messages.get(state.entries[b.id].ts).text, /Tagesdeal-Auswahl/);
});

await check('existing edit/feature/hide routes remain signed by deal ID', () => {
  const card = liveCard(a, snapshot([a]), now);
  const buttons = card.blocks.find(block => block.type === 'actions').elements;
  assert.equal(buttons.find(button => button.action_id === 'freefinder_remove_deal').text.text, 'Ausblenden');
  const edit = new URL(buttons.find(button => button.action_id === 'freefinder_edit_live_deal').url);
  assert.equal(edit.pathname, '/api/deals/admin/edit-link');
  assert.deepEqual(JSON.parse(Buffer.from(edit.searchParams.get('payload'), 'base64url')), { dealId: a.id });
  assert.match(edit.searchParams.get('sig'), /^[a-f0-9]{64}$/);
  const daily = new URL(buttons.find(button => button.action_id === 'freefinder_feature_daily').url);
  assert.equal(JSON.parse(Buffer.from(daily.searchParams.get('payload'), 'base64url')).kind, 'daily');
  assert.ok(!JSON.stringify(card).includes('offline-test-secret'));
});

await check('live and offline catalogue cards never become new community submissions', () => {
  const card = liveCard(a, snapshot([a]), now);
  for (const msg of [card, { text: '', blocks: card.blocks }, { text: card.text.replace(/\n/g, ' '), blocks: card.blocks },
    slack.messages.get(state.rootTs), { text: 'FreeFinder Live-Liste\nNicht mehr online\nDeal-ID: ' + a.id }]) {
    assert.equal(parseDigestDealMessage(msg), null);
    assert.deepEqual(extractDealsFromThreadMessages([msg], { pendingQueue: [a] }), []);
  }
});

await check('a confirmed empty feed archives cards rather than deleting messages', async () => {
  const result = await syncLiveList({ snapshot: snapshot([]), state, channel: 'CTEST', api: slack.api, now });
  assert.equal(result.liveCount, 0);
  assert.equal(result.archived, 3);
  assert.equal(slack.count('chat.delete'), 0);
});

await check('channel/workspace mismatch never creates another catalogue', async () => {
  await assert.rejects(syncLiveList({ snapshot: snapshot([a]), state, channel: 'COTHER', api: slack.api, now }), /another channel/);
  await assert.rejects(syncLiveList({ snapshot: snapshot([a]), state: { ...state, team: 'TOTHER' }, channel: 'CTEST', api: slack.api, now }), /workspace changed/);
  await assert.rejects(syncLiveList({ snapshot: snapshot([a]), state: { ...state, botUser: 'UOTHER' }, channel: 'CTEST', api: slack.api, now }), /original bot/);
});

await check('partial known failure keeps successful IDs and resumes without duplicate posts', async () => {
  const fake = mockSlack();
  const partial = fresh();
  let posts = 0;
  let checkpoint;
  const failing = async (method, body) => {
    if (method === 'chat.postMessage' && ++posts === 3) throw Object.assign(new Error('rejected'), { definitelyRejected: true });
    return fake.api(method, body);
  };
  await assert.rejects(syncLiveList({ snapshot: snapshot([a, b]), state: partial, channel: 'CTEST', api: failing,
    save: value => { checkpoint = structuredClone(value); }, now }), /rejected/);
  assert.ok(checkpoint.rootTs && checkpoint.entries[a.id]);
  assert.ok(!checkpoint.pendingPost);
  const result = await syncLiveList({ snapshot: snapshot([a, b]), state: checkpoint, channel: 'CTEST', api: fake.api, now });
  assert.equal(result.created, 1);
  assert.equal(fake.count('chat.postMessage'), 3);
});

await check('ambiguous accepted-or-lost post blocks automatic resend', async () => {
  const partial = fresh();
  const fake = mockSlack();
  let checkpoint;
  const fail = (method, payload) => method === 'chat.postMessage' ? Promise.reject(new Error('network timeout')) : fake.api(method, payload);
  await assert.rejects(syncLiveList({ snapshot: snapshot([a]), state: partial, channel: 'CTEST', api: fail,
    save: value => { checkpoint = structuredClone(value); }, now }), /network timeout/);
  assert.ok(checkpoint.pendingPost.clientMsgId);
  await assert.rejects(syncLiveList({ snapshot: snapshot([a]), state: checkpoint, channel: 'CTEST', api: fake.api, now }), /ambiguous/);
  assert.equal(fake.count('chat.postMessage'), 0);
});

await check('missing existing message fails safely without posting a replacement', async () => {
  const fake = mockSlack();
  const known = { ...fresh(), rootTs: '1793810000.999999' };
  await assert.rejects(syncLiveList({ snapshot: snapshot([]), state: known, channel: 'CTEST', api: fake.api, now }), /unknown message/);
  assert.equal(fake.count('chat.postMessage'), 0);
});

await check('missing pin permission is reported without changing app permissions', async () => {
  const fake = mockSlack({ pinError: 'missing_scope' });
  const result = await syncLiveList({ snapshot: snapshot([a]), state: fresh(), channel: 'CTEST', api: fake.api, now });
  assert.equal(result.pin.status, 'manual-pin-needed');
  assert.equal(fake.count('pins.add'), 1);
});

await check('Slack throttling honors Retry-After and remains bounded', async () => {
  const waits = [];
  let calls = 0;
  const client = slackClient({ token: 'offline-only', spacingMs: 0, wait: async ms => { waits.push(ms); }, fetcher: async () => {
    calls++;
    if (calls < 3) return { status: 429, headers: new Headers({ 'Retry-After': '2' }) };
    return { ok: true, status: 200, json: async () => ({ ok: true }) };
  } });
  await client('chat.update', {});
  assert.deepEqual(waits, [2000, 2000]);
  assert.equal(calls, 3);
  const exhausted = slackClient({ token: 'offline-only', spacingMs: 0, wait: async () => {}, fetcher: async () => ({ status: 429, headers: new Headers({ 'Retry-After': '999' }) }) });
  await assert.rejects(exhausted('chat.postMessage', {}), error => error.definitelyRejected === true);
});

await check('Slack network failures are not blindly retried', async () => {
  let calls = 0;
  const client = slackClient({ token: 'offline-only', spacingMs: 0, fetcher: async () => { calls++; throw new Error('ambiguous network failure'); } });
  await assert.rejects(client('chat.postMessage', {}), /ambiguous/);
  assert.equal(calls, 1);
});

const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'ff-slack-list-'));
try {
  fs.mkdirSync(path.join(temp, 'docs'));
  const expected = docs([a, b], a, b);
  for (const [name, value] of Object.entries(expected)) fs.writeFileSync(path.join(temp, 'docs', name), JSON.stringify(value));
  await check('only matching public/main snapshots can update Slack', async () => {
    const paths = [];
    const captured = await publishedSnapshot({ root: temp, attempts: 1, fetcher: async url => {
      paths.push(url);
      return { ok: true, json: async () => structuredClone(expected[new URL(url).pathname.slice(1)]) };
    } });
    assert.equal(captured.feed.deals.length, 2);
    assert.ok(paths.every(url => url.startsWith('https://freefinder.at/')));
    let waits = 0;
    const deferred = await publishedSnapshot({ root: temp, attempts: 2, wait: async () => { waits++; },
      fetcher: async url => ({ ok: true, json: async () => new URL(url).pathname === '/deals.json' ? docs([])['deals.json'] : expected[new URL(url).pathname.slice(1)] }) });
    assert.equal(deferred, null);
    assert.equal(waits, 1);
    await assert.rejects(publishedSnapshot({ root: temp, attempts: 1, fetcher: async () => ({ ok: false, status: 503 }) }), /503/);
  });
  await check('corrupt state is never treated as an empty new catalogue', () => {
    const file = path.join(temp, 'state.json');
    assert.deepEqual(loadListState(file), fresh());
    fs.writeFileSync(file, '{broken');
    assert.throws(() => loadListState(file));
    fs.writeFileSync(file, JSON.stringify({ version: 1, rootTs: 'bad', entries: {} }));
    assert.throws(() => loadListState(file), /timestamp/);
  });
} finally { fs.rmSync(temp, { recursive: true, force: true }); }

await check('large indexes fail before any Slack post; labels cannot inject mentions', async () => {
  const huge = snapshot(Array.from({ length: 400 }, (_, i) => ({ ...a, id: 'many-' + i, brand: 'x'.repeat(180), title: 'y'.repeat(500) })));
  const fake = mockSlack();
  await assert.rejects(syncLiveList({ snapshot: huge, state: fresh(), channel: 'CTEST', api: fake.api, now }), /block limit/);
  assert.equal(fake.count('chat.postMessage'), 0);
  const header = listHeader({ ...state, entries: { ...state.entries, [a.id]: { ts: '1793810000.000002' } } },
    snapshot([{ ...a, brand: '<!channel>|other' }]), now);
  assert.ok(!JSON.stringify(header).includes('<!channel>'));
  assert.ok(!liveCard({ ...a, brand: '<!channel>' }, snapshot([a]), now).text.includes('<!channel>'));
});

await check('workflow persists only Slack identities, uses public confirmation, and keeps secrets out of tests', () => {
  const workflow = fs.readFileSync(new URL('../.github/workflows/slack-live-deal-list.yml', import.meta.url), 'utf8');
  assert.match(workflow, /pages-build-deployment/);
  assert.match(workflow, /head_repository\.full_name == github\.repository/);
  assert.match(workflow, /cancel-in-progress: false/);
  assert.match(workflow, /if: always\(\)/);
  assert.match(workflow, /--files reviews\/slack-live-deal-list-state\.json/);
  assert.ok(!workflow.includes('npm ci') && !workflow.includes('wrangler') && !workflow.includes('OPENAI_API_KEY'));
  const testStep = workflow.slice(workflow.indexOf('- name: Test catalogue'), workflow.indexOf('- name: Synchronize'));
  assert.ok(!testStep.includes('secrets.'));
});

console.log('Slack live-deal list: ' + checks + ' offline checks passed. No live messages sent.');

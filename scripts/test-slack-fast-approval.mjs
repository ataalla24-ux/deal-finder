import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createHmac } from 'node:crypto';
import worker from '../referrals-worker/src/index.js';

const env = { SLACK_SIGNING_SECRET: 'test-signing', SLACK_CHANNEL_ID: 'C_TEST', GITHUB_WORKFLOW_TOKEN: 'test-token' };
function request(overrides = {}, signature = true) {
  const body = JSON.stringify({ type: 'event_callback', event: {
    type: 'reaction_added', reaction: 'white_check_mark', user: 'U_TEST',
    item: { channel: 'C_TEST', ts: '123.456' }, ...overrides,
  } });
  const timestamp = String(Math.floor(Date.now() / 1000));
  return new Request('https://example.test/api/slack/events', { method: 'POST', body, headers: {
    'x-slack-request-timestamp': timestamp,
    'x-slack-signature': signature ? `v0=${createHmac('sha256', env.SLACK_SIGNING_SECRET).update(`v0:${timestamp}:${body}`).digest('hex')}` : 'bad',
  } });
}
const originalFetch = globalThis.fetch;
const calls = [];
try {
  globalThis.fetch = async (url, init) => {
    calls.push({ url: String(url), body: JSON.parse(init.body) });
    return new Response(null, { status: 204 });
  };
  const ok = await worker.fetch(request(), env);
  assert.equal(ok.status, 200);
  assert.equal((await ok.json()).approveTriggered, true);
  assert.equal(calls.length, 1);
  assert.match(calls[0].url, /approve-deals.yml\/dispatches$/);
  assert.equal(calls[0].body.inputs.message_ts, '123.456');
  assert.equal(calls[0].body.inputs.reaction_user, 'U_TEST');
  assert.equal((await worker.fetch(request({}, false), env)).status, 401);
  await worker.fetch(request({ item: { channel: 'C_OTHER', ts: '123.456' } }), env);
  await worker.fetch(request({ reaction: 'eyes' }), env);
  assert.equal(calls.length, 1, 'invalid or unrelated events never dispatch');
  globalThis.fetch = async () => new Response('Temporary error', { status: 503 });
  const failed = await worker.fetch(request(), env);
  assert.equal(failed.status, 503, 'Slack must retry failed dispatches rather than silently losing approvals');
} finally { globalThis.fetch = originalFetch; }

const workflow = fs.readFileSync(new URL('../.github/workflows/approve-deals.yml', import.meta.url), 'utf8');
for (const key of ['MAX_LIVE_URL_HEALTH_CHECKS', 'MAX_LIVE_URL_EXPIRY_REFRESHES', 'MAX_LIVE_CONTENT_ENRICHMENTS']) {
  assert.match(workflow, new RegExp(`${key}: '0'`), 'whole-feed network work must not delay an approval');
}
assert.match(workflow, /node scraper\/slack-approve.js/, 'per-deal validation is preserved');
assert.match(workflow, /node scripts\/apply-live-deal-edits.mjs/, 'manual corrections remain authoritative');
assert.match(workflow, /ALLOW_AUTOMATED_LIVE_REMOVALS: '0'/);
assert.match(workflow, /group: deal-state-writer[\s\S]*cancel-in-progress: false[\s\S]*queue: max/);
console.log('Fast approval dispatch and workflow safeguards passed');

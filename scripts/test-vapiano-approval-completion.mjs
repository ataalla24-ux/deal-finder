import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync, mkdtempSync, mkdirSync, writeFileSync, rmSync, cpSync, copyFileSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { load } from 'cheerio';
import { isSupportedIamstudentApprovalUrl, extractIamstudentApprovalSourceEvidence, prepareIamstudentApprovalCopy, iamstudentApprovalDateHold } from '../scraper/approval-iamstudent-source-evidence.js';

const url = 'https://www.iamstudent.at/g/vapiano-gutschein-mit-50-prozent-studentenrabatt-gsh-wise26';
const html = readFileSync(new URL('./fixtures/iamstudent-vapiano-20261114.html', import.meta.url), 'utf8');
test('actual legacy checked voucher publishes with current evidence, unknown end and only a verified venue', async () => {
  const root = fileURLToPath(new URL('../', import.meta.url));
  const temp = mkdtempSync(join(tmpdir(), 'iamstudent-approval-runner-'));
  const previousFetch = globalThis.fetch;
  const previousEnv = { ...process.env };
  const previousLog = console.log;
  const logs = [];
  const write = (file, value) => writeFileSync(join(temp, 'docs', file), JSON.stringify(value));
  const read = file => JSON.parse(readFileSync(join(temp, 'docs', file), 'utf8'));
  try {
    for (const dir of ['scraper', 'sentry']) cpSync(join(root, dir), join(temp, dir), { recursive: true });
    mkdirSync(join(temp, 'scripts'));
    for (const file of ['deal-map-review.mjs', 'deal-map-enrichment.mjs', 'deal-map-chain-rules.mjs',
      'deal-map-source-addresses.mjs', 'approval-map-readiness.mjs', 'discover-vienna-merchants.mjs',
      'automatic-deal-maintenance.mjs', 'automatic-maintenance-review.mjs', 'refresh-maintenance-evidence.mjs',
      'deal-photo-contract.mjs']) copyFileSync(join(root, 'scripts', file), join(temp, 'scripts', file));
    copyFileSync(join(root, 'package.json'), join(temp, 'package.json'));
    symlinkSync(join(root, 'node_modules'), join(temp, 'node_modules'), 'dir');
    mkdirSync(join(temp, 'docs')); mkdirSync(join(temp, 'reviews'));
    for (const file of ['restaurant-coupon-documents.json', 'nordsee-coupon-cards-20261113.json'])
      copyFileSync(join(root, 'reviews', file), join(temp, 'reviews', file));
    writeFileSync(join(temp, 'reviews/automatic-maintenance-policy.json'), JSON.stringify({ version: 1, enabled: true, maxAiCandidatesPerRun: 4 }));
    Object.assign(process.env, { SENTRY_DISABLED: '1', SLACK_BOT_TOKEN: 'test-only', SLACK_CHANNEL_ID: 'C_TEST',
      APPROVE_SLACK_CHANNEL_ID: 'C_TEST', APPROVAL_REQUIRE_MAP: '1', APPROVAL_SOURCE_COPY_REVIEW: '1',
      APPROVAL_COPY_CACHE_ONLY: '1', OPENAI_API_KEY: 'test-only-no-provider-calls',
      APPROVAL_MAP_GEOCODE_REQUESTS: '0', APPROVAL_MAP_SOURCE_REQUESTS: '0',
      APPROVE_FULL_SCAN_MAX_THREADS: '1', APPROVE_FULL_SCAN_MAX_DEALS: '1' });
    for (const key of ['COMMUNITY_QUEUE_PATH', 'APPROVE_SLACK_REACTION', 'APPROVE_SLACK_REACTION_USER']) delete process.env[key];
    const ts = Math.floor(Date.now() / 1000);
    const source = { ...JSON.parse(readFileSync(new URL('./fixtures/approved-vapiano-legacy-20261114.json', import.meta.url), 'utf8')),
      approvalBlock: { checkedAt: new Date().toISOString(), reasons: ['Angebotsbeleg ausstehend'] } };
    for (const file of ['map-addresses.json', 'map-location-catalog.json', 'map-geocode-cache.json'])
      copyFileSync(join(root, 'reviews', file), join(temp, 'reviews', file));
    write('deal-map-locations.json', { locations: [] });
    const reactions = [{ name: 'white_check_mark', users: ['U_REVIEWER'] }];
    const message = { ts: source.slackTs, thread_ts: source.slackThreadTs, user: 'BOT', text: 'fixture', reactions };
    let sourceRequests = 0, modelCalls = 0;
    globalThis.fetch = async (target, init = {}) => {
      const parsed = new URL(target);
      if (target === url) { sourceRequests++; assert.equal(init.redirect, 'manual');
        return new Response(html, { headers: { 'content-type': 'text/html' } }); }
      if (parsed.hostname !== 'slack.com') { modelCalls++; throw Error('Unexpected external request'); }
      if (parsed.pathname.endsWith('/auth.test')) return Response.json({ ok: true, user_id: 'BOT' });
      if (parsed.pathname.endsWith('/conversations.history')) return Response.json({ ok: true, messages: [] });
      if (parsed.pathname.endsWith('/conversations.replies')) return Response.json({ ok: true, messages: [message] });
      if (parsed.pathname.endsWith('/reactions.get')) return Response.json({ ok: true, message });
      if (/\/chat\.(?:postMessage|update)$/.test(parsed.pathname)) return Response.json({ ok: true, ts: 'mock-notice' });
      throw Error('Unexpected mocked Slack operation');
    };
    console.log = (...args) => logs.push(args.map(String).join(' '));
    for (const mode of ['targeted', 'ordinary']) {
      if (mode === 'targeted') process.env.APPROVE_SLACK_MESSAGE_TS = source.slackTs;
      else delete process.env.APPROVE_SLACK_MESSAGE_TS;
      const { main } = await import(`${pathToFileURL(join(temp, 'scraper/slack-approve.js'))}?iamstudent-${mode}`);
      {
        sourceRequests = 0; modelCalls = 0; logs.length = 0;
        const candidate = source;
        write('deals.json', { deals: [], totalDeals: 0 });
        write('deals-pending-all.json', { deals: [candidate] });
        write('deal-review-feedback.json', { events: [] });
        await main();
        assert.equal(sourceRequests, 1, `${mode}: one reused source GET`);
        assert.equal(modelCalls, 0, `${mode}: no model or other provider call`);
        assert.ok(logs.some(line => line.startsWith('IAMSTUDENT source copy prepared:')), `${mode}: fixed copy really prepared`);
        const [live] = read('deals.json').deals;
        assert.ok(live, `${mode}: actual old approved record publishes: ${logs.join(' | ')}`);
        assert.equal(live.approvalPublicationMode, 'two-stage-v1');
        assert.equal(live.enrichmentPending, false);
        assert.deepEqual(live.enrichmentFields, []);
        assert.equal(live.pipelineLifecycle.stage, 'published');
        assert.equal(live.address, 'Herrengasse 6-8, 1010 Wien');
        assert.match(live.description, /30 Tagen/);
        assert.match(live.description, /außer Linz/);
        assert.ok(!live.validUntil && !/20\d{2}/.test(live.expires || ''), `unsupported calendar end is not invented: ${live.validUntil} ${live.expires}`);
        assert.equal(read('deals-pending-all.json').deals.length, 0);
        const pins = read('deal-map-locations.json').locations.filter(pin => pin.dealIds.includes(live.id));
        assert.equal(pins.length, 1);
        assert.equal(pins[0].latitude, 48.2091258);
        assert.equal(pins[0].longitude, 16.3666201);

      }
    }
  } finally {
    globalThis.fetch = previousFetch; console.log = previousLog;
    for (const key of Object.keys(process.env)) if (!(key in previousEnv)) delete process.env[key];
    Object.assign(process.env, previousEnv);
    rmSync(temp, { recursive: true, force: true });
  }
});

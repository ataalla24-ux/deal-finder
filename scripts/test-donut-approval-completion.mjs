import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync, mkdtempSync, mkdirSync, writeFileSync, rmSync, cpSync, copyFileSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';


const url = 'https://www.preisjaeger.at/deals/mcdonalds-gratis-fussball-donut-zum-osterreich-match-372365';
const html = readFileSync(new URL('./fixtures/preisjaeger-donut-dom-20261114.html', import.meta.url), 'utf8');
test('actual checked Donut publishes its confirmed terms and deadline before a missing map is filled', async () => {
  const root = fileURLToPath(new URL('../', import.meta.url));
  const temp = mkdtempSync(join(tmpdir(), 'donut-approval-runner-'));
  const PreviousDate = globalThis.Date;
  const fixedNow = PreviousDate.parse('2026-11-14T14:00:00.000Z');
  globalThis.Date = class extends PreviousDate { constructor(...args) { super(...(args.length ? args : [fixedNow])); } static now() { return fixedNow; } };
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
    const source = { ...JSON.parse(readFileSync(new URL('./fixtures/approved-donut-legacy-20261114.json', import.meta.url), 'utf8')),
      approvalBlock: { checkedAt: new Date().toISOString(), reasons: ['Angebotsbeleg ausstehend'] } };
    for (const file of ['map-addresses.json', 'map-location-catalog.json', 'map-geocode-cache.json'])
      copyFileSync(join(root, 'reviews', file), join(temp, 'reviews', file));
    write('deal-map-locations.json', { locations: [] });
    const reactions = [{ name: 'white_check_mark', users: ['U_REVIEWER'] }];
    const message = { ts: source.slackTs, thread_ts: source.slackThreadTs, user: 'BOT', text: 'fixture', reactions };
    let sourceRequests = 0, modelCalls = 0;
    globalThis.fetch = async (target, init = {}) => {
      const parsed = new URL(target);
      if (target === url) { sourceRequests++; assert.equal(init.redirect, 'follow');
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
    for (const mode of ['targeted', 'ordinary']) for (const review of ['1', '0']) {
      process.env.APPROVAL_SOURCE_COPY_REVIEW = review;
      if (mode === 'targeted') process.env.APPROVE_SLACK_MESSAGE_TS = source.slackTs;
      else delete process.env.APPROVE_SLACK_MESSAGE_TS;
      const { main } = await import(`${pathToFileURL(join(temp, 'scraper/slack-approve.js'))}?donut-${mode}-${review}`);
      {
        sourceRequests = 0; modelCalls = 0; logs.length = 0;
        const candidate = source;
        write('deals.json', { deals: [], totalDeals: 0 });
        write('deals-pending-all.json', { deals: [candidate] });
        write('deal-review-feedback.json', { events: [] });
        await main();
        assert.equal(sourceRequests, 1, `${mode}: one reused source GET`);
        assert.equal(modelCalls, 0, `${mode}: no model or other provider call`);
        assert.ok(logs.some(line => line.includes('source copy prepared:')), `${mode}: fixed copy really prepared: ${logs.join(" | ")}`);
        const [live] = read('deals.json').deals;
        assert.ok(live, `${mode}: actual old approved record publishes: ${logs.join(' | ')}`);
        assert.equal(live.approvalPublicationMode, 'two-stage-v1');
        assert.equal(live.enrichmentPending, true);
        assert.deepEqual(live.enrichmentFields, ['map']);
        assert.equal(live.pipelineLifecycle.stage, 'published');
        assert.equal(live.distance, 'Wien · Standort folgt');
        assert.ok(!live.address);
        assert.match(live.title, /Donut.*App/);
        assert.match(live.description, /17\.11\.2026/);
        assert.match(live.description, /McDelivery/);
        assert.equal(live.validFrom, '2026-11-14');
        assert.equal(live.validUntil, '2026-11-17');
        assert.equal(read('deals-pending-all.json').deals.length, 0);
        const pins = read('deal-map-locations.json').locations.filter(pin => pin.dealIds.includes(live.id));
        assert.equal(pins.length, 0);
        assert.ok(read('deal-map-locations.json').geocodingExclusions.some(entry => entry.dealId === live.id));


      }
    }
  } finally {
    globalThis.Date = PreviousDate; globalThis.fetch = previousFetch; console.log = previousLog;
    for (const key of Object.keys(process.env)) if (!(key in previousEnv)) delete process.env[key];
    Object.assign(process.env, previousEnv);
    rmSync(temp, { recursive: true, force: true });
  }
});

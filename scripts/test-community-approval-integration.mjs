import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'community-approval-test-'));
const previousFetch = globalThis.fetch;
const previousEnv = { ...process.env };
const write = (file, value) => fs.writeFileSync(path.join(temp, 'docs', file), JSON.stringify(value));
const read = file => JSON.parse(fs.readFileSync(path.join(temp, 'docs', file), 'utf8'));
try {
  for (const dir of ['scraper', 'sentry']) fs.cpSync(path.join(root, dir), path.join(temp, dir), { recursive: true });
  fs.mkdirSync(path.join(temp, 'scripts'));
  for (const file of ['deal-map-review.mjs', 'deal-map-enrichment.mjs', 'deal-map-chain-rules.mjs', 'approval-map-readiness.mjs']) {
    fs.copyFileSync(path.join(root, 'scripts', file), path.join(temp, 'scripts', file));
  }
  fs.copyFileSync(path.join(root, 'package.json'), path.join(temp, 'package.json'));
  fs.symlinkSync(path.join(root, 'node_modules'), path.join(temp, 'node_modules'), 'dir');
  fs.mkdirSync(path.join(temp, 'docs'));
  fs.mkdirSync(path.join(temp, 'reviews'));
  // Approval imports the reviewed coupon catalogue even for non-coupon deals.
  fs.copyFileSync(path.join(root, 'reviews/restaurant-coupon-documents.json'),
    path.join(temp, 'reviews/restaurant-coupon-documents.json'));
  process.env.SENTRY_DISABLED = '1';
  process.env.SLACK_BOT_TOKEN = 'test-only';
  process.env.SLACK_CHANNEL_ID = 'C_TEST';
  process.env.APPROVE_SLACK_CHANNEL_ID = 'C_TEST';
  process.env.APPROVE_SLACK_MESSAGE_TS = '1791203010.645859';
  delete process.env.APPROVE_SLACK_REACTION;
  delete process.env.APPROVE_SLACK_REACTION_USER;
  const source = {
    id: 'community:integration', submissionId: 'integration', originSource: 'community-submission',
    title: '3 Döner zum Preis von 2', brand: 'Pizza Rando', source: 'Community Submission',
    description: 'Beim Kauf von 2 Dönern den dritten gratis.',
    url: 'https://www.tiktok.com/@pizzarando', address: 'Dresdnerstraße 115, 1200 Wien',
    distance: 'Dresdnerstraße 115, 1200 Wien', submittedAt: new Date().toISOString(),
    slackTs: '1791203010.645859', slackThreadTs: '1791203007.871219',
  };
  let reactions = [{ name: 'white_check_mark', users: ['U_REVIEWER'] }];
  let repliesAllowed = true;
  let message = { ts: source.slackTs, thread_ts: source.slackThreadTs, user: 'BOT', text: 'fixture' };
  const notices = [];
  globalThis.fetch = async (url, init = {}) => {
    const target = new URL(url);
    if (target.hostname !== 'slack.com') return new Response('Forbidden', { status: 403 });
    if (target.pathname.endsWith('/auth.test')) return Response.json({ ok: true, user_id: 'BOT' });
    if (target.pathname.endsWith('/conversations.replies')) return Response.json(repliesAllowed
      ? { ok: true, messages: [message] } : { ok: false, error: 'missing_scope' });
    if (target.pathname.endsWith('/reactions.get')) return Response.json({ ok: true, message: { ...message, reactions } });
    if (/\/chat\.(?:postMessage|update)$/.test(target.pathname)) {
      notices.push(JSON.parse(init.body));
      return Response.json({ ok: true, ts: 'notice-ts' });
    }
    throw new Error(`Unexpected request: ${url}`);
  };
  const { main } = await import(pathToFileURL(path.join(temp, 'scraper/slack-approve.js')));
  const { buildSlackMessage } = await import(pathToFileURL(path.join(temp, 'scraper/slack-notify.js')));
  write('deals.json', { deals: [], totalDeals: 0 });
  write('deals-pending-all.json', { deals: [source] });
  await main();
  assert.equal(read('deals.json').deals.length, 0);
  assert.equal(read('deals-pending-all.json').deals.length, 1, 'blocked deal stays editable');
  assert.ok(read('deals-pending-all.json').deals[0].approvalBlock);
  assert.equal(notices.length, 1);
  assert.equal(fs.existsSync(path.join(temp, 'docs/deal-review-feedback.json')), false, 'no public community review feedback');
  await main();
  assert.equal(notices.length, 1, 'retries do not repeat identical notices');

  const nextMonth = new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10);
  const edited = read('deals-pending-all.json').deals[0];
  edited.expires = nextMonth;
  edited.validUntil = nextMonth;
  const literalDay = nextMonth.split('-').reverse().join('.');
  edited.expiresOriginal = `${literalDay}, 12:00 bis ${literalDay}, 15:00 Uhr`;
  edited.expirySource = 'slack.human-review';
  write('deals-pending-all.json', { deals: [edited] });
  process.env.APPROVAL_REQUIRE_MAP = '1';
  process.env.APPROVAL_MAP_GEOCODE_REQUESTS = '0';
  await main();
  assert.equal(read('deals.json').deals.length, 0, 'a human approval without a map location stays pending');
  assert.match(read('deals-pending-all.json').deals[0].approvalBlock.reasons.join(' '), /Kartenstandort fehlt/);
  write('deal-map-locations.json', { locations: [{ id: 'reviewed-branch', name: source.brand,
    address: source.address, latitude: 48.232, longitude: 16.386, confidence: 1,
    source: 'official-fixture', dealIds: [source.id] }] });
  await main();
  assert.equal(read('deals.json').deals.length, 1, 'a corrected blocked approval can publish');
  assert.equal(read('deals-pending-all.json').deals.length, 0);
  assert.equal(read('deals.json').deals[0].approvalBlock, undefined);
  const livePeriod = read('deals.json').deals[0];
  assert.equal(livePeriod.expiryKind, 'single');
  assert.equal(livePeriod.validOn, nextMonth);
  assert.equal(livePeriod.validFrom, nextMonth);
  assert.equal(livePeriod.validUntil, nextMonth);
  assert.equal(livePeriod.expiresOriginal, edited.expiresOriginal);
  assert.equal(new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Vienna', hour: '2-digit', minute: '2-digit' }).format(new Date(livePeriod.expires)), '15:00');
  assert.equal(fs.existsSync(path.join(temp, 'docs/deal-review-feedback.json')), false);
  assert.match(notices.at(-1).text, /Prüfung bestanden/, 'resolved failures must not leave a stale blocking notice');

  // A deleted/expired private queue entry must not be recovered from Slack.
  const recoverable = { ...source, expires: nextMonth, validUntil: nextMonth, expiresOriginal: nextMonth };
  write('deal-review-feedback.json', { events: [{ dealId: source.id, slackTs: source.slackTs,
    slackThreadTs: source.slackThreadTs, originSource: source.originSource }] });
  write('deals.json', { deals: [], totalDeals: 0 });
  write('deals-pending-community.json', { deals: [recoverable] });
  message.text = '*Community-Einreichung – noch nicht geprüft*\n' + buildSlackMessage(recoverable, 1);
  message.blocks = [{ type: 'section', text: { type: 'mrkdwn', text: message.text } }];
  message.text = message.text.replace(/\n/g, ' ');
  repliesAllowed = false;
  await main();
  assert.equal(read('deals.json').deals.length, 0, 'private queue entry is required');
  const published = read('deals.json');
  await main();
  assert.deepEqual(read('deals.json'), published, 'repeated approval must not duplicate or refresh the live deal');

  reactions = [{ name: 'x', users: ['U_REVIEWER'] }];
  write('deals.json', { deals: [], totalDeals: 0 });
  write('deals-pending-all.json', { deals: [recoverable] });
  await main();
  assert.equal(read('deals.json').deals.length, 0);
  assert.equal(read('deals-pending-all.json').deals.length, 0, 'manual rejection still removes the candidate');
  console.log('Isolated approval workflow: block, retain, notify, edit, approve, recover, deduplicate and reject passed');
} finally {
  globalThis.fetch = previousFetch;
  for (const key of Object.keys(process.env)) if (!(key in previousEnv)) delete process.env[key];
  Object.assign(process.env, previousEnv);
  fs.rmSync(temp, { recursive: true, force: true });
}

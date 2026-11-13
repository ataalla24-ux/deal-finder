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
  for (const file of ['deal-map-review.mjs', 'deal-map-enrichment.mjs', 'deal-map-chain-rules.mjs',
    'deal-map-source-addresses.mjs', 'approval-map-readiness.mjs', 'discover-vienna-merchants.mjs',
    'automatic-deal-maintenance.mjs', 'automatic-maintenance-review.mjs', 'refresh-maintenance-evidence.mjs',
    'deal-photo-contract.mjs']) {
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
    if (target.pathname.endsWith('/conversations.history')) return Response.json({ ok: true, messages: [] });
    if (target.pathname.endsWith('/conversations.replies')) return Response.json(repliesAllowed
      ? { ok: true, messages: [message] } : { ok: false, error: 'missing_scope' });
    if (target.pathname.endsWith('/reactions.get')) return Response.json({ ok: true, message: { ...message, reactions } });
    if (/\/chat\.(?:postMessage|update)$/.test(target.pathname)) {
      notices.push(JSON.parse(init.body));
      return Response.json({ ok: true, ts: 'notice-ts' });
    }
    throw new Error(`Unexpected request: ${url}`);
  };
  const { main, validateApprovalCandidates } = await import(pathToFileURL(path.join(temp, 'scraper/slack-approve.js')));
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
  assert.match(notices.at(-1).text, /Freigabe-Häkchen kann gesetzt bleiben/);
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(temp, 'reviews/map-source-address-cache.json'))), {},
    'private submissions must not create public source cache entries');
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(temp, 'reviews/approval-map-readiness.json'))).checks, {},
    'private submission IDs and location diagnostics must stay out of the public report');
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

  // An old hold gets a slot even with a newer thread and cannot publish on a
  // stale cached reaction. It may publish on a later scan with no new event.
  const currentTs = Math.floor(Date.now() / 1000);
  write('deals-pending-all.json', { deals: [edited, { ...recoverable, id: 'newer', slackTs: `${currentTs}.645859`,
    slackThreadTs: `${currentTs - 3}.871219` }] });
  message = { ts: source.slackTs, thread_ts: source.slackThreadTs, user: 'BOT', text: 'fixture',
    reactions: [{ name: 'white_check_mark', users: ['U_REVIEWER'] }] };
  repliesAllowed = true;
  delete process.env.APPROVE_SLACK_MESSAGE_TS;
  process.env.APPROVE_FULL_SCAN_MAX_THREADS = '1';
  process.env.APPROVE_FULL_SCAN_MAX_DEALS = '1';
  const { main: scheduled } = await import(`${pathToFileURL(path.join(temp, 'scraper/slack-approve.js'))}?scheduled`);
  // The prior snapshot `edited` had a date-related hold; give it the actual
  // map block from the same workflow before checking the retry behavior.
  const pending = read('deals-pending-all.json');
  pending.deals[0].approvalBlock.reasons = ['Kartenstandort fehlt (request-budget): Test'];
  write('deals-pending-all.json', pending);
  reactions = [];
  await scheduled();
  assert.equal(read('deals.json').deals.length, 0, 'withdrawn reaction cannot publish despite the stale thread snapshot');
  reactions = [{ name: 'white_check_mark', users: ['U_REVIEWER'] }];
  await scheduled();
  assert.equal(read('deals.json').deals[0].id, source.id, 'a regular scan publishes the held deal when evidence and the reaction are present');
  assert.deepEqual(read('deals-pending-all.json').deals.map(row => row.id), ['newer']);

  const official = { id: 'official-cafe', title: 'Mega Deal: Pizza um 4,90 Euro bei Abholung', brand: 'Cafe Fixture',
    source: 'Merchant fixture', url: 'https://cafemorgen.at/angebote/pizza', metaGraphCaption: 'Pizza um 4,90 Euro bei Abholung.',
    validUntil: nextMonth, pipelineLifecycle: { manualDecision: 'approved' } };
  fs.writeFileSync(path.join(temp, 'reviews/automatic-maintenance-policy.json'), JSON.stringify({ version: 1, enabled: true, maxAiCandidatesPerRun: 4 }));
  process.env.APPROVAL_MAP_GEOCODE_REQUESTS = '1';
  process.env.APPROVAL_MAP_SOURCE_REQUESTS = '2';
  process.env.APPROVAL_SOURCE_COPY_REVIEW = '1';
  const restaurant = { '@type': 'Restaurant', name: official.brand, url: official.url, mainEntityOfPage: official.url,
    address: { '@type': 'PostalAddress', streetAddress: 'Wollzeile 29', postalCode: '1010', addressLocality: 'Wien' } };
  let modelCalls = 0;
  const finished = await validateApprovalCandidates([official], {
    inspectDealUrlHealth: async url => ({ ok: true, status: 200, finalUrl: url, dateHints: {}, contentHints: {} }),
    approvalFetchPage: async url => url.endsWith('/robots.txt') ? { url, status: 404 } : { url, status: 200,
      headers: { 'content-type': 'text/html' }, body: `<main><h1>${official.title}</h1><p>Dieses Angebot gilt bei Cafe Fixture, Wollzeile 29, 1010 Wien.</p><script type="application/ld+json">${JSON.stringify(restaurant)}</script></main>` },
    approvalGeocode: async () => ({ latitude: 48.21, longitude: 16.371, address: 'Wollzeile 29, 1010 Wien', source: 'official-fixture' }),
    approvalModelRequest: async () => Response.json({ choices: [{ finish_reason: 'stop', message: { content: JSON.stringify(++modelCalls === 1 ? {
      title: 'Pizza für 4,90 € bei Abholung', quote: official.metaGraphCaption,
      description: 'Bei Abholung kostet die Pizza 4,90 Euro.', conditionsQuote: official.metaGraphCaption, dateQuote: '',
    } : { supported: true }) } }] }),
  });
  assert.equal(modelCalls, 2);
  assert.equal(finished.allowedDeals[0]?.title, 'Pizza für 4,90 € bei Abholung', JSON.stringify(finished.results));
  assert.equal(finished.allowedDeals[0].description, 'Bei Abholung kostet die Pizza 4,90 Euro.');
  assert.equal(finished.allowedDeals[0].address, 'Wollzeile 29, 1010 Wien');
  assert.ok(read('deal-map-locations.json').locations.some(pin => pin.dealIds.includes(official.id)));
  console.log('Isolated approval workflow: block, retain, notify, edit, approve, deduplicate, reject and scheduled retry passed');
} finally {
  globalThis.fetch = previousFetch;
  for (const key of Object.keys(process.env)) if (!(key in previousEnv)) delete process.env[key];
  Object.assign(process.env, previousEnv);
  fs.rmSync(temp, { recursive: true, force: true });
}

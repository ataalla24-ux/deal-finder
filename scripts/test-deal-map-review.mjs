import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { loadDealMapReviewContext, reviewDealMap } from './deal-map-review.mjs';
import { inspectDealLocation, locationFingerprint } from './deal-map-enrichment.mjs';
import { parseDigestDealMessage } from '../scraper/slack-digest-utils.js';
import {
  buildSlackMessage, buildFirecrawlReviewMessage, buildSocialFoodReviewMessage, pendingEditBlocks,
} from '../scraper/slack-notify.js';

const root = fileURLToPath(new URL('../', import.meta.url));
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'deal-map-review-'));
const previousFetch = globalThis.fetch;
const previousEnv = { ...process.env };
const requests = [];
globalThis.fetch = async (...args) => { requests.push(args); throw new Error('Network forbidden in map review tests'); };
process.env.DEAL_REMOVE_LINK_SECRET = 'map-review-test-only';
process.env.SLACK_LIVE_REVIEW_DRY_RUN = '1';
process.env.SLACK_BOT_TOKEN = '';
process.env.SLACK_CHANNEL_ID = '';

const base = {
  id: 'map-review-local', brand: 'Test Cafe', title: 'Gratis Kaffee',
  description: 'Ein Kaffee gratis in Wien.', distance: 'Wien',
  url: 'https://example.com/coffee', category: 'kaffee', type: 'gratis',
  pubDate: '2026-10-10T08:00:00Z', validUntil: '2099-12-31',
};
const location = {
  id: 'verified-cafe', name: 'Test Cafe Braunhubergasse', address: 'Braunhubergasse 19, 1110 Wien',
  latitude: 48.17024, longitude: 16.41565, confidence: 1, source: 'test-fixture', dealIds: [base.id],
};
const empty = { map: { locations: [] }, reviewed: {}, today: '2026-10-10' };
const mapped = { ...empty, map: { locations: [location] } };
const addressDeal = { ...base, distance: location.address };
const online = { ...base, id: 'online', distance: 'Online', description: 'Online einloesen.' };
const delivery = { ...base, id: 'delivery', url: 'https://wolt.com/restaurant/test' };
const automaticLocation = { ...location, automaticDealIds: [base.id], validFrom: '2026-10-10', validUntil: '2026-10-10' };
const coverageRow = { id: base.id, status: 'mapped', fingerprint: locationFingerprint(base) };
const published = { ...empty, map: { locations: [automaticLocation] }, coverage: { deals: [coverageRow] } };
const scenarios = [
  [base, mapped, 'mapped'],
  [addressDeal, empty, 'address-ready'],
  [base, empty, 'needs-review'],
  [online, empty, 'online-only'],
  [delivery, empty, 'online-only'],
  [base, published, 'mapped'],
];
const snapshots = JSON.stringify({ base, location, scenarios });
const decode = button => JSON.parse(Buffer.from(new URL(button.url).searchParams.get('payload'), 'base64url'));

try {
  const { buildReviewCandidateMap, dealBlocks, offlineDealBlocks, prioritizeReviewCandidates } = await import('./slack-live-deal-review.mjs');
  for (const [deal, context, status] of scenarios) {
    const review = reviewDealMap(deal, context);
    assert.equal(review.status, status);
    assert.ok(review.text.startsWith(`INTERN Karte: [${status}]`));
    assert.match(review.text, /keine Freigabe-\/Entfernungsregel/);
    assert.equal(Boolean(review.reviewReason), ['address-ready', 'needs-review'].includes(status));
    if (status === 'address-ready') assert.match(review.text, /Geocoding noch nicht verifiziert/);
    if (status === 'online-only') assert.doesNotMatch(review.text, /Zuordnung fehlt|Adresse\/Filiale/);
    for (const builder of [buildSlackMessage, buildFirecrawlReviewMessage, buildSocialFoodReviewMessage]) {
      const message = builder(deal, 1, context);
      assert.ok(message.isWellFormed());
      assert.equal(message.split('\n').filter(line => line.startsWith('INTERN Karte:')).length, 1);
      const withoutMap = message.split('\n').filter(line => !line.startsWith('INTERN Karte:')).join('\n');
      const metadata = { ts: '1.001', thread_ts: '1.000' };
      const expected = parseDigestDealMessage({ ...metadata, text: withoutMap });
      assert.deepEqual(parseDigestDealMessage({ ...metadata, text: message }), expected,
        'Map context must not change any parsed/public field or approval input');
      const blocks = pendingEditBlocks(message);
      assert.deepEqual(blocks.filter(block => block.type === 'context').map(block => block.elements[0].text), [review.text]);
      assert.deepEqual(parseDigestDealMessage({ ...metadata, text: message.replace(/\n/g, ' '), blocks }), expected,
        'Block Kit recovery must also ignore internal map context');
      assert.deepEqual(decode(blocks.at(-1).elements[0]), { dealId: deal.id, scope: 'pending-edit' });
      assert.ok(blocks.filter(block => block.type === 'section').every(block => block.text.text.isWellFormed()));
    }
  }
  assert.equal(JSON.stringify({ base, location, scenarios }), snapshots, 'Inspection and Slack rendering never mutate deals or the map');
  assert.deepEqual(reviewDealMap(base, mapped).locationIds, [location.id]);
  assert.deepEqual(reviewDealMap(base, empty).locationIds, []);
  assert.match(reviewDealMap(base, empty).text, /Eine eindeutige Adresse mit Hausnummer fehlt/);
  assert.doesNotMatch(reviewDealMap(base, empty).text, /missing-exact-address/);
  assert.doesNotMatch(reviewDealMap(base, mapped).text, /existing-registry/);
  assert.doesNotMatch(reviewDealMap(addressDeal, mapped).text, /verified-address-reuse/);
  assert.deepEqual(reviewDealMap(addressDeal, empty).addresses, [{ street: 'Braunhubergasse', number: '19', postalCode: '1110' }]);
  assert.equal(inspectDealLocation(base, published).status, 'needs-review', 'Core inspection deliberately ignores automatic ID bindings without raw evidence');
  const publishedReview = reviewDealMap(base, published);
  assert.equal(publishedReview.status, 'mapped');
  assert.deepEqual(publishedReview.locationIds, [location.id]);
  assert.equal(publishedReview.reviewReason, '');
  assert.match(publishedReview.text, /unver\u00e4nderte Deal/);
  assert.doesNotMatch(publishedReview.text, /published-map-coverage/);
  assert.equal(buildReviewCandidateMap([], [base], published).size, 0, 'Current published coverage removes only the false map review reason');
  for (const coverage of [undefined, { deals: [] }, { deals: [{ ...coverageRow, fingerprint: 'stale' }] },
    { deals: [{ ...coverageRow, id: 'another-deal' }] }, { deals: [{ ...coverageRow, status: 'partially-mapped' }] }]) {
    assert.equal(reviewDealMap(base, { ...published, coverage }).status, 'needs-review');
  }
  assert.equal(reviewDealMap({ ...base, title: 'Anderes Angebot' }, published).status, 'needs-review', 'Edited deals cannot inherit stale coverage');
  assert.equal(reviewDealMap({ ...base, id: 'new-pending' }, published).status, 'needs-review', 'New pending deals still use core inspection');
  for (const change of [{ validUntil: '2026-10-09' }, { validFrom: '2026-10-11' }, { confidence: 0.5 },
    { latitude: 0 }, { source: '' }, { dealIds: [] }, { dealIds: [`prefix-${base.id}`] }, { id: '' }]) {
    assert.equal(reviewDealMap(base, { ...published, map: { locations: [{ ...automaticLocation, ...change }] } }).status, 'needs-review',
      `Published fallback requires an exact, current, verified location: ${JSON.stringify(change)}`);
  }
  assert.equal(reviewDealMap(base, { ...published, map: { locations: [] }, catalog: published.map }).status, 'needs-review',
    'A catalog association is not a published map binding');
  const expiredBranch = { [base.id]: { locations: [{ street: 'Braunhubergasse', number: '19', validUntil: '2026-10-09' }] } };
  assert.equal(reviewDealMap(base, { ...published, reviewed: expiredBranch }).status, 'needs-review',
    'Coverage cannot override the current reviewed-branch date guard');
  const onlinePublished = { ...published,
    map: { locations: [{ ...automaticLocation, dealIds: [online.id], automaticDealIds: [online.id] }] },
    coverage: { deals: [{ id: online.id, status: 'mapped', fingerprint: locationFingerprint(online) }] },
  };
  assert.equal(reviewDealMap(online, onlinePublished).status, 'online-only');

  const community = { ...addressDeal, id: 'community:map-test', originSource: 'community-submission', description: 'a'.repeat(2890) + '\ud83c\udf89 mehr' };
  const communityText = buildSlackMessage(community, 1, empty);
  for (const block of pendingEditBlocks(communityText).filter(block => block.type === 'section')) {
    assert.ok(block.text.text.isWellFormed());
    assert.ok(Array.from(block.text.text).length <= 2900);
  }
  assert.match(communityText, /\[address-ready\]/);
  delete process.env.DEAL_REMOVE_LINK_SECRET;
  assert.equal(pendingEditBlocks(buildSlackMessage(base, 1, empty)).at(-1).type, 'context',
    'Context is visible even when only the existing text-edit path is available');
  process.env.DEAL_REMOVE_LINK_SECRET = 'map-review-test-only';

  const originalCandidate = { id: base.id, reason: 'Datum pruefen', proposedPatch: { title: 'Neuer Titel' }, details: { confidence: 0.9 } };
  const candidateSnapshot = structuredClone(originalCandidate);
  const deals = [online, base, { ...addressDeal, id: 'address' }, delivery];
  const candidates = buildReviewCandidateMap([originalCandidate], deals, empty);
  assert.equal(candidates.size, 2, 'Only onsite/unknown missing map associations gain review reasons');
  const candidate = candidates.get(`id:${base.id}`);
  assert.match(candidate.reason, /^Datum pruefen \+ INTERN Karte:/);
  assert.deepEqual(candidate.proposedPatch, originalCandidate.proposedPatch);
  assert.deepEqual(originalCandidate, candidateSnapshot);
  assert.deepEqual(prioritizeReviewCandidates(deals, candidates).map(deal => deal.id), [base.id, 'address', 'online', 'delivery']);
  assert.equal(buildReviewCandidateMap([], [base], mapped).size, 0);
  const independentOnlineReview = buildReviewCandidateMap([{ id: online.id, reason: 'Datum pruefen' }], [online], empty);
  assert.equal(independentOnlineReview.get('id:online').reason, 'Datum pruefen', 'Online deals retain unrelated review reasons');

  const liveBlocks = dealBlocks(base, 0, candidate, empty);
  assert.match(liveBlocks[0].text.text, /Pr\u00fcfgrund: Datum pruefen \+ INTERN Karte:/);
  assert.equal(liveBlocks[1].type, 'context');
  const actions = liveBlocks.at(-1).elements;
  assert.deepEqual(actions, dealBlocks(base, 0, originalCandidate, mapped).at(-1).elements,
    'Map coverage cannot change edit, feature, or removal actions');
  assert.deepEqual(decode(actions.find(button => button.action_id === 'freefinder_edit_live_deal')), { dealId: base.id });
  assert.equal(decode(actions.find(button => button.action_id === 'freefinder_remove_deal')).reason, 'aus Slack Live-Review entfernt');
  assert.doesNotMatch(JSON.stringify(actions), /INTERN Karte|needs-review|address-ready/);
  assert.doesNotMatch(JSON.stringify(offlineDealBlocks(base, 0)), /INTERN Karte/);
  assert.ok(Array.from({ length: 12 }, (_, index) => dealBlocks(base, index, candidate, empty)).flat().length <= 50,
    'Maximum live-review chunk remains within Slack block limits');

  const missing = loadDealMapReviewContext({ root: temp, now: new Date('2026-10-09T22:30:00Z') });
  assert.equal(missing.today, '2026-10-10', 'Review dates use Vienna time');
  assert.equal(missing.mapAvailable, false);
  assert.match(reviewDealMap(base, missing).text, /Kartenregister nicht verf\u00fcgbar/);
  assert.equal(reviewDealMap(online, missing).reviewReason, '');
  fs.mkdirSync(path.join(temp, 'docs'));
  fs.mkdirSync(path.join(temp, 'reviews'));
  fs.mkdirSync(path.join(temp, 'scripts'));
  const write = (file, value) => fs.writeFileSync(path.join(temp, file), JSON.stringify(value));
  const coverageRoot = path.join(temp, 'coverage-fixture');
  fs.mkdirSync(path.join(coverageRoot, 'docs'), { recursive: true });
  fs.mkdirSync(path.join(coverageRoot, 'reviews'));
  write('coverage-fixture/docs/deal-map-locations.json', published.map);
  const loadCoverageFixture = () => loadDealMapReviewContext({ root: coverageRoot, now: new Date('2026-10-10T12:00:00Z') });
  assert.equal(reviewDealMap(base, loadCoverageFixture()).status, 'needs-review', 'Coverage report is optional in fixture directories');
  write('coverage-fixture/reviews/map-coverage.json', published.coverage);
  assert.equal(reviewDealMap(base, loadCoverageFixture()).status, 'mapped', 'Matching optional coverage is loaded from disk');
  const diskBefore = fs.readFileSync(path.join(coverageRoot, 'reviews/map-coverage.json'), 'utf8');
  assert.equal(reviewDealMap({ ...base, title: 'Edited' }, loadCoverageFixture()).status, 'needs-review');
  assert.equal(fs.readFileSync(path.join(coverageRoot, 'reviews/map-coverage.json'), 'utf8'), diskBefore);
  fs.writeFileSync(path.join(coverageRoot, 'reviews/map-coverage.json'), '{broken');
  assert.equal(reviewDealMap(base, loadCoverageFixture()).status, 'needs-review', 'Unreadable coverage falls back to core inspection');
  write('reviews/map-location-catalog.json', { locations: [location] });
  const catalogOnly = loadDealMapReviewContext({ root: temp });
  assert.equal(reviewDealMap(addressDeal, catalogOnly).status, 'mapped', 'Optional catalog is forwarded to inspection');
  write('docs/deal-map-locations.json', { locations: [] });
  write('reviews/map-addresses.json', { [base.id]: { locations: [{ street: 'Wollzeile', number: '29', postalCode: '1010' }] } });
  const reviewed = loadDealMapReviewContext({ root: temp });
  assert.equal(reviewed.mapAvailable, true);
  assert.equal(reviewDealMap(base, reviewed).addresses[0].street, 'Wollzeile');
  assert.equal(reviewDealMap(base, reviewed).status, 'address-ready');
  fs.writeFileSync(path.join(temp, 'docs/deal-map-locations.json'), '{broken');
  assert.equal(loadDealMapReviewContext({ root: temp }).mapAvailable, false);

  // Exercise the actual CLI only in a throwaway fixture with dry-run forced.
  for (const file of ['slack-live-deal-review.mjs', 'deal-map-review.mjs', 'deal-map-enrichment.mjs', 'deal-map-business.mjs']) {
    fs.copyFileSync(path.join(root, 'scripts', file), path.join(temp, 'scripts', file));
  }
  fs.rmSync(path.join(temp, 'docs/deal-map-locations.json'));
  write('docs/deals.json', { deals, totalDeals: deals.length });
  const before = fs.readFileSync(path.join(temp, 'docs/deals.json'), 'utf8');
  const dryRun = spawnSync(process.execPath, [path.join(temp, 'scripts/slack-live-deal-review.mjs')], {
    cwd: temp, encoding: 'utf8', env: { ...process.env, SLACK_LIVE_REVIEW_DRY_RUN: '1' },
  });
  assert.equal(dryRun.status, 0, dryRun.stderr);
  assert.match(dryRun.stdout, /\[needs-review\]|\[address-ready\]/);
  assert.match(dryRun.stdout, /\[online-only\]/);
  assert.equal(fs.readFileSync(path.join(temp, 'docs/deals.json'), 'utf8'), before);
  const manyDeals = Array.from({ length: 29 }, (_, index) => ({ ...base, id: `chunk-${index}` }));
  write('docs/deals.json', { deals: manyDeals, totalDeals: manyDeals.length });
  const maxChunkRun = spawnSync(process.execPath, [path.join(temp, 'scripts/slack-live-deal-review.mjs')], {
    cwd: temp, encoding: 'utf8', env: {
      ...process.env, SLACK_LIVE_REVIEW_DRY_RUN: '1', SLACK_LIVE_REVIEW_CHUNK_SIZE: '999',
      SLACK_LIVE_REVIEW_MAX_DEALS: '120',
    },
  });
  assert.equal(maxChunkRun.status, 0, maxChunkRun.stderr);
  const messages = maxChunkRun.stdout.trim().split(/\n(?=\{)/).map(value => JSON.parse(value));
  const liveMessages = messages.filter(message => message.text.startsWith('Live Deals '));
  assert.deepEqual(liveMessages.map(message => message.blocks.filter(block => block.type === 'actions').length), [12, 12, 5],
    'Oversized chunk environment settings must cap at 12 deals without omissions');
  assert.deepEqual(liveMessages.map(message => message.text), ['Live Deals 1-12', 'Live Deals 13-24', 'Live Deals 25-29']);
  for (const message of messages) {
    assert.ok(message.blocks.length <= 50, 'Every emitted Slack message respects the block limit');
    for (const block of message.blocks.filter(block => block.type === 'context')) {
      assert.ok(block.elements.every(element => element.text.isWellFormed()), 'Internal contexts remain Unicode-safe');
    }
  }
  assert.equal(requests.length, 0, 'Map review makes no Slack or geocoding requests');
  console.log('Slack map review: four states, catalog, optional fixtures, all pending lanes, Unicode, public-field isolation, live reasons and unchanged actions passed');
} finally {
  globalThis.fetch = previousFetch;
  for (const key of Object.keys(process.env)) if (!(key in previousEnv)) delete process.env[key];
  Object.assign(process.env, previousEnv);
  fs.rmSync(temp, { recursive: true, force: true });
}

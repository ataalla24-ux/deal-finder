import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseReviewedNapoleonOffer, verifyReviewedSocialOfficialOffer, fetchReviewedSocialOfficialPage,
  recordReviewedSocialSourcePause } from '../scraper/reviewed-social-official-source.js';
import { validateDealsForSlack } from '../scraper/deal-validity-agent.js';

const home = 'https://www.napoleon.wien/';
const offer = `${home}2026/11/05/napoleon-kinder-happy-hour-50-auf-kindergerichte/`;
const now = new Date('2026-11-20T12:00:00Z');
const caption = 'Napoleon Familienzeit: 50% auf Kindergerichte Bei unserer Napoleon Familienzeit gibt’s von Montag bis Freitag -50% auf die Kindergerichte 15:30–17:30 Uhr, für alle Kinder bis 12 Jahre! Ob nach der Schule, dem Kindergarten oder einem Ausflug - bei uns im Gasthaus Napoleon könnt ihr mit der ganzen Familie stressfrei essen und genießen. Für unsere kleinen Gäste gibt’s eine eigene Kinderspeisekarte, eine Spielecke und einen großen Spielplatz im Gastgarten. Jetzt reservieren: www.napoleon.wien . #napoleonwien #gasthaus #familienfreundlich';
const deal = { id: 'meta-ig-18101671448672416', url: 'https://www.instagram.com/p/DfZ9qMYsGRG/',
  brand: 'Napoleon Wien', title: '50% auf Kindergerichte', description: caption,
  source: 'Slack Digest', originSource: 'Meta Instagram Business Discovery',
  ownerUsername: 'napoleon.wien', sourceAccountType: 'merchant', type: 'rabatt', category: 'essen',
  metaGraphVerified: true, metaGraphMediaId: '18101671448672416', metaGraphCaption: caption,
  sourcePublishedAt: '2026-11-06T15:51:17.000Z', sourcePublishedAtSource: 'instagram-graph-timestamp',
  pubDate: '2026-11-06T15:51:17.000Z', pubDateSource: 'instagram-graph-timestamp',
  metaGraphVerifiedAt: '2026-11-12T14:55:01.859Z', expiryKind: 'recurring',
  pipelineLifecycle: { stage: 'manually-approved', manualDecision: 'approved' } };
// Exact captured desktop/mobile cards and contact; no output-directory dependency.
const html = readFileSync(new URL('./fixtures/napoleon-home-offer-20261113.html', import.meta.url), 'utf8');
const emptyState = () => ({ pause: {}, websites: {}, offers: {}, power: {} });
const page = async () => ({ status: 200, finalUrl: home, html });
const options = extra => ({ now, approvalContext: true, readState: emptyState, recordPause: () => { throw new Error('No real state writes'); }, fetchPage: page, ...extra });
const noSocial = async () => { throw new Error('Must not request Instagram'); };

test('blocked approval retry cannot restore an old official corroboration from pending state', async () => {
  const { validateApprovalCandidates } = await import('../scraper/slack-approve.js');
  const previous = process.env.APPROVAL_SOURCE_COPY_REVIEW;
  process.env.APPROVAL_SOURCE_COPY_REVIEW = '0';
  try {
    const result = await validateApprovalCandidates([{ ...deal,
      officialSourceCorroboration: { sourceUrl: home, checkedAt: '2026-11-13T12:00:00Z' },
    }], { now, existingDeals: [], requireMap: false, inspectDealUrlHealth: noSocial,
      reviewedSocialOfficialOptions: options({ fetchPage: async () => ({ status: 200, finalUrl: home, html: '<p>Offer removed</p>' }) }),
    });
    assert.equal(result.allowedDeals.length, 0);
    assert.equal(result.blockedDeals[0].officialSourceCorroboration, undefined);
    assert.equal(result.blockedDeals[0].pipelineLifecycle.manualDecision, 'approved');
  } finally {
    if (previous === undefined) delete process.env.APPROVAL_SOURCE_COPY_REVIEW;
    else process.env.APPROVAL_SOURCE_COPY_REVIEW = previous;
  }
});

test('one official request replaces the social probe only for existing human approval; original dates and identity survive', async () => {
  let requests = 0;
  const result = await validateDealsForSlack([deal, structuredClone(deal)], {
    now, communityApproval: true, inspectDealUrlHealth: noSocial,
    reviewedSocialOfficialOptions: options({ fetchPage: async () => { requests++; return page(); } }),
  });
  assert.equal(requests, 1, 'batch shares the single official page promise');
  assert.equal(result.allowedDeals.length, 2, JSON.stringify(result.results));
  for (const allowed of result.allowedDeals) {
    for (const key of ['id', 'url', 'originSource', 'sourcePublishedAt', 'sourcePublishedAtSource', 'pubDate', 'pubDateSource', 'metaGraphVerifiedAt']) assert.equal(allowed[key], deal[key], key);
    assert.equal(allowed.officialSourceCorroboration.sourceUrl, home);
    assert.equal(allowed.officialSourceCorroboration.offerUrl, offer);
    assert.equal(allowed.officialSourceCorroboration.method, 'reviewed-official-homepage-segment');
    assert.ok(!allowed.validity.warnings.some(text => /frisch über Graph/.test(text)));
  }
});

test('unapproved and ordinary central validation do not use corroboration or relax social freshness', async () => {
  for (const [candidate, approval] of [[deal, false], [{ ...deal, pipelineLifecycle: {} }, true], [{ ...deal, id: 'different' }, true]]) {
    let probes = 0;
    const result = await validateDealsForSlack([candidate], { now, communityApproval: approval,
      inspectDealUrlHealth: async url => { probes++; return { status: 200, finalUrl: url, dateHints: {}, contentHints: {} }; },
      reviewedSocialOfficialOptions: options({ fetchPage: async () => { throw new Error('Must not fetch official source'); } }),
    });
    assert.equal(probes, 1);
    assert.equal(result.allowedDeals.length, 0);
    assert.ok(result.results[0].decision.reasons.some(reason => /älter als 7 Tage/.test(reason)));
  }
});

test('changed candidate identity, caption, terms, Graph withdrawal or excessive age fails before a request', async () => {
  for (const patch of [{ url: 'https://evil.example/' }, { ownerUsername: 'someone' }, { brand: 'Elsewhere' },
    { title: '40% auf Kindergerichte' }, { metaGraphMediaId: 'another' }, { metaGraphCaption: '' },
    { metaGraphCaption: caption.replace('12 Jahre', '16 Jahre') }, { description: caption.replace('15:30', '14:30') },
    { metaGraphBlockingReason: 'current-original-offer-unconfirmed' }, { metaGraphVerified: false }, { isRepost: true }]) {
    const proof = await verifyReviewedSocialOfficialOffer({ ...deal, ...patch }, options({ fetchPage: noSocial }));
    assert.equal(proof.ok, false, JSON.stringify(patch));
    assert.equal(proof.reason, 'reviewed-candidate-changed');
  }
  assert.equal((await verifyReviewedSocialOfficialOffer(deal, options({ now: new Date('2027-01-01'), fetchPage: noSocial }))).ok, false);
});

test('offer facts must coexist in the exact linked current segment; changed or removed terms fail closed', () => {
  assert.ok(parseReviewedNapoleonOffer(html, home));
  for (const altered of [html.replaceAll('50%', '40%'), html.replace('15:30–17:30', '16:30–18:30'),
    html.replace('12 Jahre', '14 Jahre'), html.replace('Montag bis Freitag', 'Samstag bis Sonntag'),
    html.replace(offer, 'https://evil.example/'), html.replace('card post', 'unreviewed-layout'),
    html.replace('Kagraner Platz 33', 'Andere Straße 12'), html.replace('href="mailto:info@napoleon.wien"', 'href="mailto:else@example.org"'),
    html.replace('Bei unserer Napoleon Kinder Happy Hour gibt’s', 'Nicht mehr gültig. Bei unserer Napoleon Kinder Happy Hour gibt’s'),
    html.replace('<div class="mb-3">', '<div class="mb-3" hidden>'),
    html.replace('50% auf die Kindergerichte!', 'Aktion beendet!') + '<aside>50% auf die Kindergerichte!</aside>',
    html.replace('<footer>', '<footer><p>Andere Straße 2, 1010 Wien</p>')]) assert.equal(parseReviewedNapoleonOffer(altered, home), null);
  assert.equal(parseReviewedNapoleonOffer(html, `${home}archive`), null);
});

test('removed current action or redirect blocks the full validator even with forged persisted corroboration', async () => {
  for (const response of [{ status: 200, finalUrl: home, html: '<body>Nothing current</body>' },
    { status: 200, finalUrl: 'https://evil.example/', html }, { status: 302, finalUrl: home, html }]) {
    const result = await validateDealsForSlack([{ ...deal, officialSourceCorroboration: { verified: true, checkedAt: now.toISOString() } }], {
      now, communityApproval: true, inspectDealUrlHealth: noSocial,
      reviewedSocialOfficialOptions: options({ fetchPage: async () => response }),
    });
    assert.equal(result.allowedDeals.length, 0);
    assert.equal(result.results[0].deal.officialSourceCorroboration, undefined);
  }
});

test('unproven structured prices, dates and location cannot inherit corroboration', async () => {
  for (const patch of [{ expires: '2026-11-12', validUntil: '2026-11-12' }, { address: 'Graz', distance: 'Graz' },
    { expires: '2030-01-01', validUntil: '2030-01-01' }, { address: 'Graben 1, 1010 Wien' },
    { price: 100, originalPrice: 150, discountPercent: 90 }, { discountPercent: 90 }, { ageLimit: 14 },
    { location: 'Graz' }, { city: 'Graz' }, { postalCode: '1010' }, { validFrom: '2026-11-20' },
    { couponCode: 'FAKE' }, { conditions: 'Nur bei 20 Euro Mindestkonsumation' },
    { end_date: '2030-01-01' }, { validity_date: '2030-01-01' }, { promotionEvidence: '-90%' },
    { offerText: 'Bis 2030 gratis für alle' }, { evidence: { textSample: 'Kinder bis 18 Jahre' } }]) {
    const result = await validateDealsForSlack([{ ...deal, ...patch }], { now, communityApproval: true,
      inspectDealUrlHealth: noSocial, reviewedSocialOfficialOptions: options() });
    assert.equal(result.allowedDeals.length, 0, JSON.stringify(result.results));
  }
  const reviewedCopy = { ...deal, address: 'Kagraner Platz 33, 1220 Wien', city: 'Wien', postalCode: '1220',
    description: 'Im Gasthaus Napoleon gibt es montags bis freitags von 15:30 bis 17:30 Uhr 50 % Rabatt auf Kindergerichte für Kinder bis 12 Jahre.' };
  assert.equal((await verifyReviewedSocialOfficialOffer(reviewedCopy, options())).ok, true);
});

test('own and existing host pauses stop requests without advancing deadlines', async () => {
  const retryAt = '2026-11-25T12:00:00Z';
  for (const state of [
    { ...emptyState(), pause: { 'https://www.napoleon.wien': { retryAt } } },
    { ...emptyState(), websites: { [home]: { httpStatus: 403, checkedAt: now.toISOString(), retryAt } } },
    { ...emptyState(), offers: { [offer]: { httpStatus: 429, checkedAt: now.toISOString(), retryAt } } },
    { ...emptyState(), power: { sources: [{ url: home, cooldown: { reason: 'access-denied', nextRetryAt: retryAt } }] } },
  ]) {
    const before = JSON.stringify(state);
    const proof = await verifyReviewedSocialOfficialOffer(deal, options({ readState: () => state, fetchPage: noSocial }));
    assert.equal(proof.reason, 'source-paused');
    assert.equal(JSON.stringify(state), before);
  }
  const malformed = await verifyReviewedSocialOfficialOffer(deal, options({ readState: () => ({ ...emptyState(), pause: { 'https://www.napoleon.wien': { retryAt: 'bad' } } }), fetchPage: noSocial }));
  assert.equal(malformed.reason, 'source-pause-unreadable');
  const missingRetry = await verifyReviewedSocialOfficialOffer(deal, options({ readState: () => ({ ...emptyState(), pause: { 'https://www.napoleon.wien': {} } }), fetchPage: noSocial }));
  assert.equal(missingRetry.reason, 'source-pause-unreadable');
});

test('new refusal persists an origin-keyed pause only to a temporary test path and respects longer Retry-After', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'reviewed-source-pause-'));
  try {
    const pausePath = join(dir, 'pause.json');
    const proof = await verifyReviewedSocialOfficialOffer(deal, options({
      fetchPage: async () => ({ status: 429, finalUrl: home, retryAfter: '604800' }),
      recordPause: row => recordReviewedSocialSourcePause(row, pausePath),
    }));
    assert.equal(proof.ok, false);
    const saved = JSON.parse(readFileSync(pausePath));
    assert.equal(saved['https://www.napoleon.wien'].retryAt, '2026-11-27T12:00:00.000Z');
    recordReviewedSocialSourcePause({ retryAt: '2026-11-21T12:00:00Z' }, pausePath);
    assert.deepEqual(JSON.parse(readFileSync(pausePath)), saved);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('fetcher does not follow redirects and bounds HTML, origin, type and timeout', async () => {
  let count = 0;
  const redirected = await fetchReviewedSocialOfficialPage(home, { fetchImpl: async (url, init) => {
    count++; assert.equal(url, home); assert.equal(init.redirect, 'manual'); assert.ok(init.signal);
    return new Response('', { status: 302, headers: { location: 'https://evil.example/' } });
  } });
  assert.equal(redirected.status, 302); assert.equal(count, 1);
  await assert.rejects(fetchReviewedSocialOfficialPage('https://evil.example/', { fetchImpl: noSocial }));
  const nonHtml = await fetchReviewedSocialOfficialPage(home, { fetchImpl: async () => new Response('{}', { headers: { 'content-type': 'application/json' } }) });
  assert.equal(nonHtml.html, undefined);
  await assert.rejects(fetchReviewedSocialOfficialPage(home, { fetchImpl: async () => new Response('x'.repeat(2500001), { headers: { 'content-type': 'text/html' } }) }), /HTML limit/);
});

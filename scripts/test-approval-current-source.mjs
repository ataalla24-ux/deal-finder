import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { extractApprovalSourceEvidence } from '../scraper/approval-source-evidence.js';
import { validateDealsForSlack } from '../scraper/deal-validity-agent.js';
import { validateApprovalCandidates } from '../scraper/slack-approve.js';
import { inspectDealUrlHealth } from '../scraper/expiry-utils.js';

const fixtures = JSON.parse(readFileSync(new URL('./fixtures/approval-current-source-20261114.json', import.meta.url)));
const [donut, cios, momax] = fixtures.cases;
const page = (row, edit = {}) => `<html><head><meta property="og:description" content="Heute gratis Donut"></head><body><script>window.__INITIAL_STATE__ = ${JSON.stringify({
  threadDetail: { ...row.threadDetail, ...edit }, comments: [{ text: 'Fremde Aktion: alles gratis ohne App' }],
})};</script></body></html>`;
const now = new Date('2026-11-14T10:00:00Z');
const deal = { id: 'current-source-donut', url: donut.sourceUrl, title: '1 Donut gratis',
  description: '', sourcePublishedAt: '2026-11-13T05:25:40Z', category: 'essen', type: 'gratis',
  distance: 'Teilnehmende Filialen in Österreich', pipelineLifecycle: { manualDecision: 'approved' } };

test('complete current thread replaces a truncated listing preview without losing restrictions', () => {
  const evidence = extractApprovalSourceEvidence(page(donut), donut.sourceUrl);
  assert.equal(evidence.blockingReason, undefined);
  for (const required of ['17.11.2026', 'teilnehmenden Restaurants', 'Nur solange der Vorrat reicht',
    'Maximal 2 Einlösungen pro Gast', 'Nicht über McDelivery', 'nicht gegen Bargeld',
    "6 MyMcDonald's Gutscheine", 'starte bitte eine neue Bestellung']) assert.ok(evidence.caption.includes(required), required);
  assert.ok(!evidence.caption.includes('morgen') && !evidence.caption.includes('Fremde Aktion'));
  const anecdote = extractApprovalSourceEvidence(page(momax), momax.sourceUrl);
  assert.match(anecdote.caption, /5[,.]50/);
  assert.equal(anecdote.caption.includes(momax.threadDetail.title), true);
});

test('old announcement, unknown offer, changed or incomplete update never clears the source hold', () => {
  const original = donut.threadDetail.threadDetails.preparedHtmlDescription;
  for (const body of [donut.threadDetail.descriptionPurified,
    original.replace('Maximal 2 Einlösungen pro Gast.', ''),
    original.replace('Nicht über McDelivery verfügbar und nicht gegen Bargeld einlösbar.', ''),
    original.replace('Nachdem heute', 'Vielleicht heute')]) {
    assert.match(extractApprovalSourceEvidence(page(donut, { threadDetails: { preparedHtmlDescription: body } }), donut.sourceUrl).blockingReason, /Ankuendigung/);
  }
  const otherUrl = donut.sourceUrl.replace('372365', '372366');
  const other = { ...donut, sourceUrl: otherUrl, threadDetail: { ...donut.threadDetail, threadId: '372366', canonicalUrl: otherUrl } };
  assert.match(extractApprovalSourceEvidence(page(other), otherUrl).blockingReason, /Ankuendigung/);
  for (const edit of [{ isExpired: true }, { status: 'Deleted' }, { threadId: '1' }]) {
    assert.ok(extractApprovalSourceEvidence(page(donut, edit), donut.sourceUrl).blockingReason);
  }
  for (const body of ['', '<p hidden>Alles gratis</p>', '<p style="display:none">Alles gratis</p>',
    '<p>Aktion beendet. Gutschein nicht mehr einlösbar.</p>']) {
    assert.ok(extractApprovalSourceEvidence(page(donut, { threadDetails: { preparedHtmlDescription: body },
      descriptionPurified: 'Alter Vorschautext: alles gratis mit App.' }), donut.sourceUrl).blockingReason, body);
  }
});

test('full source exposes unresolved Cio conditions instead of blessing truncated preview and JSON date', () => {
  const evidence = extractApprovalSourceEvidence(page(cios), cios.sourceUrl);
  assert.match(evidence.caption, /Gesundheitswesen/);
  assert.match(evidence.caption, /Wiener Linien/);
  assert.match(evidence.caption, /wie lange die Aktion gilt/);
  assert.match(evidence.blockingReason, /ungeklaerte Aktionsbedingungen/);
});

test('exact current source governs relative wording; stale metadata cannot expire a current update', async () => {
  const source = extractApprovalSourceEvidence(page(donut), donut.sourceUrl);
  const health = { status: 200, finalUrl: donut.sourceUrl, contentHints: { title: 'Heute gratis Donut' }, dateHints: {}, approvalSourceEvidence: source };
  const check = async h => (await validateDealsForSlack([deal], { now, inspectDealUrlHealth: async () => h })).results[0].decision.reasons;
  assert.ok(!(await check(health)).some(reason => reason.includes('relative Kurz-Aktion')));
  for (const ownEvidence of [{ title: 'Donut heute gratis', editedInSlack: true },
    { description: 'Nur heute Donut gratis in Wien.' }, { evidence: { textSample: 'Heute gratis Donut' } }]) {
    const result = await validateDealsForSlack([{ ...deal, ...ownEvidence }], { now, inspectDealUrlHealth: async () => health });
    assert.ok(result.results[0].decision.reasons.some(reason => reason.includes('relative Kurz-Aktion')),
      'current source cannot silently erase stored or human-edited one-day conditions');
  }
  for (const evidence of [undefined, { ...source, sourceUrl: 'https://example.com/' },
    { ...source, blockingReason: 'Quelle unklar' }, { ...source, caption: 'Nur heute gratis Donut mit App.' }]) {
    assert.ok((await check({ ...health, approvalSourceEvidence: evidence })).some(reason => reason.includes('relative Kurz-Aktion')), JSON.stringify(evidence));
  }
  for (const status of [403, 429]) {
    const outcome = await validateApprovalCandidates([deal], { now, existingDeals: [], requireMap: false,
      inspectDealUrlHealth: async () => ({ ...health, status, transientError: true, blockedByProtection: true }) });
    assert.equal(outcome.allowedDeals.length, 0, 'refusal must not be treated as current evidence');
  }
});

test('actual approval path shares one GET, reaches copy-review queue and retains map/description gates without billing', async () => {
  const previousFetch = globalThis.fetch;
  const previousReview = process.env.APPROVAL_SOURCE_COPY_REVIEW;
  let reads = 0, calls = 0;
  process.env.APPROVAL_SOURCE_COPY_REVIEW = '1';
  globalThis.fetch = async input => {
    assert.equal(input, donut.sourceUrl); reads++;
    return new Response(page(donut), { status: 200, headers: { 'content-type': 'text/html' } });
  };
  try {
    const result = await validateApprovalCandidates([deal], { now, existingDeals: [], requireMap: false,
      inspectDealUrlHealth, approvalCachedReviewOnly: true,
      approvalModelRequest: async () => { calls++; throw new Error('unexpected paid request'); } });
    assert.equal(reads, 1);
    assert.equal(calls, 0);
    assert.equal(result.allowedDeals.length, 0, 'fresh source alone does not replace the copy reviewer or location check');
    assert.ok(!result.results[0].decision.reasons.some(reason => /Angebotsbeleg ausstehend|relative Kurz-Aktion/.test(reason)));
    assert.ok(result.results[0].decision.reasons.some(reason => /Inhaltsprüfung ausstehend|Beschreibung fehlt|nicht eindeutig in Wien/.test(reason)));
    assert.equal(result.blockedDeals[0].pipelineLifecycle.manualDecision, 'approved');
  } finally {
    globalThis.fetch = previousFetch;
    if (previousReview === undefined) delete process.env.APPROVAL_SOURCE_COPY_REVIEW;
    else process.env.APPROVAL_SOURCE_COPY_REVIEW = previousReview;
  }
});

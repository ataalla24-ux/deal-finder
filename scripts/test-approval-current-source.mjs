import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { extractApprovalSourceEvidence } from '../scraper/approval-source-evidence.js';
import { validateDealsForSlack } from '../scraper/deal-validity-agent.js';
import { validateApprovalCandidates } from '../scraper/slack-approve.js';
import { inspectDealUrlHealth } from '../scraper/expiry-utils.js';
import { load } from 'cheerio';

const fixtures = JSON.parse(readFileSync(new URL('./fixtures/approval-current-source-20261114.json', import.meta.url)));
const [donut, cios, momax] = fixtures.cases;
const page = (row, edit = {}) => `<html><head><meta property="og:description" content="Heute gratis Donut"></head><body><script>window.__INITIAL_STATE__ = ${JSON.stringify({
  threadDetail: { ...row.threadDetail, ...edit }, comments: [{ text: 'Fremde Aktion: alles gratis ohne App' }],
})};</script></body></html>`;
const now = new Date('2026-11-14T10:00:00Z');
// DOM excerpt of the actual production-inspector response b572534d8910350c...
// Original hierarchy/attributes/text retained; unrelated UI, authors, comments
// and JSON-LD fields removed. No window.__INITIAL_STATE__ wrapper was invented.
const domHtml = readFileSync(new URL('./fixtures/preisjaeger-donut-dom-20261114.html', import.meta.url), 'utf8');
const deal = { id: 'current-source-donut', url: donut.sourceUrl, title: '1 Donut gratis',
  description: '', sourcePublishedAt: '2026-11-13T05:25:40Z', category: 'essen', type: 'gratis',
  distance: 'Teilnehmende Filialen in Österreich', pipelineLifecycle: { manualDecision: 'approved' } };

test('actual production DOM binds the visible own thread to canonical, identity and JSON-LD', () => {
  assert.ok(!domHtml.includes('__INITIAL_STATE__'));
  const evidence = extractApprovalSourceEvidence(domHtml, donut.sourceUrl);
  assert.equal(evidence.blockingReason, undefined);
  assert.equal(evidence.sourceKind, 'preisjaeger-visible-thread');
  assert.match(evidence.caption, /einlösbar bis inkl\. 17\.11\.2026/);
  for (const term of ['Maximal 2 Einlösungen pro Gast', 'Nicht über McDelivery', "6 MyMcDonald's Gutscheine"])
    assert.ok(evidence.caption.includes(term), term);
  assert.ok(!evidence.caption.includes('morgen'));
  assert.equal(evidence.status, undefined, 'reading current text does not invent an active machine status');
});

test('DOM rejects identity ambiguity, hidden own evidence, comments-only and explicit withdrawal', () => {
  const hold = mutate => { const $ = load(domHtml); mutate($); assert.ok(extractApprovalSourceEvidence($.html(), donut.sourceUrl).blockingReason); };
  for (const mutate of [
    $ => $('link[rel="canonical"]').attr('href', donut.sourceUrl + '?other=1'),
    $ => $('meta[property="og:url"]').remove(),
    $ => $('link[rel="canonical"]').clone().appendTo('head'),
    $ => $('#thread_details_372365').attr('id', 'thread_details_372366'),
    $ => $('#thread_372365').attr('id', 'thread_372366'),
    $ => $('#thread_details_372365').attr('data-t', 'recommendation'),
    $ => $('#thread_details_372365').removeAttr('data-t-view'),
    $ => $('h1.thread-title').clone().appendTo('#thread_372365'),
    $ => $('.userHtml-content[data-t="description"]').clone().appendTo('.threadItem-card > .threadItem-content'),
    $ => $('.userHtml-content[data-t="description"]').clone().attr('hidden', '').appendTo('.threadItem-card > .threadItem-content'),
    $ => $('.userHtml-content[data-t="description"]').attr('hidden', ''),
    $ => $('.userHtml-content[data-t="description"]').parent().attr('style', 'display:none'),
    $ => $('h1.thread-title').attr('aria-hidden', 'true'),
    $ => $('h1.thread-title > span').attr('hidden', ''),
    $ => $('main').attr('hidden', ''),
    $ => $('.userHtml-content[data-t="description"]').addClass('hide'),
    $ => $('.userHtml-content[data-t="description"]').parent().addClass('hide'),
    $ => $('h1.thread-title').addClass('hide'),
    $ => $('h1.thread-title > span').addClass('hide'),
    $ => $('.threadItem-header').text('Dieser Deal ist abgelaufen'),
    $ => $('.threadItem-header').text('Angebot wurde zurückgezogen'),
    $ => $('.threadItem-header').text('Deal ist beendet'),
    $ => $('.threadItem-header').text('Dieser Deal wurde beendet'),
    $ => { const body = $('.userHtml-content[data-t="description"]');
      const copy = body.clone(); body.remove(); $('#thread_details_372365').append('<section id="thread-comments"></section>'); copy.appendTo('#thread-comments'); },
    $ => $('.userHtml-content[data-t="description"]').html('<p hidden>Ein Donut gratis</p>'),
    $ => $('script[type="application/ld+json"]').remove(),
    $ => { const s = $('script[type="application/ld+json"]'); const d = JSON.parse(s.text());
      d['@graph'][0].text = 'Andere oder alte Bedingungen'; s.text(JSON.stringify(d)); },
    $ => { const s = $('script[type="application/ld+json"]'); const d = JSON.parse(s.text());
      d['@graph'][0]['@id'] = d['@graph'][0]['@id'].replace('372365', '372366'); s.text(JSON.stringify(d)); },
    $ => { const s = $('script[type="application/ld+json"]'); const d = JSON.parse(s.text());
      d['@graph'].push(d['@graph'][0]); s.text(JSON.stringify(d)); },
  ]) hold(mutate);
  assert.ok(extractApprovalSourceEvidence(domHtml, donut.sourceUrl, donut.sourceUrl + '?other=1').blockingReason);
  const mixed = domHtml.replace('</body>', `${page(donut, { isExpired: true })}</body>`);
  assert.match(extractApprovalSourceEvidence(mixed, donut.sourceUrl).blockingReason, /kein aktives/,
    'DOM fallback cannot override an explicit JSON withdrawal');
});

test('global hide is distinct from responsive classes and hidden status templates', () => {
  const $ = load(domHtml);
  $('.userHtml-content[data-t="description"]').addClass('hide--fromW3');
  $('.threadItem-header').append('<span class="hide">Deal ist beendet</span><span style="display:none">abgelaufen</span>');
  assert.equal(extractApprovalSourceEvidence($.html(), donut.sourceUrl).blockingReason, undefined);
});

test('production inspector reads captured DOM with one mocked GET and retains original publication date', async () => {
  const previousFetch = globalThis.fetch; let reads = 0;
  globalThis.fetch = async url => { assert.equal(url, donut.sourceUrl); reads++;
    return new Response(domHtml, { status: 200, headers: { 'content-type': 'text/html' } }); };
  try {
    const health = await inspectDealUrlHealth(donut.sourceUrl, { now });
    assert.equal(reads, 1); assert.equal(health.status, 200);
    assert.equal(health.approvalSourceEvidence.blockingReason, undefined);
    assert.equal(health.dateHints.publicationDate, '2026-11-13T05:25:40.000Z');
    const checked = await validateDealsForSlack([deal], { now, inspectDealUrlHealth: async () => health });
    assert.ok(!checked.results[0].decision.reasons.some(reason => /relative Kurz-Aktion/.test(reason)));
  } finally { globalThis.fetch = previousFetch; }
});

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
    assert.ok(result.results[0].decision.reasons.some(reason => /Grundprüfung|nicht eindeutig in Wien/.test(reason)));
    assert.equal(result.blockedDeals[0].pipelineLifecycle.manualDecision, 'approved');
  } finally {
    globalThis.fetch = previousFetch;
    if (previousReview === undefined) delete process.env.APPROVAL_SOURCE_COPY_REVIEW;
    else process.env.APPROVAL_SOURCE_COPY_REVIEW = previousReview;
  }
});

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mergeParsedDealsWithQueue, validateApprovalCandidates } from '../scraper/slack-approve.js';
import { inspectDealUrlHealth, normalizeDealExpiry, parseExpiryShape } from '../scraper/expiry-utils.js';
import { extractApprovalSourceEvidence } from '../scraper/approval-source-evidence.js';
import { copyReviewReasons, groundedDatePatch, reviewApprovedCopy } from './automatic-deal-maintenance.mjs';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const now = new Date('2026-11-13T20:00:00Z');
const url = 'https://www.preisjaeger.at/deals/mcdonalds-gratis-fussball-donut-zum-osterreich-match-372365';
const literal = 'ab 14. November 2026; Enddatum im Beitrag nicht angegeben Keine konkrete Uhrzeit angegeben';
const announcement = 'In der Mc App entdeckt. Leider im Moment noch nicht mehr Infos vorhanden. (Ich denke morgen wissen wir mehr)';
const page = (description = announcement, extra = {}) => `<html><head><title>Donut gratis</title></head><body><script>window.__INITIAL_STATE__ = ${JSON.stringify({
  threadDetail: { threadId: '372365', canonicalUrl: url, type: 'Deal', title: '1 Donut gratis',
    descriptionPurified: description, status: 'Activated', isExpired: false, ...extra },
  comments: [{ text: 'Erfundene Bedingungen: alle Filialen, ohne App!' }],
  widgets: [{ descriptionPurified: 'Fremdes Angebot: Burger fuer 1 Euro.' }],
})};</script></body></html>`;

test('Slack preview cannot erase full queue copy, source or offer period', () => {
  const queued = { id: 'donut', slackTs: '123.456', url, title: '1 Donut gratis',
    description: 'Vollstaendige Einloesebedingungen aus der Quelle.', source: 'Firecrawl Gastro #4',
    expires: literal, expiresOriginal: literal, evidence: { textSample: 'Originalbeleg' } };
  const [merged] = mergeParsedDealsWithQueue([{ id: 'donut', slackTs: queued.slackTs, url,
    title: '1 Donut...', description: '', source: 'Slack Digest', expires: '2026-11-14', validUntil: '2026-11-14', evidence: {} }], [queued]);
  for (const key of ['title', 'description', 'source', 'expires', 'expiresOriginal', 'evidence']) {
    assert.deepEqual(merged[key], queued[key], key);
  }
  assert.ok(!merged.validUntil, 'preview must not recreate an end missing from the source period');
  const changed = { id: 'another', slackTs: queued.slackTs, url: 'https://example.com/another', title: 'Other deal' };
  assert.deepEqual(mergeParsedDealsWithQueue([changed], [queued]), [changed], 'no cross-offer evidence');
});

test('source reader scopes exact public thread, rejects redirects/inactive/unknown sources and no-info announcements', () => {
  const evidence = extractApprovalSourceEvidence(page(), url);
  assert.match(evidence.blockingReason, /Ankuendigung/);
  assert.ok(!evidence.caption.includes('Erfundene') && !evidence.caption.includes('Burger'));
  assert.equal(extractApprovalSourceEvidence(page(), 'https://example.com/deals/test-372365'), null);
  for (const html of [page(announcement, { threadId: '1' }), page(announcement, { isExpired: true }),
    page(announcement, { canonicalUrl: url.replace('372365', '123') }), '<script>window.__INITIAL_STATE__ = evil();</script>']) {
    assert.ok(extractApprovalSourceEvidence(html, url).blockingReason);
  }
  assert.ok(extractApprovalSourceEvidence(page(), url, url.replace('372365', '1')).blockingReason);
  const complete = extractApprovalSourceEvidence(page('Ein Donut gratis mit App-Coupon am 14.11.2026 in Wien.'), url);
  assert.equal(complete.blockingReason, undefined);
  assert.match(complete.caption, /App-Coupon/);
});

test('approval reuses one health GET, holds announcement with corrected start, and makes zero AI calls', async () => {
  const originalFetch = globalThis.fetch;
  const oldReview = process.env.APPROVAL_SOURCE_COPY_REVIEW;
  let fetches = 0, modelCalls = 0;
  process.env.APPROVAL_SOURCE_COPY_REVIEW = '1';
  globalThis.fetch = async input => {
    assert.equal(input, url, 'no other network request');
    fetches++;
    return new Response(page(), { status: 200, headers: { 'content-type': 'text/html' } });
  };
  try {
    const input = { id: 'fixture-donut', url, title: '1 Donut gratis', brand: "McDonald's", description: '',
      expiresOriginal: literal, expires: '2026-11-14', validUntil: '2026-11-14T12:00:00Z',
      expiryKind: 'end', expiresSource: 'deal.structured', category: 'essen', type: 'gratis',
      distance: 'Teilnehmende Filialen in Oesterreich', sourcePublishedAt: '2026-11-13T05:25:40Z',
      pipelineLifecycle: { manualDecision: 'approved' } };
    const result = await validateApprovalCandidates([input], { now, requireMap: false, existingDeals: [],
      inspectDealUrlHealth, approvalModelRequest: async () => { modelCalls++; throw Error('no billable call expected'); } });
    assert.equal(fetches, 1, 'evidence and ordinary validation share the one GET');
    assert.equal(modelCalls, 0);
    assert.equal(result.allowedDeals.length, 0);
    const pending = result.blockedDeals[0];
    assert.equal(pending.validFrom, '2026-11-14');
    assert.ok(!pending.validUntil && !pending.expires);
    assert.equal(pending.pipelineLifecycle.manualDecision, 'approved');
    assert.ok(result.results[0].decision.reasons.some(reason => reason.startsWith('Angebotsbeleg ausstehend:')));
    assert.equal(input.validUntil, '2026-11-14T12:00:00Z', 'caller input not mutated');
  } finally {
    globalThis.fetch = originalFetch;
    if (oldReview === undefined) delete process.env.APPROVAL_SOURCE_COPY_REVIEW;
    else process.env.APPROVAL_SOURCE_COPY_REVIEW = oldReview;
  }
});

test('complete same-source text reaches existing two-role review, incomplete/wrong-source text does not', async () => {
  const cwd = await mkdtemp(join(tmpdir(), 'source-copy-'));
  const conditions = 'Ein Donut gratis mit App-Coupon am 14.11.2026 in Wien.';
  const deal = { id: 'fixture', url, title: '1 Donut gratis', description: '', validOn: '2026-11-14' };
  let calls = 0;
  const request = async (_url, init) => {
    const body = JSON.parse(init.body);
    assert.ok(JSON.stringify(body).includes(conditions));
    calls++;
    const content = calls % 2 ? { title: deal.title, quote: 'Ein Donut gratis', description: conditions,
      conditionsQuote: conditions } : { supported: true };
    return Response.json({ choices: [{ finish_reason: 'stop', message: { content: JSON.stringify(content) } }] });
  };
  try {
    await mkdir(join(cwd, 'reviews'));
    await writeFile(join(cwd, 'reviews/automatic-maintenance-policy.json'), JSON.stringify({ version: 1, enabled: true, maxAiCandidatesPerRun: 4 }));
    const sourceEvidence = new Map([[deal.id, extractApprovalSourceEvidence(page(conditions), url)]]);
    const [reviewed] = await reviewApprovedCopy([deal], { cwd, now, request, sourceEvidence });
    assert.equal(calls, 2);
    assert.equal(reviewed.description, conditions);
    await reviewApprovedCopy([{ ...deal, approvalCopyReview: reviewed.approvalCopyReview }], { cwd, now, request, sourceEvidence });
    assert.equal(calls, 2, 'same-source retry does not rebill');
    sourceEvidence.set(deal.id, extractApprovalSourceEvidence(page(), url));
    await reviewApprovedCopy([reviewed], { cwd, now, request, sourceEvidence });
    assert.equal(calls, 2, 'source withdrawal does not bill');
    sourceEvidence.set(deal.id, { sourceUrl: 'https://example.com', caption: conditions });
    await reviewApprovedCopy([deal], { cwd, now, request, sourceEvidence });
    assert.equal(calls, 2, 'wrong source cannot supply evidence');
    sourceEvidence.set(deal.id, extractApprovalSourceEvidence(page(conditions), url));
    const [expanded] = await reviewApprovedCopy([{ ...deal, distance: 'Wien', description: `${deal.title} - Wien` }],
      { cwd, now, request, sourceEvidence });
    assert.equal(calls, 4, 'title plus location is a preview, not complete redemption information');
    assert.equal(expanded.description, conditions);
  } finally { await rm(cwd, { recursive: true, force: true }); }
});

test('bare ab date is a start, including already mis-normalized pending records', async () => {
  assert.equal(parseExpiryShape(literal, { now }).kind, 'start');
  assert.equal(parseExpiryShape('ab 14.11', { now }).kind, 'start');
  const deal = { expiresOriginal: literal, expires: '2026-11-14', validUntil: '2026-11-14T12:00:00Z',
    expiryKind: 'end', expiresSource: 'deal.structured', expiryDisplayText: '2026-11-14' };
  await normalizeDealExpiry(deal, { now, allowUrlLookup: false });
  assert.equal(deal.expiryKind, 'start');
  assert.equal(deal.validFrom, '2026-11-14');
  assert.ok(!deal.validUntil && !deal.validOn && !deal.expires);
  const snapshot = structuredClone(deal);
  await normalizeDealExpiry(deal, { now, allowUrlLookup: false });
  assert.deepEqual(deal, snapshot);
  assert.equal(parseExpiryShape('ab 31.12.2026 bis 02.01.2027', { now }).validUntil, '2027-01-02');
  assert.notEqual(parseExpiryShape('Pizza ab 7 Euro, bis 14.11.2026', { now }).kind, 'start');
  assert.notEqual(parseExpiryShape('14.11.2026 ab 12:00 Uhr', { now }).kind, 'start');
  const reviewed = { ...snapshot, expires: '2026-11-16', validUntil: '2026-11-16',
    slackFormEditTs: '123', slackEditedFields: ['validUntil'] };
  await normalizeDealExpiry(reviewed, { now, allowUrlLookup: false });
  assert.ok(reviewed.expires.startsWith('2026-11-16'), 'independent reviewed end retained');
});

test('a later complete source can add a quoted end, but cannot rewrite an existing start or reviewed date', () => {
  const deal = { title: '1 Donut gratis', description: '', expiryKind: 'start', validFrom: '2026-11-14', expiresOriginal: literal };
  const quote = 'Ab 14.11.2026 bis 16.11.2026';
  assert.ok(copyReviewReasons(deal).includes('dates'));
  assert.equal(groundedDatePatch(quote, [quote], deal).validUntil, '2026-11-16');
  const conflict = 'Ab 15.11.2026 bis 16.11.2026';
  assert.deepEqual(groundedDatePatch(conflict, [conflict], deal), {});
  assert.deepEqual(groundedDatePatch(quote, [quote], deal, new Set(['validUntil'])), {});
  assert.deepEqual(groundedDatePatch(quote, [quote], { ...deal, validUntil: '2026-11-20' }), {});
});

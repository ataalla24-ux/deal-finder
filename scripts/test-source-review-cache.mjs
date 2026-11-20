import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { cachedSourceReview, loadSourceReviewCache, rememberSourceReview, reviewClockContext,
  reviewFingerprint, saveSourceReviewCache } from '../scraper/source-review-cache.js';
import { reviewLiveDealBatches } from './review-live-deals-llm.mjs';
import { getFeaturedDealEligibility } from '../scraper/set-daily-deal.js';

const now = new Date('2026-10-23T10:00:00Z');
const cache = () => ({ version: 1, entries: {} });
const row = id => ({ id, brand: 'Testlokal', title: 'Pizza für 5 €', description: 'Pizza für 5 € bis 30.11.2026.',
  category: 'essen', url: `https://example.com/${id}`, validUntil: '2026-11-30',
  targetEvidence: { status: 'ok', page: { title: 'Pizza für 5 €' } } });
const response = rows => ({ parsed: { reviews: rows.map(deal => ({ dealID: deal.id, decision: 'keep',
  reason: 'ok', confidence: 0.95, message: 'Konkretes Angebot.', suggestion: '', proposedPatch: {} })) },
  usage: { prompt_tokens: 100, completion_tokens: 10, total_tokens: 110 } });

test('unchanged live deals reuse decisions across runs without charging old tokens', async () => {
  const store = cache();
  let calls = 0;
  const classify = async rows => { calls++; return response(rows); };
  const first = await reviewLiveDealBatches([row('a'), row('b'), row('c')], { cache: store, now, chunkSize: 2, classify });
  assert.equal(calls, 2);
  const second = await reviewLiveDealBatches([row('a'), row('b'), row('c')], {
    cache: store, now: new Date('2026-10-24T10:00:00Z'), chunkSize: 2, classify });
  assert.equal(calls, 2);
  assert.deepEqual(second.reviews, first.reviews);
  assert.equal(second.stats.aiCalls, 0);
  assert.equal(second.stats.cachedDeals, 3);
  assert.equal(second.usage.total_tokens, 0);
  assert.equal(second.stats.reusedReviews[0].reviewedAt, now.toISOString());
});

test('changed copy, source evidence, model and original untruncated terms invalidate affected deals', async () => {
  for (const change of [
    input => { input[0].title = 'Pizza für 6 €'; },
    input => { input[0].targetEvidence.page.title = 'Aktion beendet'; },
  ]) {
    const store = cache(); let calls = 0;
    const classify = async rows => { calls++; return response(rows); };
    const input = [row('a'), { ...row('b'), brand: 'Kino', title: 'Kinokarte' },
      { ...row('c'), brand: 'Buchladen', title: 'Buchrabatt' }];
    await reviewLiveDealBatches(input, { cache: store, now, chunkSize: 2, classify });
    change(input);
    const next = await reviewLiveDealBatches(input, { cache: store, now, chunkSize: 2, classify });
    assert.equal(calls, 3);
    assert.equal(next.stats.aiReviewedDeals, 1);
    assert.equal(next.stats.cachedDeals, 2);
  }
  const store = cache(); let calls = 0;
  const classify = async rows => { calls++; return response(rows); };
  await reviewLiveDealBatches([row('a')], { cache: store, now, classify });
  await reviewLiveDealBatches([row('a')], { cache: store, now, classify, model: 'different-model' });
  await reviewLiveDealBatches([row('a')], { cache: store, now, classify, originals: [{ ...row('a'), description: 'Changed full condition beyond the compact preview' }] });
  assert.equal(calls, 3);
  const dated = cache(); let dateCalls = 0;
  const full = [{ ...row('a'), description: 'Nur heute, vollstaendige Bedingung ausserhalb der kompakten Vorschau.' }];
  const dateClassify = async rows => { dateCalls++; return response(rows); };
  await reviewLiveDealBatches([row('a')], { cache: dated, now, originals: full, classify: dateClassify });
  await reviewLiveDealBatches([row('a')], { cache: dated, now: new Date('2026-10-24T10:00:00Z'), originals: full, classify: dateClassify });
  assert.equal(dateCalls, 2, 'temporal conditions outside compact text are also rechecked');
});

test('new comparison context, stale entries and errors never masquerade as cache hits', async () => {
  const store = cache(); let calls = 0;
  const classify = async rows => { calls++; return response(rows); };
  await reviewLiveDealBatches([row('a')], { cache: store, now, classify });
  await reviewLiveDealBatches([row('a'), row('duplicate')], { cache: store, now, classify });
  await reviewLiveDealBatches([row('a')], { cache: store, now: new Date('2026-10-26T10:00:00Z'), classify });
  assert.equal(calls, 3);
  const failed = cache();
  for (let i = 0; i < 2; i++) {
    const result = await reviewLiveDealBatches([row('a')], { cache: failed, now,
      classify: async () => { throw Error('temporary model outage'); } });
    assert.equal(result.errors.length, 1);
    assert.equal(result.stats.cachedDeals, 0);
  }
  assert.equal(Object.keys(failed.entries).length, 0);
  const partial = await reviewLiveDealBatches([row('a'), row('b')], { cache: failed, now,
    classify: async rows => response(rows.slice(0, 1)) });
  assert.equal(partial.stats.uncachedIncompleteGroups, 1);
  assert.equal(partial.reviews[0].dealID, 'a');
  assert.equal(Object.keys(failed.entries).length, 0);
});

test('expiry, publication age, relative schedules and missing evidence force fresh temporal decisions', () => {
  for (const input of [
    { validUntil: '2026-10-23' }, { validUntil: '2026-10-23T12:00:00Z' },
    { validUntil: '2026-11-30', publishedAt: '2026-10-16T12:00:00Z' },
    { validUntil: '2026-11-30', description: 'Nur heute' },
    { validUntil: '2026-11-30', description: 'Jeden Dienstag' },
    { validUntil: '2026-11-30', targetEvidence: null },
    { validUntil: '2026-11-30', targetEvidence: { status: 'blocked' } },
    { title: 'Kaffee für 2 €' },
  ]) assert.notDeepEqual(reviewClockContext(input, now), reviewClockContext(input, new Date('2026-10-24T14:00:00Z')));
});

test('corrupt, future-dated, tampered and schema-invalid cache entries fail closed; storage is bounded', () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'freefinder-review-cache-'));
  try {
    const file = path.join(temp, 'cache.json');
    fs.writeFileSync(file, '{broken');
    const store = loadSourceReviewCache(file);
    const key = reviewFingerprint({ a: 1, b: 2 });
    assert.equal(key, reviewFingerprint({ b: 2, a: 1 }));
    rememberSourceReview(store, key, { ok: true }, now);
    const options = { now, validate: value => value.ok === true };
    assert.ok(cachedSourceReview(store, key, options));
    assert.equal(cachedSourceReview(store, key, { ...options, now: new Date(now.getTime() - 1) }), null);
    assert.equal(cachedSourceReview(store, key, { ...options, validate: () => false }), null);
    store.entries[key].result.ok = false;
    assert.equal(cachedSourceReview(store, key, { ...options, validate: () => true }), null);
    delete store.entries[key].result;
    assert.equal(cachedSourceReview(store, key, { ...options, validate: () => true }), null);
    for (let i = 0; i < 300; i++) rememberSourceReview(store, `${i}`, { ok: true }, now);
    saveSourceReviewCache(file, store, now);
    assert.equal(Object.keys(loadSourceReviewCache(file).entries).length, 256);
    saveSourceReviewCache(file, store, new Date('2026-10-27T10:00:00Z'));
    assert.equal(Object.keys(loadSourceReviewCache(file).entries).length, 0);
  } finally { fs.rmSync(temp, { recursive: true, force: true }); }
});

test('weekly reuse still reads fresh source evidence and stops at changes, six hours or expiry', async () => {
  const old = process.env.OPENAI_API_KEY;
  process.env.OPENAI_API_KEY = 'offline-fixture-not-a-real-key';
  try {
    const store = cache(); let requests = 0; let inspections = 0;
    let heading = 'Pizza für 5 €';
    const options = { now, cache: store,
      inspectUrl: async () => { inspections++; return { status: 200, contentHints: { title: heading } }; },
      request: async () => { requests++; return Response.json({ choices: [{ message: {
        content: JSON.stringify({ decision: 'active', confidence: 0.95, reason: 'Beleg bestätigt das Angebot.' }) } }] }); } };
    const first = await getFeaturedDealEligibility(row('weekly'), 'weekly', options);
    assert.equal(first.eligible, true);
    const second = await getFeaturedDealEligibility(row('weekly'), 'weekly', options);
    assert.equal(second.llmActiveCheck.cacheHit, true);
    assert.equal(requests, 1); assert.equal(inspections, 2);
    heading = 'Pizza für 6 €';
    await getFeaturedDealEligibility(row('weekly'), 'weekly', options);
    assert.equal(requests, 2);
    await getFeaturedDealEligibility(row('weekly'), 'weekly', { ...options, now: new Date('2026-10-23T16:00:00Z') });
    assert.equal(requests, 3);
    const ended = await getFeaturedDealEligibility({ ...row('weekly'), expires: '2026-10-22' }, 'weekly', options);
    assert.equal(ended.eligible, false);
    assert.equal(requests, 3);
  } finally {
    if (old === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = old;
  }
});

test('weekly blocked evidence, inactive responses and API errors are never reused', async () => {
  const old = process.env.OPENAI_API_KEY;
  process.env.OPENAI_API_KEY = 'offline-fixture-not-a-real-key';
  try {
    for (const mode of ['blocked', 'inactive', 'error']) {
      const store = cache(); let requests = 0;
      const options = { now, cache: store,
        inspectUrl: async () => ({ status: mode === 'blocked' ? 403 : 200,
          blockedByProtection: mode === 'blocked', contentHints: { title: 'Pizza fuer 5 Euro' } }),
        request: async () => { requests++;
          if (mode === 'error') throw Error('offline model outage');
          return Response.json({ choices: [{ message: { content: JSON.stringify({
            decision: mode === 'inactive' ? 'inactive' : 'active', confidence: 0.95, reason: 'Offline test.' }) } }] });
        } };
      await getFeaturedDealEligibility(row('weekly'), 'weekly', options);
      const again = await getFeaturedDealEligibility(row('weekly'), 'weekly', options);
      assert.notEqual(again.llmActiveCheck?.cacheHit, true);
      assert.equal(requests, 2);
      assert.equal(Object.keys(store.entries).length, 0);
    }
  } finally {
    if (old === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = old;
  }
});


test('insertion and reorder preserve independent decisions; duplicates compare across batch boundaries', async () => {
  const store = cache();
  const calls = [];
  const classify = async (rows, _now, comparisons) => {
    calls.push({ ids: rows.map(row => row.id), comparisons });
    return response(rows);
  };
  const cinema = { ...row('kino'), title: 'Kinoeintritt', brand: 'Kino' };
  const books = { ...row('buch'), title: 'Buchrabatt', brand: 'Buchladen' };
  await reviewLiveDealBatches([cinema, row('pizza'), books], { cache: store, classify, now, chunkSize: 1 });
  calls.length = 0;
  const second = await reviewLiveDealBatches([books, row('pizza2'), cinema, row('pizza')], { cache: store, classify, now, chunkSize: 1 });
  assert.deepEqual(second.reviews.map(value => value.dealID), ['buch', 'pizza2', 'kino', 'pizza']);
  assert.equal(second.stats.cachedDeals, 2);
  assert.deepEqual(calls.map(call => call.ids), [['pizza2'], ['pizza']]);
  assert.equal(calls[0].comparisons[0].id, 'pizza');
  assert.equal(calls[1].comparisons[0].id, 'pizza2');
  calls.length = 0;
  await reviewLiveDealBatches([row('pizza'), cinema, books, row('pizza2')], { cache: store, classify, now, chunkSize: 2 });
  assert.equal(calls.length, 0);
});

test('unrelated rows cannot be returned or cached as duplicate targets', async () => {
  const store = cache();
  const result = await reviewLiveDealBatches([row('a')], { cache: store, now, classify: async rows => {
    const result = response(rows);
    Object.assign(result.parsed.reviews[0], { reason: 'duplicate', decision: 'remove', duplicateDealID: 'other' });
    return result;
  } });
  assert.equal(result.reviews.length, 0);
  assert.equal(result.stats.uncachedIncompleteGroups, 1);
  assert.equal(Object.keys(store.entries).length, 0);
});

test('stable undated and still-blocked sources are reused within 72h and removals remain day-sensitive', async () => {
  const fixture = { ...row('x'), validUntil: '', targetEvidence: { status: 'blocked' } };
  const dayTwo = new Date(+now + 86400000);
  for (const decision of ['flag', 'remove']) {
    const store = cache();
    const classify = async rows => {
      const result = response(rows);
      Object.assign(result.parsed.reviews[0], { decision, reason: decision === 'remove' ? 'expired' : 'weak_evidence' });
      return result;
    };
    await reviewLiveDealBatches([fixture], { cache: store, now, classify });
    const later = await reviewLiveDealBatches([fixture], { cache: store, now: dayTwo, classify });
    assert.equal(later.stats.cachedDeals, decision === 'remove' ? 0 : 1);
  }
});


test('live cache keeps generic current copy and young posts but rechecks actual temporal boundaries', () => {
  const base = { description: 'Dieser Coupon ist Teil der aktuellen Angebote.', publishedAt: '2026-10-20T08:00:00Z' };
  const clock = (input, at) => reviewClockContext(input, new Date(at), { liveFeedReview: true });
  const first = '2026-10-23T10:00:00Z';
  const later = '2026-10-24T10:00:00Z';
  assert.deepEqual(clock(base, first), clock(base, later));
  assert.notDeepEqual(clock(base, first), clock(base, '2026-10-27T12:00:00Z'));
  for (const description of ['Nur diesen Monat', 'Noch 2 Tage', 'Heute gratis', 'Jeden Dienstag']) {
    assert.notDeepEqual(clock({ ...base, description }, first), clock({ ...base, description }, later));
  }
});

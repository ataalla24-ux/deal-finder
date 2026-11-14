import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { copyReviewReasons, maintainFeedFile, maintainDeals } from './automatic-deal-maintenance.mjs';
import { createMaintenanceSourceEntry, maintenanceEvidenceFor, refreshMaintenanceEvidence } from './refresh-maintenance-evidence.mjs';
import { extractIamstudentApprovalSourceEvidence, reviewedIamstudentCopy } from '../scraper/approval-iamstudent-source-evidence.js';
import { projectEnrichmentDeal } from '../scraper/deal-enrichment-state.js';

const now = new Date('2026-11-14T12:00:00Z');
const policy = { version: 1, enabled: true, automaticLocalCopy: true, automaticExpiry: false, maxAiCandidatesPerRun: 4 };
const url = 'https://www.iamstudent.at/g/vapiano-gutschein-mit-50-prozent-studentenrabatt-gsh-wise26';
const html = fs.readFileSync(fileURLToPath(new URL('./fixtures/iamstudent-vapiano-20261114.html', import.meta.url)), 'utf8');
const evidence = extractIamstudentApprovalSourceEvidence(html, url, url);
const caption = 'Mit dem Gutschein erhältst du einen kostenlosen Kaffee. Das Angebot gilt nur für registrierte Mitglieder.';
const description = 'Registrierte Mitglieder bekommen nach Vorlage ihres Gutscheins einen Kaffee gratis.';
const pending = (id = 'pending') => projectEnrichmentDeal({ id, title: 'Gratis Kaffee mit Gutschein', brand: 'Fixture',
  url: 'https://example.org/offer', caption, description: 'Gratis Kaffee mit Gutschein', expiryKind: 'unknown',
  approvalPublicationMode: 'two-stage-v1', enrichmentPending: true, enrichmentFields: ['description', 'map'],
  enrichmentNextReviewAt: '2026-11-14T10:00:00Z' });

async function fixture(callback) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'live-enrichment-'));
  const old = process.env.OPENAI_API_KEY;
  process.env.OPENAI_API_KEY = 'offline-fixture-not-a-key';
  const put = (file, value) => { fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true }); fs.writeFileSync(path.join(root, file), JSON.stringify(value)); };
  try { put('reviews/automatic-maintenance-policy.json', policy); put('docs/deals.json', { deals: [] }); await callback({ root, put }); }
  finally { if (old === undefined) delete process.env.OPENAI_API_KEY; else process.env.OPENAI_API_KEY = old; fs.rmSync(root, { recursive: true, force: true }); }
}
function modelMock(calls, supported = true) {
  return async (_url, init) => {
    const request = JSON.parse(init.body), payload = JSON.parse(request.messages[1].content);
    calls.push(payload);
    const content = Object.hasOwn(payload, 'patch') ? { supported }
      : { title: '', quote: '', description, conditionsQuote: caption, dateQuote: '' };
    return Response.json({ choices: [{ finish_reason: 'stop', message: { content: JSON.stringify(content) } }] });
  };
}

test('a public placeholder stays pending and local title preparation cannot complete conditions', () => {
  const deal = pending();
  assert(copyReviewReasons(deal).includes('description'));
  assert(!copyReviewReasons(deal, new Set(['description'])).includes('description'));
  assert.deepEqual(maintainDeals([deal], { policy, now }).deals, [deal]);
});

test('disabled or unknown maintenance policy blocks fixed copy and AI even with four configured slots', () => fixture(async ({ root, put }) => {
  const deal = { ...pending(), url, brand: 'VAPIANO' };
  put('docs/deals.json', { deals: [deal] });
  put('reviews/maintenance-source-evidence.json', { entries: { [url]: createMaintenanceSourceEntry(deal, evidence, now) } });
  for (const disabled of [{ ...policy, enabled: false }, { ...policy, version: 2 }]) {
    put('reviews/automatic-maintenance-policy.json', disabled);
    const result = await maintainFeedFile({ cwd: root, now, allowAi: true, request: () => assert.fail('disabled policy') });
    assert.deepEqual(result.deals, [deal]);
    assert.equal(result.report.mode, 'disabled');
    assert(!fs.existsSync(path.join(root, 'reviews/automatic-deal-maintenance-state.json')));
  }
}));

test('fresh complete IAM evidence fills live conditions without a model and preserves map/date state', () => fixture(async ({ root, put }) => {
  const deal = { ...pending('vapiano'), url, brand: 'VAPIANO', title: 'VAPIANO: 1+1 Pasta für App-Neukunden', validUntil: '2027-02-28' };
  put('docs/deals.json', { deals: [deal] });
  put('reviews/maintenance-source-evidence.json', { entries: { [url]: createMaintenanceSourceEntry(deal, evidence, now) } });
  const result = await maintainFeedFile({ cwd: root, now, allowAi: true, request: () => assert.fail('no model call') });
  assert.equal(result.deals[0].description, reviewedIamstudentCopy(evidence).description);
  assert.equal(result.deals[0].validUntil, deal.validUntil, 'copy enrichment never changes a period');
  assert.equal(result.deals[0].enrichmentPending, true);
  assert.deepEqual(result.deals[0].enrichmentFields, ['map']);
  assert.equal(result.deals[0].distance, 'Wien · Standort folgt');
  assert.equal(result.report.ai.attempted, 0);
  assert.equal(result.state.corrections[0].method, 'reviewed-source-template-v1');
  assert.deepEqual(maintainDeals([deal], { policy, now, state: result.state,
    sourceEvidence: maintenanceEvidenceFor([deal], { entries: { [url]: createMaintenanceSourceEntry(deal, evidence, now) } }, now) }).deals, result.deals);
}));

test('stale, changed, rejected or missing current public evidence cannot reuse an old caption', () => fixture(async ({ root, put }) => {
  const deal = { ...pending(), url, brand: 'VAPIANO', caption: evidence.caption };
  const row = createMaintenanceSourceEntry(deal, evidence, now);
  for (const entry of [null, { ...row, checkedAt: '2026-11-12T12:00:00Z' }, { ...row, status: 'deferred' },
    { ...row, text: 'Changed conditions' }, { ...row, approvalSourceEvidence: { ...evidence, voucherId: 'other' } }]) {
    put('docs/deals.json', { deals: [deal] });
    put('reviews/maintenance-source-evidence.json', { entries: entry ? { [url]: entry } : {} });
    const result = await maintainFeedFile({ cwd: root, now, allowAi: true, request: () => assert.fail('no stale model review') });
    assert.deepEqual(result.deals, [deal]);
  }
}));

test('due descriptions take the existing four slots, retain feed order and never consume a fifth review', () => fixture(async ({ root, put }) => {
  const ordinary = { ...pending('ordinary'), enrichmentPending: false, enrichmentFields: [], description: '' };
  const deals = [ordinary, ...Array.from({ length: 5 }, (_, i) => pending(`due-${i}`)),
    { ...pending('future'), enrichmentNextReviewAt: '2026-11-15T12:00:00Z' },
    { ...pending('manual'), liveEditedFields: ['description'] }];
  put('docs/deals.json', { deals });
  const calls = [];
  const result = await maintainFeedFile({ cwd: root, now, allowAi: true, request: modelMock(calls) });
  assert.equal(result.report.ai.attempted, 4);
  assert.equal(calls.length, 8, 'four draft plus independent verification pairs');
  assert.deepEqual(result.deals.map(d => d.id), deals.map(d => d.id));
  for (const deal of result.deals.slice(1, 5)) { assert.equal(deal.description, description); assert.deepEqual(deal.enrichmentFields, ['map']); }
  assert.deepEqual(result.deals[0], ordinary);
  for (let i = 5; i < deals.length; i++) assert.deepEqual(result.deals[i], deals[i]);
}));

test('a veto keeps the placeholder, schedules a bounded retry and cannot rebill immediately', () => fixture(async ({ root, put }) => {
  put('docs/deals.json', { deals: [pending()] });
  const calls = [], request = modelMock(calls, false);
  const result = await maintainFeedFile({ cwd: root, now, allowAi: true, request });
  assert.equal(result.deals[0].description, pending().description);
  assert.deepEqual(result.deals[0].enrichmentFields, ['description', 'map']);
  assert.equal(result.deals[0].enrichmentNextReviewAt, '2026-11-14T13:00:00.000Z', 'map remains eligible at the earlier hourly pass');
  await maintainFeedFile({ cwd: root, now, allowAi: true, request });
  await maintainFeedFile({ cwd: root, now: new Date(+now + 2 * 3600000), allowAi: true, request });
  assert.equal(calls.length, 2);
}));

test('current Preisjaeger full-body evidence replaces its stale preview within one existing source slot', () => fixture(async ({ root, put }) => {
  const sourceUrl = 'https://www.preisjaeger.at/deals/mcdonalds-gratis-fussball-donut-zum-osterreich-match-372365';
  const source = fs.readFileSync(fileURLToPath(new URL('./fixtures/preisjaeger-donut-dom-20261114.html', import.meta.url)), 'utf8');
  const deal = { ...pending('donut'), url: sourceUrl, brand: "McDonald's" };
  put('docs/deals.json', { deals: [deal] });
  let calls = 0;
  const result = await refreshMaintenanceEvidence({ root, now, fetchPage: async value => {
    calls++; assert.equal(value, sourceUrl); return { html: source, finalUrl: sourceUrl, status: 200 };
  } });
  assert.equal(calls, 1);
  const current = maintenanceEvidenceFor([deal], result.cache, now).get(deal.id).officialText;
  assert(current.includes('17.11.2026'));
  assert(current.includes('Nicht über McDelivery'));
  assert(!current.includes('morgen wissen wir mehr'));
  assert.equal(result.report.sourceRequests, 1);
}));

test('source refresh prioritizes due public originals inside the same four offer attempts and caches the response', () => fixture(async ({ root, put }) => {
  const publicDeal = { ...pending('vapiano'), url, brand: 'VAPIANO' };
  const others = Array.from({ length: 5 }, (_, i) => ({ id: `carrier-${i}`, brand: 'Fixture',
    url: `https://www.drei.at/de/dreiplus/ersparnisse/fixture-${i}/`, description: '' }));
  put('docs/deals.json', { deals: [...others, publicDeal] });
  const calls = [];
  const fetchPage = async value => { calls.push(value); return { html: value === url ? html : '<html></html>', finalUrl: value, status: 200 }; };
  const result = await refreshMaintenanceEvidence({ root, now, fetchPage });
  assert.equal(calls[0], url);
  assert.equal(calls.length, 4);
  assert.equal(result.report.sourceRequests, 4);
  assert.equal(result.report.offerPageAttempts, 4);
  assert.equal(result.cache.entries[url].status, 'verified');
  assert.equal(maintenanceEvidenceFor([publicDeal], result.cache, now).get(publicDeal.id).officialText, evidence.caption);
  calls.length = 0;
  await refreshMaintenanceEvidence({ root, now, fetchPage });
  assert(!calls.includes(url), 'successful source read is not repeated every push');
}));

test('public refresh fails closed for refusal/redirect/changed terms and honours host pause without extending it', () => fixture(async ({ root, put }) => {
  const deal = { ...pending(), url, brand: 'VAPIANO' };
  put('docs/deals.json', { deals: [deal] });
  for (const page of [{ html, finalUrl: url, status: 403 }, { html, finalUrl: 'https://www.iamstudent.at/login', status: 200 },
    { html: html.replace('PASTALOVER', 'OTHER'), finalUrl: url, status: 200 }]) {
    put('reviews/maintenance-source-evidence.json', { entries: {} });
    const result = await refreshMaintenanceEvidence({ root, now, fetchPage: async () => page });
    assert.equal(result.cache.entries[url].status, 'deferred');
    assert(!maintenanceEvidenceFor([deal], result.cache, now).get(deal.id).officialText);
  }
  const paused = { entries: { [url]: { url, status: 'deferred', httpStatus: 429, nextAttemptAt: '2026-11-18T12:00:00Z' } } };
  put('reviews/maintenance-source-evidence.json', paused);
  const result = await refreshMaintenanceEvidence({ root, now, fetchPage: () => assert.fail('paused host is not requested') });
  assert.deepEqual(result.cache, paused);
}));

test('real transport shares the five-request cap with carrier robots and rejects public redirects without following', () => fixture(async ({ root, put }) => {
  const publicDeal = { ...pending(), url, brand: 'VAPIANO' };
  const carriers = Array.from({ length: 4 }, (_, i) => ({ id: `carrier-${i}`, brand: 'Fixture',
    url: `https://www.drei.at/de/dreiplus/ersparnisse/fixture-${i}/`, description: '' }));
  put('docs/deals.json', { deals: [publicDeal, ...carriers] });
  const calls = [];
  const fetchImpl = async (value, init) => {
    calls.push(value); assert.equal(init.redirect, 'manual');
    return new Response(value.endsWith('/robots.txt') ? 'User-agent: *\nAllow: /' : value === url ? html : '<html></html>',
      { headers: { 'content-type': 'text/html' } });
  };
  const result = await refreshMaintenanceEvidence({ root, now, fetchImpl });
  assert.equal(calls.length, 5);
  assert.equal(result.report.offerPageAttempts, 4);
  assert.equal(result.report.sourceRequests, 5);
  put('reviews/maintenance-source-evidence.json', { entries: {} });
  put('docs/deals.json', { deals: [publicDeal] });
  let redirects = 0;
  await refreshMaintenanceEvidence({ root, now, fetchImpl: async (_url, init) => {
    redirects++; assert.equal(init.redirect, 'manual'); return new Response('', { status: 302, headers: { location: 'https://example.org/' } });
  } });
  assert.equal(redirects, 1);
}));

import assert from 'node:assert/strict';
import { applyPendingEdit } from '../referrals-worker/src/pending-deal-editor.js';
import { mergeDealEvidence } from '../scraper/deal-evidence-utils.js';
import { normalizeDealExpiry, parseExpiryShape, parseExpiryDetails } from '../scraper/expiry-utils.js';
import { normalizeDealRecord } from '../scraper/deal-normalization-utils.js';
import { validateDealsForSlack } from '../scraper/deal-validity-agent.js';
import { normalizeDeal, mergeParsedDealsWithQueue } from '../scraper/slack-approve.js';
import { buildSlackMessage } from '../scraper/slack-notify.js';
import { parseDigestDealMessage } from '../scraper/slack-digest-utils.js';
import { prepareCommunityApproval } from '../scraper/community-review-utils.js';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const now = new Date('2026-11-12T12:00:00Z');
const fields = ['expires', 'expiresOriginal', 'expiryKind', 'expiryDisplayText', 'validOn', 'validFrom', 'validUntil'];
const pick = deal => Object.fromEntries(fields.map(key => [key, deal[key] || '']));
const base = { id: 'reviewed-food-window', title: 'Gratis Kaffee mit Reservierung', brand: 'Wien Test Cafe',
  description: 'Gratis Kaffee mit Reservierung, Rathausplatz 1, 1010 Wien.',
  distance: 'Rathausplatz 1, 1010 Wien', url: 'https://www.instagram.com/reel/DfjnFpnIN5i/',
  source: 'Instagram', sourcePublishedAt: '2026-11-11T10:00:00Z', sourcePublishedAtSource: 'instagram-graph-timestamp',
  slackTs: '1794391200.100', slackThreadTs: '1794391200.000', category: 'kaffee', type: 'gratis' };
const cases = [
  ['14.11.2026, 12:00 bis 14.11.2026, 15:00 Uhr', 'single', '2026-11-14', '2026-11-14', '2026-11-14T14:00:00.000Z'],
  ['21.11.2026, 11:00 bis 21.11.2026, 13:00 Uhr', 'single', '2026-11-21', '2026-11-21', '2026-11-21T12:00:00.000Z'],
  ['30.12.2026, 12:00 bis 02.01.2027, 15:00 Uhr', 'range', '2026-12-30', '2027-01-02', '2027-01-02T14:00:00.000Z'],
  ['verlängert bis 02.01.2027; jeweils Freitag und Samstag von Restaurantöffnung bis 10:30 Uhr', 'recurring', '', '2027-01-02', '2027-01-02T09:30:00.000Z'],
  ['Täglich, solange der Vorrat reicht; kein Enddatum angegeben', 'recurring', '', '', ''],
  ['Freitag und Samstag, jeweils bis 10:30 Uhr; gültig bis 02.01.2027', 'recurring', '', '2027-01-02', '2027-01-02T09:30:00.000Z'],
  ['Freitag und Samstag bis 10:30 Uhr, gültig bis 02.01.2027', 'recurring', '', '2027-01-02', '2027-01-02T09:30:00.000Z'],
];
const oldFetch = globalThis.fetch;
const normalizedFixtures = [];
globalThis.fetch = async url => { throw new Error(`No external requests allowed: ${url}`); };
try {
  for (const [literal, kind, from, until, expires] of cases) {
    const document = { deals: [{ ...base, expires: '2026-11-11', validUntil: '2026-11-11' }] };
    applyPendingEdit(document, { ...base, dealId: base.id, validityText: literal });
    const queue = document.deals[0];
    const parsed = parseDigestDealMessage({ text: buildSlackMessage(queue, 1), ts: base.slackTs, thread_ts: base.slackThreadTs });
    let deal = mergeParsedDealsWithQueue([parsed], [queue])[0];
    // Real approval deduplicates the queue and Slack copies before normalizing.
    deal = normalizeDeal(mergeDealEvidence(deal, { ...deal }, { now }));
    assert.equal(deal.expiresOriginal, literal, 'dedupe must retain the reviewed literal');
    for (let pass = 0; pass < 3; pass++) {
      const validation = await validateDealsForSlack([deal], { now, concurrency: 1,
        inspectDealUrlHealth: async url => ({ status: 200, finalUrl: url, dateHints: {},
          contentHints: { title: 'Gratis Kaffee am 21.11.2026' } }) });
      assert.equal(validation.results[0].decision.allowed, true, JSON.stringify(validation.results[0].decision));
      deal = validation.results[0].deal;
      await normalizeDealExpiry(deal, { now, allowUrlLookup: false });
      deal = normalizeDealRecord(deal);
      assert.equal(deal.expiryKind, kind, literal);
      assert.equal(deal.validFrom || '', from, literal);
      assert.equal(deal.validUntil || '', until, literal);
      assert.equal(deal.expires || '', expires, literal);
      assert.equal(deal.validOn || '', kind === 'single' ? from : '', literal);
      assert.equal(deal.expiresOriginal, literal);
      const before = pick(deal);
      deal = mergeDealEvidence(deal, { ...deal }, { now });
      assert.deepEqual(pick(deal), before, 'identical duplicate merging is idempotent');
    }
    normalizedFixtures.push({ ...deal, id: `${base.id}-${normalizedFixtures.length}` });
  }
  for (const [raw, expected] of [
    ['14.07.2027, 12:00 bis 14.07.2027, 15:00 Uhr', '2027-07-14T13:00:00.000Z'],
    ['2026-11-14T14:00:00.000Z', '2026-11-14T14:00:00.000Z'],
    ['2026-11-14T15:00:00+01:00', '2026-11-14T14:00:00.000Z'],
  ]) assert.equal(parseExpiryDetails(raw, { now })?.date.toISOString(), expected);
  assert.equal(parseExpiryShape('jeweils Freitag und Samstag bis 10:30 Uhr; gültig bis 02.01.2027', { now }).kind, 'recurring');
  assert.equal(parseExpiryShape('am Freitag, 13.11.2026 bis 10:30 Uhr', { now }).kind, 'single');
  const validation = async (deal, at = now, dateHints = {}) => (await validateDealsForSlack([{
    ...base, url: 'https://example.com/offer', source: 'Official', ...deal,
  }], { now: at, concurrency: 1, inspectDealUrlHealth: async url => ({ status: 200, finalUrl: url, dateHints, contentHints: {} }) })).results[0];
  const reviewed = literal => ({ expiresOriginal: literal, expiryDisplayText: literal,
    slackEditedAt: now.toISOString(), slackEditedFields: ['expiresOriginal'] });
  for (const literal of [
    '31.02.2027, 12:00 bis 31.02.2027, 15:00 Uhr',
    '14.11.2026, 15:00 bis 14.11.2026, 12:00 Uhr',
    '14.11.2026, 24:00 bis 15.11.2026, 01:00 Uhr',
    '14.11.2026, 12:00 bis 14.11.2026 Uhr',
    '28.03.2027, 02:30 bis 28.03.2027, 03:30 Uhr',
    '25.10.2026, 02:15 bis 25.10.2026, 02:45 Uhr',
  ]) {
    const result = await validation(reviewed(literal));
    assert.equal(result.decision.allowed, false, `invalid/nonexistent/ambiguous period: ${literal}`);
    assert.match(result.decision.reasons.join(' '), /Aktionszeitraum/);
  }
  assert.equal((await validation(reviewed(cases[0][0]), new Date('2026-11-14T14:01:00Z'))).decision.allowed, false, 'closed event is blocked at its Vienna closing instant');
  assert.equal((await validation({ expires: '2026-11-11', validUntil: '2026-11-11' }, new Date('2026-11-11T23:30:00Z'))).decision.allowed, false, 'Vienna calendar day, not UTC yesterday');
  const conflict = await validation(reviewed(cases[0][0]), now, {
    targetDateEvidence: 'explicit-phrase', targetDateRaw: 'Gültig bis 13.11.2026', targetDateKind: 'end', validUntil: '2026-11-13',
  });
  assert.equal(conflict.decision.allowed, false);
  assert.match(conflict.decision.reasons.join(' '), /widersprüchlich/);
  assert.equal((await validation({ ...reviewed('nur heute'), expires: '2026-11-11', validOn: '2026-11-11', expiryKind: 'single' })).decision.allowed, false, 'an old relative phrase must not acquire the run date');
  const recurringConflict = await validation(reviewed(cases[4][0]), now, {
    targetDateEvidence: 'explicit-phrase', targetDateRaw: 'Gültig bis 13.11.2026', targetDateKind: 'end', validUntil: '2026-11-13',
  });
  assert.equal(recurringConflict.decision.allowed, false, 'an explicit new source deadline cannot silently disappear behind a no-end review');

  const startEnd = { expires: '2026-11-16', expiresOriginal: '2026-11-16',
    validFrom: '2026-11-14', validUntil: '2026-11-16', expiryKind: 'range' };
  for (let pass = 0; pass < 3; pass++) {
    await normalizeDealExpiry(startEnd, { now, allowUrlLookup: false });
    assert.equal(startEnd.validFrom, '2026-11-14');
    assert.equal(startEnd.validUntil, '2026-11-16');
    assert.equal(startEnd.expiryKind, 'range');
  }
  const sourceWindow = { ...startEnd, expiresOriginal: '14.11.2026, 12:00 bis 16.11.2026, 15:00 Uhr',
    expires: '2026-11-16T14:00:00.000Z', expiryDisplayText: '14.11.2026, 12:00 bis 16.11.2026, 15:00 Uhr' };
  assert.deepEqual(pick(mergeDealEvidence(sourceWindow, { ...sourceWindow }, { now })), pick(sourceWindow), 'unmodified source windows survive dedupe too');
  const noEnd = { ...base, ...reviewed(cases[4][0]), expires: '', expiryKind: 'recurring' };
  assert.equal(mergeDealEvidence({ ...base, expires: '2026-12-31', validUntil: '2026-12-31' }, noEnd, { now }).expires, '', 'old duplicate cannot resurrect a removed inferred deadline');
  const community = prepareCommunityApproval({ ...base, ...reviewed(cases[0][0]),
    id: 'community:date-window', submissionId: 'date-window', originSource: 'community-submission',
    submittedAt: now.toISOString(), pipelineLifecycle: { manualDecision: 'approved', manualDecisionAt: now.toISOString(), manualDecisionUser: 'U_TEST' },
  }, now);
  await normalizeDealExpiry(community, { now, allowUrlLookup: false });
  assert.equal(community.expires, '2026-11-14T14:00:00.000Z', 'native community picker retains its actual clock too');
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'slack-date-pipeline-'));
  try {
    fs.writeFileSync(path.join(directory, 'deals.json'), JSON.stringify({ deals: normalizedFixtures, totalDeals: normalizedFixtures.length }));
    for (const file of ['deals-pending-church-gemeinde.json', 'deals-pending-church-gottesdienste.json', 'deals-pending-church-events.json']) {
      fs.writeFileSync(path.join(directory, file), JSON.stringify({ deals: [] }));
    }
    const freeze = `const RealDate=Date;globalThis.Date=class extends RealDate{constructor(...args){super(...(args.length?args:[${+now}]))}static now(){return ${+now}}};globalThis.fetch=async url=>{throw new Error('Forbidden network: '+url)};`;
    for (let pass = 0; pass < 2; pass++) {
      const child = spawnSync(process.execPath, ['--import', `data:text/javascript,${encodeURIComponent(freeze)}`, 'scraper/normalize-live-deals.js'], {
        cwd: fileURLToPath(new URL('../', import.meta.url)), encoding: 'utf8', timeout: 30000,
        env: { ...process.env, SENTRY_DISABLED: '1', LIVE_DEAL_DOCS_DIR: directory,
          LIVE_DEAL_VALIDATION_APPLY: '1', LIVE_DEAL_REMOVALS_ENABLED: '0', ALLOW_AUTOMATED_LIVE_REMOVALS: '0',
          MAX_LIVE_URL_HEALTH_CHECKS: '0', MAX_LIVE_URL_EXPIRY_REFRESHES: '0', MAX_LIVE_CONTENT_ENRICHMENTS: '0' },
      });
      assert.equal(child.status, 0, child.stderr || child.stdout);
      const live = JSON.parse(fs.readFileSync(path.join(directory, 'deals.json'), 'utf8'));
      assert.equal(live.deals.length, normalizedFixtures.length);
      for (const fixture of normalizedFixtures) assert.deepEqual(pick(live.deals.find(item => item.id === fixture.id)), pick(fixture), 'complete live-normalizer must retain the published period');
      const report = JSON.parse(fs.readFileSync(path.join(directory, 'live-deal-validation-report.json'), 'utf8'));
      assert.equal(report.linkChecksUsed, 0);
      assert.equal(report.expiryUrlChecksUsed, 0);
    }
  } finally { fs.rmSync(directory, { recursive: true, force: true }); }
  console.log('Slack date pipeline: seven window shapes, repeated round trips, conflicts, expired events, community, year change and DST passed (zero external calls)');
} finally { globalThis.fetch = oldFetch; }

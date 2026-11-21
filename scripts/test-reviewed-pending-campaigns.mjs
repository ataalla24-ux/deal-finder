import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { extractApprovalSourceEvidence } from '../scraper/approval-source-evidence.js';
import { readReviewedPizzaPost, prepareReviewedCampaign, reviewedCampaignHold,
  isReviewedCampaignRetry, reconcileReviewedCampaignExpiry } from '../scraper/reviewed-pending-campaigns.js';
import { validateApprovalCandidates } from '../scraper/slack-approve.js';

const rows = JSON.parse(readFileSync(new URL('./fixtures/reviewed-pending-campaigns-20261121.json', import.meta.url)));
const now = new Date('2026-11-21T12:17:00Z');
const approved = candidate => ({ ...candidate, pipelineLifecycle: { manualDecision: 'approved' }, approvalBlock: { reasons: ['gehalten'] } });
const proof = ({ candidate, meta, thread, finalUrl }) => meta
  ? readReviewedPizzaPost(meta, candidate.url, finalUrl)
  : extractApprovalSourceEvidence('<script>window.__INITIAL_STATE__=' + JSON.stringify({ threadDetail: thread }) + ';</script>', candidate.url, finalUrl);

test('three real review messages pass current-source checks, the expired November coupon stays blocked', async () => {
  for (const [index, row] of rows.entries()) {
    const evidence = proof(row);
    const result = await validateApprovalCandidates([approved(row.candidate)], { now, existingDeals: [],
      requireMap: false, approvalCachedReviewOnly: true, inspectDealUrlHealth: async () => ({
        status: 200, finalUrl: row.finalUrl, checkedAt: now.toISOString(), contentHints: {}, dateHints: {}, approvalSourceEvidence: evidence }) });
    const { deal, decision } = result.results[0];
    assert.equal(decision.allowed, index < 3, JSON.stringify(decision.reasons));
    if (index < 3) {
      assert.equal(deal.validUntil, ['2026-11-30', '2026-12-08', '2026-12-31'][index]);
      assert.equal(deal.expires, deal.validUntil + 'T22:59:59.999Z');
      assert.match(deal.description, [/8,50 €.*11,50 €/u, /Gutschein.*ab 16 Uhr.*8 €.*12 €/u, /D1001.*Elterleinplatz 8.*Nicht mit anderen Aktionen/u][index]);
    } else assert.ok(evidence.blockingReason);
  }
});

test('same-host canonical voucher identity, live status, owner and exact unchanged source facts are mandatory', () => {
  const [pizza, happy, burger, expired] = rows;
  for (const [oldValue, newValue] of [['Dfk5ZC8DiTM', 'Dfk5ZC8DiXX'], ['November 10, 2026', 'November 10, 2025'],
    ['8,50', '9,50'], ['4027596376569160908', '4027596376569160900'], ['m2_laromana', 'other']]) {
    assert.ok(proof({ ...pizza, meta: pizza.meta.replace(oldValue, newValue) }).blockingReason);
  }
  for (const patch of [{ isExpired: true }, { isMaybeExpired: true }, { expiryReportStatus: 'Pending' },
    { threadId: '123' }, { status: 'Deleted' }, { url: happy.finalUrl }, { type: 'Deal' }]) {
    assert.ok(proof({ ...burger, thread: { ...burger.thread, ...patch } }).blockingReason);
  }
  assert.ok(proof({ ...burger, finalUrl: expired.finalUrl }).blockingReason);
  for (const row of [happy, burger]) {
    for (const patch of [{ title: row.thread.title + ' beendet' }, { endDate: { timestamp: 0 } },
      { threadDetails: { preparedHtmlDescription: row.thread.threadDetails.preparedHtmlDescription + 'nur für Clubmitglieder' } }]) {
      const evidence = proof({ ...row, thread: { ...row.thread, ...patch } });
      assert.ok(reviewedCampaignHold(approved(row.candidate), { ...evidence, checkedAt: now.toISOString() }, now));
    }
  }
});

test('preserves human edits and the real reaction, rejects input after expiry and stale or missing source reads', () => {
  for (const row of rows.slice(0,3)) {
    const current = { ...proof(row), checkedAt: now.toISOString() };
    const input = approved(row.candidate);
    assert.equal(isReviewedCampaignRetry(input, now), true);
    for (const d of [{ ...input, editedInSlack: true }, { ...input, slackFormEditTs: '1' }, { ...input, pipelineLifecycle: { manualDecision: 'rejected' } }]) {
      assert.equal(prepareReviewedCampaign(d, current, now), d);
      assert.equal(isReviewedCampaignRetry(d, now), false);
    }
    for (const bad of [undefined, { ...current, checkedAt: '' }, { ...current, contentHash: 'mismatch' }, { ...current, blockingReason: 'withdrawn' }])
      assert.ok(reviewedCampaignHold(input, bad, now));
    assert.ok(reviewedCampaignHold(input, current, new Date('2027-01-01')));
    const result = prepareReviewedCampaign(input, current, now);
    const changed = { ...result, validUntil: '2027-02-12' };
    assert.equal(reconcileReviewedCampaignExpiry(changed), false);
  }
});

test('the second live HTML representation binds the same coupon images, terms, visible expiry and thread', () => {
  const body = readFileSync(new URL('./fixtures/preisjaeger-happy-hour-dom.html', import.meta.url), 'utf8');
  const row = rows[1];
  const parse = s => extractApprovalSourceEvidence(s, row.candidate.url, row.finalUrl);
  assert.equal(parse(body).campaignId, row.candidate.id);
  for (const [current, changed] of [['8 Dezember', '7 Dezember'], ['Deal endet am', 'Deal abgelaufen am'],
    ['data-image="372595-AhSGy"', 'data-image="372595-X"'], ['threads/raw/Gtfwu', 'threads/raw/X'],
    ['Gutscheine:', 'Gutscheine nur für Mitglieder:']]) {
    assert.ok(body.includes(current));
    assert.equal(parse(body.replace(current, changed)).campaignId, undefined);
  }
});

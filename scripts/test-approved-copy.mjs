import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { reviewApprovedCopy } from './automatic-deal-maintenance.mjs';

test('grounded Slack approval copy uses both roles once, respects edits and does not invent conditions', async () => {
  const cwd = await mkdtemp(join(tmpdir(), 'approved-copy-'));
  try {
    await mkdir(join(cwd, 'reviews'));
    await writeFile(join(cwd, 'reviews/automatic-maintenance-policy.json'), JSON.stringify({ version: 1, enabled: true, maxAiCandidatesPerRun: 4 }));
    const now = new Date('2026-11-13T14:00:00Z');
    const quote = 'Pizza um 7,90 Euro bei Abholung.';
    const conditions = `${quote} Gilt nur am 13.11.2026.`;
    const deal = { id: 'fixture', title: 'Mega Deal: Pizza', description: '', metaGraphCaption: conditions, submittedContent: 'not model input' };
    let calls = 0;
    const request = async (url, init) => {
      assert.equal(url, 'https://api.openai.com/v1/chat/completions');
      const body = JSON.parse(init.body);
      assert.equal(body.store, false);
      assert.ok(!JSON.stringify(body).includes('not model input'));
      calls++;
      const content = calls % 2 === 1 ? { title: 'Pizza für 7,90 € bei Abholung', quote,
        description: 'Bei Abholung kostet die Pizza 7,90 Euro. Nur am 13.11.2026.', conditionsQuote: conditions,
        dateQuote: 'Gilt nur am 13.11.2026.' } : { supported: true };
      return Response.json({ choices: [{ finish_reason: 'stop', message: { content: JSON.stringify(content) } }] });
    };
    const [result] = await reviewApprovedCopy([deal], { cwd, now, request });
    assert.equal(calls, 2);
    assert.match(result.title, /Abholung/);
    assert.match(result.description, /Abholung/);
    assert.equal(result.validOn, '2026-11-13');
    const [replayed] = await reviewApprovedCopy([{ ...deal, approvalCopyReview: result.approvalCopyReview }], { cwd, now, request });
    assert.equal(calls, 2);
    assert.deepEqual(replayed, result);
    const skipped = [ { ...deal, editedInSlack: true }, { ...deal, id: 'existing' }, { ...deal, metaGraphCaption: '' } ];
    assert.deepEqual(await reviewApprovedCopy(skipped, { cwd, now, request, existingIds: new Set(['existing']) }), skipped);
    assert.equal(calls, 2);
    const rejected = async (url, init) => {
      const response = await request(url, init);
      return calls % 2 ? response : Response.json({ choices: [{ finish_reason: 'stop', message: { content: '{"supported":false}' } }] });
    };
    const [unverified] = await reviewApprovedCopy([deal], { cwd, now, request: rejected });
    assert.equal(unverified.title, deal.title);
    assert.equal(unverified.approvalCopyReview.patch, undefined);
    assert.equal(calls, 4);

    const [first, waiting] = await reviewApprovedCopy([deal, { ...deal, id: 'second' }], { cwd, now, request });
    assert.equal(calls, 6, 'the existing one-candidate limit is not increased');
    assert.equal(waiting.approvalCopyReview.waitingForSlot, true);
    assert.equal(waiting.title, deal.title, 'a queued review cannot pretend to be complete');
    const [next] = await reviewApprovedCopy([waiting], { cwd, now, request });
    assert.equal(calls, 8, 'a run-limit deferral can use the next available slot immediately');
    assert.equal(next.approvalCopyReview.waitingForSlot, undefined);
    assert.equal(next.title, first.title);

    let failures = 0;
    const unavailable = async () => { failures++; throw new Error('fixture provider unavailable'); };
    const [deferred] = await reviewApprovedCopy([deal], { cwd, now, request: unavailable });
    assert.equal(deferred.approvalCopyReview.deferred, true);
    await reviewApprovedCopy([deferred], { cwd, now, request: unavailable });
    assert.equal(failures, 1, 'provider cooldown prevents repeated billed attempts');
    const [recovered] = await reviewApprovedCopy([deferred], {
      cwd, now: new Date(+now + 3600000), request,
    });
    assert.equal(recovered.approvalCopyReview.deferred, undefined);
    assert.equal(recovered.title, first.title);
    const [ownerEdited] = await reviewApprovedCopy([{ ...deferred, editedInSlack: true }], { cwd, now, request });
    assert.equal(ownerEdited.approvalCopyReview, undefined, 'obsolete holds do not override human corrections');
  } finally { await rm(cwd, { recursive: true, force: true }); }
});

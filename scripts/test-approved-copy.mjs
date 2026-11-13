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
  } finally { await rm(cwd, { recursive: true, force: true }); }
});

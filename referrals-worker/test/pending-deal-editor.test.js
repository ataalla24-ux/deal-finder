import test from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import worker from '../src/index.js';
import { normalizePendingEdit, parseOfferPeriod, pendingEditorValues, renderPendingEditor } from '../src/pending-deal-editor.js';
import { applyPendingEdit } from '../../scripts/apply-pending-deal-edit.mjs';

const base = { dealId: 'community:test', brand: 'Testlokal', title: '1+1 Pizza gratis', distance: 'Testgasse 1, 1010 Wien',
  description: 'Nur vor Ort, nur mit Gutschein.', url: '', validityText: '', validityMode: 'text' };
const picker = { ...base, validityMode: 'picker', periodStart: '2026-11-07', periodEnd: '2026-11-07',
  includeTime: '1', periodStartTime: '12:00', periodEndTime: '21:00' };

test('picker keeps full single-day and multi-day windows with both Vienna times', () => {
  const single = normalizePendingEdit(picker);
  assert.equal(single.validityText, '07.11.2026, 12:00 bis 07.11.2026, 21:00 Uhr');
  assert.equal(single.validFrom, '2026-11-07');
  assert.equal(single.validUntil, '2026-11-07');
  assert.equal(single.expiryKind, 'range');
  const multi = normalizePendingEdit({ ...picker, periodEnd: '2026-11-09' });
  assert.equal(multi.validUntil, '2026-11-09');
  assert.equal(multi.expiryDisplayText, '07.11.2026, 12:00 bis 09.11.2026, 21:00 Uhr');
  const allDay = normalizePendingEdit({ ...picker, includeTime: undefined, periodStartTime: 'broken' });
  assert.equal(allDay.validityText, '07.11.2026');
  assert.equal(allDay.validOn, '2026-11-07');
});

test('invalid calendar days, times, reversed windows and partial input are refused', () => {
  for (const change of [
    { periodStart: '2026-02-30' }, { periodEnd: '2026-13-07' }, { periodEnd: '' }, { periodStart: '' },
    { periodEnd: '2026-11-06' }, { periodEndTime: '11:59' }, { periodStartTime: '24:00' },
    { periodEndTime: '21:60' }, { periodStartTime: '' }, { periodStartTime: '', periodEndTime: '' },
  ]) assert.throws(() => normalizePendingEdit({ ...picker, ...change }), JSON.stringify(change));
  for (const raw of ['31.02.2026', '2026-11-31', '07.11.2026, 24:00 Uhr', '09.11.2026 bis 07.11.2026',
    '07.11.2026, 12:00 bis 09.11.2026']) assert.throws(() => normalizePendingEdit({ ...base, validityText: raw }), raw);
});

test('literal conditions and yearless periods are preserved, not guessed as dates', () => {
  for (const raw of ['', 'Jeden Montag, nur mit Mitgliedschaft', '7. November, 12 bis 21 Uhr', '14.–18.10.2026']) {
    const normalized = normalizePendingEdit({ ...base, validityText: raw });
    assert.equal(normalized.validityText, raw);
    assert.equal(normalized.expires, '');
    assert.equal(normalized.validFrom, undefined);
  }
  assert.equal(normalizePendingEdit({ ...base, validityText: '07.11.2026' }).validOn, '2026-11-07');
  assert.equal(parseOfferPeriod('07.11.2026, 12:00 bis 09.11.2026, 21:00 Uhr').end, '2026-11-09');
});

test('same fields and optional link as native submission; protocol and length guards retained', () => {
  assert.equal(normalizePendingEdit(base).url, '');
  assert.equal(normalizePendingEdit({ ...base, url: 'https://example.com/a' }).url, 'https://example.com/a');
  for (const field of ['brand', 'title', 'distance']) assert.throws(() => normalizePendingEdit({ ...base, [field]: '' }));
  for (const url of ['javascript:alert(1)', 'not-a-link', 'https://user:password@example.com', 'https://example.com/a b']) {
    assert.throws(() => normalizePendingEdit({ ...base, url }), url);
  }
  assert.throws(() => normalizePendingEdit({ ...base, validityText: 'x'.repeat(501) }));
  assert.throws(() => normalizePendingEdit({ ...base, description: 'x'.repeat(12001) }));
  assert.throws(() => normalizePendingEdit({ ...base, validityMode: 'unexpected' }));
});

test('draft edit persists period and conditions, preserving unrelated metadata and other deals', () => {
  const old = { ...base, id: base.dealId, url: 'https://example.com', expires: '2026-10-01',
    validOn: '2026-10-01', expiryDisplayText: '01.10.2026', submittedContent: { description: 'Original evidence' },
    slackTs: '123.4', votes: 3, approvalBlock: { reasons: ['old issue'] }, pipelineLifecycle: { stage: 'queued' } };
  const document = { deals: [old, { id: 'other', title: 'Unchanged' }] };
  const preserved = structuredClone(old);
  const result = applyPendingEdit(document, { ...normalizePendingEdit(picker), dealId: base.dealId });
  assert.equal(result.validFrom, '2026-11-07');
  assert.equal(result.validUntil, '2026-11-07');
  assert.equal(result.validOn, '');
  assert.equal(result.expiryDisplayText, '07.11.2026, 12:00 bis 07.11.2026, 21:00 Uhr');
  assert.equal(result.description, base.description);
  assert.equal(result.editedInSlack, true);
  for (const key of ['id', 'slackTs', 'votes', 'approvalBlock', 'pipelineLifecycle', 'submittedContent']) {
    assert.deepEqual(result[key], preserved[key], key);
  }
  assert.equal(document.deals[1].title, 'Unchanged');
  assert.equal(result.approvedAt, undefined);
});

test('copy-only edits keep exact preexisting date evidence; explicit clearing removes stale dates', () => {
  const record = { ...base, id: base.dealId, expires: '2026-11-09', validFrom: '2026-11-07', validUntil: '2026-11-09',
    expiresOriginal: '2026-11-09', expiryKind: 'range', dateConfidence: 'medium', expirySource: 'original.source' };
  const document = { deals: [record] };
  const initial = pendingEditorValues(record);
  assert.equal(initial.validityText, '07.11.2026 bis 09.11.2026');
  applyPendingEdit(document, { ...normalizePendingEdit(initial), dealId: base.dealId, title: 'New title' });
  assert.equal(record.expiresOriginal, '2026-11-09');
  assert.equal(record.dateConfidence, 'medium');
  assert.equal(record.expirySource, 'original.source');
  applyPendingEdit(document, { ...base, validityText: '' });
  for (const field of ['validFrom', 'validUntil', 'validOn', 'expiryKind', 'dateConfidence']) assert.equal(record[field], undefined, field);
  assert.equal(record.expires, '');
  assert.equal(pendingEditorValues(record).validityText, '');
});

test('invalid draft edits are atomic and legacy single-expiry workflow inputs still work', () => {
  const document = { deals: [{ id: base.dealId, title: 'Original' }] };
  const snapshot = structuredClone(document);
  assert.throws(() => applyPendingEdit(document, { ...picker, periodEnd: '2026-02-30' }));
  assert.deepEqual(document, snapshot);
  const { validityText, validityMode, ...legacy } = base;
  applyPendingEdit(document, { ...legacy, expires: '2026-11-07' });
  assert.equal(document.deals[0].validUntil, '2026-11-07');
  assert.throws(() => applyPendingEdit(document, { ...legacy, expires: '2026-11-31' }));
});

test('form escapes all values, never truncates existing text or enables scripts', async () => {
  const response = renderPendingEditor({ deal: { ...base, description: '</textarea><script>alert(1)</script>', brand: '" autofocus onfocus="evil' },
    payload: '"><script>evil</script>', sig: 'sig' });
  const html = await response.text();
  for (const key of ['brand', 'title', 'distance', 'validityText', 'periodStart', 'periodEnd', 'includeTime', 'periodStartTime', 'periodEndTime', 'url', 'description']) {
    assert.ok(html.includes(`name="${key}"`), key);
  }
  assert.ok(!html.includes('<script>'));
  assert.ok(html.includes('&lt;/textarea&gt;'));
  assert.ok(!/name="url"[^>]*required/.test(html));
  assert.equal(response.headers.get('referrer-policy'), 'no-referrer');
  assert.ok(response.headers.get('content-security-policy').startsWith("default-src 'none';"));
});

test('signed route dispatches full new period to draft workflow only; invalid requests never dispatch', async () => {
  const env = { DEAL_REMOVE_LINK_SECRET: 'offline-secret', GITHUB_WORKFLOW_TOKEN: 'offline-token' };
  const payload = Buffer.from(JSON.stringify({ dealId: base.dealId, scope: 'pending-edit' })).toString('base64url');
  const sig = createHmac('sha256', env.DEAL_REMOVE_LINK_SECRET).update(payload).digest('hex');
  const previousFetch = globalThis.fetch;
  const dispatches = [];
  globalThis.fetch = async (url, init) => {
    if (String(url).includes('/dispatches')) {
      dispatches.push({ url: String(url), body: JSON.parse(init.body) });
      return new Response(null, { status: 204 });
    }
    return Response.json({ deals: [{ ...base, id: base.dealId, expires: '', validityText: undefined,
      expiresOriginal: '07.11.2026, 12:00 bis 07.11.2026, 21:00 Uhr' }] });
  };
  const endpoint = 'https://test/api/deals/admin/pending-edit';
  const post = fields => worker.fetch(new Request(endpoint, { method: 'POST', body: new URLSearchParams({ ...fields, payload, sig }) }), env, {});
  try {
    const get = await worker.fetch(new Request(`${endpoint}?${new URLSearchParams({ payload, sig })}`), env, {});
    assert.equal(get.status, 200);
    assert.equal(dispatches.length, 0);
    for (const fields of [{ ...picker, periodEndTime: '11:00' }, { ...base, brand: '' }, { ...base, url: 'javascript:evil' }]) {
      const result = await post(fields);
      assert.equal(result.status, 400);
      const html = await result.text();
      assert.ok(html.includes('Testgasse 1, 1010 Wien'));
      if (!fields.includeTime) assert.ok(!/<input[^>]*name="includeTime"[^>]*checked/.test(html), 'unchecked time setting must survive a validation error');
      assert.equal(dispatches.length, 0);
    }
    const result = await post(picker);
    assert.equal(result.status, 200);
    assert.equal(dispatches.length, 1);
    assert.ok(dispatches[0].url.includes('pending-deal-edit.yml'));
    const edit = JSON.parse(dispatches[0].body.inputs.edit_payload);
    assert.equal(edit.validityText, '07.11.2026, 12:00 bis 07.11.2026, 21:00 Uhr');
    assert.equal(edit.validFrom, '2026-11-07');
    assert.equal(edit.validUntil, '2026-11-07');
    assert.equal(edit.url, '');
    assert.equal(edit.description, base.description);
    assert.ok(!dispatches[0].url.includes('live-deal-edit'));
    const bad = await worker.fetch(new Request(endpoint, { method: 'POST', body: new URLSearchParams({ ...picker, payload, sig: 'bad' }) }), env, {});
    assert.equal(bad.status, 401);
    assert.equal(dispatches.length, 1);
  } finally { globalThis.fetch = previousFetch; }
});

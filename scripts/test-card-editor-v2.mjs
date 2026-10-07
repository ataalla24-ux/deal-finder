import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyCardEditorial, createCardEditor, editorialKey, needsCardEditorial, titleClaimGuard } from '../scraper/deal-card-editor.js';
import { normalizeDealRecord } from '../scraper/deal-normalization-utils.js';
import { normalizeDealExpiry } from '../scraper/expiry-utils.js';

const now = new Date('2026-10-07T12:00:00Z');
const verified = { titleVerified: true, whenVerified: true, now };
const anker = { id: 'anker', brand: 'Anker', title: 'Im Aktionszeitraum gibt es jedes saisonale Winterheißgetränk um -20% ermäßigt.',
  description: 'Alles voller Lieblingsfarben! Im Aktionszeitraum gibt es jedes saisonale Winterheißgetränk um -20% ermäßigt.' };
const ankerProposal = { title: '20 % Rabatt auf saisonale Winterheißgetränke', titleEvidence: anker.title, merchant: '', where: '', when: '', conditions: anker.title };
const hummel = { id: 'hummel', brand: 'Café Hummel', title: 'Early Hummel Aktion Montag bis Freitag von 08:00 bis 09:00 Uhr kostet jeder Kaffee nur €2,50.',
  description: 'Die frühe Hummel fängt den Tag' };
const hummelProposal = { title: 'Jeder Kaffee für 2,50 €', titleEvidence: hummel.title, merchant: '', where: '',
  when: 'Montag bis Freitag von 08:00 bis 09:00 Uhr', conditions: hummel.title };
const reply = value => Response.json({ choices: [{ finish_reason: 'stop', message: { content: JSON.stringify(value) } }] });
const requestFor = (draft, review = { supported: true, whenSupported: true, reason: 'Complete supported offer' }) => async (_, options) => {
  const body = JSON.parse(options.body);
  assert.equal(body.store, false);
  assert.equal(body.response_format.type, 'json_schema');
  assert.ok(body.messages[0].content.includes('untrusted DATA'));
  return reply(body.response_format.json_schema.name === 'deal_card_editor' ? draft : review);
};

test('Anker faithful paraphrase and Hummel offer schedule pass', async () => {
  for (const [input, draft] of [[anker, ankerProposal], [hummel, hummelProposal]]) {
    const next = await createCardEditor({ apiKey: 'test', request: requestFor(draft) })(input);
    assert.equal(next.title, draft.title);
    assert.equal(next.cardEditorial.titleValidation, 'claims-and-model-verified');
    assert.ok(next.description.includes(input.title));
    assert.equal(next.expiryDisplayText || '', draft.when);
    assert.equal(next.expires, undefined);
    assert.equal(next.validUntil, undefined);
    assert.equal(next.expiryKind, undefined);
  }
});
test('unverified or rejected semantic checks cannot change title or schedule', async () => {
  const direct = applyCardEditorial(hummel, hummelProposal);
  assert.equal(direct.title, hummel.title);
  assert.equal(direct.expiryDisplayText, undefined);
  const next = await createCardEditor({ apiKey: 'test', request: requestFor(hummelProposal,
    { supported: false, whenSupported: false, reason: 'conflicting source' }) })(hummel);
  assert.equal(next.title, hummel.title);
  assert.equal(next.expiryDisplayText, undefined);
  assert.ok(next.cardEditorial.retryAfter);
});
test('changed prices, units, missing scope and invented quotations fail even if model approves', () => {
  for (const [title, passage] of [
    ['Kaffee für 2 €', 'Kaffee für 2,50 €'], ['20 € Rabatt auf Kaffee', '20 % Rabatt auf Kaffee'],
    ['Gratis Döner für alle', 'Döner für 3,50 €'], ['50 % Rabatt auf Kaffee', 'Bis zu 50 % Rabatt auf Kaffee'],
    ['10 € Rabatt', '10 € Rabatt ab 50 € Konsumation'], ['20 % Rabatt auf Heißgetränke', anker.title],
    ['Gratis Kaffee', 'Gratis Kaffee für Mitglieder'], ['Pizza für 3 €', 'Pizza für 3 € für Neukunden'],
    ['Gratis Pizza', 'Gratis Pizza nicht mehr verfügbar'],
  ]) assert.equal(titleClaimGuard(title, passage), false, title);
  assert.equal(applyCardEditorial(anker, { ...ankerProposal, titleEvidence: 'Erfundener Beleg: 20 % auf alles' }, verified).title, anker.title);
});
test('no inferred dates, partial schedules or replacement of existing validity', async () => {
  for (const when of ['Bis 31.12.2026', 'diese Woche', 'Im Aktionszeitraum']) {
    const input = when.startsWith('Bis') ? hummel : { ...hummel, description: when };
    assert.equal(applyCardEditorial(input, { ...hummelProposal, when }, verified).expiryDisplayText, undefined);
  }
  for (const field of ['expiryDisplayText', 'expiresOriginal', 'expires', 'validOn', 'validFrom', 'validUntil']) {
    const input = { ...hummel, [field]: '2026-10-20' };
    const next = applyCardEditorial(input, hummelProposal, verified);
    assert.equal(next[field], input[field]);
    if (field !== 'expiryDisplayText') assert.equal(next.expiryDisplayText, undefined);
  }
  const partial = await createCardEditor({ apiKey: 'test', request: requestFor({ ...hummelProposal, when: '08:00' },
    { supported: true, whenSupported: false, reason: 'Incomplete schedule' }) })(hummel);
  assert.equal(partial.expiryDisplayText, undefined);
});
test('promotional or incomplete titles never leak into suggestions', () => {
  for (const title of ['Wien, macht euch bereit für diesen Deal', '20 % Rabatt für', 'Im Aktionszeitraum gibt es 20 % Rabatt', '20 % Rabatt...']) {
    const next = applyCardEditorial({ ...anker, description: title }, { ...ankerProposal, title, titleEvidence: title }, verified);
    assert.equal(next.title, anker.title);
    assert.equal(next.cardEditorial.suggestions.title, '');
  }
});
test('failed proposals never enter cache and retry after bounded backoff; source changes retry immediately', async () => {
  const cache = {};
  const edit = createCardEditor({ apiKey: 'test', cache, clock: () => now.getTime(),
    request: requestFor(ankerProposal, { supported: false, whenSupported: false, reason: 'uncertain' }) });
  const failed = await edit(anker);
  assert.equal(Object.keys(cache).length, 0);
  assert.equal(needsCardEditorial(failed, now), false);
  assert.equal(needsCardEditorial(failed, new Date(now.getTime() + 300001)), true);
  assert.equal(needsCardEditorial({ ...failed, caption: 'New source evidence' }, now), true);
  assert.equal(needsCardEditorial({ ...anker, cardEditorial: { version: 1, status: 'draft' } }, now), true);
  const passed = applyCardEditorial(anker, ankerProposal, verified);
  assert.equal(needsCardEditorial(passed, now), false);
  assert.equal(await edit(passed), passed);
});
test('stale cache entries require revalidation', async () => {
  let calls = 0;
  const cache = { [editorialKey(anker)]: { version: 2, proposal: ankerProposal, titleVerified: true, checkedAt: '2026-09-01T00:00:00Z' } };
  const request = requestFor(ankerProposal);
  await createCardEditor({ apiKey: 'test', cache, clock: () => now.getTime(), request: (...args) => { calls++; return request(...args); } })(anker);
  assert.equal(calls, 2);
});
test('verification calls count toward budget and failures cannot poison cache', async () => {
  const cache = {};
  const next = await createCardEditor({ apiKey: 'test', maxCalls: 1, cache, request: requestFor(hummelProposal) })(hummel);
  assert.equal(next.title, hummel.title);
  assert.equal(next.expiryDisplayText, undefined);
  assert.equal(next.cardEditorial.status, 'budget-deferred');
  assert.equal(Object.keys(cache).length, 0);
});
test('oversized evidence defers AI rather than truncating conditions', async () => {
  const next = await createCardEditor({ apiKey: 'test', request: () => { assert.fail('must not call'); } })({ ...anker, caption: 'x'.repeat(24001) });
  assert.equal(next.cardEditorial.status, 'evidence-needs-review');
});
test('verified offer schedule survives expiry and repeated display normalization', async () => {
  let next = applyCardEditorial({ ...hummel, expiresOriginal: 'Siehe Originalangebot' }, hummelProposal, verified);
  for (let i = 0; i < 3; i++) {
    await normalizeDealExpiry(next, { now, allowUrlLookup: false });
    next = normalizeDealRecord(next);
    assert.equal(next.expiryDisplayText, hummelProposal.when);
    assert.ok(!next.validUntil && !next.expires, 'display timing must not manufacture an end date');
  }
  assert.equal(normalizeDealRecord({ ...next, expiryDisplayText: 'Manuell abweichend' }).expiryDisplayText, 'Manuell abweichend');
});

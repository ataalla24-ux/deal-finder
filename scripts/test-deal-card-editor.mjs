import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyCardEditorial, createCardEditor, editorialKey } from '../scraper/deal-card-editor.js';

const deal = { id: 'a', title: 'Wien, macht euch bereit für diesen Deal', brand: 'Box 16',
  description: 'Chicken Döner für 3,50 €. Nur für Mitglieder, maximal 1 Stück. Gutschein BOX16 erforderlich.',
  metaGraphCaption: 'Box 16: Chicken Döner für 3,50 €. Gültig am 26.09.2026, 12–16 Uhr. Nur vor Ort: Ottakringer Straße 1, 1160 Wien.',
  distance: '1160 Wien', expires: '2026-09-26', validOn: '2026-09-26', url: 'https://www.instagram.com/p/test/',
};
const proposal = { title: 'Chicken Döner für 3,50 €', merchant: 'Box 16',
  where: 'Ottakringer Straße 1, 1160 Wien', when: 'Gültig am 26.09.2026, 12–16 Uhr',
  conditions: 'Nur für Mitglieder, maximal 1 Stück. Gutschein BOX16 erforderlich.' };
const reply = value => Response.json({ choices: [{ finish_reason: 'stop', message: { content: JSON.stringify(value) } }] });

test('short factual title, full conditions and original text preserved', () => {
  const next = applyCardEditorial(deal, proposal);
  assert.equal(next.title, proposal.title);
  assert.ok(next.description.includes(deal.description));
  assert.equal(next.cardEditorial.originalTitle, deal.title);
  assert.equal(next.cardEditorial.originalDescription, deal.description);
  assert.equal(next.cardEditorial.requiresReview, true);
  for (const field of ['brand', 'distance', 'expires', 'validOn', 'url', 'id']) assert.equal(next[field], deal[field]);
  assert.equal(deal.cardEditorial, undefined);
});
test('unsupported paraphrases, price changes and invented dates rejected', () => {
  const next = applyCardEditorial(deal, { ...proposal, title: 'Gratis Döner für alle', when: 'Bis 31.12.2026', where: 'Stephansplatz 1' });
  assert.equal(next.title, deal.title);
  assert.equal(next.cardEditorial.suggestions.when, '');
  assert.equal(next.cardEditorial.suggestions.where, '');
  assert.ok(next.cardEditorial.warnings.length >= 3);
});
test('promotional titles are not accepted as rewritten titles', () => {
  assert.equal(applyCardEditorial(deal, { ...proposal, title: deal.title }).cardEditorial.suggestions.title, deal.title);
  assert.ok(applyCardEditorial(deal, { ...proposal, title: deal.title }).cardEditorial.warnings.some(w => w.includes('Original prüfen')));
});
test('all manual or published records bypass AI unchanged', async () => {
  const edit = createCardEditor({ apiKey: 'test', request: () => { throw Error('must not call'); } });
  for (const flag of [{ editedInSlack: true }, { slackEditedAt: 'today' }, { slackEditedFields: ['title'] }, { approvedAt: 'today' }, { pipelineLifecycle: { publishedAt: 'today' } }]) {
    const input = { ...deal, ...flag };
    assert.equal(await edit(input), input);
  }
});
test('cache avoids repeat API calls, changed evidence invalidates cache', async () => {
  let calls = 0;
  let saves = 0;
  const cache = {};
  const edit = createCardEditor({ apiKey: 'test', cache, request: async (_, options) => {
    calls++;
    const body = JSON.parse(options.body);
    assert.equal(body.store, false);
    assert.equal(body.response_format.type, 'json_schema');
    return reply(proposal);
  }, onCache: () => { saves++; } });
  assert.equal((await edit(deal)).title, proposal.title);
  assert.equal((await edit(deal)).title, proposal.title);
  assert.equal(calls, 1); assert.equal(saves, 1);
  assert.notEqual(editorialKey(deal), editorialKey({ ...deal, description: 'different' }));
  await edit({ ...deal, description: 'different' });
  assert.equal(calls, 2);
});
test('API outages, absent key and budget never drop a deal', async () => {
  for (const options of [{ apiKey: '' }, { apiKey: 'test', maxCalls: 0 },
    { apiKey: 'test', request: async () => { throw Error('timeout'); } },
    { apiKey: 'test', request: async () => Response.json({}, { status: 429 }) },
    { apiKey: 'test', request: async () => reply({ title: 'wrong schema' }) }]) {
    const next = await createCardEditor(options)(deal);
    assert.equal(next.title, deal.title);
    assert.ok(next.description.includes(deal.description));
    assert.equal(next.id, deal.id);
    assert.equal(next.cardEditorial.requiresReview, true);
  }
});
test('additional supported conditions appended, never replace original ones', () => {
  const next = applyCardEditorial(deal, { ...proposal, conditions: 'Nur vor Ort' });
  assert.ok(next.description.includes('Gutschein BOX16 erforderlich.'));
  assert.ok(next.description.includes('Nur vor Ort'));
});
test('dispatch time budget defers AI without blocking delivery', async () => {
  let now = 0;
  const edit = createCardEditor({ apiKey: 'test', clock: () => now, maxDurationMs: 100,
    request: async () => { throw Error('must not call'); } });
  now = 101;
  const next = await edit(deal);
  assert.equal(next.id, deal.id);
  assert.equal(next.cardEditorial.status, 'time-budget-deferred');
});

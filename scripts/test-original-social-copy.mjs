import assert from 'node:assert/strict';
import test from 'node:test';
import { assessOriginalSocialCopy } from './original-social-copy.mjs';
import { maintainDeals } from './automatic-deal-maintenance.mjs';

const url = 'https://www.instagram.com/p/DfzZuz8iLNh/';
const now = new Date('2026-11-16T16:55:00Z');
const caption = [
  '🍪🚀 HOTBOWL + GRATIS KOOKIE CAT COOKIE',
  'Zu jeder Hotbowl legen wir dir einen Kookie Cat Cookie gratis dazu. 🍪',
  '🥗 Warme Bowl, hausgemacht und bio, frisch angerichtet.',
  '📍 Pfauengasse 8, 1060 Wien, mitten in Mariahilf',
  '🕛 Mo bis Sa, 12:00 bis 21:00',
  '💬 Schreib uns in die Kommentare: mit welcher Hotbowl startest du in die Woche?',
  '🛸 Wolt: https://wolt.com/de/aut/vienna/restaurant/spacebowls-bio-streetfood',
  '🛸 foodora: https://www.foodora.at/restaurant/kq7w/spacebowls',
  '🛸 Lieferando: https://www.lieferando.at/speisekarte/spacebowls #spacebowls #vienna',
].join('\n');
const deal = {
  id: 'meta-ig-17868632664677829', url, brand: 'foodora', description: caption,
  title: '🍪🚀 Hotbowl plus gratis Kookie Cat Cookie Zu jeder Hotbowl legen wir dir einen Kookie Cat Cookie...',
  logoUrl: 'https://freefinder.at/assets/brand-logos/foodora-foodora-at.png',
  sourcePublishedAt: '2026-11-16T12:54:01Z', sourcePublishedAtSource: 'url.instagramShortcode',
  evidence: { mediaId: '17868632664677829' }, approvedAt: '2026-11-16T14:57:47.190Z',
  address: 'Pfauengasse 8, 1060 Wien',
  validUntil: null, validFrom: null, votingEnabled: true,
};
const source = {
  url, mediaId: deal.evidence.mediaId, caption, graphAccepted: true,
  sourcePublishedAt: '2026-11-16T12:54:15Z', sourcePublishedAtSource: 'instagram-graph-timestamp',
  verifiedAt: '2026-11-16T14:39:53.646Z',
};
const expected = {
  title: 'Gratis Kookie Cat Cookie zu jeder Hotbowl',
  description: 'Zu jeder Hotbowl gibt es einen Kookie Cat Cookie gratis dazu. Pfauengasse 8, 1060 Wien. Mo bis Sa, 12:00 bis 21:00.',
  brand: 'Spacebowls', logoUrl: '',
};

test('exact Graph caption proves the restaurant, extra and each named main item', () => {
  assert.deepEqual(assessOriginalSocialCopy(deal, source, now)?.patch, expected);
  assert.equal(assessOriginalSocialCopy({ ...deal, ...expected }, source, now), null);
  const otherCaption = caption.replaceAll('HOTBOWL', 'SUPPE').replaceAll('Hotbowl', 'Suppe')
    .replaceAll('KOOKIE CAT COOKIE', 'BROT').replaceAll('Kookie Cat Cookie', 'Brot')
    .replaceAll('einen Brot', 'ein Brot').replaceAll('spacebowls', 'suppenkueche');
  assert.deepEqual(assessOriginalSocialCopy({ ...deal, brand: 'lieferando', description: otherCaption,
    logoUrl: 'https://freefinder.at/assets/brand-logos/lieferando-lieferando-at.png' }, { ...source, caption: otherCaption }, now)?.patch, {
    title: 'Gratis Brot zu jeder Suppe',
    description: 'Zu jeder Suppe gibt es ein Brot gratis dazu. Pfauengasse 8, 1060 Wien. Mo bis Sa, 12:00 bis 21:00.',
    brand: 'Suppenkueche', logoUrl: '',
  });
});

test('caption grounding rejects record drift, false attribution and hidden or uncertain terms', () => {
  for (const change of [
    { mediaId: '7890000000000000' },
    { url: 'https://www.instagram.com/p/DfRuATHiGLU/' },
    { graphAccepted: false },
    { blockingReason: 'source-blocked' },
    { sourcePublishedAt: '2026-11-14T12:54:15Z' },
    { ocrText: 'Nur ab zwei Hauptgerichten.', },
    { verifiedAt: '2026-11-17T14:00:00Z' },
  ]) assert.equal(assessOriginalSocialCopy(deal, { ...source, ...change }, now), null, JSON.stringify(change));
  for (const changedCaption of [
    caption.replace('/speisekarte/spacebowls', '/speisekarte/anderes-lokal'),
    caption.replace('/restaurant/kq7w/spacebowls', '/restaurant/kq7w/anderes-lokal'),
    caption.replace(' #spacebowls ', ' #foodora '),
    caption.replace('https://www.foodora.at/', 'https://www.foodora.at.example.org/'),
    caption.replace('Zu jeder Hotbowl', 'Nicht zu jeder Hotbowl'),
    caption.replace('HOTBOWL + GRATIS', 'Nur heute: HOTBOWL + GRATIS'),
    `${caption} Pro Person nur ein Cookie.`,
    `${caption} Nur mit Gutschein.`,
    `${caption} Mit einem Einkauf ab 10 €.`,
    `${caption} Die Aktion gilt nur zur Abholung.`,
    `${caption} Wir verlosen den Vorteil unter unseren Mitgliedern.`,
    `${caption} Bestellt über unsere App.`,
    `${caption} #NurMitGutschein`,
  ]) assert.equal(assessOriginalSocialCopy({ ...deal, description: changedCaption }, { ...source, caption: changedCaption }, now), null, changedCaption);
  assert.equal(assessOriginalSocialCopy({ ...deal, description: 'Redaktionell geprüft und ergänzt.' }, source, now), null);
  assert.equal(assessOriginalSocialCopy({ ...deal, brand: 'Already verified merchant' }, source, now), null);
});

test('maintenance preserves manual edits, reproofs archive replays and leaves unrelated feed fields exact', () => {
  const run = (record = deal, options = {}) => maintainDeals([record], {
    now, policy: { version: 1, enabled: true, automaticLocalCopy: true },
    sourceEvidence: new Map([[record.id, source]]), ...options,
  });
  const result = run();
  assert.deepEqual(result.deals, [{ ...deal, ...expected }]);
  assert.equal(result.report.corrected[0].method, 'verified-original-social-copy');
  assert.deepEqual(result.state.corrections[0].originalDeal, deal);
  assert.deepEqual(run(result.deals[0], { state: result.state }).state, result.state);
  const blocked = run(deal, { state: result.state, sourceEvidence: new Map([[deal.id, { ...source, mediaId: '9990000000000000' }]]) });
  assert.equal(blocked.deals[0].brand, 'foodora');
  assert.equal(blocked.report.corrected.some(row => row.method === 'verified-original-social-copy'), false);
  for (const [record, options] of [
    [{ ...deal, liveEditedFields: ['brand'] }, {}],
    [{ ...deal, editedInSlack: true }, {}],
    [deal, { edits: [{ dealId: deal.id, description: 'Eigene Redaktion.' }] }],
    [deal, { edits: [{ dealId: deal.id, hidden: true }] }],
  ]) {
    assert.equal(run(record, options).report.corrected.some(row => row.method === 'verified-original-social-copy'), false);
  }
});

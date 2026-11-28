import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import { createHash } from 'node:crypto';
import { captureApprovedExpiryEvidence } from './approved-expiry-evidence.mjs';
import { assessLiveDealSourceConsistency as assess, auditLiveDealSourceConsistency as audit } from './live-deal-source-consistency.mjs';

const now = new Date('2026-11-28T10:00:00.000Z');
const sha = value => createHash('sha256').update(value).digest('hex');
const approvedAt = '2026-11-27T12:00:00.000Z';
function receiptDeal(text, patch = {}) {
  const deal = { id: 'fixture-coffee', url: 'https://example.com/coffee-offer', brand: 'Café Beispiel',
    title: 'Kaffee für 3 €', description: 'Kaffee für 3 €. Gültig bis 7.12.2026.', approvedAt,
    validUntil: '2026-12-07', expiryKind: 'end', expires: '2026-12-07T22:59:59.999Z', ...patch };
  deal.approvedExpiryEvidence = captureApprovedExpiryEvidence(deal, { sourceText: text,
    sourceUrl: deal.url, verifiedAt: approvedAt, now });
  assert.ok(deal.approvedExpiryEvidence);
  return deal;
}
const correctCoffee = () => receiptDeal('Kaffee für 3 €. Aktion gültig bis 07.12.2026.');
function officialDeal(text, patch = {}) {
  const d = receiptDeal(text, patch); delete d.approvedExpiryEvidence;
  d.evidence = { source: 'official-merchant-page', sourceUrl: d.url, merchantSourceKey: d.brand,
    extractionMethod: 'merchant-card', checkedAt: approvedAt, textSample: text, contentHash: sha(text) };
  return d;
}
const fixtures = JSON.parse(fs.readFileSync(new URL('./fixtures/expiry-reviewed-periods-20261128.json', import.meta.url)));
const buffet = () => {
  const deal = structuredClone(fixtures.find(row => row.deal.id === 'meta-ig-17914240650306695').deal);
  deal.approvedExpiryEvidence = captureApprovedExpiryEvidence(deal, { sourceText: deal.metaGraphCaption,
    verifiedAt: deal.metaGraphVerifiedAt, now });
  assert.ok(deal.approvedExpiryEvidence);
  return deal;
};
// Exact full original AIDA caption, captured by the existing merchant Graph
// collector. No made-up validation flag or fabricated fresh network read.
const aidaCaption = 'BLACK FRIDAY? WIR MACHEN PINK WEEK! Bei uns wird der Black Friday rosa! Und weil wir unsere Gäste besonders gerne verwöhnen, schenken wir euch während unserer AÏDA PINK WEEKS bis zu € 20! € 5 geschenkt ab € 20 Konsumation € 10 geschenkt ab € 40 Konsumation € 20 geschenkt ab € 80 Konsumation Wie funktioniert’s? Ganz einfach: Schneidet euren gewünschten Wertgutschein aus, besucht eine unserer AÏDA-Filialen und zeigt ihn vor eurer Bestellung vor. Der jeweilige Betrag wird direkt von eurer Rechnung abgezogen! https://aida.at/wp-content/uploads/Aida-Gutscheinaktion_29_10_26.pdf Die Gutscheine sind bis einschließlich 30. November 2026 gültig – in allen AÏDA-Filialen in Wien und Niederösterreich, ausgenommen Flughafen Wien. Pro Rechnung kann ein Gutschein eingelöst werden. Die Mindestkonsumation gilt vor Abzug des Gutscheins. Nicht mit der AÏDA-Stammkundenkarte oder anderen Rabatten und Aktionen kombinierbar. Nicht beim Kauf von Geschenkgutscheinen einlösbar. Ob Wiener Melange, handgemachte Torten oder unser beliebter Kaiserschmarrn – bei AÏDA schmeckt Sparen besonders süß! PINK WEEKS BEI AÏDA. Wiener Tradition seit 1913. Jetzt mit bis zu € 20 geschenkt! #AIDA #PinkWeeks #Wien #BlackFriday #CafeVienna Seit1913';
function aida() {
  return { id: 'meta-ig-18121024280323002', url: 'https://www.instagram.com/p/DgHWmA1MY02/', brand: 'AIDA',
    title: 'AIDA Pink Weeks: 5 €, 10 € oder 20 € Rabatt mit Gutschein',
    description: 'Mit dem passenden ausgeschnittenen AIDA-Gutschein erhältst du 5 € Rabatt ab 20 € Konsumation, 10 € ab 40 € oder 20 € ab 80 €. Den Gutschein vor der Bestellung vorzeigen. Gültig bis einschließlich 30. November 2026 in AIDA-Filialen in Wien und Niederösterreich, ausgenommen Flughafen Wien. Ein Gutschein pro Rechnung; Mindestkonsumation vor Abzug. Nicht mit Stammkundenkarte, anderen Rabatten oder Aktionen kombinierbar und nicht für den Kauf von Geschenkgutscheinen gültig.',
    approvedAt: '2026-11-24T11:12:25.736Z', sourcePublishedAt: '2026-11-24T06:51:25.000Z',
    sourcePublishedAtSource: 'url.instagramShortcode', validUntil: '2026-11-30', expires: '2026-11-30T23:59:59.999Z',
    ownerUsername: 'aidacafe', merchantUsername: 'aidacafe', sourceAccountType: 'merchant',
    metaGraphCaption: aidaCaption, metaGraphOcrText: '', metaGraphVerified: true, metaGraphAccepted: true,
    metaGraphIsRepost: false, metaGraphVerifiedAt: '2026-11-24T08:29:52.602Z', metaGraphMediaId: '18121024280323002',
    evidence: { mediaId: '18121024280323002', username: 'aidacafe' } };
}

test('covers every live ID without writes, network, model requests or input mutation', () => {
  const deals = [correctCoffee(), { id: 'unknown', title: 'Unbelegter Kaffee gratis', description: 'Nur Entwurf' }];
  const before = structuredClone(deals);
  const result = audit(deals, { now });
  assert.equal(result.total, 2);
  assert.deepEqual(result.entries.map(row => row.id), deals.map(row => row.id));
  assert.equal(result.requests, 0); assert.equal(result.modelCalls, 0);
  assert.equal(result.entries[1].status, 'review');
  assert.equal(result.entries[1].quarantineEligible, false);
  assert.deepEqual(deals, before);
});

test('real Zushi 1+1 buffet remains a buffet and its exact end is preserved', () => {
  const deal = buffet(), before = structuredClone(deal);
  const result = assess(deal, { now });
  assert.notEqual(result.status, 'confirmedConflict');
  assert.equal(result.patch, null); assert.equal(result.quarantineEligible, false);
  assert.equal(deal.expires, '2026-12-08T21:00:00.000Z');
  assert.deepEqual(deal, before);
});

test('real AIDA tiered vouchers do not become a coffee 1+1 offer', () => {
  const correct = aida();
  assert.notEqual(assess(correct, { now }).status, 'confirmedConflict');
  const bad = { ...correct, title: '1+1 Kaffee gratis bei AIDA' };
  const row = assess(bad, { now });
  assert.equal(row.status, 'confirmedConflict');
  assert.equal(row.quarantineEligible, true);
  assert.ok(row.issues.some(issue => issue.code === 'voucher-tier-instead-of-bogo'));
  assert.equal(row.provenance.sourceHash, sha(aidaCaption));
  assert.equal(row.provenance.currentRead, false, 'old approved original is not advertised as a new read');
  assert.equal(row.currentAvailabilityVerified, false);
});

test('a voucher promotion that explicitly includes 1+1 is not treated as the AIDA conflict', () => {
  for (const clause of ['Zusätzlich gibt es einen 1+1 Kaffee gratis Gutschein.',
    'Additional offer: buy one coffee get one free.', 'The second coffee is free.',
    'Coffee two for one.', 'Coffee BOGO.', 'Zu jedem Kaffee einen Kaffee gratis.']) {
    const d = aida(); d.metaGraphCaption += ` ${clause}`; d.title = '1+1 Kaffee gratis bei AIDA';
    assert.notEqual(assess(d, { now }).status, 'confirmedConflict', clause);
  }
});

test('same product with an explicit single other price is a conflict; absence and other products are review', () => {
  const bad = correctCoffee(); bad.title = 'Kaffee für 1 €';
  assert.equal(assess(bad, { now }).status, 'confirmedConflict');
  assert.equal(assess(bad, { now }).quarantineEligible, true);
  for (const source of ['Kuchen für 3 €. Aktion gültig bis 07.12.2026.',
    'Kaffee für 3 € oder Kaffee für 1 €. Aktion gültig bis 07.12.2026.',
    'Kaffee für 3 €, mit App nur 1 €. Aktion gültig bis 07.12.2026.',
    'Kaffee für 3 €, Kuchen für 1 €. Aktion gültig bis 07.12.2026.',
    'Kaffee ab 3 €. Aktion gültig bis 07.12.2026.']) {
    const row = assess(receiptDeal(source, { title: 'Kaffee für 1 €' }), { now });
    assert.notEqual(row.status, 'confirmedConflict'); assert.equal(row.quarantineEligible, false);
  }
});

test('explicit price and free-product negations are positive proof; another product free is insufficient', () => {
  const price = receiptDeal('Nicht mehr Kaffee für 3 €. Jetzt gibt es Kaffee für 4 €.', { title: 'Kaffee für 3 €' });
  assert.ok(assess(price, { now }).issues.some(row => row.code === 'explicitly-denied-product-price'));
  const denied = receiptDeal('Kaffee ist nicht gratis. Kuchen gibt es gratis.', { title: 'Kaffee gratis' });
  assert.ok(assess(denied, { now }).issues.some(row => row.code === 'explicitly-denied-free-product'));
  assert.notEqual(assess(receiptDeal('Kuchen gratis. Kaffee für 3 €.', { title: 'Kaffee gratis' }), { now }).status, 'confirmedConflict');
});

test('only an explicit unique offer end with year can yield a Vienna-calendar correction', () => {
  const deal = officialDeal('Kaffee für 3 €. Aktion gültig bis 07.12.2026.', { validUntil: '2026-12-09', expires: '2026-12-09T23:59:59.999Z' });
  const row = assess(deal, { now });
  assert.equal(row.status, 'confirmedConflict'); assert.equal(row.quarantineEligible, false);
  assert.equal(row.patch.validUntil, '2026-12-07');
  assert.equal(row.patch.expires, '2026-12-07T22:59:59.999Z');
  assert.equal(row.patch.expiresOriginal, 'bis 07.12.2026');
  assert.ok(deal.evidence.textSample.includes(row.patch.expiresOriginal));
  for (const source of ['Kaffee für 3 €. Geprüft am 07.12.2026.', 'Kaffee für 3 €. Gültig bis 7.12.',
    'Kaffee für 3 €. Gültig bis 07.12.2026, verlängert bis 10.12.2026.',
    'Kaffee für 3 €. Aktion A bis 07.12.2026. Aktion B bis 09.12.2026.',
    'Kaffee für 3 €. Vorbestellen bis 09.12.2026, Abholung am 12.12.2026.',
    'Kaffee für 3 €. Öffnungszeiten: geöffnet bis 09.12.2026.']) {
    assert.notEqual(assess(receiptDeal(source), { now }).status, 'confirmedConflict');
  }
});

test('a date-only source never erases a precise stored clock or invents a single-day range', () => {
  for (const patch of [{ expires: '2026-12-09T18:00:00.000Z' }, { validOn: '2026-12-09' },
    { validity: { expiryDate: '2026-12-09' } }]) {
    const row = assess(officialDeal('Kaffee für 3 €. Aktion gültig bis 07.12.2026.', { validUntil: '2026-12-09', ...patch }), { now });
    assert.equal(row.status, 'confirmedConflict'); assert.equal(row.patch, null);
  }
  const receipt = receiptDeal('Kaffee für 3 €. Aktion gültig bis 07.12.2026.', { validUntil: '2026-12-09' });
  assert.equal(assess(receipt, { now }).patch, null, 'existing approval receipt is never invalidated or silently rebound');
});

test('calendar repairs never leave an old concrete day or a discarded clock in public copy', () => {
  for (const patch of [{ title: 'Kaffee für 3 € am 9. Dezember' },
    { description: 'Kaffee für 3 €. Gültig bis 09.12.2026.' },
    { description: 'Kaffee für 3 €, nur am 9.12.' }, { description: 'Kaffee für 3 € bis 09. Dezember 2026.' }]) {
    const d = officialDeal('Kaffee für 3 €. Gültig bis 07.12.2026.', { validUntil: '2026-12-09', ...patch });
    const row = assess(d, { now });
    assert.equal(row.status, 'review'); assert.equal(row.patch, null); assert.equal(row.quarantineEligible, false);
    assert.ok(row.issues.some(issue => issue.code === 'public-offer-date-conflict'));
  }
  const clock = officialDeal('Kaffee für 3 €. Gültig bis 07.12.2026.',
    { validUntil: '2026-12-09', description: 'Kaffee für 3 €, nur bis 18 Uhr.' });
  assert.equal(assess(clock, { now }).patch, null);
  const twoRoles = officialDeal('Kaffee für 3 € nur am 28.11.2026. Der Gutschein ist bis 30.11.2026 gültig.',
    { validUntil: '2026-11-30', description: 'Kaffee für 3 € nur am 28.11.2026.' });
  const ambiguous = assess(twoRoles, { now });
  assert.equal(ambiguous.status, 'review'); assert.equal(ambiguous.quarantineEligible, false);
});

test('protected merchants, owner fields, business campaigns and manual periods are never automatically changed', () => {
  const bad = correctCoffee(); bad.title = 'Kaffee für 1 €';
  for (const patch of [{ forceKeep: true }, { liveForceKeep: true }, { isBusiness: true }, { isBusinessAdvertisement: true },
    { campaignId: 'campaign' }, { liveEditedAt: approvedAt }, { liveEditedFields: ['title'] }, { slackEditedFields: ['title'] }]) {
    assert.equal(assess({ ...bad, ...patch }, { now }).quarantineEligible, false);
  }
  assert.equal(assess(bad, { now, policy: { protectedMerchants: ['Café Beispiel'] } }).quarantineEligible, false);
  for (const field of ['forceKeep', 'restoreDeal', 'hidden']) {
    for (const identity of [{ dealId: bad.id }, { url: bad.url }]) {
      assert.equal(assess(bad, { now, edits: [{ ...identity, [field]: field === 'restoreDeal' ? bad : true }] }).quarantineEligible, false);
    }
  }
  const date = officialDeal('Kaffee für 3 €. Gültig bis 07.12.2026.', { validUntil: '2026-12-09' });
  for (const options of [{ edits: [{ dealId: date.id, validUntil: '2026-12-09' }] },
    { edits: [{ url: date.url, clearFields: ['validUntil'] }] }, { policy: { protectedMerchants: ['Café Beispiel'] } },
    { edits: [{ dealId: date.id, forceKeep: true }] }]) {
    assert.equal(assess(date, { now, ...options }).patch, null);
  }
  const lockedSource = assess({ ...date, liveEditedFields: ['expirySource'] }, { now });
  assert.equal(lockedSource.patch, null); assert.equal(lockedSource.quarantineEligible, false);
  const forceKeepDate = assess({ ...date, liveForceKeep: true }, { now });
  assert.equal(forceKeepDate.patch, null); assert.equal(forceKeepDate.quarantineEligible, false);
  for (const field of ['expiresSource', 'expirySource']) {
    const locked = assess({ ...date, [field]: 'manual' }, { now });
    assert.equal(locked.patch, null); assert.equal(locked.quarantineEligible, false);
  }
  assert.ok(assess(date, { now, edits: [{ dealId: 'different-offer', url: date.url, validUntil: '2026-12-09' }] }).patch,
    'a different explicit ID sharing a homepage never protects this offer');
});

test('newest blocked, reposted, stale or wrong-source proof never falls back to a good original', () => {
  const deal = correctCoffee(); deal.title = 'Kaffee für 1 €';
  for (const latestEvidence of [{ blockingReason: '403' }, { graphAccepted: false }, { isRepost: true },
    { officialText: deal.approvedExpiryEvidence.sourceText, sourceUrl: deal.url, verifiedAt: approvedAt },
    { sourceUrl: 'https://example.com/other', verifiedAt: now.toISOString() }]) {
    const row = assess(deal, { now, latestEvidence });
    assert.equal(row.status, 'review'); assert.equal(row.quarantineEligible, false);
  }
});

test('changed source/period/approval/hash invalidates receipts; description alone never becomes original evidence', () => {
  for (const mutate of [d => { d.url += '/other'; }, d => { d.validUntil = '2026-12-20'; },
    d => { d.approvedAt = now.toISOString(); }, d => { d.approvedExpiryEvidence.sourceText += ' changed'; }]) {
    const d = correctCoffee(); mutate(d);
    assert.equal(assess(d, { now }).status, 'review');
  }
  const d = correctCoffee(); delete d.approvedExpiryEvidence; d.caption = 'Kaffee für 3 €.';
  assert.equal(assess(d, { now }).status, 'review');
});

test('merchant Graph identity, approval, timestamps and original/repost flags are mandatory', () => {
  for (const patch of [{ metaGraphVerified: false }, { metaGraphAccepted: false }, { metaGraphIsRepost: true },
    { merchantUsername: 'other' }, { sourceAccountType: 'creator' }, { sourcePublishedAt: '2025-11-24T06:51:25.000Z' },
    { metaGraphVerifiedAt: '2026-12-01T00:00:00.000Z' }, { approvedAt: '' }, { evidence: { mediaId: 'other', username: 'aidacafe' } }]) {
    const d = { ...aida(), ...patch, title: '1+1 Kaffee gratis bei AIDA' };
    assert.equal(assess(d, { now }).status, 'review');
  }
});

test('bound official card hash and merchant/source identity must agree', () => {
  const d = correctCoffee(); delete d.approvedExpiryEvidence; d.title = 'Kaffee für 1 €';
  const text = 'Kaffee für 3 €.';
  d.evidence = { source: 'official-merchant-page', sourceUrl: d.url, merchantSourceKey: d.brand,
    extractionMethod: 'merchant-card', checkedAt: approvedAt, textSample: text, contentHash: sha(text) };
  assert.equal(assess(d, { now }).status, 'confirmedConflict');
  for (const patch of [{ contentHash: 'bad' }, { merchantSourceKey: 'Other Café' }, { sourceUrl: 'https://example.org/' },
    { extractionMethod: 'llm-summary' }, { checkedAt: '2026-12-01T00:00:00.000Z' }]) {
    assert.equal(assess({ ...d, evidence: { ...d.evidence, ...patch } }, { now }).status, 'review');
  }
});

test('explicit same-product BOGO conflict differs from unrelated or multiple offers', () => {
  const d = receiptDeal('2+1 Kaffee gratis. Aktion gültig bis 07.12.2026.', { title: '1+1 Kaffee gratis' });
  assert.ok(assess(d, { now }).issues.some(row => row.code === 'same-product-bogo-conflict'));
  for (const source of ['2+1 Donuts gratis.', '1+1 Kaffee oder 2+1 Kaffee gratis.', 'Früher 2+1 Kaffee gratis.']) {
    assert.notEqual(assess(receiptDeal(source, { title: '1+1 Kaffee gratis' }), { now }).status, 'confirmedConflict');
  }
});

test('negated date clauses, explicit exceptions and a positive current free clause are not quarantine proof', () => {
  for (const text of ['Kaffee für 3 €. Nicht gültig bis 09.12.2026.', 'Kaffee für 3 €. Gilt nicht nur bis 09.12.2026.',
    'Kaffee ist nicht gratis, außer am Aktionstag.', 'Kaffee ist nicht gratis. Heute gibt es Kaffee gratis.']) {
    const title = text.includes('gratis') ? 'Kaffee gratis' : 'Kaffee für 3 €';
    assert.notEqual(assess(receiptDeal(text, { title }), { now }).status, 'confirmedConflict');
  }
});

test('current public evidence must preserve URL, exact caption hash, successful parser result and 24h age', () => {
  const d = correctCoffee(); d.url = 'https://www.preisjaeger.at/deals/coffee-fixture-123456'; delete d.approvedExpiryEvidence;
  d.title = 'Kaffee für 1 €';
  const text = 'Kaffee für 3 €. Gültig bis 07.12.2026.';
  const latest = { officialText: text, sourceUrl: d.url, verifiedAt: now.toISOString(), contentHash: sha(text),
    approvalSourceEvidence: { sourceUrl: d.url, caption: text } };
  assert.equal(assess(d, { now, latestEvidence: latest }).status, 'confirmedConflict');
  const boundary = { ...latest, verifiedAt: new Date(+now - 86400000).toISOString() };
  assert.equal(assess(d, { now, latestEvidence: boundary }).status, 'confirmedConflict');
  for (const patch of [{ verifiedAt: new Date(+now - 86400001).toISOString() }, { verifiedAt: new Date(+now + 1).toISOString() },
    { contentHash: 'bad' }, { sourceUrl: 'https://example.com/other' }, { officialText: 42 },
    { approvalSourceEvidence: { sourceUrl: d.url, caption: text, blockingReason: 'login' } }]) {
    assert.equal(assess(d, { now, latestEvidence: { ...latest, ...patch } }).status, 'review');
  }
});

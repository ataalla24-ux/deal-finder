import assert from 'node:assert/strict';
import test from 'node:test';
import { assessOriginalTodayEnd } from './expiry-original-today.mjs';
import { captureApprovedExpiryEvidence } from './approved-expiry-evidence.mjs';

const now = new Date('2026-11-27T22:00:00Z');
const caption = "🖤 BLACK TUESDAY - nur heute! 🖤 Heute gibt's einen Sondertarif: 3 Stunden spielen um nur 5 €! Dieser Preis gilt nur für diesen Spieltag! Anmeldung über die Event-Plattform. Die Plätze sind begrenzt.";
const base = { id: 'today-original', brand: 'Tischtennis', url: 'https://www.instagram.com/p/DgHKC2NFT3h/',
  sourcePublishedAt: '2026-11-24T05:01:45.000Z', sourcePublishedAtSource: 'url.instagramShortcode',
  approvedAt: '2026-11-24T11:10:45.000Z', expiryKind: 'single', validOn: '2026-11-24',
  expires: '2026-11-24T23:59:59.999Z', sourceAccountType: 'unknown', title: 'Black Tuesday: 3 Stunden Tischtennis um 5 €', description: caption };
function capture(deal = base, sourceText = caption, verifiedAt = '2026-11-24T06:03:08.000Z') {
  return { ...deal, approvedExpiryEvidence: captureApprovedExpiryEvidence(deal, { sourceText, verifiedAt, now }) };
}
function instagramUrl(stamp) {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
  let bits = (BigInt(Date.parse(stamp)) - 1314220021300n) << 23n;
  let code = '';
  while (bits) { code = alphabet[Number(bits % 64n)] + code; bits /= 64n; }
  return `https://www.instagram.com/p/${code}/`;
}

test('an approved literal only-today source and independent permalink clock corroborate existing end', () => {
  const result = assessOriginalTodayEnd(capture(), { now });
  assert.equal(result.end, '2026-11-24');
  assert.deepEqual(result.evidence, [caption]);
  assert.ok(result.originalPostPublishedAt.startsWith('2026-11-24T05:01:45.'));
  assert.equal(assessOriginalTodayEnd(capture({ ...base, sourcePublishedAtSource: 'instagram-graph-timestamp' }), { now }).end, '2026-11-24');
  assert.equal(assessOriginalTodayEnd(capture(base, 'Only today: 50% Rabatt!'), { now }).end, '2026-11-24');
});

test('receipt, literal today and a real benefit are required; publication age alone never expires a deal', () => {
  assert.equal(assessOriginalTodayEnd(base, { now }), null);
  for (const source of ['Heute Tischtennis spielen um 5 €!', 'Black Tuesday: 5 €!', 'Nur heute ist Dienstag.', 'Bis heute um 5 € spielen.']) {
    assert.equal(assessOriginalTodayEnd(capture(base, source), { now }), null, source);
  }
  const tampered = capture();
  tampered.approvedExpiryEvidence.sourceText += ' changed';
  assert.equal(assessOriginalTodayEnd(tampered, { now }), null);
});

test('permalink, original timestamp, approval chronology and stored single day must agree', () => {
  for (const patch of [
    { sourcePublishedAt: '2026-11-24T05:03:45.000Z' },
    { sourcePublishedAt: '2026-11-23T05:01:45.000Z' }, { sourcePublishedAtSource: 'discoveredAt' },
    { approvedAt: '2026-11-24T04:00:00Z' }, { approvedAt: '2026-12-10T11:00:00Z' },
    { validOn: '2026-11-25' }, { validOn: '' }, { validFrom: '2026-11-23' }, { validUntil: '2026-11-25' },
    { expires: '2026-11-24T18:00:00Z' }, { expiryKind: 'end' }, { expiryKind: 'start' },
    { url: 'https://www.instagram.com/accounts/login/?next=/p/DgHKC2NFT3h/' },
    { url: 'https://www.instagram.com.evil.test/p/DgHKC2NFT3h/' },
    { url: 'https://www.instagram.com/p/not-a-timestamp/' },
    { isRepost: true }, { evidence: { originalPost: { isOriginal: false } } },
  ]) assert.equal(assessOriginalTodayEnd(capture({ ...base, ...patch }), { now }), null, JSON.stringify(patch));
  assert.equal(assessOriginalTodayEnd(capture(base, caption, '2026-11-24T04:00:00Z'), { now }), null);
  assert.equal(assessOriginalTodayEnd(capture(base, caption, '2026-12-10T11:00:00Z'), { now: new Date('2026-12-11T00:00:00Z') }), null);
});

test('negation, recurring or extended offers, dates, clocks and edited contradictions stay held', () => {
  for (const extra of [
    'Nicht nur heute!', 'Kein Sondertarif.', 'Jeden Dienstag gilt der Tarif.', 'Every week: 50% Rabatt.',
    'Nächsten Dienstag gratis.', 'Friday special.', 'Regelmäßig gültig.',
    'Auch morgen.', 'Bis Freitag.', 'Unbefristet.', 'Die Aktion wurde verlängert.', 'Weiterhin gültig.',
    'Vielleicht geplant.', 'Voraussichtlich.', 'Repost.', 'Öffnungszeiten: 8 Uhr.',
    'Gültig am 25.11.2026.', 'Am 25. November.', '2026-11-25.', 'Ab 19:00 Uhr.', 'Gewinnspiel.',
  ]) {
    assert.equal(assessOriginalTodayEnd(capture(base, `${caption} ${extra}`), { now }), null, extra);
    assert.equal(assessOriginalTodayEnd(capture({ ...base, description: `${caption} ${extra}` }), { now }), null, extra);
  }
});

test('the calendar day comes from Europe/Vienna and never from the UTC publication day', () => {
  const stamp = '2026-11-23T23:15:00Z';
  const winter = { ...base, url: instagramUrl(stamp), sourcePublishedAt: stamp,
    approvedAt: '2026-11-24T11:00:00Z' };
  assert.equal(assessOriginalTodayEnd(capture(winter), { now }).end, '2026-11-24');
  assert.equal(assessOriginalTodayEnd(capture({ ...winter, validOn: '2026-11-23', expires: '2026-11-23T23:59:59.999Z' }), { now }), null);
  const summerStamp = '2026-07-26T22:15:00Z';
  const summer = { ...base, url: instagramUrl(summerStamp), sourcePublishedAt: summerStamp,
    title: 'Nur heute 50% Rabatt', description: 'Nur heute 50% Rabatt',
    approvedAt: '2026-07-27T11:00:00Z', validOn: '2026-07-27', expires: '2026-07-27T23:59:59.999Z' };
  assert.equal(assessOriginalTodayEnd(capture(summer, summer.description, '2026-07-27T08:00:00Z'), { now }).end, '2026-07-27');
});

test('TikTok originals require exact-host video IDs and their independently decoded clock', () => {
  const stamp = '2026-11-24T08:00:00Z';
  const id = ((BigInt(Date.parse(stamp) / 1000) << 32n) | 123n).toString();
  const tiktok = { ...base, url: `https://www.tiktok.com/@merchant/video/${id}`,
    sourcePublishedAt: stamp, sourcePublishedAtSource: 'url.tiktokVideoId' };
  assert.equal(assessOriginalTodayEnd(capture(tiktok, 'Nur heute Döner gratis!', '2026-11-24T08:05:00Z'), { now }).end, '2026-11-24');
  for (const patch of [{ sourcePublishedAt: '2026-11-23T08:00:00Z' },
    { sourcePublishedAtSource: 'instagram-graph-timestamp' },
    { url: `https://tiktok.com.evil.test/@merchant/video/${id}` }]) {
    assert.equal(assessOriginalTodayEnd(capture({ ...tiktok, ...patch }), { now }), null);
  }
});

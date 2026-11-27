import assert from 'node:assert/strict';
import test from 'node:test';
import { assessEmbeddedClockRangeEnd, hasConflictingOfferClock } from './expiry-embedded-clock-range.mjs';

const deal = { expiryKind: 'single', validOn: '2026-11-27', validFrom: '2026-11-27',
  validUntil: '2026-11-27', expires: '2026-11-27T18:00:00.000Z' };
const caption = '🎉 VAMOS GRAND OPENING! 🎉 Es ist so weit! Am 27.11.2026 von 15:00 bis 19:00 Uhr feiern wir unsere große Eröffnung und ihr seid herzlich eingeladen! 🔥 🥙 HÜHNER-DÖNER GRATIS 🥩 STEAK-DÖNER GRATIS 🥤 BEY GAZOZ GRATIS ❤️ Gemeinsam Gutes tun! Wer möchte, kann freiwillig spenden.';

test('a unique full-year source window embedded in an opening caption corroborates Vienna end', () => {
  assert.deepEqual(assessEmbeddedClockRangeEnd(deal, caption), {
    quote: 'Am 27.11.2026 von 15:00 bis 19:00 Uhr', kind: 'single',
    validFrom: '2026-11-27', validUntil: '2026-11-27', validOn: '2026-11-27', expires: deal.expires,
  });
  assert.equal(assessEmbeddedClockRangeEnd(deal, caption.replace('15:00 bis 19:00 Uhr', '15 Uhr bis 19 Uhr'))?.expires, deal.expires);
  assert.equal(assessEmbeddedClockRangeEnd(deal, 'Döner gratis am 27.11.2026 von 15:00 bis 19:00 Uhr!')?.expires, deal.expires);
  assert.equal(assessEmbeddedClockRangeEnd(deal, 'Döner gratis: 27.11.2026, 15:00 bis 27.11.2026, 19:00 Uhr.')?.expires, deal.expires);
});

test('no source argument means no evidence even when the edited description contains the window', () => {
  for (const source of [undefined, null, '', {}, ['caption']]) {
    assert.equal(assessEmbeddedClockRangeEnd({ ...deal, description: caption }, source), null);
  }
});

test('every supplied stored day and the exact UTC end must agree', () => {
  for (const patch of [
    { validOn: '2026-11-28' }, { validFrom: '2026-11-26' }, { validUntil: '2026-11-28' },
    { validOn: null, validUntil: null }, { expires: '2026-11-27T19:00:00.000Z' },
    { expires: '2026-11-27T23:59:59.999Z' }, { expires: '' },
    { expiryKind: 'range' }, { expiryKind: 'start' },
  ]) assert.equal(assessEmbeddedClockRangeEnd({ ...deal, ...patch }, caption), null, JSON.stringify(patch));
});

test('calendar, ambiguity, scope, recurrence and extension failures stay held', () => {
  for (const source of [
    caption.replace('27.11.2026', '27.11.'),
    caption.replace('27.11.2026', '27.11.26'),
    caption.replace('27.11.2026', '31.11.2026'),
    caption.replace('15:00 bis 19:00', '19:00 bis 15:00'),
    caption.replace('15:00 bis 19:00', '19:00 bis 19:00'),
    caption.replace('15:00 bis 19:00', '15:00 bis 29:00'),
    caption.replace('Am 27.', 'Nicht nur am 27.'),
    caption.replace('Am 27.', 'Jeden Freitag am 27.'),
    `${caption} Every month: Döner gratis.`,
    `${caption} Monatlich wiederholt.`,
    `${caption} Die Aktion wird verlängert.`,
    `${caption} Danach gilt das Angebot weiterhin.`,
    `${caption} Ab 28.11.2026 läuft die Aktion weiter.`,
    `${caption} Gültig auch am 28.11.`,
    `${caption} Am 28. November gibt es weitere Angebote.`,
    `${caption} Am 28. Nov. gibt es weitere Angebote.`,
    `${caption} Ab 20:00 Uhr weiter gratis.`,
    `${caption} Auch von 20 bis 21 Uhr gratis.`,
    `${caption} Am 27.11.2026 von 15:00 bis 19:00 Uhr gratis.`,
    'Öffnungszeiten am 27.11.2026 von 15:00 bis 19:00 Uhr. Döner gratis!',
    'Am 27.11.2026 von 15:00 bis 19:00 Uhr findet der Umbau statt. Danach Döner gratis.',
    'Am 27.11.2026 von 15:00 bis 19:00 Uhr findet eine Schulung statt. Döner gratis.',
    'Gewinnspiel am 27.11.2026 von 15:00 bis 19:00 Uhr: Döner gratis gewinnen.',
    'Döner gratis: 27.11.2026, 15:00 bis 28.11.2026, 19:00 Uhr.',
  ]) assert.equal(assessEmbeddedClockRangeEnd(deal, source), null, source);
});

test('Vienna DST normalization preserves summer clocks and refuses ambiguous or nonexistent windows', () => {
  const on = (day, expires) => ({ ...deal, validOn: day, validFrom: day, validUntil: day, expires });
  assert.equal(assessEmbeddedClockRangeEnd(on('2026-07-27', '2026-07-27T17:00:00.000Z'),
    'Döner gratis am 27.7.2026 von 15:00 bis 19:00 Uhr.')?.expires, '2026-07-27T17:00:00.000Z');
  assert.equal(assessEmbeddedClockRangeEnd(on('2026-10-25', '2026-10-25T01:30:00.000Z'),
    'Döner gratis am 25.10.2026 von 01:00 bis 02:30 Uhr.'), null);
  assert.equal(assessEmbeddedClockRangeEnd(on('2026-03-29', '2026-03-29T01:30:00.000Z'),
    'Döner gratis am 29.3.2026 von 01:00 bis 02:30 Uhr.'), null);
});

test('all current source/OCR and edited fragments must agree with the confirmed start/end clocks', () => {
  const quote = 'Am 27.11.2026 von 15:00 bis 19:00 Uhr';
  assert.equal(hasConflictingOfferClock(quote, [caption, 'Döner gratis bei der Eröffnung.', 'Endet um 19:00 Uhr.']), false);
  assert.equal(hasConflictingOfferClock(quote, ['Von 15 Uhr bis 19 Uhr.', '5 € pro Person.']), false);
  assert.equal(hasConflictingOfferClock(quote, ['27.11.2026, 15:00 bis 27.11.2026, 19:00 Uhr.']), false);
  assert.equal(hasConflictingOfferClock(quote, ['Am 27. November 2026 gratis bis 19 Uhr.']), false);
  for (const extra of [
    'Das Gratis-Angebot endet um 20:00 Uhr.', 'Das Gratis-Angebot endet um 20.',
    'Bis 20 Uhr gratis.', 'Ends at 20.', 'Von 14 Uhr bis 19 Uhr.',
    'Endet um 15:00 Uhr.', 'Von 19 Uhr bis 15 Uhr.', 'Geöffnet bis 21:00.',
    'Eine weitere Aktion: 27.11.2026, 18:00 bis 27.11.2026, 21:00 Uhr.',
    'Gratis am 28.11.2026 von 15:00 bis 19:00 Uhr.',
    'Gratis am 2026-11-28 von 15:00 bis 19:00 Uhr.',
    'Gratis am 28. November 2026 von 15:00 bis 19:00 Uhr.',
    'Endet um 25 Uhr.', 'Endet um 19:99 Uhr.', 'Endet um 19:7 Uhr.',
    'Endet um zwanzig Uhr.', 'Endet um später.',
  ]) assert.equal(hasConflictingOfferClock(quote, [caption, extra]), true, extra);
  assert.equal(hasConflictingOfferClock('no clock proof', [caption]), true);
  assert.equal(hasConflictingOfferClock(quote, null), true);
});

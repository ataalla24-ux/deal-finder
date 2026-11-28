import assert from 'node:assert/strict';
import test from 'node:test';
import { assessEmbeddedClockRangeEnd, assessOriginalEventClockEnd, assessReviewedSingleActionDayEnd,
  assessReviewedTwoDayEventEnd, assessReviewedDailyCampaignEnd, assessReviewedOneDayWindowEnd,
  assessReviewedWholeDayEnd, hasConflictingOfferClock } from './expiry-embedded-clock-range.mjs';

test('reviewed daily schedules are bounded by the literal campaign and all extra times still veto', () => {
  const row = { expiryKind: 'range', validFrom: '2026-12-06', validUntil: '2026-12-08', expires: '2026-12-08T21:00:00Z' };
  const source = '1+1 gratis. Von Sonntag, 6.12. bis Dienstag, 8.12.2026, täglich von 11 bis 22 Uhr.';
  const options = { publishedAt: '2026-11-27T11:10:07Z', contextTexts: ['Gilt vom 6. bis 8. Dezember 2026 jeweils von 11 bis 22 Uhr.'] };
  assert.equal(assessReviewedDailyCampaignEnd(row, source, options)?.expires, '2026-12-08T21:00:00.000Z');
  for (const value of [source.replace('Dienstag', 'Montag'), source.replace('8.12.2026', '8.12.2025'),
    source.replace('22 Uhr', '23 Uhr'), source + ' Danach bleibt das Angebot weiterhin gültig.',
    source + ' Jede Woche.', source + ' Am 9.12.2026 auch gratis.', source + ' All times are GMT.']) {
    assert.equal(assessReviewedDailyCampaignEnd(row, value, options), null, value);
  }
});

test('reviewed one-day opening offers distinguish product quantities from recurring schedules', () => {
  const row = { expiryKind: 'end', validOn: '2026-11-28', validUntil: '2026-11-28', expires: '2026-11-28T21:00:00Z' };
  const source = 'Nur EINEN TAG lang: Döner für 2,99 € – Jede Pizzaschnitte für 1 € – Samstag, 28.11.2026 ⏰ 12:00–22:00 Uhr';
  const options = { publishedAt: '2026-11-25T18:54:59Z' };
  assert.equal(assessReviewedOneDayWindowEnd(row, source, options)?.expires, '2026-11-28T21:00:00.000Z');
  for (const value of [source.replace('Nur EINEN TAG lang:', 'Jeden Samstag:'), source + ' Jede Woche.',
    source + ' Auch am 29.11.2026.', source.replace('22:00 Uhr', '22:00 Uhr UTC'), source + ' Öffnungszeiten 8–23 Uhr.']) {
    assert.equal(assessReviewedOneDayWindowEnd(row, value, options), null, value);
  }
});

test('reviewed whole-day actions require a unique date and reject recurrence, old years and added clocks', () => {
  const row = { expiryKind: 'single', validOn: '2026-11-28', expires: '2026-11-28T22:59:59.999Z' };
  const source = '1+1 Döner GRATIS zu jedem Döner. ⏰ 28.11, den ganzen Tag';
  const options = { publishedAt: '2026-11-25T16:01:39Z' };
  assert.equal(assessReviewedWholeDayEnd(row, source, options)?.expires, row.expires);
  for (const value of [source.replace('28.11,', '28.11.25,'), source + ' Jeden Samstag.', source + ' Gilt bis 22 Uhr.',
    source + ' Auch am 29.11.', source + ' Kampanya devam ediyor.']) {
    assert.equal(assessReviewedWholeDayEnd(row, value, options), null, value);
  }
});

test('a reviewed two-day offer requires both weekdays/days, one shared clock and no third day', () => {
  const row = { expiryKind: 'range', validFrom: '2026-11-28', validUntil: '2026-11-29', expires: '2026-11-29T20:00:00Z' };
  const source = 'Your 2nd Punsch for free. Saturday, November 28th & Sunday, November 29th 🎄12 PM – 9 PM';
  const options = { publishedAt: '2026-11-24T14:46:13Z' };
  assert.equal(assessReviewedTwoDayEventEnd(row, source, options)?.expires, '2026-11-29T20:00:00.000Z');
  for (const text of [source.replace('Sunday', 'Monday'), source.replace('29th', '30th'), source.replace('9 PM', '9 AM'),
    source + ' Also on November 30.', source + ' Every weekend.', source + ' All times are GMT.',
    source + ' This price remains available after the event.', source.replace('29th', '29th 2025')]) {
    assert.equal(assessReviewedTwoDayEventEnd(row, text, options), null, text);
  }
  assert.equal(assessReviewedTwoDayEventEnd(row, source, { ...options, contextTexts: ['27.–29.11.2026 gratis.'] }), null);
});

test('a reviewed limited action day distinguishes opening from the full-year benefit header', () => {
  const row = { brand: 'Zushi Market', title: 'Zushi Bowl für 1 €', description: 'Bowl für 1 € für die ersten 500 Gäste.',
    expiryKind: 'single', validOn: '2026-12-07', validFrom: '2026-12-07', validUntil: '2026-12-07', expires: '2026-12-07T22:59:59.999Z' };
  const source = 'Unser neuer Zushi Market eröffnet am 6. Dezember! Die Aktion gilt nur für die ersten 500 Gäste. 📅 1 € Bowl Aktion: 07.12.2026 ab 13 Uhr';
  const options = { publishedAt: '2026-11-25T15:13:01Z' };
  assert.equal(assessReviewedSingleActionDayEnd(row, source, options)?.expires, row.expires);
  for (const text of [source.replace('500 Gäste', 'alle Gäste'), source.replace('500 Gäste', '0 Gäste'),
    source.replace('07.12.2026', '07.12.25'), source.replace('07.12.2026', '08.12.2026'),
    source.replace('6. Dezember', '5. Dezember'), source.replace('Unser neuer Zushi Market', 'Unser neuer anderer Shop'),
    source.replace('Bowl Aktion', 'Bowl Verkauf'), source + ' Das Angebot läuft weiter.', source + ' Auch am 8. Dezember.',
    source + ' Öffnungszeiten bis 22 Uhr.', source + ' Uhrzeit in UTC.']) {
    assert.equal(assessReviewedSingleActionDayEnd(row, text, options), null, text);
  }
});

test('identified original event windows normalize PM clocks and calendar-only legacy values', () => {
  const row = { expiryKind: 'single', validOn: '2026-11-27', expires: '2026-11-27T23:59:59.999Z' };
  const source = 'On November 27 between 1 PM – 3 PM, enjoy your 1€ lunch!';
  const options = { publishedAt: '2026-11-13T13:17:56Z' };
  assert.equal(assessOriginalEventClockEnd(row, source, options)?.expires, '2026-11-27T14:00:00.000Z');
  for (const text of [
    source + ' Extended until November 30.', source + ' The offer continues.', source + ' The offer continues tomorrow.',
    source.replace('1 PM – 3 PM', '11 PM – 1 AM'), source.replace('1 PM – 3 PM', '1 PM – 3'),
    source.replace('1 PM – 3 PM', '1 PM – 13 PM'), source.replace('1 PM – 3 PM', '1:60 PM – 3 PM'),
    source.replace('November 27', 'November 27 and November 28'), source.replace('November 27', 'Thursday, November 27'),
    source + ' Also from 16:00 to 17:00.', source + ' Offer ends at 4 PM.', source + ' Offer until four PM.',
    source + ' Every Friday.', source + ' Fridays only.', source + ' Opening hours 11:00–22:00.',
    source.replace('3 PM,', '3 PM UTC,'), source + ' All times are GMT.', source + ' Time zone: Europe/London.',
    source + ' -13:00', source + ' -1300',
    source.replace('November 27', '27.11.25'), source.replace('November 27', '27/11/25'),
    source.replace('November 27', '27 November 25'), source.replace('November 27', 'November 27, 25'),
    source.replace('November 27', '27.11.20262'),
    source.replace('enjoy your 1€ lunch', 'staff training takes place') + ' 1€ lunch after the training.',
  ]) assert.equal(assessOriginalEventClockEnd(row, text, options), null, text);
  assert.equal(assessOriginalEventClockEnd(row, source, { ...options, publishedAt: '2026-11-12T13:17:56Z' }), null);
  assert.equal(assessOriginalEventClockEnd(row, source, { ...options, contextTexts: ['Auch am 28. November gratis.'] }), null);
  assert.equal(assessOriginalEventClockEnd({ ...row, expires: '2026-11-27T13:00:00Z' }, source, options), null);
});

test('identified event parser preserves Vienna summer time and rejects DST gaps and repeated clocks', () => {
  const run = (day, source) => assessOriginalEventClockEnd({ expiryKind: 'single', validOn: day,
    expires: `${day}T23:59:59.999Z` }, source, { publishedAt: `${day}T00:00:00Z` });
  assert.equal(run('2026-07-27', 'On July 27 between 1 PM – 3 PM, lunch for 1€!')?.expires, '2026-07-27T13:00:00.000Z');
  assert.equal(run('2026-10-25', 'On October 25 between 1 AM – 2:30 AM, lunch for 1€!'), null);
  assert.equal(run('2026-03-29', 'On March 29 between 1 AM – 2:30 AM, lunch for 1€!'), null);
});

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

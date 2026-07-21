import assert from 'node:assert/strict';
import fs from 'node:fs';

import {
  evaluateInstagramOfferTiming,
  extractActiveOfferWindow,
  hasRecurringOfferSchedule,
  hasRecurringWeekdaySchedule,
  hasViennaInstagramEvidence,
  isYesterdayOnlyOffer,
  unicodeSafeTruncate,
} from '../scraper/instagram-ai-validity-utils.js';

const now = new Date('2026-07-20T12:00:00.000Z');

function timing(signal, pubDate) {
  return evaluateInstagramOfferTiming({
    signal,
    pubDate,
    now,
    maxAgeDays: 7,
    activeOfferMaxAgeDays: 45,
  });
}

const activeExamples = [
  {
    name: 'Ernesto July range',
    signal: 'Ernesto Osteria🇮🇹: ☕🇮🇹 BUON GIORNO AKTION! Vom 1. bis 31. Juli 2026 erhältst du den 2. Illy Caffè GRATIS zu jedem Frühstück. Dienstag bis Freitag, auch im Gastgarten in Wien gültig.',
    pubDate: '2026-06-25T10:00:00.000Z',
    kind: 'range',
    validUntil: '2026-07-31',
  },
  {
    name: 'Otto Yami through August',
    signal: 'Otto Yami feiert 6-jähriges Jubiläum! 🎁 Bis Ende August lassen wir es auf unserem All-You-Can-Eat-Buffet krachen mit unserer 4+1 GRATIS Aktion: Die 5. Person schlemmt komplett umsonst in Wien.',
    pubDate: '2026-07-01T10:00:00.000Z',
    kind: 'month-end',
    validUntil: '2026-08-31',
  },
  {
    name: 'Spelunke weekday happy hour',
    signal: 'SPELUNKE Wien: ❤️🔥DEAL❤️🔥 Hier gibt’s Mo-Fr zwischen 17 und 18 Uhr zu jedem Hauptgang einen Spritzer oder ein großes Bier gratis dazu. Sag beim Bestellen einfach: „17-Uhr-Deal“.',
    pubDate: '2026-06-15T10:00:00.000Z',
    recurring: true,
  },
  {
    name: 'Tokki weekday deal',
    signal: '@tokki_korean_bbq: All You Can Eat + Free Drink bei Tokki🍹✨ 🕞 Mo-Fr 12-17 Uhr 📍Mariahilfer Straße 112, 1070 Wien.',
    pubDate: '2026-06-10T10:00:00.000Z',
    recurring: true,
  },
  {
    name: 'APRON July through August',
    signal: 'Restaurant APRON Wien: Von Juli bis August 2026 genießt du immer dienstags, mittwochs und donnerstags unser 5-Gänge-Menü um € 130 statt € 166.',
    pubDate: '2026-06-20T10:00:00.000Z',
    kind: 'month-range',
    validUntil: '2026-08-31',
  },
];

for (const example of activeExamples) {
  const result = timing(example.signal, example.pubDate);
  assert.equal(result.eligibleByAge, true, `${example.name} should remain eligible`);
  assert.equal(result.expired, false, `${example.name} should not be expired`);
  if (example.kind) assert.equal(result.offerWindow?.kind, example.kind, `${example.name} kind`);
  if (example.validUntil) {
    assert.equal(result.offerWindow?.endDate?.toISOString().slice(0, 10), example.validUntil, `${example.name} end`);
  }
  if (example.recurring) assert.equal(result.recurring, true, `${example.name} recurrence`);
}

assert.equal(
  timing('Altes Restaurant-Marketing aus Wien mit 20% Rabatt', '2026-07-01T10:00:00.000Z').eligibleByAge,
  false,
  'an ordinary stale post must stay blocked'
);

assert.equal(
  timing('Spelunke Wien: Happy Hour Mo–Fr 17–18 Uhr', '2026-05-31T10:00:00.000Z').eligibleByAge,
  false,
  'even recurring evidence must be bounded by the 45-day maximum'
);

const activePastStart = timing('Wien Aktion vom 1.7.–31.7.2026', '2026-07-05T10:00:00.000Z');
assert.equal(activePastStart.explicitExpired, false, 'a past range start must not expire an active range');
assert.equal(activePastStart.eligibleByAge, true, 'an active range remains eligible');

const expiredRange = timing('Wien Aktion vom 1.–30. Juni', '2026-06-20T10:00:00.000Z');
assert.equal(expiredRange.explicitExpired, true, 'a range is expired only after its end');
assert.equal(expiredRange.eligibleByAge, false);

const futureRange = timing('Wien Deal vom 1.–31. August', '2026-07-10T10:00:00.000Z');
assert.equal(futureRange.notStarted, true, 'a future range is not a currently active offer');
assert.equal(futureRange.eligibleByAge, false);

const expiredSingleDay = timing('Nur am 18.7. gibt es in Wien Kaffee gratis.', '2026-07-19T10:00:00.000Z');
assert.equal(expiredSingleDay.offerWindow?.kind, 'single');
assert.equal(expiredSingleDay.explicitExpired, true);
assert.equal(expiredSingleDay.eligibleByAge, false);

const expiredSingleWithOpeningHours = timing(
  'Nur am 1.7. gibt es 20% Rabatt in Wien. Geöffnet Mo-Fr 10-18 Uhr.',
  '2026-06-25T10:00:00.000Z'
);
assert.equal(expiredSingleWithOpeningHours.explicitExpired, true);
assert.equal(expiredSingleWithOpeningHours.recurring, false);
assert.equal(expiredSingleWithOpeningHours.eligibleByAge, false);

const openingNarrativeWithActiveEnd = timing(
  'Am 8. Juli haben wir eröffnet; ab jetzt gibt es 20% Rabatt bis Ende August.',
  '2026-07-08T10:00:00.000Z'
);
assert.equal(openingNarrativeWithActiveEnd.explicitExpired, false);
assert.equal(openingNarrativeWithActiveEnd.offerWindow?.kind, 'month-end');
assert.equal(openingNarrativeWithActiveEnd.eligibleByAge, true);

const isoActiveRange = timing(
  'Le Pho Wien: 1+1 gratis von 2026-06-01 bis 2026-08-31.',
  '2026-06-15T10:00:00.000Z'
);
assert.equal(isoActiveRange.offerWindow?.kind, 'range');
assert.equal(isoActiveRange.offerWindow?.endDate?.toISOString().slice(0, 10), '2026-08-31');
assert.equal(isoActiveRange.eligibleByAge, true);

const openEndedOffer = timing(
  'Le Pho Wien: Seit 2026-07-01 bis auf Weiteres 1+1 gratis.',
  '2026-07-01T10:00:00.000Z'
);
assert.equal(openEndedOffer.offerWindow?.kind, 'ongoing');
assert.equal(openEndedOffer.offerWindow?.startDate?.toISOString().slice(0, 10), '2026-07-01');
assert.equal(openEndedOffer.expired, false);
assert.equal(openEndedOffer.eligibleByAge, true);

const aidsFutureEvent = timing(
  'Am 4. September 2026 findet unser 6. Straßenfest statt – gratis Kinderbetreuung in Wien.',
  '2026-07-18T10:00:00.000Z'
);
assert.equal(aidsFutureEvent.offerWindow?.kind, 'single');
assert.equal(aidsFutureEvent.offerWindow?.startDate?.toISOString().slice(0, 10), '2026-09-04');
assert.equal(aidsFutureEvent.notStarted, true);
assert.equal(aidsFutureEvent.eligibleByAge, false);

assert.equal(
  extractActiveOfferWindow('Gültig bis Ende März 2026', { now })?.endDate?.toISOString().slice(0, 10),
  '2026-03-31',
  'NFKD-normalized März must remain parseable'
);
assert.equal(
  extractActiveOfferWindow('Gültig bis Ende Jänner 2027', { now })?.endDate?.toISOString().slice(0, 10),
  '2027-01-31',
  'NFKD-normalized Jänner must remain parseable'
);

assert.equal(
  isYesterdayOnlyOffer('Gestern eröffnet, ab heute gibt es 1+1 in Wien bis Ende August.'),
  false,
  'narrative yesterday language must not expire a current offer'
);
assert.equal(
  isYesterdayOnlyOffer('Gestern war die Eröffnung, ab heute gibt es Kaffee gratis.'),
  false,
  'an opening narrative must not turn a current offer into a yesterday-only offer'
);
assert.equal(
  timing('Gestern eröffnet, ab heute gibt es 1+1 in Wien bis Ende August.', '2026-06-20T10:00:00.000Z').eligibleByAge,
  true,
  'the current offer following yesterday narrative should remain eligible'
);
assert.equal(isYesterdayOnlyOffer('Nur gestern gab es den Kaffee gratis.'), true);
assert.equal(
  timing('Nur gestern gab es den Kaffee gratis in Wien.', '2026-07-19T10:00:00.000Z').expired,
  true,
  'an explicitly yesterday-only offer is expired'
);

const futurePublication = timing('Wien: aktueller 1+1 Deal', '2026-07-20T12:11:00.000Z');
assert.equal(futurePublication.futurePublication, true, 'a post over 10 minutes in the future must be flagged');
assert.equal(futurePublication.eligibleByAge, false, 'a future publication must never count as fresh');
assert.equal(
  timing('Wien: aktueller 1+1 Deal', '2026-07-20T12:09:00.000Z').eligibleByAge,
  true,
  'small publication clock skew remains tolerated'
);

assert.equal(hasRecurringWeekdaySchedule('Happy Hour Mo-Fr 17-18 Uhr'), true);
assert.equal(hasRecurringWeekdaySchedule('Nur bis Freitag'), false, 'a one-off end weekday is not recurrence proof');
assert.equal(
  hasViennaInstagramEvidence('Free coffee at @bluetomatoshopwien Rotenturmstraße'),
  true,
  'a Vienna branch handle and Rotenturmstraße must count as Vienna evidence'
);
assert.equal(hasViennaInstagramEvidence('Free coffee at @bluetomatoshopsalzburg'), false);
assert.equal(hasRecurringOfferSchedule('Happy Hour Deal: Mo-Fr 17-18 Uhr ein Getränk gratis'), true);
assert.equal(
  hasRecurringOfferSchedule('Nur am 1.7. gibt es 20% Rabatt. Geöffnet Mo-Fr 10-18 Uhr.'),
  false,
  'opening hours must not extend an expired one-day offer'
);
assert.equal(
  extractActiveOfferWindow('Valid until the end of August', { pubDate: '2026-07-01', now })?.endDate?.toISOString().slice(0, 10),
  '2026-08-31'
);

function containsLoneSurrogate(value) {
  for (let index = 0; index < value.length; index += 1) {
    const unit = value.charCodeAt(index);
    if (unit >= 0xd800 && unit <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (!(next >= 0xdc00 && next <= 0xdfff)) return true;
      index += 1;
    } else if (unit >= 0xdc00 && unit <= 0xdfff) {
      return true;
    }
  }
  return false;
}

function assertNoLoneSurrogatesDeep(value, label = 'root') {
  if (typeof value === 'string') {
    assert.equal(containsLoneSurrogate(value), false, `${label} contains a lone UTF-16 surrogate`);
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((item, index) => assertNoLoneSurrogatesDeep(item, `${label}[${index}]`));
    return;
  }
  if (value && typeof value === 'object') {
    for (const [key, item] of Object.entries(value)) {
      assertNoLoneSurrogatesDeep(item, `${label}.${key}`);
    }
  }
}

const truncatedBeforeEmoji = unicodeSafeTruncate('ab😀cd', 3);
assert.equal(truncatedBeforeEmoji, 'ab');
assert.equal(containsLoneSurrogate(truncatedBeforeEmoji), false);
assert.equal(unicodeSafeTruncate('ab😀cd', 4), 'ab😀');
assert.equal(containsLoneSurrogate(unicodeSafeTruncate(`bad\ud83d text`, 20)), false);
assert.deepEqual(
  JSON.parse(JSON.stringify({ sample: unicodeSafeTruncate('Deal 😀😀😀 Ende', 9) })),
  { sample: 'Deal 😀😀' },
  'Unicode-safe report strings must survive JSON serialization'
);

const trackedReport = JSON.parse(fs.readFileSync(new URL('../docs/instagram-ai-report.json', import.meta.url), 'utf8'));
assertNoLoneSurrogatesDeep(trackedReport, 'instagram-ai-report');

console.log('Instagram AI active-offer validity tests passed');

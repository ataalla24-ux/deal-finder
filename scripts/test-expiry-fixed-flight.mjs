import assert from 'node:assert/strict';
import test from 'node:test';
import { assessFixedFlightEnd } from './expiry-fixed-flight.mjs';
import { assessAutomaticExpiry } from './automatic-deal-maintenance.mjs';

const bookingUrl = 'https://www.ryanair.com/gb/en/trip/flights/select?adults=1&originIata=VIE&destinationIata=BNX&dateOut=2026-11-14&dateIn=2026-11-20&isReturn=true';
const deal = {
  id: 'flight-5i0ef4', brand: 'Ryanair', category: 'reisen', type: 'rabatt',
  source: 'Slack Digest', originSource: 'Flights Vienna',
  url: bookingUrl, expiryKind: 'end', validUntil: '2026-11-14', dateConfidence: 'low',
  expires: '2026-11-14T23:59:59.999Z', expiresOriginal: '2026-11-14T12:00:00.000Z',
  expiryDisplayText: '2026-11-14T12:00:00.000Z',
  title: 'Wien–Banja Luka retour ab 47,59 €',
  description: 'Ryanair ab Wien nach Banja Luka: Hinflug 14.11.2026, Rückflug 20.11.2026. Preisstand 05.11.2026. Kein fester Rabatt oder dauerhaft gültiger Preis zugesagt.',
  flight: {
    provider: 'Ryanair', destination: { airportCode: 'BNX' }, tripDurationDays: 6,
    outbound: { departureDate: '2026-11-14' }, inbound: { departureDate: '2026-11-20' }, bookingUrl,
  },
  validity: {
    expiryDate: '2026-11-14T12:00:00.000Z',
    finalUrl: `${bookingUrl}&tpAdults=1&tpOriginIata=VIE&tpDestinationIata=BNX&tpStartDate=2026-11-14&tpEndDate=2026-11-20&tpIsReturn=true`,
  },
};

test('an exact itinerary expires on its outbound day independently of the fare snapshot', () => {
  assert.equal(assessFixedFlightEnd(deal), '2026-11-14');
  assert.equal(assessFixedFlightEnd({
    ...deal, description: 'Roundtrip Wien -> Banja Luka · 6 Tage · 2026-11-14 → 2026-11-20',
    expiresOriginal: 'Abflug 2026-11-14', expiryDisplayText: 'Abflug 2026-11-14',
  }), '2026-11-14');
});

test('maintenance expires a proven itinerary after its outbound day and rejects conflicting source timing', () => {
  const now = new Date('2026-11-16T12:00:00Z');
  assert.equal(assessAutomaticExpiry(deal, { now }).reason, 'confirmed-fixed-flight-itinerary');
  assert.equal(assessAutomaticExpiry(deal, { now: new Date('2026-11-14T23:59:59.998Z') }).eligible, false);
  assert.equal(assessAutomaticExpiry(deal, { now: new Date('2026-11-15T00:00:00Z') }).eligible, true);
  assert.equal(assessAutomaticExpiry({ ...deal, evidence: { offerTiming: { matchedText: 'Gültig bis 18.11.2026' } } }, { now }).eligible, false);
  assert.equal(assessAutomaticExpiry({ ...deal, evidence: { offerTiming: { matchedText: 'Die Aktion wurde verlängert.' } } }, { now }).eligible, false);
  assert.equal(assessAutomaticExpiry(deal, { now, edits: [{ dealId: deal.id, forceKeep: true }] }).eligible, false);
});

test('modified, ambiguous or unverified flight links do not prove expiry', () => {
  const alternatives = [
    bookingUrl.replace('www.ryanair.com', 'www.ryanair.com.example.org'),
    bookingUrl.replace('www.ryanair.com', 'click@www.ryanair.com'),
    bookingUrl.replace('/trip/flights/select', '/trip/flights'),
    bookingUrl.replace('https:', 'http:'),
    bookingUrl.replace('dateOut=2026-11-14', 'dateOut=2026-11-15'),
    bookingUrl.replace('destinationIata=BNX', 'destinationIata=MXP'),
    bookingUrl.replace('originIata=VIE', 'originIata=GRZ'),
    bookingUrl.replace('isReturn=true', 'isReturn=false'),
    `${bookingUrl}&dateOut=2026-11-14`,
    `${bookingUrl}&tpStartDate=2026-11-15`,
    `${bookingUrl}&flexible=true`,
    `${bookingUrl}#dateOut=2026-11-20`,
  ];
  for (const url of alternatives) assert.equal(assessFixedFlightEnd({ ...deal, url }), '', url);
  assert.equal(assessFixedFlightEnd({ ...deal, flight: { ...deal.flight, bookingUrl: alternatives[4] } }), '');
  assert.equal(assessFixedFlightEnd({ ...deal, validity: { ...deal.validity, finalUrl: alternatives[9] } }), '');
});

test('protected records, malformed or conflicting dates, and ambiguous trip copy stay visible', () => {
  for (const patch of [
    { originSource: 'Community' }, { category: 'freizeit' }, { forceKeep: true }, { campaignId: 'campaign' },
    { validUntil: '2026-11-20' }, { validOn: '2026-11-13' }, { validFrom: '2026-11-16' },
    { expires: '2026-11-14T99:59:59Z' }, { expiresOriginal: 'Abflug 2026-11-20' },
    { validity: { expiryDate: '2026-11-15' } },
    { flight: { ...deal.flight, outbound: { departureDate: '2026-02-30' } } },
    { flight: { ...deal.flight, inbound: { departureDate: '2026-11-13' } } },
    { flight: { ...deal.flight, provider: 'Kiwi' } },
    { flight: { ...deal.flight, tripDurationDays: 1 } },
    { description: 'Hinflug 14.11.2026 oder 18.11.2026, Rückflug 20.11.2026.' },
    { description: 'Hinflug nicht am 14.11.2026, Rückflug 20.11.2026.' },
    { description: 'Kein Hinflug 14.11.2026, Rückflug 20.11.2026.' },
    { description: 'Hinflug 14.11.2026 wurde verschoben.' },
    { description: 'Roundtrip ab Wien · 2026-11-15 → 2026-11-20' },
  ]) assert.equal(assessFixedFlightEnd({ ...deal, ...patch }), '', JSON.stringify(patch));
});

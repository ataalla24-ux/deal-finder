import assert from 'node:assert/strict';
import test from 'node:test';
import {parseExpiryDetails,parseExpiryShape} from '../scraper/expiry-utils.js';

const now = new Date('2026-11-13T16:00:00Z');
test('source observation dates never become offer deadlines', () => {
  for (const text of [
    'Aktuell bei Abruf am 12. November 2026; kein Enddatum angegeben Während der auf Lieferando angezeigten Bestellzeiten; keine genaue Aktionsuhrzeit angegeben',
    'Abgerufen am 12.11.2026; kein Enddatum angegeben',
    'Zuletzt geprüft am 2026-11-12; Enddatum unbekannt',
    'Stand: 12. November 2026; Verfügbarkeit beim Anbieter prüfen',
  ]) {
    assert.equal(parseExpiryDetails(text,{now}),null,text);
    const shape=parseExpiryShape(text,{now});
    assert.equal(shape.kind,'unknown',text);
    assert.equal(shape.validOn,undefined);
    assert.equal(shape.validUntil,undefined);
    assert.equal(shape.raw,text);
  }
});
test('separate explicit offer periods survive observation metadata', () => {
  for (const text of ['Stand: 12.11.2026; gültig bis 30.11.2026','Aktuell bei Abruf am 12. November 2026; nur am 14.11.2026']) {
    const expected=text.includes('30.11')?'2026-11-30':'2026-11-14';
    const shape=parseExpiryShape(text,{now});
    assert.equal(shape.validUntil||shape.validOn,expected,text);
    assert.equal(parseExpiryDetails(text,{now}).date.toISOString().slice(0,10),expected,text);
  }
  assert.equal(parseExpiryShape('Nur am 12. November 2026',{now}).validOn,'2026-11-12');
});

test('menu sighting alone cannot become a date; mixed offer periods survive', () => {
  const sighting = 'am 17. November 2026 auf der Speisekarte sichtbar';
  assert.equal(parseExpiryDetails(sighting, { now }), null);
  assert.equal(parseExpiryShape('am 17. November auf der Speisekarte sichtbar', { now }).kind, 'unknown');
  assert.equal(parseExpiryShape(sighting, { now }).kind, 'unknown');
  assert.equal(parseExpiryShape(sighting + '; gültig bis 29.11.2026', { now }).validUntil, '2026-11-29');
});

test('legacy structured dates clear only when derived from the same observation', async () => {
  const { normalizeDealExpiry } = await import('../scraper/expiry-utils.js');
  const sighting = 'am 17. November 2026 auf der Speisekarte sichtbar';
  const legacy = { id: 'bk', expiresOriginal: sighting, expiryDisplayText: sighting,
    expiryKind: 'single', validOn: '2026-11-17', expires: '2026-11-17T23:59:59.999Z', expiresSource: 'text',
    validity: { status: 'warning', expiryDate: '2026-11-17', expirySource: 'deal.structured' } };
  const repaired = await normalizeDealExpiry(structuredClone(legacy), { allowUrlLookup: false, now });
  assert.equal(repaired.expires, '');
  assert.equal(repaired.expiryKind, 'unknown');
  assert.equal(repaired.validOn, undefined);
  assert.equal(repaired.validity.expiryDate, '');
  assert.equal(repaired.validity.status, 'warning');
  const { repairObservationExpiry } = await import('../scraper/expiry-utils.js');
  for (const patch of [{ validUntil: '2026-11-24' }, { expires: '2026-11-24' }, { description:'Aktion gültig bis 24.11.2026' }, { expiryDisplayText: 'Nur am 17.11.2026' },
    { expiresSource:'manual' }, { expiresDetectedFromUrl:true }, { communityDateReview:{} },
    { expiresOriginal: sighting + '; gültig bis 24.11.2026' }]) {
    assert.equal(repairObservationExpiry({ ...legacy, ...patch }, { now }), false);
  }
});

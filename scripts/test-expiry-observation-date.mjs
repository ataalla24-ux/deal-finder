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

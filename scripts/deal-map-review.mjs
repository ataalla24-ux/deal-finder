import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { inspectDealLocation, locationFingerprint, verifiedLocation } from './deal-map-enrichment.mjs';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const object = value => value && typeof value === 'object' && !Array.isArray(value);
const text = (value, max = 240) => Array.from(String(value || '').toWellFormed()
  .replace(/\s+/g, ' ').trim()).slice(0, max).join('');
const escapeSlack = value => value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const reasonLabels = {
  'existing-registry': 'Die Filiale ist im Kartenregister bereits sicher zugeordnet.',
  'published-map-coverage': 'Der unver\u00e4nderte Deal ist im aktuellen Kartenregister einem verifizierten Standort zugeordnet.',
  'verified-address-reuse': 'Die Adresse stimmt mit einem verifizierten Kartenstandort \u00fcberein.',
  'named-venue': 'Die konkret genannte Filiale ist als Kartenstandort verifiziert.',
  'multiple-branches-need-review': 'Mehrere Filialen genannt; die g\u00fcltige Filiale muss best\u00e4tigt werden.',
  'no-current-reviewed-branch': 'Keine der gepr\u00fcften Filialen ist derzeit g\u00fcltig.',
  'inactive-registry-branch': 'Die best\u00e4tigte Filialzuordnung ist derzeit nicht g\u00fcltig; keine automatische Ersatzzuordnung.',
  'reopened-reviewed-branch': 'Der best\u00e4tigte Filialzeitraum hat begonnen.',
  'address-in-caption-needs-review': 'Die Adresse steht nur im Quelltext und muss best\u00e4tigt werden.',
  'vienna-address-needs-review': 'Der Wien-Bezug der Adresse muss best\u00e4tigt werden.',
  'outside-vienna-needs-review': 'Ort oder Postleitzahl widersprechen einem Wiener Standort; bitte pr\u00fcfen.',
  'missing-exact-address': 'Eine eindeutige Adresse mit Hausnummer fehlt.',
  'online-only': 'Das Angebot wird ausschlie\u00dflich online oder per Lieferung genutzt.',
};

function optionalJson(file) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return null; }
}

// Missing fixture files or unreadable review data must not block Slack review.
export function loadDealMapReviewContext({ root = ROOT, now = new Date() } = {}) {
  const map = optionalJson(path.join(root, 'docs', 'deal-map-locations.json'));
  const reviewed = optionalJson(path.join(root, 'reviews', 'map-addresses.json'));
  const catalog = optionalJson(path.join(root, 'reviews', 'map-location-catalog.json'));
  const coverage = optionalJson(path.join(root, 'reviews', 'map-coverage.json'));
  return {
    map: Array.isArray(map?.locations) ? map : { locations: [] },
    mapAvailable: Array.isArray(map?.locations),
    reviewed: object(reviewed) ? reviewed : {},
    ...(object(catalog) ? { catalog } : {}),
    coverage: Array.isArray(coverage?.deals) ? coverage : { deals: [] },
    today: new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Vienna' }).format(now),
  };
}

function inspectPublishedDealMap(deal, context) {
  const inspection = inspectDealLocation(deal, context);
  // Source-discovered addresses are ephemeral. Trust only unchanged, published
  // bindings, without overriding the inspector's online or branch safety guards.
  if (inspection.reason !== 'missing-exact-address' || inspection.status !== 'needs-review' || !deal.id) return inspection;
  const rows = Array.isArray(context.coverage?.deals) ? context.coverage.deals : [];
  if (!rows.some(row => row?.id === deal.id && row.status === 'mapped' && row.fingerprint === locationFingerprint(deal))) return inspection;
  const today = context.today || new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Vienna' }).format(new Date());
  const locationIds = (context.map?.locations || [])
    .filter(location => typeof location.id === 'string' && location.id.trim()
      && Array.isArray(location.dealIds) && location.dealIds.includes(deal.id)
      && verifiedLocation(location, today))
    .map(location => location.id);
  return locationIds.length ? {
    ...inspection, status: 'mapped', locationIds: [...new Set(locationIds)], reason: 'published-map-coverage',
  } : inspection;
}

export function reviewDealMap(deal, context = loadDealMapReviewContext(), { business = false } = {}) {
  const inspection = inspectPublishedDealMap(deal, context);
  const summaries = {
    mapped: `${inspection.locationIds.length} sichere Karten-Zuordnung(en).`,
    'address-ready': 'Karten-Zuordnung fehlt; Adresse vorhanden, Geocoding noch nicht verifiziert.',
    'needs-review': 'Keine sichere Karten-Zuordnung; Adresse/Filiale pr\u00fcfen.',
    'online-only': 'Reines Online-/Lieferangebot; kein Kartenpunkt erforderlich.',
  };
  const needsReview = ['address-ready', 'needs-review'].includes(inspection.status);
  const summary = summaries[inspection.status];
  const details = [
    context.mapAvailable === false ? 'Kartenregister nicht verf\u00fcgbar.' : '',
    reasonLabels[inspection.reason] || (inspection.reason && !/^[a-z0-9]+(?:-[a-z0-9]+)+$/.test(inspection.reason)
      ? text(inspection.reason) : ''),
    needsReview ? (business ? 'Adresse im Business-Datensatz pr\u00fcfen.' : 'Bearbeiten: Ort/Adresse pr\u00fcfen.') : '',
  ].filter(Boolean).join(' ');
  return {
    ...inspection,
    // These strings belong only to Slack, never to a deal or proposed public edit.
    text: escapeSlack(`INTERN Karte: [${inspection.status}] ${summary} ${details} Nur Hinweis, keine Freigabe-/Entfernungsregel.`),
    reviewReason: needsReview ? `INTERN Karte: ${summary}` : '',
  };
}

export function dealMapReviewBlock(review) {
  return { type: 'context', elements: [{ type: 'mrkdwn', text: review.text }] };
}

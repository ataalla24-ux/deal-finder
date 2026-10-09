import { createHash } from 'node:crypto';

export const GEO_ENDPOINT = 'https://data.wien.gv.at/daten/geo';
const manager = 'exact-vienna-address-v1';
export const normalize = value => String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/ß/g, 'ss').replace(/[^a-z0-9]+/g, ' ').trim();

// A street and house number are mandatory. Never geocode a city or merchant name.
export function extractAddresses(value) {
  const pattern = /\b((?:[A-ZÄÖÜ][\p{L}.-]*[ -]){0,2}(?:[A-ZÄÖÜ][\p{L}-]*(?:straße|strasse|gasse|platz|allee|weg|kai|ring|gürtel|markt|zeile|damm|ufer|steig|hof)|Straße|Strasse|Gasse|Platz|Allee|Weg|Kai|Ring|Gürtel|Markt|Hof))\s+(\d+[a-zA-Z]?(?:[-/]\d+[a-zA-Z]?)?)(?:,?\s+(1\d{3})\s+Wien)?/gu;
  return [...String(value || '').matchAll(pattern)].map(m => ({ street: m[1], number: m[2], postalCode: m[3] || '' }));
}

export function onlineOnly(deal) {
  if (/^flight-/.test(deal.id || '')) return true;
  let host = '';
  try { host = new URL(deal.url).hostname; } catch {}
  if (/(^|\.)(wolt\.com|lieferando\.at|foodora\.at)$/.test(host)) return true;
  const place = normalize([deal.address, deal.location, deal.distance].join(' '));
  if (/\b(online|onlineshop|webshop|streaming|lieferservice|lieferdienst)\b/.test(place)) return true;
  if (extractAddresses([deal.address, deal.location, deal.distance].join(' ')).length) return false;
  if (/\b(filial\w*|standort\w*|vor ort|tankstelle\w*)\b/.test(place)) return false;
  return /\b(online|onlineshop|webshop|streaming|downloads|lieferservice)\b/.test(normalize(`${deal.title} ${deal.description}`));
}

export function candidatesFor(deal, reviewed, today) {
  if (onlineOnly(deal)) return { reason: 'online-only', addresses: [] };
  const override = reviewed[deal.id];
  if (override) {
    const addresses = override.locations.filter(x => (!x.validFrom || x.validFrom <= today) && (!x.validUntil || x.validUntil >= today));
    return { reason: addresses.length ? '' : 'no-current-reviewed-branch', addresses };
  }
  const candidates = [deal.address, deal.location, deal.distance].flatMap(extractAddresses);
  const unique = [...new Map(candidates.map(x => [normalize(`${x.street} ${x.number}`), x])).values()];
  // A caption can contain different conditions per branch; it must be reviewed first.
  const sourceText = deal.viennaEvidence?.verified === true ? deal.viennaEvidence.detail : '';
  const caption = [deal.brand, deal.description, deal.metaGraphCaption, sourceText].flatMap(extractAddresses);
  const allKeys = new Set([...unique, ...caption].map(x => normalize(`${x.street} ${x.number}`)));
  if (allKeys.size > 1) return { reason: 'multiple-branches-need-review', addresses: [] };
  if (!unique.length) {
    const context = [deal.address, deal.location, deal.distance, deal.description, deal.metaGraphCaption, sourceText].join(' ');
    if (caption.length && /\b(?:Wien|Vienna|1(?:0[1-9]|1\d|2[0-3])0)\b/i.test(context)) {
      return { reason: '', addresses: [caption[0]] };
    }
    return { reason: caption.length ? 'address-in-caption-needs-review' : 'missing-exact-address', addresses: [] };
  }
  return { reason: '', addresses: unique };
}

export function selectExactFeature(features, address) {
  const streetKey = value => normalize(value).replace(/ /g, '');
  const hits = features.filter(f => streetKey(f.properties?.NAME_STR) === streetKey(address.street)
    && (normalize(f.properties?.NAME_ONR) === normalize(address.number)
      || (address.number.includes('/') && normalize(f.properties?.NAME_ONR) === normalize(address.number.split('/')[0])))
    && (!address.postalCode || f.properties?.PLZ === address.postalCode)
    && f.geometry?.type === 'Point'
    && f.geometry.coordinates[0] >= 16.15 && f.geometry.coordinates[0] <= 16.60
    && f.geometry.coordinates[1] >= 48.10 && f.geometry.coordinates[1] <= 48.35);
  if (!hits.length) return null;
  // Separate buildings/entrances at the same address must not be kilometres apart.
  const [lng, lat] = hits[0].geometry.coordinates;
  if (hits.some(f => Math.hypot((f.geometry.coordinates[0] - lng) * 74000, (f.geometry.coordinates[1] - lat) * 111000) > 100)) return null;
  return hits.sort((a, b) => String(a.id).localeCompare(String(b.id)))[0];
}

export async function geocode(address, fetcher = fetch) {
  const quote = text => String(text).replace(/'/g, "''");
  const url = new URL(GEO_ENDPOINT);
  const streets = [...new Set([address.street, address.street.replace(/strasse/gi, 'straße'),
    address.street.replace(/(?:strasse|straße)$/i, ' Straße').replace(/\s+/g, ' ').trim()])];
  const numbers = [...new Set([address.number, address.number.split('/')[0]])];
  url.search = new URLSearchParams({ service: 'WFS', request: 'GetFeature', version: '1.1.0',
    typeName: 'ogdwien:ADRESSENOGD', outputFormat: 'json', srsName: 'EPSG:4326', maxFeatures: '100',
    propertyName: 'NAME,NAME_STR,NAME_ONR,PLZ,SHAPE',
    cql_filter: `(${streets.map(s => `NAME_STR ILIKE '${quote(s)}'`).join(' OR ')}) AND (${numbers.map(n => `NAME_ONR ILIKE '${quote(n)}'`).join(' OR ')})` });
  const response = await fetcher(url, { signal: AbortSignal.timeout(15000) });
  if (!response.ok) throw new Error(`Address service HTTP ${response.status}`);
  const payload = await response.json();
  if (!Array.isArray(payload.features) || payload.numberMatched > 100) throw new Error('Invalid or ambiguous address response');
  const feature = selectExactFeature(payload.features, address);
  return feature ? { latitude: feature.geometry.coordinates[1], longitude: feature.geometry.coordinates[0],
    address: `${feature.properties.NAME_STR} ${feature.properties.NAME_ONR}, ${feature.properties.PLZ} Wien`,
    featureId: feature.id, source: String(url) } : null;
}

export async function enrichMap({ deals, map, reviewed = {}, cache = {}, now = new Date(), lookup = geocode, maxRequests = 20 }) {
  const today = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Vienna' }).format(now);
  const locations = map.locations.filter(x => x.managedBy !== manager);
  const report = [];
  let requests = 0;
  for (const deal of deals) {
    if (locations.some(x => x.dealIds?.includes(deal.id))) {
      report.push({ id: deal.id, brand: deal.brand, status: 'existing-registry' });
      continue;
    }
    const candidates = candidatesFor(deal, reviewed, today);
    let added = 0;
    const failures = [];
    for (const address of candidates.addresses) {
      const key = normalize(`${address.street} ${address.number} ${address.postalCode || ''}`);
      const cached = cache[key];
      const age = cached ? now - new Date(cached.checkedAt) : Infinity;
      let result = cached?.result;
      if (!(age >= 0 && age < (result ? 180 : 1) * 86400000 && (result || cached?.queryVersion === 3))) {
        if (requests >= maxRequests) { failures.push('request-budget'); continue; }
        requests++;
        try {
          result = await lookup(address);
          cache[key] = { checkedAt: now.toISOString(), queryVersion: 3, result };
        } catch (error) {
          failures.push(error.message);
          // Keep a previously verified result during a temporary network outage.
          result = cached?.result;
        }
      }
      if (!result) { failures.push('no-exact-coordinate-match'); continue; }
      const id = createHash('sha256').update(`${deal.id}|${key}`).digest('hex').slice(0, 16);
      locations.push({ id: `address-${id}`, name: deal.brand, address: result.address,
        latitude: result.latitude, longitude: result.longitude, confidence: 1,
        source: result.source, managedBy: manager, dealIds: [deal.id],
        evidenceUrl: reviewed[deal.id]?.evidenceUrl || deal.url,
        attribution: 'Datenquelle: Stadt Wien - data.wien.gv.at',
        ...(address.validFrom ? { validFrom: address.validFrom } : {}),
        ...(address.validUntil ? { validUntil: address.validUntil } : {}) });
      added++;
    }
    report.push({ id: deal.id, brand: deal.brand, status: added ? (failures.length ? 'partially-mapped' : 'mapped') : candidates.reason || 'geocode-review', failures });
  }
  const changed = JSON.stringify(map.locations) !== JSON.stringify(locations);
  return { map: changed ? { ...map, lastUpdated: now.toISOString(), locations } : map, cache,
    report: { totalDeals: deals.length, mappedDeals: new Set(locations.flatMap(x => x.dealIds || []).filter(id => deals.some(d => d.id === id))).size, locations: locations.length, deals: report }, requests };
}

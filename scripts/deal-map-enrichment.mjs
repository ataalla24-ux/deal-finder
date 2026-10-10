import { createHash } from 'node:crypto';

export const GEO_ENDPOINT = 'https://data.wien.gv.at/daten/geo';
const manager = 'exact-vienna-address-v1';
const bindingVersion = 2;
export const normalize = value => String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/ß/g, 'ss').replace(/[^a-z0-9]+/g, ' ').trim();
const validDay = value => !value || (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)
  && Number.isFinite(Date.parse(`${value}T00:00:00Z`)) && new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value);

export function locationFingerprint(deal) {
  return createHash('sha256').update(JSON.stringify([deal.brand, deal.title, deal.description,
    deal.address, deal.location, deal.distance, deal.url, deal.metaGraphCaption, deal.viennaEvidence,
    deal.offerValidityText, deal.validOn, deal.validFrom, deal.validUntil, deal.expires, deal.expiry, deal.expiresAt,
    deal.city, deal.addressLocality, deal.postalCode, deal.postcode])).digest('hex').slice(0, 24);
}

export function verifiedLocation(location, today = '') {
  return Number(location.confidence) >= 0.9 && Number(location.confidence) <= 1
    && Number.isFinite(location.latitude) && location.latitude >= 48.10 && location.latitude <= 48.35
    && Number.isFinite(location.longitude) && location.longitude >= 16.15 && location.longitude <= 16.60
    && Boolean(location.address && location.source)
    && validDay(location.validFrom) && validDay(location.validUntil)
    && (!location.validFrom || !location.validUntil || location.validFrom <= location.validUntil)
    && (!today || ((!location.validFrom || location.validFrom <= today) && (!location.validUntil || location.validUntil >= today)));
}

const addressKey = address => normalize(`${address.street} ${address.number}`).replace(/ /g, '');
function matchesAddress(location, address) {
  return extractAddresses(location.address).some(candidate => (addressKey(candidate) === addressKey(address)
      || (String(address.number).includes('/') && addressKey(candidate) === addressKey({ ...address, number: address.number.split('/')[0] })))
    && (!address.postalCode || candidate.postalCode === address.postalCode));
}
const sameBranchWindow = (location, address) => (location.validFrom || '') === (address.validFrom || '')
  && (location.validUntil || '') === (address.validUntil || '');

function catalogLocations(map = {}, catalog = {}) {
  return [...new Map([...(catalog.locations || []), ...(map.locations || [])].map(location => [location.id, location])).values()];
}

function datedLocationIds(deal, map, catalog, addresses, today) {
  const fingerprint = locationFingerprint(deal);
  const binding = (catalog.dealBindings || []).find(entry => entry.dealId === deal.id);
  if (binding) return binding.fingerprint === fingerprint ? binding.locationIds : [];
  const exclusion = (map.geocodingExclusions || []).find(entry => entry.dealId === deal.id && entry.fingerprint === fingerprint);
  const dated = (map.locations || [])
    .filter(location => location.dealIds?.includes(deal.id) && (location.validFrom || location.validUntil)
      && ((location.managedBy !== manager && !location.automaticDealIds?.includes(deal.id)) || !verifiedLocation(location, today))
      && (!addresses.length || addresses.some(address => matchesAddress(location, address))))
    .map(location => location.id);
  // A dated branch must not displace an independently approved undated sibling.
  const siblings = dated.length ? (map.locations || []).filter(location => location.dealIds?.includes(deal.id)
    && !location.validFrom && !location.validUntil && location.managedBy !== manager
    && !location.automaticDealIds?.includes(deal.id)
    && (!addresses.length || addresses.some(address => matchesAddress(location, address)))).map(location => location.id) : [];
  return [...new Set([...(exclusion?.locationIds || []), ...dated, ...siblings])];
}

// A street and house number are mandatory. Never geocode a city or merchant name.
export function extractAddresses(value) {
  const pattern = /\b((?:[A-ZÄÖÜ][\p{L}.-]*[ -]){0,2}(?:[A-ZÄÖÜa-zäöü][\p{L}-]*(?:straße|strasse|gasse|platz|allee|weg|kai|ring|gürtel|markt|zeile|damm|ufer|steig|hof)|Straße|Strasse|Gasse|Platz|Allee|Weg|Kai|Ring|Gürtel|Markt|Hof))\s+(\d+[a-zA-Z]?(?:[-/]\d+[a-zA-Z]?)?)(?:,?\s+(1\d{3})\s+[Ww]ien)?/gu;
  return [...String(value || '').matchAll(pattern)].map(m => ({ street: m[1], number: m[2], postalCode: m[3] || '' }));
}

export function onlineOnly(deal) {
  if (/^flight-/.test(deal.id || '')) return true;
  let host = '';
  try { host = new URL(deal.url).hostname; } catch {}
  const offerText = normalize(`${deal.title} ${deal.description} ${deal.distance}`);
  const pickup = /\b(zur abholung|bei abholung|fur abholer|abholung moglich|auch vor ort|vor ort einlosbar)\b/.test(offerText)
    && !/\b(keine abholung|nicht (?:bei abholung|vor ort)|nur lieferung)\b/.test(offerText);
  if (/\b(nur online|ausschliesslich online|online only|nur lieferung)\b/.test(offerText)) return true;
  if (/(^|\.)(wolt\.com|lieferando\.at|foodora\.at)$/.test(host)) return !pickup;
  if (/\b(?:uber|via|bei) (?:wolt|lieferando|foodora)\b/.test(offerText)
    || /^\s*(?:wolt|lieferando|foodora):/i.test(deal.title || '') || /lieferando\+/i.test(deal.title || '')) return !pickup;
  const place = normalize([deal.address, deal.location, deal.distance].join(' '));
  if (/\b(online|onlineshop|webshop|streaming|lieferservice|lieferdienst)\b/.test(place)) return !pickup;
  if (extractAddresses([deal.address, deal.location, deal.distance].join(' ')).length) return false;
  if (/\b(filial\w*|standort\w*|vor ort|tankstelle\w*)\b/.test(place)) return false;
  return /\b(online|onlineshop|webshop|streaming|downloads|lieferservice)\b/.test(normalize(`${deal.title} ${deal.description}`));
}

export function candidatesFor(deal, reviewed, today) {
  if (onlineOnly(deal)) return { reason: 'online-only', addresses: [] };
  const override = reviewed[deal.id];
  if (override) {
    const addresses = (override.locations || []).filter(x => x.street && x.number && validDay(x.validFrom) && validDay(x.validUntil)
      && (!x.validFrom || x.validFrom <= today) && (!x.validUntil || x.validUntil >= today));
    return { reason: addresses.length ? '' : 'no-current-reviewed-branch', addresses };
  }
  const structuredCity = normalize(deal.city || deal.addressLocality);
  const structuredPostcode = String(deal.postalCode || deal.postcode || '').trim();
  const locationText = [deal.address, deal.location, deal.distance, deal.description, deal.metaGraphCaption,
    deal.viennaEvidence?.verified === true ? deal.viennaEvidence.detail : ''].filter(Boolean).join(' ');
  if ((structuredCity && !['wien', 'vienna'].includes(structuredCity))
    || (structuredPostcode && !/^1\d{3}$/.test(structuredPostcode))
    || /(?<![\d./-])\b[2-9]\d{3}\s+[A-ZÄÖÜ]/u.test(locationText)
    || /\b(?:Graz|Linz|Salzburg|Innsbruck|Berlin|München|Munich|Hamburg)\b/i.test(locationText)) {
    return { reason: 'outside-vienna-needs-review', addresses: [] };
  }
  const candidates = [deal.address, deal.location, deal.distance].flatMap(extractAddresses);
  const unique = [...new Map(candidates.map(x => [normalize(`${x.street} ${x.number}`), x])).values()];
  // A caption can contain different conditions per branch; it must be reviewed first.
  const sourceText = deal.viennaEvidence?.verified === true ? deal.viennaEvidence.detail : '';
  const caption = [deal.brand, deal.description, deal.metaGraphCaption, sourceText].flatMap(extractAddresses);
  const allKeys = new Set([...unique, ...caption].map(x => normalize(`${x.street} ${x.number}`)));
  if (allKeys.size > 1) return { reason: 'multiple-branches-need-review', addresses: [] };
  const placeContext = [deal.address, deal.location, deal.distance].filter(Boolean).join(' ');
  if (unique.length && !/\b(?:Wien|Vienna|1(?:0[1-9]|1\d|2[0-3])0)\b/i.test(placeContext)) {
    return { reason: 'vienna-address-needs-review', addresses: [] };
  }
  if (!unique.length) {
    const context = [deal.address, deal.location, deal.distance, deal.description, deal.metaGraphCaption, sourceText].join(' ');
    if (caption.length && /\b(?:Wien|Vienna|1(?:0[1-9]|1\d|2[0-3])0)\b/i.test(context)) {
      return { reason: '', addresses: [caption[0]] };
    }
    return { reason: caption.length ? 'address-in-caption-needs-review' : 'missing-exact-address', addresses: [] };
  }
  return { reason: '', addresses: unique };
}

// Reuse venue identity only when the branch itself is named, never brand alone.
function namedVenueMatches(deal, locations) {
  const place = normalize([deal.address, deal.location, deal.distance].join(' '));
  const title = normalize(deal.title);
  if (/\b(nicht|kein|keine|ausgenommen|ausser|except|excluding)\b/.test(`${place} ${title}`)) return [];
  if (/\b(alle|mehrere|teilnehmende|ausgewahlte)\b.{0,50}\b(filialen|standorte|restaurants)\b/.test(`${place} ${title}`)) return [];
  const significant = text => normalize(text).split(' ').filter(word => !['wien', 'vienna', 'im', 'in', 'am', 'der', 'die', 'das', 'bei', 'westfield'].includes(word));
  const placeTokens = new Set(significant(place));
  const titleTokens = new Set(significant(title));
  const matches = locations.filter(location => {
    const name = normalize(location.name);
    if (name.length < 6) return false;
    const tokens = significant(name);
    const titleNamesVenue = name.split(' ').length >= 2 && (` ${title} `.includes(` ${name} `) || ` ${place} `.includes(` ${name} `));
    const placeNamesBranch = tokens.length >= 2 && tokens.every(token => placeTokens.has(token));
    const titleNamesBranch = tokens.length >= 2 && tokens.every(token => titleTokens.has(token));
    return titleNamesVenue || placeNamesBranch || titleNamesBranch;
  });
  const addresses = new Set(matches.map(location => normalize(location.address)));
  return addresses.size === 1 ? matches.slice(0, 1) : [];
}

export function inspectDealLocation(deal, { map = {}, catalog = {}, reviewed = {}, today = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Vienna' }).format(new Date()) } = {}) {
  const candidates = candidatesFor(deal, reviewed, today);
  const base = { locationIds: [], addresses: candidates.addresses, reason: candidates.reason, channel: 'onsite-or-unknown' };
  if (candidates.reason === 'online-only') return { ...base, status: 'online-only', channel: 'online' };
  const fingerprint = locationFingerprint(deal);
  const priorExclusion = (map.geocodingExclusions || []).find(entry => entry.dealId === deal.id && entry.fingerprint === fingerprint);
  const datedIds = datedLocationIds(deal, map, catalog, candidates.addresses, today);
  if (!reviewed[deal.id] && (!candidates.reason || candidates.reason === 'missing-exact-address')
    && (priorExclusion || datedIds.length)) {
    const ids = new Set(datedIds);
    const reopened = catalogLocations(map, catalog).filter(location => ids.has(location.id) && verifiedLocation(location, today));
    if (reopened.length) return { ...base, addresses: [], status: 'mapped', reason: 'reopened-reviewed-branch', locationIds: reopened.map(location => location.id) };
    return { ...base, addresses: [], status: 'needs-review', reason: 'inactive-registry-branch' };
  }
  const approved = (map.locations || []).filter(location => verifiedLocation(location, today)
    && location.dealIds?.includes(deal.id) && location.managedBy !== manager
    && !location.automaticDealIds?.includes(deal.id));
  if (candidates.reason === 'multiple-branches-need-review' && approved.length && !reviewed[deal.id]) {
    const mentioned = [deal.address, deal.location, deal.distance, deal.brand, deal.description, deal.metaGraphCaption,
      deal.viennaEvidence?.verified === true ? deal.viennaEvidence.detail : ''].flatMap(extractAddresses);
    if (mentioned.length && mentioned.every(address => approved.some(location => matchesAddress(location, address)))) {
      return { ...base, status: 'mapped', reason: 'existing-registry', locationIds: approved.map(x => x.id) };
    }
  }
  if (['multiple-branches-need-review', 'no-current-reviewed-branch', 'address-in-caption-needs-review', 'vienna-address-needs-review', 'outside-vienna-needs-review'].includes(candidates.reason)) {
    return { ...base, status: 'needs-review' };
  }
  const locations = catalogLocations(map, catalog).filter(location => verifiedLocation(location, today));
  const explicit = approved.filter(location => !candidates.addresses.length || candidates.addresses.some(address => matchesAddress(location, address)));
  if (explicit.length && !reviewed[deal.id]) {
    const named = !candidates.addresses.length ? namedVenueMatches(deal, locations) : [];
    const narrowed = named.length && explicit.some(location => location.id === named[0].id) ? named : explicit;
    return { ...base, status: 'mapped', reason: 'existing-registry', locationIds: narrowed.map(x => x.id) };
  }
  if (candidates.addresses.length) {
    const matches = candidates.addresses.map(address => locations.find(location => matchesAddress(location, address) && sameBranchWindow(location, address)));
    return { ...base, status: matches.every(Boolean) ? 'mapped' : 'address-ready', reason: matches.every(Boolean) ? 'verified-address-reuse' : '',
      locationIds: [...new Set(matches.filter(Boolean).map(x => x.id))] };
  }
  const named = namedVenueMatches(deal, locations);
  if (named.length) return { ...base, status: 'mapped', reason: 'named-venue', locationIds: named.map(x => x.id) };
  return { ...base, status: 'needs-review' };
}

export function selectExactFeature(features, address) {
  const streetKey = value => normalize(value).replace(/ /g, '');
  const hits = features.filter(f => f && streetKey(f.properties?.NAME_STR) === streetKey(address.street)
    && (normalize(f.properties?.NAME_ONR) === normalize(address.number)
      || (address.number.includes('/') && normalize(f.properties?.NAME_ONR) === normalize(address.number.split('/')[0])))
    && (!address.postalCode || f.properties?.PLZ === address.postalCode)
    && f.geometry?.type === 'Point'
    && Array.isArray(f.geometry.coordinates) && f.geometry.coordinates.length >= 2
    && Number.isFinite(f.geometry.coordinates[0]) && Number.isFinite(f.geometry.coordinates[1])
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

export async function enrichMap({ deals, map, reviewed = {}, cache = {}, catalog = {}, now = new Date(), lookup = geocode, maxRequests = 20 }) {
  const today = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Vienna' }).format(now);
  const liveIds = new Set(deals.map(deal => deal.id));
  const known = catalogLocations(map, catalog).filter(location => verifiedLocation(location));
  const locations = map.locations.filter(x => x.managedBy !== manager).map(location => {
    const { automaticDealIds, ...entry } = location;
    return { ...entry, dealIds: (entry.dealIds || []).filter(id => liveIds.has(id) && !automaticDealIds?.includes(id)) };
  });
  const report = [];
  const exclusions = [];
  let requests = 0;
  const budget = Number.isFinite(maxRequests) ? Math.max(0, Math.floor(maxRequests)) : 0;
  const lookupErrors = new Map();
  const geocodeKey = address => normalize(`${address.street} ${address.number} ${address.postalCode || ''}`);
  const fresh = cached => {
    const age = cached ? now - new Date(cached.checkedAt) : Infinity;
    return age >= 0 && age < (cached?.result ? 180 : 1) * 86400000 && (cached?.result || cached?.queryVersion === 3);
  };
  const coolingDown = cached => {
    const age = cached?.lastFailureAt ? now - new Date(cached.lastFailureAt) : Infinity;
    return age >= 0 && age < 15 * 60000;
  };
  // Schedule unique address lookups independently; apply their results in feed order below.
  const pending = new Map();
  for (const deal of deals) {
    const assessment = inspectDealLocation(deal, { map, catalog: { ...catalog, locations: known }, reviewed, today });
    for (const address of assessment.addresses) {
      const key = geocodeKey(address);
      const cached = cache[key];
      if (pending.has(key) || known.some(location => matchesAddress(location, address)) || fresh(cached) || coolingDown(cached)) continue;
      const attemptedAt = Date.parse(cached?.lastAttemptAt || cached?.checkedAt);
      const lastAttempt = Number.isFinite(attemptedAt) && attemptedAt >= 0 && attemptedAt <= now.getTime() ? attemptedAt : -Infinity;
      pending.set(key, { key, address, lastAttempt, index: pending.size });
    }
  }
  const resolved = [];
  for (const { key, address } of [...pending.values()].sort((a, b) => a.lastAttempt - b.lastAttempt || a.index - b.index)) {
    // Different query keys can refer to the same verified building or entrance.
    if (resolved.some(result => matchesAddress(result, address))) continue;
    if (requests >= budget) break;
    requests++;
    const cached = cache[key];
    try {
      const result = await lookup(address);
      cache[key] = { checkedAt: now.toISOString(), queryVersion: 3, result, lastAttemptAt: now.toISOString() };
      if (result && verifiedLocation({ ...result, confidence: 1 }) && matchesAddress(result, address)) resolved.push(result);
    } catch (error) {
      lookupErrors.set(key, error.message);
      // Preserve the age and value of a prior result; a failed attempt never refreshes it.
      cache[key] = { ...cached, lastAttemptAt: now.toISOString(), lastFailureAt: now.toISOString() };
    }
  }
  function attach(location, deal, automatic = true) {
    let target = locations.find(x => x.id === location.id);
    if (!target) {
      // Native clients receive explicit IDs, not broad merchant-name rules.
      const { brandMatches, placeMatches, titleMatches, automaticDealIds, ...entry } = location;
      target = { ...entry, dealIds: [] };
      locations.push(target);
    }
    if (!target.dealIds.includes(deal.id)) target.dealIds.push(deal.id);
    if (automatic) target.automaticDealIds = [...new Set([...(target.automaticDealIds || []), deal.id])];
    if (!known.some(entry => entry.id === target.id)) known.push(target);
  }
  for (const deal of deals) {
    const assessment = inspectDealLocation(deal, { map, catalog: { ...catalog, locations: known }, reviewed, today });
    // Re-evaluate after edits; a former explicit link must not defeat a new address.
    for (const location of locations) {
      if (!assessment.locationIds.includes(location.id)) location.dealIds = location.dealIds.filter(id => id !== deal.id);
    }
    let added = 0;
    const failures = [];
    for (const locationId of assessment.locationIds) {
      const location = known.find(x => x.id === locationId);
      attach(location, deal, assessment.reason !== 'existing-registry');
      added++;
    }
    for (const address of assessment.addresses) {
      if (assessment.locationIds.some(id => matchesAddress(known.find(x => x.id === id), address))) continue;
      const key = geocodeKey(address);
      const cached = cache[key];
      const knownAddress = known.find(location => matchesAddress(location, address))
        || (!fresh(cached) && resolved.find(result => matchesAddress(result, address)));
      let result = knownAddress || cached?.result;
      if (!knownAddress && lookupErrors.has(key)) failures.push(lookupErrors.get(key));
      else if (!knownAddress && !fresh(cached)) {
        if (coolingDown(cached)) failures.push('geocode-cooldown');
        else { failures.push('request-budget'); continue; }
      }
      if (!result || !verifiedLocation({ ...result, confidence: 1 }) || !matchesAddress(result, address)) {
        failures.push('no-exact-coordinate-match'); continue;
      }
      const id = createHash('sha256').update(`${key}|${address.validFrom || ''}|${address.validUntil || ''}`).digest('hex').slice(0, 16);
      attach({ id: `address-${id}`, name: deal.brand || deal.title, address: result.address,
        latitude: result.latitude, longitude: result.longitude, confidence: 1,
        source: result.source, managedBy: manager, dealIds: [deal.id],
        evidenceUrl: reviewed[deal.id]?.evidenceUrl || deal.url,
        attribution: 'Datenquelle: Stadt Wien - data.wien.gv.at',
        ...(address.validFrom ? { validFrom: address.validFrom } : {}),
        ...(address.validUntil ? { validUntil: address.validUntil } : {}) }, deal);
      added++;
    }
    const status = added ? (failures.length ? 'partially-mapped' : 'mapped') : assessment.reason || 'geocode-review';
    if (!added && ['no-current-reviewed-branch', 'inactive-registry-branch'].includes(assessment.reason)) {
      const fingerprint = locationFingerprint(deal);
      const previous = (map.geocodingExclusions || []).find(entry => entry.dealId === deal.id && entry.fingerprint === fingerprint);
      exclusions.push({ dealId: deal.id, fingerprint, reason: assessment.reason,
        locationIds: [...new Set([...(previous?.locationIds || []), ...datedLocationIds(deal, map, catalog, assessment.addresses, today)])] });
    }
    report.push({ id: deal.id, brand: deal.brand, title: deal.title, url: deal.url,
      place: [deal.address, deal.location, deal.distance].filter(Boolean).join(' | '),
      status, reason: assessment.reason, channel: assessment.channel, locationCount: locations.filter(location => location.dealIds.includes(deal.id)).length,
      needsReview: status !== 'mapped' && status !== 'online-only', fingerprint: locationFingerprint(deal), failures });
  }
  const active = locations.filter(location => location.dealIds.length).map(location => {
    const { brandMatches, placeMatches, titleMatches, ...entry } = location;
    return entry;
  });
  const catalogEntries = catalogLocations({ locations: active }, { locations: known }).map(location => {
    const { dealIds, automaticDealIds, brandMatches, titleMatches, placeMatches, ...entry } = location;
    return entry;
  });
  const dealBindings = deals.flatMap(deal => {
    const override = reviewed[deal.id];
    const previousIds = override ? [] : datedLocationIds(deal, map, catalog, candidatesFor(deal, reviewed, today).addresses, today);
    const currentIds = active.filter(location => location.dealIds.includes(deal.id)).map(location => location.id);
    const reviewedIds = override ? catalogEntries.filter(location =>
      (override.locations || []).some(address => matchesAddress(location, address) && sameBranchWindow(location, address))).map(location => location.id) : [];
    const ids = [...new Set([...previousIds, ...currentIds, ...reviewedIds])];
    return catalogEntries.some(location => ids.includes(location.id) && (location.validFrom || location.validUntil))
      ? [{ dealId: deal.id, fingerprint: locationFingerprint(deal), locationIds: ids }] : [];
  });
  const changed = JSON.stringify(map.locations) !== JSON.stringify(active)
    || JSON.stringify(map.geocodingExclusions || []) !== JSON.stringify(exclusions);
  return { map: changed ? { ...map, lastUpdated: now.toISOString(), locations: active,
    ...(exclusions.length || map.geocodingExclusions ? { geocodingExclusions: exclusions } : {}) } : map, cache,
    catalog: { schemaVersion: bindingVersion, locations: catalogEntries, ...(dealBindings.length ? { dealBindings } : {}) },
    report: { schemaVersion: bindingVersion, totalDeals: deals.length,
      mappedDeals: new Set(active.flatMap(x => x.dealIds || []).filter(id => liveIds.has(id))).size,
      onlineDeals: report.filter(row => row.status === 'online-only').length,
      unresolvedDeals: report.filter(row => row.needsReview).length,
      locations: active.length, deals: report }, requests };
}

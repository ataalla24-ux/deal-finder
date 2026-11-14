import { readFile, writeFile, rename } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { enrichMap, locationFingerprint, verifiedLocation } from './deal-map-enrichment.mjs';
import { activeBusinessDeals, refreshBusinessSnapshot } from './deal-map-business.mjs';
import { updateDealEnrichment, projectEnrichmentDeal, restoreMapEnrichmentInput } from '../scraper/deal-enrichment-state.js';
import { computeDealsFeedVersion, DEALS_FEED_SCHEMA_VERSION } from './deals-feed-contract.mjs';

const mapPending = deal => deal.approvalPublicationMode === 'two-stage-v1'
  && deal.enrichmentPending === true && deal.enrichmentFields?.includes('map');
const displayExclusion = 'enrichment-map-pending';

// Work on existing live rows only. A ready address, partial mapping or an online
// classification cannot stand in for a current verified point for this deal ID.
export function reconcileMapEnrichment(deals, result, { now = new Date() } = {}) {
  const today = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Vienna' }).format(now);
  const rows = new Map(result.report.deals.map(row => [row.id, row]));
  const projected = deals.map(deal => {
    if (!mapPending(deal)) return projectEnrichmentDeal(deal);
    const next = Date.parse(deal.enrichmentNextReviewAt);
    // This deadline is shared with the description worker. Repeated map :23
    // runs must not move a due description beyond the quality worker at :43.
    const descriptionDeadline = deal.enrichmentFields.includes('description')
      ? (Number.isFinite(next) ? deal.enrichmentNextReviewAt : now.toISOString()) : null;
    const row = rows.get(deal.id);
    const points = result.map.locations.filter(location => location.dealIds?.includes(deal.id));
    const complete = row?.status === 'mapped' && !row.needsReview && points.length > 0
      && row.locationCount === points.length && points.every(location => verifiedLocation(location, today));
    if (complete) {
      const point = points[0];
      // Publish only the verified result, never the original unverified cache.
      const ready = { ...deal, address: point.address, distance: point.address, location: point.name || 'Wien',
        city: 'Wien', postalCode: point.address.match(/\b(1\d{3})\s+(?:Wien|Vienna)\b/i)?.[1] || '',
        latitude: point.latitude, longitude: point.longitude };
      for (const key of ['lat', 'lng', 'lon', 'coordinates']) delete ready[key];
      return projectEnrichmentDeal(updateDealEnrichment(ready, { completedFields: ['map'], now,
        ...(descriptionDeadline ? { nextReviewAt: descriptionDeadline } : {}) }));
    }
    return projectEnrichmentDeal(updateDealEnrichment(deal, { pendingFields: ['map'], now,
      nextReviewAt: descriptionDeadline || (Number.isFinite(next) && next > now.getTime()
        ? deal.enrichmentNextReviewAt : new Date(now.getTime() + 3600000).toISOString()) }));
  });
  const byId = new Map(projected.map(deal => [deal.id, deal]));
  const pendingIds = new Set(projected.filter(mapPending).map(deal => deal.id));
  const locations = result.map.locations.map(location => {
    const { brandMatches, titleMatches, placeMatches, ...exact } = location;
    return { ...exact, dealIds: (location.dealIds || []).filter(id => !pendingIds.has(id)),
      ...(location.automaticDealIds ? { automaticDealIds: location.automaticDealIds.filter(id => !pendingIds.has(id)) } : {}) };
  }).filter(location => location.dealIds.length);
  const geocodingExclusions = (result.map.geocodingExclusions || []).filter(entry =>
    entry.reason !== displayExclusion && !pendingIds.has(entry.dealId));
  for (const deal of projected.filter(mapPending)) geocodingExclusions.push({ dealId: deal.id,
    fingerprint: locationFingerprint(deal), reason: displayExclusion, locationIds: [] });
  const map = { ...result.map, locations,
    ...(geocodingExclusions.length || result.map.geocodingExclusions ? { geocodingExclusions } : {}) };
  const reportDeals = result.report.deals.map(row => {
    const deal = byId.get(row.id);
    if (!deal) return row; // Business rows are not regular feed records.
    const count = locations.filter(location => location.dealIds.includes(row.id)).length;
    return { ...row, fingerprint: locationFingerprint(deal), locationCount: count,
      ...(pendingIds.has(row.id) ? { status: 'needs-review', needsReview: true } : {}) };
  });
  const report = { ...result.report, deals: reportDeals, locations: locations.length,
    mappedDeals: reportDeals.filter(row => row.locationCount > 0).length,
    onlineDeals: reportDeals.filter(row => row.status === 'online-only').length,
    unresolvedDeals: reportDeals.filter(row => row.needsReview).length };
  const bindings = new Map((result.catalog.dealBindings || []).map(binding => [binding.dealId, binding]));
  // Public pending exclusions use the public fingerprint. Preserve an older
  // dated branch constraint separately with its original internal fingerprint.
  // A later retry must not geocode the same expired branch as a new undated one.
  for (const exclusion of result.map.geocodingExclusions || []) {
    if (pendingIds.has(exclusion.dealId) && exclusion.reason !== displayExclusion
      && exclusion.locationIds?.length && !bindings.has(exclusion.dealId)) {
      bindings.set(exclusion.dealId, { dealId: exclusion.dealId, fingerprint: exclusion.fingerprint,
        locationIds: [...exclusion.locationIds] });
    }
  }
  const catalog = { ...result.catalog, ...(bindings.size || result.catalog.dealBindings ? {
    dealBindings: [...bindings.values()].map(binding => {
      const deal = byId.get(binding.dealId);
      return deal && !pendingIds.has(deal.id) ? { ...binding, fingerprint: locationFingerprint(deal) } : binding;
    }),
  } : {}) };
  return { ...result, map, report, catalog, deals: projected };
}

export async function runMapEnrichment({ root = new URL('../', import.meta.url), now = new Date(),
  lookup, fetchPage, refreshBusiness = process.env.MAP_REFRESH_BUSINESS === '1',
  maxSourceRequests = Math.max(0, Math.min(20, Number(process.env.MAP_SOURCE_REQUESTS) || 0)),
  maxGeocodeRequests = Math.max(0, Math.min(40, Number(process.env.MAP_GEOCODE_REQUESTS ?? 8) || 0)) } = {}) {
  const read = async path => JSON.parse(await readFile(new URL(path, root), 'utf8'));
  const optional = async path => { try { return await read(path); } catch (e) { if (e.code === 'ENOENT') return {}; throw e; } };
  async function save(path, data) {
    const file = fileURLToPath(new URL(path, root));
    const content = JSON.stringify(data, null, 2) + '\n';
    try { if (await readFile(file, 'utf8') === content) return; } catch (e) { if (e.code !== 'ENOENT') throw e; }
    await writeFile(`${file}.tmp`, content);
    await rename(`${file}.tmp`, file);
  }
  const feed = await read('docs/deals.json');
  const regularDeals = feed.deals;
  const enrichmentInputs = await optional('reviews/enrichment-inputs.json');
  let business = await optional('reviews/map-business-campaigns.json');
  if (refreshBusiness) {
    const refresh = await refreshBusinessSnapshot({ snapshot: business, now });
    business = refresh.snapshot;
    if (refresh.error) console.warn(`Business map refresh deferred: ${refresh.error}`);
    await save('reviews/map-business-campaigns.json', business);
  }
  const deals = [...regularDeals.map(deal => restoreMapEnrichmentInput(deal, enrichmentInputs)), ...activeBusinessDeals(business, now)];
  const previousMap = await read('docs/deal-map-locations.json');
  // This exclusion protects public clients, not the bounded internal retry.
  // Expired reviewed-branch exclusions remain authoritative.
  const map = { ...previousMap, geocodingExclusions: (previousMap.geocodingExclusions || []).filter(entry => entry.reason !== displayExclusion) };
  const catalog = await optional('reviews/map-location-catalog.json');
  catalog.chainRules = (await optional('reviews/map-chain-rules.json')).rules || [];
  const reviewed = await optional('reviews/map-addresses.json');
  const sourceCache = await optional('reviews/map-source-address-cache.json');
  const { enrichSourceAddresses } = await import('./deal-map-source-addresses.mjs');
  const sources = await enrichSourceAddresses({ deals, map, catalog, reviewed, cache: sourceCache, now,
    maxRequests: Math.max(0, Math.min(20, Number(maxSourceRequests) || 0)), ...(fetchPage ? { fetchPage } : {}) });
  const enriched = await enrichMap({ deals, map, catalog, reviewed: sources.reviewed,
    cache: await optional('reviews/map-geocode-cache.json'), now,
    maxRequests: Math.max(0, Math.min(40, Number(maxGeocodeRequests) || 0)), ...(lookup ? { lookup } : {}) });
  const result = reconcileMapEnrichment(regularDeals, enriched, { now });
  result.report.regularDeals = regularDeals.length;
  result.report.businessDeals = deals.length - regularDeals.length;
  result.report.sourceDiscovery = sources.report;
  if (JSON.stringify(result.deals) !== JSON.stringify(regularDeals)) {
    // Re-stamp only the changed feed; unrelated offer/redemption fields stay exact.
    await save('docs/deals.json', { ...feed, deals: result.deals, schemaVersion: DEALS_FEED_SCHEMA_VERSION,
      feedVersion: computeDealsFeedVersion(result.deals), totalDeals: result.deals.length, lastUpdated: now.toISOString() });
  }
  await save('docs/deal-map-locations.json', result.map);
  await save('reviews/map-geocode-cache.json', result.cache);
  await save('reviews/map-location-catalog.json', result.catalog);
  await save('reviews/map-source-address-cache.json', sources.cache);
  await save('reviews/map-coverage.json', result.report);
  console.log(`Map: ${result.report.mappedDeals}/${result.report.totalDeals} deals, ${result.report.locations} locations, ${result.requests} address lookups. Unresolved addresses remain in the feed.`);
  return result;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await runMapEnrichment();

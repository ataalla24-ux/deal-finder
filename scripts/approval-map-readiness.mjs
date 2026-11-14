import { projectEnrichmentDeal, updateDealEnrichment } from '../scraper/deal-enrichment-state.js';
import { enrichMap, inspectDealLocation, locationFingerprint } from './deal-map-enrichment.mjs';
import { enrichSourceAddresses } from './deal-map-source-addresses.mjs';
import { buildSummary, buildReport } from '../scraper/deal-validity-agent.js';
import { isCommunitySubmission } from '../scraper/community-review-utils.js';

export const isApprovalMapReason = reason => String(reason).startsWith('Kartenstandort fehlt (');

export async function findApprovalAddresses(deals, { existingDeals, map, catalog, reviewed, sourceCache,
  now, fetchPage, maxSourceRequests }) {
  const existingIds = new Set(existingDeals.map(deal => deal.id));
  return enrichSourceAddresses({
    deals: deals.filter(deal => !existingIds.has(deal.id) && !isCommunitySubmission(deal)),
    map, catalog, reviewed, cache: sourceCache, now, fetchPage, maxDurationMs: 15000,
    maxRequests: Math.max(0, Math.min(4, Number(maxSourceRequests) || 0)),
  });
}

// Only newly approved on-site offers are gated; existing live records stay intact.
export async function requireApprovalMap(validation, { existingDeals = [], map = { locations: [] },
  catalog = {}, reviewed = {}, cache = {}, sourceCache = {}, now = new Date(), lookup, fetchPage,
  maxRequests = 8, maxSourceRequests = 0, sourceLookup, twoStage = false } = {}) {
  const existingIds = new Set(existingDeals.map(deal => deal.id));
  const candidates = validation.allowedDeals.filter(deal => !existingIds.has(deal.id));
  if (!candidates.length && !sourceLookup) return { validation, changed: false };
  const sources = sourceLookup ?? await findApprovalAddresses(candidates, {
    existingDeals, map, catalog, reviewed, sourceCache, now, fetchPage, maxSourceRequests,
  });
  const reviews = sources.reviewed;
  const enriched = await enrichMap({ deals: candidates, map, catalog, reviewed: reviews, cache, now, lookup,
    maxRequests: Math.max(0, Math.min(8, Number(maxRequests) || 0)) });
  const today = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Vienna' }).format(now);
  const checks = new Map(candidates.map(deal => [deal.id,
    inspectDealLocation(deal, { map: enriched.map, catalog: {...enriched.catalog,chainRules:catalog.chainRules}, reviewed: reviews, today })]));
  const mapRows = new Map(enriched.report.deals.map(row => [row.id, row]));
  const sourceRows = new Map(sources.report.deals.map(row => [row.id, row]));
  const results = validation.results.map(result => {
    if (!result.decision.allowed) return result;
    const check = checks.get(result.deal.id);
    const row = mapRows.get(result.deal.id);
    if (!check || row.status === 'online-only' || (row.status === 'mapped' && row.locationCount > 0)) return result;
    const source = sourceRows.get(result.deal.id);
    const reason = check.reason || mapRows.get(result.deal.id)?.failures?.[0] || check.status;
    const hint = check.addresses.length
      ? 'Adresse erkannt, Koordinaten oder Filialliste noch nicht vollstaendig bestaetigt.'
      : source?.reason === 'source-url-ineligible'
        ? 'Keine teilnehmende Wiener Filiale belegt. Die vorhandene Quelle reicht dafuer nicht aus.'
        : 'Noch keine eindeutige teilnehmende Wiener Filiale belegt.';
    if (twoStage && result.deal.approvalPublicationMode === 'two-stage-v1'
      && result.deal.pipelineLifecycle?.manualDecision === 'approved'
      && !['source-period-conflict', 'reviewed-offer-identity-mismatch', 'reviewed-offer-location-conflict'].includes(reason)) {
      return { ...result, deal: updateDealEnrichment(result.deal, { pendingFields: ['map'], now }),
        decision: { ...result.decision, warnings: [...(result.decision.warnings || []), 'Standort folgt: Bestätigte Kartenstandorte werden automatisch ergänzt.'] } };
    }
    return { ...result, decision: { ...result.decision, allowed: false,
      reasons: [...(result.decision.reasons || []),
        `Kartenstandort fehlt (${reason}): ${hint}`] } };
  });
  const summary = buildSummary(results, validation.summary?.maxAgeDays ?? 7);
  // A held deal must not leave a public pin. Cached coordinates can be reused
  // when its live reaction and all publication checks pass on a later run.
  const allowedIds = new Set(results.filter(result => result.decision.allowed && !result.deal.enrichmentFields?.includes('map')).map(result => result.deal.id));
  const locations = new Map(map.locations.map(location => [location.id, location]));
  const catalogLocations = new Map((catalog.locations || []).map(location => [location.id, location]));
  const bindings = new Map((catalog.dealBindings || []).map(binding => [binding.dealId, binding]));
  for (const location of enriched.map.locations) {
    const newIds = location.dealIds.filter(id => allowedIds.has(id));
    if (!newIds.length) continue;
    const previous = locations.get(location.id);
    const auto = new Set([...(previous?.automaticDealIds || []), ...(location.automaticDealIds || []).filter(id => allowedIds.has(id))]);
    locations.set(location.id, { ...location, ...previous, dealIds: [...new Set([...(previous?.dealIds || []), ...newIds])],
      ...(auto.size ? { automaticDealIds: [...auto] } : {}) });
    const entry = enriched.catalog.locations.find(row => row.id === location.id);
    if (entry && !catalogLocations.has(entry.id)) catalogLocations.set(entry.id, entry);
  }
  for (const binding of enriched.catalog.dealBindings || []) {
    if (allowedIds.has(binding.dealId)) bindings.set(binding.dealId, binding);
  }
  const nextLocations = [...locations.values()];
  const pendingMap = results.filter(result => result.decision.allowed && result.deal.enrichmentFields?.includes('map')).map(result => projectEnrichmentDeal(result.deal));
  const pendingIds = new Set(pendingMap.map(deal => deal.id));
  const exclusions = [...(map.geocodingExclusions || []).filter(entry => !pendingIds.has(entry.dealId)),
    ...pendingMap.map(deal => ({ dealId: deal.id, fingerprint: locationFingerprint(deal), reason: 'enrichment-map-pending', locationIds: [] }))];
  const projectionChanged = JSON.stringify(exclusions) !== JSON.stringify(map.geocodingExclusions || []) || JSON.stringify(nextLocations) !== JSON.stringify(map.locations);
  const mapForPublication = projectionChanged ? { ...map, lastUpdated: now.toISOString(), locations: nextLocations, ...(exclusions.length ? { geocodingExclusions: exclusions } : {}) } : map;
  const { chainRules: _chainRules, ...persistedCatalog } = catalog;
  const catalogForPublication = projectionChanged ? { ...persistedCatalog, schemaVersion: enriched.catalog.schemaVersion,
    locations: [...catalogLocations.values()], ...(bindings.size ? { dealBindings: [...bindings.values()] } : {}) } : persistedCatalog;
  return { ...enriched, map: mapForPublication, catalog: catalogForPublication, sourceCache: sources.cache,
    sourceRequests: sources.requests, changed: true, projectionChanged, validation: { ...validation, results, summary,
    report: buildReport(results, summary),
    allowedDeals: results.filter(result => result.decision.allowed).map(result => result.deal),
    blockedDeals: results.filter(result => !result.decision.allowed).map(result => result.deal) },
    checks: Object.fromEntries(candidates.filter(deal => !isCommunitySubmission(deal)).map(deal => [deal.id, {
      ...checks.get(deal.id), sourceReason: sourceRows.get(deal.id)?.reason || '',
    }])) };
}

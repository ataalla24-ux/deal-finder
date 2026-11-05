import { enrichMap, inspectDealLocation } from './deal-map-enrichment.mjs';
import { buildSummary, buildReport } from '../scraper/deal-validity-agent.js';

// Only newly approved on-site offers are gated; existing live records stay intact.
export async function requireApprovalMap(validation, { existingDeals = [], map = { locations: [] },
  catalog = {}, reviewed = {}, cache = {}, now = new Date(), lookup, maxRequests = 8 } = {}) {
  const existingIds = new Set(existingDeals.map(deal => deal.id));
  const candidates = validation.allowedDeals.filter(deal => !existingIds.has(deal.id));
  if (!candidates.length) return { validation, changed: false };
  const combined = [...candidates, ...existingDeals];
  const enriched = await enrichMap({ deals: combined, map, catalog, reviewed, cache, now, lookup,
    maxRequests: Math.max(0, Math.min(8, Number(maxRequests) || 0)) });
  const today = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Vienna' }).format(now);
  const checks = new Map(candidates.map(deal => [deal.id,
    inspectDealLocation(deal, { map: enriched.map, catalog: enriched.catalog, reviewed, today })]));
  const results = validation.results.map(result => {
    if (!result.decision.allowed) return result;
    const check = checks.get(result.deal.id);
    if (!check || check.status === 'online-only' || (check.status === 'mapped' && check.locationIds.length)) return result;
    return { ...result, decision: { ...result.decision, allowed: false,
      reasons: [...(result.decision.reasons || []),
        `Kartenstandort fehlt (${check.reason || check.status}): genaue teilnehmende Wiener Filiale unter Bearbeiten angeben; ohne bestaetigte Koordinaten noch nicht live.`] } };
  });
  const summary = buildSummary(results, validation.summary?.maxAgeDays ?? 7);
  return { ...enriched, changed: true, validation: { ...validation, results, summary,
    report: buildReport(results, summary),
    allowedDeals: results.filter(result => result.decision.allowed).map(result => result.deal),
    blockedDeals: results.filter(result => !result.decision.allowed).map(result => result.deal) },
    checks: Object.fromEntries(checks) };
}

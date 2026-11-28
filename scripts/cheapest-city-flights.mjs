import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { isViennaFlight, FLIGHT_ALTERNATIVES_PATH } from '../scraper/vienna-flight-offer.js';
import { applyLiveDealEditsToBundle, loadLiveDealEditStore } from './live-deal-edits-lib.mjs';
import { loadDealModeration, moderationReasonForDeal } from '../scraper/deal-moderation-utils.js';
import { redactPublishedCommunityDraft } from './community-public-boundary.mjs';
import { sanitizePublicDealText } from '../scraper/public-deal-text.js';
import { loadReviewFeedback, writeReviewFeedback } from '../scraper/deal-review-feedback.js';

export { FLIGHT_ALTERNATIVES_PATH };
const viennaClock = new Intl.DateTimeFormat('sv-SE', {
  timeZone: 'Europe/Vienna', year: 'numeric', month: '2-digit', day: '2-digit',
  hour: '2-digit', minute: '2-digit',
});
const fold = value => String(value ?? '').normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase().trim();
const cityAliases = new Map([
  ['roma','rome'], ['rom','rome'], ['koln','cologne'], ['koeln','cologne'],
  ['milano','milan'], ['mailand','milan'], ['venezia','venice'], ['venedig','venice'],
]);
const invalidStatuses = new Set(['blocked', 'expired', 'invalid', 'withdrawn', 'rejected']);
const archiveQuoteMaxAgeMs = 24 * 60 * 60 * 1000;

function exactDay(value) {
  if (!/^20\d{2}-\d{2}-\d{2}$/.test(value ?? '')) return '';
  const date = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(+date) && date.toISOString().slice(0, 10) === value ? value : '';
}

function terms(deal) {
  const { destination, outbound, inbound, price } = deal.flight;
  const departure = exactDay(outbound?.departureDate);
  const returnDay = exactDay(inbound?.departureDate);
  const amount = price?.value;
  const cents = Math.round(amount * 100);
  const airport = String(destination.airportCode || '').trim().toUpperCase();
  if (!departure || !returnDay || returnDay < departure || !/^[A-Z]{3}$/.test(airport) || airport === 'VIE'
    || price?.currencyCode !== 'EUR' || !Number.isSafeInteger(cents) || cents <= 0 || amount !== cents / 100) return null;
  const city = fold(destination.city), country = fold(destination.country);
  return {
    airport, departure, cents,
    cityKey: city && country && city !== airport.toLowerCase() ? `${country}|${cityAliases.get(city) || city}` : '',
    departureTime: /^([01]\d|2[0-3]):[0-5]\d$/.test(outbound.departureTime) ? outbound.departureTime : '',
  };
}

function isActive(deal, flight, now, day, minute) {
  if (invalidStatuses.has(deal.validity?.status) || deal.pipelineLifecycle?.manualDecision === 'rejected' || deal.approvalBlock) return false;
  const lastDay = exactDay(deal.validOn) || exactDay(deal.validUntil);
  const expires = typeof deal.expires === 'string' ? deal.expires : '';
  const legacyDay = exactDay(expires.replace(/^Abflug /, ''));
  const endsAt = /T\d{2}:\d{2}/.test(expires) ? Date.parse(expires) : NaN;
  if (flight.departure < day || lastDay && lastDay < day || legacyDay && legacyDay < day || endsAt <= +now) return false;
  return flight.departure !== day || !flight.departureTime || flight.departureTime > minute;
}

function hasRecentArchiveQuote(deal, now) {
  const checkedAt = deal.flight.price?.checkedAt;
  if (typeof checkedAt !== 'string') return false;
  const timestamp = Date.parse(checkedAt);
  if (!Number.isFinite(timestamp) || new Date(timestamp).toISOString() !== checkedAt) return false;
  const age = +now - timestamp;
  return age >= 0 && age <= archiveQuoteMaxAgeMs;
}

function pickCityWinners(candidates, visibleIds) {
  const winners = new Map();
  // City names catch multiple airports. A shared airport also joins translations
  // of the same city. Merge any connected groups before comparing their fares.
  const groups = new Set(), byKey = new Map();
  for (const row of candidates) {
    const keys = [row.airport, row.cityKey].filter(Boolean);
    const existing = [...new Set(keys.map(key => byKey.get(key)).filter(Boolean))];
    const group = existing[0] || { keys:new Set(), rows:[] };
    for (const other of existing.slice(1)) {
      for (const key of other.keys) group.keys.add(key);
      group.rows.push(...other.rows);
      groups.delete(other);
    }
    for (const key of keys) group.keys.add(key);
    for (const key of group.keys) byKey.set(key, group);
    group.rows.push(row);
    groups.add(group);
  }
  for (const { rows } of groups) {
    rows.sort((a,b) => a.cents - b.cents || Number(visibleIds.has(b.deal.id)) - Number(visibleIds.has(a.deal.id))
      || a.deal.id.localeCompare(b.deal.id, 'en'));
    const winner = rows[0];
    for (const row of rows) winners.set(row.deal.id, winner.deal);
  }
  return winners;
}

export function reconcileCityFlights(live, alternatives, {
  now = new Date(), edits = {}, hiddenIds = new Set(), archivedIds = new Set(), moderation = {},
  visibleIds = new Set(live.map(deal => deal.id)),
} = {}) {
  const [day, minute] = viennaClock.format(now).split(' ');
  const byId = new Map(alternatives.filter(deal => isViennaFlight(deal)
    && !archivedIds.has(deal.id)
    && (deal.pipelineLifecycle?.manualDecision === 'approved' || Number.isFinite(Date.parse(deal.approvedAt))))
    .map(deal => [deal.id, deal]));
  for (const deal of live.filter(isViennaFlight)) byId.set(deal.id, deal);
  const existingEdits = (edits.edits || []).filter(edit => byId.has(edit.dealId));
  const patched = applyLiveDealEditsToBundle([...byId.values()], { edits:existingEdits },
    { checkedAt:now.toISOString(), allowRemovals:true }).bundle;
  const candidates = [], scheduled = [], awaitingQuote = [];
  const inactive = new Set(byId.keys());
  const unsupported = new Map();
  const inputIds = new Set(live.map(deal => deal.id));
  for (const deal of patched) {
    if (hiddenIds.has(deal.id) || moderationReasonForDeal(deal, moderation)) continue;
    const flight = terms(deal);
    if (!flight) {
      if (inputIds.has(deal.id)) unsupported.set(deal.id, deal);
      continue;
    }
    if (!isActive(deal, flight, now, day, minute)) continue;
    if (exactDay(deal.validFrom) > day || exactDay(deal.validOn) > day) {
      scheduled.push(deal);
      continue;
    }
    // A saved fare is not a current quote. Keep stale alternatives available for
    // explicit revalidation without treating them as expired or fetching here.
    // Input membership also includes new approvals absent from visibleIds (HEAD).
    if (!inputIds.has(deal.id) && !hasRecentArchiveQuote(deal, now)) {
      awaitingQuote.push(deal);
      continue;
    }
    inactive.delete(deal.id);
    candidates.push({ deal, ...flight });
  }
  const winners = pickCityWinners(candidates, visibleIds);
  const output = [], emitted = new Set();
  for (const deal of live) {
    const winner = winners.get(deal.id);
    if (winner) {
      if (!emitted.has(winner.id)) output.push(winner);
      emitted.add(winner.id);
    } else if (unsupported.has(deal.id)) output.push(unsupported.get(deal.id));
    else if (!inactive.has(deal.id)) output.push(deal);
  }
  for (const winner of new Set(winners.values())) {
    if (!emitted.has(winner.id)) output.push(winner);
  }
  const alternativesToKeep = candidates.filter(row => winners.get(row.deal.id) !== row.deal).map(row => row.deal);
  const retained = [...scheduled, ...awaitingQuote, ...alternativesToKeep]
    .map(deal => sanitizePublicDealText(redactPublishedCommunityDraft(deal)))
    .sort((a,b) => a.id.localeCompare(b.id, 'en'));
  return { deals: output, alternatives: retained };
}

function read(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); }
  catch (error) { if (error.code === 'ENOENT') return fallback; throw error; }
}

function write(file, value) {
  const temporary = `${file}.tmp-${process.pid}`;
  fs.mkdirSync(path.dirname(file), { recursive:true });
  fs.writeFileSync(temporary, JSON.stringify(value, null, 2) + '\n');
  fs.renameSync(temporary, file);
}

export function reconcileCityFlightFeed({ root = process.cwd(), visibleIds, now = new Date() } = {}) {
  const file = name => path.join(root, name);
  const feedFile = file('docs/deals.json'), stateFile = file(FLIGHT_ALTERNATIVES_PATH);
  const feed = read(feedFile, null);
  if (!Array.isArray(feed?.deals)) return null;
  const state = read(stateFile, { version:1, deals:[] });
  if (state.version !== 1 || !Array.isArray(state.deals)) throw Error('Invalid flight alternatives');
  if (!feed.deals.some(isViennaFlight) && !state.deals.length) return null;
  const archives = [
    ...(read(file('reviews/automatic-deal-maintenance-state.json'), {}).hidden || []),
    ...(read(file('reviews/verified-expiry-archive.json'), {}).entries || []),
  ];
  const result = reconcileCityFlights(feed.deals, state.deals, {
    now, visibleIds,
    edits:loadLiveDealEditStore(file('docs/live-deal-edits.json')),
    moderation:loadDealModeration(file('docs/deal-moderation.json')),
    archivedIds:new Set(archives.map(row => row.id)),
  });
  if (JSON.stringify(feed.deals) !== JSON.stringify(result.deals)) {
    write(feedFile, { ...feed, deals:result.deals, totalDeals:result.deals.length });
  }
  if (JSON.stringify(state.deals) !== JSON.stringify(result.alternatives)) {
    write(stateFile, { ...state, deals:result.alternatives });
  }
  const parked = new Set(result.alternatives.map(deal => deal.id));
  const promoted = new Set(result.deals.filter(isViennaFlight).map(deal => deal.id));
  const feedbackFile = file('docs/deal-review-feedback.json');
  if (fs.existsSync(feedbackFile)) {
    const feedback = loadReviewFeedback(feedbackFile);
    let changed = false;
    for (const event of feedback.events) {
      if (event.decision !== 'approved') continue;
      const status = event.publicationStatus;
      if (parked.has(event.dealId) && status === 'published') event.publicationStatus = 'approved-flight-alternative';
      if (promoted.has(event.dealId) && status === 'approved-flight-alternative') event.publicationStatus = 'published';
      changed ||= status !== event.publicationStatus;
    }
    if (changed) writeReviewFeedback(feedbackFile, feedback);
  }
  return result;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const result = reconcileCityFlightFeed();
  if (result) console.log(JSON.stringify({
    liveFlights:result.deals.filter(isViennaFlight).length, alternatives:result.alternatives.length,
  }));
}

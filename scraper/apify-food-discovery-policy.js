import { createHash } from 'node:crypto';
import { normalizeApifyItem, realPostTimestamp } from './import-apify-instagram-deals.js';
import { discoveryRejection } from './deal-discovery-policy.js';
import { getAdFoodBenefitRejection, isFoodDrinkSource } from './food-discovery-utils.js';
import { canonicalInstagramPostKey } from './deal-evidence-utils.js';
import { evaluateInstagramOfferTiming } from './instagram-ai-validity-utils.js';
import { parseExpiryShape } from './expiry-utils.js';
import { relativeCaptionValidity } from '../apify/instagram-vienna-food-offers/src/validity-utils.js';
import { concreteFoodOfferTitle, socialOfferDisplayText } from './offer-title-utils.js';

export const DAY = 86_400_000;
export const TAGS = ['wienfood', 'viennafood', 'esseninwien', 'wienisst', 'gratiswien', 'wienkaffee', 'neueroeffnungwien', 'wienpizza'];
export const LIMITS = Object.freeze({ profiles: 22, hashtags: 4, perSource: 1, posts: 26, ocrPosts: 8, dailyUsd: 0.15, cycleUsd: 4.65 });
const handle = value => String(value || '').replace(/^@/, '').toLowerCase();
const plain = value => String(value || '').replace(/#[\p{L}\p{N}_]+/gu, ' ').trim();
const vienna = value => /\b(?:wien|vienna|1(?:0[1-9]|1\d|2[0-3])0)\b/i.test(value);

export function discoverySources(watchlist = {}, registry = {}) {
  const registered = new Map((registry.accounts || []).map(a => [handle(a.username), a]));
  const profiles = new Map();
  for (const row of watchlist.accounts || []) {
    const username = handle(row.username);
    const known = registered.get(username);
    if (!/^[a-z0-9_.]{1,30}$/.test(username) || known?.blockedByModeration || row.category === 'drinks') continue;
    if (!isFoodDrinkSource({ ...row, description: row.note })) continue;
    profiles.set(username, {
      key: `profile:${username}`, kind: 'profile', username,
      url: `https://www.instagram.com/${username}/`, priority: Number(row.priority) || 0,
    });
  }
  return [...profiles.values(), ...TAGS.map(tag => ({ key: `hashtag:${tag}`, kind: 'hashtag', url: `https://www.instagram.com/explore/tags/${tag}/`, priority: 0 }))];
}

export function selectDiscoverySources(pool, state, now = new Date()) {
  const available = pool.filter(s => !(Date.parse(state.sources?.[s.key]?.retryAt) > +now));
  const ordered = kind => available.filter(s => s.kind === kind).sort((a, b) =>
    (Date.parse(state.sources?.[a.key]?.lastAttemptAt) || 0) - (Date.parse(state.sources?.[b.key]?.lastAttemptAt) || 0)
    || b.priority - a.priority || a.key.localeCompare(b.key));
  return [...ordered('profile').slice(0, LIMITS.profiles), ...ordered('hashtag').slice(0, LIMITS.hashtags)];
}

export function reservationReason(state, budget, runKey, now = new Date(), purpose = 'scan') {
  if (!['scan', 'hashtag-test'].includes(purpose)) return 'invalid-purpose';
  if (!budget.allowed) return budget.reason;
  if (Date.parse(state.retryAt) > +now) return 'channel-cooldown';
  const reservations = state.reservations || [];
  if (reservations.some(r => r.key === runKey)) return 'workflow-already-reserved';
  if (purpose === 'hashtag-test') {
    if (budget.runCapUsd !== .01) return 'invalid-validation-cap';
    if (state.hashtagValidationReservedAt) return 'hashtag-validation-already-reserved';
  } else if (reservations.some(r => +now - Date.parse(r.at) < 6 * 3_600_000)) return 'minimum-six-hour-spacing';
  const day = now.toISOString().slice(0, 10);
  const sum = rows => rows.reduce((n, r) => n + Number(r.capUsd), 0);
  if (reservations.some(r => !Number.isFinite(r.capUsd) || r.capUsd < 0 || !Number.isFinite(Date.parse(r.at)))) return 'invalid-budget-ledger';
  if (sum(reservations.filter(r => r.at.startsWith(day))) + budget.runCapUsd > LIMITS.dailyUsd + 1e-9) return 'daily-budget-reserved';
  if (sum(reservations.filter(r => Date.parse(r.at) >= Date.parse(budget.cycle.startAt))) + budget.runCapUsd > LIMITS.cycleUsd + 1e-9) return 'cycle-budget-reserved';
  return '';
}

export function postIdentity(raw) {
  return canonicalInstagramPostKey(raw?.url || raw?.postUrl || '');
}

export function postFingerprint(raw) {
  const images = [raw.displayUrl, ...(raw.childPosts || []).map(p => p.displayUrl)]
    .filter(Boolean).map(url => { try { return new URL(url).pathname; } catch { return ''; } }).sort();
  return createHash('sha256').update(JSON.stringify([
    String(raw.caption || '').trim(), images, realPostTimestamp(raw).iso,
    raw.locationName || '', handle(raw.ownerUsername),
  ])).digest('hex');
}

function nonViennaRejection(signal, location) {
  if (!vienna(signal) && /\b(?:in|aus|nach|to)\s+(?:graz|linz|salzburg|innsbruck|berlin|muenchen|münchen|munich)\b/i.test(signal)) {
    return 'non-vienna-offer-text';
  }
  if (/\b(?:graz|linz|salzburg|innsbruck|berlin|muenchen|münchen|munich)\b/i.test(location) && !vienna(location)) {
    return 'non-vienna-location';
  }
  return '';
}

export function earlyPostRejection(raw, now = new Date(), registry = {}) {
  if (!postIdentity(raw)) return 'missing-post-url';
  if (handle(raw.ownerUsername) === 'freefinder.at') return 'own-promotional-repost';
  const date = Date.parse(realPostTimestamp(raw).iso);
  if (!Number.isFinite(date)) return 'missing-real-post-date';
  if (date > +now + 600_000) return 'future-post-date';
  if (date < +now - 7 * DAY) return 'post-older-than-seven-days';
  if ((registry.accounts || []).some(a => handle(a.username) === handle(raw.ownerUsername) && a.blockedByModeration)) return 'moderation-blocked-account';
  return discoveryRejection(String(raw.caption || ''))
    || (/\b(?:gewinnspiel|verlosung|giveaway)\b/i.test(raw.caption || '') ? 'giveaway' : '')
    || nonViennaRejection(plain(raw.caption), plain(raw.locationName));
}

// Calendar dates refer to Vienna, not the runner's UTC midnight (also across DST).
function viennaBoundary(date, end) {
  if (!date) return '';
  const day = new Date(date).toISOString().slice(0, 10);
  const target = Date.parse(`${day}T${end ? '23:59:59.999' : '00:00:00.000'}Z`);
  let utc = target;
  const fmt = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Vienna', timeZoneName: 'longOffset' });
  for (let i = 0; i < 2; i++) {
    const zone = fmt.formatToParts(new Date(utc)).find(p => p.type === 'timeZoneName')?.value || '';
    const match = zone.match(/GMT([+-])(\d{2}):(\d{2})/);
    if (!match) throw new Error('unknown-vienna-offset');
    const minutes = (Number(match[2]) * 60 + Number(match[3])) * (match[1] === '+' ? 1 : -1);
    utc = target - minutes * 60_000;
  }
  return new Date(utc).toISOString();
}

export function classifyDiscoveryPost(raw, { now = new Date(), registry = {}, ocrText = '' } = {}) {
  const reject = earlyPostRejection(raw, now, registry);
  if (reject) return { deal: null, rejectReason: reject };
  const username = handle(raw.ownerUsername);
  const account = (registry.accounts || []).find(a => handle(a.username) === username);
  const signal = [plain(raw.caption), plain(ocrText)].filter(Boolean).join('\n');
  if (/\b(?:kein\w*|nicht|no|not)\s+(?:1\s*[+&]\s*1|2\s*(?:für|fuer|for)\s*1|bogo)\b/i.test(signal)) {
    return { deal: null, rejectReason: 'negated-offer' };
  }
  // Inflected German product names are classification aliases, never rewritten evidence.
  const foodReason = getAdFoodBenefitRejection(signal.replace(/\bBurgers\b/gi, 'Burger').replace(/\bKaffees\b/gi, 'Kaffee'));
  if (foodReason) return { deal: null, rejectReason: foodReason };
  const location = plain(raw.locationName);
  const trusted = account?.accountType === 'merchant' && account.viennaVerified === true;
  const foreign = nonViennaRejection(signal, location);
  if (foreign) return { deal: null, rejectReason: foreign };
  if (!vienna(location) && !vienna(signal) && !trusted) return { deal: null, rejectReason: 'missing-vienna-evidence' };
  const published = realPostTimestamp(raw).iso;
  const timing = evaluateInstagramOfferTiming({ signal, pubDate: published, now, maxAgeDays: 7 });
  const relative = relativeCaptionValidity(signal, now, published);
  const captionDate = parseExpiryShape(plain(raw.caption), { now, referenceDate: new Date(published) });
  const until = viennaBoundary(relative?.validUntil || timing.offerWindow?.endDate || captionDate.validUntil || captionDate.validOn, true);
  const from = viennaBoundary(relative?.validFrom || timing.offerWindow?.startDate || captionDate.validFrom || captionDate.validOn, false);
  if (timing.yesterdayOnly || (until && Date.parse(until) < +now)) return { deal: null, rejectReason: 'expired-offer' };
  const bogo = /\b(?:1\s*[+&]\s*1|2\s*(?:für|fuer|for)\s*1|bogo)\b/i.test(signal);
  const benefitText = signal
    .replace(/\b(?:gluten|sugar|lactose|dairy|alcohol|caffeine|cruelty|plastic|smoke|fat|nut|gmo)[- ]free\b/gi, '')
    .replace(/\b(?:gratis|kostenlos\w*|free)\s+(?:wifi|wlan|parking|lieferung|versand|shipping|delivery)\b/gi, '');
  const free = /\b(?:gratis|kostenlos\w*|geschenkt|free|umsonst)\b/i.test(benefitText);
  const result = normalizeApifyItem({
    url: raw.url || raw.postUrl, postPublishedAt: published,
    caption: signal, description: signal, ownerUsername: username, ownerFullName: raw.ownerFullName,
    locationText: vienna(location) ? location : '', offerKind: bogo ? 'bogo' : free ? 'free' : 'discount',
    validUntil: until, validFrom: from, explicitValidityDetected: Boolean(until),
    ...(trusted ? { viennaEvidence: { type: 'merchant-registry', values: [username] } } : {}),
  }, { now });
  if (!result.deal) return result;
  const title = concreteFoodOfferTitle(signal) || result.deal.title;
  const qualityScore = Math.min(95, (bogo || free ? 80 : 65) + (until ? 5 : 0) + (trusted || vienna(location) ? 5 : 0));
  const expires = until || new Date(Date.parse(published) + 3 * DAY).toISOString();
  if (Date.parse(expires) <= +now) return { deal: null, rejectReason: 'review-window-ended' };
  return { rejectReason: '', deal: {
    ...result.deal, title, expires, validUntil: expires, qualityScore, votes: 0,
    validFrom: from,
    expirySource: until ? 'social-post-content-date' : 'post-age-review-ttl',
    expiryEstimated: !until,
    description: socialOfferDisplayText(plain(raw.caption), ocrText),
    hot: false, reviewRequired: true, reviewTier: 'review',
    originSource: 'Apify 2 Vienna Food Discovery', discoveredBy: 'apify2-profile-hashtag',
    originalCaption: String(raw.caption || '').slice(0, 12_000), ocrText: String(ocrText || '').slice(0, 4000),
    contentHash: postFingerprint(raw),
    evidenceNote: ocrText ? 'Caption and local OCR; human verification required.' : 'Public post; human verification required.',
  } };
}

export function mergeDiscoveryPending(previous, fresh, rejectedKeys = [], now = new Date()) {
  const byPost = new Map();
  const rejected = new Set(rejectedKeys);
  for (const deal of [...previous, ...fresh]) {
    const key = postIdentity(deal);
    if (!key || rejected.has(key) || Date.parse(deal.expires) <= +now || !Number.isFinite(Date.parse(deal.expires))) continue;
    const old = byPost.get(key);
    // Keep first observation; re-fetching never extends an unconfirmed offer's TTL.
    byPost.set(key, { ...deal, discoveredAt: old?.discoveredAt || deal.discoveredAt,
      ...(old?.expiryKind === 'review-ttl' && deal.expiryKind === 'review-ttl'
        ? { expires: old.expires, validUntil: old.validUntil } : {}) });
  }
  const hashes = new Set();
  return [...byPost.values()].sort((a, b) => b.qualityScore - a.qualityScore).filter(d => {
    if (d.contentHash && hashes.has(d.contentHash)) return false;
    if (d.contentHash) hashes.add(d.contentHash);
    return true;
  }).slice(0, 100);
}

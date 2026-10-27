import { selectNativeDailyDeal } from '../../scraper/native-weekly-utils.js';
import { discoveryRejection, foodDiscoveryPriority } from '../../scraper/deal-discovery-policy.js';

export const PUSH_APP_ID = 'com.stefanataalla.freefinderwien';
const formatter = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Europe/Vienna', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', hourCycle: 'h23',
});
export function viennaClock(now = Date.now()) {
  const p = Object.fromEntries(formatter.formatToParts(new Date(now)).map(x => [x.type, x.value]));
  return { day: `${p.year}-${p.month}-${p.day}`, hour: Number(p.hour) };
}

const internal = /manuell\s*(?:prüfen|pruefen)|review required|policy override|llm-vorschlag|slack digest|deal digest|:[a-z_]+:/i;
const isoDay = value => {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return '';
  const date = new Date(`${value}T12:00:00Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value ? value : '';
};

export function pushDealExclusionReason(deal, now = Date.now()) {
  const { day } = viennaClock(now);
  if (deal.hidden || deal.status === 'expired' || ['expired', 'invalid'].includes(deal.validity?.status)) return 'removed_or_expired';
  if (deal.pipelineLifecycle?.manualDecision !== 'approved') return 'not_approved';
  if (deal.dateConfidence !== 'high') return 'unverified_dates';
  if (!/^[\w-]{1,160}$/.test(deal.id || '') || !deal.title?.trim() || deal.title.length > 110 ||
      internal.test([deal.title, deal.brand, deal.description, deal.distance].join(' '))) return 'unsafe_copy';
  const rejection = discoveryRejection(deal);
  if (rejection) return rejection;
  if (!foodDiscoveryPriority(deal)) return 'not_food_or_drink';
  const start = isoDay(deal.validFrom || deal.validOn);
  const end = isoDay(deal.validUntil || deal.validOn || deal.expires);
  if ((deal.validFrom || deal.validOn) && !start) return 'unverified_dates';
  if (!end || !['range', 'end', 'date', 'fixed', 'single', 'single_date'].includes(deal.expiryKind)) return 'unverified_dates';
  if (end < day) return 'expired';
  if (start && (start > day || start > end)) return 'not_started';
  const timing = [deal.expiryDisplayText, deal.description, deal.title].join(' ');
  if (/\b\d{1,2}[:.]\d{2}\s*(?:uhr|[-–]|bis)|\b(?:montag|dienstag|mittwoch|donnerstag|freitag|samstag|sonntag|happy hour)\b/i.test(timing)) return 'restricted_hours';
  return '';
}

export function eligiblePushDeals(feed, state, now = Date.now()) {
  const updated = Date.parse(feed?.lastUpdated);
  if (!Number.isFinite(updated) || now - updated > 36 * 3600000 || updated > now + 300000 ||
      state?.ok !== true || !Array.isArray(state.overrides) || !Array.isArray(feed?.deals)) return [];
  const overrides = new Map(state.overrides.map(x => [x.dealId, x]));
  return feed.deals.flatMap(original => {
    const override = overrides.get(original.id);
    const deal = { ...original, ...Object.fromEntries(Object.entries(override || {}).filter(([, v]) => v !== '')) };
    return pushDealExclusionReason(deal, now) ? [] : [deal];
  });
}

export function pickDailyPush(feed, state, recentIds, now = Date.now(), featured = state?.dailyDeal) {
  const candidates = eligiblePushDeals(feed, state, now).filter(d => !recentIds.includes(d.id));
  // Match the app's published daily selection. Never rename another deal as the daily deal.
  return featured?.date === viennaClock(now).day
    ? candidates.find(d => d.id === featured.dealId) || null : null;
}

export function dailyPushDecision(feed, state, recentIds, now = Date.now(), featured = state?.dailyDeal) {
  const selected = pickDailyPush(feed, state, recentIds, now, featured);
  if (selected) return { eligible: true, reason: 'ready' };
  if (featured?.date !== viennaClock(now).day) return { eligible: false, reason: 'missing_current_selection' };
  if (eligiblePushDeals(feed, state, now).some(d => d.id === featured.dealId) && recentIds.includes(featured.dealId)) {
    return { eligible: false, reason: 'repeat_suppressed' };
  }
  return { eligible: false, reason: 'no_current_deal' };
}

export function pickMarketingPush(feed, state, recentIds, now = Date.now()) {
  return selectNativeDailyDeal(eligiblePushDeals(feed, state, now).filter(d => !recentIds.includes(d.id)), new Date(now));
}

export function marketingDay(now = Date.now()) {
  const weekday = new Date(`${viennaClock(now).day}T12:00:00Z`).getUTCDay();
  return [1, 3, 5].includes(weekday);
}

export const digestTypes = ['discovery_digest', 'weekly_digest'];
export function digestType(now = Date.now()) {
  const clock = viennaClock(now);
  const weekday = new Date(`${clock.day}T12:00:00Z`).getUTCDay();
  return clock.hour === 18 ? ({ 3: 'discovery_digest', 0: 'weekly_digest' }[weekday] || null) : null;
}

export function pushSlot(now = Date.now()) {
  return viennaClock(now).hour === 9 ? 'daily' : digestType(now) ? 'digest' : null;
}

export function pickDigestDeals(feed, state, recentIds, now = Date.now(), type = digestType(now)) {
  if (!digestTypes.includes(type)) return [];
  const published = d => Date.parse(d.pipelineLifecycle?.publishedAt || d.approvedAt || '');
  // New-deal tips remain seven-day-only; the recap may include older, still-valid offers.
  const candidates = eligiblePushDeals(feed, state, now).filter(d => {
    const at = published(d);
    const horizon = type === 'weekly_digest' ? 30 : 7;
    return !recentIds.includes(d.id) && Number.isFinite(at) && at <= now && at > now - horizon * 86400000;
  });
  const score = d => Number.isFinite(Number(d.votes)) ? Math.max(0, Number(d.votes)) : 0;
  candidates.sort((a, b) => (type === 'weekly_digest' ? score(b) - score(a) : 0) ||
    published(b) - published(a) || a.id.localeCompare(b.id));
  return candidates.slice(0, 3);
}

export function campaignMessage(campaign, language = 'de') {
  if (!digestTypes.includes(campaign.type)) return dailyMessage(campaign.deal, language, campaign.type);
  const english = language === 'en';
  const recap = campaign.type === 'weekly_digest';
  const title = recap ? (english ? 'Your Vienna weekly highlights' : 'Deine Wiener Wochen-Highlights')
    : (english ? 'Discover new deals in Vienna' : 'Entdecke neue Angebote in Wien');
  const offers = (campaign.deals || [campaign.deal]).map(d => {
    const brand = String(d.brand || '').trim();
    return `${String(d.title).trim()}${brand && brand.length <= 60 && !d.title.toLowerCase().includes(brand.toLowerCase()) ? ` (${brand})` : ''}`;
  });
  // Keep each offer intact: never truncate away a price qualifier or a condition.
  const prefix = recap ? (english ? 'Still available: ' : 'Noch nutzbar: ') : '';
  let body = prefix + offers[0];
  for (const offer of offers.slice(1)) {
    if (Array.from(`${body} · ${offer}`).length > 220) break;
    body += ` · ${offer}`;
  }
  return { title, body };
}

export function pushAudience(device, env, now = Date.now()) {
  if (viennaClock(now).hour === 18) {
    return device.policyVersion === 3 && device.enabled && device.marketingEnabled === true &&
      ['free', 'pro', 'plus'].includes(device.plan) &&
      (device.plan === 'free' ? [1, 2].includes(device.consentVersion) : device.consentVersion === 2) &&
      env.MARKETING_PUSH_ENABLED === '1' && env.DIGEST_PUSH_ENABLED === '1' ? digestType(now) : null;
  }
  if (viennaClock(now).hour !== 9) return null;
  if (['pro', 'plus'].includes(device.plan)) {
    return device.dailyEnabled !== false && device.enabled && env.DAILY_PUSH_ENABLED === '1' ? 'daily_deal' : null;
  }
  return device.policyVersion !== 3 && device.plan === 'free' && device.enabled && device.marketingEnabled === true &&
    device.consentVersion === 1 && env.MARKETING_PUSH_ENABLED === '1' && marketingDay(now) ? 'marketing_deal' : null;
}

export function dailyMessage(deal, language = 'de', type = 'daily_deal') {
  const title = type === 'marketing_deal'
    ? (language === 'en' ? 'FreeFinder deal tip' : 'FreeFinder Deal-Tipp')
    : (language === 'en' ? 'FreeFinder deal of the day' : 'FreeFinder Deal des Tages');
  const text = String(deal.title).trim();
  const brand = String(deal.brand || '').trim();
  const body = `${language === 'en' ? 'Today' : 'Heute'}: ${text}${brand && !text.toLowerCase().includes(brand.toLowerCase()) ? ` · ${brand}` : ''}`;
  return { title, body: Array.from(body).slice(0, 220).join('') };
}

export function normalizePushRegistration(body, provider, now = Date.now()) {
  const app = provider === 'apns' ? body.bundleId : body.packageName;
  const token = String(body.token || '').trim();
  const installation = String(body.appDeviceId || '').trim();
  if (app !== PUSH_APP_ID || !/^[a-zA-Z0-9_-]{16,128}$/.test(installation) ||
      !(provider === 'apns' ? /^[a-f0-9]{64}$/i : /^[a-zA-Z0-9_:\-]{32,4096}$/).test(token)) throw new Error('Invalid device registration');
  const revision = Number(body.revision);
  if (!Number.isFinite(revision) || Math.abs(revision - now) > 10 * 60000) throw new Error('Invalid registration timestamp');
  const environments = provider === 'apns' ? ['sandbox', 'production'] : ['development', 'production'];
  const compatible = [1, 2, 3].includes(body.policyVersion) && environments.includes(body.pushEnvironment);
  const dailyEnabled = compatible && body.notificationsEnabled === true && ['pro', 'plus'].includes(body.subscriptionPlan);
  // Missing fields, legacy registrations and OS permission alone never count as marketing consent.
  const marketingEnabled = [2, 3].includes(body.policyVersion) && compatible && body.marketingEnabled === true &&
    (body.policyVersion === 3 ? [1, 2].includes(body.marketingConsentVersion) : body.marketingConsentVersion === 1) && Number.isFinite(body.marketingConsentAt) &&
    body.marketingConsentAt > 0 && body.marketingConsentAt <= now + 300000;
  const enabled = dailyEnabled || (marketingEnabled && (body.subscriptionPlan === 'free' ||
    (body.policyVersion === 3 && body.marketingConsentVersion === 2 && ['pro', 'plus'].includes(body.subscriptionPlan))));
  return { provider, installation, token: provider === 'apns' ? token.toLowerCase() : token,
    plan: body.subscriptionPlan, enabled, dailyEnabled, marketingEnabled,
    policyVersion: body.policyVersion,
    consentVersion: marketingEnabled ? body.marketingConsentVersion : 0, consentAt: marketingEnabled ? body.marketingConsentAt : null,
    revision, language: body.language === 'en' ? 'en' : 'de',
    environment: body.pushEnvironment, updated: now };
}

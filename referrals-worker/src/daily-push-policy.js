import { selectNativeDailyDeal } from '../../scraper/native-weekly-utils.js';

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

export function eligiblePushDeals(feed, state, now = Date.now()) {
  const { day } = viennaClock(now);
  const updated = Date.parse(feed?.lastUpdated);
  if (!Number.isFinite(updated) || now - updated > 36 * 3600000 || updated > now + 300000 ||
      state?.ok !== true || !Array.isArray(state.overrides) || !Array.isArray(feed?.deals)) return [];
  const overrides = new Map(state.overrides.map(x => [x.dealId, x]));
  return feed.deals.flatMap(original => {
    const override = overrides.get(original.id);
    const deal = { ...original, ...Object.fromEntries(Object.entries(override || {}).filter(([, v]) => v !== '')) };
    if (deal.hidden || deal.status === 'expired' || ['expired', 'invalid'].includes(deal.validity?.status)) return [];
    if (deal.pipelineLifecycle?.manualDecision !== 'approved' || deal.dateConfidence !== 'high') return [];
    if (!/^[\w-]{1,160}$/.test(deal.id || '') || !deal.title?.trim() || deal.title.length > 110 ||
        internal.test([deal.title, deal.brand, deal.description, deal.distance].join(' '))) return [];
    const start = isoDay(deal.validFrom || deal.validOn);
    const end = isoDay(deal.validUntil || deal.validOn || deal.expires);
    // Only explicit, source-grounded calendar dates. Unknown/recurring/time-limited offers need review.
    if ((deal.validFrom || deal.validOn) && !start) return [];
    if (!end || end < day || (start && (start > day || start > end)) || !['range', 'date', 'fixed', 'single', 'single_date'].includes(deal.expiryKind)) return [];
    const timing = [deal.expiryDisplayText, deal.description, deal.title].join(' ');
    if (/\b\d{1,2}[:.]\d{2}\s*(?:uhr|[-–]|bis)|\b(?:montag|dienstag|mittwoch|donnerstag|freitag|samstag|sonntag|happy hour)\b/i.test(timing)) return [];
    return [deal];
  });
}

export function pickDailyPush(feed, state, recentIds, now = Date.now()) {
  const candidates = eligiblePushDeals(feed, state, now).filter(d => !recentIds.includes(d.id));
  const selected = state?.dailyDeal?.date === viennaClock(now).day
    ? candidates.find(d => d.id === state.dailyDeal.dealId) : null;
  return selected || selectNativeDailyDeal(candidates, new Date(now));
}

export function dailyMessage(deal, language = 'de') {
  const title = language === 'en' ? 'FreeFinder top deal' : 'FreeFinder Top-Deal';
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
  const enabled = body.policyVersion === 1 && body.notificationsEnabled === true &&
    ['pro', 'plus'].includes(body.subscriptionPlan) &&
    environments.includes(body.pushEnvironment);
  return { provider, installation, token: provider === 'apns' ? token.toLowerCase() : token,
    plan: body.subscriptionPlan, enabled, revision, language: body.language === 'en' ? 'en' : 'de',
    environment: body.pushEnvironment, updated: now };
}

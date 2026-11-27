export const FULL_APP_ID = '6758958213';
export const CLIP_BUNDLE_ID = 'com.stefanataalla.freefinderwien.Clip';
export const APP_ASSOCIATION = {
  applinks: { apps: [], details: [{ appID: '78C2SA4JP3.com.stefanataalla.freefinderwien', paths: ['*'] }] },
  appclips: { apps: ['78C2SA4JP3.' + CLIP_BUNDLE_ID] },
};

// Absent bindings preserve every existing redirect. These release markers are
// set only after the containing full app and Clip have passed review and shipped.
export function releasedAppClip(env = {}, now = Date.now()) {
  const version = env.APP_CLIP_APPROVED_VERSION;
  const verifiedAt = env.APP_CLIP_RELEASE_VERIFIED_AT;
  return env.APP_CLIP_RELEASE_ENABLED === '1'
    && typeof version === 'string' && /^\d+\.\d+(?:\.\d+)?$/.test(version)
    && typeof verifiedAt === 'string' && /^20\d{2}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/.test(verifiedAt)
    && Number.isFinite(Date.parse(verifiedAt)) && Date.parse(verifiedAt) <= now;
}

export function supportsAppClipLanding(request, env = {}) {
  const agent = request.headers.get('user-agent') || '';
  const version = agent.match(/\bOS (\d+)[_\d]*\b/);
  return releasedAppClip(env) && /iPhone|iPad|iPod/i.test(agent) && !/Android/i.test(agent)
    && (!version || Number(version[1]) >= 14);
}

const escapeHTML = value => String(value || '').replace(/[&<>"']/g,
  char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
const bounded = (value, limit) => typeof value === 'string' ? value.replace(/\s+/g, ' ').trim().slice(0, limit) : '';

function calendarEnd(value) {
  if (typeof value !== 'string' || !/^20\d{2}-\d{2}-\d{2}$/.test(value)) return null;
  const day = Date.parse(value + 'T12:00:00Z');
  if (!Number.isFinite(day) || new Date(day).toISOString().slice(0, 10) !== value) return null;
  const next = new Date(day + 86400000).toISOString().slice(0, 10);
  const wall = Date.parse(next + 'T00:00:00Z');
  const format = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Vienna',
    year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
  const local = stamp => {
    const p = Object.fromEntries(format.formatToParts(new Date(stamp)).map(part => [part.type, part.value]));
    return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}:00Z`;
  };
  for (const delta of [-86400000, 0, 86400000]) {
    const sample = wall + delta;
    const candidate = wall - (Date.parse(local(sample)) - sample);
    if (local(candidate) === next + 'T00:00:00Z') return candidate;
  }
  return null;
}

// Calendar days are inclusive in Vienna; a meaningful stored clock remains a
// clock even when an older collector also marked expiresPrecision as "day".
export function previewOfferPeriod(deal = {}) {
  const dayEnds = [deal.validUntil, deal.validOn].map(calendarEnd).filter(Number.isFinite);
  const raw = deal.expires;
  const dateOnly = calendarEnd(raw);
  const timestamp = typeof raw === 'string' && /^20\d{2}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(raw)
    ? Date.parse(raw) : null;
  const daySentinel = deal.expiresPrecision === 'day' && typeof raw === 'string'
    && /T(?:00:00:00(?:\.000)?|23:59:59(?:\.999)?)Z$/.test(raw);
  const expiresEnd = daySentinel ? calendarEnd(raw.slice(0, 10)) : Number.isFinite(timestamp) ? timestamp : dateOnly;
  const ends = [...dayEnds, expiresEnd].filter(Number.isFinite);
  const expiresAt = ends.length ? Math.min(...ends) : null;
  const clock = Number.isFinite(timestamp) && !daySentinel ? timestamp : null;
  const formatDay = day => {
    if (!Number.isFinite(calendarEnd(day))) return '';
    return new Intl.DateTimeFormat('de-AT', { timeZone: 'UTC', day: 'numeric', month: 'long', year: 'numeric' })
      .format(new Date(day + 'T12:00:00Z'));
  };
  const explicit = bounded(deal.expiryDisplayText || deal.validityText, 1000);
  const parts = [];
  if (explicit && !/^20\d{2}-\d{2}-\d{2}(?:T|$)/.test(explicit)) parts.push(explicit);
  else if (formatDay(deal.validOn)) parts.push('Am ' + formatDay(deal.validOn));
  else {
    if (formatDay(deal.validFrom)) parts.push('Ab ' + formatDay(deal.validFrom));
    if (formatDay(deal.validUntil)) parts.push('Bis ' + formatDay(deal.validUntil));
    else if (Number.isFinite(dateOnly)) parts.push('Bis ' + formatDay(raw));
    else if (daySentinel) parts.push('Bis ' + formatDay(raw.slice(0, 10)));
  }
  if (Number.isFinite(clock)) parts.push('Bis ' + new Intl.DateTimeFormat('de-AT', {
    timeZone: 'Europe/Vienna', day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit' }).format(new Date(clock)) + ' Uhr');
  if (!ends.length) parts.push('Kein bestätigtes Enddatum · Bedingungen beachten');
  return { expiresAt, text: parts.join(' · ') };
}

function publicSourceURL(value) {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && !url.username && !url.password && (!url.port || url.port === '443')
      && url.hostname.includes('.') && !/^(?:[\d.]+|localhost)$/.test(url.hostname)
      && !/\.(?:local|localhost|internal)$/.test(url.hostname) ? url.href : '';
  } catch { return ''; }
}

export function appClipLanding(request, destination, respond, deal = null, now = Date.now()) {
  const invocation = new URL(request.url);
  const target = new URL(destination);
  if (invocation.origin !== 'https://www.freefinder.at' || target.origin !== 'https://freefinder.at') {
    return respond(request, 'Dieser Link ist ungueltig.', 404);
  }
  const period = previewOfferPeriod(deal || {});
  if (deal && Number.isFinite(period.expiresAt) && period.expiresAt <= now) {
    return respond(request, 'Dieses Angebot ist nicht mehr verfuegbar.', 410, { 'X-Robots-Tag': 'noindex' });
  }
  if (typeof deal?.description === 'string' && deal.description.length > 80000) {
    return respond(request, 'Der Deal ist gerade nicht erreichbar. Bitte erneut versuchen.', 503);
  }
  const hasInvitation = target.searchParams.has('invite');
  const title = bounded(deal?.title, 180) || 'Gemeinsam Wien entdecken';
  const description = bounded(deal?.description, 80000);
  const brand = bounded(deal?.brand, 120);
  const place = deal?.enrichmentFields?.includes('map') ? 'Wien · Standort folgt'
    : [deal?.address, deal?.location, deal?.city, deal?.distance].map(value => bounded(value, 700)).find(Boolean);
  const source = publicSourceURL(deal?.url);
  const params = new URLSearchParams();
  if (hasInvitation) params.set('invite', target.searchParams.get('invite'));
  if (target.searchParams.has('deal')) params.set('deal', target.searchParams.get('deal'));
  const appURL = `freefinder://${hasInvitation ? 'invite' : 'deal'}?${params}`;
  const banner = `app-id=${FULL_APP_ID}, app-clip-bundle-id=${CLIP_BUNDLE_ID}, app-clip-display=card, app-argument=${target.href}`;
  const image = 'https://freefinder.at/assets/campaigns/app-food-preview-20261102.jpg';
  const html = `<!doctype html>
<html lang="de-AT"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex,follow"><meta name="referrer" content="no-referrer">
<meta name="apple-itunes-app" content="${escapeHTML(banner)}">
<title>${escapeHTML(title)} | FreeFinder</title>
<meta name="description" content="${escapeHTML(description.slice(0, 200) || 'Deine Einladung zu FreeFinder und aktuellen Wiener Angeboten.')}">
<meta property="og:type" content="website"><meta property="og:site_name" content="FreeFinder">
<meta property="og:title" content="${escapeHTML(title)}"><meta property="og:image" content="${image}">
<meta property="og:url" content="${escapeHTML(invocation.href)}"><meta name="twitter:card" content="summary_large_image">
<link rel="canonical" href="${escapeHTML(invocation.href)}"><link rel="icon" href="https://freefinder.at/favicon.ico">
<style>*{box-sizing:border-box}body{margin:0;background:#fff;color:#171a18;font:16px/1.6 system-ui,sans-serif}main{max-width:620px;margin:auto;padding:32px 24px}h1{font-size:32px;line-height:1.2}p{white-space:pre-wrap;color:#4c5650}.eyebrow{font-weight:700;color:#b5360b}a{color:#b5360b}.action{display:block;min-height:52px;padding:14px 18px;margin:16px 0;background:#e84913;border-radius:8px;color:#fff;text-align:center;text-decoration:none;font-weight:700}.secondary{background:#eef1ef;color:#18201b}small{display:block;line-height:1.6}a:focus-visible{outline:3px solid #171a18;outline-offset:4px}</style></head>
<body><main><div class="eyebrow">FreeFinder${brand ? ' · ' + escapeHTML(brand) : ''}</div><h1>${escapeHTML(title)}</h1>
${deal ? `<p><strong>${escapeHTML(period.text)}</strong>${place ? '<br>' + escapeHTML(place) : ''}</p>` : ''}
${description ? `<p>${escapeHTML(description)}</p>` : '<p>Entdecke Angebote in Wien mit FreeFinder.</p>'}
${source ? `<p><a href="${escapeHTML(source)}" rel="noopener noreferrer">Originalangebot ansehen</a></p>` : ''}
<p>Über „Öffnen“ im App-Clip-Banner kannst du die Vorschau ohne vollständige App-Installation ansehen.</p>
<a class="action" href="${escapeHTML(appURL)}">In FreeFinder öffnen</a>
<a class="action secondary" href="https://apps.apple.com/app/id6758958213">Vollständige App herunterladen</a>
<a href="${escapeHTML(target.href)}">Bisherige Webseite öffnen</a>
${hasInvitation ? '<p>Die Vorschau allein startet kein Probeabo und erstellt keine Belohnung. Für den Probemonat gelten Anmeldung, Einladungsannahme und die Bestätigung durch den Store.</p>' : '<p>Die Bedingungen des Anbieters entscheiden über die Einlösung.</p>'}
<small>Wenn du den App Clip vor der Installation geöffnet hast, kann die vollständige App gespeicherten Einladungskontext übernehmen. Die reine Installation über einen Weblink speichert keine Einladung.</small>
<p><a href="https://freefinder.at/privacy.html">Datenschutz</a> · <a href="https://freefinder.at/support.html">Kontakt</a></p></main></body></html>`;
  return respond(request, html, 200, { 'Content-Type': 'text/html; charset=utf-8', 'X-Robots-Tag': 'noindex' });
}

const text = value => String(value ?? '').trim();
const escape = value => text(value).replace(/&/g, '&amp;').replace(/</g, '&lt;')
  .replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
const pad = value => String(value).padStart(2, '0');

export const periodFields = ['expires', 'expiresOriginal', 'expiryDisplayText', 'expiryKind',
  'validOn', 'validFrom', 'validUntil', 'dateConfidence'];

function calendarDay(value) {
  if (!/^20\d{2}-\d{2}-\d{2}$/.test(value)) throw new Error('Bitte ein vollständiges Datum mit Jahr eingeben.');
  const [year, month, day] = value.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) {
    throw new Error('Dieses Datum gibt es nicht. Bitte Tag und Monat prüfen.');
  }
  return value;
}

function clock(value) {
  if (!/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(value)) throw new Error('Bitte gültige Start- und Endzeiten eingeben.');
  return value;
}

function displayDay(value) {
  return value.split('-').reverse().join('.');
}

function period(start, end, startTime = '', endTime = '', ranged = start !== end) {
  calendarDay(start); calendarDay(end);
  if (startTime || endTime) { clock(startTime); clock(endTime); }
  if (`${start}T${startTime || '00:00'}` > `${end}T${endTime || '00:00'}`) {
    throw new Error('Das Ende darf nicht vor dem Beginn liegen.');
  }
  const first = `${displayDay(start)}${startTime ? `, ${startTime}` : ''}`;
  const last = `${displayDay(end)}${endTime ? `, ${endTime}` : ''}`;
  const literal = `${first === last ? first : `${first} bis ${last}`}${startTime ? ' Uhr' : ''}`;
  const isRange = ranged || first !== last;
  return { start, end, startTime, endTime, literal, fields: {
    expires: end, validFrom: start, validUntil: end,
    validOn: !isRange ? start : '', expiryKind: isRange ? 'range' : 'single', dateConfidence: 'high',
  } };
}

// Same explicit calendar/time format as the native OfferPeriodText picker.
// Free-form conditions remain literal; never derive a year from today's date.
export function parseOfferPeriod(value) {
  const raw = text(value);
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return period(raw, raw);
  const match = raw.match(/^(\d{1,2})\.(\d{1,2})\.(20\d{2})(?:,\s*(\d{2}:\d{2}))?(?:\s+bis\s+(\d{1,2})\.(\d{1,2})\.(20\d{2})(?:,\s*(\d{2}:\d{2}))?)?(?:\s+Uhr)?$/u);
  if (!match) return null;
  const [, day, month, year, startTime, endDay, endMonth, endYear, endTime] = match;
  const start = `${year}-${pad(month)}-${pad(day)}`;
  const end = endDay ? `${endYear}-${pad(endMonth)}-${pad(endDay)}` : start;
  if (endDay && Boolean(startTime) !== Boolean(endTime)) throw new Error('Bitte beide Uhrzeiten angeben oder die Uhrzeit weglassen.');
  return period(start, end, startTime || '', endDay ? endTime || '' : startTime || '', Boolean(endDay));
}

export function pendingEditorValues(deal) {
  let raw = text(deal.validityText ?? (deal.expiryDisplayText || deal.expiresOriginal || ''));
  if (!raw) {
    const start = text(deal.validFrom).slice(0, 10);
    const end = text(deal.validOn || deal.validUntil || deal.expires).slice(0, 10);
    try { raw = period(start || end, end).literal; } catch { raw = text(deal.expires); }
  }
  let parsed;
  try {
    parsed = /^20\d{2}-\d{2}-\d{2}$/.test(raw) && deal.validFrom && deal.validFrom !== raw
      ? period(text(deal.validFrom).slice(0, 10), raw) : parseOfferPeriod(raw);
    if (parsed) raw = parsed.literal;
  } catch {}
  return { ...deal, validityText: raw, validityMode: parsed ? 'picker' : 'text',
    periodStart: parsed?.start || '', periodEnd: parsed?.end || '',
    includeTime: Boolean(parsed?.startTime), periodStartTime: parsed?.startTime || '', periodEndTime: parsed?.endTime || '' };
}

export function normalizePendingEdit(input) {
  const result = {};
  const limits = { title: 250, brand: 200, description: 12000, distance: 1000, url: 2000 };
  for (const [key, max] of Object.entries(limits)) {
    if (typeof input[key] !== 'string') throw new Error(`Fehlendes Feld: ${key}`);
    result[key] = text(input[key]);
    if (result[key].length > max) throw new Error('Text zu lang. Bitte die Eingabe kürzen.');
  }
  if (!result.title || !result.brand || !result.distance) throw new Error('Bitte Anbieter, Deal-Titel und Adresse ausfüllen.');
  if (result.url) {
    let url;
    try { url = new URL(result.url); } catch {}
    if (!url || !['http:', 'https:'].includes(url.protocol) || !url.hostname || url.username || url.password || /\s/.test(result.url)) {
      throw new Error('Den Link leer lassen oder eine gültige http(s)-Webadresse eingeben.');
    }
  }
  if (!Object.hasOwn(input, 'validityText') && input.validityMode === undefined) {
    // Existing workflow payloads only supplied a single expiry date.
    if (typeof input.expires !== 'string') throw new Error('Fehlendes Feld: expires');
    result.expires = text(input.expires);
    if (result.expires) calendarDay(result.expires);
    return result;
  }
  let raw = text(input.validityText);
  let parsed;
  if (input.validityMode === 'picker') {
    const start = text(input.periodStart), end = text(input.periodEnd);
    const timed = ['1', 'true', 'on', true].includes(input.includeTime);
    if (start || end || timed) {
      if (timed) { clock(text(input.periodStartTime)); clock(text(input.periodEndTime)); }
      parsed = period(start, end, timed ? text(input.periodStartTime) : '', timed ? text(input.periodEndTime) : '');
      raw = parsed.literal;
    } else raw = '';
  } else {
    if (input.validityMode && input.validityMode !== 'text') throw new Error('Bitte eine gültige Zeitraum-Auswahl verwenden.');
    parsed = parseOfferPeriod(raw);
  }
  if (raw.length > 500) throw new Error('Der Zeitraum darf höchstens 500 Zeichen enthalten.');
  return { ...result, ...(parsed?.fields || { expires: '' }),
    validityText: raw, expiresOriginal: raw, expiryDisplayText: raw };
}

export function renderPendingEditor({ deal, payload, sig, error = '', values }, status = 200) {
  const current = values || pendingEditorValues(deal);
  const value = key => escape(current[key]);
  const picker = current.validityMode === 'picker';
  const timed = ['1', 'true', 'on', true].includes(current.includeTime);
  return new Response(`<!doctype html>
<html lang="de"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="light dark"><title>Deal-Entwurf bearbeiten · FreeFinder</title>
<style>
:root{color-scheme:light dark;--bg:#fff;--text:#171b1e;--muted:#59636a;--line:#bbc3c9;--accent:#c83b00;--surface:#f4f6f7;--error:#aa1924}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--text);font:16px/1.5 system-ui,sans-serif;letter-spacing:0}
main{max-width:680px;margin:0 auto;padding:28px 20px 40px}.brand{font-size:22px;font-weight:800}.brand span{color:#ff570d}
h1{font-size:26px;line-height:1.2;margin:16px 0 8px}p{margin:0 0 20px;color:var(--muted)}
form{display:grid;gap:20px}label{display:block;font-weight:600}input,textarea{display:block;width:100%;font:inherit;color:var(--text);background:var(--bg);border:1px solid var(--line);border-radius:6px;padding:11px 12px;margin-top:6px;min-width:0}
textarea{resize:vertical}input:focus-visible,textarea:focus-visible,button:focus-visible{outline:3px solid var(--accent);outline-offset:3px}
fieldset{margin:0;padding:0;border:0;min-width:0}legend{padding:0;font-weight:600}.modes{display:flex;flex-wrap:wrap;gap:12px 20px;margin:10px 0}
.choice{display:flex;gap:8px;align-items:center;font-weight:400;min-height:44px}.choice input{appearance:auto;accent-color:var(--accent);width:20px;height:20px;margin:0;flex:none}
.period label{font-weight:400}.dates,.times{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);gap:14px}.zone{font-size:14px;margin:8px 0 0}
.period:has(input[value="text"]:checked) .picker-period,.period:has(input[value="picker"]:checked) .text-period{display:none}
.period:not(:has(input[name="includeTime"]:checked)) .times{display:none}
button{width:100%;min-height:48px;border:0;border-radius:6px;padding:13px 18px;background:var(--accent);color:#fff;font:700 17px system-ui;cursor:pointer}.error{color:var(--error);border-left:3px solid var(--error);padding-left:12px}
@media(max-width:360px){.dates,.times{grid-template-columns:minmax(0,1fr)}main{padding:20px 16px 32px}}
@media(prefers-color-scheme:dark){:root{--bg:#141719;--text:#f5f7f8;--muted:#b8c2c9;--line:#6e7980;--accent:#ce470d;--surface:#22292d;--error:#ff919a}}
</style></head><body><main><header><div class="brand"><span>Free</span>Finder</div><h1>Deal-Entwurf bearbeiten</h1>
<p>Speichern ändert nur den Entwurf. Die Freigabe erfolgt danach separat in Slack.</p></header>
${error ? `<p class="error" role="alert">${escape(error)}</p>` : ''}
<form method="post"><input type="hidden" name="payload" value="${escape(payload)}"><input type="hidden" name="sig" value="${escape(sig)}">
<label for="brand">Anbieter<input id="brand" name="brand" required maxlength="200" value="${value('brand')}" placeholder="z.B. OMV, Café, Kirche"></label>
<label for="title">Deal-Titel<input id="title" name="title" required maxlength="250" value="${value('title')}" placeholder="z.B. Gratis Kaffee testen"></label>
<label for="distance">Adresse<input id="distance" name="distance" required maxlength="1000" value="${value('distance')}" placeholder="Straße, Hausnummer, PLZ, Ort oder Online"></label>
<fieldset class="period"><legend>Datum / Zeitraum (optional)</legend><div class="modes">
<label class="choice"><input type="radio" name="validityMode" value="text"${!picker ? ' checked' : ''}>Freie Angabe</label>
<label class="choice"><input type="radio" name="validityMode" value="picker"${picker ? ' checked' : ''}>Datum und Uhrzeit wählen</label></div>
<div class="text-period"><label for="validityText">Datum / Zeitraum<input id="validityText" name="validityText" maxlength="500" value="${value('validityText')}" placeholder="z.B. 14.10.2026, 12–15 Uhr oder 14.–18.10.2026"></label></div>
<div class="picker-period"><div class="dates"><label for="periodStart">Von<input type="date" id="periodStart" name="periodStart" value="${value('periodStart')}"></label>
<label for="periodEnd">Bis<input type="date" id="periodEnd" name="periodEnd" value="${value('periodEnd')}"></label></div>
<label class="choice"><input type="checkbox" name="includeTime" value="1"${timed ? ' checked' : ''}>Uhrzeit angeben</label>
<div class="times"><label for="periodStartTime">Beginn<input type="time" id="periodStartTime" name="periodStartTime" value="${value('periodStartTime')}"></label>
<label for="periodEndTime">Ende<input type="time" id="periodEndTime" name="periodEndTime" value="${value('periodEndTime')}"></label></div><p class="zone">Alle Uhrzeiten: Wien.</p></div></fieldset>
<label for="url">Link (optional)<input type="url" id="url" name="url" maxlength="2000" value="${value('url')}" placeholder="https://..." autocapitalize="none" spellcheck="false"></label>
<label for="description">Details<textarea id="description" name="description" rows="7" maxlength="12000" placeholder="Was ist gratis oder reduziert? Wann gilt der Deal?">${value('description')}</textarea></label>
<button type="submit">Entwurf speichern</button></form></main></body></html>`, { status, headers: {
    'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store', 'referrer-policy': 'no-referrer',
    'content-security-policy': "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; frame-ancestors 'none'",
  } });
}

export const AD_POLICY_VERSION = '2026-10-09';
export const AD_POLICY_MESSAGE = 'Business-Anzeigen für Alkohol sowie obszöne, pornografische oder sexuell explizite Inhalte sind bei FreeFinder nicht erlaubt. Bitte ändere dein Angebot. Verstöße werden entfernt.';

const normalize = value => String(value || '').normalize('NFKC').toLowerCase()
  .replace(/[\u200B-\u200D\uFEFF]/g, '').replace(/ß/g, 'ss')
  .normalize('NFD').replace(/\p{M}/gu, '');
const alcohol = /\b(?:alkohol(?:ische[nsrm]?)?|alcohol|bier(?:e|en)?|beer|wein(?:e|en)?|wine|prosecco|sekt|champagner|champagne|aperol|campari|vodka|wodka|whisk[ey]+|rum|gin|tequila|schnaps|likor|spirituosen|cocktails?|spritz|radler|sangria|gluhwein|punsch|longdrinks?|shots?)\b/u;
const obscene = /\b(?:porno\w*|porn\w*|sex(?:uell\w*|ual\w*|spielzeug|shop)?|erotik\w*|erotic\w*|nackt\w*|nude\w*|striptease|stripclub|escort\w*|bordell\w*|blowjob\w*|fuck\w*|fick\w*|schwanz|fotze|cunt)\b/u;

// Offer text is checked independently of merchant/street names. Explicitly
// alcohol-free products are allowed; another alcoholic item is still rejected.
export function adContentViolation(payload) {
  const offer = normalize([payload.dealTitle, payload.description, payload.oldPrice,
    payload.dealPrice, payload.offerValidityText].join('\n'));
  const sober = '(?:alkoholfrei(?:e[nsrm]?)?|alcohol[- ]free|non[- ]alcoholic|0[.,]0\\s*%?)';
  const drinks = '(?:bier|beer|wein|wine|sekt|cocktail|cocktails|radler|gin|prosecco|spritz|punsch)';
  const withoutAlcoholFree = offer
    .replace(new RegExp(`\\b${sober}\\s+${drinks}\\b`, 'gu'), '')
    .replace(new RegExp(`\\b${drinks}\\s*[,(-]?\\s*${sober}\\b`, 'gu'), '')
    .replace(/\bohne alkohol\b/gu, '');
  if (alcohol.test(withoutAlcoholFree) || /[🍺🍻🍷🥂🍸🍹🥃🍾]/u.test(offer)) return 'alcohol';
  if (obscene.test(normalize([offer, payload.restaurantName, payload.ctaURL].join('\n')))) return 'obscene';
  return null;
}

export async function validateAdRequest(request) {
  if (!request.headers.get('content-type')?.includes('application/json')) return { status: 415, body: { ok: false, error: 'JSON erwartet.' } };
  const reader = request.body?.getReader();
  let bytes = 0, raw = '';
  const decoder = new TextDecoder();
  if (reader) while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    bytes += value.byteLength;
    if (bytes > 16000) { await reader.cancel(); return { status: 413, body: { ok: false, error: 'Anfrage zu groß.' } }; }
    raw += decoder.decode(value, { stream: true });
  }
  let payload;
  try { payload = JSON.parse(raw + decoder.decode()); } catch { return { status: 400, body: { ok: false, error: 'Ungültige Anfrage.' } }; }
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)
    || !['restaurantName', 'dealTitle', 'description', 'address', 'ctaURL'].every(k => typeof payload[k] === 'string' && payload[k].trim())) {
    return { status: 400, body: { ok: false, error: 'Bitte Anbieter, Titel, Details, Adresse und Link ausfüllen.' } };
  }
  const limits = { restaurantName: 90, dealTitle: 110, description: 360, address: 140,
    ctaURL: 1000, offerValidityText: 160, oldPrice: 40, dealPrice: 40 };
  for (const [key, max] of Object.entries(limits)) {
    if (payload[key] != null && (typeof payload[key] !== 'string' || payload[key].trim().length > max
      || /[\u0000-\u0008\u000b-\u001f]/u.test(payload[key]))) {
      return { status: 400, body: { ok: false, error: 'Eine Angabe ist ungültig oder zu lang. Bitte prüfe deine Anzeige.' } };
    }
  }
  try {
    const url = new URL(payload.ctaURL);
    if (!['https:', 'http:'].includes(url.protocol) || !url.hostname.includes('.') || url.username || url.password) throw new Error();
  } catch {
    return { status: 400, body: { ok: false, error: 'Bitte einen gültigen https://-Link angeben.' } };
  }
  const violation = adContentViolation(payload);
  return { status: violation ? 422 : 200, body: violation
    ? { ok: false, error: AD_POLICY_MESSAGE, reason: violation }
    : { ok: true, policyVersion: AD_POLICY_VERSION } };
}

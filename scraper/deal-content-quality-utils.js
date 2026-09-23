import { cleanText } from './deal-normalization-utils.js';

function key(value) {
  return cleanText(value).normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
}

function escaped(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// These are review hints, not proof that a deal is invalid. Never remove or
// invent missing terms from these heuristics.
export function inspectDealContentQuality(deal = {}) {
  const issues = [];
  const add = (code, message) => issues.push({ code, message });
  const title = cleanText(deal.title);
  const description = cleanText(deal.description);
  const brand = key(deal.brand);
  const source = key(deal.metaGraphCaption || deal.evidence?.textSample || '');
  const copy = key([title, description, deal.address, deal.location, deal.distance, deal.expiryDisplayText].filter(Boolean).join(' '));
  const social = /^https?:\/\/(?:www\.)?(?:instagram\.com|tiktok\.com)\//i.test(deal.url || '');
  if (title.length > 110) add('long-title', 'Titel zu lang; Angebot kurz benennen, Bedingungen in den Details behalten');
  if ([title, description].some((text) => /(?:\.\.\.|…)$/.test(text)
      || (text.length >= 50 && /\b(?:und|oder|für|zum|zur|mit|beim|der|den|einem|einer)$/i.test(text)))) {
    add('truncated-copy', 'Text wirkt abgeschnitten; vollständige Quelle prüfen');
  }
  if (/(?:^|\s)#[\p{L}\p{N}_]+|:(?:eyes|fire|pizza|flushed):/u.test(`${title} ${description}`)) {
    add('social-noise', 'Caption-Reste oder Emoji-Codes im sichtbaren Text');
  }
  if (brand && source) {
    const merchantMention = new RegExp(`(?<![\\p{L}\\p{N}])${escaped(brand)}(?![\\p{L}\\p{N}])`, 'u');
    const streetMention = new RegExp(`${escaped(brand)}(?:stra(?:ss|ß)e|gasse|platz|weg)`, 'u');
    if (streetMention.test(source) && !merchantMention.test(source)) {
      add('street-as-merchant', 'Anbieter scheint aus einem Straßennamen abgeleitet; Händler anhand der Quelle prüfen');
    }
  }
  if (social && !deal.merchantUsername && ['creator', 'scout', 'publisher'].includes(deal.sourceAccountType)) {
    add('unresolved-merchant', 'Creator und tatsächlicher Anbieter noch nicht eindeutig zugeordnet');
  }
  const location = key([deal.address, deal.location, deal.distance].filter(Boolean).join(' '));
  const onlineOnly = /^(?:online|online-only)$/i.test(deal.redemptionChannel || deal.channel || '')
    || /\bonline(?:shop| bestellen| einlosen| einlösen)|\blieferung\b/.test(copy);
  if (social && !onlineOnly && (!location || /^(?:wien|vienna|osterreich|österreich)(?:\s+(?:wien|vienna))*$/.test(location))) {
    add('location-unspecific', 'Nur Stadt/Region angegeben; Filiale oder teilnehmende Standorte prüfen');
  }
  if (social && ![deal.validOn, deal.validFrom, deal.validUntil, deal.expires, deal.expiryDisplayText].some(cleanText)) {
    add('validity-unspecified', 'Gültigkeitszeitraum nicht belegt; nicht als unbegrenzt gültig behandeln');
  }
  const conditions = [
    [/\bpro person\b/, 'Personenlimit'],
    [/\b(?:app|coupon|gutschein)\b/, 'App-/Gutscheinbedingung'],
    [/\b(?:neukunden|neukundinnen)\b/, 'Neukundenbedingung'],
    [/\bnur (?:vor ort|in dieser filiale)|\bausschlie(?:ss|ß)lich in/, 'Filial-/Vor-Ort-Beschränkung'],
    [/\b(?:mindestbestellwert|mindestumsatz)\b/, 'Mindestbetrag'],
  ];
  for (const [pattern, label] of conditions) {
    if (pattern.test(source) && !pattern.test(copy)) add('source-condition-missing', `${label} in der Quelle, aber nicht im Kartentext`);
  }
  return issues;
}

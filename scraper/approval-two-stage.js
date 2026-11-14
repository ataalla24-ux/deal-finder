import { inspectDealContentQuality } from './deal-content-quality-utils.js';
import { hasOnlyPreviewDescription } from './approval-source-evidence.js';
import { ENRICHMENT_MODE, updateDealEnrichment } from './deal-enrichment-state.js';

const normalized = text => String(text || '').normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
const number = value => String(Number(value.replace(',', '.')));
const values = (text, pattern, convert = match => match[1]) => [...text.matchAll(pattern)].map(convert);
const missing = (expected, actual) => expected.some(value => !actual.includes(value));

// Deliberately small factual checks, not a semantic proof of an entire article.
// Keep number punctuation/operators intact and compare monetary roles: a 20 EUR
// minimum spend is not evidence for a 20 EUR discount.
function amountFacts(text) {
  const facts = { Rabatt: [], Mindestbetrag: [], Preis: [], Betrag: [] };
  for (const match of text.matchAll(/(?<![\p{L}\p{N},.+-])(?:(\d+(?:[.,]\d+)?)\s*(?:€|euros?|eur)|(?:€|eur)\s*(\d+(?:[.,]\d+)?))(?![\p{L}\p{N}])/gu)) {
    const amount = number(match[1] || match[2]);
    facts.Betrag.push(amount);
    const before = text.slice(Math.max(0, match.index - 55), match.index);
    const after = text.slice(match.index + match[0].length, match.index + match[0].length + 40);
    const role = /(?:mindestbestellwert|mindestumsatz|bestellwert|warenwert|mbw)\s*:?[ ]*(?:(?:von|ab)\s*)?$/.test(before)
      || /^\s*(?:mindestbestellwert|mindestumsatz|bestellwert|warenwert|mbw)\b/.test(after) ? 'Mindestbetrag'
      : /(?:rabatt|ersparnis|guthaben|spare[nst]?)\s*(?:von\s*)?$/.test(before)
        || /^\s*(?:rabatt|ersparnis|guthaben)\b/.test(after) ? 'Rabatt'
        : /(?:nur|um|fur|preis(?:\s+von)?)\s*$/.test(before) ? 'Preis' : null;
    if (role) facts[role].push(amount);
  }
  facts.Prozentrabatt = values(text, /(?<![\p{L}\p{N},.+-])(\d+(?:[.,]\d+)?)\s*(?:%|prozent)(?![\p{L}\p{N}])/gu, match => number(match[1]));
  facts.Angebotsmenge = values(text, /(?<![\p{L}\p{N},.+-])(\d+)\s*([+-])\s*(\d+)(?![\p{L}\p{N},.+-])/gu, match => `${match[1]}${match[2]}${match[3]}`);
  for (const [item, pattern] of [['Pasta', 'pastas?'], ['Pizza', 'pizza|pizzen'], ['Burger', 'burgers?'],
    ['Kaffee', 'kaffees?'], ['Donut', 'donuts?'], ['Stück', 'stuck']]) {
    facts[`Angebotsmenge ${item}`] = values(text,
      new RegExp(`(?<![\\p{L}\\p{N},.+-])(\\d+)\\s*(?:${pattern})(?![\\p{L}\\p{N}])`, 'gu'), match => number(match[1]));
  }
  return facts;
}

function materialConditionHold(source, copy) {
  const notRequired = term => new RegExp(`\\b(?:kein(?:e[nr]?)?\\s+(?:${term})\\s+(?:notig|notwendig|erforderlich)|(?:${term})\\s+(?:ist\\s+)?nicht\\s+(?:notig|notwendig|erforderlich)|ohne\\s+(?:die\\s+|einen?\\s+)?(?:${term})(?=[.!?,]|$|\\s+(?:moglich|einlosbar|verfugbar)\\b))`);
  const required = term => new RegExp(`\\b(?:(?:nur\\s+)?(?:mit|per|in|via|uber|fur|als)\\s+(?:(?:der|die|einem?|einer)\\s+)?(?:${term})\\b|(?:${term})\\s+(?:ist\\s+)?(?:notig|notwendig|erforderlich))`);
  const negated = term => new RegExp(`\\bohne\\s+(?:(?:die|der|einen?|einer)\\s+)?(?:${term})\\b`);
  const conditions = [
    [/\bapp\b/, 'App-Nutzung', 'app'],
    [/\b(?:coupon|gutschein)(?:e|s)?\b/, 'Gutschein-/Coupon-Nutzung', '(?:coupon|gutschein)(?:e|s)?'],
    [/\b(?:neukund\w*|erstbestell\w*|erste[nr]?\s+bestellung)\b/, 'Neukundenbedingung', 'neukund\\w*|erstbestell\\w*|erste[nr]?\\s+bestellung'],
    [/\b(?:studierend\w*|student\w*)\b/, 'Studierendenbedingung', 'studierend\\w*|student\\w*'],
    [/\b(?:mitglied\w*|mitgliedschaft)\b/, 'Mitgliedschaft', 'mitglied\\w*'],
    [/\b(?:einmalig|einmal|1\s*(?:x|mal))\b/, 'Einmalige Einlösung'],
    [/\b(?:pro|je)\s+(?:person|gast)\b/, 'Personenlimit'],
    [/\bnur\s+vor\s+ort\b/, 'Einlösung nur vor Ort'],
    [/\b(?:mindestbestellwert|mindestumsatz|bestellwert|warenwert|mbw)\b/, 'Mindestbetrag', 'mindestbestellwert|mindestumsatz|bestellwert|warenwert|mbw'],
  ];
  for (const [pattern, label, term] of conditions) {
    if (!pattern.test(source)) continue;
    // An explicit exemption is optional, but cannot cancel a positive source
    // requirement elsewhere. Merely repeating its keyword in a negation is not
    // preservation of a required coupon, customer group or membership.
    const exemption = term ? notRequired(term) : null;
    if (exemption?.test(source)
      && !required(term).test(source.replace(new RegExp(exemption.source, 'g'), ' '))) continue;
    if (term && (notRequired(term).test(copy) || negated(term).test(copy)))
      return `${label} widerspricht der belegten Einlösebedingung.`;
    if (!pattern.test(copy)) return `${label} aus der Quelle fehlt im veröffentlichten Angebot.`;
  }
  // Known purchase requirements retain their object; merely mentioning an
  // unrelated purchase does not satisfy "bei Kauf eines Frühstücks".
  const purchase = source.match(/\b(?:bei(?:m)?|mit)\s+(?:kauf|bestellung|konsumation)\s+(?:(?:eines?|einer|des|der|von)\s+)?([\p{L}]+)\b/u);
  if (purchase) {
    const item = purchase[1].replace(/s$/, '');
    if (!/\b(?:kauf\w*|bestell\w*|konsum\w*)\b|\p{L}+kauf\b/u.test(copy)
      || !copy.includes(item)) return `Kaufbedingung aus der Quelle fehlt oder weicht ab (${purchase[1]}).`;
  }
  const weekdays = text => values(text, /\b(montag|dienstag|mittwoch|donnerstag|freitag|samstag|sonntag)(?:s)?\b/g);
  const requiredWeekdays = source.split(/[.!?\n]/).filter(sentence => /\b(?:nur|jeden?|taglich|jeweils|gultig|einlosbar|einlosen)\b/.test(sentence)).flatMap(weekdays);
  if (missing(requiredWeekdays, weekdays(copy))) return 'Belegter Wochentag der Einlösung fehlt oder weicht ab.';
  const times = text => {
    const range = /\b(\d{1,2})(?::(\d{2}))?\s*(?:uhr\s*)?(?:-|–|bis|und)\s*(\d{1,2})(?::(\d{2}))?\s*uhr\b/g;
    const windows = values(text, range, match => `${Number(match[1]) * 60 + Number(match[2] || 0)}-${Number(match[3]) * 60 + Number(match[4] || 0)}`);
    return [...windows, ...values(text.replace(range, ' '), /\b(vor|ab|bis|nach)\s+(\d{1,2})(?::(\d{2}))?\s*uhr\b/g,
      match => `${match[1]}-${Number(match[2]) * 60 + Number(match[3] || 0)}`)];
  };
  if (missing(times(source), times(copy))) return 'Belegte Uhrzeit der Einlösung fehlt oder weicht ab.';
  const limits = text => values(text, /\b(?:maximal|hochstens|max\.?)\s*(\d+|ein|zwei)\s*(?:einlosungen?|mal)\b/g,
    match => ({ ein: '1', zwei: '2' }[match[1]] || number(match[1])));
  if (missing(limits(source), limits(copy))) return 'Belegtes Einlösungslimit fehlt oder weicht ab.';
  return '';
}

// This is an additional copy check AFTER ordinary validity and human approval,
// not an alternative approval path. Optional copy/source absence is not a new
// blocker here; the caller retains current source/period/withdrawal decisions.
export function basicCopyHold(deal, sourceEvidence, { now = new Date() } = {}) {
  const source = sourceEvidence?.caption || deal.metaGraphCaption || deal.evidence?.textSample || '';
  // Current official verification already compared the complete original offer
  // identity, amounts, timing and text on this exact run, before editorial copy.
  if (deal.originSource === 'power-official-food' && deal.officialFoodReverifiedAt === now.toISOString()) return '';
  if (!source) return '';
  const original = normalized(source);
  const copy = normalized(`${deal.title || ''} ${deal.description || ''}`);
  // Only a literal matching product is covered by this narrow negative proof.
  // Another product's positive "gratis" cannot reverse "Kaffee nicht gratis".
  const freeClaim = /\b(?:gratis|kostenlos(?:e[rmns]?)?|geschenkt(?:e[rmns]?)?|free)\b/;
  const title = normalized(deal.title);
  if (freeClaim.test(title)) {
    const deniedProducts = [
      ...values(original, /\b([\p{L}][\p{L}-]{2,})\s+(?:(?:ist|gibt\s+es)\s+)?nicht\s+(?:gratis|kostenlos|geschenkt|free)\b/gu),
      ...values(original, /\bkein(?:e[rmns]?)?\s+(?:gratis|kostenlos(?:e[rmns]?)?|geschenkt(?:e[rmns]?)?|free)\s+([\p{L}][\p{L}-]{2,})\b/gu),
    ];
    if (deniedProducts.some(product => new RegExp(`(?<![\\p{L}\\p{N}])${product}(?![\\p{L}\\p{N}])`, 'u').test(title))) {
      return 'Grundprüfung: Gratis-Titel widerspricht dem ausdrücklich nicht kostenlosen Produkt.';
    }
  }
  const conditionHold = materialConditionHold(original, copy);
  if (conditionHold) return `Grundprüfung: ${conditionHold}`;
  const sourceFacts = amountFacts(original), copyFacts = amountFacts(copy);
  if (/\b(?:gratis|kostenlos|geschenkt|free)\b/.test(normalized(deal.title))
    && sourceFacts.Betrag.some(value => Number(value) > 0)
    && !/\b(?:gratis|kostenlos|geschenkt|free|cashback)\b|\b1\s*\+\s*1\b/.test(original)) {
    return 'Grundprüfung: Gratis-Titel widerspricht dem ausdrücklich kostenpflichtigen Angebot.';
  }
  for (const [role, amounts] of Object.entries(sourceFacts)) {
    // A currency amount cannot prove a percentage, or the reverse. Available
    // evidence with no value of that unit must not admit a new numeric claim.
    if (!amounts.length && !['Betrag', 'Prozentrabatt'].includes(role)) continue;
    if (missing(copyFacts[role], amounts) || role === 'Mindestbetrag' && missing(amounts, copyFacts[role])) {
      return `Grundprüfung: ${role} stimmt nicht mit dem belegten Angebot überein.`;
    }
  }
  const issues = inspectDealContentQuality({ ...deal, metaGraphCaption: source });
  return issues.some(issue => ['unresolved-merchant', 'street-as-merchant', 'location-as-merchant'].includes(issue.code))
    ? 'Grundprüfung: Anbieter ist noch nicht ausreichend belegt.' : '';
}

export function prepareTwoStagePublication(deal, { now = new Date(), sourceEvidence } = {}) {
  const pendingCopy = hasOnlyPreviewDescription(deal) || deal.approvalCopyReview?.deferred || deal.approvalCopyReview?.waitingForSlot;
  return updateDealEnrichment({ ...deal, approvalPublicationMode: ENRICHMENT_MODE }, {
    pendingFields: pendingCopy ? ['description'] : [], now,
  });
}

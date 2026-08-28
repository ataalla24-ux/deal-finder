function cleanPromotionText(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

const EXPLICIT_CONTEST_PATTERN = /\b(?:gewinnspiele?|verlosungen?|giveaways?|raffles?|sweepstakes?|lotter(?:y|ies)|contest|competition|zu\s+gewinnen|chance\s+(?:auf|to\s+win)|win\s+(?:a|an|the))\b/i;
const WINNER_OR_PRIZE_PATTERN = /\b(?:hauptpreis|gewinner(?:in(?:nen)?|innen)?|winners?|gewinnt|gewinnst|gewinne|gewinnen)\b/i;
const ENGAGEMENT_ACTION_PATTERN = /\b(?:likes?|liken|kommentier(?:e|st|t|en)?|comments?|tagg?(?:e|st|t|en)?|markier(?:e|st|t|en)?|follows?|folge(?:n|st|t)?|share|teilen?|teile)\b/i;
const NON_GUARANTEED_ALLOCATION_PATTERN = /\b(?:verschenk(?:e|st|t|en)?|give\s+away|given\s+away|auslos(?:e|ung|ungen|en|t)?|ausgew[aä]hlt|selected|einer\s+von\s+euch|one\s+(?:person|artist)|someone)\b/i;
const LIMITED_FREE_ALLOCATION_PATTERN = /\b\d{1,2}\s*[x×]\s*(?:free|gratis|kostenlos(?:e|er|es|en)?)\s+(?:tickets?|karten?|gutscheine?|vouchers?|gift\s*cards?|pl[aä]tze|spots?)\b/i;
const GUARANTEED_REDEMPTION_PATTERN = /\b(?:(?:je|pro)\s+(?:person|kunde|kundin|bestellung)|jede(?:r|n|m|s)?\s+(?:person|kunde|kundin)|f(?:ü|ue)r\s+alle|mit\s+(?:dem\s+)?(?:code|aktionscode|coupon))\b/i;
const FREE_TERM = '(?:gratis|kostenlos(?:e|er|es|en)?|kostenfrei|free)';
const INFRASTRUCTURE_TERM = '(?:pissoirs?|urinals?|klos?|toiletten?|toilets?|wc(?:-anlagen?)?|trinkwasser(?:brunnen|station(?:en)?|spender)?|trinkbrunnen|wasserspendern?|wasserbrunnen|(?:kunden[- ]?)?parkpl[aä]tze?|parkplatzsuche|parken|parkt|parkst|parking|ladestationen?|charging\\s+stations?|wlan|wi[- ]?fi)';
const FREE_INFRASTRUCTURE_PATTERN = new RegExp(
  `\\b(?:${FREE_TERM}\\b.{0,100}\\b${INFRASTRUCTURE_TERM}|${INFRASTRUCTURE_TERM}\\b.{0,100}\\b${FREE_TERM})\\b`,
  'i',
);
const PUBLIC_INFRASTRUCTURE_PATTERN = /\b(?:pissoirs?|urinals?|(?:public|öffentlich\w*)\s+(?:klos?|toiletten?|toilets?|wcs?|drinking[- ]?water|trinkwasser|wasser(?:brunnen|stationen?))|drinking[- ]?water\s+(?:fountains?|stations?)|water\s+(?:fountains?|stations?)|trinkwasserbrunnen)\b/i;
const INDEPENDENT_PROMOTION_PATTERN = /(?:\b\d{1,2}\s*%\s*(?:rabatt|discount|off)?\b|\b1\s*[+&]\s*1\b|\b2\s*(?:für|fuer|for)\s*1\b|\bbogo\b|\b(?:rabatt|gutschein|coupon|voucher|aktionscode|promo(?:code)?|happy\s*hour|halber\s+preis)\b|\b(?:statt|nur|only|um|für|fuer|for)\s+(?:€\s*)?\d{1,3}(?:[,.]\d{1,2})?\s*(?:€(?!\w)|euro\b|eur\b)|\b(?:gratis|kostenlos(?:e|er|es|en)?|kostenfrei|free)(?:\s+[A-Za-zÄÖÜäöüß'’-]+){0,2}\s+(?:eintritt|entry|admission|ticket|tickets|kaffee|coffee|essen|food|pizza|burger|kebab|kebap|drink|drinks|cocktail|dessert|menü|menue|styling|haarschnitt|goodie|goodies|probe|training|kurs|class|workshop|tasting|verkostung|fotobox|photobox|süßigkeiten|suessigkeiten|lizenz|lizenzen)\b)/i;
const FREE_MEMBERSHIP_PATTERN = /(?:\b(?:mitgliedschaft|membership|registrierung|registration)\b.{0,100}\b(?:gratis|kostenlos(?:e|er|es|en)?|kostenfrei|free)\b|\b(?:gratis|kostenlos(?:e|er|es|en)?|kostenfrei|free)\b.{0,100}\b(?:mitgliedschaft|membership|registrierung|registration)\b)/i;
const FREE_LEAD_ACTION_PATTERN = /(?:\b(?:book(?:ing|ed)?|reserv(?:e|ation|ierung|ieren)?|register|registration|contact|message|call|schedule|anfrag(?:e|en)?|buch(?:e|en|ung)?|kontakt(?:ier(?:e|en)?)?|meld(?:e|en)?)\b.{0,60}\b(?:for\s+free|gratis|kostenlos(?:e|er|es|en)?|kostenfrei|free)\b|\b(?:for\s+free|gratis|kostenlos(?:e|er|es|en)?|kostenfrei|free)\b.{0,60}\b(?:booking|reservation|registration|consultation|advice|quote|assessment|appointment|termin|beratung|kostenvoranschlag|buchung|reservierung|anmeldung)\b)/i;
const EDITORIAL_ROUNDUP_PATTERN = /(?:\b\d{1,2}\s+(?:ideen|events?|eventtipps?|tipps?|things\s+to\s+do)\b|\b(?:weitere|mehr)\s+(?:events?|ideen|tipps?)\b.{0,100}\b(?:blog|link\s+in\s+bio)\b|\b(?:ideen|events?|eventtipps?|tipps?)\b.{0,80}\b(?:teil|part)\s*\d+\b|\b(?:teil|part)\s*\d+\b.{0,80}\b(?:ideen|events?|eventtipps?|tipps?)\b)/i;
const BIRTHDAY_CONTEXT_PATTERN = /\b(?:birthday[-\s]+(?:special|deal|offer)|geburtstag(?:s)?[-\s]+(?:special|deal|angebot|aktion)|du\s+hast\s+geburtstag|wenn\s+du\s+geburtstag\s+hast)\b/i;
const EURO_AMOUNT_BEFORE_ENTRY_PATTERN = /(?:nur\s+|only\s+|um\s+|für\s+|fuer\s+|jeweils\s+)?(?:€\s*(\d{1,3}(?:[,.]\d{1,2})?)|(\d{1,3}(?:[,.]\d{1,2})?)\s*(?:€|euro\b|eur\b))\s*(?:pro\s+person\s+)?(?:eintritt|entry|admission)\b/i;
const EURO_AMOUNT_AFTER_ENTRY_PATTERN = /\b(?:eintritt|entry|admission)\b.{0,80}?(?:nur\s+|only\s+|um\s+|für\s+|fuer\s+)?(?:€\s*(\d{1,3}(?:[,.]\d{1,2})?)|(\d{1,3}(?:[,.]\d{1,2})?)\s*(?:€|euro\b|eur\b))/i;
const VIENNA_DEPARTURE_PATTERN = /\b(?:from|ab|von|departing\s+from|departure\s+from|partenza\s+da|volo\s+da)\s+(?:wien|vienna)\b/i;
const INBOUND_VIENNA_TRAVEL_PATTERN = /(?:\b(?:trip|reise|viaggio|vacanza|city\s*break|travel\s+package|reisepaket)\s+(?:to|nach|a|in)\s+(?:wien|vienna)\b|\b(?:wien|vienna)\b.{0,180}\b(?:trip|reise|viaggio|vacanza|city\s*break|travel\s+package|reisepaket)\b)/i;
const TRAVEL_PACKAGE_WINDOW_PATTERN = /(?:\b(?:from|dal|vom)\s+\d{1,2}\b.{0,100}\b(?:to|al|bis)\s+\d{1,2}\b|\b(?:viaggi(?:are|o)?|pacchetto|a\s+soli|volo|hotel)\b.{0,160}(?:€\s*\d|\d\s*€))/i;

export function extractBirthdayEntryOffer(value) {
  const text = cleanPromotionText(value);
  const birthdayContext = text.match(BIRTHDAY_CONTEXT_PATTERN);
  if (!birthdayContext || !Number.isFinite(birthdayContext.index)) return null;

  // Restrict price extraction to the offer clause so unrelated event prices do
  // not override a genuine free promotion elsewhere in a long caption.
  const context = text.slice(birthdayContext.index, birthdayContext.index + 420);
  const priceMatch = context.match(EURO_AMOUNT_BEFORE_ENTRY_PATTERN)
    || context.match(EURO_AMOUNT_AFTER_ENTRY_PATTERN);
  if (!priceMatch) return null;

  const rawAmount = priceMatch[1] || priceMatch[2] || '';
  const amount = rawAmount.replace('.', ',').replace(/,00$/, '');
  if (!amount) return null;
  const evidenceEnd = Math.min(context.length, (priceMatch.index || 0) + priceMatch[0].length);
  return {
    amount,
    evidence: cleanPromotionText(context.slice(0, evidenceEnd)).slice(0, 220),
  };
}

export function getNonGuaranteedPromotionReason(value) {
  const text = cleanPromotionText(value);
  if (!text) return '';
  if (EXPLICIT_CONTEST_PATTERN.test(text) || WINNER_OR_PRIZE_PATTERN.test(text)) {
    return 'Gewinnspiel/Verlosung statt direkt nutzbarem Deal';
  }
  if (ENGAGEMENT_ACTION_PATTERN.test(text) && NON_GUARANTEED_ALLOCATION_PATTERN.test(text)) {
    return 'Engagement-Aktion ohne garantierte Gegenleistung';
  }
  if (LIMITED_FREE_ALLOCATION_PATTERN.test(text) && !GUARANTEED_REDEMPTION_PATTERN.test(text)) {
    return 'Begrenzte Gratis-Vergabe statt allgemein nutzbarem Deal';
  }
  return '';
}

export function getInfrastructureOnlyPromotionReason(value) {
  const text = cleanPromotionText(value);
  if (!text) return '';
  const infrastructureSignal = FREE_INFRASTRUCTURE_PATTERN.test(text)
    || PUBLIC_INFRASTRUCTURE_PATTERN.test(text);
  if (!infrastructureSignal || INDEPENDENT_PROMOTION_PATTERN.test(text)) return '';
  return 'kostenlose Infrastruktur statt Deal';
}

export function getMembershipOnlyPromotionReason(value) {
  const text = cleanPromotionText(value);
  if (!text || !FREE_MEMBERSHIP_PATTERN.test(text)) return '';
  if (INDEPENDENT_PROMOTION_PATTERN.test(text)) return '';
  return 'kostenlose Mitgliedschaft/Registrierung statt Deal';
}

export function getLeadGenerationOnlyPromotionReason(value) {
  const text = cleanPromotionText(value);
  if (!text || !FREE_LEAD_ACTION_PATTERN.test(text)) return '';
  if (INDEPENDENT_PROMOTION_PATTERN.test(text)) return '';
  return 'kostenlose Buchung/Kontaktaufnahme statt kostenloser Leistung';
}

export function getEditorialRoundupPromotionReason(value) {
  const text = cleanPromotionText(value);
  if (!text || !EDITORIAL_ROUNDUP_PATTERN.test(text)) return '';
  return 'redaktioneller Mehrfach-Roundup statt eindeutigem Einzelangebot';
}

export function getInboundForeignTravelPromotionReason(value) {
  const text = cleanPromotionText(value);
  if (!text || VIENNA_DEPARTURE_PATTERN.test(text)) return '';
  if (!INBOUND_VIENNA_TRAVEL_PATTERN.test(text) || !TRAVEL_PACKAGE_WINDOW_PATTERN.test(text)) return '';
  return 'Reisepaket nach Wien statt lokalem Wiener Deal';
}

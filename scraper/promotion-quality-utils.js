function cleanPromotionText(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

const EXPLICIT_CONTEST_PATTERN = /\b(?:gewinnspiele?|verlosungen?|giveaways?|raffles?|sweepstakes?|lotter(?:y|ies)|contest|competition|zu\s+gewinnen|chance\s+(?:auf|to\s+win)|win\s+(?:a|an|the))\b/i;
const WINNER_OR_PRIZE_PATTERN = /\b(?:hauptpreis|gewinner(?:in(?:nen)?|innen)?|winners?|gewinnt|gewinnst|gewinne|gewinnen)\b/i;
const ENGAGEMENT_ACTION_PATTERN = /\b(?:likes?|liken|kommentier(?:e|st|t|en)?|comments?|tagg?(?:e|st|t|en)?|markier(?:e|st|t|en)?|follows?|folge(?:n|st|t)?|share|teilen?|teile)\b/i;
const NON_GUARANTEED_ALLOCATION_PATTERN = /\b(?:verschenk(?:e|st|t|en)?|give\s+away|given\s+away|auslos(?:e|ung|ungen|en|t)?|ausgew[aä]hlt|selected|einer\s+von\s+euch|one\s+(?:person|artist)|someone)\b/i;
const LIMITED_FREE_ALLOCATION_PATTERN = /\b\d{1,2}\s*[x×]\s*(?:free|gratis|kostenlos(?:e|er|es|en)?)\s+(?:tickets?|karten?|gutscheine?|vouchers?|gift\s*cards?|pl[aä]tze|spots?)\b/i;
const GUARANTEED_REDEMPTION_PATTERN = /\b(?:(?:je|pro)\s+(?:person|kunde|kundin|bestellung)|jede(?:r|n|m|s)?\s+(?:person|kunde|kundin)|f(?:ü|ue)r\s+alle|mit\s+(?:dem\s+)?(?:code|aktionscode|coupon))\b/i;

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

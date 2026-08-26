function cleanPromotionText(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

const EXPLICIT_CONTEST_PATTERN = /\b(?:gewinnspiele?|verlosungen?|giveaways?|raffles?|sweepstakes?|lotter(?:y|ies)|contest|competition|zu\s+gewinnen|chance\s+(?:auf|to\s+win)|win\s+(?:a|an|the))\b/i;
const WINNER_OR_PRIZE_PATTERN = /\b(?:hauptpreis|gewinner(?:in(?:nen)?|innen)?|winners?|gewinnt|gewinnst|gewinne|gewinnen)\b/i;
const ENGAGEMENT_ACTION_PATTERN = /\b(?:likes?|liken|kommentier(?:e|st|t|en)?|comments?|tagg?(?:e|st|t|en)?|markier(?:e|st|t|en)?|follows?|folge(?:n|st|t)?|share|teilen?|teile)\b/i;
const NON_GUARANTEED_ALLOCATION_PATTERN = /\b(?:verschenk(?:e|st|t|en)?|give\s+away|given\s+away|auslos(?:e|ung|ungen|en|t)?|ausgew[aä]hlt|selected|einer\s+von\s+euch|one\s+(?:person|artist)|someone)\b/i;

export function getNonGuaranteedPromotionReason(value) {
  const text = cleanPromotionText(value);
  if (!text) return '';
  if (EXPLICIT_CONTEST_PATTERN.test(text) || WINNER_OR_PRIZE_PATTERN.test(text)) {
    return 'Gewinnspiel/Verlosung statt direkt nutzbarem Deal';
  }
  if (ENGAGEMENT_ACTION_PATTERN.test(text) && NON_GUARANTEED_ALLOCATION_PATTERN.test(text)) {
    return 'Engagement-Aktion ohne garantierte Gegenleistung';
  }
  return '';
}

function normalize(value) {
  return String(value || '').toLowerCase().replace(/ä/g, 'ae').replace(/ö/g, 'oe')
    .replace(/ü/g, 'ue').replace(/ß/g, 'ss').normalize('NFKD').replace(/[\u0300-\u036f]/g, '')
    .replace(/#[\p{L}\p{N}_]+/gu, ' ').replace(/\s+/g, ' ').trim();
}

function offerText(value) {
  if (!value || typeof value !== 'object') return normalize(value);
  // Merchant names, addresses and whole-page menus are not the promoted product.
  return normalize([value.title, value.description, value.promotionEvidence].filter(v => typeof v === 'string').join('\n'));
}

const ALCOHOL = '(?:biere?n?|beers?|spritzer|spritz(?:getraenke?)?|aperol|campari|wein(?:e|verkostung)?|rotwein|weisswein|wines?|prosecco|sekt|champagner|champagne|cocktails?|longdrinks?|vodka|wodka|gin|rum|whisk[ey]+|tequila|likoer|schnaps|spirituosen|radler|gluehwein)';
const ALCOHOL_PATTERN = new RegExp(`\\b${ALCOHOL}\\b`, 'i');
const NON_ALCOHOLIC = '(?:alkoholfrei(?:e[rmns]?)?|alcohol[- ]free|non[- ]alcoholic|0[.,]0\\s*%)';
const FOOD = /\b(?:essen|speisen?|gerichte?|food|mahlzeiten?|mittagessen|restaurants?|getraenke?|pizza|burger|kebap|kebab|doener|dueruem|falafel|schnitzel|pasta|nudeln|noodles|ramen|sushi|bowls?|sandwich|wraps?|pommes|menue|mittagsmenue|lunch|brunch|fruehstueck|buffet|croissant|brot|semmel|gebaeck|backwaren|krapfen|topfen|kuchen|torte|desserts?|tiramisu|baklava|eis|gelato|kaffee|coffee|espresso|cappuccino|melange|kakao|latte|matcha|tee|tea|boba|ayran|limonade|softdrinks?|mocktails?|saefte|saft|smoothies?)\b/i;
const BENEFIT = /\b(?:gratis|kostenlos\w*|kostenfrei|free|rabatt|discount|guenstiger|billiger|geschenkt|coupon|gutschein)\b|\b1\s*\+\s*1\b|\d+\s*%/i;
const PROFESSIONAL = /\b(?:coaching|teamcoaching|erstgespraech|beratung|besichtigung\w*|entruempelung\w*|raeumung\w*|musterwohnungsraeumung|wohnungen?|wohnmesse|immobilien|buwog|webseiten?[- ]check|seo[- ]check|reservierungssoftware|buchungssoftware|reservierungssystem|b2b)\b/i;

function withoutAlcoholFreeProducts(text) {
  return text
    .replace(/\b(?:komm(?:t|en)?|schau(?:t|en)?)\s+(?:(?:gerne?|doch|mal|heute)\s+){0,3}rum\b/gi, '')
    .replace(new RegExp(`\\b(?:ausgenommen|ohne|except|excluding)\\s+${ALCOHOL}(?:\\s*(?:,|und|oder|and|or|/|&)\\s*${ALCOHOL})*\\b`, 'gi'), '')
    .replace(new RegExp(`\\b${NON_ALCOHOLIC}\\s+${ALCOHOL}\\b`, 'gi'), ' nonalcoholicproduct ')
    .replace(new RegExp(`\\b${ALCOHOL}\\s*[(,:-]?\\s*(?:${NON_ALCOHOLIC}|ohne alkohol)(?:\\b|(?<=%))\\)?`, 'gi'), ' nonalcoholicproduct ')
    .replace(/\b(?:kein(?:en)?|ohne)\s+alkohol\b/gi, '');
}

export function discoveryRejection(value) {
  const text = offerText(value);
  const alcoholText = withoutAlcoholFreeProducts(text);
  if (ALCOHOL_PATTERN.test(alcoholText)) return 'alcohol-offer';
  // A free sales contact or business tool is not a consumer saving. Keep an
  // independently promised food benefit even if booking/contact is mentioned.
  if (PROFESSIONAL.test(text) && BENEFIT.test(text)
      && !(FOOD.test(text) && /\b(?:gratis|kostenlos\w*|free)\s+(?:kaffee|coffee|pizza|essen|menue)\b/.test(text))) {
    return 'business-lead-generation';
  }
  if (value?.socialFoodReview === true && /\b(?:seo|webseiten?|suchmaschinen|google rankt)\b/.test(text)
      && !FOOD.test(text)) return 'non-food-review';
  return '';
}

export function foodDiscoveryPriority(value) {
  if (discoveryRejection(value)) return 0;
  const title = normalize(value?.title);
  // Do not trust inferred "essen" categories: ticket/software ads had them too.
  if (FOOD.test(title) || withoutAlcoholFreeProducts(title).includes('nonalcoholicproduct')) return 1;
  if (/\b(?:eintritt|tickets?|software|workshop|konzert)\b/.test(title)) return 0;
  const text = offerText(value);
  return FOOD.test(text) || withoutAlcoholFreeProducts(text).includes('nonalcoholicproduct') ? 1 : 0;
}

export function filterDiscoveryDeals(deals) {
  const kept = [];
  const removed = [];
  const reasonCounts = {};
  for (const deal of deals) {
    const reason = discoveryRejection(deal);
    if (!reason) kept.push(deal);
    else {
      removed.push({ deal, reason });
      reasonCounts[reason] = (reasonCounts[reason] || 0) + 1;
    }
  }
  return { deals: kept, removed, reasonCounts };
}

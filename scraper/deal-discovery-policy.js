import { getNonOfferContentReason } from './promotion-quality-utils.js';
import { isKitchenApplianceOffer } from './category-utils.js';

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

const ALCOHOL = '(?:biere?n?|beers?|spritzer|spritz(?:getraenke?)?|aperol|campari|wein(?:e|verkostung)?|rotwein|weisswein|wines?|cuvees?|prosecco|rosecco|sekt|champagner|champagne|cocktails?|martinis?|shots?|longdrinks?|vodka|wodka|gin|rum|whisk[ey]+|tequila|likoer|schnaps|spirituosen|radler|gluehwein)';
const ALCOHOL_PATTERN = new RegExp(`\\b${ALCOHOL}\\b`, 'i');
const NON_ALCOHOLIC = '(?:alkoholfrei(?:e[rmns]?)?|alcohol[- ]free|non[- ]alcoholic|0[.,]0\\s*%)';
const FOOD = /\b(?:essen|speisen?|gerichte?|food|mahlzeiten?|mittagessen|restaurants?|getraenke?|pizza|burger|kebap|kebab|doener|dueruem|falafel|schnitzel|pasta|nudeln|noodles|ramen|sushi|bowls?|sandwich|wraps?|pommes|menue|mittagsmenue|lunch|brunch|fruehstueck|buffet|croissant|brot|semmel|gebaeck|backwaren|krapfen|topfen|kuchen|torte|desserts?|tiramisu|baklava|eis|gelato|kaffee|coffee|espresso|cappuccino|melange|kakao|latte|matcha|tee|tea|boba|ayran|limonade|softdrinks?|mocktails?|saefte|saft|smoothies?)\b/i;
const BENEFIT = /\b(?:gratis|kostenlos\w*|kostenfrei|free|rabatt|discount|guenstiger|billiger|geschenkt|coupon|gutschein)\b|\b1\s*\+\s*1\b|\d+\s*%/i;
const PROFESSIONAL = /\b(?:coaching|teamcoaching|erstgespraech|beratung|besichtigung\w*|entruempelung\w*|raeumung\w*|musterwohnungsraeumung|wohnungen?|wohnmesse|immobilien|buwog|webdesign|webseiten?[- ]check|seo[- ]check|reservierungssoftware|buchungssoftware|reservierungssystem|b2b)\b/i;

export function getNonConsumerOfferRejection(value) {
  const text = offerText(value);
  const tradeAudience=/\b(?:fuer\s+(?:betriebe|installateure|elektriker|handwerksbetriebe)|(?:ihrem|ihren|eurem|euer)\s+betrieb|for\s+(?:businesses|plumbers|electricians))\b/.test(text);
  const jobMarketplace=/\b(?:provision|grundgebuehr|servicegebuehr|serviceabo|offene\s+auftraege|auftraege\s+(?:ansehen|finden)|commission|service\s+fee)\b/.test(text)
    && /\b(?:registrieren|registrierung|auftraege|auftrag|register|sign\s+up)\b/.test(text);
  // Free business registration or waived acquisition fees are not offers for
  // app users. Do not exclude a separate concrete food perk for tradespeople.
  if(tradeAudience && jobMarketplace && !FOOD.test(text))return 'business-lead-generation';
  const businessTool = /\b(?:software|saas|stempelkarten?|treuekarten?|kaffeestempel|loyalty\s+(?:app|software|platform|system)|kundenbindungs(?:system|software|tool))\b/.test(text);
  const merchantAudience = /\b(?:ihre[nenmrs]*\s+(?:gaeste|kunden|kundinnen)|your\s+(?:guests|customers)|(?:cafe|restaurant|shop)\s+owners?|fuer\s+(?:gastronomen|geschaeftsinhaber|cafe-betreiber))\b/.test(text);
  const exampleReward = /\b(?:z\.\s*b\.|zum\s+beispiel|beispielsweise|e\.\s*g\.|for\s+example|such\s+as)[^!?;]{0,100}\b(?:gratis|kostenlos\w*|free|geschenkt)\b/.test(text);
  const toolSalesPitch = /\b(?:einsatzbereit|demo\s+(?:buchen|anfragen)|jetzt\s+testen|start\s+(?:your\s+)?free\s+trial|book\s+a\s+demo|kundenbindung\s+steigern)\b/.test(text);
  // Concrete food words in a hypothetical reward do not turn software sales
  // copy into a cafe offer. Consumer loyalty cards have no merchant sales pitch.
  if (businessTool && merchantAudience && (exampleReward || toolSalesPitch)) return 'illustrative-business-reward';

  const amount = '\\d{1,3}(?:[.,]\\d{1,2})?';
  const euro = `(?:(?:€|\\beur)\\s*${amount}|${amount}\\s*(?:€|eur\\b|euro\\b))`;
  const surcharge = new RegExp(`${euro}\\s*(?:more|extra|additional|mehr|aufpreis|zuschlag)\\b(?!\\s+(?:rabatt|discount|sparen|ersparnis))|\\b(?:aufpreis|zuschlag|surcharge)\\s*(?:(?:von|nur|of|only)\\s+)?${euro}`, 'i');
  if (!surcharge.test(text)) return '';

  // Saved captions can retain a genuine discount cut off in the display copy.
  // Such mixed posts are not pure upsells; the ordinary approval checks remain.
  const sourceText = value && typeof value === 'object'
    ? normalize([value.metaGraphCaption, value.originalCaption, value.caption, value.evidence?.offerDateSignal]
      .filter(part => typeof part === 'string').join('\n')) : '';
  const benefitText = `${text} ${sourceText}`
    .replace(/\b(?:gluten|sugar|lactose|dairy|alcohol|caffeine|cruelty|plastic|smoke|tax|risk|fat|nut|gmo)[- ]free\b/g, '')
    .replace(/\b(?:kein\w*|ohne|no|not)\s+(?:\d{1,2}\s*%\s*)?(?:rabatt|discount|gratis|free)\b/g, '');
  const quantifiedSaving = /\b\d{1,2}\s*%\s*(?:rabatt|discount|off|guenstiger|billiger|weniger|auf)\b|\b(?:rabatt|discount)\s*(?:von\s+)?\d{1,2}\s*%/.test(benefitText)
    || new RegExp(`\\b(?:save|spare?n?|ersparnis|rabatt|discount)\\s*(?:von\\s+)?${euro}`, 'i').test(benefitText)
    || /\bearly[ -]?bird\b.{0,30}[-−]\s*\d{1,2}\s*%/.test(benefitText);
  const promotionalPrice = benefitText.split(/[.!?](?=\s|$)|[;\n]+/).some(clause => !surcharge.test(clause)
    && new RegExp(`\\b(?:sonderpreis|spezialpreis|aktionspreis|special\\s+price)\\b.{0,35}?${euro}`, 'i').test(clause));
  const freeProduct = /\b(?:gratis|kostenlos\w*|free)\s+(?:[a-z-]+\s+){0,2}(?:kaffee|coffee|espresso|pizza|burger|essen|food|dessert|getraenk|drink|eintritt|entry|admission|tickets?|upgrade)\b|\b(?:kaffee|coffee|espresso|pizza|burger|dessert|getraenk|drink)\s+(?:gratis|kostenlos\w*|free)\b/.test(benefitText);
  const bogo = /\b(?:1\s*[+&]\s*1|2\s*(?:fuer|for)\s*1|bogo)\b/.test(benefitText);
  const euroAmount = `(?:€\\s*(${amount})|(${amount})\\s*(?:€|eur\\b|euro\\b))`;
  const priceReduction = [...benefitText.matchAll(new RegExp(`${euroAmount}\\s*(?:statt|instead\\s+of)\\s*${euroAmount}`, 'g'))]
    .some(match => {
      const current = Number((match[1] || match[2]).replace(',', '.'));
      const previous = Number((match[3] || match[4]).replace(',', '.'));
      return current > 0 && current < previous;
    });
  // "Only 25 EUR more" is a surcharge, but a separate real discount in the
  // same post still belongs in review (for example a discounted duo ticket).
  return quantifiedSaving || promotionalPrice || freeProduct || bogo || priceReduction ? '' : 'paid-upsell-without-saving';
}

function withoutAlcoholFreeProducts(text) {
  return text
    .replace(/\b(?:ingwer|ginger|vitamin|immunity|kurkuma|turmeric|wheatgrass)[- ]shots?\b/gi, ' nonalcoholicproduct ')
    .replace(/\b(?:espresso|coffee|kaffee)[- ]shots?\b/gi, ' coffee ')
    .replace(/\b(?:camera|photo|food)[- ]shots?\b|\bshots?\s+of\b/gi, '')
    .replace(/\b(?:komm(?:t|en)?|schau(?:t|en)?)\s+(?:(?:gerne?|doch|mal|heute)\s+){0,3}rum\b/gi, '')
    .replace(new RegExp(`\\b(?:ausgenommen|ohne|except|excluding)\\s+${ALCOHOL}(?:\\s*(?:,|und|oder|and|or|/|&)\\s*${ALCOHOL})*\\b`, 'gi'), '')
    .replace(new RegExp(`\\b${NON_ALCOHOLIC}\\s+${ALCOHOL}\\b`, 'gi'), ' nonalcoholicproduct ')
    .replace(new RegExp(`\\b${ALCOHOL}\\s*[(,:-]?\\s*(?:${NON_ALCOHOLIC}|ohne alkohol)(?:\\b|(?<=%))\\)?`, 'gi'), ' nonalcoholicproduct ')
    .replace(/\b(?:kein(?:en)?|ohne)\s+alkohol\b/gi, '');
}

export function consumerFoodExclusion(value) {
  const text = offerText(value);
  const example = /\bz\.\s*b\.|\b(?:zum beispiel|beispielsweise|for example)\b|\be\.\s*g\./i;
  const publicGift = text.split(/[!?;\n]|\.(?=\s)/).some(clause =>
    !example.test(clause) && FOOD.test(clause) && /\b(?:gratis|kostenlos\w*|free|geschenkt)\b/.test(clause)
    && /\b(?:(?:fuer|an)\s+(?:alle|jeden)|(?:alle|unsere)\s+(?:gaeste|kunden|besucher)|jeder\s+(?:gast|kunde|besucher)|public|everyone)\b/.test(clause));
  const software = /\b(?:software|saas|gastroapp|kassensystem\w*|kassenabschluss|buchhaltung\w*|bilanz|steuerberater|mwst|digitale?\s+(?:kaffeestempel|stempelkarte\w*)|loyalty\s*(?:app|program)|kundenbindung|kundenbindungssoftware)\b/.test(text);
  const businessAudience = /\b(?:fuer\s+gastronomen|fuer\s+gastronomiebetriebe|restaurantbetreiber|coffee\s+shop\s+owners|ihre[nm]?\s+(?:gaeste|kunden)|your\s+(?:guests|customers)|steuerberater|kassenabschluss)\b/.test(text);
  if (software && businessAudience && (!publicGift || example.test(text))) return 'business-lead-generation';
  const helpers = /\b(?:volunteers?(?:\s+wanted)?|helfer\w*\s+gesucht|hiring|mitarbeiter\w*\s+gesucht|helping\s+hand)\b/.test(text);
  if (helpers && /\b(?:unterstuetzung|hilfe|mitarbeit\w*|helping\s+hand|kochkurse?|team|arbeit\w*|wanted)\b/.test(text)
      && !publicGift) return 'employment-only-food-benefit';
  return '';
}

export function discoveryRejection(value) {
  const text = offerText(value);
  if (value?.originSource === 'vienna-merchant-website') {
    // A restaurant directory can link to a mall or an international hotel site.
    // Its category/address must not turn unrelated offers into Vienna food deals.
    if (!foodDiscoveryPriority({ title: value.title, description: value.description })) return 'non-food-merchant-offer';
    if (/\b(?:connecting rooms|your stay|hotelaufenthalt|uebernachtung\w*|\d+\s+(?:nacht|naechte|nights?))\b/.test(text)) return 'hotel-package-not-food-offer';
    if (/\b(?:prague|prag|alcron)\b/.test(text) && !/\b(?:wien|vienna)\b/.test(text)) return 'non-vienna-merchant-offer';
    if (/\bsportsbars in noe, bgld, stmk, ktn, ooe und sbg\b/.test(text) && !/\bwien\b/.test(text)) return 'non-vienna-merchant-offer';
  }
  const alcoholText = withoutAlcoholFreeProducts(text);
  if (ALCOHOL_PATTERN.test(alcoholText)) return 'alcohol-offer';
  const nonConsumerOffer = getNonConsumerOfferRejection(value);
  if (nonConsumerOffer) return nonConsumerOffer;
  const consumerExclusion = consumerFoodExclusion(value);
  if (consumerExclusion) return consumerExclusion;
  // The social-food review lane must not bypass the ordinary offer guards.
  if (getNonOfferContentReason(text)) return 'non-offer-content';
  if (/\b(?:free to read|read (?:it|the story) for free)\b/.test(text)
      && !/\b(?:free|gratis)\s+(?:coffee|kaffee|food|essen)\b/.test(text)) return 'non-offer-content';
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
  if (isKitchenApplianceOffer(typeof value === 'object' ? [value.title, value.description].join(' ') : value)) return 0;
  const title = normalize(value?.title);
  // Do not trust inferred "essen" categories: ticket/software ads had them too.
  if (FOOD.test(title) || /\b(?:dumplings?|gyoza|bao)\b/.test(title) || withoutAlcoholFreeProducts(title).includes('nonalcoholicproduct')) return 1;
  if (/\b(?:eintritt|tickets?|software|workshop|konzert)\b/.test(title)) return 0;
  const text = offerText(value);
  return FOOD.test(text) || /\b(?:dumplings?|gyoza|bao)\b/.test(text) || withoutAlcoholFreeProducts(text).includes('nonalcoholicproduct') ? 1 : 0;
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

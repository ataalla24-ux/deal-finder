// Conservative review thresholds, not claims about market prices or savings.
export const FOOD_PRICE_LIMITS = [
  { product: 'kebab', pattern: /\b(?:kebab|kebap|d\u00f6ner|doener|doner|d\u00fcr\u00fcm|dueruem)\b/gi, max: 4 },
  { product: 'pizza', pattern: /\bpizza\b/gi, max: 5 },
  { product: 'burger', pattern: /\b(?:burger|falafelwrap|wrap)\b/gi, max: 4 },
  { product: 'meal', pattern: /\b(?:mittagsmen\u00fc|mittagsmenue|mittagsteller|hauptspeise|lunch\s+menu|bowl|ramen)\b/gi, max: 6 },
  { product: 'buffet', pattern: /\b(?:buffet|all[ -]you[ -]can[ -]eat)\b/gi, max: 10 },
  { product: 'coffee', pattern: /\b(?:kaffee|coffee|espresso|cappuccino|latte|matcha)\b/gi, max: 2 },
  { product: 'drink', pattern: /\b(?:limonade|lemonade|softdrink|ayran|spritzer|bier)\b/gi, max: 2 },
  { product: 'snack', pattern: /\b(?:croissant|baklava|cannoli|eiskugel|kugel\s+eis)\b/gi, max: 1.5 },
];

export function isFoodDrinkSource(value) {
  if (value && typeof value === 'object' && /(?:pizza|sushi|doener|doner|kebab|kebap|coffee|foodie|burger|falafel)/i.test(value.username || '')) return true;
  const text = typeof value === 'object' && value
    ? [value.foodCategoryFromMention ? '' : value.category, value.username, value.name, value.description].filter(Boolean).join(' ')
    : String(value || '');
  return /(?:\b(?:food|drinks?|essen|trinken|getr\u00e4nke?|getraenke?|kaffee|restaurants?|gastro|lunch|brunch|fr\u00fchst\u00fcck|fruehstueck|pizza|burger|kebab|kebap|d\u00f6ner|doener|doner|d\u00fcr\u00fcm|dueruem|sushi|ramen|pasta|cafe|caf\u00e9|coffee|espresso|cappuccino|latte|matcha|cocktails?|spritz|bier|wein|eis|gelato|desserts?|bakery|b\u00e4ckerei|baeckerei|schnitzel|falafel|wrap|sandwich|ayran|limonade|softdrink|verkostung|croissant|krapfen)\b|(?:food|gastro|kaffee|streetfood|restaurants|eats)(?:wien|vienna)|(?:wien(?:er)?|vienna)(?:food|gastro|kaffee|streetfood|restaurants|eats|essen))/i.test(text.replace(/[_.-]/g, ' '));
}

const AD_FOOD_PRODUCT_PATTERN = /\b(?:food|essen|mahlzeiten?|speisen?|gerichte?|meals?|men\u00fc|menue|(?:sonntags|samstags|wochenend)?brunch|(?:fr\u00fchst\u00fccks|fruehstuecks)?buffet|fr\u00fchst\u00fcck|fruehstueck|pizza|burger|kebab|kebap|d\u00f6ner|doener|doner|d\u00fcr\u00fcm|dueruem|sushi|ramen|pasta|schnitzel|falafel|wraps?|sandwich|salate?|bowls?|kaffee|coffee|espresso|cappuccino|latte|matcha|getr\u00e4nke?|getraenke?|drinks?|cocktails?|bier|wein|spritzer|ayran|limonade|softdrink|eis|gelato|desserts?|snacks?|croissant|krapfen|waffles?|waffeln?|verkostung|tasting)\b/i;
const AD_NON_FOOD_OFFER_PATTERN = /\b(?:zahn\w*|prothes\w*|gebiss|dentures?|implants?|kaffeemaschinen?|coffee\s+machine|k\u00fchlschrank|kuehlschrank|fridge|refrigerator|k\u00fcchenger\u00e4te?|kuechengeraete?|aufbewahrungsbox|software|saas|b2b|b\u00fcro|buero|office|kantinenpersonal|testmonat|free\s+trial|tickets?|eintritt|admission|networking|e-commerce|online-shops?|seminar|webinar|courses?|kurse?|business\s+case|coffee\s+shop\s+owners?|caf[e\u00e9][-\s]?gr\u00fcnder|jobs?|bewerb\w*|immobilien|wohnung)\b/i;
const AD_FOOD_SAVING_PATTERN = /(?:\d{1,2}\s*%\s*(?:rabatt|discount|off|direktrabatt|auf\b|weniger|g\u00fcnstiger|guenstiger)|\b(?:rabatt|discount|spare|save)\b.{0,24}\d{1,2}\s*%|\b(?:1\s*[+&]\s*1|2\s*(?:f\u00fcr|fuer|for)\s*1|bogo|happy\s*hour)\b|\b(?:gutschein|coupon|aktionscode|promocode)\b|\b(?:statt|instead\s+of)\s*(?:\u20ac\s*)?\d)/i;
const AD_FREE_FOOD_PATTERN = /\b(?:gratis|kostenlos(?:e[rmns]?|en)?|kostenfrei|umsonst|free|geschenkt)\b/i;

export function getAdFoodBenefitRejection(value) {
  const text = String(value || '').replace(/#[\p{L}\p{N}_]+/gu, ' ');
  if (!isFoodDrinkSource(text) && !AD_FOOD_PRODUCT_PATTERN.test(text)) return 'non-food-ad';
  // An ad must discount the meal/drink itself, not a fridge, ticket or other
  // product that happens to mention eating. Check separate offer clauses first.
  const clauses = text.split(/[.!?](?=\s|$)|[\n;]+/).map((part) => part.replace(/\s+/g, ' ').trim());
  const negatedBenefit = /\b(?:kein\w*|nicht|not|no)\s+(?:\d{1,2}\s*%\s*)?(?:gratis|kostenlos\w*|free|rabatt|discount)\b/i;
  for (const clause of clauses) {
    if (!AD_FOOD_PRODUCT_PATTERN.test(clause) || AD_NON_FOOD_OFFER_PATTERN.test(clause)) continue;
    if (negatedBenefit.test(clause)) continue;
    if (extractLowFoodPrice(clause) || AD_FOOD_SAVING_PATTERN.test(clause)) return '';
    for (const free of clause.matchAll(new RegExp(AD_FREE_FOOD_PATTERN.source, 'gi'))) {
      const before = clause.slice(Math.max(0, free.index - 80), free.index);
      const after = clause.slice(free.index + free[0].length, free.index + free[0].length + 80);
      if (/\b(?:gluten|zucker|sugar|alkohol|alcohol|laktose|lactose|koffein|caffeine)[-\s]*$/i.test(before)) continue;
      if (/\b(?:lieferung|versand|zustellung|shipping|delivery|reservierung|beratung)\s*$/i.test(before)
          || /^\s*(?:lieferung|versand|zustellung|shipping|delivery|reservierung|beratung)\b/i.test(after)) continue;
      if (/\b\d+\s*(?:monate?|months?|tage?|days?|wochen?|weeks?)\s*$/i.test(before)
          && !AD_FOOD_PRODUCT_PATTERN.test(after)) continue;
      if (AD_FOOD_PRODUCT_PATTERN.test(after)
          || (AD_FOOD_PRODUCT_PATTERN.test(before) && /^\s*(?:dazu|for\s+you|on\s+us|[.!?,]|$)/i.test(after))) return '';
    }
    if (/\b(?:aufs\s+haus|on\s+us|pay\s+what\s+you\s+want|zahl\w*\s+was\s+du\s+willst)\b/i.test(clause)) return '';
  }
  // Food-only ads often put the product and coupon in separate sentences.
  // Do not extend that inference to trials, hardware or business/event ads.
  if (!AD_NON_FOOD_OFFER_PATTERN.test(text)
      && (AD_FOOD_PRODUCT_PATTERN.test(text) || /\b(?:restaurant|cafe|caf\u00e9|foodora|lieferando|wolt)\b/i.test(text))
      && clauses.some((clause) => !negatedBenefit.test(clause) && AD_FOOD_SAVING_PATTERN.test(clause))) return '';
  return 'no-consumer-food-benefit';
}

export function extractLowFoodPrice(value) {
  const text = String(value || '').replace(/\s+/g, ' ').trim();
  const amount = '(?<![\\d.,])(?:\\u20ac\\s*(\\d{1,2}(?:[.,]\\d{1,2})?)(?![\\d.,])|(\\d{1,2}(?:[.,]\\d{1,2})?)\\s*(?:\\u20ac|EUR\\b|Euro\\b))';
  const after = new RegExp(`^\\s*(?:[:=-]\\s*)?(?:(?:um|f\u00fcr|fuer|for|nur|only)\\s+){0,2}${amount}`, 'i');
  const before = new RegExp(`${amount}\\s*[-:]?\\s*$`, 'i');
  for (const rule of FOOD_PRICE_LIMITS) {
    for (const product of text.matchAll(new RegExp(rule.pattern))) {
      const start = product.index;
      const end = start + product[0].length;
      const following = text.slice(end, end + 70);
      const previous = text.slice(Math.max(0, start - 50), start);
      const priceAfter = following.match(after);
      const priceBefore = priceAfter ? null : previous.match(before);
      const price = priceAfter || priceBefore;
      if (!price) continue;
      const priceStart = priceAfter ? end + price.index : Math.max(0, start - 50) + price.index;
      const evidenceStart = Math.min(start, priceStart);
      const evidenceEnd = priceAfter ? end + price[0].length : end;
      const prefix = text.slice(Math.max(0, evidenceStart - 35), evidenceStart);
      const suffix = text.slice(evidenceEnd, evidenceEnd + 45);
      // Reject teaser prices, add-ons, partial portions and per-weight pricing.
      if (/\b(?:ab|from|statt|was|extra|aufpreis|zuschlag|topping|mini|kleine[rns]?|st\u00fcck|slice)\s*$/i.test(prefix)
          || /^\s*(?:[-/]\s*)?(?:extra|aufpreis|zuschlag|topping|slice|st\u00fcck)\b/i.test(suffix)
          || /^\s*(?:pro|je|\/)\s*(?:\d+\s*)?(?:g|kg|gramm)\b/i.test(suffix)) continue;
      const numeric = Number((price[1] || price[2]).replace(',', '.'));
      if (!Number.isFinite(numeric) || numeric <= 0 || numeric > rule.max) continue;
      return { product: product[0], productKind: rule.product, amount: numeric, currency: 'EUR', maximum: rule.max, evidence: text.slice(evidenceStart, evidenceEnd) };
    }
  }
  return null;
}

export function weakFoodPromotionReason(value) {
  const text = String(value || '').replace(/#[\p{L}\p{N}_]+/gu, ' ').replace(/\s+/g, ' ');
  const explicitBenefit = /(?:\d\s*%|\b1\s*\+\s*1\b|\b(?:rabatt|discount|coupon|gutschein|statt|aktion|er\u00f6ffnung|eroeffnung|opening|happy\s*hour)\b|\b(?:pay\s+what\s+you\s+want|zahl\w*\s+was\s+du\s+willst)\b)/i;
  if (/\b(?:stempelkarte|treuekarte|loyalty)\b/i.test(text)
      && /\b(?:gratis[ -]pr\u00e4mien|free\s+rewards|tolle\s+pr\u00e4mien)\b/i.test(text)
      && !/\b(?:gratis|kostenlos|free)[ -](?:kaffee|coffee|waffle|waffel|hei\u00dfgetr\u00e4nk|eisbecher|drink)\b/i.test(text)
      && !explicitBenefit.test(text)) return 'kein konkretes Angebot: Treueprogramm ohne benannte Gegenleistung';
  if (/\b(?:all[ -]you[ -]can[ -]eat|buffet)\b/i.test(text)
      && /(?:\u20ac\s*\d|\d\s*(?:\u20ac|EUR\b|Euro\b))/i.test(text)
      && !explicitBenefit.test(text)
      && !/\b(?:gratis|kostenlos|free|geschenkt|on\s+us|aufs\s+haus)\b/i.test(text)
      && !extractLowFoodPrice(text)) return 'kein konkretes Angebot: Buffet-Normalpreis ohne belegte Aktion oder besonders niedrigen Preis';
  return '';
}

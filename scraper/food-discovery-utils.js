// Conservative review thresholds, not claims about market prices or savings.
export const FOOD_PRICE_LIMITS = [
  { product: 'kebab', pattern: /\b(?:kebab|kebap|d\u00f6ner|doener|doner|d\u00fcr\u00fcm|dueruem)\b/gi, max: 4 },
  { product: 'pizza', pattern: /\bpizza\b/gi, max: 5 },
  { product: 'burger', pattern: /\b(?:burger|falafelwrap|wrap)\b/gi, max: 4 },
  { product: 'meal', pattern: /\b(?:mittagsmen\u00fc|mittagsmenue|mittagsteller|hauptspeise|lunch\s+menu|bowl|ramen)\b/gi, max: 6 },
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

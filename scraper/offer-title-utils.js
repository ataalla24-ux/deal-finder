// Select a complete, evidenced offer sentence; never manufacture prices or terms.
export function isPromotionalIntro(value = '') {
  return /\b(?:macht? euch bereit|aufgepasst|seid ihr bereit)\b/i.test(value)
    || /^(?:hey|hallo|achtung|aufgepasst)[!,\s]|\bdiesen deal\b|\b(?:das|ein) (?:absolute[sr]? |neue[sr]? )?highlight\b/i.test(value);
}

export function stripSlackEmojiCodes(value = '') {
  return String(value).replace(/:[a-z][a-z0-9_+-]*:/gi, ' ').replace(/\s+/g, ' ').trim();
}

export function isSocialInstructionTitle(value = '') {
  return /^(?:kommentier(?:e|t)?|folg(?:e|t)|markier(?:e|t)?|schreib(?:e|t)?|teil(?:e|t)?)\b|\b(?:per DM|direktnachricht)\b/iu.test(String(value).trim());
}

// Rewrite only complete, evidenced patterns. Unknown or ambiguous copy stays for review.
export function polishOfferTitle(value = '', description = '') {
  const original = String(value).trim();
  const text = stripSlackEmojiCodes(original)
    .replace(/^[🎉🔥📣\s\uFE0F]+/u, '')
    .replace(/\s+/g, ' ').trim();
  const comparison = text.replace(/\p{Extended_Pictographic}|\uFE0F/gu, '').trim()
    .match(/^(?:nur\s+)?(\d+(?:[,.]\d{1,2})?)\s*€\s+statt\s+(\d+(?:[,.]\d{1,2})?)\s*€[!.]*$/iu);
  if (comparison && !/\b(?:ab\s+\d|mindest\w*|neukunden?|bei\s+(?:kauf|bestellung|einem\s+einkauf)|mit\s+(?:code|coupon|gutschein))\b/iu.test(description)) {
    const products = [...description.matchAll(/\bUnsere?\s+([\p{L}\p{N}][\p{L}\p{N} '-]{1,45}?)(?:\s*[–—-]\s*[^.!?()]{1,70})?\s*\((\d+\s*(?:g|kg|ml|l))\)\s+gibt(?:[’']s|\s+es)/giu)];
    const prices = [...description.matchAll(/(\d+(?:[,.]\d{1,2})?)\s*€\s+statt\s+(\d+(?:[,.]\d{1,2})?)\s*€/giu)];
    if (products.length === 1 && prices.length === 1 && prices[0][1] === comparison[1] && prices[0][2] === comparison[2]) {
      return `${products[0][2]} ${products[0][1].trim()}: ${comparison[1]} € statt ${comparison[2]} €`;
    }
  }
  const translated = text.match(/^([^:!\n]{2,60}):\s*\d{1,2}% off, now (\d+(?:[,.]\d{1,2})?) € instead of (\d+(?:[,.]\d{1,2})?) €, for (\d+) persons(?: \([\d,.]+ € per person\))?$/u);
  if (translated) return `${translated[1]}: ${translated[2]} € statt ${translated[3]} € für ${translated[4]} Personen`;
  if (isSocialInstructionTitle(text)
      && /\b(?:die\s+)?zweite Pizza übernehmen wir[.!]/iu.test(description)
      && /\b(?:die\s+)?günstigere Pizza ist gratis[.!]/iu.test(description)
      && /\bGutschein\b/iu.test(description)) {
    return 'Zweite Pizza gratis mit Gutschein';
  }
  const opening = text.match(/^GRAND OPENING AM (\d{2}\.\d{2}\.\d{4})\s+Wir feiern Neueröffnung und die ersten (\d+) Personen essen GRATIS[!.]*$/iu);
  if (opening) return `Gratis Essen für die ersten ${opening[2]} Personen am ${opening[1]}`;
  const bonus = text.match(/^Zu jedem (Döner|Kebap|Burger) gibt[’']?s (?:ein(?:en)? )?(?:leckeres? )?(Tiramisu|Ayran) gratis[!.]*$/iu);
  if (bonus) {
    const product = bonus[1][0].toUpperCase() + bonus[1].slice(1).toLowerCase();
    const extra = bonus[2][0].toUpperCase() + bonus[2].slice(1).toLowerCase();
    return `Gratis ${extra} zu jedem ${product}`;
  }
  let candidate = text;
  if (/\bWo\??\s*:/iu.test(description)) candidate = candidate.replace(/\s+Wo\??$/iu, '');
  candidate = candidate.replace(/^(?:große|grosse|mega|tolle) Aktion\s*:\s*/iu, '');
  // A dangling word is not a license to invent the missing end of a sentence.
  if (/\b(?:wo|und|oder|mit|für|ab|bis|nur|bei)$/iu.test(candidate)) return original;
  if (candidate !== text && concreteFoodOfferTitle(candidate) === candidate) {
    return candidate.replace(/\bGRATIS\b/g, 'gratis').replace(/\b([12])\s*\+\s*1\b/g, '$1+1');
  }
  // Keep meaningful symbols such as a plus sign between quantities unchanged.
  return text || original;
}

export function concreteFoodOfferTitle(value = '') {
  const text = stripSlackEmojiCodes(value).replace(/\p{Extended_Pictographic}|\p{Emoji_Modifier}|\uFE0F/gu, ' ');
  const sentences = text.split(/[!?;\n]|(?<!\d)\.(?=\s|$)/u);
  for (const raw of sentences) {
    const sentence = raw.trim().replace(/\b(?:unglaubliche|unschlagbare)\s+(?=\d)/gi, '').replace(/(\d)\s*€/g, '$1 €').replace(/\s+/g, ' ');
    if (!sentence || sentence.length > 110 || isPromotionalIntro(sentence) || isSocialInstructionTitle(sentence)) continue;
    if (!/\b(?:döner|doner|kebap|kebab|pizza|burger|wrap|dürüm|köfte|kaffee|coffee|latte|matcha|espresso|eis|eiskaffee|sushi|bowl|frühstück|getränk|drink|ayran|kuchen|cheesecake)\b/i.test(sentence)) continue;
    if (!/\d+(?:[,.]\d{1,2})?\s*(?:€|euro\b)|\b(?:gratis|kostenlos)\b|\b[12]\s*\+\s*1\b/i.test(sentence)) continue;
    if (/\b(?:nicht|kein|keine|vorbei|abgelaufen|statt|früher)\b/i.test(sentence) || /[=,:-]$/.test(sentence)) continue;
    return sentence;
  }
  return '';
}

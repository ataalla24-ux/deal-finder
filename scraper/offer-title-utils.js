// Select a complete, evidenced offer sentence; never manufacture prices or terms.
export function isPromotionalIntro(value = '') {
  return /\b(?:macht? euch bereit|aufgepasst|seid ihr bereit)\b/i.test(value)
    || /^(?:hey|hallo|achtung|aufgepasst)[!,\s]|\bdiesen deal\b|\b(?:das|ein) (?:absolute[sr]? |neue[sr]? )?highlight\b/i.test(value);
}

export function stripSlackEmojiCodes(value = '') {
  return String(value).replace(/:[a-z][a-z0-9_+-]*:/gi, ' ').replace(/\s+/g, ' ').trim();
}

export function concreteFoodOfferTitle(value = '') {
  const text = stripSlackEmojiCodes(value).replace(/\p{Extended_Pictographic}|\p{Emoji_Modifier}|\uFE0F/gu, ' ');
  const sentences = text.split(/[!?;\n]|(?<!\d)\.(?=\s|$)/u);
  for (const raw of sentences) {
    const sentence = raw.trim().replace(/\b(?:unglaubliche|unschlagbare)\s+(?=\d)/gi, '').replace(/(\d)\s*€/g, '$1 €').replace(/\s+/g, ' ');
    if (!sentence || sentence.length > 110 || isPromotionalIntro(sentence)) continue;
    if (!/\b(?:döner|doner|kebap|kebab|pizza|burger|kaffee|coffee|latte|matcha|espresso|eis|eiskaffee|sushi|bowl|frühstück|getränk|drink|ayran|kuchen|cheesecake)\b/i.test(sentence)) continue;
    if (!/\d+(?:[,.]\d{1,2})?\s*(?:€|euro\b)|\b(?:gratis|kostenlos)\b|\b[12]\s*\+\s*1\b/i.test(sentence)) continue;
    if (/\b(?:nicht|kein|keine|vorbei|abgelaufen|statt|früher)\b/i.test(sentence) || /[=,:-]$/.test(sentence)) continue;
    return sentence;
  }
  return '';
}

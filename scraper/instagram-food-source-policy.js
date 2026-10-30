import { getAdFoodBenefitRejection, isFoodDrinkSource } from './food-discovery-utils.js';

export const FOOD_GRAPH_HASHTAGS = Object.freeze([
  'viennafood', 'wienessen', 'viennaeats', 'viennarestaurants',
  'wienfood', 'wienisst', 'wienfoodie', 'wienkaffee', 'wiengastro',
  'wienergastro', 'essenwien', 'wienstreetfood',
  'gratiswien', 'gratisinwien', 'wiengratis', 'neueröffnungwien',
  'wienangebot', 'wien',
]);
export const COMBINED_FOOD_HASHTAGS = Object.freeze([
  'wienfood', 'viennafood', 'wienisst', 'viennarestaurants', 'wienkaffee',
  'wienfoodie', 'wienergastro', 'essenwien', 'viennaeats',
]);
const ALLOWED_TAGS = new Set(FOOD_GRAPH_HASHTAGS);
const FOOD_TAGS = new Set(FOOD_GRAPH_HASHTAGS.slice(0, 12));
const SCOUTS = new Set([
  'lisa.maria.b', 'shaysfoodblog', 'foodiewien', 'tastyfood.vienna',
  'eatinvienna_', 'viennaeats', 'viennafoodstories', 'viennarestaurants',
  'viennawurstelstand', 'kseniainvienna', 'vienna.coffee', 'viennaafterclass',
]);
const FOOD_PLATFORMS = new Set([
  'wolt.oesterreich', 'foodora.at', 'lieferando.at', 'vorteilsclub.wien',
  'lidloesterreich', 'hoferat', 'billa_at', 'billa_oesterreich', 'bintat.at',
  'spar_oesterreich', 'alfies.at', 'megasupermarkt.at',
]);

function foodIdentity(value) {
  const text = String(value || '');
  if (/flight|flugversp|entsch.digung|workshops?|craft kits|waschmittel|multigrill|watt|software|app downloaden|free to read|kaffeemaschine/i.test(text)) return false;
  return isFoodDrinkSource(text) || /noodles?|dimsum|dim.sum|schnitzel|hotpot|bistro|deli(?:[._\s]|$)|cafe|caf[eé]|baeckerei|b.ckerei|restaurant|bakery|focaccia|kitchen|sandwich|kebap|kebab|sushi|grill(?:[._\s]|$)/i.test(text);
}
const EXCLUDED = new Map([
  ['flugninja.at', 'flight-compensation'],
  ['welovehandmade.at', 'craft-workshops'],
  ['howmuch.live', 'price-directory-software'],
  ['rhea_mat', 'coffee-equipment-b2b'],
  ['holzhandwerk.wien', 'woodworking'],
  ['klanglichtimpark.at', 'non-food-event'],
  ['shop.klanglichtimpark.at', 'non-food-event-ticket-shop'],
  ['apotheke.at', 'pharmacy'],
  ['juwel.wien', 'jewellery'],
  ['market.island_uae', 'foreign-venue'],
]);

export function foodGraphHashtags(value, fallback = FOOD_GRAPH_HASHTAGS) {
  const requested = Array.isArray(value) ? value : String(value || '').split(/[\s,;]+/);
  const selected = [...new Set(requested.map(tag => String(tag).replace(/^#/, '').trim().toLowerCase()))]
    .filter(tag => ALLOWED_TAGS.has(tag));
  return selected.length ? selected : [...fallback];
}

export const isDedicatedFoodHashtag = tag => FOOD_TAGS.has(String(tag).replace(/^#/, '').toLowerCase());

export function hasConsumerFoodOffer(value) {
  return !getAdFoodBenefitRejection(value);
}

export function instagramFoodSourceDecision(account = {}) {
  const username = String(account.username || '').replace(/^@/, '').toLowerCase();
  if (EXCLUDED.has(username)) return { allowed: false, reason: EXCLUDED.get(username) };
  if (account.blockedByModeration) return { allowed: false, reason: 'human-moderation' };
  if (FOOD_PLATFORMS.has(username)) return { allowed: true, reason: 'food-platform-or-grocer' };
  if (SCOUTS.has(username)) return { allowed: true, reason: 'food-scout' };
  if (account.approvedFoodSource === true) return { allowed: true, reason: 'approved-vienna-food-source' };
  if (account.origins?.includes('vienna-directory') && account.merchants?.some(merchant =>
    /^(?:restaurant|cafe|fast_food|bakery|ice_cream|bar|pub|food_court|canteen|deli|supermarket|confectionery)$/.test(merchant.kind))) {
    return { allowed: true, reason: 'vienna-food-directory' };
  }
  if (account.origins?.includes('watchlist') && /^(?:food|drinks|essen|trinken|kaffee|delivery)$/.test(account.category)) {
    return { allowed: true, reason: 'reviewed-food-watchlist' };
  }
  // A category inherited from a post or mention does not identify a business.
  if (foodIdentity([username, account.name, account.profileDescription].filter(Boolean).join(' '))) {
    return { allowed: true, reason: 'food-profile-identity' };
  }
  if (account.consumerFoodOfferEvidence === true || account.foodOfferSamples?.some(hasConsumerFoodOffer)) {
    return { allowed: true, reason: 'consumer-food-offer' };
  }
  if (account.foodOfferSamples?.some(foodIdentity)) return { allowed: true, reason: 'food-source-product-evidence' };
  return { allowed: false, reason: 'no-food-source-evidence' };
}

export function selectInstagramFoodAccounts(accounts) {
  const selected = [], excluded = [];
  for (const account of accounts) {
    const decision = instagramFoodSourceDecision(account);
    if (decision.allowed) selected.push({ ...account, foodDiscoveryEligible: true, foodSourceReason: decision.reason });
    else excluded.push({ username: account.username, reason: decision.reason });
  }
  return { accounts: selected, excluded };
}

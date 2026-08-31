const CREATOR_USERNAMES = new Set([
  'lisa.maria.b',
  'shaysfoodblog',
  'foodiewien',
  'tastyfood.vienna',
  'eatinvienna_',
  'viennaeats',
  'viennafoodstories',
  'viennarestaurants',
  'viennawurstelstand',
  'kseniainvienna',
]);

const PLATFORM_USERNAMES = new Set([
  'vorteilsclub.wien',
  'wolt.oesterreich',
  'foodora.at',
  'lieferando.at',
]);

const CREATOR_USERNAME_PATTERN = /(?:foodie|foodblog|blogger|stories|wientipps|viennatips|insider|guide|entdeckt|discover|eats$)/i;
const MERCHANT_USERNAME_PATTERN = /(?:restaurant|cafe|coffee|burger|pizza|sushi|ramen|kebab|kebap|doener|döner|grill|bakery|bar\b|bistro|brunch|gelato|kitchen|wirt|gasthaus|foodtruck|eyewear|fitness|studio|experience|town|shop|store|market|hotel|salon|spa(?:[._]|$)|museum|theat(?:er|re)|cinema)/i;
const BARE_HANDLE_STOPWORDS = new Set([
  'angebot', 'angebote', 'aktion', 'anzeige', 'app', 'austria', 'bei', 'code', 'deal', 'deals',
  'der', 'die', 'das', 'dem', 'den', 'dies', 'diese', 'diesem', 'diesen', 'dieser', 'dieses',
  'ein', 'eine', 'einem', 'einer', 'essen', 'food', 'from', 'gratis', 'heute', 'instagram',
  'jegliche', 'jeglichem', 'jeglichen', 'jeglicher', 'mit', 'neu', 'new', 'nur', 'rabatt',
  'the', 'und', 'unserem', 'unseren', 'unserer', 'vienna', 'von', 'wien', 'www',
]);

function cleanText(value, max = 4000) {
  return String(value || '').replace(/\s+/g, ' ').trim().slice(0, max);
}

export function normalizeInstagramUsername(value) {
  const username = cleanText(value, 100).replace(/^@/, '').toLowerCase();
  return /^[a-z0-9._]{1,30}$/i.test(username) ? username : '';
}

export function instagramUsernameDisplayName(value) {
  const username = normalizeInstagramUsername(value);
  if (!username) return '';
  return username
    .replace(/official$/i, '')
    .replace(/\.(?:wien|vienna|at)$/i, '')
    .replace(/([a-z0-9])((?:sushi|burger|pizza|cafe|coffee|restaurant|kebab|grill|bakery|bistro|bar))$/i, '$1 $2')
    .replace(/\b(\d+)(st|nd|rd|th)([a-z])/i, '$1$2 $3')
    .replace(/[._-]+/g, ' ')
    .replace(/\b\w/g, (character) => character.toUpperCase())
    .trim();
}

export function inferInstagramAccountRole(account = {}) {
  const username = normalizeInstagramUsername(account.username || account.ownerUsername || account.handle || account);
  const explicit = cleanText(
    account.accountType || account.ownerRole || account.sourceAccountType || account.kind || account.type,
    40,
  ).toLowerCase();
  const category = cleanText(account.category, 60).toLowerCase();
  if (category === 'discovery') return 'discovery';
  if (['delivery', 'platform', 'media'].includes(category)) return 'platform';
  if (CREATOR_USERNAMES.has(username) && (!explicit || explicit === 'merchant' || explicit === 'unknown')) return 'creator';
  if (PLATFORM_USERNAMES.has(username) && (!explicit || explicit === 'merchant' || explicit === 'unknown')) return 'platform';
  if (['merchant', 'creator', 'discovery', 'platform'].includes(explicit)) return explicit;
  const note = cleanText(account.note || account.watchlistNote, 300);
  if (CREATOR_USERNAME_PATTERN.test(username) || /(?:creator|blogger|discovery|scout)/i.test(note)) return 'creator';
  if (MERCHANT_USERNAME_PATTERN.test(username) || ['food', 'drinks', 'kaffee', 'essen'].includes(category)) return 'merchant';
  return 'unknown';
}

export function extractInstagramMentionUsernames(value) {
  const text = cleanText(value, 10000);
  const usernames = new Set();
  for (const match of text.matchAll(/(^|[^a-z0-9._])@([a-z0-9._]{2,30})\b/gi)) {
    const username = normalizeInstagramUsername(match[2]);
    if (!username || ['instagram', 'freefinder', 'freefinderwien'].includes(username)) continue;
    usernames.add(username);
    if (usernames.size >= 12) break;
  }
  return [...usernames];
}

function plausibleBareMerchantUsername(value) {
  const username = normalizeInstagramUsername(value);
  if (username.length < 4 || BARE_HANDLE_STOPWORDS.has(username)) return '';
  if ((username.match(/[a-z]/g) || []).length < 2) return '';
  if (/^(?:https?|instagram|facebook|tiktok|youtu|www\d*)$/i.test(username)) return '';
  return username;
}

function captionContainsUsername(caption, username) {
  const escaped = username.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(?:^|[^a-z0-9._])@?${escaped}(?=$|[^a-z0-9._])`, 'i').test(caption);
}

export function extractInstagramBareMerchantUsernames(value, roleIndex = new Map()) {
  const caption = cleanText(value, 10000);
  const usernames = new Set();
  const add = (valueToAdd) => {
    const username = plausibleBareMerchantUsername(valueToAdd);
    if (username) usernames.add(username);
  };

  for (const username of roleIndex instanceof Map ? roleIndex.keys() : []) {
    if (captionContainsUsername(caption, username)) add(username);
  }

  const relationPattern = /\b(?:bei|at|from|von|mit|by|für|fuer|through|via)\s+(?:(?:der|dem|den|einem|einer|the)\s+)?@?([a-z0-9][a-z0-9._]{2,29})(?![a-z0-9._äöüß])/gi;
  for (const match of caption.matchAll(relationPattern)) {
    const rawUsername = match[1];
    const username = plausibleBareMerchantUsername(rawUsername);
    if (!username) continue;
    const known = roleIndex instanceof Map && roleIndex.has(username);
    const handleShaped = /[._]/.test(username)
      || MERCHANT_USERNAME_PATTERN.test(username)
      || /(?:wien|vienna|austria|official)$/.test(username);
    if (known || handleShaped) usernames.add(username);
  }

  const standalonePattern = /(?:^|[\s:|\-–—])@?([a-z0-9][a-z0-9._]{2,29})(?![a-z0-9._äöüß])(?=\s*(?:📍|#|\*(?:anzeige|einladung)|$))/gi;
  for (const match of caption.matchAll(standalonePattern)) {
    const username = plausibleBareMerchantUsername(match[1]);
    if (!username) continue;
    const known = roleIndex instanceof Map && roleIndex.has(username);
    const handleShaped = /[._]/.test(username)
      || MERCHANT_USERNAME_PATTERN.test(username)
      || /(?:wien|vienna|austria|official)$/.test(username);
    if (known || handleShaped) usernames.add(username);
  }

  return [...usernames].slice(0, 12);
}

export function buildInstagramRoleIndex(accounts = []) {
  const index = new Map();
  for (const account of Array.isArray(accounts) ? accounts : []) {
    const username = normalizeInstagramUsername(account?.username);
    if (!username) continue;
    const role = inferInstagramAccountRole(account);
    const previous = index.get(username) || {};
    index.set(username, {
      ...previous,
      ...account,
      username,
      accountType: previous.accountType && previous.accountType !== 'unknown'
        ? previous.accountType
        : role,
      viennaVerified: previous.viennaVerified === true
        || account?.viennaVerified === true
        || account?.verifiedVienna === true,
    });
  }
  return index;
}

function merchantCandidateScore(username, account, caption, ownerUsername) {
  if (!plausibleBareMerchantUsername(username) || username === ownerUsername) return Number.NEGATIVE_INFINITY;
  const role = inferInstagramAccountRole(account || { username });
  if (['creator', 'discovery', 'platform'].includes(role)) return Number.NEGATIVE_INFINITY;
  let score = 0;
  if (role === 'merchant') score += 70;
  if (account?.viennaVerified === true || account?.verifiedVienna === true) score += 60;
  if (MERCHANT_USERNAME_PATTERN.test(username)) score += 35;
  if (/(?:[._](?:wien|vienna|at)|(?:wien|vienna|austria|official))$/.test(username)) score += 15;
  const escaped = username.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  if (new RegExp(`(?:bei|at|from|mit|von|by|x)\\s+(?:(?:der|dem|den|einem|einer|the)\\s+)?@?${escaped}\\b`, 'i').test(caption)) score += 25;
  if (new RegExp(`@${escaped}\\b[^@:\\n]{0,30}:`, 'i').test(caption)) score += 20;
  return score;
}

export function resolveInstagramPostEntities(input = {}) {
  const ownerUsername = normalizeInstagramUsername(input.ownerUsername || input.username || input.account?.username);
  const roleIndex = input.roleIndex instanceof Map
    ? input.roleIndex
    : buildInstagramRoleIndex(input.accounts || []);
  const ownerAccount = roleIndex.get(ownerUsername) || input.account || { username: ownerUsername };
  const ownerRole = inferInstagramAccountRole(ownerAccount);
  const caption = cleanText(input.caption || input.text || input.description, 10000);
  const mentionedUsernames = extractInstagramMentionUsernames(caption)
    .filter((username) => username !== ownerUsername);
  const bareMerchantUsernames = extractInstagramBareMerchantUsernames(caption, roleIndex)
    .filter((username) => username !== ownerUsername && !mentionedUsernames.includes(username));
  const candidateUsernames = [...new Set([...mentionedUsernames, ...bareMerchantUsernames])];
  const rankedMentions = candidateUsernames
    .map((username) => ({
      username,
      account: roleIndex.get(username) || null,
      score: merchantCandidateScore(username, roleIndex.get(username), caption, ownerUsername),
    }))
    .filter((candidate) => Number.isFinite(candidate.score) && candidate.score > 0)
    .sort((left, right) => right.score - left.score || left.username.localeCompare(right.username));

  const ownerIsScout = ['creator', 'discovery', 'platform'].includes(ownerRole);
  const resolvedMention = rankedMentions[0] || null;
  const merchantUsername = ownerRole === 'merchant'
    ? ownerUsername
    : (resolvedMention?.username || '');
  const scoutUsername = ownerIsScout ? ownerUsername : '';
  const method = ownerRole === 'merchant'
    ? 'owner-is-merchant'
    : (resolvedMention ? 'caption-mention' : (ownerIsScout ? 'unresolved-scout-post' : 'unresolved-owner'));

  return {
    ownerUsername,
    ownerRole,
    scoutUsername,
    merchantUsername,
    merchantRole: merchantUsername ? 'merchant' : '',
    resolutionMethod: method,
    merchantCandidates: rankedMentions.slice(0, 5).map((candidate) => ({
      username: candidate.username,
      score: candidate.score,
      viennaVerified: candidate.account?.viennaVerified === true || candidate.account?.verifiedVienna === true,
    })),
    mentionedUsernames,
    bareMerchantUsernames,
  };
}

export function isInstagramScoutRole(value) {
  return ['creator', 'discovery', 'platform'].includes(cleanText(value, 40).toLowerCase());
}

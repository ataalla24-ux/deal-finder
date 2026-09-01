import { GASTRO_DISCOVERY_BASE_PROMPT } from './firecrawl-gastro-discovery-policy.js';

const MS_PER_DAY = 24 * 60 * 60 * 1000;

const hashtagTarget = (hashtag) => ({
  id: `hashtag:${hashtag}`,
  kind: 'instagram-hashtag',
  label: `#${hashtag}`,
  url: `https://www.instagram.com/explore/tags/${encodeURIComponent(hashtag)}/`,
});

const accountTarget = (account) => ({
  id: `account:${account}`,
  kind: 'instagram-account',
  label: `@${account}`,
  url: `https://www.instagram.com/${account}/`,
});

const DAILY_HASHTAGS = [
  'kostenlosessenwien',
  'fooddealwien',
  'gastroaktionwien',
].map(hashtagTarget);

export const ROTATING_HASHTAG_TARGETS = [
  'viennafood', 'viennafoodie', 'viennarestaurant', 'restaurantvienna',
  'allyoucaneatvienna', 'kostenloswien', 'wiengratis', 'gratisessenwien',
  'angebotwien', 'angebotewien', 'wienangebot', 'dealswien', 'wienerdeals',
  'rabattwien', 'wienrabatt', 'sparenwien', 'fooddealsvienna',
  'freefoodvienna', 'viennadeals', 'viennaoffers', 'viennafreebies',
  'happyhourwien', 'lunchdealwien', 'neueröffnungwien', 'eröffnungwien',
].map(hashtagTarget);

const DAILY_ACCOUNTS = [
  'tastyfood.vienna',
].map(accountTarget);

export const ROTATING_ACCOUNT_TARGETS = [
  'foodiewien', 'eatinvienna_', 'viennaeats', 'viennafoodstories',
  'viennarestaurants', 'zushimarket', 'ciosgrill', 'corner_xvi',
  'tokki_korean_bbq', 'sajado.bbq', 'mosquito_mexican',
].map(accountTarget);

export const WEB_TARGETS = [
  {
    id: 'web:gutschein-at-food',
    kind: 'web-deal-list',
    label: 'Gutschein.at Essen & Trinken',
    url: 'https://www.gutschein.at/essen-trinken',
  },
  {
    id: 'web:preisjaeger-food',
    kind: 'web-deal-list',
    label: 'Preisjäger Lebensmittel & Gastro',
    url: 'https://www.preisjaeger.at/gruppe/lebensmittel',
  },
];

export const GASTRO2_BASE_PROMPT = GASTRO_DISCOVERY_BASE_PROMPT;

function rotatingWindow(items, count, dayNumber, offset = 0) {
  if (items.length === 0 || count <= 0) return [];
  const start = ((dayNumber * count) + offset) % items.length;
  return Array.from({ length: Math.min(count, items.length) }, (_, index) => (
    items[(start + index) % items.length]
  ));
}

export function selectScrapeTargets(date = new Date()) {
  const dayNumber = Math.floor(date.getTime() / MS_PER_DAY);
  return [
    ...DAILY_HASHTAGS,
    ...rotatingWindow(ROTATING_HASHTAG_TARGETS, 2, dayNumber),
    ...DAILY_ACCOUNTS,
    ...rotatingWindow(ROTATING_ACCOUNT_TARGETS, 2, dayNumber, 3),
    ...WEB_TARGETS,
  ];
}

export function buildTargetPrompt(target) {
  let targetInstruction = '';

  if (target.kind === 'instagram-hashtag') {
    targetInstruction = 'Untersuche ausschließlich konkrete Originalposts, die auf der angegebenen Hashtag-Seite sichtbar oder verlinkt sind. Ignoriere für diesen Durchlauf die allgemeine Web-Ergänzung aus dem Basisauftrag.';
  } else if (target.kind === 'instagram-account') {
    targetInstruction = 'Untersuche ausschließlich konkrete Originalposts dieses Instagram-Kontos. Ignoriere für diesen Durchlauf die allgemeine Web-Ergänzung aus dem Basisauftrag.';
  } else {
    targetInstruction = 'Beginne auf der angegebenen Deal-Sammelseite. Erfasse jede unterschiedliche aktuelle Aktion als eigenen Deal und verwende nach Möglichkeit die direkte Detailseite der Aktion.';
  }

  return `${GASTRO2_BASE_PROMPT}

Startziel dieses Durchlaufs: ${target.label}
Start-URL: ${target.url}
${targetInstruction}

Bei Instagram muss post_url zwingend direkt zum konkreten Originalpost führen und das Format instagram.com/p/... oder instagram.com/reel/... haben. Niemals Profil-, Kanal-, Hashtag- oder Explore-URLs als post_url ausgeben. Wenn kein konkreter Originalpost auffindbar ist, den Fund weglassen.`;
}

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
    id: 'web:gastro-news-deals',
    kind: 'web-deal-list',
    label: 'Gastro.News Restaurant Deals',
    url: 'https://gastro.news/die-besten-restaurant-deals/',
  },
  {
    id: 'web:thefork-vienna-offers',
    kind: 'web-deal-list',
    label: 'TheFork Wien Angebote',
    url: 'https://www.thefork.at/restaurants/wien-c597321/angebote',
  },
];

export const GASTRO2_BASE_PROMPT = `Extrahiere aktuelle und zukünftige Deals in Wien mit höchster Priorität auf Gastronomie-Angebote (Essen & Trinken).

Suche gezielt nach:
- Starken Rabatten wie Mahlzeiten unter €3
- Mindestens 50% Preisnachlass (z.B. 1,99€ Döner, 1+1 Aktionen)
- Kostenlose Freebies
- Neueröffnungen mit Gratis-Aktionen
- Starke Rabatte allgemein

Suche primär auf Instagram nach den ersten 50-100 Deals und ergänze diese durch Funde aus dem restlichen Web (z.B. 1000things, meinbezirk.at).

Erfasse für jeden Deal:
  – Den genauen Namen des Restaurants/Geschäfts/Unternehmens (brand_or_store – NICHT die Website-Domain!)
- Kategorie
- Was genau verschenkt/rabattiert wird
- Den Standort
- Datum und Uhrzeit der Gültigkeit
- Die direkte URL zum ursprünglichen Post oder Web-Beitrag
- Bei Instagram: den echten Account-Handle und das Veröffentlichungsdatum des Original-Posts.

Wichtig: Das Veröffentlichungsdatum des Posts und die Gültigkeit des Angebots sind zwei verschiedene Felder.`;

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
    targetInstruction = 'Beginne auf der angegebenen Hashtag-Seite und untersuche konkrete Originalposts. Nutze das restliche Web ergänzend wie im Basisauftrag beschrieben.';
  } else if (target.kind === 'instagram-account') {
    targetInstruction = 'Beginne beim angegebenen Instagram-Konto und untersuche dessen konkrete Originalposts. Nutze das restliche Web ergänzend wie im Basisauftrag beschrieben.';
  } else {
    targetInstruction = 'Beginne auf der angegebenen Deal-Sammelseite. Erfasse jede unterschiedliche aktuelle Aktion als eigenen Deal und verwende nach Möglichkeit die direkte Detailseite der Aktion.';
  }

  return `${GASTRO2_BASE_PROMPT}

Startziel dieses Durchlaufs: ${target.label}
Start-URL: ${target.url}
${targetInstruction}

Bei Instagram muss post_url zwingend direkt zum konkreten Originalpost führen und das Format instagram.com/p/... oder instagram.com/reel/... haben. Niemals Profil-, Kanal-, Hashtag- oder Explore-URLs als post_url ausgeben. Wenn kein konkreter Originalpost auffindbar ist, den Fund weglassen.`;
}

const EXCLUDED_HOSTS = [
  ['DieRestaurantWoche', /(^|\.)dierestaurantwoche\.at$/i],
  ['NeoTaste', /(^|\.)neotaste\.com$/i],
  ['TheFork', /(^|\.)thefork\.(?:at|com)$/i],
  ['gastro.news', /(^|\.)gastro\.news$/i],
  ['1000things', /(^|\.)1000things(?:magazine)?\.(?:at|com)$/i],
  ['Tripadvisor', /(^|\.)tripadvisor\.[a-z.]+$/i],
  ['Yelp', /(^|\.)yelp\.[a-z.]+$/i],
];

const EXCLUDED_TEXT = [
  ['DieRestaurantWoche', /\b(?:die\s*)?restaurantwoche\b|\bculinarius\s+restaurant\s+week\b/i],
  ['NeoTaste', /\bneotaste\b/i],
  ['TheFork', /\bthe\s*fork\b/i],
  ['gastro.news', /\bgastro\s*\.\s*news\b|\bgastro\s+news\b/i],
  ['1000things', /\b1000things(?:magazine)?\b/i],
  ['Tripadvisor', /\btripadvisor\b/i],
  ['Yelp', /\byelp\b/i],
];

export const GASTRO_DISCOVERY_BASE_PROMPT = `Extrahiere aktuelle und zukünftige Deals in Wien mit höchster Priorität auf Gastronomie-Angebote (Essen & Trinken).

Suche gezielt nach:
- Starken Rabatten wie Mahlzeiten unter €3
- Mindestens 50% Preisnachlass (z.B. 1,99€ Döner, 1+1 Aktionen)
- Kostenlose Freebies
- Neueröffnungen mit Gratis-Aktionen
- Starke Rabatte allgemein

Suche primär auf Instagram nach den ersten 50-100 Deals und ergänze diese durch Funde aus dem restlichen Web, insbesondere Gutschein.at, Preisjaeger.at, Marktguru, Sparhamster, Wolt, Lieferando sowie direkte Restaurant- und Markenwebseiten.

Erfasse für jeden Deal:
- Den genauen Namen des Restaurants/Geschäfts/Unternehmens (brand_or_store - NICHT die Website-Domain!)
- Kategorie
- Was genau verschenkt/rabattiert wird
- Den Standort
- Datum und Uhrzeit der Gültigkeit
- Die direkte URL zum ursprünglichen Post oder Web-Beitrag
- Bei Instagram: den echten Account-Handle und das Veröffentlichungsdatum des Original-Posts.

Wichtig: Das Veröffentlichungsdatum des Posts und die Gültigkeit des Angebots sind zwei verschiedene Felder. Gib Jahreszahlen vollständig an. Nimm nur noch laufende oder zukünftige, konkret nutzbare Vorteile auf. Gewinnspiele, reine Empfehlungen, Gratis-Versand und bloße Hinweise ohne Preisvorteil weglassen. Bei Instagram muss die URL direkt auf /p/... oder /reel/... zeigen. Erfinde keine Datumsangaben.

Nicht verwenden, weil diese Quellen später blockiert werden: DieRestaurantWoche, NeoTaste, TheFork, gastro.news, 1000things, Tripadvisor und Yelp. Nenne möglichst viele unterschiedliche Originalquellen und höchstens fünf Deals pro Domain.`;

export function getExcludedGastroDiscoverySource(candidate = {}, url = '') {
  let host = '';
  try {
    host = new URL(url).hostname.replace(/^www\./, '');
  } catch {
    host = '';
  }

  for (const [label, pattern] of EXCLUDED_HOSTS) {
    if (pattern.test(host)) return label;
  }

  const text = [
    candidate.brand_or_store,
    candidate.brand,
    candidate.item_given_away,
    candidate.title,
    candidate.description,
    url,
  ].filter(Boolean).join(' ');
  for (const [label, pattern] of EXCLUDED_TEXT) {
    if (pattern.test(text)) return label;
  }

  return '';
}

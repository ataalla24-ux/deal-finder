// Official merchant pages only. A catalog entry is a discovery target, not
// proof that every promotion on the domain applies in Vienna.
export const POWER_FOOD_SOURCES = [
  {
    name: 'Lets be Frank',
    brand: "Let's be Frank",
    url: 'https://letsbefrank.at/specials/',
    allowedHosts: ['letsbefrank.at'],
    selector: '.lbf-content-text-block',
    address: 'Haidmannsgasse 8, 1150 Wien',
    locationEvidenceUrl: 'https://letsbefrank.at/contact/',
    linkPattern: /\/specials\//,
    category: 'essen',
  },
  {
    name: 'Mussty',
    url: 'https://www.mussty.at/spezialangebot/',
    allowedHosts: ['www.mussty.at', 'mussty.at'],
    selector: '.elementor-top-column > .elementor-widget-wrap:has(.elementor-inner-section h2):has(.elementor-inner-section h3)',
    offerContextSelector: '.elementor-element-2d78f329 h2',
    offerContextPattern: /^MITTAGS\s+ANGEBOTE!?$/i,
    currentOffers: true,
    address: 'Favoritenstraße 133, 1100 Wien',
    locationEvidenceUrl: 'https://www.mussty.at/spezialangebot/',
    pathPrefix: '/spezialangebot/',
    linkPattern: /\/spezialangebot\//,
    category: 'essen',
  },
  {
    name: 'Gasthaus Maria',
    url: 'https://www.gasthaus-maria.at/',
    allowedHosts: ['www.gasthaus-maria.at', 'gasthaus-maria.at'],
    selector: '#m3402',
    titleSelector: 'p:first-child',
    address: 'Wolfganggasse 16, 1120 Wien',
    locationEvidenceUrl: 'https://www.gasthaus-maria.at/',
    linkPattern: /aktion|angebot/i,
    category: 'essen',
  },
  {
    name: 'Salieri',
    url: 'https://www.salieri.at/',
    allowedHosts: ['www.salieri.at', 'salieri.at'],
    selector: '.e-con:has(> .elementor-widget-price-list)',
    address: 'Seilerstätte 17, 1010 Wien',
    locationEvidenceUrl: 'https://www.salieri.at/',
    linkPattern: /aktion|angebot|mittagsmenu/i,
    category: 'essen',
  },
  {
    name: 'Weltcafe',
    brand: 'WeltCafé',
    url: 'https://weltcafe.at/',
    allowedHosts: ['weltcafe.at', 'www.weltcafe.at'],
    // Two adjacent heading widgets form one coffee offer, separate from the
    // preceding alcoholic happy hour. Both widgets must still be present.
    adjacentOfferSelector: '.elementor-widget-heading:has(h1:contains("Tägliches Angebot: KAFFEE UND KUCHEN"))',
    address: 'Schwarzspanierstraße 15, 1090 Wien',
    locationEvidenceUrl: 'https://weltcafe.at/',
    linkPattern: /aktion|angebot/i,
    category: 'kaffee',
  },
  {
    name: 'Cafe Hummel',
    brand: 'Cafe Hummel',
    url: 'https://cafehummel.at/',
    allowedHosts: ['cafehummel.at', 'www.cafehummel.at'],
    selector: '.x-card-outer',
    address: 'Josefstädter Straße 66, 1080 Wien',
    locationEvidenceUrl: 'https://cafehummel.at/',
    linkPattern: /\/aktionen\//,
    category: 'kaffee',
  },
  {
    name: 'Wunderkammer Wien',
    brand: 'Wunderkammer',
    url: 'https://www.marriott.com/de/hotels/viehw-renaissance-vienna-schonbrunn-hotel/dining/wunderkammer-restaurant/',
    allowedHosts: ['www.marriott.com'],
    selector: '.cd-cl__heading',
    address: 'Ullmannstraße 71, 1150 Wien',
    locationEvidenceUrl: 'https://www.marriott.com/de/hotels/viehw-renaissance-vienna-schonbrunn-hotel/overview/',
    pathPrefix: '/de/hotels/viehw-renaissance-vienna-schonbrunn-hotel/dining/',
    linkPattern: /\/dining\/wunderkammer-restaurant\//,
    category: 'trinken',
  },
  {
    name: "IKEA Food",
    brand: "IKEA",
    url: "https://www.ikea.com/at/de/food/",
    category: "essen",
    selector: '[class*="legal__accordion__item__text__"]:has(> h2)',
    linkPattern: /\/at\/de\/food\//,
    allowedHosts: ["www.ikea.com"],
    pathPrefix: "/at/de/food/",
    currentOffers: true,
  },
  {
    name: "Ströck",
    url: "https://stroeck.at/",
    category: "essen",
    selector: "a.post-type-pa",
    currentOffers: true,
    branchEvidenceUrl: "https://stroeck.at/faq/",
    linkPattern: /\/neuigkeiten\/(?!aktion\/$)[^/]*(?:aktion|jause)/,
    allowedHosts: ["stroeck.at", "www.stroeck.at"],
  },
  {
    name: "Der Mann",
    brand: "DerMann",
    url: "https://www.dermann.at/",
    seeds: ["https://l.dermann.at/rabattmarkerl/"],
    category: "essen",
    allowedHosts: ["www.dermann.at", "dermann.at", "l.dermann.at"],
    linkPattern: /rabatt|aktion|angebot/i,
    singleOfferPattern: /\/rabattmarkerl\//,
  },
  {
    name: "ANKER",
    url: "https://www.ankerbrot.at/aktionen",
    category: "essen",
    selector: ".uk-card",
    currentOffers: true,
    branchEvidenceUrl: "https://www.ankerbrot.at/filialen",
    allowedHosts: ["www.ankerbrot.at", "ankerbrot.at"],
    linkPattern: /\/angebot\//,
  },
  {
    name: "Vapiano",
    url: "https://www.vapiano.at/news/",
    category: "essen",
    allowedHosts: ["www.vapiano.at", "vapiano.at"],
    linkPattern: /happy-hour|pasta-tag|angebot|aktion/i,
    singleOfferPattern: /happy-hour|pasta-tag/,
  },
  {
    name: "Bäckerei Schwarz",
    url: "https://www.bswien.at/aktionen",
    category: "essen",
    selector: ".wixui-repeater__item",
    allowedHosts: ["www.bswien.at"],
    address: "Wiegelestraße 34, 1230 Wien",
    locationEvidenceUrl: "https://www.bswien.at/aktionen",
    linkPattern: /\/aktionen/,
  },
  {
    name: "NORDSEE",
    couponMedia: 'nordsee-at-v1',
    url: "https://www.nordsee.com/at/coupons",
    category: "essen",
    allowedHosts: ["www.nordsee.com"],
    pathPrefix: "/at/",
    linkPattern: /\/at\/coupons\//,
  },
  {
    name: "McDonald's",
    url: "https://www.mcdonalds.at/mymcdonalds",
    selector: ".column_attr:has(h2)",
    category: "essen",
    allowedHosts: ["www.mcdonalds.at"],
    linkPattern: /aktion|deal|coupon/i,
  },
  {
    name: "Burger King",
    url: "https://www.burgerking.at/de/bkapp",
    category: "essen",
    allowedHosts: ["www.burgerking.at"],
    linkPattern: /coupon|angebot|deal/i,
    render: true,
  },
  {
    name: "KFC",
    url: "https://kfc.co.at/",
    category: "essen",
    allowedHosts: ["www.kfc.co.at", "kfc.co.at"],
    imageOfferSelector: "main > section img[alt]",
    linkPattern: /coupon|angebot|deal|aktion/i,
  },
  {
    name: "BackWerk",
    url: "https://back-werk.at/de/aktuell",
    category: "essen",
    allowedHosts: ["www.back-werk.at", "back-werk.at"],
    // The archive also contains generic product news and non-Vienna openings.
    linkPattern: /\/de\/aktuell\/[^/?]*(?:aktion|angebot|rabatt|coupon|gutschein|snackbox|deal)/i,
    providerPagePattern: /\/de\/aktuell\/[^/?]*(?:aktion|angebot|rabatt|coupon|gutschein|snackbox|deal)/i,
    singleOfferPattern: /\/de\/aktuell\/[^/?]*(?:aktion|angebot|rabatt|coupon|gutschein|snackbox|deal)/i,
  },
  {
    name: "Shibuya",
    url: "https://www.shibuya.at/",
    category: "trinken",
    allowedHosts: ["www.shibuya.at", "shibuya.at"],
    address: "Bürgerspitalgasse 29, 1060 Wien",
    locationEvidenceUrl: "https://www.shibuya.at/",
    linkPattern: /happy|special/i,
  },
  {
    name: "Santos",
    url: "https://www.santos-bar.com/en/dirty-drinks/behind-the-scenes.html",
    category: "trinken",
    selector: "section.flag-hero",
    allowedHosts: ["www.santos-bar.com"],
    linkPattern: /happy-hour/i,
  },
  {
    name: "Bùi Viện Street",
    url: "https://buivien-restaurant.at/",
    category: "trinken",
    allowedHosts: ["buivien-restaurant.at"],
    address: "Hörnesgasse 17, 1030 Wien",
    locationEvidenceUrl: "https://buivien-restaurant.at/",
    linkPattern: /happy|angebot/i,
  },
  {
    name: "Eva & Adam",
    url: "https://evaundadam.bar/",
    category: "trinken",
    allowedHosts: ["evaundadam.bar"],
    linkPattern: /happy-hour/i,
  },
  {
    name: "Cuadro",
    url: "https://cuadro.at/",
    category: "trinken",
    allowedHosts: ["cuadro.at"],
    address: "Margaretenstraße 77, 1050 Wien",
    locationEvidenceUrl: "https://cuadro.at/",
    linkPattern: /happy|aktion/i,
  },
  {
    name: "MABEL'S No90",
    url: "https://mabels.at/",
    category: "trinken",
    allowedHosts: ["mabels.at"],
    linkPattern: /happy|cocktail/i,
  },
];

export function isAllowedFoodUrl(value, source) {
  try {
    const u = new URL(value);
    return (
      u.protocol === "https:" &&
      !u.username &&
      !u.password &&
      !u.port &&
      source.allowedHosts.includes(u.hostname) &&
      (!source.pathPrefix || u.pathname.startsWith(source.pathPrefix)) &&
      !/(?:\.|\/)(?:pdf|jpe?g|png|webp|svg|mp4|zip)\/?$/i.test(u.pathname)
    );
  } catch {
    return false;
  }
}

// Multi-offer merchant pages need offer-level keys throughout the queue.
// Social-post and legacy collector deduplication remain unchanged.
export function officialFoodOfferKey(deal) {
  if (
    deal?.originSource !== "power-official-food" ||
    !/^power-food-[a-f0-9]{12}$/.test(deal.id || "")
  )
    return "";
  if (deal.evidence?.source !== "official-merchant-page") return "";
  const source = POWER_FOOD_SOURCES.find(
    (s) =>
      s.name === deal.evidence.merchantSourceKey &&
      isAllowedFoodUrl(deal.url, s),
  );
  return source ? `official-food:${source.name}|${deal.id}` : "";
}

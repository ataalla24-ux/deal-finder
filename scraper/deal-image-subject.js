import {createHash} from 'node:crypto';

const clean = value => String(value || '').replace(/\s+/g, ' ').trim();
const normalized = value => clean(value).normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/ß/g, 'ss');

// The allowlist contains owned, previously reviewed source images with at least
// 600 x 400 original pixels. New previews reuse these files without generation.
export const DEAL_IMAGE_ASSETS = [
  {
    "key": "kebab",
    "subject": "Döner im Fladenbrot"
  },
  {
    "key": "pizza",
    "subject": "Pizza Margherita"
  },
  {
    "key": "burger",
    "subject": "Burger"
  },
  {
    "key": "coffee",
    "subject": "Tasse Kaffee im Café"
  },
  {
    "key": "bowl",
    "subject": "Bunte Gemüse-Bowl"
  },
  {
    "key": "schnitzel",
    "subject": "Paniertes Schnitzel mit Zitrone"
  },
  {
    "key": "fish",
    "subject": "Fish and Chips"
  },
  {
    "key": "groceries",
    "subject": "Frisches Obst, Gemüse und Brot"
  },
  {
    "key": "fashion",
    "subject": "Kleidung und Schuhe"
  },
  {
    "key": "furniture",
    "subject": "Teppich im Wohnzimmer"
  },
  {
    "key": "cinema",
    "subject": "Kinosaal mit Popcorn"
  },
  {
    "key": "gift",
    "subject": "Geschenkbox mit Schleife"
  },
  {
    "key": "restaurant",
    "subject": "Gedeckter Restauranttisch"
  },
  {
    "key": "pizza-alternative",
    "subject": "Pizza mit Tomaten und Käse"
  },
  {
    "key": "crispy-chicken",
    "subject": "Knuspriger Chicken-Burger"
  },
  {
    "key": "latte",
    "subject": "Tasse Kaffee im Café"
  },
  {
    "key": "breakfast",
    "subject": "Frühstück mit Semmel, Butter und Ei"
  },
  {
    "key": "asian-restaurant",
    "subject": "Gedeckter Restauranttisch"
  },
  {
    "key": "indian-restaurant",
    "subject": "Gedeckter Restauranttisch"
  },
  {
    "key": "takeaway",
    "subject": "Unbeschriftete Essensboxen und Liefertasche"
  },
  {
    "key": "delivery",
    "subject": "Unbeschriftete Liefertasche und geschlossene Essensboxen"
  },
  {
    "key": "carwash",
    "subject": "Autowäsche mit Schaum"
  },
  {
    "key": "mattress",
    "subject": "Bett mit Matratze"
  },
  {
    "key": "riesenrad",
    "subject": "Riesenrad mit roten Kabinen"
  },
  {
    "key": "museum",
    "subject": "Ausstellungsraum mit Landschafts- und Blumenbildern"
  },
  {
    "key": "thermal",
    "subject": "Thermalbecken"
  },
  {
    "key": "cafe-breakfast",
    "subject": "Kaffee und Croissant im Café"
  },
  {
    "key": "auto-parts",
    "subject": "Autoteile"
  },
  {
    "key": "ibiza",
    "subject": "Passagierflugzeug am Flughafen"
  },
  {
    "key": "clothes-alternative",
    "subject": "Kleidung und Einkaufstasche"
  },
  {
    "key": "smartphone",
    "subject": "Smartphone auf einem Schreibtisch"
  },
  {
    "key": "wrap",
    "subject": "Gefüllter Tortilla-Wrap"
  },
  {
    "key": "city",
    "subject": "Stadtspaziergang zwischen historischen Gebäuden"
  },
  {
    "key": "birthday",
    "subject": "Geburtstagskuchen mit Kerzen"
  },
  {
    "key": "vegan-hotdog",
    "subject": "Veganer Hotdog"
  },
  {
    "key": "tuna-wrap",
    "subject": "Tortilla-Wrap mit Thunfisch"
  },
  {
    "key": "vegetable-kebab",
    "subject": "Kebab mit gegrilltem Gemüse"
  },
  {
    "key": "biang-noodles",
    "subject": "Breite Biang-Biang-Nudeln in einer Schale"
  },
  {
    "key": "cigkofte-wrap",
    "subject": "Wrap mit Ciğköfte-Füllung und Gemüse"
  },
  {
    "key": "krapfen",
    "subject": "Krapfen mit Staubzucker auf einem Teller"
  },
  {
    "key": "nuggets",
    "subject": "Panierte Chicken Nuggets auf einem Teller"
  },
  {
    "key": "bubble-tea",
    "subject": "Bubble Tea mit Tapiokaperlen"
  },
  {
    "key": "tiramisu",
    "subject": "Tiramisu auf einem Dessertteller"
  },
  {
    "key": "indian-meal",
    "subject": "Indisches Curry mit Reis und Fladenbrot"
  },
  {
    "key": "restaurant-buffet",
    "subject": "Restaurantbuffet mit unterschiedlichen Speisen"
  },
  {
    "key": "family-lunch",
    "subject": "Gemeinsames Familienessen mit drei Tellern"
  },
  {
    "key": "balkan-brunch",
    "subject": "Balkan-Frühstück mit Pita und Eierspeise"
  },
  {
    "key": "noodle-box",
    "subject": "Nudelbox mit Huhn, Gemüse und Getränk"
  },
  {
    "key": "vegetable-noodles",
    "subject": "Nudeln mit Gemüse"
  },
  {
    "key": "steak-kebab",
    "subject": "Steak-Döner im Brot"
  },
  {
    "key": "double-smashburger",
    "subject": "Doppel-Smashburger"
  },
  {
    "key": "bakery-snacks",
    "subject": "Herzhafte belegte Backwaren"
  },
  {
    "key": "cherry-latte",
    "subject": "Kirsch-Latte mit Sahne"
  },
  {
    "key": "ube-coconut-latte",
    "subject": "Ube-Kokos-Latte"
  },
  {
    "key": "caramel-latte",
    "subject": "Karamell-Latte"
  }
];

const assetKeys = new Set(DEAL_IMAGE_ASSETS.map(asset => asset.key));

export function dealImageAssetKey(deal) {
  const title = normalized(deal?.title);
  const text = normalized(`${deal?.title || ''} ${deal?.description || ''}`);
  const category = normalized(deal?.category);
  const brand = normalized(deal?.brand);
  const vegetarian = /\b(?:vegan\w*|vegetar\w*|plant based|gemuse)\b/.test(text);
  if (category === 'fluge' || category === 'fluege' || category === 'flug' || deal?.flightDestination || /\b(?:hin und ruckflug|flug|fluge|flugtickets?)\b/.test(title)) return 'ibiza';
  if (/cherry.*latte|latte.*cherry/.test(title)) return 'cherry-latte';
  if (/(?:ube|coconut|kokos).*latte|latte.*(?:ube|coconut|kokos)/.test(title)) return 'ube-coconut-latte';
  if (/(?:caramel|karamell).*latte|latte.*(?:caramel|karamell)/.test(title)) return 'caramel-latte';
  if (/\b(?:kaffee|coffee)\b/.test(title) && /\bcroissants?\b/.test(title)) return 'cafe-breakfast';
  if (/\b(?:bubble[ -]?tea|boba)\b/.test(title)) return 'bubble-tea';
  if (/\b(?:matcha|tee|tea|kakao|heisse schokolade)\b/.test(title)) return 'restaurant';
  if (/\blatte\b/.test(title)) return 'latte';
  if (/\b(?:kaffee|coffee|espresso|cappuccino|melange|heissgetranke?)\b/.test(title)) return 'coffee';
  if (/\b(?:biang|biangbiang)\b/.test(title)) return 'biang-noodles';
  if (/\b(?:cigkofte|cig kofte)\b/.test(title)) return 'cigkofte-wrap';
  if (/\b(?:thunfisch|tuna)\b/.test(title) && /\bwraps?\b/.test(title)) return 'tuna-wrap';
  if (/\b(?:steak|steakfleisch)\b/.test(title) && /\b(?:doner|doener|kebab|kebap)\b/.test(title)) return 'steak-kebab';
  if (/\b(?:doner|doener|kebab|kebap)\b/.test(title)) return vegetarian ? 'vegetable-kebab' : 'kebab';
  if (/\b(?:hot[ -]?dog|hut[ -]?dog)\b/.test(title)) return /loving hut/.test(brand) || vegetarian ? 'vegan-hotdog' : 'restaurant';
  if (/\b(?:nudelbox|noodle[ -]?box)\b/.test(title)) return vegetarian ? 'vegetable-noodles' : 'noodle-box';
  if (/\b(?:nudeln|ramen|pasta)\b/.test(title)) return vegetarian ? 'vegetable-noodles' : 'restaurant';
  if (/\b(?:mcnuggets|chicken nuggets|nuggets)\b/.test(title)) return vegetarian ? 'restaurant' : 'nuggets';
  if (/\b(?:crispy chicken|chicken burger|chicken sandwich)\b/.test(title)) return vegetarian ? 'restaurant' : 'crispy-chicken';
  if (/\b(?:doppel[ -]?smashburger|double[ -]?smashburger)\b/.test(title)) return vegetarian ? 'restaurant' : 'double-smashburger';
  if (/\b(?:fish[ -]?burger|fisch[ -]?burger|fisch.*burger|fish.*burger)\b/.test(title)) return 'restaurant';
  if (/\b(?:burger|hamburger|cheeseburger|smashburger)\b/.test(title)) return vegetarian ? 'restaurant' : 'burger';
  if (/\b(?:pizza|pizzen)\b/.test(title)) return /\bmargherita\b/.test(title) && !/\b(?:salami|prosciutto|schinken|thunfisch|vegan\w*|pepperoni|diavola|calzone|funghi)\b/.test(text) ? 'pizza' : 'restaurant';
  if (/\b(?:balkan|pita|burek)\b/.test(title) && /\b(?:brunch|fruhstuck)\b/.test(title)) return 'balkan-brunch';
  if (/\b(?:brunch|fruhstuck|breakfast)\b/.test(title)) return 'breakfast';
  if (/\bschnitzel\b/.test(title)) return vegetarian ? 'restaurant' : 'schnitzel';
  if (/\b(?:bowls?|poke|salat)\b/.test(title)) return 'bowl';
  if (/\b(?:fish and chips|fisch|fish)\b/.test(title)) return 'fish';
  if (/\b(?:wraps?|durum|tortilla)\b/.test(title)) return 'wrap';
  if (/\b(?:krapfen|berliner)\b/.test(title)) return 'krapfen';
  if (/\btiramisu\b/.test(title)) return 'tiramisu';
  if (/\b(?:snacks?|baguettes?|semmel|geback|sandwich)\b/.test(title)) return 'bakery-snacks';
  if (/\b(?:curry|thali|indisch)\b/.test(title) || /ganesha/.test(brand)) return 'indian-meal';
  if (/\bbuffet\b/.test(title)) return 'restaurant-buffet';
  if (/\b(?:geburtstag|birthday)\b/.test(title)) return 'birthday';
  if (/\b(?:therme|thermalbad|schwimmbad)\b/.test(title)) return 'thermal';
  if (/\briesenrad\b/.test(title)) return 'riesenrad';
  if (/\b(?:museum|ausstellung|tussauds)\b/.test(title)) return 'museum';
  if (/\b(?:kino|kinotickets?|cinema)\b/.test(title)) return 'cinema';
  if (/\b(?:autowasche|topwash)\b/.test(text)) return 'carwash';
  if (/\b(?:autoteile|reifen|autozubehor)\b/.test(title)) return 'auto-parts';
  if (/\b(?:matratze|matratzen|bett)\b/.test(title)) return 'mattress';
  if (/\b(?:teppich|mobel|sofa|einrichtung)\b/.test(title)) return 'furniture';
  if (/\b(?:kleidung|fashion|mode|jeans|schuhe)\b/.test(title)) return 'fashion';
  if (/\b(?:handy|smartphone|mobilfunk)\b/.test(title)) return 'smartphone';
  if (category === 'kaffee') return 'coffee';
  if (category === 'essen' || category === 'food') return 'restaurant';
  if (/\b(?:lebensmittel|foodsharing|einkauf)\b/.test(title)) return 'groceries';
  if (category === 'freizeit' || /\b(?:stadtfuhrung|spaziergang|reise)\b/.test(title)) return 'city';
  if (category === 'shopping') return 'clothes-alternative';
  return 'gift';
}

export function dealImageSubjectHash(deal, assetKey = dealImageAssetKey(deal)) {
  if (!assetKeys.has(assetKey)) return '';
  return createHash('sha256').update(JSON.stringify(['approved-photo-product-v2',
    ...['id', 'url', 'brand', 'category'].map(field => clean(deal?.[field])), assetKey,
  ])).digest('hex');
}

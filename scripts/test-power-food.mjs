import assert from "node:assert/strict";
import {
  extractFoodOffers,
  discoverFoodLinks,
  extractFoodExpiry,
} from "../scraper/power-food-extraction.js";
import { crawlFoodSource } from "../scraper/power-food-crawler.js";
import {
  POWER_FOOD_SOURCES,
  isAllowedFoodUrl,
} from "../scraper/power-food-sources.js";
import {
  verifyOfficialFoodDeal,
  fetchOfficialFoodPage,
} from "../scraper/power-food-verification.js";
import { validateDealsForSlack } from "../scraper/deal-validity-agent.js";
import {
  dedupeApprovedDeals,
  normalizeApprovedDealExpiries,
} from "../scraper/slack-approve.js";
import {
  normalizeDeal,
  filterDuplicateDealsInRun,
  filterRecentlySeenDeals,
  addSeenDealsFromThread,
  mergePendingQueue,
} from "../scraper/slack-notify.js";
const now = new Date("2026-09-23T12:00:00Z");
const source = {
  name: "Test Cafe",
  url: "https://example.com/angebote",
  allowedHosts: ["example.com"],
  category: "kaffee",
  selector: ".offer",
  currentOffers: true,
  linkPattern: /angebote/,
};
const parse = (html, overrides = {}) =>
  extractFoodOffers(html, { ...source, ...overrides }, { now });
const card = (t) => `<article class="offer">${t}</article>`;
let out = parse(
  card(
    "<h2>Kaffeejause</h2><p>Kaffee und Kuchen um € 5,90. Nur in Wien. Ausgenommen Feiertage.</p>",
  ) +
    card(
      "<h2>Kaffeejause</h2><p>Kaffee und Strudel um € 5,90. Nur in Wien.</p>",
    ),
);
assert.equal(
  out.deals.length,
  2,
  "same heading, different bundles must survive",
);
assert.equal(new Set(out.deals.map((d) => d.id)).size, 2);
assert.match(out.deals[0].description, /Ausgenommen Feiertage/);
assert.equal(out.deals[0].pubDate, undefined, "discovery is not publication");
assert.equal(out.deals[0].evidence.locationScope, "offer-text");
for (const text of [
  "100 % Plant-Power Chicken",
  "82 % unserer Gäste trinken Kaffee",
  "glasweise ausgeschenkte Weine",
  "Kostenloses WLAN bei Kaffee",
  "Gratis Versand von Kaffee",
  "Happy Hour täglich 16–19 Uhr",
  "Burger 18,90 €",
  "Gewinne gratis Kaffee beim Gewinnspiel",
  "Kaffee gratis, nur in Graz",
  "Kaffee gratis, Wien ausgenommen",
]) {
  assert.equal(
    parse(card(`<h2>${text}</h2>`), { currentOffers: false }).deals.length,
    0,
    text,
  );
}
assert.equal(
  parse(card("<h2>Baguette 3+1 gratis in Wien</h2>")).deals[0].type,
  "bogo",
);
assert.equal(
  parse(card("<h2>Kaffee gratis in Wien</h2>")).deals[0].type,
  "gratis",
);
assert.equal(
  parse(card("<h2>Kaffee gratis bei Kauf eines Kuchens in Wien</h2>")).deals[0]
    .type,
  "rabatt",
);
assert.equal(
  parse(
    card(
      "<h2>Happy Hour Cocktails € 8,50</h2><p>Täglich 17–19 Uhr in Wien.</p>",
    ),
  ).deals.length,
  1,
);
assert.equal(
  parse(
    card(
      "<h2>Kaffee um € 2 statt € 4</h2><p>Gültig bis 22.9.2026 in Wien.</p>",
    ),
  ).deals.length,
  0,
);
assert.equal(
  extractFoodExpiry("vom 4.9.2026 bis 26.9.2026", now).validUntil,
  "2026-09-26",
);
assert.equal(
  extractFoodExpiry("gültig ab 4.9.2026 und bis auf Widerruf", now).validUntil,
  "",
);
assert.equal(
  extractFoodExpiry("gültig ab 4.9.2026 und bis auf Widerruf", now).validFrom,
  "2026-09-04",
);
assert.equal(
  extractFoodExpiry("Gültig 4.-25.9.2026", now).validUntil,
  "2026-09-25",
);
assert.equal(extractFoodExpiry("täglich bis 20:00 Uhr", now).validUntil, "");
assert.equal(extractFoodExpiry("gültig bis 31.2.2026", now).validUntil, "");
assert.equal(
  parse("<footer>" + card("<h2>Gratis Kaffee in Wien</h2>") + "</footer>").deals
    .length,
  0,
);
assert.equal(
  parse(
    '<div aria-hidden="true">' +
      card("<h2>Gratis Kaffee in Wien</h2>") +
      "</div>",
  ).deals.length,
  1,
  "collapsed terms are content",
);
assert.equal(
  isAllowedFoodUrl("https://example.com.evil.test/angebote", source),
  false,
);
assert.equal(isAllowedFoodUrl("http://example.com/angebote", source), false);
assert.equal(
  isAllowedFoodUrl("https://user:password@example.com/angebote", source),
  false,
);
assert.equal(
  isAllowedFoodUrl("https://example.com:3000/angebote", source),
  false,
);
assert.equal(
  discoverFoodLinks(
    '<a href="/angebote/a">Deal</a><a href="/angebote/a?utm_source=x">Again</a><a href="https://evil.test/angebote">Other</a><a href="/angebote/old.pdf">PDF</a>',
    source,
  ).length,
  1,
);
let calls = 0;
let result = await crawlFoodSource(source, {
  now,
  maxPages: 2,
  fetchPage: async (url) => {
    calls++;
    return {
      html:
        card("<h2>Gratis Kaffee in Wien</h2>") +
        '<a href="/angebote/a">Next</a><a href="/angebote/b">Next</a>',
      finalUrl: url,
    };
  },
});
assert.equal(calls, 2, "bounded crawl");
assert.equal(result.rows.length, 1, "cross-page duplicates");
calls = 0;
result = await crawlFoodSource(
  { ...source, seeds: ["https://example.com/angebote/a"] },
  {
    now,
    fetchPage: async () => {
      calls++;
      throw new Error("HTTP 429");
    },
  },
);
assert.equal(calls, 1);
assert.equal(result.operationalStatus, "rate-limited");
result = await crawlFoodSource(source, {
  now,
  fetchPage: async () => ({
    html: card("<h2>Gratis Kaffee Wien</h2>"),
    finalUrl: "https://evil.test/angebote",
  }),
});
assert.equal(result.rows.length, 0);
const ikea = POWER_FOOD_SOURCES.find((s) => s.name === "IKEA Food");
const ikeaHtml =
  '<div class="legal__accordion__item__text__test"><h2>Frühstück um nur € 1,-</h2><p>Angebot gültig ab 4.9.2026 und bis auf Widerruf, jeweils Freitag und Samstag in allen teilnehmenden Restaurants in Österreich.</p></div>';
const deal = extractFoodOffers(ikeaHtml, ikea, { now }).deals[0];
assert.ok(deal);
assert.equal(deal.validUntil, undefined);
const fetchPage = async () => ({ html: ikeaHtml, finalUrl: ikea.url });
assert.equal(
  (await verifyOfficialFoodDeal(deal, { now, fetchPage })).current,
  true,
);
assert.equal(
  (
    await verifyOfficialFoodDeal(
      { ...deal, description: "Gratis alles in Wien" },
      { now, fetchPage },
    )
  ).ok,
  false,
);
assert.equal(
  (
    await verifyOfficialFoodDeal(
      { ...deal, url: "https://evil.test/angebote" },
      { now, fetchPage },
    )
  ).ok,
  false,
);
const inspectDealUrlHealth = async () => ({
  status: 200,
  invalid: false,
  finalUrl: ikea.url,
  dateHints: {
    publicationDate: "2021-01-27T12:00:00Z",
    validUntil: "2020-01-01",
    targetDateEvidence: "explicit-phrase",
  },
  contentHints: {
    title: "IKEA Food",
    description: "Aktuelle Angebote in Österreich",
  },
});
const validation = await validateDealsForSlack([deal], {
  now,
  fetchOfficialFoodPage: fetchPage,
  inspectDealUrlHealth,
});
assert.equal(
  validation.allowedDeals.length,
  1,
  "current exact offer overrides unrelated page creation/expiry dates",
);
const changed = await validateDealsForSlack([deal], {
  now,
  fetchOfficialFoodPage: async () => ({
    html: "<p>Offer ended</p>",
    finalUrl: ikea.url,
  }),
  inspectDealUrlHealth,
});
assert.equal(
  changed.allowedDeals.length,
  0,
  "removed campaign cannot be revived by old evidence",
);
const normalized = normalizeDeal(deal, "power");
assert.equal(
  (await verifyOfficialFoodDeal(normalized, { now, fetchPage })).ok,
  true,
  "Slack normalization preserves evidence",
);
const twoHtml =
  ikeaHtml +
  ikeaHtml.replaceAll("Frühstück um nur € 1,-", "Hot Dog um nur € 3,-");
const two = extractFoodOffers(twoHtml, ikea, { now }).deals;
assert.equal(two.length, 2);
assert.equal(
  filterDuplicateDealsInRun([...two, two[0]]).deals.length,
  2,
  "two offers on one page must survive dispatch",
);
assert.equal(
  mergePendingQueue([two[0]], [two[1]]).length,
  2,
  "queue keeps both offers",
);
assert.equal(
  dedupeApprovedDeals([...two, two[0]]).length,
  2,
  "approval keeps both offers",
);
const seen = new Set();
addSeenDealsFromThread(seen, [two[0]]);
assert.equal(
  filterRecentlySeenDeals(two, seen).deals.length,
  1,
  "one reviewed offer does not hide the whole page",
);
const beforeExpiry = JSON.stringify(validation.allowedDeals[0]);
await normalizeApprovedDealExpiries(validation.allowedDeals);
assert.equal(
  JSON.stringify(validation.allowedDeals[0]),
  beforeExpiry,
  "approval must retain offer-specific expiry",
);

// Refreshed evidence, not mutable candidate fields, controls dates and location.
const tampered = await validateDealsForSlack(
  [
    {
      ...deal,
      validUntil: "2030-01-01",
      validOn: "2030-01-01",
      distance: "Graz",
      address: "Invented address",
      city: "Graz",
    },
  ],
  { now, fetchOfficialFoodPage: fetchPage, inspectDealUrlHealth },
);
assert.equal(tampered.allowedDeals.length, 1);
assert.equal(tampered.allowedDeals[0].validUntil, undefined);
assert.equal(tampered.allowedDeals[0].validOn, undefined);
assert.equal(tampered.allowedDeals[0].address, undefined);
assert.equal(tampered.allowedDeals[0].distance, deal.distance);
let cachedCalls = 0;
await validateDealsForSlack(two, {
  now,
  fetchOfficialFoodPage: async () => {
    cachedCalls++;
    return { html: twoHtml, finalUrl: ikea.url };
  },
  inspectDealUrlHealth,
});
assert.equal(
  cachedCalls,
  1,
  "same merchant page is fetched once per validation run",
);
const originalFetch = globalThis.fetch;
try {
  const requests = [];
  globalThis.fetch = async (url) => {
    requests.push(url);
    return new Response(null, {
      status: 302,
      headers: { location: "https://evil.test/private" },
    });
  };
  await assert.rejects(fetchOfficialFoodPage(ikea.url, ikea), /Untrusted/);
  assert.equal(
    requests.length,
    1,
    "foreign redirect is rejected before following",
  );
  globalThis.fetch = async () =>
    new Response("fake page", {
      headers: { "content-type": "application/pdf" },
    });
  await assert.rejects(fetchOfficialFoodPage(ikea.url, ikea), /Not HTML/);
} finally {
  globalThis.fetch = originalFetch;
}

console.log(
  "Power food: extraction, validity, transport, deduplication and Slack integration passed",
);

assert.equal(
  validation.allowedDeals[0].expires,
  "Siehe Originalangebot",
  "a start date must not erase the unknown end label",
);
const shortTitle = parse(
  card(
    "<h2>Happy hour</h2><p>Everyday Opening TILL 18:00 All Cocktails 8€ All Cocktails 8€</p>",
  ),
).deals[0];
assert.match(shortTitle.title, /Cocktails 8€/);

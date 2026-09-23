import { load } from "cheerio";
import crypto from "node:crypto";
import { extractLowFoodPrice } from "./food-discovery-utils.js";
import {
  getNonGuaranteedPromotionReason,
  getInfrastructureOnlyPromotionReason,
  getMembershipOnlyPromotionReason,
} from "./promotion-quality-utils.js";
import { isAllowedFoodUrl } from "./power-food-sources.js";

const FOOD =
  /weckerl|laugenring|mohnschnecke|baguette|dinkel|kornspitz|kaffee|coffee|cappuccino|espresso|melange|matcha|tee\b|kakao|heißgetränk|heissgetraenk|cocktail|drink|spritz|bier|beer|wein|limonade|getränk|burger|pizza|pasta|pommes|fries|kebab|kebap|döner|doener|schnitzel|hot.?dog|frühstück|breakfast|jause|brot|br[eö]t|breze|gebäck|semmel|knopferl|topfini|croissant|kuchen|strudel|dessert|eis\b|menü|menu|gericht|hauptspeise|teller|bällchen|waffel|sandwich|falafel|sushi|ramen|fish|fisch|backfisch|garnelen|chicken|snack|minis\s*xxl|schoko/i;
const PRICE =
  /(?:€\s*\d{1,3}(?:[,.]\d{1,2})?|\d{1,3}(?:[,.]\d{1,2})?\s*(?:€|EUR\b|Euro\b))/i;
const BENEFIT =
  /(?:-\s*\d+\s*%|\d+\s*%\s*(?:rabatt|sparen|günstiger|off|discount))|\d+\s*\+\s*\d+|\b2\s*(?:für|for)\s*1\b|\b(?:gratis|kostenlos|geschenkt|statt|rabatt|discount)\b/i;
const PROMO =
  /aktion|angebot|special|happy\s*hour|vappy\s*hour|sonderpreis|vorteilspreis|aktionspreis|deal[- ]preis|kombiaktion|kaffeejause|bäckerjause/i;
const VIENNA = /\bwien\b|\bvienna\b|\b1(?:0[1-9]|1[0-9]|2[0-3])0\b/i;
const NEGATIVE =
  /(?:nicht|außer|ausser|ausgenommen)\s+(?:in\s+)?wien\b|wien\s+(?:ausgenommen|ausgeschlossen)|nur\s+(?:in\s+)?(?:graz|linz|salzburg|innsbruck)\b/i;
const FOREIGN =
  /(?:nur|ausschließlich|exklusiv)\s+(?:in\s+)?(?:deutschland|graz|salzburg|linz|innsbruck)|\b(?:USD|CHF|\$)\b/i;
export const foodText = (value) =>
  String(value || "")
    .replace(/[\u200b-\u200d\ufeff]/g, "")
    .replace(/\s+/g, " ")
    .trim();
function textOf($, el) {
  const copy = $(el).clone();
  copy.find("br").replaceWith(" ");
  copy.find("p,div,h1,h2,h3,h4,li,span").append(" ");
  return foodText(copy.text());
}
function canonical(value) {
  const u = new URL(value);
  u.hash = "";
  for (const k of [...u.searchParams.keys()])
    if (/^utm_|^fbclid$/.test(k)) u.searchParams.delete(k);
  return u.href;
}
function titleKey(v) {
  return foodText(v)
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, "");
}

export function discoverFoodLinks(
  html,
  source,
  pageUrl = source.url,
  limit = 4,
) {
  const $ = load(html);
  const links = new Set();
  $("a[href]").each((i, e) => {
    try {
      const u = canonical(new URL($(e).attr("href"), pageUrl).href);
      if (
        u !== canonical(pageUrl) &&
        isAllowedFoodUrl(u, source) &&
        source.linkPattern.test(u) &&
        !/impressum|privacy|datenschutz|jobs|karriere|teilnahmebedingungen/i.test(
          u,
        )
      )
        links.add(u);
    } catch {}
  });
  return [...links].slice(0, limit);
}

export function extractFoodExpiry(text, now) {
  const year = Number(
    new Intl.DateTimeFormat("en", {
      year: "numeric",
      timeZone: "Europe/Vienna",
    }).format(now),
  );
  const iso = (d, m, y) => {
    const v = `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
    const dt = new Date(v + "T12:00:00Z");
    return Number.isFinite(dt.getTime()) && dt.toISOString().slice(0, 10) === v
      ? v
      : "";
  };
  const end = text.match(
    /\bbis\s+(?:zum\s+)?(\d{1,2})\.\s*(\d{1,2})\.\s*(20\d{2})?/i,
  );
  const compact = text.match(
    /(\d{1,2})\.\s*[-–]\s*(\d{1,2})\.\s*(\d{1,2})\.\s*(20\d{2})/,
  );
  const start = text.match(
    /\b(?:ab|vom|von)\s+(\d{1,2})\.\s*(\d{1,2})\.\s*(20\d{2})?/i,
  );
  const validUntil = end
    ? iso(+end[1], +end[2], +(end[3] || year))
    : compact
      ? iso(+compact[2], +compact[3], +compact[4])
      : "";
  const validFrom = start
    ? iso(+start[1], +start[2], +(start[3] || end?.[3] || year))
    : compact
      ? iso(+compact[1], +compact[3], +compact[4])
      : "";
  return {
    validFrom,
    validUntil,
    raw: end?.[0] || start?.[0] || compact?.[0] || "",
    recurring:
      /bis auf widerruf|bis auf wiederuf|jeden|täglich|montag bis|freitag und samstag|daily|everyday/i.test(
        text,
      ),
  };
}

export function extractFoodOffers(html, source, options = {}) {
  const now = options.now || new Date();
  const pageUrl = options.pageUrl || source.url;
  if (!isAllowedFoodUrl(pageUrl, source))
    return {
      deals: [],
      rejected: [{ reason: "foreign-redirect", url: pageUrl }],
      links: [],
    };
  const $ = load(html);
  $("script,style,noscript,nav,footer,header").remove();
  const bodyText = textOf($, $("body"));
  const blocks = [];
  const rejected = [];
  const add = (el, method, title) => {
    const text = textOf($, el);
    if (text.length >= 18 && text.length <= 16000)
      blocks.push({
        text,
        title: foodText(title || $(el).find("h1,h2,h3,h4").first().text()),
        method,
      });
  };
  if (source.singleOfferPattern?.test(pageUrl))
    add($("main").length ? $("main") : $("body"), "official-detail");
  else {
    if (source.selector)
      $(source.selector)
        .filter((i, e) => !$(e).parents(source.selector).length)
        .each((i, e) => add(e, "merchant-card"));
    // Include self-contained offers outside links. Select the smallest block
    // containing a benefit and product; never stitch adjacent offers together.
    if (!source.selector)
      $('h1,h2,h3,h4,p,[class*="heading"],.featured-title').each((i, e) => {
        if (!PROMO.test($(e).text()) && !BENEFIT.test($(e).text())) return;
        let node = $(e);
        for (
          let depth = 0;
          depth < 5 && node.length;
          depth++, node = node.parent()
        ) {
          const txt = textOf($, node);
          if (node.is("h1,h2,h3,h4")) continue;
          if (txt.length > 2400) break;
          if (
            FOOD.test(txt) &&
            (BENEFIT.test(txt) || (PROMO.test(txt) && PRICE.test(txt))) &&
            txt.length > 30
          ) {
            add(node, "semantic-block", $(e).text());
            break;
          }
        }
      });
  }
  const found = new Map();
  for (const b of blocks) {
    const t = b.text;
    let reason = "";
    const pricePromotion =
      (PROMO.test(t) ||
        (b.method === "merchant-card" && source.currentOffers)) &&
      PRICE.test(t);
    if (!FOOD.test(t)) reason = "not-food-drink";
    else if (!BENEFIT.test(t) && !pricePromotion && !extractLowFoodPrice(t))
      reason = "no-concrete-benefit";
    else if (
      /(?:gratis|kostenlos(?:er|e)?)\s+(?:versand|lieferung|abholung|wlan)/i.test(
        t,
      )
    )
      reason = "non-food-free-service";
    else
      reason =
        getNonGuaranteedPromotionReason(t) ||
        getInfrastructureOnlyPromotionReason(t) ||
        getMembershipOnlyPromotionReason(t);
    if (
      !reason &&
      /symbolfotos?.{0,60}kein anspruch|kein anspruch auf.{0,70}(?:gutschein|prämie)|mit etwas glück/i.test(
        t,
      )
    )
      reason = "unconfirmed-personalized-reward";
    if (
      !reason &&
      (NEGATIVE.test(t) ||
        FOREIGN.test(t) ||
        (/\b(?:filiale|standort|restaurant)\s+(?:in\s+)?(?:graz|linz|salzburg|innsbruck)\b/i.test(
          t,
        ) &&
          !VIENNA.test(t) &&
          !/allen|österreichweit/i.test(t)))
    )
      reason = "outside-vienna";
    if (
      !reason &&
      /gilt nicht im.{0,50}restaurant/i.test(t) &&
      /gutschein/i.test(t)
    )
      reason = "non-food-redemption";
    if (
      !reason &&
      /\b(?:B2B|franchisepartner|gastronomiebelieferung|tiefkühl-backwaren)\b/i.test(
        t,
      )
    )
      reason = "business-only";
    if (reason) {
      rejected.push({ reason, title: b.title, text: t.slice(0, 220) });
      continue;
    }
    const dates = extractFoodExpiry(t, now);
    const today = new Intl.DateTimeFormat("sv-SE", {
      timeZone: "Europe/Vienna",
    }).format(now);
    if ((dates.validUntil || dates.validOn || "9999") < today) {
      rejected.push({
        reason: "offer-expired",
        title: b.title,
        text: t.slice(0, 220),
      });
      continue;
    }
    // An address in a site's footer alone does not establish campaign scope.
    const inText = VIENNA.test(t);
    const registered = source.address && source.locationEvidenceUrl;
    const nationwide =
      /in allen.{0,65}(?:österreich|oesterreich)|österreichweit|in ganz österreich/i.test(
        t,
      );
    const merchantAll =
      /in allen.{0,50}filialen/i.test(t) && VIENNA.test(bodyText);
    const scope = inText
      ? "offer-text"
      : registered
        ? "merchant-address"
        : nationwide
          ? "austria-wide"
          : merchantAll
            ? "merchant-branches"
            : "";
    let title = b.title || t.split(/(?<=[.!?])\s/)[0];
    if (b.method === "official-detail") {
      const headings = $("h1,h2,h3,h4")
        .map((i, e) => foodText($(e).text()))
        .get();
      title = headings.find((h) => /\d+\s*%|\d+\s*\+\s*\d+/.test(h)) || title;
    }
    // Retain source wording; do not invent a summary or silently truncate it.
    if (!FOOD.test(title) || (!BENEFIT.test(title) && !PRICE.test(title))) {
      const clause = t
        .split(/(?<=[.!?])\s/)
        .find(
          (s) =>
            FOOD.test(s) &&
            (BENEFIT.test(s) || PRICE.test(s)) &&
            s.length <= 160,
        );
      if (clause && !/\d+\s*%|\d+\s*\+\s*\d+/.test(title)) title = clause;
    }
    if (title.length < 25 && !PRICE.test(title)) {
      const price = t.match(PRICE);
      const lead = price ? t.slice(0, price.index + price[0].length) : t;
      if (lead.length <= 180) title = lead;
    }
    if (title.length > 180)
      title = `${source.brand || source.name}: Angebot – Details ansehen`;
    const category =
      /kaffee|coffee|cappuccino|melange|heißgetränk|kaffeejause/i.test(title)
        ? "kaffee"
        : /cocktail|spritz|drink|getränk|bier|beer/i.test(title)
          ? "trinken"
          : source.category;
    const bogo = /\d+\s*\+\s*\d+|\b2\s*(?:für|for)\s*1\b/i.test(t);
    const conditional =
      /\b(?:kauf|bestell|mitglied|punkte|coupon|markerl|ab einem|zu jedem|zweite|zweiten)\w*/i.test(
        t,
      );
    const type = bogo
      ? "bogo"
      : /gratis|kostenlos/i.test(t) && !conditional && !PRICE.test(t)
        ? "gratis"
        : "rabatt";
    const key = titleKey(t);
    const url = canonical(pageUrl);
    const deal = {
      id:
        "power-food-" +
        crypto
          .createHash("sha1")
          .update(`${source.name}|${url}|${titleKey(title)}`)
          .digest("hex")
          .slice(0, 12),
      brand: source.brand || source.name,
      source: source.name,
      originSource: "power-official-food",
      title,
      description: t,
      url,
      category,
      type,
      logo: category === "kaffee" ? "☕" : category === "trinken" ? "🥤" : "🍽️",
      discoveredAt: now.toISOString(),
      lastCheckedAt: now.toISOString(),
      qualityScore: scope ? 78 : 48,
      priority: 2,
      votes: 1,
      hot: false,
      isNew: true,
      distance: registered
        ? source.address
        : scope === "austria-wide"
          ? "Teilnehmende Filialen in Österreich – Wiener Filiale prüfen"
          : inText || merchantAll
            ? "Wien – Filiale laut Angebot"
            : "Ort prüfen",
      ...(registered ? { address: source.address, city: "Wien" } : {}),
      ...(dates.validUntil ? { validUntil: dates.validUntil } : {}),
      ...(dates.validFrom ? { validFrom: dates.validFrom } : {}),
      ...(dates.validOn ? { validOn: dates.validOn } : {}),
      expires: dates.validUntil || dates.validOn || "Siehe Originalangebot",
      missingFields: [
        ...(!scope ? ["Ort"] : []),
        ...(!dates.validUntil && !dates.validOn ? ["Ablauf"] : []),
      ],
      evidence: {
        offerTiming: {
          kind: dates.validUntil
            ? "end"
            : dates.recurring
              ? "recurring"
              : "start",
          validFrom: dates.validFrom,
          validUntil: dates.validUntil,
          recurring: dates.recurring,
          matchedText: dates.raw,
        },
        source: "official-merchant-page",
        merchantSourceKey: source.name,
        sourceUrl: url,
        checkedAt: now.toISOString(),
        textSample: t,
        extractionMethod: b.method,
        contentHash: crypto.createHash("sha256").update(t).digest("hex"),
        locationScope: scope,
        locationEvidenceUrl: registered ? source.locationEvidenceUrl : url,
      },
      reviewRequired: true,
    };
    const previous = found.get(key);
    if (!previous || previous.description.length < t.length)
      found.set(key, deal);
  }
  const rows = [...found.values()];
  // Prefer complete merchant cards over nested title/paragraph duplicates.
  const deals = rows.filter(
    (a) =>
      !rows.some(
        (b) =>
          a !== b &&
          b.description.length > a.description.length &&
          b.description.includes(a.description),
      ),
  );
  return {
    deals,
    rejected,
    links: discoverFoodLinks(html, source, pageUrl),
    pageText: bodyText,
  };
}

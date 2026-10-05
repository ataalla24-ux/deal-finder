import { handlePromoRequest, promoLedger } from './merchant-promos.js';
export { MerchantPromoLedger } from './merchant-promos.js';

const PACKAGE_CONFIG = {
  starter: {
    productId: "com.stefanataalla.freefinderwien.merchant.starter",
    name: "Starter Boost",
    durationDays: 1,
    price: "25,99 EUR",
    unitAmount: 2599,
  },
  spotlight: {
    productId: "com.stefanataalla.freefinderwien.merchant.spotlight",
    name: "Spotlight Boost",
    durationDays: 3,
    price: "64,99 EUR",
    unitAmount: 6499,
  },
  city: {
    productId: "com.stefanataalla.freefinderwien.merchant.city",
    name: "City Push",
    durationDays: 8,
    price: "129,99 EUR",
    unitAmount: 12999,
  },
};

const STRIPE_API_VERSION = "2026-02-25.clover";
const CAMPAIGN_PREFIX = "campaign:";
const TRANSACTION_PREFIX = "transaction:";
const DEAL_INTERACTION_PREFIX = "deal-interaction:";
const DEAL_INTERACTION_COMMUNITY_PREFIX = "deal-interaction-community:";
const DEAL_INTERACTION_RATINGS_PREFIX = "deal-interaction-ratings:";
const INDEX_KEY = "campaign:index";
const MAX_CAMPAIGNS = 50;
const MAX_INTERACTION_DEAL_IDS = 90;
const MAX_INTERACTION_DEVICES = 5000;
const MAX_COMMUNITY_ENTRIES = 80;
const DEAL_INTERACTION_RATE_PREFIX = "deal-interaction-rate:";
const PRODUCT_ANALYTICS_EVENT_PREFIX = "product-analytics:event:";
const PRODUCT_ANALYTICS_DEDUPE_PREFIX = "product-analytics:dedupe:";
const PRODUCT_ANALYTICS_RATE_PREFIX = "product-analytics:rate:";
const PRODUCT_ANALYTICS_RETENTION_DAYS = 35;
const PRODUCT_ANALYTICS_MAX_BATCH_SIZE = 20;
const PRODUCT_ANALYTICS_MAX_SUMMARY_EVENTS = 10000;
const PRODUCT_ANALYTICS_EVENTS = new Set([
  "app_open",
  "feed_loaded",
  "deal_opened",
  "deal_shared",
  "deal_favorited",
  "deal_redeemed",
  "map_opened",
  "referral_shared",
  "referral_claimed",
  "paywall_viewed",
  "trial_started",
  "subscription_started",
]);
const INTERACTION_RATE_LIMITS = {
  add_comment: { windowSeconds: 10 * 60, max: 8 },
  add_tip: { windowSeconds: 10 * 60, max: 6 },
  rate: { windowSeconds: 60, max: 12 },
  default: { windowSeconds: 60, max: 90 },
};
const JSON_HEADERS = {
  "content-type": "application/json; charset=utf-8",
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET,POST,OPTIONS",
  "access-control-allow-headers": "content-type,x-freefinder-merchant-secret",
  "cache-control": "no-store",
};
const INSTAGRAM_CACHE_KEY = "instagram-agent:latest";
const INSTAGRAM_CACHE_SECONDS = 45 * 60;
const INSTAGRAM_MAX_MEDIA = 90;
const DEFAULT_INSTAGRAM_HASHTAGS = [
  "wien",
  "vienna",
  "gratiswien",
  "wienevents",
  "wienfood",
  "viennadeals",
  "wiengratis",
];

export default {
  async fetch(request, env, ctx) {
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: JSON_HEADERS });
    }

    const url = new URL(request.url);

    try {
      if (url.pathname.startsWith('/api/merchant/promos/')) {
        const response = await handlePromoRequest(request, env);
        if (url.pathname.endsWith('/redeem') && response.status === 201) {
          const result = await response.clone().json();
          const notification = notifySlackCampaign(env, result.campaign);
          if (ctx?.waitUntil) ctx.waitUntil(notification); else await notification;
        }
        return response;
      }
      if (request.method === "GET" && url.pathname === "/api/merchant/health") {
        return json({ ok: true, packages: publicPackages(), promoCodesAvailable: Boolean(env.MERCHANT_PROMOS) });
      }

      if (request.method === "GET" && url.pathname === "/api/merchant/campaigns") {
        return listCampaigns(env);
      }

      if (request.method === "POST" && url.pathname === "/api/merchant/campaigns") {
        return createCampaign(request, env);
      }

      if (request.method === "POST" && url.pathname === "/api/deals/review") {
        return reviewDeals(request, env);
      }

      if (request.method === "GET" && url.pathname === "/api/deals/interactions") {
        return listDealInteractions(request, env);
      }

      if (request.method === "POST" && url.pathname === "/api/deals/interactions") {
        return recordDealInteraction(request, env);
      }

      if (request.method === "POST" && url.pathname === "/api/analytics/events") {
        return recordProductAnalyticsEvents(request, env);
      }

      if (request.method === "GET" && url.pathname === "/api/analytics/summary") {
        return productAnalyticsSummary(request, env);
      }

      if (request.method === "GET" && url.pathname === "/api/instagram-agent/health") {
        return instagramAgentHealth(env);
      }

      if ((request.method === "GET" || request.method === "POST") && url.pathname === "/api/instagram-agent/deals") {
        return discoverInstagramDeals(request, env);
      }

      return json({ ok: false, error: "Not found" }, 404);
    } catch (error) {
      return json({ ok: false, error: "Internal error" }, 500);
    }
  },
};

async function recordProductAnalyticsEvents(request, env) {
  if (!env.MERCHANT_CAMPAIGNS) {
    return json({ ok: false, error: "Analytics storage is not configured" }, 503);
  }

  let payload;
  try {
    payload = await readPayload(request);
  } catch {
    return json({ ok: false, error: "Invalid JSON payload" }, 400);
  }

  const submitted = Array.isArray(payload?.events) ? payload.events : [payload];
  if (!submitted.length || submitted.length > PRODUCT_ANALYTICS_MAX_BATCH_SIZE) {
    return json({
      ok: false,
      error: `Analytics batches must contain 1-${PRODUCT_ANALYTICS_MAX_BATCH_SIZE} events`,
    }, 400);
  }

  const events = submitted.map((event) => sanitizeAnalyticsEvent(event)).filter(Boolean);
  if (!events.length) {
    return json({ ok: false, error: "No valid analytics events" }, 400);
  }

  const rateLimit = await enforceProductAnalyticsRateLimit(request, env, events);
  if (rateLimit) return rateLimit;

  let accepted = 0;
  let duplicate = 0;
  const expirationTtl = PRODUCT_ANALYTICS_RETENTION_DAYS * 24 * 60 * 60;
  for (const event of events) {
    const dedupeDigest = await analyticsDigest(event.eventId);
    const dedupeKey = `${PRODUCT_ANALYTICS_DEDUPE_PREFIX}${dedupeDigest}`;
    if (await env.MERCHANT_CAMPAIGNS.get(dedupeKey)) {
      duplicate += 1;
      continue;
    }

    const anonymousIdHash = await analyticsDigest(event.anonymousId, env.ANALYTICS_HASH_SECRET);
    const storedEvent = {
      ...event,
      anonymousIdHash,
    };
    delete storedEvent.anonymousId;

    const day = event.occurredAt.slice(0, 10);
    const eventKey = `${PRODUCT_ANALYTICS_EVENT_PREFIX}${day}:${dedupeDigest}`;
    await Promise.all([
      env.MERCHANT_CAMPAIGNS.put(eventKey, JSON.stringify(storedEvent), { expirationTtl }),
      env.MERCHANT_CAMPAIGNS.put(dedupeKey, "1", { expirationTtl }),
    ]);
    accepted += 1;
  }

  return json({
    ok: true,
    accepted,
    duplicate,
    rejected: submitted.length - events.length,
    retentionDays: PRODUCT_ANALYTICS_RETENTION_DAYS,
  }, 202);
}

async function productAnalyticsSummary(request, env) {
  if (!isMerchantRequestAuthorized(request, env)) {
    return json({ ok: false, error: "Merchant API secret is invalid" }, 401);
  }
  if (!env.MERCHANT_CAMPAIGNS) {
    return json({ ok: false, error: "Analytics storage is not configured" }, 503);
  }

  const url = new URL(request.url);
  const days = clampInteger(url.searchParams.get("days"), 7, 1, PRODUCT_ANALYTICS_RETENTION_DAYS);
  const daily = [];
  const eventTotals = {};
  const platformTotals = {};
  const planTotals = {};
  const allUsers = new Set();
  let scannedEvents = 0;
  let truncated = false;

  for (const day of analyticsDays(days)) {
    const remaining = PRODUCT_ANALYTICS_MAX_SUMMARY_EVENTS - scannedEvents;
    if (remaining <= 0) {
      truncated = true;
      break;
    }
    const result = await readProductAnalyticsDay(env, day, remaining);
    scannedEvents += result.events.length;
    truncated ||= result.truncated;
    const dayUsers = new Set();
    const dayEvents = {};

    for (const event of result.events) {
      incrementCounter(dayEvents, event.name);
      incrementCounter(eventTotals, event.name);
      incrementCounter(platformTotals, event.platform);
      incrementCounter(planTotals, event.plan);
      if (event.anonymousIdHash) {
        dayUsers.add(event.anonymousIdHash);
        allUsers.add(event.anonymousIdHash);
      }
    }

    daily.push({
      date: day,
      events: result.events.length,
      uniqueInstallations: dayUsers.size,
      byEvent: dayEvents,
    });
    if (truncated) break;
  }

  return json({
    ok: true,
    generatedAt: new Date().toISOString(),
    periodDays: days,
    retentionDays: PRODUCT_ANALYTICS_RETENTION_DAYS,
    totals: {
      events: scannedEvents,
      uniqueInstallations: allUsers.size,
      byEvent: eventTotals,
      byPlatform: platformTotals,
      byPlan: planTotals,
    },
    daily,
    truncated,
  });
}

function sanitizeAnalyticsEvent(value, now = Date.now()) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const name = cleanAnalyticsToken(value.name, 48);
  const eventId = cleanAnalyticsId(value.eventId, 100);
  const anonymousId = cleanAnalyticsId(value.anonymousId, 160);
  const platform = cleanAnalyticsToken(value.platform, 20);
  if (!PRODUCT_ANALYTICS_EVENTS.has(name) || !eventId || !anonymousId || !["ios", "android"].includes(platform)) {
    return null;
  }

  const plan = cleanAnalyticsToken(value.plan, 20);
  const occurredAt = sanitizedAnalyticsTimestamp(value.occurredAt, now);
  return {
    eventId,
    name,
    occurredAt,
    platform,
    appVersion: cleanAnalyticsVersion(value.appVersion, 40),
    build: cleanAnalyticsVersion(value.build, 30),
    plan: ["free", "pro", "plus"].includes(plan) ? plan : "free",
    properties: sanitizeAnalyticsProperties(value.properties),
  };
}

function sanitizeAnalyticsProperties(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const properties = {};
  const tokenKeys = ["category", "surface", "source", "result", "access", "method", "purchaseProvider"];
  for (const key of tokenKeys) {
    const token = cleanAnalyticsToken(value[key], 48);
    if (token) properties[key] = token;
  }

  const feedVersion = cleanAnalyticsVersion(value.feedVersion, 80);
  if (feedVersion) properties.feedVersion = feedVersion;
  const dealId = cleanDealId(value.dealId);
  if (dealId) properties.dealId = dealId;

  for (const [key, max] of [["durationMs", 120000], ["dealCount", 10000], ["count", 10000]]) {
    const number = Number(value[key]);
    if (Number.isFinite(number)) properties[key] = Math.min(Math.max(Math.round(number), 0), max);
  }
  for (const key of ["fromCache", "granted"]) {
    if (typeof value[key] === "boolean") properties[key] = value[key];
  }
  return properties;
}

function cleanAnalyticsToken(value, maxLength) {
  return cleanText(value, maxLength)
    .toLowerCase()
    .replace(/[^a-z0-9_.:-]/g, "")
    .slice(0, maxLength);
}

function cleanAnalyticsId(value, maxLength) {
  const candidate = cleanText(value, maxLength);
  if (candidate.length < 8 || !/^[A-Za-z0-9_.:-]+$/.test(candidate)) return "";
  return candidate;
}

function cleanAnalyticsVersion(value, maxLength) {
  return cleanText(value, maxLength)
    .replace(/[^A-Za-z0-9_.:+-]/g, "")
    .slice(0, maxLength);
}

function sanitizedAnalyticsTimestamp(value, now) {
  const parsed = Date.parse(cleanText(value, 40));
  const sevenDays = 7 * 24 * 60 * 60 * 1000;
  if (!Number.isFinite(parsed) || parsed < now - sevenDays || parsed > now + 10 * 60 * 1000) {
    return new Date(now).toISOString();
  }
  return new Date(parsed).toISOString();
}

async function enforceProductAnalyticsRateLimit(request, env, events) {
  const anonymousDigest = await analyticsDigest(events[0].anonymousId);
  const ipDigest = await analyticsDigest(request.headers.get("cf-connecting-ip") || "unknown");
  const bucket = Math.floor(Date.now() / 60000);
  for (const identity of [`installation:${anonymousDigest}`, `ip:${ipDigest}`]) {
    const key = `${PRODUCT_ANALYTICS_RATE_PREFIX}${bucket}:${identity}`;
    const current = Number(await env.MERCHANT_CAMPAIGNS.get(key) || 0);
    const next = current + events.length;
    if (next > 120) {
      return json({ ok: false, error: "Too many analytics events", retryAfterSeconds: 60 }, 429);
    }
    await env.MERCHANT_CAMPAIGNS.put(key, String(next), { expirationTtl: 120 });
  }
  return null;
}

async function analyticsDigest(value, secret = "") {
  const input = new TextEncoder().encode(`${cleanText(secret, 300)}:${cleanText(value, 200)}`);
  const digest = await crypto.subtle.digest("SHA-256", input);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function analyticsDays(count, now = new Date()) {
  return Array.from({ length: count }, (_, index) => {
    const date = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - index));
    return date.toISOString().slice(0, 10);
  });
}

async function readProductAnalyticsDay(env, day, maximum) {
  const prefix = `${PRODUCT_ANALYTICS_EVENT_PREFIX}${day}:`;
  const events = [];
  let cursor;
  let truncated = false;
  do {
    const page = await env.MERCHANT_CAMPAIGNS.list({ prefix, cursor, limit: Math.min(1000, maximum - events.length) });
    const values = await Promise.all(page.keys.map((key) => env.MERCHANT_CAMPAIGNS.get(key.name, "json")));
    events.push(...values.filter((value) => value && PRODUCT_ANALYTICS_EVENTS.has(value.name)));
    cursor = page.list_complete ? undefined : page.cursor;
    if (events.length >= maximum && cursor) {
      truncated = true;
      break;
    }
  } while (cursor && events.length < maximum);
  return { events: events.slice(0, maximum), truncated };
}

function incrementCounter(target, key) {
  const normalizedKey = cleanAnalyticsToken(key, 48) || "unknown";
  target[normalizedKey] = Number(target[normalizedKey] || 0) + 1;
}

function clampInteger(value, fallback, minimum, maximum) {
  const parsed = Number.parseInt(String(value || ""), 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(Math.max(parsed, minimum), maximum);
}

async function listDealInteractions(request, env) {
  if (!env.MERCHANT_CAMPAIGNS) {
    return json({ ok: true, interactions: {} });
  }

  const url = new URL(request.url);
  const ids = uniqueStrings(String(url.searchParams.get("dealIds") || "")
    .split(",")
    .map((id) => cleanDealId(id)))
    .slice(0, MAX_INTERACTION_DEAL_IDS);
  const interactions = {};

  await Promise.all(ids.map(async (dealId) => {
    const record = await dealInteractionRecord(env, dealId);
    interactions[dealId] = publicDealInteraction(record);
  }));

  return json({ ok: true, interactions });
}

async function recordDealInteraction(request, env) {
  if (!env.MERCHANT_CAMPAIGNS) {
    return json({ ok: false, error: "Interaction storage is not configured" }, 503);
  }

  const payload = await readPayload(request);
  const dealId = cleanDealId(payload.dealId);
  const deviceId = cleanText(payload.deviceId, 160);
  const action = cleanText(payload.action, 40);
  if (!dealId || !deviceId) {
    return json({ ok: false, error: "Missing dealId or deviceId" }, 400);
  }

  const rateLimit = await enforceInteractionRateLimit(request, env, action, deviceId);
  if (rateLimit) return rateLimit;

  const record = await dealInteractionRecord(env, dealId);
  switch (action) {
    case "upvote":
      record.upvotes = addUnique(record.upvotes, deviceId);
      break;
    case "remove_upvote":
      record.upvotes = removeValue(record.upvotes, deviceId);
      break;
    case "favorite":
      record.favorites = addUnique(record.favorites, deviceId);
      break;
    case "remove_favorite":
      record.favorites = removeValue(record.favorites, deviceId);
      break;
    case "open":
      record.opens = addUnique(record.opens, deviceId);
      break;
    case "remove_open":
      record.opens = removeValue(record.opens, deviceId);
      break;
    case "redeem":
      record.redeems = addUnique(record.redeems, deviceId);
      break;
    case "remove_redeem":
      record.redeems = removeValue(record.redeems, deviceId);
      break;
    case "add_comment":
      {
        const validationError = validateCommunityText(cleanText(payload.text, 300));
        if (validationError) return json({ ok: false, error: validationError }, 400);
        record.comments = addCommunityEntry(record.comments, deviceId, payload.text);
      }
      break;
    case "add_tip":
      {
        const validationError = validateCommunityText(cleanText(payload.text, 300));
        if (validationError) return json({ ok: false, error: validationError }, 400);
        record.tips = addCommunityEntry(record.tips, deviceId, payload.text);
      }
      break;
    case "report_comment":
      record.comments = reportCommunityEntry(record.comments, deviceId, payload.entryId);
      break;
    case "report_tip":
      record.tips = reportCommunityEntry(record.tips, deviceId, payload.entryId);
      break;
    case "hide_comment":
      if (!isMerchantRequestAuthorized(request, env)) return json({ ok: false, error: "Merchant API secret is invalid" }, 401);
      record.comments = hideCommunityEntry(record.comments, payload.entryId);
      break;
    case "hide_tip":
      if (!isMerchantRequestAuthorized(request, env)) return json({ ok: false, error: "Merchant API secret is invalid" }, 401);
      record.tips = hideCommunityEntry(record.tips, payload.entryId);
      break;
    case "rate": {
      const rating = Number(payload.rating);
      if (!Number.isFinite(rating) || rating < 1 || rating > 5) {
        return json({ ok: false, error: "Rating must be between 1 and 5" }, 400);
      }
      record.ratings[deviceId] = Math.round(rating);
      break;
    }
    default:
      return json({ ok: false, error: "Unsupported action" }, 400);
  }

  const saved = await saveDealInteractionWithRepair(env, dealId, record, action, deviceId, payload);
  return json({ ok: true, interaction: publicDealInteraction(saved) });
}

async function enforceInteractionRateLimit(request, env, action, deviceId) {
  const config = INTERACTION_RATE_LIMITS[action] || INTERACTION_RATE_LIMITS.default;
  if (!config || !env.MERCHANT_CAMPAIGNS) return null;

  const identities = uniqueStrings([
    `device:${deviceId}`,
    `ip:${request.headers.get("cf-connecting-ip") || ""}`,
  ].map(rateLimitIdentity)).filter((identity) => !identity.endsWith(":"));

  for (const identity of identities) {
    const key = `${DEAL_INTERACTION_RATE_PREFIX}${action}:${identity}`;
    const now = Date.now();
    const current = await env.MERCHANT_CAMPAIGNS.get(key, "json");
    const startedAt = Number(current?.startedAt || 0);
    const resetAt = startedAt + config.windowSeconds * 1000;
    const next = startedAt && now < resetAt
      ? { startedAt, count: Number(current?.count || 0) + 1 }
      : { startedAt: now, count: 1 };

    if (next.count > config.max) {
      return json({
        ok: false,
        error: "Too many community actions. Please try again shortly.",
        retryAfterSeconds: Math.max(1, Math.ceil((resetAt - now) / 1000)),
      }, 429);
    }

    await env.MERCHANT_CAMPAIGNS.put(key, JSON.stringify(next), {
      expirationTtl: config.windowSeconds + 60,
    });
  }

  return null;
}

function rateLimitIdentity(value) {
  return cleanText(value, 180).replace(/[^\w:.-]/g, "").slice(0, 120);
}

function isMerchantRequestAuthorized(request, env) {
  const merchantSecret = cleanText(env.MERCHANT_API_SECRET, 300);
  if (!merchantSecret) return false;
  const presentedSecret = cleanText(request.headers.get("x-freefinder-merchant-secret"), 300);
  return presentedSecret === merchantSecret;
}

async function saveDealInteractionWithRepair(env, dealId, record, action, deviceId, payload) {
  if (isCommunityAction(action)) {
    return saveCommunityInteractionWithRepair(env, dealId, record, action, deviceId, payload);
  }
  if (action === "rate") {
    return saveRatingInteractionWithRepair(env, dealId, record, action, deviceId, payload);
  }

  record.updatedAt = new Date().toISOString();
  await putDealInteractionRecord(env, dealId, record);

  await sleep(80);
  const latest = await dealInteractionRecord(env, dealId);
  const repaired = applyInteractionIntent(latest, action, deviceId, payload);
  repaired.updatedAt = new Date().toISOString();
  await putDealInteractionRecord(env, dealId, repaired);
  return repaired;
}

async function saveCommunityInteractionWithRepair(env, dealId, record, action, deviceId, payload) {
  const kind = communityKindForAction(action);
  record.updatedAt = new Date().toISOString();
  await putCommunityInteractionRecord(env, dealId, kind, record[kind]);

  await sleep(80);
  const latest = await dealInteractionRecord(env, dealId);
  const repaired = applyInteractionIntent(latest, action, deviceId, payload);
  repaired.updatedAt = new Date().toISOString();
  await putCommunityInteractionRecord(env, dealId, kind, repaired[kind]);
  return repaired;
}

async function saveRatingInteractionWithRepair(env, dealId, record, action, deviceId, payload) {
  record.updatedAt = new Date().toISOString();
  await putRatingInteractionRecord(env, dealId, record.ratings);

  await sleep(80);
  const latest = await dealInteractionRecord(env, dealId);
  const repaired = applyInteractionIntent(latest, action, deviceId, payload);
  repaired.updatedAt = new Date().toISOString();
  await putRatingInteractionRecord(env, dealId, repaired.ratings);
  return repaired;
}

async function putDealInteractionRecord(env, dealId, record) {
  await env.MERCHANT_CAMPAIGNS.put(dealInteractionKey(dealId), JSON.stringify(record), {
    expirationTtl: 180 * 24 * 60 * 60,
  });
}

async function putRatingInteractionRecord(env, dealId, ratings) {
  await env.MERCHANT_CAMPAIGNS.put(ratingInteractionKey(dealId), JSON.stringify({
    ratings: normalizeRatings(ratings),
    updatedAt: new Date().toISOString(),
  }), {
    expirationTtl: 180 * 24 * 60 * 60,
  });
}

async function putCommunityInteractionRecord(env, dealId, kind, entries) {
  if (!kind) return;
  await env.MERCHANT_CAMPAIGNS.put(communityInteractionKey(dealId, kind), JSON.stringify({
    entries: normalizeCommunityEntries(entries),
    updatedAt: new Date().toISOString(),
  }), {
    expirationTtl: 180 * 24 * 60 * 60,
  });
}

function isCommunityAction(action) {
  return ["add_comment", "report_comment", "hide_comment", "add_tip", "report_tip", "hide_tip"].includes(action);
}

function communityKindForAction(action) {
  if (action.includes("comment")) return "comments";
  if (action.includes("tip")) return "tips";
  return "";
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function applyInteractionIntent(record, action, deviceId, payload) {
  switch (action) {
    case "upvote":
      record.upvotes = addUnique(record.upvotes, deviceId);
      break;
    case "remove_upvote":
      record.upvotes = removeValue(record.upvotes, deviceId);
      break;
    case "favorite":
      record.favorites = addUnique(record.favorites, deviceId);
      break;
    case "remove_favorite":
      record.favorites = removeValue(record.favorites, deviceId);
      break;
    case "open":
      record.opens = addUnique(record.opens, deviceId);
      break;
    case "remove_open":
      record.opens = removeValue(record.opens, deviceId);
      break;
    case "redeem":
      record.redeems = addUnique(record.redeems, deviceId);
      break;
    case "remove_redeem":
      record.redeems = removeValue(record.redeems, deviceId);
      break;
    case "add_comment":
      record.comments = addCommunityEntry(record.comments, deviceId, payload.text);
      break;
    case "add_tip":
      record.tips = addCommunityEntry(record.tips, deviceId, payload.text);
      break;
    case "report_comment":
      record.comments = reportCommunityEntry(record.comments, deviceId, payload.entryId);
      break;
    case "report_tip":
      record.tips = reportCommunityEntry(record.tips, deviceId, payload.entryId);
      break;
    case "hide_comment":
      record.comments = hideCommunityEntry(record.comments, payload.entryId);
      break;
    case "hide_tip":
      record.tips = hideCommunityEntry(record.tips, payload.entryId);
      break;
    case "rate": {
      const rating = Number(payload.rating);
      if (Number.isFinite(rating) && rating >= 1 && rating <= 5) {
        record.ratings[deviceId] = Math.round(rating);
      }
      break;
    }
  }
  return record;
}

async function reviewDeals(request, env) {
  const payload = await readPayload(request);
  const deals = Array.isArray(payload.deals) ? payload.deals.slice(0, 160) : [];
  if (!deals.length) {
    return json({ ok: true, issues: [], fixes: [], removedDealIDs: [] });
  }

  const llmIssues = await reviewDealsWithLLM(deals, env);
  const issues = llmIssues && llmIssues.length ? llmIssues : heuristicDealIssues(deals);
  const corrections = automaticDealCorrections(deals);
  return json({
    ok: true,
    issues: issues.slice(0, 16),
    fixes: corrections.fixes,
    removedDealIDs: corrections.removedDealIDs,
  });
}

async function reviewDealsWithLLM(deals, env) {
  if (!env.OPENAI_API_KEY) return null;

  const compactDeals = deals.map((deal) => ({
    id: cleanText(deal.id, 120),
    brand: cleanText(deal.brand, 90),
    title: cleanText(deal.title, 180),
    description: cleanText(deal.description, 300),
    category: cleanText(deal.category, 60),
    type: cleanText(deal.type, 60),
    expires: cleanText(deal.expires, 120),
    location: cleanText(deal.location || deal.distance, 140),
    url: cleanURL(deal.url),
  }));

  const body = {
    model: env.OPENAI_MODEL || "gpt-4.1-mini",
    temperature: 0,
    response_format: {
      type: "json_schema",
      json_schema: {
        name: "freefinder_deal_review",
        strict: true,
        schema: {
          type: "object",
          additionalProperties: false,
          properties: {
            issues: {
              type: "array",
              maxItems: 16,
              items: {
                type: "object",
                additionalProperties: false,
                properties: {
                  id: { type: "string" },
                  dealID: { type: "string" },
                  severity: { type: "string", enum: ["low", "medium", "high"] },
                  message: { type: "string" },
                  suggestion: { type: "string" },
                },
                required: ["id", "dealID", "severity", "message", "suggestion"],
              },
            },
          },
          required: ["issues"],
        },
      },
    },
    messages: [
      {
        role: "system",
        content:
          "Du bist der FreeFinder Deal-Check-Agent. Prüfe Deals auf falsche Kategorie, unklare Quelle, fehlenden Link, unplausible Laufzeit, doppelte IDs und offensichtliche Textfehler. Gib nur wichtige, konkrete Hinweise zurück. Flüge sind nur echte Flug-/Airline-Angebote; OMV/Tankstelle/TopWash/MaxxMotion sind keine Flüge.",
      },
      {
        role: "user",
        content: JSON.stringify({ deals: compactDeals }),
      },
    ],
  };

  try {
    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${env.OPENAI_API_KEY}`,
      },
      body: JSON.stringify(body),
    });
    if (!response.ok) return null;
    const data = await response.json();
    const content = data?.choices?.[0]?.message?.content;
    if (!content) return null;
    const parsed = JSON.parse(content);
    return normalizeDealIssues(parsed.issues, deals);
  } catch {
    return null;
  }
}

function instagramAgentHealth(env) {
  const config = instagramAgentConfig(env);
  return json({
    ok: true,
    configured: Boolean(config.accessToken && config.userId),
    graphVersion: config.graphVersion,
    hashtags: config.hashtags,
    accounts: config.accounts,
    cacheSeconds: INSTAGRAM_CACHE_SECONDS,
  });
}

async function discoverInstagramDeals(request, env) {
  const url = new URL(request.url);
  const payload = request.method === "POST" ? await readPayload(request) : {};
  const force = url.searchParams.get("force") === "1" || payload.force === true;
  const manualMedia = Array.isArray(payload.media) ? normalizeInstagramMedia(payload.media, "manual") : [];

  if (!force && !manualMedia.length) {
    const cached = await cachedInstagramAgentResponse(env);
    if (cached) return json(cached);
  }

  const startedAt = new Date();
  const config = instagramAgentConfig(env);
  const graphMedia = config.accessToken && config.userId ? await fetchInstagramGraphMedia(config) : [];
  const media = uniqueInstagramMedia(manualMedia.concat(graphMedia)).slice(0, INSTAGRAM_MAX_MEDIA);
  const llmDeals = await instagramDealsWithLLM(media, env, startedAt);
  const deals = normalizeInstagramDeals(llmDeals && llmDeals.length ? llmDeals : heuristicInstagramDeals(media, startedAt), media, startedAt);
  const response = {
    ok: true,
    generatedAt: startedAt.toISOString(),
    deals: deals.slice(0, 24),
    agent: {
      status: config.accessToken && config.userId ? "ready" : "needs_instagram_config",
      mediaCount: media.length,
      discoveredCount: deals.length,
      graphConfigured: Boolean(config.accessToken && config.userId),
      hashtags: config.hashtags,
      accounts: config.accounts,
      message: config.accessToken && config.userId
        ? "Instagram agent completed."
        : "Set INSTAGRAM_ACCESS_TOKEN and INSTAGRAM_USER_ID to enable live Instagram discovery.",
    },
  };

  if (!manualMedia.length) {
    await storeInstagramAgentResponse(env, response);
  }
  return json(response);
}

function instagramAgentConfig(env) {
  return {
    accessToken: cleanText(env.INSTAGRAM_ACCESS_TOKEN || env.META_ACCESS_TOKEN, 600),
    userId: cleanText(env.INSTAGRAM_USER_ID || env.IG_USER_ID, 80),
    graphVersion: cleanText(env.INSTAGRAM_GRAPH_VERSION, 20) || "v24.0",
    hashtags: parseList(env.INSTAGRAM_DEAL_HASHTAGS, DEFAULT_INSTAGRAM_HASHTAGS)
      .map((tag) => tag.replace(/^#/, "").trim())
      .filter(Boolean)
      .slice(0, 12),
    accounts: parseList(env.INSTAGRAM_DEAL_ACCOUNTS, [])
      .map((account) => account.replace(/^@/, "").trim())
      .filter((account) => /^[a-zA-Z0-9._]{1,30}$/.test(account))
      .slice(0, 20),
    perSourceLimit: Math.min(Math.max(Number(env.INSTAGRAM_MEDIA_LIMIT || 10), 3), 30),
    maxPostAgeDays: Math.min(Math.max(Number(env.INSTAGRAM_MAX_POST_AGE_DAYS || 90), 7), 180),
  };
}

async function fetchInstagramGraphMedia(config) {
  const tasks = [];

  for (const tag of config.hashtags) {
    tasks.push(fetchInstagramHashtagMedia(tag, config));
  }

  for (const account of config.accounts) {
    tasks.push(fetchInstagramAccountMedia(account, config));
  }

  const settled = await Promise.allSettled(tasks);
  return settled
    .flatMap((result) => result.status === "fulfilled" ? result.value : [])
    .filter(Boolean)
    .slice(0, INSTAGRAM_MAX_MEDIA);
}

async function fetchInstagramHashtagMedia(tag, config) {
  const hashtagSearchURL = new URL(`https://graph.facebook.com/${config.graphVersion}/ig_hashtag_search`);
  hashtagSearchURL.searchParams.set("user_id", config.userId);
  hashtagSearchURL.searchParams.set("q", tag);
  hashtagSearchURL.searchParams.set("access_token", config.accessToken);

  const hashtagResponse = await fetch(hashtagSearchURL.toString());
  if (!hashtagResponse.ok) return [];
  const hashtagPayload = await hashtagResponse.json();
  const hashtagId = hashtagPayload?.data?.[0]?.id;
  if (!hashtagId) return [];

  const mediaURL = new URL(`https://graph.facebook.com/${config.graphVersion}/${hashtagId}/recent_media`);
  mediaURL.searchParams.set("user_id", config.userId);
  mediaURL.searchParams.set("fields", "id,caption,media_type,media_url,permalink,timestamp,like_count,comments_count");
  mediaURL.searchParams.set("limit", String(config.perSourceLimit));
  mediaURL.searchParams.set("access_token", config.accessToken);

  const mediaResponse = await fetch(mediaURL.toString());
  if (!mediaResponse.ok) return [];
  const mediaPayload = await mediaResponse.json();
  return normalizeInstagramMedia(mediaPayload?.data || [], "hashtag", `#${tag}`);
}

async function fetchInstagramAccountMedia(account, config) {
  const accountURL = new URL(`https://graph.facebook.com/${config.graphVersion}/${config.userId}`);
  accountURL.searchParams.set(
    "fields",
    `business_discovery.username(${account}){username,name,media.limit(${config.perSourceLimit}){id,caption,media_type,media_url,permalink,timestamp,like_count,comments_count}}`
  );
  accountURL.searchParams.set("access_token", config.accessToken);

  const response = await fetch(accountURL.toString());
  if (!response.ok) return [];
  const payload = await response.json();
  const media = payload?.business_discovery?.media?.data || [];
  return normalizeInstagramMedia(media, "account", `@${account}`, payload?.business_discovery?.username || account);
}

async function instagramDealsWithLLM(media, env, referenceDate) {
  if (!env.OPENAI_API_KEY || !media.length) return null;

  const compactMedia = media.slice(0, INSTAGRAM_MAX_MEDIA).map((item) => ({
    id: cleanText(item.id, 100),
    caption: cleanText(item.caption, 1800),
    permalink: cleanURL(item.permalink),
    timestamp: cleanText(item.timestamp, 80),
    sourceType: cleanText(item.sourceType, 30),
    sourceName: cleanText(item.sourceName, 80),
    username: cleanText(item.username, 80),
    likeCount: Number(item.likeCount || 0),
    commentsCount: Number(item.commentsCount || 0),
  }));

  const body = {
    model: env.OPENAI_MODEL || "gpt-4.1-mini",
    temperature: 0,
    response_format: {
      type: "json_schema",
      json_schema: {
        name: "freefinder_instagram_deals",
        strict: true,
        schema: {
          type: "object",
          additionalProperties: false,
          properties: {
            deals: {
              type: "array",
              maxItems: 24,
              items: {
                type: "object",
                additionalProperties: false,
                properties: {
                  id: { type: "string" },
                  brand: { type: "string" },
                  title: { type: "string" },
                  description: { type: "string" },
                  type: { type: "string", enum: ["gratis", "rabatt", "testabo", "event", "deal"] },
                  category: { type: "string" },
                  source: { type: "string" },
                  url: { type: "string" },
                  expires: { type: "string" },
                  distance: { type: "string" },
                  location: { type: "string" },
                  hot: { type: "boolean" },
                  isNew: { type: "boolean" },
                  priority: { type: "integer" },
                  votes: { type: "integer" },
                  confidence: { type: "number" },
                  evidence: { type: "string" },
                },
                required: [
                  "id",
                  "brand",
                  "title",
                  "description",
                  "type",
                  "category",
                  "source",
                  "url",
                  "expires",
                  "distance",
                  "location",
                  "hot",
                  "isNew",
                  "priority",
                  "votes",
                  "confidence",
                  "evidence",
                ],
              },
            },
          },
          required: ["deals"],
        },
      },
    },
    messages: [
      {
        role: "system",
        content:
          "Du bist der FreeFinder Instagram-Deal-Agent fuer Wien. Extrahiere nur echte, einloesbare Angebote, Gratisaktionen, Rabatte, Gewinnspiele oder Events aus Instagram-Captions. Nimm nur Deals fuer Wien/Vienna oder online nutzbare Deals fuer Wien. Nimm nur aktuelle oder zukuenftige Deals; abgelaufene Aktionen werden verworfen. Wenn ein Datum ohne Jahr genannt wird, nutze das naheliegende Jahr relativ zum Referenzdatum. Keine allgemeinen Werbeposts, keine reinen Restaurantfotos ohne Angebot. Antworte nur als JSON.",
      },
      {
        role: "user",
        content: JSON.stringify({
          referenceDate: referenceDate.toISOString(),
          timezone: "Europe/Vienna",
          outputShape: "NativeDeal[]",
          media: compactMedia,
        }),
      },
    ],
  };

  try {
    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${env.OPENAI_API_KEY}`,
      },
      body: JSON.stringify(body),
    });
    if (!response.ok) return null;
    const data = await response.json();
    const content = data?.choices?.[0]?.message?.content;
    if (!content) return null;
    const parsed = JSON.parse(content);
    return Array.isArray(parsed.deals) ? parsed.deals : null;
  } catch {
    return null;
  }
}

function heuristicInstagramDeals(media, referenceDate) {
  const deals = [];

  for (const item of media) {
    const caption = cleanText(item.caption, 2200);
    const normalizedCaption = normalize(caption);
    if (!caption || !isViennaRelevant(normalizedCaption)) continue;
    if (!isCurrentOrFutureInstagramPost(item, normalizedCaption, referenceDate)) continue;

    const signal = instagramDealSignal(normalizedCaption, referenceDate);
    if (signal.score < 22) continue;

    const brand = inferInstagramBrand(item, caption);
    const expires = expiryTextFromCaption(caption, referenceDate) || (signal.futureDate ? formatGermanDate(signal.futureDate) : "Siehe Instagram");
    const deal = {
      id: `instagram-${stableHash(item.permalink || item.id || caption)}`,
      brand,
      logo: null,
      title: inferInstagramTitle(caption, signal),
      description: inferInstagramDescription(caption),
      type: signal.type,
      category: correctedCategory({
        brand,
        title: caption,
        description: caption,
        source: item.sourceName,
        location: "Wien",
        distance: "Wien",
      }) || signal.category,
      source: `Instagram Agent ${item.sourceName ? "- " + item.sourceName : ""}`.trim(),
      url: cleanURL(item.permalink),
      expires,
      distance: inferInstagramLocation(caption),
      location: inferInstagramLocation(caption),
      hot: signal.score >= 46 || Number(item.likeCount || 0) + Number(item.commentsCount || 0) * 2 >= 80,
      isNew: isRecentTimestamp(item.timestamp, referenceDate, 10),
      priority: Math.max(4, 34 - signal.score),
      votes: Math.min(999, Number(item.likeCount || 0) + Number(item.commentsCount || 0) * 2),
    };
    deals.push(deal);
  }

  return deals;
}

function normalizeInstagramDeals(deals, media, referenceDate) {
  const mediaByURL = new Map(media.map((item) => [cleanURL(item.permalink), item]));
  const seenURLs = new Set();
  const seenIDs = new Set();

  return (Array.isArray(deals) ? deals : [])
    .map((deal) => {
      const url = cleanURL(deal.url);
      const sourceMedia = mediaByURL.get(url);
      const sourceText = [deal.brand, deal.title, deal.description, deal.category, deal.location, deal.distance, deal.source].filter(Boolean).join(" ");
      const id = cleanText(deal.id, 120) || `instagram-${stableHash(url || sourceText)}`;
      return {
        id: id.startsWith("instagram-") ? id : `instagram-${stableHash(id)}`,
        brand: cleanText(deal.brand, 90) || inferInstagramBrand(sourceMedia || {}, sourceText) || "Instagram",
        logo: null,
        title: cleanText(deal.title, 140),
        description: cleanText(deal.description, 320),
        type: normalizeInstagramType(deal.type, sourceText),
        category: correctedCategory(deal) || cleanText(deal.category, 50) || "events",
        source: cleanText(deal.source, 100) || "Instagram Agent",
        url,
        expires: cleanText(deal.expires, 120) || "Siehe Instagram",
        distance: cleanText(deal.distance, 120) || cleanText(deal.location, 120) || "Wien",
        location: cleanText(deal.location, 120) || cleanText(deal.distance, 120) || "Wien",
        hot: deal.hot === true,
        isNew: deal.isNew === true || (sourceMedia ? isRecentTimestamp(sourceMedia.timestamp, referenceDate, 10) : false),
        priority: Math.min(Math.max(Number(deal.priority || 18), 1), 99),
        votes: Math.min(Math.max(Number(deal.votes || sourceMedia?.likeCount || 0), 0), 999),
      };
    })
    .filter((deal) => deal.title && deal.description && cleanURL(deal.url))
    .filter((deal) => isViennaRelevant(normalize([deal.brand, deal.title, deal.description, deal.location, deal.distance].join(" "))))
    .filter((deal) => !isExpiredDeal(deal, referenceDate))
    .filter((deal) => {
      if (seenIDs.has(deal.id) || seenURLs.has(deal.url)) return false;
      seenIDs.add(deal.id);
      seenURLs.add(deal.url);
      return true;
    })
    .sort((a, b) => Number(a.priority || 99) - Number(b.priority || 99) || Number(b.votes || 0) - Number(a.votes || 0));
}

function normalizeInstagramMedia(media, sourceType, sourceName = "", username = "") {
  return media
    .map((item) => ({
      id: cleanText(item.id || item.media_id || item.shortcode, 100),
      caption: cleanText(item.caption || item.text || item.description, 2200),
      mediaType: cleanText(item.media_type || item.mediaType, 40),
      mediaURL: cleanURL(item.media_url || item.mediaURL || item.thumbnail_url),
      permalink: cleanURL(item.permalink || item.url || item.link),
      timestamp: cleanText(item.timestamp || item.created_time || item.createdAt, 80),
      likeCount: Number(item.like_count ?? item.likeCount ?? item.likes ?? 0),
      commentsCount: Number(item.comments_count ?? item.commentsCount ?? item.comments ?? 0),
      sourceType,
      sourceName: cleanText(item.sourceName || item.source || sourceName, 80),
      username: cleanText(item.username || username, 80),
    }))
    .filter((item) => item.caption && (item.permalink || item.id));
}

function uniqueInstagramMedia(media) {
  const seen = new Set();
  return media.filter((item) => {
    const key = item.permalink || item.id;
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function instagramDealSignal(value, referenceDate) {
  let score = 0;
  let type = "deal";
  let category = "events";

  if (containsAny(value, ["gratis", "kostenlos", "free", "geschenkt", "0 euro", "0€"])) {
    score += 32;
    type = "gratis";
  }
  if (containsAny(value, ["rabatt", "gutschein", "coupon", "code", "aktion", "deal", "angebot", "sale", "%", "2fur1", "2 fuer 1", "happy hour"])) {
    score += 26;
    type = type === "gratis" ? type : "rabatt";
  }
  if (containsAny(value, ["gewinnspiel", "verlosung", "giveaway"])) {
    score += 24;
    category = "gewinnspiel";
  }
  if (containsAny(value, ["event", "workshop", "konzert", "opening", "eroffnung", "veranstaltung", "ticket"])) {
    score += 16;
    category = "events";
  }
  if (containsAny(value, ["kaffee", "coffee", "cafe", "espresso", "matcha"])) category = "kaffee";
  if (containsAny(value, ["burger", "pizza", "brunch", "restaurant", "food", "essen", "kebab", "doner", "doener"])) category = "essen";
  if (containsAny(value, ["museum", "kino", "kultur", "ausstellung", "theater"])) category = "kultur";
  if (containsAny(value, ["fitness", "yoga", "gym", "training", "sport"])) category = "fitness";
  if (containsAny(value, ["beauty", "friseur", "kosmetik", "salon", "wellness"])) category = "beauty";
  if (containsAny(value, ["shop", "store", "markt", "shopping", "billa", "spar", "hofer", "lidl"])) category = "shopping";

  const dates = datesFromText(value, referenceDate);
  const futureDate = dates.find((date) => startOfDay(date).getTime() >= startOfDay(referenceDate).getTime());
  if (futureDate) score += 12;

  return { score, type, category, futureDate };
}

function isViennaRelevant(value) {
  return containsAny(value, [
    "wien",
    "vienna",
    "viennese",
    "innere stadt",
    "leopoldstadt",
    "landstrasse",
    "wieden",
    "margareten",
    "mariahilf",
    "neubau",
    "josefstadt",
    "alsergrund",
    "favoriten",
    "meidling",
    "hietzing",
    "penzing",
    "rudolfsheim",
    "ottakring",
    "hernals",
    "wahring",
    "waehring",
    "dobling",
    "doebling",
    "brigittenau",
    "floridsdorf",
    "donaustadt",
    "liesing",
    "1010",
    "1020",
    "1030",
    "1040",
    "1050",
    "1060",
    "1070",
    "1080",
    "1090",
    "1100",
    "1110",
    "1120",
    "1130",
    "1140",
    "1150",
    "1160",
    "1170",
    "1180",
    "1190",
    "1200",
    "1210",
    "1220",
    "1230",
    "online",
    "app",
  ]);
}

function isCurrentOrFutureInstagramPost(item, normalizedCaption, referenceDate) {
  if (containsAny(normalizedCaption, ["abgelaufen", "vorbei", "gestern letzter tag", "last chance gestern"])) return false;

  const dates = datesFromText(normalizedCaption, referenceDate);
  if (dates.some((date) => startOfDay(date).getTime() >= startOfDay(referenceDate).getTime())) return true;
  if (dates.length && containsAny(normalizedCaption, ["am ", "bis ", "gultig", "gueltig", "nur am", "endet"])) return false;

  return isRecentTimestamp(item.timestamp, referenceDate, 90) || containsAny(normalizedCaption, ["heute", "morgen", "wochenende", "diese woche", "diesen monat", "laufend", "solange der vorrat"]);
}

function datesFromText(value, referenceDate) {
  const dates = [];
  const raw = normalize(value);
  const currentYear = referenceDate.getFullYear();

  for (const match of raw.matchAll(/(\d{1,2})\.(\d{1,2})\.?(\d{2,4})?/g)) {
    const day = Number(match[1]);
    const month = Number(match[2]);
    let year = match[3] ? Number(match[3]) : currentYear;
    if (year < 100) year += 2000;
    let date = endOfDay(year, month, day);
    if (!match[3] && startOfDay(date).getTime() < startOfDay(referenceDate).getTime()) {
      date = endOfDay(year + 1, month, day);
    }
    if (!Number.isNaN(date.getTime())) dates.push(date);
  }

  for (const match of raw.matchAll(/(\d{4})-(\d{1,2})-(\d{1,2})/g)) {
    const date = endOfDay(Number(match[1]), Number(match[2]), Number(match[3]));
    if (!Number.isNaN(date.getTime())) dates.push(date);
  }

  return dates.sort((a, b) => a.getTime() - b.getTime());
}

function expiryTextFromCaption(caption, referenceDate) {
  const dates = datesFromText(caption, referenceDate);
  if (!dates.length) {
    const value = normalize(caption);
    if (value.includes("heute")) return "Heute";
    if (value.includes("morgen")) return "Morgen";
    if (value.includes("wochenende")) return "Dieses Wochenende";
    return "";
  }

  const future = dates.find((date) => startOfDay(date).getTime() >= startOfDay(referenceDate).getTime());
  return future ? `Bis ${formatGermanDate(future)}` : "";
}

function formatGermanDate(date) {
  return `${String(date.getDate()).padStart(2, "0")}.${String(date.getMonth() + 1).padStart(2, "0")}.${date.getFullYear()}`;
}

function isRecentTimestamp(timestamp, referenceDate, days) {
  const parsed = Date.parse(timestamp || "");
  if (Number.isNaN(parsed)) return false;
  const ageMs = referenceDate.getTime() - parsed;
  return ageMs >= 0 && ageMs <= days * 24 * 60 * 60 * 1000;
}

function inferInstagramBrand(item, caption) {
  if (item.username) return `@${item.username}`;
  const mention = String(caption || "").match(/@([a-zA-Z0-9._]{2,30})/);
  if (mention) return `@${mention[1]}`;
  if (item.sourceName && item.sourceName.startsWith("@")) return item.sourceName;
  return "Instagram";
}

function inferInstagramTitle(caption, signal) {
  const source = cleanText(caption, 2200).replace(/#[^\s#]+/g, "").trim();
  const sentence = source.split(/[.!?\n]/).map((part) => cleanText(part, 120)).find((part) => part.length >= 8);
  const prefix = signal.type === "gratis" ? "Gratis" : signal.type === "rabatt" ? "Deal" : "Instagram Deal";
  return cleanText(sentence || `${prefix} in Wien`, 120);
}

function inferInstagramDescription(caption) {
  const source = cleanText(caption, 2200).replace(/#[^\s#]+/g, "").replace(/@\w[\w.]+/g, "").trim();
  return cleanText(source, 280) || "Aktueller Instagram-Deal fuer Wien. Details bitte direkt bei Instagram pruefen.";
}

function inferInstagramLocation(caption) {
  const normalizedCaption = normalize(caption);
  const district = normalizedCaption.match(/\b(10[1-9]0|11[0-9]0|12[0-3]0)\b/);
  if (district) return `Wien ${district[1]}`;
  return "Wien";
}

function normalizeInstagramType(type, sourceText) {
  const value = normalize([type, sourceText].filter(Boolean).join(" "));
  if (containsAny(value, ["gratis", "kostenlos", "free", "0 euro", "0€"])) return "gratis";
  if (containsAny(value, ["testabo", "probeabo", "trial"])) return "testabo";
  if (containsAny(value, ["rabatt", "gutschein", "coupon", "sale", "%", "aktion"])) return "rabatt";
  if (containsAny(value, ["event", "veranstaltung", "workshop", "konzert"])) return "event";
  return "deal";
}

function stableHash(value) {
  let hash = 2166136261;
  const source = String(value || "instagram");
  for (let index = 0; index < source.length; index += 1) {
    hash ^= source.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

async function cachedInstagramAgentResponse(env) {
  if (!env.MERCHANT_CAMPAIGNS) return null;
  const cached = await env.MERCHANT_CAMPAIGNS.get(INSTAGRAM_CACHE_KEY, "json");
  if (!cached?.generatedAt) return null;
  const ageSeconds = (Date.now() - Date.parse(cached.generatedAt)) / 1000;
  if (!Number.isFinite(ageSeconds) || ageSeconds > INSTAGRAM_CACHE_SECONDS) return null;
  return cached;
}

async function storeInstagramAgentResponse(env, response) {
  if (!env.MERCHANT_CAMPAIGNS) return;
  await env.MERCHANT_CAMPAIGNS.put(INSTAGRAM_CACHE_KEY, JSON.stringify(response), {
    expirationTtl: INSTAGRAM_CACHE_SECONDS + 10 * 60,
  });
}

function heuristicDealIssues(deals) {
  const issues = [];
  const ids = new Set();

  for (const deal of deals) {
    const id = cleanText(deal.id, 120) || crypto.randomUUID();
    const source = normalize([deal.brand, deal.title, deal.description, deal.category, deal.location, deal.distance].filter(Boolean).join(" "));
    const category = normalize(deal.category);

    if (ids.has(id)) {
      issues.push(dealIssue(deal, "high", "Doppelte Deal-ID gefunden.", "ID eindeutig machen, damit Deep Links sicher zum richtigen Deal führen."));
    }
    ids.add(id);

    if (!cleanText(deal.title, 180)) {
      issues.push(dealIssue(deal, "high", "Deal-Titel fehlt.", "Titel ergänzen, bevor der Deal sichtbar bleibt."));
    }

    if (!cleanURL(deal.url)) {
      issues.push(dealIssue(deal, "medium", "Deal-Link fehlt oder ist ungültig.", "Prüfbaren HTTPS-Link ergänzen."));
    }

    if (category === "reisen" && containsAny(source, ["omv", "topwash", "maxxmotion", "tankstelle", "benzin", "diesel"])) {
      issues.push(dealIssue(deal, "medium", "OMV/Tankstellen-Deal ist als Reisen markiert.", "Nicht in Flüge anzeigen; Kaffee, Shopping oder Rabatt/Alle ist passender."));
    }

    if (category === "fluege" && !containsAny(source, ["flug", "fluege", "flight", "airport", "flughafen", "ryanair", "airline", "wizz", "austrian"])) {
      issues.push(dealIssue(deal, "medium", "Flüge-Kategorie ohne Flug-Signal.", "Kategorie oder Deal-Text prüfen."));
    }
  }

  return issues;
}

function automaticDealCorrections(deals) {
  const fixes = [];
  const removedDealIDs = [];
  const ids = new Set();
  const now = new Date();

  for (const deal of deals) {
    const dealID = cleanText(deal.id, 120);
    if (!dealID) continue;

    if (ids.has(dealID)) {
      removedDealIDs.push(dealID);
      continue;
    }
    ids.add(dealID);

    if (isExpiredDeal(deal, now)) {
      removedDealIDs.push(dealID);
      continue;
    }

    const category = correctedCategory(deal);
    if (category && category !== normalize(deal.category)) {
      fixes.push({ dealID, field: "category", value: category });
    }
  }

  return { fixes: fixes.slice(0, 80), removedDealIDs: removedDealIDs.slice(0, 80) };
}

function correctedCategory(deal) {
  const current = normalize(deal.category) === "gottesdienste" ? "kirche" : normalize(deal.category);
  const source = normalize([deal.brand, deal.title, deal.description, deal.source, deal.location, deal.distance].filter(Boolean).join(" "));
  const canOverride = !current || current === "reisen" || current === "fluege";

  if (containsAny(source, ["flug", "fluge", "fluege", "flight", "airport", "flughafen", "ryanair", "wizz", "austrian", "airline", "flugzeug"])) {
    return "fluege";
  }

  if (containsAny(source, ["omv", "viva", "topwash", "maxxmotion", "tankstelle", "benzin", "diesel"])) {
    if (containsAny(source, ["kaffee", "coffee", "espresso", "latte", "matcha", "cappuccino"])) return "kaffee";
    if (containsAny(source, ["burger", "sandwich", "snack", "essen", "food", "meal", "tonic", "strawberry"])) return "essen";
    return "shopping";
  }

  if (!canOverride) return current;

  if (containsAny(source, ["gottesdienst", "messe", "kirche", "christlich", "hillsong", "icf", "jesuszentrum"])) {
    return "kirche";
  }
  if (containsAny(source, ["kaffee", "coffee", "espresso", "latte", "matcha", "cafe"])) return "kaffee";
  if (containsAny(source, ["burger", "doner", "doener", "kebab", "restaurant", "pizza", "wolt", "foodora", "essen", "food", "bowl", "cheesecake"])) return "essen";
  if (containsAny(source, ["fitness", "sport", "gym", "training", "yoga"])) return "fitness";
  if (containsAny(source, ["streaming", "spotify", "netflix", "disney", "prime video"])) return "streaming";
  if (containsAny(source, ["gewinnspiel", "verlosung", "lotterie"])) return "gewinnspiel";
  if (containsAny(source, ["museum", "kino", "kultur", "ticket", "autodrom", "vorteilsclub"])) return "kultur";
  if (containsAny(source, ["event", "veranstaltung", "workshop", "konzert", "community", "treffen"])) return "events";
  if (containsAny(source, ["beauty", "friseur", "kosmetik", "salon", "wellness"])) return "beauty";
  if (containsAny(source, ["shop", "store", "spar", "billa", "hofer", "lidl", "xxxlutz", "markt"])) return "shopping";
  return current;
}

function isExpiredDeal(deal, referenceDate) {
  const raw = cleanText(deal.expires, 120);
  if (!raw) return false;

  const value = normalize(raw);
  if (value === "siehe deal" || value.includes("heute") || value.includes("endet in") || value.includes("noch")) return false;
  if (value.includes("gestern") || value.includes("abgelaufen") || value.includes("vorbei") || value.includes("expired")) return true;

  const parsed = parseDealDate(raw, referenceDate);
  if (!parsed) return false;

  return startOfDay(parsed).getTime() < startOfDay(referenceDate).getTime();
}

function parseDealDate(value, referenceDate = new Date()) {
  const candidates = [];

  for (const match of value.matchAll(/(\d{1,2})\.(\d{1,2})\.(\d{2,4})\b/g)) {
    let year = Number(match[3]);
    if (year < 100) year += 2000;
    candidates.push(endOfDay(year, Number(match[2]), Number(match[1])));
  }

  for (const match of value.matchAll(/(\d{4})-(\d{1,2})-(\d{1,2})/g)) {
    candidates.push(endOfDay(Number(match[1]), Number(match[2]), Number(match[3])));
  }

  const monthMatch = normalize(value).match(/(januar|janner|jaenner|februar|marz|maerz|april|mai|juni|juli|august|september|oktober|november|dezember)\s+(\d{4})/);
  if (monthMatch) {
    const month = monthNumber(monthMatch[1]);
    const year = Number(monthMatch[2]);
    if (month && year) {
      const lastDay = new Date(year, month, 0).getDate();
      candidates.push(endOfDay(year, month, lastDay));
    }
  }

  if (candidates.length) {
    return candidates
      .filter((date) => !Number.isNaN(date.getTime()))
      .sort((a, b) => b.getTime() - a.getTime())[0] || null;
  }

  const shortDayMatch = value.match(/(\d{1,2})\.(\d{1,2})(?:\.)?(?!\d)/);
  if (shortDayMatch) {
    return endOfDay(referenceDate.getFullYear(), Number(shortDayMatch[2]), Number(shortDayMatch[1]));
  }

  const iso = Date.parse(value);
  if (!Number.isNaN(iso)) return new Date(iso);

  return null;
}

function startOfDay(date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function endOfDay(year, month, day) {
  return new Date(year, month - 1, day, 23, 59, 59, 999);
}

function monthNumber(value) {
  return {
    januar: 1,
    janner: 1,
    jaenner: 1,
    februar: 2,
    marz: 3,
    maerz: 3,
    april: 4,
    mai: 5,
    juni: 6,
    juli: 7,
    august: 8,
    september: 9,
    oktober: 10,
    november: 11,
    dezember: 12,
  }[value];
}

function normalizeDealIssues(issues, deals) {
  if (!Array.isArray(issues)) return [];
  const validIDs = new Set(deals.map((deal) => cleanText(deal.id, 120)).filter(Boolean));
  return issues
    .map((issue, index) => ({
      id: cleanText(issue.id, 160) || `issue-${index}`,
      dealID: cleanText(issue.dealID, 120),
      severity: ["low", "medium", "high"].includes(issue.severity) ? issue.severity : "medium",
      message: cleanText(issue.message, 260),
      suggestion: cleanText(issue.suggestion, 320),
    }))
    .filter((issue) => issue.dealID && validIDs.has(issue.dealID) && issue.message && issue.suggestion);
}

function dealIssue(deal, severity, message, suggestion) {
  const dealID = cleanText(deal.id, 120) || crypto.randomUUID();
  const brand = cleanText(deal.brand, 90) || "Deal";
  return {
    id: `${dealID}-${severity}-${message}`.slice(0, 160),
    dealID,
    severity,
    message: `${brand}: ${message}`,
    suggestion,
  };
}

async function createCampaign(request, env) {
  const payload = await readPayload(request);
  const packageId = cleanText(payload.packageId, 32);
  const config = PACKAGE_CONFIG[packageId];
  const paymentProvider = normalize(payload.paymentProvider);
  const platform = normalize(payload.platform) || (paymentProvider === "stripe" ? "web" : "ios");
  const isStripePayment = paymentProvider === "stripe" || platform === "web" || Boolean(cleanText(payload.stripeSessionId, 160));
  const merchantSecret = cleanText(env.MERCHANT_API_SECRET, 300);
  if (isStripePayment && merchantSecret) {
    const presentedSecret = cleanText(request.headers.get("x-freefinder-merchant-secret"), 300);
    if (presentedSecret !== merchantSecret) {
      return json({ ok: false, error: "Merchant API secret is invalid" }, 401);
    }
  }

  if (!config) {
    return json({ ok: false, error: "Unknown package" }, 400);
  }

  const productId = cleanText(payload.productId, 160);
  if (!isStripePayment && productId && productId !== config.productId) {
    return json({ ok: false, error: "Product does not match package" }, 400);
  }

  const transactionId = cleanText(payload.transactionId, 120);
  if (!transactionId) {
    return json({ ok: false, error: "Missing transactionId" }, 400);
  }

  const verification = isStripePayment
    ? await verifyStripePayment(payload, config, env, packageId)
    : platform === "android"
    ? await verifyGooglePlayPurchase(payload, config, env)
    : await verifyAppStoreTransaction(payload, config, env);
  if (!verification.ok) {
    return json({ ok: false, error: verification.error }, verification.status || 400);
  }

  const duplicateId = await env.MERCHANT_CAMPAIGNS.get(TRANSACTION_PREFIX + transactionId);
  if (duplicateId) {
    const existing = await env.MERCHANT_CAMPAIGNS.get(CAMPAIGN_PREFIX + duplicateId, "json");
    if (existing) {
      await rememberCampaignId(env, existing.id);
      return json({ ok: true, campaign: existing, duplicate: true });
    }
  }

  const restaurantName = cleanText(payload.restaurantName, 90);
  const dealTitle = cleanText(payload.dealTitle, 110);
  if (!restaurantName || !dealTitle) {
    return json({ ok: false, error: "Restaurant and deal title are required" }, 400);
  }

  const now = Date.now();
  const durationMs = config.durationDays * 24 * 60 * 60 * 1000;
  const campaign = {
    id: crypto.randomUUID(),
    status: "paid",
    packageId,
    packageName: config.name,
    productId: verification.transaction.productId || config.productId,
    transactionId,
    platform,
    paymentProvider: isStripePayment ? "stripe" : platform,
    originalTransactionId: verification.transaction.originalTransactionId,
    appStoreEnvironment: verification.transaction.environment,
    appStoreSignedDate: verification.transaction.signedDate,
    appStorePurchaseDate: verification.transaction.purchaseDate,
    googlePlayOrderId: verification.transaction.googlePlayOrderId,
    googlePlayPurchaseToken: verification.transaction.googlePlayPurchaseToken,
    googlePlayPurchaseState: verification.transaction.googlePlayPurchaseState,
    googlePlayConsumptionState: verification.transaction.googlePlayConsumptionState,
    stripeSessionId: verification.transaction.stripeSessionId,
    stripePaymentIntentId: verification.transaction.stripePaymentIntentId,
    stripeCustomerId: verification.transaction.stripeCustomerId,
    stripeAmountTotal: verification.transaction.stripeAmountTotal,
    stripeCurrency: verification.transaction.stripeCurrency,
    restaurantName,
    dealTitle,
    description: cleanText(payload.description, 360),
    oldPrice: cleanText(payload.oldPrice, 40),
    dealPrice: cleanText(payload.dealPrice, 40),
    address: cleanText(payload.address, 140),
    ctaURL: cleanURL(payload.ctaURL),
    contactEmail: cleanText(payload.contactEmail, 120),
    category: cleanText(payload.category, 40),
    createdAt: now,
    startsAt: now,
    endsAt: now + durationMs,
  };

  const ttl = Math.ceil(durationMs / 1000) + 7 * 24 * 60 * 60;
  await env.MERCHANT_CAMPAIGNS.put(CAMPAIGN_PREFIX + campaign.id, JSON.stringify(campaign), {
    expirationTtl: ttl,
  });
  await env.MERCHANT_CAMPAIGNS.put(TRANSACTION_PREFIX + transactionId, campaign.id, {
    expirationTtl: ttl,
  });
  await rememberCampaignId(env, campaign.id);
  await notifySlackCampaign(env, campaign);

  return json({ ok: true, campaign }, 201);
}

async function verifyStripePayment(payload, config, env, packageId) {
  const secretKey = cleanText(env.STRIPE_SECRET_KEY, 300);
  if (!secretKey) {
    return { ok: false, status: 503, error: "Stripe payment verification is not configured" };
  }

  const sessionId = cleanText(payload.stripeSessionId || payload.originalTransactionId || payload.transactionId, 160);
  if (!sessionId || !sessionId.startsWith("cs_")) {
    return { ok: false, status: 400, error: "Missing Stripe Checkout Session ID" };
  }

  const sessionResult = await fetchStripeCheckoutSession(sessionId, secretKey);
  if (!sessionResult.ok) return sessionResult;

  const session = sessionResult.session || {};
  const metadata = session.metadata || {};
  const metadataPackageId = cleanText(metadata.merchant_package_id, 32);
  const metadataSource = cleanText(metadata.source, 80);
  const paymentStatus = normalize(session.payment_status);
  const sessionStatus = normalize(session.status);
  const currency = normalize(session.currency);
  const amountTotal = Number(session.amount_total || 0);
  const expectedTransactionId = cleanText(session.payment_intent || sessionId, 160);
  const payloadTransactionId = cleanText(payload.transactionId, 160);

  if (metadataPackageId !== packageId) {
    return { ok: false, status: 400, error: "Stripe payment package does not match campaign" };
  }
  if (payloadTransactionId && payloadTransactionId !== expectedTransactionId && payloadTransactionId !== sessionId) {
    return { ok: false, status: 400, error: "Stripe transaction ID does not match session" };
  }
  if (metadataSource !== "freefinder-web") {
    return { ok: false, status: 400, error: "Stripe payment source does not match FreeFinder web" };
  }
  if (paymentStatus !== "paid") {
    return { ok: false, status: 400, error: "Stripe payment is not paid" };
  }
  if (sessionStatus && sessionStatus !== "complete") {
    return { ok: false, status: 400, error: "Stripe checkout session is not complete" };
  }
  if (currency && currency !== "eur") {
    return { ok: false, status: 400, error: "Stripe payment currency does not match package" };
  }
  if (amountTotal < 0 || amountTotal > config.unitAmount) {
    return { ok: false, status: 400, error: "Stripe payment amount does not match package" };
  }

  return {
    ok: true,
    transaction: {
      transactionId: expectedTransactionId || sessionId,
      originalTransactionId: sessionId,
      productId: cleanText(payload.productId, 180),
      bundleId: "freefinder-web",
      environment: "stripe",
      signedDate: Number(session.created || 0) ? Number(session.created) * 1000 : Date.now(),
      purchaseDate: Number(session.created || 0) ? Number(session.created) * 1000 : Date.now(),
      stripeSessionId: sessionId,
      stripePaymentIntentId: cleanText(session.payment_intent || payload.stripePaymentIntentId, 160),
      stripeCustomerId: cleanText(session.customer || payload.stripeCustomerId, 160),
      stripeAmountTotal: amountTotal,
      stripeCurrency: currency,
    },
  };
}

async function fetchStripeCheckoutSession(sessionId, secretKey) {
  const url = new URL(`https://api.stripe.com/v1/checkout/sessions/${encodeURIComponent(sessionId)}`);
  url.searchParams.append("expand[]", "line_items.data.price");
  const response = await fetch(url.toString(), {
    headers: {
      authorization: `Bearer ${secretKey}`,
      accept: "application/json",
      "stripe-version": STRIPE_API_VERSION,
    },
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    return {
      ok: false,
      status: response.status,
      error: cleanText(body.error?.message, 220) || "Stripe Checkout Session could not be verified",
    };
  }
  return { ok: true, session: body };
}

async function notifySlackCampaign(env, campaign) {
  const webhookURL = cleanURL(env.SLACK_WEBHOOK_URL);
  const botToken = cleanText(env.SLACK_BOT_TOKEN, 3000);
  const channel = cleanText(env.SLACK_CHANNEL_ID, 120);
  if (!webhookURL && (!botToken || !channel)) return;

  const lines = [
    `Paket: ${campaign.packageName || campaign.packageId}`,
    `Anbieter: ${campaign.restaurantName}`,
    `Deal: ${campaign.dealTitle}`,
    campaign.address ? `Ort: ${campaign.address}` : "",
    campaign.ctaURL ? `Link: ${campaign.ctaURL}` : "",
    campaign.endsAt ? `Sichtbar bis: ${new Date(campaign.endsAt).toISOString()}` : "",
    `Quelle: ${campaign.paymentProvider || campaign.platform || "unknown"}`,
  ].filter(Boolean);

  const heading = campaign.paymentProvider === 'promo' ? 'Neue Business-Anzeige: kostenloser Starter Boost' : 'Neue Business-Anzeige bezahlt';
  const payload = {
    text: `${heading}: ${campaign.restaurantName} - ${campaign.dealTitle}`,
    blocks: [
      {
        type: "header",
        text: { type: "plain_text", text: heading },
      },
      {
        type: "section",
        text: { type: "mrkdwn", text: lines.map((line) => `* ${line}`).join("\n") },
      },
    ],
  };

  try {
    const response = webhookURL
      ? await fetch(webhookURL, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      })
      : await fetch("https://slack.com/api/chat.postMessage", {
        method: "POST",
        headers: {
          authorization: `Bearer ${botToken}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({ ...payload, channel }),
      });
    if (!response.ok) {
      console.log("Slack campaign notification failed", response.status);
    } else if (!webhookURL) {
      const body = await response.json().catch(() => ({}));
      if (body?.ok === false) {
        console.log("Slack campaign notification failed", cleanText(body.error, 120) || "unknown error");
      }
    }
  } catch (error) {
    console.log("Slack campaign notification failed", error?.message || "unknown error");
  }
}

async function verifyAppStoreTransaction(payload, config, env) {
  const transactionId = cleanText(payload.transactionId, 120);
  const appStore = await fetchAppStoreTransaction(transactionId, env);
  if (!appStore.ok) {
    return appStore;
  }

  const transaction = decodeJWSPayload(appStore.signedTransactionInfo);
  if (!transaction) {
    return { ok: false, status: 502, error: "App Store returned an unreadable transaction" };
  }

  const bundleId = cleanText(transaction.bundleId, 180);
  const productId = cleanText(transaction.productId, 180);
  const verifiedTransactionId = cleanText(transaction.transactionId, 120);
  const purchaseDate = Number(transaction.purchaseDate || 0);
  const signedDate = Number(transaction.signedDate || 0);

  if (bundleId !== appStoreBundleId(env)) {
    return { ok: false, status: 400, error: "Transaction bundle does not match this app" };
  }
  if (productId !== config.productId) {
    return { ok: false, status: 400, error: "Transaction product does not match package" };
  }
  if (verifiedTransactionId !== transactionId) {
    return { ok: false, status: 400, error: "Transaction ID was not verified by Apple" };
  }
  if (transaction.revocationDate || transaction.revocationReason) {
    return { ok: false, status: 400, error: "Transaction has been revoked" };
  }
  if (!purchaseDate || Date.now() - purchaseDate > 30 * 24 * 60 * 60 * 1000) {
    return { ok: false, status: 400, error: "Transaction is too old for a new campaign" };
  }

  return {
    ok: true,
    transaction: {
      transactionId: verifiedTransactionId,
      originalTransactionId: cleanText(transaction.originalTransactionId, 120),
      productId,
      bundleId,
      environment: cleanText(transaction.environment || appStore.environment, 40),
      signedDate,
      purchaseDate,
    },
  };
}

async function verifyGooglePlayPurchase(payload, config, env) {
  const purchaseToken = cleanText(payload.purchaseToken, 1200);
  if (!purchaseToken) {
    return { ok: false, status: 400, error: "Missing Google Play purchase token" };
  }

  const productId = cleanText(payload.productId, 180) || config.productId;
  if (productId !== config.productId) {
    return { ok: false, status: 400, error: "Google Play product does not match package" };
  }

  const accessToken = await googlePlayAccessToken(env);
  if (!accessToken.ok) {
    return accessToken;
  }

  const packageName = cleanText(env.GOOGLE_PLAY_PACKAGE_NAME, 180) || "com.stefanataalla.freefinderwien";
  const url = `https://androidpublisher.googleapis.com/androidpublisher/v3/applications/${encodeURIComponent(packageName)}/purchases/products/${encodeURIComponent(productId)}/tokens/${encodeURIComponent(purchaseToken)}`;
  const response = await fetch(url, {
    headers: {
      authorization: `Bearer ${accessToken.token}`,
      accept: "application/json",
    },
  });

  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    return {
      ok: false,
      status: response.status,
      error: cleanText(body.error?.message, 220) || "Google Play purchase could not be verified",
    };
  }

  const purchaseState = Number(body.purchaseState ?? 1);
  if (purchaseState !== 0) {
    return { ok: false, status: 400, error: "Google Play purchase is not completed" };
  }

  const purchaseTime = Number(body.purchaseTimeMillis || payload.purchaseTime || 0);
  if (!purchaseTime || Date.now() - purchaseTime > 30 * 24 * 60 * 60 * 1000) {
    return { ok: false, status: 400, error: "Google Play purchase is too old for a new campaign" };
  }

  return {
    ok: true,
    transaction: {
      transactionId: cleanText(body.orderId, 140) || cleanText(payload.transactionId, 140) || purchaseToken.slice(0, 120),
      originalTransactionId: cleanText(body.orderId, 140) || cleanText(payload.transactionId, 140) || purchaseToken.slice(0, 120),
      productId,
      bundleId: packageName,
      environment: "google_play",
      signedDate: purchaseTime,
      purchaseDate: purchaseTime,
      googlePlayOrderId: cleanText(body.orderId, 160),
      googlePlayPurchaseToken: purchaseToken,
      googlePlayPurchaseState: purchaseState,
      googlePlayConsumptionState: Number(body.consumptionState ?? -1),
    },
  };
}

async function googlePlayAccessToken(env) {
  const directToken = cleanText(env.GOOGLE_PLAY_ACCESS_TOKEN, 3000);
  if (directToken) return { ok: true, token: directToken };

  const rawServiceAccount = env.GOOGLE_PLAY_SERVICE_ACCOUNT_JSON;
  if (!rawServiceAccount) {
    return { ok: false, status: 503, error: "Google Play verification is not configured" };
  }

  let account;
  try {
    account = typeof rawServiceAccount === "string" ? JSON.parse(rawServiceAccount) : rawServiceAccount;
  } catch {
    return { ok: false, status: 503, error: "Google Play service account JSON is invalid" };
  }

  const clientEmail = cleanText(account.client_email, 240);
  const privateKey = String(account.private_key || "");
  if (!clientEmail || !privateKey) {
    return { ok: false, status: 503, error: "Google Play service account credentials are incomplete" };
  }

  const now = Math.floor(Date.now() / 1000);
  const assertion = await signGoogleServiceAccountJWT(clientEmail, privateKey, now);
  const tokenResponse = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion,
    }),
  });
  const tokenPayload = await tokenResponse.json().catch(() => ({}));
  if (!tokenResponse.ok || !tokenPayload.access_token) {
    return {
      ok: false,
      status: 503,
      error: cleanText(tokenPayload.error_description || tokenPayload.error, 220) || "Google Play access token could not be created",
    };
  }
  return { ok: true, token: tokenPayload.access_token };
}

async function signGoogleServiceAccountJWT(clientEmail, privateKeyPEM, issuedAt) {
  const header = { alg: "RS256", typ: "JWT" };
  const payload = {
    iss: clientEmail,
    scope: "https://www.googleapis.com/auth/androidpublisher",
    aud: "https://oauth2.googleapis.com/token",
    iat: issuedAt,
    exp: issuedAt + 3600,
  };
  const signingInput = `${base64URLJSON(header)}.${base64URLJSON(payload)}`;
  const key = await crypto.subtle.importKey(
    "pkcs8",
    pemToArrayBuffer(privateKeyPEM),
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const signature = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", key, new TextEncoder().encode(signingInput));
  return `${signingInput}.${base64URLBytes(signature)}`;
}

async function fetchAppStoreTransaction(transactionId, env) {
  const credentials = appStoreCredentials(env);
  if (!credentials.ok) {
    return credentials;
  }

  const token = await appStoreServerToken(credentials);
  const encodedId = encodeURIComponent(transactionId);
  const endpoints = [
    ["Production", `https://api.storekit.itunes.apple.com/inApps/v1/transactions/${encodedId}`],
    ["Sandbox", `https://api.storekit-sandbox.itunes.apple.com/inApps/v1/transactions/${encodedId}`],
  ];

  let lastError = "Transaction was not accepted by Apple";
  for (const [environment, endpoint] of endpoints) {
    const response = await fetch(endpoint, {
      headers: {
        authorization: `Bearer ${token}`,
        accept: "application/json",
      },
    });

    if (response.ok) {
      const body = await response.json();
      if (body?.signedTransactionInfo) {
        return { ok: true, environment, signedTransactionInfo: body.signedTransactionInfo };
      }
      return { ok: false, status: 502, error: "App Store transaction response was incomplete" };
    }

    const text = await response.text();
    lastError = cleanText(text, 220) || `App Store verification failed with HTTP ${response.status}`;
    if (response.status === 401 || response.status === 403) {
      return { ok: false, status: 502, error: "App Store verification credentials were rejected" };
    }
  }

  return { ok: false, status: 400, error: lastError };
}

function appStoreCredentials(env) {
  const issuerId = normalizeAppleIssuerId(env.APP_STORE_CONNECT_ISSUER_ID);
  const keyId = cleanText(env.APP_STORE_CONNECT_KEY_ID, 40);
  const privateKey = String(env.APP_STORE_CONNECT_PRIVATE_KEY || "").replace(/\\n/g, "\n").trim();
  const bundleId = appStoreBundleId(env);

  if (!issuerId || !keyId || !privateKey || !bundleId) {
    return { ok: false, status: 503, error: "App Store transaction verification is not configured" };
  }

  return { ok: true, issuerId, keyId, privateKey, bundleId };
}

function normalizeAppleIssuerId(value) {
  const raw = cleanText(value, 80);
  const compact = raw.replace(/[^0-9a-f]/gi, "");
  if (compact.length === 32) {
    return `${compact.slice(0, 8)}-${compact.slice(8, 12)}-${compact.slice(12, 16)}-${compact.slice(16, 20)}-${compact.slice(20)}`.toLowerCase();
  }
  return raw;
}

function appStoreBundleId(env) {
  return cleanText(env.APP_STORE_BUNDLE_ID || "com.stefanataalla.freefinderwien", 180);
}

async function appStoreServerToken(credentials) {
  const now = Math.floor(Date.now() / 1000);
  const header = base64URLJSON({ alg: "ES256", kid: credentials.keyId, typ: "JWT" });
  const payload = base64URLJSON({
    iss: credentials.issuerId,
    iat: now,
    exp: now + 900,
    aud: "appstoreconnect-v1",
    bid: credentials.bundleId,
  });
  const signingInput = `${header}.${payload}`;
  const key = await crypto.subtle.importKey(
    "pkcs8",
    pemToArrayBuffer(credentials.privateKey),
    { name: "ECDSA", namedCurve: "P-256" },
    false,
    ["sign"]
  );
  const signature = await crypto.subtle.sign(
    { name: "ECDSA", hash: "SHA-256" },
    key,
    new TextEncoder().encode(signingInput)
  );
  return `${signingInput}.${base64URLBytes(signature)}`;
}

function decodeJWSPayload(jws) {
  const parts = String(jws || "").split(".");
  if (parts.length < 2) return null;
  try {
    return JSON.parse(new TextDecoder().decode(base64URLToBytes(parts[1])));
  } catch {
    return null;
  }
}

function base64URLJSON(value) {
  return base64URLBytes(new TextEncoder().encode(JSON.stringify(value)));
}

function base64URLBytes(value) {
  const bytes = value instanceof ArrayBuffer ? new Uint8Array(value) : new Uint8Array(value.buffer || value);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function base64URLToBytes(value) {
  const base64 = String(value || "").replace(/-/g, "+").replace(/_/g, "/");
  const padded = base64.padEnd(Math.ceil(base64.length / 4) * 4, "=");
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

function pemToArrayBuffer(pem) {
  const base64 = pem
    .replace("-----BEGIN PRIVATE KEY-----", "")
    .replace("-----END PRIVATE KEY-----", "")
    .replace(/\s+/g, "");
  return base64URLToBytes(base64.replace(/\+/g, "-").replace(/\//g, "_")).buffer;
}

async function listCampaigns(env) {
  const ids = await campaignIndex(env);
  const now = Date.now();
  const campaigns = [];

  await Promise.all(
    ids.map(async (id) => {
      const campaign = await env.MERCHANT_CAMPAIGNS.get(CAMPAIGN_PREFIX + id, "json");
      if (!campaign || campaign.status !== "paid") return;
      if (campaign.endsAt && campaign.endsAt <= now) return;
      campaigns.push(campaign);
    })
  );

  campaigns.sort((a, b) => packageRank(b.packageId) - packageRank(a.packageId) || (b.createdAt || 0) - (a.createdAt || 0));
  // Preserve the paid selection while ensuring gifts cannot be silently hidden
  // by that selection's historical twelve-campaign cap.
  campaigns.splice(12);
  const ledger = promoLedger(env);
  if (ledger) {
    try {
      const response = await ledger.fetch(new Request('https://promo.internal/active'));
      if (response.ok) campaigns.push(...(await response.json()).campaigns);
    } catch {
      // A promotion outage must not remove existing paid campaigns.
      console.error('Promo campaign feed temporarily unavailable');
    }
  }
  campaigns.sort((a, b) => packageRank(b.packageId) - packageRank(a.packageId) || (b.createdAt || 0) - (a.createdAt || 0));
  return json({ ok: true, campaigns, packages: publicPackages() });
}

async function campaignIndex(env) {
  const ids = await env.MERCHANT_CAMPAIGNS.get(INDEX_KEY, "json");
  return Array.isArray(ids) ? ids.filter(Boolean).slice(0, MAX_CAMPAIGNS) : [];
}

async function rememberCampaignId(env, id) {
  if (!id) return;
  const ids = await campaignIndex(env);
  const next = [id].concat(ids.filter((existing) => existing !== id)).slice(0, MAX_CAMPAIGNS);
  await env.MERCHANT_CAMPAIGNS.put(INDEX_KEY, JSON.stringify(next));
}

async function readPayload(request) {
  const contentType = request.headers.get("content-type") || "";
  if (!contentType.includes("application/json")) return {};
  return request.json();
}

function cleanText(value, maxLength) {
  return String(value || "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, maxLength);
}

function cleanURL(value) {
  const raw = cleanText(value, 260);
  if (!raw) return "";
  try {
    const url = new URL(raw);
    return ["http:", "https:"].includes(url.protocol) ? url.toString() : "";
  } catch {
    return "";
  }
}

function cleanDealId(value) {
  return cleanText(value, 180).replace(/[^\w:./@+\-=#äöüÄÖÜß]/g, "");
}

function dealInteractionKey(dealId) {
  return DEAL_INTERACTION_PREFIX + encodeURIComponent(dealId);
}

function communityInteractionKey(dealId, kind) {
  return `${DEAL_INTERACTION_COMMUNITY_PREFIX}${kind}:${encodeURIComponent(dealId)}`;
}

function ratingInteractionKey(dealId) {
  return DEAL_INTERACTION_RATINGS_PREFIX + encodeURIComponent(dealId);
}

async function dealInteractionRecord(env, dealId) {
  const [raw, commentsRaw, tipsRaw, ratingsRaw] = await Promise.all([
    env.MERCHANT_CAMPAIGNS.get(dealInteractionKey(dealId), "json"),
    env.MERCHANT_CAMPAIGNS.get(communityInteractionKey(dealId, "comments"), "json"),
    env.MERCHANT_CAMPAIGNS.get(communityInteractionKey(dealId, "tips"), "json"),
    env.MERCHANT_CAMPAIGNS.get(ratingInteractionKey(dealId), "json"),
  ]);
  return {
    dealId,
    upvotes: Array.isArray(raw?.upvotes) ? uniqueStrings(raw.upvotes.map((id) => cleanText(id, 160))).slice(0, MAX_INTERACTION_DEVICES) : [],
    favorites: Array.isArray(raw?.favorites) ? uniqueStrings(raw.favorites.map((id) => cleanText(id, 160))).slice(0, MAX_INTERACTION_DEVICES) : [],
    opens: Array.isArray(raw?.opens) ? uniqueStrings(raw.opens.map((id) => cleanText(id, 160))).slice(0, MAX_INTERACTION_DEVICES) : [],
    redeems: Array.isArray(raw?.redeems) ? uniqueStrings(raw.redeems.map((id) => cleanText(id, 160))).slice(0, MAX_INTERACTION_DEVICES) : [],
    comments: normalizeCommunityEntries(commentsRaw?.entries || raw?.comments),
    tips: normalizeCommunityEntries(tipsRaw?.entries || raw?.tips),
    ratings: normalizeRatings(ratingsRaw?.ratings || raw?.ratings),
    updatedAt: latestTimestamp([raw?.updatedAt, commentsRaw?.updatedAt, tipsRaw?.updatedAt, ratingsRaw?.updatedAt]),
  };
}

function latestTimestamp(values) {
  return values
    .map((value) => cleanText(value, 40))
    .filter(Boolean)
    .sort()
    .at(-1) || null;
}

function publicDealInteraction(record) {
  const ratings = Object.values(record.ratings || {}).filter((value) => Number.isFinite(value));
  const ratingCount = ratings.length;
  const ratingAverage = ratingCount ? ratings.reduce((sum, value) => sum + value, 0) / ratingCount : 0;
  return {
    votes: Array.isArray(record.upvotes) ? record.upvotes.length : 0,
    favorites: Array.isArray(record.favorites) ? record.favorites.length : 0,
    opens: Array.isArray(record.opens) ? record.opens.length : 0,
    redeems: Array.isArray(record.redeems) ? record.redeems.length : 0,
    comments: publicCommunityEntries(record.comments),
    tips: publicCommunityEntries(record.tips),
    ratingAverage,
    ratingCount,
    updatedAt: record.updatedAt || null,
  };
}

function uniqueStrings(values) {
  return Array.from(new Set(values.map((value) => String(value || "").trim()).filter(Boolean)));
}

function addUnique(values, value) {
  return uniqueStrings([...(Array.isArray(values) ? values : []), value]).slice(0, MAX_INTERACTION_DEVICES);
}

function removeValue(values, value) {
  return uniqueStrings(Array.isArray(values) ? values : []).filter((entry) => entry !== value);
}

function addCommunityEntry(values, deviceId, text) {
  const body = cleanText(text, 300);
  const validationError = validateCommunityText(body);
  if (validationError) return normalizeCommunityEntries(values);
  const existing = normalizeCommunityEntries(values);
  const normalizedBody = normalizeCommunityText(body);
  if (existing.some((entry) => entry.deviceId === cleanText(deviceId, 160) && normalizeCommunityText(entry.text) === normalizedBody)) {
    return existing;
  }
  return [
    {
      id: crypto.randomUUID(),
      text: body,
      deviceId: cleanText(deviceId, 160),
      createdAt: new Date().toISOString(),
      reports: [],
      hidden: false,
    },
    ...existing,
  ].slice(0, MAX_COMMUNITY_ENTRIES);
}

function normalizeCommunityEntries(values) {
  if (!Array.isArray(values)) return [];
  return values
    .map((entry) => {
      const text = cleanText(typeof entry === "string" ? entry : entry?.text, 300);
      if (!text) return null;
      return {
        id: cleanText(entry?.id, 80) || crypto.randomUUID(),
        text,
        deviceId: cleanText(entry?.deviceId, 160),
        createdAt: cleanText(entry?.createdAt, 40) || new Date().toISOString(),
        reports: Array.isArray(entry?.reports) ? uniqueStrings(entry.reports.map((id) => cleanText(id, 160))).slice(0, 200) : [],
        hidden: Boolean(entry?.hidden),
      };
    })
    .filter(Boolean)
    .slice(0, MAX_COMMUNITY_ENTRIES);
}

function publicCommunityEntries(values) {
  return normalizeCommunityEntries(values)
    .filter((entry) => !entry.hidden)
    .map((entry) => ({
      id: entry.id,
      text: entry.text,
      createdAt: entry.createdAt,
    }));
}

function reportCommunityEntry(values, deviceId, entryId) {
  const id = cleanText(entryId, 80);
  if (!id) return normalizeCommunityEntries(values);
  return normalizeCommunityEntries(values).map((entry) => {
    if (entry.id !== id) return entry;
    return {
      ...entry,
      reports: addUnique(entry.reports, deviceId).slice(0, 200),
    };
  });
}

function hideCommunityEntry(values, entryId) {
  const id = cleanText(entryId, 80);
  if (!id) return normalizeCommunityEntries(values);
  return normalizeCommunityEntries(values).map((entry) => (
    entry.id === id ? { ...entry, hidden: true } : entry
  ));
}

function validateCommunityText(body) {
  if (!body) return "Community text is required";
  if (body.length < 2) return "Community text is too short";
  if ((body.match(/https?:\/\//gi) || []).length > 2) return "Community text has too many links";
  if (/(.)\1{12,}/.test(body)) return "Community text looks like spam";
  return "";
}

function normalizeCommunityText(value) {
  return cleanText(value, 300).toLowerCase();
}

function normalizeRatings(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return Object.fromEntries(
    Object.entries(value)
      .map(([deviceId, rating]) => [cleanText(deviceId, 160), Math.round(Number(rating))])
      .filter(([deviceId, rating]) => deviceId && rating >= 1 && rating <= 5)
      .slice(0, MAX_INTERACTION_DEVICES)
  );
}

function parseList(value, fallback) {
  const entries = String(value || "")
    .split(/[,\n]/)
    .map((entry) => entry.trim())
    .filter(Boolean);
  return entries.length ? entries : fallback;
}

function packageRank(packageId) {
  return { city: 3, spotlight: 2, starter: 1 }[packageId] || 0;
}

function normalize(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}

function containsAny(haystack, needles) {
  return needles.some((needle) => haystack.includes(needle));
}

function publicPackages() {
  return Object.fromEntries(
    Object.entries(PACKAGE_CONFIG).map(([id, config]) => [
      id,
      {
        name: config.name,
        durationDays: config.durationDays,
        price: config.price,
      },
    ])
  );
}

function json(payload, status = 200) {
  return new Response(JSON.stringify(payload), { status, headers: JSON_HEADERS });
}

export {
  analyticsDays,
  correctedCategory,
  sanitizeAnalyticsEvent,
  sanitizeAnalyticsProperties,
};

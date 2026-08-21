const JSON_HEADERS = {
  'content-type': 'application/json; charset=utf-8',
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'GET,POST,OPTIONS',
  'access-control-allow-headers': 'content-type,authorization,x-admin-token',
  'cache-control': 'no-store'
};

const MIN_CONFIRM_DELAY_MS = 15 * 1000;
const textEncoder = new TextEncoder();
const APP_STORE_APP_ID = '6758958213';
const WEBSITE_HOME_URL = 'https://freefinder.at/';
const WEBSITE_DEALS_JSON_URL = `${WEBSITE_HOME_URL}deals.json`;
const WEBSITE_SHARE_IMAGE_URL = `${WEBSITE_HOME_URL}og-preview.png`;
const PROMOTION_CAMPAIGNS = {
  PLUS30WIEN: {
    code: 'PLUS30WIEN',
    plan: 'plus',
    durationDays: 30,
    label: '1 Monat FreeFinder PLUS gratis',
  },
};
const VIENNA_DAY_FORMATTER = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Europe/Vienna',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});
const STRIPE_API_VERSION = '2026-02-25.clover';
const STRIPE_CHECKOUT_PLANS = {
  pro: {
    mode: 'subscription',
    priceEnv: 'STRIPE_PRICE_PRO',
    lookupKey: 'freefinder_pro_monthly_eur',
    label: 'FreeFinder PRO',
    unitAmount: 399,
    recurringInterval: 'month',
  },
  plus: {
    mode: 'subscription',
    priceEnv: 'STRIPE_PRICE_PLUS',
    lookupKey: 'freefinder_plus_monthly_eur',
    label: 'FreeFinder PLUS',
    unitAmount: 1299,
    recurringInterval: 'month',
  },
  businessStarter: {
    mode: 'payment',
    priceEnv: 'STRIPE_PRICE_BUSINESS_STARTER',
    lookupKey: 'freefinder_business_starter_eur',
    label: 'Starter Boost',
    unitAmount: 2599,
    merchantPackageId: 'starter',
  },
  businessSpotlight: {
    mode: 'payment',
    priceEnv: 'STRIPE_PRICE_BUSINESS_SPOTLIGHT',
    lookupKey: 'freefinder_business_spotlight_eur',
    label: 'Spotlight Boost',
    unitAmount: 6499,
    merchantPackageId: 'spotlight',
  },
  businessCity: {
    mode: 'payment',
    priceEnv: 'STRIPE_PRICE_BUSINESS_CITY',
    lookupKey: 'freefinder_business_city_eur',
    label: 'City Push',
    unitAmount: 12999,
    merchantPackageId: 'city',
  },
};
const MERCHANT_API_BASE_DEFAULT = 'https://freefinder-merchant-backend.freefinder-stefan.workers.dev';
const STRIPE_WEBHOOK_TOLERANCE_SECONDS = 300;
const SLACK_REQUEST_TOLERANCE_SECONDS = 300;
const APPROVE_WORKFLOW_THROTTLE_MS = 60 * 1000;
const TIKTOK_AUTHORIZE_URL = 'https://www.tiktok.com/v2/auth/authorize/';
const TIKTOK_TOKEN_URL = 'https://open.tiktokapis.com/v2/oauth/token/';
const TIKTOK_REVOKE_URL = 'https://open.tiktokapis.com/v2/oauth/revoke/';
const TIKTOK_USER_INFO_URL = 'https://open.tiktokapis.com/v2/user/info/?fields=open_id,avatar_url,display_name';
const TIKTOK_CREATOR_INFO_URL = 'https://open.tiktokapis.com/v2/post/publish/creator_info/query/';
const TIKTOK_PUBLISH_VIDEO_URL = 'https://open.tiktokapis.com/v2/post/publish/video/init/';
const TIKTOK_PUBLISH_STATUS_URL = 'https://open.tiktokapis.com/v2/post/publish/status/fetch/';
const TIKTOK_REDIRECT_URI_DEFAULT = 'https://freefinder-referrals.freefinder-stefan.workers.dev/api/social/tiktok/callback';
const TIKTOK_OAUTH_SCOPES = 'user.info.basic,video.publish';
const TIKTOK_TOKEN_KEY = 'social:tiktok:tokens';
const TIKTOK_LAST_PUBLISH_KEY = 'social:tiktok:last-publish';
const TIKTOK_SANDBOX_TOKEN_KEY = 'social:tiktok:sandbox:tokens';
const TIKTOK_SANDBOX_LAST_PUBLISH_KEY = 'social:tiktok:sandbox:last-publish';
const INSTAGRAM_AUTHORIZE_URL = 'https://www.instagram.com/oauth/authorize';
const INSTAGRAM_TOKEN_URL = 'https://api.instagram.com/oauth/access_token';
const INSTAGRAM_GRAPH_BASE_URL = 'https://graph.instagram.com';
const INSTAGRAM_REDIRECT_URI_DEFAULT = 'https://freefinder-referrals.freefinder-stefan.workers.dev/api/social/instagram/callback';
const INSTAGRAM_OAUTH_SCOPES = 'instagram_business_basic,instagram_business_content_publish';
const INSTAGRAM_TOKEN_KEY = 'social:instagram:tokens';
const INSTAGRAM_LAST_PUBLISH_KEY = 'social:instagram:last-publish';
const SOCIAL_MEDIA_TTL_SECONDS = 36 * 60 * 60;
const SOCIAL_MEDIA_MAX_BYTES = 24 * 1024 * 1024;
const SOCIAL_MEDIA_TYPES = new Map([
  ['video/mp4', 'mp4'],
  ['video/quicktime', 'mov'],
  ['video/webm', 'webm'],
  ['image/jpeg', 'jpg'],
  ['image/png', 'png'],
  ['image/webp', 'webp'],
]);

function json(data, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: JSON_HEADERS });
}

function normalizeCode(value) {
  const code = String(value || '').trim().toUpperCase();
  return /^FF-[A-Z0-9]{4,12}$/.test(code) ? code : '';
}

function normalizePromotionCode(value) {
  const code = String(value || '').trim().toUpperCase();
  return /^[A-Z0-9_-]{4,24}$/.test(code) ? code : '';
}

function normalizeId(value) {
  const id = String(value || '').trim();
  return /^[a-zA-Z0-9_-]{8,128}$/.test(id) ? id : '';
}

function normalizeDealId(value) {
  const id = String(value || '').trim();
  return /^[a-zA-Z0-9:_-]{1,256}$/.test(id) ? id : '';
}

function normalizePushToken(value) {
  const token = String(value || '').trim().toLowerCase();
  return /^[a-f0-9]{32,256}$/.test(token) ? token : '';
}

function codeKey(code) {
  return `referral:code:${code}`;
}

function claimKey(token) {
  return `referral:claim:${token}`;
}

function pendingKey(code, visitorId) {
  return `referral:pending:${code}:${visitorId}`;
}

function promotionClaimKey(code, deviceId) {
  return `promotion:claim:${code}:${deviceId}`;
}

function promotionPayload(campaign, record, now = Date.now()) {
  const claimedAt = Number(record?.claimedAt || 0) || null;
  const expiresAt = Number(record?.expiresAt || 0) || null;
  return {
    code: campaign.code,
    label: campaign.label,
    plan: campaign.plan,
    durationDays: campaign.durationDays,
    claimedAt,
    expiresAt,
    active: Boolean(expiresAt && expiresAt > now),
  };
}

function apnsTokenKey(token) {
  return `push:apns:${token}`;
}

function dealOverrideKey(dealId) {
  return `deal:override:${dealId}`;
}

function dealDailyKey() {
  return 'deal:daily';
}

function dealSubmissionKey(id) {
  return `deal:submission:${id}`;
}

function workflowDispatchKey(name) {
  return `workflow:dispatch:${name}`;
}

function checkoutCampaignKey(id) {
  return `checkout:campaign:${id}`;
}

function checkoutSessionKey(sessionId) {
  return `checkout:session:${sessionId}`;
}

function checkoutEventKey(eventId) {
  return `checkout:event:${eventId}`;
}

function getViennaDayKey(input = Date.now()) {
  const date = input instanceof Date ? input : new Date(input || Date.now());
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) return '';
  return VIENNA_DAY_FORMATTER.format(date);
}

function normalizeDailyDealRecord(record) {
  if (!record || !record.dealId) return null;
  const updatedAt = Number(record.updatedAt || 0) || null;
  const explicitDate = typeof record.date === 'string' ? record.date.trim() : '';
  const date = explicitDate || (updatedAt ? getViennaDayKey(updatedAt) : '');
  return {
    ...record,
    updatedAt,
    date,
  };
}

function normalizeSubmissionUrl(value) {
  const text = String(value || '').trim();
  if (!text) return '';
  try {
    const url = new URL(text);
    if (!['http:', 'https:'].includes(url.protocol)) return '';
    url.hash = '';
    return url.toString();
  } catch {
    return '';
  }
}

function normalizeSubmissionStatus(value) {
  const status = String(value || '').trim().toLowerCase();
  if (['pending', 'queued', 'approved', 'rejected'].includes(status)) return status;
  return 'pending';
}

function isCurrentDailyDealRecord(record) {
  const normalized = normalizeDailyDealRecord(record);
  return Boolean(normalized && normalized.dealId && normalized.date === getViennaDayKey());
}

function maskPushToken(token) {
  const value = String(token || '').trim();
  if (value.length <= 12) return value;
  return `${value.slice(0, 6)}…${value.slice(-6)}`;
}

function toBase64Url(input) {
  let bytes;
  if (typeof input === 'string') {
    bytes = textEncoder.encode(input);
  } else if (input instanceof Uint8Array) {
    bytes = input;
  } else if (input instanceof ArrayBuffer) {
    bytes = new Uint8Array(input);
  } else {
    bytes = textEncoder.encode(String(input || ''));
  }

  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function pemToArrayBuffer(pem) {
  const normalized = String(pem || '')
    .replace(/\\n/g, '\n')
    .replace(/-----BEGIN PRIVATE KEY-----/g, '')
    .replace(/-----END PRIVATE KEY-----/g, '')
    .replace(/\s+/g, '');

  if (!normalized) return null;

  const binary = atob(normalized);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes.buffer;
}

function derToJose(signature, size = 32) {
  const bytes = new Uint8Array(signature);
  if (bytes[0] !== 0x30) return bytes;

  let offset = 2;
  if (bytes[1] & 0x80) {
    offset = 2 + (bytes[1] & 0x7f);
  }

  if (bytes[offset] !== 0x02) throw new Error('Invalid DER signature');
  const rLength = bytes[offset + 1];
  const rStart = offset + 2;
  const r = bytes.slice(rStart, rStart + rLength);

  const sMarker = rStart + rLength;
  if (bytes[sMarker] !== 0x02) throw new Error('Invalid DER signature');
  const sLength = bytes[sMarker + 1];
  const sStart = sMarker + 2;
  const s = bytes.slice(sStart, sStart + sLength);

  const jose = new Uint8Array(size * 2);
  jose.set(r.slice(-size), size - Math.min(size, r.length));
  jose.set(s.slice(-size), (size * 2) - Math.min(size, s.length));
  return jose;
}

async function buildApnsJwt(env) {
  const teamId = String(env.APNS_TEAM_ID || '').trim();
  const keyId = String(env.APNS_KEY_ID || '').trim();
  const privateKeyPem = String(env.APNS_PRIVATE_KEY || '').trim();

  if (!teamId || !keyId || !privateKeyPem) {
    throw new Error('APNS credentials are incomplete');
  }

  const privateKeyData = pemToArrayBuffer(privateKeyPem);
  if (!privateKeyData) throw new Error('APNS private key is invalid');

  const cryptoKey = await crypto.subtle.importKey(
    'pkcs8',
    privateKeyData,
    { name: 'ECDSA', namedCurve: 'P-256' },
    false,
    ['sign'],
  );

  const header = toBase64Url(JSON.stringify({ alg: 'ES256', kid: keyId }));
  const payload = toBase64Url(JSON.stringify({
    iss: teamId,
    iat: Math.floor(Date.now() / 1000),
  }));
  const signingInput = `${header}.${payload}`;
  const signature = await crypto.subtle.sign(
    { name: 'ECDSA', hash: 'SHA-256' },
    cryptoKey,
    textEncoder.encode(signingInput),
  );

  return `${signingInput}.${toBase64Url(derToJose(signature))}`;
}

function requireAdmin(request, env) {
  const expected = String(env.ADMIN_API_TOKEN || '').trim();
  if (!expected) return false;
  const authHeader = request.headers.get('authorization') || '';
  const bearer = authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : '';
  const direct = request.headers.get('x-admin-token') || '';
  return bearer === expected || direct === expected;
}

function requireCommunitySync(request, env) {
  const expected = String(env.COMMUNITY_SYNC_TOKEN || '').trim();
  if (!expected) return false;
  const authHeader = request.headers.get('authorization') || '';
  const bearer = authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : '';
  const direct = request.headers.get('x-community-token') || '';
  return bearer === expected || direct === expected;
}

function buildApnsBody(body) {
  const aps = {
    sound: typeof body?.sound === 'string' && body.sound.trim() ? body.sound.trim() : 'default',
  };

  const title = String(body?.title || '').trim();
  const message = String(body?.body || '').trim();
  if (title || message) {
    aps.alert = {};
    if (title) aps.alert.title = title;
    if (message) aps.alert.body = message;
  }

  if (Number.isFinite(body?.badge)) {
    aps.badge = Math.max(0, Number(body.badge));
  }

  return {
    aps,
    dealId: String(body?.dealId || '').trim() || undefined,
    url: String(body?.url || '').trim() || undefined,
    type: String(body?.type || 'deal').trim(),
    data: body?.data && typeof body.data === 'object' ? body.data : undefined,
  };
}

async function sendApnsPush(env, payload) {
  const token = normalizePushToken(payload?.token);
  if (!token) throw new Error('Invalid APNS token');

  const bundleId = String(payload?.bundleId || env.APNS_BUNDLE_ID || '').trim();
  if (!bundleId) throw new Error('Missing APNS bundle id');

  const jwt = await buildApnsJwt(env);
  const host = String(env.APNS_USE_SANDBOX || '').trim().toLowerCase() === 'true'
    ? 'https://api.sandbox.push.apple.com'
    : 'https://api.push.apple.com';

  const body = buildApnsBody(payload);
  const response = await fetch(`${host}/3/device/${token}`, {
    method: 'POST',
    headers: {
      authorization: `bearer ${jwt}`,
      'apns-topic': bundleId,
      'apns-push-type': String(payload?.pushType || 'alert'),
      'apns-priority': String(payload?.priority || '10'),
      'apns-expiration': String(payload?.expiration || '0'),
      'content-type': 'application/json',
    },
    body: JSON.stringify(body),
  });

  let errorBody = null;
  try {
    errorBody = await response.json();
  } catch {
    errorBody = null;
  }

  return {
    ok: response.ok,
    status: response.status,
    apnsId: response.headers.get('apns-id') || '',
    reason: errorBody?.reason || '',
    timestamp: errorBody?.timestamp || null,
  };
}

async function getJsonKV(env, key) {
  return env.REFERRAL_KV.get(key, 'json');
}

async function putJsonKV(env, key, value, options = undefined) {
  await env.REFERRAL_KV.put(key, JSON.stringify(value), options);
}

async function listApnsTokens(env, limit = 20) {
  const listed = await env.REFERRAL_KV.list({ prefix: 'push:apns:', limit });
  const keys = Array.isArray(listed?.keys) ? listed.keys : [];
  const records = [];

  for (const entry of keys) {
    const record = await getJsonKV(env, entry.name);
    if (record) records.push(record);
  }

  records.sort((a, b) => Number(b?.lastSeenAt || 0) - Number(a?.lastSeenAt || 0));
  return records;
}

async function listDealOverrides(env, limit = 500) {
  const listed = await env.REFERRAL_KV.list({ prefix: 'deal:override:', limit });
  const keys = Array.isArray(listed?.keys) ? listed.keys : [];
  const records = [];

  for (const entry of keys) {
    const record = await getJsonKV(env, entry.name);
    if (record && record.dealId) records.push(record);
  }

  records.sort((a, b) => {
    const aPinned = Number.isFinite(a?.pinnedRank) ? Number(a.pinnedRank) : 0;
    const bPinned = Number.isFinite(b?.pinnedRank) ? Number(b.pinnedRank) : 0;
    if (aPinned !== bPinned) return bPinned - aPinned;
    return Number(b?.updatedAt || 0) - Number(a?.updatedAt || 0);
  });

  return records;
}

async function listCommunitySubmissions(env, options = {}) {
  const limit = Math.max(1, Math.min(200, Number(options.limit || 100)));
  const statuses = new Set(
    (Array.isArray(options.statuses) ? options.statuses : [options.statuses || 'pending'])
      .map(normalizeSubmissionStatus)
      .filter(Boolean)
  );
  const listed = await env.REFERRAL_KV.list({ prefix: 'deal:submission:', limit });
  const keys = Array.isArray(listed?.keys) ? listed.keys : [];
  const records = [];

  for (const entry of keys) {
    const record = await getJsonKV(env, entry.name);
    if (!record || !record.id) continue;
    if (statuses.size > 0 && !statuses.has(normalizeSubmissionStatus(record.status))) continue;
    records.push(record);
  }

  records.sort((a, b) => Number(b?.submittedAt || b?.createdAt || 0) - Number(a?.submittedAt || a?.createdAt || 0));
  return records.slice(0, limit);
}

async function findExistingSubmissionByUrl(env, targetUrl) {
  const normalizedUrl = normalizeSubmissionUrl(targetUrl);
  if (!normalizedUrl) return null;

  const listed = await env.REFERRAL_KV.list({ prefix: 'deal:submission:', limit: 200 });
  const keys = Array.isArray(listed?.keys) ? listed.keys : [];

  for (const entry of keys) {
    const record = await getJsonKV(env, entry.name);
    if (!record || !record.id) continue;
    if (normalizeSubmissionUrl(record.url) !== normalizedUrl) continue;
    const status = normalizeSubmissionStatus(record.status);
    if (status === 'pending' || status === 'queued') return record;
  }

  return null;
}

function sanitizePublicDealOverride(record) {
  if (!record || !record.dealId) return null;
  return {
    dealId: record.dealId,
    hidden: Boolean(record.hidden),
    pinnedRank: Number.isFinite(record.pinnedRank) ? Number(record.pinnedRank) : 0,
    title: typeof record.title === 'string' ? record.title : '',
    description: typeof record.description === 'string' ? record.description : '',
    brand: typeof record.brand === 'string' ? record.brand : '',
    distance: typeof record.distance === 'string' ? record.distance : '',
    pubDate: typeof record.pubDate === 'string' ? record.pubDate : '',
    expires: typeof record.expires === 'string' ? record.expires : '',
    expiresOriginal: typeof record.expiresOriginal === 'string' ? record.expiresOriginal : '',
    expiryKind: typeof record.expiryKind === 'string' ? record.expiryKind : '',
    validOn: typeof record.validOn === 'string' ? record.validOn : '',
    validFrom: typeof record.validFrom === 'string' ? record.validFrom : '',
    validUntil: typeof record.validUntil === 'string' ? record.validUntil : '',
    expiryDisplayText: typeof record.expiryDisplayText === 'string' ? record.expiryDisplayText : '',
    updatedAt: Number(record.updatedAt || 0) || null,
  };
}

function sanitizePublicDailyDeal(record) {
  const normalized = normalizeDailyDealRecord(record);
  if (!normalized || !normalized.dealId) return null;
  return {
    dealId: normalized.dealId,
    updatedAt: normalized.updatedAt,
    date: normalized.date || '',
    note: typeof normalized.note === 'string' ? normalized.note : '',
  };
}

function sanitizePublicCommunitySubmission(record) {
  if (!record || !record.id) return null;
  return {
    id: record.id,
    url: normalizeSubmissionUrl(record.url),
    brand: cleanShortText(record.brand, 120),
    logo: cleanShortText(record.logo, 16),
    title: cleanShortText(record.title, 240),
    description: cleanLongText(record.description, 500),
    category: cleanShortText(record.category, 80).toLowerCase(),
    type: cleanShortText(record.type, 40).toLowerCase(),
    distance: cleanShortText(record.distance, 200),
    expires: cleanShortText(record.expires, 120),
    status: normalizeSubmissionStatus(record.status),
    submittedAt: Number(record.submittedAt || record.createdAt || 0) || null,
    postedAt: Number(record.postedAt || 0) || null,
    reviewedAt: Number(record.reviewedAt || 0) || null,
    submittedFrom: cleanShortText(record.submittedFrom, 64),
  };
}

function normalizePinnedRank(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return 0;
  return Math.max(0, Math.min(999, Math.round(parsed)));
}

function cleanShortText(value, max = 240) {
  return String(value || '').trim().replace(/\s+/g, ' ').slice(0, max);
}

function cleanLongText(value, max = 2500) {
  return String(value || '').trim().replace(/\s+/g, ' ').slice(0, max);
}

function normalizeEmail(value) {
  const email = cleanShortText(value, 180).toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return '';
  return email;
}

function isBusinessCheckoutPlan(plan) {
  return Boolean(STRIPE_CHECKOUT_PLANS[plan]?.merchantPackageId);
}

function normalizeBusinessCategory(value) {
  const category = cleanShortText(value, 40).toLowerCase();
  if (['restaurant', 'cafe', 'bar', 'bakery', 'takeaway', 'shop', 'service', 'other'].includes(category)) {
    return category;
  }
  return 'restaurant';
}

function normalizeBusinessCampaignInput(body) {
  const input = body && typeof body === 'object' ? body : {};
  const restaurantName = cleanShortText(input.restaurantName || input.providerName || input.provider, 120);
  const dealTitle = cleanShortText(input.dealTitle || input.title, 160);
  const address = cleanShortText(input.address || input.location || input.dealLocation, 220);
  const description = cleanLongText(input.description || input.details || input.dealDetails, 1200);
  const ctaURL = normalizeSubmissionUrl(input.ctaURL || input.link || input.dealURL || input.url);
  const contactEmail = normalizeEmail(input.contactEmail || input.email);

  if (!restaurantName || !dealTitle || !address || !description || !ctaURL || !contactEmail) {
    return null;
  }

  return {
    restaurantName,
    dealTitle,
    address,
    description,
    ctaURL,
    contactEmail,
    category: normalizeBusinessCategory(input.category),
    oldPrice: cleanShortText(input.oldPrice, 80),
    dealPrice: cleanShortText(input.dealPrice, 80),
  };
}

function sanitizePublicCheckoutCampaign(record) {
  if (!record || !record.id) return null;
  const campaign = record.campaign || {};
  return {
    id: record.id,
    plan: record.plan || '',
    packageId: record.packageId || '',
    label: record.planLabel || '',
    status: cleanShortText(record.status, 80),
    restaurantName: cleanShortText(campaign.restaurantName, 120),
    dealTitle: cleanShortText(campaign.dealTitle, 160),
    createdAt: Number(record.createdAt || 0) || null,
    checkoutStartedAt: Number(record.checkoutStartedAt || 0) || null,
    paidAt: Number(record.paidAt || 0) || null,
    merchantSubmittedAt: Number(record.merchantSubmittedAt || 0) || null,
    updatedAt: Number(record.updatedAt || 0) || null,
    error: record.error ? cleanShortText(record.error, 240) : '',
  };
}

function normalizeCommunitySubmissionInput(body, request) {
  const url = normalizeSubmissionUrl(body?.url);
  if (!url) return null;

  const host = getPreviewHost(url);
  const sourcePlatform = getSourcePlatform(host);
  const submittedTitle = cleanShortText(body?.title, 240);
  const submittedDescription = cleanLongText(body?.description, 500);
  const submittedBrand = cleanShortText(body?.brand, 120);
  const submittedTitleIsGeneric = isGenericSocialPreviewTitle(submittedTitle, sourcePlatform)
    || /^(instagram|tiktok|facebook|x)\s+deal$/i.test(submittedTitle);
  const improvedTitle = submittedTitleIsGeneric
    ? buildSmartSocialPreviewTitle({
      sourcePlatform,
      rawTitle: submittedTitle,
      caption: submittedDescription,
      description: submittedDescription,
      accountName: submittedBrand,
      accountHandle: '',
    })
    : submittedTitle;

  return {
    id: crypto.randomUUID(),
    url,
    brand: submittedBrand,
    logo: cleanShortText(body?.logo, 16),
    title: cleanShortText(improvedTitle || submittedTitle, 240),
    description: submittedDescription,
    category: cleanShortText(body?.category, 80).toLowerCase() || 'wien',
    type: cleanShortText(body?.type, 40).toLowerCase() || 'rabatt',
    distance: cleanShortText(body?.distance, 200),
    expires: cleanShortText(body?.expires, 120),
    status: 'pending',
    submittedAt: Date.now(),
    createdAt: Date.now(),
    postedAt: 0,
    reviewedAt: 0,
    submittedFrom: cleanShortText(body?.submittedFrom, 64) || 'web-app',
    language: cleanShortText(body?.language, 12).toLowerCase(),
    userAgent: cleanLongText(body?.userAgent || request.headers.get('user-agent'), 512),
    ipHint: cleanShortText(request.headers.get('cf-connecting-ip'), 64),
  };
}

function normalizeLegacyDealSubmitInput(body, request) {
  const mapped = {
    url: body?.url,
    title: body?.title,
    description: body?.description || body?.details,
    brand: body?.brand || body?.provider,
    logo: body?.logo,
    category: body?.category || 'wien',
    type: body?.type || 'rabatt',
    distance: body?.distance || body?.location || 'Wien',
    expires: body?.expires || body?.validUntil || '',
    submittedFrom: body?.submittedFrom || body?.source || 'ios-native-free-submit',
    language: body?.language,
    userAgent: body?.userAgent,
  };
  return normalizeCommunitySubmissionInput(mapped, request);
}

function normalizeDealOverrideInput(body, existing = null) {
  const dealId = normalizeDealId(body?.dealId || existing?.dealId);
  if (!dealId) return null;

  const next = {
    dealId,
    url: normalizeSubmissionUrl(body?.url || existing?.url),
    hidden: body?.hidden === true,
    pinnedRank: normalizePinnedRank(body?.pinnedRank),
    title: cleanShortText(body?.title, 240),
    description: cleanLongText(body?.description, 2500),
    brand: cleanShortText(body?.brand, 120),
    category: cleanShortText(body?.category, 80).toLowerCase(),
    type: cleanShortText(body?.type, 40).toLowerCase(),
    distance: cleanShortText(body?.distance, 200),
    pubDate: cleanShortText(body?.pubDate, 80),
    expires: cleanShortText(body?.expires, 120),
    expiresOriginal: cleanShortText(body?.expiresOriginal, 180),
    expiryKind: cleanShortText(body?.expiryKind, 40).toLowerCase(),
    validOn: cleanShortText(body?.validOn, 32),
    validFrom: cleanShortText(body?.validFrom, 32),
    validUntil: cleanShortText(body?.validUntil, 32),
    expiryDisplayText: cleanShortText(body?.expiryDisplayText, 180),
    updatedAt: Date.now(),
    createdAt: existing?.createdAt || Date.now(),
  };

  return next;
}

function normalizeRecord(record, code, inviterDeviceId) {
  return {
    code,
    inviterDeviceId,
    createdAt: record?.createdAt || Date.now(),
    installs: Array.isArray(record?.installs) ? record.installs : [],
    lastUpdatedAt: Date.now()
  };
}

function sanitizeInstallSummary(record) {
  const installs = Array.isArray(record?.installs) ? record.installs : [];
  const installsCount = installs.length;
  const eligibleForPro = installsCount >= 2;
  return {
    code: record?.code || '',
    installs: installsCount,
    installsCount,
    isEligible: eligibleForPro,
    eligibleForPro,
    latestInstallAt: installs.length ? installs[installs.length - 1].completedAt : null
  };
}

async function readBody(request) {
  try {
    return await request.json();
  } catch {
    return null;
  }
}

function invalid(message, status = 400) {
  return json({ ok: false, error: message }, status);
}

function fromBase64Url(value) {
  const normalized = String(value || '').replace(/-/g, '+').replace(/_/g, '/');
  const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '=');
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

function socialBearer(request) {
  const authorization = String(request.headers.get('authorization') || '');
  return authorization.startsWith('Bearer ') ? authorization.slice(7).trim() : '';
}

function requireSocialConnect(request, env) {
  const expected = String(env.SOCIAL_CONNECT_TOKEN || '').trim();
  if (!expected) return false;
  return socialBearer(request) === expected || request.headers.get('x-social-connect-token') === expected;
}

function requireSocialPublish(request, env) {
  const expected = String(env.SOCIAL_PUBLISH_TOKEN || '').trim();
  if (!expected) return false;
  return socialBearer(request) === expected || request.headers.get('x-social-publish-token') === expected;
}

function tiktokRedirectUri(env) {
  return String(env.TIKTOK_REDIRECT_URI || TIKTOK_REDIRECT_URI_DEFAULT).trim();
}

function normalizeTikTokEnvironment(value) {
  return String(value || '').trim().toLowerCase() === 'sandbox' ? 'sandbox' : 'production';
}

function requestedTikTokEnvironment(value) {
  const normalized = String(value || '').trim().toLowerCase();
  if (!normalized || normalized === 'production') return 'production';
  if (normalized === 'sandbox') return 'sandbox';
  return '';
}

function tiktokCredentials(env, environment = 'production') {
  const normalizedEnvironment = normalizeTikTokEnvironment(environment);
  if (normalizedEnvironment === 'sandbox') {
    return {
      clientKey: String(env.TIKTOK_SANDBOX_CLIENT_KEY || '').trim(),
      clientSecret: String(env.TIKTOK_SANDBOX_CLIENT_SECRET || '').trim(),
      environment: normalizedEnvironment,
    };
  }
  return {
    clientKey: String(env.TIKTOK_CLIENT_KEY || '').trim(),
    clientSecret: String(env.TIKTOK_CLIENT_SECRET || '').trim(),
    environment: normalizedEnvironment,
  };
}

function tiktokTokenKey(environment = 'production') {
  return normalizeTikTokEnvironment(environment) === 'sandbox' ? TIKTOK_SANDBOX_TOKEN_KEY : TIKTOK_TOKEN_KEY;
}

function tiktokLastPublishKey(environment = 'production') {
  return normalizeTikTokEnvironment(environment) === 'sandbox'
    ? TIKTOK_SANDBOX_LAST_PUBLISH_KEY
    : TIKTOK_LAST_PUBLISH_KEY;
}

function tiktokPublishIdempotencyKey(environment, idempotencyKey) {
  const prefix = normalizeTikTokEnvironment(environment) === 'sandbox' ? 'social:tiktok:sandbox:publish' : 'social:tiktok:publish';
  return `${prefix}:${idempotencyKey}`;
}

function tiktokCredentialsReady(env, environment = 'production') {
  const credentials = tiktokCredentials(env, environment);
  return Boolean(
    credentials.clientKey
    && credentials.clientSecret
    && String(env.SOCIAL_TOKEN_ENCRYPTION_KEY || '').trim()
  );
}

async function socialEncryptionKey(env) {
  const secret = String(env.SOCIAL_TOKEN_ENCRYPTION_KEY || '').trim();
  if (secret.length < 32) throw new Error('Social token encryption key is missing or too short');
  const digest = await crypto.subtle.digest('SHA-256', textEncoder.encode(secret));
  return crypto.subtle.importKey('raw', digest, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']);
}

async function encryptSocialRecord(env, record) {
  const key = await socialEncryptionKey(env);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encrypted = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    key,
    textEncoder.encode(JSON.stringify(record)),
  );
  return {
    version: 1,
    iv: toBase64Url(iv),
    ciphertext: toBase64Url(encrypted),
  };
}

async function decryptSocialRecord(env, encrypted) {
  if (!encrypted || encrypted.version !== 1 || !encrypted.iv || !encrypted.ciphertext) return null;
  const key = await socialEncryptionKey(env);
  const decrypted = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: fromBase64Url(encrypted.iv) },
    key,
    fromBase64Url(encrypted.ciphertext),
  );
  return JSON.parse(new TextDecoder().decode(decrypted));
}

async function getTikTokTokenRecord(env, environment = 'production') {
  const encrypted = await getJsonKV(env, tiktokTokenKey(environment));
  if (!encrypted) return null;
  return decryptSocialRecord(env, encrypted);
}

async function putTikTokTokenRecord(env, record, environment = 'production') {
  await putJsonKV(env, tiktokTokenKey(environment), await encryptSocialRecord(env, record));
}

function tiktokErrorMessage(payload, fallback) {
  if (typeof payload?.error_description === 'string') return payload.error_description;
  if (typeof payload?.error === 'string') return payload.error;
  if (typeof payload?.error?.message === 'string') return payload.error.message;
  return fallback;
}

async function fetchTikTokJson(url, init, fallback) {
  const response = await fetch(url, init);
  const payload = await response.json().catch(() => null);
  const apiError = payload?.error && typeof payload.error === 'object' && payload.error.code !== 'ok'
    ? payload.error
    : null;
  if (!response.ok || apiError || typeof payload?.error === 'string') {
    throw new Error(tiktokErrorMessage(payload, fallback));
  }
  return payload;
}

async function exchangeTikTokCode(env, code, environment = 'production') {
  const credentials = tiktokCredentials(env, environment);
  const body = new URLSearchParams({
    client_key: credentials.clientKey,
    client_secret: credentials.clientSecret,
    code,
    grant_type: 'authorization_code',
    redirect_uri: tiktokRedirectUri(env),
  });
  return fetchTikTokJson(TIKTOK_TOKEN_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body,
  }, 'TikTok token exchange failed');
}

async function refreshTikTokToken(env, record, environment = 'production') {
  const credentials = tiktokCredentials(env, environment);
  const body = new URLSearchParams({
    client_key: credentials.clientKey,
    client_secret: credentials.clientSecret,
    grant_type: 'refresh_token',
    refresh_token: String(record.refreshToken || ''),
  });
  const token = await fetchTikTokJson(TIKTOK_TOKEN_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body,
  }, 'TikTok token refresh failed');
  const now = Date.now();
  const next = {
    ...record,
    openId: token.open_id || record.openId,
    scope: token.scope || record.scope,
    accessToken: token.access_token,
    refreshToken: token.refresh_token || record.refreshToken,
    accessExpiresAt: now + (Number(token.expires_in || 0) * 1000),
    refreshExpiresAt: now + (Number(token.refresh_expires_in || 0) * 1000),
    refreshedAt: now,
  };
  await putTikTokTokenRecord(env, next, environment);
  return next;
}

async function authorizedTikTokRecord(env, environment = 'production') {
  const record = await getTikTokTokenRecord(env, environment);
  if (!record?.accessToken || !record?.refreshToken) return null;
  if (Number(record.accessExpiresAt || 0) > Date.now() + (5 * 60 * 1000)) return record;
  return refreshTikTokToken(env, record, environment);
}

async function queryTikTokUser(accessToken) {
  const payload = await fetchTikTokJson(TIKTOK_USER_INFO_URL, {
    headers: { authorization: `Bearer ${accessToken}` },
  }, 'TikTok user lookup failed');
  return payload?.data?.user || null;
}

async function queryTikTokCreator(accessToken) {
  const payload = await fetchTikTokJson(TIKTOK_CREATOR_INFO_URL, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${accessToken}`,
      'content-type': 'application/json; charset=UTF-8',
    },
    body: '{}',
  }, 'TikTok creator lookup failed');
  return payload?.data || null;
}

async function revokeTikTokToken(env, accessToken, environment = 'production') {
  if (!accessToken) return;
  const credentials = tiktokCredentials(env, environment);
  const body = new URLSearchParams({
    client_key: credentials.clientKey,
    client_secret: credentials.clientSecret,
    token: accessToken,
  });
  await fetch(TIKTOK_REVOKE_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body,
  }).catch(() => null);
}

function renderTikTokConnectionResult({ ok, title, message, username = '' }) {
  const color = ok ? '#168a57' : '#c43f34';
  const account = username ? `<p class="account">@${escapeHtml(username.replace(/^@/, ''))}</p>` : '';
  const html = `<!doctype html>
<html lang="de"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escapeHtml(title)}</title><style>
body{margin:0;min-height:100vh;display:grid;place-items:center;background:#fffaf2;color:#101828;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}
main{width:min(560px,calc(100% - 40px));padding:36px;background:#fff;border:1px solid #f0dcc0;border-radius:8px;box-shadow:0 16px 50px rgba(34,24,10,.1);text-align:center}
.mark{width:64px;height:64px;margin:0 auto 20px;display:grid;place-items:center;border-radius:50%;background:${color};color:#fff;font-size:34px;font-weight:800}
h1{margin:0 0 12px;font-size:30px}.account{font-size:22px;font-weight:750;color:${color};margin:16px 0 0}p{line-height:1.55;color:#526079}a{display:inline-block;margin-top:24px;color:#e6603d;font-weight:700}</style></head>
<body><main><div class="mark">${ok ? '&#10003;' : '!'}</div><h1>${escapeHtml(title)}</h1><p>${escapeHtml(message)}</p>${account}<a href="https://freefinder.at/">Zur FreeFinder Website</a></main></body></html>`;
  return new Response(html, {
    status: ok ? 200 : 400,
    headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' },
  });
}

async function handleTikTokConnectSession(request, env) {
  if (!requireSocialConnect(request, env) && !requireAdmin(request, env)) {
    return invalid('Unauthorized', 401);
  }
  const url = new URL(request.url);
  const body = await readBody(request);
  const environment = requestedTikTokEnvironment(body?.environment || url.searchParams.get('environment'));
  if (!environment) return invalid('Invalid TikTok environment');
  const credentials = tiktokCredentials(env, environment);
  if (!tiktokCredentialsReady(env, environment)) return invalid(`TikTok ${environment} credentials are incomplete`, 503);

  const state = crypto.randomUUID().replace(/-/g, '') + crypto.randomUUID().replace(/-/g, '');
  await putJsonKV(env, `social:tiktok:oauth-state:${state}`, {
    environment,
    createdAt: Date.now(),
    expiresAt: Date.now() + (10 * 60 * 1000),
  }, { expirationTtl: 600 });

  const authorizeUrl = new URL(TIKTOK_AUTHORIZE_URL);
  authorizeUrl.searchParams.set('client_key', credentials.clientKey);
  authorizeUrl.searchParams.set('response_type', 'code');
  authorizeUrl.searchParams.set('scope', TIKTOK_OAUTH_SCOPES);
  authorizeUrl.searchParams.set('redirect_uri', tiktokRedirectUri(env));
  authorizeUrl.searchParams.set('state', state);
  authorizeUrl.searchParams.set('disable_auto_auth', '1');
  return json({ ok: true, environment, authorizeUrl: authorizeUrl.toString(), expiresIn: 600 });
}

async function handleTikTokCallback(request, env) {
  const url = new URL(request.url);
  const state = cleanShortText(url.searchParams.get('state'), 160);
  const code = cleanLongText(url.searchParams.get('code'), 2048);
  const oauthError = cleanShortText(url.searchParams.get('error_description') || url.searchParams.get('error'), 320);
  if (oauthError) {
    return renderTikTokConnectionResult({ ok: false, title: 'Verbindung abgebrochen', message: oauthError });
  }
  if (!state || !code) {
    return renderTikTokConnectionResult({ ok: false, title: 'Ungültige Antwort', message: 'TikTok hat keinen gültigen Verbindungscode zurückgegeben.' });
  }

  const stateKey = `social:tiktok:oauth-state:${state}`;
  const stateRecord = await getJsonKV(env, stateKey);
  await env.REFERRAL_KV.delete(stateKey);
  if (!stateRecord || Number(stateRecord.expiresAt || 0) < Date.now()) {
    return renderTikTokConnectionResult({ ok: false, title: 'Verbindung abgelaufen', message: 'Bitte starte die TikTok-Verbindung erneut.' });
  }
  const environment = normalizeTikTokEnvironment(stateRecord.environment);
  if (!tiktokCredentialsReady(env, environment)) {
    return renderTikTokConnectionResult({ ok: false, title: 'Konfiguration fehlt', message: `Die TikTok-${environment === 'sandbox' ? 'Sandbox-' : ''}Zugangsdaten sind noch nicht vollständig hinterlegt.` });
  }

  try {
    const token = await exchangeTikTokCode(env, code, environment);
    if (!token?.access_token || !token?.refresh_token) throw new Error('TikTok returned incomplete tokens');

    const [userResult, creatorResult] = await Promise.allSettled([
      queryTikTokUser(token.access_token),
      queryTikTokCreator(token.access_token),
    ]);
    const user = userResult.status === 'fulfilled' ? userResult.value : null;
    const creator = creatorResult.status === 'fulfilled' ? creatorResult.value : null;
    const username = cleanShortText(creator?.creator_username, 80).replace(/^@/, '');
    const expectedUsername = cleanShortText(env.TIKTOK_EXPECTED_USERNAME || 'freefinder.at', 80).replace(/^@/, '').toLowerCase();
    if (username && expectedUsername && username.toLowerCase() !== expectedUsername) {
      await revokeTikTokToken(env, token.access_token, environment);
      return renderTikTokConnectionResult({
        ok: false,
        title: 'Falsches TikTok-Konto',
        message: `Bitte verbinde @${expectedUsername} statt @${username}.`,
      });
    }

    const now = Date.now();
    const record = {
      environment,
      openId: token.open_id,
      scope: token.scope || TIKTOK_OAUTH_SCOPES,
      accessToken: token.access_token,
      refreshToken: token.refresh_token,
      accessExpiresAt: now + (Number(token.expires_in || 0) * 1000),
      refreshExpiresAt: now + (Number(token.refresh_expires_in || 0) * 1000),
      connectedAt: now,
      account: {
        username,
        displayName: cleanShortText(user?.display_name || creator?.creator_nickname, 120),
        avatarUrl: normalizeSubmissionUrl(user?.avatar_url || creator?.creator_avatar_url),
      },
    };
    await putTikTokTokenRecord(env, record, environment);
    return renderTikTokConnectionResult({
      ok: true,
      title: 'TikTok ist verbunden',
      message: 'FreeFinder kann die Verbindung nun serverseitig erneuern und freigegebene Posts veröffentlichen.',
      username: username || expectedUsername,
    });
  } catch (error) {
    return renderTikTokConnectionResult({
      ok: false,
      title: 'Verbindung fehlgeschlagen',
      message: error?.message || 'TikTok konnte nicht verbunden werden.',
    });
  }
}

async function handleTikTokStatus(request, env) {
  if (!requireSocialConnect(request, env) && !requireSocialPublish(request, env) && !requireAdmin(request, env)) {
    return invalid('Unauthorized', 401);
  }
  const environment = requestedTikTokEnvironment(new URL(request.url).searchParams.get('environment'));
  if (!environment) return invalid('Invalid TikTok environment');
  if (!tiktokCredentialsReady(env, environment)) return json({ ok: true, environment, configured: false, connected: false });
  try {
    const record = await authorizedTikTokRecord(env, environment);
    return json({
      ok: true,
      environment,
      configured: true,
      connected: Boolean(record),
      account: record?.account || null,
      scope: record?.scope || '',
      accessExpiresAt: record?.accessExpiresAt || null,
      refreshExpiresAt: record?.refreshExpiresAt || null,
      connectedAt: record?.connectedAt || null,
    });
  } catch (error) {
    return invalid(error?.message || 'TikTok status failed', 502);
  }
}

function tiktokUploadPlan(videoSize) {
  const singleChunkLimit = 64 * 1024 * 1024;
  const multiChunkSize = 32 * 1024 * 1024;
  if (!Number.isSafeInteger(videoSize) || videoSize < 1 || videoSize > 4 * 1024 * 1024 * 1024) return null;
  if (videoSize <= singleChunkLimit) {
    return { videoSize, chunkSize: videoSize, totalChunkCount: 1 };
  }
  return {
    videoSize,
    chunkSize: multiChunkSize,
    totalChunkCount: Math.floor(videoSize / multiChunkSize),
  };
}

function normalizeTikTokPublishInput(body) {
  const caption = cleanLongText(body?.caption, 2200);
  const idempotencyKey = cleanShortText(body?.idempotencyKey, 120);
  if (!caption || !idempotencyKey || !/^[a-zA-Z0-9:_-]{8,120}$/.test(idempotencyKey)) return null;
  if (body?.consent !== true) return null;
  const environment = requestedTikTokEnvironment(body?.environment);
  if (!environment) return null;

  const source = String(body?.source || body?.uploadMode || '').trim().toUpperCase() === 'FILE_UPLOAD'
    || String(body?.uploadMode || '').trim().toLowerCase() === 'file'
    ? 'FILE_UPLOAD'
    : 'PULL_FROM_URL';
  let sourceInfo;
  let mediaType = '';
  if (source === 'FILE_UPLOAD') {
    const uploadPlan = tiktokUploadPlan(Number(body?.videoSize));
    mediaType = cleanShortText(body?.mediaType, 80).toLowerCase();
    if (!uploadPlan || !['video/mp4', 'video/quicktime', 'video/webm'].includes(mediaType)) return null;
    sourceInfo = {
      source,
      video_size: uploadPlan.videoSize,
      chunk_size: uploadPlan.chunkSize,
      total_chunk_count: uploadPlan.totalChunkCount,
    };
  } else {
    let videoUrl;
    try {
      videoUrl = new URL(String(body?.videoUrl || ''));
    } catch {
      return null;
    }
    if (videoUrl.protocol !== 'https:' || videoUrl.hostname.toLowerCase() !== 'freefinder.at') return null;
    sourceInfo = { source, video_url: videoUrl.toString() };
  }

  return {
    environment,
    caption,
    idempotencyKey,
    source,
    sourceInfo,
    mediaType,
    privacyLevel: cleanShortText(body?.privacyLevel, 64),
    disableComment: body?.disableComment === true,
    disableDuet: body?.disableDuet === true,
    disableStitch: body?.disableStitch === true,
    isAigc: body?.isAigc !== false,
  };
}

async function handleTikTokPublish(request, env) {
  if (!requireSocialPublish(request, env)) return invalid('Unauthorized', 401);
  const input = normalizeTikTokPublishInput(await readBody(request));
  if (!input) return invalid('Invalid TikTok publish request');

  const idempotencyKvKey = tiktokPublishIdempotencyKey(input.environment, input.idempotencyKey);
  const existing = await getJsonKV(env, idempotencyKvKey);
  if (existing?.publishId) {
    if (existing.source === 'FILE_UPLOAD') {
      const uploadSession = await getJsonKV(env, `${idempotencyKvKey}:upload`);
      if (!uploadSession?.uploadUrl || Number(uploadSession.expiresAt || 0) <= Date.now()) {
        return invalid('TikTok upload session expired; use a new idempotency key', 409);
      }
      return json({
        ok: true,
        replayed: true,
        ...existing,
        uploadUrl: uploadSession.uploadUrl,
        uploadExpiresAt: uploadSession.expiresAt,
      });
    }
    return json({ ok: true, replayed: true, ...existing });
  }

  try {
    const record = await authorizedTikTokRecord(env, input.environment);
    if (!record) return invalid('TikTok is not connected', 409);
    const creator = await queryTikTokCreator(record.accessToken);
    const allowedPrivacy = Array.isArray(creator?.privacy_level_options) ? creator.privacy_level_options : [];
    const privacyLevel = allowedPrivacy.includes(input.privacyLevel)
      ? input.privacyLevel
      : (allowedPrivacy.includes('PUBLIC_TO_EVERYONE') ? 'PUBLIC_TO_EVERYONE' : (allowedPrivacy[0] || 'SELF_ONLY'));
    const payload = await fetchTikTokJson(TIKTOK_PUBLISH_VIDEO_URL, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${record.accessToken}`,
        'content-type': 'application/json; charset=UTF-8',
      },
      body: JSON.stringify({
        post_info: {
          title: input.caption,
          privacy_level: privacyLevel,
          disable_comment: input.disableComment,
          disable_duet: input.disableDuet,
          disable_stitch: input.disableStitch,
          brand_content_toggle: false,
          brand_organic_toggle: true,
          is_aigc: input.isAigc,
        },
        source_info: input.sourceInfo,
      }),
    }, 'TikTok publish initialization failed');
    const publishId = cleanShortText(payload?.data?.publish_id, 100);
    if (!publishId) throw new Error('TikTok did not return a publish id');
    const uploadUrl = normalizeSubmissionUrl(payload?.data?.upload_url);
    if (input.source === 'FILE_UPLOAD' && !uploadUrl) throw new Error('TikTok did not return an upload URL');
    const result = {
      publishId,
      privacyLevel,
      idempotencyKey: input.idempotencyKey,
      source: input.source,
      videoUrl: input.sourceInfo.video_url || '',
      videoSize: input.sourceInfo.video_size || null,
      chunkSize: input.sourceInfo.chunk_size || null,
      totalChunkCount: input.sourceInfo.total_chunk_count || null,
      mediaType: input.mediaType || '',
      createdAt: Date.now(),
      environment: input.environment,
      account: record.account || null,
    };
    await putJsonKV(env, idempotencyKvKey, result, { expirationTtl: 45 * 24 * 60 * 60 });
    let uploadSession = {};
    if (uploadUrl) {
      uploadSession = { uploadUrl, uploadExpiresAt: Date.now() + (60 * 60 * 1000) };
      await putJsonKV(env, `${idempotencyKvKey}:upload`, {
        uploadUrl,
        expiresAt: uploadSession.uploadExpiresAt,
      }, { expirationTtl: 60 * 60 });
    }
    await putJsonKV(env, tiktokLastPublishKey(input.environment), result);
    return json({ ok: true, ...result, ...uploadSession }, 202);
  } catch (error) {
    return invalid(error?.message || 'TikTok publish failed', 502);
  }
}

async function handleTikTokPublishStatus(request, env) {
  if (!requireSocialPublish(request, env) && !requireSocialConnect(request, env) && !requireAdmin(request, env)) {
    return invalid('Unauthorized', 401);
  }
  const body = request.method === 'POST' ? await readBody(request) : null;
  const url = new URL(request.url);
  const environment = requestedTikTokEnvironment(body?.environment || url.searchParams.get('environment'));
  if (!environment) return invalid('Invalid TikTok environment');
  const last = await getJsonKV(env, tiktokLastPublishKey(environment));
  const publishId = cleanShortText(body?.publishId || url.searchParams.get('publishId') || last?.publishId, 100);
  if (!publishId) return invalid('Missing publish id');
  try {
    const record = await authorizedTikTokRecord(env, environment);
    if (!record) return invalid('TikTok is not connected', 409);
    const payload = await fetchTikTokJson(TIKTOK_PUBLISH_STATUS_URL, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${record.accessToken}`,
        'content-type': 'application/json; charset=UTF-8',
      },
      body: JSON.stringify({ publish_id: publishId }),
    }, 'TikTok publish status failed');
    return json({ ok: true, environment, publishId, status: payload?.data || null });
  } catch (error) {
    return invalid(error?.message || 'TikTok publish status failed', 502);
  }
}

function socialMediaKey(token) {
  return `social:media:${token}`;
}

function socialMediaTypeFromExtension(extension) {
  for (const [contentType, mappedExtension] of SOCIAL_MEDIA_TYPES.entries()) {
    if (mappedExtension === extension) return contentType;
  }
  return '';
}

function parseSocialMediaPath(path) {
  const match = String(path || '').match(/^\/api\/social\/media\/([a-zA-Z0-9_-]{40,64})\.(mp4|mov|webm|jpg|png|webp)$/);
  if (!match) return null;
  return { token: match[1], extension: match[2] };
}

async function handleSocialMediaUpload(request, env) {
  if (!requireSocialPublish(request, env)) return invalid('Unauthorized', 401);
  const declaredLength = Number(request.headers.get('content-length') || 0);
  if (declaredLength > SOCIAL_MEDIA_MAX_BYTES) return invalid('Media file is too large', 413);

  const contentType = String(request.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
  const extension = SOCIAL_MEDIA_TYPES.get(contentType);
  if (!extension) return invalid('Unsupported media type', 415);

  const media = await request.arrayBuffer();
  if (!media.byteLength) return invalid('Media file is empty');
  if (media.byteLength > SOCIAL_MEDIA_MAX_BYTES) return invalid('Media file is too large', 413);

  const token = toBase64Url(crypto.getRandomValues(new Uint8Array(32)));
  await env.REFERRAL_KV.put(socialMediaKey(token), media, { expirationTtl: SOCIAL_MEDIA_TTL_SECONDS });
  const mediaUrl = `${new URL(request.url).origin}/api/social/media/${token}.${extension}`;
  return json({
    ok: true,
    mediaUrl,
    contentType,
    size: media.byteLength,
    expiresAt: Date.now() + (SOCIAL_MEDIA_TTL_SECONDS * 1000),
  }, 201);
}

async function handleSocialMediaDownload(path, env) {
  const mediaPath = parseSocialMediaPath(path);
  if (!mediaPath) return invalid('Media not found', 404);
  const media = await env.REFERRAL_KV.get(socialMediaKey(mediaPath.token), 'arrayBuffer');
  if (!media) return invalid('Media not found', 404);
  const contentType = socialMediaTypeFromExtension(mediaPath.extension);
  return new Response(media, {
    status: 200,
    headers: {
      'content-type': contentType,
      'content-length': String(media.byteLength),
      'content-disposition': `inline; filename="freefinder-social.${mediaPath.extension}"`,
      'cache-control': 'public, max-age=3600',
      'access-control-allow-origin': '*',
      'x-content-type-options': 'nosniff',
    },
  });
}

function instagramRedirectUri(env) {
  return String(env.INSTAGRAM_REDIRECT_URI || INSTAGRAM_REDIRECT_URI_DEFAULT).trim();
}

function instagramGraphVersion(env) {
  const version = String(env.INSTAGRAM_GRAPH_API_VERSION || 'v26.0').trim().toLowerCase();
  return /^v\d+\.0$/.test(version) ? version : 'v26.0';
}

function instagramGraphUrl(env, path) {
  return new URL(`${INSTAGRAM_GRAPH_BASE_URL}/${instagramGraphVersion(env)}/${String(path || '').replace(/^\/+/, '')}`);
}

function instagramCredentialsReady(env) {
  return Boolean(
    String(env.INSTAGRAM_APP_ID || '').trim()
    && String(env.INSTAGRAM_APP_SECRET || '').trim()
    && String(env.SOCIAL_TOKEN_ENCRYPTION_KEY || '').trim()
  );
}

async function getInstagramTokenRecord(env) {
  const encrypted = await getJsonKV(env, INSTAGRAM_TOKEN_KEY);
  if (!encrypted) return null;
  return decryptSocialRecord(env, encrypted);
}

async function putInstagramTokenRecord(env, record) {
  await putJsonKV(env, INSTAGRAM_TOKEN_KEY, await encryptSocialRecord(env, record));
}

function instagramErrorMessage(payload, fallback) {
  if (typeof payload?.error_description === 'string') return payload.error_description;
  if (typeof payload?.error_message === 'string') return payload.error_message;
  if (typeof payload?.error?.message === 'string') return payload.error.message;
  if (typeof payload?.error === 'string') return payload.error;
  return fallback;
}

async function fetchInstagramJson(url, init, fallback) {
  const response = await fetch(url, init);
  const payload = await response.json().catch(() => null);
  if (!response.ok || payload?.error || payload?.error_type) {
    throw new Error(instagramErrorMessage(payload, fallback));
  }
  return payload;
}

async function exchangeInstagramCode(env, code) {
  const body = new URLSearchParams({
    client_id: String(env.INSTAGRAM_APP_ID || '').trim(),
    client_secret: String(env.INSTAGRAM_APP_SECRET || '').trim(),
    grant_type: 'authorization_code',
    redirect_uri: instagramRedirectUri(env),
    code,
  });
  const shortLived = await fetchInstagramJson(INSTAGRAM_TOKEN_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body,
  }, 'Instagram token exchange failed');
  if (!shortLived?.access_token) throw new Error('Instagram returned an incomplete access token');

  const longLivedUrl = new URL(`${INSTAGRAM_GRAPH_BASE_URL}/access_token`);
  longLivedUrl.searchParams.set('grant_type', 'ig_exchange_token');
  longLivedUrl.searchParams.set('client_secret', String(env.INSTAGRAM_APP_SECRET || '').trim());
  longLivedUrl.searchParams.set('access_token', shortLived.access_token);
  const longLived = await fetchInstagramJson(longLivedUrl, {}, 'Instagram long-lived token exchange failed');
  if (!longLived?.access_token) throw new Error('Instagram returned an incomplete long-lived token');
  return {
    userId: cleanShortText(shortLived.user_id, 100),
    accessToken: longLived.access_token,
    expiresIn: Number(longLived.expires_in || 0),
  };
}

async function queryInstagramProfile(env, accessToken) {
  const url = instagramGraphUrl(env, 'me');
  url.searchParams.set('fields', 'user_id,username,name,profile_picture_url');
  return fetchInstagramJson(url, {
    headers: { authorization: `Bearer ${accessToken}` },
  }, 'Instagram profile lookup failed');
}

async function refreshInstagramToken(env, record) {
  const url = new URL(`${INSTAGRAM_GRAPH_BASE_URL}/refresh_access_token`);
  url.searchParams.set('grant_type', 'ig_refresh_token');
  url.searchParams.set('access_token', String(record.accessToken || ''));
  const refreshed = await fetchInstagramJson(url, {}, 'Instagram token refresh failed');
  if (!refreshed?.access_token) throw new Error('Instagram returned an incomplete refreshed token');
  const now = Date.now();
  const next = {
    ...record,
    accessToken: refreshed.access_token,
    expiresAt: now + (Number(refreshed.expires_in || 0) * 1000),
    refreshedAt: now,
  };
  await putInstagramTokenRecord(env, next);
  return next;
}

async function authorizedInstagramRecord(env) {
  const record = await getInstagramTokenRecord(env);
  if (!record?.accessToken || !record?.userId) return null;
  const refreshAge = Date.now() - Number(record.refreshedAt || record.connectedAt || 0);
  const expiresSoon = Number(record.expiresAt || 0) <= Date.now() + (7 * 24 * 60 * 60 * 1000);
  if (!expiresSoon && refreshAge < 30 * 24 * 60 * 60 * 1000) return record;
  return refreshInstagramToken(env, record);
}

async function handleInstagramConnectSession(request, env) {
  if (!requireSocialConnect(request, env) && !requireAdmin(request, env)) return invalid('Unauthorized', 401);
  if (!instagramCredentialsReady(env)) return invalid('Instagram credentials are incomplete', 503);

  const state = crypto.randomUUID().replace(/-/g, '') + crypto.randomUUID().replace(/-/g, '');
  await putJsonKV(env, `social:instagram:oauth-state:${state}`, {
    createdAt: Date.now(),
    expiresAt: Date.now() + (10 * 60 * 1000),
  }, { expirationTtl: 600 });

  const authorizeUrl = new URL(INSTAGRAM_AUTHORIZE_URL);
  authorizeUrl.searchParams.set('client_id', String(env.INSTAGRAM_APP_ID || '').trim());
  authorizeUrl.searchParams.set('redirect_uri', instagramRedirectUri(env));
  authorizeUrl.searchParams.set('response_type', 'code');
  authorizeUrl.searchParams.set('scope', INSTAGRAM_OAUTH_SCOPES);
  authorizeUrl.searchParams.set('state', state);
  authorizeUrl.searchParams.set('enable_fb_login', '0');
  authorizeUrl.searchParams.set('force_authentication', '1');
  return json({ ok: true, authorizeUrl: authorizeUrl.toString(), expiresIn: 600 });
}

async function handleInstagramCallback(request, env) {
  const url = new URL(request.url);
  const state = cleanShortText(url.searchParams.get('state'), 160);
  const code = cleanLongText(url.searchParams.get('code'), 4096);
  const oauthError = cleanShortText(url.searchParams.get('error_description') || url.searchParams.get('error_reason') || url.searchParams.get('error'), 320);
  if (oauthError) {
    return renderTikTokConnectionResult({ ok: false, title: 'Instagram-Verbindung abgebrochen', message: oauthError });
  }
  if (!state || !code) {
    return renderTikTokConnectionResult({ ok: false, title: 'Ungültige Antwort', message: 'Instagram hat keinen gültigen Verbindungscode zurückgegeben.' });
  }

  const stateKey = `social:instagram:oauth-state:${state}`;
  const stateRecord = await getJsonKV(env, stateKey);
  await env.REFERRAL_KV.delete(stateKey);
  if (!stateRecord || Number(stateRecord.expiresAt || 0) < Date.now()) {
    return renderTikTokConnectionResult({ ok: false, title: 'Verbindung abgelaufen', message: 'Bitte starte die Instagram-Verbindung erneut.' });
  }
  if (!instagramCredentialsReady(env)) {
    return renderTikTokConnectionResult({ ok: false, title: 'Konfiguration fehlt', message: 'Die Instagram-Zugangsdaten sind noch nicht vollständig hinterlegt.' });
  }

  try {
    const token = await exchangeInstagramCode(env, code);
    const profile = await queryInstagramProfile(env, token.accessToken);
    const username = cleanShortText(profile?.username, 80).replace(/^@/, '');
    const expectedUsername = cleanShortText(env.INSTAGRAM_EXPECTED_USERNAME || 'freefinder.at', 80).replace(/^@/, '').toLowerCase();
    if (username && expectedUsername && username.toLowerCase() !== expectedUsername) {
      return renderTikTokConnectionResult({
        ok: false,
        title: 'Falsches Instagram-Konto',
        message: `Bitte verbinde @${expectedUsername} statt @${username}.`,
      });
    }

    const now = Date.now();
    const record = {
      userId: cleanShortText(profile?.user_id || token.userId || profile?.id, 100),
      scope: INSTAGRAM_OAUTH_SCOPES,
      accessToken: token.accessToken,
      expiresAt: now + (Math.max(token.expiresIn, 3600) * 1000),
      connectedAt: now,
      refreshedAt: now,
      account: {
        username,
        displayName: cleanShortText(profile?.name, 120),
        avatarUrl: normalizeSubmissionUrl(profile?.profile_picture_url),
      },
    };
    if (!record.userId) throw new Error('Instagram returned no professional account id');
    await putInstagramTokenRecord(env, record);
    return renderTikTokConnectionResult({
      ok: true,
      title: 'Instagram ist verbunden',
      message: 'FreeFinder kann die Verbindung nun serverseitig erneuern und freigegebene Reels veröffentlichen.',
      username: username || expectedUsername,
    });
  } catch (error) {
    return renderTikTokConnectionResult({
      ok: false,
      title: 'Instagram-Verbindung fehlgeschlagen',
      message: error?.message || 'Instagram konnte nicht verbunden werden.',
    });
  }
}

async function handleInstagramStatus(request, env) {
  if (!requireSocialConnect(request, env) && !requireSocialPublish(request, env) && !requireAdmin(request, env)) {
    return invalid('Unauthorized', 401);
  }
  if (!instagramCredentialsReady(env)) return json({ ok: true, configured: false, connected: false });
  try {
    const record = await authorizedInstagramRecord(env);
    return json({
      ok: true,
      configured: true,
      connected: Boolean(record),
      account: record?.account || null,
      scope: record?.scope || '',
      expiresAt: record?.expiresAt || null,
      connectedAt: record?.connectedAt || null,
    });
  } catch (error) {
    return invalid(error?.message || 'Instagram status failed', 502);
  }
}

function normalizeHostedSocialMediaUrl(value, request, env) {
  let mediaUrl;
  try {
    mediaUrl = new URL(String(value || ''));
  } catch {
    return '';
  }
  if (mediaUrl.protocol !== 'https:') return '';
  const workerHost = new URL(request.url).hostname.toLowerCase();
  const configuredHosts = String(env.SOCIAL_MEDIA_ALLOWED_HOSTS || '')
    .split(',')
    .map((host) => host.trim().toLowerCase())
    .filter(Boolean);
  const allowedHosts = new Set([workerHost, 'freefinder.at', 'www.freefinder.at', ...configuredHosts]);
  if (!allowedHosts.has(mediaUrl.hostname.toLowerCase())) return '';
  return mediaUrl.toString();
}

function instagramPublishKey(idempotencyKey) {
  return `social:instagram:publish:${idempotencyKey}`;
}

function normalizeInstagramPublishInput(body, request, env) {
  const caption = cleanLongText(body?.caption, 2200);
  const idempotencyKey = cleanShortText(body?.idempotencyKey, 120);
  const videoUrl = normalizeHostedSocialMediaUrl(body?.videoUrl, request, env);
  if (!caption || !videoUrl || !/^[a-zA-Z0-9:_-]{8,120}$/.test(idempotencyKey)) return null;
  if (body?.consent !== true) return null;
  return {
    caption,
    idempotencyKey,
    videoUrl,
    shareToFeed: body?.shareToFeed !== false,
  };
}

async function queryInstagramContainer(env, accessToken, containerId) {
  const url = instagramGraphUrl(env, containerId);
  url.searchParams.set('fields', 'status_code,status');
  return fetchInstagramJson(url, {
    headers: { authorization: `Bearer ${accessToken}` },
  }, 'Instagram container status failed');
}

async function handleInstagramPublish(request, env) {
  if (!requireSocialPublish(request, env)) return invalid('Unauthorized', 401);
  const input = normalizeInstagramPublishInput(await readBody(request), request, env);
  if (!input) return invalid('Invalid Instagram publish request');
  const key = instagramPublishKey(input.idempotencyKey);
  const existing = await getJsonKV(env, key);
  if (existing?.containerId) return json({ ok: true, replayed: true, ...existing });

  try {
    const record = await authorizedInstagramRecord(env);
    if (!record) return invalid('Instagram is not connected', 409);
    const endpoint = instagramGraphUrl(env, `${record.userId}/media`);
    const body = new URLSearchParams({
      media_type: 'REELS',
      video_url: input.videoUrl,
      caption: input.caption,
      share_to_feed: input.shareToFeed ? 'true' : 'false',
      access_token: record.accessToken,
    });
    const payload = await fetchInstagramJson(endpoint, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body,
    }, 'Instagram Reel container creation failed');
    const containerId = cleanShortText(payload?.id, 100);
    if (!containerId) throw new Error('Instagram returned no Reel container id');
    const result = {
      containerId,
      idempotencyKey: input.idempotencyKey,
      videoUrl: input.videoUrl,
      shareToFeed: input.shareToFeed,
      createdAt: Date.now(),
      account: record.account || null,
    };
    await putJsonKV(env, key, result, { expirationTtl: 45 * 24 * 60 * 60 });
    await putJsonKV(env, INSTAGRAM_LAST_PUBLISH_KEY, result);
    return json({ ok: true, ...result }, 202);
  } catch (error) {
    return invalid(error?.message || 'Instagram publish initialization failed', 502);
  }
}

async function handleInstagramPublishStatus(request, env) {
  if (!requireSocialPublish(request, env) && !requireSocialConnect(request, env) && !requireAdmin(request, env)) {
    return invalid('Unauthorized', 401);
  }
  const body = request.method === 'POST' ? await readBody(request) : null;
  const url = new URL(request.url);
  const last = await getJsonKV(env, INSTAGRAM_LAST_PUBLISH_KEY);
  const idempotencyKey = cleanShortText(body?.idempotencyKey || url.searchParams.get('idempotencyKey'), 120);
  const stored = idempotencyKey ? await getJsonKV(env, instagramPublishKey(idempotencyKey)) : null;
  const requestedContainerId = cleanShortText(body?.containerId || url.searchParams.get('containerId'), 100);
  if (idempotencyKey && !requestedContainerId && !stored?.containerId) {
    return invalid('Instagram publish session not found', 404);
  }
  const containerId = cleanShortText(requestedContainerId || stored?.containerId || last?.containerId, 100);
  if (!containerId) return invalid('Missing Instagram container id');
  if (stored?.mediaId) {
    return json({
      ok: true,
      containerId,
      mediaId: stored.mediaId,
      status: { status_code: 'PUBLISHED' },
    });
  }
  try {
    const record = await authorizedInstagramRecord(env);
    if (!record) return invalid('Instagram is not connected', 409);
    const status = await queryInstagramContainer(env, record.accessToken, containerId);
    return json({ ok: true, containerId, status });
  } catch (error) {
    return invalid(error?.message || 'Instagram publish status failed', 502);
  }
}

async function handleInstagramPublishComplete(request, env) {
  if (!requireSocialPublish(request, env)) return invalid('Unauthorized', 401);
  const body = await readBody(request);
  const idempotencyKey = cleanShortText(body?.idempotencyKey, 120);
  if (!/^[a-zA-Z0-9:_-]{8,120}$/.test(idempotencyKey) || body?.consent !== true) {
    return invalid('Invalid Instagram completion request');
  }
  const key = instagramPublishKey(idempotencyKey);
  const stored = await getJsonKV(env, key);
  if (!stored?.containerId) return invalid('Instagram publish session not found', 404);
  if (stored.mediaId) return json({ ok: true, replayed: true, ...stored });

  try {
    const record = await authorizedInstagramRecord(env);
    if (!record) return invalid('Instagram is not connected', 409);
    const status = await queryInstagramContainer(env, record.accessToken, stored.containerId);
    if (String(status?.status_code || '').toUpperCase() !== 'FINISHED') {
      return json({ ok: false, ready: false, containerId: stored.containerId, status }, 409);
    }
    const endpoint = instagramGraphUrl(env, `${record.userId}/media_publish`);
    const publishBody = new URLSearchParams({
      creation_id: stored.containerId,
      access_token: record.accessToken,
    });
    const payload = await fetchInstagramJson(endpoint, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: publishBody,
    }, 'Instagram Reel publishing failed');
    const mediaId = cleanShortText(payload?.id, 100);
    if (!mediaId) throw new Error('Instagram returned no published media id');
    const completed = { ...stored, mediaId, publishedAt: Date.now() };
    await putJsonKV(env, key, completed, { expirationTtl: 45 * 24 * 60 * 60 });
    await putJsonKV(env, INSTAGRAM_LAST_PUBLISH_KEY, completed);
    return json({ ok: true, ...completed }, 201);
  } catch (error) {
    return invalid(error?.message || 'Instagram Reel publishing failed', 502);
  }
}

function parseJsonObject(value) {
  try {
    const parsed = JSON.parse(String(value || ''));
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function normalizeDealRemovalInput(body = {}) {
  const dealId = normalizeDealId(body.dealId || body.deal_id || body.id);
  const dealUrl = normalizeSubmissionUrl(body.dealUrl || body.deal_url || body.url);
  const title = cleanShortText(body.title, 180);
  const brand = cleanShortText(body.brand, 120);
  const reason = cleanShortText(body.reason, 180) || 'aus Slack Live-Review entfernt';

  if (!dealId && !dealUrl) return null;

  return {
    dealId,
    dealUrl,
    title,
    brand,
    reason,
  };
}

function normalizeOfflineRestoreDeal(raw = {}) {
  const dealId = normalizeDealId(raw.dealId || raw.deal_id || raw.id);
  if (!dealId) return null;

  return {
    id: dealId,
    submissionId: cleanShortText(raw.submissionId || raw.submission_id, 160),
    brand: cleanShortText(raw.brand || raw.provider, 120) || cleanShortText(raw.title, 120) || 'FreeFinder',
    title: cleanShortText(raw.title, 240) || cleanShortText(raw.brand || raw.provider, 240) || 'FreeFinder Deal',
    description: cleanLongText(raw.description || raw.details, 2500),
    url: normalizeSubmissionUrl(raw.url || raw.dealUrl || raw.deal_url),
    category: cleanShortText(raw.category, 80).toLowerCase() || 'wien',
    type: cleanShortText(raw.type, 40).toLowerCase() || 'rabatt',
    logo: cleanShortText(raw.logo, 16) || '🎯',
    distance: cleanShortText(raw.distance || raw.location || raw.address, 200) || 'Wien',
    source: cleanShortText(raw.source, 160) || 'Offline Restore',
    originSource: cleanShortText(raw.originSource || raw.source, 160) || 'Offline Restore',
    expires: cleanShortText(raw.expires, 120),
    expiresOriginal: cleanShortText(raw.expiresOriginal || raw.expires, 180),
    expiresPrecision: cleanShortText(raw.expiresPrecision, 40),
    expiresSource: cleanShortText(raw.expiresSource, 80),
    expiresDetectedFromUrl: raw.expiresDetectedFromUrl === true,
    pubDate: cleanShortText(raw.pubDate, 80),
    qualityScore: Number(raw.qualityScore || 0) || 0,
    votes: Number(raw.votes || 1) || 1,
    priority: Number(raw.priority || 3) || 3,
    hot: raw.hot === true,
    isNew: raw.isNew === true,
    slackTs: cleanShortText(raw.slackTs, 120),
    slackThreadTs: cleanShortText(raw.slackThreadTs, 120),
    approvedAt: cleanShortText(raw.approvedAt, 80),
    expiryKind: cleanShortText(raw.expiryKind, 40).toLowerCase(),
    validOn: cleanShortText(raw.validOn, 32),
    validFrom: cleanShortText(raw.validFrom, 32),
    validUntil: cleanShortText(raw.validUntil, 32),
    expiryDisplayText: cleanShortText(raw.expiryDisplayText, 180),
  };
}

function normalizeDealRestoreInput(body = {}) {
  const restoreDeal = normalizeOfflineRestoreDeal(body.restoreDeal || body.deal || body);
  if (!restoreDeal) return null;

  return {
    dealId: restoreDeal.id,
    url: restoreDeal.url,
    title: restoreDeal.title,
    brand: restoreDeal.brand,
    description: restoreDeal.description,
    distance: restoreDeal.distance,
    pubDate: restoreDeal.pubDate,
    expires: restoreDeal.expires,
    expiresOriginal: restoreDeal.expiresOriginal,
    expiryKind: restoreDeal.expiryKind,
    validOn: restoreDeal.validOn,
    validFrom: restoreDeal.validFrom,
    validUntil: restoreDeal.validUntil,
    expiryDisplayText: restoreDeal.expiryDisplayText,
    hidden: false,
    forceKeep: true,
    restoreDeal,
  };
}

async function triggerDealModerationWorkflow(env, removal) {
  const token = envString(env, 'GITHUB_WORKFLOW_TOKEN') || envString(env, 'GITHUB_TOKEN');
  if (!token) throw new Error('GITHUB_WORKFLOW_TOKEN is not configured');

  const owner = envString(env, 'GITHUB_OWNER') || 'ataalla24-ux';
  const repo = envString(env, 'GITHUB_REPO') || 'deal-finder';
  const workflow = envString(env, 'GITHUB_DEAL_MODERATION_WORKFLOW') || 'deal-moderation.yml';
  const ref = envString(env, 'GITHUB_REF') || 'main';
  const endpoint = `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/actions/workflows/${encodeURIComponent(workflow)}/dispatches`;

  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${token}`,
      accept: 'application/vnd.github+json',
      'content-type': 'application/json',
      'user-agent': 'freefinder-referrals-worker',
      'x-github-api-version': '2022-11-28',
    },
    body: JSON.stringify({
      ref,
      inputs: {
        deal_id: removal.dealId,
        deal_url: removal.dealUrl,
        provider: '',
        text: '',
        reason: removal.reason,
      },
    }),
  });

  if (response.status === 204) return { ok: true, status: response.status };

  const detail = cleanLongText(await response.text().catch(() => ''), 700);
  throw new Error(`GitHub workflow dispatch failed (${response.status})${detail ? `: ${detail}` : ''}`);
}

async function triggerDealEditWorkflow(env, edit) {
  const token = envString(env, 'GITHUB_WORKFLOW_TOKEN') || envString(env, 'GITHUB_TOKEN');
  if (!token) throw new Error('GITHUB_WORKFLOW_TOKEN is not configured');

  const owner = envString(env, 'GITHUB_OWNER') || 'ataalla24-ux';
  const repo = envString(env, 'GITHUB_REPO') || 'deal-finder';
  const workflow = envString(env, 'GITHUB_LIVE_DEAL_EDIT_WORKFLOW') || 'live-deal-edit.yml';
  const ref = envString(env, 'GITHUB_REF') || 'main';
  const endpoint = `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/actions/workflows/${encodeURIComponent(workflow)}/dispatches`;
  const payload = {
    dealId: edit.dealId,
    url: edit.url || '',
    title: edit.title || '',
    brand: edit.brand || '',
    description: edit.description || '',
    category: edit.category || '',
    type: edit.type || '',
    distance: edit.distance || '',
    pubDate: edit.pubDate || '',
    expires: edit.expires || '',
    expiresOriginal: edit.expiresOriginal || '',
    expiryKind: edit.expiryKind || '',
    validOn: edit.validOn || '',
    validFrom: edit.validFrom || '',
    validUntil: edit.validUntil || '',
    expiryDisplayText: edit.expiryDisplayText || '',
    pinnedRank: edit.pinnedRank ?? '',
    hidden: edit.hidden === true,
    forceKeep: edit.forceKeep === true,
    ...(edit.restoreDeal ? { restoreDeal: edit.restoreDeal } : {}),
    editedBy: 'slack-live-review',
  };

  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${token}`,
      accept: 'application/vnd.github+json',
      'content-type': 'application/json',
      'user-agent': 'freefinder-referrals-worker',
      'x-github-api-version': '2022-11-28',
    },
    body: JSON.stringify({
      ref,
      inputs: {
        edit_payload: JSON.stringify(payload),
      },
    }),
  });

  if (response.status === 204) return { ok: true, status: response.status, workflow };

  const detail = cleanLongText(await response.text().catch(() => ''), 700);
  throw new Error(`GitHub edit workflow dispatch failed (${response.status})${detail ? `: ${detail}` : ''}`);
}

async function triggerCommunityIntakeWorkflow(env) {
  const token = envString(env, 'GITHUB_WORKFLOW_TOKEN') || envString(env, 'GITHUB_TOKEN');
  if (!token) throw new Error('GITHUB_WORKFLOW_TOKEN is not configured');

  const owner = envString(env, 'GITHUB_OWNER') || 'ataalla24-ux';
  const repo = envString(env, 'GITHUB_REPO') || 'deal-finder';
  const workflow = envString(env, 'GITHUB_COMMUNITY_INTAKE_WORKFLOW') || 'community-submissions.yml';
  const ref = envString(env, 'GITHUB_REF') || 'main';
  const endpoint = `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/actions/workflows/${encodeURIComponent(workflow)}/dispatches`;

  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${token}`,
      accept: 'application/vnd.github+json',
      'content-type': 'application/json',
      'user-agent': 'freefinder-referrals-worker',
      'x-github-api-version': '2022-11-28',
    },
    body: JSON.stringify({ ref }),
  });

  if (response.status === 204) return { ok: true, status: response.status, workflow };

  const detail = cleanLongText(await response.text().catch(() => ''), 700);
  throw new Error(`GitHub community intake dispatch failed (${response.status})${detail ? `: ${detail}` : ''}`);
}

async function triggerCommunityIntakeSafely(env) {
  try {
    return await triggerCommunityIntakeWorkflow(env);
  } catch (error) {
    return {
      ok: false,
      error: cleanLongText(error?.message || 'Community intake workflow dispatch failed', 700),
    };
  }
}

async function triggerSlackApproveWorkflow(env, inputs = {}) {
  const token = envString(env, 'GITHUB_WORKFLOW_TOKEN') || envString(env, 'GITHUB_TOKEN');
  if (!token) throw new Error('GITHUB_WORKFLOW_TOKEN is not configured');

  const owner = envString(env, 'GITHUB_OWNER') || 'ataalla24-ux';
  const repo = envString(env, 'GITHUB_REPO') || 'deal-finder';
  const workflow = envString(env, 'GITHUB_APPROVE_DEALS_WORKFLOW') || 'approve-deals.yml';
  const ref = envString(env, 'GITHUB_REF') || 'main';
  const endpoint = `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/actions/workflows/${encodeURIComponent(workflow)}/dispatches`;

  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${token}`,
      accept: 'application/vnd.github+json',
      'content-type': 'application/json',
      'user-agent': 'freefinder-referrals-worker',
      'x-github-api-version': '2022-11-28',
    },
    body: JSON.stringify(Object.keys(inputs).length > 0 ? { ref, inputs } : { ref }),
  });

  if (response.status === 204) return { ok: true, status: response.status, workflow };

  const detail = cleanLongText(await response.text().catch(() => ''), 700);
  throw new Error(`GitHub approve workflow dispatch failed (${response.status})${detail ? `: ${detail}` : ''}`);
}

async function triggerSlackApproveSafely(env, reason = 'slack-reaction', inputs = {}) {
  try {
    const messageTs = cleanShortText(inputs.message_ts, 120);
    const key = workflowDispatchKey(`approve-deals:${messageTs || 'global'}`);
    if (env.REFERRAL_KV) {
      const existing = await getJsonKV(env, key);
      const lastTriggeredAt = Number(existing?.triggeredAt || 0);
      const ageMs = Date.now() - lastTriggeredAt;
      if (lastTriggeredAt > 0 && ageMs >= 0 && ageMs < APPROVE_WORKFLOW_THROTTLE_MS) {
        return {
          ok: true,
          skipped: 'recently-triggered',
          retryAfterMs: APPROVE_WORKFLOW_THROTTLE_MS - ageMs,
        };
      }
    }

    const workflow = await triggerSlackApproveWorkflow(env, inputs);
    if (env.REFERRAL_KV) {
      await putJsonKV(env, key, {
        triggeredAt: Date.now(),
        reason: cleanShortText(reason, 120),
        messageTs,
      }, { expirationTtl: 10 * 60 });
    }
    return workflow;
  } catch (error) {
    return {
      ok: false,
      error: cleanLongText(error?.message || 'Approve workflow dispatch failed', 700),
    };
  }
}

async function handleDealAdminRemove(request, env) {
  if (!requireAdmin(request, env)) {
    return invalid('Unauthorized', 401);
  }

  const body = await readBody(request);
  const removal = normalizeDealRemovalInput(body);
  if (!removal) return invalid('Missing deal id or url');
  if (!liveDealRemovalsEnabled(env)) {
    return json({
      ok: true,
      paused: true,
      removal,
      message: 'Live deal removals are paused; no workflow was dispatched and no live deal was changed.',
    });
  }

  try {
    const workflow = await triggerDealModerationWorkflow(env, removal);
    return json({
      ok: true,
      removal,
      workflow,
    });
  } catch (error) {
    return invalid(error?.message || 'Deal removal failed', 502);
  }
}

function decodeBase64UrlJson(value) {
  try {
    const normalized = String(value || '').replace(/-/g, '+').replace(/_/g, '/');
    const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '=');
    return parseJsonObject(atob(padded));
  } catch {
    return {};
  }
}

async function signedDealRemovalUrlSignature(secret, payload) {
  const key = await crypto.subtle.importKey(
    'raw',
    textEncoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const digest = await crypto.subtle.sign('HMAC', key, textEncoder.encode(payload));
  return hexFromBytes(new Uint8Array(digest));
}

function dealRemovalHtml(title, body, status = 200) {
  const safeTitle = cleanShortText(title, 120)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
  const safeBody = cleanLongText(body, 900)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
  return new Response(`<!doctype html>
<html lang="de">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${safeTitle}</title>
  <style>
    body { margin: 0; font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; background: #f6f7f9; color: #17202c; }
    main { max-width: 680px; margin: 10vh auto; padding: 28px; background: #fff; border: 1px solid #d8dee8; border-radius: 8px; box-shadow: 0 12px 28px rgba(16, 24, 40, 0.08); }
    h1 { margin: 0 0 12px; font-size: 26px; }
    p { margin: 0 0 16px; line-height: 1.55; color: #344054; }
    a { color: #2364aa; }
  </style>
</head>
<body>
  <main>
    <h1>${safeTitle}</h1>
    <p>${safeBody}</p>
    <p><a href="https://github.com/ataalla24-ux/deal-finder/actions/workflows/deal-moderation.yml">GitHub Moderation Workflow</a> · <a href="https://freefinder.at/deal-admin.html">Deal Admin</a></p>
  </main>
</body>
</html>`, {
    status,
    headers: {
      ...JSON_HEADERS,
      'content-type': 'text/html; charset=utf-8',
    },
  });
}

async function handleSignedDealRemoveLink(request, env) {
  const url = new URL(request.url);
  const secret = envString(env, 'DEAL_REMOVE_LINK_SECRET');
  if (!secret) return dealRemovalHtml('Nicht konfiguriert', 'DEAL_REMOVE_LINK_SECRET fehlt im Worker.', 500);

  const payload = cleanShortText(url.searchParams.get('payload'), 5000);
  const sig = cleanShortText(url.searchParams.get('sig'), 128).toLowerCase();
  if (!payload || !sig) return dealRemovalHtml('Ungueltiger Link', 'Dieser Entfernen-Link ist unvollstaendig.', 400);

  const expected = await signedDealRemovalUrlSignature(secret, payload);
  if (!timingSafeEqualString(sig, expected)) {
    return dealRemovalHtml('Ungueltiger Link', 'Die Signatur dieses Entfernen-Links ist ungueltig.', 401);
  }

  const removal = normalizeDealRemovalInput(decodeBase64UrlJson(payload));
  if (!removal) return dealRemovalHtml('Ungueltiger Deal', 'Der Entfernen-Link enthaelt keine gueltige Deal-ID oder URL.', 400);
  const label = cleanShortText(removal.title || removal.brand || removal.dealId || removal.dealUrl, 160);

  try {
    await triggerDealModerationWorkflow(env, removal);
    return dealRemovalHtml('Entfernung gestartet', `${label} wird entfernt. Der GitHub-Workflow laeuft jetzt; danach verschwindet der Deal aus iOS, Web und Android.`);
  } catch (error) {
    return dealRemovalHtml('Entfernen fehlgeschlagen', error?.message || 'Der GitHub-Workflow konnte nicht gestartet werden.', 502);
  }
}

async function handleSignedDealRestoreLink(request, env) {
  const url = new URL(request.url);
  const secret = envString(env, 'DEAL_REMOVE_LINK_SECRET');
  if (!secret) return dealRemovalHtml('Nicht konfiguriert', 'DEAL_REMOVE_LINK_SECRET fehlt im Worker.', 500);

  const payload = cleanShortText(url.searchParams.get('payload'), 5000);
  const sig = cleanShortText(url.searchParams.get('sig'), 128).toLowerCase();
  if (!payload || !sig) return dealRemovalHtml('Ungueltiger Link', 'Dieser Offline-Link ist unvollstaendig.', 400);

  const expected = await signedDealRemovalUrlSignature(secret, payload);
  if (!timingSafeEqualString(sig, expected)) {
    return dealRemovalHtml('Ungueltiger Link', 'Die Signatur dieses Offline-Links ist ungueltig.', 401);
  }

  const restore = normalizeDealRestoreInput(decodeBase64UrlJson(payload));
  if (!restore) return dealRemovalHtml('Ungueltiger Deal', 'Der Offline-Link enthaelt keinen gueltigen Deal.', 400);

  try {
    await putJsonKV(env, dealOverrideKey(restore.dealId), normalizeDealOverrideInput(restore) || {
      dealId: restore.dealId,
      url: restore.url,
      hidden: false,
      pinnedRank: 0,
      title: restore.title,
      description: restore.description,
      brand: restore.brand,
      distance: restore.distance,
      pubDate: restore.pubDate,
      expires: restore.expires,
      expiresOriginal: restore.expiresOriginal,
      expiryKind: restore.expiryKind,
      validOn: restore.validOn,
      validFrom: restore.validFrom,
      validUntil: restore.validUntil,
      expiryDisplayText: restore.expiryDisplayText,
      updatedAt: Date.now(),
      createdAt: Date.now(),
    });
    const workflow = await triggerDealEditWorkflow(env, restore);
    const label = cleanShortText(restore.title || restore.brand || restore.dealId, 160);
    const workflowName = workflow?.workflow ? ` Workflow: ${workflow.workflow}.` : '';
    return dealRemovalHtml('Wiederherstellung gestartet', `${label} wird wieder live gesetzt. Der Deal bekommt einen Schutz gegen automatische Offline-Entfernung.${workflowName}`);
  } catch (error) {
    return dealRemovalHtml('Wiederherstellen fehlgeschlagen', error?.message || 'Der GitHub-Workflow konnte nicht gestartet werden.', 502);
  }
}

function normalizeSignedDealEditPayload(raw = {}) {
  const dealId = normalizeDealId(raw.dealId || raw.deal_id || raw.id);
  if (!dealId) return null;

  return {
    dealId,
    url: normalizeSubmissionUrl(raw.url || raw.dealUrl || raw.deal_url),
    title: cleanShortText(raw.title, 240),
    description: cleanLongText(raw.description || raw.details, 2500),
    brand: cleanShortText(raw.brand || raw.provider, 120),
    category: cleanShortText(raw.category, 80).toLowerCase(),
    type: cleanShortText(raw.type, 40).toLowerCase(),
    distance: cleanShortText(raw.distance || raw.location || raw.address, 200),
    pubDate: cleanShortText(raw.pubDate || raw.date, 80),
    expires: cleanShortText(raw.expires || raw.validUntil, 120),
    expiresOriginal: cleanShortText(raw.expiresOriginal || raw.expires || raw.validUntil, 180),
    expiryKind: cleanShortText(raw.expiryKind, 40).toLowerCase(),
    validOn: cleanShortText(raw.validOn, 32),
    validFrom: cleanShortText(raw.validFrom, 32),
    validUntil: cleanShortText(raw.validUntil, 32),
    expiryDisplayText: cleanShortText(raw.expiryDisplayText, 180),
    hidden: raw.hidden === true,
    pinnedRank: normalizePinnedRank(raw.pinnedRank),
  };
}

async function readSignedDealEditRequest(request, env) {
  const secret = envString(env, 'DEAL_REMOVE_LINK_SECRET');
  if (!secret) return { error: 'DEAL_REMOVE_LINK_SECRET fehlt im Worker.', status: 500 };

  let payload = '';
  let sig = '';
  let fields = {};

  if (request.method === 'POST') {
    const form = await request.formData().catch(() => null);
    if (!form) return { error: 'Formular konnte nicht gelesen werden.', status: 400 };
    payload = cleanShortText(form.get('payload'), 5000);
    sig = cleanShortText(form.get('sig'), 128).toLowerCase();
    fields = Object.fromEntries(form.entries());
  } else {
    const url = new URL(request.url);
    payload = cleanShortText(url.searchParams.get('payload'), 5000);
    sig = cleanShortText(url.searchParams.get('sig'), 128).toLowerCase();
  }

  if (!payload || !sig) return { error: 'Dieser Bearbeiten-Link ist unvollstaendig.', status: 400 };

  const expected = await signedDealRemovalUrlSignature(secret, payload);
  if (!timingSafeEqualString(sig, expected)) {
    return { error: 'Die Signatur dieses Bearbeiten-Links ist ungueltig.', status: 401 };
  }

  const base = normalizeSignedDealEditPayload(decodeBase64UrlJson(payload));
  if (!base) return { error: 'Der Bearbeiten-Link enthaelt keine gueltige Deal-ID.', status: 400 };

  return { base, fields, payload, sig };
}

function dealEditFormHtml({ edit, payload, sig, saved = false, error = '', workflow = null }, status = 200) {
  const title = saved ? 'Aenderung gespeichert' : (error ? 'Bearbeiten fehlgeschlagen' : 'Live-Deal bearbeiten');
  const value = (key) => escapeHtml(edit?.[key] ?? '');
  const checked = edit?.hidden ? ' checked' : '';
  const sourceLink = edit?.url
    ? `<a class="secondary" href="${escapeHtml(edit.url)}" target="_blank" rel="noopener">Quelle oeffnen</a>`
    : '';
  const workflowLink = workflow?.workflow
    ? ` <a href="https://github.com/ataalla24-ux/deal-finder/actions/workflows/${encodeURIComponent(workflow.workflow)}" target="_blank" rel="noopener">Workflow ansehen</a>`
    : '';

  return new Response(`<!doctype html>
<html lang="de">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(title)} - FreeFinder</title>
  <style>
    body { margin: 0; font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; background: #fff8ef; color: #211b16; }
    main { width: min(760px, calc(100% - 32px)); margin: 0 auto; padding: 28px 0 42px; }
    h1 { margin: 0 0 8px; font-size: clamp(32px, 8vw, 54px); line-height: .98; letter-spacing: 0; }
    p { margin: 0 0 20px; color: #70665e; font-size: 17px; line-height: 1.4; }
    form { display: grid; gap: 14px; }
    label { display: grid; gap: 7px; color: #5f574f; font-weight: 800; }
    input, textarea, select { box-sizing: border-box; width: 100%; border: 1px solid #e1d6c8; border-radius: 8px; padding: 12px 13px; font: inherit; color: #211b16; background: #fff; }
    textarea { min-height: 128px; resize: vertical; }
    .grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 14px; }
    .row { display: flex; flex-wrap: wrap; gap: 10px; align-items: center; }
    .readonly { background: #f1ebe4; color: #766b62; }
    .message { margin: 0 0 16px; padding: 12px 14px; border-radius: 8px; background: #e7f7ec; color: #17613b; font-weight: 800; }
    .message.error { background: #ffe7e1; color: #9d321e; }
    button, a.secondary { border: 0; border-radius: 999px; padding: 14px 18px; font: inherit; font-weight: 900; text-decoration: none; cursor: pointer; }
    button { color: #fff; background: linear-gradient(90deg, #f0a33d, #df654e); }
    a.secondary { color: #211b16; background: #ede6dc; }
    .check { display: flex; gap: 10px; align-items: center; font-weight: 800; }
    .check input { width: auto; }
    @media (max-width: 680px) { .grid { grid-template-columns: 1fr; } main { padding-top: 22px; } }
  </style>
</head>
<body>
  <main>
    <h1>${escapeHtml(title)}</h1>
    <p>Diese Aenderung wird als Live-Override gespeichert und per GitHub Action in die App-Daten veroeffentlicht.</p>
    ${saved ? `<div class="message">Gespeichert. Das App-Update wurde gestartet.${workflowLink}</div>` : ''}
    ${error ? `<div class="message error">${escapeHtml(error)}</div>` : ''}
    <form method="post">
      <input type="hidden" name="payload" value="${escapeHtml(payload)}">
      <input type="hidden" name="sig" value="${escapeHtml(sig)}">
      <label>Deal-ID
        <input class="readonly" name="dealId" value="${value('dealId')}" readonly>
      </label>
      <div class="grid">
        <label>Titel
          <input name="title" value="${value('title')}" placeholder="Deal-Titel">
        </label>
        <label>Anbieter
          <input name="brand" value="${value('brand')}" placeholder="Anbieter">
        </label>
      </div>
      <label>Beschreibung
        <textarea name="description" placeholder="Details">${value('description')}</textarea>
      </label>
      <div class="grid">
        <label>Kategorie
          <input name="category" value="${value('category')}" placeholder="z.B. essen, kaffee, shopping">
        </label>
        <label>Deal-Typ
          <input name="type" value="${value('type')}" placeholder="z.B. gratis, rabatt, bogo">
        </label>
      </div>
      <div class="grid">
        <label>Ort
          <input name="distance" value="${value('distance')}" placeholder="Adresse, Bezirk oder Wien">
        </label>
        <label>Quelle
          <input class="readonly" value="${value('url')}" readonly>
        </label>
      </div>
      <div class="grid">
        <label>Angebotsdatum
          <input name="pubDate" value="${value('pubDate')}" placeholder="TT.MM.JJJJ oder ISO">
        </label>
        <label>Gueltig bis
          <input name="expires" value="${value('expires')}" placeholder="TT.MM.JJJJ oder Text">
        </label>
      </div>
      <div class="grid">
        <label>Valid from
          <input name="validFrom" value="${value('validFrom')}" placeholder="YYYY-MM-DD">
        </label>
        <label>Valid until
          <input name="validUntil" value="${value('validUntil')}" placeholder="YYYY-MM-DD">
        </label>
      </div>
      <div class="grid">
        <label>Valid on
          <input name="validOn" value="${value('validOn')}" placeholder="YYYY-MM-DD">
        </label>
        <label>Anzeige-Text Ablauf
          <input name="expiryDisplayText" value="${value('expiryDisplayText')}" placeholder="z.B. Nur heute">
        </label>
      </div>
      <div class="grid">
        <label>Ablauf-Art
          <select name="expiryKind">
            <option value=""${edit?.expiryKind ? '' : ' selected'}>Automatisch</option>
            <option value="date"${edit?.expiryKind === 'date' ? ' selected' : ''}>Datum</option>
            <option value="range"${edit?.expiryKind === 'range' ? ' selected' : ''}>Zeitraum</option>
            <option value="text"${edit?.expiryKind === 'text' ? ' selected' : ''}>Text</option>
          </select>
        </label>
        <label>Pin-Rang
          <input name="pinnedRank" inputmode="numeric" value="${value('pinnedRank')}" placeholder="0">
        </label>
      </div>
      <label class="check"><input type="checkbox" name="hidden"${checked}> Deal verstecken</label>
      <div class="row">
        <button type="submit">Aenderung speichern</button>
        ${sourceLink}
        <a class="secondary" href="https://freefinder.at/deal-admin.html?deal=${encodeURIComponent(edit?.dealId || '')}" target="_blank" rel="noopener">Admin oeffnen</a>
      </div>
    </form>
  </main>
</body>
</html>`, {
    status,
    headers: {
      ...JSON_HEADERS,
      'content-type': 'text/html; charset=utf-8',
    },
  });
}

async function handleSignedDealEditLink(request, env) {
  if (!env.REFERRAL_KV) return dealRemovalHtml('Nicht konfiguriert', 'REFERRAL_KV binding fehlt im Worker.', 500);

  const signed = await readSignedDealEditRequest(request, env);
  if (signed.error) {
    return dealEditFormHtml({
      edit: {},
      payload: '',
      sig: '',
      error: signed.error,
    }, signed.status || 400);
  }

  const existing = await getJsonKV(env, dealOverrideKey(signed.base.dealId));
  const edit = {
    ...signed.base,
    ...(existing || {}),
    dealId: signed.base.dealId,
    url: signed.base.url,
  };

  if (request.method === 'GET') {
    return dealEditFormHtml({ edit, payload: signed.payload, sig: signed.sig });
  }

  const body = {
    dealId: signed.base.dealId,
    url: signed.base.url,
    title: signed.fields.title,
    brand: signed.fields.brand,
    description: signed.fields.description,
    category: signed.fields.category,
    type: signed.fields.type,
    distance: signed.fields.distance,
    pubDate: signed.fields.pubDate,
    expires: signed.fields.expires,
    expiresOriginal: signed.fields.expiresOriginal || signed.fields.expires,
    expiryKind: signed.fields.expiryKind,
    validOn: signed.fields.validOn,
    validFrom: signed.fields.validFrom,
    validUntil: signed.fields.validUntil,
    expiryDisplayText: signed.fields.expiryDisplayText,
    pinnedRank: signed.fields.pinnedRank,
    hidden: signed.fields.hidden === 'on',
  };
  if (body.hidden && !liveDealRemovalsEnabled(env)) {
    return dealEditFormHtml({
      edit: {
        ...edit,
        ...body,
        hidden: false,
      },
      payload: signed.payload,
      sig: signed.sig,
      error: 'Deal verstecken ist aktuell pausiert. Es wurde kein Live-Deal entfernt oder versteckt.',
    }, 409);
  }
  const next = normalizeDealOverrideInput(body, existing);
  if (!next) {
    return dealEditFormHtml({ edit, payload: signed.payload, sig: signed.sig, error: 'Ungueltige Deal-Aenderung.' });
  }

  await putJsonKV(env, dealOverrideKey(next.dealId), next);
  let workflow = null;
  try {
    workflow = await triggerDealEditWorkflow(env, next);
  } catch (error) {
    return dealEditFormHtml({
      edit: {
        ...signed.base,
        ...next,
        url: signed.base.url,
      },
      payload: signed.payload,
      sig: signed.sig,
      error: `KV gespeichert, aber App-Update nicht gestartet: ${error?.message || 'GitHub Workflow Fehler'}`,
    }, 502);
  }

  return dealEditFormHtml({
    edit: {
      ...signed.base,
      ...next,
      url: signed.base.url,
    },
    payload: signed.payload,
    sig: signed.sig,
    saved: true,
    workflow,
  });
}

async function slackSignatureHex(secret, timestamp, payload) {
  const key = await crypto.subtle.importKey(
    'raw',
    textEncoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const signatureBase = `v0:${timestamp}:${payload}`;
  const digest = await crypto.subtle.sign('HMAC', key, textEncoder.encode(signatureBase));
  return `v0=${hexFromBytes(new Uint8Array(digest))}`;
}

async function verifySlackRequest(request, env, payloadText) {
  const signingSecret = envString(env, 'SLACK_SIGNING_SECRET');
  if (!signingSecret) throw new Error('SLACK_SIGNING_SECRET is not configured');

  const timestamp = Number(request.headers.get('x-slack-request-timestamp') || 0);
  const signature = request.headers.get('x-slack-signature') || '';
  if (!timestamp || !signature) throw new Error('Missing Slack signature');

  const nowSeconds = Math.floor(Date.now() / 1000);
  if (Math.abs(nowSeconds - timestamp) > SLACK_REQUEST_TOLERANCE_SECONDS) {
    throw new Error('Slack request timestamp is outside tolerance');
  }

  const expected = await slackSignatureHex(signingSecret, timestamp, payloadText);
  if (!timingSafeEqualString(signature, expected)) {
    throw new Error('Invalid Slack signature');
  }
}

async function verifySlackEventRequest(request, env, payloadText) {
  const signingSecret = envString(env, 'SLACK_SIGNING_SECRET');
  if (!signingSecret) {
    return { verified: false, missingSecret: true };
  }

  await verifySlackRequest(request, env, payloadText);
  return { verified: true, missingSecret: false };
}

function slackEphemeral(text) {
  return json({
    response_type: 'ephemeral',
    text: cleanShortText(text, 240),
  });
}

function isSlackCheckReaction(value) {
  return ['white_check_mark', 'heavy_check_mark', 'check'].includes(cleanShortText(value, 80));
}

async function handleSlackEvent(request, env) {
  const rawBody = await request.text();
  let verification = { verified: false, missingSecret: false };

  try {
    verification = await verifySlackEventRequest(request, env, rawBody);
  } catch (error) {
    return invalid(error?.message || 'Invalid Slack request', 401);
  }

  const payload = parseJsonObject(rawBody);
  if (payload.type === 'url_verification') {
    return json({ challenge: cleanShortText(payload.challenge, 1200) });
  }

  if (payload.type !== 'event_callback') {
    return json({ ok: true, ignored: true, reason: 'unsupported-type' });
  }

  const event = payload.event && typeof payload.event === 'object' ? payload.event : {};
  if (event.type !== 'reaction_added' || !isSlackCheckReaction(event.reaction)) {
    return json({ ok: true, ignored: true, reason: 'not-approve-reaction' });
  }

  const expectedChannel = envString(env, 'SLACK_CHANNEL_ID');
  const eventChannel = cleanShortText(event.item?.channel || event.channel, 120);
  if (expectedChannel && eventChannel !== expectedChannel) {
    return json({ ok: true, ignored: true, reason: 'wrong-channel' });
  }

  const messageTs = cleanShortText(event.item?.ts, 120);
  if (!messageTs) {
    return json({ ok: true, ignored: true, reason: 'missing-message-ts' });
  }

  const workflow = await triggerSlackApproveSafely(env, 'slack-reaction-added', {
    slack_channel: eventChannel,
    message_ts: messageTs,
    reaction: cleanShortText(event.reaction, 80),
    ...(verification.verified ? { reaction_user: cleanShortText(event.user, 120) } : {}),
  });
  return json({
    ok: true,
    approveTriggered: Boolean(workflow?.ok && !workflow?.skipped),
    slackSignatureVerified: verification.verified,
    slackSigningSecretMissing: verification.missingSecret,
    workflow,
  });
}

async function handleSlackInteraction(request, env) {
  const rawBody = await request.text();

  try {
    await verifySlackRequest(request, env, rawBody);
  } catch (error) {
    return invalid(error?.message || 'Invalid Slack request', 401);
  }

  const form = new URLSearchParams(rawBody);
  const payload = parseJsonObject(form.get('payload'));
  const action = Array.isArray(payload.actions) ? payload.actions[0] : null;
  const actionId = cleanShortText(action?.action_id, 120);

  if (actionId !== 'freefinder_remove_deal') {
    return slackEphemeral('Diese Slack-Aktion wird vom FreeFinder Worker ignoriert.');
  }

  const actionPayload = parseJsonObject(action?.value);
  const removal = normalizeDealRemovalInput(actionPayload);
  if (!removal) {
    return slackEphemeral('Deal konnte nicht entfernt werden: ID oder URL fehlt.');
  }

  try {
    await triggerDealModerationWorkflow(env, removal);
    const label = cleanShortText(removal.title || removal.brand || removal.dealId || removal.dealUrl, 120);
    return slackEphemeral(`Entfernung gestartet: ${label}. Der Deal verschwindet nach dem GitHub-Workflow aus iOS, Web und Android.`);
  } catch (error) {
    return slackEphemeral(`Entfernen fehlgeschlagen: ${error?.message || 'unbekannter Fehler'}`);
  }
}

function envString(env, key) {
  return String(env?.[key] || '').trim();
}

function liveDealRemovalsEnabled(env) {
  return envString(env, 'LIVE_DEAL_REMOVALS_ENABLED') === '1';
}

function normalizeCheckoutPlan(value) {
  const plan = String(value || '').trim();
  return STRIPE_CHECKOUT_PLANS[plan] ? plan : '';
}

function checkoutReturnUrl(env, kind) {
  const configured = envString(env, kind === 'success' ? 'CHECKOUT_SUCCESS_URL' : 'CHECKOUT_CANCEL_URL');
  if (configured) return configured;
  const url = new URL(WEBSITE_HOME_URL);
  url.searchParams.set('checkout', kind);
  if (kind === 'success') url.searchParams.set('session_id', '{CHECKOUT_SESSION_ID}');
  return url.toString();
}

function hexFromBytes(bytes) {
  return Array.from(bytes).map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

function timingSafeEqualString(left, right) {
  const a = String(left || '');
  const b = String(right || '');
  let diff = a.length ^ b.length;
  const length = Math.max(a.length, b.length);
  for (let index = 0; index < length; index += 1) {
    diff |= (a.charCodeAt(index) || 0) ^ (b.charCodeAt(index) || 0);
  }
  return diff === 0;
}

function parseStripeSignatureHeader(header) {
  const parts = String(header || '').split(',');
  const parsed = { timestamp: '', signatures: [] };
  for (const part of parts) {
    const [key, value] = part.split('=');
    if (key === 't') parsed.timestamp = value || '';
    if (key === 'v1' && value) parsed.signatures.push(value);
  }
  return parsed;
}

async function stripeWebhookEvent(request, env) {
  const endpointSecret = envString(env, 'STRIPE_WEBHOOK_SECRET');
  if (!endpointSecret) throw new Error('Stripe webhook secret is not configured');

  const signature = parseStripeSignatureHeader(request.headers.get('stripe-signature'));
  const timestamp = Number(signature.timestamp || 0);
  if (!timestamp || signature.signatures.length === 0) {
    throw new Error('Missing Stripe webhook signature');
  }

  const nowSeconds = Math.floor(Date.now() / 1000);
  if (Math.abs(nowSeconds - timestamp) > STRIPE_WEBHOOK_TOLERANCE_SECONDS) {
    throw new Error('Stripe webhook timestamp is outside tolerance');
  }

  const payload = await request.text();
  const signedPayload = `${signature.timestamp}.${payload}`;
  const key = await crypto.subtle.importKey(
    'raw',
    textEncoder.encode(endpointSecret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const digest = await crypto.subtle.sign('HMAC', key, textEncoder.encode(signedPayload));
  const expected = hexFromBytes(new Uint8Array(digest));

  if (!signature.signatures.some((candidate) => timingSafeEqualString(candidate, expected))) {
    throw new Error('Invalid Stripe webhook signature');
  }

  return JSON.parse(payload);
}

async function stripeApi(secretKey, path, { method = 'GET', body, idempotencyKey } = {}) {
  const headers = {
    authorization: `Bearer ${secretKey}`,
    'stripe-version': STRIPE_API_VERSION,
  };
  if (body) headers['content-type'] = 'application/x-www-form-urlencoded';
  if (idempotencyKey) headers['idempotency-key'] = idempotencyKey;

  const response = await fetch(`https://api.stripe.com${path}`, {
    method,
    headers,
    body: body ? body.toString() : undefined,
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    const message = payload?.error?.message || `Stripe API error on ${path}`;
    throw new Error(message);
  }
  return payload;
}

async function findStripePriceByLookupKey(secretKey, lookupKey) {
  const params = new URLSearchParams();
  params.set('active', 'true');
  params.set('limit', '1');
  params.append('lookup_keys[]', lookupKey);
  const payload = await stripeApi(secretKey, `/v1/prices?${params.toString()}`);
  return Array.isArray(payload?.data) ? payload.data[0] : null;
}

async function createStripePrice(secretKey, plan, planConfig) {
  const params = new URLSearchParams();
  params.set('currency', 'eur');
  params.set('unit_amount', String(planConfig.unitAmount));
  params.set('lookup_key', planConfig.lookupKey);
  params.set('nickname', planConfig.label);
  params.set('product_data[name]', planConfig.label);
  params.set('product_data[metadata][freefinder_plan]', plan);
  params.set('metadata[freefinder_plan]', plan);
  params.set('metadata[source]', 'freefinder-worker');
  if (planConfig.recurringInterval) {
    params.set('recurring[interval]', planConfig.recurringInterval);
  }

  try {
    return await stripeApi(secretKey, '/v1/prices', {
      method: 'POST',
      body: params,
      idempotencyKey: `freefinder-price-${planConfig.lookupKey}`,
    });
  } catch (error) {
    const existingPrice = await findStripePriceByLookupKey(secretKey, planConfig.lookupKey);
    if (existingPrice?.id) return existingPrice;
    throw error;
  }
}

async function resolveStripePriceId(env, secretKey, plan, planConfig) {
  const configuredPrice = envString(env, planConfig.priceEnv);
  if (configuredPrice) return configuredPrice;

  const existingPrice = await findStripePriceByLookupKey(secretKey, planConfig.lookupKey);
  if (existingPrice?.id) return existingPrice.id;

  const createdPrice = await createStripePrice(secretKey, plan, planConfig);
  return createdPrice?.id || '';
}

async function createStripeCheckoutSession(request, env) {
  const body = await readBody(request);
  const plan = normalizeCheckoutPlan(body?.plan);
  if (!plan) return invalid('Invalid checkout plan');

  const planConfig = STRIPE_CHECKOUT_PLANS[plan];
  const isBusinessPlan = isBusinessCheckoutPlan(plan);
  const businessCampaign = isBusinessPlan ? normalizeBusinessCampaignInput(body?.campaign) : null;
  if (isBusinessPlan && !businessCampaign) {
    return invalid('Bitte Anbieter, Deal-Titel, Ort, Link, Details und Kontakt-E-Mail ausfüllen.');
  }
  if (isBusinessPlan && !env.REFERRAL_KV) {
    return invalid('Business checkout storage is not configured', 500);
  }

  const secretKey = envString(env, 'STRIPE_SECRET_KEY');
  if (!secretKey) return invalid('Stripe secret key is not configured', 500);

  let priceId = '';
  try {
    priceId = await resolveStripePriceId(env, secretKey, plan, planConfig);
  } catch (error) {
    return invalid(error?.message || `Stripe price is not configured for ${plan}`, 500);
  }
  if (!priceId) return invalid(`Stripe price is not configured for ${plan}`, 500);

  const campaignId = isBusinessPlan ? crypto.randomUUID() : '';
  const campaignRecord = isBusinessPlan ? {
    id: campaignId,
    plan,
    planLabel: planConfig.label,
    packageId: planConfig.merchantPackageId,
    priceId,
    status: 'checkout_creating',
    campaign: businessCampaign,
    source: 'website',
    createdAt: Date.now(),
    updatedAt: Date.now(),
  } : null;

  const params = new URLSearchParams();
  params.set('mode', planConfig.mode);
  params.set('line_items[0][price]', priceId);
  params.set('line_items[0][quantity]', '1');
  params.set('success_url', checkoutReturnUrl(env, 'success'));
  params.set('cancel_url', checkoutReturnUrl(env, 'cancel'));
  params.set('allow_promotion_codes', 'true');
  params.set('billing_address_collection', 'auto');
  params.set('metadata[plan]', plan);
  params.set('metadata[source]', 'freefinder-web');
  if (campaignRecord) {
    params.set('client_reference_id', campaignId);
    params.set('customer_email', businessCampaign.contactEmail);
    params.set('metadata[campaign_id]', campaignId);
    params.set('metadata[merchant_package_id]', planConfig.merchantPackageId);
    params.set('metadata[restaurant_name]', businessCampaign.restaurantName.slice(0, 120));
    params.set('payment_intent_data[metadata][plan]', plan);
    params.set('payment_intent_data[metadata][source]', 'freefinder-web');
    params.set('payment_intent_data[metadata][campaign_id]', campaignId);
    params.set('payment_intent_data[metadata][merchant_package_id]', planConfig.merchantPackageId);
  }
  if (planConfig.mode === 'subscription') {
    params.set('subscription_data[metadata][plan]', plan);
    params.set('subscription_data[metadata][source]', 'freefinder-web');
  } else {
    params.set('customer_creation', 'if_required');
  }

  const stripeResponse = await fetch('https://api.stripe.com/v1/checkout/sessions', {
    method: 'POST',
    headers: {
      authorization: `Bearer ${secretKey}`,
      'content-type': 'application/x-www-form-urlencoded',
      'stripe-version': STRIPE_API_VERSION,
    },
    body: params.toString(),
  });

  const payload = await stripeResponse.json().catch(() => null);
  if (!stripeResponse.ok || !payload?.url) {
    const message = payload?.error?.message || 'Stripe Checkout konnte nicht gestartet werden';
    return json({ ok: false, error: message }, stripeResponse.status || 502);
  }

  if (campaignRecord) {
    const sessionId = payload.id || '';
    const nextRecord = {
      ...campaignRecord,
      status: 'checkout_started',
      stripeSessionId: sessionId,
      checkoutStartedAt: Date.now(),
      updatedAt: Date.now(),
    };
    await putJsonKV(env, checkoutCampaignKey(campaignId), nextRecord, { expirationTtl: 90 * 24 * 60 * 60 });
    if (sessionId) {
      await env.REFERRAL_KV.put(checkoutSessionKey(sessionId), campaignId, { expirationTtl: 90 * 24 * 60 * 60 });
    }
  }

  return json({
    ok: true,
    plan,
    label: planConfig.label,
    url: payload.url,
    sessionId: payload.id || '',
    campaignId,
  });
}

async function getCheckoutStatus(request, env) {
  if (!env.REFERRAL_KV) return invalid('Checkout storage is not configured', 500);
  const url = new URL(request.url);
  const sessionId = cleanShortText(url.searchParams.get('session_id'), 160);
  if (!sessionId) return invalid('Missing session_id');

  const campaignId = await env.REFERRAL_KV.get(checkoutSessionKey(sessionId));
  if (!campaignId) {
    return json({
      ok: true,
      type: 'checkout',
      status: 'unknown',
      message: 'Zahlung wurde zurückgemeldet. Für Business-Anzeigen ist noch kein Campaign-Draft verknüpft.',
    });
  }

  const record = await getJsonKV(env, checkoutCampaignKey(campaignId));
  if (!record) return invalid('Campaign draft not found', 404);

  return json({
    ok: true,
    type: 'business',
    campaign: sanitizePublicCheckoutCampaign(record),
  });
}

async function submitMerchantCampaign(env, record, session) {
  const planConfig = STRIPE_CHECKOUT_PLANS[record.plan] || {};
  const campaign = record.campaign || {};
  const merchantBase = envString(env, 'MERCHANT_API_BASE') || MERCHANT_API_BASE_DEFAULT;
  const endpoint = `${merchantBase.replace(/\/+$/, '')}/api/merchant/campaigns`;
  const transactionId = cleanShortText(session?.payment_intent || session?.id || record.stripeSessionId, 160);

  const payload = {
    packageId: record.packageId || planConfig.merchantPackageId || '',
    productId: record.priceId || '',
    transactionId,
    originalTransactionId: cleanShortText(session?.id || record.stripeSessionId, 160),
    platform: 'web',
    restaurantName: campaign.restaurantName || '',
    dealTitle: campaign.dealTitle || '',
    description: campaign.description || '',
    oldPrice: campaign.oldPrice || '',
    dealPrice: campaign.dealPrice || '',
    address: campaign.address || '',
    ctaURL: campaign.ctaURL || '',
    contactEmail: campaign.contactEmail || '',
    category: campaign.category || 'restaurant',
    paymentProvider: 'stripe',
    stripeSessionId: cleanShortText(session?.id || record.stripeSessionId, 160),
    stripePaymentIntentId: cleanShortText(session?.payment_intent, 160),
    stripeCustomerId: cleanShortText(session?.customer, 160),
    source: 'freefinder-web',
  };
  const merchantSecret = envString(env, 'MERCHANT_API_SECRET');
  const headers = { 'content-type': 'application/json', accept: 'application/json' };
  if (merchantSecret) {
    headers['x-freefinder-merchant-secret'] = merchantSecret;
  }

  const response = await fetch(endpoint, {
    method: 'POST',
    headers,
    body: JSON.stringify(payload),
  });

  const responseText = await response.text();
  let responsePayload = null;
  try {
    responsePayload = responseText ? JSON.parse(responseText) : null;
  } catch {
    responsePayload = null;
  }

  if (!response.ok || responsePayload?.ok === false) {
    const message = responsePayload?.error || responseText || 'Merchant campaign submit failed';
    throw new Error(message.slice(0, 500));
  }

  return responsePayload;
}

async function processPaidBusinessCheckout(env, session, event) {
  const metadata = session?.metadata || {};
  const plan = normalizeCheckoutPlan(metadata.plan);
  if (!isBusinessCheckoutPlan(plan)) return { ignored: true, reason: 'not-business-plan' };

  const sessionId = cleanShortText(session?.id, 160);
  const campaignId = cleanShortText(metadata.campaign_id || session?.client_reference_id, 160)
    || (sessionId ? await env.REFERRAL_KV.get(checkoutSessionKey(sessionId)) : '');
  if (!campaignId) throw new Error('Business campaign id missing from Stripe session');

  const record = await getJsonKV(env, checkoutCampaignKey(campaignId));
  if (!record) throw new Error('Business campaign draft not found');

  if (event.type === 'checkout.session.async_payment_failed') {
    const failedRecord = {
      ...record,
      status: 'payment_failed',
      error: 'Stripe async payment failed',
      updatedAt: Date.now(),
    };
    await putJsonKV(env, checkoutCampaignKey(campaignId), failedRecord, { expirationTtl: 90 * 24 * 60 * 60 });
    return { campaignId, status: failedRecord.status };
  }

  const paymentStatus = String(session?.payment_status || '').toLowerCase();
  if (event.type === 'checkout.session.completed' && paymentStatus && paymentStatus !== 'paid') {
    const waitingRecord = {
      ...record,
      status: 'awaiting_payment',
      stripePaymentStatus: paymentStatus,
      updatedAt: Date.now(),
    };
    await putJsonKV(env, checkoutCampaignKey(campaignId), waitingRecord, { expirationTtl: 90 * 24 * 60 * 60 });
    return { campaignId, status: waitingRecord.status };
  }

  if (record.merchantSubmittedAt) {
    return { campaignId, status: record.status || 'merchant_submitted', duplicate: true };
  }

  const paidRecord = {
    ...record,
    status: 'paid',
    stripePaymentStatus: paymentStatus || 'paid',
    stripePaymentIntentId: cleanShortText(session?.payment_intent, 160),
    stripeCustomerId: cleanShortText(session?.customer, 160),
    paidAt: record.paidAt || Date.now(),
    updatedAt: Date.now(),
  };
  await putJsonKV(env, checkoutCampaignKey(campaignId), paidRecord, { expirationTtl: 90 * 24 * 60 * 60 });

  try {
    const merchantResponse = await submitMerchantCampaign(env, paidRecord, session);
    const submittedRecord = {
      ...paidRecord,
      status: 'merchant_submitted',
      merchantSubmittedAt: Date.now(),
      merchantResponse,
      error: '',
      updatedAt: Date.now(),
    };
    await putJsonKV(env, checkoutCampaignKey(campaignId), submittedRecord, { expirationTtl: 90 * 24 * 60 * 60 });
    return { campaignId, status: submittedRecord.status };
  } catch (error) {
    const failedRecord = {
      ...paidRecord,
      status: 'merchant_submit_failed',
      error: error?.message || 'Merchant campaign submit failed',
      updatedAt: Date.now(),
    };
    await putJsonKV(env, checkoutCampaignKey(campaignId), failedRecord, { expirationTtl: 90 * 24 * 60 * 60 });
    throw error;
  }
}

async function handleStripeWebhook(request, env) {
  if (!env.REFERRAL_KV) return invalid('Checkout storage is not configured', 500);

  let event = null;
  try {
    event = await stripeWebhookEvent(request, env);
  } catch (error) {
    return invalid(error?.message || 'Invalid Stripe webhook', 400);
  }

  const eventId = cleanShortText(event?.id, 160);
  if (!eventId) return invalid('Invalid Stripe event');

  const eventKey = checkoutEventKey(eventId);
  const existingEvent = await getJsonKV(env, eventKey);
  if (existingEvent?.processedAt) {
    return json({ ok: true, duplicate: true, eventId });
  }

  const handledTypes = new Set([
    'checkout.session.completed',
    'checkout.session.async_payment_succeeded',
    'checkout.session.async_payment_failed',
  ]);
  if (!handledTypes.has(event.type)) {
    await putJsonKV(env, eventKey, {
      id: eventId,
      type: cleanShortText(event.type, 120),
      ignoredAt: Date.now(),
    }, { expirationTtl: 30 * 24 * 60 * 60 });
    return json({ ok: true, ignored: true, eventId });
  }

  let result = null;
  try {
    result = await processPaidBusinessCheckout(env, event?.data?.object, event);
  } catch (error) {
    return invalid(error?.message || 'Stripe webhook processing failed', 502);
  }

  await putJsonKV(env, eventKey, {
    id: eventId,
    type: cleanShortText(event.type, 120),
    processedAt: Date.now(),
    result,
  }, { expirationTtl: 30 * 24 * 60 * 60 });

  return json({ ok: true, eventId, result });
}

function decodeHtmlEntities(value) {
  return String(value || '')
    .replace(/&#(\d+);/g, (_, code) => {
      const parsed = Number(code);
      return Number.isFinite(parsed) ? String.fromCharCode(parsed) : '';
    })
    .replace(/&#x([0-9a-f]+);/gi, (_, code) => {
      const parsed = parseInt(code, 16);
      return Number.isFinite(parsed) ? String.fromCharCode(parsed) : '';
    })
    .replace(/&quot;/g, '"')
    .replace(/&#039;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&nbsp;/g, ' ');
}

function stripHtmlTags(value) {
  return String(value || '')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ');
}

function cleanPreviewText(value, max = 600) {
  return decodeHtmlEntities(stripHtmlTags(value))
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max);
}

function normalizeOfferItemLabel(value) {
  const normalized = cleanPreviewText(value, 80).toLowerCase();
  const itemMap = {
    'döner': 'Döner',
    doener: 'Döner',
    kebab: 'Kebab',
    kebap: 'Kebab',
    pizza: 'Pizza',
    burger: 'Burger',
    kaffee: 'Kaffee',
    coffee: 'Kaffee',
    espresso: 'Espresso',
    latte: 'Latte',
    cappuccino: 'Cappuccino',
    cocktail: 'Cocktail',
    drink: 'Drink',
    getraenk: 'Getränk',
    getränk: 'Getränk',
    wrap: 'Wrap',
    falafel: 'Falafel',
    eis: 'Eis',
    gelato: 'Gelato',
    ramen: 'Ramen',
    sushi: 'Sushi',
    bowl: 'Bowl',
    brunch: 'Brunch',
    croissant: 'Croissant',
    krapfen: 'Krapfen',
    ticket: 'Ticket',
    eintritt: 'Eintritt',
  };
  return itemMap[normalized] || (normalized ? `${normalized[0].toUpperCase()}${normalized.slice(1)}` : '');
}

function formatEuroAmountForTitle(value) {
  const numeric = Number(String(value || '').replace(',', '.'));
  if (!Number.isFinite(numeric)) return '';
  const rounded = Math.round(numeric * 100) / 100;
  return Number.isInteger(rounded) ? `${rounded}€` : `${String(rounded).replace('.', ',')}€`;
}

function extractOfferHeadlineFromText(value) {
  const signal = cleanPreviewText(value, 2200)
    .toLowerCase()
    .replace(/https?:\/\/\S+/gi, ' ')
    .replace(/#[\w.äöüß-]+/gi, ' ')
    .replace(/@\w[\w.-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!signal) return '';

  const offerItems = 'döner|doener|kebab|kebap|pizza|burger|kaffee|coffee|espresso|latte|cappuccino|cocktail|drink|getränk|getraenk|wrap|falafel|eis|gelato|ramen|sushi|bowl|brunch|croissant|krapfen|ticket|eintritt';

  let match = signal.match(new RegExp(`(?:für|fuer|nur|um|ab)?\\s*(\\d+[,.]?\\d{0,2})\\s*(?:€|euro)\\s*(?:pro\\s+)?(${offerItems})`, 'i'));
  if (match) return `${formatEuroAmountForTitle(match[1])} ${normalizeOfferItemLabel(match[2])} Aktion`;

  match = signal.match(new RegExp(`(${offerItems})\\s*(?:für|fuer|nur|um|ab)?\\s*(\\d+[,.]?\\d{0,2})\\s*(?:€|euro)`, 'i'));
  if (match) return `${formatEuroAmountForTitle(match[2])} ${normalizeOfferItemLabel(match[1])} Aktion`;

  match = signal.match(new RegExp(`(?:gratis|kostenlos|free)\\s+(?:einen?|eine|ein|deinen?|deine|dein)?\\s*(${offerItems})`, 'i'));
  if (match) return `Gratis ${normalizeOfferItemLabel(match[1])}`;

  match = signal.match(new RegExp(`(${offerItems})\\s+(?:gratis|kostenlos|free)`, 'i'));
  if (match) return `Gratis ${normalizeOfferItemLabel(match[1])}`;

  match = signal.match(new RegExp(`(1\\+1|2\\s*f[üu]r\\s*1|buy\\s*one\\s*get\\s*one|bogo)\\s*(?:auf|für|fuer)?\\s*(${offerItems})?`, 'i'));
  if (match) return match[2] ? `1+1 ${normalizeOfferItemLabel(match[2])}` : '1+1 Aktion';

  match = signal.match(new RegExp(`(${offerItems})\\s*(?:1\\+1|2\\s*f[üu]r\\s*1|buy\\s*one\\s*get\\s*one|bogo)`, 'i'));
  if (match) return `1+1 ${normalizeOfferItemLabel(match[1])}`;

  match = signal.match(/(\d{1,2})\s*%\s*(?:rabatt|discount|off)/i);
  if (match) return `${match[1]}% Rabatt`;

  match = signal.match(/\b(?:rabatt|discount|spare|save)\s*(\d{1,2})\s*%/i);
  if (match) return `${match[1]}% Rabatt`;

  match = signal.match(/(\d+)\s*(monat|monate|month|months)\s*(?:gratis|kostenlos|free)/i);
  if (match) return `${match[1]} ${Number(match[1]) === 1 ? 'Monat' : 'Monate'} gratis`;

  if (/\b(gratis|kostenlos|free)\b/i.test(signal)) return 'Gratis Aktion';
  return '';
}

function getPreviewHost(url) {
  try {
    return new URL(String(url || '')).hostname.toLowerCase().replace(/^www\./, '');
  } catch {
    return '';
  }
}

function isPrivatePreviewHost(host) {
  const normalized = String(host || '').trim().toLowerCase();
  if (!normalized) return true;
  if (
    normalized === 'localhost' ||
    normalized === '0.0.0.0' ||
    normalized === '::1' ||
    normalized === '[::1]' ||
    normalized.endsWith('.local') ||
    normalized.endsWith('.internal')
  ) {
    return true;
  }

  if (/^\d{1,3}(?:\.\d{1,3}){3}$/.test(normalized)) {
    const [a, b] = normalized.split('.').map(Number);
    if (
      a === 0 ||
      a === 10 ||
      a === 127 ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168)
    ) {
      return true;
    }
  }

  return false;
}

function normalizePreviewUrl(rawValue) {
  let raw = String(rawValue || '').trim();
  if (!raw) return '';
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(raw)) raw = `https://${raw}`;

  try {
    const parsed = new URL(raw);
    if (!/^https?:$/i.test(parsed.protocol)) return '';
    if (parsed.username || parsed.password) return '';
    if (parsed.port && !['80', '443'].includes(parsed.port)) return '';

    const host = parsed.hostname.toLowerCase().replace(/^www\./, '');
    if (isPrivatePreviewHost(host)) return '';

    parsed.hash = '';

    const trackingPrefixes = ['utm_', 'igsh', 'fbclid', 'gclid', 'mc_cid', 'mc_eid'];
    const keptEntries = [...parsed.searchParams.entries()].filter(([key]) => {
      const normalizedKey = String(key || '').toLowerCase();
      return !trackingPrefixes.some((prefix) => normalizedKey.startsWith(prefix));
    });
    parsed.search = '';
    for (const [key, value] of keptEntries) {
      parsed.searchParams.append(key, value);
    }

    if (host === 'instagram.com' || host === 'instagr.am' || host === 'm.instagram.com') {
      const parts = parsed.pathname.split('/').filter(Boolean);
      if (parts.length >= 2 && ['p', 'reel', 'tv'].includes(parts[0].toLowerCase())) {
        parsed.hostname = 'www.instagram.com';
        parsed.pathname = `/${parts[0].toLowerCase()}/${parts[1]}/`;
        parsed.search = '';
      }
    }

    if (host.endsWith('tiktok.com')) {
      parsed.hostname = 'www.tiktok.com';
      parsed.searchParams.delete('lang');
      parsed.searchParams.delete('is_copy_url');
      parsed.searchParams.delete('is_from_webapp');
      parsed.searchParams.delete('sender_device');
    }

    return parsed.toString();
  } catch {
    return '';
  }
}

function extractMetaContent(html, key) {
  const escaped = String(key || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const patterns = [
    new RegExp(`<meta[^>]+(?:property|name)=["']${escaped}["'][^>]+content=["']([^"']*)["'][^>]*>`, 'i'),
    new RegExp(`<meta[^>]+content=["']([^"']*)["'][^>]+(?:property|name)=["']${escaped}["'][^>]*>`, 'i'),
  ];

  for (const pattern of patterns) {
    const match = html.match(pattern);
    if (match && match[1]) return cleanPreviewText(match[1], 1400);
  }
  return '';
}

function extractCanonicalUrl(html) {
  const match = html.match(/<link[^>]+rel=["']canonical["'][^>]+href=["']([^"']+)["'][^>]*>/i)
    || html.match(/<link[^>]+href=["']([^"']+)["'][^>]+rel=["']canonical["'][^>]*>/i);
  return match && match[1] ? cleanPreviewText(match[1], 1200) : '';
}

function extractTitleTag(html) {
  const match = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  return match && match[1] ? cleanPreviewText(match[1], 300) : '';
}

function extractJsonLdSummary(html) {
  const scriptMatches = [...html.matchAll(/<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)];
  for (const match of scriptMatches) {
    const raw = match && match[1] ? match[1].trim() : '';
    if (!raw) continue;

    try {
      const parsed = JSON.parse(raw);
      const queue = Array.isArray(parsed) ? parsed : [parsed];
      for (const entry of queue) {
        if (!entry || typeof entry !== 'object') continue;
        const candidate = entry.headline || entry.name || entry.description || entry.articleBody || '';
        if (candidate) {
          return {
            title: cleanPreviewText(entry.headline || entry.name || '', 280),
            description: cleanPreviewText(entry.description || entry.articleBody || '', 1400),
          };
        }
      }
    } catch {
      continue;
    }
  }

  return { title: '', description: '' };
}

function getSourcePlatform(host) {
  const normalized = String(host || '').toLowerCase();
  if (/(^|\.)instagram\.com$/.test(normalized) || normalized === 'instagr.am') return 'instagram';
  if (/(^|\.)tiktok\.com$/.test(normalized)) return 'tiktok';
  if (/(^|\.)facebook\.com$/.test(normalized)) return 'facebook';
  if (normalized === 'x.com' || /(^|\.)twitter\.com$/.test(normalized)) return 'x';
  return '';
}

function extractInstagramAccountInfo(title, description) {
  const titleText = cleanPreviewText(title, 320);
  const descriptionText = cleanPreviewText(description, 1400);

  let accountName = '';
  let accountHandle = '';

  let match = titleText.match(/^(.+?)\s+(?:on|auf)\s+Instagram:/i);
  if (match) accountName = cleanPreviewText(match[1], 120);

  match = titleText.match(/^(.+?)\s+\(@([^)\s]+)\)\s+•\s+Instagram/i);
  if (match) {
    accountName = cleanPreviewText(match[1], 120);
    accountHandle = cleanPreviewText(match[2], 80).replace(/^@+/, '');
  }

  match = descriptionText.match(/-\s*([A-Za-z0-9._-]{2,40})\s+(?:on|am)\s+[^:]{4,80}:/i);
  if (match && !accountHandle) accountHandle = cleanPreviewText(match[1], 80).replace(/^@+/, '');

  return {
    accountName,
    accountHandle,
  };
}

function extractInstagramCaption(description, title) {
  const descriptionText = cleanPreviewText(description, 1600);
  const titleText = cleanPreviewText(title, 1200);

  const fromDescription = descriptionText.match(/-\s*[^:]{1,120}\s+(?:on|am)\s+[^:]{4,120}:\s*"([\s\S]+?)"\.?\s*$/i)
    || descriptionText.match(/(?:on|auf)\s+Instagram:\s*"([\s\S]+?)"\.?\s*$/i)
    || descriptionText.match(/:\s*"([\s\S]{16,})"\.?\s*$/i);
  if (fromDescription && fromDescription[1]) {
    return cleanPreviewText(fromDescription[1], 1200);
  }

  const fromTitle = titleText.match(/(?:on|auf)\s+Instagram:\s*"([\s\S]+?)"\s*$/i);
  if (fromTitle && fromTitle[1]) {
    return cleanPreviewText(fromTitle[1], 800);
  }

  return '';
}

function isGenericSocialPreviewTitle(title, sourcePlatform = '') {
  const normalized = cleanPreviewText(title, 280)
    .toLowerCase()
    .replace(/[.!?\s]+$/g, '')
    .trim();
  if (!normalized) return true;
  if (/^(instagram|instagram deal|instagram post|instagram reel|instagram video|instagram photo|login \u2022 instagram|instagram)$/.test(normalized)) return true;
  if (/^(tik ?tok|tiktok deal|tiktok - make your day|facebook|x)$/.test(normalized)) return true;
  if (sourcePlatform === 'instagram') {
    if (/^instagram\s+(?:photos?|videos?|reels?)\s+and\s+videos$/i.test(normalized)) return true;
    if (/^(?:photo|video|reel)\s+(?:by|von)\s+.+\s+(?:on|auf)\s+instagram$/i.test(normalized)) return true;
  }
  return false;
}

function buildReadablePreviewTitleFromText(value) {
  const cleaned = cleanPreviewText(value, 1200)
    .replace(/https?:\/\/\S+/gi, ' ')
    .replace(/#[\w.äöüß-]+/gi, ' ')
    .replace(/@\w[\w.-]+/g, ' ')
    .replace(/\s+(?:on|auf)\s+Instagram:\s*/i, ' ')
    .replace(/^["“]+|["”]+$/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (!cleaned) return '';

  const firstSentence = cleaned.split(/[.!?]/)[0].trim();
  const candidate = (firstSentence || cleaned).replace(/^["“]+|["”]+$/g, '').trim();
  if (!candidate || isGenericSocialPreviewTitle(candidate)) return '';
  if (candidate.length <= 90) return candidate;
  return `${candidate.slice(0, 87).trim()}...`;
}

function buildSmartSocialPreviewTitle({ sourcePlatform, rawTitle, caption, description, accountName, accountHandle }) {
  const signalText = [
    caption,
    description,
    rawTitle,
    accountName,
    accountHandle,
  ].filter(Boolean).join(' ');
  const offerTitle = extractOfferHeadlineFromText(signalText);
  if (offerTitle) return offerTitle;

  if (sourcePlatform === 'instagram') {
    const captionTitle = buildReadablePreviewTitleFromText(caption || description);
    if (captionTitle) return captionTitle;
  }

  if (!isGenericSocialPreviewTitle(rawTitle, sourcePlatform)) {
    const readableRawTitle = buildReadablePreviewTitleFromText(rawTitle);
    if (readableRawTitle) return readableRawTitle;
    return cleanPreviewText(rawTitle, 280);
  }

  const readableFallback = buildReadablePreviewTitleFromText(caption || description);
  if (readableFallback) return readableFallback;
  if (sourcePlatform === 'instagram') return 'Instagram Deal prüfen';
  if (sourcePlatform === 'tiktok') return 'TikTok Deal prüfen';
  return '';
}

async function buildDealLinkPreview(rawUrl) {
  const normalizedUrl = normalizePreviewUrl(rawUrl);
  if (!normalizedUrl) throw new Error('Invalid preview URL');

  const targetHost = getPreviewHost(normalizedUrl);
  if (!targetHost || isPrivatePreviewHost(targetHost)) {
    throw new Error('Preview host is not allowed');
  }

  const response = await fetch(normalizedUrl, {
    method: 'GET',
    redirect: 'follow',
    headers: {
      'user-agent': 'Mozilla/5.0 (compatible; FreeFinderPreviewBot/1.0; +https://freefinder.at)',
      accept: 'text/html,application/xhtml+xml',
      'accept-language': 'de-AT,de;q=0.9,en;q=0.8',
      'cache-control': 'no-cache',
    },
  });

  if (!response.ok) {
    throw new Error(`Preview fetch failed with ${response.status}`);
  }

  const html = (await response.text()).slice(0, 250000);
  const finalUrl = normalizePreviewUrl(response.url || normalizedUrl) || normalizedUrl;
  const finalHost = getPreviewHost(finalUrl);
  const sourcePlatform = getSourcePlatform(finalHost);

  const ogTitle = extractMetaContent(html, 'og:title');
  const ogDescription = extractMetaContent(html, 'og:description');
  const twitterTitle = extractMetaContent(html, 'twitter:title');
  const twitterDescription = extractMetaContent(html, 'twitter:description');
  const metaDescription = extractMetaContent(html, 'description');
  const ogImage = extractMetaContent(html, 'og:image');
  const siteName = extractMetaContent(html, 'og:site_name');
  const canonicalUrl = normalizePreviewUrl(extractCanonicalUrl(html)) || finalUrl;
  const titleTag = extractTitleTag(html);
  const jsonLd = extractJsonLdSummary(html);
  const account = sourcePlatform === 'instagram'
    ? extractInstagramAccountInfo(ogTitle || twitterTitle || titleTag, ogDescription || metaDescription)
    : { accountName: '', accountHandle: '' };
  const caption = sourcePlatform === 'instagram'
    ? extractInstagramCaption(ogDescription || metaDescription, ogTitle || twitterTitle || titleTag)
    : '';
  const rawTitle = cleanPreviewText(ogTitle || twitterTitle || jsonLd.title || titleTag, 280);
  const rawDescription = cleanPreviewText(caption || ogDescription || twitterDescription || jsonLd.description || metaDescription, 1400);
  const smartTitle = buildSmartSocialPreviewTitle({
    sourcePlatform,
    rawTitle,
    caption,
    description: rawDescription,
    accountName: account.accountName,
    accountHandle: account.accountHandle,
  }) || rawTitle;

  return {
    ok: true,
    requestedUrl: normalizedUrl,
    finalUrl,
    canonicalUrl,
    host: finalHost,
    sourcePlatform,
    siteName: cleanPreviewText(siteName, 120),
    title: cleanPreviewText(smartTitle, 280),
    description: rawDescription,
    image: cleanPreviewText(ogImage, 1400),
    meta: {
      ogTitle,
      ogDescription,
      twitterTitle,
      twitterDescription,
      titleTag,
      metaDescription,
    },
    accountName: cleanPreviewText(account.accountName, 120),
    accountHandle: cleanPreviewText(account.accountHandle, 80),
    caption: cleanPreviewText(caption, 1200),
  };
}

async function loadPublicDealsForShare() {
  const response = await fetch(WEBSITE_DEALS_JSON_URL, {
    headers: {
      accept: 'application/json',
      'cache-control': 'no-cache',
    },
    cf: {
      cacheTtl: 180,
      cacheEverything: true,
    },
  });

  if (!response.ok) return [];

  const raw = await response.json();
  const deals = Array.isArray(raw) ? raw : (Array.isArray(raw?.deals) ? raw.deals : []);
  return deals.filter((deal) => deal && typeof deal === 'object');
}

async function dealForShare(dealId) {
  const normalizedDealId = normalizeDealId(dealId);
  if (!normalizedDealId) return null;
  const deals = await loadPublicDealsForShare();
  return deals.find((deal) => normalizeDealId(deal.id) === normalizedDealId) || null;
}

function buildDealShareDestination(dealId, requestUrl) {
  const destination = new URL(WEBSITE_HOME_URL);
  const code = normalizeCode(requestUrl.searchParams.get('ref'));
  if (code) destination.searchParams.set('ref', code);
  destination.searchParams.set('source', 'deal_share_preview');
  destination.searchParams.set('deal', dealId);
  return destination.toString();
}

function dealShareTitle(deal) {
  const title = cleanPreviewText(deal?.title, 120);
  if (!title) return 'FreeFinder Deal in Wien';
  return `${title} - FreeFinder Wien`;
}

function dealShareDescription(deal) {
  const brand = cleanPreviewText(deal?.brand, 80);
  const description = cleanPreviewText(deal?.description, 190);
  const location = cleanPreviewText(deal?.distance || deal?.location, 90);
  const type = cleanPreviewText(deal?.type, 40).toLowerCase();
  const intro = type === 'gratis' ? 'Gratis-Deal' : 'Deal';
  const parts = [
    brand,
    description,
    location ? `Ort: ${location}` : '',
  ].filter(Boolean);
  return cleanPreviewText(`${intro} in Wien: ${parts.join(' - ')}. Direkt in FreeFinder oeffnen.`, 260);
}

async function renderDealSharePreview(dealId, requestUrl) {
  const normalizedDealId = normalizeDealId(dealId);
  if (!normalizedDealId) return invalid('Invalid deal id', 404);

  const deal = await dealForShare(normalizedDealId);
  const destination = buildDealShareDestination(normalizedDealId, requestUrl);
  const title = dealShareTitle(deal);
  const description = deal
    ? dealShareDescription(deal)
    : 'Oeffne diesen geteilten Wien-Deal direkt in FreeFinder.';
  const safeTitle = escapeHtml(title);
  const safeDescription = escapeHtml(description);
  const safeDestination = escapeHtml(destination);
  const jsDestination = JSON.stringify(destination);

  const html = `<!doctype html>
<html lang="de">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${safeTitle}</title>
  <meta name="description" content="${safeDescription}" />
  <meta property="og:title" content="${safeTitle}" />
  <meta property="og:description" content="${safeDescription}" />
  <meta property="og:image" content="${WEBSITE_SHARE_IMAGE_URL}" />
  <meta property="og:image:secure_url" content="${WEBSITE_SHARE_IMAGE_URL}" />
  <meta property="og:image:type" content="image/png" />
  <meta property="og:image:width" content="1200" />
  <meta property="og:image:height" content="630" />
  <meta property="og:url" content="${safeDestination}" />
  <meta property="og:site_name" content="FreeFinder Wien" />
  <meta property="og:type" content="website" />
  <meta name="twitter:card" content="summary_large_image" />
  <meta name="twitter:title" content="${safeTitle}" />
  <meta name="twitter:description" content="${safeDescription}" />
  <meta name="twitter:image" content="${WEBSITE_SHARE_IMAGE_URL}" />
  <meta http-equiv="refresh" content="0;url=${safeDestination}" />
  <link rel="canonical" href="${safeDestination}" />
  <style>
    body {
      margin: 0;
      min-height: 100vh;
      display: grid;
      place-items: center;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      background: #fffaf4;
      color: #151414;
    }
    a {
      color: #071634;
      font-weight: 800;
    }
  </style>
</head>
<body>
  <main>
    <strong>${safeTitle}</strong><br />
    <a href="${safeDestination}">Deal in FreeFinder oeffnen</a>
  </main>
  <script>location.replace(${jsDestination});</script>
</body>
</html>`;

  return new Response(html, {
    status: 200,
    headers: {
      'content-type': 'text/html; charset=utf-8',
      'cache-control': 'public, max-age=300',
    },
  });
}

function escapeHtml(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function renderReferralLanding(code, requestUrl) {
  const dealIdRaw = requestUrl.searchParams.get('deal');
  const dealId = normalizeDealId(dealIdRaw);
  const safeCode = escapeHtml(code);
  const appStoreUrl = `https://apps.apple.com/at/app/id${APP_STORE_APP_ID}?ct=${encodeURIComponent(`ref_${code}`)}&mt=8`;
  const minDelaySeconds = Math.ceil(MIN_CONFIRM_DELAY_MS / 1000);
  const continueUrl = dealId
    ? `https://freefinder.at/?deal=${encodeURIComponent(dealId)}`
    : 'https://freefinder.at/';
  const safeDealHint = dealId ? '<p>Dein Freund hat dir einen konkreten Deal geschickt. Nach der Bestaetigung kannst du ihn direkt in FreeFinder ansehen.</p>' : '';
  const continueButtonHtml = dealId
    ? '<button id="continueBtn" class="button secondary" style="display:none">Zum geteilten Deal</button>'
    : '';

  const html = `<!doctype html>
<html lang="de">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>FreeFinder im App Store oeffnen</title>
  <style>
    :root { color-scheme: light; }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      min-height: 100vh;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      background:
        radial-gradient(circle at top left, rgba(14, 165, 233, 0.18), transparent 34%),
        radial-gradient(circle at bottom right, rgba(16, 185, 129, 0.14), transparent 30%),
        linear-gradient(180deg, #f8fafc 0%, #eef6ff 100%);
      color: #0f172a;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 18px;
    }
    .card {
      width: 100%;
      max-width: 420px;
      background: rgba(255,255,255,0.9);
      border: 1px solid rgba(148, 163, 184, 0.22);
      border-radius: 30px;
      padding: 26px 22px 22px;
      box-shadow: 0 24px 70px rgba(15, 23, 42, 0.12);
      backdrop-filter: blur(16px);
    }
    .eyebrow {
      display: inline-flex;
      padding: 6px 10px;
      border-radius: 999px;
      background: rgba(15, 23, 42, 0.06);
      color: #0f172a;
      font-size: 12px;
      font-weight: 700;
      letter-spacing: 0.04em;
      text-transform: uppercase;
    }
    h1 {
      margin: 16px 0 10px;
      font-size: 32px;
      line-height: 1.02;
      letter-spacing: -0.04em;
    }
    p { margin: 0 0 14px; color: #475569; line-height: 1.5; }
    .hero {
      margin: 18px 0 20px;
      padding: 18px;
      border-radius: 22px;
      background: linear-gradient(135deg, rgba(255,255,255,0.8), rgba(241,245,249,0.9));
      border: 1px solid rgba(148, 163, 184, 0.16);
    }
    .spinner {
      width: 18px;
      height: 18px;
      border-radius: 999px;
      border: 2px solid rgba(14, 165, 233, 0.18);
      border-top-color: #0ea5e9;
      animation: spin 0.8s linear infinite;
      flex-shrink: 0;
    }
    .hero-row {
      display: flex;
      align-items: center;
      gap: 10px;
      margin-bottom: 10px;
      font-size: 14px;
      color: #0369a1;
      font-weight: 700;
    }
    .hero strong {
      display: block;
      margin-bottom: 6px;
      font-size: 17px;
      color: #0f172a;
    }
    .hero p {
      margin: 0;
      color: #475569;
      font-size: 14px;
    }
    .button {
      width: 100%;
      border: 0;
      border-radius: 18px;
      padding: 16px 18px;
      font-size: 16px;
      font-weight: 800;
      cursor: pointer;
      transition: transform 0.15s ease, opacity 0.15s ease;
    }
    .button:active { transform: scale(0.98); }
    .button.primary {
      background: linear-gradient(135deg, #0ea5e9, #22c55e);
      color: white;
      box-shadow: 0 14px 34px rgba(14, 165, 233, 0.24);
    }
    .button.secondary {
      margin-top: 10px;
      background: rgba(255,255,255,0.72);
      color: #0f172a;
      border: 1px solid rgba(148, 163, 184, 0.22);
    }
    .button[disabled] { opacity: 0.65; cursor: wait; }
    .status {
      margin-top: 16px;
      min-height: 48px;
      border-radius: 18px;
      padding: 14px;
      font-size: 14px;
      line-height: 1.5;
      background: rgba(255,255,255,0.72);
      color: #334155;
      border: 1px solid rgba(148, 163, 184, 0.18);
    }
    .status.success { background: rgba(16,185,129,0.12); color: #166534; }
    .status.error { background: rgba(239,68,68,0.12); color: #991b1b; }
    .fineprint {
      margin-top: 14px;
      font-size: 12px;
      color: #64748b;
      text-align: center;
    }
    .code {
      color: #0369a1;
      font-weight: 800;
      word-break: break-word;
    }
    @keyframes spin {
      from { transform: rotate(0deg); }
      to { transform: rotate(360deg); }
    }
  </style>
</head>
<body>
  <main class="card">
    <div class="eyebrow">FreeFinder</div>
    <h1>FreeFinder im App Store oeffnen</h1>
    <p>Du wirst automatisch weitergeleitet. Falls nichts passiert, tippe einfach auf den Button.</p>
    <div class="hero">
      <div class="hero-row">
        <div class="spinner" aria-hidden="true"></div>
        <span>Weiterleitung wird vorbereitet</span>
      </div>
      <strong>Kostenlos laden und danach einmal starten.</strong>
      <p>Die Einladung wird im Hintergrund fuer deinen Freund gutgeschrieben.</p>
    </div>
    ${safeDealHint}
    <button id="downloadBtn" class="button primary">Im App Store oeffnen</button>
    <button id="confirmBtn" class="button secondary">Ich habe die App installiert</button>
    ${continueButtonHtml}
    <div id="status" class="status">Einladungscode: <span class="code">${safeCode}</span></div>
    <div class="fineprint">Falls du nach dem Download nicht automatisch zurueckkommst, oeffne FreeFinder einmal und tippe hier spaeter auf "Ich habe die App installiert".</div>
  </main>
  <script>
    const code = ${JSON.stringify(code)};
    const appStoreUrl = ${JSON.stringify(appStoreUrl)};
    const minConfirmDelayMs = ${JSON.stringify(MIN_CONFIRM_DELAY_MS)};
    const continueUrl = ${JSON.stringify(continueUrl)};
    const clipboardPrefix = 'FREEFINDER_REFERRAL:';
    const claimKey = 'ff_referral_claim_' + code;
    const visitorIdKey = 'ff_referral_visitor_id';
    const statusEl = document.getElementById('status');
    const downloadBtn = document.getElementById('downloadBtn');
    const confirmBtn = document.getElementById('confirmBtn');
    const continueBtn = document.getElementById('continueBtn');
    let autoOpenTriggered = false;

    function setStatus(message, kind) {
      statusEl.textContent = message;
      statusEl.className = 'status' + (kind ? ' ' + kind : '');
    }

    function showContinueButton() {
      if (!continueBtn) return;
      continueBtn.style.display = 'block';
    }

    function getVisitorId() {
      let value = localStorage.getItem(visitorIdKey);
      if (!value) {
        value = Math.random().toString(36).slice(2, 12) + Date.now().toString(36);
        localStorage.setItem(visitorIdKey, value);
      }
      return value;
    }

    function getStoredClaim() {
      try {
        return JSON.parse(localStorage.getItem(claimKey) || 'null');
      } catch {
        return null;
      }
    }

    function setStoredClaim(payload) {
      localStorage.setItem(claimKey, JSON.stringify(payload));
    }

    function clearStoredClaim() {
      localStorage.removeItem(claimKey);
    }

    async function api(path, options) {
      const res = await fetch(path, {
        headers: { 'Content-Type': 'application/json' },
        ...options
      });
      const body = await res.json().catch(() => null);
      if (!res.ok) {
        throw new Error(body && body.error ? body.error : 'Request failed');
      }
      return body;
    }

    async function startClaim() {
      const existing = getStoredClaim();
      if (existing && existing.claimToken) return existing;
      const result = await api('/api/referrals/claim/start', {
        method: 'POST',
        body: JSON.stringify({
          code,
          visitorId: getVisitorId(),
          userAgent: navigator.userAgent || '',
          source: 'worker-landing'
        })
      });
      if (result.alreadyClaimed) {
        setStatus('Diese Einladung wurde auf diesem Geraet bereits bestaetigt.', 'success');
        return result;
      }
      if (result.claimToken) {
        const payload = {
          claimToken: result.claimToken,
          startedAt: result.startedAt || Date.now(),
          visitorId: getVisitorId(),
          code,
          dealId: ${JSON.stringify(dealId || '')}
        };
        setStoredClaim(payload);
        return payload;
      }
      return result;
    }

    async function writeReferralPayloadToClipboard(payload) {
      if (!navigator.clipboard || typeof navigator.clipboard.writeText !== 'function') {
        return false;
      }
      const serialized = clipboardPrefix + JSON.stringify({
        code: payload.code || code,
        claimToken: payload.claimToken,
        visitorId: payload.visitorId || getVisitorId(),
        startedAt: payload.startedAt || Date.now(),
        dealId: payload.dealId || ${JSON.stringify(dealId || '')}
      });
      try {
        await navigator.clipboard.writeText(serialized);
        return true;
      } catch {
        return false;
      }
    }

    async function completeClaim(source) {
      const claim = getStoredClaim();
      if (!claim || !claim.claimToken) {
        setStatus('Bitte zuerst auf "Im App Store oeffnen" tippen.', 'error');
        return null;
      }
      const elapsed = Date.now() - Number(claim.startedAt || 0);
      if (elapsed < minConfirmDelayMs) {
        const waitSeconds = Math.ceil((minConfirmDelayMs - elapsed) / 1000);
        setStatus('Bitte noch ' + waitSeconds + ' Sek. warten und dann erneut bestaetigen.', 'error');
        return null;
      }
      const result = await api('/api/referrals/claim/complete', {
        method: 'POST',
        body: JSON.stringify({
          code,
          claimToken: claim.claimToken,
          visitorId: getVisitorId(),
          userAgent: navigator.userAgent || '',
          installSource: source
        })
      });
      if (result.completed || result.alreadyClaimed || typeof result.installs === 'number') {
        clearStoredClaim();
        const installs = typeof result.installs === 'number' ? result.installs : 0;
        setStatus('Danke! Die Einladung wurde bestaetigt. Aktueller Stand: ' + installs + ' bestaetigte Einladung(en).', 'success');
        showContinueButton();
      }
      return result;
    }

    async function handleDownload() {
      if (downloadBtn.disabled) return;
      downloadBtn.disabled = true;
      try {
        const claim = await startClaim();
        const clipboardReady = claim && claim.claimToken ? await writeReferralPayloadToClipboard(claim) : false;
        if (clipboardReady) {
          setStatus('App Store wird geoeffnet. FreeFinder kann die Einladung beim ersten Start automatisch bestaetigen.', '');
        } else {
          setStatus('App Store wird geoeffnet. Falls die automatische Erkennung nicht klappt, kannst du spaeter hier bestaetigen.', '');
        }
        window.location.href = appStoreUrl;
      } catch (error) {
        setStatus(error.message || 'Einladung konnte nicht gestartet werden.', 'error');
      } finally {
        window.setTimeout(() => {
          downloadBtn.disabled = false;
        }, 1200);
      }
    }

    async function tryAutoComplete() {
      const claim = getStoredClaim();
      if (!claim || !claim.claimToken) return;
      if (Date.now() - Number(claim.startedAt || 0) < minConfirmDelayMs) return;
      try {
        await completeClaim('auto-return');
      } catch (error) {
        setStatus(error.message || 'Automatische Bestaetigung fehlgeschlagen.', 'error');
      }
    }

    downloadBtn.addEventListener('click', handleDownload);
    confirmBtn.addEventListener('click', async () => {
      confirmBtn.disabled = true;
      try {
        await completeClaim('manual-confirm');
      } catch (error) {
        setStatus(error.message || 'Bestaetigung fehlgeschlagen.', 'error');
      } finally {
        window.setTimeout(() => {
          confirmBtn.disabled = false;
        }, 800);
      }
    });
    if (continueBtn) {
      continueBtn.addEventListener('click', () => {
        window.location.href = continueUrl;
      });
    }

    window.setTimeout(() => {
      if (autoOpenTriggered) return;
      autoOpenTriggered = true;
      handleDownload();
    }, 850);

    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') tryAutoComplete();
    });
    window.addEventListener('pageshow', () => { tryAutoComplete(); });
    window.addEventListener('focus', () => { tryAutoComplete(); });
    tryAutoComplete();
  </script>
</body>
</html>`;

  return new Response(html, {
    status: 200,
    headers: {
      'content-type': 'text/html; charset=utf-8',
      'cache-control': 'no-store'
    }
  });
}

function redirectReferralToWebsite(code, requestUrl) {
  const dealId = normalizeDealId(requestUrl.searchParams.get('deal'));
  const destination = new URL('https://freefinder.at/');
  destination.searchParams.set('ref', code);
  destination.searchParams.set('source', dealId ? 'legacy_deal_share' : 'legacy_referral_share');
  if (dealId) destination.searchParams.set('deal', dealId);
  return Response.redirect(destination.toString(), 302);
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const path = url.pathname.replace(/\/+$/, '') || '/';

    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: JSON_HEADERS });
    }

    if (path === '/health' || path === '/api/health') {
      return json({ ok: true, service: 'freefinder-referrals' });
    }

    if (request.method === 'GET' && path.startsWith('/d/')) {
      const dealId = decodeURIComponent(path.slice(3));
      return renderDealSharePreview(dealId, url);
    }

    if (request.method === 'GET' && path.startsWith('/r/')) {
      const code = normalizeCode(decodeURIComponent(path.slice(3)));
      if (!code) return invalid('Invalid referral code', 404);
      return redirectReferralToWebsite(code, url);
    }

    if (path === '/api/checkout/session' && request.method === 'POST') {
      return createStripeCheckoutSession(request, env);
    }

    if (path === '/api/checkout/status' && request.method === 'GET') {
      return getCheckoutStatus(request, env);
    }

    if (path === '/api/checkout/webhook' && request.method === 'POST') {
      return handleStripeWebhook(request, env);
    }

    if (path === '/api/slack/interactions' && request.method === 'POST') {
      return handleSlackInteraction(request, env);
    }

    if (path === '/api/slack/events' && request.method === 'POST') {
      return handleSlackEvent(request, env);
    }

    if (path === '/api/deals/admin/remove' && request.method === 'POST') {
      return handleDealAdminRemove(request, env);
    }

    if (path === '/api/deals/admin/remove-link' && request.method === 'GET') {
      return handleSignedDealRemoveLink(request, env);
    }

    if (path === '/api/deals/admin/restore-link' && request.method === 'GET') {
      return handleSignedDealRestoreLink(request, env);
    }

    if (path === '/api/deals/admin/edit-link' && (request.method === 'GET' || request.method === 'POST')) {
      return handleSignedDealEditLink(request, env);
    }

    if (!env.REFERRAL_KV) {
      return invalid('REFERRAL_KV binding is missing', 500);
    }

    if (path.startsWith('/api/social/media/') && request.method === 'GET') {
      return handleSocialMediaDownload(path, env);
    }

    if (path === '/api/social/media' && request.method === 'POST') {
      return handleSocialMediaUpload(request, env);
    }

    if (path === '/api/social/tiktok/connect-session' && request.method === 'POST') {
      return handleTikTokConnectSession(request, env);
    }

    if (path === '/api/social/tiktok/callback' && request.method === 'GET') {
      return handleTikTokCallback(request, env);
    }

    if (path === '/api/social/tiktok/status' && request.method === 'GET') {
      return handleTikTokStatus(request, env);
    }

    if (path === '/api/social/tiktok/publish' && request.method === 'POST') {
      return handleTikTokPublish(request, env);
    }

    if (path === '/api/social/tiktok/publish/status' && (request.method === 'GET' || request.method === 'POST')) {
      return handleTikTokPublishStatus(request, env);
    }

    if (path === '/api/social/instagram/connect-session' && request.method === 'POST') {
      return handleInstagramConnectSession(request, env);
    }

    if (path === '/api/social/instagram/callback' && request.method === 'GET') {
      return handleInstagramCallback(request, env);
    }

    if (path === '/api/social/instagram/status' && request.method === 'GET') {
      return handleInstagramStatus(request, env);
    }

    if (path === '/api/social/instagram/publish' && request.method === 'POST') {
      return handleInstagramPublish(request, env);
    }

    if (path === '/api/social/instagram/publish/status' && (request.method === 'GET' || request.method === 'POST')) {
      return handleInstagramPublishStatus(request, env);
    }

    if (path === '/api/social/instagram/publish/complete' && request.method === 'POST') {
      return handleInstagramPublishComplete(request, env);
    }

    if (path === '/api/promotions/redeem' && request.method === 'POST') {
      const body = await readBody(request);
      const code = normalizePromotionCode(body?.code);
      const deviceId = normalizeId(body?.deviceId);
      const platform = cleanShortText(body?.platform, 24).toLowerCase();
      const appVersion = cleanShortText(body?.appVersion, 64);
      const campaign = PROMOTION_CAMPAIGNS[code];

      if (!campaign) return invalid('Promotion code is not active', 404);
      if (!deviceId) return invalid('Invalid device id');
      if (!['ios', 'android'].includes(platform)) return invalid('Invalid platform');

      const key = promotionClaimKey(code, deviceId);
      const existing = await getJsonKV(env, key);
      if (existing) {
        const promotion = promotionPayload(campaign, existing);
        if (!promotion.active) {
          return json({
            ok: false,
            error: 'Promotion was already redeemed on this device',
            alreadyRedeemed: true,
            promotion,
          }, 409);
        }
        return json({
          ok: true,
          alreadyRedeemed: true,
          promotion,
        });
      }

      const claimedAt = Date.now();
      const record = {
        code,
        deviceId,
        plan: campaign.plan,
        claimedAt,
        expiresAt: claimedAt + campaign.durationDays * 24 * 60 * 60 * 1000,
        platform,
        appVersion,
        source: cleanShortText(body?.source, 80) || 'campaign-link',
        userAgent: cleanShortText(request.headers.get('user-agent'), 256),
      };
      await putJsonKV(env, key, record);

      return json({
        ok: true,
        redeemed: true,
        promotion: promotionPayload(campaign, record),
      }, 201);
    }

    if (path === '/api/promotions/status' && request.method === 'GET') {
      const code = normalizePromotionCode(url.searchParams.get('code'));
      const deviceId = normalizeId(url.searchParams.get('deviceId'));
      const campaign = PROMOTION_CAMPAIGNS[code];

      if (!campaign) return invalid('Promotion code is not active', 404);
      if (!deviceId) return invalid('Invalid device id');

      const record = await getJsonKV(env, promotionClaimKey(code, deviceId));
      if (!record) {
        return json({
          ok: true,
          redeemed: false,
          promotion: promotionPayload(campaign, null),
        });
      }

      return json({
        ok: true,
        redeemed: true,
        promotion: promotionPayload(campaign, record),
      });
    }

    if (path === '/api/referrals/register' && request.method === 'POST') {
      const body = await readBody(request);
      const code = normalizeCode(body?.code);
      const inviterDeviceId = normalizeId(body?.inviterDeviceId);
      if (!code) return invalid('Invalid referral code');
      if (!inviterDeviceId) return invalid('Invalid inviter device id');

      const existing = await getJsonKV(env, codeKey(code));
      if (existing && existing.inviterDeviceId && existing.inviterDeviceId !== inviterDeviceId) {
        return invalid('Referral code already belongs to another device', 409);
      }

      const record = normalizeRecord(existing, code, inviterDeviceId);
      await putJsonKV(env, codeKey(code), record);
      return json({ ok: true, ...sanitizeInstallSummary(record) });
    }

    if (path === '/api/push/apns/register' && request.method === 'POST') {
      const body = await readBody(request);
      const token = normalizePushToken(body?.token);
      const bundleId = String(body?.bundleId || '').trim();
      const platform = String(body?.platform || '').trim().toLowerCase();
      const appVersion = String(body?.appVersion || '').trim().slice(0, 64);
      const build = String(body?.build || '').trim().slice(0, 64);

      if (platform !== 'ios') return invalid('Only iOS APNS tokens are supported here');
      if (!token) return invalid('Invalid APNS token');
      if (!bundleId) return invalid('Missing bundle id');

      const existing = await getJsonKV(env, apnsTokenKey(token));
      const record = {
        token,
        platform: 'ios',
        bundleId,
        appVersion,
        build,
        lastSeenAt: Date.now(),
        createdAt: existing?.createdAt || Date.now()
      };

      await putJsonKV(env, apnsTokenKey(token), record);
      return json({
        ok: true,
        registered: true,
        platform: 'ios',
        bundleId,
        lastSeenAt: record.lastSeenAt
      });
    }

    if (path === '/api/push/apns/send' && request.method === 'POST') {
      if (!requireAdmin(request, env)) {
        return invalid('Unauthorized', 401);
      }

      const body = await readBody(request);
      if (!body || typeof body !== 'object') {
        return invalid('Missing push payload');
      }

      try {
        const result = await sendApnsPush(env, body);
        return json(result, result.ok ? 200 : 502);
      } catch (error) {
        return invalid(error?.message || 'APNS send failed', 500);
      }
    }

    if (path === '/api/push/apns/status' && request.method === 'GET') {
      if (!requireAdmin(request, env)) {
        return invalid('Unauthorized', 401);
      }

      const records = await listApnsTokens(env, 25);
      const bundleId = String(env.APNS_BUNDLE_ID || '').trim();
      const credentialsReady = Boolean(
        String(env.ADMIN_API_TOKEN || '').trim() &&
        String(env.APNS_TEAM_ID || '').trim() &&
        String(env.APNS_KEY_ID || '').trim() &&
        String(env.APNS_PRIVATE_KEY || '').trim() &&
        bundleId
      );

      return json({
        ok: true,
        credentialsReady,
        bundleId,
        sandbox: String(env.APNS_USE_SANDBOX || '').trim().toLowerCase() === 'true',
        registeredTokens: records.length,
        latest: records.map((record) => ({
          platform: record.platform || 'ios',
          bundleId: record.bundleId || '',
          appVersion: record.appVersion || '',
          build: record.build || '',
          lastSeenAt: record.lastSeenAt || null,
          createdAt: record.createdAt || null,
          tokenMasked: maskPushToken(record.token),
        })),
      });
    }

    if (path === '/api/deals/state' && request.method === 'GET') {
      const overrides = await listDealOverrides(env, 500);
      const dailyDeal = normalizeDailyDealRecord(await getJsonKV(env, dealDailyKey()));
      return json({
        ok: true,
        overrides: overrides.map(sanitizePublicDealOverride).filter(Boolean),
        dailyDeal: isCurrentDailyDealRecord(dailyDeal) ? sanitizePublicDailyDeal(dailyDeal) : null,
      });
    }

    if (path === '/api/deals/preview' && request.method === 'GET') {
      const targetUrl = url.searchParams.get('url');
      if (!targetUrl) return invalid('Missing preview url');

      try {
        const preview = await buildDealLinkPreview(targetUrl);
        return json(preview);
      } catch (error) {
        return invalid(error?.message || 'Preview fetch failed', 502);
      }
    }

    if (path === '/api/deals/submissions' && request.method === 'POST') {
      const body = await readBody(request);
      const submission = normalizeCommunitySubmissionInput(body, request);
      if (!submission) return invalid('Invalid deal submission');

      const existing = await findExistingSubmissionByUrl(env, submission.url);
      if (existing) {
        const intakeWorkflow = normalizeSubmissionStatus(existing.status) === 'pending'
          ? await triggerCommunityIntakeSafely(env)
          : { ok: false, skipped: 'already-not-pending' };
        return json({
          ok: true,
          alreadyQueued: true,
          slackDeliveryPending: normalizeSubmissionStatus(existing.status) === 'pending',
          intakeTriggered: Boolean(intakeWorkflow?.ok),
          intakeWorkflow,
          submission: sanitizePublicCommunitySubmission(existing),
        });
      }

      await putJsonKV(env, dealSubmissionKey(submission.id), submission);
      const intakeWorkflow = await triggerCommunityIntakeSafely(env);
      return json({
        ok: true,
        slackDeliveryPending: true,
        intakeTriggered: Boolean(intakeWorkflow?.ok),
        intakeWorkflow,
        submission: sanitizePublicCommunitySubmission(submission),
      }, 201);
    }

    if (path === '/api/deals/submit' && request.method === 'POST') {
      const body = await readBody(request);
      const submission = normalizeLegacyDealSubmitInput(body, request);
      if (!submission) return invalid('Invalid deal submission');

      const existing = await findExistingSubmissionByUrl(env, submission.url);
      if (existing) {
        const intakeWorkflow = normalizeSubmissionStatus(existing.status) === 'pending'
          ? await triggerCommunityIntakeSafely(env)
          : { ok: false, skipped: 'already-not-pending' };
        return json({
          ok: true,
          slackDelivered: false,
          queued: true,
          alreadyQueued: true,
          slackDeliveryPending: normalizeSubmissionStatus(existing.status) === 'pending',
          intakeTriggered: Boolean(intakeWorkflow?.ok),
          intakeWorkflow,
          submission: sanitizePublicCommunitySubmission(existing),
        });
      }

      await putJsonKV(env, dealSubmissionKey(submission.id), submission);
      const intakeWorkflow = await triggerCommunityIntakeSafely(env);
      return json({
        ok: true,
        slackDelivered: false,
        queued: true,
        slackDeliveryPending: true,
        intakeTriggered: Boolean(intakeWorkflow?.ok),
        intakeWorkflow,
        submission: sanitizePublicCommunitySubmission(submission),
      }, 201);
    }

    if (path === '/api/deals/submissions/admin/pending' && request.method === 'GET') {
      if (!requireCommunitySync(request, env) && !requireAdmin(request, env)) {
        return invalid('Unauthorized', 401);
      }

      const limit = Math.max(1, Math.min(200, Number(url.searchParams.get('limit') || 100)));
      const statuses = String(url.searchParams.get('status') || 'pending')
        .split(',')
        .map((value) => normalizeSubmissionStatus(value))
        .filter(Boolean);
      const submissions = await listCommunitySubmissions(env, { limit, statuses });

      return json({
        ok: true,
        submissions: submissions.map(sanitizePublicCommunitySubmission).filter(Boolean),
      });
    }

    if (path === '/api/deals/submissions/admin/mark-posted' && request.method === 'POST') {
      if (!requireCommunitySync(request, env) && !requireAdmin(request, env)) {
        return invalid('Unauthorized', 401);
      }

      const body = await readBody(request);
      const ids = Array.isArray(body?.ids)
        ? body.ids.map((value) => cleanShortText(value, 80)).filter(Boolean)
        : [];
      if (ids.length === 0) return invalid('Missing submission ids');

      let updated = 0;
      for (const id of ids) {
        const existing = await getJsonKV(env, dealSubmissionKey(id));
        if (!existing || !existing.id) continue;
        const next = {
          ...existing,
          status: 'queued',
          postedAt: Date.now(),
          updatedAt: Date.now(),
        };
        await putJsonKV(env, dealSubmissionKey(id), next);
        updated += 1;
      }

      return json({ ok: true, updated });
    }

    if (path === '/api/deals/admin/check' && request.method === 'GET') {
      if (!requireAdmin(request, env)) {
        return invalid('Unauthorized', 401);
      }
      return json({ ok: true, admin: true });
    }

    if (path === '/api/deals/admin/override' && request.method === 'POST') {
      if (!requireAdmin(request, env)) {
        return invalid('Unauthorized', 401);
      }

      const body = await readBody(request);
      const dealId = normalizeDealId(body?.dealId);
      if (!dealId) return invalid('Invalid deal id');

      const existing = await getJsonKV(env, dealOverrideKey(dealId));
      const next = normalizeDealOverrideInput(body, existing);
      if (!next) return invalid('Invalid deal override');

      await putJsonKV(env, dealOverrideKey(dealId), next);
      return json({ ok: true, override: sanitizePublicDealOverride(next) });
    }

    if (path === '/api/deals/admin/daily-deal' && request.method === 'POST') {
      if (!requireAdmin(request, env)) {
        return invalid('Unauthorized', 401);
      }

      const body = await readBody(request);
      const dealId = normalizeDealId(body?.dealId);
      if (!dealId) return invalid('Invalid deal id');

      const record = {
        dealId,
        note: cleanShortText(body?.note, 180),
        updatedAt: Date.now(),
        date: getViennaDayKey(),
      };

      await putJsonKV(env, dealDailyKey(), record);
      return json({ ok: true, dailyDeal: sanitizePublicDailyDeal(record) });
    }

    if (path === '/api/referrals/status' && request.method === 'GET') {
      const code = normalizeCode(url.searchParams.get('code'));
      if (!code) return invalid('Invalid referral code');
      const record = await getJsonKV(env, codeKey(code));
      if (!record) return invalid('Referral code not found', 404);
      return json({ ok: true, ...sanitizeInstallSummary(record) });
    }

    if (path === '/api/referrals/claim/start' && request.method === 'POST') {
      const body = await readBody(request);
      const code = normalizeCode(body?.code);
      const visitorId = normalizeId(body?.visitorId);
      if (!code) return invalid('Invalid referral code');
      if (!visitorId) return invalid('Invalid visitor id');

      const record = await getJsonKV(env, codeKey(code));
      if (!record) return invalid('Referral code not found', 404);
      if (record.inviterDeviceId === visitorId) {
        return invalid('Inviter cannot claim own referral', 403);
      }

      const installs = Array.isArray(record.installs) ? record.installs : [];
      if (installs.some((entry) => entry.visitorId === visitorId)) {
        return json({ ok: true, alreadyClaimed: true, ...sanitizeInstallSummary(record) });
      }

      const existingToken = await env.REFERRAL_KV.get(pendingKey(code, visitorId));
      if (existingToken) {
        const existingClaim = await getJsonKV(env, claimKey(existingToken));
        if (existingClaim && existingClaim.status === 'pending') {
          return json({
            ok: true,
            code,
            claimToken: existingToken,
            alreadyPending: true,
            startedAt: existingClaim.startedAt
          });
        }
      }

      const claimToken = crypto.randomUUID();
      const claim = {
        code,
        visitorId,
        status: 'pending',
        startedAt: Date.now(),
        userAgent: String(body?.userAgent || '').slice(0, 512),
        source: String(body?.source || '').slice(0, 128)
      };

      await putJsonKV(env, claimKey(claimToken), claim);
      await env.REFERRAL_KV.put(pendingKey(code, visitorId), claimToken, { expirationTtl: 7 * 24 * 60 * 60 });

      return json({ ok: true, code, claimToken, startedAt: claim.startedAt });
    }

    if (path === '/api/referrals/claim/complete' && request.method === 'POST') {
      const body = await readBody(request);
      const code = normalizeCode(body?.code);
      const visitorId = normalizeId(body?.visitorId);
      const claimToken = String(body?.claimToken || '').trim();
      const installSource = String(body?.installSource || 'app-store').slice(0, 128);
      const canConfirmImmediately = [
        'app-store-click',
        'deal-share-download',
        'referral-download-click',
        'whatsapp-app-store-click'
      ].includes(installSource);
      if (!code) return invalid('Invalid referral code');
      if (!visitorId) return invalid('Invalid visitor id');
      if (!claimToken) return invalid('Missing claim token');

      const claim = await getJsonKV(env, claimKey(claimToken));
      if (!claim) return invalid('Claim not found', 404);
      if (claim.code !== code || claim.visitorId !== visitorId) {
        return invalid('Claim does not match referral request', 403);
      }
      if (claim.status === 'completed') {
        const record = await getJsonKV(env, codeKey(code));
        if (!record) return invalid('Referral code not found', 404);
        return json({ ok: true, alreadyClaimed: true, ...sanitizeInstallSummary(record) });
      }
      if (!canConfirmImmediately && Date.now() - claim.startedAt < MIN_CONFIRM_DELAY_MS) {
        return invalid('Confirm too early after opening the referral link', 429);
      }

      const record = await getJsonKV(env, codeKey(code));
      if (!record) return invalid('Referral code not found', 404);
      if (record.inviterDeviceId === visitorId) {
        return invalid('Inviter cannot claim own referral', 403);
      }

      const installs = Array.isArray(record.installs) ? record.installs : [];
      if (!installs.some((entry) => entry.visitorId === visitorId)) {
        installs.push({
          visitorId,
          completedAt: Date.now(),
          userAgent: String(body?.userAgent || '').slice(0, 512),
          installSource,
          source: String(claim.source || '').slice(0, 128)
        });
      }

      const nextRecord = normalizeRecord({ ...record, installs }, code, record.inviterDeviceId);
      await putJsonKV(env, codeKey(code), nextRecord);
      await putJsonKV(env, claimKey(claimToken), {
        ...claim,
        status: 'completed',
        completedAt: Date.now()
      });
      await env.REFERRAL_KV.delete(pendingKey(code, visitorId));

      return json({ ok: true, completed: true, ...sanitizeInstallSummary(nextRecord) });
    }

    return invalid('Not found', 404);
  }
};

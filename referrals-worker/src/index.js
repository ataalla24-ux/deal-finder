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
const VIENNA_DAY_FORMATTER = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Europe/Vienna',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

function json(data, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: JSON_HEADERS });
}

function normalizeCode(value) {
  const code = String(value || '').trim().toUpperCase();
  return /^FF-[A-Z0-9]{4,12}$/.test(code) ? code : '';
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

async function putJsonKV(env, key, value) {
  await env.REFERRAL_KV.put(key, JSON.stringify(value));
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

function normalizeDealOverrideInput(body, existing = null) {
  const dealId = normalizeDealId(body?.dealId || existing?.dealId);
  if (!dealId) return null;

  const next = {
    dealId,
    hidden: body?.hidden === true,
    pinnedRank: normalizePinnedRank(body?.pinnedRank),
    title: cleanShortText(body?.title, 240),
    description: cleanLongText(body?.description, 2500),
    brand: cleanShortText(body?.brand, 120),
    distance: cleanShortText(body?.distance, 200),
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
      'user-agent': 'Mozilla/5.0 (compatible; FreeFinderPreviewBot/1.0; +https://freefinder.app)',
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
    ? `https://ataalla24-ux.github.io/deal-finder/?deal=${encodeURIComponent(dealId)}`
    : 'https://ataalla24-ux.github.io/deal-finder/';
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

    if (request.method === 'GET' && path.startsWith('/r/')) {
      const code = normalizeCode(decodeURIComponent(path.slice(3)));
      if (!code) return invalid('Invalid referral code', 404);
      return renderReferralLanding(code, url);
    }

    if (!env.REFERRAL_KV) {
      return invalid('REFERRAL_KV binding is missing', 500);
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
        return json({
          ok: true,
          alreadyQueued: true,
          submission: sanitizePublicCommunitySubmission(existing),
        });
      }

      await putJsonKV(env, dealSubmissionKey(submission.id), submission);
      return json({
        ok: true,
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

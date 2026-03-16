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
  if (!record || !record.dealId) return null;
  return {
    dealId: record.dealId,
    updatedAt: Number(record.updatedAt || 0) || null,
    note: typeof record.note === 'string' ? record.note : '',
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
  return {
    code: record?.code || '',
    installs: installs.length,
    isEligible: installs.length >= 2,
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
  <title>FreeFinder Einladung</title>
  <style>
    :root { color-scheme: light; }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      min-height: 100vh;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      background: radial-gradient(circle at top, #312e81 0%, #111827 45%, #030712 100%);
      color: #f9fafb;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 20px;
    }
    .card {
      width: 100%;
      max-width: 420px;
      background: rgba(17, 24, 39, 0.92);
      border: 1px solid rgba(255,255,255,0.08);
      border-radius: 28px;
      padding: 28px 22px;
      box-shadow: 0 24px 60px rgba(0,0,0,0.45);
    }
    .eyebrow {
      display: inline-flex;
      padding: 6px 10px;
      border-radius: 999px;
      background: rgba(251,191,36,0.15);
      color: #fde68a;
      font-size: 12px;
      font-weight: 700;
      letter-spacing: 0.04em;
      text-transform: uppercase;
    }
    h1 { margin: 14px 0 10px; font-size: 30px; line-height: 1.05; }
    p { margin: 0 0 14px; color: #d1d5db; line-height: 1.5; }
    .steps {
      margin: 20px 0;
      padding: 16px;
      border-radius: 18px;
      background: rgba(255,255,255,0.05);
    }
    .steps div { margin: 0 0 10px; font-size: 14px; }
    .steps div:last-child { margin-bottom: 0; }
    .button {
      width: 100%;
      border: 0;
      border-radius: 16px;
      padding: 16px 18px;
      font-size: 16px;
      font-weight: 800;
      cursor: pointer;
      transition: transform 0.15s ease, opacity 0.15s ease;
    }
    .button:active { transform: scale(0.98); }
    .button.primary {
      background: linear-gradient(135deg, #f59e0b, #ef4444);
      color: white;
      box-shadow: 0 14px 34px rgba(239, 68, 68, 0.35);
    }
    .button.secondary {
      margin-top: 10px;
      background: rgba(255,255,255,0.08);
      color: #f9fafb;
      border: 1px solid rgba(255,255,255,0.12);
    }
    .button[disabled] { opacity: 0.65; cursor: wait; }
    .status {
      margin-top: 16px;
      min-height: 48px;
      border-radius: 16px;
      padding: 14px;
      font-size: 14px;
      line-height: 1.5;
      background: rgba(255,255,255,0.06);
      color: #e5e7eb;
    }
    .status.success { background: rgba(16,185,129,0.16); color: #d1fae5; }
    .status.error { background: rgba(239,68,68,0.18); color: #fee2e2; }
    .fineprint {
      margin-top: 14px;
      font-size: 12px;
      color: #9ca3af;
      text-align: center;
    }
    .code {
      color: #fde68a;
      font-weight: 800;
      word-break: break-word;
    }
  </style>
</head>
<body>
  <main class="card">
    <div class="eyebrow">FreeFinder Einladung</div>
    <h1>Hilf deinem Freund zu FreeFinder PRO</h1>
    <p>Installiere die App ueber diese Einladung. Wenn du danach hier bestaetigst, wird die Einladung automatisch gutgeschrieben.</p>
    ${safeDealHint}
    <div class="steps">
      <div>1. Tippe auf <strong>"App kostenlos laden"</strong>.</div>
      <div>2. Installiere FreeFinder im App Store.</div>
      <div>3. Komm wieder auf diese Seite zurueck. Wir bestaetigen die Einladung dann automatisch oder per Knopfdruck.</div>
    </div>
    <button id="downloadBtn" class="button primary">App kostenlos laden</button>
    <button id="confirmBtn" class="button secondary">Ich habe die App installiert</button>
    ${continueButtonHtml}
    <div id="status" class="status">Einladungscode: <span class="code">${safeCode}</span></div>
    <div class="fineprint">Hinweis: Die Bestaetigung funktioniert auf demselben Geraet und Browser, in dem du den Link geoeffnet hast. Warte nach dem App-Store-Wechsel kurz ${minDelaySeconds} Sekunden.</div>
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
        setStatus('Bitte zuerst auf "App kostenlos laden" tippen.', 'error');
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
      downloadBtn.disabled = true;
      try {
        const claim = await startClaim();
        const clipboardReady = claim && claim.claimToken ? await writeReferralPayloadToClipboard(claim) : false;
        if (clipboardReady) {
          setStatus('App Store wird geoeffnet. FreeFinder kann die Einladung beim ersten Start jetzt automatisch bestaetigen.', '');
        } else {
          setStatus('App Store wird geoeffnet. Wenn die automatische Erkennung nicht klappt, komm bitte wieder auf diese Seite zurueck und bestaetige hier.', '');
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

    if (path === '/health') {
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
      const dailyDeal = await getJsonKV(env, dealDailyKey());
      return json({
        ok: true,
        overrides: overrides.map(sanitizePublicDealOverride).filter(Boolean),
        dailyDeal: sanitizePublicDailyDeal(dailyDeal),
      });
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
      if (Date.now() - claim.startedAt < MIN_CONFIRM_DELAY_MS) {
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
          installSource: String(body?.installSource || 'app-store').slice(0, 128)
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

      return json({ ok: true, ...sanitizeInstallSummary(nextRecord) });
    }

    return invalid('Not found', 404);
  }
};

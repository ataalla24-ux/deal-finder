const PRODUCTS = new Set([
  'com.stefanataalla.freefinderwien.premium.monthly',
  'com.stefanataalla.freefinderwien.premium.yearly',
]);
const headers = { 'content-type': 'application/json', 'cache-control': 'no-store' };
const reply = (body, status = 200) => new Response(JSON.stringify(body), { status, headers });
const attempts = new Map();
let windowStart = 0;
let windowCount = 0;

export function trialStatus(purchase, productId, now = Date.now()) {
  const none = { ok: true, freeTrial: false };
  if (!PRODUCTS.has(productId) || purchase?.subscriptionState !== 'SUBSCRIPTION_STATE_ACTIVE') return none;
  const items = purchase.lineItems?.filter(item => item.productId === productId) ?? [];
  if (items.length !== 1) return none;
  const item = items[0];
  const phase = item.offerPhase;
  if (!phase || !Object.hasOwn(phase, 'freeTrial') || !phase.freeTrial ||
      Object.keys(phase).length !== 1 || item.autoRenewingPlan?.autoRenewEnabled !== true ||
      item.deferredItemReplacement || item.deferredItemRemoval) return none;
  const end = Date.parse(item.expiryTime);
  if (!Number.isFinite(end) || end <= now) return none;
  return { ok: true, freeTrial: true, productId, expiresAt: new Date(end).toISOString() };
}

// Possession of the opaque Play token is required. Never persist or log tokens or store responses.
export async function handleTrialStatus(request, env, accessToken, now = Date.now()) {
  if (now - windowStart >= 60_000) { attempts.clear(); windowCount = 0; windowStart = now; }
  const ip = request.headers.get('cf-connecting-ip') || 'local';
  const count = (attempts.get(ip) || 0) + 1;
  if (++windowCount > 120 || count > 12) return reply({ ok: false }, 429);
  attempts.set(ip, count);
  let payload;
  try {
    if (!request.headers.get('content-type')?.startsWith('application/json')) return reply({ ok: false }, 415);
    const reader = request.body?.getReader();
    if (!reader) return reply({ ok: false }, 400);
    const chunks = [];
    let length = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > 4096) { await reader.cancel(); return reply({ ok: false }, 413); }
      chunks.push(value);
    }
    payload = JSON.parse(await new Blob(chunks).text());
  } catch { return reply({ ok: false }, 400); }
  if (!PRODUCTS.has(payload?.productId) || typeof payload?.purchaseToken !== 'string' ||
      !/^[A-Za-z0-9._~+\/=:-]{20,2048}$/.test(payload.purchaseToken)) return reply({ ok: false }, 400);
  try {
    const credentials = await accessToken(env);
    if (!credentials?.ok || typeof credentials.token !== 'string' || !credentials.token.trim()) {
      return reply({ ok: false }, 503);
    }
    const packageName = env.GOOGLE_PLAY_PACKAGE_NAME || 'com.stefanataalla.freefinderwien';
    const url = `https://androidpublisher.googleapis.com/androidpublisher/v3/applications/${encodeURIComponent(packageName)}/purchases/subscriptionsv2/tokens/${encodeURIComponent(payload.purchaseToken)}`;
    const response = await fetch(url, { headers: { authorization: `Bearer ${credentials.token}` }, signal: AbortSignal.timeout(7000) });
    if ([404, 410].includes(response.status)) return reply({ ok: true, freeTrial: false });
    if (!response.ok) return reply({ ok: false }, 503);
    return reply(trialStatus(await response.json(), payload.productId, now));
  } catch { return reply({ ok: false }, 503); }
}

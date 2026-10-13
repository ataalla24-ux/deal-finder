import { createRemoteJWKSet, jwtVerify } from 'jose';

const keys = createRemoteJWKSet(new URL('https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com'), { timeoutDuration: 5000 });
export const accountError = (message, status = 401) => Object.assign(new Error(message), { status });
export async function accountID(uid) {
  const bytes = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode('freefinder-account-v1:' + uid)));
  bytes[6] = (bytes[6] & 15) | 128; bytes[8] = (bytes[8] & 63) | 128;
  const hex = Array.from(bytes.slice(0, 16), b => b.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
export function requireRecentAuth(authTime, now = Date.now() / 1000) {
  if (!Number.isFinite(authTime) || authTime <= 0 || authTime > now + 5 || now - authTime > 300) {
    throw accountError('Bitte melde dich für diese Änderung erneut an.', 409);
  }
}
export async function authenticateAccount(request, env, { keyResolver = keys, transport = fetch, recent = false, requireVerifiedEmail = true } = {}) {
  if (env.ACCOUNTS_ENABLED !== '1' || !env.FIREBASE_PROJECT_ID || !env.FIREBASE_WEB_API_KEY) {
    throw accountError('Die Kontoanmeldung ist noch nicht verfügbar.', 503);
  }
  const match = /^Bearer ([A-Za-z0-9_.-]{100,10000})$/.exec(request.headers.get('authorization') || '');
  if (!match) throw accountError('Bitte melde dich bei deinem FreeFinder-Konto an.');
  let claims;
  try {
    ({ payload: claims } = await jwtVerify(match[1], keyResolver, {
      algorithms: ['RS256'], audience: env.FIREBASE_PROJECT_ID,
      issuer: `https://securetoken.google.com/${env.FIREBASE_PROJECT_ID}`, requiredClaims: ['sub', 'iat', 'exp', 'auth_time'], clockTolerance: 5,
    }));
  } catch { throw accountError('Deine Anmeldung ist abgelaufen. Bitte erneut anmelden.'); }
  const now = Date.now() / 1000;
  if (typeof claims.sub !== 'string' || !claims.sub || claims.sub.length > 128 ||
      !Number.isFinite(claims.auth_time) || claims.auth_time <= 0 || claims.auth_time > now + 5 ||
      !Number.isFinite(claims.iat) || claims.iat > now + 5 ||
      !['apple.com', 'google.com', 'password'].includes(claims.firebase?.sign_in_provider)) {
    throw accountError('Die Anmeldung konnte nicht bestätigt werden.');
  }
  if (recent || !requireVerifiedEmail) requireRecentAuth(claims.auth_time, now);
  // JWT signature alone does not catch disabled/deleted users or revoked refresh tokens.
  let response;
  try {
    response = await transport(`https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=${encodeURIComponent(env.FIREBASE_WEB_API_KEY)}`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ idToken: match[1] }),
      signal: AbortSignal.timeout(7000), redirect: 'manual',
    });
  } catch { throw accountError('Die Anmeldung kann gerade nicht geprüft werden.', 503); }
  // Workers supports manual redirects; reject 3xx without forwarding the ID token.
  if (!response.ok) throw accountError('Bitte melde dich erneut an.', response.status >= 500 ? 503 : 401);
  const user = (await response.json()).users?.[0];
  if (!user || user.localId !== claims.sub || user.disabled || Number(user.validSince || 0) > claims.auth_time) {
    throw accountError('Diese Anmeldung ist nicht mehr gültig.');
  }
  // Privacy operations prove UID ownership, without granting a verified contact/profile principal.
  const identity = { id: await accountID(claims.sub), authTime: claims.auth_time };
  if (!requireVerifiedEmail) return identity;
  if (user.emailVerified !== true || claims.email_verified !== true || typeof user.email !== 'string' ||
      user.email.length > 320 || !user.email.includes('@') || user.email !== claims.email) {
    throw accountError('Bitte bestätige zuerst deine E-Mail-Adresse.', 403);
  }
  return { ...identity, email: user.email,
    providers: (user.providerUserInfo || []).map(p => p.providerId).filter(p => ['apple.com', 'google.com', 'password'].includes(p)) };
}

export async function boundedJSON(request) {
  if (!request.headers.get('content-type')?.includes('application/json')) throw accountError('JSON erforderlich.', 415);
  const reader = request.body?.getReader(); let size = 0; const chunks = [];
  if (!reader) throw accountError('Anfrage fehlt.', 400);
  while (true) {
    const { done, value } = await reader.read(); if (done) break;
    size += value.byteLength;
    if (size > 16000) { await reader.cancel(); throw accountError('Anfrage zu groß.', 413); }
    chunks.push(value);
  }
  let body;
  try { body = JSON.parse(await new Blob(chunks).text()); } catch { throw accountError('Ungültige Anfrage.', 400); }
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw accountError('Ungültige Anfrage.', 400);
  return body;
}

export async function handleAccount(request, env, authenticate = authenticateAccount) {
  const action = new URL(request.url).pathname.slice('/api/account/'.length);
  const json = (value, status = 200) => Response.json(value, { status, headers: { 'cache-control': 'no-store', 'access-control-allow-origin': '*' } });
  if (action === 'config' && request.method === 'GET') return json({ enabled: env.ACCOUNTS_ENABLED === '1', emailDelivery: env.ACCOUNT_EMAIL_ENABLED === '1' });
  if (!['profile', 'preferences', 'delete', 'export'].includes(action)) return json({ error: 'Nicht gefunden.' }, 404);
  if (request.method !== 'POST') return json({ error: 'POST erforderlich.' }, 405);
  try {
    const body = await boundedJSON(request);
    const recent = ['delete', 'export'].includes(action);
    const principal = await authenticate(request, env, { recent, requireVerifiedEmail: !recent });
    if (!env.REFERRAL_MONTHS) throw accountError('Kontodienst nicht erreichbar.', 503);
    return env.REFERRAL_MONTHS.get(env.REFERRAL_MONTHS.idFromName('referral-months-v1')).fetch(new Request(`https://referrals.internal/account-${action}`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({
        ...body, principal, accountId: principal.id, trustedIP: await accountID('rate:' + (request.headers.get('cf-connecting-ip') || 'unknown')),
      }),
    }));
  } catch (error) { return json({ ok: false, error: error.status ? error.message : 'Kontodienst gerade nicht erreichbar.' }, error.status || 503); }
}

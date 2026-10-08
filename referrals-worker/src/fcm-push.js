let cachedAccess;
const encoder = new TextEncoder();
const b64 = bytes => btoa(String.fromCharCode(...bytes)).replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
const encode = value => b64(encoder.encode(JSON.stringify(value)));

export async function sendFcmPush(env, device, campaign, message) {
  const account = JSON.parse(env.FCM_SERVICE_ACCOUNT_JSON || '{}');
  if (!account.project_id || !account.private_key || !account.client_email) throw new Error('FCM not configured');
  const now = Date.now();
  if (!cachedAccess || cachedAccess.email !== account.client_email || cachedAccess.expires < now + 60000) {
    const data = `${encode({ alg: 'RS256', typ: 'JWT' })}.${encode({
      iss: account.client_email, scope: 'https://www.googleapis.com/auth/firebase.messaging',
      aud: 'https://oauth2.googleapis.com/token', iat: Math.floor(now / 1000), exp: Math.floor(now / 1000) + 3600,
    })}`;
    const pem = account.private_key.replace(/-----[^-]+-----|\s/g, '');
    const key = await crypto.subtle.importKey('pkcs8', Uint8Array.from(atob(pem), x => x.charCodeAt(0)),
      { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['sign']);
    const signature = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, encoder.encode(data));
    const response = await fetch('https://oauth2.googleapis.com/token', { method: 'POST',
      body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: `${data}.${b64(new Uint8Array(signature))}` }),
      signal: AbortSignal.timeout(10000) });
    const result = await response.json();
    if (!response.ok || !result.access_token) throw new Error('FCM authorization failed');
    cachedAccess = { email: account.client_email, token: result.access_token, expires: now + Number(result.expires_in || 3600) * 1000 };
  }
  const ttl = Math.max(0, Math.floor((campaign.expires - Date.now()) / 1000));
  const response = await fetch(`https://fcm.googleapis.com/v1/projects/${encodeURIComponent(account.project_id)}/messages:send`, {
    method: 'POST', headers: { authorization: `Bearer ${cachedAccess.token}`, 'content-type': 'application/json' },
    // Data-only: the client checks permission, entitlement, expiry and duplicate receipt before displaying.
    body: JSON.stringify({ message: { token: device.token, data: { ...message,
      type: 'daily_deal', dealId: campaign.deal.id, day: campaign.day, expiresAt: String(campaign.expires) },
      android: { priority: 'HIGH', ttl: `${ttl}s`, collapse_key: `daily-${campaign.day}` } } }), signal: AbortSignal.timeout(10000),
  });
  const result = await response.json().catch(() => ({}));
  const reason = result.error?.details?.find(x => x.errorCode)?.errorCode || result.error?.status || '';
  return { ok: response.ok, status: response.status, reason, invalidToken: reason === 'UNREGISTERED' };
}

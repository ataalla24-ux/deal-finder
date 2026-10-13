const API_URL = 'https://api.resend.com/emails';
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
const encoder = new TextEncoder();
const MAX_RESPONSE_BYTES = 4096;
const RETRY_WINDOW_MS = 23 * 60 * 60 * 1000;

function validAddress(value) {
  if (typeof value !== 'string' || value.length > 254) return false;
  const parts = value.split('@');
  return parts.length === 2 && parts[0].length <= 64 &&
    /^[A-Za-z0-9!#$%&'*+/=?^_`{|}~-]+(?:\.[A-Za-z0-9!#$%&'*+/=?^_`{|}~-]+)*$/.test(parts[0]) &&
    /^(?:[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?\.)+[A-Za-z]{2,63}$/.test(parts[1]);
}

function boundedText(value, maxBytes) {
  return typeof value === 'string' && value.trim().length > 0 &&
    !value.includes('\0') && encoder.encode(value).byteLength <= maxBytes;
}

async function responseJSON(response) {
  const reader = response.body?.getReader();
  if (!reader) return null;
  let size = 0;
  const chunks = [];
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > MAX_RESPONSE_BYTES) {
      await reader.cancel();
      return null;
    }
    chunks.push(value);
  }
  try { return JSON.parse(await new Blob(chunks).text()); } catch { return null; }
}

// Transport only. The caller must persist an immutable delivery and check current
// consent, suppression, deletion and quota BEFORE dispatch.
export async function sendResendEmail(env, delivery, { transport = fetch, now = Date.now() } = {}) {
  if (env.ACCOUNT_EMAIL_TRANSPORT_ENABLED !== '1') return { outcome: 'not_sent', reason: 'disabled' };
  if (typeof env.RESEND_API_KEY !== 'string' || !/^re_[A-Za-z0-9_-]{16,200}$/.test(env.RESEND_API_KEY)) {
    return { outcome: 'not_sent', reason: 'not_configured' };
  }
  if (!delivery || !UUID.test(delivery.id || '') || !validAddress(delivery.to) ||
      !boundedText(delivery.subject, 200) || /[\r\n]/.test(delivery.subject) ||
      !boundedText(delivery.text, 32000) ||
      (delivery.html !== undefined && !boundedText(delivery.html, 64000))) {
    return { outcome: 'not_sent', reason: 'invalid_delivery' };
  }
  // Resend deduplicates for 24 hours. Do not automatically resend an unresolved
  // operation outside that window, even if the provider never returned its ID.
  if (!Number.isSafeInteger(now) || !Number.isSafeInteger(delivery.createdAt) ||
      delivery.createdAt > now || now - delivery.createdAt >= RETRY_WINDOW_MS) {
    return { outcome: 'not_sent', reason: 'delivery_window_closed' };
  }
  const headers = {};
  if (delivery.unsubscribeURL !== undefined) {
    let url;
    try { url = new URL(delivery.unsubscribeURL); } catch { /* rejected below */ }
    if (!url || url.origin !== 'https://freefinder-merchant-backend.freefinder-stefan.workers.dev' || url.pathname !== '/api/email/unsubscribe' ||
        url.username || url.password || url.hash || delivery.unsubscribeURL.length > 2048 ||
        /[\s<>]/.test(delivery.unsubscribeURL)) {
      return { outcome: 'not_sent', reason: 'invalid_unsubscribe_url' };
    }
    headers['List-Unsubscribe'] = `<${url.href}>`;
    headers['List-Unsubscribe-Post'] = 'List-Unsubscribe=One-Click';
  }
  const body = {
    from: 'FreeFinder <hallo@freefinder.at>', to: [delivery.to],
    reply_to: 'freefinder.at@gmail.com', subject: delivery.subject, text: delivery.text,
    ...(delivery.html !== undefined ? { html: delivery.html } : {}),
    ...(Object.keys(headers).length ? { headers } : {}),
  };
  try {
    const response = await transport(API_URL, {
      method: 'POST', redirect: 'manual', signal: AbortSignal.timeout(10000),
      headers: { authorization: `Bearer ${env.RESEND_API_KEY}`, 'content-type': 'application/json',
        'idempotency-key': `freefinder-email-v1-${delivery.id}` },
      body: JSON.stringify(body),
    });
    const status = response.status;
    // Never follow a redirect with a credential or recipient. An unknown result
    // is not a failed delivery and must not be re-created with a different ID.
    if (status >= 300 && status < 400) {
      await response.body?.cancel();
      return { outcome: 'unknown', reason: 'redirect', status };
    }
    if (status === 429) {
      await response.body?.cancel();
      return { outcome: 'not_sent', reason: 'rate_limited', status };
    }
    if ([400, 401, 403, 404, 405, 413, 415, 422].includes(status)) {
      await response.body?.cancel();
      return { outcome: 'not_sent', reason: 'provider_rejected', status };
    }
    if (!response.ok) {
      await response.body?.cancel();
      return { outcome: 'unknown', reason: 'provider_response', status };
    }
    const result = await responseJSON(response);
    if (!UUID.test(result?.id || '')) return { outcome: 'unknown', reason: 'invalid_response', status };
    // Accepted is not delivered. Delivery/bounce events need separate proof.
    return { outcome: 'accepted', providerId: result.id, status };
  } catch {
    return { outcome: 'unknown', reason: 'transport_error' };
  }
}

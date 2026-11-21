export function retryAfterAt(value, now = new Date()) {
  const text = String(value ?? '').trim();
  if (!text) return '';
  const ms = /^\d+$/.test(text) ? +now + Number(text) * 1000
    : /^[a-z]{3}, /i.test(text) ? Date.parse(text) : NaN;
  return Number.isFinite(ms) && ms > +now && ms <= 8640000000000000
    ? new Date(ms).toISOString() : '';
}

export function sourceHttpError(status, retryAfter, now = new Date()) {
  return Object.assign(new Error(`HTTP ${status}`), {
    httpStatus: status,
    retryAt: retryAfterAt(retryAfter, now),
  });
}

export function sourceFailureFields(error) {
  return {
    httpStatus: Number(error?.httpStatus || String(error?.message || error).match(/HTTP (\d{3})/)?.[1] || 0),
    retryAt: error?.retryAt || '',
  };
}

export function merchantOfferHostPaused(url, state, now, powerReport = {}) {
  const host = new URL(url).hostname.replace(/^www\./, '');
  const powerPaused = (powerReport.sources || []).some(source => {
    try {
      return new URL(source.url).hostname.replace(/^www\./, '') === host
        && ['access-denied', 'rate-limited'].includes(source.cooldown?.reason)
        && Date.parse(source.cooldown.nextRetryAt) > +now;
    } catch { return false; }
  });
  return powerPaused || Object.entries(state).some(([source, row]) => {
    if (![401, 403, 429].includes(row?.httpStatus)) return false;
    try {
      return new URL(source).hostname.replace(/^www\./, '') === host
        && Math.max(Date.parse(row.checkedAt) + 14 * 86400000, Date.parse(row.retryAt) || 0) > +now;
    } catch { return false; }
  });
}

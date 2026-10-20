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

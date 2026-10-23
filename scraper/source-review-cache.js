import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const MAX_ENTRIES = 256;
const MAX_AGE_MS = 72 * 60 * 60 * 1000;
const dayFormatter = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Vienna',
  year: 'numeric', month: '2-digit', day: '2-digit' });
const relativeWords = /\b(?:heute|morgen|gestern|aktuell|diese[rmns]?|nächste[rmns]?|montag|dienstag|mittwoch|donnerstag|freitag|samstag|sonntag|today|tomorrow|yesterday)\b/iu;

function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort()
    .map(key => [key, stable(value[key])]));
  return value;
}

export function reviewFingerprint(value) {
  return crypto.createHash('sha256').update(JSON.stringify(stable(value)) ?? 'null').digest('hex');
}

// Reuse never crosses a date/age boundary relevant to the original decision.
export function reviewClockContext(value, now = new Date()) {
  const day = dayFormatter.format(now);
  const dates = [];
  const ages = [];
  let hasValidity = false;
  let needsDailyReview = relativeWords.test(JSON.stringify(value));
  function visit(node, key = '') {
    if (Array.isArray(node)) { node.forEach(item => visit(item, key)); return; }
    if (node && typeof node === 'object') {
      if (node.status && ['blocked', 'transient', 'missing_link', 'not_checked'].includes(node.status)) needsDailyReview = true;
      if (Object.hasOwn(node, 'targetEvidence') && node.targetEvidence?.status !== 'ok') needsDailyReview = true;
      for (const [name, item] of Object.entries(node)) visit(item, name);
      return;
    }
    if (typeof node !== 'string') return;
    if (/^(?:expires|validFrom|validOn|validUntil)$/i.test(key) && /\d{4}-\d{2}-\d{2}/.test(node)) hasValidity = true;
    for (const match of node.matchAll(/\b\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:?\d{2})?)?/g)) {
      const parsed = Date.parse(match[0]);
      if (!Number.isFinite(parsed)) continue;
      const phase = match[0].includes('T') ? (parsed <= now.getTime() ? 'past' : 'future')
        : (match[0] < day ? 'past' : match[0] > day ? 'future' : 'today');
      dates.push([match[0], phase]);
      if (/pub|created|discovered/i.test(key)) ages.push([match[0], Math.min(8, Math.floor((now.getTime() - parsed) / 86400000))]);
    }
  }
  visit(value);
  return { dates, ages, ...(!hasValidity || needsDailyReview ? { day } : {}) };
}

export function loadSourceReviewCache(filePath) {
  try {
    const value = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    if (value?.version === 1 && value.entries && !Array.isArray(value.entries)
        && typeof value.entries === 'object') return value;
  } catch {}
  return { version: 1, entries: {} };
}

export function cachedSourceReview(cache, key, { now = new Date(), maxAgeMs = MAX_AGE_MS, validate }) {
  const entry = cache?.entries?.[key];
  const age = now.getTime() - Date.parse(entry?.reviewedAt || '');
  if (!Number.isFinite(age) || age < 0 || age >= Math.min(maxAgeMs, MAX_AGE_MS)
      || !Object.hasOwn(entry, 'result')
      || entry?.resultHash !== reviewFingerprint(entry?.result)
      || (relativeWords.test(JSON.stringify(entry.result)) && entry.day !== dayFormatter.format(now))) return null;
  return validate(entry.result) ? structuredClone(entry) : null;
}

export function rememberSourceReview(cache, key, result, now = new Date()) {
  cache.entries[key] = { reviewedAt: now.toISOString(), day: dayFormatter.format(now),
    resultHash: reviewFingerprint(result), result: structuredClone(result) };
}

export function saveSourceReviewCache(filePath, cache, now = new Date()) {
  cache.entries = Object.fromEntries(Object.entries(cache.entries).filter(([, entry]) => {
    const age = now.getTime() - Date.parse(entry?.reviewedAt || '');
    return Number.isFinite(age) && age >= 0 && age < MAX_AGE_MS;
  }).sort((a, b) => Date.parse(b[1].reviewedAt) - Date.parse(a[1].reviewedAt)).slice(0, MAX_ENTRIES));
  const content = `${JSON.stringify(cache, null, 2)}\n`;
  try { if (fs.readFileSync(filePath, 'utf8') === content) return; } catch {}
  const temporary = `${filePath}.${process.pid}.tmp`;
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(temporary, content);
  fs.renameSync(temporary, filePath);
}

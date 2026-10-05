import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { inspectDealUrlHealth } from '../scraper/expiry-utils.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const text = value => String(value || '').replace(/\s+/g, ' ').trim();
const fold = value => text(value).toLocaleLowerCase('de').normalize('NFKC');
const recurring = /geburtstag|birthday|dauerhaft|wöchentlich|woechentlich|monatlich|jeden\b|mitglied|member|laufend|recurring/i;
const social = url => /(^|\.)(instagram\.com|tiktok\.com|facebook\.com)$/i.test(new URL(url).hostname);

export function sourceURL(deal) {
  for (const value of [deal.evidencePostUrl, deal.sourceUrl, deal.url]) {
    try {
      const url = new URL(value);
      if (url.protocol !== 'https:' || url.username || url.password) continue;
      if (!url.hostname.includes('.') || /^(localhost|127\.|10\.|192\.168\.|169\.254\.|172\.(1[6-9]|2\d|3[01])\.)/.test(url.hostname)) continue;
      // Our generated guides are not independent expiry evidence.
      if (/(^|\.)(freefinder\.at|freefinder\.wien|slack\.com)$/.test(url.hostname)) continue;
      return url.href;
    } catch { /* Missing/non-public source: review, never infer expiry. */ }
  }
  return '';
}

export function assessExpiry(deal, health, { now = new Date(), protectedByEdit = false } = {}) {
  const result = (status, reason, evidence = {}) => ({ status, reason, ...evidence, automaticRemovalEligible: false });
  if (protectedByEdit || deal.forceKeep) return result('protected', 'Manuelle Korrektur/Freigabe geschützt; nur manuell entscheiden');
  const source = sourceURL(deal);
  if (!source) return result('review', 'Keine unabhängige Originalquelle verfügbar');
  if (!health || health.status !== 200 || health.blockedByProtection || health.transientError || health.invalid) {
    return result('review', 'Quelle nicht zuverlässig lesbar; HTTP-/Zugriffsfehler sind kein Ablaufbeleg');
  }
  if (health.finalUrl && health.finalUrl !== source) return result('review', 'Weiterleitung: Zuordnung zur ursprünglichen Aktion manuell prüfen');
  const hints = health.contentHints || {};
  const page = text([hints.title, hints.heading, hints.description, hints.textSnippet].filter(Boolean).join(' '));
  const hash = createHash('sha256').update(page).digest('hex');
  const evidence = { sourceUrl: source, finalUrl: health.finalUrl || source, evidenceText: page, evidenceHash: hash };
  if (social(source)) return result('review', 'Social-Post: Caption, Bilder/Video und Aktionsbedingungen manuell vollständig prüfen', evidence);
  if (recurring.test(`${deal.title} ${deal.description} ${deal.expiryKind} ${page}`)) {
    return result('review', 'Wiederkehrender oder Mitgliedervorteil: einzelner Termin beendet nicht das Angebot', evidence);
  }
  const tokens = fold(deal.title).match(/[\p{L}\p{N}]+/gu)?.filter(t => t.length >= 4 && !['gratis', 'angebot', 'rabatt', 'wien', 'beim', 'einen'].includes(t)) || [];
  const normalized = fold(page);
  if (!text(deal.brand) || !normalized.includes(fold(deal.brand)) || tokens.length < 2 || !tokens.every(t => normalized.includes(t))) {
    return result('review', 'Händler und konkretes Angebot auf Zielseite nicht eindeutig zugeordnet', evidence);
  }
  // Only an explicit end date with year; no publication dates or inferred years.
  const matches = [...page.matchAll(/(?:gültig\s+bis|aktion\s+endet\s+am|angebot\s+endet\s+am|valid\s+until)\s*:?\s*(\d{1,2})\.(\d{1,2})\.(20\d{2})\b/gi)];
  const dates = new Set();
  for (const match of matches) {
    const [, d, m, y] = match;
    const date = new Date(Date.UTC(+y, +m - 1, +d));
    if (date.getUTCFullYear() !== +y || date.getUTCMonth() !== +m - 1 || date.getUTCDate() !== +d) {
      return result('review', 'Ungültiges Kalenderdatum in Quelle', evidence);
    }
    dates.add(date.toISOString().slice(0, 10));
  }
  if (dates.size !== 1) return result('review', 'Kein eindeutiges Ablaufdatum mit Jahr oder widersprüchliche Enddaten', evidence);
  const [validUntil] = dates;
  const localParts = Object.fromEntries(new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/Vienna', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(now).map(part => [part.type, part.value]));
  const today = `${localParts.year}-${localParts.month}-${localParts.day}`;
  if (validUntil >= today) return result('not_expired', 'Belegtes Enddatum heute oder in der Zukunft', { ...evidence, validUntil });
  // Wait at least 48 hours beyond UTC end-of-day, conservatively covering Vienna + grace.
  if (now.getTime() < Date.parse(`${validUntil}T23:59:59.999Z`) + 48 * 3600_000) {
    return result('review', 'Ablaufdatum vergangen, Sicherheitsfrist läuft noch', { ...evidence, validUntil });
  }
  if (/verlängert|verlaengert|extended|bis auf weiteres|voraussichtlich|wahrscheinlich|ungefähr/i.test(page)) {
    return result('review', 'Mögliche Verlängerung oder unsichere Bedingungen', { ...evidence, validUntil });
  }
  return result('expiry_candidate', 'Frische Zielseite nennt vergangenes Enddatum; im Beobachtungsbetrieb manuell bestätigen', { ...evidence, validUntil });
}

export async function buildReview(deals, edits = [], { inspect = inspectDealUrlHealth, now = new Date() } = {}) {
  const entries = [];
  for (const deal of deals) {
    const source = sourceURL(deal);
    const protectedByEdit = edits.some(edit => edit.hidden !== true && (
      String(edit.dealId || edit.id || edit.restoreDeal?.id || '') === String(deal.id)
      || (edit.url && edit.url === deal.url)
    ));
    let health;
    try {
      if (source && !protectedByEdit && !deal.forceKeep) health = await inspect(source, { timeoutMs: 7000 });
    } catch { health = null; }
    entries.push({ id: deal.id, title: deal.title, url: deal.url, checkedAt: now.toISOString(),
      ...assessExpiry(deal, health, { now, protectedByEdit }),
      // Preserve complete original record for audit; never rewrite the live feed here.
      originalDeal: deal,
    });
  }
  return { schemaVersion: 1, mode: 'shadow', apply: false, checkedAt: now.toISOString(), entries };
}

async function main() {
  const docs = path.resolve(process.env.LIVE_DEAL_DOCS_DIR || path.join(root, 'docs'));
  const feed = JSON.parse(await readFile(path.join(docs, 'deals.json'), 'utf8'));
  let edits = [];
  try { edits = JSON.parse(await readFile(path.join(docs, 'live-deal-edits.json'), 'utf8')).edits || []; }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  const deals = Array.isArray(feed) ? feed : feed.deals;
  const report = await buildReview(deals, edits);
  await writeFile(path.join(docs, 'verified-expiry-review.json'), `${JSON.stringify(report, null, 2)}\n`);
  console.log(JSON.stringify({ mode: report.mode, checked: report.entries.length,
    candidates: report.entries.filter(e => e.status === 'expiry_candidate').length, removed: 0 }));
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();

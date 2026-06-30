#!/usr/bin/env node
import fs from 'fs';
import crypto from 'crypto';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.join(__dirname, '..');
const LIVE_DEALS_PATH = path.join(ROOT, 'docs', 'deals.json');
const REVIEW_CANDIDATES_PATH = path.join(ROOT, 'docs', 'live-deal-review-candidates.json');
const VALIDATION_REPORT_PATH = path.join(ROOT, 'docs', 'live-deal-validation-report.json');
const LLM_REVIEW_PATH = path.join(ROOT, 'docs', 'live-deal-llm-review.json');

const SLACK_BOT_TOKEN = process.env.SLACK_BOT_TOKEN || '';
const SLACK_CHANNEL_ID = process.env.SLACK_CHANNEL_ID || '';
const DRY_RUN = process.env.SLACK_LIVE_REVIEW_DRY_RUN === '1';
const MAX_DEALS = Math.max(1, Math.min(200, Number(process.env.SLACK_LIVE_REVIEW_MAX_DEALS || 120)));
const MAX_OFFLINE_DEALS = Math.max(1, Math.min(200, Number(process.env.SLACK_LIVE_REVIEW_MAX_OFFLINE || 200)));
const CHUNK_SIZE = Math.max(1, Math.min(15, Number(process.env.SLACK_LIVE_REVIEW_CHUNK_SIZE || 10)));
const ADMIN_URL = process.env.DEAL_ADMIN_URL || 'https://freefinder.at/deal-admin.html';
const WORKER_BASE_URL = (process.env.FREEFINDER_WORKER_BASE_URL || 'https://freefinder-referrals.freefinder-stefan.workers.dev').replace(/\/+$/, '');
const REMOVE_LINK_SECRET = process.env.DEAL_REMOVE_LINK_SECRET || (DRY_RUN ? 'dry-run-secret' : '');

function cleanText(value, max = 500) {
  return String(value || '').replace(/\s+/g, ' ').trim().slice(0, max);
}

function slackEscape(value) {
  return cleanText(value, 1200)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function loadLiveDeals() {
  const parsed = JSON.parse(fs.readFileSync(LIVE_DEALS_PATH, 'utf8'));
  const deals = Array.isArray(parsed) ? parsed : (Array.isArray(parsed.deals) ? parsed.deals : []);
  const review = loadReviewCandidates();
  const offline = loadOfflineDeals();
  return {
    lastUpdated: cleanText(parsed.lastUpdated || ''),
    totalDeals: Number(parsed.totalDeals || deals.length) || deals.length,
    reviewCheckedAt: review.checkedAt,
    reviewCandidates: review.candidates,
    offlineCheckedAt: offline.checkedAt,
    offlineDeals: offline.deals,
    deals,
  };
}

function loadReviewCandidates() {
  try {
    if (!fs.existsSync(REVIEW_CANDIDATES_PATH)) {
      return { checkedAt: '', candidates: [] };
    }
    const parsed = JSON.parse(fs.readFileSync(REVIEW_CANDIDATES_PATH, 'utf8'));
    return {
      checkedAt: cleanText(parsed.checkedAt || ''),
      candidates: Array.isArray(parsed.candidates) ? parsed.candidates : [],
    };
  } catch (error) {
    console.warn(`Could not read live review candidates: ${error.message}`);
    return { checkedAt: '', candidates: [] };
  }
}

function isManualRemovalReason(reason = '') {
  const text = cleanText(reason, 240);
  return /^Moderation:/i.test(text) || text === 'Explizit entfernter Deal';
}

function newestTimestamp(left = '', right = '') {
  const leftMs = Date.parse(left) || 0;
  const rightMs = Date.parse(right) || 0;
  if (rightMs > leftMs) return cleanText(right);
  return cleanText(left || right);
}

function loadOfflineDeals() {
  try {
    const offlineDeals = [];
    let checkedAt = '';
    if (fs.existsSync(VALIDATION_REPORT_PATH)) {
      const parsed = JSON.parse(fs.readFileSync(VALIDATION_REPORT_PATH, 'utf8'));
      checkedAt = newestTimestamp(checkedAt, parsed.checkedAt);
      const removed = Array.isArray(parsed.removed) ? parsed.removed : [];
      offlineDeals.push(...removed
        .filter((deal) => deal?.removedAutomatically !== false)
        .filter((deal) => !isManualRemovalReason(deal?.reason))
        .map((deal) => ({ ...deal, sourceSystem: deal.sourceSystem || 'live-normalizer' })));
    }
    if (fs.existsSync(LLM_REVIEW_PATH)) {
      const parsed = JSON.parse(fs.readFileSync(LLM_REVIEW_PATH, 'utf8'));
      checkedAt = newestTimestamp(checkedAt, parsed.generatedAt);
      const removed = Array.isArray(parsed.removedDeals) ? parsed.removedDeals : [];
      offlineDeals.push(...removed
        .filter((deal) => cleanText(deal?.id || deal?.url || deal?.title))
        .map((deal) => ({
          ...deal,
          reason: cleanText(deal.reason || deal.message || 'LLM Review entfernt'),
          removedAutomatically: true,
          sourceSystem: deal.sourceSystem || 'llm-live-review',
        })));
    }

    const byKey = new Map();
    for (const deal of offlineDeals) {
      const id = cleanText(deal?.id, 256);
      const url = normalizeUrlForCompare(deal?.url || '');
      const key = id ? `id:${id}` : (url ? `url:${url}` : `title:${cleanText(deal?.title, 240).toLowerCase()}`);
      if (!key || byKey.has(key)) continue;
      byKey.set(key, deal);
    }

    return {
      checkedAt,
      deals: [...byKey.values()]
        .filter((deal) => cleanText(deal?.id || deal?.url || deal?.title))
        .slice(0, MAX_OFFLINE_DEALS),
    };
  } catch (error) {
    console.warn(`Could not read offline deals: ${error.message}`);
    return { checkedAt: '', deals: [] };
  }
}

function normalizeUrlForCompare(value) {
  const text = cleanText(value, 1000);
  if (!text) return '';
  try {
    const parsed = new URL(text);
    if (parsed.pathname !== '/' && parsed.pathname.endsWith('/')) {
      parsed.pathname = parsed.pathname.slice(0, -1);
    }
    parsed.hash = '';
    return parsed.toString();
  } catch {
    return text.replace(/\/+$/, '');
  }
}

function reviewKey(deal = {}) {
  const id = cleanText(deal.id || '', 256);
  if (id) return `id:${id}`;
  const url = normalizeUrlForCompare(deal.url || '');
  return url ? `url:${url}` : '';
}

function buildReviewCandidateMap(candidates = []) {
  const map = new Map();
  for (const candidate of candidates) {
    const idKey = cleanText(candidate.id || '', 256) ? `id:${cleanText(candidate.id || '', 256)}` : '';
    const url = normalizeUrlForCompare(candidate.url || '');
    if (idKey) map.set(idKey, candidate);
    if (url) map.set(`url:${url}`, candidate);
  }
  return map;
}

function prioritizeReviewCandidates(deals = [], reviewCandidateMap = new Map()) {
  return [...deals].sort((a, b) => {
    const aReview = reviewCandidateMap.has(reviewKey(a)) ? 1 : 0;
    const bReview = reviewCandidateMap.has(reviewKey(b)) ? 1 : 0;
    if (aReview !== bReview) return bReview - aReview;
    return 0;
  });
}

function formatDate(value) {
  if (!value) return '-';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return cleanText(value, 32);
  return date.toLocaleDateString('de-AT', {
    timeZone: 'Europe/Vienna',
    day: '2-digit',
    month: '2-digit',
    year: '2-digit',
  });
}

function buttonValue(deal) {
  const payload = {
    id: cleanText(deal.id, 256),
    url: cleanText(deal.url, 1000),
    title: cleanText(deal.title || deal.brand, 180),
    brand: cleanText(deal.brand, 120),
    reason: 'aus Slack Live-Review entfernt',
  };
  return JSON.stringify(payload);
}

function editValue(deal) {
  const payload = {
    dealId: cleanText(deal.id, 256),
    url: cleanText(deal.url, 1000),
    title: cleanText(deal.title || deal.brand, 240),
    brand: cleanText(deal.brand, 120),
    description: cleanText(deal.description, 2500),
    distance: cleanText(deal.distance || deal.location || deal.address, 200),
    pubDate: cleanText(deal.pubDate, 80),
    expires: cleanText(deal.expires, 120),
    expiresOriginal: cleanText(deal.expiresOriginal || deal.expires, 180),
    expiryKind: cleanText(deal.expiryKind, 40),
    validOn: cleanText(deal.validOn, 32),
    validFrom: cleanText(deal.validFrom, 32),
    validUntil: cleanText(deal.validUntil, 32),
    expiryDisplayText: cleanText(deal.expiryDisplayText, 180),
  };
  return JSON.stringify(payload);
}

function restoreValue(deal) {
  const restoreDeal = {
    id: cleanText(deal.id, 256),
    title: cleanText(deal.title || deal.brand, 240),
    brand: cleanText(deal.brand, 120),
    description: cleanText(deal.description, 1200),
    url: cleanText(deal.url, 1000),
    category: cleanText(deal.category, 80),
    type: cleanText(deal.type, 40),
    logo: cleanText(deal.logo, 16),
    distance: cleanText(deal.distance || deal.location || deal.address, 200),
    source: cleanText(deal.source, 160),
    originSource: cleanText(deal.originSource || deal.source, 160),
    pubDate: cleanText(deal.pubDate, 80),
    expires: cleanText(deal.expires, 120),
    expiresOriginal: cleanText(deal.expiresOriginal || deal.expires, 180),
    expiresPrecision: cleanText(deal.expiresPrecision, 40),
    expiresSource: cleanText(deal.expiresSource, 80),
    expiresDetectedFromUrl: Boolean(deal.expiresDetectedFromUrl),
    validOn: cleanText(deal.validOn, 32),
    validFrom: cleanText(deal.validFrom, 32),
    validUntil: cleanText(deal.validUntil, 32),
    expiryKind: cleanText(deal.expiryKind, 40),
    expiryDisplayText: cleanText(deal.expiryDisplayText, 180),
    qualityScore: Number(deal.qualityScore) || 0,
    votes: Number(deal.votes) || 1,
    priority: Number(deal.priority) || 3,
    hot: Boolean(deal.hot),
    isNew: Boolean(deal.isNew),
    slackTs: cleanText(deal.slackTs, 120),
    slackThreadTs: cleanText(deal.slackThreadTs, 120),
    approvedAt: cleanText(deal.approvedAt, 80),
  };
  return JSON.stringify({
    dealId: restoreDeal.id,
    restoreDeal,
  });
}

function signedWorkerUrl(pathname, value) {
  if (!REMOVE_LINK_SECRET) {
    throw new Error('DEAL_REMOVE_LINK_SECRET is required for signed review links');
  }

  const payload = Buffer.from(value).toString('base64url');
  const sig = crypto
    .createHmac('sha256', REMOVE_LINK_SECRET)
    .update(payload)
    .digest('hex');
  return `${WORKER_BASE_URL}${pathname}?payload=${encodeURIComponent(payload)}&sig=${encodeURIComponent(sig)}`;
}

function signedRemovalUrl(deal) {
  return signedWorkerUrl('/api/deals/admin/remove-link', buttonValue(deal));
}

function signedEditUrl(deal) {
  return signedWorkerUrl('/api/deals/admin/edit-link', editValue(deal));
}

function signedRestoreUrl(deal) {
  return signedWorkerUrl('/api/deals/admin/restore-link', restoreValue(deal));
}

function dealBlocks(deal, index, reviewCandidate = null) {
  const title = slackEscape(deal.title || deal.brand || 'Deal');
  const brand = slackEscape(deal.brand || 'Unbekannt');
  const location = slackEscape(deal.distance || deal.location || deal.address || 'Wien');
  const pubDate = slackEscape(formatDate(deal.pubDate));
  const id = slackEscape(deal.id || '');
  const reviewReason = reviewCandidate ? slackEscape(reviewCandidate.reason || 'Bitte prüfen') : '';
  const text = [
    `*${index + 1}. ${reviewReason ? 'Prüfen: ' : ''}${title}*`,
    brand ? brand : '',
    `${location} · ${pubDate}`,
    reviewReason ? `Prüfgrund: ${reviewReason}` : '',
    id ? `ID: \`${id}\`` : '',
  ].filter(Boolean).join('\n');

  const elements = [
    {
      type: 'button',
      text: { type: 'plain_text', text: 'Bearbeiten' },
      style: 'primary',
      action_id: 'freefinder_edit_live_deal',
      url: signedEditUrl(deal),
    },
    {
      type: 'button',
      text: { type: 'plain_text', text: 'Entfernen' },
      style: 'danger',
      action_id: 'freefinder_remove_deal',
      url: signedRemovalUrl(deal),
      confirm: {
        title: { type: 'plain_text', text: 'Deal entfernen?' },
        text: { type: 'mrkdwn', text: `*${title}* aus iOS, Web und Android entfernen?` },
        confirm: { type: 'plain_text', text: 'Entfernen' },
        deny: { type: 'plain_text', text: 'Abbrechen' },
      },
    },
  ];

  const url = cleanText(deal.url, 1000);
  if (/^https?:\/\//i.test(url)) {
    elements.push({
      type: 'button',
      text: { type: 'plain_text', text: 'Quelle' },
      url,
      action_id: 'freefinder_open_source',
    });
  }

  return [
    {
      type: 'section',
      text: { type: 'mrkdwn', text },
    },
    {
      type: 'actions',
      elements,
    },
  ];
}

function offlineDealBlocks(deal, index) {
  const title = slackEscape(deal.title || deal.brand || 'Offline Deal');
  const brand = slackEscape(deal.brand || 'Unbekannt');
  const location = slackEscape(deal.distance || deal.location || deal.address || 'Wien');
  const pubDate = slackEscape(formatDate(deal.pubDate));
  const id = slackEscape(deal.id || '');
  const reason = slackEscape(deal.reason || 'automatisch entfernt');
  const sourceSystem = slackEscape(deal.sourceSystem || 'Automatik');
  const text = [
    `*${index + 1}. Offline: ${title}*`,
    brand ? brand : '',
    `${location} · ${pubDate}`,
    `System: ${sourceSystem}`,
    `Grund: ${reason}`,
    id ? `ID: \`${id}\`` : '',
  ].filter(Boolean).join('\n');

  const elements = [];
  if (cleanText(deal.id, 256)) {
    elements.push({
      type: 'button',
      text: { type: 'plain_text', text: 'Wieder live' },
      style: 'primary',
      action_id: 'freefinder_restore_offline_deal',
      url: signedRestoreUrl(deal),
    });
  }

  const url = cleanText(deal.url, 1000);
  if (/^https?:\/\//i.test(url)) {
    elements.push({
      type: 'button',
      text: { type: 'plain_text', text: 'Quelle' },
      url,
      action_id: 'freefinder_open_offline_source',
    });
  }

  return [
    {
      type: 'section',
      text: { type: 'mrkdwn', text },
    },
    ...(elements.length > 0 ? [{ type: 'actions', elements }] : []),
  ];
}

function chunk(items, size) {
  const chunks = [];
  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }
  return chunks;
}

async function slackApi(method, body) {
  const response = await fetch(`https://slack.com/api/${method}`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${SLACK_BOT_TOKEN}`,
      'content-type': 'application/json; charset=utf-8',
    },
    body: JSON.stringify(body),
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok || !payload?.ok) {
    throw new Error(payload?.error || `Slack ${method} failed with ${response.status}`);
  }
  return payload;
}

async function postMessage(body) {
  if (DRY_RUN) {
    console.log(JSON.stringify(body, null, 2));
    return { ok: true, ts: body.thread_ts || 'dry-run-thread' };
  }
  return slackApi('chat.postMessage', body);
}

async function main() {
  const live = loadLiveDeals();
  const reviewCandidateMap = buildReviewCandidateMap(live.reviewCandidates);
  const deals = prioritizeReviewCandidates(live.deals, reviewCandidateMap).slice(0, MAX_DEALS);

  if (!DRY_RUN && (!SLACK_BOT_TOKEN || !SLACK_CHANNEL_ID)) {
    throw new Error('SLACK_BOT_TOKEN and SLACK_CHANNEL_ID are required');
  }
  if (!REMOVE_LINK_SECRET) {
    throw new Error('DEAL_REMOVE_LINK_SECRET is required');
  }

  const headerText = [
    `*FreeFinder Live-Deal-Review*`,
    `${live.totalDeals} Deals sind aktuell online in iOS, Web und Android.`,
    live.offlineDeals.length > 0 ? `${live.offlineDeals.length} automatische Offline-Deals im Abschnitt *Offline*.` : '',
    live.reviewCandidates.length > 0 ? `${live.reviewCandidates.length} Deals brauchen besondere Prüfung.` : '',
    live.lastUpdated ? `Stand: ${live.lastUpdated}` : '',
    live.reviewCheckedAt ? `Review-Kandidaten: ${live.reviewCheckedAt}` : '',
    live.offlineCheckedAt ? `Offline-Stand: ${live.offlineCheckedAt}` : '',
    `Zum Admin: ${ADMIN_URL}`,
  ].filter(Boolean).join('\n');

  const header = await postMessage({
    channel: SLACK_CHANNEL_ID,
    text: `FreeFinder Live-Deal-Review: ${live.totalDeals} Deals online`,
    blocks: [
      { type: 'section', text: { type: 'mrkdwn', text: headerText } },
      { type: 'context', elements: [{ type: 'mrkdwn', text: 'Nutze *Bearbeiten* für Titel, Datum, Ort oder Details. Klicke bei abgelaufenen oder falschen Deals auf *Entfernen*.' }] },
    ],
  });

  if (deals.length === 0) {
    await postMessage({
      channel: SLACK_CHANNEL_ID,
      thread_ts: header.ts,
      text: 'Keine Live-Deals gefunden.',
      blocks: [{ type: 'section', text: { type: 'mrkdwn', text: 'Keine Live-Deals gefunden.' } }],
    });
    return;
  }

  for (const [chunkIndex, group] of chunk(deals, CHUNK_SIZE).entries()) {
    const offset = chunkIndex * CHUNK_SIZE;
    const blocks = group.flatMap((deal, index) => dealBlocks(deal, offset + index, reviewCandidateMap.get(reviewKey(deal)) || null));
    await postMessage({
      channel: SLACK_CHANNEL_ID,
      thread_ts: header.ts,
      text: `Live Deals ${offset + 1}-${offset + group.length}`,
      blocks,
    });
  }

  if (live.offlineDeals.length > 0) {
    await postMessage({
      channel: SLACK_CHANNEL_ID,
      thread_ts: header.ts,
      text: `Offline: ${live.offlineDeals.length} automatisch entfernte Deals`,
      blocks: [
        {
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: `*Offline*\nAutomatisch entfernte Deals. Nutze *Wieder live*, wenn ein Deal fälschlich offline ging; er wird danach gegen erneutes automatisches Entfernen geschützt.`,
          },
        },
      ],
    });

    for (const [chunkIndex, group] of chunk(live.offlineDeals, CHUNK_SIZE).entries()) {
      const offset = chunkIndex * CHUNK_SIZE;
      const blocks = group.flatMap((deal, index) => offlineDealBlocks(deal, offset + index));
      await postMessage({
        channel: SLACK_CHANNEL_ID,
        thread_ts: header.ts,
        text: `Offline Deals ${offset + 1}-${offset + group.length}`,
        blocks,
      });
    }
  }
}

main().catch((error) => {
  console.error(error?.stack || error?.message || error);
  process.exit(1);
});

#!/usr/bin/env node
import fs from 'fs';
import crypto from 'crypto';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.join(__dirname, '..');
const LIVE_DEALS_PATH = path.join(ROOT, 'docs', 'deals.json');

const SLACK_BOT_TOKEN = process.env.SLACK_BOT_TOKEN || '';
const SLACK_CHANNEL_ID = process.env.SLACK_CHANNEL_ID || '';
const DRY_RUN = process.env.SLACK_LIVE_REVIEW_DRY_RUN === '1';
const MAX_DEALS = Math.max(1, Math.min(200, Number(process.env.SLACK_LIVE_REVIEW_MAX_DEALS || 120)));
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
  return {
    lastUpdated: cleanText(parsed.lastUpdated || ''),
    totalDeals: Number(parsed.totalDeals || deals.length) || deals.length,
    deals,
  };
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

function signedRemovalUrl(deal) {
  if (!REMOVE_LINK_SECRET) {
    throw new Error('DEAL_REMOVE_LINK_SECRET is required for signed removal links');
  }

  const payload = Buffer.from(buttonValue(deal)).toString('base64url');
  const sig = crypto
    .createHmac('sha256', REMOVE_LINK_SECRET)
    .update(payload)
    .digest('hex');
  return `${WORKER_BASE_URL}/api/deals/admin/remove-link?payload=${encodeURIComponent(payload)}&sig=${encodeURIComponent(sig)}`;
}

function dealBlocks(deal, index) {
  const title = slackEscape(deal.title || deal.brand || 'Deal');
  const brand = slackEscape(deal.brand || 'Unbekannt');
  const location = slackEscape(deal.distance || deal.location || deal.address || 'Wien');
  const pubDate = slackEscape(formatDate(deal.pubDate));
  const id = slackEscape(deal.id || '');
  const text = [
    `*${index + 1}. ${title}*`,
    brand ? brand : '',
    `${location} · ${pubDate}`,
    id ? `ID: \`${id}\`` : '',
  ].filter(Boolean).join('\n');

  const elements = [
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
  const deals = live.deals.slice(0, MAX_DEALS);

  if (!DRY_RUN && (!SLACK_BOT_TOKEN || !SLACK_CHANNEL_ID)) {
    throw new Error('SLACK_BOT_TOKEN and SLACK_CHANNEL_ID are required');
  }
  if (!REMOVE_LINK_SECRET) {
    throw new Error('DEAL_REMOVE_LINK_SECRET is required');
  }

  const headerText = [
    `*FreeFinder Live-Deal-Review*`,
    `${live.totalDeals} Deals sind aktuell online in iOS, Web und Android.`,
    live.lastUpdated ? `Stand: ${live.lastUpdated}` : '',
    `Zum Admin: ${ADMIN_URL}`,
  ].filter(Boolean).join('\n');

  const header = await postMessage({
    channel: SLACK_CHANNEL_ID,
    text: `FreeFinder Live-Deal-Review: ${live.totalDeals} Deals online`,
    blocks: [
      { type: 'section', text: { type: 'mrkdwn', text: headerText } },
      { type: 'context', elements: [{ type: 'mrkdwn', text: 'Klicke bei abgelaufenen oder falschen Deals auf *Entfernen*. Der Link startet die Moderation direkt.' }] },
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
    const blocks = group.flatMap((deal, index) => dealBlocks(deal, offset + index));
    await postMessage({
      channel: SLACK_CHANNEL_ID,
      thread_ts: header.ts,
      text: `Live Deals ${offset + 1}-${offset + group.length}`,
      blocks,
    });
  }
}

main().catch((error) => {
  console.error(error?.stack || error?.message || error);
  process.exit(1);
});

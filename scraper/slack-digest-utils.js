import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.join(__dirname, '..');
const DOCS_DIR = path.join(ROOT, 'docs');
const PENDING_ALL_PATH = path.join(DOCS_DIR, 'deals-pending-all.json');

function cleanText(value) {
  if (!value) return '';
  return String(value)
    .replace(/<[^>]*>/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

function parseSlackLink(raw) {
  const text = String(raw || '').trim();
  const match = text.match(/^<([^|>]+)(?:\|[^>]+)?>$/);
  if (match) return match[1].trim();
  return text.startsWith('http') ? text : '';
}

function toIsoDate(value) {
  if (!value) return '';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '';
  return d.toISOString();
}

function parseDisplayDate(value) {
  const text = cleanText(value);
  if (!text || text === 'k.A.') return '';

  const direct = toIsoDate(text);
  if (direct) return direct;

  const dmy = text.match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})$/);
  if (!dmy) return '';

  const yyyy = Number(dmy[3]);
  const mm = Number(dmy[2]);
  const dd = Number(dmy[1]);
  const date = new Date(Date.UTC(yyyy, mm - 1, dd, 12, 0, 0));
  return Number.isNaN(date.getTime()) ? '' : date.toISOString();
}

function parseDigestDealMessage(message, fallbackIndex = 0) {
  const text = String(message?.text || '');
  if (!text.includes('🆔 Deal-ID:')) return null;

  const lines = text.split('\n').map((line) => line.trim()).filter(Boolean);
  if (lines.length === 0) return null;

  const titleMatch = lines[0].match(/^\*(\d+)\.\s+(.+?)\*$/);
  const order = titleMatch ? Number(titleMatch[1]) : fallbackIndex + 1;
  const title = cleanText(titleMatch ? titleMatch[2] : lines[0].replace(/^\*/, '').replace(/\*$/, ''));

  let brand = '';
  let distance = 'Wien';
  let pubDate = '';
  let expires = '';
  let category = 'wien';
  let type = 'rabatt';
  let url = '';
  let id = '';
  let description = '';
  let missingFields = [];

  for (const line of lines.slice(1)) {
    if (line.startsWith('🏷️ Marke/Restaurant:')) {
      brand = cleanText(line.slice('🏷️ Marke/Restaurant:'.length));
    } else if (line.startsWith('📍 Ort:')) {
      distance = cleanText(line.slice('📍 Ort:'.length)) || 'Wien';
    } else if (line.startsWith('📅 Angebotsdatum:')) {
      pubDate = parseDisplayDate(line.slice('📅 Angebotsdatum:'.length));
    } else if (line.startsWith('⏳ Gültig bis:')) {
      expires = cleanText(line.slice('⏳ Gültig bis:'.length));
    } else if (line.startsWith('🧭 Kategorie:')) {
      const detail = cleanText(line.slice('🧭 Kategorie:'.length));
      const parts = detail.split('|').map((part) => cleanText(part));
      for (const part of parts) {
        if (part.toLowerCase().startsWith('typ:')) {
          type = cleanText(part.slice(4)).toLowerCase() || type;
        } else if (part) {
          category = part.toLowerCase();
        }
      }
    } else if (line.startsWith('🔗 Direktlink:')) {
      url = parseSlackLink(line.slice('🔗 Direktlink:'.length).trim());
    } else if (line.startsWith('🆔 Deal-ID:')) {
      id = cleanText(line.slice('🆔 Deal-ID:'.length));
    } else if (line.startsWith('⚠️ FEHLT:')) {
      missingFields = line
        .slice('⚠️ FEHLT:'.length)
        .split(',')
        .map((item) => cleanText(item))
        .filter(Boolean);
    } else if (line.startsWith('📝 ')) {
      description = cleanText(line.slice(2));
    }
  }

  if (!id) return null;

  return {
    id,
    title: title || `${brand || 'Deal'} Deal`,
    brand: brand || 'Wien Deals',
    description,
    url,
    category,
    type,
    logo: type === 'gratis' ? '🎁' : '🎯',
    distance,
    source: 'Slack Digest',
    expires,
    pubDate: pubDate || new Date(parseFloat(message.ts || '0') * 1000).toISOString(),
    qualityScore: 0,
    votes: 1,
    priority: 3,
    hot: false,
    isNew: true,
    slackTs: cleanText(message.ts),
    slackThreadTs: cleanText(message.thread_ts || message.ts),
    approvedAt: '',
    missingFields,
    order,
  };
}

function readPendingQueue() {
  if (!fs.existsSync(PENDING_ALL_PATH)) return [];
  try {
    const parsed = JSON.parse(fs.readFileSync(PENDING_ALL_PATH, 'utf-8'));
    return Array.isArray(parsed.deals) ? parsed.deals : [];
  } catch {
    return [];
  }
}

function mergeDealsById(primaryDeals, fallbackDeals) {
  const byId = new Map();
  for (const deal of fallbackDeals || []) {
    if (deal?.id) byId.set(deal.id, deal);
  }
  return (primaryDeals || []).map((deal) => ({
    ...(byId.get(deal.id) || {}),
    ...deal,
    slackTs: deal.slackTs || byId.get(deal.id)?.slackTs || '',
    slackThreadTs: deal.slackThreadTs || byId.get(deal.id)?.slackThreadTs || '',
  }));
}

function extractDealsFromThreadMessages(messages) {
  const pendingQueue = readPendingQueue();
  const parsed = (messages || [])
    .map((msg, index) => parseDigestDealMessage(msg, index))
    .filter(Boolean)
    .sort((a, b) => a.order - b.order);
  return mergeDealsById(parsed, pendingQueue);
}

export {
  cleanText,
  extractDealsFromThreadMessages,
  parseDigestDealMessage,
};

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { normalizeCategoryForScraper } from './category-utils.js';
import { isGenericJunkDeal, normalizeDealRecord } from './deal-normalization-utils.js';

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

function getDigestSignalText(parts = []) {
  return parts
    .filter(Boolean)
    .map((part) => cleanText(part).toLowerCase())
    .join(' ');
}

function inferDigestType({ title = '', brand = '', description = '', category = '', type = '', distance = '', url = '', expires = '' }) {
  const signal = getDigestSignalText([title, brand, description, category, type, distance, url, expires]);

  if (/(gewinnspiel|giveaway|verlose?n|verlosung|zu gewinnen|gewinnchance|quiz|teilnehmen\s+und\s+gewinnen)/i.test(signal)) {
    return 'gewinnspiel';
  }

  if (/(1\s*[+:xX]\s*1|1plus1|buy\s*one\s*get\s*one|bogo|zwei\s+zum\s+preis\s+von\s+einem)/i.test(signal)) {
    return 'bogo';
  }

  const hasGratis = /(gratis|kostenlos|free\b|umsonst|geschenkt|kostenfreie?r?|for free)/i.test(signal);
  const hasRabatt = /(rabatt|discount|-%|\d+\s?%|vergünstigt|reduziert|gutschein|coupon|bonus|aktionspreis|spart|sparen)/i.test(signal);
  const hasTestabo = /(testabo|probeabo|gratis\s+testen|kostenlos\s+testen|probemonat|kostenloser?\s+monat)/i.test(signal);

  if (hasTestabo) return 'testabo';
  if (hasRabatt && !hasGratis) return 'rabatt';
  if (hasGratis) return 'gratis';

  const normalized = cleanText(type).toLowerCase();
  if (normalized) return normalized;
  return 'rabatt';
}

function flattenSlackNode(node, parts) {
  if (!node) return;
  if (Array.isArray(node)) {
    for (const item of node) flattenSlackNode(item, parts);
    return;
  }
  if (typeof node === 'string') {
    const text = cleanText(node);
    if (text) parts.push(text);
    return;
  }
  if (typeof node !== 'object') return;

  if (node.type === 'text' || node.type === 'plain_text' || node.type === 'mrkdwn') {
    const text = cleanText(node.text);
    if (text) parts.push(text);
  } else if (node.type === 'link') {
    const url = cleanText(node.url);
    const text = cleanText(node.text);
    if (url) parts.push(text ? `<${url}|${text}>` : `<${url}>`);
  } else if (node.type === 'emoji') {
    const name = cleanText(node.name);
    if (name) parts.push(`:${name}:`);
  }

  if (Array.isArray(node.elements)) {
    flattenSlackNode(node.elements, parts);
    parts.push('\n');
  }
  if (Array.isArray(node.fields)) {
    flattenSlackNode(node.fields, parts);
    parts.push('\n');
  }
  if (Array.isArray(node.blocks)) {
    flattenSlackNode(node.blocks, parts);
    parts.push('\n');
  }
  if (node.text && typeof node.text === 'object') {
    flattenSlackNode(node.text, parts);
    parts.push('\n');
  }
}

function extractSlackMessageText(message) {
  const direct = String(message?.text || '');
  if (direct.includes('Deal-ID:')) return direct;

  const parts = [];
  flattenSlackNode(message?.blocks || [], parts);
  return parts.join('\n').replace(/\n{3,}/g, '\n\n').trim();
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

function normalizeDigestLine(line) {
  return String(line || '')
    .replace(/^_+|_+$/g, '')
    .replace(/^(?::[a-z0-9_+-]+:\s*)+/i, '')
    .replace(/^[^\w<]*\s*/, '')
    .trim();
}

function parseDigestDealMessage(message, fallbackIndex = 0) {
  const text = extractSlackMessageText(message);
  if (!text.includes('Deal-ID:')) return null;

  const lines = text.split('\n').map((line) => line.trim()).filter(Boolean);
  if (lines.length === 0) return null;

  const titleMatch = lines[0].match(/^\*?(\d+)\.\s+(.+?)\*?$/);
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
  let originSource = '';
  let description = '';
  let missingFields = [];

  for (const line of lines.slice(1)) {
    const plain = normalizeDigestLine(line);
    if (plain.startsWith('Marke/Restaurant:')) {
      brand = cleanText(plain.slice('Marke/Restaurant:'.length));
    } else if (plain.startsWith('Ort:')) {
      distance = cleanText(plain.slice('Ort:'.length)) || 'Wien';
    } else if (plain.startsWith('Angebotsdatum:')) {
      pubDate = parseDisplayDate(plain.slice('Angebotsdatum:'.length));
    } else if (plain.startsWith('Gültig bis:')) {
      expires = cleanText(plain.slice('Gültig bis:'.length));
    } else if (plain.startsWith('Kategorie:')) {
      const detail = cleanText(plain.slice('Kategorie:'.length));
      const detailParts = detail.split('|').map((part) => cleanText(part));
      for (const part of detailParts) {
        if (part.toLowerCase().startsWith('typ:')) {
          type = cleanText(part.slice(4)).toLowerCase() || type;
        } else if (part) {
          category = part.toLowerCase();
        }
      }
    } else if (plain.startsWith('Ursprung intern:')) {
      originSource = cleanText(plain.slice('Ursprung intern:'.length));
    } else if (plain.startsWith('Direktlink:')) {
      url = parseSlackLink(plain.slice('Direktlink:'.length).trim());
    } else if (plain.startsWith('Deal-ID:')) {
      id = cleanText(plain.slice('Deal-ID:'.length));
    } else if (plain.startsWith('FEHLT:')) {
      missingFields = plain
        .slice('FEHLT:'.length)
        .split(',')
        .map((item) => cleanText(item))
        .filter(Boolean);
    } else if (plain.startsWith('📝 ') || plain.startsWith('Beschreibung:')) {
      description = cleanText(plain.replace(/^📝\s*/, '').replace(/^Beschreibung:\s*/, ''));
    } else if (plain.startsWith('Mit ') && plain.includes('freigeben')) {
      continue;
    } else if (plain.startsWith('memo:')) {
      description = cleanText(plain.slice('memo:'.length));
    }
  }

  if (!id) return null;

  type = inferDigestType({
    title,
    brand,
    description,
    category,
    type,
    distance,
    url,
    expires,
  });

  const normalizedCategory = normalizeCategoryForScraper(category, [
    title,
    brand,
    description,
    distance,
    url,
    type,
  ]);

  const normalized = normalizeDealRecord({
    id,
    title: title || `${brand || 'Deal'} Deal`,
    brand,
    description,
    url,
    category: normalizedCategory,
    type,
    distance,
    source: 'Slack Digest',
    originSource,
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
  });

  normalized.originSource = cleanText(normalized.originSource || originSource);

  if (isGenericJunkDeal(normalized)) return null;
  return normalized;
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
  extractSlackMessageText,
  parseDigestDealMessage,
};

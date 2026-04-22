import '../sentry/instrument.mjs';
// ============================================
// SET FEATURED DEALS - Reads your Slack replies and sets:
// - Deal des Tages via "deal 3" or just "3"
// - Deal der Woche via "woche 3" / "week 3"
// Runs at 13:30 Vienna (12:30 UTC), AFTER approve workflow at 13:00
// ============================================
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { cleanText, extractDealsFromThreadMessages, extractSlackMessageText } from './slack-digest-utils.js';
import { normalizeDealRecord } from './deal-normalization-utils.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const SLACK_BOT_TOKEN = process.env.SLACK_BOT_TOKEN || '';
const SLACK_CHANNEL_ID = process.env.SLACK_CHANNEL_ID || '';
const VIENNA_DAY_FORMATTER = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Vienna',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
});

function getViennaDayKey(input = Date.now()) {
    const date = input instanceof Date ? input : new Date(input || Date.now());
    if (!(date instanceof Date) || Number.isNaN(date.getTime())) return '';
    return VIENNA_DAY_FORMATTER.format(date);
}

function getViennaWeekKey(input = Date.now()) {
    const date = input instanceof Date ? input : new Date(input || Date.now());
    if (!(date instanceof Date) || Number.isNaN(date.getTime())) return '';
    const parts = new Intl.DateTimeFormat('en-US', {
        timeZone: 'Europe/Vienna',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        weekday: 'short',
    }).formatToParts(date);
    const partMap = Object.fromEntries(parts.map((part) => [part.type, part.value]));
    const year = Number(partMap.year || 0);
    const month = Number(partMap.month || 0);
    const day = Number(partMap.day || 0);
    const weekday = String(partMap.weekday || '');
    const weekdayOffset = { Mon: 0, Tue: 1, Wed: 2, Thu: 3, Fri: 4, Sat: 5, Sun: 6 }[weekday];
    if (!year || !month || !day || typeof weekdayOffset !== 'number') return '';
    const monday = new Date(Date.UTC(year, month - 1, day, 12, 0, 0));
    monday.setUTCDate(monday.getUTCDate() - weekdayOffset);
    return `${monday.getUTCFullYear()}-${String(monday.getUTCMonth() + 1).padStart(2, '0')}-${String(monday.getUTCDate()).padStart(2, '0')}`;
}

// ============================================
// Step 1: Find today's digest thread
// ============================================
async function findTodaysThread() {
    const res = await fetch(
          `https://slack.com/api/conversations.history?channel=${SLACK_CHANNEL_ID}&limit=20`,
      { headers: { Authorization: `Bearer ${SLACK_BOT_TOKEN}` } }
        );
    const data = await res.json();
    if (!data.ok) {
          console.log('Error fetching history:', data.error);
          return null;
    }

  // Find today's FreeFinder digest message
  const today = getViennaDayKey();
    const thread = data.messages.find(m => {
          const msgDate = getViennaDayKey(parseFloat(m.ts) * 1000);
          return msgDate === today && m.text && m.text.includes('FreeFinder Wien');
    });

  if (!thread) {
        console.log('No digest thread found for today');
        return null;
  }

  console.log('Found digest thread:', thread.ts);
    return thread.ts;
}

// ============================================
// Step 2: Read replies in thread, find your picks
// ============================================
function parsePickCommand(rawText) {
    const text = cleanText(rawText).toLowerCase();
    if (!text) return null;

    let match = text.match(/^(?:deal(?:\s+der)?\s+woche|woche|week|weekly)\s*#?\s*(\d+)$/);
    if (match) {
        return { kind: 'weekly', number: parseInt(match[1], 10) };
    }

    match = text.match(/^(?:deal(?:\s+des)?\s+tages|daily|today|heute|deal\s*#?\s*|#\s*)?(\d+)$/);
    if (match) {
        return { kind: 'daily', number: parseInt(match[1], 10) };
    }

    return null;
}

function normalizeEditKey(value) {
    return cleanText(value)
        .toLowerCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/[^a-z0-9]+/g, '');
}

function parseFlexibleDateInput(value, mode = 'datetime') {
    const raw = cleanText(value);
    if (!raw) return '';

    const direct = new Date(raw);
    if (!Number.isNaN(direct.getTime())) {
        if (mode === 'expiry') {
            const d = new Date(direct);
            d.setHours(23, 59, 59, 999);
            return d.toISOString();
        }
        return direct.toISOString();
    }

    const dmy = raw.match(/^(\d{1,2})[./-](\d{1,2})[./-](\d{2}|\d{4})$/);
    if (!dmy) return '';

    const day = Number(dmy[1]);
    const month = Number(dmy[2]);
    const year = Number(dmy[3].length === 2 ? `20${dmy[3]}` : dmy[3]);
    const isoBase = `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    const iso = mode === 'expiry' ? `${isoBase}T23:59:59.999` : `${isoBase}T12:00:00.000`;
    const parsed = new Date(iso);
    return Number.isNaN(parsed.getTime()) ? '' : parsed.toISOString();
}

function normalizeEditFieldName(value) {
    const key = normalizeEditKey(value);
    if (!key) return '';

    const fieldMap = new Map([
        [['titel', 'title', 'headline', 'ueberschrift'], 'title'],
        [['brand', 'marke', 'restaurant', 'restaurantname', 'anbieter'], 'brand'],
        [['ort', 'location', 'distance', 'adresse', 'bezirk'], 'distance'],
        [['beschreibung', 'description', 'desc', 'memo', 'text'], 'description'],
        [['link', 'url', 'direktlink', 'posturl', 'zielurl'], 'url'],
        [['kategorie', 'category'], 'category'],
        [['typ', 'type', 'dealtyp', 'angebotstyp'], 'type'],
        [['logo', 'emoji', 'icon'], 'logo'],
        [['datum', 'pubdate', 'postdate', 'angebotsdatum'], 'pubDate'],
        [['ablauf', 'expires', 'gueltigbis', 'gultigbis', 'validuntil', 'enddatum'], 'expires'],
        [['quelle', 'source'], 'source'],
    ]);

    for (const [keys, target] of fieldMap.entries()) {
        if (keys.includes(key)) return target;
    }
    return '';
}

function normalizeEditedFieldValue(field, value) {
    const raw = cleanText(value);
    if (!raw) return '';

    if (field === 'pubDate') {
        return parseFlexibleDateInput(raw, 'datetime') || raw;
    }

    if (field === 'expires') {
        return parseFlexibleDateInput(raw, 'expiry') || raw;
    }

    if (field === 'category' || field === 'type') {
        return raw.toLowerCase();
    }

    return raw;
}

function parseSlackEditCommand(messageText) {
    const text = cleanText(messageText);
    if (!text) return null;

    const match = text.match(/^edit(?:iere)?\s+([^\s|;]+)\s+([\s\S]+)$/i);
    if (!match) return null;

    const target = cleanText(match[1]);
    const body = cleanText(match[2]);
    if (!target || !body) return null;

    const changes = {};
    const segments = body.split(/\s*(?:\||;|\n)\s*/).filter(Boolean);
    for (const segment of segments) {
        const fieldMatch = segment.match(/^([^:]+):\s*(.+)$/) || segment.match(/^([^\s:]+)\s+(.+)$/);
        if (!fieldMatch) continue;
        const field = normalizeEditFieldName(fieldMatch[1]);
        const value = normalizeEditedFieldValue(field, fieldMatch[2]);
        if (!field || !value) continue;
        changes[field] = value;
    }

    if (Object.keys(changes).length === 0) return null;
    return { target, changes };
}

function findDealIndexByEditTarget(deals, target) {
    const normalizedTarget = cleanText(target);
    if (!normalizedTarget) return -1;

    const numericTarget = Number(normalizedTarget);
    if (Number.isInteger(numericTarget)) {
        const byOrder = deals.findIndex((deal, index) => Number(deal?.order || index + 1) === numericTarget);
        if (byOrder >= 0) return byOrder;
    }

    const lowered = normalizedTarget.toLowerCase();
    return deals.findIndex((deal) => {
        return lowered === cleanText(deal?.id).toLowerCase() ||
            lowered === cleanText(deal?.slackTs).toLowerCase() ||
            lowered === cleanText(deal?.submissionId).toLowerCase();
    });
}

function applySlackEditsToDeals(deals, threadMessages) {
    const nextDeals = deals.map((deal, index) => ({
        ...deal,
        order: Number(deal?.order || index + 1),
    }));

    for (const message of threadMessages) {
        const parsed = parseSlackEditCommand(extractSlackMessageText(message));
        if (!parsed) continue;

        const targetIndex = findDealIndexByEditTarget(nextDeals, parsed.target);
        if (targetIndex < 0) continue;

        nextDeals[targetIndex] = {
            ...nextDeals[targetIndex],
            ...parsed.changes,
            editedInSlack: true,
            lastSlackEditTs: cleanText(message?.ts),
        };
    }

    return nextDeals;
}

async function findYourPicks(threadTs) {
    const res = await fetch(
          `https://slack.com/api/conversations.replies?channel=${SLACK_CHANNEL_ID}&ts=${threadTs}`,
      { headers: { Authorization: `Bearer ${SLACK_BOT_TOKEN}` } }
        );
    const data = await res.json();
    if (!data.ok) {
          console.log('Error fetching replies:', data.error);
          return null;
    }

  // Go through replies newest-first (skip the first message which is the bot's own digest)
  // Daily: "deal 3", "3"
  // Weekly: "woche 3", "week 3"
  const picks = { daily: null, weekly: null };
  for (const msg of data.messages.slice(1).reverse()) {
        const parsed = parsePickCommand(msg.text || '');
        if (!parsed) continue;
        if (!picks[parsed.kind]) {
            picks[parsed.kind] = parsed.number;
            console.log(`Found ${parsed.kind} pick:`, parsed.number, 'from message:', msg.text);
        }
        if (picks.daily && picks.weekly) break;
  }

  if (!picks.daily && !picks.weekly) {
      console.log('No picks found in thread replies');
  }
    return picks;
}

async function getThreadMessages(threadTs) {
    const res = await fetch(
          `https://slack.com/api/conversations.replies?channel=${SLACK_CHANNEL_ID}&ts=${threadTs}&limit=200`,
      { headers: { Authorization: `Bearer ${SLACK_BOT_TOKEN}` } }
        );
    const data = await res.json();
    if (!data.ok) {
          console.log('Error fetching replies:', data.error);
          return [];
    }

    return Array.isArray(data.messages) ? data.messages : [];
}

async function getBotUserId() {
    const res = await fetch('https://slack.com/api/auth.test', {
      headers: { Authorization: `Bearer ${SLACK_BOT_TOKEN}` }
    });
    const data = await res.json();
    return data.ok ? (data.user_id || '') : '';
}

function findPickedDeal(deals, pickNumber) {
  const exactMatch = deals.find((deal) => Number(deal?.order) === Number(pickNumber));
  if (exactMatch) return exactMatch;

  return null;
}

function hasHumanApproval(message, botUserId) {
    const reactions = Array.isArray(message?.reactions) ? message.reactions : [];
    const checks = reactions.filter((r) => ['white_check_mark', 'heavy_check_mark', 'check'].includes(r.name));
    return checks.some((reaction) => Array.isArray(reaction.users) && reaction.users.some((user) => user && user !== botUserId));
}

function loadApprovedDeals() {
    const dealsPath = path.join(__dirname, '..', 'docs', 'deals.json');
    try {
        if (!fs.existsSync(dealsPath)) return [];
        const parsed = JSON.parse(fs.readFileSync(dealsPath, 'utf-8'));
        return Array.isArray(parsed?.deals) ? parsed.deals : [];
    } catch (error) {
        console.log('Could not read deals.json:', error.message);
        return [];
    }
}

function findApprovedDealMatch(approvedDeals, deal) {
    if (!deal) return null;
    return approvedDeals.find((candidate) =>
        (candidate?.id && deal.id && candidate.id === deal.id) ||
        (candidate?.url && deal.url && candidate.url === deal.url)
    ) || null;
}

function mergePickedDealWithApproved(approvedDeal, pickedDeal) {
    if (!approvedDeal) return pickedDeal;
    return {
        ...approvedDeal,
        ...pickedDeal,
        id: pickedDeal.id || approvedDeal.id,
        url: pickedDeal.url || approvedDeal.url,
        title: pickedDeal.title || approvedDeal.title,
        description: pickedDeal.description || approvedDeal.description,
        distance: pickedDeal.distance || approvedDeal.distance,
        brand: pickedDeal.brand || approvedDeal.brand,
        category: pickedDeal.category || approvedDeal.category,
        type: pickedDeal.type || approvedDeal.type,
        logo: pickedDeal.logo || approvedDeal.logo,
        logoUrl: pickedDeal.logoUrl || approvedDeal.logoUrl || '',
        slackTs: pickedDeal.slackTs || approvedDeal.slackTs || '',
        slackThreadTs: pickedDeal.slackThreadTs || approvedDeal.slackThreadTs || '',
        order: pickedDeal.order || approvedDeal.order,
    };
}

// ============================================
// Step 4: Write featured deal files
// ============================================
function saveDealOfTheDay(deal) {
    const outputPath = path.join(__dirname, '..', 'docs', 'deal-of-the-day.json');
    const today = getViennaDayKey();
    const normalized = normalizeDealRecord(deal);

  const output = {
        date: today,
        dealId: normalized.id,
        brand: normalized.brand,
        title: normalized.title,
        description: normalized.description,
        logo: normalized.logo || '🎯',
        logoUrl: normalized.logoUrl || '',
        url: normalized.url,
        type: normalized.type,
        category: normalized.category || 'wien',
        distance: normalized.distance || 'Wien',
        manualPick: true,
        pickedAt: new Date().toISOString()
  };

  fs.writeFileSync(outputPath, JSON.stringify(output, null, 2));
    console.log('Saved deal-of-the-day.json:', deal.brand, '-', deal.title);
}

function saveDealOfTheWeek(deal) {
    const outputPath = path.join(__dirname, '..', 'docs', 'deal-of-the-week.json');
    const week = getViennaWeekKey();
    const normalized = normalizeDealRecord(deal);

    const output = {
        week,
        dealId: normalized.id,
        brand: normalized.brand,
        title: normalized.title,
        description: normalized.description,
        logo: normalized.logo || '🔥',
        logoUrl: normalized.logoUrl || '',
        url: normalized.url,
        type: normalized.type,
        category: normalized.category || 'wien',
        distance: normalized.distance || 'Wien',
        manualPick: true,
        pickedAt: new Date().toISOString()
    };

    fs.writeFileSync(outputPath, JSON.stringify(output, null, 2));
    console.log('Saved deal-of-the-week.json:', deal.brand, '-', deal.title);
}

// ============================================
// Step 5: Ensure the picked deal is approved (exists in deals.json)
// ============================================
function isDealApproved(deal, approvedDeals = []) {
  const deals = approvedDeals;

  // Check if the deal already exists (by id or url)
  const exists = deals.some(d =>
        (d.id && d.id === deal.id) ||
        (d.url && deal.url && d.url === deal.url)
                              );

  if (!exists) {
    console.log('Picked deal is not approved yet. Skipping daily deal update.');
    return false;
  }

  return true;
}

function isDealApprovedBySlack(message, botUserId) {
    return hasHumanApproval(message, botUserId);
}

// ============================================
// Main
// ============================================
async function main() {
    console.log('SET FEATURED DEALS');
    console.log('='.repeat(40));

  if (!SLACK_BOT_TOKEN || !SLACK_CHANNEL_ID) {
        console.log('Slack not configured, skipping');
        process.exit(0);
  }

  const threadTs = await findTodaysThread();
    if (!threadTs) {
          process.exit(0);
    }

  const picks = await findYourPicks(threadTs);
    if (!picks.daily && !picks.weekly) {
          console.log('No picks found - featured deals stay on automatic selection');
          process.exit(0);
    }

  const threadMessages = await getThreadMessages(threadTs);
  const deals = applySlackEditsToDeals(extractDealsFromThreadMessages(threadMessages), threadMessages);
    if (deals.length === 0) {
          const sample = threadMessages.find((msg) => cleanText(msg?.ts) !== cleanText(threadTs));
          if (sample) {
                  console.log('Sample digest message text:', JSON.stringify(extractSlackMessageText(sample).slice(0, 1000)));
                  console.log('Sample digest message keys:', Object.keys(sample).slice(0, 20).join(','));
                  console.log('Sample digest has blocks:', Array.isArray(sample.blocks), 'blockCount:', Array.isArray(sample.blocks) ? sample.blocks.length : 0);
          }
          console.log('No digest deals found');
          process.exit(0);
    }

  const botUserId = await getBotUserId();
  const approvedDeals = loadApprovedDeals();
  const maxOrder = deals.reduce((max, current) => Math.max(max, Number(current?.order) || 0), 0);

  function maybePersistPick(kind, pickNumber) {
    if (!pickNumber) return false;
    const deal = findPickedDeal(deals, pickNumber);
    if (!deal) {
      console.log(`${kind} pick #${pickNumber} not found in digest numbering (parsed deals: ${deals.length}, max order: ${maxOrder})`);
      return false;
    }
    console.log(`${kind} deal #${deal.order}: ${deal.brand} - ${deal.title}`);
    const pickedMessage = threadMessages.find((msg) => cleanText(msg?.ts) === cleanText(deal.slackTs));
    const approvedDeal = findApprovedDealMatch(approvedDeals, deal);
    const approvedBySlack = isDealApprovedBySlack(pickedMessage, botUserId);
    if (!approvedBySlack && !isDealApproved(deal, approvedDeals)) {
      console.log(`${kind} pick is not approved yet, skipping`);
      return false;
    }
    const dealToPersist = mergePickedDealWithApproved(approvedDeal, deal);
    if (kind === 'daily') {
      saveDealOfTheDay(dealToPersist);
    } else if (kind === 'weekly') {
      saveDealOfTheWeek(dealToPersist);
    }
    return true;
  }

  const savedDaily = maybePersistPick('daily', picks.daily);
  const savedWeekly = maybePersistPick('weekly', picks.weekly);

  if (!savedDaily && !savedWeekly) {
    console.log('No featured deal files updated');
    process.exit(0);
  }

  console.log('Done!');
}

main().catch(err => {
    console.error('Error:', err.message);
    process.exit(1);
});

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
import { inspectDealUrlHealth } from './expiry-utils.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const SLACK_BOT_TOKEN = process.env.SLACK_BOT_TOKEN || '';
const SLACK_CHANNEL_ID = process.env.SLACK_CHANNEL_ID || '';
const FEATURED_LLM_MODEL = process.env.FEATURED_DEAL_REVIEW_MODEL || process.env.DEAL_REVIEW_MODEL || process.env.OPENAI_MODEL || 'gpt-4.1-mini';
const FEATURED_WEEKLY_LLM_REQUIRED = process.env.FEATURED_WEEKLY_LLM_REQUIRED === '1';
const FEATURED_WEEKLY_LLM_MIN_CONFIDENCE = Math.max(0, Math.min(1, Number(process.env.FEATURED_WEEKLY_LLM_MIN_CONFIDENCE || 0.55)));
const FEATURED_TARGET_TIMEOUT_MS = Number(process.env.FEATURED_DEAL_TARGET_TIMEOUT_MS || process.env.URL_CHECK_TIMEOUT_MS || 7000);
const FOOD_DRINK_CATEGORIES = new Set(['essen', 'kaffee', 'trinken', 'getränke', 'getraenke', 'bars']);
const FOOD_DRINK_SIGNAL_PATTERN = /\b(essen|trinken|food|drink|drinks|getränk|getraenk|kaffee|coffee|espresso|latte|matcha|tee|tea|eis|gelato|ice\s*cream|pizza|burger|döner|doener|kebab|falafel|sushi|ramen|nudel|noodle|brunch|frühstück|fruehstueck|croissant|bowl|restaurant|cafe|café|bistro|bar|cocktail|smoothie|saft|juice|cola|menü|menue|meal|lunch|dinner|snack|pommes|kuchen|torte|cookie|cookies|schokolade|praline|wein|bier)\b/i;
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
function normalizePickCommandText(rawText) {
    return cleanText(rawText)
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase()
        .replace(/[.,;:!?()[\]{}"'/_-]+/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}

function parsePickCommand(rawText) {
    const text = normalizePickCommandText(rawText);
    if (!text) return null;

    let match = text.match(/^(?:deal(?:\s+der)?\s+woche|wochen\s*deal|wochendeal|woche|week|weekly|weekly\s*deal)\s*#?\s*(\d+)$/)
        || text.match(/^#?\s*(\d+)\s*(?:woche|wochendeal|week|weekly)$/);
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

function parseTime(value) {
    const parsed = Date.parse(cleanText(value || ''));
    return Number.isNaN(parsed) ? 0 : parsed;
}

function clipText(value, maxLength = 1000) {
    return cleanText(value || '').slice(0, maxLength);
}

function compactFeaturedEvidence(health = null) {
    if (!health) return null;
    const hints = health.contentHints || {};
    const dates = health.dateHints || {};
    return {
        invalid: Boolean(health.invalid),
        transientError: Boolean(health.transientError),
        blockedByProtection: Boolean(health.blockedByProtection),
        status: health.status || null,
        reason: clipText(health.reason || '', 180),
        finalUrl: clipText(health.finalUrl || '', 360),
        pageTitle: clipText(hints.title || '', 220),
        pageDescription: clipText(hints.description || '', 360),
        pageHeading: clipText(hints.heading || '', 180),
        textSnippet: clipText(hints.textSnippet || '', 900),
        publicationDate: clipText(dates.publicationDate || '', 80),
        validOn: clipText(dates.validOn || '', 40),
        validFrom: clipText(dates.validFrom || '', 40),
        validUntil: clipText(dates.validUntil || '', 40),
        targetDateRaw: clipText(dates.targetDateRaw || '', 160),
    };
}

function isFoodDrinkDeal(deal = {}) {
    const normalized = normalizeDealRecord(deal || {});
    const category = cleanText(normalized.category || '').toLowerCase();
    if (FOOD_DRINK_CATEGORIES.has(category)) return true;

    const signal = [
        normalized.brand,
        normalized.title,
        normalized.description,
        normalized.distance,
        normalized.type,
        normalized.url,
    ].map((value) => cleanText(value)).join(' ');

    if (category === 'supermarkt') return FOOD_DRINK_SIGNAL_PATTERN.test(signal);
    return FOOD_DRINK_SIGNAL_PATTERN.test(signal) && !['fitness', 'beauty', 'reisen', 'kultur', 'events', 'shopping'].includes(category);
}

function isFeaturedDealStillLive(deal, now = new Date()) {
    if (!deal || typeof deal !== 'object') return false;
    if (!cleanText(deal.id || deal.url || '')) return false;

    const expiresAt = parseTime(deal.expires || deal.validUntil || deal.end_date || deal.validity_date || '');
    if (expiresAt && expiresAt < now.getTime()) return false;

    return true;
}

async function reviewWeeklyDealActiveWithLLM(deal, options = {}) {
    const now = options.now instanceof Date ? options.now : new Date();
    const normalized = normalizeDealRecord(deal || {});
    const url = cleanText(normalized.url || '');
    const resultBase = {
        enabled: Boolean(process.env.OPENAI_API_KEY),
        model: FEATURED_LLM_MODEL,
        checkedAt: now.toISOString(),
        decision: 'skipped',
        confidence: 0,
        reason: '',
        evidence: null,
    };

    if (!process.env.OPENAI_API_KEY) {
        return {
            ...resultBase,
            reason: 'OPENAI_API_KEY fehlt; deterministischer Aktivitätscheck verwendet.',
            allowed: !FEATURED_WEEKLY_LLM_REQUIRED,
        };
    }

    let evidence = null;
    if (/^https?:\/\//i.test(url)) {
        try {
            evidence = compactFeaturedEvidence(await inspectDealUrlHealth(url, { timeoutMs: FEATURED_TARGET_TIMEOUT_MS }));
        } catch (error) {
            evidence = {
                invalid: false,
                transientError: true,
                blockedByProtection: false,
                status: null,
                reason: clipText(error?.message || error, 180),
                finalUrl: url,
            };
        }
    } else {
        evidence = {
            invalid: true,
            transientError: false,
            blockedByProtection: false,
            status: null,
            reason: 'fehlender prüfbarer Ziellink',
            finalUrl: '',
        };
    }

    if (evidence?.invalid && !evidence?.transientError && !evidence?.blockedByProtection) {
        return {
            ...resultBase,
            decision: 'inactive',
            confidence: 1,
            reason: `Ziellink ungültig: ${evidence.reason || 'unbekannt'}`,
            evidence,
            allowed: false,
        };
    }

    try {
        const response = await fetch('https://api.openai.com/v1/chat/completions', {
            method: 'POST',
            headers: {
                'content-type': 'application/json',
                authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
            },
            body: JSON.stringify({
                model: FEATURED_LLM_MODEL,
                temperature: 0,
                response_format: {
                    type: 'json_schema',
                    json_schema: {
                        name: 'freefinder_featured_weekly_active_check',
                        strict: true,
                        schema: {
                            type: 'object',
                            additionalProperties: false,
                            properties: {
                                decision: { type: 'string', enum: ['active', 'inactive', 'unclear'] },
                                confidence: { type: 'number' },
                                reason: { type: 'string' },
                            },
                            required: ['decision', 'confidence', 'reason'],
                        },
                    },
                },
                messages: [
                    {
                        role: 'system',
                        content: [
                            'Du prüfst genau einen FreeFinder Deal der Woche für Wien.',
                            'Der Deal der Woche darf nur gesetzt werden, wenn er ein Essen- oder Trinken-Deal ist und heute noch aktiv wirkt.',
                            'Nutze die App-Daten und die Zielseiten-Evidence. Wenn ein Ablaufdatum in der Vergangenheit liegt, entscheide inactive.',
                            'Wenn der Zielseiten-Text den Deal, die Marke oder den Vorteil nicht bestätigt, entscheide unclear oder inactive.',
                            'Bei Bot-Schutz oder temporären Fehlern entscheide unclear, außer App-Daten zeigen eindeutig ein künftiges Ablaufdatum.',
                            'Antworte ausschließlich im JSON-Schema.',
                        ].join(' '),
                    },
                    {
                        role: 'user',
                        content: JSON.stringify({
                            referenceDate: now.toISOString(),
                            timezone: 'Europe/Vienna',
                            deal: {
                                id: clipText(normalized.id || '', 120),
                                brand: clipText(normalized.brand || '', 100),
                                title: clipText(normalized.title || '', 180),
                                description: clipText(normalized.description || '', 360),
                                category: clipText(normalized.category || '', 80),
                                type: clipText(normalized.type || '', 80),
                                distance: clipText(normalized.distance || '', 180),
                                url,
                                expires: clipText(normalized.expiryDisplayText || normalized.expires || normalized.expiresOriginal || '', 180),
                                validOn: clipText(normalized.validOn || '', 40),
                                validFrom: clipText(normalized.validFrom || '', 40),
                                validUntil: clipText(normalized.validUntil || '', 40),
                                pubDate: clipText(normalized.pubDate || normalized.approvedAt || '', 80),
                            },
                            targetEvidence: evidence,
                        }),
                    },
                ],
            }),
        });

        const text = await response.text();
        if (!response.ok) throw new Error(`OpenAI HTTP ${response.status}: ${text.slice(0, 220)}`);
        const parsed = JSON.parse(JSON.parse(text)?.choices?.[0]?.message?.content || '{}');
        const decision = cleanText(parsed.decision || '').toLowerCase();
        const confidence = Math.max(0, Math.min(1, Number(parsed.confidence) || 0));
        const allowed = decision === 'active' && confidence >= FEATURED_WEEKLY_LLM_MIN_CONFIDENCE;
        return {
            ...resultBase,
            decision,
            confidence,
            reason: clipText(parsed.reason || '', 240),
            evidence,
            allowed,
        };
    } catch (error) {
        return {
            ...resultBase,
            decision: 'error',
            confidence: 0,
            reason: clipText(error?.message || error, 240),
            evidence,
            allowed: !FEATURED_WEEKLY_LLM_REQUIRED,
        };
    }
}

async function getFeaturedDealEligibility(deal, kind = 'daily', options = {}) {
    const now = options.now instanceof Date ? options.now : new Date();
    const normalized = normalizeDealRecord(deal || {});

    if (!isFeaturedDealStillLive(normalized, now)) {
        return { eligible: false, reason: 'not_live_or_expired', llmActiveCheck: null };
    }

    if (kind !== 'weekly') {
        return { eligible: true, reason: 'daily_live', llmActiveCheck: null };
    }

    if (!isFoodDrinkDeal(normalized)) {
        return { eligible: false, reason: 'weekly_not_food_or_drink', llmActiveCheck: null };
    }

    if (options.llmEnabled === false) {
        return {
            eligible: true,
            reason: 'weekly_food_or_drink_llm_disabled',
            llmActiveCheck: { enabled: false, decision: 'skipped', reason: 'LLM check disabled by caller.' },
        };
    }

    const llmActiveCheck = await reviewWeeklyDealActiveWithLLM(normalized, { now });
    return {
        eligible: Boolean(llmActiveCheck.allowed),
        reason: llmActiveCheck.allowed ? 'weekly_food_or_drink_llm_active' : 'weekly_llm_not_active',
        llmActiveCheck,
    };
}

function loadExistingFeaturedDeal(kind) {
    const fileName = kind === 'weekly' ? 'deal-of-the-week.json' : 'deal-of-the-day.json';
    const filePath = path.join(__dirname, '..', 'docs', fileName);
    try {
        if (!fs.existsSync(filePath)) return null;
        return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
    } catch (error) {
        console.log(`Could not read ${fileName}:`, error.message);
        return null;
    }
}

async function isExistingFeaturedDealCurrent(kind, approvedDeals) {
    const existing = loadExistingFeaturedDeal(kind);
    if (!existing) return false;

    const expectedKey = kind === 'weekly' ? getViennaWeekKey() : getViennaDayKey();
    const actualKey = kind === 'weekly' ? cleanText(existing.week || '') : cleanText(existing.date || '');
    if (actualKey !== expectedKey) return false;

    const approvedDeal = findApprovedDealMatch(approvedDeals, {
        id: existing.dealId || existing.id || '',
        url: existing.url || '',
    });
    const eligibility = await getFeaturedDealEligibility(approvedDeal || existing, kind);
    if (!eligibility.eligible) {
        console.log(`Existing ${kind} featured deal is not eligible anymore: ${eligibility.reason}`);
    }
    return eligibility.eligible;
}

function automaticCategoryScore(category) {
    const value = cleanText(category || '').toLowerCase();
    const scores = new Map([
        ['essen', 22],
        ['kaffee', 20],
        ['supermarkt', 16],
        ['shopping', 12],
        ['beauty', 10],
        ['fitness', 10],
        ['reisen', 8],
        ['kultur', 6],
        ['events', 6],
        ['kirche', -20],
        ['gottesdienste', -20],
        ['gemeinde', -18],
    ]);
    return scores.get(value) || 0;
}

function automaticTypeScore(type) {
    const value = cleanText(type || '').toLowerCase();
    if (value === 'gratis') return 30;
    if (value === 'bogo') return 24;
    if (value === 'rabatt') return 18;
    if (value === 'gutschein') return 14;
    return 0;
}

function isWeakAutomaticBrand(value) {
    const text = cleanText(value || '').toLowerCase();
    if (!text) return true;
    return /^(instagram|tiktok|wien|deal|gutschein|gratis|rabatt|angebot|restaurant|lieferung|jeder|jede|jedem|jeden)\b/.test(text)
        || /\bbestellung\b/.test(text);
}

function scoreAutomaticFeaturedDeal(deal, kind, now = new Date()) {
    const normalized = normalizeDealRecord(deal);
    const brand = cleanText(normalized.brand || '');
    const title = cleanText(normalized.title || '');
    const description = cleanText(normalized.description || '');
    const weakBrand = isWeakAutomaticBrand(brand);
    let score = automaticTypeScore(normalized.type) + automaticCategoryScore(normalized.category);

    if (brand && !weakBrand) score += 12;
    if (weakBrand) score -= 18;
    if (title.length >= 14) score += 8;
    if (description.length >= 28) score += 6;
    if (/^https?:\/\//i.test(cleanText(normalized.url || ''))) score += 6;
    if (cleanText(normalized.logoUrl || '')) score += 2;
    if (kind === 'weekly') score += Math.min(description.length, 160) / 24;

    const pubDate = parseTime(normalized.pubDate || normalized.approvedAt || '');
    if (pubDate) {
        const ageDays = Math.max(0, (now.getTime() - pubDate) / (24 * 60 * 60 * 1000));
        score += Math.max(0, 18 - ageDays);
    }

    return score;
}

async function selectAutomaticFeaturedDeal(approvedDeals, options = {}) {
    const kind = options.kind || 'daily';
    const now = options.now instanceof Date ? options.now : new Date();
    const excludedIds = options.excludedIds instanceof Set ? options.excludedIds : new Set();
    const liveDeals = approvedDeals
        .filter((deal) => isFeaturedDealStillLive(deal, now))
        .filter((deal) => !excludedIds.has(cleanText(deal.id || '')));

    if (liveDeals.length === 0) return null;

    const preferred = kind === 'weekly'
        ? liveDeals.filter((deal) => isFoodDrinkDeal(deal))
        : liveDeals.filter((deal) => {
            const category = cleanText(deal.category || '').toLowerCase();
            return !['kirche', 'gottesdienste', 'gemeinde'].includes(category);
        });
    const candidates = kind === 'weekly'
        ? preferred
        : (preferred.length > 0 ? preferred : liveDeals);
    if (candidates.length === 0) return null;

    const sortedCandidates = [...candidates].sort((a, b) => {
        const scoreDelta = scoreAutomaticFeaturedDeal(b, kind, now) - scoreAutomaticFeaturedDeal(a, kind, now);
        if (scoreDelta !== 0) return scoreDelta;
        return parseTime(b.pubDate || b.approvedAt || '') - parseTime(a.pubDate || a.approvedAt || '');
    });

    for (const deal of sortedCandidates) {
        const eligibility = await getFeaturedDealEligibility(deal, kind, {
            now,
            llmEnabled: options.llmEnabled,
        });
        if (eligibility.eligible) return { deal, eligibility };
        console.log(`Automatic ${kind} candidate skipped: ${deal.brand} - ${deal.title} (${eligibility.reason})`);
    }

    return null;
}

// ============================================
// Step 4: Write featured deal files
// ============================================
function saveDealOfTheDay(deal, options = {}) {
    const outputPath = path.join(__dirname, '..', 'docs', 'deal-of-the-day.json');
    const today = getViennaDayKey();
    const normalized = normalizeDealRecord(deal);
    const manualPick = options.manualPick !== false;

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
        manualPick,
        selectionReason: manualPick ? 'slack-pick' : 'automatic-approved-fallback',
        pickedAt: new Date().toISOString()
  };

  fs.writeFileSync(outputPath, JSON.stringify(output, null, 2));
    console.log('Saved deal-of-the-day.json:', deal.brand, '-', deal.title);
}

function saveDealOfTheWeek(deal, options = {}) {
    const outputPath = path.join(__dirname, '..', 'docs', 'deal-of-the-week.json');
    const week = getViennaWeekKey();
    const normalized = normalizeDealRecord(deal);
    const manualPick = options.manualPick !== false;

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
        manualPick,
        selectionReason: manualPick ? 'slack-pick' : 'automatic-approved-fallback',
        eligibility: options.eligibility || null,
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
        console.log('Slack not configured, falling back to approved live deals');
  }

  const approvedDeals = loadApprovedDeals();
  let threadTs = null;
  let picks = { daily: null, weekly: null };
  let threadMessages = [];
  let deals = [];
  let botUserId = '';

  if (SLACK_BOT_TOKEN && SLACK_CHANNEL_ID) {
    threadTs = await findTodaysThread();
    if (threadTs) {
      picks = await findYourPicks(threadTs) || picks;
      threadMessages = await getThreadMessages(threadTs);
      deals = applySlackEditsToDeals(extractDealsFromThreadMessages(threadMessages), threadMessages);
      botUserId = await getBotUserId();
      if (deals.length === 0) {
            const sample = threadMessages.find((msg) => cleanText(msg?.ts) !== cleanText(threadTs));
            if (sample) {
                    console.log('Sample digest message text:', JSON.stringify(extractSlackMessageText(sample).slice(0, 1000)));
                    console.log('Sample digest message keys:', Object.keys(sample).slice(0, 20).join(','));
                    console.log('Sample digest has blocks:', Array.isArray(sample.blocks), 'blockCount:', Array.isArray(sample.blocks) ? sample.blocks.length : 0);
            }
            console.log('No digest deals found, falling back to approved live deals');
      }
    }
  }

  const maxOrder = deals.reduce((max, current) => Math.max(max, Number(current?.order) || 0), 0);

  async function maybePersistPick(kind, pickNumber) {
    if (!pickNumber || deals.length === 0) return false;
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
    const eligibility = await getFeaturedDealEligibility(dealToPersist, kind);
    if (!eligibility.eligible) {
      console.log(`${kind} pick is not eligible, skipping: ${eligibility.reason}`);
      return false;
    }
    if (kind === 'daily') {
      saveDealOfTheDay(dealToPersist);
    } else if (kind === 'weekly') {
      saveDealOfTheWeek(dealToPersist, { eligibility });
    }
    return true;
  }

  let savedDaily = await maybePersistPick('daily', picks.daily);
  let savedWeekly = await maybePersistPick('weekly', picks.weekly);

  const automaticExcludedIds = new Set();
  if (savedDaily && picks.daily) {
    const pickedDaily = findPickedDeal(deals, picks.daily);
    if (pickedDaily?.id) automaticExcludedIds.add(cleanText(pickedDaily.id));
  }

  if (!savedDaily && !(await isExistingFeaturedDealCurrent('daily', approvedDeals))) {
    const fallbackDaily = await selectAutomaticFeaturedDeal(approvedDeals, {
      kind: 'daily',
      excludedIds: automaticExcludedIds,
    });
    if (fallbackDaily) {
      console.log(`Automatic daily fallback: ${fallbackDaily.deal.brand} - ${fallbackDaily.deal.title}`);
      saveDealOfTheDay(fallbackDaily.deal, { manualPick: false });
      savedDaily = true;
      if (fallbackDaily.deal.id) automaticExcludedIds.add(cleanText(fallbackDaily.deal.id));
    } else {
      console.log('No approved live deal available for automatic daily fallback');
    }
  } else if (!savedDaily) {
    console.log('Existing daily featured deal is current and approved');
  }

  if (!savedWeekly && !(await isExistingFeaturedDealCurrent('weekly', approvedDeals))) {
    const fallbackWeekly = await selectAutomaticFeaturedDeal(approvedDeals, {
      kind: 'weekly',
      excludedIds: automaticExcludedIds,
    });
    if (fallbackWeekly) {
      console.log(`Automatic weekly fallback: ${fallbackWeekly.deal.brand} - ${fallbackWeekly.deal.title}`);
      saveDealOfTheWeek(fallbackWeekly.deal, { manualPick: false, eligibility: fallbackWeekly.eligibility });
      savedWeekly = true;
    } else {
      console.log('No approved live deal available for automatic weekly fallback');
    }
  } else if (!savedWeekly) {
    console.log('Existing weekly featured deal is current and approved');
  }

  if (!savedDaily && !savedWeekly) {
    console.log('No featured deal files updated');
    process.exit(0);
  }

  console.log('Done!');
}

export {
    getFeaturedDealEligibility,
    getViennaDayKey,
    getViennaWeekKey,
    isFeaturedDealStillLive,
    isFoodDrinkDeal,
    selectAutomaticFeaturedDeal,
};

if (process.argv[1] && path.resolve(process.argv[1]) === __filename) {
    main().catch(err => {
        console.error('Error:', err.message);
        process.exit(1);
    });
}

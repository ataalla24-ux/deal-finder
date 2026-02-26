import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.join(__dirname, '..');
const OUTPUT_PATH = path.join(ROOT, 'docs', 'deals-pending-instagram.json');
const ENV_PATH = path.join(ROOT, '.env');

const CONFIG = {
  maxDealsPerRun: 40,
  maxAgeDays: 7,
  perSourceLinksLimit: 24,
  maxPostsToVisit: 80,
  postLoadTimeoutMs: 12000,
};

const HASHTAGS = [
  'gratiswien',
  'wiengratis',
  'wiendeals',
  'wienaktion',
  'wienrabatt',
  'freebieswien',
  'foodiewien',
  'wienfood',
  'kaffeewien',
  'eroeffnungwien',
  'neueroeffnungwien',
];

const INSTAGRAM_ACCOUNTS = [
  '1000thingsinvienna',
  'wien.info',
  'viennawurstelstand',
  'viennafoodstories',
  'vienna.go',
  'wienmalanders',
];

const SEARCH_QUERIES = [
  'site:instagram.com/reel wien gratis',
  'site:instagram.com/p wien rabatt',
  'site:instagram.com/reel vienna deal',
  'site:instagram.com/p wien food deal',
  'site:instagram.com/reel neuoeffnung wien',
];

const WIEN_KEYWORDS = [
  'wien', 'vienna', 'innere stadt', 'mariahilf', 'leopoldstadt', 'ottakring',
  'favoriten', 'neubau', 'währing', 'floridsdorf', 'donaustadt', '1010', '1020', '1030',
  '1040', '1050', '1060', '1070', '1080', '1090', '1100', '1110', '1120', '1130',
  '1140', '1150', '1160', '1170', '1180', '1190', '1200', '1210', '1220', '1230',
];

const DEAL_KEYWORDS = [
  'gratis', 'kostenlos', 'free', 'freebie', '0€', '0 €', 'rabatt', 'discount', 'aktion',
  'angebot', 'deal', 'gutschein', 'coupon', 'voucher', '1+1', '2for1', '2 for 1',
  'happy hour', 'gewinnspiel', 'verlosung', 'eröffnung', 'neueröffnung', 'special',
];

const FOOD_KEYWORDS = [
  'restaurant', 'pizza', 'burger', 'sushi', 'cafe', 'café', 'brunch', 'coffee', 'kaffee',
  'croissant', 'frühstück', 'mittag', 'abendessen', 'essen', 'drink', 'cocktail',
];

const SHOPPING_KEYWORDS = [
  'shop', 'store', 'fashion', 'beauty', 'fitness', 'gym', 'ticket', 'museum', 'kino',
  'event', 'club', 'bar', 'spa', 'wellness', 'reise', 'hotel',
];

const EVENT_KEYWORDS = [
  'konzert', 'event', 'party', 'festival', 'kino', 'theater', 'show',
  'livemusik', 'live musik', 'drinks', 'opening party',
];

function loadEnvFile() {
  if (!fs.existsSync(ENV_PATH)) return;
  const lines = fs.readFileSync(ENV_PATH, 'utf-8').split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const idx = trimmed.indexOf('=');
    if (idx <= 0) continue;
    const key = trimmed.slice(0, idx).trim();
    let value = trimmed.slice(idx + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (!(key in process.env)) process.env[key] = value;
  }
}

function loadCookieHints() {
  const hints = [];
  const sessionId = cleanText(process.env.INSTAGRAM_SESSIONID);
  if (sessionId) {
    hints.push({ name: 'sessionid', value: sessionId });
  }

  const cookieFile = cleanText(process.env.INSTAGRAM_COOKIES_FILE);
  if (cookieFile && fs.existsSync(cookieFile)) {
    const raw = fs.readFileSync(cookieFile, 'utf-8');
    const lines = raw.split(/\r?\n/);
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;

      // TSV export format (common from browser extensions):
      // name, value, domain, path, expires, ...
      if (line.includes('\t')) {
        const cols = line.split('\t').map((c) => c.trim());
        if (cols.length >= 2) {
          const name = cols[0];
          const value = cols[1];
          const domain = cols[2] || '.instagram.com';
          if (/^[A-Za-z0-9_.-]+$/.test(name) && value) {
            hints.push({ name, value, domain });
            continue;
          }
        }
      }

      // key=value; key2=value2 format
      const parts = trimmed.split(';').map((p) => p.trim()).filter(Boolean);
      for (const part of parts) {
        const eq = part.indexOf('=');
        if (eq <= 0) continue;
        const name = part.slice(0, eq).trim();
        const value = part.slice(eq + 1).trim();
        if (name && value) hints.push({ name, value, domain: '.instagram.com' });
      }
    }
  }

  return hints;
}

function cleanText(value) {
  if (!value) return '';
  return String(value)
    .replace(/<[^>]+>/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

function containsKeyword(text, keywords) {
  const lower = cleanText(text).toLowerCase();
  return keywords.some((k) => lower.includes(k));
}

function detectCategory(text) {
  const lower = cleanText(text).toLowerCase();
  if (EVENT_KEYWORDS.some((k) => lower.includes(k))) return 'events';
  if (FOOD_KEYWORDS.some((k) => lower.includes(k))) return 'essen';
  if (lower.includes('coffee') || lower.includes('kaffee')) return 'kaffee';
  if (lower.includes('fitness') || lower.includes('gym')) return 'fitness';
  if (SHOPPING_KEYWORDS.some((k) => lower.includes(k))) return 'shopping';
  return 'wien';
}

function detectType(text) {
  const lower = cleanText(text).toLowerCase();
  if (lower.includes('gratis') || lower.includes('kostenlos') || lower.includes('free')) return 'gratis';
  if (lower.includes('1+1') || lower.includes('2for1') || lower.includes('2 for 1')) return 'bogo';
  return 'rabatt';
}

function scorePost({ text, accountHint }) {
  let score = 0;
  if (containsKeyword(text, DEAL_KEYWORDS)) score += 55;
  if (containsKeyword(text, WIEN_KEYWORDS)) score += 30;
  if (accountHint) score += 10;
  if (containsKeyword(text, FOOD_KEYWORDS)) score += 10;
  return Math.min(100, score);
}

function stableId(seed) {
  let hash = 0;
  for (let i = 0; i < seed.length; i += 1) hash = (hash * 31 + seed.charCodeAt(i)) >>> 0;
  return hash.toString(36);
}

function parseDateFromPage({ ldDate, ogDescription, fallbackNow = Date.now() }) {
  if (ldDate) {
    const ts = Date.parse(ldDate);
    if (!Number.isNaN(ts)) return new Date(ts).toISOString();
  }

  const text = cleanText(ogDescription);
  const ymd = text.match(/(\d{4})-(\d{2})-(\d{2})/);
  if (ymd) return new Date(`${ymd[1]}-${ymd[2]}-${ymd[3]}T12:00:00Z`).toISOString();

  const dmy = text.match(/(\d{1,2})\.(\d{1,2})\.(\d{2,4})/);
  if (dmy) {
    const yyyy = dmy[3].length === 2 ? `20${dmy[3]}` : dmy[3];
    const mm = String(dmy[2]).padStart(2, '0');
    const dd = String(dmy[1]).padStart(2, '0');
    return new Date(`${yyyy}-${mm}-${dd}T12:00:00Z`).toISOString();
  }

  const dmyNoYear = text.match(/(\d{1,2})\.(\d{1,2})(?!\.)/);
  if (dmyNoYear) {
    const mm = String(dmyNoYear[2]).padStart(2, '0');
    const dd = String(dmyNoYear[1]).padStart(2, '0');
    const now = new Date(fallbackNow);
    let candidate = new Date(`${now.getFullYear()}-${mm}-${dd}T12:00:00Z`);
    if (candidate.getTime() - fallbackNow > 30 * 24 * 60 * 60 * 1000) {
      candidate = new Date(`${now.getFullYear() - 1}-${mm}-${dd}T12:00:00Z`);
    }
    if (!Number.isNaN(candidate.getTime())) return candidate.toISOString();
  }

  return new Date(fallbackNow).toISOString();
}

function isFresh(isoDate) {
  const ts = Date.parse(isoDate);
  if (Number.isNaN(ts)) return false;
  const ageMs = Date.now() - ts;
  return ageMs <= CONFIG.maxAgeDays * 24 * 60 * 60 * 1000;
}

function extractPostUrls(html) {
  const urls = new Set();
  const re = /https:\/\/www\.instagram\.com\/(?:p|reel)\/[A-Za-z0-9_-]+\//g;
  const matches = html.match(re) || [];
  for (const m of matches) urls.add(m);
  return [...urls];
}

function normalizePostHref(href) {
  const raw = cleanText(href);
  if (!raw) return '';
  if (raw.startsWith('/p/') || raw.startsWith('/reel/')) {
    const parts = raw.split('/').filter(Boolean);
    if (parts.length >= 2) return `https://www.instagram.com/${parts[0]}/${parts[1]}/`;
  }
  if (/^https?:\/\/(?:www\.)?instagram\.com\/(?:p|reel)\//i.test(raw)) {
    return normalizeInstagramPostUrl(raw);
  }
  return '';
}

async function collectLinksFromDom(page) {
  try {
    const hrefs = await page.$$eval('a[href]', (nodes) => nodes.map((n) => n.getAttribute('href') || '').filter(Boolean));
    const urls = new Set();
    for (const href of hrefs) {
      const normalized = normalizePostHref(href);
      if (normalized) urls.add(normalized);
    }
    return [...urls];
  } catch {
    return [];
  }
}

function normalizeInstagramPostUrl(rawUrl) {
  const text = cleanText(rawUrl);
  if (!text) return '';
  try {
    const decoded = decodeURIComponent(text);
    const directMatch = decoded.match(/https?:\/\/(?:www\.)?instagram\.com\/(?:p|reel)\/[A-Za-z0-9_-]+\/?/i);
    if (!directMatch) return '';
    const u = new URL(directMatch[0]);
    const parts = u.pathname.split('/').filter(Boolean);
    if (parts.length < 2) return '';
    return `https://www.instagram.com/${parts[0]}/${parts[1]}/`;
  } catch {
    return '';
  }
}

function toMirrorUrl(url) {
  return `https://r.jina.ai/http://${url.replace(/^https?:\/\//, '')}`;
}

async function fetchMirrorText(url) {
  try {
    const response = await fetch(toMirrorUrl(url), { headers: { 'User-Agent': 'Mozilla/5.0' } });
    if (!response.ok) return '';
    return await response.text();
  } catch {
    return '';
  }
}

async function discoverLinksViaDuckDuckGo() {
  const links = new Set();
  for (const query of SEARCH_QUERIES) {
    try {
      const url = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`;
      const response = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
      if (!response.ok) continue;
      const html = await response.text();

      const hrefMatches = html.match(/href="([^"]+)"/g) || [];
      for (const hrefToken of hrefMatches) {
        const raw = hrefToken.replace(/^href="/, '').replace(/"$/, '');
        const normalized = normalizeInstagramPostUrl(raw);
        if (normalized) links.add(normalized);
      }
    } catch {
      // ignore one query failure
    }
  }
  return [...links];
}

function buildSources() {
  const hashtagSources = HASHTAGS.map((tag) => ({
    kind: 'hashtag',
    key: `tag:${tag}`,
    url: `https://www.instagram.com/explore/tags/${tag}/`,
  }));

  const accountSources = INSTAGRAM_ACCOUNTS.map((username) => ({
    kind: 'account',
    key: `acct:${username}`,
    url: `https://www.instagram.com/${username}/`,
  }));

  return [...hashtagSources, ...accountSources];
}

function fallbackBrandFromUrl(url) {
  try {
    const u = new URL(url);
    const parts = u.pathname.split('/').filter(Boolean);
    return parts[0] || 'Instagram';
  } catch {
    return 'Instagram';
  }
}

function deriveBrand(data, postUrl) {
  const ldAuthor = cleanText(data.ldAuthor);
  if (ldAuthor) return ldAuthor;

  const ogTitle = cleanText(data.ogTitle);
  const titleMatch = ogTitle.match(/^(.+?)\s+auf Instagram[:]?/i);
  if (titleMatch && titleMatch[1]) return titleMatch[1].replace(/^@/, '').trim();

  const desc = cleanText(data.ogDescription);
  const atMatch = desc.match(/@([A-Za-z0-9._]+)/);
  if (atMatch) return atMatch[1];

  return fallbackBrandFromUrl(postUrl);
}

async function scrapeInstagram() {
  console.log('📸 INSTAGRAM SCRAPER - current deals mode');
  console.log('========================================');
  loadEnvFile();

  let browser;
  try {
    const { chromium } = await import('playwright');

    browser = await chromium.launch({
      headless: true,
      args: [
        '--disable-blink-features=AutomationControlled',
        '--no-sandbox',
        '--disable-dev-shm-usage',
      ],
    });

    const context = await browser.newContext({
      viewport: { width: 1366, height: 900 },
      userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
      locale: 'de-AT',
      timezoneId: 'Europe/Vienna',
    });

    const cookieHints = loadCookieHints();
    if (cookieHints.length > 0) {
      await context.addCookies(
        cookieHints.map((c) => ({
          name: c.name,
          value: c.value,
          domain: c.domain || '.instagram.com',
          path: '/',
          secure: true,
          httpOnly: c.name === 'sessionid',
          sameSite: 'Lax',
        }))
      );
      console.log(`🍪 loaded ${cookieHints.length} Instagram cookies`);
    } else {
      console.log('ℹ️ no Instagram auth cookies found; public pages may return login wall');
    }

    const page = await context.newPage();
    await page.addInitScript(() => {
      Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
    });

    const sources = buildSources();
    const candidatePosts = new Map();

    for (const source of sources) {
      try {
        console.log(`🔎 Source ${source.key}`);
        await page.goto(source.url, { waitUntil: 'domcontentloaded', timeout: 25000 });
        await page.waitForTimeout(2500);
        await page.mouse.wheel(0, 2200);
        await page.waitForTimeout(1200);

        const domUrls = await collectLinksFromDom(page);
        const html = await page.content();
        let postUrls = [...new Set([...domUrls, ...extractPostUrls(html)])].slice(0, CONFIG.perSourceLinksLimit);
        if (postUrls.length === 0) {
          const mirrorText = await fetchMirrorText(source.url);
          postUrls = [...new Set([...postUrls, ...extractPostUrls(mirrorText)])].slice(0, CONFIG.perSourceLinksLimit);
        }
        console.log(`   ↳ links found: ${postUrls.length}`);

        for (const postUrl of postUrls) {
          if (!candidatePosts.has(postUrl)) {
            candidatePosts.set(postUrl, {
              url: postUrl,
              sourceKey: source.key,
              accountHint: source.kind === 'account',
            });
          }
        }
      } catch (error) {
        console.log(`   ⚠️ source failed: ${error.message}`);
      }
    }

    if (candidatePosts.size === 0) {
      const discovered = await discoverLinksViaDuckDuckGo();
      for (const postUrl of discovered) {
        candidatePosts.set(postUrl, {
          url: postUrl,
          sourceKey: 'search:duckduckgo',
          accountHint: false,
        });
      }
      console.log(`🌐 duckduckgo fallback links: ${discovered.length}`);
    }

    const postsToVisit = [...candidatePosts.values()].slice(0, CONFIG.maxPostsToVisit);
    const deals = [];

    for (let i = 0; i < postsToVisit.length; i += 1) {
      const post = postsToVisit[i];
      try {
        await page.goto(post.url, { waitUntil: 'domcontentloaded', timeout: CONFIG.postLoadTimeoutMs });
        await page.waitForTimeout(1200);

        let data = await page.evaluate(() => {
          const result = {
            ldDate: '',
            ldCaption: '',
            ldAuthor: '',
            ogTitle: '',
            ogDescription: '',
            text: document.body ? document.body.innerText : '',
          };

          for (const script of document.querySelectorAll('script[type="application/ld+json"]')) {
            try {
              const parsed = JSON.parse(script.textContent || '{}');
              const obj = Array.isArray(parsed) ? parsed[0] : parsed;
              if (!obj || typeof obj !== 'object') continue;
              if (obj.datePublished && !result.ldDate) result.ldDate = String(obj.datePublished);
              if (obj.caption && !result.ldCaption) result.ldCaption = String(obj.caption);
              if (obj.author && typeof obj.author === 'object' && obj.author.name && !result.ldAuthor) {
                result.ldAuthor = String(obj.author.name);
              }
            } catch {}
          }

          const ogTitle = document.querySelector('meta[property="og:title"]');
          const ogDescription = document.querySelector('meta[property="og:description"]');
          if (ogTitle?.content) result.ogTitle = ogTitle.content;
          if (ogDescription?.content) result.ogDescription = ogDescription.content;

          return result;
        });

        if (!data.ldCaption && !data.ogDescription) {
          const mirrorText = await fetchMirrorText(post.url);
          if (mirrorText) {
            const firstLines = mirrorText.split('\n').slice(0, 40).join(' ');
            data = {
              ...data,
              ogDescription: data.ogDescription || firstLines,
              text: `${data.text || ''} ${mirrorText.slice(0, 3000)}`,
            };
          }
        }

        const combinedText = cleanText([
          data.ldCaption,
          data.ogTitle,
          data.ogDescription,
          data.text.slice(0, 2000),
        ].join(' '));

        const pubDateIso = parseDateFromPage({
          ldDate: data.ldDate,
          ogDescription: data.ogDescription,
        });

        if (!isFresh(pubDateIso)) continue;

        const score = scorePost({ text: combinedText, accountHint: post.accountHint });
        if (score < 55) continue;

        const brand = deriveBrand(data, post.url);
        const titleBase = cleanText(data.ogTitle || data.ldCaption || 'Instagram Deal');
        const title = titleBase.length > 80 ? `${titleBase.slice(0, 77)}...` : titleBase;

        const deal = {
          id: `ig-${stableId(`${post.url}|${pubDateIso}`)}`,
          brand,
          title,
          logo: detectCategory(combinedText) === 'essen' ? '🍔' : '📷',
          description: combinedText.slice(0, 180),
          type: detectType(combinedText),
          category: detectCategory(combinedText),
          source: 'Instagram',
          url: post.url,
          expires: 'Unbekannt',
          distance: containsKeyword(combinedText, WIEN_KEYWORDS) ? 'Wien' : 'Online',
          hot: score >= 80,
          isNew: true,
          priority: Math.max(1, Math.round(score / 12)),
          votes: 1,
          qualityScore: score,
          pubDate: pubDateIso,
        };

        deals.push(deal);
      } catch {
        // skip inaccessible posts
      }

      if ((i + 1) % 25 === 0) {
        console.log(`   ✅ checked posts: ${i + 1}/${postsToVisit.length}`);
      }
    }

    const dedup = new Map();
    for (const deal of deals) {
      const key = `${deal.url}|${deal.brand}|${deal.title.toLowerCase()}`;
      if (!dedup.has(key) || dedup.get(key).qualityScore < deal.qualityScore) {
        dedup.set(key, deal);
      }
    }

    const uniqueDeals = [...dedup.values()]
      .sort((a, b) => {
        if (b.qualityScore !== a.qualityScore) return b.qualityScore - a.qualityScore;
        return Date.parse(b.pubDate) - Date.parse(a.pubDate);
      })
      .slice(0, CONFIG.maxDealsPerRun);

    const payload = {
      lastUpdated: new Date().toISOString(),
      source: 'instagram-web',
      totalDeals: uniqueDeals.length,
      deals: uniqueDeals,
    };

    fs.writeFileSync(OUTPUT_PATH, JSON.stringify(payload, null, 2));
    console.log(`✅ saved ${uniqueDeals.length} deals → ${OUTPUT_PATH}`);

    await browser.close();
    return payload;
  } catch (error) {
    console.error(`❌ Instagram scrape failed: ${error.message}`);
    if (browser) await browser.close();

    const fallback = {
      lastUpdated: new Date().toISOString(),
      source: 'instagram-web',
      totalDeals: 0,
      deals: [],
    };
    fs.writeFileSync(OUTPUT_PATH, JSON.stringify(fallback, null, 2));
    return fallback;
  }
}

scrapeInstagram()
  .then((result) => {
    console.log(`🎉 Done: ${result.totalDeals} Instagram deals`);
    process.exit(0);
  })
  .catch((err) => {
    console.error(err.message);
    process.exit(1);
  });

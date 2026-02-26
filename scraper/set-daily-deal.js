// ============================================
// SET DAILY DEAL - Reads your Slack reply and sets Deal des Tages
// How to use: reply to the daily digest thread with "deal 3" or just "3"
// Runs at 13:30 Vienna (12:30 UTC), AFTER approve workflow at 13:00
// ============================================
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const SLACK_BOT_TOKEN = process.env.SLACK_BOT_TOKEN || '';
const SLACK_CHANNEL_ID = process.env.SLACK_CHANNEL_ID || '';

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
  const today = new Date().toDateString();
    const thread = data.messages.find(m => {
          const msgDate = new Date(parseFloat(m.ts) * 1000).toDateString();
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
// Step 2: Read replies in thread, find your pick
// ============================================
async function findYourPick(threadTs) {
    const res = await fetch(
          `https://slack.com/api/conversations.replies?channel=${SLACK_CHANNEL_ID}&ts=${threadTs}`,
      { headers: { Authorization: `Bearer ${SLACK_BOT_TOKEN}` } }
        );
    const data = await res.json();
    if (!data.ok) {
          console.log('Error fetching replies:', data.error);
          return null;
    }

  // Go through replies (skip the first message which is the bot's own digest)
  // Look for messages like "deal 3", "3", "deal3", "#3"
  for (const msg of data.messages.slice(1).reverse()) {
        const text = (msg.text || '').trim().toLowerCase();
        const match = text.match(/^(?:deal\s*#?\s*|#\s*)?(\d+)$/);
        if (match) {
                const num = parseInt(match[1]);
                console.log('Found your pick:', num, 'from message:', msg.text);
                return num;
        }
  }

  console.log('No pick found in thread replies');
    return null;
}

// ============================================
// Step 3: Load deals - use deals-pending-all.json first (same order as Slack)
// Falls back to individual pending files with ALL sources matching slack-notify
// ============================================
function loadAllPendingDeals() {
    // Primary: deals-pending-all.json has the exact same order as Slack messages
  const allPath = path.join(__dirname, '..', 'docs', 'deals-pending-all.json');
    try {
          if (fs.existsSync(allPath)) {
                  const data = JSON.parse(fs.readFileSync(allPath, 'utf-8'));
                  const deals = data.deals || [];
                  if (deals.length > 0) {
                            console.log(`Loaded ${deals.length} deals from deals-pending-all.json (Slack order)`);
                            return deals;
                  }
          }
    } catch(e) {
          console.log('Could not load deals-pending-all.json:', e.message);
    }

  // Fallback: load from individual files – ALL sources matching slack-notify.js
  const sources = [
        'power', 'basic1', 'gastro2', 'food3', 'twitter', 'telegram',
        'firecrawl', 'firecrawl2', 'google', 'gutscheine', 'events',
        'super', 'scrapy', 'web', 'instagram'
      ];
    let allDeals = [];

  for (const source of sources) {
        const filePath = path.join(__dirname, '..', 'docs', `deals-pending-${source}.json`);
        try {
                if (fs.existsSync(filePath)) {
                          const data = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
                          const deals = data.deals || data || [];
                          allDeals = allDeals.concat(deals.map(d => ({ ...d, _source: source })));
                }
        } catch (e) { /* skip */ }
  }

  // Sort the same way slack-notify.js does (gratis first, then by quality)
  allDeals.sort((a, b) => {
        if (a.type === 'gratis' && b.type !== 'gratis') return -1;
        if (a.type !== 'gratis' && b.type === 'gratis') return 1;
        return (b.qualityScore || 0) - (a.qualityScore || 0);
  });

  console.log(`Loaded ${allDeals.length} deals from ${sources.length} individual sources (fallback)`);
    return allDeals;
}

// ============================================
// Step 4: Write deal-of-the-day.json
// ============================================
function saveDealOfTheDay(deal) {
    const outputPath = path.join(__dirname, '..', 'docs', 'deal-of-the-day.json');
    const today = new Date().toISOString().split('T')[0];

  const output = {
        date: today,
        dealId: deal.id,
        brand: deal.brand,
        title: deal.title,
        description: deal.description,
        logo: deal.logo || '🎯',
        url: deal.url,
        type: deal.type,
        category: deal.category || 'wien',
        distance: deal.distance || 'Wien',
        manualPick: true,
        pickedAt: new Date().toISOString()
  };

  fs.writeFileSync(outputPath, JSON.stringify(output, null, 2));
    console.log('Saved deal-of-the-day.json:', deal.brand, '-', deal.title);
}

// ============================================
// Step 5: Ensure the picked deal is in deals.json
// If the deal was approved it's already there.
// If not, inject it so the app can always display it.
// ============================================
function ensureDealInDealsJson(deal) {
    const dealsPath = path.join(__dirname, '..', 'docs', 'deals.json');

  let dealsData = { deals: [], totalDeals: 0, lastUpdated: new Date().toISOString() };
    try {
          if (fs.existsSync(dealsPath)) {
                  dealsData = JSON.parse(fs.readFileSync(dealsPath, 'utf-8'));
          }
    } catch(e) {
          console.log('Could not read deals.json:', e.message);
    }

  const deals = dealsData.deals || [];

  // Check if the deal already exists (by id or url)
  const exists = deals.some(d =>
        (d.id && d.id === deal.id) ||
        (d.url && deal.url && d.url === deal.url)
                              );

  if (exists) {
        console.log('Deal already in deals.json - no injection needed');
        return false;
  }

  // Inject the deal at the top with a flag
  const injected = {
        id: deal.id || `daily-${Date.now()}`,
        title: deal.title,
        description: deal.description,
        brand: deal.brand,
        url: deal.url || '',
        logo: deal.logo || '🎯',
        category: deal.category || 'wien',
        type: deal.type || 'gratis',
        distance: deal.distance || 'Wien',
        source: deal.source || deal._source || 'daily-pick',
        pubDate: deal.pubDate || new Date().toISOString(),
        qualityScore: deal.qualityScore || 80,
        isDailyDeal: true
  };

  deals.unshift(injected);
    dealsData.deals = deals;
    dealsData.totalDeals = deals.length;
    dealsData.lastUpdated = new Date().toISOString();

  fs.writeFileSync(dealsPath, JSON.stringify(dealsData, null, 2));
    console.log('Injected daily deal into deals.json (' + deals.length + ' total deals)');
    return true;
}

// ============================================
// Main
// ============================================
async function main() {
    console.log('SET DAILY DEAL');
    console.log('='.repeat(40));

  if (!SLACK_BOT_TOKEN || !SLACK_CHANNEL_ID) {
        console.log('Slack not configured, skipping');
        process.exit(0);
  }

  const threadTs = await findTodaysThread();
    if (!threadTs) {
          process.exit(0);
    }

  const pickNumber = await findYourPick(threadTs);
    if (!pickNumber) {
          console.log('No pick found - Deal des Tages will use automatic rotation today');
          process.exit(0);
    }

  const deals = loadAllPendingDeals();
    if (deals.length === 0) {
          console.log('No pending deals found');
          process.exit(0);
    }

  // pickNumber is 1-based (as shown in Slack)
  const deal = deals[pickNumber - 1];
    if (!deal) {
          console.log(`Pick #${pickNumber} out of range (only ${deals.length} deals)`);
          process.exit(0);
    }

  console.log(`Deal #${pickNumber}: ${deal.brand} - ${deal.title}`);

  saveDealOfTheDay(deal);
    ensureDealInDealsJson(deal);

  console.log('Done!');
}

main().catch(err => {
    console.error('Error:', err.message);
    process.exit(1);
});

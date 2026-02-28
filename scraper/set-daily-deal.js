// ============================================
// SET DAILY DEAL - Reads your Slack reply and sets Deal des Tages
// How to use: reply to the daily digest thread with "deal 3" or just "3"
// Runs at 13:30 Vienna (12:30 UTC), AFTER approve workflow at 13:00
// ============================================
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { cleanText, extractDealsFromThreadMessages, extractSlackMessageText } from './slack-digest-utils.js';

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

function hasHumanApproval(message, botUserId) {
    const reactions = Array.isArray(message?.reactions) ? message.reactions : [];
    const checks = reactions.filter((r) => ['white_check_mark', 'heavy_check_mark', 'check'].includes(r.name));
    return checks.some((reaction) => Array.isArray(reaction.users) && reaction.users.some((user) => user && user !== botUserId));
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
// Step 5: Ensure the picked deal is approved (exists in deals.json)
// ============================================
function isDealApproved(deal) {
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

  const threadMessages = await getThreadMessages(threadTs);
  const deals = extractDealsFromThreadMessages(threadMessages);
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

  // pickNumber is 1-based (as shown in Slack)
  const deal = deals[pickNumber - 1];
    if (!deal) {
          console.log(`Pick #${pickNumber} out of range (only ${deals.length} deals)`);
          process.exit(0);
    }

  console.log(`Deal #${pickNumber}: ${deal.brand} - ${deal.title}`);

  const botUserId = await getBotUserId();
  const pickedMessage = threadMessages.find((msg) => cleanText(msg?.ts) === cleanText(deal.slackTs));
  const approvedBySlack = isDealApprovedBySlack(pickedMessage, botUserId);

  if (!approvedBySlack && !isDealApproved(deal)) {
    process.exit(0);
  }

  saveDealOfTheDay(deal);

  console.log('Done!');
}

main().catch(err => {
    console.error('Error:', err.message);
    process.exit(1);
});

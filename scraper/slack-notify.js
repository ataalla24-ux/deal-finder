// ============================================
// 📱 SLACK NOTIFY - Sendet ALLE Deals an Slack
// Liest: deals-pending-*.json (power, instagram, firecrawl, google)
// ============================================

import fs from 'fs';
import { fileURLToPath } from 'url';
import path from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const SLACK_BOT_TOKEN = process.env.SLACK_BOT_TOKEN || '';
const SLACK_CHANNEL_ID = process.env.SLACK_CHANNEL_ID || '';

// ============================================
// Helper: Send Message to Slack
// ============================================

async function slackPost(message, threadTs = null) {
  if (!SLACK_BOT_TOKEN || !SLACK_CHANNEL_ID) {
    console.log('⚠️  Slack nicht konfiguriert - überspringe');
    return null;
  }

  const payload = {
    channel: SLACK_CHANNEL_ID,
    text: message,
  };
  
  if (threadTs) {
    payload.thread_ts = threadTs;
  }

  const response = await fetch('https://slack.com/api/chat.postMessage', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${SLACK_BOT_TOKEN}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  });

  const data = await response.json();
  if (!data.ok) {
    console.log(`❌ Slack Error: ${data.error}`);
    return null;
  }
  
  return data.ts;
}

// ============================================
// Helper: Load pending deals from file
// ============================================

function loadPendingDeals(source) {
  const filePath = `docs/deals-pending-${source}.json`;
  try {
    if (fs.existsSync(filePath)) {
      const data = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
      return data.deals || data || [];
    }
  } catch (e) {
    console.log(`⚠️  ${source} load error: ${e.message}`);
  }
  return [];
}

// ============================================
// Helper: Format deal for Slack
// ============================================

function formatDeal(deal, index, source) {
  const emoji = {
    power: '⚡',
    instagram: '📸',
    firecrawl: '🔥',
    google: '📍',
  }[source] || '🎯';

  const typeEmoji = deal.type === 'gratis' ? '🆓' : '💰';
  const title = deal.title || deal.brand || 'Deal';
  const brand = deal.brand || 'Unknown';
  const desc = deal.description ? `\n_${deal.description.substring(0, 80)}_` : '';
  const url = deal.url || '';
  
  return `${index}. ${typeEmoji} *${title.substring(0, 50)}*\n${desc}\n${emoji} ${brand} ${url ? `• <${url}|Link>` : ''}`;
}

// ============================================
// Main: Send ALL pending deals to Slack
// ============================================

async function main() {
  console.log('📱 SLACK NOTIFY - ALL SOURCES');
  console.log('='.repeat(40));

  if (!SLACK_BOT_TOKEN || !SLACK_CHANNEL_ID) {
    console.log('⚠️  SLACK_BOT_TOKEN oder SLACK_CHANNEL_ID fehlt');
    process.exit(0);
  }

  // Load all pending deals
  const sources = ['power', 'instagram', 'firecrawl', 'google'];
  let allDeals = [];
  
  for (const source of sources) {
    const deals = loadPendingDeals(source);
    console.log(`📂 ${source}: ${deals.length} Deals`);
    allDeals = allDeals.concat(deals.map(d => ({...d, _source: source})));
  }

  if (allDeals.length === 0) {
    console.log('📭 Keine Pending Deals gefunden');
    process.exit(0);
  }

  // Sort: Gratis first, then by score
  allDeals.sort((a, b) => {
    if (a.type === 'gratis' && b.type !== 'gratis') return -1;
    if (a.type !== 'gratis' && b.type === 'gratis') return 1;
    return (b.qualityScore || 0) - (a.qualityScore || 0);
  });

  // Count by type
  const gratisCount = allDeals.filter(d => d.type === 'gratis').length;
  const otherCount = allDeals.length - gratisCount;

  console.log(`📊 Total: ${allDeals.length} (${gratisCount} gratis, ${otherCount} andere)`);

  // Send main message
  const mainMsg = await slackPost(
    `🎯 *FreeFinder Wien* — ${allDeals.length} Deals zum Review\n` +
    `🆓 ${gratisCount}x Gratis • 💰 ${otherCount}x Other\n` +
    `_Reagiere mit ✅ um zu genehmigen_`
  );

  if (!mainMsg) {
    console.log('❌ Konnte Hauptnachricht nicht senden');
    process.exit(1);
  }

  // Send each deal as thread reply
  console.log('📤 Sende Deals...');
  for (let i = 0; i < allDeals.length; i++) {
    const deal = allDeals[i];
    const msg = formatDeal(deal, i + 1, deal._source);
    await slackPost(msg, mainMsg);
    
    if ((i + 1) % 10 === 0) {
      console.log(`   ${i + 1}/${allDeals.length}...`);
    }
  }

  console.log(`✅ ${allDeals.length} Deals an Slack gesendet!`);
}

main()
  .catch(err => {
    console.error('Error:', err.message);
    process.exit(1);
  });

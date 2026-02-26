// ============================================
// 📱 SLACK NOTIFY - Sendet ALLE Deals an Slack
// Liest: deals-pending-*.json (power, firecrawl, twitter, telegram, google, gutcheine)
// ============================================
import fs from 'fs';
import { fileURLToPath } from 'url';
import path from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const SLACK_BOT_TOKEN = process.env.SLACK_BOT_TOKEN || '';
const SLACK_CHANNEL_ID = process.env.SLACK_CHANNEL_ID || '';


// Max-Alter: Deals älter als 2 Wochen werden NICHT an Slack gesendet
const TWO_WEEKS_MS = 14 * 24 * 60 * 60 * 1000;
const CUTOFF_DATE = new Date(Date.now() - TWO_WEEKS_MS);
// ============================================
// Helper: Send Message to Slack
// ============================================
async function slackPost(message, threadTs = null) {
  if (!SLACK_BOT_TOKEN || !SLACK_CHANNEL_ID) {
    console.log('⚠️ Slack nicht konfiguriert - überspringe');
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
// Helper: Add reaction to message (so bot can see its own ✅)
// ============================================
async function slackAddReaction(channelId, messageTs, emoji = 'white_check_mark') {
  if (!SLACK_BOT_TOKEN) return false;
  
  const response = await fetch('https://slack.com/api/reactions.add', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${SLACK_BOT_TOKEN}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      channel: channelId,
      timestamp: messageTs,
      name: emoji,
    }),
  });
  const data = await response.json();
  if (!data.ok && data.error !== 'already_reacted') {
    console.log(`   ⚠️ Reaction error: ${data.error}`);
    return false;
  }
  return true;
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
    console.log(`⚠️ ${source} load error: ${e.message}`);
  }
  return [];
}

// ============================================
// Helper: Format deal for Slack
// ============================================
function formatDeal(deal, index, source) {
  const emoji = {
    power: '⚡', firecrawl: '🔥', firecrawl2: '☕', firecrawl3: '🍔',
    super: '🚀', scrapy: '🕷️', web: '🌐', merged: '🔄',
    food3: '🍔', basic1: '🎯', gastro2: '🍕', twitter: '🐦',
    telegram: '💬', google: '📍', gutscheine: '🏷️',
    instagram: '📷',
    'church-gottesdienste': '🕊️', 'church-gemeinde': '⛪', 'church-events': '🎄',
  }[source] || '🎯';

  const typeEmoji = deal.type === 'gratis' ? '🆓' : '💰';
  const title = deal.title || deal.brand || 'Deal';
  const brand = deal.brand || 'Unknown';
  const desc = deal.description ? `\n_${deal.description.substring(0, 80)}_` : '';
  const url = deal.url || '';
  return `${index}. ${typeEmoji} *${title.substring(0, 50)}*${desc}\n${emoji} ${brand} ${url ? `• <${url}|Link>` : ''}`;
}

// ============================================
// ANTI-SPAM: Bereits gesendete Deal-IDs laden
// ============================================
function loadSentIds() {
  const sentPath = path.join(__dirname, '..', 'docs', 'sent-deal-ids.json');
  if (!fs.existsSync(sentPath)) return {};
  try {
    const data = JSON.parse(fs.readFileSync(sentPath, 'utf-8'));
    const cutoff = Date.now() - 7 * 24 * 60 * 60 * 1000;
    const fresh = {};
    for (const [id, ts] of Object.entries(data)) {
      if (ts > cutoff) fresh[id] = ts;
    }
    return fresh;
  } catch(e) {
    return {};
  }
}

function saveSentIds(sentIds) {
  const sentPath = path.join(__dirname, '..', 'docs', 'sent-deal-ids.json');
  fs.writeFileSync(sentPath, JSON.stringify(sentIds, null, 2));
}

async function main() {
  console.log('📱 SLACK NOTIFY - ALL SOURCES');
  console.log('='.repeat(40));

  if (!SLACK_BOT_TOKEN || !SLACK_CHANNEL_ID) {
    console.log('⚠️ SLACK_BOT_TOKEN oder SLACK_CHANNEL_ID fehlt');
    process.exit(0);
  }

  const sources = ['power', 'basic1', 'gastro2', 'food3', 'twitter', 'telegram', 'firecrawl', 'firecrawl2', 'google', 'gutscheine', 'events', 'super', 'scrapy', 'web', 'instagram', 'church-gottesdienste', 'church-gemeinde', 'church-events'];
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

  const sentIds = loadSentIds();
  // Filter 1: Bereits an Slack gesendete Deals rausfiltern
  const unseenDeals = allDeals.filter(d => !sentIds[d.id]);
  
  // Filter 2: Deals älter als 2 Wochen rausfiltern
  const newDeals = unseenDeals.filter(d => {
    const pubDate = d.pubDate ? new Date(d.pubDate) : null;
    if (pubDate && pubDate < CUTOFF_DATE) {
      console.log(`  \u274C Zu alt (\u00FC2W): \"${d.title || d.brand || 'Unbekannt'}\" vom \${pubDate.toLocaleDateString('de-AT')}`);
      return false;
    }
    // Deals ohne pubDate: prüfe validity_date, end_date, expires
    const dateFields = [d.validity_date, d.end_date, d.expires].filter(Boolean);
    for (const field of dateFields) {
      const parsed = new Date(field);
      if (!isNaN(parsed) && parsed < CUTOFF_DATE) {
        console.log(`  \u274C Abgelaufen: "\${d.title || 'Unbekannt'}" (\${field})`);
        return false;
      }
    }
    return true;
  })
  console.log(`\uD83D\uDCEC ${allDeals.length} deals geladen, ${unseenDeals.length} ungesehen, ${unseenDeals.length - newDeals.length} zu alt entfernt, ${newDeals.length} frisch f\u00FCr Slack`);

  if (newDeals.length === 0) {
    console.log('📭 Keine neuen Deals für Slack nach Filterung');
    process.exit(0);
  }

  newDeals.sort((a, b) => {
    if (a.type === 'gratis' && b.type !== 'gratis') return -1;
    if (a.type !== 'gratis' && b.type === 'gratis') return 1;
    return (b.qualityScore || 0) - (a.qualityScore || 0);
  });

  const gratisCount = newDeals.filter(d => d.type === 'gratis').length;
  const otherCount = newDeals.length - gratisCount;
  console.log(`📊 Total: ${newDeals.length} (${gratisCount} gratis, ${otherCount} andere)`);

  const mainMsg = await slackPost(
    `🎯 *FreeFinder Wien* — ${newDeals.length} Deals zum Review\n` +
    `🆓 ${gratisCount}x Gratis • 💰 ${otherCount}x Other\n` +
    `_Reagiere mit ✅ um zu genehmigen_`
  );

  if (!mainMsg) {
    console.log('❌ Konnte Hauptnachricht nicht senden');
    process.exit(1);
  }

  console.log('📤 Sende Deals...');
  for (let i = 0; i < newDeals.length; i++) {
    const deal = newDeals[i];
    const msg = formatDeal(deal, i + 1, deal._source);
    const msgTs = await slackPost(msg, mainMsg);
    if (msgTs) { 
      deal.slackTs = msgTs;
    }
    if (i < newDeals.length - 1) {
      await new Promise(r => setTimeout(r, 2000));
    }
    if ((i + 1) % 10 === 0) {
      console.log(` ${i + 1}/${newDeals.length}...`);
    }
  }

  const sentDeals = newDeals.filter(d => d.slackTs);
  for (const deal of sentDeals) {
    sentIds[deal.id] = Date.now();
  }

      // FIX: deals-pending-all.json schreiben damit approve-deals.js matchen kann
      const pendingAllPath = path.join(__dirname, '..', 'docs', 'deals-pending-all.json');
      const dealsWithTs = sentDeals;
      fs.writeFileSync(pendingAllPath, JSON.stringify({ deals: dealsWithTs, totalDeals: dealsWithTs.length }, null, 2));
      console.log(`💾 ${dealsWithTs.length} Deals mit slackTs in deals-pending-all.json gespeichert`);
  saveSentIds(sentIds);
  console.log(`💾 ${Object.keys(sentIds).length} gesendete Deal-IDs gespeichert`);
  console.log(`✅ ${sentDeals.length} Deals an Slack gesendet!`);
}

main()
  .catch(err => {
    console.error('Error:', err.message);
    process.exit(1);
  });

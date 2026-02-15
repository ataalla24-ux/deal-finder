// ============================================
// 📱 SLACK NOTIFY - Sendet Deals an Slack
// Jeder Deal = eigene Thread-Nachricht
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
  
  return data.ts; // Thread timestamp
}

async function slackReact(channelId, messageTs, emoji = 'white_check_mark') {
  if (!SLACK_BOT_TOKEN) return;

  await fetch('https://slack.com/api/reactions.add', {
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
}

// ============================================
// Main: Send Deals to Slack
// ============================================

async function main() {
  console.log('📱 SLACK NOTIFY');
  console.log('='.repeat(40));

  if (!SLACK_BOT_TOKEN || !SLACK_CHANNEL_ID) {
    console.log('⚠️  SLACK_BOT_TOKEN oder SLACK_CHANNEL_ID fehlt');
    console.log('   Bitte als GitHub Secrets setzen!');
    process.exit(0);
  }

  // Load deals
  const dealsPath = path.join(__dirname, '..', 'docs', 'deals.json');
  let deals = [];
  
  if (fs.existsSync(dealsPath)) {
    const data = JSON.parse(fs.readFileSync(dealsPath, 'utf-8'));
    deals = data.deals || [];
  }

  // Filter: Instagram deals only, sorted by qualityScore
  const igDeals = deals
    .filter(d => d.isInstagramDeal)
    .sort((a, b) => (b.qualityScore || 0) - (a.qualityScore || 0));

  if (igDeals.length === 0) {
    console.log('📭 Keine Instagram Deals gefunden');
    process.exit(0);
  }

  console.log(`📸 ${igDeals.length} Instagram Deals gefunden`);

  // Count by type
  const gratis = igDeals.filter(d => d.title?.toLowerCase().includes('gratis') || d.type === 'gratis');
  const rabatt = igDeals.filter(d => d.type === 'preis' || d.type === 'aktion');
  const gewinnspiel = igDeals.filter(d => d.title?.toLowerCase().includes('gewinn') || d.title?.toLowerCase().includes('verlos'));

  // Send summary
  const today = new Date().toLocaleDateString('de-AT', { 
    day: '2-digit', month: '2-digit', year: 'numeric' 
  });

  const summary = `📸 *FreeFinder Wien — ${igDeals.length} Deals gefunden*
📅 ${today}

🆓 ${gratis.length}x Gratis
💰 ${rabatt.length}x Rabatt
🎰 ${gewinispiel.length}x Gewinnspiel

_Reagiere mit ✅ auf Deals die live gehen sollen!_`;

  console.log('📤 Sende Summary...');
  const mainTs = await slackPost(summary);
  
  if (!mainTs) {
    console.log('❌ Konnte Slack Nachricht nicht senden');
    process.exit(1);
  }

  console.log(`📝 Thread erstellt: ${mainTs}`);

  // Send each deal as thread reply
  console.log('📤 Sende Deals als Thread...');
  
  let sent = 0;
  for (let i = 0; i < igDeals.length; i++) {
    const deal = igDeals[i];
    
    const emoji = deal.title?.toLowerCase().includes('gratis') ? '🆓' : '💰';
    const number = i + 1;
    
    const dealText = `${number}. ${emoji} *${deal.title?.substring(0, 50)}*
_${deal.brand || 'Unknown'}_
📍 ${deal.distance || 'Wien'} | Score: ${deal.qualityScore || '?'}
🔗 ${deal.url || ''}`;

    const ts = await slackPost(dealText, mainTs);
    
    if (ts) {
      sent++;
      // Add reaction to each deal
      await slackReact(SLACK_CHANNEL_ID, ts, 'white_check_mark');
      console.log(`   ${number}. ✅ ${deal.brand}`);
    }

    // Rate limit
    if (i % 10 === 0) {
      await new Promise(r => setTimeout(r, 1000));
    }
  }

  console.log(`\n✅ Fertig! ${sent} Deals an Slack gesendet`);
  console.log(`📝 Thread: https://slack.com/archives/${SLACK_CHANNEL_ID}/${mainTs.replace('.', '')}`);
}

main()
  .catch(err => {
    console.error('Error:', err.message);
    process.exit(1);
  });

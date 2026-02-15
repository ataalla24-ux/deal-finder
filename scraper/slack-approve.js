// ============================================
// ✅ SLACK APPROVE - Liest ✅ Reactions und published Deals
// ============================================

import fs from 'fs';
import { fileURLToPath } from 'url';
import path from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const SLACK_BOT_TOKEN = process.env.SLACK_BOT_TOKEN || '';
const SLACK_CHANNEL_ID = process.env.SLACK_CHANNEL_ID || '';

// ============================================
// Helper: Get messages with reactions
// ============================================

async function slackGetChannelMessages() {
  if (!SLACK_BOT_TOKEN || !SLACK_CHANNEL_ID) {
    console.log('⚠️  Slack nicht konfiguriert');
    return [];
  }

  // Get conversation history
  const response = await fetch(
    `https://slack.com/api/conversations.history?channel=${SLACK_CHANNEL_ID}&limit=50`,
    {
      headers: {
        'Authorization': `Bearer ${SLACK_BOT_TOKEN}`,
      },
    }
  );

  const data = await response.json();
  if (!data.ok) {
    console.log('❌ Error getting messages:', data.error);
    return [];
  }

  return data.messages || [];
}

async function getReactions(channelId, messageTs) {
  if (!SLACK_BOT_TOKEN) return [];

  const response = await fetch(
    `https://slack.com/api/reactions.get?channel=${channelId}&timestamp=${messageTs}`,
    {
      headers: {
        'Authorization': `Bearer ${SLACK_BOT_TOKEN}`,
      },
    }
  );

  const data = await response.json();
  if (!data.ok) return [];

  return data.message?.reactions || [];
}

// ============================================
// Helper: Update deals.json
// ============================================

function updateDealsJson(approvedDeals) {
  const dealsPath = path.join(__dirname, '..', 'docs', 'deals.json');
  
  let existing = { deals: [], totalDeals: 0 };
  if (fs.existsSync(dealsPath)) {
    existing = JSON.parse(fs.readFileSync(dealsPath, 'utf-8'));
  }

  // Remove Instagram deals that are being re-approved (to avoid duplicates)
  const existingIgIds = new Set(existing.deals.map(d => d.id));
  const newDeals = approvedDeals.filter(d => !existingIgIds.has(d.id));

  if (newDeals.length === 0) {
    console.log('📭 Keine neuen Deals zu genehmigen');
    return 0;
  }

  // Add new approved deals
  const allDeals = [...existing.deals, ...newDeals];
  
  // Sort by score and date
  allDeals.sort((a, b) => {
    if (a.qualityScore !== b.qualityScore) {
      return (b.qualityScore || 0) - (a.qualityScore || 0);
    }
    return new Date(b.pubDate || 0) - new Date(a.pubDate || 0);
  });

  // Limit to 100 deals
  const limitedDeals = allDeals.slice(0, 100);

  const result = {
    deals: limitedDeals,
    totalDeals: limitedDeals.length,
    lastUpdated: new Date().toISOString(),
  };

  fs.writeFileSync(dealsPath, JSON.stringify(result, null, 2));
  console.log(`✅ ${newDeals.length} Deals genehmigt und gespeichert`);
  
  return newDeals.length;
}

// ============================================
// Main: Find ✅ reactions and approve deals
// ============================================

async function main() {
  console.log('✅ SLACK APPROVE');
  console.log('='.repeat(40));

  if (!SLACK_BOT_TOKEN || !SLACK_CHANNEL_ID) {
    console.log('⚠️  SLACK_BOT_TOKEN oder SLACK_CHANNEL_ID fehlt');
    process.exit(0);
  }

  // Get messages
  console.log('📥 Lese Slack Nachrichten...');
  const messages = await slackGetChannelMessages();

  if (messages.length === 0) {
    console.log('📭 Keine Nachrichten gefunden');
    process.exit(0);
  }

  // Find the main FreeFinder message (has thread)
  const mainMsg = messages.find(m => 
    m.text?.includes('FreeFinder Wien') && m.thread_ts
  );

  if (!mainMsg) {
    console.log('📭 Kein FreeFinder Thread gefunden');
    process.exit(0);
  }

  console.log(`📝 Thread gefunden: ${mainMsg.ts}`);

  // Get thread replies
  let threadMessages = [mainMsg];
  
  // Try to get thread replies
  try {
    const threadResponse = await fetch(
      `https://slack.com/api/conversations.replies?channel=${SLACK_CHANNEL_ID}&ts=${mainMsg.ts}`,
      {
        headers: {
          'Authorization': `Bearer ${SLACK_BOT_TOKEN}`,
        },
      }
    );
    const threadData = await threadResponse.json();
    if (threadData.ok && threadData.messages) {
      threadMessages = threadData.messages;
    }
  } catch (e) {
    console.log('⚠️  Konnte Thread-Replies nicht laden');
  }

  // Load original deals
  const dealsPath = path.join(__dirname, '..', 'docs', 'deals.json');
  let allDeals = [];
  
  if (fs.existsSync(dealsPath)) {
    const data = JSON.parse(fs.readFileSync(dealsPath, 'utf-8'));
    allDeals = data.deals || [];
  }

  const igDeals = allDeals.filter(d => d.isInstagramDeal);

  // Find messages with ✅ reaction
  console.log('🔍 Suche ✅ Reaktionen...');
  
  let approvedCount = 0;
  const approvedDeals = [];

  for (let i = 1; i < threadMessages.length; i++) {
    const msg = threadMessages[i];
    const reactions = await getReactions(SLACK_CHANNEL_ID, msg.ts);
    
    const hasCheck = reactions.some(r => 
      r.name === 'white_check_mark' || r.name === 'check'
    );

    if (hasCheck) {
      // Extract deal number from message
      const match = msg.text?.match(/^(\d+)\./);
      if (match) {
        const dealIndex = parseInt(match[1]) - 1;
        const deal = igDeals[dealIndex];
        
        if (deal) {
          console.log(`   ✅ Deal ${match[1]}: ${deal.brand} - ${deal.title?.substring(0, 30)}`);
          approvedDeals.push(deal);
          approvedCount++;
        }
      }
    }
  }

  if (approvedCount === 0) {
    console.log('📭 Keine Deals mit ✅ gefunden');
    process.exit(0);
  }

  // Update deals.json
  console.log('\n💾 Speichere genehmigte Deals...');
  updateDealsJson(approvedDeals);

  console.log(`\n✅ Fertig! ${approvedCount} Deals genehmigt`);
}

main()
  .catch(err => {
    console.error('Error:', err.message);
    process.exit(1);
  });

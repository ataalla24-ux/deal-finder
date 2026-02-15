// ============================================
// ✅ SLACK APPROVE - Liest ✅ Reactions und merged in deals.json
// Liest: deals-pending-all.json (wird von slack-notify erstellt)
// ============================================

import fs from 'fs';
import { fileURLToPath } from 'url';
import path from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const SLACK_BOT_TOKEN = process.env.SLACK_BOT_TOKEN || '';
const SLACK_CHANNEL_ID = process.env.SLACK_CHANNEL_ID || '';

// ============================================
// Helper: Get channel messages
// ============================================

async function slackGetChannelMessages() {
  if (!SLACK_BOT_TOKEN || !SLACK_CHANNEL_ID) {
    console.log('⚠️  Slack nicht konfiguriert');
    return [];
  }

  const response = await fetch(
    `https://slack.com/api/conversations.history?channel=${SLACK_CHANNEL_ID}&limit=10`,
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
// Helper: Update deals.json with approved deals
// ============================================

function updateDealsJson(approvedDeals) {
  const dealsPath = path.join(__dirname, '..', 'docs', 'deals.json');
  
  let existing = { deals: [], totalDeals: 0 };
  if (fs.existsSync(dealsPath)) {
    existing = JSON.parse(fs.readFileSync(dealsPath, 'utf-8'));
  }

  // Add new approved deals
  const allDeals = [...existing.deals, ...approvedDeals];
  
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
  
  // Clear pending files
  const pendingFiles = ['power', 'instagram', 'firecrawl', 'google'];
  for (const source of pendingFiles) {
    const pendingPath = path.join(__dirname, '..', 'docs', `deals-pending-${source}.json`);
    if (fs.existsSync(pendingPath)) {
      fs.writeFileSync(pendingPath, JSON.stringify({ deals: [], totalDeals: 0 }, null, 2));
    }
  }
  
  console.log(`✅ ${approvedDeals.length} Deals genehmigt, Pending-Cleared gelöscht`);
  
  return approvedDeals.length;
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

  // Find the main FreeFinder message
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

  // Check main message for ✅
  const mainHasCheck = mainMsg.reactions?.some(r => r.name === 'white_check_mark');
  
  let approvedCount = 0;
  const approvedDeals = [];
  
  if (mainHasCheck) {
    // ✅ on main = approve all deals from pending files
    console.log('✅ ✅ auf Hauptnachricht - genehmige ALLE!');
    
    // Load all pending deals
    const sources = ['power', 'instagram', 'firecrawl', 'google'];
    for (const source of sources) {
      const pendingPath = path.join(__dirname, '..', 'docs', `deals-pending-${source}.json`);
      try {
        if (fs.existsSync(pendingPath)) {
          const data = JSON.parse(fs.readFileSync(pendingPath, 'utf-8'));
          const deals = (data.deals || []).map(d => ({...d, _source: source}));
          approvedDeals.push(...deals);
          console.log(`   ${source}: ${deals.length} Deals`);
        }
      } catch (e) {
        console.log(`   ${source}: Fehler`);
      }
    }
    approvedCount = approvedDeals.length;
  } else {
    // Look for individual ✅ on deals
    console.log('🔍 Suche einzelne ✅ Reaktionen...');
    
    for (let i = 1; i < threadMessages.length; i++) {
      const msg = threadMessages[i];
      const reactions = await getReactions(SLACK_CHANNEL_ID, msg.ts);
      
      const hasCheck = reactions.some(r => 
        r.name === 'white_check_mark' || r.name === 'check'
      );

      if (hasCheck) {
        // Parse deal from message
        const text = msg.text || '';
        const match = text.match(/^\d+\.\s+.*?\*([^*]+)\*/);
        if (match) {
          const title = match[1].replace(/[:*#]/g, '').trim();
          const brandMatch = text.match(/\_(.+?)(?:$|\||\•)/);
          const brand = brandMatch ? brandMatch[1].replace(/[^a-zA-ZäöüÄÖÜß\s]/g, '').trim() : 'Unknown';
          
          approvedDeals.push({
            id: `approved-${Date.now()}-${i}`,
            brand: brand.substring(0, 30),
            title: title.substring(0, 50),
            description: 'Genehmigt via Slack ✅',
            type: text.includes('🆓') ? 'gratis' : 'rabatt',
            category: 'food',
            source: 'Slack Approved',
            url: 'https://instagram.com',
            expires: 'Unbekannt',
            distance: 'Wien',
            hot: false,
            isNew: true,
            isInstagramDeal: true,
            priority: 5,
            votes: 1,
            qualityScore: 50,
            pubDate: new Date().toISOString(),
          });
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

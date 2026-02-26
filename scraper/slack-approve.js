// ============================================
// ✅ SLACK APPROVE – Liest ✅ Reaktionen und ersetzt deals.json
// Liest: deals-pending-all.json (wird von slack-notify erstellt)
// REPLACE MODE: Approved Deals ersetzen alle alten Deals komplett
// Kategorien: kaffee, essen, fitness, reisen, supermarkt, beauty, technik,
//             streaming, wien, gemeinde, gottesdienste, events, gratis,
//             shopping, kultur, kirche
// ============================================

import fs from 'fs';
import { fileURLToPath } from 'url';
import path from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function loadEnvFile() {
              const envPath = path.join(__dirname, '..', '.env');
              if (!fs.existsSync(envPath)) return;
              const lines = fs.readFileSync(envPath, 'utf-8').split(/\r?\n/);
              for (const line of lines) {
                              const trimmed = line.trim();
                              if (!trimmed || trimmed.startsWith('#')) continue;
                              const eq = trimmed.indexOf('=');
                              if (eq <= 0) continue;
                              const key = trimmed.slice(0, eq).trim();
                              let value = trimmed.slice(eq + 1).trim();
                              if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
                                                value = value.slice(1, -1);
                              }
                              if (!(key in process.env)) process.env[key] = value;
              }
}

loadEnvFile();

const SLACK_BOT_TOKEN = process.env.SLACK_BOT_TOKEN || '';
const SLACK_CHANNEL_ID = process.env.SLACK_CHANNEL_ID || '';

// ============================================
// Kategorie-Erkennung – alle App-Kategorien
// ============================================
function detectCategory(text, url, brand, title) {
              const combined = (text + ' ' + (url || '') + ' ' + (brand || '') + ' ' + (title || '')).toLowerCase();

  // Kirche / Religion / Gemeinde (hohe Priorität – vor events)
  if (/gottesdienst|gottesdienste|sunday service|worship service|sonntag.*service|andacht|bibelstunde|bibel.*stunde|predigt|taufe|abendmahl|communion/.test(combined)) return 'gottesdienste';
              if (/gemeinde|kirchengemeinde|pfarrgemeinde|evangelische.*gemeinde|katholische.*gemeinde|freie.*gemeinde|baptisten|pfingstgemeinde|adventisten|cvjm|christliche.*gemeinschaft|christliches.*zentrum/.test(combined)) return 'gemeinde';
              if (/kirche|church|kathedrale|kapelle|dom|basilika|moschee|synagoge|tempel|glauben|glaube|gebet|beten|jesus|gott|heilig|pastor|pfarrer|priester|seelsorge|christlich|christliche/.test(combined)) return 'kirche';

  // Streaming / Digital
  if (/netflix|spotify|disney|amazon prime|hbo|apple tv|dazn|paramount|peacock|streaming|abo.*gratis|gratis.*abo|probemonat/.test(combined)) return 'streaming';
              // Technik
  if (/mediamarkt|saturn|apple|samsung|sony|computer|laptop|handy|smartphone|tablet|iphone|android|technik|elektronik|gadget|headphones|kopfhörer/.test(combined)) return 'technik';
              // Kaffee
  if (/kaffee|coffee|cafe|café|espresso|cappuccino|latte|nespresso|starbucks|tchibo|coffein/.test(combined)) return 'kaffee';
              // Essen
  if (/restaurant|essen|food|burger|pizza|kebab|sushi|vegan|lunch|dinner|frühstück|breakfast|bistecca|gastro|lokal|wirt|speise|mahlzeit|mjam|lieferando|mcdonalds|burger king|kfc|subway|nordsee|vapiano/.test(combined)) return 'essen';
              // Fitness
  if (/fitness|sport|gym|training|yoga|pilates|crossfit|john harris|clever fit|fitinn|holmes|sportverein|laufen|marathon/.test(combined)) return 'fitness';
              // Reisen
  if (/reisen|travel|flug|flight|hotel|urlaub|vacation|flixbus|ryanair|öbb|bahn|zug|airbnb|hostel/.test(combined)) return 'reisen';
              // Supermarkt
  if (/supermarkt|hofer|penny|billa|spar|lidl|merkur|lebensmittel|grocery|rewe|aldi/.test(combined)) return 'supermarkt';
              // Beauty
  if (/beauty|spa|wellness|massage|kosmetik|friseur|haare|nails|parfum|dm|rossmann|douglas|müller/.test(combined)) return 'beauty';
              // Shopping
  if (/shopping|mode|fashion|kleidung|h&m|zara|about you|decathlon|mediamarkt|saturn|ikea|amazon/.test(combined)) return 'shopping';
              // Kultur
  if (/museum|ausstellung|exhibition|theater|konzert|festival|kino|film|kunst|kultur|galerie|burgtheater|volksoper|albertina|kunsthistorisches/.test(combined)) return 'kultur';
              // Events (allgemein)
  if (/event|veranstaltung|party|club|bar|nightlife|messe|markt|stadtfest/.test(combined)) return 'events';
              // Gratis
  if (/gratis|free|freebie|kostenlos|umsonst/.test(combined)) return 'gratis';

  return 'wien';
}

// ============================================
// Type-Erkennung (gratis / rabatt / testabo)
// ============================================
function detectType(text, title) {
              const combined = (text + ' ' + (title || '')).toLowerCase();
              if (/gratis|free|freebie|kostenlos|umsonst|verschenk|schenk|0\s*€|0 euro/.test(combined)) return 'gratis';
              if (/testabo|probe|trial|1 monat gratis|monat kostenlos|30 tage/.test(combined)) return 'testabo';
              return 'rabatt';
}

// ============================================
// Emoji pro Kategorie – alle App-Kategorien
// ============================================
function getCategoryEmoji(category) {
              const map = {
                              kaffee: '☕', essen: '🍔', fitness: '💪', kultur: '🏛️',
                              shopping: '🛍️', reisen: '✈️', supermarkt: '🛒', beauty: '💅',
                              events: '🎭', gratis: '🎁', wien: '🏛️', technik: '📱',
                              streaming: '📺', gemeinde: '⛪', gottesdienste: '🕊️', kirche: '⛪'
              };
              return map[category] || '🎯';
}

// ============================================
// Adresse / Location aus Text extrahieren
// ============================================
function extractLocation(text) {
              const streetMatch = text.match(/([A-ZÄÖÜ][a-zäöü]+(?:straße|gasse|platz|ring|gürtel|allee|weg|zeile|markt)\s+\d+[a-z]?(?:\s+\d{4}\s+Wien)?)/i);
              if (streetMatch) return streetMatch[1].trim();

  const bezirkMatch = text.match(/(\d{1,2}\.?\s*Bezirk|\d{4}\s*Wien)/i);
              if (bezirkMatch) return bezirkMatch[1].trim() + ', Wien';

  const knownPlaces = [
                  'Mariahilfer Straße', 'Kärntner Straße', 'Graben', 'Kohlmarkt',
                  'Prater', 'Naschmarkt', 'Westbahnhof', 'Hauptbahnhof', 'Stephansplatz',
                  'Rathausplatz', 'Museumsquartier', 'Schwedenplatz', 'Favoriten',
                  'Ottakring', 'Floridsdorf', 'Donaustadt', 'Brigittenau', 'Meidling',
                  'Währing', 'Hernals', 'Rudolfsheim', 'Penzing', 'Hietzing', 'Liesing'
                ];
              for (const place of knownPlaces) {
                              if (text.toLowerCase().includes(place.toLowerCase())) {
                                                return place + ', Wien';
                              }
              }
              return 'Wien';
}

// ============================================
// Description aus Slack-Text extrahieren
// ============================================
function extractDescription(text) {
              if (!text) return '';
              let cleaned = text.replace(/<([^|>]+)\|([^>]+)>/g, '$2');
              cleaned = cleaned.replace(/<(https?:\/\/[^>]+)>/g, '');
              cleaned = cleaned.replace(/^[\u{1F300}-\u{1FFFF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}🎁🎯✅⭐💰🔥🎉🏷️📍🕐⛪🕊️]+\s*/gu, '');
              cleaned = cleaned.replace(/\s+/g, ' ').trim();
              if (cleaned.length > 150) {
                              const dot = cleaned.indexOf('.', 60);
                              if (dot > 0 && dot < 150) {
                                                cleaned = cleaned.substring(0, dot + 1);
                              } else {
                                                cleaned = cleaned.substring(0, 150) + '...';
                              }
              }
              return cleaned;
}

// ============================================
// Echte URL aus Slack-Text extrahieren
// ============================================
function extractUrl(text) {
              if (!text) return '';
              const slackLinkMatch = text.match(/<(https?:\/\/[^|>]+)(?:\|[^>]*)?>/);
              if (slackLinkMatch) {
                              const url = slackLinkMatch[1];
                              if (url === 'https://www.instagram.com' || url === 'https://instagram.com') return '';
                              return url;
              }
              const directMatch = text.match(/(https?:\/\/[^\s<>]+)/);
              if (directMatch) {
                              const url = directMatch[1];
                              if (url === 'https://www.instagram.com' || url === 'https://instagram.com') return '';
                              return url;
              }
              return '';
}

// ============================================
// Brand / Restaurant aus Text extrahieren
// ============================================
function extractBrand(text, title) {
              const combined = (text + ' ' + (title || '')).toLowerCase();
              const knownBrands = [
                              'Starbucks', 'IKEA', "McDonald's", 'Burger King', 'Subway', 'KFC',
                              'Nespresso', 'Tchibo', 'Billa', 'Spar', 'Hofer', 'Penny', 'Lidl', 'Merkur',
                              'H&M', 'Zara', 'About You', 'Decathlon', 'MediaMarkt', 'Saturn',
                              'dm', 'Rossmann', 'Müller', 'Douglas',
                              'John Harris', 'Clever Fit', 'FitInn', 'Holmes Place',
                              'Flixbus', 'ÖBB', 'Ryanair',
                              'Bistecca Fiorentina', 'Vapiano', 'Nordsee', 'Wienerwald',
                              'Manner', 'Zotter', 'Meinl', 'Volksgarten', 'Prater',
                              'Burgtheater', 'Musikverein', 'Albertina',
                              'Netflix', 'Spotify', 'Disney', 'Amazon', 'Apple'
                            ];
              for (const brand of knownBrands) {
                              if (combined.includes(brand.toLowerCase())) {
                                                return brand;
                              }
              }
              const atMatch = (text + ' ' + (title || '')).match(/@([A-Za-z0-9_.]{2,30})/);
              if (atMatch) {
                              return '@' + atMatch[1];
              }
              const capsMatch = (text + ' ' + (title || '')).match(/\b([A-ZÄÖÜ][a-zäöü]{2,}(?:\s[A-ZÄÖÜ][a-zäöü]{2,})?)\b/);
              if (capsMatch && capsMatch[1] !== 'Wien' && capsMatch[1] !== 'Gratis' && capsMatch[1] !== 'Deal') {
                              return capsMatch[1];
              }
              return 'Wien Deals';
}

// ============================================
// Quality Score berechnen
// ============================================
function computeQualityScore(deal) {
              let score = 30;
              if (deal.url && deal.url.length > 20 && !deal.url.includes('instagram.com/\n')) score += 20;
              if (deal.description && deal.description.length > 30) score += 15;
              if (deal.brand && deal.brand !== 'Wien Deals' && deal.brand !== 'instagram.com') score += 10;
              if (deal.distance && deal.distance !== 'Wien') score += 10;
              if (deal.type === 'gratis') score += 10;
              if (deal.logo && deal.logo !== '🎯') score += 5;
              return Math.min(100, score);
}

// ============================================
// Slack API Helfer
// ============================================
async function getMessages(channelId, limit = 200) {
              const response = await fetch(
                              `https://slack.com/api/conversations.history?channel=${channelId}&limit=${limit}`,
                          {
                                            headers: {
                                                                'Authorization': `Bearer ${SLACK_BOT_TOKEN}`,
                                            },
                          }
                            );
              const data = await response.json();
              if (!data.ok) {
                              console.log(`❌ Slack conversations.history error: ${data.error || 'unknown'}`);
                              return [];
              }
              return data.messages || [];
}

async function getReactions(channelId, messageTs, attempt = 0) {
              try {
                              const response = await fetch(
                                                `https://slack.com/api/reactions.get?channel=${channelId}&timestamp=${messageTs}`,
                                          {
                                                              headers: {
                                                                                    'Authorization': `Bearer ${SLACK_BOT_TOKEN}`,
                                                              },
                                          }
                                              );
                              const data = await response.json();
                              if (data.ok && data.message?.reactions) {
                                                return data.message.reactions;
                              }
                              if (data.error === 'ratelimited') {
                                                const waitTime = parseInt(data.retry_after || 2) * 1000;
                                                console.log(`  ⏳ Rate limited, waiting ${waitTime}ms...`);
                                                await new Promise(r => setTimeout(r, waitTime));
                                                if (attempt < 3) {
                                                              return getReactions(channelId, messageTs, attempt + 1);
                                                }
                              }
              } catch(e) {
                              console.log(`  ⚠️ Error getting reactions: ${e.message}`);
              }
              return [];
}

// ============================================
// Helper: Check if a HUMAN user (not a bot) added ✅
// Bot user IDs typically start with B or are the bot's own ID
// ============================================
async function getBotUserId() {
              try {
                              const response = await fetch('https://slack.com/api/auth.test', {
                                                headers: { 'Authorization': `Bearer ${SLACK_BOT_TOKEN}` },
                              });
                              const data = await response.json();
                              if (data.ok) return data.user_id;
              } catch(e) {
                              console.log(`  ⚠️ Could not get bot user ID: ${e.message}`);
              }
              return null;
}

function hasHumanCheckmark(reactions, botUserId) {
              const checkmarkReactions = reactions.filter(r =>
                              r.name === 'white_check_mark' || r.name === 'heavy_check_mark' || r.name === 'check'
                                                            );
              for (const reaction of checkmarkReactions) {
                              const users = reaction.users || [];
                              // Check if any user OTHER than the bot reacted
                const humanUsers = users.filter(u => u !== botUserId);
                              if (humanUsers.length > 0) return true;
              }
              return false;
}

// ============================================
// Helper: Update deals.json (REPLACE MODE)
// ============================================
function updateDealsJson(approvedDeals) {
              const dealsPath = path.join(__dirname, '..', 'docs', 'deals.json');

  // REPLACE MODE: Nur die neu approvedeten Deals kommen auf die App
  const allDeals = [...approvedDeals];
              allDeals.sort((a, b) => {
                              if (a.qualityScore !== b.qualityScore) {
                                                return (b.qualityScore || 0) - (a.qualityScore || 0);
                              }
                              return new Date(b.pubDate || 0) - new Date(a.pubDate || 0);
              });
              const limitedDeals = allDeals.slice(0, 100);

  const result = {
                  deals: limitedDeals,
                  totalDeals: limitedDeals.length,
                  lastUpdated: new Date().toISOString(),
  };
              fs.writeFileSync(dealsPath, JSON.stringify(result, null, 2));

  const pendingFiles = ['deals-pending-all.json'];
              for (const source of pendingFiles) {
                              const pendingPath = path.join(__dirname, '..', 'docs', source);
                              if (fs.existsSync(pendingPath)) {
                                                fs.writeFileSync(pendingPath, JSON.stringify({ deals: [], totalDeals: 0 }, null, 2));
                              }
              }

  console.log(`✅ deals.json ERSETZT mit ${limitedDeals.length} approvedeten Deals (REPLACE MODE)`);
              console.log(`🗑️ Alte Deals wurden verworfen`);
}

// ============================================
// MAIN
// ============================================
async function main() {
              console.log('🔍 Lade Slack-Nachrichten...');

  if (!SLACK_BOT_TOKEN || !SLACK_CHANNEL_ID) {
                  console.log('❌ SLACK_BOT_TOKEN oder SLACK_CHANNEL_ID fehlt (ENV oder .env)');
                  process.exit(1);
  }

  // Get bot's own user ID so we can ignore bot reactions
  const botUserId = await getBotUserId();
              console.log(`🤖 Bot User ID: ${botUserId || 'unknown'}`);
  
  // Load ALL pending deals from ALL deals-pending-*.json files
  const docsDir = path.join(__dirname, '..', 'docs');
              let pendingDeals = [];

  try {
                  const files = fs.readdirSync(docsDir);
                  const pendingFiles = files.filter(f =>
                                    f.startsWith('deals-pending-') && f.endsWith('.json') && !f.includes('-merged')
                                                        );
                  console.log(`📂 Found ${pendingFiles.length} pending deal files`);

                for (const file of pendingFiles) {
                                  try {
                                                      const raw = fs.readFileSync(path.join(docsDir, file), 'utf-8');
                                                      const parsed = JSON.parse(raw);
                                                      const deals = parsed.deals || [];
                                                      pendingDeals = pendingDeals.concat(deals);
                                                      console.log(`  - ${file}: ${deals.length} deals`);
                                  } catch(e) {
                                                      console.log(`  ⚠️ Error reading ${file}: ${e.message}`);
                                  }
                }
                  console.log(`📋 Total: ${pendingDeals.length} pending Deals geladen`);
  } catch(e) {
                  console.log('⚠️ Fehler beim Laden der pending Deals:', e.message);
  }

  const approvedDeals = [];
              const approvedTimestamps = new Set();
              const usedPendingDealIds = new Set();

  // Fast path: only check reactions for pending deals that were actually posted to Slack.
  // This avoids scanning thousands of old channel messages and hitting rate limits.
  const pendingByTs = new Map();
              for (const d of pendingDeals) {
                              if (d.slackTs && !pendingByTs.has(d.slackTs)) pendingByTs.set(d.slackTs, d);
              }

  if (pendingByTs.size > 0) {
                  console.log(`🎯 Targeted mode: prüfe ${pendingByTs.size} pending slackTs`);
                  let checked = 0;
                  for (const [messageTs, pendingDeal] of pendingByTs.entries()) {
                                const reactions = await getReactions(SLACK_CHANNEL_ID, messageTs);
                                const isHumanApproved = hasHumanCheckmark(reactions, botUserId);
                                if (!isHumanApproved) continue;
                                if (approvedTimestamps.has(messageTs)) continue;
                                approvedTimestamps.add(messageTs);

                                const enriched = { ...pendingDeal, slackTs: messageTs };
                                enriched.qualityScore = computeQualityScore(enriched);
                                approvedDeals.push(enriched);
                                usedPendingDealIds.add(pendingDeal.id);

                                checked++;
                                if (checked % 25 === 0) console.log(`  ✅ geprüft: ${checked}/${pendingByTs.size}`);
                                await new Promise(r => setTimeout(r, 150));
                  }
  } else {
                  // Fallback: broad scan (legacy mode)
                  const messages = await getMessages(SLACK_CHANNEL_ID, 200);
                  console.log(`📨 ${messages.length} Nachrichten gefunden`);
                  let allMessages = [...messages];
                  for (const msg of messages) {
                                if (msg.reply_count && msg.reply_count > 0) {
                                              try {
                                                                  const rRes = await fetch(`https://slack.com/api/conversations.replies?channel=${SLACK_CHANNEL_ID}&ts=${msg.ts}&limit=200`, { headers: { 'Authorization': `Bearer ${SLACK_BOT_TOKEN}` } });
                                                                  const rData = await rRes.json();
                                                                  if (rData.ok && rData.messages) {
                                                                                  const replies = rData.messages.slice(1);
                                                                                  allMessages = allMessages.concat(replies);
                                                                  }
                                                                  await new Promise(r => setTimeout(r, 300));
                                              } catch(e) { console.log(`  Thread error: ${e.message}`); }
                                }
                  }
                  console.log(`Total: ${allMessages.length} messages (inkl. Thread-Replies)`);

                  for (const message of allMessages) {
                  const messageTs = message.ts;
                  const text = message.text || '';

                // Prefer reactions already included in message payload to avoid
                // thousands of extra API calls and Slack rate limits.
                const reactions = Array.isArray(message.reactions) ? message.reactions : [];

                // FIX: Only count ✅ from HUMAN users, not from the bot itself
                const isHumanApproved = hasHumanCheckmark(reactions, botUserId);

                if (!isHumanApproved) continue;

                if (approvedTimestamps.has(messageTs)) continue;
                  approvedTimestamps.add(messageTs);

                // Try multiple matching strategies
                const messageUrl = extractUrl(text);
                  const messageBrand = extractBrand(text, '').toLowerCase();

                const availableDeals = pendingDeals.filter(d => !usedPendingDealIds.has(d.id));

                // Strategy 1: Match by slackTs (if available)
                let matchedDeal = availableDeals.find(d => d.slackTs && d.slackTs === messageTs);

                // Strategy 2: Match by URL
                if (!matchedDeal && messageUrl) {
                                  try {
                                                      const parsedUrl = new URL(messageUrl);
                                                      matchedDeal = availableDeals.find(d => d.url && d.url.includes(parsedUrl.pathname));
                                  } catch(e) {
                                                      // Invalid URL, skip this strategy
                                  }
                }

                // Strategy 3: Match by brand in title/description
                if (!matchedDeal && messageBrand && messageBrand !== 'wien deals') {
                                  matchedDeal = availableDeals.find(d => {
                                                      const dealBrand = (d.brand || '').toLowerCase();
                                                      return dealBrand.includes(messageBrand) || messageBrand.includes(dealBrand);
                                  });
                }

                // Strategy 4: Match by title keywords
                if (!matchedDeal) {
                                  const titleMatch = text.match(/\*([^*]+)\*/);
                                  if (titleMatch) {
                                                      const titleKeyword = titleMatch[1].toLowerCase().substring(0, 20);
                                                      matchedDeal = availableDeals.find(d => {
                                                                            const dealTitle = (d.title || '').toLowerCase();
                                                                            const dealBrand = (d.brand || '').toLowerCase();
                                                                            return dealTitle.includes(titleKeyword) || dealBrand.includes(titleKeyword);
                                                      });
                                  }
                }

                if (matchedDeal) {
                                  const url = extractUrl(text) || matchedDeal.url || '';
                                  const brand = extractBrand(text, matchedDeal.title) || matchedDeal.brand || 'Wien Deals';
                                  const description = matchedDeal.description || extractDescription(text);
                                  const category = detectCategory(text, url, brand, matchedDeal.title) || matchedDeal.category || 'wien';
                                  const type = detectType(text, matchedDeal.title) || matchedDeal.type || 'rabatt';
                                  const location = matchedDeal.distance !== 'Wien' ? matchedDeal.distance : extractLocation(text);
                                  const logo = getCategoryEmoji(category);

                    const enriched = {
                                        ...matchedDeal,
                                        url: url || matchedDeal.url,
                                        brand,
                                        description,
                                        category,
                                        type,
                                        distance: location,
                                        logo,
                                        slackTs: messageTs,
                    };
                                  enriched.qualityScore = computeQualityScore(enriched);
                                  approvedDeals.push(enriched);
                                  usedPendingDealIds.add(matchedDeal.id);
                } else {
                                  const url = extractUrl(text);
                                  const brand = extractBrand(text, '');
                                  const description = extractDescription(text);
                                  const category = detectCategory(text, url, brand, '');
                                  const type = detectType(text, '');
                                  const location = extractLocation(text);
                                  const logo = getCategoryEmoji(category);
                                  const title = brand !== 'Wien Deals'
                                    ? `${brand} Deal`
                                                      : description.substring(0, 50) || 'Wien Deal';

                    const deal = {
                                        id: `slack-${messageTs}`,
                                        title,
                                        description,
                                        brand,
                                        url: url || 'https://www.wien.gv.at',
                                        logo,
                                        category,
                                        type,
                                        distance: location,
                                        source: 'Wien Deals',
                                        pubDate: new Date(parseFloat(messageTs) * 1000).toISOString(),
                                        qualityScore: 0,
                                        slackTs: messageTs,
                    };
                                  deal.qualityScore = computeQualityScore(deal);
                                  approvedDeals.push(deal);
                }

                                // Small delay between API calls
                                await new Promise(r => setTimeout(r, 200));
                  }
  }

  console.log(`✅ ${approvedDeals.length} Deals approved`);

  if (approvedDeals.length === 0) {
                  console.log('⚠️ Keine approvedeten Deals gefunden – deals.json bleibt unverändert');
                  return;
  }

  const seen = new Set();
              const uniqueDeals = approvedDeals.filter(d => {
                              const key = d.id || d.slackTs || d.url || d.title;
                              if (seen.has(key)) return false;
                              seen.add(key);
                              return true;
              });

  console.log(`🔄 ${uniqueDeals.length} unique Deals nach Deduplizierung`);

  const catCount = {};
              for (const d of uniqueDeals) {
                              catCount[d.category] = (catCount[d.category] || 0) + 1;
              }
              console.log('📊 Kategorien:', JSON.stringify(catCount));

  const typeCount = {};
              for (const d of uniqueDeals) {
                              typeCount[d.type] = (typeCount[d.type] || 0) + 1;
              }
              console.log('📊 Types:', JSON.stringify(typeCount));

  updateDealsJson(uniqueDeals);
}

main()

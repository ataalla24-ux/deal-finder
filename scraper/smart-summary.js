import '../sentry/instrument.mjs';
// ============================================
// SMART ZUSAMMENFASSUNG FÜR DEALS
// 100% Kostenlos - Keine API nötig!
// ============================================

import fs from 'fs';

// ============================================
// INTELLIGENTE TEXT-OPTIMIERUNG
// ============================================

// Überflüssige Wörter die entfernt werden
const FILLER_WORDS = [
  'jetzt', 'aktuell', 'gerade', 'heute', 'neu', 'brandneu',
  'einfach', 'schnell', 'direkt', 'sofort', 'gleich',
  'super', 'mega', 'ultra', 'total', 'echt', 'wirklich',
  'bei uns', 'für euch', 'für dich', 'für sie',
  'ab sofort', 'nur noch', 'nicht verpassen',
  'unbedingt', 'unglaublich', 'sensationell', 'fantastisch',
  'hier gibt es', 'es gibt', 'man bekommt', 'ihr bekommt',
  'schaut vorbei', 'vorbeischauen', 'reinschauen',
];

// Emoji-Mapping für Kategorien
const CATEGORY_EMOJIS = {
  kaffee: '☕',
  essen: '🍔',
  supermarkt: '🛒',
  beauty: '💄',
  technik: '📱',
  mode: '👕',
  mobilität: '🚌',
  streaming: '📺',
  finanzen: '💰',
  wien: '🏛️',
  shopping: '🛍️',
  gratis: '🎁'
};

// Keyword-basierte Emojis
const KEYWORD_EMOJIS = {
  'kaffee': '☕',
  'coffee': '☕',
  'latte': '☕',
  'cappuccino': '☕',
  'pizza': '🍕',
  'burger': '🍔',
  'döner': '🥙',
  'sushi': '🍣',
  'eis': '🍦',
  'bier': '🍺',
  'wein': '🍷',
  'kuchen': '🍰',
  'croissant': '🥐',
  'brot': '🥖',
  'haarschnitt': '💇',
  'friseur': '💇',
  'kosmetik': '💄',
  'parfum': '🧴',
  'handy': '📱',
  'smartphone': '📱',
  'laptop': '💻',
  'netflix': '📺',
  'spotify': '🎵',
  'zug': '🚂',
  'u-bahn': '🚇',
  'scooter': '🛴',
  'museum': '🏛️',
  'kino': '🎬',
  'konzert': '🎵',
  'geburtstag': '🎂',
  'gratis': '🆓',
  'kostenlos': '🆓',
  'geschenkt': '🎁',
  '50%': '🔥',
  'rabatt': '💰',
  'sparen': '💵',
};

// ============================================
// ZUSAMMENFASSUNGS-FUNKTION
// ============================================

function smartSummarize(deal) {
  let text = deal.description || deal.title || '';
  
  // 1. HTML Tags entfernen
  text = text.replace(/<[^>]*>/g, '');
  
  // 2. Mehrfache Leerzeichen normalisieren
  text = text.replace(/\s+/g, ' ').trim();
  
  // 3. Filler-Wörter entfernen (case-insensitive)
  FILLER_WORDS.forEach(filler => {
    const regex = new RegExp(`\\b${filler}\\b`, 'gi');
    text = text.replace(regex, '');
  });
  
  // 4. Doppelte Leerzeichen nach Entfernung
  text = text.replace(/\s+/g, ' ').trim();
  
  // 5. Ersten Satz extrahieren (oft der wichtigste)
  const firstSentence = text.split(/[.!?]/)[0];
  if (firstSentence && firstSentence.length > 20) {
    text = firstSentence;
  }
  
  // 6. Auf maximale Länge kürzen
  const maxLength = 80;
  if (text.length > maxLength) {
    // Am Wortende abschneiden
    text = text.substring(0, maxLength);
    const lastSpace = text.lastIndexOf(' ');
    if (lastSpace > 40) {
      text = text.substring(0, lastSpace);
    }
    text += '...';
  }
  
  // 7. Passendes Emoji finden
  let emoji = CATEGORY_EMOJIS[deal.category] || '🎁';
  
  // Keyword-basiertes Emoji (überschreibt Kategorie wenn spezifischer)
  const lowerText = (deal.title + ' ' + deal.description).toLowerCase();
  for (const [keyword, keyEmoji] of Object.entries(KEYWORD_EMOJIS)) {
    if (lowerText.includes(keyword)) {
      emoji = keyEmoji;
      break;
    }
  }
  
  // 8. Emoji am Anfang hinzufügen (wenn noch nicht vorhanden)
  const hasEmoji = /[\u{1F300}-\u{1F9FF}]|[\u{2600}-\u{26FF}]/u.test(text.substring(0, 2));
  if (!hasEmoji) {
    text = `${emoji} ${text}`;
  }
  
  // 9. Ersten Buchstaben groß
  text = text.charAt(0).toUpperCase() + text.slice(1);
  
  return text;
}

// ============================================
// DEALS VERARBEITEN
// ============================================

function processDeals(deals) {
  console.log(`\n🔄 Optimiere ${deals.length} Deal-Beschreibungen...\n`);
  
  let improved = 0;
  
  for (const deal of deals) {
    const original = deal.description;
    
    // Nur optimieren wenn Beschreibung lang oder unklar ist
    if (original && original.length > 60) {
      deal.description = smartSummarize(deal);
      
      if (deal.description !== original) {
        improved++;
        if (improved <= 10) { // Zeige nur erste 10
          console.log(`✨ ${deal.brand}: ${deal.description.substring(0, 50)}...`);
        }
      }
    }
  }
  
  console.log(`\n✅ ${improved} Beschreibungen optimiert\n`);
  
  return deals;
}

// ============================================
// MAIN
// ============================================

async function main() {
  console.log('📝 SMART ZUSAMMENFASSUNG gestartet...\n');
  console.log('💡 100% kostenlos - keine API nötig!\n');
  
  // Load existing deals
  const dealsPath = 'docs/deals.json';
  if (!fs.existsSync(dealsPath)) {
    console.log('❌ docs/deals.json nicht gefunden');
    process.exit(1);
  }
  
  const data = JSON.parse(fs.readFileSync(dealsPath, 'utf8'));
  console.log(`📦 ${data.deals.length} Deals geladen\n`);
  
  // Process deals
  data.deals = processDeals(data.deals);
  data.lastUpdated = new Date().toISOString();
  
  // Save
  fs.writeFileSync(dealsPath, JSON.stringify(data, null, 2));
  console.log('💾 Deals mit optimierten Beschreibungen gespeichert');
}

// Run
main().catch(console.error);

// Export for use in other scripts
export { smartSummarize, processDeals };

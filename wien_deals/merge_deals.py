#!/usr/bin/env python3
"""
Merge and Deduplicate Deals from Multiple Sources
Kombiniert alle pending-deals und entfernt Duplikate
"""
import json
import os
import re
from datetime import datetime, timedelta
from pathlib import Path

DOCS_DIR = Path('docs')
OUTPUT_FILE = DOCS_DIR / 'deals-pending-merged.json'

# Priority order (higher = more trustworthy)
SOURCE_PRIORITY = {
    'firecrawl': 100,
    'firecrawl2': 95,
    'firecrawl3': 90,
    'super': 80,
    'gastro2': 70,
    'food3': 65,
    'power': 60,
    'basic1': 55,
    'scrapy': 50,
    'web': 45,
    'gutscheine': 40,
    'google': 35,
    'twitter': 30,
    'telegram': 25,
    'events': 20,
}

def load_deals(source_file):
    """Lade Deals aus einer JSON-Datei"""
    filepath = DOCS_DIR / f'{source_file}.json'
    if not filepath.exists():
        return []
    
    try:
        with open(filepath, 'r', encoding='utf-8') as f:
            data = json.load(f)
        
        if isinstance(data, dict):
            deals = data.get('deals', [])
        elif isinstance(data, list):
            deals = data
        else:
            return []
        
        # Füge Source hinzu falls nicht vorhanden
        for deal in deals:
            if 'source' not in deal:
                deal['source'] = source_file
        
        return deals
    except Exception as e:
        print(f"⚠️ Fehler beim Laden von {source_file}: {e}")
        return []

def parse_expiry_date(expires_text):
    """Parse expiry date from various formats"""
    if not expires_text:
        return None
    
    expires_lower = expires_text.lower().strip()
    today = datetime.now()
    current_year = today.year
    current_month = today.month
    current_day = today.day
    
    # Pattern: "DD.MM." or "DD.MM.YYYY"
    match = re.search(r'(\d{1,2})\.(\d{1,2})\.?(\d{0,4})?', expires_lower)
    if match:
        day = int(match.group(1))
        month = int(match.group(2))
        year = int(match.group(3)) if match.group(3) else current_year
        
        # If only 2 digits for year, assume 20xx
        if year < 100:
            year = 2000 + year
        
        try:
            return datetime(year, month, day)
        except:
            pass
    
    # Pattern: "heute" = today
    if 'heute' in expires_lower:
        return today
    
    # Pattern: "morgen" = tomorrow
    if 'morgen' in expires_lower:
        return today + timedelta(days=1)
    
    # Pattern: "gültig bis"
    if 'gültig bis' in expires_lower:
        # Try to extract date after "gültig bis"
        match = re.search(r'gültig bis[:\s]*(\d{1,2})\.(\d{1,2})', expires_lower)
        if match:
            day = int(match.group(1))
            month = int(match.group(2))
            try:
                return datetime(current_year, month, day)
            except:
                pass
    
    # Pattern: numbers like "19.02" - check if this year's date is past
    match = re.search(r'(\d{1,2})\.(\d{1,2})$', expires_lower.strip())
    if match:
        day = int(match.group(1))
        month = int(match.group(2))
        
        # Try this year
        try:
            date_this_year = datetime(current_year, month, day)
            if date_this_year >= today - timedelta(days=1):
                return date_this_year
        except:
            pass
        
        # Try next year (if date was in early months and now is later in year)
        try:
            date_next_year = datetime(current_year + 1, month, day)
            if date_next_year >= today:
                return date_next_year
        except:
            pass
    
    return None

def is_expired(deal):
    """Prüfe ob Deal abgelaufen ist"""
    # Check pubDate first
    pub_date = deal.get('pubDate', '')
    if pub_date:
        try:
            # Parse ISO date
            pub_dt = datetime.fromisoformat(pub_date.replace('Z', '+00:00'))
            # If published more than 7 days ago, consider expired
            if (datetime.now() - pub_dt.replace(tzinfo=None)) > timedelta(days=7):
                return True
        except:
            pass
    
    # Check expiry date
    expires = deal.get('expires', '')
    if expires:
        expiry_dt = parse_expiry_date(expires)
        if expiry_dt:
            # If expiry date is in the past, it's expired
            if expiry_dt < datetime.now() - timedelta(days=1):
                return True
            # If expiry is more than 30 days in future, probably not relevant
            if expiry_dt > datetime.now() + timedelta(days=30):
                return True
    
    # Check if title/description mentions past tense or old dates
    title = deal.get('title', '').lower()
    desc = deal.get('description', '').lower()
    text = f"{title} {desc}"
    
    # Explicit past indicators
    past_indicators = [
        r'war\s', r'waren\s', r'vorbei', r'abgelaufen',
        r'leider\s', r'schade\s', r'vor\s+gestern',
        r'\d+\.\d+\.\d{2,4}\s+war'
    ]
    
    for pattern in past_indicators:
        if re.search(pattern, text):
            # Check if it's not a future date mentioned
            if not re.search(r'\d{1,2}\.\d{1,2}\.\d{2,4}', text):
                return True
    
    return False

def is_future_deal(deal):
    """Check if deal is for future date (valid upcoming deal)"""
    expires = deal.get('expires', '')
    if not expires:
        return False
    
    # If it mentions specific future dates, it's a future deal
    future_patterns = [
        r'nächste[rn]?\s+\w+',  # nächste Woche, nächster Monat
        r'\d{1,2}\.\d{1,2}\.\d{2,4}',  # future date like 25.02.26
        r'ab\s+\d{1,2}\.\d{1,2}',  # ab 25.02
    ]
    
    expires_lower = expires.lower()
    for pattern in future_patterns:
        if re.search(pattern, expires_lower):
            # Verify it's actually in the future
            expiry_dt = parse_expiry_date(expires)
            if expiry_dt and expiry_dt >= datetime.now():
                return True
    
    return False

def normalize_deal_key(deal):
    """Erstelle normalisierten Key für Dedup"""
    # Normalisiere: lowercase, remove special chars
    title = deal.get('title', '').lower()
    url = deal.get('url', '').lower()
    brand = deal.get('brand', '').lower()
    
    # Entferne Zahlen aus URLs (timestamps, etc)
    url = re.sub(r'\d+', '', url)
    
    # Erstelle Key - nutze Domain aus URL als Teil
    url_domain = ''
    if 'instagram' in url:
        url_domain = 'ig'
    elif 'willhaben' in url:
        url_domain = 'wh'
    elif '1000things' in url:
        url_domain = '1000'
    
    key = f"{brand[:20]}|{title[:30]}|{url_domain}"
    return key

def deduplicate_and_merge(all_deals):
    """Dedup und sortiere nach Priority"""
    seen_keys = {}
    unique_deals = []
    expired_count = 0
    future_count = 0
    
    for deal in all_deals:
        # Check if expired
        if is_expired(deal):
            expired_count += 1
            continue
        
        # Track future deals
        if is_future_deal(deal):
            future_count += 1
            deal['isFuture'] = True
        
        key = normalize_deal_key(deal)
        
        if key not in seen_keys:
            seen_keys[key] = deal
            unique_deals.append(deal)
        else:
            # Behalte den mit höherer Priority
            existing = seen_keys[key]
            existing_priority = SOURCE_PRIORITY.get(existing.get('source', ''), 0)
            new_priority = SOURCE_PRIORITY.get(deal.get('source', ''), 0)
            
            if new_priority > existing_priority:
                seen_keys[key] = deal
                # Ersetze in unique_deals
                idx = unique_deals.index(existing)
                unique_deals[idx] = deal
    
    print(f"   🗑️ Abgelaufen: {expired_count}")
    print(f"   ⏰ Zukünftig: {future_count}")
    
    return unique_deals

def main():
    print("🔄 Merge & Dedup Deals")
    print("=" * 40)
    
    # Lade alle Sources
    sources = [
        'deals-pending-firecrawl',
        'deals-pending-firecrawl2', 
        'deals-pending-firecrawl3',
        'deals-pending-super',
        'deals-pending-gastro2',
        'deals-pending-food3',
        'deals-pending-power',
        'deals-pending-basic1',
        'deals-pending-scrapy',
        'deals-pending-web',
        'deals-pending-gutscheine',
        'deals-pending-google',
    ]
    
    all_deals = []
    
    for source in sources:
        # Remove 'deals-pending-' prefix for file lookup
        source_name = source.replace('deals-pending-', '')
        deals = load_deals(source)
        if deals:
            print(f"📂 {source_name}: {len(deals)} Deals")
            all_deals.extend(deals)
    
    print(f"\n📊 Total geladen: {len(all_deals)} Deals")
    
    # Dedup + Filter expired
    unique_deals = deduplicate_and_merge(all_deals)
    print(f"📊 Nach Dedup & Filter: {len(unique_deals)} Deals")
    
    # Sortiere nach Quality Score + Future Deals nach hinten
    def sort_key(deal):
        score = deal.get('qualityScore', 50)
        # Future deals get lower priority
        if deal.get('isFuture', False):
            score -= 30
        return score
    
    unique_deals.sort(key=sort_key, reverse=True)
    
    # Limitiere auf Top 100
    final_deals = unique_deals[:100]
    
    # Speichern
    output = {
        'lastUpdated': datetime.now().isoformat(),
        'source': 'merged',
        'totalDeals': len(final_deals),
        'deals': final_deals
    }
    
    with open(OUTPUT_FILE, 'w', encoding='utf-8') as f:
        json.dump(output, f, ensure_ascii=False, indent=2)
    
    # Stats
    by_source = {}
    for deal in final_deals:
        src = deal.get('source', 'unknown')
        by_source[src] = by_source.get(src, 0) + 1
    
    print(f"\n📈 Nach Source:")
    for src, count in sorted(by_source.items(), key=lambda x: -x[1]):
        print(f"   {src}: {count}")
    
    print(f"\n💾 Gespeichert: {OUTPUT_FILE}")

if __name__ == '__main__':
    main()

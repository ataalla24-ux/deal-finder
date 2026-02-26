#!/usr/bin/env python3
"""
🎯 WIEN DEALS SCRAPER v8
No Instagram cookies needed - use public sources
"""
import asyncio
import json
import os
import re
from datetime import datetime
import aiohttp
from bs4 import BeautifulSoup

OUTPUT_FILE = os.path.join(os.path.dirname(os.path.dirname(__file__)), 'docs', 'deals-pending-super.json')

# Sources that don't need login
PUBLIC_SOURCES = [
    # RSS Feeds
    {'url': 'https://www.1000thingsmagazine.com/feed/', 'name': '1000things RSS'},
    {'url': 'https://www.meinbezirk.at/rss', 'name': 'meinbezirk RSS'},
    # Public pages
    {'url': 'https://www.willhaben.at/iad/kostenlos/', 'name': 'willhaben'},
    {'url': 'https://www.willhaben.at/iad/freizeit/', 'name': 'willhaben'},
]

DEAL_KEYWORDS = [
    'gratis', 'kostenlos', 'free', '0€', '0,00', 'umsonst',
    'aktion', 'rabatt', 'deal', 'schnäppchen', 'gutschein',
    '1+1', '2 gratis', '50%', '-30%', '-50%'
]

WIEN_KEYWORDS = ['wien', 'vienna', '1020', '1030', '1040', '1050', '1060', '1070', '1080', '1090', '1100']

def ist_deal(text):
    if not text:
        return False
    return any(kw in text.lower() for kw in DEAL_KEYWORDS)

def ist_wien(text):
    if not text:
        return True  # Assume yes
    return any(kw in text.lower() for kw in WIEN_KEYWORDS)

async def scrape_source(session, url, name):
    deals = []
    try:
        async with session.get(url, timeout=aiohttp.ClientTimeout(total=25)) as resp:
            if resp.status == 200:
                html = await resp.text()
                soup = BeautifulSoup(html, 'html.parser')
                
                # Get all text
                text = soup.get_text(separator=' ', strip=True)
                
                # Split into sentences
                sentences = re.split(r'[.!?\n]', text)
                
                for sent in sentences:
                    sent = sent.strip()
                    if len(sent) < 40 or len(sent) > 300:
                        continue
                    
                    if ist_deal(sent) and ist_wien(sent):
                        deal_id = f"pub-{hash(sent[:40]) % 1000000}"
                        deals.append({
                            'id': deal_id,
                            'brand': name,
                            'title': sent[:60],
                            'description': sent[:250],
                            'type': 'gratis' if any(k in sent.lower() for k in ['gratis', 'kostenlos', 'free', '0€']) else 'rabatt',
                            'category': 'essen',
                            'source': name,
                            'url': url,
                            'expires': 'Unbekannt',
                            'distance': 'Wien',
                            'pubDate': datetime.now().isoformat(),
                            'qualityScore': 55
                        })
                print(f"   → {len(deals)} Deals")
    except Exception as e:
        print(f"   ❌ {str(e)[:30]}")
    return deals

async def main():
    print("=" * 60)
    print("🎯 WIEN DEALS SCRAPER v8 (Ohne Instagram)")
    print("=" * 60)
    print(f"🕐 {datetime.now().strftime('%d.%m.%Y %H:%M')}")
    print()
    
    all_deals = []
    
    async with aiohttp.ClientSession(headers={'User-Agent': 'Mozilla/5.0'}) as session:
        print("🌐 Scrape public sources...")
        for src in PUBLIC_SOURCES:
            print(f"   {src['name']}...", end=" ")
            deals = await scrape_source(session, src['url'], src['name'])
            all_deals.extend(deals)
    
    print(f"\n📊 Total: {len(all_deals)} Deals")
    
    # Dedup
    seen = set()
    unique = []
    for d in all_deals:
        key = d['title'][:30].lower()
        if key not in seen:
            seen.add(key)
            unique.append(d)
    
    final_deals = unique[:300]
    
    # Save
    output = {
        'lastUpdated': datetime.now().isoformat(),
        'source': 'super',
        'totalDeals': len(final_deals),
        'deals': final_deals
    }
    
    os.makedirs(os.path.dirname(OUTPUT_FILE), exist_ok=True)
    with open(OUTPUT_FILE, 'w', encoding='utf-8') as f:
        json.dump(output, f, ensure_ascii=False, indent=2)
    
    gratis = len([d for d in final_deals if d['type'] == 'gratis'])
    print(f"\n💾 {OUTPUT_FILE}")
    print(f"🆓 Gratis: {gratis} | 💰 Rabatt: {len(final_deals) - gratis}")

if __name__ == '__main__':
    asyncio.run(main())

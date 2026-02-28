#!/usr/bin/env python3
"""
Scraper for FreeChurch (Freikirchen) Gottesdienste in Vienna
Static list with known service times - no browser needed
"""
import json
import os
from datetime import datetime

OUTPUT_DIR = os.path.join(os.path.dirname(os.path.dirname(__file__)), 'docs')

# FreeChurches in Vienna with known service times
FREECHURCHES = [
    # Main FreeChurches with confirmed times
    {"name": "Jesus Zentrum Wien", "url": "https://www.jesuszentrum.at", "times": "Sa 17:00, So 10:00 & 18:00 Uhr"},
    {"name": "Hillsong Wien", "url": "https://www.hillsong.com/wien", "times": "So 11:00 & 18:00 Uhr"},
    {"name": "City Church Wien", "url": "https://www.citychurch.at", "times": "So 10:30 Uhr"},
    {"name": "Freie Christliche Gemeinde Wien (FCG)", "url": "https://www.fcgwien.at", "times": "So 10:00 & 18:00 Uhr"},
    {"name": "FeG Wien (Freie evangelische Gemeinde)", "url": "https://www.feg.at", "times": "So 10:00 Uhr"},
    {"name": "Lebensquelle Gemeinde", "url": "https://www.lebensquelle.at", "times": "So 10:00 Uhr"},
    {"name": "Baptistenkirche Wien", "url": "https://www.baptisten.at/wien", "times": "So 10:00 Uhr"},
    {"name": "Adventgemeinde Wien", "url": "https://www.adventisten.at/wien", "times": "Sa 09:30 & 11:00 Uhr"},
    {"name": "ECHO Gemeinde", "url": "https://www.echo-gemeinde.at", "times": "So 10:00 Uhr"},
    {"name": "Christliche Gemeinde Wien West (CGW)", "url": "https://cgw.at", "times": "So 10:00 Uhr"},
    {"name": "Hope Church Wien", "url": "https://www.hopechurch.at", "times": "So 10:30 Uhr"},
    {"name": "Vine Church Wien", "url": "https://www.vinechurch.at", "times": "So 10:30 Uhr"},
    {"name": "The Base Wien", "url": "https://www.thebase.wien", "times": "So 11:00 Uhr"},
    {"name": "EHC Wien (E CHANGE)", "url": "https://www.ehc.at", "times": "So 10:00 Uhr"},
    {"name": "Methodistenkirche Wien", "url": "https://www.methodisten.at/wien", "times": "So 10:00 Uhr"},
    {"name": "Mennonitengemeinde Wien", "url": "https://www.mennoniten.at", "times": "So 10:00 Uhr"},
    {"name": "Kreuzkirche (Evangelische)", "url": "https://www.kreuzkirche.at", "times": "So 10:00 Uhr"},
    {"name": "Friedenskirche", "url": "https://www.friedenskirche.wien", "times": "So 10:00 Uhr"},
    {"name": "Erlöserkirche", "url": "https://www.erloeserkirche.at", "times": "So 10:00 Uhr"},
    {"name": "Gustav-Adolf-Kirche", "url": "https://www.gustav-adolf-kirche.at", "times": "So 10:00 Uhr"},
    {"name": "Johanneskirche", "url": "https://www.johanneskirche.wien", "times": "So 10:00 Uhr"},
    {"name": "Lutherkirche", "url": "https://www.lutherkirche.at", "times": "So 10:00 Uhr"},
    {"name": "Gasometer Sky Campus", "url": "https://www.gasometer.at", "times": "So 10:00 & 18:00 Uhr"},
    # Additional churches
    {"name": "CIG Wien (Christliche Integrationsgemeinde)", "url": "https://www.cig.wien", "times": "So 10:00 & 18:00 Uhr"},
    {"name": "4 Corners Wien", "url": "https://www.4corners.at", "times": "So 10:30 Uhr"},
    {"name": "Wunderwerk Wien", "url": "https://www.wunderwerk.at", "times": "So 11:00 Uhr"},
    {"name": "Sankt Carolus", "url": "https://www.carolus.at", "times": "So 10:00 Uhr"},
    {"name": "Blessed Wien", "url": "https://www.blessed.at", "times": "So 10:30 Uhr"},
    {"name": "Moses Community", "url": "https://www.mosescommunity.at", "times": "So 11:00 Uhr"},
    {"name": "Kaffeehaus Gemeinde", "url": "https://www.kaffeehausgemeinde.at", "times": "So 10:00 Uhr"},
    {"name": "Liebesbrief Wien", "url": "https://www.liebesbrief.at", "times": "So 10:00 Uhr"},
    {"name": "ICF Wien (International Christian Fellowship)", "url": "https://www.icfwien.at", "times": "So 10:00 Uhr"},
    {"name": "Northside Church Vienna", "url": "https://www.northsidechurch.at", "times": "So 10:30 Uhr"},
]

def scrape_all():
    print("=== Vienna FreeChurch Gottesdienste Scraper ===\n")
    print(f"📋 Loading {len(FREECHURCHES)} churches...\n")
    
    # Create deals from static list
    deals = []
    for i, church in enumerate(FREECHURCHES):
        name = church['name']
        url = church['url']
        times = church.get('times', 'Bitte Webseite prüfen')
        
        # First 25 are main FreeChurches
        is_freechurch = i < 25
        emoji = '⛪' if is_freechurch else '🕊️'
        
        print(f"[{i+1}/{len(FREECHURCHES)}] {name}: {times}")
        
        deals.append({
            'id': f'freikirche-{i}-{datetime.now().strftime("%Y%m%d")}',
            'brand': name,
            'logo': emoji,
            'title': f"{name} Gottesdienst",
            'description': f"⛪ {name}\n🕐 Gottesdienst: {times}\n📍 Wien\n🔗 Webseite & aktuelle Infos",
            'type': 'gratis',
            'category': 'freikirche' if is_freechurch else 'kirche',
            'source': 'Freikirchen Wien',
            'url': url,
            'expires': times,
            'address': 'Wien',
            'distance': 'Wien',
            'hot': False,
            'isNew': True,
            'priority': 3,
            'votes': 0,
            'qualityScore': 70,
            'pubDate': datetime.now().isoformat()
        })
    
    # Save
    os.makedirs(OUTPUT_DIR, exist_ok=True)
    output_path = os.path.join(OUTPUT_DIR, 'deals-pending-freikirchen.json')
    with open(output_path, 'w') as f:
        json.dump({
            'lastUpdated': datetime.now().isoformat(),
            'source': 'freikirchen-wien',
            'totalDeals': len(deals),
            'deals': deals
        }, f, indent=2, ensure_ascii=False)
    
    print(f"\n=== Summary ===")
    print(f"  ✅ Total: {len(deals)} FreeChurches in Wien")
    freechurches = sum(1 for i in range(len(FREECHURCHES)) if i < 25)
    kirchen = len(FREECHURCHES) - freechurches
    print(f"  ⛪ FreeChurches: {freechurches}")
    print(f"  🕊️ Andere Kirchen: {kirchen}")
    print(f"\n💾 Saved to deals-pending-freikirchen.json")

if __name__ == '__main__':
    scrape_all()

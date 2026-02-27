#!/usr/bin/env python3
"""
Scraper for Churches, Communities and Christian Events in Vienna
Properly categorizes into: Gemeinde, Gottesdienste, Events
"""
import asyncio
import json
import os
import re
from datetime import datetime

OUTPUT_DIR = os.path.join(os.path.dirname(os.path.dirname(__file__)), 'docs')

# Churches with service times (Gottesdienste)
CHURCHES_GOTTESDIENSTE = [
    {"name": "Jesus Zentrum Wien", "url": "https://www.jesuszentrum.at", "times": "Samstag 17:00 Uhr"},
    {"name": "Gasometer Sky Campus", "url": "https://www.gasometer.at", "times": "Sonntag 10:00 & 18:00 Uhr"},
    {"name": "St. Stephen's Cathedral (Stephansdom)", "url": "https://www.stephansdom.at", "times": "Mo-So 06:00-22:00 Uhr"},
    {"name": "Karlskirche", "url": "https://www.karlskirche.at", "times": "Mo-So 09:00-18:00 Uhr"},
    {"name": "Votivkirche", "url": "https://www.votivkirche.at", "times": "Di-So 10:00-18:00 Uhr"},
    {"name": "Peterskirche", "url": "https://www.peterskirche.at", "times": "Mo-So 07:00-20:00 Uhr"},
    {"name": "Ruprechtskirche", "url": "https://de.wikipedia.org/wiki/Ruprechtskirche", "times": "Sa 10:00-13:00 Uhr"},
    {"name": "Michaelerkirche", "url": "https://www.michaelerkirche.at", "times": "Mo-So 08:00-18:00 Uhr"},
    {"name": "Augustinerkirche", "url": "https://www.augustinerkirche.at", "times": "Mo-So 07:00-19:00 Uhr"},
    {"name": "Kreuzkirche (Evangelische)", "url": "https://www.kreuzkirche.at", "times": "So 10:00 Uhr"},
    {"name": "Gustav-Adolf-Kirche", "url": "https://www.gustav-adolf-kirche.at", "times": "So 10:00 Uhr"},
    {"name": "Johanneskirche", "url": "https://www.johanneskirche.wien", "times": "So 10:00 Uhr"},
    {"name": "Lutherkirche", "url": "https://www.lutherkirche.at", "times": "So 10:00 Uhr"},
    {"name": "Wiener Stadttempel (Synagoge)", "url": "https://www.israelit.at", "times": "Fr 18:00 Uhr"},
    {"name": "Friedenskirche", "url": "https://www.friedenskirche.wien", "times": "So 10:00 Uhr"},
    {"name": "Erlöserkirche", "url": "https://www.erloeserkirche.at", "times": "So 10:00 Uhr"},
    {"name": "Baptistenkirche Wien", "url": "https://www.baptisten.at/wien", "times": "So 10:00 Uhr"},
    {"name": "Freie Christliche Gemeinde Wien", "url": "https://www.fcgwien.at", "times": "So 10:00 & 18:00 Uhr"},
    {"name": "Adventgemeinde Wien", "url": "https://www.adventisten.at/wien", "times": "Sa 09:30 & 11:00 Uhr"},
    {"name": "Mennonitengemeinde Wien", "url": "https://www.mennoniten.at", "times": "So 10:00 Uhr"},
    {"name": "Methodistenkirche Wien", "url": "https://www.methodisten.at/wien", "times": "So 10:00 Uhr"},
    {"name": "Serbisch-Orthodoxe Kirche", "url": "https://www.spc.at", "times": "So 10:00 Uhr"},
    {"name": "Russisch-Orthodoxe Kirche", "url": "https://www.russianorthodox.at", "times": "So 10:00 Uhr"},
    {"name": "Greek Orthodox Church", "url": "https://www.orthodoxie.at", "times": "So 11:00 Uhr"},
    {"name": "Hillsong Wien", "url": "https://www.hillsong.com/wien", "times": "So 11:00 Uhr"},
    {"name": "City Church Wien", "url": "https://www.citychurch.at", "times": "So 10:30 Uhr"},
    {"name": "Lebensquelle Gemeinde", "url": "https://www.lebensquelle.at", "times": "So 10:00 Uhr"},
    {"name": "FeG Wien", "url": "https://www.feg.at", "times": "So 10:00 Uhr"},
    {"name": "ECHO Gemeinde", "url": "https://www.echo-gemeinde.at", "times": "So 10:00 Uhr"},
    {"name": "Christliche Gemeinde Wien West", "url": "https://cgw.at", "times": "So 10:00 Uhr"},
]

# Christian communities (Gemeinde) - no events, just regular communities
CHURCHES_GEMEINDE = [
    {"name": "Jesus Zentrum Wien", "url": "https://www.jesuszentrum.at"},
    {"name": "Gasometer Sky Campus", "url": "https://www.gasometer.at"},
    {"name": "Kreuzkirche (Evangelische)", "url": "https://www.kreuzkirche.at"},
    {"name": "Gustav-Adolf-Kirche", "url": "https://www.gustav-adolf-kirche.at"},
    {"name": "Johanneskirche", "url": "https://www.johanneskirche.wien"},
    {"name": "Lutherkirche", "url": "https://www.lutherkirche.at"},
    {"name": "Friedenskirche", "url": "https://www.friedenskirche.wien"},
    {"name": "Erlöserkirche", "url": "https://www.erloeserkirche.at"},
    {"name": "Baptistenkirche Wien", "url": "https://www.baptisten.at/wien"},
    {"name": "Freie Christliche Gemeinde Wien", "url": "https://www.fcgwien.at"},
    {"name": "Adventgemeinde Wien", "url": "https://www.adventisten.at/wien"},
    {"name": "Mennonitengemeinde Wien", "url": "https://www.mennoniten.at"},
    {"name": "Methodistenkirche Wien", "url": "https://www.methodisten.at/wien"},
    {"name": "Hillsong Wien", "url": "https://www.hillsong.com/wien"},
    {"name": "City Church Wien", "url": "https://www.citychurch.at"},
    {"name": "Lebensquelle Gemeinde", "url": "https://www.lebensquelle.at"},
    {"name": "FeG Wien", "url": "https://www.feg.at"},
    {"name": "ECHO Gemeinde", "url": "https://www.echo-gemeinde.at"},
    {"name": "Christliche Gemeinde Wien West", "url": "https://cgw.at"},
    {"name": "EHC Wien (E CHANGE)", "url": "https://www.ehc.at"},
    {"name": "Hope Church Wien", "url": "https://www.hopechurch.at"},
    {"name": "Vine Church Wien", "url": "https://www.vinechurch.at"},
    {"name": "The Base Wien", "url": "https://www.thebase.wien"},
    {"name": "Kreative Gemeinde Wien", "url": "https://www.kreative-gemeinde.at"},
]

# Christian events (Events)
CHRISTIAN_EVENTS = [
    {"name": "Himmelstürmer", "url": "https://www.himmelstuermer.at", "description": "Christliches Festival für junge Menschen"},
    {"name": "Christkindlmarkt am Karlsplatz", "url": "https://www.karlskirche.at", "description": "Weihnachtsmarkt"},
    {"name": "Donauinselfest ( christlicher Teil)", "url": "https://www.donauinselfest.at", "description": "Großes Open-Air Festival"},
    {"name": "Hope Festival", "url": "https://www.hopfestival.at", "description": "Christliches Musikfestival"},
    {"name": "Night of Hope", "url": "https://www.nightofhope.at", "description": "Evangelistisches Event"},
    {"name": "Easter Festival", "url": "https://www.easterfestival.at", "description": "Oster-Festival"},
    {"name": "Gospel Festival Wien", "url": "https://www.gospelfestival.at", "description": "Gospel Musik Festival"},
    {"name": "Lange Nacht der Kirchen", "url": "https://www.langenachtderkirchen.at", "description": "Kirchen öffnen Nachts"},
    {"name": "Wiener Christkindlmarkt", "url": "https://www.wienerchristkindlmarkt.at", "description": "Weihnachtsmarkt"},
    {"name": "Glaube und Kultur Tage", "url": "https://www.glaube-kultur.at", "description": "Kulturelle Veranstaltungen"},
    {"name": "Freiwilliges Obdachlosen-Essen", "url": "https://www.caritas-wien.at", "description": "Essensausgabe für Obdachlose"},
    {"name": "Tafel Austria", "url": "https://www.tafel.at", "description": "Lebensmittel für Bedürftige"},
    {"name": "Streetwork Wien", "url": "https://www.streetwork.at", "description": "Hilfe für Obdachlose"},
    {"name": "Heilsarmee Wien", "url": "www.heilsarmee.at/wien", "description": "Soziale Dienste"},
    {"name": "Diakonie Flüchtlingshilfe", "url": "https://www.diakonie.at", "description": "Hilfe für Flüchtlinge"},
    {"name": "Malteser Hilfswerk", "url": "https://www.malteser.at", "description": "Soziale Hilfsdienste"},
    {"name": "Johiter Hilfsgemeinschaft", "url": "https://www.johanniter.at", "description": "Erste Hilfe und Soziales"},
    {"name": "Betlehem Wien", "url": "https://www.betlehem-wien.at", "description": "Christliche Organisation"},
    {"name": "Open Doors", "url": "https://www.opendoors.at", "description": "Christliche Hilfsorganisation"},
    {"name": "Brot für die Welt", "url": "https://www.brot-fuer-die-welt.at", "description": "Entwicklungshilfe"},
]

def create_deals(data_list, category, logo, has_times=False):
    deals = []
    for i, item in enumerate(data_list):
        name = item.get('name', 'Unknown')
        url = item.get('url', 'https://www.wien.gv.at')
        times = item.get('times', '')
        description = item.get('description', '')
        
        if has_times and times:
            title = f"⏰ {times}"
            desc = f"📍 {name}\n🕐 {times}"
        elif description:
            title = description
            desc = f"📍 {name}\n{description}"
        else:
            title = f"⭐ Gemeinde"
            desc = f"📍 {name} - Wien"
        
        deals.append({
            'id': f'{category}-{i}-{datetime.now().strftime("%Y%m%d")}',
            'brand': name[:30],
            'logo': logo,
            'title': title,
            'description': desc,
            'type': 'gratis',
            'category': category,
            'source': 'Kirchen Verzeichnis',
            'url': url,
            'expires': times if has_times else 'Regelmäßig',
            'distance': 'Wien',
            'hot': False,
            'isNew': True,
            'priority': 3,
            'votes': 0,
            'qualityScore': 50,
            'pubDate': datetime.now().isoformat()
        })
    return deals

async def scrape_all():
    print("=== Vienna Churches & Events Scraper ===\n")
    
    # 1. Create Gemeinde deals (just communities)
    print("1. Creating Gemeinde deals...")
    gemeinde_deals = create_deals(CHURCHES_GEMEINDE, 'gemeinde', '⛪', has_times=False)
    print(f"   ✓ {len(gemeinde_deals)} Gemeinden")
    
    # 2. Create Gottesdienste deals (with times)
    print("2. Creating Gottesdienste deals...")
    gottesdienst_deals = create_deals(CHURCHES_GOTTESDIENSTE, 'gottesdienste', '🕊️', has_times=True)
    print(f"   ✓ {len(gottesdienst_deals)} Gottesdienste")
    
    # 3. Create Events deals
    print("3. Creating Events deals...")
    events_deals = create_deals(CHRISTIAN_EVENTS, 'events', '🎭', has_times=False)
    print(f"   ✓ {len(events_deals)} Events")
    
    # Save all to different files
    os.makedirs(OUTPUT_DIR, exist_ok=True)
    
    # Save Gemeinde
    with open(os.path.join(OUTPUT_DIR, 'deals-pending-church-gemeinde.json'), 'w') as f:
        json.dump({
            'lastUpdated': datetime.now().isoformat(),
            'source': 'kirchen-wien',
            'totalDeals': len(gemeinde_deals),
            'deals': gemeinde_deals
        }, f, indent=2, ensure_ascii=False)
    print(f"\n💾 Saved {len(gemeinde_deals)} to deals-pending-gemeinde.json")
    
    # Save Gottesdienste
    with open(os.path.join(OUTPUT_DIR, 'deals-pending-church-gottesdienste.json'), 'w') as f:
        json.dump({
            'lastUpdated': datetime.now().isoformat(),
            'source': 'kirchen-wien',
            'totalDeals': len(gottesdienst_deals),
            'deals': gottesdienst_deals
        }, f, indent=2, ensure_ascii=False)
    print(f"💾 Saved {len(gottesdienst_deals)} to deals-pending-gottesdienste.json")
    
    # Save Events
    with open(os.path.join(OUTPUT_DIR, 'deals-pending-church-events.json'), 'w') as f:
        json.dump({
            'lastUpdated': datetime.now().isoformat(),
            'source': 'kirchen-wien',
            'totalDeals': len(events_deals),
            'deals': events_deals
        }, f, indent=2, ensure_ascii=False)
    print(f"💾 Saved {len(events_deals)} to deals-pending-events.json")
    
    print("\n=== Summary ===")
    print(f"  Gemeinde: {len(gemeinde_deals)}")
    print(f"  Gottesdienste: {len(gottesdienst_deals)}")
    print(f"  Events: {len(events_deals)}")
    print(f"  Total: {len(gemeinde_deals) + len(gottesdienst_deals) + len(events_deals)}")

if __name__ == '__main__':
    asyncio.run(scrape_all())

#!/usr/bin/env python3
"""
Intelligentes Instagram Deal Scraper System
"""

import json
import re
from datetime import datetime

# Die 30 wichtigsten Hashtags
HASHTAGS = [
    "wiengratis", "aktionwien", "angebotwien", "gewinnspielwien",
    "foodsharingwien", "wienfood", "wienevents", "wienjetzt",
    "wienfree", "foodsharing", "gratisfuerdich", "gratisminuten",
    "lebensmittelrettungwien", "wiengutschein", "wien",
    "wienrestaurant", "wiencafe", "wienbar", "wienparty", 
    "wiennightlife", "wienclub", "kostenloswien", "gratiswien",
    "dealwien", "rabattwien", "sparwien", "gutscheinwien",
    "wienliebe", "wien4free", "viennadeals"
]

# Keywords
DEAL_KEYWORDS = [
    "gratis", "kostenlos", "free", "0€", "aktion", "rabatt", 
    "gewinnspiel", "gewinnen", "deal", "statt", "%", "reduziert"
]

WIEN_KEYWORDS = [
    "wien", "vienna", "1020", "1010", "1030", "1040", "1050", "1060",
    "1070", "1080", "1090", "1100", "1110", "1120", "1130", "1140",
    "1150", "1160", "1170", "1180", "1190", "1200"
]

# Daten die noch aktuell sind
AKTUELL_PATTERNS = [
    "19.02", "20.02", "21.02", "22.02", "23.02", "24.02", "25.02", 
    "26.02", "27.02", "28.02", "heute", "morgen", "gültig", "2026"
]

def ist_relevant(text):
    """Prüft ob der Post relevant ist"""
    if not text:
        return False
    text_lower = text.lower()
    
    # Deal-Keyword + (Wien ODER aktuell)
    has_deal = any(kw in text_lower for kw in DEAL_KEYWORDS)
    has_wien = any(kw in text_lower for kw in WIEN_KEYWORDS)
    has_aktuell = any(p in text for p in AKTUELL_PATTERNS)
    
    return has_deal and (has_wien or has_aktuell)

def kategorisiere(text):
    """Ordnet den Deal einer Kategorie zu"""
    text_lower = text.lower()
    
    if any(k in text_lower for k in ["essen", "food", "restaurant", "kaffee", "cappuccino", " brunch"]):
        return "FOOD"
    if any(k in text_lower for k in ["drink", "bier", "cocktail", "bar", "spritzer", "wein"]):
        return "DRINKS"
    if any(k in text_lower for k in ["party", "disco", "event", "konzert", "festival", "tickets", "eintritt"]):
        return "EVENTS"
    if any(k in text_lower for k in ["shop", "einkauf", "fashion", "kleidung"]):
        return "SHOPPING"
    
    return "OTHER"

# Resultate
results = {
    "FOOD": [],
    "DRINKS": [],
    "EVENTS": [],
    "SHOPPING": [],
    "OTHER": []
}

print("=" * 60)
print("🎯 INTELLIGENTER WIEN DEAL SCRAPER")
print("=" * 60)
print(f"📊 Hashtags: {len(HASHTAGS)}")
print(f"🕐 Gestartet: {datetime.now().strftime('%H:%M')}")
print()

# Das Script wartet auf die gescrapeten Daten
# Nach dem Scrapen wird analyze_post() aufgerufen

def add_deal(text, hashtag, url):
    """Fügt einen Deal hinzu"""
    if ist_relevant(text):
        kat = kategorisiere(text)
        results[kat].append({
            "hashtag": hashtag,
            "text": text[:200],
            "url": url
        })
        return True
    return False

def print_results():
    """Zeigt Ergebnisse"""
    print("\n" + "=" * 60)
    print("📊 ERGEBNISSE")
    print("=" * 60)
    
    total = sum(len(v) for v in results.values())
    print(f"\n🎯 Gefundene relevante Deals: {total}")
    
    for kat, deals in results.items():
        if deals:
            print(f"\n{kat}: {len(deals)} Deals")
            for deal in deals[:5]:
                print(f"  • {deal['text'][:60]}...")

print("✅ System bereit!")

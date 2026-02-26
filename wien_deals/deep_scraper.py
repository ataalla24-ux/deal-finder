#!/usr/bin/env python3
"""
Wien Deal Scraper - Scrapy + Playwright
Sammelt alle Deals aus Instagram Hashtags
"""

import json
import re
from datetime import datetime

# Alle Hashtags die wir brauchen
HASHTAGS = [
    # Beste für Wien
    "wiengratis", "aktionwien", "angebotwien", "gewinnspielwien",
    "foodsharingwien", "wienfood", "wienevents", 
    # Zusätzliche
    "wienfree", "foodsharing", "gratisfuerdich", "gratisminuten",
    "lebensmittelrettungwien", "wiengutschein", "wien",
    # Neue Hashtags
    "wienjetzt", "wienheute", "wienoesterreich", 
    "wienrestaurant", "wiencafe", "wienbar",
    "wienparty", "wiennightlife", "wienclub",
    "kostenloswien", "gratiswien", "dealwien",
    "rabattwien", "sparwien", "gutscheinwien",
    "wienliebe", "wien4free", "viennadeals",
    "viennafood", "viennagram", "wienblog",
    "wieninfluencer", "wienmarketing", "wienlife"
]

# Deal Keywords
DEAL_KEYWORDS = [
    "gratis", "kostenlos", "free", "0€", "0 euro", "umsonst",
    "deal", "aktion", "rabatt", "discount", "spar", "statt",
    "gewinnspiel", "gewinnen", "verlosung", "giveaway", "freebie",
    "prozent", "%", "reduziert", "billiger", "günstig"
]

# Wiener Keywords
WIEN_KEYWORDS = [
    "wien", "vienna", "1020", "1010", "1030", "1040", "1050", "1060",
    "1070", "1080", "1090", "1100", "1110", "1120", "1130", "1140",
    "1150", "1160", "1170", "1180", "1190", "1200", "1210", "1220",
    "lerchenfelder", "gürtel", "margareten", "neubau", "innere stadt",
    "eislaufverein", "prater", "schönbrunn", "stephansdom"
]

# Aktuelle Daten (Februar 2026)
AKTUELL_PATTERNS = [
    r"19\.02", r"20\.02", r"21\.02", r"22\.02", r"23\.02", r"24\.02", r"25\.02", r"26\.02", r"27\.02", r"28\.02",
    r"heute", r"morgen", r"gültig", r"bis.*02", r"bis.*2026"
]

def ist_deal(text):
    if not text:
        return False
    return any(kw in text.lower() for kw in DEAL_KEYWORDS)

def ist_wien(text):
    if not text:
        return False
    return any(kw in text.lower() for kw in WIEN_KEYWORDS)

def ist_aktuell(text):
    if not text:
        return False
    for pattern in AKTUELL_PATTERNS:
        if re.search(pattern, text, re.IGNORECASE):
            return True
    return False

def ist_relevant(text):
    """Relevanter Wiener Deal?"""
    return ist_deal(text) and (ist_wien(text) or ist_aktuell(text))

def analyze_post(text, hashtag, url):
    """Analysiert einen Post"""
    score = 0
    reasons = []
    
    # Wien-Bezug
    if ist_wien(text):
        score += 10
        reasons.append("Wien")
    
    # Deal-Keywords
    for kw in DEAL_KEYWORDS:
        if kw in text.lower():
            score += 3
            reasons.append(kw)
    
    # Aktuell?
    if ist_aktuell(text):
        score += 15
        reasons.append("aktuell")
    
    # Gratis?
    if "gratis" in text.lower() or "kostenlos" in text.lower():
        score += 10
        reasons.append("GRATIS!")
    
    return score, reasons

# Beste Hashtags (Top 30)
TOP_HASHTAGS = [
    "wiengratis", "aktionwien", "angebotwien", "gewinnspielwien",
    "foodsharingwien", "wienfood", "wienevents", "wienjetzt",
    "wienfree", "foodsharing", "gratisfuerdich", "gratisminuten",
    "lebensmittelrettungwien", "wiengutschein", "wien",
    "wienrestaurant", "wiencafe", "wienbar", "wienparty", 
    "wiennightlife", "wienclub", "kostenloswien", "gratiswien",
    "dealwien", "rabattwien", "sparwien", "gutscheinwien",
    "wienliebe", "wien4free", "viennadeals", "viennafood"
]

print("=" * 60)
print("🎯 WIEN DEAL SCRAPER")
print("=" * 60)
print(f"📊 Hashtags zu analysieren: {len(TOP_HASHTAGS)}")
print()

# Beste Deals sammeln
all_deals = []

for hashtag in TOP_HASHTAGS[:30]:
    print(f"🔍 #{hashtag}...")
    # Hier würden wir die Posts scrapen
    # Für jetzt analysieren wir die existierenden Daten
    
print()
print("Fertig!")

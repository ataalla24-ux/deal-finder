#!/usr/bin/env python3
"""
Wien Deal Finder - Intelligentes System
Findet aktuelle, relevante kostenlose Deals in Wien
"""

import json
import re
from datetime import datetime, timedelta

# Keywords für relevante Deals
RELEVANTE_KEYWORDS = [
    "gratis", "kostenlos", "free", "0€", "umsonst",
    "deal", "aktion", "rabatt", "discount", "spar",
    "gewinnspiel", "gewinnen", "verlosung", "giveaway",
    "freebie", "gratisprobe", "proben",
    "wien", "wiener", "vienna"
]

# Keywords die Deal UNWAHRSCHEINLICH machen
STRONG_INDICATORS = [
    "gratis", "kostenlos", "free", "0€", "0 euro",
    "gewinnspiel", "giveaway", "verlosung"
]

# Adressen die Wien bestätigen
WIEN_KEYWORDS = [
    "wien", "vienna", "1020", "1010", "1030", "1040", "1050", "1060",
    "1070", "1080", "1090", "1100", "1110", "1120", "1130", "1140",
    "1150", "1160", "1170", "1180", "1190", "1200", "1210", "1220",
    "lerchenfelder", "gürtel", "margareten", "neubau", "innere stadt"
]

def ist_relevanter_deal(text, zeitangabe):
    """Prüft ob ein Post ein relevanter Deal ist"""
    if not text:
        return False
    
    text_lower = text.lower()
    
    # Prüfe Zeit - nur heute oder diese Woche
    if not ist_aktuell(zeitangabe):
        return False
    
    # Prüfe Wien-Bezug
    wien_bezug = any(kw in text_lower for kw in WIEN_KEYWORDS)
    
    # Prüfe Deal-Keywords
    deal_indicator = any(kw in text_lower for kw in STRONG_INDICATORS)
    
    # Wenn beides vorhanden -> Deal!
    return wien_bezug and deal_indicator

def ist_aktuell(zeitangabe):
    """Prüft ob die Zeitangabe aktuell ist (heute/diese Woche)"""
    if not zeitangabe:
        return False
    
    zeit_lower = zeitangabe.lower()
    
    # Definitely today
    if any(x in zeit_lower for x in ["stunde", "minute", "heute", "vor"]):
        return True
    
    # This week
    if "tag" in zeit_lower:
        # Extract number
        match = re.search(r'(\d+)', zeitangabe)
        if match:
            tage = int(match.group(1))
            return tage <= 3  # Max 3 days
    
    if "woche" in zeit_lower:
        match = re.search(r'(\d+)', zeitangabe)
        if match:
            wochen = int(match.group(1))
            return wochen <= 1  # Max 1 week
    
    return False

def analysiere_post(post_text, zeitangabe):
    """Analysiert einen Post und gibt Score zurück"""
    if not post_text:
        return 0
    
    text_lower = post_text.lower()
    score = 0
    
    # Wien-Bezug
    if any(kw in text_lower for kw in WIEN_KEYWORDS):
        score += 10
    
    # Starke Deal-Indikatoren
    for kw in STRONG_INDICATORS:
        if kw in text_lower:
            score += 5
    
    # Aktuell?
    if ist_aktuell(zeitangabe):
        score += 20
    
    return score

def filtere_deals(posts):
    """Filtert die besten Deals aus allen Posts"""
    deals = []
    
    for post in posts:
        post_id = post.get("id", "")
        text = post.get("text", "")
        zeit = post.get("zeit", "")
        url = post.get("url", "")
        
        score = analysiere_post(text, zeit)
        
        if score >= 15:  # Threshold für relevante Deals
            deals.append({
                "url": url,
                "text": text[:200],  # First 200 chars
                "zeit": zeit,
                "score": score
            })
    
    # Sort by score
    deals.sort(key=lambda x: x["score"], reverse=True)
    return deals

# Test
if __name__ == "__main__":
    # Test-Beispiele
    test_posts = [
        {"text": "Kostenloser Kaffee in Wien heute!", "zeit": "2 Stunden", "url": "test1"},
        {"text": "Gratis Eintritt zur Party", "zeit": "1 Woche", "url": "test2"},
        {"text": "Gewinnspiel: 2x2 Tickets gewinnen", "zeit": "5 Stunden", "url": "test3"},
        {"text": "Leckeres Essen in Wien", "zeit": "1 Tag", "url": "test4"},
    ]
    
    deals = filtere_deals(test_posts)
    print("Gefundene Deals:")
    for d in deals:
        print(f"- {d['zeit']}: {d['text'][:50]}... (Score: {d['score']})")

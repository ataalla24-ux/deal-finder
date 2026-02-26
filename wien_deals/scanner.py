#!/usr/bin/env python3
"""
Wien Deal Scanner - Automatisch alle Hashtags durchsuchen
"""

HASHTAGS = [
    "wiengratis",
    "aktionwien", 
    "angebotwien",
    "gewinnspielwien",
    "wienfree",
    "foodsharingwien",
    "foodsharing",
    "gratisfuerdich",
    "gratisminuten",
    "lebensmittelrettungwien",
    "wiengutschein",
    "wienfood",
    "wien"
]

# Keywords für Deals (gratis, kostenlos, etc.)
DEAL_KEYWORDS = [
    "gratis", "kostenlos", "free", "0€", "0 euro", "umsonst",
    "deal", "aktion", "rabatt", "discount", "spar", "statt",
    "gewinnspiel", "gewinnen", "verlosung", "giveaway", "freebie"
]

# Wiener Bezirke & Keywords
WIEN_KEYWORDS = [
    "wien", "vienna", 
    "1020", "1010", "1030", "1040", "1050", "1060", "1070", "1080", "1090",
    "1100", "1110", "1120", "1130", "1140", "1150", "1160", "1170", "1180", "1190",
    "1200", "1210", "1220",
    "lerchenfelder", "gürtel", "margareten", "neubau", "innere stadt",
    "eislauf", "prater", "stephansdom", "schönbrunn"
]

def ist_wien_post(text):
    """Prüft ob der Post Wien-Bezug hat"""
    if not text:
        return False
    text_lower = text.lower()
    return any(kw in text_lower for kw in WIEN_KEYWORDS)

def ist_deal(text):
    """Prüft ob der Post ein Deal/Gratis-Angebot ist"""
    if not text:
        return False
    text_lower = text.lower()
    return any(kw in text_lower for kw in DEAL_KEYWORDS)

def ist_relevant(text):
    """Prüft ob der Post relevant ist (Wien + Deal)"""
    return ist_wien_post(text) and ist_deal(text)

if __name__ == "__main__":
    print("🕵️ Wien Deal Scanner")
    print("=" * 40)
    print(f"Hashtags: {len(HASHTAGS)}")
    print(f"Deal Keywords: {len(DEAL_KEYWORDS)}")
    print(f"Wien Keywords: {len(WIEN_KEYWORDS)}")
    print("=" * 40)
    print("\nBereit fürs Scannen!")

#!/usr/bin/env python3
"""
Systematischer Wien Deal Scraper
Ziel: 50+ Hashtags, 200+ Posts pro Hashtag
"""

HASHTAGS = [
    # Unsere besten (Wien-spezifisch)
    "wiengratis", "aktionwien", "angebotwien", "gewinnspielwien",
    "wienevents", "wienfood", "foodsharingwien", "wienfree",
    "wienjetzt", "wiencafe", "wienbar", "wienparty",
    "wienclub", "wiennightlife", "wienrestaurant",
    
    # Deutsch
    "gratisessen", "kostenlosessen", "gratisgetränke", 
    "kostenloswien", "wienkostenlos", "gratisfuerdien",
    
    # Englisch/kombiniert  
    "freefoodvienna", "freedrinks", "foodgiveaway", "viennafree",
    
    # Zusätzlich
    "wienheute", "wienoesterreich", "wienliebe", "wientipps",
    "wienlife", "discountwien", "rabattwien", "sparwien",
    "wiengutschein", "dealwien", "gutscheinwien",
    "wien4free", "viennadeals", "wienisst", "essenwien",
    "foodwien", "kaffeewien", "restaurantswien",
    "foodloverwien", "wienfoodie", "wienblog", "wienneu"
]

print(f"📊 Hashtags zu scannen: {len(HASHTAGS)}")
for i, h in enumerate(HASHTAGS, 1):
    print(f"{i:2}. #{h}")

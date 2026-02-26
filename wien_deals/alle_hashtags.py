#!/usr/bin/env python3
"""
ALLE Hashtags - Intelligentes Scraper
"""

# ALLE Hashtags kombiniert
ALL_HASHTAGS = [
    # Unsere besten
    "wiengratis", "aktionwien", "angebotwien", "gewinnspielwien",
    "foodsharingwien", "wienfood", "wienevents",
    
    #用户的neue
    "freefood", "freefoodvienna", "gratisessen", "kostenlosessen",
    "gratisgetränke", "freedrinks", "foodgiveaway",
    "viennafree", "kostenloswien", "wienkostenlos",
    
    # Zusätzlich
    "wienjetzt", "wienheute", "wienoesterreich",
    "wienrestaurant", "wiencafe", "wienbar",
    "wienparty", "wiennightlife", "wienclub",
    "wienfree", "foodsharing", "gratisfuerdich",
    "gratisminuten", "lebensmittelrettungwien",
    "wiengutschein", "wien"
]

print(f"📊 Gesamt Hashtags: {len(ALL_HASHTAGS)}")
print("\n".join(f"#{h}" for h in ALL_HASHTAGS))

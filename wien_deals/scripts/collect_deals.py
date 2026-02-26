#!/usr/bin/env python3
"""
Vienna Deals Collector
Collects free food & drink deals from web sources
"""
import json
import os
import re
from datetime import datetime, timedelta
from playwright.sync_api import sync_playwright

SEARCH_TERMS = [
    "kostenlos essen wien",
    "gratis essen wien", 
    "free food wien",
    "gratis getränk wien",
    "foodsharing wien",
    "fair teiler wien",
    "gratis veranstaltung wien 2026",
]

INSTAGRAM_HASHTAGS = [
    'wiengratis', 'aktionwien', 'angebotwien', 
    'wienfood', 'wieneats', 'wiencafe',
    'gewinnspielwien', 'rabattwien', 'wienjetzt'
]

def collect_web_deals():
    """Collect deals from web search"""
    deals = []
    
    print("🌐 Collecting from web sources...")
    
    # Eventbrite deals
    deals.extend(collect_eventbrite())
    
    # Foodsharing/Fair-Teiler
    deals.extend(collect_foodsharing())
    
    return deals

def collect_eventbrite():
    """Collect free events from Eventbrite"""
    # In production, use Eventbrite API
    # For now, return sample structure
    return []

def collect_foodsharing():
    """Collect Foodsharing/Fair-Teiler locations"""
    locations = [
        {"name": "Foodsharing Fairteiler", "address": "St. Elisabeth-Platz 8, 1040 Wien", "type": "foodsharing"},
        {"name": "Fair-Teiler VHS Landstraße", "address": "Hainburger Str. 29, 1030 Wien", "type": "fairteiler"},
        {"name": "Fairteiler VHS Donaustadt", "address": "Bernoullistraße 1, 1220 Wien", "type": "fairteiler"},
        {"name": "Fairteiler Ahornergasse", "address": "Ahornergasse, 1070 Wien", "type": "fairteiler"},
    ]
    return [{"source": "foodsharing", "type": "free_food", "locations": locations}]

def collect_instagram():
    """Collect from Instagram hashtags"""
    # Note: Requires authenticated session or Apify
    # This is a placeholder - in production use Apify API
    return []

def save_deals(deals, filename="deals.json"):
    """Save deals to JSON file"""
    output = {
        "collected_at": datetime.now().isoformat(),
        "total": len(deals),
        "deals": deals
    }
    
    with open(filename, 'w', encoding='utf-8') as f:
        json.dump(output, f, ensure_ascii=False, indent=2)
    
    print(f"💾 Saved {len(deals)} deals to {filename}")
    return output

def main():
    print("=" * 60)
    print("🎯 VIENNA DEALS COLLECTOR")
    print("=" * 60)
    
    deals = []
    
    # Collect from web
    deals.extend(collect_web_deals())
    
    # Note: Instagram requires authenticated browser or Apify
    # deals.extend(collect_instagram())
    
    # Save
    output = save_deals(deals)
    
    print(f"\n✅ Total deals collected: {output['total']}")
    
    return output

if __name__ == "__main__":
    main()

#!/usr/bin/env python3
"""
Wien Deal Finder - Automatischer Instagram Scraper
Findet alle relevanten Deals aus allen Hashtags
"""

import asyncio
import json
import re
from datetime import datetime
from playwright.async_api import async_playwright

# Alle Hashtags die gescannt werden sollen
HASHTAGS = [
    "wiengratis", "aktionwien", "angebotwien", "gewinnspielwien",
    "wienfree", "foodsharingwien", "foodsharing", "gratisfuerdich",
    "gratisminuten", "lebensmittelrettungwien", "wiengutschein", 
    "wienfood", "wien"
]

# Deal Keywords
DEAL_KEYWORDS = [
    "gratis", "kostenlos", "free", "0€", "0 euro", "umsonst",
    "deal", "aktion", "rabatt", "discount", "spar", "statt",
    "gewinnspiel", "gewinnen", "verlosung", "giveaway", "freebie",
    "prozent", "%"
]

# Wiener Keywords
WIEN_KEYWORDS = [
    "wien", "vienna", "1020", "1010", "1030", "1040", "1050", "1060",
    "1070", "1080", "1090", "1100", "1110", "1120", "1130", "1140",
    "1150", "1160", "1170", "1180", "1190", "1200", "1210", "1220",
    "lerchenfelder", "gürtel", "margareten", "neubau", "innere stadt",
    "eislaufverein", "prater", "schönbrunn", "stephansdom"
]

def ist_deal(text):
    if not text: return False
    return any(kw in text.lower() for kw in DEAL_KEYWORDS)

def ist_wien(text):
    if not text: return False
    return any(kw in text.lower() for kw in WIEN_KEYWORDS)

def ist_relevant(text):
    return ist_deal(text) and ist_wien(text)

async def scrape_hashtag(page, hashtag, max_scrolls=15):
    """Scraped einen Hashtag und gibt relevante Posts zurück"""
    print(f"\n📱 Scanne #{hashtag}...")
    
    relevant_posts = []
    url = f"https://www.instagram.com/explore/tags/{hashtag}/"
    
    try:
        await page.goto(url, timeout=30000)
        await page.wait_for_load_state("networkidle")
        await asyncio.sleep(2)
        
        # Scroll durch alle Posts
        for i in range(max_scrolls):
            await page.evaluate("window.scrollTo(0, document.body.scrollHeight)")
            await asyncio.sleep(1)
            
            # Extrahiere Posts aus der Seite
            posts = await page.evaluate('''() => {
                const results = [];
                const articles = document.querySelectorAll('article');
                articles.forEach(article => {
                    const img = article.querySelector('img');
                    const text = article.innerText.substring(0, 500);
                    const link = article.querySelector('a[href*="/p/"]');
                    if (link) {
                        results.push({
                            text: text,
                            url: link.href
                        });
                    }
                });
                return results;
            }''')
            
            for post in posts:
                if ist_relevant(post.get("text", "")):
                    post["hashtag"] = hashtag
                    relevant_posts.append(post)
                    print(f"  ✅ Gefunden: {post.get('text', '')[:80]}...")
            
            # Prüfe ob mehr geladen werden kann
            no_more = await page.evaluate('''() => {
                return document.body.scrollHeight <= window.scrollY + window.innerHeight + 100;
            }''')
            if no_more:
                break
                
    except Exception as e:
        print(f"  ❌ Fehler: {e}")
    
    print(f"  📊 {len(relevant_posts)} relevante Deals gefunden")
    return relevant_posts

async def main():
    """Main function"""
    print("🎯 Wien Deal Finder - Automatischer Scanner")
    print("=" * 50)
    
    all_deals = []
    
    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=False)
        context = await browser.new_context(viewport={"width": 1280, "height": 720})
        page = await context.new_page()
        
        for hashtag in HASHTAGS:
            deals = await scrape_hashtag(page, hashtag)
            all_deals.extend(deals)
            
        await browser.close()
    
    # Speichere Ergebnisse
    with open("/Users/Stefan/.openclaw/workspace/wien_deals/alle_deals.json", "w") as f:
        json.dump(all_deals, f, indent=2, ensure_ascii=False)
    
    print(f"\n✅ Fertig! {len(all_deals)} Deals gefunden.")
    print("Gespeichert in: alle_deals.json")
    
    return all_deals

if __name__ == "__main__":
    asyncio.run(main())

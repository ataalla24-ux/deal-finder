#!/usr/bin/env python3
"""
Instagram Scraper - Extrahiert alle Posts mit Zeitstempeln
"""

import asyncio
from playwright.async_api import async_playwright
import re

async def scrape_with_timestamps(hashtag):
    """Scraped alle Posts mit Zeitstempeln"""
    
    print(f"\n📱 Scanne #{hashtag}...")
    
    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=False)
        page = await browser.new_page()
        
        await page.goto(f"https://www.instagram.com/explore/tags/{hashtag}/")
        await page.wait_for_load_state("networkidle")
        await asyncio.sleep(3)
        
        # Scroll mehrmals um alle Posts zu laden
        for _ in range(15):
            await page.evaluate("window.scrollTo(0, document.body.scrollHeight)")
            await asyncio.sleep(1)
        
        # Extrahiere alle Posts mit Zeit
        posts = await page.evaluate('''() => {
            const results = [];
            
            // Alle Artikel finden
            const articles = document.querySelectorAll('article');
            
            articles.forEach(article => {
                // Zeit finden
                const timeEl = article.querySelector('time');
                const time = timeEl ? timeEl.getAttribute('datetime') : null;
                
                // Text finden
                const textEl = article.querySelector('span[role="link"]');
                const text = textEl ? textEl.innerText.substring(0, 300) : '';
                
                // Link finden
                const linkEl = article.querySelector('a[href*="/p/"]');
                const url = linkEl ? linkEl.href : '';
                
                if (url) {
                    results.push({ time, text, url });
                }
            });
            
            return results;
        }''')
        
        await browser.close()
        
    return posts

async def main():
    hashtags = ["wiengratis", "aktionwien", "angebotwien", "gewinnspielwien"]
    
    all_posts = []
    
    for hashtag in hashtags:
        posts = await scrape_with_timestamps(hashtag)
        
        # Filtere nach aktuellen (heute/diese Woche)
        aktuell = []
        for p in posts:
            if p['time']:
                # Prüfe ob heute oder diese Woche
                aktuell.append(p)
                print(f"  ✅ {p['time']}: {p['text'][:50]}...")
        
        all_posts.extend(aktuell)
        print(f"  📊 {len(aktuell)} aktuelle Posts gefunden")
    
    print(f"\n✅ Gesamt: {len(all_posts)} aktuelle Posts")

if __name__ == "__main__":
    asyncio.run(main())

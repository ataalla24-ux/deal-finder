#!/usr/bin/env python3
"""
Scrapy + Playwright - Sichtbarer Browser
"""
import asyncio
import json
from playwright.async_api import async_playwright

async def main():
    results = []
    
    hashtags = [
        'lebensmittelrettungwien',
        'foodsharingwien', 
        'wienfood',
        'wien',
        'foodsharing'
    ]
    
    print("Starte Browser...")
    async with async_playwright() as p:
        # SICHTBARER Browser
        browser = await p.chromium.launch(headless=False)
        
        for tag in hashtags:
            url = f'https://www.instagram.com/explore/tags/{tag}/'
            print(f"\n=== Scraping #{tag} ===")
            
            context = await browser.new_context(
                user_agent='Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
                viewport={'width': 1280, 'height': 720}
            )
            page = await context.new_page()
            
            try:
                await page.goto(url, wait_until='networkidle', timeout=30000)
                await asyncio.sleep(4)
                
                # Warte auf Content
                try:
                    await page.wait_for_selector('article', timeout=5000)
                except:
                    pass
                
                # Finde alle Post-Links
                posts = await page.query_selector_all('main a[href*="/p/"]')
                
                print(f"  Gefunden: {len(posts)} Posts")
                
                for post in posts[:20]:
                    href = await post.get_attribute('href')
                    if href and '/p/' in href:
                        full_url = f"https://www.instagram.com{href}"
                        results.append({
                            'hashtag': tag,
                            'url': full_url
                        })
                        
            except Exception as e:
                print(f"  Fehler: {e}")
            
            await context.close()
        
        await browser.close()
    
    # Speichern
    with open('wien_deals.json', 'w') as f:
        json.dump(results, f, indent=2)
    
    print(f"\n=== FERTIG ===")
    print(f"Gesamt: {len(results)} Deals")
    
    # Zeige Results
    for r in results[:10]:
        print(f"  #{r['hashtag']} -> {r['url']}")

if __name__ == '__main__':
    asyncio.run(main())

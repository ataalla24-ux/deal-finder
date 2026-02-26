#!/usr/bin/env python3
"""
Wien Free Food & Drink Finder
Playwright - Complete Web Search for Vienna Deals
Fixed: Uses stealth mode and alternative search engines
"""
import asyncio
import json
import random
from datetime import datetime
from playwright.async_api import async_playwright
# Note: playwright-stealth not available, using manual stealth args in browser launch

# Suchbegriffe für kostenloses Essen & Trinken in Wien
SEARCH_TERMS = [
    "kostenlos essen wien",
    "gratis essen wien", 
    "free food wien",
    "gratis bier wien",
    "kostenlos veranstaltung wien",
    "foodsharing wien",
    "gratis konto veranstaltung wien",
    "aktionwien gratis",
    "wien gratis essen",
    "gratis mittagessen wien",
]

# Zusätzliche Deal-Quellen
DEAL_URLS = [
    "https://www.instagram.com/explore/tags/gratiswien/",
    "https://www.instagram.com/explore/tags/wienfood/",
    "https://www.instagram.com/explore/tags/aktionwien/",
    "https://www.1000things.at/",
    "https://www.meinbezirk.at/",
]

async def search_with_stealth(page, url):
    """Navigate (stealth already applied via browser args)"""
    try:
        await page.goto(url, wait_until='domcontentloaded', timeout=30000)
        await asyncio.sleep(random.uniform(2, 4))
        return True
    except Exception as e:
        print(f"   Fehlgeschlagen: {e}")
        return False

async def scrape_direct_urls():
    """Scrape deal URLs directly instead of search"""
    results = []
    
    print("🔍 Scrape Deal-Seiten direkt...")
    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=True, args=[
            '--disable-blink-features=AutomationControlled',
            '--no-sandbox'
        ])
        
        for url in DEAL_URLS:
            print(f"\n📌 {url.split('/')[-2] if '/' in url else url[:30]}...")
            context = await browser.new_context(
                user_agent='Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                viewport={'width': 1920, 'height': 1080}
            )
            page = await context.new_page()
            
            try:
                await page.goto(url, wait_until='networkidle', timeout=45000)
                await asyncio.sleep(3)
                
                # Instagram posts
                if 'instagram' in url:
                    await page.evaluate("window.scrollBy(0, 3000)")
                    await asyncio.sleep(2)
                    posts = await page.query_selector_all('article a[href*="/p/"]')
                    print(f"   → {len(posts)} Instagram Posts gefunden")
                    for post in posts[:20]:
                        href = await post.get_attribute('href')
                        if href:
                            results.append({
                                'source': 'instagram',
                                'url': href if href.startswith('http') else f'https://instagram.com{href}',
                                'title': 'Instagram Deal',
                                'date': datetime.now().isoformat()
                            })
                
                # 1000things.at & meinbezirk.at
                else:
                    links = await page.query_selector_all('article a, .article-item a, .offer a')
                    print(f"   → {len(links)} Links gefunden")
                    for link in links[:15]:
                        href = await link.get_attribute('href')
                        title = await link.inner_text()
                        if href and title and len(title) > 10:
                            if not href.startswith('http'):
                                href = 'https://' + url.split('/')[2] + href
                            results.append({
                                'source': url.split('/')[2].replace('www.', ''),
                                'url': href,
                                'title': title[:100],
                                'date': datetime.now().isoformat()
                            })
                            
            except Exception as e:
                print(f"   Fehler: {str(e)[:50]}")
            
            await context.close()
        
        await browser.close()
    
    return results

async def search_browser_for_deals():
    """Nutze Bing (weniger blockiert als Google)"""
    results = []
    
    print("🔍 Starte Browser-Suche (Bing)...")
    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=True, args=[
            '--disable-blink-features=AutomationControlled',
            '--no-sandbox'
        ])
        
        context = await browser.new_context(
            user_agent='Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
            viewport={'width': 1920, 'height': 1080}
        )
        
        for term in SEARCH_TERMS:
            print(f"\n📌 Suche: '{term}'")
            page = await context.new_page()
            
            try:
                # Bing statt Google
                search_url = f"https://www.bing.com/search?q={term.replace(' ', '+')}&setlang=de"
                await page.goto(search_url, wait_until='domcontentloaded', timeout=30000)
                await asyncio.sleep(random.uniform(2, 4))
                
                # Bing Ergebnisse
                search_results = await page.query_selector_all('li.b_algo')
                print(f"   Gefunden: {len(search_results)} Ergebnisse")
                
                for result in search_results[:8]:
                    try:
                        title_elem = await result.query_selector('h2 a')
                        if title_elem:
                            title = await title_elem.inner_text()
                            link = await title_elem.get_attribute('href')
                            
                            if title and link and 'http' in link:
                                results.append({
                                    'term': term,
                                    'title': title[:150],
                                    'url': link[:300],
                                    'date': datetime.now().isoformat()
                                })
                    except:
                        pass
                        
            except Exception as e:
                print(f"   Fehler: {str(e)[:40]}")
            
            await page.close()
        
        await browser.close()
    
    return results

async def main():
    print("=" * 60)
    print("🎯 WIEN FREE FOOD & DRINK FINDER (Fixed)")
    print("=" * 60)
    
    all_results = {
        'direct_scrape': [],
        'web_search': [],
        'timestamp': datetime.now().isoformat()
    }
    
    # 1. Direct scrape (Instagram, 1000things, etc.)
    direct_results = await scrape_direct_urls()
    all_results['direct_scrape'] = direct_results
    print(f"\n✅ Direct Scrape: {len(direct_results)} Ergebnisse")
    
    # 2. Web-Suche (Bing)
    web_results = await search_browser_for_deals()
    all_results['web_search'] = web_results
    print(f"\n✅ Web-Suche: {len(web_results)} Ergebnisse")
    
    # Speichern
    output_file = f'wien_free_food_{datetime.now().strftime("%Y%m%d_%H%M%S")}.json'
    with open(output_file, 'w', encoding='utf-8') as f:
        json.dump(all_results, f, ensure_ascii=False, indent=2)
    
    # Auch als deals.json für slack-notify
    deals_output = []
    for r in direct_results + web_results:
        deals_output.append({
            'id': f"web-{hash(r['url']) % 1000000}",
            'brand': r.get('source', 'Web'),
            'title': r.get('title', 'Deal')[:60],
            'description': r.get('term', r.get('source', '')),
            'url': r.get('url', ''),
            'type': 'rabatt',
            'category': 'essen',
            'source': 'Web Scraper',
            'pubDate': r.get('date', datetime.now().isoformat()),
            'qualityScore': 50
        })
    
    with open('deals.json', 'w', encoding='utf-8') as f:
        json.dump({'deals': deals_output, 'totalDeals': len(deals_output)}, f, ensure_ascii=False, indent=2)
    
    print(f"\n{'=' * 60}")
    print(f"📊 ZUSAMMENFASSUNG")
    print(f"{'=' * 60}")
    print(f"Direct Scrape: {len(direct_results)}")
    print(f"Web-Suche: {len(web_results)}")
    print(f"TOTAL: {len(deals_output)} Deals")
    print(f"\n💾 Gespeichert: {output_file}")
    print(f"💾 Deals JSON: deals.json")

if __name__ == '__main__':
    asyncio.run(main())

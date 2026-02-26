#!/usr/bin/env python3
"""
Instagram Scraper - Maximum Time
"""
import asyncio
import json
import os
import re
from datetime import datetime
from playwright.async_api import async_playwright

OUTPUT_FILE = os.path.join(os.path.dirname(os.path.dirname(__file__)), 'docs', 'deals-pending-scrapy.json')
COOKIES_STR = os.environ.get('INSTAGRAM_COOKIES', '')

def parse_cookies(cookie_str):
    cookies = {}
    if not cookie_str:
        return cookies
    for part in cookie_str.split(';'):
        part = part.strip()
        if '=' in part:
            key, value = part.split('=', 1)
            cookies[key.strip()] = value.strip()
    return cookies

HASHTAGS = ['wiengratis', 'aktionwien', 'wienfood', 'wieneats', 'foodsharingwien', 'gratiskebap', 'gratisessen', 'wiencafe', 'kostenloswien', 'freefoodwien', 'angebotwien']

DEAL_KEYWORDS = ['gratis', 'kostenlos', 'free', '0€', 'aktion', 'rabatt', 'deal', 'schnäppchen', '1+1', '2 gratis']

def ist_deal(text):
    if not text:
        return False
    return any(kw in text.lower() for kw in DEAL_KEYWORDS)

async def scrape():
    results = []
    cookies = parse_cookies(COOKIES_STR)
    
    print(f"🍪 {len(cookies)} cookies")
    
    async with async_playwright() as p:
        browser = await p.chromium.launch(
            headless=True,
            args=['--no-sandbox']
        )
        
        context = await browser.new_context(
            viewport={'width': 1280, 'height': 720}
        )
        
        for name, value in cookies.items():
            await context.add_cookies([{'name': name, 'value': value, 'domain': '.instagram.com', 'path': '/'}])
        
        # Homepage
        page = await context.new_page()
        await page.goto('https://www.instagram.com/')
        print(f"✓ {page.url}")
        
        # Scrape hashtags
        for tag in HASHTAGS:
            print(f"#{tag}...", end="", flush=True)
            
            try:
                page = await context.new_page()
                await page.goto(f'https://www.instagram.com/explore/tags/{tag}/')
                
                # More scrolling
                for i in range(10):
                    await page.evaluate(f"window.scrollBy(0, {2000})")
                
                # Get all text
                text = await page.evaluate("document.body.innerText")
                
                # Split and find deals
                sentences = re.split(r'[.!?\n]', text)
                deals_here = 0
                for sent in sentences:
                    sent = sent.strip()
                    if len(sent) > 30 and ist_deal(sent):
                        results.append({
                            'id': f"ig-{hash(sent[:40]) % 1000000}",
                            'brand': 'Instagram',
                            'title': sent[:60],
                            'description': sent[:250],
                            'type': 'gratis',
                            'category': 'essen',
                            'source': f'Instagram #{tag}',
                            'url': f'https://instagram.com/explore/tags/{tag}/',
                            'expires': 'Unbekannt',
                            'distance': 'Wien',
                            'pubDate': datetime.now().isoformat(),
                            'qualityScore': 75
                        })
                        deals_here += 1
                
                print(f" {deals_here} deals")
                
            except Exception as e:
                print(f" Error")
            finally:
                await page.close()
        
        await browser.close()
    
    return results

async def main():
    print("=" * 50)
    print("Instagram Scraper")
    print("=" * 50)
    
    deals = await scrape()
    
    # Dedup
    seen = set()
    unique = []
    for d in deals:
        key = d['title'][:30].lower()
        if key not in seen:
            seen.add(key)
            unique.append(d)
    
    final = unique[:300]
    
    output = {'lastUpdated': datetime.now().isoformat(), 'source': 'scrapy', 'totalDeals': len(final), 'deals': final}
    
    os.makedirs(os.path.dirname(OUTPUT_FILE), exist_ok=True)
    with open(OUTPUT_FILE, 'w') as f:
        json.dump(output, f, ensure_ascii=False, indent=2)
    
    print(f"\nTotal: {len(final)} deals")
    print(f"Saved: {OUTPUT_FILE}")

if __name__ == '__main__':
    asyncio.run(main())

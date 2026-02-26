#!/usr/bin/env python3
"""
Instagram Scraper v4 - Smarter, more reliable
"""
import asyncio
import json
import os
import sys
import re
from datetime import datetime
from playwright.async_api import async_playwright, TimeoutError as PlaywrightTimeout

OUTPUT_FILE = os.path.join(os.path.dirname(os.path.dirname(__file__)), 'docs', 'deals-pending-instagram.json')
COOKIES_FILE = os.path.join(os.path.dirname(__file__), 'instagram_cookies.txt')

def load_cookies():
    cookies_str = os.environ.get('INSTAGRAM_COOKIES', '')
    if not cookies_str and os.path.exists(COOKIES_FILE):
        with open(COOKIES_FILE, 'r') as f:
            cookies_str = f.read().strip()
    
    cookies = {}
    for part in cookies_str.split(';'):
        part = part.strip()
        if '=' in part:
            key, value = part.split('=', 1)
            cookies[key.strip()] = value.strip()
    return cookies

# More hashtags for more deals
HASHTAGS = [
    'gratiswien', 'aktionwien', 'wienfood', 'wiengratis', 'freewien',
    'schnäppchenwien', 'wienaktion', 'wiendeal', 'wienrabatt',
    'gratismuster', 'wienstuttgart', 'wienverschenken'
]

DEAL_KEYWORDS = [
    'gratis', 'kostenlos', 'free', '0€', 'aktion', 'rabatt', 'deal', 
    'schnäppchen', 'giveaway', 'gewinnspiel', 'verschenken', 'umsonst',
    'gratismuster', 'probiert', 'teste', 'geschenk', 'zugabe'
]

def ist_deal(text):
    if not text:
        return False
    return any(kw in text.lower() for kw in DEAL_KEYWORDS)

async def wait_for_network_idle(page, timeout=10000):
    """Wait for network to be idle instead of just sleeping"""
    try:
        await page.wait_for_load_state('networkidle', timeout=timeout)
    except PlaywrightTimeout:
        pass  # Continue anyway if timeout

async def click_load_more(page):
    """Click 'Load more' button if available"""
    # Multiple selectors for the "load more" button
    load_more_selectors = [
        'button >> text=Mehr laden',
        'button >> text=Load more',
        'a[role="button"] >> text=Mehr',
        'button:has-text("Mehr")',
        'button:has-text("Load")',
        'div[role="button"]:has-text("Mehr")',
    ]
    
    for selector in load_more_selectors:
        try:
            btn = await page.query_selector(selector)
            if btn:
                await btn.click()
                await asyncio.sleep(2)
                print(f"  📥 Clicked load more", flush=True)
                return True
        except:
            continue
    return False

async def get_post_links(page, max_posts=30):
    """Get post links with multiple selector fallbacks"""
    selectors = [
        # Current Instagram selectors
        'main a[href*="/p/"]',
        'a[href*="/p/"]',
        'article a[href*="/p/"]',
        'div[role="menu"] a[href*="/p/"]',
        # Alternative selectors
        'article a',
        'main article a',
        'div._aao7 a',
        'div._aae- a',
    ]
    
    post_links = []
    
    for selector in selectors:
        try:
            links = await page.query_selector_all(selector)
            if links:
                for link in links:
                    try:
                        href = await link.get_attribute('href')
                        if href and '/p/' in href:
                            post_links.append(href)
                    except:
                        continue
                if post_links:
                    print(f"  📋 Found {len(post_links)} posts with selector: {selector[:30]}", flush=True)
                    break
        except:
            continue
    
    # Deduplicate
    seen = set()
    unique_links = []
    for link in post_links:
        if link not in seen:
            seen.add(link)
            full_url = link if link.startswith('http') else 'https://www.instagram.com' + link
            unique_links.append(full_url)
    
    return unique_links[:max_posts]

async def get_post_caption(page):
    """Get caption with multiple fallback strategies"""
    
    # Strategy 1: Try role=main
    try:
        main = await page.query_selector('[role="main"]')
        if main:
            text = await main.inner_text()
            if text and len(text) > 10:
                return text[:500]
    except:
        pass
    
    # Strategy 2: Try article element
    try:
        article = await page.query_selector('article')
        if article:
            text = await article.inner_text()
            if text and len(text) > 10:
                return text[:500]
    except:
        pass
    
    # Strategy 3: Try h1 + article text
    try:
        h1 = await page.query_selector('h1')
        article = await page.query_selector('article, ._aao7, ._aae-')
        if h1 and article:
            h1_text = await h1.inner_text()
            article_text = await article.inner_text()
            combined = f"{h1_text} {article_text}"
            if combined and len(combined) > 10:
                return combined[:500]
    except:
        pass
    
    # Strategy 4: Get all text from page
    try:
        body = await page.query_selector('body')
        if body:
            text = await body.inner_text()
            if text and len(text) > 20:
                # Clean up - take first 500 chars
                return text[:500]
    except:
        pass
    
    return ''

async def scrape():
    results = []
    seen_urls = set()
    cookies = load_cookies()
    
    print(f"🍪 {len(cookies)} cookies", flush=True)
    if not cookies:
        print("❌ No cookies!", flush=True)
        return []
    
    async with async_playwright() as p:
        try:
            browser = await p.chromium.launch(
                headless=True,
                args=[
                    '--no-sandbox',
                    '--disable-blink-features=AutomationControlled',
                    '--disable-dev-shm-usage',
                    '--disable-gpu',
                    '--disable-web-security',
                ]
            )
        except Exception as e:
            print(f"❌ Browser launch failed: {e}", flush=True)
            return []
        
        context = await browser.new_context(
            viewport={'width': 1280, 'height': 800},
            user_agent='Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
            locale='de-DE',
            timezone_id='Europe/Vienna'
        )
        
        # Set extra HTTP headers
        await context.set_extra_http_headers({
            'Accept-Language': 'de-DE,de;q=0.9,en;q=0.8',
        })
        
        for name, value in cookies.items():
            await context.add_cookies([{
                'name': name, 'value': value, 'domain': '.instagram.com', 'path': '/'
            }])
        
        page = await context.new_page()
        
        # Enable console logging
        page.on('console', lambda msg: print(f"  🖥️ {msg.text}", flush=True) if 'error' in msg.text.lower() else None)
        
        # Homepage - establish session
        try:
            await page.goto('https://www.instagram.com/', wait_until='networkidle', timeout=30000)
            await asyncio.sleep(3)
            print(f"✓ {page.url}", flush=True)
        except Exception as e:
            print(f"❌ Homepage failed: {e}", flush=True)
            await browser.close()
            return []
        
        for tag in HASHTAGS:
            print(f"\n=== #{tag} ===", flush=True)
            
            try:
                await page.goto(f'https://www.instagram.com/explore/tags/{tag}/', wait_until='networkidle', timeout=60000)
                await asyncio.sleep(3)
                
                # Try clicking "Load more" multiple times to get more posts
                for i in range(5):
                    loaded = await click_load_more(page)
                    if loaded:
                        await wait_for_network_idle(page, timeout=5000)
                    else:
                        break
                        
            except Exception as e:
                print(f"  ⚠️ Tag page failed: {e}", flush=True)
                continue
            
            # Get post links
            try:
                post_urls = await get_post_links(page, max_posts=40)
                print(f"  📜 Total unique posts: {len(post_urls)}", flush=True)
            except Exception as e:
                print(f"  ⚠️ No posts found: {e}", flush=True)
                continue
            
            if not post_urls:
                print(f"  ❌ No posts found for #{tag}", flush=True)
                continue
            
            # Visit each post
            for idx, url in enumerate(post_urls):
                if url in seen_urls:
                    continue
                seen_urls.add(url)
                
                try:
                    await page.goto(url, wait_until='networkidle', timeout=30000)
                    await asyncio.sleep(1)  # Brief wait for render
                    
                    caption = await get_post_caption(page)
                    
                    if ist_deal(caption):
                        # Extract useful info
                        deal_type = 'gratis' if any(k in caption.lower() for k in ['gratis', 'kostenlos', 'free', '0€']) else 'deal'
                        
                        print(f"  ✅ [{idx+1}/{len(post_urls)}] Deal: {caption[:60]}...", flush=True)
                        results.append({
                            'id': url.split('/')[-2],
                            'url': url,
                            'text': caption[:500],
                            'hashtag': tag,
                            'type': deal_type,
                            'scraped_at': datetime.now().isoformat()
                        })
                    else:
                        if idx < 3:  # Only print first few non-deals
                            print(f"  - [{idx+1}] {caption[:40] if caption else 'no caption'}...", flush=True)
                    
                    # Shorter delay between posts - Instagram is faster now
                    await asyncio.sleep(2)
                    
                except Exception as e:
                    print(f"  ⚠️ Post error: {e}", flush=True)
                    continue
        
        await page.close()
        await browser.close()
    
    print(f"\n📊 Total: {len(results)} deals", flush=True)
    
    if results:
        os.makedirs(os.path.dirname(OUTPUT_FILE), exist_ok=True)
        with open(OUTPUT_FILE, 'w') as f:
            json.dump({
                'lastUpdated': datetime.now().isoformat(),
                'source': 'instagram',
                'totalDeals': len(results),
                'deals': results
            }, f, indent=2, ensure_ascii=False)
        print(f"💾 Saved to {OUTPUT_FILE}", flush=True)
    
    return results

async def main():
    print("=" * 50, flush=True)
    print("Instagram Scraper v4 - Smarter Edition", flush=True)
    print("=" * 50, flush=True)
    await scrape()

if __name__ == '__main__':
    asyncio.run(main())

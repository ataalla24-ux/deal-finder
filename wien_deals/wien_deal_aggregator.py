#!/usr/bin/env python3
"""
Wien Deal Aggregator - Instagram Scraper
Sammelt alle aktuellen Deals aus Instagram
"""

import json
import re
from datetime import datetime
from playwright.async_api import async_playwright
import random

# ============== KONFIGURATION ==============
SLACK_WEBHOOK_URL = "YOUR_SLACK_WEBHOOK_URL"

HASHTAGS = [
    "wiengratis", "aktionwien", "angebotwien", "gewinnspielwien",
    "foodsharingwien", "wienfood", "wienevents", "wienjetzt"
]

DEAL_KEYWORDS = ["gratis", "kostenlos", "free", "0€", "aktion", "rabatt", "gewinnspiel", "gewinnen", "deal", "today"]

AKTUELL_PATTERNS = [r"19\.02", r"20\.02", r"21\.02", r"22\.02", r"heute", r"morgen", r"gültig"]

class DealCollector:
    def __init__(self):
        self.deals = []
        
    def ist_aktuell(self, text):
        if not text:
            return False
        text_lower = text.lower()
        for pattern in AKTUELL_PATTERNS:
            if re.search(pattern, text_lower, re.IGNORECASE):
                return True
        return False
    
    def ist_relevant(self, text):
        if not text:
            return False
        text_lower = text.lower()
        wien_keywords = ["wien", "vienna", "1020", "1160", "bezirk"]
        has_wien = any(kw in text_lower for kw in wien_keywords)
        has_deal = any(kw in text_lower for kw in DEAL_KEYWORDS)
        return has_wien or has_deal
    
    async def scrape_instagram(self):
        print("📸 Scrape Instagram...")
        
        async with async_playwright() as p:
            # Random viewport
            width = random.randint(1200, 1400)
            height = random.randint(800, 1000)
            
            browser = await p.chromium.launch(
                headless=False,
                args=['--disable-blink-features=AutomationControlled']
            )
            
            context = await browser.new_context(
                viewport={'width': width, 'height': height},
                user_agent='Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
            )
            
            for hashtag in HASHTAGS:
                try:
                    print(f"  📱 Scanne #{hashtag}...")
                    page = await context.new_page()
                    
                    # Navigate
                    await page.goto(f"https://www.instagram.com/explore/tags/{hashtag}/", timeout=30000)
                    await page.wait_for_load_state("domcontentloaded")
                    await asyncio.sleep(random.uniform(2, 4))
                    
                    # Scroll mehrfach
                    for i in range(8):
                        await page.evaluate(f"window.scrollTo(0, {i * 2000})")
                        await asyncio.sleep(random.uniform(1, 2))
                    
                    # Warte auf Inhalt
                    await page.wait_for_selector("article", timeout=10000)
                    
                    # Extrahiere Posts
                    posts = await page.evaluate('''() => {
                        const results = [];
                        const articles = document.querySelectorAll('article');
                        articles.forEach((article, idx) => {
                            if (idx < 30) {  // Nur erste 30
                                const link = article.querySelector('a[href*="/p/"]');
                                const text = article.innerText.substring(0, 400);
                                if (link) {
                                    results.push({ text: text, url: link.href });
                                }
                            }
                        });
                        return results;
                    }''')
                    
                    print(f"     → {len(posts)} Posts gefunden")
                    
                    # Filtere Deals
                    for post in posts:
                        text = post.get("text", "")
                        if self.ist_relevant(text) and self.ist_aktuell(text):
                            self.deals.append({
                                "source": "Instagram",
                                "hashtag": f"#{hashtag}",
                                "text": text[:300],
                                "url": post.get("url", "")
                            })
                            print(f"     ✅ Deal gefunden!")
                    
                    await page.close()
                    
                except Exception as e:
                    print(f"  ❌ #{hashtag}: {str(e)[:50]}")
            
            await browser.close()
    
    def filter_deals(self):
        unique_deals = []
        seen_texts = set()
        
        for deal in self.deals:
            text_key = deal["text"][:50].lower()
            if text_key not in seen_texts:
                seen_texts.add(text_key)
                unique_deals.append(deal)
        
        self.deals = unique_deals
        print(f"\n📊 Gefiltert: {len(self.deals)} einzigartige Deals")
    
    def format_for_slack(self):
        blocks = [
            {
                "type": "header",
                "text": {
                    "type": "plain_text",
                    "text": f"🎉 Wien Deals - {datetime.now().strftime('%d.%m.%Y')}",
                    "emoji": True
                }
            },
            {"type": "divider"}
        ]
        
        if not self.deals:
            blocks.append({
                "type": "section",
                "text": {"type": "mrkdwn", "text": "Keine aktuellen Deals gefunden 😔"}
            })
        else:
            # Gruppieren
            food = [d for d in self.deals if any(kw in d["text"].lower() for kw in ["essen", "food", "restaurant", "kaffee", "getränk", "cappuccino"])]
            events = [d for d in self.deals if any(kw in d["text"].lower() for kw in ["party", "event", "disco", "konzert", "festival", "tickets"])]
            other = [d for d in self.deals if d not in food and d not in events]
            
            if food:
                blocks.append({"type": "section", "text": {"type": "mrkdwn", "text": "*🍔 FOOD & ESSEN*"}})
                for deal in food[:10]:
                    blocks.append({"type": "section", "text": {"type": "mrkdwn", "text": f"• {deal['text'][:150]}\n<{deal['url']}|📱 Link>"}})
            
            if events:
                blocks.append({"type": "section", "text": {"type": "mrkdwn", "text": "*🎭 EVENTS & PARTIES*"}})
                for deal in events[:10]:
                    blocks.append({"type": "section", "text": {"type": "mrkdwn", "text": f"• {deal['text'][:150]}\n<{deal['url']}|📱 Link>"}})
            
            if other:
                blocks.append({"type": "section", "text": {"type": "mrkdwn", "text": "*🎁 SONSTIGES*"}})
                for deal in other[:10]:
                    blocks.append({"type": "section", "text": {"type": "mrkdwn", "text": f"• {deal['text'][:150]}\n<{deal['url']}|📱 Link>"}})
        
        blocks.append({"type": "divider"})
        blocks.append({"type": "context", "elements": [{"type": "mrkdwn", "text": f"🕐 Stand: {datetime.now().strftime('%d.%m.%Y %H:%M')}"}]})
        
        return blocks
    
    async def send_to_slack(self, blocks):
        if not SLACK_WEBHOOK_URL or SLACK_WEBHOOK_URL == "YOUR_SLACK_WEBHOOK_URL":
            print("\n⚠️ Slack Webhook nicht konfiguriert!")
            print("Nachricht:")
            print(json.dumps(blocks, indent=2, ensure_ascii=False)[:2000])
            return
        
        from slack_sdk import WebhookClient
        try:
            client = WebhookClient(SLACK_WEBHOOK_URL)
            response = client.send(blocks=blocks)
            print(f"✅ Slack gesendet! Status: {response.status_code}")
        except Exception as e:
            print(f"❌ Slack Fehler: {e}")
    
    async def run(self):
        print("🚀 Wien Deal Aggregator...")
        print("=" * 50)
        
        await self.scrape_instagram()
        self.filter_deals()
        
        blocks = self.format_for_slack()
        await self.send_to_slack(blocks)
        
        print("=" * 50)
        print("✅ Fertig!")

if __name__ == "__main__":
    import asyncio
    collector = DealCollector()
    asyncio.run(collector.run())

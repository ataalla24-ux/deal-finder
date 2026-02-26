import scrapy
from scrapy_playwright.page import PageMethod
import json

class WienDealsSpider(scrapy.Spider):
    name = "wien_deals"
    
    start_urls = [
        'https://www.instagram.com/explore/tags/wiengratis/',
        'https://www.instagram.com/explore/tags/aktionwien/',
        'https://www.instagram.com/explore/tags/wienfood/',
        'https://www.instagram.com/explore/tags/wieneats/',
        'https://www.instagram.com/explore/tags/foodsharingwien/',
    ]
    
    custom_settings = {
        'DOWNLOAD_HANDLERS': {
            'http': 'scrapy_playwright.handler.ScrapyPlaywrightDownloadHandler',
            'https': 'scrapy_playwright.handler.ScrapyPlaywrightDownloadHandler',
        },
        'TWISTED_REACTOR': 'twisted.internet.asyncioreactor.AsyncioSelectorReactor',
        'PLAYWRIGHT_BROWSER_TYPE': 'chromium',
        'PLAYWRIGHT_LAUNCH_OPTIONS': {
            'headless': True,
            'args': ['--no-sandbox']
        },
        'DOWNLOAD_DELAY': 2,
    }
    
    def parse(self, response):
        self.logger.info(f"=== Scraping: {response.url} ===")
        
        # Get page content after JavaScript rendered
        content = response.text
        self.logger.info(f"Content length: {len(content)}")
        
        # Look for post links
        posts = response.css('a[href*="/p/"]::attr(href)').getall()
        self.logger.info(f"Found {len(posts)} /p/ links")
        
        for post_url in posts[:30]:
            yield {
                'url': post_url,
                'source': response.url,
                'type': 'instagram_post'
            }
        
        # Also get article text
        articles = response.css('article').getall()
        self.logger.info(f"Found {len(articles)} articles")

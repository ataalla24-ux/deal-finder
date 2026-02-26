# Vienna Deals Collector - GitHub Workflow

This workflow automates collecting Vienna deals from Instagram hashtags.

## ⚠️ Important Note
Instagram blocks automated scraping. For production, you need:
1. **Apify Instagram scraper** (~$20-30/month) - bypasses anti-bot
2. **Or use authenticated browser** - like the OpenClaw browser approach used here

## Workflow Structure

```yaml
# .github/workflows/collect-deals.yml
name: Collect Vienna Deals

on:
  schedule:
    # Run daily at 8 AM
    - cron: '0 8 * * *'
  workflow_dispatch:

jobs:
  collect-deals:
    runs-on: ubuntu-latest
    steps:
      - name: Checkout
        uses: actions/checkout@v4
      
      - name: Run Instagram Scraper
        run: |
          # Option 1: Apify (recommended for production)
          # apify run instagram-scraper --hashtags "wiengratis,wienparty,aktionwien"
          
          # Option 2: Custom Python script
          python3 scripts/collect_deals.py
      
      - name: Parse and Filter Deals
        run: |
          python3 scripts/filter_deals.py --date "$(date +%Y-%m-%d)"
      
      - name: Generate Report
        run: |
          python3 scripts/generate_report.py
      
      - name: Post to Slack
        uses: 8398a7/action-slack@v3
        with:
          status: ${{ job.status }}
          fields: repo,message
        env:
          SLACK_WEBHOOK: ${{ secrets.SLACK_WEBHOOK }}
```

## Manual Collection Script

For now, use the browser-based approach:

```python
#!/usr/bin/env python3
"""
Instagram Vienna Deals Collector
Requires: Playwright + authenticated session
"""

HASHTAGS = [
    "wiengratis", "aktionwien", "angebotwien",
    "wienparty", "wienevents", "wiennightlife", 
    "wienfood", "wieneats", "wiencafe",
    "gewinnspielwien", "rabattwien"
]

def collect_posts(browser, hashtag):
    """Navigate to hashtag and collect posts"""
    # This requires authenticated browser session
    pass

def parse_deal(post):
    """Extract deal info from post"""
    # Parse date from "Photo by X on February 18, 2026"
    pass

def filter_current_deals(deals, cutoff_date):
    """Filter deals within valid date range"""
    pass
```

## Deployment Options

### Option 1: Apify (Recommended)
```bash
# Install Apify CLI
npm install -g apify-cli

# Run Instagram scraper
apify run instagram-scraper \
  --hashtags "wiengratis,wienparty" \
  --results 100 \
  --browser-type chromium
```

### Option 2: Self-Hosted Runner with Browser
```yaml
# For more control, use self-hosted runner with browser
jobs:
  collect:
    runs-on: self-hosted
    steps:
      - name: Open Browser
        run: |
          playwright install chromium
```

## Environment Variables
```
INSTAGRAM_SESSION=your_session_cookie
APIFY_API_KEY=your_api_key
SLACK_WEBHOOK=https://hooks.slack.com/...
```

## Current Results
See `deals_$(date +%Y-%m-%d).json` for today's deals.

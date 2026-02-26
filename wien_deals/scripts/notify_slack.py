#!/usr/bin/env python3
"""
Slack Notification & Approval Workflow
Sends deals to Slack, handles approvals
"""
import json
import os
import requests
from datetime import datetime

SLACK_WEBHOOK = os.environ.get("SLACK_WEBHOOK", "")
APPROVAL_CHANNEL = os.environ.get("APPROVAL_CHANNEL", "#deals-approve")
PUBLISHED_CHANNEL = os.environ.get("PUBLISHED_CHANNEL", "#wien-deals")

def create_deal_blocks(deals):
    """Create Slack block kit for deals"""
    blocks = [
        {
            "type": "header",
            "text": {
                "type": "plain_text",
                "text": "🎯 Neue Wien Deals gefunden!",
                "emoji": True
            }
        },
        {
            "type": "section",
            "text": {
                "type": "mrkdwn",
                "text": f"*Gesammelt:* {datetime.now().strftime('%d.%m.%Y %H:%M')}\n*Anzahl:* {len(deals)} Deals"
            }
        },
        {"type": "divider"}
    ]
    
    for i, deal in enumerate(deals[:10], 1):  # Max 10 per message
        deal_text = format_deal_text(deal)
        blocks.append({
            "type": "section",
            "text": {
                "type": "mrkdwn",
                "text": f"*#{i}.* {deal_text}"
            },
            "accessory": {
                "type": "button",
                "text": {
                    "type": "plain_text",
                    "text": "✅ Approve",
                    "emoji": True
                },
                "value": f"approve_{i}",
                "action_id": f"approve_deal_{i}"
            }
        })
    
    if len(deals) > 10:
        blocks.append({
            "type": "section",
            "text": {
                "type": "mrkdwn",
                "text": f"_...und noch {len(deals) - 10} weitere Deals_"
            }
        })
    
    blocks.append({"type": "divider"})
    blocks.append({
        "type": "actions",
        "elements": [
            {
                "type": "button",
                "text": {
                    "type": "plain_text",
                    "text": "✅ Alle Approven",
                    "emoji": True
                },
                "style": "primary",
                "value": "approve_all",
                "action_id": "approve_all"
            },
            {
                "type": "button",
                "text": {
                    "type": "plain_text",
                    "text": "❌ Alle Ablehnen",
                    "emoji": True
                },
                "style": "danger",
                "value": "reject_all",
                "action_id": "reject_all"
            }
        ]
    })
    
    return blocks

def format_deal_text(deal):
    """Format deal as Slack text"""
    deal_type = deal.get("type", "deal")
    name = deal.get("name", deal.get("title", "Unnamed"))
    details = deal.get("details", deal.get("description", ""))
    date = deal.get("date", "")
    location = deal.get("location", deal.get("address", ""))
    
    text = f"*{name}*"
    if date:
        text += f"\n📅 {date}"
    if location:
        text += f"\n📍 {location}"
    if details:
        text += f"\n{details}"
    
    return text

def send_to_slack(deals, webhook_url=None):
    """Send deals to Slack for approval"""
    url = webhook_url or SLACK_WEBHOOK
    
    if not url:
        print("⚠️ No Slack webhook configured")
        print("   Set SLACK_WEBHOOK environment variable")
        # Save locally instead
        save_pending_approval(deals)
        return False
    
    blocks = create_deal_blocks(deals)
    
    payload = {
        "blocks": blocks,
        "text": f"🎯 {len(deals)} neue Wien Deals gefunden! Approve für App-Veröffentlichung."
    }
    
    response = requests.post(url, json=payload)
    
    if response.status_code == 200:
        print("✅ Deals sent to Slack!")
        return True
    else:
        print(f"❌ Slack error: {response.status_code}")
        save_pending_approval(deals)
        return False

def save_pending_approval(deals):
    """Save deals pending approval locally"""
    filename = f"pending_approval_{datetime.now().strftime('%Y%m%d_%H%M%S')}.json"
    with open(filename, 'w', encoding='utf-8') as f:
        json.dump({
            "created_at": datetime.now().isoformat(),
            "deals": deals
        }, f, indent=2)
    print(f"💾 Saved to {filename} (pending approval)")

def publish_approved(deals):
    """Publish approved deals to app channel"""
    # Save to published deals
    filename = f"published_{datetime.now().strftime('%Y%m%d')}.json"
    with open(filename, 'w', encoding='utf-8') as f:
        json.dump({
            "published_at": datetime.now().isoformat(),
            "deals": deals
        }, f, indent=2)
    
    # Also save as current deals for app
    with open("current_deals.json", 'w', encoding='utf-8') as f:
        json.dump({
            "updated_at": datetime.now().isoformat(),
            "deals": deals
        }, f, indent=2)
    
    print(f"✅ Published {len(deals)} deals to app!")
    return filename

def load_pending():
    """Load pending approval deals"""
    import glob
    files = glob.glob("pending_approval_*.json")
    if not files:
        return []
    
    latest = max(files)
    with open(latest, 'r') as f:
        data = json.load(f)
    return data.get("deals", [])

def main():
    import sys
    
    if len(sys.argv) < 2:
        print("Usage:")
        print("  python notify_slack.py send <deals.json>")
        print("  python notify_slack.py publish <deals.json>")
        print("  python notify_slack.py pending")
        return
    
    action = sys.argv[1]
    
    if action == "send" and len(sys.argv) > 2:
        with open(sys.argv[2], 'r') as f:
            data = json.load(f)
        deals = data.get("deals", [])
        send_to_slack(deals)
    
    elif action == "publish" and len(sys.argv) > 2:
        with open(sys.argv[2], 'r') as f:
            data = json.load(f)
        deals = data.get("deals", [])
        publish_approved(deals)
    
    elif action == "pending":
        deals = load_pending()
        print(f"Pending: {len(deals)} deals")

if __name__ == "__main__":
    main()

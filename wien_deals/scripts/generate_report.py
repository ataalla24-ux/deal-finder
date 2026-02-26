#!/usr/bin/env python3
"""
Generate Deal Report
Creates markdown report from collected deals
"""
import json
from datetime import datetime
from pathlib import Path

def load_deals():
    """Load deals from collection"""
    try:
        with open("deals.json", "r") as f:
            return json.load(f)
    except FileNotFoundError:
        return {"collected_at": datetime.now().isoformat(), "total": 0, "deals": []}

def generate_markdown(data):
    """Generate markdown report"""
    deals = data.get("deals", [])
    
    md = f"""# Wien Deals - {datetime.now().strftime('%d.%m.%Y')}

## Zusammenfassung
- **Gesammelt:** {data.get('collected_at', 'N/A')}
- **Anzahl:** {len(deals)} Deals

---

"""
    
    # Categorize deals
    categories = {}
    for deal in deals:
        cat = deal.get("type", "Sonstiges")
        if cat not in categories:
            categories[cat] = []
        categories[cat].append(deal)
    
    # Write by category
    for category, cat_deals in categories.items():
        md += f"## {category}\n\n"
        for i, deal in enumerate(cat_deals, 1):
            name = deal.get("name", deal.get("title", "Unnamed"))
            details = deal.get("details", deal.get("description", ""))
            date = deal.get("date", "")
            location = deal.get("location", "")
            
            md += f"### {i}. {name}\n"
            if date:
                md += f"**Datum:** {date}\n"
            if location:
                md += f"**Ort:** {location}\n"
            if details:
                md += f"{details}\n"
            md += "\n"
    
    return md

def main():
    print("📝 Generating deal report...")
    
    data = load_deals()
    md = generate_markdown(data)
    
    # Save markdown
    filename = f"DEALS_{datetime.now().strftime('%Y-%m-%d')}.md"
    with open(filename, "w", encoding="utf-8") as f:
        f.write(md)
    
    # Also update current
    with open("current_deals.md", "w", encoding="utf-8") as f:
        f.write(md)
    
    print(f"✅ Report saved: {filename}")
    print(f"   Total deals: {data.get('total', 0)}")

if __name__ == "__main__":
    main()

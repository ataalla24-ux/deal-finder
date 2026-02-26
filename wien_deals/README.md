# 🎯 Vienna Deals Collector

Automatisiertes System zum Sammeln und Veröffentlichen von kostenlosen Wien Deals.

## 📁 Struktur

```
wien_deals/
├── .github/
│   └── workflows/
│       └── collect-deals.yml    # GitHub Actions Workflow
├── scripts/
│   ├── collect_deals.py         # Sammelt Deals
│   ├── notify_slack.py          # Slack Benachrichtigungen
│   └── generate_report.py       # Erstellt Bericht
├── approved_deals.json          # Approvte Deals für App
├── current_deals.json           # Aktuelle Deals für App
└── README.md
```

## 🔧 Setup

### 1. GitHub Repository erstellen

```bash
# Repository klonen oder neu erstellen
git init wien-deals
cd wien-deals
```

### 2. Secrets konfigurieren

Im GitHub Repository unter `Settings > Secrets and variables > Actions`:

| Secret | Beschreibung |
|--------|--------------|
| `SLACK_WEBHOOK` | Slack Webhook URL für Benachrichtigungen |

### 3. Slack Setup

1. **Incoming Webhook** erstellen:
   - Slack App Directory → Incoming Webhooks
   - Neuen Webhook hinzufügen
   - Channel wählen (z.B. `#deals-approve`)

2. **Approval Workflow** (optional):
   - Slack App mit Interactivity
   - Buttons für Approve/Reject

## 🚀 Workflow

```
┌─────────────┐    ┌──────────────┐    ┌─────────────┐
│  Daily 8AM  │───▶│  Collect    │───▶│  Commit    │
│  GitHub     │    │  Deals      │    │  to Repo   │
└─────────────┘    └──────────────┘    └─────────────┘
                                               │
                                               ▼
                    ┌──────────────┐    ┌─────────────┐
                    │  Slack       │◀───│  Notify     │
                    │  Approval    │    │  Slack      │
                    └──────────────┘    └─────────────┘
                           │
                           ▼ (User approves)
                    ┌──────────────┐    ┌─────────────┐
                    │  Approved    │───▶│  Publish    │
                    │  Deals       │    │  to App     │
                    └──────────────┘    └─────────────┘
```

## 📋 Commands

### Lokal testen

```bash
# Deals sammeln
python scripts/collect_deals.py

# Report generieren
python scripts/generate_report.py

# An Slack senden
python scripts/notify_slack.py send deals.json

# Approvte Deals veröffentlichen
python scripts/notify_slack.py publish approved_deals.json
```

## 🔴 Instagram Limitation

**Wichtig:** Instagram blockt automatisierte Browser-Scraping.

### Lösung: Apify (€20-30/Monat)

```bash
# Apify installieren
npm install -g apify-cli

# Instagram Scraper nutzen
apify run apify/instagram-scraper \
  --hashtags "wiengratis,wienparty,aktionwien" \
  --results 100
```

Oder: Browser-Authentifizierung mit Self-Hosted Runner.

## 📱 App Veröffentlichung

1. **Täglich:** GitHub sammelt Deals → Slack Notification
2. **User:** Approve/Reject in Slack
3. **Approved:** → `approved_deals.json` → App liest JSON

## 📦 Deal Types

- `free_event` - Kostenlose Events
- `foodsharing` - Foodsharing/Fair-Teiler
- `restaurant_deal` - Restaurant Aktionen
- `giveaway` - Gewinnspiele
- `discount` - Rabatte

## 🔒 Umgebungsvariablen

| Variable | Beschreibung |
|----------|--------------|
| `SLACK_WEBHOOK` | Slack Webhook URL |
| `APPROVAL_CHANNEL` | Channel für Approvals |
| `PUBLISHED_CHANNEL` | Channel für veröffentlichte Deals |

## 📝 Lizenz

MIT

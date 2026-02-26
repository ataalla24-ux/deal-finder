# 📱 Slack Setup für FreeFinder Wien

## Schritt 1: Slack App erstellen

1. Gehe zu https://api.slack.com/apps
2. Klicke auf **"Create New App"**
3. Wähle **"From scratch"**
4. App Name: `FreeFinder Wien`
5. Workspace: Dein Slack Workspace

## Schritt 2: Bot Scopes hinzufügen

Gehe zu **OAuth & Permissions** und füge folgende Scopes hinzu:

### Bot Token Scopes
- `chat:write` - Nachrichten senden
- `reactions:read` - Reactions lesen
- `reactions:write` - Reactions hinzufügen
- `channels:history` - Kanalhistorie lesen
- `channels:read` - Kanäle auflisten

### Bot Token installieren
1. Scrolle zu **OAuth Tokens for Your Workspace**
2. Klicke auf **"Install to Workspace"**
3. Kopiere den **Bot User OAuth Token** (xoxb-...)

## Schritt 3: Kanal erstellen

1. Erstelle einen neuen Kanal in Slack: `#freefinder-deals`
2. Lade die App hinzu: `/invite @FreeFinder Wien`

## Schritt 4: GitHub Secrets setzen

Gehe zu deinem GitHub Repo → Settings → Secrets and variables → Actions

### Secrets erstellen:

| Secret Name | Wert |
|-------------|------|
| `SLACK_BOT_TOKEN` | xoxb-... (Bot Token von Schritt 2) |
| `SLACK_CHANNEL_ID` | Kanal ID (z.B. C01ABCDEF) |

### Kanal ID finden:
1. Im Slack Kanal: Rechtsklick auf Kanalname
2. "Copy channel link" → ID aus Link extrahieren
3. Oder: `https://app.slack.com/client/T01.../C01ABCDEF` → ID = C01ABCDEF

## Schritt 5: Testen

1. Starte den Scraper manuell:
   ```bash
   gh workflow run instagram.yml
   ```

2. Prüfe ob im Slack Kanal:
   - Summary Nachricht erscheint
   - Jeder Deal als Thread-Reply
   - Jeder Deal hat eine ✅ Reaction

## Täglicher Ablauf

| Zeit | Was passiert |
|------|-------------|
| **12:00** | Scraper läuft → ~150-300 potentielle Deals |
| **12:05** | Slack Nachricht mit allen Deals als Thread |
| **12:05-16:00** | Du scrollst durch, ✅ auf gute Deals |
| **16:00** | Approve-Workflow liest ✅ Reactions |
| **16:05** | Genehmigte Deals sind live! |

## Slack Nachrichten Format

### Summary
```
📸 FreeFinder Wien — 247 neue Deals gefunden
📅 15.02.2026

🆓 23x Gratis
💰 189x Rabatt
🎰 35x Gewinnspiel

Reagiere mit ✅ auf Deals die live gehen sollen!
```

### Deal (Thread Reply)
```
1. 🥙 Deals Döner - Neueröffnung 🔥
_@kebap_house_wien_
📍 1020 Wien | Score: 85

Büyük açılış! Bedava döner herkese!
🔗 instagram.com/p/...
```

### Reagieren
- ✅ = Deal live schalten
- ❌ = Deal ablehnen (optional)

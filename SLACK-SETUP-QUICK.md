# 🚀 Schnellstart - Slack Integration

## Schritt 1: Slack App erstellen

1. Gehe zu **https://api.slack.com/apps**
2. Klick **"Create New App"** → **"From scratch"**
3. Name: `FreeFinder Wien`
4. Workspace: Wähle deinen Slack Workspace

## Schritt 2: Permissions

Nach Erstellung:
1. Links auf **"OAuth & Permissions"** klicken
2. Scroll zu **"Scopes"** → **"Bot Token Scopes"**
3. Add Scopes:
   - `chat:write`
   - `channels:read`
   - `reactions:read`
   - `reactions:write`

## Schritt 3: Install App

1. Oben auf **"Install to Workspace"** klicken
2. **"Allow"** klicken
3. Kopiere den **Bot User OAuth Token** (fängt mit `xoxb-` an)

## Schritt 4: Kanal ID

1. In Slack: Kanal `#freefinder-deals` erstellen (oder beliebigen Kanal)
2. Im Kanal: Rechts auf ⋮ → **"Copy channel ID"**
3. Die ID beginnt mit `C`

## Schritt 5: GitHub Secrets

1. Gehe zu: https://github.com/ataalla24-ux/deal-finder/settings/secrets/actions
2. **"New repository secret"**:
   - Name: `SLACK_BOT_TOKEN`
   - Value: `xoxb-...` (dein Token)
3. Nochmal:
   - Name: `SLACK_CHANNEL_ID`
   - Value: `C...` (deine Kanal ID)

---

## ✅ Fertig!

Um 12:00 und 16:00 läuft alles automatisch.

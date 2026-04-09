# FreeFinder UI Spec

Stand: 2026-04-09

## Visual Thesis

FreeFinder soll wirken wie ein kuratierter Wiener Deal-Guide: freundlich, warm, lokal, schnell erfassbar und hochwertig, aber nie billig, schrill oder werblich.

## Content Plan

1. Home zeigt sofort den besten aktuellen Nutzen.
2. Der Feed verkauft Klarheit und Geschwindigkeit, nicht Buntheit.
3. "Für dich" zeigt zuerst Empfehlungen, erst danach Premium-Reize.
4. PRO wirkt wie ein sauberes Upgrade, nicht wie ein Banner oder Werbeblock.

## Interaction Thesis

1. Home-Elemente sollen schnell und direkt reagieren, ohne visuelle Hektik.
2. Die wichtigsten Zustände werden über Kontrast, Füllung und Ruhe vermittelt, nicht über viele Farben.
3. Modal- und Popup-Flächen sollen sich wie iOS-Sheets anfühlen: weich, klar, leicht.

## Brand Principles

- warm statt hart
- kuratiert statt billig
- reduziert statt verspielt
- nützlich statt werblich

## Color System

Nur eine dominante Hauptfarbe plus ein zurückhaltender Akzent.

- Primary: `#F79A2E`
- Primary Deep: `#E67E22`
- Primary Soft: `#FDE7C7`
- Accent Ink: `#5A4A43`
- Background: `#FFF9F2`
- Surface: `#FFFFFF`
- Surface Warm: `#FFF6EC`
- Border: `#EADFD2`
- Text Strong: `#201A17`
- Text Secondary: `#746B63`
- Success: `#22A06B`
- Danger Soft: `#FBE4DE`

Regeln:

- Kein zweiter starker Farbblock neben Orange im selben Hauptbereich.
- Lila, Pink und Blau nur noch sekundär oder gar nicht.
- Hero darf einen einzigen warmen Verlauf nutzen.
- Routine-Flächen bleiben weiß oder minimal warm getönt.

## Typography

Maximal drei sichtbare Gewichtsstufen pro Screen.

- Screen Title: `28/32`, `700`
- Section Title: `20/24`, `600`
- Card Title: `17/22`, `600`
- Body: `15/21`, `400`
- Meta: `13/18`, `500`
- Chip: `12/16`, `600`
- Button: `15/18`, `600`

Regeln:

- Titel nie mit Meta-Text konkurrieren lassen.
- Meta-Infos heller statt gleichzeitig kleiner und fetter.
- Buttons und Chips nicht mit zu vielen Schriftgrößen mischen.

## Radius, Border, Shadow

- Card Radius: `20px`
- Chip Radius: `999px`
- Button Radius: `16px`
- Modal Radius: `24px`
- Border: `1px solid #EADFD2`
- Standard Shadow: `0 10px 30px rgba(32, 26, 23, 0.08)`
- Soft Shadow: `0 6px 18px rgba(32, 26, 23, 0.06)`

Regeln:

- Keine glowy Schatten.
- Keine harten roten Outline-Karten als Standardzustand.
- Card-Hierarchie über Abstände und Typo, nicht über dicke Konturen.

## Spacing System

- 4
- 8
- 12
- 16
- 20
- 24
- 32

Regeln:

- Hauptsektionen immer mit `24px` Luft trennen.
- Inhalte innerhalb einer Card meist `16px` oder `20px`.
- Kleine Meta-Gruppen `8px`.

## Home

Ziel: schnell, vertrauenswürdig, hochwertig.

Reihenfolge:

1. Streak
2. Deal des Tages
3. Filterchips
4. Deal-Feed

### Home Hero

Der Hero bleibt die lauteste Fläche im Screen.

Regeln:

- ein einziger orangefarbener Verlauf
- klar gestufter Inhalt: Label, Titel, Subtext, Countdown, CTA
- Countdown kleiner und ruhiger als heute
- CTA nur eine Primäraktion
- keine zweite Promo-Fläche direkt darunter

### Filterchips

Regeln:

- aktiv: warme Fläche, dunkler Text
- inaktiv: weiße Fläche, Border
- gleiche Höhe für alle Chips
- keine schweren Schatten

### Deal Cards

Ziel: eher editorial als promo-haft.

Regeln:

- weiße Card mit feiner Border
- Badge-Gruppe oben links
- Bewertung oben rechts
- Titel maximal 2 Zeilen
- Meta-Zeile für Ort, Datum, Gültigkeit deutlich leichter
- CTA als ruhiger Primärbutton
- Social-/Community-Aktionen deutlich sekundärer

Nicht tun:

- mehrere starke Farbblöcke innerhalb einer Deal-Card
- harte Warnrahmen um die gesamte Card
- Badge-Chaos

## Für Dich

Ziel: Empfehlungen zuerst, Monetarisierung später.

Reihenfolge:

1. Für dich empfohlen
2. Beliebt in Wien
3. Neue starke Deals
4. Ein einziges PRO-Modul weiter unten

Regeln:

- echte Inhalte zuerst
- keine großen Sperrboxen im oberen Bereich
- PRO als elegant eingebettetes Upgrade-Modul
- Empfehlungen sollen wie Nutzen wirken, nicht wie Paywall

## Stats

Ziel: wertig und klar, auch ohne PRO nicht kalt oder leer.

Regeln:

- wenn gesperrt: kleine Vorschau statt harte Wand
- ein klarer Nutzen-Satz
- ein Upgrade-Modul statt mehrere Hinweisboxen

## PRO / Referral

Ziel: wie ein hochwertiges Upgrade-Sheet, nicht wie Werbung.

Struktur:

1. kleines Symbol oder Krone
2. kurzer Titel
3. eine Nutzenzeile
4. 3 bis 4 Vorteile
5. ein Hauptbutton
6. ein sekundärer Textlink

Beispiel-Vorteile:

- Deal des Tages zuerst
- Personalisierte Alerts
- Standort-Filter
- Smarteres Für dich

Regeln:

- weißes Modal
- wenig innere Boxen
- viel Luft
- nur ein Hauptbutton
- WhatsApp darf Primärbutton sein
- "Link kopieren" nur sekundär

Nicht tun:

- grün, blau, lila und orange gleichzeitig im selben Popup
- zu viele Feature-Kacheln
- zu viel Text

## Bottom Navigation

Ziel: clean wie X/AJet, aber mit FreeFinder-Wärme.

Regeln:

- weiße Capsule
- Icons größer als Labels
- Labels optional klein oder nur für aktiven Zustand
- aktiver Zustand über Füllung/Kontrast, nicht über viele Farben
- keine übertriebenen Schatten

## Popups und Sheets

Regeln:

- gleicher Radius wie andere große Flächen
- gleiche Typo-Logik wie im Rest der App
- keine eigene Werbe-Farbwelt
- Sheet-Header immer kurz und klar

## Component Rules

### Buttons

- genau ein Primärbutton pro Modul
- Sekundäraktionen als Textbutton oder Ghost-Button

### Badges

- maximal zwei dominante Badges gleichzeitig
- `gratis` und `1+1` dürfen stark sein
- `neu`, `hot`, `pro` zurückhaltender

### Meta

- Ort, Zeit, Ablauf immer leicht und sekundär
- Meta nie größer oder lauter als der Titel

## Motion

Nur subtile Motion.

- leichter Hero-Fade beim Laden
- sanfter Section-Reveal
- Bottom-Nav-State weich, nicht springend

Nicht tun:

- flashy Promo-Animationen
- aggressive Bounces
- zu viele gleichzeitige Bewegungen

## What To Change Next

### Sprint 1

1. Home beruhigen und Deal-Cards vereinheitlichen
2. "Für dich" auf Recommendation-first umbauen
3. PRO-/Referral-Sheet vereinfachen und angleichen

### Sprint 2

1. Stats-Lockscreen als Preview statt harte Sperre
2. Badges und Meta-System komplett vereinheitlichen
3. Popups und Sheets auf denselben Surface-Stil ziehen

## Definition Of Done

Das Redesign ist erfolgreich, wenn:

- Home, Für dich und PRO sichtbar aus einer Designfamilie kommen
- Orange die klare Primärfarbe bleibt
- Meta-Infos, Cards und Buttons dieselbe Hierarchie sprechen
- die App sich ruhiger und hochwertiger anfühlt, ohne den Deal-Charakter zu verlieren

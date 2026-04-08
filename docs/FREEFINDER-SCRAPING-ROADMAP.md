# FreeFinder Scraping Roadmap

Stand: 2026-04-08

## Zielbild

FreeFinder soll taeglich moeglichst viele echte Wiener Gratis-, 1+1- und starke Food-/Drink-Promos finden, ohne dass wir von einem einzelnen Scraper oder einer einzelnen Plattform abhaengig sind.

Das Ziel ist nicht "mehr Scraper", sondern eine Deal-Meta-Engine:

1. viele Quellen sammeln Kandidaten
2. eine zentrale Schicht bewertet und dedupliziert
3. gute Quellen werden automatisch staerker gewichtet
4. schwache Quellen werden schnell sichtbar und gezielt verbessert

## Nordstern

- mehr echte Gratis-/1+1-Deals in Wien
- weniger irrelevante Werbung
- stabilere taegliche Ausbeute
- weniger Blindflug beim Optimieren

## Aktueller Stand

Schon live:

- taeglicher Source-Health-Report
- zentrales Kandidaten-Index-JSON
- Mission-Fit-Score fuer Wiener Food-/Drink-Deals
- Daily Sync Instagram laeuft wieder account-first ueber API + Browser-Fallback

Aktuelle groesste Luecken:

- Daily Sync Instagram findet noch zu wenig echte Merchant-Posts
- Key 4 und Key 5 sind noch zu schwach
- Key 2 ist aktuell leer
- wir haben noch keine zentrale Final-Decision-Engine fuer alle Kandidaten
- Merchant-/Account-Wissen ist noch nicht als eigene Registry gespeichert

## KPIs

Wir optimieren kuenftig gegen diese Kennzahlen:

- `daily_unique_candidates`
- `daily_final_deals`
- `fresh_1d_rate`
- `vienna_rate`
- `food_drink_rate`
- `promo_signal_rate`
- `duplicate_cluster_count`
- `source_health_score`
- `mission_fit_score`

## Phase 1: Observability und Foundations

Status: gestartet

Deliverables:

- [x] `deal-source-health.json`
- [x] `deal-candidates-index.json`
- [x] taegliche Health-Auswertung im Digest-Workflow
- [x] klare Top-Quellen und Fix-Kandidaten
- [ ] `instagram-merchant-registry.json`
- [ ] taeglicher Merchant-Bootstrap fuer Daily Sync
- [ ] ehrlicher Daily-Sync-Diagnosepfad fuer Kandidaten, besuchte Posts und Ablehnungsgruende

## Phase 2: Instagram-System stabilisieren

Status: in Arbeit

Deliverables:

- [ ] Daily Sync account-first statt hashtag-first
- [ ] Merchant-Account-Graph aus echten Wiener Deal-Accounts
- [ ] Search-basierte Instagram-Account-Discovery
- [ ] Key 4 klar auf Coffee/Openings/Freebies
- [ ] Key 5 klar auf harte Gastro-Promos
- [ ] tote Fallbacks reduzieren oder entfernen

## Phase 3: Candidate Engine

Status: geplant

Deliverables:

- [ ] gemeinsames Kandidatenformat fuer alle Scraper
- [ ] zentrale Final-Decision-Engine
- [ ] einheitliche Wien-/Frische-/Promo-/Giveaway-Checks
- [ ] gemeinsame Dedupe-Signaturen ueber alle Quellen
- [ ] gemeinsamer Confidence- und Priority-Score

## Phase 4: Ranking und Alerts

Status: geplant

Deliverables:

- [ ] Ranking nach Mission-Fit statt nur Rohreihenfolge
- [ ] persoenliche Alerts fuer Kategorien, Bezirke und Marken
- [ ] History fuer Merchant- und Source-Qualitaet
- [ ] "best today" / "fresh now" / "best coffee" Ansichten

## Workstreams

### A. Discovery

- neue Quellen finden
- starke Accounts priorisieren
- tote Quellen rausnehmen

### B. Validation

- echte Deals von normalem Marketing trennen
- Frische, Wien, Promo, Giveaway sauber pruefen

### C. Dedupe

- gleiche Deals aus mehreren Quellen zusammenziehen
- URL, Brand, Titel, Ort und Zeitraum gemeinsam nutzen

### D. Ranking

- gute Gratis-/1+1-Deals nach oben
- schwache oder generische Sachen nach unten

## Reihenfolge ab jetzt

1. Merchant-Registry fuer Instagram bauen
2. Daily Sync damit fuettern
3. Daily Sync Report pruefen
4. Key 4 und Key 5 gezielt nachziehen
5. Candidate Engine fuer alle Scraper starten

## Definition of Done fuer das naechste Paket

Das naechste Paket ist erfolgreich, wenn:

- Daily Sync eine eigene Merchant-Registry nutzt
- die Registry automatisch aus echten Deal-Daten aktualisiert wird
- der Daily-Sync-Run sichtbar mehr relevante Accounts prueft
- die neue Registry im Repo gespeichert und taeglich aktualisiert wird


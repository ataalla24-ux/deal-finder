# FreeFinder Scraping Roadmap

Stand: 2026-04-08

## Zielbild

FreeFinder soll taeglich moeglichst viele echte Wiener Gratis-, 1+1- und starke Food-/Drink-Promos finden, ohne dass wir von einem einzelnen Scraper oder einer einzelnen Plattform abhaengig sind.

Das Ziel ist nicht "mehr Scraper", sondern eine Deal-Meta-Engine:

1. viele Quellen sammeln Kandidaten
2. eine zentrale Schicht bewertet und dedupliziert
3. gute Quellen werden automatisch staerker gewichtet
4. schwache Quellen werden schnell sichtbar und gezielt verbessert

## Was wir von Skyscanner uebernehmen

Skyscanner ist nicht stark, weil ein einzelner Collector besonders klug ist. Sie gewinnen durch Systemdesign. Dieselben Prinzipien gelten fuer FreeFinder:

1. Sammlung und Entscheidung trennen
   Scraper sammeln breit, die zentrale Engine entscheidet streng.
2. Coverage und Precision getrennt optimieren
   Mehr Kandidaten finden ist nicht dasselbe wie gute Enddeals liefern.
3. History statt Bauchgefuehl
   Quellen, Merchants und Deal-Muster ueber Zeit bewerten.
4. Source Weighting
   Starke Quellen automatisch haeufiger und prominenter nutzen.
5. Dedupe als Kernfunktion
   Derselbe Deal darf aus vielen Wegen kommen, aber nur einmal beim Nutzer landen.
6. Ranking statt nur Liste
   Die besten, frischesten und relevantesten Deals muessen zuerst sichtbar sein.
7. Resilience
   Wenn Instagram schwach ist, muessen andere Systeme trotzdem tragen.
8. Exploration
   Nicht nur "alles", sondern spaeter auch "nur gratis", "nur Kaffee", "nur heute", "nahe bei mir".

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
- Merchant-/Account-Wissen ist jetzt als Registry gespeichert, aber noch nicht breit genug und noch nicht stark genug gewichtet

## KPIs

Wir optimieren kuenftig gegen diese Kennzahlen:

- `daily_total_candidates`
- `daily_unique_candidates`
- `daily_final_deals`
- `candidate_to_final_conversion`
- `fresh_1d_rate`
- `vienna_rate`
- `food_drink_rate`
- `promo_signal_rate`
- `duplicate_cluster_count`
- `source_health_score`
- `mission_fit_score`
- `coverage_score`
- `precision_score`
- `source_weight_score`

## Optimierungsachsen

### Coverage

Wie viele echte potenzielle Deals finden wir ueberhaupt?

- mehr starke Merchant-Accounts
- mehr robuste Quellen
- weniger tote Hashtag-Abhaengigkeit
- bessere Discovery neuer Accounts

### Precision

Wie sauber ist das, was am Ende wirklich beim Nutzer landet?

- bessere Promo-Erkennung
- Giveaway-/Werbe-Muell raus
- Wien-Relevanz sauber pruefen
- bessere Dedupe- und Ranking-Logik

### Resilience

Wie gut bleibt das System, wenn eine Quelle schwankt?

- Instagram nicht als Single Point of Failure
- Firecrawl, Web, Gutscheine, jö, weitere Quellen parallel
- Fallbacks nur dort, wo sie wirklich noch tragen

## Phase 1: Observability und Foundations

Status: gestartet

Deliverables:

- [x] `deal-source-health.json`
- [x] `deal-candidates-index.json`
- [x] taegliche Health-Auswertung im Digest-Workflow
- [x] klare Top-Quellen und Fix-Kandidaten
- [x] `instagram-merchant-registry.json`
- [x] taeglicher Merchant-Bootstrap fuer Daily Sync
- [ ] ehrlicher Daily-Sync-Diagnosepfad fuer Kandidaten, besuchte Posts und Ablehnungsgruende
- [x] Coverage- und Precision-Scores im taeglichen Report
- [x] Source-Weighting-Logik aus den taeglichen Reports ableiten

## Phase 2: Instagram-System stabilisieren

Status: in Arbeit

Deliverables:

- [x] Daily Sync account-first statt hashtag-first
- [x] Merchant-Account-Graph aus echten Wiener Deal-Accounts
- [x] Search-basierte Instagram-Account-Discovery
- [x] Merchant-Registry aus Live- und Pending-Deals weiter fuettern
- [x] Account-Priorisierung nach echter Deal-Leistung
- [ ] Key 4 klar auf Coffee/Openings/Freebies
- [ ] Key 5 klar auf harte Gastro-Promos
- [ ] tote Fallbacks reduzieren oder entfernen
- [x] unproduktive Hashtags aus dem Kernpfad entfernen

## Phase 3: Candidate Engine

Status: geplant

Deliverables:

- [ ] gemeinsames Kandidatenformat fuer alle Scraper
- [ ] zentrale Final-Decision-Engine
- [ ] einheitliche Wien-/Frische-/Promo-/Giveaway-Checks
- [ ] gemeinsame Dedupe-Signaturen ueber alle Quellen
- [ ] gemeinsamer Confidence- und Priority-Score
- [ ] Coverage- und Precision-Feedback zurueck an die einzelnen Sources

## Phase 4: Ranking und Alerts

Status: geplant

Deliverables:

- [ ] Ranking nach Mission-Fit statt nur Rohreihenfolge
- [ ] persoenliche Alerts fuer Kategorien, Bezirke und Marken
- [ ] History fuer Merchant- und Source-Qualitaet
- [ ] "best today" / "fresh now" / "best coffee" Ansichten
- [ ] Exploration-Surfaces wie "nur gratis", "nur 1+1", "nur heute", "nahe bei mir"

## Phase 5: Source Weighting und History

Status: geplant

Deliverables:

- [ ] taegliche Source-Weights aus Health- und Mission-Fit-Daten
- [ ] Merchant-Baselines: welcher Merchant liefert oft echte Deals, welcher nur Werbung
- [ ] Source-Baselines: welche Quellen sind stabil, welche brechen oft ein
- [ ] Ranking-Bonus fuer seltene und besondere Deals
- [ ] automatische Priorisierung starker Sources in Discovery und Scrape-Reihenfolge

## Phase 6: Resilience und Fallback-Design

Status: geplant

Deliverables:

- [ ] klares Fallback-Design pro Plattform
- [ ] tote externe Fallbacks entfernen
- [ ] alternative Inputs fuer Instagram-Schwankungen
- [ ] robustere Daily-Operation auch wenn einzelne Plattformen schwach laufen

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

### E. History

- wiederkehrende Merchant-Muster speichern
- echte Sonderaktionen von normalem Marketing trennen
- Quellen ueber Zeit bewerten

### F. Weighting

- starke Quellen staerker priorisieren
- schwache nur noch sekundär laufen lassen
- Reihenfolge der Discovery datengetrieben steuern

### G. Exploration

- spaeter Such- und Entdeckungsflaechen fuer Nutzer bauen
- Deals nicht nur sammeln, sondern besser auffindbar machen

## Reihenfolge ab jetzt

1. Daily Sync Run mit Merchant-Registry auswerten
2. Daily Sync weiter auf starke Merchant-Accounts schärfen
3. Key 4 und Key 5 gezielt nachziehen
4. Coverage- und Precision-Scores im Health-Report ergänzen
5. Candidate Engine fuer alle Scraper starten
6. Source Weighting aus Health-Daten ableiten
7. History/Baselines aufbauen

## Definition of Done fuer das naechste Paket

Das naechste Paket ist erfolgreich, wenn:

- Daily Sync eine eigene Merchant-Registry nutzt
- die Registry automatisch aus echten Deal-Daten aktualisiert wird
- der Daily-Sync-Run sichtbar mehr relevante Accounts prueft
- die neue Registry im Repo gespeichert und taeglich aktualisiert wird
- die Roadmap Coverage, Precision, Weighting, History und Resilience explizit abbildet

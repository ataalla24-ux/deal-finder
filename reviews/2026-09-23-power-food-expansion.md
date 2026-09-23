# Power Scraper: Essen und Trinken, 23. September 2026

Implementiert in einer isolierten Arbeitskopie auf Basis von `d0914233f`.
Produktionsaktivierung noch nicht erfolgt. Keine Slack-Nachrichten versendet,
keine Deals automatisch veröffentlicht, keine automatischen Entfernungen aktiviert.

## Ergebnis der echten Anbieterabfragen

- 51 aktive Quellen insgesamt statt 39; davon 17 offizielle Food-Anbieter.
  Vier bisherige Food-Adapter ersetzt und die doppelte Billa-Quelle entfernt.
- 28 Food-Kandidaten, davon 25 nach erneuter Quellenprüfung und zentraler
  Wien-/Gültigkeitsprüfung. Alle 25 überstehen Dispatch- und Freigabe-Deduplizierung.
- Dies sind Freigabekandidaten, keine 25 bereits veröffentlichten oder garantiert
  zusätzlichen Live-Deals. Filialteilnahme und Bedingungen bleiben sichtbar.
- Drei gesperrt: Vapiano Pasta und McDonald's Wochenstart ohne ausreichenden
  Wien-Beleg; zusätzlicher Der-Mann-Startseitentext mit Orts-/Frischeproblem.
- Vollständiger 51-Quellen-Lauf: 31 Collector-Kandidaten insgesamt. Ohne Browser
  waren 14 Quellen vollständig fehlgeschlagen, überwiegend bestehende Händler-
  Sperren/404/Timeouts; diese Zahl ist nicht mit 51 funktionierenden Quellen gleichzusetzen.

## Anbieterertrag

| Anbieter | Gefunden | Zentrale Prüfung bestanden | Zustand |
|---|---:|---:|---|
| IKEA Food | 4 | 4 | candidates-found |
| Ströck | 8 | 8 | candidates-found |
| Der Mann | 2 | 1 | candidates-found |
| ANKER | 3 | 3 | candidates-found |
| Vapiano | 2 | 1 | candidates-found |
| Bäckerei Schwarz | 4 | 4 | candidates-found |
| NORDSEE | 0 | 0 | degraded |
| McDonald's | 1 | 0 | candidates-found |
| Burger King | 0 | 0 | degraded |
| KFC | 0 | 0 | no-offers |
| BackWerk | 0 | 0 | degraded |
| Shibuya | 1 | 1 | candidates-found |
| Santos | 1 | 1 | candidates-found |
| Bùi Viện Street | 1 | 1 | candidates-found |
| Eva & Adam | 1 | 1 | candidates-found |
| Cuadro | 0 | 0 | no-offers |
| MABEL'S No90 | 0 | 0 | no-offers |

## Funktionsumfang

DOM-basierte Angebotsblöcke statt bloßer Linküberschriften. Pro Anbieter maximal
fünf Seiten, ausschließlich freigegebene HTTPS-Domains; Begrenzung von Laufzeit
und Downloadgröße. HTTP 429 beendet die Abfrage ohne Transportwechsel.

Vollständige Bedingungen, Preise, vorhandene Zeitfenster und Quellenbelege werden
aufbewahrt. Abrufzeit gilt niemals als Veröffentlichungsdatum. Vor der Freigabe
wird der genaue Angebotsblock erneut vom Anbieter geladen; entfernte oder
veränderte Aktionen werden gesperrt. Daten anderer Aktionen derselben Seite
überschreiben keine Angebotslaufzeit. Bestehende Social-Prüfungen bleiben erhalten.

Ströck und ANKER erhalten einen separat abgerufenen offiziellen Wiener
Filialnetzbeleg, aber keine erfundene Zusage für jede Filiale. Mehrere Angebote
auf einer Händlerseite bleiben getrennt; Kopien werden weiterhin erkannt.
Statische Basisangebote sind standardmäßig ausgeschaltet. Workflow vorbereitet
für zwei tägliche Läufe, mit Regressionstests vor dem Scan.

## Tests

Zehn Testsuiten unter Node 22.23.2 erfolgreich: Power Scraper, Power Food,
Gültigkeitsbelege, Slack Approval, Source-backed Content, Live Removal Safety,
Slack Deal Quality, Social Post Validity, Queue Workflow Safety und Feed Contract.
Zusätzlich echte HTTP-Abfragen, zentrale Validierung, Dispatch-Deduplizierung und
Freigabe-Datumsnormalisierung ohne Nachrichten oder Veröffentlichung geprüft.

## Verbleibende Grenzen

NORDSEE-Coupons liegen teilweise nur als Bilder/PDF vor und werden noch nicht
zuverlässig gelesen. Burger King benötigt Browser-/App-Inhalte; der lokale
Live-Test hatte den Browser deaktiviert. Die bestehende CI-Browserfunktion ist
kein Nachweis für erfolgreich extrahierte BK-Coupons. BackWerk hatte einen
Abruffehler. KFC, Cuadro und Mabel's lieferten aktuell keinen konkreten Treffer.
Keine Erhöhung kostenpflichtiger Anbieterbudgets und keine erfundenen Ersatzdeals.

Neue Quellen werden erst mit konkretem Preis/Vorteil, Angebotsbedingungen und
Wien-Beleg produktiv gewertet. Eine vollständige Abdeckung aller Wiener Lokale
ist mit dieser Ausbaustufe nicht belegt.

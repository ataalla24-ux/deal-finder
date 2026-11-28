# Automatische Prüfung der veröffentlichten Angebote

Die zentrale Veröffentlichung (`scripts/commit-generated.mjs`) prüft vor jedem
Feed-Commit sämtliche enthaltenen Deals. Der bestehende stündliche Backendlauf
`Deal Map Reconciliation` führt dieselbe Prüfung auch ohne neue Deals aus.
Zeitplan: Minute23 jeder Stunde; GitHub kann die Ausführung verzögern.

Die Kontrolle verwendet die Belege aus den vorhandenen Quellen-APIs und deren
gespeicherte Originaltexte. Sie startet selbst keine zusätzlichen Provider- oder
Modellanfragen. Bestehende Abrufe, Zugangssperren und Kostenlimits bleiben wirksam.

- Eindeutig bestätigte abgelaufene Angebote werden vollständig entfernt, ohne
  das alte Limit von fünf Entfernungen pro Durchlauf. Unbekannte Enddaten und
  Veröffentlichungsdaten gelten nicht als Ablaufbeweis.
- Dubletten benötigen übereinstimmende ursprüngliche Angebotsbelege, Händler,
  Zeitraum, Ort und Bedingungen. Gemeinsame URLs oder ähnliche Titel reichen
  nicht. Verschiedene Coupons, Monate und Flugtermine bleiben getrennt.
- Titel-, Preis- und Datumsbehauptungen werden mit gebundenen Quellen verglichen.
  Eindeutige sichere Korrekturen werden übernommen; positive Widersprüche werden
  mit Wiederherstellungsbeleg ausgeblendet. Fehlende oder mehrdeutige Belege
  bleiben als Prüfbedarf sichtbar. Das ist keine automatische Einlösegarantie.
- Manuelle Vorgaben und Wiederherstellungen bleiben geschützt. Ein bekannter
  Fehler wird durch einen unveränderten späteren Datensatz nicht erneut live.
- Feed, Karte, Tages-/Wochendeal und Status werden zusammen veröffentlicht.
  Parallele Änderungen an Quellen oder manuellen Korrekturen stoppen einen
  veralteten Lauf; sie werden nicht überschrieben.

## Status-API

`GET https://freefinder.at/deal-integrity-status.json`

Enthält den Zeitpunkt, Feed-Version, geprüfte und sichtbare Anzahl, Entfernungen,
Korrekturen und offenen Prüfbedarf. `staleAfter` markiert einen überfälligen Lauf.
Die Status-API enthält keine Reviewer-IDs oder Zugangsdaten. Nach der Bereitstellung
prüft der vorhandene öffentliche Kontrolllauf die tatsächlichen Bytes und die
Bindung an den veröffentlichten Feed. Ein veralteter Status ist kein grüner Nachweis.

Vollständige Entscheidungen: `reviews/live-deal-integrity-report.json`.
Wiederherstellungsbelege: `reviews/live-deal-integrity-state.json` und bestehender
`reviews/automatic-deal-maintenance-state.json` für Ablaufentfernungen.

Lokal ohne Änderungen: `node scripts/live-deal-integrity.mjs --read-only`.
Eine autorisierte API-Auslösung ist über den bestehenden GitHub-Actions-Dispatch
des Workflows `deal-map-sync.yml` möglich; der stündliche Ablauf benötigt diesen
manuellen Schritt nicht.

## Grenzen

Die Prüfung erfasst alle Datensätze, bestätigt aber nicht automatisch jede
externe Einlösebedingung. Quellen ohne eindeutigen, verlässlichen Originalbeleg
bleiben Prüfbedarf. Ein HTTP403, ein fehlender Rabatt in einer personalisierten
Ansicht oder ein unbekanntes Ende beweist keinen Ablauf. Der ältere gesonderte
HTML-Ablaufprüfer behält seine konservative Zweitbeobachtung; dessen Zwischenstand
wird nicht in einen vermeintlich vollständigen neuen Quellenbeleg umgewandelt.

GitHub erläutert mögliche Verzögerungen geplanter Läufe in seiner
[Dokumentation](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows#schedule).

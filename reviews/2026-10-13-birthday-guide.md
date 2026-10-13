# Täglicher Deal-Blog: ÖBB-Anreise im Wiener Geburtstagsguide

Am Wiener Kalendertag 13. Oktober 2026 genau eine substanzielle Erweiterung: https://freefinder.at/blog/geburtstag-gratis-wien.html . Hauptkeyword „geburtstag gratis wien“, kein neuer Slug. Bestehende Artikel und docs/deals.json geprüft; bislang kein ÖBB-Geburtstagsabschnitt. Auf origin/main fand sich heute noch kein inhaltlicher Blogcommit; vorhandener Therme-Ausbau vom 11. Oktober (237587da1) berücksichtigt, obwohl Memory zuletzt den 10. Oktober dokumentierte. Feed unverändert.

## Offizielle Primärquellen am 13. Oktober

- https://www.oebb.at/de/tickets-kundenkarten/kundenkarten/vorteilscard/vorteilscard-geburtstagsaktion.html
- https://www.oebb.at/de/fragen-und-antworten/kundenkarten/vorteilscard/geburtstagsaktion

Beide heute direkt gelesen. Der neue Abschnitt erklärt Nachweise, Fahrtplanung, Zusatzkosten, Family-Bedingungen und Trennung vom Wiener Stadtverkehr. Laufend bis auf Widerruf, kein festes Aktionsende. Keine kostenlose Karte, pauschale Begleitfreifahrt oder Gratis-U-Bahn versprochen. Keine Buchung vorgenommen.

Bestehende acht Vorteile heute erneut offiziell geprüft, Hauptbedingungen unverändert:

- Watertuin: https://www.watertuin.at/aktionen
- Donauturm: https://www.donauturm.at/public/de/events-news-and-kulinarik/events/geburtstag-am-donauturm-wien/
- Madame Tussauds: https://www.madametussauds.com/wien/plane-deinen-besuch/vor-deinem-besuch/informationen-zum-besuch/
- Starbucks: https://www.starbucks.at/de/rewards/rewards-terms-and-conditions und https://www.starbucks.at/de/faq-rewards
- Cineplexx: https://cineplexx.at/info/family-film-club heute zusätzlich gerendert im Browser.
- NoWayOut: https://www.nowayout-escape.at/de/special-offers/ und https://www.nowayout-escape.at/de/birthday-parties/ . Die zusätzliche Datumszeile 7 Jan–14 Feb bleibt ungeklärt; konkrete heutige Einlösung nicht pauschal zugesagt.
- Balls&Clubs: https://www.ballsandclubs.at/special-offers/ , https://www.ballsandclubs.at/birthday-parties/ und https://www.ballsandclubs.at/minigolf/ . Bestehende Preise und rechnerische Begleitkosten unverändert.
- Therme: https://thermewien.at/bereich/erlebnisstein-und-wildnis/ mit aktuell verlinktem https://thermewien.at/wp-content/uploads/2025/10/Formular-Kindergeburtstag-1025.pdf . Kostenpflichtiges Paket bleibt klar vom Gratis-Tageseintritt getrennt.

Cineplexx-Altersgrenze, NoWayOut-Datumsunsicherheit, Donauturm-Tortengebühr-Konflikt und andere bestehende Einschränkungen erhalten. Kein neues Kalenderenddatum erfunden. Neun Möglichkeiten insgesamt, sechs feste Adressen, 28 sichtbar und strukturiert identische FAQs. Bestehendes lokales FreeFinder-Cover, Design und App-Links erhalten.

## Aktuelle Suchdaten und adressierte Chance

Keine aktuellen Exporte oder direkter Analytics-Connector im Repository gefunden. Vorhandene Safari-Sitzung rein lesend: Analytics-Property 550142791 / FreeFinder Website, eingebundene Search Console, letzte 28 Tage **15. September bis 12. Oktober 2026**. Alle 34 Landingpages und 87 verfügbaren Suchanfragen gelesen.

| Seite | Klicks | Impressionen | CTR | Position |
| --- | ---: | ---: | ---: | ---: |
| Startseite | 8 | 400 | 2 % | 7,42 |
| Geburtstagsguide | 4 | 53 | 7,55 % | 10,19 |
| Foodora | 4 | 223 | 1,79 % | 14,46 |
| Interpolburger | 1 | 122 | 0,82 % | 7,57 |
| KinoDonnerstag | 1 | 105 | 0,95 % | 7,74 |
| Restaurant-Gutscheine | 1 | 24 | 4,17 % | 9,54 |
| Aktuelle Angebote | 0 | 13 | 0 % | 8,23 |
| Lieferando+ | 0 | 10 | 0 % | 4,30 |

Priorisierte Anfrage „gratis essen geburtstag wien“: 2 Impressionen, 0 Klicks, Position 11. Weitere Chancen: „wo angebote finden“ 73 Impressionen/0 Klicks/Position 6,19; „foodora gutschein“ 45/0/29,42; „foodora gutscheincode“ 24/1/29,42; „restaurant deals“ 25/0/11,36. Keine Query-to-Page-Zuordnung oder Wirkung gegenüber anders datierten Zeiträumen behauptet.

Unterstützende CTR-Korrektur auf der Startseite (400 Impressionen, 2 % CTR): Title/Meta/H1 und OG/Twitter sprechen Angebote, Gutscheine, Gratis-Essen am Geburtstag und konkrete Quellen-/Bedingungsprüfung an. Kein zweiter substanzieller Artikel. Geburtstags-Title/Meta/H1/Article/FAQ/Blogkarte und Sitemap konsistent aktualisiert. Gutschein-Zentrale und App-Gutschein-Guide erhalten passende Rücklinks; bestehende Links zwischen Startseite, Angeboten, Geburtstag, Restaurant-Gutscheinen und Bezirksguide geprüft. Vorbestand: Invite-Link auf fehlendes impressum.html gefunden. Ein paralleler Remote-Commit eda3ae299 repariert ihn bereits als support.html/Kontakt. Diese Reparatur wird beim Rebase übernommen; die eigene Zwischenlösung verworfen, keine konkurrierende Invite-Änderung veröffentlicht.

## Technik und Prüfung

Eigener mit mktemp erstellter detached Worktree origin/main unter .daily-blog-run.8hitm2c_/worktree. Alle Änderungen, Generatoren, Tests, Commit und Push ausschließlich dort. Fremde uncommittete Dateien und andere Worktrees unangetastet. Ein initialer Fetch-Verbindungsabbruch durch erneuten normalen HTTP/1.1-Fetch behoben.

Gezieltes seo:guides und vorgeschriebenes seo:deals ausgeführt. Nicht zugehörige automatische Angebotsübersichts-Drift nur im eigenen Worktree verworfen; kein Feed-/Backend-/Native-/Store-Eingriff. Vienna SEO, SEO Deals, Website Quality, Pro Website und Deal Guide Routing bestanden. Website-Audit: 64 HTML/57 indexierbar, 0 Fehler; bekannte plus-gratis-Orphan-Warnung. JSON-LD/Canonical/OG/FAQ/Anker/Assets geprüft; 57 eindeutige Sitemap-URLs und 167 lokale HTTP-Ziele mit Status 200. git diff --check bestanden. Unabhängiger Diff- und Quellenaudit ohne Blockade.

Headless Chrome/Playwright: Geburtstagsguide, Startseite und Blogindex bei 1440, 390 und 320 Pixel erfolgreich, alle neun Ansichten HTTP200, kein Seitenüberlauf, sichtbare Bilder nach Durchscrollen geladen, null Seitenfehler. ÖBB-Abschnitt und Startseiten-H1 zusätzlich per Screenshot visuell geprüft. Keine Browser-Einschränkung. Ein anfänglicher Prüfharness hatte eine falsche Playwright-Funktionssignatur; ein erster paralleler HTTP-Test überlastete den lokalen Testserver. Signatur korrigiert, lokaler HTTP-Test sequenziell erfolgreich. Lazy-Bilder werden nach Durchscrollen und mit Sichtbarkeitsprüfung getestet; es sind keine daraus abgeleiteten Produktfehler behauptet.

Commit, GitHub Pages, Live-HTTP einschließlich Titel/Canonical/Bilder/Sitemap, IndexNow und eigenes Cleanup werden abschließend in der Memory dokumentiert.

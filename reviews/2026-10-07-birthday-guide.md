# Täglicher Deal-Blog: Geburtstagsgetränk und sichere Einlösung

Inhalt und Quellen am 7. Oktober 2026 geprüft. Genau ein bestehender Guide wird substanziell erweitert: `https://freefinder.at/blog/geburtstag-gratis-wien.html`. Hauptkeyword: „geburtstag gratis wien“; ergänzend gratis Essen, Eintritt und Geburtstagsgetränk. Kein neuer Slug und keine zweite substanzielle Blogveröffentlichung.

## Inhalt und offizielle Primärquellen

- Starbucks Österreich: https://www.starbucks.at/de/rewards und https://www.starbucks.at/de/faq-rewards bestätigen das Geburtstagsgetränk als Gold-Vorteil und 1.500 Sterne als Statusschwelle. Die FAQ schließt Flughafen Wien und Parndorf Fashion Outlet Center vom Rewards-Programm aus.
- https://www.starbucks.at/de/rewards/rewards-terms-and-conditions bestätigt Gold-Vorteile, ein handgemachtes Geburtstagsgetränk pro Jahr, Geburtstag im Konto, automatische Gutschrift am Geburtstag, 30 Tage Gültigkeit ab Ausstellung und Einlösung per Mitglieder-QR-Code oder registrierter Card. Kein kalendarisches Programm-Enddatum. Die individuelle Reward-Frist ist kein Aktionsende. Keine kostenlose Einladung für neue Konten oder alle Kund*innen zugesagt.
- https://www.donauturm.at/public/de/events-news-and-kulinarik/events/geburtstag-am-donauturm-wien/ heute erneut geprüft: freier Eintritt und Rutsche, zwei Tage vor/nach Geburtstag, Lichtbildausweis, Front Desk, Begleitung regulär. Neu erklärt: Einlösung vor Ticketkauf; keine nachträgliche Anrechnung, Stornierung oder Erstattung bereits gekaufter Tickets aufgrund des Geburtstagsvorteils; keine Verlängerung/Übertragung des Zeitfensters.
- https://www.watertuin.at/aktionen heute erneut geprüft: gratis Essen/Trinken, Reservierung, mindestens eine vollzahlende erwachsene Person, Dienstag-Ausnahme Mittwoch/Donnerstag, bis auf Widerruf.
- https://www.madametussauds.com/wien/plane-deinen-besuch/vor-deinem-besuch/informationen-zum-besuch/ heute erneut geprüft: freier Eintritt jeden Alters genau am Geburtstag gegen amtlichen Lichtbildausweis.

Alle vier Kernangebote sind laufend ohne festes kalendarisches Ende. Keine erfundene Restlaufzeit. Die 67 Feed-Deals und bestehenden Artikel wurden vor Auswahl geprüft. Passende befristete Themen sind bereits abgedeckt oder für den Geburtstagsausbau ungeeignet. `docs/deals.json` bleibt unverändert.

## Aktuelle Suchdaten und Entscheidung

Rein lesend über die vorhandene Safari-Sitzung: Google Analytics, Property 550142791, Stream „FreeFinder Website“, eingebundene Search-Console-Berichte. Zeitraum 7. September bis 6. Oktober 2026 (letzte 30 Tage); geprüft am 7. Oktober etwa 09:06–09:11 CEST. Keine passenden Exporte im Repository und kein direkt aufrufbarer Analytics-/Search-Console-Connector gefunden; die bestehende Browser-Sitzung liefert dennoch aktuelle Berichte.

Beobachtete Landingpages (Klicks / Impressionen / CTR / durchschnittliche Position):

- Startseite `/`: 8 / 347 / 2,31 % / 8,71.
- Geburtstags-Guide: 2 / 43 / 4,65 % / 10,42.
- Foodora-GENUSS: 2 / 111 / 1,8 % / 15,17.
- Interpolburger: 1 / 92 / 1,09 % / 7,70.
- KinoDonnerstag: 1 / 78 / 1,28 % / 7,41.
- Restaurant-Gutscheine: 1 / 70 / 1,43 % / 23,37.

78 verfügbare Suchanfragen gelesen. Chancen mit null Klicks: „wo angebote finden“ 166 Impressionen, Position 8,15; „foodora gutschein“ 28, Position 26,32; „restaurant deals“ 17, Position 10,29; „lieferando+“ 13, Position 7,54; „restaurant gutschein wien“ 11, Position 28,18. Keine Geburtstagsanfrage in diesem sichtbaren Anfragebericht; die Seitenwerte können wegen unvollständiger/anonymisierter Suchanfragen abweichen. Keine Query-to-Page-Zuordnung behauptet.

Heute adressiert: Title, Meta/OG/Twitter-Beschreibung und H1 der Startseite präzisieren das Finden von Wiener Angeboten als redaktionelle Schlussfolgerung aus der stärksten Suchanfrage. Direkte Links zum Geburtstags- und Restaurant-Gutschein-Guide stärken den Weg von der Startseite. Der Geburtstagsausbau folgt der ausdrücklich priorisierten Intention und beantwortet zusätzlich Status, Frist, Filialausschlüsse und Ticketkauf. Andere CTR-Chancen werden für kommende Läufe dokumentiert; keine dünnen Zusatzseiten.

## Verifikation

- `npm run seo:guides -- geburtstag-gratis-wien` und `npm run seo:deals` ausgeführt; aktueller Deals-Generator erzeugt unverändert zehn Wiener Treffer.
- SEO-Deals-Regression und bestehende Deal-Guide-Routing-Tests bestanden.
- HTML im Browser geparst; ein H1 pro geprüfter Seite, eindeutige IDs, valide JSON-LD, korrekte Canonicals, 17 identische sichtbare/strukturierte FAQ-Paare, Article `dateModified` und Geburtstag-Sitemapdatum 2026-10-07.
- Sitemap: 55 eindeutige URLs. 83 lokale Links/Assets über HTTP geprüft, alle 200. Vorhandene FreeFinder-Bilder und App-Download-URLs erhalten.
- Lokaler Server + Headless Chrome über Playwright: Guide/Startseite bei 1440 und 390 Pixeln, kein horizontaler Überlauf, Hauptbilder geladen; visuelle Screenshots geprüft. Browserkonsole: null Fehler/Warnungen.
- `git diff --check` bestanden. Alle Änderungen aus eigenem detached Worktree; fremde Änderungen/Worktrees erhalten.

Endgültiger Commit, GitHub-Pages-Status, Live-Prüfung und anschließendes IndexNow werden in der Automationsmemory dokumentiert.

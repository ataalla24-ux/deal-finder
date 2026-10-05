# Geburtstagsguide: dritter geprüfter Vorteil

Geprüft am 5. Oktober 2026. Der bestehende Guide `docs/blog/geburtstag-gratis-wien.html` wird um Madame Tussauds Wien ergänzt. Hauptintentionen: „geburtstag gratis wien“ und „geburtstagskind gratis eintritt“. Title, Meta, H1, Vergleich, sichtbare FAQ, FAQ-JSON-LD und Blogindex beschreiben jetzt drei konkrete Angebote. Die Registrierungs-FAQ trennt Mitgliedschaft, Tischreservierung und Ausweis.

## Offizielle Quellen

- https://www.madametussauds.com/wien/plane-deinen-besuch/vor-deinem-besuch/informationen-zum-besuch/ — freier Eintritt für Geburtstagskinder jeden Alters am Geburtstag gegen amtlichen Lichtbildausweis. Kein festes Enddatum; laufend. Keine freien Begleittickets oder Zusatzleistungen zugesagt.
- https://www.madametussauds.com/wien/plane-deinen-besuch/vor-deinem-besuch/anreise/ — Riesenradplatz 5–6, 1020 Wien; U1/U2 Praterstern. Keine widersprüchliche Minutenangabe aus der Quelle übernommen.
- https://www.madametussauds.com/wien/plane-deinen-besuch/weitere-informationen/kindergeburtstag/ — organisierte Kindergeburtstagsfeiern werden derzeit nicht angeboten; vom individuellen Eintrittsvorteil getrennt.
- https://www.watertuin.at/aktionen — bestehendes Geburtstagsessen/-trinken mit Reservierung und mindestens einer erwachsenen Begleitperson zum normalen Vollpreis heute bestätigt; Dienstag-Ausnahme Mittwoch/Donnerstag; bis auf Widerruf.
- https://www.donauturm.at/public/de/events-news-and-kulinarik/events/geburtstag-am-donauturm-wien/ — bestehender Eintritt/Rutschenvorteil heute bestätigt; bis zwei Tage vor/nach dem Geburtstag, Lichtbildausweis, Front Desk, Begleitpersonen regulär.

## Daten und Abgrenzung

65 Feed-Deals und bestehender Blogbestand vorab geprüft. Der Madame-Tussauds-Drei-1+1-Feeddeal ist ein anderer Mitgliedervorteil und keine Quelle des Geburtstagsangebots. Feed unverändert. Heutige Papa-Duck-/Lugner-City-Artikel bleiben erhalten. Keine neue Seite oder neuer Slug.

In den verfügbaren Google-Zugängen zeigte Search Console nur die Website-Einrichtung und Analytics die Messungs-Einrichtung, keine Leistungsberichte. Keine aktuellen Impressionen, CTR oder Reichweite behauptet; die ausdrücklich vorgegebenen Geburtstagsintentionen werden adressiert.

## Prüfungen vor Veröffentlichung

- `npm run seo:guides -- geburtstag-gratis-wien` und `npm run seo:deals` ausgeführt.
- HTML-Parser, ein H1, eindeutige IDs, Article/BreadcrumbList/FAQPage, 15 sichtbare und strukturierte FAQ-Paare, Canonical, Open Graph, lokales Bild und interne Links geprüft.
- Guide und Blogindex: 178 lokale Referenzen ohne fehlende Ziele. Sitemap: 46 eindeutige URLs, Geburtstagseintrag einmal mit `lastmod` 2026-10-05.
- Lokaler HTTP-Server und Headless Chrome: Desktop 1440 px, Mobil 390 px; keine horizontalen Überläufe, Bilder geladen, keine Konsolenfehler. Screenshots visuell geprüft.
- `git diff --check` bestanden. Eigener sauberer Worktree innerhalb des Repositories; fremde Änderungen im Hauptcheckout erhalten.

Commit und Live-Verifikation werden nach dem Push in der Automationsmemory dokumentiert. IndexNow erst nach eigener Live-Prüfung.

# Creator-Pilot

Status: technische Vorbereitung, standardmäßig aus. Kein Code ist allein durch
die Aufnahme in diese Dateien im App Store oder in Google Play eingerichtet.

## Vereinbarte Eckdaten

- Bis zu fünf getrennte Partner. Foodiewien und Tastyfood sind Entwürfe, drei
  weitere Plätze sind unbenannt. Kein Creator-Vertrag wurde stellvertretend
  abgeschlossen.
- Nur neue österreichische EUR-Monatsabos. Ziel: zwölf bezahlte Monatsperioden
  mit 20 Prozent Rabatt, bei aktuellem Preis 3,99 EUR statt 4,99 EUR.
- 30 Prozent des tatsächlich bezahlten Kunden-Bruttopreises nach Rabatt,
  kaufmännisch auf Cent gerundet: 3,99 EUR ergeben 1,20 EUR Provision.
- Die Provision enthält eine gegebenenfalls anfallende Creator-Umsatzsteuer.
  Der Vertrag muss dies ausdrücklich bestätigen; es ist keine steuerliche
  Einordnung des Creators und keine Zusage eines zusätzlichen Nettobetrags.
- Standard: Provision auf zwölf **bezahlte Perioden**, nicht auf Downloads,
  kostenlose Test-/Empfehlungsmonate oder ausstehende Zahlungen. Rückzahlungen
  mindern die Provision. `commissionMonths: null` ist technisch für spätere
  ausdrückliche Vertragsfreigabe vorbereitet, nicht als Dauerzusage aktiviert.
- Keine automatische Banküberweisung. Monatliche, unveränderliche Abrechnung
  erst nach mindestens 30 Tagen Wartezeit, Abgleich mit Store-Finanzberichten
  und Bestätigung des Geldeingangs. Separate Bestätigung der echten Überweisung.

## Startfreigaben

Alle vier `CREATOR_*_ENABLED`-Flags bleiben standardmäßig aus,
bis alle folgenden Nachweise vorhanden sind:

1. Bestätigte Tätigkeit/Vertragsfähigkeit des Betreibers, Creator-Vertrag,
   Laufzeit, Brutto-Provisionsdefinition, Rechnungs-/Gutschriftverfahren,
   Erstattungen, Werbekennzeichnung und Datenschutz geklärt.
   Datenschutzhinweise und Auskunfts-/Lösch-/Aufbewahrungsprozess müssen den
   zusätzlichen Abrechnungszweck korrekt abdecken; diese fachliche Freigabe
   wird durch die technische Implementierung nicht ersetzt.
2. Je Creator ein eigenes Apple-Offer-ID und ein eigener Google-Offer-ID;
   kein gemeinsam verwendetes Angebot, dessen Creator der Store nicht mehr
   unterscheiden könnte. Bestehende Empfehlungsangebote nicht überschreiben.
3. Apple: tatsächliche freie Angebotsslots prüfen (höchstens zehn aktive
   Angebote je Abo), NEW-Berechtigung, AT-Preis, Laufzeit, Intro-Testphase und
   benutzerdefinierte Codes prüfen. Google: Developer-Determined-Angebot mit
   echter monatlicher Phase, ggf. Testphase, zwölf Rabattzyklen und regulärem
   Anschluss. Google-Promocodes sind kein Ersatz für einen 20-Prozent-Rabatt.
4. Beide nativen Code-Abläufe mit echten Store-Testkonten prüfen: neues Abo,
   Gratisphase, erste Zahlung, Verlängerung, Kündigung, Erstattung und falsches
   Konto/Angebot. Kein Wechsel auf den Normalpreis als Fehler-Fallback.
5. Neue Apps einreichen und tatsächliche Verfügbarkeit bestätigen. Die bereits
   vorhandenen Release-Dateien bleiben unverändert.
6. `termsApproved`, `transportReady`, `releasesVerified` bestätigen, Partner
   einzeln aktivieren und erst anschließend benötigte Umgebungsflags freischalten.
   Der Apple-Servereingang ist eine zusätzliche technische Startvoraussetzung.
   Technische Tests mit Fixtures ersetzen diese echten Freigaben nicht.

Beim Beenden neuer Einlösungen zusätzlich die Store-Angebote deaktivieren.
Backend-Pausen löschen keine bereits verdienten Ansprüche; verspätete Belege
aus dem belegten früheren Einlösezeitraum bleiben prüfbar.

## Abrechnung und Sicherheit

Eigener SQLite-Durable-Object `CREATOR_PROGRAM`, getrennt von Empfehlungsmonaten
und Business-Promocodes. Öffentliche Clients übermitteln nur Store-Belegkennungen.
Preise und Angebotszuordnung kommen aus authentifizierten Store-API-Antworten
oder kryptographisch geprüften Apple-Servernachrichten. Ein ungeprüfter JWS-Payload,
ein Client-Preis oder ein vorhandener Pro-Schalter
sind keine Zahlungsbestätigung. Apple-Preise werden von Milliunits in Cent
umgerechnet; Google `Order.total` ist der gezahlte Betrag inklusive Steuern.

Zuordnung je Store-Abo bleibt fest. Derselbe Beleg oder Monatszeitraum kann nicht
zweimal vergütet werden. Nachträgliche Belege werden chronologisch eingeordnet.
Teil-/Vollerstattungen erzeugen nötigenfalls einen negativen Ausgleich in der
nächsten Abrechnung; offene Negativsalden werden vor einer Auszahlung verrechnet.
Ein erneuter Belegabruf macht eine bestätigte Rückzahlung nicht rückgängig.
Eine echte Rücknahme einer Erstattung ist nur mit ausdrücklich bestätigtem
neuem Finanznachweis korrigierbar. Apples anteilige Rückzahlungen werden nicht
als Vollerstattung behandelt; bei nicht centgenau auflösbaren Prozentwerten
bleibt der Fall zur Finanzprüfung offen. Bereits bestätigte negative Korrekturen
werden auch dann verrechnet, wenn weitere positive Beträge noch in Prüfung sind.

Nur bestehender Admin-Zugang darf Konfiguration, bestätigte Finanzkorrekturen,
Abrechnungen und Bankreferenzen bearbeiten. Die App erhält weder Finanzdaten noch
die gespeicherten Google-Purchase-Tokens. Diese bleiben in der privaten Ledger-
Instanz und erscheinen nicht in Übersichten/Logs. Kontoidentitäten sind die
bestehenden pseudonymen Account-UUIDs; keine Käufer-Mail wird an Creator gegeben.

Die bestehenden Viertelstunden-Crons bleiben unverändert. Nach Freigabe werden
höchstens zwei fällige bekannte Abos je Lauf nachgeprüft, pro Abo frühestens nach
24 Stunden. Damit werden Verlängerungen auch bei geschlossener App erkannt.
Apple-Historie enthält auch Widerrufe; Google prüft zusätzlich gespeicherte
Originalorders erneut. Maximal 500 Store-Prüfungen je rollierendem Tag, zwölf
Client-Bestätigungen pro Konto/Tag. Erreichte Grenzen werden nicht umgangen.

## Store-Servereingänge

Implementiert, aber noch nicht in den Stores eingerichtet oder live aktiviert:

- Apple V2: `/api/creators/apple-notifications`, gesperrt durch
  `CREATOR_APPLE_NOTIFICATIONS_ENABLED=0`. Die offizielle Apple-Serverbibliothek
  3.1.0 prüft äußere und innere Signaturen, Produktionsumgebung, Bundle,
  App-ID und Zertifikatskette gegen die fest hinterlegte öffentliche Apple-G3-CA.
  Kontolose Apple-Codebelege werden ausschließlich über diesen authentischen
  Serverweg gebucht, nicht durch die Behauptung eines beliebigen App-Kontos.
- Google RTDN: `/api/creators/google-notifications`, gesperrt durch
  `CREATOR_GOOGLE_NOTIFICATIONS_ENABLED=0`. Google-OIDC-Signatur, exakte Audience
  und bestätigte Service-Account-E-Mail werden geprüft. Erforderliche Werte:
  `CREATOR_GOOGLE_PUSH_AUDIENCE` ist die vollständige feste Backend-URL dieses
  Eingangs; `CREATOR_GOOGLE_PUSH_EMAIL` ist der ausdrücklich freigegebene
  vorhandene Pub/Sub-Service-Account. Eine RTDN ist nur ein Abrufanlass:
  Zahlungsbeträge werden weiterhin bei Google Publisher/Orders geprüft.
- Event-IDs und Zahlungsbelege verhindern Doppelbuchungen. Testmeldungen werden
  nie als Zahlung gebucht. Google-Purchase-Tokens oder Auth-Header erscheinen
  nicht in öffentlichen Antworten/Übersichten.

Vor Konfiguration bestehende Store-Notification-URLs prüfen und nicht blind
ersetzen. Google-Pub/Sub nur innerhalb eines nachgewiesenen kostenlosen Setups
verwenden; kein Billing aktivieren, keinen kostenpflichtigen Dienst buchen und
keine neuen Schlüssel ungefragt anlegen. Polling bleibt als begrenzte Nachprüfung
für bekannte Abos erhalten. Eine echte Zustellung bzw. vollständige Attribution
ist erst nach tatsächlicher Einrichtung und Ende-zu-Ende-Test bestätigt, nicht
durch erfolgreiche Fixture-Tests. Auch die Worker-Kompatibilität der Apple-
Zertifikats-/OCSP-Prüfung muss im echten Test bestätigt werden.

200 Abos je begrenzter Scan-Seite mit fortlaufendem Cursor, maximal 2000 Zahlungspositionen
je Abrechnungsübersicht und 100 Monatsabrechnungen sind bewusste Pilot-Grenzen.
Vor Wachstum paginieren und Gratisquoten messen; keine automatische Tariferhöhung.
Bei vielen Abos kann der begrenzte Nachlauf länger als einen Tag dauern; es gibt
keine zugesagte tägliche Vollprüfung einer beliebig großen Kundenzahl.
Bei widersprüchlichen Belegen/Store-Fehlern Auszahlung zur Prüfung zurückhalten,
nicht mit geratenen Beträgen weiterrechnen.

## Bedienung

`node scripts/creators.mjs --help` zeigt die Verwaltung. `drafts` arbeitet rein
lokal, `seed` legt ausschließlich inaktive Entwürfe an. Die übrigen Befehle sind
geschützt und nutzen den bestehenden Admin-Zugang aus Umgebung oder Schlüsselbund.
Keine Schlüssel, Bankdaten oder tatsächlichen Käuferbelege in Git committen.

Eine Abrechnungsanfrage enthält `partnerId`, `month` (abgeschlossener Kalendermonat),
`reconciledFinancialReports: true`, `storeFundsReceived: true`, `evidenceRef`.
`record-transfer` benötigt die unveränderte `statementId`, den exakten
`amountCents`, `bankReference` und `ownerConfirmed: true`; es dokumentiert eine
bereits erfolgte Überweisung, es führt sie nicht aus.

## Referenzen

- Apple: https://developer.apple.com/help/app-store-connect/manage-subscriptions/set-up-subscription-offer-codes/
- Apple Preisformat: https://developer.apple.com/documentation/appstoreserverapi/price
- Google Orders: https://developers.google.com/android-publisher/api-ref/rest/v3/orders
- Google Promocodes: https://developer.android.com/google/play/billing/promo
- Google Angebote: https://support.google.com/googleplay/android-developer/answer/140504

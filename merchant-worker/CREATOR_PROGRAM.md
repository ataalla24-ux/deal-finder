# Creator-Pilot

Status: technische Vorbereitung, standardmäßig aus. Die beiden Store-Angebote
für Foodiewien und Tastyfood wurden am 11.11.2026 angelegt (Details unten).
Ein gespeicherter Entwurf ist noch kein einlösbarer oder vollständig getesteter Code.

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

Alle vier `CREATOR_*_ENABLED`-Flags sind standardmäßig aus.
Nur die beiden Notification-Eingänge dürfen für authentifizierte Transporttests
vorab freigegeben werden. Programm und Zahlungsabgleich bleiben aus, bis alle
folgenden Nachweise vorhanden sind:

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
   benutzerdefinierte Codes prüfen. Google: Neukundenangebot mit durch Google
   geprüfter Berechtigung (noch kein Abo in dieser App), echter monatlicher Phase,
   ggf. Testphase, zwölf Rabattzyklen und regulärem Anschluss. Die App wählt nur
   die zum geprüften Creator-Code gehörige Angebots-ID. Google-Promocodes sind
   kein Ersatz für einen 20-Prozent-Rabatt.
4. Beide nativen Code-Abläufe mit echten Store-Testkonten prüfen: neues Abo,
   Gratisphase, erste Zahlung, Verlängerung, Kündigung, Erstattung und falsches
   Konto/Angebot. Kein Wechsel auf den Normalpreis als Fehler-Fallback.
5. Neue Apps einreichen und tatsächliche Verfügbarkeit bestätigen. Die bereits
   vorhandenen Release-Dateien bleiben unverändert.
6. `termsApproved`, `transportReady`, `releasesVerified` bestätigen, Partner
   einzeln aktivieren und erst anschließend benötigte Umgebungsflags freischalten.
   Apple-Servereingang, Google-Servereingang und regelmäßiger Zahlungsabgleich
   sind zusätzlich zum Programmflag zwingende technische Startvoraussetzungen.
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
Originalorders erneut. Google lädt außerdem die lückenlose dokumentierte
Order-ID-Folge vom Erstkauf bis zur neuesten bekannten oder gemeldeten Bestellung
über `orders:batchGet`. Die abgeleitete ID allein ist kein Zahlungsbeleg: Jede
Position muss durch Googles Antwort mit exakt passendem Token, Produkt, Konto,
Preis und nicht überlappendem Leistungszeitraum bestätigt sein. Fehlende,
doppelte oder fremde Antworten verhindern eine vollständige Freigabe.
Maximal 200 Bestellungen pro Kette; größere Historien bleiben zur Prüfung offen.
Maximal 500 Store-Prüfungen je rollierendem Tag, zwölf
Client-Bestätigungen pro Konto/Tag. Erreichte Grenzen werden nicht umgangen.

## Store-Servereingänge

Implementiert; Einrichtung und Zustellnachweise getrennt vom Verkaufsstart prüfen:

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
  Pub/Sub-Service-Account. Eine RTDN ist nur ein Abrufanlass:
  Zahlungsbeträge werden weiterhin bei Google Publisher/Orders geprüft.
- Signierte Google-Meldungen zu ungültigen Käufen lösen die Prüfung genau der
  genannten Bestellung aus. Einmalprodukte werden als nicht zum Creator-Abo
  gehörig quittiert. Bereits gebuchte Abo-Bestellungen können nach Ablauf des
  Purchase-Tokens anhand ihrer gespeicherten Zuordnung und einer frischen
  Orders-Antwort auf Erstattungen geprüft werden. Die Meldung allein enthält
  keinen vertrauenswürdigen Betrag. Fehlende oder noch ausstehende Erstattungen
  werden nicht als erledigt verbucht. Eine gemeldete Vollerstattung benötigt
  auch einen vollständigen Erstattungsnachweis.
- Event-IDs und Zahlungsbelege verhindern Doppelbuchungen. Testmeldungen werden
  nie als Zahlung gebucht. Google-Purchase-Tokens oder Auth-Header erscheinen
  nicht in öffentlichen Antworten/Übersichten.
- `admin/readiness` zeigt den letzten kryptographisch geprüften Testempfang pro
  Plattform mit Zeitpunkt und gehashter Ereignis-ID, ohne Zahlungsbuchung.
  `test-apple-notification` fordert über den vorhandenen Store-Server-Zugang
  höchstens einmal je zehn Minuten einen Apple-Produktionstest an. Die Anfrage
  selbst ist kein Zustellnachweis. Tests funktionieren bei gesperrtem Programm.
- Nicht zum Creator-Programm gehörige Apple-Ereignisse werden nach Signaturprüfung
  auch während der Vorbereitung quittiert. Echte Creator-Ereignisse bleiben bei
  pausiertem Programm wiederholbar, sie werden nicht als erledigt verworfen.
  Google-RTDN darf bis zum abgeschlossenen Verkaufsstart deaktiviert bleiben;
  einzelne Play-Console-Testnachrichten prüfen den vorbereiteten Zustellweg.

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

`node scripts/creators.mjs readiness` prüft ausschließlich lesend die vier
exakten `"1"`-Flags, drei globalen Freigaben und jeden Partner. Der Bericht
nennt fehlende Store-IDs, Verträge, Store-Tests oder Aktivierungen; er setzt
keine davon selbst. Ein positives Ergebnis ist eine Prüfung der gespeicherten
Freigaben, kein Ersatz für echte Store-Belege oder einen Zustelltest.

## Store-Vorbereitung vom 11.11.2026

| Partner | Vorgesehener Code | Apple-Angebotsreferenz / Google-Angebots-ID |
| --- | --- | --- |
| Foodiewien | FOODIEWIEN20 | creator-foodiewien-20-2026 |
| Tastyfood | TASTYFOOD20 | creator-tastyfood-20-2026 |

Apple-Produkt: `com.stefanataalla.freefinderwien.premium.monthly`.
Google-Produkt: `freefinder.pro.monthly`, Basis-Abo `monthly`.
Beide österreichischen Angebote: zwölf monatliche Zahlungen zu 3,99 EUR,
danach regulär 4,99 EUR. Berechtigte Neukunden erhalten zuvor einen kostenlosen
Monat; keine Provision für diesen Monat. Google-Angebote bleiben Entwürfe,
Apple-Angebote haben noch keine ausgegebenen Produktionscodes. Die drei
Reservepartner bleiben unbenannt und ohne Store-Angebotszuordnung.

Die Angebotsreferenz ist bei Apple der fachliche `offerIdentifier`, nicht die
interne App-Store-Connect-Ressourcen-UUID. Die Backend-Partner bleiben `draft`,
`storeVerified: false`, `acceptsNew: false` und ohne Vertrag. Alle bisherigen
normalen Abo-/Empfehlungsangebote bleiben unberührt. Programm und Abgleich sind
weiter gesperrt; separate Transportflags erlauben ausschließlich die vorher
authentifizierte Verarbeitung. Sandbox-Belege bleiben vom Produktionsledger
ausgeschlossen. Es gibt damit noch keinen Nachweis einer echten Einlösung,
Zahlung, Verlängerung, Erstattung oder Creator-Auszahlung.

Freigegebene Google-Vorbereitung: Projekt `freefinder-485721`, Thema
`freefinder-creator-rtdn`, Push-Abo `freefinder-creator-rtdn-push`.
Nur `google-play-developer-notifications@system.gserviceaccount.com` erhält
Publisher-Recht auf genau dieses Thema. Der Zustellaccount
`freefinder-creator-rtdn-push@freefinder-485721.iam.gserviceaccount.com` hat keine
Projekt-, Finanz- oder Verwaltungsrollen und keine ausgegebenen Schlüssel.
OIDC-Audience und Ziel sind beide exakt
`https://freefinder-merchant-backend.freefinder-stefan.workers.dev/api/creators/google-notifications`.
Ein Tag Nachrichtenaufbewahrung, keine Exportabos, keine Dead-Letter-Ressourcen,
kein Billing-/Tarifwechsel. Ein abgelaufener Google-Testzeitraum darf nicht
automatisch auf kostenpflichtige Abrechnung umgestellt werden. Zustellung muss
trotz erfolgreich angelegter Ressourcen tatsächlich bewiesen werden.

Ergebnis am 11.11.2026: Google-Testnachricht wurde vom Produktionsworker nach
OIDC-Prüfung empfangen (`paymentRecorded: false`). Thema und Push-Abo sind
eingerichtet; das Thema ist in Play Console gespeichert, der laufende RTDN-
Versand bleibt vor Verkaufsfreigabe aus. Kein Billing-Upgrade vorgenommen.
Apples Produktions-URL ist gespeichert, Sandbox unverändert leer. Der erste
Apple-Testaufruf scheiterte ohne genauen Providerstatus. Nach der vorhandenen
Zehn-Minuten-Sperre wurde der zweite Aufruf mit den UNVERÄNDERTEN vorhandenen
Zugangsdaten angenommen und die echte Apple-TEST-Nachricht am 11.11.2026 um
16:20:26 UTC kryptographisch verifiziert empfangen. Keine Zahlung gebucht.
Die anfangs aus Integration > In-App-Kauf **Aktiv (0)** abgeleitete Annahme,
ein neuer Schlüssel sei zwingend nötig, ist damit für diesen Transport widerlegt.
Keinen neuen Schlüssel erstellen oder vorhandene ersetzen. Die kurz gestellte
Rückfrage zur Schlüsselvorbereitung wurde ausdrücklich zurückgenommen.
Alle fünf Partner bleiben inaktiv, alle drei fachlichen Freigaben bleiben falsch.

Nachkontrolle 11.11.2026: Vollständige Google-Zahlungshistorie, nachgeholte
Perioden, konkrete Erstattungsbestellungen und Mehrfachmeldungen sind lokal
und im tatsächlichen Linux-Worker-Testlauf geprüft (618 Tests insgesamt).
Keine Testzahlung wird in das Produktionsledger übernommen. Für Foodiewien
wurden lediglich zehn Sandbox-Codes mit Ablauf 13.11.2026 erstellt, weiterhin
null Produktionscodes. Die iPhone-Angebotsanzeige des Eigentümers bestätigt
3,99 EUR für zwölf Monate und danach 4,99 EUR; sie zeigt noch keinen Gratismonat.
Damit sind weder Neukunden-Testphase noch Kauf, Verlängerung oder Store-Erstattung
Ende-zu-Ende nachgewiesen. Der Eigentümer bestätigt, dass die iPhone-Anzeige
funktioniert. Die frühere Sandbox-Kaufhistorie ausschließlich dieses Testkontos
wurde danach mit ausdrücklicher Freigabe zurückgesetzt; nach erneutem Laden ist
"Letzter Kauf" leer. Ein neuer Screenshot für die Neukunden-Testphase steht aus.
Google-Lizenztestkonto ist vorhanden; der Eigentümer verzichtet ausdrücklich auf
den echten Android-Kauftest. Der Emulator ist beendet, der Android-Store-Ablauf
bleibt ungetestet. Native Logiktests (114 Swift-Prüfungen, 19 Android-Tests) ersetzen
keine echten Store-Testkäufe. Startfreigaben bleiben unverändert.

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

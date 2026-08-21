#!/usr/bin/env node
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BLOG_DIR = path.join(ROOT, 'docs', 'blog');
const PUBLISHED = '2026-08-17';
const PUBLISHED_LABEL = '17. August 2026';

const guides = [
  {
    slug: 'gratis-kaffee-wien',
    title: 'Gratis Kaffee in Wien finden',
    meta: 'Gratis Kaffee in Wien finden: Aktionen, Kostproben und App-Gutscheine richtig prüfen und ohne unnötige Wege einlösen.',
    eyebrow: 'Gratis Kaffee Wien',
    headline: 'Gratis Kaffee in Wien finden, prüfen und rechtzeitig einlösen.',
    intro: 'Kostenlose Kaffee-Aktionen sind oft kurz, an einzelne Filialen gebunden oder nur mit App beziehungsweise Kundenkarte gültig. Dieser Guide zeigt, wie du belastbare Angebote von alten Werbeposts unterscheidest.',
    image: '/assets/blog/omv-viva-eiskaffee-gratis.jpg',
    imageAvif: '/assets/blog/omv-viva-eiskaffee-gratis-800.avif 800w, /assets/blog/omv-viva-eiskaffee-gratis-1600.avif 1600w',
    imageWidth: 1600,
    imageHeight: 900,
    imageAlt: 'Drei unterschiedliche kalte Kaffeegetränke als Beispiel für Gratis-Kaffee-Aktionen',
    sections: [
      ['arten', 'Welche Gratis-Kaffee-Aktionen gibt es?', `<p>Bei <strong>Gratis Kaffee in Wien</strong> begegnen dir vor allem Verkostungen, Neueröffnungen, digitale Gutscheine und Treueaktionen. Manche Angebote geben ein vollständiges Getränk aus, andere nur eine kleine Kostprobe. Entscheidend ist, ob wirklich kein Kauf erforderlich ist.</p><ul><li><strong>Verkostung:</strong> Eine neue Sorte wird in einem begrenzten Zeitraum gratis ausgegeben.</li><li><strong>App-Gutschein:</strong> Ein Coupon wird nach Registrierung oder in einer Kunden-App sichtbar.</li><li><strong>Eröffnungsaktion:</strong> Ein Café bewirbt einen neuen Standort mit Gratisgetränken.</li><li><strong>Treuevorteil:</strong> Das Getränk ist gratis, kann aber eine Mitgliedschaft oder gesammelte Punkte voraussetzen.</li></ul>`],
      ['bedingungen', 'Diese Bedingungen solltest du zuerst lesen', `<p>Prüfe Getränk, Größe, Zeitraum und teilnehmende Filiale. Formulierungen wie „solange der Vorrat reicht“, „einmal pro Person“ oder „nur für Neukunden“ verändern den tatsächlichen Nutzen erheblich. Achte außerdem darauf, ob ein QR-Code, eine aktivierte Kundenkarte oder ein Mindestumsatz nötig ist.</p><p>Ein Screenshot ohne sichtbares Datum ist keine zuverlässige Quelle. Öffne deshalb immer den Originalpost oder die Anbieterseite und kontrolliere die Angaben kurz vor dem Weg zur Filiale erneut.</p>`],
      ['planung', 'So vermeidest du unnötige Wege', `<p>Speichere zuerst die genaue Adresse und prüfe die Öffnungszeiten der betreffenden Filiale. Bei stark beworbenen Aktionen lohnt sich ein Besuch eher früh am Tag. Plane keine längere Fahrt nur wegen eines Gratisgetränks, wenn der Anbieter keine Bestands- oder Verfügbarkeitszusage macht.</p><p>Die Seite <a href="/angebote-wien-heute.html">Aktuelle Angebote in Wien heute</a> zeigt nur ausgewählte Deals mit einem erfassten, noch nicht erreichten Enddatum. Für weitere Hinweise kannst du FreeFinder auf iPhone oder Android öffnen.</p>`],
      ['checkliste', '30-Sekunden-Check vor der Einlösung', `<ol><li>Ist der Beitrag direkt vom Anbieter oder einer nachvollziehbaren Quelle?</li><li>Liegt das Enddatum noch in der Zukunft?</li><li>Gilt die Aktion in deiner Wiener Filiale?</li><li>Brauchst du App, Kundenkarte, Gutschein oder einen zusätzlichen Kauf?</li><li>Ist die Aktion garantiert oder nur verfügbar, solange der Vorrat reicht?</li></ol>`],
    ],
    faqs: [
      ['Wo finde ich aktuell Gratis Kaffee in Wien?', 'Prüfe die aktuelle FreeFinder-Dealübersicht sowie offizielle Posts und Apps von Wiener Cafés, Bäckereien, Tankstellen-Shops und Handelsketten. Entscheidend sind ein aktuelles Datum und eine konkrete Filiale.'],
      ['Ist ein Kaffee mit Kundenkarte wirklich gratis?', 'Ja, wenn für den einzelnen Kaffee kein Kaufpreis und kein verpflichtender Zusatzkauf anfällt. Die Registrierung oder Kundenkarte bleibt trotzdem eine Teilnahmebedingung.'],
      ['Warum sind Gratis-Kaffee-Aktionen oft so schnell vorbei?', 'Viele Aktionen sind als Verkostung oder Einführung geplant und haben ein begrenztes Kontingent. Deshalb sollte die Verfügbarkeit unmittelbar vor der Einlösung geprüft werden.'],
    ],
    related: [['Gratis Essen in Wien', 'gratis-essen-wien.html'], ['Produktproben in Wien', 'produktproben-wien.html'], ['Aktuelle Wien-Deals', '/angebote-wien-heute.html']],
  },
  {
    slug: 'geburtstag-gratis-wien',
    title: 'Geburtstag gratis in Wien: Vorteile finden',
    meta: 'Geburtstag gratis in Wien: So findest du Geburtstagsangebote, meldest dich rechtzeitig an und prüfst App-, Ausweis- und Einlösebedingungen.',
    eyebrow: 'Geburtstag gratis Wien',
    headline: 'Kostenlose Geburtstagsangebote in Wien richtig nutzen.',
    intro: 'Gratis Dessert, Getränk, Eintritt oder Gutschein: Geburtstagsvorteile können sich lohnen, sind aber häufig an eine Voranmeldung oder ein Kundenkonto gebunden.',
    image: '/og-preview-stores.png', imageAvif: '/og-preview-stores-600.avif 600w, /og-preview-stores-1200.avif 1200w', imageWidth: 1200, imageHeight: 630,
    imageAlt: 'FreeFinder App für iPhone und Android mit Wiener Angeboten',
    sections: [
      ['formen', 'Welche Geburtstagsvorteile sind üblich?', `<p>Wer nach <strong>Geburtstag gratis Wien</strong> sucht, findet unterschiedliche Modelle: ein kostenloses Getränk, ein Dessert zum Hauptgericht, freien Eintritt, Bonuspunkte oder einen Wertgutschein. Nicht jedes Angebot ist vollständig kostenlos. Ein „Gratis-Dessert beim Essen“ setzt beispielsweise eine kostenpflichtige Bestellung voraus.</p><p>Sortiere deshalb zuerst nach echtem Geschenk, Rabatt und Vorteil mit Mindestumsatz. So vergleichst du Angebote, die wirtschaftlich wirklich zusammenpassen.</p>`],
      ['vorlauf', 'Warum du dich rechtzeitig anmelden solltest', `<p>Viele Geburtstagsangebote werden nur an bestehende Mitglieder versendet. Eine Anmeldung am Geburtstag kann zu spät sein, weil Anbieter einen Vorlauf oder eine bereits bestätigte E-Mail-Adresse verlangen. Trage nur Daten ein, die für den gewünschten Dienst notwendig sind, und prüfe die Datenschutzangaben des Anbieters.</p><p>Notiere nach der Anmeldung, ob der Gutschein am Geburtstag, in der Geburtstagswoche oder während des gesamten Monats gilt. Diese Zeitfenster unterscheiden sich deutlich.</p>`],
      ['nachweis', 'Ausweis, App und Filiale prüfen', `<p>Ein amtlicher Lichtbildausweis kann als Alters- oder Geburtstagsnachweis verlangt werden. Digitale Gutscheine müssen oft in der App geöffnet und dürfen nicht vorher als eingelöst markiert werden. Bei Ketten gilt ein Vorteil möglicherweise nur in teilnehmenden Filialen.</p><div class="article-note"><strong>Wichtig vor Ort</strong>Zeige den Gutschein vor der Bestellung und frage kurz, ob die konkrete Filiale teilnimmt. Das verhindert Missverständnisse an der Kassa.</div>`],
      ['plan', 'Eine sinnvolle Geburtstagsrunde planen', `<p>Wähle wenige Vorteile, die zu deinem Tagesplan passen, statt möglichst viele Standorte anzufahren. Prüfe Anfahrt, Öffnungszeiten und Begleitbedingungen. Ein kostenloser Artikel ist kaum ein Gewinn, wenn dafür mehrere kostenpflichtige Käufe oder lange Wege nötig sind.</p><p>Zusätzliche aktuelle Aktionen findest du auf der Seite <a href="/angebote-wien-heute.html">Angebote in Wien heute</a>. Geburtstagsaktionen ohne belastbares Enddatum sollten immer direkt beim Anbieter kontrolliert werden.</p>`],
    ],
    faqs: [
      ['Welche Geburtstagsangebote in Wien sind wirklich gratis?', 'Wirklich gratis sind Leistungen ohne verpflichtenden Kauf. Viele Dessert-, Gutschein- oder 2-für-1-Angebote setzen dagegen eine Bestellung, Mitgliedschaft oder Begleitperson voraus.'],
      ['Muss ich mich vor dem Geburtstag registrieren?', 'Häufig ja. Manche Anbieter versenden den Gutschein nur an bereits bestehende und bestätigte Mitglieder. Der notwendige Vorlauf steht in den jeweiligen Teilnahmebedingungen.'],
      ['Brauche ich einen Ausweis?', 'Das hängt vom Anbieter ab. Wenn ein Geburtstags- oder Altersnachweis verlangt wird, ist meist ein amtlicher Lichtbildausweis erforderlich.'],
    ],
    related: [['Kostenlose Angebote in Wien', 'kostenlose-angebote-wien.html'], ['Rabatte in Wien prüfen', 'rabatte-wien.html'], ['Aktuelle Wien-Deals', '/angebote-wien-heute.html']],
  },
  {
    slug: 'studentenrabatte-wien',
    title: 'Studentenrabatte in Wien finden und vergleichen',
    meta: 'Studentenrabatte in Wien vergleichen: Nachweise, Altersgrenzen, Laufzeiten und tatsächliche Ersparnis bei Essen, Freizeit und Services prüfen.',
    eyebrow: 'Studentenrabatte Wien',
    headline: 'Studentenrabatte in Wien finden, die sich wirklich lohnen.',
    intro: 'Studierendenausweis, Hochschul-Mailadresse oder Altersgrenze: Rabatte für Studierende haben sehr unterschiedliche Voraussetzungen. Mit diesem Check erkennst du die echte Ersparnis.',
    image: '/assets/current-ios/for-you.jpg', imageAvif: '/assets/current-ios/for-you-400.avif 400w, /assets/current-ios/for-you-711.avif 711w', imageWidth: 711, imageHeight: 400,
    imageAlt: 'FreeFinder Empfehlungen mit lokalen Angeboten und Rabatten',
    sections: [
      ['kategorien', 'Wo Studentenrabatte häufig vorkommen', `<p><strong>Studentenrabatte in Wien</strong> gibt es unter anderem bei Gastronomie, Kultur, Sport, Software, Mobilfunk und Bildungsangeboten. Einige gelten dauerhaft, andere nur während Aktionswochen oder an bestimmten Wochentagen. Öffentliche Tarife und kommerzielle Gutscheine solltest du getrennt vergleichen.</p><p>Ein hoher Prozentsatz ist nicht automatisch der beste Preis. Vergleiche den Endpreis mit regulären Alternativen und achte auf Service-, Versand- oder Anmeldegebühren.</p>`],
      ['nachweis', 'Welcher Nachweis kann verlangt werden?', `<p>Üblich sind ein gültiger Studierendenausweis, eine aktuelle Inskriptionsbestätigung oder eine Hochschul-Mailadresse. Manche Angebote kombinieren den Studierendenstatus mit einer Altersgrenze. Andere gelten nur für neu angelegte Konten.</p><p>Gib persönliche Dokumente nur auf der offiziellen Website oder in der offiziellen App des Anbieters ein. Ein Social-Media-Konto, das Ausweiskopien per Direktnachricht fordert, ist keine angemessene Verifizierungsstelle.</p>`],
      ['rechnung', 'Die tatsächliche Ersparnis berechnen', `<ol><li>Notiere den regulären Gesamtpreis.</li><li>Ziehe den Rabatt ab und addiere alle Gebühren.</li><li>Prüfe Mindestlaufzeit und automatische Verlängerung.</li><li>Vergleiche das Ergebnis mit einem frei verfügbaren Tarif.</li><li>Setze eine Erinnerung, falls der Vorteil nach Studienende ausläuft.</li></ol><p>Besonders bei Abos ist die monatliche Ersparnis weniger wichtig als der Gesamtpreis über die Mindestlaufzeit.</p>`],
      ['aktuell', 'Aktuelle Rabatte sauber verifizieren', `<p>Verlasse dich nicht auf alte Listen ohne Änderungsdatum. Öffne die Originalbedingungen und kontrolliere, ob Wien, deine Hochschule und dein Status erfasst sind. Auf FreeFinder findest du außerdem <a href="/angebote-wien-heute.html">aktuelle Wiener Deals mit bekanntem Enddatum</a>, darunter auch allgemeine Rabatte ohne Studierendenpflicht.</p>`],
    ],
    faqs: [
      ['Welche Studentenrabatte gibt es in Wien?', 'Die Kategorien reichen von Essen, Kultur und Sport bis zu Software, Mobilfunk und Bildung. Die konkrete Verfügbarkeit und die Voraussetzungen müssen beim jeweiligen Anbieter geprüft werden.'],
      ['Reicht ein Studierendenausweis als Nachweis?', 'Oft ja, aber nicht immer. Manche Angebote verlangen zusätzlich eine aktuelle Inskriptionsbestätigung, Hochschul-Mailadresse oder ein bestimmtes Höchstalter.'],
      ['Sind Studentenabos automatisch günstiger?', 'Nicht zwingend. Gebühren, Mindestlaufzeiten und automatische Verlängerungen können die Ersparnis verringern. Entscheidend ist der Gesamtpreis.'],
    ],
    related: [['Rabatte in Wien', 'rabatte-wien.html'], ['1+1-Aktionen in Wien', 'eins-plus-eins-wien.html'], ['Aktuelle Wien-Deals', '/angebote-wien-heute.html']],
  },
  {
    slug: 'produktproben-wien',
    title: 'Kostenlose Produktproben in Wien finden',
    meta: 'Kostenlose Produktproben in Wien finden: Verkostungen, Testaktionen und Gratis-Samples seriös prüfen und Datenschutzfallen vermeiden.',
    eyebrow: 'Produktproben Wien',
    headline: 'Produktproben in Wien finden, ohne auf Scheinangebote hereinzufallen.',
    intro: 'Verkostung im Shop, Gratis-Sample bei einer Neueröffnung oder Produkttest per Registrierung: Nicht jede „kostenlose Probe“ funktioniert gleich.',
    image: '/og-preview-stores.png', imageAvif: '/og-preview-stores-600.avif 600w, /og-preview-stores-1200.avif 1200w', imageWidth: 1200, imageHeight: 630,
    imageAlt: 'FreeFinder App mit unterschiedlichen Wiener Gratis-Angeboten',
    sections: [
      ['arten', 'Vier Arten von Produktproben', `<p>Bei <strong>Produktproben in Wien</strong> sind Vor-Ort-Verkostungen, kleine Gratis-Samples, Cashback-Tests und registrierungspflichtige Produkttests verbreitet. Eine Verkostung ist meist sofort verfügbar. Cashback bedeutet dagegen, dass du zuerst bezahlst und nur bei korrekter Einreichung Geld zurückbekommst.</p><ul><li><strong>Sample:</strong> Kleine Produktmenge ohne Kauf.</li><li><strong>Verkostung:</strong> Test direkt am Aktionsstand.</li><li><strong>Cashback-Test:</strong> Kaufpreis wird nach Prüfung erstattet.</li><li><strong>Testpanel:</strong> Produkt gegen Registrierung und Feedback.</li></ul>`],
      ['serios', 'Woran du eine seriöse Aktion erkennst', `<p>Eine belastbare Aktion nennt Veranstalter, Produkt, Zeitraum, Standort und Teilnahmebedingungen. Bei Cashback sollte klar sein, welcher Beleg benötigt wird und bis wann die Einreichung erfolgen muss. Unklare Formulare, aggressive Weiterleitungen oder eine angebliche Versandgebühr können aus einem Gratisangebot ein kostenpflichtiges Modell machen.</p>`],
      ['daten', 'Datenschutz und Sicherheit', `<p>Prüfe, welche Daten wirklich erforderlich sind. Für eine Verkostung vor Ort braucht es normalerweise keine Ausweiskopie. Bei Testpanels können Adresse und Kontaktmöglichkeit plausibel sein; Zahlungsdaten sind für eine reine Gratisprobe dagegen erklärungsbedürftig.</p><p>Bei Lebensmitteln und Kosmetik bleiben Inhaltsstoffe, Allergene und persönliche Verträglichkeit wichtig. „Gratis“ ersetzt keine Produktinformation.</p>`],
      ['finden', 'Produktproben effizient finden', `<p>Suche bei offiziellen Anbieterkanälen, in Filialhinweisen und auf lokalen Deal-Seiten. Kombiniere Begriffe wie „Produktprobe Wien“, „gratis testen Wien“, „Verkostung Wien“ oder „Neueröffnung Gratisproben“. Die <a href="/angebote-wien-heute.html">aktuelle FreeFinder-Übersicht</a> nimmt nur Angebote mit erfasstem Enddatum auf.</p>`],
    ],
    faqs: [
      ['Wo gibt es kostenlose Produktproben in Wien?', 'Typische Orte sind Shops, Einkaufszentren, Aktionsstände und Neueröffnungen. Online-Testaktionen können zusätzlich per Versand oder Cashback funktionieren.'],
      ['Ist Cashback dasselbe wie eine Gratisprobe?', 'Nein. Bei Cashback bezahlst du zuerst und erhältst den Betrag nur zurück, wenn Kauf und Einreichung alle Bedingungen erfüllen.'],
      ['Welche Daten sollte ich für eine Produktprobe angeben?', 'Nur Daten, die für Ausgabe, Versand oder Teilnahme nachvollziehbar erforderlich sind. Lies vor der Registrierung die Datenschutz- und Teilnahmebedingungen des offiziellen Anbieters.'],
    ],
    related: [['Kostenlose Angebote in Wien', 'kostenlose-angebote-wien.html'], ['Gratis Kaffee in Wien', 'gratis-kaffee-wien.html'], ['Aktuelle Wien-Deals', '/angebote-wien-heute.html']],
  },
  {
    slug: 'eins-plus-eins-wien',
    title: '1+1-Aktionen in Wien richtig vergleichen',
    meta: '1+1-Aktionen in Wien prüfen: Stückpreis, Produktbindung, App-Coupon, Mindestumsatz und Einlösebedingungen verständlich vergleichen.',
    eyebrow: '1+1 Aktionen Wien',
    headline: 'Bei 1+1-Aktionen in Wien den echten Vorteil erkennen.',
    intro: 'Zweites Produkt gratis klingt eindeutig. Produktgröße, Sortenbindung und Vergleichspreis entscheiden aber darüber, ob ein 1+1-Deal tatsächlich günstig ist.',
    image: '/assets/current-ios/deals-home.jpg', imageAvif: '/assets/current-ios/deals-home-400.avif 400w, /assets/current-ios/deals-home-736.avif 736w', imageWidth: 736, imageHeight: 414,
    imageAlt: 'FreeFinder App mit Pizza-, Getränke- und Rabattangeboten',
    sections: [
      ['rechnung', 'Was bedeutet 1+1 tatsächlich?', `<p>Bei klassischen <strong>1+1-Aktionen in Wien</strong> erhältst du beim Kauf eines Produkts ein zweites gleiches oder günstigeres Produkt kostenlos. Manchmal wird stattdessen ein Rabatt auf zwei Artikel verrechnet. Für den Vergleich teilst du den Gesamtpreis durch die tatsächlich erhaltene Menge.</p><p>Prüfe außerdem den Normalpreis. Wird der Ausgangspreis während der Aktion erhöht, kann ein gewöhnlicher Rabatt bei einem anderen Anbieter günstiger sein.</p>`],
      ['details', 'Kleine Bedingungen mit großer Wirkung', `<ul><li>Gilt nur das gleiche Produkt oder auch eine andere Sorte?</li><li>Ist das günstigere Produkt gratis?</li><li>Brauchst du einen Coupon oder eine bestimmte App?</li><li>Gibt es ein Tageslimit oder nur teilnehmende Filialen?</li><li>Fallen Liefer-, Verpackungs- oder Servicegebühren an?</li></ul><p>Bei Lieferangeboten sollte der Endpreis im Warenkorb geprüft werden. Ein Gratisartikel gleicht hohe Zusatzkosten nicht automatisch aus.</p>`],
      ['teilen', 'Wann sich ein 1+1-Deal besonders lohnt', `<p>Der Vorteil ist am größten, wenn du beide Produkte ohnehin brauchst oder das zweite mit einer anderen Person teilst. Bei verderblichen Waren führt ein unnötiger Zweitartikel dagegen nicht zu einer echten Ersparnis. Kaufe deshalb nicht allein wegen des Aktionslabels.</p>`],
      ['check', 'Vor dem Bezahlen kontrollieren', `<p>Aktiviere notwendige Coupons und kontrolliere, ob der Rabatt im Warenkorb oder auf dem Kassendisplay erscheint. Bewahre bei komplizierten Aktionen die offiziellen Bedingungen bis zur Abrechnung auf. Auf der Seite <a href="/angebote-wien-heute.html">Aktuelle Angebote in Wien</a> werden 1+1-Treffer mit bekanntem Enddatum gesondert gekennzeichnet.</p>`],
    ],
    faqs: [
      ['Was bedeutet 1+1 gratis?', 'Üblicherweise kaufst du ein Produkt und erhältst ein zweites gleiches oder günstigeres Produkt ohne zusätzlichen Produktpreis. Die genaue Regel steht in den Bedingungen.'],
      ['Sind 1+1-Aktionen immer 50 Prozent Rabatt?', 'Nur wenn beide Produkte denselben Preis haben und keine Zusatzkosten anfallen. Bei unterschiedlichen Preisen, Gebühren oder Produktbindungen kann die Ersparnis geringer sein.'],
      ['Kann ich bei 1+1 zwei verschiedene Produkte wählen?', 'Das hängt von der Aktion ab. Häufig muss es dasselbe Produkt sein oder das günstigere Produkt wird kostenlos.'],
    ],
    related: [['Rabatte in Wien', 'rabatte-wien.html'], ['Gratis Essen in Wien', 'gratis-essen-wien.html'], ['Aktuelle Wien-Deals', '/angebote-wien-heute.html']],
  },
  {
    slug: 'kostenlose-freizeitangebote-wien',
    title: 'Kostenlose Freizeitangebote in Wien finden',
    meta: 'Kostenlose Freizeitangebote in Wien finden: freie Tage, Schnupperangebote und Probetrainings mit Anmeldung, Kündigungsfrist und Folgekosten seriös prüfen.',
    eyebrow: 'Kostenlose Freizeit Wien',
    headline: 'Kostenlose Freizeitangebote in Wien sinnvoll entdecken – und Probetrainings richtig beenden.',
    intro: 'Freier Eintritt, Schnuppertraining oder offene Aktivität: Wien bietet unterschiedliche Möglichkeiten, Freizeit ohne Eintrittspreis zu planen. Bei einer kostenlosen Probe sind Anmeldung, Kündigungsfrist und Folgekosten ebenso wichtig wie der Gratiszeitraum.',
    modified: '2026-08-21', modifiedLabel: '21. August 2026',
    image: '/assets/blog/evo-probetraining-wien-2026.jpg', imageWidth: 1600, imageHeight: 900,
    imageAlt: 'Person betritt ein helles Fitnessstudio mit Trainingsgeräten im Hintergrund',
    sections: [
      ['kategorien', 'Welche kostenlosen Aktivitäten gibt es?', `<p><strong>Kostenlose Freizeitangebote in Wien</strong> können freie Museumstage, öffentliche Programme, offene Sportangebote, Schnupperstunden, Märkte oder zeitlich begrenzte Aktionen umfassen. Manche sind dauerhaft kostenlos, andere nur an einem Termin oder für eine bestimmte Zielgruppe.</p><p>Unterscheide freie Teilnahme von einem kostenlosen Probetraining. Bei einer Probe können Anmeldung, Beratungsgespräch oder spätere Aboangebote dazugehören, auch wenn für den Termin selbst nichts berechnet wird.</p>`],
      ['quellen', 'Offizielle Quellen zuerst prüfen', `<p>Für städtische Kultur-, Natur- und Freizeitangebote sind die offiziellen Seiten der jeweiligen Einrichtung oder der Stadt die zuverlässigste Quelle. Bei Studios, Kursen und privaten Veranstaltern zählt die aktuelle Anbieterseite. Kalender-Aggregatoren helfen beim Entdecken, sollten aber nicht die letzte Prüfung ersetzen.</p>`],
      ['probetraining', 'Probetraining: die Frist vor der Anmeldung prüfen', `<p>Ein kostenloses Probetraining ist nur dann kostenfrei, wenn du die Kündigungs- und Zahlungsregel verstanden hast. Die aktuell geprüfte <a href="https://evofitness.at/de/7-tage-probetraining/" rel="noopener">EVO-Probetrainingseite</a> nennt ein konkretes Beispiel: Nach der Online-Anmeldung kommt der Zugangscode per SMS, der Zugang beginnt direkt mit der Anmeldung und gilt sieben Tage in den EVO Clubs.</p><p>Entscheidend ist der achte Tag: Laut EVO startet dann automatisch eine monatlich kündbare Mitgliedschaft. Wer nicht weitermachen möchte, muss über MyEVO bis zum Ende des siebten Tages kündigen; der Anmeldetag zählt bereits als erster Probetrainingstag. Die Anbieterseite nennt für die kostenlose Testwoche kein kalendarisches Aktionsende. Deshalb ist sie ein laufendes Beispiel und kein Deal mit zugesichertem Ablaufdatum.</p><div class="article-note"><strong>Vor dem Absenden notieren</strong>Speichere den Starttag, die Kündigungsfrist und den direkten Kündigungsweg. Setze eine Erinnerung spätestens einen Tag vor Ablauf der kostenlosen Probe – nicht erst am achten Tag.</div>`],
      ['anmeldung', 'Anmeldung, Kapazität und Folgekosten', `<p>„Kostenlos“ bedeutet nicht automatisch „ohne Reservierung“. Viele Führungen, Workshops und Schnupperstunden haben begrenzte Plätze. Bei Studios kommen oft Konto, Zugangscode und späteres Abo dazu. Prüfe vor der Anmeldung, ob ein Zahlungsmittel verlangt wird, wann die Testzeit beginnt und zu welchem Preis es nach der Probe weitergeht.</p><p>Beim aktuell geprüften EVO-Angebot nennt der Anbieter für die Mitgliedschaft nach der Testphase einen Monatspreis von 49,90 Euro bis Ende November 2026 und danach 64,90 Euro monatlich. Dieser Preis betrifft die anschließende Mitgliedschaft, nicht die kostenlose Testwoche. Die jeweils aktuelle Anbieterinformation ist maßgeblich.</p>`],
      ['kombinieren', 'Freizeitangebote nach Bezirk kombinieren', `<p>Plane mehrere Aktivitäten in derselben Gegend und kontrolliere die Öffnungszeiten am Veranstaltungstag. Dadurch bleiben kostenlose Ausflüge auch bei ausgebuchten Programmpunkten flexibel. Kommerzielle Gratis- und Rabattaktionen mit eindeutigem Enddatum findest du ergänzend unter <a href="/angebote-wien-heute.html">Aktuelle Wien-Deals</a>.</p>`],
    ],
    faqs: [
      ['Was kann man in Wien kostenlos unternehmen?', 'Je nach Termin gibt es freie Kultur-, Natur-, Sport- und Veranstaltungsangebote sowie kostenlose Schnupperaktionen. Verbindliche Angaben liefert die jeweilige offizielle Stelle.'],
      ['Muss ich kostenlose Freizeitangebote reservieren?', 'Häufig ja, besonders bei Führungen, Workshops und Kursen mit begrenzter Kapazität. Die Reservierungsregel steht beim Veranstalter.'],
      ['Sind kostenlose Probetrainings ohne Verpflichtung?', 'Nicht unbedingt. Beim aktuell geprüften EVO-Angebot beginnt am achten Tag automatisch eine Mitgliedschaft, wenn die Probe nicht bis zum Ende des siebten Tages über MyEVO gekündigt wird. Lies bei jedem Anbieter die aktuelle Kündigungs- und Zahlungsregel.'],
    ],
    related: [['Kostenlose Angebote in Wien', 'kostenlose-angebote-wien.html'], ['Studentenrabatte in Wien', 'studentenrabatte-wien.html'], ['Aktuelle Wien-Deals', '/angebote-wien-heute.html']],
  },
];

function escapeHtml(value) {
  return String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function renderGuide(guide) {
  const canonical = `https://freefinder.at/blog/${guide.slug}.html`;
  const readingMinutes = Math.max(5, Math.round(guide.sections.map((section) => section[2].replace(/<[^>]+>/g, ' ').split(/\s+/).length).reduce((a, b) => a + b, 0) / 170));
  const structuredData = {
    '@context': 'https://schema.org',
    '@graph': [
      {
        '@type': 'Article', headline: guide.title, description: guide.meta, datePublished: PUBLISHED, dateModified: guide.modified || PUBLISHED,
        inLanguage: 'de-AT', mainEntityOfPage: canonical, image: `https://freefinder.at${guide.image}`,
        author: { '@type': 'Organization', name: 'FreeFinder Redaktion', url: 'https://freefinder.at/about.html' },
        publisher: { '@type': 'Organization', name: 'FreeFinder', logo: { '@type': 'ImageObject', url: 'https://freefinder.at/icon-512.svg' } },
      },
      {
        '@type': 'BreadcrumbList', itemListElement: [
          { '@type': 'ListItem', position: 1, name: 'FreeFinder', item: 'https://freefinder.at/' },
          { '@type': 'ListItem', position: 2, name: 'Blog', item: 'https://freefinder.at/blog/' },
          { '@type': 'ListItem', position: 3, name: guide.title, item: canonical },
        ],
      },
      {
        '@type': 'FAQPage', mainEntity: guide.faqs.map(([question, answer]) => ({
          '@type': 'Question', name: question, acceptedAnswer: { '@type': 'Answer', text: answer },
        })),
      },
    ],
  };
  const sections = guide.sections.map(([id, title, body]) => `<h2 id="${id}">${title}</h2>${body}`).join('\n        ');
  const aside = guide.sections.map(([id, title]) => `<a href="#${id}">${escapeHtml(title)}</a>`).join('');
  const related = guide.related.map(([label, href]) => `<a href="${href}">${escapeHtml(label)}</a>`).join(' · ');
  const faqs = guide.faqs.map(([question, answer]) => `<h3>${escapeHtml(question)}</h3><p>${escapeHtml(answer)}</p>`).join('\n        ');
  return `<!DOCTYPE html>
<html lang="de-AT">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(guide.title)} | FreeFinder</title>
  <meta name="description" content="${escapeHtml(guide.meta)}">
  <meta name="robots" content="index,follow,max-image-preview:large,max-snippet:-1">
  <link rel="canonical" href="${canonical}">
  <meta property="og:title" content="${escapeHtml(guide.title)}">
  <meta property="og:description" content="${escapeHtml(guide.meta)}">
  <meta property="og:image" content="https://freefinder.at${guide.image}">
  <meta property="og:url" content="${canonical}">
  <meta property="og:type" content="article">
  <meta name="twitter:card" content="summary_large_image">
  <link rel="icon" href="/icon-192.svg" type="image/svg+xml">
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link rel="preload" href="https://fonts.googleapis.com/css2?family=Bricolage+Grotesque:wght@600;700;800&family=Plus+Jakarta+Sans:wght@400;500;600;700;800&display=swap" as="style">
  <link href="https://fonts.googleapis.com/css2?family=Bricolage+Grotesque:wght@600;700;800&family=Plus+Jakarta+Sans:wght@400;500;600;700;800&display=swap" rel="stylesheet" media="print" onload="this.media='all'">
  <noscript><link href="https://fonts.googleapis.com/css2?family=Bricolage+Grotesque:wght@600;700;800&family=Plus+Jakarta+Sans:wght@400;500;600;700;800&display=swap" rel="stylesheet"></noscript>
  <link rel="stylesheet" href="/consent.css?v=5">
  <link rel="stylesheet" href="blog.css">
  <script defer src="/analytics-config.js"></script>
  <script defer src="/consent.js?v=5"></script>
  <script type="application/ld+json">${JSON.stringify(structuredData)}</script>
</head>
<body>
  <!-- Generated by scripts/generate-topic-guides.mjs. -->
  <header class="site-header"><nav class="nav" aria-label="Hauptnavigation"><a class="brand" href="/"><img class="brand-mark" src="/icon-192.svg" alt="" width="38" height="38">FreeFinder</a><div class="nav-links"><a href="/angebote-wien-heute.html">Aktuelle Deals</a><a href="/blog/">Blog</a><a class="nav-download" href="/#download">App laden</a></div></nav></header>
  <main>
    <header class="article-hero"><div class="hero-inner"><p class="eyebrow">${escapeHtml(guide.eyebrow)}</p><h1>${escapeHtml(guide.headline)}</h1><p class="hero-copy">${escapeHtml(guide.intro)}</p><div class="article-meta"><span>Aktualisiert am ${guide.modifiedLabel || PUBLISHED_LABEL}</span><span>${readingMinutes} Minuten Lesezeit</span></div><div class="article-byline"><span>Von <a href="/about.html">FreeFinder Redaktion</a></span><span>Verantwortlich: Stefan Ataalla</span></div></div></header>
    <div class="article-layout">
      <article class="article-body">
        <picture>${guide.imageAvif ? `<source type="image/avif" srcset="${guide.imageAvif}" sizes="(max-width: 860px) 100vw, 710px">` : ''}<img class="article-image" src="${guide.image}" alt="${escapeHtml(guide.imageAlt)}" width="${guide.imageWidth}" height="${guide.imageHeight}" loading="eager" decoding="async"></picture>
        ${sections}
        <h2 id="faq">Häufige Fragen</h2>
        ${faqs}
        <h2 id="weiterlesen">Passende FreeFinder-Seiten</h2>
        <p class="related-links">${related}</p>
      </article>
      <aside class="article-aside" aria-label="Inhalt"><h2>In diesem Guide</h2>${aside}<a href="#faq">Häufige Fragen</a><a href="#weiterlesen">Weiterlesen</a></aside>
    </div>
  </main>
  <section class="download-band" aria-labelledby="downloadTitle"><div class="download-inner"><div><h2 id="downloadTitle">Aktuelle Wien-Deals öffnen.</h2><p>FreeFinder kostenlos für iPhone und Android laden.</p></div><div class="store-links"><a href="https://apps.apple.com/app/id6758958213">App Store</a><a href="https://play.google.com/store/apps/details?id=com.stefanataalla.freefinderwien">Google Play</a></div></div></section>
  <footer class="site-footer"><div class="footer-inner"><strong>FreeFinder Wien</strong><div class="footer-links"><a href="/angebote-wien-heute.html">Aktuelle Deals</a><a href="/about.html">Über uns</a><a href="/blog/">Blog</a><a href="/presse.html">Presse</a><a href="/privacy.html">Datenschutz</a><a href="/support.html">Support</a></div></div></footer>
</body>
</html>
`;
}

for (const guide of guides) {
  fs.writeFileSync(path.join(BLOG_DIR, `${guide.slug}.html`), renderGuide(guide));
}
console.log(`Generated ${guides.length} SEO topic guides in docs/blog`);

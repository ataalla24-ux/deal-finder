#!/usr/bin/env node
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { polishHtml } from './polish-website.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BLOG_DIR = path.join(ROOT, 'docs', 'blog');
const dealGuides = JSON.parse(fs.readFileSync(path.join(ROOT, 'reviews/deal-guides.json'), 'utf8')).guides;
const now = process.env.SEO_NOW ? Date.parse(process.env.SEO_NOW) : Date.now();
if (!Number.isFinite(now)) throw new Error('SEO_NOW must be a valid timestamp.');

const timelyGuides = [
  {
    slug: 'lugner-city-50-prozent-gastronomie-5-oktober-2026',
    title: 'Lugner City Wien: 50 Prozent Rabatt am 5. Oktober 2026',
    meta: 'Am 5. Oktober 2026: 50 Prozent Rabatt auf alles in den Gastronomielokalen der Lugner City Wien. Bedingungen, teilnehmende Lokale und Quelle prüfen.',
    eyebrow: '5. Oktober 2026 · Lugner City',
    headline: '50 Prozent Rabatt in der Lugner City am 5. Oktober 2026.',
    intro: 'Für den 5. Oktober 2026 sind laut Dealquelle 50 Prozent Rabatt auf alles in den Gastronomielokalen der Lugner City angekündigt. Dieser Tagesdeal gilt ausschließlich am genannten Datum; prüfe vor Ort die Teilnahme und Bedingungen.',
    published: '2026-10-05', publishedLabel: '5. Oktober 2026', modified: '2026-10-05', modifiedLabel: '5. Oktober 2026',
    expires: '2026-10-05T23:59:59+02:00',
    image: '/assets/current-ios/deals-home.jpg', imageAvif: '/assets/current-ios/deals-home-400.avif 400w, /assets/current-ios/deals-home-736.avif 736w', imageWidth: 736, imageHeight: 414,
    imageAlt: 'FreeFinder App mit aktuellen Restaurant- und Rabattangeboten in Wien',
    sections: [
      ['deal', 'Was war für den 5. Oktober in der Lugner City angekündigt?', `<p>Am <strong>5. Oktober 2026</strong> gibt es laut der geprüften Dealquelle <strong>50 Prozent Rabatt auf alles in allen Gastronomielokalen der Lugner City</strong>. Damit zählen potenziell mehrere Restaurants, Cafés und Food-Angebote im Einkaufszentrum zu dieser Tagesaktion.</p><p>Die konkrete Einlösung kann je nach Lokal, Kassa und Aktionsbedingungen abweichen. Prüfe vor dem Bestellen, ob das gewünschte Lokal tatsächlich teilnimmt.</p>`],
      ['einloesen', 'Einlösung am Aktionstag', `<ol><li>Am 5. Oktober 2026 zur Lugner City in Wien gehen und das gewünschte Gastronomielokal auswählen.</li><li>Vor der Bestellung kurz nachfragen, ob die 50-Prozent-Aktion dort gilt.</li><li>Beim Bezahlen kontrollieren, ob der Rabatt korrekt abgezogen wurde.</li><li>Den Kassenbon oder Endbetrag vor dem Verlassen prüfen.</li></ol><div class="article-note"><strong>Nur am 5. Oktober 2026</strong>Der Deal ist ausschließlich für diesen Tag gelistet. Die Aktion kann je nach Lokal, Bestand oder interner Abwicklung abweichend sein.</div>`],
      ['teilen', 'Den Tagesdeal mit eindeutigem Datum teilen', `<p>Der Vorteil ist leicht verständlich: <strong>50 Prozent Rabatt, Lugner City, am 5. Oktober 2026</strong>. Wenn du Freunde oder Familie in Wien hast, schicke ihnen den Link mit dem Datum und dem Hinweis, die Teilnahme des Lokals vor der Bestellung zu bestätigen.</p><p>Teile keine abgelaufene Version als aktuellen Deal: Nach dem Aktionstag dient die Angebotsseite nur noch als Archiv oder Quelle für die Tagesaktion.</p>`],
      ['quelle', 'Quelle und Aktualität', `<p>Die Angaben stammen aus dem <a href="https://www.preisjaeger.at/gutschein/lugner-city-50-in-allen-gastronomielokalen-370071" rel="noopener">öffentlichen Dealbeitrag zur Lugner City</a>. Dort ist der 5. Oktober 2026 als Gültigkeitstag angegeben. Prüfe vor Ort die konkrete Teilnahme des gewünschten Gastronomielokals.</p><p>Weitere aktuelle Rabatte in Wien findest du in der <a href="/angebote-wien-heute.html">FreeFinder-Deals-Übersicht</a>.</p>`],
    ],
    faqs: [
      ['Wie viel Rabatt war für den 5. Oktober 2026 angekündigt?', 'Laut Dealquelle 50 Prozent Rabatt auf alles in den teilnehmenden Gastronomielokalen.'],
      ['An welchem Tag gilt der Deal?', 'Am 5. Oktober 2026.'],
      ['Gilt der Rabatt in jedem Lokal?', 'Der Deal nennt alle Gastronomielokale, trotzdem solltest du die Teilnahme vor der Bestellung direkt beim gewünschten Lokal prüfen.'],
      ['Kann ich den Deal nach dem 5. Oktober noch nutzen?', 'Das ist nicht zugesichert. Der Deal ist nur für den 5. Oktober 2026 gelistet.'],
    ],
    related: [['Aktuelle Wien-Deals', '/angebote-wien-heute.html'], ['Restaurant-Gutscheine in Wien', 'restaurant-gutscheine-wien.html'], ['Gratis Essen in Wien', 'gratis-essen-wien.html']],
  },
  {
    slug: 'papa-duck-bowl-wien-1plus1-gratis',
    title: 'Papa Duck Wien: 1+1 Bowl gratis nach dem Folgen',
    meta: 'Papa Duck in Wien: Eine Bowl bestellen und eine zweite Bowl gratis erhalten. TikTok-Account folgen, Barnabitengasse 1 in 1060 Wien und Bedingungen prüfen.',
    eyebrow: 'Gratis Bowl Wien',
    headline: 'Eine Bowl bestellen, eine Bowl gratis bei Papa Duck.',
    intro: 'Papa Duck bewirbt aktuell eine 1+1-Bowl-Aktion in Wien: Nach dem Folgen des Accounts gibt es beim Bestellen einer Bowl eine zweite Bowl gratis dazu. Die Bowls sollen frei kombinierbar sein.',
    published: '2026-10-05', publishedLabel: '5. Oktober 2026', modified: '2026-10-05', modifiedLabel: '5. Oktober 2026',
    image: '/assets/current-ios/deals-home.jpg', imageAvif: '/assets/current-ios/deals-home-400.avif 400w, /assets/current-ios/deals-home-736.avif 736w', imageWidth: 736, imageHeight: 414,
    imageAlt: 'FreeFinder App mit kostenlosen Food-Angeboten in Wien',
    sections: [
      ['angebot', 'Wie funktioniert die Papa-Duck-Bowl-Aktion?', `<p>Bei Papa Duck in Wien gilt laut dem aktuellen Beitrag: <strong>Eine Bowl bestellen, eine zweite Bowl gratis dazu erhalten</strong>. Die Bowls sind laut Dealtext <strong>frei kombinierbar</strong>.</p><p>Als Voraussetzung wird genannt, Papa Duck zu folgen. Da kein fixes Ablaufdatum angegeben ist, solltest du die Aktion vor der Bestellung direkt beim Lokal oder im Originalbeitrag bestätigen.</p>`],
      ['einloesen', 'So löst du die 1+1-Bowl ein', `<ol><li>Den <a href="https://www.tiktok.com/@papa.duck.at/video/7692719026811850006" rel="noopener">Originalbeitrag von Papa Duck</a> öffnen.</li><li>Dem angegebenen Papa-Duck-Account folgen.</li><li>Zu Papa Duck, Barnabitengasse 1, 1060 Wien gehen.</li><li>Eine Bowl bestellen und die 1+1-Aktion vor dem Bezahlen angeben.</li><li>Prüfen, ob die zweite Bowl tatsächlich mit 0 Euro berechnet wird.</li></ol><div class="article-note"><strong>Aktualität prüfen</strong>Der Beitrag nennt „nur für kurze Zeit“, aber kein konkretes Enddatum. Frage deshalb vor der Bestellung nach der aktuellen Gültigkeit.</div>`],
      ['bedingungen', 'Worauf solltest du achten?', `<p>Die Aktion ist kein allgemeiner Gutschein für jede Bestellung. Entscheidend ist, ob das Folgen des Accounts nachweisbar sein muss, welche Bowl-Größen eingeschlossen sind und ob die Aktion nur vor Ort gilt.</p><ul><li>Account vor der Bestellung folgen.</li><li>Frei kombinierbare Bowls bestätigen.</li><li>Teilnahme und mögliche Zeitfenster beim Personal prüfen.</li><li>Auf dem Bon kontrollieren, ob eine Bowl gratis ist.</li></ul>`],
      ['quelle', 'Originalquelle und Standort', `<p>Quelle ist der <a href="https://www.tiktok.com/@papa.duck.at/video/7692719026811850006" rel="noopener">TikTok-Beitrag von Papa Duck</a>. Der Feed nennt als Standort <strong>Barnabitengasse 1, 1060 Wien</strong>. Da der Beitrag „nur für kurze Zeit“ sagt, kann sich die Verfügbarkeit ohne Vorankündigung ändern.</p><p>Weitere Gratis- und 1+1-Food-Angebote findest du in der <a href="/angebote-wien-heute.html">aktuellen Wien-Deals-Übersicht</a>.</p>`],
    ],
    faqs: [
      ['Was ist bei Papa Duck gratis?', 'Beim Bestellen einer Bowl gibt es laut Dealquelle eine zweite Bowl gratis dazu.'],
      ['Muss ich Papa Duck folgen?', 'Ja, das Folgen des Accounts wird im Deal als Voraussetzung genannt.'],
      ['Wo ist Papa Duck?', 'Barnabitengasse 1, 1060 Wien.'],
      ['Wie lange gilt die Aktion?', 'Es ist kein fixes Enddatum angegeben; der Beitrag spricht von „nur für kurze Zeit“.'],
    ],
    related: [['Gratis Essen in Wien', 'gratis-essen-wien.html'], ['1+1-Aktionen in Wien', 'eins-plus-eins-wien.html'], ['Aktuelle Wien-Deals', '/angebote-wien-heute.html']],
  },
];

function makeRecentDealGuide({ slug, title, meta, eyebrow, headline, intro, modified, published, expires = '', imageAlt, offer, how, conditions, source, faqs, related }) {
  return {
    slug, title, meta, eyebrow, headline, intro,
    published, publishedLabel: '6. Oktober 2026', modified, modifiedLabel: '6. Oktober 2026', expires,
    image: '/assets/current-ios/deals-home.jpg', imageAvif: '/assets/current-ios/deals-home-400.avif 400w, /assets/current-ios/deals-home-736.avif 736w', imageWidth: 736, imageHeight: 414, imageAlt,
    sections: [
      ['angebot', 'Das aktuelle Angebot im Überblick', offer],
      ['einloesen', 'So löst du den Deal ein', how],
      ['bedingungen', 'Wichtige Bedingungen und Aktualität', conditions],
      ['quelle', 'Quelle und weitere Deals', `${source}<p>Weitere aktuelle Angebote findest du in der <a href="/angebote-wien-heute.html">FreeFinder-Übersicht für Wien</a>.</p>`],
    ],
    faqs,
    related,
  };
}

const recentDealGuides = [
  makeRecentDealGuide({
    slug: 'guess-shopping-week-20-prozent-wien', title: 'GUESS Shopping Week: 20 Prozent Rabatt', meta: 'GUESS Shopping Week: 20 Prozent Rabatt auf ausgewählte Styles bis 13. Oktober 2026. Gutschein, Gültigkeit und ausgewählte Produkte prüfen.', eyebrow: 'GUESS Rabatt Österreich', headline: '20 Prozent Rabatt auf ausgewählte GUESS-Styles.', intro: 'Während der GUESS Shopping Week gibt es laut Dealquelle 20 Prozent Rabatt auf ausgewählte Styles. Der Deal ist bis 13. Oktober 2026 gelistet.', published: '2026-10-06', modified: '2026-10-06', expires: '2026-10-13T23:59:59+02:00', imageAlt: 'FreeFinder App mit aktuellen Shopping-Rabatten',
    offer: `<p>Die aktuelle GUESS-Aktion bietet <strong>20 Prozent Rabatt auf ausgewählte Styles</strong>. Nicht jedes Produkt muss automatisch eingeschlossen sein; prüfe deshalb im Shop, ob der Rabatt am gewünschten Artikel angezeigt wird.</p>`,
    how: `<ol><li>Die <a href="https://www.gutscheine.at/guess" rel="noopener">GUESS-Aktionsseite</a> öffnen.</li><li>Ausgewählte Styles und Teilnahmebedingungen prüfen.</li><li>Beim Checkout kontrollieren, ob 20 Prozent Rabatt abgezogen werden.</li><li>Vor dem Kauf Lieferkosten, Rückgaberegeln und Enddatum prüfen.</li></ol>`,
    conditions: `<p>Der Deal ist bis <strong>13. Oktober 2026</strong> gelistet. Die Auswahl der teilnehmenden Styles und die konkrete Darstellung können sich ändern. Maßgeblich ist der Preis im Checkout.</p>`,
    source: `<p>Quelle ist die <a href="https://www.gutscheine.at/guess" rel="noopener">GUESS-Übersicht bei Gutscheine.at</a>. Prüfe vor dem Kauf die Auswahl und das angezeigte Enddatum erneut.</p>`,
    faqs: [['Wie viel Rabatt gibt es bei GUESS?', '20 Prozent auf ausgewählte Styles.'], ['Wie lange gilt die Aktion?', 'Aktuell bis 13. Oktober 2026 gelistet.'], ['Gilt der Rabatt auf alles?', 'Nein, laut Deal sind ausgewählte Styles eingeschlossen.']], related: [['Rabatte in Wien', 'rabatte-wien.html'], ['Gutscheine in Wien', 'gutscheine-wien.html']],
  }),
  makeRecentDealGuide({
    slug: 'ryanair-ibiza-ab-5598-wien-oktober-2026', title: 'Ryanair Wien nach Ibiza ab 55,98 Euro', meta: 'Ryanair-Flug Wien–Ibiza hin und zurück ab 55,98 Euro für 20. bis 22. Oktober 2026. Flugpreis, Gepäck und Verfügbarkeit prüfen.', eyebrow: 'Günstig reisen ab Wien', headline: 'Hin und zurück von Wien nach Ibiza ab 55,98 Euro.', intro: 'Für eine Hin- und Rückreise von Wien nach Ibiza ist aktuell ein Ryanair-Preis ab 55,98 Euro für den 20. bis 22. Oktober 2026 gelistet. Flugpreise und Verfügbarkeit ändern sich dynamisch.', published: '2026-10-06', modified: '2026-10-06', expires: '2026-10-20T23:59:59+02:00', imageAlt: 'FreeFinder App mit günstigen Reiseangeboten ab Wien',
    offer: `<p>Der Deal nennt einen <strong>Ryanair-Roundtrip Wien–Ibiza ab 55,98 Euro</strong> für zwei Tage: Abflug am 20. Oktober und Rückflug am 22. Oktober 2026. Der Preis gilt vorbehaltlich Verfügbarkeit und kann sich beim Öffnen ändern.</p>`,
    how: `<ol><li>Die <a href="https://www.ryanair.com/gb/en/trip/flights/select?adults=1&teens=0&children=0&infants=0&originIata=VIE&destinationIata=IBZ&dateOut=2026-10-20&dateIn=2026-10-22&isReturn=true&discount=0&promoCode=" rel="noopener">Ryanair-Flugsuche</a> öffnen.</li><li>Passagiere, Gepäck und Sitzplatzwünsche prüfen.</li><li>Kontrollieren, ob der Hin- und Rückflug noch ab 55,98 Euro verfügbar ist.</li><li>Vor dem Bezahlen alle Zusatzkosten prüfen.</li></ol>`,
    conditions: `<p>„Ab“-Preise sind nicht garantiert. Handgepäck, Sitzplatz, Priority, Zahlung und weitere Optionen können den Endpreis erhöhen. Buche nur, wenn der vollständige Endbetrag für dich passt.</p>`,
    source: `<p>Quelle ist die <a href="https://www.ryanair.com/gb/en/trip/flights/select?adults=1&teens=0&children=0&infants=0&originIata=VIE&destinationIata=IBZ&dateOut=2026-10-20&dateIn=2026-10-22&isReturn=true&discount=0&promoCode=" rel="noopener">direkte Ryanair-Flugsuche</a>.`,
    faqs: [['Wie viel kostet der Ibiza-Flug?', 'Ab 55,98 Euro hin und zurück laut aktuellem Deal.'], ['Wann geht die Reise?', '20. bis 22. Oktober 2026.'], ['Sind Gepäck und Sitzplatz enthalten?', 'Das muss im Buchungsschritt geprüft werden.']], related: [['Rabatte in Wien', 'rabatte-wien.html'], ['Aktuelle Wien-Deals', '/angebote-wien-heute.html']],
  }),
  makeRecentDealGuide({
    slug: 'pizza-rando-3-doener-zum-preis-von-2-wien', title: 'Pizza Rando Wien: 3 Döner zum Preis von 2', meta: 'Pizza Rando in Wien: Am 9. und 10. Oktober 2026 drei Döner zum Preis von zwei in der Dresdnerstraße 115, 1200 Wien.', eyebrow: 'Döner-Angebot Wien', headline: 'Drei Döner zum Preis von zwei bei Pizza Rando.', intro: 'Pizza Rando kündigt für den 9. und 10. Oktober 2026 eine 3-für-2-Aktion an: Beim Kauf von zwei Dönern gibt es den dritten gratis.', published: '2026-10-06', modified: '2026-10-06', expires: '2026-10-10T23:59:59+02:00', imageAlt: 'FreeFinder App mit Döner-Angeboten in Wien',
    offer: `<p>Bei Pizza Rando gilt laut Deal <strong>3 Döner zum Preis von 2</strong>. Die Aktion ist für <strong>9. und 10. Oktober 2026</strong> angekündigt und findet in der Dresdnerstraße 115, 1200 Wien statt.</p>`,
    how: `<ol><li>Den <a href="https://www.tiktok.com/@pizzarando" rel="noopener">Pizza-Rando-TikTok-Account</a> und die aktuelle Aktion prüfen.</li><li>Am 9. oder 10. Oktober zur Dresdnerstraße 115 gehen.</li><li>Zwei Döner bestellen und die 3-für-2-Aktion nennen.</li><li>Vor dem Bezahlen prüfen, ob der dritte Döner gratis berücksichtigt wird.</li></ol>`,
    conditions: `<p>Der Deal nennt zwei Aktionstage. Prüfe vor Ort, welche Dönerarten teilnehmen und ob weitere Bedingungen gelten. Social-Media-Aktionen können kurzfristig angepasst werden.</p>`,
    source: `<p>Die Quelle ist der <a href="https://www.tiktok.com/@pizzarando" rel="noopener">TikTok-Auftritt von Pizza Rando</a>. Standort laut App-Feed: Dresdnerstraße 115, 1200 Wien.</p>`,
    faqs: [['Wann gilt die 3-für-2-Aktion?', 'Am 9. und 10. Oktober 2026.'], ['Wo ist Pizza Rando?', 'Dresdnerstraße 115, 1200 Wien.'], ['Ist jeder Döner eingeschlossen?', 'Das sollte vor der Bestellung direkt beim Lokal geprüft werden.']], related: [['Gratis Essen in Wien', 'gratis-essen-wien.html'], ['1+1-Aktionen in Wien', 'eins-plus-eins-wien.html']],
  }),
  makeRecentDealGuide({
    slug: 'anker-winterheissgetraenk-20-prozent-wien', title: 'ANKER Wien: 20 Prozent auf Winterheißgetränke', meta: 'ANKER-Rabatt in Wien: Saisonale Winterheißgetränke aktuell um 20 Prozent günstiger. Teilnehmende Filialen und Aktionszeitraum prüfen.', eyebrow: 'Kaffee-Rabatt Wien', headline: '20 Prozent Rabatt auf saisonale Winterheißgetränke bei ANKER.', intro: 'ANKER bewirbt saisonale Winterheißgetränke um 20 Prozent günstiger. Der genaue Aktionszeitraum und die teilnehmenden Filialen sollten direkt beim Anbieter geprüft werden.', published: '2026-10-06', modified: '2026-10-06', imageAlt: 'FreeFinder App mit Kaffee- und Heißgetränke-Angeboten in Wien',
    offer: `<p>Im Aktionszeitraum kostet jedes <strong>saisonale Winterheißgetränk bei ANKER 20 Prozent weniger</strong>. Das kann je nach Filiale und verfügbarem Sortiment unterschiedliche Getränke betreffen.</p>`,
    how: `<ol><li>Die <a href="https://www.ankerbrot.at/aktionen" rel="noopener">ANKER-Aktionsseite</a> öffnen.</li><li>Aktionszeitraum und teilnehmende Filiale prüfen.</li><li>Ein saisonales Winterheißgetränk auswählen.</li><li>Auf dem Bon kontrollieren, ob 20 Prozent abgezogen wurden.</li></ol>`,
    conditions: `<p>Der Feed enthält kein festes Ablaufdatum. Saison, Filiale, Größe und Verfügbarkeit können die Einlösung beeinflussen. Frage im Zweifel vor der Bestellung nach dem Aktionsgetränk.</p>`,
    source: `<p>Quelle ist die <a href="https://www.ankerbrot.at/aktionen" rel="noopener">offizielle ANKER-Aktionsseite</a>.`,
    faqs: [['Wie viel Rabatt gibt es bei ANKER?', '20 Prozent auf saisonale Winterheißgetränke im Aktionszeitraum.'], ['Gilt der Rabatt in jeder Filiale?', 'Teilnehmende Filialen sollten beim Anbieter geprüft werden.'], ['Wie lange läuft die Aktion?', 'Im Feed ist kein festes Ablaufdatum angegeben.']], related: [['Gratis Kaffee in Wien', 'gratis-kaffee-wien.html'], ['Rabatte in Wien', 'rabatte-wien.html']],
  }),
  makeRecentDealGuide({
    slug: 'moebelix-20-prozent-teppiche-wien', title: 'Möbelix Wien: 20 Prozent Rabatt auf Teppiche', meta: 'Möbelix Rabatt: 20 Prozent auf Teppiche. Produkte, Gültigkeit, Lieferbedingungen und den finalen Preis im Shop prüfen.', eyebrow: 'Möbelix Rabatt Österreich', headline: '20 Prozent Rabatt auf Teppiche bei Möbelix.', intro: 'Möbelix listet aktuell 20 Prozent Rabatt auf Teppiche. Prüfe im Online-Shop, welche Teppiche teilnehmen und welcher Preis im Warenkorb gilt.', published: '2026-10-06', modified: '2026-10-06', imageAlt: 'FreeFinder App mit Möbelix-Rabatten',
    offer: `<p>Der aktuelle Deal nennt <strong>20 Prozent Rabatt auf Teppiche bei Möbelix</strong>. Die Aktion kann auf ausgewählte Produkte oder Kategorien begrenzt sein.</p>`,
    how: `<ol><li>Die <a href="https://www.moebelix.at/teppiche-C37C1" rel="noopener">Möbelix-Teppichseite</a> öffnen.</li><li>Aktionskennzeichnung und Produktbedingungen prüfen.</li><li>Den Rabatt im Warenkorb kontrollieren.</li><li>Lieferung, Montage und mögliche Zusatzkosten vor dem Kauf prüfen.</li></ol>`,
    conditions: `<p>Der Feed enthält kein festes Ablaufdatum. Möbelix kann Produkte, Aktionszeitraum und Teilnahmebedingungen ändern. Der Preis im Warenkorb ist maßgeblich.</p>`,
    source: `<p>Quelle ist die <a href="https://www.moebelix.at/teppiche-C37C1" rel="noopener">offizielle Möbelix-Teppichübersicht</a>.`,
    faqs: [['Wie viel Rabatt gibt es?', '20 Prozent auf teilnehmende Teppiche.'], ['Gilt der Rabatt auf jeden Teppich?', 'Das muss am jeweiligen Produkt geprüft werden.'], ['Kann sich der Preis ändern?', 'Ja. Der aktuelle Warenkorbpreis ist maßgeblich.']], related: [['Rabatte in Wien', 'rabatte-wien.html'], ['Gutscheine in Wien', 'gutscheine-wien.html']],
  }),
  makeRecentDealGuide({
    slug: 'autodoc-30-euro-gutschein', title: 'AUTODOC: 30-Euro-Gutschein für alles', meta: 'AUTODOC Gutschein: 30 Euro Rabatt auf alles laut aktueller Gutscheinübersicht. Teilnahmebedingungen, Mindestbestellwert und Einlösung prüfen.', eyebrow: 'AUTODOC Gutschein', headline: '30 Euro Gutschein bei AUTODOC.', intro: 'Für AUTODOC ist aktuell ein 30-Euro-Gutschein gelistet. Vor der Bestellung solltest du Code, Mindestbestellwert und mögliche Produkt- oder Kontobeschränkungen prüfen.', published: '2026-10-06', modified: '2026-10-06', imageAlt: 'FreeFinder App mit Online-Gutscheinen',
    offer: `<p>Der aktuelle Eintrag nennt <strong>30 Euro Gutschein für alles bei AUTODOC</strong>. Die tatsächliche Ermäßigung hängt von den Bedingungen des Gutscheins und dem Warenkorb ab.</p>`,
    how: `<ol><li>Die <a href="https://www.gutscheine.at/autodoc" rel="noopener">AUTODOC-Gutscheinübersicht</a> öffnen.</li><li>Gutscheincode und Bedingungen anzeigen lassen.</li><li>Passende Artikel in den AUTODOC-Warenkorb legen.</li><li>Code einlösen und prüfen, ob 30 Euro abgezogen werden.</li></ol>`,
    conditions: `<p>Prüfe Mindestbestellwert, Neukundenstatus, Marken- oder Produktgruppen, Gültigkeitsdauer und Versandkosten. Der Gutschein ist erst bestätigt, wenn der Rabatt im Checkout sichtbar ist.</p>`,
    source: `<p>Quelle ist die <a href="https://www.gutscheine.at/autodoc" rel="noopener">AUTODOC-Seite bei Gutscheine.at</a>.`,
    faqs: [['Wie hoch ist der AUTODOC-Gutschein?', '30 Euro laut aktuellem Eintrag.'], ['Gilt der Gutschein wirklich für alles?', 'Das muss anhand der konkreten Bedingungen im Checkout geprüft werden.'], ['Wann läuft er ab?', 'Im aktuellen Deal ist kein verlässliches Ablaufdatum angegeben.']], related: [['Gutscheine in Wien', 'gutscheine-wien.html'], ['Rabatte in Wien', 'rabatte-wien.html']],
  }),
  makeRecentDealGuide({
    slug: 'starbucks-5-euro-rabatt-kaffee5-wien', title: 'Starbucks Wien: 5 Euro Rabatt mit KAFFEE5', meta: 'Starbucks-Gutscheincode KAFFEE5: 5 Euro Rabatt bei einer Bestellung. Einlösung über Lieferando, Mindestbestellwert und Teilnahme prüfen.', eyebrow: 'Starbucks Gutschein Wien', headline: '5 Euro Rabatt bei Starbucks mit dem Code KAFFEE5.', intro: 'Der aktuelle FreeFinder-Eintrag nennt 5 Euro Rabatt mit dem Gutscheincode KAFFEE5 bei Starbucks Wien. Der Deal verweist auf eine Bestellung über Lieferando.', published: '2026-10-06', modified: '2026-10-06', imageAlt: 'FreeFinder App mit Kaffee-Gutscheinen in Wien',
    offer: `<p>Mit dem Code <strong>KAFFEE5</strong> sind laut aktuellem Eintrag <strong>5 Euro Rabatt bei Starbucks</strong> möglich. Die Einlösung erfolgt über die verlinkte Lieferando-Bestellseite.</p>`,
    how: `<ol><li>Die <a href="https://www.lieferando.at/speisekarte/starbucks-wien-rotenturmstrasse" rel="noopener">Starbucks-Bestellseite bei Lieferando</a> öffnen.</li><li>Artikel auswählen und den Warenkorb prüfen.</li><li><strong>KAFFEE5</strong> im Gutscheinfeld eingeben.</li><li>Kontrollieren, ob 5 Euro Rabatt abgezogen werden.</li></ol>`,
    conditions: `<p>Prüfe Mindestbestellwert, teilnehmende Filiale, Liefergebühren und mögliche Konto- oder Neukundenbedingungen. Kein Rabatt sollte angenommen werden, bevor er im Endbetrag sichtbar ist.</p>`,
    source: `<p>Quelle ist die verlinkte <a href="https://www.lieferando.at/speisekarte/starbucks-wien-rotenturmstrasse" rel="noopener">Starbucks-Bestellseite bei Lieferando</a>.`,
    faqs: [['Wie lautet der Starbucks-Code?', 'KAFFEE5.'], ['Wie viel Rabatt gibt es?', '5 Euro laut aktuellem Deal.'], ['Gilt der Code bei jeder Starbucks-Filiale?', 'Die Teilnahme und Lieferbedingungen müssen auf der Bestellseite geprüft werden.']], related: [['Gratis Kaffee in Wien', 'gratis-kaffee-wien.html'], ['Foodora Rabatt', 'foodora-60-prozent-rabatt-genuss-wien.html']],
  }),
  makeRecentDealGuide({
    slug: 'loving-hut-dog-1plus1-wien', title: 'Loving Hut Wien: 1+1 Loving Hut-dog', meta: 'Loving Hut Neubau in Wien: Einen Loving Hut-dog oder ein Menü bestellen und einen zweiten gratis erhalten. Gültig bis 31. Oktober 2026.', eyebrow: 'Veganes 1+1-Angebot Wien', headline: '1+1 Loving Hut-dog bei Loving Hut Neubau.', intro: 'Loving Hut Neubau bewirbt eine Herbst-Aktion: Einen Loving Hut-dog oder ein Loving Hut-dog-Menü bestellen und einen zweiten Loving Hut-dog gratis erhalten.', published: '2026-10-06', modified: '2026-10-06', expires: '2026-10-31T23:59:59+02:00', imageAlt: 'FreeFinder App mit veganen 1+1-Angeboten in Wien',
    offer: `<p>Bei Loving Hut Neubau gibt es laut Aktion <strong>1+1 Loving Hut-dog</strong>: Du bestellst einen Loving Hut-dog oder ein Loving Hut-dog-Menü und bekommst einen zweiten Loving Hut-dog gratis. Die Aktion ist bis <strong>31. Oktober 2026</strong> gelistet.</p>`,
    how: `<ol><li>Den <a href="https://www.tiktok.com/@lovinghut.neubau/video/7691608749642943796" rel="noopener">Originalbeitrag von Loving Hut Neubau</a> öffnen.</li><li>Loving Hut Neubau, Neubaugürtel 38/5, 1070 Wien besuchen.</li><li>Dem Account auf Instagram und TikTok folgen.</li><li>Einen Loving Hut-dog oder ein Menü bestellen.</li><li>Prüfen, ob der zweite Loving Hut-dog gratis auf dem Bon erscheint.</li></ol>`,
    conditions: `<p>Der Deal ist bis 31. Oktober 2026 angegeben. Folgepflicht, teilnehmende Produkte und Einlösung sollten vor Ort bestätigt werden.</p>`,
    source: `<p>Quelle ist der <a href="https://www.tiktok.com/@lovinghut.neubau/video/7691608749642943796" rel="noopener">TikTok-Beitrag von Loving Hut Neubau</a>.`,
    faqs: [['Was ist beim Loving Hut gratis?', 'Ein zweiter Loving Hut-dog nach Bestellung eines Loving Hut-dogs oder Menüs.'], ['Wo gilt die Aktion?', 'Neubaugürtel 38/5, 1070 Wien.'], ['Wie lange läuft sie?', 'Bis 31. Oktober 2026 laut Dealquelle.']], related: [['Gratis Essen in Wien', 'gratis-essen-wien.html'], ['1+1-Aktionen in Wien', 'eins-plus-eins-wien.html']],
  }),
  makeRecentDealGuide({
    slug: 'ganesha-10-euro-gutschein-50-euro-wien', title: 'Ganesha Restaurant Wien: 10 Euro Rabatt ab 50 Euro', meta: 'Ganesha Restaurant Gutschein: 10 Euro Rabatt ab 50 Euro Konsumation in Wien. Gutscheinbedingungen und Enddatum 31. Dezember 2026 prüfen.', eyebrow: 'Restaurant-Gutschein Wien', headline: '10 Euro Rabatt im Ganesha Restaurant ab 50 Euro.', intro: 'Für das Ganesha Restaurant ist ein 10-Euro-Gutschein ab 50 Euro Konsumation gelistet. Der Deal ist aktuell bis 31. Dezember 2026 angegeben.', published: '2026-10-06', modified: '2026-10-06', expires: '2026-12-31T23:59:59+01:00', imageAlt: 'FreeFinder App mit Restaurant-Gutscheinen in Wien',
    offer: `<p>Der Gutschein bietet <strong>10 Euro Rabatt ab 50 Euro Konsumation</strong>. Das entspricht rechnerisch 20 Prozent Ersparnis, wenn der Mindestbetrag genau erreicht wird.</p><p>Als Standort ist die Eschenbachgasse 4, 1010 Wien, gelistet.</p>`,
    how: `<ol><li>Die <a href="https://www.gutschein.at/ganesha-restaurant/10-euro-gutschein" rel="noopener">Gutscheinseite für Ganesha</a> öffnen.</li><li>Bedingungen und Gutschein anzeigen lassen.</li><li>Im Restaurant ab 50 Euro konsumieren.</li><li>Gutschein vor dem Bezahlen vorzeigen und den Abzug auf dem Bon kontrollieren.</li></ol>`,
    conditions: `<p>Der Gutschein ist bis <strong>31. Dezember 2026</strong> gelistet. Prüfe Ausschlüsse, Gültigkeit für Menüs oder Getränke, Kombinierbarkeit und die konkrete Annahme im Restaurant.</p>`,
    source: `<p>Quelle ist die <a href="https://www.gutschein.at/ganesha-restaurant/10-euro-gutschein" rel="noopener">Ganesha-Gutscheinseite bei Gutscheine.at</a>.`,
    faqs: [['Wie viel Rabatt gibt es bei Ganesha?', '10 Euro ab 50 Euro Konsumation.'], ['Wo ist das Restaurant?', 'Eschenbachgasse 4, 1010 Wien.'], ['Wie lange gilt der Gutschein?', 'Bis 31. Dezember 2026 laut aktuellem Eintrag.']], related: [['Restaurant-Gutscheine in Wien', 'restaurant-gutscheine-wien.html'], ['Gutscheine in Wien', 'gutscheine-wien.html']],
  }),
];

function quickDeal(guide) {
  const reviewed = dealGuides.find(item => item.slug === guide.slug);
  if (!reviewed) return '';
  return `<section class="article-note" data-guide-reviewed="${escapeHtml(reviewed.reviewedAt)}" aria-label="Deal auf einen Blick">
    <h2>Dein Deal auf einen Blick</h2>
    <dl>${[['Was', reviewed.what], ['Wo', reviewed.where], ['Wann', reviewed.when], ['So geht es', reviewed.how]].map(([key, value]) => `<dt><strong>${key}</strong></dt><dd>${escapeHtml(value)}</dd>`).join('')}</dl>
    <p><a href="${escapeHtml(reviewed.sourceUrl)}" rel="noopener" data-track="deal_outbound">Angebot und Bedingungen bei IKEA öffnen →</a></p>
    <p>Quelle geprüft: ${escapeHtml(reviewed.reviewedAt)}. Verfügbarkeit vor dem Besuch beim Anbieter prüfen.</p>
  </section>`;
}
const PUBLISHED = '2026-08-17';
const PUBLISHED_LABEL = '17. August 2026';

const guides = [...timelyGuides, ...recentDealGuides, ...[
  {
    slug: 'guenstig-essen-wien',
    title: 'Günstig essen in Wien: Angebote nach Bezirk',
    meta: 'Günstig essen in Wien: 10 Euro Ganesha-Gutschein in 1010, Kaffee um 2,50 Euro in 1080 und Geburtstagsbuffet in 1110. Adressen, Kosten und Bedingungen.',
    eyebrow: 'Essen & Trinken in Wien',
    headline: 'Günstig essen in Wien: Angebote im eigenen Bezirk.',
    intro: 'Ein Restaurant-Gutschein in der Inneren Stadt, günstiger Kaffee in der Josefstadt oder ein Geburtstagsbuffet in Simmering: Hier findest du konkrete Wiener Adressen, die Voraussetzungen zur Einlösung und mögliche Zusatzkosten.',
    published: '2026-10-07', publishedLabel: '7. Oktober 2026', modified: '2026-10-07', modifiedLabel: '7. Oktober 2026',
    image: '/assets/current-ios/deals-home.jpg', imageAvif: '/assets/current-ios/deals-home-400.avif 400w, /assets/current-ios/deals-home-736.avif 736w', imageWidth: 736, imageHeight: 414,
    imageAlt: 'Wiener Food-Angebote in der FreeFinder App',
    sections: [
      ['bezirke', 'Wiener Angebote nach Bezirk vergleichen', `<p>Die folgenden drei Angebote wurden am <strong>7. Oktober 2026</strong> auf der jeweiligen Anbieter- oder Gutscheinseite nachgelesen. Sie sind keine Liste aller günstigen Restaurants in Wien. Entscheidend sind dein Anlass, der Gesamtpreis und die Bedingungen vor Ort.</p><nav class="topic-nav" aria-label="Bezirke in diesem Guide"><a href="#1010">1010 Innere Stadt</a><a href="#1080">1080 Josefstadt</a><a href="#1110">1110 Simmering</a></nav><p>Suchst du stattdessen eine spontane Aktion für heute? Die <a href="/angebote-wien-heute.html">Angebote in Wien heute</a> enthalten Deals mit bekanntem, noch gültigem Enddatum. Für Aktionen ohne festes Enddatum bleibt die Originalquelle vor deinem Besuch wichtig.</p>`],
      ['1010', '1010 Wien: 10 Euro Restaurant-Gutschein bei Ganesha', `<p>Für indisches Essen in der <strong>Inneren Stadt</strong> führt Gutschein.at einen Ganesha-Gutschein: <strong>10 Euro Rabatt ab 50 Euro Konsumation</strong>. Das Restaurant liegt in der <strong>Eschenbachgasse 4, 1010 Wien</strong>. Bei genau 50 Euro sind das 20 Prozent Ersparnis; bei einem höheren Rechnungsbetrag bleiben es 10 Euro, nicht pauschal 20 Prozent.</p><p>Die <a href="https://www.gutschein.at/ganesha-restaurant/10-euro-gutschein" rel="noopener" data-track="deal_outbound">Gutscheinseite mit Bedingungen</a> nennt den <strong>31. Dezember 2026</strong> als Enddatum, Konsumation im Restaurant und höchstens einen Gutschein pro Bestellung und Person. Keine Barablöse. Kündige den Gutschein vor der Bestellung an und lass dir den mobilen Einlösevorgang vom Personal erklären: Die allgemeine Anleitung der Plattform erwähnt auch Lieferung, während die konkrete Bedingung das Restaurant nennt.</p><p>Mehr zur Einlösung findest du im <a href="ganesha-10-euro-gutschein-50-euro-wien.html">Ganesha-Gutschein-Guide</a>.</p>`],
      ['1080', '1080 Wien: Kaffee um 2,50 Euro im Café Hummel', `<p>Für einen günstigen Kaffee in der <strong>Josefstadt</strong> nennt das Café Hummel seine Early-Hummel-Aktion: <strong>Montag bis Freitag von 08:00 bis 09:00 Uhr kostet jeder Kaffee 2,50 Euro</strong>. Die Adresse lautet <strong>Josefstädter Straße 66, 1080 Wien</strong>.</p><p>Die <a href="https://cafehummel.at/" rel="noopener" data-track="deal_outbound">offizielle Café-Hummel-Seite</a> nennt kein festes Ende. Der Preis ist an das enge Zeitfenster gebunden; er gilt nicht als ganztägiger Kaffeepreis und ist kein kostenloses Frühstück. Prüfe die Aktion vor der Anfahrt erneut, besonders an Feiertagen.</p><p>Andere Aktionen, bei denen das Getränk tatsächlich kostenlos sein kann, findest du unter <a href="gratis-kaffee-wien.html">Gratis Kaffee in Wien</a>.</p>`],
      ['1110', '1110 Wien: Geburtstagsbuffet bei Watertuin', `<p>Wer am Geburtstag in <strong>Simmering</strong> essen gehen möchte, findet bei Watertuin einen bedingten Gratisvorteil. Das Lokal ist laut <a href="https://www.watertuin.at/kontakt" rel="noopener">offizieller Kontaktseite</a> in der <strong>Etrichstraße 23, 1110 Wien</strong>.</p><p>Die <a href="https://www.watertuin.at/aktionen" rel="noopener" data-track="deal_outbound">Geburtstagsaktion bei Watertuin</a> umfasst Essen und Trinken für das Geburtstagskind. Mindestens eine erwachsene Begleitperson muss den normalen Vollpreis zahlen; eine Reservierung ist verpflichtend. Fällt der Geburtstag auf einen Dienstag, nennt Watertuin als Ausnahme den folgenden Mittwoch oder Donnerstag. Die Aktion gilt bis auf Widerruf.</p><p>Für die Gruppe ist der Besuch deshalb nicht komplett kostenlos. Vergleiche den aktuellen Preis der Begleitung vor der Reservierung. Weitere Möglichkeiten für deinen Tag stehen unter <a href="geburtstag-gratis-wien.html">Geburtstag gratis in Wien: Essen und Eintritt</a>.</p>`],
      ['kosten', 'Gratis, Rabatt oder 1+1: Was lohnt sich für dich?', `<p>Ein günstiges Essen in Wien beginnt mit dem <strong>tatsächlichen Gesamtpreis</strong>. Ein Mindestumsatz-Gutschein spart nur, wenn du diesen Betrag ohnehin ausgeben möchtest. Für einen Kaffee reicht ein zeitlich begrenzter Fixpreis; ein Geburtstagsangebot setzt dagegen den richtigen Tag und oft Begleitung voraus.</p><ul><li><strong>Allein unterwegs:</strong> Prüfe, ob ein Vorteil eine zweite zahlende Person verlangt.</li><li><strong>Zu zweit essen:</strong> Vergleiche 1+1-Angebote mit dem regulären Einzelpreis und möglichen Menü-Ausnahmen.</li><li><strong>Mittagessen oder Frühstück:</strong> Achte auf die konkrete Uhrzeit; ein Morgenangebot gilt nicht automatisch mittags.</li><li><strong>Liefern lassen:</strong> Liefer- und Servicegebühren können einen Rabatt verkleinern. Prüfe den Endbetrag, nicht nur die Prozentangabe.</li></ul><p>Für weitere Food-Aktionen vergleiche <a href="gratis-essen-wien.html">Gratis Essen in Wien</a>, <a href="restaurant-gutscheine-wien.html">Restaurant-Gutscheine in Wien</a> und <a href="eins-plus-eins-wien.html">1+1-Angebote</a>. Veraltete Eröffnungspreise sind kein Beleg für einen heutigen Deal.</p>`],
    ],
    faqs: [
      ['Wo gibt es günstigen Kaffee in 1080 Wien?', 'Café Hummel nennt für die Josefstädter Straße 66 die Early-Hummel-Aktion: Montag bis Freitag von 08:00 bis 09:00 Uhr jeder Kaffee um 2,50 Euro. Kein festes Ende genannt; vor dem Besuch erneut prüfen.'],
      ['Welcher Restaurant-Gutschein gilt in 1010 Wien?', 'Gutschein.at führt für Ganesha in der Eschenbachgasse 4 einen Rabatt von 10 Euro ab 50 Euro Konsumation bis 31. Dezember 2026. Es gilt höchstens ein Gutschein pro Bestellung und Person; die konkrete Bedingung nennt Konsumation im Restaurant.'],
      ['Kann ich in Simmering am Geburtstag gratis essen?', 'Watertuin in der Etrichstraße 23 nennt Essen und Trinken für das Geburtstagskind gratis, wenn mindestens eine erwachsene Person den normalen Vollpreis zahlt. Reservierung ist Pflicht. Für Geburtstage am Dienstag gilt als Ausnahme der folgende Mittwoch oder Donnerstag.'],
      ['Sind diese Angebote für alle Wiener kostenlos?', 'Nein. Der Hummel-Kaffee kostet 2,50 Euro, Ganesha verlangt mindestens 50 Euro Konsumation und Watertuin eine vollzahlende erwachsene Begleitung. Vergleiche immer die Gesamtkosten.'],
    ],
    related: [['Angebote Wien heute', '/angebote-wien-heute.html'], ['Geburtstag gratis Wien', 'geburtstag-gratis-wien.html'], ['KinoDonnerstag Wien', 'kinodonnerstag-wien-drei.html'], ['Gratis Essen Wien', 'gratis-essen-wien.html']],
  },
  {
    slug: 'foodora-60-prozent-rabatt-genuss-wien',
    title: 'Foodora 60 Prozent Rabatt mit Gutscheincode GENUSS',
    meta: 'Foodora Rabatt in Wien: 60 Prozent mit dem Gutscheincode GENUSS sichern. So löst du den Foodora-Gutschein ein und prüfst Mindestbestellwert und Teilnahmebedingungen.',
    eyebrow: 'Foodora Gutschein Wien',
    headline: '60 Prozent Foodora-Rabatt mit dem Code GENUSS.',
    intro: 'Der Gutscheincode GENUSS gewährt laut aktuellem FreeFinder-Eintrag 60 Prozent Rabatt bei Foodora. Der Code wurde am 28. September 2026 erneut erfolgreich getestet und hat aktuell kein fest eingetragenes Ablaufdatum.',
    published: '2026-09-28', publishedLabel: '28. September 2026', modified: '2026-09-28', modifiedLabel: '28. September 2026',
    image: '/assets/current-ios/deals-home.jpg', imageAvif: '/assets/current-ios/deals-home-400.avif 400w, /assets/current-ios/deals-home-736.avif 736w', imageWidth: 736, imageHeight: 414,
    imageAlt: 'FreeFinder App mit Foodora-Rabatt und kostenlosen Angeboten in Wien',
    sections: [
      ['rabatt', 'Wie viel spart der Foodora-Code GENUSS?', `<p>Mit dem Gutscheincode <strong>GENUSS</strong> sind laut dem aktuellen Deal <strong>60 Prozent Rabatt</strong> bei Foodora möglich. Der Vorteil kann für Bestellungen bei teilnehmenden Restaurants und Shops angezeigt werden.</p><p>Der Code wurde am 28. September 2026 erneut erfolgreich verwendet. Da Foodora Gutscheine nach Konto, Liefergebiet, Warenkorb oder Kampagne ausspielen kann, sollte der Rabatt vor dem Absenden der Bestellung im Warenkorb sichtbar sein.</p>`],
      ['einloesen', 'Foodora-Gutscheincode GENUSS einlösen', `<ol><li>Foodora öffnen und ein Restaurant oder einen Shop auswählen.</li><li>Artikel in den Warenkorb legen und die Lieferadresse prüfen.</li><li>Im Bereich für Gutscheine oder Promo-Codes <strong>GENUSS</strong> eingeben.</li><li>Auf „Anwenden“ tippen und kontrollieren, ob 60 Prozent Rabatt abgezogen werden.</li><li>Erst danach bestellen und den Endbetrag inklusive Liefer- und Servicegebühren prüfen.</li></ol><div class="article-note"><strong>Wichtig</strong>Der Code ist nur erfolgreich eingelöst, wenn die Ermäßigung im Warenkorb tatsächlich angezeigt wird. Ein sichtbares Eingabefeld allein garantiert keinen Rabatt.</div>`],
      ['bedingungen', 'Welche Bedingungen solltest du prüfen?', `<p>Im aktuellen Eintrag ist <strong>kein festes Ablaufdatum</strong> hinterlegt. Trotzdem können Foodora-Kampagnen jederzeit geändert oder auf bestimmte Konten, Neukunden, Restaurants, Mindestbestellwerte oder Liefergebiete beschränkt werden.</p><ul><li>Gilt der Code für dein Konto?</li><li>Wird ein Mindestbestellwert verlangt?</li><li>Sind Liefer-, Service- oder Verpackungsgebühren vom Rabatt ausgenommen?</li><li>Gilt der Rabatt für alle Restaurants oder nur teilnehmende Anbieter?</li><li>Wird der Endpreis nach dem Einlösen wirklich um 60 Prozent reduziert?</li></ul>`],
      ['quelle', 'Aktualität des Foodora-Rabatts', `<p>Die FreeFinder-App führt den Deal mit dem Code <strong>GENUSS</strong> und verlinkt direkt zur <a href="https://www.foodora.at/campaigns?lat=48.20807&amp;lng=16.37122&amp;url_key=AT_food_HVA1_loggedout" rel="noopener">Foodora-Kampagnenübersicht</a>. Die erfolgreiche Verwendung am 28. September 2026 bestätigt, dass der Code aktuell funktioniert.</p><p>Da Foodora die Teilnahmebedingungen dynamisch pro Bestellung prüfen kann, solltest du den Rabatt auch bei jeder späteren Bestellung direkt im Warenkorb kontrollieren.</p>`],
    ],
    faqs: [
      ['Wie lautet der Foodora-Gutscheincode?', 'Der aktuelle Code lautet GENUSS.'],
      ['Wie viel Rabatt gibt es mit GENUSS?', 'Laut aktuellem Deal 60 Prozent Rabatt. Kontrolliere die tatsächliche Ermäßigung im Warenkorb.'],
      ['Hat der Foodora-Code ein Ablaufdatum?', 'Aktuell ist kein festes Ablaufdatum eingetragen. Foodora kann den Code trotzdem jederzeit ändern oder einschränken.'],
      ['Gilt der Code für jede Bestellung?', 'Nicht garantiert. Konto, Restaurant, Liefergebiet, Mindestbestellwert und Gebühren können die Einlösung beeinflussen.'],
    ],
    related: [['App-Gutscheine in Wien', 'app-gutscheine-wien.html'], ['Rabatte in Wien', 'rabatte-wien.html'], ['Gratis Essen in Wien', 'gratis-essen-wien.html'], ['Aktuelle Wien-Deals', '/angebote-wien-heute.html']],
  },
  {
    slug: 'interpolburger-2-euro-wien',
    title: '2-Euro-Burger mit Pommes bei Interpolburger Wien',
    meta: 'Interpolburger Wien: Burger mit Pommes für 2 Euro am 25. September 2026 ab 15 Uhr am Südtiroler Platz. Nur solange der Vorrat reicht.',
    eyebrow: '2-Euro-Burger Wien',
    headline: 'Burger mit Pommes für 2 Euro bei Interpolburger.',
    intro: 'Interpolburger Wien kündigt am 25. September 2026 ab 15 Uhr Burger mit Pommes für 2 Euro an. Die Aktion findet am Südtiroler Platz 1 statt und gilt nur, solange der Vorrat reicht.',
    published: '2026-09-25', publishedLabel: '25. September 2026', modified: '2026-10-05', modifiedLabel: '5. Oktober 2026',
    expires: '2026-09-25T23:59:59+02:00',
    image: '/assets/current-ios/deals-home.jpg', imageAvif: '/assets/current-ios/deals-home-400.avif 400w, /assets/current-ios/deals-home-736.avif 736w', imageWidth: 736, imageHeight: 414,
    imageAlt: 'FreeFinder App mit Burger- und Food-Angeboten in Wien',
    sections: [
      ['angebot', 'Was gibt es für 2 Euro?', `<p>Bei Interpolburger Wien gibt es laut dem veröffentlichten Angebot einen <strong>Burger mit Pommes für 2 Euro</strong>. Die Aktion startet am <strong>25. September 2026 ab 15:00 Uhr</strong>.</p><p>Das Angebot ist eine begrenzte Tagesaktion. Es gilt nur, solange der Vorrat reicht, und kann deshalb vor dem Ende des Tages ausverkauft sein.</p>`],
      ['ort', 'Adresse und Einlösung', `<p>Die Aktion ist am <strong>Südtiroler Platz 1, 1040 Wien</strong> angekündigt. Komm ab 15:00 Uhr vorbei und frage vor der Bestellung nach dem Aktionsangebot.</p><ol><li>Originalbeitrag vor dem Weg öffnen.</li><li>Zum Südtiroler Platz 1, 1040 Wien gehen.</li><li>Burger mit Pommes als Aktionsangebot bestellen.</li><li>Vor dem Bezahlen prüfen, ob der Preis von 2 Euro korrekt angezeigt wird.</li></ol>`],
      ['bedingungen', 'Wichtige Bedingungen', `<div class="article-note"><strong>Begrenzter Vorrat</strong>Die Quelle nennt keinen garantierten Bestand und kein fixes Ende innerhalb des Abends. Wenn der Vorrat aufgebraucht ist, kann die Aktion vorzeitig enden.</div><p>Prüfe deshalb den <a href="https://www.instagram.com/reel/DdoBViXIKVI/" rel="noopener">Originalbeitrag</a> unmittelbar vor der Anreise. FreeFinder übernimmt die Angaben aus der bestätigten Dealquelle, ersetzt aber keine Auskunft des Lokals.</p>`],
      ['quelle', 'Quelle und Aktualität', `<p>Die Angaben stammen aus dem <a href="https://www.instagram.com/reel/DdoBViXIKVI/" rel="noopener">Instagram-Originalbeitrag zum Interpolburger-Angebot</a>. Dort werden Preis, Startzeit, Adresse und der Hinweis „solange der Vorrat reicht“ genannt.</p><p>Weitere aktuelle Burger- und Food-Angebote findest du in der <a href="/angebote-wien-heute.html">FreeFinder-Übersicht</a>.</p>`],
    ],
    faqs: [
      ['Wie viel kostet Burger mit Pommes?', 'Laut Dealquelle 2 Euro am 25. September 2026.'],
      ['Wann startet die Aktion?', 'Am 25. September 2026 ab 15:00 Uhr.'],
      ['Wo findet die Aktion statt?', 'Südtiroler Platz 1, 1040 Wien.'],
      ['Wie lange gilt das Angebot?', 'Nur solange der Vorrat reicht. Es kann daher vorzeitig enden.'],
    ],
    related: [['Duru Kebab in Wien', 'duru-kebab-wien-wolt-rabatt.html'], ['Gratis Essen in Wien', 'gratis-essen-wien.html'], ['Aktuelle Wien-Deals', '/angebote-wien-heute.html']],
  },
  {
    slug: 'duru-doener-350-wien-2026',
    title: 'Duru Döner für 3,50 Euro in Wien',
    meta: 'Duru Döner in Wien: Hühnerdöner für 3,50 Euro am 23. September 2026 in der Filiale Thaliastraße 23. Uhrzeit, Bedingungen und Originalquelle prüfen.',
    eyebrow: 'Döner-Aktion Wien',
    headline: 'Duru Döner für 3,50 Euro in der Thaliastraße.',
    intro: 'Duru bewirbt zum 15-jährigen Bestehen am 23. September 2026 einen Hühnerdöner für 3,50 Euro in der Filiale Thaliastraße 23. Die Aktion gilt laut Originalbeitrag von 09:00 bis 18:00 Uhr.',
    published: '2026-09-23', publishedLabel: '23. September 2026', modified: '2026-10-05', modifiedLabel: '5. Oktober 2026',
    expires: '2026-09-23T18:00:00+02:00',
    image: '/assets/current-ios/deals-home.jpg', imageAvif: '/assets/current-ios/deals-home-400.avif 400w, /assets/current-ios/deals-home-736.avif 736w', imageWidth: 736, imageHeight: 414,
    imageAlt: 'FreeFinder App mit Döner- und Kebab-Angeboten in Wien',
    sections: [
      ['angebot', 'Was kostet der Duru-Döner?', `<p>Der Originalbeitrag von Duru nennt für den <strong>23. September 2026</strong> einen Hühnerdöner für <strong>3,50 Euro</strong>. Zusätzlich werden Kalbdöner für 4,50 Euro und Adana Kebab für 8 Euro genannt.</p><p>Die Aktion ist laut Beitrag auf einen Döner pro Person begrenzt und gilt ausschließlich in der Filiale Thaliastraße 23.</p>`],
      ['einloesen', 'So prüfst du die Aktion', `<ol><li>Vor dem Besuch den <a href="https://www.instagram.com/reel/DdhLB_mtmGy/" rel="noopener">Originalbeitrag von Duru</a> öffnen.</li><li>Am 23. September zwischen 09:00 und 18:00 Uhr zur Thaliastraße 23, 1160 Wien gehen.</li><li>Den gewünschten Aktions-Döner bestellen.</li><li>Beachten, dass pro Person nur ein Döner zum Aktionspreis gilt.</li><li>Vor dem Bezahlen prüfen, ob der richtige Aktionspreis aufscheint.</li></ol><div class="article-note"><strong>Nur am Aktionstag</strong>Die Angaben gelten laut Originalbeitrag für den 23. September 2026 und können nach Ende der Aktion nicht mehr eingelöst werden.</div>`],
      ['quelle', 'Originalquelle und Bedingungen', `<p>Quelle ist der <a href="https://www.instagram.com/reel/DdhLB_mtmGy/" rel="noopener">Originalbeitrag von Duru</a>. Dort stehen Filiale, Uhrzeit, Preise und die Begrenzung auf einen Döner pro Person. Prüfe die Angaben vor der Anreise erneut.</p><p>Weitere aktuelle Kebab-Angebote findest du in der <a href="/angebote-wien-heute.html">FreeFinder-Übersicht</a>.</p>`],
    ],
    faqs: [
      ['Wie viel kostet der Hühnerdöner?', 'Laut Originalbeitrag 3,50 Euro am 23. September 2026.'],
      ['Wo gilt die Aktion?', 'In der Duru-Filiale Thaliastraße 23, 1160 Wien.'],
      ['Wie lange gilt sie?', 'Der Beitrag nennt 09:00 bis 18:00 Uhr am 23. September 2026 und einen Döner pro Person.'],
    ],
    related: [['Gratis Essen in Wien', 'gratis-essen-wien.html'], ['Kebab-Angebote in Wien', 'duru-kebab-wien-wolt-rabatt.html'], ['Aktuelle Wien-Deals', '/angebote-wien-heute.html']],
  },
  {
    slug: 'gratis-gemuese-kebab-h11-wien',
    title: 'Gratis Gemüse-Kebab bei H11 in Wien',
    meta: 'Gratis Gemüse-Kebab in Wien bei H11: Berliner-Style Gemüse-Kebab am 23. September 2026 ab 12 Uhr, solange der Vorrat reicht. Quelle und Hinweise zur Einlösung.',
    eyebrow: 'Gratis Kebab Wien',
    headline: 'Gratis Berliner-Style Gemüse-Kebab bei H11.',
    intro: 'H11 Döner & Pizza bewirbt für den 23. September 2026 einen Berliner-Style Gemüse-Kebab gratis ab 12 Uhr. Die Aktion gilt nur, solange der Vorrat reicht.',
    published: '2026-09-23', publishedLabel: '23. September 2026', modified: '2026-10-05', modifiedLabel: '5. Oktober 2026',
    expires: '2026-09-23T23:59:59+02:00',
    image: '/assets/current-ios/deals-home.jpg', imageAvif: '/assets/current-ios/deals-home-400.avif 400w, /assets/current-ios/deals-home-736.avif 736w', imageWidth: 736, imageHeight: 414,
    imageAlt: 'FreeFinder App mit gratis Kebab- und Food-Angeboten in Wien',
    sections: [
      ['angebot', 'Was ist bei H11 gratis?', `<p>H11 Döner & Pizza kündigt einen <strong>Berliner-Style Gemüse-Kebab gratis</strong> an. Laut dem veröffentlichten Angebot startet die Aktion am <strong>23. September 2026 ab 12:00 Uhr</strong>.</p><p>Es handelt sich um eine Ausgabeaktion für Gemüse-Kebab und nicht um einen dauerhaft kostenlosen Menüpunkt. Der Vorrat ist begrenzt.</p>`],
      ['einloesen', 'So prüfst du die Aktion vor Ort', `<ol><li>Vor dem Besuch die Originalquelle öffnen und prüfen, ob die Aktion noch aktiv ist.</li><li>H11 am 23. September ab 12:00 Uhr aufsuchen.</li><li>Nach dem Berliner-Style Gemüse-Kebab fragen.</li><li>Beachten, dass die Ausgabe endet, sobald der Vorrat aufgebraucht ist.</li></ol><div class="article-note"><strong>Wichtig</strong>Bei Aktionen mit begrenztem Vorrat kann die Ausgabe vor dem genannten Tagesende enden.</div>`],
      ['quelle', 'Originalquelle und Aktualität', `<p>Die Angaben stammen aus dem <a href="https://www.instagram.com/reel/DdlWabRNluS/" rel="noopener">Originalbeitrag von H11 Döner &amp; Pizza</a>. Prüfe dort vor der Anreise Ort, Startzeit und Verfügbarkeit erneut.</p><p>Weitere aktuelle Kebab- und Food-Angebote findest du unter <a href="/angebote-wien-heute.html">Aktuelle Wien-Deals</a>.</p>`],
    ],
    faqs: [
      ['Wann gibt es den gratis Gemüse-Kebab?', 'Laut dem H11-Angebot am 23. September 2026 ab 12:00 Uhr.'],
      ['Ist der Kebab den ganzen Tag verfügbar?', 'Nein. Die Aktion gilt nur, solange der Vorrat reicht.'],
      ['Muss ich etwas kaufen?', 'Das veröffentlichte Angebot nennt eine Gratis-Ausgabe. Prüfe die konkreten Bedingungen vor Ort erneut.'],
    ],
    related: [['Gratis Essen in Wien', 'gratis-essen-wien.html'], ['Restaurant-Gutscheine in Wien', 'restaurant-gutscheine-wien.html'], ['Aktuelle Wien-Deals', '/angebote-wien-heute.html']],
  },
  {
    slug: 'dahab-doener-1plus1-wien',
    title: '1+1 Döner bei Dahab in Wien',
    meta: '1+1 Döner bei Dahab Döner in Wien: Beim Kauf von zwei Dönern gibt es einen weiteren gratis. Wagramer Straße 126, Bedingungen und Zeitraum prüfen.',
    eyebrow: '1+1 Döner Wien',
    headline: '1+1 Döner bei Dahab Döner in Wien.',
    intro: 'Dahab Döner verlängert laut Originalbeitrag eine 1+1-Aktion: Beim Kauf von zwei Dönern gibt es einen dritten Döner gratis. Die Aktion ist bis 25. September 2026 angekündigt.',
    published: '2026-09-23', publishedLabel: '23. September 2026', modified: '2026-10-05', modifiedLabel: '5. Oktober 2026',
    expires: '2026-09-25T23:59:59+02:00',
    image: '/assets/current-ios/deals-home.jpg', imageAvif: '/assets/current-ios/deals-home-400.avif 400w, /assets/current-ios/deals-home-736.avif 736w', imageWidth: 736, imageHeight: 414,
    imageAlt: 'FreeFinder App mit 1+1-Döner-Angeboten in Wien',
    sections: [
      ['angebot', 'So funktioniert die Dahab-Aktion', `<p>Beim <strong>1+1-Angebot von Dahab Döner</strong> kaufst du zwei Döner und erhältst einen weiteren Döner gratis. Der Originalbeitrag nennt den Zeitraum <strong>Montag, 21. September bis Freitag, 25. September 2026</strong>.</p><p>Das Angebot gilt laut Beitrag bei Dahab Döner in der <strong>Wagramer Straße 126, 1220 Wien</strong>. Prüfe vor der Bestellung, welche Dönerarten eingeschlossen sind.</p>`],
      ['einloesen', 'Vor Ort richtig einlösen', `<ol><li>Vor dem Besuch den <a href="https://www.instagram.com/reel/Ddhgq4YO5av/" rel="noopener">Originalbeitrag von Dahab Döner</a> öffnen.</li><li>Zur Filiale in der Wagramer Straße 126, 1220 Wien gehen.</li><li>Zwei Döner bestellen und die 1+1-Aktion angeben.</li><li>Vor dem Bezahlen kontrollieren, dass der dritte Döner korrekt gratis berücksichtigt wird.</li></ol><div class="article-note"><strong>Gültigkeit prüfen</strong>Der Beitrag nennt den Zeitraum bis 25. September 2026. Öffnungszeiten und Verfügbarkeit können sich ändern.</div>`],
      ['quelle', 'Originalquelle und Bedingungen', `<p>Quelle ist der <a href="https://www.instagram.com/reel/Ddhgq4YO5av/" rel="noopener">Originalbeitrag von Dahab Döner</a>. Da Social-Media-Aktionen kurzfristig geändert oder vorzeitig beendet werden können, solltest du den Beitrag und die Bedingungen am selben Tag erneut prüfen.</p><p>Weitere Kebab- und Food-Angebote findest du in der <a href="/angebote-wien-heute.html">aktuellen Wien-Deals-Übersicht</a>.</p>`],
    ],
    faqs: [
      ['Wie viele Döner bekomme ich?', 'Laut dem Angebot gibt es beim Kauf von zwei Dönern einen dritten gratis.'],
      ['Wo gilt die Aktion?', 'Der Beitrag nennt Dahab Döner, Wagramer Straße 126, 1220 Wien.'],
      ['Wie lange gilt die Aktion?', 'Angekündigt ist sie vom 21. bis 25. September 2026. Prüfe die aktuelle Verfügbarkeit vor Ort.'],
    ],
    related: [['Gratis Essen in Wien', 'gratis-essen-wien.html'], ['1+1-Aktionen in Wien', 'eins-plus-eins-wien.html'], ['Aktuelle Wien-Deals', '/angebote-wien-heute.html']],
  },
  {
    slug: 'gratis-kaffee-wien',
    title: 'Gratis Kaffee in Wien heute finden',
    meta: 'Gratis Kaffee in Wien heute finden: Aktionen, Kostproben und App-Gutscheine an Quelle, Filiale und Kontingent richtig prüfen.',
    eyebrow: 'Gratis Kaffee Wien',
    headline: 'Gratis Kaffee in Wien heute finden, prüfen und rechtzeitig einlösen.',
    intro: 'Kostenlose Kaffee-Aktionen sind oft kurz, an einzelne Filialen gebunden oder nur mit App beziehungsweise Kundenkarte gültig. Dieser Tagescheck trennt belastbare Angebote von alten Werbeposts.',
    modified: '2026-09-20', modifiedLabel: '20. September 2026',
    image: '/assets/blog/omv-viva-eiskaffee-gratis.jpg',
    imageAvif: '/assets/blog/omv-viva-eiskaffee-gratis-800.avif 800w, /assets/blog/omv-viva-eiskaffee-gratis-1600.avif 1600w',
    imageWidth: 1600,
    imageHeight: 900,
    imageAlt: 'Drei unterschiedliche kalte Kaffeegetränke als Beispiel für Gratis-Kaffee-Aktionen',
    sections: [
      ['arten', 'Welche Gratis-Kaffee-Aktionen gibt es?', `<p>Bei <strong>Gratis Kaffee in Wien</strong> begegnen dir vor allem Verkostungen, Neueröffnungen, digitale Gutscheine und Treueaktionen. Manche Angebote geben ein vollständiges Getränk aus, andere nur eine kleine Kostprobe. Entscheidend ist, ob wirklich kein Kauf erforderlich ist.</p><ul><li><strong>Verkostung:</strong> Eine neue Sorte wird in einem begrenzten Zeitraum gratis ausgegeben.</li><li><strong>App-Gutschein:</strong> Ein Coupon wird nach Registrierung oder in einer Kunden-App sichtbar.</li><li><strong>Eröffnungsaktion:</strong> Ein Café bewirbt einen neuen Standort mit Gratisgetränken.</li><li><strong>Treuevorteil:</strong> Das Getränk ist gratis, kann aber eine Mitgliedschaft oder gesammelte Punkte voraussetzen.</li></ul>`],
      ['bedingungen', 'Diese Bedingungen solltest du zuerst lesen', `<p>Prüfe Getränk, Größe, Zeitraum und teilnehmende Filiale. Formulierungen wie „solange der Vorrat reicht“, „einmal pro Person“ oder „nur für Neukunden“ verändern den tatsächlichen Nutzen erheblich. Achte außerdem darauf, ob ein QR-Code, eine aktivierte Kundenkarte oder ein Mindestumsatz nötig ist.</p><p>Ein Screenshot ohne sichtbares Datum ist keine zuverlässige Quelle. Öffne deshalb immer den Originalpost oder die Anbieterseite und kontrolliere die Angaben kurz vor dem Weg zur Filiale erneut.</p>`],
      ['planung', 'So vermeidest du unnötige Wege', `<p>Speichere zuerst die genaue Adresse und prüfe die Öffnungszeiten der betreffenden Filiale. Bei stark beworbenen Aktionen lohnt sich ein Besuch eher früh am Tag. Plane keine längere Fahrt nur wegen eines Gratisgetränks, wenn der Anbieter keine Bestands- oder Verfügbarkeitszusage macht.</p><p>Die Seite <a href="/angebote-wien-heute.html">Aktuelle Angebote in Wien heute</a> zeigt nur ausgewählte Deals mit einem erfassten, noch nicht erreichten Enddatum. Für weitere Hinweise kannst du FreeFinder auf iPhone oder Android öffnen.</p>`],
      ['heute', 'Gratis Kaffee heute: Filiale und Vorrat vor der Anfahrt prüfen', `<p>Bei kurzfristigen Kaffeeaktionen kontrollierst du am selben Tag die Originalquelle, die Öffnungszeit der gewünschten Filiale und mögliche Ausgabefenster. „Solange der Vorrat reicht“ ist keine Verfügbarkeitszusage. Plane deshalb keine lange Anfahrt, wenn der Anbieter weder Bestand noch eine feste Menge nennt.</p><p>Ist ein Coupon an eine Kundenkarte oder App gebunden, öffne ihn erst an der Kassa und kontrolliere danach den Bon. Ein sichtbarer Vorteil kann für Neukunden, eine bestimmte Größe oder einen einzelnen Standort gelten. Erst der auf null gesetzte Preis bestätigt die Einlösung.</p>`],
      ['checkliste', '30-Sekunden-Check vor der Einlösung', `<ol><li>Ist der Beitrag direkt vom Anbieter oder einer nachvollziehbaren Quelle?</li><li>Liegt das Enddatum noch in der Zukunft?</li><li>Gilt die Aktion in deiner Wiener Filiale?</li><li>Brauchst du App, Kundenkarte, Gutschein oder einen zusätzlichen Kauf?</li><li>Ist die Aktion garantiert oder nur verfügbar, solange der Vorrat reicht?</li></ol>`],
    ],
    faqs: [
      ['Wo finde ich aktuell Gratis Kaffee in Wien?', 'Prüfe die aktuelle FreeFinder-Dealübersicht sowie offizielle Posts und Apps von Wiener Cafés, Bäckereien, Tankstellen-Shops und Handelsketten. Entscheidend sind ein aktuelles Datum und eine konkrete Filiale.'],
      ['Ist ein Kaffee mit Kundenkarte wirklich gratis?', 'Ja, wenn für den einzelnen Kaffee kein Kaufpreis und kein verpflichtender Zusatzkauf anfällt. Die Registrierung oder Kundenkarte bleibt trotzdem eine Teilnahmebedingung.'],
      ['Wie prüfe ich Gratis Kaffee in Wien für heute?', 'Öffne die Originalquelle und kontrolliere Filiale, Uhrzeit, Getränkgröße, Coupon und Vorratshinweis. Zeige einen dynamischen Code erst an der Kassa und prüfe den Preis auf dem Bon.'],
      ['Warum sind Gratis-Kaffee-Aktionen oft so schnell vorbei?', 'Viele Aktionen sind als Verkostung oder Einführung geplant und haben ein begrenztes Kontingent. Deshalb sollte die Verfügbarkeit unmittelbar vor der Einlösung geprüft werden.'],
    ],
    related: [['Gratis Essen in Wien', 'gratis-essen-wien.html'], ['Produktproben in Wien', 'produktproben-wien.html'], ['App-Gutscheine in Wien', 'app-gutscheine-wien.html'], ['Aktuelle Wien-Deals', '/angebote-wien-heute.html']],
  },
  {
    slug: 'geburtstag-gratis-wien',
    title: 'Geburtstag gratis Wien: Essen, Eintritt & Kinderkino',
    meta: '5 Geburtstagsvorteile in Wien: Buffet, Eintritt, Starbucks Gold und Cineplexx-Kinderkino. Bedingungen, Altersgrenzen, Begleitung und Zusatzkosten vergleichen.',
    eyebrow: 'Geburtstag gratis Wien',
    headline: 'Geburtstag gratis in Wien: Essen, Eintritt und Kinderkino',
    intro: 'Watertuin, Donauturm und Madame Tussauds bieten Essen oder Eintritt; Starbucks ergänzt ein Gold-Getränk. Neu: Cineplexx-Kinderkino mit mindestens vier zahlenden Freunden. Alle fünf wurden am 8. Oktober 2026 beim Anbieter geprüft. Vergleiche Zeitfenster, Altersregeln und Gesamtkosten.',
    modified: '2026-10-08', modifiedLabel: '8. Oktober 2026',
    image: '/og-preview-stores.png', imageAvif: '/og-preview-stores-600.avif 600w, /og-preview-stores-1200.avif 1200w', imageWidth: 1200, imageHeight: 630,
    imageAlt: 'FreeFinder App für iPhone und Android mit Wiener Angeboten',
    sections: [
      ['adressen', 'Geburtstag gratis in Wien: Adressen und Bedingungen auf einen Blick', `<div class="table-scroll" role="region" aria-label="Drei Wiener Geburtstagsangebote im Vergleich" tabindex="0"><table><thead><tr><th scope="col">Angebot</th><th scope="col">Adresse und Bezirk</th><th scope="col">Zeitfenster und Kosten</th></tr></thead><tbody><tr><th scope="row"><a href="https://www.watertuin.at/aktionen" rel="noopener">Watertuin: Essen &amp; Trinken</a></th><td>Etrichstraße 23<br>1110 Wien, Simmering</td><td>Am Geburtstag; Dienstag-Geburtstage am folgenden Mittwoch oder Donnerstag. Reservierung Pflicht; mindestens eine erwachsene Begleitung zahlt Vollpreis.</td></tr><tr><th scope="row"><a href="https://www.donauturm.at/public/de/events-news-and-kulinarik/events/geburtstag-am-donauturm-wien/" rel="noopener">Donauturm: Eintritt &amp; eine Rutschenfahrt</a></th><td>Donauturmplatz 1<br>1220 Wien, Donaustadt</td><td>Geburtstag plus/minus zwei Tage. Lichtbildausweis am Front Desk; vor Ticketkauf beanspruchen, keine nachträgliche Erstattung. Begleitung und Gastronomie kosten extra.</td></tr><tr><th scope="row"><a href="https://www.madametussauds.com/wien/plane-deinen-besuch/vor-deinem-besuch/informationen-zum-besuch/" rel="noopener">Madame Tussauds: Eintritt</a></th><td>Riesenradplatz 5–6<br>1020 Wien, Leopoldstadt</td><td>Genau am Geburtstag gegen amtlichen Lichtbildausweis, für jedes Alter. Kostenlose Begleittickets sind nicht zugesagt.</td></tr></tbody></table></div><p>Adressen: <a href="https://www.watertuin.at/kontakt" rel="noopener">Watertuin Kontakt</a>, <a href="https://www.donauturm.at/public/de/events-news-and-kulinarik/events/geburtstag-am-donauturm-wien/" rel="noopener">Donauturm</a> und <a href="https://www.madametussauds.com/wien/plane-deinen-besuch/vor-deinem-besuch/anreise/" rel="noopener">Madame Tussauds Anreise</a>. Die drei Kernangebote wurden am 8. Oktober 2026 nachgelesen; kein festes Enddatum bedeutet keine dauerhafte Garantie.</p><p>Kein Geburtstag in Sicht? Im Guide <a href="guenstig-essen-wien.html">günstig essen in Wien nach Bezirk</a> findest du auch Angebote ohne Geburtstagsvoraussetzung.</p>`],
      ['aktuell', 'Essen und Eintritt: drei Vorteile ohne Mitgliedschaft', `<p>Diese Beispiele wurden am 8. Oktober 2026 auf den offiziellen Anbieterseiten geprüft. Diese drei Angebote haben dort kein kalendarisches Enddatum; sie sind deshalb als <strong>laufend</strong> und nicht als dauerhaft garantiert eingeordnet. Kontrolliere die Quelle trotzdem direkt vor deinem Besuch.</p><h3>Geburtstag gratis essen in Wien: Watertuin</h3><p><a href="https://www.watertuin.at/aktionen" rel="noopener">Watertuin Wien</a> schreibt, dass das Geburtstagskind am Geburtstag gratis essen und trinken kann. Dafür muss mindestens eine erwachsene Person den normalen Vollpreis zahlen, eine Reservierung ist verpflichtend. Fällt der Geburtstag auf einen Dienstag, nennt der Anbieter als Ausnahme den folgenden Mittwoch oder Donnerstag. Die Aktion ist laut Quelle „gültig bis auf Widerruf“ – sie hat also kein festes Ablaufdatum.</p><h3>Geburtstagskind gratis Eintritt: Donauturm</h3><p>Beim <a href="https://www.donauturm.at/public/de/events-news-and-kulinarik/events/geburtstag-am-donauturm-wien/" rel="noopener">Donauturm Wien</a> erhalten Geburtstagskinder laut offizieller Angebotsseite freien Eintritt und eine kostenlose Rutschenfahrt. Das Zeitfenster reicht bis zu zwei Tage vor oder nach dem Geburtstag. Die Einlösung erfolgt am Front Desk mit gültigem Lichtbildausweis; Begleitpersonen zahlen den regulären Eintritt und gegebenenfalls die Rutsche.</p><p>Für den Gratis-Eintritt nennt die Angebotsseite den Front Desk. Wenn ihr den Besuch mit Turm Café oder Turm Restaurant verbinden möchtet, empfiehlt der Donauturm eine <strong>Tischreservierung</strong>; sie ist ein separater Planungsschritt für die Gastronomie.</p><div class="article-note"><strong>Wichtig</strong>„Gratis“ gilt hier jeweils nur für das Geburtstagskind und nur unter den genannten Voraussetzungen. Beim Donauturm sind Speisen, Getränke und ein Tischgedeck nicht umfasst; das bestätigt auch die <a href="https://www.donauturm.at/de/gastronomie-and-shop/turm-restaurant/" rel="noopener">offizielle Restaurant-FAQ</a>. Restaurantbesuch, Begleitpersonen und weitere Leistungen sind nicht automatisch kostenlos.</div>`],
      ['madame-tussauds', 'Madame Tussauds Wien: gratis Eintritt genau am Geburtstag', `<p>Die <a href="https://www.madametussauds.com/wien/plane-deinen-besuch/vor-deinem-besuch/informationen-zum-besuch/" rel="noopener">offiziellen Besucherinformationen</a> bestätigen freien Eintritt <strong>für Geburtstagskinder jeden Alters am Geburtstag</strong>. Dafür musst du einen <strong>amtlichen Lichtbildausweis</strong> vorzeigen. Anders als beim Donauturm nennt Madame Tussauds keine Tage davor oder danach.</p><p>Der Standort liegt laut <a href="https://www.madametussauds.com/wien/plane-deinen-besuch/vor-deinem-besuch/anreise/" rel="noopener">offizieller Anreise</a> am <strong>Riesenradplatz 5–6, 1020 Wien</strong> im Prater. Über Praterstern erreichst du ihn mit U1 oder U2. Prüfe vor der Anfahrt die aktuellen Öffnungszeiten und lege den Ausweis für die Einlösung bereit. Ein festes Enddatum ist nicht genannt; der Vorteil ist laufend.</p><div class="article-note"><strong>Eintritt und Feier getrennt planen</strong>Der Vorteil umfasst den Eintritt des Geburtstagskindes. Kostenlose Begleittickets oder Zusatzleistungen werden in dieser Zusage nicht genannt. Organisierte <a href="https://www.madametussauds.com/wien/plane-deinen-besuch/weitere-informationen/kindergeburtstag/" rel="noopener">Kindergeburtstagsfeiern</a> bietet Madame Tussauds laut eigener Seite derzeit nicht an.</div>`],
      ['starbucks', 'Starbucks: Geburtstagsgetränk für Gold-Mitglieder', `<p>Die <a href="https://www.starbucks.at/de/rewards" rel="noopener">österreichische Rewards-Seite</a> führt das Geburtstagsgetränk als Vorteil für <strong>Gold-Mitglieder</strong>. Laut <a href="https://www.starbucks.at/de/faq-rewards" rel="noopener">offizieller FAQ</a> erfordert Gold 1.500 Sterne; eine Anmeldung allein genügt dafür nicht. Wenn du bereits Gold-Mitglied bist, prüfe vor dem Besuch deinen Status und den verfügbaren Reward.</p><p>Die <a href="https://www.starbucks.at/de/rewards/rewards-terms-and-conditions" rel="noopener">Nutzungsbedingungen</a> nennen ein handgemachtes Getränk pro Jahr. Hinterlege Tag und Monat des Geburtstags im Konto: Der Reward wird am Geburtstag gutgeschrieben und gilt ab Ausstellung <strong>30 Tage</strong>. Zur Einlösung brauchst du den Mitglieder-QR-Code in der App oder deine registrierte Starbucks Card.</p><ol><li>Kontostatus, gespeicherten Geburtstag und Reward prüfen.</li><li>Eine teilnehmende Filiale wählen; die FAQ schließt die Stores am Flughafen Wien und im Parndorf Fashion Outlet Center aus.</li><li>Den Geburtstags-Reward vor der Bestellung angeben und App oder Card vorzeigen.</li></ol><p>Am 8. Oktober 2026 geprüft: Das Programm nennt kein festes Enddatum. Die 30 Tage betreffen deinen einzelnen Reward. Weitere Einlösetipps findest du unter <a href="app-gutscheine-wien.html">App-Gutscheine in Wien</a> und <a href="gratis-kaffee-wien.html">Gratis Kaffee in Wien</a>.</p>`],
      ['cineplexx', 'Cineplexx: gratis Kinoticket beim Kindergeburtstag mit vier Freunden', `<p>Die offizielle <a href="https://cineplexx.at/info/family-film-club" rel="noopener" data-track="deal_outbound">Family-Film-Club-Seite von Cineplexx Österreich</a> nennt beim Kindergeburtstag ein <strong>kostenloses Kinoticket für das Geburtstagskind</strong>. Dazu gibt es für jedes Kind ein Popcorn (32 oz) und Einladungskarten. Der Vorteil ist <strong>auch ohne Family-Film-Club-Mitgliedschaft</strong> möglich. Er setzt aber mindestens <strong>vier Freunde</strong> zusätzlich zum Geburtstagskind voraus und ist einmal im Jahr innerhalb von <strong>14 Tagen vor oder nach dem Geburtstag</strong> einlösbar.</p><p>Die Altersgrenze ist wichtig: Cineplexx beschreibt den Geburtstagsvorteil mit <strong>bis zum 13. Geburtstag</strong> und sagt, dass er mit diesem Geburtstag endet. Eine allgemein kostenlose Kinokarte für Erwachsene oder alle Jugendlichen ist damit nicht zugesagt. Wenn ihr genau den 13. Geburtstag feiern möchtet, klärt den Grenzfall vor der Reservierung direkt mit dem Kino.</p><h3>Was kostet die Gruppe trotz Gratis-Ticket?</h3><p>Die am 8. Oktober 2026 geprüfte Angebotsseite nennt für Freunde bis 14 Jahre <strong>8 Euro pro Ticket</strong>. Vier passende Freundetickets ergeben damit <strong>32 Euro Grundkosten</strong>. Das ist eine Rechnung aus dem angegebenen Einzelpreis, kein Festpreis für die gesamte Feier. Für 3D, Überlänge und Cinegold können Zuschläge dazukommen; in Premium-Sälen gilt für die Freunde der reguläre Kinderpreis zuzüglich Aufpreisen. Ein Ticket für eine erwachsene Begleitung ist in dieser Rechnung nicht enthalten. Sondervorstellungen und die Kombination mit anderen Angeboten sind ausgeschlossen.</p><h3>So planst du den Kinogeburtstag in Wien</h3><ol><li>Besuchstag im 14-Tage-Fenster wählen und die Altersregeln für Geburtstagskind und Freunde abgleichen.</li><li>Mindestens vier Freunde einplanen und den gewünschten Film an der Kinokassa reservieren; Preis, Format, verfügbare Plätze und Zuschläge dort bestätigen.</li><li>Geburtstag mit amtlichem Lichtbildausweis oder einem entsprechenden Nachweis belegen. Kläre vorher, welchen Nachweis das Kino für euer Kind akzeptiert.</li><li>Die Geburtstagstickets am Tag der Vorstellung an der Kassa kaufen und den Vorteil vor dem Bezahlen nennen.</li></ol><p>Ein Wiener Standort ist laut <a href="https://cineplexx.at/cinemas/Cineplexx-Millennium-City" rel="noopener">offizieller Kinoseite</a> Cineplexx Millennium City, <strong>Wehlistraße 66, 1200 Wien</strong>; Handelskai ist mit U6 und S-Bahn erreichbar. Die gesondert angebotene Geburtstagsraum-Miete gehört nicht automatisch zum Gratis-Ticket. Prüfe die konkrete Buchung mit deinem Kino.</p><div class="article-note"><strong>Laufend, mit klaren Bedingungen</strong>Die Quelle nennt kein festes Aktionsende. Das persönliche 14-Tage-Fenster ist kein Enddatum der gesamten Aktion. Für einen Kinoabend außerhalb dieses Geburtstagsangebots findest du im <a href="kinodonnerstag-wien-drei.html">Drei-KinoDonnerstag-Guide</a> einen anderen Einlöseweg; die Vorteile sind nicht als kombinierbar zugesagt.</div>`],
      ['donauturm-ticketkauf', 'Donauturm: Gratis-Eintritt vor dem Ticketkauf einlösen', `<p>Die <a href="https://www.donauturm.at/public/de/events-news-and-kulinarik/events/geburtstag-am-donauturm-wien/" rel="noopener">offizielle Geburtstagsseite</a> nennt einen entscheidenden Schritt: Melde dich <strong>vor dem Ticketkauf</strong> mit gültigem Lichtbildausweis am Front Desk. Der Vorteil wird nicht automatisch berücksichtigt. Bereits gekaufte Eintritts- oder Rutschentickets werden dafür laut Anbieter nachträglich weder angerechnet noch storniert oder erstattet.</p><p>Plane deshalb zuerst das zulässige Besuchsdatum, dann die Einlösung vor Ort und erst danach Tickets für die Begleitung. Das Fenster von zwei Tagen vor bis zwei Tagen nach dem Geburtstag lässt sich nicht verlängern oder auf einen anderen Termin übertragen.</p>`],
      ['dienstag', 'Geburtstag gratis planen: Welcher Tag passt für Essen und Eintritt?', `<p>Die beiden Zeitfenster sind nicht gleich. Bei Watertuin gilt der Vorteil grundsätzlich nur am Geburtstag; fällt dieser auf einen Dienstag, nennt der Anbieter ausdrücklich den folgenden Mittwoch oder Donnerstag. Der Donauturm lässt die Einlösung bis zu zwei Tage vor oder nach dem Geburtstag zu.</p><h3>Wochentags-Planer für beide Vorteile</h3><p>Die folgende Übersicht rechnet nur die offiziell genannten Zeitfenster um. Sie ist keine gemeinsame Buchung: Für Watertuin bleiben Reservierung und eine vollzahlende erwachsene Begleitung nötig; für den Donauturm gelten Lichtbildausweis und Einlösung am Front Desk.</p><table><thead><tr><th scope="col">Geburtstag ist am …</th><th scope="col">Watertuin: gratis essen &amp; trinken</th><th scope="col">Donauturm: gratis Eintritt &amp; Rutsche</th></tr></thead><tbody><tr><td>Montag</td><td>Montag</td><td>Samstag bis Mittwoch</td></tr><tr><td>Dienstag</td><td>Mittwoch oder Donnerstag</td><td>Sonntag bis Donnerstag</td></tr><tr><td>Mittwoch</td><td>Mittwoch</td><td>Montag bis Freitag</td></tr><tr><td>Donnerstag</td><td>Donnerstag</td><td>Dienstag bis Samstag</td></tr><tr><td>Freitag</td><td>Freitag</td><td>Mittwoch bis Sonntag</td></tr><tr><td>Samstag</td><td>Samstag</td><td>Donnerstag bis Montag</td></tr><tr><td>Sonntag</td><td>Sonntag</td><td>Freitag bis Dienstag</td></tr></tbody></table><p>Nur bei einem Dienstag-Geburtstag überschneiden sich laut diesen Regeln beide Watertuin-Ausnahmetage mit dem Donauturm-Fenster. Auch dann sind es zwei getrennte Vorteile und keine Zusage, sie zu kombinieren oder am selben Tag ohne eigene Reservierung und Einlösung zu nutzen.</p><div class="article-note"><strong>Praktisch planen</strong>Für Watertuin zuerst den Reservierungstermin sichern. Den Donauturm-Vorteil löst du separat vor Ort ein; eine Reservierung im Turm Café oder Restaurant kann den Besuch ergänzen, ersetzt aber laut Angebotsseite nicht den Front-Desk-Ablauf für den Gratis-Eintritt.</div>`],
      ['feier', 'Gratis Eintritt ist keine kostenlose Geburtstagsfeier', `<p>Der Donauturm trennt den Gratis-Eintritt klar von Restaurant und Feier. Wer nach der Einlösung am Front Desk mit einer Gruppe essen möchte, plant Tisch und Konsumation separat. Für eine eigene Torte nennt die offizielle <a href="https://www.donauturm.at/de/events-news-and-kulinarik/events/geburtstagsfeiern-am-donauturm/" rel="noopener">Geburtstagsfeier-Seite</a> diese Regeln: Im Turm Restaurant ist sie bei Reservierungen ab sechs Personen und entsprechender Konsumation möglich; bei kleineren Reservierungen nennen die <a href="https://www.donauturm.at/de/gastronomie-and-shop/turm-restaurant/" rel="noopener">Restaurantseite</a> und die Feierseite ein <strong>Gabelgeld</strong>, widersprechen sich aber zur Abrechnung pro Torte oder pro Person. Lass Betrag und Abrechnung vor der Reservierung direkt bestätigen. Im Turm Café sind mitgebrachte Torten nicht erlaubt.</p><p>Eine Torte vom Donauturm solltest du laut Anbieter spätestens drei Werktage vor dem Reservierungsdatum bestellen. Das ist ein eigener Planungsschritt und gehört nicht zum Geburtstagsvorteil. So bleibt die Zusage korrekt: kostenlos sind beim Donauturm Eintritt und eine Rutschenfahrt für das Geburtstagskind; Essen, Torte und die Gruppe werden getrennt vereinbart.</p><div class="article-note"><strong>Für die Reservierung bereithalten</strong>Anzahl der Personen, Restaurant oder Café, gewünschte Torte und Geburtstagstermin. Den Gratis-Eintritt löst du trotzdem mit Lichtbildausweis direkt am Front Desk ein.</div>`],
      ['stadtjubiläum', 'Geburtstagsjubiläum der Stadt Wien: Sonderfall ab 90', `<p>Neben kommerziellen Aktionen gibt es einen öffentlichen, klar abgegrenzten Geburtstagsvorteil: Die <a href="https://www.wien.gv.at/amtswege/geburtstagsjubilaeum-anmeldung" rel="noopener">Stadt Wien</a> nennt für berechtigte Wiener*innen zum 90., 95., 100. Geburtstag und danach eine Anerkennungsgabe in Form eines Geldbetrags sowie ein Glückwunschschreiben. Das ist kein Restaurant-, Eintritts- oder App-Gutschein.</p><p>Die Amtsseite nennt dafür österreichische Staatsbürgerschaft und Hauptwohnsitz in Wien. Laut Stadt erhalten Jubilar*innen vier bis sechs Wochen vor dem Geburtstag ein Schreiben mit Antwortformular; die Terminvereinbarung erfolgt anschließend mit der zuständigen Bezirksvorstehung. Die Anmeldung selbst ist kostenlos. Prüfe den aktuellen Brief oder das <a href="https://www.wien.gv.at/zusammenleben/geburtstagsjubilaeen" rel="noopener">städtische Jubiläumsportal</a>, bevor du einen Termin erwartest.</p>`],
      ['schnellvergleich', 'Geburtstag kostenlos: in 20 Sekunden passend auswählen', `<p>Die Suchanfragen „Geburtstag kostenlos“, „Geburtstag gratis essen Wien“ und „Geburtstagskind gratis Eintritt“ meinen nicht dasselbe. Mit dieser Übersicht erkennst du vor der Anfahrt, welcher der beschriebenen Vorteile zu deinem Geburtstag passt.</p><table><thead><tr><th scope="col">Wenn du suchst …</th><th scope="col">Passender Vorteil</th><th scope="col">Vorher einplanen</th></tr></thead><tbody><tr><td>gratis Essen und Trinken genau am Geburtstag</td><td>Watertuin: das Geburtstagskind konsumiert gratis.</td><td>Reservierung und mindestens eine erwachsene Person zum normalen Vollpreis; bei Dienstag laut Quelle Mittwoch oder Donnerstag wählen.</td></tr><tr><td>kostenlosen Eintritt rund um den Geburtstag</td><td>Donauturm: freier Eintritt plus kostenlose Rutschenfahrt für das Geburtstagskind.</td><td>Gültigen Lichtbildausweis mitnehmen; Besuch bis zwei Tage vor oder nach dem Geburtstag; Restaurant und Begleitpersonen zahlen regulär.</td></tr><tr><td>gratis Eintritt am Geburtstag im Prater</td><td>Madame Tussauds: Eintritt für Geburtstagskinder jeden Alters.</td><td>Genau am Geburtstag kommen und amtlichen Lichtbildausweis vorzeigen; kein erweitertes Zeitfenster genannt.</td></tr><tr><td>ein Geburtstagsgetränk als bestehendes Gold-Mitglied</td><td>Starbucks Österreich: ein handgemachtes Getränk.</td><td>Gold-Status, Geburtstag im Konto und verfügbaren Reward prüfen; App oder registrierte Card zur Einlösung mitnehmen.</td></tr><tr><td>ein Kindergeburtstags-Kinoticket mit Freunden</td><td>Cineplexx: Ticket fürs Geburtstagskind und Popcorn für die Kinder.</td><td>Mindestens vier zahlende Freunde; Geburtstagskind laut Anbieter bis zum 13. Geburtstag, Freunde bis 14 Jahre; Besuch 14 Tage davor oder danach. Preis und Zuschläge an der Kassa bestätigen.</td></tr><tr><td>eine städtische Ehrung zum hohen Geburtstag</td><td>Stadt Wien: Anerkennungsgabe und Glückwunschschreiben für berechtigte Jubiläen ab 90.</td><td>Österreichische Staatsbürgerschaft und Wiener Hauptwohnsitz prüfen; auf das Schreiben vier bis sechs Wochen davor achten.</td></tr><tr><td>kostenlose Öffis mit Kind oder Schüler*in am Besuchstag</td><td>Wiener Linien: Freifahrt nur bei passender Alters-, Schul- und Kalenderregel, nicht als Geburtstagsbonus.</td><td>Sonn-/Feiertag, Ferien oder 2./15. November; Lichtbild- bzw. Schüler*innen-Ausweis und Kernzone Wien prüfen.</td></tr></tbody></table><p>Die Tabelle ersetzt keine Buchung, Zusage oder behördliche Prüfung. Laufende Angebote ohne Enddatum können geändert oder widerrufen werden.</p>`],
      ['oeffis', 'Kindergeburtstag: Sind die Öffis in Wien gratis?', `<p><strong>Nicht automatisch wegen des Geburtstags.</strong> Die <a href="https://tramwm.wienerlinien.at/web/guest/erm%C3%A4%C3%9Figungen-und-freifahrt" rel="noopener">Wiener Linien</a> nennen eine eigene Freifahrt-Regel: Kinder und Jugendliche fahren bis zum 15. Geburtstag in der Kernzone Wien während der Wiener Schulferien, an Sonn- und Feiertagen sowie am 2. und 15. November gratis. Schulautonome Tage sind laut Anbieter ausgenommen.</p><p>Für ältere Schüler*innen gilt diese Freifahrt bis zum 24. Geburtstag nur bei Besuch einer österreichischen öffentlichen oder mit Öffentlichkeitsrecht ausgestatteten Schule; Berufsschüler*innen sind ausgenommen. Dafür ist ein Schüler*innen-Ausweis nötig. An einem gewöhnlichen Schultag ist der Geburtstag selbst also <strong>kein</strong> Freifahrtsgrund. Prüfe vor der Anreise Datum, Altersgrenze, Schule und den erforderlichen Nachweis direkt bei den Wiener Linien.</p><div class="article-note"><strong>So planst du korrekt</strong>Die Freifahrt betrifft das Netz der Wiener Linien in Wien. Sie ersetzt weder ein Ticket für außerhalb liegende Strecken noch die Voraussetzungen eines Geburtstagsangebots bei Watertuin oder Donauturm.</div>`],
      ['vor-ort', 'Watertuin und Donauturm: Einlösung vor Ort planen', `<p>Wähle vor der Anfahrt nur den Weg, der zu deinem Datum und eurer Gruppe passt. So verwechselst du keinen kostenlosen Vorteil mit einem Gutschein oder einer allgemeinen Restaurantreservierung.</p><ol><li><strong>Für Watertuin:</strong> Reserviere den Besuch vorab für den Geburtstag. Plane mindestens eine erwachsene, vollzahlende Begleitperson ein und nenne den Geburtstagsvorteil vor der Bestellung. Liegt der Geburtstag auf einem Dienstag, prüfe die auf der Aktionsseite genannte Ausnahme für Mittwoch oder Donnerstag noch einmal.</li><li><strong>Für den Donauturm:</strong> Lege den Termin höchstens zwei Tage vor oder nach dem Geburtstag und nimm einen gültigen Lichtbildausweis mit. Melde dich vor dem Ticketkauf direkt am Front Desk; eine Tischreservierung im Restaurant ersetzt laut Donauturm keinen Eintritt. Rechne Eintritt und Rutsche für Begleitpersonen separat.</li></ol><p>Bei beiden Wegen gilt: Die Originalseite ist die maßgebliche Zusage. Die hier genannten Aktionen sind laufend und können ohne kalendarisches Ablaufdatum geändert oder widerrufen werden.</p>`],
      ['vergleich', 'Geburtstagskind gratis: Welcher Vorteil passt wann?', `<p>Watertuin, Donauturm und die städtische Jubiläumsehrung haben unterschiedliche Zielgruppen, Zeitfenster und Voraussetzungen. Dieser Vergleich hilft, die Suchintention „Geburtstagskind gratis Eintritt“ von „Geburtstag gratis essen Wien“ zu trennen und keinen Weg umsonst zu planen.</p><div class="article-note"><strong>Watertuin</strong><br>Für gratis Essen und Trinken muss der Besuch <strong>am Geburtstag</strong> stattfinden. Eine Reservierung und mindestens eine vollzahlende erwachsene Person sind Voraussetzung. Bei einem Dienstag nennt die Quelle Mittwoch oder Donnerstag als Ausnahme.<br><br><strong>Donauturm</strong><br>Für gratis Eintritt und eine Rutschenfahrt ist ein Besuch <strong>bis zwei Tage vor oder nach</strong> dem Geburtstag möglich. Ein gültiger Lichtbildausweis ist nötig; Begleitpersonen zahlen regulär. Speisen und Getränke sind nicht Teil des Geburtstagsangebots.<br><br><strong>Stadt Wien</strong><br>Die Anerkennungsgabe richtet sich nur an berechtigte Wiener*innen ab 90 und wird nicht an der Kassa eingelöst. Maßgeblich sind das Schreiben der Stadt und die Terminvereinbarung mit der Bezirksvorstehung.</div><p>Wenn dein Geburtstag auf einen Dienstag fällt oder ihr außerhalb des eigentlichen Datums feiern wollt, lies zuerst die jeweilige Originalseite. Die Angaben sind kein Gutschein und laufende Angebote können vom Anbieter geändert oder widerrufen werden.</p>`],
      ['formen', 'Welche Geburtstagsvorteile sind wirklich gratis?', `<p>Wer nach <strong>Geburtstag gratis Wien</strong> sucht, findet unterschiedliche Modelle: ein kostenloses Getränk, ein Dessert zum Hauptgericht, freien Eintritt, Bonuspunkte oder einen Wertgutschein. Wirklich gratis ist nur die Leistung ohne verpflichtenden Kauf oder Mindestumsatz für das Geburtstagskind. Ein „Gratis-Dessert beim Essen“ setzt beispielsweise eine kostenpflichtige Bestellung voraus.</p><p>Trenne deshalb echtes Geschenk, Rabatt und Vorteil mit Mindestumsatz. So vergleichst du Angebote, die wirtschaftlich wirklich zusammenpassen, statt ein kostenloses Extra mit einer vollständigen Einladung zu verwechseln.</p>`],
      ['kostencheck', 'Geburtstagskind gratis: Was die Gruppe trotzdem bezahlt', `<p>Ein Geburtstagsvorteil senkt nicht automatisch die gesamte Rechnung der Feier. Plane vor der Reservierung nur die Kosten ein, die auf den offiziellen Seiten ausdrücklich genannt werden: Bei Watertuin muss mindestens eine erwachsene Person den normalen Vollpreis zahlen. Beim Donauturm bleiben Eintritt und gegebenenfalls Rutschenfahrt für Begleitpersonen regulär; Restaurantbesuch, Speisen und Getränke sind nicht Teil des Geburtstagsvorteils.</p><p>Auch die Anreise ist ein eigener Punkt: Die <a href="https://tramwm.wienerlinien.at/web/guest/erm%C3%A4%C3%9Figungen-und-freifahrt" rel="noopener">Wiener Linien</a> nennen Freifahrt für Kinder und berechtigte Schüler*innen nur bei den dort genannten Alters-, Schul- und Kalendervoraussetzungen, nicht wegen eines Geburtstags. Wenn diese Regel nicht passt, rechne für die Fahrt mit einem regulären Ticket. So bleibt „gratis“ eine nachvollziehbare Leistung für das Geburtstagskind und keine irreführende Gesamtkosten-Zusage.</p><div class="article-note"><strong>30-Sekunden-Kostencheck</strong>Notiere Anzahl der Begleitpersonen, deren reguläre Eintritts- oder Essenskosten, mögliche Rutschenfahrten und die Anreise. Erst dann entscheidest du, ob Essen am Geburtstag oder ein Besuch im Donauturm für eure Gruppe besser passt.</div>`],
      ['vorlauf', 'Anmeldung oder Reservierung: Was du wirklich brauchst', `<p>Die heute geprüften Seiten von Watertuin, Donauturm und Madame Tussauds nennen keine Mitgliedschaft oder Newsletteranmeldung als Voraussetzung für ihren Geburtstagsvorteil. Eine <strong>Reservierung bei Watertuin</strong> ist aber verpflichtend. Beim Donauturm und bei Madame Tussauds brauchst du den jeweils genannten <strong>Lichtbildausweis</strong>.</p><p>Eine Tischreservierung ist also etwas anderes als eine Anmeldung für einen Gutschein. Falls du zusätzlich einen App- oder Mitgliedervorteil nutzen möchtest, prüfe dessen eigenen Registrierungsvorlauf und Gültigkeitszeitraum im Guide <a href="app-gutscheine-wien.html">App-Gutscheine in Wien</a>.</p>`],
      ['nachweis', 'Ausweis, App und Filiale prüfen', `<p>Ein amtlicher Lichtbildausweis kann als Alters- oder Geburtstagsnachweis verlangt werden. Digitale Gutscheine müssen oft in der App geöffnet und dürfen nicht vorher als eingelöst markiert werden. Bei Ketten gilt ein Vorteil möglicherweise nur in teilnehmenden Filialen.</p><div class="article-note"><strong>Wichtig vor Ort</strong>Zeige den Gutschein vor der Bestellung und frage kurz, ob die konkrete Filiale teilnimmt. Das verhindert Missverständnisse an der Kassa.</div>`],
      ['plan', 'Geburtstag gratis essen und Eintritt: der 60-Sekunden-Plan', `<ol><li><strong>Datum abgleichen:</strong> Für Madame Tussauds gilt genau der Geburtstag. Bei Watertuin gilt ebenfalls der Geburtstag, mit der genannten Dienstag-Ausnahme; beim Donauturm liegt das mögliche Fenster zwei Tage davor bis zwei Tage danach.</li><li><strong>Voraussetzung auswählen:</strong> Watertuin vorher reservieren und eine vollzahlende erwachsene Person einplanen; zum Donauturm einen gültigen Lichtbildausweis und zu Madame Tussauds einen amtlichen Lichtbildausweis mitnehmen.</li><li><strong>Vor Abfahrt die Originalseiten öffnen:</strong> Alle fünf Vorteile sind laufend. Bei Starbucks prüfst du zusätzlich Gold-Status, Reward und dessen Einlösefrist in der App.</li><li><strong>Begleitkosten realistisch rechnen:</strong> Beim Watertuin zahlt die Begleitperson den Vollpreis; beim Donauturm zahlen Begleitpersonen Eintritt und gegebenenfalls die Rutsche regulär.</li></ol><p>Für weitere kurzfristige Treffer nutze <a href="/angebote-wien-heute.html">Angebote in Wien heute</a>; dort stehen ausgewählte Deals mit erfasstem Enddatum. Laufende Geburtstagsaktionen ohne festes Ende solltest du immer direkt beim Anbieter kontrollieren.</p>`],
    ],
    faqs: [
      ['Ist das Kino am Geburtstag in Wien gratis?', 'Cineplexx nennt beim Kindergeburtstag ein Gratis-Ticket für das Geburtstagskind, wenn mindestens vier Freunde mitkommen. Die Quelle nennt bis zum 13. Geburtstag als Grenze; den Grenzfall am 13. Geburtstag vorher mit dem Kino klären. Der Vorteil gilt einmal jährlich innerhalb von 14 Tagen vor oder nach dem Geburtstag und auch ohne Family-Film-Club-Mitgliedschaft.'],
      ['Was kosten vier Freunde beim Cineplexx-Kindergeburtstag?', 'Die offizielle Angebotsseite nennt 8 Euro pro Freundeticket für Freunde bis 14 Jahre. Vier solche Tickets ergeben 32 Euro Grundkosten. Zuschläge, Premium-Säle und ein Ticket für erwachsene Begleitung können den Gesamtpreis erhöhen. Popcorn für die Kinder ist laut Angebot enthalten; den Endpreis an der Kassa bestätigen.'],
      ['Kann ich das Cineplexx-Geburtstagsticket online kaufen?', 'Cineplexx nennt die Reservierung des gewünschten Films an der Kinokassa und den Kauf der Geburtstagstickets am Tag der Vorstellung an der Kassa. Lege einen amtlichen Lichtbildausweis oder entsprechenden Geburtstagsnachweis vor und kläre die Akzeptanz des Nachweises vorher.'],
      ['Wo gibt es Geburtstag gratis Essen in Wien?', 'Watertuin nennt auf seiner offiziellen Aktionsseite gratis Essen und Trinken für das Geburtstagskind am Geburtstag. Voraussetzung sind Reservierung und mindestens eine erwachsene Person zum regulären Vollpreis. Die Aktion gilt laut Anbieter bis auf Widerruf.'],
      ['Gibt es bei Starbucks in Wien ein gratis Geburtstagsgetränk?', 'Ja, für Gold-Mitglieder des österreichischen Rewards-Programms. Prüfe deinen Status und hinterlege den Geburtstag im Konto. Der Reward für ein handgemachtes Getränk gilt ab Ausstellung 30 Tage; zur Einlösung brauchst du App oder registrierte Card in einer teilnehmenden Filiale.'],
      ['Kann ich bereits gekaufte Donauturm-Tickets zum Geburtstag erstatten lassen?', 'Laut Donauturm nicht aufgrund des Geburtstagsvorteils. Löse ihn im gültigen Zeitfenster vor dem Ticketkauf am Front Desk mit gültigem Lichtbildausweis ein. Eine nachträgliche Anrechnung, Stornierung oder Erstattung bereits gekaufter Eintritts- oder Rutschentickets ist für diesen Vorteil ausgeschlossen.'],
      ['Wo hat das Geburtstagskind gratis Eintritt in Wien?', 'Madame Tussauds gewährt freien Eintritt genau am Geburtstag gegen amtlichen Lichtbildausweis. Der Donauturm nennt freien Eintritt und eine kostenlose Rutschenfahrt für Geburtstagskinder bis zwei Tage vor oder nach dem Geburtstag. Für die Einlösung am Front Desk ist ein gültiger Lichtbildausweis nötig; Begleitpersonen zahlen regulär.'],
      ['Kann ich die Geburtstagsvorteile auch vor oder nach dem Geburtstag einlösen?', 'Madame Tussauds nennt ausschließlich den Geburtstag selbst. Beim Donauturm gilt das Angebot bis zu zwei Tage vor oder nach dem Geburtstag. Watertuin nennt grundsätzlich den Geburtstag selbst; für einen Geburtstag an einem Dienstag nennt die offizielle Seite Mittwoch oder Donnerstag als Ausnahme.'],
      ['Kann ich Watertuin und Donauturm bei einem Dienstag-Geburtstag am selben Tag nutzen?', 'Nicht am Dienstag selbst bei Watertuin: Der Anbieter nennt bei einem Dienstag-Geburtstag Mittwoch oder Donnerstag als Ausnahme. Diese beiden Tage liegen rechnerisch auch noch innerhalb des Donauturm-Fensters von zwei Tagen nach dem Geburtstag. Es sind jedoch getrennte Vorteile: Für Watertuin bleiben Reservierung und eine vollzahlende erwachsene Begleitung nötig; beim Donauturm gelten Lichtbildausweis und Einlösung am Front Desk.'],
      ['Gilt Geburtstag kostenlos auch für Begleitpersonen?', 'Nein. Bei Watertuin muss mindestens eine erwachsene Person den normalen Vollpreis zahlen. Beim Donauturm zahlen Begleitpersonen den regulären Eintritt und gegebenenfalls die Rutsche. Kostenlos ist die jeweilige Leistung nur für das Geburtstagskind und unter den genannten Bedingungen.'],
      ['Fahren Kinder am Geburtstag in Wien gratis?', 'Nicht automatisch wegen des Geburtstags. Laut Wiener Linien fahren Kinder und Jugendliche bis zum 15. Geburtstag in der Kernzone Wien in den Wiener Schulferien, an Sonn- und Feiertagen sowie am 2. und 15. November gratis; schulautonome Tage sind ausgenommen. Ältere berechtigte Schüler*innen können diese Freifahrt bis zum 24. Geburtstag nutzen, wenn sie die genannten Schul- und Ausweisvoraussetzungen erfüllen.'],
      ['Welche Geburtstagsangebote in Wien sind wirklich gratis?', 'Wirklich gratis sind Leistungen ohne verpflichtenden Kauf oder Mindestumsatz für das Geburtstagskind. Viele Dessert-, Gutschein- oder 2-für-1-Angebote setzen dagegen eine Bestellung, Mitgliedschaft oder Begleitperson voraus. Beim Donauturm zählen etwa Eintritt und eine Rutschenfahrt dazu, nicht aber Restaurantbesuch, Speisen oder Getränke.'],
      ['Gibt es in Wien eine städtische Anerkennung zum Geburtstag?', 'Für berechtigte Wienerinnen und Wiener nennt die Stadt Wien zum 90., 95., 100. Geburtstag und danach eine Anerkennungsgabe in Form eines Geldbetrags und ein Glückwunschschreiben. Die Amtsseite nennt österreichische Staatsbürgerschaft und Hauptwohnsitz in Wien; laut Stadt kommt vier bis sechs Wochen vorher ein Schreiben mit Antwortformular.'],
      ['Was kostet eine Geburtstagsfeier trotz Gratisvorteil?', 'Das hängt von der Gruppe ab. Bei Watertuin muss mindestens eine erwachsene Person den normalen Vollpreis zahlen. Beim Donauturm zahlen Begleitpersonen regulären Eintritt und gegebenenfalls die Rutsche; Restaurantbesuch, Speisen und Getränke sind nicht Teil des Geburtstagsvorteils. Für die Anreise gilt die Wiener-Linien-Freifahrt nur bei den genannten Alters-, Schul- und Kalendervoraussetzungen.'],
      ['Kann ich am Donauturm eine eigene Geburtstagstorte mitbringen?', 'Im Turm Restaurant ist eine eigene Torte laut Donauturm bei Reservierungen ab sechs Personen und entsprechender Konsumation möglich. Bei kleineren Reservierungen nennen Restaurant- und Feierseite ein Gabelgeld, widersprechen sich aber zur Abrechnung pro Torte oder pro Person. Betrag und Abrechnung vor der Reservierung direkt bestätigen. Im Turm Café sind mitgebrachte Torten nicht erlaubt. Das betrifft die Feier und ist nicht Teil des kostenlosen Geburtstagseintritts.'],
      ['Was muss das Geburtstagskind bei Watertuin und beim Donauturm vorzeigen?', 'Für den Donauturm nennt die offizielle Angebotsseite einen gültigen Lichtbildausweis und die Einlösung direkt am Front Desk. Watertuin nennt eine verpflichtende Reservierung sowie mindestens eine erwachsene Person zum normalen Vollpreis. Prüfe die jeweilige Originalseite unmittelbar vor dem Besuch erneut.'],
      ['Brauche ich für den Donauturm eine Tischreservierung?', 'Für den Gratis-Eintritt nennt die offizielle Angebotsseite die Einlösung direkt am Front Desk mit gültigem Lichtbildausweis. Für einen anschließenden Besuch im Turm Café oder Turm Restaurant empfiehlt der Donauturm eine Tischreservierung; Gastronomie und Eintritt sind getrennte Planungsschritte.'],
      ['Ist Madame Tussauds am Geburtstag für Erwachsene kostenlos?', 'Ja. Die offiziellen Besucherinformationen nennen Geburtstagskinder jeden Alters. Freier Eintritt gilt am Geburtstag gegen amtlichen Lichtbildausweis; ein festes Enddatum wird nicht angegeben.'],
      ['Muss ich mich vor dem Geburtstag registrieren?', 'Die geprüften Seiten von Watertuin, Donauturm und Madame Tussauds nennen keine Mitgliedschaft als Voraussetzung. Bei Watertuin ist eine Reservierung verpflichtend; bei den beiden Eintrittsvorteilen musst du den genannten Lichtbildausweis vorzeigen. Starbucks verlangt dagegen Gold-Status im österreichischen Rewards-Programm und einen im Konto hinterlegten Geburtstag.'],
      ['Brauche ich einen Ausweis?', 'Das hängt vom Anbieter ab. Wenn ein Geburtstags- oder Altersnachweis verlangt wird, ist meist ein amtlicher Lichtbildausweis erforderlich.'],
    ],
    related: [['KinoDonnerstag in Wien', 'kinodonnerstag-wien-drei.html'], ['Günstig essen nach Bezirk', 'guenstig-essen-wien.html'], ['Gratis Essen in Wien', 'gratis-essen-wien.html'], ['Gratis Kaffee in Wien', 'gratis-kaffee-wien.html'], ['Kostenlose Freizeit in Wien', 'kostenlose-freizeitangebote-wien.html'], ['Gutscheine in Wien', 'gutscheine-wien.html'], ['Restaurant-Gutscheine in Wien', 'restaurant-gutscheine-wien.html'], ['Aktuelle Wien-Deals', '/angebote-wien-heute.html']],
  },
  {
    slug: 'studentenrabatte-wien',
    title: 'Studentenrabatte in Wien heute vergleichen',
    meta: 'Studentenrabatte in Wien heute vergleichen: Nachweise, Laufzeiten, Filiale und tatsächliche Ersparnis bei Essen, Freizeit und Services prüfen.',
    eyebrow: 'Studentenrabatte Wien',
    headline: 'Studentenrabatte in Wien heute finden, die sich wirklich lohnen.',
    intro: 'Studierendenausweis, Hochschul-Mailadresse oder Altersgrenze: Rabatte für Studierende haben unterschiedliche Voraussetzungen. Mit diesem Tagescheck erkennst du die echte Ersparnis vor dem Abschluss.',
    modified: '2026-09-20', modifiedLabel: '20. September 2026',
    image: '/assets/current-ios/for-you.jpg', imageAvif: '/assets/current-ios/for-you-400.avif 400w, /assets/current-ios/for-you-711.avif 711w', imageWidth: 711, imageHeight: 400,
    imageAlt: 'FreeFinder Empfehlungen mit lokalen Angeboten und Rabatten',
    sections: [
      ['kategorien', 'Wo Studentenrabatte häufig vorkommen', `<p><strong>Studentenrabatte in Wien</strong> gibt es unter anderem bei Gastronomie, Kultur, Sport, Software, Mobilfunk und Bildungsangeboten. Einige gelten dauerhaft, andere nur während Aktionswochen oder an bestimmten Wochentagen. Öffentliche Tarife und kommerzielle Gutscheine solltest du getrennt vergleichen.</p><p>Ein hoher Prozentsatz ist nicht automatisch der beste Preis. Vergleiche den Endpreis mit regulären Alternativen und achte auf Service-, Versand- oder Anmeldegebühren.</p>`],
      ['nachweis', 'Welcher Nachweis kann verlangt werden?', `<p>Üblich sind ein gültiger Studierendenausweis, eine aktuelle Inskriptionsbestätigung oder eine Hochschul-Mailadresse. Manche Angebote kombinieren den Studierendenstatus mit einer Altersgrenze. Andere gelten nur für neu angelegte Konten.</p><p>Gib persönliche Dokumente nur auf der offiziellen Website oder in der offiziellen App des Anbieters ein. Ein Social-Media-Konto, das Ausweiskopien per Direktnachricht fordert, ist keine angemessene Verifizierungsstelle.</p>`],
      ['rechnung', 'Die tatsächliche Ersparnis berechnen', `<ol><li>Notiere den regulären Gesamtpreis.</li><li>Ziehe den Rabatt ab und addiere alle Gebühren.</li><li>Prüfe Mindestlaufzeit und automatische Verlängerung.</li><li>Vergleiche das Ergebnis mit einem frei verfügbaren Tarif.</li><li>Setze eine Erinnerung, falls der Vorteil nach Studienende ausläuft.</li></ol><p>Besonders bei Abos ist die monatliche Ersparnis weniger wichtig als der Gesamtpreis über die Mindestlaufzeit.</p>`],
      ['heute', 'Vor dem Abschluss heute: Status, Datum und Endpreis', `<p>Ein sichtbarer Studierendenpreis ist nicht automatisch für jedes Konto freigeschaltet. Melde dich auf der offiziellen Anbieterplattform an und prüfe, ob dein Nachweis noch gültig ist, ob dein Studienort akzeptiert wird und wann die Berechtigung erneut bestätigt werden muss.</p><p>Bei zeitlich begrenzten Aktionen kontrollierst du zusätzlich, ob der heutige Tag im Aktionszeitraum liegt und ob die gewählte Wiener Filiale oder Leistung eingeschlossen ist. Vergleiche den Endpreis inklusive möglicher Versand-, Service- oder Aktivierungsgebühren mit dem regulären Angebot.</p>`],
      ['aktuell', 'Aktuelle Rabatte sauber verifizieren', `<p>Verlasse dich nicht auf alte Listen ohne Änderungsdatum. Öffne die Originalbedingungen und kontrolliere, ob Wien, deine Hochschule und dein Status erfasst sind. Auf FreeFinder findest du außerdem <a href="/angebote-wien-heute.html">aktuelle Wiener Deals mit bekanntem Enddatum</a>, darunter auch allgemeine Rabatte ohne Studierendenpflicht.</p>`],
    ],
    faqs: [
      ['Welche Studentenrabatte gibt es in Wien?', 'Die Kategorien reichen von Essen, Kultur und Sport bis zu Software, Mobilfunk und Bildung. Die konkrete Verfügbarkeit und die Voraussetzungen müssen beim jeweiligen Anbieter geprüft werden.'],
      ['Reicht ein Studierendenausweis als Nachweis?', 'Oft ja, aber nicht immer. Manche Angebote verlangen zusätzlich eine aktuelle Inskriptionsbestätigung, Hochschul-Mailadresse oder ein bestimmtes Höchstalter.'],
      ['Wie prüfe ich einen Studentenrabatt vor dem Kauf?', 'Prüfe auf der offiziellen Anbieterseite, ob dein Nachweis, Studienort, Zeitraum und die konkrete Leistung akzeptiert werden. Vergleiche anschließend den Endpreis inklusive aller Gebühren.'],
      ['Sind Studentenabos automatisch günstiger?', 'Nicht zwingend. Gebühren, Mindestlaufzeiten und automatische Verlängerungen können die Ersparnis verringern. Entscheidend ist der Gesamtpreis.'],
    ],
    related: [['Rabatte in Wien', 'rabatte-wien.html'], ['Gutscheine in Wien', 'gutscheine-wien.html'], ['App-Gutscheine in Wien', 'app-gutscheine-wien.html'], ['1+1-Aktionen in Wien', 'eins-plus-eins-wien.html'], ['Aktuelle Wien-Deals', '/angebote-wien-heute.html']],
  },
  {
    slug: 'produktproben-wien',
    title: 'Kostenlose Produktproben in Wien heute finden',
    meta: 'Kostenlose Produktproben in Wien heute finden: Verkostungen, Testaktionen und Gratis-Samples an Quelle, Zeitraum und Datenbedarf prüfen.',
    eyebrow: 'Produktproben Wien',
    headline: 'Produktproben in Wien heute finden, ohne auf Scheinangebote hereinzufallen.',
    intro: 'Verkostung im Shop, Gratis-Sample bei einer Neueröffnung oder Produkttest per Registrierung: Dieser Tagescheck zeigt, welche Angaben vor dem Weg zum Standort zählen.',
    modified: '2026-09-20', modifiedLabel: '20. September 2026',
    image: '/og-preview-stores.png', imageAvif: '/og-preview-stores-600.avif 600w, /og-preview-stores-1200.avif 1200w', imageWidth: 1200, imageHeight: 630,
    imageAlt: 'FreeFinder App mit unterschiedlichen Wiener Gratis-Angeboten',
    sections: [
      ['arten', 'Vier Arten von Produktproben', `<p>Bei <strong>Produktproben in Wien</strong> sind Vor-Ort-Verkostungen, kleine Gratis-Samples, Cashback-Tests und registrierungspflichtige Produkttests verbreitet. Eine Verkostung ist meist sofort verfügbar. Cashback bedeutet dagegen, dass du zuerst bezahlst und nur bei korrekter Einreichung Geld zurückbekommst.</p><ul><li><strong>Sample:</strong> Kleine Produktmenge ohne Kauf.</li><li><strong>Verkostung:</strong> Test direkt am Aktionsstand.</li><li><strong>Cashback-Test:</strong> Kaufpreis wird nach Prüfung erstattet.</li><li><strong>Testpanel:</strong> Produkt gegen Registrierung und Feedback.</li></ul>`],
      ['serios', 'Woran du eine seriöse Aktion erkennst', `<p>Eine belastbare Aktion nennt Veranstalter, Produkt, Zeitraum, Standort und Teilnahmebedingungen. Bei Cashback sollte klar sein, welcher Beleg benötigt wird und bis wann die Einreichung erfolgen muss. Unklare Formulare, aggressive Weiterleitungen oder eine angebliche Versandgebühr können aus einem Gratisangebot ein kostenpflichtiges Modell machen.</p>`],
      ['daten', 'Datenschutz und Sicherheit', `<p>Prüfe, welche Daten wirklich erforderlich sind. Für eine Verkostung vor Ort braucht es normalerweise keine Ausweiskopie. Bei Testpanels können Adresse und Kontaktmöglichkeit plausibel sein; Zahlungsdaten sind für eine reine Gratisprobe dagegen erklärungsbedürftig.</p><p>Bei Lebensmitteln und Kosmetik bleiben Inhaltsstoffe, Allergene und persönliche Verträglichkeit wichtig. „Gratis“ ersetzt keine Produktinformation.</p>`],
      ['heute', 'Heute abholen: Standort, Zeitfenster und Kontingent prüfen', `<p>Bei Vor-Ort-Proben sind Ort und Zeitraum wichtiger als ein auffälliger Social-Media-Post. Öffne die Originalquelle am selben Tag und suche nach exakter Adresse, Beginn, Ende und Hinweisen wie „solange der Vorrat reicht“. Fehlen diese Angaben, ist ein Anruf beim Veranstalter sinnvoller als eine längere Anfahrt.</p><p>Bei Online-Proben kontrollierst du, ob Versandkosten, ein späteres Abo oder die Weitergabe von Daten an Partner erwähnt werden. Ein kostenloses Sample darf nicht dadurch zum kostenpflichtigen Angebot werden, dass erst im letzten Bestellschritt Gebühren sichtbar werden.</p>`],
      ['finden', 'Produktproben effizient finden', `<p>Suche bei offiziellen Anbieterkanälen, in Filialhinweisen und auf lokalen Deal-Seiten. Kombiniere Begriffe wie „Produktprobe Wien“, „gratis testen Wien“, „Verkostung Wien“ oder „Neueröffnung Gratisproben“. Die <a href="/angebote-wien-heute.html">aktuelle FreeFinder-Übersicht</a> nimmt nur Angebote mit erfasstem Enddatum auf.</p>`],
    ],
    faqs: [
      ['Wo gibt es kostenlose Produktproben in Wien?', 'Typische Orte sind Shops, Einkaufszentren, Aktionsstände und Neueröffnungen. Online-Testaktionen können zusätzlich per Versand oder Cashback funktionieren.'],
      ['Ist Cashback dasselbe wie eine Gratisprobe?', 'Nein. Bei Cashback bezahlst du zuerst und erhältst den Betrag nur zurück, wenn Kauf und Einreichung alle Bedingungen erfüllen.'],
      ['Wie prüfe ich eine Produktprobe für heute?', 'Kontrolliere auf der Originalquelle Standort, Zeitfenster, Kontingent und Teilnahmebedingungen. Bei Online-Angeboten prüfst du zusätzlich Versandkosten, Abohinweise und die tatsächlich benötigten Daten.'],
      ['Welche Daten sollte ich für eine Produktprobe angeben?', 'Nur Daten, die für Ausgabe, Versand oder Teilnahme nachvollziehbar erforderlich sind. Lies vor der Registrierung die Datenschutz- und Teilnahmebedingungen des offiziellen Anbieters.'],
    ],
    related: [['Kostenlose Angebote in Wien', 'kostenlose-angebote-wien.html'], ['Gratis Kaffee in Wien', 'gratis-kaffee-wien.html'], ['App-Gutscheine in Wien', 'app-gutscheine-wien.html'], ['Aktuelle Wien-Deals', '/angebote-wien-heute.html']],
  },
  {
    slug: 'eins-plus-eins-wien',
    title: '1+1-Aktionen in Wien heute richtig prüfen',
    meta: '1+1-Aktionen in Wien heute prüfen: Stückpreis, Produktbindung, App-Coupon, Filiale und Zusatzkosten verständlich vergleichen.',
    eyebrow: '1+1 Aktionen Wien',
    headline: 'Bei 1+1-Aktionen in Wien heute den echten Vorteil erkennen.',
    intro: 'Zweites Produkt gratis klingt eindeutig. Produktgröße, Sortenbindung, Filiale und Vergleichspreis entscheiden aber darüber, ob ein 1+1-Deal heute tatsächlich günstig ist.',
    modified: '2026-09-20', modifiedLabel: '20. September 2026',
    image: '/assets/current-ios/deals-home.jpg', imageAvif: '/assets/current-ios/deals-home-400.avif 400w, /assets/current-ios/deals-home-736.avif 736w', imageWidth: 736, imageHeight: 414,
    imageAlt: 'FreeFinder App mit Pizza-, Getränke- und Rabattangeboten',
    sections: [
      ['rechnung', 'Was bedeutet 1+1 tatsächlich?', `<p>Bei klassischen <strong>1+1-Aktionen in Wien</strong> erhältst du beim Kauf eines Produkts ein zweites gleiches oder günstigeres Produkt kostenlos. Manchmal wird stattdessen ein Rabatt auf zwei Artikel verrechnet. Für den Vergleich teilst du den Gesamtpreis durch die tatsächlich erhaltene Menge.</p><p>Prüfe außerdem den Normalpreis. Wird der Ausgangspreis während der Aktion erhöht, kann ein gewöhnlicher Rabatt bei einem anderen Anbieter günstiger sein.</p>`],
      ['details', 'Kleine Bedingungen mit großer Wirkung', `<ul><li>Gilt nur das gleiche Produkt oder auch eine andere Sorte?</li><li>Ist das günstigere Produkt gratis?</li><li>Brauchst du einen Coupon oder eine bestimmte App?</li><li>Gibt es ein Tageslimit oder nur teilnehmende Filialen?</li><li>Fallen Liefer-, Verpackungs- oder Servicegebühren an?</li></ul><p>Bei Lieferangeboten sollte der Endpreis im Warenkorb geprüft werden. Ein Gratisartikel gleicht hohe Zusatzkosten nicht automatisch aus.</p>`],
      ['heute', '1+1 heute prüfen: Preis, Zeitpunkt und Bestellweg', `<p>Ein 1+1-Angebot kann nur zu bestimmten Uhrzeiten, in ausgewählten Wiener Filialen oder mit einem aktivierten App-Coupon gelten. Öffne daher am selben Tag die Originalbedingungen und kontrolliere, ob der aktuelle Zeitraum, die gewünschte Filiale und deine Bestellart – Lokal, Abholung oder Lieferung – übereinstimmen.</p><p>Lege bei Onlineangeboten beide Produkte in den Warenkorb und prüfe vor dem Bezahlen, welches Produkt tatsächlich kostenlos wird. Manche Aktionen verrechnen nur den günstigeren Artikel mit null Euro. Bei unterschiedlichen Preisen ist der Vorteil dann kleiner als die häufig angenommene Halbierung der Gesamtrechnung.</p>`],
      ['teilen', 'Wann sich ein 1+1-Deal besonders lohnt', `<p>Der Vorteil ist am größten, wenn du beide Produkte ohnehin brauchst oder das zweite mit einer anderen Person teilst. Bei verderblichen Waren führt ein unnötiger Zweitartikel dagegen nicht zu einer echten Ersparnis. Kaufe deshalb nicht allein wegen des Aktionslabels.</p>`],
      ['check', 'Vor dem Bezahlen kontrollieren', `<p>Aktiviere notwendige Coupons und kontrolliere, ob der Rabatt im Warenkorb oder auf dem Kassendisplay erscheint. Bewahre bei komplizierten Aktionen die offiziellen Bedingungen bis zur Abrechnung auf. Auf der Seite <a href="/angebote-wien-heute.html">Aktuelle Angebote in Wien</a> werden 1+1-Treffer mit bekanntem Enddatum gesondert gekennzeichnet.</p>`],
    ],
    faqs: [
      ['Was bedeutet 1+1 gratis?', 'Üblicherweise kaufst du ein Produkt und erhältst ein zweites gleiches oder günstigeres Produkt ohne zusätzlichen Produktpreis. Die genaue Regel steht in den Bedingungen.'],
      ['Sind 1+1-Aktionen immer 50 Prozent Rabatt?', 'Nur wenn beide Produkte denselben Preis haben und keine Zusatzkosten anfallen. Bei unterschiedlichen Preisen, Gebühren oder Produktbindungen kann die Ersparnis geringer sein.'],
      ['Wie erkenne ich, ob eine 1+1-Aktion heute noch gilt?', 'Prüfe in der Originalquelle Zeitraum, teilnehmende Filiale, erforderlichen Coupon und Bestellweg. Lege beide Artikel in den Warenkorb oder frage vor der Bestellung nach, welcher Preis abgezogen wird.'],
      ['Kann ich bei 1+1 zwei verschiedene Produkte wählen?', 'Das hängt von der Aktion ab. Häufig muss es dasselbe Produkt sein oder das günstigere Produkt wird kostenlos.'],
    ],
    related: [['Rabatte in Wien', 'rabatte-wien.html'], ['Gutscheine in Wien', 'gutscheine-wien.html'], ['App-Gutscheine in Wien', 'app-gutscheine-wien.html'], ['Gratis Essen in Wien', 'gratis-essen-wien.html'], ['Aktuelle Wien-Deals', '/angebote-wien-heute.html']],
  },
  {
    slug: 'kostenlose-freizeitangebote-wien',
    title: 'Kostenlose Freizeitangebote in Wien finden',
    meta: 'Kostenlose Freizeitangebote in Wien finden: Eintritt frei, freiwillige Spende und Probetrainings mit Anmeldung, Kündigungsfrist und Folgekosten sicher prüfen.',
    eyebrow: 'Kostenlose Freizeit Wien',
    headline: 'Kostenlose Freizeitangebote in Wien finden – und Bedingungen vorab richtig einordnen.',
    intro: 'Freier Eintritt, freiwillige Spende, Schnuppertraining oder offene Aktivität: Wien bietet unterschiedliche Möglichkeiten, Freizeit ohne Eintrittspreis zu planen. Bei einer kostenlosen Probe sind Anmeldung, Kündigungsfrist und Folgekosten ebenso wichtig wie der Gratiszeitraum.',
    modified: '2026-09-04', modifiedLabel: '4. September 2026',
    image: '/assets/blog/evo-probetraining-wien-2026.jpg', imageWidth: 1600, imageHeight: 900,
    imageAlt: 'Person betritt ein helles Fitnessstudio mit Trainingsgeräten im Hintergrund',
    sections: [
      ['kategorien', 'Welche kostenlosen Aktivitäten gibt es?', `<p><strong>Kostenlose Freizeitangebote in Wien</strong> können freie Museumstage, öffentliche Programme, offene Sportangebote, Schnupperstunden, Märkte oder zeitlich begrenzte Aktionen umfassen. Manche sind dauerhaft kostenlos, andere nur an einem Termin oder für eine bestimmte Zielgruppe.</p><p>Unterscheide freie Teilnahme von einem kostenlosen Probetraining. Bei einer Probe können Anmeldung, Beratungsgespräch oder spätere Aboangebote dazugehören, auch wenn für den Termin selbst nichts berechnet wird.</p>`],
      ['kostenmodell', 'Eintritt frei, freiwillige Spende oder kostenpflichtige Option?', `<p>Diese drei Angaben meinen nicht dasselbe: <strong>„Eintritt frei“</strong> bedeutet, dass für den Zugang kein Eintrittspreis genannt wird. <strong>„Freiwillige Spende“</strong> ist kein fixer Eintrittspreis, kann aber etwa bei einer Sammlung oder einem optionalen Programmpunkt vorkommen. Eine <strong>kostenpflichtige Option</strong> wie Catering, Workshop, Busplatz oder Leihmaterial macht nicht die gesamte Veranstaltung kostenpflichtig – sie muss aber klar von der kostenlosen Teilnahme getrennt sein.</p><p>Suche auf der offiziellen Seite deshalb getrennt nach Zugang, Anmeldung und Zusatzangeboten. Wenn nur ein Nebenprogramm als gratis bezeichnet wird, ist das kein Beleg dafür, dass die Hauptveranstaltung keinen Eintritt kostet. Fehlt eine eindeutige Preisangabe, behandle den Punkt als offen und frage beim Veranstalter nach.</p><div class="article-note"><strong>Der kurze Faktencheck</strong>Notiere vor dem Losgehen: Was ist gratis, was ist optional, ob eine Reservierung nötig ist und welche Kosten bei einer Stornierung oder Nichtteilnahme entstehen können.</div>`],
      ['quellen', 'Offizielle Quellen zuerst prüfen', `<p>Für städtische Kultur-, Natur- und Freizeitangebote sind die offiziellen Seiten der jeweiligen Einrichtung oder der Stadt die zuverlässigste Quelle. Bei Studios, Kursen und privaten Veranstaltern zählt die aktuelle Anbieterseite. Kalender-Aggregatoren helfen beim Entdecken, sollten aber nicht die letzte Prüfung ersetzen.</p><p>Prüfe die Quelle am Besuchstag noch einmal: Datum, Uhrzeit, Adresse und Anmeldelink sollten auf derselben offiziellen Seite zusammenpassen. Ein Social-Media-Post kann auf eine Veranstaltung hinweisen, ersetzt aber keine aktuellen Bedingungen. Bei einem Angebot ohne kalendarisches Ende kennzeichne es gedanklich als <em>laufend</em>, nicht als dauerhaft garantiert.</p>`],
      ['museum', 'Wien Museum: Eintritt frei richtig einordnen', `<p>Die am 4. September 2026 geprüfte <a href="https://www.wienmuseum.at/besucherinformation" rel="noopener">Besucherinformation des Wien Museums</a> nennt ein laufendes, klar abgegrenztes Beispiel: Für alle unter 19 Jahren ist der Eintritt in alle Museen und Standorte frei. Ab 19 Jahren ist die Dauerausstellung „Wien. Meine Geschichte“ im Wien Museum kostenlos und ohne Ticket zugänglich; bei großem Andrang kann es Wartezeiten geben.</p><p>Zusätzlich nennt das Museum jeden ersten Sonntag im Monat freien Eintritt in Dauer- und Sonderausstellungen aller Standorte. Das ist kein täglicher Gratiszugang zu allen Ausstellungen. Prüfe vor dem Besuch deshalb den Standort, die Öffnungszeit und ob du in die Dauerausstellung oder eine Sonderausstellung möchtest. Die Quelle nennt für diese Regelung kein kalendarisches Enddatum; sie wird hier als laufend, nicht als dauerhaft garantiert behandelt.</p>`],
      ['probetraining', 'Probetraining: die Frist vor der Anmeldung prüfen', `<p>Ein kostenloses Probetraining ist nur dann kostenfrei, wenn du die Kündigungs- und Zahlungsregel verstanden hast. Die am 29. August 2026 geprüfte <a href="https://evofitness.at/de/7-tage-probetraining/" rel="noopener">EVO-Probetrainingseite</a> nennt ein konkretes laufendes Beispiel: Nach der Online-Anmeldung kommt der Zugangscode per SMS, der Zugang beginnt direkt mit der Anmeldung und gilt sieben Tage in den EVO Clubs.</p><p>Entscheidend ist der achte Tag: Laut EVO startet dann automatisch eine monatlich kündbare Mitgliedschaft. Wer nicht weitermachen möchte, muss über MyEVO bis zum Ende des siebten Tages kündigen; der Anmeldetag zählt bereits als erster Probetrainingstag. Die Anbieterseite nennt für die kostenlose Testwoche kein kalendarisches Aktionsende. Deshalb ist sie ein laufendes Beispiel und kein Deal mit zugesichertem Ablaufdatum.</p><div class="article-note"><strong>Vor dem Absenden notieren</strong>Speichere den Starttag, die Kündigungsfrist und den direkten Kündigungsweg. Setze eine Erinnerung spätestens einen Tag vor Ablauf der kostenlosen Probe – nicht erst am achten Tag.</div>`],
      ['anmeldung', 'Anmeldung, Kapazität und Folgekosten', `<p>„Kostenlos“ bedeutet nicht automatisch „ohne Reservierung“. Viele Führungen, Workshops und Schnupperstunden haben begrenzte Plätze. Bei Studios kommen oft Konto, Zugangscode und späteres Abo dazu. Prüfe vor der Anmeldung, ob ein Zahlungsmittel verlangt wird, wann die Testzeit beginnt und zu welchem Preis es nach der Probe weitergeht.</p><p>Beim am 29. August 2026 geprüften EVO-Angebot nennt der Anbieter für die Mitgliedschaft nach der Testphase einen Monatspreis von 49,90 Euro bis Ende November 2026 und danach 64,90 Euro monatlich. Dieser Preis betrifft die anschließende Mitgliedschaft, nicht die kostenlose Testwoche. Die jeweils aktuelle Anbieterinformation ist maßgeblich.</p>`],
      ['kombinieren', 'Freizeitangebote nach Bezirk kombinieren', `<p>Plane mehrere Aktivitäten in derselben Gegend und kontrolliere die Öffnungszeiten am Veranstaltungstag. Dadurch bleiben kostenlose Ausflüge auch bei ausgebuchten Programmpunkten flexibel. Kommerzielle Gratis- und Rabattaktionen mit eindeutigem Enddatum findest du ergänzend unter <a href="/angebote-wien-heute.html">Aktuelle Wien-Deals</a>.</p>`],
    ],
    faqs: [
      ['Was kann man in Wien kostenlos unternehmen?', 'Je nach Termin gibt es freie Kultur-, Natur-, Sport- und Veranstaltungsangebote sowie kostenlose Schnupperaktionen. Ein laufendes Beispiel ist die kostenlose Dauerausstellung „Wien. Meine Geschichte“ im Wien Museum; verbindliche Angaben liefert die jeweilige offizielle Stelle.'],
      ['Wann ist der Eintritt ins Wien Museum gratis?', 'Laut Wien Museum ist die Dauerausstellung „Wien. Meine Geschichte“ für alle kostenlos und ohne Ticket zugänglich. Unter 19-Jährige haben freien Eintritt an allen Standorten; außerdem ist am ersten Sonntag im Monat der Eintritt in Dauer- und Sonderausstellungen aller Standorte frei.'],
      ['Muss ich kostenlose Freizeitangebote reservieren?', 'Häufig ja, besonders bei Führungen, Workshops und Kursen mit begrenzter Kapazität. Die Reservierungsregel steht beim Veranstalter.'],
      ['Bedeutet freiwillige Spende automatisch freien Eintritt?', 'Nicht automatisch. Eine freiwillige Spende ist kein fixer Eintrittspreis, kann aber neben einer kostenlosen Teilnahme oder bei einem optionalen Zusatzangebot genannt sein. Prüfe immer, worauf sie sich bezieht.'],
      ['Sind kostenlose Probetrainings ohne Verpflichtung?', 'Nicht unbedingt. Beim aktuell geprüften EVO-Angebot beginnt am achten Tag automatisch eine Mitgliedschaft, wenn die Probe nicht bis zum Ende des siebten Tages über MyEVO gekündigt wird. Lies bei jedem Anbieter die aktuelle Kündigungs- und Zahlungsregel.'],
    ],
    related: [['Kostenlose Angebote in Wien', 'kostenlose-angebote-wien.html'], ['Geburtstag gratis in Wien', 'geburtstag-gratis-wien.html'], ['Studentenrabatte in Wien', 'studentenrabatte-wien.html'], ['Aktuelle Wien-Deals', '/angebote-wien-heute.html']],
  },
  {
    slug: 'gutscheine-wien',
    title: 'Gutscheine in Wien heute richtig einlösen',
    meta: 'Gutscheine in Wien heute prüfen: Quelle, Ablaufdatum, Filiale, Mindestumsatz und Kombinierbarkeit vor der Einlösung vergleichen.',
    eyebrow: 'Gutscheine Wien',
    headline: 'Gutscheine in Wien heute prüfen und ohne Überraschungen einlösen.',
    intro: 'Restaurantgutscheine, Rabattcodes und digitale Coupons können viel sparen. Dieser Tagescheck zeigt, ob ein Gutschein aktuell ist, in deiner Filiale gilt und zum geplanten Einkauf passt.',
    published: '2026-08-26', publishedLabel: '26. August 2026', modified: '2026-09-20', modifiedLabel: '20. September 2026',
    image: '/assets/current-ios/for-you.jpg', imageWidth: 736, imageHeight: 1600, imagePosition: 'center 41%',
    imageAlt: 'FreeFinder Empfehlungen mit Wiener Gutscheinen, Gratis-Angeboten und Rabatten',
    sections: [
      ['arten', 'Welche Gutscheinarten gibt es?', `<p>Wer nach <strong>Gutscheinen in Wien</strong> sucht, trifft auf Wertgutscheine, Prozentcoupons, Gratisartikel, 1+1-Aktionen und App-Angebote. Sie sehen ähnlich aus, funktionieren aber unterschiedlich. Ein Wertgutschein reduziert den Preis um einen festen Betrag, während ein Prozentcoupon nur für ausgewählte Produkte oder bis zu einer Obergrenze gelten kann.</p><ul><li><strong>Wertgutschein:</strong> Ein fixer Betrag wird vom Einkauf abgezogen.</li><li><strong>Rabattcoupon:</strong> Ein Prozentsatz gilt für bestimmte Artikel oder den Warenkorb.</li><li><strong>Gratiscoupon:</strong> Ein Produkt ist kostenlos, manchmal erst nach einem zusätzlichen Kauf.</li><li><strong>1+1-Gutschein:</strong> Beim Kauf eines Artikels ist ein zweiter gleichwertiger oder günstigerer Artikel gratis.</li><li><strong>App-Gutschein:</strong> Der Coupon muss in einem Kundenkonto aktiviert und digital eingelöst werden.</li></ul>`],
      ['quelle', 'Quelle, Zeitraum und Wiener Filiale prüfen', `<p>Öffne den Gutschein immer über die offizielle Website, App, E-Mail oder den verifizierten Social-Media-Kanal des Anbieters. Kontrolliere Start- und Enddatum sowie mögliche Uhrzeiten. Ein alter Screenshot ohne Link und sichtbaren Gültigkeitszeitraum ist keine verlässliche Einlösegrundlage.</p><p>Bei Ketten kann ein Coupon nur in teilnehmenden Filialen gelten. Suche in den Bedingungen nach Standort, Postleitzahl, Liefergebiet und Einlöseart. „In Wien gültig“ bedeutet nicht automatisch, dass jede Wiener Filiale teilnimmt.</p>`],
      ['wert', 'Die echte Ersparnis berechnen', `<p>Vergleiche den Endpreis statt nur die beworbene Ersparnis. Mindestumsatz, Lieferkosten, Servicegebühren, ausgeschlossene Produkte und ein notwendiger Zusatzkauf können den Wert deutlich verändern. Ein 10-Euro-Gutschein ab 40 Euro spart nur dann sinnvoll Geld, wenn du den Warenkorb ohnehin geplant hattest.</p><div class="article-note"><strong>Einfacher Deal-Check</strong>Notiere den regulären Gesamtpreis, ziehe den Gutschein ab und addiere alle Gebühren. Vergleiche dieses Ergebnis mit einer realistischen Alternative ohne Coupon.</div>`],
      ['heute', 'Gutschein heute prüfen: Quelle, Frist, Kombination', `<p>Öffne vor der Einlösung die offizielle App, E-Mail oder Website des Anbieters. Prüfe Start- und Endzeit, die teilnehmende Wiener Filiale sowie die richtige Bestellart. Ein Gutschein kann noch sichtbar sein, obwohl das Tageskontingent ausgeschöpft ist oder ein Einlösefenster bereits begonnen hat.</p><p>Kontrolliere außerdem, ob der Coupon mit anderen Rabatten, Treuepunkten oder Mittagsangeboten kombinierbar ist. Fehlt eine ausdrückliche Erlaubnis, solltest du nicht von einer Kombination ausgehen. Bei Onlinebestellungen ist der angezeigte Endpreis im Warenkorb die entscheidende Kontrolle.</p>`],
      ['einloesen', '30-Sekunden-Check vor dem Einlösen', `<ol><li>Ist der Gutschein noch gültig und stammt er von einer offiziellen Quelle?</li><li>Gilt er in der gewünschten Filiale oder für die gewählte Bestellart?</li><li>Sind Mindestumsatz, Neukundenregel und ausgeschlossene Produkte erfüllt?</li><li>Muss der Coupon vor der Bestellung aktiviert oder dem Personal gezeigt werden?</li><li>Wird die Ersparnis vor dem Bezahlen sichtbar abgezogen?</li></ol><p>Markiere einen Einmalcode erst als eingelöst, wenn die Einlösung tatsächlich beginnt. Bei Unsicherheit frage vor der Bestellung kurz nach, ob die Filiale den Gutschein akzeptiert.</p>`],
      ['aktuell', 'Aktuelle Coupons und Angebote entdecken', `<p>Auf der Seite <a href="/angebote-wien-heute.html">Aktuelle Angebote in Wien</a> bündelt FreeFinder ausgewählte Gratis- und Rabattaktionen mit erfasstem Enddatum. Für einzelne Couponarten helfen außerdem die Guides zu <a href="restaurant-gutscheine-wien.html">Restaurant-Gutscheinen</a> und <a href="app-gutscheine-wien.html">App-Gutscheinen in Wien</a>.</p><p>Prüfe vor jeder Einlösung trotzdem die Originalbedingungen. Anbieter können Kontingente ausschöpfen, Filialen ändern oder eine Aktion vor Ort anders kennzeichnen.</p>`],
    ],
    faqs: [
      ['Wo finde ich Gutscheine in Wien?', 'Nutze offizielle Anbieter-Apps, Newsletter, Websites und aktuelle lokale Deal-Übersichten. Kontrolliere bei jedem Treffer Datum, Wiener Filiale und die vollständigen Einlösebedingungen.'],
      ['Ist ein Gutschein dasselbe wie ein Geschenkgutschein?', 'Nein. Ein Aktionsgutschein oder Coupon gewährt einen Rabatt oder Gratisartikel. Ein Geschenkgutschein besitzt dagegen meist ein gekauftes Guthaben und folgt anderen Bedingungen.'],
      ['Wie prüfe ich, ob ein Gutschein heute noch gilt?', 'Öffne die aktuelle Originalquelle und kontrolliere Zeitraum, Filiale, Bestellweg, Mindestumsatz und Kombinierbarkeit. Bei Onlineangeboten prüfst du den rabattierten Endpreis im Warenkorb.'],
      ['Kann ich mehrere Gutscheine kombinieren?', 'Nur wenn der Anbieter dies ausdrücklich erlaubt. Viele Aktionen schließen die Kombination mit anderen Rabatten, Coupons oder Treuevorteilen aus.'],
    ],
    related: [['Restaurant-Gutscheine in Wien', 'restaurant-gutscheine-wien.html'], ['App-Gutscheine in Wien', 'app-gutscheine-wien.html'], ['1+1-Aktionen in Wien', 'eins-plus-eins-wien.html'], ['Rabatte in Wien', 'rabatte-wien.html'], ['Aktuelle Wien-Deals', '/angebote-wien-heute.html']],
  },
  {
    slug: 'restaurant-gutscheine-wien',
    title: 'Restaurant-Gutscheine in Wien heute nutzen',
    meta: 'Restaurant-Gutscheine in Wien heute prüfen: Filiale, Bestellweg, Mindestbestellwert und Zusatzkosten vor der Einlösung vergleichen.',
    eyebrow: 'Restaurant-Gutscheine Wien',
    headline: 'Restaurant-Gutscheine in Wien heute sicher einlösen.',
    intro: 'Gratisgericht, 1+1-Menü oder fixer Gutscheinwert: Dieser Check trennt heute noch gültige Gastro-Coupons von alten Screenshots und zeigt, was an der Kassa tatsächlich zählt.',
    published: '2026-08-26', publishedLabel: '26. August 2026', modified: '2026-09-05', modifiedLabel: '5. September 2026',
    image: '/assets/current-ios/deals-home.jpg', imageWidth: 736, imageHeight: 1600,
    imageAlt: 'FreeFinder App mit Wiener Pizza-, Getränke- und Restaurantangeboten',
    sections: [
      ['formen', 'Welche Restaurant-Coupons gibt es?', `<p><strong>Restaurant-Gutscheine in Wien</strong> reichen von einem Gratisgetränk über Prozent- und Wertgutscheine bis zu 1+1-Menüs. Manche gelten für Speisen vor Ort, andere nur bei Abholung oder Lieferung. Geburtstags- und Neukundengutscheine können zusätzlich ein Kundenkonto oder eine vorherige Registrierung verlangen.</p><p>Unterscheide einen kostenlosen Artikel von einem Vorteil mit Kaufpflicht. „Gratis Dessert zum Hauptgericht“ ist ein Rabatt auf die gesamte Bestellung, aber kein vollständig kostenloser Restaurantbesuch.</p>`],
      ['filiale', 'Filiale, Reservierung und Bestellweg kontrollieren', `<p>Prüfe die konkrete Wiener Adresse. Franchise-Filialen können bei Aktionen unterschiedlich teilnehmen. Achte außerdem darauf, ob der Gutschein im Lokal, bei Abholung, auf der Restaurant-Website oder nur über eine bestimmte Liefer-App gilt.</p><p>Bei Reservierungen sollte der Gutschein bereits bei der Buchung erwähnt werden, wenn die Bedingungen dies verlangen. Kontrolliere Wochentage, Uhrzeiten, Tischgröße und mögliche Ausschlusstage. Ein Coupon für Montag bis Donnerstag funktioniert nicht automatisch an Feiertagen oder am Wochenende.</p>`],
      ['kosten', 'Mindestbestellwert und Zusatzkosten vergleichen', `<ul><li>Mindestbestellwert vor oder nach Abzug des Gutscheins</li><li>Liefer-, Service- und Verpackungsgebühren</li><li>Ausgeschlossene Getränke, Menüs oder Aktionsprodukte</li><li>Beschränkung auf einen Gutschein pro Tisch oder Rechnung</li><li>Trinkgeld, das nicht Teil des Gutscheinwerts ist</li></ul><p>Lege bei einer Onlinebestellung zuerst den geplanten Warenkorb an. Aktiviere dann den Gutschein und prüfe den zu zahlenden Gesamtbetrag. Nur dieser Wert zeigt die tatsächliche Ersparnis.</p>`],
      ['heute', 'Restaurant-Gutschein heute prüfen: drei Schritte', `<ol><li><strong>Originalquelle öffnen:</strong> Prüfe direkt in der Restaurant-App, im Newsletter oder auf der Anbieter-Website, ob der Coupon heute noch sichtbar ist.</li><li><strong>Einlöseweg abgleichen:</strong> Ein Online-Code gilt nicht automatisch im Lokal; ein Tischgutschein nicht zwingend bei Lieferung. Kontrolliere Filiale, Abholung, Lieferung oder Reservierung.</li><li><strong>Endpreis ansehen:</strong> Lege die geplante Bestellung an und prüfe vor dem Bezahlen, ob Gutschein, Mindestbestellwert und sämtliche Gebühren korrekt verrechnet sind.</li></ol><p>Ein alter Screenshot oder ein fremder Gutschein-Aggregator kann einen Deal nur sichtbar machen, aber nicht seine Gültigkeit bestätigen. Bei Aktionen ohne festes Enddatum gilt die aktuelle Originalquelle am Tag der Einlösung.</p><div class="article-note"><strong>Bei Geburtstags-Coupons</strong>Prüfe zusätzlich Voranmeldung, Ausweis und Begleitbedingungen. Der <a href="geburtstag-gratis-wien.html">Geburtstags-Guide für Wien</a> trennt echte Gratisleistungen von Vorteilen mit Kaufpflicht.</div>`],
      ['vorort', 'So klappt die Einlösung vor Ort', `<p>Zeige den Coupon vor der Bestellung, wenn die Bedingungen keinen späteren Zeitpunkt nennen. Frage kurz, ob die Filiale teilnimmt und welche Gerichte eingeschlossen sind. Bei digitalen Einmalcodes sollte die Aktivierung erst erfolgen, wenn das Personal bereit ist, den Code zu erfassen.</p><div class="article-note"><strong>Vor dem Bestellen</strong>Restaurant, Adresse, Gültigkeitstag, Einlöseart und ausgeschlossene Speisen einmal gemeinsam bestätigen lassen. Das dauert weniger als eine Minute und verhindert Diskussionen beim Bezahlen.</div>`],
      ['finden', 'Passende Gastro-Angebote in Wien finden', `<p>Aktuelle Gratisessen-, Pizza-, Kaffee- und Rabattaktionen können auf <a href="/angebote-wien-heute.html">FreeFinders heutiger Wien-Übersicht</a> erscheinen. Für die grundsätzliche Prüfung hilft der zentrale Guide zu <a href="gutscheine-wien.html">Gutscheinen in Wien</a>; 2-für-1-Angebote werden im Guide zu <a href="eins-plus-eins-wien.html">1+1-Aktionen</a> genauer erklärt.</p>`],
    ],
    faqs: [
      ['Gilt ein Restaurant-Gutschein in jeder Wiener Filiale?', 'Nicht unbedingt. Bei Ketten und Franchise-Betrieben können nur ausgewählte Standorte teilnehmen. Die konkrete Adresse muss in den Bedingungen oder direkt beim Restaurant bestätigt werden.'],
      ['Wie prüfe ich, ob ein Restaurant-Gutschein heute noch gilt?', 'Öffne die aktuelle Originalquelle des Restaurants oder der App und kontrolliere Zeitraum, Wiener Filiale, Einlöseweg sowie Mindestbestellwert. Ein Screenshot oder Aggregator ersetzt diese Prüfung nicht.'],
      ['Kann ich Restaurant-Gutscheine mit anderen Rabatten kombinieren?', 'Meist nur, wenn die Aktion dies ausdrücklich erlaubt. Häufig sind weitere Coupons, Mittagsmenüs oder bereits reduzierte Speisen ausgeschlossen.'],
      ['Gelten Restaurant-Gutscheine auch bei Lieferung?', 'Nur wenn Lieferung als Einlöseart genannt ist. Lieferplattform, Mindestbestellwert und zusätzliche Gebühren können sich von der Einlösung im Lokal unterscheiden.'],
    ],
    related: [['Gutscheine in Wien', 'gutscheine-wien.html'], ['Gratis Essen in Wien', 'gratis-essen-wien.html'], ['Geburtstag gratis in Wien', 'geburtstag-gratis-wien.html'], ['1+1-Aktionen in Wien', 'eins-plus-eins-wien.html'], ['Aktuelle Wien-Deals', '/angebote-wien-heute.html']],
  },
  {
    slug: 'app-gutscheine-wien',
    title: 'App-Gutscheine in Wien heute sicher nutzen',
    meta: 'App-Gutscheine in Wien heute nutzen: Aktivierung, Ablaufdatum, Filiale und Einlösefenster vor dem Bezahlen zuverlässig prüfen.',
    eyebrow: 'App-Gutscheine Wien',
    headline: 'App-Gutscheine in Wien heute aktivieren, ohne den Coupon zu früh zu verbrauchen.',
    intro: 'Digitale Coupons können an Konto, Standort, Gerät oder ein kurzes Einlösefenster gebunden sein. Dieser Tagescheck begleitet dich von der aktuellen Angebotsansicht bis zur Kassa.',
    published: '2026-08-26', publishedLabel: '26. August 2026', modified: '2026-09-20', modifiedLabel: '20. September 2026',
    image: '/og-preview-stores.png', imageWidth: 1200, imageHeight: 630,
    imageAlt: 'FreeFinder für iPhone und Android mit lokalen Wiener Angeboten',
    sections: [
      ['funktion', 'So funktionieren digitale Coupons', `<p><strong>App-Gutscheine in Wien</strong> werden häufig einem Kundenkonto zugeordnet. Manche erscheinen automatisch, andere müssen vor dem Einkauf gespeichert oder aktiviert werden. Die Einlösung erfolgt per QR-Code, Barcode, Zahlencode, Bestelllink oder direkt im Warenkorb.</p><p>Prüfe, ob der Coupon nur für Neukunden, ein bestimmtes Gerät oder eine ausgewählte Zahlungsart gilt. Auch ein sichtbarer Gutschein kann noch zusätzliche Bedingungen haben, die erst in der Detailansicht stehen.</p>`],
      ['aktivieren', 'Aktivieren ist nicht immer Einlösen', `<p>Bei manchen Apps bleibt ein aktivierter Coupon bis zum Enddatum verfügbar. Andere starten nach einem Tipp ein kurzes Einlösefenster oder markieren den Vorteil sofort als benutzt. Lies deshalb den Buttontext und die Hinweise, bevor du ihn antippst.</p><div class="article-note"><strong>Einmalcode schützen</strong>Öffne einen zeitlich begrenzten QR- oder Zahlencode erst an der Kassa oder wenn das Personal dazu auffordert. Ein abgelaufener Bildschirm lässt sich möglicherweise nicht erneut erzeugen.</div>`],
      ['konto', 'Konto, App und Berechtigungen prüfen', `<p>Lade die App nur aus dem offiziellen App Store oder Google Play Store und kontrolliere den Herausgeber. Für digitale Gutscheine können E-Mail-Bestätigung, Telefonnummer oder Mitgliedsstatus nötig sein. Gib keine Zugangsdaten über fremde Gutscheinseiten oder Direktnachrichten ein.</p><p>Prüfe vor der Registrierung die Datenschutzangaben und entscheide bewusst über Newsletter, Push-Mitteilungen und Standortzugriff. Ein Standort kann für Filialangebote hilfreich sein, sollte aber nur freigegeben werden, wenn die Funktion ihn nachvollziehbar benötigt.</p>`],
      ['technik', 'Vor der Kassa technisch vorbereitet sein', `<ol><li>App aktualisieren und erneut anmelden, solange eine stabile Verbindung besteht.</li><li>Gewünschte Filiale und Gültigkeitszeitraum kontrollieren.</li><li>Displayhelligkeit erhöhen, damit Bar- oder QR-Code lesbar ist.</li><li>Den Coupon noch nicht als eingelöst markieren.</li><li>Nach dem Scan prüfen, ob der Rabatt auf Bon oder Warenkorb erscheint.</li></ol><p>Ein Screenshot kann hilfreich sein, wird aber bei dynamischen Codes oder Live-Timern oft nicht akzeptiert. Maßgeblich ist die Einlöseart des Anbieters.</p>`],
      ['heute', 'Heute einlösen: die letzte Prüfung vor dem Weg zur Filiale', `<p>Öffne den Gutschein kurz vor dem Aufbruch noch einmal in der offiziellen App. Prüfe dabei nicht nur das Ablaufdatum, sondern auch Filiale, Uhrzeit, Mindestbestellwert und ob der Vorteil bereits aktiviert werden muss. Ein Coupon kann weiterhin sichtbar sein, aber für den heutigen Zeitraum oder die gewählte Filiale gesperrt sein.</p><p>Bei einer Onlinebestellung legst du den geplanten Warenkorb zuerst an und kontrollierst dann den angezeigten Endpreis. Bei der Einlösung vor Ort öffnest du einen dynamischen Code erst an der Kassa. So verhinderst du, dass ein Timer abläuft, bevor das Personal ihn scannen kann.</p>`],
      ['entdecken', 'Digitale Wien-Angebote vergleichen', `<p>FreeFinder bündelt ausgewählte lokale Deals und verweist zur jeweiligen Quelle. Öffne <a href="/angebote-wien-heute.html">aktuelle Angebote in Wien</a> und kontrolliere bei App-only-Aktionen die Originalbedingungen. Der Guide zu <a href="gutscheine-wien.html">Gutscheinen in Wien</a> hilft zusätzlich beim Vergleich von digitalem Coupon, Papiergutschein und Aktionscode.</p>`],
    ],
    faqs: [
      ['Kann ich einen App-Gutschein als Screenshot einlösen?', 'Nur wenn der Anbieter statische Codes oder Screenshots akzeptiert. Dynamische QR-Codes, Barcodes und laufende Einlösetimer müssen meist direkt in der App geöffnet werden.'],
      ['Warum ist mein App-Coupon verschwunden?', 'Mögliche Gründe sind Ablaufdatum, Einmalnutzung, ein gestartetes Einlösefenster, eine falsche Filiale oder ein anderes Kundenkonto. Prüfe zuerst Verlauf und Bedingungen in der offiziellen App.'],
      ['Wie prüfe ich, ob ein App-Gutschein heute gilt?', 'Öffne den Vorteil in der offiziellen App und kontrolliere Zeitraum, Filiale, Mindestbestellwert sowie den Einlöseweg. Sichtbarkeit allein ist keine Zusage für die heutige Nutzung.'],
      ['Braucht ein App-Gutschein Standortzugriff?', 'Nicht immer. Manche Apps nutzen den Standort zur Filialauswahl. Prüfe die Begründung und erlaube nur Berechtigungen, die für die gewünschte Funktion nachvollziehbar sind.'],
    ],
    related: [['Gutscheine in Wien', 'gutscheine-wien.html'], ['Restaurant-Gutscheine in Wien', 'restaurant-gutscheine-wien.html'], ['1+1-Aktionen in Wien', 'eins-plus-eins-wien.html'], ['Rabatte in Wien', 'rabatte-wien.html'], ['Aktuelle Wien-Deals', '/angebote-wien-heute.html']],
  },
  {
    slug: 'magenta-moments-kino-1plus1-wien',
    title: 'Magenta Moments: 1+1 Kino in Wien',
    meta: 'Magenta Moments 1+1 Kino in Wien: Kinotickets am Dienstag zum Vorteilspreis sichern, Voraussetzungen prüfen und den Coupon in der MeinMagenta App einlösen.',
    eyebrow: 'Magenta Moments Wien',
    headline: '1+1 Kino in Wien mit Magenta Moments richtig nutzen.',
    intro: 'Magenta nennt in seiner Vorteilswelt ein 1+1-Kinoangebot für Dienstag. So prüfst du als Magenta-Kund:in Verfügbarkeit, Preis und Einlösung in der MeinMagenta App.',
    published: '2026-08-31', publishedLabel: '31. August 2026', modified: '2026-08-31', modifiedLabel: '31. August 2026',
    image: '/assets/current-ios/deals-home.jpg', imageAvif: '/assets/current-ios/deals-home-400.avif 400w, /assets/current-ios/deals-home-736.avif 736w', imageWidth: 736, imageHeight: 414,
    imageAlt: 'FreeFinder App mit Wiener Freizeit- und Rabattangeboten',
    sections: [
      ['voraussetzungen', 'Wer kann Magenta Moments nutzen?', `<p>Das Angebot richtet sich an <strong>Magenta-Kund:innen</strong> und ist laut offizieller Magenta-Seite Teil der Vorteilswelt in der MeinMagenta App. Ein allgemeiner Kinogutschein für alle Besucher:innen ist es daher nicht.</p><p>Prüfe vor dem Kinobesuch, ob dein Vertrag für Magenta Moments freigeschaltet ist und welche Detailbedingungen in der App beim konkreten Angebot angezeigt werden.</p>`],
      ['dienstag', '1+1 Kino am Dienstag', `<p>Magenta bewirbt in der Vorteilswelt <strong>jeden Dienstag Kinotickets 1 + 1 gratis</strong>. Die offizielle Übersichtsseite nennt als Beispiel einen Vorteilspreis von 11,50 Euro statt 23 Euro für zwei Tickets. Maßgeblich sind immer der aktuell angezeigte Preis, das ausgewählte Kino und die Bedingungen in der MeinMagenta App.</p><div class="article-note"><strong>Keine pauschale Zusage</strong>Verfügbarkeit, teilnehmende Kinos und Vorstellungszeiten können sich ändern. Öffne den Vorteil am selben Tag vor dem Kauf erneut.</div>`],
      ['einloesen', 'So löst du den Vorteil ein', `<ol><li>MeinMagenta App öffnen und Magenta Moments auswählen.</li><li>Das aktuelle Kinoangebot und den Dienstagstermin prüfen.</li><li>Teilnehmendes Kino, Vorstellung und mögliche Zuschläge kontrollieren.</li><li>Den Coupon erst unmittelbar vor der Einlösung aktivieren.</li><li>Vor dem Bezahlen prüfen, ob der 1+1-Vorteil korrekt angezeigt wird.</li></ol><p>Speichere keinen Screenshot als Ersatz, wenn die App einen dynamischen Code oder eine direkte Buchung verlangt.</p>`],
      ['quelle', 'Offizielle Quelle prüfen', `<p>Die <a href="https://www.magenta.at/magenta-moments" rel="noopener">offizielle Magenta-Moments-Seite</a> beschreibt die Vorteilswelt und verweist für die konkreten Angebote auf die MeinMagenta App. FreeFinder übernimmt deshalb keine nicht bestätigten Kino- oder Terminangaben.</p><p>Weitere aktuelle Angebote in Wien findest du in der <a href="/angebote-wien-heute.html">FreeFinder-Übersicht</a>.</p>`],
    ],
    faqs: [
      ['Ist das Magenta-Moments-Kinoangebot für alle verfügbar?', 'Nein. Es ist eine Vorteilswelt für Magenta-Kund:innen. Die konkrete Teilnahme und die Bedingungen stehen in der MeinMagenta App.'],
      ['An welchem Tag gilt das 1+1-Kinoangebot?', 'Die offizielle Magenta-Übersicht bewirbt das Angebot für Dienstag. Prüfe vor dem Kauf trotzdem die aktuelle Detailseite in der App.'],
      ['Kann ich jedes Kino in Wien auswählen?', 'Nicht automatisch. Teilnehmende Kinos, Vorstellungen und mögliche Zuschläge werden beim jeweiligen Angebot festgelegt.'],
    ],
    related: [['App-Gutscheine in Wien', 'app-gutscheine-wien.html'], ['Gutscheine in Wien', 'gutscheine-wien.html'], ['Kostenlose Freizeitangebote in Wien', 'kostenlose-freizeitangebote-wien.html'], ['Aktuelle Wien-Deals', '/angebote-wien-heute.html']],
  },
  {
    slug: 'gratis-pizza-wien-laziz-food',
    title: 'Gratis Pizza in Wien ab 20 Euro bei Wiener Laziz Food',
    meta: 'Gratis Pizza in Wien: Wiener Laziz Food bietet eine Pizza Margherita ab 20 Euro Bestellwert. Adresse, Öffnungszeiten und Bedingungen im Überblick.',
    eyebrow: 'Gratis Pizza Wien',
    headline: 'Gratis Pizza in Wien ab 20 Euro Bestellwert.',
    intro: 'Wiener Laziz Food weist auf der eigenen Website eine kostenlose Pizza Margherita ab 20 Euro Bestellwert aus. Hier findest du die bestätigten Bedingungen für den Standort in Meidling.',
    published: '2026-08-31', publishedLabel: '31. August 2026', modified: '2026-08-31', modifiedLabel: '31. August 2026',
    image: '/assets/current-ios/deals-home.jpg', imageAvif: '/assets/current-ios/deals-home-400.avif 400w, /assets/current-ios/deals-home-736.avif 736w', imageWidth: 736, imageHeight: 414,
    imageAlt: 'FreeFinder App mit kostenlosen Food-Angeboten in Wien',
    sections: [
      ['angebot', 'So funktioniert die Gratis-Pizza-Aktion', `<p>Auf der offiziellen Website von <strong>Wiener Laziz Food</strong> steht: Ab einem Bestellwert von 20 Euro erhältst du eine Pizza Margherita gratis dazu. Der Mindestbestellwert bezieht sich auf die Bestellung beim Restaurant.</p><p>Die Aktion ist damit ein Gratisartikel ab Kauf, kein vollständig kostenloser Restaurantbesuch. Prüfe vor der Bestellung, ob die Aktion noch aktiv ist und wie sie bei deiner Bestellart angewendet wird.</p>`],
      ['standort', 'Adresse und Öffnungszeiten in Wien', `<p>Der auf der Anbieterwebsite genannte Standort liegt in der <strong>Ratschkygasse 22, 1120 Wien</strong>. Als Öffnungszeiten werden Montag bis Sonntag von 11:00 bis 22:00 Uhr angegeben.</p><p>Bei Lieferung oder Bestellung über einen Drittanbieter können Mindestbestellwert, Liefergebiet und Gebühren abweichen. Frage bei Unsicherheit kurz beim Restaurant nach.</p>`],
      ['bestellen', 'Vor dem Bezahlen prüfen', `<ol><li>Bestellwert von mindestens 20 Euro erreichen.</li><li>Kontrollieren, ob die Pizza Margherita als Gratisartikel ergänzt wird.</li><li>Liefer-, Service- oder Verpackungsgebühren zum Endpreis addieren.</li><li>Bei Abholung oder Lieferung die konkrete Bestellbestätigung prüfen.</li><li>Bei fehlender Gratispizza vor dem Bezahlen das Restaurant kontaktieren.</li></ol>`],
      ['quelle', 'Offizielle Restaurantquelle', `<p>Die Angaben stammen direkt von der <a href="https://wienerlazizfood.com/" rel="noopener">offiziellen Website von Wiener Laziz Food</a>. Dort werden neben der Gratispizza ab 20 Euro auch weitere Specials genannt. Da kein fixes Enddatum ausgewiesen ist, solltest du die Verfügbarkeit am selben Tag erneut prüfen.</p><p>Weitere kostenlose Food-Angebote in Wien findest du unter <a href="/angebote-wien-heute.html">Aktuelle Wien-Deals</a> und im Guide <a href="gratis-essen-wien.html">Gratis essen in Wien</a>.</p>`],
    ],
    faqs: [
      ['Ab welchem Bestellwert gibt es die Pizza gratis?', 'Laut der offiziellen Restaurantwebsite ab einem Bestellwert von 20 Euro. Prüfe die Aktion vor der Bestellung erneut.'],
      ['Welche Pizza ist gratis?', 'Die Website nennt eine Pizza Margherita als Gratisartikel. Andere Pizzen sind nicht automatisch eingeschlossen.'],
      ['Gilt die Aktion auch bei Lieferung?', 'Das muss für die konkrete Bestellart bestätigt werden. Liefergebiet und zusätzliche Gebühren können abweichen.'],
    ],
    related: [['Gratis Essen in Wien', 'gratis-essen-wien.html'], ['Restaurant-Gutscheine in Wien', 'restaurant-gutscheine-wien.html'], ['1+1-Aktionen in Wien', 'eins-plus-eins-wien.html'], ['Aktuelle Wien-Deals', '/angebote-wien-heute.html']],
  },
  {
    slug: 'duru-kebab-wien-wolt-rabatt',
    title: 'Duru Kebab Wien: 5 Euro Rabatt bei Wolt',
    meta: 'Duru Kebab in Wien bei Wolt: 5 Euro Rabatt ab 20 Euro Bestellwert, aktuelle Speisekarte, Einlösehinweise und Bedingungen prüfen.',
    eyebrow: 'Kebab Deal Wien',
    headline: '5 Euro Rabatt bei Duru Kebab in Wien.',
    intro: 'Die offizielle Wolt-Seite führt Duru in Wien mit einem 5-Euro-Rabatt ab 20 Euro Bestellwert. Hier findest du den aktuellen Stand und die wichtigsten Hinweise vor der Bestellung.',
    published: '2026-09-23', publishedLabel: '23. September 2026', modified: '2026-09-23', modifiedLabel: '23. September 2026',
    image: '/assets/current-ios/deals-home.jpg', imageAvif: '/assets/current-ios/deals-home-400.avif 400w, /assets/current-ios/deals-home-736.avif 736w', imageWidth: 736, imageHeight: 414,
    imageAlt: 'FreeFinder App mit Kebab- und Food-Angeboten in Wien',
    sections: [
      ['rabatt', 'Was bietet Duru aktuell bei Wolt?', `<p>Auf der <a href="https://wolt.com/en/aut/vienna/240430_vie_itemdeals-all" rel="noopener">offiziellen Wolt-Dealübersicht für Wien</a> ist Duru mit <strong>5 Euro Rabatt ab 20 Euro Bestellwert</strong> gelistet. Das ist ein Rabatt auf eine Bestellung und kein kostenloser Kebab.</p><p>Die konkrete Darstellung kann von Konto, Liefergebiet, Uhrzeit und verfügbaren Kampagnen abhängen. Entscheidend ist, ob der Rabatt im Warenkorb tatsächlich angezeigt wird.</p>`],
      ['angebot', 'Duru-Speisekarte und Kebab-Preise', `<p>Die offizielle Duru-Seite bei Wolt führt unter anderem Duru Kebap, Duru Dürüm, Adana Dürüm und weitere Gerichte. Die Preise und die Verfügbarkeit können sich ändern; sie werden erst in der Wolt-Bestellung verbindlich angezeigt.</p><p>Der Rabatt gilt laut Dealübersicht ab 20 Euro Bestellwert. Liefer-, Service- oder Verpackungsgebühren können zusätzlich anfallen.</p>`],
      ['einloesen', 'So prüfst du den Rabatt', `<ol><li>Duru über die offizielle Wolt-Seite öffnen.</li><li>Lieferadresse oder Abholung auswählen.</li><li>Mindestens 20 Euro Warenwert erreichen.</li><li>Vor dem Bezahlen kontrollieren, ob 5 Euro abgezogen werden.</li><li>Endbetrag inklusive aller Gebühren prüfen.</li></ol><div class="article-note"><strong>Wichtig</strong>Der FreeFinder-App-Eintrag kann älter als die aktuelle Wolt-Darstellung sein. Maßgeblich ist der Rabatt, der im offiziellen Wolt-Warenkorb angezeigt wird.</div>`],
      ['quelle', 'Offizielle Quelle und Aktualität', `<p>Quelle ist die <a href="https://wolt.com/en/aut/vienna/240430_vie_itemdeals-all" rel="noopener">offizielle Wolt-Dealübersicht</a> sowie die <a href="https://wolt.com/en/aut/vienna/restaurant/duru-kebap" rel="noopener">Duru-Speisekarte bei Wolt</a>. Wolt weist für das Angebot kein fixes Enddatum aus. Prüfe Verfügbarkeit und Rabatt deshalb direkt vor der Bestellung erneut.</p><p>Weitere Kebab- und Food-Angebote findest du unter <a href="/angebote-wien-heute.html">Aktuelle Wien-Deals</a>.</p>`],
    ],
    faqs: [
      ['Wie viel Rabatt gibt es bei Duru Kebab?', 'Die offizielle Wolt-Dealübersicht zeigt aktuell 5 Euro Rabatt ab 20 Euro Bestellwert.'],
      ['Ist der Kebab gratis?', 'Nein. Es handelt sich um 5 Euro Rabatt auf eine Bestellung ab 20 Euro, nicht um einen kostenlosen Kebab.'],
      ['Gilt der Rabatt immer?', 'Wolt weist kein fixes Enddatum aus. Konto, Liefergebiet und Warenkorb können die Verfügbarkeit beeinflussen.'],
    ],
    related: [['Gratis Pizza in Wien', 'gratis-pizza-wien-laziz-food.html'], ['Gratis Essen in Wien', 'gratis-essen-wien.html'], ['Restaurant-Gutscheine in Wien', 'restaurant-gutscheine-wien.html'], ['Aktuelle Wien-Deals', '/angebote-wien-heute.html']],
  },
  {
    slug: 'gratis-heissgetraenk-ikea-wien',
    title: 'Gratis Heißgetränk bei IKEA in Wien mit IKEA Family',
    meta: 'Gratis Heißgetränk bei IKEA in Wien: IKEA Family Mitglieder erhalten Kaffee, Tee oder heiße Schokolade im Restaurant. Voraussetzungen und Ablauf.',
    eyebrow: 'Gratis Kaffee Wien',
    headline: 'Gratis Kaffee, Tee oder heiße Schokolade bei IKEA.',
    intro: 'IKEA Österreich lädt IKEA Family Mitglieder bei jedem Besuch im Einrichtungshaus auf ein Heißgetränk im Restaurant ein. So funktioniert der kostenlose Vorteil in Wien.',
    published: '2026-09-01', publishedLabel: '1. September 2026', modified: '2026-09-01', modifiedLabel: '1. September 2026',
    image: '/assets/blog/omv-viva-eiskaffee-gratis.jpg', imageAvif: '/assets/blog/omv-viva-eiskaffee-gratis-800.avif 800w, /assets/blog/omv-viva-eiskaffee-gratis-1600.avif 1600w', imageWidth: 1600, imageHeight: 900,
    imageAlt: 'Heißgetränk als Beispiel für einen kostenlosen Kaffeevorteil in Wien',
    sections: [
      ['vorteil', 'Was ist bei IKEA gratis?', `<p>Als <strong>IKEA Family Mitglied</strong> erhältst du laut IKEA Österreich bei jedem Besuch im Einrichtungshaus ein Heißgetränk im Restaurant kostenlos. Genannt werden Kaffee, Tee und heiße Schokolade.</p><p>Der Vorteil gilt für das Getränk im IKEA-Restaurant. Er ist kein allgemeiner Rabatt auf den gesamten Einkauf und kann nicht automatisch auf andere Speisen oder To-go-Produkte übertragen werden.</p>`],
      ['voraussetzungen', 'Welche Voraussetzung gibt es?', `<p>Du brauchst eine kostenlose IKEA Family Mitgliedschaft und musst deine digitale oder physische Karte an der Restaurantkasse vorzeigen. Die Mitgliedschaft kannst du direkt über IKEA Österreich anmelden oder in der IKEA App verwalten.</p><div class="article-note"><strong>Verfügbarkeit beachten</strong>IKEA weist darauf hin, dass Vorteile nach Datum, Saison und Region variieren können. Prüfe deshalb vor dem Besuch die aktuelle Vorteilseite und das gewünschte Wiener Einrichtungshaus.</div>`],
      ['wien', 'IKEA-Standorte in und rund um Wien prüfen', `<p>Öffne vor der Fahrt die offizielle Standortseite des gewünschten Einrichtungshauses und kontrolliere Restaurantöffnungszeiten sowie eventuelle Hinweise zur Ausgabe. Die konkrete Verfügbarkeit kann vom Restaurantbetrieb und der Tagesauslastung abhängen.</p><p>Weitere aktuelle Gratis- und Rabattaktionen in Wien findest du in der <a href="/angebote-wien-heute.html">FreeFinder-Übersicht</a> und im Guide <a href="gratis-kaffee-wien.html">Gratis Kaffee in Wien</a>.</p>`],
      ['einloesen', 'So löst du den Vorteil ein', `<ol><li>IKEA Family Karte in der App öffnen oder Karte bereithalten.</li><li>Im IKEA-Restaurant ein Heißgetränk auswählen.</li><li>Die Karte vor dem Bezahlen an der Kasse vorzeigen.</li><li>Prüfen, ob der Getränkepreis auf null gesetzt wird.</li><li>Bei Unklarheiten vor der Bestellung kurz beim Restaurant nachfragen.</li></ol>`],
      ['quelle', 'Offizielle IKEA-Quelle', `<p>Die Angaben stammen direkt aus den <a href="https://www.ikea.com/at/de/ikea-family/benefits/" rel="noopener">IKEA Family Vorteilen Österreich</a>. Dort nennt IKEA den kostenlosen Kaffee, Tee oder die heiße Schokolade und weist auf mögliche regionale oder zeitliche Änderungen hin.</p>`],
    ],
    faqs: [
      ['Wer bekommt das gratis Heißgetränk bei IKEA?', 'IKEA Family Mitglieder erhalten den Vorteil beim Besuch im Einrichtungshaus. Die Karte muss an der Restaurantkasse vorgezeigt werden.'],
      ['Welche Getränke sind gratis?', 'IKEA nennt Kaffee, Tee und heiße Schokolade als kostenlose Heißgetränke. Die aktuelle Auswahl kann je Standort variieren.'],
      ['Muss ich etwas kaufen?', 'Die offizielle Vorteilbeschreibung nennt den Besuch im Einrichtungshaus und die IKEA-Family-Karte, aber keinen verpflichtenden zusätzlichen Einkauf. Prüfe die aktuelle Ausgabe vor Ort.'],
    ],
    related: [['Gratis Kaffee in Wien', 'gratis-kaffee-wien.html'], ['Kostenlose Angebote in Wien', 'kostenlose-angebote-wien.html'], ['Gratis Essen in Wien', 'gratis-essen-wien.html'], ['Aktuelle Wien-Deals', '/angebote-wien-heute.html']],
  },
  {
    slug: 'ikea-1-euro-fruehstueck-wien',
    title: '1-Euro-Frühstück bei IKEA in Wien',
    meta: '1-Euro-Frühstück bei IKEA in Wien: Freitag und Samstag bis 10:30 Uhr, aktuelle Laufzeit, teilnehmende Restaurants und Bedingungen im Überblick.',
    eyebrow: 'Günstiges Frühstück Wien',
    headline: 'Frühstück um 1 Euro bei IKEA in Wien.',
    intro: 'IKEA Österreich bietet ein Frühstück um 1 Euro an. Hier stehen die bestätigten Zeiten, die Laufzeit und die Bedingungen für deinen Besuch im IKEA-Restaurant.',
    published: '2026-09-13', publishedLabel: '13. September 2026', modified: '2026-09-13', modifiedLabel: '13. September 2026',
    image: '/assets/blog/omv-viva-eiskaffee-gratis.jpg', imageAvif: '/assets/blog/omv-viva-eiskaffee-gratis-800.avif 800w, /assets/blog/omv-viva-eiskaffee-gratis-1600.avif 1600w', imageWidth: 1600, imageHeight: 900,
    imageAlt: 'Frühstück und Kaffee als Beispiel für ein günstiges Frühstück in Wien',
    sections: [
      ['angebot', 'Was kostet das IKEA-Frühstück?', `<p>Das Frühstück kostet laut der offiziellen IKEA-Angebotsseite <strong>1 Euro</strong> statt 2,99 Euro. IKEA beschreibt ein süßes oder herzhaftes Frühstück im Restaurant.</p><p>Der Vorteil ist ein günstiges Frühstücksangebot, kein vollständig kostenloses Essen. Bezahlt wird der ausgewählte Frühstücksartikel an der Restaurantkasse.</p>`],
      ['zeiten', 'Wann gilt das Angebot?', `<p>Das Angebot gilt laut IKEA ab dem 4. September 2026 jeweils <strong>Freitag und Samstag bis 10:30 Uhr</strong>, ab Restaurantöffnung. Die aktuelle Angebotsseite führt die Aktion bis auf Widerruf und in teilnehmenden IKEA-Restaurants in Österreich.</p><div class="article-note"><strong>Vor dem Losfahren prüfen</strong>Öffnungszeiten und Teilnahme können je Einrichtungshaus abweichen. Kontrolliere am selben Morgen die offizielle IKEA-Seite deines Standorts.</div>`],
      ['wien', 'IKEA-Standorte in Wien', `<p>Für Wien ist besonders die Standortseite von <a href="https://www.ikea.com/at/de/stores/wien-nord/" rel="noopener">IKEA Wien Nord</a> relevant. Dort werden Adresse, Restaurantzeiten und lokale Hinweise getrennt vom allgemeinen Angebot angezeigt.</p><p>Prüfe den Standort, die Restaurantöffnung und die verfügbare Frühstücksmenge. Das Angebot gilt nur, solange der Vorrat reicht und ist nicht mit anderen Aktionen kombinierbar.</p>`],
      ['check', 'Kurzer Check vor dem Besuch', `<ol><li>Freitag oder Samstag auswählen.</li><li>Vor 10:30 Uhr und innerhalb der Restaurantöffnungszeit ankommen.</li><li>Teilnahme des gewünschten IKEA-Restaurants prüfen.</li><li>1 Euro und mögliche weitere Speisen getrennt einplanen.</li><li>Vor dem Bezahlen kontrollieren, dass das richtige Frühstück berechnet wird.</li></ol><p>Weitere aktuelle Angebote findest du unter <a href="/angebote-wien-heute.html">Aktuelle Wien-Deals</a>.</p>`],
      ['quelle', 'Offizielle IKEA-Quelle', `<p>Die Angaben stammen aus der <a href="https://www.ikea.com/at/de/offers/" rel="noopener">offiziellen IKEA-Angebotsübersicht Österreich</a>. Sie nennt Preis, Wochentage, Uhrzeit, Laufzeit und den Hinweis auf teilnehmende Restaurants.</p>`],
    ],
    faqs: [
      ['An welchen Tagen gibt es das 1-Euro-Frühstück?', 'Laut IKEA gilt es jeweils Freitag und Samstag bis 10:30 Uhr, ab Restaurantöffnung.'],
      ['Ist das Frühstück komplett gratis?', 'Nein. Es kostet 1 Euro. Das zusätzlich mögliche IKEA-Family-Heißgetränk ist ein separater Vorteil.'],
      ['Gilt es in jedem IKEA in Wien?', 'Nur in teilnehmenden IKEA-Restaurants. Prüfe vor dem Besuch den konkreten Standort und die aktuelle Angebotsseite.'],
    ],
    related: [['Gratis Heißgetränk bei IKEA', 'gratis-heissgetraenk-ikea-wien.html'], ['Gratis Kaffee in Wien', 'gratis-kaffee-wien.html'], ['Gratis Essen in Wien', 'gratis-essen-wien.html'], ['Aktuelle Wien-Deals', '/angebote-wien-heute.html']],
  },
  {
    slug: 'open-house-wien-2026-gratis',
    title: 'Open House Wien 2026: kostenloser Eintritt',
    meta: 'Open House Wien 2026 kostenlos besuchen: Termine vom 25. bis 27. September, Öffnungszeiten und kostenlose Führungen im Überblick.',
    eyebrow: 'Kostenlose Freizeit Wien',
    headline: 'Open House Wien 2026: Gebäude kostenlos entdecken.',
    intro: 'Beim Open House Wien öffnen sich Gebäude, die sonst nicht frei zugänglich sind. Der Veranstalter nennt kostenlose Führungen vom 25. bis 27. September 2026.',
    published: '2026-09-13', publishedLabel: '13. September 2026', modified: '2026-10-05', modifiedLabel: '5. Oktober 2026',
    expires: '2026-09-27T17:00:00+02:00',
    image: '/assets/blog/wiener-feuerwehrfest-2026.png', imageWidth: 1672, imageHeight: 941,
    imageAlt: 'Markenfreies Symbolbild für kostenlose Architekturführungen in Wien',
    sections: [
      ['termine', 'Wann findet Open House Wien statt?', `<p>Open House Wien 2026 findet laut <a href="https://www.openhouse-wien.at/programm" rel="noopener">offiziellem Veranstalterprogramm</a> von <strong>25. bis 27. September 2026</strong> jeweils von 10:00 bis 17:00 Uhr statt.</p><p>Das Programm führt durch sehenswerte Gebäude und Freiräume in Wien. Die konkrete Auswahl und eventuelle Hinweise pro Ort solltest du vor dem Besuch auf der Veranstaltungsseite prüfen.</p>`],
      ['eintritt', 'Ist der Eintritt wirklich kostenlos?', `<p>Die offiziellen Informationen nennen kostenlose Besichtigungen und Führungen durch Volunteers oder Fachführer:innen. Ein Ticket oder eine Voranmeldung ist laut der Veranstaltungsbeschreibung nicht erforderlich.</p><div class="article-note"><strong>Ortsspezifische Regeln beachten</strong>Bei einzelnen Gebäuden können Kapazität, Treffpunkt oder Zugangshinweise abweichend geregelt sein. Prüfe das jeweilige Gebäude im aktuellen Programm.</div>`],
      ['planung', 'So planst du deinen Besuch', `<ol><li>Programm und teilnehmende Gebäude auswählen.</li><li>Adresse und Treffpunkt vorab speichern.</li><li>Öffnungszeit 10:00 bis 17:00 Uhr berücksichtigen.</li><li>Bei beliebten Führungen frühzeitig vor Ort sein.</li><li>Am Veranstaltungstag auf kurzfristige Hinweise achten.</li></ol><p>Weitere kostenlose Freizeitideen bündelt der <a href="kostenlose-freizeitangebote-wien.html">FreeFinder-Freizeitguide</a>.</p>`],
      ['quelle', 'Offizielle Veranstaltungsquelle', `<p>Quelle ist das <a href="https://www.openhouse-wien.at/programm" rel="noopener">offizielle Programm von Open House Wien</a>. FreeFinder übernimmt nur Termin, Uhrzeit und den dort bestätigten kostenlosen Eintritt.</p>`],
    ],
    faqs: [
      ['Wann ist Open House Wien 2026?', 'Von Freitag, 25. September, bis Sonntag, 27. September 2026, jeweils von 10:00 bis 17:00 Uhr.'],
      ['Brauche ich ein Ticket?', 'Die offizielle Veranstaltungsbeschreibung nennt kostenlose Besichtigungen ohne Voranmeldung. Prüfe dennoch die Hinweise des jeweiligen Gebäudes.'],
      ['Sind alle Gebäude geöffnet?', 'Teilnehmende Gebäude und Freiräume werden im offiziellen Programm veröffentlicht. Nicht jedes Gebäude in Wien nimmt automatisch teil.'],
    ],
    related: [['Kostenlose Freizeitangebote in Wien', 'kostenlose-freizeitangebote-wien.html'], ['Kostenlose Angebote in Wien', 'kostenlose-angebote-wien.html'], ['Aktuelle Wien-Deals', '/angebote-wien-heute.html']],
  },
  {
    slug: 'wien-meine-geschichte-gratis-eintritt',
    title: 'Wien. Meine Geschichte: gratis Museumseintritt',
    meta: 'Wien. Meine Geschichte kostenlos besuchen: Eintritt frei, Standort im Wien Museum und wichtige Hinweise für den Museumsbesuch.',
    eyebrow: 'Gratis Museum Wien',
    headline: 'Wien. Meine Geschichte: kostenlos ins Wien Museum.',
    intro: 'Die Dauerausstellung „Wien. Meine Geschichte“ ist laut offizieller Wien-Info kostenlos zugänglich. Hier findest du die wichtigsten Hinweise für deinen Besuch.',
    published: '2026-09-13', publishedLabel: '13. September 2026', modified: '2026-09-13', modifiedLabel: '13. September 2026',
    image: '/assets/blog/wiener-feuerwehrfest-2026.png', imageWidth: 1672, imageHeight: 941,
    imageAlt: 'Markenfreies Symbolbild für einen kostenlosen Museumsbesuch in Wien',
    sections: [
      ['ausstellung', 'Was ist kostenlos?', `<p>Die Ausstellung <strong>„Wien. Meine Geschichte“</strong> erzählt Wiens Geschichte von der Frühzeit bis zur Gegenwart auf mehreren Ebenen. Die offizielle Wien-Info führt den Eintritt als <strong>frei</strong> an.</p><p>Der kostenlose Eintritt bezieht sich auf die genannte Dauerausstellung. Sonderausstellungen, Veranstaltungen oder Zusatzangebote können eigenen Bedingungen folgen.</p>`],
      ['besuch', 'Was du vor dem Besuch prüfen solltest', `<p>Kontrolliere vor deiner Anreise den aktuellen Standort, die Öffnungszeiten und mögliche Hinweise des Wien Museums. Bei stark besuchten Zeiten können Einlassregeln oder Wartezeiten relevant sein.</p><div class="article-note"><strong>Eintritt frei heißt nicht automatisch alles gratis</strong>Shop, Gastronomie, Sonderveranstaltungen und kostenpflichtige Zusatzangebote sind vom freien Ausstellungseintritt getrennt.</div>`],
      ['planung', 'Kostenlosen Museumsbesuch planen', `<ol><li>Offizielle Ausstellungsseite öffnen.</li><li>Öffnungszeiten und Adresse prüfen.</li><li>Für die Anreise genug Zeit einplanen.</li><li>Bei Sonderausstellungen die Preisangaben separat lesen.</li><li>Aktuelle Hinweise am Besuchstag kontrollieren.</li></ol><p>Mehr kostenlose Freizeitangebote findest du im <a href="kostenlose-freizeitangebote-wien.html">FreeFinder-Guide für Wien</a>.</p>`],
      ['quelle', 'Offizielle Wien-Info', `<p>Die Angaben stammen aus der <a href="https://www.wien.info/de/aktuell/veranstaltungen/wien-meine-geschichte-934658" rel="noopener">offiziellen Veranstaltungskarte von Wien Info</a>, die die Ausstellung und den freien Eintritt beschreibt.</p>`],
    ],
    faqs: [
      ['Ist Wien. Meine Geschichte gratis?', 'Ja. Die offizielle Wien-Info führt den Eintritt zur genannten Ausstellung als frei an.'],
      ['Ist auch jede Sonderausstellung kostenlos?', 'Nicht automatisch. Sonderausstellungen und Zusatzangebote können eigene Preise und Bedingungen haben.'],
      ['Soll ich Öffnungszeiten vorher prüfen?', 'Ja. Öffnungszeiten und Einlasshinweise können sich ändern; die offizielle Seite ist dafür maßgeblich.'],
    ],
    related: [['Kostenlose Freizeitangebote in Wien', 'kostenlose-freizeitangebote-wien.html'], ['Produktproben in Wien', 'produktproben-wien.html'], ['Aktuelle Wien-Deals', '/angebote-wien-heute.html']],
  },
  {
    slug: 'filmsommer-moebelmuseum-wien-gratis',
    title: 'Filmsommer im Möbelmuseum Wien: Eintritt frei',
    meta: 'Filmsommer im Möbelmuseum Wien 2026: Archiv der kostenlosen Filmabende vom 24. Juli bis 5. September. Die Veranstaltungsreihe ist beendet.',
    eyebrow: 'Gratis Filmabend Wien',
    headline: 'Kostenlose Filmabende im Möbelmuseum Wien.',
    intro: 'Der Filmsommer im Möbelmuseum Wien war vom 24. Juli bis 5. September 2026 im Innenhof angekündigt. Das offizielle Museumsprogramm nennt freien Eintritt; die Veranstaltungsreihe ist beendet.',
    published: '2026-09-13', publishedLabel: '13. September 2026', modified: '2026-10-05', modifiedLabel: '5. Oktober 2026',
    expires: '2026-09-05T23:59:59+02:00',
    image: '/assets/blog/wiener-feuerwehrfest-2026.png', imageWidth: 1672, imageHeight: 941,
    imageAlt: 'Markenfreies Symbolbild für einen kostenlosen Filmabend in Wien',
    sections: [
      ['angebot', 'Was bot der Filmsommer?', `<p>Der Filmsommer im Möbelmuseum Wien war laut <a href="https://www.moebelmuseumwien.at/unser-programm/alle-termine/detail/filmsommer-im-moebelmuseum-wien" rel="noopener">offiziellem Museumsprogramm</a> eine Reihe von Filmabenden im Innenhof des Museums vom <strong>24. Juli bis 5. September 2026</strong>.</p><p>Der Besuch war laut Veranstaltungsbeschreibung kostenlos. Getränke, Snacks und andere Gastronomieangebote waren davon getrennt und nicht automatisch gratis.</p>`],
      ['termine', 'Historische Termine und Ort', `<p>Das Museumsprogramm nennt acht geplante Filmabende zwischen <strong>24. Juli und 5. September 2026</strong>, jeweils Freitag oder Samstag um <strong>20:00 Uhr</strong>. Die Termine am 25. Juli und 21. August sind dort als abgesagt gekennzeichnet.</p><p>Die letzten angekündigten Abende waren der 4. und 5. September 2026. Der Veranstaltungsort war das Möbelmuseum Wien. Diese Termine sind bereits vorbei; die Seite dokumentiert das historische Angebot.</p>`],
      ['planung', 'Aktuelle Filmabende finden', `<p>Die Filmabende dieser Reihe sind beendet. Prüfe für einen neuen Besuch das aktuelle Programm des Möbelmuseums und bestätige Termin, Eintritt und Einlassbedingungen beim Veranstalter.</p><p>Weitere kostenlose Kultur- und Freizeitangebote findest du unter <a href="/angebote-wien-heute.html">Aktuelle Wien-Deals</a>.</p>`],
      ['quelle', 'Offizielle Veranstaltungsquelle', `<p>Quelle ist das <a href="https://www.moebelmuseumwien.at/unser-programm/alle-termine/detail/filmsommer-im-moebelmuseum-wien" rel="noopener">offizielle Filmsommer-Programm des Möbelmuseums Wien</a>. Es bestätigt die Termine vom 24. Juli bis 5. September 2026 und den freien Eintritt.</p>`],
    ],
    faqs: [
      ['War der Filmsommer im Möbelmuseum gratis?', 'Ja. Das offizielle Museumsprogramm nennt freien Eintritt für die Reihe von 2026. Gastronomie und Zusatzangebote waren davon getrennt.'],
      ['Wann waren die Filmabende angekündigt?', 'Vom 24. Juli bis 5. September 2026 waren acht Abende jeweils Freitag oder Samstag um 20:00 Uhr geplant. Der 25. Juli und 21. August sind im Museumsprogramm als abgesagt gekennzeichnet.'],
      ['Kann ich diese Termine noch besuchen?', 'Nein. Die Veranstaltungsreihe von 2026 ist beendet. Prüfe neue Termine und Einlassbedingungen im aktuellen Museumsprogramm.'],
    ],
    related: [['Kostenlose Freizeitangebote in Wien', 'kostenlose-freizeitangebote-wien.html'], ['Kostenlose Angebote in Wien', 'kostenlose-angebote-wien.html'], ['Aktuelle Wien-Deals', '/angebote-wien-heute.html']],
  },
]];

function escapeHtml(value) {
  return String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function renderGuide(guide) {
  const canonical = `https://freefinder.at/blog/${guide.slug}.html`;
  const published = guide.published || PUBLISHED;
  const publishedLabel = guide.publishedLabel || PUBLISHED_LABEL;
  const expired = Boolean(guide.expires && Date.parse(guide.expires) < now);
  const statusBanner = guide.expires ? `<div class="deal-status-banner" data-deal-status-banner${expired ? '' : ' hidden'}><strong>Aktion beendet.</strong>Der angekündigte Aktionszeitraum ist vorbei. Dieser Artikel bleibt als Archiv online. Aktuelle Treffer findest du unter <a href="/angebote-wien-heute.html">Angebote in Wien heute</a>.</div>` : '';
  const readingMinutes = Math.max(5, Math.round(guide.sections.map((section) => section[2].replace(/<[^>]+>/g, ' ').split(/\s+/).length).reduce((a, b) => a + b, 0) / 170));
  const structuredData = {
    '@context': 'https://schema.org',
    '@graph': [
      {
        '@type': 'Article', headline: guide.title, description: guide.meta, datePublished: published, dateModified: guide.modified || published,
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
  const quickDealBlock = quickDeal(guide);
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
  <script defer src="/consent.js?v=7"></script>
${guide.expires ? '  <script defer src="deal-status.js"></script>\n' : ''}  <script type="application/ld+json">${JSON.stringify(structuredData)}</script>
</head>
<body${expired ? ' class="deal-is-expired"' : ''}>
  <!-- Generated by scripts/generate-topic-guides.mjs. -->
  <header class="site-header"><nav class="nav" aria-label="Hauptnavigation"><a class="brand" href="/"><img class="brand-mark" src="/icon-192.svg" alt="" width="38" height="38">FreeFinder</a><div class="nav-links"><a href="/angebote-wien-heute.html">Aktuelle Deals</a><a href="/blog/">Blog</a><a class="nav-download" href="/#download">App laden</a></div></nav></header>
  <main${guide.expires ? ` data-deal-page data-deal-expires="${escapeHtml(guide.expires)}"` : ''}>
    <header class="article-hero"><div class="hero-inner"><p class="eyebrow">${expired ? 'Aktion beendet' : escapeHtml(guide.eyebrow)}</p><h1>${escapeHtml(guide.headline)}</h1><p class="hero-copy">${escapeHtml(guide.intro)}</p><div class="article-meta"><span>Aktualisiert am ${guide.modifiedLabel || publishedLabel}</span><span>${readingMinutes} Minuten Lesezeit</span></div><div class="article-byline"><span>Von <a href="/about.html">FreeFinder Redaktion</a></span><span>Verantwortlich: Stefan Ataalla</span></div>${statusBanner}</div></header>
    <div class="article-layout">
      <article class="article-body">
${quickDealBlock ? `        ${quickDealBlock}\n` : ''}        <picture>${guide.imageAvif ? `<source type="image/avif" srcset="${guide.imageAvif}" sizes="(max-width: 860px) 100vw, 710px">` : ''}<img class="article-image" src="${guide.image}" alt="${escapeHtml(guide.imageAlt)}" width="${guide.imageWidth}" height="${guide.imageHeight}"${guide.imagePosition ? ` style="object-position:${escapeHtml(guide.imagePosition)}"` : ''} loading="eager" decoding="async"></picture>
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

const selectedSlugs = process.argv.slice(2);
const selectedGuides = guides.filter(g => selectedSlugs.length === 0 || selectedSlugs.includes(g.slug));
for (const guide of selectedGuides) {
  fs.writeFileSync(path.join(BLOG_DIR, `${guide.slug}.html`), polishHtml(renderGuide(guide), `blog/${guide.slug}.html`, now));
}

const sitemapPath = path.join(ROOT, 'docs', 'sitemap.xml');
let sitemap = fs.readFileSync(sitemapPath, 'utf8');
for (const guide of selectedGuides.filter((guide) => guide.modified)) {
  const url = `https://freefinder.at/blog/${guide.slug}.html`;
  const entryPattern = new RegExp(`(<loc>${url}</loc>\\s*<lastmod>)[^<]+(</lastmod>)`);
  if (!entryPattern.test(sitemap)) throw new Error(`Sitemap entry missing for ${guide.slug}`);
  sitemap = sitemap.replace(entryPattern, `$1${guide.modified}$2`);
}
fs.writeFileSync(sitemapPath, sitemap);

console.log(`Generated ${guides.length} SEO topic guides in docs/blog`);

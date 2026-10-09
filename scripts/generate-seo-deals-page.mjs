#!/usr/bin/env node
import fs from 'fs';
import { polishHtml } from './polish-website.mjs';
import path from 'path';
import { fileURLToPath } from 'url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const INPUT_PATH = path.join(ROOT, 'docs', 'deals.json');
const OUTPUT_PATH = path.join(ROOT, 'docs', 'angebote-wien-heute.html');
const SITEMAP_PATH = path.join(ROOT, 'docs', 'sitemap.xml');
const EXCLUDED_CATEGORIES = new Set(['events', 'flights', 'gottesdienste', 'kirche']);
const MAX_DEALS = 24;

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function safeUrl(value) {
  try {
    const url = new URL(String(value || ''));
    return url.protocol === 'https:' || url.protocol === 'http:' ? url.href : '';
  } catch (_) {
    return '';
  }
}

function safeId(value) {
  return String(value || 'deal')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 72) || 'deal';
}

function parseDate(value) {
  const timestamp = Date.parse(String(value || ''));
  return Number.isFinite(timestamp) ? new Date(timestamp) : null;
}

function formatDate(value) {
  const date = value instanceof Date ? value : parseDate(value);
  if (!date) return '';
  return new Intl.DateTimeFormat('de-AT', {
    day: '2-digit',
    month: 'long',
    year: 'numeric',
    timeZone: 'Europe/Vienna',
  }).format(date);
}

function formatExpiryDate(value) {
  const datePart = String(value || '').match(/^\d{4}-\d{2}-\d{2}/)?.[0];
  if (!datePart) return formatDate(value);
  return new Intl.DateTimeFormat('de-AT', {
    day: '2-digit',
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(new Date(`${datePart}T12:00:00Z`));
}

function dateOnly(value) {
  const date = value instanceof Date ? value : parseDate(value);
  return (date || new Date()).toLocaleDateString('en-CA', { timeZone: 'Europe/Vienna' });
}

function calendarDate(value) {
  const raw = String(value || '').trim();
  const match = raw.match(/^(\d{4}-\d{2}-\d{2})(?:$|T)/);
  if (!match || (raw.length > 10 && !parseDate(raw))) return '';
  const date = parseDate(`${match[1]}T12:00:00Z`);
  return date && date.toISOString().slice(0, 10) === match[1] ? match[1] : '';
}

function currentValidity(deal, now) {
  const today = dateOnly(now);
  const validOn = calendarDate(deal.validOn);
  const validFrom = calendarDate(deal.validFrom);
  const validUntil = calendarDate(deal.validUntil);
  // Invalid explicit dates cannot establish a current offer or its end date.
  if ([['validOn', validOn], ['validFrom', validFrom], ['validUntil', validUntil]]
    .some(([field, parsed]) => String(deal[field] || '').trim() && !parsed)) return null;
  if (validFrom && validFrom > today) return null;
  if (validOn) {
    if (validOn !== today) return null;
    return { expiryDate: parseDate(`${validOn}T12:00:00Z`), expiryRaw: validOn, expiryLabel: 'Gültig am' };
  }
  if (validUntil) {
    if (validUntil < today || (validFrom && validFrom > validUntil)) return null;
    return { expiryDate: parseDate(`${validUntil}T12:00:00Z`), expiryRaw: validUntil, expiryLabel: 'Gültig bis' };
  }
  const expiryDate = parseDate(deal.expires);
  if (!expiryDate || expiryDate.getTime() < now.getTime()) return null;
  return { expiryDate, expiryRaw: String(deal.expires || ''), expiryLabel: 'Gültig bis' };
}

function isFlightDeal(deal) {
  return /^flight-/i.test(String(deal.id || '')) || Boolean(deal.flight && typeof deal.flight === 'object');
}

function isViennaDeal(deal) {
  const signal = [deal.brand, deal.title, deal.description, deal.distance, deal.location, deal.address, deal.city]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
  return /\bwien\b|\bvienna\b/.test(signal);
}

function typeLabel(value) {
  const labels = { gratis: 'Gratis', bogo: '1+1', rabatt: 'Rabatt' };
  return labels[String(value || '').toLowerCase()] || 'Angebot';
}

function cleanTitle(value, brand) {
  let title = String(value || '')
    .replace(/https?:\/\/\S+/gi, ' ')
    .replace(/:[a-z0-9_+-]+:/gi, ' ')
    .replace(/@[a-z0-9._]+/gi, ' ')
    .replace(/#[^\s#]+/g, ' ')
    .replace(/\.{3,}/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  title = title
    .replace(/\bFree$/i, 'gratis')
    .replace(/(\d)€/g, '$1 €');
  const brandText = String(brand || '').trim();
  if (brandText && title.toLocaleLowerCase('de-AT').startsWith(brandText.toLocaleLowerCase('de-AT'))) {
    title = title.slice(brandText.length).replace(/^\s*(?:in Wien)?\s*[-:–]\s*/i, '').trim();
  }
  if (title.length > 108) {
    title = `${title.slice(0, 105).replace(/\s+\S*$/, '').trim()}…`;
  }
  return title;
}

function cleanLocation(value) {
  return String(value || 'Wien')
    .replace(/Multiple locations in Vienna/gi, 'Mehrere Standorte in Wien')
    .replace(/Vienna, Austria/gi, 'Wien')
    .trim();
}

function scoreDeal(deal) {
  const type = String(deal.type || '').toLowerCase();
  return (type === 'gratis' ? 40 : type === 'bogo' ? 30 : 20)
    + (deal.hot ? 15 : 0)
    + Math.min(Number(deal.qualityScore || 0), 100) / 5
    + Math.min(Number(deal.priority || 0), 5);
}

function selectDeals(feed, now) {
  return (Array.isArray(feed.deals) ? feed.deals : [])
    .filter((deal) => !isFlightDeal(deal))
    .flatMap((deal) => {
      const validity = currentValidity(deal, now);
      return validity ? [{
        ...deal,
        ...validity,
        sourceUrl: safeUrl(deal.url),
        displayTitle: cleanTitle(deal.title, deal.brand),
        displayLocation: cleanLocation(deal.distance || deal.location || deal.address || 'Wien'),
      }] : [];
    })
    .filter((deal) => deal.sourceUrl)
    .filter((deal) => !EXCLUDED_CATEGORIES.has(String(deal.category || '').toLowerCase()))
    .filter(isViennaDeal)
    .filter((deal) => !(Number(deal.qualityScore || 0) <= 0 && /:[a-z0-9_+-]+:|#[^\s#]+|\.{3,}/i.test(String(deal.title || ''))))
    .filter((deal) => deal.displayTitle.length >= 8)
    .sort((left, right) => scoreDeal(right) - scoreDeal(left) || left.expiryDate - right.expiryDate)
    .slice(0, MAX_DEALS);
}

function icon(name) {
  return `<img class="deal-icon" src="/assets/deal-icons/${name}.svg" alt="" width="18" height="18" aria-hidden="true">`;
}

function districtCodes(deal) {
  const location = [deal.address, deal.location, deal.distance].filter(Boolean).join(' ');
  return [...new Set([...location.matchAll(/\b(1\d{2}0)\b/g)]
    .map(match => match[1]).filter(code => Number(code.slice(1, 3)) >= 1 && Number(code.slice(1, 3)) <= 23))];
}

function localLogo(deal) {
  try {
    const url = new URL(deal.logoUrl || '', 'https://freefinder.at');
    if (url.origin !== 'https://freefinder.at' || !/^\/assets\/brand-logos\/[a-z0-9-]+\.(png|webp|jpg|svg)$/i.test(url.pathname)) return '';
    return fs.existsSync(path.join(ROOT, 'docs', url.pathname)) ? url.pathname : '';
  } catch (_) {
    return '';
  }
}

function renderDealCard(deal, index) {
  const id = `deal-${safeId(deal.id || `${deal.brand}-${deal.title}`)}`;
  const type = ['gratis', 'bogo', 'rabatt'].includes(deal.type) ? deal.type : 'angebot';
  const logo = localLogo(deal);
  const initials = String(deal.brand || 'FF').split(/\s+/).filter(Boolean).slice(0, 2).map(word => Array.from(word)[0]).join('').toLocaleUpperCase('de-AT');
  const description = String(deal.description || '').trim();
  const location = /^(?:k\.?\s?a\.?|n\/a|unknown)$/i.test(deal.displayLocation) ? 'Standort beim Anbieter prüfen' : deal.displayLocation;
  return `
        <article class="live-deal-card" id="${escapeHtml(id)}" data-type="${type}" data-districts="${districtCodes(deal).join(' ')}" data-order="${index}" data-expiry="${deal.expiryDate.getTime()}">
          <div class="deal-card-top">
            <span class="deal-brand-image" aria-hidden="true">${logo ? `<img src="${escapeHtml(logo)}" alt="" width="52" height="52" loading="lazy">` : `<span>${escapeHtml(initials)}</span>`}</span>
            <span class="deal-type">${escapeHtml(typeLabel(deal.type))}</span>
          </div>
          <p class="live-deal-brand">${escapeHtml(deal.brand || 'Anbieter')}</p>
          <h3>${escapeHtml(deal.displayTitle || 'Aktuelles Angebot')}</h3>
          <div class="deal-facts">
            <p class="live-deal-location">${icon('map-pin')}<span>${escapeHtml(location)}</span></p>
            <p>${icon('calendar-days')}<span>${escapeHtml(deal.expiryLabel)} <time datetime="${escapeHtml(calendarDate(deal.expiryRaw) || deal.expiryDate.toISOString())}">${escapeHtml(formatExpiryDate(deal.expiryRaw))}</time></span></p>
          </div>
          ${description ? `<details class="deal-conditions"><summary>Details &amp; Bedingungen</summary><p>${escapeHtml(description)}</p></details>` : ''}
          <a class="live-deal-source" href="${escapeHtml(deal.sourceUrl)}" rel="noopener" data-track="deal_outbound" data-deal-brand="${escapeHtml(deal.brand || '')}" aria-label="Angebot und Bedingungen bei ${escapeHtml(deal.brand || 'Anbieter')} öffnen"><span>Zum Angebot</span>${icon('arrow-up-right')}</a>
        </article>`;
}

function renderPage(feed, deals, now) {
  const updated = parseDate(feed.lastUpdated) || now;
  const modified = dateOnly(updated);
  const itemList = deals.map((deal, index) => ({
    '@type': 'ListItem',
    position: index + 1,
    name: `${deal.brand || 'Anbieter'}: ${deal.displayTitle || 'Angebot'}`,
    url: `https://freefinder.at/angebote-wien-heute.html#deal-${safeId(deal.id || `${deal.brand}-${deal.title}`)}`,
  }));
  const structuredData = {
    '@context': 'https://schema.org',
    '@graph': [
      {
        '@type': 'CollectionPage',
        name: 'Aktuelle Angebote Wien heute: Gratis, 1+1 & Gutscheine',
        url: 'https://freefinder.at/angebote-wien-heute.html',
        description: 'Aktuelle Gratis-Angebote, Restaurant-Gutscheine, 1+1-Aktionen und Rabatte in Wien mit eindeutigem Enddatum.',
        inLanguage: 'de-AT',
        dateModified: modified,
        mainEntity: { '@type': 'ItemList', numberOfItems: deals.length, itemListElement: itemList },
        isPartOf: { '@type': 'WebSite', name: 'FreeFinder', url: 'https://freefinder.at/' },
      },
      {
        '@type': 'BreadcrumbList',
        itemListElement: [
          { '@type': 'ListItem', position: 1, name: 'FreeFinder', item: 'https://freefinder.at/' },
          { '@type': 'ListItem', position: 2, name: 'Aktuelle Wien-Deals', item: 'https://freefinder.at/angebote-wien-heute.html' },
        ],
      },
      {
        '@type': 'FAQPage',
        mainEntity: [
          { '@type': 'Question', name: 'Wie aktuell sind die Angebote auf dieser Seite?', acceptedAnswer: { '@type': 'Answer', text: 'Die Seite wird aus dem aktuellen FreeFinder-App-Feed erzeugt und zeigt nur ausgewählte Wien-Angebote mit einem ausdrücklich erfassten, noch nicht erreichten Enddatum.' } },
          { '@type': 'Question', name: 'Wo finde ich die vollständigen Deal-Bedingungen?', acceptedAnswer: { '@type': 'Answer', text: 'Jede Karte führt zur hinterlegten Anbieter- oder Originalquelle. Dort solltest du unmittelbar vor der Einlösung Filiale, Zeitraum und Voraussetzungen erneut prüfen.' } },
          { '@type': 'Question', name: 'Sind alle Angebote kostenlos?', acceptedAnswer: { '@type': 'Answer', text: 'Nein. Die Übersicht enthält vollständig kostenlose Angebote, 1+1-Aktionen und Rabatte. Die jeweilige Angebotsart steht auf der Karte.' } },
        ],
      },
    ],
  };
  const cards = deals.length ? deals.map(renderDealCard).join('') : '<p class="empty-deals">Aktuell gibt es hier keine Angebote mit bekanntem Enddatum. Weitere Wien-Tipps findest du im <a href="/blog/">Blog</a>.</p>';
  const districts = [...new Set(deals.flatMap(districtCodes))].sort();
  const types = [['all', 'Alle'], ['gratis', 'Gratis'], ['bogo', '1+1'], ['rabatt', 'Rabatte']];
  const filters = types.map(([type, label]) => {
    const count = type === 'all' ? deals.length : deals.filter(deal => deal.type === type).length;
    return `<button type="button" data-deal-type="${type}" aria-pressed="${type === 'all'}" aria-controls="dealGrid"${!count && type !== 'all' ? ' disabled' : ''}>${label}<span>${count}</span></button>`;
  }).join('');

  return `<!DOCTYPE html>
<html lang="de-AT">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Aktuelle Angebote Wien heute: Gratis, 1+1 &amp; Gutscheine | FreeFinder</title>
  <meta name="description" content="Aktuelle Gratis-Angebote, Restaurant-Gutscheine, 1+1-Aktionen und Rabatte in Wien – mit Enddatum und Link zu den Bedingungen.">
  <meta name="robots" content="index,follow,max-image-preview:large,max-snippet:-1">
  <link rel="canonical" href="https://freefinder.at/angebote-wien-heute.html">
  <meta property="og:title" content="Aktuelle Angebote Wien heute: Gratis, 1+1 &amp; Gutscheine">
  <meta property="og:description" content="Aktuelle Gratis-Angebote, Restaurant-Gutscheine, 1+1-Aktionen und Rabatte mit klaren Enddaten.">
  <meta property="og:image" content="https://freefinder.at/og-preview-stores.png">
  <meta property="og:url" content="https://freefinder.at/angebote-wien-heute.html">
  <meta property="og:type" content="website">
  <meta name="twitter:card" content="summary_large_image">
  <link rel="icon" href="/icon-192.svg" type="image/svg+xml">
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link rel="preload" href="https://fonts.googleapis.com/css2?family=Bricolage+Grotesque:wght@600;700;800&family=Plus+Jakarta+Sans:wght@400;500;600;700;800&display=swap" as="style">
  <link href="https://fonts.googleapis.com/css2?family=Bricolage+Grotesque:wght@600;700;800&family=Plus+Jakarta+Sans:wght@400;500;600;700;800&display=swap" rel="stylesheet" media="print" onload="this.media='all'">
  <noscript><link href="https://fonts.googleapis.com/css2?family=Bricolage+Grotesque:wght@600;700;800&family=Plus+Jakarta+Sans:wght@400;500;600;700;800&display=swap" rel="stylesheet"></noscript>
  <link rel="stylesheet" href="/consent.css?v=5">
  <link rel="stylesheet" href="/blog/blog.css">
  <link rel="stylesheet" href="/deals.css?v=2">
  <script defer src="/deals.js?v=1"></script>
  <script defer src="/analytics-config.js"></script>
  <script defer src="/consent.js?v=7"></script>
  <script type="application/ld+json">${JSON.stringify(structuredData)}</script>
</head>
<body class="deals-page">
  <!-- Generated from docs/deals.json by scripts/generate-seo-deals-page.mjs. -->
  <header class="site-header"><nav class="nav" aria-label="Hauptnavigation"><a class="brand" href="/"><img class="brand-mark" src="/icon-192.svg" alt="" width="38" height="38">FreeFinder</a><div class="nav-links"><a href="/angebote-wien-heute.html" aria-current="page">Deals</a><a href="/blog/">Blog</a><a class="nav-download" href="/#download">App laden</a></div></nav></header>
  <main>
    <header class="deals-intro"><div class="deals-width"><p class="eyebrow">FreeFinder · Wien</p><h1>Deals in Wien.</h1><p>Gratis-Angebote, 1+1 und Rabatte für deinen Alltag.</p><div class="deals-app-note"><div><strong>Hier eine Auswahl. Alle Deals in der App.</strong><p>Auf der Website zeigen wir ausgewählte Wien-Deals mit bekanntem Enddatum. Die vollständige Deal-Übersicht findest du in der kostenlosen FreeFinder App.</p></div><nav aria-label="Vollständige Deal-Übersicht in der App"><a href="https://apps.apple.com/app/id6758958213">App Store ${icon('arrow-up-right')}</a><a href="https://play.google.com/store/apps/details?id=com.stefanataalla.freefinderwien">Google Play ${icon('arrow-up-right')}</a></nav></div><div class="deals-updated">Stand der App-Daten: <time datetime="${escapeHtml(modified)}">${escapeHtml(formatDate(updated))}</time></div></div></header>
    <section class="deal-hub" aria-labelledby="dealHubTitle">
      <form class="deal-filters" role="search" aria-label="Angebote filtern" hidden>
        <div class="deal-filter-fields">
          <label class="deal-search-label" for="dealSearch"><span class="sr-only">Angebote suchen</span><span class="deal-search-field">${icon('search')}<input id="dealSearch" type="search" placeholder="Anbieter, Deal oder Bezirk" autocomplete="off" aria-controls="dealGrid"></span></label>
          <label for="dealDistrict"><span>Bezirk</span><select id="dealDistrict" aria-controls="dealGrid"><option value="all">Ganz Wien</option>${districts.map(code => `<option value="${code}">${code} Wien</option>`).join('')}</select></label>
          <label for="dealSort"><span>Sortierung</span><select id="dealSort" aria-controls="dealGrid"><option value="recommended">Empfohlen</option><option value="ending">Endet zuerst</option><option value="brand">Anbieter A–Z</option></select></label>
        </div>
        <div class="deal-filter-bottom"><div class="deal-type-filters" role="group" aria-label="Angebotsart">${filters}</div><button class="deal-reset" type="reset" title="Filter zurücksetzen" hidden>${icon('rotate-ccw')}<span>Zurücksetzen</span></button></div>
      </form>
      <div class="deal-hub-head"><h2 id="dealHubTitle">Unsere Web-Auswahl <span id="dealCount" role="status" aria-live="polite" aria-atomic="true">${deals.length} ${deals.length === 1 ? 'Deal' : 'Deals'}</span></h2><p>Mit bekanntem Enddatum · Bedingungen beim Anbieter prüfen</p></div>
      <div class="live-deal-grid" id="dealGrid">${cards}
      </div>
      <div class="deal-empty" id="dealEmpty" hidden><h3>Kein passender Deal dabei.</h3><p>In unserer Web-Auswahl gibt es dafür gerade keine Treffer. Weitere Deals findest du <a href="/#download">in der App</a>.</p><button type="button" data-reset-filters>Web-Auswahl anzeigen</button></div>
      <details class="deal-selection-note"><summary>Welche Angebote werden hier angezeigt?</summary><p>Eine Auswahl aus dem FreeFinder-App-Feed mit eingetragenem, noch nicht abgelaufenem Enddatum. Verfügbarkeit, teilnehmende Filialen und weitere Bedingungen können sich ändern. Prüfe die Originalquelle vor der Einlösung. Weitere Angebote ohne bekanntes Enddatum findest du in der App.</p></details>
    </section>
    <section class="deals-guides" aria-labelledby="dealsGuidesTitle"><div class="deals-width"><div class="deals-guides-heading"><p class="eyebrow">Wien entdecken</p><h2 id="dealsGuidesTitle">Noch mehr für weniger.</h2></div><nav aria-label="Wiener Angebotsratgeber"><a href="/blog/guenstig-essen-wien.html"><span>Günstig essen<strong>Lieblingsplätze nach Bezirk</strong></span>${icon('chevron-right')}</a><a href="/blog/geburtstag-gratis-wien.html"><span>Geburtstag in Wien<strong>Gratis feiern &amp; genießen</strong></span>${icon('chevron-right')}</a><a href="/blog/kinodonnerstag-wien-drei.html"><span>KinoDonnerstag<strong>Zwei Tickets, ein Preis</strong></span>${icon('chevron-right')}</a></nav></div>
    </section>
  </main>
  <section class="download-band" aria-labelledby="downloadTitle"><div class="download-inner"><div><h2 id="downloadTitle">Mehr Wien-Deals in der App öffnen.</h2><p>FreeFinder kostenlos für iPhone und Android laden.</p></div><div class="store-links"><a href="https://apps.apple.com/app/id6758958213">App Store</a><a href="https://play.google.com/store/apps/details?id=com.stefanataalla.freefinderwien">Google Play</a></div></div></section>
  <footer class="site-footer"><div class="footer-inner"><strong>FreeFinder Wien</strong><div class="footer-links"><a href="/about.html">Über uns</a><a href="/blog/">Blog</a><a href="/presse.html">Presse</a><a href="/privacy.html">Datenschutz</a><a href="/support.html">Support</a></div></div></footer>
</body>
</html>
`;
}

const feed = JSON.parse(fs.readFileSync(INPUT_PATH, 'utf8'));
const now = parseDate(process.env.SEO_NOW) || new Date();
const deals = selectDeals(feed, now);
fs.writeFileSync(OUTPUT_PATH, polishHtml(renderPage(feed, deals, now), 'angebote-wien-heute.html', now.getTime()));
const sitemap = fs.readFileSync(SITEMAP_PATH, 'utf8');
const currentDealsUrl = 'https://freefinder.at/angebote-wien-heute.html';
const updatedSitemap = sitemap.replace(
  new RegExp(`(<loc>${currentDealsUrl.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}<\\/loc>\\s*<lastmod>)[^<]+`),
  `$1${dateOnly(parseDate(feed.lastUpdated) || now)}`,
);
fs.writeFileSync(SITEMAP_PATH, updatedSitemap);
console.log(`Generated ${path.relative(ROOT, OUTPUT_PATH)} with ${deals.length} current Vienna deals and refreshed its sitemap date`);

#!/usr/bin/env node
import fs from 'fs';
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
    .map((deal) => ({
      ...deal,
      sourceUrl: safeUrl(deal.url),
      expiryDate: parseDate(deal.expires),
      expiryRaw: String(deal.expires || ''),
      displayTitle: cleanTitle(deal.title, deal.brand),
      displayLocation: cleanLocation(deal.distance || deal.location || deal.address || 'Wien'),
    }))
    .filter((deal) => deal.sourceUrl && deal.expiryDate && deal.expiryDate.getTime() >= now.getTime())
    .filter((deal) => !EXCLUDED_CATEGORIES.has(String(deal.category || '').toLowerCase()))
    .filter(isViennaDeal)
    .filter((deal) => !(Number(deal.qualityScore || 0) <= 0 && /:[a-z0-9_+-]+:|#[^\s#]+|\.{3,}/i.test(String(deal.title || ''))))
    .filter((deal) => deal.displayTitle.length >= 8)
    .sort((left, right) => scoreDeal(right) - scoreDeal(left) || left.expiryDate - right.expiryDate)
    .slice(0, MAX_DEALS);
}

function renderDealCard(deal) {
  const id = `deal-${safeId(deal.id || `${deal.brand}-${deal.title}`)}`;
  return `
        <article class="live-deal-card" id="${escapeHtml(id)}">
          <div class="live-deal-topline"><span class="topic-label">${escapeHtml(typeLabel(deal.type))}</span><span>Gültig bis ${escapeHtml(formatExpiryDate(deal.expiryRaw))}</span></div>
          <p class="live-deal-brand">${escapeHtml(deal.brand || 'Anbieter')}</p>
          <h2>${escapeHtml(deal.displayTitle || 'Aktuelles Angebot')}</h2>
          <p class="live-deal-location">${escapeHtml(deal.displayLocation)}</p>
          <a class="live-deal-source" href="${escapeHtml(deal.sourceUrl)}" rel="noopener" data-track="deal_outbound" data-deal-brand="${escapeHtml(deal.brand || '')}">Bedingungen beim Anbieter prüfen</a>
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
        name: 'Aktuelle Angebote in Wien heute',
        url: 'https://freefinder.at/angebote-wien-heute.html',
        description: 'Aktuelle kostenlose Angebote, 1+1-Aktionen und Rabatte aus der FreeFinder-App mit eindeutigem Enddatum.',
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
  const cards = deals.length ? deals.map(renderDealCard).join('') : '<p class="empty-deals">Aktuell sind keine Angebote mit eindeutig bestätigtem Enddatum verfügbar. Bitte öffne die App für weitere Hinweise.</p>';

  return `<!DOCTYPE html>
<html lang="de-AT">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Aktuelle Angebote in Wien heute | FreeFinder</title>
  <meta name="description" content="Aktuelle Gratis-Angebote, 1+1-Aktionen und Rabatte in Wien mit Enddatum und Link zu den Bedingungen beim Anbieter.">
  <meta name="robots" content="index,follow,max-image-preview:large,max-snippet:-1">
  <link rel="canonical" href="https://freefinder.at/angebote-wien-heute.html">
  <meta property="og:title" content="Aktuelle Angebote in Wien heute">
  <meta property="og:description" content="Gratis-Angebote, 1+1-Aktionen und Rabatte aus der FreeFinder-App mit klaren Enddaten.">
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
  <script defer src="/analytics-config.js"></script>
  <script defer src="/consent.js?v=5"></script>
  <script type="application/ld+json">${JSON.stringify(structuredData)}</script>
</head>
<body>
  <!-- Generated from docs/deals.json by scripts/generate-seo-deals-page.mjs. -->
  <header class="site-header"><nav class="nav" aria-label="Hauptnavigation"><a class="brand" href="/"><img class="brand-mark" src="/icon-192.svg" alt="" width="38" height="38">FreeFinder</a><div class="nav-links"><a href="/angebote-wien-heute.html">Aktuelle Deals</a><a href="/blog/">Blog</a><a class="nav-download" href="/#download">App laden</a></div></nav></header>
  <main>
    <header class="article-hero"><div class="hero-inner"><p class="eyebrow">Heute in Wien</p><h1>Aktuelle kostenlose Angebote und Rabatte in Wien.</h1><p class="hero-copy">${deals.length} ausgewählte App-Deals mit eindeutigem, noch gültigem Enddatum. Öffne vor der Einlösung immer die verlinkten Bedingungen des Anbieters.</p><div class="article-meta"><span>App-Daten aktualisiert: ${escapeHtml(formatDate(updated))}</span><span>${deals.length} aktuelle Treffer</span></div><div class="article-byline"><span>Geprüfte Datenbasis der <a href="/about.html">FreeFinder Redaktion</a></span></div></div></header>
    <section class="deal-hub" aria-labelledby="dealHubTitle">
      <div class="deal-hub-head"><div><p class="eyebrow">Aktive Deals</p><h2 id="dealHubTitle">Angebote mit bekanntem Enddatum</h2></div><p>Die Übersicht enthält nur nicht abgelaufene Wien-Treffer mit eingetragenem Ablaufdatum. Verfügbarkeit und Teilnahme können sich kurzfristig ändern.</p></div>
      <div class="live-deal-grid">${cards}
      </div>
      <div class="article-note"><strong>Warum fehlen manche App-Deals?</strong>Angebote ohne belastbares Enddatum werden hier bewusst nicht automatisch als aktuell ausgegeben. In der App können zusätzliche Hinweise sichtbar sein, die du direkt an der Originalquelle prüfen solltest.</div>
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
fs.writeFileSync(OUTPUT_PATH, renderPage(feed, deals, now));
const sitemap = fs.readFileSync(SITEMAP_PATH, 'utf8');
const currentDealsUrl = 'https://freefinder.at/angebote-wien-heute.html';
const updatedSitemap = sitemap.replace(
  new RegExp(`(<loc>${currentDealsUrl.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}<\\/loc>\\s*<lastmod>)[^<]+`),
  `$1${dateOnly(parseDate(feed.lastUpdated) || now)}`,
);
fs.writeFileSync(SITEMAP_PATH, updatedSitemap);
console.log(`Generated ${path.relative(ROOT, OUTPUT_PATH)} with ${deals.length} current Vienna deals and refreshed its sitemap date`);

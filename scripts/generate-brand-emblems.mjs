import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { chromium } from 'playwright';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, '..');
const LOGO_DIR = path.join(ROOT, 'docs', 'assets', 'brand-logos');

const SIZE = 512;

const LOGOS = [
  {
    file: 'mcdonald-s-mcdonalds-at.png',
    type: 'simple-icon-card',
    slug: 'mcdonalds',
    background: '#DA291C',
    fill: '#FFC72C',
    inset: 92,
    radius: 116
  },
  {
    file: 'ikea-restaurant-ikea-com.png',
    type: 'remote-svg',
    url: 'https://www.ikea.com/global/assets/logos/brand/ikea.svg',
    maxWidth: 430,
    maxHeight: 210
  },
  {
    file: 'spotify-spotify-com.png',
    type: 'simple-icon',
    slug: 'spotify',
    fill: '#1ED760',
    maxWidth: 390,
    maxHeight: 390
  },
  {
    file: 'foodora-foodora-at.png',
    type: 'text-circle',
    text: 'foodora',
    background: '#D70F64',
    color: '#FFFFFF',
    fontSize: 92
  },
  {
    file: 'nordsee-nordsee-com.png',
    type: 'remote-image',
    url: 'https://www.nordsee.com/assets/images/logo_mobile.png?v=1730219890',
    maxWidth: 425,
    maxHeight: 250
  },
  {
    file: 'steakdoner-wolt-com.png',
    type: 'remote-image',
    url: 'https://wolt-com-static-assets.wolt.com/android-icon-192x192.png',
    maxWidth: 390,
    maxHeight: 390
  },
  {
    file: 'westfield-club-westfield-com.png',
    type: 'remote-svg',
    url: 'https://www.westfield.com/logos/logo-westfield.svg',
    maxWidth: 425,
    maxHeight: 220
  },
  {
    file: 'billa-billa-at.png',
    type: 'remote-image',
    url: 'https://assets-eu-01.kc-usercontent.com/cc0b17b0-a734-010a-8710-f644b7ee1f24/19d81e75-38ec-4c25-9286-8e6d1db07fd6/billa_open-graph_588x588.png',
    maxWidth: 400,
    maxHeight: 400
  },
  {
    file: 'omv-viva-omv-at.png',
    type: 'remote-image',
    url: 'https://www.omv.at/de/apple-icon?df2e51391eec1509',
    maxWidth: 390,
    maxHeight: 390
  },
  {
    file: 'burger-king-burgerking-at.png',
    type: 'simple-icon',
    slug: 'burgerking',
    fill: '#D62300',
    maxWidth: 390,
    maxHeight: 390
  },
  {
    file: 'starbucks-starbucks-at.png',
    type: 'simple-icon',
    slug: 'starbucks',
    fill: '#006241',
    maxWidth: 400,
    maxHeight: 400
  },
  {
    file: 'dunkin-dunkin-at.png',
    type: 'remote-image',
    url: 'https://dunkin.at/wp-content/uploads/cropped-DD_Favicon-180x180.jpg',
    maxWidth: 390,
    maxHeight: 390
  }
];

async function fetchText(url) {
  const response = await fetch(url, {
    headers: { 'user-agent': 'Mozilla/5.0 (compatible; FreeFinderLogoGenerator/1.0)' },
    signal: AbortSignal.timeout(15000)
  });
  if (!response.ok) throw new Error(`${url} returned HTTP ${response.status}`);
  return response.text();
}

async function fetchDataURL(url) {
  const response = await fetch(url, {
    headers: { 'user-agent': 'Mozilla/5.0 (compatible; FreeFinderLogoGenerator/1.0)' },
    signal: AbortSignal.timeout(15000)
  });
  if (!response.ok) throw new Error(`${url} returned HTTP ${response.status}`);
  const contentType = response.headers.get('content-type') || 'image/png';
  const buffer = Buffer.from(await response.arrayBuffer());
  return `data:${contentType};base64,${buffer.toString('base64')}`;
}

function escapeHTML(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function normalizeSvg(svg, fill) {
  let next = svg.replace(/<title>.*?<\/title>/gis, '');
  if (fill) {
    next = next.replace(/<svg\b/i, `<svg fill="${fill}"`);
  }
  return next;
}

async function markupForLogo(logo) {
  if (logo.type === 'simple-icon' || logo.type === 'simple-icon-card') {
    const svg = normalizeSvg(await fetchText(`https://cdn.simpleicons.org/${logo.slug}`), logo.fill);
    const cardStyle = logo.type === 'simple-icon-card'
      ? `background:${logo.background};border-radius:${logo.radius || 92}px;`
      : '';
    return `
      <div class="card" style="${cardStyle}">
        <div class="logo simple" style="width:${SIZE - (logo.inset || 96) * 2}px;height:${SIZE - (logo.inset || 96) * 2}px;">
          ${svg}
        </div>
      </div>`;
  }

  if (logo.type === 'remote-svg') {
    const svg = await fetchText(logo.url);
    return `
      <div class="card">
        <div class="logo svg" style="width:${logo.maxWidth}px;max-height:${logo.maxHeight}px;">
          ${svg}
        </div>
      </div>`;
  }

  if (logo.type === 'remote-image') {
    const dataURL = await fetchDataURL(logo.url);
    return `
      <div class="card">
        <img class="logo image" style="max-width:${logo.maxWidth}px;max-height:${logo.maxHeight}px;" src="${dataURL}" alt="">
      </div>`;
  }

  if (logo.type === 'text-circle') {
    return `
      <div class="card">
        <div class="text-circle" style="background:${logo.background};color:${logo.color};font-size:${logo.fontSize}px;">
          ${escapeHTML(logo.text)}
        </div>
      </div>`;
  }

  throw new Error(`Unknown logo type ${logo.type}`);
}

async function renderLogo(page, logo) {
  const logoMarkup = await markupForLogo(logo);
  await page.setContent(`
    <!doctype html>
    <html>
      <head>
        <style>
          html, body {
            width: ${SIZE}px;
            height: ${SIZE}px;
            margin: 0;
            background: transparent;
          }
          #emblem {
            width: ${SIZE}px;
            height: ${SIZE}px;
            display: flex;
            align-items: center;
            justify-content: center;
            background: transparent;
            overflow: hidden;
          }
          .card {
            width: ${SIZE}px;
            height: ${SIZE}px;
            display: flex;
            align-items: center;
            justify-content: center;
            background: transparent;
            overflow: hidden;
          }
          .logo {
            display: flex;
            align-items: center;
            justify-content: center;
          }
          .logo svg {
            width: 100%;
            height: 100%;
            display: block;
          }
          .logo.image {
            display: block;
            object-fit: contain;
          }
          .text-circle {
            width: 420px;
            height: 420px;
            border-radius: 50%;
            display: flex;
            align-items: center;
            justify-content: center;
            font-family: Arial Rounded MT Bold, Arial, Helvetica, sans-serif;
            font-weight: 900;
            letter-spacing: -3px;
            line-height: 1;
          }
        </style>
      </head>
      <body><div id="emblem">${logoMarkup}</div></body>
    </html>
  `);
  await page.locator('#emblem').screenshot({
    path: path.join(LOGO_DIR, logo.file),
    omitBackground: true
  });
}

async function main() {
  await mkdir(LOGO_DIR, { recursive: true });

  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: SIZE, height: SIZE }, deviceScaleFactor: 1 });

  for (const logo of LOGOS) {
    await renderLogo(page, logo);
    console.log(`Generated ${path.relative(ROOT, path.join(LOGO_DIR, logo.file))}`);
  }

  await browser.close();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

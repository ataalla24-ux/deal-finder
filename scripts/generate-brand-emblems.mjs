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
  },
  {
    file: 'foodsharing-foodsharing-at.png',
    type: 'remote-svg',
    url: 'https://foodsharing.at/img/favicon/safari-pinned-tab.svg',
    fill: '#6E9F20',
    maxWidth: 370,
    maxHeight: 370
  },
  {
    file: 'madame-tussauds-wien-madametussauds-com.png',
    type: 'remote-image',
    url: 'https://www.madametussauds.com/wien/media/4rjlb4mv/mtwlogodeutsch.png?format=webp&height=280',
    background: '#0F0B08',
    radius: 104,
    maxWidth: 430,
    maxHeight: 180
  },
  {
    file: 'therme-wien-thermewien-at.png',
    type: 'remote-svg',
    url: 'https://thermewien.at/wp-content/themes/therme-wien/assets/images/Logo_ThermeWien_2024_RGB_frei.svg',
    background: '#111827',
    radius: 104,
    maxWidth: 430,
    maxHeight: 190
  },
  {
    file: 'hillsong-vienna-hillsong-com.png',
    type: 'remote-image',
    url: 'https://cdn.hillsong.com/wp-content/themes/hillsong/images/logo-outline-small.png',
    maxWidth: 420,
    maxHeight: 420
  },
  {
    file: 'icf-wien-icf-wien-at.png',
    type: 'remote-svg',
    url: 'https://icf.church/wien/wp-content/themes/icf/assets/logo.svg',
    fill: '#111111',
    maxWidth: 390,
    maxHeight: 220
  },
  {
    file: 'icf-wien-icf-church.png',
    type: 'remote-svg',
    url: 'https://icf.church/wien/wp-content/themes/icf/assets/logo.svg',
    fill: '#111111',
    maxWidth: 390,
    maxHeight: 220
  },
  {
    file: 'cig-wien-cigwien-at.png',
    type: 'remote-image',
    url: 'https://www.cigwien.at/wp-content/uploads/cig_logo_2018_darkgrey_highres.png',
    maxWidth: 390,
    maxHeight: 390
  },
  {
    file: 'vcc-jesuszentrum-jesuszentrum-at.png',
    type: 'remote-image',
    url: 'https://cdn.prod.website-files.com/66f6a479a06a5c827f21a614/6704e0cce50db21e991c1d31_logo-white-vcc.png',
    background: '#141414',
    radius: 116,
    maxWidth: 400,
    maxHeight: 170
  },
  {
    file: 'raiffeisen-raiffeistag-raiffeisen-at.png',
    type: 'remote-image',
    url: 'https://www.raiffeisen.at/resources/rbg/logos/favicon.png.imgTransformer/favIcon/xl/1620387371373/favicon.png',
    background: '#FFDD00',
    radius: 108,
    maxWidth: 240,
    maxHeight: 240
  },
  {
    file: 'too-good-to-go-toogoodtogo-com.png',
    type: 'remote-image',
    url: 'https://is1-ssl.mzstatic.com/image/thumb/Purple221/v4/e2/24/f8/e224f892-0694-f8b6-3b12-001ea0430a00/AppIcon-0-0-1x_U007epad-0-1-0-85-220.png/512x512bb.jpg',
    maxWidth: 420,
    maxHeight: 420
  },
  {
    file: 'thalia-thalia-at.png',
    type: 'remote-image',
    url: 'https://is1-ssl.mzstatic.com/image/thumb/Purple211/v4/bd/b3/42/bdb342a0-7cbd-d282-726d-89f56bad7ec0/AppIcon-0-0-1x_U007epad-0-1-0-85-220.png/512x512bb.jpg',
    maxWidth: 420,
    maxHeight: 420
  },
  {
    file: 'evo-fitness-evofitness-at.png',
    type: 'text-card',
    text: 'EVO',
    background: '#111111',
    color: '#FFFFFF',
    fontSize: 116
  },
  {
    file: 'all4golf-all4golf-de.png',
    type: 'text-card',
    text: 'all4golf',
    background: '#F8FAF5',
    color: '#244D2C',
    fontSize: 76
  },
  {
    file: 'marschfuerjesus-marschfuerjesus-com.png',
    type: 'text-card',
    text: 'Marsch\nfür Jesus',
    background: '#FFF7E1',
    color: '#B83226',
    fontSize: 58
  },
  {
    file: 'wiener-deewan-deewan-at.png',
    type: 'text-card',
    text: 'Deewan',
    background: '#F4D65E',
    color: '#1A1814',
    fontSize: 86
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
    next = next.replace(/\sfill="[^"]*"/gi, '');
    next = next.replace(/<svg\b/i, `<svg fill="${fill}"`);
  }
  return next;
}

function cardStyle(logo) {
  const styles = [];
  if (logo.background) styles.push(`background:${logo.background}`);
  if (logo.radius !== undefined) styles.push(`border-radius:${logo.radius}px`);
  return styles.length ? `${styles.join(';')};` : '';
}

function multilineHTML(value) {
  return escapeHTML(value).replace(/\n/g, '<br>');
}

async function markupForLogo(logo) {
  if (logo.type === 'simple-icon' || logo.type === 'simple-icon-card') {
    const svg = normalizeSvg(await fetchText(`https://cdn.simpleicons.org/${logo.slug}`), logo.fill);
    const cardStyles = logo.type === 'simple-icon-card'
      ? cardStyle({ background: logo.background, radius: logo.radius || 92 })
      : '';
    return `
      <div class="card" style="${cardStyles}">
        <div class="logo simple" style="width:${SIZE - (logo.inset || 96) * 2}px;height:${SIZE - (logo.inset || 96) * 2}px;">
          ${svg}
        </div>
      </div>`;
  }

  if (logo.type === 'remote-svg') {
    const svg = normalizeSvg(await fetchText(logo.url), logo.fill);
    return `
      <div class="card" style="${cardStyle(logo)}">
        <div class="logo svg" style="width:${logo.maxWidth}px;max-height:${logo.maxHeight}px;">
          ${svg}
        </div>
      </div>`;
  }

  if (logo.type === 'remote-image') {
    const dataURL = await fetchDataURL(logo.url);
    return `
      <div class="card" style="${cardStyle(logo)}">
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

  if (logo.type === 'text-card') {
    return `
      <div class="card">
        <div class="text-card" style="background:${logo.background};color:${logo.color};font-size:${logo.fontSize}px;">
          ${multilineHTML(logo.text)}
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
          .text-card {
            width: 420px;
            height: 420px;
            border-radius: 104px;
            display: flex;
            align-items: center;
            justify-content: center;
            font-family: Arial Rounded MT Bold, Arial, Helvetica, sans-serif;
            font-weight: 900;
            letter-spacing: 0;
            line-height: 1.04;
            text-align: center;
            padding: 30px;
            box-sizing: border-box;
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

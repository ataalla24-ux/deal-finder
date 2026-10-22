import { load } from 'cheerio';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { extractFoodOffers, foodText } from './power-food-extraction.js';
import { sourceHttpError, sourceFailureFields } from './source-http-policy.js';
import { discoveryRejection } from './deal-discovery-policy.js';

const exec = promisify(execFile);
const HASH = data => crypto.createHash('sha256').update(data).digest('hex');
const ROOT = 'https://www.nordsee.com/at/coupons';
const MAX_BYTES = 8 * 1024 * 1024;
const MAX_CARDS = 12;
const escapes = value => String(value).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

export function allowedCouponAsset(value, kind) {
  try {
    const u = new URL(value);
    if (u.protocol !== 'https:' || u.hostname !== 'www.nordsee.com' || u.port || u.username || u.password || u.hash) return false;
    if (kind === 'pdf') return u.pathname === '/at/coupons/pdf' && !u.search;
    return /^\/assets\/img\/console\/appUser\/news\/\d+_view_at\.(?:png|jpg)$/.test(u.pathname)
      && (!u.search || /^\?v=\d+$/.test(u.search));
  } catch { return false; }
}

export function discoverCouponMedia(html, source, pageUrl = source.url) {
  if (source.couponMedia !== 'nordsee-at-v1' || pageUrl !== ROOT) return [];
  const $ = load(html);
  const assets = [];
  // Decode the site's JSON string literal as data, never execute page scripts.
  const literal = html.match(/\bvar\s+dati_pagina\s*=\s*JSON\.parse\('((?:[^'\\]|\\.)*)'\)/)?.[1];
  if (literal && literal.length < 500000) {
    try {
      const data = JSON.parse(JSON.parse('"' + literal + '"'));
      for (const entry of Object.values(data.promo || {}).slice(0, 40)) {
        const url = new URL(entry.img?.detail || '', ROOT).href;
        if (allowedCouponAsset(url, 'image') && typeof entry.title === 'string')
          assets.push({ kind:'image', url, title:foodText(entry.title), metadataExpiry:entry.date_expire?.slice(0,10) || '' });
      }
    } catch { /* A changed/invalid schema cannot produce trusted image URLs. */ }
  }
  if ($('a[href]').toArray().some(e => {
    try { return new URL($(e).attr('href'), ROOT).href === ROOT + '/pdf'; } catch { return false; }
  })) assets.push({kind:'pdf',url:ROOT + '/pdf',title:''});
  return assets.filter((a,i) => assets.findIndex(b=>a.url===b.url)===i);
}

export async function fetchCouponAsset(asset, options = {}) {
  if (!allowedCouponAsset(asset.url, asset.kind)) throw new Error('untrusted-coupon-asset');
  const response = await (options.fetch || fetch)(asset.url, {
    redirect:'manual', signal:AbortSignal.timeout(12000),
    headers:{'user-agent':'FreeFinder/1.0 (+https://freefinder.at)'},
  });
  if (!response.ok) {
    await response.body?.cancel();
    throw sourceHttpError(response.status, response.headers.get('retry-after'));
  }
  const type = response.headers.get('content-type') || '';
  if (!(asset.kind === 'pdf' ? /application\/pdf/i : /image\/(?:jpeg|png)/i).test(type)
    || Number(response.headers.get('content-length')) > MAX_BYTES) {
    await response.body?.cancel();
    throw new Error('coupon-type-or-size-limit');
  }
  const reader = response.body.getReader();
  const chunks = []; let size = 0;
  for (;;) {
    const {value,done} = await reader.read();
    if (done) break;
    size += value.length;
    if (size > MAX_BYTES) { await reader.cancel(); throw new Error('coupon-size-limit'); }
    chunks.push(value);
  }
  const data = Buffer.concat(chunks);
  const valid = asset.kind === 'pdf' ? data.subarray(0,5).toString() === '%PDF-'
    : data.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])) || data[0] === 255 && data[1] === 216;
  if (!valid) throw new Error('coupon-signature-mismatch');
  return data;
}

async function run(command, args) {
  return exec(command, args, {timeout:20000,maxBuffer:1024*1024,
    env:{...process.env,OMP_THREAD_LIMIT:'1',LC_ALL:'C'}});
}

export function parsePdfImageList(text) {
  const rows = text.split('\n').filter(line=>/^\s*\d+\s+\d+\s/.test(line)).map(line=> {
    const v = line.trim().split(/\s+/);
    return {page:Number(v[0]),index:Number(v[1]),type:v[2],width:Number(v[3]),height:Number(v[4])};
  });
  if (!rows.length || rows.length > MAX_CARDS || rows.some(r=>r.type!=='image'
    || r.width*r.height>6000000 || r.width<400 || r.height<350 || r.width/r.height<1 || r.width/r.height>1.15))
    throw new Error('unsupported-coupon-pdf-layout');
  if (rows.reduce((n,r)=>n+r.width*r.height,0)>24000000) throw new Error('coupon-pdf-pixel-limit');
  return rows;
}

async function ocrCard(file, dir, index, deadline) {
  const {stdout:probe} = await run('ffprobe',['-v','error','-select_streams','v:0','-show_entries','stream=width,height','-of','json',file]);
  const {width,height} = JSON.parse(probe).streams?.[0] || {};
  if (!width || !height || width*height>6000000 || width<400 || height<350 || width/height<1 || width/height>1.15)
    throw new Error('unsupported-coupon-image-layout');
  // This layout is opt-in for NORDSEE's individual coupon cards only. Never
  // crop an arbitrary multi-offer page and join prices from different cards.
  const areas = {
    footer:'crop=iw*0.68:ih*0.38:iw*0.32:ih*0.62,format=gray,negate',
    benefit:'crop=iw*0.23:ih*0.20:iw*0.08:ih*0.08,format=gray',
    discount:'crop=iw*0.35:ih*0.30:iw*0.65:ih*0.38,format=gray',
    side:'crop=iw*0.13:ih*0.50:0:ih*0.28,transpose=1,format=gray,negate',
  };
  const result = {};
  for (const [name,filter] of Object.entries(areas)) {
    if (Date.now()>deadline) throw new Error('coupon-ocr-total-time-limit');
    const output = path.join(dir,`${index}-${name}.png`);
    await run('ffmpeg',['-hide_banner','-loglevel','error','-threads','1','-i',file,'-vf',filter,'-frames:v','1',output]);
    const {stdout} = await run('tesseract',[output,'stdout','-l','deu+eng','--psm',name==='discount'?'11':'6']);
    result[name] = stdout.trim().slice(0,8000);
  }
  return result;
}

export async function readCouponAsset(asset, data) {
  const deadline = Date.now()+180000;
  const dir = await fs.mkdtemp(path.join(os.tmpdir(),'freefinder-coupon-'));
  try {
    const file = path.join(dir, asset.kind === 'pdf' ? 'input.pdf' : 'input.image');
    await fs.writeFile(file,data);
    let files;
    if (asset.kind === 'pdf') {
      const {stdout:info} = await run('pdfinfo',[file]);
      if (!/^Pages:\s+[12]\s*$/m.test(info)) throw new Error('coupon-pdf-page-limit');
      const {stdout:list} = await run('pdfimages',['-f','1','-l','2','-list',file]);
      const rows = parsePdfImageList(list);
      await run('pdfimages',['-f','1','-l','2','-png','-j',file,path.join(dir,'card')]);
      files = (await fs.readdir(dir)).filter(f=>/^card-\d+\.(?:png|jpg)$/.test(f)).sort();
      if (files.length !== rows.length) throw new Error('coupon-pdf-extraction-mismatch');
    } else files = ['input.image'];
    const cards = [];
    for (const [index,name] of files.entries()) {
      const cardFile = path.join(dir,name);
      cards.push({...await ocrCard(cardFile,dir,index,deadline),index,sha256:HASH(await fs.readFile(cardFile))});
    }
    return cards;
  } finally { await fs.rm(dir,{recursive:true,force:true}); }
}

export function couponCardOffer(card, asset, source, now = new Date()) {
  const exclusion = discoveryRejection({title:asset.title || '',description:[card.footer,card.benefit,card.discount,card.side].join(' ')});
  if (exclusion) return {reason:exclusion};
  const footer = foodText(card.footer);
  // No inferred year, missing terms, unreadable territory or document-wide date.
  if (!/Gültig bis \d{1,2}\.\d{1,2}\.20\d{2}/i.test(footer)
    || !/in allen teilnehmenden Restaurants in Österreich/i.test(footer)
    || !/Nicht gültig an Autobahnraststätten/i.test(footer)) return {reason:'coupon-terms-unreadable'};
  const benefitText = foodText(card.benefit);
  const discountText = foodText(card.discount);
  const bogo = /\b1\s*\+\s*1\b/.test(benefitText) && /GRATIS/i.test(benefitText);
  const percent = discountText.match(/\bMEHR ALS\s+([1-9]\d?)\s*%\s+RABATT\b/i);
  const benefit = bogo ? '1+1 gratis' : percent && Number(percent[1])<=90 && /RABATT/i.test(discountText)
    ? `${/mehr als/i.test(discountText) ? 'Mehr als ' : ''}${percent[1]} % Rabatt` : '';
  if (!benefit) return {reason:'coupon-benefit-unreadable'};
  const lines = String(card.footer).split(/\n/).map(foodText).filter(Boolean);
  const productStart = lines.findIndex(line=>/fisch|fish|lachs|schollen|garnelen|menü|mix-box/i.test(line));
  const product = productStart<0 ? '' : foodText(lines.slice(productStart).join(' ').split(/Gültig bis/i)[0]);
  if (!product || product.length>180) return {reason:'coupon-product-unreadable'};
  if (/softdrink/i.test(product) && !/softdrink\s+\d+(?:[,.]\d+)?\s*l\b/i.test(product))
    return {reason:'coupon-quantity-unreadable'};
  const title = `${product}: ${benefit}`;
  // Price badges with superscript cents are deliberately NOT converted to a
  // purchase price. Keep conditions and raw OCR as evidence for human review.
  const prefix = lines.slice(0,productStart).join(' ');
  if (/nur|nicht|kauf|bestell|ausgenommen|mitglied|mindest|pfand/i.test(prefix)) return {reason:'coupon-condition-before-product'};
  const conditions = footer.slice(footer.search(/Gültig bis/i));
  const side = foodText(card.side);
  const text = `Gutschein. ${conditions}${/zzgl|pfand|eur|€|ausgenommen|nicht|nur/i.test(side) ? ' '+side : ''}`;
  const html = `<article class="coupon"><h2>${escapes(title)}</h2><p>${escapes(text)}</p></article>`;
  const parsed = extractFoodOffers(html,{...source,selector:'.coupon'},{now,pageUrl:ROOT});
  const deal = parsed.deals[0];
  if (!deal) return {reason:parsed.rejected[0]?.reason || 'coupon-not-an-offer'};
  const today = new Intl.DateTimeFormat('sv-SE',{timeZone:'Europe/Vienna'}).format(now);
  if (asset.metadataExpiry && asset.metadataExpiry < today) return {reason:'coupon-metadata-date-conflict'};
  deal.evidence.extractionMethod = 'official-coupon-local-ocr';
  deal.evidence.media = {url:asset.url,kind:asset.kind,sha256:asset.sha256,index:card.index,
    cardSha256:card.sha256,
    ocr:{footer:card.footer,benefit:card.benefit,discount:card.discount,side:card.side}};
  deal.qualityScore = 68;
  deal.category = 'essen';
  deal.logo = '🍽️';
  deal.reviewRequired = true;
  deal.missingFields = [...new Set([...deal.missingFields,'OCR: Produkt, Mengen, Coupon und Filialteilnahme prüfen'])];
  return {deal};
}

export async function extractCouponMediaOffers(html, source, options = {}) {
  const now = options.now || new Date();
  const assets = discoverCouponMedia(html,source,options.pageUrl);
  const result = {deals:[],rejected:[],assets:[]};
  // One PDF contains all individual coupons; use images only if there is no
  // PDF link. A denied PDF is not retried through an alternate transport.
  let selected = assets.some(a=>a.kind==='pdf') ? assets.filter(a=>a.kind==='pdf') : assets.filter(a=>a.kind==='image').slice(0,6);
  if (options.assetUrl) selected = assets.filter(a=>a.url===options.assetUrl);
  for (const asset of selected) {
    try {
      const data = await (options.fetchAsset || fetchCouponAsset)(asset);
      const bound = {...asset,sha256:HASH(data)};
      const cards = await (options.readAsset || readCouponAsset)(bound,data);
      if (cards.length > MAX_CARDS) throw new Error('coupon-card-limit');
      for (const card of cards) {
        const offer = couponCardOffer(card,bound,source,now);
        if (offer.deal) result.deals.push(offer.deal);
        else result.rejected.push({url:asset.url,index:card.index,reason:offer.reason});
      }
      result.assets.push({url:asset.url,kind:asset.kind,status:'ok',bytes:data.length,cards:cards.length,sha256:bound.sha256});
    } catch (error) {
      result.assets.push({url:asset.url,kind:asset.kind,status:'error',error:error.message,...sourceFailureFields(error)});
      if ([401,403,429].includes(error.status || error.httpStatus) || /HTTP (401|403|429)/.test(error.message)) break;
    }
  }
  return result;
}

import { createHash } from 'node:crypto';
import { load } from 'cheerio';

export const MARKTGURU_NESCAFE_URL = 'https://www.marktguru.at/mb/nescafe-espresso-concentrate-1-1-gratis-cashback-6566';
const dealId = 'fc4g-w3wqsu';
const product = 'NESCAFÉ Espresso Concentrate';
const limit = '3x Einlösbar pro Person';
const clean = value => String(value || '').replace(/\s+/g, ' ').trim();
const hash = value => createHash('sha256').update(value).digest('hex');
const conditionsHash = 'd2e503d5496718603e96bb9a90466ed5e270562ded53e1d2c2cae6dc1532630f';

const description = 'Kaufe zwei NESCAFÉ Espresso Concentrate und reiche den Kassenbon in der marktguru-App ein. '
  + 'Du bekommst den Preis des günstigeren Produkts nach Abzug aller Rabatte zurück. Bis zu drei Einlösungen pro Person, mit jeweils einer Rechnung. '
  + 'Der ganze Kassenbon muss vollständig und scharf lesbar sein. Gefaltete Bons und Rechnungsduplikate werden abgelehnt. '
  + 'Die Aktion gilt bei Käufen in Österreich. Erhältlich ist das Produkt bei Billa, Billa Plus, Interspar und Eurospar, je nach Filiale. '
  + 'Onlinekäufe sind mit österreichischer Lieferadresse möglich. Amazon, die Onlineshops von dm und Bipa, Zooplus und Zooroyal sind auch bei Click & Collect oder Expressabholung ausgeschlossen. '
  + 'Das Produkt muss auf dem Beleg richtig bezeichnet sein. Die Aktion gilt, solange Vorrat und Aktionsbudget reichen. '
  + 'Einlösungen zählen nicht für andere NESCAFÉ-Aktionen.';

export const isSupportedMarktguruUrl = value => value === MARKTGURU_NESCAFE_URL;

function visible($, element) {
  return element.length === 1 && ![element[0], ...element.parents().toArray()].some(node =>
    Object.hasOwn(node.attribs || {}, 'hidden') || $(node).attr('aria-hidden') === 'true'
    || /(?:display\s*:\s*none|visibility\s*:\s*hidden)/i.test($(node).attr('style') || ''));
}

export function extractMarktguruCashbackEvidence(html, requestedUrl, finalUrl = requestedUrl) {
  if (!isSupportedMarktguruUrl(requestedUrl)) return null;
  const missing = { sourceUrl: requestedUrl, blockingReason: 'Aktuelle marktguru-Aktion nicht mit geprüften Bedingungen bestätigt.' };
  if (finalUrl !== requestedUrl || typeof html !== 'string' || html.length > 4000000) return missing;
  const $ = load(html);
  const canonical = $('head link[rel="canonical"]');
  const main = $('main.app-main');
  const details = main.children('.cashback-details').children('.info');
  const headings = main.find('h1');
  const boxes = main.children('.box').filter((_, node) =>
    clean($(node).children('.title').children('h2').text()) === 'Bedingungen');
  const conditions = boxes.children('.desc');
  const availability = details.find('.cashback-details-info .progress');
  const redeemLimit = details.find('.cashback-details-info').children().not('.progress');
  if (canonical.length !== 1 || canonical.attr('href') !== requestedUrl || main.length !== 1
    || headings.length !== 1 || !visible($, headings) || !visible($, availability) || !visible($, redeemLimit)
    || clean(headings.text()) !== product || clean(details.find('.cashback-badge').text()) !== '1+1Cashback'
    || clean(redeemLimit.text()) !== limit || boxes.length !== 1 || !visible($, conditions)) return missing;
  const body = clean(conditions.text());
  if (hash(body) !== conditionsHash || conditions.find('[hidden],[aria-hidden="true"],script,style,template').length
    || conditions.find('[style]').toArray().some(node => /(?:display\s*:\s*none|visibility\s*:\s*hidden)/i.test($(node).attr('style') || ''))) return missing;
  const states = $('script[type="application/json"]').toArray().flatMap(node => {
    try {
      const campaign = JSON.parse($(node).text()).data?.cashback;
      return campaign ? [campaign] : [];
    } catch { return []; }
  });
  const [state] = states;
  const campaign = state?.data;
  if (states.length !== 1 || state.status !== 200 || !campaign || campaign.id !== 6566
    || campaign.detailTitle !== product || campaign.workflowState !== 'published'
    || campaign.quantityBuy !== 1 || campaign.quantityGet !== 1 || campaign.cashbackValue !== 100
    || campaign.userRedeemLimit !== 3 || campaign.isReceiptCampaign !== true
    || campaign.cutoffDate !== null || campaign.receiptEndValidityDate !== null
    || campaign.validFrom !== '2026-11-06T08:00:00Z'
    || !Number.isInteger(campaign.campaignAvailability) || campaign.campaignAvailability < 1 || campaign.campaignAvailability > 100
    || clean(availability.text()) !== `${campaign.campaignAvailability}% verfügbar`) return missing;
  return { sourceUrl: requestedUrl, caption: `${product} 1+1 Cashback\n${limit}\n${body}`,
    sourceKind: 'marktguru-reviewed-cashback', contentHash: conditionsHash };
}

export function reviewedMarktguruCopy(deal, evidence) {
  const prefix = `${product} 1+1 Cashback\n${limit}\n`;
  if (deal?.id !== dealId || !isSupportedMarktguruUrl(deal.url) || evidence?.sourceUrl !== deal.url
    || evidence.blockingReason || evidence.sourceKind !== 'marktguru-reviewed-cashback'
    || evidence.contentHash !== conditionsHash || !evidence.caption?.startsWith(prefix)
    || hash(evidence.caption.slice(prefix.length)) !== conditionsHash) return null;
  return { description };
}

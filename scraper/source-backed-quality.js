import { createHash } from 'node:crypto';

const text = value => String(value || '').replace(/\s+/g, ' ').trim();
const exactDay = value => /^20\d{2}-\d{2}-\d{2}$/.test(value || '')
  && Number.isFinite(Date.parse(`${value}T12:00:00Z`))
  && new Date(`${value}T12:00:00Z`).toISOString().slice(0, 10) === value;

// This shared inspection is advisory. Source verification and human approval
// remain independent gates; a good-looking title is not proof of a real offer.
export function inspectSourceBackedQuality(deal, { mapReview, today = '' } = {}) {
  const issues = [];
  const add = (code, label) => issues.push({code, label});
  if (!text(deal.title) || /^(?:Instagram[- ]Deal geteilt|Community[- ]Deal|Geteilter Deal-Link)/i.test(deal.title)) add('missing-offer', 'Konkretes Produkt und Vorteil fehlen.');
  else if (text(deal.title).length > 60) add('long-title', 'Titel lang; Bedingungen erhalten, nicht abschneiden.');
  if (!text(deal.description).replace(/https?:\/\/\S+/g, '')) add('missing-conditions', 'Beschreibung und Einloesebedingungen fehlen.');
  if (!text(deal.brand) || /^(?:Instagram|TikTok|Community Fund)$/i.test(deal.brand)) add('missing-merchant', 'Tatsaechlichen Anbieter bestaetigen.');
  const dates = ['validOn','validFrom','validUntil'].filter(key => deal[key]);
  if (dates.some(key => !exactDay(deal[key]))) add('invalid-date', 'Datumsfeld ungueltig; nicht automatisch raten.');
  if (!dates.length) add('period-unconfirmed', 'Aktionszeitraum oder dauerhafte Gueltigkeit pruefen.');
  if (deal.validFrom && deal.validUntil && deal.validFrom > deal.validUntil) add('conflicting-period', 'Beginn liegt nach dem Ende.');
  const end = deal.validUntil || deal.validOn;
  if (today && exactDay(end) && end < today) add('stored-end-past', 'Gespeichertes Ende liegt zurueck; Quelle vor Entfernung pruefen.');
  if (deal.approvalBlock || deal.metaGraphBlockingReason || deal.validity?.status === 'blocked') add('source-blocked', 'Bestehende Quellensperre bleibt wirksam.');
  if (deal.evidence?.media && process.env.COUPON_TOOLS_AVAILABLE === '0') add('media-deferred', 'Bild/PDF-Pruefung wartet auf OCR-Werkzeuge.');
  if (mapReview && !['mapped','online-only'].includes(mapReview.status)) add('map-incomplete', 'Einloesestandorte sind noch nicht vollstaendig bestaetigt.');
  const raw = [deal.metaGraphCaption, deal.metaGraphOcrText, deal.caption, deal.evidence?.textSample,
    deal.evidence?.offerTiming?.matchedText].map(text).filter(Boolean);
  if (!raw.length) add('evidence-missing', 'Kein gespeicherter Originaltext fuer automatische Korrektur.');
  return { id:deal.id, issues, requiresReview:issues.length > 0,
    publicationMode:'human-approval', automaticPublicationAllowed:false,
    fingerprint:createHash('sha256').update(JSON.stringify([deal.title,deal.description,deal.brand,dates.map(k=>[k,deal[k]]),raw,mapReview?.status,mapReview?.locationIds])).digest('hex') };
}

export function sourceQualitySlackText(deal) {
  const result = inspectSourceBackedQuality(deal);
  const actionable = result.issues.filter(issue => !['period-unconfirmed','evidence-missing'].includes(issue.code));
  return actionable.length ? `INTERN Qualitaet: ${actionable.map(issue=>issue.label).join(' ')} Keine automatische Freigabe.` : '';
}

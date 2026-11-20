import { createHash } from 'node:crypto';
import { isFoodDrinkFeedbackEvent, foodDrinkScore } from '../scraper/social-food-audit-utils.js';

const DAY = 86400000;
const messageTs = /^\d{10}\.\d{6}$/;
const receiptKey = (id, ts) => createHash('sha256').update(JSON.stringify([id, ts])).digest('hex');
const stages = () => ({ delivered: 0, approved: 0, public: 0 });
const breakdown = () => ({ all: stages(), food: stages(), other: stages() });

function deliveryTime(event, now) {
  const ts = event?.slackTs;
  if (!event?.dealId || !messageTs.test(ts) || ts === event.slackThreadTs) return null;
  const time = Math.trunc(Number(ts) * 1000);
  return time <= now && Number.isFinite(Date.parse(event.slackSentAt)) ? time : null;
}

function approved(event, deliveredAt, now) {
  const decisionAt = Date.parse(event.decidedAt);
  return event.decision === 'approved' && ['targeted-event', 'reaction-scan'].includes(event.decisionSource)
    && decisionAt >= deliveredAt - 1000 && decisionAt <= now;
}

function sourceOf(event) {
  return [event.originSource, event.source].find(source =>
    typeof source === 'string' && source.trim() && source !== 'Slack Digest')?.trim() || 'Unbekannt';
}

function addDeal(counter, food, hasApproval, isPublic) {
  for (const part of [counter.all, food ? counter.food : counter.other]) {
    part.delivered++;
    if (hasApproval) part.approved++;
    if (isPublic) part.public++;
  }
}

// Cohorts use the first retained confirmed message per deal ID. A retry cannot
// earn a second discovery. The public stage requires the approved message itself.
export function sourcePublicationYield(feedback, snapshot, previous, now = new Date()) {
  const asOf = +now;
  const publicNow = snapshot.status === 'ok';
  const observations = {};
  for (const [key, seen] of Object.entries(previous?.publicObservations || {})) {
    if (/^[a-f\d]{64}$/.test(key) && seen >= asOf - 30 * DAY && seen <= asOf) observations[key] = seen;
  }
  const report = {
    asOf: now.toISOString(),
    feedbackAvailable: Array.isArray(feedback?.events),
    publicReadback: snapshot.status,
    firstPublicCheck: previous?.firstPublicCheck || (publicNow ? now.toISOString() : null),
    lastPublicCheck: publicNow ? now.toISOString() : previous?.lastPublicCheck || null,
    windows: [], publicObservations: observations,
  };
  if (!report.feedbackAvailable) return report;

  const events = feedback.events.map(event => ({ event, time: deliveryTime(event, asOf) }))
    .filter(row => row.time !== null).sort((a, b) => a.time - b.time);
  const receipts = new Map();
  const ambiguous = new Set();
  for (const { event } of events) {
    if (receipts.has(event.slackTs) && receipts.get(event.slackTs) !== event.dealId) ambiguous.add(event.slackTs);
    receipts.set(event.slackTs, event.dealId);
  }
  if (publicNow) {
    for (const { id, slackTs } of snapshot.receipts) {
      if (receipts.get(slackTs) !== id || ambiguous.has(slackTs)) continue;
      if (Number(slackTs) * 1000 >= asOf - 30 * DAY) observations[receiptKey(id, slackTs)] = asOf;
    }
  }
  const deals = new Map();
  for (const { event, time } of events) {
    if (ambiguous.has(event.slackTs)) continue;
    if (!deals.has(event.dealId)) deals.set(event.dealId, {
      time, source: sourceOf(event), food: isFoodDrinkFeedbackEvent(event)
        || (event.category === 'supermarkt' && foodDrinkScore(event.title) > 0),
      hasApproval: false, isPublic: false,
    });
    if (!approved(event, time, asOf)) continue;
    const deal = deals.get(event.dealId);
    deal.hasApproval = true;
    if (observations[receiptKey(event.dealId, event.slackTs)]) deal.isPublic = true;
  }
  for (const days of [7, 30]) {
    const totals = breakdown(), bySource = new Map();
    for (const deal of deals.values()) {
      if (deal.time < asOf - days * DAY) continue;
      if (!bySource.has(deal.source)) bySource.set(deal.source, breakdown());
      addDeal(totals, deal.food, deal.hasApproval, deal.isPublic);
      addDeal(bySource.get(deal.source), deal.food, deal.hasApproval, deal.isPublic);
    }
    const sources = [...bySource].map(([source, counts]) => ({ source, ...counts }))
      .sort((a, b) => b.food.public - a.food.public || b.food.approved - a.food.approved
        || b.all.delivered - a.all.delivered || a.source.localeCompare(b.source));
    report.windows.push({ days, totals, sources });
  }
  return report;
}

export function formatSourcePublicationYield(report) {
  if (!report.feedbackAvailable) return '\n## Ertrag je Quelle\n\nSlack-Belege fehlen für diese Auswertung.\n';
  const lines = ['','## Ertrag je Quelle','',
    'Jeder Deal zählt ab seiner ersten belegten Slack-Zustellung einmal. Ein Häkchen erfordert eine dokumentierte menschliche Freigabe. Die letzte Stufe zählt freigegebene Deals, die mit derselben Nachrichtenkennung im öffentlichen Feed beobachtet wurden. Bereits verschwundene Angebote vor der ersten Beobachtung können fehlen.','',
    'Erste öffentliche Beobachtung: ' + (report.firstPublicCheck || 'ausstehend') +
    '. Letzte erfolgreiche Beobachtung: ' + (report.lastPublicCheck || 'ausstehend') + '.',''];
  for (const window of report.windows) {
    lines.push('### ' + window.days + ' Tage', '', '| Quelle | Essen zugestellt | Essen abgehakt | Essen öffentlich belegt | Weitere zugestellt | Weitere abgehakt | Weitere öffentlich belegt |',
      '|---|---:|---:|---:|---:|---:|---:|');
    for (const row of [{ source: 'Gesamt', ...window.totals }, ...window.sources]) {
      const source = row.source.replace(/[|\r\n<>]/g, ' ');
      lines.push(`| ${source} | ${row.food.delivered} | ${row.food.approved} | ${row.food.public} | ${row.other.delivered} | ${row.other.approved} | ${row.other.public} |`);
    }
    lines.push('');
  }
  return lines.join('\n') + '\n';
}

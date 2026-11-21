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
  // The saved confirmation time must actually belong to this Slack response.
  return time <= now && Math.abs(Date.parse(event.slackSentAt) - time) <= 300000 ? time : null;
}

function approvalTime(event, deliveredAt, now) {
  const decisionAt = Date.parse(event.decidedAt);
  return event.decision === 'approved' && ['targeted-event', 'reaction-scan'].includes(event.decisionSource)
    && decisionAt >= deliveredAt - 1000 && decisionAt <= now ? decisionAt : null;
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

// Compare the same weekdays and elapsed hours around the November rollout.
const discoveryPilotStart = Date.parse('2026-11-21T12:06:17Z');
const pilotDays = 14 * DAY;
function merchantCouponPilot(deals, asOf, publicNow, prior) {
  if (prior?.complete || asOf < discoveryPilotStart) return prior;
  const length = Math.min(pilotDays, asOf - discoveryPilotStart);
  const groups = () => ({ food: stages(), merchant: stages(), cashback: stages() });
  const before = groups(), after = groups();
  for (const deal of deals.values()) {
    if (!deal.food) continue;
    const since = deal.time - discoveryPilotStart;
    const group = since >= 0 && since < length ? after
      : since >= -pilotDays && since < length - pilotDays ? before : null;
    if (!group) continue;
    const counters = [group.food];
    if (deal.source === 'vienna-merchant-website') counters.push(group.merchant);
    if (deal.cashback) counters.push(group.cashback);
    for (const count of counters) {
      count.delivered++;
      if (deal.hasApproval) count.approved++;
      if (deal.isPublic) count.public++;
    }
  }
  return {
    startedAt: new Date(discoveryPilotStart).toISOString(), priorFrom: new Date(discoveryPilotStart - pilotDays).toISOString(),
    checkedAt: new Date(asOf).toISOString(), durationHours: length / 3600000, before, after,
    complete: publicNow && asOf >= discoveryPilotStart + pilotDays + DAY,
  };
}

// Cohorts use the first retained confirmed message per deal ID. A retry cannot
// earn a second discovery. The public stage requires the approved message itself.
export function sourcePublicationYield(feedback, snapshot, previous, now = new Date(), baseline = null) {
  const asOf = +now;
  const publicNow = snapshot.status === 'ok';
  const observations = {};
  for (const [key, seen] of Object.entries(previous?.publicObservations || {})) {
    if (/^[a-f\d]{64}$/.test(key) && seen >= asOf - 30 * DAY && seen <= asOf) observations[key] = seen;
  }
  let firstPublicCheck = previous?.firstPublicCheck || (publicNow ? now.toISOString() : null);
  let lastPublicCheck = publicNow ? now.toISOString() : previous?.lastPublicCheck || null;
  // Bootstrap from archived HTTP 200 readbacks whose feed bytes match the
  // repository document at the recorded commit. Each hash is a deal/message pair.
  for (const sample of baseline?.samples || []) {
    const at = Date.parse(sample.checkedAt);
    if (!Number.isFinite(at) || at < asOf - 30 * DAY || at > asOf || !Array.isArray(sample.receipts)) continue;
    if (!firstPublicCheck || at < Date.parse(firstPublicCheck)) firstPublicCheck = sample.checkedAt;
    if (!lastPublicCheck || at > Date.parse(lastPublicCheck)) lastPublicCheck = sample.checkedAt;
    for (const key of sample.receipts) {
      if (/^[a-f\d]{64}$/.test(key)) observations[key] = Math.max(at, observations[key] || 0);
    }
  }
  const approvedReceipts = {};
  for (const [key, at] of Object.entries(previous?.approvedReceipts || {})) {
    if (/^[a-f\d]{64}$/.test(key) && Number.isFinite(at) && at >= asOf - 30 * DAY && at <= asOf) approvedReceipts[key] = at;
  }
  const report = {
    asOf: now.toISOString(),
    feedbackAvailable: Array.isArray(feedback?.events),
    publicReadback: snapshot.status,
    firstPublicCheck, lastPublicCheck,
    windows: [], publicObservations: observations, approvedReceipts,
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
      cashback: sourceOf(event) === 'power-official-food'
        && /^https:\/\/www\.marktguru\.at\/mb\/[a-z0-9-]+-cashback-\d+$/.test(event.url || ''),
      hasApproval: false, isPublic: false,
    });
    if (time < asOf - 30 * DAY) continue;
    const key = receiptKey(event.dealId, event.slackTs);
    const at = approvalTime(event, time, asOf);
    if (at !== null) approvedReceipts[key] = Math.min(at, approvedReceipts[key] ?? at);
    if (approvedReceipts[key] === undefined) continue;
    const deal = deals.get(event.dealId);
    deal.hasApproval = true;
    if (observations[key] >= approvedReceipts[key] - 1000) deal.isPublic = true;
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
  const pilot = merchantCouponPilot(deals, asOf, publicNow, previous?.merchantCouponPilot);
  if (pilot) report.merchantCouponPilot = pilot;
  return report;
}

export function formatSourcePublicationYield(report) {
  if (!report.feedbackAvailable) return '\n## Ertrag je Quelle\n\nSlack-Belege fehlen für diese Auswertung.\n';
  const lines = ['','## Ertrag je Quelle','',
    'Jeder Deal zählt ab seiner ersten belegten Slack-Zustellung einmal. Die Freigabe zählt, sobald für die betreffende Nachricht ein menschliches Häkchen belegt ist. Die letzte Stufe zählt freigegebene Deals, die mit derselben Nachrichtenkennung im öffentlichen Feed beobachtet wurden. Kurzzeitig sichtbare Angebote zwischen zwei Beobachtungen und bereits vor der ersten Beobachtung entfernte Einträge können fehlen.','',
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
  const pilot = report.merchantCouponPilot;
  if (pilot) {
    lines.push('## Händlerseiten und Cashback im Vergleich', '',
      'Der Test begann am 21. November 2026 um 13:06 Uhr Wiener Zeit. Das Vergleichsfenster beginnt genau zwei Wochen früher. Beide Fenster umfassen dieselben Wochentage und bisher jeweils ' + pilot.durationHours.toFixed(1) + ' Stunden, höchstens 14 Tage.',
      '', '| Essensangebote | Slack vorher | Slack seit Start | Häkchen vorher | Häkchen seit Start | Öffentlich vorher | Öffentlich seit Start |',
      '|---|---:|---:|---:|---:|---:|---:|');
    for (const [key, title] of [['food','Alle Quellen'], ['merchant','Wiener Händlerseiten'], ['cashback','Direkte marktguru-Cashbacks']]) {
      const a = pilot.before[key], b = pilot.after[key];
      lines.push(`| ${title} | ${a.delivered} | ${b.delivered} | ${a.approved} | ${b.approved} | ${a.public} | ${b.public} |`);
    }
    lines.push('', 'Jeder Deal zählt nach seiner ersten belegten Zustellung. Freigaben und öffentliche Sichtungen werden bis zum Prüfstand nachgetragen. Ältere Nachrichten hatten mehr Zeit für ein Häkchen. Änderungen der Gesamtzahlen können auch von anderen Quellen stammen. Prüfstand ' + pilot.checkedAt + '.', '');
  }
  return lines.join('\n') + '\n';
}

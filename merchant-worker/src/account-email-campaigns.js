import { digestType, pickDigestDeals, viennaClock } from '../../referrals-worker/src/daily-push-policy.js';

const DAY = 86400000;
const HOME = 'https://freefinder.at/';
const FOOTER = '\n\nAngebote gelten nach den Bedingungen des jeweiligen Anbieters. Details und Verfügbarkeit bitte vor dem Besuch in FreeFinder prüfen.\n\nFreeFinder\nKontakt: freefinder.at@gmail.com\nDatenschutz: https://freefinder.at/privacy.html';

export function buildEmailDigest(feed, state, now = Date.now()) {
  const type = digestType(now);
  if (!type) return null;
  const deals = pickDigestDeals(feed, state, [], now, type);
  if (!deals.length) return null;
  const weekly = type === 'weekly_digest';
  const subject = weekly ? 'Deine Wiener Wochen-Highlights' : 'Entdecke neue Angebote in Wien';
  const text = subject + '\n\n' + deals.map(deal =>
    `${deal.title.trim()}${deal.brand && !deal.title.toLowerCase().includes(deal.brand.toLowerCase()) ? ` (${deal.brand})` : ''}\n${HOME}?deal=${encodeURIComponent(deal.id)}`
  ).join('\n\n') + FOOTER;
  return { logicalId: `digest:${type}:${viennaClock(now).day}`, preference: weekly ? 'weeklyEmails' : 'dealEmails',
    createdAt: now, day: viennaClock(now).day, type, content: { subject, text } };
}

export function rewardEmail(account, env, now = Date.now()) {
  if (env.REFERRAL_MONTHS_ENABLED !== '1' || account.preferences?.rewardEmails !== true) return null;
  const reward = account.rewards?.find(r => r.state === 'earned' && r.months === 1 &&
    /^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/.test(r.id || '') &&
    r.createdAt <= now && r.createdAt > now - 7 * DAY && r.sourceEvidence?.version === 1 &&
    (!r.sourceReview || r.sourceReview.status === 'verified') && r.reconciliation?.status !== 'manual_review');
  if (!reward) return null;
  return { logicalId: 'reward:' + reward.id, preference: 'rewardEmails', content: {
    subject: 'Deine Einladung wurde bestätigt',
    text: 'In FreeFinder steht ein verdienter Gratis-Monat für dich bereit. Öffne in der App „Freunde einladen“ und „Deine Belohnungen“, um den Monat einzulösen.\n\nEine Gutschrift ändert ein laufendes Store-Abo nicht automatisch. Prüfe die Bedingungen beim Einlösen. Ein neues Probeabo verlängert sich nach dem Gratis-Monat kostenpflichtig, sofern du nicht rechtzeitig kündigst.' + FOOTER,
  } };
}

async function feedJSON(url) {
  const response = await fetch(url, { redirect: 'manual', signal: AbortSignal.timeout(5000), headers: { 'cache-control': 'no-cache' } });
  if (!response.ok) { await response.body?.cancel(); throw Error('Feed unavailable'); }
  const reader = response.body?.getReader();
  if (!reader) throw Error('Missing feed');
  let size = 0; const chunks = [];
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > 1048576) { await reader.cancel(); throw Error('Feed too large'); }
    chunks.push(value);
  }
  return JSON.parse(await new Blob(chunks).text());
}

export async function scheduledAccountEmail(env, now = Date.now()) {
  if (env.ACCOUNT_EMAIL_ENABLED !== '1' || env.ACCOUNT_EMAIL_TRANSPORT_ENABLED !== '1' ||
      !env.RESEND_WEBHOOK_SECRET || !env.REFERRAL_MONTHS) return;
  const clock = viennaClock(now);
  if (clock.hour < 9 || clock.hour > 19) return;
  let digest = null;
  if (digestType(now)) {
    try {
      digest = buildEmailDigest(await feedJSON(HOME + 'deals.json'),
        await feedJSON('https://freefinder-referrals.freefinder-stefan.workers.dev/api/deals/state'), now);
    } catch { /* No verified feed means no deal email. Reward notices are independent. */ }
  }
  const ledger = env.REFERRAL_MONTHS.get(env.REFERRAL_MONTHS.idFromName('referral-months-v1'));
  // Each send owns a separate bounded DO request, never multiple 10s transports under one concurrency lock.
  for (let i = 0; i < 5; i++) {
    const response = await ledger.fetch('https://referrals.internal/email-tick', {
      method: 'POST', body: JSON.stringify({ digest }),
    });
    if (!response.ok) break;
    const result = await response.json();
    if (result.complete || result.state === 'quota') break;
  }
}

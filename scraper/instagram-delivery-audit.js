const key = deal => JSON.stringify([deal.id || '', deal.url || '']);
const isInstagramAI = deal => deal.originSource === 'instagram-ai-agent' || deal.source === 'Instagram AI Agent';
const isTikTok = deal => deal.originSource === 'tiktok-deals-scanner' || deal.source === 'TikTok';

// Observe the actual pipeline's survivors, rather than running a second set of
// filters that could disagree with delivery. Only confirmed sends count as new.
function buildDeliveryAudit({ candidates, stages, validation, selected, delivered = [], now = new Date() }, matches, scope) {
  const survivors = stages.map(({ reason, deals }) => ({ reason, keys: new Set(deals.map(key)) }));
  const decisions = new Map(validation.results.map(row => [key(row.deal), row.decision]));
  const selectedKeys = new Set(selected.map(key));
  const receipts = new Map(delivered.filter(deal => deal.slackTs).map(deal => [key(deal), deal]));
  const rows = candidates.filter(matches).map(deal => {
    const identity = key(deal);
    const stopped = survivors.find(stage => !stage.keys.has(identity));
    const decision = decisions.get(identity);
    let status = stopped?.reason;
    if (!status) {
      if (decision && !decision.allowed) status = 'validator-blocked';
      else if (selectedKeys.has(identity)) status = receipts.has(identity) ? 'slack-confirmed' : 'selected-not-confirmed';
      else status = decision?.allowed ? 'duplicate-in-run' : 'not-in-standard-lane';
    }
    return {
      id: deal.id, url: deal.url, title: deal.title, brand: deal.brand, status,
      reasons: decision?.reasons || [],
      sourceDate: decision?.sourceDate || '', sourceDateSource: decision?.sourceDateSource || '',
      declaredSourceDate: deal.sourcePublishedAt || '',
      slackTs: status === 'slack-confirmed' ? receipts.get(identity).slackTs : '',
      slackThreadTs: status === 'slack-confirmed' ? receipts.get(identity).slackThreadTs || '' : '',
    };
  });
  const counts = {};
  for (const row of rows) counts[row.status] = (counts[row.status] || 0) + 1;
  return { checkedAt: now.toISOString(), scope,
    extractedCandidates: rows.length, counts, rows };
}

export const buildInstagramDeliveryAudit = options => buildDeliveryAudit(options, isInstagramAI, 'instagram-ai-agent/standard-slack-lane');
export const buildTikTokDeliveryAudit = options => buildDeliveryAudit(options, isTikTok, 'tiktok-deals-scanner/standard-slack-lane');

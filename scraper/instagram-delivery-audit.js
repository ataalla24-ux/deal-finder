const key = deal => JSON.stringify([deal.id || '', deal.url || '']);
const isInstagramAI = deal => deal.originSource === 'instagram-ai-agent' || deal.source === 'Instagram AI Agent';

// Observe the actual pipeline's survivors, rather than running a second set of
// filters that could disagree with delivery. Only confirmed sends count as new.
export function buildInstagramDeliveryAudit({ candidates, stages, validation, selected, delivered = [], now = new Date() }) {
  const survivors = stages.map(({ reason, deals }) => ({ reason, keys: new Set(deals.map(key)) }));
  const decisions = new Map(validation.results.map(row => [key(row.deal), row.decision]));
  const selectedKeys = new Set(selected.map(key));
  const deliveredKeys = new Set(delivered.filter(deal => deal.slackTs).map(key));
  const rows = candidates.filter(isInstagramAI).map(deal => {
    const identity = key(deal);
    const stopped = survivors.find(stage => !stage.keys.has(identity));
    const decision = decisions.get(identity);
    let status = stopped?.reason;
    if (!status) {
      if (decision && !decision.allowed) status = 'validator-blocked';
      else if (selectedKeys.has(identity)) status = deliveredKeys.has(identity) ? 'slack-confirmed' : 'selected-not-confirmed';
      else status = decision?.allowed ? 'duplicate-in-run' : 'not-in-standard-lane';
    }
    return {
      id: deal.id, url: deal.url, title: deal.title, brand: deal.brand, status,
      reasons: decision?.reasons || [],
      sourceDate: decision?.sourceDate || '', sourceDateSource: decision?.sourceDateSource || '',
      declaredSourceDate: deal.sourcePublishedAt || '',
    };
  });
  const counts = {};
  for (const row of rows) counts[row.status] = (counts[row.status] || 0) + 1;
  return { checkedAt: now.toISOString(), scope: 'instagram-ai-agent/standard-slack-lane',
    extractedCandidates: rows.length, counts, rows };
}

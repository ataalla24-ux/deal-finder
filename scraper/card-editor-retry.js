import { needsCardEditorial } from './deal-card-editor.js';

// Update only untouched, unapproved Slack cards, never create another message.
export async function retryQueuedEditorial(deals, { editCard, isUntouched, updateMessage,
  persist, liveIds = new Set(), maxDeals = 3, maxChecks = 12, now = new Date() }) {
  const next = [...deals];
  let attempts = 0;
  let checks = 0;
  for (let i = 0; i < next.length && attempts < maxDeals && checks < maxChecks; i++) {
    const deal = next[i];
    if (!deal.cardEditorial || !deal.slackTs || !deal.slackThreadTs || deal.approvalBlock
      || liveIds.has(deal.id) || !needsCardEditorial(deal, now)) continue;
    checks++;
    let edited;
    try {
      if (!await isUntouched(deal)) continue;
      attempts++;
      edited = await editCard(deal);
      if (edited === deal) continue;
      // Re-read reactions/replies after the API call in case a human acted.
      if (!await isUntouched(deal)) continue;
      if (!await updateMessage(edited)) continue;
    } catch {
      // Retain the original card and queue on API/Slack failure.
      continue;
    }
    next[i] = edited;
    // Persistence failures must fail the job, not report a successful retry.
    await persist(next);
  }
  return next;
}

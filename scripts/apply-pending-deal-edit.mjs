import fs from 'node:fs';

export function applyPendingEdit(document, edit) {
  const deal = document.deals.find(item => item.id === edit.dealId);
  if (!deal) throw new Error('Deal is no longer pending; no live data changed');
  const fields = ['title', 'brand', 'description', 'distance', 'url', 'expires'];
  for (const field of fields) {
    if (typeof edit[field] !== 'string') throw new Error(`Missing field: ${field}`);
  }
  if (edit.expires && !/^\d{4}-\d{2}-\d{2}$/.test(edit.expires)) throw new Error('Invalid expiry');
  const expiryChanged = String(deal.expires || '').slice(0, 10) !== edit.expires;
  for (const field of fields) deal[field] = edit[field];
  // An explicit date correction must not leave competing inferred dates behind.
  if (expiryChanged) {
    for (const field of ['validOn', 'validFrom', 'validUntil', 'expiresOriginal', 'expiryKind', 'expiryDisplayText']) delete deal[field];
    deal.validUntil = edit.expires;
    deal.expiresOriginal = edit.expires;
    deal.expirySource = 'slack.human-review';
    deal.expiresSource = 'slack.human-review';
  }
  deal.editedInSlack = true;
  deal.slackEditedAt = new Date().toISOString();
  deal.slackFormEditTs = String(Date.now() / 1000);
  deal.slackEditedFields = [...new Set([...(deal.slackEditedFields || []), ...fields])];
  return deal;
}

if (process.env.PENDING_DEAL_EDIT_PAYLOAD) {
  const file = 'docs/deals-pending-all.json';
  const document = JSON.parse(fs.readFileSync(file, 'utf8'));
  const edit = JSON.parse(process.env.PENDING_DEAL_EDIT_PAYLOAD);
  applyPendingEdit(document, edit);
  fs.writeFileSync(file, JSON.stringify(document, null, 2) + '\n');
}

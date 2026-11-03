import fs from 'node:fs';
import { normalizePendingEdit, pendingEditorValues, periodFields } from '../referrals-worker/src/pending-deal-editor.js';

export function applyPendingEdit(document, edit) {
  const deal = document.deals.find(item => item.id === edit.dealId);
  if (!deal) throw new Error('Deal is no longer pending; no live data changed');
  const normalized = normalizePendingEdit(edit);
  const hasPeriod = typeof normalized.validityText === 'string';
  const periodChanged = hasPeriod && pendingEditorValues(deal).validityText !== normalized.validityText;
  const fields = ['title', 'brand', 'description', 'distance', 'url'];
  const expiryChanged = !hasPeriod && String(deal.expires || '').slice(0, 10) !== normalized.expires;
  for (const field of fields) deal[field] = normalized[field];
  // The form's address is also structured evidence, not just card display text.
  deal.address = normalized.distance;
  fields.push('address');
  if (hasPeriod) {
    deal.validityText = normalized.validityText;
    fields.push('validityText', ...periodFields);
    if (periodChanged) {
      for (const field of periodFields) {
        delete deal[field];
        if (normalized[field] !== undefined) deal[field] = normalized[field];
      }
      deal.expirySource = 'slack.human-review';
      deal.expiresSource = 'slack.human-review';
    }
  } else {
    deal.expires = normalized.expires;
    fields.push('expires');
  }
  // An explicit date correction must not leave competing inferred dates behind.
  if (expiryChanged) {
    for (const field of ['validOn', 'validFrom', 'validUntil', 'expiresOriginal', 'expiryKind', 'expiryDisplayText']) delete deal[field];
    deal.validUntil = normalized.expires;
    deal.expiresOriginal = normalized.expires;
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

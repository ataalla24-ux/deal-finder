import fs from 'node:fs';
import { applyPendingEdit } from '../referrals-worker/src/pending-deal-editor.js';
export { applyPendingEdit };
if (process.env.PENDING_DEAL_EDIT_PAYLOAD) {
  const file = 'docs/deals-pending-all.json';
  const document = JSON.parse(fs.readFileSync(file, 'utf8'));
  const edit = JSON.parse(process.env.PENDING_DEAL_EDIT_PAYLOAD);
  if (/^community:/i.test(edit.dealId || '')) throw new Error('Community edits must use the private editor');
  applyPendingEdit(document, edit);
  fs.writeFileSync(file, JSON.stringify(document, null, 2) + '\n');
}

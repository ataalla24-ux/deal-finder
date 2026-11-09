import fs from 'node:fs';
import { privateCommunityRow } from './community-private-state.mjs';

const isInternal = row => privateCommunityRow(row) || /(?:^|\/)deals-pending-community\.json$/.test(row?.file || '');
const live = new Set(JSON.parse(fs.readFileSync('docs/deals.json', 'utf8')).deals.map(row => row.id));
const nonLiveInternal = row => isInternal(row) && !live.has(row.id || row.dealId);
const update = (file, callback) => {
  const data = JSON.parse(fs.readFileSync(file, 'utf8'));
  const before = JSON.stringify(data);
  callback(data);
  if (JSON.stringify(data) !== before) fs.writeFileSync(file, JSON.stringify(data, null, 2) + '\n');
};

// Run only after the private migration was verified. The old public commits
// remain in Git history; this removes current copies, not previous revisions.
fs.rmSync('docs/deals-pending-community.json', { force: true });
update('docs/deals-pending-all.json', data => {
  data.deals = data.deals.filter(row => !isInternal(row));
  data.totalDeals = data.deals.length;
});
update('docs/deal-review-feedback.json', data => { data.events = data.events.filter(row => !isInternal(row)); });
update('docs/deal-moderation-report.json', data => {
  data.removed = data.removed.filter(row => !nonLiveInternal(row));
  data.files = data.files.filter(row => !isInternal(row));
});
update('docs/instagram-graph-verification-report.json', data => {
  data.scannedFiles = data.scannedFiles.filter(file => file !== 'deals-pending-community.json');
  delete data.sourceCounts['deals-pending-community.json'];
});
update('reviews/server-operations-report.json', data => {
  data.sourceRecovery.rows = data.sourceRecovery.rows.filter(row => !isInternal(row));
});
update('reviews/server-quality-audit.json', data => {
  data.pending.rows = data.pending.rows.filter(row => !isInternal(row));
});
update('reviews/automatic-publication-review-pack.json', data => {
  data.cases = data.cases.filter(row => !isInternal(row));
});
update('reviews/automatic-publication-pilot.json', data => {
  data.samples = data.samples.filter(row => !isInternal(row));
  if (data.archivedSamples) data.archivedSamples = data.archivedSamples.filter(row => !isInternal(row));
});

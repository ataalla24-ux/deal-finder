#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { polishOfferTitle } from '../scraper/offer-title-utils.js';

// Existing IDs, order, validity and human edits are not part of title cleanup.
export function polishLiveDealTitles(bundle) {
  if (!Array.isArray(bundle?.deals)) throw new Error('Missing deals array');
  const changes = [];
  const deals = bundle.deals.map(deal => {
    const edited = new Set(deal.liveEditedFields || []);
    if (edited.has('title')) return deal;
    const title = polishOfferTitle(deal.title, deal.description);
    if (title === deal.title) return deal;
    let description = deal.description || '';
    if (!description.includes(deal.title)) {
      if (edited.has('description')) return deal;
      description = [description, deal.title].filter(Boolean).join(' ');
    }
    changes.push({ id: deal.id, before: deal.title, after: title });
    return { ...deal, title, description };
  });
  return { bundle: { ...bundle, deals }, changes };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const file = path.resolve('docs/deals.json');
  const result = polishLiveDealTitles(JSON.parse(fs.readFileSync(file, 'utf8')));
  console.log(JSON.stringify(result.changes, null, 2));
  if (process.argv.includes('--apply')) {
    fs.writeFileSync(file, JSON.stringify(result.bundle, null, 2) + '\n');
  } else console.log('Dry run; use --apply to write only these title corrections.');
}

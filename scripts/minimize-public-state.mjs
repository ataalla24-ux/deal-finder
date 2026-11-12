import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { redactPublishedCommunityDraft } from './community-public-boundary.mjs';
import { computeDealsFeedVersion } from './deals-feed-contract.mjs';

export const MINIMIZED_PUBLIC_FILES = ['docs/deal-review-feedback.json', 'docs/deals.json', 'docs/verified-expiry-review.json'];

export function minimizePublicState(file, data) {
  if (file === 'docs/deal-review-feedback.json') {
    if (!Array.isArray(data.events)) throw Error('Invalid review feedback shape');
    return {...data, events: data.events.map(({decisionUser, ...event}) => event)};
  }
  if (file === 'docs/deals.json') {
    if (!Array.isArray(data.deals)) throw Error('Invalid live feed shape');
    const deals = data.deals.map(redactPublishedCommunityDraft);
    if (JSON.stringify(deals) === JSON.stringify(data.deals)) return data;
    return {...data, deals, feedVersion: computeDealsFeedVersion(deals)};
  }
  if (file === 'docs/verified-expiry-review.json') {
    if (!Array.isArray(data.entries)) throw Error('Invalid expiry review shape');
    return {...data, entries: data.entries.map(entry => entry.originalDeal
      ? {...entry, originalDeal:redactPublishedCommunityDraft(entry.originalDeal)} : entry)};
  }
  return data;
}

export function minimizeCapturedPublicStates(states) {
  return states.map(state => {
    if (!state.exists || !MINIMIZED_PUBLIC_FILES.includes(state.path)) return state;
    const old = JSON.parse(state.content.toString('utf8'));
    const clean = minimizePublicState(state.path, old);
    return JSON.stringify(old) === JSON.stringify(clean) ? state
      : {...state, content: Buffer.from(`${JSON.stringify(clean, null, 2)}\n`)};
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  for (const file of MINIMIZED_PUBLIC_FILES) {
    if (!fs.existsSync(file)) continue;
    const data = JSON.parse(fs.readFileSync(file, 'utf8'));
    const clean = minimizePublicState(file, data);
    if (JSON.stringify(data) === JSON.stringify(clean)) continue;
    const backup = path.join('output/github-hardening-backup', file);
    fs.mkdirSync(path.dirname(backup), {recursive:true});
    if (!fs.existsSync(backup)) fs.writeFileSync(backup, fs.readFileSync(file), {mode:0o600});
    fs.writeFileSync(file, `${JSON.stringify(clean, null, 2)}\n`);
    console.log(`Minimized ${file}; offer and decision data retained`);
  }
}

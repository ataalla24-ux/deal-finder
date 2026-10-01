import fs from 'node:fs';
import { pendingEditBlocks } from '../scraper/slack-notify.js';
const deals = JSON.parse(fs.readFileSync('docs/deals-pending-all.json','utf8')).deals;
if (!process.env.DEAL_REMOVE_LINK_SECRET) throw new Error('Missing link secret');
async function api(method, body, attempt = 0) {
  const read = method === 'conversations.replies';
  const response = await fetch(`https://slack.com/api/${method}${read ? '?' + new URLSearchParams(body) : ''}`, {
    method:read ? 'GET' : 'POST', headers:{Authorization:`Bearer ${process.env.SLACK_BOT_TOKEN}`,'Content-Type':'application/json'},
    ...(read ? {} : {body:JSON.stringify(body)}),
  });
  const result = await response.json();
  if ((response.status === 429 || result.error === 'ratelimited') && attempt < 6) {
    await new Promise(resolve => setTimeout(resolve, Math.max(2000, Number(response.headers.get('retry-after') || 30) * 1000)));
    return api(method, body, attempt + 1);
  }
  if (!result.ok) throw new Error(result.error);
  return result;
}
let updated = 0;
let alreadyPresent = 0;
const threads = new Map();
for (const deal of deals) {
  if (!deal.slackTs) continue;
  const channel = process.env.SLACK_CHANNEL_ID;
  const thread = deal.slackThreadTs || deal.slackTs;
  if (!threads.has(thread)) {
    const messages = [];
    let cursor = '';
    do {
      const result = await api('conversations.replies', {channel,ts:thread,limit:100,...(cursor ? {cursor} : {})});
      messages.push(...(result.messages || []));
      cursor = result.response_metadata?.next_cursor || '';
    } while (cursor);
    threads.set(thread,messages);
  }
  const message = threads.get(thread).find(item=>item.ts === deal.slackTs);
  if (!message?.text || !message.text.includes(`Deal-ID: ${deal.id}`)) continue;
  if (message.blocks?.some(block=>block.elements?.some(element=>element.action_id === 'freefinder_edit_pending'))) {alreadyPresent++; continue;}
  await api('chat.update',{channel,ts:deal.slackTs,text:message.text,blocks:pendingEditBlocks(message.text)});
  updated++;
  if (updated % 25 === 0) console.log(`Updated ${updated}; already present ${alreadyPresent}`);
  await new Promise(resolve=>setTimeout(resolve,1200));
}
console.log(`Added edit buttons to ${updated} existing pending messages; ${alreadyPresent} already had buttons`);

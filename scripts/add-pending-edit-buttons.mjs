import fs from 'node:fs';
import { pendingEditBlocks } from '../scraper/slack-notify.js';
const deals = JSON.parse(fs.readFileSync('docs/deals-pending-all.json','utf8')).deals;
if (!process.env.DEAL_REMOVE_LINK_SECRET) throw new Error('Missing link secret');
async function api(method, body) {
  const response = await fetch(`https://slack.com/api/${method}`, {
    method:'POST', headers:{Authorization:`Bearer ${process.env.SLACK_BOT_TOKEN}`,'Content-Type':'application/json'},
    body:JSON.stringify(body),
  });
  const result = await response.json();
  if (!result.ok) throw new Error(result.error);
  return result;
}
let updated = 0;
for (const deal of deals) {
  if (!deal.slackTs) continue;
  const channel = process.env.SLACK_CHANNEL_ID;
  const result = await api('conversations.replies', {channel,ts:deal.slackThreadTs || deal.slackTs,oldest:deal.slackTs,latest:deal.slackTs,inclusive:true,limit:1});
  const message = result.messages?.find(item=>item.ts === deal.slackTs);
  if (!message?.text || !message.text.includes(`Deal-ID: ${deal.id}`)) continue;
  await api('chat.update',{channel,ts:deal.slackTs,text:message.text,blocks:pendingEditBlocks(message.text)});
  updated++;
  await new Promise(resolve=>setTimeout(resolve,1200));
}
console.log(`Added edit buttons to ${updated} existing pending messages`);

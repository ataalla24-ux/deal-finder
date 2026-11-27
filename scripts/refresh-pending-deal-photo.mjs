import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {createDealImagePreviewCheck,prepareDealImagePreview,dealImagePreviewBlock} from '../scraper/deal-image-pilot.js';
import {advanceDealLifecycle} from '../scraper/deal-lifecycle.js';

function refreshedDraft(deal) {
  const next = {...deal};
  for (const field of ['slackTs','pendingDealImage','approvedDealImage','approvedAt','approvalBlock','photoUrl']) delete next[field];
  if (next.pipelineLifecycle) {
    next.pipelineLifecycle = {...next.pipelineLifecycle,stage:'slack-sent',manualDecision:'',manualDecisionAt:'',
      manualDecisionUser:'',publishedAt:''};
  }
  return next;
}

function messageIdentity(previousTs, subjectHash) {
  const digest = createHash('sha256').update(`${previousTs}:${subjectHash}`).digest('hex');
  return `${digest.slice(0,8)}-${digest.slice(8,12)}-5${digest.slice(13,16)}-a${digest.slice(17,20)}-${digest.slice(20,32)}`;
}

export async function refreshPendingDealPhoto(deal,{
  root=process.cwd(),now=new Date(),enabled=true,request=fetch,
  token=process.env.SLACK_BOT_TOKEN,channel=process.env.SLACK_CHANNEL_ID,
}={}) {
  const result = {deal,status:'unchanged'};
  if (!enabled || !deal?.imageApprovalRequired || !deal.slackTs
    || deal.approvedDealImage?.status === 'locked' || deal.pipelineLifecycle?.publishedAt
    || dealImagePreviewBlock(deal,{enabled:true,now}) && deal.pendingDealImage.slackMessageTs === deal.slackTs) return result;
  const unavailable = reason => ({deal,status:'unavailable',reason});
  if (!token || !channel || !deal.slackThreadTs) return unavailable('slack-context-unavailable');
  const staged = await prepareDealImagePreview(refreshedDraft(deal),{root,now,enabled:true,
    checkPreview:createDealImagePreviewCheck({request})});
  const image = dealImagePreviewBlock(staged,{enabled:true,now});
  if (!image) return unavailable('preview-unavailable');
  const {buildSlackMessage,pendingEditBlocks} = await import('../scraper/slack-notify.js');
  const text = `${buildSlackMessage(staged,deal.order || 1)}\nBitte Foto und Angebot prüfen und diese neue Nachricht mit ✅ freigeben.`.toWellFormed();
  const blocks = pendingEditBlocks(text,staged) || (text.match(/[\s\S]{1,2900}/gu) || [])
    .map(part => ({type:'section',text:{type:'mrkdwn',text:part}}));
  if (!blocks.some(block => block.type === 'image')) blocks.push(image);
  const slack = async (method,payload) => {
    try {
      const response = await request(`https://slack.com/api/${method}`,{method:'POST',redirect:'error',
        signal:AbortSignal.timeout(10_000),headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},
        body:JSON.stringify({channel,...payload})});
      const data = await response.json();
      return response.ok && data.ok ? data : null;
    } catch {return null;}
  };
  // Existing reactions belong to the previous picture. A replacement card gets
  // its own message identity so only a fresh reaction can approve the new file.
  const superseded = await slack('chat.update',{ts:deal.slackTs,blocks:[],
    text:'Bildvorschau nach Bearbeitung erneuert. Bitte die neue Deal-Nachricht in diesem Thread prüfen und dort ✅ setzen.',
    unfurl_links:false,unfurl_media:false});
  if (!superseded) return unavailable('slack-update-failed');
  const posted = await slack('chat.postMessage',{thread_ts:deal.slackThreadTs,text,blocks,
    client_msg_id:messageIdentity(deal.slackTs,staged.pendingDealImage.subjectHash),
    unfurl_links:false,unfurl_media:false});
  if (!posted || typeof posted.ts !== 'string' || !/^\d+\.\d+$/.test(posted.ts)) return unavailable('slack-post-failed');
  const next = advanceDealLifecycle({...staged,slackTs:posted.ts,
    // Prevent earlier edit commands from being replayed onto this new card.
    slackFormEditTs:posted.ts,
    pendingDealImage:{...staged.pendingDealImage,slackMessageTs:posted.ts,sentAt:now.toISOString(),
      supersedesSlackMessageTs:deal.slackTs},
  },'slack-sent',{at:now});
  return {deal:next,status:'refreshed',previousSlackTs:deal.slackTs};
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const file = 'docs/deals-pending-all.json';
  const edit = JSON.parse(process.env.PENDING_DEAL_EDIT_PAYLOAD || '{}');
  const document = JSON.parse(fs.readFileSync(file,'utf8'));
  const index = document.deals.findIndex(deal => deal.id === edit.dealId);
  if (index < 0) throw Error('Edited draft is no longer pending');
  const refreshed = await refreshPendingDealPhoto(document.deals[index]);
  if (refreshed.status === 'unavailable') throw Error(`Edited photo preview is pending (${refreshed.reason})`);
  if (refreshed.status === 'refreshed') {
    document.deals[index] = refreshed.deal;
    fs.writeFileSync(file,JSON.stringify(document,null,2)+'\n');
  }
  console.log(`Edited photo preview ${refreshed.status}`);
}

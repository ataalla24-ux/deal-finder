import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export function viennaQualitySlot({now = new Date(), event = '', schedule = ''} = {}) {
  if (event !== 'schedule') return {run:true,slot:'on-change-or-manual'};
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-GB',{timeZone:'Europe/Vienna',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',hourCycle:'h23'}).formatToParts(now).map(p=>[p.type,p.value]));
  const utcHour = Number(schedule.split(' ')[1]);
  const offset = (Number(parts.hour) - now.getUTCHours() + 24) % 24;
  const intended = (utcHour + offset) % 24;
  // GitHub can start cron jobs late, especially behind the shared writer queue.
  const delayHours = (now.getUTCHours() - utcHour + 24) % 24;
  return {run:[12,20].includes(intended) && delayHours < 4,
    slot:`${parts.year}-${parts.month}-${parts.day}T${String(intended).padStart(2,'0')}:00 Europe/Vienna`};
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const result = viennaQualitySlot({event:process.env.GITHUB_EVENT_NAME,schedule:process.env.QUALITY_CRON});
  if(process.env.GITHUB_OUTPUT) fs.appendFileSync(process.env.GITHUB_OUTPUT,`run=${result.run}\nslot=${result.slot}\n`);
  console.log(JSON.stringify(result));
}

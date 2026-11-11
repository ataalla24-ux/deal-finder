import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const noon = '12:13', evening = '20:13';
const clock = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Vienna', year: 'numeric', month: '2-digit',
  day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });

export function latestQualitySlot(now) {
  const p = Object.fromEntries(clock.formatToParts(now).map(part => [part.type, part.value]));
  const day = `${p.year}-${p.month}-${p.day}`;
  const time = `${p.hour}:${p.minute}`;
  if (time >= evening) return `${day}T${evening}`;
  if (time >= noon) return `${day}T${noon}`;
  const yesterday = new Date(Date.parse(day) - 86400000).toISOString().slice(0, 10);
  return `${yesterday}T${evening}`;
}

export function qualitySlotReceipt(previous, assigned, now) {
  const due = latestQualitySlot(now);
  return [previous, assigned].filter(value => typeof value === 'string'
    && /^\d{4}-\d{2}-\d{2}T(?:12:13|20:13)$/.test(value) && value <= due).sort().at(-1) || '';
}

export function viennaQualitySlot({now = new Date(), event = '', lastCompleted = ''} = {}) {
  if (event !== 'schedule') return {run:true,slot:'',reason:'on-change-or-manual'};
  const slot = latestQualitySlot(now);
  const complete = qualitySlotReceipt(lastCompleted, '', now) === slot;
  // A late or backup trigger picks only the newest due slot; never replay a backlog.
  return { run: !complete, slot, reason: complete ? 'already-completed' : 'due' };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  let lastCompleted = '';
  if (process.env.GITHUB_EVENT_NAME === 'schedule') {
    try {
      lastCompleted = JSON.parse(fs.readFileSync('reviews/server-operations-report.json', 'utf8')).lastScheduledQualitySlot;
    } catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
  const result = viennaQualitySlot({event:process.env.GITHUB_EVENT_NAME,lastCompleted});
  if(process.env.GITHUB_OUTPUT) fs.appendFileSync(process.env.GITHUB_OUTPUT,`run=${result.run}\nslot=${result.slot}\n`);
  console.log(JSON.stringify(result));
}

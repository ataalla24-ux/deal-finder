import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export function viennaBlogSlot({ now = new Date(), event = '', schedule = '' } = {}) {
  if (event !== 'schedule') return { run: true, slot: 'on-change-or-manual' };
  const localHour = Number(new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Vienna', hour: '2-digit', hourCycle: 'h23' }).format(now));
  const offset = (localHour - now.getUTCHours() + 24) % 24;
  const [minute, hour] = schedule.split(' ').map(Number);
  const intended = (hour + offset) % 24;
  const delayMinutes = (now.getUTCHours() * 60 + now.getUTCMinutes() - hour * 60 - minute + 1440) % 1440;
  return { run: intended === 8 && minute === 30 && delayMinutes < 240, slot: '08:30 Europe/Vienna' };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const result = viennaBlogSlot({ event: process.env.GITHUB_EVENT_NAME, schedule: process.env.BLOG_CRON });
  if (process.env.GITHUB_OUTPUT) fs.appendFileSync(process.env.GITHUB_OUTPUT, `run=${result.run}\n`);
  console.log(JSON.stringify(result));
}

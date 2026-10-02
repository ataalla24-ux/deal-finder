import assert from 'node:assert/strict';
import { buildSlackMessage, pendingEditBlocks, deliverySummary } from '../scraper/slack-notify.js';
process.env.DEAL_REMOVE_LINK_SECRET = 'test';
const text = buildSlackMessage({ id:'test',title:'Eintritt frei',description:'a'.repeat(179)+'🎉 mehr',distance:'Rotenturmstrasse 19' },1);
assert.ok(text.isWellFormed());
assert.ok(text.includes('🎉'));
for (const input of ['a'.repeat(2899)+'🎉 Deal-ID: test', 'a'.repeat(2898)+'🇦🇹 Deal-ID: test', '\ud83d Deal-ID: test']) {
  const blocks = pendingEditBlocks(input);
  const sections = blocks.filter(b=>b.type === 'section');
  assert.ok(sections.every(b=>b.text.text.isWellFormed()));
  assert.ok(sections.every(b=>Array.from(b.text.text).length <= 2900));
  assert.equal(sections.map(b=>b.text.text).join(''),input.toWellFormed());
  assert.equal(blocks.at(-1).elements[0].text.text,'Bearbeiten');
}
assert.ok(deliverySummary('',0,1).includes('Noch keine Deal-Nachricht zugestellt'));
assert.ok(deliverySummary('',1,2).includes('1 von 2'));
assert.ok(deliverySummary('',2,2).includes('Versand abgeschlossen'));
console.log('Slack Unicode boundaries and honest delivery counts passed');

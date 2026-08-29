import { chromium } from 'playwright';
const b = await chromium.launch();
const p = await (await b.newContext({ viewport:{width:1440,height:900} })).newPage();
p.on('pageerror', e => console.log('  [page error] ' + e.message));
await p.goto('file:///Users/kodywildfeuer/workroom/index.html');
await p.waitForFunction(() => document.querySelectorAll('.lane').length === 4);
await p.waitForTimeout(700);
const say=(k,v)=>console.log('  '+k.padEnd(36)+v);

const cards = () => p.locator('.card').count();
say('at head, cards', String(await cards()));
say('timeline reads', (await p.textContent('#atframe')).replace(/\s+/g,' ').trim());

// scrub back to the very first frame — the world should be empty there
await p.locator('#scrub').fill('0');
await p.dispatchEvent('#scrub', 'input');
await p.waitForTimeout(300);
say('at frame 0, cards', String(await cards()));
say('frame 0 is the genesis', /frame 0 /.test(await p.textContent('#atframe')) ? 'yes' : 'NO');
say('board marked as past', String(await p.evaluate(() => document.body.classList.contains('past'))));
say('editing hidden while rewound', String(await p.locator('.add').first().isVisible().catch(() => false)));

// walk forward and watch it build
const counts = [];
for (const n of ['3','6','9','12']) {
  await p.locator('#scrub').fill(n); await p.dispatchEvent('#scrub', 'input');
  await p.waitForTimeout(160); counts.push(await cards());
}
say('cards as it replays', counts.join(' → '));
say('it grows', String(counts[counts.length-1] >= counts[0]));

// a write while rewound must be refused
await p.locator('#scrub').fill('4'); await p.dispatchEvent('#scrub', 'input');
await p.waitForTimeout(150);
const before = await p.evaluate(() => JSON.parse(localStorage.getItem('workroom.frames')).length);
await p.evaluate(() => addCard('now', 'should not be written'));
await p.waitForTimeout(300);
const after = await p.evaluate(() => JSON.parse(localStorage.getItem('workroom.frames')).length);
say('write while rewound refused', String(after === before));
say('and says why', /earlier frame/i.test(await p.textContent('#status')) ? 'yes' : 'NO');

// return to now
await p.click('#now'); await p.waitForTimeout(300);
say('return to now restores head', String(await cards()));
say('no longer past', String(!(await p.evaluate(() => document.body.classList.contains('past')))));

// and the replay button runs
await p.click('#play'); await p.waitForTimeout(900);
const mid = await p.textContent('#atframe');
await p.waitForTimeout(6000);
say('replay ran and landed at head', /frame \d+ \/ \d+/.test(await p.textContent('#atframe'))
  && await p.evaluate(() => viewAt === null) ? 'yes' : 'still at ' + mid.slice(0,18));
await p.screenshot({ path: '/Users/kodywildfeuer/workroom/shot.png' });
await b.close();

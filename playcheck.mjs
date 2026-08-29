import { chromium } from 'playwright';
const b = await chromium.launch();
const p = await (await b.newContext({ viewport:{width:1440,height:900} })).newPage();
p.on('pageerror', e => console.log('  [page error] ' + e.message));
await p.goto('file:///Users/kodywildfeuer/workroom/index.html');
await p.waitForFunction(() => document.querySelectorAll('.lane').length === 4);
await p.waitForTimeout(700);
const say=(k,v)=>console.log('  '+k.padEnd(34)+v);

await p.click('#play');
await p.waitForTimeout(900);
say('caption visible while playing', String(await p.locator('#caption').isVisible()));
say('caption reads', (await p.textContent('#caption')).replace(/\s+/g,' ').trim().slice(0,58));
say('a card is lit', String(await p.locator('.card.acting, .card.arriving').count() > 0));
say('ledger follows', String(await p.locator('.frame.at').count()));

// sample the board as it plays, and grab frames for a filmstrip
const shots = [];
for (let i = 0; i < 5; i++) {
  await p.waitForTimeout(1400);
  shots.push(await p.locator('.card').count());
  await p.screenshot({ path: `/tmp/play-${i}.png` });
}
say('cards over time', shots.join(' → '));
await p.waitForTimeout(9000);
say('landed at head', String(await p.evaluate(() => viewAt === null)));
say('caption hidden when stopped', String(!(await p.locator('#caption').isVisible())));
await b.close();

import { chromium } from 'playwright';
const b = await chromium.launch();
const ctx = await b.newContext({ viewport: { width: 1440, height: 900 } });
const p = await ctx.newPage();
p.on('pageerror', e => console.log('  [page error] ' + e.message));
await p.goto('file:///Users/kodywildfeuer/workroom/index.html');
await p.waitForFunction(() => document.querySelectorAll('.lane').length === 4);
await p.waitForTimeout(800);
const say=(k,v)=>console.log('  '+k.padEnd(34)+v);
say('opens with cards', String(await p.locator('.card').count()));
say('status', (await p.textContent('#status')).replace(/\s+/g,' ').trim().slice(0,72));
say('agent-authored cards visible', String(await p.locator('.who.agent').count()));
say('scenario picker options', String(await p.locator('#scenario option').count()));
// flip to another scenario mid-work
p.on('dialog', d => d.accept());
await p.selectOption('#scenario', 'incident');
await p.waitForTimeout(700);
say('after flip: cards', String(await p.locator('.card').count()));
say('after flip: status', (await p.textContent('#status')).replace(/\s+/g,' ').trim().slice(0,66));
// verify the loaded chain
await p.click('#verify'); await p.waitForTimeout(500);
say('verify', (await p.textContent('#status')).replace(/\s+/g,' ').trim().slice(-58));
// agents keep working
const before = await p.evaluate(() => JSON.parse(localStorage.getItem('workroom.frames')).length);
await p.click('#agents');
say('agents toggle', await p.textContent('#agents-label'));
await p.evaluate(() => { agentTick(); });
await p.waitForTimeout(600);
const after = await p.evaluate(() => JSON.parse(localStorage.getItem('workroom.frames')).length);
say('an agent appended', String(after > before));
await p.click('#verify'); await p.waitForTimeout(500);
say('still verifies after agent work', /all \d+ frames verified/i.test(await p.textContent('#status')) ? 'yes' : 'NO');
await p.screenshot({ path: '/Users/kodywildfeuer/workroom/shot.png' });
await b.close();

/* Same defect, but every archive entry created by the app itself (8 real forks). */
import { chromium } from 'playwright';
const URL = 'file:///Users/kodywildfeuer/workroom/index.html';
const b = await chromium.launch();
const ctx = await b.newContext({ viewport: { width: 1400, height: 900 } });
const A = await ctx.newPage();
A.on('pageerror', e => console.log('[A pageerror]', e.message));
A.on('dialog', d => d.accept());
await A.goto(URL);
await A.waitForFunction(() => document.querySelectorAll('.lane').length === 4);
await A.waitForTimeout(600);

for (let i = 0; i < 8; i++) {
  await A.click('#fork');
  await A.waitForTimeout(1400);
}
const arch1 = await A.evaluate(() => {
  const a = JSON.parse(localStorage.getItem('workroom.streams'));
  return Object.entries(a).map(([k, v]) => ({ name: v.name, at: v.at, n: v.frames.length, k: k.slice(-8) }));
});
console.log('archive after 8 real forks:', arch1.length, 'entries');
arch1.forEach(e => console.log('   ', e.k, e.at, e.n + ' frames', e.name));
const oldest = arch1.slice().sort((x, y) => x.at - y.at)[0];
console.log('oldest entry:', oldest.k, oldest.name, oldest.n + ' frames');

const B = await ctx.newPage();
B.on('dialog', d => d.accept());
await B.goto(URL);
await B.waitForFunction(() => document.querySelectorAll('.lane').length === 4);
await B.waitForTimeout(600);
await B.evaluate(() => addCard('next', 'B writes while A is looking away'));
await B.waitForTimeout(800);
console.log('B frames:', await B.evaluate(() => frames.length));

await A.bringToFront();
const sBefore = await A.evaluate(() => streamId);
await A.click('#fork');
await A.waitForTimeout(2500);
const out = await A.evaluate(() => ({
  status: document.body.innerText.match(/refused:[^\n]*/)?.[0] || '(none)',
  same: streamId,
  arch: Object.keys(JSON.parse(localStorage.getItem('workroom.streams'))).map(k => k.slice(-8)),
}));
console.log('status:', out.status);
console.log('fork refused, streamId unchanged:', out.same === sBefore);
console.log('archive keys now:', out.arch.join(' '));
console.log('OLDEST DIMENSION (' + oldest.k + ') SURVIVED:', out.arch.includes(oldest.k));
await b.close();

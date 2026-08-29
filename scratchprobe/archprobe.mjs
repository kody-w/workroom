/* adversarial probe: does a REFUSED (stale) fork still mutate workroom.streams
 * and evict the oldest archived dimension? */
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

const a0 = await A.evaluate(() => ({ stream: streamId, n: frames.length }));
console.log('A live stream frames:', a0.n);

// seed 8 previously-left dimensions, exactly as archiveCurrent would have written them
await A.evaluate(() => {
  const a = {};
  for (let i = 0; i < 8; i++) {
    a['rappid:@kody-w/workroom:' + String(i).repeat(64) + ':' + String(i).repeat(16)] =
      { name: 'dimension ' + i, frames: new Array(16).fill(0).map((_, s) => ({ seq: s })), at: 1000 + i };
  }
  localStorage.setItem('workroom.streams', JSON.stringify(a));
});
const before = await A.evaluate(() => Object.values(JSON.parse(localStorage.getItem('workroom.streams'))).map(v => v.name));
console.log('archive before:', before.join(', '));

// B appends one card through the real door -> A is now stale
const B = await ctx.newPage();
B.on('dialog', d => d.accept());
await B.goto(URL);
await B.waitForFunction(() => document.querySelectorAll('.lane').length === 4);
await B.waitForTimeout(600);
const bSame = await B.evaluate(() => streamId);
console.log('B on the same stream as A:', bSame === a0.stream);
await B.evaluate(() => addCard('next', 'B writes while A is looking away'));
await B.waitForTimeout(800);
const bN = await B.evaluate(() => frames.length);
console.log('B frames after write:', bN);

// A forks (A still holds the old head in memory)
await A.bringToFront();
const aStreamBefore = await A.evaluate(() => streamId);
await A.click('#fork');
await A.waitForTimeout(2500);

const after = await A.evaluate(() => ({
  status: (document.querySelector('#status') || {}).textContent || document.body.innerText.match(/refused[^\n]*/)?.[0] || '(no #status)',
  stream: streamId,
  archive: Object.values(JSON.parse(localStorage.getItem('workroom.streams') || '{}')).map(v => v.name),
  diskFrames: JSON.parse(localStorage.getItem('workroom.frames')).length,
}));
console.log('A status  :', after.status);
console.log('A streamId unchanged (fork refused):', after.stream === aStreamBefore);
console.log('disk frames (B\'s write intact):', after.diskFrames);
console.log('archive after :', after.archive.join(', '));
console.log('dimension 0 still present:', after.archive.includes('dimension 0'));
console.log('archive size  :', after.archive.length);
await b.close();

/* same thing, but through the real ⑂ button mid-run — is the door actually open? */
import { chromium } from 'playwright';
const b = await chromium.launch();
const ctx = await b.newContext({ viewport: { width: 1440, height: 900 }, acceptDownloads: true });
const p = await ctx.newPage();
p.on('dialog', d => d.accept());
p.on('download', d => d.saveAs('/dev/null').catch(() => {}));
await p.goto('file:///Users/kodywildfeuer/workroom/index.html');
await p.waitForFunction(() => document.querySelectorAll('.lane').length === 4);
await p.waitForTimeout(700);
const s0 = await p.evaluate(() => streamId);
await p.click('#dryrun');
await p.waitForTimeout(1300);
const btn = await p.evaluate(() => {
  const e = document.getElementById('fork');
  const r = e.getBoundingClientRect();
  return { text: e.textContent.trim(), disabled: !!e.disabled, visible: r.width > 0 && r.height > 0,
           pointer: getComputedStyle(e).pointerEvents, running: !!runSession };
});
console.log('fork button mid-run: ' + JSON.stringify(btn));
await p.click('#fork');           // a real user click
await p.waitForTimeout(500);
const s1 = await p.evaluate(() => ({ stream: streamId, running: !!runSession, n: frames.length }));
console.log('after real click: streamChanged=' + (s1.stream !== s0) + ' runStillAlive=' + s1.running + ' frames=' + s1.n);
await p.waitForFunction(() => runSession === null, null, { timeout: 180000 });
const end = await p.evaluate(() => ({ n: frames.length, st: document.querySelector('#status').textContent.trim() }));
console.log('end frames=' + end.n + '  status=' + end.st);
await b.close();

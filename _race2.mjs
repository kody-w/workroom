import { chromium } from 'playwright';
const URL = 'file:///private/tmp/claude-501/-Users-kodywildfeuer/8abddf55-7823-48b1-b9d9-d9f458ebe875/scratchpad/head.html';
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await ctx.newPage();
page.on('pageerror', e => console.log('  [page error] ' + e.message));
page.on('dialog', d => d.accept());
await page.goto(URL);
await page.evaluate(() => localStorage.clear());
await page.reload();
await page.waitForFunction(() => document.querySelectorAll('.lane').length === 4);
console.log('HEAD seed frames', await page.evaluate(() => frames.length));

// how long is board stale after the ✕ handler starts?
console.log('window(ms) of one removeCard append:', await page.evaluate(async () => {
  const id = Object.keys(board.cards)[0];
  const t = performance.now(); await removeCard(id); return +(performance.now() - t).toFixed(2);
}));

// the race: ✕ handler enqueues remove, timer callback fires before board reprojects
const r = await page.evaluate(async () => {
  const id = Object.keys(board.cards)[0];
  agentsOn = true;
  const ids = Object.keys(board.cards); const idx = ids.indexOf(id);
  const real = Math.random; let n = 0;
  Math.random = () => { n++; return n === 1 ? 0 : n === 2 ? 0.1 : n === 3 ? idx / ids.length : 0; };
  const a = removeCard(id);                  // the user's ✕
  const b = agentTick();                     // the 9s setInterval callback
  await Promise.all([a, b]); Math.random = real;
  const last = frames[frames.length - 1];
  return { n: frames.length, last: last.payload.event, who: last.payload.who,
           same: last.payload.card === id, verify: await verifyChain(frames, streamId) };
});
console.log('after the race:', JSON.stringify(r));
console.log('what the Verify button says:',
  await page.evaluate(async () => { document.getElementById('verify').click();
    await new Promise(r => setTimeout(r, 300)); return document.getElementById('status').textContent; }));

await page.reload(); await page.waitForTimeout(700);
console.log('after reload -> cards', await page.locator('.card').count(),
  '| refused', await page.evaluate(() => !!refused),
  '|', (await page.textContent('#status')).slice(0, 120));
console.log('any further append accepted?', await page.evaluate(async () => {
  const b = frames.length; await append({ event: 'card.added', card: 'aa'.repeat(8), lane: 'next', title: 'x' });
  return frames.length !== b; }));
console.log('import a good chain to recover?', await page.evaluate(() => {
  const t = document.getElementById('io'); return !!t; }));

// realistic offsets: does a tick landing 1 macrotask later still hit it?
for (const gap of [0, 1, 2]) {
  const p = await ctx.newPage(); p.on('dialog', d => d.accept());
  await p.goto(URL); await p.evaluate(() => localStorage.clear()); await p.reload();
  await p.waitForTimeout(500);
  const res = await p.evaluate(async (gap) => {
    const id = Object.keys(board.cards)[0]; agentsOn = true;
    const ids = Object.keys(board.cards); const idx = ids.indexOf(id);
    const real = Math.random; let n = 0;
    Math.random = () => { n++; return n === 1 ? 0 : n === 2 ? 0.1 : n === 3 ? idx / ids.length : 0; };
    const a = removeCard(id);
    await new Promise(r => setTimeout(r, gap));
    const b = agentTick(); await Promise.all([a, b]); Math.random = real;
    return (await verifyChain(frames, streamId));
  }, gap);
  console.log(`tick ${gap}ms after the ✕ click ->`, JSON.stringify(res));
  await p.close();
}
await browser.close();

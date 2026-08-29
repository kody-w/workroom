import { chromium } from 'playwright';
const URL = 'file:///Users/kodywildfeuer/workroom/index.html';
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await ctx.newPage();
page.on('pageerror', e => console.log('  [page error] ' + e.message));
page.on('dialog', d => d.accept());
await page.goto(URL);
await page.waitForFunction(() => document.querySelectorAll('.lane').length === 4);
console.log('seed frames', (await page.evaluate(() => JSON.parse(localStorage.getItem('workroom.frames')).length)));

// --- experiment 1: how wide is the window? measure remove-append duration
const win = await page.evaluate(async () => {
  const id = Object.keys(board.cards)[0];
  const t0 = performance.now();
  await removeCard(id);
  return performance.now() - t0;
});
console.log('E1 removeCard() append duration ms =', win.toFixed(2));

// --- experiment 2: claimed co-run remove + agentTick on the SAME card
const r2 = await page.evaluate(async () => {
  const id = Object.keys(board.cards)[0];
  // force agentTick to pick this card and the move branch
  const realRandom = Math.random;
  let n = 0;
  agentsOn = true;
  const ids = Object.keys(board.cards);
  const idx = ids.indexOf(id);
  Math.random = () => { n++; if (n === 1) return 0; if (n === 2) return 0.1; if (n === 3) return idx / ids.length; return 0; };
  const a = removeCard(id);      // enqueued first
  const b = agentTick();         // reads board.cards (stale) and enqueues second
  await Promise.all([a, b]);
  Math.random = realRandom;
  const fr = JSON.parse(localStorage.getItem('workroom.frames'));
  const last = fr[fr.length - 1];
  return { n: fr.length, lastEvent: last.payload.event, who: last.payload.who,
           sameCard: last.payload.card === id, seq: last.seq };
});
console.log('E2 after co-run:', JSON.stringify(r2));

// what does the app's own verifier say now?
const v = await page.evaluate(async () => (await verifyChain(frames, streamId)));
console.log('E2 verifyChain:', JSON.stringify(v));

// --- experiment 3: reload. is it bricked?
await page.reload();
await page.waitForTimeout(600);
console.log('E3 after reload: cards =', await page.locator('.card').count(),
            '| refused =', await page.evaluate(() => !!refused),
            '| status =', (await page.textContent('#status')).slice(0, 140));
console.log('E3 append blocked?', await page.evaluate(async () => {
  const before = frames.length;
  await append({ event: 'card.added', card: 'deadbeefdeadbeef', lane: 'next', title: 'x', note: '', who: '' });
  return frames.length === before;
}));

// --- experiment 4: pure-UI trigger without touching internals.
// fresh page, seeded; click the same card's ✕ twice fast (no agents at all)
const p2 = await ctx.newPage();
p2.on('dialog', d => d.accept());
await p2.goto(URL);
await p2.waitForTimeout(300);
await p2.evaluate(() => localStorage.clear());
await p2.reload();
await p2.waitForTimeout(600);
const before = await p2.evaluate(() => frames.length);
const x = p2.locator('.card').first().locator('button', { hasText: '✕' });
await x.click({ delay: 0 });
await x.click({ delay: 0 }).catch(e => console.log('  second click threw:', e.message.slice(0, 60)));
await p2.waitForTimeout(800);
console.log('E4 double-✕ frames', before, '->', await p2.evaluate(() => frames.length),
            '| verify:', JSON.stringify(await p2.evaluate(async () => await verifyChain(frames, streamId))));

// --- experiment 5: realistic timing — timer firing during a real ✕ click
const p3 = await ctx.newPage();
p3.on('dialog', d => d.accept());
await p3.goto(URL);
await p3.waitForTimeout(300);
await p3.evaluate(() => localStorage.clear());
await p3.reload();
await p3.waitForTimeout(600);
const r5 = await p3.evaluate(async () => {
  // agents on, but drive the tick ourselves at a realistic offset: fire it as a
  // macrotask a hair after the ✕ handler starts, exactly as setInterval would.
  agentsOn = true;
  const id = Object.keys(board.cards)[0];
  const btns = [...document.querySelectorAll('button')].filter(b => b.textContent === '✕');
  const card = document.querySelector('.card');
  const b = card.querySelector('button:last-of-type');
  const p = removeCard(id);                 // simulates the click handler
  await new Promise(r => setTimeout(r, 0)); // a timer tick landing in the same ms
  const tick = agentTick();
  await Promise.all([p, tick]);
  return (await verifyChain(frames, streamId));
});
console.log('E5 tick 0ms after ✕:', JSON.stringify(r5));

await browser.close();

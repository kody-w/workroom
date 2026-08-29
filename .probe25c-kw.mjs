import { chromium } from 'playwright';
const URL = 'file:///Users/kodywildfeuer/workroom/index.html';
const browser = await chromium.launch();
const say = (k, v) => console.log('  ' + String(k).padEnd(46) + v);

/* C2: X -> import unrelated Y -> import OLD X directly (no restore in between) */
{
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await page.goto(URL);
  await page.waitForFunction(() => document.querySelectorAll('.lane').length === 4);
  const addUI = async (t) => {
    const i = page.locator('.lane').nth(0).locator('.add input');
    await i.fill(t); await i.press('Enter'); await page.waitForTimeout(150);
  };
  await addUI('x1');
  const early = await page.evaluate(() => JSON.stringify({ stream_id: streamId, frames }));
  await addUI('x2'); await addUI('x3');
  say('C2: live X frames', String(await page.evaluate(() => frames.length)));
  say('C2: head', JSON.stringify(await page.evaluate(() => load('workroom.head'))));

  const ctx2 = await browser.newContext();
  const p2 = await ctx2.newPage();
  await p2.goto(URL);
  await p2.waitForFunction(() => document.querySelectorAll('.lane').length === 4);
  const i2 = p2.locator('.lane').nth(0).locator('.add input');
  await i2.fill('y1'); await i2.press('Enter'); await p2.waitForTimeout(200);
  const streamY = await p2.evaluate(() => JSON.stringify({ stream_id: streamId, frames }));
  await ctx2.close();

  const doImport = async (text) => {
    await page.click('#import');
    await page.fill('#io-text', text);
    await page.click('#io-ok');
    await page.waitForTimeout(500);
    const s = (await page.textContent('#status')).replace(/\s+/g, ' ').trim();
    await page.evaluate(() => { const d = document.getElementById('io'); if (d.open) d.close(); });
    return s;
  };
  say('C2: import unrelated Y', (await doImport(streamY)).slice(20, 120));
  say('C2: import OLD X (rollback of X)', (await doImport(early)).slice(20, 140));
  say('C2: X frames on disk now', String(await page.evaluate(() => JSON.parse(localStorage.getItem('workroom.frames')).length)));
  say('C2: head now', JSON.stringify(await page.evaluate(() => load('workroom.head'))));
  await ctx.close();
}

/* D2: boot lowers a higher persisted head (show seq) */
{
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await page.goto(URL);
  await page.waitForFunction(() => document.querySelectorAll('.lane').length === 4);
  const i = page.locator('.lane').nth(0).locator('.add input');
  for (const t of ['d1', 'd2', 'd3']) { await i.fill(t); await i.press('Enter'); await page.waitForTimeout(150); }
  say('D2: head before', JSON.stringify(await page.evaluate(() => { const h = load('workroom.head'); return { seq: h.seq, fh: h.frame_hash.slice(0, 8) }; })));
  const snapEarly = await page.evaluate(() => JSON.stringify(frames.slice(0, 2)));
  await page.evaluate((s) => localStorage.setItem('workroom.frames', s), snapEarly);
  await page.reload(); await page.waitForTimeout(800);
  say('D2: boot status', (await page.textContent('#status')).replace(/\s+/g, ' ').trim().slice(18, 100));
  say('D2: head after', JSON.stringify(await page.evaluate(() => { const h = load('workroom.head'); return { seq: h.seq, fh: h.frame_hash.slice(0, 8) }; })));
  await ctx.close();
}

/* A2: how wide is the append race window, and does a throttled CPU hit it? */
{
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await page.goto(URL);
  await page.waitForFunction(() => document.querySelectorAll('.lane').length === 4);
  const i = page.locator('.lane').nth(0).locator('.add input');
  for (const t of ['a1', 'a2']) { await i.fill(t); await i.press('Enter'); await page.waitForTimeout(150); }
  const w = await page.evaluate(async () => {
    const t0 = performance.now();
    await buildFrame(streamId, frames.length, { event: 'card.moved', card: 'x', lane: 'now', titleAt: 'x' }, null);
    return performance.now() - t0;
  });
  say('A2: buildFrame window (ms)', w.toFixed(3));

  // slow machine: 20x CPU throttle, then a human-speed double click (120ms apart)
  const cdp = await ctx.newCDPSession(page);
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: 20 });
  const btn = page.locator('.lane').nth(0).locator('.card').first().locator('button', { hasText: '→ Next' });
  await btn.click(); await page.waitForTimeout(6); await btn.click().catch(() => {});
  await page.waitForTimeout(1500);
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: 1 });
  const chain = await page.evaluate(() => JSON.parse(localStorage.getItem('workroom.frames')));
  say('A2: seqs after throttled fast clicks', JSON.stringify(chain.map(f => f.seq)));
  const v = await page.evaluate(async () => await verifyChain(JSON.parse(localStorage.getItem('workroom.frames')), streamId));
  say('A2: verify', v.length ? v[0] : 'clean');
  await ctx.close();
}

/* A3: two clicks dispatched in one task, as a coalesced/synthetic double fire */
{
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await page.goto(URL);
  await page.waitForFunction(() => document.querySelectorAll('.lane').length === 4);
  const i = page.locator('.lane').nth(0).locator('.add input');
  await i.fill('z1'); await i.press('Enter'); await page.waitForTimeout(200);
  await page.evaluate(() => {
    const b = [...document.querySelectorAll('.card .row button')].find(x => x.textContent.includes('→ Next'));
    b.click(); b.click();          // one task, two dispatches
  });
  await page.waitForTimeout(800);
  const chain = await page.evaluate(() => JSON.parse(localStorage.getItem('workroom.frames')));
  say('A3: seqs', JSON.stringify(chain.map(f => f.seq)));
  const v = await page.evaluate(async () => await verifyChain(JSON.parse(localStorage.getItem('workroom.frames')), streamId));
  say('A3: verify', v.length ? v[0] : 'clean');
  say('A3: status', (await page.textContent('#status')).replace(/\s+/g, ' ').trim().slice(16, 100));
  await ctx.close();
}

await browser.close();

import { chromium } from 'playwright';
const URL = 'file:///Users/kodywildfeuer/workroom/index.html';
const browser = await chromium.launch();
const say = (k,v)=>console.log('  '+String(k).padEnd(44)+v);

async function trial(mode, n) {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await page.goto(URL);
  await page.waitForFunction(() => document.querySelectorAll('.lane').length === 4);
  const i = page.locator('.lane').nth(0).locator('.add input');
  await i.fill('c'); await i.press('Enter'); await page.waitForTimeout(200);
  const btn = page.locator('.lane').nth(0).locator('.card').first().locator('button', { hasText: '→ Next' });
  let broke = false;
  for (let k=0;k<n;k++) {
    const before = await page.evaluate(()=>frames.length);
    try {
      if (mode==='dblclick') await btn.click({ clickCount: 2, delay: 0 });
      else if (mode==='enter2') { const inp = page.locator('.lane').nth(0).locator('.add input');
        await inp.fill('t'+k); await inp.press('Enter'); await inp.fill('u'+k); await inp.press('Enter'); }
    } catch(e) { /* button re-rendered away */ }
    await page.waitForTimeout(120);
    const v = await page.evaluate(async () => await verifyChain(JSON.parse(localStorage.getItem('workroom.frames')||'[]'), streamId));
    if (v.length) { say(mode+': BROKE at trial '+k, v[0]); broke = true; break; }
    // move it back so the button exists again
    const back = page.locator('.lane').nth(1).locator('.card').first().locator('button', { hasText: '→ Now' });
    if (await back.count()) { await back.click().catch(()=>{}); await page.waitForTimeout(120); }
  }
  if (!broke) say(mode+': '+n+' trials', 'chain clean');
  const seqs = await page.evaluate(()=>JSON.parse(localStorage.getItem('workroom.frames')).map(f=>f.seq));
  say(mode+': seq tail', JSON.stringify(seqs.slice(-6)));
  await ctx.close();
}
await trial('dblclick', 40);
await trial('enter2', 30);

// keyboard auto-repeat style: two Enter presses with no awaited gap in the same input
{
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await page.goto(URL);
  await page.waitForFunction(() => document.querySelectorAll('.lane').length === 4);
  const r = await page.evaluate(async () => {
    // simulate an assistive/keyboard double activation delivered as two trusted-ish
    // events in one task via dispatchEvent (isTrusted false but same dispatch path)
    const inp = document.querySelector('.lane .add input');
    inp.value = 'k1';
    inp.dispatchEvent(new KeyboardEvent('keydown', { key:'Enter', bubbles:true }));
    inp.value = 'k2';
    inp.dispatchEvent(new KeyboardEvent('keydown', { key:'Enter', bubbles:true }));
    await new Promise(r=>setTimeout(r,600));
    return JSON.parse(localStorage.getItem('workroom.frames')).map(f=>f.seq);
  });
  say('two Enter keydowns in one task: seqs', JSON.stringify(r));
  await ctx.close();
}
await browser.close();

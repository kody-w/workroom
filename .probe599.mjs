import { chromium } from 'playwright';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
const here = dirname(fileURLToPath(import.meta.url));
const URL = 'file://' + join(here, 'index.html');
const br = await chromium.launch();
const page = await br.newPage();
page.on('pageerror', e => console.log('[pageerror] ' + e.message));
await page.goto(URL);
await page.waitForFunction(() => document.querySelectorAll('.lane').length === 4);

// --- build MY chain: 2 frames (genesis + one card)
const inp = page.locator('.lane').nth(0).locator('.add input');
await inp.fill('MY OWN WORK'); await inp.press('Enter');
await page.waitForTimeout(80);
const mine = await page.evaluate(() => ({ s: localStorage.getItem('workroom.stream'), f: localStorage.getItem('workroom.frames') }));
console.log('mine frames:', JSON.parse(mine.f).length, 'stream:', JSON.parse(mine.s).slice(0,40));

// --- produce a STRANGER export from a second page
const p2 = await br.newPage();
await p2.goto(URL + '?other');   // same file origin => same localStorage; so clear first
await p2.evaluate(() => localStorage.clear());
await p2.reload();
await p2.waitForFunction(() => document.querySelectorAll('.lane').length === 4);
const i2 = p2.locator('.lane').nth(0).locator('.add input');
await i2.fill('STRANGER CARD'); await i2.press('Enter');
await p2.waitForTimeout(80);
const stranger = await p2.evaluate(() => JSON.stringify({ stream_id: JSON.parse(localStorage.getItem('workroom.stream')), frames: JSON.parse(localStorage.getItem('workroom.frames')) }, null, 2));
await p2.close();

// restore MY state and reload page 1
await page.evaluate(({s,f}) => { localStorage.setItem('workroom.stream', s); localStorage.setItem('workroom.frames', f); }, mine);
await page.reload();
await page.waitForFunction(() => document.querySelectorAll('.lane').length === 4);
console.log('before import — disk frames:', await page.evaluate(()=>JSON.parse(localStorage.getItem('workroom.frames')).length),
            'status:', await page.textContent('#status'));

// --- fault-inject: only the workroom.stream write fails (as a full-quota new/longer-key write would)
await page.evaluate(() => {
  const real = Storage.prototype.setItem;
  Storage.prototype.setItem = function (k, v) {
    if (k === 'workroom.stream') { const e = new Error('quota'); e.name = 'QuotaExceededError'; throw e; }
    return real.call(this, k, v);
  };
});

await page.click('#import');
await page.fill('#io-text', stranger);
await page.click('#io-ok');
await page.waitForTimeout(300);
console.log('STATUS AFTER IMPORT:', (await page.textContent('#status')).trim());
const after = await page.evaluate(() => ({
  memFrames: window.frames && null,
  diskFrames: JSON.parse(localStorage.getItem('workroom.frames')),
  diskStream: JSON.parse(localStorage.getItem('workroom.stream')),
}));
console.log('disk frames now:', after.diskFrames.length, JSON.stringify(after.diskFrames.map(f=>f.payload.title||f.payload.event)));
console.log('disk stream tail:', String(after.diskStream).slice(-20));
console.log('disk frame stream tail:', String(after.diskFrames[0].stream_id).slice(-20));
console.log('MY chain still on disk?', after.diskFrames.length === JSON.parse(mine.f).length && after.diskFrames[1] && after.diskFrames[1].payload.title === 'MY OWN WORK');

await page.evaluate(()=>document.getElementById('io').close());
// press Verify (memory vs disk)
await page.click('#verify'); await page.waitForTimeout(300);
console.log('VERIFY SAYS:', (await page.textContent('#status')).trim());

// --- reload without the patch: what does the app boot into?
await page.reload();
await page.waitForFunction(() => document.querySelectorAll('.lane').length === 4);
await page.waitForTimeout(300);
console.log('BOOT STATUS:', (await page.textContent('#status')).trim());
console.log('board shows:', await page.locator('.card').allTextContents());

// --- next ordinary add
const inp3 = page.locator('.lane').nth(0).locator('.add input');
await inp3.fill('NEW WORK AFTER'); await inp3.press('Enter');
await page.waitForTimeout(150);
const fin = await page.evaluate(() => JSON.parse(localStorage.getItem('workroom.frames')).map(f => f.stream_id.slice(-12)));
console.log('stream_ids on disk chain:', JSON.stringify(fin));
await page.click('#verify'); await page.waitForTimeout(400);
console.log('VERIFY AFTER ADD:', (await page.textContent('#status')).trim());
await br.close();

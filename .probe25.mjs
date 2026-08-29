import { chromium } from 'playwright';
const URL = 'file:///Users/kodywildfeuer/workroom/index.html';
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1200, height: 800 } });

const boot = async (p) => { await p.waitForFunction(() => document.querySelectorAll('.lane').length === 4); await p.waitForTimeout(200); };
const status = p => p.textContent('#status').then(s => s.trim().replace(/\s+/g,' '));
const add = async (p, title) => {
  await p.locator('.lane').nth(0).locator('.add input').fill(title);
  await p.locator('.lane').nth(0).locator('.add input').press('Enter');
  await p.waitForTimeout(200);
};
const frames = p => p.evaluate(() => (JSON.parse(localStorage.getItem('workroom.frames')||'[]')).length);
const stream = p => p.evaluate(() => localStorage.getItem('workroom.stream'));
const head = p => p.evaluate(() => localStorage.getItem('workroom.head'));

const A = await ctx.newPage();
A.on('dialog', d => d.accept());
A.on('pageerror', e => console.log('[A err]', e.message));
await A.goto(URL); await boot(A);
await A.click('#reset'); await A.waitForTimeout(300);
await add(A, 'one'); await add(A, 'two');
console.log('A frames', await frames(A), 'head', await head(A));

// ---- CASE 1: stale tab's Verify after the other tab legitimately appends ----
const B = await ctx.newPage();
B.on('dialog', d => d.accept());
await B.goto(URL); await boot(B);
await add(B, 'three from B'); await add(B, 'four from B');
console.log('B frames', await frames(B));
// A is stale in memory (3 frames), disk has 5
await A.click('#verify'); await A.waitForTimeout(300);
console.log('CASE1 A verify says:', await status(A));

// ---- CASE 2: stale tab's IMPORT over another tab's newer, DIFFERENT stream ----
const exportA = await A.evaluate(() => JSON.stringify({
  stream_id: JSON.parse(localStorage.getItem('workroom.stream')),
  frames: (window.frames && null) || null,
}));
// grab A's in-memory chain via its own export dialog
await A.click('#export'); await A.waitForTimeout(200);
const snapA = await A.inputValue('#io-text');
await A.click('#io-ok'); await A.waitForTimeout(100);

await B.click('#reset'); await B.waitForTimeout(400);   // B mints a brand new stream
await add(B, 'B new stream card');
const bStream = await stream(B), bFrames = await frames(B);
console.log('B after reset: stream', bStream.slice(-20), 'frames', bFrames);

await A.click('#import'); await A.fill('#io-text', snapA); await A.click('#io-ok'); await A.waitForTimeout(500);
console.log('CASE2 A import status:', await status(A));
console.log('CASE2 disk stream now:', (await stream(A)||'').slice(-20), 'frames', await frames(A));
console.log('CASE2 B stream was  :', bStream.slice(-20), ' -> B destroyed?', (await stream(A)) !== bStream);
await A.evaluate(() => { const d=document.getElementById('io'); if(d.open) d.close(); });

// ---- CASE 3: boot() vs a rollback on disk (7.6 at the other ingress) ----
await A.reload(); await boot(A);
await A.click('#reset'); await A.waitForTimeout(300);
await add(A, 'r1'); await add(A, 'r2'); await add(A, 'r3');
await A.click('#export'); await A.waitForTimeout(200);
const full = await A.inputValue('#io-text');
await A.click('#io-ok'); await A.waitForTimeout(100);
const older = JSON.parse(full);
const truncated = { stream_id: older.stream_id, frames: older.frames.slice(0, 2) };
console.log('CASE3 head before:', await head(A));
// simulate an older valid copy landing on disk (restored profile / devtools / sync)
await A.evaluate(t => localStorage.setItem('workroom.frames', JSON.stringify(t.frames)), truncated);
await A.reload(); await boot(A);
console.log('CASE3 boot status:', await status(A));
console.log('CASE3 head after :', await head(A));
console.log('CASE3 frames now :', await frames(A));
// and now the import of the REAL, longer chain — is it still accepted?
await A.click('#import'); await A.fill('#io-text', full); await A.click('#io-ok'); await A.waitForTimeout(400);
console.log('CASE3 re-import of the true chain:', await status(A));

await browser.close();

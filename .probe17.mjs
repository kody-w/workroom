import { chromium } from 'playwright';
import { readFileSync } from 'node:fs';
const here = '/Users/kodywildfeuer/workroom';
const URL = 'file://' + here + '/index.html';
const html = readFileSync(here + '/index.html', 'utf8');
const prim = html.slice(html.indexOf('/* ── §4 canonicalization'), html.indexOf('/* ── state '));
const { H } = await import('data:text/javascript,' + encodeURIComponent(prim + '\nexport { canonical, H };'));
const sid = 'rappid:@kody-w/workroom:' + 'a'.repeat(64) + ':' + 'b'.repeat(16);
async function mk(seq, payload, prev, utc) {
  const payload_hash = await H('rapp/1:particle', payload);
  const pre = { spec:'rapp/1', kind:'memory.save', stream_id:sid, seq, utc, payload, payload_hash, prev, prev_wave:null };
  return { ...pre, frame_hash: await H('rapp/1:wave', pre), sig:null };
}
const f0 = await mk(0, {event:'room.opened', title:'The Workroom'}, null, '2026-08-29T00:00:00.000Z');
const f1 = await mk(1, {event:'card.added', card:'cccc3333', lane:'now', title:'ghost', note:'', who:''}, f0.payload_hash, '2026-08-29T00:00:01.000Z');
const f2 = await mk(2, {event:'card.added', card:'cccc3333', lane:'next', title:'ghost', note:'', who:''}, f1.payload_hash, '2026-08-29T00:00:02.000Z');
const f3 = await mk(3, {event:'card.removed', card:'cccc3333', titleAt:'ghost'}, f2.payload_hash, '2026-08-29T00:00:03.000Z');
const chain = { stream_id: sid, frames: [f0,f1,f2,f3] };

const browser = await chromium.launch();
const page = await browser.newPage({viewport:{width:1440,height:900}});
page.on('pageerror', e => console.log('  [page error] ' + e.message));
await page.goto(URL);
await page.waitForFunction(() => document.querySelectorAll('.lane').length === 4);
await page.click('#import');
await page.fill('#io-text', JSON.stringify(chain));
await page.click('#io-ok');
await page.waitForTimeout(500);
console.log('status:', (await page.textContent('#status')).trim());
const dump = async () => page.evaluate(() => ({
  headers: [...document.querySelectorAll('.lane h2')].map(h => h.textContent.trim()),
  cards: document.querySelectorAll('.card').length,
  empties: document.querySelectorAll('.empty').length,
  order: JSON.parse(localStorage.getItem('workroom.frames')||'[]').length,
}));
console.log('after import:', JSON.stringify(await dump()));
await page.reload();
await page.waitForFunction(() => document.querySelectorAll('.lane').length === 4);
await page.waitForTimeout(300);
console.log('after reload:', JSON.stringify(await dump()));
console.log('status after reload:', (await page.textContent('#status')).trim());
// also orphan move / edit-after-remove
const g1 = await mk(1, {event:'card.moved', card:'dddd4444', lane:'next', titleAt:'phantom'}, f0.payload_hash, '2026-08-29T00:00:01.000Z');
await page.evaluate(() => { const d=document.getElementById('io'); if(d.open) d.close(); });
await page.click('#import');
await page.fill('#io-text', JSON.stringify({stream_id:sid, frames:[f0,g1]}));
await page.click('#io-ok');
await page.waitForTimeout(400);
console.log('orphan move status:', (await page.textContent('#status')).trim());
console.log('orphan move board:', JSON.stringify(await dump()));
await page.screenshot({path:'/private/tmp/claude-501/-Users-kodywildfeuer/8abddf55-7823-48b1-b9d9-d9f458ebe875/scratchpad/p17.png'});
await browser.close();

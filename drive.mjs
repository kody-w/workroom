/* drive.mjs — exercise the workroom in a real browser and report what happened.
 *
 *   NODE_PATH=$HOME/nexus-tour/node_modules node drive.mjs
 *
 * It adds work, moves it, edits it, removes it, verifies the chain, throws the
 * board away and rebuilds it from the frames, then tampers with a stored frame
 * and checks the app REFUSES it. A ledger that cannot detect tampering is a log.
 */
import { chromium } from 'playwright';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const URL = 'file://' + join(here, 'index.html');
const out = [];
const say = (k, v) => { out.push([k, v]); console.log('  ' + k.padEnd(38) + v); };

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
page.on('pageerror', e => console.log('  [page error] ' + e.message));
await page.goto(URL);
await page.waitForFunction(() => document.querySelectorAll('.lane').length === 4);

const frames = () => page.evaluate(() => JSON.parse(localStorage.getItem('workroom.frames') || '[]'));
const status = () => page.textContent('#status');

say('genesis frames', String((await frames()).length));

// add three cards across two lanes
const add = async (laneIdx, text) => {
  const inp = page.locator('.lane').nth(laneIdx).locator('.add input');
  await inp.fill(text); await inp.press('Enter');
  await page.waitForTimeout(60);
};
await add(0, 'Cut the nexus tour');
await add(0, 'Rotate the ghu token');
await add(1, 'Merge PR #2');
say('cards on the board', String(await page.locator('.card').count()));

// move one with the lane button, edit another, remove a third
await page.locator('.lane').nth(1).locator('.card').first().locator('button', { hasText: '→ Now' }).click();
await page.waitForTimeout(60);
// edit() asks three prompts in a row, so one queued handler answers them all —
// two `once` handlers both fire on the FIRST dialog and the second then throws
const answers = ['Cut the nexus tour (final)', 're-shot against cc26380', 'KW'];
page.on('dialog', d => d.accept(answers.length ? answers.shift() : ''));
const first = page.locator('.lane').nth(0).locator('.card').first();
await first.locator('button', { hasText: 'edit' }).click();
await page.waitForTimeout(500);

// and remove one, so the chain carries a removal too
await page.locator('.lane').nth(0).locator('.card').last().locator('button', { hasText: 'remove' }).click();
await page.waitForTimeout(200);

const all = await frames();
say('frames after the edits', String(all.length));
say('every frame is 11 keys', String(all.every(f => Object.keys(f).length === 11)));
say('genesis prev is null', String(all[0].prev === null && all[0].seq === 0));
say('chain links by payload_hash', String(all.every((f, i) => i === 0 || f.prev === all[i - 1].payload_hash)));
say('prev_wave null on a memory stream', String(all.every(f => f.prev_wave === null)));
say('kind is a registered one', all[0].kind);

// the app's own verifier
await page.click('#verify');
await page.waitForTimeout(400);
say('verify says', (await status()).replace(/\s+/g, ' ').trim().slice(0, 64));

// the board is a projection: throw it away and replay
const before = await page.locator('.card').count();
await page.click('#rebuild');
await page.waitForTimeout(700);
const after = await page.locator('.card').count();
say('rebuild from frames', before === after ? `same board (${after} cards)` : `DIFFERED ${before} -> ${after}`);

// tamper: change a stored payload and confirm the chain refuses it
await page.evaluate(() => {
  const f = JSON.parse(localStorage.getItem('workroom.frames'));
  f[1].payload.title = 'quietly changed';         // the hash no longer covers this
  localStorage.setItem('workroom.frames', JSON.stringify(f));
});
await page.reload();
await page.waitForFunction(() => document.querySelectorAll('.lane').length === 4);
await page.waitForTimeout(500);
const tampered = (await status()).replace(/\s+/g, ' ').trim();
say('tampered chain is caught', /problem|does not match/i.test(tampered) ? 'yes — ' + tampered.slice(0, 52) : 'NO — it accepted it');

/* ── the failures the app has to SURVIVE, not merely pass ───────────────── */

// a full or blocked store must refuse the change, not pretend to keep it
await page.reload();
await page.waitForFunction(() => document.querySelectorAll('.lane').length === 4);
const diskBefore = (await frames()).length;
await page.evaluate(() => { localStorage.setItem = () => { throw new Error('QuotaExceededError'); }; });
await add(0, 'this must not be silently dropped');
await page.waitForTimeout(200);
const diskAfter = (await page.evaluate(() => JSON.parse(localStorage.getItem('workroom.frames') || '[]'))).length;
const memAfter = await page.evaluate(() => document.querySelectorAll('.card').length);
const warned = /could not be written|refused/i.test(await status());
say('dead store: disk unchanged', String(diskAfter === diskBefore));
say('dead store: change refused, not kept', String(memAfter === 2));
say('dead store: says so, stickily', String(warned));

// an import that cannot even be canonicalized must leave the live chain alone
await page.reload();
await page.waitForFunction(() => document.querySelectorAll('.lane').length === 4);
const liveBefore = JSON.stringify(await frames());
const poison = JSON.stringify({
  stream_id: 'rappid:@evil/x:' + 'a'.repeat(64) + ':' + 'b'.repeat(16),
  frames: [{ spec: 'rapp/1', kind: 'memory.save', stream_id: 'rappid:@evil/x:' + 'a'.repeat(64) + ':' + 'b'.repeat(16),
             seq: 0, utc: '2026-08-29T00:00:00.000Z', payload: { event: 'room.opened', ratio: 1.5 },
             payload_hash: 'c'.repeat(64), frame_hash: 'd'.repeat(64), prev: null, prev_wave: null, sig: null }],
});
await page.click('#import');
await page.fill('#io-text', poison);
await page.click('#io-ok');
await page.waitForTimeout(400);
const liveAfter = JSON.stringify(await frames());
say('poison import: chain untouched', String(liveBefore === liveAfter));
say('poison import: refused out loud', /refused/i.test(await status()) ? 'yes' : 'NO — it said nothing');

// ...and one more edit must still write the USER's chain, not the attacker's
await page.evaluate(() => document.getElementById('io').close());
await add(0, 'still mine');
await page.waitForTimeout(200);
const afterEdit = await frames();
say('poison import: next edit is still mine',
    String(afterEdit.every(f => f.stream_id.startsWith('rappid:@kody-w/workroom:'))));

// a frame naming a lane that does not exist must be refused, not bricked in
const badLane = JSON.stringify({ stream_id: 'rappid:@kody-w/workroom:' + 'a'.repeat(64) + ':' + 'b'.repeat(16), frames: [] });
await page.click('#import'); await page.fill('#io-text', badLane); await page.click('#io-ok');
await page.waitForTimeout(300);
say('empty import handled', /refused|imported 0/i.test(await status()) ? 'yes' : 'NO');
await page.evaluate(() => { const d = document.getElementById('io'); if (d.open) d.close(); });

// an unpaired surrogate is outside the I-JSON domain (§4). The canonicalizer must
// refuse it rather than escape it — an escaped lone surrogate hashes to something
// the reference implementation can never reproduce, so the frame would verify here
// and nowhere else.
const liveBeforeSur = JSON.stringify(await frames());
const sid = 'rappid:@kody-w/workroom:' + 'a'.repeat(64) + ':' + 'b'.repeat(16);
const surrogatePayload = JSON.stringify({
  stream_id: sid,
  frames: [{ spec: 'rapp/1', kind: 'memory.save', stream_id: sid, seq: 0,
             utc: '2026-08-29T00:00:00.000Z',
             payload: { event: 'room.opened', title: 'lone \ud800 here' },
             payload_hash: 'c'.repeat(64), frame_hash: 'd'.repeat(64),
             prev: null, prev_wave: null, sig: null }],
});
await page.click('#import'); await page.fill('#io-text', surrogatePayload); await page.click('#io-ok');
await page.waitForTimeout(400);
const surStatus = await status();
say('unpaired surrogate refused', /surrogate|refused/i.test(surStatus) ? 'yes' : 'NO — it accepted it');
say('surrogate import: chain untouched', String(JSON.stringify(await frames()) === liveBeforeSur));
await page.evaluate(() => { const d = document.getElementById('io'); if (d.open) d.close(); });

// A chain can be perfectly hashed and still be unrenderable. Build one with the
// app's OWN primitives so the hashes are genuinely right, and check it is refused
// rather than written to disk and thrown on every load thereafter.
const html = readFileSync(join(here, 'index.html'), 'utf8');
const prim = html.slice(html.indexOf('/* ── §4 canonicalization'), html.indexOf('/* ── state '));
const { canonical, H } = await import('data:text/javascript,' + encodeURIComponent(prim + '\nexport { canonical, H };'));
const mkFrame = async (payload, sid) => {
  const payload_hash = await H('rapp/1:particle', payload);
  const pre = { spec: 'rapp/1', kind: 'memory.save', stream_id: sid, seq: 0,
                utc: '2026-08-29T00:00:00.000Z', payload, payload_hash, prev: null, prev_wave: null };
  return { ...pre, frame_hash: await H('rapp/1:wave', pre), sig: null };
};
const sid2 = 'rappid:@kody-w/workroom:' + 'e'.repeat(64) + ':' + 'f'.repeat(16);

const liveBeforeBrick = JSON.stringify(await frames());
// genesis is fine; the SECOND frame is a card.added with no card id — hashes valid
const g = await mkFrame({ event: 'room.opened', title: 'The Workroom' }, sid2);
const badPayload = { event: 'card.added', lane: 'now', title: 't', note: '', who: '' };
const ph = await H('rapp/1:particle', badPayload);
const pre2 = { spec: 'rapp/1', kind: 'memory.save', stream_id: sid2, seq: 1,
               utc: '2026-08-29T00:00:01.000Z', payload: badPayload, payload_hash: ph,
               prev: g.payload_hash, prev_wave: null };
const bad = { ...pre2, frame_hash: await H('rapp/1:wave', pre2), sig: null };
await page.click('#import');
await page.fill('#io-text', JSON.stringify({ stream_id: sid2, frames: [g, bad] }));
await page.click('#io-ok');
await page.waitForTimeout(400);
say('unrenderable chain refused', /refused/i.test(await status()) ? 'yes' : 'NO — it accepted it');
say('unrenderable: chain untouched', String(JSON.stringify(await frames()) === liveBeforeBrick));
await page.evaluate(() => { const d = document.getElementById('io'); if (d.open) d.close(); });

// an empty chain is not a stream
await page.click('#import');
await page.fill('#io-text', JSON.stringify({ stream_id: sid2, frames: [] }));
await page.click('#io-ok');
await page.waitForTimeout(300);
say('empty chain refused', /refused/i.test(await status()) ? 'yes' : 'NO — it wiped the record');
await page.evaluate(() => { const d = document.getElementById('io'); if (d.open) d.close(); });

// a half-write must leave BOTH keys as they were, not one of them replaced
const beforeF = await page.evaluate(() => localStorage.getItem('workroom.frames'));
const beforeS = await page.evaluate(() => localStorage.getItem('workroom.stream'));
await page.evaluate(() => {
  const real = Storage.prototype.setItem;
  Storage.prototype.setItem = function (k, v) {
    if (k === 'workroom.stream') throw new Error('QuotaExceededError');
    return real.call(this, k, v);
  };
});
await page.click('#import');
await page.fill('#io-text', JSON.stringify({ stream_id: sid2, frames: [g] }));
await page.click('#io-ok');
await page.waitForTimeout(400);
const afterF = await page.evaluate(() => localStorage.getItem('workroom.frames'));
const afterS = await page.evaluate(() => localStorage.getItem('workroom.stream'));
say('half-write rolled back', String(afterF === beforeF && afterS === beforeS));
await page.evaluate(() => { const d = document.getElementById('io'); if (d.open) d.close(); });

await page.screenshot({ path: join(here, 'shot.png'), fullPage: false });
await browser.close();

const failed = out.filter(([k, v]) => /^(false|DIFFERED|NO —)/.test(v));
console.log(failed.length ? `\n${failed.length} check(s) failed` : '\nall checks passed');
process.exit(failed.length ? 1 : 0);

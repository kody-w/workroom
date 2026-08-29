/* drive.mjs — exercise the workroom in a real browser and report what happened.
 *
 *   NODE_PATH=$HOME/nexus-tour/node_modules node drive.mjs
 *
 * It adds work, moves it, edits it, removes it, verifies the chain, throws the
 * board away and rebuilds it from the frames, then tampers with a stored frame
 * and checks the app REFUSES it. A ledger that cannot detect tampering is a log.
 */
import { chromium } from 'playwright';
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

await page.screenshot({ path: join(here, 'shot.png'), fullPage: false });
await browser.close();

const failed = out.filter(([k, v]) => /^(false|DIFFERED|NO —)/.test(v));
console.log(failed.length ? `\n${failed.length} check(s) failed` : '\nall checks passed');
process.exit(failed.length ? 1 : 0);

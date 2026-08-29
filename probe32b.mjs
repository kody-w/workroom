/* probe32b.mjs — can an imported far-future utc poison the writer's floor forever? */
import { chromium } from 'playwright';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const URL = 'file://' + join(here, 'index.html');
const say = (k, v) => console.log('  ' + k.padEnd(34) + v);

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await ctx.newPage();
page.on('pageerror', e => console.log('  [page error] ' + e.message));
await page.goto(URL);
await page.waitForFunction(() => document.querySelectorAll('.lane').length === 4);

// Build a two-frame chain dated 2099 with the app's OWN primitives.
const payload = await page.evaluate(async () => {
  const sid = await mintStream();
  const mk = async (seq, utc, payload, prev) => {
    const ph = await H('rapp/1:particle', payload);
    const pre = { spec: SPEC, kind: KIND, stream_id: sid, seq, utc, payload,
                  payload_hash: ph, prev, prev_wave: null };
    const fh = await H('rapp/1:wave', pre);
    return { ...pre, frame_hash: fh, sig: null };
  };
  const g = await mk(0, '2099-01-01T00:00:00.000Z', { event: 'room.opened', title: 'The Workroom' }, null);
  const c = await mk(1, '2099-01-01T00:00:01.000Z',
    { event: 'card.added', card: 'aabbccddeeff0011', lane: 'now', title: 'from the future', note: '', who: '' },
    g.payload_hash);
  return JSON.stringify({ stream_id: sid, frames: [g, c] }, null, 2);
});

// Import it through the real UI.
await page.click('#import');
await page.fill('#io-text', payload);
await page.click('#io-ok');
await page.waitForTimeout(400);
say('status after import', (await page.textContent('#status')).trim().replace(/\s+/g, ' '));

// Now type one card, as a user would.
const inp = page.locator('.lane').nth(0).locator('.add input');
await inp.fill('typed right now'); await inp.press('Enter');
await page.waitForTimeout(300);

const info = await page.evaluate(() => {
  const f = JSON.parse(localStorage.getItem('workroom.frames'));
  return { n: f.length, last: f[f.length - 1].utc, real: new Date().toISOString() };
});
say('frames on disk', String(info.n));
say('new frame utc', info.last);
say('real clock now', info.real);
say('ledger row (top)', (await page.locator('#pane-ledger .frame .h').first().textContent()).trim());

await page.click('#verify');
await page.waitForTimeout(600);
say('status after #verify', (await page.textContent('#status')).trim().replace(/\s+/g, ' '));

// second write, to show it is not a one-off
await inp.fill('and another'); await inp.press('Enter');
await page.waitForTimeout(300);
say('second new frame utc', await page.evaluate(() => {
  const f = JSON.parse(localStorage.getItem('workroom.frames')); return f[f.length - 1].utc;
}));

await browser.close();

import { chromium } from 'playwright';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const APP = 'file://' + join(here, 'index.html');

const browser = await chromium.launch();
let bad = 0;
const check = (name, pass, detail = '') => {
  console.log('  ' + name.padEnd(44) + (pass ? 'yes' : 'NO') + (detail ? ' — ' + detail : ''));
  if (!pass) bad++;
};

async function freshPage(context) {
  if (!context) context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();
  page.on('pageerror', error => { console.log('  PAGE ERROR — ' + error.message); bad++; });
  page.on('dialog', dialog => dialog.accept());
  await page.goto(APP);
  await page.waitForFunction(() => typeof storageMode !== 'undefined' && frames.length > 0);
  return { context, page };
}

async function importText(page, text) {
  await page.click('#import');
  await page.fill('#io-text', text);
  await page.click('#io-ok');
  await page.waitForTimeout(200);
  return {
    status: await page.textContent('#status'),
    error: await page.textContent('#io-error'),
    open: await page.locator('#io').evaluate(dialog => dialog.open),
  };
}

{
  const { context, page } = await freshPage();
  await page.click('#reset');
  await page.waitForFunction(() => frames.length === 1);
  const add = async (lane, title) => page.evaluate(({ lane, title }) => addCard(lane, title), { lane, title });
  await add('next', 'Cut the nexus tour');
  await add('now', 'Rotate the token');
  await add('blocked', 'Merge PR');
  const ids = await page.evaluate(() => Object.keys(board.cards));
  await page.evaluate(id => move(id, 'done'), ids[0]);
  await page.evaluate(id => removeCard(id), ids[1]);
  const all = await page.evaluate(() => copy(frames));
  check('record uses exactly eleven frame keys',
    all.every(frame => Object.keys(frame).length === 11));
  check('record links by payload hash',
    all.every((frame, i) => i === 0 || frame.prev === all[i - 1].payload_hash));
  check('record is in one atomic envelope', await page.evaluate(() => {
    const state = JSON.parse(localStorage.getItem(STATE_KEY));
    return state.current.stream_id === streamId
      && JSON.stringify(state.current.frames) === JSON.stringify(frames)
      && state.heads[streamId].frame_hash === frames.at(-1).frame_hash;
  }));
  await page.click('#verify');
  check('app verifier accepts written chain', /all \d+ frames verified/i.test(await page.textContent('#status')));

  const rawBeforeTamper = await page.evaluate(() => localStorage.getItem(STATE_KEY));
  await page.evaluate(() => {
    const state = JSON.parse(localStorage.getItem(STATE_KEY));
    state.current.frames[1].payload.title = 'quietly changed';
    localStorage.setItem(STATE_KEY, JSON.stringify(state));
  });
  const tamperedRaw = await page.evaluate(() => localStorage.getItem(STATE_KEY));
  await page.reload();
  await page.waitForTimeout(500);
  check('tampered envelope is refused', await page.evaluate(() => storageMode === 'fault' && !!refused));
  check('tampered envelope is preserved', await page.evaluate(raw => localStorage.getItem(STATE_KEY) === raw, tamperedRaw));
  check('recovery export remains enabled', !(await page.locator('#export').isDisabled()));
  check('tamper actually changed stored bytes', rawBeforeTamper !== tamperedRaw);
  await context.close();
}

{
  const { context, page } = await freshPage();
  const before = await page.evaluate(() => ({ raw: localStorage.getItem(STATE_KEY), n: frames.length }));
  await page.evaluate(() => {
    const real = Storage.prototype.setItem;
    Storage.prototype.setItem = function (key, value) {
      if (key === STATE_KEY) throw new Error('QuotaExceededError');
      return real.call(this, key, value);
    };
  });
  await page.evaluate(() => addCard('now', 'must not be lost in memory'));
  const after = await page.evaluate(() => ({
    raw: localStorage.getItem(STATE_KEY),
    n: frames.length,
    status: document.getElementById('status').textContent,
  }));
  check('failed atomic write keeps stored envelope', after.raw === before.raw);
  check('failed atomic write keeps memory unchanged', after.n === before.n);
  check('failed atomic write is reported', /could not be written|previous record is still intact/i.test(after.status));
  await context.close();
}

{
  const { context, page } = await freshPage();
  await page.click('#reset');
  await page.waitForFunction(() => frames.length === 1);
  await page.evaluate(() => addCard('now', 'first'));
  const before = await page.evaluate(() => localStorage.getItem(STATE_KEY));
  const sid = 'rappid:@evil/x:' + 'a'.repeat(64) + ':' + 'b'.repeat(16);
  const poison = JSON.stringify({
    stream_id: sid,
    frames: [{
      spec: 'rapp/1', kind: 'memory.save', stream_id: sid, seq: 0,
      utc: '2026-08-29T00:00:00.000Z',
      payload: { event: 'room.opened', title: 'bad', ratio: 1.5 },
      payload_hash: 'c'.repeat(64), frame_hash: 'd'.repeat(64),
      prev: null, prev_wave: null, sig: null,
    }],
  });
  const poisonResult = await importText(page, poison);
  check('poison import is refused in dialog', /refused/i.test(poisonResult.error) && poisonResult.open);
  check('poison import leaves envelope untouched',
    await page.evaluate(raw => localStorage.getItem(STATE_KEY) === raw, before));
  await page.evaluate(() => document.getElementById('io').close());

  const emptyResult = await importText(page, JSON.stringify({ stream_id: sid, frames: [] }));
  check('empty import is refused', /there are no frames/i.test(emptyResult.error));
  check('empty import does not claim round-trip', emptyResult.open);
  await page.evaluate(() => document.getElementById('io').close());

  const valid = await page.evaluate(() => ({ stream_id: streamId, frames: copy(frames) }));
  await page.evaluate(() => addCard('now', 'second'));
  const count = await page.evaluate(() => frames.length);
  const rollback = await importText(page, JSON.stringify(valid));
  check('older same-stream import is refused', /older copy|roll the record back/i.test(rollback.error));
  check('rollback refusal keeps current frames', await page.evaluate(n => frames.length === n, count));
  await context.close();
}

{
  const context = await browser.newContext();
  const { page: first } = await freshPage(context);
  const { page: second } = await freshPage(context);
  await second.click('#reset');
  await second.waitForFunction(() => frames.length === 1);
  const diskAfterReset = await second.evaluate(() => localStorage.getItem(STATE_KEY));
  await first.evaluate(() => addCard('now', 'stale write'));
  check('ordinary stale tab cannot overwrite', await first.evaluate(raw =>
    localStorage.getItem(STATE_KEY) === raw, diskAfterReset));
  check('ordinary stale tab is told why', /another tab/i.test(await first.textContent('#status')));
  await context.close();
}

{
  const { context, page } = await freshPage();
  await page.click('#reset');
  await page.waitForFunction(() => frames.length === 1);
  await page.evaluate(() => addCard('now', 'before clock correction'));
  await page.evaluate(() => {
    const Real = Date;
    window.Date = class extends Real {
      constructor(...args) { if (args.length) super(...args); else super(Real.now() - 600000); }
      static now() { return Real.now() - 600000; }
    };
  });
  await page.evaluate(() => addCard('now', 'after clock correction'));
  check('backward clock remains monotonic', await page.evaluate(() =>
    frames.every((frame, i) => i === 0 || frame.utc >= frames[i - 1].utc)));
  check('backward-clock chain verifies', (await page.evaluate(() => verifyChain(frames, streamId))).length === 0);
  await context.close();
}

await browser.close();
console.log(bad ? `\n${bad} drive check(s) failed` : '\ncore append, verification, storage, import, CAS, and clock checks passed');
process.exit(bad ? 1 : 0);

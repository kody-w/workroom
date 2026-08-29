import { chromium } from 'playwright';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const APP = 'file://' + (process.argv[2] || join(here, 'index.html'));
const browser = await chromium.launch();
let bad = 0;
const check = (name, pass, detail = '') => {
  console.log('  ' + name.padEnd(48) + (pass ? 'yes' : 'NO') + (detail ? ' — ' + detail : ''));
  if (!pass) bad++;
};

async function fresh(options = {}) {
  const context = await browser.newContext({ viewport: options.viewport || { width: 1440, height: 900 } });
  if (options.beforeBoot) await context.addInitScript(options.beforeBoot);
  const page = await context.newPage();
  page.on('pageerror', error => { console.log('  PAGE ERROR — ' + error.message); bad++; });
  if (options.dialogs !== false) page.on('dialog', dialog => dialog.accept());
  await page.goto(APP);
  await page.waitForFunction(() => typeof storageMode !== 'undefined');
  await page.waitForTimeout(250);
  return { context, page };
}

{
  const { context, page } = await fresh();
  await page.evaluate(() => {
    localStorage.removeItem(STATE_KEY);
    for (const key of Object.values(LEGACY)) localStorage.removeItem(key);
    localStorage.setItem(LEGACY.frames, '{"broken"');
  });
  await page.reload();
  await page.waitForTimeout(300);
  check('malformed legacy frames are preserved and refused', await page.evaluate(() =>
    storageMode === 'fault'
    && localStorage.getItem(LEGACY.frames) === '{"broken"'
    && localStorage.getItem(STATE_KEY) === null));
  check('malformed-state recovery export is available', !(await page.locator('#export').isDisabled()));
  check('malformed-state mutation controls are disabled',
    await page.locator('#import').isDisabled() && await page.locator('#agents').isDisabled());
  await context.close();
}

{
  const { context, page } = await fresh();
  const malformed = await page.evaluate(() => {
    const state = JSON.parse(localStorage.getItem(STATE_KEY));
    state.heads = 'broken';
    const raw = JSON.stringify(state);
    localStorage.setItem(STATE_KEY, raw);
    return raw;
  });
  await page.reload();
  await page.waitForTimeout(300);
  check('malformed envelope metadata fails closed', await page.evaluate(raw =>
    storageMode === 'fault' && localStorage.getItem(STATE_KEY) === raw, malformed));
  await context.close();
}

{
  const { context, page } = await fresh();
  const malformed = await page.evaluate(() => {
    const state = JSON.parse(localStorage.getItem(STATE_KEY));
    state.archives.bad = { name: 'bad', frames: 'not an array', at: 1 };
    const raw = JSON.stringify(state);
    localStorage.setItem(STATE_KEY, raw);
    return raw;
  });
  await page.reload();
  await page.waitForTimeout(300);
  check('malformed archive is preserved and refused', await page.evaluate(raw =>
    storageMode === 'fault' && localStorage.getItem(STATE_KEY) === raw, malformed));
  await context.close();
}

{
  const { context, page } = await fresh();
  const malformed = await page.evaluate(() => {
    const state = JSON.parse(localStorage.getItem(STATE_KEY));
    state.current.stream_id = 7;
    const raw = JSON.stringify(state);
    localStorage.setItem(STATE_KEY, raw);
    return raw;
  });
  await page.reload();
  await page.waitForTimeout(300);
  check('malformed stream id is preserved and refused', await page.evaluate(raw =>
    storageMode === 'fault' && localStorage.getItem(STATE_KEY) === raw, malformed));
  await context.close();
}

{
  const { context, page } = await fresh();
  const migrated = await page.evaluate(() => {
    const state = JSON.parse(localStorage.getItem(STATE_KEY));
    localStorage.removeItem(STATE_KEY);
    localStorage.setItem(LEGACY.frames, JSON.stringify(state.current.frames));
    localStorage.setItem(LEGACY.stream, JSON.stringify(state.current.stream_id));
    localStorage.setItem(LEGACY.head, JSON.stringify(state.heads));
    localStorage.setItem(LEGACY.archive, JSON.stringify(state.archives));
    return state.current.stream_id;
  });
  await page.reload();
  await page.waitForFunction(() => storageMode === 'durable');
  check('legacy keys migrate to one envelope', await page.evaluate(id => {
    const state = JSON.parse(localStorage.getItem(STATE_KEY));
    return state.current.stream_id === id
      && Object.values(LEGACY).every(key => localStorage.getItem(key) === null);
  }, migrated));
  await context.close();
}

{
  const { context, page } = await fresh();
  const before = await page.evaluate(() => ({ raw: localStorage.getItem(STATE_KEY), n: frames.length }));
  const result = await page.evaluate(() => append({
    event: 'card.added', card: 'aaaaaaaaaaaaaaaa', lane: 'now', note: '', who: '',
  }));
  check('writer rejects payload verifier would reject', result === null);
  check('rejected payload changes nothing', await page.evaluate(x =>
    frames.length === x.n && localStorage.getItem(STATE_KEY) === x.raw, before));
  const duplicateGenesis = await page.evaluate(async () => {
    const sid = await mintStream();
    const one = await buildFrame(sid, 0, { event: 'room.opened', title: 'one' }, null, null);
    const two = await buildFrame(sid, 1, { event: 'room.opened', title: 'two' }, one.payload_hash, one.utc);
    return verifyChain([one, two], sid);
  });
  check('verifier rejects a second genesis', duplicateGenesis.some(x => /genesis can only/i.test(x)));
  await context.close();
}

{
  const { context, page } = await fresh();
  await page.evaluate(() => {
    const real = buildFrame;
    let release;
    window.__gate = new Promise(resolve => { release = resolve; });
    window.__release = release;
    window.__blocked = false;
    window.__appendDone = false;
    window.__switchDone = false;
    buildFrame = async (...args) => {
      if (args[2]?.title === 'blocked old append') {
        window.__blocked = true;
        await window.__gate;
      }
      return real(...args);
    };
    append({
      event: 'card.added', card: 'bbbbbbbbbbbbbbbb', lane: 'now',
      title: 'blocked old append', note: '', who: '',
    }).then(() => { window.__appendDone = true; });
  });
  await page.waitForFunction(() => window.__blocked);
  await page.evaluate(() => {
    loadScenario('incident', { silent: true }).then(() => { window.__switchDone = true; });
  });
  await page.evaluate(() => window.__release());
  await page.waitForFunction(() => window.__appendDone && window.__switchDone);
  const race = await page.evaluate(async () => ({
    title: frames[0].payload.title,
    problems: await verifyChain(frames, streamId),
    diskSame: JSON.parse(localStorage.getItem(STATE_KEY)).current.stream_id === streamId,
  }));
  check('replacement waits for in-flight append', race.title === 'Incident, hour two');
  check('replacement race leaves one valid stream', race.problems.length === 0 && race.diskSame);
  await context.close();
}

{
  const context = await browser.newContext();
  const first = (await freshInContext(context));
  const second = (await freshInContext(context));
  let written = 0;
  first.on('dialog', async dialog => {
    await second.evaluate(() => addCard('next', 'written during reset confirmation'));
    written = await second.evaluate(() => frames.length);
    await dialog.accept();
  });
  await first.click('#reset');
  await first.waitForTimeout(300);
  check('reset rechecks after confirmation', await first.evaluate(n => {
    const state = JSON.parse(localStorage.getItem(STATE_KEY));
    return state.current.frames.length === n;
  }, written));
  check('stale reset reports conflict', /another tab/i.test(await first.textContent('#status')));
  await context.close();
}

{
  const { context, page } = await fresh();
  const before = await page.evaluate(() => ({ raw: localStorage.getItem(STATE_KEY), n: frames.length }));
  await page.evaluate(() => {
    const real = Storage.prototype.setItem;
    Storage.prototype.setItem = function (key, value) {
      if (key === STATE_KEY) throw new Error('quota');
      return real.call(this, key, value);
    };
  });
  await page.click('#reset');
  await page.waitForTimeout(300);
  check('failed reset preserves complete old envelope', await page.evaluate(x =>
    frames.length === x.n && localStorage.getItem(STATE_KEY) === x.raw, before));
  await context.close();
}

{
  const { context, page } = await fresh();
  await page.click('#reset');
  await page.waitForFunction(() => frames.length === 1);
  await page.evaluate(() => addCard('next', 'stop gate'));
  await page.evaluate(() => {
    const real = buildFrame;
    let release;
    window.__gate = new Promise(resolve => { release = resolve; });
    window.__release = release;
    window.__blocked = false;
    buildFrame = async (...args) => {
      if (!window.__blocked && args[2]?.event === 'card.moved') {
        window.__blocked = true;
        await window.__gate;
      }
      return real(...args);
    };
  });
  await page.click('#dryrun');
  await page.waitForFunction(() => window.__blocked);
  const stoppedAt = await page.evaluate(() => frames.length);
  await page.click('#dryrun');
  await page.evaluate(() => window.__release());
  await page.waitForTimeout(500);
  check('run stop commits zero later frames', await page.evaluate(n => frames.length === n, stoppedAt));
  await context.close();
}

{
  const { context, page } = await fresh({
    beforeBoot: () => {
      const chunk = 'x'.repeat(100 * 1024);
      try { for (let i = 0; i < 200; i++) localStorage.setItem('saturation-' + i, chunk); } catch (e) {}
      try { for (let i = 0; i < 200; i++) localStorage.setItem('saturation-medium-' + i, 'x'.repeat(4096)); } catch (e) {}
      try { for (let i = 0; i < 500; i++) localStorage.setItem('saturation-small-' + i, 'x'.repeat(256)); } catch (e) {}
    },
  });
  check('saturated origin opens safe fallback', await page.evaluate(() =>
    storageMode === 'readonly' && frames.length > 0));
  check('saturated fallback leaves origin untouched', await page.evaluate(() =>
    localStorage.getItem(STATE_KEY) === null
    && Object.keys(localStorage).some(key => key.startsWith('saturation-'))));
  check('fallback labels itself explicitly', /SAFE READ-ONLY MODE/i.test(await page.textContent('#status')));
  check('fallback picker still populates', await page.locator('#scenario option').count() >= 3);
  check('fallback permits export and replay',
    !(await page.locator('#export').isDisabled()) && !(await page.locator('#play').isDisabled()));
  check('fallback disables unsafe writes',
    await page.locator('#reset').isDisabled() && await page.locator('#import').isDisabled()
    && await page.locator('#agents').isDisabled());
  await context.close();
}

{
  const { context, page } = await fresh({ viewport: { width: 390, height: 844 } });
  check('390px viewport has no horizontal overflow', await page.evaluate(() =>
    document.documentElement.scrollWidth <= window.innerWidth));
  check('status is a live region', await page.locator('#status').getAttribute('aria-live') === 'polite');
  await page.click('#import');
  check('modal has an accessible name', await page.locator('#io').getAttribute('aria-labelledby') === 'io-title');
  await page.fill('#io-text', '{');
  await page.click('#io-ok');
  check('import error is inside the dialog', /not JSON/i.test(await page.textContent('#io-error')));
  check('dynamic errors use an alert role', await page.locator('#status').getAttribute('role') === 'alert');
  await page.evaluate(() => document.getElementById('io').close());
  await page.focus('#tab-ledger');
  await page.keyboard.press('ArrowRight');
  check('tabs support arrow keys', await page.evaluate(() =>
    document.activeElement.id === 'tab-about'
    && document.getElementById('tab-about').getAttribute('aria-selected') === 'true'));
  check('add inputs have labels', await page.locator('.add input').first().getAttribute('aria-labelledby') !== null
    || await page.locator('label[for^="add-"]').count() === 4);
  await context.close();
}

async function freshInContext(context) {
  const page = await context.newPage();
  page.on('pageerror', error => { console.log('  PAGE ERROR — ' + error.message); bad++; });
  await page.goto(APP);
  await page.waitForFunction(() => typeof storageMode !== 'undefined' && frames.length > 0);
  return page;
}

await browser.close();
console.log(bad ? `\n${bad} acceptance gate(s) failed` : '\nall atomicity, corruption, race, fallback, and accessibility gates passed');
process.exit(bad ? 1 : 0);

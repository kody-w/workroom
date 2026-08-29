import { chromium } from 'playwright';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const APP = 'file://' + join(here, 'index.html');
const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await context.newPage();
let bad = 0;
const check = (name, pass, detail = '') => {
  console.log('  ' + name.padEnd(38) + (pass ? 'yes' : 'NO') + (detail ? ' — ' + detail : ''));
  if (!pass) bad++;
};
page.on('pageerror', error => { console.log('  PAGE ERROR — ' + error.message); bad++; });
page.on('dialog', dialog => dialog.accept());

await page.goto(APP);
await page.waitForFunction(() => typeof storageMode !== 'undefined' && frames.length > 0);
check('opens with a verified example',
  await page.locator('.card').count() > 0
  && /verified on load/i.test(await page.textContent('#status')));
check('uses the atomic envelope', await page.evaluate(() => {
  const raw = localStorage.getItem(STATE_KEY);
  if (!raw) return false;
  const state = JSON.parse(raw);
  return state.version === 1 && state.current.stream_id === streamId
    && state.current.frames.length === frames.length && !localStorage.getItem(LEGACY.frames);
}));
check('agent-authored cards visible', await page.locator('.who.agent').count() > 0);
check('worked-example picker populated', await page.locator('#scenario option').count() >= 3);

await page.selectOption('#scenario', 'seed:incident');
await page.waitForFunction(() => frames[0].payload.title === 'Incident, hour two');
check('scenario switch persisted atomically', await page.evaluate(() => {
  const state = JSON.parse(localStorage.getItem(STATE_KEY));
  return state.current.stream_id === streamId
    && JSON.stringify(state.current.frames) === JSON.stringify(frames);
}));

const before = await page.evaluate(() => frames.length);
await page.click('#agents');
await page.evaluate(() => agentTick());
await page.waitForFunction(n => frames.length > n, before);
check('agent append used the same writer', await page.evaluate(async () =>
  (await verifyChain(frames, streamId)).length === 0));

await browser.close();
console.log(bad ? `\n${bad} seed check(s) failed` : '\nseeded boot, switching, and agent append all passed');
process.exit(bad ? 1 : 0);

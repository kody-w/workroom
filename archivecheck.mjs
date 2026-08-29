import { chromium } from 'playwright';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const APP = 'file://' + join(here, 'index.html');
const browser = await chromium.launch();
const context = await browser.newContext();
const page = await context.newPage();
let bad = 0;
const check = (name, pass, detail = '') => {
  console.log('  ' + name.padEnd(46) + (pass ? 'yes' : 'NO') + (detail ? ' — ' + detail : ''));
  if (!pass) bad++;
};
page.on('pageerror', error => { console.log('  PAGE ERROR — ' + error.message); bad++; });
page.on('dialog', dialog => dialog.accept());

await page.goto(APP);
await page.waitForFunction(() => typeof frames !== 'undefined' && frames.length > 1);
const before = await page.evaluate(() => ({
  raw: localStorage.getItem(STATE_KEY),
  stream: streamId,
  count: frames.length,
  archives: Object.keys(stateEnvelope.archives),
}));

const fill = await page.evaluate(() => {
  const chunk = 'x'.repeat(64 * 1024);
  let large = 0;
  try {
    for (let i = 0; i < 200; i++) {
      localStorage.setItem('archive-pressure-' + i, chunk);
      large++;
    }
  } catch (error) {}
  let small = 0;
  try {
    for (let i = 0; i < 500; i++) {
      localStorage.setItem('archive-pressure-small-' + i, 'x'.repeat(512));
      small++;
    }
  } catch (error) {}
  return { large, small };
});

const forked = await page.evaluate(() => forkFrom(Math.floor(frames.length / 2)));
await page.waitForTimeout(300);
const after = await page.evaluate(() => ({
  raw: localStorage.getItem(STATE_KEY),
  stream: streamId,
  count: frames.length,
  archives: Object.keys(stateEnvelope.archives),
  status: document.getElementById('status').textContent,
}));
check('origin was saturated', fill.large > 0);
check('fork reports failure under quota', forked === false && /could not be written|still intact/i.test(after.status));
check('failed fork preserves atomic envelope', after.raw === before.raw);
check('failed fork preserves current stream', after.stream === before.stream && after.count === before.count);
check('failed fork preserves archive set',
  JSON.stringify(after.archives.sort()) === JSON.stringify(before.archives.sort()));

await browser.close();
console.log(bad ? `\n${bad} archive check(s) failed` : '\nquota-failed fork preserved the complete atomic envelope');
process.exit(bad ? 1 : 0);

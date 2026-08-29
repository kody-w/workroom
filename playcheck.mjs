import { chromium } from 'playwright';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const APP = 'file://' + join(here, 'index.html');
const browser = await chromium.launch();
const page = await (await browser.newContext({ viewport: { width: 1440, height: 900 } })).newPage();
let bad = 0;
const check = (name, pass, detail = '') => {
  console.log('  ' + name.padEnd(36) + (pass ? 'yes' : 'NO') + (detail ? ' — ' + detail : ''));
  if (!pass) bad++;
};
page.on('pageerror', error => { console.log('  PAGE ERROR — ' + error.message); bad++; });

await page.goto(APP);
await page.waitForFunction(() => typeof frames !== 'undefined' && frames.length > 1);
await page.click('#play');
await page.waitForTimeout(900);
check('caption visible while playing', await page.locator('#caption').isVisible());
check('caption has an event description', (await page.textContent('#caption')).trim().length > 4);
check('a changed card is highlighted', await page.locator('.card.acting, .card.arriving').count() > 0);
check('ledger follows the replay', await page.locator('.frame.at').count() === 1);

const samples = [];
for (let i = 0; i < 5; i++) {
  await page.waitForTimeout(1400);
  samples.push(await page.locator('.card').count());
}
check('projection changes over time', new Set(samples).size > 1, samples.join(' → '));
await page.waitForFunction(() => viewAt === null && playing === null, null, { timeout: 15000 });
check('replay ends at head', await page.evaluate(() => viewAt === null && playing === null));
check('caption hidden at end', !(await page.locator('#caption').isVisible()));

await browser.close();
console.log(bad ? `\n${bad} playback check(s) failed` : '\nanimated replay checks passed');
process.exit(bad ? 1 : 0);

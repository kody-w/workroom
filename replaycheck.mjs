import { chromium } from 'playwright';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const APP = 'file://' + join(here, 'index.html');
const browser = await chromium.launch();
const page = await (await browser.newContext({ viewport: { width: 1440, height: 900 } })).newPage();
let bad = 0;
const check = (name, pass, detail = '') => {
  console.log('  ' + name.padEnd(38) + (pass ? 'yes' : 'NO') + (detail ? ' — ' + detail : ''));
  if (!pass) bad++;
};
page.on('pageerror', error => { console.log('  PAGE ERROR — ' + error.message); bad++; });

await page.goto(APP);
await page.waitForFunction(() => typeof frames !== 'undefined' && frames.length > 1);
const headCards = await page.locator('.card').count();

await page.locator('#scrub').fill('0');
await page.dispatchEvent('#scrub', 'input');
check('frame zero is an empty world', await page.locator('.card').count() === 0);
check('rewound board is marked past', await page.evaluate(() => document.body.classList.contains('past')));
check('editing is hidden while rewound', !(await page.locator('.add').first().isVisible()));

const before = await page.evaluate(() => frames.length);
await page.evaluate(() => addCard('now', 'must not be written'));
check('rewound write is refused', await page.evaluate(n => frames.length === n, before));
check('rewound refusal explains why', /earlier frame/i.test(await page.textContent('#status')));

await page.click('#now');
check('return to now restores head board', await page.locator('.card').count() === headCards);
check('return clears past state', !(await page.evaluate(() => document.body.classList.contains('past'))));

await page.click('#play');
await page.waitForTimeout(900);
await page.click('#play');
check('pause clears replay state', await page.evaluate(() => playing === null
  && !document.body.classList.contains('playing')));
check('pause clears replay caption', !(await page.locator('#caption').isVisible()));

await page.click('#play');
await page.waitForFunction(() => viewAt === null && playing === null, null, { timeout: 20000 });
check('replay lands at the live head', await page.evaluate(() => viewAt === null && playing === null));

await browser.close();
console.log(bad ? `\n${bad} replay check(s) failed` : '\nreplay, pause, rewind, and return-to-head all passed');
process.exit(bad ? 1 : 0);

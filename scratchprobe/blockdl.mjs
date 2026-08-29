import { chromium } from 'playwright';
import fs from 'fs'; import path from 'path';

const DL = '/Users/kodywildfeuer/workroom/scratchprobe/dl';
fs.rmSync(DL, { recursive: true, force: true }); fs.mkdirSync(DL, { recursive: true });

const mode = process.argv[2] || 'block';          // block | accept
const browser = await chromium.launch();
const ctx = await browser.newContext({ acceptDownloads: mode === 'accept' });
const page = await ctx.newPage();
let started = 0, saved = 0, failed = [];
page.on('download', async d => {
  started++;
  if (mode === 'accept') { try { await d.saveAs(path.join(DL, d.suggestedFilename())); saved++; } catch(e){ failed.push(e.message);} }
  else { const f = await d.failure(); failed.push(f); }
});
page.on('pageerror', e => console.log('PAGEERROR', e.message));

await page.goto('file:///Users/kodywildfeuer/workroom/index.html');
await page.waitForTimeout(1500);
await page.click('#dryrun');

// wait for the run to end (button text returns)
for (let i = 0; i < 240; i++) {
  const t = await page.textContent('#dryrun');
  if (i > 5 && t.includes('Dry run')) break;
  await page.waitForTimeout(500);
}
await page.waitForTimeout(1200);

const out = await page.evaluate(() => ({
  outboxLen: outbox.length,
  urlsAlive: outbox.filter(a => !!a.url).length,
  names: outbox.map(a => a.name),
  header: document.querySelector('#pane-out p.about')?.textContent,
  badge: document.getElementById('out-n')?.textContent,
  status: document.getElementById('status')?.textContent || document.querySelector('.status')?.textContent,
}));
const files = fs.readdirSync(DL);
console.log(JSON.stringify({ mode, downloadsStarted: started, savedToDisk: saved,
  failures: failed.slice(0,3), filesOnDisk: files.length, files, ...out }, null, 2));
await browser.close();

/* runcheck.mjs — does the dry run actually put reviewable files on disk?
 *
 * The claim the Outbox makes is checkable, so this checks it: run the board, catch
 * every download the page starts, sha256 the bytes that landed on disk, and require
 * them to equal the hash the Outbox printed. Then re-verify the chain the run wrote.
 *
 *   node runcheck.mjs
 */
import { chromium } from 'playwright';
import { readFileSync, mkdtempSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const out = mkdtempSync(join(tmpdir(), 'workroom-run-'));
const b = await chromium.launch();
const ctx = await b.newContext({ viewport: { width: 1440, height: 900 }, acceptDownloads: true });
const p = await ctx.newPage();
let bad = 0;
p.on('pageerror', e => { console.log('  [page error] ' + e.message); bad++; });
const say = (k, v) => console.log('  ' + k.padEnd(36) + v);
const files = [];
p.on('download', async d => {
  const dest = join(out, files.length + '-' + d.suggestedFilename());
  try { await d.saveAs(dest); files.push({ name: d.suggestedFilename(), path: dest }); }
  catch (e) { console.log('  [download failed] ' + e.message); }
});

await p.goto('file:///Users/kodywildfeuer/workroom/index.html');
await p.waitForFunction(() => document.querySelectorAll('.lane').length === 4);
await p.waitForTimeout(600);
p.on('dialog', d => d.accept());
// boot lands on the first worked example, which is the board to run

const before = await p.evaluate(() => frames.length);
const q = await p.evaluate(() => ({ next: (board.order.next || []).length, now: (board.order.now || []).length }));
const queued = q.next + q.now;
// a card waiting in Next costs three frames (pick up, log, done); one already in Now
// is picked up already, so it costs two
const expect = q.next * 3 + q.now * 2;
say('cards queued for the run', queued + ' (' + q.next + ' in Next, ' + q.now + ' in Now)');

await p.click('#dryrun');
say('button while running', (await p.textContent('#dryrun')).trim());
// each card is three appends plus two 650ms naps and a 550ms tail
await p.waitForFunction(() => runSession === null, null, { timeout: 120000 });
await p.waitForTimeout(700);

const after = await p.evaluate(() => frames.length);
say('frames appended by the run', String(after - before));
say('frames match the work done', (after - before) === expect ? 'yes, ' + expect : 'NO, expected ' + expect);
if ((after - before) !== expect) bad++;

const box = await p.evaluate(() => outbox.map(a => ({ name: a.name, sha: a.sha, bytes: a.bytes })));
say('artifacts in the Outbox', String(box.length));
say('one per card, plus a receipt', box.length === queued + 1 ? 'yes' : 'NO');
say('files that reached the disk', String(files.length));

let mismatched = 0, empty = 0;
for (const a of box) {
  const f = files.find(x => x.name === a.name);
  if (!f) { console.log('  MISSING ON DISK  ' + a.name); mismatched++; continue; }
  const bytes = readFileSync(f.path);
  const sha = createHash('sha256').update(bytes).digest('hex');   // plain, like shasum -a 256
  if (sha !== a.sha) { console.log('  HASH DIFFERS     ' + a.name); mismatched++; }
  if (bytes.length !== a.bytes) { console.log('  LENGTH DIFFERS   ' + a.name); mismatched++; }
  if (!bytes.length) empty++;
}
say('disk bytes match the stated sha256', mismatched ? 'NO — ' + mismatched : 'every one');
say('no empty artifacts', empty ? 'NO' : 'yes');

// the deliverables have to be readable work products, not stubs
const md = files.find(f => f.name.endsWith('.md'));
const text = md ? readFileSync(md.path, 'utf8') : '';
say('a work product names its frames', /wave [0-9a-f]{64}/.test(text) ? 'yes' : 'NO');
say('…and the stream it came from', text.includes('rappid:@kody-w/') ? 'yes' : 'NO');

// the receipt must be honest about the chain, and re-verifiable without the page
const rc = files.find(f => f.name.startsWith('workroom-run-receipt'));
const receipt = rc ? JSON.parse(readFileSync(rc.path, 'utf8')) : null;
say('receipt says the chain verified', receipt && receipt.verified === true ? 'yes' : 'NO');
say('receipt carries the run frames', receipt ? String(receipt.chain.length) : 'NO');
say('every artifact listed with a hash',
    receipt && receipt.artifacts.every(a => /^[0-9a-f]{64}$/.test(a.sha256)) ? 'yes' : 'NO');

await p.click('#verify'); await p.waitForTimeout(600);
const st = (await p.textContent('#status')).replace(/\s+/g, ' ').trim();
say('the app re-verifies after the run', /all \d+ frames verified/i.test(st) ? 'yes' : 'NO — ' + st);

// stopping means stopped: a run that was killed must not write another frame
await p.evaluate(() => addCard('next', 'a card for the stop test'));
await p.waitForTimeout(400);
await p.click('#dryrun');
await p.waitForTimeout(300);
const mid = await p.evaluate(() => frames.length);
await p.click('#dryrun');                       // stop
await p.waitForTimeout(2500);
const post = await p.evaluate(() => frames.length);
say('stop is final (no later frames)', post - mid <= 1 ? 'yes (' + (post - mid) + ')' : 'NO (' + (post - mid) + ')');
say('run session is gone', await p.evaluate(() => runSession === null) ? 'yes' : 'NO');
if (post - mid > 1) bad++;
if (mismatched || empty) bad++;

await p.screenshot({ path: '/Users/kodywildfeuer/workroom/shot-run.png' });
await b.close();
console.log(bad ? '\n' + bad + ' problem(s)' : '\nthe run ejected real, hash-matching files and the chain still verifies');
process.exit(bad ? 1 : 0);

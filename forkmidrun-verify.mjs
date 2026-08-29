/* forkmidrun-verify.mjs — fork the record while a dry run is in flight.
 * Observes: does the run keep going, where do its appends land, and what does
 * the receipt say about itself?
 */
import { chromium } from 'playwright';
import { mkdtempSync } from 'node:fs';
import { readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const out = mkdtempSync(join(tmpdir(), 'workroom-forkmidrun-'));
const b = await chromium.launch();
const ctx = await b.newContext({ viewport: { width: 1440, height: 900 }, acceptDownloads: true });
const p = await ctx.newPage();
const files = [];
p.on('pageerror', e => console.log('  [page error] ' + e.message));
p.on('download', async d => {
  const dest = join(out, files.length + '-' + d.suggestedFilename());
  try { await d.saveAs(dest); files.push({ name: d.suggestedFilename(), path: dest }); }
  catch (e) { console.log('  [dl failed] ' + e.message); }
});
p.on('dialog', d => d.accept());

await p.goto('file:///Users/kodywildfeuer/workroom/index.html');
await p.waitForFunction(() => document.querySelectorAll('.lane').length === 4);
await p.waitForTimeout(700);

const s0 = await p.evaluate(() => ({ stream: streamId, n: frames.length }));
console.log('BEFORE  stream=' + s0.stream + '  frames=' + s0.n);

await p.click('#dryrun');
await p.waitForTimeout(1200);
const mid = await p.evaluate(() => ({ n: frames.length, running: !!runSession, working: workingId }));
console.log('MID-RUN frames=' + mid.n + ' running=' + mid.running + ' workingCard=' + mid.working);

// fork from the CURRENT head while the run is alive
await p.evaluate(() => forkFrom(frames.length - 1));
await p.waitForTimeout(400);
const s1 = await p.evaluate(() => ({ stream: streamId, n: frames.length, running: !!runSession }));
console.log('AFTER FORK stream=' + s1.stream + '  frames=' + s1.n + '  run still alive=' + s1.running);
console.log('  stream changed: ' + (s1.stream !== s0.stream));

await p.waitForFunction(() => runSession === null, null, { timeout: 180000 });
await p.waitForTimeout(900);

const end = await p.evaluate(() => ({
  stream: streamId, n: frames.length,
  status: (document.querySelector('#status') || {}).textContent,
  outbox: outbox.map(a => a.name),
}));
console.log('END     stream=' + end.stream + '  frames=' + end.n);
console.log('STATUS  ' + (end.status || '').trim());
console.log('FILES   ' + files.map(f => f.name).join(', '));

const rec = files.find(f => f.name.includes('run-receipt'));
if (!rec) { console.log('NO RECEIPT'); await b.close(); process.exit(0); }
const R = JSON.parse(readFileSync(rec.path, 'utf8'));
console.log('\nRECEIPT');
console.log('  stream_id      ' + R.stream_id);
console.log('  == live stream ' + (R.stream_id === end.stream) + '   == pre-fork stream ' + (R.stream_id === s0.stream));
console.log('  frames_before  ' + R.frames_before);
console.log('  frames_after   ' + R.frames_after);
console.log('  verified       ' + R.verified + '   problems=' + JSON.stringify(R.problems));
console.log('  artifacts      ' + R.artifacts.length);
console.log('  chain length   ' + R.chain.length);
const chainStreams = [...new Set(R.chain.map(f => f.stream_id))];
console.log('  chain stream_ids ' + JSON.stringify(chainStreams));

// do the artifacts' cited frames actually live in the receipt's chain / live chain?
const live = await p.evaluate(() => frames.map(f => f.frame_hash));
const inChain = new Set(R.chain.map(f => f.frame_hash));
const inLive = new Set(live);
let cited = 0, missChain = 0, missLive = 0;
for (const a of R.artifacts) for (const fr of (a.frames || [])) {
  cited++;
  if (!inChain.has(fr.frame_hash)) missChain++;
  if (!inLive.has(fr.frame_hash)) missLive++;
}
console.log('  frames cited by artifacts   ' + cited);
console.log('  NOT in the receipt chain    ' + missChain);
console.log('  NOT in the live chain       ' + missLive);

const md = files.filter(f => f.name.endsWith('.md'));
if (md.length) {
  const t = readFileSync(md[0].path, 'utf8');
  console.log('\nFIRST .md (' + md[0].name + ') head:\n' + t.split('\n').slice(0, 16).map(l => '  | ' + l).join('\n'));
}
await b.close();

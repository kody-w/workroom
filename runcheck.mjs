import { chromium } from 'playwright';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const APP = 'file://' + join(here, 'index.html');
const html = readFileSync(join(here, 'index.html'), 'utf8');
const primitives = html.slice(html.indexOf('/* ── §4 canonicalization'), html.indexOf('/* ── state '));
const { H } = await import('data:text/javascript,' + encodeURIComponent(primitives + '\nexport { H };'));

async function verifyDownloadedChain(chain, stream) {
  const problems = [];
  if (!Array.isArray(chain) || !chain.length) return ['chain is empty'];
  const keys = ['frame_hash','kind','payload','payload_hash','prev','prev_wave','seq','sig','spec','stream_id','utc'].join(',');
  const live = new Set();
  for (let i = 0; i < chain.length; i++) {
    const frame = chain[i];
    if (Object.keys(frame).sort().join(',') !== keys) problems.push(`frame ${i}: key set`);
    if (frame.spec !== 'rapp/1' || frame.kind !== 'memory.save') problems.push(`frame ${i}: protocol fields`);
    if (frame.seq !== i) problems.push(`frame ${i}: seq ${frame.seq}`);
    if (frame.stream_id !== stream) problems.push(`frame ${i}: wrong stream`);
    if (frame.sig !== null || frame.prev_wave !== null) problems.push(`frame ${i}: memory-stream fields`);
    if (i > 0 && frame.utc < chain[i - 1].utc) problems.push(`frame ${i}: time moved backwards`);
    if (i === 0 && (frame.prev !== null || frame.payload?.event !== 'room.opened')) {
      problems.push('genesis is invalid');
    }
    if (i > 0 && frame.prev !== chain[i - 1].payload_hash) problems.push(`frame ${i}: broken link`);
    const payload = frame.payload;
    if (payload?.event === 'card.added') {
      if (live.has(payload.card)) problems.push(`frame ${i}: duplicate card`);
      live.add(payload.card);
    } else if (payload?.event === 'card.removed') {
      if (!live.has(payload.card)) problems.push(`frame ${i}: missing card`);
      live.delete(payload.card);
    } else if (payload?.event === 'card.moved' || payload?.event === 'card.edited') {
      if (!live.has(payload.card)) problems.push(`frame ${i}: missing card`);
    } else if (i > 0 || payload?.event !== 'room.opened') {
      problems.push(`frame ${i}: invalid event`);
    }
    if (await H('rapp/1:particle', frame.payload) !== frame.payload_hash) problems.push(`frame ${i}: particle hash`);
    const pre = { ...frame }; delete pre.frame_hash; delete pre.sig;
    if (await H('rapp/1:wave', pre) !== frame.frame_hash) problems.push(`frame ${i}: wave hash`);
  }
  return problems;
}

const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, acceptDownloads: true });
const page = await context.newPage();
let bad = 0;
const check = (name, pass, detail = '') => {
  console.log('  ' + name.padEnd(42) + (pass ? 'yes' : 'NO') + (detail ? ' — ' + detail : ''));
  if (!pass) bad++;
};
page.on('pageerror', error => { console.log('  PAGE ERROR — ' + error.message); bad++; });
page.on('dialog', dialog => dialog.accept());
const downloads = [];
const downloadTasks = [];
page.on('download', download => {
  const task = (async () => {
    const stream = await download.createReadStream();
    const chunks = [];
    for await (const chunk of stream) chunks.push(chunk);
    downloads.push({ name: download.suggestedFilename(), bytes: Buffer.concat(chunks) });
  })();
  downloadTasks.push(task);
});

await page.goto(APP);
await page.waitForFunction(() => typeof frames !== 'undefined' && frames.length > 0);
await page.click('#reset');
await page.waitForFunction(() => frames.length === 1);
await page.evaluate(() => addCard('next', 'receipt proof'));
const before = await page.evaluate(() => frames.length);

await page.click('#dryrun');
await page.waitForFunction(() => runSession === null, null, { timeout: 30000 });
await page.waitForTimeout(300);
await Promise.all(downloadTasks);

const after = await page.evaluate(() => frames.length);
check('one-card run appended three frames', after - before === 3, `${after - before} appended`);
const box = await page.evaluate(() => outbox.map(a => ({ name: a.name, sha: a.sha, bytes: a.bytes })));
check('one artifact plus one receipt', box.length === 2, `${box.length} downloads`);
check('both downloads reached the browser', downloads.length === 2, `${downloads.length} received`);

let byteMismatch = 0;
for (const entry of box) {
  const file = downloads.find(candidate => candidate.name === entry.name);
  if (!file) { byteMismatch++; continue; }
  const sha = createHash('sha256').update(file.bytes).digest('hex');
  if (sha !== entry.sha || file.bytes.length !== entry.bytes || file.bytes.length === 0) byteMismatch++;
}
check('download bytes match Outbox hashes', byteMismatch === 0, `${byteMismatch} mismatch(es)`);

const receiptFile = downloads.find(file => file.name.startsWith('workroom-run-receipt-'));
let receipt = null;
try { receipt = receiptFile && JSON.parse(receiptFile.bytes.toString('utf8')); } catch (error) {}
check('receipt is readable JSON', !!receipt);
const receiptProblems = receipt ? await verifyDownloadedChain(receipt.chain, receipt.stream_id) : ['missing receipt'];
check('receipt carries a complete verifiable chain', receiptProblems.length === 0, receiptProblems[0] || '');
check('receipt isolates run frames', receipt && receipt.run_frames.length === 3);
check('receipt lists every artifact hash', receipt
  && receipt.artifacts.length === 1
  && receipt.artifacts.every(a => /^[0-9a-f]{64}$/.test(a.sha256)));

await page.click('#verify');
check('app re-verifies after run', /all \d+ frames verified/i.test(await page.textContent('#status')));

await page.evaluate(() => addCard('next', 'stop race card'));
await page.evaluate(() => {
  const real = buildFrame;
  let release;
  window.__stopGate = new Promise(resolve => { release = resolve; });
  window.__releaseStop = release;
  window.__stopBlocked = false;
  buildFrame = async (...args) => {
    const payload = args[2];
    if (!window.__stopBlocked && payload?.event === 'card.moved' && payload.lane === 'now') {
      window.__stopBlocked = true;
      await window.__stopGate;
    }
    return real(...args);
  };
});
await page.click('#dryrun');
await page.waitForFunction(() => window.__stopBlocked);
const atStop = await page.evaluate(() => frames.length);
await page.click('#dryrun');
await page.evaluate(() => window.__releaseStop());
await page.waitForTimeout(500);
check('stop permits zero later frames', await page.evaluate(n => frames.length === n, atStop));
check('stopped run session is gone', await page.evaluate(() => runSession === null));

await browser.close();
console.log(bad ? `\n${bad} run check(s) failed` : '\nrun artifacts, receipt, hashes, and cancellation all passed');
process.exit(bad ? 1 : 0);

/* studiocheck.mjs — does the wire carry the record, and does a watcher rebuild from it?
 *
 * The studio's claim is that a watcher receives FRAMES, not pixels, and re-derives the
 * board itself. So: run the board in the studio, take what the studio put on the wire,
 * and require a second, independent reader to reach the same board from it. Also prove
 * the studio refuses a frame that does not verify — a broadcast nobody checks is a
 * video with extra steps.
 */
import { chromium } from 'playwright';
const b = await chromium.launch();
const ctx = await b.newContext({ viewport: { width: 1500, height: 900 } });
const p = await ctx.newPage();
let bad = 0;
p.on('pageerror', e => { console.log('  [page error] ' + e.message); bad++; });
p.on('dialog', d => d.accept());
const say = (k, v, ok) => { console.log('  ' + k.padEnd(38) + v); if (ok === false) bad++; };

await p.goto('file:///Users/kodywildfeuer/workroom/broadcast.html');
await p.waitForTimeout(2500);                       // the board boots and hands over its chain

const seeded = await p.evaluate(() => ({ n: wireFrames.length, stream: wireStream }));
say('the board handed over its chain', seeded.n + ' frames', seeded.n > 10);
say('every one verified in the studio', /verified here/.test(await p.textContent('#stat')) ? 'yes' : 'NO',
    /verified here/.test(await p.textContent('#stat')));

// run the board and watch the wire grow in real time
const before = seeded.n;
await p.click('#run');
await p.waitForFunction((n) => wireFrames.length > n + 4, before, { timeout: 60000 });
const mid = await p.evaluate(() => wireFrames.length);
say('frames arrive while it works', before + ' → ' + mid, mid > before);
await p.waitForFunction(() => /finished/.test(document.getElementById('stat').textContent), null, { timeout: 120000 });
const after = await p.evaluate(() => wireFrames.length);
say('the whole run reached the wire', String(after), after > mid);

// The wire must be the SAME chain the app committed, not a re-render of it. The board is
// a file:// frame and therefore a foreign origin, so this asks it the way the studio does —
// through the command channel — rather than reaching into it.
const same = await p.evaluate(() => new Promise((res) => {
  const t = setTimeout(() => res('the board did not answer'), 4000);
  const on = (e) => {
    if (!e.data || e.data.rapp !== 'chain') return;
    clearTimeout(t); window.removeEventListener('message', on);
    const a = e.data.frames;
    if (a.length !== wireFrames.length) return res('length ' + a.length + ' vs ' + wireFrames.length);
    for (let i = 0; i < a.length; i++)
      if (a[i].frame_hash !== wireFrames[i].frame_hash) return res('frame ' + i + ' differs');
    res('identical');
  };
  window.addEventListener('message', on);
  document.getElementById('f').contentWindow.postMessage({ rapp: 'command', do: 'chain' }, '*');
}));
say('the wire is the app\'s own chain', same, same === 'identical');

// a frame that does not verify must not land, however it arrives
const refused = await p.evaluate(async () => {
  const n = wireFrames.length;
  const bent = JSON.parse(JSON.stringify(wireFrames[n - 1]));
  bent.payload.title = 'not what was hashed';
  bent.seq = n;
  await takeFrame(bent, wireStream);
  return { grew: wireFrames.length !== n, said: document.getElementById('stat').textContent };
});
say('a bent frame is refused', refused.grew ? 'NO — it landed' : 'yes', !refused.grew);
say('…and it says why', refused.said.slice(0, 46), /refused a frame/.test(refused.said));

// a second reader: give the wire to a clean page and require the same board
const w = await ctx.newPage();
w.on('pageerror', e => { console.log('  [watcher error] ' + e.message); bad++; });
await w.goto('file:///Users/kodywildfeuer/workroom/broadcast.html#watch=nobody');
await w.waitForTimeout(700);
const chain = await p.evaluate(() => ({ stream: wireStream, frames: wireFrames }));
const rebuilt = await w.evaluate(async (c) => {
  wireFrames = []; lastGood = null; wireStream = null;
  let ok = 0;
  for (const f of c.frames) { if (await takeFrame(f, c.stream)) ok++; else break; }
  paintBoard();
  const b = project(wireFrames);
  return { ok, lanes: Object.fromEntries(Object.entries(b.order).map(([k, v]) => [k, v.length])),
           cards: document.querySelectorAll('#lanes .cd').length };
}, chain);
say('the watcher verified every frame', rebuilt.ok + ' of ' + chain.frames.length, rebuilt.ok === chain.frames.length);

// The studio projects the wire with its own code; so does the watcher. If the two agree
// AND the wire is byte-identical to the app's chain (checked above), the watcher reached
// the app's board without ever being shown it.
const truth = await p.evaluate(() => {
  const b = project(wireFrames);
  return Object.fromEntries(Object.entries(b.order).map(([k, v]) => [k, v.length]));
});
const match = JSON.stringify(truth) === JSON.stringify(rebuilt.lanes);
say('and reached the same board', match ? JSON.stringify(rebuilt.lanes) : 'NO\n      app: ' + JSON.stringify(truth) + '\n      watcher: ' + JSON.stringify(rebuilt.lanes), match);
say('it drew what it derived', String(rebuilt.cards), rebuilt.cards > 0);

await p.screenshot({ path: '/Users/kodywildfeuer/workroom/shot-studio.png' });
await w.screenshot({ path: '/Users/kodywildfeuer/workroom/shot-watch.png' });
await b.close();
console.log(bad ? '\n' + bad + ' problem(s)' : '\nthe wire carries the record, and a second reader rebuilds the same board from it');
process.exit(bad ? 1 : 0);

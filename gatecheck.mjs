/* gatecheck.mjs — the five criticals from round six, each as a case that FAILS on the
 * revision the bug lived in.
 *
 *   node gatecheck.mjs                     # the working tree
 *   node gatecheck.mjs /tmp/before.html    # any other revision of the app
 *
 * Every case here answers one question: does a door enforce the rule the door beside
 * it enforces? That is the only shape of defect this app has ever had.
 */
import { chromium } from 'playwright';
const APP = 'file://' + (process.argv[2] || '/Users/kodywildfeuer/workroom/index.html');
const b = await chromium.launch();
let bad = 0;
const say = (k, v, ok) => { console.log('  ' + k.padEnd(44) + v); if (ok === false) bad++; };
// Every case gets its OWN context. Sharing one meant each case inherited the previous
// case's storage and its latched refusal, and three cases passed on both revisions
// because the code under test was never reached. A case that passes on the buggy
// revision is testing nothing.
let ctx = null;
const freshWorld = async () => { if (ctx) await ctx.close(); ctx = await b.newContext({ viewport: { width: 1440, height: 900 } }); };
const boot = async () => {
  const p = await ctx.newPage();
  p.on('dialog', d => d.accept());
  p.on('pageerror', e => console.log('  [page error] ' + e.message));
  await p.goto(APP);
  await p.waitForFunction(() => document.querySelectorAll('.lane').length === 4);
  await p.waitForTimeout(500);
  return p;
};
const disk = (p) => p.evaluate(() => {
  const f = JSON.parse(localStorage.getItem('workroom.frames') || 'null');
  return Array.isArray(f) ? f.length : 0;
});

/* ── 1. Reset is a whole-record replacement, so it obeys the same rule ───────── */
{
  await freshWorld();
  const A = await boot();
  const B = await boot();                       // same context: same localStorage
  await B.evaluate(async () => { for (let i = 0; i < 6; i++) await addCard('next', 'from B ' + i); });
  await B.waitForTimeout(500);
  const grew = await disk(B);
  await A.click('#reset');
  await A.waitForTimeout(500);
  const after = await disk(A);
  say('a stale tab cannot Reset away another tab', after === grew ? 'refused, ' + after + ' frames intact'
      : 'DESTROYED ' + grew + ' → ' + after, after === grew);
}

/* ── 2. a fork that cannot keep the parent does not replace the parent ───────── */
{
  await freshWorld();
  const p = await boot();
  const kept = await p.evaluate(async () => {
    const before = JSON.parse(localStorage.getItem('workroom.frames')).length;
    const real = localStorage.setItem.bind(localStorage);
    // the archive write fails, and only it — exactly what a full quota looks like here
    localStorage.setItem = (k, v) => { if (k === 'workroom.streams') throw new Error('quota'); return real(k, v); };
    await forkFrom(Math.floor(frames.length / 2));
    localStorage.setItem = real;
    const now = JSON.parse(localStorage.getItem('workroom.frames')).length;
    return { before, now, said: document.getElementById('status').textContent };
  });
  say('a fork that cannot archive keeps the parent',
      kept.now === kept.before ? 'yes, ' + kept.now + ' frames' : 'LOST IT ' + kept.before + ' → ' + kept.now,
      kept.now === kept.before);
}

/* ── 3. a refused fork does not cost you an archived dimension ───────────────── */
{
  await freshWorld();
  const p = await boot();
  const r = await p.evaluate(async () => {
    localStorage.setItem('workroom.streams', JSON.stringify({
      'rappid:@kody-w/old:x:y': { name: 'somewhere I was', at: 1, frames: [{ a: 1 }, { a: 2 }] },
    }));
    // Another tab moves the record on, so the fork must refuse. The disk head has to be a
    // DIFFERENT head — duplicating the last frame leaves its wave hash identical, the
    // compare-and-swap sees its own head and lets the write through, and the case proves
    // nothing. It looked like a failing fix for exactly one round.
    const f = JSON.parse(localStorage.getItem('workroom.frames'));
    const dup = JSON.parse(JSON.stringify(f[f.length - 1]));
    dup.frame_hash = 'f'.repeat(64);
    f.push(dup);
    localStorage.setItem('workroom.frames', JSON.stringify(f));
    await forkFrom(2);
    const a = JSON.parse(localStorage.getItem('workroom.streams') || '{}');
    return { still: Object.keys(a).length, said: document.getElementById('status').textContent };
  });
  say('a refused fork leaves the archive alone', r.still === 1 ? 'yes' : 'EVICTED (' + r.still + ')', r.still === 1);
}

/* ── 4. the append door will not start a chain with something that is not a genesis ── */
{
  await freshWorld();
  const p = await boot();
  const r = await p.evaluate(async () => {
    frames = []; streamId = await mintStream();
    localStorage.removeItem('workroom.frames'); localStorage.removeItem('workroom.stream');
    const f = await append({ event: 'card.added', card: 'aaaaaaaaaaaaaaaa', lane: 'now', title: 'not a genesis', note: '', who: 'KW' });
    return { wrote: !!f, n: frames.length };
  });
  say('an unverifiable chain cannot be started', r.wrote ? 'WROTE ONE' : 'refused', !r.wrote);
}

/* ── 5. a run does not survive the record it was running on ──────────────────── */
{
  await freshWorld();
  const p = await boot();
  const r = await p.evaluate(async () => {
    dryRun();
    await new Promise(res => setTimeout(res, 900));       // mid-run, holding a nap
    const wasRunning = !!runSession;
    const wasStream = streamId;
    await loadScenario('incident', { silent: true });
    // asked immediately: the old code only ever stopped the REPLAY, so the run was still
    // alive here and went on appending into a stream it knew nothing about
    const stillRunning = !!runSession;
    const n = frames.length;
    await new Promise(res => setTimeout(res, 3500));      // long enough for it to act if it lives
    return { wasRunning, stillRunning, switched: streamId !== wasStream,
             wroteIntoTheNewStream: frames.length - n };
  });
  say('a run was actually going', r.wasRunning ? 'yes' : 'the case tested nothing', r.wasRunning);
  say('the record really was replaced', r.switched ? 'yes' : 'the case tested nothing', r.switched);
  say('replacing the record ends the run', r.stillRunning ? 'STILL RUNNING' : 'stopped', !r.stillRunning);
  say('…so nothing bleeds into the new stream',
      r.wroteIntoTheNewStream === 0 ? 'yes' : 'IT WROTE ' + r.wroteIntoTheNewStream + ' frames',
      r.wroteIntoTheNewStream === 0);
}

await b.close();
console.log(bad ? '\n' + bad + ' gate(s) not held' : '\nevery door enforces the rule the door beside it enforces');
process.exit(bad ? 1 : 0);

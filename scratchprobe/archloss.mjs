import { chromium } from 'playwright';
const b = await chromium.launch();
const ctx = await b.newContext({ viewport: { width: 1440, height: 900 } });
const p = await ctx.newPage();
p.on('pageerror', e => console.log('  [page error] ' + e.message));
p.on('dialog', d => { console.log('  [dialog] ' + d.message().replace(/\n+/g,' | ').slice(0,160)); d.accept(); });
const say = (k, v) => console.log('  ' + k.padEnd(34) + v);

await p.goto('file:///Users/kodywildfeuer/workroom/index.html');
await p.waitForFunction(() => document.querySelectorAll('.lane').length === 4);
await p.waitForTimeout(500);

// start from a real seeded record
await p.evaluate(() => loadScenario('tour', { silent: true }));
await p.waitForTimeout(500);
const before = await p.evaluate(() => ({
  stream: streamId, n: frames.length,
  diskFrames: (localStorage.getItem('workroom.frames')||'').length,
  archive: localStorage.getItem('workroom.streams'),
  title: frames[0].payload.title,
}));
say('parent', before.n + ' frames, disk ' + before.diskFrames + ' bytes, "' + before.title + '"');
say('archive before', String(before.archive));

// find total quota headroom, then leave a controlled amount free
const head = await p.evaluate(async () => {
  const K = 'pad';
  let lo = 0, hi = 20 * 1024 * 1024;
  const fits = n => { try { localStorage.setItem(K, 'x'.repeat(n)); return true; } catch (e) { return false; } };
  while (lo < hi) { const mid = Math.ceil((lo + hi) / 2); if (fits(mid)) lo = mid; else hi = mid - 1; }
  localStorage.removeItem(K);
  return lo;
});
say('free headroom (chars)', String(head));
const KEEP = Number(process.env.KEEP || 6098);
await p.evaluate(([h, keep]) => { localStorage.setItem('pad', 'x'.repeat(Math.max(0, h - keep))); }, [head, KEEP]);
const left = await p.evaluate(() => { let lo=0,hi=12*1024*1024; const f=n=>{try{localStorage.setItem('probe','x'.repeat(n));localStorage.removeItem('probe');return true}catch(e){return false}}; while(lo<hi){const m=Math.ceil((lo+hi)/2); if(f(m)) lo=m; else hi=m-1;} return lo; });
say('headroom after padding', String(left));

// fork from the middle
const at = Math.floor(before.n / 2);
await p.evaluate(i => seekTo(i), at);
await p.waitForTimeout(200);
await p.click('#fork');
await p.waitForTimeout(1500);

const after = await p.evaluate(() => ({
  stream: streamId, n: frames.length,
  status: document.getElementById('status').innerText.replace(/\n+/g,' | '),
  archiveRaw: localStorage.getItem('workroom.streams'),
  diskStream: localStorage.getItem('workroom.stream'),
  diskFramesLen: (localStorage.getItem('workroom.frames')||'').length,
  diskFirstTitle: (()=>{try{return JSON.parse(localStorage.getItem('workroom.frames'))[0].payload.title}catch(e){return null}})(),
  picker: document.getElementById('scenario') ? document.getElementById('scenario').innerHTML.includes('left') : null,
}));
say('status', after.status);
say('live stream now', after.stream === before.stream ? 'SAME as parent' : 'child (' + after.n + ' frames)');
say('archive after fork', String(after.archiveRaw));
say('disk frames head title', String(after.diskFirstTitle));
say('picker has "left" group', String(after.picker));
const parentGone = after.stream !== before.stream &&
  !(after.archiveRaw && after.archiveRaw.includes(before.stream));
say('PARENT RECOVERABLE?', parentGone ? 'NO — lost' : 'yes');
await b.close();

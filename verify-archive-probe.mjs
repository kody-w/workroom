import { chromium } from 'playwright';
import { createServer } from 'http';
import { readFileSync } from 'fs';

const html = readFileSync('/Users/kodywildfeuer/workroom/index.html');
const srv = createServer((req,res)=>{res.setHeader('content-type','text/html');res.end(html);}).listen(8899);

const b = await chromium.launch();
const ctx = await b.newContext();
const p = await ctx.newPage();
p.on('dialog', d => d.accept());
p.on('pageerror', e => console.log('PAGEERROR:', e.message));
await p.goto('http://localhost:8899/');
await p.waitForTimeout(600);

// 1. load the 16-frame tour scenario
const loaded = await p.evaluate(() => loadScenario('tour', {silent:true}));
const before = await p.evaluate(() => ({
  loadedOk: true,
  frames: frames.length,
  streamId,
  framesBytes: (localStorage.getItem('workroom.frames')||'').length,
  keys: Object.keys(localStorage),
}));
console.log('loaded:', loaded, JSON.stringify(before,null,1));

// 2. work out how big the fork chain would be (dry: replicate sizes roughly)
// fill localStorage to the brim, then free a measured amount
const fill = await p.evaluate(async (headroom) => {
  const mk = n => 'x'.repeat(n);
  let big = 0;
  try { for (let i=0;i<200;i++){ localStorage.setItem('pad'+i, mk(100*1024)); big=i+1; } } catch(e) {}
  let med = 0;
  try { for (let i=0;i<200;i++){ localStorage.setItem('m'+i, mk(4*1024)); med=i+1; } } catch(e) {}
  let sm = 0;
  try { for (let i=0;i<400;i++){ localStorage.setItem('s'+i, mk(256)); sm=i+1; } } catch(e) {}
  // free `headroom` chars: drop one 100KB pad, put back 100KB-headroom
  localStorage.removeItem('pad0');
  try { localStorage.setItem('pad0', mk(Math.max(0, 100*1024 - headroom))); } catch(e) { return {err:'refill failed'}; }
  // measure headroom actually available
  let free = 0;
  for (let n=32768; n>=64; n = Math.floor(n/2)) {
    try { localStorage.setItem('probe', mk(n)); localStorage.removeItem('probe'); free = n; break; } catch(e) {}
  }
  return { big, med, sm, freeAtLeast: free, framesLen: (localStorage.getItem('workroom.frames')||'').length };
}, 7000);
console.log('fill:', JSON.stringify(fill));

// 3. click the fork
const res = await p.evaluate(() => forkFrom(15));
await p.waitForTimeout(300);
const after = await p.evaluate(() => ({
  ret: null,
  status: (document.querySelector('#status')||{}).textContent,
  memFrames: frames.length,
  memStream: streamId,
  lsFramesLen: JSON.parse(localStorage.getItem('workroom.frames')||'[]').length,
  lsStream: JSON.parse(localStorage.getItem('workroom.stream')||'null'),
  archiveRaw: localStorage.getItem('workroom.streams'),
  archiveKeys: (()=>{try{return Object.keys(JSON.parse(localStorage.getItem('workroom.streams')||'{}'));}catch(e){return 'unparseable';}})(),
}));
console.log('forkFrom returned:', res);
console.log('after:', JSON.stringify({...after, archiveRaw: after.archiveRaw===null?null:(after.archiveRaw.slice(0,80)+'...')},null,1));

const statusText = await p.evaluate(() => {
  const el = document.querySelector('[id*=status]') || document.querySelector('.status');
  return el ? el.textContent.trim() : 'NO STATUS EL';
});
console.log('status line:', statusText);

await b.close(); srv.close();

import { chromium } from 'playwright';
const b = await chromium.launch();
const ctx = await b.newContext({ viewport:{width:1440,height:900}, acceptDownloads:true });
const p = await ctx.newPage();
p.on('pageerror', e => console.log('  [page error] ' + e.message));
p.on('download', d => {}); // swallow
await p.goto('file:///Users/kodywildfeuer/workroom/index.html');
await p.waitForFunction(() => document.querySelectorAll('.lane').length === 4);
await p.waitForTimeout(600);
const say=(k,v)=>console.log('  '+String(k).padEnd(30)+v);

const before = await p.evaluate(() => ({
  n: frames.length,
  queue: [...(board.order.next||[]), ...(board.order.now||[])].map(id => ({id, title: board.cards[id].title, lane: board.cards[id].lane})),
}));
say('frames before', before.n);
say('queue head', JSON.stringify(before.queue[0]));

await p.click('#dryrun');
// wait for the FIRST card.edited of the run (step 2 landed), then interrupt
await p.waitForFunction((n) => frames.slice(n).some(f => f.payload.event === 'card.edited'), before.n, {timeout: 15000});
const atInterrupt = await p.evaluate(() => frames.length);
await p.click('#play');            // sets viewAt = 0 → every later append refused
say('frames at interrupt', atInterrupt);
say('viewAt after play', await p.evaluate(() => viewAt));

// let the run finish
await p.waitForFunction(() => runSession === null, null, {timeout: 40000});
await p.waitForTimeout(300);

const out = await p.evaluate(async () => {
  const items = [];
  for (const a of outbox) {
    let text = null;
    try { text = await (await fetch(a.url)).text(); } catch(e) { text = 'ERR ' + e.message; }
    items.push({ name: a.name, sha: a.sha, text });
  }
  return {
    items,
    status: document.getElementById('status') ? document.getElementById('status').textContent : null,
    framesAfter: frames.length,
    lanesNow: (board.order.now||[]).map(i => board.cards[i].title),
    lanesDone: (board.order.done||[]).map(i => board.cards[i].title),
    chainMovesToDone: frames.filter(f => f.payload.event==='card.moved' && f.payload.lane==='done').map(f=>f.payload.titleAt),
  };
});
say('files ejected', out.items.length);
for (const it of out.items) {
  if (it.name.endsWith('.md')) {
    const laneLine = (it.text.match(/^lane .*$/m)||[''])[0];
    const steps = it.text.split('\n').filter(l => /^- \w/.test(l));
    console.log('  --- ' + it.name);
    console.log('      ' + JSON.stringify(laneLine));
    steps.forEach(s => console.log('      step: ' + s.trim()));
  } else {
    const r = JSON.parse(it.text);
    console.log('  --- ' + it.name);
    console.log('      verified=' + r.verified + '  artifacts=' + JSON.stringify(r.artifacts.map(a=>({t:a.title,f:a.file,frames:a.frames.length}))));
  }
}
say('board now lane', JSON.stringify(out.lanesNow));
say('board done lane', JSON.stringify(out.lanesDone));
say('chain moves→done', JSON.stringify(out.chainMovesToDone));
say('status bar', (out.status||'').replace(/\s+/g,' ').trim());
await b.close();

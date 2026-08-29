import { chromium } from 'playwright';
const b = await chromium.launch();
const p = await (await b.newContext({ viewport:{width:1440,height:900} })).newPage();
p.on('pageerror', e => console.log('  [page error] ' + e.message));
p.on('dialog', d => { console.log('  [dialog] ' + d.type() + ': ' + d.message().slice(0,40).replace(/\n/g,' ')); d.accept(); });
await p.goto('file:///Users/kodywildfeuer/workroom/index.html');
await p.waitForFunction(() => document.querySelectorAll('.lane').length === 4);
await p.waitForTimeout(1500);
const say=(k,v)=>console.log('  '+k.padEnd(40)+v);
const snap = () => p.evaluate(() => ({
  mem: frames.length,
  disk: (JSON.parse(localStorage.getItem('workroom.frames')||'null')||[]).length,
  diskRaw: localStorage.getItem('workroom.frames') === null ? 'ABSENT' : 'present',
  stream: JSON.parse(localStorage.getItem('workroom.stream')||'null'),
  memStream: streamId,
  viewAt,
  playing: !!playing,
  cards: document.querySelectorAll('.card').length,
  status: (document.getElementById('status').textContent||'').replace(/\s+/g,' ').trim(),
  past: document.body.classList.contains('past'),
}));

say('boot snapshot', JSON.stringify(await snap()));

// ── CASE A: rewound via the ledger, then Reset ──────────────────────────────
const entries = await p.locator('#ledger .fr, #ledger li, #ledger .entry').count().catch(()=>0);
say('ledger entry selector count', String(entries));
// rewind with the scrub (same code path as a ledger click -> seekTo)
await p.locator('#scrub').fill('2'); await p.dispatchEvent('#scrub','input');
await p.waitForTimeout(300);
say('after rewind', JSON.stringify(await snap()));

await p.click('#reset');
await p.waitForTimeout(1200);
const after = await snap();
say('after Reset while rewound', JSON.stringify(after));

// what does the visible board show, and does a card button work?
const rowBtns = await p.locator('.card .row button').count();
say('visible cards / row buttons', after.cards + ' / ' + rowBtns);
if (rowBtns) {
  await p.locator('.card .row button').first().click().catch(e=>console.log('  click err '+e.message));
  await p.waitForTimeout(400);
  say('after clicking a card button', JSON.stringify(await snap()));
}
say('genesis on disk?', JSON.stringify(await p.evaluate(() => {
  const f = JSON.parse(localStorage.getItem('workroom.frames')||'null');
  return { present: f !== null, first: f && f[0] && f[0].payload && f[0].payload.event };
})));

// now try a real edit (return-to-now first? no — user just adds a card)
say('--- pressing Return to now then adding a card ---','');
const hasNow = await p.locator('#now').isVisible().catch(()=>false);
say('Return to now button visible', String(hasNow));
if (hasNow) { await p.click('#now'); await p.waitForTimeout(300); }
await p.evaluate(() => addCard('now','after reset'));
await p.waitForTimeout(600);
say('after adding a card', JSON.stringify(await snap()));
say('first frame now', JSON.stringify(await p.evaluate(() => {
  const f = JSON.parse(localStorage.getItem('workroom.frames')||'null')||[];
  return f.map(x => x.seq + ':' + x.payload.event);
})));
await p.screenshot({ path:'/Users/kodywildfeuer/workroom/shot-reset.png' });
await b.close();

/* forkcheck.mjs — a new dimension from any frame.
 *
 * Forking mints a NEW stream and re-derives the world at the chosen frame as fresh
 * frames. The things worth proving: the new stream is not the old one, its genesis
 * records exactly where it came from, the board matches the world AT that frame (not
 * the head), the chain verifies, and the dimension you left is still reachable.
 *
 *   node forkcheck.mjs
 */
import { chromium } from 'playwright';
const b = await chromium.launch();
const ctx = await b.newContext({ viewport: { width: 1440, height: 900 } });
const p = await ctx.newPage();
let bad = 0;
p.on('pageerror', e => { console.log('  [page error] ' + e.message); bad++; });
p.on('dialog', d => d.accept());
const say = (k, v, ok) => { console.log('  ' + k.padEnd(36) + v); if (ok === false) bad++; };

await p.goto('file:///Users/kodywildfeuer/workroom/index.html');
await p.waitForFunction(() => document.querySelectorAll('.lane').length === 4);
await p.waitForTimeout(600);

const parent = await p.evaluate(() => ({ stream: streamId, n: frames.length }));
say('parent chain', parent.n + ' frames');

// rewind to the middle, then fork from what is on screen
const at = Math.floor(parent.n / 2);
await p.evaluate((i) => seekTo(i), at);
await p.waitForTimeout(300);
const seenThen = await p.evaluate(() => Object.keys(viewedBoard().cards).length);
say('cards visible at frame ' + at, String(seenThen));

await p.click('#fork');
await p.waitForTimeout(1200);

const child = await p.evaluate(() => ({
  stream: streamId, n: frames.length,
  genesis: frames[0].payload,
  cards: Object.keys(board.cards).length,
  viewing: viewAt,
}));
say('new stream, not the old one', child.stream !== parent.stream ? 'yes' : 'NO', child.stream !== parent.stream);
say('a rappid, not a name hash', /^rappid:@kody-w\/workroom:[0-9a-f]{64}:[0-9a-f]{16}$/.test(child.stream) ? 'yes' : 'NO ' + child.stream,
    /^rappid:@kody-w\/workroom:[0-9a-f]{64}:[0-9a-f]{16}$/.test(child.stream));
say('genesis records the parent', child.genesis.from && child.genesis.from.stream_id === parent.stream ? 'yes' : 'NO',
    !!(child.genesis.from && child.genesis.from.stream_id === parent.stream));
say('…and the exact frame', child.genesis.from && child.genesis.from.seq === at ? 'seq ' + at : 'NO',
    !!(child.genesis.from && child.genesis.from.seq === at));

// the wave it names must be the parent frame's real wave
const parentWave = await p.evaluate((i) => {
  const a = JSON.parse(localStorage.getItem('workroom.streams'));
  const ch = a[Object.keys(a).find(k => a[k].frames.length)] ;
  return ch.frames[i].frame_hash;
}, at);
say('the wave it names is that frame', child.genesis.from.frame_hash === parentWave ? 'yes' : 'NO',
    child.genesis.from.frame_hash === parentWave);

say('board is the world AT that frame', child.cards === seenThen ? 'yes, ' + child.cards : 'NO (' + child.cards + ' vs ' + seenThen + ')',
    child.cards === seenThen);
say('it goes live at now, not rewound', child.viewing === null ? 'yes' : 'NO', child.viewing === null);
say('one frame per card, plus genesis', child.n === seenThen + 1 ? 'yes, ' + child.n : 'NO ' + child.n, child.n === seenThen + 1);

await p.click('#verify'); await p.waitForTimeout(600);
const st = (await p.textContent('#status')).replace(/\s+/g, ' ').trim();
say('the new dimension verifies', /all \d+ frames verified/i.test(st) ? 'yes' : 'NO — ' + st, /all \d+ frames verified/i.test(st));

// work in the new dimension, then go back to the one we left
await p.evaluate(() => addCard('now', 'only in this dimension'));
await p.waitForTimeout(400);
const opts = await p.locator('#scenario option').allTextContents();
say('the picker offers the parent back', opts.some(o => /frames$/.test(o)) ? 'yes' : 'NO', opts.some(o => /frames$/.test(o)));

const val = await p.evaluate((s) => {
  const o = [...document.querySelectorAll('#scenario option')].find(x => x.value === 'arch:' + s);
  return o ? o.value : null;
}, parent.stream);
say('the parent is addressable', val ? 'yes' : 'NO', !!val);
if (val) {
  await p.selectOption('#scenario', val);
  await p.waitForTimeout(900);
  const back = await p.evaluate(() => ({ stream: streamId, n: frames.length }));
  say('back in the parent, intact', back.stream === parent.stream && back.n === parent.n ? 'yes, ' + back.n + ' frames' : 'NO',
      back.stream === parent.stream && back.n === parent.n);
  const hasChildCard = await p.evaluate(() => Object.values(board.cards).some(c => c.title === 'only in this dimension'));
  say('the dimensions did not bleed', hasChildCard ? 'NO' : 'yes', !hasChildCard);
}

// and the reverse hop: the child is now the one we left
const backToChild = await p.evaluate((s) => {
  const o = [...document.querySelectorAll('#scenario option')].find(x => x.value === 'arch:' + s);
  return o ? o.value : null;
}, child.stream);
if (backToChild) {
  await p.selectOption('#scenario', backToChild);
  await p.waitForTimeout(900);
  const c2 = await p.evaluate(() => ({ stream: streamId, n: frames.length,
    has: Object.values(board.cards).some(x => x.title === 'only in this dimension') }));
  say('and back into the fork', c2.stream === child.stream && c2.has ? 'yes, ' + c2.n + ' frames' : 'NO',
      c2.stream === child.stream && c2.has);
} else say('and back into the fork', 'NO — not offered', false);

await p.screenshot({ path: '/Users/kodywildfeuer/workroom/shot-fork.png' });
await b.close();
console.log(bad ? '\n' + bad + ' problem(s)' : '\na fork is a real new stream that knows where it came from, and the one you left is still there');
process.exit(bad ? 1 : 0);

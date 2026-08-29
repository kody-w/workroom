/* arenacheck.mjs — is the match really in the chain?
 * A shooter can look right and keep no record at all. What matters here: every shot,
 * hit and death is a frame; the chain verifies; a replay of it reaches the same
 * scoreboard; and the write door refuses the things the verifier would refuse —
 * shooting while dead, teleporting, damage out of a body that is not there.
 */
import { chromium } from 'playwright';
const b = await chromium.launch();
const ctx = await b.newContext({ viewport: { width: 1440, height: 900 } });
const p = await ctx.newPage();
let bad = 0;
p.on('pageerror', e => { console.log('  [page error] ' + e.message); bad++; });
p.on('dialog', d => d.accept());
const say = (k, v, ok) => { console.log('  ' + k.padEnd(42) + v); if (ok === false) bad++; };

await p.goto('file:///Users/kodywildfeuer/workroom/arena.html');
await p.waitForFunction(() => typeof frames !== 'undefined' && frames.length >= 6, null, { timeout: 20000 });
await p.waitForTimeout(400);

const boot = await p.evaluate(() => ({ n: frames.length, stream: streamId, players: W.order.length }));
say('the match opened on a real chain', boot.n + ' frames, ' + boot.players + ' players', boot.n >= 6);
say('a rappid minted from randomness',
    /^rappid:@kody-w\/arena:[0-9a-f]{64}:[0-9a-f]{16}$/.test(boot.stream) ? 'yes' : 'NO', 
    /^rappid:@kody-w\/arena:[0-9a-f]{64}:[0-9a-f]{16}$/.test(boot.stream));
say('and it verifies', (await p.evaluate(async () => (await verifyChain(frames, streamId)).length)) === 0 ? 'yes' : 'NO',
    (await p.evaluate(async () => (await verifyChain(frames, streamId)).length)) === 0);

// play it out
await p.click('#bots');
await p.waitForFunction(() => W.feed.length >= 2, null, { timeout: 90000 });
await p.click('#bots');
await p.waitForTimeout(600);

const played = await p.evaluate(async () => ({
  n: frames.length,
  problems: (await verifyChain(frames, streamId)).length,
  kinds: [...new Set(frames.map(f => f.payload.event))].sort(),
  kills: Object.fromEntries(Object.entries(W.p).map(([k, v]) => [k, v.kills + '/' + v.deaths])),
  deaths: frames.filter(f => f.payload.event === 'player.died').length,
  hits: frames.filter(f => f.payload.event === 'player.hit').length,
  shots: frames.filter(f => f.payload.event === 'player.fired' && !f.payload.reload).length,
}));
say('the match played out', played.n + ' frames', played.n > boot.n + 20);
say('and every frame still verifies', played.problems === 0 ? 'yes' : played.problems + ' problem(s)', played.problems === 0);
say('shots, hits and deaths are all frames',
    played.shots + ' fired, ' + played.hits + ' hit, ' + played.deaths + ' down',
    played.shots > 0 && played.hits > 0 && played.deaths > 0);
say('every event kind is a registered one',
    played.kinds.every(k => ['match.opened','player.spawned','player.moved','player.fired','player.hit','player.died'].includes(k)) ? 'yes' : 'NO',
    played.kinds.every(k => ['match.opened','player.spawned','player.moved','player.fired','player.hit','player.died'].includes(k)));

// a hit must be traceable to a shot that names it
const traceable = await p.evaluate(() => {
  let ok = 0, total = 0;
  for (let i = 0; i < frames.length; i++) {
    const q = frames[i].payload;
    if (q.event !== 'player.hit') continue;
    total++;
    for (let j = i - 1; j >= Math.max(0, i - 3); j--) {
      const s = frames[j].payload;
      if (s.event === 'player.fired' && s.who === q.by && s.hit === q.who) { ok++; break; }
    }
  }
  return { ok, total };
});
say('every hit follows the shot that named it', traceable.ok + ' of ' + traceable.total,
    traceable.total > 0 && traceable.ok === traceable.total);

// replaying the chain reaches the same scoreboard — nothing lives outside the record
const same = await p.evaluate(() => {
  const live = Object.fromEntries(Object.entries(W.p).map(([k, v]) => [k, v.kills + '/' + v.deaths + '/' + v.hp]));
  const re = project(frames);
  const rebuilt = Object.fromEntries(Object.entries(re.p).map(([k, v]) => [k, v.kills + '/' + v.deaths + '/' + v.hp]));
  return { same: JSON.stringify(live) === JSON.stringify(rebuilt), live, rebuilt };
});
say('replaying it reaches the same scoreboard', same.same ? JSON.stringify(same.live) : 'NO', same.same);

// the write door refuses what the verifier would refuse
const gate = await p.evaluate(async () => {
  const n = frames.length;
  const me = W.p['you'];
  const results = {
    stranger: !!(await append({ event: 'player.moved', who: 'nobody', x: 0, z: 0, ry: 0 })),
    teleport: !!(await append({ event: 'player.moved', who: 'you', x: me.x + 400, z: me.z, ry: 0 })),
    float:    !!(await append({ event: 'player.moved', who: 'you', x: me.x + 1.5, z: me.z, ry: 0 })),
    ghostHit: !!(await append({ event: 'player.hit', who: 'you', by: 'nobody', damage: 34 })),
    freeKill: !!(await append({ event: 'player.died', who: 'you', by: 'atlas' })),
  };
  results.wrote = frames.length - n;
  return results;
});
say('a stranger cannot move', gate.stranger ? 'WROTE ONE' : 'refused', !gate.stranger);
say('nobody teleports', gate.teleport ? 'WROTE ONE' : 'refused', !gate.teleport);
say('a float position is refused', gate.float ? 'WROTE ONE' : 'refused', !gate.float);
say('damage from nobody is refused', gate.ghostHit ? 'WROTE ONE' : 'refused', !gate.ghostHit);
say('a kill without the damage is refused', gate.freeKill ? 'WROTE ONE' : 'refused', !gate.freeKill);
say('and none of it reached the chain', gate.wrote === 0 ? 'yes' : 'IT WROTE ' + gate.wrote, gate.wrote === 0);

// stand in the past, then come back
const past = await p.evaluate(() => {
  const now = Object.values(W.p).reduce((a, c) => a + c.kills, 0);
  seekTo(4);
  const then = Object.values(viewed().p).reduce((a, c) => a + c.kills, 0);
  seekTo(frames.length - 1);
  return { now, then, back: Object.values(viewed().p).reduce((a, c) => a + c.kills, 0) };
});
say('the earlier match is still in there', past.then + ' kills at frame 4 vs ' + past.now + ' now', past.then < past.now);
say('and returning gives it back', past.back === past.now ? 'yes' : 'NO', past.back === past.now);

// fork
const parent = await p.evaluate(() => streamId);
const at = await p.evaluate(() => { const i = Math.floor(frames.length / 2); seekTo(i); return i; });
await p.click('#fork');
await p.waitForTimeout(1200);
const fork = await p.evaluate(async () => ({ stream: streamId, n: frames.length, from: frames[0].payload.from,
  problems: (await verifyChain(frames, streamId)).length, allUp: Object.values(W.p).every(c => c.alive && c.hp === 100) }));
say('the fork is a different match', fork.stream !== parent ? 'yes' : 'NO', fork.stream !== parent);
say('its genesis names the parent frame',
    fork.from && fork.from.stream_id === parent && fork.from.seq === at ? 'seq ' + at : 'NO',
    !!(fork.from && fork.from.stream_id === parent && fork.from.seq === at));
say('and it verifies, everyone up', fork.problems === 0 && fork.allUp ? 'yes, ' + fork.n + ' frames' : 'NO',
    fork.problems === 0 && fork.allUp);

await p.screenshot({ path: '/Users/kodywildfeuer/workroom/shot-arena.png' });
await b.close();
console.log(bad ? '\n' + bad + ' problem(s)' : '\nthe match is the chain: every shot is in it, replaying it gives the same scoreboard, and the door refuses what the verifier would');
process.exit(bad ? 1 : 0);

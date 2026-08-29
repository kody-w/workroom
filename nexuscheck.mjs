/* nexuscheck.mjs — is the room really a projection of its chain?
 * The claim is: everything you see came from a verified frame, the past is still in
 * there, and a fork from any frame is a real new stream. Each of those is checkable.
 */
import { chromium } from 'playwright';
const b = await chromium.launch();
const ctx = await b.newContext({ viewport: { width: 1440, height: 900 } });
const p = await ctx.newPage();
let bad = 0;
p.on('pageerror', e => { console.log('  [page error] ' + e.message); bad++; });
p.on('dialog', d => d.accept());
const say = (k, v, ok) => { console.log('  ' + k.padEnd(40) + v); if (ok === false) bad++; };

await p.goto('file:///Users/kodywildfeuer/workroom/nexus3d.html');
await p.waitForFunction(() => typeof frames !== 'undefined' && frames.length > 4, null, { timeout: 20000 });
await p.waitForTimeout(500);

const boot = await p.evaluate(() => ({ n: frames.length, stream: streamId,
  people: world.order.length, bodies: bodies.children.length }));
say('the room opened on a real chain', boot.n + ' frames', boot.n >= 6);
say('a rappid minted from randomness',
    /^rappid:@kody-w\/nexus3d:[0-9a-f]{64}:[0-9a-f]{16}$/.test(boot.stream) ? 'yes' : 'NO ' + boot.stream,
    /^rappid:@kody-w\/nexus3d:[0-9a-f]{64}:[0-9a-f]{16}$/.test(boot.stream));
say('bodies drawn for everybody in it', boot.people + ' peers → ' + boot.bodies + ' objects', boot.bodies >= boot.people * 4);

const v = await p.evaluate(async () => (await verifyChain(frames, streamId)).length);
say('every frame verifies', v === 0 ? 'yes' : v + ' problem(s)', v === 0);

// walking is appending
const walked = await p.evaluate(async () => {
  const n = frames.length, before = JSON.stringify(world.peers['you']);
  meAt.x += 30; await append({ event: 'peer.moved', who: 'you', x: meAt.x, z: meAt.z, ry: 0 });
  return { grew: frames.length - n, moved: JSON.stringify(world.peers['you']) !== before,
           last: frames[frames.length - 1].payload.event };
});
say('a step is one appended frame', walked.grew === 1 ? 'yes, ' + walked.last : 'NO (' + walked.grew + ')', walked.grew === 1);
say('and the room moved with it', walked.moved ? 'yes' : 'NO', walked.moved);

// the residents write through the same door
const before = await p.evaluate(() => frames.length);
await p.click('#live');
await p.waitForFunction((n) => frames.length > n + 3, before, { timeout: 30000 });
await p.click('#live');
const ran = await p.evaluate(async () => ({ n: frames.length,
  problems: (await verifyChain(frames, streamId)).length,
  authors: [...new Set(frames.map(f => f.payload.who).filter(Boolean))].sort() }));
say('the residents appended too', before + ' → ' + ran.n, ran.n > before + 3);
say('and the chain still verifies', ran.problems === 0 ? 'yes' : ran.problems + ' problem(s)', ran.problems === 0);
say('people and agents in one record', ran.authors.join(' '), ran.authors.includes('you') && ran.authors.length > 2);

// a frame the verifier would refuse must not be writable
const gate = await p.evaluate(async () => {
  const n = frames.length;
  const a = await append({ event: 'peer.moved', who: 'nobody-here', x: 0, z: 0, ry: 0 });
  const bfloat = await append({ event: 'peer.moved', who: 'you', x: 1.5, z: 0, ry: 0 });
  const far = await append({ event: 'peer.moved', who: 'you', x: 99999, z: 0, ry: 0 });
  return { wrote: frames.length - n, a: !!a, bfloat: !!bfloat, far: !!far };
});
say('a stranger cannot move', gate.a ? 'WROTE ONE' : 'refused', !gate.a);
say('a float position is refused', gate.bfloat ? 'WROTE ONE' : 'refused', !gate.bfloat);
say('outside the room is refused', gate.far ? 'WROTE ONE' : 'refused', !gate.far);
say('nothing bad reached the chain', gate.wrote === 0 ? 'yes' : 'IT WROTE ' + gate.wrote, gate.wrote === 0);

// the past really is still in there
const past = await p.evaluate(() => {
  const now = world.order.length;
  seekTo(1);
  const then = viewed().order.length;
  const drawnPast = (seekTo(1), viewed().order.length);
  seekTo(frames.length - 1);
  return { now, then, back: viewed().order.length, drawnPast };
});
say('rewinding gives an earlier room', past.now + ' now vs ' + past.then + ' at frame 1', past.then < past.now);
say('and returning gives it back', past.back === past.now ? 'yes' : 'NO', past.back === past.now);

// a fork is a real new stream that knows its parent
const parentStream = await p.evaluate(() => streamId);
const at = await p.evaluate(() => { const i = Math.floor(frames.length / 2); seekTo(i); return i; });
await p.click('#fork');
await p.waitForTimeout(1200);
const fork = await p.evaluate(async () => ({ stream: streamId, n: frames.length,
  from: frames[0].payload.from, problems: (await verifyChain(frames, streamId)).length }));
say('the fork is a different stream', fork.stream !== parentStream ? 'yes' : 'NO', fork.stream !== parentStream);
say('its genesis names the parent frame',
    fork.from && fork.from.stream_id === parentStream && fork.from.seq === at ? 'seq ' + at : 'NO',
    !!(fork.from && fork.from.stream_id === parentStream && fork.from.seq === at));
say('and the new room verifies', fork.problems === 0 ? 'yes, ' + fork.n + ' frames' : fork.problems + ' problem(s)', fork.problems === 0);

await p.screenshot({ path: '/Users/kodywildfeuer/workroom/shot-nexus3d.png' });
await b.close();
console.log(bad ? '\n' + bad + ' problem(s)' : '\nthe room is a projection of a chain that verifies, and any frame in it can start a new one');
process.exit(bad ? 1 : 0);

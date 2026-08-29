/* studiocheck.mjs — exercise the studio's real frame, PeerJS, failure, and UI paths. */
import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { readFileSync, statSync } from 'node:fs';
import { dirname, extname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(fileURLToPath(import.meta.url));
const studioSource = readFileSync(resolve(root, 'broadcast.html'), 'utf8');
const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8', '.json': 'application/json; charset=utf-8' };
const server = createServer((req, res) => {
  try {
    const pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
    const file = resolve(root, pathname === '/' ? 'index.html' : pathname.slice(1));
    if (file !== root && !file.startsWith(root + sep)) throw new Error('outside root');
    if (!statSync(file).isFile()) throw new Error('not a file');
    res.writeHead(200, { 'content-type': types[extname(file)] || 'application/octet-stream' });
    res.end(readFileSync(file));
  } catch (e) {
    res.writeHead(404, { 'content-type': 'text/plain' }); res.end('not found');
  }
});
await new Promise((resolveListen) => server.listen(0, '127.0.0.1', resolveListen));
const origin = `http://127.0.0.1:${server.address().port}`;

let bad = 0;
const say = (name, value, ok) => {
  console.log('  ' + name.padEnd(43) + value);
  if (!ok) bad++;
};
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const wait = (page, fn, arg, timeout = 12000) => page.waitForFunction(fn, arg, { timeout });

function oracle(frames) {
  const cards = new Map();
  const lanes = { now: [], next: [], blocked: [], done: [] };
  for (const frame of frames) {
    const p = frame.payload;
    if (p.event === 'card.added') {
      cards.set(p.card, { id: p.card, title: p.title, note: p.note || '', who: p.who || '' });
      lanes[p.lane].push(p.card);
    } else if (p.event === 'card.moved') {
      const card = cards.get(p.card);
      for (const ids of Object.values(lanes)) {
        const at = ids.indexOf(p.card); if (at >= 0) ids.splice(at, 1);
      }
      const to = lanes[p.lane];
      to.splice(Math.min(Number.isSafeInteger(p.at) ? p.at : to.length, to.length), 0, p.card);
      if (card) card.lane = p.lane;
    } else if (p.event === 'card.edited') {
      const card = cards.get(p.card);
      if (!card) continue;
      for (const key of ['title', 'note', 'who']) if (key in p) card[key] = p[key];
    } else if (p.event === 'card.removed') {
      cards.delete(p.card);
      for (const ids of Object.values(lanes)) {
        const at = ids.indexOf(p.card); if (at >= 0) ids.splice(at, 1);
      }
    }
  }
  return Object.fromEntries(Object.entries(lanes).map(([lane, ids]) => [lane,
    ids.map(id => ({ ...cards.get(id), lane }))]));
}

const domBoard = page => page.evaluate(() => Object.fromEntries(
  [...document.querySelectorAll('#lanes .ln')].map(lane => [lane.dataset.lane,
    [...lane.querySelectorAll('.cd')].map(card => ({
      id: card.dataset.id,
      title: card.querySelector('.t')?.textContent || '',
      note: card.querySelector('.n')?.textContent || '',
      who: card.querySelector('.w')?.textContent || '',
      lane: lane.dataset.lane,
    }))])
));

function trackErrors(page, label) {
  page.on('pageerror', e => { console.log(`  [${label} page error] ${e.message}`); bad++; });
}

async function requestLive(page) {
  for (let attempt = 0; attempt < 3; attempt++) {
    if (await page.$eval('#link', e => e.value)) return;
    await page.evaluate(() => { if (peer) stopLive(''); });
    await page.click('#golive');
    try { await wait(page, () => !!document.getElementById('link').value, null, 15000); return; }
    catch (e) {}
  }
  throw new Error('PeerJS signaling did not become available after three attempts');
}

async function mutationPage(browser, name, html, hash = '') {
  const context = await browser.newContext({ viewport: { width: 1200, height: 800 } });
  await context.route(`**/broadcast.html?mutation=${name}`, route =>
    route.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: html }));
  const page = await context.newPage();
  trackErrors(page, name + ' mutation');
  await page.goto(`${origin}/broadcast.html?mutation=${name}${hash}`);
  await wait(page, () => wireFrames.length > 0, null, 10000);
  return { context, page };
}

const browser = await chromium.launch();
try {
  const context = await browser.newContext({ viewport: { width: 1500, height: 900 } });
  await context.addInitScript(() => {
    globalThis.__downloadRequests = [];
    HTMLAnchorElement.prototype.click = function () {
      __downloadRequests.push({ name: this.download, href: this.href });
    };
  });
  const host = await context.newPage();
  trackErrors(host, 'studio');
  host.on('dialog', d => d.accept());
  await host.goto(`${origin}/broadcast.html`);
  await wait(host, () => wireFrames.length > 10, null, 10000);

  const seeded = await host.evaluate(() => ({
    frames: structuredClone(wireFrames), stream: wireStream,
    stat: document.getElementById('stat').textContent,
  }));
  say('iframe handed over a nonempty chain', seeded.frames.length + ' frames', seeded.frames.length > 10);
  say('studio reports verified genesis', seeded.stat, /verified here/.test(seeded.stat));
  const lifecycleMatrix = await host.evaluate(async () => {
    const firstCard = await buildFrame(wireStream, 0,
      { event: 'card.added', card: 'first', lane: 'now', title: 'not genesis' }, null, null);
    const duplicateId = Object.keys(project(wireFrames).cards)[0];
    const duplicate = await buildFrame(wireStream, wireFrames.length,
      { event: 'card.added', card: duplicateId, lane: 'now', title: 'duplicate' },
      lastGood.payload_hash, lastGood.utc);
    const badTitle = await buildFrame(wireStream, wireFrames.length,
      { event: 'card.added', card: 'bad-title', lane: 'now', title: 7 },
      lastGood.payload_hash, lastGood.utc);
    return {
      genesis: (await validateChain([firstCard], wireStream)).reason,
      duplicate: (await validateChain(wireFrames.concat([duplicate]), wireStream)).reason,
      type: (await validateChain(wireFrames.concat([badTitle]), wireStream)).reason,
    };
  });
  say('genesis, duplicate, and type rules hold', JSON.stringify(lifecycleMatrix),
    /first frame is not a genesis/.test(lifecycleMatrix.genesis)
      && /already added/.test(lifecycleMatrix.duplicate)
      && /title is not a string/.test(lifecycleMatrix.type));

  await requestLive(host);
  const liveLink = await host.$eval('#link', e => e.value);
  let watcher = await context.newPage();
  trackErrors(watcher, 'watcher');
  await watcher.goto(liveLink);
  await wait(watcher, n => wireFrames.length === n, seeded.frames.length, 15000);
  await wait(host, () => watchers.size === 1, null, 10000);

  const rebuilt = await domBoard(watcher);
  const expected = oracle(seeded.frames);
  say('real PeerJS delivered the whole chain', String(seeded.frames.length),
    (await watcher.evaluate(() => wireFrames.length)) === seeded.frames.length);
  say('independent oracle matches watcher DOM', JSON.stringify(Object.fromEntries(
    Object.entries(rebuilt).map(([k, v]) => [k, v.length]))), same(rebuilt, expected));

  const highWaterFixtures = await host.evaluate(async () => {
    const original = structuredClone(wireFrames);
    const prefix = original.slice(0, -1);
    const prefixCards = Object.keys(project(prefix).cards);
    const currentCards = Object.keys(project(original).cards);
    const fork = await buildFrame(wireStream, prefix.length,
      { event: 'card.edited', card: prefixCards[0], note: 'same-seq divergent fork' },
      prefix.at(-1).payload_hash, prefix.at(-1).utc);
    const extension = await buildFrame(wireStream, original.length,
      { event: 'card.edited', card: currentCards[0], note: 'valid extension' },
      original.at(-1).payload_hash, original.at(-1).utc);
    const oldExtended = original.concat([extension]);
    const newStream = 'rappid:@studio/high-water:' + 'c'.repeat(64) + ':' + 'd'.repeat(16);
    const genesis = await buildFrame(newStream, 0,
      { event: 'room.opened', title: 'A genuinely new stream' }, null, null);
    return {
      stream: wireStream, original, shorter: prefix,
      forked: prefix.concat([fork]), extended: oldExtended,
      newStream, newChain: [genesis],
    };
  });
  const highWaterBaseline = await watcher.evaluate(() => ({
    frames: wireFrames.length, stream: wireStream,
    board: [...document.querySelectorAll('#lanes .cd')].map(e => e.dataset.id),
  }));
  const sendChain = value => host.evaluate(valueToSend => {
    [...watchers.values()][0].send({
      rapp: 'chain', stream_id: valueToSend.stream, frames: valueToSend.frames,
    });
  }, value);

  await sendChain({ stream: highWaterFixtures.stream, frames: highWaterFixtures.shorter });
  await wait(watcher, () => /roll the stream back below accepted seq/.test(document.getElementById('stat').textContent));
  const afterRollback = await watcher.evaluate(() => ({
    frames: wireFrames.length, stream: wireStream,
    board: [...document.querySelectorAll('#lanes .cd')].map(e => e.dataset.id),
    stat: document.getElementById('stat').textContent,
  }));
  say('shorter same-stream rollback is refused', afterRollback.stat, same(
    { frames: afterRollback.frames, stream: afterRollback.stream, board: afterRollback.board }, highWaterBaseline));

  await sendChain({ stream: highWaterFixtures.stream, frames: highWaterFixtures.forked });
  await wait(watcher, () => /diverges from the accepted high-water/.test(document.getElementById('stat').textContent));
  const afterFork = await watcher.evaluate(() => ({
    frames: wireFrames.length, stream: wireStream,
    board: [...document.querySelectorAll('#lanes .cd')].map(e => e.dataset.id),
    stat: document.getElementById('stat').textContent,
  }));
  say('same-seq divergent fork is refused', afterFork.stat, same(
    { frames: afterFork.frames, stream: afterFork.stream, board: afterFork.board }, highWaterBaseline));

  await sendChain({ stream: highWaterFixtures.stream, frames: highWaterFixtures.extended });
  await wait(watcher, n => wireFrames.length === n, highWaterFixtures.extended.length);
  say('valid same-stream extension is accepted', String(highWaterFixtures.extended.length),
    same(await domBoard(watcher), oracle(highWaterFixtures.extended)));

  await sendChain({ stream: highWaterFixtures.newStream, frames: highWaterFixtures.newChain });
  await wait(watcher, stream => wireStream === stream, highWaterFixtures.newStream);
  const onNewStream = await watcher.evaluate(() => ({
    frames: wireFrames.length, stream: wireStream, cards: document.querySelectorAll('#lanes .cd').length,
  }));
  say('genuinely new stream is accepted', highWaterFixtures.newStream,
    onNewStream.frames === 1 && onNewStream.stream === highWaterFixtures.newStream && onNewStream.cards === 0);

  await sendChain({ stream: highWaterFixtures.stream, frames: highWaterFixtures.original });
  await wait(watcher, () => /roll the stream back below accepted seq/.test(document.getElementById('stat').textContent));
  const oldRollback = await watcher.evaluate(() => ({
    frames: wireFrames.length, stream: wireStream, cards: document.querySelectorAll('#lanes .cd').length,
  }));
  say('return below old high-water is refused', oldRollback.stream,
    oldRollback.stream === highWaterFixtures.newStream && oldRollback.frames === 1 && oldRollback.cards === 0);

  await sendChain({ stream: highWaterFixtures.stream, frames: highWaterFixtures.extended });
  await wait(watcher, stream => wireStream === stream, highWaterFixtures.stream);
  say('return at old high-water is accepted', highWaterFixtures.stream,
    (await watcher.evaluate(() => wireFrames.length)) === highWaterFixtures.extended.length
      && same(await domBoard(watcher), oracle(highWaterFixtures.extended)));

  await watcher.close();
  await wait(host, () => watchers.size === 0, null, 8000);
  watcher = await context.newPage();
  trackErrors(watcher, 'post-high-water watcher');
  await watcher.goto(liveLink);
  await wait(watcher, n => wireFrames.length === n, seeded.frames.length, 15000);
  await wait(host, () => watchers.size === 1, null, 10000);

  const baseline = await watcher.evaluate(() => ({
    frames: wireFrames.length, stream: wireStream,
    board: [...document.querySelectorAll('#lanes .cd')].map(e => e.dataset.id),
  }));

  const hashReason = await host.evaluate(() => {
    const card = Object.keys(project(wireFrames).cards)[0];
    return buildFrame(wireStream, wireFrames.length,
      { event: 'card.edited', card, note: 'hashed before tampering' },
      lastGood.payload_hash, lastGood.utc).then(frame => {
        frame.payload.note = 'not what was hashed';
        [...watchers.values()][0].send({ rapp: 'frame', stream_id: wireStream, frame });
      });
  });
  void hashReason;
  await wait(watcher, () => /payload_hash does not match/.test(document.getElementById('stat').textContent));
  const afterHash = await watcher.evaluate(() => ({
    frames: wireFrames.length, stream: wireStream,
    board: [...document.querySelectorAll('#lanes .cd')].map(e => e.dataset.id),
    stat: document.getElementById('stat').textContent,
  }));
  say('payload tamper gets the exact reason', afterHash.stat, /payload_hash does not match/.test(afterHash.stat));
  say('payload rejection is atomic', afterHash.frames + ' frames', same(
    { frames: afterHash.frames, stream: afterHash.stream, board: afterHash.board }, baseline));

  await host.evaluate(() => {
    const foreign = 'rappid:@attacker/other:' + 'a'.repeat(64) + ':' + 'b'.repeat(16);
    [...watchers.values()][0].send({ rapp: 'frame', stream_id: foreign, frame: wireFrames.at(-1) });
  });
  await wait(watcher, () => /belongs to a different stream/.test(document.getElementById('stat').textContent));
  const afterForeign = await watcher.evaluate(() => ({
    frames: wireFrames.length, stream: wireStream,
    board: [...document.querySelectorAll('#lanes .cd')].map(e => e.dataset.id),
    stat: document.getElementById('stat').textContent,
  }));
  say('foreign stream gets the exact reason', afterForeign.stat, /belongs to a different stream/.test(afterForeign.stat));
  say('foreign rejection preserves chain and board', afterForeign.frames + ' frames', same(
    { frames: afterForeign.frames, stream: afterForeign.stream, board: afterForeign.board }, baseline));

  await host.evaluate(() => {
    const frames = structuredClone(wireFrames);
    frames.at(-1).payload.title = 'bent full chain';
    [...watchers.values()][0].send({ rapp: 'chain', stream_id: wireStream, frames });
  });
  await wait(watcher, () => /refused a chain: frame \d+: payload_hash does not match/.test(
    document.getElementById('stat').textContent));
  const afterChain = await watcher.evaluate(() => ({
    frames: wireFrames.length, stream: wireStream,
    board: [...document.querySelectorAll('#lanes .cd')].map(e => e.dataset.id),
    stat: document.getElementById('stat').textContent,
  }));
  say('invalid full chain is refused atomically', afterChain.stat, same(
    { frames: afterChain.frames, stream: afterChain.stream, board: afterChain.board }, baseline));

  await host.evaluate(() => {
    [...watchers.values()][0].send({ rapp: 'chain', stream_id: wireStream, frames: [] });
  });
  await wait(watcher, () => /there are no frames/.test(document.getElementById('stat').textContent));
  const afterEmpty = await watcher.evaluate(() => ({
    frames: wireFrames.length, stream: wireStream,
    board: [...document.querySelectorAll('#lanes .cd')].map(e => e.dataset.id),
    stat: document.getElementById('stat').textContent,
  }));
  say('empty chain is not verified or installed', afterEmpty.stat, same(
    { frames: afterEmpty.frames, stream: afterEmpty.stream, board: afterEmpty.board }, baseline));

  await host.evaluate(async () => {
    const frame = await buildFrame(wireStream, wireFrames.length,
      { event: 'card.added', card: 'forged', lane: 'does-not-exist', title: 'wrong lane' },
      lastGood.payload_hash, lastGood.utc);
    [...watchers.values()][0].send({ rapp: 'frame', stream_id: wireStream, frame });
  });
  await wait(watcher, () => /names a lane that does not exist/.test(document.getElementById('stat').textContent));
  const semantic = await watcher.evaluate(() => ({
    frames: wireFrames.length, cards: document.querySelectorAll('#lanes .cd').length,
    stat: document.getElementById('stat').textContent,
  }));
  say('semantic invalidity is enforced', semantic.stat,
    semantic.frames === baseline.frames && /names a lane/.test(semantic.stat));

  await host.evaluate(async () => {
    const frame = await buildFrame(wireStream, wireFrames.length,
      { event: 'card.moved', card: 'missing-card', lane: 'done' },
      lastGood.payload_hash, lastGood.utc);
    [...watchers.values()][0].send({ rapp: 'frame', stream_id: wireStream, frame });
  });
  await wait(watcher, () => /card\.moved on a card that is not there/.test(document.getElementById('stat').textContent));
  say('card lifecycle is enforced', await watcher.$eval('#stat', e => e.textContent),
    (await watcher.evaluate(() => wireFrames.length)) === baseline.frames);

  await host.evaluate(async () => {
    const card = Object.keys(project(wireFrames).cards)[0];
    const frame = await buildFrame(wireStream, wireFrames.length,
      { event: 'card.edited', card, note: 'extra frame key' },
      lastGood.payload_hash, lastGood.utc);
    frame.extra = true;
    [...watchers.values()][0].send({ rapp: 'frame', stream_id: wireStream, frame });
  });
  await wait(watcher, () => /key set is not the eleven/.test(document.getElementById('stat').textContent));
  say('exact frame schema is enforced', await watcher.$eval('#stat', e => e.textContent),
    (await watcher.evaluate(() => wireFrames.length)) === baseline.frames);

  await host.evaluate(async () => {
    const card = Object.keys(project(wireFrames).cards)[0];
    const frame = await buildFrame(wireStream, wireFrames.length,
      { event: 'card.edited', card, note: 'bad utc' }, lastGood.payload_hash, lastGood.utc);
    frame.utc = 7;
    const pre = { ...frame }; delete pre.frame_hash; delete pre.sig;
    frame.frame_hash = await H('rapp/1:wave', pre);
    [...watchers.values()][0].send({ rapp: 'frame', stream_id: wireStream, frame });
  });
  await wait(watcher, () => /utc is not a real time/.test(document.getElementById('stat').textContent));
  say('UTC schema is enforced', await watcher.$eval('#stat', e => e.textContent),
    (await watcher.evaluate(() => wireFrames.length)) === baseline.frames);

  await watcher.evaluate(() => watcherConn.close());
  await wait(watcher, () => /retrying/.test(document.getElementById('stat').textContent), null, 5000);
  await wait(watcher, () => !!watcherConn && watcherConn.open, null, 12000);
  await wait(host, () => watchers.size === 1, null, 12000);
  await host.evaluate(() => relay({ rapp: 'chain', stream_id: wireStream, frames: wireFrames }));
  await wait(watcher, () => /frames received and verified/.test(document.getElementById('stat').textContent), null, 5000);
  say('dropped watcher reconnects automatically', await watcher.$eval('#stat', e => e.textContent),
    (await host.evaluate(() => watchers.size)) === 1
      && (await watcher.evaluate(() => !!watcherConn && watcherConn.open)));

  const watcher2 = await context.newPage();
  trackErrors(watcher2, 'watcher 2');
  await watcher2.goto(liveLink);
  await wait(watcher2, () => wireFrames.length > 0, null, 15000);
  await wait(host, () => watchers.size === 2, null, 10000);
  say('two real watchers are tracked', '2', (await host.evaluate(() => watchers.size)) === 2);
  await watcher2.close();
  await wait(host, () => watchers.size === 1, null, 8000);
  say('closed watcher is removed promptly', '1', (await host.evaluate(() => watchers.size)) === 1);

  const reconnect = await context.newPage();
  trackErrors(reconnect, 'reconnected watcher');
  await reconnect.goto(liveLink);
  await wait(reconnect, () => wireFrames.length > 0, null, 15000);
  await wait(host, () => watchers.size === 2, null, 10000);
  await reconnect.close();
  await wait(host, () => watchers.size === 1, null, 8000);
  say('watcher can reconnect without a ghost', '1 remains', (await host.evaluate(() => watchers.size)) === 1);

  const sameId = await host.evaluate(() => {
    class Conn {
      constructor() { this.peer = 'same-id'; this.handlers = {}; this.sent = []; }
      on(name, fn) { (this.handlers[name] ||= []).push(fn); }
      emit(name, value) { for (const fn of this.handlers[name] || []) fn(value); }
      send(value) { this.sent.push(value); }
      close() { this.emit('close'); }
    }
    const old = new Conn(), fresh = new Conn();
    attachWatcherConnection(old); old.emit('open');
    attachWatcherConnection(fresh); fresh.emit('open');
    old.emit('close');
    const kept = watchers.get('same-id') === fresh;
    fresh.close();
    return kept;
  });
  say('old close cannot delete a reconnect', sameId ? 'fresh connection kept' : 'LOST', sameId);

  const relayBaseline = await host.evaluate(() => {
    const sent = [];
    const c = { send: value => sent.push(value) };
    watchers.set('mutation-probe', c);
    relay({ rapp: 'probe' });
    watchers.delete('mutation-probe');
    return sent.length;
  });
  say('transport assertion observes delivery', String(relayBaseline), relayBaseline === 1);

  const beforeRun = await watcher.evaluate(() => wireFrames.length);
  await host.click('#run');
  await wait(watcher, n => wireFrames.length > n, beforeRun, 15000);
  say('valid traffic recovers after refusals', beforeRun + ' → ' + await watcher.evaluate(() => wireFrames.length),
    (await watcher.evaluate(() => wireFrames.length)) > beforeRun);
  await wait(host, () => /the run finished/.test(document.getElementById('stat').textContent), null, 120000);
  const finished = await host.evaluate(() => ({
    frames: wireFrames.length, stat: document.getElementById('stat').textContent,
    wireHashes: wireFrames.map(f => f.frame_hash),
  }));
  const iframeHashes = await host.evaluate(() => new Promise(resolveChain => {
    const timeout = setTimeout(() => resolveChain(null), 4000);
    const receive = e => {
      if (e.source !== document.getElementById('f').contentWindow || !e.data || e.data.rapp !== 'chain') return;
      clearTimeout(timeout); window.removeEventListener('message', receive);
      resolveChain(e.data.frames.map(f => f.frame_hash));
    };
    window.addEventListener('message', receive);
    document.getElementById('f').contentWindow.postMessage({ rapp: 'command', do: 'chain' }, '*');
  }));
  say('full run reports verified completion', finished.stat,
    finished.frames > beforeRun && /verified frames/.test(finished.stat));
  say('wire is the iframe committed chain', finished.frames + ' frames',
    Array.isArray(iframeHashes) && same(iframeHashes, finished.wireHashes));

  await watcher.close();
  await wait(host, () => watchers.size === 0, null, 8000);

  const deniedContext = await browser.newContext();
  await deniedContext.addInitScript(() => {
    const denied = () => { throw new DOMException('storage denied', 'SecurityError'); };
    for (const name of ['getItem', 'setItem', 'removeItem', 'clear']) {
      Object.defineProperty(Storage.prototype, name, { value: denied });
    }
    HTMLAnchorElement.prototype.click = function () {};
  });
  const denied = await deniedContext.newPage();
  trackErrors(denied, 'storage denied');
  await denied.goto(`${origin}/broadcast.html`);
  await denied.waitForTimeout(2000);
  const deniedBoot = await denied.evaluate(() => ({
    frames: wireFrames.length, stat: document.getElementById('stat').textContent,
    cls: document.getElementById('stat').className,
  }));
  say('storage failure is never called success', deniedBoot.stat,
    !/verified here/.test(deniedBoot.stat) && /storage|read-only|failure/i.test(deniedBoot.stat)
      && /bad/.test(deniedBoot.cls));
  await denied.click('#run');
  await denied.waitForTimeout(1000);
  const deniedRun = await denied.$eval('#stat', e => ({ text: e.textContent, cls: e.className }));
  say('storage/run failure remains explicit', deniedRun.text,
    /failed|without a verified genesis|refused|storage/i.test(deniedRun.text) && /bad/.test(deniedRun.cls));
  await deniedContext.close();

  const offlineContext = await browser.newContext();
  await offlineContext.route('**/vendor/peerjs-1.5.2.min.js', route => route.abort('internetdisconnected'));
  const offline = await offlineContext.newPage();
  trackErrors(offline, 'offline studio');
  await offline.goto(`${origin}/broadcast.html`);
  await offline.waitForTimeout(1800);
  await offline.click('#golive');
  await wait(offline, () => /PeerJS did not load/.test(document.getElementById('stat').textContent), null, 10000);
  const offlineState = await offline.evaluate(() => ({
    stat: document.getElementById('stat').textContent,
    label: document.getElementById('livelabel').textContent,
    disabled: document.getElementById('golive').disabled,
  }));
  say('offline CDN exposes a usable retry', offlineState.stat,
    /Retry live/.test(offlineState.label) && !offlineState.disabled);
  const offlineWatcher = await offlineContext.newPage();
  trackErrors(offlineWatcher, 'offline watcher');
  await offlineWatcher.goto(`${origin}/broadcast.html#watch=missing`);
  await wait(offlineWatcher, () => /PeerJS did not load/.test(document.getElementById('stat').textContent), null, 10000);
  say('offline watcher exposes retry', await offlineWatcher.$eval('#stat', e => e.textContent),
    !(await offlineWatcher.$eval('#golive', e => e.disabled)));
  await offlineContext.close();

  const signalContext = await browser.newContext();
  const signal = await signalContext.newPage();
  trackErrors(signal, 'signaling failure');
  await signal.goto(`${origin}/broadcast.html`);
  await wait(signal, () => wireFrames.length > 0, null, 10000);
  await signal.evaluate(() => {
    window.Peer = class {
      constructor() { this.handlers = {}; queueMicrotask(() => this.emit('error', { type: 'server-error' })); }
      on(name, fn) { (this.handlers[name] ||= []).push(fn); }
      emit(name, value) { for (const fn of this.handlers[name] || []) fn(value); }
      destroy() { this.destroyed = true; this.emit('close'); }
    };
  });
  await signal.click('#golive');
  await wait(signal, () => /Retry live/.test(document.getElementById('livelabel').textContent), null, 5000);
  const signalState = await signal.evaluate(() => ({
    stat: document.getElementById('stat').textContent, peerCleared: peer === null,
    disabled: document.getElementById('golive').disabled,
  }));
  say('signaling failure leaves a clean retry', signalState.stat,
    signalState.peerCleared && !signalState.disabled && /server-error/.test(signalState.stat));
  await signalContext.close();

  const narrowContext = await browser.newContext({ viewport: { width: 512, height: 501 } });
  const narrow = await narrowContext.newPage();
  trackErrors(narrow, 'narrow studio');
  await narrow.goto(`${origin}/broadcast.html`);
  await wait(narrow, () => wireFrames.length > 0, null, 10000);
  const narrowState = await narrow.evaluate(() => {
    const main = document.querySelector('main').getBoundingClientRect();
    const side = document.querySelector('aside').getBoundingClientRect();
    const status = document.getElementById('stat').getBoundingClientRect();
    return {
      mainBottom: main.bottom, sideDisplay: getComputedStyle(document.querySelector('aside')).display,
      sideHeight: side.height, statusBottom: status.bottom, height: innerHeight,
    };
  });
  say('narrow diagnostics remain visible', JSON.stringify(narrowState),
    narrowState.sideDisplay === 'flex' && narrowState.sideHeight > 0
      && narrowState.mainBottom <= narrowState.height + 1 && narrowState.statusBottom <= narrowState.height + 1);
  await narrowContext.close();

  const recordContext = await browser.newContext();
  await recordContext.addInitScript(() => {
    globalThis.__downloadRequests = [];
    HTMLAnchorElement.prototype.click = function () {
      __downloadRequests.push({ name: this.download, href: this.href });
    };
  });
  const record = await recordContext.newPage();
  trackErrors(record, 'recording');
  await record.goto(`${origin}/broadcast.html`);
  await wait(record, () => wireFrames.length > 0, null, 10000);
  await record.evaluate(() => {
    Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: {
      getDisplayMedia: async () => { throw new DOMException('denied', 'NotAllowedError'); },
    } });
  });
  await record.click('#rec');
  say('capture denial is handled', await record.$eval('#stat', e => e.textContent),
    /permission was denied or the picker was cancelled/.test(await record.$eval('#stat', e => e.textContent)));
  const recording = await record.evaluate(async () => {
    let stops = 0;
    recStream = { getTracks: () => [{ stop: () => stops++ }] };
    recorder = { state: 'inactive', mimeType: 'video/webm' };
    stopRecording();
    recorder = { state: 'inactive', mimeType: 'video/webm' };
    chunks = [new Blob(['recorded bytes'], { type: 'video/webm' })];
    recStart = Date.now() - 1100;
    await saveRecording();
    const requested = __downloadRequests.map(x => x.name);
    const status = document.getElementById('stat').textContent;
    const row = document.querySelector('#files>div')?.textContent || '';
    const beforeRevoke = objectUrls.size;
    const revoked = [];
    const native = URL.revokeObjectURL.bind(URL);
    URL.revokeObjectURL = url => { revoked.push(url); native(url); };
    cleanupPageResources();
    return { stops, requested, status, row, beforeRevoke, afterRevoke: objectUrls.size, revoked: revoked.length };
  });
  say('capture tracks are stopped', String(recording.stops), recording.stops === 1);
  say('recording copy says requested, not saved', recording.status,
    recording.requested.length === 2 && /requested/.test(recording.status) && !/\bsaved\b/i.test(recording.status));
  say('recording hash is still reported', recording.row.slice(0, 80),
    /sha256 [0-9a-f]{64}/.test(recording.row));
  say('recording object URLs are revoked', recording.beforeRevoke + ' → ' + recording.afterRevoke,
    recording.beforeRevoke === 2 && recording.afterRevoke === 0 && recording.revoked === 2);
  await recordContext.close();

  let realRecordBrowser;
  try {
    realRecordBrowser = await chromium.launch({
      headless: false,
      args: [
        '--use-fake-ui-for-media-stream',
        '--auto-select-desktop-capture-source=Workroom Studio',
        '--enable-usermedia-screen-capturing',
      ],
    });
    const realRecordContext = await realRecordBrowser.newContext();
    await realRecordContext.addInitScript(() => {
      globalThis.__recordingBlobs = new Map();
      globalThis.__recordingDownloads = [];
      const makeUrl = URL.createObjectURL.bind(URL);
      URL.createObjectURL = blob => {
        const url = makeUrl(blob);
        __recordingBlobs.set(url, blob);
        return url;
      };
      HTMLAnchorElement.prototype.click = function () {
        __recordingDownloads.push({ name: this.download, href: this.href });
      };
    });
    const realRecord = await realRecordContext.newPage();
    const realPageErrors = [];
    realRecord.on('dialog', dialog => dialog.accept());
    realRecord.on('pageerror', error => {
      realPageErrors.push(error.message);
      console.log('  [real recording page error] ' + error.message);
      bad++;
    });
    await realRecord.goto(`${origin}/broadcast.html`);
    await wait(realRecord, () => wireFrames.length > 0, null, 10000);
    await realRecord.evaluate(() => {
      globalThis.__capturedStreams = [];
      const nativeCapture = navigator.mediaDevices.getDisplayMedia.bind(navigator.mediaDevices);
      navigator.mediaDevices.getDisplayMedia = async options => {
        const stream = await nativeCapture(options);
        __capturedStreams.push(stream);
        return stream;
      };
      const NativeRecorder = window.MediaRecorder;
      let throwOnce = true;
      window.MediaRecorder = class extends NativeRecorder {
        static isTypeSupported(type) { return NativeRecorder.isTypeSupported(type); }
        start(timeslice) {
          if (throwOnce) {
            throwOnce = false;
            throw new Error('injected start failure');
          }
          return super.start(timeslice);
        }
      };
    });

    await realRecord.click('#rec');
    await wait(realRecord, () => /injected start failure/.test(document.getElementById('stat').textContent), null, 10000);
    const failedStart = await realRecord.evaluate(() => ({
      stat: document.getElementById('stat').textContent,
      streams: __capturedStreams.length,
      tracks: __capturedStreams.flatMap(s => s.getTracks()).map(t => t.readyState),
      recStream: recStream === null,
      recorder: recorder === null,
      chunks: chunks.length,
      recStart,
      label: document.getElementById('reclabel').textContent,
      dot: document.getElementById('recdot').className,
      hot: document.getElementById('rec').classList.contains('hot'),
    }));
    say('recorder.start throw is contained', failedStart.stat,
      failedStart.streams === 1 && failedStart.tracks.every(state => state === 'ended')
        && failedStart.recStream && failedStart.recorder && failedStart.chunks === 0
        && failedStart.recStart === 0 && failedStart.label === 'Record'
        && failedStart.dot === 'dot' && !failedStart.hot && /you can retry/.test(failedStart.stat)
        && realPageErrors.length === 0);

    await realRecord.click('#rec');
    await wait(realRecord, () => recorder && recorder.state === 'recording', null, 10000);
    await realRecord.evaluate(() => {
      const active = recorder;
      active.onerror({ error: new DOMException('injected runtime failure', 'UnknownError') });
      active.ondataavailable({ data: new Blob(['partial bytes'], { type: 'video/webm' }) });
      active.onstop();
    });
    await wait(realRecord, () => /injected runtime failure/.test(document.getElementById('stat').textContent), null, 5000);
    const runtimeFailure = await realRecord.evaluate(() => ({
      stat: document.getElementById('stat').textContent,
      downloads: __recordingDownloads.length,
      tracks: __capturedStreams.at(-1).getTracks().map(track => track.readyState),
      recStream: recStream === null,
      recorder: recorder === null,
      chunks: chunks.length,
      recStart,
      provenance: recordingProvenance,
      frozen: frozenRecordingProvenance,
      failure: recordingFailure && recordingFailure.reason,
      label: document.getElementById('reclabel').textContent,
      dot: document.getElementById('recdot').className,
      hot: document.getElementById('rec').classList.contains('hot'),
    }));
    say('runtime recorder error is failure-shaped', runtimeFailure.stat,
      runtimeFailure.downloads === 0 && runtimeFailure.tracks.every(state => state === 'ended')
        && runtimeFailure.recStream && runtimeFailure.recorder && runtimeFailure.chunks === 0
        && runtimeFailure.recStart === 0 && runtimeFailure.provenance === null
        && runtimeFailure.frozen === null && /injected runtime failure/.test(runtimeFailure.failure)
        && runtimeFailure.label === 'Record' && runtimeFailure.dot === 'dot' && !runtimeFailure.hot
        && /no evidence downloads were requested/.test(runtimeFailure.stat)
        && !/requested browser downloads/.test(runtimeFailure.stat) && realPageErrors.length === 0);

    await realRecord.click('#rec');
    await wait(realRecord, () => recorder && recorder.state === 'recording', null, 10000);
    const successfulStart = await realRecord.evaluate(() => ({
      captures: __capturedStreams.length,
      label: document.getElementById('reclabel').textContent,
      liveTracks: __capturedStreams.at(-1).getTracks().every(t => t.readyState === 'live'),
      stream: wireStream,
      frames: wireFrames.length,
      head: wireFrames.at(-1).frame_hash,
      provenance: structuredClone(recordingProvenance),
    }));
    const rejectedDuringRecording = await realRecord.evaluate(async () => {
      const before = JSON.stringify(recordingProvenance);
      const card = Object.keys(project(wireFrames).cards)[0];
      const frame = await buildFrame(wireStream, wireFrames.length,
        { event: 'card.edited', card, note: 'invalid during recording' },
        lastGood.payload_hash, lastGood.utc);
      frame.payload.note = 'tampered after hashing';
      const accepted = await takeFrame(frame, wireStream);
      return {
        accepted,
        unchanged: before === JSON.stringify(recordingProvenance),
        frames: wireFrames.length,
      };
    });
    say('rejected frames do not enter provenance',
      rejectedDuringRecording.accepted ? 'INVALID FRAME LANDED' : 'provenance unchanged',
      !rejectedDuringRecording.accepted && rejectedDuringRecording.unchanged
        && rejectedDuringRecording.frames === successfulStart.frames);
    await realRecord.evaluate(() => {
      const select = document.getElementById('f').contentDocument.getElementById('scenario');
      select.value = 'seed:incident';
      select.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await wait(realRecord, stream => wireStream !== stream && recordingProvenance.segments.length === 2,
      successfulStart.stream, 15000);
    const atStop = await realRecord.evaluate(() => ({
      stream: wireStream,
      frames: wireFrames.length,
      head: wireFrames.at(-1).frame_hash,
      provenance: structuredClone(recordingProvenance),
    }));
    await realRecord.waitForTimeout(1500);
    await realRecord.click('#rec');
    const postStop = await realRecord.evaluate(async () => {
      const card = Object.keys(project(wireFrames).cards)[0];
      const frame = await buildFrame(wireStream, wireFrames.length,
        { event: 'card.edited', card, note: 'accepted after stop request' },
        lastGood.payload_hash, lastGood.utc);
      const accepted = await takeFrame(frame, wireStream);
      return { accepted, seq: frame.seq, hash: frame.frame_hash, frames: wireFrames.length };
    });
    await wait(realRecord, () => recorder === null
      && /requested browser downloads/.test(document.getElementById('stat').textContent), null, 10000);
    const successfulRetry = await realRecord.evaluate(async () => {
      const files = await Promise.all([...__recordingBlobs.entries()].map(async ([url, blob]) => ({
        name: __recordingDownloads.find(item => item.href === url)?.name,
        size: blob.size,
        sha: await sha256Hex(new Uint8Array(await blob.arrayBuffer())),
      })));
      const sideEntry = [...__recordingBlobs.entries()].find(([url]) =>
        __recordingDownloads.find(item => item.href === url)?.name.endsWith('.frames.json'));
      const sidecar = sideEntry ? JSON.parse(await sideEntry[1].text()) : null;
      const segmentChecks = sidecar
        ? await Promise.all(sidecar.segments.map(segment => validateChain(segment.frames, segment.stream_id)))
        : [];
      const row = document.querySelector('#files>div')?.textContent || '';
      const tracksEnded = __capturedStreams.flatMap(s => s.getTracks()).every(t => t.readyState === 'ended');
      const state = {
        files, sidecar, segmentChecks, row, tracksEnded,
        recStream: recStream === null, recorder: recorder === null,
        chunks: chunks.length, recStart, label: document.getElementById('reclabel').textContent,
        dot: document.getElementById('recdot').className,
        hot: document.getElementById('rec').classList.contains('hot'),
        urls: objectUrls.size,
      };
      cleanupPageResources();
      state.urlsAfterCleanup = objectUrls.size;
      return state;
    });
    const webm = successfulRetry.files.find(file => file.name && file.name.endsWith('.webm'));
    say('retry starts a real recording', JSON.stringify({
      captures: successfulStart.captures,
      label: successfulStart.label,
      liveTracks: successfulStart.liveTracks,
      startSeq: successfulStart.provenance.segments[0]?.start_seq,
    }),
      successfulStart.captures === 3 && successfulStart.label === 'Stop and download'
        && successfulStart.liveTracks && successfulStart.provenance.segments.length === 1);
    const [tourSegment, incidentSegment] = successfulRetry.sidecar?.segments || [];
    say('recording captures ordered stream segments', JSON.stringify(
      successfulRetry.sidecar?.segments.map(segment => ({
        stream: segment.stream_id, start: segment.start_seq, end: segment.end_seq,
      })) || []),
    !!tourSegment && !!incidentSegment && successfulRetry.sidecar.segments.length === 2
      && tourSegment.stream_id === successfulStart.stream
      && tourSegment.start_seq === successfulStart.frames - 1
      && tourSegment.start_hash === successfulStart.head
      && tourSegment.end_seq === successfulStart.frames - 1
      && tourSegment.end_hash === successfulStart.head
      && incidentSegment.stream_id === atStop.stream
      && incidentSegment.start_seq === atStop.frames - 1
      && incidentSegment.start_hash === atStop.head
      && incidentSegment.end_seq === atStop.frames - 1
      && incidentSegment.end_hash === atStop.head
      && successfulRetry.segmentChecks.every(result => result.ok)
      && !('stream_id' in successfulRetry.sidecar) && !('frames' in successfulRetry.sidecar));
    say('post-stop accepted frame is excluded', `${postStop.seq} after ${incidentSegment?.end_seq}`,
      postStop.accepted && postStop.frames === atStop.frames + 1
        && incidentSegment && incidentSegment.frames.length === atStop.frames
        && incidentSegment.end_seq === atStop.frames - 1
        && !incidentSegment.frames.some(frame => frame.frame_hash === postStop.hash));
    say('real retry records, hashes, and cleans up', JSON.stringify({
      files: successfulRetry.files.map(file => ({ name: file.name, size: file.size })),
      tracksEnded: successfulRetry.tracksEnded,
    }), successfulRetry.files.length === 2 && webm && webm.size > 0 && successfulRetry.sidecar
      && successfulRetry.sidecar.bytes === webm.size && successfulRetry.sidecar.sha256 === webm.sha
      && successfulRetry.row.includes(webm.sha) && successfulRetry.tracksEnded
      && successfulRetry.recStream && successfulRetry.recorder && successfulRetry.chunks === 0
      && successfulRetry.recStart === 0 && successfulRetry.label === 'Record'
      && successfulRetry.dot === 'dot' && !successfulRetry.hot
      && successfulRetry.urls === 2 && successfulRetry.urlsAfterCleanup === 0
      && realPageErrors.length === 0);
    await realRecordContext.close();
  } finally {
    if (realRecordBrowser) await realRecordBrowser.close();
  }

  const hashMutated = studioSource
    .replace("      if (ph !== f.payload_hash) return fail('payload_hash does not match the payload');",
      '      // mutation: payload hash check removed')
    .replace("      if (fh !== f.frame_hash) return fail('frame_hash does not match the frame');",
      '      // mutation: frame hash check removed');
  {
    const { context: mutationContext, page } = await mutationPage(browser, 'hash', hashMutated);
    const escaped = await page.evaluate(async () => {
      const card = Object.keys(project(wireFrames).cards)[0];
      const frame = await buildFrame(wireStream, wireFrames.length,
        { event: 'card.edited', card, note: 'before' }, lastGood.payload_hash, lastGood.utc);
      frame.payload.note = 'after';
      return takeFrame(frame, wireStream);
    });
    say('hash mutation makes the assertion fail', escaped ? 'mutation detected' : 'mutation survived', escaped);
    await mutationContext.close();
  }

  {
    const start = studioSource.indexOf('function project(list) {');
    const end = studioSource.indexOf('\nfunction paintBoard', start);
    const projectMutated = studioSource.slice(0, start)
      + "function project() { return { cards:{}, order:{now:[],next:[],blocked:[],done:[]} }; }\n"
      + studioSource.slice(end + 1);
    const { context: mutationContext, page } = await mutationPage(browser, 'project', projectMutated);
    const frames = await page.evaluate(() => structuredClone(wireFrames));
    await page.evaluate(() => paintBoard());
    const wrong = await domBoard(page);
    say('project mutation makes the oracle fail', 'mutation detected', !same(wrong, oracle(frames)));
    await mutationContext.close();
  }

  {
    const start = studioSource.indexOf('function relay(msg) {');
    const end = studioSource.indexOf('\n\nconst PEER_SRC', start);
    const transportMutated = studioSource.slice(0, start)
      + 'function relay(msg) { /* mutation: delivery removed */ }'
      + studioSource.slice(end);
    const { context: mutationContext, page } = await mutationPage(browser, 'transport', transportMutated);
    const delivered = await page.evaluate(() => {
      const sent = [];
      watchers.set('probe', { send: value => sent.push(value) });
      relay({ rapp: 'probe' });
      return sent.length;
    });
    say('transport mutation makes delivery fail', 'mutation detected', delivered === 0);
    await mutationContext.close();
  }

  await context.close();
} catch (e) {
  console.error('\n  gate crashed: ' + (e && e.stack || e));
  bad++;
} finally {
  await browser.close();
  await new Promise(resolveClose => server.close(resolveClose));
}

console.log(bad
  ? `\n${bad} studio problem(s)`
  : '\nthe studio gate passed: real transport, independent projection, atomic refusal, lifecycle, failure, and mutation checks');
process.exit(bad ? 1 : 0);

/* nexuscheck.mjs — adversarial acceptance checks for nexus3d.html. */
import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, extname, resolve, sep } from 'node:path';
import { createHash } from 'node:crypto';

const root = dirname(fileURLToPath(import.meta.url));
const types = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
};
const server = createServer(async (req, res) => {
  try {
    const requestUrl = new URL(req.url, 'http://localhost');
    const pathname = decodeURIComponent(requestUrl.pathname);
    const file = resolve(root, pathname === '/' ? 'nexus3d.html' : pathname.slice(1));
    if (file !== root && !file.startsWith(root + sep)) throw new Error('outside root');
    if (!(await stat(file)).isFile()) throw new Error('not a file');
    let body = await readFile(file);
    if (file === resolve(root, 'nexus3d.html') && requestUrl.searchParams.has('mask-three')) {
      body = Buffer.from(body.toString().replace(
        '<script src="vendor/three-r128.min.js"></script>',
        '<script src="vendor/three-r128.min.js"></script><script>globalThis.THREE = undefined;</script>'));
    }
    res.writeHead(200, {
      'content-type': types[extname(file)] || 'application/octet-stream',
      'cache-control': 'no-store',
    });
    res.end(body);
  } catch {
    res.writeHead(404);
    res.end('not found');
  }
});
await new Promise((resolve, reject) => {
  server.once('error', reject);
  server.listen(0, '127.0.0.1', resolve);
});
const { port } = server.address();
const url = `http://127.0.0.1:${port}/nexus3d.html`;

const browser = await chromium.launch();
let bad = 0;
let checks = 0;
const pageErrors = [];
const check = (name, pass, detail = '') => {
  checks++;
  console.log(`${pass ? '  PASS' : '* FAIL'}  ${name.padEnd(47)}${detail}`);
  if (!pass) bad++;
};
const watch = page => page.on('pageerror', error => pageErrors.push(error.message));
const ready = page => page.waitForFunction(() => window.__nexusReady === true, null, { timeout: 20000 });
const open = async (context, viewport) => {
  const page = await context.newPage();
  watch(page);
  if (viewport) await page.setViewportSize(viewport);
  await page.goto(url);
  await ready(page);
  return page;
};
const clone = value => JSON.parse(JSON.stringify(value));
const parentMatches = (origin, parent, at) =>
  origin && origin.stream_id === parent.stream && origin.seq === at &&
  origin.frame_hash === parent.frames[at].frame_hash;
const reduce = list => {
  const world = { peers: {}, order: [], said: [] };
  for (const frame of list) {
    const payload = frame.payload;
    if (payload.event === 'peer.joined') {
      if (world.peers[payload.who]) continue;
      world.peers[payload.who] = {
        who: payload.who, kind: payload.kind, x: payload.x, z: payload.z,
        ry: payload.ry, say: '', at: frame.seq,
      };
      world.order.push(payload.who);
    } else if (payload.event === 'peer.moved' && world.peers[payload.who]) {
      Object.assign(world.peers[payload.who], { x: payload.x, z: payload.z, ry: payload.ry });
    } else if (payload.event === 'peer.said' && world.peers[payload.who]) {
      world.peers[payload.who].say = payload.text;
      world.peers[payload.who].saidAt = frame.seq;
      world.said.push({ who: payload.who, text: payload.text, seq: frame.seq });
      if (world.said.length > 60) world.said.shift();
    } else if (payload.event === 'peer.left' && world.peers[payload.who]) {
      delete world.peers[payload.who];
      world.order = world.order.filter(who => who !== payload.who);
    }
  }
  return world;
};
const streamPattern = /^rappid:@kody-w\/nexus3d:[0-9a-f]{64}:[0-9a-f]{16}$/;
const randomnessScore = ids => {
  if (ids.length < 8 || new Set(ids).size !== ids.length || !ids.every(id => streamPattern.test(id))) return false;
  const hex = ids.map(id => id.split(':').slice(-2).join('')).join('');
  let ones = 0;
  for (const digit of hex) ones += Number.parseInt(digit, 16).toString(2).padStart(4, '0').split('1').length - 1;
  const ratio = ones / (hex.length * 4);
  return ratio > 0.40 && ratio < 0.60;
};

try {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, acceptDownloads: false });
  const page = await open(context);

  const boot = await page.evaluate(async () => {
    const envelope = JSON.parse(localStorage.getItem(RECORD_KEY));
    return {
      n: frames.length, stream: streamId, verification: await verifyChain(frames, streamId),
      envelope, legacy: [localStorage.getItem(LEGACY.frames), localStorage.getItem(LEGACY.stream)],
      people: [...world.order], meAt: { ...meAt }, you: { ...world.peers.you },
    };
  });
  check('boots a six-frame verified room', boot.n === 6 && boot.verification.length === 0, `${boot.n} frames`);
  check('uses one versioned atomic envelope',
    boot.envelope.version === 1 && boot.envelope.stream_id === boot.stream &&
      boot.envelope.frames.length === boot.n && boot.legacy.every(value => value === null));
  check('stream identifier has the canonical form', streamPattern.test(boot.stream), boot.stream);
  check('movement state starts at the projected user', JSON.stringify(boot.meAt) === JSON.stringify({
    x: boot.you.x, z: boot.you.z, ry: boot.you.ry,
  }), `${boot.meAt.z} = ${boot.you.z}`);

  const independent = reduce(boot.envelope.frames);
  await page.waitForTimeout(550);
  const rendered = await page.evaluate(() => bodies.children
    .filter(child => child.geometry === GEO.body)
    .map(child => ({ x: child.position.x, z: child.position.z })));
  check('independent reducer matches projected membership',
    JSON.stringify(independent.order) === JSON.stringify(boot.people), independent.order.join(' '));
  check('rendered bodies match independently reduced positions',
    rendered.length === independent.order.length && rendered.every((body, i) => {
      const peer = independent.peers[independent.order[i]];
      return Math.abs(body.x - peer.x / 10) < 0.02 && Math.abs(body.z - peer.z / 10) < 0.02;
    }), `${rendered.length} rendered`);

  const renderMutationCaught = await page.evaluate(() => {
    const body = bodies.children.find(child => child.geometry === GEO.body);
    body.position.x += 100;
    const expected = world.peers[world.order[0]];
    const caught = Math.abs(body.position.x - expected.x / 10) >= 0.02;
    drawWorld(viewed());
    return caught;
  });
  check('render assertion detects a displaced body', renderMutationCaught);

  const ids = await page.evaluate(async () => Promise.all(Array.from({ length: 24 }, () => mintStream())));
  check('stream samples are unique and high-diversity', randomnessScore(ids), `${new Set(ids).size}/24 unique`);
  const deterministic = Array.from({ length: 24 }, (_, i) =>
    `rappid:@kody-w/nexus3d:${i.toString(16).padStart(64, '0')}:${i.toString(16).padStart(16, '0')}`);
  check('randomness assertion rejects deterministic counters', !randomnessScore(deterministic));

  const mutations = await page.evaluate(async () => {
    const base = structuredClone(frames);
    const test = async mutate => {
      const changed = structuredClone(base);
      mutate(changed);
      return (await verifyChain(changed, streamId)).length > 0;
    };
    return {
      payload: await test(list => { list[1].payload.x++; }),
      frameHash: await test(list => { list[1].frame_hash = '0'.repeat(64); }),
      predecessor: await test(list => { list[2].prev = '0'.repeat(64); }),
      sequence: await test(list => { list[2].seq = 99; }),
      keySet: await test(list => { list[1].extra = true; }),
      backwardsTime: await test(list => { list[2].utc = '1970-01-01T00:00:00.000Z'; }),
    };
  });
  check('verifier rejects independent frame mutations', Object.values(mutations).every(Boolean), JSON.stringify(mutations));

  const movement = await (async () => {
    const before = await page.evaluate(() => ({ n: frames.length, peer: { ...world.peers.you } }));
    await page.locator('canvas').click();
    await page.keyboard.down('w');
    await page.waitForTimeout(330);
    await page.keyboard.up('w');
    await page.evaluate(() => queue);
    const after = await page.evaluate(async n => ({
      peer: { ...world.peers.you }, me: { ...meAt }, moves: frames.slice(n).map(frame => frame.payload),
      verification: await verifyChain(frames, streamId),
    }), before.n);
    return { before, after };
  })();
  const firstMove = movement.after.moves[0];
  const firstDistance = firstMove ? Math.hypot(
    firstMove.x - movement.before.peer.x, firstMove.z - movement.before.peer.z) : Infinity;
  check('real keyboard movement is bounded and appended',
    movement.after.moves.length >= 1 && firstDistance <= 10 && movement.after.verification.length === 0,
    `${movement.after.moves.length} frame(s), first delta ${firstDistance.toFixed(1)}`);
  check('camera state remains aligned with the projection',
    movement.after.me.x === movement.after.peer.x && movement.after.me.z === movement.after.peer.z);

  const said = await (async () => {
    const before = await page.evaluate(() => frames.length);
    await page.fill('#msg', 'hello from the checker');
    await page.click('#send');
    await page.waitForFunction(n => frames.length === n + 1, before);
    return page.evaluate(() => ({ payload: frames.at(-1).payload, input: document.getElementById('msg').value }));
  })();
  check('Say appends one user frame and clears on success',
    said.payload.event === 'peer.said' && said.payload.text === 'hello from the checker' && said.input === '');

  const liveControl = await (async () => {
    const before = await page.evaluate(() => frames.length);
    await page.click('#live');
    await page.waitForTimeout(2800);
    await page.click('#live');
    await page.evaluate(() => queue);
    return page.evaluate(n => ({ added: frames.length - n, stopped: live === null }), before);
  })();
  check('Let them work starts and stops resident appends',
    liveControl.added >= 2 && liveControl.stopped, `${liveControl.added} frames`);

  const cameraControl = await (async () => {
    const before = await page.evaluate(() => ({ mode, theta, phi, dist }));
    await page.click('#cam');
    const personMode = await page.evaluate(() => mode);
    await page.click('#cam');
    const canvas = page.locator('canvas');
    const box = await canvas.boundingBox();
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width / 2 + 80, box.y + box.height / 2 - 30);
    await page.mouse.up();
    await page.mouse.wheel(0, 250);
    const after = await page.evaluate(() => ({ mode, theta, phi, dist }));
    return { before, personMode, after };
  })();
  check('camera toggle, drag, and wheel controls respond',
    cameraControl.personMode === 'me' && cameraControl.after.mode === 'room' &&
      cameraControl.after.theta !== cameraControl.before.theta &&
      cameraControl.after.phi !== cameraControl.before.phi &&
      cameraControl.after.dist !== cameraControl.before.dist);

  const lifecycle = await page.evaluate(async () => {
    const start = frames.length;
    const joined = await append({ event: 'peer.joined', who: 'probe', kind: 'agent', x: 0, z: 0, ry: 0 });
    const said = await append({ event: 'peer.said', who: 'probe', text: 'hello' });
    await new Promise(resolve => setTimeout(resolve, 220));
    const moved = await append({ event: 'peer.moved', who: 'probe', x: 1, z: -1, ry: 25 });
    const left = await append({ event: 'peer.left', who: 'probe' });
    const ghostTalk = await append({ event: 'peer.said', who: 'probe', text: 'ghost' });
    const rejoined = await append({ event: 'peer.joined', who: 'probe', kind: 'agent', x: 0, z: 0, ry: 0 });
    return {
      accepted: [joined, said, moved, left, rejoined].every(Boolean), ghostTalk: !!ghostTalk,
      added: frames.length - start, verification: await verifyChain(frames, streamId),
    };
  });
  check('join/talk/move/leave/rejoin lifecycle is enforced',
    lifecycle.accepted && !lifecycle.ghostTalk && lifecycle.added === 5 && lifecycle.verification.length === 0);

  const semantics = await page.evaluate(async () => {
    const start = frames.length;
    const attempts = [];
    attempts.push(await append({ event: 'peer.joined', who: 'outside', kind: 'agent', x: 99999, z: 0, ry: 0 }));
    attempts.push(await append({ event: 'peer.moved', who: 'you', x: world.peers.you.x, z: world.peers.you.z, ry: 'bad' }));
    attempts.push(await append({ event: 'peer.said', who: 'you', text: '   ' }));
    attempts.push(await append({ event: 'peer.said', who: 'you', text: 'x'.repeat(141) }));
    await append({ event: 'peer.moved', who: 'you', x: world.peers.you.x, z: world.peers.you.z, ry: world.peers.you.ry });
    attempts.push(await append({ event: 'peer.moved', who: 'you', x: 100, z: 100, ry: 0 }));
    const payload = { event: 'room.opened', title: 'x', from: { stream_id: 'x', seq: -1, frame_hash: 'wrong' } };
    const pre = { spec: SPEC, kind: KIND, stream_id: 'x', seq: 0, utc: '', payload,
      payload_hash: await H('rapp/1:particle', payload), prev: null, prev_wave: null };
    const synthetic = { ...pre, frame_hash: await H('rapp/1:wave', pre), sig: null };
    return {
      rejected: attempts.every(value => !value), grew: frames.length - start,
      syntheticProblems: await verifyChain([synthetic], 'x'),
    };
  });
  check('writer rejects malformed and over-speed events',
    semantics.rejected && semantics.grew === 1, `${semantics.grew} valid control frame`);
  check('verifier rejects malformed stream/UTC/parent shape',
    semantics.syntheticProblems.length >= 3, semantics.syntheticProblems.join('; '));

  const pacing = await page.evaluate(async () => {
    const run = async slow => {
      await queue;
      const start = frames.length, t0 = performance.now(), original = requestAnimationFrame;
      if (slow) requestAnimationFrame = callback => setTimeout(() => original(callback), 220);
      setLive(true);
      await new Promise(resolve => setTimeout(resolve, 5400));
      setLive(false);
      await queue;
      if (slow) requestAnimationFrame = original;
      return { added: frames.length - start, elapsed: performance.now() - t0 };
    };
    return { normal: await run(false), throttled: await run(true), verification: await verifyChain(frames, streamId) };
  });
  check('resident work is paced by wall clock under slow rendering',
    pacing.normal.added >= 3 && pacing.throttled.added >= 3 &&
      Math.abs(pacing.normal.added - pacing.throttled.added) <= 1 && pacing.verification.length === 0,
    `${pacing.normal.added}/${pacing.normal.elapsed.toFixed(0)}ms vs ${pacing.throttled.added}/${pacing.throttled.elapsed.toFixed(0)}ms`);

  await page.locator('#scrub').fill('1');
  await page.waitForFunction(() => {
    if (viewAt !== 1) return false;
    const expected = viewed().order;
    const listed = [...document.querySelectorAll('#who .w1 b')].map(node => node.textContent);
    const rendered = bodies.children.filter(child => child.geometry === GEO.body).length;
    return JSON.stringify(expected) === JSON.stringify(listed) && rendered === expected.length;
  });
  const past = await page.evaluate(async () => {
    const expected = project(frames.slice(0, 2)).order;
    const listed = [...document.querySelectorAll('#who .w1 b')].map(node => node.textContent);
    const renderedCount = bodies.children.filter(child => child.geometry === GEO.body).length;
    const n = frames.length;
    document.getElementById('msg').value = 'keep this draft';
    await say();
    const draft = document.getElementById('msg').value;
    return { expected, listed, renderedCount, added: frames.length - n, draft, last: frames.length - 1 };
  });
  await page.locator('#scrub').fill(String(past.last));
  check('scrub repaints model, roster, and rendered bodies',
    JSON.stringify(past.expected) === JSON.stringify(past.listed) && past.renderedCount === past.expected.length,
    `${past.expected.length} expected/${past.renderedCount} rendered`);
  check('past is read-only without discarding speech', past.added === 0 && past.draft === 'keep this draft');

  await page.click('#replay');
  await page.waitForTimeout(1000);
  const replaying = await page.evaluate(() => ({ playing: !!playing, viewAt }));
  await page.click('#replay');
  const replayStopped = await page.evaluate(() => playing === null && viewAt === null);
  check('Replay advances and returns cleanly to now',
    replaying.playing && Number.isInteger(replaying.viewAt) && replaying.viewAt > 0 && replayStopped);

  const parent = await page.evaluate(() => ({ stream: streamId, frames: structuredClone(frames) }));
  const at = Math.floor(parent.frames.length / 2);
  await page.evaluate(index => seekTo(index), at);
  page.once('dialog', dialog => dialog.accept());
  await page.click('#fork');
  await page.waitForFunction(parentStream => streamId !== parentStream, parent.stream);
  const fork = await page.evaluate(async () => ({
    stream: streamId, frames: structuredClone(frames), origin: structuredClone(frames[0].payload.from),
    verification: await verifyChain(frames, streamId),
  }));
  check('fork has exact parent stream, sequence, and hash',
    fork.stream !== parent.stream && parentMatches(fork.origin, parent, at));
  const badOrigin = clone(fork.origin);
  badOrigin.frame_hash = '0'.repeat(64);
  check('parent assertion detects a wrong parent hash', !parentMatches(badOrigin, parent, at));
  const childBefore = fork.frames.length;
  const childAfter = await page.evaluate(async () => {
    await append({ event: 'peer.said', who: 'you', text: 'child-only' });
    return { n: frames.length, last: frames.at(-1).payload, verification: await verifyChain(frames, streamId) };
  });
  check('fork appends independently of the parent snapshot',
    childAfter.n === childBefore + 1 && childAfter.last.text === 'child-only' &&
      !parent.frames.some(frame => frame.payload.text === 'child-only') && childAfter.verification.length === 0);

  await page.evaluate(() => {
    window.__downloads = [];
    window.__revoked = 0;
    const create = URL.createObjectURL.bind(URL), revoke = URL.revokeObjectURL.bind(URL);
    URL.createObjectURL = blob => { window.__downloads.push(blob); return create(blob); };
    URL.revokeObjectURL = value => { window.__revoked++; return revoke(value); };
    HTMLAnchorElement.prototype.click = function () {};
  });
  await page.click('#export');
  await page.waitForTimeout(1100);
  const exported = await page.evaluate(async () => {
    const payload = JSON.parse(await window.__downloads[0].text());
    return {
      exact: payload.stream_id === streamId && JSON.stringify(payload.frames) === JSON.stringify(frames),
      verification: await verifyChain(payload.frames, payload.stream_id), revoked: window.__revoked,
    };
  });
  check('export round-trips the exact verified chain', exported.exact && exported.verification.length === 0);
  check('export object URL is revoked', exported.revoked === 1, `${exported.revoked} revoked`);

  const persisted = await page.evaluate(() => ({ stream: streamId, head: headOf(frames), n: frames.length }));
  await page.reload();
  await ready(page);
  const reloaded = await page.evaluate(async () => ({
    stream: streamId, head: headOf(frames), n: frames.length, verification: await verifyChain(frames, streamId),
  }));
  check('verified state survives reload exactly',
    JSON.stringify(persisted) === JSON.stringify({ stream: reloaded.stream, head: reloaded.head, n: reloaded.n }) &&
      reloaded.verification.length === 0);

  const setupErrorStart = pageErrors.length;
  const recorderSetupFailures = await page.evaluate(() => {
    const nativeRecorder = window.MediaRecorder;
    const nativeCapture = renderer.domElement.captureStream.bind(renderer.domElement);
    const button = document.getElementById('rec');
    const cleanState = (message, track) => ({
      clean: recorder === null && recordingState === null && chunks.length === 0 &&
        button.textContent === '● Record' && !button.classList.contains('hot') && !button.disabled,
      explicit: document.getElementById('stat').textContent.includes(message),
      track: track ? track.readyState : null,
    });

    renderer.domElement.captureStream = () => { throw new Error('captureStream setup failure'); };
    button.click();
    const capture = cleanState('captureStream setup failure');

    const constructorTrack = { readyState: 'live', stop() { this.readyState = 'ended'; } };
    renderer.domElement.captureStream = () => ({ getTracks: () => [constructorTrack] });
    window.MediaRecorder = class {
      static isTypeSupported() { return true; }
      constructor() { throw new Error('MediaRecorder constructor failure'); }
    };
    button.click();
    const constructor = cleanState('MediaRecorder constructor failure', constructorTrack);

    const startTrack = { readyState: 'live', stop() { this.readyState = 'ended'; } };
    renderer.domElement.captureStream = () => ({ getTracks: () => [startTrack] });
    window.MediaRecorder = class {
      static isTypeSupported() { return true; }
      constructor() { this.state = 'inactive'; }
      start() { throw new Error('MediaRecorder start failure'); }
      stop() { this.state = 'inactive'; }
    };
    button.click();
    const start = cleanState('MediaRecorder start failure', startTrack);

    window.MediaRecorder = nativeRecorder;
    renderer.domElement.captureStream = nativeCapture;
    return { capture, constructor, start };
  });
  check('recorder setup exceptions fail cleanly without page errors',
    Object.values(recorderSetupFailures).every(result => result.clean && result.explicit) &&
      recorderSetupFailures.constructor.track === 'ended' &&
      recorderSetupFailures.start.track === 'ended' &&
      pageErrors.length === setupErrorStart,
    JSON.stringify(recorderSetupFailures));

  await page.evaluate(() => {
    const originalCapture = renderer.domElement.captureStream.bind(renderer.domElement);
    renderer.domElement.captureStream = (...args) => {
      window.__captureStream = originalCapture(...args);
      return window.__captureStream;
    };
    window.__downloads = [];
    downloadBlob = (name, blob) => window.__downloads.push({ name, blob });
  });
  const recordingStart = await page.evaluate(() => ({ stream: streamId, head: headOf(frames) }));
  await page.click('#rec');
  await page.waitForFunction(() => recorder && recorder.state === 'recording');
  await page.click('#reset');
  const resetBlocked = await page.evaluate(start =>
    streamId === start.stream && headOf(frames) === start.head && !!recorder, recordingStart);
  await page.click('#fork');
  const forkBlocked = await page.evaluate(start =>
    streamId === start.stream && headOf(frames) === start.head && !!recorder, recordingStart);
  await page.click('#live');
  await page.waitForTimeout(2500);
  await page.click('#live');
  await page.evaluate(async () => {
    await queue;
    await append({ event: 'peer.said', who: 'you', text: 'during-recording' });
  });
  await page.click('#rec');
  await page.waitForFunction(() => recorder === null && window.__downloads.length === 2, null, { timeout: 15000 });
  const recording = await page.evaluate(async start => {
    const sidecar = window.__downloads.find(item => item.name.endsWith('.frames.json'));
    const webm = window.__downloads.find(item => item.name.endsWith('.webm'));
    const data = JSON.parse(await sidecar.blob.text());
    const bytes = new Uint8Array(await webm.blob.arrayBuffer());
    let binary = '';
    for (let i = 0; i < bytes.length; i += 0x8000) {
      binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    }
    return {
      resetBlocked: streamId === start.stream && start.resetBlocked,
      forkBlocked: streamId === start.stream && start.forkBlocked,
      tracks: window.__captureStream.getTracks().map(track => track.readyState),
      recorderStopped: recorder === null,
      immutable: data.stream_id === start.stream && data.start_frame_hash === start.head &&
        data.frames[data.frames.length - 1].payload.text === 'during-recording',
      webmBase64: btoa(binary), webmType: webm.blob.type,
      sidecarBytes: data.bytes, sidecarSha256: data.sha256,
    };
  }, { ...recordingStart, resetBlocked, forkBlocked });
  const capturedWebm = Buffer.from(recording.webmBase64, 'base64');
  const independentlyHashedWebm = createHash('sha256').update(capturedWebm).digest('hex');
  check('reset and fork are blocked during recording', recording.resetBlocked && recording.forkBlocked);
  check('recording succeeds after setup failures',
    recording.recorderStopped && recording.webmType.includes('video/webm') && capturedWebm.length > 0);
  check('recording sidecar is an immutable chain snapshot', recording.immutable);
  check('recording sidecar bytes and hash match the WebM',
    recording.webmType.includes('video/webm') && capturedWebm.length > 0 &&
      recording.sidecarBytes === capturedWebm.length && recording.sidecarSha256 === independentlyHashedWebm,
    `${recording.sidecarBytes} bytes · ${recording.sidecarSha256}`);
  check('recording capture tracks are stopped',
    recording.recorderStopped && recording.tracks.length > 0 && recording.tracks.every(state => state === 'ended'));

  const shot = await page.screenshot();
  check('screenshot is produced in memory only', shot.length > 10000, `${shot.length} bytes`);
  await context.close();

  const noLockContext = await browser.newContext();
  const noLockSeed = await open(noLockContext);
  const noLockRaw = await noLockSeed.evaluate(() => localStorage.getItem(RECORD_KEY));
  await noLockSeed.close();
  await noLockContext.addInitScript(() => {
    Object.defineProperty(navigator, 'locks', { value: undefined, configurable: true });
  });
  const noLockFirst = await open(noLockContext);
  const noLockSecond = await open(noLockContext);
  const noLockUi = await noLockFirst.evaluate(async () => {
    window.__lockBodyRan = false;
    const lockResult = await withRecordLock(() => { window.__lockBodyRan = true; return { ok: true }; });
    return {
      available: WEB_LOCKS_AVAILABLE,
      blocked: mutationBlocked,
      status: document.getElementById('stat').textContent,
      mutationsDisabled: ['live', 'fork', 'rec', 'reset', 'msg', 'send']
        .every(id => document.getElementById(id).disabled),
      safeEnabled: ['replay', 'cam', 'export', 'scrub']
        .every(id => !document.getElementById(id).disabled),
      lockBodyRan: window.__lockBodyRan,
      lockUnavailable: !!lockResult.lockUnavailable,
      frames: frames.length,
      verification: await verifyChain(frames, streamId),
    };
  });
  check('missing Web Locks enters explicit verified read-only UI',
    !noLockUi.available && noLockUi.frames > 0 && noLockUi.verification.length === 0 &&
      noLockUi.blocked && noLockUi.status.includes('Web Locks are unavailable') &&
      noLockUi.status.includes('read-only') && noLockUi.mutationsDisabled && noLockUi.safeEnabled);
  check('lock wrapper never invokes a transaction body unlocked',
    !noLockUi.lockBodyRan && noLockUi.lockUnavailable);
  const noLockAt = Date.now() + 300;
  const noLockResults = await Promise.all([
    noLockFirst.evaluate(at => new Promise(resolve => setTimeout(async () =>
      resolve(!!await append({ event: 'peer.said', who: 'you', text: 'no-lock-a' })), Math.max(0, at - Date.now()))), noLockAt),
    noLockSecond.evaluate(at => new Promise(resolve => setTimeout(async () =>
      resolve(!!await append({ event: 'peer.said', who: 'you', text: 'no-lock-b' })), Math.max(0, at - Date.now()))), noLockAt),
  ]);
  const noLockAfter = await noLockFirst.evaluate(() => localStorage.getItem(RECORD_KEY));
  check('two-tab no-lock barrier acknowledges zero writes',
    noLockResults.every(result => result === false) && noLockAfter === noLockRaw,
    `${noLockResults.join('/')} and storage unchanged`);
  await noLockContext.close();

  const raceContext = await browser.newContext();
  const first = await open(raceContext);
  const second = await open(raceContext);
  const raceStart = await first.evaluate(() => frames.length);
  const results = await Promise.all([
    first.evaluate(() => new Promise(resolve => setTimeout(async () =>
      resolve(!!await append({ event: 'peer.said', who: 'you', text: 'race-a' })), 250))),
    second.evaluate(() => new Promise(resolve => setTimeout(async () =>
      resolve(!!await append({ event: 'peer.said', who: 'you', text: 'race-b' })), 250))),
  ]);
  await first.waitForTimeout(200);
  const race = await first.evaluate(async () => {
    const envelope = JSON.parse(localStorage.getItem(RECORD_KEY));
    return { n: envelope.frames.length, verification: await verifyChain(envelope.frames, envelope.stream_id) };
  });
  const raceStates = await Promise.all([first, second].map(candidate =>
    candidate.evaluate(() => ({ refused, status: document.getElementById('stat').textContent }))));
  check('simultaneous tabs acknowledge exactly one append',
    results.filter(Boolean).length === 1 && race.n === raceStart + 1 && race.verification.length === 0,
    `${results.join('/')} and ${raceStart}→${race.n}`);
  check('the losing tab surfaces stale state',
    raceStates.filter(state => state.refused && state.status.includes('another tab')).length === 1);
  await raceContext.close();

  const failureContext = await browser.newContext();
  const failurePage = await open(failureContext);
  const partial = await failurePage.evaluate(async () => {
    const raw = localStorage.getItem(RECORD_KEY), n = frames.length;
    const original = Storage.prototype.setItem;
    Storage.prototype.setItem = function () { throw new DOMException('simulated denial', 'QuotaExceededError'); };
    const result = await append({ event: 'peer.said', who: 'you', text: 'must-not-persist' });
    Storage.prototype.setItem = original;
    return {
      accepted: !!result, memoryN: frames.length, diskSame: localStorage.getItem(RECORD_KEY) === raw,
      startN: n, status: document.getElementById('stat').textContent,
    };
  });
  check('failed atomic write leaves memory and disk unchanged',
    !partial.accepted && partial.memoryN === partial.startN && partial.diskSame &&
      partial.status.includes('read-only'));
  await failureContext.close();

  const corruptContext = await browser.newContext();
  const corruptPage = await open(corruptContext);
  const corruptRaw = await corruptPage.evaluate(() => {
    const envelope = JSON.parse(localStorage.getItem(RECORD_KEY));
    envelope.frames[1].payload.x++;
    const raw = JSON.stringify(envelope);
    localStorage.setItem(RECORD_KEY, raw);
    return raw;
  });
  await corruptPage.reload();
  await ready(corruptPage);
  const quarantine = await corruptPage.evaluate(() => ({
    n: frames.length, people: world.order.length,
    rendered: bodies.children.filter(child => child.geometry === GEO.body).length,
    refused, raw: localStorage.getItem(RECORD_KEY),
  }));
  check('corrupt bytes are quarantined and never projected',
    quarantine.n === 0 && quarantine.people === 0 && quarantine.rendered === 0 &&
      quarantine.raw === corruptRaw && quarantine.refused.includes('corrupt'));
  corruptPage.once('dialog', dialog => dialog.accept());
  await corruptPage.click('#reset');
  await corruptPage.waitForFunction(() => frames.length === 2);
  const recovered = await corruptPage.evaluate(async badRaw => {
    const envelope = JSON.parse(localStorage.getItem(RECORD_KEY));
    return {
      preserved: envelope.quarantine.some(item => item.raw === badRaw),
      verification: await verifyChain(envelope.frames, envelope.stream_id),
    };
  }, corruptRaw);
  check('reset preserves corrupt bytes in quarantine', recovered.preserved && recovered.verification.length === 0);
  await corruptContext.close();

  const malformedContext = await browser.newContext();
  const malformedPage = await open(malformedContext);
  await malformedPage.evaluate(() => localStorage.setItem(RECORD_KEY, '{bad json'));
  await malformedPage.reload();
  await ready(malformedPage);
  const malformed = await malformedPage.evaluate(() => ({
    n: frames.length, refused, raw: localStorage.getItem(RECORD_KEY),
  }));
  check('malformed storage is distinct from missing storage',
    malformed.n === 0 && malformed.refused.includes('malformed') && malformed.raw === '{bad json');
  await malformedContext.close();

  const deniedContext = await browser.newContext();
  await deniedContext.addInitScript(() => {
    Storage.prototype.setItem = function () { throw new DOMException('denied', 'SecurityError'); };
  });
  const deniedPage = await open(deniedContext);
  const denied = await deniedPage.evaluate(() => ({
    n: frames.length, people: world.order.length, status: document.getElementById('stat').textContent,
  }));
  check('storage denial is explicit and never claims verified',
    denied.n === 0 && denied.people === 0 && denied.status.includes('storage is unavailable') &&
      !denied.status.includes('all verified'));
  await deniedContext.close();

  const legacyContext = await browser.newContext();
  const legacyPage = await open(legacyContext);
  const legacySeed = await legacyPage.evaluate(() => {
    const envelope = JSON.parse(localStorage.getItem(RECORD_KEY));
    localStorage.removeItem(RECORD_KEY);
    localStorage.setItem(LEGACY.frames, JSON.stringify(envelope.frames));
    localStorage.setItem(LEGACY.stream, JSON.stringify(envelope.stream_id));
    return { stream: envelope.stream_id, head: envelope.frames.at(-1).frame_hash };
  });
  await legacyPage.reload();
  await ready(legacyPage);
  const migrated = await legacyPage.evaluate(() => {
    const envelope = JSON.parse(localStorage.getItem(RECORD_KEY));
    return {
      version: envelope.version, stream: envelope.stream_id, head: envelope.frames.at(-1).frame_hash,
      legacy: [localStorage.getItem(LEGACY.frames), localStorage.getItem(LEGACY.stream)],
    };
  });
  check('legacy state migrates atomically without changing history',
    migrated.version === 1 && migrated.stream === legacySeed.stream && migrated.head === legacySeed.head &&
      migrated.legacy.every(value => value === null));
  await legacyContext.close();

  const mobileContext = await browser.newContext({ viewport: { width: 375, height: 667 } });
  const mobilePage = await open(mobileContext);
  const mobile = await mobilePage.evaluate(() => {
    const ids = ['live', 'replay', 'fork', 'cam', 'rec', 'export', 'reset', 'msg', 'send', 'scrub'];
    const rect = element => {
      const box = element.getBoundingClientRect();
      return { x: box.x, y: box.y, right: box.right, bottom: box.bottom };
    };
    const controls = Object.fromEntries(ids.map(id => [id, rect(document.getElementById(id))]));
    const view = rect(document.getElementById('view'));
    return {
      controls, view, width: innerWidth, height: innerHeight,
      scrollable: document.documentElement.scrollHeight > innerHeight && getComputedStyle(document.body).overflow === 'auto',
    };
  });
  check('375×667 layout keeps the room and composer usable',
    mobile.view.right - mobile.view.x >= 300 &&
      ['live', 'replay', 'fork', 'cam', 'rec', 'export', 'reset', 'msg', 'send'].every(id =>
        mobile.controls[id].x >= 0 && mobile.controls[id].right <= mobile.width &&
        mobile.controls[id].y >= 0 && mobile.controls[id].bottom <= mobile.height) &&
      mobile.scrollable);
  await mobileContext.close();

  const fallbackContext = await browser.newContext();
  await fallbackContext.addInitScript(() => {
    const originalSet = Storage.prototype.setItem;
    const originalRemove = Storage.prototype.removeItem;
    originalSet.call(localStorage, 'nexus3d.record.v1', 'fallback-sentinel');
    window.__storageWrites = 0;
    window.__storageRemoves = 0;
    Storage.prototype.setItem = function (...args) {
      if (this === localStorage) window.__storageWrites++;
      return originalSet.apply(this, args);
    };
    Storage.prototype.removeItem = function (...args) {
      if (this === localStorage) window.__storageRemoves++;
      return originalRemove.apply(this, args);
    };
  });
  const fallbackPage = await fallbackContext.newPage();
  watch(fallbackPage);
  await fallbackPage.goto(url + '?mask-three=1');
  await ready(fallbackPage);
  const fallback = await fallbackPage.evaluate(() => ({
    marker: window.__nexusFallback,
    status: document.getElementById('stat').textContent,
    disabled: ['live', 'replay', 'fork', 'cam', 'rec', 'export', 'reset', 'msg', 'send', 'scrub']
      .every(id => document.getElementById(id).disabled),
    stored: localStorage.getItem('nexus3d.record.v1'),
    writes: window.__storageWrites,
    removes: window.__storageRemoves,
    canvas: !!document.querySelector('canvas'),
  }));
  check('missing THREE uses a read-only no-storage fallback',
    fallback.marker === 'three-unavailable' && fallback.status.includes('3D engine unavailable') &&
      fallback.disabled && fallback.stored === 'fallback-sentinel' &&
      fallback.writes === 0 && fallback.removes === 0 && !fallback.canvas);
  await fallbackContext.close();

  const tabContext = await browser.newContext();
  const tabPage = await open(tabContext);
  const tabOrder = [];
  for (let i = 0; i < 10; i++) {
    await tabPage.keyboard.press('Tab');
    tabOrder.push(await tabPage.evaluate(() => document.activeElement.id));
  }
  check('all controls are keyboard reachable in visual order',
    JSON.stringify(tabOrder) === JSON.stringify(['live', 'replay', 'fork', 'cam', 'rec', 'export', 'reset', 'msg', 'send', 'scrub']),
    tabOrder.join(' → '));
  await tabContext.close();

  check('runtime emitted no page errors', pageErrors.length === 0, pageErrors.join('; '));
} catch (error) {
  bad++;
  console.error('* FATAL ', error);
} finally {
  await browser.close();
  await new Promise(resolve => server.close(resolve));
}

console.log(`\n${bad ? 'NOT READY' : 'READY'} — ${checks - bad}/${checks} checks passed`);
process.exit(bad ? 1 : 0);

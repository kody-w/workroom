/* heistcheck.mjs — adversarial Chromium acceptance gate for DOGG Heist. */
import { chromium } from 'playwright';
import { createHash } from 'node:crypto';
import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { dirname, extname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = dirname(fileURLToPath(import.meta.url));
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8' };
const mutations = {
  'second-authority': (source, file) => file === 'heist3d.html'
    ? source.replace('</main>', '<iframe src="dogg-heist.html" hidden title="mutant authority"></iframe></main>')
    : source,
  'static-movers': (source, file) => file === 'heist3d.html'
    ? source.replace('function syncMovers(s) {', `function syncMovers(s) {
        if (!moverMeshes.size) {
          for (const a of s.agents) {
            const p = P(a.x, a.y);
            const body = mover('agent:' + a.id + ':body', GEO.body, MAT.agents[a.id],
              { kind:'agent', entityId:a.id, part:'body' });
            body.position.set(p.x, .5, p.z);
          }
        }
        return;`)
    : source,
  'bypass-verifier': (source, file) => file === 'heist3d.html'
    ? source.replace(`const data = api.validateExport(raw);
    const authorityRaw = api.exportState();
    if (raw !== authorityRaw) {
      throw new Error('candidate is not the authority\\'s current verified export');
    }`, 'const data = JSON.parse(raw).data;')
    : source,
  'callback-clock': (source, file) => file === 'dogg-heist.html'
    ? source.replace('timerId = window.setInterval(runClock, Math.min(250, Math.max(50, speedMs)));',
      'timerId = window.setInterval(() => advanceOneTick(), speedMs);')
    : source,
  'rebuild-movers': (source, file) => file === 'heist3d.html'
    ? source.replace('function syncMovers(s) {', 'function syncMovers(s) { clear(movers); moverMeshes.clear();')
    : source,
  'desktop-only': (source, file) => file === 'heist3d.html'
    ? source.replace('@media (max-width:700px){', '@media (max-width:1px){')
    : source,
  'leaking-recorder': (source, file) => file === 'heist3d.html'
    ? source.replaceAll('stopRecordStream();', '')
    : source,
  'unguarded-writes': (source, file) => file === 'dogg-heist.html'
    ? source.replace('return storageAvailable && writerLockHeld && lockDecisionMade && !authorityStale;',
      'return storageAvailable && lockDecisionMade && !authorityStale;')
    : source,
  'false-video-hash': (source, file) => file === 'heist3d.html'
    ? source.replace(/(\n\s*)sha256,\n/, "$1sha256: '0'.repeat(64),\n")
    : source,
  'missing-record-anchor': (source, file) => file === 'heist3d.html'
    ? source.replace('recordStartHash = head?.hash || null;', "recordStartHash = 'f'.repeat(64);")
    : source
};

function requestedFile(url) {
  const pathname = decodeURIComponent(new URL(url, 'http://local').pathname);
  const match = /^\/__mut\/([^/]+)\/(.*)$/.exec(pathname);
  return { mutation: match?.[1] || '', file: (match?.[2] || pathname.replace(/^\/+/, '') || 'heist3d.html') };
}

const server = createServer((request, response) => {
  try {
    const { mutation, file } = requestedFile(request.url);
    const path = resolve(ROOT, file);
    if (path !== ROOT && !path.startsWith(ROOT + sep)) throw new Error('outside root');
    let body = readFileSync(path);
    if (mutations[mutation] && extname(file) === '.html') {
      body = Buffer.from(mutations[mutation](body.toString(), file));
    }
    response.writeHead(200, { 'content-type': MIME[extname(file)] || 'application/octet-stream' });
    response.end(body);
  } catch {
    response.writeHead(404);
    response.end('not found');
  }
});
await new Promise((done) => server.listen(0, '127.0.0.1', done));
const BASE = `http://127.0.0.1:${server.address().port}/`;

let failures = 0;
const results = [];
function check(name, pass, detail = '') {
  const ok = Boolean(pass);
  results.push({ name, ok, detail });
  if (!ok) failures += 1;
  console.log(`${ok ? ' PASS' : '*FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
}

const stableStringify = (value) => {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(',')}}`;
};
const digest = (value) => createHash('sha256').update(stableStringify(value)).digest('hex');
const frameMaterial = (frame) => ({
  schema: frame.schema,
  kind: frame.kind,
  tick: frame.tick,
  branchId: frame.branchId,
  parentHash: frame.parentHash,
  state: frame.state,
  events: frame.events
});
const pathFor = (file, mutation = '') => mutation ? `__mut/${mutation}/${file}` : file;

const browser = await chromium.launch();
console.log(` Chromium ${await browser.version()} · root ${ROOT}`);

async function open(file, options = {}) {
  const context = await browser.newContext({ viewport: options.viewport || { width: 1440, height: 900 } });
  if (options.noLocks) {
    await context.addInitScript(() => {
      Object.defineProperty(navigator, 'locks', { configurable: true, value: undefined });
    });
  }
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  if (options.noThree) await page.route('**/vendor/three-r128.min.js', (route) => route.abort());
  await page.goto(BASE + pathFor(file, options.mutation), { waitUntil: 'load' });
  return { context, page, errors };
}

async function waitFor3d(page) {
  await page.waitForFunction(() => {
    const state = window.__heist3d?.state();
    return state?.headHash && state.authority?.lockDecisionMade;
  }, null, { timeout: 15000 });
}

async function settle(page, milliseconds = 500) {
  await page.waitForTimeout(milliseconds);
  await page.evaluate(() => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done))));
}

function renderedAgentsAgree(snapshot) {
  return snapshot.frame.state.agents
    .filter((agent) => agent.status === 'active')
    .every((agent) => {
      const mesh = snapshot.movers.find((item) => item.key === `agent:${agent.id}:body`);
      return mesh && Math.abs(mesh.x - (agent.x - 8.5)) < 0.02 && Math.abs(mesh.z - (agent.y - 5.5)) < 0.02;
    });
}

function renderedTilesAgree(snapshot) {
  const tiles = snapshot.frame.state.facility.tiles;
  return snapshot.tiles.length === tiles.flat().length && snapshot.tiles.every((mesh) =>
    mesh.tile === tiles[mesh.gridY][mesh.gridX]
    && Math.abs(mesh.x - (mesh.gridX - 8.5)) < 0.001
    && Math.abs(mesh.z - (mesh.gridY - 5.5)) < 0.001);
}

async function recordAndCapture(page, cycles = 1, duringFirstRecording = null) {
  await page.evaluate(() => {
    window.__recordStreams = [];
    window.__urls = { made: 0, revoked: 0 };
    window.__downloadBlobs = new Map();
    window.__downloads = [];
    const capture = HTMLCanvasElement.prototype.captureStream;
    HTMLCanvasElement.prototype.captureStream = function (...args) {
      const stream = capture.apply(this, args);
      window.__recordStreams.push(stream);
      return stream;
    };
    const make = URL.createObjectURL.bind(URL);
    const revoke = URL.revokeObjectURL.bind(URL);
    URL.createObjectURL = (blob) => {
      const url = make(blob);
      window.__urls.made += 1;
      window.__downloadBlobs.set(url, blob);
      return url;
    };
    URL.revokeObjectURL = (url) => {
      window.__urls.revoked += 1;
      return revoke(url);
    };
    HTMLAnchorElement.prototype.click = function () {
      window.__downloads.push({ name: this.download, blob: window.__downloadBlobs.get(this.href) });
    };
  });
  let duringResult = null;
  for (let index = 0; index < cycles; index += 1) {
    await page.click('#rec');
    if (index === 0 && duringFirstRecording) duringResult = await duringFirstRecording(page);
    await page.waitForTimeout(350);
    await page.click('#rec');
    await page.waitForFunction(() => !document.querySelector('#rec').disabled
      && document.querySelector('#rec').getAttribute('aria-pressed') === 'false');
  }
  await page.waitForTimeout(1700);
  const captured = await page.evaluate(async () => {
    const video = window.__downloads.find((item) => item.name.endsWith('.webm'));
    const sidecar = window.__downloads.find((item) => item.name.endsWith('.frames.json'));
    let base64 = null;
    if (video?.blob) {
      const bytes = new Uint8Array(await video.blob.arrayBuffer());
      let binary = '';
      for (let offset = 0; offset < bytes.length; offset += 0x8000) {
        binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
      }
      base64 = btoa(binary);
    }
    return {
      videoName: video?.name || null,
      videoBase64: base64,
      sidecar: sidecar?.blob ? JSON.parse(await sidecar.blob.text()) : null,
      tracks: window.__recordStreams.flatMap((stream) => stream.getTracks()).map((track) => track.readyState),
      urls: window.__urls,
      status: document.querySelector('#stat').textContent
    };
  });
  const bytes = captured.videoBase64 ? Buffer.from(captured.videoBase64, 'base64') : Buffer.alloc(0);
  return {
    ...captured,
    duringResult,
    bytes,
    independentSha256: createHash('sha256').update(bytes).digest('hex')
  };
}

async function exerciseRecordingGuards(page) {
  const initial = await page.evaluate(() => {
    const game = document.querySelector('#g').contentWindow.__doggHeist;
    return { raw: game.exportState(), state: game.state() };
  });
  const resetAttempts = await page.evaluate(() => {
    const iframe = document.querySelector('#g');
    const game = iframe.contentWindow.__doggHeist;
    const authorityDocument = iframe.contentDocument;
    for (const id of ['newseed', 'replay']) {
      document.getElementById(id).dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    }
    for (const id of ['restart-button', 'replay-button']) {
      authorityDocument.getElementById(id).dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    }
    authorityDocument.dispatchEvent(new KeyboardEvent('keydown', { key: 'r', bubbles: true, cancelable: true }));
    authorityDocument.dispatchEvent(new KeyboardEvent('keydown', { key: 'R', shiftKey: true, bubbles: true, cancelable: true }));
    const restartResult = game.restart('RECORDING-MUTANT');
    const importResult = game.importState(game.exportState());
    return {
      restartTick: restartResult.tick,
      importResult,
      raw: game.exportState(),
      state: game.state(),
      status: authorityDocument.getElementById('status-live').textContent,
      newSeedDisabled: document.getElementById('newseed').disabled,
      replayDisabled: document.getElementById('replay').disabled,
      importDisabled: authorityDocument.getElementById('import-button').disabled
    };
  });

  await page.locator('#timeline').evaluate((input) => {
    input.value = '0';
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await page.waitForFunction(() => window.__heist3d.state().selectedIndex === 0);
  await page.waitForFunction(() => document.querySelector('#fork').disabled
    && document.querySelector('#g').contentDocument.querySelector('#fork-button').disabled);
  const beforeFork = await page.evaluate(() => {
    const game = document.querySelector('#g').contentWindow.__doggHeist;
    return { raw: game.exportState(), state: game.state() };
  });
  const forkAttempts = await page.evaluate(() => {
    const iframe = document.querySelector('#g');
    const game = iframe.contentWindow.__doggHeist;
    const authorityDocument = iframe.contentDocument;
    document.getElementById('fork').dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    authorityDocument.getElementById('fork-button').dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    authorityDocument.dispatchEvent(new KeyboardEvent('keydown', { key: 'f', bubbles: true, cancelable: true }));
    const apiResult = game.fork();
    return {
      apiResult,
      raw: game.exportState(),
      state: game.state(),
      status: authorityDocument.getElementById('status-live').textContent,
      forkDisabled: document.getElementById('fork').disabled
        && authorityDocument.getElementById('fork-button').disabled
    };
  });

  await page.click('#live');
  await page.waitForFunction(() => !window.__heist3d.state().authority.viewingHistory);
  const beforeStep = await page.evaluate(() => document.querySelector('#g').contentWindow.__doggHeist.state());
  await page.click('#step');
  await page.waitForFunction((hash) => window.__heist3d.state().headHash !== hash, beforeStep.headHash);
  const afterStep = await page.evaluate(() => document.querySelector('#g').contentWindow.__doggHeist.state());
  return {
    resetsBlocked: resetAttempts.raw === initial.raw
      && resetAttempts.state.headHash === initial.state.headHash
      && resetAttempts.state.seed === initial.state.seed
      && resetAttempts.restartTick === initial.state.tick
      && resetAttempts.importResult === false
      && resetAttempts.newSeedDisabled && resetAttempts.replayDisabled && resetAttempts.importDisabled
      && /Import refused while recording/.test(resetAttempts.status),
    forkBlocked: forkAttempts.apiResult === false && forkAttempts.raw === beforeFork.raw
      && forkAttempts.state.headHash === beforeFork.state.headHash
      && forkAttempts.state.frameCount === beforeFork.state.frameCount
      && forkAttempts.state.viewingHistory && forkAttempts.forkDisabled
      && /Fork refused while recording/.test(forkAttempts.status),
    stepAllowed: afterStep.frameCount === beforeStep.frameCount + 1 && afterStep.tick === beforeStep.tick + 1,
    detail: {
      resetStatus: resetAttempts.status,
      forkStatus: forkAttempts.status,
      beforeStep: beforeStep.headHash,
      afterStep: afterStep.headHash
    }
  };
}

async function healthy3d() {
  const { context, page, errors } = await open('heist3d.html');
  await waitFor3d(page);
  const initial = await page.evaluate(() => ({
    authorityCount: document.querySelectorAll('iframe[src$="dogg-heist.html"]').length,
    authority: document.querySelector('#g').contentWindow.__doggHeist.state(),
    shell: window.__heist3d.state(),
    playLabel: document.querySelector('#play').textContent.trim(),
    playPressed: document.querySelector('#play').getAttribute('aria-pressed')
  }));
  check('one writable game authority', initial.authorityCount === 1, `${initial.authorityCount} iframe(s)`);
  check('startup is deterministic and paused', initial.authority.tick === 0 && !initial.authority.running,
    `tick ${initial.authority.tick}, running ${initial.authority.running}`);
  check('single-tab authority owns the writer lock', initial.authority.writeAccess && initial.authority.writerLockHeld);
  check('play label reflects paused state', initial.playLabel.includes('Play') && initial.playPressed === 'false', initial.playLabel);
  check('static meshes exactly match sealed tiles', renderedTilesAgree(initial.shell),
    `${initial.shell.tiles.length} meshes / ${initial.shell.frame.state.facility.tiles.flat().length} tiles`);

  await page.evaluate(() => {
    const doc = document.querySelector('#g').contentDocument;
    window.__controlClicks = {};
    for (const id of ['play-toggle', 'step-button', 'restart-button', 'replay-button', 'fork-button', 'live-button', 'export-button']) {
      window.__controlClicks[id] = 0;
      doc.getElementById(id).addEventListener('click', () => { window.__controlClicks[id] += 1; });
    }
  });

  const before = initial.shell;
  await page.click('#step');
  await page.waitForFunction((hash) => window.__heist3d.state().headHash !== hash, before.headHash);
  await settle(page);
  const afterStep = await page.evaluate(() => window.__heist3d.state());
  check('Step uses the authority control', await page.evaluate(() => __controlClicks['step-button'] === 1));
  check('rendered agent meshes follow the selected frame', renderedAgentsAgree(afterStep));
  check('a rendered mover actually changed position',
    before.movers.some((old) => {
      const next = afterStep.movers.find((item) => item.key === old.key);
      return next && (Math.abs(next.x - old.x) > 0.02 || Math.abs(next.z - old.z) > 0.02);
    }));

  await page.click('#play');
  await page.waitForFunction(() => document.querySelector('#play').getAttribute('aria-pressed') === 'true');
  check('Play uses the authority control and synchronizes', await page.evaluate(() =>
    __controlClicks['play-toggle'] === 1 && document.querySelector('#play').textContent.includes('Pause')));
  await page.click('#play');
  await page.waitForFunction(() => document.querySelector('#play').getAttribute('aria-pressed') === 'false');

  const seed = await page.evaluate(() => document.querySelector('#g').contentWindow.__doggHeist.state().seed);
  await page.evaluate(() => document.querySelector('#g').contentWindow.__doggHeist.step(5));
  await page.waitForFunction(() => window.__heist3d.state().frameCount >= 6);
  await page.click('#replay');
  await page.waitForFunction((seed) => {
    const state = document.querySelector('#g').contentWindow.__doggHeist.state();
    return state.seed === seed && state.tick === 0;
  }, seed);
  check('Replay preserves the seed and resets tick zero', await page.evaluate((seed) => {
    const state = document.querySelector('#g').contentWindow.__doggHeist.state();
    return __controlClicks['replay-button'] === 1 && state.seed === seed && state.tick === 0;
  }, seed));
  await page.click('#newseed');
  await page.waitForFunction((seed) => document.querySelector('#g').contentWindow.__doggHeist.state().seed !== seed, seed);
  await page.waitForFunction(() => window.__heist3d.state().frameCount === 1);
  const restarted = await page.evaluate(() => ({
    clicks: __controlClicks['restart-button'],
    genesisEntries: [...document.querySelectorAll('#log .ev')].filter((node) => node.textContent.includes('DOGG genesis sealed')).length,
    tick: document.querySelector('#g').contentWindow.__doggHeist.state().tick
  }));
  check('New seed resets the run and its log', restarted.clicks === 1 && restarted.tick === 0 && restarted.genesisEntries === 1,
    `${restarted.genesisEntries} genesis entries`);

  await page.evaluate(() => document.querySelector('#g').contentWindow.__doggHeist.step(5));
  await page.waitForFunction(() => window.__heist3d.state().frameCount === 6);
  await page.locator('#timeline').evaluate((input) => {
    input.value = '2';
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await page.waitForFunction(() => window.__heist3d.state().selectedIndex === 2);
  await page.waitForFunction(() => document.querySelector('#step').disabled);
  const history = await page.evaluate(() => ({
    shell: __heist3d.state(),
    authority: document.querySelector('#g').contentWindow.__doggHeist.state(),
    stepDisabled: document.querySelector('#step').disabled
  }));
  check('timeline is a read-only projection of the authority selection',
    history.shell.frame.state.tick === 2 && history.authority.liveTick === 5 && history.authority.viewingHistory && history.stepDisabled);
  await page.click('#fork');
  await page.waitForFunction(() => !document.querySelector('#g').contentWindow.__doggHeist.state().viewingHistory);
  const forked = await page.evaluate(() => document.querySelector('#g').contentWindow.__doggHeist.state());
  check('Fork seals a verified live branch', forked.branchId.startsWith('B1-') && forked.tick === 2
    && forked.frameCount === 4 && await page.evaluate(() => document.querySelector('#g').contentWindow.__doggHeist.verifyChain()));

  await page.evaluate(() => {
    const win = document.querySelector('#g').contentWindow;
    win.__exportClicks = 0;
    win.document.querySelector('#export-button').addEventListener('click', () => { win.__exportClicks += 1; });
    win.HTMLAnchorElement.prototype.click = function () {};
  });
  await page.click('#export');
  check('Export routes through the authority control', await page.evaluate(() =>
    document.querySelector('#g').contentWindow.__exportClicks === 1));

  const healthyPng = await page.screenshot();
  check('healthy proof captured before negative cases',
    healthyPng.length > 10_000 && healthyPng[0] === 0x89 && healthyPng[1] === 0x50,
    `${healthyPng.length} bytes in memory`);

  const goodRaw = await page.evaluate(() => document.querySelector('#g').contentWindow.__doggHeist.exportState());
  const goodSnapshot = await page.evaluate(() => JSON.stringify(window.__heist3d.state()));
  async function reject(name, candidate, expected) {
    const result = await page.evaluate((raw) => {
      const accepted = window.__heist3d.ingestCandidate(raw);
      return { accepted, state: JSON.stringify(window.__heist3d.state()), error: document.querySelector('#stat').textContent };
    }, candidate);
    check(name, !result.accepted && result.state === goodSnapshot && result.error === `saved chain rejected: ${expected}`, result.error);
  }
  await reject('malformed JSON preserves the last good projection', '{bad json', 'JSON could not be parsed.');

  const checksumBad = JSON.parse(goodRaw);
  checksumBad.data.frames.at(-1).state.agents[0].x += 1;
  await reject('bad checksum preserves the last good projection', JSON.stringify(checksumBad),
    'Export checksum does not match. The file is corrupt or modified.');

  const linkBad = JSON.parse(goodRaw);
  linkBad.data.frames[1].parentHash = 'd'.repeat(64);
  linkBad.checksum = digest(linkBad.data);
  await reject('non-linking frame preserves the last good projection', JSON.stringify(linkBad),
    'Frame 1 does not point to its actual parent.');

  const hashBad = JSON.parse(goodRaw);
  hashBad.data.frames.at(-1).hash = 'a'.repeat(64);
  hashBad.checksum = digest(hashBad.data);
  await reject('bad frame hash preserves the last good projection', JSON.stringify(hashBad),
    `Frame ${hashBad.data.frames.length - 1} hash verification failed.`);

  const shapeBad = JSON.parse(goodRaw);
  const last = shapeBad.data.frames.at(-1);
  last.state.agents[0].id = 'intruder';
  last.hash = digest(frameMaterial(last));
  shapeBad.checksum = digest(shapeBad.data);
  await reject('invalid frame state preserves the last good projection', JSON.stringify(shapeBad),
    `Frame ${shapeBad.data.frames.length - 1} state contains unknown agent intruder.`);

  const alternateValid = JSON.parse(goodRaw);
  alternateValid.data.selectedAgentId = alternateValid.data.selectedAgentId === 'ghost' ? 'cipher' : 'ghost';
  alternateValid.checksum = digest(alternateValid.data);
  await reject('valid but non-authority export is never projected', JSON.stringify(alternateValid),
    'candidate is not the authority\'s current verified export');

  const idsBefore = await page.evaluate(() => __heist3d.state().movers.map((item) => item.uuid).sort());
  await page.evaluate(() => {
    window.__materialAllocations = 0;
    const Original = THREE.MeshStandardMaterial;
    THREE.MeshStandardMaterial = class extends Original {
      constructor(...args) { super(...args); window.__materialAllocations += 1; }
    };
  });
  await settle(page, 1200);
  const retained = await page.evaluate(() => ({
    ids: __heist3d.state().movers.map((item) => item.uuid).sort(),
    allocations: __materialAllocations
  }));
  check('mover meshes and materials are retained between frames',
    JSON.stringify(idsBefore) === JSON.stringify(retained.ids) && retained.allocations === 0,
    `${retained.ids.length} stable meshes, ${retained.allocations} material allocations`);

  const recording = await recordAndCapture(page, 3, exerciseRecordingGuards);
  check('recording blocks reset, replay, and import surfaces',
    recording.duringResult?.resetsBlocked, JSON.stringify(recording.duringResult?.detail || {}));
  check('recording blocks fork/truncation while preserving history',
    recording.duringResult?.forkBlocked, JSON.stringify(recording.duringResult?.detail || {}));
  check('recording still permits Step on the same chain',
    recording.duringResult?.stepAllowed, JSON.stringify(recording.duringResult?.detail || {}));
  check('recording releases tracks and object URLs',
    recording.tracks.every((state) => state === 'ended') && recording.urls.made === recording.urls.revoked,
    `${recording.tracks.join(', ')}; URLs ${recording.urls.made}/${recording.urls.revoked}`);
  const evidence = recording.sidecar;
  const exportFrames = evidence?.verifiedExport?.data?.frames || [];
  check('recording sidecar exactly attests the downloaded WebM',
    recording.bytes.length > 0 && evidence?.recording === recording.videoName
      && evidence.bytes === recording.bytes.length
      && evidence.sha256 === recording.independentSha256
      && /^[a-f0-9]{64}$/.test(evidence.startFrameHash)
      && /^[a-f0-9]{64}$/.test(evidence.endFrameHash)
      && exportFrames[evidence.startFrameIndex]?.hash === evidence.startFrameHash
      && exportFrames[evidence.endFrameIndex]?.hash === evidence.endFrameHash
      && digest(evidence.verifiedExport.data) === evidence.verifiedExport.checksum,
    `${recording.bytes.length} bytes · ${recording.independentSha256}`);

  await page.setViewportSize({ width: 375, height: 667 });
  await settle(page);
  const mobile = await page.evaluate(async () => {
    document.documentElement.style.scrollBehavior = 'auto';
    const controls = [...document.querySelectorAll('.controls button, .controls input')];
    const reachable = [];
    for (const control of controls) {
      control.scrollIntoView({ block: 'nearest', inline: 'center' });
      await new Promise((done) => requestAnimationFrame(done));
      const rect = control.getBoundingClientRect();
      const x = Math.max(0, Math.min(innerWidth - 1, rect.left + rect.width / 2));
      const y = Math.max(0, Math.min(innerHeight - 1, rect.top + rect.height / 2));
      const hit = document.elementFromPoint(x, y);
      reachable.push(hit === control || control.contains(hit));
    }
    const view = document.querySelector('#view').getBoundingClientRect();
    document.querySelector('#flatbtn').click();
    const flat = document.querySelector('#flat').getBoundingClientRect();
    const authorityWindow = document.querySelector('#g').contentWindow;
    authorityWindow.document.documentElement.style.scrollBehavior = 'auto';
    const authorityReachable = [];
    for (const control of authorityWindow.document.querySelectorAll('.control-deck button, .control-deck select, #timeline')) {
      control.scrollIntoView({ block: 'center', inline: 'center' });
      await new Promise((done) => authorityWindow.requestAnimationFrame(done));
      const rect = control.getBoundingClientRect();
      const x = Math.max(0, Math.min(authorityWindow.innerWidth - 1, rect.left + rect.width / 2));
      const y = Math.max(0, Math.min(authorityWindow.innerHeight - 1, rect.top + rect.height / 2));
      const hit = authorityWindow.document.elementFromPoint(x, y);
      authorityReachable.push(hit === control || control.contains(hit));
    }
    return {
      view: { width: view.width, height: view.height },
      flat: { width: flat.width, height: flat.height, left: flat.left, right: flat.right },
      reachable,
      authorityReachable
    };
  });
  check('375×667 keeps the 3D world and controls usable',
    mobile.view.width >= 350 && mobile.view.height >= 290 && mobile.reachable.every(Boolean),
    `${Math.round(mobile.view.width)}×${Math.round(mobile.view.height)}, ${mobile.reachable.filter(Boolean).length}/${mobile.reachable.length} controls`);
  check('375×667 flat authority stays inside the viewport',
    mobile.flat.width >= 330 && mobile.flat.left >= 0 && mobile.flat.right <= 375
      && mobile.authorityReachable.every(Boolean),
    `${Math.round(mobile.flat.left)}..${Math.round(mobile.flat.right)}; ${mobile.authorityReachable.filter(Boolean).length}/${mobile.authorityReachable.length} authority controls`);
  check('baseline emitted no page errors', errors.length === 0, [...new Set(errors)].join(' | '));
  await context.close();
}

async function measureClock(mutation = '', rate = 1, stall = 0) {
  const { context, page } = await open('dogg-heist.html', { mutation });
  await page.waitForFunction(() => {
    const state = window.__doggHeist?.state();
    return window.__doggHeist?.ready === true && state?.lockDecisionMade && state?.writeAccess;
  });
  const cdp = await context.newCDPSession(page);
  await cdp.send('Emulation.setCPUThrottlingRate', { rate });
  await page.evaluate(() => {
    __doggHeist.restart('DOGG-BRAVO-17');
    __doggHeist.setSpeed(180);
    window.__clockStarted = performance.now();
    __doggHeist.play();
  });
  const started = Date.now();
  if (stall) {
    await page.waitForTimeout(700);
    await page.evaluate((duration) => {
      const start = performance.now();
      while (performance.now() - start < duration) {}
    }, stall);
    await new Promise((done) => setTimeout(done, Math.max(0, 3000 - (Date.now() - started))));
  } else {
    await new Promise((done) => setTimeout(done, 3000));
  }
  const measured = await page.evaluate(() => {
    const elapsed = performance.now() - window.__clockStarted;
    __doggHeist.pause();
    const ticks = __doggHeist.state().tick;
    return { elapsed, ticks };
  });
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: 1 });
  await cdp.detach();
  await context.close();
  return { elapsed: measured.elapsed, ticks: measured.ticks, ideal: measured.elapsed / 180,
    ratio: measured.ticks / (measured.elapsed / 180) };
}

async function timingChecks() {
  const normal = await measureClock('', 1);
  const throttled = await measureClock('', 20);
  const stalled = await measureClock('', 1, 1500);
  check('clock follows wall time normally', normal.ratio >= 0.82 && normal.ratio <= 1.18, JSON.stringify(normal));
  check('clock catches up under 20× CPU throttle', throttled.ratio >= 0.75 && throttled.ratio <= 1.25, JSON.stringify(throttled));
  check('clock catches up after a 1.5s stall', stalled.ratio >= 0.82 && stalled.ratio <= 1.18, JSON.stringify(stalled));
}

async function featureDetection() {
  const { context, page, errors } = await open('heist3d.html', { noThree: true, viewport: { width: 375, height: 667 } });
  await page.waitForSelector('.three-failure');
  const result = await page.evaluate(() => ({
    text: document.querySelector('.three-failure').textContent,
    authorities: document.querySelectorAll('iframe[src$="dogg-heist.html"]').length,
    visible: getComputedStyle(document.querySelector('#flat')).display !== 'none'
  }));
  check('missing Three.js produces an explicit usable fallback',
    /could not load/.test(result.text) && result.authorities === 1 && result.visible && errors.length === 0);
  await context.close();
}

async function recorderSetupFailures() {
  for (const kind of ['captureStream', 'constructor', 'start']) {
    const { context, page, errors } = await open('heist3d.html');
    await waitFor3d(page);
    await page.evaluate((failureKind) => {
      const canvas = document.querySelector('#view canvas');
      const OriginalRecorder = window.MediaRecorder;
      window.__recorderSetupOriginals = {
        canvas,
        captureWasOwn: Object.hasOwn(canvas, 'captureStream'),
        captureStream: canvas.captureStream,
        MediaRecorder: OriginalRecorder,
        start: OriginalRecorder.prototype.start
      };
      window.__setupFailureTracks = [];
      canvas.captureStream = function (...args) {
        if (failureKind === 'captureStream') throw new Error('injected captureStream failure');
        const stream = window.__recorderSetupOriginals.captureStream.apply(this, args);
        window.__setupFailureTracks.push(...stream.getTracks());
        return stream;
      };
      if (failureKind === 'constructor') {
        window.MediaRecorder = class {
          static isTypeSupported(type) { return OriginalRecorder.isTypeSupported(type); }
          constructor() { throw new Error('injected constructor failure'); }
        };
      } else if (failureKind === 'start') {
        OriginalRecorder.prototype.start = function () { throw new Error('injected start failure'); };
      }
    }, kind);
    await page.click('#rec');
    await page.waitForFunction(() => document.querySelector('#stat').textContent.startsWith('recording setup failed:'));
    const failed = await page.evaluate(() => {
      const state = window.__heist3d.state();
      const authorityDocument = document.querySelector('#g').contentDocument;
      return {
        state: state.recording,
        tracks: window.__setupFailureTracks.map((track) => track.readyState),
        status: document.querySelector('#stat').textContent,
        recText: document.querySelector('#rec').textContent.trim(),
        recPressed: document.querySelector('#rec').getAttribute('aria-pressed'),
        recDisabled: document.querySelector('#rec').disabled,
        controlsRestored: !document.querySelector('#newseed').disabled
          && !document.querySelector('#replay').disabled
          && !authorityDocument.querySelector('#restart-button').disabled
          && !authorityDocument.querySelector('#replay-button').disabled
          && !authorityDocument.querySelector('#import-button').disabled
      };
    });
    check(`recorder ${kind} failure rolls back atomically`,
      !failed.state.active && !failed.state.hasRecorder && !failed.state.hasStream
        && !failed.state.hasChunks && failed.state.chunkCount === 0 && failed.state.startedAt === 0
        && failed.state.startFrameHash === null && failed.state.startFrameIndex === null
        && failed.tracks.every((state) => state === 'ended')
        && failed.controlsRestored && failed.recText === '● Record canvas'
        && failed.recPressed === 'false' && !failed.recDisabled
        && failed.status === `recording setup failed: injected ${kind} failure`
        && errors.length === 0,
      `${failed.status}; tracks ${failed.tracks.join(',') || 'none'}`);

    await page.evaluate(() => {
      const originals = window.__recorderSetupOriginals;
      if (originals.captureWasOwn) originals.canvas.captureStream = originals.captureStream;
      else delete originals.canvas.captureStream;
      window.MediaRecorder = originals.MediaRecorder;
      originals.MediaRecorder.prototype.start = originals.start;
    });
    const recovered = await recordAndCapture(page);
    check(`normal recording recovers after ${kind} failure`,
      recovered.bytes.length > 0 && recovered.sidecar?.bytes === recovered.bytes.length
        && recovered.sidecar?.sha256 === recovered.independentSha256
        && recovered.tracks.every((state) => state === 'ended'),
      `${recovered.bytes.length} bytes`);
    await context.close();
  }
}

async function crossTabSynchronization() {
  const context = await browser.newContext({ viewport: { width: 1200, height: 760 } });
  const tabB = await context.newPage();
  const tabA = await context.newPage();
  const errors = [];
  tabB.on('pageerror', (error) => errors.push('B: ' + error.message));
  tabA.on('pageerror', (error) => errors.push('A: ' + error.message));
  await tabB.goto(BASE + 'heist3d.html');
  await tabB.waitForFunction(() => {
    const state = window.__heist3d?.state().authority;
    return state?.lockDecisionMade && state.writeAccess;
  });
  await tabA.goto(BASE + 'heist3d.html');
  await tabA.waitForFunction(() => {
    const state = window.__heist3d?.state().authority;
    return state?.lockDecisionMade && !state.writeAccess;
  });

  const owners = await Promise.all([tabB, tabA].map((page) => page.evaluate(() =>
    window.__heist3d.state().authority.writeAccess)));
  check('two tabs elect exactly one writable authority', owners.filter(Boolean).length === 1,
    `B=${owners[0]}, A=${owners[1]}`);

  const beforeB = await tabB.evaluate(() => window.__heist3d.state().headHash);
  await tabB.click('#step');
  await tabB.waitForFunction((hash) => window.__heist3d.state().headHash !== hash, beforeB);
  const bHead = await tabB.evaluate(() => window.__heist3d.state().headHash);
  await tabA.waitForFunction((hash) => {
    const state = window.__heist3d.state();
    return state.headHash === hash && state.authority.headHash === hash;
  }, bHead);
  const persistedAfterB = await tabB.evaluate(() => {
    const raw = localStorage.getItem('dogg-heist-save-v1');
    const data = document.querySelector('#g').contentWindow.__doggHeist.validateExport(raw);
    return { raw, head: data.frames.at(-1).hash };
  });
  check('tab A adopts tab B only through its authority',
    persistedAfterB.head === bHead && await tabA.evaluate((hash) => {
      const state = window.__heist3d.state();
      return state.headHash === hash && state.authority.headHash === hash
        && !state.authority.writeAccess && !state.authority.authorityStale;
    }, persistedAfterB.head), persistedAfterB.head.slice(0, 16));

  const refused = await tabA.evaluate(() => {
    const game = document.querySelector('#g').contentWindow.__doggHeist;
    const before = game.state();
    const returned = game.step();
    return {
      beforeTick: before.tick,
      returnedTick: returned.tick,
      afterTick: game.state().tick,
      status: document.querySelector('#g').contentDocument.querySelector('#status-live').textContent,
      shellDisabled: document.querySelector('#step').disabled,
      raw: localStorage.getItem('dogg-heist-save-v1')
    };
  });
  check('stale/non-owner Step is refused without false success',
    refused.beforeTick === refused.returnedTick && refused.returnedTick === refused.afterTick
      && refused.shellDisabled && refused.status === 'Step refused: another tab owns the writer lock.'
      && refused.raw === persistedAfterB.raw, refused.status);

  const simultaneousStart = persistedAfterB.head;
  const [writerResult, readerResult] = await Promise.all([
    tabB.evaluate(() => document.querySelector('#g').contentWindow.__doggHeist.step()),
    tabA.evaluate(() => {
      const game = document.querySelector('#g').contentWindow.__doggHeist;
      const before = game.state().tick;
      const result = game.step();
      return { before, returned: result.tick };
    })
  ]);
  await tabB.waitForFunction((hash) => window.__heist3d.state().headHash !== hash, simultaneousStart);
  const simultaneousHead = await tabB.evaluate(() => window.__heist3d.state().headHash);
  await tabA.waitForFunction((hash) => window.__heist3d.state().headHash === hash, simultaneousHead);
  const exact = await tabB.evaluate(() => {
    const raw = localStorage.getItem('dogg-heist-save-v1');
    const data = document.querySelector('#g').contentWindow.__doggHeist.validateExport(raw);
    return { raw, head: data.frames.at(-1).hash, tick: data.frames.at(-1).tick };
  });
  check('simultaneous actions commit exactly one lineage',
    exact.head === simultaneousHead && writerResult.headHash === simultaneousHead
      && readerResult.before === readerResult.returned && writerResult.tick === exact.tick
      && exact.tick === readerResult.before + 1
      && await tabA.evaluate((hash) => {
        const state = window.__heist3d.state();
        return state.headHash === hash && state.authority.headHash === hash;
      }, exact.head),
    `persisted ${exact.head.slice(0, 16)} tick ${exact.tick}`);

  const external = JSON.parse(exact.raw);
  external.data.selectedAgentId = external.data.selectedAgentId === 'ghost' ? 'cipher' : 'ghost';
  external.checksum = digest(external.data);
  const externalRaw = JSON.stringify(external);
  await tabA.evaluate((raw) => localStorage.setItem('dogg-heist-save-v1', raw), externalRaw);
  await tabB.waitForFunction(() =>
    window.__heist3d.state().authority.authorityStale && document.querySelector('#step').disabled);
  const stale = await tabB.evaluate(() => {
    const shell = window.__heist3d.state();
    const game = document.querySelector('#g').contentWindow.__doggHeist;
    const before = game.state().tick;
    const result = game.step();
    return {
      shellHead: shell.headHash,
      authorityHead: shell.authority.headHash,
      stale: shell.authority.authorityStale,
      writeAccess: shell.authority.writeAccess,
      before,
      after: result.tick,
      persisted: localStorage.getItem('dogg-heist-save-v1'),
      disabled: document.querySelector('#step').disabled,
      shellStatus: document.querySelector('#stat').textContent
    };
  });
  check('foreign durable change stales the writer and cannot be overwritten',
    stale.stale && !stale.writeAccess && stale.disabled && stale.before === stale.after
      && stale.shellHead === stale.authorityHead && stale.persisted === externalRaw
      && /authority stale: .*reload required/.test(stale.shellStatus),
    `head ${stale.shellHead.slice(0, 16)}`);
  check('two-tab scenario emitted no page errors', errors.length === 0, errors.join(' | '));
  await context.close();
}

async function lockFallback() {
  const { context, page, errors } = await open('dogg-heist.html', { noLocks: true });
  await page.waitForFunction(() => window.__doggHeist?.state().lockDecisionMade);
  const result = await page.evaluate(() => {
    const before = __doggHeist.state();
    const returned = __doggHeist.step();
    return {
      before,
      returned,
      after: __doggHeist.state(),
      stored: localStorage.getItem('dogg-heist-save-v1'),
      disabled: document.querySelector('#step-button').disabled
    };
  });
  check('missing Web Locks fails closed read-only',
    !result.before.writeAccess && result.disabled && result.before.tick === result.returned.tick
      && result.returned.tick === result.after.tick && result.stored === null && errors.length === 0);
  await context.close();
}

async function mutationCheck(name, observe) {
  let survived = false;
  let detail = '';
  try {
    const result = await observe();
    survived = result.pass;
    detail = result.detail || '';
  } catch (error) {
    detail = error.message;
  }
  check(`mutation is caught: ${name}`, !survived, detail || (survived ? 'unexpectedly green' : 'red as expected'));
}

async function mutationChecks() {
  await mutationCheck('write guard removed', async () => {
    const context = await browser.newContext();
    const first = await context.newPage();
    const second = await context.newPage();
    await first.goto(BASE + pathFor('heist3d.html', 'unguarded-writes'));
    await first.waitForFunction(() => window.__heist3d?.state().authority?.lockDecisionMade);
    await second.goto(BASE + pathFor('heist3d.html', 'unguarded-writes'));
    await second.waitForFunction(() => window.__heist3d?.state().authority?.lockDecisionMade);
    const writers = await Promise.all([first, second].map((page) =>
      page.evaluate(() => window.__heist3d.state().authority.writeAccess)));
    await context.close();
    return { pass: writers.filter(Boolean).length === 1, detail: `${writers.filter(Boolean).length} writers` };
  });
  await mutationCheck('second writable authority', async () => {
    const { context, page } = await open('heist3d.html', { mutation: 'second-authority' });
    await waitFor3d(page);
    const count = await page.locator('iframe[src$="dogg-heist.html"]').count();
    await context.close();
    return { pass: count === 1, detail: `${count} authorities` };
  });
  await mutationCheck('static rendered movers', async () => {
    const { context, page } = await open('heist3d.html', { mutation: 'static-movers' });
    await waitFor3d(page);
    await page.click('#step');
    await settle(page);
    const snapshot = await page.evaluate(() => __heist3d.state());
    await context.close();
    return { pass: renderedAgentsAgree(snapshot), detail: 'rendered/frame position comparison' };
  });
  await mutationCheck('bypassed candidate verifier', async () => {
    const { context, page } = await open('heist3d.html', { mutation: 'bypass-verifier' });
    await waitFor3d(page);
    const pass = await page.evaluate(() => {
      const before = JSON.stringify(__heist3d.state());
      const payload = JSON.parse(document.querySelector('#g').contentWindow.__doggHeist.exportState());
      payload.data.frames.at(-1).state.agents[0].x += 1;
      __heist3d.ingestCandidate(JSON.stringify(payload));
      return JSON.stringify(__heist3d.state()) === before;
    });
    await context.close();
    return { pass, detail: 'bad checksum must preserve head' };
  });
  await mutationCheck('callback-count clock', async () => {
    const measured = await measureClock('callback-clock', 1, 1500);
    return { pass: measured.ratio >= 0.82 && measured.ratio <= 1.18, detail: JSON.stringify(measured) };
  });
  await mutationCheck('per-frame mover rebuild', async () => {
    const { context, page } = await open('heist3d.html', { mutation: 'rebuild-movers' });
    await waitFor3d(page);
    const before = await page.evaluate(() => __heist3d.state().movers.map((item) => item.uuid).sort());
    await settle(page, 400);
    const after = await page.evaluate(() => __heist3d.state().movers.map((item) => item.uuid).sort());
    await context.close();
    return { pass: JSON.stringify(before) === JSON.stringify(after), detail: 'mesh identity retention' };
  });
  await mutationCheck('desktop-only layout', async () => {
    const { context, page } = await open('heist3d.html', { mutation: 'desktop-only', viewport: { width: 375, height: 667 } });
    await waitFor3d(page);
    const width = await page.locator('#view').evaluate((node) => node.getBoundingClientRect().width);
    await context.close();
    return { pass: width >= 350, detail: `${width}px world` };
  });
  await mutationCheck('falsified recording hash', async () => {
    const { context, page } = await open('heist3d.html', { mutation: 'false-video-hash' });
    await waitFor3d(page);
    const recording = await recordAndCapture(page);
    const pass = recording.bytes.length > 0 && recording.sidecar?.bytes === recording.bytes.length
      && recording.sidecar?.sha256 === recording.independentSha256;
    await context.close();
    return { pass, detail: `${recording.bytes.length} bytes · ${recording.independentSha256}` };
  });
  await mutationCheck('recording boundary missing from final export', async () => {
    const { context, page } = await open('heist3d.html', { mutation: 'missing-record-anchor' });
    await waitFor3d(page);
    const recording = await recordAndCapture(page);
    const pass = Boolean(recording.videoName || recording.sidecar);
    const refused = /recording evidence refused: start or end frame is absent/.test(recording.status);
    await context.close();
    return { pass: pass || !refused, detail: recording.status };
  });
  await mutationCheck('recording cleanup removed', async () => {
    const { context, page } = await open('heist3d.html', { mutation: 'leaking-recorder' });
    await waitFor3d(page);
    await page.evaluate(() => {
      window.__streams = [];
      const capture = HTMLCanvasElement.prototype.captureStream;
      HTMLCanvasElement.prototype.captureStream = function (...args) {
        const stream = capture.apply(this, args);
        __streams.push(stream);
        return stream;
      };
      HTMLAnchorElement.prototype.click = function () {};
    });
    await page.click('#rec');
    await page.waitForTimeout(300);
    await page.click('#rec');
    await page.waitForTimeout(500);
    const ended = await page.evaluate(() => __streams.flatMap((stream) => stream.getTracks()).every((track) => track.readyState === 'ended'));
    await context.close();
    return { pass: ended, detail: 'capture tracks must end' };
  });
}

try {
  await healthy3d();
  await timingChecks();
  await featureDetection();
  await recorderSetupFailures();
  await crossTabSynchronization();
  await lockFallback();
  await mutationChecks();
} finally {
  await browser.close();
  server.close();
}

const passed = results.length - failures;
console.log(`\n${failures ? 'NOT READY' : 'READY'} — ${passed}/${results.length} checks passed`);
process.exit(failures ? 1 : 0);

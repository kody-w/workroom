/* arenacheck.mjs — adversarial proof that the arena is its chain. */
import { chromium } from 'playwright';
import { createHash } from 'node:crypto';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const arenaUrl = pathToFileURL(resolve(here, 'arena.html')).href;
const browser = await chromium.launch();
let bad = 0;
const say = (name, detail, pass) => {
  const ok = pass === true;
  console.log(`${ok ? ' PASS' : '*FAIL'}  ${name.padEnd(52)} ${detail}`);
  if (!ok) bad++;
};

function reduceScore(frames) {
  const p = {};
  const order = [];
  for (const f of frames) {
    const q = f.payload;
    if (q.event === 'player.spawned') {
      if (!p[q.who]) {
        p[q.who] = { kills: 0, deaths: 0 };
        order.push(q.who);
      }
      Object.assign(p[q.who], { hp: 100, ammo: 12, alive: true, x: q.x, z: q.z, ry: q.ry });
    } else if (q.event === 'player.moved' && p[q.who]?.alive) {
      Object.assign(p[q.who], { x: q.x, z: q.z, ry: q.ry });
    } else if (q.event === 'player.fired' && p[q.who]?.alive) {
      p[q.who].ammo = q.reload ? 12 : Math.max(0, p[q.who].ammo - 1);
    } else if (q.event === 'player.hit' && p[q.who]?.alive) {
      p[q.who].hp = Math.max(0, p[q.who].hp - q.damage);
    } else if (q.event === 'player.died' && p[q.who]) {
      p[q.who].alive = false;
      p[q.who].hp = 0;
      p[q.who].deaths++;
      if (p[q.by] && q.by !== q.who) p[q.by].kills++;
    }
  }
  return Object.fromEntries(order.map(id => [id, p[id]]));
}

const scoreShape = p => Object.fromEntries(Object.entries(p).map(([id, c]) =>
  [id, { kills: c.kills, deaths: c.deaths, hp: c.hp, ammo: c.ammo, alive: c.alive, x: c.x, z: c.z, ry: c.ry }]));

async function openArena({ viewport = { width: 1440, height: 900 }, slowRaf = false } = {}) {
  const context = await browser.newContext({ viewport, acceptDownloads: true });
  if (slowRaf) {
    await context.addInitScript(() => {
      window.requestAnimationFrame = callback => setTimeout(() => callback(performance.now()), 250);
    });
  }
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('dialog', dialog => dialog.accept());
  await page.goto(arenaUrl);
  await page.waitForFunction(() => typeof W !== 'undefined' && W !== null, null, { timeout: 20000 });
  return { context, page, errors };
}
async function downloadText(download) {
  const stream = await download.createReadStream();
  const chunks = [];
  for await (const chunk of stream) chunks.push(chunk);
  return Buffer.concat(chunks).toString('utf8');
}
async function captureDownloads(page, count, action) {
  return new Promise((resolve, reject) => {
    const downloads = [];
    const timeout = setTimeout(() => {
      page.off('download', onDownload);
      reject(new Error(`expected ${count} downloads, received ${downloads.length}`));
    }, 10000);
    const onDownload = download => {
      downloads.push(download);
      if (downloads.length === count) {
        clearTimeout(timeout);
        page.off('download', onDownload);
        resolve(downloads);
      }
    };
    page.on('download', onDownload);
    Promise.resolve(action()).catch(error => {
      clearTimeout(timeout);
      page.off('download', onDownload);
      reject(error);
    });
  });
}

// Cold boot, the atomic envelope, restart, bots, and stale-tab protection.
{
  const { context, page, errors } = await openArena();
  const boot = await page.evaluate(async () => {
    const record = JSON.parse(localStorage.getItem('arena.record.v1'));
    return {
      n: frames.length, players: W.order.length, stream: streamId,
      recordVersion: record?.version, recordStream: record?.stream_id,
      legacyFrames: localStorage.getItem('arena.frames'),
      legacyStream: localStorage.getItem('arena.stream'),
      problems: await verifyChain(frames, streamId),
      stored: localStorage.getItem('arena.record.v1'),
      world: Object.fromEntries(Object.entries(W.p).map(([id, c]) =>
        [id, { kills: c.kills, deaths: c.deaths, hp: c.hp, ammo: c.ammo, alive: c.alive, x: c.x, z: c.z, ry: c.ry }])),
    };
  });
  say('cold boot uses one versioned envelope', `${boot.n} frames, v${boot.recordVersion}`,
    boot.n === 6 && boot.players === 5 && boot.recordVersion === 1 && boot.recordStream === boot.stream);
  say('legacy keys are absent after boot', 'both absent', boot.legacyFrames === null && boot.legacyStream === null);
  say('fresh chain verifies', boot.problems.length ? boot.problems[0] : 'yes', boot.problems.length === 0);

  await page.reload();
  await page.waitForFunction(n => frames.length === n, boot.n);
  const restarted = await page.evaluate(async () => ({
    stream: streamId,
    stored: localStorage.getItem('arena.record.v1'),
    world: Object.fromEntries(Object.entries(W.p).map(([id, c]) =>
      [id, { kills: c.kills, deaths: c.deaths, hp: c.hp, ammo: c.ammo, alive: c.alive, x: c.x, z: c.z, ry: c.ry }])),
    problems: await verifyChain(frames, streamId),
  }));
  say('restart round-trips the exact record/world', 'byte-identical',
    restarted.stream === boot.stream && restarted.stored === boot.stored &&
    JSON.stringify(restarted.world) === JSON.stringify(boot.world) && restarted.problems.length === 0);

  const beforeBots = await page.evaluate(() => frames.length);
  await page.click('#bots');
  await page.waitForTimeout(2200);
  await page.click('#bots');
  const afterBots = await page.evaluate(async () => ({ n: frames.length, problems: await verifyChain(frames, streamId) }));
  say('bots still act through valid frames', `${afterBots.n - beforeBots} appended`,
    afterBots.n > beforeBots && afterBots.problems.length === 0);

  const stale = await context.newPage();
  stale.on('dialog', dialog => dialog.accept());
  await stale.goto(arenaUrl);
  await stale.waitForFunction(() => W !== null);
  await stale.evaluate(() => {
    frames = [];
    W = project([]);
    refused = 'simulated local fault';
  });
  await page.waitForTimeout(180);
  await page.evaluate(async () => {
    const actor = Object.values(W.p).find(c => c.alive);
    await append({ event: 'player.moved', who: actor.who, x: actor.x, z: actor.z, ry: actor.ry + 1 });
  });
  await stale.waitForFunction(() => /another tab changed/.test(refused || ''), null, { timeout: 2000 });
  const staleResult = await stale.evaluate(async () => {
    return {
      latched: refused,
      wrote: !!(await append({ event: 'match.opened', title: 'must not replace the winner' })),
      refused,
    };
  });
  say('stale tab cannot overwrite the head', staleResult.refused || 'NO',
    !staleResult.wrote && /another tab changed/.test(staleResult.latched || ''));
  const writerRecord = await page.evaluate(() => {
    const record = JSON.parse(localStorage.getItem('arena.record.v1'));
    return { stream: record.stream_id, head: record.frames.at(-1).frame_hash, raw: localStorage.getItem('arena.record.v1') };
  });
  await stale.click('#reset');
  await stale.waitForFunction(() => document.querySelector('#stat').textContent.includes('reload before resetting'));
  const afterStaleReset = await page.evaluate(() => {
    const record = JSON.parse(localStorage.getItem('arena.record.v1'));
    return { stream: record.stream_id, head: record.frames.at(-1).frame_hash, raw: localStorage.getItem('arena.record.v1') };
  });
  say('stale reset preserves the winning stream and head', afterStaleReset.head.slice(0, 12),
    afterStaleReset.raw === writerRecord.raw && afterStaleReset.stream === writerRecord.stream &&
    afterStaleReset.head === writerRecord.head);
  say('boot produced no page errors', errors.join('; ') || 'none', errors.length === 0);
  await context.close();
}

// A real cross-tab barrier: both writers start from the same head and enter append together.
{
  const context = await browser.newContext();
  const first = await context.newPage();
  const second = await context.newPage();
  const coordinator = await context.newPage();
  for (const page of [first, second, coordinator]) {
    page.on('dialog', dialog => dialog.accept());
    await page.goto(arenaUrl);
    await page.waitForFunction(() => W !== null);
  }
  const base = await first.evaluate(() => frames.length);
  const channel = 'arena-check-barrier-' + Date.now();
  await coordinator.evaluate(name => {
    const bus = new BroadcastChannel(name);
    const ready = new Set();
    window.__barrierDone = new Promise(resolve => {
      bus.onmessage = e => {
        if (e.data?.type !== 'ready') return;
        ready.add(e.data.id);
        if (ready.size === 2) {
          bus.postMessage({ type: 'go' });
          resolve();
        }
      };
    });
    window.__barrierBus = bus;
  }, channel);
  const race = (page, id, turn) => page.evaluate(async ({ name, id, turn }) => {
    const bus = new BroadcastChannel(name);
    await new Promise(resolve => {
      bus.onmessage = e => { if (e.data?.type === 'go') resolve(); };
      bus.postMessage({ type: 'ready', id });
    });
    bus.close();
    const actor = Object.values(W.p).find(c => c.alive);
    const frame = await append({ event: 'player.moved', who: actor.who, x: actor.x, z: actor.z, ry: actor.ry + turn });
    return { ok: !!frame, hash: frame?.frame_hash || null, refused };
  }, { name: channel, id, turn });
  const firstAttempt = race(first, 'first', 1);
  const secondAttempt = race(second, 'second', 2);
  await coordinator.evaluate(() => window.__barrierDone);
  const attempts = await Promise.all([firstAttempt, secondAttempt]);
  await first.waitForTimeout(180);
  const stored = await first.evaluate(async () => {
    const record = JSON.parse(localStorage.getItem('arena.record.v1'));
    return {
      n: record.frames.length,
      head: record.frames.at(-1).frame_hash,
      problems: await verifyChain(record.frames, record.stream_id),
    };
  });
  const winners = attempts.filter(x => x.ok);
  const losers = attempts.filter(x => !x.ok);
  say('simultaneous tabs serialize to one acknowledged append', `${winners.length} winner, ${losers.length} stale`,
    winners.length === 1 && losers.length === 1 && /another tab/.test(losers[0].refused || ''));
  say('no acknowledged concurrent frame is lost', `${base} → ${stored.n} frames`,
    stored.n === base + 1 && stored.head === winners[0]?.hash && stored.problems.length === 0);
  await context.close();
}

{
  const context = await browser.newContext();
  const first = await context.newPage();
  await first.goto(arenaUrl);
  await first.waitForFunction(() => W !== null);
  const baseline = await first.evaluate(() => localStorage.getItem('arena.record.v1'));
  await context.addInitScript(() => Object.defineProperty(navigator, 'locks', { value: undefined, configurable: true }));
  await first.reload();
  await first.waitForFunction(() => W !== null);
  const single = await first.evaluate(async () => {
    const actor = W.p.you;
    const appendResult = await append({ event: 'player.moved', who: 'you', x: actor.x, z: actor.z, ry: actor.ry + 1 });
    return { wrote: !!appendResult, refused, players: W.order.length };
  });
  await first.click('#reset');
  await first.click('#fork');
  const [readOnlyExport] = await captureDownloads(first, 1, () => first.click('#export'));
  const afterSingle = await first.evaluate(() => localStorage.getItem('arena.record.v1'));
  say('masked-lock single tab is explicitly read-only', single.refused || 'NO',
    !single.wrote && single.players === 5 && /read-only/.test(single.refused || '') &&
    afterSingle === baseline && readOnlyExport.suggestedFilename() === 'frame-arena-match.json');

  const second = await context.newPage();
  await second.goto(arenaUrl);
  await second.waitForFunction(() => W !== null);
  const before = await first.evaluate(() => localStorage.getItem('arena.record.v1'));
  const attempt = page => page.evaluate(async () => {
    const actor = W.p.you;
    const frame = await append({ event: 'player.moved', who: 'you', x: actor.x, z: actor.z, ry: actor.ry + 1 });
    return { wrote: !!frame, refused };
  });
  const attempts = await Promise.all([attempt(first), attempt(second)]);
  const after = await first.evaluate(() => localStorage.getItem('arena.record.v1'));
  say('masked-lock two-tab writes acknowledge zero mutations', attempts.map(x => x.wrote).join('/'),
    attempts.every(x => !x.wrote && /read-only/.test(x.refused || '')) && before === after);
  await context.close();
}

// Causality: derived target, exact one-use shot, fixed damage, exact lethal hit.
let causalFrames;
{
  const { context, page, errors } = await openArena();
  const result = await page.evaluate(async () => {
    const deterministicStream = await mintStream();
    const payloads = [
      { event: 'match.opened', title: 'Arena checker fixture' },
      { event: 'player.spawned', who: 'you', kind: 'person', x: -120, z: 0, ry: 157 },
      { event: 'player.spawned', who: 'atlas', kind: 'bot', x: 120, z: 0, ry: -157 },
      { event: 'player.spawned', who: 'cipher', kind: 'bot', x: -120, z: -120, ry: 0 },
      { event: 'player.spawned', who: 'scout', kind: 'bot', x: 120, z: -120, ry: 0 },
      { event: 'player.spawned', who: 'spark', kind: 'bot', x: 0, z: 120, ry: 0 },
    ];
    const fixture = [];
    let previous = null;
    for (const [i, payload] of payloads.entries()) {
      const frame = await buildFrame(deterministicStream, i, payload,
        previous ? previous.payload_hash : null, previous ? previous.utc : null);
      fixture.push(frame); previous = frame;
    }
    const fixtureProblems = await verifyChain(fixture, deterministicStream);
    const fixtureWrite = persistEnvelope(deterministicStream, fixture);
    if (fixtureProblems.length || fixtureWrite) throw new Error(fixtureProblems[0] || fixtureWrite);
    frames = fixture; streamId = deterministicStream; W = project(frames); refused = null; viewAt = null;
    $('wire').innerHTML = ''; for (const frame of frames) paintWire(frame, true);
    paintMeta(); paintScore();

    const shooter = 'you';
    const me = W.p[shooter];
    let aim = null;
    for (const candidate of W.order) {
      if (candidate === shooter || !W.p[candidate]?.alive) continue;
      const target = W.p[candidate];
      const ry = Math.round(Math.atan2(target.x - me.x, target.z - me.z) * 100);
      const derived = traceFrom(shooter, me.x, me.z, ry, W);
      if (derived) { aim = { ry, target: derived }; break; }
    }
    if (!aim) throw new Error('could not find a clear deterministic target');
    await append({ event: 'player.moved', who: shooter, x: me.x, z: me.z, ry: aim.ry });
    const wrong = W.order.find(id => id !== shooter && id !== aim.target);
    const wrongShot = await append({ event: 'player.fired', who: shooter, hit: wrong });
    const shot1 = await append({ event: 'player.fired', who: shooter, hit: aim.target });
    const rapidPayload = { event: 'player.fired', who: shooter, hit: aim.target };
    const rapidFrame = await buildFrame(streamId, frames.length, rapidPayload, frames.at(-1).payload_hash,
                                         frames.at(-1).utc, shot1.utc);
    const rapidProblems = await verifyChain([...frames, rapidFrame], streamId);
    const badDamage = await append({ event: 'player.hit', who: aim.target, by: shooter, damage: 35,
                                     shot_seq: shot1.seq, shot_hash: shot1.frame_hash });
    const badHash = await append({ event: 'player.hit', who: aim.target, by: shooter, damage: 34,
                                   shot_seq: shot1.seq, shot_hash: '0'.repeat(64) });
    const hit1 = await append({ event: 'player.hit', who: aim.target, by: shooter, damage: 34,
                                shot_seq: shot1.seq, shot_hash: shot1.frame_hash });
    const duplicate = await append({ event: 'player.hit', who: aim.target, by: shooter, damage: 34,
                                     shot_seq: shot1.seq, shot_hash: shot1.frame_hash });

    await new Promise(r => setTimeout(r, 140));
    const shot2 = await append({ event: 'player.fired', who: shooter, hit: aim.target });
    const hit2 = await append({ event: 'player.hit', who: aim.target, by: shooter, damage: 34,
                                shot_seq: shot2.seq, shot_hash: shot2.frame_hash });
    await new Promise(r => setTimeout(r, 140));
    const shot3 = await append({ event: 'player.fired', who: shooter, hit: aim.target });
    const hit3 = await append({ event: 'player.hit', who: aim.target, by: shooter, damage: 34,
                                shot_seq: shot3.seq, shot_hash: shot3.frame_hash });
    const zeroHpAction = await append({ event: 'player.moved', who: aim.target,
                                        x: W.p[aim.target].x, z: W.p[aim.target].z, ry: W.p[aim.target].ry });
    const wrongKiller = W.order.find(id => id !== shooter && id !== aim.target && W.p[id]?.alive);
    const wrongDeath = await append({ event: 'player.died', who: aim.target, by: wrongKiller,
                                      hit_seq: hit3.seq, hit_hash: hit3.frame_hash });
    const death = await append({ event: 'player.died', who: aim.target, by: shooter,
                                 hit_seq: hit3.seq, hit_hash: hit3.frame_hash });
    const earlyRespawn = await append({ event: 'player.spawned', who: aim.target, kind: W.p[aim.target].kind,
                                       x: W.p[aim.target].x, z: W.p[aim.target].z, ry: W.p[aim.target].ry });
    const forged = structuredClone(frames);
    const shotIndex = forged.findIndex(f => f.payload.event === 'player.fired' && !f.payload.reload);
    forged[shotIndex].payload.hit = wrong;
    for (let i = shotIndex; i < forged.length; i++) {
      forged[i].payload_hash = await H('rapp/1:particle', forged[i].payload);
      forged[i].prev = i ? forged[i - 1].payload_hash : null;
      const pre = { ...forged[i] }; delete pre.frame_hash; delete pre.sig;
      forged[i].frame_hash = await H('rapp/1:wave', pre);
    }
    return {
      aim, wrongShot: !!wrongShot, shot1: !!shot1, badDamage: !!badDamage, badHash: !!badHash,
      hit1: !!hit1, duplicate: !!duplicate, rapidProblems,
      shot2: !!shot2, hit2: !!hit2, shot3: !!shot3, hit3: !!hit3,
      zeroHpAction: !!zeroHpAction, wrongDeath: !!wrongDeath, death: !!death,
      earlyRespawn: !!earlyRespawn, problems: await verifyChain(frames, streamId),
      forgedProblems: await verifyChain(forged, streamId),
      frames, world: Object.fromEntries(Object.entries(W.p).map(([id, c]) =>
        [id, { kills: c.kills, deaths: c.deaths, hp: c.hp, ammo: c.ammo, alive: c.alive, x: c.x, z: c.z, ry: c.ry }])),
    };
  });
  causalFrames = result.frames;
  say('shot target is independently derived', `target ${result.aim.target}`,
    !result.wrongShot && result.shot1);
  say('damage and shot hash are exact', 'bad damage/hash refused',
    !result.badDamage && !result.badHash && result.hit1);
  say('one shot can be consumed only once', 'duplicate refused', !result.duplicate);
  say('fire cadence follows wall time', result.rapidProblems[0] || 'NO',
    result.rapidProblems.some(x => x.includes('fired faster')) && result.shot2 && result.shot3);
  say('zero-HP actors cannot act', 'movement refused', !result.zeroHpAction);
  say('death names the exact lethal hit and attacker', 'wrong killer refused',
    !result.wrongDeath && result.death);
  say('respawn interval is enforced', 'immediate respawn refused', !result.earlyRespawn);
  say('causal chain verifies', result.problems[0] || 'yes', result.problems.length === 0);
  say('re-sealed wrong-target mutation fails verification', result.forgedProblems[0] || 'NO',
    result.forgedProblems.some(x => x.includes('independently derived target')));

  const oracle = reduceScore(result.frames);
  say('independent reducer matches live world', JSON.stringify(scoreShape(oracle)),
    JSON.stringify(scoreShape(oracle)) === JSON.stringify(result.world));
  const mutant = structuredClone(result.frames);
  const death = [...mutant].reverse().find(f => f.payload.event === 'player.died');
  death.payload.by = Object.keys(oracle).find(id => id !== death.payload.by && id !== death.payload.who);
  say('score oracle detects a death-credit mutation', 'mutation changes scoreboard',
    JSON.stringify(scoreShape(reduceScore(mutant))) !== JSON.stringify(scoreShape(oracle)));

  const liveScore = await page.textContent('#sb');
  await page.click('#replay');
  await page.waitForTimeout(420);
  await page.click('#replay');
  const stopped = await page.evaluate(() => ({
    viewAt, score: document.querySelector('#sb').textContent,
    scrub: document.querySelector('#scrub').value, head: String(frames.length - 1),
  }));
  say('manual replay stop restores all live UI', `frame ${stopped.scrub}`,
    stopped.viewAt === null && stopped.score === liveScore && stopped.scrub === stopped.head);

  const parent = await page.evaluate(() => {
    const at = Math.min(3, frames.length - 1);
    seekTo(at);
    return { stream: streamId, seq: at, hash: frames[at].frame_hash };
  });
  await page.click('#fork');
  await page.waitForTimeout(400);
  const fork = await page.evaluate(async () => ({
    stream: streamId, from: frames[0].payload.from,
    problems: await verifyChain(frames, streamId),
    stored: JSON.parse(localStorage.getItem('arena.record.v1')),
  }));
  const exactParent = fork.from?.stream_id === parent.stream && fork.from?.seq === parent.seq && fork.from?.frame_hash === parent.hash;
  say('fork is independent and exactly parented', `parent frame ${parent.seq}`,
    fork.stream !== parent.stream && exactParent && fork.problems.length === 0 &&
    fork.stored.stream_id === fork.stream);
  const provenanceMutant = { ...fork.from, frame_hash: '0'.repeat(64) };
  say('parent-hash mutation is detected by the oracle', 'zero hash differs',
    provenanceMutant.frame_hash !== parent.hash);
  say('causality test produced no page errors', errors.join('; ') || 'none', errors.length === 0);
  await context.close();
}

// Collision and frame-level time validation.
{
  const { context, page } = await openArena();
  await page.waitForTimeout(420);
  const rules = await page.evaluate(async () => {
    const n = frames.length;
    const coverMove = await append({ event: 'player.moved', who: 'you', x: 0, z: 84, ry: 0 });
    const coverSpawn = await append({ event: 'player.spawned', who: 'intruder', kind: 'bot', x: 0, z: 80, ry: 0 });
    const coveredRay = traceFrom('s', 0, 0, 0, {
      order: ['s', 't'], p: { s: { alive: true, x: 0, z: 0 }, t: { alive: true, x: 0, z: 100 } },
    });
    const first = await append({ event: 'player.moved', who: 'you', x: -10, z: 110, ry: 0 });
    const rapidPayload = { event: 'player.moved', who: 'you', x: -36, z: 110, ry: 0 };
    const rapidFrame = await buildFrame(streamId, frames.length, rapidPayload, frames.at(-1).payload_hash,
                                         frames.at(-1).utc, first.utc);
    const rapidProblems = await verifyChain([...frames, rapidFrame], streamId);
    const stream = await mintStream();
    const f = await buildFrame(stream, 0, { event: 'match.opened', title: 'bad time' }, null, null);
    f.utc = '';
    const pre = { ...f }; delete pre.frame_hash; delete pre.sig;
    f.frame_hash = await H('rapp/1:wave', pre);
    const badParent = await buildFrame(stream, 0, {
      event: 'match.opened', title: 'bad parent',
      from: { stream_id: stream, seq: 4, frame_hash: 'deadbeef' },
    }, null, null);
    return {
      coverMove: !!coverMove, coverSpawn: !!coverSpawn, coveredRay,
      first: !!first, rapidProblems, added: frames.length - n,
      badUtc: await verifyChain([f], stream),
      badParent: await verifyChain([badParent], stream),
    };
  });
  say('body movement cannot cross cover', 'crossing step refused', !rules.coverMove);
  say('players cannot spawn inside cover', 'covered spawn refused', !rules.coverSpawn);
  say('cover occludes shot traces', rules.coveredRay === null ? 'blocked' : `hit ${rules.coveredRay}`, rules.coveredRay === null);
  say('movement rate is validated from UTC', rules.rapidProblems[0] || 'NO',
    rules.first && rules.rapidProblems.some(x => x.includes('faster than wall time')));
  say('malformed UTC cannot verify', rules.badUtc.join('; '), rules.badUtc.some(x => x.includes('utc')));
  say('malformed fork provenance cannot verify', rules.badParent.join('; '),
    rules.badParent.some(x => x.includes('fork parent hash')));
  await context.close();
}

// Atomic failure, legacy migration, corruption quarantine, and explicit recovery.
{
  const { context, page } = await openArena();
  const migrationSeed = await page.evaluate(() => {
    const record = JSON.parse(localStorage.getItem('arena.record.v1'));
    localStorage.setItem('arena.frames', JSON.stringify(record.frames));
    localStorage.setItem('arena.stream', JSON.stringify(record.stream_id));
    localStorage.removeItem('arena.record.v1');
    return { stream: record.stream_id, frames: JSON.stringify(record.frames) };
  });
  await page.reload();
  await page.waitForFunction(() => W !== null);
  const migrated = await page.evaluate(() => ({
    record: JSON.parse(localStorage.getItem('arena.record.v1')),
    legacyFrames: localStorage.getItem('arena.frames'),
    legacyStream: localStorage.getItem('arena.stream'),
  }));
  say('legacy keys migrate without changing the chain', `${migrated.record.frames.length} frames`,
    migrated.record.stream_id === migrationSeed.stream &&
    JSON.stringify(migrated.record.frames) === migrationSeed.frames &&
    migrated.legacyFrames === null && migrated.legacyStream === null);

  await page.waitForTimeout(180);
  const atomic = await page.evaluate(async () => {
    const before = localStorage.getItem('arena.record.v1');
    const memory = JSON.stringify(frames);
    const original = Storage.prototype.setItem;
    Storage.prototype.setItem = function (key, value) {
      if (key === 'arena.record.v1') throw new DOMException('denied', 'QuotaExceededError');
      return original.call(this, key, value);
    };
    const me = W.p.you;
    const wrote = await append({ event: 'player.moved', who: 'you', x: me.x - 1, z: me.z, ry: me.ry });
    Storage.prototype.setItem = original;
    return {
      wrote: !!wrote,
      memorySame: JSON.stringify(frames) === memory,
      diskSame: localStorage.getItem('arena.record.v1') === before,
      status: document.querySelector('#stat').textContent,
    };
  });
  say('failed storage write publishes nothing', atomic.status,
    !atomic.wrote && atomic.memorySame && atomic.diskSame);

  await page.evaluate(() => localStorage.setItem('arena.record.v1', '{bad json'));
  await page.reload();
  await page.waitForFunction(() => W !== null);
  const unreadable = await page.evaluate(() => ({
    n: frames.length, players: W.order.length, raw: localStorage.getItem('arena.record.v1'),
    refused, status: document.querySelector('#stat').textContent,
  }));
  say('unreadable storage is preserved and not projected', unreadable.status,
    unreadable.n === 0 && unreadable.players === 0 && unreadable.raw === '{bad json' && /unreadable/.test(unreadable.refused || ''));

  const [rawRecoveryDownload] = await captureDownloads(page, 1, () => page.click('#export'));
  const rawRecoveryText = await downloadText(rawRecoveryDownload);
  say('corrupt active storage exports byte-for-byte', rawRecoveryDownload.suggestedFilename(),
    rawRecoveryDownload.suggestedFilename().endsWith('.raw') && rawRecoveryText === '{bad json');

  await page.evaluate(() => {
    window.__arenaOriginalSetItem = Storage.prototype.setItem;
    Storage.prototype.setItem = function (key, value) {
      if (key === 'arena.quarantine.v2') throw new DOMException('quarantine denied', 'QuotaExceededError');
      return window.__arenaOriginalSetItem.call(this, key, value);
    };
  });
  await page.click('#reset');
  await page.waitForFunction(() => document.querySelector('#stat').textContent.includes('quarantine could not be written'));
  const failedQuarantine = await page.evaluate(() => ({
    raw: localStorage.getItem('arena.record.v1'),
    quarantine: localStorage.getItem('arena.quarantine.v2'),
    n: frames.length,
    status: document.querySelector('#stat').textContent,
  }));
  await page.evaluate(() => {
    Storage.prototype.setItem = window.__arenaOriginalSetItem;
    delete window.__arenaOriginalSetItem;
  });
  say('reset refuses if recovery quarantine cannot persist', failedQuarantine.status,
    failedQuarantine.raw === '{bad json' && failedQuarantine.quarantine === null && failedQuarantine.n === 0);

  await page.click('#reset');
  await page.waitForFunction(() => frames.length === 6 && !refused);
  const recovered = await page.evaluate(async () => ({
    n: frames.length, version: JSON.parse(localStorage.getItem('arena.record.v1')).version,
    problems: await verifyChain(frames, streamId),
    quarantine: JSON.parse(localStorage.getItem('arena.quarantine.v2')),
    quarantineProblem: await quarantineObjection(JSON.parse(localStorage.getItem('arena.quarantine.v2'))),
  }));
  say('explicit reset safely replaces corrupt storage', `${recovered.n} frames`,
    recovered.n === 6 && recovered.version === 1 && recovered.problems.length === 0 &&
    recovered.quarantineProblem === null &&
    recovered.quarantine.entries.at(-1).items.some(item => item.key === 'arena.record.v1' && item.raw === '{bad json'));

  const postResetDownloads = await captureDownloads(page, 2, () => page.click('#export'));
  const postResetRecovery = postResetDownloads.find(download => download.suggestedFilename().endsWith('.raw'));
  say('quarantined bytes remain exportable after reset', postResetRecovery?.suggestedFilename() || 'NO',
    !!postResetRecovery && await downloadText(postResetRecovery) === '{bad json');

  await page.evaluate(() => {
    const record = JSON.parse(localStorage.getItem('arena.record.v1'));
    record.frames[1].payload.x = 130;
    localStorage.setItem('arena.record.v1', JSON.stringify(record));
  });
  await page.reload();
  await page.waitForFunction(() => W !== null);
  const corrupt = await page.evaluate(() => ({
    n: frames.length, players: W.order.length,
    storedX: JSON.parse(localStorage.getItem('arena.record.v1')).frames[1].payload.x,
    refused,
  }));
  say('hash-corrupt frames are quarantined, not projected', corrupt.refused || 'NO',
    corrupt.n === 0 && corrupt.players === 0 && corrupt.storedX === 130 && /does not verify/.test(corrupt.refused || ''));
  await context.close();
}

// Every malformed legacy key is recoverable byte-for-byte and quarantined before reset.
{
  const { context, page } = await openArena();
  const legacy = await page.evaluate(() => {
    const streamRaw = JSON.stringify(streamId);
    const framesRaw = '{malformed legacy frames';
    localStorage.removeItem('arena.record.v1');
    localStorage.removeItem('arena.quarantine.v2');
    localStorage.setItem('arena.frames', framesRaw);
    localStorage.setItem('arena.stream', streamRaw);
    return { framesRaw, streamRaw };
  });
  await page.reload();
  await page.waitForFunction(() => W !== null);
  const legacyState = await page.evaluate(() => ({
    n: frames.length, refused, recoveryKeys: activeRecovery?.items?.map(item => item.key).sort(),
  }));
  const legacyDownloads = await captureDownloads(page, 2, () => page.click('#export'));
  const legacyExport = Object.fromEntries(await Promise.all(legacyDownloads.map(async download => [
    download.suggestedFilename().includes('arena.frames') ? 'frames' : 'stream',
    await downloadText(download),
  ])));
  say('malformed legacy keys export exact original bytes', legacyState.refused || 'NO',
    legacyState.n === 0 && legacyState.recoveryKeys?.join(',') === 'arena.frames,arena.stream' &&
    legacyExport.frames === legacy.framesRaw && legacyExport.stream === legacy.streamRaw);

  await page.click('#reset');
  await page.waitForFunction(() => frames.length === 6 && !refused);
  const legacyQuarantine = await page.evaluate(async () => {
    const value = JSON.parse(localStorage.getItem('arena.quarantine.v2'));
    return {
      problem: await quarantineObjection(value),
      items: value.entries.at(-1).items.map(item => ({ key: item.key, raw: item.raw })),
      legacyFrames: localStorage.getItem('arena.frames'),
      legacyStream: localStorage.getItem('arena.stream'),
    };
  });
  const legacyItems = Object.fromEntries(legacyQuarantine.items.map(item => [item.key, item.raw]));
  say('legacy reset durably quarantines both raw values', JSON.stringify(legacyQuarantine.items),
    legacyQuarantine.problem === null && legacyItems['arena.frames'] === legacy.framesRaw &&
    legacyItems['arena.stream'] === legacy.streamRaw &&
    legacyQuarantine.legacyFrames === null && legacyQuarantine.legacyStream === null);
  await context.close();
}

// A corrupt primary must not hide legacy bytes that coexist with it.
{
  const { context, page } = await openArena();
  const mixed = await page.evaluate(() => {
    const values = {
      record: '{malformed primary record',
      frames: '[{"legacy":"frame bytes"}]',
      stream: '"legacy-stream-bytes"',
    };
    localStorage.setItem('arena.record.v1', values.record);
    localStorage.setItem('arena.frames', values.frames);
    localStorage.setItem('arena.stream', values.stream);
    localStorage.removeItem('arena.quarantine.v2');
    return values;
  });
  await page.reload();
  await page.waitForFunction(() => W !== null);
  const mixedState = await page.evaluate(() => ({
    n: frames.length,
    keys: activeRecovery?.items?.map(item => item.key).sort(),
    refused,
  }));
  const mixedDownloads = await captureDownloads(page, 3, () => page.click('#export'));
  const mixedExport = {};
  for (const download of mixedDownloads) {
    const name = download.suggestedFilename();
    const key = name.includes('arena.record.v1') ? 'record'
      : name.includes('arena.frames') ? 'frames' : 'stream';
    mixedExport[key] = await downloadText(download);
  }
  say('mixed corrupt primary exports primary and all legacy bytes', mixedState.refused || 'NO',
    mixedState.n === 0 &&
    mixedState.keys?.join(',') === 'arena.frames,arena.record.v1,arena.stream' &&
    mixedExport.record === mixed.record && mixedExport.frames === mixed.frames && mixedExport.stream === mixed.stream);

  await page.click('#reset');
  await page.waitForFunction(() => frames.length === 6 && !refused);
  const mixedQuarantine = await page.evaluate(async () => {
    const value = JSON.parse(localStorage.getItem('arena.quarantine.v2'));
    return {
      problem: await quarantineObjection(value),
      items: value.entries.at(-1).items.map(item => ({ key: item.key, raw: item.raw })),
      legacyFrames: localStorage.getItem('arena.frames'),
      legacyStream: localStorage.getItem('arena.stream'),
    };
  });
  const mixedItems = Object.fromEntries(mixedQuarantine.items.map(item => [item.key, item.raw]));
  say('mixed reset quarantines the complete three-key bundle', JSON.stringify(mixedQuarantine.items),
    mixedQuarantine.problem === null &&
    mixedItems['arena.record.v1'] === mixed.record &&
    mixedItems['arena.frames'] === mixed.frames &&
    mixedItems['arena.stream'] === mixed.stream &&
    mixedQuarantine.legacyFrames === null && mixedQuarantine.legacyStream === null);
  await context.close();
}

async function movementRate(slowRaf) {
  const { context, page } = await openArena({ slowRaf });
  await page.evaluate(() => { drawWorld = () => {}; });
  const unlockedStart = await page.evaluate(() => W.p.you.x);
  await page.keyboard.down('a');
  await page.waitForTimeout(300);
  await page.keyboard.up('a');
  const unlockedEnd = await page.evaluate(() => W.p.you.x);
  await page.evaluate(() => { lockedIn = true; motionClock = performance.now(); moveCarry = 0; });
  const start = await page.evaluate(() => W.p.you.x);
  await page.keyboard.down('a');
  await page.waitForTimeout(1500);
  await page.keyboard.up('a');
  await page.waitForFunction(() => !stepping && pendingRelease === null, null, { timeout: 10000 });
  await page.evaluate(async () => await q);
  const end = await page.evaluate(() => W.p.you.x);
  const problems = await page.evaluate(async () => await verifyChain(frames, streamId));
  await context.close();
  return { distance: Math.abs(end - start), unlockedDistance: Math.abs(unlockedEnd - unlockedStart), problems };
}

const normal = await movementRate(false);
const slow = await movementRate(true);
const timingDifference = Math.abs(normal.distance - slow.distance);
say('movement requires control ownership', `${normal.unlockedDistance} tenths while unlocked`, normal.unlockedDistance === 0);
say('movement remains wall-clock paced at 250ms RAF', `${normal.distance} vs ${slow.distance} tenths`,
  normal.problems.length === 0 && slow.problems.length === 0 &&
  timingDifference <= Math.max(12, Math.max(normal.distance, slow.distance) * 0.25));
{
  const { context, page } = await openArena();
  await page.evaluate(() => { drawWorld = () => {}; });
  await page.evaluate(() => { lockedIn = true; motionClock = performance.now(); moveCarry = 0; });
  const start = await page.evaluate(() => W.p.you.x);
  await page.keyboard.down('a');
  await page.evaluate(() => {
    const until = performance.now() + 1200;
    while (performance.now() < until) {}
  });
  await page.keyboard.up('a');
  await page.waitForFunction(() => !stepping && pendingRelease === null, null, { timeout: 10000 });
  await page.evaluate(async () => await q);
  const distance = await page.evaluate(x => Math.abs(W.p.you.x - x), start);
  say('long blocked frame cannot cause a teleport', `${distance} tenths after 1.2s block`, distance <= 35);
  await context.close();
}

// Responsive layout, focusability, downloads, and remaining controls.
{
  const { context, page, errors } = await openArena({ viewport: { width: 375, height: 667 } });
  const small = await page.evaluate(() => {
    const box = selector => {
      const r = document.querySelector(selector).getBoundingClientRect();
      return { width: r.width, bottom: r.bottom };
    };
    return {
      view: box('#view'), status: box('#stat'), scrollHeight: document.body.scrollHeight,
      innerHeight, overflow: getComputedStyle(document.body).overflow,
      hintTabIndex: document.querySelector('#lockhint').tabIndex,
      hintRole: document.querySelector('#lockhint').getAttribute('role'),
    };
  });
  say('375px layout keeps the arena usable and status reachable', `${small.view.width}px arena, ${small.scrollHeight}px page`,
    small.view.width >= 360 && small.status.bottom <= small.scrollHeight + 1 &&
    small.scrollHeight > small.innerHeight && small.overflow === 'auto');
  say('pointer-lock entry is keyboard reachable', `${small.hintRole}, tabindex ${small.hintTabIndex}`,
    small.hintRole === 'button' && small.hintTabIndex === 0);

  const downloads = [];
  page.on('download', download => {
    const name = download.suggestedFilename();
    const data = (async () => {
      const stream = await download.createReadStream();
      const chunks = [];
      for await (const chunk of stream) chunks.push(chunk);
      return Buffer.concat(chunks);
    })();
    downloads.push({ name, data });
  });
  await page.evaluate(() => {
    window.__revokedArenaUrls = [];
    const revoke = URL.revokeObjectURL.bind(URL);
    URL.revokeObjectURL = url => { window.__revokedArenaUrls.push(url); revoke(url); };
  });
  await page.evaluate(() => { lockedIn = true; });
  const shotBefore = await page.evaluate(() =>
    frames.filter(f => f.payload.event === 'player.fired' && f.payload.who === 'you' && !f.payload.reload).length);
  await page.click('#view', { position: { x: 120, y: 170 } });
  await page.waitForFunction(before =>
    frames.filter(f => f.payload.event === 'player.fired' && f.payload.who === 'you' && !f.payload.reload).length === before + 1,
  shotBefore, { timeout: 10000 });
  await page.evaluate(async () => await q);
  const reloadBefore = await page.evaluate(() =>
    frames.filter(f => f.payload.event === 'player.fired' && f.payload.who === 'you' && f.payload.reload).length);
  await page.keyboard.press('r');
  await page.waitForFunction(before =>
    frames.filter(f => f.payload.event === 'player.fired' && f.payload.who === 'you' && f.payload.reload).length === before + 1,
  reloadBefore, { timeout: 10000 });
  await page.evaluate(async () => await q);
  const weapon = await page.evaluate(() => ({
    shots: frames.filter(f => f.payload.event === 'player.fired' && f.payload.who === 'you' && !f.payload.reload).length,
    reloads: frames.filter(f => f.payload.event === 'player.fired' && f.payload.who === 'you' && f.payload.reload).length,
  }));
  say('click fire and keyboard reload still work', `${weapon.shots} shot, ${weapon.reloads} reload`,
    weapon.shots === shotBefore + 1 && weapon.reloads === reloadBefore + 1);

  const setupState = () => page.evaluate(() => ({
    recorderNull: recorder === null,
    tracksNull: captureTracks === null,
    snapshotNull: recordingSnapshot === null,
    chunksNull: chunks === null,
    failureNull: recordingFailure === null,
    stoppedTracks: lastStoppedTracks.length,
    tracksEnded: lastStoppedTracks.every(track => track.readyState === 'ended'),
    recordLabel: document.querySelector('#rec').textContent,
    recordHot: document.querySelector('#rec').classList.contains('hot'),
    resetDisabled: document.querySelector('#reset').disabled,
    forkDisabled: document.querySelector('#fork').disabled,
    status: document.querySelector('#stat').textContent,
  }));

  await page.evaluate(() => {
    window.__arenaCaptureStream = renderer.domElement.captureStream;
    renderer.domElement.captureStream = () => { throw new Error('captureStream injected failure'); };
  });
  await page.click('#rec');
  const captureFailure = await setupState();
  await page.evaluate(() => { renderer.domElement.captureStream = window.__arenaCaptureStream; delete window.__arenaCaptureStream; });
  say('captureStream failure rolls back recorder setup', captureFailure.status,
    captureFailure.recorderNull && captureFailure.tracksNull && captureFailure.snapshotNull &&
    captureFailure.chunksNull && captureFailure.failureNull &&
    captureFailure.stoppedTracks === 0 && captureFailure.recordLabel === '● Record' &&
    !captureFailure.recordHot && !captureFailure.resetDisabled && !captureFailure.forkDisabled &&
    /captureStream injected failure/.test(captureFailure.status));

  await page.evaluate(() => {
    const RealMediaRecorder = window.MediaRecorder;
    window.__arenaMediaRecorder = RealMediaRecorder;
    window.MediaRecorder = class {
      static isTypeSupported(type) { return RealMediaRecorder.isTypeSupported(type); }
      constructor() { throw new Error('MediaRecorder constructor injected failure'); }
    };
  });
  await page.click('#rec');
  const constructorFailure = await setupState();
  await page.evaluate(() => { window.MediaRecorder = window.__arenaMediaRecorder; delete window.__arenaMediaRecorder; });
  say('MediaRecorder construction failure stops tracks', constructorFailure.status,
    constructorFailure.recorderNull && constructorFailure.tracksNull && constructorFailure.snapshotNull &&
    constructorFailure.chunksNull && constructorFailure.failureNull &&
    constructorFailure.stoppedTracks > 0 && constructorFailure.tracksEnded &&
    !constructorFailure.resetDisabled && !constructorFailure.forkDisabled &&
    /constructor injected failure/.test(constructorFailure.status));

  await page.evaluate(() => {
    window.__arenaRecorderStart = MediaRecorder.prototype.start;
    MediaRecorder.prototype.start = function () { throw new Error('recorder.start injected failure'); };
  });
  await page.click('#rec');
  const startFailure = await setupState();
  await page.evaluate(() => { MediaRecorder.prototype.start = window.__arenaRecorderStart; delete window.__arenaRecorderStart; });
  say('recorder.start failure stops tracks and restores UI', startFailure.status,
    startFailure.recorderNull && startFailure.tracksNull && startFailure.snapshotNull &&
    startFailure.chunksNull && startFailure.failureNull &&
    startFailure.stoppedTracks > 0 && startFailure.tracksEnded &&
    startFailure.recordLabel === '● Record' && !startFailure.recordHot &&
    !startFailure.resetDisabled && !startFailure.forkDisabled &&
    /recorder.start injected failure/.test(startFailure.status));

  await page.evaluate(() => {
    const RealMediaRecorder = window.MediaRecorder;
    window.__arenaMediaRecorder = RealMediaRecorder;
    window.__arenaRuntimePartial = false;
    window.MediaRecorder = class {
      static isTypeSupported(type) { return RealMediaRecorder.isTypeSupported(type); }
      constructor(stream, options = {}) {
        this.stream = stream;
        this.mimeType = options.mimeType || 'video/webm';
        this.state = 'inactive';
      }
      start() {
        this.state = 'recording';
        setTimeout(() => this.onerror?.({ error: new Error('runtime injected failure') }), 0);
      }
      stop() {
        if (this.state === 'inactive') return;
        this.state = 'inactive';
        window.__arenaRuntimePartial = true;
        this.ondataavailable?.({ data: new Blob(['partial runtime bytes'], { type: this.mimeType }) });
        queueMicrotask(() => this.onstop?.());
      }
    };
  });
  const artifactsBeforeRuntimeFailure = downloads.length;
  await page.click('#rec');
  await page.waitForFunction(() => recorder === null, null, { timeout: 10000 });
  const runtimeFailure = await setupState();
  const runtimeEvidence = await page.evaluate(() => window.__arenaRuntimePartial);
  await page.evaluate(() => {
    window.MediaRecorder = window.__arenaMediaRecorder;
    delete window.__arenaMediaRecorder;
    delete window.__arenaRuntimePartial;
  });
  say('runtime recorder error discards partial output and cleans up', runtimeFailure.status,
    runtimeEvidence && downloads.length === artifactsBeforeRuntimeFailure &&
    runtimeFailure.recorderNull && runtimeFailure.tracksNull && runtimeFailure.snapshotNull &&
    runtimeFailure.chunksNull && runtimeFailure.failureNull &&
    runtimeFailure.stoppedTracks > 0 && runtimeFailure.tracksEnded &&
    runtimeFailure.recordLabel === '● Record' && !runtimeFailure.recordHot &&
    !runtimeFailure.resetDisabled && !runtimeFailure.forkDisabled &&
    /runtime injected failure/.test(runtimeFailure.status) && /No files were saved/.test(runtimeFailure.status));

  await page.click('#export');
  await page.click('#rec');
  await page.waitForFunction(() => recorder?.state === 'recording');
  const recordingStart = await page.evaluate(() => ({
    stream: recordingSnapshot.stream_id, start: recordingSnapshot.start, n: frames.length,
    resetDisabled: document.querySelector('#reset').disabled,
    forkDisabled: document.querySelector('#fork').disabled,
  }));
  await page.waitForTimeout(180);
  const postStartFrame = await page.evaluate(async () => {
    const actor = W.p.you;
    const frame = await append({ event: 'player.moved', who: 'you', x: actor.x, z: actor.z, ry: actor.ry + 1 });
    return { hash: frame.frame_hash, n: frames.length };
  });
  const changedDuringRecording = postStartFrame.n;
  const streamBeforeBlockedActions = await page.evaluate(() => streamId);
  await page.evaluate(async () => await document.querySelector('#reset').onclick());
  const resetWhileRecording = await page.evaluate(() => ({
    stream: streamId, state: recorder?.state, status: document.querySelector('#stat').textContent,
  }));
  await page.evaluate(() => seekTo(0));
  await page.evaluate(async () => await document.querySelector('#fork').onclick());
  const forkWhileRecording = await page.evaluate(() => ({
    stream: streamId, state: recorder?.state, status: document.querySelector('#stat').textContent,
  }));
  say('reset and fork refuse while recording', forkWhileRecording.status,
    resetWhileRecording.stream === streamBeforeBlockedActions && forkWhileRecording.stream === streamBeforeBlockedActions &&
    resetWhileRecording.state === 'recording' && forkWhileRecording.state === 'recording' &&
    recordingStart.resetDisabled && recordingStart.forkDisabled &&
    /stop recording/.test(resetWhileRecording.status) && /stop recording/.test(forkWhileRecording.status));

  await page.waitForTimeout(1000);
  await page.click('#rec');
  await page.waitForFunction(() => recorder === null, null, { timeout: 10000 });
  const recordingStop = await page.evaluate(() => ({
    n: frames.length, hash: frames.at(-1).frame_hash,
  }));
  await page.waitForTimeout(1200);
  const completedDownloads = await Promise.all(downloads.map(async item => ({
    name: item.name, data: await item.data,
  })));
  const sidecarDownload = completedDownloads.find(x => x.name.endsWith('.frames.json'));
  const webmDownload = completedDownloads.find(x => x.name.endsWith('.webm'));
  const sidecar = sidecarDownload ? JSON.parse(sidecarDownload.data.toString('utf8')) : null;
  const recordingCleanup = await page.evaluate(() => ({
    stateCleared: recorder === null && captureTracks === null && recordingSnapshot === null && chunks === null,
    tracksEnded: lastStoppedTracks.length > 0 && lastStoppedTracks.every(track => track.readyState === 'ended'),
    controlsRestored: !document.querySelector('#reset').disabled && !document.querySelector('#fork').disabled,
    revoked: window.__revokedArenaUrls.length,
  }));
  const sidecarEnd = sidecar?.frames?.at(-1);
  say('recording sidecar contains the complete stop chain', `${recordingStart.n} start, ${recordingStop.n} stop`,
    sidecar?.stream_id === recordingStart.stream &&
    sidecar?.frames?.length === recordingStop.n && recordingStop.n >= changedDuringRecording &&
    changedDuringRecording > recordingStart.n &&
    sidecar.frames.some(frame => frame.frame_hash === postStartFrame.hash) &&
    sidecar?.recording_window?.start?.seq === recordingStart.start.seq &&
    sidecar?.recording_window?.start?.frame_hash === recordingStart.start.frame_hash &&
    sidecar?.recording_window?.end?.seq === sidecarEnd?.seq &&
    sidecar?.recording_window?.end?.frame_hash === sidecarEnd?.frame_hash &&
    sidecarEnd?.frame_hash === recordingStop.hash);
  const webmHash = webmDownload ? createHash('sha256').update(webmDownload.data).digest('hex') : null;
  say('sidecar identifies the completed WebM bytes', `${sidecar?.bytes} bytes · ${sidecar?.sha256?.slice(0, 12) || 'NO'}`,
    !!webmDownload && sidecar?.bytes === webmDownload.data.length && sidecar?.sha256 === webmHash);
  say('capture tracks stop and object URLs are revoked', `${recordingCleanup.revoked} URLs revoked`,
    recordingCleanup.stateCleared && recordingCleanup.tracksEnded &&
    recordingCleanup.controlsRestored && recordingCleanup.revoked >= 3);
  const names = completedDownloads.map(x => x.name);
  say('export and recording produce their artifacts', names.join(', '),
    names.includes('frame-arena-match.json') &&
    names.some(x => x.endsWith('.webm')) && names.some(x => x.endsWith('.frames.json')));
  say('responsive control sweep has no page errors', errors.join('; ') || 'none', errors.length === 0);
  await context.close();
}

{
  const context = await browser.newContext();
  const sentinel = '{"sentinel":"leave untouched"}';
  await context.addInitScript(value => {
    try { localStorage.setItem('arena.record.v1', value); } catch (e) {}
    Object.defineProperty(globalThis, 'THREE', {
      configurable: false, get: () => undefined, set: () => {},
    });
  }, sentinel);
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(arenaUrl);
  await page.waitForFunction(() => document.querySelector('#stat').textContent.includes('3D runtime'));
  const failure = await page.evaluate(() => ({
    status: document.querySelector('#stat').textContent,
    hint: document.querySelector('#lockhint').textContent,
    disabled: [...document.querySelectorAll('button,input')].every(control => control.disabled),
    stored: localStorage.getItem('arena.record.v1'),
  }));
  say('missing Three.js fails explicitly without touching data', failure.status,
    errors.length === 0 && /did not load/.test(failure.status) &&
    /runtime unavailable/.test(failure.hint) && failure.disabled && failure.stored === sentinel);
  await context.close();
}

await browser.close();
console.log(bad ? `\n${bad} problem(s)` : '\nPERFECT — arena chain, persistence, timing, controls, and independent oracle all pass');
process.exit(bad ? 1 : 0);

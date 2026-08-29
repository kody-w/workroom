/* build-seeds.mjs — generate the demo chains.
 *
 * The board opens on a workflow already in progress rather than on nothing. That
 * cannot be faked: the app verifies every frame it loads, so a seed has to be a
 * REAL rapp/1 chain — genuine particle and wave hashes, genuine links, payloads
 * that survive the card-lifecycle checks. So the primitives are pulled out of the
 * shipped index.html (not a copy) and used to mint the chains for real.
 *
 *   node build-seeds.mjs        # writes seeds.js
 *
 * Each scenario is its own stream with its own minted rappid, so flipping between
 * them is not a rollback of anything and the §7.6 head rules have nothing to
 * object to.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { webcrypto } from 'node:crypto';

if (!globalThis.crypto) globalThis.crypto = webcrypto;
const here = dirname(fileURLToPath(import.meta.url));

const html = readFileSync(join(here, 'index.html'), 'utf8');
const start = html.indexOf('/* ── §4 canonicalization');
const end = html.indexOf('/* ── state ');
if (start < 0 || end < 0) { console.error('primitives not found in index.html'); process.exit(2); }
const { canonical, H, Hb } = await import('data:text/javascript,' + encodeURIComponent(
  html.slice(start, end) + '\nexport { canonical, H, Hb };'
));

const SPEC = 'rapp/1', KIND = 'memory.save';
const hex = (n) => [...crypto.getRandomValues(new Uint8Array(n))].map(b => b.toString(16).padStart(2, '0')).join('');

async function mintStream(slug) {
  const tail = await Hb('rapp/1:rappid', crypto.getRandomValues(new Uint8Array(16)));
  const inst = await Hb('rapp/1:rappid', crypto.getRandomValues(new Uint8Array(16)));
  return `rappid:@kody-w/${slug}:${tail}:${inst.slice(0, 16)}`;
}
const utc = (d) => new Date(d).toISOString().replace(/\.(\d{3})\d*Z$/, '.$1Z');

async function build(streamId, events, startAt) {
  const frames = [];
  let t = startAt;
  for (const [i, payload] of events.entries()) {
    t += 1000 * 60 * (7 + (i * 13) % 400);          // minutes apart, deterministic-ish spread
    const prev = frames[frames.length - 1] || null;
    const payload_hash = await H('rapp/1:particle', payload);
    const pre = {
      spec: SPEC, kind: KIND, stream_id: streamId, seq: i, utc: utc(t),
      payload, payload_hash,
      prev: prev ? prev.payload_hash : null, prev_wave: null,
    };
    frames.push({ ...pre, frame_hash: await H('rapp/1:wave', pre), sig: null });
  }
  return frames;
}

/* ── the scenarios ─────────────────────────────────────────────────────────
   Each is a workflow mid-flight, with agents and people both acting. An author
   whose name starts with @ is an agent; the board and the ledger show the
   difference, because "an AI did this" is the thing worth being able to see.   */

const card = () => hex(8);

function scenario(title, rows) {
  // rows: [event, lane, title, note, who]  — with ids threaded for us
  const ids = {};
  const events = [{ event: 'room.opened', title }];
  for (const r of rows) {
    if (r.add) {
      ids[r.add] = card();
      events.push({ event: 'card.added', card: ids[r.add], lane: r.lane, title: r.title,
                    note: r.note || '', who: r.who || '' });
    } else if (r.move) {
      events.push({ event: 'card.moved', card: ids[r.move], lane: r.lane, titleAt: r.titleAt, who: r.who || '' });
    } else if (r.edit) {
      events.push({ event: 'card.edited', card: ids[r.edit], title: r.title, note: r.note || '',
                    who: r.who || '', titleAt: r.titleAt });
    } else if (r.remove) {
      events.push({ event: 'card.removed', card: ids[r.remove], titleAt: r.titleAt, who: r.who || '' });
    }
  }
  return events;
}

const SCENARIOS = [
  {
    id: 'tour',
    name: 'Shipping the tour',
    blurb: 'A demo going out on Friday. Two people, three agents, mid-week.',
    slug: 'workroom-demo-tour',
    startAt: Date.parse('2026-08-25T09:12:00Z'),
    rows: [
      { add: 'cut', lane: 'done', title: 'Cut the 90-second tour', note: 'nine frames, narration from the real voice file', who: 'KW' },
      { add: 'cap', lane: 'done', title: 'Capture the three-player room', note: 'driven, not staged — all three tabs read "3 players"', who: '@scout' },
      { add: 'relay', lane: 'now', title: 'Presence relay', note: 'guests are invisible to each other until the host passes it on', who: 'KW' },
      { add: 'badge', lane: 'now', title: 'Badges read 3 in every tab', note: 'was 3 / 2 / 2 — the host counted the room, the guests counted their own wires', who: '@scout' },
      { add: 'rot', lane: 'blocked', title: 'Rotate the ghu token', note: 'blocked on Kody — nobody else can', who: '@scribe' },
      { add: 'pr', lane: 'next', title: 'Open the PRs against current main', note: 'the old ones are 172 commits behind and cannot merge', who: 'KW' },
      { add: 'disp', lane: 'next', title: 'disposeObject releases a shared geometry', note: 'three.js shares one quad across every sprite on the page', who: '@reviewer' },
      { add: 'stale', lane: 'done', title: 'Find the stale branches', note: 'two PRs, 142 and 172 behind', who: '@scout' },
      { move: 'cap', lane: 'done', titleAt: 'Capture the three-player room', who: '@scout' },
      { edit: 'relay', title: 'Presence relay', note: 'host forwards playerUpdate stamped `from`; departures too', who: 'KW', titleAt: 'Presence relay' },
      { add: 'kill', lane: 'blocked', title: 'Kill switch re-armed by its own work', note: 'seven rounds; the design was wrong, not the patch', who: '@reviewer' },
      { move: 'kill', lane: 'now', titleAt: 'Kill switch re-armed by its own work', who: 'KW' },
      { add: 'ver', lane: 'next', title: 'Prove the tests are not theatre', note: 'put each bug back and require the suite to fail', who: '@reviewer' },
      { remove: 'stale', titleAt: 'Find the stale branches', who: 'KW' },
      { move: 'disp', lane: 'now', titleAt: 'disposeObject releases a shared geometry', who: '@reviewer' },
    ],
  },
  {
    id: 'incident',
    name: 'Incident, hour two',
    blurb: 'Something is wrong in production. Agents triaging, a person deciding.',
    slug: 'workroom-demo-incident',
    startAt: Date.parse('2026-08-28T22:40:00Z'),
    rows: [
      { add: 'rep', lane: 'done', title: 'Reports: players stop moving after ~5 min', note: 'three separate rooms, same shape', who: 'DM' },
      { add: 'tri', lane: 'done', title: 'Triage the reports', note: 'all three had a backgrounded tab', who: '@triage' },
      { add: 'raf', lane: 'now', title: 'Hidden tabs stop requestAnimationFrame', note: 'so the presence loop stops sending — the peer looks dead and gets pruned', who: '@triage' },
      { add: 'prune', lane: 'now', title: 'The 5-second prune has no way back', note: 'once pruned, nothing recreates the body', who: '@scout' },
      { add: 'roll', lane: 'blocked', title: 'Decide: roll back or fix forward', note: 'needs a human call', who: '@triage' },
      { add: 'comm', lane: 'next', title: 'Say something to the three rooms', note: 'draft ready, not sent', who: '@scribe' },
      { add: 'repro', lane: 'done', title: 'Reproduce it headlessly', note: 'a visible tab never shows it — that is why it took two hours', who: '@scout' },
      { move: 'roll', lane: 'now', titleAt: 'Decide: roll back or fix forward', who: 'KW' },
      { edit: 'roll', title: 'Fix forward — no rollback', note: 'the rollback loses the relay, which is the thing that made it visible', who: 'KW', titleAt: 'Decide: roll back or fix forward' },
      { add: 'test', lane: 'next', title: 'A test that fails on the current build', note: 'otherwise we are guessing', who: '@reviewer' },
      { move: 'raf', lane: 'done', titleAt: 'Hidden tabs stop requestAnimationFrame', who: '@triage' },
    ],
  },
  {
    id: 'week',
    name: 'Field week',
    blurb: 'Customer-facing prep, split across a person and the agents doing the legwork.',
    slug: 'workroom-demo-week',
    startAt: Date.parse('2026-08-24T08:05:00Z'),
    rows: [
      { add: 'deck', lane: 'now', title: 'The Tuesday deck', note: 'twelve slides; the demo carries the middle', who: 'KW' },
      { add: 'pull', lane: 'done', title: 'Pull last quarter\'s numbers', note: 'four sources, reconciled', who: '@scout' },
      { add: 'sane', lane: 'done', title: 'Sanity-check the numbers', note: 'one source was double-counting renewals', who: '@reviewer' },
      { add: 'demo', lane: 'now', title: 'Rehearse the live demo', note: 'the failure mode is the network, so have the recording ready', who: 'KW' },
      { add: 'rec', lane: 'next', title: 'Record the fallback', note: 'same script, no network', who: '@scribe' },
      { add: 'ques', lane: 'next', title: 'The three questions they will ask', note: 'pricing, data residency, who owns the model', who: '@scout' },
      { add: 'room', lane: 'blocked', title: 'Confirm the room has HDMI', note: 'unanswered since Thursday', who: '@scribe' },
      { add: 'follow', lane: 'blocked', title: 'Follow-up owner not named', note: 'needs a person', who: '@triage' },
      { move: 'pull', lane: 'done', titleAt: 'Pull last quarter\'s numbers', who: '@scout' },
      { edit: 'demo', title: 'Rehearse the live demo', note: 'twice through; second run clean', who: 'KW', titleAt: 'Rehearse the live demo' },
      { move: 'ques', lane: 'now', titleAt: 'The three questions they will ask', who: 'KW' },
      { remove: 'follow', titleAt: 'Follow-up owner not named', who: 'KW' },
    ],
  },
];

const out = [];
for (const sc of SCENARIOS) {
  const streamId = await mintStream(sc.slug);
  const frames = await build(streamId, scenario(sc.name, sc.rows), sc.startAt);
  out.push({ id: sc.id, name: sc.name, blurb: sc.blurb, stream_id: streamId, frames });
  console.log(`  ${sc.name.padEnd(22)} ${String(frames.length).padStart(2)} frames  head ${frames[frames.length - 1].frame_hash.slice(0, 12)}`);
}

// Injected into index.html between markers, so the app stays ONE self-contained file
// and the seeds stay regenerable. Hand-editing them is pointless: every frame carries
// real hashes, so a changed byte makes the app refuse the chain it ships with.
const MARK_A = '/* SEEDS-START — generated by build-seeds.mjs, do not hand-edit */';
const MARK_B = '/* SEEDS-END */';
const file = join(here, 'index.html');
let doc = readFileSync(file, 'utf8');
const block = MARK_A + '\nconst SEEDS = ' + JSON.stringify(out) + ';\n' + MARK_B;
if (doc.includes(MARK_A)) {
  doc = doc.slice(0, doc.indexOf(MARK_A)) + block + doc.slice(doc.indexOf(MARK_B) + MARK_B.length);
} else {
  console.error('markers not found in index.html — add them where SEEDS should live');
  process.exit(2);
}
writeFileSync(file, doc);
console.log('\ninjected into index.html (' + block.length + ' bytes)');

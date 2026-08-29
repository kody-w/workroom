/* verify_parity.mjs — is this actually rapp/1, or does it just say so?
 *
 * The app claims SPEC.md rev-6 conformance. A claim like that is worth nothing
 * unless the bytes agree with the reference implementation, so this pulls the
 * canonicalizer and the hash functions OUT OF THE SHIPPED index.html — not a
 * copy of them — runs them over a set of payloads, and compares every hash with
 * kody-w/rapp-1's rapp.py.
 *
 *   node verify_parity.mjs
 * exit 0 = every case agrees, byte for byte.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const RAPP1 = process.env.RAPP1_DIR || join(process.env.HOME, 'Documents/GitHub/rapp-1');

/* ── take the real functions out of the shipped app ───────────────────────── */
const html = readFileSync(join(here, 'index.html'), 'utf8');
const start = html.indexOf('/* ── §4 canonicalization');
const end = html.indexOf('/* ── state ');
if (start < 0 || end < 0) {
  console.error('could not find the primitives in index.html — the markers moved');
  process.exit(2);
}
const primitives = html.slice(start, end);
const mod = await import('data:text/javascript,' + encodeURIComponent(
  primitives + '\nexport { canonical, H, Hb };'
));
const { canonical, H } = mod;

/* ── the cases ────────────────────────────────────────────────────────────── */
const cases = {
  // the app's own genesis payload
  genesis: { event: 'room.opened', title: 'The Workroom' },
  // a card, with the punctuation real notes actually contain
  card: { event: 'card.added', card: 'a1b2c3d4e5f60718', lane: 'now',
          title: 'Ship the tour — "final" cut', note: 'line one\nline two\ttabbed', who: 'KW' },
  // keys deliberately out of order: JCS must sort them, so this must equal `sorted`
  unsorted: { z: 1, a: 2, m: { q: 'x', b: [1, 2, 3] } },
  sorted:   { a: 2, m: { b: [1, 2, 3], q: 'x' }, z: 1 },
  // the shapes that break naive canonicalizers
  empty: {},
  nested: { a: [{ b: {} }, [], [0, -1, 9007199254740991]], c: null, d: false },
  unicode: { 'é': 'café', 'z': 'naïve', 'a': '日本語', 'emoji': 'a🙂b' },
  // a full nine-key wave pre-image, which is what frame_hash is taken over
  preimage: {
    spec: 'rapp/1', kind: 'memory.save',
    stream_id: 'rappid:@kody-w/workroom:' + 'a'.repeat(64) + ':' + 'b'.repeat(16),
    seq: 3, utc: '2026-08-29T04:05:06.007Z',
    payload: { event: 'card.moved', card: 'a1b2c3d4e5f60718', lane: 'done', titleAt: 'Ship it' },
    payload_hash: 'c'.repeat(64), prev: 'd'.repeat(64), prev_wave: null,
  },
};

/* ── the JS side ──────────────────────────────────────────────────────────── */
const js = {};
for (const [name, v] of Object.entries(cases)) {
  js[name] = {
    canonical: canonical(v),
    particle: await H('rapp/1:particle', v),
    wave: await H('rapp/1:wave', v),
  };
}

/* ── the Python side, using the reference implementation itself ───────────── */
const pyFile = join(here, '.parity.py');
writeFileSync(pyFile, `
import json, sys, importlib.util
spec = importlib.util.spec_from_file_location("rapp", ${JSON.stringify(join(RAPP1, 'rapp.py'))})
rapp = importlib.util.module_from_spec(spec); spec.loader.exec_module(rapp)
cases = json.load(open(${JSON.stringify(join(here, '.parity-cases.json'))}))
out = {}
for name, v in cases.items():
    out[name] = { "canonical": rapp.canonical(v),
                  "particle": rapp.H("rapp/1:particle", v),
                  "wave":     rapp.H("rapp/1:wave", v) }
print(json.dumps(out))
`);
writeFileSync(join(here, '.parity-cases.json'), JSON.stringify(cases));
let py;
try {
  py = JSON.parse(execFileSync('python3', [pyFile], { encoding: 'utf8' }));
} catch (e) {
  console.error('could not run the reference implementation at ' + RAPP1);
  console.error(String(e.stderr || e.message).split('\n').slice(0, 4).join('\n'));
  process.exit(2);
}

/* ── compare ──────────────────────────────────────────────────────────────── */
let bad = 0;
const pad = (s, n) => s + ' '.repeat(Math.max(0, n - s.length));
console.log('case          canonical  particle  wave');
for (const name of Object.keys(cases)) {
  const a = js[name], b = py[name];
  const c = a.canonical === b.canonical, p = a.particle === b.particle, w = a.wave === b.wave;
  if (!c || !p || !w) bad++;
  console.log('  ' + pad(name, 12) + '  ' + pad(c ? 'same' : 'DIFFERS', 9)
              + '  ' + pad(p ? 'same' : 'DIFFERS', 8) + '  ' + (w ? 'same' : 'DIFFERS'));
  if (!c) {
    console.log('      js: ' + a.canonical);
    console.log('      py: ' + b.canonical);
  }
}
// the sort test only means something if the two orderings really did converge
if (js.unsorted.particle !== js.sorted.particle) {
  console.log('\n  key ordering: DIFFERS — JCS sorting is not being applied');
  bad++;
} else {
  console.log('\n  key ordering: the same object written two ways hashes identically');
}
console.log(bad ? `\n${bad} case(s) disagree with the reference — this is NOT rapp/1`
                : '\nevery case agrees with kody-w/rapp-1 rapp.py, byte for byte');
process.exit(bad ? 1 : 0);

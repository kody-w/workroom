import { chromium } from 'playwright';
import { readFileSync, writeFileSync } from 'node:fs';
const here = '/Users/kodywildfeuer/workroom';
const URL = 'file://' + here + '/index.html';
const html = readFileSync(here + '/index.html', 'utf8');
const prim = html.slice(html.indexOf('/* ── §4 canonicalization'), html.indexOf('/* ── state '));
const { H } = await import('data:text/javascript,' + encodeURIComponent(prim + '\nexport { canonical, H };'));

const sid = 'rappid:@kody-w/workroom:' + 'a'.repeat(64) + ':' + 'b'.repeat(16);
const JWS = 'eyJhbGciOiJFZERTQSJ9..c2lnbmF0dXJlLWJ5dGVzLWdvLWhlcmU';
async function mk(kind, seq, payload, prev, utc, sig) {
  const payload_hash = await H('rapp/1:particle', payload);
  const pre = { spec:'rapp/1', kind, stream_id:sid, seq, utc, payload, payload_hash, prev, prev_wave:null };
  return { ...pre, frame_hash: await H('rapp/1:wave', pre), sig: sig === undefined ? null : sig };
}
// §12.1 step 2: a legitimate re-genesis genesis — registered kind, owner-signed,
// payload exactly {migrated_from:{stream_id, terminal_seal, terminal_seq}}
const g = await mk('memory.re-genesis', 0,
  { migrated_from: { stream_id: 'rappid:@kody-w/workroom:' + 'c'.repeat(64) + ':' + 'd'.repeat(16),
                     terminal_seal: 'e'.repeat(64), terminal_seq: 40 } },
  null, '2026-08-29T00:00:00.000Z', JWS);
const f1 = await mk('memory.save', 1,
  { event:'card.added', card:'aaaa1111', lane:'now', title:'after the convergence', note:'', who:'' },
  g.payload_hash, '2026-08-29T00:00:01.000Z');
const chain = { stream_id: sid, frames: [g, f1] };
writeFileSync('/private/tmp/claude-501/-Users-kodywildfeuer/8abddf55-7823-48b1-b9d9-d9f458ebe875/scratchpad/regen.json', JSON.stringify(chain));

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1200, height: 800 } });
const p = await ctx.newPage();
p.on('dialog', d => d.accept());
await p.goto(URL);
await p.waitForFunction(() => document.querySelectorAll('.lane').length === 4);
await p.click('#reset'); await p.waitForTimeout(300);
await p.click('#import'); await p.fill('#io-text', JSON.stringify(chain)); await p.click('#io-ok');
await p.waitForTimeout(400);
console.log('app on the re-genesis chain:', (await p.textContent('#status')).trim().replace(/\s+/g,' '));
// and ALL the problems it lists, via its own verifier
const all = await p.evaluate(c => verifyChain(c.frames, c.stream_id), chain);
console.log('app problems:', JSON.stringify(all, null, 1));
await browser.close();

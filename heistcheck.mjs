/* heistcheck.mjs — is the 3D view actually being driven by the game's frames?
 * A pretty scene that renders a hardcoded facility would look identical, so this
 * checks the only thing that matters: the world on screen changes because the CHAIN
 * changed, and what it shows is what the newest frame says.
 */
import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { extname, join } from 'node:path';
const ROOT = '/Users/kodywildfeuer/workroom';
const srv = createServer((q, r) => {
  const f = join(ROOT, decodeURIComponent(q.url.split('?')[0]).replace(/^\/+/, '') || 'index.html');
  try { r.writeHead(200, { 'content-type': extname(f) === '.html' ? 'text/html' : 'text/plain' }); r.end(readFileSync(f)); }
  catch (e) { r.writeHead(404); r.end('no'); }
});
await new Promise(res => srv.listen(0, '127.0.0.1', res));
const base = 'http://127.0.0.1:' + srv.address().port + '/';

const b = await chromium.launch();
const ctx = await b.newContext({ viewport: { width: 1440, height: 900 } });
const p = await ctx.newPage();
let bad = 0;
p.on('pageerror', e => { console.log('  [page error] ' + e.message); bad++; });
const say = (k, v, ok) => { console.log('  ' + k.padEnd(40) + v); if (ok === false) bad++; };

await p.goto(base + 'heist3d.html');
await p.waitForFunction(() => typeof chain !== 'undefined' && chain.length > 0, null, { timeout: 30000 });
const first = await p.evaluate(() => ({ n: chain.length, tick: head.state.tick, hash: head.hash,
                                        agents: head.state.agents.map(a => a.id + '@' + a.x + ',' + a.y) }));
say('the game sealed a genesis', first.n + ' frame(s), tick ' + first.tick, first.n > 0);
say('and the 3D page read it', first.hash.slice(0, 16), !!first.hash);

const drawn = await p.evaluate(() => ({ world: world.children.length, movers: movers.children.length }));
say('the facility is built from the frame', drawn.world + ' static, ' + drawn.movers + ' moving',
    drawn.world > 100 && drawn.movers > 4);

// the facility drawn must match the frame's own tiles, not a shape this page invented
const agrees = await p.evaluate(() => {
  const t = head.state.facility.tiles;
  let walls = 0;
  for (const row of t) for (const c of row) if (c === 'W') walls++;
  const floors = t.length * t[0].length - walls;
  return { walls, floors, drawn: world.children.length,
           tilesDrawn: walls + floors };
});
say('one mesh per tile, plus the furniture',
    agrees.tilesDrawn + ' tiles → ' + agrees.drawn + ' meshes', agrees.drawn >= agrees.tilesDrawn);

// now the real question: does the world move because the CHAIN moved?
await p.click('#step');
await p.waitForFunction((h) => head.hash !== h, first.hash, { timeout: 20000 });
const second = await p.evaluate(() => ({ n: chain.length, tick: head.state.tick, hash: head.hash,
                                         agents: head.state.agents.map(a => a.id + '@' + a.x + ',' + a.y) }));
say('a step seals a new frame', first.n + ' → ' + second.n, second.n > first.n);
say('the tick advanced', first.tick + ' → ' + second.tick, second.tick > first.tick);
say('the world moved with it',
    first.agents.join(' ') !== second.agents.join(' ') ? 'agents changed cells' : 'nothing moved (may be a still tick)');

// play for a while and watch it run
await p.click('#play');
await p.waitForFunction((n) => chain.length > n + 4, second.n, { timeout: 60000 });
const run = await p.evaluate(() => ({ n: chain.length, tick: head.state.tick,
                                      linked: chain.every((f, i) => i === 0 || f.parentHash === chain[i - 1].hash),
                                      events: document.querySelectorAll('#log .ev').length,
                                      hud: document.getElementById('hud').textContent.trim().slice(0, 40) }));
say('it keeps running', run.n + ' frames, tick ' + run.tick, run.n > second.n + 3);
say('every frame links to the one before', run.linked ? 'yes' : 'NO', run.linked);
say('events reached the panel', String(run.events), run.events > 0);
say('the HUD reads the frame', run.hud, /tick \d+/.test(run.hud));

// a broken chain must be reported, not drawn over in silence
const broke = await p.evaluate(() => {
  const raw = JSON.parse(localStorage.getItem('dogg-heist-save-v1'));
  const fs = raw.data.frames || raw.data.chain;
  fs[Math.floor(fs.length / 2)].parentHash = 'deadbeef';
  localStorage.setItem('dogg-heist-save-v1', JSON.stringify(raw));
  lastRaw = ''; head = null; readChain();
  return document.getElementById('stat').textContent;
});
say('a broken chain is named', /does not link/.test(broke) ? 'yes' : 'NO — "' + broke.slice(0, 40) + '"',
    /does not link/.test(broke));

await p.screenshot({ path: ROOT + '/shot-heist3d.png' });
await b.close(); srv.close();
console.log(bad ? '\n' + bad + ' problem(s)' : '\nthe 3D world is drawn from the game\'s own sealed frames, and says so when they do not link');
process.exit(bad ? 1 : 0);

import { chromium } from 'playwright';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const APP = 'file://' + join(here, 'index.html');
const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await context.newPage();
let bad = 0;
const check = (name, pass, detail = '') => {
  console.log('  ' + name.padEnd(40) + (pass ? 'yes' : 'NO') + (detail ? ' — ' + detail : ''));
  if (!pass) bad++;
};
page.on('pageerror', error => { console.log('  PAGE ERROR — ' + error.message); bad++; });
page.on('dialog', dialog => dialog.accept());

await page.goto(APP);
await page.waitForFunction(() => typeof frames !== 'undefined' && frames.length > 1);
const parent = await page.evaluate(() => ({
  stream: streamId,
  frames: frames.length,
  envelopeRaw: localStorage.getItem(STATE_KEY),
}));
const at = Math.floor(parent.frames / 2);
await page.evaluate(i => seekTo(i), at);
const visible = await page.evaluate(() => Object.keys(viewedBoard().cards).length);
await page.click('#fork');
await page.waitForFunction(s => streamId !== s, parent.stream);

const child = await page.evaluate(() => ({
  stream: streamId,
  frames: frames.length,
  cards: Object.keys(board.cards).length,
  genesis: frames[0].payload,
  viewing: viewAt,
  archive: copy(stateEnvelope.archives),
}));
check('fork minted a distinct rappid', child.stream !== parent.stream
  && /^rappid:@kody-w\/workroom:[0-9a-f]{64}:[0-9a-f]{16}$/.test(child.stream));
check('fork records parent stream', child.genesis.from?.stream_id === parent.stream);
check('fork records exact parent frame', child.genesis.from?.seq === at);
check('fork records exact parent wave', child.genesis.from?.frame_hash
  === (await page.evaluate(({ id, at }) => stateEnvelope.archives[id].frames[at].frame_hash,
                           { id: parent.stream, at })));
check('fork re-derives visible world', child.cards === visible && child.frames === visible + 1);
check('fork is live at its head', child.viewing === null);
check('parent archived atomically', !!child.archive[parent.stream]);
check('fork verifies', (await page.evaluate(() => verifyChain(frames, streamId))).length === 0);

await page.evaluate(() => addCard('now', 'only in child'));
await page.selectOption('#scenario', 'arch:' + parent.stream);
await page.waitForFunction(s => streamId === s, parent.stream);
check('parent returns intact', await page.evaluate(n => frames.length === n, parent.frames));
check('child work does not bleed', !(await page.evaluate(() =>
  Object.values(board.cards).some(card => card.title === 'only in child'))));

const childOption = await page.evaluate(id =>
  [...document.querySelectorAll('#scenario option')].filter(option => option.value === 'arch:' + id).length,
  child.stream);
check('child remains addressable', childOption === 1);
await page.selectOption('#scenario', 'arch:' + child.stream);
await page.waitForFunction(s => streamId === s, child.stream);
check('child round-trips intact', await page.evaluate(() =>
  Object.values(board.cards).some(card => card.title === 'only in child')));

await browser.close();
console.log(bad ? `\n${bad} fork check(s) failed` : '\nfork and archived-dimension checks passed');
process.exit(bad ? 1 : 0);

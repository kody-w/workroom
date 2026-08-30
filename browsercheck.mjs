/* browsercheck.mjs — cross-browser smoke gate for every public surface.
 *
 * The exhaustive adversarial suite runs in Chromium. This smaller matrix asks a
 * different question in Chromium, Firefox, and WebKit: can each shipped page boot
 * its real local runtime, reach a verified or explicitly read-only state, and fit
 * a phone-sized viewport without an uncaught error?
 */
import { chromium, firefox, webkit } from 'playwright';
import { createServer } from 'node:http';
import { readFileSync, statSync } from 'node:fs';
import { dirname, extname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(fileURLToPath(import.meta.url));
const browserName = process.argv[2] || process.env.BROWSER || 'chromium';
const browserType = { chromium, firefox, webkit }[browserName];
if (!browserType) {
  console.error(`unknown browser ${browserName}; expected chromium, firefox, or webkit`);
  process.exit(2);
}

const contentTypes = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
};
const server = createServer((request, response) => {
  try {
    const pathname = decodeURIComponent(new URL(request.url, 'http://localhost').pathname);
    const file = resolve(root, pathname === '/' ? 'index.html' : pathname.slice(1));
    if (file !== root && !file.startsWith(root + sep)) throw new Error('outside root');
    if (!statSync(file).isFile()) throw new Error('not a file');
    response.writeHead(200, {
      'content-type': contentTypes[extname(file)] || 'application/octet-stream',
      'cache-control': 'no-store',
    });
    response.end(readFileSync(file));
  } catch {
    response.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
    response.end('not found');
  }
});
await new Promise((resolveListen, reject) => {
  server.once('error', reject);
  server.listen(0, '127.0.0.1', resolveListen);
});
const origin = `http://127.0.0.1:${server.address().port}`;

let failed = 0;
const report = (name, pass, detail) => {
  console.log(`${pass ? ' PASS' : '*FAIL'}  ${name.padEnd(34)}${detail ? ` — ${detail}` : ''}`);
  if (!pass) failed++;
};
const launchOptions = process.env.CI === 'true' ? { headless: false } : {};
if (browserName === 'firefox') {
  launchOptions.firefoxUserPrefs = {
    'webgl.disabled': false,
    'webgl.force-enabled': true,
  };
}
const browser = await browserType.launch(launchOptions);

async function open(path, ready) {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('dialog', dialog => dialog.accept());
  await page.goto(origin + path, { waitUntil: 'load' });
  await page.waitForFunction(ready, null, { timeout: 30_000 });
  return { context, page, errors };
}

try {
  {
    const { context, page, errors } = await open('/', () =>
      typeof storageMode !== 'undefined' && typeof frames !== 'undefined');
    const result = await page.evaluate(async () => ({
      frames: frames.length,
      storageMode,
      options: document.querySelectorAll('#scenario option').length,
      overflow: document.documentElement.scrollWidth - innerWidth,
      problems: frames.length ? (await verifyChain(frames, streamId)).length : null,
      status: document.getElementById('status').textContent,
    }));
    report('Workroom boots', errors.length === 0 && result.frames > 0 &&
      result.options >= 3 && result.overflow <= 1 && result.problems === 0,
    `${result.frames} frames · ${result.storageMode} · ${result.options} examples`);
    await context.close();
  }

  {
    const { context, page, errors } = await open('/broadcast.html', () =>
      typeof wireFrames !== 'undefined' && wireFrames.length > 0);
    const result = await page.evaluate(() => ({
      frames: wireFrames.length,
      overflow: document.documentElement.scrollWidth - innerWidth,
      status: document.getElementById('stat').textContent,
    }));
    report('Studio rebuilds the wire', errors.length === 0 &&
      result.frames > 0 && result.overflow <= 1 && /verified/i.test(result.status),
    `${result.frames} frames`);
    await context.close();
  }

  {
    const { context, page, errors } = await open('/heist3d.html', () =>
      !!window.__heist3d?.state().headHash);
    const result = await page.evaluate(() => ({
      authorities: document.querySelectorAll('iframe[src$="dogg-heist.html"]').length,
      head: window.__heist3d.state().headHash,
      overflow: document.documentElement.scrollWidth - innerWidth,
    }));
    report('Heist has one authority', errors.length === 0 &&
      result.authorities === 1 && !!result.head && result.overflow <= 1,
    `${result.authorities} authority`);
    await context.close();
  }

  {
    const { context, page, errors } = await open('/nexus3d.html', () =>
      window.__nexusReady === true);
    const result = await page.evaluate(async () => ({
      frames: frames.length,
      overflow: document.documentElement.scrollWidth - innerWidth,
      status: document.getElementById('stat').textContent,
      problems: frames.length ? (await verifyChain(frames, streamId)).length : null,
      renderer: typeof THREE === 'object' && document.querySelectorAll('#view canvas').length === 1,
    }));
    const valid = result.frames > 0 && result.problems === 0 && result.renderer;
    report('Nexus reaches an honest state', errors.length === 0 && valid && result.overflow <= 1,
      `${result.frames} frames · ${result.status.slice(0, 52)}`);
    await context.close();
  }

  {
    const { context, page, errors } = await open('/arena.html', () =>
      typeof W !== 'undefined' && W !== null);
    const result = await page.evaluate(async () => ({
      frames: frames.length,
      overflow: document.documentElement.scrollWidth - innerWidth,
      status: document.getElementById('stat').textContent,
      problems: frames.length ? (await verifyChain(frames, streamId)).length : null,
    }));
    const valid = result.frames > 0 ? result.problems === 0 : /read-only|unavailable|could not/i.test(result.status);
    report('Arena reaches an honest state', errors.length === 0 && valid && result.overflow <= 1,
      `${result.frames} frames · ${result.status.slice(0, 52)}`);
    await context.close();
  }
} finally {
  await browser.close();
  await new Promise(resolveClose => server.close(resolveClose));
}

console.log(failed
  ? `\n${browserName}: ${failed} cross-browser smoke check(s) failed`
  : `\n${browserName}: every public surface booted cleanly`);
process.exit(failed ? 1 : 0);

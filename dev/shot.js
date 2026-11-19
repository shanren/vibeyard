#!/usr/bin/env node
/**
 * Screenshot the dev harness with headless Chrome over CDP.
 *
 *   node dev/shot.js out.png [width] [height]
 *   DSF=2 node dev/shot.js out.png            # 2x for crisp detail
 *   ACTIONS='[{"script":"document.querySelector(\"#sidebar\").classList.toggle(\"collapsed\")"}]' node dev/shot.js out.png
 *   URL=http://localhost:5173/?noreload node dev/shot.js out.png
 *
 * Prints console errors from the page; exits non-zero if any.
 */
const { spawn } = require('child_process');
const http = require('http');
const fs = require('fs');
const os = require('os');

const CHROME = process.env.CHROME
  || 'C:/Program Files/Google/Chrome/Application/chrome.exe'
  || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
// Random port per run: a stray headless instance from an earlier run must never
// be picked up instead of the fresh one (that silently serves stale CSS).
const PORT = Number(process.env.CDP_PORT || (9300 + Math.floor(Math.random() * 600)));
const URL_ = process.env.URL || 'http://localhost:5173/?noreload';
const OUT = process.argv[2] || 'dev-shot.png';
const W = Number(process.argv[3] || 1400);
const H = Number(process.argv[4] || 900);
const DSF = Number(process.env.DSF || 1);
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const getJson = (p) => new Promise((res, rej) => {
  http.get({ host: '127.0.0.1', port: PORT, path: p }, (r) => {
    let b = ''; r.on('data', (d) => (b += d)); r.on('end', () => { try { res(JSON.parse(b)); } catch (e) { rej(e); } });
  }).on('error', rej);
});

(async () => {
  const child = spawn(CHROME, [
    '--headless=new',
    `--remote-debugging-port=${PORT}`,
    `--force-device-scale-factor=${DSF}`,
    '--hide-scrollbars', '--no-first-run', '--no-default-browser-check', '--disable-extensions',
    '--user-data-dir=' + fs.mkdtempSync(require('path').join(os.tmpdir(), 'rcode-shot-')),
    URL_,
  ], { stdio: 'ignore' });

  let page = null;
  for (let i = 0; i < 60; i++) {
    try {
      const t = await getJson('/json');
      page = t.find((x) => x.type === 'page' && x.webSocketDebuggerUrl && (x.url || '').includes('localhost'));
      if (page) break;
    } catch {}
    await wait(250);
  }
  if (!page) { console.error('no page target'); child.kill(); process.exit(1); }

  const ws = new WebSocket(page.webSocketDebuggerUrl);
  let id = 0; const pend = new Map(); const errors = [];
  ws.addEventListener('message', (ev) => {
    const m = JSON.parse(ev.data);
    if (m.id && pend.has(m.id)) { pend.get(m.id)(m); pend.delete(m.id); return; }
    if (m.method === 'Runtime.exceptionThrown') errors.push('exception: ' + (m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text));
    if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') errors.push('console.error: ' + m.params.args.map((a) => a.value ?? a.description).join(' '));
  });
  await new Promise((r) => ws.addEventListener('open', r));
  const send = (method, params) => new Promise((res) => { const i = ++id; pend.set(i, res); ws.send(JSON.stringify({ id: i, method, params })); });
  const ev = async (expr) => (await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true })).result?.result?.value;

  await send('Runtime.enable', {});
  await send('Page.enable', {});
  await send('Emulation.setDeviceMetricsOverride', { width: W, height: H, deviceScaleFactor: DSF, mobile: false });
  await wait(2200);

  if (process.env.ACTIONS) {
    for (const a of JSON.parse(process.env.ACTIONS)) { await ev(a.script); await wait(a.wait ?? 350); }
  }
  if (process.env.PROBE) console.log('probe:', await ev(process.env.PROBE));

  const shot = await send('Page.captureScreenshot', { format: 'png' });
  fs.writeFileSync(OUT, Buffer.from(shot.result.data, 'base64'));
  console.log(`shot ${OUT} ${fs.statSync(OUT).size}B @${W}x${H}×${DSF}`);
  console.log('errors:', errors.length ? errors.slice(0, 6) : 'none');
  // Shut the browser down through the protocol so no headless process is left
  // holding the CDP port (a stray instance makes the next run reuse stale CSS).
  await send('Browser.close', {}).catch(() => {});
  await wait(200);
  ws.close();
  try {
    child.kill();
  } catch {}
  process.exit(errors.length ? 1 : 0);
})();

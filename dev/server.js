#!/usr/bin/env node
/**
 * Browser harness server for the renderer.
 *
 *   npm run dev:web        # build once, then serve http://localhost:5173
 *   npm run dev:web:watch  # same, but rebuild the renderer on every change
 *
 * Serves `dist/renderer` with `dev/mock-bridge.js` injected ahead of the bundle,
 * so the real UI runs in Chrome/Edge without Electron. Edit CSS or TS, refresh
 * (or let watch rebuild and the page auto-reload), inspect in devtools.
 */

const http = require('http');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const DIST = path.join(ROOT, 'dist', 'renderer');
const MOCK = path.join(__dirname, 'mock-bridge.js');
const PORT = Number(process.env.PORT || 5173);
const WATCH = process.argv.includes('--watch');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.woff2': 'font/woff2',
  '.map': 'application/json; charset=utf-8',
};

const mtime = (p) => {
  try {
    return Math.round(fs.statSync(p).mtimeMs).toString(36);
  } catch {
    return '0';
  }
};

/** Clients waiting on the reload endpoint (long-poll). */
let reloadClients = [];

function reloadPage() {
  for (const res of reloadClients) {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end('reload');
  }
  reloadClients = [];
}

function serveIndex(res) {
  const html = fs.readFileSync(path.join(DIST, 'index.html'), 'utf8');
  // Same-origin, so the CSP in index.html (`script-src 'self'`) still allows it.
  // Every asset URL carries its mtime so a reload always picks up the new build.
  const injected = html
    .replace('href="styles.css"', `href="styles.css?v=${mtime(path.join(DIST, 'styles.css'))}"`)
    // Match the bundle tag whatever attributes it carries (`defer`, a version query…).
    .replace(
      /<script src="index\.js"[^>]*><\/script>/,
      `<script src="mock-bridge.js?v=${mtime(MOCK)}"></script>
  <script src="index.js?v=${mtime(path.join(DIST, 'index.js'))}" defer></script>`,
    )
    .replace('</body>', `  <script>
    // Auto reload when the build changes (dev:web:watch).
    (function () {
      const poll = () => fetch('/__reload').then((r) => r.text()).then(() => location.reload()).catch(() => setTimeout(poll, 1000));
      if (location.search.includes('noreload') === false) poll();
    })();
  </script>\n</body>`);
  res.writeHead(200, { 'Content-Type': MIME['.html'], 'Cache-Control': 'no-store' });
  res.end(injected);
}

const server = http.createServer((req, res) => {
  const url = (req.url || '/').split('?')[0];

  if (url === '/__reload') {
    reloadClients.push(res);
    return;
  }

  if (url === '/' || url === '/index.html') return serveIndex(res);

  if (url === '/styles.css') {
    // Serve dynamically so every @import carries its own version stamp.
    const cssPath = path.join(DIST, 'styles.css');
    const css = fs
      .readFileSync(cssPath, 'utf8')
      .replace(/url\('\.\/styles\/([a-z-]+\.css)'\)/g, (_m, file) =>
        `url('./styles/${file}?v=${mtime(path.join(DIST, 'styles', file))}')`);
    res.writeHead(200, { 'Content-Type': MIME['.css'], 'Cache-Control': 'no-store' });
    return res.end(css);
  }

  if (url === '/mock-bridge.js') {
    res.writeHead(200, { 'Content-Type': MIME['.js'], 'Cache-Control': 'no-store' });
    return res.end(fs.readFileSync(MOCK));
  }

  const filePath = path.join(DIST, decodeURIComponent(url));
  if (!filePath.startsWith(DIST) || !fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
    res.writeHead(404, { 'Content-Type': 'text/plain' });
    return res.end('not found');
  }

  res.writeHead(200, {
    'Content-Type': MIME[path.extname(filePath)] ?? 'application/octet-stream',
    'Cache-Control': 'no-store',
  });
  fs.createReadStream(filePath).pipe(res);
});

if (WATCH) {
  const esbuild = spawn(
    process.platform === 'win32' ? 'npx.cmd' : 'npx',
    [
      'esbuild',
      'src/renderer/index.ts',
      '--bundle',
      '--outfile=dist/renderer/index.js',
      '--platform=browser',
      '--format=iife',
      '--target=es2022',
      '--sourcemap',
      '--loader:.ts=ts',
      '--watch',
    ],
    { cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'], shell: process.platform === 'win32' },
  );
  esbuild.stdout.on('data', (chunk) => {
    const text = chunk.toString();
    process.stdout.write(text);
    if (/Done in|⚡/.test(text)) {
      // CSS is copied separately; refresh anyway so style edits land.
      setTimeout(reloadPage, 120);
    }
  });
  esbuild.stderr.on('data', (chunk) => process.stderr.write(chunk));

  // Watch the styles directory too (esbuild does not copy it).
  const stylesDir = path.join(ROOT, 'src', 'renderer', 'styles');
  let copyTimer = null;
  const copyStyles = () => {
    fs.cpSync(stylesDir, path.join(DIST, 'styles'), { recursive: true });
    fs.copyFileSync(path.join(ROOT, 'src', 'renderer', 'styles.css'), path.join(DIST, 'styles.css'));
    reloadPage();
  };
  for (const dir of [stylesDir]) {
    fs.watch(dir, { recursive: true }, () => {
      clearTimeout(copyTimer);
      copyTimer = setTimeout(copyStyles, 80);
    });
  }
  fs.watch(path.join(ROOT, 'src', 'renderer', 'styles.css'), () => {
    clearTimeout(copyTimer);
    copyTimer = setTimeout(copyStyles, 80);
  });
}

server.listen(PORT, () => {
  console.log(`[dev] renderer harness → http://localhost:${PORT}`);
  console.log(`[dev] appending ?noreload disables the auto-reload poll`);
  if (!WATCH) console.log('[dev] static mode — run `npm run dev:web:watch` to rebuild on change');
});

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const server = http.createServer((req, res) => {
  let p = decodeURIComponent(req.url.split('?')[0]);
  if (p === '/') p = '/index.html';
  const f = path.join(ROOT, p);
  if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); res.end(); return; }
  res.writeHead(200, { 'Content-Type': /\.js$/.test(p) ? 'text/javascript' : 'text/html' });
  fs.createReadStream(f).pipe(res);
});
await new Promise((r) => server.listen(8778, '127.0.0.1', r));
const require = createRequire('C:/Users/11603/.workbuddy/binaries/node/workspace/package.json');
const { chromium } = require('playwright-core');
const browser = await chromium.launch({ executablePath: 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', headless: true, args: ['--no-sandbox'] });
const page = await (await browser.newContext()).newPage();
page.on('console', (m) => console.log('[页] ' + m.text()));
await page.goto('http://127.0.0.1:8778/index.html', { waitUntil: 'load' });
await page.waitForTimeout(1000);
const res = await page.evaluate(async () => {
  const out = { steps: [] };
  const log = (m) => out.steps.push(m);
  // 手动建桥（复刻 cloud.js ensureBridge）
  const ifr = document.createElement('iframe');
  ifr.style.display = 'none';
  ifr.src = 'https://astrix.app.workbuddy.host/cloud-bridge.html?origin=' + encodeURIComponent(location.origin) + '&v=20.17';
  document.body.appendChild(ifr);
  log('插入后 contentWindow=' + !!ifr.contentWindow);
  const ready = await new Promise((resolve) => {
    let done = false;
    window.addEventListener('message', (ev) => {
      if (ev.origin !== 'https://astrix.app.workbuddy.host') return;
      const m = ev.data;
      if (m && m.__astrixBridge && m.ready && !done) { done = true; resolve(true); }
    });
    setTimeout(() => { if (!done) resolve('12s超时'); }, 12000);
  });
  log('握手=' + ready);
  if (ready === true) {
    const C = await import('/js/core/cloud.js?v=20.17');
    const reg = await C.registerWithName('探针A', 'test-1234');
    log('register=' + JSON.stringify(reg));
    const s = C.cloudStatus();
    log('status=' + JSON.stringify(s));
  }
  return out;
});
console.log(JSON.stringify(res, null, 1));
await browser.close();
server.close();

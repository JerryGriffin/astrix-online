// v0.2.9 桥接诊断：手动复刻桥接链路，逐层报告
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
await new Promise((r) => server.listen(8774, '127.0.0.1', r));
const require = createRequire('C:/Users/11603/.workbuddy/binaries/node/workspace/package.json');
const { chromium } = require('playwright-core');
const browser = await chromium.launch({ executablePath: 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', headless: true, args: ['--no-sandbox'] });
const page = await (await browser.newContext()).newPage();
page.on('console', (m) => console.log('[页] ' + m.text()));
await page.goto('http://127.0.0.1:8774/index.html', { waitUntil: 'load' });
await page.waitForTimeout(800);
const res = await page.evaluate(async () => {
  const out = { logs: [] };
  const log = (m) => out.logs.push(m);
  // 1) 模块是否正常导入 & isNative 语义
  const C = await import('/js/core/cloud.js?v=20.16');
  log('cloud 导入 ok, status=' + JSON.stringify(C.cloudStatus()));
  // 2) 手动复刻 iframe 链路
  const ifr = document.createElement('iframe');
  ifr.style.display = 'none';
  ifr.src = 'https://astrix.app.workbuddy.host/cloud-bridge.html?origin=' + encodeURIComponent(location.origin) + '&v=20.16';
  log('contentWindow 存在=' + !!ifr.contentWindow);
  const got = await new Promise((resolve) => {
    let done = false;
    window.addEventListener('message', (ev) => {
      if (ev.origin !== 'https://astrix.app.workbuddy.host') { log('忽略来自 ' + ev.origin + ' 的消息'); return; }
      const m = ev.data;
      if (!m || m.__astrixBridge !== true) return;
      if (m.ready) { done = true; resolve('ready收到'); }
    });
    document.body.appendChild(ifr);
    setTimeout(() => { if (!done) resolve('8s超时未收到ready'); }, 8000);
  });
  log('握手: ' + got);
  // 3) 若握手成功，走一次 ensureReady
  if (got === 'ready收到') {
    const ok = await C.ensureReady();
    out.ensureReady = ok;
    out.status = C.cloudStatus();
  }
  return out;
});
console.log(JSON.stringify(res, null, 1).slice(0, 1200));
await browser.close();
server.close();

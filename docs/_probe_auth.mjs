// v0.2.10 账号名登录探针：本地（桥接模式）→ 线上桥页 → 真实云 —— signUp/signIn 全链路
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
await page.goto('http://127.0.0.1:8778/index.html', { waitUntil: 'load' });
await page.waitForTimeout(1000);
const NAME = 'probe' + Math.floor(Math.random() * 1e9).toString(36);
const PW = 'probe-pass-123';
const res = await page.evaluate(async ({ NAME, PW }) => {
  const C = await import('/js/core/cloud.js?v=20.16');
  const email = C.astrixEmailOf(NAME);
  const ok1 = await C.ensureReady();
  const su = await C.signUpWithPassword(email, PW);
  const si = await C.signInWithPassword(email, PW);
  const status = C.cloudStatus();
  return { email, ready: ok1, signUpOk: su.ok, signUpReason: su.reason || '', signInOk: si.ok, signInReason: si.reason || '', user: status.user };
}, { NAME, PW });
console.log('账号名:', NAME);
console.log(JSON.stringify(res, null, 1));
await browser.close();
server.close();
const pass = res.ready && res.signUpOk && res.signInOk && res.user && res.user.email === res.email;
console.log(pass ? '探针通过' : '探针失败');
process.exit(pass ? 0 : 1);

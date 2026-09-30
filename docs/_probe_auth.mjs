// v0.2.10 账号名登录探针 v2：registerWithName/loginWithName → 真实云（player_accounts 表）
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
const NAME = '探针玩家' + Math.floor(Math.random() * 1e6);
const PW = 'probe-pass-123';
const res = await page.evaluate(async ({ NAME, PW }) => {
  const C = await import('/js/core/cloud.js?v=26.9');
  await C.ensureReady();
  const reg = await C.registerWithName(NAME, PW);
  const uid = reg.user ? reg.user.id : null;
  const log = await C.loginWithName(NAME, PW);
  const logBad = await C.loginWithName(NAME, 'wrong-pass');
  const dup = await C.registerWithName(NAME, PW);
  const status = C.cloudStatus();
  return {
    regOk: reg.ok, uid,
    logOk: log.ok, logUser: log.user ? log.user.id : null,
    logBadOk: logBad.ok, logBadReason: logBad.reason,
    dupOk: dup.ok, dupReason: dup.reason,
    statusUser: status.user,
  };
}, { NAME, PW });
console.log('账号名:', NAME);
console.log(JSON.stringify(res, null, 1));
await browser.close();
server.close();
const pass = res.regOk && res.uid && res.uid.startsWith('n_') && res.logOk && res.logUser === res.uid
  && !res.logBadOk && /密码错误/.test(res.logBadReason) && !res.dupOk && /已存在/.test(res.dupReason)
  && res.statusUser && res.statusUser.id === res.uid;
console.log(pass ? '探针通过' : '探针失败');
process.exit(pass ? 0 : 1);

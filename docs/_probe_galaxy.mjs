// v0.2.10 星系页探针：真实浏览器 + 假 SDK，检查 NPC 星球卡渲染
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
await new Promise((r) => server.listen(8777, '127.0.0.1', r));
const require = createRequire('C:/Users/11603/.workbuddy/binaries/node/workspace/package.json');
const { chromium } = require('playwright-core');
const browser = await chromium.launch({ executablePath: 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', headless: true, args: ['--no-sandbox'] });
const page = await (await browser.newContext()).newPage();
const errs = [];
page.on('pageerror', (e) => errs.push(e.message));
page.on('console', (m) => { if (m.type() === 'error') errs.push('[console] ' + m.text()); });
await page.goto('http://127.0.0.1:8777/index.html', { waitUntil: 'load' });
await page.waitForTimeout(1000);
const res = await page.evaluate(async () => {
  // 注入假 SDK（render selfcheck 同款）
  const chain = new Proxy({}, { get: (t, p) => (p === 'then' ? undefined : (..._a) => chain) });
  window.WorkBuddyCloud = {
    createWorkBuddyCloud: () => ({
      auth: { getSession: async () => ({ data: null, error: null }) },
      database: chain,
    }),
  };
  const G = await import('/js/ui/galaxy.js?v=20.14');
  const S = await import('/js/core/state.js?v=20.14');
  const acc = S.currentAccount() || { id: 't', name: '测试', homePlanetCode: 'syl', tech: [] };
  S.STATE.mode = 'online';
  const root = document.createElement('div');
  document.body.appendChild(root);
  const errs2 = [];
  window.addEventListener('unhandledrejection', (e) => errs2.push(String(e.reason)));
  G.renderGalaxy(root, {
    account: acc, planetCode: 'syl',
    openModal: () => () => {}, closeModal: () => {}, onEnterPlanet: () => {},
  });
  await new Promise((r) => setTimeout(r, 1500));
  const txt = root.textContent || '';
  return {
    errs: errs2,
    hasNpcCard: txt.includes('熔炉前哨') && txt.includes('皇家堡垒'),
    npcCount: (txt.match(/电脑势力/g) || []).length,
    hasAllianceBtn: txt.includes('结盟'),
    hasColony: txt.includes('我的殖民地'),
    snippet: txt.replace(/\s+/g, ' ').slice(0, 300),
  };
});
console.log(JSON.stringify(res, null, 1));
console.log('页面异常:', errs.length ? errs.slice(0, 5) : '无');
await browser.close();
server.close();
process.exit(res.hasNpcCard && !errs.length ? 0 : 1);

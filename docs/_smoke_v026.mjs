// v0.2.6 冒烟：① 新建存档的 1936 剧本（国家选择 + 真实数据预览）② 剧情国家星球卡（宣战）
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
await new Promise((r) => server.listen(8780, '127.0.0.1', r));
const require = createRequire('C:/Users/11603/.workbuddy/binaries/node/workspace/package.json');
const { chromium } = require('playwright-core');
const browser = await chromium.launch({ executablePath: 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', headless: true, args: ['--no-sandbox'] });
const page = await (await browser.newContext()).newPage();
const errs = [];
page.on('pageerror', (e) => errs.push(e.message));
await page.goto('http://127.0.0.1:8780/index.html', { waitUntil: 'load' });
await page.waitForTimeout(1200);

// ---- A. 开始界面：离线模式 → 新建存档 → 选 1936 剧本 ----
await page.evaluate(() => {
  const b = Array.from(document.querySelectorAll('button')).find((x) => x.textContent.includes('离线模式'));
  b.click();
});
await page.waitForTimeout(600);
// 先看当前界面是否已有开局模式按钮；没有则点「新建存档」打开表单
const stepAClick = await page.evaluate(() => {
  const scope = document.body;
  const has1936 = Array.from(scope.querySelectorAll('button')).some((x) => x.textContent.trim() === '1936 剧本');
  if (has1936) return { opened: false };
  const add = Array.from(scope.querySelectorAll('button')).find((x) => x.textContent.includes('新建存档'));
  if (!add) return { err: '没找到新建存档按钮' };
  add.click();
  return { opened: true };
});
await page.waitForTimeout(400);
const stepA = await page.evaluate(() => {
  const scope = document.body;
  const mode = Array.from(scope.querySelectorAll('button')).find((x) => x.textContent.trim() === '1936 剧本');
  if (!mode) {
    return { err: '没有 1936 剧本模式按钮', buttons: Array.from(scope.querySelectorAll('button')).map((x) => x.textContent.trim()).slice(0, 16) };
  }
  mode.click();
  const sel = scope.querySelector('select');
  const info = scope.textContent;
  return {
    hasSelect: !!sel,
    optionCount: sel ? sel.options.length : 0,
    firstOption: sel ? sel.options[0].textContent : '',
    infoHasData: info.includes('人口 69.3') && info.includes('工业 48') && info.includes('非洲属地'),
  };
});
console.log('A. 1936 选国界面:', JSON.stringify(stepA));
const aOk = stepA.hasSelect && stepA.optionCount === 12 && stepA.infoHasData;

// ---- B. 场景国家星球卡（假 SDK + 1936 账号渲染星际页） ----
const resB = await page.evaluate(async () => {
  const chain = new Proxy({}, { get: (t, p) => (p === 'then' ? undefined : (..._a) => chain) });
  window.WorkBuddyCloud = { createWorkBuddyCloud: () => ({ auth: { getSession: async () => ({ data: null, error: null }) }, database: chain }) };
  const S = await import('/js/core/state.js?v=26.1');
  S.STATE.adapter = { get: () => null, set: () => {}, del: () => {} };
  const acc = S.createAccount('冒烟德国', 'hoi1936', { countryId: 'ger' });
  S.STATE.mode = 'online';
  const G = await import('/js/ui/galaxy.js?v=26.1');
  const root = document.createElement('div');
  document.body.appendChild(root);
  G.renderGalaxy(root, { account: acc, planetCode: acc.homePlanetCode, openModal: () => () => {}, closeModal: () => {}, onEnterPlanet: () => {} });
  await new Promise((r) => setTimeout(r, 900));
  const txt = root.textContent;
  return {
    npcNations: ['苏维埃联盟', '不列颠', '美利坚', '中国'].filter((x) => txt.includes(x)).length,
    hasDataCard: txt.includes('人口 168 百万') && txt.includes('陆军 92 师'),
    hasWarBtn: txt.includes('宣战'),
    noGermanSelf: !txt.includes('德意志国'),
  };
});
console.log('B. 场景国家星球:', JSON.stringify(resB));
console.log('页面异常:', errs.length ? errs.slice(0, 3) : '无');
await browser.close();
server.close();
const bOk = resB.npcNations === 4 && resB.hasDataCard && resB.hasWarBtn && resB.noGermanSelf;
console.log(aOk && bOk && !errs.length ? '冒烟通过' : '冒烟失败');
process.exit(aOk && bOk && !errs.length ? 0 : 1);

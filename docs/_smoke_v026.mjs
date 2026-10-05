// v0.2.6 冒烟：① 新建存档的 1936 剧本（国家选择 + 真实数据预览）② 剧情国家星球卡（宣战）
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
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
// v0.4.7：版本串不再写死 —— 本脚本此前硬编码 ?v=32.1，而页面加载的是当前 CACHE_TAG，
//   于是 state.js 出现**两个模块实例**（STATE 单例分裂）→ currentAccount() 恒 null，
//   国策 / 舰船 / 殖民地 / 舰队各段断言全部假失败。现从 version.js 动态取。
const { CACHE_TAG } = await import(pathToFileURL(join(ROOT, 'js/version.js')).href);
const browser = await chromium.launch({ executablePath: 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', headless: true, args: ['--no-sandbox'] });
const page = await (await browser.newContext()).newPage();
// v0.4.7：把 CACHE_TAG 注入浏览器上下文。
//   page.evaluate 的回调在**浏览器侧**执行，拿不到 Node 侧的 CACHE_TAG 变量，
//   必须先通过 evaluate 传进去；否则模板串会插值成 undefined，
//   请求 `?v=undefined` 导致模块加载失败（表现为整段断言假失败）。
const errs = [];
const consoleErrs = [];
page.on('pageerror', (e) => errs.push(e.message));
page.on('console', (m) => { if (m.type() === 'error') consoleErrs.push(m.text()); });
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
  const has1936 = Array.from(scope.querySelectorAll('button')).some((x) => x.textContent.trim() === '风暴前夜');
  if (has1936) return { opened: false };
  const add = Array.from(scope.querySelectorAll('button')).find((x) => x.textContent.includes('新建存档'));
  if (!add) return { err: '没找到新建存档按钮' };
  add.click();
  return { opened: true };
});
await page.waitForTimeout(400);
const stepA = await page.evaluate(() => {
  const scope = document.body;
  const mode = Array.from(scope.querySelectorAll('button')).find((x) => x.textContent.trim() === '风暴前夜');
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
    infoHasData: info.includes('人口 69.3') && /工业 \d+/.test(info) && info.includes('非洲属地'),
  };
});
console.log('A. 1936 选国界面:', JSON.stringify(stepA));
// v0.4.7：国家数不再写死 12 —— HOI_NATIONS 已扩到 15（新增奥地利 / 捷克斯洛伐克 / 埃塞俄比亚），
//   写死会让数据表一扩充就假失败。改为与数据表比对。
const resA = await page.evaluate(async () => ({ n: (await import('/js/data/hoi1936.js')).HOI_NATIONS.length }));
const aOk = stepA.hasSelect && stepA.optionCount === resA.n && stepA.infoHasData;

// ---- B. 场景国家星球卡（假 SDK + 1936 账号渲染星际页） ----
const resB = await page.evaluate(async () => {
  const CACHE_TAG = (await import('/js/version.js')).CACHE_TAG;
  const chain = new Proxy({}, { get: (t, p) => (p === 'then' ? undefined : (..._a) => chain) });
  window.WorkBuddyCloud = { createWorkBuddyCloud: () => ({ auth: { getSession: async () => ({ data: null, error: null }) }, database: chain }) };
  const S = await import(`/js/core/state.js?v=${CACHE_TAG}`);
  S.STATE.adapter = { get: () => null, set: () => {}, del: () => {} };
  const acc = S.createAccount('冒烟德国', 'hoi1936', { countryId: 'ger' });
  S.STATE.mode = 'online';
  const G = await import(`/js/ui/galaxy.js?v=${CACHE_TAG}`);
  const root = document.createElement('div');
  document.body.appendChild(root);
  G.renderGalaxy(root, { account: acc, planetCode: acc.homePlanetCode, openModal: () => () => {}, closeModal: () => {}, onEnterPlanet: () => {} });
  await new Promise((r) => setTimeout(r, 900));
  const txt = root.textContent;
  return {
    npcNations: ['苏维埃联盟', '不列颠', '美利坚', '中国'].filter((x) => txt.includes(x)).length,
    hasDataCard: txt.includes('人口 168 百万') && txt.includes('陆军 92 师'),
    hasWarBtn: txt.includes('宣战') || txt.includes('正当化战争'),
    noGermanSelf: !txt.includes('德意志国'),
  };
});
console.log('B. 场景国家星球:', JSON.stringify(resB));

// ---- C. 国策面板（国策树 + 海域 + 剧本日历到天） ----
const resC = await page.evaluate(async () => {
  const CACHE_TAG = (await import('/js/version.js')).CACHE_TAG;
  const S = await import(`/js/core/state.js?v=${CACHE_TAG}`);
  const acc = S.currentAccount();
  const H = await import(`/js/ui/hoi.js?v=${CACHE_TAG}`);
  const root = document.createElement('div');
  document.body.appendChild(root);
  H.renderHoi(root, { account: acc, planetCode: acc.homePlanetCode, openModal: () => () => {}, closeModal: () => {} });
  await new Promise((r) => setTimeout(r, 500));
  const txt = root.textContent;
  return {
    date: /1936年\d+月\d+日/.test(txt),
    focusTree: txt.includes('国策') && txt.includes('工业线') && txt.includes('军事线') && txt.includes('外交线'),
    sixFocus: ['四年计划', '鲁尔扩产', '闪电战理论', '柏林—罗马轴心'].filter((x) => txt.includes(x)).length,
    // v0.4.x：海域已从地球海区改为**轨道圈层**（近地/晨昏线/同步/拉格朗日/深空/极地/气层）
    seas: ['近地轨道', '晨昏线', '同步轨道', '拉格朗日', '深空门户', '极地轨道', '气层防线'].filter((x) => txt.includes(x)).length,
    hasRecruit: txt.includes('巡航争夺')
  };
});
console.log('C. 国策面板:', JSON.stringify(resC));
const cOk = resC.date && resC.focusTree && resC.sixFocus >= 3 && resC.seas === 7 && resC.hasRecruit;

// ---- D. 舰船界面（hoi1936 历史战舰应以 HOI4 风格展示，而非「飞船」崩溃）----
const resD = await page.evaluate(async () => {
  const CACHE_TAG = (await import('/js/version.js')).CACHE_TAG;
  const S = await import(`/js/core/state.js?v=${CACHE_TAG}`);
  const acc = S.currentAccount();
  const SY = await import(`/js/ui/shipyard.js?v=${CACHE_TAG}`);
  const root = document.createElement('div');
  document.body.appendChild(root);
  SY.renderShipyard(root, { account: acc, planetCode: acc.homePlanetCode, openModal: () => () => {}, closeModal: () => {} });
  await new Promise((r) => setTimeout(r, 400));
  const txt = root.textContent;
  const m = txt.match(/.{0,12}飞船.{0,12}/);
  return {
    hasShipTitle: txt.includes('我的舰船'),
    shipCount: (acc.ships || []).length,
    hasWarshipName: /战列舰|巡洋舰|驱逐舰|潜艇|航母/.test(txt),
    noSpaceshipLabel: !/飞船(?!蓝图)/.test(txt),
    spaceshipCtx: m ? m[0] : '',
  };
});
console.log('D. 舰船界面:', JSON.stringify(resD));

// ---- E. 星球选择内「列强」区块：可见其他国家并可贸易 / 结盟 / 正当化 ----
const resE = await page.evaluate(async () => {
  const CACHE_TAG = (await import('/js/version.js')).CACHE_TAG;
  const S = await import(`/js/core/state.js?v=${CACHE_TAG}`);
  const acc = S.currentAccount();
  const COL = await import(`/js/ui/colony.js?v=${CACHE_TAG}`);
  const root = document.createElement('div');
  document.body.appendChild(root);
  let colonyErr = null;
  try {
    COL.renderColony(root, { account: acc, planetCode: acc.homePlanetCode, openModal: () => () => {}, closeModal: () => {}, onEnterPlanet: () => {} });
  } catch (e) { colonyErr = e.message + ' | ' + (e.stack || '').split('\n')[1]; }
  await new Promise((r) => setTimeout(r, 400));
  const txt = root.textContent;
  return {
    colonyErr,
    scenario: acc.scenario,
    hasGreatPowers: txt.includes('列强'),
    showsOtherNation: ['苏维埃联盟', '不列颠', '美利坚', '中国'].filter((x) => txt.includes(x)).length,
    hasTrade: txt.includes('贸易'),
    hasAlly: txt.includes('结盟'),
    hasJustify: txt.includes('正当化战争'),
  };
});
console.log('E. 星球选择列强:', JSON.stringify(resE));

// ---- F. 舰队页（hoi1936 历史战舰应以舰级显示，而非「飞船」）----
const resF = await page.evaluate(async () => {
  const CACHE_TAG = (await import('/js/version.js')).CACHE_TAG;
  const S = await import(`/js/core/state.js?v=${CACHE_TAG}`);
  const acc = S.currentAccount();
  const FL = await import(`/js/ui/fleet.js?v=${CACHE_TAG}`);
  const root = document.createElement('div');
  document.body.appendChild(root);
  FL.renderFleet(root, { account: acc, planetCode: acc.homePlanetCode, openModal: () => () => {}, closeModal: () => {} });
  await new Promise((r) => setTimeout(r, 400));
  const txt = root.textContent;
  // v0.3.2：只检查真实的「舰船条目」span，避免误判帮助文案里的「飞船」
  const shipNameSpans = Array.from(root.querySelectorAll('.fleet-ship span'));
  const shipNameText = shipNameSpans.map((s) => s.textContent).join(' | ');
  const hasFleet = txt.includes('编队') || txt.includes('舰队');
  const hasWarshipClass = /战列舰|巡洋舰|驱逐舰|潜艇|航母/.test(shipNameText);
  // 真实舰船条目绝不允许出现「飞船」兜底标签（用户核心抱怨）
  const noSpaceshipLabel = !shipNameSpans.some((s) => (s.textContent || '').includes('飞船'));
  return {
    hasFleet,
    hasWarshipClass,
    noSpaceshipLabel,
    fleetCount: (acc.fleets || []).length,
    shipEntries: shipNameText,
  };
});
console.log('F. 舰队界面:', JSON.stringify(resF));

console.log('页面异常:', errs.length ? errs.slice(0, 3) : '无');
console.log('console错误:', consoleErrs.length ? consoleErrs.slice(0, 3) : '无');
await browser.close();
server.close();
const bOk = resB.npcNations === 4 && resB.hasDataCard && resB.hasWarBtn && resB.noGermanSelf;
const dOk = resD.hasShipTitle && resD.shipCount > 0 && resD.hasWarshipName && resD.noSpaceshipLabel;
const eOk = resE.hasGreatPowers && resE.showsOtherNation >= 3 && resE.hasTrade && resE.hasAlly && resE.hasJustify;
const fOk = resF.hasFleet && resF.hasWarshipClass && resF.noSpaceshipLabel && resF.fleetCount > 0;
const allOk = aOk && bOk && cOk && dOk && eOk && fOk && !errs.length;
console.log(allOk ? '冒烟通过' : '冒烟失败');
process.exit(allOk ? 0 : 1);

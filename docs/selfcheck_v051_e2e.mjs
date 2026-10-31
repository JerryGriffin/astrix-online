// ============================================================================
// selfcheck_v051_e2e.mjs —— v0.4.24 浏览器端到端：三项新能力的「入口真的通」
//
// 单元自检（selfcheck_v051.mjs）证明算式对；这里证明**玩家点得到、点了有反应**：
//   ① 人力面板显示「总人数 / 居住容量」与「剩余床位」
//   ② 建筑面板对「科技已研究但前置建筑没造」的建筑给出「需先建成…」并禁用按钮
//   ③ 战争页出现「舰队会战」区块，勾选编队 → 点「发起舰队会战」→
//      战争分数与会战场次真的变了，结果弹窗里有逐回合战报
//
// 用法：node docs/selfcheck_v051_e2e.mjs
// ============================================================================
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { homedir } from 'node:os';
import { createRequire } from 'node:module';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const { CACHE_TAG } = await import(new URL('file://' + path.join(ROOT, 'js/version.js').replace(/\\/g, '/')).href);

let pass = 0, fail = 0;
const failures = [];
function ok(cond, name, detail) {
  if (cond) { pass++; console.log('  ✓ ' + name + (detail ? '  [' + detail + ']' : '')); }
  else {
    fail++; failures.push(name + (detail ? '  [' + detail + ']' : ''));
    console.log('  ✗ ' + name + (detail ? '  [' + detail + ']' : ''));
  }
}
function section(t) { console.log('\n' + t); }

// ---- playwright-core 多候选加载（与其它自检脚本同口径）----
const PW_CANDIDATES = [
  () => createRequire(import.meta.url)('playwright-core'),
  () => createRequire(path.join(ROOT, 'package.json'))('playwright-core'),
  () => createRequire(process.env.ASTRIX_PW_WORKSPACE
    || path.join(homedir(), '.workbuddy/binaries/node/workspace/package.json'))('playwright-core'),
];
let playwright = null; let pwErr = null;
for (const fn of PW_CANDIDATES) {
  try { playwright = fn(); break; } catch (e) { pwErr = e; }
}
if (!playwright) {
  console.error('无法加载 playwright-core：' + (pwErr && pwErr.message));
  process.exit(1);
}

// ---- 静态服务器（随机端口）----
const server = http.createServer((req, res) => {
  let p = decodeURIComponent(req.url.split('?')[0]);
  if (p === '/') p = '/index.html';
  const f = path.join(ROOT, p);
  if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); res.end(); return; }
  res.writeHead(200, { 'Content-Type': /\.js$/.test(p) ? 'text/javascript' : 'text/html' });
  fs.createReadStream(f).pipe(res);
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const PORT = server.address().port;

const BROWSER_CANDIDATES = [
  process.env.ASTRIX_BROWSER,
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
].filter(Boolean);
let executablePath = null;
for (const c of BROWSER_CANDIDATES) { if (fs.existsSync(c)) { executablePath = c; break; } }
if (!executablePath) {
  console.error('找不到可用的 Chromium 系浏览器（可用 ASTRIX_BROWSER 指定）');
  server.close(); process.exit(1);
}

const browser = await playwright.chromium.launch({ executablePath, headless: true, args: ['--no-sandbox'] });
const context = await browser.newContext();
const page = await context.newPage();
const pageErrs = [];
page.on('pageerror', (e) => pageErrs.push(e.message));

try {
  await page.goto(`http://127.0.0.1:${PORT}/index.html`, { waitUntil: 'load' });
  await page.waitForSelector('.screen-start', { timeout: 15000 });

  // ==========================================================================
  section('① 人力面板：总人数 / 居住容量');
  // ==========================================================================
  const popRes = await page.evaluate(async (ct) => {
    const out = {};
    try {
      const S = await import('/js/core/state.js?v=' + ct);
      S.STATE.adapter = { get: () => null, set: () => {}, del: () => {} };
      S.STATE.mode = 'offline';
      const acc = S.createAccount('e2e_pop', 'fresh');
      const inst = S.getPlanetInstance(acc.homePlanetCode);
      const P = await import('/js/ui/population.js?v=' + ct);
      const root = document.createElement('div');
      document.body.appendChild(root);
      P.renderPopulation(root, inst);
      const txt = root.textContent || '';
      out.txt = txt.slice(0, 4000);
      out.cap = txt.includes('居住容量');
      out.free = txt.includes('床位');
      out.metric = txt.includes('总人数 / 居住容量');
      out.popCap = S.popCapOf(inst);
      out.shelter = S.totalShelter(inst);
      root.remove();
    } catch (e) { out.fatal = e.message; }
    return out;
  }, CACHE_TAG);
  ok(!popRes.fatal, '人力面板渲染无致命错误', popRes.fatal || '');
  ok(popRes.cap, '出现「居住容量」字样');
  ok(popRes.metric, '主指标改为「总人数 / 居住容量」');
  ok(popRes.free, '有「床位」提示（剩余容量可见）');
  ok(popRes.popCap === Math.floor(popRes.shelter * 1.2), '容量 = 庇护 × 1.2',
    `${popRes.shelter} → ${popRes.popCap}`);

  // ==========================================================================
  section('② 建筑面板：前置建筑缺失时禁用并说明');
  // ==========================================================================
  const bldRes = await page.evaluate(async (ct) => {
    const out = {};
    try {
      const S = await import('/js/core/state.js?v=' + ct);
      const acc = S.STATE.accounts.find((a) => a.name === 'e2e_pop') || S.currentAccount();
      acc.tech = ['t_a1', 't_c1', 't_c2'];
      const inst = S.getPlanetInstance(acc.homePlanetCode);
      inst.buildings.mine_shallow = 0;
      const M = await import('/js/ui/buildings.js?v=' + ct);
      const root = document.createElement('div');
      document.body.appendChild(root);
      M.renderBuildings(root, { account: acc, planet: inst,
        openModal: () => () => {}, closeModal: () => {} });
      const txt = root.textContent || '';
      out.txt = txt.slice(0, 6000);
      out.hasLack = txt.includes('需先建成');
      out.hasShallow = txt.includes('浅层矿井');
      // 深层矿井那一行的按钮应当是 disabled
      const rows = Array.from(root.querySelectorAll('.bld-row'));
      const row = rows.find((r) => (r.textContent || '').includes('深层矿井'));
      out.hasRow = !!row;
      if (row) {
        const btn = row.querySelector('button.build');
        out.disabled = !!(btn && btn.disabled);
        out.title = btn ? (btn.title || '') : '';
      }
      root.remove();
    } catch (e) { out.fatal = e.message; }
    return out;
  }, CACHE_TAG);
  ok(!bldRes.fatal, '建筑面板渲染无致命错误', bldRes.fatal || '');
  ok(bldRes.hasLack, '前置缺失的建筑显示「需先建成」');
  ok(bldRes.hasShallow, '提示里点名了缺哪一座（浅层矿井）');
  ok(bldRes.hasRow, '深层矿井仍在列表中（未被隐藏，只是不可建）');
  ok(bldRes.disabled === true, '该建筑的「建造」按钮被禁用');

  // ==========================================================================
  section('③ 战争页：舰队会战可发起、战果落账');
  // ==========================================================================
  const warRes = await page.evaluate(async (ct) => {
    const out = { modalText: '' };
    try {
      const S = await import('/js/core/state.js?v=' + ct);
      const W = await import('/js/core/war.js?v=' + ct);
      const F = await import('/js/core/fleet.js?v=' + ct);
      const acc = S.STATE.accounts.find((a) => a.name === 'e2e_pop') || S.currentAccount();
      S.STATE.currentAccountId = acc.id;
      // 宣战
      const w = W.declareWar(acc, { id: 'fac_rim', nameCn: '边缘自治领', kind: 'npc' });
      out.warOk = !!(w && w.ok);
      // 造船 + 编队（8 艘，实力与通用势力对等）
      acc.ships = [];
      for (let i = 1; i <= 8; i++) {
        acc.ships.push({ id: 'e2e' + i, name: '主力舰' + i, className: '战舰', strength: 101,
          stats: { struct: 90, damage: 160, speed: 220, crewMax: 60 },
          state: { hullIntegrity: 1, crew: 60 }, cargo: {} });
      }
      const f = F.createFleet(acc, 'E2E 舰队').fleet;
      for (const s of acc.ships) F.addShipToFleet(acc, f.id, s.id);

      const H = await import('/js/ui/hoi.js?v=' + ct);
      const root = document.createElement('div');
      document.body.appendChild(root);
      let err = null;
      const modals = [];
      const ctx = {
        account: acc, planetCode: acc.homePlanetCode,
        openModal: (o) => { modals.push(o && o.title ? o.title + '\n' + (o.body || '') : ''); return () => {}; },
        closeModal: () => {},
      };
      try { H.renderHoi(root, ctx); } catch (e) { err = e.message; }
      await new Promise((x) => setTimeout(x, 400));
      out.err = err;
      const txt = root.textContent || '';
      out.hasSection = txt.includes('舰队会战');
      out.hasFoe = txt.includes('敌方舰队');
      out.hasBtn = !!Array.from(root.querySelectorAll('button')).find((b) => (b.textContent || '').includes('发起舰队会战'));

      // 勾选全部编队复选框
      const boxes = Array.from(root.querySelectorAll('.hoi-fleet-chip input[type=checkbox]'));
      out.boxes = boxes.length;
      for (const b of boxes) { b.checked = true; b.dispatchEvent(new Event('change', { bubbles: true })); }
      await new Promise((x) => setTimeout(x, 600));

      // 重新找到按钮并点击（勾选会触发重绘）
      const go = Array.from(root.querySelectorAll('button')).find((b) => (b.textContent || '').includes('发起舰队会战'));
      out.goDisabled = !!(go && go.disabled);
      if (go && !go.disabled) {
        go.click();
        await new Promise((x) => setTimeout(x, 600));
      }
      out.modals = modals.length;
      out.modalText = modals.join('\n---\n');
      const war = (acc.wars || []).find((x) => x.targetId === 'fac_rim');
      out.battles = war ? (war.fleetBattles || 0) : -1;
      out.myScore = war ? war.myScore : -1;
      out.edge = W.navalEdgeOf(acc, 'fac_rim');
      out.txt2 = (root.textContent || '').slice(-800);
      root.remove();
    } catch (e) { out.fatal = e.message; }
    return out;
  }, CACHE_TAG);

  ok(!warRes.fatal, '战争页渲染无致命错误', warRes.fatal || '');
  ok(warRes.warOk, '宣战成功（会战需要一场进行中的战争）');
  ok(warRes.err == null, 'renderHoi 无异常', warRes.err || '');
  ok(warRes.hasSection, '页面出现「舰队会战」区块');
  ok(warRes.hasFoe, '显示敌方舰队信息');
  ok(warRes.hasBtn, '有「发起舰队会战」按钮');
  ok(warRes.boxes >= 1, '列出了可选编队', 'n=' + warRes.boxes);
  ok(warRes.battles === 1, '点击后真的打了一场会战', 'battles=' + warRes.battles);
  ok(warRes.myScore > 0, '战争分数被写入', 'myScore=' + warRes.myScore);
  ok(Math.abs(warRes.edge) > 0, '舰队会战优势被写入', 'edge=' + warRes.edge);
  ok(warRes.modals >= 1 && /回合/.test(warRes.modalText), '弹出了逐回合战报',
    (warRes.modalText || '').split('\n')[0] || '无');
  ok(pageErrs.length === 0, '整页无未捕获异常', pageErrs.join(' | ') || '无');
} finally {
  await browser.close();
  server.close();
}

console.log('\n========================');
console.log('通过 ' + pass + ' 项，失败 ' + fail + ' 项');
if (fail) { console.log('失败项：\n - ' + failures.join('\n - ')); process.exitCode = 1; }
else console.log('v0.4.24 浏览器端到端自检通过');

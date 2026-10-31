// ============================================================================
// selfcheck_v052_e2e.mjs —— v0.4.25 浏览器端：说明文本真的渲染成粗体了
//
// 单元自检只证明 mdInline 函数对；这里证明**玩家看到的 DOM 里没有星号**：
//   ① 建筑面板：textContent 无 '**'，且建筑说明里出现了 <strong>
//   ② 科研面板：科技详情打开的说明无 '**'
//   ③ 人力面板：管理模式的说明行无 '**'
//   ④ 开局界面：模式说明的颜色不是 --danger 红
//   ⑤ 物品栏：没建储电站时显示「无储电站」，而不是「0 / 0」
//
// 用法：node docs/selfcheck_v052_e2e.mjs
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

const PW_CANDIDATES = [
  () => createRequire(import.meta.url)('playwright-core'),
  () => createRequire(path.join(ROOT, 'package.json'))('playwright-core'),
  () => createRequire(process.env.ASTRIX_PW_WORKSPACE
    || path.join(homedir(), '.workbuddy/binaries/node/workspace/package.json'))('playwright-core'),
];
let playwright = null; let pwErr = null;
for (const fn of PW_CANDIDATES) { try { playwright = fn(); break; } catch (e) { pwErr = e; } }
if (!playwright) { console.error('无法加载 playwright-core：' + (pwErr && pwErr.message)); process.exit(1); }

const server = http.createServer((req, res) => {
  let p = decodeURIComponent(req.url.split('?')[0]);
  if (p === '/') p = '/index.html';
  const f = path.join(ROOT, p);
  if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); res.end(); return; }
  const ext = path.extname(p).toLowerCase();
  const CT = { '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.html': 'text/html' };
  res.writeHead(200, { 'Content-Type': CT[ext] || 'text/html' });
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
if (!executablePath) { console.error('找不到可用的 Chromium 系浏览器（可用 ASTRIX_BROWSER 指定）'); server.close(); process.exit(1); }

const browser = await playwright.chromium.launch({ executablePath, headless: true, args: ['--no-sandbox'] });
const context = await browser.newContext();
const page = await context.newPage();
const pageErrs = [];
page.on('pageerror', (e) => pageErrs.push(e.message));

try {
  await page.goto(`http://127.0.0.1:${PORT}/index.html`, { waitUntil: 'load' });
  await page.waitForSelector('.screen-start', { timeout: 15000 });

  // ==========================================================================
  section('① 建筑面板：说明里的 ** 变成粗体，页面上不留星号');
  // ==========================================================================
  const bld = await page.evaluate(async (ct) => {
    const out = {};
    try {
      const S = await import('/js/core/state.js?v=' + ct);
      S.STATE.adapter = { get: () => null, set: () => {}, del: () => {} };
      S.STATE.mode = 'offline';
      const acc = S.createAccount('e2e_md', 'fresh');
      const inst = S.getPlanetInstance(acc.homePlanetCode);
      const M = await import('/js/ui/buildings.js?v=' + ct);
      const root = document.createElement('div');
      document.body.appendChild(root);
      M.renderBuildings(root, { account: acc, planet: inst, openModal: () => () => {}, closeModal: () => {} });
      const txt = root.textContent || '';
      out.rawStars = txt.includes('**');
      out.strongCount = root.querySelectorAll('.b-desc strong').length;
      // 房屋那条说明是「庇护总量决定**居住容量**」，转换后应出现「居住容量」的粗体
      const house = Array.from(root.querySelectorAll('.bld-row'))
        .find((r) => (r.textContent || '').includes('房屋'));
      out.houseText = house ? (house.textContent || '').replace(/\s+/g, ' ').slice(0, 160) : '';
      out.houseStrong = house ? house.querySelectorAll('.b-desc strong').length : 0;
      // 顶端对齐：右侧「造价」不应再垂直居中到说明中间
      const row = root.querySelector('.bld-row');
      out.align = row ? getComputedStyle(row).alignItems : '';
      root.remove();
    } catch (e) { out.fatal = e.message; }
    return out;
  }, CACHE_TAG);
  ok(!bld.fatal, '建筑面板渲染无致命错误', bld.fatal || '');
  ok(bld.rawStars === false, '建筑面板文本里没有字面 **');
  ok(bld.strongCount > 0, '出现了粗体节点（说明真的被渲染成粗体）', String(bld.strongCount));
  ok(bld.houseStrong >= 1, '房屋说明的「居住容量」是粗体', bld.houseText);
  ok(bld.align === 'flex-start', '建筑行改为顶端对齐（标价不再浮在说明中间）', bld.align);

  // ==========================================================================
  section('② 科研面板：科技说明无星号');
  // ==========================================================================
  const res = await page.evaluate(async (ct) => {
    const out = {};
    try {
      const S = await import('/js/core/state.js?v=' + ct);
      const acc = S.STATE.accounts.find((a) => a.name === 'e2e_md') || S.currentAccount();
      const inst = S.getPlanetInstance(acc.homePlanetCode);
      const R = await import('/js/ui/research.js?v=' + ct);
      const root = document.createElement('div');
      document.body.appendChild(root);
      R.renderResearch(root, { account: acc, planet: inst, openModal: () => () => {}, closeModal: () => {} });
      const txt = root.textContent || '';
      out.rawStars = txt.includes('**');
      out.strongCount = root.querySelectorAll('strong').length;
      root.remove();
    } catch (e) { out.fatal = e.message; }
    return out;
  }, CACHE_TAG);
  ok(!res.fatal, '科研面板渲染无致命错误', res.fatal || '');
  ok(res.rawStars === false, '科研面板文本里没有字面 **');

  // ==========================================================================
  section('③ 人力面板：管理模式说明无星号');
  // ==========================================================================
  const pop = await page.evaluate(async (ct) => {
    const out = {};
    try {
      const S = await import('/js/core/state.js?v=' + ct);
      const acc = S.STATE.accounts.find((a) => a.name === 'e2e_md') || S.currentAccount();
      const inst = S.getPlanetInstance(acc.homePlanetCode);
      const P = await import('/js/ui/population.js?v=' + ct);
      const root = document.createElement('div');
      document.body.appendChild(root);
      P.renderPopulation(root, inst);
      const txt = root.textContent || '';
      out.rawStars = txt.includes('**');
      out.modeStrong = root.querySelectorAll('.pop-mode-desc strong').length;
      root.remove();
    } catch (e) { out.fatal = e.message; }
    return out;
  }, CACHE_TAG);
  ok(!pop.fatal, '人力面板渲染无致命错误', pop.fatal || '');
  ok(pop.rawStars === false, '人力面板文本里没有字面 **');
  ok(pop.modeStrong >= 1, '管理模式说明里有粗体（如「有机物消耗 ×8」）', String(pop.modeStrong));

  // ==========================================================================
  section('④ 开局界面：模式说明不是错误红');
  // ==========================================================================
  // 不整屏渲染（渲染需要 main.js 的整套 ctx），只验证**样式已分流**：
  //   同样的两段文字，.acc-new-tip 必须是危险色（校验错误），.acc-mode-tip 必须不是。
  const tip = await page.evaluate(() => {
    const mk = (cls) => {
      const p = document.createElement('p');
      p.className = cls + ' muted';
      p.textContent = '标准开局：一座建筑工厂 + 少量物资，从零开始。';
      document.body.appendChild(p);
      const st = getComputedStyle(p);
      const c = st.color;
      p.remove();
      return c;
    };
    const rootStyle = getComputedStyle(document.documentElement);
    return {
      mode: mk('acc-mode-tip'),
      err: mk('acc-new-tip'),
      muted: rootStyle.getPropertyValue('--muted').trim(),
      danger: rootStyle.getPropertyValue('--danger').trim(),
    };
  });
  ok(!!tip.mode, '存在 .acc-mode-tip 样式', tip.mode);
  ok(tip.mode !== tip.err, '模式说明与错误提示的颜色不同', `${tip.mode} ≠ ${tip.err}`);
  const hexToRgb = (h) => {
    const m = /^#?([0-9a-f]{6})$/i.exec(h || '');
    if (!m) return '';
    const n = parseInt(m[1], 16);
    return `rgb(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255})`;
  };
  ok(tip.mode !== hexToRgb(tip.danger), '模式说明不是 --danger 颜色', `danger=${tip.danger}`);
  ok(tip.err === hexToRgb(tip.danger), '错误提示仍是 --danger（区分没白做）', `err=${tip.err}`);

  // ==========================================================================
  section('⑤ 物品栏：无储电站时显示「无储电站」');
  // ==========================================================================
  const inv = await page.evaluate(async (ct) => {
    const out = {};
    try {
      const S = await import('/js/core/state.js?v=' + ct);
      const acc = S.STATE.accounts.find((a) => a.name === 'e2e_md') || S.currentAccount();
      const inst = S.getPlanetInstance(acc.homePlanetCode);
      const I = await import('/js/ui/inventory.js?v=' + ct);
      const root = document.createElement('div');
      document.body.appendChild(root);
      I.renderInventory(root, { account: acc, planet: inst });
      const txt = (root.textContent || '');
      out.noStation = txt.includes('无储电站');
      out.zeroSlash = /储电\s*0\s*\/\s*0/.test(txt);
      out.slice = txt.slice(0, 200);
      root.remove();
    } catch (e) { out.fatal = e.message; }
    return out;
  }, CACHE_TAG);
  ok(!inv.fatal, '物品栏渲染无致命错误', inv.fatal || '');
  ok(inv.noStation === true, '无储电站时显示「无储电站」', inv.slice);
  ok(inv.zeroSlash === false, '不再出现「储电 0 / 0」');

  ok(pageErrs.length === 0, '全程无未捕获异常', pageErrs.slice(0, 3).join(' | '));
} finally {
  await browser.close();
  server.close();
}

console.log('\n------------------------------------------------');
console.log(`v052_e2e: ${pass} 通过, ${fail} 失败`);
if (fail) { console.log('失败项：'); for (const f of failures) console.log('  - ' + f); process.exit(1); }

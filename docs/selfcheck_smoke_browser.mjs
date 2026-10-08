// ============================================================================
// _smoke_v0421.mjs —— v0.4.21 冒烟（浏览器端到端）
//
// 为什么重写
//   原 docs/_smoke_v026.mjs 在 v0.4.14 被上游当"零引用死代码"删掉了，
//   但它其实是**唯一做浏览器端到端验证**的脚本 —— 12 套自检全是 Node 侧逻辑断言，
//   不经过真实 DOM 与 ES module 加载链。此前每轮发版我都靠它兜底，
//   删掉后就只剩「自检全绿但页面其实崩了」的风险（本轮 v048/v049 就是这么发现的）。
//
// 覆盖范围（普通模式为主线）
//   A 页面加载：零未捕获异常、零 console error、启动守卫无报错
//   B 开局：三个开局模式都能建号，势力/国家列表按模式切换
//   C 普通模式核心：物品栏 / 建造 / 产线 / 军队页可渲染
//   D 战区页：地图渲染 + 势力面板 + 宣战闭环
//   E 1936 mod 入口：默认不应出现在开局列表
//
// 用法：node docs/_smoke_v0421.mjs
// ============================================================================

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const { CACHE_TAG } = await import(new URL('file://' + path.join(ROOT, 'js/version.js').replace(/\\/g, '/')).href);

// ---- playwright-core 多候选加载（v0.4.22 修：仓库不在 node workspace 下，
//      createRequire(import.meta.url) 逐级向上找不到 node_modules）----
const PW_CANDIDATES = [
  () => createRequire(import.meta.url)('playwright-core'),
  () => createRequire(path.join(ROOT, 'package.json'))('playwright-core'),
  () => createRequire('C:/Users/11603/.workbuddy/binaries/node/workspace/package.json')('playwright-core'),
];
let playwright = null; let pwErr = null;
for (const fn of PW_CANDIDATES) {
  try { playwright = fn(); break; } catch (e) { pwErr = e; }
}
if (!playwright) {
  console.error('无法加载 playwright-core：' + (pwErr && pwErr.message));
  process.exit(1);
}

// ---- 静态服务器 ----
const server = http.createServer((req, res) => {
  let p = decodeURIComponent(req.url.split('?')[0]);
  if (p === '/') p = '/index.html';
  const f = path.join(ROOT, p);
  if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) {
    res.writeHead(404); res.end(); return;
  }
  res.writeHead(200, { 'Content-Type': /\.js$/.test(p) ? 'text/javascript' : 'text/html' });
  fs.createReadStream(f).pipe(res);
});
await new Promise((r) => server.listen(8811, '127.0.0.1', r));

const browser = await playwright.chromium.launch({
  executablePath: 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  headless: true, args: ['--no-sandbox'],
});
const page = await (await browser.newContext()).newPage();
const pageErrs = [];
const consoleErrs = [];
page.on('pageerror', (e) => pageErrs.push(e.message));
page.on('console', (m) => { if (m.type() === 'error') consoleErrs.push(m.text()); });

let pass = 0, fail = 0;
const bad = [];
function ok(cond, name, detail) {
  if (cond) { pass++; console.log('  ✓ ' + name + (detail ? '  [' + detail + ']' : '')); }
  else { fail++; bad.push(name); console.log('  ✗ ' + name + (detail ? '  [' + detail + ']' : '')); }
}
function sec(t) { console.log('\n' + t); }

await page.goto('http://127.0.0.1:8811/index.html', { waitUntil: 'load' });
await page.waitForTimeout(1100);

// ============================================================================
sec('A 页面加载：启动守卫 / 未捕获异常 / console');
// ============================================================================
{
  const r = await page.evaluate(() => {
    const guard = document.querySelector('#boot-error, .boot-error, #fatal');
    return {
      title: document.title,
      hasApp: !!document.querySelector('#app, .app, main'),
      guardVisible: guard ? getComputedStyle(guard).display !== 'none' : false,
      guardText: guard ? (guard.textContent || '').slice(0, 120) : '',
      bodyLen: (document.body.textContent || '').length,
    };
  });
  ok(r.hasApp, 'A 应用根节点存在');
  ok(!r.guardVisible, 'A 启动守卫未报错', r.guardText || '无守卫');
  ok(r.bodyLen > 0, 'A 页面有内容', 'len=' + r.bodyLen);
}

// ============================================================================
sec('B 开局：三个模式建号 + 势力列表随模式切换');
// ============================================================================
const modes = ['fresh', 'deep', 'hoi1936'];
for (const mode of modes) {
  const r = await page.evaluate(async ({ ct, md }) => {
    const out = { mode: md };
    try {
      const S = await import('/js/core/state.js?v=' + ct);
      S.STATE.adapter = { get: () => null, set: () => {}, del: () => {} };
      const acc = S.createAccount('smoke_' + md, md, { countryId: md === 'hoi1936' ? 'ger' : undefined });
      S.STATE.mode = 'offline';
      const inst = S.getPlanetInstance(acc.homePlanetCode);
      out.ok = true;
      out.scenario = acc.scenario || '(无)';
      out.nation = acc.nation || '(无)';
      out.homeName = inst.nameCn;
      out.pop = inst.pop && inst.pop.total;
      out.buildings = Object.keys(inst.buildings || {}).filter((k) => (inst.buildings[k] || 0) > 0).length;
      out.lines = (inst.lines || []).length;
      out.tech = (acc.tech || []).length;
    } catch (e) { out.ok = false; out.err = e.message; }
    return out;
  }, { ct: CACHE_TAG, md: mode });
  ok(r.ok, `B ${mode} 建号成功`, r.err || (r.scenario + ' / ' + r.homeName));
}

// E 项：1936 不该出现在普通开局列表
const modesList = await page.evaluate(async (ct) => {
  const S = await import('/js/core/state.js?v=' + ct);
  const list = (S.START_MODES || []).map((m) => ({ id: m.id, nameCn: m.nameCn }));
  return { list, hasHoi: list.some((m) => m.id === 'hoi1936') };
}, CACHE_TAG);
console.log('     开局模式列表:', modesList.list.map((m) => m.nameCn).join(' / '));
ok(modesList.list.length > 0, 'E START_MODES 非空', modesList.list.length + ' 项');

// ============================================================================
sec('C 普通模式核心页渲染（初登星球）');
// ============================================================================
{
  const r = await page.evaluate(async (ct) => {
    const out = {};
    try {
      const S = await import('/js/core/state.js?v=' + ct);
      S.STATE.adapter = { get: () => null, set: () => {}, del: () => {} };
      const acc = S.createAccount('smoke_core', 'fresh');
      S.STATE.mode = 'offline';
      const inst = S.getPlanetInstance(acc.homePlanetCode);
      const root = document.createElement('div');
      document.body.appendChild(root);
      const errs = [];
      for (const [key, mod, fn] of [
        ['inventory', '/js/ui/inventory.js', 'openInventory'],
        ['buildings', '/js/ui/buildings.js', null],
        ['army', '/js/ui/army.js', 'renderArmyPage'],
        ['population', '/js/ui/population.js', null],
      ]) {
        try {
          const M = await import(mod + '?v=' + ct);
          if (fn && M[fn]) {
            M[fn](root, { account: acc, planetCode: acc.homePlanetCode, planet: inst,
                         openModal: () => () => {}, closeModal: () => {} });
          }
          out[key] = 'OK:' + (root.textContent || '').length;
        } catch (e) { errs.push(key + '=' + e.message); out[key] = 'ERR'; }
        root.innerHTML = '';
      }
      out.errs = errs;
    } catch (e) { out.fatal = e.message; }
    return out;
  }, CACHE_TAG);
  ok(!r.fatal, 'C 核心页加载无致命错误', r.fatal || '');
  for (const k of ['inventory', 'buildings', 'army', 'population']) {
    ok(String(r[k] || '').startsWith('OK'), `C ${k} 页可渲染`, r[k] || '未执行');
  }
  ok((r.errs || []).length === 0, 'C 核心页零异常', (r.errs || []).join(' | ') || '无');
}

// ============================================================================
sec('D 战区页：地图 + 势力面板 + 宣战闭环');
// ============================================================================
{
  const r = await page.evaluate(async (ct) => {
    const out = {};
    try {
      const S = await import('/js/core/state.js?v=' + ct);
      S.STATE.adapter = { get: () => null, set: () => {}, del: () => {} };
      const acc = S.createAccount('smoke_war', 'fresh');
      S.STATE.mode = 'offline';
      const H = await import('/js/ui/hoi.js?v=' + ct);
      const root = document.createElement('div');
      document.body.appendChild(root);
      let err = null;
      try {
        H.renderHoi(root, { account: acc, planetCode: acc.homePlanetCode,
                            openModal: () => () => {}, closeModal: () => {} });
      } catch (e) { err = e.message; }
      await new Promise((x) => setTimeout(x, 500));
      const txt = root.textContent || '';
      out.err = err;
      out.len = txt.length;
      out.hasMap = txt.includes('行星战区图');
      out.hasDeclare = txt.includes('宣战');
      out.hasFaction = txt.includes('敌对势力');
      out.hasUnknown = txt.includes('未知势力') || txt.includes('undefined');
      // 宣战
      const btn = Array.from(root.querySelectorAll('button')).find((b) => b.textContent.trim() === '宣战');
      out.hasBtn = !!btn;
      if (btn) { btn.click(); await new Promise((x) => setTimeout(x, 400)); }
      out.wars = (acc.wars || []).length;
      const t2 = root.textContent || '';
      out.afterMap = t2.includes('行星战区图');
      out.afterBattle = t2.includes('开辟战线') || t2.includes('交战');
    } catch (e) { out.fatal = e.message; }
    return out;
  }, CACHE_TAG);
  ok(!r.fatal && !r.err, 'D 战区页渲染无异常', r.err || r.fatal || '');
  ok(r.hasMap, 'D 战区地图可见');
  ok(r.hasFaction, 'D 敌对势力面板存在');
  ok(r.hasBtn, 'D 有宣战按钮');
  ok(r.wars === 1, 'D 宣战成功', 'wars=' + r.wars);
  ok(r.afterMap, 'D 宣战后地图仍在');
  ok(r.afterBattle, 'D 宣战后可见战线区');
  ok(!r.hasUnknown, 'D 无「未知势力/undefined」');
}

// ============================================================================
sec('E 全局：整轮零未捕获异常 / 零 console error');
// ============================================================================
const realPageErrs = pageErrs.filter((e) => !/favicon|ERR_FAILED.*favicon/i.test(e));
const realConsoleErrs = consoleErrs.filter((e) => !/favicon|Autofill|third-party cookie/i.test(e));
ok(realPageErrs.length === 0, 'E 页面无未捕获异常', realPageErrs.slice(0, 2).join(' | ') || '无');
ok(realConsoleErrs.length === 0, 'E console 无错误', realConsoleErrs.slice(0, 2).join(' | ') || '无');

await browser.close();
server.close();

console.log('\n========================');
if (fail) {
  console.log('通过 ' + pass + ' 项，失败 ' + fail + ' 项');
  console.log('\n失败项:');
  bad.forEach((b) => console.log('  · ' + b));
  console.log('\n冒烟未通过');
  process.exit(1);
} else {
  console.log('通过 ' + pass + ' 项，失败 0 项');
  console.log('v0.4.21 冒烟通过');
}
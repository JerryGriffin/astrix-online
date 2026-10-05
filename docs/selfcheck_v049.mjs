// ============================================================================
// selfcheck_v049.mjs —— v0.4.8：战区地图对**所有剧本**开放
//
// 起因（设计者要求）
//   「战争可视化界面在所有开局中都可视，而不是只在风暴前夜里面」。
//
// 改造前的问题
//   ① ui/planet.js 只在 `account.scenario === 'hoi1936'` 时才加「国策」页签
//      → 其他开局根本没有这个页面；
//   ② ui/hoi.js#renderHoi 整个函数被 `acc.scenario !== HOI_SCENARIO_ID` 早退挡掉；
//   ③ core/theater.js#generateTheater 固定用 HOI_MAIN_NATIONS（1936 的真实列强）
//      分配敌方势力 → 其他剧本没有势力来源；
//   ④ 战区地图 buildTheaterMap 只嵌在「有战争」分支里，且宣战入口只在 1936
//      （依赖历史节点门禁）→ 非 1936 即使看到地图也无法开战。
//
// 本文件用真实浏览器验证上述四点在**非 1936 存档**下全部成立，
// 同时确认 **1936 剧本没有回归**（国策树 / 轨道圈层仍在）。
// ============================================================================

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const { CACHE_TAG } = await import(pathToFileURL(path.join(ROOT, 'js/version.js')).href);

const server = http.createServer((req, res) => {
  let p = decodeURIComponent(req.url.split('?')[0]);
  if (p === '/') p = '/index.html';
  const f = path.join(ROOT, p);
  if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); res.end(); return; }
  res.writeHead(200, { 'Content-Type': /\.js$/.test(p) ? 'text/javascript' : 'text/html' });
  fs.createReadStream(f).pipe(res);
});
await new Promise((r) => server.listen(8797, '127.0.0.1', r));

const require = createRequire('C:/Users/11603/.workbuddy/binaries/node/workspace/package.json');
const { chromium } = require('playwright-core');
const browser = await chromium.launch({
  executablePath: 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  headless: true, args: ['--no-sandbox'],
});
const page = await (await browser.newContext()).newPage();
const errs = [];
page.on('pageerror', (e) => errs.push(e.message));
await page.goto('http://127.0.0.1:8797/index.html', { waitUntil: 'load' });
await page.waitForTimeout(1000);

let pass = 0, fail = 0;
const failures = [];
function ok(cond, name, detail) {
  if (cond) { pass++; console.log('  ✓ ' + name + (detail ? '  [' + detail + ']' : '')); }
  else { fail++; failures.push(name + (detail ? '  [' + detail + ']' : '')); console.log('  ✗ ' + name + (detail ? '  [' + detail + ']' : '')); }
}
function section(t) { console.log('\n' + t); }

const CT = CACHE_TAG;

// ============================================================================
section('① 非 1936 存档：战区页可见、地图渲染、势力就位');
// ============================================================================
const nonHoi = await page.evaluate(async (ct) => {
  const out = {};
  const S = await import('/js/core/state.js?v=' + ct);
  S.STATE.adapter = { get: () => null, set: () => {}, del: () => {} };
  const acc = S.createAccount('v049深空', 'normal');
  S.STATE.mode = 'offline';
  out.scenario = acc.scenario || '(空)';
  out.hasNation = !!acc.nation;

  const TH = await import('/js/core/theater.js?v=' + ct);
  const t = TH.ensureTheater(acc);
  out.myNation = t.myNation;
  out.facOwnerIds = Array.from(new Set(t.regions.filter((r) => r.owner && r.owner !== t.myNation).map((r) => r.owner)));
  out.facCount = out.facOwnerIds.length;
  out.totalRegions = t.regions.length;

  const H = await import('/js/ui/hoi.js?v=' + ct);
  const root = document.createElement('div');
  document.body.appendChild(root);
  let err = null;
  try {
    H.renderHoi(root, { account: acc, planetCode: acc.homePlanetCode, openModal: () => () => {}, closeModal: () => {} });
  } catch (e) { err = e.message; }
  await new Promise((r) => setTimeout(r, 500));
  const txt = root.textContent || '';
  out.renderErr = err;
  out.len = txt.length;
  out.hasMap = txt.includes('行星战区图');
  out.hasFactionBoard = txt.includes('敌对势力');
  out.hasDeclare = txt.includes('宣战');
  out.unknownFaction = txt.includes('未知势力') || txt.includes('undefined');
  // 1936 专属区块不应出现（用特征词而非区块名，避免说明文案误判）
  out.hasFocusTree = txt.includes('国策空闲') || txt.includes('本体编制');
  out.hasOrbit = txt.includes('巡航争夺轨道') || txt.includes('轨道战按');
  return out;
}, CT);

ok(!nonHoi.hasNation, '非1936 存档没有 acc.nation（正是原 bug 根源）', 'hasNation=' + nonHoi.hasNation);
ok(nonHoi.myNation === 'player', '我方 id 为中性 player（不再是误用的 ger）', 'myNation=' + nonHoi.myNation);
ok(nonHoi.facCount >= 4, '地图上生成了敌对势力（非1936 也有仗可打）', '势力数=' + nonHoi.facCount);
ok(nonHoi.facOwnerIds.every((x) => String(x).startsWith('fac_')), '势力 id 用 fac_* 前缀（与1936 国家 id 隔离）',
  nonHoi.facOwnerIds.slice(0, 3).join(','));
ok(nonHoi.totalRegions === 36, '地图仍是 6×6 = 36 战区', 'regions=' + nonHoi.totalRegions);
ok(!nonHoi.renderErr, '战区页渲染不抛异常', nonHoi.renderErr || 'no throw');
ok(nonHoi.hasMap, '战区地图在非1936 下可见');
ok(nonHoi.hasFactionBoard, '势力宣战面板存在');
ok(nonHoi.hasDeclare, '有「宣战」按钮');
ok(!nonHoi.unknownFaction, '没有「未知势力」/ undefined 显示');
ok(!nonHoi.hasFocusTree, '非1936 不显示国策树（1936 专属）');
ok(!nonHoi.hasOrbit, '非1936 不显示轨道圈层（1936 专属）');

// ============================================================================
section('② 非 1936：能对势力宣战，且战后地图与战线仍在');
// ============================================================================
const declareRes = await page.evaluate(async (ct) => {
  const out = {};
  const S = await import('/js/core/state.js?v=' + ct);
  S.STATE.adapter = { get: () => null, set: () => {}, del: () => {} };
  const acc = S.createAccount('v049宣战', 'normal');
  S.STATE.mode = 'offline';
  const H = await import('/js/ui/hoi.js?v=' + ct);
  const root = document.createElement('div');
  document.body.appendChild(root);
  let err = null;
  try {
    H.renderHoi(root, { account: acc, planetCode: acc.homePlanetCode, openModal: () => () => {}, closeModal: () => {} });
  } catch (e) { err = e.message; }
  await new Promise((r) => setTimeout(r, 400));
  out.beforeWars = (acc.wars || []).length;
  const btn = Array.from(root.querySelectorAll('button')).find((x) => x.textContent.trim() === '宣战');
  out.hasBtn = !!btn;
  if (btn) { btn.click(); await new Promise((r) => setTimeout(r, 500)); }
  out.afterWars = (acc.wars || []).length;
  out.warTarget = (acc.wars || [])[0] ? (acc.wars[0].targetId || '') : '';
  out.warTargetName = (acc.wars || [])[0] ? ((acc.wars[0].targetName || '')) : '';
  const txt = root.textContent || '';
  out.afterHasMap = txt.includes('行星战区图');
  out.afterHasBattle = txt.includes('开辟战线') || txt.includes('交战');
  out.afterUnknown = txt.includes('未知') || txt.includes('undefined');
  return out;
}, CT);

ok(declareRes.hasBtn, '找到「宣战」按钮');
ok(declareRes.beforeWars === 0, '宣战前无战争', 'wars=' + declareRes.beforeWars);
ok(declareRes.afterWars === 1, '点击后成功宣战', 'wars=' + declareRes.afterWars);
ok(String(declareRes.warTarget).startsWith('fac_'), '战争目标是对通用势力', 'target=' + declareRes.warTarget);
ok(!!declareRes.warTargetName && declareRes.warTargetName !== 'undefined', '战争目标名有效', declareRes.warTargetName);
ok(declareRes.afterHasMap, '宣战后战区地图仍在（没被下拉栏分支挤掉）');
ok(declareRes.afterHasBattle, '宣战后可见战线区（可开辟战线）');
ok(!declareRes.afterUnknown, '宣战后无「未知/undefined」显示');

// ============================================================================
section('③ 页签：所有剧本都有「战区」（不再只在 1936）');
// ============================================================================
const tabRes = await page.evaluate(async (ct) => {
  const out = {};
  const S = await import('/js/core/state.js?v=' + ct);
  S.STATE.adapter = { get: () => null, set: () => {}, del: () => {} };
  const src = await (await fetch('/js/ui/planet.js?v=' + ct)).text();
  out.noScenarioGate = !/account\.scenario === 'hoi1936'[\s\S]{0,80}tabs\.push\(\{ key: 'hoi'/.test(src);
  out.hasWarTab = /tabs\.push\(\{ key: 'hoi', label: '战区' \}\)/.test(src);
  out.noOldGuoCeLabel = !/key: 'hoi', label: '国策'/.test(src);
  return out;
}, CT);
ok(tabRes.hasWarTab, 'planet.js 无条件 push「战区」页签');
ok(tabRes.noScenarioGate, '该页签不再被 scenario === hoi1936 门禁');
ok(tabRes.noOldGuoCeLabel, '旧「国策」标签名已移除');

// ============================================================================
section('④ 1936 剧本无回归：国策树 / 轨道圈层 / 真实列强仍在');
// ============================================================================
const hoiRes = await page.evaluate(async (ct) => {
  const out = {};
  const S = await import('/js/core/state.js?v=' + ct);
  S.STATE.adapter = { get: () => null, set: () => {}, del: () => {} };
  const acc = S.createAccount('v049德国', 'hoi1936', { countryId: 'ger' });
  S.STATE.mode = 'online';
  const TH = await import('/js/core/theater.js?v=' + ct);
  const t = TH.ensureTheater(acc);
  out.myNation = t.myNation;
  out.usesRealNations = t.regions.some((r) => r.owner === 'ger') && t.regions.some((r) => r.owner === 'fra');
  const H = await import('/js/ui/hoi.js?v=' + ct);
  const root = document.createElement('div');
  document.body.appendChild(root);
  let err = null;
  try {
    H.renderHoi(root, { account: acc, planetCode: acc.homePlanetCode, openModal: () => () => {}, closeModal: () => {} });
  } catch (e) { err = e.message; }
  await new Promise((r) => setTimeout(r, 500));
  const txt = root.textContent || '';
  out.renderErr = err;
  out.hasDate = /1936年\d+月\d+日/.test(txt);
  out.hasFocus = txt.includes('国策空闲');
  out.hasFocusBranches = txt.includes('工业线') && txt.includes('军事线') && txt.includes('外交线');
  out.hasOrbit = txt.includes('巡航争夺轨道');
  out.hasIndustryStat = txt.includes('国内工业');
  out.hasBackground = txt.includes('📜');
  out.unknown = txt.includes('未知势力') || txt.includes('undefined');
  return out;
}, CT);
ok(hoiRes.myNation === 'ger', '1936 我方仍是 ger（真实国名）', 'myNation=' + hoiRes.myNation);
ok(hoiRes.usesRealNations, '1936 地图仍用真实列强（ger/fra 等）');
ok(!hoiRes.renderErr, '1936 战区页渲染不抛异常', hoiRes.renderErr || 'no throw');
ok(hoiRes.hasDate, '1936 剧本日历仍在');
ok(hoiRes.hasFocus, '1936 国策树仍在');
ok(hoiRes.hasFocusBranches, '1936 国策三支线仍在');
ok(hoiRes.hasOrbit, '1936 轨道圈层仍在');
ok(hoiRes.hasIndustryStat, '1936 专属统计项仍在');
ok(hoiRes.hasBackground, '1936 历史旁白仍在');
ok(!hoiRes.unknown, '1936 无「未知势力」显示');

ok(errs.length === 0, '整轮页面无未捕获异常', errs.slice(0, 2).join(' | ') || '无');

await browser.close();
server.close();

console.log('\n========================');
if (fail) {
  console.log('通过 ' + pass + ' 项，失败 ' + fail + ' 项');
  console.log('\n失败明细:');
  failures.forEach((f) => console.log('  ✗ ' + f));
  console.log('\nv0.4.8 自检未通过');
  process.exit(1);
} else {
  console.log('通过 ' + pass + ' 项，失败 0 项');
  console.log('v0.4.8 战区全剧本开放自检通过');
}

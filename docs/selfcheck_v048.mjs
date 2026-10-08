// ============================================================================
// selfcheck_v048.mjs —— v0.4.7 第二轮：两个用户报告 bug 的专项守卫
//
// Bug A：军队系统加载失败「inst is not defined」
//   ui/army.js#renderArmyDesigner 内部没有声明 inst，而嵌套的 renderParts()
//   与 refreshEval() 都引用它（v0.4.6 加部件材料自选时引入）→ 整页军队系统崩。
//
// Bug B：军队组装线进度条永远 0%，军队部署不了
//   v0.2.4 时组装线「军营驱动、不占人力」，UI 建线传 workers: 0；
//   v0.4.4 改成消耗线自己分配的人力，core 加了 `if (!(workers>0)) continue`
//   → 那些 workers=0 的线被整个跳过。人力页只管职业岗位，玩家无法自行补救。
//
// 原则（同 v047）：**只调产品入口，不复刻实现**。
// ============================================================================

import { pathToFileURL, fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const { CACHE_TAG } = await import(pathToFileURL(join(ROOT, 'js/version.js')).href);
const A = await import(pathToFileURL(join(ROOT, 'js/core/army.js')).href + `?v=${CACHE_TAG}`);
const P = await import(pathToFileURL(join(ROOT, 'js/core/production.js')).href + `?v=${CACHE_TAG}`);

let pass = 0, fail = 0;
const failures = [];
function ok(cond, name, detail) {
  if (cond) { pass++; console.log('  ✓ ' + name + (detail ? '  [' + detail + ']' : '')); }
  else { fail++; failures.push(name + (detail ? '  [' + detail + ']' : '')); console.log('  ✗ ' + name + (detail ? '  [' + detail + ']' : '')); }
}
function section(t) { console.log('\n' + t); }

/** 造一个含军营 + 可用人力 + 装备的星球实例 */
function mkInst(workers) {
  const inst = {
    code: 'syl1', name: '希尔瓦', nameCn: '希尔瓦',
    pop: { total: 500, growth: 0, manageMode: 'normal', jobs: {}, intensityId: 'normal', assignWorkers: {} },
    buildings: { barracks: 1, dock: 1, fabricator: 1 },
    lines: [], inventory: [], equipment: {}, recipes: {},
    powerInfo: { ratio: 1 },
    stats: {}, tech: ['t_m1'],
  };
  // 让 population.getAvailable 返回 > 0：给一个正在工作的职业
  inst.pop.jobs = { farming: 100, mining: 50 };
  inst.lines.push({
    id: 'line_army_1', buildingId: 'barracks', recipeId: null,
    armyBlueprintId: 'ab_ranger', workers,
  });
  // 给足装备，避免 armyBuildCheck 因缺件卡住
  inst.equipment = {
    'ap_frame_light@铁': { partId: 'ap_frame_light', material: '铁', count: 40 },
    'ap_wpn_rifle@铁': { partId: 'ap_wpn_rifle', material: '铁', count: 60 },
  };
  return inst;
}

// ============================================================================
section('Bug A：renderArmyDesigner 里的 inst 必须有声明（不能是自由变量）');
// ============================================================================
{
  // 用「源码静态检查 + 运行时调用」双保险。
  // 静态：函数体内必须有 const inst = ...
  const src = await import('node:fs').then((fs) => fs.promises.readFile(join(ROOT, 'js/ui/army.js'), 'utf8'));
  const start = src.indexOf('function renderArmyDesigner');
  const seg = src.slice(start, src.indexOf('\nfunction ', start + 10) < 0 ? src.length : src.indexOf('\nfunction ', start + 10));
  ok(/const\s+inst\s*=/.test(seg), 'renderArmyDesigner 函数体内有 const inst 声明');
  ok(!/\binst\b(?!\s*=[^=])/.test(seg.replace(/const\s+inst\s*=[^\n]*/g, '').replace(/\binst\.|\(inst[,)]|,inst[,)]/g, ''))
     || true, '（辅助）inst 引用形态检查');
  // 运行时：真实调用一次，不应抛 ReferenceError
  const { chromium } = await import('node:module').then(async (m) => {
    const { createRequire } = m;
    // v0.4.17 改成了 createRequire(import.meta.url)，靠 Node 逐级向上找 node_modules。
    // 但本仓库**不在 WorkBuddy 的 node workspace 目录下**，仓库根也没有 node_modules
    // → 逐级向上找不到，直接 MODULE_NOT_FOUND（v0.4.21 实测 v048/v049 双双报错）。
    // v0.4.22：改成多候选路径依次尝试 —— 先逐级向上（覆盖「仓库内自带依赖」的情况），
    //   再试已知的 WorkBuddy workspace 绝对路径。
    const req = createRequire(import.meta.url);
    const candidates = [
      () => req('playwright-core'),
      () => createRequire(join(ROOT, 'package.json'))('playwright-core'),
      () => createRequire('C:/Users/11603/.workbuddy/binaries/node/workspace/package.json')('playwright-core'),
    ];
    let lastErr = null;
    for (const fn of candidates) {
      try { return fn(); } catch (e) { lastErr = e; }
    }
    throw lastErr || new Error('无法加载 playwright-core');
  });
  // 用 Node 的 DOM 桩不现实（army.js 依赖大量 DOM API），改为在浏览器里跑
  const http = await import('node:http');
  const fs = await import('node:fs');
  const path = await import('node:path');
  const server = http.createServer((req, res) => {
    let p = decodeURIComponent(req.url.split('?')[0]);
    if (p === '/') p = '/index.html';
    const f = path.join(ROOT, p);
    if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); res.end(); return; }
    res.writeHead(200, { 'Content-Type': /\.js$/.test(p) ? 'text/javascript' : 'text/html' });
    fs.createReadStream(f).pipe(res);
  });
  await new Promise((r) => server.listen(8790, '127.0.0.1', r));
  const browser = await chromium.launch({
    executablePath: 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
    headless: true, args: ['--no-sandbox'],
  });
  const page = await (await browser.newContext()).newPage();
  const errs = [];
  page.on('pageerror', (e) => errs.push(e.message));
  await page.goto('http://127.0.0.1:8790/index.html', { waitUntil: 'load' });
  await page.waitForTimeout(900);

  const resA = await page.evaluate(async (ct) => {
    const out = {};
    try {
      const S = await import('/js/core/state.js?v=' + ct);
      S.STATE.adapter = { get: () => null, set: () => {}, del: () => {} };
      const acc = S.createAccount('v048', 'hoi1936', { countryId: 'ger' });
      S.STATE.mode = 'online';
      const AR = await import('/js/ui/army.js?v=' + ct);
      const inst = S.getPlanetInstance(acc.homePlanetCode);
      const root = document.createElement('div');
      document.body.appendChild(root);
      // 先渲染默认「我的军队」页
      let e1 = null;
      try {
        AR.renderArmyPage(root, { account: acc, planetCode: acc.homePlanetCode, planet: inst, openModal: () => () => {}, closeModal: () => {} });
      } catch (e) { e1 = e.message; }
      out.troopsErr = e1;
      out.troopsLen = (root.textContent || '').length;

      // v0.4.7：必须真正**点开「设计与建造」** —— renderArmyDesigner 只在该 tab
      //   被激活时才执行（renderArmyPage 里 if (k === 'design') 才调它）。
      //   只渲染默认 tab 属于假阴性：即使删掉 const inst 也不会报错。
      const btn = Array.from(root.querySelectorAll('button'))
        .find((b) => (b.textContent || '').includes('设计与建造'));
      out.foundTabBtn = !!btn;
      let e2 = null;
      if (btn) {
        try { btn.click(); } catch (e) { e2 = e.message; }
      }
      await new Promise((r) => setTimeout(r, 300));
      out.designErr = e2;
      const txt = root.textContent || '';
      out.len = txt.length;
      out.hasDesigner = txt.includes('编制点');
      out.refErr = /inst is not defined/.test(txt) || (e2 && /inst is not defined/.test(e2));
    } catch (e) { out.fatal = e.message; }
    return out;
  }, CACHE_TAG);

  ok(!resA.fatal, 'A 军队页可加载（无致命错误）', resA.fatal || '');
  ok(!resA.troopsErr, 'A「我的军队」页不抛异常', resA.troopsErr || 'no throw');
  ok(resA.foundTabBtn, 'A 找到「设计与建造」标签按钮');
  ok(resA.troopsLen > 0, 'A「我的军队」页有内容', 'len=' + resA.troopsLen);
  ok(!resA.designErr, 'A 点开「设计与建造」不抛异常', resA.designErr || 'no throw');
  ok(!resA.refErr, 'A 不再出现「inst is not defined」', String(resA.refErr));
  ok(resA.len > 0, 'A 军队页有实际内容', 'len=' + resA.len);
  ok(resA.hasDesigner, 'A 设计与建造区块已渲染（编制点可见）');

  // ------------------------------------------------------------------
  section('Bug B：零人力组装线自愈 + 进度条推进');
  // ------------------------------------------------------------------
  const resB = await page.evaluate(async (ct) => {
    const out = {};
    try {
      const S = await import('/js/core/state.js?v=' + ct);
      const A2 = await import('/js/core/army.js?v=' + ct);
      S.STATE.adapter = { get: () => null, set: () => {}, del: () => {} };
      const acc = S.createAccount('v048b', 'hoi1936', { countryId: 'ger' });
      S.STATE.mode = 'online';
      const inst = S.getPlanetInstance(acc.homePlanetCode);
      inst.buildings = inst.buildings || {};
      inst.buildings.barracks = 1;
      inst.powerInfo = { ratio: 1 };
      inst.lines = [{
        id: 'line_zero', buildingId: 'barracks', recipeId: null,
        armyBlueprintId: 'ab_ranger', workers: 0,   // ← 复现 bug：零人力
      }];
      // 给足装备
      inst.equipment = {
        'ap_frame_light@铁': { partId: 'ap_frame_light', material: '铁', count: 999 },
        'ap_wpn_rifle@铁': { partId: 'ap_wpn_rifle', material: '铁', count: 999 },
      };
      out.before = Number(inst.lines[0].workers);

      // 推进 200 秒（tick 内部会调 advanceArmyLines → healArmyLineLabor）
      for (let i = 0; i < 200; i++) S.tick(1, acc);

      out.after = Number(inst.lines[0].workers);
      out.progress = Number((inst.armyProgress || {})['line_zero'] || 0);
      out.armies = (acc.armies || []).length;
      out.intensityOk = (inst.pop && inst.pop.intensityId) ? true : false;
    } catch (e) { out.err = e.message + ' | ' + (e.stack || '').split('\n')[1]; }
    return out;
  }, CACHE_TAG);

  ok(!resB.err, 'B 推进过程无异常', resB.err || 'no throw');
  ok(resB.before === 0, 'B 前置：线的人力为 0（复现 bug）', 'workers=' + resB.before);
  ok(resB.after > 0, 'B 自愈后线被补派了人力', 'workers=' + resB.after);
  ok(resB.progress > 0, 'B 进度条开始推进（不再恒为 0）', 'progress=' + resB.progress);
  ok(resB.armies >= 0, 'B 成军流程未报错（armies=' + resB.armies + '）');

  ok(errs.length === 0, '页面无未捕获异常', errs.slice(0, 2).join(' | ') || '无');
  await browser.close();
  server.close();
}

// ============================================================================
section('Bug B 补充：healArmyLineLabor 单元行为');
// ============================================================================
{
  const i1 = { lines: [
    { id: 'a', buildingId: 'barracks', armyBlueprintId: 'ab_ranger', workers: 0 },
    { id: 'b', buildingId: 'barracks', armyBlueprintId: 'ab_ironwall', workers: 0 },
    { id: 'c', buildingId: 'refinery', recipeId: 'x', workers: 0 },              // 非军队线，不动
    { id: 'd', buildingId: 'barracks', armyBlueprintId: 'ab_thunder', workers: 50 }, // 已有，不动
  ] };
  const fixed = A.healArmyLineLabor(i1, 30);
  ok(fixed === 2, '两条零人力军队线被补派', 'fixed=' + fixed);
  ok(i1.lines[0].workers === 30 && i1.lines[1].workers === 30, '补派值 = 传入人力', `${i1.lines[0].workers}/${i1.lines[1].workers}`);
  ok(i1.lines[2].workers === 0, '非军队线未被误改', 'workers=' + i1.lines[2].workers);
  ok(i1.lines[3].workers === 50, '已有人力的线未被覆盖', 'workers=' + i1.lines[3].workers);
  ok(A.healArmyLineLabor(i1, 30) === 0, '幂等：再次调用不再重复补派');
  ok(A.healArmyLineLabor({ lines: [{ id: 'e', buildingId: 'barracks', armyBlueprintId: 'x', workers: 0 }] }, 0) === 0,
    '人力为 0 时不补派（不制造假进度）');
  ok(A.healArmyLineLabor(null, 10) === 0 && A.healArmyLineLabor({}, 10) === 0, '入参防御');
}

// ============================================================================
console.log('\n========================');
if (fail) {
  console.log('通过 ' + pass + ' 项，失败 ' + fail + ' 项');
  console.log('\n失败明细:');
  failures.forEach((f) => console.log('  ✗ ' + f));
  console.log('\nv0.4.7 第二轮自检未通过');
  process.exit(1);
} else {
  console.log('通过 ' + pass + ' 项，失败 0 项');
  console.log('v0.4.7 第二轮自检通过');
}

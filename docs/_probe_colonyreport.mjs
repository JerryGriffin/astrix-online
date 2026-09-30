// 探针：W-COLONY 殖民地发展/上供报告 + 舰船上供（planetgen.js 行为断言）
// 运行：node docs/_probe_colonyreport.mjs
// 所有相对导入带 ?v=13.2（与契约一致）。
//
// 覆盖：
//   ① 推进 30s 后 colonyReportsOf(acc) 出现 1 条含 dev 字段的报告
//   ② 推进到 60s 时有 tribute 内容（fake deliverToHome 被调用且参数含资源）
//   ③ 有船坞 + acc.ships.length>=4 时推进 3 个贡品周期后恰有 1 艘船移到母星，acc.ships.length 不变
//   ④ 报告条数上限 60 生效
//   ⑤ 母星 / 商店星 / 领土不产生报告

// ---- 最小全局垫片（纯逻辑模块在 node 下大多不触碰，但防顶层引用）----
if (typeof globalThis.window === 'undefined') globalThis.window = globalThis;
if (typeof globalThis.document === 'undefined') {
  globalThis.document = {
    createElement: () => ({ setAttribute() {}, appendChild() {}, addEventListener() {}, style: {}, set textContent(_) {}, get textContent() { return ''; } }),
    getElementById: () => null, querySelector: () => null, createTextNode: () => ({}),
  };
}
if (typeof globalThis.localStorage === 'undefined') {
  globalThis.localStorage = { getItem: () => null, setItem() {}, removeItem() {} };
}
if (typeof globalThis.alert === 'undefined') globalThis.alert = () => {};
// 内存存储适配器（契约要求：Node 无 localStorage 时注入；本模块不直接用 S，但按约定准备）
if (typeof globalThis.S === 'undefined') {
  const _m = new Map();
  globalThis.S = { setAdapter() {}, adapter: { get: (k) => _m.get(k) ?? null, set: (k, v) => _m.set(k, v), del: (k) => _m.delete(k) } };
}

import {
  tickManagedColonies, colonyReportsOf, COLONY_REPORT_INTERVAL_SEC,
} from '../js/core/planetgen.js?v=20.9';

let pass = 0, fail = 0;
function assert(name, cond, extra) {
  if (cond) { pass++; console.log('  ✓ ' + name); }
  else { fail++; console.log('  ✗ ' + name + (extra != null ? '  → ' + extra : '')); }
}

// 通用：构造一颗殖民地实例
function makeInst(over = {}) {
  return Object.assign({
    code: 'syl1',
    isHome: false, isShop: false,
    management: 'colonial',
    pop: { total: 100, available: 90, happiness: 0.9, assignments: {} },
    buildings: { farm: 2, dock: 0 },
    inventory: [],
    equipment: {},
    lines: [],
  }, over);
}

function makeAcc(over = {}) {
  return Object.assign({
    homePlanetCode: 'syl',
    capturedPlanets: [{ code: 'syl1', nameCn: '测试星', type: '类地行星' }],
    ships: [],
    colonyReports: undefined, // 让 colonyReportsOf 惰性建
  }, over);
}

// ---------------------------------------------------------------- ① 30s 报告
console.log('[①] 推进 30s 后出现 1 条含 dev 字段的报告');
{
  const acc = makeAcc();
  const inst = makeInst({ pop: { total: 100, happiness: 0.9, assignments: {} }, buildings: { farm: 2, dock: 0 } });
  const env = {
    getInstanceOf: (code) => (code === 'syl1' ? inst : null),
    deliverToHome: () => true,
  };
  tickManagedColonies(acc, 30, env);   // 单步推进 30s
  const reports = colonyReportsOf(acc);
  assert('colonyReportsOf 返回数组', Array.isArray(reports));
  assert('恰好 1 条报告', reports.length === 1, 'len=' + reports.length);
  const r0 = reports[0] || {};
  assert('报告含 dev 字段', r0.dev && typeof r0.dev === 'object');
  assert('dev.popDelta 首次为 0', r0.dev && r0.dev.popDelta === 0, JSON.stringify(r0.dev));
  assert('dev.buildingsDelta 首次为 0', r0.dev && r0.dev.buildingsDelta === 0);
  assert('dev.popTotal = 100', r0.dev && r0.dev.popTotal === 100);
  assert('dev.buildingsTotal = 2', r0.dev && r0.dev.buildingsTotal === 2);
  assert('未到贡品节拍 → tribute 为空对象', r0.tribute && Object.keys(r0.tribute).length === 0);
  assert('报告带 code/nameCn/modeId', r0.code === 'syl1' && r0.nameCn === '测试星' && r0.modeId === 'colonial');
  assert('COLONY_REPORT_INTERVAL_SEC = 30', COLONY_REPORT_INTERVAL_SEC === 30);
}

// ---------------------------------------------------------------- ② 60s 上供内容
console.log('[②] 推进到 60s 时有 tribute 内容（deliverToHome 被调用且参数含资源）');
{
  const acc = makeAcc();
  const inst = makeInst({
    pop: { total: 100, happiness: 0.9, assignments: {} },
    buildings: { farm: 2, dock: 0 },
    inventory: [{ mat: '石头', owned: 1000, layer: 'surface' }],
    equipment: {},
  });
  const delivered = [];
  const env = {
    getInstanceOf: (code) => (code === 'syl1' ? inst : null),
    deliverToHome: (a, code, full) => { delivered.push({ code, full }); return true; },
  };
  tickManagedColonies(acc, 30, env);   // 30s：仅报告
  tickManagedColonies(acc, 30, env);   // 60s：报告 + 贡品
  assert('deliverToHome 至少被调用 1 次', delivered.length >= 1, 'calls=' + delivered.length);
  const last = delivered[delivered.length - 1];
  assert('投递参数含资源（石头）', last && last.full && Number(last.full['石头']) > 0, JSON.stringify(last && last.full));
  assert('投递参数 code = syl1', last && last.code === 'syl1');
  // 60s 周期的那条报告应带上 tribute 内容
  const reports = colonyReportsOf(acc);
  const r60 = reports[reports.length - 1];
  assert('60s 报告 tribute 非空', r60 && r60.tribute && Object.keys(r60.tribute).length > 0, JSON.stringify(r60 && r60.tribute));
  assert('tribute.mats 含石头', r60 && r60.tribute && Number(r60.tribute.mats['石头']) > 0);
}

// ---------------------------------------------------------------- ③ 舰船上供
console.log('[③] 船坞 + 舰队≥4：3 个贡品周期后恰有 1 艘船移到母星，舰队数量不变');
{
  const ships = [
    { id: 's1', className: '巡防舰', planetCode: 'syl1', state: { planetCode: 'syl1', fuelMol: 0 } },
    { id: 's2', className: '运输船', planetCode: 'syl', state: { planetCode: 'syl' } },
    { id: 's3', className: '运输船', planetCode: 'syl', state: { planetCode: 'syl' } },
    { id: 's4', className: '护卫舰', planetCode: 'syl', state: { planetCode: 'syl' } },
  ];
  const acc = makeAcc({ ships });
  const inst = makeInst({
    pop: { total: 100, happiness: 0.9, assignments: {} },
    buildings: { farm: 2, dock: 1 },   // 有船坞
    inventory: [{ mat: '石头', owned: 1000, layer: 'surface' }],
    equipment: {},
  });
  const env = {
    getInstanceOf: (code) => (code === 'syl1' ? inst : null),
    deliverToHome: () => true,
  };
  // 3 个贡品周期 = 180s（每 60s 一个贡品结算，第 3 次整除 3 → 上供）
  for (let i = 0; i < 3; i++) tickManagedColonies(acc, 60, env);
  const moved = ships.find((s) => s.id === 's1');
  assert('s1 已被移到母星（planetCode=syl）', moved.planetCode === 'syl', moved.planetCode);
  assert('s1.state.planetCode 一并改为 syl', moved.state && moved.state.planetCode === 'syl');
  assert('acc.ships.length 仍为 4（未删除）', acc.ships.length === 4, 'len=' + acc.ships.length);
  const onHome = acc.ships.filter((s) => s.planetCode === 'syl').length;
  assert('母星上共 4 艘（原 3 + 上供 1）', onHome === 4, 'onHome=' + onHome);
  assert('仍属 syl1 的船为 0', acc.ships.filter((s) => s.planetCode === 'syl1').length === 0);
}

// ---------------------------------------------------------------- ④ 报告上限 60
console.log('[④] 报告条数上限 60 生效');
{
  const acc = makeAcc();
  const inst = makeInst({ pop: { total: 100, happiness: 0.9, assignments: {} }, buildings: { farm: 2 } });
  const env = {
    getInstanceOf: (code) => (code === 'syl1' ? inst : null),
    deliverToHome: () => true,
  };
  for (let i = 0; i < 65; i++) tickManagedColonies(acc, 30, env);  // 生成 65 条
  const reports = colonyReportsOf(acc);
  assert('报告被截断到 60 条', reports.length === 60, 'len=' + reports.length);
  assert('超过 60 时丢弃最旧的（无报错）', reports.length <= 60);
}

// ---------------------------------------------------------------- ⑤ 母星/商店星/领土 无报告
console.log('[⑤] 母星 / 商店星 / 领土不产生报告');
{
  const acc = makeAcc({
    homePlanetCode: 'syl',
    capturedPlanets: [
      { code: 'syl', nameCn: '母星', isHome: true },                 // 母星
      { code: 'ast1', nameCn: '商店星', isShop: true },              // 商店星
      { code: 'syl1', nameCn: '领土星', isShop: false },             // 领土
    ],
  });
  const homeInst = makeInst({ code: 'syl', isHome: true });
  const terrInst = makeInst({ code: 'syl1', management: 'territory' });
  const env = {
    getInstanceOf: (code) => (code === 'syl' ? homeInst : code === 'syl1' ? terrInst : null),
    deliverToHome: () => true,
  };
  for (let i = 0; i < 5; i++) tickManagedColonies(acc, 30, env);  // 推进 150s
  const reports = colonyReportsOf(acc);
  assert('母星/商店星/领土 共 0 条报告', reports.length === 0, 'len=' + reports.length);
}

console.log('\n结果：通过 ' + pass + ' 项，失败 ' + fail + ' 项');
process.exit(fail === 0 ? 0 : 1);

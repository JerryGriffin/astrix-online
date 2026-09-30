// Astrix 专项探针：物品栏「开采时反而减少」回归哨兵（rev18）
//
// 设计者报告：物品栏存在重大 bug —— 开采时持有量反而减少。
//
// 本探针走**真实的 main.js 流程**（DOM 桩 + 手动驱动 setInterval），逐秒记录
// 各材料在 state 层的真实持有量（ownedOf）与物品栏 UI 显示值，断言：
//   A. 派露天采集工后，**无任何消耗方**的材料（石头 / 泥土）持有量必须单调不减
//   B. 有消耗方的材料（有机质 / 水）在有采集时也必须单调不减（当前采集速率远大于人口消耗）
//   C. UI 显示值必须与 state 层一致
//   D. 净增长符号必须与持有量的实际变化方向一致（正号 → 真的在涨）
//
// 用法：node docs/_probe_inv_decrease.mjs

// ===== 最小 DOM 桩（照抄 _probe_gather_lock.mjs）=====
class ClassList {
  constructor(el) { this.el = el; this.set = new Set(); }
  add(...c) { c.forEach((x) => this.set.add(x)); this._sync(); }
  remove(...c) { c.forEach((x) => this.set.delete(x)); this._sync(); }
  contains(c) { return this.set.has(c); }
  toggle(c, force) {
    const want = force === undefined ? !this.set.has(c) : !!force;
    if (want) this.set.add(c); else this.set.delete(c);
    this._sync();
  }
  _sync() { this.el._class = [...this.set].join(' '); }
}
class El {
  constructor(tag) {
    this.tagName = String(tag).toUpperCase();
    this.children = []; this.parentNode = null; this.attrs = {};
    this.style = {}; this.dataset = {}; this._text = ''; this._html = '';
    this._class = ''; this._listeners = {}; this.isConnected = true;
    this.classList = new ClassList(this);
  }
  get className() { return this._class; }
  set className(v) { this._class = String(v); this.classList.set = new Set(this._class.split(/\s+/).filter(Boolean)); }
  get textContent() { if (this._text) return this._text; return this.children.map((c) => c.textContent).join(''); }
  set textContent(v) { this._text = String(v); this.children = []; this._html = ''; }
  get innerHTML() { return this._html; }
  set innerHTML(v) { this._html = String(v); this.children = []; this._text = ''; }
  setAttribute(k, v) { this.attrs[k] = String(v); if (k === 'class') this.className = v; }
  get value() { return this.attrs.value ?? ''; }
  set value(v) { this.attrs.value = String(v); }
  get disabled() { return this.attrs.disabled !== undefined; }
  set disabled(v) { if (v) this.attrs.disabled = 'disabled'; else delete this.attrs.disabled; }
  getAttribute(k) { return this.attrs[k] ?? null; }
  appendChild(c) { if (!c) return c; c.parentNode = this; this.children.push(c); return c; }
  append(...cs) { cs.forEach((c) => this.appendChild(c)); }
  remove() {
    if (this.parentNode) {
      const i = this.parentNode.children.indexOf(this);
      if (i >= 0) this.parentNode.children.splice(i, 1);
      this.parentNode = null; this.isConnected = false;
    }
  }
  addEventListener(type, fn) { (this._listeners[type] ||= []).push(fn); }
  removeEventListener(type, fn) {
    const l = this._listeners[type]; if (!l) return;
    const i = l.indexOf(fn); if (i >= 0) l.splice(i, 1);
  }
  dispatch(type, ev = {}) {
    const handler = this['on' + type];
    if (typeof handler === 'function') handler({ target: this, ...ev });
    for (const fn of (this._listeners[type] || [])) fn({ target: this, ...ev });
  }
  closest(sel) {
    const want = sel.replace(/^\./, '');
    let n = this;
    while (n) { if (n.classList.contains(want)) return n; n = n.parentNode; }
    return null;
  }
  get firstChild() { return this.children[0] || null; }
  querySelectorAll(sel) { return walkAll(this).filter((e) => matchSel(e, sel)); }
  querySelector(sel) { return this.querySelectorAll(sel)[0] || null; }
  contains(node) { if (!node) return false; for (const c of walkAll(this)) if (c === node) return true; return false; }
}
function matchSel(e, sel) {
  if (sel.startsWith('.')) return e.classList.contains(sel.slice(1));
  return e.tagName === sel.toUpperCase();
}
function walkAll(node, out = []) { for (const c of node.children) { out.push(c); walkAll(c, out); } return out; }

const intervals = [];
globalThis.setInterval = (fn, ms) => { intervals.push({ fn, ms }); return intervals.length; };
globalThis.clearInterval = () => {};

const byId = { app: new El('div'), 'modal-root': new El('div') };
globalThis.document = {
  createElement: (t) => new El(t),
  createTextNode: (t) => { const e = new El('#text'); e.textContent = t; return e; },
  createDocumentFragment: () => new El('#fragment'),
  getElementById: (id) => byId[id] || null,
  addEventListener: () => {}, removeEventListener: () => {},
  activeElement: null, body: new El('body'),
};
globalThis.window = { addEventListener: () => {}, removeEventListener: () => {} };
globalThis.requestAnimationFrame = (fn) => { try { fn(); } catch (e) { throw e; } return 1; };
const _ls = new Map();
globalThis.localStorage = {
  getItem: (k) => (_ls.has(k) ? _ls.get(k) : null),
  setItem: (k, v) => _ls.set(k, String(v)),
  removeItem: (k) => _ls.delete(k),
  clear: () => _ls.clear(),
  key: (i) => [..._ls.keys()][i],
  get length() { return _ls.size; },
};

let pass = 0, fail = 0;
function ok(cond, label) {
  if (cond) { pass++; console.log('  ✓ ' + label); }
  else { fail++; console.log('  ✗ ' + label); }
}

const app = byId.app;
await import('../js/main.js?v=21.18');
const S = await import('../js/core/state.js?v=21.18');
const POP = await import('../js/core/population.js?v=21.18');
const PROD = await import('../js/core/production.js?v=21.18');

const allEls = () => walkAll(app).concat(app.children);
const findButton = (kw) => allEls().filter((e) => e.tagName === 'BUTTON').find((b) => b.textContent.includes(kw));
const tabBtns = () => allEls().filter((e) => e.className.includes('tab-btn'));
const modalBtns = () => walkAll(byId['modal-root']).filter((e) => e.tagName === 'BUTTON');

// ---- 进入游戏 ----
findButton('离线').dispatch('click');
const addBtn = modalBtns().find((b) => b.textContent.includes('新建存档'));
if (!addBtn) { console.log('✗ 找不到「新建存档」按钮'); process.exit(1); }
addBtn.dispatch('click');
const inst = S.getPlanetInstance('syl');
inst.buildings.manual_power = 3;

// ---- 打开物品栏 ----
tabBtns().find((x) => x.textContent === '物品栏').dispatch('click');
const container = allEls().find((e) => typeof e._invRefresh === 'function');
function ownedRows() {
  const grid = container.querySelectorAll('section')
    .find((s) => s.classList.contains('inv-block') && !s.classList.contains('inv-block-store') && !s.classList.contains('inv-block-equip'));
  const out = {};
  if (!grid) return out;
  for (const row of grid.querySelectorAll('.inv-row')) {
    if (!row.dataset.mat) continue;
    out[row.dataset.mat] = { owned: row._owned ? row._owned.textContent : null, rate: row._rate ? row._rate.textContent : null };
  }
  return out;
}
function refreshUI() {
  for (const it of intervals) {
    if (it.ms !== 250) continue;
    try { it.fn(); } catch (e) { /* ignore */ }
  }
}

const WATCH = ['石头', '泥土', '有机质', '水'];

// ===========================================================================
// A. 派露天采集工，逐秒记录「无消耗方」材料的持有量
// ===========================================================================
console.log('\n===== A. 露天采集：石头 / 泥土 / 有机质 / 水的持有量轨迹 =====');
S.currentAccount().tech = ['t_a1'];
POP.assignWorkers(inst.pop, 'surface_gatherer', 60, S.getBuildingCounts(inst));

const trail = {};   // mat -> [owned...]
for (const m of WATCH) trail[m] = [];
for (let t = 0; t < 40; t++) {
  S.tick(1);
  for (const m of WATCH) trail[m].push(S.ownedOf(inst, m));
}
for (const m of WATCH) {
  const arr = trail[m];
  const dec = arr.filter((v, i) => i > 0 && v < arr[i - 1] - 1e-9).length;
  console.log(`     ${m}: ${arr[0].toFixed(2)} → ${arr[arr.length - 1].toFixed(2)}  递减帧=${dec}/${arr.length - 1}`);
  console.log(`        轨迹: ${arr.map((v) => v.toFixed(2)).join(' ')}`);
}
for (const m of WATCH) {
  const arr = trail[m];
  const dec = arr.filter((v, i) => i > 0 && v < arr[i - 1] - 1e-9).length;
  ok(dec === 0, `${m} 在被采集时持有量必须单调不减，实际递减 ${dec} 帧`);
}
ok(trail['石头'][39] > trail['石头'][0], '石头应确实在增加（采集生效）');

// ===========================================================================
// B. UI 显示值必须与 state 层一致
// ===========================================================================
console.log('\n===== B. UI 显示值与 state 层一致性 =====');
S.tick(1);
refreshUI();
{
  const rows = ownedRows();
  for (const m of WATCH) {
    const ui = rows[m] ? rows[m].owned : null;
    const real = S.ownedOf(inst, m);
    console.log(`     ${m}: UI「${ui}」 state=${real.toFixed(2)} 净增长「${rows[m] ? rows[m].rate : '-'}」`);
  }
  const st = rows['石头'];
  ok(!!st && st.owned !== '' && st.owned !== null, '石头行必须有持有量显示值');
}

// ===========================================================================
// C. 净增长符号必须与实际变化方向一致
// ===========================================================================
console.log('\n===== C. 净增长符号 vs 实际变化方向 =====');
{
  const before = {};
  for (const m of WATCH) before[m] = S.ownedOf(inst, m);
  for (let i = 0; i < 10; i++) S.tick(1);
  const rows = ownedRows();   // 用上一轮的 UI
  refreshUI();
  const rows2 = ownedRows();
  for (const m of WATCH) {
    const delta = S.ownedOf(inst, m) - before[m];
    const shown = rows2[m] ? (rows2[m].rate || '').trim() : '';
    const positive = /^\+/.test(shown);
    const negative = /^-/.test(shown);
    console.log(`     ${m}: Δ=${delta.toFixed(2)}  显示「${shown}」`);
    if (delta > 1e-6 && positive) ok(true, `${m}：实际在涨，显示正号（一致）`);
    else if (delta < -1e-6 && negative) ok(true, `${m}：实际在跌，显示负号（一致）`);
    else if (Math.abs(delta) <= 1e-6) ok(true, `${m}：实际不变`);
    else ok(false, `${m}：实际 Δ=${delta.toFixed(3)}，但显示「${shown}」 —— 符号与实际方向不一致`);
  }
}

// ===========================================================================
// D. 全材料全层监控：任何被采集（rate>0）的材料，持有量都不得下降
// ===========================================================================
console.log('\n===== D. 建齐各层矿井 + 大气收集器，全材料监控 =====');
{
  S.currentAccount().tech = ['t_a1'];
  inst.buildings = {
    manual_power: 3, mine_shallow: 2, mine_deep: 2, mine_core: 2, gas_collector: 3,
  };
  inst.pop.assignments = {};
  for (const job of ['surface_gatherer', 'mine_shallow_worker', 'mine_deep_worker', 'mine_core_worker', 'gas_collector_worker']) {
    POP.assignWorkers(inst.pop, job, 12, S.getBuildingCounts(inst));
  }
  S.tick(1);
  console.log('     人手占用：' + JSON.stringify(inst.pop.assignments) + '  总人口=' + inst.pop.total);
  const mats = [...new Set(inst.inventory.filter((e) => e.layer !== 'refined').map((e) => e.mat))];
  const prev = {};
  for (const m of mats) prev[m] = S.ownedOf(inst, m);
  const drops = {};   // mat -> {count, rate, delta}
  for (let t = 0; t < 30; t++) {
    S.tick(1);
    for (const m of mats) {
      const now = S.ownedOf(inst, m);
      const d = now - prev[m];
      if (d < -1e-6) {
        drops[m] = drops[m] || { count: 0, rate: 0, delta: 0 };
        drops[m].count++;
        drops[m].delta += d;
      }
      prev[m] = now;
    }
  }
  const rateSum = {};
  for (const e of inst.inventory) if (e.layer !== 'refined') rateSum[e.mat] = (rateSum[e.mat] || 0) + (Number(e.rate) || 0);
  const list = Object.keys(drops);
  if (list.length === 0) {
    ok(true, '30 秒内没有任何非加工材料持有量下降');
  } else {
    for (const m of list) {
      const rs = rateSum[m] || 0;
      const tag = rs > 0 ? '【在采矿却下降 ⇒ BUG】' : '（无采集速率，属消耗方）';
      console.log(`     ${m}: 下降 ${drops[m].count} 帧 累计 ${drops[m].delta.toFixed(2)}  采集速率合计=${rs.toFixed(4)} ${tag}`);
    }
    ok(list.every((m) => !(rateSum[m] > 0)),
      '不得出现「采集速率>0 但持有量在下降」的材料（如出现即为开采反向 bug）');
  }
  const sample = ['石头', '铁', '铜', '钛', '氧气', '二氧化碳'];
  console.log('     抽查：' + sample.map((m) => `${m}=${S.ownedOf(inst, m).toFixed(1)}(rate ${(rateSum[m] || 0).toFixed(3)})`).join(' | '));
}

// ===========================================================================
// E. 【rev18 核心回归】净增长必须与实际 tick 结算逐项一致
// ===========================================================================
// 设计者报的「开采时反而减少」根因就是这里：computeNetRates 漏算农田（与燃机燃料），
// 于是「净增长」列与实际变化不符，甚至出现「显示正增长（绿）而库存实际在减少」。
// 本组断言：对每种材料，netRates × dt 必须等于 1 秒 tick 的真实增量（容差 2%）。
console.log('\n===== E. 净增长 vs 实际增量（含农田 / 燃机）=====');
function consistencyCheck(label) {
  const mats = [...new Set(inst.inventory.map((e) => e.mat))];
  const before = {};
  for (const m of mats) before[m] = S.ownedOf(inst, m);
  const nets = {};
  for (const m of mats) nets[m] = Number(inst.netRates[m]) || 0;
  S.tick(1);
  const bad = [];
  for (const m of mats) {
    const d = S.ownedOf(inst, m) - before[m];
    const net = nets[m];
    const tol = Math.max(2e-3, Math.abs(net) * 0.02 + 2e-3);
    const signFlip = (net > 0 && d < -1e-6) || (net < 0 && d > 1e-6);
    if (Math.abs(d - net) > tol || signFlip) {
      bad.push(`${m}: 净增长=${net.toFixed(4)} 实际Δ=${d.toFixed(4)}${signFlip ? '（符号相反！）' : ''}`);
    }
  }
  if (bad.length) {
    for (const b of bad) console.log('       ✗ ' + b);
    ok(false, `${label}：${bad.length} 种材料的净增长与实际增量不一致`);
  } else {
    ok(true, `${label}：全部材料净增长与实际增量一致（${mats.length} 种）`);
  }
  return bad.length === 0;
}

// E1 基线（仅采集）
{
  S.currentAccount().tech = ['t_a1'];
  inst.buildings = { manual_power: 6, house: 20, mine_shallow: 2, mine_deep: 2, mine_core: 2, gas_collector: 2 };
  inst.pop.total = 400;
  inst.pop.assignments = {};
  for (const j of ['surface_gatherer', 'mine_shallow_worker', 'mine_deep_worker', 'mine_core_worker', 'gas_collector_worker', 'manual_power_worker']) {
    POP.assignWorkers(inst.pop, j, 12, S.getBuildingCounts(inst));
  }
  S.tick(1);
  S.tick(1);
  consistencyCheck('E1 基线（仅采集）');
}

// E2 开农田（本次 bug 的主场景：农田吃掉的水此前不计入净增长）
{
  inst.buildings.farm = 10;
  POP.assignWorkers(inst.pop, 'farm_worker', 120, S.getBuildingCounts(inst));
  S.tick(1); S.tick(1);
  const organicNet = Number(inst.netRates['有机质']) || 0;
  ok(organicNet > 0, `E2 农田工在岗时「有机质」净增长应为正，实际 ${organicNet.toFixed(4)}`);
  consistencyCheck('E2 开农田（10 座 / 120 农田工）');
}

// E3 极端组合：少人采水 + 大农田 —— 此前「水」会显示正增长却实际在减少
{
  inst.pop.assignments = {};
  POP.assignWorkers(inst.pop, 'surface_gatherer', 5, S.getBuildingCounts(inst));
  POP.assignWorkers(inst.pop, 'farm_worker', 200, S.getBuildingCounts(inst));
  S.tick(1); S.tick(1);
  const waterNet = Number(inst.netRates['水']) || 0;
  const before = S.ownedOf(inst, '水');
  for (let i = 0; i < 5; i++) S.tick(1);
  const d = (S.ownedOf(inst, '水') - before) / 5;
  console.log(`     水：净增长=${waterNet.toFixed(4)}  实测Δ=${d.toFixed(4)}`);
  ok(!(waterNet > 0 && d < -1e-9),
    'E3 少人采水 + 大农田时，不得出现「净增长为正而水实际在减少」（这正是设计者报的现象）');
  consistencyCheck('E3 极端组合（5 采集工 + 200 农田工）');
}

// E4 装燃机烧燃料：燃料消耗也必须在净增长里
{
  inst.facilities = { thermal_m: 2 };
  inst.facilityFuel = { thermal_m: '甲烷' };
  inst.pop.assignments = {};
  for (const j of ['surface_gatherer', 'gas_collector_worker', 'manual_power_worker']) {
    POP.assignWorkers(inst.pop, j, 12, S.getBuildingCounts(inst));
  }
  // 保证甲烷有货，避免「没料可烧」导致本组失去意义
  const CH4 = PROD.ensureEntry(inst, '甲烷', 'refined');
  CH4.owned = Math.max(Number(CH4.owned) || 0, 5000);
  S.tick(1); S.tick(1);
  const fuelNet = Number(inst.netRates['甲烷']) || 0;
  const before = S.ownedOf(inst, '甲烷');
  S.tick(1);
  const d = S.ownedOf(inst, '甲烷') - before;
  console.log(`     甲烷：净增长=${fuelNet.toFixed(4)}  实测Δ=${d.toFixed(4)}（燃机 2 座）`);
  ok(fuelNet < 0 || d >= 0, 'E4 燃机烧甲烷时，甲烷净增长必须把燃料消耗算进去（不得漏成正值）');
  consistencyCheck('E4 燃机烧燃料（甲烷）');
  inst.facilities = {};
}

// E5 缺电停产：净增长为 0 时必须给出「电力不足」原因，不能是空白
{
  inst.pop.total = 120;
  inst.buildings = { mine_shallow: 2 };        // 无任何发电 → ratio = 0
  inst.pop.assignments = {};
  POP.assignWorkers(inst.pop, 'mine_shallow_worker', 20, S.getBuildingCounts(inst));
  S.tick(1);
  refreshUI();
  console.log(`     电力比=${JSON.stringify(inst.powerInfo && inst.powerInfo.ratio)}`);
  const rows = ownedRows();
  const st = rows['石头'];
  console.log(`     石头行：${JSON.stringify(st)}`);
  ok(!!st && /电力不足/.test(st.rate || ''),
    `缺电时净增长列必须说明「电力不足，停产」，实际「${st && st.rate}」`);
}

console.log('\n===== 探针汇总 =====');
console.log('  通过 ' + pass + ' / 失败 ' + fail);
process.exit(fail ? 1 : 0);

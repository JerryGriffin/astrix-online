// Astrix rev16 专项探针：物品栏「采集时显示不增不减」回归哨兵
//
// 复现的 bug（设计者报「物品栏存在bug，采集时显示不增不减」）：
//   玩家点了「露天采集工」去采粘土 / 石英 / 石墨，物品栏里这些资源纹丝不动；
//   点开资源详情只写「净增长 0（不增不减）」，「来源 / 消耗」还谎称「未分配人力」。
//   根因：地表稀有资源在「A1 深度采集」研究出来之前（以及地下 / 深层 / 地核 / 气体层
//   在对应建筑建成之前）增速被合法地压为 0，但 UI 完全不说明原因。
//
// 本探针走**真实的 main.js 流程**（DOM 桩 + 手动驱动 setInterval），断言：
//   A. 被科技锁住的地表资源：净增长列必须显示解锁条件，不能空白
//   B. 研究出「A1 深度采集」后：同一行必须变成真实的正净增长
//   C. 矿层未建成建筑：必须提示「需建造「…」」
//   D. 可采但没人干：必须提示「未分配人力」（而不是空白）
//   E. 资源详情的「净增长」「来源 / 消耗」必须如实说明，不得出现「不增不减」+「未分配人力」这种自相矛盾
//   F. 可见行指纹与数值无关：连续刷新不得出现整表数字为空的帧（此前排名一变就整表重建）
//
// 用法：node docs/_probe_gather_lock.mjs

// ===== 最小 DOM 桩（照抄 selfcheck_render.mjs）=====
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

// setInterval 拦下来手动驱动（浏览器里 = 心跳 1000ms + 物品栏刷新 250ms）
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
await import('../js/main.js?v=21.17');
const S = await import('../js/core/state.js?v=21.17');
const POP = await import('../js/core/population.js?v=21.17');

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
inst.buildings.manual_power = 3;      // 电力充足，避免被缺电降速掩盖问题

// ---- 打开物品栏，抓容器与行读取器 ----
tabBtns().find((x) => x.textContent === '物品栏').dispatch('click');
const container = allEls().find((e) => typeof e._invRefresh === 'function');
const gridOf = (cls) => container.querySelectorAll('section').find((s) => s.classList.contains(cls));
function ownedRows() {
  const grid = gridOf('inv-block') && container.querySelectorAll('section')
    .find((s) => s.classList.contains('inv-block') && !s.classList.contains('inv-block-store') && !s.classList.contains('inv-block-equip'));
  const out = {};
  for (const row of (grid ? grid.querySelectorAll('.inv-row') : [])) {
    out[row.dataset.mat] = { owned: row._owned.textContent, rate: row._rate.textContent };
  }
  return out;
}
function storeTextOf(mat, layer) {
  const grid = container.querySelectorAll('section').find((s) => s.classList.contains('inv-block-store'));
  const row = (grid ? grid.querySelectorAll('.inv-row-store') : [])
    .find((r) => r.dataset.mat === mat && (!layer || r.dataset.layer === layer));
  return row ? { remain: row._remain.textContent, ab: row._ab.textContent, lockedClass: row.classList.contains('inv-row-locked') } : null;
}
// 物品栏刷新是 250ms 的那个定时器（心跳是 1000ms），这里只驱动 UI 刷新，避免重复 tick
function refreshUI() {
  for (const it of intervals) {
    if (it.ms !== 250) continue;
    try { it.fn(); } catch (e) { /* 单次刷新异常不中断探针 */ }
  }
}

// ===========================================================================
// A. 被科技锁住的地表资源：必须显示解锁条件，而不是空白
// ===========================================================================
console.log('\n===== A. 地表稀有资源被「A1 深度采集」锁住 =====');
refreshUI();
const a0 = ownedRows();
console.log('     粘土行:', JSON.stringify(a0['粘土']), '| 石墨行:', JSON.stringify(a0['石墨']));
ok(!!a0['粘土'] && /需研究.*深度采集/.test(a0['粘土'].rate),
  `粘土（未研究 A1）净增长列应说明需研究「A1 深度采集」，实际「${a0['粘土'] && a0['粘土'].rate}」`);
ok(!!a0['石墨'] && /需研究.*深度采集/.test(a0['石墨'].rate),
  `石墨（未研究 A1）净增长列应说明需研究「A1 深度采集」，实际「${a0['石墨'] && a0['石墨'].rate}」`);
ok(Number(inst.netRates['粘土'] || 0) === 0 && Number(inst.netRates['石墨'] || 0) === 0,
  '前置事实：未研究 A1 时粘土 / 石墨的 netRates 确实为 0（所以 UI 必须给原因）');

// 星球储藏：被锁的层要灰显并标注
const stClay = storeTextOf('粘土', 'surface');
console.log('     储藏·地表粘土:', JSON.stringify(stClay));
ok(!!stClay && stClay.lockedClass && /需研究.*深度采集/.test(stClay.ab),
  `储藏栏「地表·粘土」应灰显并标注解锁条件，实际 ${JSON.stringify(stClay)}`);

// ===========================================================================
// B. 研究出 A1 后，同一行必须变成真实的正净增长
// ===========================================================================
console.log('\n===== B. 研究「A1 深度采集」后应立刻可采 =====');
S.currentAccount().tech = ['t_a1'];
POP.assignWorkers(inst.pop, 'surface_gatherer', 60, S.getBuildingCounts(inst));
S.tick(1);
refreshUI();
const b0 = ownedRows();
console.log('     粘土行:', JSON.stringify(b0['粘土']));
ok(!!b0['粘土'] && /^\+/.test((b0['粘土'].rate || '').trim()),
  `研究 A1 并派人后，粘土净增长应为正，实际「${b0['粘土'] && b0['粘土'].rate}」`);
ok(Number(inst.netRates['粘土'] || 0) > 0, `state 侧粘土 netRates 应为正，实际 ${inst.netRates['粘土']}`);

// ===========================================================================
// C. 可采但没人干 → 「未分配人力」；D. 未建矿井 → 「需建造…」
// ===========================================================================
console.log('\n===== C/D. 未分配人力 / 未建矿井 的原因提示 =====');
{
  // C：清空所有人力 → 已解锁的石头应变「未分配人力」
  inst.pop.assignments = {};
  S.tick(1);
  refreshUI();
  const c0 = ownedRows();
  console.log('     石头行（无人）:', JSON.stringify(c0['石头']));
  ok(!!c0['石头'] && /未分配人力/.test(c0['石头'].rate),
    `无人采集时石头应提示「未分配人力」，实际「${c0['石头'] && c0['石头'].rate}」`);

  // D：石墨同时存在于地表与浅层 / 深层 / 地核 —— 未建矿井时地下各层应提示建造
  const stG = storeTextOf('石墨', 'underground');
  console.log('     储藏·浅层石墨:', JSON.stringify(stG));
  ok(!!stG && stG.lockedClass && /需建造/.test(stG.ab),
    `未建浅层矿井时「浅层·石墨」应标注需建造，实际 ${JSON.stringify(stG)}`);
}

// ===========================================================================
// D2. 建成浅层矿井后，储藏行的锁提示必须消失（实时跟着建筑走）
// ===========================================================================
console.log('\n===== D2. 建成矿井后锁定提示应实时消失 =====');
{
  inst.buildings.mine_shallow = 1;
  S.tick(1);
  refreshUI();
  refreshUI();
  const stG2 = storeTextOf('石墨', 'underground');
  console.log('     储藏·浅层石墨（已建矿井）:', JSON.stringify(stG2));
  ok(!!stG2 && !stG2.lockedClass && !/需建造/.test(stG2.ab),
    `建成浅层矿井后不应再显示锁定提示，实际 ${JSON.stringify(stG2)}`);
}

// ===========================================================================
// E. 资源详情不得自相矛盾
// ===========================================================================
console.log('\n===== E. 资源详情的净增长 / 来源说明 =====');
function detailTextOf(mat) {
  const grid = container.querySelectorAll('section')
    .find((s) => s.classList.contains('inv-block') && !s.classList.contains('inv-block-store') && !s.classList.contains('inv-block-equip'));
  const row = grid.querySelectorAll('.inv-row').find((r) => r.dataset.mat === mat);
  if (!row) return null;
  container.dispatch('click', { target: row });   // DOM 桩不冒泡 → 在容器上派发委托事件
  const bodies = walkAll(byId['modal-root']).filter((e) => e.className === 'modal-body');
  return bodies.map((b) => String(b._html || '').replace(/<[^>]+>/g, '|')).join('|');
}
{
  // 先把 A1 与矿井都撤掉，复现「地表与地下全被锁住」的初始状态
  S.currentAccount().tech = [];
  inst.buildings = {};
  S.tick(1);
  refreshUI();
  const txt = detailTextOf('粘土');
  ok(!!txt, '应能打开粘土详情');
  ok(!!txt && /0（需研究「A1 深度采集」）/.test(txt),
    '被锁资源的「净增长」应写明解锁条件，而不是「0（不增不减）」');
  ok(!!txt && !/未分配人力/.test(txt),
    '被锁资源的「来源 / 消耗」不得再谎称「未分配人力」（那正是玩家以为采集坏了的原因）');
  console.log('     详情命中片段:', (txt || '').split('|').filter((s) => /净增长|原因|产出/.test(s)).join(' / '));
}

// ===========================================================================
// F. 可见行指纹与数值无关：不得出现整表为空的帧（此前排名一变就整表重建）
// ===========================================================================
console.log('\n===== F. 刷新稳定性（无「整表数字为空」帧）=====');
{
  S.currentAccount().tech = ['t_a1'];
  POP.assignWorkers(inst.pop, 'surface_gatherer', 60, S.getBuildingCounts(inst));
  let blankFrames = 0, total = 0;
  for (let i = 0; i < 60; i++) {
    S.tick(1);
    for (let k = 0; k < 4; k++) {
      refreshUI();
      total++;
      const rows = Object.values(ownedRows());
      if (rows.length && rows.every((r) => r.owned === '')) blankFrames++;
    }
  }
  ok(blankFrames === 0, `连续 240 次刷新不应出现整表数字为空的帧，实际 ${blankFrames}/${total}`);
  const f0 = ownedRows();
  console.log('     60 秒后:', Object.entries(f0).map(([m, v]) => m + '=' + v.owned + v.rate).join(' | '));
  ok(Object.values(f0).some((r) => /^\+/.test((r.rate || '').trim())),
    '60 秒后应至少有一行显示正的净增长（采集确实在跑）');
}

console.log('\n===== 探针汇总 =====');
console.log('  通过 ' + pass + ' / 失败 ' + fail);
process.exit(fail ? 1 : 0);

// Astrix v0.0.5 冒烟渲染测试
// 用最小 DOM 桩真实执行 main.js → 开始界面 → 离线模式 → 星球界面 → 逐个 tab，
// 捕获任何抛出的运行时异常（这一步能抓到语法检查抓不到的东西）。

// ===== 最小 DOM 桩 =====
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
    this.children = [];
    this.parentNode = null;
    this.attrs = {};
    this.style = {};
    this.dataset = {};
    this._text = '';
    this._html = '';
    this._class = '';
    this._listeners = {};
    this.classList = new ClassList(this);
  }
  get className() { return this._class; }
  set className(v) {
    this._class = String(v);
    this.classList.set = new Set(this._class.split(/\s+/).filter(Boolean));
  }
  get textContent() {
    if (this._text) return this._text;
    return this.children.map((c) => c.textContent).join('');
  }
  set textContent(v) { this._text = String(v); this.children = []; this._html = ''; }
  get innerHTML() { return this._html; }
  set innerHTML(v) { this._html = String(v); this.children = []; this._text = ''; }
  setAttribute(k, v) { this.attrs[k] = String(v); if (k === 'class') this.className = v; }
  // 输入类元素：真浏览器里 input/select 有 value 属性，脚本靠它读输入栏的值
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
      this.parentNode = null;
    }
  }
  addEventListener(type, fn) { (this._listeners[type] ||= []).push(fn); }
  removeEventListener(type, fn) {
    const l = this._listeners[type]; if (!l) return;
    const i = l.indexOf(fn); if (i >= 0) l.splice(i, 1);
  }
  dispatch(type, ev = {}) {
    // 真浏览器里 onclick 与 addEventListener('click') 都会触发；
    // 早期版本只派发 addEventListener 注册的监听器，导致用 onclick 赋值的按钮
    // （如船坞的「建造」）在冒烟测试里被静默跳过。
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
  // v0.0.6 补桩：单数 querySelector。多个面板用 `root.querySelector('.xxx')`
  //   判断「面板还在不在页面上」（定时刷新时用），只有 querySelectorAll 会直接
  //   报 `root.querySelector is not a function`，把整个面板拖垮。
  querySelector(sel) { return this.querySelectorAll(sel)[0] || null; }
  // v0.0.6 补桩：contains。定时刷新前用它判断「玩家是不是正在操作面板」（避免打断下拉框）。
  contains(node) {
    if (!node) return false;
    for (const c of walkAll(this)) if (c === node) return true;
    return false;
  }
}

function matchSel(e, sel) {
  if (sel.startsWith('.')) return e.classList.contains(sel.slice(1));
  return e.tagName === sel.toUpperCase();
}
function walkAll(node, out = []) {
  for (const c of node.children) { out.push(c); walkAll(c, out); }
  return out;
}

const documentEl = new El('html');
const byId = { app: new El('div'), 'modal-root': new El('div') };
globalThis.document = {
  createElement: (t) => new El(t),
  createTextNode: (t) => { const e = new El('#text'); e.textContent = t; return e; },
  createDocumentFragment: () => new El('#fragment'),
  getElementById: (id) => byId[id] || null,
  addEventListener: () => {},
  removeEventListener: () => {},
  // v0.0.6 补桩：面板定时刷新会读它判断「玩家是否正在操作下拉框」。
  //   真实浏览器里没聚焦时是 body，这里给 null 等价于「没在操作」。
  activeElement: null,
  body: documentEl,
};
globalThis.window = {
  addEventListener: () => {},
  removeEventListener: () => {},
};
globalThis.requestAnimationFrame = (fn) => { try { fn(); } catch (e) { throw e; } return 1; };
globalThis.setInterval = () => 1;       // 心跳不真跑，避免进程挂住
globalThis.clearInterval = () => {};
const _ls = new Map();
globalThis.localStorage = {
  getItem: (k) => (_ls.has(k) ? _ls.get(k) : null),
  setItem: (k, v) => _ls.set(k, String(v)),
  removeItem: (k) => _ls.delete(k),
  clear: () => _ls.clear(),
  key: (i) => [..._ls.keys()][i],
  get length() { return _ls.size; },
};
// 让 Object.keys(localStorage) 能看到键
for (const k of ['getItem', 'setItem', 'removeItem', 'clear', 'key']) {
  Object.defineProperty(globalThis.localStorage, k, { enumerable: false });
}

// ===== 执行 =====
const errors = [];
const pending = [];
const step = (label, fn) => {
  try {
    const r = fn();
    if (r && typeof r.then === 'function') {
      pending.push(r.then(
        () => console.log('OK   ' + label),
        (e) => { errors.push(label + ' -> ' + e.message); console.log('FAIL ' + label + ' -> ' + e.message); },
      ));
      return;
    }
    console.log('OK   ' + label);
  } catch (e) { errors.push(label + ' -> ' + e.message); console.log('FAIL ' + label + ' -> ' + e.message + '\n' + String(e.stack).split('\n').slice(1, 4).join('\n')); }
};

const app = byId.app;

// 用动态 import 真正跑一遍 main.js（含启动、渲染开始界面、注册心跳）
step('加载 main.js（启动 + 渲染开始界面）', () => {});
await import('../js/main.js?v=30.1');

const S = await import('../js/core/state.js?v=30.1');
const Y = await import('../js/core/shipyard.js?v=30.1');
const POP = await import('../js/core/population.js?v=30.1');

const allEls = () => walkAll(app).concat(app.children);
const findButtons = () => allEls().filter((e) => e.tagName === 'BUTTON');
const findButton = (kw) => findButtons().find((b) => b.textContent.includes(kw));
// 精确 class 匹配：避免 res-upg 误匹配到容器 res-upgrades
const byClass = (name) => allEls().filter((e) => e.className.split(/\s+/).includes(name));
// 全文本：DOM 桩的 innerHTML 只存字符串，不生成子节点，所以也要搜 _html
const allText = () => allEls().map((e) => e.textContent + ' ' + (e._html || '')).join(' ');

console.log('\n开始界面按钮:', findButtons().map((b) => b.textContent.replace(/\s+/g, ' ').trim().slice(0, 24)).join(' | ') || '(无)');

step('点击「在线模式」', () => {
  const b = findButton('在线');
  if (!b) throw new Error('未找到在线模式按钮');
  b.dispatch('click');
});
step('关闭模态层', () => {
  const btns = walkAll(byId['modal-root']).filter((e) => e.className.includes('modal-close'));
  if (!btns.length) throw new Error('模态层未生成或没有关闭按钮');
  btns[0].dispatch('click');
});

// v0.0.6（需求 R6）：点「离线模式」现在**总是**先进存档选择界面
//   （以前没有存档时会直接进游戏，那正是「单一存档删不掉」的根因：
//   删光后再点离线会被 ensureAccount 自动重建一个「指挥官」）。
//   所以这里要多一步：在模态里点「+ 新建存档」。
const findModalButton = (kw) =>
  walkAll(byId['modal-root']).filter((e) => e.tagName === 'BUTTON')
    .find((b) => b.textContent.includes(kw));

step('点击「离线模式」→ 应先进存档选择界面', () => {
  const b = findButton('离线');
  if (!b) throw new Error('未找到离线模式按钮');
  b.dispatch('click');
  if (!findModalButton('新建存档')) {
    throw new Error('点离线模式后应出现存档选择界面（含「+ 新建存档」），R6 要求总是先选存档');
  }
});

console.log('[PROBE]', JSON.stringify({ cur: S.STATE.currentAccountId, accs: S.STATE.accounts.map(a=>a.id), keys: _ls.size }));
step('新建存档并进入星球', () => {
  const add = findModalButton('新建存档');
  if (!add) throw new Error('存档选择界面没有「+ 新建存档」按钮');
  add.dispatch('click');
});

const tabBtns = () => allEls().filter((e) => e.className.includes('tab-btn'));
console.log('\n星球内 tab:', tabBtns().map((b) => b.textContent).join(' | ') || '(无)');

// v0.0.6：底部菜单新增「电力」（储电站与设施）；原来的占位「殖民」tab 被
//   真正能用的「星球选择」取代，而后者**只在造出船坞之后才出现**——
//   所以这里不检查它，等下面造出船坞后再单独验证。
for (const label of ['物品栏', '人力', '科研', '建筑', '电力', '舰队', '军队']) {
  step(`切换到「${label}」`, () => {
    const b = tabBtns().find((x) => x.textContent === label);
    if (!b) throw new Error('未找到该 tab');
    b.dispatch('click');
  });
}


console.log('[PROBE]', JSON.stringify({ cur: S.STATE.currentAccountId, accs: S.STATE.accounts.map(a=>a.id), keys: _ls.size }));
step('未建船坞时不应出现「星球选择」tab', () => {
  if (tabBtns().find((x) => x.textContent === '星球选择')) {
    throw new Error('还没造船坞就出现了「星球选择」tab（需求 R13 要求造出船坞后才出现）');
  }
});
// 电力面板是异步动态 import，给它一个事件循环
step('等待电力面板异步加载', () => {});
await new Promise((r) => setTimeout(r, 300));

// 人力面板是异步动态 import，给它一个事件循环
step('等待人力面板异步加载', () => {});
await new Promise((r) => setTimeout(r, 300));

const closeModals = () => {
  let n = 0;
  for (;;) {
    const btns = walkAll(byId['modal-root']).filter((e) => e.className.includes('modal-close'));
    if (!btns.length) break;
    btns[0].dispatch('click');
    n++;
    if (n > 10) break;
  }
  return n;
};
const navBtns = () => allEls().filter((e) => e.className.includes('res-nav-btn'));
const clickNav = (label) => {
  const b = navBtns().find((x) => x.textContent === label);
  if (!b) throw new Error('未找到科研子标签「' + label + '」');
  b.dispatch('click');
};

// ---- v0.0.5：人力面板（只显示可分配岗位 + 批量输入栏 + 三消耗三产出）----
const popRows = () => allEls().filter((e) => e.className.split(/\s+/).includes('pop-job'));
const popInputs = () => popRows().map((r) => walkAll(r).find((e) => e.tagName === 'INPUT' && e.className.split(/\s+/).includes('cnt-in'))).filter(Boolean);

step('切到「人力」并等待面板异步加载', () => {
  closeModals();
  const b = tabBtns().find((x) => x.textContent === '人力');
  if (!b) throw new Error('未找到人力 tab');
  b.dispatch('click');
});
await new Promise((r) => setTimeout(r, 80));   // 人力面板是 await import 进来的，等一个事件循环

step('人力面板：只显示可分配岗位 + 数字输入栏 + 三消耗三产出', () => {

  const groups = allEls().filter((e) => e.className.split(/\s+/).includes('pop-ghead'));
  console.log('     岗位分组:', groups.map((g) => g.textContent.replace(/\s+/g, ' ').trim().slice(0, 30)).join(' || ') || '(无)');

  // 只显示已建成建筑的岗位 —— 开局只有 1 座建筑工厂
  const gnames = groups.map((g) => g.textContent);
  if (!gnames.some((t) => t.includes('无需建筑'))) throw new Error('缺少「无需建筑」分组');
  if (!gnames.some((t) => t.includes('建筑工厂'))) throw new Error('开局自带建筑工厂，应出现其分组');
  if (gnames.some((t) => t.includes('熔炉') || t.includes('科研所') || t.includes('船坞'))) {
    throw new Error('未建成 / 未解锁的建筑不应出现在人力面板里');
  }

  const ins = popInputs();
  console.log('     人数输入栏数量:', ins.length);
  if (ins.length < 2) throw new Error('每个可分配岗位都应有数字输入栏，实际 ' + ins.length);
  if (!ins.every((i) => i.attrs.type === 'number')) throw new Error('输入栏应为 number 类型');
  if (!allEls().some((e) => e.textContent === '满员')) throw new Error('缺少「满员」按钮');
  if (!allEls().some((e) => e.className.split(/\s+/).includes('gfree'))) throw new Error('分组头缺少空闲工位');
  if (!/空闲工位/.test(allText())) throw new Error('未显示空闲工位');

  const txt = allText();
  for (const kw of ['氧气', '有机质', '水', '二氧化碳', '甲烷', '氨气']) {
    if (!txt.includes(kw)) throw new Error('顶部营养代谢区缺少：' + kw);
  }
  if (!/另有 \d+ 个岗位/.test(txt)) throw new Error('应提示还有多少岗位因建筑未建成而不显示');
  console.log('     ✓ 只显示可分配岗位 / 空闲工位 / 满员 / 一吃五出 全部就位');
});

step('人力面板：输入栏填 30 人并提交', () => {
  const rows = popRows();
  if (!rows.length) throw new Error('人力面板没有渲染出任何岗位行');

  const row = rows[rows.length - 1];              // 取最后一行（建筑工）
  const input = walkAll(row).find((e) => e.tagName === 'INPUT');
  if (!input) throw new Error('该行没有输入栏');
  input.value = '30';
  input.dispatch('change');
});
await new Promise((r) => setTimeout(r, 40));

step('人力面板：重绘后输入栏应为 30（批量分配生效）', () => {
  // 重新渲染后复查：这一行的输入框值应变成 30
  const after = popInputs().map((i) => i.attrs.value);
  console.log('     重绘后各行人数:', after.join(', '));
  if (!after.includes('30')) throw new Error('输入 30 后输入栏应显示 30，实际 ' + after.join(','));
  console.log('     ✓ 输入栏可直接批量填人');
});

// ---- v0.0.5：建筑面板 ----
step('建筑面板：列出已解锁建筑、按类别分组、带建造按钮', () => {
  const b = tabBtns().find((x) => x.textContent === '建筑');
  if (!b) throw new Error('未找到建筑 tab');
  b.dispatch('click');
  if (!byClass('bld-panel').length) throw new Error('建筑面板没有渲染');
  const cats = byClass('bld-cat');
  const rows = byClass('bld-row');
  const buildBtns = allEls().filter((e) => e.tagName === 'BUTTON' && e.textContent.includes('建造'));
  console.log('     类别分组:', cats.length, '| 建筑行:', rows.length, '| 建造按钮:', buildBtns.length);
  if (!cats.length) throw new Error('建筑面板缺少类别分组');
  // v0.0.7：未解锁的建筑整条不渲染（设计者明确），开局只显示默认解锁的 4 座
  //   （科研所 / 房屋 / 建筑工厂 / 人力发电厂）。
  if (rows.length < 4) throw new Error('建筑行过少：开局至少应显示 4 座默认解锁建筑，实际 ' + rows.length);
  const rowText = rows.map((r) => r.textContent).join(' ');
  if (!/科研所/.test(rowText)) throw new Error('科研所应置顶且出现');
  if (!/建筑工厂/.test(rowText)) throw new Error('开局自带建筑工厂应出现');
  // 未解锁的建筑（如熔炉，需 t_b1）不应出现
  if (/熔炉/.test(rowText)) throw new Error('未解锁的熔炉不应出现在建筑面板');
  if (!buildBtns.length) throw new Error('建筑面板缺少建造按钮');
  if (!/施工能力|门槛/.test(allText())) throw new Error('建筑面板缺少施工状态区');
});

step('建筑面板：点「建造」科研所应扣材料并进入施工队列', () => {
  const S2 = S;
  const inst = S2.getPlanetInstance('syl');
  // v0.0.6（需求 R2）：开局物资被调低（泥土/石头只有 200），而科研所要石头 800 + 泥土 500 + 有机质 300，
  //   所以先补料——本步要验的是「点建造会不会真的扣料入队」，不是「开局给得够不够」。
  //   「开局到底给了多少」由 selfcheck_v005.mjs 的第十节单独断言。
  for (const nm of ['石头', '泥土', '有机质']) {
    const e = inst.inventory.find((x) => x.mat === nm);
    if (e) { e.owned = 1e6; e.remaining = Math.max(e.remaining, 1e6); }
  }
  // 施工硬门槛：建筑工厂里必须有人当建筑工，否则建造按钮是禁用的
  POP.assignWorkers(inst.pop, 'builder', 20, S2.getBuildingCounts(inst));
  // 补完料与人手要重绘面板——按钮的 disabled 状态是绘制那一刻算的
  tabBtns().find((x) => x.textContent === '建筑').dispatch('click');

  const rows = byClass('bld-row');
  const labRow = rows.find((r) => r.textContent.includes('科研所'));
  if (!labRow) throw new Error('建筑面板里找不到科研所');
  const btn = walkAll(labRow).find((e) => e.tagName === 'BUTTON');
  if (!btn) throw new Error('科研所没有建造按钮');
  if (btn.disabled) throw new Error('材料与建筑工都齐了，建造按钮不该被禁用');
  const queueBefore = S2.buildQueueOf(inst).length;
  btn.dispatch('click');
  closeModals();
  const queueAfter = S2.buildQueueOf(inst).length;
  console.log('     施工队列:', queueBefore, '→', queueAfter);
  if (queueAfter <= queueBefore) throw new Error('点击建造后施工队列应增加');
  if (!/正在施工/.test(allText())) throw new Error('建筑面板应显示「正在施工」进度区');
});


console.log('[PROBE]', JSON.stringify({ cur: S.STATE.currentAccountId, accs: S.STATE.accounts.map(a=>a.id), keys: _ls.size }));
// ---- v0.0.5：物品栏 ----
step('物品栏：标题为「物品栏」，且不显示「+0.0」', () => {
  const b = tabBtns().find((x) => x.textContent === '物品栏');
  if (!b) throw new Error('未找到物品栏 tab');
  b.dispatch('click');
  const t = allText();
  if (!t.includes('物品栏')) throw new Error('物品栏标题缺失');
  if (t.includes('玩家拥有的')) throw new Error('「玩家拥有的」应已改名为「物品栏」');
  if (!t.includes('星球储藏')) throw new Error('应保留「星球储藏」一栏');
  const zeroRates = allEls().filter((e) => e.className.split(/\s+/).includes('inv-rate') && e.textContent === '+0.0');
  console.log('     显示 +0.0 的增速标签:', zeroRates.length, '(应为 0)');
  if (zeroRates.length) throw new Error('增速为 0 时不应显示「+0.0」');
  // 星球储藏应显示剩余储量
  if (!/剩余|尚余|储量/.test(t)) throw new Error('星球储藏应显示剩余储量');
});

// ---- 科研 → 科技 ----
step('切回「科研」→ 科技，点开第一个科技卡', () => {
  const b = tabBtns().find((x) => x.textContent === '科研');
  if (!b) throw new Error('未找到科研 tab');
  b.dispatch('click');
  console.log('     科研子标签:', navBtns().map((x) => x.textContent).join(' | ') || '(无)');
  const cards = byClass('res-card');
  if (!cards.length) throw new Error('科研面板没有渲染出科技卡');
  console.log('     科技卡数量:', cards.length, '(应为科技区节点数 20 = 26 − 6 个舰船节点，舰船节点已挪到「设施」分区)');
  cards[0].dispatch('click');
});

// ---- 科研 → 升级 ----
step('科研 → 升级，点开第一个升级卡', () => {
  closeModals();
  clickNav('升级');
  const upgs = byClass('res-upg');
  if (upgs.length !== 6) throw new Error(`升级卡应为 6 张，实际 ${upgs.length}`);
  console.log('     升级卡数量:', upgs.length);
  upgs[0].dispatch('click');
});

// ---- 科研 → 设施 ----
step('科研 → 设施，点开第一个设施详情', () => {
  closeModals();
  clickNav('设施');
  const rows = byClass('fac-row');
  if (!rows.length) throw new Error('设施目录没有渲染出行');
  console.log('     设施条目数:', rows.length, '(应为 12：4 类 × 3 型号)');
  rows[0].dispatch('click');
});

// ---- 舰队：未建船坞时应给出门槛提示而不是崩溃 ----
step('舰队（未建船坞）应显示门槛提示', () => {
  closeModals();
  const b = tabBtns().find((x) => x.textContent === '舰队');
  b.dispatch('click');
  const txt = allText();
  if (!txt.includes('船坞尚未建成')) throw new Error('未显示船坞门槛提示');
});

// ---- 舰队：造一艘船 ----
// 内联小工具：查询船坞是否可就绪（避免在 step 里直接依赖导出名）
const SY_dockReady = (inst, acc) => {
  try {
    const mod = S.__shipyardUi || null;
    return { dock: (inst.buildings && inst.buildings.dock) || 0, workers: POP.getJobCount(inst.pop, 'dock_worker') };
  } catch (e) { return { err: e.message }; }
};

console.log('[PROBE]', JSON.stringify({ cur: S.STATE.currentAccountId, accs: S.STATE.accounts.map(a=>a.id), keys: _ls.size }));
step('解锁船坞科技并建造船坞后，蓝图编辑器应可用', () => {
  const acc = S.currentAccount();
  // v0.0.61：舰船部件的门槛只剩船坞一个（原来的四条支线节点已删除）
  acc.tech = ['t_e3'];
  // v0.0.5：建筑计数在星球实例上（不再是账号的 buildings 数组）
  const inst = S.getPlanetInstance('syl');
  inst.buildings = inst.buildings || {};
  inst.buildings.dock = 1;
  // v0.0.5：船坞里必须有人当船坞工，否则不允许造船
  POP.assignWorkers(inst.pop, 'dock_worker', 8, inst.buildings);
  console.log('     船坞工在岗:', Y.dockWorkerCount ? 'n/a' : 'n/a', '| 就绪:',
    JSON.stringify(SY_dockReady(inst, acc)));
  const b = tabBtns().find((x) => x.textContent === '舰队');
  b.dispatch('click');
  const box = byClass('bp-box')[0];
  if (!box) throw new Error('蓝图编辑器未渲染');
  const sels = allEls().filter((e) => e.tagName === 'SELECT');
  if (sels.length < 3) throw new Error(`蓝图编辑器控件过少：select ${sels.length}`);
  console.log('     蓝图控件：select', sels.length, '· 建造按钮',
    allEls().filter((e) => e.tagName === 'BUTTON' && e.textContent === '建造').length);
});

step('点击「建造」应下水一艘船（默认名 No.1）', () => {
  const buildBtn = allEls().find((e) => e.tagName === 'BUTTON' && e.textContent === '建造');
  if (!buildBtn) throw new Error('未找到建造按钮');
  if (buildBtn.disabled) throw new Error('建造按钮被禁用（默认蓝图本应合法）');
  const accDbg = S.currentAccount();
  const evDbg = Y.evaluateBlueprint(accDbg.blueprint, { researched: new Set(accDbg.tech), ships: [] });
  console.log('     蓝图校验:', evDbg.ok ? '通过' : ('失败 -> ' + evDbg.errors.join('；')));
  buildBtn.dispatch('click');
  closeModals();
  const acc = S.currentAccount();
  if (acc.ships.length !== 1) throw new Error(`应有 1 艘船，实际 ${acc.ships.length}`);
  console.log('     舰船名:', acc.ships[0].name, '| 类型:', acc.ships[0].className,
    '| 强度:', acc.ships[0].strength, '| 温度:', Math.round(acc.ships[0].state.TempK), 'K');
  if (!/No\.1$/.test(acc.ships[0].name)) throw new Error('默认名不是 No.1：' + acc.ships[0].name);
});

step('点开飞船详情并推演 60 秒', () => {
  const view = allEls().find((e) => e.tagName === 'BUTTON' && e.textContent === '查看');
  if (!view) throw new Error('未找到「查看」按钮');
  view.dispatch('click');
  const cards = walkAll(byId['modal-root']).filter((e) => e.className.split(/\s+/).includes('sp-card'));
  if (cards.length !== 4) throw new Error(`详情应有 4 张能量卡（温度/内能/动能/势能），实际 ${cards.length}`);
  console.log('     能量卡:', cards.map((c) => c.textContent.replace(/\s+/g, ' ').trim().slice(0, 18)).join(' | '));
  const tickBtn = walkAll(byId['modal-root']).find((e) => e.tagName === 'BUTTON' && e.textContent.includes('推演'));
  if (!tickBtn) throw new Error('未找到推演按钮');
  tickBtn.dispatch('click');
  const nameInput = walkAll(byId['modal-root']).find((e) => e.tagName === 'INPUT' && e.className.includes('bp-input-wide'));
  if (!nameInput) throw new Error('未找到改名输入框');
  nameInput.value = '远征号';
  const renameBtn = walkAll(byId['modal-root']).find((e) => e.tagName === 'BUTTON' && e.textContent === '改名');
  renameBtn.dispatch('click');
  closeModals();
});

step('飞船应进入心跳 tick（温度有限、非 NaN）', () => {
  for (let i = 0; i < 30; i++) S.tick(1);
  const ship = S.currentAccount().ships[0];
  if (!Number.isFinite(ship.state.TempK)) throw new Error('飞船温度不是有限数');
  if (ship.state.TempK < 3 || ship.state.TempK > 5000) throw new Error('飞船温度越界：' + ship.state.TempK);
  console.log('     30 秒后温度:', ship.state.TempK.toFixed(1), 'K · 船员:', Math.round(ship.state.crew),
    '· 温度状态:', Y.tempStatus(ship.state.TempK, ship.stats.tempBandBonus).label);
});

step('切回「物品栏」', () => {
  const b = tabBtns().find((x) => x.textContent === '物品栏');
  b.dispatch('click');
});

step('切回主界面再进星球（验证返回导航）', () => {
  const back = tabBtns().find((x) => x.textContent.includes('返回'));
  if (!back) throw new Error('未找到返回主界面按钮');
  back.dispatch('click');
  const off = findButton('离线');
  if (!off) throw new Error('返回后没有离线模式按钮');
  off.dispatch('click');
});

// 存档往返
step('存档落盘并重载', async () => {
  const S = await import('../js/core/state.js?v=30.1');
  S.saveState();
  const before = _ls.size;
  const raw = _ls.get('astrix.save.' + S.STATE.currentAccountId);
  if (!raw) throw new Error('账号未落盘');
  const pl = _ls.get('astrix.save.planets.' + S.STATE.currentAccountId);
  if (!pl) throw new Error('星球实例未落盘');
  console.log('     localStorage 键数:', before, '| 星球存档字节:', pl.length);
});

await Promise.all(pending);

// =====================================================================
// v0.0.6 新增 UI 验证（追加 section，置于 == 结果 == 汇总之前）
// 验证：电力面板渲染 / 造出船坞后「星球选择」tab / 星球选择含 7 星 nameCn
// （本段只读取已有作用域：tabBtns / allText / step / PLANETS，不改动其它步骤）
// =====================================================================
const PL = await import('../js/data/planets.js?v=30.1');

// ⚠ 这段追加在「存档落盘并重载」之后，而它前面那一步是「返回主界面 → 点离线模式」。
//   v0.0.6（需求 R6）之后，点「离线模式」**总是先弹存档选择界面**（不再直接进游戏），
//   所以此刻界面上根本没有星球 tab——必须先重新进一次星球，否则下面全部报「未找到该 tab」。
step('v0.0.6 前置：重新进入星球界面', () => {
  closeModals();
  const off = findButton('离线');
  if (!off) throw new Error('开始界面没有「离线模式」按钮');
  off.dispatch('click');
  const enter = walkAll(byId['modal-root'])
    .filter((e) => e.tagName === 'BUTTON')
    .find((b) => b.textContent.includes('进入') || b.textContent.includes('新建存档'));
  if (!enter) throw new Error('存档选择界面没有「进入」或「新建存档」按钮');
  enter.dispatch('click');
  if (!tabBtns().length) throw new Error('重新进入后仍没有渲染出星球 tab');
  console.log('     已重新进入星球，tab:', tabBtns().map((x) => x.textContent).join(' | '));
});

// ⚠ step() 遇到 async 函数会把 Promise 塞进 pending 然后**继续往下跑**，
//   后续同步步骤会抢在 await 之前执行，报出顺序颠倒的假错误。
//   所以这里一律拆成「同步 step + 顶层 await 夹在中间」（项目既定规矩）。
step('v0.0.6 电力面板：切到「电力」tab', () => {
  const b = tabBtns().find((x) => x.textContent === '电力');
  if (!b) throw new Error('未找到「电力」tab');
  b.dispatch('click');
});
await new Promise((r) => setTimeout(r, 300));   // 顶层 await：等电力面板的异步动态 import 完成

step('v0.0.6 电力面板：真实渲染（非「加载失败」占位）', () => {
  const txt = allText();
  if (/加载失败|load\s*fail/i.test(txt)) throw new Error('电力面板显示「加载失败」占位');
  const miss = ['发电', '耗电', '储'].filter((k) => !txt.includes(k));
  if (miss.length) throw new Error('电力面板文本缺少关键字：' + miss.join('、'));
  console.log('     电力面板关键字存在：发电 / 耗电 / 储');
});

step('v0.0.6 星球选择：造出船坞后底部菜单出现「星球选择」tab', () => {
  if (!tabBtns().find((x) => x.textContent === '星球选择')) {
    throw new Error('已造船坞却未出现「星球选择」tab（需求 R13：造出船坞后才出现）');
  }
  console.log('     「星球选择」tab 已出现（R13 达成）');
});

step('v0.0.6 星球选择：切到「星球选择」tab', () => {
  const b = tabBtns().find((x) => x.textContent === '星球选择');
  if (!b) throw new Error('未找到「星球选择」tab');
  b.dispatch('click');
});
await new Promise((r) => setTimeout(r, 300));   // 顶层 await：等殖民地面板的异步动态 import 完成

step('v0.0.6 星球选择：进入不崩溃且含全部 7 个星球 nameCn', () => {
  const txt = allText();
  if (/加载失败|load\s*fail/i.test(txt)) throw new Error('星球选择面板显示「加载失败」占位');
  const names = PL.PLANETS.map((p) => p.nameCn);
  const miss = names.filter((n) => !txt.includes(n));
  if (miss.length) throw new Error('星球选择缺少星球名：' + miss.join('、'));
  console.log('     星球选择含全部', names.length, '个星球：', names.join(' '));
});

console.log('\n== 结果 ==');
console.log('运行时异常数:', errors.length);
errors.forEach((e) => console.log('  x ' + e));
console.log(errors.length === 0 ? '全部通过' : '存在异常');

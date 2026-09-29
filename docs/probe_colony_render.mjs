// Astrix v0.1.1 殖民面板（ui/colony.js）渲染自测（node 直接跑，最小 DOM 桩）
//   node docs/probe_colony_render.mjs
// 覆盖：发现门禁（未发现不可见）/ 商店星徽标与无殖民按钮 / 殖民按钮流程 /
//       托管管理模式说明 / 老存档商店星残留清理 / 概览计数
// DOM 桩做法与 docs/selfcheck_render.mjs 保持一致（最小 El 桩）。

class ClassList {
  constructor(el) { this.el = el; this.set = new Set(); }
  add(...c) { c.forEach((x) => this.set.add(x)); this._sync(); }
  remove(...c) { c.forEach((x) => this.set.delete(x)); this._sync(); }
  contains(c) { return this.set.has(c); }
  toggle(c, force) { const want = force === undefined ? !this.set.has(c) : !!force; if (want) this.set.add(c); else this.set.delete(c); this._sync(); }
  _sync() { this.el._class = [...this.set].join(' '); }
}
class El {
  constructor(tag) {
    this.tagName = String(tag).toUpperCase();
    this.children = []; this.parentNode = null;
    this.attrs = {}; this.style = {}; this.dataset = {};
    this._text = ''; this._html = ''; this._class = ''; this._listeners = {};
    this.classList = new ClassList(this);
  }
  get className() { return this._class; }
  set className(v) { this._class = String(v); this.classList.set = new Set(this._class.split(/\s+/).filter(Boolean)); }
  get textContent() { if (this._text) return this._text; return this.children.map((c) => c.textContent).join(''); }
  set textContent(v) { this._text = String(v); this.children = []; this._html = ''; }
  get innerHTML() { return this._html; }
  set innerHTML(v) { this._html = String(v); this.children = []; this._text = ''; }
  setAttribute(k, v) { this.attrs[k] = String(v); if (k === 'class') this.className = v; }
  getAttribute(k) { return this.attrs[k] ?? null; }
  appendChild(c) { if (!c) return c; c.parentNode = this; this.children.push(c); return c; }
  append(...cs) { cs.forEach((c) => this.appendChild(c)); }
  remove() { if (this.parentNode) { const i = this.parentNode.children.indexOf(this); if (i >= 0) this.parentNode.children.splice(i, 1); this.parentNode = null; } }
  addEventListener(type, fn) { (this._listeners[type] ||= []).push(fn); }
  removeEventListener(type, fn) { const l = this._listeners[type] || []; const i = l.indexOf(fn); if (i >= 0) l.splice(i, 1); }
  dispatch(type, ev = {}) { const h = this['on' + type]; if (typeof h === 'function') h({ target: this, ...ev }); for (const fn of (this._listeners[type] || [])) fn({ target: this, ...ev }); }
  querySelectorAll(sel) { return walkAll(this).filter((e) => matchSel(e, sel)); }
  querySelector(sel) { return this.querySelectorAll(sel)[0] || null; }
  contains(node) { if (!node) return false; for (const c of walkAll(this)) if (c === node) return true; return false; }
}
function matchSel(e, sel) { if (sel.startsWith('.')) return e.classList.contains(sel.slice(1)); return e.tagName === sel.toUpperCase(); }
function walkAll(node, out = []) { for (const c of node.children) { out.push(c); walkAll(c, out); } return out; }

const byId = { app: new El('div'), 'modal-root': new El('div') };
globalThis.document = {
  createElement: (t) => new El(t),
  createTextNode: (t) => { const e = new El('#text'); e.textContent = t; return e; },
  createDocumentFragment: () => new El('#fragment'),
  getElementById: (id) => byId[id] || null,
  addEventListener: () => {}, removeEventListener: () => {},
  activeElement: null, body: new El('body'),
};
globalThis.window = { addEventListener: () => {}, removeEventListener: () => {}, alert: () => {} };
globalThis.requestAnimationFrame = (fn) => { fn(); return 1; };
globalThis.setInterval = () => 1;
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

let pass = 0;
const fails = [];
function ok(cond, label) { if (cond) { pass++; } else { fails.push(label); console.log('  ✗ ' + label); } }
function section(t) { console.log('\n== ' + t + ' =='); }

const STATE_M = await import('../js/core/state.js?v=21.3');
const PG = await import('../js/core/planetgen.js?v=21.3');
const COL = await import('../js/ui/colony.js?v=21.3');
const PL = (await import('../js/data/planets.js?v=21.3')).PLANETS;

const STATE = STATE_M.STATE;
function textOf(root) { return walkAll(root).map((e) => e.textContent).join(' '); }
function buttonsOf(root) { return walkAll(root).filter((e) => e.tagName === 'BUTTON'); }

// 建一个离线账号（母星 syl）
const acc = STATE_M.createAccount('w2probe', 'offline');
STATE_M.switchAccount(acc.id);
ok(acc.homePlanetCode === 'syl', `母星应为 syl，实际 ${acc.homePlanetCode}`);
STATE_M.getPlanetInstance(acc.homePlanetCode);   // 真实游戏启动即建母星实例（主界面进入星球时发生）

const root = new El('div');
const modalBox = { last: null };
const ctx = {
  openModal: (m) => { modalBox.last = m; },
  closeModal: () => { modalBox.last = null; },
  onEnterPlanet: () => {},
};

// ---------------------------------------------------------------------------
section('一、发现门禁：初始只显示母星 + 商店星入口');
COL.renderColony(root, ctx);
let txt = textOf(root);
ok(txt.includes('希尔瓦'), '母星希尔瓦应可见');
ok(txt.includes('公共商店星 · 所有旅行者共用'), '商店星应带公共徽标');
// 注意：用按钮元素判断而非全文子串（行与行文本直接拼接会拼出「进入商店」假阳性）
ok(!buttonsOf(root).some((b) => b.textContent === '进入商店'), '没造船坞时商店星不应有进入按钮（提示文案代替）');
const others = PL.slice(1).map((p) => p.nameCn).filter((n) => txt.includes(n));
ok(others.length === 0, `未发现的星球不应可见，实际泄露：${others.join('、')}`);
ok(buttonsOf(root).some((b) => b.textContent === '殖民') === false, '未发现星球不可见 → 不应有任何殖民按钮');

// ---------------------------------------------------------------------------
section('二、发现后出现殖民按钮，走完殖民流程');
const r = PG.discoverPlanet(acc, 'des');
ok(r.ok === true, `discoverPlanet('des') 应成功，实际 ${JSON.stringify(r).slice(0, 60)}`);
root.innerHTML = '';
COL.renderColony(root, ctx);
txt = textOf(root);
ok(txt.includes('德索罗'), '已发现的德索罗应可见');
ok(txt.includes('卡利多') === false, '仍未发现的卡利多不可见');
const colBtn = buttonsOf(root).find((b) => b.textContent === '殖民' && b.getAttribute('data-code') === 'des');
ok(!!colBtn, '已发现未殖民的星球应有「殖民」按钮');
colBtn.dispatch('click');
ok(modalBox.last && modalBox.last.title.includes('德索罗'), '点殖民应弹确认模态');
const okBtn = walkAll(modalBox.last.body).filter((e) => e.tagName === 'BUTTON').find((b) => b.textContent === '确认殖民');
ok(!!okBtn, '确认模态应有「确认殖民」按钮');
ok(STATE.planets.some((p) => p.code === 'des') === false, '确认前不应已建实例（不误殖民）');
okBtn.dispatch('click');
ok(Array.isArray(acc.capturedPlanets) && acc.capturedPlanets.some((c) => c.code === 'des'), '确认后应登记进 capturedPlanets');
ok(STATE.planets.some((p) => p.code === 'des'), '确认后应建立星球实例');
root.innerHTML = '';
COL.renderColony(root, ctx);
txt = textOf(root);
ok(txt.includes('已殖民 · des1'), '殖民后应显示 planetId des1');
ok(buttonsOf(root).some((b) => b.getAttribute('data-code') === undefined && b.textContent === '进入') === true || buttonsOf(root).some((b) => b.textContent === '进入'), '殖民后应有「进入」按钮');
ok(txt.includes('管理模式 殖民 · 由电脑接管发展 · 贡品比例 30%'), '托管星球应显示管理模式与贡品比例');

// ---------------------------------------------------------------------------
section('三、商店星老存档残留清理');
// 伪造老存档：ast1 被误占（capturedPlanets + STATE.planets 实例）
acc.capturedPlanets.push({ code: 'ast1', nameCn: '商店星', type: '商业空间站', isShop: true, planet: { code: 'ast1', isShop: true, nameCn: '商店星' } });
STATE.planets.push({ code: 'ast1', isShop: true, planetId: 'ast11', population: { total: 5, available: 5 }, happiness: 1 });
root.innerHTML = '';
COL.renderColony(root, ctx);
txt = textOf(root);
ok(!acc.capturedPlanets.some((c) => c.code === 'ast1'), 'render 应清理掉误占的 ast1（capturedPlanets）');
ok(!STATE.planets.some((p) => p.code === 'ast1'), 'render 应清理掉 STATE.planets 里的 ast1 实例');
ok(txt.includes('公共商店星 · 所有旅行者共用'), '商店星入口仍应以公共徽标展示');
const shopRow = root.querySelectorAll('.shop-row')[0];
ok(!!shopRow, '商店星应有独立行');
ok(!buttonsOf(shopRow).some((b) => b.textContent === '殖民'), '商店星绝不能有殖民按钮');

// ---------------------------------------------------------------------------
section('四、概览计数不含商店星');
const ovText = textOf(root.querySelector('.col-overview'));
ok(/已殖民 \/ 已发现/.test(ovText), '概览应含「已殖民 / 已发现」项');
ok(!/\b5\b/.test(ovText.replace(/希尔瓦/g, '')), '概览人口不应包含被清掉的 ast1 人数');

console.log(`\n通过 ${pass} 项，失败 ${fails.length} 项`);
if (fails.length) { console.log(fails.map((f) => '  ✗ ' + f).join('\n')); process.exit(1); }

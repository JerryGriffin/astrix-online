// docs/_probe_hoi_war_ui.mjs —— v0.3.3「hoi.js 战争下拉栏 + 双方实时状态」渲染实测
//
// 不依赖 playwright（用极简 DOM 桩），直接调用 renderHoi 并检查产出结构。
// 关键验证点：
//   1. 无战争时给出「下一个历史节点」提示（而非空白）
//   2. 有战争时存在下拉栏，且 option 覆盖全部进行中战争
//   3. 敌国名走 HOI_BY_ID 反查（不显示首都「柏林」而显示国名「德意志国」）
//   4. 双方状态用真实 army/fleet 数据，且明确标注敌方为 1936 基准
//   5. 下拉栏 change 事件能局部重绘（不需要整页刷新）
// ⚠️ import 顺序很关键：js/ui/hoi.js 顶层会 document.createElement('style') 注入 CSS，
//    因此 **必须先建好 document 桩再 import**。静态 import 会被提升到文件顶部、
//    早于 document 赋值，导致 renderHoi 走错分支。故这里用动态 import。
// ⚠️ 必须带 ?v=32.1 —— 与被测模块（hoi.js）引用的是**同一份** state.js 实例。
//    不带版本号会加载出第二个模块实例，STATE 不是同一个对象，renderHoi 读到的
//    currentAccount() 会是 null，从而误走「非 1936 存档」分支（本探针踩过两次）。
import { STATE } from '../js/core/state.js?v=48.1';
import { HOI_BY_ID } from '../js/data/hoi1936.js?v=48.1';

// ---- 极简 DOM 桩：记录元素树，支持 textContent/innerHTML/appendChild ----
function mkEl(tag) {
  const e = {
    tagName: String(tag).toUpperCase(), children: [], attrs: {}, _text: '', _html: '',
    style: { cssText: '' }, className: '', value: '', _listeners: {},
    set class(v) { this.className = v; this.attrs.class = v; },
    get class() { return this.className; },
    set textContent(v) { this._text = String(v); this.children = []; },
    get textContent() {
      if (this._text) return this._text;
      // 无显式文本时按子节点聚合（renderHoi 大量使用 appendChild 拼装）
      return (this.children || []).map((c) => (c.nodeType === 3 ? c.textContent : (c.textContent || ''))).join('');
    },
    set innerHTML(v) { this._html = String(v); this.children = []; },
    get innerHTML() { return this._html; },
    // ⚠️ 必须同步 className —— ui/hoi.js 的 el() 走 setAttribute('class', ...)，
    //    若不同步，按 class 查找元素的探针会全部找不到（本探针踩过）。
    setAttribute(k, v) { this.attrs[k] = v; if (k === 'class') this.className = v; },
    getAttribute(k) { return this.attrs[k] == null ? null : this.attrs[k]; },
    appendChild(c) { this.children.push(c); return c; },
    append(...cs) { for (const c of cs) if (c) this.children.push(c); },
    removeChild(c) { const i = this.children.indexOf(c); if (i >= 0) this.children.splice(i, 1); return c; },
    addEventListener(ev, fn) { (this._listeners[ev] = this._listeners[ev] || []).push(fn); },
    removeEventListener() {},
    querySelector() { return null; },
    querySelectorAll() { return []; },
    get lastChild() { return this.children[this.children.length - 1]; },
  };
  return e;
}
globalThis.document = { createElement: mkEl, createTextNode: (t) => ({ nodeType: 3, textContent: String(t) }) };
globalThis.alert = () => {};

// document 桩就绪后再动态 import 被测模块
const { renderHoi } = await import('../js/ui/hoi.js?v=48.1');

// ---- 遍历工具 ----
function walk(node, out = []) {
  if (!node) return out;
  if (node.nodeType === 3) { out.push({ text: node.textContent }); return out; }
  out.push(node);
  for (const c of (node.children || [])) walk(c, out);
  return out;
}
function allText(root) {
  return walk(root).map((n) => (n.text || n.textContent || '')).join(' | ');
}
function findAll(root, pred, out = []) {
  for (const n of walk(root)) {
    if (n.tagName && pred(n)) out.push(n);
  }
  return out;
}
function findByClass(root, cls) {
  return findAll(root, (n) => String(n.className || '').split(/\s+/).indexOf(cls) >= 0);
}
function findByTag(root, tag) {
  const t = tag.toUpperCase();
  return findAll(root, (n) => n.tagName === t);
}

let pass = 0, fail = 0;
const check = (n, c, d) => { if (c) { pass++; console.log('  ✓ ' + n + (d ? '  ' + d : '')); } else { fail++; console.log('  ✗ ' + n + (d ? '  ' + d : '')); } };

function mkAcc(nation, wars, opts = {}) {
  const a = {
    id: 'acc_' + nation, scenario: 'hoi1936', nation,
    scenarioStartedAt: Date.now() - (opts.day || 10) * 1000,
    wars: wars || [], warLog: [], npcAllies: [],
    hoiDiploDays: 0, hoiHistFired: {},
    tech: [], focus: null, seas: null,
    armies: opts.armies || [], fleets: opts.fleets || [], ships: [],
    homePlanetCode: 'syl', stats: {}, lines: [],
  };
  STATE.accounts = [a];
  STATE.currentAccountId = a.id;
  // getPlanetInstance 会规范化 inst 字段，探针必须给足最小可用实例，否则渲染抛错
  STATE.planets = [{
    code: 'syl', planetId: 'syl1', isHome: true, management: 'territory', independence: 0,
    buildings: { dock: 1 }, buildQueue: [], lines: [],
    pop: { total: opts.pop == null ? 12345 : opts.pop, happiness: 1, assignments: {} },
    inventory: [], equipment: {}, shipProgress: {}, armyProgress: {},
    hoiIndustry: { ic: opts.ic == null ? 42 : opts.ic, buildings: 9 },
  }];
  return a;
}
function render(acc) {
  const root = mkEl('div');
  renderHoi(root, { account: acc });
  return root;
}

// ---------------------------------------------------------------------------
console.log('\n===== 一、无战争：给出下一个历史节点提示 =====');
{
  const acc = mkAcc('ger', [], { day: 100 });
  const root = render(acc);
  const txt = allText(root);
  check('渲染不抛错且有内容', txt.length > 100, txt.length + ' 字');
  check('含「战争」区块', txt.indexOf('进行中 0 场') >= 0, '进行中 0 场');
  check('提示下一个历史节点', /下一个与本国有交战的节点/.test(txt),
    (txt.match(/下一个与本国有交战的节点[^|]*/) || [''])[0].slice(0, 60));
  check('提示含节点名与倒计时', /德国入侵波兰/.test(txt) && /游戏天/.test(txt),
    (txt.match(/【[^】]+】[^|]*/) || [''])[0]);
  check('点名慕尼黑/德奥合并等节点', /德奥合并|慕尼黑|轴心/.test(txt));
  // 1936-01 附近轴心节点(day 274)应在提示中
  const chips = findByClass(root, 'hoi-war-chip');
  check('列出历史节点筹码', chips.length > 0, chips.length + ' 个');
}

// ---------------------------------------------------------------------------
console.log('\n===== 二、有战争：下拉栏 + 双方实时状态 =====');
{
  const acc = mkAcc('ger', [
    { id: 'w1', kind: 'npc', targetId: 'hoi_sov', targetName: '莫斯科',   // 故意存首都
      startedAt: Date.now() - 5 * 86400000, myScore: 24, theirScore: 16,
      battles: 4, status: 'active', treaty: null, progress: 42, histKey: '1999:sov',
      log: [{ at: Date.now(), text: '巴巴罗萨行动推进顺利' }] },
    { id: 'w2', kind: 'npc', targetId: 'hoi_eng', targetName: '伦敦',
      startedAt: Date.now() - 2 * 86400000, myScore: 8, theirScore: 32,
      battles: 2, status: 'active', treaty: null, progress: 15, histKey: '1341:eng',
      log: [] },
  ], {
    day: 2000,
    armies: [{ id: 'a1', power: 1200, men: 500, stats: { atk: 10, def: 8 } },
             { id: 'a2', power: 800, men: 500, stats: { atk: 8, def: 6 } }],
    fleets: [{ id: 'f1', nameCn: '公海舰队', shipIds: ['s1', 's2', 's3'] }],
  });


  const root = render(acc);
  const txt = allText(root);

  // 下拉栏
  const sels = findByTag(root, 'SELECT').filter((s) => String(s.className || '').indexOf('hoi-war-sel') >= 0);
  check('存在战争下拉栏', sels.length === 1, sels.length + ' 个');
  const opts = findByTag(sels[0], 'OPTION');
  check('下拉栏含 2 个战争', opts.length === 2, opts.length + ' 项');
  check('option 文本含双方国名', /德意志国 vs 苏维埃联盟/.test(opts[0].textContent), opts[0].textContent);
  check('option 带历史事件名', /巴巴罗萨/.test(opts[0].textContent), opts[0].textContent);

  // —— 关键：敌国名必须反查，不能显示首都 ——
  check('敌国显示国名而非首都', txt.indexOf('苏维埃联盟') >= 0 && txt.indexOf('对手是莫斯科') < 0);
  check('英国也按国名显示（HOI_BY_ID.nameCn）', opts[1].textContent.indexOf('不列颠') >= 0, opts[1].textContent);

  // 双方状态
  const sides = findByClass(root, 'hoi-war-side');
  check('并排显示双方状态（2 个面板）', sides.length === 2, sides.length + ' 个');
  const s0 = allText(sides[0]), s1 = allText(sides[1]);
  check('我方面板含真实军队数', /2 支/.test(s0), '陆军行: ' + (s0.match(/陆军[^|]*/) || [''])[0]);
  check('我方面板含真实舰队艘数', /3 艘/.test(s0), '舰队行: ' + (s0.match(/舰队[^|]*/) || [''])[0]);
  check('我方面板含真实战力（fmtNum 压缩显示）', /战力\s*2(\.0)?k|战力\s*2000/.test(s0), 'ArmyPower=1200+800=2000 → fmtNum');
  check('我方面板含真实人口（12345 → fmtNum）', /12\.3k|12,345|12345/.test(s0), 'pop=12345');
  check('敌方面板标注 1936 基准', /1936 基准/.test(s1));
  check('敌方显示师数', /92 个师/.test(s1), (s1.match(/\d+ 个师/) || [''])[0]);
  check('敌方分数可见', /战争分数/.test(s0) && /战争分数/.test(s1));

  // 推进条与战报
  check('显示战场推进百分比', /战场推进 42%/.test(txt), (txt.match(/战场推进 \d+%/) || [''])[0]);
  check('显示最近战报', /巴巴罗萨行动推进顺利/.test(txt));

  // change 事件局部重绘
  const ls = sels[0]._listeners.change || [];
  check('下拉栏绑定 change 事件', ls.length === 1);
  let threw = null;
  try { for (const fn of ls) fn({}); } catch (e) { threw = e; }
  check('切换战争不抛错（局部重绘）', !threw, threw ? threw.message : '');
}

// ---------------------------------------------------------------------------
console.log('\n===== 三、多个战争切换后仍显示正确双方 =====');
{
  const acc = mkAcc('ger', [
    { id: 'w1', kind: 'npc', targetId: 'hoi_jap', targetName: '东京', startedAt: Date.now(),
      myScore: 10, theirScore: 10, battles: 1, status: 'active', treaty: null, progress: 0, log: [] },
    { id: 'w2', kind: 'npc', targetId: 'hoi_usa', targetName: '华盛顿', startedAt: Date.now(),
      myScore: 0, theirScore: 50, battles: 3, status: 'active', treaty: null, progress: 8, log: [] },
  ], { day: 2200, armies: [], fleets: [] });
  const root = render(acc);
  const sels = findByTag(root, 'SELECT').filter((s) => String(s.className || '').indexOf('hoi-war-sel') >= 0);
  const sel = sels[0];
  const ls = sel._listeners.change || [];
  // 切到第二场（美国）
  sel.value = 'w2';
  let threw = null;
  try { for (const fn of ls) fn({}); } catch (e) { threw = e; }
  const txt = allText(root);
  check('切到美国战争不抛错', !threw, threw ? threw.message : '');
  check('切换后显示美国（数据表国名「美利坚」）', /美利坚/.test(txt), (txt.match(/德意志国 vs [^（]*/) || [''])[0]);
  check('双方面板仍为 2 个', findByClass(root, 'hoi-war-side').length === 2);
}

// ---------------------------------------------------------------------------
console.log('\n===== 四、非 1936 存档的守卫不受影响 =====');
{
  const a = { id: 'plain', scenario: 'classic', wars: [] };
  STATE.accounts = [a]; STATE.currentAccountId = 'plain';
  const root = mkEl('div');
  let threw = null;
  try { renderHoi(root, { account: a }); } catch (e) { threw = e; }
  const txt = allText(root);
  check('非 1936 存档不抛错', !threw, threw ? threw.message : '');
  check('提示仅 1936 可用', /仅 1936 剧本/.test(txt), txt.slice(0, 40));
}

console.log('\n===== 汇总 =====');
console.log('  通过 ' + pass + ' / 失败 ' + fail);
if (fail === 0) console.log('  全部通过 ✅');
process.exit(fail === 0 ? 0 : 1);

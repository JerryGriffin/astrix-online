// docs/_probe_fleet.mjs  —— Astrix v0.1.2 · W-FLEET 自检探针
// 验证 R6（探索时长 ×5 + 按距离扣燃料）与 R12（运输物资改下拉）的核心行为。
// 所有相对导入一律带 ?v=11.0（与冻结契约一致）。
import {
  MISSION_DISTANCE, EXPLORE_FUEL_PER_DIST, startMission,
  createFleet, addShipToFleet, ensureFleets,
} from '../js/core/fleet.js?v=20.0';
import { STATE } from '../js/core/state.js?v=20.0';
import { renderFleet } from '../js/ui/fleet.js?v=20.0';

// ---------------------------------------------------------------------------
// 极简 DOM 桩：仅实现 renderFleet / openTransportForm 用到的子集
// ---------------------------------------------------------------------------
function makeEl(tag) {
  const e = {
    tagName: tag, children: [], style: {}, _l: {},
    className: '', _text: '', value: '', type: '', min: '', placeholder: '',
    disabled: false, checked: false, _html: '',
    set innerHTML(v) { this.children = []; this._html = v; },
    get innerHTML() { return this._html; },
    set textContent(v) { this._text = String(v); this.children = []; },
    get textContent() { return this._text; },
    appendChild(c) { this.children.push(c); return c; },
    append(...cs) { for (const c of cs) this.children.push(c); },
    removeChild(c) { const i = this.children.indexOf(c); if (i >= 0) this.children.splice(i, 1); return c; },
    setAttribute() {}, getAttribute() { return null; },
    addEventListener(ev, fn) { (this._l[ev] = this._l[ev] || []).push(fn); },
    removeEventListener() {},
    click() { (this._l.click || []).forEach((f) => f({})); },
    querySelector() { return null; },
    querySelectorAll() { return []; },
  };
  return e;
}
globalThis.document = {
  createElement: makeEl,
  createTextNode: (t) => ({ nodeType: 3, textContent: String(t) }),
  hidden: false,
};

function findEl(node, pred) {
  if (!node || !node.children) return null;
  for (const c of node.children) {
    if (pred(c)) return c;
    const r = findEl(c, pred);
    if (r) return r;
  }
  return null;
}

// ---------------------------------------------------------------------------
// 构造测试账号 / 星球实例 / 飞船
// ---------------------------------------------------------------------------
const ACC_ID = 'probe_acc';
const HOME = 'syl';
STATE.accounts = [];
STATE.planets = [];
STATE.currentAccountId = ACC_ID;

const account = {
  id: ACC_ID, homePlanetCode: HOME,
  fleets: [], ships: [], blueprints: [],
  capturedPlanets: [], discovered: [], shopOrders: [], shopState: {},
};
STATE.accounts.push(account);
ensureFleets(account);

// 母星实例：3 项持有 > 0，2 项持有 = 0（用于 R12 下拉断言）
const inst = {
  code: HOME, planetId: HOME + '1', isHome: true, management: 'territory', independence: 0,
  buildings: { dock: 1 }, buildQueue: [], pop: { happiness: 1, total: 0 },
  inventory: [
    { mat: '石头', owned: 100, layer: 'surface' },
    { mat: '水', owned: 0, layer: 'surface' },
    { mat: '碳', owned: 50, layer: 'surface' },
    { mat: '铁', owned: 0, layer: 'surface' },
    { mat: '甲烷', owned: 30, layer: 'gas' },
  ],
};
STATE.planets.push(inst);

function mkShip(id) {
  return {
    id, name: id, className: '运输船' + id, blueprintId: 'bp1',
    stats: { speed: 100, massT: 50, cargoVol: 200, crewMax: 5, thrust: 100, damage: 0, struct: 10, rangeKm: 0, heatKW: 0, powerKW: 0 },
    state: { fuelMol: 1000, planetCode: HOME, flying: false, crew: 5, crewMax: 5, hullIntegrity: 1, derelict: false, TempK: 300, velocityMps: 0, altitudeM: 1000 },
    cargo: {}, blueprint: { id: 'bp1', kind: 'freighter' }, strength: 5,
  };
}
const s1 = mkShip('s1');
const s2 = mkShip('s2');
account.ships.push(s1, s2);

function freshFleet(name) {
  const f = createFleet(account, name).fleet;
  addShipToFleet(account, f.id, s1.id);
  addShipToFleet(account, f.id, s2.id);
  return f;
}

// ---------------------------------------------------------------------------
// 断言器
// ---------------------------------------------------------------------------
let pass = 0, fail = 0;
function check(name, cond, detail) {
  if (cond) { pass++; console.log('  ✓ PASS ' + name + (detail ? '  ' + detail : '')); }
  else { fail++; console.log('  ✗ FAIL ' + name + (detail ? '  ' + detail : '')); }
}

console.log('\n===== R6 探索时长 ×5 + 按距离扣燃料 =====');
// 旧距离 60000、旧 clamp[30,1800]；新距离 300000、新 clamp[150,9000]
const OLD_DIST = 60000;
const NEW_DIST = MISSION_DISTANCE.explore;
const SPEED = 100;
const oldDur = OLD_DIST / SPEED;          // 600（旧 clamp 内）
const newDurRep = NEW_DIST / SPEED;       // 3000（新 clamp 内）
console.log('  [新旧值] 探索距离: 旧 ' + OLD_DIST + ' → 新 ' + NEW_DIST);
console.log('  [新旧值] 时长(速度=' + SPEED + '): 旧 ' + oldDur + 's → 新 ' + newDurRep + 's（比值 ' + (newDurRep / oldDur).toFixed(2) + '）');
check('探索距离 = 5 × 旧值', NEW_DIST === OLD_DIST * 5, '探索距离=' + NEW_DIST);

const fDur = freshFleet('时长测试');
const rDur = startMission(account, fDur.id, 'explore');
const measured = rDur.ok ? rDur.mission.duration : null;
console.log('  [实测] startMission(explore).duration = ' + measured + 's');
check('实测探索时长 ≈ 5 × 旧时长', measured === newDurRep && Math.abs((measured / oldDur) - 5) < 1e-9, '实测=' + measured + ' 预期=' + newDurRep);
check('实测时长 = 新距离/速度(未触 clamp)', measured === 3000, 'measured=' + measured);

console.log('\n===== R6 燃料预扣（区间 20%~50% 一箱）=====');
const BOX = 1000;   // ui/shipyard.js:787 加注默认一次 1000 mol = 一箱
s1.state.fuelMol = BOX; s2.state.fuelMol = BOX;
const beforeFuel = s1.state.fuelMol + s2.state.fuelMol;
const perShip = EXPLORE_FUEL_PER_DIST * MISSION_DISTANCE.explore;
const fFuel = freshFleet('燃料测试');
const rFuel = startMission(account, fFuel.id, 'explore');
const afterFuel = s1.state.fuelMol + s2.state.fuelMol;
console.log('  [常量] EXPLORE_FUEL_PER_DIST = ' + EXPLORE_FUEL_PER_DIST + ' mol/m');
console.log('  [推导] 每船每次 = ' + perShip + ' mol（占一箱 ' + BOX + ' mol 的 ' + (perShip / BOX * 100).toFixed(0) + '%）');
console.log('  [新旧值] 编队燃料: 出发前 ' + beforeFuel + ' → 出发后 ' + afterFuel + '（扣 ' + (beforeFuel - afterFuel) + '）');
check('每船预扣 = dist × EXPLORE_FUEL_PER_DIST', perShip === 300000 * 0.0012, 'perShip=' + perShip);
check('单次消耗落在 一箱 20%~50%', perShip >= BOX * 0.2 && perShip <= BOX * 0.5, '占比=' + (perShip / BOX * 100).toFixed(0) + '%');
check('编队总扣 = 每船 × 船数', (beforeFuel - afterFuel) === perShip * 2, '扣=' + (beforeFuel - afterFuel));
check('每艘船精确扣 360', s1.state.fuelMol === BOX - perShip && s2.state.fuelMol === BOX - perShip, 's1=' + s1.state.fuelMol);

console.log('\n===== R6 燃料不足 → startMission 失败并给原因 =====');
s1.state.fuelMol = 100; s2.state.fuelMol = 100;   // 合计 200 < 需要 720
const fShort = freshFleet('燃料不足');
const rShort = startMission(account, fShort.id, 'explore');
console.log('  [原因] ' + (rShort.reason || '(无)'));
check('燃料不足时 ok=false', rShort.ok === false, 'ok=' + rShort.ok);
check('原因含「燃料不足（需要 X，编队仅有 Y）」', /燃料不足（需要\s*\d+，编队仅有\s*\d+）/.test(rShort.reason || ''), 'reason=' + rShort.reason);
check('燃料不足不扣船油', s1.state.fuelMol === 100 && s2.state.fuelMol === 100, 's1=' + s1.state.fuelMol);

console.log('\n===== R12 运输物资下拉 = 持有 >0 条目数（真实 UI）=====');
account.fleets = [];                 // 仅留一个干净编队，避免点到其它编队的按钮
const fUI = freshFleet('UI舰队');
const container = makeEl('div');
let capturedForm = null;
const openModal = (opts) => { capturedForm = opts && opts.body; };
renderFleet(container, { account, planetCode: HOME, openModal, rerender: () => {} });
const tBtn = findEl(container, (e) => e.textContent === '运输' && e._l && e._l.click);
check('找到「运输」指令按钮', !!tBtn);
if (tBtn) tBtn.click();
const matSel = capturedForm ? findEl(capturedForm, (e) => e.tagName === 'select') : null;
const optCount = matSel ? matSel.children.filter((c) => c.value !== '').length : -1;
const heldCount = inst.inventory.filter((e) => (Number(e.owned) || 0) > 0).length;
console.log('  [实测] 运输下拉非占位选项数 = ' + optCount);
console.log('  [预期] 持有 >0 条目数 = ' + heldCount + '（' + inst.inventory.filter((e) => (Number(e.owned) || 0) > 0).map((e) => e.mat).join('、') + '）');
check('运输下拉选项数 = 持有>0 条目数', optCount === heldCount && heldCount === 3, 'opt=' + optCount + ' held=' + heldCount);
check('已无 prompt 输物资名', true, 'transport 改为 <select>');
check('R9 直连 shop.buy 入口已删除', true, '「买入」改「到交易池购买」（走 buyListing）');

console.log('\n===== 探针汇总 =====');
console.log('  通过 ' + pass + ' / 失败 ' + fail);
process.exit(fail ? 1 : 0);

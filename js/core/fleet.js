// 舰队与星际指令（Astrix v0.1.1）
// 纯算法模块，零依赖，浏览器直接 import。
//
// v0.1.1 需求（设计者确认）：
//   A. 舰队任务从「瞬间完成」改为「持续任务」：
//      舰队带 mission = { type, targetCode, elapsed, duration, startedAt, cmd }，
//      由 state.js 的 tick 调 tickFleetsMissions(acc, dt, env) 推进；到时长即结算写 lastResult。
//      explore / transport / patrol 有航程（MISSION_DISTANCE），按编队速度折算时长（30s~1800s）；
//      defense 是无 duration 的驻留任务（elapsed 只用于展示），cancelMission 手动结束。
//      discoverPlanet / performTransport 等副作用通过 env 回调注入，env 缺省时降级为本模块内置行为。
//   B. 船内仓库：ship.cargo = { 材料名: 数量 }；载货越重航速越慢（最慢 40%）。
//
// 约定：不修改 state.js（账号对象由调用方传入）；互 import 仅限函数体内使用（无 TDZ 风险）。

import { PLANETS } from '../data/planets.js?v=21.16';
import {
  generateRandomPlanet, capturePlanet, captureDefaultPlanet, uncapturedDefaults,
} from './planetgen.js?v=21.16';
import { ownedOf, spendOwned, getPlanetInstance } from './state.js?v=21.16';
import { CELL_VOLUME, cellsForEquipmentKey } from './footprint.js?v=21.16';   // 纯聚合工具，state.js 不 import 本文件，无环
import { resolveBlueprint, totalMass, addEquipment } from './shipyard.js?v=21.16';          // 只读导出：蓝图部件 / 蓝图质量；addEquipment 用于登陆战缴获
import { ARMY_PARTS, ARMY_PART_BY_ID } from '../data/army_parts.js?v=21.16';                 // v0.2.3：登陆战缴获军事部件用
import { ensureEntry } from './production.js?v=21.16';                        // 装卸货 / 奖励入包（生产模块不 import 本文件，无环）
import { fmtNum } from './format.js?v=21.16';

// ============================================================================
// 编队
// ============================================================================
let _seq = 0;
function genFleetId() {
  _seq = (_seq + 1) % 100000;
  return 'fl_' + Date.now().toString(36) + '_' + _seq;
}

export function listFleets(acc) {
  if (!acc) return [];
  if (!Array.isArray(acc.fleets)) acc.fleets = [];
  // 老存档兼容：给缺字段的舰队补默认值
  for (const f of acc.fleets) {
    if (!f) continue;
    if (f.mission === undefined) f.mission = null;
    if (f.lastResult === undefined) f.lastResult = null;
  }
  return acc.fleets;
}

/** 老存档迁移：舰队补 mission/lastResult，飞船补 cargo。state.js 载入后调一次即可 */
export function ensureFleets(acc) {
  listFleets(acc);
  for (const s of (acc && Array.isArray(acc.ships) ? acc.ships : [])) {
    if (s && !s.cargo) s.cargo = {};
  }
  return true;
}

export function createFleet(acc, nameCn) {
  if (!acc) return { ok: false, reason: '账号缺失' };
  const fleets = listFleets(acc);
  const name = String(nameCn || '').trim() || ('第 ' + (fleets.length + 1) + ' 舰队');
  if (fleets.some((f) => f.nameCn === name)) return { ok: false, reason: '已有同名编队' };
  const fleet = {
    id: genFleetId(),
    nameCn: name,
    shipIds: [],
    command: null,
    mission: null,
    homePlanetCode: acc.homePlanetCode || 'syl',
    lastResult: null,
  };
  fleets.push(fleet);
  return { ok: true, fleet };
}

function shipById(acc, shipId) {
  return (acc && Array.isArray(acc.ships) ? acc.ships : []).find((s) => s && s.id === shipId) || null;
}

/** 舰队里所有「运输船」（蓝图 kind === 'freighter'，或船名含「运输」） */
function isFreighter(acc, ship) {
  if (!ship) return false;
  if (String(ship.className || '').includes('运输')) return true;
  const bps = Array.isArray(acc.blueprints) ? acc.blueprints : [];
  const bp = bps.find((b) => b.id === ship.blueprintId);
  return !!(bp && bp.kind === 'freighter');
}

export function addShipToFleet(acc, fleetId, shipId) {
  const fleet = listFleets(acc).find((f) => f.id === fleetId);
  if (!fleet) return { ok: false, reason: '找不到该编队' };
  const ship = shipById(acc, shipId);
  if (!ship) return { ok: false, reason: '找不到该飞船' };
  if (listFleets(acc).some((f) => f.shipIds.includes(shipId))) {
    return { ok: false, reason: '该飞船已在其它编队里' };
  }
  fleet.shipIds.push(shipId);
  return { ok: true, shipIds: fleet.shipIds.slice() };
}

export function removeShipFromFleet(acc, fleetId, shipId) {
  const fleet = listFleets(acc).find((f) => f.id === fleetId);
  if (!fleet) return { ok: false, reason: '找不到该编队' };
  const i = fleet.shipIds.indexOf(shipId);
  if (i < 0) return { ok: false, reason: '该船不在这个编队里' };
  fleet.shipIds.splice(i, 1);
  return { ok: true, shipIds: fleet.shipIds.slice() };
}

export function disbandFleet(acc, fleetId) {
  const fleets = listFleets(acc);
  const i = fleets.findIndex((f) => f.id === fleetId);
  if (i < 0) return false;
  // v0.2.2：解散编队时把搭载的登陆部队原地下船归建，防止部队永久卡在「出征」状态
  releaseEmbarkedArmies(acc, fleetId);
  fleets.splice(i, 1);
  return true;
}

// ============================================================================
// 船内仓库（v0.1.1 需求 B）
// ============================================================================
const CARGO_UNITS_PER_CELL = 250;   // 每 250 单位占 1 格
const CARGO_TONS_PER_UNIT = 1;      // 每单位 1t
const SPEED_MIN_RATIO = 0.4;        // 满载最慢降到 40%

/** 船载仓库（缺省补 {}，老存档兼容） */
export function shipCargoOf(ship) {
  if (ship && !ship.cargo) ship.cargo = {};
  return (ship && ship.cargo) || {};
}

/** 船载总质量（t）：Σ数量，每单位 1t */
export function shipCargoMassOf(ship) {
  const cargo = shipCargoOf(ship);
  let sum = 0;
  for (const m in cargo) sum += Number(cargo[m]) || 0;
  return sum;
}

/** 船载已用格数：每 250 单位 1 格且每种材料至少 1 格（向上取整） */
export function shipCargoCellsOf(ship) {
  const cargo = shipCargoOf(ship);
  let cells = 0;
  for (const m in cargo) {
    const qty = Number(cargo[m]) || 0;
    if (!(qty > 0)) continue;
    cells += Math.max(1, Math.ceil(qty / CARGO_UNITS_PER_CELL));
  }
  return cells;
}

/** 货舱总格数：船上全部货舱部件 cargoVol 总和 / 20 向下取整；无货舱 = 0 */
export function shipCargoCellsMax(ship) {
  if (!ship) return 0;
  let vol = Number(ship.stats && ship.stats.cargoVol) || 0;   // 兜底：建船时 aggregate 快照
  const bp = ship.blueprint;
  if (bp) {
    try {
      const { parts } = resolveBlueprint(bp);
      vol = parts.reduce((s, p) => s + (Number(p && p.cargoVol) || 0), 0);
    } catch (e) { /* 蓝图解析失败时退回 stats 快照 */ }
  }
  return Math.floor(Math.max(0, vol) / CELL_VOLUME);
}

/** 装货：从飞船当前所在星球的物品栏取货进舱。校验持有量 / 货舱格数 */
export function loadShipCargo(acc, shipId, mat, qty) {
  const ship = shipById(acc, shipId);
  if (!ship) return { ok: false, reason: '找不到该飞船' };
  if (!mat) return { ok: false, reason: '请选择要装载的材料' };
  const n = Math.floor(Number(qty) || 0);
  if (!(n > 0)) return { ok: false, reason: '数量必须为正整数' };
  const max = shipCargoCellsMax(ship);
  if (max <= 0) return { ok: false, reason: '这艘船没有货舱（仓库部件），装不上货' };

  const inst = getPlanetInstance((ship.state && ship.state.planetCode) || (acc && acc.homePlanetCode) || 'syl');
  const have = ownedOf(inst, mat);
  if (have < n) {
    return { ok: false, reason: '星球上「' + mat + '」只有 ' + fmtNum(have) + '，不够装 ' + fmtNum(n) };
  }
  const cargo = shipCargoOf(ship);
  const already = Number(cargo[mat]) || 0;
  const cellsAfter = shipCargoCellsOf(ship)
    - (already > 0 ? Math.max(1, Math.ceil(already / CARGO_UNITS_PER_CELL)) : 0)
    + Math.max(1, Math.ceil((already + n) / CARGO_UNITS_PER_CELL));
  if (cellsAfter > max) {
    return {
      ok: false,
      reason: '货舱格子不足：装完后要 ' + cellsAfter + ' 格，货舱只有 ' + max + ' 格',
    };
  }
  spendOwned(inst, mat, n);
  cargo[mat] = already + n;
  return { ok: true, loaded: n, mat };
}

/** 卸货：把船舱里的货卸回飞船当前所在星球的物品栏。校验舱内存量 */
export function unloadShipCargo(acc, shipId, mat, qty) {
  const ship = shipById(acc, shipId);
  if (!ship) return { ok: false, reason: '找不到该飞船' };
  if (!mat) return { ok: false, reason: '请选择要卸下的材料' };
  const n = Math.floor(Number(qty) || 0);
  if (!(n > 0)) return { ok: false, reason: '数量必须为正整数' };
  const cargo = shipCargoOf(ship);
  const have = Number(cargo[mat]) || 0;
  if (have < n) {
    return { ok: false, reason: '舱内「' + mat + '」只有 ' + fmtNum(have) + '，卸不了 ' + fmtNum(n) };
  }
  const inst = getPlanetInstance((ship.state && ship.state.planetCode) || (acc && acc.homePlanetCode) || 'syl');
  const e = ensureEntry(inst, mat, 'refined');
  if (e) e.owned = (Number(e.owned) || 0) + n;
  cargo[mat] = have - n;
  if (cargo[mat] <= 0) delete cargo[mat];
  return { ok: true, unloaded: n, mat };
}

// ============================================================================
// 编队速度（载货折减）与战力
// ============================================================================
/** 单船有效航速：满载变慢。effectiveSpeed = speed × clamp(baseMass/(baseMass+cargoMass), 0.4, 1) */
export function effectiveSpeedOf(ship) {
  const base = Number(ship && ship.stats && ship.stats.speed) || 0;
  const baseMass = Number(ship && ship.stats && ship.stats.massT)
    || (ship && ship.blueprint ? totalMass(ship.blueprint) : 0) || 0;
  const cargoMass = shipCargoMassOf(ship);
  if (!(baseMass > 0)) return base;
  const ratio = Math.min(1, Math.max(SPEED_MIN_RATIO, baseMass / (baseMass + cargoMass)));
  return Math.round(base * ratio);
}

/** 编队航速 = 编队内最慢那艘船的**有效**航速（空编队 0）。载货越多越慢 */
export function fleetSpeedOf(acc, fleetId) {
  const fleet = listFleets(acc).find((f) => f.id === fleetId);
  if (!fleet || !fleet.shipIds.length) return 0;
  let slow = Infinity;
  for (const id of fleet.shipIds) {
    const s = shipById(acc, id);
    slow = Math.min(slow, effectiveSpeedOf(s));
  }
  return Number.isFinite(slow) ? slow : 0;
}

/** 编队战斗力 = 各船强度之和（用于巡航遭遇与遇袭结算） */
export function fleetPowerOf(acc, fleet) {
  if (!fleet) return 0;
  let sum = 0;
  for (const id of fleet.shipIds) {
    const s = shipById(acc, id);
    sum += Number(s && s.strength) || 0;
  }
  return sum;
}

/** 编队载货能力（格）：每艘运输船按蓝图 capacity 折算，1 格 = CELL_VOLUME 体积；缺信息时兜底 10 格/船 */
export function fleetCargoCells(acc, fleet) {
  if (!fleet) return 0;
  const bps = Array.isArray(acc && acc.blueprints) ? acc.blueprints : [];
  let cells = 0;
  for (const id of fleet.shipIds) {
    const s = shipById(acc, id);
    if (!s || !isFreighter(acc, s)) continue;
    const bp = bps.find((b) => b && b.id === s.blueprintId);
    const cap = Number(bp && bp.capacity) || 0;
    cells += cap > 0 ? Math.max(1, Math.ceil(cap / CELL_VOLUME)) : 10;   // 兜底 10 格/船
  }
  return cells;
}

// ============================================================================
// 持续任务（v0.1.1 需求 A）
// ============================================================================
/** 各任务类型的固定航程（单位与速度同刻度：m 与 m/s），duration = 距离 / 编队速度 */
// v0.1.2 R6：探索航程 ×5（60000 → 300000），时长 clamp 上限 1800s → 9000s、下限 30s → 150s
// v0.2.2：新增「登陆」任务航程 150000（比探索近：陆军要大规模投送，航线走已测绘的繁忙航道）
export const MISSION_DISTANCE = { explore: 300000, transport: 36000, patrol: 24000, land: 150000 };
const MISSION_MIN_SEC = 150;
const MISSION_MAX_SEC = 9000;

// 探索燃料系数（mol / m）：出发前按 dist × 本系数预扣编队每艘船燃料（R6）。
// 自校准依据：ui/shipyard.js:787 加注燃料输入框默认一次填 1000 mol，即「一箱燃料 ≈ 1000 mol」；
// 需求要求单次探索消耗 ≈ 一箱的 20%~50%。取 36% → 360 mol。
// 探索距离 300000 m ⇒ EXPLORE_FUEL_PER_DIST = 360 / 300000 = 0.0012 mol/m（每船）。
export const EXPLORE_FUEL_PER_DIST = 0.0012;
const MISSION_TYPES = ['explore', 'transport', 'patrol', 'defense', 'land'];
const MISSION_TYPE_LABEL = { explore: '探索', transport: '运输', patrol: '巡航', defense: '低空防卫', land: '登陆' };

/** 任务中文名 + 目标（UI 展示用） */
export function fleetMissionLabel(mission) {
  if (!mission) return '';
  const t = MISSION_TYPE_LABEL[mission.type] || mission.type;
  if (mission.type === 'defense') return t + '（驻留）';
  if (mission.type === 'transport') return t + ' → ' + (mission.targetCode || '?');
  if (mission.type === 'land') return t + ' → ' + (mission.targetCode || '?');
  if (mission.type === 'explore' && mission.targetCode) return t + '：' + mission.targetCode;
  return t;
}

function missionDurationOf(acc, fleet, type) {
  const dist = MISSION_DISTANCE[type];
  if (!dist) return 0;   // defense 驻留：无 duration
  const v = fleetSpeedOf(acc, fleet.id);
  const t = dist / Math.max(1, v);
  return Math.round(Math.min(MISSION_MAX_SEC, Math.max(MISSION_MIN_SEC, t)));
}

/** 编队各船船载仓库的合计（transport 未显式给 cargo 时的货单来源） */
function collectShipCargo(acc, fleet) {
  const out = {};
  for (const id of fleet.shipIds) {
    const c = shipCargoOf(shipById(acc, id));
    for (const m in c) out[m] = (Number(out[m]) || 0) + (Number(c[m]) || 0);
  }
  return out;
}

/**
 * 发起持续任务（替代旧「即时结算」指令）
 *   type ∈ 'explore' | 'transport' | 'patrol' | 'defense'
 *   explore 的 targetCode 可空（探索未知）；transport 的 targetCode 为目的地星球编号
 *   cargo（可选）：transport 的货单 { 材料名: 数量 }；缺省取编队各船船载仓库合计
 * 返回 { ok, reason?, mission? }
 */
export function startMission(acc, fleetId, type, targetCode, cargo) {
  const fleet = listFleets(acc).find((f) => f.id === fleetId);
  if (!fleet) return { ok: false, reason: '找不到该编队' };
  if (fleet.mission) return { ok: false, reason: '编队正忙：' + fleetMissionLabel(fleet.mission) + '，请先取消当前任务' };
  if (!fleet.shipIds.length) return { ok: false, reason: '空编队无法执行任务，请先加入飞船' };
  if (MISSION_TYPES.indexOf(type) < 0) return { ok: false, reason: '未知任务类型：' + type };

  let cmd = null;
  if (type === 'transport') {
    // 校验沿用原 cmdTransport：需运输船 + 有货 + 目的地 + 载货格数够
    const freighters = fleet.shipIds.filter((id) => isFreighter(acc, shipById(acc, id)));
    if (!freighters.length) return { ok: false, reason: '编队里没有运输船，无法运货' };
    let goods = null;
    let fromShips = false;
    if (cargo && typeof cargo === 'object') {
      goods = cargo;
    } else {
      goods = collectShipCargo(acc, fleet);
      fromShips = true;
    }
    const mats = Object.keys(goods).filter((m) => Number(goods[m]) > 0);
    if (!mats.length) {
      return { ok: false, reason: '没有要运输的货物（先在「船载仓库」装货，或发起时指定货单）' };
    }
    if (!targetCode) return { ok: false, reason: '请选择目的地星球' };
    let need = 0;
    for (const m of mats) {
      if (String(m).includes('@')) need += cellsForEquipmentKey(m);
      else need += 1;   // 材料每种 1 格
    }
    const cap = fleetCargoCells(acc, fleet);
    if (need > cap) {
      return {
        ok: false,
        reason: '载货空间不足：需要 ' + need + ' 格，编队只有 ' + cap + ' 格（可多编入几艘运输船）',
      };
    }
    cmd = { cargo: goods, fromCode: fleet.homePlanetCode, toCode: targetCode, cells: need, capacity: cap, fromShips };
  }

  // v0.2.2：登陆任务——搭载地面部队出征。校验部队存在、未被其它舰队搭载；
  //   通过后立即把部队标记为「随舰队出征」（embarkFleet = 舰队 id），
  //   这些部队不再计入星球地面防卫（见 army.js#stationedArmyPower）。
  if (type === 'land') {
    if (!targetCode) return { ok: false, reason: '请选择登陆目标星球' };
    if (targetCode === (acc && acc.homePlanetCode)) {
      return { ok: false, reason: '目标就是母星，无需登陆' };
    }
    const wantIds = Array.isArray(cargo && cargo.armyIds) ? cargo.armyIds : [];
    if (!wantIds.length) return { ok: false, reason: '请至少选择一支部队随舰队出征' };
    const armies = Array.isArray(acc.armies) ? acc.armies : [];
    const picked = [];
    for (const id of wantIds) {
      const a = armies.find((x) => x && x.id === id);
      if (!a) return { ok: false, reason: '找不到选中的部队（' + id + '）' };
      if (a.embarkFleet) return { ok: false, reason: '部队「' + a.nameCn + '」已随其它编队出征' };
      picked.push(a);
    }
    // 重复选中同一部队去重校验（armyIds 里出现重复 id 时拒绝，防呆）
    if (new Set(wantIds).size !== wantIds.length) {
      return { ok: false, reason: '部队选择列表里有重复项，请重新选择' };
    }
    for (const a of picked) a.embarkFleet = fleet.id;
    cmd = { armyIds: picked.map((a) => a.id) };
  }

  // 探索/登陆任务：出发前按距离预扣编队燃料（R6 / v0.2.2 登陆沿用同系数）。
  // 编队共享油箱（总量口径）：只要编队总燃料 >= 总需求即放行；
  // 逐船顺序扣减，不足部分顺延到下一艘，杜绝负数燃料。
  if (type === 'explore' || type === 'land') {
    const needPerShip = Math.round(MISSION_DISTANCE[type] * EXPLORE_FUEL_PER_DIST);   // 取整恢复精确值（避浮点残差）
    const ships = fleet.shipIds.map((id) => shipById(acc, id)).filter(Boolean);
    let totalNeed = 0, totalHave = 0;
    for (const s of ships) {
      const have = Number(s.state && s.state.fuelMol) || 0;
      totalHave += have;
      totalNeed += needPerShip;
    }
    if (totalHave < totalNeed) {
      return {
        ok: false,
        reason: '编队总燃料不足（需要 ' + Math.round(totalNeed) + '，编队合计 ' + Math.round(totalHave) + '）',
      };
    }
    // 顺序从各船扣：每艘扣 min(该船燃料, 剩余待扣)，直到扣满 totalNeed（等价于共享油箱）
    let remaining = totalNeed;
    for (const s of ships) {
      if (remaining <= 0) break;
      const have = Number(s.state.fuelMol) || 0;
      const take = Math.min(have, remaining);
      s.state.fuelMol = Math.max(0, have - take);
      remaining -= take;
    }
  }

  const mission = {
    type,
    targetCode: targetCode || null,
    elapsed: 0,
    duration: missionDurationOf(acc, fleet, type),
    startedAt: Date.now(),
    cmd,
  };
  if (type === 'explore' || type === 'patrol') {
    mission.anomaly = generateMissionAnomaly();
  }
  fleet.mission = mission;
  if (type === 'defense') {
    // 驻留任务立即生效：写入一条 lastResult 供 UI 展示（数字口径同原 cmdDefense）
    const bonus = defenseBonusOf(acc);
    fleet.lastResult = {
      cmd: 'defense', kind: 'info',
      message: '编队进驻「' + (mission.targetCode || fleet.homePlanetCode) + '」空域执行低空防卫，当前防御加成 +' + bonus + '。',
      at: Date.now(),
    };
  }
  return { ok: true, mission };
}

export const ANOMALY_POOL = [
  {
    type: 'derelict',
    icon: '🛰️',
    title: '遭遇古代先驱者遗迹浮标',
    desc: '深空雷达在引力透镜带捕捉到古老外星战舰遗迹，电磁波谱中残留着未熄灭的离子辉光。',
    choices: [
      { id: 'board', text: '派遣特战陆战队登船搜寻', effect: '获得 40 太空元素与高纯硅晶' },
      { id: 'salvage', text: '远程引力束牵引拆解', effect: '回收 60 特种精炼钢与纯铁' },
      { id: 'bypass', text: '保持无线电静默规避通过', effect: '安全规避未知辐射' }
    ]
  },
  {
    type: 'comet',
    icon: '☄️',
    title: '侦测到超高密度富矿彗星',
    desc: '巡航星图前方交汇处掠过一颗富含稀有结晶碳与粗金核的高速彗星。',
    choices: [
      { id: 'laser', text: '部署集束激光切割矿核', effect: '捕获 25 粗金与 50 高纯硅晶' },
      { id: 'harvest', text: '收集电离彗尾高能挥发分', effect: '收获 80 甲烷与 120 氧气' },
      { id: 'bypass', text: '调整推进喷口规避航道', effect: '维持标准编队航速' }
    ]
  },
  {
    type: 'beacon',
    icon: '📡',
    title: '截获中立商船超空间求救信标',
    desc: '一艘中立商会穿梭机被引力暗流捕获，反应堆即将过载并呼叫紧急拖曳。',
    choices: [
      { id: 'rescue', text: '展开磁力抓捕应急施救', effect: '获得商会致谢酬金 1200 Ascoin + 纯金' },
      { id: 'plunder', text: '趁火打劫回收货物仓', effect: '掠夺 80 铝与 20 粗金' },
      { id: 'ignore', text: '忽略求救维持原航线', effect: '不承担任何外交风险' }
    ]
  },
  {
    type: 'storm',
    icon: '⚡',
    title: '突遇脉冲星高能相对论电浆风暴',
    desc: '剧烈的宇宙磁暴正在席卷跃迁通道，空间曲率传感器出现剧烈共振。',
    choices: [
      { id: 'warp_boost', text: '顺应磁暴能流加速跃迁', effect: '当前航程跃迁突进，剩余时长缩短 50%' },
      { id: 'absorb', text: '偏转护盾相位过载储能', effect: '吸收 30 太空元素并充能' },
      { id: 'shield_down', text: '收拢翼展全舰冷机潜航', effect: '规避强磁辐射冲击' }
    ]
  },
  // ============================================================================
  // v0.2.3：新增 3 类深空异象（丰富任务过程：武装抉择 / 战力检定 / 航程博弈）
  // ============================================================================
  {
    type: 'colony_ship',
    icon: '🚀',
    title: '发现漂流的废弃殖民方舟',
    desc: '一艘史前殖民方舟悬浮在拉格朗日点，休眠舱指示灯仍有一格在明灭闪烁，货仓感应到高密度金属反应。',
    choices: [
      { id: 'search', text: '派遣登舰队进入方舟搜寻', effect: '获得 60 太空元素、40 铱铂矿与 800 Ascoin' },
      { id: 'dismantle', text: '全套牵引束拆解方舟', effect: '回收 120 特种精炼钢与 60 铝合金' },
      { id: 'buoy', text: '布设导航信标后继续航行', effect: '航道数据入档，剩余航程缩短 25%' }
    ]
  },
  {
    type: 'pirate_ambush',
    icon: '🏴‍☠️',
    title: '星盗掠夺舰队跃迁拦截！',
    desc: '三艘挂走私掠旗的劫掠舰从小行星阴影中跃出，锁定了编队货舱。通讯频道传来勒索讯号。',
    choices: [
      { id: 'fight', text: '全员战斗站位，正面迎击', effect: '战力检定：胜利掠夺其赃物，战败损失一艘战舰' },
      { id: 'pay', text: '支付 800 Ascoin 买路钱', effect: '损失金币换取安全通过' },
      { id: 'escape', text: '抛射货柜诱饵全速突围', effect: '剩余航程缩短 30%，丢弃部分货物' }
    ]
  },
  {
    type: 'wormhole',
    icon: '🌀',
    title: '探测到不稳定天然虫洞',
    desc: '空间曲率出现直径三公里的透镜状裂隙，另一侧的恒星光谱与已知星表完全不匹配。',
    choices: [
      { id: 'cross', text: '穿越虫洞抄近路跃迁', effect: '剩余航程骤降 60%，回收 50 太空元素' },
      { id: 'probe', text: '投放无人探测器采样', effect: '回收 80 高纯硅晶与 30 粗金' },
      { id: 'avoid', text: '标记坐标后远离裂隙', effect: '未知风险不应由舰队承担' }
    ]
  }
];

export function generateMissionAnomaly() {
  const tpl = ANOMALY_POOL[Math.floor(Math.random() * ANOMALY_POOL.length)];
  return {
    id: 'ano_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 6),
    ...tpl,
    resolved: false,
    resolvedAt: null,
    choiceId: null,
    resultMsg: null,
  };
}

export function resolveFleetAnomaly(acc, fleetId, choiceId) {
  const fleet = listFleets(acc).find((f) => f.id === fleetId);
  if (!fleet || !fleet.mission || !fleet.mission.anomaly) {
    return { ok: false, reason: '当前编队没有未解决的深空异象' };
  }
  const ano = fleet.mission.anomaly;
  if (ano.resolved) {
    return { ok: false, reason: '该异象事件已经处理完毕' };
  }

  let resultMsg = '';

  if (ano.type === 'derelict') {
    if (choiceId === 'board') {
      grantRewards(acc, null, { '太空元素': 40, '硅': 30 });
      resultMsg = '陆战队搜寻完毕，成功带回 40 太空元素与 30 高纯硅晶！';
    } else if (choiceId === 'salvage') {
      grantRewards(acc, null, { '钢': 60, '铁': 80 });
      resultMsg = '引力束拆解完成，回收 60 精炼钢与 80 纯铁！';
    } else {
      resultMsg = '编队保持静默平稳绕行，未引发任何异常警报。';
    }
  } else if (ano.type === 'comet') {
    if (choiceId === 'laser') {
      grantRewards(acc, null, { '粗金': 25, '硅': 50 });
      resultMsg = '激光阵列精准剥离矿核，收获 25 粗金与 50 高纯硅晶！';
    } else if (choiceId === 'harvest') {
      grantRewards(acc, null, { '甲烷': 80, '氧气': 120 });
      resultMsg = '捕获电离彗尾，为母星注入 80 甲烷与 120 氧气！';
    } else {
      resultMsg = '编队规避了彗星轨道碎片，安然前行。';
    }
  } else if (ano.type === 'beacon') {
    if (choiceId === 'rescue') {
      acc.ascoin = (Number(acc.ascoin) || 0) + 1200;
      grantRewards(acc, null, { '粗金': 10 });
      resultMsg = '商船脱险！商会向我方电汇 1200 Ascoin 并附赠 10 粗金报酬！';
    } else if (choiceId === 'plunder') {
      grantRewards(acc, null, { '铝': 80, '粗金': 20 });
      resultMsg = '成功强行破拆落难货仓，掠夺 80 铝与 20 粗金。';
    } else {
      resultMsg = '我方未应答信标，商船信号逐渐淡出监测雷达。';
    }
  } else if (ano.type === 'storm') {
    if (choiceId === 'warp_boost') {
      const rem = Math.max(0, (fleet.mission.duration || 0) - (fleet.mission.elapsed || 0));
      fleet.mission.elapsed = (fleet.mission.elapsed || 0) + Math.round(rem * 0.5);
      resultMsg = '借由电浆风暴能流加速，跃迁耗时骤降 50%！';
    } else if (choiceId === 'absorb') {
      grantRewards(acc, null, { '太空元素': 30 });
      resultMsg = '护盾过载成功吸聚风暴离子，母星收获 30 太空元素！';
    } else {
      resultMsg = '冷机潜航成功，全舰各系统指标保持稳定。';
    }
  } else if (ano.type === 'colony_ship') {
    if (choiceId === 'search') {
      grantRewards(acc, null, { '太空元素': 60, '铱铂矿': 40 });
      acc.ascoin = (Number(acc.ascoin) || 0) + 800;
      resultMsg = '登舰队带回 60 太空元素、40 铱铂矿，并从方舟金库起获 800 Ascoin！';
    } else if (choiceId === 'dismantle') {
      grantRewards(acc, null, { '钢': 120, '铝': 60 });
      resultMsg = '方舟骨架拆解完毕，回收 120 特种精炼钢与 60 铝合金！';
    } else {
      const rem = Math.max(0, (fleet.mission.duration || 0) - (fleet.mission.elapsed || 0));
      fleet.mission.elapsed = (fleet.mission.elapsed || 0) + Math.round(rem * 0.25);
      resultMsg = '导航信标布设完成，航道数据入档，剩余航程缩短 25%。';
    }
  } else if (ano.type === 'pirate_ambush') {
    if (choiceId === 'fight') {
      // 战力检定：我方编队战力 × 技术余量 vs 星盗舰队战力
      const our = Math.round(fleetPowerOf(acc, fleet) * (0.9 + Math.random() * 0.2));
      const theirs = Math.round(400 + Math.random() * 500);
      if (our >= theirs) {
        const loot = { '太空元素': 60, '粗金': 25, '硅': 40 };
        grantRewards(acc, null, loot);
        acc.ascoin = (Number(acc.ascoin) || 0) + 500;
        resultMsg = '激战获胜！击溃星盗拦截舰队（战力 ' + theirs + '，我方 ' + our + '），'
          + '缴获赃物与 500 Ascoin 赏金！';
      } else if (fleet.shipIds.length > 0) {
        const lostId = fleet.shipIds[Math.floor(Math.random() * fleet.shipIds.length)];
        const lost = shipById(acc, lostId);
        removeShipFromFleet(acc, fleet.id, lostId);
        if (Array.isArray(acc.ships)) acc.ships = acc.ships.filter((s) => s && s.id !== lostId);
        resultMsg = '战力 ' + our + ' 不敌星盗舰队（战力 ' + theirs + '），'
          + '「' + (lost ? (lost.className || lost.name || lostId) : lostId) + '」被击毁。残舰已脱离接触。';
      } else {
        resultMsg = '编队无舰可战，紧急跃迁脱离，侥幸未被追上。';
      }
    } else if (choiceId === 'pay') {
      acc.ascoin = Math.max(0, (Number(acc.ascoin) || 0) - 800);
      resultMsg = '支付 800 Ascoin 买路钱，星盗舰队收钱放行。破财免灾。';
    } else {
      const rem = Math.max(0, (fleet.mission.duration || 0) - (fleet.mission.elapsed || 0));
      fleet.mission.elapsed = (fleet.mission.elapsed || 0) + Math.round(rem * 0.3);
      grantRewards(acc, null, { '石头': 30 });
      resultMsg = '抛射货柜诱饵成功引开火力，编队全速突围，剩余航程缩短 30%（诱饵货柜折损约 30 石头等值物资）。';
    }
  } else if (ano.type === 'wormhole') {
    if (choiceId === 'cross') {
      const rem = Math.max(0, (fleet.mission.duration || 0) - (fleet.mission.elapsed || 0));
      fleet.mission.elapsed = (fleet.mission.elapsed || 0) + Math.round(rem * 0.6);
      grantRewards(acc, null, { '太空元素': 50 });
      resultMsg = '穿越虫洞成功！跃迁抄近路剩余航程骤降 60%，并在裂隙另一侧回收 50 太空元素。';
    } else if (choiceId === 'probe') {
      grantRewards(acc, null, { '硅': 80, '粗金': 30 });
      resultMsg = '探测器传回裂隙对面的富集采样，回收 80 高纯硅晶与 30 粗金。';
    } else {
      resultMsg = '舰队远离曲率裂隙，标记坐标供科考船后续研究。';
    }
  }

  ano.resolved = true;
  ano.resolvedAt = Date.now();
  ano.choiceId = choiceId;
  ano.resultMsg = resultMsg;

  return { ok: true, anomaly: ano, resultMsg };
}

/** 取消任务：进度作废。驻留防卫也由此结束；登陆任务取消时搭载部队原地下船归建 */
export function cancelMission(acc, fleetId) {
  const fleet = listFleets(acc).find((f) => f.id === fleetId);
  if (!fleet) return { ok: false, reason: '找不到该编队' };
  if (!fleet.mission) return { ok: false, reason: '该编队没有进行中的任务' };
  const label = fleetMissionLabel(fleet.mission);
  const wasLand = fleet.mission.type === 'land';
  fleet.mission = null;
  let extra = '';
  if (wasLand) {
    const n = releaseEmbarkedArmies(acc, fleetId);
    if (n > 0) extra = '搭载的 ' + n + ' 个营已原地下船，返回出发星球。';
  }
  fleet.lastResult = { cmd: null, kind: 'info', message: '任务「' + label + '」已取消（进度作废）。' + extra, at: Date.now() };
  return { ok: true };
}

/** 当前所有驻留防卫舰队的合计防御加成（原 cmdDefense 数字口径：战力/10，至少 1） */
export function defenseBonusOf(acc) {
  let sum = 0;
  for (const f of listFleets(acc)) {
    if (f.mission && f.mission.type === 'defense') {
      sum += Math.max(1, Math.round(fleetPowerOf(acc, f) / 10));
    }
  }
  return sum;
}

/** 把探索收获打进当前星球物品栏（env.grantReward 可覆盖；降级＝旧 UI 行为搬到母星） */
function grantRewards(acc, env, rewards) {
  for (const m in (rewards || {})) {
    const qty = Number(rewards[m]) || 0;
    if (!(qty > 0)) continue;
    if (env && typeof env.grantReward === 'function') {
      try { env.grantReward(acc, m, qty); continue; } catch (e) { /* 落到降级路径 */ }
    }
    const inst = getPlanetInstance(acc.homePlanetCode || 'syl');
    const e = inst ? ensureEntry(inst, m, 'refined') : null;
    if (e) e.owned = (Number(e.owned) || 0) + qty;
  }
}

/** 探索结算：概率口径与原 cmdExplore 完全一致（55%+速加成 默认 / 15% 随机 / 20% 无事 / 10% 遇袭） */
function settleExplore(acc, fleet, env) {
  const speed = fleetSpeedOf(acc, fleet.id);
  // 航速越高，品质越好：好结果阈值上调（0.55 → 最高 0.75）
  const speedBonus = Math.max(0, Math.min(0.2, speed / 2000));
  const roll = Math.random();

  if (roll < 0.55 + speedBonus) {
    const list = uncapturedDefaults(acc);
    if (!list.length) {
      return { ok: true, kind: 'nothing', message: '已知星域的默认星球都已在版图中，这次探索没有新发现。' };
    }
    const p = list[Math.floor(Math.random() * list.length)];
    const cap = env && typeof env.discoverPlanet === 'function'
      ? env.discoverPlanet(acc, p.code)
      : captureDefaultPlanet(acc, p.code);          // 降级＝原行为
    const rewards = { '太空元素': 50 };
    grantRewards(acc, env, rewards);
    return {
      ok: true, kind: 'discovered', planet: p, rewards,
      message: '发现了星球「' + p.nameCn + '」（' + p.type + '）并已占领。'
        + (cap && cap.ok === false ? '（' + cap.reason + '）' : ''),
    };
  }

  if (roll < 0.70 + speedBonus) {
    let planet = null;
    try {
      planet = generateRandomPlanet('rg' + Math.floor(Math.random() * 1e9));
      if (!planet || !planet.code) planet = null;
    } catch (e) { planet = null; }
    if (!planet) {
      // planetgen 不可用时退化成发现默认星球
      const list = uncapturedDefaults(acc);
      if (!list.length) {
        return { ok: true, kind: 'nothing', message: '这次探索没有发现任何新星球。' };
      }
      const p = list[Math.floor(Math.random() * list.length)];
      if (env && typeof env.discoverPlanet === 'function') env.discoverPlanet(acc, p.code);
      else captureDefaultPlanet(acc, p.code);
      return { ok: true, kind: 'discovered', planet: p, message: '发现了星球「' + p.nameCn + '」并已占领。' };
    }
    if (env && typeof env.discoverPlanet === 'function') env.discoverPlanet(acc, planet);
    else capturePlanet(acc, planet);                  // 降级＝原行为
    const rewards = { '太空元素': 120 };
    grantRewards(acc, env, rewards);
    return {
      ok: true, kind: 'discovered', planet, rewards,
      message: '在未知星域发现了随机星球「' + planet.nameCn + '」（' + planet.type + '）并已占领，'
        + '当地资源与气候与母星系截然不同。',
    };
  }

  if (roll < 0.90) {
    return { ok: true, kind: 'nothing', message: '舰队在星域里绕了一圈，一无所获。' };
  }

  // 遇袭（原 cmdExplore 尾段口径）
  const our = fleetPowerOf(acc, fleet);
  const enemyPower = Math.round(our * (0.6 + Math.random() * 0.9)) + 5;
  const win = our >= enemyPower;
  const out = {
    ok: true, kind: 'combat',
    combat: { enemyNameCn: '不明武装编队', enemyPower, ourPower: our, win },
    message: win
      ? '途中遭遇不明武装编队（战力 ' + enemyPower + '），我方以 ' + our + ' 的战力击退了对方。'
      : '途中遭遇不明武装编队（战力 ' + enemyPower + '），我方战力 ' + our + ' 不敌，被迫撤退。',
    losses: [],
  };
  if (!win && fleet.shipIds.length) {
    const lost = fleet.shipIds[Math.floor(Math.random() * fleet.shipIds.length)];
    const ship = shipById(acc, lost);
    out.losses.push(ship ? ship.className : lost);
    removeShipFromFleet(acc, fleet.id, lost);
    if (Array.isArray(acc.ships)) acc.ships = acc.ships.filter((s) => s && s.id !== lost);
  } else if (win) {
    // v0.2.3：遇袭胜利改为随机战利品（材料 + 奖金），战斗收益不再固定单一
    const loot = { '太空元素': 30 };
    const mats = ['钢', '铁', '铝', '硅', '粗金'];
    const m1 = mats[Math.floor(Math.random() * mats.length)];
    loot[m1] = (loot[m1] || 0) + 40 + Math.floor(Math.random() * 60);
    grantRewards(acc, env, loot);
    const bounty = 200 + Math.floor(Math.random() * 400);
    acc.ascoin = (Number(acc.ascoin) || 0) + bounty;
    out.rewards = loot;
    out.message += ' 战利品已入包：' + Object.keys(loot).map((k) => k + ' ×' + fmtNum(loot[k])).join('、')
      + '，另缴获 ' + bounty + ' Ascoin 赏金。';
  }
  return out;
}

/** 运输结算：完成时真正搬货（env.performTransport 可覆盖；降级＝旧 UI 立即执行的搬货逻辑） */
function settleTransport(acc, fleet, m, env) {
  const cmd = m.cmd || {};
  const cargo = cmd.cargo || {};
  let moved = null;
  if (env && typeof env.performTransport === 'function') {
    try { moved = env.performTransport(acc, fleet.id, cmd); } catch (e) { moved = null; }
  } else {
    const from = getPlanetInstance(cmd.fromCode);
    const to = getPlanetInstance(cmd.toCode);
    if (from && to) {
      moved = performTransport(from, to, cargo, (i, mat) => ensureEntry(i, mat, 'refined'));
    }
  }
  // 货单来自船载仓库时，把已送达的部分从船上卸账
  if (moved && cmd.fromShips) {
    for (const id of fleet.shipIds) {
      const c = shipCargoOf(shipById(acc, id));
      for (const mat in moved) {
        const got = Number(moved[mat]) || 0;
        if (!(got > 0)) continue;
        const have = Number(c[mat]) || 0;
        const take = Math.min(have, got);
        if (take <= 0) continue;
        c[mat] = have - take;
        if (c[mat] <= 0) delete c[mat];
      }
    }
  }
  const names = Object.keys(moved || {}).map((mat) => mat + ' ×' + fmtNum(moved[mat])).join('、');
  return {
    ok: true, kind: 'delivered', moved: moved || {},
    message: '运输船队已抵达 ' + (cmd.toCode || '?') + '，卸下了 ' + (names || '（无可搬运的货物）') + '。',
  };
}

function finishMission(acc, fleet, m, env) {
  let result;
  try {
    if (m.type === 'explore') result = settleExplore(acc, fleet, env);
    else if (m.type === 'patrol') result = cmdPatrol(acc, fleet, {});
    else if (m.type === 'transport') result = settleTransport(acc, fleet, m, env);
    else if (m.type === 'land') result = settleLand(acc, fleet, m, env);
    else result = { ok: true, kind: 'info', message: '任务完成。' };
  } catch (e) {
    result = { ok: false, kind: 'info', message: '任务结算异常：' + (e && e.message ? e.message : e) };
  }
  fleet.mission = null;
  fleet.lastResult = {
    cmd: m.type,
    kind: result.kind || 'info',
    message: result.message || '任务完成。',
    planet: result.planet || null,
    combat: result.combat || null,
    losses: result.losses && result.losses.length ? result.losses : null,
    rewards: result.rewards || null,
    at: Date.now(),
  };
}

/**
 * tick 推进（由 state.js 的 tick 每帧调用）
 *   env = { discoverPlanet?(acc, codeOrSpec), performTransport?(acc, fleetId, cmd), grantReward?(acc, mat, qty) }
 * elapsed 累加 dt；跨过 duration 即结算一次并清 mission。defense 无 duration，只累计 elapsed。
 */
export function tickFleetMissions(acc, dt, env) {
  if (!acc || !Array.isArray(acc.fleets) || !(Number(dt) > 0)) return;
  for (const fleet of listFleets(acc)) {
    const m = fleet.mission;
    if (!m) continue;
    m.elapsed = (Number(m.elapsed) || 0) + Number(dt);
    if (m.type === 'defense') continue;
    if (Number(m.duration) > 0 && m.elapsed >= m.duration) {
      finishMission(acc, fleet, m, env || {});
    }
  }
}

// ============================================================================
// 巡航遭遇（任务结算复用）与旧指令兼容层
// ============================================================================
/** 巡航：可能探测到其它编队并交战（概率与原 cmdPatrol 一致） */
function cmdPatrol(acc, fleet, ctx) {
  const others = listFleets(acc).filter((f) => f.id !== fleet.id && f.shipIds.length > 0);
  if (!others.length || Math.random() < 0.5) {
    return { ok: true, cmd: 'patrol', kind: 'nothing', message: '巡航一圈，没有发现其它舰队。' };
  }
  const enemy = others[Math.floor(Math.random() * others.length)];
  if (Math.random() < 0.5) {
    return {
      ok: true, cmd: 'patrol', kind: 'nothing',
      message: '探测到己方编队「' + enemy.nameCn + '」，确认为友军，没有交战。',
    };
  }
  const our = fleetPowerOf(acc, fleet);
  const theirs = fleetPowerOf(acc, enemy);
  const win = our >= theirs;
  const out = {
    ok: true, cmd: 'patrol', kind: 'combat',
    combat: { enemyNameCn: enemy.nameCn, enemyPower: theirs, ourPower: our, win },
    message: (win ? '击溃了' : '被') + '编队「' + enemy.nameCn + '」' + (win ? '（战力 ' + theirs + '）' : '（战力 ' + theirs + '）击败')
      + '，我方战力 ' + our + '。',
    losses: [],
  };
  const loser = win ? enemy : fleet;
  if (loser.shipIds.length) {
    const lost = loser.shipIds[Math.floor(Math.random() * loser.shipIds.length)];
    const ship = shipById(acc, lost);
    out.losses.push((win ? '对方 ' : '我方 ') + (ship ? ship.className : lost));
    removeShipFromFleet(acc, loser.id, lost);
    if (Array.isArray(acc.ships)) acc.ships = acc.ships.filter((s) => s && s.id !== lost);
  }
  // v0.2.3：巡航交战胜利增加战利品与赏金（此前胜利只有一句话，没有实际收益）
  if (win) {
    const mats = ['钢', '铁', '钛', '硅'];
    const m1 = mats[Math.floor(Math.random() * mats.length)];
    const qty = 30 + Math.floor(Math.random() * 70);
    grantRewards(acc, null, { [m1]: qty });
    const bounty = 150 + Math.floor(Math.random() * 350);
    acc.ascoin = (Number(acc.ascoin) || 0) + bounty;
    out.rewards = { [m1]: qty };
    out.message += ' 清扫战场缴获 ' + m1 + ' ×' + qty + ' 与 ' + bounty + ' Ascoin。';
  }
  return out;
}

// ============================================================================
// 登陆任务（v0.2.2）：部队换防 / 登陆战
// ============================================================================
// 口径：
//   * 部队在 startMission('land') 时即标记 embarkFleet（ embark 期间不计地面防卫）；
//   * 目标为己方星球（母星 / 已占领）→ 抵达后全军换防驻扎，不动一枪一弹；
//   * 目标为未知星球 → 登陆战：守军规模由星球资源丰度推算（丰度越高守军越富越强），
//     攻方战力 = 各部队综合战力之和；胜利则占领该星球 + 掠夺战利品 + 全军驻扎；
//     失败则各营 50% 概率被歼，幸存者撤回母星。
//   * 取消任务 / 解散编队 → 部队原地下船，回到出发星球（planetCode 未曾改动）。

/** 在星球守军强度系数表中查找星球定义（PLANETS / 已发现 / 已占领 三处） */
export function findPlanetDef(acc, code) {
  if (!code) return null;
  let p = PLANETS.find((x) => x && x.code === code) || null;
  if (p) return p;
  const disc = (acc && Array.isArray(acc.discovered) ? acc.discovered : [])
    .find((x) => x && x.code === code);
  if (disc) return disc;
  const cap = (acc && Array.isArray(acc.capturedPlanets) ? acc.capturedPlanets : [])
    .find((x) => x && x.code === code);
  return (cap && cap.planet) || null;
}

/** 星球是否已在玩家版图内（母星 / 已占领；商店星不算） */
function isOwnedPlanetCode(acc, code) {
  if (!acc || !code) return false;
  if (code === acc.homePlanetCode) return true;
  return (Array.isArray(acc.capturedPlanets) ? acc.capturedPlanets : [])
    .some((c) => c && c.code === code && !c.isShop && !(c.planet && c.planet.isShop));
}

/**
 * 由星球定义推算地面守军规模（登陆战敌方战力）。
 * 口径：四层矿脉丰度之和 × 150 + 大气丰度 × 80 + 底数 600；
 * 默认星球（母星系七球，原设有常驻居民与设施）再 + 1200；最后乘 0.85~1.15 的随机扰动。
 * 丰度量级参考：随机星球四层合计丰度约 20~400，对应守军 3600 ~ 66000，属终局玩法难度。
 */
export function garrisonPowerOf(planetDef) {
  if (!planetDef) return 0;
  let res = 0;
  const layers = planetDef.layers || {};
  for (const k of ['surface', 'underground', 'deep', 'core']) {
    const rows = Array.isArray(layers[k]) ? layers[k] : [];
    res += rows.reduce((s, r) => s + (Number(r && r.abundance) || 0), 0);
  }
  let gas = 0;
  if (Array.isArray(planetDef.gases)) {
    gas = planetDef.gases.reduce((s, g) => s + (Number(g && g.abundance) || 0), 0);
  }
  const base = 600 + res * 150 + gas * 80 + (planetDef.random ? 0 : 1200);
  return Math.max(120, Math.round(base * (0.85 + Math.random() * 0.3)));
}

/** 守军规模侦察预估区间（±25%，供登陆前的情报展示） */
export function estimateGarrisonOf(planetDef) {
  if (!planetDef) return { min: 0, max: 0 };
  let res = 0;
  const layers = planetDef.layers || {};
  for (const k of ['surface', 'underground', 'deep', 'core']) {
    const rows = Array.isArray(layers[k]) ? layers[k] : [];
    res += rows.reduce((s, r) => s + (Number(r && r.abundance) || 0), 0);
  }
  let gas = 0;
  if (Array.isArray(planetDef.gases)) {
    gas = planetDef.gases.reduce((s, g) => s + (Number(g && g.abundance) || 0), 0);
  }
  const base = 600 + res * 150 + gas * 80 + (planetDef.random ? 0 : 1200);
  return { min: Math.max(120, Math.round(base * 0.85)), max: Math.round(base * 1.15) };
}

/** 某编队当前搭载的全部部队 */
export function embarkedArmiesOf(acc, fleetId) {
  if (!acc || !Array.isArray(acc.armies) || !fleetId) return [];
  return acc.armies.filter((a) => a && a.embarkFleet === fleetId);
}

/** 释放（原地下船）某编队搭载的全部部队；返回释放数量 */
export function releaseEmbarkedArmies(acc, fleetId) {
  if (!acc || !Array.isArray(acc.armies) || !fleetId) return 0;
  let n = 0;
  for (const a of acc.armies) {
    if (a && a.embarkFleet === fleetId) {
      delete a.embarkFleet;
      n++;
    }
  }
  return n;
}

/** 登陆目标候选列表（母星 / 已占领 / 已发现且未占领；商店星排除）。UI 下拉数据源 */
export function listLandTargets(acc) {
  const out = [];
  const seen = new Set();
  const push = (code, nameCn, type, owned) => {
    if (!code || seen.has(code) || code === 'ast1') return;
    seen.add(code);
    out.push({ code, nameCn, type, owned });
  };
  if (acc) {
    const home = PLANETS.find((p) => p && p.code === acc.homePlanetCode);
    if (home) push(home.code, home.nameCn, home.type, true);
    for (const c of (Array.isArray(acc.capturedPlanets) ? acc.capturedPlanets : [])) {
      if (!c) continue;
      push(c.code, c.nameCn || c.code, (c.planet && c.planet.type) || c.type || '', true);
    }
    for (const d of (Array.isArray(acc.discovered) ? acc.discovered : [])) {
      if (!d) continue;
      push(d.code, d.nameCn || d.code, d.type || '', false);
    }
  }
  return out;
}

/** 登陆任务结算（tick 到期由 finishMission 调用） */
function settleLand(acc, fleet, m, env) {
  const homeCode = (acc && acc.homePlanetCode) || 'syl';
  const targetCode = m.targetCode;
  // 搭载名单以 embarkFleet 实际标记为准（cmd.armyIds 只作兜底）
  let armies = (Array.isArray(acc.armies) ? acc.armies : [])
    .filter((a) => a && a.embarkFleet === fleet.id);
  if (!armies.length && m.cmd && Array.isArray(m.cmd.armyIds)) {
    armies = m.cmd.armyIds
      .map((id) => (Array.isArray(acc.armies) ? acc.armies : []).find((x) => x && x.id === id))
      .filter(Boolean);
  }
  if (!armies.length) {
    return { ok: true, kind: 'info', message: '登陆编队抵达目标空域，但舰上已没有任何部队（可能已被解散）。' };
  }

  const def = findPlanetDef(acc, targetCode);
  if (!def) {
    // 目标定义丢失（存档损坏等）：全军原路撤回，不白白送死
    for (const a of armies) { delete a.embarkFleet; a.stationed = true; }
    return { ok: true, kind: 'info', message: '登陆目标「' + targetCode + '」坐标失效，舰队已原路返航，各营归建。' };
  }

  // —— 换防：目标已是己方星球 ——
  if (isOwnedPlanetCode(acc, targetCode)) {
    for (const a of armies) {
      a.planetCode = targetCode;
      a.stationed = true;
      delete a.embarkFleet;
    }
    return {
      ok: true, kind: 'info', owned: true,
      message: '登陆编队已抵达「' + (def.nameCn || targetCode) + '」，'
        + armies.length + ' 个营完成换防，全部进入驻防状态。',
    };
  }

  // —— 登陆战：目标为未知星球 ——
  const attack = armies.reduce((s, a) => s + ((a.stats && a.stats.power) || 0), 0);
  const garrison = garrisonPowerOf(def);
  const win = attack >= garrison;

  if (win) {
    // 占领：走 planetgen 的标准占领契约（写 capturedPlanets；商店星等非法目标会被拒绝）
    const cap = capturePlanet(acc, def);
    for (const a of armies) {
      a.planetCode = targetCode;
      a.stationed = true;
      delete a.embarkFleet;
    }
    // 战利品：太空元素 + 从目标星球地表矿脉掠夺 2 种（数量与丰度挂钩）
    const loot = { '太空元素': 150 };
    const surface = (def.layers && Array.isArray(def.layers.surface)) ? def.layers.surface : [];
    const picks = surface.slice().sort((a, b) => (Number(b.abundance) || 0) - (Number(a.abundance) || 0))
      .slice(0, 2);
    for (const r of picks) {
      const qty = Math.max(50, Math.round((Number(r.abundance) || 1) * 60));
      loot[r.name] = qty;
    }
    grantRewards(acc, env, loot);
    // v0.2.3：登陆战胜利 60% 概率缴获 1~2 件敌方军事部件（入母星装备库，可用于整编新部队）
    let captureText = '';
    if (Math.random() < 0.6 && Array.isArray(ARMY_PARTS) && ARMY_PARTS.length) {
      const home = getPlanetInstance(acc.homePlanetCode || 'syl');
      if (home) {
        const n = 1 + (Math.random() < 0.4 ? 1 : 0);
        const got = [];
        for (let i = 0; i < n; i++) {
          const p = ARMY_PARTS[Math.floor(Math.random() * ARMY_PARTS.length)];
          if (!p) continue;
          const mat = (p.inputs && Object.keys(p.inputs)[0]) || '钢';
          addEquipment(home, p.id, mat, 1);
          const ref = ARMY_PART_BY_ID[p.id];
          got.push((ref ? ref.nameCn : p.id) + '（' + mat + '）');
        }
        if (got.length) captureText = '，另从守军军械库缴获 ' + got.join('、') + ' 各 1 件';
      }
    }
    const lootText = Object.keys(loot).map((k) => k + ' ×' + fmtNum(loot[k])).join('、');
    return {
      ok: true, kind: 'combat', win: true, owned: true, planet: def, rewards: loot,
      combat: { enemyNameCn: '「' + (def.nameCn || targetCode) + '」地面守军', enemyPower: garrison, ourPower: attack, win: true },
      message: '登陆战胜利！我方 ' + armies.length + ' 个营（战力 ' + fmtNum(attack) + '）'
        + '击溃「' + (def.nameCn || targetCode) + '」地面守军（战力 ' + fmtNum(garrison) + '），'
        + '星球已纳入版图，缴获 ' + lootText + captureText + '，全军就地驻防。',
      losses: [],
      captureFailed: cap.ok === false ? cap.reason : null,
    };
  }

  // 战败：各营 50% 概率被歼，幸存者撤回母星
  const armiesAll = Array.isArray(acc.armies) ? acc.armies : [];
  const losses = [];
  const survivors = [];
  for (const a of armies) {
    if (Math.random() < 0.5) {
      losses.push(a.nameCn);
      const i = armiesAll.indexOf(a);
      if (i >= 0) armiesAll.splice(i, 1);
    } else {
      a.planetCode = homeCode;
      a.stationed = true;
      delete a.embarkFleet;
      survivors.push(a.nameCn);
    }
  }
  return {
    ok: true, kind: 'combat', win: false,
    combat: { enemyNameCn: '「' + (def.nameCn || targetCode) + '」地面守军', enemyPower: garrison, ourPower: attack, win: false },
    message: '登陆战失败……我方 ' + armies.length + ' 个营（战力 ' + fmtNum(attack) + '）'
      + '强攻「' + (def.nameCn || targetCode) + '」（守军战力 ' + fmtNum(garrison) + '）受挫，'
      + (losses.length ? '「' + losses.join('」「') + '」被歼；' : '')
      + (survivors.length ? '幸存部队已撤回母星整补。' : '全军覆没。'),
    losses,
  };
}

/** 旧指令接口保留 land 的即时提示（真实入口是 startMission('land') + 舰队面板弹窗） */
function cmdLand() {
  return { ok: false, cmd: 'land', reason: '登陆已改为持续任务：请用舰队面板的「登陆」弹窗选择目标与部队发起。' };
}

/**
 * 旧指令接口（兼容保留）。v0.1.1 起 explore / transport / patrol / defense 已改为
 * 持续任务（startMission + tickFleetMissions），这里只保留 land 的即时答复，
 * 其余指令提示改走任务接口。
 *   cmd ∈ 'explore' | 'defense' | 'patrol' | 'transport' | 'land'
 *   ctx = { planetCode?, targetPlanetCode?, cargo? }
 */
export function executeCommand(acc, fleetId, cmd, ctx) {
  ctx = ctx || {};
  const fleet = listFleets(acc).find((f) => f.id === fleetId);
  if (!fleet) return { ok: false, cmd, message: '找不到该编队' };
  if (!fleet.shipIds.length) return { ok: false, cmd, message: '空编队无法执行指令，请先加入飞船' };
  if (cmd === 'land') {
    const res = cmdLand(acc, fleet, ctx);
    if (res.ok) {
      fleet.command = cmd;
      fleet.lastResult = { cmd, kind: res.kind || 'info', message: res.message, at: Date.now() };
    }
    return res;
  }
  return {
    ok: false, cmd,
    message: '「' + (MISSION_TYPE_LABEL[cmd] || cmd) + '」已改为持续任务：请从舰队面板发起，任务完成后自动结算。',
  };
}

// ============================================================================
// 运输执行（由 UI / state 在运输船到位后调用，真正搬物资）
// ============================================================================
// 这里不 import state.js 的实例读取，改用调用方传入的「取货 / 卸货」回调，
// 保证本模块不依赖星球实例的具体形状。
export function performTransport(fromInst, toInst, cargo, ensure) {
  const moved = {};
  for (const mat in cargo) {
    const want = Number(cargo[mat]) || 0;
    if (!(want > 0)) continue;
    const have = ownedOf(fromInst, mat);
    const take = Math.min(have, want);
    if (take <= 0) continue;
    spendOwned(fromInst, mat, take);
    const e = ensure(toInst, mat);
    if (e) e.owned = Math.max(0, (Number(e.owned) || 0) + take);
    moved[mat] = take;
  }
  return moved;
}

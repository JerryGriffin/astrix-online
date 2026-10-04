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

import { PLANETS } from '../data/planets.js?v=45.10';
import {
  generateRandomPlanet, capturePlanet, captureDefaultPlanet, uncapturedDefaults,
} from './planetgen.js?v=45.10';
import { ownedOf, spendOwned, getPlanetInstance } from './state.js?v=45.10';
import { shipArmyOf } from './army.js?v=45.10';   // v0.2.10 军队/舰队飞船互斥（army 不 import 本文件，无环）
import { CELL_VOLUME, cellsForEquipmentKey } from './footprint.js?v=45.10';   // 纯聚合工具，state.js 不 import 本文件，无环
import { resolveBlueprint, totalMass } from './shipyard.js?v=45.10';          // 只读导出：蓝图部件 / 蓝图质量
import { ensureEntry } from './production.js?v=45.10';                        // 装卸货 / 奖励入包（生产模块不 import 本文件，无环）
import { fmtNum } from './format.js?v=45.10';

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

/**
 * v0.4.5（需求 5「运输物资时不必非要运输船」）：
 *   旧实现只有「运输船」（kind==='freighter' 或名字含「运输」）才能带货，
 *   玩家造了护卫舰/驳船却**完全无法运输**，必须专门再造一艘运输船。
 *   现在：**任何有货舱的船都能带货**；若编队里一艘有货舱的都没有，
 *   也允许用任意舰船临时搭载（小额货舱），运输不再被舰型硬卡死。
 *   运输船依然更划算（货舱大得多），但不再是唯一选择。
 */
export const GENERIC_CARGO_CELLS = 5;      // 非运输船临时搭载的兜底货舱（格）
function cargoCellsOfShip(acc, ship) {
  if (!ship) return 0;
  const bps = Array.isArray(acc && acc.blueprints) ? acc.blueprints : [];
  const bp = bps.find((b) => b && b.id === ship.blueprintId);
  const cap = Number(bp && bp.capacity) || 0;
  return cap > 0 ? Math.max(1, Math.ceil(cap / CELL_VOLUME)) : 0;
}

/** 编队载货能力（格）：运输船与任何有货舱的船都计入 */
export function fleetCargoCells(acc, fleet) {
  if (!fleet) return 0;
  let cells = 0;
  let anyReal = false;
  for (const id of fleet.shipIds) {
    const s = shipById(acc, id);
    if (!s) continue;
    const cap = cargoCellsOfShip(acc, s);
    if (cap > 0) { cells += cap; anyReal = true; }
    else if (isFreighter(acc, s)) { cells += 10; anyReal = true; }  // 缺信息的运输船兜底 10 格
  }
  // 一艘带货舱的都没有 → 允许任意舰船临时搭载（不再硬性要求运输船）
  if (!anyReal) {
    for (const id of fleet.shipIds) {
      if (shipById(acc, id)) { cells += GENERIC_CARGO_CELLS; break; }
    }
  }
  return cells;
}

// ============================================================================
// 持续任务（v0.1.1 需求 A）
// ============================================================================
/** 各任务类型的固定航程（单位与速度同刻度：m 与 m/s），duration = 距离 / 编队速度 */
// v0.1.2 R6：探索航程 ×5（60000 → 300000），时长 clamp 上限 1800s → 9000s、下限 30s → 150s
export const MISSION_DISTANCE = { explore: 300000, transport: 36000, patrol: 24000 };
const MISSION_MIN_SEC = 150;
const MISSION_MAX_SEC = 9000;

// 探索燃料系数（mol / m）：出发前按 dist × 本系数预扣编队每艘船燃料（R6）。
// 自校准依据：ui/shipyard.js:787 加注燃料输入框默认一次填 1000 mol，即「一箱燃料 ≈ 1000 mol」；
// 需求要求单次探索消耗 ≈ 一箱的 20%~50%。取 36% → 360 mol。
// 探索距离 300000 m ⇒ EXPLORE_FUEL_PER_DIST = 360 / 300000 = 0.0012 mol/m（每船）。
export const EXPLORE_FUEL_PER_DIST = 0.0012;
const MISSION_TYPES = ['explore', 'transport', 'patrol', 'defense'];
const MISSION_TYPE_LABEL = { explore: '探索', transport: '运输', patrol: '巡航', defense: '低空防卫' };

/** 任务中文名 + 目标（UI 展示用） */
export function fleetMissionLabel(mission) {
  if (!mission) return '';
  const t = MISSION_TYPE_LABEL[mission.type] || mission.type;
  if (mission.type === 'defense') return t + '（驻留）';
  if (mission.type === 'transport') return t + ' → ' + (mission.targetCode || '?');
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
    // 校验沿用原 cmdTransport：有货 + 目的地 + 载货格数够。
    // v0.4.5（需求 5）：**不再硬性要求运输船** —— 有货舱的船都能带；
    //   若一艘都没有，fleetCargoCells 会给一个临时搭载的兜底货舱。
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
        reason: '载货空间不足：需要 ' + need + ' 格，编队只有 ' + cap + ' 格（可多编入几艘有货舱的船）',
      };
    }
    cmd = { cargo: goods, fromCode: fleet.homePlanetCode, toCode: targetCode, cells: need, capacity: cap, fromShips };
  }

  // 探索任务：出发前按距离预扣编队燃料（R6）。改为编队共享油箱（总量口径）：
  // 只要编队总燃料 >= 总需求即放行；逐船顺序扣减，不足部分顺延到下一艘，杜绝负数燃料。
  if (type === 'explore') {
    const needPerShip = Math.round(MISSION_DISTANCE.explore * EXPLORE_FUEL_PER_DIST);   // 取整恢复 360 精确值（避浮点残差）
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

/** 取消任务：进度作废。驻留防卫也由此结束 */
export function cancelMission(acc, fleetId) {
  const fleet = listFleets(acc).find((f) => f.id === fleetId);
  if (!fleet) return { ok: false, reason: '找不到该编队' };
  if (!fleet.mission) return { ok: false, reason: '该编队没有进行中的任务' };
  const label = fleetMissionLabel(fleet.mission);
  fleet.mission = null;
  fleet.lastResult = { cmd: null, kind: 'info', message: '任务「' + label + '」已取消（进度作废）。', at: Date.now() };
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
    out.rewards = { '太空元素': 30 };
    grantRewards(acc, env, out.rewards);
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
  return out;
}

/** 登陆：军队系统未完成 */
function cmdLand(acc, fleet, ctx) {
  return { ok: false, cmd: 'land', reason: '军队系统开发中，登陆需要陆军部队（后续版本开放）' };
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
    message: '「' + (MISSION_TYPE_LABEL[cmd] || cmd) + '」已改为持续任务：请用 startMission 发起，任务完成自动结算。',
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

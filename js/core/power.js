// 电力核心逻辑（Astrix v0.0.6，零依赖原生 ES module）
//
// v0.1.0 关键改动（建筑数据在 js/data/buildings.js）：
//   1. 发电统一乘 buildingCountBonus（建筑越多，发电厂/生产厂单座效率越高，上限 +50%）——
//      与 production.js 的 efficiencyBonus（生产专用，上限 +25%）是两个独立加成。
//   2. 非加工建筑耗电改为「按在岗人数分摊」（powerDraw × 用工率），不再按座数计；
//      加工建筑保持「运转中的生产线条数 × powerDraw」不变。
//   3. storageRate（充电）/ storageDraw（放电）速率上限夹到 500，避免巨量盈余/缺口时单 tick 飙升。
//
// 职责：星球能量池管理、设施槽位、设施安装/拆除、电力结算（发电/耗电/降速比）、
//       能量推进（太阳辐射回充 + 清洁能源扣减 + 储电结算 + 火力燃料燃烧）。
//
// 重要：本模块**不 import state.js**（state.js 会 import 本模块，互相 import 会成环）。
// 所有星球实例数据（inst.buildings / inst.pop / inst.inventory / inst.facilities / 静态 inst.power）
// 都直接从传入的 inst 对象上读；建筑表来自 '../data/buildings.js?v=54.5'（纯数据，无环）。

import { BUILDING_BY_ID } from '../data/buildings.js?v=54.5';
import { POWER_FACILITY_BY_ID } from '../data/facilities.js?v=54.5';
import { RECIPES } from '../data/recipes.js?v=54.5';
import { jobsOfBuilding, jobOutput, assignedToBuilding, buildingSlots } from '../core/population.js?v=54.5';
import { facilityStockOf, linesOf } from './production.js?v=54.5';
// v0.1.2（需求 18/19）：永久升级「发电效率」的乘方效果，唯一实现在 data/upgrades.js#upgradeMul
import { upgradeMul } from '../data/upgrades.js?v=54.5';

// ============================================================================
// v0.0.7：玩家在制造车间为设施选定的「燃料 / 板面材料」
// ============================================================================
// 设计者要求：
//   ① 太阳能板类制造时可选板面建材（二氧化硅 / 铜 / 银 / 金），**效率不同**；
//   ② 超大型燃机可以燃烧除核燃料外的所有燃料。
// 选择发生在制造阶段（生产线选材料），结果记录在星球实例上：
//   inst.facilityPanelMat = { solar_s: '铜', … }   该类光伏的板面材料
//   inst.facilityFuel     = { thermal_l: '氢气', … } 该类燃机的燃料
// 两者都按「设施 id」记账（同类型设施共用同一个选择），未选时回退设施表默认值。
export function panelEffOf(inst, f) {
  const opts = (f && f.panelOptions) || [];
  if (!opts.length) return 1;
  const chosen = inst && inst.facilityPanelMat ? inst.facilityPanelMat[f.id] : null;
  const hit = opts.find((o) => o && o.mat === chosen);
  return hit ? (Number(hit.eff) || 1) : 1;
}
export function facilityFuelOf(inst, f) {
  if (!f) return null;
  const chosen = inst && inst.facilityFuel ? inst.facilityFuel[f.id] : null;
  if (chosen && (!Array.isArray(f.fuelWhitelist) || f.fuelWhitelist.includes(chosen))) return chosen;
  return f.fuel || null;
}

// 转出自生产模块提供的设施库存访问器（UI 也从这里取，契约要求 power.js 导出它）。
export { facilityStockOf };

// ---------- 通用工具 ----------
function num(v, d = 0) {
  const n = Number(v);
  return Number.isFinite(n) ? n : d;
}
function clamp(v, lo, hi) {
  return Math.max(lo, Math.min(hi, v));
}

// 读星球静态电力数据 { totalEnergy, hydro, wind, solar }。
// 注意：inst.power 永远是星球静态数据（由 getPlanetInstance 从 planets.js 展开）；
// state.js 把结算结果写到 inst.powerInfo，不会覆盖 inst.power，因此这里直接读即可，
// 不缓存、不写任何副本，避免与 planets.js 脱节。
function getStatic(inst) {
  const p = (inst && inst.power) || {};
  if (Number.isFinite(p.totalEnergy)) return p;
  return { totalEnergy: 0, hydro: 0, wind: 0, solar: 0 };
}

function fuelOwnedOf(inst, fuelName) {
  const inv = inst.inventory || [];
  const e = inv.find((x) => x && x.mat === fuelName);
  return e ? num(e.owned, 0) : 0;
}

// 有配方的建筑 = 「加工建筑」，它们的耗电与运转状态由生产线决定（v0.0.7）
const HAS_RECIPE_BUILDING = new Set(RECIPES.map((r) => r.buildingId));

// 安全取某建筑的有效人力（人数 × 强度产出倍率），pop 缺失时返回 0。
function laborOf(pop, buildingId) {
  if (!pop) return 0;
  let labor = 0;
  for (const j of jobsOfBuilding(buildingId)) labor += jobOutput(pop, j.id);
  return labor;
}

// ============================================================================
// v0.1.0：建筑数量发电加成（发电专用，独立于 production.js 的效率加成）
// ============================================================================
// 设计者原话：「增加建筑数目也可以增加发电厂和生产厂的单个效率」。
// 口径：1 + min(0.5, 0.01 × 已建成建筑总座数)
//   —— 每多建 1 座建筑，发电倍率 +1%，最多 +50%（约 50 座封顶）。
// 【与 efficiencyBonus 是两个独立加成】
//   production.js 的 efficiencyBonus 也是「每座 +1%、上限 +25%」，但只作用于**生产**；
//   这里是**发电**专用倍率，两者叠加（建得多既产得快也发得多）。
//   注意：本函数只数建筑总座数，不区分类型——任何建筑都算数。
export function buildingCountBonus(inst, acc) {
  const counts = (inst && inst.buildings) || {};
  let total = 0;
  for (const k in counts) total += Number(counts[k]) || 0;
  // v0.1.2（需求 19）：接上「发电效率」永久升级（乘方效果，见 core/upgradefx.js）。
  //   传 acc 才乘——UI 与 core 都从这里取，口径永远一致；
  //   不传 acc 时保持原行为，老调用点不会突然变数。
  return (1 + Math.min(0.5, 0.01 * total)) * (acc ? upgradeMul(acc, 'upg_power') : 1);
}

// ============================================================================
// 1.1 星球能量池（惰性初始化）
// ============================================================================
export function energyOf(inst) {
  if (!inst) return { total: 0, max: 0, stored: 0 };
  if (!inst.energy || typeof inst.energy !== 'object') {
    const sp = getStatic(inst);
    const max = num(sp.totalEnergy, 0);
    inst.energy = { total: max, max, stored: 0 };
  }
  const e = inst.energy;
  if (!Number.isFinite(e.total)) e.total = num(e.max, 0);
  if (!Number.isFinite(e.max)) e.max = 0;
  if (!Number.isFinite(e.stored)) e.stored = 0;
  return e;
}

// ============================================================================
// 2. 设施安装（v0.0.91 起：星球侧无槽位上限）
// ============================================================================
// v0.0.91：电力设施在**星球上可以任意安装**，不再受「储电站数量 × 每座槽位」的限制。
//   储电站（storage_plant）已改为「单纯电池」——只提供储电上限（storagePerBuilding），
//   不再提供任何设备安装位。安装的唯一前提是：该设施已在建造车间生产出来
//   （inst.facilityStock[fid] >= 1，installFacility 从库存扣 1）。
//   ⚠ 飞船侧仍按 footprint 占地限制（由 js/core/shipyard.js 负责，本模块不动）。
//
// 「设施槽」概念自 v0.0.91 起作废。为兼容遗留调用，facilitySlots 恒返回 Infinity
// （星球侧无上限）；飞船占地请用 shipyard.js 的 footprint 接口。
export function facilitySlots(inst) {
  return Infinity;
}

// 已装设施座数 = 所有已装设施座数之和（仅作展示统计用，v0.0.91 起不再用于安装门槛）。
export function usedSlots(inst) {
  const f = (inst && inst.facilities) || {};
  let s = 0;
  for (const k in f) s += Math.max(0, Math.floor(num(f[k], 0)));
  return s;
}

export function freeSlotsPower(inst) {
  return Math.max(0, facilitySlots(inst) - usedSlots(inst));
}

export function installedFacilities(inst) {
  return (inst && inst.facilities) || {};
}

// ============================================================================
// 3. 安装 / 拆除设施
// ============================================================================
export function installFacility(inst, facilityId, acc) {
  if (!inst) return { ok: false, reason: '星球实例缺失。' };
  const fac = POWER_FACILITY_BY_ID[facilityId];
  if (!fac) return { ok: false, reason: '设施不存在：' + facilityId };

  // v0.0.91：星球侧安装**不再校验槽位**——电力设施在星球上任意安装（飞船侧才按 footprint 限制）。
  //   储电站只是电池，不提供任何安装位。

  // 库存校验：设施需在建造车间生产，安装时从 inst.facilityStock 扣 1
  //    （允许小数进度，UI 用 Math.floor 展示；此处按整座判定）
  const stock = facilityStockOf(inst);
  if (Math.floor(num(stock[facilityId], 0)) < 1) {
    return { ok: false, reason: '库存不足：请先在建造车间生产「' + fac.nameCn + '」' };
  }

  // 扣库存、装设施（不再扣材料——造价与工作量已在建造车间付过）
  stock[facilityId] = num(stock[facilityId], 0) - 1;
  if (stock[facilityId] <= 0) delete stock[facilityId];
  if (!inst.facilities || typeof inst.facilities !== 'object') inst.facilities = {};
  inst.facilities[facilityId] = (inst.facilities[facilityId] || 0) + 1;
  return { ok: true };
}

// 减座数（减到 0 删键）并把该设施退回 inst.facilityStock。返回是否成功。
export function uninstallFacility(inst, facilityId) {
  if (!inst || !inst.facilities) return false;
  const cnt = inst.facilities[facilityId];
  if (!cnt || cnt <= 0) return false;
  // 设施座数 -1（减到 0 删键）
  inst.facilities[facilityId] = cnt - 1;
  if (inst.facilities[facilityId] <= 0) delete inst.facilities[facilityId];
  // 退回库存（不再退材料——拆除只归还已造好的设施）
  const stock = facilityStockOf(inst);
  stock[facilityId] = num(stock[facilityId], 0) + 1;
  return true;
}

// ============================================================================
// 4. 电力结算（只读推算，每 tick 由 state.js 调一次）
// ============================================================================
// 返回 { gen, draw, ratio, storage, storageMax, storageRate, storageDraw, cleanDraw, fuelShort }
//   gen         总发电/秒（人力发电厂 + 设施发电）
//   draw        总耗电/秒（正在运转的耗电建筑）
//   ratio       = clamp(usable / draw, 0, 1)；draw=0 时恒为 1
//   storage     当前储电量（inst.energy.stored）
//   storageMax  储电上限（电池设施提供）
//   storageRate 净充放电速率（正=在充，负=在放）
//   storageDraw 本 tick 可由储能补齐的缺口速率（供 tickPower 用，已按 stored 封顶）
//   cleanDraw   本 tick 清洁设施（solar/wind）将从能量池抽取的预估值/秒
//   fuelShort   火力设施燃料不足标记
export function computePower(inst, acc) {
  if (!inst) {
    return {
      gen: 0, draw: 0, ratio: 1, storage: 0, storageMax: 0,
      storageRate: 0, storageDraw: 0, cleanDraw: 0, fuelShort: false,
    };
  }
  energyOf(inst);
  const sp = getStatic(inst);
  const pop = inst.pop;
  const buildings = inst.buildings || {};
  const facilities = inst.facilities || {};
  const recipes = inst.recipes || null;

  // ---- 发电：人力发电厂 / 其它 powerOut>0 的建筑 ----
  // v0.1.0：所有发电（建筑 + 设施）统一乘 buildingCountBonus——
  //   设计者要求「建筑越多，发电厂与生产厂的单个效率也提高」。电力设施（电池/光伏/风力/燃机）
  //   同为发电来源，一并乘，保持发电口径一致。
  const genBonus = buildingCountBonus(inst, acc);
  let gen = 0;
  for (const b of Object.values(BUILDING_BY_ID)) {
    if (!b || !(b.powerOut > 0)) continue;
    const n = num(buildings[b.id], 0);
    if (n <= 0) continue;
    if (Number(b.jobs) === 0) {
      // v0.0.8：没有工位的建筑（如房屋 powerOut=12）按座数发电，不依赖人力——
      // 否则房屋 jobs=0 会导致 laborOf=0，发电恒为 0，违背「房屋每座发 12 电」。
      gen += b.powerOut * n * genBonus;
    } else {
      gen += laborOf(pop, b.id) * b.powerOut * genBonus;
    }
  }

  // ---- 发电：已装设施 ----
  let fuelShort = false;
  for (const fid in facilities) {
    const cnt = num(facilities[fid], 0);
    if (cnt <= 0) continue;
    const f = POWER_FACILITY_BY_ID[fid];
    if (!f || f.kind === 'storage') continue;
    if (f.kind === 'solar') {
      // v0.0.7：板面材料影响效率（二氧化硅 1.0 / 铜 1.3 / 银 1.7 / 金 2.2）
      gen += num(f.powerOut, 0) * cnt * num(sp.solar, 0) * panelEffOf(inst, f) * genBonus;
    } else if (f.kind === 'wind') {
      gen += num(f.powerOut, 0) * cnt * num(sp.wind, 0) * genBonus;
    } else if (f.kind === 'thermal') {
      // v0.0.7：燃料由玩家选定（超大型燃机可选除核燃料外的任何燃料）
      const fuelName = facilityFuelOf(inst, f);
      const owned = fuelOwnedOf(inst, fuelName);
      if (owned > 1e-9) {
        gen += num(f.powerOut, 0) * cnt * genBonus;
        if (owned < num(f.fuelPerSec, 0) * cnt) fuelShort = true; // 储备不足 1 秒
      } else {
        fuelShort = true; // 完全没有燃料，该设施不发电
      }
    }
  }

  // ---- 耗电：只统计「正在运转」的耗电建筑 ----
  // 两种口径（设计者 v0.1.0 明确区分）：
  //   * 加工建筑（HAS_RECIPE_BUILDING）：按「运转中的生产线条数 × powerDraw」——
  //     每条运转的线代表一个独立工序，付费按工序数而非人数（见下分支）。
  //   * 非加工建筑（科研所 / 矿井 / 农田 / 房屋 / 储电站 / 建筑工厂 / 人力发电厂等
  //     没有生产线的）：v0.1.0 改为「按在岗人数分摊耗电」，而非旧版「按座数计」。
  //     —— 设计者原话：「非生产线的建筑，按工作人数耗电，而非按每个建筑耗电」。
  //     理由：非加工建筑没有生产线概念，耗电由「有人值守」决定。按座数计会让
  //     「建了没人开」的空楼白白耗电；按人数计则「没人=不耗电」，更贴合
  //     「建筑要人开动才用电」的直觉，也避免玩家被一堆空置楼的待机功耗拖垮。
  //     公式：draw = powerDraw ×（在岗人数 / 工位总数）。
  //       工位总数 = 座数 × 每座工位（buildingSlots）；
  //       在岗人数 = 该建筑下所有职业已指派人数之和（assignedToBuilding）。
  //       座数 0 → 循环已 filter；在岗 0 → 用工率 0 → 耗电 0（没人开机不耗电）。
  //       用工率不封顶到 1：岗位在分配时已按工位夹取，人不会超过工位，故实际 ≤ 1。
  let draw = 0;
  for (const id in buildings) {
    const b = BUILDING_BY_ID[id];
    if (!b) continue;
    const n = num(buildings[id], 0);
    if (n <= 0 || !(b.powerDraw > 0)) continue;

    if (HAS_RECIPE_BUILDING.has(id)) {
      // v0.0.8：加工建筑改为按生产线耗电，一条运转中的线收一次 powerDraw。
      // 「运转中」= 该线 workers > 0（由 production.js 的 linesOf 判定）。
      const runningLines = linesOf(inst, id)
        .filter((l) => l && (Number(l.workers) || 0) > 0).length;
      draw += runningLines * b.powerDraw;
      continue;
    }

    // 非加工建筑：按用工率分摊（v0.1.0）。
    const slots = buildingSlots(id, buildings);     // = 座数 × 每座工位
    const onJob = assignedToBuilding(pop, id);      // 该建筑下所有职业已指派人数之和
    const util = slots > 0 ? onJob / slots : 0;      // 用工率；slots=0 视为 0（避免除零）
    draw += b.powerDraw * util;
  }

  // ---- 储电上限（电池设施 + 储电站本身提供） ----
  // v0.0.8：储电站本质是「大容量电池」，每座由 data/buildings.js 的 storagePerBuilding
  //   （v0.1.0 起为 1e5，原为 1e7）提供储电上限；字段不存在时按 0 处理，老存档安全。
  let storageMax = 0;
  for (const fid in facilities) {
    const cnt = num(facilities[fid], 0);
    if (cnt <= 0) continue;
    const f = POWER_FACILITY_BY_ID[fid];
    if (f && f.kind === 'storage') storageMax += num(f.capacity, 0) * cnt;
  }
  // 储电站每座提供的储电上限（storagePerBuilding），与电池设施累加
  {
    const spCnt = num(buildings['storage_plant'], 0);
    const spDef = BUILDING_BY_ID['storage_plant'];
    const spPer = (spDef && Number.isFinite(Number(spDef.storagePerBuilding)))
      ? Number(spDef.storagePerBuilding) : 0;
    storageMax += spCnt * spPer;
  }
  const storage = num((inst.energy && inst.energy.stored), 0);

  // ---- 缺电降速比：先考虑可用储能 ----
  let ratio = 1;
  let storageDraw = 0;
  if (draw <= 0) {
    ratio = 1;
  } else {
    const deficit = Math.max(0, draw - gen);
    // v0.1.0：放电速率上限夹到 500（盈余/缺口巨大时，单 tick 充放电速率不应无量纲飙升）。
    //   口径：放电速率 = min(500, min(储能余额 stored, 缺口 deficit))；
    //   缺口为 0（即 gen>=draw，正在充电）时放电速率为 0。
    storageDraw = deficit > 0 ? Math.min(500, Math.min(storage, deficit)) : 0;
    const usable = gen + storageDraw;
    ratio = clamp(usable / draw, 0, 1);
  }
  // v0.1.0：充电速率（gen-draw 为正时）上限夹到 500；为负时保持负值表示正在放电。
  //   口径：storageRate = min(500, gen - draw)。注意 tickPower 实际充放电按 surplus×dt 与
  //   storageMax 结算，这里的 storageRate / storageDraw 仅作 UI 展示与缺电降速比推算。
  const storageRate = Math.min(500, gen - draw);

  // ---- 清洁能源（solar/wind 设施）将从星球能量池抽取的预估值/秒 ----
  // v0.1.0：cleanDraw 与 gen 同样乘发电加成，保持「实际发电量」与「能量池扣减量」一致。
  const cleanBonus = buildingCountBonus(inst, acc);
  let cleanDraw = 0;
  for (const fid in facilities) {
    const cnt = num(facilities[fid], 0);
    if (cnt <= 0) continue;
    const f = POWER_FACILITY_BY_ID[fid];
    if (!f) continue;
    if (f.kind === 'solar') cleanDraw += num(f.powerOut, 0) * cnt * num(sp.solar, 0) * cleanBonus;
    else if (f.kind === 'wind') cleanDraw += num(f.powerOut, 0) * cnt * num(sp.wind, 0) * cleanBonus;
  }

  return { gen, draw, ratio, storage, storageMax, storageRate, storageDraw, cleanDraw, fuelShort };
}

// ============================================================================
// 5. 推进能量（太阳辐射回充 + 清洁能源扣减 + 储电结算 + 火力燃烧）
// ============================================================================
// dt <= 0 直接返回。所有数值均 Finite 兜底，绝不允许 NaN 污染存档。
export function tickPower(inst, dt, acc) {
  dt = num(dt, 0);
  if (!inst || dt <= 0) return { cleanDraw: 0 };

  const energy = energyOf(inst);
  const sp = getStatic(inst);
  const facilities = inst.facilities || {};

  // 1) 太阳辐射回充：+ solar × 1e9 / 秒，上限 energy.max
  energy.total += num(sp.solar, 0) * 1e9 * dt;
  if (energy.total > energy.max) energy.total = energy.max;

  // 2) 清洁能源扣减：solar/wind 设施发电量 × dt 从 inst.energy.total 扣（下限 0）
  // v0.1.0：与 computePower 的 cleanDraw 同步乘发电加成，保证「能量池实际扣减量」一致。
  const tickCleanBonus = buildingCountBonus(inst, acc);
  let cleanRate = 0;
  for (const fid in facilities) {
    const cnt = num(facilities[fid], 0);
    if (cnt <= 0) continue;
    const f = POWER_FACILITY_BY_ID[fid];
    if (!f) continue;
    if (f.kind === 'solar') cleanRate += num(f.powerOut, 0) * cnt * num(sp.solar, 0) * tickCleanBonus;
    else if (f.kind === 'wind') cleanRate += num(f.powerOut, 0) * cnt * num(sp.wind, 0) * tickCleanBonus;
  }
  const cleanDraw = cleanRate * dt;
  if (cleanDraw > 0) energy.total = Math.max(0, energy.total - cleanDraw);

  // 3) 储能结算：用 computePower 拿 gen/draw/storageMax（只读）
  const pw = computePower(inst, null);
  const surplus = pw.gen - pw.draw;
  if (surplus > 0) {
    // 盈余充电，上限 storageMax（充满则溢出浪费）
    const room = Math.max(0, pw.storageMax - energy.stored);
    const charge = Math.min(room, surplus * dt);
    energy.stored = clamp(energy.stored + charge, 0, pw.storageMax);
  } else if (surplus < 0) {
    // 缺口放电，最多把 stored 放完
    const need = -surplus * dt; // (draw - gen) * dt 的能量
    const discharge = Math.min(energy.stored, need);
    energy.stored = Math.max(0, energy.stored - discharge);
  }

  // 4) 火力设施烧燃料：fuelPerSec × 座数 × dt；不够按比例少烧
  //    v0.0.7：燃料名改为玩家选定（facilityFuelOf），超大型燃机可选除核燃料外的任何燃料
  for (const fid in facilities) {
    const cnt = num(facilities[fid], 0);
    if (cnt <= 0) continue;
    const f = POWER_FACILITY_BY_ID[fid];
    if (!f || f.kind !== 'thermal') continue;
    const need = num(f.fuelPerSec, 0) * cnt * dt;
    if (need <= 0) continue;
    const fuelName = facilityFuelOf(inst, f);
    if (!fuelName) continue;
    const owned = fuelOwnedOf(inst, fuelName);
    const burn = Math.min(owned, need);
    if (burn > 0) {
      const e = (inst.inventory || []).find((x) => x && x.mat === fuelName);
      if (e) e.owned = Math.max(0, num(e.owned, 0) - burn);
    }
  }

  return { cleanDraw };
}

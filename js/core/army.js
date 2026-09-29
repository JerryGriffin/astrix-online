// 军队核心逻辑模块（Astrix v0.2.0）
// 提供军队蓝图战力评估、建制组装生产线、驻防防卫结算与部队管理。
// 遵循零构建原生 ES 模块规范，纯算法与业务逻辑。

import { ARMY_BLUEPRINTS, ARMY_BP_BY_ID, ARMY_PART_BY_ID, armyBpPartNeeds } from '../data/army_parts.js?v=21.0';
import { getPlanetInstance, ownedOf, spendOwned } from './state.js?v=21.0';
import { fmtNum } from './format.js?v=21.0';
import { addEquipment } from './shipyard.js?v=21.0';

let _armySeq = 0;
function genArmyId() {
  _armySeq = (_armySeq + 1) % 100000;
  return 'army_' + Date.now().toString(36) + '_' + _armySeq;
}

let _lineSeq = 0;
function genLineId() {
  _lineSeq = (_lineSeq + 1) % 100000;
  return 'abl_' + Date.now().toString(36) + '_' + _lineSeq;
}

// ============================================================================
// 一、蓝图战力评估
// ============================================================================

/**
 * 计算某张军队蓝图的属性与综合战力
 */
export function armyStatsOf(bpId) {
  const bp = ARMY_BP_BY_ID[bpId];
  if (!bp) return { atk: 0, def: 0, speed: 0, power: 0, mass: 0 };
  let atk = 0;
  let def = 0;
  let speedDelta = 0;
  let mass = 0;

  for (const it of bp.parts) {
    const p = ARMY_PART_BY_ID[it.id];
    if (!p) continue;
    const cnt = Number(it.count) || 1;
    atk += (Number(p.atk) || 0) * cnt;
    def += (Number(p.def) || 0) * cnt;
    speedDelta += (Number(p.speed) || 0) * cnt;
    mass += (Number(p.mass) || 0) * cnt;
  }

  // 基础速度 20，受各部件机动性修正
  const speed = Math.max(5, 20 + speedDelta);
  // 综合战力分：火力 × 2.0 + 防护 × 1.5 + 机动 × 1.0
  const power = Math.round(atk * 2.0 + def * 1.5 + speed * 1.0);

  return { atk, def, speed, power, mass };
}

// ============================================================================
// 二、军队编制与驻防管理
// ============================================================================

export function listArmies(acc) {
  if (!acc) return [];
  if (!Array.isArray(acc.armies)) acc.armies = [];
  return acc.armies;
}

export function ensureArmies(acc) {
  if (!acc) return [];
  if (!Array.isArray(acc.armies)) acc.armies = [];
  if (!Array.isArray(acc.armyBuildLines)) acc.armyBuildLines = [];
  return acc.armies;
}

/**
 * 计算驻防在指定星球的全部地面军队总战力
 */
export function stationedArmyPower(acc, planetCode) {
  if (!acc || !Array.isArray(acc.armies)) return 0;
  const targetCode = planetCode || acc.homePlanetCode || 'syl';
  let total = 0;
  for (const a of acc.armies) {
    if (a && a.stationed !== false) {
      const code = a.planetCode || acc.homePlanetCode || 'syl';
      if (code === targetCode || code === targetCode.replace(/\d+$/, '') || targetCode.startsWith(code)) {
        total += (a.stats && a.stats.power) || 0;
      }
    }
  }
  return total;
}

/**
 * 切换部队的驻防状态（驻防增加星球防御，备勤便于调遣）
 */
export function toggleStationed(acc, armyId) {
  const armies = listArmies(acc);
  const a = armies.find((x) => x.id === armyId);
  if (!a) return false;
  a.stationed = !a.stationed;
  return true;
}

/**
 * 解散编制，返还部分装备部件到母星
 */
export function disbandArmy(acc, inst, armyId) {
  const armies = listArmies(acc);
  const idx = armies.findIndex((x) => x.id === armyId);
  if (idx < 0) return { ok: false, reason: '未找到该部队' };
  const a = armies[idx];
  armies.splice(idx, 1);

  // 返还 50% 部件到 inst.equipment（若 inst 为空则尝试取所在星球或母星）
  const targetInst = inst || getPlanetInstance(a.planetCode || (acc && acc.homePlanetCode) || 'syl');
  const bp = ARMY_BP_BY_ID[a.bpId];
  if (bp && targetInst) {
    for (const it of bp.parts) {
      const p = ARMY_PART_BY_ID[it.id];
      const returnCount = Math.max(1, Math.floor((Number(it.count) || 1) * 0.5));
      const mat = (p && p.inputs && Object.keys(p.inputs)[0]) || '钢';
      addEquipment(targetInst, it.id, mat, returnCount);
    }
  }
  return { ok: true, msg: `部队「${a.nameCn}」已解散，部分装备已拆卸归库。` };
}

// ============================================================================
// 三、部队组装生产线（Army Assembly Lines）
// ============================================================================

/**
 * 检查当前母星装备库存中某种军事部件的持有数量
 */
export function getArmyPartStock(inst, partId) {
  if (!inst || !inst.equipment) return 0;
  let count = 0;
  for (const k in inst.equipment) {
    if (k === partId || k.startsWith(partId + '@')) {
      const it = inst.equipment[k];
      const n = (it && typeof it === 'object') ? Number(it.count) : Number(it);
      count += (Number.isFinite(n) ? n : 0);
    }
  }
  return count;
}

/**
 * 从装备库中扣除某种军事部件
 */
export function spendArmyPartStock(inst, partId, amount) {
  if (!inst || !inst.equipment || amount <= 0) return 0;
  let remaining = amount;
  for (const k in inst.equipment) {
    if (k === partId || k.startsWith(partId + '@')) {
      const it = inst.equipment[k];
      const cur = (it && typeof it === 'object') ? Number(it.count) : Number(it);
      if (cur > 0) {
        const take = Math.min(cur, remaining);
        if (it && typeof it === 'object') {
          it.count -= take;
        } else {
          inst.equipment[k] -= take;
        }
        remaining -= take;
        if (remaining <= 0) break;
      }
    }
  }
  return amount - remaining;
}

/**
 * 检查是否满足组建部队的条件
 */
export function canAssembleArmy(acc, inst, bpId) {
  if (!acc || !inst || !bpId) return { ok: false, reason: '参数缺失' };
  const bp = ARMY_BP_BY_ID[bpId];
  if (!bp) return { ok: false, reason: '未找到对应军队蓝图' };

  // 1. 科技门槛：军队指挥 t_m5
  const techs = Array.isArray(acc.tech) ? acc.tech : [];
  if (bp.tech && !techs.includes(bp.tech)) {
    return { ok: false, reason: '尚未研发「军队指挥」科技，无法成建制组建部队' };
  }

  // 2. 部件库存校验
  const needs = armyBpPartNeeds(bpId);
  for (const pid in needs) {
    const needCount = needs[pid];
    const have = getArmyPartStock(inst, pid);
    if (have < needCount) {
      const p = ARMY_PART_BY_ID[pid];
      return {
        ok: false,
        reason: `军事部件「${p ? p.nameCn : pid}」不足（需要 ${needCount} 件，装备库存仅持有 ${have} 件）`,
      };
    }
  }

  return { ok: true, bp };
}

/**
 * 开启一条部队组装产线
 */
export function startArmyAssemble(acc, inst, bpId, workers = 10) {
  const check = canAssembleArmy(acc, inst, bpId);
  if (!check.ok) return check;
  const bp = check.bp;

  // 扣除部件
  const needs = armyBpPartNeeds(bpId);
  for (const pid in needs) {
    spendArmyPartStock(inst, pid, needs[pid]);
  }

  if (!Array.isArray(acc.armyBuildLines)) acc.armyBuildLines = [];
  const line = {
    id: genLineId(),
    bpId,
    nameCn: bp.nameCn,
    workers: Math.max(1, Number(workers) || 10),
    progress: 0,
    workTotal: bp.buildWork || 10000,
    planetCode: (inst && inst.code) || (acc && acc.homePlanetCode) || 'syl',
    createdAt: Date.now(),
  };

  acc.armyBuildLines.push(line);
  return { ok: true, line, msg: `部队「${bp.nameCn}」整编组装线已建立！` };
}

/**
 * 取消部队组装并全额退还部件
 */
export function cancelArmyAssemble(acc, inst, lineId) {
  if (!acc || !Array.isArray(acc.armyBuildLines)) return { ok: false, reason: '无组装产线' };
  const idx = acc.armyBuildLines.findIndex((l) => l.id === lineId);
  if (idx < 0) return { ok: false, reason: '未找到该产线' };
  const line = acc.armyBuildLines[idx];
  acc.armyBuildLines.splice(idx, 1);

  // 退回全部部件
  const bp = ARMY_BP_BY_ID[line.bpId];
  const targetInst = inst || getPlanetInstance(line.planetCode || (acc && acc.homePlanetCode) || 'syl');
  if (bp && targetInst) {
    for (const it of bp.parts) {
      const p = ARMY_PART_BY_ID[it.id];
      const mat = (p && p.inputs && Object.keys(p.inputs)[0]) || '钢';
      addEquipment(targetInst, it.id, mat, Number(it.count) || 1);
    }
  }
  return { ok: true, msg: '整编产线已取消，已扣部件已全额归还装备库。' };
}

/**
 * 推进部队组装产线（可在全局心跳 tick 中调用）
 */
export function tickArmyBuildLines(acc, inst, dt = 1, powerRatio = 1) {
  if (!acc || !Array.isArray(acc.armyBuildLines) || acc.armyBuildLines.length === 0) return [];
  const completed = [];
  const remaining = [];

  for (const line of acc.armyBuildLines) {
    // 确保仅在该产线所属星球推进，避免多星球循环重复结算
    if (inst && line.planetCode) {
      const code = line.planetCode;
      const instCode = inst.code;
      if (code !== instCode && code !== instCode.replace(/\d+$/, '') && !instCode.startsWith(code)) {
        remaining.push(line);
        continue;
      }
    }

    const labor = Number(line.workers) || 10;
    // 速率：工人数 × 电力效率 × 5 倍倍率 / 总工作量
    const rate = (labor * powerRatio * 5) / Math.max(1, line.workTotal);
    line.progress = (Number(line.progress) || 0) + rate * dt;

    if (line.progress >= 1.0) {
      // 组装完成，部队成军！
      const bp = ARMY_BP_BY_ID[line.bpId];
      const stats = armyStatsOf(line.bpId);
      const existingCount = listArmies(acc).filter((a) => a.bpId === line.bpId).length + 1;
      const army = {
        id: genArmyId(),
        bpId: line.bpId,
        nameCn: `${bp ? bp.nameCn : '正规军'}第 ${existingCount} 营`,
        planetCode: line.planetCode || acc.homePlanetCode || 'syl',
        stats,
        stationed: true,
        createdAt: Date.now(),
      };
      listArmies(acc).push(army);
      completed.push(army);
    } else {
      remaining.push(line);
    }
  }

  acc.armyBuildLines = remaining;
  return completed;
}

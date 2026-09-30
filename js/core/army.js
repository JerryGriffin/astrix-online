// 军队核心逻辑（Astrix v0.2.0）
// 与舰队（fleet.js）/ 船坞（shipyard.js）同构的纯算法模块：
//   1. acc.armies 建制军队（类似舰队）：{ id, nameCn, blueprintId, power, stats, createdAt }
//   2. 军队组装生产线：buildingId 'fabricator' + armyBlueprintId 的线由 armyBuildTick 推进
//      （production.js#tickProduction 显式跳过这类线，state.js#advanceArmyLines 统一接线）
//   3. 战力口径：蓝图部件 atk/def/speed 求和 → power = atk*1.0 + def*0.8 + max(0,speed)*0.2
//   4. 确定性战斗结算：给定 seed，双方各自本地计算得到**同一结果**
//      （跨玩家异步邮箱模型：进攻方在 payload 里带 seed + 快照，防守方本地结算，
//        双方客户端用同一 resolveBattle 得到一致的胜负与战损比例）
//
// 约定：不 import state.js（账号对象由调用方传入）；互 import 仅限函数体内使用。

import {
  ARMY_BP_BY_ID, ARMY_PART_BY_ID, ARMY_SLOT_BY_CAT, armyBpPartNeeds,
} from '../data/army_parts.js?v=20.9';
import { MATERIAL_SLOTS } from '../data/ship_parts.js?v=20.9';
import { materialMul } from './shipyard.js?v=20.9';   // 无循环：shipyard 不依赖本模块

// ============================================================================
// 一、账号军队列表（迁移 + 查询）
// ============================================================================
let _seq = 0;
function genArmyId() {
  _seq = (_seq + 1) % 100000;
  return 'am_' + Date.now().toString(36) + '_' + _seq;
}

export function listArmies(acc) {
  if (!acc) return [];
  if (!Array.isArray(acc.armies)) acc.armies = [];
  for (const a of acc.armies) {
    if (!a) continue;
    if (a.mission === undefined) a.mission = null;      // 预留：出征任务
    if (a.lastResult === undefined) a.lastResult = null;
  }
  return acc.armies;
}

/** 老存档迁移：确保 acc.armies 存在。state.js 载入 / tick 时调用，幂等 */
export function ensureArmies(acc) {
  listArmies(acc);
  return true;
}

export function armyById(acc, armyId) {
  return listArmies(acc).find((a) => a && a.id === armyId) || null;
}

/** v0.2.4：蓝图解析 —— 兼容默认蓝图 id / 蓝图对象 / 自定义蓝图 id（查 acc.armyBlueprints） */
export function getArmyBp(acc, bpOrId) {
  if (bpOrId && typeof bpOrId === 'object') return bpOrId;
  if (ARMY_BP_BY_ID[bpOrId]) return ARMY_BP_BY_ID[bpOrId];
  const list = (acc && Array.isArray(acc.armyBlueprints)) ? acc.armyBlueprints : [];
  return list.find((b) => b && b.id === bpOrId) || null;
}

// ============================================================================
// 二点五、部件实装数值（v0.2.4：材料自选 —— 不同材料造出的军队数值不同）
// ============================================================================
// 复用舰船的 materialMul（结构倍率 = 材料强度/铁，质量倍率 = 密度/铁）：
//   框架/装甲 → def ×结构倍率，质量 ×质量倍率
//   武器     → atk ×结构倍率
//   机动底盘 → speed ×(2 − 质量倍率)（轻材更快、重材更慢，铁不变）
//   支援     → atk/def ×结构倍率
export function resolveArmyPart(partId, materialName) {
  const p = ARMY_PART_BY_ID[partId];
  if (!p) return { atk: 0, def: 0, speed: 0, mass: 0 };
  const mul = materialMul(materialName || '铁');
  const out = { atk: Number(p.atk) || 0, def: Number(p.def) || 0, speed: Number(p.speed) || 0, mass: Number(p.mass) || 0 };
  if (p.cat === 'mobility') {
    out.speed = Math.round(out.speed * Math.max(0.5, 2 - mul.massMul) * 10) / 10;
    out.mass = out.mass * mul.massMul;
  } else {
    if (out.atk) out.atk = Math.round(out.atk * mul.structMul * 10) / 10;
    if (out.def) out.def = Math.round(out.def * mul.structMul * 10) / 10;
    out.mass = out.mass * mul.massMul;
  }
  return out;
}

/** 部件的材料槽候选（UI 下拉用） */
export function armyPartMaterialOptions(partId) {
  const p = ARMY_PART_BY_ID[partId];
  const slot = p ? (p.slot || ARMY_SLOT_BY_CAT[p.cat]) : null;
  return (slot && MATERIAL_SLOTS[slot]) ? MATERIAL_SLOTS[slot].slice() : [];
}

export function disbandArmy(acc, armyId) {
  const arr = listArmies(acc);
  const i = arr.findIndex((a) => a && a.id === armyId);
  if (i < 0) return false;
  arr.splice(i, 1);
  return true;
}

// ============================================================================
// 二、战力口径（唯一实现；UI 与战斗结算都调这里）
// ============================================================================
/** 蓝图静态属性：{ atk, def, speed, mass, men } —— v0.2.4 支持蓝图对象 + 材料实装 + 人数 */
export function armyStatsOfBp(bpOrId) {
  const bp = (bpOrId && typeof bpOrId === 'object') ? bpOrId : ARMY_BP_BY_ID[bpOrId];
  const out = { atk: 0, def: 0, speed: 0, mass: 0, men: 0 };
  if (!bp) return out;
  let frames = 0;
  for (const it of bp.parts) {
    const p = ARMY_PART_BY_ID[it.id];
    if (!p) continue;
    const r = resolveArmyPart(it.id, it.material || '铁');
    const n = Number(it.count) || 0;
    out.atk += r.atk * n;
    out.def += r.def * n;
    out.speed += r.speed * n;
    out.mass += r.mass * n;
    if (p.cat === 'frame') frames += n;
  }
  // v0.2.4：每支军队人数在 100 人上下 —— 由框架数决定（60 + 15/架，夹在 60~150）
  out.men = Math.max(60, Math.min(150, 60 + frames * 15));
  out.atk = Math.round(out.atk * 10) / 10;
  out.def = Math.round(out.def * 10) / 10;
  out.speed = Math.round(out.speed * 10) / 10;
  out.mass = Math.round(out.mass);
  return out;
}

/** 军队实例的有效属性 = 蓝图属性 + 训练加成（v0.2.4） */
export function armyEffStats(army) {
  const base = armyStatsOfBp(army && (army.blueprint || army.blueprintId));
  return {
    atk: Math.round(((base.atk || 0) + (Number(army && army.bonusAtk) || 0)) * 10) / 10,
    def: Math.round(((base.def || 0) + (Number(army && army.bonusDef) || 0)) * 10) / 10,
    speed: base.speed || 0,
    mass: base.mass || 0,
    men: base.men || 0,
  };
}

/** 军队战力：atk 全额 + def 0.8 + 机动加成（速度 >20 记满 0.2 系） */
export function armyPowerOf(stats) {
  if (!stats) return 0;
  const mob = Math.min(1, Math.max(0, (Number(stats.speed) || 0) / 40)) * 0.2;
  return Math.round((Number(stats.atk) || 0) * 1.0 + (Number(stats.def) || 0) * 0.8 + mob * 100);
}

/** 某军队实例的战力（有训练加成时按有效属性重算，否则用快照/蓝图兜底） */
export function armyPowerOfInstance(army) {
  if (!army) return 0;
  const hasBonus = (Number(army.bonusAtk) || 0) !== 0 || (Number(army.bonusDef) || 0) !== 0;
  if (hasBonus) return armyPowerOf(armyEffStats(army));
  const p = Number(army.power);
  if (Number.isFinite(p) && p > 0) return Math.round(p);
  return armyPowerOf(armyStatsOfBp(army.blueprintId));
}

/** 账号全部军队合计战力（星际防御判定用） */
export function totalArmyPowerOf(acc) {
  let sum = 0;
  for (const a of listArmies(acc)) sum += armyPowerOfInstance(a);
  return sum;
}

// ============================================================================
// 三、组装生产线（镜像 shipyard.shipBuildTick 契约）
// ============================================================================
// ★★ state.js 接线契约（与 advanceShipLines 同构）★★
//   每 tick 对 inst.lines 中所有 line.armyBlueprintId 的线各调一次：
//     armyBuildTick(inst, line.armyBlueprintId, labor, dt, powerRatio, acc)
//   进度存 inst.armyProgress[bpId]（同蓝图多线并行推进同一格进度）；
//   进度满 1 → 校验装备库存齐件 → 扣件 → push acc.armies；缺件卡在 1−ε。

/** 组装校验：{ ok, missing: [{ key, partId, material, need, have }] }（部件从 inst.equipment 扣）
 *  v0.2.4：兼容蓝图对象（军队设计器的自定义蓝图） */
export function armyBuildCheck(inst, bpOrId) {
  const missing = [];
  const need = armyBpPartNeeds(bpOrId);
  const eq = (inst && inst.equipment && typeof inst.equipment === 'object') ? inst.equipment : {};
  for (const partId in need) {
    let have = 0;
    for (const key in eq) {
      const e = eq[key];
      if (e && e.partId === partId) have += Number(e.count) || 0;
    }
    if (have < need[partId]) {
      missing.push({ key: partId + '@', partId, material: null, need: need[partId], have });
    }
  }
  return { ok: missing.length === 0, missing };
}

/** 推进一条军队组装线一个 tick，返回本 tick 进度增量（0~1）。acc 缺省只推进度不产出
 *  v0.2.4：blueprintId 兼容蓝图对象与自定义蓝图 id（经 acc.armyBlueprints 解析） */
export function armyBuildTick(inst, blueprintId, labor, dt, powerRatio, acc) {
  if (!inst || !blueprintId) return 0;
  const bp = getArmyBp(acc, blueprintId);
  if (!bp) return 0;
  if (!inst.armyProgress || typeof inst.armyProgress !== 'object') inst.armyProgress = {};

  const C = Math.max(1, Number(bp.buildWork) || 1);
  const ratio = Number.isFinite(Number(powerRatio)) ? Number(powerRatio) : 1;
  const eff = (Number(labor) || 0) * (Number(dt) || 0) * ratio;
  const inc = Math.min(eff / C, 1);

  const oldProg = Number(inst.armyProgress[blueprintId] || 0);
  let target = oldProg + inc;
  let delta = inc;

  if (target >= 1) {
    const chk = armyBuildCheck(inst, bp);
    if (chk.ok) {
      // 扣部件（按 key 聚合数量逐笔扣，同一部件可能分布在多个材料 key 上）
      const need = armyBpPartNeeds(bp);
      for (const partId in need) {
        let left = need[partId];
        for (const key in inst.equipment) {
          if (left <= 0) break;
          const e = inst.equipment[key];
          if (!e || e.partId !== partId) continue;
          const have = Number(e.count) || 0;
          const take = Math.min(have, left);
          e.count = have - take;
          if (e.count <= 0) delete inst.equipment[key];
          left -= take;
        }
      }
      // 成军：命名 = 蓝图名 No.N
      const arr = listArmies(acc);
      const serial = arr.filter((a) => a && a.blueprintId === blueprint.id).length + 1;
      const stats = armyStatsOfBp(bp);
      arr.push({
        id: genArmyId(),
        nameCn: bp.nameCn + ' No.' + serial,
        blueprintId: bp.id,
        // v0.2.4：自定义蓝图存完整对象（armyStatsOfBp 重算需要）；默认蓝图只存 id
        blueprint: (ARMY_BP_BY_ID[bp.id] ? null : bp),
        men: stats.men,
        bonusAtk: 0, bonusDef: 0, exp: 0,   // v0.2.4：训练场经验/加成
        power: armyPowerOf(stats),
        stats,
        mission: null,
        lastResult: null,
        createdAt: Date.now(),
      });
      inst.armyProgress[blueprintId] = 0;
      delta = 1 - oldProg;
    } else {
      // 缺件：卡在 1 − ε，不完成（UI 显示缺件清单）
      target = Math.min(target, 1 - 1e-6);
      inst.armyProgress[blueprintId] = target;
      delta = target - oldProg;
    }
  } else {
    inst.armyProgress[blueprintId] = target;
    delta = target - oldProg;
  }
  return delta;
}

// ============================================================================
// 四、交战结算（v0.2.2：钢铁雄心式多回合会战，取代旧「单掷战力判定」）
// ============================================================================
// 队伍模型：每支军队是一个「营」：{ nameCn, atk, def, hp, hpMax, org }
//   hp  = 兵力（power 快照），战斗中被磨损，按损失比结算战损/解散
//   org = 组织度（每队 100），被打到 0 即撤出战斗，预备队自动顶上
// 规则（HOI4 味的极简版）：
//   * 战斗宽度 COMBAT_WIDTH=3：每方最多 3 支同时接战，其余列预备队；
//   * 每回合前排按「i % 对方前排数」轮转选目标射击：
//       组织伤害 = atk × roll(0.85~1.15) × 40 / (40 + 目标有效def) × 0.5
//       守方有效 def × 1.25（驻防工事加成）；同时 hp 磨损 = 组织伤害 × 0.03
//   * 一方无兵可用 → 对方胜；回合上限 24 耗尽 → 进攻方撤退（守方胜，HOI4 惯例）
//   * 进攻方胜：掠夺 = 败方 ascoin 的 10%~25%（沿用旧口径）
// 确定性：mulberry32(seed) 单随机流，双方本地各算一遍结果完全一致（异步邮箱契约）。

const COMBAT_WIDTH = 3;
const MAX_ROUNDS = 24;
const ORG_MAX = 100;

function mulberry32(seed) {
  let t = seed >>> 0;
  return function () {
    t += 0x6D2B79F5;
    let r = Math.imul(t ^ (t >>> 15), 1 | t);
    r ^= r + Math.imul(r ^ (r >>> 7), 61 | r);
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

/** 军队实例 → 战斗单位（power 快照兜底按蓝图重算） */
export function armyToUnit(a) {
  if (!a) return null;
  const stats = a.stats || armyStatsOfBp(a.blueprintId);
  const power = Math.max(1, Number(a.power) || armyPowerOf(stats));
  return {
    nameCn: a.nameCn || a.id || '部队',
    atk: Math.max(0, Number(stats && stats.atk) || 0),
    def: Math.max(0, Number(stats && stats.def) || 0),
    hp: power, hpMax: power, org: ORG_MAX,
  };
}

/** 兼容旧签名：数字战力 → 合成一支「远征军/守备军」单位（舰队+驻防折算） */
function sideToUnits(side, fallbackName) {
  if (Array.isArray(side)) {
    return side.map(armyToUnit).filter(Boolean);
  }
  const p = Math.max(0, Number(side) || 0);
  if (!(p > 0)) return [];
  return [{ nameCn: fallbackName, atk: p * 0.5, def: p * 0.5, hp: p, hpMax: p, org: ORG_MAX }];
}

/**
 * 确定性多回合交战。
 * @param {number} seed 双方共享随机种子
 * @param {Array|number} atkSide 进攻方军队单位列表（或旧版总战力数字）
 * @param {Array|number} defSide 防守方军队单位列表（或旧版总战力数字）
 * @returns {{ attackerWin:boolean, atkLossRatio:number, defLossRatio:number,
 *             plunderRatio:number, rounds:number, log:string, logLines:string[] }}
 */
export function resolveBattle(seed, atkSide, defSide) {
  const rng = mulberry32(Number(seed) >>> 0 || 1);
  const atk = sideToUnits(atkSide, '远征军');
  const def = sideToUnits(defSide, '守备军');
  const atkHp0 = atk.reduce((s, u) => s + u.hp, 0);
  const defHp0 = def.reduce((s, u) => s + u.hp, 0);
  const log = [];

  const frontOf = (side) => side.filter((u) => u.org > 0).slice(0, COMBAT_WIDTH);
  const alive = (side) => side.some((u) => u.org > 0);

  let round = 0;
  for (; round < MAX_ROUNDS; round++) {
    const fA = frontOf(atk);
    const fD = frontOf(def);
    if (!fA.length || !fD.length) break;
    log.push('第' + (round + 1) + '回合：攻方 ' + fA.length + ' 支接战 · 守方 ' + fD.length + ' 支接战');
    // 火力结算：先算足双方本回合伤害，再统一落账（同回合并行，先后不影响确定性）
    const applyFire = (shooters, targets, fortBonus) => {
      for (const t of targets) t._dmg = 0;
      shooters.forEach((s, i) => {
        const t = targets[i % targets.length];
        const effDef = (t.def || 0) * (1 + (fortBonus || 0));
        const dmg = (s.atk || 0) * (0.85 + rng() * 0.3) * (40 / (40 + effDef)) * 0.5;
        t._dmg += dmg;
      });
      for (const t of targets) {
        if (!(t._dmg > 0)) continue;
        t.org -= t._dmg;
        t.hp = Math.max(0, t.hp - t._dmg * 0.03);
        if (t.org <= 0) log.push('　' + t.nameCn + ' 组织度被打空，撤出战斗');
      }
    };
    applyFire(fD, fA, 0);      // 守方先手（防御方优势）
    applyFire(fA, fD, 0.25);   // 攻方开火，守方吃 25% 工事减伤
  }

  const atkAlive = alive(atk);
  const defAlive = alive(def);
  let attackerWin;
  if (atkAlive && defAlive) {
    attackerWin = false;   // 回合耗尽仍胶着：进攻方撤退（HOI4：攻不下即失败）
    log.push('交战 ' + round + ' 回合未分胜负，进攻方撤退');
  } else if (atkAlive && !defAlive) {
    attackerWin = true;
    log.push('守方全线崩溃，进攻方夺下阵地（共 ' + round + ' 回合）');
  } else {
    attackerWin = false;   // 攻方崩了（或同归于尽）：守方守住
    log.push('进攻方攻势瓦解，守方守住阵地（共 ' + round + ' 回合）');
  }

  const atkHp1 = atk.reduce((s, u) => s + u.hp, 0);
  const defHp1 = def.reduce((s, u) => s + u.hp, 0);
  const atkLossRatio = atkHp0 > 0 ? Math.min(1, Math.max(0, (atkHp0 - atkHp1) / atkHp0)) : 0;
  const defLossRatio = defHp0 > 0 ? Math.min(1, Math.max(0, (defHp0 - defHp1) / defHp0)) : 0;
  const plunderRatio = attackerWin ? 0.10 + rng() * 0.15 : 0;
  log.push('战损：攻方兵力 -' + Math.round(atkLossRatio * 100) + '% · 守方兵力 -' + Math.round(defLossRatio * 100) + '%');
  return {
    attackerWin,
    atkLossRatio,
    defLossRatio,
    plunderRatio,
    rounds: round,
    log: log.join('\n'),
    logLines: log,
  };
}

// ============================================================================
// 五、训练场（v0.2.4：选军队训练 —— 损耗少量装备，少量提升数值，增加经验值）
// ============================================================================
// v0.2.4：军队组装线由「军营」驱动 —— 军营无工位、不占人力，
//   每座军营提供 60 点固定建造人力（等效 workers），多座叠加；无军营则组装线不推进。
export const ARMY_LABOR_PER_BARRACKS = 60;
// 训练一次：
//   * 消耗 2 件军事装备（从 inst.equipment 任意军事部件里扣，缺件则训练失败）；
//   * 永久 +2 atk / +2 def（存在 army.bonusAtk / bonusDef 上）；
//   * 经验 +15（army.exp，经验每满 30 自动再 +1/+1，体现「越练越强」的台阶）；
//   * 重算 army.power（含加成）。
// 训练场建筑数量门槛由 UI 校验（需要 ≥1 座「训练场」）。
// v0.2.6：训练由**瞬时**改为**计时任务**——点训练开一条进度（TRAIN_DURATION_SEC 秒），
//   开始时扣 2 件装备，进度满后结算加成；可多支并行、可随时取消（取消退还装备）。
export const TRAIN_DURATION_SEC = 45;
export const TRAIN_COST_PARTS = 2;
export const TRAIN_EXP_PER = 15;
export const TRAIN_EXP_MILESTONE = 30;

// 开始一段计时训练：校验训练场 / 装备足额，立即扣装备并写入 inst.trainingTasks。
// 加成在 advanceTraining 推进到 100% 时由 applyTrainBonus 结算。
export function trainArmy(acc, armyId, inst) {
  if (!inst) return { ok: false, reason: '星球实例缺失' };
  const counts = (inst.buildings && Object.keys(inst.buildings).length)
    ? inst.buildings : null;
  const tg = counts ? Number(counts.training_ground) || 0 : 0;
  if (tg < 1) return { ok: false, reason: '需要先建成「训练场」（t_m2）' };
  const army = armyById(acc, armyId);
  if (!army) return { ok: false, reason: '找不到该军队' };
  const tasks = inst.trainingTasks = inst.trainingTasks || [];
  if (tasks.some((t) => t.armyId === armyId)) return { ok: false, reason: '该军队已在训练中' };
  if (!inst.equipment) inst.equipment = {};
  // 收集 2 件军事装备（ap_ 开头），记录所扣条目 key 以便取消时退还
  const entries = [];
  for (const key in inst.equipment) {
    const e = inst.equipment[key];
    if (e && typeof e.partId === 'string' && e.partId.startsWith('ap_') && (Number(e.count) || 0) > 0) {
      entries.push({ key, e });
    }
  }
  const totalHave = entries.reduce((n, x) => n + (Number(x.e.count) || 0), 0);
  if (totalHave < TRAIN_COST_PARTS) {
    return { ok: false, reason: '军事装备不足（训练一次需消耗 ' + TRAIN_COST_PARTS
      + ' 件部件，当前 ' + totalHave + ' 件 —— 先在制造车间生产）' };
  }
  const parts = [];
  let need = TRAIN_COST_PARTS;
  for (const x of entries) {
    if (need <= 0) break;
    const have = Number(x.e.count) || 0;
    const take = Math.min(have, need);
    x.e.count = have - take;
    need -= take;
    parts.push({ key: x.key, partId: x.e.partId, material: x.e.material == null ? null : x.e.material, count: take });
  }
  // 清掉扣空的条目（避免留 count=0 的壳）
  for (const key in inst.equipment) {
    const e = inst.equipment[key];
    if (e && typeof e.partId === 'string' && e.partId.startsWith('ap_') && (Number(e.count) || 0) <= 0) {
      delete inst.equipment[key];
    }
  }
  tasks.push({ armyId, progress: 0, duration: TRAIN_DURATION_SEC, parts });
  return { ok: true, duration: TRAIN_DURATION_SEC, usedParts: TRAIN_COST_PARTS };
}

// 把训练消耗的装备退还到 inst.equipment（取消训练 / 军队已解散时调用）
function refundParts(inst, parts) {
  if (!inst || !inst.equipment || !Array.isArray(parts)) return;
  for (const p of parts) {
    const e = inst.equipment[p.key] || { partId: p.partId, material: p.material == null ? null : p.material, count: 0 };
    e.count = (Number(e.count) || 0) + (Number(p.count) || 0);
    inst.equipment[p.key] = e;
  }
}

// 结算一支军队的训练加成（与旧瞬时版一致）：+2/+2 攻防、+15 经验（每 30 经验再 +1/+1）
function applyTrainBonus(army) {
  army.bonusAtk = (Number(army.bonusAtk) || 0) + 2;
  army.bonusDef = (Number(army.bonusDef) || 0) + 2;
  const expBefore = Number(army.exp) || 0;
  const expAfter = expBefore + TRAIN_EXP_PER;
  const milestones = Math.floor(expAfter / TRAIN_EXP_MILESTONE) - Math.floor(expBefore / TRAIN_EXP_MILESTONE);
  if (milestones > 0) { army.bonusAtk += milestones; army.bonusDef += milestones; }
  army.exp = expAfter;
  const stats = armyEffStats(army);
  army.stats = stats;
  army.power = armyPowerOf(stats);
  return { bonusAtk: army.bonusAtk, bonusDef: army.bonusDef, exp: army.exp };
}

// 每 tick 推进所有计时训练；满进度的结算加成（军队没了则退还装备）。
export function advanceTraining(inst, dt, acc) {
  if (!inst || !Array.isArray(inst.trainingTasks) || !inst.trainingTasks.length) return;
  const remain = [];
  for (const task of inst.trainingTasks) {
    task.progress = Number(task.progress) + dt;
    if (task.progress < task.duration) { remain.push(task); continue; }
    const army = armyById(acc, task.armyId);
    if (army) applyTrainBonus(army);
    else refundParts(inst, task.parts);
  }
  inst.trainingTasks = remain;
}

// 取消一支军队的训练，退还已扣装备。
export function cancelTraining(inst, armyId) {
  if (!inst || !Array.isArray(inst.trainingTasks)) return false;
  const i = inst.trainingTasks.findIndex((t) => t.armyId === armyId);
  if (i < 0) return false;
  refundParts(inst, inst.trainingTasks[i].parts);
  inst.trainingTasks.splice(i, 1);
  return true;
}

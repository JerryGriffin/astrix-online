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
} from '../data/army_parts.js?v=53.4';
import { materialMul, materialOptionsFor } from './shipyard.js?v=53.4';   // 无循环：shipyard 不依赖本模块

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
  migrateArmyTechs(acc);
  migrateArmyShips(acc);
  return true;
}

/** v0.2.10 老存档科技迁移：旧四级军事线（…t_m3 机动平台 / t_m4 火炮重武）→ 新三级。
 *  规则：researched t_m4 → 保留为 t_m3（超级）；仅 t_m3 → 降为 t_m2（高级）。
 *  幂等：迁移完打 _armyTechV3 标记；新口径存档（漫溯深空赠送段）直接带标记跳过。 */
function migrateArmyTechs(acc) {
  if (!acc || !Array.isArray(acc.tech) || acc._armyTechV3) return;
  const hadM4 = acc.tech.includes('t_m4');
  const hadM3 = acc.tech.includes('t_m3');
  if (!hadM4 && !hadM3) return;
  if (hadM4) {
    acc.tech = acc.tech.filter((t) => t !== 't_m3' && t !== 't_m4');
    acc.tech.push('t_m3');
  } else {
    acc.tech = acc.tech.filter((t) => t !== 't_m3');
    acc.tech.push('t_m2');
  }
  acc._armyTechV3 = true;
}

export function armyById(acc, armyId) {
  return listArmies(acc).find((a) => a && a.id === armyId) || null;
}

/**
 * v0.4.7 修复「军队组装线进度条永远 0%」—— 给零人力的军营线补派工人。
 *
 * 背景
 *   v0.2.4 时组装线是「军营驱动、不占人力」，UI 建线传 `workers: 0`；
 *   v0.4.4（需求 1）改成组装线**真正消耗自己分配的人力**，
 *   core/state.js#advanceArmyLines 随即加了 `if (!(workers > 0)) continue`。
 *   于是 v0.2.4~v0.4.6 期间建的军营线 workers 恒为 0，被这一行整个跳过 ——
 *   表现就是用户报告的「生产线进度条一直 0%，军队部署不了」，
 *   而人力页只管职业岗位、不列产线工人，玩家无法自行补救。
 *
 * 放在 advanceArmyLines 就地修（而不是 ensureArmies），因为只有那里才拿到
 * 星球实例 —— ensureArmies(acc) 只有账号，碰不到 inst.lines。
 *
 * 幂等：派上后 workers>0，后续 tick 不再重复处理。
 */
export function healArmyLineLabor(inst, freeLabor) {
  if (!inst || !Array.isArray(inst.lines)) return 0;
  let fixed = 0;
  for (const line of inst.lines) {
    if (!line || !line.armyBlueprintId) continue;
    if (line.buildingId !== 'barracks' && line.buildingId !== 'fabricator') continue;
    if (Number(line.workers) > 0) continue;
    const free = Math.max(0, Math.floor(Number(freeLabor) || 0));
    if (free <= 0) continue;
    line.workers = free;
    fixed++;
  }
  return fixed;
}

// ============================================================================
// 二点七、飞船编入军队（v0.2.10，需 t_m3 超级军用装备）
// ============================================================================
// 6:4 分摊攻防 + 25% 入战力(hp)；加成快照 army.shipBonus = { strength }（战斗确定性）。
// 互斥：一艘船同时只能编入一个军队或舰队；每支军队上限 1 艘（旗舰）。
export const ARMY_SHIP_TECH = 't_m3';

function shipBonusSnapshot(ship) {
  return { strength: Math.max(0, Number(ship && ship.strength) || 0) };
}

/** 该船当前被哪支军队占用（未占用返回 null） */
export function shipArmyOf(acc, shipId) {
  if (!acc || !shipId) return null;
  for (const a of listArmies(acc)) {
    if (a && a.shipId === shipId) return a;
  }
  return null;
}

/** 该船是否可编入军队：存在、未编入舰队、未被其它军队占用 */
export function shipEligibleForArmy(acc, shipId) {
  const s = (acc && Array.isArray(acc.ships)) ? acc.ships.find((x) => x && x.id === shipId) : null;
  if (!s) return { ok: false, reason: '飞船不存在' };
  const inFleet = (acc.fleets || []).some((f) => f && Array.isArray(f.shipIds) && f.shipIds.includes(shipId));
  if (inFleet) return { ok: false, reason: '该飞船已编入舰队（先在舰队页移出）' };
  const holder = shipArmyOf(acc, shipId);
  if (holder && holder.id !== (acc && acc._attachTargetArmyId)) {
    return { ok: false, reason: '该飞船已编入军队「' + (holder.nameCn || holder.id) + '」' };
  }
  return { ok: true, ship: s };
}

/** 把飞船编入军队（t_m3 解锁；互斥：不能同时在舰队里；每军限 1 艘） */
export function attachShipToArmy(acc, armyId, shipId) {
  const a = armyById(acc, armyId);
  if (!a) return { ok: false, reason: '军队不存在' };
  if (a.shipId) return { ok: false, reason: '该军队已编入飞船（先解编）' };
  if (!Array.isArray(acc.tech) || !acc.tech.includes(ARMY_SHIP_TECH)) {
    return { ok: false, reason: '需先研究「超级军用装备 M3」才能将飞船编入军队' };
  }
  const elig = shipEligibleForArmy(acc, shipId);
  if (!elig.ok) return elig;
  a.shipId = shipId;
  a.shipBonus = shipBonusSnapshot(elig.ship);
  return { ok: true, army: a, ship: elig.ship };
}

/** 解编飞船（恢复纯步兵数值；船回可用池） */
export function detachShipFromArmy(acc, armyId) {
  const a = armyById(acc, armyId);
  if (!a) return { ok: false, reason: '军队不存在' };
  if (!a.shipId) return { ok: false, reason: '该军队没有编入飞船' };
  const sid = a.shipId;
  a.shipId = null;
  a.shipBonus = null;
  return { ok: true, shipId: sid };
}

/** 迁移/自愈：shipId 悬空（船被卖掉或被编进舰队）→ 解编；strength 变了 → 刷新快照。ensureArmies 调 */
function migrateArmyShips(acc) {
  for (const a of listArmies(acc)) {
    if (a.shipId === undefined) a.shipId = null;
    if (!a.shipId) { if (a.shipBonus) a.shipBonus = null; continue; }
    const s = (Array.isArray(acc.ships) ? acc.ships : []).find((x) => x && x.id === a.shipId);
    const inFleet = (acc.fleets || []).some((f) => f && Array.isArray(f.shipIds) && f.shipIds.includes(a.shipId));
    if (!s || inFleet) { a.shipId = null; a.shipBonus = null; continue; }
    a.shipBonus = shipBonusSnapshot(s);
  }
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
export function resolveArmyPart(partId, materialName, lookup) {
  const p = ARMY_PART_BY_ID[partId];
  if (!p) return { atk: 0, def: 0, speed: 0, mass: 0 };
  const mul = materialMul(materialName || '铁', lookup);
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

/**
 * 部件的材料槽候选（UI 下拉用）—— v0.4.6 需求 11。
 *
 * 过去这里是 `MATERIAL_SLOTS[slot]`：一张**硬编码白名单**，
 * 于是自定义化工厂造出来的合金**永远选不上**（不在名单里），
 * 精加工产物里名单漏掉的也一并选不上。
 * 现在改为「除气体外全部可选」，白名单降级为**推荐排序**。
 *
 * @param inst   星球实例（读 inst.customMaterials）
 * @param opts   { lookup, ownedOf, onlyOwned }
 */
export function armyPartMaterialOptions(partId, inst, opts) {
  const p = ARMY_PART_BY_ID[partId];
  const slot = p ? (p.slot || ARMY_SLOT_BY_CAT[p.cat]) : 'hull';
  return materialOptionsFor(slot, inst, opts);
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
export function armyStatsOfBp(bpOrId, lookup) {
  const bp = (bpOrId && typeof bpOrId === 'object') ? bpOrId : ARMY_BP_BY_ID[bpOrId];
  const out = { atk: 0, def: 0, speed: 0, mass: 0, men: 0 };
  if (!bp) return out;
  let frames = 0;
  for (const it of bp.parts) {
    const p = ARMY_PART_BY_ID[it.id];
    if (!p) continue;
    const r = resolveArmyPart(it.id, it.material || '铁', lookup);
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

/** 军队实例的有效属性 = 蓝图属性 + 训练加成 + 编入飞船加成（v0.2.10）
 *  飞船加成（需 t_m3）：战力 6:4 分摊攻防。shipBonus.strength 为编入时的飞船战力快照（战斗确定性） */
export function armyEffStats(army) {
  const base = armyStatsOfBp(army && (army.blueprint || army.blueprintId));
  const sb = (army && army.shipId && army.shipBonus) ? (Number(army.shipBonus.strength) || 0) : 0;
  return {
    atk: Math.round(((base.atk || 0) + (Number(army && army.bonusAtk) || 0) + sb * 0.6) * 10) / 10,
    def: Math.round(((base.def || 0) + (Number(army && army.bonusDef) || 0) + sb * 0.4) * 10) / 10,
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

/** 某军队实例的战力（有训练/飞船加成时按有效属性重算 + 飞船 25% 入 hp，否则用快照/蓝图兜底） */
export function armyPowerOfInstance(army) {
  if (!army) return 0;
  const sb = (army.shipId && army.shipBonus) ? (Number(army.shipBonus.strength) || 0) : 0;
  const hasBonus = (Number(army.bonusAtk) || 0) !== 0 || (Number(army.bonusDef) || 0) !== 0 || sb > 0;
  if (hasBonus) return Math.round(armyPowerOf(armyEffStats(army)) + sb * 0.25);
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
export function armyBuildTick(inst, blueprintId, labor, dt, powerRatio, acc, progressKey) {
  if (!inst || !blueprintId) return 0;
  const bp = getArmyBp(acc, blueprintId);
  if (!bp) return 0;
  if (!inst.armyProgress || typeof inst.armyProgress !== 'object') inst.armyProgress = {};
  // v0.4.4：进度键改为**生产线 id**（progressKey），不再按蓝图 id。
  //   此前 inst.armyProgress[blueprintId] 让「同一兵种开多条线」共享**同一根进度条**：
  //   结果是 N 条线进度完全相同、而且全部产出只会得到**一支**军队（需求 7）。
  //   传 progressKey（= line.id）后每条线独立推进、各自成军。
  //   不传时回退到 blueprintId，以兼容旧存档与既有调用。
  const pKey = progressKey || blueprintId;

  const C = Math.max(1, Number(bp.buildWork) || 1);
  const ratio = Number.isFinite(Number(powerRatio)) ? Number(powerRatio) : 1;
  const eff = (Number(labor) || 0) * (Number(dt) || 0) * ratio;
  const inc = Math.min(eff / C, 1);

  const oldProg = Number(inst.armyProgress[pKey] || 0);
  let target = oldProg + inc;
  let delta = inc;

  if (target >= 1) {
    const chk = armyBuildCheck(inst, bp);
    // v0.3.3：无 acc 时绝不进入成军提交。listArmies(null) 会返回一个**临时空数组**，
    //   push 进去的军队随函数返回即被丢弃 —— 旧写法「扣装备 → push → 清进度」在这种
    //   情况下会逐 tick 静默扣光全部装备却一支军队都不产出（且被上层 try/catch 吞掉，
    //   玩家只看到进度卡在 1−ε）。
    if (chk.ok && acc) {
      // ---- 提交前先算齐全部派生数据：任何一步抛错都发生在扣装备之前 ----
      const stats = armyStatsOfBp(bp);          // 可能抛（自定义蓝图 parts 缺失）
      const arr = listArmies(acc);              // 真实数组（acc 非空已保证）
      const serial = arr.filter((a) => a && a.blueprintId === bp.id).length + 1;
      const army = {
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
      };
      // ---- 数据齐备后才提交：扣件与成军必须同生共死 ----
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
      arr.push(army);
      inst.armyProgress[pKey] = 0;
      delta = 1 - oldProg;
    } else {
      // 缺件：卡在 1 − ε，不完成（UI 显示缺件清单）
      target = Math.min(target, 1 - 1e-6);
      inst.armyProgress[pKey] = target;
      delta = target - oldProg;
    }
  } else {
    inst.armyProgress[pKey] = target;
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
  // v0.2.10：编入飞船时叠加 6:4 攻防 + 25% 入 hp；无飞船时保持旧口径
  // （显式 stats 快照优先 → 存档战力 → 蓝图重算，战斗测试与快照兼容）
  const sb = (a.shipId && a.shipBonus) ? (Number(a.shipBonus.strength) || 0) : 0;
  // 编入飞船时与 armyEffStats 同口径（蓝图基线）；无飞船保持旧口径（显式 stats 快照优先）
  const base = sb > 0 ? armyStatsOfBp(a.blueprint || a.blueprintId)
    : (a.stats || armyStatsOfBp(a.blueprint || a.blueprintId));
  const stats = sb > 0 ? {
    atk: Math.round(((base.atk || 0) + sb * 0.6) * 10) / 10,
    def: Math.round(((base.def || 0) + sb * 0.4) * 10) / 10,
    speed: base.speed || 0,
  } : base;
  const power = sb > 0
    ? Math.max(1, Math.round(armyPowerOf(stats) + sb * 0.25))   // 编入飞船：按有效属性重算（存量快照不含飞船加成）
    : Math.max(1, Number(a.power) || armyPowerOf(stats));
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
// v0.2.6 rev3（HOI4 化）：地形修正 / 预备队增援 / 装甲穿甲
const BATTLE_TERRAIN = {
  plain:   { atk: 1.05, def: 1.00, nameCn: '平原' },
  forest:  { atk: 0.95, def: 1.10, nameCn: '森林' },
  mountain:{ atk: 0.88, def: 1.18, nameCn: '山地' },
  urban:   { atk: 0.90, def: 1.25, nameCn: '城市' },
  desert:  { atk: 1.05, def: 0.97, nameCn: '沙漠' },
};

export function resolveBattle(seed, atkSide, defSide, opts) {
  const o = opts || {};
  const terrain = BATTLE_TERRAIN[o.terrain] || BATTLE_TERRAIN.plain;
  const rng = mulberry32(Number(seed) >>> 0 || 1);
  const atk = sideToUnits(atkSide, '远征军');
  const def = sideToUnits(defSide, '守备军');
  // 预备队（HOI4 增援）：直接并入序列 —— 前线组织度打空的部队一旦撤出，
  //   后排队列自然递补进战斗宽度（frontOf 只取前 3 支有组织度的部队）
  if (o.atkReserves) { for (const u of sideToUnits(o.atkReserves, '援军')) { u._reserve = true; atk.push(u); } }
  if (o.defReserves) { for (const u of sideToUnits(o.defReserves, '预备队')) { u._reserve = true; def.push(u); } }
  const armorAtk = Math.max(0, Number(o.atkArmor) || 0);   // 穿甲/装甲优势（0~2）
  const armorDef = Math.max(0, Number(o.defArmor) || 0);
  const atkHp0 = atk.reduce((s, u) => s + u.hp, 0);
  const defHp0 = def.reduce((s, u) => s + u.hp, 0);
  const log = [];

  const frontOf = (side) => side.filter((u) => u.org > 0).slice(0, COMBAT_WIDTH);
  const alive = (side) => side.some((u) => u.org > 0);

  log.push('地形：' + terrain.nameCn + '（攻方 ×' + terrain.atk + ' / 守方 ×' + terrain.def + '）'
    + (armorAtk || armorDef ? '　装甲优势：攻 ' + armorAtk.toFixed(2) + ' / 守 ' + armorDef.toFixed(2) : '')
    + ((o.atkReserves || o.defReserves) ? '　预备队已就位' : ''));
  let round = 0;
  for (; round < MAX_ROUNDS; round++) {
    const fA = frontOf(atk);
    const fD = frontOf(def);
    if (!fA.length || !fD.length) break;
    log.push('第' + (round + 1) + '回合：攻方 ' + fA.length + ' 支接战 · 守方 ' + fD.length + ' 支接战');
    // 火力结算：先算足双方本回合伤害，再统一落账（同回合并行，先后不影响确定性）
    const applyFire = (shooters, targets, fortBonus, sideMul) => {
      for (const t of targets) t._dmg = 0;
      shooters.forEach((s, i) => {
        const t = targets[i % targets.length];
        const effDef = (t.def || 0) * (1 + (fortBonus || 0));
        const dmg = (s.atk || 0) * (sideMul || 1) * (0.85 + rng() * 0.3) * (40 / (40 + effDef)) * 0.5;
        t._dmg += dmg;
      });
      for (const t of targets) {
        if (!(t._dmg > 0)) continue;
        t.org -= t._dmg;
        t.hp = Math.max(0, t.hp - t._dmg * 0.03);
        if (t.org <= 0) log.push('　' + t.nameCn + ' 组织度被打空，撤出战斗');
      }
    };
    applyFire(fD, fA, 0, terrain.def * (1 + armorDef * 0.15));      // 守方先手（防御 + 地形 + 装甲）
    applyFire(fA, fD, 0.25, terrain.atk * (1 + armorAtk * 0.15));   // 攻方开火，守方吃 25% 工事减伤
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

// ============================================================================
// v0.4.9 需求「军队系统无法补员，请修复」—— 兵员恢复搬进战斗层
// ============================================================================
//
// 【原症状与根因】
//   补员只有一条路径：hoi1936.js#reinforceArmy，由「军队」页一个按钮触发，
//   而且它要求 `getAvailable(inst.pop) > 0`（必须还有**未分配**人力）。
//   玩家的兵力几乎总是被产线与岗位占满 → 一键补员永远返回「可用人力不足」，
//   看起来就是**按钮完全无效**。更糟的是：
//     · 军队成军时 `men = ARMY_MEN_MAX`（满编），按钮要等打输掉兵员才出现；
//     · 没有任何**自动**恢复，一个师被打残后要玩家手动一次一次点；
//     · 实现放在 hoi1936.js 这个剧本适配层里，而补员是通用军事机制。
//
// 【v0.4.9 的做法】
//   1. **自动整补**（recoverArmies）：不在交战的师按时间自动回兵，
//      速率受**可用人力**与**装备**约束 —— 真正缺料就真的补不回来（不再是死按钮）。
//   2. **手动紧急补员**（reinforceArmy）：一次性投入装备加速补员，
//      保留为「玩家想快点满编」的可选项，并如实报告缺了多少。
//   3. 两者共用同一份人力预算，**不会凭空造人**。
// ============================================================================

/** 满编兵员（军队未记录 menMax 时的兜底） */
export const ARMY_MEN_FALLBACK = 500;
export function menMaxOf(army) {
  const m = Number(army && army.menMax);
  return m > 0 ? m : ARMY_MEN_FALLBACK;
}

/** 某师是否正在某场战役中（自动整补必须排除，否则边打边回） */
function isInBattle(acc, armyId) {
  for (const b of (Array.isArray(acc.battles) ? acc.battles : [])) {
    if (!b || b.status !== 'active') continue;
    if ((b.mine || []).some((d) => d && d.armyId === armyId)) return true;
  }
  return false;
}

/** 星球上军事装备的总量（补员消耗它） */
function gearCountOf(inst) {
  let n = 0;
  const eq = inst && inst.equipment;
  if (eq && typeof eq === 'object') {
    for (const k in eq) {
      const e = eq[k];
      if (e && Number(e.count) > 0) n += Number(e.count) || 0;
    }
  }
  return n;
}

/** 从星球装备里扣 n 件 */
function takeGear(inst, n) {
  let left = Math.max(0, Math.floor(Number(n) || 0));
  let taken = 0;
  const eq = inst && inst.equipment;
  if (!eq || typeof eq !== 'object' || !(left > 0)) return 0;
  for (const k in eq) {
    if (left <= 0) break;
    const e = eq[k];
    if (!e || !(Number(e.count) > 0)) continue;
    const take = Math.min(Number(e.count), left);
    e.count = Number(e.count) - take;
    left -= take; taken += take;
  }
  return taken;
}

/**
 * 自动整补（由 state.js 每 tick 接线）。
 * @param env { freeLabor: () => number } —— 可用人力口径由调用方注入，
 *             避免本模块反向依赖 state.js / population.js
 */
export function recoverArmies(acc, inst, dtSec, env) {
  const dt = Number(dtSec) || 0;
  if (!(dt > 0)) return { recovered: 0, skipped: 0 };
  const armies = listArmies(acc);
  if (!armies.length) return { recovered: 0, skipped: 0 };

  const PER_DAY_PER_ARMY = 60;          // 每游戏天：满编师回 60 人
  let labor = Infinity;
  try {
    if (env && typeof env.freeLabor === 'function') {
      const v = Number(env.freeLabor());
      labor = Number.isFinite(v) ? Math.max(0, v) : 0;
    }
  } catch (e) { labor = 0; }

  let gear = gearCountOf(inst);
  let recovered = 0, skipped = 0;
  // 先补最残的师（HOI4 的整补逻辑：优先恢复快被打垮的部队）
  const need = armies
    .map((a) => ({ a, max: menMaxOf(a), men: Number(a.men) || 0 }))
    .filter((x) => x.men < x.max && Number(x.a.men) > 0)
    .map((x) => ({ ...x, gap: x.max - x.men }))
    .sort((a, b) => (b.gap / b.max) - (a.gap / a.max));

  for (const x of need) {
    if (isInBattle(acc, x.a.id)) { skipped++; continue; }
    if (!(labor > 0) || !(gear > 0)) { skipped++; continue; }
    let want = Math.min(PER_DAY_PER_ARMY * dt, x.gap);
    want = Math.min(want, Math.floor(labor));
    const needGear = Math.ceil(want / 10);
    if (gear < needGear) {
      want = gear * 10;                     // 装备是硬约束
      if (!(want > 0)) { skipped++; continue; }
    }
    want = Math.min(want, x.gap);
    if (!(want >= 1)) { skipped++; continue; }
    const g = takeGear(inst, Math.ceil(want / 10));
    x.a.men = Math.min(x.max, x.men + want);
    labor -= want;
    gear -= g;
    recovered += want;
  }
  return { recovered, skipped };
}

/**
 * 手动紧急补员（一次性）。取代旧 hoi1936.js#reinforceArmy。
 * 缺料时**如实回报**而不是悄悄缩水（旧的 35% 凭空下限等于凭空造人）。
 */
export function reinforceArmy(acc, inst, armyId, days) {
  const a = (Array.isArray(acc && acc.armies) ? acc.armies : []).find((x) => x && x.id === armyId);
  if (!a) return { ok: false, reason: '找不到该军队' };
  const max = menMaxOf(a);
  if (!(Number(a.men) > 0)) a.men = Math.floor(max * 0.3);
  if (a.men >= max) return { ok: false, reason: '该师已满编（' + Math.round(a.men) + '/' + max + '）' };

  const gap = max - Number(a.men);
  const want = Math.min(gap, Math.round(200 * Math.max(1, Number(days) || 1)));
  const gearHave = gearCountOf(inst);
  // 装备不足 → 只能补到装备支持的上限
  const added = Math.floor(Math.min(want, gearHave * 10));
  if (!(added >= 1)) {
    return { ok: false, reason: '装备不足：补员需要军事装备（每 10 人 1 件），当前一件也没有。' };
  }
  const gearUsed = takeGear(inst, Math.ceil(added / 10));

  a.men = Math.min(max, Number(a.men) + added);
  a.reinforcing = a.men < max;

  const gearNeed = Math.ceil(want / 10);
  const gearShort = gearUsed < gearNeed;
  return {
    ok: true, added, men: a.men, menMax: max,
    gearUsed, gearNeed, gearShort,
    note: (gearShort
      ? '装备只够补 ' + added + ' / ' + want + ' 人（还缺 ' + (gearNeed - gearUsed) + ' 件装备）'
      : '已补 ' + added + ' 人'),
  };
}

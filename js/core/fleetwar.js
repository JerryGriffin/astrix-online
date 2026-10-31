// ============================================================================
// 舰队会战（v0.4.24）—— 「大规模舰队战」的完整规则
// ============================================================================
// 在此之前，舰队与战争是两张互不相干的皮：
//   · core/fleet.js 只负责「组建编队 / 探索 / 运输 / 巡航」，巡航遭遇是**随机掷骰**
//     （战力比大小 + 随机沉一艘），既看不到过程，也没法针对性地编队；
//   · core/battle.js 的轨道控制只看「玩家舰队总战力 vs 史实海军基准」这一个比值，
//     打不打会战都一样，舰队再强也只是个静态数字。
// 本模块补上中间那一层：**可指挥的舰队会战**。
//
// ---------------------------------------------------------------------------
// 规则（全部可调，常量集中在下方「可调常量」区）
// ---------------------------------------------------------------------------
// 1. 编成
//    玩家选 1 支或多支编队出战。每艘船换算成三个战斗值：
//      火力 atk   = 蓝图聚合的 damage（武器部件之和；无武器 = 0，打不出伤害）
//      装甲 armor = 结构 × 0.35（先吃一半左右，剩下才落到结构上）
//      结构 hull  = 结构 × hullIntegrity（会战受的伤会一直留着，需要回船坞修）
//      机动 speed = 蓝图航速（决定命中率，快的一方更容易打中、更难被打中）
// 2. 敌方舰队
//    由目标势力的**海军基准**折算（1936 用史实 navy ×12；通用势力用工业/兵力折算），
//    同一条约内**确定性生成**（种子 = 战争 id），不会每次点开都换一套编成。
//    每打一次胜仗，敌方舰队残余再降 15%（上限 −60%）—— 连续会战能真正磨掉对方舰队。
// 3. 回合
//    最多 8 回合，双方**同时开火**（避免先手必胜）：
//      · 命中率 = 0.55 + 0.30 ×（机动占比 − 0.5）× 2，夹在 0.25~0.85
//        机动占比 = 我方平均航速 /（我方 + 敌方）
//      · 每艘船挑一个目标（按结构加权随机），造成
//          伤害 = 火力 × 命中率 × 穿甲率 × 抖动(0.85~1.15)
//        穿甲率 = 火力 /（火力 + 目标装甲）—— 火力远大于装甲时几乎全额命中
//      · 目标结构扣到 0 → 当场击沉（从 acc.ships 与编队里永久移除）
// 4. 撤退
//    一方损失舰数 ≥ 40%，或剩余结构 < 35% 时自动撤退，会战立刻结束。
//    我方撤退 = 失败；敌方撤退 = 胜利；打满 8 回合则比剩余结构占比。
// 5. 战果
//    · 战争分数：胜 +8 / 败 +2（与陆战 addWarScore 同口径，但只记一次）
//    · 舰队会战优势 navalEdge：胜 +0.1、败 −0.1（上限 ±0.3），
//      由 battle.js#fleetSuperiorityOf 读取 → 直接改变**轨道控制**，进而影响陆战补给
//    · 击沉的舰船永久损失；受伤的船保留 hullIntegrity，回船坞可修
// 6. 冷却
//    同一条约 60 秒内只能打一场会战 —— 会战是即时结算的，没有冷却就能连点把战争刷赢。
//
// ---------------------------------------------------------------------------
// 依赖约定
// ---------------------------------------------------------------------------
// 与 battle.js 同构：**不 import state.js**（账号对象由调用方传入），
// 需要读写星球物品栏时由调用方通过 ctx 注入（见 repairFleet 的 ctx）。
// ============================================================================

import { hash32, mulberry32, clamp } from './util.js?v=65.16';
import { listFleets, fleetPowerOf, resolveFleetRef, fleetMissionLabel } from './fleet.js?v=65.16';
import { HOI_BY_ID } from '../data/hoi1936.js?v=65.16';
import { factionPower, factionNameCn } from '../data/factions.js?v=65.16';
import {
  addWarScore, navalEdgeOf, addNavalEdge, ensureNaval,
  NAVY_TO_SHIP_POWER, FLEET_EDGE_MAX,
} from './war.js?v=65.16';

// ============================================================================
// 可调常量
// ============================================================================
export const FLEET_BATTLE_MAX_ROUNDS = 8;       // 最多几个回合
export const FLEET_RETREAT_LOSS = 0.40;         // 损失舰数占比 ≥ 40% 撤退
export const FLEET_RETREAT_HULL = 0.35;         // 剩余结构占比 < 35% 撤退
export const FLEET_ARMOR_RATIO = 0.35;          // 装甲 = 结构 × 0.35
export const FLEET_ACC_BASE = 0.55;             // 基准命中率
export const FLEET_ACC_SPAN = 0.30;             // 机动带来的命中率浮动幅度
export const FLEET_ACC_MIN = 0.25;
export const FLEET_ACC_MAX = 0.85;
export const FLEET_DMG_JITTER = 0.15;           // 伤害抖动 ±15%
export const FLEET_EDGE_STEP = 0.10;            // 每场会战对轨道控制实力的修正
export const FLEET_NAVAL_LOSS_STEP = 0.15;      // 每次胜利削弱敌方舰队残余 15%
export const FLEET_NAVAL_LOSS_MAX = 0.60;       // 敌方舰队最多被打掉 60%
export const FLEET_BATTLE_COOLDOWN_MS = 60000;  // 同一条约的会战冷却（毫秒）
export const FLEET_MIN_FOE_POWER = 60;          // 敌方舰队战力下限（避免 0 战力怪象）
export const FLEET_LOG_CAP = 30;                // 会战日志条数上限

// 敌方舰种（per-ship 系数：相对「单舰战力」的倍率）
const FOE_SHIP_TYPES = [
  { id: 'escort', nameCn: '护航艇', atk: 0.45, armor: 0.30, hull: 1.8 },
  { id: 'destroyer', nameCn: '驱逐舰', atk: 0.60, armor: 0.40, hull: 2.2 },
  { id: 'cruiser', nameCn: '巡洋舰', atk: 0.85, armor: 0.55, hull: 3.0 },
  { id: 'capital', nameCn: '主力舰', atk: 1.20, armor: 0.75, hull: 4.2 },
];

// ============================================================================
// 单船战斗值
// ============================================================================
/**
 * 把一艘飞船换算成会战用的战斗值。
 * 只读 ship.stats 快照（建船时写入的蓝图聚合），不解析蓝图 —— 会战里没有 acc 也能算。
 */
export function combatShipOf(ship) {
  if (!ship) return null;
  const st = ship.stats || {};
  const struct = Math.max(1, Number(st.struct) || 0);
  const integ = clamp(Number(ship.state && ship.state.hullIntegrity), 0, 1);
  const hullIntegrity = Number.isFinite(integ) ? (integ > 0 ? integ : 1) : 1;
  return {
    id: ship.id || '',
    name: ship.name || ship.className || '舰船',
    className: ship.className || '',
    atk: Math.max(0, Number(st.damage) || 0),
    armor: struct * FLEET_ARMOR_RATIO,
    hull: Math.max(1, struct * hullIntegrity),
    maxHull: struct,
    speed: Math.max(0, Number(st.speed) || 0),
    hullIntegrity,
  };
}

/** 编队合计战斗值（UI 展示 / 判定「有没有武装」） */
export function fleetCombatOf(acc, fleetRef) {
  const f = resolveFleetRef(acc, fleetRef);
  if (!f) return { ships: [], atk: 0, hull: 0, maxHull: 0, armor: 0, speed: 0, count: 0, armed: 0 };
  const ships = [];
  for (const id of (f.shipIds || [])) {
    const s = (Array.isArray(acc && acc.ships) ? acc.ships : []).find((x) => x && x.id === id);
    const c = combatShipOf(s);
    if (c) ships.push(c);
  }
  let atk = 0, hull = 0, maxHull = 0, armor = 0, speed = 0, armed = 0;
  for (const c of ships) {
    atk += c.atk; hull += c.hull; maxHull += c.maxHull; armor += c.armor;
    speed += c.speed;
    if (c.atk > 0) armed++;
  }
  return {
    ships, atk, hull, maxHull, armor, armed,
    speed: ships.length ? speed / ships.length : 0,
    count: ships.length,
  };
}

// ============================================================================
// 敌方舰队（确定性）
// ============================================================================
/** 目标势力的海军基准 → 舰队战力（与 battle.js#fleetSuperiorityOf 同一口径） */
export function foeNavalPowerOf(targetId) {
  const key = String(targetId || '').replace(/^hoi_/, '');
  const n = HOI_BY_ID[key];
  if (n) return Math.max(0, Number(n.navy) || 0) * NAVY_TO_SHIP_POWER;
  // 通用 / 科幻势力没有史实海军：按工业与兵力折一份，保证「有多少家底就有多少护航力量」
  const fac = factionPower(key, HOI_BY_ID);
  return Math.round((fac.ic * 0.55 + fac.divisions * 0.35) * 2.2);
}

/**
 * 生成敌方舰队（对同一场战争恒定）。
 * @returns {{ power:number, ships:Array, byType:Array, lossRatio:number, nameCn:string, seed:number }}
 */
export function enemyFleetOf(acc, war) {
  const targetId = String((war && war.targetId) || '');
  const seedBase = hash32(targetId + '|' + String((war && war.id) || 'navy'));
  const rng = mulberry32(seedBase);

  const raw = Math.max(FLEET_MIN_FOE_POWER, foeNavalPowerOf(targetId));
  // 会战累积战果：war.navalLoss 越高，敌方残余越小（但不低于 40%）
  const loss = clamp(Number(war && war.navalLoss) || 0, 0, FLEET_NAVAL_LOSS_MAX);
  const power = Math.max(FLEET_MIN_FOE_POWER * 0.6, raw * (1 - loss));

  const count = clamp(Math.round(power / 26), 3, 24);
  const per = power / count;

  const ships = [];
  const tally = {};
  for (let i = 0; i < count; i++) {
    // 编成按「护航多、主力少」的权重抽取（不是均匀分布）
    const roll = rng();
    let t = FOE_SHIP_TYPES[0];
    if (roll > 0.55) t = FOE_SHIP_TYPES[1];
    if (roll > 0.82) t = FOE_SHIP_TYPES[2];
    if (roll > 0.95) t = FOE_SHIP_TYPES[3];
    ships.push({
      name: t.nameCn + '-' + (i + 1),
      typeId: t.id,
      atk: per * t.atk,
      armor: per * t.armor,
      hull: per * t.hull,
      maxHull: per * t.hull,
      speed: 40 + rng() * 30,
    });
    tally[t.nameCn] = (tally[t.nameCn] || 0) + 1;
  }
  const byType = Object.keys(tally).map((k) => ({ nameCn: k, count: tally[k] }));
  return {
    power: Math.round(power),
    ships, byType, lossRatio: loss, raw: Math.round(raw),
    nameCn: foeNameOf(targetId),
  };
}

/** 势力显示名（1936 查国家表，其余走通用势力名，最后兜底「敌军」） */
export function foeNameOf(targetId) {
  const key = String(targetId || '').replace(/^hoi_/, '');
  const n = HOI_BY_ID[key];
  if (n) return n.nameCn;
  try {
    const nm = factionNameCn(key, HOI_BY_ID);
    if (nm) return nm;
  } catch (e) { /* 落到兜底 */ }
  return '敌军';
}

// ============================================================================
// 会战结算
// ============================================================================
/** 按结构加权随机挑一个目标（大船更容易挨打） */
function pickTarget(list, rng) {
  let total = 0;
  for (const t of list) if (t.hull > 0) total += t.hull;
  if (!(total > 0)) return null;
  let roll = rng() * total;
  for (const t of list) {
    if (!(t.hull > 0)) continue;
    roll -= t.hull;
    if (roll <= 0) return t;
  }
  return list.find((t) => t.hull > 0) || null;
}

/** 一方齐射：返回本回合造成的总伤害 */
function volley(attackers, defenders, accuracy, rng) {
  let dealt = 0;
  for (const a of attackers) {
    if (!(a.hull > 0) || !(a.atk > 0)) continue;
    const target = pickTarget(defenders, rng);
    if (!target) break;
    const pierce = a.atk / (a.atk + Math.max(1e-6, target.armor));   // 0~1 穿甲率
    const jitter = 1 + (rng() * 2 - 1) * FLEET_DMG_JITTER;
    const dmg = a.atk * accuracy * pierce * jitter;
    target.hull -= dmg;
    dealt += dmg;
    if (target.hull <= 0) target.hull = 0;
  }
  return dealt;
}

function aliveOf(list) { return list.filter((s) => s.hull > 0); }
function hullRatio(list, maxTotal) {
  let h = 0;
  for (const s of list) h += Math.max(0, s.hull);
  return maxTotal > 0 ? h / maxTotal : 0;
}
function avgSpeed(list) {
  if (!list.length) return 0;
  let s = 0;
  for (const x of list) s += x.speed;
  return s / list.length;
}
function accuracyOf(mineSpeed, foeSpeed) {
  const sum = mineSpeed + foeSpeed;
  const share = sum > 0 ? mineSpeed / sum : 0.5;
  return clamp(FLEET_ACC_BASE + FLEET_ACC_SPAN * (share - 0.5) * 2, FLEET_ACC_MIN, FLEET_ACC_MAX);
}

/**
 * 打一场舰队会战。
 *
 * @param {object} acc 账号
 * @param {object} war 进行中的战争（war.status === 'active'）
 * @param {string[]} fleetIds 参战编队 id（可多支，合编为一路）
 * @param {object} opts { now?:number, seed?:number, ignoreCooldown?:boolean }
 * @returns {{ok:boolean, reason?:string, result?:object}}
 */
export function fleetBattle(acc, war, fleetIds, opts) {
  const o = opts || {};
  const now = Number(o.now) || Date.now();
  if (!acc || !war) return { ok: false, reason: '战争数据缺失' };
  if (war.status !== 'active') return { ok: false, reason: '这场战争已经结束' };

  const ids = Array.isArray(fleetIds) ? fleetIds : (fleetIds ? [fleetIds] : []);
  if (!ids.length) return { ok: false, reason: '请先选择参战编队' };

  // 冷却：即时结算的会战必须限频
  const lastAt = Number(war.lastFleetBattleAt) || 0;
  if (!o.ignoreCooldown && lastAt && now - lastAt < FLEET_BATTLE_COOLDOWN_MS) {
    const left = Math.ceil((FLEET_BATTLE_COOLDOWN_MS - (now - lastAt)) / 1000);
    return { ok: false, reason: '会战刚结束，还需 ' + left + ' 秒才能再次交战' };
  }

  // 收集我方参战舰船
  const ours = [];
  const seen = new Set();
  for (const fid of ids) {
    const f = resolveFleetRef(acc, fid);
    if (!f) return { ok: false, reason: '找不到编队：' + fid };
    if (f.mission) {
      return { ok: false, reason: '编队「' + f.nameCn + '」正在执行「' + fleetMissionLabel(f.mission) + '」，需先取消任务' };
    }
    for (const sid of (f.shipIds || [])) {
      if (seen.has(sid)) continue;
      seen.add(sid);
      const ship = (Array.isArray(acc.ships) ? acc.ships : []).find((x) => x && x.id === sid);
      const c = combatShipOf(ship);
      if (c) ours.push(c);
    }
  }
  if (!ours.length) return { ok: false, reason: '这些编队里没有任何舰船' };
  if (!ours.some((s) => s.atk > 0)) {
    return { ok: false, reason: '参战舰船全部没有武器（火力为 0），无法交战' };
  }

  const foeView = enemyFleetOf(acc, war);
  const theirs = foeView.ships.map((s) => ({ ...s }));

  const ourMax = ours.reduce((s, x) => s + x.maxHull, 0);
  const foeMax = theirs.reduce((s, x) => s + x.maxHull, 0);
  const ourCount0 = ours.length, foeCount0 = theirs.length;

  const seed = Number.isFinite(o.seed) ? o.seed : (hash32(String(war.id) + ':' + now) >>> 0);
  const rng = mulberry32(seed);

  const rounds = [];
  let ourRetreat = false, foeRetreat = false;

  for (let r = 1; r <= FLEET_BATTLE_MAX_ROUNDS; r++) {
    const ourAcc = accuracyOf(avgSpeed(ours), avgSpeed(theirs));
    const foeAcc = accuracyOf(avgSpeed(theirs), avgSpeed(ours));
    // 同时开火：先算双方伤害再一起结算，避免「谁先算谁占便宜」
    const dmgToFoe = volley(ours, theirs, ourAcc, rng);
    const dmgToUs = volley(theirs, ours, foeAcc, rng);

    const ourAlive = aliveOf(ours), foeAlive = aliveOf(theirs);
    const ourDead = ourCount0 - ourAlive.length;
    const foeDead = foeCount0 - foeAlive.length;
    const ourLoss = ourDead / Math.max(1, ourCount0);
    const foeLoss = foeDead / Math.max(1, foeCount0);
    const ourHull = hullRatio(ours, ourMax);
    const foeHull = hullRatio(theirs, foeMax);

    rounds.push({
      round: r,
      dmgToFoe: Math.round(dmgToFoe), dmgToUs: Math.round(dmgToUs),
      ourAcc: +ourAcc.toFixed(2), foeAcc: +foeAcc.toFixed(2),
      ourAlive: ourAlive.length, foeAlive: foeAlive.length,
      ourHull: +ourHull.toFixed(2), foeHull: +foeHull.toFixed(2),
    });

    if (ourLoss >= FLEET_RETREAT_LOSS || ourHull < FLEET_RETREAT_HULL) { ourRetreat = true; break; }
    if (foeLoss >= FLEET_RETREAT_LOSS || foeHull < FLEET_RETREAT_HULL) { foeRetreat = true; break; }
  }

  const ourLeft = aliveOf(ours), foeLeft = aliveOf(theirs);
  const ourHullEnd = hullRatio(ours, ourMax), foeHullEnd = hullRatio(theirs, foeMax);

  // 胜负：谁先撤谁输；都没撤就比剩余结构占比
  let win;
  if (ourRetreat && !foeRetreat) win = false;
  else if (foeRetreat && !ourRetreat) win = true;
  else win = ourHullEnd >= foeHullEnd;

  // ---- 击沉的船永久消失（从 acc.ships 与所有编队里摘除）----
  const sunkIds = [];
  for (const c of ours) {
    if (c.hull > 0) continue;
    sunkIds.push(c.id);
    if (Array.isArray(acc.ships)) acc.ships = acc.ships.filter((s) => !s || s.id !== c.id);
    for (const f of listFleets(acc)) {
      const i = (f.shipIds || []).indexOf(c.id);
      if (i >= 0) f.shipIds.splice(i, 1);
    }
  }
  // ---- 存活的船写回受损状态（下一场会战带着伤打）----
  for (const c of ours) {
    if (!(c.hull > 0)) continue;
    const ship = (Array.isArray(acc.ships) ? acc.ships : []).find((s) => s && s.id === c.id);
    if (ship && ship.state) {
      ship.state.hullIntegrity = clamp(c.hull / Math.max(1e-6, c.maxHull), 0, 1);
    }
  }

  const foeSunk = foeCount0 - foeLeft.length;

  // ---- 战果落账 ----
  war.lastFleetBattleAt = now;
  war.fleetBattles = (Number(war.fleetBattles) || 0) + 1;
  if (win) {
    war.navalLoss = clamp((Number(war.navalLoss) || 0) + FLEET_NAVAL_LOSS_STEP, 0, FLEET_NAVAL_LOSS_MAX);
  }
  const edge = addNavalEdge(acc, war.targetId, win ? FLEET_EDGE_STEP : -FLEET_EDGE_STEP);
  const score = addWarScore(acc, war.targetId, win, '舰队会战'
    + (win ? '告捷' : '失利') + '：击沉敌方 ' + foeSunk + ' 艘，我方损失 ' + sunkIds.length + ' 艘');

  const summary = (win ? '舰队会战获胜' : '舰队会战失利')
    + '：击沉敌方 ' + foeSunk + ' 艘，我方损失 ' + sunkIds.length + ' 艘'
    + '（' + rounds.length + ' 回合，剩余结构 我方 ' + Math.round(ourHullEnd * 100) + '% / 敌方 '
    + Math.round(foeHullEnd * 100) + '%）'
    + '　轨道控制实力 ' + (edge >= 0 ? '+' : '') + edge.toFixed(2);

  const result = {
    win, rounds, summary,
    seed,
    ourPower: Math.round(fleetPowerOf2(acc, ids)),
    foePower: foeView.power,
    foe: { nameCn: foeView.nameCn, byType: foeView.byType, power: foeView.power },
    sunkIds,
    sunkNames: ours.filter((c) => !(c.hull > 0)).map((c) => c.name),
    foeSunk,
    ourLeft: ourLeft.length, foeLeft: foeLeft.length,
    ourHull: +ourHullEnd.toFixed(3), foeHull: +foeHullEnd.toFixed(3),
    ourRetreat, foeRetreat,
    edge, score,
    navalLoss: Number(war.navalLoss) || 0,
  };

  // ---- 日志 ----
  const nav = ensureNaval(acc);
  nav.log.unshift({
    at: now, warId: war.id, targetId: war.targetId,
    win, text: summary, rounds: rounds.length, foeSunk, ourLost: sunkIds.length,
  });
  if (nav.log.length > FLEET_LOG_CAP) nav.log.length = FLEET_LOG_CAP;

  return { ok: true, result };
}

/** 多编队合计战力（用于展示；单编队直接走 fleetPowerOf 亦可） */
function fleetPowerOf2(acc, ids) {
  let sum = 0;
  for (const id of ids) {
    const f = resolveFleetRef(acc, id);
    if (f) sum += Number(fleetPowerOf(acc, f)) || 0;
  }
  return sum;
}

// ============================================================================
// 维修（受伤的船回船坞修）
// ============================================================================
// 会战伤害会一直留在 hullIntegrity 上。若不能修，玩家打完两场就只能造新船 ——
// 那不是「舰队战」而是「一次性消耗品」。
// 成本口径：每缺少 1 点完整性，按该船结构的 0.6 倍折「钢」；
// 用 ctx 注入读写，避免本模块 import state.js（同 battle.js 约定）。
/**
 * @param {object} ctx { dock:boolean, have(mat), pay(mat, qty) }
 */
export function repairFleet(acc, fleetId, ctx) {
  const c = ctx || {};
  const f = resolveFleetRef(acc, fleetId);
  if (!f) return { ok: false, reason: '找不到该编队' };
  if (!c.dock) return { ok: false, reason: '需要先在本星球建成「船坞」才能维修舰船' };

  const list = [];
  for (const id of (f.shipIds || [])) {
    const ship = (Array.isArray(acc && acc.ships) ? acc.ships : []).find((x) => x && x.id === id);
    if (!ship || !ship.state) continue;
    const integ = clamp(Number(ship.state.hullIntegrity), 0, 1);
    if (!Number.isFinite(integ) || integ >= 1) continue;
    const struct = Math.max(1, Number(ship.stats && ship.stats.struct) || 1);
    const cost = Math.max(1, Math.ceil((1 - integ) * struct * 0.6));
    list.push({ ship, cost, integ });
  }
  if (!list.length) return { ok: false, reason: '这支编队的舰船都完好，无需维修' };

  let need = 0;
  for (const x of list) need += x.cost;
  const have = typeof c.have === 'function' ? Number(c.have('钢')) || 0 : 0;
  if (have + 1e-9 < need) {
    return { ok: false, reason: '维修需要「钢」' + need + '，当前只有 ' + Math.floor(have), need, have };
  }
  if (typeof c.pay === 'function') c.pay('钢', need);
  for (const x of list) {
    if (x.ship.state) x.ship.state.hullIntegrity = 1;
  }
  return { ok: true, repaired: list.length, cost: need };
}

// ============================================================================
// UI 视图（一次取齐，避免 UI 层自己拼口径）
// ============================================================================
export function fleetWarViewOf(acc, war, now) {
  const t = Number(now) || Date.now();
  const foe = enemyFleetOf(acc, war);
  const lastAt = Number(war && war.lastFleetBattleAt) || 0;
  const coolLeft = lastAt ? Math.max(0, Math.ceil((FLEET_BATTLE_COOLDOWN_MS - (t - lastAt)) / 1000)) : 0;
  const nav = ensureNaval(acc);
  return {
    foe,
    edge: navalEdgeOf(acc, war && war.targetId),
    edgeMax: FLEET_EDGE_MAX,
    cooldownLeft: coolLeft,
    battles: Number(war && war.fleetBattles) || 0,
    navalLoss: Number(war && war.navalLoss) || 0,
    log: nav.log.filter((x) => !war || x.warId === war.id).slice(0, 5),
  };
}

/** 会战的编队战力预览（UI 用；不校验状态） */
export function fleetPreviewOf(acc, fleetId) {
  const c = fleetCombatOf(acc, fleetId);
  return {
    count: c.count, armed: c.armed,
    atk: Math.round(c.atk), hull: Math.round(c.hull), armor: Math.round(c.armor),
    speed: Math.round(c.speed),
    power: Math.round(fleetPowerOf(acc, fleetId)),
  };
}

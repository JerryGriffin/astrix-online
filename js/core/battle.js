// ============================================================================
// 战役系统（v0.3.4 新增）—— 模仿《钢铁雄心》的「战线 / 师级交战」
// ============================================================================
//
// 为什么要新增这个模块（v0.3.3 的问题）：
//   v0.3.3 的战争推进是 tickWarsHoi4 里的一行 ——
//     w.progress += (ratio - 0.5) * 4 * days，ratio = 我方总实力/(我方+敌方)
//   也就是**一根按实力差自动滑动的进度条**。玩家看得见一条 0~100 的绿/红条，
//   但看不见任何「战斗」：师不会接敌、不会被打空组织度、不会因为缺员而变弱、
//   打赢一场也不会有任何部队永久损失。于是「推进 70% 就能迫降」与
//   「我真的打赢了几场硬仗」是两件无关的事。
//
// 本模块的定位：把「战斗」从**一次性掷骰**变成**持续推进的战役**。
//   · 每个战场（battle）是一个独立对象，挂在 acc.battles，**随存档长期存在**；
//   · 每个师（division）有自己的 组织度 org / 兵力 str / 经验 xp / 状态；
//   · 每小时结算一次：交战宽度取前 N 支、算攻防值、打组织度与兵力、
//     组织度打空 → 溃退 → 整补 → 补员回战线；
//   · 胜负判定后**把战损写回真实的 acc.armies**（兵员 -N、经验 ±、战力重算），
//     并永久消耗对方的师（存在 war.foePool），因此多场战役是「消耗战」而非一次性判定。
//   · w.progress 由**战役胜负**推动，而不是实力比 —— 进度条成为战斗的结果而非机制本身。
//
// 与既有 army.js#resolveBattle 的分工：
//   · resolveBattle 保留 —— 它是**一次性、无状态、双方可各自本地复算**的
//     快照式结算（跨玩家异步邮箱模型要用，见 army.js 顶部说明）。
//     galaxy.js 的一次性 NPC 进攻仍走它。
//   · 本模块负责**玩家自己那条线上的持续战争**：看得见战况、伤亡与推进。
//
// 约定：不 import state.js（账号对象由调用方传入），与 army.js 同构。
// ============================================================================

import { armyById, armyEffStats, armyPowerOf } from './army.js?v=45.10';
import { fleetPowerOf } from './fleet.js?v=45.10';   // v0.4.0：空间舰队实力 → 轨道控制
import { HOI_BY_ID } from '../data/hoi1936.js?v=45.10';
// v0.4.1：行星战区地图 —— 战斗「在哪打」、打赢后归谁、补给通不通
import {
  ensureTheater, regionById, regionSupplyOf, refreshSupply, captureRegion,
  applyColonyProgress, decayStrikePressure, GARRISON_MAX,
  frontInfoOf, canOpenFront, REGION_MAX_FRONTS, SIEGE_REQUIRED,
} from './theater.js?v=45.10';
// 迫降线（与 core/war.js 同源常量；此处只读，避免反向依赖 war.js）
import { WAR_FORCE_SURRENDER_SCORE } from './war.js?v=45.10';
// 注意：**不 import core/hoi1936.js** —— 它要 import 本模块来驱动敌方进攻，
//   这里再反向 import 就成了循环依赖。战役时钟用本文件自己的 BATTLE_HOURS_PER_SEC。

// ---------------------------------------------------------------------------
// 一、常量（口径都尽量对齐 HOI4 的同名概念）
// ---------------------------------------------------------------------------
export const ORG_MAX = 100;                 // 组织度上限
export const BATTLE_COMBAT_WIDTH = 3;       // 战斗宽度：每方同时接战的师数上限
export const BATTLE_MAX_HOURS = 96;         // 交战上限（游戏小时）—— 超时则进攻方撤出
export const ORG_REGEN_PER_HOUR = 4.5;      // 满补给下每小时恢复组织度
export const REORG_HOURS = 10;              // 溃退后整补回战线的最短小时数
export const ENTRENCH_PER_HOUR = 0.030;     // 防御方每小时累积工事
export const ENTRENCH_MAX = 0.60;           // 工事加成上限 60%
export const BATTLE_MAX_PER_WAR = 3;        // 每场战争同时进行的战场数（多线作战）
export const DMG_K = 0.155;                 // 每小时伤害系数（决定一场战役打多久）
export const XP_ATK_PER_HOUR = 1.5;         // 参战每小时获得的经验
/** v0.3.5：装备率（后勤） */
export const EQUIP_LOSS_PER_HOUR = 0.022;    // 补给不足时每小时掉多少装备率
export const EQUIP_RECOVER_PER_HOUR = 0.012; // 补给恢复时每小时补回多少
// v0.4.0 太空化：敌方「海军」基准值 → 折算空间舰队战力
export const FLEET_POWER_PER_NAVY = 12;
// v0.4.0 **轨道轰炸**（太空专属）：控制轨道后可直接从天上打地面
export const ORBITAL_BOMB_MIN_CONTROL = 0.60; // 发起轨道轰炸所需的最低轨道控制度
export const ORBITAL_BOMB_CHARGES = 4;         // 每场战役初始轰炸次数
export const ORBITAL_BOMB_REGEN = 360;         // 每多少战斗小时恢复一次轰炸次数
export const ORBITAL_BOMB_ORG_MUL = 3.2;       // 轨道轰炸的组织度伤害倍率（相对普通火力）
export const ORBITAL_BOMB_STR_MUL = 2.4;       // 兵力伤害倍率
export const ORBITAL_BOMB_PER_CHARGE = 0.10;   // 每发轰炸打掉的地形防御加成
// v0.3.5：无人开战时的被动推进（占领区巩固等低烈度冲突），单位「进度 / 游戏天」。
//   取 0.35 意味着独自推到 70% 需要 200 游戏天 —— 只为避免战争彻底静止，
//   不构成「不操作也能赢」的捷径。
export const IDLE_PROGRESS_PER_DAY = 0.35;
export const LOG_CAP = 40;

// 战场时钟：**与 GAME_DAYS_PER_SEC 解耦**。
//   1 秒 = 1 游戏天 的话，一场 24 小时的仗 1 秒就打完了，玩家根本看不见交战过程。
//   这里让 1 真实秒 = 3 个战斗小时：一场typical 战役 4~10 秒看完，节奏可读。
export const BATTLE_HOURS_PER_SEC = 3;

// 地形 —— v0.4.0 改为**行星地貌**（弱化二战元素，向太空殖民靠拢）
//   gravity：本星球该处重力（1 = 地球基准，<1 = 低重力）
//     低重力让进攻方机动性变好、而守方的既设阵地在低重力下更难维持 —— 净效果是**利攻不利守**，
//     这是地球战争里根本不存在的机制，属于太空题材独有的战术维度。
//   hazard ：每小时触发地貌灾害的概率（陨石撞击 / 地陷 / 毒气喷出 / 尘暴）。
//   ⚠️ 旧的地球地形键（plain/forest/mountain/urban/desert）**保留**，老存档仍可读，
//      但 UI 只展示新的太空地貌。
export const BATTLE_TERRAIN = {
  // ---- 太空 / 行星地貌（v0.4.0）----
  crater:   { atk: 0.92, def: 1.22, nameCn: '环形山', gravity: 0.90, hazard: 0.020, desc: '密集撞击坑，视线与机动受限，易塌方。' },
  canyon:   { atk: 1.00, def: 1.12, nameCn: '深峡谷', gravity: 0.95, hazard: 0.015, desc: '两侧陡壁，重火力难以展开。' },
  lava:     { atk: 0.86, def: 1.14, nameCn: '熔岩地', gravity: 1.04, hazard: 0.035, desc: '地表灼热，装甲与电子设备损耗加快。' },
  ice:      { atk: 0.90, def: 1.18, nameCn: '冰盖', gravity: 0.97, hazard: 0.012, desc: '低温使组织度恢复变慢，但掩体良好。' },
  dust:     { atk: 0.88, def: 1.08, nameCn: '尘暴区', gravity: 0.90, hazard: 0.050, desc: '悬浮尘遮蔽视野，通讯与补给都受影响。' },
  dome:     { atk: 0.80, def: 1.45, nameCn: '殖民地穹顶', gravity: 1.00, hazard: 0.005, desc: '加压穹顶，可守性极强 —— 但一旦被破，里面没有退路。' },
  regolith: { atk: 1.04, def: 0.98, nameCn: '月壤平原', gravity: 0.66, hazard: 0.008, desc: '低重力开阔地，进攻方机动优势极大。' },
  // ---- 旧地球地形（保留兼容，UI 不再展示）----
  plain:    { atk: 1.05, def: 1.00, nameCn: '平原', gravity: 1.00, hazard: 0 },
  forest:   { atk: 0.95, def: 1.12, nameCn: '森林', gravity: 1.00, hazard: 0 },
  mountain: { atk: 0.88, def: 1.20, nameCn: '山地', gravity: 1.00, hazard: 0 },
  urban:    { atk: 0.90, def: 1.28, nameCn: '城市', gravity: 1.00, hazard: 0 },
  desert:   { atk: 1.06, def: 0.96, nameCn: '荒漠', gravity: 1.00, hazard: 0 },
};

/** UI 只展示太空地貌（v0.4.0：弱化二战元素） */
export const SPACE_TERRAIN_IDS = ['regolith', 'crater', 'canyon', 'dust', 'lava', 'ice', 'dome'];

/** 地貌灾害（v0.4.0 太空专属） */
export const HAZARDS = {
  meteor: { nameCn: '陨石撞击', mul: 2.6, orgMul: 1.0, desc: '一发陨石砸进阵地，触地段直接被抹平。' },
  quake:  { nameCn: '地陷',     mul: 1.3, orgMul: 2.2, desc: '地表塌陷，阵地工事与组织度一起垮。' },
  gas:    { nameCn: '毒气喷出', mul: 1.0, orgMul: 2.6, desc: '裂隙喷出毒气，暴露的部队组织度大量流失。' },
  storm:  { nameCn: '尘暴',     mul: 0.8, orgMul: 1.6, desc: '尘暴遮天，视野与补给同时恶化。' },
};

export function terrainList() {
  // v0.4.0：只列太空地貌
  return SPACE_TERRAIN_IDS.map((k) => ({
    id: k, nameCn: BATTLE_TERRAIN[k].nameCn,
    gravity: BATTLE_TERRAIN[k].gravity, hazard: BATTLE_TERRAIN[k].hazard,
    desc: BATTLE_TERRAIN[k].desc,
  }));
}

// ============================================================================
// v0.3.5：兵种模板 —— 软攻 / 硬攻 / 突破 / 防御 / 装甲 / 穿甲
// ============================================================================
// v0.3.4 只有「攻 / 防」两个数，等于没有兵种克制：装甲师和步兵师打法完全一样，
//   于是「用装甲师突破」这种 HOI4 的核心决策根本不存在。
//   v0.3.5 拆成 HOI4 的六项：
//     软攻 soft   —— 打无甲/轻甲目标
//     硬攻 hard   —— 打装甲目标
//     突破 brk    —— 进攻方打穿对方防御的额外组织度伤害（进攻属性）
//     防御 dfn    —— 挨打时的抗性（防守属性）
//     装甲 armor  —— 减伤（挡软攻）
//     穿甲 pierce —— 破装甲（把硬攻打出来）
// v0.4.0 **太空化命名**：不再用「步兵师 / 坦克师」这类二战陆战术语 ——
//   内部键（infantry/mech/armor）保留以兼容老存档，展示名改为
//   登陆兵 / 外骨骼 / 磁轨装甲 / 无人机群，并新增「无人机群」这一太空专属 expendable 编制
//   （软攻极高、防御与装甲极低 —— 一次性消耗品，正好契合太空战争的资源逻辑）。
export const DIV_TEMPLATES = {
  infantry: {
    nameCn: '登陆兵', full: '登陆兵师', soft: 1.00, hard: 0.18, brk: 0.60, dfn: 1.00, armor: 0.15, pierce: 0.05,
    desc: '通用地面部队，靠数量与软攻取胜；对装甲目标几乎无效。',
  },
  mech: {
    nameCn: '外骨骼', full: '外骨骼队', soft: 0.70, hard: 0.72, brk: 0.82, dfn: 0.88, armor: 0.56, pierce: 0.58,
    desc: '动力外骨骼，攻守均衡，能有效对抗装甲。',
  },
  armor: {
    nameCn: '磁轨装甲', full: '磁轨装甲群', soft: 0.52, hard: 1.00, brk: 0.98, dfn: 0.78, armor: 0.80, pierce: 0.75,
    desc: '磁轨炮 + 复合装甲，硬攻与穿甲最高，地面突击的矛尖。',
  },
  drone: {
    nameCn: '无人机群', full: '无人机群', soft: 1.15, hard: 0.10, brk: 0.45, dfn: 0.55, armor: 0.05, pierce: 0.02,
    desc: '一次性消耗型无人机蜂群：软攻极高、可反复投放，但装甲与防御近乎为零。',
  },
};

/** 由军队推断兵种：王牌师与 ab_thunder（突击/装甲编制）算装甲，ab_bulwark 算机械化 */
export function kindOfDivision(armyLike) {
  const id = String((armyLike && armyLike.blueprintId) || '');
  if (armyLike && armyLike.elite) return 'armor';
  if (id.indexOf('ab_thunder') >= 0) return 'armor';
  if (id.indexOf('ab_bulwark') >= 0) return 'mech';
  return 'infantry';
}

/** 轨道火力规模（读 1936 基准的 airforce 字段）—— v0.3.5 起真正参与结算，
 *  v0.4.0 语义由「空军」改为**轨道火力 / 无人机支援**（不再是二战螺旋桨飞机）。 */
export function airforceOf(nationId) {
  const n = HOI_BY_ID[String(nationId || '').replace(/^hoi_/, '')];
  return n ? Math.max(0, Number(n.airforce) || 0) : 0;
}

/** 轨道圈层控制度（0~1）：平均控制度。**决定陆军补给上限** —— 太空战争的经典逻辑：
 *  没有轨道控制，投送与补给线被切断，陆军在地面一样会崩。没有数据时按 0.5 中立。
 *  v0.4.0：这 7 个「海域」已是母星行星的**轨道圈层**（见 data/hoi1936.js 的 HOI_SEAS）。 */
export function seaControlOf(acc) {
  const seas = (acc && Array.isArray(acc.hoiSeas)) ? acc.hoiSeas : null;
  if (!seas || !seas.length) return 0.5;
  let s = 0, n = 0;
  for (const x of seas) {
    if (!x) continue;
    s += clamp(Number(x.control) || 0, 0, 1);
    n++;
  }
  return n ? s / n : 0.5;
}

/** v0.4.0：空间舰队实力比（0~1）—— 玩家舰队 vs 敌方基准舰队 */
export function fleetSuperiorityOf(acc, targetId) {
  let mine = 0;
  try {
    for (const f of (Array.isArray(acc && acc.fleets) ? acc.fleets : [])) {
      if (!f) continue;
      mine += Math.max(0, Number(fleetPowerOf(acc, f)) || 0);
    }
  } catch (e) { mine = 0; }
  const n = HOI_BY_ID[String(targetId || '').replace(/^hoi_/, '')];
  const foe = n ? Math.max(0, Number(n.navy) || 0) * FLEET_POWER_PER_NAVY : 0;
  const sum = mine + foe;
  if (!(sum > 0)) return 0.5;
  return clamp(mine / sum, 0, 1);
}

/** v0.4.0：**轨道控制**（制海权的太空化）= 圈层控制 × 舰队增益。
 *   圈层控制是玩家在「轨道圈层」页主动争夺的（主杠杆），舰队实力是**增益系数**
 *   0.55~1.0 —— 舰队被歼灭会把投送能力砍掉近一半（补给断、轨道轰炸停摆），
 *   但不会把圈层争夺的成果完全抹掉（那样舰队会变成唯一解）。
 *   这样 fleet.js 造的**空间舰队第一次真正影响陆战**。 */
export function orbitalControlOf(acc, targetId) {
  const shell = seaControlOf(acc);
  const fleet = fleetSuperiorityOf(acc, targetId);
  return clamp(shell * (0.55 + 0.45 * fleet), 0, 1);
}

// ---------------------------------------------------------------------------
// 二、确定性随机（与 army.js 同款 mulberry32，保证存档重放结果一致）
// ---------------------------------------------------------------------------
function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
let _seq = 0;
function newId() {
  _seq = (_seq + 1) % 1000000;
  return 'bt_' + Date.now().toString(36) + '_' + _seq.toString(36);
}
/** 字符串 → 32 位无符号整数（FNV-1a）。用于把「战争 id / 战场序号」变成确定性随机种子。
 *  v0.3.5：此前 seedAt 与战场 seed 都用 Math.random()，导致
 *   ① 敌方编制**每次开战都重新掷骰**（同一个对手这回全是步兵、下回全是装甲）——
 *      编制成了运气而不是可研究、可针对性的战略事实；
 *   ② 自检脚本约 1/3 的运行会随机失败（期望「敌方含装甲师」但掷出了全步兵）；
 *   ③ 与本模块开头声明的「确定性战斗结算」自相矛盾。 */
function hash32(str) {
  let h = 0x811c9dc5;
  const s = String(str);
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

// ---------------------------------------------------------------------------
// 三、战场对象的创建与查询
// ---------------------------------------------------------------------------

/** 确保账号上有战役容器（老存档自动迁移） */
export function ensureBattles(acc) {
  if (!acc) return [];
  if (!Array.isArray(acc.battles)) acc.battles = [];
  // ⚠️ foePools 是**按战争 id 键的普通对象**（不是数组）——
  //   这里**绝不能**用 Array.isArray 判断，否则每 tick 都会把它重置成 {}，
  //   敌方师池的「消耗战」进度被反复清零（表现为打了四场仗敌方师数纹丝不动）。
  if (!acc.foePools || typeof acc.foePools !== 'object' || Array.isArray(acc.foePools)) {
    acc.foePools = {};
  }
  return acc.battles;
}

export function listBattles(acc, warId) {
  const all = ensureBattles(acc);
  return warId ? all.filter((b) => b && b.warId === warId) : all;
}

export function battleById(acc, id) {
  return ensureBattles(acc).find((b) => b && b.id === id) || null;
}

export function activeBattlesOf(acc, warId) {
  return listBattles(acc, warId).filter((b) => b.status === 'active');
}

/** 战争是否已有进行中的战场占满 */
export function canOpenBattle(acc, warId) {
  return activeBattlesOf(acc, warId).length < BATTLE_MAX_PER_WAR;
}

/**
 * 开一条战线。
 * @param {object} opts { armyIds:string[], terrain:string, side:'mine'|'foe' }
 *   side='mine'（默认）＝我方进攻；side='foe' ＝**敌方进攻**，此时我方自动
 *   派出最强的若干师防守（AI 主动打过来，玩家不选兵）。
 * 校验：战争在进行中、同线战场未满、至少 1 支可用的师。
 */
export function startBattle(acc, war, opts) {
  ensureBattles(acc);
  const o = opts || {};
  if (!acc || !war || war.status !== 'active') return { ok: false, reason: '这场战争不在进行中' };
  if (!canOpenBattle(acc, war.id)) {
    return { ok: false, reason: '该战线已同时进行 ' + BATTLE_MAX_PER_WAR + ' 个战场，先等一个分出胜负' };
  }
  // v0.4.1：在地图的某个战区开战 → 地貌取自该战区，并计入驻防与补给网络
  // v0.4.2：允许**同一战区多条战线**（多方向夹击），但上限 REGION_MAX_FRONTS；
  //   来自**同一来源**的多条战线伤害会被平分（叠加无效），来自**不同来源**才形成夹击。
  let region = null;
  if (o.regionId) {
    const t = ensureTheater(acc);
    region = regionById(t, o.regionId);
    if (!region) return { ok: false, reason: '战区不存在：' + o.regionId };
    if (!canOpenFront(acc, o.regionId)) {
      return { ok: false, reason: (region.nameCn || '该战区') + ' 已有 ' + REGION_MAX_FRONTS + ' 条战线在交战中' };
    }
    // v0.4.2：进攻必须来自**相邻的我方战区**（地图层的空间规则）
    if (!o.side || o.side !== 'foe') {
      if (!o.originId) return { ok: false, reason: '缺少进攻来源战区（originId）' };
      const from = regionById(t, o.originId);
      const okAdj = from && Math.abs(from.x - region.x) <= 1 && Math.abs(from.y - region.y) <= 1;
      if (!okAdj) return { ok: false, reason: '只能从相邻战区发起进攻' };
      if (from.owner !== t.myNation) return { ok: false, reason: '进攻来源战区不属于我方' };
    }
  }
  const terrain = region ? region.terrain
    : (BATTLE_TERRAIN[o.terrain] ? o.terrain : 'regolith');
  const foeAttacks = o.side === 'foe';
  const mine = [];
  if (foeAttacks) {
    // 敌方进攻：我方按战力从高到低自动顶上去防守（HOI4 的「对方打过来」）
    const pool = (Array.isArray(acc.armies) ? acc.armies : [])
      .filter((a) => a && (Number(a.men) || 0) > 0 && !findDiv(acc, war.id, a.id))
      .map((a) => ({ a, s: armyEffStats(a) || a.stats || {} }))
      .sort((x, y) => ((Number(y.s.atk) || 0) + (Number(y.s.def) || 0))
                    - ((Number(x.s.atk) || 0) + (Number(x.s.def) || 0)));
    const take = Math.min(pool.length, BATTLE_COMBAT_WIDTH + 2);
    for (let i = 0; i < take; i++) mine.push(mineToDiv(acc, pool[i].a));
  } else {
    const ids = Array.isArray(o.armyIds) ? o.armyIds : [];
    for (const id of ids) {
      const a = armyById(acc, id);
      if (!a) continue;
      if (findDiv(acc, war.id, id)) continue;      // 同一场战争里不能重复编入
      if ((Number(a.men) || 0) <= 0) continue;    // 兵员耗尽的师不出战
      mine.push(mineToDiv(acc, a));
    }
  }
  if (!mine.length) return { ok: false, reason: '没有可用的师（兵员已耗尽，或全部已在其他战线）' };

  const foe = buildFoePool(acc, war, o.foeDivisions);
  if (!foe.divisions) return { ok: false, reason: '对方已无可调之师（已被打垮），可直接发动迫降' };

  const b = {
    id: newId(),
    warId: war.id,
    targetId: war.targetId,
    targetName: war.targetName,
    attacker: foeAttacks ? 'foe' : 'mine',
    terrain,
    regionId: region ? region.id : null,   // v0.4.1：这场仗发生在哪个战区
    originId: o.originId || null,       // v0.4.2：从哪个战区发起（用于夹击判定）
    startedAt: Date.now(),
    hours: 0,
    status: 'active',
    seed: hash32('battle:' + war.id + ':' + ((Number(war.battles) || 0) + listBattles(acc, war.id).length)),
    mine,
    foe: takeFoe(foe, Math.max(mine.length, BATTLE_COMBAT_WIDTH)),
    entrench: { mine: foeAttacks ? 0.5 : 0, foe: foeAttacks ? 0 : 0.5 },  // 防守方开局有阵地优势
    supply: { mine: 1, foe: 1 },
    result: null,
    log: [],
    // v0.4.5（需求 2）：指挥官 + 战役事件历史
    commanderId: opts && opts.commanderId ? opts.commanderId : null,
    commanderEffect: null,
    events: [],
    mineAtkMul: 1,
    foeAtkMul: 1,
    entrenchMul: 1,
  };
  recomputeSupply(acc, b);
  if (b.commanderId) {
    // 从 opts 指定（或名册第一位）挂指挥官
    const list = commandersOf(acc);
    const c = list.find((x) => x && x.id === b.commanderId) || list[0];
    if (c) { b.commanderId = c.id; b._commander = c; b.commanderEffect = commanderEffectOf(b); }
  }
  ensureBattles(acc).push(b);
  if (region) region.battleId = b.id;      // 标记该战区在交战中
  pushLog(b, (foeAttacks ? '敌 ' + war.targetName + ' 打过来' : '开辟战线：' + war.targetName)
    + ' · ' + (region ? region.nameCn + '（' : '') + BATTLE_TERRAIN[terrain].nameCn
    + (region ? '）' : '') + '（投入 ' + mine.length + ' 个师，敌方 ' + b.foe.length + ' 个师）');
  return { ok: true, battle: b, region };
}

function findDiv(acc, warId, armyId) {
  return ensureBattles(acc).find((b) => b && b.warId === warId && b.status === 'active'
    && Array.isArray(b.mine) && b.mine.some((d) => d.armyId === armyId)) || null;
}

// ---------------------------------------------------------------------------
// 四、师（division）—— 双方统一的战斗单位
// ---------------------------------------------------------------------------

/** 我方师：由真实 acc.armies 派生（战力口径与军队面板一致）
 *
 *  ⚠️ v0.3.4 重要修正：**不要**用 armyEffStats() 重算攻防。
 *    armyEffStats 是「按蓝图部件+材料」重新推导数值，而 1936 剧本的师是
 *    hoi1936.js#setupArmies **按国家工业/兵种/王牌手工赋值**的（德国 atk 194 / def 144）。
 *    两者不是一个量级：实测 armyEffStats(ab_ranger) 只有 atk 24 / def 12.9。
 *    一旦用 armyEffStats 覆盖，国军 30 个师会被悄悄削掉近 8 倍战力，
 *    战线「必败」且完全查不出原因。故这里一律以 a.stats 为准，训练/经验加成另行叠加。
 */
function mineToDiv(acc, a) {
  const st = (a && a.stats) || armyEffStats(a) || {};
  // 首次参战时固化「满编基准」，后续战力按兵员比例缩放（避免反复缩放导致复利式衰减）
  if (a && !a._baseStats) {
    a._baseStats = {
      atk: Number(st.atk) || 0,
      def: Number(st.def) || 0,
      speed: Number(st.speed) || 0,
    };
  }
  if (a && !(Number(a.menMax) > 0) && (Number(a.men) > 0)) a.menMax = Number(a.men);
  const strMax = Math.max(1, Number(a.men) || 1);
  const cur = clamp(Number(a.men) || strMax, 0, strMax);
  const base = a._baseStats || st;
  const atk = Math.max(0, (Number(base.atk) || 0) + (Number(a.bonusAtk) || 0));
  const def = Math.max(0, (Number(base.def) || 0) + (Number(a.bonusDef) || 0));
  // v0.3.5：把 atk/def 拆成六项 HOI4 属性（兵种模板决定比例）
  const kind = kindOfDivision(a);
  const tpl = DIV_TEMPLATES[kind] || DIV_TEMPLATES.infantry;
  return {
    armyId: a.id,
    nameCn: a.nameCn,
    kind, kindCn: tpl.nameCn,
    atk,                                   // 保留：面板与旧逻辑的粗口径攻防
    def,
    softAtk: atk * tpl.soft,
    hardAtk: atk * tpl.hard,
    breakthrough: def * tpl.brk,
    defense: def * tpl.dfn,
    armor: tpl.armor,
    pierce: tpl.pierce,
    equip: 1,                              // 装备率 0~1：补给差会持续掉，补给好会恢复
    org: ORG_MAX,
    orgMax: ORG_MAX,
    str: cur,
    strMax,
    // 记录入战时的满编兵力，结算时按损失比例回写兵员
    strAtEntry: strMax,
    state: 'front',              // front 接战 / reserve 预备 / routed 溃退整补 / done 已成建制撤出
    hoursOut: 0,
    xp: 0,
    retreatOrder: false,          // 玩家下令撤退（HOI4 的「撤退」命令）
  };
}

/** 敌方师池：从 1936 基准生成，并**跨战役持久消耗**（war.foePool） */
function foePoolKey(war) { return String(war.id || ''); }

function buildFoePool(acc, war, wantCount) {
  const key = foePoolKey(war);
  if (!acc.foePools[key]) {
    const n = HOI_BY_ID[String(war.targetId || '').replace(/^hoi_/, '')];
    acc.foePools[key] = {
      ic: n ? (Number(n.ic) || 20) : 20,
      divisions: Math.max(3, Math.round((n ? Number(n.divisions) : 12) * 0.6)),
      nameCn: (n && n.nameCn) || war.targetName || '敌国',
      killed: 0,
      // v0.3.5：种子由战争 id 决定 —— 同一个对手的编制在整场战争中**保持一致**，
      //   玩家可以研究并针对性配兵（而不是每场重新掷骰）。
      seedAt: hash32('foePool:' + key),
    };
  }
  return acc.foePools[key];
}

function takeFoe(pool, want) {
  const rng = mulberry32(pool.seedAt);
  const n = Math.max(1, Math.min(pool.divisions, want));
  const out = [];
  // 工业越高，师越精锐（攻防更高、装甲更硬）
  const icMul = 0.75 + Math.min(1.0, pool.ic / 90);
  for (let i = 0; i < n; i++) {
    const base = 30 * icMul;
    // 工业越高，装甲/机械化编制占比越高（1936 年德国 25% 左右）
    const roll = rng();
    const armoredP = 0.10 + Math.min(0.25, pool.ic / 400);
    let kind = 'infantry';
    if (roll < armoredP) kind = 'armor';
    else if (roll < armoredP * 2.2) kind = 'mech';
    const tpl = DIV_TEMPLATES[kind];
    const atk = Math.round(base * (kind === 'infantry' ? 1.0 : 1.3) * (0.9 + rng() * 0.2));
    const def = Math.round(base * (kind === 'infantry' ? 1.0 : 1.2) * (0.9 + rng() * 0.2));
    out.push({
      nameCn: pool.nameCn + ' 第' + (i + 1) + tpl.nameCn + '师',
      kind, kindCn: tpl.nameCn,
      atk, def,
      softAtk: atk * tpl.soft,
      hardAtk: atk * tpl.hard,
      breakthrough: def * tpl.brk,
      defense: def * tpl.dfn,
      armor: tpl.armor,
      pierce: tpl.pierce,
      equip: 1,
      org: ORG_MAX,
      orgMax: ORG_MAX,
      str: 1000,
      strMax: 1000,
      state: 'front',
      hoursOut: 0,
      xp: 0,
    });
  }
  pool.divisions -= n;             // 这些师已投入战场，战败即消耗
  return out;
}

// ---------------------------------------------------------------------------
// 五、补给（HOI4 的 supply）
//   工业决定能同时养多少师；补给影响 **伤害、组织度恢复、整补速度、工事累积**。
//   所以「打瘫工业」会真实地让战线崩掉，而不是只让进度条变慢。
// ---------------------------------------------------------------------------
function recomputeSupply(acc, b) {
  let ic = 0;
  try {
    const inst = (acc && acc._homeInst) || null;
    if (inst && inst.hoiIndustry) ic = Number(inst.hoiIndustry.ic) || 0;
  } catch (e) { ic = 0; }
  if (!(ic > 0)) {
    // 兜底：用国家基准工业（拿不到实时数据也不要退化成 0 补给）
    const n = HOI_BY_ID[String(acc && acc.nation || '')];
    ic = n ? (Number(n.ic) || 20) : 20;
  }
  const committed = Math.max(1, b.mine.length);
  b.supply = b.supply || {};
  // v0.3.5：**制海权决定补给上限**（HOI4 的经典逻辑）。
  //   以前补给只看工业 `ic/(投入师数×3)`，而这个值极易触顶 clamp(…,0,1) = 1
  //   （德国 ic=60 投入 8 个师 → 60/24 = 2.5 → 直接满补给），
  //   于是**整个补给系统长期恒等于 1、完全是摆设**，海战与陆战彻底无关。
  //   现在制海权作为**上限**：seaCtrl=0（丢海）→ 补给封顶 45%；seaCtrl=1 → 封顶 100%。
  //   即使工业再高，丢了制海权也补不上前线 —— 海运被切断。
  const seaCtrl = seaControlOf(acc);
  b.seaCtrl = seaCtrl;
  // v0.4.0：真正的「轨道控制」= 圈层争夺 × 空间舰队实力（fleet.js 的船第一次影响陆战）
  const orbCtrl = orbitalControlOf(acc, b.targetId);
  b.orbitalControl = orbCtrl;
  const icBase = clamp(ic / (committed * 3), 0, 1);          // 工业/兵力 = 过 stretch
  const seaCap = 0.45 + 0.55 * orbCtrl;                       // 轨道投送能力决定补给上限
  b.supply.mine = clamp(Math.min(icBase, seaCap), 0.08, 1);

  const pool = acc.foePools[foePoolKey({ id: b.warId })] || null;
  const foeDiv = Math.max(1, (pool ? pool.divisions : 8) + b.foe.length);
  const foeIc = pool ? pool.ic : 20;
  // 对方补给被我方战争分数与战役数压制（对应 HOI4 的敌方补给被掐断）
  const war = (acc.wars || []).find((w) => w && w.id === b.warId);
  const pressure = war ? clamp((Number(war.myScore) || 0) * 0.004, 0, 0.6) : 0;
  // v0.3.5：**我方制海权反向封锁对方补给** —— 我海运通畅，它的海运就断
  //   v0.4.0：改为「我方轨道控制反向压制对方补给」
  const foeIcBase = clamp(foeIc / (foeDiv * 3), 0, 1);
  const foeSeaCap = 0.45 + 0.55 * (1 - orbCtrl);
  b.supply.foe = clamp(Math.min(foeIcBase, foeSeaCap) * (1 - pressure), 0.06, 1);
  // v0.4.1：**补给网络**。若战场是我方战区，取该战区的网络系数
  //   （被敌方切断的孤立战区补给腰斩 —— 于是「打穿走廊」才有意义）。
  if (b.regionId) {
    const t = ensureTheater(acc);
    const rg = regionById(t, b.regionId);
    if (rg && rg.owner === t.myNation) {
      b.supply.mine = clamp(b.supply.mine * (regionSupplyOf(acc, rg) || 0.5), 0.05, 1);
    }
  }
}

// ---------------------------------------------------------------------------
// 六、每小时交战结算 —— 本模块的核心
// ---------------------------------------------------------------------------

/** 取实际接战的师（战斗宽度：只让前 N 支满编接战，其余排队当预备队） */
function engagedOf(side) {
  return side.filter((d) => d.state === 'front' && d.org > 0).slice(0, BATTLE_COMBAT_WIDTH);
}

/**
 * v0.3.5：软硬分离 + 装甲/穿甲的**逐对**结算。
 *   目标装甲 a∈[0,1]：
 *     软攻被装甲挡住 —— soft × (1 − 0.55a)
 *     硬攻靠穿甲破 —— hard × (1 + 1.2·max(0, p − a)) × (1 − 0.20a)
 *       ⇒ 穿甲**低于**目标装甲时没有加成（打不动）；高于才有压制效果。
 *   于是形成 HOI4 的克制环：装甲师打步兵极猛、步兵打装甲极吃力、装甲对装甲靠穿甲质量。
 */
function effAtkAgainst(a, targetArmor) {
  const armor = clamp(Number(targetArmor) || 0, 0, 1);
  const pierce = clamp(Number(a.pierce) || 0, 0, 1);
  const soft = (Number(a.softAtk) || 0) * (1 - 0.55 * armor);
  const pierceAdv = 1 + 1.2 * Math.max(0, pierce - armor);
  const hard = (Number(a.hardAtk) || 0) * pierceAdv * (1 - 0.20 * armor);
  return Math.max(0, soft * 0.62 + hard * 0.55);
}

/** 单个师的一次交火贡献：组织度/经验/装备/补给/宽度共同作用 */
function unitPower(d, key, supply, terrainMul, entrench) {
  const orgFactor = 0.45 + 0.55 * (d.org / (d.orgMax || ORG_MAX));   // 组织度越低输出越低
  const xpMul = 1 + Math.min(0.5, (Number(d.xp) || 0) / 400);        // 经验加成，封顶 50%
  const equipMul = 0.40 + 0.60 * clamp(Number(d.equip == null ? 1 : d.equip), 0, 1);
  const supplyMul = 0.55 + 0.45 * clamp(supply, 0, 1);
  return Math.max(0, Number(d[key]) || 0) * orgFactor * xpMul * equipMul * supplyMul
    * terrainMul * (1 + (Number(entrench) || 0));
}

/** 某方一次交火的有效战力（用于突破比与面板读数） */
function powerOf(divs, key, supply, terrainMul, entrench) {
  let p = 0;
  for (const d of divs) p += unitPower(d, key, supply, terrainMul, entrench);
  // 接战宽度不足 3 支时战斗力打折（HOI4 宽度惩罚）
  const widthPen = divs.length < BATTLE_COMBAT_WIDTH ? (0.6 + 0.4 * (divs.length / BATTLE_COMBAT_WIDTH)) : 1;
  return p * widthPen;
}

/** 单步：推进一个战斗小时 */
function stepHour(acc, b) {
  const rng = mulberry32((b.seed + b.hours * 2654435761) >>> 0);
  const terrain = BATTLE_TERRAIN[b.terrain] || BATTLE_TERRAIN.plain;
  const supply = b.supply || { mine: 1, foe: 1 };

  // ① 溃退的师整补（补给越差越慢）→ 满组织度后若战线有空位则归队
  //    同时结算**装备率**：补给不足会持续掉装备，补给恢复则慢慢补回。
  //    这是 HOI4 的后勤逻辑 —— 断补给的师不只是打不痛，组织度也回不来。
  for (const side of [b.mine, b.foe]) {
    const sup = side === b.mine ? supply.mine : supply.foe;
    for (const d of side) {
      if (d.state === 'routed') {
        d.org = Math.min(ORG_MAX, d.org + ORG_REGEN_PER_HOUR * (0.4 + 0.6 * sup));
        d.hoursOut += 1;
        if (d.org >= ORG_MAX * 0.95 && d.hoursOut >= REORG_HOURS) {
          d.state = 'front';
          d.hoursOut = 0;
        }
      } else if (d.state === 'reserve' && d.org < ORG_MAX) {
        d.org = Math.min(ORG_MAX, d.org + ORG_REGEN_PER_HOUR * (0.4 + 0.6 * sup));
      }
      // 装备率：目标值由补给决定（补给 ≥50% 维持满装，否则按补给打折）
      const cur = clamp(Number(d.equip == null ? 1 : d.equip), 0, 1);
      const target = sup >= 0.5 ? 1 : sup * 1.7;
      const rate = (target > cur ? EQUIP_RECOVER_PER_HOUR : EQUIP_LOSS_PER_HOUR)
        * (0.5 + 0.5 * sup) * (d.state === 'front' ? 1.25 : 1);
      d.equip = clamp(cur + Math.sign(target - cur) * rate, 0, 1);
    }
  }

  // ② 接战师 + 宽度超额者转预备队（HOI4：宽度满了后面的排队）
  const mineEng = engagedOf(b.mine);
  const foeEng = engagedOf(b.foe);
  for (const d of b.mine) {
    if (d.state === 'front' && !mineEng.includes(d)) d.state = 'reserve';
  }
  for (const d of b.foe) {
    if (d.state === 'front' && !foeEng.includes(d)) d.state = 'reserve';
  }
  // 宽度有空位则把预备队顶上去（按战力从高到低）
  fillFront(b.mine, mineEng);
  fillFront(b.foe, foeEng);

  if (!mineEng.length || !foeEng.length) {
    // 有一方无兵可战 —— 交给判定环节处理（可能是溃退中）
    if (!mineEng.length && !b.mine.some((d) => d.state !== 'done')) return 'over';
    if (!foeEng.length && !b.foe.some((d) => d.state !== 'done')) return 'over';
  }

  // ③ 战役事件（v0.4.5 需求 2）：让战争有转折点，而不是一条匀速下行的直线。
  //   每个战斗小时按确定性概率抽一个事件，真实改变组织度 / 兵力 / 补给 / 工事。
  //   事件**偏向弱势一方**（补给前突只帮落后的人、哗变两边都可能发生），
  //   使战线出现「反扑机会」，而不是强者一路碾压。
  const ce = b.commanderEffect || null;
  const evRng = mulberry32((b.seed + b.hours * 40503 + 7919) >>> 0);
  const ev = rollBattleEvent({ id: b.warId }, b.regionId, b.hours, b.seed);
  if (ev) {
    // pickSide：偏向当前较弱的一方（补给差 / 兵力少），制造翻盘可能
    const mineScore = b.mine.reduce((s, d) => s + (d.state === 'done' ? 0 : (d.str || 0)), 0);
    const foeScore = b.foe.reduce((s, d) => s + (d.state === 'done' ? 0 : (d.str || 0)), 0);
    const weakFirst = (supply.mine <= supply.foe || mineScore <= foeScore) ? 'mine' : 'foe';
    const evCtx = {
      rng: evRng,
      divs: { mine: b.mine, foe: b.foe },
      orgDmg: {}, orgBuff: {}, strDmg: {}, xpAdd: {},
      supplyAdd: { mine: 0, foe: 0 }, entrenchBonus: {},
      routed: {}, toReserve: {}, hitName: {},
      foeAtkMul: null, mineAtkMul: null,
      terrainIsMine: !!(terrain.atk >= 1),
      divsOf: (side) => b[side].filter((d) => d && d.state !== 'done'),
      pickSide: () => (evRng() < 0.55 ? weakFirst : (weakFirst === 'mine' ? 'foe' : 'mine')),
    };
    // target 限定的事件只在对应方生效（scout/resupply 等）
    if (ev.target === 'mine' || ev.target === 'foe') evCtx.pickSide = () => ev.target;
    applyBattleEvent(acc, b, ev, evCtx);
  }

  // ③b 指挥官修正（v0.4.5 需求 2）：把「谁来指挥」变成真实决策
  if (ce) {
    if (ce.atkMul && ce.atkMul !== 1) {
      b.mineAtkMul = ce.atkMul;
    }
    if (ce.entrenchMul && ce.entrenchMul !== 1) b.entrenchMul = ce.entrenchMul;
    if (ce.supplyMul && ce.supplyMul !== 1) {
      b.supply.mine = clamp(b.supply.mine * ce.supplyMul, 0.05, 1);
      supply.mine = b.supply.mine;
    }
    if (ce.orgRegenMul && ce.orgRegenMul !== 1) {
      for (const d of b.mine) {
        if (d.state === 'reserve' || d.state === 'routed') {
          d.org = Math.min(ORG_MAX, d.org + ORG_REGEN_PER_HOUR * (ce.orgRegenMul - 1) * (0.4 + 0.6 * supply.mine));
        }
      }
    }
    if (ce.equipRecoverMul && ce.equipRecoverMul !== 1) {
      for (const d of b.mine) {
        if ((Number(d.equip == null ? 1 : d.equip)) < 1) {
          d.equip = clamp(d.equip + EQUIP_RECOVER_PER_HOUR * (ce.equipRecoverMul - 1), 0, 1);
        }
      }
    }
  }

  // ④ 工事累积：防守方（此刻没在推进的一方）越打越难打
  //   v0.4.5：工事累积速率受指挥官 entrenchMul 影响（工兵/防御型能更快筑起阵地）
  b.entrench = b.entrench || { mine: 0, foe: 0 };
  const entMul = (b.entrenchMul && ce) ? ce.entrenchMul : 1;
  const mineAdvancing = mineEng.length > 0;
  if (!mineAdvancing) b.entrench.foe = Math.min(ENTRENCH_MAX, b.entrench.foe + ENTRENCH_PER_HOUR * (0.4 + 0.6 * supply.foe));
  if (!foeEng.length) b.entrench.mine = Math.min(ENTRENCH_MAX, b.entrench.mine + ENTRENCH_PER_HOUR * (0.4 + 0.6 * supply.mine) * entMul);

  // ④ 攻防值与突破（breakthrough）
  //   v0.4.0 **低重力修正**：gravity < 1 时进攻方机动性提升、守方阵地更难维持
  //   （dome 殖民地穹顶有加压环境，不受低重力影响 —— 用 gravity=1 表示）。
  const grav = Number(terrain.gravity) || 1;
  const atkGrav = grav < 1 ? (1 + (1 - grav) * 0.85) : 1;   // 低重力利攻，最多 +28%
  const defGrav = grav < 1 ? (1 - (1 - grav) * 0.55) : 1;   // 低重力利守变差
  // v0.4.1 **战区驻防 + 轨道打击瘫痪**：
  //   · 驻防（garrison）给守方额外防御 —— 所以「先打哪一仗」要看驻防厚薄；
  //   · 战略轨道打击留下的 strikePressure 会削弱守方 —— 这就是「先瘫痪要地再登陆」。
  let garrisonBonus = 0, strikePenalty = 0, flank = 0;
  if (b.regionId) {
    const t = ensureTheater(acc);
    const rg = regionById(t, b.regionId);
    if (rg) {
      garrisonBonus = clamp(Number(rg.garrison) || 0, 0, GARRISON_MAX);
      strikePenalty = clamp(Number(rg.strikePressure) || 0, 0, 0.6);
    }
    // v0.4.2 **夹击**：同一战区有多个**不同来源方向**的正面时，守方防御额外下降。
    //   同来源的多条战线按份平分伤害（叠加无效）—— 所以「多派兵」没用，
    //   「多路同时打」才有用，这正是包围战术的意义。
    const fi = frontInfoOf(acc, b.regionId);
    flank = fi.flank;
    const sameOrigin = fi.perOrigin[b.originId || ('b' + b.id)] || 1;
    b.overlapShare = 1 / Math.max(1, sameOrigin);
    b.flank = flank;
    b.fronts = fi.fronts;
  }
  b.garrison = garrisonBonus;
  b.strikePenalty = strikePenalty;
  const defTerrain = terrain.def * (1 + garrisonBonus) * (1 - strikePenalty) * (1 - flank);
  const atkP = powerOf(mineEng, 'breakthrough', supply.mine, terrain.atk * atkGrav * (1 + strikePenalty * 0.5), b.entrench.mine);
  const defP = powerOf(foeEng, 'defense', supply.foe, defTerrain, b.entrench.foe);
  b.gravity = grav;
  const tot = atkP + defP;
  const ratio = tot > 0 ? atkP / tot : 0.5;
  // 突破：攻击力显著超过对方防御力时，守方组织度额外崩塌（HOI4 breakthrough）
  const breakthrough = clamp((atkP - defP * 0.85) / Math.max(1, defP), 0, 1);

  b.breakthrough = { mine: breakthrough, foe: clamp((defP - atkP * 0.85) / Math.max(1, atkP), 0, 1) };
  b.lastPower = { atk: Math.round(atkP), def: Math.round(defP) };

  // ④b 空军支援（v0.3.5：airforce 从「只显示的数字」变成真正的战力系数）
  //   制空权 = 我方空军 / 双方空军之和；近距空中支援放大进攻伤害并加剧守方组织度损失。
  const air = airBalanceOf(acc, b);
  b.air = air;
  const casMine = air.casMine, casFoe = air.casFoe;

  // ⑤ 逐对结算伤害：软/硬分离 + 装甲/穿甲（v0.3.5 的核心）
  //    先把每个进攻师的**有效攻击**按对目标装甲算好，再按目标师分摊。
  //    v0.4.2：乘上「同来源平摊 × 夹击加成」
  const overlap = Number(b.overlapShare) || 1;
  const flankMul = 1 + (Number(flank) || 0);
  // v0.4.5（需求 2）：指挥官对**我方进攻**的加成，以及事件带来的短时攻击力修正。
  //   注意 assault 类的加成只作用于进攻方向，防御型指挥官不会白送攻击力。
  const cmdAtk = (b.mineAtkMul && ce) ? Math.max(0.5, b.mineAtkMul) : 1;
  const evFoeAtk = (b.foeAtkMul == null) ? 1 : Math.max(0.5, b.foeAtkMul);
  const dmgOrgFoe = DMG_K * atkP * (0.55 + 0.9 * ratio) * (1 + breakthrough) * casMine * overlap * flankMul * cmdAtk * evFoeAtk;
  const dmgStrFoe = DMG_K * atkP * ratio * 0.55 * casMine * overlap * flankMul * cmdAtk * evFoeAtk;
  const dmgOrgMine = DMG_K * defP * (0.55 + 0.9 * (1 - ratio)) * (1 + b.breakthrough.foe) * casFoe;
  let dmgStrMine = DMG_K * defP * (1 - ratio) * 0.55 * casFoe;
  // 后勤型指挥官降低我方减员（只削兵力伤害，不影响组织度 —— 那是「挨打」的度量）
  if (ce && ce.casualtyMul && ce.casualtyMul !== 1) dmgStrMine *= ce.casualtyMul;

  const newlyRoutedMine = applyDamage(mineEng, dmgOrgMine, dmgStrMine, rng, b, 'mine', foeEng);
  const newlyRoutedFoe = applyDamage(foeEng, dmgOrgFoe, dmgStrFoe, rng, b, 'foe', mineEng);

  // ⑥ 经验（参战的师涨经验，HOI4 veteran）
  const cmdXp = (ce && ce.xpMul) ? ce.xpMul : 1;
  for (const d of mineEng) d.xp = (Number(d.xp) || 0) + XP_ATK_PER_HOUR * cmdXp;

  if (newlyRoutedFoe) pushLog(b, '敌方 ' + newlyRoutedFoe + ' 个师组织度被打空，撤出战斗');
  if (newlyRoutedMine) pushLog(b, '我方 ' + newlyRoutedMine + ' 个师被打退，正在整补');

  // ⑦ v0.4.0 太空专属：轨道轰炸 + 地貌灾害
  tryHazards(acc, b, rng, mineEng, foeEng, terrain, grav);
  tryOrbitalBomb(acc, b, rng, mineEng, foeEng);

  b.hours += 1;
  return 'ok';
}

/**
 * v0.4.0 地貌灾害：按地形 hazard 概率每小时触发（陨石撞击 / 地陷 / 毒气 / 尘暴）。
 *   这是地球战争里不存在的机制 —— 行星表面本身会打你。
 *   同时让「补给」有第二条被消耗的路径：尘暴/毒气直接压低本小时补给。
 */
// ============================================================================
// v0.4.5 需求 2：战役事件 —— 让战争「有事情发生」，而不只是数值互砍
// ============================================================================
//
// v0.4.4 之前的战役，节奏是完全均匀的：每个战斗小时双方的伤害按同一套
// 公式结算，胜负几乎只取决于初始战力对比 + 一点点地貌随机。
// 于是「战争过程」在体感上是**一条直线**——玩家看着进度条匀速下滑，
// 既没有转折点，也没有任何值得记住的时刻。
//
// 这里引入**战役事件**：每个战斗小时按概率抽一个事件，事件会真实改变
// 双方的组织度 / 兵力 / 补给 / 工事 / 宽度，并且**偏向弱势一方**
// （给落后的人翻盘机会），使战线出现节奏感与戏剧性。
//
// 设计原则：
//   · 事件对双方**对称可选**（同一个事件可能落在任一方），不是单方面惩罚
//   · 有正（己方得利）也有负（己方受损），玩家要判断当前局面该不该赌
//   · 全部走确定性随机（种子来自战局），保证双端结算一致
// ============================================================================

export const BATTLE_EVENTS = [
  {
    id: 'scout', nameCn: '侦察突破', target: 'any', weight: 1.0, effect: 'info',
    desc: '侦察兵摸清了对方纵深部署：敌方接战师攻击力暂时下降。',
    apply: (ctx) => { ctx.foeAtkMul = Math.min(ctx.foeAtkMul, 0.82); return '敌方攻击力 −18%'; },
  },
  {
    id: 'sapper', nameCn: '工程兵开缺口', target: 'any', weight: 0.9, effect: 'org',
    desc: '工兵炸开一道堑壕缺口：该方向守方组织度被压低。',
    apply: (ctx) => {
      const side = ctx.pickSide();
      ctx.orgDmg[side] = (ctx.orgDmg[side] || 0) + 12;
      return (side === 'mine' ? '我方' : '敌方') + '一名师组织度 −12（阵地被撕开）';
    },
  },
  {
    id: 'resupply', nameCn: '补给前突', target: 'mine', weight: 0.9, effect: 'supply',
    desc: '补给线打通：本方补给回升，装备率快速恢复。',
    apply: (ctx) => {
      ctx.supplyAdd.mine = Math.min(1, ctx.supplyAdd.mine + 0.22);
      return '我方补给 +22%，装备率加速恢复';
    },
  },
  {
    id: 'enemyResupply', nameCn: '敌方补给到位', target: 'foe', weight: 0.9, effect: 'supply',
    desc: '对方后勤线打通：敌方补给回升，工事累积加快。',
    apply: (ctx) => {
      ctx.supplyAdd.foe = Math.min(1, ctx.supplyAdd.foe + 0.22);
      ctx.entrenchBonus.foe = (ctx.entrenchBonus.foe || 0) + 0.05;
      return '敌方补给 +22%，工事额外 +5%';
    },
  },
  {
    id: 'generalOffensive', nameCn: '发动总攻', target: 'mine', weight: 0.7, effect: 'str',
    desc: '全线压上：进攻方组织度大增，但自身伤亡也加重。',
    apply: (ctx) => {
      ctx.orgBuff.mine = (ctx.orgBuff.mine || 0) + 10;
      ctx.strDmg.foe = (ctx.strDmg.foe || 0) + 8;
      return '我方全员组织度 +10，并额外造成敌方兵力伤害';
    },
  },
  {
    id: 'attrition', nameCn: '阵地消耗战', target: 'any', weight: 1.1, effect: 'str',
    desc: '双方反复拉锯：接战双方都掉兵力，谁的地形更有利谁少掉。',
    apply: (ctx) => {
      const cheap = ctx.terrainIsMine ? 'mine' : 'foe';
      const dear = cheap === 'mine' ? 'foe' : 'mine';
      ctx.strDmg[cheap] = (ctx.strDmg[cheap] || 0) + 2;
      ctx.strDmg[dear] = (ctx.strDmg[dear] || 0) + 5;
      return '接战双方持续消耗，' + (ctx.terrainIsMine ? '我方' : '敌方') + '地形有利、损耗更低';
    },
  },
  {
    id: 'bridgehead', nameCn: '夺取前进阵地', target: 'any', weight: 0.6, effect: 'org',
    desc: '抢占一处高地：接战师获得组织度加成与小幅经验。',
    apply: (ctx) => {
      const side = ctx.pickSide();
      ctx.orgBuff[side] = (ctx.orgBuff[side] || 0) + 7;
      ctx.xpAdd[side] = (ctx.xpAdd[side] || 0) + 2;
      return (side === 'mine' ? '我方' : '敌方') + '接战师组织度 +7、经验 +2';
    },
  },
  {
    id: 'mutiny', nameCn: '哗变', target: 'any', weight: 0.35, effect: 'org',
    desc: '一支师拒绝进攻：其组织度大幅下降并转入溃退。',
    apply: (ctx) => {
      const side = ctx.pickSide();
      const list = ctx.divsOf(side);
      if (!list.length) { ctx.orgBuff[side] = (ctx.orgBuff[side] || 0) - 6; return (side === 'mine' ? '我方' : '敌方') + '部队士气低落'; }
      const t = list[Math.floor(ctx.rng() * list.length) % list.length];
      ctx.orgDmg[side] = (ctx.orgDmg[side] || 0) + 20;
      ctx.routed[side] = true;
      return (side === 'mine' ? '我方' : '敌方') + t.nameCn + ' 哗变，组织度 −20 并溃退';
    },
  },
  {
    id: 'reconBreach', nameCn: '电子干扰', target: 'any', weight: 0.7, effect: 'width',
    desc: '干扰对方战场指挥：其一个师被迫转入预备队。',
    apply: (ctx) => {
      const side = ctx.pickSide();
      const list = ctx.divsOf(side).filter((d) => d && d.state === 'front');
      if (!list.length) return '干扰未产生效果';
      const t = list[Math.floor(ctx.rng() * list.length) % list.length];
      ctx.toReserve[side] = (ctx.toReserve[side] || 0) + 1;
      return (side === 'mine' ? '我方' : '敌方') + t.nameCn + ' 被干扰指挥，暂时退出接战';
    },
  },
  {
    id: 'acePilot', nameCn: '王牌飞行员出击', target: 'any', weight: 0.6, effect: 'str',
    desc: '轨道火力精准支援：随机一名接敌师兵力大幅下降。',
    apply: (ctx) => {
      const side = ctx.pickSide();
      const list = ctx.divsOf(side);
      if (!list.length) return '没有可打击目标';
      const t = list[Math.floor(ctx.rng() * list.length) % list.length];
      ctx.strDmg[side] = (ctx.strDmg[side] || 0) + 11;
      ctx.hitName[side] = t.nameCn;
      return (side === 'mine' ? '我方' : '敌方') + t.nameCn + ' 遭到精准打击，兵力重挫';
    },
  },
];

/** 每小时触发战役事件的基准概率 */
export const BATTLE_EVENT_CHANCE = 0.26;

/**
 * 抽一个战役事件（**确定性**：同 warId/regionId/hours/seed 必得同一结果）。
 * 双端结算依赖这一点，所以这里绝不使用 Math.random()。
 */
export function rollBattleEvent(war, regionId, hours, seed) {
  if (!BATTLE_EVENTS.length) return null;
  let h = (Number(seed) || 0) >>> 0;
  const s = String((war && war.id) || '') + '|' + String(regionId || '') + '|' + String(hours);
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;      // FNV-1a
  }
  h = (h ^ (h >>> 15)) >>> 0;
  const r0 = (h % 10000) / 10000;
  if (r0 >= BATTLE_EVENT_CHANCE) return null;
  // 按 weight 加权抽（复用同一个 hash 的后续位，避免二次随机源）
  let total = 0;
  for (const e of BATTLE_EVENTS) total += (e.weight || 1);
  let pick = ((h >>> 7) % 100000) / 100000 * total;
  for (const e of BATTLE_EVENTS) {
    pick -= (e.weight || 1);
    if (pick <= 0) return e;
  }
  return BATTLE_EVENTS[0];
}

/**
 * 执行一个事件：把 ctx 里累积的修正应用到战场与双方师。
 * ctx 由 stepHour 构造（保证事件与战斗同处一个确定性种子体系）。
 */
function applyBattleEvent(acc, b, ev, ctx) {
  const text = ev.apply(ctx);
  // 把 ctx 里累积的即时伤害/增益落到实际对象上
  for (const side of ['mine', 'foe']) {
    const divs = ctx.divs[side];
    const od = ctx.orgDmg[side] || 0;
    const ob = ctx.orgBuff[side] || 0;
    const sd = ctx.strDmg[side] || 0;
    const xa = ctx.xpAdd[side] || 0;
    if (!divs || (!od && !ob && !sd && !xa)) continue;
    for (const d of divs) {
      if (od) d.org = Math.max(0, d.org - od * (d.state === 'front' ? 1 : 0.5));
      if (ob) d.org = Math.min(ORG_MAX, d.org + ob);
      if (sd) d.str = Math.max(0, d.str - sd);
      if (xa) d.xp = (Number(d.xp) || 0) + xa;
    }
    if (ctx.routed[side]) {
      const eng = divs.filter((d) => d.state === 'front');
      if (eng.length) { eng[0].state = 'routed'; eng[0].hoursOut = 0; }
    }
    if (ctx.toReserve[side]) {
      let n = ctx.toReserve[side];
      for (const d of divs) {
        if (n <= 0) break;
        if (d.state === 'front') { d.state = 'reserve'; n--; }
      }
    }
  }
  // 补给
  b.supply.mine = clamp(b.supply.mine + (ctx.supplyAdd.mine || 0), 0.05, 1);
  b.supply.foe = clamp(b.supply.foe + (ctx.supplyAdd.foe || 0), 0.05, 1);
  // 工事
  if (ctx.entrenchBonus.foe) b.entrench.foe = Math.min(ENTRENCH_MAX, (Number(b.entrench.foe) || 0) + ctx.entrenchBonus.foe);
  if (ctx.entrenchBonus.mine) b.entrench.mine = Math.min(ENTRENCH_MAX, (Number(b.entrench.mine) || 0) + ctx.entrenchBonus.mine);
  // 攻击力修正（作用于下一个小时的结算）
  b.foeAtkMul = ctx.foeAtkMul != null ? ctx.foeAtkMul : (b.foeAtkMul || 1);
  b.mineAtkMul = ctx.mineAtkMul != null ? ctx.mineAtkMul : (b.mineAtkMul || 1);
  // 事件历史（供 UI 展示「战争过程」）
  b.events = Array.isArray(b.events) ? b.events : [];
  b.events.push({ at: Date.now(), hours: b.hours, eventId: ev.id, nameCn: ev.nameCn, text });
  if (b.events.length > LOG_CAP) b.events.shift();
  pushLog(b, '【' + ev.nameCn + '】' + text);
}

// ============================================================================
// v0.4.5 需求 2：指挥官 —— 让「谁来指挥」成为一个真实决策
// ============================================================================
//
// 此前一场战役只有「谁的师多、谁的战力高」，没有任何指挥层面的变量。
// 现在每场战役可以指派一名**指挥官**，其特质会同时影响组织度恢复、
// 工事累积、补给维持、攻击力与减员 —— 于是「把谁放在哪条战线」
// 变成一个真实的战术决策（HOI4 的将领系统思路）。
//
// 指挥官按确定性随机生成（种子 = 军队 id），双端结算一致。
// ============================================================================

export const COMMANDER_TRAITS = {
  assault: {
    id: 'assault', nameCn: '突击型', desc: '偏重攻势：攻击力 +8%，但工事累积减半。',
    atkMul: 1.08, entrenchMul: 0.5,
  },
  defensive: {
    id: 'defensive', nameCn: '防御型', desc: '偏重固守：工事累积 +60%，攻击力 −4%。',
    atkMul: 0.96, entrenchMul: 1.6,
  },
  engineer: {
    id: 'engineer', nameCn: '工兵型', desc: '工事累积 +30%，组织度恢复 +20%。',
    atkMul: 1.0, entrenchMul: 1.3, orgRegenMul: 1.2,
  },
  logistics: {
    id: 'logistics', nameCn: '后勤型', desc: '补给维持 +18%，兵力损失 −10%。',
    atkMul: 1.0, supplyMul: 1.18, casualtyMul: 0.9,
  },
  veteran: {
    id: 'veteran', nameCn: '老兵型', desc: '经验获取 +50%，攻击力 +4%。',
    atkMul: 1.04, xpMul: 1.5,
  },
  raider: {
    id: 'raider', nameCn: '袭扰型', desc: '装备率恢复 +60%（补给中断时更抗打）。',
    atkMul: 1.0, equipRecoverMul: 1.6,
  },
};

const COMMANDER_SURNAMES = ['陈', '林', '赵', '周', '徐', '沈', '韩', '杨', '朱', '秦', '许', '何'];
const COMMANDER_GIVEN = ['砚', '澜', '澈', '燧', '穹', '骥', '珩', '钊', '沅', '朔', '嶂', '岐'];
export const COMMANDER_MAX = 12;      // 最多可拥有的指挥官数

/** 确定性生成一名指挥官（同一 seed 永远同一个结果） */
export function rollCommander(id, seed) {
  let h = (Number(seed) || 0) >>> 0;
  const s = String(id || 'gen');
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  h = Math.imul(h ^ (h >>> 13), 2654435761) >>> 0;
  const traits = Object.keys(COMMANDER_TRAITS);
  const traitId = traits[h % traits.length];
  const t = COMMANDER_TRAITS[traitId];
  return {
    id: String(id || ('gen' + (h >>> 0))),
    nameCn: COMMANDER_SURNAMES[(h >>> 5) % COMMANDER_SURNAMES.length]
      + COMMANDER_GIVEN[(h >>> 11) % COMMANDER_GIVEN.length],
    traitId,
    traitName: t.nameCn,
    traitDesc: t.desc,
    skill: 1 + ((h >>> 17) % 4) * 0.25,     // 1.0 ~ 1.75（技能等级，影响所有修正幅度）
  };
}

/** 账号的指挥官名册（首次调用时按军队生成） */
export function commandersOf(acc) {
  if (!acc) return [];
  if (!Array.isArray(acc.commanders)) acc.commanders = [];
  if (!acc.commanders.length) {
    const armies = Array.isArray(acc.armies) ? acc.armies : [];
    for (const a of armies.slice(0, COMMANDER_MAX)) {
      if (!a || !a.id) continue;
      acc.commanders.push(rollCommander(a.id, a.id.length * 7919));
    }
    if (!acc.commanders.length) {
      acc.commanders.push(rollCommander('cmd1', 12345));
    }
  }
  return acc.commanders;
}

/** 指派指挥官到某场战役（commanderId 传 null 表示撤换） */
export function assignCommander(acc, battle, commanderId) {
  if (!battle) return { ok: false, reason: '战役不存在' };
  if (commanderId == null || commanderId === '') {
    const old = battle.commanderId || null;
    battle.commanderId = null;
    battle._commander = null;
    battle.commanderEffect = null;
    return { ok: true, commanderId: null, old };
  }
  const list = commandersOf(acc);
  const c = list.find((x) => x && x.id === commanderId);
  if (!c) return { ok: false, reason: '找不到该指挥官' };
  battle.commanderId = c.id;
  // 把指挥官对象拷进 battle —— commanderEffectOf 刻意不持有 acc（避免循环引用）
  battle._commander = c;
  battle.commanderEffect = commanderEffectOf(battle);
  return { ok: true, commanderId: c.id, commander: c };
}

/** 指挥官对该战役的修正（已含技能等级） */
export function commanderEffectOf(battle) {
  if (!battle) return null;
  // ⚠️ 这里刻意**不持有 acc 引用**（battle.__acc）—— battle 是 acc 的一部分，
  //   反向引用会让存档 JSON.stringify 抛「循环结构」错误。
  //   指挥官对象本身在开局时拷进 battle._commander，故不需要 acc。
  const c = battle._commander || null;
  if (!c || !battle.commanderId) return null;
  const t = COMMANDER_TRAITS[c.traitId] || COMMANDER_TRAITS.defensive;
  const sk = Number(c.skill) || 1;
  return {
    commanderId: c.id,
    nameCn: c.nameCn,
    traitId: t.id,
    traitName: t.nameCn,
    skill: sk,
    atkMul: 1 + ((Number(t.atkMul) || 1) - 1) * sk,
    entrenchMul: 1 + ((Number(t.entrenchMul) || 1) - 1) * sk,
    orgRegenMul: 1 + ((Number(t.orgRegenMul) || 1) - 1) * sk,
    supplyMul: 1 + ((Number(t.supplyMul) || 1) - 1) * sk,
    casualtyMul: 1 + ((Number(t.casualtyMul) || 1) - 1) * sk,
    xpMul: 1 + ((Number(t.xpMul) || 1) - 1) * sk,
    equipRecoverMul: 1 + ((Number(t.equipRecoverMul) || 1) - 1) * sk,
  };
}

function tryHazards(acc, b, rng, mineEng, foeEng, terrain, grav) {
  const haz = Number(terrain.hazard) || 0;
  if (!(haz > 0)) return;
  if (rng() >= haz) return;
  const keys = Object.keys(HAZARDS);
  const h = HAZARDS[keys[Math.floor(rng() * keys.length) % keys.length]];
  // 低重力放大地质灾害（没有足够的重力把碎石压住）
  const gravMul = grav < 1 ? (1 + (1 - grav) * 1.2) : 1;
  const target = rng() < 0.5 ? mineEng : foeEng;
  if (!target || !target.length) return;
  const t = target[Math.floor(rng() * target.length) % target.length];
  const orgDmg = ORG_BOMB_BASE * h.orgMul * gravMul;
  const strDmg = h.mul * 6;
  t.org = Math.max(0, t.org - orgDmg);
  t.str = Math.max(0, t.str - strDmg);
  if (t.org <= 0 && t.state !== 'done') { t.state = 'routed'; t.hoursOut = 0; }
  if (t.str <= 0) t.state = 'done';
  // 尘暴/毒气额外压低补给
  if (h === HAZARDS.storm || h === HAZARDS.gas) {
    const side = (target === mineEng) ? 'mine' : 'foe';
    b.supply[side] = clamp((Number(b.supply[side]) || 0) - 0.06, 0.05, 1);
  }
  pushLog(b, '【地貌灾害】' + h.nameCn + '袭击' + (target === mineEng ? '我方' : '敌方') + ' '
    + t.nameCn + '：' + h.desc);
}

/** 轨道轰炸基准伤害（与普通火力同量纲的参考值） */
const ORG_BOMB_BASE = 9;

/**
 * v0.4.0 **轨道轰炸**：太空战争独有的核心手段 ——
 *   只要掌握轨道（orbitalControl ≥ 60%），就能绕过地面防线直接从天上下打击。
 *   这是「先打轨道、再打地面」的太空战争逻辑，与二战的两栖登陆完全不同。
 *   每次轰炸同时削弱守方组织度、兵力，以及该地形的防御加成。
 */
function tryOrbitalBomb(acc, b, rng, mineEng, foeEng) {
  if (!b.orbital) b.orbital = { charges: ORBITAL_BOMB_CHARGES, sinceLast: 0, used: 0 };
  b.orbital.sinceLast += 1;
  if (b.orbital.sinceLast >= ORBITAL_BOMB_REGEN && b.orbital.charges < ORBITAL_BOMB_CHARGES) {
    b.orbital.charges += 1;
    b.orbital.sinceLast = 0;
    pushLog(b, '轨道平台补充了一发弹药（剩余 ' + b.orbital.charges + ' 发）');
  }
  const ctrl = orbitalControlOf(acc, b.targetId);
  b.orbitalControl = ctrl;
  if (ctrl < ORBITAL_BOMB_MIN_CONTROL) return;
  if (b.orbital.charges <= 0) return;
  if (!foeEng || !foeEng.length) return;
  // 每小时 22% 概率投下一发（控制度越高越积极）
  const p = 0.12 + 0.22 * ctrl;
  if (rng() >= p) return;
  b.orbital.charges -= 1;
  b.orbital.sinceLast = 0;
  b.orbital.used += 1;
  const dmgOrg = ORG_BOMB_BASE * ORBITAL_BOMB_ORG_MUL * (0.6 + 0.6 * ctrl);
  const dmgStr = ORG_BOMB_BASE * 0.9 * ORBITAL_BOMB_STR_MUL;
  let routed = 0;
  for (const t of foeEng) {
    t.org = Math.max(0, t.org - dmgOrg);
    t.str = Math.max(0, t.str - dmgStr);
    if (t.org <= 0) { t.state = 'routed'; t.hoursOut = 0; routed++; }
    if (t.str <= 0) t.state = 'done';
  }
  // 轰炸把地形防御优势打掉一块
  b.entrench.foe = Math.max(0, b.entrench.foe - ORBITAL_BOMB_PER_CHARGE);
  pushLog(b, '【轨道轰炸】我方轨道平台发动打击（控制度 ' + Math.round(ctrl * 100)
    + '%，剩余 ' + b.orbital.charges + ' 发）：敌方阵地组织度 −' + Math.round(dmgOrg)
    + '、兵力 −' + Math.round(dmgStr) + '，工事被削' + Math.round(ORBITAL_BOMB_PER_CHARGE * 100) + '%'
    + (routed ? '，' + routed + ' 个师直接溃退' : ''));
}

/** 取本场最近一次的进攻读数（供 UI 与调试参考） */

/** v0.3.5：火力优势量（制空权 + 近距支援倍率）
 *  v0.4.0 太空化：不是「制空权 / 空军」，而是**轨道火力与无人机群的压制优势**。 */
function airBalanceOf(acc, b) {
  const mineAir = airforceOf(acc && acc.nation);
  const foeAir = airforceOf(b && b.targetId);
  const sum = mineAir + foeAir;
  const supMine = sum > 0 ? mineAir / sum : 0.5;
  const supFoe = sum > 0 ? foeAir / sum : 0.5;
  return {
    mineAir: Math.round(mineAir),
    foeAir: Math.round(foeAir),
    // 近距空中支援倍率：0.85 ~ 1.30（完全制空权时进攻方 +30%）
    casMine: 0.85 + 0.45 * supMine,
    casFoe: 0.85 + 0.45 * supFoe,
    supMine, supFoe,
  };
}

function fillFront(side, eng) {
  if (eng.length >= BATTLE_COMBAT_WIDTH) return;
  const waiting = side.filter((d) => d.state === 'reserve' && d.org > ORG_MAX * 0.9)
    .sort((x, y) => ((y.breakthrough || y.def || 0) + (y.softAtk || y.atk || 0))
                  - ((x.breakthrough || x.def || 0) + (x.softAtk || x.atk || 0)));
  while (eng.length < BATTLE_COMBAT_WIDTH && waiting.length) {
    const d = waiting.shift();
    d.state = 'front';
    eng.push(d);
  }
}

function avgArmor(divs) {
  if (!divs || !divs.length) return 0.5;
  return divs.reduce((s, d) => s + (Number(d.armor) || 0), 0) / divs.length;
}

/**
 * 对一批接战师造成伤害；返回本次新溃退的师数。
 * v0.3.5：权重不再是「战力平均分摊」，而是**逐对**的有效攻击
 *   —— 装甲越厚、穿甲越低的目标分到的伤害越少，步兵打装甲才真正吃亏。
 * 先算后落账，保证同一 tick 内先后不影响结果（确定性）。
 */
function applyDamage(divs, orgDmg, strDmg, rng, b, which, attackers) {
  let routed = 0;
  const attackers2 = (Array.isArray(attackers) && attackers.length) ? attackers : null;
  // 权重 = 对每个目标的**有效攻击总和**
  const weights = divs.map((t) => {
    if (!attackers2) return Math.max(1, (t.softAtk || t.atk || 1));
    let s = 0;
    for (const a of attackers2) s += effAtkAgainst(a, Number(t.armor) || 0);
    return Math.max(0.0001, s);
  });
  const wsum = weights.reduce((a, b2) => a + b2, 0) || 1;
  divs.forEach((d, i) => {
    const share = weights[i] / wsum;
    // 随机浮动 ±12%，让战斗不至于完全可预测
    const jitter = 0.88 + rng() * 0.24;
    d.org -= orgDmg * share * jitter;
    d.str = Math.max(0, d.str - strDmg * share * jitter);
    if (d.org <= 0) {
      d.org = 0;
      d.state = 'routed';
      d.hoursOut = 0;
      routed++;
    }
    // 兵力被打光 = 被打垮，直接除名（不再归队）
    if (d.str <= 0) {
      d.state = 'done';
    }
  });
  return routed;
}

// ---------------------------------------------------------------------------
// 七、胜负判定与战损回写
// ---------------------------------------------------------------------------

function sideBroken(side) {
  // 全灭或全部溃退且短时间内无法归队 → 视为战线崩溃
  const alive = side.filter((d) => d.state !== 'done');
  if (!alive.length) return true;
  return alive.every((d) => d.state === 'routed');
}

/**
 * 战役结算：把战损写回真实军队，并（除僵持外）推动战争分数与推进。
 * @param {boolean} mySideWon 我方是否取胜
 * @param {object} [opts] { stalemate:true } 僵持 —— 只结算伤亡，不动分数与推进
 *   （守方撑满时限在 HOI4 里是「守住」，不是失败）
 */
function resolveBattleEnd(acc, b, mySideWon, opts) {
  const o = opts || {};
  const rng = mulberry32((b.seed + 7717) >>> 0);
  const pool = acc.foePools[foePoolKey({ id: b.warId })] || null;

  // 我方：把 str 的损失按比例写回兵员，经验回写军队
  let lostMen = 0, routedCount = 0;
  for (const d of b.mine) {
    if (d.retreatOrder) d.state = 'done';
    const a = armyById(acc, d.armyId);
    if (!a) continue;
    if (d.state === 'done') routedCount++;
    // 损失比例：兵员掉得越多，经验给得越多（打到底的师变老兵）
    const lossRatio = d.strMax > 0 ? clamp(1 - d.str / d.strMax, 0, 1) : 0;
    const menLoss = Math.round(d.strAtEntry * lossRatio * 0.9);
    lostMen += menLoss;
    a.men = Math.max(0, (Number(a.men) || 0) - menLoss);
    // 经验：胜仗给得多，败仗也给（打过的仗就有经验），但败仗减半
    const xpGain = Math.round((Number(d.xp) || 0) * (mySideWon ? 1 : 0.5) * (d.state === 'done' ? 1.6 : 1));
    if (xpGain > 0) {
      a.exp = (Number(a.exp) || 0) + xpGain;
      // 满 30 经验自动再 +1/+1（与 army.js#applyTrainBonus 同一套台阶）
      const before = Math.floor(((Number(a.exp) || 0) - xpGain) / 30);
      const after = Math.floor((Number(a.exp) || 0) / 30);
      if (after > before) { a.bonusAtk = (Number(a.bonusAtk) || 0) + (after - before); a.bonusDef = (Number(a.bonusDef) || 0) + (after - before); }
    }
    if (d.state === 'done') a.men = Math.max(0, Number(a.men) || 0);
    // 战力随兵员比例回落（HOI4 的 strength 概念）。
    // ⚠️ 同样**不能**在这里调 armyEffStats() 覆盖 a.stats —— 1936 剧本的师是
    //   按国家工业手工赋值的，重算会把 atk 194 削成 24（见 mineToDiv 的说明）。
    //   正确做法：以 _baseStats（满编基准）为锚，按 兵员/满编兵员 等比缩放，
    //   既反映缺员减员，又不会因为反复缩放而复利式衰减。
    const menMax = (Number(a.menMax) > 0) ? Number(a.menMax) : (d.strAtEntry || 1);
    const ratio = menMax > 0 ? clamp((Number(a.men) || 0) / menMax, 0, 1) : 1;
    const base = a._baseStats || { atk: Number(a.stats && a.stats.atk) || 0, def: Number(a.stats && a.stats.def) || 0, speed: Number(a.stats && a.stats.speed) || 0 };
    if (!a._baseStats) a._baseStats = base;
    a.stats = {
      atk: base.atk * ratio + (Number(a.bonusAtk) || 0),
      def: base.def * ratio + (Number(a.bonusDef) || 0),
      speed: base.speed,
    };
    a.power = Math.round(armyPowerOf(a.stats) || 0);
    a.reinforcing = ratio < 1;
  }

  // 敌方：被打死的师永久消耗（消耗战的核心）
  let foeKilled = 0;
  for (const d of b.foe) {
    if (d.state === 'done' || d.str <= 0 || (mySideWon && d.org <= 0)) foeKilled++;
  }
  if (pool) {
    pool.divisions = Math.max(0, pool.divisions);
    pool.killed = (Number(pool.killed) || 0) + foeKilled;
  }

  b.status = 'ended';
  b.endedAt = Date.now();
  // v0.4.1：清掉战区的「交战中」标记
  if (b.regionId) {
    try {
      const t = ensureTheater(acc);
      const rg = regionById(t, b.regionId);
      if (rg && rg.battleId === b.id) rg.battleId = null;
    } catch (e) { /* 忽略 */ }
  }
  // v0.4.1：把战区易手 —— 打赢 → 占领（殖民地一并到手）；打输 → 丢地
  // ⚠️ `war` 必须在这里先取出来：原先它在本函数靠后位置才声明（const 有暂时性死区），
  //   前面引用会抛 ReferenceError，又被下面的 try/catch 吞掉 ——
  //   表现为「打赢也不占领地」，极难察觉。
  const war = (acc.wars || []).find((w) => w && w.id === b.warId);
  let captured = null;
  if (b.regionId) {
    try {
      captured = captureRegion(acc, war, regionById(ensureTheater(acc), b.regionId), mySideWon);
      if (captured && captured.colony) applyColonyProgress(war, 1);
    } catch (e) { /* 占领失败不影响战斗结算 */ }
  }
  b.result = {
    attackerWin: !!mySideWon,
    stalemate: !!o.stalemate,
    hours: b.hours,
    lostMen,
    routedCount,
    foeKilled,
    terrain: (BATTLE_TERRAIN[b.terrain] || BATTLE_TERRAIN.plain).nameCn,
    regionId: b.regionId || null,
    captured: captured ? { owner: captured.owner, colony: captured.colony || null, lost: !!captured.lost } : null,
  };
  pushLog(b, (o.stalemate ? '战役僵持（未分胜负）' : (mySideWon ? '战役胜利' : '战役失利'))
    + '：交战 ' + b.hours + ' 小时，'
    + '我方损失 ' + lostMen + ' 人' + (routedCount ? '、' + routedCount + ' 个师被打散' : '')
    + '，敌方 ' + foeKilled + ' 个师被击溃'
    + (captured && captured.colony ? '　**占领殖民地**（' + captured.colony.popM + ' 百万人口）' : '')
    + (captured && captured.lost ? '　我方失去该战区！' : ''));
  if (o.stalemate) return b.result;   // 僵持不动分数

  // 推进条：进度由**战役胜负**推动，不再是实力比自动滑动。
  //   方向取决于谁在进攻（HOI4 语义）：
  //   · 我方进攻取胜 → 大幅推进（打下了敌方阵地）
  //   · 我方防守打退敌方进攻 → 几乎不推进（守住 = 没前进）
  //   · 我方进攻失利 → 后退
  //   · 敌方进攻得手 → 大幅后退
  const foeAttacked = b.attacker === 'foe';
  if (war && war.status === 'active') {
    war.battles = (Number(war.battles) || 0) + 1;
    // 决定性胜利：敌方「可调之师」全部耗尽（预备池已空 + 本场全灭）= 对方军事上已不存在。
    //   此时直接把战线推到 100% 并解锁迫降，否则会出现「提示可迫降但分数不够」的自相矛盾。
    if (mySideWon && pool && pool.divisions <= 0) {
      war.progress = 100;
      war.myScore = Math.max(Number(war.myScore) || 0, WAR_FORCE_SURRENDER_SCORE);
      war.theirScore = Math.max(Number(war.theirScore) || 0, 20);
      unshiftWarLog(acc, war, '敌方全军覆没（可调之师已全部被击溃）—— 战线推进至 100%，现在可以发动迫降');
      return b.result;
    }
    const gain = mySideWon ? (foeAttacked ? 3 : 14) : (foeAttacked ? -14 : -10);
    war.progress = clamp((Number(war.progress) || 0) + gain, 0, 100);
    if (mySideWon) {
      war.myScore = Math.min(100, (Number(war.myScore) || 0) + (foeAttacked ? 3 : 10));
      war.theirScore = Math.min(100, (Number(war.theirScore) || 0) + 2);
      unshiftWarLog(acc, war, (foeAttacked ? '打退敌方进攻' : '战役胜利')
        + ' · ' + (BATTLE_TERRAIN[b.terrain] || {}).nameCn + '战场 → 推进 ' + Math.round(war.progress) + '%');
    } else {
      war.theirScore = Math.min(100, (Number(war.theirScore) || 0) + (foeAttacked ? 10 : 4));
      war.myScore = Math.min(100, (Number(war.myScore) || 0) + 2);
      unshiftWarLog(acc, war, (foeAttacked ? '敌方攻破我方防线' : '进攻失利')
        + ' · 战线退回至 ' + Math.round(war.progress) + '%');
    }
    // 推进到位 → 允许迫降（与旧版的 70% 口径一致，但现在是打出来的）
    if (war.progress >= 70 && (Number(war.myScore) || 0) < 40) war.myScore = 40;
  }
  return b.result;
}

function unshiftWarLog(acc, war, text) {
  const at = Date.now();
  war.log = Array.isArray(war.log) ? war.log : [];
  war.log.unshift({ at, text });
  if (war.log.length > 30) war.log.length = 30;
  if (Array.isArray(acc.warLog)) {
    acc.warLog.unshift({ at, text });
    if (acc.warLog.length > 60) acc.warLog.length = 60;
  }
}

function pushLog(b, text) {
  b.log = Array.isArray(b.log) ? b.log : [];
  b.log.unshift({ at: Date.now(), hours: b.hours, text });
  if (b.log.length > LOG_CAP) b.log.length = LOG_CAP;
}

/** 主动结束一场战役（玩家下令全线撤出，或敌方已被打垮） */
export function stopBattle(acc, battleId, reason) {
  const b = battleById(acc, battleId);
  if (!b || b.status !== 'active') return { ok: false, reason: '找不到进行中的战场' };
  return { ok: true, result: resolveBattleEnd(acc, b, false) , note: reason || '我方主动撤出' };
}

/** 下令某师撤出该战场（HOI4 的撤退令；该师退出战斗、损失不再扩大） */
export function orderRetreat(acc, battleId, armyId) {
  const b = battleById(acc, battleId);
  if (!b || b.status !== 'active') return { ok: false, reason: '找不到进行中的战场' };
  const d = (b.mine || []).find((x) => x.armyId === armyId);
  if (!d) return { ok: false, reason: '该师不在此战场' };
  d.retreatOrder = true;
  d.state = 'reserve';
  d.org = 0;
  return { ok: true, division: d };
}

// ---------------------------------------------------------------------------
// 八、每 tick 推进所有战场（由 state.js#tick 接线）
// ---------------------------------------------------------------------------
export function tickBattles(acc, dtSec) {
  const all = ensureBattles(acc);
  if (!all.length) return;
  let hours = (Number(dtSec) || 0) * BATTLE_HOURS_PER_SEC;
  if (!(hours > 0)) return;
  // 离线结算可能一次给出几天的 dt —— 分块推进并设上限，避免单次 tick 死循环
  let guard = 0;
  while (hours > 0.001 && guard < 400) {
    const step = Math.min(1, hours);
    hours -= step;
    guard++;
    for (const b of all) {
      if (!b || b.status !== 'active') continue;
      try {
        stepHour(acc, b);
        // 每 4 小时刷新一次补给（工业/战况在变）
        if (b.hours % 4 === 0) recomputeSupply(acc, b);
        if (sideBroken(b.foe)) {
          resolveBattleEnd(acc, b, true);
        } else if (sideBroken(b.mine)) {
          resolveBattleEnd(acc, b, false);
        } else if (b.hours >= BATTLE_MAX_HOURS) {
          if (b.attacker === 'foe') {
            // 我方是防守方：撑满时限 = **守住了**，不是失败（HOI4：久攻不下即撤）
            pushLog(b, '交战 ' + b.hours + ' 小时：我方守住阵地，敌方攻势耗尽后撤出');
            resolveBattleEnd(acc, b, true, { stalemate: true });
          } else {
            pushLog(b, '交战 ' + b.hours + ' 小时仍未分胜负 —— 我方久攻不下，被迫撤出');
            resolveBattleEnd(acc, b, false);
          }
        }
      } catch (e) {
        // 单个战场异常不拖垮心跳
        b.status = 'ended';
        b.result = { attackerWin: false, hours: b.hours, error: String(e && e.message || e) };
      }
    }
    if (!all.some((b) => b && b.status === 'active')) break;
  }
}

// ---------------------------------------------------------------------------
// 九、给 UI 的只读视图
// ---------------------------------------------------------------------------
function divView(d, isMine) {
  return {
    nameCn: d.nameCn,
    armyId: d.armyId || null,
    isMine,
    kind: d.kind || 'infantry',
    kindCn: d.kindCn || '步兵',
    org: Math.round(d.org),
    orgMax: d.orgMax || ORG_MAX,
    str: Math.round(d.str),
    strMax: Math.round(d.strMax),
    strRatio: d.strMax > 0 ? clamp(d.str / d.strMax, 0, 1) : 0,
    equip: Math.round(clamp(Number(d.equip == null ? 1 : d.equip), 0, 1) * 100),
    state: d.state,
    stateCn: d.state === 'front' ? '接战' : d.state === 'reserve' ? '预备'
      : d.state === 'routed' ? '整补中' : '已退出',
    atk: Math.round(d.atk || 0),
    def: Math.round(d.def || 0),
    softAtk: Math.round(d.softAtk || 0),
    hardAtk: Math.round(d.hardAtk || 0),
    breakthrough: Math.round(d.breakthrough || 0),
    defense: Math.round(d.defense || 0),
    armor: Number(d.armor) || 0,
    pierce: Number(d.pierce) || 0,
    xp: Math.round(Number(d.xp) || 0),
  };
}

/** 战场详情（UI 直接渲染这份快照，避免 UI 里重复算战斗逻辑） */
export function battleView(acc, battleId) {
  const b = battleById(acc, battleId);
  if (!b) return null;
  recomputeSupply(acc, b);
  const mineEng = engagedOf(b.mine).length;
  const foeEng = engagedOf(b.foe).length;
  return {
    id: b.id,
    warId: b.warId,
    targetName: b.targetName,
    attacker: b.attacker || 'mine',
    attackerCn: b.attacker === 'foe' ? '敌方进攻' : '我方进攻',
    mineIsDefender: b.attacker === 'foe',
    terrain: b.terrain,
    terrainCn: (BATTLE_TERRAIN[b.terrain] || BATTLE_TERRAIN.plain).nameCn,
    status: b.status,
    hours: b.hours,
    maxHours: BATTLE_MAX_HOURS,
    width: BATTLE_COMBAT_WIDTH,
    mineEngaged: mineEng,
    foeEngaged: foeEng,
    supply: { mine: b.supply.mine, foe: b.supply.foe },
    seaCtrl: b.seaCtrl == null ? 0.5 : b.seaCtrl,
    orbitalControl: b.orbitalControl == null ? 0.5 : b.orbitalControl,
    orbital: b.orbital || { charges: ORBITAL_BOMB_CHARGES, sinceLast: 0, used: 0 },
    gravity: Number((BATTLE_TERRAIN[b.terrain] || {}).gravity) || 1,
    hazard: Number((BATTLE_TERRAIN[b.terrain] || {}).hazard) || 0,
    air: b.air || { mineAir: 0, foeAir: 0, casMine: 1, casFoe: 1, supMine: 0.5, supFoe: 0.5 },
    entrench: { mine: b.entrench.mine, foe: b.entrench.foe },
    breakthrough: b.breakthrough || { mine: 0, foe: 0 },
    lastPower: b.lastPower || { atk: 0, def: 0 },
    mine: (b.mine || []).map((d) => divView(d, true)),
    foe: (b.foe || []).map((d) => divView(d, false)),
    result: b.result || null,
    log: (b.log || []).slice(0, 12),
    // v0.4.5（需求 2）：指挥官与战役事件历史（让战争「有事情发生」可见）
    commander: b.commanderId
      ? (commandersOf(acc).find((x) => x && x.id === b.commanderId) || b._commander || null)
      : null,
    commanderEffect: b.commanderEffect || null,
    events: (b.events || []).slice().reverse().slice(0, 10),
    // 预估：我方剩余可战之师是否够维持战线（HOI4 的红条警告）
    warning: mineEng === 0 ? '我方无师接战 —— 战线即将崩溃'
      : (b.mine || []).filter((d) => d.state === 'routed').length >= Math.ceil((b.mine || []).length / 2)
        ? '过半师团已被打退，预备队不足' : '',
  };
}

/**
 * 该战争下敌方还剩多少可调之师（供 UI 提示「对方已被打垮」）。
 * 惰性建池：即使还没开过战线也能查出初始师数，否则 UI 在开战前拿不到数据。
 */
export function foeRemaining(acc, warId) {
  const war = (Array.isArray(acc.wars) ? acc.wars : []).find((w) => w && w.id === warId);
  if (!war) return null;
  ensureBattles(acc);
  const pool = buildFoePool(acc, war);
  return { divisions: pool.divisions, killed: Number(pool.killed) || 0, nameCn: pool.nameCn, ic: pool.ic };
}

/** 可编入该战线的我方师（排除已在此线/其他战线的） */
export function committableArmies(acc, warId) {
  const taken = new Set();
  for (const b of activeBattlesOf(acc, warId)) {
    for (const d of (b.mine || [])) if (d.armyId) taken.add(d.armyId);
  }
  const list = Array.isArray(acc.armies) ? acc.armies : [];
  return list.filter((a) => a && !taken.has(a.id) && (Number(a.men) || 0) > 0)
    .map((a) => {
      // 同 mineToDiv：以 a.stats 为准，勿用 armyEffStats 重算（会削掉剧本手工赋值）
      const base = a._baseStats || a.stats || armyEffStats(a) || {};
      const kind = kindOfDivision(a);
      const tpl = DIV_TEMPLATES[kind];
      const atk = Math.max(0, (Number(base.atk) || 0) + (Number(a.bonusAtk) || 0));
      const def = Math.max(0, (Number(base.def) || 0) + (Number(a.bonusDef) || 0));
      return {
        id: a.id, nameCn: a.nameCn, men: Math.round(Number(a.men) || 0),
        kind, kindCn: tpl.nameCn,
        atk: Math.round(atk), def: Math.round(def),
        softAtk: Math.round(atk * tpl.soft), hardAtk: Math.round(atk * tpl.hard),
        breakthrough: Math.round(def * tpl.brk), defense: Math.round(def * tpl.dfn),
        armor: tpl.armor, pierce: tpl.pierce,
        power: Math.round(Number(a.power) || 0), elite: !!a.elite,
      };
    });
}

export { mulberry32 };
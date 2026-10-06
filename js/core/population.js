// 人力系统核心逻辑（Astrix，零依赖原生 ES module）
// 本模块只负责「人数 / 人力 / 幸福度 / 营养代谢 / 岗位分配」的数学与状态推进，
// 不触碰任何具体资源产出（产出由生产层结合建筑与星球储藏判定，本模块只给出劳动系数）。
//
// ============================================================================
// v0.0.5 关键改动（设计者给定）
// ============================================================================
// 1. 营养代谢改了：1 人力「休息」时每秒消耗 氧气 / 有机质 / 水 各 0.01，
//    同时呼出 二氧化碳 0.01、甲烷 5e-4、氨气 5e-4。
//    工作强度在休息基数上同时放大「消耗」与「产出」（代谢越旺，吃得多也排得多）。
// 2. 岗位容量改成**按建筑算**，不再按职业算：
//    某建筑的空闲工位数 = 建筑数 × 该建筑工位数 − 该建筑下已指派人数
//    于是「多个人可以在一个建筑里面从事不同的工作」——同一建筑下的多个职业
//    共享一个工位池，谁先占谁先得，总和不能超过建筑提供的工位总数。
// 3. 新增岗位查询工具：buildingSlots / assignedToBuilding / freeSlots /
//    assignableJobs / jobCapacity，供 UI 只渲染「真正能分配」的岗位。
//
// ============================================================================
// 幸福度计算公式（v0.0.4 定稿，v0.0.5 沿用）
// ============================================================================
// 幸福度 H ∈ [0, 1]，由五项相加后夹取：
//
//   H = 0.40                    基准（活着就有）
//     + 0.35 × S                温饱项：S = 实际供给 / 实际需求，1 为吃饱
//     - 0.30 × (1 - S)          饥饿惩罚：断粮时项会被扣穿，逼人口下降
//     + 0.15 × C                庇护项：C = 庇护覆盖率（建筑/乘员仓，缺省 1）
//     - 0.50 × max(0, W-0.60)/0.40   过劳项：W = 已分配人力 / 总人力
//     - 0.40 × min(1, |T-293|/40)    温度项：T 为环境（或飞船）温度，293 K 为舒适
//
// 然后 H = clamp(H, 0, 1)。
// 开局无过劳、吃饱、温度舒适时：H = 0.40 + 0.35 + 0.15 = 0.90，
// 正好对上希尔瓦的「总人力 1000 / 可用 900」（幸福度 0.9）。
// 人口变化：H > 0.5 增长、H < 0.3 下降，否则持平。
// 各项系数都在下方常量区，改一个数就能调平衡。

import { BUILDING_BY_ID } from '../data/buildings.js?v=58.9';
import { clamp } from './util.js?v=58.9';

// ============================================================================
// 可调常量（集中放这里，方便策划调参）
// ============================================================================

// 每个人「休息」状态每秒的消耗
// v0.0.52：整体改小 5 倍（0.01 → 0.002）。
//   旧值下 1000 人光是躺着就要吃掉 10 氧气 / 10 有机质 / 10 水 每秒，
//   开局 1e5 的启动口粮只够撑 2.8 小时，玩家还没搞明白营养系统就断粮了。
//   新值 1000 人 2/s，同样口粮可撑约 14 小时，留出学习时间。
// v0.0.93：工人消耗减小，0.004 → 0.003（-25%）。
export const BASE_CONSUME = { oxygen: 0.003, organic: 0.003, water: 0.003 };

// 每个人「休息」状态每秒的代谢产出（v0.0.5 新增，v0.0.52 随消耗同比例改小）
// v0.0.8：随消耗同步翻倍（co2 0.002→0.004，methane / ammonia 1e-4→2e-4）。
//   设计者只要求调「消耗」，但代谢产出是消耗的伴生项（呼吸才排气），
//   按比例同翻避免「只吃不排」的化学失衡；**产出倍率 outputMul 不动**，游戏节奏不变。
// v0.0.93：工人消耗减小，同比例 ×0.75（co2 0.004→0.003，methane / ammonia 2e-4→1.5e-4）。
export const BASE_PRODUCE = { co2: 0.003, methane: 0.00015, ammonia: 0.00015 };

// 资源 key → 物品栏里的中文名（生产层按这个名字读写物品栏条目）
export const NUTRIENT_KEYS = ['oxygen', 'organic', 'water'];
export const NUTRIENT_NAMES = { oxygen: '氧气', organic: '有机质', water: '水' };
export const METABOLITE_KEYS = ['co2', 'methane', 'ammonia'];
export const METABOLITE_NAMES = { co2: '二氧化碳', methane: '甲烷', ammonia: '氨气' };

// 兼容 v0.0.2~v0.0.4 的旧名字（那时只有氧气 + 有机质两条）
export const BASE_O2 = BASE_CONSUME.oxygen;
export const BASE_ORGANIC = BASE_CONSUME.organic;

// 劳动参与率：总人力 = floor(总人数 × 参与率)
export const LABOR_PARTICIPATION = 0.9;

// 新建人口的初始幸福度（让 Sylva 开局可对上：100 人 → 总人力 90、可用人力 81）
export const HAPPINESS_INIT = 0.9;

// ============================================================================
// 幸福度公式的五项系数（对应文件顶部公式）
// ============================================================================
export const HAPPINESS_BASE = 0.40;          // 基准项
export const HAPPINESS_FOOD_MAX = 0.35;      // 温饱项上限（S = 1 时给足）
export const HUNGER_PENALTY_MAX = 0.30;      // 饥饿惩罚上限（S = 0 时扣满）
export const HAPPINESS_SHELTER_MAX = 0.15;   // 庇护项上限（C = 1 时给足）
export const OVERWORK_COMFORT = 0.60;        // 工作占比 ≤ 此值时不惩罚
export const OVERWORK_PENALTY = 0.50;        // 过劳项上限（工作占比 100% 时扣满）
export const HAPPINESS_TEMP_MAX = 0.40;      // 温度项上限
export const COMFORT_TEMP_K = 293;           // 舒适温度 20 ℃
export const TEMP_TOLERANCE_K = 40;          // 偏离 40 K 时温度项扣满
export const HAPPINESS_RECOVER = 0.02;       // 向目标值逼近速度（上升时，时间常数 50 秒）
// v0.0.8：新增「下降时」的更慢逼近速度。
//   设计者要求「开局幸福度不要掉得太狠，断粮 / 无庇护时仍要掉」。
//   做法：只在幸福度**下降**（target < 当前值）时把逼近速度降到 0.008（时间常数 ~125 秒），
//         **上升**（target > 当前值）时仍用 0.02（恢复照旧）。即「掉得慢、恢复快」。
//   不动 HAPPINESS_INIT(0.9) / HAPPINESS_BASE(0.40) / 上限 1；
//   断粮（温饱项→0）、无庇护（庇护项→0）时 target 仍会低于当前值，幸福度**照样掉**，只是更缓。
export const HAPPINESS_RECOVER_DOWN = 0.008;  // 下降时更慢（时间常数 ~125 秒）
export const NUTRI_DEFICIT_PENALTY = 0.5;    // 断粮时的直接惩罚系数（兼容旧调用）

// 人口增长 / 下降阈值与速率
// v0.0.51：速率整体调慢约 100 倍。旧值 0.005 是「每秒」的复合增长率，
//   幸福度 0.9 时每秒 +0.2%，挂机一小时就是 **1339 倍**。
// v0.0.52：改成**连续生育率**，不再是「过了阈值才变」的硬跳变——
//   生育率 f = (H − 0.5) / 0.5，取值 [−1, +1]：
//     H = 1.0 → f = +1（满速增长）
//     H = 0.5 → f =  0（人口持平，平衡点）
//     H = 0.0 → f = −1（满速倒扣）
//   于是「幸福度越低，生育越慢；跌破 0.5 就开始倒扣」，不用等掉到 0.3。
//   这是一个漂亮的自平衡：人口涨 → 庇护率降 → 幸福度降 → 增长放缓 → 停在平衡点。
export const NEUTRAL_HAPPINESS = 0.5;   // 人口持平的幸福度（生育率 = 0）
export const GROWTH_RATE = 3e-5;        // f = +1 时的每秒增长率（约 +11%/小时）
export const DECLINE_RATE = 6e-5;       // f = −1 时的每秒衰减率（约 −19%/小时，比增长快一倍）

// ============================================================================
// 管理模式（v0.2.11）：每种模式一套「人口增长 / 有机质·水消耗 / 产出」乘数
//   * 存储在星球实例上：inst.manageMode（未设置 = normal）
//   * growthMul 只放大增长（f ≥ 0），衰减不受影响
//   * organicMul / waterMul 作用在消耗上；氧气不参与（走大气层储量）
//   * outputMul 作用在产线劳动产出上（production.js 三处调用点）
// ============================================================================
export const MANAGE_MODES = [
  { id: 'normal', nameCn: '常规管理', icon: '⚙', growthMul: 1, organicMul: 1, waterMul: 1, outputMul: 1,
    desc: '标准管理：人口、消耗、产出均中性。' },
  { id: 'rich_strong', nameCn: '富国强兵', icon: '⚔', growthMul: 0.5, organicMul: 1.15, waterMul: 1.15, outputMul: 1.15,
    desc: '全员增产 +15%，但劳动强度大：人口增长放缓（×0.5），有机质 / 水消耗 +15%。' },
  { id: 'rest', nameCn: '休养生息', icon: '🌿', growthMul: 1.3, organicMul: 0.9, waterMul: 0.9, outputMul: 0.9,
    desc: '节衣缩食、轻徭薄赋：有机质 / 水消耗 −10%，人口增长 +30%，产出 −10%。' },
  { id: 'birth_limit', nameCn: '计划生育', icon: '📋', growthMul: 0.25, organicMul: 0.7, waterMul: 0.7, outputMul: 1,
    desc: '配给制：有机质 / 水消耗 −30%，人口增长大幅放缓（×0.25）。' },
  { id: 'birth_boost', nameCn: '鼓励生育', icon: '👶', growthMul: 3, organicMul: 2.5, waterMul: 2.5, outputMul: 0.95,
    desc: '人口快速增长（×3），但有机质消耗极多（×2.5，水同），产出 −5%（抚育挤占工时）。' },
  // v0.2.6：全存档可用的「战时总动员」——星球管理层的最高强度体制
  { id: 'mobilize', nameCn: '战时总动员', icon: '🎖', growthMul: 0.55, organicMul: 8, waterMul: 2, outputMul: 1.3,
    happinessDelta: -0.0015,
    desc: '全民进入战时体制：产出 +30%、劳动力倾巢而出；代价是**有机物消耗 ×8**（水 ×2）、人口增长放缓（×0.55）、幸福度缓慢下滑。' },
];

/** 取星球实例（或 pop 对象）的管理模式；未设置 = 常规 */
export function manageModeOf(inst) {
  const id = inst && inst.manageMode;
  return MANAGE_MODES.find((m) => m.id === id) || MANAGE_MODES[0];
}

/** 管理模式的产线产出乘数（production.js 调用） */
export function manageOutputMulOf(inst) {
  return manageModeOf(inst).outputMul;
}

/** 某类营养的管理模式消耗乘数 */
function manageConsumeMul(mm, k) {
  if (k === 'organic') return mm.organicMul;
  if (k === 'water') return mm.waterMul;
  return 1;
}

// 庇护富余加成（v0.0.91 设计者要求）：「庇护远大于人数时，人数增速加快一些」。
//   口径：shelterRatio = 庇护总量 / 人口（不封顶；≤1 视为无富余）。
//   加成倍率 growthBonus = 1 + min(MAX, max(0, ratio − 1) × MAX)：
//     ratio ≤ 1 → 1.00（无加成）
//     ratio = 1.5 → 1.25
//     ratio ≥ 2 → 1.50（封顶 +50% 的人口增速）
//   只作用于「增长」（f ≥ 0），衰减（f < 0）不受影响。
export const SHELTER_BONUS_MAX = 0.5;   // 人口增速最多 +50%

// 庇护富余加成倍率（见 SHELTER_BONUS_MAX 注释）。ratio = 庇护总量 / 人口。
export function shelterGrowthBonus(ratio) {
  const r = Number(ratio) || 0;
  return 1 + Math.min(SHELTER_BONUS_MAX, Math.max(0, r - 1) * SHELTER_BONUS_MAX);
}
// 兼容旧名（保留导出，避免其它模块引用报错）
export const GROWTH_THRESHOLD = 0.5;
export const DECLINE_THRESHOLD = 0.5;

// ============================================================================
// 工作强度 5 档
// ============================================================================
// v0.0.6 重做（设计者两条要求同时满足）：
//
//   ①「工作强度对工作效率的提升**略大于**对消耗的提升」
//      —— 这是指**档位之间**的边际关系，不是把整张表抬高：
//         从低档升到高档时，产出涨得比消耗快一点。
//         轻度→标准：产出 ×1.429 / 消耗 ×1.375
//         标准→高强度：产出 ×1.560 / 消耗 ×1.500
//         高强度→极限：产出 ×1.538 / 消耗 ×1.515
//      等价的说法：单位口粮换来的产出（outputMul / consumeMul）随档位**单调递增**
//      （v0.0.6 的性质；v0.0.8 上调了消耗倍率，此单调性不再成立，见下方 v0.0.8 注释）
//         轻度 0.4375 < 标准 0.4545 < 高强度 0.4727 < 极限 0.4800
//      → 越累越「划算」，每一档都有存在理由，玩家会真的去纠结该开几档。
//
//   ②「工作时消耗略加大」
//      → consumeMul 由 v0.0.5 的 1.5 / 2.0 / 3.0 / 4.5 提到 **1.6 / 2.2 / 3.3 / 5.0**。
//
//   v0.0.8：在 v0.0.6 基础上**整体再上调消耗倍率**，让「工作时」比「休息」明显更费：
//      light    1.6 → 2.0
//      standard 2.2 → 3.0
//      high     3.3 → 4.5
//      extreme  5.0 → 6.5
//      rest 1.0 与 全部 outputMul 一律不动（设计者未要求改产出，动了会整体改变节奏）。
//   新旧消耗倍率对照（outputMul 全程未变）：
//      light    1.6 → 2.0   (outputMul 0.70)
//      standard 2.2 → 3.0   (outputMul 1.00)
//      high     3.3 → 4.5   (outputMul 1.56)
//      extreme  5.0 → 6.5   (outputMul 2.40)
//   v0.0.93：设计者要求「工人消耗减小」，工作强度消耗倍率整体下调（outputMul 一律不动）：
//      light    2.0 → 1.7
//      standard 3.0 → 2.4
//      high     4.5 → 3.4
//      extreme  6.5 → 4.8
//      rest 1.0 不变；outputMul 0.70 / 1.00 / 1.56 / 2.40 全部不变。
//   v0.1.0：极限档消耗倍率 4.8 → 5.0（对齐设计者「消耗 ×5」口径），其余档位不变。
//     每档补 desc 如实说明「强度越大越不划算（单位口粮换来的产出会下降）」；
//     极限档可被「极限工作强化」升级（inst.pop.extremeWorkLevel）放大（见 getIntensity）。
//
//   ⚠ 为什么标准档 outputMul 必须保持 **1.00**：
//     产出倍率是所有生产活动（采集、施工、科研、加工）的公共乘数，
//     把整张表等比抬高会让整个游戏的产出凭空翻倍，那是另一件事、会打乱全部既有节奏。
//     这里只调**相对关系**：标准档仍是基准 1.00，靠下调低档、上调高档来制造梯度。
//
//   v0.0.5 的旧表（1.5/2.0/3.0/4.5 配 0.5/1.0/1.5/2.0）问题在于：
//     标准→高强度 两边的倍数**相等**（都是 1.5），高强度→极限 产出涨得**比消耗慢**
//     （1.333 < 1.5）——极限档纯亏。玩家没有任何理由往上开档，整个强度系统形同虚设。
export const WORK_INTENSITY = [
  {
    id: 'rest', nameCn: '休息', intensity: 0, consumeMul: 1.0, outputMul: 0,
    desc: '休息：不分配工作，产出倍率 ×0、消耗倍率 ×1.0（仅维持基础生存消耗，不产出劳动）。',
  },
  {
    id: 'light', nameCn: '轻度', intensity: 0.5, consumeMul: 1.7, outputMul: 0.70,
    desc: '产出倍率 ×0.70、消耗倍率 ×1.7；强度越大越不划算（单位口粮换来的产出会下降）。',
  },
  {
    id: 'standard', nameCn: '标准', intensity: 1.0, consumeMul: 2.4, outputMul: 1.00,
    desc: '产出倍率 ×1.00、消耗倍率 ×2.4；强度越大越不划算（单位口粮换来的产出会下降）。',
  },
  {
    id: 'high', nameCn: '高强度', intensity: 1.5, consumeMul: 3.4, outputMul: 1.56,
    desc: '产出倍率 ×1.56、消耗倍率 ×3.4；强度越大越不划算（单位口粮换来的产出会下降）。',
  },
  {
    id: 'extreme', nameCn: '极限', intensity: 2.0, consumeMul: 5.0, outputMul: 2.40,
    desc: '产出倍率 ×2.40、消耗倍率 ×5.0；强度越大越不划算（单位口粮换来的产出会下降）。'
        + '「极限工作强化」升级可进一步放大此档的产出与消耗倍率。',
  },
];

const INTENSITY_BY_ID = Object.fromEntries(WORK_INTENSITY.map((w) => [w.id, w]));

// 取值时若传入 pop，则「极限」档会读 pop.extremeWorkLevel（由 state.js 每 tick 写入）：
//   产出倍率 × 1.10^level、消耗倍率 × 1.15^level（level 为 0 或省略时行为与基础值一致）。
// 旧签名 getIntensity(id) 仍可调用（pop 缺省 null → 返回基础值），保持向后兼容。
export function getIntensity(id, pop = null) {
  const base = INTENSITY_BY_ID[id] || INTENSITY_BY_ID.standard;
  if (base.id === 'extreme' && pop) {
    const level = Number(pop.extremeWorkLevel) || 0;
    if (level !== 0) {
      return {
        ...base,
        outputMul: base.outputMul * Math.pow(1.10, level),
        consumeMul: base.consumeMul * Math.pow(1.15, level),
      };
    }
  }
  return base;
}

// 便捷写法：先传 pop 再传 id（与 getIntensity(id, pop) 等价，便于生产层按人口取档）。
export function getIntensityFor(pop, id) {
  return getIntensity(id, pop);
}

// ============================================================================
// 职业列表 JOBS
// ============================================================================
// 字段说明：
//   buildingId  该职业在哪个建筑上班（null = 无需建筑，如露天采集）
//   gatherLayer 采集类职业绑定星球哪一层（surface/underground/core/gas），
//               生产层据此把人力折算成采集速率；非采集职业为 null
//   desc        一句话说明，人力面板直接显示
//
// 【一个建筑可以有多个职业】例：建筑工厂（施工）与船坞（造船）各自独立占用工位池。
// 注：自 v0.0.9 起，熔炉 / 化学实验室 / 制造车间等「加工建筑」不再挂岗位，
//   统一改走生产面板的生产线（inst.lines），由 core/production.js 结算。
export const JOBS = [
  // 地表采集（无需建筑：露天就能挖）
  { id: 'surface_gatherer',     nameCn: '露天采集工',   group: 'surface',     buildingId: null,                  gatherLayer: 'surface',     desc: '露天采集地表资源：有机质、泥土、石头、水、粘土、石英等。' },
  // 地下采集（三个矿井，按层分工）
  { id: 'mine_shallow_worker',  nameCn: '浅层矿井工',   group: 'underground', buildingId: 'mine_shallow',        gatherLayer: 'underground', desc: '在浅层矿井开采地下层矿藏。' },
  { id: 'mine_deep_worker',     nameCn: '深层矿井工',   group: 'underground', buildingId: 'mine_deep',           gatherLayer: 'underground', desc: '在深层矿井开采地下层矿藏（效率更高）。' },
  { id: 'mine_core_worker',     nameCn: '地心矿井工',   group: 'underground', buildingId: 'mine_core',           gatherLayer: 'core',        desc: '在地心矿井开采地核层稀有矿藏。' },
  // 气体
  { id: 'gas_collector_worker', nameCn: '大气收集器工', group: 'surface',     buildingId: 'gas_collector',       gatherLayer: 'gas',         desc: '从星球气体储量中提取氮气、氧气、氨气、甲烷、二氧化碳等。' },
  // 发电（注：v0.0.9 起熔炉 / 高炉 / 电解 / 化学实验室 / 精细加工 / 自定义化工等加工建筑不再挂岗位，统一改走生产面板的生产线；
  //   v0.1.1 起火力发电厂 / 清洁发电厂改为**无人工厂**（jobs=0、按座数发电），两个发电岗位随之删除，
  //   老存档残留的分配人数由 ensureRemovedJobsCleared 兼容清零）
  { id: 'manual_power_worker',  nameCn: '人力发电厂工', group: 'power',       buildingId: 'manual_power',        gatherLayer: null,          desc: '纯靠人力驱动发电，不烧任何燃料。' },
  { id: 'combustion_worker',    nameCn: '综合燃烧室工', group: 'power',       buildingId: 'combustion_chamber',  gatherLayer: null,          desc: '可燃烧包括核燃料在内的全部燃料，效率最高。' },
  // 科研
  { id: 'researcher',           nameCn: '科研人员',     group: 'research',    buildingId: 'lab',                 gatherLayer: null,          desc: '在科研所产出研究点，推动科技树与永久升级。' },
  // 建造与制造
  { id: 'builder',              nameCn: '建筑工',       group: 'build',       buildingId: 'workshop',            gatherLayer: null,          desc: '在建筑工厂施工。**没人干这个，任何建筑都推进不下去**（硬门槛，不是加速）。' },
  // 后勤（注：生物工厂等加工建筑已在 v0.0.9 改为生产线，不再挂岗位）
  //   农田（farm）是例外：设计者明确「农田不走生产线，按岗位分配人力」，
  //   故 v0.0.91 把 farm_worker 恢复为独立岗位，由 js/core/production.js 的农田分支
  //   用 jobOutput(pop, 'farm_worker') 取人力驱动。
  { id: 'farm_worker',          nameCn: '农田工',       group: 'logistics',   buildingId: 'farm',                gatherLayer: null,          desc: '在农田按岗位分配人力种植有机质（不走生产线，由农田工岗位驱动）。' },
  { id: 'repair_bay_worker',    nameCn: '修理厂工',     group: 'logistics',   buildingId: 'repair_bay',          gatherLayer: null,          desc: '维护设备。用精细度越高的材料造的设备修得越慢。' },
  // 航天
  { id: 'dock_worker',          nameCn: '船坞工',       group: 'ship',        buildingId: 'dock',                gatherLayer: null,          desc: '在船坞组装、改装与维护飞船。**没有船坞工就造不出船**。' },
];

const JOB_BY_ID = Object.fromEntries(JOBS.map((j) => [j.id, j]));

// ============================================================================
// 老存档兼容：已删除岗位的分配清理（v0.1.1，需求 14）
// ============================================================================
// 火力发电厂 / 清洁发电厂改为「无人工厂」（jobs=0、按座数发电）后，两个发电岗位删除。
// 老存档的 pop.assignments 里可能还挂着这两职业的人数——它们不在 JOBS 里，
// 任何面板都不再显示，却会永远占用「可用人力」。在人力汇总与代谢结算前顺手清掉（幂等）。
const REMOVED_JOB_IDS = ['thermal_plant_worker', 'clean_plant_worker'];

// 把已删除岗位的分配条目清掉（直接删除，人数归零）。可重复调用。
export function ensureRemovedJobsCleared(pop) {
  if (!pop || !pop.assignments || typeof pop.assignments !== 'object') return;
  for (const id of REMOVED_JOB_IDS) {
    if (pop.assignments[id]) delete pop.assignments[id];
  }
}

export function getJob(id) {
  return JOB_BY_ID[id] || null;
}

// 某个建筑下挂着哪些职业（一个建筑可能挂多个 → 支持「一个建筑里干不同的活」）
export function jobsOfBuilding(buildingId) {
  return JOBS.filter((j) => j.buildingId === buildingId);
}

// { buildingId: [job, ...] }
export const JOBS_BY_BUILDING = (() => {
  const m = {};
  for (const j of JOBS) {
    if (!j.buildingId) continue;
    if (!m[j.buildingId]) m[j.buildingId] = [];
    m[j.buildingId].push(j);
  }
  return m;
})();

// 需要建筑的职业集合（UI 用来算「有多少岗位被隐藏了」）
export const BUILDING_JOB_COUNT = JOBS.filter((j) => !!j.buildingId).length;

// 大类顺序与中文标签（UI 按此分组；本版人力面板改为按建筑分组，这里保留供其它面板使用）
export const JOB_GROUPS = [
  { id: 'surface',    nameCn: '采集' },
  { id: 'underground',nameCn: '地下开采' },
  { id: 'smelt',      nameCn: '冶炼' },
  { id: 'chem',       nameCn: '化工' },
  { id: 'power',      nameCn: '发电' },
  { id: 'research',   nameCn: '科研' },
  { id: 'build',      nameCn: '建造与制造' },
  { id: 'logistics',  nameCn: '后勤' },
  { id: 'ship',       nameCn: '航天' },
];

// ============================================================================
// 人口对象
// ============================================================================

// 创建人口对象。totalPopulation = 星球总人数。
export function createPopulation(totalPopulation) {
  return {
    total: Math.max(0, Number(totalPopulation) || 0), // 总人数
    happiness: HAPPINESS_INIT,                          // 幸福度 0..1
    // 分配表：{ [jobId]: { count, intensityId } }；1 人力同时只干 1 职业
    assignments: {},
  };
}


// 总人力 = floor(总人数 × 参与率)
export function getTotalLabor(pop) {
  return Math.floor(pop.total * LABOR_PARTICIPATION);
}

// 已分配人力总数（所有职业 count 之和）
export function getAssigned(pop) {
  if (!pop) return 0;
  ensureRemovedJobsCleared(pop);   // v0.1.1：幽灵岗位不占人力（老存档兼容）
  const asg = (pop.assignments && typeof pop.assignments === 'object') ? pop.assignments : {};
  let s = 0;
  for (const id in asg) s += (asg[id] && asg[id].count) || 0;
  return s;
}

// 可用人力 = floor(总人力 × 幸福度) − 已分配
export function getAvailable(pop) {
  const cap = Math.floor(getTotalLabor(pop) * pop.happiness);
  return Math.max(0, cap - getAssigned(pop));
}

// ============================================================================
// 建筑工位模型（v0.0.5）
// ============================================================================
// counts = { [buildingId]: 已建成数量 }

// 某建筑提供的总工位 = 建筑数 × 工位数
export function buildingSlots(buildingId, counts) {
  const n = (counts && Number(counts[buildingId])) || 0;
  const b = BUILDING_BY_ID[buildingId];
  if (n <= 0 || !b) return 0;
  return n * (Number(b.jobs) || 0);
}

// 已指派到该建筑的人数（该建筑下所有职业的 count 之和）
export function assignedToBuilding(pop, buildingId) {
  if (!pop) return 0;
  // v0.3.3：老档/云端合并进来的 pop 可能没有 assignments，直接索引会抛
  //   TypeError 并中断整个 tick（表现为电力/产线/舰队页一起打不开）。
  const asg = (pop.assignments && typeof pop.assignments === 'object') ? pop.assignments : {};
  let s = 0;
  const jobs = JOBS_BY_BUILDING[buildingId] || [];
  for (const j of jobs) {
    const a = asg[j.id];
    if (a && a.count > 0) s += a.count;
  }
  return s;
}

// 该建筑的空闲工位数 = 建筑数 × 工位数 − 已指派人数（设计者给的公式）
export function freeSlots(pop, buildingId, counts) {
  return Math.max(0, buildingSlots(buildingId, counts) - assignedToBuilding(pop, buildingId));
}

// 某职业当前最多还能再塞多少人（受「可用人力」与「所属建筑空闲工位」双重限制）
export function jobCapacity(pop, jobId, counts) {
  const job = getJob(jobId);
  if (!job) return 0;
  const asg = (pop.assignments && typeof pop.assignments === 'object') ? pop.assignments : {};
  const a = asg[jobId];
  const old = a ? a.count : 0;
  let max = old + getAvailable(pop);
  if (counts && job.buildingId) {
    max = Math.min(max, old + freeSlots(pop, job.buildingId, counts));
  }
  return Math.max(0, max);
}

// 当前「可分配」的职业清单：
//   - 不需要建筑的（露天采集）永远可分配；
//   - 需要建筑的，只有该建筑已建成（数量 > 0）才出现 —— 未建成/未解锁的一律不显示。
export function assignableJobs(counts) {
  return JOBS.filter((j) => !j.buildingId || buildingSlots(j.buildingId, counts) > 0);
}

// 有多少岗位因为建筑没建而暂时不可见（UI 底部提示用）
export function hiddenJobCount(counts) {
  return JOBS.filter((j) => j.buildingId && buildingSlots(j.buildingId, counts) <= 0).length;
}

// 分配 / 调整某职业人力。count 为目标人数，会被「可用人力」与「建筑空闲工位」夹取。
// 注意：1 人力只能分配到一个职业。
export function assignWorkers(pop, jobId, count, counts) {
  const job = getJob(jobId);
  if (!job) return 0;
  if (!pop.assignments || typeof pop.assignments !== 'object') pop.assignments = {};
  if (!pop.assignments[jobId]) pop.assignments[jobId] = { count: 0, intensityId: 'standard' };
  const a = pop.assignments[jobId];
  const max = jobCapacity(pop, jobId, counts);
  const c = clamp(Math.round(Number(count) || 0), 0, max);
  a.count = c;
  return c;
}

// 设置某职业的工作强度档位（不分配人，只改档位；无分配记录时新建）
export function setJobIntensity(pop, jobId, intensityId) {
  if (!getJob(jobId) || !getIntensity(intensityId)) return;
  if (!pop.assignments || typeof pop.assignments !== 'object') pop.assignments = {};
  if (!pop.assignments[jobId]) pop.assignments[jobId] = { count: 0, intensityId: 'standard' };
  pop.assignments[jobId].intensityId = intensityId;
}

// ============================================================================
// 营养代谢（v0.0.5）
// ============================================================================
// 全体人按「休息」基数吃喝排泄；上工者按强度倍率放大（代谢更旺）。
// 返回 { total: 总人数, extra: Σ 上工人数 ×(消耗倍率−1) }
function metabolismScale(pop) {
  ensureRemovedJobsCleared(pop);   // v0.1.1：幽灵岗位不参与代谢放大（老存档兼容）
  const asg = (pop.assignments && typeof pop.assignments === 'object') ? pop.assignments : {};
  let extra = 0;
  for (const id in asg) {
    const a = asg[id];
    if (!a || !(a.count > 0)) continue;
    extra += a.count * (getIntensity(a.intensityId).consumeMul - 1);
  }
  return { total: Number(pop.total) || 0, extra };
}

// 当前每秒消耗：{ oxygen, organic, water }（v0.2.11：含管理模式乘数，读 pop.manageMode）
export function consumptionPerSec(pop) {
  const { total, extra } = metabolismScale(pop);
  // v0.2.6：consumeScale —— 1936 剧本人口按国家规模放大（德国 80000），
  //   每人消耗同步缩放，否则一秒钟就能吃空整仓库
  const cs = Math.max(1e-6, Number(pop && pop.consumeScale) || 1);
  const personSec = (total + extra) * cs;
  const mm = manageModeOf(pop);
  const out = {};
  for (const k of NUTRIENT_KEYS) out[k] = personSec * BASE_CONSUME[k] * manageConsumeMul(mm, k);
  return out;
}

// 当前每秒代谢产出：{ co2, methane, ammonia }
export function metabolitePerSec(pop) {
  const { total, extra } = metabolismScale(pop);
  const cs = Math.max(1e-6, Number(pop && pop.consumeScale) || 1);
  const personSec = (total + extra) * cs;
  const out = {};
  for (const k of METABOLITE_KEYS) out[k] = personSec * BASE_PRODUCE[k];
  return out;
}

// 已分配人力占总人力的比例 W（过劳项用）
export function workRatioOf(pop) {
  const totalLabor = getTotalLabor(pop);
  return totalLabor > 0 ? getAssigned(pop) / totalLabor : 0;
}

// ============================================================================
// 幸福度公式（对应文件顶部那张表）
// ============================================================================
// opts = { supplyRatio: 0..1, shelter: 0..1, tempK: 开尔文 }
//   supplyRatio 缺省 1（吃饱）；shelter 缺省 1（有庇护）；tempK 缺省 293 K（舒适）
export function computeHappiness(pop, opts = {}) {
  const S = clamp(Number.isFinite(opts.supplyRatio) ? opts.supplyRatio : 1, 0, 1);
  const C = clamp(Number.isFinite(opts.shelter) ? opts.shelter : 1, 0, 1);
  const T = Number.isFinite(opts.tempK) ? opts.tempK : COMFORT_TEMP_K;
  const W = workRatioOf(pop);

  const base = HAPPINESS_BASE;
  const food = HAPPINESS_FOOD_MAX * S;
  const hunger = -HUNGER_PENALTY_MAX * (1 - S);
  const shelter = HAPPINESS_SHELTER_MAX * C;
  const overwork = -OVERWORK_PENALTY
    * Math.min(1, Math.max(0, W - OVERWORK_COMFORT) / (1 - OVERWORK_COMFORT));
  const temp = -HAPPINESS_TEMP_MAX * Math.min(1, Math.abs(T - COMFORT_TEMP_K) / TEMP_TOLERANCE_K);

  return {
    value: clamp(base + food + hunger + shelter + overwork + temp, 0, 1),
    parts: { base, food, hunger, shelter, overwork, temp, W, S, C, T },
  };
}

// v0.0.94：母星幸福度的下限（母星基本不波动）
export const HOME_HAPPINESS_FLOOR = 0.88;

// 只要数值（UI 快速取用）
export function happinessOf(pop, opts) {
  return computeHappiness(pop, opts).value;
}

// 推进 dt 秒：营养消耗、幸福度变化、人口增长 / 下降
// supply = { oxygen, organic, water } 为「当前库存」对象，会被就地扣减
//          （三项里最缺的那项决定实际进食比例 ratio，不足时按比例缩减并拉低幸福度）
// opts   = { shelter, tempK } 可选：庇护覆盖率与温度，缺省视为理想值
// 返回   = { ratio, consumed, produced }（produced 已按进食比例折算，调用方负责写回物品栏）
export function tickPopulation(pop, dt, supply, opts = {}) {
  dt = Math.max(0, Number(dt) || 0);
  const empty = { ratio: 1, consumed: {}, produced: {} };
  if (dt === 0) return empty;
  supply = supply || {};

  // v0.2.11：管理模式 —— 调用方经 opts.manageMode 传 inst.manageMode（id），
  //   写回 pop.manageMode 供 consumptionPerSec / 物品栏展示同步
  const mm = manageModeOf({ manageMode: opts.manageMode || pop.manageMode });
  pop.manageMode = mm.id;

  // v0.0.94：**在本 tick 扣粮之前**记录「有没有食物」。
  //   若在扣完之后再判断，那么刚好把最后一口吃完的那一秒会被误判成断粮，
  //   幸福度立刻挨一刀 —— 这正是设计者说的那种抖动。
  const fedAtTickStart = NUTRIENT_KEYS.every((k) => Number(supply[k]) > 0);

  // 1) 三条营养：取最紧缺的那条决定进食比例
  const need = consumptionPerSec(pop);
  let ratio = 1;
  for (const k of NUTRIENT_KEYS) {
    const want = (need[k] || 0) * dt;
    const have = Number(supply[k]) || 0;
    ratio = Math.min(ratio, clamp(have / Math.max(want, 1e-12), 0, 1));
  }
  const consumed = {};
  for (const k of NUTRIENT_KEYS) {
    const want = (need[k] || 0) * dt;
    consumed[k] = want * ratio;
    supply[k] = Math.max(0, (Number(supply[k]) || 0) - consumed[k]);
  }

  // 2) 代谢产出：吃不饱就少排（按比例折算）
  const prod = metabolitePerSec(pop);
  const produced = {};
  for (const k of METABOLITE_KEYS) produced[k] = (prod[k] || 0) * dt * ratio;

  // 3) 幸福度：先按公式算出目标值，再以固定时间常数逼近（避免瞬变）
  //   v0.0.94（设计者）：**只要有食物，就认为食物充足**。
  //     旧的 supplyRatio = 当秒「最紧缺营养的够吃程度」，于是库存只要在某一秒略低于当秒需求
  //     （比如有机质剩 60 而当秒要 72），S 就被压到 0.83，幸福度开始掉；
  //     人口一掉、产出更少、更容易再次不够 —— 形成「幸福度越低越不够吃」的死循环。
  //     现在：三种营养**都还有存货**就按吃饱算（S = 1）；只有真的**某一项见底**才按紧缺程度扣。
  const fed = fedAtTickStart;
  const supplyRatio = fed ? 1 : ratio;

  // v0.0.94：母星的幸福度基本不参与波动（设计者：「母星幸福度基本不要变」）。
  //   做法：母星的目标值下限抬到 HOME_HAPPINESS_FLOOR（0.88），低于它就往回补，
  //   这样母星不会因为一两秒的供给抖动就被拖进死循环。
  const rawTarget = computeHappiness(pop, {
    supplyRatio,
    shelter: opts.shelter,
    tempK: opts.tempK,
  }).value;
  //   注意：下限只在「还有食物」时生效 —— 真的断粮（某一项见底）仍然要掉，
  //   否则玩家看不到问题、也失去了补救的动机。断粮时恢复也快（上升时间常数 50 秒）。
  const target = (opts.homePlanet && fed) ? Math.max(rawTarget, HOME_HAPPINESS_FLOOR) : rawTarget;
  // v0.0.8：下降时更慢地逼近 target（HAPPINESS_RECOVER_DOWN），上升时照旧（HAPPINESS_RECOVER）
  const _recover = (target < pop.happiness) ? HAPPINESS_RECOVER_DOWN : HAPPINESS_RECOVER;
  pop.happiness = clamp(pop.happiness + (target - pop.happiness) * _recover * dt, 0, 1);
  // v0.2.6：管理模式带来的持续幸福度压力（如「战时总动员」）
  if (mm.happinessDelta) pop.happiness = clamp(pop.happiness + mm.happinessDelta * dt, 0, 1);

  // 4) 人口变化：连续生育率（v0.0.52）
  //    f > 0 → 增长；f = 0 → 持平；f < 0 → **倒扣**（幸福度低于 0.5 人口就开始减少）

  // 4a) 庇护富余加成（v0.0.91）：仅放大「增长」（f ≥ 0），衰减不放大。
  //   调用方优先传 opts.shelterTotal（= 庇护总量 / 人口，不封顶）；
  //   或传 opts.shelterCounts（建筑座数表），由本模块用 BUILDING_BY_ID[id].shelter 现算总量；
  //   都没有则退化用 opts.shelter（= 庇护覆盖率，已封顶到 1，故加成≈0，保持旧行为，无循环依赖）。
  let shelterRatio = 0;
  if (Number.isFinite(opts.shelterTotal)) {
    shelterRatio = opts.shelterTotal;
  } else if (opts.shelterCounts) {
    let total = 0;
    for (const id in opts.shelterCounts) {
      const b = BUILDING_BY_ID[id];
      if (b && b.shelter) total += (Number(opts.shelterCounts[id]) || 0) * b.shelter;
    }
    shelterRatio = pop.total > 0 ? total / pop.total : 0;
  } else if (Number.isFinite(opts.shelter)) {
    shelterRatio = opts.shelter;   // 已封顶到 1，加成通常为 0
  }
  const growthBonus = shelterGrowthBonus(shelterRatio);

  const f = (pop.happiness - NEUTRAL_HAPPINESS) / (1 - NEUTRAL_HAPPINESS);
  // v0.2.11：管理模式放大增长（仅 f ≥ 0；衰减不受影响）
  pop.total += pop.total * (f >= 0 ? f * GROWTH_RATE * growthBonus * mm.growthMul : f * DECLINE_RATE) * dt;
  pop.total = Math.max(0, pop.total);

  return { ratio, consumed, produced };
}

// 某职业当前的有效产出系数 = 人数 × 强度产出倍率（未分配人 → 0）
// 说明：本函数只给「劳动系数」；真正产出还需生产层结合建筑与星球储藏判定。
export function jobOutput(pop, jobId) {
  // v0.3.3：与 assignedToBuilding/getAssigned 同理，assignments 缺失时按「无人」处理，
  //   避免老档渲染时抛 TypeError。
  const asg = (pop && pop.assignments && typeof pop.assignments === 'object') ? pop.assignments : {};
  const a = asg[jobId];
  if (!a || a.count <= 0) return 0;
  return a.count * getIntensity(a.intensityId).outputMul;
}

// 便捷：取某职业已分配人数
export function getJobCount(pop, jobId) {
  const asg = (pop && pop.assignments && typeof pop.assignments === 'object') ? pop.assignments : {};
  const a = asg[jobId];
  return a ? a.count : 0;
}

// 采集层的人力分布：{ surface, underground, core, gas }，值为「有效人力」（人数 × 产出倍率）
// 生产层据此把人力换算成各层的采集速率。
export function gatherLaborByLayer(pop) {
  const layer = { surface: 0, underground: 0, core: 0, gas: 0 };
  for (const j of JOBS) {
    if (!j.gatherLayer) continue;
    layer[j.gatherLayer] = (layer[j.gatherLayer] || 0) + jobOutput(pop, j.id);
  }
  return layer;
}

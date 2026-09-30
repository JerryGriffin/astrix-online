// 科技数据模块（Astrix v0.0.4）
// 纯 ES module，零依赖，浏览器直接 import。
//
// v0.0.8 关键改动（生效日期：2026-09-18）：
//   * 科技「研究点」cost 按 tier 全面重新定价：前期大幅降低、中后期小幅降低。
//   * 缩放规则（向下取整到百位，最小 500）：
//       tier <= 1（开局前期）：× 0.4
//       tier 2~3（中期）：× 0.7
//       tier >= 4（后期）：× 0.9
//   * 12 个 section:'facility' 的设施解锁节点随其自身 tier 一并缩放，未遗漏。
//   * tier 由本文件 computeTiers() 从 prereq 自动展开，本次缩放读取的即其输出。
//
// v0.1.0 关键改动（科技点前期节奏大幅加快，仅动 cost）：
//   * tier 0  研究点 → 100；tier 1 → 200（开局前期直接定死）。
//   * tier 2~3 在 v0.0.8 既有数值基础上 ×0.7（结果均为整数，无需向下取整）。
//   * tier ≥ 4 维持 v0.0.8 的数值不动。
//   * 唯一例外：t_d3 自定义化工厂（tier 6）研究点由 90 万改为 100 万（1m）。
//   * 注意：本文件只动 cost，desc / prereq / unlocksBuilding 一律不变。
//
// v0.0.4 关键改动：
//   * A4 大气收集器前置由「A1」改为「A1 + B2」。
//   * 新增 E4 制造车间（前置 E2），解锁建筑「制造车间」。
//   * 船坞（E3）下面展开四条支线：a 舰船外壳 / b 引擎 / c 武器 / d 船上设施，
//     再由 MK2 / MK3 两个节点把全部舰载装备推到下一级。
//
// v0.0.3 要点：
//   * 科研所、建筑工厂：默认解锁（不需要科技，BUILDINGS 里 unlockTech 为 null）。
//   * A1 深度采集、A2 农田、B4 人力发电厂：无前置。
//   * 船坞（E3）不再是终点，只前置 C2 深层矿井；
//     它是 A3 生物工厂、B3 电解池、D1 化学实验室、C3 地心矿井的前置。
//   * D3 自定义化工厂是极高科技，前置 D2 精细加工厂。
//   * 研究点花费：A1=500、A2=300、A3=10e5、D3=10e5 为设计者给定；
//     其余为按科技层级推算、设计者给定的数值。

const RAW_TECHS = [
  // ===== A 线：采集与生命维持 =====
  {
    id: 't_a1', code: 'A1', nameCn: '深度采集', branch: 'life',
    prereq: [], cost: 100, unlocksBuilding: null,
    unlockResources: [],
    desc: '地表的所有资源（有机质、泥土、岩石、粘土、二氧化硅、石墨、'
        + '孔雀石、石英、水、红土、硫磺）一开始就能露天采集。'
        + '深度采集 A1 的真正作用是提供进入地下浅层的资格'
        + '（它是浅层矿井 C1、高炉 B2 的前置），并提升对粘土 / 石英 / 石墨这类深埋矿物的开采能力。',
  },
  {
    id: 't_a2', code: 'A2', nameCn: '农田', branch: 'life',
    prereq: [], cost: 100, unlocksBuilding: 'farm',
    unlockResources: [],
    desc: '开垦农田，消耗二氧化碳产出有机质。无前置即可研究，'
        + '是人口增长的第一个口粮来源。',
  },
  // v0.0.9：A4 大气收集器的研究点**刻意拉高到 8000**，作为中期一道明确的门槛
  //   （设计者原话「a4研究点大幅提高」）。它前置深度采集(A1)与高炉(B2)，tier=3，
  //   不沿用 v0.0.8 那种「按 tier 打折」的口径。
  // v0.1.0：tier 3 在 v0.0.8 既有数值基础上 ×0.7 → 8000 × 0.7 = 5600。
  {
    id: 't_a4', code: 'A4', nameCn: '大气收集器', branch: 'life',
    prereq: ['t_a1', 't_b2'], cost: 5600, unlocksBuilding: 'gas_collector',
    unlockResources: [],
    desc: '从星球气体储量中收集气体资源。氨气只以气态存在、不在地表刷新，'
        + '想要氨就只能靠它。前置深度采集与高炉（收集器需要用高炉炼出的金属造）。',
  },
  {
    id: 't_a3', code: 'A3', nameCn: '生物工厂', branch: 'life',
    prereq: ['t_a2', 't_e3'], cost: 900000, unlocksBuilding: 'bio_factory',
    unlockResources: [],
    desc: '消耗大量二氧化碳，产出氧气、甲烷、氨气、有机质等，产物直接进入星球物品栏。'
        + '需要先把船坞造出来（太空级生物工程），研究点花费高达 100 万，是中期的一道硬门槛。',
  },

  // ===== B 线：冶炼与电力 =====
  {
    id: 't_b1', code: 'B1', nameCn: '熔炉', branch: 'smelt',
    prereq: ['t_a1'], cost: 200, unlocksBuilding: 'furnace',
    unlockResources: [],
    desc: '有机质烧成木头、木头烧成碳。消耗氧气，产出内能与二氧化碳。'
        + '整条热工链的起点。',
  },
  {
    id: 't_b2', code: 'B2', nameCn: '高炉', branch: 'smelt',
    prereq: ['t_b1', 't_a1'], cost: 1190, unlocksBuilding: 'blast_furnace',
    unlockResources: [],
    desc: '加碳还原冶炼基本矿石，并做一氧化碳转化与水煤气变换制氢。'
        + '',
  },
  {
    id: 't_b5', code: 'B5', nameCn: '火力发电厂', branch: 'power',
    prereq: ['t_c2'], cost: 2940, unlocksBuilding: 'thermal_plant',
    unlockResources: [],
    desc: '燃烧碳、标准煤、甲烷、氢气等常规燃料发电，每工位 60 电/秒。'
        + '',
  },
  {
    id: 't_b8', code: 'B8', nameCn: '储电站', branch: 'power',
    prereq: [], cost: 100, unlocksBuilding: 'storage_plant',
    unlockResources: [],
    desc: '单纯的电池。每座储电站提供 1e7 储电上限，不提供任何设施安装位'
        + '——电力设施在星球上可以任意安装，不需要机架。'
        + '造价全是开局就能采到的泥土 / 石头 / 有机质，无前置科技，所以研究点花费取得较低。',
  },
  {
    id: 't_b7', code: 'B7', nameCn: '清洁发电厂', branch: 'power',
    prereq: ['t_b2', 't_c2'], cost: 3430, unlocksBuilding: 'clean_plant',
    unlockResources: [],
    desc: '太阳能 / 风力 / 水利 / 地热发电，不耗燃料，每工位 80 电/秒，'
        + '输出受星球环境系数影响。',
  },
  {
    id: 't_b3', code: 'B3', nameCn: '电解池', branch: 'smelt',
    prereq: ['t_e3', 't_b2', 't_c2'], cost: 7200, unlocksBuilding: 'electrolyzer',
    unlockResources: [],
    desc: '电解提取所有粗金属，并可电解水制氢氧。需要船坞、高炉与深层矿井三者齐备。'
        + '',
  },
  {
    id: 't_b6', code: 'B6', nameCn: '综合燃烧室', branch: 'power',
    prereq: ['t_c3', 't_b5'], cost: 27000, unlocksBuilding: 'combustion_chamber',
    unlockResources: [],
    desc: '可燃全部燃料（含联氨与核燃料），每工位 150 电/秒，是后期主力电源。'
        + '需要地心矿井与火力发电厂。',
  },

  // ===== C 线：矿井 =====
  {
    id: 't_c1', code: 'C1', nameCn: '浅层矿井', branch: 'mine',
    prereq: ['t_a1'], cost: 200, unlocksBuilding: 'mine_shallow',
    unlockResources: [],
    desc: '开采星球浅层（地下第一层）资源。',
  },
  {
    id: 't_c2', code: 'C2', nameCn: '深层矿井', branch: 'mine',
    prereq: ['t_c1'], cost: 2450, unlocksBuilding: 'mine_deep',
    unlockResources: [],
    desc: '向更深处掘进，开采深层富矿脉。船坞、火力发电厂、清洁发电厂与电解池都依赖它。'
        + '',
  },
  {
    id: 't_c3', code: 'C3', nameCn: '地心矿井', branch: 'mine',
    prereq: ['t_c2', 't_e3', 't_b3'], cost: 36000, unlocksBuilding: 'mine_core',
    unlockResources: [],
    desc: '直抵星球地核，是太空元素与高倍粗金粗银的唯一来源。'
        + '需要深层矿井、船坞与电解池。',
  },

  // ===== D 线：精细化工 =====
  {
    id: 't_d1', code: 'D1', nameCn: '化学实验室', branch: 'chem',
    prereq: ['t_b2', 't_e3'], cost: 10800, unlocksBuilding: 'chem_lab',
    unlockResources: [],
    desc: '合成塑料、橡胶、铝合金、炸药粉等复合资源。'
        + '',
  },
  {
    id: 't_d2', code: 'D2', nameCn: '精细加工厂', branch: 'chem',
    prereq: ['t_d1', 't_b3'], cost: 22500, unlocksBuilding: 'refinery',
    unlockResources: [],
    desc: '把 2 个相同材料合成为 1 个，提升属性与精细度（每次 +1）；'
        + '代价是以该材料建造的建筑修理时间增加。',
  },
  {
    id: 't_d3', code: 'D3', nameCn: '自定义化工厂', branch: 'chem',
    prereq: ['t_d2'], cost: 1000000, unlocksBuilding: 'custom_chem',
    unlockResources: [],
    desc: '极高科技。允许自定义反应配方，量产常规工业链无法合成的材料。'
        + '前置精细加工厂，研究点花费 100 万。',
  },

  // ===== E 线：施工与航天 =====
  {
    id: 't_e2', code: 'E2', nameCn: '修理厂', branch: 'industry',
    prereq: ['t_a1'], cost: 200, unlocksBuilding: 'repair_bay',
    unlockResources: [],
    desc: '产生修理工位，修复舰船与建筑损耗。',
  },
  {
    id: 't_e3', code: 'E3', nameCn: '船坞', branch: 'industry',
    prereq: ['t_c2'], cost: 9800, unlocksBuilding: 'dock',
    unlockResources: [],
    desc: '建造飞船前往其他星球。它不是终点而是枢纽——'
        + '建成后才解锁生物工厂（A3）、电解池（B3）、化学实验室（D1）与地心矿井（C3），'
        + '并且开启舰船支线（外壳 / 引擎 / 武器 / 船上设施）。',
  },
  {
    id: 't_e4', code: 'E4', nameCn: '制造车间', branch: 'industry',
    prereq: ['t_e2'], cost: 1960, unlocksBuilding: 'fabricator',
    unlockResources: [],
    desc: '在修理厂之后建立真正的制造能力，生产螺栓、管线、轴承、阀门、仪表等'
        + '**小型与中型物品**。建筑与飞船的部件都靠它供货。'
        + '',
  },

  // ===== M 线：军事（v0.2.0 新增；v0.2.5 移除无实际功能的 t_m5 军队指挥）=====
  // 【v0.2.6 改动】整条线从「军事」科技分支**移入「设施」子分类**（与船上设施、电力设施并列），
  //   且**前置改为「已建成军营」**（reqBuilding）—— 先建军营、再谈军备，与造船（t_e3）互为平行支线。
  //   部件解锁仍走本线（army_parts.js 的 tech 字段），军队系统在 t_m1 研究后开放（组装由军营驱动）。
  {
    id: 't_m1', code: 'M1', nameCn: '单兵武器', branch: 'military', section: 'facility',
    prereq: ['t_e4'], reqBuilding: 'barracks', cost: 3000, unlocksBuilding: null,
    unlockResources: [],
    desc: '轻武器工坊开张：制造车间解锁**突击步枪**与**轻型框架**的生产，'
        + '军队体系的起点。需先建成**军营**方可研究。',
  },
  {
    id: 't_m2', code: 'M2', nameCn: '军用装甲', branch: 'military', section: 'facility',
    prereq: ['t_m1'], reqBuilding: 'barracks', cost: 9000, unlocksBuilding: null,
    unlockResources: [],
    desc: '防护工程：解锁**轻型护甲 / 复合装甲 / 重机枪 / 重型框架**的生产，'
        + '部队从此抗得住正面交火。',
  },
  {
    id: 't_m3', code: 'M3', nameCn: '机动平台', branch: 'military', section: 'facility',
    prereq: ['t_m2'], reqBuilding: 'barracks', cost: 24000, unlocksBuilding: null,
    unlockResources: [],
    desc: '载具化：解锁**悬浮 / 履带 / 轮式**三种底盘，军队从「徒步班组」升级为「机械化部队」。',
  },
  {
    id: 't_m4', code: 'M4', nameCn: '火炮重武', branch: 'military', section: 'facility',
    prereq: ['t_m3'], reqBuilding: 'barracks', cost: 60000, unlocksBuilding: null,
    unlockResources: [],
    desc: '重火力：解锁**榴弹炮 / 观测雷达 / 补给单元**的生产，远程压制成为可能。'
        + '至此军事科技全部研究完毕，三张默认兵种蓝图全部解锁。',
  },

  // ===== 电力设施解锁（v0.0.7 新增，共 12 个，section: 'facility'）=====
  // 【定位】这些节点不进主科技树（renderTechSection 会 skip section:'facility'），
  //   统一在科研面板的「设施」分区渲染（由 facilityTechs() 取回）。
  //   code 用 F1~F12，与现有 A1~E4 不冲突。
  // 【逐级前置】每类 _2 需 _1、_3 需 _2，保证「先解锁小型再看 mkii」。
  // 【一级挂现有科技】电池组→t_b8（储电站）；火力→t_b5（火力发电厂）；
  //   光伏/风力→t_b1（熔炉，最早期的电力科技档，开局不久即可解锁）。
  // 【花费】一级 3000 / 二级 9000 / 三级 24000 研究点（研究员 1 点/秒/工位）。
  // ===== 电池组（storage）=====
  {
    id: 't_fac_battery_1', code: 'F1', nameCn: '电池组·小型', branch: 'power', section: 'facility',
    prereq: ['t_b8'], cost: 200, unlocksBuilding: null, unlockResources: [],
    desc: '解锁「小型电池」设施——最基础的储电单元，仅用 T0/T1 材料即可在建造车间生产，'
        + '是开局电力缓冲的第一步。需先研究储电站（B8）。',
  },
  {
    id: 't_fac_battery_2', code: 'F2', nameCn: '电池组·大型', branch: 'power', section: 'facility',
    prereq: ['t_fac_battery_1'], cost: 4410, unlocksBuilding: null, unlockResources: [],
    desc: '解锁「大型电池」设施——储电上限为小型的 8 倍，需 T2 金属材料（铁/铜/玻璃/陶瓷）。'
        + '研究出小型电池后方可研究。',
  },
  {
    id: 't_fac_battery_3', code: 'F3', nameCn: '电池组·超大型', branch: 'power', section: 'facility',
    prereq: ['t_fac_battery_2'], cost: 11760, unlocksBuilding: null, unlockResources: [],
    desc: '解锁「超大型电池」设施——储电上限为小型的 64 倍，需 T4 高级材料（钛/铝合金/碳化钨/橡胶）。'
        + '后期大电网的战略级储能体。需先研究大型电池。',
  },
  // ===== 光伏（solar）=====
  {
    id: 't_fac_solar_1', code: 'F4', nameCn: '光伏·小型', branch: 'power', section: 'facility',
    prereq: ['t_b1'], cost: 1470, unlocksBuilding: null, unlockResources: [],
    desc: '解锁「小型光伏」设施——把星球光照转化为电力，不耗燃料，仅用 T0/T1 材料，开局不久即可铺设。'
        + '需先研究熔炉（B1）。',
  },
  {
    id: 't_fac_solar_2', code: 'F5', nameCn: '光伏·大型', branch: 'power', section: 'facility',
    prereq: ['t_fac_solar_1'], cost: 4410, unlocksBuilding: null, unlockResources: [],
    desc: '解锁「大型光伏」设施——单座基准发电为小型的 8 倍，需 T2 材料（铁/玻璃/铝/铜）。需先研究小型光伏。',
  },
  {
    id: 't_fac_solar_3', code: 'F6', nameCn: '光伏·超大型', branch: 'power', section: 'facility',
    prereq: ['t_fac_solar_2'], cost: 21600, unlocksBuilding: null, unlockResources: [],
    desc: '解锁「超大型光伏」设施——单座基准发电为小型的 64 倍，需 T4 贵金属材料（钛/银/金/铝合金）。'
        + '行星级光伏农场。需先研究大型光伏。',
  },
  // ===== 风力（wind）=====
  {
    id: 't_fac_wind_1', code: 'F7', nameCn: '风力·小型', branch: 'power', section: 'facility',
    prereq: ['t_b1'], cost: 1470, unlocksBuilding: null, unlockResources: [],
    desc: '解锁「小型风机」设施——利用行星风场发电，不耗燃料，仅用 T0/T1 材料（石头/木头/粘土）。'
        + '需先研究熔炉（B1）。',
  },
  {
    id: 't_fac_wind_2', code: 'F8', nameCn: '风力·大型', branch: 'power', section: 'facility',
    prereq: ['t_fac_wind_1'], cost: 4410, unlocksBuilding: null, unlockResources: [],
    desc: '解锁「大型风机」设施——单座基准发电为小型的 8 倍，需 T2 材料（铁/铜/钢）。需先研究小型风机。',
  },
  {
    id: 't_fac_wind_3', code: 'F9', nameCn: '风力·超大型', branch: 'power', section: 'facility',
    prereq: ['t_fac_wind_2'], cost: 21600, unlocksBuilding: null, unlockResources: [],
    desc: '解锁「超大型风机」设施——单座基准发电为小型的 64 倍，需 T4 材料（钛/钨/锰/铝合金）。'
        + '巨型风场机组。需先研究大型风机。',
  },
  // ===== 火力（thermal）=====
  {
    id: 't_fac_thermal_1', code: 'F10', nameCn: '火力设施·小型', branch: 'power', section: 'facility',
    prereq: ['t_b5'], cost: 2700, unlocksBuilding: null, unlockResources: [],
    desc: '解锁「小型燃机」设施——燃烧固态燃料（碳）发电，输出不依赖星球环境，早期即可建立稳定电源。'
        + '需先研究火力发电厂（B5）。',
  },
  {
    id: 't_fac_thermal_2', code: 'F11', nameCn: '火力设施·大型', branch: 'power', section: 'facility',
    prereq: ['t_fac_thermal_1'], cost: 8100, unlocksBuilding: null, unlockResources: [],
    desc: '解锁「大型燃机」设施——单座基准发电为小型的 8 倍，烧标准煤，需 T2 材料（铁/钢/陶瓷）。需先研究小型燃机。',
  },
  {
    id: 't_fac_thermal_3', code: 'F12', nameCn: '火力设施·超大型', branch: 'power', section: 'facility',
    prereq: ['t_fac_thermal_2'], cost: 21600, unlocksBuilding: null, unlockResources: [],
    desc: '解锁「超大型燃机」设施——巨型燃烧中心，单座基准发电为小型的 64 倍，可烧除核燃料外的所有常规/化学燃料'
        + '（碳/标准煤/甲烷/氢气/联氨）。需先研究大型燃机。',
  },

  // ===== 船坞支线（v0.0.61 已移除）=====
  // 设计者原话：「科研里面舰船 mki-iii 去掉，无实际意义；科研里面的 abcd 也去掉，
  //   一些基础船上设施的研究前置为船坞」。
  // 原来的 6 个节点（外壳/引擎/武器/船上设施 四条支线 + MK2/MK3）连同它们的
  // a/b/c/d 编号一并删除。舰船部件现在**由「造出船坞」直接解锁**——
  // 逻辑在 js/data/ship_parts.js#isPartUnlocked：只要已研究船坞科技（t_e3），
  // 全部舰船部件即可用；MK 分级同时取消（MARKS 只保留 MKI）。
  //
  // 注意：这里只删节点，**不要重排其它节点的 code**——code 只是给人看的编号，
  // 而 id 是存档里已研究项的标识，动它会让她方存档的已研究科技语义漂移。
];

// ===== 层级（tier）自动计算：从无前置开始逐层展开 =====
// 这样以后调整前置关系时，UI 的排版层级会自动跟着变，不会对不上。
function computeTiers(raw) {
  const byId = Object.fromEntries(raw.map((t) => [t.id, t]));
  const tier = {};
  const resolving = new Set();

  function resolve(id) {
    if (tier[id] != null) return tier[id];
    if (resolving.has(id)) return 0;        // 理论上不该有环；有环时兜底为 0
    resolving.add(id);
    const t = byId[id];
    const parents = (t.prereq || []).filter((p) => byId[p]);
    const d = parents.length === 0 ? 0 : 1 + Math.max(...parents.map(resolve));
    resolving.delete(id);
    tier[id] = d;
    return d;
  }

  for (const t of raw) resolve(t.id);
  return tier;
}

const TIER = computeTiers(RAW_TECHS);

export const TECHS = RAW_TECHS.map((t) => ({ ...t, tier: TIER[t.id] }));

export const TECH_BY_ID = Object.fromEntries(TECHS.map((t) => [t.id, t]));

// 前置全部研究完成才可研究
// v0.2.6：research 门禁支持「建筑前置」—— 部分设施类科技要求先建成某建筑（reqBuilding）。
//   builtBuildings 为「已建成建筑 id 集合」（inst.buildings 中座数 > 0 的 id）；缺省时只判科技前置。
export function canResearch(techId, researched, builtBuildings) {
  const t = TECH_BY_ID[techId];
  if (!t) return false;
  const done = researched instanceof Set ? researched : new Set(researched || []);
  if (done.has(techId)) return false;
  if (!(t.prereq || []).every((p) => done.has(p))) return false;
  if (t.reqBuilding) {
    const built = builtBuildings instanceof Set ? builtBuildings
      : new Set(builtBuildings || []);
    if (!built.has(t.reqBuilding)) return false;
  }
  return true;
}

// 该科技是否已具备研究条件（只差研究点）。返回未满足的科技前置 id；
// 建筑前置单独由 missingBuilding() 给出，避免与科技 id 混用。
export function missingPrereqs(techId, researched) {
  const t = TECH_BY_ID[techId];
  if (!t) return [];
  const done = researched instanceof Set ? researched : new Set(researched || []);
  return (t.prereq || []).filter((p) => !done.has(p));
}

// v0.2.6：返回该科技要求的「未建成建筑 id」列表（已建成则为空）。
export function missingBuilding(techId, builtBuildings) {
  const t = TECH_BY_ID[techId];
  if (!t || !t.reqBuilding) return [];
  const built = builtBuildings instanceof Set ? builtBuildings
    : new Set(builtBuildings || []);
  return built.has(t.reqBuilding) ? [] : [t.reqBuilding];
}

// 按层级分组，便于 UI 逐层渲染
export function techsByTier() {
  const out = [];
  for (const t of TECHS) {
    (out[t.tier] ||= []).push(t);
  }
  return out;
}

export const BRANCHES = {
  life: '采集与生存',
  smelt: '冶炼',
  mine: '矿井',
  power: '电力',
  chem: '精细化工',
  industry: '施工与航天',
  ship: '舰船',
  military: '军事',
};

// ============================================================================
// 科研面板的三大方向（v0.0.4）
// ============================================================================
// 设计者要求：科研大方向分成「科技 / 升级 / 设施」三块，
// 其中「船上设施」从科技树里移出来、归到「设施」这个子分类。
//   科技 = 本文件的 TECHS（含船坞支线，是解锁一切的树）
//   升级 = upgrades.js 的 UPGRADES（永久效率提升）
//   设施 = ship_parts.js 的 FACILITIES / ARMOR（舰船部件目录，按类型浏览）
export const RESEARCH_SECTIONS = [
  { id: 'tech', nameCn: '科技', desc: '解锁建筑、资源与舰船装备的科技树' },
  { id: 'upgrade', nameCn: '升级', desc: '永久提升效率与产出的可重复升级' },
  { id: 'facility', nameCn: '设施', desc: '船上设施目录：乘员仓、仓库、机库、装甲等（v0.0.61 起造出船坞即可使用，不再需要单独研究）' },
];

// ============================================================================
// 舰船科技（v0.0.61 已全部移除）
// ============================================================================
// 设计者原话：「科研里面舰船 mki-iii 去掉，无实际意义；科研里面的 abcd 也去掉，
//   一些基础船上设施的研究前置为船坞」。
// 于是本文件里不再有任何 branch: 'ship' 的节点（舰船支线已删除）。
//   注意：v0.0.7 重新引入了 12 个 section: 'facility' 的科技节点（电力设施解锁，见上文），
//   它们由 facilityTechs() 取回、在科研面板「设施」分区渲染，且不进入主科技树。
// 下面两个函数**保留导出但恒返回空数组**——它们的调用方（科研面板、旧探针）
// 只需要改成不渲染即可，不必再判断函数是否存在。
//
// 舰船部件现在由「造出船坞」直接解锁，见 js/data/ship_parts.js#isPartUnlocked。
export function shipTechs() {
  return TECHS.filter((t) => t.branch === 'ship');
}

// 曾用于「设施」分区里的「舰船研发」区块（R4）。v0.0.61 起该区块已取消。
export function facilityTechs() {
  return TECHS.filter((t) => t.section === 'facility');
}

// 玩家当前可用的最高舰船 MK 等级。
// v0.0.61：MK 分级取消（部件只有 MKI），所以恒为 1——只要船坞科技已研究。
export function unlockedMark(researched) {
  const done = researched instanceof Set ? researched : new Set(researched || []);
  return done.has('t_e3') ? 1 : 0;
}

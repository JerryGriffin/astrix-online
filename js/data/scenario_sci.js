// ============================================================================
// data/scenario_sci.js —— 科幻向剧本数据（v0.4.9 新增）
//
// ============================================================================
// 为什么需要这个文件
//   「风暴前夜」（data/hoi1936.js）是**历史向**剧本：12 个真实国家、真实首都、
//   真实阵营（轴心/同盟国/共产国际）、真实历史节点（巴巴罗萨 / 黄色方案 / 但泽）。
//   那些内容在普通开局（初登星球 / 漫溯深空）里既不成立、也不该出现 ——
//   一个深空殖民者不该在「鲁尔扩产」或者「巴巴罗萨」里选国策。
//
//   但 1936 背后的**机制**是好的、也是通用的：
//     · 国策树（分支 / 按序解锁 / 互斥 / 效果）
//     · 阵营与结盟
//     · 轨道圈层控制权争夺（制海权的太空版）
//     · 战争正当化（60 天）
//     · 多回合战役结算（HOI4 式）
//     · 战区地图 + 补给网络 + 夹击
//   本文件提供**同构但完全原创**的数据，让普通开局复用同一套机制。
//
// 设计约束（与 data/factions.js 的通用势力表不同）
//   factions.js 只是「地图上占几块地」的轻量势力，用于快速铺版图；
//   本文件是**完整剧本**：人口/工业/师数/舰队/产线/装备/国策/阵营齐全，
//   与 HOI_DEEP 同构，因此能直接被 core/hoi1936.js 的 fociOf/ensureSeas 等机制消费。
//
// id 命名：一律 `sci_` 前缀，与 1936 的国家 id（'ger'/'fra'…）完全隔离，
//   两套剧本的数据不可能混用或撞车。
// ============================================================================

export const SCI_SCENARIO_ID = 'scifi';
export const SCI_SCENARIO_NAME = '深空纪元';

// ---------------------------------------------------------------------------
// 一、势力总表（8 个，覆盖太阳系内外的主要殖民势力）
//   字段与 HOI_NATIONS 同构，便于核心逻辑按同一套口径消费。
// ---------------------------------------------------------------------------
export const SCI_NATIONS = [
  {
    id: 'sci_terran', nameCn: '地球联邦', nameEn: 'Terran Compact', capital: '地球同步轨道港', flag: '🔵',
    // 起步强势：玩家可选的"母体势力"，工业与人口都高
    popM: 320, ic: 145, divisions: 46, navy: 34, airforce: 30,
    bloc: 'core',
    desc: '人类的母星势力：轨道城带串珠成线，重工业与人口都是银河系第一。',
  },
  {
    id: 'sci_martian', nameCn: '火星矿业公社', nameEn: 'Martian Communes', capital: '奥林帕斯穹顶', flag: '🔴',
    popM: 86, ic: 118, divisions: 34, navy: 22, airforce: 26,
    bloc: 'inner',
    desc: '以地下矿脉立国的公社联盟，钢与稀土产量惊人，军事偏机动。',
  },
  {
    id: 'sci_outer', nameCn: '外环拓殖联合', nameEn: 'Outer Belt Compact', capital: '谷神星门户', flag: '🟠',
    popM: 140, ic: 92, divisions: 38, navy: 26, airforce: 22,
    bloc: 'belt',
    desc: '小行星带拓殖者的联合体，船坞遍布环带，靠商路而非矿脉立国。',
  },
  {
    id: 'sci_lunar', nameCn: '月面采矿同盟', nameEn: 'Lunar Consortium', capital: '静海基地', flag: '⚪',
    popM: 64, ic: 74, divisions: 22, navy: 14, airforce: 18,
    bloc: 'inner',
    desc: '垄断氦-3 与低重力冶炼的月面同盟，人口不多但技术极精。',
  },
  {
    id: 'sci_ceres', nameCn: '谷神星开发署', nameEn: 'Ceres Authority', capital: '阿里巴 ring 站', flag: '🟡',
    popM: 52, ic: 88, divisions: 26, navy: 20, airforce: 16,
    bloc: 'belt',
    desc: '企业化运作的谷神星开发机构，自动化程度最高，劳动力奇缺。',
  },
  {
    id: 'sci_europa', nameCn: '木卫二冰洋城邦', nameEn: 'Europa Ice Cities', capital: '哈德斯撞击坑', flag: '🟣',
    popM: 74, ic: 66, divisions: 20, navy: 18, airforce: 20,
    bloc: 'outer',
    desc: '藏在冰层之下的城邦群，科研领先但补给线脆弱。',
  },
  {
    id: 'sci_titan', nameCn: '土卫六浮空舰队', nameEn: 'Titan Aerostat Armada', capital: '极地上层城', flag: '🟡',
    popM: 42, ic: 54, divisions: 18, navy: 22, airforce: 14,
    bloc: 'outer',
    desc: '以浮空巨舰为家园的民族，机动性冠绝群雄，疆域却最不固定。',
  },
  {
    id: 'sci_belt', nameCn: '游离者同盟', nameEn: 'Freehaul Alliance', capital: '移动锻炉「长明」', flag: '⬛',
    popM: 28, ic: 46, divisions: 30, navy: 12, airforce: 10,
    bloc: 'none',
    desc: '拒绝归属任何星系的走私者与雇佣兵，靠劫掠矿脉与出卖情报为生。',
  },
];

export const SCI_BY_ID = {};
for (const n of SCI_NATIONS) SCI_BY_ID[n.id] = n;
export const SCI_MAIN_NATIONS = SCI_NATIONS;
export const SCI_MAIN_BY_ID = SCI_BY_ID;

// v0.4.9：把自己注册到 data/factions.js 的解析表里。
//   factions.js 是 UI 侧「owner id → 势力名/旗/描述/实力」的统一入口，
//   但它不能静态 import 本文件（会与 state.js / hoi1936.js 形成加载顺序依赖），
//   所以用「注册 + 全局缓存」的方式打通 —— 效果等价，且不引入循环依赖。
import { registerSciFactions } from './factions.js?v=53.4';
registerSciFactions(SCI_NATIONS);

// ---------------------------------------------------------------------------
// 二、阵营（对标 BLOC_NAME，但全是原创）
// ---------------------------------------------------------------------------
export const SCI_BLOC_NAME = {
  core: '地球核心圈',
  inner: '内太阳系同盟',
  belt: '带际商联',
  outer: '外缘自治领',
  none: '无所属',
};

// ---------------------------------------------------------------------------
// 三、轨道圈层（对标 HOI_SEAS —— 已是太空设定，直接沿用同一套 id 与区域划分）
//   注意：HOI_SEAS 的 7 个圈层在 v0.4.x 已经完成太空化（近地轨道 / 晨昏线 /
//   同步轨道 / 拉格朗日 / 深空门户 / 极地轨道 / 气层防线），不含任何地球地名，
//   因此这里**直接复用**，不重复造一套。
// ---------------------------------------------------------------------------
export { HOI_SEAS as SCI_SEAS } from './hoi1936.js?v=53.4';

// 各势力开局已控制的圈层（替代 1936 的「英国控制英吉利海峡 85%」这类设定）
export const SCI_SEA_INITIAL_CONTROL = {
  sci_terran: { sync: 0.82, near: 0.74, polar: 0.55 },
  sci_martian: { near: 0.48, l4: 0.30 },
  sci_outer: { l4: 0.52, belt: 0.44, deep: 0.36 },
  sci_lunar: { polar: 0.42 },
  sci_ceres: { belt: 0.56 },
  sci_europa: { deep: 0.34 },
  sci_titan: { outer: 0.40 },
  sci_belt: {},
};

// 各势力的海域竞争区（决定 AI 在哪一圈层与谁争夺）
// 语义与 1936 的 NATION_SEA_REGION 不同：1936 是「势力 → 地球海区列表」，
// 这里直接给「圈层 → 竞争势力 id」，更直观（seaRivals() 优先读 SCI_SEA_RIVAL）。
export const SCI_SEA_RIVAL = {
  sync: ['sci_terran', 'sci_ceres'],
  near: ['sci_terran', 'sci_martian'],
  polar: ['sci_terran', 'sci_lunar'],
  l4: ['sci_outer', 'sci_martian'],
  belt: ['sci_ceres', 'sci_outer'],
  deep: ['sci_outer', 'sci_europa'],
  outer: ['sci_titan', 'sci_europa'],
};

/**
 * 圈层的区域归属（对标 NATION_SEA_REGION）。
 *
 * ⚠️ 键必须与圈层表里的 `region` 字段**完全一致**，否则 seaRivals() / canSailIn()
 *   会把所有势力都过滤掉（AI 巡航压力恒为 0、且本国进不去任何圈层）。
 *   复用 HOI_SEAS 时这些 region 键仍是 'europe' / 'atlantic' / 'asia'（历史遗留的
 *   **内部标识**，UI 上显示的圈层名早已太空化，玩家看不到这些键）。
 *   这里按语义把它们映射到三段式势力范围：
 *     europe  = 近地/晨昏线/同步/L4  → 内圈 + 带际
 *     atlantic= 深空门户            → 带际 + 外缘
 *     asia    = 极地轨道/气层防线    → 内圈 + 外缘
 */
export const SCI_SEA_REGIONS = {
  sci_terran: ['europe', 'atlantic', 'asia'],
  sci_martian: ['europe', 'asia'],
  sci_lunar: ['europe', 'asia'],
  sci_ceres: ['europe', 'atlantic'],
  sci_outer: ['europe', 'atlantic', 'asia'],
  sci_europa: ['atlantic', 'asia'],
  sci_titan: ['atlantic', 'asia'],
  sci_belt: ['atlantic', 'asia'],
};

// ---------------------------------------------------------------------------
// 四、势力深度数据（对标 HOI_DEEP —— 同构，核心逻辑可直接消费）
// ---------------------------------------------------------------------------
export const SCI_DEEP = {
  sci_terran: {
    armyName: '轨道投送军', atkMul: 1.18, defMul: 1.12, bloc: 'core',
    fleets: [{ nameCn: '地球卫戍舰队', share: 1 }],
    lines: [
      { buildingId: 'refinery', recipeId: 'r_refine_steel', workers: 14 },
      { buildingId: 'blast_furnace', recipeId: 'r_bf_iron', workers: 10 },
      { buildingId: 'chem_lab', recipeId: 'r_chem_aluminum_alloy', workers: 8 },
      { buildingId: 'chem_lab', recipeId: 'r_chem_plastic', workers: 6 },
      { buildingId: 'furnace', recipeId: 'r_furnace_ceramic', workers: 4 },
    ],
    gear: [
      { partId: 'ap_armor_composite', material: '钢', qty: 80 },
      { partId: 'ap_wpn_hmg', material: '钢', qty: 60 },
    ],
    foci: [
      { id: 'sci_ti1', branch: '工业', nameCn: '轨道城带扩建', days: 120, desc: '串珠城带扩容：科研 +40%，钢产线提速。', effect: { research: 20000, lineMul: 1.15 } },
      { id: 'sci_ti2', branch: '工业', nameCn: '月地航运升级', days: 150, desc: '地月航线贯通：大量钢铝入库。', effect: { goods: { 钢: 9000, 铝: 3500 } } },
      { id: 'sci_tm1', branch: '军事', nameCn: '轨道火力学说', days: 180, desc: '轨道压制优先：全军攻击 +25%。', effect: { armyAtkMul: 1.25 } },
      { id: 'sci_tm2', branch: '军事', nameCn: '深空远征编制', days: 150, desc: '远征军编成：防御 +10% 并补充装备。', effect: { armyDefMul: 1.1, gear: [{ partId: 'ap_wpn_rifle', material: '钢', qty: 200 }] } },
      { id: 'sci_td1', branch: '外交', nameCn: '内系协约', days: 90, desc: '与火星公社签订协约（同阵营自动盟友）。', effect: { allyBloc: 'inner' } },
      { id: 'sci_td2', branch: '外交', nameCn: '带际贸易协定', days: 140, desc: '打通带际商路：科研与人口增长。', effect: { pop: 3000, research: 8000 } },
    ],
  },
  sci_martian: {
    armyName: '赤铁矿装甲师', atkMul: 1.30, defMul: 0.98, bloc: 'inner',
    fleets: [{ nameCn: '火星轨道舰队', share: 1 }],
    lines: [
      { buildingId: 'refinery', recipeId: 'r_refine_steel', workers: 12 },
      { buildingId: 'blast_furnace', recipeId: 'r_bf_iron', workers: 10 },
      { buildingId: 'chem_lab', recipeId: 'r_chem_aluminum_alloy', workers: 6 },
    ],
    gear: [{ partId: 'ap_armor_light', material: '钢', qty: 50 }, { partId: 'ap_mob_wheel', material: '钢', qty: 40 }],
    foci: [
      { id: 'sci_mi1', branch: '工业', nameCn: '地下熔炉带', days: 120, desc: '地热熔炉带投产：钢与铝大量入库。', effect: { goods: { 钢: 5000, 铝: 4000 } } },
      { id: 'sci_mm1', branch: '军事', nameCn: '尘暴突击战术', days: 160, desc: '借尘暴突袭：全军攻防 +18%。', effect: { armyAtkMul: 1.18, armyDefMul: 1.08 } },
      { id: 'sci_md1', branch: '外交', nameCn: '公社联合', days: 90, desc: '联合其他公社势力。', effect: { allyBloc: 'inner' } },
    ],
  },
  sci_outer: {
    armyName: '拓殖船团卫队', atkMul: 1.05, defMul: 1.05, bloc: 'belt',
    fleets: [{ nameCn: '商路护航舰队', share: 1 }],
    lines: [
      { buildingId: 'refinery', recipeId: 'r_refine_steel', workers: 10 },
      { buildingId: 'furnace', recipeId: 'r_furnace_ceramic', workers: 6 },
      { buildingId: 'chem_lab', recipeId: 'r_chem_plastic', workers: 5 },
    ],
    gear: [{ partId: 'ap_mob_wheel', material: '铝', qty: 45 }, { partId: 'ap_wpn_rifle', material: '铁', qty: 80 }],
    foci: [
      { id: 'sci_oi1', branch: '工业', nameCn: '船坞群扩建', days: 130, desc: '环带船坞扩张：舰船与资源入库。', effect: { goods: { 铝: 4000 }, navy: 5 } },
      { id: 'sci_om1', branch: '军事', nameCn: '护航战术', days: 150, desc: '护航阵型：防御与耐久提升。', effect: { armyDefMul: 1.15 } },
      { id: 'sci_od1', branch: '外交', nameCn: '商联缔约', days: 90, desc: '加入带际商联。', effect: { allyBloc: 'belt' } },
    ],
  },
  sci_lunar: {
    armyName: '月面防卫队', atkMul: 0.98, defMul: 1.22, bloc: 'inner',
    fleets: [{ nameCn: '月面警戒舰队', share: 1 }],
    lines: [
      { buildingId: 'chem_lab', recipeId: 'r_chem_aluminum_alloy', workers: 10 },
      { buildingId: 'refinery', recipeId: 'r_refine_steel', workers: 8 },
    ],
    gear: [{ partId: 'ap_armor_composite', material: '铝', qty: 35 }, { partId: 'ap_wpn_laser', material: '钢', qty: 20 }],
    foci: [
      { id: 'sci_li1', branch: '工业', nameCn: '低重力冶炼', days: 120, desc: '低重力工艺：铝与合金大量入库。', effect: { goods: { 铝: 6000 }, research: 9000 } },
      { id: 'sci_lm1', branch: '军事', nameCn: '激光武器部署', days: 170, desc: '制高点火力：全军攻击 +20%。', effect: { armyAtkMul: 1.2 } },
      { id: 'sci_ld1', branch: '外交', nameCn: '静海协定', days: 90, desc: '与地球联邦签署协定。', effect: { allyBloc: 'core' } },
    ],
  },
  sci_ceres: {
    armyName: '自动化战斗群', atkMul: 1.12, defMul: 0.92, bloc: 'belt',
    fleets: [{ nameCn: '开发署作业舰队', share: 1 }],
    lines: [
      { buildingId: 'furnace', recipeId: 'r_furnace_carbon', workers: 12 },
      { buildingId: 'refinery', recipeId: 'r_refine_steel', workers: 10 },
      { buildingId: 'chem_lab', recipeId: 'r_chem_plastic', workers: 5 },
    ],
    gear: [{ partId: 'ap_wpn_laser', material: '钢', qty: 24 }, { partId: 'ap_armor_light', material: '钢', qty: 40 }],
    foci: [
      { id: 'sci_ci1', branch: '工业', nameCn: '自动化产线', days: 140, desc: '全线自动化：产线提速 +30%。', effect: { lineMul: 1.3, research: 10000 } },
      { id: 'sci_cm1', branch: '军事', nameCn: '无人作战群', days: 160, desc: '无人蜂群战术：攻击 +22%。', effect: { armyAtkMul: 1.22 } },
      { id: 'sci_cd1', branch: '外交', nameCn: '带际商联入股', days: 90, desc: '加入带际商联。', effect: { allyBloc: 'belt' } },
    ],
  },
  sci_europa: {
    armyName: '冰下机动队', atkMul: 1.10, defMul: 1.08, bloc: 'outer',
    fleets: [{ nameCn: '冰洋巡逻舰队', share: 1 }],
    lines: [
      { buildingId: 'chem_lab', recipeId: 'r_chem_aluminum_alloy', workers: 8 },
      { buildingId: 'blast_furnace', recipeId: 'r_bf_iron', workers: 6 },
    ],
    gear: [{ partId: 'ap_frame_light', material: '钢', qty: 60 }, { partId: 'ap_wpn_rifle', material: '钢', qty: 50 }],
    foci: [
      { id: 'sci_ei1', branch: '工业', nameCn: '冰层热能站', days: 130, desc: '地热与化工并进：科研 +12000。', effect: { research: 12000, goods: { 钢: 3000 } } },
      { id: 'sci_em1', branch: '军事', nameCn: '冰原伏击', days: 150, desc: '冰原机动：全军攻防小幅提升。', effect: { armyAtkMul: 1.1, armyDefMul: 1.05 } },
      { id: 'sci_ed1', branch: '外交', nameCn: '外缘互助', days: 90, desc: '与外缘自治领结盟。', effect: { allyBloc: 'outer' } },
    ],
  },
  sci_titan: {
    armyName: '浮空舰战斗队', atkMul: 1.25, defMul: 0.90, bloc: 'outer',
    fleets: [{ nameCn: '浮空巨舰群', share: 1 }],
    lines: [
      { buildingId: 'chem_lab', recipeId: 'r_chem_plastic', workers: 9 },
      { buildingId: 'furnace', recipeId: 'r_furnace_carbon', workers: 8 },
    ],
    gear: [{ partId: 'ap_mob_wheel', material: '铝', qty: 40 }, { partId: 'ap_wpn_hmg', material: '铝', qty: 30 }],
    foci: [
      { id: 'sci_ti1', branch: '工业', nameCn: '浮空船坞', days: 130, desc: '浮空船坞扩建：舰船与铝入库。', effect: { goods: { 铝: 3000 }, navy: 6 } },
      { id: 'sci_tm1', branch: '军事', nameCn: '机动突袭', days: 160, desc: '巨舰突袭：全军攻击 +24%。', effect: { armyAtkMul: 1.24 } },
      { id: 'sci_td1', branch: '外交', nameCn: '外缘互助', days: 90, desc: '与外缘自治领结盟。', effect: { allyBloc: 'outer' } },
    ],
  },
  sci_belt: {
    armyName: '雇佣打手团', atkMul: 1.15, defMul: 0.88, bloc: 'none',
    fleets: [{ nameCn: '走私快艇队', share: 1 }],
    lines: [
      { buildingId: 'furnace', recipeId: 'r_furnace_carbon', workers: 7 },
      { buildingId: 'refinery', recipeId: 'r_refine_steel', workers: 6 },
    ],
    gear: [{ partId: 'ap_wpn_rifle', material: '铁', qty: 70 }, { partId: 'ap_frame_light', material: '铁', qty: 50 }],
    foci: [
      { id: 'sci_bi1', branch: '工业', nameCn: '掠夺式采集', days: 110, desc: '高效采集：碳与铁大量入库。', effect: { goods: { 碳: 5000, 铁: 4000 } } },
      { id: 'sci_bm1', branch: '军事', nameCn: '打了再说', days: 140, desc: '雇佣兵战术：攻击 +20%、防御下降。', effect: { armyAtkMul: 1.2, armyDefMul: 0.94 } },
      { id: 'sci_bd1', branch: '外交', nameCn: '逐利投靠', days: 80, desc: '向最强者效忠：获得科研与人口。', effect: { research: 12000, pop: 1200 } },
    ],
  },
};

// ---------------------------------------------------------------------------
// 五、开局旁白（对标 HOI_BG）
// ---------------------------------------------------------------------------
export const SCI_BG = {
  sci_terran: '地球同步轨道上，串珠般的城带灯火通明。母星的山河已经难以供养八十亿人口，'
    + '轨道城的电梯井向下延伸了一百公里。联邦议会正在争论：把工业留在近地，还是交给更近的火星。',
  sci_martian: '赤铁的尘埃落了三千年，地热熔炉带昼夜不熄。公社的工程师说，这颗行星的地壳里'
    + '还埋着半个地球带的铁矿——只要挖得够深，红色就是我们的。',
  sci_outer: '谷神星的开发史就是一部拓殖史。每一块拉格朗点上的钢架都挂着旗，'
    + '旗上写的不是国家，而是"我先到的"。',
  sci_lunar: '静海的阴影里，太阳永远只照一半。低重力冶炼炉在月夜里发着蓝光，'
    + '氦-3 的管道从静海一路铺到地球轨道港。',
  sci_ceres: '谷神星开发署从不承认自己是一个国家，只承认自己是一份资产负债表。'
    + '自动化的作业群在无人区连轴转了三十年，账面上，它比所有带际公司加起来都富。',
  sci_europa: '木卫二的冰层之下没有海，只有一片被压碎的地壳。城邦的居民说，'
    + '他们住在永远的冬天里——而冬天是他们的城墙。',
  sci_titan: '土卫六的对流层下飘着橙色的云海。浮空巨舰是他们的家、船和城邦，'
    + '大气里的甲烷既是燃料，也是他们唯一的水。',
  sci_belt: '「长明号」是一艘会移动的锻炉，能在三年里炼出一整条小行星带的铁。'
    + '游离者不承认任何星球的国旗 —— 他们的旗画在一块自己焊的装甲板上。',
};

// ---------------------------------------------------------------------------
// 六、历史节点（对标 HIST_TIMELINE）
//   科幻剧本不按「史实年份」推进，而是按**开局后的第 N 天**触发一连串
//   局势转折（第一次接触 / 圈层封锁 / 商路战争 / 大停电…），让战争节奏有推进感。
//   kind: 'war' 才会出现在「正当化宣战」的目标列表里。
// ---------------------------------------------------------------------------
export const SCI_TIMELINE = [
  { day: 30, kind: 'war', nameCn: '带际商路争夺战', desc: '两条矿脉航线同时被宣布封锁，开火不可避免。' },
  { day: 60, kind: 'war', nameCn: '拉格朗点封锁', desc: '自由港宣布关闭通道，护航队与执法队交火。' },
  { day: 95, kind: 'info', nameCn: '第一次接触', desc: '深空门户收到一组来源不明的信号。' },
  { day: 130, kind: 'war', nameCn: '月面资源仲裁', desc: '静海与地球联邦同时对同一处氦-3 矿脉提出主权主张。' },
  { day: 170, kind: 'war', nameCn: '气层防线冲突', desc: '外缘城邦拒绝为过境舰队开放航道。' },
  { day: 210, kind: 'info', nameCn: '大停电', desc: '太阳风暴导致内太阳系电网瘫痪，三日。' },
  { day: 260, kind: 'war', nameCn: '深空门户争夺', desc: '通往外圈的唯一定制点被武装占领。' },
  { day: 310, kind: 'info', nameCn: '跃迁协议', desc: '一项让舰船跨越恒星的技术被公开。' },
  { day: 370, kind: 'war', nameCn: '谷神星独立战争', desc: '开发署宣布脱离带际商联，武装冲突爆发。' },
  { day: 430, kind: 'war', nameCn: '冰洋封锁', desc: '木卫二冰层下的能源管线被切断。' },
  { day: 500, kind: 'info', nameCn: '联邦重组', desc: '地球联邦完成一次改组，势力版图重画。' },
  { day: 580, kind: 'war', nameCn: '全域圈层战', desc: '七个圈层同时燃起战火 —— 大战爆发。' },
];

// ---------------------------------------------------------------------------
// 七、常用口径（与 1936 同名常量对齐，核心逻辑按同名字段读）
// ---------------------------------------------------------------------------
/** 人口换算：地球联邦 = 80000（设计者此前给定的基准口径，普通剧本沿用以保持数值手感一致） */
export const SCI_POP_BASE = 80000;
export const SCI_POP_SCALE = SCI_POP_BASE / 320;   // 320 百万 → 80000 人
export function sciPopOf(nation) {
  if (!nation) return 0;
  return Math.round((Number(nation.popM) || 0) * SCI_POP_SCALE);
}

/** 生产线工人总数 = 工业 × 该系数（与 1936 同口径） */
export const SCI_WORKFORCE_PER_IC = 560;
export function sciWorkforceOf(nation) {
  return Math.round((Number(nation && nation.ic) || 0) * SCI_WORKFORCE_PER_IC);
}

/** 每师基础战力 */
export const SCI_POWER_PER_DIV = 52;

/** 海军传统（对标 NAVY_MUL） */
export const SCI_NAVY_MUL = {
  sci_terran: 1.22, sci_martian: 1.05, sci_outer: 1.14, sci_lunar: 1.0,
  sci_ceres: 1.08, sci_europa: 0.96, sci_titan: 1.18, sci_belt: 0.90,
};

/** 王牌师（对标 ELITE_DIVISIONS / ELITE_MUL） */
export const SCI_ELITE_DIVISIONS = {
  sci_terran: '地球联邦第一机动师',
  sci_martian: '赤铁近卫师',
  sci_outer: '环带第一护卫队',
  sci_lunar: '静海守备总队',
  sci_ceres: '自动化第一群',
  sci_europa: '冰下突击队',
  sci_titan: '浮空第一舰队',
  sci_belt: '长明号护航团',
};
export const SCI_ELITE_MUL = 3.2;

/** 军队蓝图名（对标 ARMY_BP_NAME） */
export const SCI_ARMY_BP_NAME = {
  ab_ranger: '侦察突击队',
  ab_ironwall: '重装防御队',
  ab_thunder: '机动炮击队',
};

/** 舰船蓝图名（对标 SHIP_NAMES） */
export const SCI_SHIP_NAMES = {
  sci_terran: '近地级战列舰', sci_martian: '火星级巡洋舰', sci_outer: '带际级护卫舰',
  sci_lunar: '月面级驱逐舰', sci_ceres: '作业级潜艇', sci_europa: '冰洋级破冰舰',
  sci_titan: '浮空级装甲舰', sci_belt: '走私级快艇',
};

/** 舰级（对标 SHIP_CLASSES，全部太空化） */
export const SCI_SHIP_CLASSES = {
  sci_terran: ['近地级战列舰', '同步轨道级航母', '护卫级巡洋舰', '哨戒级驱逐舰', '深潜级潜艇'],
  sci_martian: ['火星级战列舰', '赤铁级巡洋舰', '沙尘级驱逐舰', '隐匿级潜艇'],
  sci_outer: ['带际级巡洋舰', '商路级驱逐舰', '护航级潜艇'],
  sci_lunar: ['月面级驱逐舰', '静海级巡洋舰', '雷明级潜艇'],
  sci_ceres: ['作业级巡洋舰', '开发级护卫舰', '深探级潜艇'],
  sci_europa: ['冰洋级破冰巡洋舰', '冰下级驱逐舰', '极寒级潜艇'],
  sci_titan: ['浮空级装甲巡洋舰', '云海级驱逐舰', '甲烷级潜艇'],
  sci_belt: ['走私级快艇', '雇佣级护卫舰'],
};

/** 战后处置（对标 POST_WAR_OPTIONS，去二战化） */
export const SCI_POST_WAR_OPTIONS = [
  { key: 'annex', nameCn: '并入版图' },
  { key: 'colony', nameCn: '设立自治领' },
  { key: 'satellite', nameCn: '签订从属约' },
  { key: 'alliance', nameCn: '缔结同盟' },
];

/** 兵种编制线（对标 ARMY_BP_LINE） */
export const SCI_ARMY_BP_LINE = {
  sci_terran: ['ab_ranger', 'ab_ironwall', 'ab_thunder'],
  sci_martian: ['ab_thunder', 'ab_ironwall', 'ab_ranger'],
  sci_outer: ['ab_ranger', 'ab_ironwall', 'ab_thunder'],
  sci_lunar: ['ab_ironwall', 'ab_ranger', 'ab_thunder'],
  sci_ceres: ['ab_ranger', 'ab_thunder', 'ab_ironwall'],
  sci_europa: ['ab_ironwall', 'ab_ranger', 'ab_thunder'],
  sci_titan: ['ab_ranger', 'ab_thunder', 'ab_ironwall'],
  sci_belt: ['ab_ranger', 'ab_thunder', 'ab_ironwall'],
};

// 官方 mod · 1936 剧本（v0.2.6）—— 各国 1936 年真实数据表
//
// 数据口径（均为 1936 年历史近似值，用于游戏平衡）：
//   popM     人口（百万）
//   ic       工业产能指数（工厂总量近似，HOI 风格：民用 + 军用合计）
//   divisions 陆军师数量；navy 主力舰艇数；airforce 作战飞机（百架）
//   sell/buys 可交易物资（映射到游戏材料），[库存, 单价] / 收价
//   colony   海外属地（游戏中作为玩家的第二颗星球；无属地国家给「内陆边区」）
//
// 说明：本表仅用于游戏玩法模拟，采用公开历史统计的近似数字，不代表任何政治立场。

export const HOI_NATIONS = [
  {
    id: 'ger', nameCn: '德意志国', nameEn: 'Germany', capital: '柏林', flag: '⚫',
    popM: 69.3, ic: 60, divisions: 30, navy: 24, airforce: 25,
    sell: { '钢': [2600, 22], '塑料': [900, 40], '陶瓷': [700, 26] },
    buys: { '铁': 20, '铜': 34, '铝': 30, '橡胶': 46, '有机质': 6 },
    colony: { name: '非洲属地', typeId: '荒漠行星' },
    desc: '条约束缚下的工业巨人：产能冠绝欧洲，但资源高度依赖进口，殖民地稀少。',
  },
  {
    id: 'fra', nameCn: '法兰西', nameEn: 'France', capital: '巴黎', flag: '🔵',
    popM: 41.9, ic: 50, divisions: 32, navy: 22, airforce: 14,
    sell: { '钢': [2100, 24], '玻璃': [800, 30], '橡胶': [420, 44] },
    buys: { '钢': 26, '塑料': 38, '有机质': 7, '石英': 16 },
    colony: { name: '北非属地', typeId: '荒漠行星' },
    desc: '号称欧洲最强陆军与坚固防线，工业扎实但战略被动；依靠庞大殖民地输血。',
  },
  {
    id: 'eng', nameCn: '不列颠', nameEn: 'United Kingdom', capital: '伦敦', flag: '🔴',
    popM: 47.5, ic: 58, divisions: 16, navy: 66, airforce: 24,
    sell: { '橡胶': [900, 38], '陶瓷': [650, 28], '有机质': [1800, 9] },
    buys: { '钢': 26, '铝': 32, '石英': 18, '钛合金': 380 },
    colony: { name: '南亚属地', typeId: '丛林行星' },
    desc: '海权与金融霸主：海军天下第一，本土工业稳健；殖民地横跨全球提供原料。',
  },
  {
    id: 'sov', nameCn: '苏维埃联盟', nameEn: 'USSR', capital: '莫斯科', flag: '🟥',
    popM: 168.0, ic: 58, divisions: 92, navy: 14, airforce: 40,
    sell: { '钢': [4200, 19], '铁': [3000, 13], '陶瓷': [900, 22], '有机质': [3200, 6] },
    buys: { '铜': 32, '铝': 28, '橡胶': 48, '石墨烯': 1200 },
    colony: { name: '中亚边区', typeId: '苔原行星' },
    desc: '国土与人力第一：师数压倒一切，工业正在两个五年计划中暴涨，但技术参差。',
  },
  {
    id: 'jap', nameCn: '大日本帝国', nameEn: 'Japan', capital: '东京', flag: '⚪',
    popM: 71.9, ic: 38, divisions: 45, navy: 46, airforce: 26,
    sell: { '铝': [700, 26], '陶瓷': [800, 24], '玻璃': [600, 28] },
    buys: { '铁': 22, '钢': 28, '橡胶': 50, '有机质': 8 },
    colony: { name: '东北属地', typeId: '苔原行星' },
    desc: '海上强国、资源贫瘠：海军精锐但石油与钢铁依赖外部，殖民地是其生命线。',
  },
  {
    id: 'chn', nameCn: '中国', nameEn: 'China', capital: '南京', flag: '🟡',
    popM: 500.0, ic: 6, divisions: 120, navy: 4, airforce: 6,
    sell: { '有机质': [4200, 4], '陶瓷': [700, 18], '石头': [2500, 3] },
    buys: { '钢': 30, '铁': 24, '铝': 34, '塑料': 44 },
    colony: { name: '西南大后方', typeId: '丛林行星' },
    desc: '人口最多、纵深最阔：师数量惊人但装备与工业薄弱，靠纵深与人力周旋。',
  },
  {
    id: 'ita', nameCn: '意大利', nameEn: 'Italy', capital: '罗马', flag: '🟢',
    popM: 43.0, ic: 24, divisions: 40, navy: 26, airforce: 18,
    sell: { '陶瓷': [900, 22], '钢': [1500, 26], '塑料': [500, 44] },
    buys: { '铁': 22, '铜': 36, '橡胶': 46, '有机质': 7 },
    colony: { name: '地中海属地', typeId: '荒漠行星' },
    desc: '工业不弱但资源匮乏：自称罗马继承人，师数看着吓人、装备与士气常拖后腿。',
  },
  {
    id: 'usa', nameCn: '美利坚', nameEn: 'United States', capital: '华盛顿', flag: '🔷',
    popM: 128.0, ic: 165, divisions: 18, navy: 60, airforce: 28,
    sell: { '钢': [5200, 18], '塑料': [1800, 30], '玻璃': [1200, 22], '铝': [1400, 22] },
    buys: { '橡胶': 42, '陶瓷': 26, '石墨烯': 900, '钛合金': 340 },
    colony: { name: '太平洋属地', typeId: '丛林行星' },
    desc: '工业怪兽：产能远超任何国家，但孤立主义让军力偏小、战备迟钝——潜力可怕。',
  },
  {
    id: 'pol', nameCn: '波兰', nameEn: 'Poland', capital: '华沙', flag: '🟠',
    popM: 34.2, ic: 13, divisions: 30, navy: 4, airforce: 8,
    sell: { '钢': [1300, 25], '有机质': [1500, 6], '石头': [1200, 4] },
    buys: { '钢': 30, '铝': 34, '橡胶': 48, '塑料': 46 },
    colony: { name: '东部边区', typeId: '苔原行星' },
    desc: '夹在两大强邻之间的平原国家：师多而装备旧，地理位置决定命运多舛。',
  },
  {
    id: 'spa', nameCn: '西班牙', nameEn: 'Spain', capital: '马德里', flag: '🟣',
    popM: 24.7, ic: 10, divisions: 22, navy: 8, airforce: 6,
    sell: { '铁': [1400, 14], '陶瓷': [500, 24], '有机质': [1200, 6] },
    buys: { '钢': 32, '塑料': 44, '石英': 20 },
    colony: { name: '西非属地', typeId: '荒漠行星' },
    desc: '山峦与动荡中的国家：工业平平、军队分裂，1936 年正站在内战的悬崖边。',
  },
  {
    id: 'tur', nameCn: '土耳其', nameEn: 'Turkey', capital: '安卡拉', flag: '🟤',
    popM: 16.4, ic: 7, divisions: 20, navy: 5, airforce: 4,
    sell: { '陶瓷': [600, 22], '钢': [800, 28], '石头': [1600, 3] },
    buys: { '钢': 32, '铝': 36, '塑料': 46 },
    colony: { name: '安纳托利亚内陆', typeId: '荒漠行星' },
    desc: '扼守两洲咽喉的要塞国家：军队尚可、工业薄弱，海峡就是它的全部筹码。',
  },
  {
    id: 'bra', nameCn: '巴西', nameEn: 'Brazil', capital: '里约热内卢', flag: '🟩',
    popM: 40.3, ic: 7, divisions: 10, navy: 6, airforce: 3,
    sell: { '橡胶': [1100, 34], '有机质': [2600, 5], '铁': [900, 15] },
    buys: { '钢': 34, '塑料': 46, '玻璃': 34, '陶瓷': 28 },
    colony: { name: '亚马逊内陆', typeId: '丛林行星' },
    desc: '南美巨人：资源丰厚而工业稚嫩，远离旧大陆的烽烟，是潜在的后起之秀。',
  },
];

export const HOI_BY_ID = {};
for (const n of HOI_NATIONS) HOI_BY_ID[n.id] = n;

export const HOI_SCENARIO_ID = 'hoi1936';
export const HOI_SCENARIO_NAME = '风暴前夜';

// ============================================================================
// v0.2.6 深化：人口基准 / 编制 / 历史舰队 / 阵营 / 生产线侧重 / 国策
// ============================================================================
// 人口：德国 = 80000（设计者给定），其他国家按真实人口比例放缩
export const GER_POP_BASE = 80000;
export const POP_SCALE = GER_POP_BASE / 69.3;   // ≈ 1154.4 人/百万

export function popOf(nation) {
  const n = typeof nation === 'string' ? HOI_BY_ID[nation] : nation;
  if (!n) return 0;
  return Math.max(1000, Math.round(n.popM * POP_SCALE));
}

// 每支军队 500 人（设计者给定）
export const ARMY_MEN = 500;

// 阵营（参考 HOI4 1936 局势）：axis 柏林-罗马轴心 / allies 同盟国 / comintern 共产国际 / neutral 中立
export const BLOC_NAME = {
  axis: '柏林—罗马轴心',
  allies: '同盟国',
  comintern: '共产国际',
  neutral: '不结盟',
};

// 各国深化设定：
//   armyName  本国编制名（师/军编制，参考历史）
//   atkMul/defMul 编制侧重（攻击型 / 防御型 / 均衡）
//   blocs     所属阵营
//   fleets    历史舰队名（按海军实力分配规模）
//   lines     侧重生产线（buildingId + 配方 + 工位数）
//   gear      独特装备流水线（军用部件 + 材料）
//   foci      国策（HOI4 风格三支六策）
export const HOI_DEEP = {
  ger: {
    armyName: '装甲掷弹兵师', atkMul: 1.55, defMul: 1.15, bloc: 'axis',
    fleets: [{ nameCn: '公海舰队', share: 1 }],
    lines: [
      { buildingId: 'refinery', recipeId: 'r_refine_steel', workers: 12 },
      { buildingId: 'blast_furnace', recipeId: 'r_bf_iron', workers: 8 },
      { buildingId: 'chem_lab', recipeId: 'r_chem_aluminum_alloy', workers: 6 },
      { buildingId: 'chem_lab', recipeId: 'r_chem_plastic', workers: 6 },
      { buildingId: 'furnace', recipeId: 'r_furnace_ceramic', workers: 4 },
    ],
    gear: [{ partId: 'ap_armor_composite', material: '钢', qty: 40 }, { partId: 'ap_wpn_hmg', material: '钢', qty: 30 }],
    foci: [
      { id: 'ger_i1', branch: '工业', nameCn: '四年计划', days: 120, desc: '全面动员工业：+40% 科研点，钢产线提速。', effect: { research: 20000, lineMul: 1.15 } },
      { id: 'ger_i2', branch: '工业', nameCn: '鲁尔扩产', days: 150, desc: '鲁尔区扩建：大量钢铁与铝入库。', effect: { goods: { 钢: 8000, 铝: 3000 } } },
      { id: 'ger_m1', branch: '军事', nameCn: '闪电战理论', days: 180, desc: '装甲突击：全军攻击 +25%。', effect: { armyAtkMul: 1.25 } },
      { id: 'ger_m2', branch: '军事', nameCn: '空军扩充', days: 150, desc: '空军扩编：获得空军加成与装备。', effect: { armyDefMul: 1.1, gear: [{ partId: 'ap_wpn_rifle', material: '钢', qty: 200 }] } },
      { id: 'ger_d1', branch: '外交', nameCn: '柏林—罗马轴心', days: 90, desc: '与意大利结盟（同阵营自动盟友）。', effect: { allyBloc: 'axis' } },
      { id: 'ger_d2', branch: '外交', nameCn: '德奥合并', days: 200, desc: '和平并入奥地利：人口与工业大增。', effect: { pop: 3000, research: 8000 } },
    ],
  },
  ita: {
    armyName: '阿尔卑斯山地师', atkMul: 1.0, defMul: 1.1, bloc: 'axis',
    fleets: [{ nameCn: '皇家海军（意）', share: 1 }],
    lines: [
      { buildingId: 'refinery', recipeId: 'r_refine_steel', workers: 8 },
      { buildingId: 'furnace', recipeId: 'r_furnace_ceramic', workers: 6 },
      { buildingId: 'chem_lab', recipeId: 'r_chem_plastic', workers: 4 },
    ],
    gear: [{ partId: 'ap_armor_light', material: '钢', qty: 30 }, { partId: 'ap_mob_wheel', material: '钢', qty: 25 }],
    foci: [
      { id: 'ita_i1', branch: '工业', nameCn: '南方开发', days: 120, desc: '开发南方工业：+科研点与陶瓷。', effect: { research: 12000, goods: { 陶瓷: 2000 } } },
      { id: 'ita_i2', branch: '工业', nameCn: '菲亚特扩产', days: 150, desc: '汽车工业扩产：装备大量入库。', effect: { gear: [{ partId: 'ap_mob_wheel', material: '钢', qty: 150 }] } },
      { id: 'ita_m1', branch: '军事', nameCn: '地中海舰队', days: 150, desc: '海军扩建：舰只与海军战力提升。', effect: { navy: 6 } },
      { id: 'ita_m2', branch: '军事', nameCn: '山地战训练', days: 120, desc: '山地部队训练：全军防御 +20%。', effect: { armyDefMul: 1.2 } },
      { id: 'ita_d1', branch: '外交', nameCn: '柏林—罗马轴心', days: 90, desc: '与德国结盟（同阵营自动盟友）。', effect: { allyBloc: 'axis' } },
      { id: 'ita_d2', branch: '外交', nameCn: '入侵阿比西尼亚', days: 180, desc: '殖民扩张：属地资源与人口增加。', effect: { pop: 1500, goods: { 有机质: 4000 } } },
    ],
  },
  eng: {
    armyName: '远征军步兵师', atkMul: 1.10, defMul: 1.40, bloc: 'allies',
    fleets: [{ nameCn: '本土舰队', share: 0.6 }, { nameCn: '地中海舰队', share: 0.4 }],
    lines: [
      { buildingId: 'refinery', recipeId: 'r_refine_steel', workers: 10 },
      { buildingId: 'chem_lab', recipeId: 'r_chem_rubber', workers: 8 },
      { buildingId: 'furnace', recipeId: 'r_furnace_ceramic', workers: 5 },
      { buildingId: 'electrolyzer', recipeId: 'r_el_water', workers: 4 },
    ],
    gear: [{ partId: 'ap_frame_light', material: '钢', qty: 40 }, { partId: 'ap_sup_radar', material: '钢', qty: 20 }],
    foci: [
      { id: 'eng_i1', branch: '工业', nameCn: '帝国资源整合', days: 120, desc: '整合殖民地资源：橡胶与有机质大增。', effect: { goods: { 橡胶: 3000, 有机质: 6000 } } },
      { id: 'eng_i2', branch: '工业', nameCn: '影子工厂计划', days: 180, desc: '影子工厂：产线生产率提升。', effect: { lineMul: 1.2 } },
      { id: 'eng_m1', branch: '军事', nameCn: '海峡防空', days: 120, desc: '本土防空网：全军防御 +20%。', effect: { armyDefMul: 1.2 } },
      { id: 'eng_m2', branch: '军事', nameCn: '皇家海军扩建', days: 180, desc: '造舰计划：舰只增加。', effect: { navy: 10 } },
      { id: 'eng_d1', branch: '外交', nameCn: '英法协约', days: 90, desc: '与法国结盟（同阵营自动盟友）。', effect: { allyBloc: 'allies' } },
      { id: 'eng_d2', branch: '外交', nameCn: '绥靖的终结', days: 150, desc: '全面备战：科研点与装备。', effect: { research: 15000, gear: [{ partId: 'ap_wpn_rifle', material: '钢', qty: 200 }] } },
    ],
  },
  fra: {
    armyName: '要塞步兵师', atkMul: 1.05, defMul: 1.45, bloc: 'allies',
    fleets: [{ nameCn: '地中海舰队（法）', share: 0.6 }, { nameCn: '大西洋舰队（法）', share: 0.4 }],
    lines: [
      { buildingId: 'refinery', recipeId: 'r_refine_steel', workers: 9 },
      { buildingId: 'chem_lab', recipeId: 'r_chem_rubber', workers: 6 },
      { buildingId: 'furnace', recipeId: 'r_furnace_ceramic', workers: 5 },
    ],
    gear: [{ partId: 'ap_armor_light', material: '钢', qty: 35 }, { partId: 'ap_wpn_rifle', material: '钢', qty: 60 }],
    foci: [
      { id: 'fra_i1', branch: '工业', nameCn: '国有化军工厂', days: 120, desc: '军工国有化：产线提速。', effect: { lineMul: 1.15 } },
      { id: 'fra_i2', branch: '工业', nameCn: '殖民地经济', days: 120, desc: '北非资源开发：物资入库。', effect: { goods: { 有机质: 5000, 铁: 3000 } } },
      { id: 'fra_m1', branch: '军事', nameCn: '马奇诺防线', days: 180, desc: '要塞防线：全军防御 +30%。', effect: { armyDefMul: 1.3 } },
      { id: 'fra_m2', branch: '军事', nameCn: '装甲重整', days: 150, desc: '装甲部队整编：全军攻击 +15%。', effect: { armyAtkMul: 1.15 } },
      { id: 'fra_d1', branch: '外交', nameCn: '英法协约', days: 90, desc: '与英国结盟（同阵营自动盟友）。', effect: { allyBloc: 'allies' } },
      { id: 'fra_d2', branch: '外交', nameCn: '东欧同盟体系', days: 150, desc: '扶持东欧盟友：科研与人口。', effect: { research: 12000, pop: 1200 } },
    ],
  },
  sov: {
    armyName: '步兵军', atkMul: 0.88, defMul: 1.05, bloc: 'comintern',
    fleets: [{ nameCn: '波罗的海舰队', share: 0.6 }, { nameCn: '黑海舰队', share: 0.4 }],
    lines: [
      { buildingId: 'refinery', recipeId: 'r_refine_steel', workers: 16 },
      { buildingId: 'blast_furnace', recipeId: 'r_bf_iron', workers: 10 },
      { buildingId: 'chem_lab', recipeId: 'r_chem_plastic', workers: 6 },
      { buildingId: 'electrolyzer', recipeId: 'r_el_water', workers: 6 },
    ],
    gear: [{ partId: 'ap_wpn_rifle', material: '钢', qty: 120 }, { partId: 'ap_frame_light', material: '钢', qty: 60 }],
    foci: [
      { id: 'sov_i1', branch: '工业', nameCn: '第二个五年计划', days: 150, desc: '重工业跃进：产线生产率 +20%。', effect: { lineMul: 1.2 } },
      { id: 'sov_i2', branch: '工业', nameCn: '乌拉尔工业区', days: 180, desc: '东部工业区：钢铁储量剧增。', effect: { goods: { 钢: 12000, 铁: 8000 } } },
      { id: 'sov_m1', branch: '军事', nameCn: '大纵深作战', days: 180, desc: '纵深防御理论：攻防各 +15%。', effect: { armyAtkMul: 1.15, armyDefMul: 1.15 } },
      { id: 'sov_m2', branch: '军事', nameCn: '红军扩编', days: 150, desc: '红军扩编：人口与装备。', effect: { pop: 5000, gear: [{ partId: 'ap_frame_light', material: '钢', qty: 200 }] } },
      { id: 'sov_d1', branch: '外交', nameCn: '共产国际', days: 90, desc: '强化共产国际（同阵营自动盟友）。', effect: { allyBloc: 'comintern' } },
      { id: 'sov_d2', branch: '外交', nameCn: '集体安全', days: 150, desc: '集体安全体系：科研点与人口。', effect: { research: 18000, pop: 2000 } },
    ],
  },
  jap: {
    armyName: '海军陆战师', atkMul: 1.38, defMul: 1.02, bloc: 'neutral',
    fleets: [{ nameCn: '联合舰队', share: 1 }],
    lines: [
      { buildingId: 'blast_furnace', recipeId: 'r_bf_aluminum', workers: 10 },
      { buildingId: 'furnace', recipeId: 'r_furnace_ceramic', workers: 6 },
      { buildingId: 'chem_lab', recipeId: 'r_chem_plastic', workers: 5 },
    ],
    gear: [{ partId: 'ap_armor_light', material: '铝', qty: 30 }, { partId: 'ap_wpn_rifle', material: '钢', qty: 60 }],
    foci: [
      { id: 'jap_i1', branch: '工业', nameCn: '产业振兴', days: 120, desc: '财阀产业振兴：产线提速。', effect: { lineMul: 1.15 } },
      { id: 'jap_i2', branch: '工业', nameCn: '资源自给', days: 150, desc: '合成燃料与铝：物资入库。', effect: { goods: { 铝: 3000, 塑料: 2000 } } },
      { id: 'jap_m1', branch: '军事', nameCn: '海军航空兵', days: 180, desc: '海航精锐：全军攻击 +25%。', effect: { armyAtkMul: 1.25 } },
      { id: 'jap_m2', branch: '军事', nameCn: '联合舰队决战', days: 150, desc: '舰队决战思想：舰只增加。', effect: { navy: 8 } },
      { id: 'jap_d1', branch: '外交', nameCn: '三国同盟交涉', days: 120, desc: '与德国接近：结盟倾向（同阵营）。', effect: { research: 8000 } },
      { id: 'jap_d2', branch: '外交', nameCn: '南方资源圈', days: 180, desc: '南进政策：属地资源大增。', effect: { goods: { 橡胶: 2500, 有机质: 4000 } } },
    ],
  },
  usa: {
    armyName: '机械化步兵师', atkMul: 1.45, defMul: 1.25, bloc: 'neutral',
    fleets: [{ nameCn: '太平洋舰队', share: 0.6 }, { nameCn: '大西洋舰队', share: 0.4 }],
    lines: [
      { buildingId: 'refinery', recipeId: 'r_refine_steel', workers: 20 },
      { buildingId: 'blast_furnace', recipeId: 'r_bf_aluminum', workers: 12 },
      { buildingId: 'chem_lab', recipeId: 'r_chem_plastic', workers: 10 },
      { buildingId: 'chem_lab', recipeId: 'r_chem_rubber', workers: 6 },
    ],
    gear: [{ partId: 'ap_mob_wheel', material: '钢', qty: 80 }, { partId: 'ap_frame_light', material: '钢', qty: 60 }],
    foci: [
      { id: 'usa_i1', branch: '工业', nameCn: '新政工业', days: 120, desc: '新政拉动工业：产线生产率 +20%。', effect: { lineMul: 1.2 } },
      { id: 'usa_i2', branch: '工业', nameCn: '底特律流水线', days: 150, desc: '汽车流水线转军工：装备大增。', effect: { gear: [{ partId: 'ap_mob_wheel', material: '钢', qty: 300 }] } },
      { id: 'usa_m1', branch: '军事', nameCn: '两洋海军法案', days: 200, desc: '两洋海军：舰只大幅增加。', effect: { navy: 14 } },
      { id: 'usa_m2', branch: '军事', nameCn: '陆军整备', days: 150, desc: '陆军现代化：攻防 +12%。', effect: { armyAtkMul: 1.12, armyDefMul: 1.12 } },
      { id: 'usa_d1', branch: '外交', nameCn: '租借法案雏形', days: 150, desc: '援助同盟国：科研与人口。', effect: { research: 20000, pop: 3000 } },
      { id: 'usa_d2', branch: '外交', nameCn: '泛美体系', days: 120, desc: '泛美合作：资源与市场。', effect: { goods: { 有机质: 8000, 橡胶: 2000 } } },
    ],
  },
  chn: {
    armyName: '步兵师（国民革命军）', atkMul: 0.62, defMul: 1.05, bloc: 'neutral',
    fleets: [{ nameCn: '长江舰队', share: 1 }],
    lines: [
      { buildingId: 'blast_furnace', recipeId: 'r_bf_iron', workers: 8 },
      { buildingId: 'furnace', recipeId: 'r_furnace_ceramic', workers: 6 },
      { buildingId: 'electrolyzer', recipeId: 'r_el_water', workers: 5 },
    ],
    gear: [{ partId: 'ap_wpn_rifle', material: '铁', qty: 100 }, { partId: 'ap_frame_light', material: '铁', qty: 50 }],
    foci: [
      { id: 'chn_i1', branch: '工业', nameCn: '实业计划', days: 150, desc: '实业建国：科研点与产能。', effect: { research: 10000, lineMul: 1.1 } },
      { id: 'chn_i2', branch: '工业', nameCn: '后方工业内迁', days: 180, desc: '工业内迁：换取安全与产能。', effect: { lineMul: 1.2 } },
      { id: 'chn_m1', branch: '军事', nameCn: '持久抗战', days: 180, desc: '以空间换时间：全军防御 +30%。', effect: { armyDefMul: 1.3 } },
      { id: 'chn_m2', branch: '军事', nameCn: '整军备战', days: 150, desc: '整编部队：装备与人口。', effect: { pop: 6000, gear: [{ partId: 'ap_wpn_rifle', material: '铁', qty: 300 }] } },
      { id: 'chn_d1', branch: '外交', nameCn: '争取外援', days: 120, desc: '争取国际援助：科研与物资。', effect: { research: 8000, goods: { 钢: 2000 } } },
      { id: 'chn_d2', branch: '外交', nameCn: '民族统一战线', days: 150, desc: '统一战线：人口与工业动员。', effect: { pop: 8000, research: 6000 } },
    ],
  },
  pol: {
    armyName: '步兵师（波）', atkMul: 0.95, defMul: 1.15, bloc: 'allies',
    fleets: [{ nameCn: '波兰海军', share: 1 }],
    lines: [
      { buildingId: 'refinery', recipeId: 'r_refine_steel', workers: 6 },
      { buildingId: 'furnace', recipeId: 'r_furnace_ceramic', workers: 4 },
    ],
    gear: [{ partId: 'ap_wpn_rifle', material: '钢', qty: 50 }, { partId: 'ap_frame_light', material: '钢', qty: 30 }],
    foci: [
      { id: 'pol_i1', branch: '工业', nameCn: '中央工业区', days: 150, desc: '中央工业区建设：产能与钢。', effect: { lineMul: 1.15, goods: { 钢: 3000 } } },
      { id: 'pol_i2', branch: '工业', nameCn: '军备现代化', days: 180, desc: '军备现代化：装备入库。', effect: { gear: [{ partId: 'ap_wpn_rifle', material: '钢', qty: 150 }] } },
      { id: 'pol_m1', branch: '军事', nameCn: '西方盟约', days: 120, desc: '依托西方盟约：研究与防御。', effect: { armyDefMul: 1.15, research: 6000 } },
      { id: 'pol_m2', branch: '军事', nameCn: '骑兵与装甲', days: 150, desc: '骑兵旅与装甲营：攻击 +15%。', effect: { armyAtkMul: 1.15 } },
      { id: 'pol_d1', branch: '外交', nameCn: '英法保证', days: 90, desc: '争取英法保证（同阵营）。', effect: { allyBloc: 'allies' } },
      { id: 'pol_d2', branch: '外交', nameCn: '海间联盟', days: 150, desc: '海间同盟构想：人口与外交筹码。', effect: { pop: 1000, research: 5000 } },
    ],
  },
  spa: {
    armyName: '山地旅', atkMul: 1.0, defMul: 1.05, bloc: 'neutral',
    fleets: [{ nameCn: '西班牙舰队', share: 1 }],
    lines: [
      { buildingId: 'blast_furnace', recipeId: 'r_bf_iron', workers: 6 },
      { buildingId: 'furnace', recipeId: 'r_furnace_ceramic', workers: 4 },
    ],
    gear: [{ partId: 'ap_wpn_rifle', material: '铁', qty: 40 }, { partId: 'ap_frame_light', material: '铁', qty: 20 }],
    foci: [
      { id: 'spa_i1', branch: '工业', nameCn: '矿业振兴', days: 150, desc: '铁矿与钨砂开发：物资入库。', effect: { goods: { 铁: 4000, 碳化钨: 300 } } },
      { id: 'spa_i2', branch: '工业', nameCn: '工业重建', days: 180, desc: '战后工业重建：产线提速。', effect: { lineMul: 1.2 } },
      { id: 'spa_m1', branch: '军事', nameCn: '外籍军团', days: 150, desc: '精锐外籍军团：全军攻击 +20%。', effect: { armyAtkMul: 1.2 } },
      { id: 'spa_m2', branch: '军事', nameCn: '山地要塞', days: 150, desc: '比利牛斯防线：防御 +25%。', effect: { armyDefMul: 1.25 } },
      { id: 'spa_d1', branch: '外交', nameCn: '不干涉与平衡', days: 120, desc: '在两大阵营间平衡：科研点。', effect: { research: 8000 } },
      { id: 'spa_d2', branch: '外交', nameCn: '收复直布罗陀构想', days: 200, desc: '战略咽喉：海军扩张。', effect: { navy: 4, research: 6000 } },
    ],
  },
  tur: {
    armyName: '安纳托利亚军', atkMul: 1.0, defMul: 1.2, bloc: 'neutral',
    fleets: [{ nameCn: '土耳其舰队', share: 1 }],
    lines: [
      { buildingId: 'refinery', recipeId: 'r_refine_steel', workers: 5 },
      { buildingId: 'furnace', recipeId: 'r_furnace_ceramic', workers: 4 },
    ],
    gear: [{ partId: 'ap_wpn_rifle', material: '钢', qty: 40 }, { partId: 'ap_armor_light', material: '钢', qty: 15 }],
    foci: [
      { id: 'tur_i1', branch: '工业', nameCn: '国家工业化', days: 150, desc: '国家工业化：产线与资源。', effect: { lineMul: 1.15, goods: { 钢: 2500 } } },
      { id: 'tur_i2', branch: '工业', nameCn: '海峡经济', days: 120, desc: '海峡经济区：贸易与研究。', effect: { research: 7000 } },
      { id: 'tur_m1', branch: '军事', nameCn: '海峡要塞群', days: 180, desc: '海峡要塞：防御 +30%。', effect: { armyDefMul: 1.3 } },
      { id: 'tur_m2', branch: '军事', nameCn: '军队现代化', days: 150, desc: '军队现代化：攻击 +15%。', effect: { armyAtkMul: 1.15 } },
      { id: 'tur_d1', branch: '外交', nameCn: '多方平衡外交', days: 120, desc: '平衡外交：科研与人口。', effect: { research: 6000, pop: 800 } },
      { id: 'tur_d2', branch: '外交', nameCn: '巴尔干协约', days: 150, desc: '巴尔干协约：地区影响与资源。', effect: { goods: { 陶瓷: 1500, 有机质: 2500 } } },
    ],
  },
  bra: {
    armyName: '远征步兵师（巴）', atkMul: 0.9, defMul: 1.0, bloc: 'neutral',
    fleets: [{ nameCn: '巴西海军', share: 1 }],
    lines: [
      { buildingId: 'blast_furnace', recipeId: 'r_bf_iron', workers: 5 },
      { buildingId: 'chem_lab', recipeId: 'r_chem_rubber', workers: 4 },
      { buildingId: 'furnace', recipeId: 'r_furnace_carbon', workers: 3 },
    ],
    gear: [{ partId: 'ap_wpn_rifle', material: '铁', qty: 30 }, { partId: 'ap_frame_light', material: '铁', qty: 20 }],
    foci: [
      { id: 'bra_i1', branch: '工业', nameCn: '咖啡与铁矿经济', days: 120, desc: '资源出口：物资与科研。', effect: { goods: { 铁: 3000, 有机质: 4000 } } },
      { id: 'bra_i2', branch: '工业', nameCn: '重工业起步', days: 180, desc: '重工业起步：产线提速。', effect: { lineMul: 1.2 } },
      { id: 'bra_m1', branch: '军事', nameCn: '亚马逊防务', days: 150, desc: '内陆防务：防御 +20%。', effect: { armyDefMul: 1.2 } },
      { id: 'bra_m2', branch: '军事', nameCn: '海军重整', days: 150, desc: '海军重整：舰只增加。', effect: { navy: 4 } },
      { id: 'bra_d1', branch: '外交', nameCn: '泛美团结', days: 120, desc: '泛美团结：科研与人口。', effect: { research: 7000, pop: 1500 } },
      { id: 'bra_d2', branch: '外交', nameCn: '南美领导权', days: 180, desc: '争取南美领导权：人口与工业。', effect: { pop: 2000, research: 6000 } },
    ],
  },
};

// 海域（HOI4 风格战区海域；navyStr = 巡航需要的综合实力基准）
export const HOI_SEAS = [
  { id: 'north_sea', nameCn: '北海', base: 400, region: 'europe' },
  { id: 'baltic', nameCn: '波罗的海', base: 300, region: 'europe' },
  { id: 'channel', nameCn: '英吉利海峡', base: 600, region: 'europe' },
  { id: 'med', nameCn: '地中海', base: 500, region: 'europe' },
  { id: 'atlantic', nameCn: '大西洋', base: 900, region: 'atlantic' },
  { id: 'pacific_w', nameCn: '西太平洋', base: 800, region: 'asia' },
  { id: 'japan_sea', nameCn: '日本海', base: 350, region: 'asia' },
];
// 各国可争夺的海域区域（欧洲国家只能抢欧洲海域，亚洲国家抢亚洲+太平洋…）
export const NATION_SEA_REGION = {
  ger: ['europe'], ita: ['europe'], fra: ['europe', 'atlantic'], eng: ['europe', 'atlantic'],
  sov: ['europe'], pol: ['europe'], spa: ['europe', 'atlantic'], tur: ['europe'],
  jap: ['asia', 'pacific' ], chn: ['asia'],
  usa: ['atlantic', 'pacific'], bra: ['atlantic'],
};
// 开局 AI 制海权（HOI4 式的既有格局：英国基本控制英吉利海峡与北海）
export const SEA_INITIAL_CONTROL = {
  channel: { eng: 0.85 }, north_sea: { eng: 0.8 }, med: { ita: 0.6, eng: 0.55 },
  atlantic: { eng: 0.7 }, pacific_w: { jap: 0.75, usa: 0.6 }, japan_sea: { jap: 0.8 },
  baltic: { sov: 0.7 },
};
// 登陆作战门槛：目标海域制海权需 ≥ 0.45
export const NAVAL_INVASION_CONTROL = 0.45;

// ============================================================================
// v0.2.6 rev3：生产线规模 / 陆军师规模 / 海军传统
// ============================================================================
// 生产线工人总数 = 工业 × 415（德国 48 → 19920 ≈ 20k，设计者给定基准）
export const WORKFORCE_PER_IC = 560;   // v0.2.6 rev9：生产类人力提高（德国 60×520 = 31,200）
// 每师基础战力：师数即历史师数（德国 30 个师就是 30 支）
export const ARMY_POWER_PER_DIV = 52;
// 海军传统加成（同吨位下战力差异：英/日/美 海军强国 > 德法意 > 苏/中/南美）
export const NAVY_MUL = {
  eng: 1.30, jap: 1.30, usa: 1.25, ger: 1.15, fra: 1.10, ita: 1.05,
  sov: 0.85, pol: 0.70, tur: 0.72, spa: 0.70, bra: 0.65, chn: 0.60,
};
// 基础装备流水线（军用部件，制造车间 part_<部件id>）
export const GEAR_PARTS = ['ap_frame_light', 'ap_wpn_rifle', 'ap_armor_light', 'ap_mob_wheel'];

export function workforceOf(nation) {
  const n = typeof nation === 'string' ? HOI_BY_ID[nation] : nation;
  if (!n) return 0;
  return Math.round(n.ic * WORKFORCE_PER_IC);
}

export function navyMulOf(nation) {
  const n = typeof nation === 'string' ? HOI_BY_ID[nation] : nation;
  return (n && NAVY_MUL[n.id]) || 1;
}

// v0.2.6 rev3：史实舰船/师蓝图命名（按国家）
export const SHIP_NAMES = {
  ger: ['Z 级驱逐舰', 'K 级轻巡洋舰', 'U 型潜艇'],
  ita: ['航海家级驱逐舰', '扎拉级重巡洋舰', '马可尼级潜艇'],
  eng: ['部族级驱逐舰', '郡级重巡洋舰', '皇家方舟级航母'],
  fra: ['空想级驱逐舰', '黎塞留级战列舰', '絮库夫级潜艇'],
  sov: ['列宁格勒级驱逐舰', '基洛夫级巡洋舰', '什奇级潜艇'],
  jap: ['吹雪级驱逐舰', '妙高级重巡洋舰', '翔鹤级航母'],
  usa: ['弗莱彻级驱逐舰', '巴尔的摩级巡洋舰', '埃塞克斯级航母'],
  chn: ['宁海级轻巡洋舰', '逸仙号', '海圻号'],
  pol: ['雷霆号驱逐舰', '鹰级潜艇'],
  spa: ['加纳利级巡洋舰', '鲈鱼级潜艇'],
  tur: ['亚武兹号', '穆阿文内特级'],
  bra: ['米纳斯吉拉斯号', '巴伊亚号'],
};

export const ARMY_BP_NAME = {
  ger: '装甲师（1936 编制）', ita: '山地师（1936 编制）', eng: '步兵师（1936 编制）',
  fra: '要塞步兵师（1936 编制）', sov: '步兵军（1936 编制）', jap: '海军陆战师（1936 编制）',
  usa: '机械化步兵师（1936 编制）', chn: '国民革命军步兵师（1936 编制）',
  pol: '波兰步兵师（1936 编制）', spa: '山地旅（1936 编制）',
  tur: '安纳托利亚军（1936 编制）', bra: '远征步兵师（1936 编制）',
};

// v0.2.6 rev5：各国王牌师（史实名，开局即建制，战力显著更强）
export const ELITE_DIVISIONS = {
  ger: ['大德意志师', '第一装甲师'],
  ita: ['圣马可海军陆战团', '利托里奥装甲师'],
  eng: ['皇家卫队步兵师', '第七装甲师（沙漠之鼠）'],
  fra: ['第一摩洛哥师', '第三轻机械化师'],
  sov: ['近卫第一师', '近卫坦克第五军'],
  jap: ['近卫师团', '第五师团（广岛）'],
  usa: ['第一步兵师（大红一师）', '第一装甲师（老铁壳）'],
  chn: ['第八十八师', '第三十六师'],
  pol: ['第一军团', '波德哈莱旅'],
  spa: ['外籍军团', '第一纳瓦拉旅'],
  tur: ['第一集团军', '海峡卫戍军'],
  bra: ['第一步兵师', '远征师（抽烟斗的眼镜蛇）'],
};
export const ELITE_MUL = 1.6;      // 王牌师战力/属性倍率

// v0.2.6 rev6：1936 历史背景（开局旁白，用于国策页与开局战报 —— 增强历史代入感）
export const HOI_BG = {
  ger: '1936 年 1 月：凡尔赛体系的枷锁尚未解除，莱茵兰仍在非军事化之下。柏林以「四年计划」重整军备，'
     + '鲁尔的高炉日夜不熄；公海舰队虽小，装甲部队的学说却在图纸上飞速成形。欧洲屏息以待。',
  ita: '1936 年 1 月：罗马刚刚结束对阿比西尼亚的战事，帝国余晖映在地中海上。工业不弱却缺煤少铁，'
     + '「我们的海」的口号背后，是一场必须速胜的赌博。',
  eng: '1936 年 1 月：日不落的版图横跨全球，本土舰队仍居世界之首。伦敦在重整军备与绥靖之间摇摆，'
     + '帝国的橡胶与粮食源源而来，而欧洲大陆的风暴正在积聚。',
  fra: '1936 年 1 月：马奇诺防线的混凝土仍在浇筑，号称欧洲最强的陆军按兵不动。北非与印度支那的属地'
     + '供养着本土的工业，巴黎却在犹豫：筑墙还是造坦克？',
  sov: '1936 年 1 月：第二个五年计划进入高潮，乌拉尔与顿巴斯的钢铁产量以惊人速度攀升。'
     + '红军拥有世界上最庞大的师级序列，却也带着大清洗的伤痕 —— 大纵深，还是大溃退？',
  jap: '1936 年 1 月：东北的煤铁正被源源运回本土，联合舰队在太平洋上犁开白浪。石油与橡胶的匮乏'
     + '像一根绞索，南进或北进，皇国的命运系于一线。',
  usa: '1936 年 1 月：底特律的流水线昼夜轰鸣，工业潜力冠绝全球，陆军却不足二十万人。'
     + '孤立主义的钟声压过欧洲的战鼓 —— 但只要它醒来，世界都将为之震动。',
  chn: '1936 年 1 月：工业几乎从零起步，却坐拥全球最多的人口与最深的战略纵深。'
     + '钢铁产量不足列强的百分之一，可这片土地从未被真正征服过 —— 以空间换时间，以血肉筑长城。',
  pol: '1936 年 1 月：夹在两大强邻之间的平原国家，骑兵与步兵守着漫长的边境，'
     + '指望英法的保证能够兑现。历史的洪流即将从两侧涌来。',
  spa: '1936 年 1 月：矿井与庄园之间裂痕遍布，军队与政党都在等一个爆点。'
     + '这个山国即将成为欧洲风暴的第一声回响。',
  tur: '1936 年 1 月：凯末尔革命后的新生共和国据守着两大洲之间的咽喉，工业稚嫩但地势险要。'
     + '海峡，就是它全部的对价。',
  bra: '1936 年 1 月：亚马逊的橡胶与南部的铁矿支撑着这个年轻的南美巨人，远离旧大陆的炮火，'
     + '却注定无法置身事外。',
};

// v0.2.6 rev8：史实舰级（含航母 / 战列舰 / 重巡 / 驱逐 / 潜艇 —— 有航母战列舰的国家就有）
export const SHIP_CLASSES = {
  ger: ['俾斯麦级战列舰', '沙恩霍斯特级战列巡洋舰', '希佩尔海军上将级重巡洋舰', 'Z 级驱逐舰', 'U 型潜艇'],
  ita: ['维托里奥·维内托级战列舰', '扎拉级重巡洋舰', '朱萨诺级轻巡洋舰', '航海家级驱逐舰', '马可尼级潜艇'],
  eng: ['伊丽莎白女王级战列舰', '皇家方舟级航空母舰', '郡级重巡洋舰', '部族级驱逐舰', 'T 级潜艇'],
  fra: ['黎塞留级战列舰', '贝亚恩级航空母舰', '阿尔及利亚级重巡洋舰', '空想级驱逐舰', '絮库夫级潜艇'],
  sov: ['甘古特级战列舰', '基洛夫级巡洋舰', '列宁格勒级驱逐舰', '什奇级潜艇'],
  jap: ['长门级战列舰', '翔鹤级航空母舰', '妙高级重巡洋舰', '吹雪级驱逐舰', '伊 168 型潜艇'],
  usa: ['科罗拉多级战列舰', '埃塞克斯级航空母舰', '巴尔的摩级重巡洋舰', '弗莱彻级驱逐舰', '小鲨鱼级潜艇'],
  chn: ['宁海级轻巡洋舰', '逸仙号护卫舰', '海圻号练习舰'],
  pol: ['雷霆号驱逐舰', '鹰级潜艇'],
  spa: ['加纳利级巡洋舰', '鲈鱼级潜艇'],
  tur: ['亚武兹号战列巡洋舰', '穆阿文内特级'],
  bra: ['米纳斯吉拉斯号战列舰', '巴伊亚号巡洋舰'],
};

// v0.2.6 rev8：战后处置（击败后可选择吞并 / 成立傀儡政权 —— 史实名）
export const POST_WAR_OPTIONS = {
  pol: [{ key: 'annex', nameCn: '吞并（并入本土工业）' }, { key: 'puppet', nameCn: '成立「波兰总督领」' }],
  fra: [{ key: 'annex', nameCn: '吞并（并入本土工业）' }, { key: 'puppet', nameCn: '成立「维希法国」合作政府' }],
  eng: [{ key: 'annex', nameCn: '吞并（并入本土工业）' }, { key: 'puppet', nameCn: '成立「不列颠合作政府」' }],
  sov: [{ key: 'annex', nameCn: '吞并（并入本土工业）' }, { key: 'puppet', nameCn: '成立「东方总督辖区」' }],
  jap: [{ key: 'annex', nameCn: '吞并（并入本土工业）' }, { key: 'puppet', nameCn: '成立「大东亚共荣圈合作政府」' }],
  ita: [{ key: 'annex', nameCn: '吞并（并入本土工业）' }, { key: 'puppet', nameCn: '成立「萨罗共和国」' }],
  chn: [{ key: 'annex', nameCn: '吞并（并入本土工业）' }, { key: 'puppet', nameCn: '成立「华北自治政府」' }],
  eng2: [],
};
// 比利时—北法兰西（低地战役后的处置；德国专用）
export const GER_PUPPETS = {
  slovakia: { nameCn: '斯洛伐克领地', popM: 2.6, ic: 3, desc: '1939 年独立的斯洛伐克附庸国（本土以南）。' },
  belgium: { nameCn: '比利时-北法兰西总督区', popM: 8.3, ic: 14, desc: '低地战役后可建立的傀儡政权。' },
};

// v0.2.6 rev9：各国多兵种蓝图（步兵 / 装甲 / 机械化 —— 军队蓝图更多）
export const ARMY_BP_LINE = {
  ger: ['装甲掷弹兵师', '装甲师', '国民掷弹兵师'],
  ita: ['阿尔卑斯山地师', '装甲师', '利比亚步兵师'],
  eng: ['远征军步兵师', '装甲师', '皇家工兵师'],
  fra: ['要塞步兵师', '装甲师', '北非殖民师'],
  sov: ['步兵军', '坦克军', '近卫步兵军'],
  jap: ['海军陆战师', '战车师团', '治安师团'],
  usa: ['机械化步兵师', '装甲师', '空降师'],
  chn: ['国民革命军步兵师', '整编师', '保安师'],
  pol: ['波兰步兵师', '骑兵旅', '高地步兵旅'],
  spa: ['山地旅', '外籍军团', '纳瓦拉旅'],
  tur: ['安纳托利亚军', '装甲旅', '海峡卫戍旅'],
  bra: ['远征步兵师', '骑兵师', '海军陆战营'],
};
// 战舰吨位系数（战列舰/航母 ≫ 巡洋 ≫ 驱逐 ≫ 潜艇）—— 决定 strength 与战力
export const WARSHIP_TONNAGE = {
  battleship: 220, carrier: 190, battlecruiser: 170, heavy_cruiser: 95,
  light_cruiser: 62, destroyer: 32, submarine: 24,
};
export function warshipTonnageOf(className) {
  const n = String(className || '');
  if (n.indexOf('航空母舰') >= 0) return WARSHIP_TONNAGE.carrier;
  if (n.indexOf('战列舰') >= 0) return WARSHIP_TONNAGE.battleship;
  if (n.indexOf('战列巡洋') >= 0) return WARSHIP_TONNAGE.battlecruiser;
  if (n.indexOf('重巡') >= 0) return WARSHIP_TONNAGE.heavy_cruiser;
  if (n.indexOf('巡洋') >= 0) return WARSHIP_TONNAGE.light_cruiser;
  if (n.indexOf('潜艇') >= 0) return WARSHIP_TONNAGE.submarine;
  return WARSHIP_TONNAGE.destroyer;
}

// v0.3.0：德国专属「战争线」（4 策）—— 扩张 → 索取 → 战争
export const WAR_LINE = {
  ger: [
    { id: 'ger_w1', branch: '战争', nameCn: '莱茵兰再武装', days: 90,
      desc: '进军莱茵兰：全军士气大振，获得陆军加成与战争正当化经验。',
      effect: { armyAtkMul: 1.1, armyDefMul: 1.05, research: 6000 } },
    { id: 'ger_w2', branch: '战争', nameCn: '四年计划总动员', days: 150,
      desc: '全面军工动员：产线提速并大量装备入库。',
      effect: { lineMul: 1.15, gear: [{ partId: 'ap_wpn_rifle', material: '钢', qty: 400 }] } },
    { id: 'ger_w3', branch: '战争', nameCn: '吞并奥地利', days: 120,
      desc: '和平并入奥地利：人口、工业与钢铁大幅增加。',
      effect: { pop: 4000, goods: { 钢: 9000, 铁: 7000 }, research: 8000 } },
    { id: 'ger_w4', branch: '战争', nameCn: '但泽或战争', days: 180,
      desc: '向波兰提出最后通牒：全军攻击 +25%，正当化速度翻倍。',
      effect: { armyAtkMul: 1.25, justifyMul: 0.5 } },
    { id: 'ger_w5', branch: '战争', nameCn: '黄色方案（对法作战）', days: 200,
      desc: '以装甲洪流突破阿登：全军攻击 +30%，并立即获得对法国的战争正当化。',
      effect: { armyAtkMul: 1.3, justifyAgainst: 'fra', justifyMul: 0.6 } },
    { id: 'ger_w6', branch: '战争', nameCn: '巴巴罗萨（对苏作战）', days: 240,
      desc: '东方总攻势：全军攻防 +25%，并立即获得对苏联的战争正当化。',
      effect: { armyAtkMul: 1.25, armyDefMul: 1.25, justifyAgainst: 'sov', justifyMul: 0.6 } },
  ],
};

// v0.3.0：所有国家的通用扩充分支（每国 +3 策：工业/军事/外交各一，名称按国别生成）
export const EXTRA_FOCUS_TEMPLATE = [
  { suffix: '_x1', branch: '工业', nameCn: '重工业扩建', days: 150,
    desc: '扩建重工业与矿区：产线提速、物资入库。',
    effect: { lineMul: 1.12, goods: { 钢: 4000, 铁: 3000 } } },
  { suffix: '_x2', branch: '军事', nameCn: '常备军整训', days: 150,
    desc: '常备军整训：全军攻防小幅提升。',
    effect: { armyAtkMul: 1.1, armyDefMul: 1.1 } },
  { suffix: '_x3', branch: '外交', nameCn: '外交斡旋', days: 120,
    desc: '外交斡旋：科研点与人口增长，正当化更快。',
    effect: { research: 10000, pop: 800, justifyMul: 0.85 } },
];
// 战争正当化（HOI4 式）：默认 60 游戏天
export const JUSTIFY_DAYS = 60;

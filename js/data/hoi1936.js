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
    popM: 69.3, ic: 48, divisions: 30, navy: 24, airforce: 25,
    sell: { '钢': [2600, 22], '塑料': [900, 40], '陶瓷': [700, 26] },
    buys: { '铁': 20, '铜': 34, '铝': 30, '橡胶': 46, '有机质': 6 },
    colony: { name: '非洲属地', typeId: '荒漠行星' },
    desc: '条约束缚下的工业巨人：产能冠绝欧洲，但资源高度依赖进口，殖民地稀少。',
  },
  {
    id: 'fra', nameCn: '法兰西', nameEn: 'France', capital: '巴黎', flag: '🔵',
    popM: 41.9, ic: 39, divisions: 32, navy: 22, airforce: 14,
    sell: { '钢': [2100, 24], '玻璃': [800, 30], '橡胶': [420, 44] },
    buys: { '钢': 26, '塑料': 38, '有机质': 7, '石英': 16 },
    colony: { name: '北非属地', typeId: '荒漠行星' },
    desc: '号称欧洲最强陆军与坚固防线，工业扎实但战略被动；依靠庞大殖民地输血。',
  },
  {
    id: 'eng', nameCn: '不列颠', nameEn: 'United Kingdom', capital: '伦敦', flag: '🔴',
    popM: 47.5, ic: 46, divisions: 16, navy: 66, airforce: 24,
    sell: { '橡胶': [900, 38], '陶瓷': [650, 28], '有机质': [1800, 9] },
    buys: { '钢': 26, '铝': 32, '石英': 18, '钛合金': 380 },
    colony: { name: '南亚属地', typeId: '丛林行星' },
    desc: '海权与金融霸主：海军天下第一，本土工业稳健；殖民地横跨全球提供原料。',
  },
  {
    id: 'sov', nameCn: '苏维埃联盟', nameEn: 'USSR', capital: '莫斯科', flag: '🟥',
    popM: 168.0, ic: 76, divisions: 92, navy: 14, airforce: 40,
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
    popM: 500.0, ic: 21, divisions: 120, navy: 4, airforce: 6,
    sell: { '有机质': [4200, 4], '陶瓷': [700, 18], '石头': [2500, 3] },
    buys: { '钢': 30, '铁': 24, '铝': 34, '塑料': 44 },
    colony: { name: '西南大后方', typeId: '丛林行星' },
    desc: '人口最多、纵深最阔：师数量惊人但装备与工业薄弱，靠纵深与人力周旋。',
  },
  {
    id: 'ita', nameCn: '意大利', nameEn: 'Italy', capital: '罗马', flag: '🟢',
    popM: 43.0, ic: 28, divisions: 40, navy: 26, airforce: 18,
    sell: { '陶瓷': [900, 22], '钢': [1500, 26], '塑料': [500, 44] },
    buys: { '铁': 22, '铜': 36, '橡胶': 46, '有机质': 7 },
    colony: { name: '地中海属地', typeId: '荒漠行星' },
    desc: '工业不弱但资源匮乏：自称罗马继承人，师数看着吓人、装备与士气常拖后腿。',
  },
  {
    id: 'usa', nameCn: '美利坚', nameEn: 'United States', capital: '华盛顿', flag: '🔷',
    popM: 128.0, ic: 130, divisions: 18, navy: 60, airforce: 28,
    sell: { '钢': [5200, 18], '塑料': [1800, 30], '玻璃': [1200, 22], '铝': [1400, 22] },
    buys: { '橡胶': 42, '陶瓷': 26, '石墨烯': 900, '钛合金': 340 },
    colony: { name: '太平洋属地', typeId: '丛林行星' },
    desc: '工业怪兽：产能远超任何国家，但孤立主义让军力偏小、战备迟钝——潜力可怕。',
  },
  {
    id: 'pol', nameCn: '波兰', nameEn: 'Poland', capital: '华沙', flag: '🟠',
    popM: 34.2, ic: 20, divisions: 30, navy: 4, airforce: 8,
    sell: { '钢': [1300, 25], '有机质': [1500, 6], '石头': [1200, 4] },
    buys: { '钢': 30, '铝': 34, '橡胶': 48, '塑料': 46 },
    colony: { name: '东部边区', typeId: '苔原行星' },
    desc: '夹在两大强邻之间的平原国家：师多而装备旧，地理位置决定命运多舛。',
  },
  {
    id: 'spa', nameCn: '西班牙', nameEn: 'Spain', capital: '马德里', flag: '🟣',
    popM: 24.7, ic: 17, divisions: 22, navy: 8, airforce: 6,
    sell: { '铁': [1400, 14], '陶瓷': [500, 24], '有机质': [1200, 6] },
    buys: { '钢': 32, '塑料': 44, '石英': 20 },
    colony: { name: '西非属地', typeId: '荒漠行星' },
    desc: '山峦与动荡中的国家：工业平平、军队分裂，1936 年正站在内战的悬崖边。',
  },
  {
    id: 'tur', nameCn: '土耳其', nameEn: 'Turkey', capital: '安卡拉', flag: '🟤',
    popM: 16.4, ic: 12, divisions: 20, navy: 5, airforce: 4,
    sell: { '陶瓷': [600, 22], '钢': [800, 28], '石头': [1600, 3] },
    buys: { '钢': 32, '铝': 36, '塑料': 46 },
    colony: { name: '安纳托利亚内陆', typeId: '荒漠行星' },
    desc: '扼守两洲咽喉的要塞国家：军队尚可、工业薄弱，海峡就是它的全部筹码。',
  },
  {
    id: 'bra', nameCn: '巴西', nameEn: 'Brazil', capital: '里约热内卢', flag: '🟩',
    popM: 40.3, ic: 11, divisions: 10, navy: 6, airforce: 3,
    sell: { '橡胶': [1100, 34], '有机质': [2600, 5], '铁': [900, 15] },
    buys: { '钢': 34, '塑料': 46, '玻璃': 34, '陶瓷': 28 },
    colony: { name: '亚马逊内陆', typeId: '丛林行星' },
    desc: '南美巨人：资源丰厚而工业稚嫩，远离旧大陆的烽烟，是潜在的后起之秀。',
  },
];

export const HOI_BY_ID = {};
for (const n of HOI_NATIONS) HOI_BY_ID[n.id] = n;

export const HOI_SCENARIO_ID = 'hoi1936';
export const HOI_SCENARIO_NAME = '1936 剧本 · 风暴前夜';

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
    armyName: '装甲掷弹兵师', atkMul: 1.35, defMul: 0.95, bloc: 'axis',
    fleets: [{ nameCn: '公海舰队', share: 1 }],
    lines: [
      { buildingId: 'blast_furnace', recipeId: 'r_refine_steel', workers: 12 },
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
      { buildingId: 'blast_furnace', recipeId: 'r_refine_steel', workers: 8 },
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
    armyName: '远征军步兵师', atkMul: 0.95, defMul: 1.25, bloc: 'allies',
    fleets: [{ nameCn: '本土舰队', share: 0.6 }, { nameCn: '地中海舰队', share: 0.4 }],
    lines: [
      { buildingId: 'blast_furnace', recipeId: 'r_refine_steel', workers: 10 },
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
    armyName: '要塞步兵师', atkMul: 1.0, defMul: 1.3, bloc: 'allies',
    fleets: [{ nameCn: '地中海舰队（法）', share: 0.6 }, { nameCn: '大西洋舰队（法）', share: 0.4 }],
    lines: [
      { buildingId: 'blast_furnace', recipeId: 'r_refine_steel', workers: 9 },
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
    armyName: '步兵军', atkMul: 1.1, defMul: 1.15, bloc: 'comintern',
    fleets: [{ nameCn: '波罗的海舰队', share: 0.6 }, { nameCn: '黑海舰队', share: 0.4 }],
    lines: [
      { buildingId: 'blast_furnace', recipeId: 'r_refine_steel', workers: 16 },
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
    armyName: '海军陆战师', atkMul: 1.3, defMul: 1.0, bloc: 'neutral',
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
    armyName: '机械化步兵师', atkMul: 1.15, defMul: 1.1, bloc: 'neutral',
    fleets: [{ nameCn: '太平洋舰队', share: 0.6 }, { nameCn: '大西洋舰队', share: 0.4 }],
    lines: [
      { buildingId: 'blast_furnace', recipeId: 'r_refine_steel', workers: 20 },
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
    armyName: '步兵师（国民革命军）', atkMul: 0.85, defMul: 1.2, bloc: 'neutral',
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
      { buildingId: 'blast_furnace', recipeId: 'r_refine_steel', workers: 6 },
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
      { buildingId: 'blast_furnace', recipeId: 'r_refine_steel', workers: 5 },
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
  { id: 'north_sea', nameCn: '北海', base: 400 },
  { id: 'baltic', nameCn: '波罗的海', base: 300 },
  { id: 'med', nameCn: '地中海', base: 500 },
  { id: 'atlantic', nameCn: '大西洋', base: 900 },
  { id: 'pacific_w', nameCn: '西太平洋', base: 800 },
  { id: 'japan_sea', nameCn: '日本海', base: 350 },
];

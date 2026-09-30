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

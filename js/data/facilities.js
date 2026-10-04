// 电力设施数据模块（Astrix v0.0.6，零依赖原生 ES module，纯数据）
//
// 12 项设施：四类（storage / solar / wind / thermal）× 三尺寸（s 小型 / m 大型 / l 超大型）。
// 尺寸倍率 s=1、m=8、l=64（造价 / 工作量 / 发电量 / 储电上限同倍率线性增长）。
//
// 建材铁律（docs/TODO_v0.0.6.md 第 0 节）：
//   小型（s）用 T0~T1 材料，中型（m）用 T2，大型（l）用 T4。
//   所有材料名都取自 js/data/materials.js 或 js/data/planets.js 真实存在的 nameCn。
//
// 字段约定（第 1.2 节）：
//   capacity  仅 storage 类有值（储电上限），其余为 0；
//   powerOut  仅 solar/wind/thermal 有值（每座每秒发电基准，再乘星球系数），storage 为 0；
//   fuel/fuelPerSec  仅 thermal 类有值（燃烧燃料发电）。
//
// 飞船放置用字段（第 1.2 节更正二）：
//   footprint  占用外壳容积（m³）；mass  自身质量（t）。
//   量级参照 ship_parts.js（fac_cargo_mk1 / fac_crew_mk1）：电池重、光伏占地大质轻、
//   风机有塔架偏高、火电锅炉重。s 为基准值；m / l 按 6 倍 / 30 倍放大（占地比 8/64 保守，
//   避免超大型装不进任何外壳），已在下方逐项标注。

// 储电上限量级：s 5e6、m 4e7、l 3.2e8（= 1/8/64 倍）。
// 发电量级（基准，未乘星球系数）：s 40、m 320、l 2560（= 1/8/64 倍）。
// 工作量（人·秒）：s 600、m 4800、l 38400。

const FACILITIES = [
  // ============ 储电（storage）：只提供储电上限，不发电 ============
  {
    id: 'battery_s',
    nameCn: '小型电池',
    kind: 'storage',
    size: 's',
    sizeLabel: '小型',
    baseCost: { 粘土: 300, 二氧化硅: 200, 石墨: 50 },
    work: 600,
    capacity: 5e6,
    powerOut: 0,
    footprint: 4,          // m³（基准）
    mass: 3,               // t（基准）
    desc: '基础储能单元，把盈余电力存起来以备缺电时放电。仅用 T0/T1 材料即可建造，是开局电力缓冲的第一步。',
  },
  {
    id: 'battery_m',
    nameCn: '大型电池',
    kind: 'storage',
    size: 'm',
    sizeLabel: '大型',
    baseCost: { 粘土: 2400, 二氧化硅: 1600, 石墨: 400 },
    work: 4800,
    capacity: 4e7,
    powerOut: 0,
    footprint: 24,         // 4 × 6
    mass: 18,              // 3 × 6
    desc: '高密度储能阵列，储电上限为小型的 8 倍。需 T2 金属材料（铁/铜/玻璃/陶瓷）。',
  },
  {
    id: 'battery_l',
    nameCn: '超大型电池',
    kind: 'storage',
    size: 'l',
    sizeLabel: '超大型',
    baseCost: { 钛: 19200, 铝合金: 12800, 碳化钨: 6400, 橡胶: 3200 },
    work: 38400,
    capacity: 3.2e8,
    powerOut: 0,
    footprint: 120,        // 4 × 30
    mass: 90,              // 3 × 30
    desc: '战略级储能体，储电上限为小型的 64 倍。需 T4 高级材料（钛/铝合金/碳化钨/橡胶），适合支撑后期大电网。',
  },

  // ============ 太阳能（solar）：发电量再乘星球 power.solar 系数 ============
  {
    id: 'solar_s',
    nameCn: '小型光伏',
    kind: 'solar',
    size: 's',
    sizeLabel: '小型',
    baseCost: { 石头: 300, 二氧化硅: 200, 石英: 100 },
    work: 600,
    capacity: 0,
    powerOut: 40,
    footprint: 12,         // m³（占地大）
    mass: 1.2,             // t（质轻）
    desc: '把星球光照转化为电力，实际输出 = 基准 × 星球日照系数。仅 T0/T1 材料，开局即可铺设。不消耗燃料，但从星球能量池抽取清洁能。',
  },
  {
    id: 'solar_m',
    nameCn: '大型光伏',
    kind: 'solar',
    size: 'm',
    sizeLabel: '大型',
    baseCost: { 铁: 2400, 玻璃: 1600, 铝: 800, 铜: 400 },
    work: 4800,
    capacity: 0,
    powerOut: 320,
    panelOptions: [
      { mat: '二氧化硅', eff: 1.0 },
      { mat: '铜',       eff: 1.3 },
      { mat: '银',       eff: 1.7 },
      { mat: '金',       eff: 2.2 },
    ],
    footprint: 72,         // 12 × 6
    mass: 7.2,             // 1.2 × 6
    desc: '高效光伏阵列，单座基准发电为小型的 8 倍。需 T2 材料（铁/玻璃/铝/铜）。',
  },
  {
    id: 'solar_l',
    nameCn: '超大型光伏',
    kind: 'solar',
    size: 'l',
    sizeLabel: '超大型',
    unlockTech: 't_fac_solar_3',
    baseCost: { 钛: 19200, 银: 9600, 金: 7200, 铝合金: 9600 },
    work: 38400,
    capacity: 0,
    powerOut: 2560,
    footprint: 360,        // 12 × 30
    mass: 36,              // 1.2 × 30
    desc: '行星级光伏农场，单座基准发电为小型的 64 倍。需 T4 贵金属材料（钛/银/金/铝合金）。',
  },

  // ============ 风力（wind）：发电量再乘星球 power.wind 系数 ============
  {
    id: 'wind_s',
    nameCn: '小型风机',
    kind: 'wind',
    size: 's',
    sizeLabel: '小型',
    baseCost: { 石头: 300, 木头: 200, 粘土: 100 },
    work: 600,
    capacity: 0,
    powerOut: 40,
    footprint: 10,         // m³（有塔架偏高）
    mass: 4,               // t
    desc: '利用行星风场发电，实际输出 = 基准 × 星球风力系数。仅 T0/T1 材料（石头/木头/粘土）。不耗燃料，从能量池抽清洁能。',
  },
  {
    id: 'wind_m',
    nameCn: '大型风机',
    kind: 'wind',
    size: 'm',
    sizeLabel: '大型',
    baseCost: { 铁: 2400, 铜: 1600, 钢: 1200 },
    work: 4800,
    capacity: 0,
    powerOut: 320,
    footprint: 60,         // 10 × 6
    mass: 24,              // 4 × 6
    desc: '大型风轮机，单座基准发电为小型的 8 倍。需 T2 材料（铁/铜/钢）。',
  },
  {
    id: 'wind_l',
    nameCn: '超大型风机',
    kind: 'wind',
    size: 'l',
    sizeLabel: '超大型',
    baseCost: { 钛: 19200, 钨: 9600, 锰: 7200, 铝合金: 9600 },
    work: 38400,
    capacity: 0,
    powerOut: 2560,
    footprint: 300,        // 10 × 30
    mass: 120,             // 4 × 30
    desc: '巨型风场机组，单座基准发电为小型的 64 倍。需 T4 材料（钛/钨/锰/铝合金）。',
  },

  // ============ 火力（thermal）：不依赖环境（×1），但燃烧燃料 ============
  {
    id: 'thermal_s',
    nameCn: '小型燃机',
    kind: 'thermal',
    size: 's',
    sizeLabel: '小型',
    baseCost: { 石头: 200, 木头: 200, 粘土: 100, 碳: 50 },
    work: 600,
    capacity: 0,
    powerOut: 40,
    fuel: '碳',
    fuelPerSec: 1,
    footprint: 8,          // m³（占地小）
    mass: 6,               // t（锅炉重）
    desc: '燃烧固态燃料发电，输出不依赖星球环境。烧「碳」，每秒每座耗 1 单位。仅 T0/T1 材料，早期即可建立稳定电源。',
  },
  {
    id: 'thermal_m',
    nameCn: '大型燃机',
    kind: 'thermal',
    size: 'm',
    sizeLabel: '大型',
    baseCost: { 铁: 3200, 钢: 1600, 陶瓷: 800 },
    work: 4800,
    capacity: 0,
    powerOut: 320,
    fuel: '标准煤',
    fuelPerSec: 8,
    footprint: 48,         // 8 × 6
    mass: 36,              // 6 × 6
    desc: '中规模燃烧机组，单座基准发电为小型的 8 倍。烧「标准煤」，每秒每座耗 8 单位。需 T2 材料（铁/钢/陶瓷）。',
  },
  {
    id: 'thermal_l',
    nameCn: '超大型燃机',
    kind: 'thermal',
    size: 'l',
    sizeLabel: '超大型',
    baseCost: { 钛: 3200, 钨: 1600, 铝合金: 1600, 碳化钨: 800 },
    work: 38400,
    capacity: 0,
    powerOut: 2560,
    fuel: '甲烷',
    fuelPerSec: 64,
    footprint: 240,        // 8 × 30
    mass: 180,             // 6 × 30
    desc: '巨型燃烧中心，单座基准发电为小型的 64 倍。烧「甲烷」，每秒每座耗 64 单位。需 T4 材料（钛/钨/铝合金/碳化钨），后期主力基载电源。',
  },
];

export const POWER_FACILITIES = FACILITIES;
export const POWER_FACILITY_BY_ID = Object.fromEntries(FACILITIES.map((f) => [f.id, f]));

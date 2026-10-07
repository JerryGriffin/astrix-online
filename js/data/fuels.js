// 燃料资源表（Astrix）
// 数据源：docs/fuels.json（真实摩尔热值与燃烧速率调研，已折算成游戏刻度）
// 字段映射（fuels.json -> 本表）：
//   nameZh         -> nameCn
//   nameEn         -> nameEn
//   formula        -> formula
//   category       -> category
//   realHeatValueKJperMol -> realHeatKJmol
//   heatValue      -> heatValue
//   burnRate       -> burnRate
//   burnTime1x     -> burnTime1x
// heatValue = 真实摩尔热值(kJ/mol) / 100；burnTime1x 以 burnRate 为准：burnTime1x = 1 / burnRate。
// 铀、钚为核裂变燃料（非化学燃烧），按真实裂变能折算等效热值；
// 标准煤非纯物质，按碳当量折算（29307 kJ/kg × 0.012011 ≈ 352 kJ/mol）。

export const FUELS = [
  {
    id: 'carbon',
    nameCn: '碳',
    nameEn: 'Carbon',
    formula: 'C',
    category: 'solid',
    realHeatKJmol: 393.5,
    heatValue: 3.935,
    burnRate: 0.35,
    burnTime1x: 1 / 0.35,
    desc: '最基础的单质燃料，燃烧平缓、能量密度低但易获取。'
  },
  {
    id: 'standard_coal',
    nameCn: '标准煤',
    nameEn: 'Standard coal',
    formula: 'mixture (carbon-equivalent)',
    category: 'fossil',
    realHeatKJmol: 351.9,
    heatValue: 3.519,
    burnRate: 0.15,
    burnTime1x: 1 / 0.15,
    desc: '工业时代能量货币，质量基准 29307 kJ/kg，按碳当量折算，能量密度偏低。'
  },
  {
    id: 'uranium',
    nameCn: '铀',
    nameEn: 'Uranium (U-235)',
    formula: 'U-235',
    category: 'nuclear',
    realHeatKJmol: 1.93e10,
    heatValue: 1.93e8,
    burnRate: 0.02,
    burnTime1x: 1 / 0.02,
    desc: '核裂变燃料，单摩尔能量是化学燃料的千万倍，受控缓慢释放（核裂变，非化学燃烧）。'
  },
  {
    id: 'plutonium',
    nameCn: '钚',
    nameEn: 'Plutonium (Pu-239)',
    formula: 'Pu-239',
    category: 'nuclear',
    realHeatKJmol: 2.03e10,
    heatValue: 2.03e8,
    burnRate: 0.018,
    burnTime1x: 1 / 0.018,
    desc: '人工核燃料，裂变能略高于铀，同属受控裂变、慢速高能量（核裂变，非化学燃烧）。'
  },
  {
    id: 'hydrogen',
    nameCn: '氢气',
    nameEn: 'Hydrogen',
    formula: 'H2',
    category: 'gas',
    realHeatKJmol: 285.8,
    heatValue: 2.858,
    burnRate: 3.0,
    burnTime1x: 1 / 3.0,
    desc: '火焰传播极快、最易点燃的气体燃料，燃烧迅猛但单摩尔能量不高。'
  },
  {
    id: 'hydrazine',
    nameCn: '联氨',
    nameEn: 'Hydrazine',
    formula: 'N2H4',
    category: 'liquid',
    realHeatKJmol: 622.0,
    heatValue: 6.22,
    burnRate: 1.4,
    burnTime1x: 1 / 1.4,
    desc: '火箭级自燃液体燃料，反应凶猛、能量密度高，易储运。'
  },
  {
    id: 'methane',
    nameCn: '甲烷',
    nameEn: 'Methane',
    formula: 'CH4',
    category: 'gas',
    realHeatKJmol: 890.8,
    heatValue: 8.908,
    burnRate: 1.0,
    burnTime1x: 1 / 1.0,
    desc: '基准气体燃料，单摩尔热值最高（化学燃料），燃烧温和稳定。'
  }
];

export const FUEL_BY_NAME = Object.fromEntries(FUELS.map(f => [f.nameCn, f]));
// amountMol 该燃料的总能量 = amountMol * heatValue
export function totalEnergy(fuelName, amountMol) {
  const f = FUEL_BY_NAME[fuelName];
  if (!f) return NaN;
  return amountMol * f.heatValue;
}

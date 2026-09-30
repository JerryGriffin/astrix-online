// 船坞核心逻辑（Astrix v0.0.4）
// 纯计算模块，不碰 DOM。负责：
//   1. 材料 → 部件属性的换算（外壳/引擎/武器/装甲都可自选材料）
//   2. 蓝图校验（容量 ≥ 占地、必须有引擎与乘员仓、型号是否已研究）
//   3. 由「引擎推力 + 全船总质量」算航速，算起飞燃料
//   4. 评估蓝图的类型与强度（如「MKI级运输船」）
//   5. 飞船实例的物理状态：温度 / 内能 / 动能 / 势能，以及温度致死不死的判定
//
// ============================================================================
// 全部公式集中在这里，方便策划调参
// ============================================================================

import { MATERIALS } from '../data/materials.js?v=28.1';
import {
  PART_BY_ID, HULLS, ENGINES, WEAPONS, FACILITIES, MARKS,
  MATERIAL_SLOTS, DEFAULT_MATERIAL, PART_CATEGORIES,
  craftableParts, craftWorkOf, isPartUnlocked,
} from '../data/ship_parts.js?v=28.1';
// 军用部件（ap_*）与舰船部件共用 inst.equipment 库存（key=partId@材料），
// 装备清单/拍卖行列装备时必须两类都能解析出中文名（v0.2.8 修复：军用装备露出英文 id）
import { ARMY_PART_BY_ID } from '../data/army_parts.js?v=28.1';
import { POWER_FACILITY_BY_ID } from '../data/facilities.js?v=28.1';
import { FUEL_BY_NAME } from '../data/fuels.js?v=28.1';
import { PLANETS } from '../data/planets.js?v=28.1';

// 自建材料中文名索引（materials.js 只导出 MATERIALS 数组）
const MAT_BY_NAME = Object.fromEntries(MATERIALS.map((m) => [m.nameCn, m]));

// ---------------------------------------------------------------------------
// 一、材料换算基准
// ---------------------------------------------------------------------------
// 强度以「钢 = 35」为 1.0 倍；密度以「钢 = 3.3 t/m³」为 1.0 倍；
// 比热容以「钢 = 0.13」为 1.0 倍（材料表的口径）。
export const BASE_STRENGTH = 35;
export const BASE_DENSITY = 3.3;
export const BASE_MOLAR_HEAT = 0.13;
export const STRENGTH_FLOOR = 0.3;   // 再弱的材料也有 0.3 倍结构效率
export const DENSITY_CLAMP = { min: 0.2, max: 8 };
export const HEAT_CLAMP = { min: 0.2, max: 6 };

// 各部件类别「怎么吃」材料属性（这是本模块最需要向策划解释的一张表）
//   hull     结构 × structMul        质量 × massMul      耐热上限 = 熔点 × 0.40
//   engine   推力 × √structMul       质量 × massMul      耐热上限 = 熔点 × 0.55
//   weapon   伤害 × (0.5+0.5·structMul) 质量 × massMul   耐热上限 = 熔点 × 0.50
//   facility 装甲加成 × structMul    质量 × massMul      耐热上限 = 熔点 × 0.45
//            非装甲设施只吃 massMul（乘员仓/仓库/机库不吃材料）
export const MELT_FACTOR = { hull: 0.40, engine: 0.55, weapon: 0.50, facility: 0.45 };

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

export function materialMul(name) {
  const m = MAT_BY_NAME[name];
  if (!m) return { structMul: 1, massMul: 1, heatMul: 1, mat: null };
  return {
    structMul: Math.max(STRENGTH_FLOOR, m.strength / BASE_STRENGTH),
    massMul: clamp(m.density / BASE_DENSITY, DENSITY_CLAMP.min, DENSITY_CLAMP.max),
    heatMul: clamp(m.molarHeatCapacity / BASE_MOLAR_HEAT, HEAT_CLAMP.min, HEAT_CLAMP.max),
    mat: m,
  };
}

// 把一个部件 + 所选材料解析成「实装属性」
export function resolvePart(partId, materialName) {
  let p = PART_BY_ID[partId];
  if (!p) {
    // 电力设施（电池/光伏/风机/燃机）：在船上设施体系之外，单独一套数据（facilities.js）。
    // 这里回退查 POWER_FACILITY_BY_ID，合成一个「部件形状」对象后复用下面 facility 分支的结算，
    // 不另起一条逻辑分支写重复公式。
    //   materialSlot: null → materialMul(null) 返回 massMul=1，mass 直接等于设施自身质量（见下）。
    //   structAdd: 0 → 电力设施不提供结构加成。
    //   maxTempK 走默认材料分支（mul.mat 为 null → 1200 × MELT_FACTOR.facility），
    //   即电力设施的耐热上限按默认值算（它们没有材料选择，无熔点可乘）。
    //   不编造 mark 字段：电力设施无 MK 分级，isPartUnlocked/maxMark 对它们不适用。
    const f = POWER_FACILITY_BY_ID[partId];
    if (!f) return null;
    p = {
      id: f.id,
      nameCn: f.nameCn,
      category: 'facility',
      footprint: f.footprint,     // 直接取设施自身占用外壳容积
      mass: f.mass,               // 直接取设施自身质量
      structAdd: 0,               // 电力设施不提供结构加成
      materialSlot: null,         // 不可选材料
      powerFacility: true,        // ★ 标记：这是电力设施，不是船上设施
      powerKind: f.kind,
      capacity: f.capacity,
      powerOut: f.powerOut,
      fuel: f.fuel,
      fuelPerSec: f.fuelPerSec,
      desc: f.desc,
    };
  }
  const useMat = p.materialSlot ? (materialName || DEFAULT_MATERIAL[p.materialSlot]) : null;
  const mul = materialMul(useMat);
  const out = { ...p, material: useMat, structMul: mul.structMul, massMul: mul.massMul };

  if (p.category === 'hull') {
    out.struct = +(p.structBase * mul.structMul).toFixed(2);
    out.mass = +(p.emptyMass * mul.massMul).toFixed(2);
    out.maxTempK = Math.round((mul.mat ? mul.mat.meltingPointK : 900) * MELT_FACTOR.hull);
    out.heatCapPerT = mul.heatMul;      // 热容倍率（全船求和后再乘基准）
  } else if (p.category === 'engine') {
    out.thrust = Math.round(p.thrust * Math.sqrt(mul.structMul));
    out.mass = +(p.mass * mul.massMul).toFixed(2);
    out.maxTempK = Math.round((mul.mat ? mul.mat.meltingPointK : 1200) * MELT_FACTOR.engine);
    out.heatCapPerT = mul.heatMul;
  } else if (p.category === 'weapon') {
    out.damage = Math.round(p.damage * (0.5 + 0.5 * mul.structMul));
    out.mass = +(p.mass * mul.massMul).toFixed(2);
    out.maxTempK = Math.round((mul.mat ? mul.mat.meltingPointK : 1100) * MELT_FACTOR.weapon);
    out.heatCapPerT = mul.heatMul;
  } else {
    out.mass = +(p.mass * mul.massMul).toFixed(2);
    out.structAdd = +(((p.structAdd || 0) * mul.structMul)).toFixed(2);
    out.maxTempK = Math.round((mul.mat ? mul.mat.meltingPointK : 1200) * MELT_FACTOR.facility);
    out.heatCapPerT = mul.heatMul;
  }
  return out;
}

// ---------------------------------------------------------------------------
// 二、蓝图结构
// ---------------------------------------------------------------------------
// blueprint = {
//   hullId, hullMaterial,
//   engines: [{ id, material }],
//   parts:   [{ id, material }],   // 武器与设施混在一个列表里，用 category 区分
//   fuelName,                      // 起飞燃料
//   altitudeM,                     // 当前高度（用于势能）
//   planetCode,                    // 当前所在星球
// }
// 默认蓝图：一艘最小可用的探索船。
// 注意部件 id 必须带型号后缀（hull_s_mk1 而非 hull_s），
// 否则 resolvePart 查不到会静默返回 null，容量/槽位全变 0。
export function emptyBlueprint() {
  const hullId = 'hull_s_mk1';
  const kind = kindOfHull(hullId);
  return {
    // v0.1.1：必须带 id —— dock 造船线按 blueprintId 建线，
    // shipBuildTick(inst, blueprintId, ...) 首行 `if (!blueprintId) return 0`
    // 会把无 id 的蓝图整个挡掉，表现为「点了建造却永远造不出船」。
    // 与 defaultBlueprints() 的 mk() 同口径（id / kind / nameCn / hull 并存）。
    id: genBlueprintId(kind),
    kind,
    nameCn: '未命名蓝图',
    hullId,
    hull: hullId,
    createdAt: Date.now(),
    hullMaterial: DEFAULT_MATERIAL.hull,
    engines: [{ id: 'engine_basic', material: DEFAULT_MATERIAL.engine }],
    parts: [
      { id: 'fac_crew_mk1', material: null },
    ],
    fuelName: '甲烷',
    altitudeM: 1000,
    planetCode: 'syl',
  };
}

// 全船部件（含外壳与引擎）展开成实装属性列表
export function resolveBlueprint(bp) {
  const hull = resolvePart(bp.hullId, bp.hullMaterial);
  const engines = (bp.engines || []).map((e) => resolvePart(e.id, e.material)).filter(Boolean);
  const parts = (bp.parts || []).map((p) => resolvePart(p.id, p.material)).filter(Boolean);
  return { hull, engines, parts, all: [hull, ...engines, ...parts].filter(Boolean) };
}

// ---------------------------------------------------------------------------
// 三、容量 / 占地 / 质量
// ---------------------------------------------------------------------------
export function capacityOf(bp) {
  const hull = resolvePart(bp.hullId, bp.hullMaterial);
  return hull ? hull.capacity : 0;
}

export function usedFootprint(bp) {
  const { parts } = resolveBlueprint(bp);
  return parts.reduce((s, p) => s + (p.footprint || 0), 0);
}

// 已用槽位 = 引擎数 + 部件数（武器与设施都在 parts 里）。
// 外壳用 slots 字段给出「可装部件个数上限」，电力设施作为 parts 的一员也占 1 个槽位，
// 与船上设施（fac_*）同等待遇——它们被安装进外壳、吃名额也吃容量（footprint）。
// 设计判断：电力设施应同时吃「容量（footprint）」与「槽位（slots）」两套上限，
// 不另设名额规则（若只吃容量不吃槽位，会出现「塞满小件但槽位还很多」的失衡），
// 故此处保持 engines.length + parts.length 不变。
export function usedSlots(bp) {
  return (bp.engines || []).length + (bp.parts || []).length;
}

export function totalMass(bp) {
  const { all } = resolveBlueprint(bp);
  return +all.reduce((s, p) => s + (p.mass || 0), 0).toFixed(2);
}

// ---------------------------------------------------------------------------
// 四、航速与起飞燃料
// ---------------------------------------------------------------------------
export const SPEED_K = 300;          // 速度系数
export const MASS_EXPONENT = 0.7;    // 质量指数（>1 时大船更吃亏，这里用 0.7 保持曲线平缓）

// 航速（m/s）= SPEED_K × 总推力 / 总质量^0.7
export function speedOf(bp) {
  const { engines } = resolveBlueprint(bp);
  const thrust = engines.reduce((s, e) => s + (e.thrust || 0), 0);
  const massT = totalMass(bp);
  if (thrust <= 0 || massT <= 0) return 0;
  return Math.round((SPEED_K * thrust) / Math.pow(massT, MASS_EXPONENT));
}

// 起飞等效 Δv（m/s）：以类地行星 9.0 m/s² 为基准，重力越大越难起飞
export const TAKEOFF_DV_BASE = 2000;
export const BASE_GRAVITY = 9.0;
export const ENGINE_DEFAULT_EFFICIENCY = 0.40;
export const J_PER_HEAT_UNIT = 1e5;  // 1 单位游戏热值 = 100 kJ/mol（与 fuels.js 刻度一致）

export function gravityOf(planetCode) {
  const p = PLANETS.find((x) => x.code === planetCode || x.id === planetCode);
  return (p && p.gravity) || GRAVITY_BY_TYPE[p && p.type] || 9.0;
}

// 按星球类型给的重力（planets.js 暂未逐星球标 gravity，缺省时按类型取）
export const GRAVITY_BY_TYPE = {
  '类地行星': 9.0, '类地卫星': 1.8, '干旱行星': 7.2, '奇异行星': 6.3,
  '奇异卫星': 2.2, '苔原行星': 8.1, '辐射行星': 10.4,
};

// 起飞需要烧掉多少 mol 燃料
//   能量 E = 0.5 × m × Δv² / 引擎效率
//   摩尔数 = E / (该燃料游戏热值 × 1e5 J)
// 推论：核燃料（铀/钚，热值高 7 个数量级）起飞只需不到 1 mol，化学燃料要几十万 mol。
export function takeoffFuelMol(bp) {
  const { engines } = resolveBlueprint(bp);
  const massKg = totalMass(bp) * 1000;
  const eff = engines.length
    ? engines.reduce((s, e) => s + (e.efficiency || ENGINE_DEFAULT_EFFICIENCY), 0) / engines.length
    : ENGINE_DEFAULT_EFFICIENCY;
  const dv = TAKEOFF_DV_BASE * (gravityOf(bp.planetCode) / BASE_GRAVITY);
  const E = (0.5 * massKg * dv * dv) / Math.max(0.1, eff);
  const fuel = FUEL_BY_NAME[bp.fuelName] || FUEL_BY_NAME['甲烷'];
  const heat = fuel ? fuel.heatValue : 8.908;
  return Math.max(1, Math.round(E / (heat * J_PER_HEAT_UNIT)));
}

// ---------------------------------------------------------------------------
// 五、火力 / 载货 / 载员 / 结构 / 散热 / 耗电
// ---------------------------------------------------------------------------
export function aggregate(bp) {
  const { hull, engines, parts } = resolveBlueprint(bp);
  const weapons = parts.filter((p) => p.category === 'weapon');
  const facs = parts.filter((p) => p.category === 'facility');

  const damage = weapons.reduce((s, w) => s + w.damage, 0);
  const rangeKm = weapons.length ? Math.max(...weapons.map((w) => w.rangeKm || 0)) : 0;
  const cargoVol = facs.reduce((s, f) => s + (f.cargoVol || 0), 0);
  const crewMax = facs.reduce((s, f) => s + (f.crew || 0), 0);
  const hangarSlots = facs.reduce((s, f) => s + (f.hangarSlots || 0), 0);
  const structAdd = facs.reduce((s, f) => s + (f.structAdd || 0), 0);
  const tempBandBonus = facs.reduce((s, f) => s + (f.tempBandBonus || 0), 0);

  const struct = (hull ? hull.struct : 0) + structAdd;
  const thrust = engines.reduce((s, e) => s + (e.thrust || 0), 0);
  const heatKW = engines.reduce((s, e) => s + (e.heatKW || 0), 0)
    + parts.reduce((s, p) => s + (p.heatKW || 0), 0);
  const powerKW = parts.reduce((s, p) => s + (p.powerKW || 0), 0);
  const fuelBurn = engines.reduce((s, e) => s + (e.fuelBurn || 0), 0);

  // 耐热上限：全船取各部件最低的那个（最弱的环节决定上限）
  const tempParts = [hull, ...engines, ...parts].filter((p) => p && p.maxTempK);
  const maxTempK = tempParts.length ? Math.min(...tempParts.map((p) => p.maxTempK)) : 900;

  return {
    struct: +struct.toFixed(2), thrust, damage, rangeKm, cargoVol, crewMax,
    hangarSlots, tempBandBonus: +tempBandBonus.toFixed(1), heatKW, powerKW,
    fuelBurn: +fuelBurn.toFixed(4), maxTempK,
  };
}

// 船体表面积（m²）：用于热平衡，按容量开方估算
export const AREA_K = 5.3;
export function surfaceArea(bp) {
  return +(AREA_K * Math.sqrt(Math.max(1, capacityOf(bp)))).toFixed(1);
}

// 有效热容（J/K）：只把结构质量的一部分计入热平衡（HEAT_MASS_FRACTION），
// 否则 100 t 级飞船的热惯性会让温度几小时都不动一下，失去玩法意义。
export const HEAT_MASS_FRACTION = 0.02;
export const HEAT_CAP_K = 3500;   // 每 kg 每单位 c 折算的 J/(kg·K)
export function heatCapacity(bp) {
  const { all } = resolveBlueprint(bp);
  const sum = all.reduce((s, p) => s + (p.mass * 1000) * (p.heatCapPerT || 1), 0);
  return Math.max(1, sum * HEAT_MASS_FRACTION * HEAT_CAP_K);
}

// ---------------------------------------------------------------------------
// 六、蓝图评估：类型 / 型号 / 强度 / 默认船名
// ---------------------------------------------------------------------------
export const GRADES = [
  { max: 60, label: '民用' },
  { max: 120, label: '准军用' },
  { max: 240, label: '军用' },
  { max: Infinity, label: '主力舰' },
];

export function typeOf(bp, agg) {
  if (agg.hangarSlots > 0) return '母舰';
  if (agg.damage >= 150) return '战舰';
  if (agg.crewMax >= 60) return '殖民船';
  if (agg.cargoVol > 0) return '运输船'; // v0.1.1（需求 10b）：有任何货舱（cargoVol>0）即运输船
  return '探索船';
}

export function strengthOf(bp, agg) {
  const speed = speedOf(bp);
  return Math.round(
    agg.struct * 0.8
    + agg.damage * 0.08
    + speed / 150
    + agg.cargoVol / 150
    + agg.crewMax * 0.25,
  );
}

export function gradeOf(score) {
  for (const g of GRADES) if (score < g.max) return g.label;
  return GRADES[GRADES.length - 1].label;
}

// 同型船已有几艘（用于默认名 No.N）
export function nextSerial(ships, className) {
  const n = (ships || []).filter((s) => s.className === className).length;
  return n + 1;
}

// 完整评估。ctx = { researched: Set|string[], ships: [] }
export function evaluateBlueprint(bp, ctx = {}) {
  const errors = [];
  const warnings = [];
  const researched = new Set(ctx.researched || []);

  const hull = resolvePart(bp.hullId, bp.hullMaterial);
  if (!hull) errors.push('未选择外壳');
  const engines = (bp.engines || []).map((e) => resolvePart(e.id, e.material)).filter(Boolean);
  if (engines.length === 0) errors.push('至少需要 1 台引擎');
  if ((bp.engines || []).length > 4) errors.push('引擎最多 4 台');

  const cap = capacityOf(bp);
  const foot = usedFootprint(bp);
  if (foot > cap) errors.push(`容量不足：已占 ${foot} / ${cap} m³，超出 ${foot - cap} m³`);

  // v0.0.8：槽位限制已取消，只按容量。返回值里保留 slots / slotsUsed 供 UI 显示，
  //   但不再作为校验依据（设计者：「充分发挥创造力，只要保证不超过容量」）。
  const slots = hull ? hull.slots : 0;
  const used = usedSlots(bp);

  const { parts } = resolveBlueprint(bp);
  const hasCrew = parts.some((p) => (p.crew || 0) > 0);
  if (!hasCrew) errors.push('没有乘员仓：无人驾驶的船造不出来');

  // 科技校验
  // v0.0.61：舰船部件的科技门槛统一改为**船坞**（isPartUnlocked 把关，UI 层过滤选项），
  //   这里只保留一个兵底检查，避免手改存档塞进未解锁部件。
  const DOCK_TECH = 't_e3';
  for (const p of [hull, ...engines, ...parts].filter(Boolean)) {
    const base = PART_BY_ID[p.id];
    if (!base) continue;   // 电力设施（facilities.js）不在 PART_BY_ID 里，另行把关
    if (!researched.has(DOCK_TECH)) {
      errors.push('未研究：需要先研究并建造船坞');
      break;   // 同一个原因不必刷屏
    }
  }

  const agg = aggregate(bp);
  const speed = speedOf(bp);
  const massT = totalMass(bp);
  if (massT <= 0) errors.push('总质量为 0');
  if (engines.length && agg.thrust / Math.max(1, massT) < 2) {
    warnings.push('推重比偏低（< 2 kN/t），航速会很慢');
  }
  if (agg.tempBandBonus < 8) warnings.push('乘员仓偏少，温度安全区间很窄');
  if (agg.damage === 0) warnings.push('无武装');

  // 温度安全区间：基准区间 + 乘员仓放宽
  const band = safeTempBand(agg.tempBandBonus);

  const type = typeOf(bp, agg);
  // MK 等级由**全部已装部件共同决定**（取其中最高的一档），而不是只看外壳。
  //   设计者要求「飞船蓝图根据部件等级来确认 mk 等级」——
  //   若引擎/武器/设施用了更高档的部件，整船就应当算作那一档，
  //   否则会出现「装了 MKIII 引擎却判定为 MKI 的外壳」这种不一致。
  //   v0.0.61 目前部件只有 MKI 一套，所以这里恒为 1；
  //   但它已经不再依赖外壳，日后加回更高档部件时会自动生效。
  const installedMarks = [hull, ...engines, ...parts]
    .filter(Boolean)
    .map((p) => Number(p.mark))
    .filter((m) => Number.isFinite(m) && m > 0);
  const mark = installedMarks.length ? Math.max(...installedMarks) : 1;
  const markLabel = (MARKS.find((m) => m.mark === mark) || MARKS[0]).label;
  // 船级名不带「MKI级」前缀（v0.0.61：设计者认为 MK 分级无实际意义）
  const className = type;
  const strength = strengthOf(bp, agg);

  return {
    ok: errors.length === 0,
    errors,
    warnings,
    hull, engines, parts, agg,
    capacity: cap, footprint: foot, footprintLeft: cap - foot,
    slots, slotsUsed: used,
    massT, speed, thrust: agg.thrust,
    takeoffFuelMol: takeoffFuelMol(bp),
    type, mark, markLabel, className,
    strength, grade: gradeOf(strength),
    tempBand: band,
    surfaceArea: surfaceArea(bp),
    heatCapacity: heatCapacity(bp),
  };
}

// ---------------------------------------------------------------------------
// 七、温度模型
// ---------------------------------------------------------------------------
// 安全 / 致命温度区间（开尔文）。乘员仓提供生命维持，会把区间向两端放宽。
export const SAFE_TEMP = { min: 273, max: 313 };    // 0 ~ 40 ℃
export const LETHAL_TEMP = { min: 253, max: 333 };  // 超出即开始死人
export const COMFORT_TEMP = 293;

export function safeTempBand(bonus = 0) {
  const b = Math.max(0, bonus);
  return { min: SAFE_TEMP.min - b, max: SAFE_TEMP.max + b };
}
export function lethalTempBand(bonus = 0) {
  const b = Math.max(0, bonus);
  return { min: LETHAL_TEMP.min - b, max: LETHAL_TEMP.max + b };
}

// 热平衡常数
export const RAD_COEF = 475;    // W/m²，以 300 K 为参考的辐射散热系数
export const ENV_COEF = 14.3;   // W/(m²·K)，与星球/恒星环境的换热系数
export const REF_TEMP = 300;

// 环境温度（K）：按星球类型给，越靠近恒星越热
export const ENV_TEMP_BY_TYPE = {
  '类地行星': 280, '类地卫星': 250, '干旱行星': 330, '奇异行星': 270,
  '奇异卫星': 265, '苔原行星': 225, '辐射行星': 305,
};

export function envTempK(planetCode) {
  const p = PLANETS.find((x) => x.code === planetCode || x.id === planetCode);
  return ENV_TEMP_BY_TYPE[p && p.type] || 280;
}

// 净热流（W）：正数升温、负数降温
export function netHeatFlow(bp, TempK, planetCode) {
  const area = surfaceArea(bp);
  const env = envTempK(planetCode);
  const qGen = aggregate(bp).heatKW * 1000;
  const qRad = RAD_COEF * area * Math.pow(TempK / REF_TEMP, 4);
  const qEnv = ENV_COEF * area * (env - TempK);
  return { qGen, qRad, qEnv, net: qGen + qEnv - qRad, area, env };
}

// 热平衡稳态温度（牛顿迭代，用于 UI 显示「预计稳定温度」，也是新船出厂温度）
//
// 注意符号：net(T) = qGen + qEnv(T) − qRad(T)，其中 qEnv 与 qRad 都随 T 上升而增大，
// 所以 dnet/dT < 0。下面算出的 dQdT 是 |dnet/dT|，因此牛顿回代必须用 T += net/dQdT。
// （早期版本写成 T -= net/dQdT，等价于把稳定性判据反过来，迭代会发散到上亿开尔文。）
export function equilibriumTemp(bp, planetCode) {
  let T = 290;
  const area = surfaceArea(bp);
  for (let i = 0; i < 80; i++) {
    const { net } = netHeatFlow(bp, T, planetCode);
    const dQdT = 4 * RAD_COEF * area * Math.pow(T / REF_TEMP, 3) / REF_TEMP + ENV_COEF * area;
    const step = net / Math.max(1e-6, dQdT);
    T += step;
    if (!Number.isFinite(T)) return 290;
    if (T < 3) T = 3;                 // 不至于跌破宇宙背景温度
    if (T > 5000) T = 5000;           // 极端情况下的保险，避免迭代在超高温区乱跳
    if (Math.abs(step) < 0.01) break;
  }
  return +T.toFixed(1);
}

// 每秒船员损失比例（0 表示安全）
export const CREW_LOSS_K = 0.002;
export function crewLossRate(TempK, bandBonus = 0) {
  const lo = lethalTempBand(bandBonus).min;
  const hi = lethalTempBand(bandBonus).max;
  if (TempK >= lo && TempK <= hi) return 0;
  const over = TempK < lo ? lo - TempK : TempK - hi;
  return CREW_LOSS_K * over;
}

// 温度状态标签
export function tempStatus(TempK, bandBonus = 0) {
  const safe = safeTempBand(bandBonus);
  const lethal = lethalTempBand(bandBonus);
  if (TempK >= safe.min && TempK <= safe.max) return { id: 'ok', label: '舒适' };
  if (TempK < lethal.min || TempK > lethal.max) return { id: 'lethal', label: '致命' };
  return { id: 'warn', label: TempK < safe.min ? '偏冷' : '偏热' };
}

// ---------------------------------------------------------------------------
// 八、能量项
// ---------------------------------------------------------------------------
// 动能 = 0.5 × m × v²
export function kineticEnergyJ(massT, speedMps) {
  return 0.5 * massT * 1000 * speedMps * speedMps;
}
// 势能（相对最近星球）= m × g × h
export function potentialEnergyJ(massT, planetCode, altitudeM) {
  return massT * 1000 * gravityOf(planetCode) * Math.max(0, altitudeM);
}
// 内能 = 热容 × 温度
export function internalEnergyJ(C, TempK) {
  return C * TempK;
}

// ---------------------------------------------------------------------------
// 九、飞船实例
// ---------------------------------------------------------------------------
let _seq = 0;
function newId() {
  _seq += 1;
  return 'ship_' + Date.now().toString(36) + '_' + _seq.toString(36);
}

export function createShip(bp, ctx = {}) {
  const ev = evaluateBlueprint(bp, ctx);
  if (!ev.ok) return { ok: false, errors: ev.errors, evaluation: ev };

  const className = ev.className;
  const serial = nextSerial(ctx.ships, className);
  const TempK = equilibriumTemp(bp, bp.planetCode);
  const inv = {};
  for (const m of MATERIALS) inv[m.nameCn] = 0;

  return {
    ok: true,
    evaluation: ev,
    ship: {
      id: newId(),
      className,
      name: `${className}No.${serial}`,
      mark: ev.mark,
      markLabel: ev.markLabel,
      type: ev.type,
      grade: ev.grade,
      strength: ev.strength,
      blueprint: JSON.parse(JSON.stringify(bp)),
      stats: {
        capacity: ev.capacity, footprint: ev.footprint, slots: ev.slots, slotsUsed: ev.slotsUsed,
        massT: ev.massT, thrust: ev.thrust, speed: ev.speed,
        struct: ev.agg.struct, damage: ev.agg.damage, rangeKm: ev.agg.rangeKm,
        cargoVol: ev.agg.cargoVol, crewMax: ev.agg.crewMax, hangarSlots: ev.agg.hangarSlots,
        heatKW: ev.agg.heatKW, powerKW: ev.agg.powerKW, fuelBurn: ev.agg.fuelBurn,
        maxTempK: ev.agg.maxTempK, tempBandBonus: ev.agg.tempBandBonus,
        surfaceArea: ev.surfaceArea, heatCapacity: ev.heatCapacity, takeoffFuelMol: ev.takeoffFuelMol,
      },
      state: {
        planetCode: bp.planetCode,
        altitudeM: Math.max(0, bp.altitudeM ?? 1000),
        velocityMps: 0,          // 当前速度（起飞前为 0）
        TempK,
        internalEnergyJ: internalEnergyJ(ev.heatCapacity, TempK),
        kineticEnergyJ: 0,
        potentialEnergyJ: potentialEnergyJ(ev.massT, bp.planetCode, Math.max(0, bp.altitudeM ?? 1000)),
        fuelName: bp.fuelName,
        fuelMol: 0,
        crew: ev.agg.crewMax,
        crewMax: ev.agg.crewMax,
        hullIntegrity: 1,
        flying: false,
        derelict: false,
      },
      inventory: inv,
      createdAt: Date.now(),
    },
  };
}

// 推进一艘飞船 dt 秒：温度、能量、船员、燃料
// ctx = { planetCode }（可覆盖当前星球，比如刚降落）
export function tickShip(ship, dt, ctx = {}) {
  if (!ship || !ship.state || dt <= 0) return ship;
  const bp = ship.blueprint;
  const st = ship.state;
  const planetCode = ctx.planetCode || st.planetCode;
  const area = ship.stats.surfaceArea;
  const C = ship.stats.heatCapacity;

  // 1) 热平衡：引擎与武器只在实际运行时发热，未起飞时只有待机热
  const { qGen, qRad, qEnv } = netHeatFlow(bp, st.TempK, planetCode);
  const activeGen = st.flying ? qGen : qGen * 0.15;   // 停泊时按 15% 计（待机 + 生命维持）
  const net = activeGen + qEnv - qRad;
  // 辐射项按 T⁴ 增长，天然自限；这里只做数值兜底，防止异常蓝图把温度推到非物理量级
  st.TempK = clamp(st.TempK + (net / C) * dt, 3, 5000);

  // 2) 材料耐热上限：超过就把船体烧穿
  if (st.TempK > ship.stats.maxTempK) {
    const over = st.TempK - ship.stats.maxTempK;
    st.hullIntegrity = Math.max(0, st.hullIntegrity - over * 0.0005 * dt);
  }

  // 3) 船员：温度超出致死区间就掉人
  const loss = crewLossRate(st.TempK, ship.stats.tempBandBonus);
  if (loss > 0 && st.crew > 0) {
    st.crew = Math.max(0, st.crew - Math.max(1, st.crew * loss) * dt);
  }
  if (st.crew <= 0 && !st.derelict) { st.derelict = true; st.flying = false; }

  // 4) 飞行：烧燃料、加速度、更新能量
  if (st.flying && st.fuelMol > 0 && !st.derelict) {
    const burn = (ship.stats.fuelBurn || 0) * dt;
    st.fuelMol = Math.max(0, st.fuelMol - burn);
    const target = ship.stats.speed;
    st.velocityMps = Math.min(target, st.velocityMps + (target * dt) / 60);  // 60 秒加速到巡航速度
    st.altitudeM += st.velocityMps * dt;
    if (st.fuelMol <= 0) st.flying = false;
  } else if (!st.flying) {
    st.velocityMps = Math.max(0, st.velocityMps - ship.stats.speed * dt / 120);
  }

  // 5) 三项能量
  st.internalEnergyJ = internalEnergyJ(C, st.TempK);
  st.kineticEnergyJ = kineticEnergyJ(ship.stats.massT, st.velocityMps);
  st.potentialEnergyJ = potentialEnergyJ(ship.stats.massT, planetCode, st.altitudeM);
  return ship;
}

// 起飞：检查燃料是否够，扣掉燃料并进入飞行
export function launchShip(ship) {
  const st = ship.state;
  if (st.derelict) return { ok: false, reason: '船员已全部死亡，无人驾驶' };
  const need = ship.stats.takeoffFuelMol;
  if (st.fuelMol < need) return { ok: false, reason: `燃料不足：需要 ${need} mol，当前 ${Math.round(st.fuelMol)} mol` };
  st.fuelMol -= need;
  st.flying = true;
  return { ok: true, used: need };
}

// ============================================================================
// 十、装备库存（v0.0.7，设计者任务 A）
// ============================================================================
// 部件造出来后存到**星球实例**上（不是账号）：inst.equipment[key] = { partId, material, count }
// key = partId + '@' + material（material 为 null 时记成 'null' 串，保持 key 稳定）。
// 老存档没有 inst.equipment 时惰性初始化为 {}，不会崩。

function equipKey(partId, material) {
  return partId + '@' + (material == null ? '' : material);
}

// 列出全部装备：[{ key, partId, material, count, part }]
// part 解析顺序：舰船部件（PART_BY_ID）→ 军用部件（ARMY_PART_BY_ID）→ null（未知 id）
export function equipmentList(inst) {
  if (!inst || !inst.equipment || typeof inst.equipment !== 'object') return [];
  const out = [];
  for (const key in inst.equipment) {
    const e = inst.equipment[key];
    if (!e) continue;
    out.push({
      key,
      partId: e.partId,
      material: e.material,
      count: Number(e.count) || 0,
      part: PART_BY_ID[e.partId] || ARMY_PART_BY_ID[e.partId] || null,
    });
  }
  return out;
}

// 某部件+材料的数量
export function equipmentCount(inst, partId, material) {
  if (!inst || !inst.equipment) return 0;
  const e = inst.equipment[equipKey(partId, material)];
  return e ? Number(e.count) || 0 : 0;
}

// 累加装备，返回新 count
export function addEquipment(inst, partId, material, n) {
  if (!inst) return 0;
  if (!inst.equipment || typeof inst.equipment !== 'object') inst.equipment = {};
  const key = equipKey(partId, material);
  const e = inst.equipment[key] || { partId, material: material == null ? null : material, count: 0 };
  e.count = Number(e.count || 0) + (Number(n) || 0);
  inst.equipment[key] = e;
  return e.count;
}

// 整笔扣：够则扣并返回 true，不够返回 false（不打折扣）
export function consumeEquipment(inst, partId, material, n) {
  if (!inst || !inst.equipment) return false;
  const key = equipKey(partId, material);
  const e = inst.equipment[key];
  const have = e ? Number(e.count) || 0 : 0;
  const need = Number(n) || 0;
  if (have < need) return false;
  e.count = have - need;
  if (e.count <= 0) delete inst.equipment[key];
  return true;
}

// ============================================================================
// 十一、多蓝图（v0.0.7，设计者任务 B）
// ============================================================================
// 账号上新增 acc.blueprints = [...]，蓝图沿用 emptyBlueprint() 形状并额外带
//   { id, nameCn, kind, hull, hullMaterial, engines, parts, createdAt }
// 兼容：acc.blueprint（单张）保留为「当前选中蓝图」；
//   若 acc.blueprints 不存在，取默认 3 张并 acc.blueprint = acc.blueprints[0]。

// 按外壳大小消耗的研究点（设计者给定，最终值）
export const HULL_RP_COST = {
  'hull_xs_mk1': 2000,
  'hull_s_mk1': 5000,
  'hull_m_mk1': 12000,
  'hull_l_mk1': 30000,
  'hull_xl_mk1': 60000,
};

// 外壳 id → 蓝图 kind（玩家自设计时按大小推断；三张默认蓝图在 defaultBlueprints 里写死）
export function kindOfHull(hullId) {
  if (hullId === 'hull_xs_mk1') return 'scout';
  if (hullId === 'hull_s_mk1') return 'frigate';
  if (hullId === 'hull_m_mk1') return 'freighter';
  if (hullId === 'hull_l_mk1') return 'cruiser';
  if (hullId === 'hull_xl_mk1') return 'dreadnought';
  return 'custom';
}

let _bpSeq = 0;
export function genBlueprintId(kind) {
  _bpSeq += 1;
  return 'bp_' + (kind || 'custom') + '_' + Date.now().toString(36) + '_' + _bpSeq.toString(36);
}

// 默认 3 张低级蓝图（命名严格照抄设计者）：
//   护卫舰 MKI「刺猬」 / 运输船 MKI「驮鹿」 / 巡洋舰 MKI「游隼」
// 三张都必须能通过 evaluateBlueprint（容量不超 / 引擎数合法 / 有乘员仓）。
export function defaultBlueprints() {
  const now = Date.now();
  const mk = (o) => Object.assign({
    id: genBlueprintId(o.kind),
    createdAt: now,
    fuelName: '甲烷',
    altitudeM: 1000,
    planetCode: 'syl',
  }, o, { hull: o.hullId });   // 额外带 hull 字段（= hullId），与 emptyBlueprint 的 hullId 并存
  return [
    mk({
      kind: 'frigate', nameCn: '护卫舰 MKI「刺猬」',
      hullId: 'hull_s_mk1', hullMaterial: DEFAULT_MATERIAL.hull,
      engines: [{ id: 'engine_light_mk1', material: DEFAULT_MATERIAL.engine }],
      parts: [
        { id: 'wpn_mg_mk1', material: DEFAULT_MATERIAL.weapon },
        { id: 'wpn_mg_mk1', material: DEFAULT_MATERIAL.weapon },
        { id: 'fac_crew_mk1', material: null },
      ],
    }),
    mk({
      kind: 'freighter', nameCn: '运输船 MKI「驮鹿」',
      hullId: 'hull_m_mk1', hullMaterial: DEFAULT_MATERIAL.hull,
      engines: [
        { id: 'engine_balanced_mk1', material: DEFAULT_MATERIAL.engine },
        { id: 'engine_balanced_mk1', material: DEFAULT_MATERIAL.engine },
      ],
      parts: [
        { id: 'fac_cargo_mk1', material: null },
        { id: 'fac_cargo_mk1', material: null },
        { id: 'fac_crew_mk1', material: null },
      ],
    }),
    mk({
      kind: 'cruiser', nameCn: '巡洋舰 MKI「游隼」',
      hullId: 'hull_l_mk1', hullMaterial: DEFAULT_MATERIAL.hull,
      engines: [
        { id: 'engine_heavy_mk1', material: DEFAULT_MATERIAL.engine },
        { id: 'engine_heavy_mk1', material: DEFAULT_MATERIAL.engine },
        { id: 'engine_heavy_mk1', material: DEFAULT_MATERIAL.engine },
      ],
      parts: [
        { id: 'wpn_cannon_mk1', material: DEFAULT_MATERIAL.weapon },
        { id: 'wpn_cannon_mk1', material: DEFAULT_MATERIAL.weapon },
        { id: 'fac_armor_mk1', material: DEFAULT_MATERIAL.armor },
        { id: 'fac_armor_mk1', material: DEFAULT_MATERIAL.armor },
        { id: 'fac_crew_mk1', material: null },
      ],
    }),
  ];
}

// 兼容老存档：确保账号有 acc.blueprints，并让 acc.blueprint 指向当前选中蓝图。
// 不修改 state.js——由各接线处在合适时机（如载入账号后）调用。
export function ensureBlueprints(acc) {
  if (!acc) return [];
  if (!Array.isArray(acc.blueprints) || acc.blueprints.length === 0) {
    acc.blueprints = defaultBlueprints();
  }
  if (!acc.blueprint || typeof acc.blueprint !== 'object') {
    acc.blueprint = acc.blueprints[0] || null;
  }
  return acc.blueprints;
}

// ============================================================================
// 十二、部件强度（v0.0.7，设计者任务 C）
// ============================================================================
// 材料自选 → 材料影响强度。复用 resolvePart 的现有材料换算（不再另写一套）：
//   hull          → 实装结构强度 struct（= structBase × 材料 structMul）
//   装甲设施       → 实装结构加成 structAdd
//   引擎/武器/无结构设施 → 没有结构字段，返回材料强度倍率（钢=1，作为相对强度）
// 材料查不到时回退 DEFAULT_MATERIAL（无槽位则传 null）。
export function partStrengthOf(partId, materialName) {
  const base = PART_BY_ID[partId];
  if (!base) return 0;
  const slot = base.materialSlot;
  let mat = materialName;
  if (!mat || !MAT_BY_NAME[mat]) mat = slot ? DEFAULT_MATERIAL[slot] : null;
  const r = resolvePart(partId, mat);
  if (!r) return 0;
  if (r.category === 'hull') return r.struct;
  if (r.structAdd) return r.structAdd;
  return +(r.structMul != null ? r.structMul : 1).toFixed(3);
}

// ============================================================================
// 十三、船坞按蓝图开生产线（v0.0.7，设计者任务 4；v0.1.1 契约固化）
// ============================================================================
// core 侧只做校验与产出计算；UI 的建造按钮负责调 production.addLine 开 dock 线，
// state.js 的 tick 接线由主代理完成。
//
// ★★ state.js 接线契约（v0.1.1，主代理按此接线）★★
//   每 tick 对 inst.lines 中所有 buildingId === 'dock' 的线各调一次：
//
//     shipBuildTick(inst, line.blueprintId, labor, dt, powerRatio, acc)
//
//       inst        星球实例；进度存 inst.shipProgress[blueprintId]
//                   （同蓝图的多条线并行推进同一格进度，速率相加）
//       blueprintId 线上的蓝图 id（line.blueprintId）
//       labor       本 tick 投入的有效人力 = line.workers × 强度产出倍率
//                   （与 production.js lineRateOf 同口径：workers × intensityMul，
//                    不含建筑数量效率 / 殖民管理加成）
//       dt          步长（秒）
//       powerRatio  电力降速比 0~1（取 inst.powerInfo.ratio）
//       acc         账号对象；进度满 1 时扣装备与电力设施库存并 push acc.ships，
//                   省略则只推进度、不产出
//
//   返回本 tick 的进度增量（0~1）。进度满 1 且 shipBuildCheck 通过 → 下水；
//   缺料（装备或电力设施库存）则卡在 1−ε 等待补件，UI 显示缺件清单。

// 在账号里按 id 找蓝图（兼容「只有单张 acc.blueprint」的老数据）
export function findBlueprint(acc, blueprintId) {
  if (!acc) return null;
  if (Array.isArray(acc.blueprints)) {
    const f = acc.blueprints.find((b) => b.id === blueprintId);
    if (f) return f;
  }
  if (acc.blueprint && (acc.blueprint.id === blueprintId || !blueprintId)) return acc.blueprint;
  return null;
}

// 一张蓝图的总工作量（人·秒）。
// v0.0.8：在「外壳 + 各引擎 + 各部件」单件工作量之和的基础上，再叠加
//   「基础 6000 + 外壳容量 × 12」（容量越大越久）与「部件总工作量 × 1.5」，
//   让大型飞船明显更久。公式：6000 + capacity×12 + 部件总 work×1.5。
export function blueprintBuildCost(bp) {
  if (!bp) return 0;
  const hull = PART_BY_ID[bp.hullId];
  const cap = hull ? hull.capacity : 0;
  let partWork = 0;
  if (bp.hullId) partWork += craftWorkOf(bp.hullId);
  for (const e of (bp.engines || [])) partWork += craftWorkOf(e.id);
  for (const p of (bp.parts || [])) partWork += craftWorkOf(p.id);
  return Math.round(6000 + cap * 12 + partWork * 1.5);
}

// 蓝图所需的电力设施清单（{ facilityId: 数量 }）。
// battery_*/solar_* 等不在 PART_BY_ID、不占装备库存，由 inst.facilityStock
// （建造车间产出）单独把关：开工/下水前必须先在建造车间把它们造好。
function powerFacilityNeeds(bp) {
  const need = {};
  for (const p of (bp.parts || [])) {
    if (p && POWER_FACILITY_BY_ID[p.id]) need[p.id] = (need[p.id] || 0) + 1;
  }
  return need;
}

// 校验某蓝图能否开工：
//   返回 { ok, reasons: [], missing: [{ key, partId, material, need, have }], cost }
//   ① 蓝图存在 ② 部件解锁（isPartUnlocked，只认 t_e3）③ 装备库存够不够（逐件核对）
//   ③b 电力设施库存（v0.1.1，inst.facilityStock）④ 容量/结构合法（evaluateBlueprint）。
// 电力设施（battery_*/solar_*/...）不在 PART_BY_ID，不占装备库存、不参与解锁校验，
// 其库存由 facilityStock 体系把关（见 powerFacilityNeeds）。
export function shipBuildCheck(inst, acc, blueprintId) {
  const reasons = [];
  const missing = [];
  const bp = findBlueprint(acc, blueprintId);
  if (!bp) {
    reasons.push('蓝图不存在：' + (blueprintId || '（未指定）'));
    return { ok: false, reasons, missing, cost: 0 };
  }
  const researched = new Set(Array.isArray(acc && acc.tech) ? acc.tech : []);

  // ② 解锁校验（仅 ship_parts）
  const ids = [bp.hullId, ...(bp.engines || []).map((e) => e.id), ...(bp.parts || []).map((p) => p.id)];
  for (const id of ids) {
    const base = PART_BY_ID[id];
    if (!base) continue;                 // 电力设施跳过
    if (!isPartUnlocked(id, researched)) reasons.push('部件未解锁：' + id);
  }

  // ③ 装备库存校验（仅 ship_parts）
  const need = [{ id: bp.hullId, material: bp.hullMaterial }];
  for (const e of (bp.engines || [])) need.push({ id: e.id, material: e.material });
  for (const p of (bp.parts || [])) need.push({ id: p.id, material: p.material });
  for (const it of need) {
    const base = PART_BY_ID[it.id];
    if (!base) continue;                 // 电力设施不占装备库存
    const have = equipmentCount(inst, it.id, it.material);
    if (have < 1) {
      missing.push({
        key: equipKey(it.id, it.material),
        partId: it.id,
        material: it.material == null ? null : it.material,
        need: 1,
        have,
      });
    }
  }

  // ③b 电力设施库存校验（v0.1.1，inst.facilityStock；battery_*/solar_* 等）
  const pfacNeed = powerFacilityNeeds(bp);
  const stock = (inst && inst.facilityStock && typeof inst.facilityStock === 'object') ? inst.facilityStock : {};
  for (const id in pfacNeed) {
    const have = Math.floor(Number(stock[id]) || 0);
    if (have < pfacNeed[id]) {
      missing.push({ key: 'pfac:' + id, partId: id, material: null, need: pfacNeed[id], have });
    }
  }

  // ④ 容量 / 结构合法
  const ev = evaluateBlueprint(bp, { researched, ships: (acc && acc.ships) || [] });
  if (!ev.ok) for (const e of ev.errors) reasons.push(e);

  const cost = blueprintBuildCost(bp);
  return { ok: reasons.length === 0 && missing.length === 0, reasons, missing, cost };
}

// 推进一条蓝图生产线一个 tick。
// 参数：inst（星球实例，进度存 inst.shipProgress）、blueprintId、labor（本 tick 投入人力）、
//       dt（秒）、powerRatio（电力降速比 0~1），acc 可选（产出飞船用）。
// 返回本 tick 的进度增量（0~1）。进度满 1 时：校验通过则扣装备库存 + createShip +
// 把飞船 push 进 acc.ships，并清零该蓝图进度；校验不通过（料不足）则卡在接近满不完成。
export function shipBuildTick(inst, blueprintId, labor, dt, powerRatio, acc) {
  if (!inst || !blueprintId) return 0;
  const bp = findBlueprint(acc, blueprintId);
  if (!bp) return 0;
  if (!inst.shipProgress || typeof inst.shipProgress !== 'object') inst.shipProgress = {};

  const C = blueprintBuildCost(bp);
  if (!(C > 0)) { inst.shipProgress[blueprintId] = 0; return 0; }

  const ratio = Number.isFinite(Number(powerRatio)) ? Number(powerRatio) : 1;
  const eff = (Number(labor) || 0) * (Number(dt) || 0) * ratio;
  const inc = Math.min(eff / C, 1);

  const oldProg = Number(inst.shipProgress[blueprintId] || 0);
  let target = oldProg + inc;
  let delta = inc;

  if (target >= 1) {
    const chk = shipBuildCheck(inst, acc, blueprintId);
    if (chk.ok) {
      // 扣装备库存（逐件整笔扣）
      const need = [{ id: bp.hullId, material: bp.hullMaterial }];
      for (const e of (bp.engines || [])) need.push({ id: e.id, material: e.material });
      for (const p of (bp.parts || [])) need.push({ id: p.id, material: p.material });
      for (const it of need) {
        const base = PART_BY_ID[it.id];
        if (!base) continue;
        consumeEquipment(inst, it.id, it.material, 1);
      }
      // 下水同时扣电力设施库存（battery_*/solar_*，v0.1.1）
      const pfacNeed = powerFacilityNeeds(bp);
      if (Object.keys(pfacNeed).length) {
        if (!inst.facilityStock || typeof inst.facilityStock !== 'object') inst.facilityStock = {};
        for (const id in pfacNeed) {
          const left = (Number(inst.facilityStock[id]) || 0) - pfacNeed[id];
          if (left > 0) inst.facilityStock[id] = left;
          else delete inst.facilityStock[id];
        }
      }
      const res = createShip(bp, { researched: new Set(acc && acc.tech ? acc.tech : []), ships: acc.ships });
      if (res.ok) acc.ships.push(res.ship);
      inst.shipProgress[blueprintId] = 0;
      delta = 1 - oldProg;             // 本 tick 把剩余进度吃完
    } else {
      // 料不足：卡在 1 - ε，不完成（UI 会显示缺件）
      target = Math.min(target, 1 - 1e-6);
      inst.shipProgress[blueprintId] = target;
      delta = target - oldProg;
    }
  } else {
    inst.shipProgress[blueprintId] = target;
    delta = target - oldProg;
  }
  return delta;
}

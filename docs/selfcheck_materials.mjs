// 数据完整性自检：星球资源 / 建筑造价 / 材料表 交叉比对
// 用法：node docs/selfcheck_materials.mjs
import { PLANETS } from '../js/data/planets.js?v=59.10';
import { MATERIALS } from '../js/data/materials.js?v=59.10';
import { BUILDINGS } from '../js/data/buildings.js?v=59.10';
import { FUELS } from '../js/data/fuels.js?v=59.10';
import { TECHS } from '../js/data/techs.js?v=59.10';

const matNames = new Set(MATERIALS.map(m => m.nameCn));
const matIds = new Set();
const dupId = [];
for (const m of MATERIALS) {
  if (matIds.has(m.id)) dupId.push(m.id);
  matIds.add(m.id);
}

// 1) 星球上出现的所有资源名
const planetRes = new Set();
for (const p of PLANETS) {
  for (const layer of ['surface', 'underground', 'core']) {
    for (const r of (p.layers?.[layer] || [])) planetRes.add(r.name);
  }
  for (const g of (p.gases || [])) planetRes.add(g.name);
  for (const f of (p.fuels || [])) planetRes.add(f.name);
}

// 2) 建筑造价用到的材料名
const costRes = new Set();
for (const b of BUILDINGS) for (const k of Object.keys(b.baseCost)) costRes.add(k);

const missPlanet = [...planetRes].filter(n => !matNames.has(n));
const missCost = [...costRes].filter(n => !matNames.has(n));
const missFuel = FUELS.filter(f => !matNames.has(f.nameCn)).map(f => f.nameCn);

console.log('材料表条目数:', MATERIALS.length);
console.log('重复 id:', dupId.length ? dupId : '无');
console.log('星球资源名总数:', planetRes.size, '| 材料表查不到的:', missPlanet.length ? missPlanet : '无');
console.log('建筑造价用到的材料:', costRes.size, '| 查不到的:', missCost.length ? missCost : '无');
console.log('燃料在材料表中缺失:', missFuel.length ? missFuel : '无');

// 3) 建筑 / 科技 / 燃料 基本断言
const techIds = new Set(TECHS.map(t => t.id));
const badUnlock = BUILDINGS.filter(b => b.unlockTech && !techIds.has(b.unlockTech)).map(b => b.id);
const badPrereq = [];
for (const t of TECHS) for (const p of (t.prereq || [])) if (!techIds.has(p)) badPrereq.push(t.id + '->' + p);
const badAttr = MATERIALS.filter(m =>
  ![m.strength, m.durability, m.density, m.fineness, m.molarHeatCapacity, m.meltingPointK].every(v => Number.isFinite(v))
).map(m => m.nameCn);

console.log('建筑数:', BUILDINGS.length, '| 科技数:', TECHS.length, '| 燃料数:', FUELS.length);
console.log('非法 unlockTech:', badUnlock.length ? badUnlock : '无');
console.log('非法 prereq:', badPrereq.length ? badPrereq : '无');
console.log('属性非有限数的材料:', badAttr.length ? badAttr : '无');

// ---------------------------------------------------------------------------
// v0.0.6：配方表 / 电力设施表 也要做同样的三角交叉比对
// ---------------------------------------------------------------------------
// 这两张表是 v0.0.6 新增的，同样会出现「写了个不存在的材料名」这类硬错误，
// 而且配方表一旦引用了不存在的材料，生产链会静默地什么都不产（最难查的那种 bug）。
let recipeBad = [];
let facBad = [];
let recipeCount = 0;
let facCount = 0;
let dupRecipeId = [];

try {
  const { RECIPES } = await import('../js/data/recipes.js?v=59.10');
  recipeCount = RECIPES.length;
  const ids = new Set();
  const knownRes = new Set([...matNames, ...planetRes]);
  for (const r of RECIPES) {
    if (ids.has(r.id)) dupRecipeId.push(r.id);
    ids.add(r.id);
    for (const k of Object.keys(r.inputs || {})) {
      if (!knownRes.has(k)) recipeBad.push(`${r.id} 的输入「${k}」查不到`);
    }
    for (const k of Object.keys(r.outputs || {})) {
      if (!knownRes.has(k)) recipeBad.push(`${r.id} 的输出「${k}」查不到`);
    }
    // 建筑 id 必须真实存在（producesFacility 的配方 output 可以为空）
    if (!BUILDINGS.some((b) => b.id === r.buildingId)) {
      recipeBad.push(`${r.id} 的 buildingId「${r.buildingId}」不是真实建筑`);
    }
    if (!(Number(r.work) > 0)) recipeBad.push(`${r.id} 的 work 必须为正数`);
  }
} catch (e) {
  recipeBad.push('无法加载 js/data/recipes.js: ' + e.message);
}

try {
  const { POWER_FACILITIES } = await import('../js/data/facilities.js?v=59.10');
  facCount = POWER_FACILITIES.length;
  const ids = new Set();
  const knownRes = new Set([...matNames, ...planetRes]);
  for (const f of POWER_FACILITIES) {
    if (ids.has(f.id)) facBad.push(`设施 id 重复：${f.id}`);
    ids.add(f.id);
    for (const k of Object.keys(f.baseCost || {})) {
      if (!knownRes.has(k)) facBad.push(`${f.id} 造价里的「${k}」查不到`);
    }
    if (!(Number(f.work) > 0)) facBad.push(`${f.id} 的 work 必须为正数`);
    if (!['storage', 'solar', 'wind', 'thermal'].includes(f.kind)) facBad.push(`${f.id} 的 kind「${f.kind}」非法`);
  }
  // 12 项：4 类 × 3 尺寸
  if (POWER_FACILITIES.length !== 12) facBad.push(`电力设施应恰好 12 项（4 类 × 3 尺寸），实际 ${POWER_FACILITIES.length}`);
  for (const kind of ['battery', 'solar', 'wind', 'thermal']) {
    for (const size of ['s', 'm', 'l']) {
      if (!ids.has(`${kind}_${size}`)) facBad.push(`缺少设施 ${kind}_${size}`);
    }
  }
} catch (e) {
  facBad.push('无法加载 js/data/facilities.js: ' + e.message);
}

console.log('配方数:', recipeCount, '| 重复配方 id:', dupRecipeId.length ? dupRecipeId : '无');
console.log('配方里的非法材料/建筑:', recipeBad.length ? recipeBad : '无');
console.log('电力设施数:', facCount, '| 设施问题:', facBad.length ? facBad : '无');

// 储电站必须存在，且它的建材必须是 T0（否则「要电才能建储能」死锁）
const SP = BUILDINGS.find((b) => b.id === 'storage_plant');
if (!SP) {
  console.log('储电站建筑: 缺失！');
} else {
  const T0 = new Set(['有机质', '泥土', '石头', '水']);
  const notT0 = Object.keys(SP.baseCost).filter((k) => !T0.has(k));
  console.log('储电站: 设施槽', SP.facilitySlots, '| 非 T0 建材:', notT0.length ? notT0 : '无');
  if (notT0.length) facBad.push('储电站造价含非 T0 材料：' + notT0.join('、'));
}

console.log(missPlanet.length === 0 && missCost.length === 0 && dupId.length === 0 && badUnlock.length === 0
  && badPrereq.length === 0 && recipeBad.length === 0 && facBad.length === 0
  ? '\n自检通过' : '\n存在问题，见上');

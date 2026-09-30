// 生产核心逻辑（Astrix v0.0.6）
// 纯算法模块，零依赖，浏览器直接 import。
//
// 契约来源：docs/TODO_v0.0.6.md 第 1.4 节（冻结接口）。
//
// 重要约定（来自任务分配）：
//   * 严禁 import js/core/state.js（state.js 会 import 本模块，互 import 会循环）。
//   * 物品栏 / 人口对象都直接从传入的 inst 上读：
//       inst.inventory（数组，条目 { mat, layer, owned, rate, reserve, remaining, abundance, locked }）
//       inst.pop（{ total, happiness, assignments: { [jobId]: { count, intensityId } } }）
//       inst.recipes（本模块负责维护：{ [buildingId]: recipeId }）
//       inst.buildings（{ [buildingId]: 已建成座数 }）
//   * 不修改 state.js / ui/* / data/buildings.js / data/materials.js / data/facilities.js /
//     data/techs.js / version.js / index.html。

import { RECIPES, RECIPE_BY_ID, recipesOfBuilding, getRecipe } from '../data/recipes.js?v=20.14';
import { jobsOfBuilding, getIntensity, getAvailable, buildingSlots, jobOutput } from './population.js?v=20.14';
import { MATERIALS } from '../data/materials.js?v=20.14';
import { PART_BY_ID, MATERIAL_SLOTS, craftableParts, craftWorkOf } from '../data/ship_parts.js?v=20.14';
import { ARMY_PART_BY_ID, ARMY_BP_BY_ID, ARMY_SLOT_BY_CAT, craftableArmyParts } from '../data/army_parts.js?v=20.14';   // v0.2.0 军事部件
import { POWER_FACILITY_BY_ID } from '../data/facilities.js?v=20.14';
// v0.0.92：殖民管理模式对产出的倍率（自由 1.25 / 剥削 1.60 / 领土 0.85 …）
import { outputMulOf } from './planetgen.js?v=20.14';
import { addEquipment } from './shipyard.js?v=20.14';
// v0.1.2（需求 18/19）：永久升级「冶炼 / 人力」的乘方效果，唯一实现在 data/upgrades.js#upgradeMul
import { upgradeMul } from '../data/upgrades.js?v=20.14';

// nameCn → 材料对象（供 derivedStatsOf 查属性，纯查表不读 inst）
const MATERIAL_BY_NAME = Object.fromEntries(MATERIALS.map((m) => [m.nameCn, m]));

// 气体名单（不算固体，精细加工厂不可精炼）
const GAS_NAMES = new Set(['氮气', '氧气', '氨气', '甲烷', '二氧化碳', '氢气']);

// v0.1.2 R16：生产线（非农田）产出速率统一 ×5。农田由 R10 单独 ×5，不在此叠加。
//   常量只在生产速率处乘一次（tickProduction / productionRates / lineRateOf 三处共用本常量，避免散落魔法数字）。
export const V012_LINE_RATE_MUL = 5;

// ============================================================================
// v0.0.91（需求 4 / 3 / 2）：效率乘数、气体双来源投料、农田岗位驱动
// ============================================================================

// 需求 4：建筑总座数带来的效率乘数（上限 +25%）：
//   效率 = 1 + min(0.25, 0.01 × 建筑总座数)
export function efficiencyBonus(inst) {
  const counts = (inst && inst.buildings) || {};
  let total = 0;
  for (const k in counts) total += Number(counts[k]) || 0;
  return 1 + Math.min(0.25, 0.01 * total);
}

// 是否为气体类材料（投料走气体双来源规则）
function isGasName(name) {
  return GAS_NAMES.has(name);
}

// 气体类材料的「可用量」= 物品栏持有 + 大气层累积（需求 3）
function gasAvailableAmount(inst, mat) {
  const atm = (inst && typeof inst._gasAvailable === 'function') ? inst._gasAvailable(mat) : 0;
  return ownedTotal(inst, mat) + (Number(atm) || 0);
}

// 投料消耗某材料（需求 3 气体双来源规则）：
//   gasDual 为 true（熔炉家族 / bio_factory / 农田的 CO₂）→ 先扣物品栏再扣大气（inst._consumeGas）；
//   否则（chem_lab / 其它）→ 只扣物品栏（spendTotal）。
//   inst._consumeGas 不存在时退化为只扣物品栏，不抛错（老存档兼容）。
function consumeMaterial(inst, mat, amt, gasDual) {
  if (!Number.isFinite(amt) || amt <= 0) return;
  if (gasDual && isGasName(mat) && typeof inst._consumeGas === 'function') {
    inst._consumeGas(mat, amt);            // 先物品栏再大气
    return;
  }
  spendTotal(inst, mat, amt);              // 固体 / chem_lab / 无 _consumeGas → 只扣物品栏
}

// v0.1.2 R11：与 consumeMaterial 同口径扣料，但返回**实际扣掉的量**（spendTotal 的返回值）。
//   气体双来源假设先物品栏后大气、整体足额扣除（返回请求量），供「按实际扣到的最小比例」缩放产出，
//   做到绝不超扣、绝不凭空产出。
function consumeMaterialAmount(inst, mat, amt, gasDual) {
  if (!Number.isFinite(amt) || amt <= 0) return 0;
  if (gasDual && isGasName(mat) && typeof inst._consumeGas === 'function') {
    inst._consumeGas(mat, amt);
    return amt;
  }
  return spendTotal(inst, mat, amt);
}

// ============================================================================
// 玩家为每座加工建筑选定的「工作内容」
// ============================================================================

// 惰性初始化 inst.recipes，返回该建筑当前选中的配方对象（未选返回 null）
// v0.0.6 收尾批：改用 resolveRecipe，不再直接查 RECIPE_BY_ID——
//   否则精细加工厂的「任选固体材料二合一」（refine_*）与玩家自建材料（r_custom_*）会被直接拒掉。
export function selectedRecipeOf(inst, buildingId) {
  if (!inst) return null;
  if (!inst.recipes || typeof inst.recipes !== 'object') inst.recipes = {};
  const id = inst.recipes[buildingId];
  return id ? resolveRecipe(inst, id) : null;
}

// 校验配方确实属于该建筑；通过则写入并返回 true，否则 false
export function selectRecipe(inst, buildingId, recipeId) {
  if (!inst) return false;
  if (!inst.recipes || typeof inst.recipes !== 'object') inst.recipes = {};
  const r = resolveRecipe(inst, recipeId);
  if (!r || r.buildingId !== buildingId) return false;
  inst.recipes[buildingId] = recipeId;
  return true;
}

// 清除某建筑的工作内容；存在并已清除返回 true，否则 false
export function clearRecipe(inst, buildingId) {
  if (!inst || !inst.recipes || typeof inst.recipes !== 'object') return false;
  if (!(buildingId in inst.recipes)) return false;
  delete inst.recipes[buildingId];
  return true;
}

// ============================================================================
// v0.0.6 收尾批：动态配方（refine_* / r_custom_*）与自定义材料
// ============================================================================
// 设计者要求：
//   ① 精细加工厂可以选**任一种固体材料**进行二合一（不再是写死的铁/铜/钢/钛）；
//   ② 自定义化工厂可以**新建一种材料**：自选任意数目原料、任意比例，
//      系统按比例与原料属性**推算新材料的数值**。
// 这两类配方都不在静态的 RECIPES 表里，所以把查表封成 resolveRecipe 统一解析。

// 惰性初始化玩家自建材料表
// 结构：{ [key]: { material, recipe } }
export function customMaterialsOf(inst) {
  if (!inst) return {};
  if (!inst.customMaterials || typeof inst.customMaterials !== 'object' || Array.isArray(inst.customMaterials)) {
    inst.customMaterials = {};
  }
  return inst.customMaterials;
}

// 查材料属性用的合并表：内置材料 + 玩家自建材料
// （这样自建材料也能当另一个自建材料的原料，不会算成 0）
export function materialLookup(inst) {
  const out = { ...MATERIAL_BY_NAME };
  const t = customMaterialsOf(inst);
  for (const k in t) {
    const m = t[k] && t[k].material;
    if (m && m.nameCn) out[m.nameCn] = m;
  }
  return out;
}

// ============================================================================
// 精细度显示（v0.1.0）
// 规则：材料名 + "+" + (精细度 − 1)，只在精细度 > 1 时加后缀；精细度 1 显示原名。
//   精细度从 js/data/materials.js 查（自定义材料从 inst.customMaterials 查，查不到按 1）。
// 供 UI（inventory.js）复用，避免两边各写一套。
// ============================================================================
function materialFinenessOf(inst, matName) {
  const m = materialLookup(inst)[matName];
  return m ? (Number(m.fineness) || 1) : 1;
}

export function materialLabel(inst, matName) {
  const f = materialFinenessOf(inst, matName);
  return f > 1 ? matName + '+' + (f - 1) : matName;
}

// 统一解析一个配方 id → recipe 对象；解析不到返回 null
export function resolveRecipe(inst, recipeId) {
  if (!recipeId || typeof recipeId !== 'string') return null;
  // 1) 内置配方表
  if (RECIPE_BY_ID[recipeId]) return RECIPE_BY_ID[recipeId];
  // 2) 精炼配方 refine_<材料名>：只在该材料确实出现在物品栏里时才算合法
  //    （防止手改存档塞一个不存在的 refine_xxx 进来）
  if (recipeId.startsWith('refine_')) {
    const mat = recipeId.slice('refine_'.length);
    if (!mat || !findEntry(inst, mat)) return null;
    return refinePair(mat);
  }
  // 3) 玩家自建材料配方 r_custom_<key>
  if (recipeId.startsWith('r_custom_')) {
    const key = recipeId.slice('r_custom_'.length);
    const rec = customMaterialsOf(inst)[key];
    return rec && rec.recipe ? rec.recipe : null;
  }
  // 4) v0.0.7 部件配方 part_<部件id>：外壳 / 引擎 / 武器 / 船上设施都在制造车间生产。
  //    产出不走 outputs，而是产出一件「装备库存」（inst.equipment，形状由 core/shipyard.js 维护）。
  //    材料由玩家在新建生产线时选定（line.material），单件消耗 = 按部件质量折算的材料份数。
  if (recipeId.startsWith('part_')) {
    return partRecipe(recipeId.slice('part_'.length));
  }
  return null;
}

// 部件配方（v0.0.7）：work 取自 ship_parts.craftWorkOf，投入材料由生产线选定，
// 所以 inputs 留空、由 tickProduction 按 line.material 换算后扣料。
export const PART_AMOUNT_PER_MASS = 1;      // 每 1 单位质量折算 1 份所选材料
export function partAmountOf(partId) {
  if (ARMY_PART_BY_ID[partId]) return 0;   // 军事部件投料固定，不走质量折算
  const p = PART_BY_ID[partId];
  if (!p) return 0;
  const mass = Number(p.category === 'hull' ? (p.emptyMass ?? p.mass) : p.mass) || 0;
  return Math.max(2, Math.ceil(mass * PART_AMOUNT_PER_MASS));
}
export function partRecipe(partId) {
  const p = PART_BY_ID[partId];
  if (!p) {
    // v0.2.0：军事部件（army_parts）——固定单一材料配方，不走材料自选
    const ap = ARMY_PART_BY_ID[partId];
    if (!ap) return null;
    return {
      id: 'part_' + partId,
      buildingId: 'fabricator',
      nameCn: '制造：' + ap.nameCn,
      inputs: Object.assign({}, ap.inputs || {}),   // 固定投料
      outputs: {},
      work: ap.work || 300,
      producesPart: partId,
      armyPart: true,
      desc: '在制造车间生产一件军事部件「' + ap.nameCn + '」，产出进入装备库存（' + (ap.desc || '') + '）。',
      byproductNote: '',
    };
  }
  return {
    id: 'part_' + partId,
    buildingId: 'fabricator',
    nameCn: '制造：' + p.nameCn,
    inputs: {},                       // 由 line.material 决定，见 partInputsOf
    outputs: {},                      // 产出为装备库存，不是物品栏材料
    work: craftWorkOf(partId) || 300,
    producesPart: partId,
    desc: '在制造车间按选定材料生产一件「' + p.nameCn + '」，产出进入装备库存。',
    byproductNote: '',
  };
}
// 某部件配方在指定材料下的实际投料：{ 材料名: 份数 }
export function partInputsOf(partId, material) {
  const ap = ARMY_PART_BY_ID[partId];
  if (ap) {
    // v0.2.4：军事部件投料 = 固定辅料 + 所选材料 × 部件质量（材料本身也是原料）
    const base = Object.assign({}, ap.inputs || {});
    if (material) base[material] = (base[material] || 0) + (Number(ap.mass) || 0);
    return base;
  }
  if (!material) return {};
  const n = partAmountOf(partId);
  return n > 0 ? { [material]: n } : {};
}

// 玩家当前所有自建材料（UI 用），形如 [{ key, material, recipe }]
export function listCustomMaterials(inst) {
  const t = customMaterialsOf(inst);
  return Object.keys(t)
    .filter((k) => t[k] && t[k].material && t[k].recipe)
    .map((k) => ({ key: k, material: t[k].material, recipe: t[k].recipe }))
    .sort((a, b) => a.material.nameCn.localeCompare(b.material.nameCn, 'zh'));
}

// 玩家可精炼的固体材料：物品栏里 owned >= 2、且不是气体。
// 「固体」判定（已冻结）：排除 氮气/氧气/氨气/甲烷/二氧化碳/氢气。
export function listRefinableMaterials(inst) {
  if (!inst || !Array.isArray(inst.inventory)) return [];
  // v0.0.61：同一材料可能有多层条目，先按材料名聚合持有量，避免同一种材料重复出现
  const agg = new Map();
  for (const e of inst.inventory) {
    if (!e || !e.mat) continue;
    if (GAS_NAMES.has(e.mat)) continue;
    agg.set(e.mat, (agg.get(e.mat) || 0) + (Number(e.owned) || 0));
  }
  const out = [];
  for (const [mat, owned] of agg) {
    if (!(owned >= 2)) continue;
    out.push({ mat, owned, stats: MATERIAL_BY_NAME[mat] || null });
  }
  return out.sort((a, b) => a.mat.localeCompare(b.mat, 'zh'));
}

// ============================================================================
// 推导公式（**冻结**，UI 用它做实时预览，必须与后端完全一致）
// ============================================================================
//   frac_i = amt_i / Σamt                         （Σfrac = 1）
//   n      = 原料种数
//   协同加成 S = 1 + 0.06 × (n − 1)                 // 2 种 +6%，5 种 +24%
//   strength          = Σ(frac_i × strength_i)   × S
//   durability        = Σ(frac_i × durability_i) × S
//   density           = Σ(frac_i × density_i)        // 不加成（体积直觉）
//   meltingPointK     = Σ(frac_i × meltingPointK_i)  // 按比例折中
//   molarHeatCapacity = Σ(frac_i × molarHeatCapacity_i)
//   fineness          = 1 + floor(n / 3)             // 3 种 +1，6 种 +2
// 输入含查不到的材料时按 0 计 —— 绝不让 NaN 漏出去污染存档。
export function derivedStatsOf(parts, lookup) {
  const L = lookup || MATERIAL_BY_NAME;
  const zero = { strength: 0, durability: 0, density: 0, fineness: 1, molarHeatCapacity: 0, meltingPointK: 0 };
  const list = (Array.isArray(parts) ? parts : [])
    .map((p) => ({ mat: String((p && p.mat) || '').trim(), amt: Number((p && p.amt) || 0) }))
    .filter((p) => p.mat && Number.isFinite(p.amt) && p.amt > 0);
  if (!list.length) return zero;
  const total = list.reduce((s, p) => s + p.amt, 0);
  if (!(total > 0)) return zero;

  const n = list.length;
  const synergy = 1 + 0.06 * (n - 1);
  let strength = 0;
  let durability = 0;
  let density = 0;
  let heat = 0;
  let melt = 0;
  for (const p of list) {
    const f = p.amt / total;
    const m = L[p.mat] || null;
    const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);
    strength += f * (m ? num(m.strength) : 0);
    durability += f * (m ? num(m.durability) : 0);
    density += f * (m ? num(m.density) : 0);
    heat += f * (m ? num(m.molarHeatCapacity) : 0);
    melt += f * (m ? num(m.meltingPointK) : 0);
  }
  const r2 = (v) => Math.round(v * 100) / 100;
  return {
    strength: r2(strength * synergy),
    durability: r2(durability * synergy),
    density: r2(density),
    fineness: 1 + Math.floor(n / 3),
    molarHeatCapacity: Math.round(heat),
    meltingPointK: Math.round(melt),
  };
}

// 自建材料的原料总量门槛（与复合资源同一水平）
export const CUSTOM_AMT_MIN = 8;
export const CUSTOM_AMT_MAX = 16;

// 由名字生成一个稳定、可用于 id 的短串（重名自动加 _2 / _3…）
function makeCustomKey(name, taken) {
  let base = String(name).trim().toLowerCase()
    .replace(/\s+/g, '_')
    .replace(/[^0-9a-z_\u4e00-\u9fa5]/g, '');
  if (!base) base = 'cm';
  let key = base;
  let i = 2;
  while (taken.has(key)) { key = base + '_' + i; i += 1; }
  return key;
}

// 新建一种自定义材料。
// name 名字；parts = [{ mat, amt }]。
// 成功 → { ok:true, key, material, recipe }；失败 → { ok:false, reason:'中文原因' }
export function makeCustomMaterial(inst, name, parts) {
  if (!inst) return { ok: false, reason: '星球数据缺失。' };
  const nm = String(name == null ? '' : name).trim();
  if (!nm) return { ok: false, reason: '请先给新材料起个名字。' };
  // v0.1.0：服务端校验 —— 名称只能使用文字或字母（数字 / 符号 / 空格一律拒绝）
  if (!/^[\u4e00-\u9fa5A-Za-z]+$/.test(nm)) {
    return { ok: false, reason: '名称只能使用文字或字母' };
  }
  // 不得与已有材料重名（内置材料 + 玩家已有的自定义材料）；放在长度校验之前，
  //   使「铁」这类既是 1 字、又是已有名字的情况优先报「重名」而非「太短」。
  if (MATERIAL_BY_NAME[nm]) return { ok: false, reason: '「' + nm + '」与已有材料重名，请换一个名字。' };
  const table = customMaterialsOf(inst);
  for (const k in table) {
    const m = table[k] && table[k].material;
    if (m && m.nameCn === nm) return { ok: false, reason: '「' + nm + '」与已有的自定义材料重名，请换一个名字。' };
  }
  // 名称长度 2~12 个字符
  if (nm.length < 2 || nm.length > 12) {
    return { ok: false, reason: nm.length < 2 ? '材料名至少 2 个字，请加长一些。' : '材料名最长 12 个字，请缩短一些。' };
  }

  const seen = new Set();
  const list = [];
  for (const p of (Array.isArray(parts) ? parts : [])) {
    const mat = String((p && p.mat) || '').trim();
    if (!mat) continue;
    const amt = Math.floor(Number((p && p.amt) || 0));
    if (!(amt >= 1)) return { ok: false, reason: '「' + mat + '」的数量必须是不小于 1 的整数。' };
    if (seen.has(mat)) return { ok: false, reason: '「' + mat + '」重复出现了，请合并成一行。' };
    seen.add(mat);
    list.push({ mat, amt });
  }
  if (list.length < 2) return { ok: false, reason: '至少要选用 2 种原料。' };

  const total = list.reduce((s, p) => s + p.amt, 0);
  if (total < CUSTOM_AMT_MIN) {
    return { ok: false, reason: '原料总量至少 ' + CUSTOM_AMT_MIN + '（当前 ' + total + '）。' };
  }
  if (total > CUSTOM_AMT_MAX) {
    return { ok: false, reason: '原料总量最多 ' + CUSTOM_AMT_MAX + '（当前 ' + total + '）。' };
  }

  for (const p of list) {
    const known = MATERIAL_BY_NAME[p.mat] || customMaterialsOf(inst)[p.mat];
    const have = ownedTotal(inst, p.mat);
    // v0.0.61：存在性看「材料表里认不认得」，持有量看「跨层总量」
    if (!known && !findEntry(inst, p.mat)) {
      return { ok: false, reason: '材料「' + p.mat + '」不存在。' };
    }
    if (have + 1e-9 < p.amt) {
      return { ok: false, reason: '「' + p.mat + '」不足：需要 ' + p.amt + '，现有 ' + Math.floor(have) + '。' };
    }
  }

  const stats = derivedStatsOf(list, materialLookup(inst));
  const key = makeCustomKey(nm, new Set(Object.keys(table)));
  const desc = '自定义材料：由 ' + list.map((p) => p.mat + '×' + p.amt).join('、') + ' 按比例合成。';
  const material = {
    id: 'cm_' + key,
    nameCn: nm,
    nameEn: nm,
    category: 'composite',
    strength: stats.strength,
    durability: stats.durability,
    density: stats.density,
    fineness: stats.fineness,
    molarHeatCapacity: stats.molarHeatCapacity,
    meltingPointK: stats.meltingPointK,
    special: '自定义合成',
    description: desc,
    derivedFrom: list.map((p) => ({ mat: p.mat, amt: p.amt })),
  };
  const recipe = {
    id: 'r_custom_' + key,
    buildingId: 'custom_chem',
    nameCn: list.map((p) => p.mat + ' ×' + p.amt).join(' + ') + ' → ' + nm,
    inputs: Object.fromEntries(list.map((p) => [p.mat, p.amt])),
    outputs: { [nm]: 1 },
    work: 320,
    desc,
    custom: true,
  };
  table[key] = { material, recipe };
  return { ok: true, key, material, recipe };
}

// 删除一种自定义材料（同时清掉指向它的已选工作内容，避免悬空 id）
export function removeCustomMaterial(inst, key) {
  const table = customMaterialsOf(inst);
  if (!table[key]) return false;
  delete table[key];
  if (inst.recipes && inst.recipes.custom_chem === 'r_custom_' + key) delete inst.recipes.custom_chem;
  return true;
}

// ============================================================================
// 物品栏条目：取 / 建
// ============================================================================

// 在 inst.inventory 里找 mat === matName 的条目；没有就新建。
// 新建条目结构必须与 state.js 的 buildPlanetInventory 一致：
//   { mat, layer:'refined', owned:0, rate:0, reserve:0, remaining:0, abundance:1, locked:false }
// 注：layer 允许新值 'refined'（加工产物），不污染 surface/underground/core/gas 语义。
// 新建时 reserve 用 0，避免它出现在「星球储藏」栏（储藏栏筛选条件 remaining > 0）。
export function ensureEntry(inst, matName, layer) {
  if (!inst) return null;
  if (!inst.inventory || !Array.isArray(inst.inventory)) inst.inventory = [];
  const e = inst.inventory.find((x) => x && x.mat === matName);
  if (e) return e;
  const entry = {
    mat: matName,
    layer: layer || 'refined',
    owned: 0,
    rate: 0,
    reserve: 0,
    remaining: 0,
    abundance: 1,
    locked: false,
  };
  inst.inventory.push(entry);
  return entry;
}

// 找已有条目（不新建）；找不到返回 null
function findEntry(inst, matName) {
  if (!inst || !inst.inventory) return null;
  return inst.inventory.find((x) => x && x.mat === matName) || null;
}

// ============================================================================
// 跨层聚合（v0.0.61，需求 1）
// ============================================================================
// 同一材料可能同时存在地表 / 地下 / 地核三条条目（如所有星球的「石头」）。
// 加工配方的投料与库存判定必须跨层求和、跨层扣减，不能再假设「一种材料只有一条」。
export function ownedTotal(inst, matName) {
  let s = 0;
  for (const e of (inst.inventory || [])) if (e && e.mat === matName) s += Number(e.owned) || 0;
  return s;
}

// 从持有最多的条目开始扣，扣够为止；返回实际扣掉的量
export function spendTotal(inst, matName, amt) {
  let need = Number(amt) || 0;
  if (!(need > 0)) return 0;
  const list = (inst.inventory || [])
    .filter((e) => e && e.mat === matName)
    .sort((a, b) => (Number(b.owned) || 0) - (Number(a.owned) || 0));
  let taken = 0;
  for (const e of list) {
    if (need <= 1e-12) break;
    const have = Math.max(0, Number(e.owned) || 0);
    const use = Math.min(have, need);
    e.owned = have - use;
    taken += use;
    need -= use;
  }
  return taken;
}

// 设施库存：{ [facilityId]: 已造好但未安装的座数 }（惰性初始化）
// 建造车间产出累加到这里；power.js 的 installFacility 从这里扣 1 并安装，
// 拆除时退回这里。两侧都写成「若无则建 {}」，不会冲突。
export function facilityStockOf(inst) {
  if (!inst) return {};
  if (!inst.facilityStock || typeof inst.facilityStock !== 'object') inst.facilityStock = {};
  return inst.facilityStock;
}

// ============================================================================
// 生产线模型（v0.0.7，设计者重点需求）
// ============================================================================
// 设计者原话：「熔炉、化学实验室、制造车间类的，改为生产线模式，人力界面可以新建生产线，
//   先选建筑再选生产内容，合理规划人力，把建筑界面的『选择生产内容』删除」。
//
// 数据结构（已冻结，UI 直接依赖）：
//   inst.lines = [ { id, buildingId, recipeId, material?, workers } ]
//     造船线：{ id, buildingId: 'dock', blueprintId, workers }
//   * 一条线 = 一种生产内容 + 一份人力。同一建筑类型可开多条线（各自生产不同东西）。
//   * 工位口径：同一 buildingId 下所有线的 workers 之和 ≤ 建筑数 × 该建筑工位数。
//   * 强度：沿用全局工作强度，线不单独设（设计者未要求）。
//   * 采集 / 施工 / 科研仍走原有「岗位分配」，不走生产线。
//
// 「任意炉子」：炉类配方（buildingId === 'furnace'，含粘土→陶瓷、石英→玻璃）
//   可以挂在 furnace / blast_furnace 任一种建筑上开线，工位按挂的那种建筑算。
// v0.1.1（需求 14）：火力发电厂改为无人工厂（jobs=0、按座数发电），不再承接炉类生产线，
//   从炉类家族移除——没有工位就派不了人，继续留在家族里只会摆出一排永远开不起来的线。
//   老存档里挂在火力发电厂上的旧线仍可运转（tick 不校验家族），气体双来源口径
//   由下方 GAS_DUAL_BUILDINGS 单独保持，不受家族收缩影响。
export const STATION_FAMILY = { furnace: ['furnace', 'blast_furnace'] };

// 气体双来源的建筑名单（v0.0.91 需求 3）：熔炉家族 + 火力发电厂（老存档兼容）+ 生物工厂
const GAS_DUAL_BUILDINGS = new Set(['furnace', 'blast_furnace', 'thermal_plant', 'bio_factory']);

// 光伏板面材料单件的消耗量（v0.0.7：板材由玩家选，选好后按此数量投料）
const PANEL_AMOUNT = 5;

// 设施配方在当前生产线下的实际投料：面板材料选项外，还可能要投所选板面材料
function facilityInputsOf(recipe, line) {
  const base = Object.assign({}, recipe.inputs || {});
  if (recipe.choiceKind === 'panel' && line && line.material) {
    base[line.material] = (base[line.material] || 0) + PANEL_AMOUNT;
  }
  return base;
}

// 该生产内容能否在这类建筑上生产
export function acceptsStation(recipe, buildingId) {
  if (!recipe || !buildingId) return false;
  if (recipe.buildingId === buildingId) return true;
  const fam = STATION_FAMILY[recipe.buildingId];
  return Array.isArray(fam) && fam.includes(buildingId);
}

// 惰性初始化 inst.lines，并把老存档的 inst.recipes 迁移成生产线（一次性）
//   迁移规则：老模型「某建筑选了一个配方 + 该建筑下岗位有人」→ 一条线，
//   人数 = 该建筑所有岗位的现有人数之和；迁移后把这些岗位清零（人力不重复计算）。
export function ensureLines(inst) {
  if (!inst) return [];
  if (!Array.isArray(inst.lines)) inst.lines = [];
  const legacy = inst.recipes;
  if (legacy && typeof legacy === 'object' && !inst._linesMigrated) {
    for (const buildingId in legacy) {
      const recipeId = legacy[buildingId];
      if (!recipeId || !resolveRecipe(inst, recipeId)) continue;
      let workers = 0;
      // 该建筑原本挂在岗位下的人数（v0.0.6：加工建筑靠岗位有人）。
      // v0.0.9 起加工岗位已从 JOBS 删除，这里兜底按约定命名找回老存档人数。
      const legacyJobIds = jobsOfBuilding(buildingId).map((j) => j.id);
      if (!legacyJobIds.length) {
        for (const suf of ['_worker', '_small', '_medium']) {
          const key = buildingId + suf;
          const a = inst.pop && inst.pop.assignments ? inst.pop.assignments[key] : null;
          if (a && Number(a.count) > 0) legacyJobIds.push(key);
        }
      }
      for (const jobId of legacyJobIds) {
        const a = inst.pop && inst.pop.assignments ? inst.pop.assignments[jobId] : null;
        const c = a && Number(a.count) > 0 ? Math.floor(Number(a.count)) : 0;
        workers += c;
        if (a && c > 0) a.count = 0;            // 迁移后由生产线接管这批人力
      }
      const slot = lineSlotInfo(inst, buildingId);
      workers = Math.min(workers, slot.free);
      if (workers > 0) inst.lines.push({ id: genLineId(), buildingId, recipeId, workers });
    }
    inst.recipes = {};
    inst._linesMigrated = true;
  }
  return inst.lines;
}

export function linesOf(inst, buildingId) {
  if (!inst) return [];
  if (!Array.isArray(inst.lines)) inst.lines = [];
  if (!buildingId) return inst.lines;
  return inst.lines.filter((l) => l && l.buildingId === buildingId);
}

let _lineSeq = 0;
function genLineId() {
  _lineSeq = (_lineSeq + 1) % 100000;
  return 'line_' + Date.now().toString(36) + '_' + _lineSeq;
}

// 全星球生产线占用的人力总数（用于从「可用人力」里扣掉）
export function lineWorkersTotal(inst) {
  return linesOf(inst).reduce((s, l) => s + (Number(l && l.workers) || 0), 0);
}

// 某类建筑的工位情况：total = 建筑数 × 每座工位；used = 该类建筑下所有线的人数之和
export function lineSlotInfo(inst, buildingId) {
  const total = buildingSlots(buildingId, (inst && inst.buildings) || {});
  const used = linesOf(inst, buildingId).reduce((s, l) => s + (Number(l && l.workers) || 0), 0);
  return { total, used, free: Math.max(0, total - used) };
}

// 当前还未被占用的可用人力（岗位 + 生产线 都算占用）
export function freeLaborOf(inst) {
  if (!inst || !inst.pop) return 0;
  return Math.max(0, getAvailable(inst.pop) - lineWorkersTotal(inst));
}

// 新建生产线：先选建筑（buildingId）再选生产内容（recipeId）
//   opts: { workers, material?（部件配方必填，外加入库的装备材料） }
export function addLine(inst, buildingId, recipeId, opts) {
  if (!inst) return { ok: false, reason: '星球数据缺失' };
  // v0.0.91 需求 2：农田由「农田工」岗位驱动产出有机质，不进生产线
  if (buildingId === 'farm') {
    return { ok: false, reason: '农田由农田工岗位驱动，不需要生产线' };
  }
  // v0.2.0 军队组装线：无配方（recipeId=null），按 armyBlueprintId 建线。
  //   v0.2.4：改由「军营」驱动（无工位、不占人力，每座军营提供固定建造人力）；
  //   兼容自定义蓝图（opts.armyBlueprint 对象）与旧存档开在制造车间的线。
  if (opts && (opts.armyBlueprintId || opts.armyBlueprint)) {
    const abp = (opts.armyBlueprint && typeof opts.armyBlueprint === 'object')
      ? opts.armyBlueprint
      : ARMY_BP_BY_ID[opts.armyBlueprintId];
    if (!abp) return { ok: false, reason: '找不到军队蓝图' };
    if (buildingId !== 'barracks' && buildingId !== 'fabricator') {
      return { ok: false, reason: '军队组装线只能开在军营' };
    }
    if (buildingCount(inst, buildingId) <= 0) {
      return { ok: false, reason: buildingId === 'barracks' ? '尚未建成军营' : '尚未建成制造车间' };
    }
    const want = Math.max(0, Math.floor(Number(opts.workers) || 0));
    if (buildingId === 'fabricator') {   // 旧存档兼容：车间线仍校验工位
      const slot = lineSlotInfo(inst, buildingId);
      if (want > slot.free) return { ok: false, reason: '工位不足，还剩 ' + slot.free + ' 个' };
      const free = freeLaborOf(inst);
      if (want > free) return { ok: false, reason: '可用人力不足，还剩 ' + free + ' 人' };
    }
    const aline = { id: genLineId(), buildingId, recipeId: null, armyBlueprintId: abp.id, workers: buildingId === 'barracks' ? 0 : want };
    const wantId = opts.intensityId != null ? opts.intensityId : null;
    if (wantId != null) {
      const iv = getIntensity(wantId);
      if (iv && iv.id === wantId) aline.intensityId = wantId;
    }
    inst.lines.push(aline);
    return { ok: true, line: aline };
  }
  ensureLines(inst);
  if (buildingCount(inst, buildingId) <= 0) {
    return { ok: false, reason: '尚未建成该建筑' };
  }
  const recipe = resolveRecipe(inst, recipeId);
  if (!recipe) return { ok: false, reason: '找不到该生产内容' };
  if (!acceptsStation(recipe, buildingId)) {
    return { ok: false, reason: '该生产内容不能在此建筑上生产' };
  }
  const material = opts && opts.material ? String(opts.material) : null;
  if (recipe.producesPart && !material) {
    return { ok: false, reason: '请先选择生产该部件所用的材料' };
  }
  const want = Math.max(0, Math.floor(Number(opts && opts.workers) || 0));
  const slot = lineSlotInfo(inst, buildingId);
  if (want > slot.free) return { ok: false, reason: '工位不足，还剩 ' + slot.free + ' 个' };
  const free = freeLaborOf(inst);
  if (want > free) return { ok: false, reason: '可用人力不足，还剩 ' + free + ' 人' };
  const line = { id: genLineId(), buildingId, recipeId, workers: want };
  if (material) line.material = material;
  // 单独工作强度：合法 id 直接落盘；非法 id 退回全局（不写该字段，intensityMulOf 自动沿用全局）
  const wantId = opts && opts.intensityId != null ? opts.intensityId : null;
  if (wantId != null) {
    const iv = getIntensity(wantId);
    if (iv && iv.id === wantId) line.intensityId = wantId;
  }
  inst.lines.push(line);
  return { ok: true, line };
}

export function removeLine(inst, lineId) {
  if (!inst || !Array.isArray(inst.lines)) return false;
  const i = inst.lines.findIndex((l) => l && l.id === lineId);
  if (i < 0) return false;
  inst.lines.splice(i, 1);
  return true;
}

// 改某条线的人数；上限 = min(该建筑剩余工位 + 该线现有人数, 剩余可用人力 + 该线现有人数)
export function setLineWorkers(inst, lineId, n) {
  if (!inst || !Array.isArray(inst.lines)) return { ok: false, reason: '没有生产线' };
  const line = inst.lines.find((l) => l && l.id === lineId);
  if (!line) return { ok: false, reason: '找不到该生产线' };
  const want = Math.max(0, Math.floor(Number(n) || 0));
  const own = Number(line.workers) || 0;
  const slot = lineSlotInfo(inst, line.buildingId);
  const capSlot = slot.free + own;
  const capLabor = freeLaborOf(inst) + own;
  const cap = Math.min(capSlot, capLabor);
  if (want > cap) return { ok: false, reason: '最多 ' + cap + ' 人（受工位与可用人力限制）' };
  line.workers = want;
  return { ok: true, workers: want };
}

// 改某条线的工作强度（沿用 population.js 的 WORK_INTENSITY 表）。
// 非法 id 返回 { ok:false, reason }，不改动该线；合法 id 落盘并沿用至后续结算。
export function setLineIntensity(inst, lineId, intensityId) {
  if (!inst || !Array.isArray(inst.lines)) return { ok: false, reason: '没有生产线' };
  const line = inst.lines.find((l) => l && l.id === lineId);
  if (!line) return { ok: false, reason: '找不到该生产线' };
  const iv = getIntensity(intensityId);
  if (!iv || iv.id !== intensityId) return { ok: false, reason: '无效的工作强度' };
  line.intensityId = intensityId;
  return { ok: true };
}

// 某条线每 tick（每秒）的产出次数。powerRatio 省略时读 inst.powerInfo.ratio
// v0.1.1（需求 15）：展示口径与 tickProduction 的实际结算完全一致——
//   ① 非造船线乘上「建筑数量效率 × 殖民管理模式」倍率（实际结算本来就乘）；
//   ② 再乘 tick 时缓存的断供缩减比 line._ratio，原料断供时展示跟着缩减，不再「满速假象」。
export function lineRateOf(inst, line, powerRatio) {
  if (!inst || !line) return 0;
  const ratio = powerRatio === undefined
    ? Number((inst.powerInfo && inst.powerInfo.ratio) ?? 1)
    : Number(powerRatio);
  if (!(ratio > 0)) return 0;
  const recipe = resolveRecipe(inst, line.recipeId);
  if (!recipe) return 0;
  if (line.buildingId !== 'dock' && buildingCount(inst, line.buildingId) <= 0) return 0;
  const workers = Number(line.workers) || 0;
  if (!(workers > 0)) return 0;
  let labor = workers * intensityMulOf(inst, line);
  // 造船线由 shipyard.js 结算（不乘效率/殖民倍率），展示口径保持不变
  if (line.buildingId !== 'dock') labor *= efficiencyBonus(inst) * outputMulOf(inst);
  const cached = Number(line._ratio);
  const supplyRatio = Number.isFinite(cached) ? cached : 1;   // 未跑过 tick 的新线按满速预估
  return (labor * ratio * supplyRatio) / Math.max(1, Number(recipe.work) || 1);
}

// 某条线的工作强度产出倍率（沿用岗位那套强度表）。
// 优先用该线自带的 intensityId；无则该线沿用全局 inst.pop.intensityId。
function intensityMulOf(inst, line) {
  const id = (line && line.intensityId != null)
    ? line.intensityId
    : (inst && inst.pop ? inst.pop.intensityId : null);
  return getIntensity(id).outputMul || 0;
}

// 某建筑当前可选的生产内容（供人力面板「第二步」列出）
//   静态配方 + 炉类家族配方 + 精细加工厂的 refine_<材料> + 自建材料 r_custom_<key> + 制造车间的部件配方
export function recipesForBuilding(inst, buildingId, acc) {
  if (!inst || !buildingId) return [];
  // v0.0.91 需求 2：农田为「岗位驱动」固定配方，不进生产线，故没有任何可选生产线内容
  if (buildingId === 'farm') return [];
  const out = [];
  const push = (r) => {
    if (r && !out.some((x) => x.id === r.id)) out.push(r);
  };
  for (const r of recipesOfBuilding(buildingId)) push(r);
  // 炉类家族：高炉 / 火力发电厂也能干熔炉的活（任意炉子）
  for (const [home, members] of Object.entries(STATION_FAMILY)) {
    if (members.includes(buildingId) && home !== buildingId) {
      for (const r of recipesOfBuilding(home)) push(r);
    }
  }
  // 精细加工厂：每种持有 ≥1 的固体材料一条 refine_<材料>
  if (buildingId === 'refinery') {
    for (const it of listRefinableMaterials(inst)) {
      if (Number(it.owned) >= 1) push(refinePair(it.mat));
    }
  }
  // 自定义化工厂：玩家自建的材料配方
  if (buildingId === 'custom_chem') {
    for (const cm of listCustomMaterials(inst)) push(cm.recipe);
  }
  // 制造车间：部件（外壳 / 引擎 / 武器 / 船上设施）
  if (buildingId === 'fabricator') {
    for (const p of craftableParts()) {
      const r = partRecipe(p.partId);
      if (r) {
        r.materials = (p.materials && p.materials.length) ? p.materials.slice() : [p.defaultMaterial];
        r.defaultMaterial = p.defaultMaterial;
        push(r);
      }
    }
    // v0.2.4：军事部件按材料槽自选材料（复用舰船 MATERIAL_SLOTS），
    //   投料 = 固定辅料 + 所选材料 × 部件质量（见 partInputsOf）；不同材料造出的部件数值不同。
    const tset = new Set((acc && Array.isArray(acc.tech)) ? acc.tech : []);
    for (const ap of craftableArmyParts(tset)) {
      const r = partRecipe(ap.id);
      if (!r) continue;
      const slot = ap.slot || ARMY_SLOT_BY_CAT[ap.cat];
      const mats = (slot && MATERIAL_SLOTS[slot]) ? MATERIAL_SLOTS[slot] : [];
      if (mats.length) {
        r.materials = mats.slice();
        r.defaultMaterial = '铁';
        r.choiceHint = '部件材料（军队数值不同）';
      }
      push(r);
    }
  }
  // v0.0.7：设施配方的「可选材料」——光伏选板面建材（效率不同）、超大型燃机选燃料
  for (const r of out) {
    if (!r.producesFacility) continue;
    const f = POWER_FACILITY_BY_ID[r.producesFacility];
    if (!f) continue;
    if (Array.isArray(f.panelOptions) && f.panelOptions.length) {
      r.materials = f.panelOptions.map((o) => o.mat);
      r.defaultMaterial = f.panelOptions[0].mat;
      r.choiceKind = 'panel';
      r.choiceHint = '板面建材（效率不同）';
    } else if (Array.isArray(f.fuelWhitelist) && f.fuelWhitelist.length) {
      r.materials = f.fuelWhitelist.slice();
      r.defaultMaterial = f.fuel;
      r.choiceKind = 'fuel';
      r.choiceHint = '燃料（运行时消耗）';
    }
  }
  return out;
}

// ============================================================================
// 有效人力：该建筑下所有职业的 (人数 × 强度产出倍率) 之和
// ============================================================================
function effectiveLaborOf(inst, buildingId) {
  const pop = inst && inst.pop;
  if (!pop || !pop.assignments) return 0;
  let sum = 0;
  for (const job of jobsOfBuilding(buildingId)) {
    const a = pop.assignments[job.id];
    if (!a || !(a.count > 0)) continue;
    sum += a.count * (getIntensity(a.intensityId).outputMul || 0);
  }
  return sum;
}

function buildingCount(inst, buildingId) {
  return Number((inst && inst.buildings && inst.buildings[buildingId]) || 0);
}

// ============================================================================
// 推进生产 dt 秒。powerRatio 由 power.js 的 computePower 给出（缺电全局降速）。
// v0.0.7：改为**按生产线**结算 —— 每条线自带生产内容与人数，没人的线不运转。
// 造船线（buildingId === 'dock'）由 shipyard 侧推进，这里跳过。
// ============================================================================
export function tickProduction(inst, dt, powerRatio, acc = null) {
  if (!inst) return;
  if (!(Number(dt) > 0)) return;            // dt <= 0 直接返回
  if (!(Number(powerRatio) > 0)) return;    // powerRatio <= 0 直接返回
  dt = Number(dt);
  powerRatio = Number(powerRatio);
  ensureLines(inst);

  // v0.0.91 需求 2：农田由「农田工」岗位驱动，固定配方产有机质，不走生产线（addLine 已拒绝 farm）。
  //   有效人力 = jobOutput(pop, 'farm_worker')；速率 = 有效人力 × powerRatio / 1280（次/秒）。
  //   CO₂ 走气体双来源（先物品栏再大气），水走物品栏；材料不足按最紧缺等比缩减；产出 有机质 进物品栏。
  const farmLabor = inst.pop ? jobOutput(inst.pop, 'farm_worker') : 0;
  if (farmLabor > 0) {
    // v0.1.0：农田配方改走 resolveRecipe，配方调整后立即生效（不再硬编码常量）。
    //   找不到配方时安全兜底：跳过农田产出，不抛错。
    const farmRecipe = resolveRecipe(inst, 'r_farm_organic_water');
    if (farmRecipe) {
      const FARM_WORK = Number(farmRecipe.work) || 1;
      const FARM_CO2 = Number(farmRecipe.inputs['二氧化碳']) || 0;
      const FARM_WATER = Number(farmRecipe.inputs['水']) || 0;
      const FARM_ORGANIC = Number(farmRecipe.outputs['有机质']) || 0;
      // v0.1.1（需求 7）：与生产线同款乘「建筑数量效率」（效率加成对农田同样生效）
      const farmRate = (farmLabor * powerRatio * efficiencyBonus(inst)) / FARM_WORK;   // 次/秒
      let farmStarved = false;
      // v0.1.2 R11：农田同款整数批次口径 —— 有料即满速，无料即停（与生产线一致，绝不「几乎不生产」）。
      // CO₂ 可用量含大气；水只算物品栏（需求 3 口径）
      if (FARM_CO2 > 0) {
        const perTime = FARM_CO2 * farmRate * dt;
        if (!(perTime > 0) || Math.floor((gasAvailableAmount(inst, '二氧化碳') + 1e-9) / perTime) === 0) farmStarved = true;
      }
      if (!farmStarved && FARM_WATER > 0) {
        const perTime = FARM_WATER * farmRate * dt;
        if (!(perTime > 0) || Math.floor((ownedTotal(inst, '水') + 1e-9) / perTime) === 0) farmStarved = true;
      }
      const farmActual = farmStarved ? 0 : farmRate;
      if (farmActual > 0 && FARM_ORGANIC > 0) {
        const co2Amt = FARM_CO2 * farmActual * dt;
        const waterAmt = FARM_WATER * farmActual * dt;
        // CO₂ 先物品栏再大气；水只扣物品栏
        if (typeof inst._consumeGas === 'function') inst._consumeGas('二氧化碳', co2Amt);
        else spendTotal(inst, '二氧化碳', co2Amt);
        spendTotal(inst, '水', waterAmt);
        const e = ensureEntry(inst, '有机质', 'surface');
        e.owned = Math.max(0, (Number(e.owned) || 0) + FARM_ORGANIC * farmActual * dt);
      }
    }
  }

  const upg = upgradeMulsOf(acc);
  for (const line of inst.lines) {
    // v0.2.0：军队组装线（armyBlueprintId）与 dock 造船线一样由专用 tick 结算，这里跳过
    if (!line || !line.buildingId || line.buildingId === 'dock' || line.armyBlueprintId) continue;
    const recipe = resolveRecipe(inst, line.recipeId);
    if (!recipe) continue;
    if (buildingCount(inst, line.buildingId) <= 0) continue;   // 建筑没了
    const workers = Number(line.workers) || 0;
    if (!(workers > 0)) continue;                              // 没人的线不运转

    // 产出倍率 = 全局强度 × 建筑数量效率 × 该星球的殖民管理模式
    const labor = workers * intensityMulOf(inst, line) * efficiencyBonus(inst) * outputMulOf(inst) * upg.labor;
    if (!(labor > 0)) continue;
    // 产出速率 = 有效人力 × powerRatio / recipe.work（次/秒）
    // v0.1.2 R16：生产线（非农田）产出速率统一 ×5（V012_LINE_RATE_MUL）；农田不在此路径，不会叠加成 ×25。
    const rate = (labor * powerRatio * V012_LINE_RATE_MUL * upg.refine) / Math.max(1, Number(recipe.work) || 1);

    // 投料：部件配方按线选定的材料折算；设施配方可能要投所选板面材料；其余用配方自带 inputs
    const inputs = recipe.producesPart
      ? partInputsOf(recipe.producesPart, line.material)
      : (recipe.producesFacility ? facilityInputsOf(recipe, line) : (recipe.inputs || {}));

    // v0.0.91 需求 3：气体双来源的建筑名单（含老存档的火力发电厂旧线），其余（含 chem_lab）只看物品栏
    const gasDualBuilding = GAS_DUAL_BUILDINGS.has(line.buildingId);

    // v0.1.2 R11：整数批次口径 —— 只要有原料就满速，绝不「几乎不生产」。
    //   对每项输入，按满速下一个 tick 需要的量 perTime 算 batch = floor(have / perTime)；
    //   · 库存为 0 → 停（ratio=0）
    //   · 库存 > 0 → 按「满速能用多久」的比例跑，最多满速（ratio=1），
    //     并且这一 tick 会把剩余库存**吃干榨净**（能跑多少跑多少）。
    //   注意：不能写成「不足一整个 tick 的量就整线停」——那样库存只剩 10% 时会直接
    //   产出 0，比按比例缩减还差，与「有库存就最高效率」完全相反（v0.1.2 实测踩过）。
    let ratio = 1;
    for (const mat in inputs) {
      const perTime = (Number(inputs[mat]) || 0) * rate * dt;
      if (perTime <= 0) continue;
      // v0.0.61：跨层聚合（同一材料可能分散在多层条目里）；v0.0.91：气体双来源可用量含大气
      const have = (gasDualBuilding && isGasName(mat)) ? gasAvailableAmount(inst, mat) : ownedTotal(inst, mat);
      if (have <= 1e-9) { ratio = 0; break; }
      const r = have / perTime;
      if (r < ratio) ratio = r;
    }
    if (ratio > 1) ratio = 1;

    // v0.1.1（需求 15）：把本 tick 的实际供给比缓存到线上，供 lineRateOf / productionRates
    //   展示层与 netRates 口径对齐——断供时展示与实际产出一致（不再「满速假象」）。
    //   R11：写实际供给比（0=原料耗尽，1=满速，中间值=库存只够跑一部分）。
    line._ratio = ratio;

    // 原料耗尽：本 tick 不生产
    if (!(ratio > 0)) continue;

    // R11：满速 × 供给比。库存只够跑一部分时按这个折后速率投料，
    // 保证这一 tick 正好把剩余库存吃干、绝不超扣。
    const actualRate = rate * ratio;

    if (!(actualRate > 0)) continue;

    if (recipe.producesFacility) {
      // 设施配方：产出计入 inst.facilityStock（允许小数进度，UI 用 Math.floor 展示）
      const stock = facilityStockOf(inst);
      const fid = recipe.producesFacility;
      const times = actualRate * dt;
      if (Number.isFinite(times)) stock[fid] = (Number(stock[fid]) || 0) + times;
      // v0.0.7：记下玩家选定的板面材料 / 燃料，供 power.js 结算效率与烧料
      if (line.material) {
        if (recipe.choiceKind === 'panel') {
          if (!inst.facilityPanelMat || typeof inst.facilityPanelMat !== 'object') inst.facilityPanelMat = {};
          inst.facilityPanelMat[fid] = line.material;
        } else if (recipe.choiceKind === 'fuel') {
          if (!inst.facilityFuel || typeof inst.facilityFuel !== 'object') inst.facilityFuel = {};
          inst.facilityFuel[fid] = line.material;
        }
      }
      // 设施配方照样扣料（含所选板面材料；燃料不在此扣，运行时由 power.js 烧）
      for (const mat in inputs) {
        const amt = (Number(inputs[mat]) || 0) * actualRate * dt;
        if (!Number.isFinite(amt) || amt <= 0) continue;
        consumeMaterial(inst, mat, amt, gasDualBuilding);
      }
    } else if (recipe.producesPart) {
      // 部件配方（v0.0.7）：装备按**整件**入库，小数进度攒在线的 progress 上
      line.progress = (Number(line.progress) || 0) + actualRate * dt;
      const done = Math.floor(line.progress);
      if (done > 0) {
        // v0.1.1（需求 15）：整件结算前必须**足额付清**全部投料——
        //   旧逻辑先出件再「有多少扣多少」（spendTotal 不校验扣够），
        //   混合投料时紧缺材料不足的部分被免单，玩家白得装备。
        //   任一投料不足 → 回退整件进度、不出件、不扣料，等材料攒够再出件。
        let canPay = true;
        for (const mat in inputs) {
          const need = (Number(inputs[mat]) || 0) * done;
          if (!(need > 0)) continue;
          const have = (gasDualBuilding && isGasName(mat))
            ? gasAvailableAmount(inst, mat)
            : ownedTotal(inst, mat);
          if (have + 1e-9 < need) { canPay = false; break; }
        }
        if (!canPay) {
          line.progress -= done;             // 回退到不足一件的小数进度，本 tick 不出件
        } else {
          line.progress -= done;
          addEquipment(inst, recipe.producesPart, line.material, done);
          for (const mat in inputs) {
            consumeMaterial(inst, mat, (Number(inputs[mat]) || 0) * done, gasDualBuilding);
          }
        }
      }
    } else {
      // 普通配方：累加物品栏 owned
      const outputs = recipe.outputs || {};
      for (const mat in outputs) {
        const amt = (Number(outputs[mat]) || 0) * actualRate * dt;
        if (!Number.isFinite(amt) || amt <= 0) continue;
        const e = ensureEntry(inst, mat, 'refined');
        e.owned = Math.max(0, (Number(e.owned) || 0) + amt);
      }
      // 消耗：跨层扣（从持有最多的条目开始）
      for (const mat in inputs) {
        const amt = (Number(inputs[mat]) || 0) * actualRate * dt;
        if (!Number.isFinite(amt) || amt <= 0) continue;
        consumeMaterial(inst, mat, amt, gasDualBuilding);
      }
    }
  }
}

// ============================================================================
// 展示用：按**建筑类型**汇总的产出速率（已乘 powerRatio）
// v0.0.7：同一建筑类型下的多条线相加；净增长计算（state.js#computeNetRates）继续用它。
// ============================================================================
// v0.1.2（需求 19）：「冶炼效率 / 人力效率」两项永久升级此前付了钱却没有任何效果。
// 注意：production.js **严禁** import js/core/state.js（会循环依赖，见文件头说明），
// 所以账号由调用方（state.js / ui/inventory.js）透传进来；拿不到就按 1 倍处理。
function upgradeMulsOf(acc) {
  return {
    labor: acc ? upgradeMul(acc, 'upg_labor') : 1,
    refine: acc ? upgradeMul(acc, 'upg_refine') : 1,
  };
}

export function productionRates(inst, powerRatio, acc = null) {
  const out = {};
  if (!inst) return out;
  const upg = upgradeMulsOf(acc);
  powerRatio = Number(powerRatio) || 0;
  ensureLines(inst);
  for (const line of inst.lines) {
    const bid = line && line.buildingId;
    if (!bid || bid === 'dock' || line.armyBlueprintId) continue;   // v0.2.0：军队组装线不在此结算
    const recipe = resolveRecipe(inst, line.recipeId);
    if (!recipe) continue;
    const labor = (Number(line.workers) || 0) * intensityMulOf(inst, line);
    const built = buildingCount(inst, bid) > 0;
    let rate = 0;
    if (built && labor > 0 && powerRatio > 0) {
      // v0.1.1（需求 15）：与 tickProduction 完全同口径——
      //   效率 × 殖民管理模式 × tick 缓存的断供缩减比，净增长与展示不再高估。
      let eff = labor * efficiencyBonus(inst) * outputMulOf(inst) * upg.labor;
      const cached = Number(line._ratio);
      if (Number.isFinite(cached)) eff *= cached;
      rate = (eff * powerRatio * upg.refine * V012_LINE_RATE_MUL) / Math.max(1, Number(recipe.work) || 1);
    }
    let slot = out[bid];
    if (!slot) {
      slot = out[bid] = {
        recipe, lines: [], active: false, rate: 0,
        outputs: {}, inputs: {}, effectiveLabor: 0, producesFacility: null,
      };
    }
    slot.lines.push({ line, recipe, rate });
    slot.effectiveLabor += labor;
    if (rate > 0) slot.active = true;
    slot.rate += rate;
    const inputs = recipe.producesPart ? partInputsOf(recipe.producesPart, line.material) : (recipe.producesFacility ? facilityInputsOf(recipe, line) : (recipe.inputs || {}));
    for (const mat in (recipe.outputs || {})) {
      slot.outputs[mat] = (slot.outputs[mat] || 0) + (Number(recipe.outputs[mat]) || 0) * rate;
    }
    for (const mat in inputs) {
      slot.inputs[mat] = (slot.inputs[mat] || 0) + (Number(inputs[mat]) || 0) * rate;
    }
    // 设施配方：outputs 保持空（不编造材料名），UI 据此字段去 facilities.js 查显示名与产速
    if (recipe.producesFacility && !slot.producesFacility) slot.producesFacility = recipe.producesFacility;
  }
  return out;
}

// ============================================================================
// 精细加工厂「2→1 提升精细度」语义函数（供 UI 用）
// ============================================================================
// 任意材料 ×2 → 同名材料 ×1，fineness +1。返回一个配方式对象（不写入 RECIPES）。
export function refinePair(matName) {
  const name = String(matName || '');
  return {
    id: `refine_${name}`,
    buildingId: 'refinery',
    nameCn: `${name} ×2 → ${name}（精）`,
    inputs: { [name]: 2 },
    outputs: { [name]: 1 },
    work: 200,
    desc: `通用精炼：两份「${name}」合成一份精细度 +1 的「${name}」。`,
    byproductNote: '',
    generated: true,
  };
}

// ============================================================================
// 工具
// ============================================================================
function clamp01(v) {
  if (!Number.isFinite(v)) return 0;
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

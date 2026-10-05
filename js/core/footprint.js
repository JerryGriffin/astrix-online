// 物品占地（Astrix v0.0.92）
// 纯算法模块，零依赖，浏览器直接 import。
//
// 设计者口径（原话）：
//   「关于物品占地，**一组相同物品占地 1**，无论有多少，
//     但**精细度不同**的物品、**不同材料**的部件不能算相同。」
// 落地口径：
//   · 材料（含气体 / 精炼产物 / 自定义材料）：**每种固定占 1 格**；
//     但「同一种材料 + 不同精细度」视为**不同种**（各占 1 格）。
//   · 部件（外壳 / 引擎 / 武器 / 船上设施）：**按体积占格**，1 格 = 20 体积，
//     格数 = max(1, ceil(footprint / 20))；「同型号 + 同材料」算一种，数量再多也还是这么多格。
// 用途：运输船的载货判定（上层拿 totalCells 去和船的载货格数比）。

import { MATERIALS } from '../data/materials.js?v=49.2';
import { PART_BY_ID } from '../data/ship_parts.js?v=49.2';
import { POWER_FACILITY_BY_ID } from '../data/facilities.js?v=49.2';

const MATERIAL_BY_NAME = Object.fromEntries(MATERIALS.map((m) => [m.nameCn, m]));

/** 1 格等于多少体积（部件的 footprint 口径与 ship_parts 一致） */
export const CELL_VOLUME = 20;

/** 材料是否算「气体」（气体同样每种 1 格，只是单独归类更直观） */
const GAS_NAMES = new Set(['氮气', '氧气', '氨气', '甲烷', '二氧化碳', '氢气', '氩气', '氦气', '硫磺气']);

/** 查某材料的精细度（自定义材料在 inst.customMaterials 里） */
function finenessOf(inst, matName) {
  const m = MATERIAL_BY_NAME[matName];
  if (m && Number.isFinite(m.fineness)) return m.fineness;
  const cm = inst && inst.customMaterials ? inst.customMaterials : null;
  if (cm) {
    for (const k in cm) {
      const mm = cm[k] && cm[k].material;
      if (mm && mm.nameCn === matName) return Number.isFinite(mm.fineness) ? mm.fineness : 1;
    }
  }
  return 1;
}

/** 单个材料条目占几格（材料恒为 1 格） */
export function itemFootprintOf(entry) {
  if (!entry || !entry.mat) return 0;
  return Number(entry.owned) > 0 ? 1 : 0;
}

/** 部件按体积占格：1 格 = CELL_VOLUME 体积 */
export function equipmentFootprintOf(eq) {
  if (!eq || !eq.partId) return 0;
  const p = PART_BY_ID[eq.partId] || POWER_FACILITY_BY_ID[eq.partId] || null;
  const vol = Number(p && p.footprint) || 0;
  return Math.max(1, Math.ceil(vol / CELL_VOLUME));
}

/**
 * 星球舱单：把物品栏与装备库存折算成「占地格数」
 * 返回 { materials, equipment, materialCells, equipmentCells, totalCells }
 *   materials: [{ mat, fineness, count, cells }]      // 同材料不同精细度分开
 *   equipment: [{ key, partId, material, count, cells }]
 */
export function cargoGridOf(inst) {
  const matMap = new Map();
  for (const e of (inst && inst.inventory) || []) {
    if (!e || !e.mat) continue;
    const owned = Number(e.owned) || 0;
    if (!(owned > 0)) continue;
    const fin = finenessOf(inst, e.mat);
    const key = e.mat + '#' + fin;                 // 同材料不同精细度 = 不同种
    const it = matMap.get(key) || { mat: e.mat, fineness: fin, count: 0, cells: 1, isGas: GAS_NAMES.has(e.mat) };
    it.count += owned;
    matMap.set(key, it);
  }
  const materials = [...matMap.values()].sort((a, b) => a.mat.localeCompare(b.mat, 'zh'));

  const equipment = [];
  let eqList = [];
  try {
    // 装备库存形状由 core/shipyard.js 维护：{ [key]: { partId, material, count } }
    const eq = (inst && inst.equipment) || {};
    for (const key in eq) {
      const e = eq[key];
      if (!e || !(Number(e.count) > 0)) continue;
      eqList.push({
        key,
        partId: e.partId,
        material: e.material,
        count: Number(e.count) || 0,
        cells: equipmentFootprintOf({ partId: e.partId }),
      });
    }
  } catch (err) { eqList = []; }
  equipment.push(...eqList.sort((a, b) => a.partId.localeCompare(b.partId)));

  const materialCells = materials.reduce((s, x) => s + x.cells, 0);
  const equipmentCells = equipment.reduce((s, x) => s + x.cells, 0);
  return { materials, equipment, materialCells, equipmentCells, totalCells: materialCells + equipmentCells };
}

/** 某类物资的占地（供运输/商店下单使用）：材料按名字 + 精细度查 */
export function cellsForMaterial(inst, matName) {
  return 1;   // 材料恒 1 格（同材料不同精细度各算一种，由调用方区分）
}
export function cellsForEquipmentKey(key) {
  const partId = String(key).split('@')[0];
  return equipmentFootprintOf({ partId });
}

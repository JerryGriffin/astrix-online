// 数据查询工具（Astrix）
// 汇总 planets.js 与 materials.js，导出便捷查询函数与映射表。
// 本文件不持有数据，仅做索引与派生（ALL_RESOURCE_NAMES 由 PLANETS 动态派生，保证与星球数据一致）。

import { PLANETS } from './planets.js?v=21.17';
import { MATERIALS } from './materials.js?v=21.17';

export const PLANET_MAP = Object.fromEntries(PLANETS.map(p => [p.id, p]));
export const MATERIAL_MAP = Object.fromEntries(MATERIALS.map(m => [m.id, m]));

export function getPlanet(id) {
  return PLANET_MAP[id] || null;
}

export function getPlanetByCode(code) {
  return PLANETS.find(p => p.code === code) || null;
}

export function getMaterial(id) {
  return MATERIAL_MAP[id] || null;
}

export function getMaterialByName(nameCn) {
  return MATERIALS.find(m => m.nameCn === nameCn) || null;
}

// 所有星球（地表/地下/地核/大气）出现过的资源名去重数组，供物品栏生成使用
export const ALL_RESOURCE_NAMES = (() => {
  const set = new Set();
  for (const p of PLANETS) {
    for (const layer of ['surface', 'underground', 'core']) {
      for (const it of p.layers[layer]) set.add(it.name);
    }
    for (const g of p.gases) set.add(g.name);
  }
  return [...set];
})();

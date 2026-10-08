// 数据查询工具（Astrix）
// 按 code 查星球 —— PLANETS 的便捷索引。
//
// v0.4.20：本文件原有 7 处导出，其中 6 处（PLANET_MAP / MATERIAL_MAP / getPlanet /
//   getMaterial / getMaterialByName / ALL_RESOURCE_NAMES）在**全库范围内零引用**
//   （已把 js/ 与 docs/ 自检、两个 HTML 入口都算进引用面），已全部删除。
//   实际被用到的只有 getPlanetByCode（js/ui/planet.js 以 _idxGetPlanet 之名引入）。
//   连带删掉的还有只服务于它们的 MATERIALS / PLANET_MAP 派生逻辑。

import { PLANETS } from './planets.js?v=61.12';

export function getPlanetByCode(code) {
  return PLANETS.find(p => p.code === code) || null;
}

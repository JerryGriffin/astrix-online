// W-RECIPE 探针（v0.1.2）
// 所有相对导入带 ?v=11.0，严格照契约，避免双模块实例。
// 用途：核验 R13 / R14 / R17 / R10 的配方改动。
// 运行：node docs/_probe_recipe.mjs

import { RECIPES, RECIPE_BY_ID } from '../js/data/recipes.js?v=32.1';

let passed = 0;
let failed = 0;
const fails = [];

function check(name, cond, detail) {
  if (cond) {
    passed += 1;
    console.log(`  [PASS] ${name}${detail ? ' — ' + detail : ''}`);
  } else {
    failed += 1;
    fails.push(name);
    console.log(`  [FAIL] ${name}${detail ? ' — ' + detail : ''}`);
  }
}

console.log('=== R13 去掉硫磺 ===');
const sulfurInInputs = RECIPES.some((r) =>
  r.inputs && Object.keys(r.inputs).includes('硫磺')
);
check('硫磺不再出现在任何配方输入里', !sulfurInInputs,
  sulfurInInputs ? '仍存在硫磺输入' : '已无任何配方消耗硫磺');
const rubber = RECIPE_BY_ID['r_chem_rubber'];
const explosive = RECIPE_BY_ID['r_chem_explosive'];
console.log('  r_chem_rubber 新输入:', JSON.stringify(rubber.inputs), '(旧: 碳6+氢气4+硫磺2)');
check('r_chem_rubber = 碳8+氢气6→橡胶1',
  rubber.inputs['碳'] === 8 && rubber.inputs['氢气'] === 6 && rubber.outputs['橡胶'] === 1 && !('硫磺' in rubber.inputs));
console.log('  r_chem_explosive 新输入:', JSON.stringify(explosive.inputs), '(旧: 碳4+硫磺4+氮气4)');
check('r_chem_explosive = 碳6+氮气8→炸药粉1',
  explosive.inputs['碳'] === 6 && explosive.inputs['氮气'] === 8 && explosive.outputs['炸药粉'] === 1 && !('硫磺' in explosive.inputs));
// 硫磺本身保留（仍可采集）
const sulfurStillDefined = RECIPES.length >= 0; // materials.js 不在此模块，仅确认配方侧
check('硫磺不再被消耗（配方侧已清空）', !sulfurInInputs);

console.log('=== R14 化学实验室补齐复合资源 ===');
const chemLabRecipes = RECIPES.filter((r) => r.buildingId === 'chem_lab');
const chemLabOutputs = new Set(chemLabRecipes.map((r) => Object.keys(r.outputs)[0]));
const chemLabOldCount = 5;
const chemLabNewCount = chemLabOutputs.size;
console.log(`  chem_lab 可产资源: 旧=${chemLabOldCount} 新=${chemLabNewCount}`);
check('chem_lab 可产资源从 5 个变 10 个', chemLabNewCount === 10,
  `实际 ${chemLabNewCount} 个: ${[...chemLabOutputs].join('/')}`);
const expectFive = ['碳化钨', '石墨烯', '钻石', '钛合金', '纳米碳合金'];
for (const mat of expectFive) {
  const rec = chemLabRecipes.find((r) => r.outputs[mat]);
  check(`chem_lab 可产 ${mat}`, !!rec,
    rec ? `配方 ${rec.id} 输入=${JSON.stringify(rec.inputs)}` : '缺配方');
}
// 原 custom_chem 配方保留不动
const customChemIds = ['r_custom_graphene', 'r_custom_tungsten_carbide', 'r_custom_titanium_alloy', 'r_custom_diamond', 'r_custom_nanocarbon'];
const allCustomKept = customChemIds.every((id) => RECIPE_BY_ID[id] && RECIPE_BY_ID[id].buildingId === 'custom_chem');
check('原 custom_chem 5 条配方保留不动', allCustomKept);
// 不引入新资源（仅校验新 chem_lab 配方输入均为已知基础资源名，靠人工核对 materials 存在）
const newChemIds = ['r_chem_tungsten_carbide', 'r_chem_graphene', 'r_chem_diamond', 'r_chem_titanium_alloy', 'r_chem_nanocarbon'];
console.log('  新增 chem_lab 配方输入:');
for (const id of newChemIds) {
  const r = RECIPE_BY_ID[id];
  console.log(`    ${id}: ${JSON.stringify(r.inputs)} → ${JSON.stringify(r.outputs)}`);
}

console.log('=== R17 二氧化硅 → 玻璃 ===');
const silica = RECIPE_BY_ID['r_chem_silica_glass'];
check('r_chem_silica_glass 存在', !!silica);
if (silica) {
  console.log('  r_chem_silica_glass 输入:', JSON.stringify(silica.inputs), '输出:', JSON.stringify(silica.outputs), 'work:', silica.work);
  check('比例 二氧化硅32 + 碳1 → 玻璃1',
    silica.inputs['二氧化硅'] === 32 && silica.inputs['碳'] === 1 && silica.outputs['玻璃'] === 1);
  check("buildingId == 'furnace'", silica.buildingId === 'furnace');
  const glassOld = RECIPE_BY_ID['r_chem_glass'];
  check('work 照抄 r_chem_glass(240)', silica.work === 240 && glassOld.work === 240,
    `新=${silica.work} 旧r_chem_glass=${glassOld.work}`);
}

console.log('=== R10 农田 work 960 → 192 ===');
const farm = RECIPE_BY_ID['r_farm_organic_water'];
console.log(`  r_farm_organic_water.work: 旧=960 新=${farm.work}`);
check('农田 work = 192', farm.work === 192, `实际 ${farm.work}`);

console.log(`\n=== 结果: 通过 ${passed} / 失败 ${failed} ===`);
if (failed > 0) {
  console.log('失败项:', fails.join(', '));
  process.exit(1);
} else {
  console.log('全部探针通过 ✅');
}

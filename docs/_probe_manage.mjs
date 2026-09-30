// v0.2.11 管理模式探针：增长乘数 / 消耗乘数 / consumptionPerSec 同步
import { tickPopulation, consumptionPerSec, MANAGE_MODES, manageModeOf } from '../js/core/population.js?v=26.9';

let pass = 0, fail = 0;
function ok(cond, msg) { if (cond) { pass++; console.log('  ✓ ' + msg); } else { fail++; console.log('  ✗ ' + msg); } }

function mkPop(happiness) {
  return { total: 1000, happiness, assignments: {} };
}
// 供给充足（10 亿营养），tick 1 秒
const SUPPLY = { oxygen: 1e9, organic: 1e9, water: 1e9 };

for (const m of MANAGE_MODES) {
  const pop = mkPop(0.75);   // f = 0.5 → 正增长
  pop.manageMode = m.id;
  const c0 = consumptionPerSec(pop);
  const r = tickPopulation(pop, 1, { ...SUPPLY }, { manageMode: m.id });
  ok(pop.manageMode === m.id, m.nameCn + '：tick 后 pop.manageMode 同步');
  // 消耗比例断言（对照 normal）
  const popN = mkPop(0.75);
  const cN = consumptionPerSec(popN);
  const ratioOrganic = c0.organic / cN.organic;
  ok(Math.abs(ratioOrganic - m.organicMul) < 1e-9, m.nameCn + '：有机质消耗 ×' + m.organicMul + '（实际 ' + ratioOrganic.toFixed(3) + '）');
  const ratioWater = c0.water / cN.water;
  ok(Math.abs(ratioWater - m.waterMul) < 1e-9, m.nameCn + '：水消耗 ×' + m.waterMul + '（实际 ' + ratioWater.toFixed(3) + '）');
}

// 增长乘数：相同幸福度下 tick 5 秒，比较 鼓励生育 vs 常规 vs 计划生育
function growth5s(modeId) {
  const pop = mkPop(0.75);
  pop.manageMode = modeId;
  for (let i = 0; i < 5; i++) tickPopulation(pop, 1, { ...SUPPLY }, { manageMode: modeId });
  return pop.total;
}
const gN = growth5s('normal'), gB = growth5s('birth_boost'), gL = growth5s('birth_limit');
ok((gB - 1000) > (gN - 1000) * 2.5, '鼓励生育增量显著大于常规（+' + (gB - 1000).toFixed(2) + ' vs +' + (gN - 1000).toFixed(2) + '）');
ok(gL < gN, '计划生育增长慢于常规（' + gL.toFixed(1) + ' vs ' + gN.toFixed(1) + '）');
ok(Math.abs((gB - 1000) / (gN - 1000) - 3) < 0.5, '鼓励生育增长 ≈ 常规 ×3');

// 未设置模式 → 常规（兼容老存档）
const popOld = mkPop(0.75);
ok(manageModeOf(popOld).id === 'normal', '未设置管理模式的星球默认常规管理');

console.log('');
console.log('通过 ' + pass + ' 项，失败 ' + fail + ' 项');
process.exit(fail ? 1 : 0);

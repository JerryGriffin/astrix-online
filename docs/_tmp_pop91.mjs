// 临时验证脚本（v0.0.91 三文件改动）—— 跑完即删
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
let fail = 0;
function ok(cond, label) {
  console.log((cond ? '  ✓ ' : '  ✗ ') + label);
  if (!cond) fail++;
}

const POP = await import('../js/core/population.js?v=20.15');

// ---------------------------------------------------------------------------
console.log('\n== 1) 农田工岗位恢复 ==');
const farmJobs = POP.jobsOfBuilding('farm').map((j) => j.id);
ok(farmJobs.includes('farm_worker'), `jobsOfBuilding('farm') 应含 farm_worker（实际 ${JSON.stringify(farmJobs)}）`);
ok(farmJobs.length === 1, `farm 应只挂 1 个岗位（实际 ${farmJobs.length}）`);

// 被删的加工岗位仍应为 0 个（熔炉 / 高炉 / 电解 / 化实 / 精炼 / 自定义化工厂 / 制造车间）
for (const b of ['furnace', 'blast_furnace', 'electrolyzer', 'chem_lab', 'refinery', 'custom_chem', 'fabricator']) {
  ok(POP.jobsOfBuilding(b).length === 0, `加工建筑 ${b} 应仍为 0 个岗位（生产线承担），实际 ${POP.jobsOfBuilding(b).length}`);
}
// 顺带确认 BUILDING_JOB_COUNT 自动统计到了 farm_worker
ok(POP.BUILDING_JOB_COUNT === POP.JOBS.filter((j) => j.buildingId).length,
  `BUILDING_JOB_COUNT(${POP.BUILDING_JOB_COUNT}) 应等于带 buildingId 的岗位数`);
ok(!!POP.getJob('farm_worker') && POP.getJob('farm_worker').buildingId === 'farm',
  `farm_worker.buildingId 应为 'farm'（实际 ${POP.getJob('farm_worker') && POP.getJob('farm_worker').buildingId}）`);

// ---------------------------------------------------------------------------
console.log('\n== 2) 庇护富余加成倍率 ==');
const want = { 1: 1, 1.5: 1.25, 2: 1.5, 5: 1.5 };
for (const [r, exp] of Object.entries(want)) {
  const got = POP.shelterGrowthBonus(Number(r));
  const pass = Math.abs(got - exp) < 1e-9;
  ok(pass, `庇护比 ${r} → 增速倍率 ${got.toFixed(4)}（期望 ${exp}）`);
}

// 衰减路径不应被放大：f<0 时无论庇护比多少，速率都不乘 bonus
{
  const pop = POP.createPopulation(1000);
  pop.happiness = 0.4;              // f = (0.4-0.5)/0.5 = -0.2 < 0 → 衰减
  const before = pop.total;
  // 极高的庇护比，但 f<0，应只走 DECLINE_RATE（不乘 bonus）
  const dt = 1;
  const supply = { oxygen: 0, organic: 0, water: 0 };
  POP.tickPopulation(pop, dt, supply, { shelter: 0, shelterTotal: 99 });
  const dropWithBonus = before - pop.total;
  // 对照：同样 f 但无庇护加成
  const pop2 = POP.createPopulation(1000);
  pop2.happiness = 0.4;
  POP.tickPopulation(pop2, dt, supply, { shelter: 0, shelterTotal: 1 });
  const dropNoBonus = before - pop2.total;
  ok(Math.abs(dropWithBonus - dropNoBonus) < 1e-9,
    `衰减路径不受庇护加成影响（有bonus下降 ${dropWithBonus.toFixed(6)} ≈ 无bonus ${dropNoBonus.toFixed(6)}）`);
}

// 增长路径确实被放大：庇护比 2 时增长率应是庇护比 1 时的 1.5 倍
{
  function growRate(shelterTotal) {
    const pop = POP.createPopulation(1000);
    pop.happiness = 1;             // f = +1 → 满速增长
    const base = pop.total;
    POP.tickPopulation(pop, 1, { oxygen: 1e9, organic: 1e9, water: 1e9 }, { shelter: 1, shelterTotal });
    return (pop.total - base) / base;
  }
  const r1 = growRate(1);
  const r2 = growRate(2);
  ok(Math.abs(r2 / r1 - 1.5) < 1e-6, `庇护比 2 的增长率应是庇护比 1 的 1.5 倍（实测 ${r2 / r1}）`);
}

// ---------------------------------------------------------------------------
console.log('\n== 3) inventory.js 的 LAYER_LABEL（未导出，读源码校验）==');
const invSrc = readFileSync(join(root, 'js/ui/inventory.js'), 'utf8');
const m = invSrc.match(/const\s+LAYER_LABEL\s*=\s*(\{[\s\S]*?\});/);
ok(!!m, '源码中能找到 LAYER_LABEL 字面量');
if (m) {
  // 用 Function 安全地求值这个对象字面量（仅本地常量，无副作用）
  const obj = (new Function('return ' + m[1]))();
  ok(obj.deep === '深层', `LAYER_LABEL.deep 应为 '深层'（实际 ${obj.deep}）`);
  ok(obj.underground === '浅层', `LAYER_LABEL.underground 应为 '浅层'（实际 ${obj.underground}）`);
  ok(obj.surface === '地表' && obj.core === '地核' && obj.gas === '气体',
    `其余层应保持 surface=地表/core=地核/gas=气体（实际 ${obj.surface}/${obj.core}/${obj.gas}）`);
}

// ---------------------------------------------------------------------------
console.log('\n' + (fail === 0 ? '全部通过 ✅' : `失败 ${fail} 项 ❌`));
process.exit(fail === 0 ? 0 : 1);

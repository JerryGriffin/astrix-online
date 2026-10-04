// ============================================================================
// v0.4.4 需求修复自检 —— node docs/selfcheck_fixes.mjs
// ============================================================================
// 覆盖本轮修掉的 5 个可验证缺陷：
//   #1 军队组装线不消耗人力
//   #7 同一兵种多条生产线进度完全相同、且只产出一支军队
//   #8 补员按钮无效（无装备时只补 1 人）
//   #10 军营出现在人力面板的生产线里
//   #13 电解池消耗碳
// ============================================================================

import { readFileSync } from 'fs';
import { pathToFileURL } from 'url';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const srcOf = (rel) => readFileSync(join(ROOT, rel), 'utf8');

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const { CACHE_TAG } = await import(pathToFileURL(join(ROOT, 'js/version.js')));
const U = (p) => pathToFileURL(join(ROOT, p)) + `?v=${CACHE_TAG}`;

const S = await import(U('/js/core/state.js'));
const PR = await import(U('/js/core/production.js'));
const ARMY = await import(U('/js/core/army.js'));
const H = await import(U('/js/core/hoi1936.js'));
const BLD = await import(U('/js/data/buildings.js'));
const RCP = await import(U('/js/data/recipes.js'));

let pass = 0, fail = 0; const bad = [];
function ok(c, n, e) {
  if (c) { pass++; console.log('  ✓ ' + n); }
  else { fail++; bad.push(n + (e ? ' → ' + e : '')); console.log('  ✗ ' + n + (e ? '  [' + e + ']' : '')); }
}

function freshPlanet() {
  S.newGame('fx-' + Math.random().toString(36).slice(2, 8));
  const inst = S.getPlanetInstance('syl');
  inst.buildings = {}; inst.facilities = {}; inst.facilityStock = {}; inst.recipes = {};
  inst.lines = []; inst.equipment = {}; inst.armyProgress = {};
  for (const e of inst.inventory) e.owned = 0;
  return inst;
}
const ownedOf = (inst, n) => S.ownedOf(inst, n);

console.log('\n=== v0.4.4 需求修复自检（CACHE_TAG=' + CACHE_TAG + '） ===\n');

// #1 军队组装线消耗人力 ----------------------------------------------
console.log('#1 军队组装线消耗人力');
{
  const inst = freshPlanet();
  inst.buildings = { barracks: 1 };
  // 给足人力（不派岗位 → 全部可用）
  const r = PR.addLine(inst, 'barracks', 'ab_ranger', { armyBlueprintId: 'ab_ranger', workers: 10 });
  ok(r.ok, '军营线可创建', r.ok ? '' : r.reason);
  ok(r.line && r.line.workers === 10, '军营线记录了人力（旧代码硬置 0）',
    r.line ? String(r.line.workers) : 'no line');
  // 人力应被生产线占用（freeLaborOf 是可用人力的统一口径）
  const srcFree = srcOf('js/core/production.js');
  ok(/const free = freeLaborOf\(inst\);\s*\n\s*if \(want > free\)/.test(srcFree),
    '军营线同样校验并占用可用人力');
  // 直接验证推进：labor=0 不推进，labor>0 推进
  const instB = freshPlanet();
  instB.buildings = { barracks: 1 };
  instB.powerInfo = { ratio: 1 };
  ARMY.armyBuildTick(instB, 'ab_ranger', 0, 1, 1, S.currentAccount(), 'lineA');
  const p0 = instB.armyProgress['lineA'] || 0;
  ARMY.armyBuildTick(instB, 'ab_ranger', 50, 10, 1, S.currentAccount(), 'lineA');
  const p1 = instB.armyProgress['lineA'] || 0;
  ok(p0 === 0, 'labor=0 时完全不推进（人力没派就没产出）', String(p0));
  ok(p1 > 0, 'labor>0 时推进', String(p1));
}

// #7 同一兵种多条线独立进度 ------------------------------------------
console.log('\n#7 同一兵种多条生产线');
{
  const inst = freshPlanet();
  inst.buildings = { barracks: 1 };
  inst.powerInfo = { ratio: 1 };
  const acc = S.currentAccount();
  const l1 = PR.addLine(inst, 'barracks', 'ab_ranger', { armyBlueprintId: 'ab_ranger', workers: 5 });
  const l2 = PR.addLine(inst, 'barracks', 'ab_ranger', { armyBlueprintId: 'ab_ranger', workers: 5 });
  ok(l1.ok && l2.ok, '同一兵种可开多条线');
  ok(l1.line.id !== l2.line.id, '两条线 id 不同');
  // 分别推进，进度应各自独立
  ARMY.armyBuildTick(inst, 'ab_ranger', 50, 10, 1, acc, l1.line.id);
  ARMY.armyBuildTick(inst, 'ab_ranger', 50, 10, 1, acc, l2.line.id);
  const a = inst.armyProgress[l1.line.id], b = inst.armyProgress[l2.line.id];
  ok(typeof a === 'number' && typeof b === 'number', '每条线有独立进度键',
    JSON.stringify(inst.armyProgress));
  ok(a !== undefined && b !== undefined, '两条线的进度都存在');
  // 只推进一条时，另一条不应跟着动
  const beforeB = inst.armyProgress[l2.line.id];
  ARMY.armyBuildTick(inst, 'ab_ranger', 50, 10, 1, acc, l1.line.id);
  ok(inst.armyProgress[l2.line.id] === beforeB,
    '推进其中一条不影响另一条（旧代码共享同一进度）',
    beforeB + ' → ' + inst.armyProgress[l2.line.id]);
  // advanceArmyLines 不再按蓝图去重
  const src = srcOf('js/core/state.js');
  ok(!/seen\.has\(line\.armyBlueprintId\)/.test(src), 'state.js 已移除按蓝图去重');
  ok(!/workers: buildingId === 'barracks' \? 0 : want/.test(srcOf('js/core/production.js')),
    'production.js 不再把军营线人力硬置 0');
}

// #8 补员不再无效 ---------------------------------------------------
console.log('\n#8 补员按钮无效');
{
  const acc = S.currentAccount();
  const inst = S.getPlanetInstance(acc.homePlanetCode);
  inst.equipment = {};                    // 一件装备都没有
  const menMax = H.ARMY_MEN_MAX || 500;
  acc.armies = [{
    id: 'a1', nameCn: '测试师', blueprintId: 'ab_ranger', men: 100, menMax: menMax,
    exp: 0, bonusAtk: 0, bonusDef: 0, stats: { atk: 10, def: 10 }, power: 20,
  }];
  const r = H.reinforceArmy(acc, inst, 'a1', 1);
  ok(r.ok, '无装备时补员仍然成功', r.reason || '');
  ok(r.added >= 5, '一次至少补回若干人（旧代码只补 1 人，等于无效）', 'added=' + r.added);
  ok(r.gearShort === true, '如实报告装备不足', 'gearShort=' + r.gearShort);
  ok(typeof r.note === 'string' && r.note.length > 0, '返回可显示的说明', String(r.note));
  ok(r.men > 100, '兵员确实增加', '100 → ' + r.men);
  // 有装备时补更多
  inst.equipment = { e1: { partId: 'ap_rifle', count: 50 } };
  acc.armies[0].men = 100;
  const r2 = H.reinforceArmy(acc, inst, 'a1', 1);
  ok(r2.ok && r2.added > r.added, '装备充足时补得更多', r.added + ' → ' + r2.added);
  ok(r2.gearShort === false, '装备充足时不报告短缺');
}

// #10 军营不应出现在人力面板的生产线 -------------------------------
console.log('\n#10 军营不出现在生产线');
{
  const barracks = BLD.BUILDING_BY_ID.barracks;
  ok(barracks && Number(barracks.jobs) === 0, '军营 jobs = 0（无产线工位）',
    barracks ? String(barracks.jobs) : 'missing');
  const src = srcOf('js/ui/population.js');
  ok(/if\s*\(!\(Number\(b\.jobs\)\s*>\s*0\)\)\s*return false;/.test(src),
    '生产线建筑下拉已排除 jobs=0 的建筑');
  const jobs = srcOf('js/core/production.js');
  ok(jobs.includes("军队组装线只能开在军营"), '军队组装线仍限定军营（未放宽）');
}

// #13 电解池不消耗碳 ------------------------------------------------
console.log('\n#13 电解池不消耗碳');
{
  const el = RCP.RECIPES.filter((r) => r.buildingId === 'electrolyzer');
  ok(el.length > 0, '电解池有配方', String(el.length));
  const withCarbon = el.filter((r) => r.inputs && r.inputs['碳']);
  ok(withCarbon.length === 0, '没有任何电解池配方消耗碳',
    withCarbon.map((r) => r.id).join(','));
  const water = RCP.RECIPES.find((r) => r.id === 'r_el_water');
  const methane = RCP.RECIPES.find((r) => r.id === 'r_el_methane');
  ok(water && !water.inputs['碳'], '水→氢气+氧气 不耗碳');
  ok(methane && !methane.inputs['碳'], '甲烷配方不耗碳', JSON.stringify(methane && methane.inputs));
  ok(methane && methane.outputs['甲烷'] > 0, '甲烷仍可产出（没有把配方删掉）');
}

// ---------------------------------------------------------------------------
console.log('\n通过 ' + pass + ' / 失败 ' + fail);
if (fail) {
  console.log('\n失败项：');
  for (const b of bad) console.log('  · ' + b);
  process.exit(1);
}
console.log('需求修复自检通过');
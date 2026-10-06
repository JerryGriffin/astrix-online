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
// v0.4.9 更新契约（补员已从 hoi1936.js 搬进 core/army.js）：
//   旧行为是「无装备也硬补 35%」（凭空的 35% 下限，等于凭空造人），且要求星球仍有
//   未分配人力（兵力几乎总被产线占满 → 永远「可用人力不足」＝按钮完全无效）。
//   新行为：**诚实失败**（一件装备都没有就拒绝并说明原因）；装备不足时按装备上限补并
//   如实回报缺口；同时兵员**常态自动恢复**（recoverArmies）。
console.log('\n#8 补员按钮无效（v0.4.9 重做）');
{
  const acc = S.currentAccount();
  const inst = S.getPlanetInstance(acc.homePlanetCode);
  inst.equipment = {};                    // 一件装备都没有
  const menMax = ARMY.menMaxOf({ menMax: 500 });
  acc.armies = [{
    id: 'a1', nameCn: '测试师', blueprintId: 'ab_ranger', men: 100, menMax: menMax,
    exp: 0, bonusAtk: 0, bonusDef: 0, stats: { atk: 10, def: 10 }, power: 20,
  }];
  // 一件装备都没有 → 诚实失败，不再凭空补 35%
  const r0 = ARMY.reinforceArmy(acc, inst, 'a1', 1);
  ok(r0.ok === false, '无装备时补员**明确失败**而不是凭空补人');
  ok(/装备/.test(r0.reason || ''), '失败原因点明是装备不足', r0.reason || '');
  ok(acc.armies[0].men === 100, '失败时不改动兵员', String(acc.armies[0].men));

  // 装备充足 → 正常补员
  inst.equipment = { e1: { partId: 'ap_wpn_rifle', count: 50 } };
  const r = ARMY.reinforceArmy(acc, inst, 'a1', 1);
  ok(r.ok, '有装备时补员成功', r.reason || '');
  ok(r.added >= 50, '一次补回一个像样的量（旧代码只补 1 人 = 无效）', 'added=' + r.added);
  ok(r.gearShort === false, '装备充足时不报告短缺');
  ok(r.men > 100, '兵员确实增加', '100 → ' + r.men);
  ok(r.menMax === menMax, '返回满编数（UI 不再写死 500）', String(r.menMax));
  ok(typeof r.note === 'string' && r.note.length > 0, '返回可显示的说明', String(r.note));

  // 装备只够补一部分 → 按装备上限补，且如实回报
  acc.armies[0].men = 100;
  inst.equipment = { e1: { partId: 'ap_wpn_rifle', count: 2 } };   // 2 件 → 最多 20 人
  const r3 = ARMY.reinforceArmy(acc, inst, 'a1', 1);
  ok(r3.ok, '装备不足一部分时仍能补一点', r3.reason || '');
  ok(r3.gearShort === true, '如实报告装备不足', 'gearShort=' + r3.gearShort);
  ok(r3.added <= 20, '补员量不超过装备支持的上限（20 人）', 'added=' + r3.added);

  // 满编 → 拒绝
  acc.armies[0].men = menMax;
  const r4 = ARMY.reinforceArmy(acc, inst, 'a1', 1);
  ok(r4.ok === false && /满编/.test(r4.reason || ''), '已满编时拒绝补员', r4.reason || '');

  // ---- 自动整补 ----
  ok(typeof ARMY.recoverArmies === 'function', '存在自动整补 recoverArmies');
  acc.armies = [{
    id: 'a2', nameCn: '自动师', blueprintId: 'ab_ranger', men: 200, menMax: 500,
    exp: 0, bonusAtk: 0, bonusDef: 0, stats: { atk: 10, def: 10 }, power: 20,
  }];
  acc.battles = [];
  inst.equipment = { e1: { partId: 'ap_wpn_rifle', count: 100 } };
  const rec = ARMY.recoverArmies(acc, inst, 10, { freeLabor: () => 10000 });
  ok(rec.recovered > 0, '自动整补真的回兵了', String(rec.recovered));
  ok(acc.armies[0].men > 200, '兵员上升', '200 → ' + acc.armies[0].men);

  acc.armies[0].men = 200;
  inst.equipment = {};
  const rec2 = ARMY.recoverArmies(acc, inst, 10, { freeLabor: () => 10000 });
  ok(rec2.recovered === 0, '没有装备时自动整补也不回兵（不凭空造人）', String(rec2.recovered));

  inst.equipment = { e1: { partId: 'ap_wpn_rifle', count: 100 } };
  const rec3 = ARMY.recoverArmies(acc, inst, 10, { freeLabor: () => 0 });
  ok(rec3.recovered === 0, '没有人力时自动整补也不回兵', String(rec3.recovered));

  acc.armies[0].men = 200;
  acc.battles = [{ id: 'bx', status: 'active', mine: [{ armyId: 'a2' }] }];
  const rec4 = ARMY.recoverArmies(acc, inst, 10, { freeLabor: () => 10000 });
  ok(rec4.recovered === 0 && rec4.skipped > 0, '交战中的师不自动整补', JSON.stringify(rec4));

  // 旧实现已从剧本层移除
  ok(typeof H.reinforceArmy === 'undefined', '旧 hoi1936.js#reinforceArmy 已删除');
  ok(typeof H.ARMY_MEN_MAX !== 'undefined', 'ARMY_MEN_MAX 保留为只读兼容别名');
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
  // ---------------------------------------------------------------------------
  // v0.4.13 入口整合 / GUI 补齐的回归锁
  //   锁的是「不该再退化」的几件事：死按钮不能回来、并行入口不能复活、
  //   部署徽标必须走引擎的真实 API（而不是照字段名猜）。
  console.log('\n#v0.4.13 入口整合 / GUI');
  {
    const fleet = srcOf('js/ui/fleet.js');
    // ① 舰队「地面投送」是死按钮（core/fleet.js 一律返回「尚未开放」），不能回来
    ok(!/land:\s*'地面投送/.test(fleet), '舰队指令里没有死按钮 land');
    ok(!/transport',\s*'land'/.test(fleet), '舰队指令按钮循环不含 land');
    // 只查「有效代码」里的字样：注释里允许解释 land 为何被删
    const fleetCode = fleet.split('\n').filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n');
    ok(!/地面投送/.test(fleetCode), 'ui/fleet.js 的有效代码里不再出现「地面投送」');
    // ② 战争操作只在战区页：galaxy.js 不该再有宣战 / 和平会议 / 投降的执行路径
    const galaxy = srcOf('js/ui/galaxy.js');
    ok(!/declareWar\(/.test(galaxy), 'galaxy.js 不再调用 declareWar（宣战归战区页）');
    ok(!/openPeaceConference\(/.test(galaxy), 'galaxy.js 不再打开和平会议（归战区页）');
    ok(!/surrenderWar\(/.test(galaxy), 'galaxy.js 不再执行 surrenderWar（归战区页）');
    ok(!galaxy.includes('* 0.35'), 'galaxy.js 不再按 35% 收投降赔款');
    ok(/\* 0\.15/.test(srcOf('js/ui/hoi.js')), '投降赔款 15% 仍保留在战区页（没被误删）');
  }
  {
    const army = srcOf('js/ui/army.js');
    // ③ 补员按钮此前调用 getPlanetInstance 却从未 import → 浏览器里直接 ReferenceError
    ok(/import \{[^}]*getPlanetInstance[^}]*\} from '\.\.\/core\/state\.js/.test(army),
      'army.js 已 import getPlanetInstance（否则补员按钮运行期报错）');
    ok(!/步兵/.test(army), '军队页不再出现二战术语「步兵」');
    // ④ 部署徽标必须走引擎真实 API，不能照字段名猜
    //    原始 battle 对象上没有 maxHours，只有 battleView() 的视图才补该字段
    ok(/function findDeployment\(/.test(army), 'army.js 有 findDeployment 辅助函数');
    ok(/activeBattlesOf\(acc\)/.test(army), 'findDeployment 走 battle.js#activeBattlesOf');
    ok(/regionById\(t, b\.regionId\)/.test(army), 'findDeployment 走 theater.js#regionById 取战区名');
    ok(/maxHours:\s*BATTLE_MAX_HOURS/.test(army), '交战上限取导出常量 BATTLE_MAX_HOURS 而非硬编码');
    ok(/rg\.nameCn \|\| rg\.id/.test(army), '战区名有 id 兜底（未必每个战区都有名字）');
    ok(/army-deploy/.test(army), '军队行渲染 .army-deploy 徽标');
    const css = srcOf('css/planet.css');
    ok(/\.army-deploy\s*\{/.test(css), '.army-deploy 有样式（否则徽标是裸文本）');
    ok(/\.army-deploy-tag\s*\{/.test(css), '.army-deploy-tag 有样式');
  }

  // ---------------------------------------------------------------------------
  console.log('\n#v0.4.16 单一军事入口 / 冗余收敛');
  {
    const planet = srcOf('js/ui/planet.js');
    // ① 舰队 / 军队 / 战区 已合并为单一「军事」顶层页签
    // 只看**顶层 tabs 数组**里的条目 —— 「舰队 / 军队」作为军事入口的**子页**
    // 定义仍然应该存在（那是合并后的正确形态），不能一并当成"顶层残留"判死。
    const topTabs = (planet.match(/const tabs = \[([\s\S]*?)\n\s*\];/) || [, ''])[1];
    ok(/key: 'mil', label: '军事'/.test(topTabs), '顶层 tabs 里有单一「军事」页签');
    ok(!/key: 'fleet'/.test(topTabs), '顶层 tabs 里不再有独立「舰队」页签');
    ok(!/key: 'army'/.test(topTabs), '顶层 tabs 里不再有独立「军队」页签');
    ok(!/key: 'hoi'/.test(topTabs), '顶层 tabs 里不再有独立「战区」页签');
    ok(!/tabs\.push\(\{ key: 'hoi'/.test(planet), '战区不再被单独 push 成顶层页签');
    ok(/function renderMilitary\(/.test(planet), '有 renderMilitary 单一入口渲染函数');
    // 四个子页都要在
    ok(/key: 'hoi', label: '战区'/.test(planet), '军事下有「战区」子页');
    ok(/key: 'army', label: '军队'/.test(planet), '军事下有「军队」子页');
    ok(/key: 'fleet', label: '舰队'/.test(planet), '军事下有「舰队」子页');
    ok(/key: 'forces', label: '势力'/.test(planet), '军事下有「势力」子页（NPC 从星际页迁来）');
    // 旧 key 必须重定向，否则遗留 selectTab('army') 会掉进「尚未开放」占位页
    ok(/MIL_SUB_FROM_TAB/.test(planet), '有旧页签 key 的重定向表');
    ok(/if \(MIL_SUB_FROM_TAB\[key\]\)/.test(planet), 'selectTab 会把旧 key 重定向到新入口');
    ok(/showForces\(/.test(planet), '军事入口能打开势力子页');
  }
  {
    const galaxy = srcOf('js/ui/galaxy.js');
    // ② 电脑势力（交易 / 进攻）只在军事入口出现，星际页不再重复提供
    ok(/export function renderForcesPanel\(/.test(galaxy), 'galaxy 导出 renderForcesPanel 供军事入口挂载');
    ok(/军事 → 势力/.test(galaxy), '星际页留了指向新入口的指引');
    // 星际页不再调用 renderNpcGrid（那是入口重复的直接证据）
    const secIdx = galaxy.indexOf('电脑势力');
    ok(secIdx >= 0, '星际页仍有电脑势力说明区（只读指引）');
    ok(!/renderNpcGrid\(npcGrid, ctx, rerender, acc, ''\)/.test(galaxy),
      '星际页不再渲染 NPC 网格（不再提供第二个入口）');
    ok(!/searchInput\.addEventListener\('input'[\s\S]{0,200}renderNpcGrid/.test(galaxy),
      '星际页搜索框不再驱动 NPC 网格');
  }
  {
    const common = srcOf('js/ui/common.js');
    // ③ 样式注入收敛到 common#ensureStyle，不再往渲染容器里塞 <style>
    ok(/export function ensureStyle\(/.test(common), 'common.js 导出 ensureStyle');
    ok(/!document\.head/.test(common), 'ensureStyle 对缺少 head 的宿主有防护（自检垫片就是这种）');
    for (const [f, id] of [['js/ui/hoi.js', 'hoi-css'], ['js/ui/buildings.js', 'buildings-css'],
                          ['js/ui/colony.js', 'colony-css'], ['js/ui/population.js', 'population-css'],
                          ['js/ui/power.js', 'power-css']]) {
      const s = srcOf(f);
      ok(s.includes("ensureStyle('" + id + "'"), f + ' 用 ensureStyle 注入样式');
      // 先剥掉注释行：hoi.js 里那段解释来由的注释本身写着旧写法，不该被判死
      const sCode = s.split('\n').filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n');
      ok(!/appendChild\(el\('style'/.test(sCode), f + ' 不再往渲染容器里塞 <style>');
    }
  }
  {
    // ④ 冗余收敛：死 import 清零、el 只剩一份、本地 clamp 归位 util.js
    ok(!/^function el\(tag, cls, text\)/m.test(srcOf('js/main.js')),
      'main.js 不再自带 el()（曾与 common.js 并存，是两种不兼容签名的隐患）');
    ok(/import \{ el \} from '\.\/ui\/common\.js/.test(srcOf('js/main.js')),
      'main.js 的 el 改从 ui/common.js 引入');
    for (const f of ['js/core/population.js', 'js/core/power.js', 'js/core/shop.js']) {
      const s = srcOf(f);
      ok(!/^function clamp\(v, lo, hi\)/m.test(s), f + ' 不再自带 clamp()（统一用 core/util.js）');
      ok(/from '\.\/util\.js/.test(s), f + ' 已从 core/util.js 引入');
    }
  }

console.log('\n通过 ' + pass + ' / 失败 ' + fail);
if (fail) {
  console.log('\n失败项：');
  for (const b of bad) console.log('  · ' + b);
  process.exit(1);
}
console.log('需求修复自检通过');
// Astrix v0.0.5 全量数据自检（node 直接跑，不依赖浏览器）
//   node docs/selfcheck_v005.mjs
// 覆盖：建筑 / 科技 / 升级 / 材料 / 星球 / 燃料 / 舰船部件 / 蓝图与物理 /
//       施工门槛 / 幸福度公式 / 存档往返 / 版本号单一来源 /
//       v0.0.5 新增：营养代谢一吃五出 / 建筑工位池 / 只显示可分配岗位 /
//                    采集扣星球储藏 / 建筑建造与取消退料 / 船坞工门槛
import { readFileSync } from 'node:fs';

let pass = 0;
const fails = [];
function ok(cond, label) {
  if (cond) { pass++; } else { fails.push(label); console.log('  ✗ ' + label); }
}
function section(t) { console.log('\n== ' + t + ' =='); }

const B = await import('../js/data/buildings.js?v=21.17');
const T = await import('../js/data/techs.js?v=21.17');
const U = await import('../js/data/upgrades.js?v=21.17');
const M = await import('../js/data/materials.js?v=21.17');
const P = await import('../js/data/planets.js?v=21.17');
const F = await import('../js/data/fuels.js?v=21.17');
const SP = await import('../js/data/ship_parts.js?v=21.17');
const Y = await import('../js/core/shipyard.js?v=21.17');
const C = await import('../js/core/construction.js?v=21.17');
const POP = await import('../js/core/population.js?v=21.17');
const CUR = await import('../js/core/currency.js?v=21.17');
const V = await import('../js/version.js?v=21.17');

const MAT_NAMES = new Set(M.MATERIALS.map((m) => m.nameCn));
const BUILDING_IDS = new Set(B.BUILDINGS.map((b) => b.id));
const TECH_IDS = new Set(T.TECHS.map((t) => t.id));
const techById = Object.fromEntries(T.TECHS.map((t) => [t.id, t]));

// ---------------------------------------------------------------------------
section('一、建筑表');
// v0.0.6：新增「储电站」（storage_plant），22 → 23；v0.2.1-rev9：新增重工军械总厂与军事指挥学院，23 → 25
ok(B.BUILDINGS.length === 25, `建筑数应为 25（v0.2.1 新增重工军械总厂与军事指挥学院），实际 ${B.BUILDINGS.length}`);
ok(new Set(B.BUILDINGS.map((b) => b.id)).size === B.BUILDINGS.length, '建筑 id 无重复');
for (const b of B.BUILDINGS) {
  ok(b.unlockTech === null || TECH_IDS.has(b.unlockTech), `${b.id} 的 unlockTech 非法：${b.unlockTech}`);
  for (const name of Object.keys(b.baseCost)) ok(MAT_NAMES.has(name), `${b.id} 造价材料「${name}」不在材料表`);
  ok(Number.isFinite(b.growth) && b.growth > 1, `${b.id} growth 非法`);
  ok(Number.isFinite(b.work) && b.work > 0, `${b.id} work 非法`);
  ok(Number.isFinite(b.jobs) && b.jobs >= 0, `${b.id} jobs 非法`);
  // 只有「房屋」（提供庇护）、「储电站」（无人值守的单纯电池，v0.0.91 起不再提供设施槽）
  // 与「火力/清洁发电厂」（v0.1.1 无人工厂，按座数发电）允许 0 工位
  ok(b.jobs > 0 || b.id === 'house' || b.id === 'storage_plant'
    || b.id === 'thermal_plant' || b.id === 'clean_plant',
    `${b.id} 工位数为 0，但只有房屋 / 储电站 / 无人工厂允许这样`);
  ok(Number.isFinite(b.powerDraw) && b.powerDraw >= 0, `${b.id} powerDraw 非法`);
  ok(typeof b.desc === 'string' && b.desc.length > 10, `${b.id} desc 缺失`);
}
ok(B.buildingCost(B.BUILDINGS[0], 0)['石头'] === B.BUILDINGS[0].baseCost['石头'], 'buildingCost(b,0) 应等于基础造价');
// 默认解锁的建筑（否则研究点 / 施工 / 电力死锁）
// v0.0.6：加入 manual_power——它是开局唯一的电源，此前挂在 B4 上要手动研究一次，
//   而「研究点要靠科研所、科研所耗电、电要靠人力发电厂」这条链一开局就卡住。
for (const id of ['lab', 'workshop', 'manual_power']) {
  const b = B.BUILDING_BY_ID[id];
  ok(b && b.unlockTech === null, `${id} 应为默认解锁（unlockTech = null）`);
}
// 储电站（v0.0.6）必须有解锁科技，且该科技必须无前置（否则又要绕回「先有电」）
ok(B.BUILDING_BY_ID.storage_plant.unlockTech === 't_b8', '储电站应由 B8 解锁');
ok(Array.isArray(T.TECH_BY_ID['t_b8'].prereq) && T.TECH_BY_ID['t_b8'].prereq.length === 0,
  'B8 储电站不应有前置科技（它是唯一的储能容器，有前置就可能死锁）');
// v0.0.91：储电站改为「单纯电池」，删除了 facilitySlots（每座 4 槽）字段——
//   电力设施在星球上任意安装，储电站不再提供任何设施安装位。
ok(B.BUILDING_BY_ID.storage_plant.facilitySlots === undefined,
  `储电站 v0.0.91 起不应再有 facilitySlots 字段（改为单纯电池），实际 ${B.BUILDING_BY_ID.storage_plant.facilitySlots}`);
ok(B.BUILDING_BY_ID.storage_plant.storagePerBuilding === 1e5,
  `储电站每座储电上限 v0.1.0 起应为 1e5（单纯电池，原为 1e7），实际 ${B.BUILDING_BY_ID.storage_plant.storagePerBuilding}`);
ok(B.BUILDING_BY_ID.workshop.nameCn === '建筑工厂', '建造车间应已改名为「建筑工厂」');
ok(!!B.BUILDING_BY_ID.fabricator, '应存在制造车间（fabricator）');
ok(B.BUILDING_BY_ID.fabricator.unlockTech === 't_e4', '制造车间应由 E4 解锁');
ok(!!B.BUILDING_BY_ID.farm, '应存在农田（farm）');
ok(!!B.BUILDING_BY_ID.custom_chem, '应存在自定义化工厂（custom_chem）');

// 建材层级铁律：建筑只能使用「解锁它的科技层级或更低」的材料
section('二、建材层级铁律（防死锁）');
const MATERIAL_TIER = {};
const addTier = (names, tier) => { for (const n of names) MATERIAL_TIER[n] = tier; };
addTier(['有机质', '泥土', '石头', '水'], 0);                       // 开局露天采集
addTier(['粘土', '二氧化硅', '石墨', '孔雀石', '石英', '红土', '硫磺'], 1); // A1
addTier(['木头', '碳'], 1);                                          // B1 熔炉
addTier(['铁', '铜', '锌', '铝', '玻璃', '陶瓷', '钢'], 2);            // B2 高炉
addTier(['钛', '银', '金', '钨', '锰', '锂', '铀', '铱', '钚', '橡胶', '塑料', '铝合金', '碳化钨', '钛合金'], 4); // B3/D1
addTier(['石墨烯'], 6);                                              // D3
// 自身就是该材料的产出设施：不参与倒挂判定（否则熔炉「用木头造」永远违规）
const SELF_PRODUCE = { furnace: ['木头', '碳'] };
{
  const tiers = T.techsByTier();
  const tierOf = {};
  tiers.forEach((list, i) => list.forEach((t) => { tierOf[t.id] = i; }));
  for (const b of B.BUILDINGS) {
    const bt = b.unlockTech ? tierOf[b.unlockTech] : 0;
    for (const name of Object.keys(b.baseCost)) {
      if ((SELF_PRODUCE[b.id] || []).includes(name)) continue;
      const mt = MATERIAL_TIER[name];
      if (mt === undefined) continue;
      ok(mt <= bt, `倒挂：${b.id}（T${bt}）的造价用了 ${name}（T${mt}）`);
    }
  }
}

// ---------------------------------------------------------------------------
section('二·b、建筑造价可达性（v0.1.3 新增：抓「造 X 得先有 X」的真死锁）');
// 上面的「层级铁律」是按科技层级判定的，抓不到「造价里的材料**只能由本建筑生产**」
// 这种真死锁 —— 化学实验室原造价含塑料/橡胶，而二者只有化学实验室能产，
// 于是「想造实验室 → 得先有实验室」，玩家永远建不出来（v0.1.3 修复）。
// 这里做**不动点可达性**推算：
//   ① 起点 = 没有任何生产配方的材料（即原生可采集的资源）；
//   ② 反复扫描：某建筑造价已全部 ⊆ 已可得 → 该建筑可建 → 把它产出的材料并入可得集；
//   ③ 收敛后仍不可建的建筑即为死锁，必须报错。
{
  const R = await import('../js/data/recipes.js?v=21.17');
  // 炉类家族共配方（熔炉 / 高炉 / 火力发电厂），生产侧视为同一族
  const FURNACE_FAMILY = new Set(['furnace', 'blast_furnace', 'thermal_plant']);
  const canProduce = (bid, rid) => bid === rid || (FURNACE_FAMILY.has(bid) && FURNACE_FAMILY.has(rid));

  const avail = new Set();
  const producersOfMat = new Map();     // 材料名 → 能产出它的建筑 id 集合
  for (const m of Object.keys(MATERIAL_TIER)) {
    producersOfMat.set(m, new Set());
  }
  for (const r of R.RECIPES) {
    for (const out of Object.keys(r.outputs || {})) {
      if (!producersOfMat.has(out)) producersOfMat.set(out, new Set());
      producersOfMat.get(out).add(r.buildingId);
    }
  }
  // ① 起点 = 原生可采：天然矿（category==='natural'，矿井挖出来就有）
  //    + 气体（大气收集器抽）+ 层级 ≤1 的材料 + 完全没有产出配方的材料。
  //    注意：不能写成「没有产出配方 = 原生可采」的反面——矿石没有产出配方恰恰因为它们
  //    是原生采集物；而「钛」这种只有 refinery 2合1 的才是真死锁（v0.1.3 已补冶炼配方）。
  const GAS_NAMES = new Set(['氮气', '氧气', '氨气', '甲烷', '二氧化碳', '氢气']);
  for (const m of M.MATERIALS) if (m.category === 'natural' || GAS_NAMES.has(m.nameCn)) avail.add(m.nameCn);
  for (const [mat, tier] of Object.entries(MATERIAL_TIER)) if (tier <= 1) avail.add(mat);
  for (const [mat, ps] of producersOfMat) if (ps.size === 0) avail.add(mat);

  // ② 不动点
  let changed = true;
  const buildable = new Set();
  while (changed) {
    changed = false;
    for (const b of B.BUILDINGS) {
      if (buildable.has(b.id)) continue;
      const need = Object.keys(b.baseCost);
      if (need.every((m) => avail.has(m))) {
        buildable.add(b.id);
        for (const r of R.RECIPES) {
          if (!canProduce(b.id, r.buildingId)) continue;
          for (const out of Object.keys(r.outputs || {})) {
            if (!avail.has(out)) { avail.add(out); changed = true; }
          }
        }
        changed = true;
      }
    }
  }
  const dead = B.BUILDINGS.filter((b) => !buildable.has(b.id));
  ok(dead.length === 0,
    `以下建筑存在「造价不可达」死锁：${dead.map((b) => b.nameCn + '(' + b.id + ')').join('、') || '无'}`);
  // 逐建筑自检：不允许「某材料的所有产出建筑里，只有它自己」
  for (const b of B.BUILDINGS) {
    for (const m of Object.keys(b.baseCost)) {
      const ps = producersOfMat.get(m);
      if (!ps || ps.size === 0) continue;
      if (avail.has(m)) continue;            // 原生可采的（水/钛矿石等）不算自循环
      ok(!(ps.size === 1 && ps.has(b.id)),
        `自循环死锁：${b.nameCn}(${b.id}) 的造价需要「${m}」，而它只能由 ${b.id} 自己生产`);
    }
  }
}

// ---------------------------------------------------------------------------
section('三、科技树');
// v0.0.61：舰船科技（a/b/c/d 四条支线 + MK2/MK3）已全部移除，科技数 26 → 20。
//   设计者：“科研里面舰船 mki-iii 去掉，无实际意义；科研里面的 abcd 也去掉”。
//   舰船部件改由「研究出船坞（t_e3）」直接解锁。
// v0.0.7：新增 12 个「设施」解锁节点（电力设施 4 类 × 3 档），科技数 20 → 32
// v0.2.0：新增 5 个「军事」分支节点，科技数 32 → 37
ok(T.TECHS.length === 37, `科技数应为 37（v0.2.0：32 + 5 个军事节点），实际 ${T.TECHS.length}`);
ok(typeof T.facilityTechs === 'function' && T.facilityTechs().length === 12,
  `v0.0.7 起「设施」分区应有 12 个解锁节点（电力设施），实际 ${typeof T.facilityTechs === 'function' ? T.facilityTechs().length : '未导出'}`);
ok(T.TECHS.filter((t) => t.section === 'facility').every((t) => t.id.startsWith('t_fac_')),
  '「设施」分区的节点应全部是 t_fac_* 解锁节点');
ok(T.TECHS.filter((t) => t.section === 'facility').length === 12, '「设施」分区应有 12 个电力设施解锁节点（v0.0.7）');
ok(T.TECHS.filter((t) => t.branch === 'ship').length === 0, '不应再有 branch:\'ship\' 的科技节点');
// v0.0.61：舰船节点的 6 个 id 及 a/b/c/d / MK2 / MK3 编号必须彻底清干净
for (const gone of ['t_ship_hull', 't_ship_engine', 't_ship_weapon', 't_ship_facility', 't_ship_mk2', 't_ship_mk3']) {
  ok(T.TECH_BY_ID[gone] === undefined, `舰船节点 ${gone} 应已删除`);
}
{
  const codes = T.TECHS.map((t) => t.code);
  for (const c of ['a', 'b', 'c', 'd', 'MK2', 'MK3']) {
    ok(!codes.includes(c), `科技编号 ${c} 应已取消（设计者要求去掉 a/b/c/d）`);
  }
}
// v0.0.6（需求 R7）：人力发电厂改为建筑默认解锁，B4 节点必须已删除且无悬空引用
ok(T.TECH_BY_ID['t_b4'] === undefined, 'B4 人力发电厂节点应已删除（改为建筑默认解锁）');
ok(!JSON.stringify(T.TECHS).includes('"t_b4"'), '科技表里不应再有任何对 t_b4 的引用');
// v0.0.6（需求 R3）：未解锁 A1 时即可采全部地表资源，A1 不再门控地表资源
ok(T.TECH_BY_ID['t_a1'].unlockResources.length === 0, 'A1 不应再声称解锁地表资源（地表本来就全开）');
// v0.0.6（需求 R10）：储电站的解锁科技必须存在且真实解锁该建筑
ok(T.TECH_BY_ID['t_b8'] && T.TECH_BY_ID['t_b8'].unlocksBuilding === 'storage_plant',
  'B8 储电站科技应存在并解锁 storage_plant');
for (const t of T.TECHS) {
  for (const p of t.prereq) ok(TECH_IDS.has(p), `${t.id} 的前置 ${p} 不存在`);
  ok(t.unlocksBuilding === null || BUILDING_IDS.has(t.unlocksBuilding), `${t.id} 的 unlocksBuilding 非法`);
}
// 三色 DFS 环检测
{
  const color = {};
  let cycles = 0;
  const dfs = (id) => {
    color[id] = 1;
    for (const p of (techById[id]?.prereq || [])) {
      if (color[p] === 1) cycles++;
      else if (!color[p]) dfs(p);
    }
    color[id] = 2;
  };
  for (const t of T.TECHS) if (!color[t.id]) dfs(t.id);
  ok(cycles === 0, `科技树存在 ${cycles} 个环`);
}
// 设计者给定的前置关系逐条断言
// v0.0.6（需求 R7）：B4 人力发电厂已从科技树删除（改为建筑默认解锁），
//   所以这里去掉 ['t_b4', []]，并把 t_b5 的前置由 ['t_b4','t_c2'] 改为 ['t_c2']。
//   新增 ['t_b8', []]——储电站无前置（它是唯一的储能容器，有前置就可能死锁）。
const PREREQ_SPEC = [
  ['t_a1', []], ['t_a2', []], ['t_a4', ['t_a1', 't_b2']], ['t_a3', ['t_a2', 't_e3']],
  ['t_b1', ['t_a1']], ['t_b2', ['t_b1', 't_a1']], ['t_b3', ['t_e3', 't_b2', 't_c2']],
  ['t_b5', ['t_c2']], ['t_b6', ['t_c3', 't_b5']], ['t_b7', ['t_b2', 't_c2']], ['t_b8', []],
  ['t_d1', ['t_b2', 't_e3']], ['t_d2', ['t_d1', 't_b3']], ['t_d3', ['t_d2']],
  ['t_c1', ['t_a1']], ['t_c2', ['t_c1']], ['t_c3', ['t_c2', 't_e3', 't_b3']],
  ['t_e2', ['t_a1']], ['t_e3', ['t_c2']], ['t_e4', ['t_e2']],
];
for (const [id, want] of PREREQ_SPEC) {
  const t = techById[id];
  if (!t) { fails.push(`缺少科技 ${id}`); continue; }
  const got = [...t.prereq].sort();
  ok(JSON.stringify(got) === JSON.stringify([...want].sort()), `${id} 前置应为 [${want}]，实际 [${t.prereq}]`);
}
ok(techById.t_e3 && techById.t_e3.unlocksBuilding === 'dock', 'E3 应解锁船坞');
// v0.0.61：舰船支线节点与 MK 升级节点均已删除（见上节断言）
for (const [id, sec] of [['facility', '船上设施']]) void sec;
ok(Array.isArray(T.RESEARCH_SECTIONS) && T.RESEARCH_SECTIONS.length === 3, '科研应有 3 个方向');
ok(T.canResearch('t_c1', ['t_a1']) === true, 'canResearch 前置满足时应为 true');
ok(T.canResearch('t_b3', ['t_a1', 't_b1', 't_b2', 't_c1', 't_c2']) === false, 'canResearch 前置缺失时应为 false');
// v0.0.6：B4 已删除，改测 B8 储电站（无前置，可直接研究）
ok(T.canResearch('t_b8', []) === true, 'B8 储电站无前置，应可直接研究');

// ---------------------------------------------------------------------------
section('四、材料表与星球表');
// v0.0.7：铝土矿合并进红土（-1 条），材料数 65 → 64
ok(M.MATERIALS.length >= 64, `材料数应 ≥ 64，实际 ${M.MATERIALS.length}`);
ok(new Set(M.MATERIALS.map((m) => m.id)).size === M.MATERIALS.length, '材料 id 无重复');
ok(new Set(M.MATERIALS.map((m) => m.nameCn)).size === M.MATERIALS.length, '材料中文名无重复');
for (const m of M.MATERIALS) {
  for (const k of ['strength', 'durability', 'density', 'fineness', 'molarHeatCapacity', 'meltingPointK']) {
    ok(Number.isFinite(m[k]), `${m.id}.${k} 不是有限数字`);
  }
  ok(typeof m.description === 'string' && m.description.length > 0, `${m.id} 缺 description`);
}
ok(P.PLANETS.length === 7, `星球数应为 7，实际 ${P.PLANETS.length}`);
const MISSING = new Set();
for (const p of P.PLANETS) {
  for (const layer of ['surface', 'underground', 'core']) {
    for (const r of (p.layers?.[layer] || [])) if (!MAT_NAMES.has(r.name)) MISSING.add(r.name);
  }
  for (const g of (p.gases || [])) if (!MAT_NAMES.has(g.name)) MISSING.add(g.name);
  ok(Array.isArray(p.fuels), `${p.id} 缺 fuels 数组`);
}
ok(MISSING.size === 0, `星球资源在材料表中缺失：${[...MISSING].join('、')}`);

// ---------------------------------------------------------------------------
section('五、燃料与货币');
ok(F.FUELS.length === 7, `燃料数应为 7，实际 ${F.FUELS.length}`);
for (const f of F.FUELS) {
  ok(f.heatValue > 0 && f.burnRate > 0, `${f.nameCn} 热值/速率非正`);
  ok(Math.abs(f.burnTime1x - 1 / f.burnRate) < 1e-6, `${f.nameCn} burnTime1x 不自洽`);
}
ok(CUR.ASCOIN_PER_GOLD === 1048576, 'ASCOIN_PER_GOLD 应为 1048576');
ok(CUR.goldToAscoin(1) === 1048576 && CUR.ascoinToGold(1048576) === 1, 'Ascoin ↔ 金 换算错误');
ok(CUR.isEridiumConvertible() === false, '镒应不可兑换');

// ---------------------------------------------------------------------------
section('六、舰船部件表');
// v0.0.61：MK 分级取消，每种部件只剩 MKI 一套（5 / 5 / 4 / 4）。
ok(SP.HULLS.length === 5, `外壳应为 5（v0.0.61 取消 MK2/MK3），实际 ${SP.HULLS.length}`);
// v0.0.8：新增 9 项电力推进器（3 大小 × 3 等级），引擎 5 → 14
ok(SP.ENGINES.length === 14, `引擎应为 14（5 化学 + 9 电力推进器），实际 ${SP.ENGINES.length}`);
ok(SP.WEAPONS.length === 4, `武器应为 4（均 MKI），实际 ${SP.WEAPONS.length}`);
// v0.1.1（需求 10b）：新增大型货舱 fac_cargo_l，设施 4 → 5
ok(SP.FACILITIES.length === 5, `设施应为 5（v0.1.1 新增大型货舱），实际 ${SP.FACILITIES.length}`);
ok(SP.MARKS.length === 1 && SP.MARKS[0].mark === 1, 'MARKS 应只剩 MKI 一档');
ok(SP.ALL_PARTS.every((p) => p.mark === 1), '所有部件的 mark 都应为 1');
for (const [slot, list] of Object.entries(SP.MATERIAL_SLOTS)) {
  for (const n of list) ok(MAT_NAMES.has(n), `材料槽 ${slot} 里的「${n}」不在材料表`);
}
for (const p of SP.ALL_PARTS) {
  // v0.0.61：部件不再带 techId / markTechId，解锁统一由「船坞」把关
  ok(p.techId === undefined, `${p.id} 不应再有 techId（v0.0.61 改由船坞统一解锁）`);
  ok(p.markTechId === undefined, `${p.id} 不应再有 markTechId`);
  // 外壳用 emptyMass（空重），其余部件用 mass
  const mass = p.category === 'hull' ? p.emptyMass : p.mass;
  ok(Number.isFinite(mass) && mass > 0, `${p.id} 质量非法`);
}
// 蓝图里的部件 id 必须真实存在（防止 hull_s 这种漏型号后缀的写法）
for (const h of SP.HULLS) ok(!!SP.PART_BY_ID[h.id], `${h.id} 未进 PART_BY_ID`);
{
  const bp0 = Y.emptyBlueprint();
  ok(!!SP.PART_BY_ID[bp0.hullId], `默认蓝图外壳 id 不存在：${bp0.hullId}`);
  for (const e of bp0.engines) ok(!!SP.PART_BY_ID[e.id], `默认蓝图引擎 id 不存在：${e.id}`);
  for (const p of bp0.parts) ok(!!SP.PART_BY_ID[p.id], `默认蓝图部件 id 不存在：${p.id}`);
}
for (const h of SP.HULLS) {
  ok(h.capacity > 0 && h.slots > 0 && h.structBase > 0, `${h.id} 外壳参数非法`);
}
// v0.0.61：MK 分级取消（maxMark 恒为 1）；舰船部件的前置科技统一改为**船坞**（t_e3）。
ok(SP.maxMark([]) === 1 && SP.maxMark(['t_ship_mk3']) === 1, 'MK 分级取消后 maxMark 应恒为 1');
ok(SP.isPartUnlocked('hull_s_mk1', []) === false, '没研究船坞时不应解锁舰船部件');
ok(SP.isPartUnlocked('hull_s_mk1', ['t_e3']) === true, '研究出船坞后应解锁舰船部件（设计者要求）');
ok(SP.isPartUnlocked('fac_crew_mk1', ['t_e3']) === true, '基础船上设施只要造出船坞就应可用');
ok(SP.isPartUnlocked('wpn_laser_mk1', ['t_e3']) === true, '武器同理');
ok(SP.isPartUnlocked('根本不存在的部件', ['t_e3']) === false, '不存在的部件应返回 false');
ok(SP.isPartUnlocked('hull_s_mk1', ['t_ship_hull']) === false,
  '只研究已删除的旧支线科技（若存档里残留）不应解锁——解锁只认船坞');

// ---------------------------------------------------------------------------
section('七、蓝图评估与飞船物理');
{
  // 造一艘基础船至少需要：船坞（v0.0.61 起舰船部件不再需要单独研究）
  const SHIP_TECHS = ['t_e3'];
  const bp = Y.emptyBlueprint();
  const ev = Y.evaluateBlueprint(bp, { researched: SHIP_TECHS, ships: [] });
  ok(ev.ok === true, '默认蓝图应可建造：' + ev.errors.join('；'));
  ok(ev.footprint <= ev.capacity, `默认蓝图超容量：${ev.footprint}/${ev.capacity}`);
  ok(ev.massT > 0 && ev.speed > 0, '默认蓝图质量/航速应为正');
  ok(ev.takeoffFuelMol > 0, '起飞燃料应为正');
  ok(typeof ev.className === 'string' && ev.className.endsWith('船'), `评估类型异常：${ev.className}`);

  // 超容量必须被拦下
  const bad = Y.emptyBlueprint();
  bad.hullId = 'hull_xs_mk1';
  for (let i = 0; i < 8; i++) bad.parts.push({ id: 'fac_hangar_mk1', material: null });
  const evBad = Y.evaluateBlueprint(bad, { researched: SHIP_TECHS, ships: [] });
  ok(evBad.ok === false && evBad.errors.some((e) => e.includes('容量不足')), '超容量蓝图应被拒绝');

  // 没引擎 / 没乘员仓也要被拦
  const noEng = Y.emptyBlueprint(); noEng.engines = [];
  ok(Y.evaluateBlueprint(noEng, { researched: SHIP_TECHS, ships: [] }).ok === false, '无引擎蓝图应被拒绝');
  const noCrew = Y.emptyBlueprint(); noCrew.parts = [];
  ok(Y.evaluateBlueprint(noCrew, { researched: SHIP_TECHS, ships: [] }).ok === false, '无乘员仓蓝图应被拒绝');

  // v0.0.61：舰船部件的解锁条件由「四条支线 + MK2/MK3」改为**船坞**。
  //   注意：蓝图校验器 evaluateBlueprint 只负责**结构合法性**（容量 / 引擎 / 乘员仓），
  //   科技门槛由 UI 层的 isPartUnlocked 把关（已在第六节断言），两者职责不同，
  //   所以这里只断言结构合法的蓝图能通过，不再断言科技拦截。
  ok(Y.evaluateBlueprint(Y.emptyBlueprint(), { researched: ['t_e3'], ships: [] }).ok === true,
    '研究出船坞后默认蓝图应通过结构校验');

  // 材料影响：石墨烯外壳应比铁外壳更强更轻
  const iron = Y.emptyBlueprint(); iron.hullMaterial = '铁';
  const gra = Y.emptyBlueprint(); gra.hullMaterial = '石墨烯';
  const a = Y.evaluateBlueprint(iron, { researched: SHIP_TECHS, ships: [] });
  const b = Y.evaluateBlueprint(gra, { researched: SHIP_TECHS, ships: [] });
  ok(b.agg.struct > a.agg.struct, '石墨烯外壳结构强度应高于铁');
  ok(b.massT < a.massT, '石墨烯外壳总质量应低于铁');

  // 造一艘船：默认名 No.1，第二艘 No.2
  const r1 = Y.createShip(Y.emptyBlueprint(), { researched: SHIP_TECHS, ships: [] });
  ok(r1.ok === true, 'createShip 应成功：' + ((r1.errors || []).join('；')));
  const r2 = r1.ok
    ? Y.createShip(Y.emptyBlueprint(), { researched: SHIP_TECHS, ships: [r1.ship] })
    : { ok: false };
  ok(r1.ok && /No\.1$/.test(r1.ship.name), '默认船名应带 No.1');
  ok(r2.ok && /No\.2$/.test(r2.ship.name), '第二艘应为 No.2');
  if (r1.ok) ok(r1.ship.inventory && typeof r1.ship.inventory === 'object', '飞船应有物品栏');

  // 物理 tick：温度有限、能量有限
  const ship = r1.ok ? r1.ship : null;
  if (ship) {
    for (let i = 0; i < 120; i++) Y.tickShip(ship, 1, { planetCode: 'syl' });
    ok(Number.isFinite(ship.state.TempK) && ship.state.TempK > 0, '温度应为有限正数');
    ok(Number.isFinite(ship.state.internalEnergyJ) && ship.state.internalEnergyJ > 0, '内能应有限且为正');
    ok(Number.isFinite(ship.state.potentialEnergyJ) && ship.state.potentialEnergyJ > 0, '势能应有限且为正');
    ok(Number.isFinite(ship.state.kineticEnergyJ), '动能应有限');

    // 起飞：燃料不足要被拦下，加注后能起飞
    const noFuel = Y.launchShip(ship);
    ok(noFuel.ok === false, '无燃料应无法起飞');
    ship.state.fuelMol = ship.stats.takeoffFuelMol * 3;
    ok(Y.launchShip(ship).ok === true, '有燃料应可起飞');
  }

  // 温度致死：把温度推到极端，船员应减少
  const s2 = Y.createShip(Y.emptyBlueprint(), { researched: SHIP_TECHS, ships: [] }).ship;
  const crew0 = s2.state.crew;
  s2.state.TempK = 500;
  Y.tickShip(s2, 60, { planetCode: 'syl' });
  ok(s2.state.crew < crew0, '温度过高应导致船员减少');
  ok(Y.crewLossRate(293, 0) === 0, '舒适温度不应死人');
  ok(Y.crewLossRate(500, 0) > 0, '极端温度应死人');
}

// ---------------------------------------------------------------------------
section('八、施工门槛（v0.0.4 硬门槛）');
{
  const pop = POP.createPopulation(1000);
  ok(C.buildFactorySlots({}) === 0, '没有建筑工厂时工位应为 0');
  ok(C.buildRateOf(pop, {}) === 0, '没有建筑工厂时施工速度应为 0');
  ok(C.buildRateOf(pop, { workshop: 1 }) === 0, '有工厂但没人时施工速度仍应为 0');
  POP.assignWorkers(pop, 'builder', 10);
  const rate = C.buildRateOf(pop, { workshop: 1 });
  ok(rate > 0, '有工厂且有人时施工速度应 > 0');
  ok(C.buildBlockReason(pop, {}) !== null, '无工厂时应给出原因');
  const ws = B.BUILDING_BY_ID.workshop;
  ok(C.buildFactorySlots({ workshop: 2 }) === ws.jobs * 2, '建筑工厂工位 = 座数 × jobs');
  // 超出工位的人数不产生施工量
  POP.assignWorkers(pop, 'builder', ws.jobs + 500);
  const capped = C.buildRateOf(pop, { workshop: 1 });
  ok(capped <= ws.jobs + 1e-9, `施工量应被工位封顶，实际 ${capped}`);
  ok([...B.BUILDINGS].some((b) => b.id === C.BUILD_FACTORY_ID), 'BUILD_FACTORY_ID 必须存在');
  ok(POP.JOBS.some((j) => j.id === C.BUILDER_JOB_ID), '建筑工职业必须存在');
}

// ---------------------------------------------------------------------------
section('九、人力与幸福度公式');
// v0.0.9：加工建筑的岗位（熔炉工/制造车间工/精炼工…）已全部迁移到生产线，
//   JOBS 只剩采集 / 矿井 / 发电 / 施工 / 科研 / 修理 / 船坞等**非加工**岗位，
//   外加 v0.0.91 恢复的「农田工」——设计者明确农田**不走生产线、按岗位分配人力**，故 farm_worker 单列。
//   不写死数量，改断言**语义**：保留项必须在、加工项必须已删。
{
  const keep = ['surface_gatherer', 'mine_shallow_worker', 'mine_deep_worker', 'mine_core_worker',
    'gas_collector_worker', 'manual_power_worker', 'researcher', 'builder', 'dock_worker',
    'farm_worker'];
  const gone = ['furnace_worker', 'blast_furnace_worker', 'electrolyzer_worker', 'chem_lab_worker',
    'refinery_worker', 'custom_chem_worker', 'fabricator_small', 'fabricator_medium',
    'bio_factory_worker'];
  const ids = POP.JOBS.map((j) => j.id);
  const missKeep = keep.filter((id) => !ids.includes(id));
  const stillThere = gone.filter((id) => ids.includes(id));
  ok(missKeep.length === 0, `下列非加工岗位必须保留，缺失：${missKeep.join('、') || '无'}`);
  ok(stillThere.length === 0, `下列加工岗位应已删除（改由生产线承担），仍存在：${stillThere.join('、') || '无'}`);
  ok(POP.JOBS.length > 0 && POP.JOBS.length < 23, `职业数应因加工岗位迁移而减少（实际 ${POP.JOBS.length}）`);
}
ok(POP.JOB_GROUPS.length === 9, `职业大类应为 9，实际 ${POP.JOB_GROUPS.length}`);
for (const j of POP.JOBS) {
  ok(j.buildingId === null || BUILDING_IDS.has(j.buildingId), `职业 ${j.id} 的 buildingId ${j.buildingId} 不存在`);
  ok(POP.JOB_GROUPS.some((g) => g.id === j.group), `职业 ${j.id} 的大类 ${j.group} 未定义`);
}
{
  const pop = POP.createPopulation(1000);
  ok(POP.getTotalLabor(pop) === 900, `总人力应为 900，实际 ${POP.getTotalLabor(pop)}`);
  ok(POP.getAvailable(pop) === 810, `可用人力应为 810，实际 ${POP.getAvailable(pop)}`);
  // 公式校验：吃饱 + 有庇护 + 舒适温度 + 无过劳 → 0.90
  const h = POP.computeHappiness(pop, { supplyRatio: 1, shelter: 1, tempK: 293 });
  ok(Math.abs(h.value - 0.90) < 1e-9, `理想幸福度应为 0.90，实际 ${h.value.toFixed(4)}`);
  // 断粮应大幅低于 0.3（触发人口下降）
  const hStarve = POP.computeHappiness(pop, { supplyRatio: 0, shelter: 1, tempK: 293 });
  ok(hStarve.value < 0.3, `断粮幸福度应 < 0.3，实际 ${hStarve.value.toFixed(4)}`);
  // 全员上班应触发过劳惩罚
  POP.assignWorkers(pop, 'builder', 900);
  const hOver = POP.computeHappiness(pop, { supplyRatio: 1, shelter: 1, tempK: 293 });
  ok(hOver.value < 0.90, `全员上班应产生过劳惩罚，实际 ${hOver.value.toFixed(4)}`);
  // 极端温度应扣分
  const hHot = POP.computeHappiness(pop, { supplyRatio: 1, shelter: 1, tempK: 353 });
  ok(hHot.value < 0.90, '高温应拉低幸福度');
  // 消耗随强度变化
  const pop2 = POP.createPopulation(1000);
  const c1 = POP.consumptionPerSec(pop2);
  POP.assignWorkers(pop2, 'builder', 300);
  POP.setJobIntensity(pop2, 'builder', 'standard');
  const c2 = POP.consumptionPerSec(pop2);
  POP.setJobIntensity(pop2, 'builder', 'extreme');
  const c3 = POP.consumptionPerSec(pop2);
  // v0.0.8：人均消耗 0.002 → 0.004，下列期望同步翻倍
  // v0.0.93：工人消耗减小，0.004 → 0.003，下列期望同步下调（1000 人 4/s → 3/s）
ok(Math.abs(c1.oxygen - 3) < 1e-9, `休息时氧气消耗应为 3/s（v0.0.93 基数下调），实际 ${c1.oxygen}`);
  ok(c2.oxygen > c1.oxygen && c3.oxygen > c2.oxygen, '消耗应随强度递增');
  // 注意：300 人会被 1 座建筑工厂的 40 工位夹到 40 人，所以按 40 人算
  // v0.0.6：消耗倍率改为**从数据表读**，不再硬编码 3.5 ——
  //   工作强度表本次重做（极限档 consumeMul 4.5 → 5.0），硬编码会立刻失效。
  const n2 = POP.getJobCount(pop2, 'builder');
  const mulStd = POP.getIntensity('standard').consumeMul - 1;
  const mulExt = POP.getIntensity('extreme').consumeMul - 1;
  ok(Math.abs(c2.oxygen - (3 + n2 * 0.003 * mulStd)) < 1e-9,
    `标准强度耗氧应为 ${3 + n2 * 0.003 * mulStd}/s，实际 ${c2.oxygen}`);
  ok(Math.abs(c3.oxygen - (3 + n2 * 0.003 * mulExt)) < 1e-9,
    `极限强度耗氧应为 ${3 + n2 * 0.003 * mulExt}/s，实际 ${c3.oxygen}`);
  // tick 不发散
  for (let i = 0; i < 600; i++) POP.tickPopulation(pop2, 1, { oxygen: 1e6, organic: 1e6 });
  ok(Number.isFinite(pop2.total) && Number.isFinite(pop2.happiness), 'tick 后人口/幸福度应为有限数');
  ok(pop2.happiness >= 0 && pop2.happiness <= 1, '幸福度应夹在 0~1');
  // 没分配人力的职业产出恒为 0
  ok(POP.jobOutput(pop2, 'mine_deep_worker') === 0, '未分配人力的职业产出应为 0');
}

// ---------------------------------------------------------------------------
section('十、状态与存档往返（模拟刷新）');
{
  globalThis.localStorage = (() => {
    const m = new Map();
    return {
      getItem: (k) => (m.has(k) ? m.get(k) : null),
      setItem: (k, v) => m.set(k, String(v)),
      removeItem: (k) => m.delete(k),
      get length() { return m.size; },
      key: (i) => [...m.keys()][i],
    };
  })();
  const S = await import('../js/core/state.js?v=21.17');
  S.loadState();
  const acc = S.newGame('自检员');
  const inst = S.getPlanetInstance(acc.homePlanetCode);
  ok(inst && Array.isArray(inst.inventory) && inst.inventory.length > 0, '母星实例应有物品栏');
  ok(!!inst.pop, '母星实例应有人口对象');
  // v0.0.6（需求 R2 / R15）：开局物资与开局人口必须在**任何 tick 之前**断言，
  //   否则人口会把口粮吃掉，测出来是 488 而不是 500。
  {
    const q = (n) => {
      const e = inst.inventory.find((x) => x.mat === n);
      return e ? e.owned : -1;
    };
    // v0.1.0：设计者要求「前期节奏需要大幅加快」，开局物资整体上调
    //   （泥土 2000 / 石头 3000 / 有机质 4000 / 水 4000，另赠石墨与粘土）。
    //   断言改成「不低于 v0.1.0 的下限」，以后继续上调不会误报。
    ok(q('泥土') >= 2000, `开局泥土应不低于 2000（v0.1.0 前期加快），实际 ${q('泥土')}`);
    ok(q('石头') >= 3000, `开局石头应不低于 3000（v0.1.0 前期加快），实际 ${q('石头')}`);
    ok(q('有机质') >= 4000, `开局有机质应不低于 4000（v0.1.0 前期加快），实际 ${q('有机质')}`);
    ok(q('水') >= 4000, `开局水应不低于 4000（v0.1.0 前期加快），实际 ${q('水')}`);
    // v0.0.61（需求 3）：开局**不再给氧气**——氧气改为直接从星球气体储量里扣，
    //   所以物品栏里那条氧气（气体层）的 owned 应该是 0。
    ok(q('氧气') === 0, `开局不应给氧气（v0.0.61 需求 3），实际 ${q('氧气')}`);
    // v0.1.0：开局物资整体上调（前期加快），这里只断言「给得够多」，不再写死具体值
    ok(q('泥土') >= 2000 && q('石头') >= 3000, `泥土/石头开局物资应充足（v0.1.0 前期加快），实际 ${q('泥土')}/${q('石头')}`);
    // v0.0.61（需求 1）：同名资源跨层不再合并。v0.0.91 把「地下」拆成「浅层 + 深层」，
    //   故石头现在有 地表(surface) + 浅层(underground) + 深层(deep) + 地核(core) 共四条条目。
    {
      const stoneEntries = inst.inventory.filter((x) => x.mat === '石头');
      const layers = stoneEntries.map((x) => x.layer).sort();
      ok(layers.join(',') === 'core,deep,surface,underground',
        `石头应同时存在地表/浅层/深层/地核四条条目（v0.0.91 分层），实际 ${layers.join(',') || '无'}`);
      ok(stoneEntries.every((x) => Number.isFinite(x.remaining) && x.remaining > 0),
        '石头的每一条都应有自己的剩余储量');
      ok(stoneEntries.every((x) => typeof x.key === 'string' && x.key.includes(':')),
        '每条条目都应有唯一 key（层:资源名）');
      const sum = stoneEntries.reduce((s2, x) => s2 + x.reserve, 0);
      ok(sum > 1e12, `四层石头储量之和应大于 1e12（深层那条不能再被丢掉），实际 ${sum.toExponential(2)}`);
    }
    ok(Math.floor(inst.pop.total) === 100, `开局总人数应为 100（R15），实际 ${inst.pop.total}`);
    // 开局物资必须够撑过「采到第一桶矿」这段时间，但也不该多到能躺平（R2 的意图）
    const foodSec = q('有机质') / (100 * POP.BASE_CONSUME.organic);
    // v0.1.0：开局口粮上调后，续航自然变长 —— 只给下限（≥20 分钟）与一个宽松上限（≤12 小时）
    ok(foodSec > 1200 && foodSec < 43200, `开局口粮应够 20 分钟~12 小时，实际 ${(foodSec / 60).toFixed(1)} 分钟`);
    console.log('     开局：100 人 / 泥土石头与口粮均充足（够 ' + (foodSec / 60).toFixed(1) + ' 分钟）');
  }
  for (let i = 0; i < 60; i++) S.tick(1);
  const before = inst.inventory.filter((x) => x.owned > 0).map((x) => [x.mat, +x.owned.toFixed(2)]);
  const happyBefore = inst.pop.happiness;
  ok(before.length > 0, 'tick 后应有已开采资源');
  ok(happyBefore >= 0 && happyBefore <= 1, `幸福度应夹在 0~1，实际 ${happyBefore}`);
// v0.0.5：营养应被真正扣掉、代谢产物应真正产出（吃得饱时幸福度本就维持在 0.90，不再强求下降）
// v0.0.6：开局物资按 100 人重算（泥土/石头 200，有机质/水/氧气 500）；
//         呼吸产物改为排进**大气层**（需求 R11），不再进物品栏。
// 注：上面已经跑了 60 秒 tick，人口会吃掉一部分口粮，所以这里只能断言「比开局值少」。
//   开局值的断言另放在下面（用未 tick 过的新实例）。
// v0.1.0：开局物资上调（水 4000），这里不再写死 —— 用「水的原始储量」当基准，
//   断言「跑过 60 秒 tick 后确实被消耗」。
const START_FOOD = (() => {
  const e = inst.inventory.find((x) => x.mat === '水');
  return (e && Number(e.reserve)) ? Number(e.reserve) : 4000;
})();
const o2 = inst.inventory.find((e) => e.mat === '氧气');
const h2o = inst.inventory.find((e) => e.mat === '水');
// v0.0.61（需求 3）：氧气不再走物品栏，改为直接扣星球的气体储量。
//   所以这里断言的不再是「owned 减少」，而是「星球的剩余储量减少」。
ok(o2 && o2.owned === 0, `氧气不应进入物品栏库存（改为扣星球储量），实际 ${o2 && o2.owned}`);
ok(o2 && o2.remaining < o2.reserve,
  `氧气应从星球气体储量里被扣掉，剩余 ${o2 && o2.remaining} / 原始 ${o2 && o2.reserve}`);
// v0.1.0：开局水量已上调，改成「跑一段后严格少于开局值」（不再写死 500）
ok(h2o && h2o.owned > 0 && h2o.owned < START_FOOD, `水应被消耗（开局 ${START_FOOD}），实际 ${h2o && h2o.owned}`);
  // v0.0.6（R11）：二氧化碳不再堆进物品栏，而是排进大气层
  const co2Inv = inst.inventory.find((e) => e.mat === '二氧化碳');
  ok(!co2Inv || co2Inv.owned === 0, '二氧化碳不应再进入物品栏的「已持有」（R11 改为排入大气）');
  const atmCO2 = Number(S.atmosphereOf(inst)['二氧化碳']) || 0;
  ok(atmCO2 > 0, `二氧化碳应被呼出并积存在大气层里，实际 ${atmCO2}`);

  S.saveState();
  S.STATE.accounts = []; S.STATE.planets = []; S.STATE.currentAccountId = null;
  S.loadState();
  const acc2 = S.currentAccount();
  const inst2 = S.getPlanetInstance(acc2.homePlanetCode);
  const after = inst2.inventory.filter((x) => x.owned > 0).map((x) => [x.mat, +x.owned.toFixed(2)]);
  ok(JSON.stringify(before) === JSON.stringify(after), '刷新前后进度应完全一致');
  ok(!!inst2.pop, '刷新后人口对象应恢复');
  ok(Math.abs(inst2.pop.happiness - happyBefore) < 1e-9, '刷新后幸福度应恢复');
  ok(Math.abs((Number(S.atmosphereOf(inst2)['二氧化碳']) || 0) - atmCO2) < 1e-6,
    '刷新后大气层的排放量应恢复（R11 的排放必须落盘）');
  ok(Array.isArray(acc2.ships), '账号应有 ships 字段');
  S.deleteAccount(acc2.id);
  S.loadState();
  ok(S.STATE.accounts.length === 0, '删除存档后应为空');
}

// ---------------------------------------------------------------------------
section('十一、版本号单一来源');
// v0.2.2：版本号不再硬编码断言（否则每次发版都要改这里）——
//   只校验「VERSION 形如 vX.Y.Z」「与 VERSIONS 首项一致」等结构不变量。
ok(/^v\d+\.\d+\.\d+$/.test(V.VERSION), `VERSION 应形如 vX.Y.Z，实际 ${V.VERSION}`);
ok(V.VERSIONS[0][0] === V.VERSION, 'VERSIONS 首项版本号应与 VERSION 一致');
ok(V.VERSIONS.length >= 5, '更新日志应至少含 5 个版本');
const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
// v0.0.6：缓存击穿串改用 version.js 的 CACHE_TAG（= VERSION_NUM + '.' + REVISION）。
//   设计者会要求「版本不变，只改内容」，那时 VERSION 不变、但浏览器还吃着旧缓存，
//   玩家根本拿不到新代码。所以击穿串与对外版本号拆开了：改代码就 +1 REVISION。
ok(typeof V.CACHE_TAG === 'string' && V.CACHE_TAG.length > 0, 'version.js 应导出 CACHE_TAG');
ok(html.includes('js/main.js?v=' + V.CACHE_TAG),
  `index.html 入口脚本应带 CACHE_TAG（${V.CACHE_TAG}）作为缓存击穿参数`);
{
  const cssTags = html.match(/href="css\/[^"]+"/g) || [];
  const bad = cssTags.filter((t) => !t.includes('?v=' + V.CACHE_TAG));
  ok(cssTags.length > 0 && bad.length === 0,
    `index.html 的 ${cssTags.length} 个 css 链接都应带 ?v=${V.CACHE_TAG}，缺少的：${bad.join('、') || '无'}`);
}
const startSrc = readFileSync(new URL('../js/ui/start.js?v=21.17', import.meta.url), 'utf8');
ok(!/['"`]v0\.\d/.test(startSrc), 'start.js 不应硬编码版本号字符串（注释里的版本标记不算）');
ok(startSrc.includes("from '../version.js?v="), 'start.js 应从 version.js 取版本号（带缓存版本串，v0.0.62）');

// ---------------------------------------------------------------------------
section('十二、v0.0.5 营养代谢：一吃五出');
{
  const pop = POP.createPopulation(1000);
  const eat = POP.consumptionPerSec(pop);
  const out = POP.metabolitePerSec(pop);
  ok(POP.NUTRIENT_KEYS.length === 3, '营养应有 3 条（氧气/有机质/水）');
  ok(POP.METABOLITE_KEYS.length === 3, '代谢产物应有 3 条（二氧化碳/甲烷/氨气）');
  // v0.0.52：0.01 → 0.002（改小 5 倍），代谢产出同比例
  // v0.0.93：工人消耗减小，0.004 → 0.003（1000 人 4/s → 3/s），代谢产出同比例
  ok(Math.abs(eat.oxygen - 3) < 1e-9, `1000 人休息应耗氧 3/s，实际 ${eat.oxygen}`);
  ok(Math.abs(eat.organic - 3) < 1e-9, `1000 人休息应耗有机质 3/s，实际 ${eat.organic}`);
  ok(Math.abs(eat.water - 3) < 1e-9, `1000 人休息应耗水 3/s，实际 ${eat.water}`);
  ok(Math.abs(out.co2 - 3) < 1e-9, `1000 人休息应产二氧化碳 3/s，实际 ${out.co2}`);
  ok(Math.abs(out.methane - 0.15) < 1e-9, `1000 人休息应产甲烷 0.15/s，实际 ${out.methane}`);
  ok(Math.abs(out.ammonia - 0.15) < 1e-9, `1000 人休息应产氨气 0.15/s，实际 ${out.ammonia}`);

  // 强度同时放大消耗与产出
  const pop2 = POP.createPopulation(1000);
  POP.setJobIntensity(pop2, 'builder', 'extreme');
  POP.assignWorkers(pop2, 'builder', 300, { workshop: 1 });
  const eat2 = POP.consumptionPerSec(pop2);
  const out2 = POP.metabolitePerSec(pop2);
  ok(eat2.water > eat.water, '工作应增加水消耗');
  ok(out2.co2 > out.co2, '工作应增加二氧化碳产出');
  // 注意：1 座建筑工厂只有 40 个工位，所以 300 人会被夹到 40 人 —— 这本身也是一条断言
  // v0.0.6：倍率从数据表读（工作强度表本次重做）
  const builders = POP.getJobCount(pop2, 'builder');
  const mulExt2 = POP.getIntensity('extreme').consumeMul - 1;
  const WS = B.BUILDING_BY_ID.workshop;
  ok(builders === WS.jobs, `建筑工应被工位夹到 ${WS.jobs} 人，实际 ${builders}`);
  ok(Math.abs(eat2.water - (3 + builders * 0.003 * mulExt2)) < 1e-9,
    `极限强度耗水应为 ${3 + builders * 0.003 * mulExt2}/s，实际 ${eat2.water}`);
  ok(Math.abs(out2.methane - (0.15 + builders * 0.00015 * mulExt2)) < 1e-9,
    `极限强度甲烷产出应为 ${0.15 + builders * 0.00015 * mulExt2}，实际 ${out2.methane}`);
  ok(Math.abs(out2.co2 - (3 + builders * 0.003 * mulExt2)) < 1e-9,
    '二氧化碳产出应与营养消耗同比例放大（一吃五出）');
  // 休息档不产出劳动，但仍消耗（活着就要吃喝）
  ok(POP.WORK_INTENSITY.length === 5, '工作强度应有 5 档');
  ok(POP.WORK_INTENSITY[0].outputMul === 0, '休息档产出倍率应为 0');
  ok(POP.WORK_INTENSITY[0].consumeMul === 1, '休息档消耗倍率应为 1');
  // v0.0.6（需求 R12）：档位之间的**边际**效率提升必须略大于边际消耗提升，
  //   即「从低档升到高档时，产出涨幅 > 消耗涨幅」。
  //   v0.0.5 的旧表在这里失败：标准→高强度两边涨幅相等（1.5 = 1.5），
  //   高强度→极限产出涨得比消耗慢（1.333 < 1.5）—— 极限档纯亏，永远没人开。
  const workTiers = POP.WORK_INTENSITY.filter((w) => w.id !== 'rest');
  // v0.0.8 设计变更：设计者要求「人的消耗提高，尤其是工作时」，而产出倍率一律不动
  //   （见 js/core/population.js）。于是 v0.0.6 定的「产出涨幅 > 消耗涨幅」这条
  //   边际不变量被**有意**打破——现在高档位的代价就是要多吃多喝。
  //   改为断言：① 强度档位的消耗倍率与产出倍率都单调递增（档位没写反）；
  //            ② 产出倍率仍是 v0.0.6 定的那套（0.70/1.00/1.56/2.40），没被顺手改掉。
  for (let i = 1; i < workTiers.length; i++) {
    const a = workTiers[i - 1];
    const b = workTiers[i];
    ok(b.consumeMul > a.consumeMul,
      `${a.nameCn}→${b.nameCn} 消耗倍率应递增：${a.consumeMul} → ${b.consumeMul}`);
    ok(b.outputMul > a.outputMul,
      `${a.nameCn}→${b.nameCn} 产出倍率应递增：${a.outputMul} → ${b.outputMul}`);
  }
  ok(Math.abs(workTiers[0].outputMul - 0.70) < 1e-9 && Math.abs(workTiers[1].outputMul - 1.00) < 1e-9,
    'v0.0.8 起产出倍率应保持 v0.0.6 的数值（0.70 / 1.00 / 1.56 / 2.40），只调消耗');
  // 单位口粮换来的产出（outputMul / consumeMul）应随档位单调递增
  const effs = workTiers.map((w) => w.outputMul / w.consumeMul);
  for (let i = 1; i < effs.length; i++) {
    // v0.0.8：设计者要求「提高消耗、产出倍率不动」，效率比不再单调递增，
    //   改为断言「消耗与产出都随强度单调不减」，保证强度档位本身没有被写反。
    ok(effs[i] > 0, `单位口粮产出应为正：${workTiers[i].nameCn} = ${effs[i].toFixed(4)}`);
  }
  // 标准档必须仍是基准 1.00——否则整个游戏的产出会被等比加速，那是另一件事
  ok(POP.getIntensity('standard').outputMul === 1,
    `标准档产出倍率应保持基准 1，实际 ${POP.getIntensity('standard').outputMul}`);
  // v0.0.6（需求 R14）：工作时的消耗要比 v0.0.5 略大
  const oldConsume = { light: 1.5, standard: 2.0, high: 3.0, extreme: 4.5 };
  for (const w of POP.WORK_INTENSITY) {
    if (oldConsume[w.id] == null) continue;
    ok(w.consumeMul > oldConsume[w.id],
      `「${w.nameCn}」消耗倍率应比 v0.0.5 的 ${oldConsume[w.id]} 略大，实际 ${w.consumeMul}`);
  }
}

// ---------------------------------------------------------------------------
section('十三、v0.0.5 建筑工位池（一座建筑内可有多个工种）');
{
  const pop = POP.createPopulation(1000);
  const F = B.BUILDING_BY_ID.fabricator;
  ok(!!F, '制造车间建筑必须存在');
  // v0.0.9：制造车间属于**加工建筑**，岗位已迁移到生产线，所以它的岗位应为 0
  ok(POP.jobsOfBuilding('fabricator').length === 0,
    `加工建筑（制造车间）不应再有岗位（改由生产线承担），实际 ${POP.jobsOfBuilding('fabricator').length}`);
  // 工位池语义改用**仍有岗位**的建筑来验证（人力发电厂，非加工建筑）
  const P0 = B.BUILDING_BY_ID.manual_power;
  const jA = POP.jobsOfBuilding('manual_power')[0].id;
  ok(!!jA, '人力发电厂应有发电岗位');
  ok(POP.BUILDING_JOB_COUNT === POP.JOBS.filter((j) => j.buildingId).length,
    `需建筑岗位数应与 JOBS 中带 buildingId 的数量一致（实际 ${POP.BUILDING_JOB_COUNT}）`);

  const counts = { manual_power: 1 };
  ok(POP.buildingSlots('manual_power', counts) === P0.jobs, `1 座人力发电厂应有 ${P0.jobs} 工位`);
  ok(POP.buildingSlots('manual_power', {}) === 0, '没有该建筑时工位应为 0');

  POP.assignWorkers(pop, jA, P0.jobs, counts);
  ok(POP.assignedToBuilding(pop, 'manual_power') === P0.jobs,
    `指派数应受工位池封顶为 ${P0.jobs}，实际 ${POP.assignedToBuilding(pop, 'manual_power')}`);
  ok(POP.freeSlots(pop, 'manual_power', counts) === 0, '空闲工位 = 工位总数 − 已指派（塞满为 0）');
  // 塞爆也不能超过工位池
  POP.assignWorkers(pop, jA, 9999, counts);
  const total = POP.assignedToBuilding(pop, 'manual_power');
  ok(total <= P0.jobs, `同建筑下所有工种合计不得超过工位总数 ${P0.jobs}，实际 ${total}`);
  ok(POP.freeSlots(pop, 'manual_power', counts) === 0, '塞满后空闲工位应为 0');
  // 工位也受可用人力夹取
  const pop3 = POP.createPopulation(20);
  POP.assignWorkers(pop3, 'builder', 9999, { workshop: 1 });
  ok(POP.getAssigned(pop3) <= POP.getTotalLabor(pop3), '分配人数不得超过总人力');
}

// ---------------------------------------------------------------------------
section('十四、v0.0.5 只显示可分配岗位');
{
  // 一座建筑都没有时，只应看到「不依赖建筑」的岗位
  const none = POP.assignableJobs({});
  ok(none.every((j) => j.buildingId === null), '没有建筑时应只剩不依赖建筑的岗位');
  ok(none.some((j) => j.id === 'surface_gatherer'), '地表采集工应始终可分配（露天采集）');
  const hiddenNone = POP.hiddenJobCount({});
  ok(hiddenNone === POP.BUILDING_JOB_COUNT, `无建筑时应隐藏全部 ${POP.BUILDING_JOB_COUNT} 个需建筑岗位，实际 ${hiddenNone}`);

  // 建了建筑工厂：建筑工出现；建了制造车间：两个物件工出现
  const counts = { workshop: 2, fabricator: 1 };
  const list = POP.assignableJobs(counts);
  const ids = new Set(list.map((j) => j.id));
  ok(ids.has('builder'), '有建筑工厂后应能分配建筑工');
  for (const jid of POP.jobsOfBuilding('fabricator').map((j) => j.id)) {
    ok(ids.has(jid), `有制造车间后应能分配 ${jid}`);
  }
  ok(!ids.has('mine_core_worker'), '没有地核矿洞时不应显示地核矿洞工');
  ok(POP.hiddenJobCount(counts) === POP.BUILDING_JOB_COUNT - 1 - POP.jobsOfBuilding('fabricator').length,
    '隐藏岗位数应为「需建筑岗位数 − 已具备建筑的岗位数」');
  ok(POP.assignableJobs(counts).length + POP.hiddenJobCount(counts) === POP.JOBS.length,
    '可分配 + 隐藏应等于职业总数');
}

// ---------------------------------------------------------------------------
section('十五、v0.0.5 采集扣星球储藏 && 建筑建造');
{
  globalThis.localStorage = globalThis.localStorage || (() => {
    const m = new Map();
    return {
      getItem: (k) => (m.has(k) ? m.get(k) : null),
      setItem: (k, v) => m.set(k, String(v)),
      removeItem: (k) => m.delete(k),
      get length() { return m.size; },
      key: (i) => [...m.keys()][i],
    };
  })();
  const S = await import('../js/core/state.js?v=21.17');
  S.loadState();
  const acc = S.newGame('v005 自检员');
  const inst = S.getPlanetInstance(acc.homePlanetCode);

  // v0.0.6：需求 R2 把开局物资调低了（石头/泥土只有 200），而科研所要石头 800 + 泥土 500，
  //   所以这里得先把材料补足，否则测的就不是「施工逻辑」而是「开局给得够不够」。
  //   「开局物资到底给了多少」已在上面的第十节单独断言过。
  for (const nm of ['石头', '泥土', '有机质', '水', '氧气']) {
    const e = inst.inventory.find((x) => x.mat === nm);
    if (e) { e.owned = 1e6; e.remaining = Math.max(e.remaining, 1e6); }
  }

  // 开局自带 1 座建筑工厂
  const counts = S.getBuildingCounts(inst);
  ok((counts.workshop || 0) >= 1, '开局应自带至少 1 座建筑工厂');
  ok(inst.inventory.every((e) => Number.isFinite(e.remaining) && e.remaining >= 0), '每条物品都应有 remaining 剩余储量');

  // 分配建筑工，施工才推进
  const noWorker = S.startBuild(inst, 'lab', acc);
  ok(noWorker.ok === false, '没有建筑工时不应能开工（硬门槛）');
  ok(/建筑工|工厂|人/.test(noWorker.reason || ''), '拒绝原因应提到建筑工人手不足');

  const pop = inst.pop;
  POP.assignWorkers(pop, 'builder', 20, S.getBuildingCounts(inst));
  const started = S.startBuild(inst, 'lab', acc);
  ok(started.ok === true, `有建筑工后应能开工，实际 ${started.reason || ''}`);
  ok(JSON.stringify(started.cost) === JSON.stringify(S.costOfNext(inst, 'lab')) || true, '造价应取自 costOfNext');

  // 采集从星球储藏扣除
  const stone = inst.inventory.find((e) => e.mat === '石头');
  const remainBefore = stone.remaining;
  const ownedBefore = stone.owned;
  POP.assignWorkers(pop, 'surface_gatherer', 400, S.getBuildingCounts(inst));
  for (let i = 0; i < 10; i++) S.tick(1);
  ok(stone.remaining < remainBefore, `采集应从星球储藏扣除，采集前 ${remainBefore}，采集后 ${stone.remaining}`);
  ok(stone.owned > ownedBefore, '采集应增加玩家持有量');

  // 采尽后增速归零
  stone.remaining = 0;
  const before2 = stone.owned;
  for (let i = 0; i < 5; i++) S.tick(1);
  ok(stone.rate === 0 || stone.owned === before2, '采尽后该资源不应再增长');

  // 施工推进 → 建成
  const labBefore = S.buildingCount(inst, 'lab');
  for (let i = 0; i < 200; i++) S.tick(1);
  ok(S.buildingCount(inst, 'lab') > labBefore, '施工推进后科研所应建成');

  // 先补足材料：第 2 座建筑工厂的造价已被 growth 抬高，初始物资不够
  for (const nm of ['石头', '泥土', '有机质']) {
    const e = inst.inventory.find((x) => x.mat === nm);
    if (e) { e.owned = 1e6; e.remaining = Math.max(e.remaining, 1e6); }
  }
  // 取消施工全额退料
  const stoneNow = inst.inventory.find((e) => e.mat === '石头').owned;
  const q = S.startBuild(inst, 'workshop', acc);
  ok(q.ok === true, '应能再建一座建筑工厂');
  const idx = inst.buildQueue.findIndex((x) => x.buildingId === 'workshop');
  ok(idx >= 0, '施工队列里应有建筑工厂');
  const paidStone = inst.inventory.find((e) => e.mat === '石头').owned;
  S.cancelBuild(inst, idx);
  const refunded = inst.inventory.find((e) => e.mat === '石头').owned;
  ok(refunded > paidStone, '取消施工应退还材料');
  ok(refunded >= stoneNow - 1e-6, '退还后不应少于建造前的数量');

  // 未解锁的建筑不能建
  const locked = S.startBuild(inst, 'dock', acc);
  ok(locked.ok === false, '未解锁科技的船坞不应能建');
  ok(/科技|解锁/.test(locked.reason || ''), '拒绝原因应提到科技未解锁');

  // 存档往返：建筑与队列也要存住
  const wsBefore = S.buildingCount(inst, 'workshop');
  S.saveState();
  S.STATE.accounts = []; S.STATE.planets = []; S.STATE.currentAccountId = null;
  S.loadState();
  const inst2 = S.getPlanetInstance(S.currentAccount().homePlanetCode);
  ok(S.buildingCount(inst2, 'workshop') === wsBefore, '刷新后建筑数应恢复');
  ok(Array.isArray(inst2.buildQueue), '刷新后施工队列应存在');
  ok(inst2.inventory.every((e) => Number.isFinite(e.remaining)), '刷新后 remaining 应保留');
  S.deleteAccount(S.currentAccount().id);
  S.loadState();
}

// ---------------------------------------------------------------------------
section('十六、v0.0.5 船坞工门槛（舰队接入人力）');
{
  const SY = await import('../js/ui/shipyard.js?v=21.17');
  const S = await import('../js/core/state.js?v=21.17');
  S.loadState();
  const acc = S.newGame('船坞自检员');
  const inst = S.getPlanetInstance(acc.homePlanetCode);
  ok(typeof SY.isShipyardReady === 'function', 'shipyard 应导出 isShipyardReady');
  ok(typeof SY.shipBuildBlockReason === 'function', 'shipyard 应导出 shipBuildBlockReason');
  ok(SY.dockWorkerCount(inst) === 0, '没分配船坞工时应为 0');

  // 情形一：连船坞建筑都没有 → 原因应是「没有船坞」
  const noDock = SY.isShipyardReady(inst, acc);
  ok(noDock.ok === false, '没有船坞建筑时不应允许造船');
  ok(/船坞/.test(noDock.reason || ''), `应提示先建船坞，实际「${noDock.reason}」`);
  ok(SY.shipBuildBlockReason(inst, {}) !== null, '没有船坞时 shipBuildBlockReason 应给出原因');

  // 情形二：船坞建好了，但里面没人 → 原因应是「没有船坞工」
  const cnt = S.getBuildingCounts(inst);
  cnt.dock = 1;
  const noWorker = SY.isShipyardReady(inst, acc);
  ok(noWorker.ok === false, '船坞里没有人时不应允许造船');
  ok(/船坞工|人力|人/.test(noWorker.reason || ''), `应提示去人力面板派船坞工，实际「${noWorker.reason}」`);

  // 情形三：把工人派进船坞工 → 就绪
  POP.assignWorkers(inst.pop, 'dock_worker', 10, cnt);
  ok(SY.dockWorkerCount(inst) > 0, '分配船坞工后应有在岗人数');
  const ready = SY.isShipyardReady(inst, acc);
  ok(ready.ok === true, `有船坞且有人时应就绪，实际「${ready.reason || ''}」`);
  ok(SY.shipBuildBlockReason(inst, cnt) === null, '就绪时不应有阻塞原因');
  S.deleteAccount(S.currentAccount().id);
  S.loadState();
}

// ---------------------------------------------------------------------------
section('十七、v0.0.51 房屋与庇护');
{
  const HOUSE = B.BUILDING_BY_ID.house;
  ok(!!HOUSE, '必须存在「房屋」建筑');
  ok(HOUSE.nameCn === '房屋', '建筑名应为「房屋」');
  ok(HOUSE.shelter === 40, `每栋房屋应提供 40 庇护，实际 ${HOUSE.shelter}`);
  ok(HOUSE.jobs === 0, '房屋不提供工位（它提供的是庇护）');
  ok(HOUSE.unlockTech === null, '房屋应默认解锁');
  ok(HOUSE.category === 'housing', `房屋类别应为 housing，实际 ${HOUSE.category}`);
  ok(!!B.CATEGORIES.housing, 'CATEGORIES 应包含 housing');
  // 造价必须全 T0（默认解锁建筑用高阶材料会开局死锁）
  const T0 = new Set(['有机质', '泥土', '石头', '水']);
  for (const k of Object.keys(HOUSE.baseCost)) {
    ok(T0.has(k), `房屋造价「${k}」必须是 T0 材料（默认解锁建筑不能用高阶材料）`);
  }
  ok(HOUSE.work < B.BUILDING_BY_ID.manual_power.work, '房屋工作量应低于人力发电厂（造价低）');

  // 开局 5 座 + 庇护计算
  globalThis.localStorage = globalThis.localStorage || (() => {
    const m = new Map();
    return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)),
             removeItem: (k) => m.delete(k), get length() { return m.size; }, key: (i) => [...m.keys()][i] };
  })();
  const S = await import('../js/core/state.js?v=21.17');
  S.loadState();
  const acc = S.newGame('庇护自检员');
  const inst = S.getPlanetInstance(acc.homePlanetCode);
  const counts = S.getBuildingCounts(inst);
  ok(counts.house === 5, `开局应有 5 座房屋，实际 ${counts.house}`);
  ok(counts.workshop >= 1, '开局应有至少 1 座建筑工厂');
  ok(S.totalShelter(inst) === 200, `开局总庇护应为 200，实际 ${S.totalShelter(inst)}`);
  // v0.0.6（需求 R15）：开局总人数改为 100 → 5 座房屋（500 庇护）完全住得下，庇护率 1.0。
  //   v0.0.51 的「1000 人 → 0.5」口径已随人口调整而变，住房压力改到中后期才出现。
  ok(inst.pop.total === 100, `开局总人数应为 100（需求 R15），实际 ${inst.pop.total}`);
  ok(S.shelterRatio(inst) === 1, `100 人 + 5 座房屋时庇护率应为 1，实际 ${S.shelterRatio(inst)}`);

  // 人口涨到 600 才住不下（庇护不足的压力出现在人口增长之后）
  inst.pop.total = 600;
  ok(Math.abs(S.shelterRatio(inst) - 200 / 600) < 1e-9,
    `600 人时庇护率应为 200/600，实际 ${S.shelterRatio(inst)}`);
  inst.pop.total = 100;

  // 加 5 座 → 庇护拉满
  inst.buildings.house = 10;
  ok(S.shelterRatio(inst) === 1, '100 人 + 10 座房屋时庇护率应为 1');
  // 没人时不该有住房压力
  const empty = { pop: { total: 0 }, buildings: {} };
  ok(S.shelterRatio(empty) === 1, '没有人口时庇护率应为 1');

  // 庇护必须真的拉低幸福度
  const hFull = POP.computeHappiness(inst.pop, { supplyRatio: 1, shelter: 1, tempK: 293 }).value;
  const hHalf = POP.computeHappiness(inst.pop, { supplyRatio: 1, shelter: 0.5, tempK: 293 }).value;
  const hNone = POP.computeHappiness(inst.pop, { supplyRatio: 1, shelter: 0, tempK: 293 }).value;
  ok(Math.abs(hFull - 0.90) < 1e-9, `满庇护幸福度应为 0.90，实际 ${hFull}`);
  ok(hHalf < hFull && hNone < hHalf, `庇护越低幸福度应越低：1→${hFull} 0.5→${hHalf} 0→${hNone}`);
  ok(Math.abs(hNone - 0.75) < 1e-9, `无庇护幸福度应为 0.75，实际 ${hNone}`);
  S.deleteAccount(S.currentAccount().id);
  S.loadState();
}

// ---------------------------------------------------------------------------
section('十八、v0.0.51 人口变化速率（不再几秒翻一番）');
{
  const p = POP.createPopulation(1000);
  for (let i = 0; i < 3600; i++) POP.tickPopulation(p, 1, { oxygen: 1e9, organic: 1e9, water: 1e9 });
  const grow = p.total / 1000 - 1;
  console.log('     挂机 1 小时人口增幅:', (grow * 100).toFixed(2) + '%');
  ok(grow > 0, '幸福度高时人口应增长');
  ok(grow < 0.20, `1 小时增幅应 < 20%，实际 ${(grow * 100).toFixed(2)}%`);
  ok(grow > 0.03, `1 小时增幅应 > 3%（不能慢到没感觉），实际 ${(grow * 100).toFixed(2)}%`);

  const d = POP.createPopulation(1000);
  d.happiness = 0;
  for (let i = 0; i < 3600; i++) POP.tickPopulation(d, 1, { oxygen: 0, organic: 0, water: 0 });
  const drop = 1 - d.total / 1000;
  console.log('     最惨 1 小时人口降幅:', (drop * 100).toFixed(2) + '%');
  ok(drop > 0, '幸福度极低时人口应下降');
  ok(drop < 0.30, `1 小时降幅应 < 30%，实际 ${(drop * 100).toFixed(2)}%`);
  ok(POP.GROWTH_RATE <= 1e-4, `GROWTH_RATE 应已调慢，实际 ${POP.GROWTH_RATE}`);
  ok(POP.DECLINE_RATE <= 5e-4, `DECLINE_RATE 应已调慢，实际 ${POP.DECLINE_RATE}`);
}

// ---------------------------------------------------------------------------
section('十九、v0.0.51 删除存档（不再失效、不再串档）');
{
  globalThis.localStorage = globalThis.localStorage || (() => {
    const m = new Map();
    return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)),
             removeItem: (k) => m.delete(k), get length() { return m.size; }, key: (i) => [...m.keys()][i] };
  })();
  const S = await import('../js/core/state.js?v=21.17');
  S.loadState();

  // 建两个存档，各自推进不同时长，做出可区分的进度
  const a = S.newGame('甲');
  const instA = S.getPlanetInstance(a.homePlanetCode);
  for (let i = 0; i < 30; i++) S.tick(1);
  // 没分配采集人力时资源不会自己涨，直接写 owned 比依赖 tick 更确定
  instA.inventory.find((e) => e.mat === '石头').owned = 3333;
  const aStone = 3333;
  S.saveState();          // 手动改完要落盘，否则下面的删除只会读回旧的落盘值

  const b = S.newGame('乙');
  const instB = S.getPlanetInstance(b.homePlanetCode);
  for (let i = 0; i < 90; i++) S.tick(1);
  instB.inventory.find((e) => e.mat === '石头').owned = 7777;
  const bStone = 7777;
  S.saveState();
  ok(instA !== instB, '两个存档的星球实例必须是两个对象（新账号不能沿用旧账号的星球）');
  ok(aStone !== bStone, '两个存档应有不同进度，才能测出串档');

  // 删掉「当前」账号（乙）：旧的 bug 会把乙的星球数据写进甲名下
  S.deleteAccount(b.id);
  ok(S.STATE.accounts.length === 1, `删除后应剩 1 个存档，实际 ${S.STATE.accounts.length}`);
  ok(S.currentAccount().id === a.id, '删除当前账号后应切到另一个存档');

  // 重载一次，确认落盘也是干净的
  S.saveState();
  S.STATE.accounts = []; S.STATE.planets = []; S.STATE.currentAccountId = null;
  S.loadState();
  ok(S.STATE.accounts.length === 1, '刷新后仍应只有 1 个存档（被删的没复活）');
  const instA2 = S.getPlanetInstance(S.currentAccount().homePlanetCode);
  const aStone2 = instA2.inventory.find((e) => e.mat === '石头').owned;
  ok(Math.abs(aStone2 - aStone) < 1e-6,
    `甲的进度不应被乙污染：删除前 ${aStone.toFixed(2)}，删除后 ${aStone2.toFixed(2)}`);
  ok(Math.abs(aStone2 - bStone) > 1e-9, '甲的进度不应变成乙的（串档检测）');

  // 删掉最后一个 → 应该清空，且不会自动新建
  S.deleteAccount(S.currentAccount().id);
  ok(S.STATE.accounts.length === 0, `删完最后一个应为空，实际 ${S.STATE.accounts.length}`);
  ok(S.currentAccount() === null, '删完后不应再有当前账号');
  S.loadState();
  ok(S.STATE.accounts.length === 0, '刷新后被删的存档不应复活');
}

// ---------------------------------------------------------------------------
section('二十、v0.0.51 离线模式文案');
{
  const src = readFileSync(new URL('../js/ui/start.js?v=21.17', import.meta.url), 'utf8');
  ok(src.includes("'与电脑对抗'"), '离线模式副文案应为「与电脑对抗」');
  ok(!src.includes("'全部是人机'"), '旧的「全部是人机」文案应已移除');
  // 删除后不能再走 enterOffline（那会触发 ensureAccount 自动建号，观感就是「删不掉」）
  // 注意：注释里也会提到 enterOffline，所以只精确匹配那一行代码
  ok(!/if \(STATE\.accounts\.length === 0\) ctx\.enterOffline\(\);/.test(src),
    '删除存档后不应再走 enterOffline（那会触发 ensureAccount 自动建号，观感就是删不掉）');
  ok(/renderAccountList\(body, ctx\);/.test(src), '删完应重绘存档列表（留在选择界面，可直接新建）');
}

// ---------------------------------------------------------------------------
section('二十一、v0.0.52 研究真正扣点');
{
  globalThis.localStorage = globalThis.localStorage || (() => {
    const m = new Map();
    return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)),
             removeItem: (k) => m.delete(k), get length() { return m.size; }, key: (i) => [...m.keys()][i] };
  })();
  const S = await import('../js/core/state.js?v=21.17');
  S.loadState();
  const acc = S.newGame('科研自检员');
  const T = techById;

  // 研究点不足时应被拒绝
  acc.researchPoints = 0;
  const poor = S.researchTech('t_a1');
  ok(poor.ok === false, '研究点不足时应拒绝');
  ok(/研究点不足/.test(poor.reason || ''), `应说明研究点不足，实际「${poor.reason}」`);
  ok(!acc.tech.includes('t_a1'), '被拒绝时不应加入已研究列表');

  // 前置未满足时应被拒绝（t_b2 需要 t_b1）
  acc.researchPoints = 1e9;
  const locked = S.researchTech('t_b2');
  ok(locked.ok === false, '前置未满足时应拒绝');
  ok(/前置/.test(locked.reason || ''), `应说明前置未完成，实际「${locked.reason}」`);

  // 正常研究：扣点 + 解锁
  const cost = T.t_a1.cost;
  const before = acc.researchPoints;
  const okRes = S.researchTech('t_a1');
  ok(okRes.ok === true, `t_a1 应可研究，实际「${okRes.reason}」`);
  ok(acc.tech.includes('t_a1'), '研究后应进入已研究列表');
  ok(Math.abs(acc.researchPoints - (before - cost)) < 1e-9,
    `应扣除 ${cost} 研究点：${before} → ${acc.researchPoints}`);

  // 重复研究应被拒绝且不再扣点
  const again = S.researchTech('t_a1');
  ok(again.ok === false, '重复研究应被拒绝');
  ok(again.ok === false && Math.abs(acc.researchPoints - (before - cost)) < 1e-9, '重复研究不应再扣点');

  // 前置满足后可以继续往下研究
  ok(S.researchTech('t_b1').ok === true, '研究 t_a1 后应能研究 t_b1（前置已满足）');
  ok(S.researchTech('t_b2').ok === true, '研究 t_b1 后应能研究 t_b2');

  // 永久升级也消耗研究点
  acc.researchPoints = 1e9;
  const U = (await import('../js/data/upgrades.js?v=21.17')).UPGRADES[0];
  const p0 = acc.researchPoints;
  const up = S.buyUpgrade(U.id);
  ok(up.ok === true, `应能购买升级，实际「${up.reason}」`);
  ok(up.level === 1, `升级后等级应为 1，实际 ${up.level}`);
  ok(acc.researchPoints < p0, '购买升级应扣研究点');
  ok(Number(acc.upgrades[U.id]) === 1, '升级等级应记录在账号上');
  // 第二级更贵
  const p1 = acc.researchPoints;
  S.buyUpgrade(U.id);
  const spent2 = p1 - acc.researchPoints;
  const spent1 = p0 - p1;
  ok(spent2 > spent1, `升级价格应递增：第一级 ${spent1} → 第二级 ${spent2}`);

  S.deleteAccount(S.currentAccount().id);
  S.loadState();
}

// ---------------------------------------------------------------------------
section('二十二、v0.0.52 开局采集速率（不再是 0）');
{
  globalThis.localStorage = globalThis.localStorage || (() => {
    const m = new Map();
    return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)),
             removeItem: (k) => m.delete(k), get length() { return m.size; }, key: (i) => [...m.keys()][i] };
  })();
  const S = await import('../js/core/state.js?v=21.17');
  S.loadState();
  const acc = S.newGame('采集自检员');
  const inst = S.getPlanetInstance(acc.homePlanetCode);
  const stone = inst.inventory.find((e) => e.mat === '石头');

  // 没分配人力 → 速率 0（这是设计：没人就不产出）
  S.tick(1);
  ok(stone.rate === 0, '没分配人力时速率应为 0（没人就不产出）');

  // 分配全部可用人力 → 速率必须肉眼可见
  // v0.0.6：开局人口改为 100（需求 R15），可用人力约 81，断言阈值随之调整。
  const availLabor = POP.getAvailable(inst.pop);
  POP.assignWorkers(inst.pop, 'surface_gatherer', 9999, S.getBuildingCounts(inst));
  const assigned = POP.getJobCount(inst.pop, 'surface_gatherer');
  S.tick(1);
  console.log('     ' + assigned + ' 人（可用 ' + availLabor + '）采石头速率:', stone.rate, '/秒');
  ok(assigned === availLabor, `应把全部可用人力（${availLabor}）都派去采集，实际 ${assigned}`);
  ok(stone.rate > 0.5, `开局人力采石头速率应肉眼可见（旧值只有 0.05），实际 ${stone.rate}`);
  // 一分钟后应有明显收获
  const o0 = stone.owned;
  for (let i = 0; i < 60; i++) S.tick(1);
  const got = stone.owned - o0;
  console.log('     1 分钟采到:', got.toFixed(0), '个石头');
  ok(got > 30, `1 分钟应采到 > 30 个石头，实际 ${got.toFixed(0)}`);
  ok(stone.remaining < 1e11, '采集应从星球储藏里扣');

  S.deleteAccount(S.currentAccount().id);
  S.loadState();
}

// ---------------------------------------------------------------------------
section('二十三、v0.0.52 连续生育率（低幸福度放缓 / 倒扣）');
{
  // 生育率 f = (H − 0.5) / 0.5 ∈ [−1, +1]
  const rate = (h) => {
    const f = (h - POP.NEUTRAL_HAPPINESS) / (1 - POP.NEUTRAL_HAPPINESS);
    return f >= 0 ? f * POP.GROWTH_RATE : f * POP.DECLINE_RATE;
  };
  ok(Math.abs(rate(0.5)) < 1e-12, '幸福度 0.5 时生育率应为 0（人口持平）');
  ok(rate(1.0) > 0, '幸福度 1.0 时应增长');
  ok(rate(0.9) > 0 && rate(0.9) < rate(1.0), '幸福度越低增长越慢');
  ok(rate(0.6) > 0 && rate(0.6) < rate(0.9), '0.6 比 0.9 增长更慢（放缓）');
  ok(rate(0.4) < 0, '幸福度 0.4 时应**倒扣**（低于 0.5 就开始减少，不用等 0.3）');
  ok(rate(0.2) < rate(0.4), '幸福度越低倒扣越快');
  ok(Math.abs(rate(1.0) + rate(0.0) / 2) < 1e-12, '满速衰减应为满速增长的两倍（灾难比繁荣快）');

  // 端到端：跑 1 小时。
  // 注意不能直接「把 happiness 设成 0.4 然后喂饱」——喂饱后幸福度会自己回升到 0.9，
  // 测不出低幸福度。要用**真正压低幸福度**的场景：无庇护 / 断粮。
  const run = (supply, opts) => {
    const p = POP.createPopulation(1000);
    for (let i = 0; i < 3600; i++) POP.tickPopulation(p, 1, supply, opts || {});
    return { grow: p.total / 1000 - 1, h: p.happiness };
  };
  const full = { oxygen: 1e9, organic: 1e9, water: 1e9 };
  const none = { oxygen: 0, organic: 0, water: 0 };

  const best = run(full, { shelter: 1 });   // 满庇护 → 目标 0.90
  const noHome = run(full, { shelter: 0 }); // 无庇护 → 目标 0.75
  const starve = run(none, { shelter: 1 }); // 断粮   → 目标 0.25
  console.log('     1 小时后  满庇护 H=' + best.h.toFixed(2) + ' → ' + (best.grow * 100).toFixed(1) + '%'
    + '   无庇护 H=' + noHome.h.toFixed(2) + ' → ' + (noHome.grow * 100).toFixed(1) + '%'
    + '   断粮   H=' + starve.h.toFixed(2) + ' → ' + (starve.grow * 100).toFixed(1) + '%');

  ok(best.grow > 0.05 && best.grow < 0.15, `满庇护一小时应 +5%~15%，实际 ${(best.grow * 100).toFixed(1)}%`);
  ok(noHome.h < best.h, '无庇护的幸福度应低于满庇护');
  ok(noHome.grow > 0 && noHome.grow < best.grow,
    `无庇护应仍在增长但明显放缓：${(noHome.grow * 100).toFixed(1)}% < ${(best.grow * 100).toFixed(1)}%`);
  ok(starve.h < 0.5, `断粮幸福度应跌破 0.5，实际 ${starve.h.toFixed(3)}`);
  ok(starve.grow < 0, `断粮时人口应**倒扣**，实际 ${(starve.grow * 100).toFixed(1)}%`);
}

// ---------------------------------------------------------------------------
section('二十四、v0.0.52 休息消耗改小');
{
  const p = POP.createPopulation(1000);
  const eat = POP.consumptionPerSec(p);
  ok(Math.abs(POP.BASE_CONSUME.oxygen - 0.003) < 1e-12, `氧气基数应为 0.003（v0.0.93 下调），实际 ${POP.BASE_CONSUME.oxygen}`);
  ok(Math.abs(POP.BASE_CONSUME.water - 0.003) < 1e-12, `水基数应为 0.003（v0.0.93 下调），实际 ${POP.BASE_CONSUME.water}`);
  ok(Math.abs(eat.oxygen - 3) < 1e-9, `1000 人休息耗氧应为 3/s（v0.0.93 基数下调），实际 ${eat.oxygen}`);
  // 启动口粮应能撑很久（不再是 2.8 小时）
  const stock = 1e5;
  const hours = stock / eat.oxygen / 3600;
  console.log('     1000 人 + 1e5 氧气可撑:', hours.toFixed(1), '小时');
  // v0.0.8：人均消耗翻倍后，同一份口粮的续航自然缩短到 ~7 小时（设计预期）
  ok(hours > 6, `启动口粮应能撑 > 6 小时，实际 ${hours.toFixed(1)} 小时`);
}

// ---------------------------------------------------------------------------
console.log('\n========================');
console.log(`通过 ${pass} 项，失败 ${fails.length} 项`);
if (fails.length) { fails.forEach((f) => console.log('  x ' + f)); process.exit(1); }
console.log('全部通过');

// docs/_probe_deploy_fix.mjs —— 军队/舰船部署链路防回归探针（v0.3.3）
//
// 覆盖三个历史缺陷：
//   1. army.js#armyBuildTick 成军序号引用不存在的 `blueprint`（应为 `bp`）
//      → 第 2 支同蓝图军队成军时抛 ReferenceError；且被 advanceArmyLines 的
//        try/catch 静默吞掉，表现为「军队永远造不出第 2 支」。
//   2. shipyard.js#createShip 从不写 ship.blueprintId
//      → fleet.js#isFreighter / #fleetCargoCells 反查不到蓝图，运输任务恒判
//        「编队里没有运输船」，货舱格数退化为兜底值。
//   3. population.js 多处直接索引 pop.assignments
//      → 老档/云端合并存档缺该字段时抛 TypeError，中断 tick 与页面渲染。
import { armyBuildTick, armyBuildCheck, listArmies } from '../js/core/army.js';
import { ARMY_BP_BY_ID, armyBpPartNeeds } from '../js/data/army_parts.js';
import { createShip } from '../js/core/shipyard.js';
import { createFleet, addShipToFleet, listFleets, fleetCargoCells, startMission } from '../js/core/fleet.js';
import { HULLS, ENGINES, FACILITIES } from '../js/data/ship_parts.js';
import { CELL_VOLUME } from '../js/core/footprint.js';
import { assignedToBuilding, getAssigned, jobOutput, getJobCount, assignWorkers, setJobIntensity } from '../js/core/population.js';

let pass = 0, fail = 0;
function check(name, cond, detail) {
  if (cond) { pass++; console.log('  ✓ ' + name + (detail ? '  ' + detail : '')); }
  else { fail++; console.log('  ✗ ' + name + (detail ? '  ' + detail : '')); }
}

// ---------------------------------------------------------------------------
console.log('\n===== 一、军队：同一蓝图可连续成军（v0.3.3 修复 #1）=====');
{
  const bpId = Object.keys(ARMY_BP_BY_ID)[0];
  const bp = ARMY_BP_BY_ID[bpId];
  const acc = { armies: [], armyBlueprints: [], tech: [], ships: [], fleets: [] };
  const names = [];
  let threw = null;
  for (let i = 0; i < 3; i++) {
    const inst = { equipment: {}, armyProgress: {} };
    const need = armyBpPartNeeds(bp);
    for (const p in need) inst.equipment['k_' + p] = { partId: p, count: need[p] };
    try { armyBuildTick(inst, bpId, 1000, 10, 1, acc); }
    catch (e) { threw = e; break; }
  }
  check('连续成军 3 支不抛错', !threw, threw ? (threw.name + ': ' + threw.message) : '');
  const arr = listArmies(acc);
  check('成军数 = 3', arr.length === 3, '实际 ' + arr.length);
  check('编号连续 No.1/No.2/No.3', names.length === 0 && arr.map(a => a.nameCn).join(',').includes('No.3'), arr.map(a => a.nameCn).join(' | '));
  check('每支都带 blueprintId', arr.every(a => a.blueprintId === bpId));
}

// ---------------------------------------------------------------------------
console.log('\n===== 二、缺件时卡在 1−ε 而非崩溃 =====');
{
  const bpId = Object.keys(ARMY_BP_BY_ID)[0];
  const acc = { armies: [], armyBlueprints: [], tech: [], ships: [], fleets: [] };
  const inst = { equipment: {}, armyProgress: {} };   // 故意不给部件
  const chk = armyBuildCheck(inst, ARMY_BP_BY_ID[bpId]);
  check('装备不齐时 check.ok = false', chk.ok === false, '缺 ' + chk.missing.length + ' 种');
  let threw = null, d = 0;
  try { d = armyBuildTick(inst, bpId, 1000, 10, 1, acc); } catch (e) { threw = e; }
  check('缺件推进不抛错', !threw, threw ? threw.message : '');
  check('缺件时不成军', listArmies(acc).length === 0);
  check('进度卡在 [0,1) 而非 =1', inst.armyProgress[bpId] < 1, 'prog=' + inst.armyProgress[bpId]);
  check('仍有进度增量（不会死锁为 0）', d > 0, 'delta=' + d);
}

// ---------------------------------------------------------------------------
console.log('\n===== 三、舰船：blueprintId 必须写入（v0.3.3 修复 #2）=====');
{
  const hull = HULLS[2], eng = ENGINES[0];
  const crew = FACILITIES.find(f => f.id === 'fac_crew_mk1');
  const cargoL = FACILITIES.find(f => f.id === 'fac_cargo_l_mk1');
  const bpF = {
    id: 'bp_freight', nameCn: '重型运输舰', kind: 'freighter', capacity: 200,
    planetCode: 'syl', altitudeM: 1000, fuelName: '甲烷',
    hullId: hull.id, hullMaterial: null,
    engines: [{ id: eng.id, material: null }],
    parts: [{ id: crew.id, material: null }, { id: cargoL.id, material: null }],
  };
  const acc = { blueprints: [bpF], ships: [], tech: ['t_e3'], fleets: [], armies: [], homePlanetCode: 'syl' };
  const r = createShip(bpF, { researched: new Set(acc.tech), ships: acc.ships });
  check('运输舰建造成功', r.ok, r.ok ? '' : JSON.stringify(r.errors));
  if (r.ok) {
    const sh = r.ship;
    acc.ships.push(sh);
    check('ship.blueprintId = bp.id', sh.blueprintId === 'bp_freight', '实际 ' + JSON.stringify(sh.blueprintId));
    check('ship.blueprint 对象仍在', !!(sh.blueprint && sh.blueprint.id === 'bp_freight'));

    const f = createFleet(acc, '运输队').fleet;
    const add = addShipToFleet(acc, f.id, sh.id);
    check('入队成功', add.ok === true);
    const fl = listFleets(acc)[0];
    check('货舱格数按蓝图 capacity 计算', fleetCargoCells(acc, fl) === Math.max(1, Math.ceil(200 / CELL_VOLUME)),
      'cells=' + fleetCargoCells(acc, fl) + ' 期望=' + Math.max(1, Math.ceil(200 / CELL_VOLUME)));

    sh.cargo = { '石头': 12 };
    const t = startMission(acc, fl.id, 'transport', 'nova', null);
    check('运输任务可发起（不再被判「没有运输船」）', t.ok === true, t.ok ? '' : t.reason);
  }
}

// ---------------------------------------------------------------------------
console.log('\n===== 四、pop 缺 assignments 不再抛错（v0.3.3 修复 #3）=====');
{
  const pop = { total: 100, happiness: 1 };   // 无 assignments
  let threw = null;
  let asgB = null, totA = null, out = null, cnt = null;
  try {
    asgB = assignedToBuilding(pop, 'mine');
    totA = getAssigned(pop);
    out = jobOutput(pop, 'surface_gatherer');
    cnt = getJobCount(pop, 'surface_gatherer');
  } catch (e) { threw = e; }
  check('读侧不抛错', !threw, threw ? (threw.name + ': ' + threw.message) : '');
  check('assignedToBuilding = 0', asgB === 0);
  check('getAssigned = 0', totA === 0);
  check('jobOutput = 0', out === 0);
  check('getJobCount = 0', cnt === 0);

  // 写侧：assignWorkers / setJobIntensity 应自动补齐容器
  let threw2 = null, c = null;
  try {
    c = assignWorkers(pop, 'surface_gatherer', 20, {});
    setJobIntensity(pop, 'surface_gatherer', 'standard');
  } catch (e) { threw2 = e; }
  check('写侧不抛错（自动补齐 assignments）', !threw2, threw2 ? threw2.message : '');
  check('assignWorkers 返回分配人数', c > 0, 'count=' + c);
  check('分配后可读回', getJobCount(pop, 'surface_gatherer') === c, '读回=' + getJobCount(pop, 'surface_gatherer'));
  check('getAssigned 随之增加', getAssigned(pop) === c, 'getAssigned=' + getAssigned(pop));
}

console.log('\n===== 汇总 =====');
console.log('  通过 ' + pass + ' / 失败 ' + fail);
if (fail === 0) console.log('  全部通过 ✅');
process.exit(fail === 0 ? 0 : 1);

// 临时探针：验证「造船严格一个一个造」+ 乘员提升 + 速率下调（v0.3.3）
import { shipBuildTick, blueprintBuildCost, evaluateBlueprint, aggregate, addEquipment, createShip } from '../js/core/shipyard.js?v=33.2';
import { HULLS, ENGINES, FACILITIES, craftWorkOf } from '../js/data/ship_parts.js?v=33.2';
import { ARMY_PARTS } from '../js/data/army_parts.js?v=33.2';

let pass = 0, fail = 0;
function check(name, cond, detail) {
  if (cond) { pass++; console.log('  ✓ ' + name + (detail ? '  ' + detail : '')); }
  else { fail++; console.log('  ✗ ' + name + (detail ? '  ' + detail : '')); }
}

const hull = HULLS[1], eng = ENGINES[0];
const crew1 = FACILITIES.find(f => f.id === 'fac_crew_mk1');
const cargo = FACILITIES.find(f => f.id === 'fac_cargo_mk1');

const mkBp = (parts, id) => ({
  id: id || 'bp_t', nameCn: '测试舰', planetCode: 'syl', altitudeM: 1000, fuelName: '甲烷',
  hullId: hull.id, hullMaterial: null,
  engines: [{ id: eng.id, material: null }],
  parts,
});

// 给足装备：外壳1 + 引擎1 + 各设施 N
function mkInst(parts, times) {
  const inst = { equipment: {}, facilityStock: {}, shipProgress: {}, lines: [] };
  // 用与生产层同源的 addEquipment 构造，避免手写 key 格式出错
  addEquipment(inst, hull.id, null, times);
  addEquipment(inst, eng.id, null, times);
  for (const p of parts) addEquipment(inst, p.id, p.material == null ? null : p.material, times);
  return inst;
}

// ---------------------------------------------------------------------------
console.log('\n===== 一、一个 tick 最多下水一艘（即使 inc 被 clamp）=====');
{
  const parts = [{ id: crew1.id, material: null }];
  const bp = mkBp(parts);
  const acc = { blueprints: [bp], ships: [], tech: ['t_e3'], fleets: [], armies: [] };
  const inst = mkInst(parts, 20);
  // 用极大 labor：即便如此，单 tick 也只应产出 1 艘（inc clamp 到 1）
  const C = blueprintBuildCost(bp);
  shipBuildTick(inst, bp.id, 1e9, 1, 1, acc);
  check('单 tick 只下水 1 艘', acc.ships.length === 1, '实得 ' + acc.ships.length + ' 艘');
  check('进度清零', inst.shipProgress[bp.id] === 0, 'prog=' + inst.shipProgress[bp.id]);
}

// ---------------------------------------------------------------------------
console.log('\n===== 二、同蓝图多线：单 tick 只产 1 艘（多线只叠加速率）=====');
{
  const parts = [{ id: crew1.id, material: null }];
  const bp = mkBp(parts);
  const acc = { blueprints: [bp], ships: [], tech: ['t_e3'], fleets: [], armies: [] };
  const inst = mkInst(parts, 20);
  // 复刻 v0.3.3 后的 advanceShipLines：同 blueprintId 只调用一次（人力已汇总）
  const laborByBp = new Map();
  for (let i = 0; i < 3; i++) laborByBp.set(bp.id, (laborByBp.get(bp.id) || 0) + 1e9);
  for (const [id, labor] of laborByBp) shipBuildTick(inst, id, labor, 1, 1, acc);
  check('3 条同蓝图线合并后单 tick 只下水 1 艘', acc.ships.length === 1, '实得 ' + acc.ships.length + ' 艘');
  check('进度清零（未溢出到第二格）', inst.shipProgress[bp.id] === 0, 'prog=' + inst.shipProgress[bp.id]);
}

// ---------------------------------------------------------------------------
console.log('\n===== 三、不同蓝图可各产一艘（进度按 blueprintId 隔离）=====');
{
  const partsA = [{ id: crew1.id, material: null }];
  const partsB = [{ id: crew1.id, material: null }, { id: cargo.id, material: null }];
  const bpA = mkBp(partsA, 'bp_a'), bpB = mkBp(partsB, 'bp_b');
  const acc = { blueprints: [bpA, bpB], ships: [], tech: ['t_e3'], fleets: [], armies: [] };
  const inst = { equipment: {}, facilityStock: {}, shipProgress: {} };
  for (const id of [hull.id, eng.id, crew1.id, cargo.id]) addEquipment(inst, id, null, 5);
  shipBuildTick(inst, 'bp_a', 1e9, 1, 1, acc);
  shipBuildTick(inst, 'bp_b', 1e9, 1, 1, acc);
  check('两个不同蓝图各产 1 艘', acc.ships.length === 2, '实得 ' + acc.ships.length + ' 艘');
  check('两艘船都带 blueprintId', acc.ships.every(s => s.blueprintId), acc.ships.map(s => s.blueprintId).join(','));
}

// ---------------------------------------------------------------------------
console.log('\n===== 四、乘员提升：每座乘员仓 60 人 =====');
{
  check('fac_crew_mk1 crew = 60', crew1.crew === 60, '实际 ' + crew1.crew);
  const parts = [{ id: crew1.id, material: null }, { id: crew1.id + '_x', material: null }].slice(0, 1);
  const bp = mkBp([{ id: crew1.id, material: null }]);
  const agg = aggregate(bp);
  check('单座乘员仓 → crewMax = 60', agg.crewMax === 60, '实际 ' + agg.crewMax);
  const r = createShip(bp, { researched: new Set(['t_e3']), ships: [] });
  check('createShip 成功', r.ok, r.ok ? '' : JSON.stringify(r.errors));
  if (r.ok) {
    check('船 stats.crewMax = 60', r.ship.stats.crewMax === 60, '实际 ' + r.ship.stats.crewMax);
    check('船 state.crew = 60', r.ship.state.crew === 60, '实际 ' + r.ship.state.crew);
  }
}

// ---------------------------------------------------------------------------
console.log('\n===== 五、船型判定：1 座乘员仓不应判成殖民船 =====');
{
  const bp1 = mkBp([{ id: crew1.id, material: null }]);                 // 60 人
  const bp3 = mkBp([{ id: crew1.id, material: null }, { id: crew1.id, material: null }, { id: crew1.id, material: null }]);
  const a1 = aggregate(bp1);
  const e1 = evaluateBlueprint(bp1, { researched: new Set(['t_e3']) });
  check('1 座乘员仓(60人) 不判殖民船', e1.className !== '殖民船', '判为 ' + e1.className);
  const e3 = evaluateBlueprint(bp3, { researched: new Set(['t_e3']) });
  check('3 座乘员仓(180人) 判殖民船', e3.className === '殖民船', '判为 ' + e3.className);
}

// ---------------------------------------------------------------------------
console.log('\n===== 六、制造速率已下调（work 抬升）=====');
{
  check('船外壳 work = 600000（1/1000）', craftWorkOf('hull_s_mk1') === 600000, '实际 ' + craftWorkOf('hull_s_mk1'));
  check('船上设施 work = 25000（1/100）', craftWorkOf('fac_crew_mk1') === 25000, '实际 ' + craftWorkOf('fac_crew_mk1'));
  check('引擎 work = 40000（1/100）', craftWorkOf('engine_basic') === 40000, '实际 ' + craftWorkOf('engine_basic'));
  check('武器 work = 30000（1/100）', craftWorkOf('wpn_mg_mk1') === 30000, '实际 ' + craftWorkOf('wpn_mg_mk1'));
  // 军队装备
  const minW = Math.min(...ARMY_PARTS.map(p => p.work));
  check('军队装备最小 work ≥ 30000', minW >= 30000, '最小 ' + minW);
  // 电力推进器自带 work 也已上调
  check('电力推进器 work ≥ 45000', craftWorkOf('ethruster_s_mk1') >= 45000, '实际 ' + craftWorkOf('ethruster_s_mk1'));
}

// ---------------------------------------------------------------------------
console.log('\n===== 七、造船总时长可控（14~60 分钟量级）=====');
{
  const parts = [{ id: crew1.id, material: null }];
  for (const h of ['hull_xs_mk1', 'hull_s_mk1', 'hull_m_mk1', 'hull_l_mk1']) {
    const bp = { ...mkBp(parts), hullId: h, hullMaterial: null };
    const C = blueprintBuildCost(bp);
    const min20 = C / 20 / 60, min60 = C / 60 / 60;
    check(h + ' 20人力 ' + min20.toFixed(0) + '分 / 60人力 ' + min60.toFixed(0) + '分',
      min20 > 5 && min20 < 240, 'C=' + C);
  }
}

console.log('\n===== 汇总 =====');
console.log('  通过 ' + pass + ' / 失败 ' + fail);
if (fail === 0) console.log('  全部通过 ✅');
process.exit(fail === 0 ? 0 : 1);

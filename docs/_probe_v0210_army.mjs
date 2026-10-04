// v0.2.10 军队专项探针：飞船编入（6:4+25%）、互斥、科技门槛、老存档科技迁移
// army.js 为纯算法模块（不碰存储 adapter），直接用内存对象测。
import { ensureArmies, attachShipToArmy, detachShipFromArmy, shipEligibleForArmy, shipArmyOf,
  armyEffStats, armyPowerOfInstance, armyToUnit, listArmies, armyStatsOfBp, armyPowerOf } from '../js/core/army.js?v=44.9';

let pass = 0, fail = 0;
function ok(cond, msg) {
  if (cond) { pass++; console.log('  ✓ ' + msg); }
  else { fail++; console.log('  ✗ ' + msg); }
}

function mkAcc() {
  return {
    id: 'acc_test', name: '测试', tech: ['t_m1', 't_m2', 't_m3'], _armyTechV3: true,
    ships: [
      { id: 'sh_1', name: '先驱号', className: 'MKI级侦察船', strength: 1000 },
      { id: 'sh_2', name: '铁壁号', className: 'MKI级护卫舰', strength: 2000 },
    ],
    fleets: [],
    armies: [],
  };
}
const BP = 'ab_ranger';

// ---- 1. 科技门槛 ----
{
  const acc = mkAcc();
  acc.tech = ['t_m1', 't_m2'];   // 未研 M3
  acc.armies.push({ id: 'am_1', nameCn: '一营', blueprintId: BP, men: 100, stats: { atk: 50, def: 30, speed: 10 }, power: 80 });
  const r = attachShipToArmy(acc, 'am_1', 'sh_1');
  ok(!r.ok && /M3/.test(r.reason), '未研 M3 编入飞船应拒绝并提示 M3');
}

// ---- 2. 正常编入 + 6:4 + 25% ----
{
  const acc = mkAcc();
  acc.armies.push({ id: 'am_1', nameCn: '一营', blueprintId: BP, men: 100, stats: { atk: 50, def: 30, speed: 10 }, power: 80 });
  const r = attachShipToArmy(acc, 'am_1', 'sh_1');
  ok(r.ok, 'M3 已研：编入先驱号成功');
  const a = listArmies(acc)[0];
  const base = armyStatsOfBp(BP);
  const eff = armyEffStats(a);
  ok(eff.atk === Math.round((base.atk + 1000 * 0.6) * 10) / 10, `有效火力 = 蓝图 ${base.atk} + 1000×0.6 = ${Math.round((base.atk + 600) * 10) / 10}（实际 ${eff.atk}）`);
  ok(eff.def === Math.round((base.def + 1000 * 0.4) * 10) / 10, `有效防护 = 蓝图 ${base.def} + 1000×0.4（实际 ${eff.def}）`);
  const p = armyPowerOfInstance(a);
  const expectP = Math.round(armyPowerOf(eff) + 1000 * 0.25);
  ok(p === expectP, `战力含飞船 25% = ${expectP}（实际 ${p}）`);
  const u = armyToUnit(a);
  ok(u.hp === expectP && u.atk === eff.atk && u.def === eff.def, 'armyToUnit 快照含飞船加成（战斗确定性）');
  ok(shipArmyOf(acc, 'sh_1') && shipArmyOf(acc, 'sh_1').id === 'am_1', 'shipArmyOf 可查占用');
}

// ---- 3. 互斥 ----
{
  const acc = mkAcc();
  acc.armies.push({ id: 'am_1', nameCn: '一营', blueprintId: BP, men: 100 });
  acc.armies.push({ id: 'am_2', nameCn: '二营', blueprintId: BP, men: 100 });
  attachShipToArmy(acc, 'am_1', 'sh_1');
  const r2 = attachShipToArmy(acc, 'am_2', 'sh_1');
  ok(!r2.ok && /已编入军队/.test(r2.reason), '同船编入第二支军队应拒绝');
  const r3 = attachShipToArmy(acc, 'am_1', 'sh_2');
  ok(!r3.ok && /已编入飞船/.test(r3.reason), '每军限 1 艘（已编再编应拒绝）');
  // 舰队互斥
  acc.fleets.push({ id: 'fl_1', nameCn: '主队', shipIds: ['sh_2'] });
  const el2 = shipEligibleForArmy(acc, 'sh_2');
  ok(!el2.ok && /舰队/.test(el2.reason), '已编舰队的船不可编入军队');
  // 解编后可再编
  detachShipFromArmy(acc, 'am_1');
  const r4 = attachShipToArmy(acc, 'am_2', 'sh_1');
  ok(r4.ok, '解编后该船可编入其它军队');
}

// ---- 4. 老存档科技迁移 ----
{
  const acc = { id: 'old1', tech: ['t_a1', 't_m1', 't_m2', 't_m3', 't_m4'], armies: [], ships: [], fleets: [] };
  ensureArmies(acc);
  ok(acc.tech.includes('t_m3') && !acc.tech.includes('t_m4') && acc.tech.includes('t_m2'),
    '旧 M4 存档 → 迁移为 M3（超级），M1/M2 保留');
  const acc2 = { id: 'old2', tech: ['t_a1', 't_m1', 't_m2', 't_m3'], armies: [], ships: [], fleets: [] };
  ensureArmies(acc2);
  ok(acc2.tech.includes('t_m2') && !acc2.tech.includes('t_m3'),
    '仅旧 M3（机动平台）存档 → 降为 M2（高级）');
  ok(acc2._armyTechV3 === true, '迁移后打 _armyTechV3 标记（幂等）');
  const before = JSON.stringify(acc2.tech);
  ensureArmies(acc2);
  ok(JSON.stringify(acc2.tech) === before, '重复迁移不变化（幂等）');
  const acc3 = { id: 'new1', tech: ['t_m1', 't_m2', 't_m3'], _armyTechV3: true, armies: [], ships: [], fleets: [] };
  ensureArmies(acc3);
  ok(acc3.tech.length === 3 && acc3.tech.includes('t_m3'), '新口径存档（带标记）不被误迁移');
}

// ---- 5. 自愈：编入的船被编进舰队 → 自动解编 ----
{
  const acc = mkAcc();
  acc.armies.push({ id: 'am_1', nameCn: '一营', blueprintId: BP, men: 100, shipId: 'sh_1', shipBonus: { strength: 999 } });
  acc.fleets.push({ id: 'fl_1', nameCn: '主队', shipIds: ['sh_1'] });
  ensureArmies(acc);
  const a = listArmies(acc)[0];
  ok(a.shipId === null && !a.shipBonus, '飞船被编进舰队后 ensureArmies 自动解编军队');
}

console.log(`\n通过 ${pass} 项，失败 ${fail} 项`);
process.exit(fail ? 1 : 0);

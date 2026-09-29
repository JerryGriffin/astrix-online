// w4-ship 验收推演（临时脚本，跑完即删）：
// dock 线创建 → shipBuildTick 推进 → 满进度下水扣装备 全链路（core 层，模拟 state.js 接线契约）
import * as Y from '../js/core/shipyard.js?v=21.3';
import * as SP from '../js/data/ship_parts.js?v=21.3';
import * as PR from '../js/core/production.js?v=21.3';
import * as POP from '../js/core/population.js?v=21.3';

let pass = 0, fail = 0;
const ok = (c, msg) => { if (c) { pass++; console.log('  ok ' + msg); } else { fail++; console.log('  x  ' + msg); } };

// ============ 1) 需求 10b：货舱数据 ============
ok(SP.PART_BY_ID['fac_cargo_mk1'] && SP.PART_BY_ID['fac_cargo_mk1'].cargoVol === 6, 'fac_cargo_mk1 cargoVol=6');
ok(SP.PART_BY_ID['fac_cargo_mk1'].nameCn === '小型货舱 MKI', 'fac_cargo 展示名=小型货舱（id 不变，老存档兼容）');
ok(SP.PART_BY_ID['fac_cargo_l_mk1'] && SP.PART_BY_ID['fac_cargo_l_mk1'].cargoVol === 60, 'fac_cargo_l_mk1 cargoVol=60');
ok(SP.PART_BY_ID['fac_cargo_l_mk1'].footprint === 120 && SP.PART_BY_ID['fac_cargo_l_mk1'].mass === 20, 'fac_cargo_l footprint=120 mass=20');
ok(SP.craftableParts().some((p) => p.partId === 'fac_cargo_l_mk1'), 'fac_cargo_l 进入可制造清单（part_ 配方自动覆盖）');
ok(SP.isPartUnlocked('fac_cargo_l_mk1', ['t_e3']), 'fac_cargo_l 走 t_e3 解锁');

// ============ 2) 需求 10b：运输船判定 ============
const bpT = Y.emptyBlueprint();
bpT.id = 'bp_transport';   // 真实蓝图的 id 由蓝图卡/设计器生成，这里手动补
bpT.hullId = 'hull_m_mk1';
bpT.parts = [{ id: 'fac_cargo_mk1', material: null }, { id: 'fac_crew_mk1', material: null }];
bpT.engines = [{ id: 'engine_balanced_mk1', material: '铁' }];
const evT = Y.evaluateBlueprint(bpT, { researched: ['t_e3'], ships: [] });
ok(evT.type === '运输船', '装任一货舱（cargoVol>0）判定为运输船，实际 ' + evT.type);
ok(Y.evaluateBlueprint(Y.emptyBlueprint(), { researched: ['t_e3'], ships: [] }).type === '探索船', '无货舱默认船仍为探索船');

// ============ 3) 需求 3：dock 线全链路 ============
const inst = { inventory: [], buildings: { dock: 1, fabricator: 1 }, pop: POP.createPopulation(100), shipProgress: {} };
POP.assignWorkers(inst.pop, 'dock_worker', 8, inst.buildings);
const acc = { tech: ['t_e3'], ships: [], blueprint: bpT, blueprints: [bpT] };

Y.addEquipment(inst, bpT.hullId, bpT.hullMaterial, 1);
Y.addEquipment(inst, 'engine_balanced_mk1', '铁', 1);
Y.addEquipment(inst, 'fac_crew_mk1', null, 1);
Y.addEquipment(inst, 'fac_cargo_mk1', null, 1); // bpT 装了小型货舱，装备同样要备齐

const chk1 = Y.shipBuildCheck(inst, acc, bpT.id);
ok(chk1.ok, '装备齐备 shipBuildCheck 通过（' + JSON.stringify(chk1.missing) + chk1.reasons.join(';') + '）');
ok(chk1.cost > 0, '工作量 cost=' + chk1.cost);

Y.consumeEquipment(inst, 'fac_crew_mk1', null, 1);
const chk2 = Y.shipBuildCheck(inst, acc, bpT.id);
ok(!chk2.ok && chk2.missing.some((m) => m.partId === 'fac_crew_mk1'), '缺乘员仓装备被拦下');
Y.addEquipment(inst, 'fac_crew_mk1', null, 1);

// dock 线（与 ui/shipyard.js createDockLine 兜底路径同一冻结结构）
const line = { id: 'line_test1', buildingId: 'dock', blueprintId: bpT.id, workers: 6 };
inst.lines = [line];
ok(PR.lineSlotInfo(inst, 'dock').total >= 6, 'dock 工位充足');

const C = Y.blueprintBuildCost(bpT);
let ticks = 0;
while (acc.ships.length === 0 && ticks < C + 200) {
  const iv = POP.getIntensity(inst.pop.intensityId);
  const labor = line.workers * (Number(iv.outputMul) || 1);   // 契约口径：workers × 强度倍率
  Y.shipBuildTick(inst, bpT.id, labor, 1, 1, acc);
  ticks++;
}
ok(acc.ships.length === 1, `进度满下水 1 艘（${ticks} tick，工作量 ${C}，进度余 ${(inst.shipProgress[bpT.id] || 0).toFixed(4)}）`);
ok(acc.ships[0] && /No\.1$/.test(acc.ships[0].name), '船名 No.1：' + (acc.ships[0] && acc.ships[0].name));
ok(Y.equipmentCount(inst, bpT.hullId, bpT.hullMaterial) === 0, '下水扣掉外壳装备');
ok(Y.equipmentCount(inst, 'fac_crew_mk1', null) === 0, '下水扣掉乘员仓装备');
ok(acc.ships[0] && acc.ships[0].className === '运输船', '新船类型=运输船');

// ============ 4) 电力设施库存把关 + 下水扣减 ============
const bpF = Y.emptyBlueprint();
bpF.id = 'bp_facility';
bpF.hullId = 'hull_m_mk1';
bpF.parts = [{ id: 'fac_crew_mk1', material: null }, { id: 'battery_s', material: null }];
bpF.engines = [{ id: 'engine_balanced_mk1', material: '铁' }];
acc.blueprints.push(bpF);
Y.addEquipment(inst, 'hull_m_mk1', '铁', 1);
Y.addEquipment(inst, 'engine_balanced_mk1', '铁', 1);
Y.addEquipment(inst, 'fac_crew_mk1', null, 1);
inst.facilityStock = {};
const chk3 = Y.shipBuildCheck(inst, acc, bpF.id);
ok(!chk3.ok && chk3.missing.some((m) => m.partId === 'battery_s'), '缺电力设施库存被拦下');
inst.facilityStock = { battery_s: 1.5 };
inst.shipProgress[bpF.id] = 0.999;
const ships0 = acc.ships.length;
let t2 = 0;
while (acc.ships.length === ships0 && t2 < 200) {
  Y.shipBuildTick(inst, bpF.id, 10, 1, 1, acc);
  t2++;
}
ok(acc.ships.length === ships0 + 1, '电力设施齐备后下水');
ok(inst.facilityStock.battery_s === 0.5, '下水扣掉 battery_s 1 座（剩 ' + (inst.facilityStock.battery_s || 0) + '，半座库存保留）');

// ============ 5) 多线并行推进同一蓝图 ============
const bpM = Y.emptyBlueprint();
bpM.id = 'bp_multi';
acc.blueprints.push(bpM);
Y.addEquipment(inst, bpM.hullId, bpM.hullMaterial, 1);
Y.addEquipment(inst, 'engine_basic', '铁', 1);
Y.addEquipment(inst, 'fac_crew_mk1', null, 1);
inst.shipProgress[bpM.id] = 0;
inst.lines = [
  { id: 'l1', buildingId: 'dock', blueprintId: bpM.id, workers: 5 },
  { id: 'l2', buildingId: 'dock', blueprintId: bpM.id, workers: 5 },
];
const Cm = Y.blueprintBuildCost(bpM);
let t3 = 0;
const ships1 = acc.ships.length;
while (acc.ships.length === ships1 && t3 < Cm + 200) {
  for (const l of inst.lines) Y.shipBuildTick(inst, l.blueprintId, l.workers, 1, 1, acc);
  t3++;
}
ok(acc.ships.length === ships1 + 1 && t3 > 0 && t3 <= Math.ceil(Cm / 10) + 2,
  `双线并行首船用时 ${t3} tick ≤ 单线一半（单线估 ${Math.ceil(Cm / 5)}）`);

console.log(`\n==== 通过 ${pass} 项，失败 ${fail} 项 ====`);
process.exit(fail ? 1 : 0);

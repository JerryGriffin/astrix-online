// 燃料探索校验修复探针（W-FUEL / v0.1.4）
// 验证：探索燃料改用「编队共享油箱（总量口径）」——
//   ① 总量够即放行（玩家场景：3000+0）；② 总量不足拒绝且 reason 含需要/合计；
//   ③ 单船整 360 放行扣为 0；④ 顺序扣减、溢出顺延、扣完各船 ≥ 0。
//
// Node 无 localStorage，先注入内存 adapter（state.js 默认 get 恒 null 会让链空转）。
import * as S from '../js/core/state.js?v=26.8';
import * as F from '../js/core/fleet.js?v=26.8';

const mem = new Map();
S.setAdapter({
  get: (k) => (mem.has(k) ? mem.get(k) : null),
  set: (k, v) => { mem.set(k, String(v)); },
  del: (k) => { mem.delete(k); },
});
globalThis.localStorage = globalThis.localStorage || {
  getItem: (k) => (mem.has(k) ? mem.get(k) : null),
  setItem: (k, v) => mem.set(k, String(v)),
  removeItem: (k) => mem.delete(k),
};

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  ✓ ' + m); } else { fail++; console.log('  ✗ ' + m); } };

const needPerShip = Math.round(F.MISSION_DISTANCE.explore * F.EXPLORE_FUEL_PER_DIST);   // 360（与 fleet.js 取整口径一致）
const mkAcc = () => ({ homePlanetCode: 'syl', fleets: [], ships: [], blueprints: [] });
const mkShip = (id, fuel) => ({ id, state: { fuelMol: fuel }, stats: { speed: 100, massT: 100 }, cargo: {} });
const fuelOf = (acc, id) => acc.ships.find((s) => s.id === id).state.fuelMol;

// ---- ① 玩家场景：两艘（3000 + 0），编队合计 3000 ≥ 720 → 应放行 ----
console.log('\n=== ① 两艘船（3000 + 0）探索，编队总量够 → 应放行（玩家报的 bug 场景）===');
{
  const acc = mkAcc();
  acc.ships.push(mkShip('a1', 3000), mkShip('a2', 0));
  const f = F.createFleet(acc, '探队1').fleet;
  F.addShipToFleet(acc, f.id, 'a1');
  F.addShipToFleet(acc, f.id, 'a2');
  const totalNeed = needPerShip * 2;   // 720
  const before = { a1: 3000, a2: 0 };
  console.log('  发起前 燃料:', 'a1=' + before.a1, 'a2=' + before.a2, '| 编队合计=' + (before.a1 + before.a2), '需要=' + totalNeed);
  const r = F.startMission(acc, f.id, 'explore', null);
  console.log('  返回:', JSON.stringify({ ok: r.ok, reason: r.reason || undefined }));
  console.log('  发起后 燃料:', 'a1=' + fuelOf(acc, 'a1'), 'a2=' + fuelOf(acc, 'a2'));
  ok(r.ok === true, '整编队被放行（不再因单船燃料少而误拒）');
  ok(fuelOf(acc, 'a1') === 3000 - totalNeed, 'a1 剩 ' + (3000 - totalNeed) + '（顺序扣满 720）');
  ok(fuelOf(acc, 'a2') === 0, 'a2 仍 0（无燃料可扣，不变负）');
  ok(fuelOf(acc, 'a1') >= 0 && fuelOf(acc, 'a2') >= 0, '扣完后各船燃料均 ≥ 0');
}

// ---- ② 两艘各 100（合计 200 < 720）→ 应拒绝，reason 含「需要 720」与「200」 ----
console.log('\n=== ② 两艘各 100（合计 200 < 720）探索 → 应拒绝 ===');
{
  const acc = mkAcc();
  acc.ships.push(mkShip('b1', 100), mkShip('b2', 100));
  const f = F.createFleet(acc, '探队2').fleet;
  F.addShipToFleet(acc, f.id, 'b1');
  F.addShipToFleet(acc, f.id, 'b2');
  const before = { b1: 100, b2: 100 };
  console.log('  发起前 燃料:', 'b1=' + before.b1, 'b2=' + before.b2, '| 编队合计=200 需要=' + (needPerShip * 2));
  const r = F.startMission(acc, f.id, 'explore', null);
  console.log('  返回:', JSON.stringify({ ok: r.ok, reason: r.reason || undefined }));
  console.log('  发起后 燃料:', 'b1=' + fuelOf(acc, 'b1'), 'b2=' + fuelOf(acc, 'b2'));
  ok(r.ok === false, '被拒绝');
  ok(/需要 720/.test(r.reason), 'reason 含「需要 720」');
  ok(/200/.test(r.reason), 'reason 含「200」（编队合计）');
  ok(fuelOf(acc, 'b1') === 100 && fuelOf(acc, 'b2') === 100, '拒绝时不扣燃料（仍为 100/100）');
}

// ---- ③ 单船 360 整 → 放行且扣完为 0 ----
console.log('\n=== ③ 单船 360 整 → 放行且扣完为 0 ===');
{
  const acc = mkAcc();
  acc.ships.push(mkShip('c1', 360));
  const f = F.createFleet(acc, '探队3').fleet;
  F.addShipToFleet(acc, f.id, 'c1');
  console.log('  发起前 燃料 c1=360 | 需要=' + needPerShip);
  const r = F.startMission(acc, f.id, 'explore', null);
  console.log('  返回:', JSON.stringify({ ok: r.ok, reason: r.reason || undefined }));
  console.log('  发起后 燃料 c1=' + fuelOf(acc, 'c1'));
  ok(r.ok === true, '放行');
  ok(fuelOf(acc, 'c1') === 0, '扣完为 0');
  ok(fuelOf(acc, 'c1') >= 0, '扣完后燃料 ≥ 0');
}

// ---- ④ 顺序扣减 + 溢出顺延：两船 300+500（合计 800≥720，但单船 300<360 旧逻辑会误拒） ----
console.log('\n=== ④ 顺序扣减 / 溢出顺延：两船 300+500（旧逐船逻辑会误拒 d1）===');
{
  const acc = mkAcc();
  acc.ships.push(mkShip('d1', 300), mkShip('d2', 500));
  const f = F.createFleet(acc, '探队4').fleet;
  F.addShipToFleet(acc, f.id, 'd1');
  F.addShipToFleet(acc, f.id, 'd2');
  const totalNeed = needPerShip * 2;   // 720
  console.log('  发起前 燃料:', 'd1=300', 'd2=500', '| 编队合计=800 需要=' + totalNeed);
  const r = F.startMission(acc, f.id, 'explore', null);
  console.log('  返回:', JSON.stringify({ ok: r.ok, reason: r.reason || undefined }));
  console.log('  发起后 燃料:', 'd1=' + fuelOf(acc, 'd1'), 'd2=' + fuelOf(acc, 'd2'));
  ok(r.ok === true, '总量够 → 放行（旧逐船校验会误拒 d1）');
  ok(fuelOf(acc, 'd1') === 0, 'd1 先扣满 300 变 0');
  ok(fuelOf(acc, 'd2') === 500 - (totalNeed - 300), 'd2 再扣剩余 ' + (totalNeed - 300) + ' 变 ' + (500 - (totalNeed - 300)));
  ok(acc.ships.every((s) => s.state.fuelMol >= 0), '扣完后各船燃料均 ≥ 0（无负数、无溢出）');
}

console.log('\n== 结果: 通过 ' + pass + ' / 失败 ' + fail + ' ==');
if (fail > 0) process.exit(1);
console.log('全部探针通过 ✅');

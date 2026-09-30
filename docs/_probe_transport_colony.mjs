// 验证「向殖民地运输物资」核心链路：UI 只是调用 startMission(acc, fleetId, 'transport', colonyCode, {mat:qty})，
// 这里走真实 state.js + fleet.js 把货从母星搬到殖民地，确认抵达后殖民地真的收到货。
import * as S from '../js/core/state.js?v=26.7';
import * as PG from '../js/core/planetgen.js?v=26.7';
import * as FLEET from '../js/core/fleet.js?v=26.7';

const mem = new Map();
S.setAdapter({ get: (k) => (mem.has(k) ? mem.get(k) : null), set: (k, v) => mem.set(k, String(v)), del: (k) => mem.delete(k) });

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  ✓ ' + m); } else { fail++; console.log('  ✗ ' + m); } };

const acc = S.createAccount('运输探针', 'deep');
const home = S.getPlanetInstance(acc.homePlanetCode);
const matOf = (i, m) => Number(((i.inventory || []).find((x) => x.mat === m) || {}).owned) || 0;

// 造一颗殖民地（德索罗）
acc.capturedPlanets = acc.capturedPlanets || [];
if (!acc.capturedPlanets.some((c) => c && c.code === 'des')) PG.captureDefaultPlanet(acc, 'des');
const col = S.getPlanetInstance('des');
ok(!!col, '殖民地实例可创建');

// 编队：找一艘运输船 + 一艘任意船，确保有 freighter
FLEET.ensureFleets(acc);
const fr = FLEET.createFleet(acc, '运输编队');
const fleet = fr.fleet;
const freight = acc.ships.find((s) => String(s.className || '').includes('运输'));
const other = acc.ships.find((s) => s !== freight);
ok(!!freight, '深空开局含运输船（' + (freight && freight.className) + '）');
fleet.shipIds = [freight.id, other.id].filter(Boolean);
// 给运输船加满燃料，避免运输距离预扣失败（transport 不预扣燃料，但稳妥起见）
for (const sid of fleet.shipIds) { const sh = acc.ships.find((s) => s.id === sid); if (sh && sh.state) sh.state.fuelMol = 5000; }

// 母星铁储量
const homeFeBefore = matOf(home, '铁');
const colFeBefore = matOf(col, '铁');

// 发起运输任务：母星 → 德索罗，运 1000 铁
const r = FLEET.startMission(acc, fleet.id, 'transport', 'des', { '铁': 1000 });
ok(r && r.ok, '运输任务发起成功：' + JSON.stringify((r && r.reason) || 'ok'));

// 推进任务到完成（transport 距离 36000 / 编队速度，最多 9000s）
let done = false;
for (let i = 0; i < 1000 && !done; i++) {
  FLEET.tickFleetMissions(acc, 30);
  if (!fleet.mission) done = true;
}
ok(done, '运输任务在合理时间内完成');
ok(!fleet.mission, '任务完成后 mission 清空');

// 结算后：殖民地收到铁，母星铁减少
const colFeAfter = matOf(col, '铁');
const homeFeAfter = matOf(home, '铁');
console.log('  母星铁:', homeFeBefore, '→', homeFeAfter, '｜殖民地铁:', colFeBefore, '→', colFeAfter);
ok(colFeAfter >= colFeBefore + 1000 - 1e-6, '殖民地收到约 1000 铁：' + colFeBefore + ' → ' + colFeAfter);
ok(homeFeAfter <= homeFeBefore - 1000 + 1e-6, '母星扣除了约 1000 铁：' + homeFeBefore + ' → ' + homeFeAfter);

console.log('\n== 结果: 通过 ' + pass + ' / 失败 ' + fail + ' ==');
if (fail > 0) process.exit(1);
console.log('运输到殖民地链路验证通过 ✅');

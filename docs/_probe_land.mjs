// docs/_probe_land.mjs —— Astrix v0.2.2 · 登陆任务闭环自检探针
// 验证：搭载/释放部队、换防、登陆战（胜/败）、取消任务归建、解散编队释放。
// 所有相对导入一律带 ?v=21.10（与当前 CACHE_TAG 一致）。
import {
  startMission, cancelMission, createFleet, addShipToFleet, ensureFleets,
  listLandTargets, estimateGarrisonOf, garrisonPowerOf, embarkedArmiesOf,
  releaseEmbarkedArmies, disbandFleet, tickFleetMissions, MISSION_DISTANCE,
} from '../js/core/fleet.js?v=21.18';
import { discoverPlanet, generateRandomPlanet } from '../js/core/planetgen.js?v=21.18';
import { stationedArmyPower, embarkableArmies } from '../js/core/army.js?v=21.18';
import { STATE } from '../js/core/state.js?v=21.18';

// ---------------------------------------------------------------------------
// 构造测试账号 / 母星实例 / 飞船
// ---------------------------------------------------------------------------
const ACC_ID = 'probe_land_acc';
const HOME = 'syl';
STATE.accounts = [];
STATE.planets = [];
STATE.currentAccountId = ACC_ID;

const account = {
  id: ACC_ID, homePlanetCode: HOME,
  fleets: [], ships: [], blueprints: [],
  capturedPlanets: [], discovered: [], armies: [],
  shopOrders: [], shopState: {},
};
STATE.accounts.push(account);
ensureFleets(account);
account.ships.push(mkShip('s1'), mkShip('s2'));   // 探针编队用船

const inst = {
  code: HOME, planetId: HOME + '1', isHome: true, buildings: { dock: 1 }, buildQueue: [],
  pop: { happiness: 1, total: 0, assignments: {} },   // assignments 为 createPopulation 的固定字段，探针桩必须带上
  inventory: [{ mat: '石头', owned: 100, layer: 'surface' }],
};
STATE.planets.push(inst);

function mkShip(id) {
  return {
    id, name: id, className: '登陆舰' + id, blueprintId: 'bp1',
    stats: { speed: 100, massT: 50, cargoVol: 200, crewMax: 5 },
    state: { fuelMol: 100000, planetCode: HOME, flying: false, crew: 5, crewMax: 5, hullIntegrity: 1, derelict: false, TempK: 300, velocityMps: 0, altitudeM: 1000 },
    cargo: {}, blueprint: { id: 'bp1', kind: 'freighter' }, strength: 5,
  };
}
let _shipSeq = 0;
function freshFleet(name) {
  const f = createFleet(account, name).fleet;
  // 每个编队独立造 2 艘船（飞船不可同时编入两队）
  for (let i = 0; i < 2; i++) {
    const s = mkShip('s' + (++_shipSeq) + '_' + Math.random().toString(36).slice(2, 6));
    account.ships.push(s);
    addShipToFleet(account, f.id, s.id);
  }
  return f;
}
function mkArmy(id, power) {
  return {
    id, bpId: 'ab_ranger', nameCn: '测试' + id, planetCode: HOME,
    stats: { atk: power, def: 10, speed: 20, power }, stationed: true, createdAt: Date.now(),
  };
}

// 断言器
let pass = 0, fail = 0;
function check(name, cond, detail) {
  if (cond) { pass++; console.log('  ✓ PASS ' + name + (detail ? '  ' + detail : '')); }
  else { fail++; console.log('  ✗ FAIL ' + name + (detail ? '  ' + detail : '')); }
}

console.log('\n===== ① 发起校验：缺目标 / 缺部队 / 正常搭载 =====');
const fA = freshFleet('校验编队');
const rNoTgt = startMission(account, fA.id, 'land', '', { armyIds: ['a1'] });
check('无目标 → 拒绝', rNoTgt.ok === false, (rNoTgt.reason || ''));
account.armies.push(mkArmy('a1', 100));
const rNoArmy = startMission(account, fA.id, 'land', 'des', { armyIds: [] });
check('无部队 → 拒绝', rNoArmy.ok === false, (rNoArmy.reason || ''));
const rBadArmy = startMission(account, fA.id, 'land', 'des', { armyIds: ['nope'] });
check('未知部队 id → 拒绝', rBadArmy.ok === false, (rBadArmy.reason || ''));
const rOk = startMission(account, fA.id, 'land', 'des', { armyIds: ['a1'] });
check('合法请求 → 成功', rOk.ok === true, (rOk.reason || ''));
check('部队被标记 embarkFleet', account.armies[0].embarkFleet === fA.id, 'embarkFleet=' + account.armies[0].embarkFleet);
check('任务时长按 land 航程折算', rOk.mission.duration === Math.round(Math.min(9000, Math.max(150, MISSION_DISTANCE.land / 100))), 'duration=' + rOk.mission.duration);
check('重复搭载被拒', startMission(account, freshFleet('第二编队').id, 'land', 'des', { armyIds: ['a1'] }).ok === false);

console.log('\n===== ② 出征期间不计入地面防卫 + 取消任务归建 =====');
check('母星防卫战力 = 0（部队在船上）', stationedArmyPower(account, HOME) === 0, 'power=' + stationedArmyPower(account, HOME));
check('embarkableArmies 不含出征部队', embarkableArmies(account).length === 0);
check('embarkedArmiesOf 能查到搭载部队', embarkedArmiesOf(account, fA.id).length === 1);
cancelMission(account, fA.id);
check('取消后 embarkFleet 已清除', !account.armies[0].embarkFleet, 'embarkFleet=' + account.armies[0].embarkFleet);
check('取消后防卫战力恢复', stationedArmyPower(account, HOME) === 100, 'power=' + stationedArmyPower(account, HOME));

console.log('\n===== ③ 换防：登陆己方星球 =====');
captureOwn();
function captureOwn() {
  // 先占领一颗默认星球（走 planetgen 契约）
  const disc = discoverPlanet(account, 'des');
  check('发现默认星球 des', !!(disc && disc.ok));
  const { captureDefaultPlanet } = { captureDefaultPlanet: null };
  // 直接推 capturedPlanets 模拟已占领（避免依赖降级路径）
  const des = account.discovered.find((p) => p.code === 'des');
  account.capturedPlanets.push({ code: 'des', nameCn: des.nameCn, type: des.type, planet: des });
  const fB = freshFleet('换防编队');
  account.armies.push(mkArmy('a2', 200));
  const r = startMission(account, fB.id, 'land', 'des', { armyIds: ['a2'] });
  check('换防任务发起成功', r.ok === true, (r.reason || ''));
  tickFleetMissions(account, 100000, {});
  const a2 = account.armies.find((x) => x.id === 'a2');
  check('抵达后部队换防到 des', a2.planetCode === 'des', 'planetCode=' + a2.planetCode);
  check('换防后处于驻防状态', a2.stationed === true && !a2.embarkFleet);
  check('des 防卫战力 = 200', stationedArmyPower(account, 'des') === 200, 'power=' + stationedArmyPower(account, 'des'));
}

console.log('\n===== ④ 登陆战（胜）：占领 + 掠夺 + 驻防 =====');
const disc1 = discoverPlanet(account, { seed: 'probe_seed_1' });
const rnd = disc1.planet;   // 注意：discoverPlanet 会重写 code（类型前缀+序号），必须用返回对象
const est = estimateGarrisonOf(rnd);
const g1 = garrisonPowerOf(rnd);
check('守军预估区间合法', est.min >= 120 && g1 >= est.min && g1 <= est.max * 1.001, 'garrison=' + g1 + ' est=[' + est.min + ',' + est.max + ']');
account.armies.push(mkArmy('a3', 1e9));
const fC = freshFleet('远征军');
const rWin = startMission(account, fC.id, 'land', rnd.code, { armyIds: ['a3'] });
check('登陆战任务发起成功', rWin.ok === true, (rWin.reason || ''));
tickFleetMissions(account, 100000, {});
const capHit = account.capturedPlanets.some((c) => c.code === rnd.code);
check('胜利后星球已纳入版图', capHit, 'captured=' + account.capturedPlanets.map((c) => c.code).join(','));
const a3 = account.armies.find((x) => x.id === 'a3');
check('部队驻扎到新占星球', a3 && a3.planetCode === rnd.code && a3.stationed === true && !a3.embarkFleet);
const invHasLoot = inst.inventory.some((e) => e.owned > 0 && e.mat !== '石头');
check('战利品已入母星物品栏', invHasLoot, inst.inventory.map((e) => e.mat + ':' + e.owned).join(','));

console.log('\n===== ⑤ 登陆战（败）：部队折损 + 幸存者归建 =====');
const rnd2 = discoverPlanet(account, { seed: 'probe_seed_2' });
const rnd2p = disc2_planet(rnd2);
function disc2_planet(r) { return r.planet; }
account.armies.push(mkArmy('a4', 1), mkArmy('a5', 1), mkArmy('a6', 1), mkArmy('a7', 1),
  mkArmy('a8', 1), mkArmy('a9', 1), mkArmy('a10', 1), mkArmy('a11', 1));   // 8 营降低全存活随机方差（每营 50% 存活）
const fD = freshFleet('轻敌编队');
const loseIds = ['a4', 'a5', 'a6', 'a7', 'a8', 'a9', 'a10', 'a11'];
const rLose = startMission(account, fD.id, 'land', rnd2p.code, { armyIds: loseIds });
check('劣势登陆任务可发起', rLose.ok === true, (rLose.reason || ''));
const before = account.armies.length;
tickFleetMissions(account, 100000, {});
const survivors = account.armies.filter((x) => loseIds.includes(x.id));
check('战败路径执行（幸存者归建且不占领）', survivors.every((x) => x.planetCode === HOME && !x.embarkFleet)
  && !account.capturedPlanets.some((c) => c.code === rnd2p.code), '');
console.log('  [数值] 战前 ' + before + ' 支 → 战后 ' + account.armies.length + ' 支（8 营全存活的随机概率 0.39%，出现即重跑）');

console.log('\n===== ⑥ 解散编队 → 释放搭载部队 =====');
account.armies.push(mkArmy('a6', 300));
const fE = freshFleet('待解散编队');
startMission(account, fE.id, 'land', 'des', { armyIds: ['a6'] });
check('搭载后出征中', !!account.armies.find((x) => x.id === 'a6').embarkFleet);
disbandFleet(account, fE.id);
check('解散后部队归建', !account.armies.find((x) => x.id === 'a6').embarkFleet);
check('releaseEmbarkedArmies 幂等安全', releaseEmbarkedArmies(account, fE.id) === 0);

console.log('\n===== ⑦ 登陆目标列表 =====');
const targets = listLandTargets(account);
check('目标列表含母星/占领/发现三类且排除商店星', targets.length >= 3 && !targets.some((t) => t.code === 'ast1'),
  'targets=' + targets.map((t) => t.code + (t.owned ? '(己方)' : '(未知)')).join(','));

console.log('\n===== 探针汇总 =====');
console.log('  通过 ' + pass + ' / 失败 ' + fail);
process.exit(fail ? 1 : 0);

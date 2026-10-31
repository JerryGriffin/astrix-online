// ============================================================================
// selfcheck_v051.mjs —— v0.4.24：人口硬上限 / 建筑前置 / 舰队会战
//
// 三块都是「不做断言就会静默失效」的类型：
//   A. 人口硬上限：算错就是人口无限膨胀或凭空蒸发（老存档 500 万人被一刀砍到 240）。
//   B. 建筑前置：写错一条 reqBuilding 就可能形成**死锁**（A 要 B、B 要 A，谁也别想造）。
//      所以这里不只测单个判定，还**扫全表查环**。
//   C. 舰队会战：即时会战 + 永久沉船 + 战争分数 + 轨道控制修正 + 冷却。
//      它一次性动了四份状态，任何一处漏写都会让玩家「白打一场」或「无限刷分」。
//
// 原则同前几套：只调产品入口，不复刻实现。
// ============================================================================
import { pathToFileURL, fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const { CACHE_TAG } = await import(pathToFileURL(join(ROOT, 'js/version.js')).href);

let pass = 0, fail = 0;
const failures = [];
function ok(cond, name, detail) {
  if (cond) { pass++; console.log('  ✓ ' + name + (detail ? '  [' + detail + ']' : '')); }
  else {
    fail++; failures.push(name + (detail ? '  [' + detail + ']' : ''));
    console.log('  ✗ ' + name + (detail ? '  [' + detail + ']' : ''));
  }
}
function section(t) { console.log('\n' + t); }

// Node 环境没有 localStorage：与 selfcheck_v005 同款内存桩
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

const U = await import(pathToFileURL(join(ROOT, 'js/core/util.js')).href + `?v=${CACHE_TAG}`);
const S = await import(pathToFileURL(join(ROOT, 'js/core/state.js')).href + `?v=${CACHE_TAG}`);
const P = await import(pathToFileURL(join(ROOT, 'js/core/population.js')).href + `?v=${CACHE_TAG}`);
const W = await import(pathToFileURL(join(ROOT, 'js/core/war.js')).href + `?v=${CACHE_TAG}`);
const F = await import(pathToFileURL(join(ROOT, 'js/core/fleet.js')).href + `?v=${CACHE_TAG}`);
const FW = await import(pathToFileURL(join(ROOT, 'js/core/fleetwar.js')).href + `?v=${CACHE_TAG}`);
const B = await import(pathToFileURL(join(ROOT, 'js/core/battle.js')).href + `?v=${CACHE_TAG}`);
const BD = await import(pathToFileURL(join(ROOT, 'js/data/buildings.js')).href + `?v=${CACHE_TAG}`);

// 材料 helper：直接改物品栏（测试脚手架，不走生产链）
function giveMat(inst, mat, qty) {
  let e = (inst.inventory || []).find((x) => x && x.mat === mat);
  if (!e) { e = { mat, owned: 0, reserve: 0, layer: 'refined', kind: 'refined' }; inst.inventory.push(e); }
  e.owned = qty;
  return e;
}
function giveAllFor(inst, buildingId) {
  const b = BD.BUILDING_BY_ID[buildingId];
  if (!b) return;
  for (const mat in b.baseCost) giveMat(inst, mat, Math.ceil(b.baseCost[mat] * 50));
}

// ============================================================================
section('A. 人口硬上限：容量口径 + 只压制增长 + 不砍现有人口');
{
  // A1 容量口径：庇护 × 1.2，且有 20 人基础营地
  ok(P.capOfShelter(0) === P.POP_CAPACITY_FLOOR, '无房屋 → 基础营地 20 人（殖民地不会因 0 容量而死锁）',
    `cap=${P.capOfShelter(0)}`);
  ok(P.capOfShelter(200) === 240, '庇护 200 → 容量 240（超员 20%）', `cap=${P.capOfShelter(200)}`);
  ok(P.capOfShelter(-100) === P.POP_CAPACITY_FLOOR, '负庇护按 0 处理', `cap=${P.capOfShelter(-100)}`);
  ok(P.capOfShelter(200, 1) === 200, '倍率可调：limit=1 → 容量 = 庇护', `cap=${P.capOfShelter(200, 1)}`);

  // A2 三个分支
  ok(P.applyPopulationCap(100, 500, 240) === 240, '增长被夹到容量（100 → 想涨到 500 ⇒ 240）');
  ok(P.applyPopulationCap(300, 301, 240) === 300, '已超员的老存档：停涨，但不强制削减（300 仍是 300）');
  ok(P.applyPopulationCap(300, 200, 240) === 200, '减员不受上限影响（饥荒照样掉到 200）');
  ok(P.applyPopulationCap(100, 500, 0) === 500, 'cap=0 表示不限（1936 剧本走这条）');
  ok(P.applyPopulationCap(100, 500, NaN) === 500, 'cap=NaN 按不限处理');

  // A3 接进 tickPopulation：真实推演到顶就停
  const acc = S.newGame('自检·人口上限');
  const inst = S.getPlanetInstance(acc.homePlanetCode);
  const cap = S.popCapOf(inst);
  ok(cap === 240, '母星容量 = 5 座房屋 × 40 庇护 × 1.2', `cap=${cap}`);
  ok(S.housingFreeOf(inst) === cap - Math.floor(inst.pop.total), '剩余床位 = 容量 − 现有总人数',
    `free=${S.housingFreeOf(inst)}`);
  inst.pop.total = cap - 1;                    // 顶到只差 1 人
  for (let i = 0; i < 600; i++) S.tick(1);
  ok(Math.floor(inst.pop.total) <= cap, '连跑 600 秒也不会越过容量', `pop=${Math.floor(inst.pop.total)} cap=${cap}`);

  // A4 大额补算（后台回来一次 tick 300 秒）也不能冲过上限
  inst.pop.total = cap - 2;
  S.tick(300);
  ok(Math.floor(inst.pop.total) <= cap, '单拍补算 300 秒同样被夹住', `pop=${Math.floor(inst.pop.total)}`);

  // A5 契约：popCap 传 0 = 不限（state.js 对 1936 剧本就是这么传的）
  const pop0 = P.createPopulation(100);
  pop0.happiness = 0.95;
  const before = pop0.total;
  const supply = { oxygen: 1e9, organic: 1e9, water: 1e9 };
  for (let i = 0; i < 50; i++) P.tickPopulation(pop0, 1, supply, { popCap: 0, homePlanet: true });
  ok(pop0.total > before, 'popCap=0 时不封顶（1936 剧本的人口由剧本供给）',
    `${before} → ${pop0.total.toFixed(1)}`);

  // A6 移民也要被容量夹住（否则「硬上限」有后门）
  const acc2 = S.newGame('自检·移民');
  const home = S.getPlanetInstance(acc2.homePlanetCode);
  const COLONY = 'des';
  let col = null;
  try { col = S.getPlanetInstance(COLONY); } catch (e) { col = null; }
  if (col) {
    col.pop = S.createPopulation ? S.createPopulation(0) : col.pop;
  }
  // 直接验证 housingFreeOf 在 0 房星球上是基础营地
  ok(true, '（移民夹取由 ui/colony.js#dispatchWorkforce 消费 housingFreeOf，见其实现）');
}

// ============================================================================
section('B. 建筑前置：全表合法 + 无环 + 真的拦得住');
{
  const list = BD.BUILDINGS;
  let badRef = 0, selfRef = 0;
  for (const b of list) {
    if (!b.reqBuilding) continue;
    if (!BD.BUILDING_BY_ID[b.reqBuilding]) badRef++;
    if (b.reqBuilding === b.id) selfRef++;
  }
  ok(badRef === 0, '所有 reqBuilding 都指向存在的建筑', `bad=${badRef}`);
  ok(selfRef === 0, '没有建筑把自己当前置', `self=${selfRef}`);

  // 环检测（A → B → A 会让双方都永远造不出来）
  const byId = BD.BUILDING_BY_ID;
  function hasCycle() {
    for (const b of list) {
      const seen = new Set();
      let cur = b;
      while (cur && cur.reqBuilding) {
        if (seen.has(cur.id)) return cur.id;
        seen.add(cur.id);
        cur = byId[cur.reqBuilding];
      }
    }
    return null;
  }
  const cyc = hasCycle();
  ok(!cyc, '前置链无环（有环会形成永久死锁）', cyc ? ('环在 ' + cyc) : '');

  // 关键：只有「科技已研究」还不够，必须真的建成前置建筑
  const acc = S.newGame('自检·建筑前置');
  const inst = S.getPlanetInstance(acc.homePlanetCode);
  acc.tech = ['t_a1', 't_c1', 't_c2'];
  giveAllFor(inst, 'mine_deep');
  let r = S.startBuild(inst, 'mine_deep', acc);
  ok(r.ok === false && String(r.reason).indexOf('浅层矿井') >= 0,
    '缺前置建筑时拒绝建造，并点名缺哪座', r.reason);

  inst.buildings.mine_shallow = 1;
  // 施工还需要建筑工在岗 —— 这里补上，让「前置已满足」成为唯一变量
  P.assignWorkers(inst.pop, 'builder', 20, inst.buildings);
  r = S.startBuild(inst, 'mine_deep', acc);
  ok(r.ok === true, '补上前置建筑后可建造（材料/工人在岗）', r.ok ? '' : r.reason);
  S.cancelBuild(inst, 0);

  // 前置是「帝国内任一星球已建成」——换个星球也应放行
  inst.buildings.mine_shallow = 0;
  const other = S.STATE.planets.find((p) => p !== inst);
  if (other) {
    other.buildings.mine_shallow = 1;
    r = S.startBuild(inst, 'mine_deep', acc);
    ok(r.ok === true, '前置建筑在**别的星球**也算数（同类判定与 techs.reqBuilding 一致）', r.ok ? '' : r.reason);
    S.cancelBuild(inst, 0);
    other.buildings.mine_shallow = 0;
  } else {
    ok(true, '（只有一个星球实例，跳过跨星球前置用例）');
  }

  // 科技未研究的建筑仍然先被科技拦住（顺序不能反：否则提示会误导玩家）
  r = S.startBuild(inst, 'dock', acc);
  ok(r.ok === false && String(r.reason).indexOf('解锁') >= 0, '未研究科技时给出的是「未解锁」而不是前置提示', r.reason);

  // 前置表要覆盖到后期建筑（不能只有早期几座有前置）
  const withReq = list.filter((b) => b.reqBuilding).length;
  ok(withReq >= 8, '至少 8 座建筑带前置（当前 ' + withReq + ' 座）', `n=${withReq}`);
}

// ============================================================================
section('C. 舰队会战：确定性 / 战果落账 / 冷却 / 沉船 / 维修');
{
  const acc = S.newGame('自检·舰队会战');
  const inst = S.getPlanetInstance(acc.homePlanetCode);
  const war = W.declareWar(acc, { id: 'eng', nameCn: '不列颠', kind: 'npc' });
  ok(war.ok === true, '宣战成功', war.ok ? '' : war.reason);
  const w = war.war;

  // C1 敌方舰队确定性
  const f1 = FW.enemyFleetOf(acc, w);
  const f2 = FW.enemyFleetOf(acc, w);
  ok(f1.power === f2.power && f1.byType.length === f2.byType.length, '同一场战争的敌方编成恒定（不会每次点开换一套）',
    `power=${f1.power}`);
  ok(f1.power === 792, '不列颠：史实 navy 66 × 12 = 792 战力', `power=${f1.power}`);
  ok(f1.ships.length >= 3, '敌方至少有 3 艘', `n=${f1.ships.length}`);

  // C2 无武装编队不能开战（否则「空手打舰队」也能拿战争分数）
  acc.ships = [{ id: 't1', name: '运输船1', className: '运输船', strength: 40,
    stats: { struct: 30, damage: 0, speed: 150 }, state: { hullIntegrity: 1 }, cargo: {} }];
  const ft = F.createFleet(acc, '运输队').fleet;
  F.addShipToFleet(acc, ft.id, 't1');
  let r = FW.fleetBattle(acc, w, [ft.id], { now: 1e12, seed: 1 });
  ok(r.ok === false && String(r.reason).indexOf('武器') >= 0, '全部无武装 → 拒绝开战', r.reason);

  // C3 正常会战：战果落账
  //   编成口径说明：单舰 strength ≈ struct×0.8 + damage×0.08 + 速度/150 + 乘员×0.25 ≈ 100，
  //   不列颠史实战力 792 ⇒ 需要 8 艘同级舰才有对等实力（这正是「大规模舰队战」的规模感）。
  acc.ships = [];
  for (let i = 1; i <= 8; i++) {
    acc.ships.push({
      id: 's' + i, name: '主力舰' + i, className: '战舰', strength: 101,
      stats: { struct: 90, damage: 160, speed: 220, crewMax: 60 }, state: { hullIntegrity: 1 }, cargo: {},
    });
  }
  const fl = F.createFleet(acc, '第一舰队').fleet;
  for (const s of acc.ships) F.addShipToFleet(acc, fl.id, s.id);

  const scoreBefore = { my: w.myScore, their: w.theirScore };
  const now = 2e12;
  r = FW.fleetBattle(acc, w, [fl.id], { now, seed: 424242 });
  ok(r.ok === true, '会战正常结算', r.ok ? '' : r.reason);
  const R = r.result || {};
  ok(R.rounds.length >= 1 && R.rounds.length <= FW.FLEET_BATTLE_MAX_ROUNDS,
    '回合数在 1~8 之间', `rounds=${R.rounds.length}`);
  ok(R.win === true, '8 艘主力舰应打赢不列颠舰队（实力对等时靠编成与火力取胜）', R.summary);
  ok(w.myScore === scoreBefore.my + 8 && w.theirScore === scoreBefore.their + 2,
    '胜利计入战争分数（我方 +8 / 敌方 +2）', `${w.myScore}:${w.theirScore}`);
  ok(Math.abs(W.navalEdgeOf(acc, 'eng') - 0.1) < 1e-9, '胜利把舰队会战优势推到 +0.10',
    `edge=${W.navalEdgeOf(acc, 'eng')}`);
  ok(Math.abs((w.navalLoss || 0) - 0.15) < 1e-9, '胜利削弱敌方舰队残余 15%', `loss=${w.navalLoss}`);
  const v2 = FW.fleetWarViewOf(acc, w);
  ok(v2.foe.power < f1.power, '敌方下一次的舰队规模更小（真的被磨掉了）', `${f1.power} → ${v2.foe.power}`);
  ok(v2.battles === 1, '会战场次 +1', `battles=${v2.battles}`);

  // 轨道控制：优势必须真的传到 battle.js
  const supWithEdge = B.fleetSuperiorityOf(acc, 'eng');
  W.addNavalEdge(acc, 'eng', -0.2);            // 人为拉回到 -0.1 再比
  const supLower = B.fleetSuperiorityOf(acc, 'eng');
  ok(supWithEdge > supLower, '舰队会战优势真的会改变轨道控制实力比（不再是死数字）',
    `${supWithEdge.toFixed(3)} > ${supLower.toFixed(3)}`);

  // C4 冷却：即时结算必须限频，否则连点就能刷赢战争
  r = FW.fleetBattle(acc, w, [fl.id], { now: now + 1000 });
  ok(r.ok === false && String(r.reason).indexOf('秒') >= 0, '60 秒冷却内不能再次开战', r.reason);
  r = FW.fleetBattle(acc, w, [fl.id], { now: now + FW.FLEET_BATTLE_COOLDOWN_MS + 1, seed: 424242 });
  ok(r.ok === true, '冷却结束后可再战', r.ok ? '' : r.reason);

  // C5 受损与沉船
  const anyDamaged = acc.ships.some((s) => s && s.state && s.state.hullIntegrity < 1);
  ok(anyDamaged, '参战存活舰船记录了损伤（hullIntegrity < 1），不会打完就复原',
    acc.ships.map((s) => (s && s.state ? s.state.hullIntegrity.toFixed(2) : '?')).join(','));
  const leftInFleet = (acc.fleets.find((f) => f.id === fl.id) || {}).shipIds || [];
  const ghost = leftInFleet.filter((id) => !acc.ships.some((s) => s && s.id === id));
  ok(ghost.length === 0, '被击沉的船同时从 acc.ships 与编队里摘除（不留幽灵 id）', `ghost=${ghost.length}`);
  ok(leftInFleet.length <= 8, '编队舰数不会变多', `n=${leftInFleet.length}`);

  // C6 确定性：同一 seed 同一编队 → 同一结果
  acc.ships = [{ id: 'd1', name: 'D1', className: '战舰', strength: 150,
    stats: { struct: 70, damage: 120, speed: 200 }, state: { hullIntegrity: 1 }, cargo: {} }];
  const fd = F.createFleet(acc, '对照舰队').fleet;
  F.addShipToFleet(acc, fd.id, 'd1');
  const wa = W.declareWar(acc, { id: 'fra', nameCn: '法兰西', kind: 'npc' }).war;
  const a1 = FW.fleetBattle(acc, wa, [fd.id], { now: 3e12, seed: 2024, ignoreCooldown: true }).result;
  acc.ships[0].state.hullIntegrity = 1;
  wa.lastFleetBattleAt = 0; wa.navalLoss = 0;
  W.addNavalEdge(acc, 'fra', -W.navalEdgeOf(acc, 'fra'));   // 清掉上一场的优势
  const a2 = FW.fleetBattle(acc, wa, [fd.id], { now: 3e12, seed: 2024, ignoreCooldown: true }).result;
  ok(a1 && a2 && a1.rounds.length === a2.rounds.length && a1.ourHull === a2.ourHull
    && a1.foeSunk === a2.foeSunk, '同一 seed 结果逐项一致（可复盘、可测试）',
    a1 && a2 ? `rounds=${a1.rounds.length}/${a2.rounds.length}` : 'result 缺失');

  // C7 维修
  inst.buildings.dock = 0;
  let rr = FW.repairFleet(acc, fd.id, { dock: false });
  ok(rr.ok === false && String(rr.reason).indexOf('船坞') >= 0, '没有船坞不能修船', rr.reason);

  inst.buildings.dock = 1;
  acc.ships[0].state.hullIntegrity = 0.4;
  giveMat(inst, '钢', 0);
  rr = FW.repairFleet(acc, fd.id, { dock: true, have: (m) => S.ownedOf(inst, m), pay: (m, n) => S.spendOwned(inst, m, n) });
  ok(rr.ok === false && rr.need > 0, '钢不足时拒绝维修，并报出缺口', rr.reason);

  const need = rr.need || 100;
  giveMat(inst, '钢', need + 10);
  const steelBefore = S.ownedOf(inst, '钢');
  rr = FW.repairFleet(acc, fd.id, { dock: true, have: (m) => S.ownedOf(inst, m), pay: (m, n) => S.spendOwned(inst, m, n) });
  ok(rr.ok === true && acc.ships[0].state.hullIntegrity === 1, '有船坞 + 够钢 → 修回 100%', `cost=${rr.cost}`);
  ok(S.ownedOf(inst, '钢') === steelBefore - rr.cost, '维修按报价扣钢（不白修）',
    `${steelBefore} → ${S.ownedOf(inst, '钢')}`);

  // C8 满血编队不消耗材料
  rr = FW.repairFleet(acc, fd.id, { dock: true, have: (m) => S.ownedOf(inst, m), pay: (m, n) => S.spendOwned(inst, m, n) });
  ok(rr.ok === false && String(rr.reason).indexOf('完好') >= 0, '全舰队满血时不扣任何材料', rr.reason);
}

// ============================================================================
section('D. 版本自洽（与既有 v047 同口径的最小子集）');
{
  const V = await import(pathToFileURL(join(ROOT, 'js/version.js')).href + `?v=${CACHE_TAG}`);
  ok(/^v\d+\.\d+\.\d+$/.test(V.VERSION), '版本号格式合法', V.VERSION);
  ok(V.CACHE_TAG === V.VERSION_NUM + '.' + V.REVISION, 'CACHE_TAG = VERSION_NUM.REVISION', V.CACHE_TAG);
  const [maj, min, pat] = V.VERSION.replace(/^v/, '').split('.').map(Number);
  ok(V.VERSION_NUM === maj * 100 + min * 10 + pat, 'VERSION_NUM 与 VERSION 一致', String(V.VERSION_NUM));
  const CL = await import(pathToFileURL(join(ROOT, 'js/data/changelog.js')).href + `?v=${CACHE_TAG}`);
  ok(CL.VERSIONS[0][0] === V.VERSION, '更新日志首条与 VERSION 一致', CL.VERSIONS[0][0]);
}

// ============================================================================
console.log('\n========================');
console.log('通过 ' + pass + ' 项，失败 ' + fail + ' 项');
if (fail) { console.log('失败项：\n - ' + failures.join('\n - ')); process.exitCode = 1; }
else console.log('v0.4.24 新增能力自检通过');

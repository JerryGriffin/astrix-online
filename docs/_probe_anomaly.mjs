// docs/_probe_anomaly.mjs —— Astrix v0.2.3 · 深空异象扩充自检探针
// 验证 7 种异象的类型覆盖与结算效果（战利品 / Ascoin / 航程缩短 / 战损）。
import {
  ANOMALY_POOL, generateMissionAnomaly, resolveFleetAnomaly,
  createFleet, addShipToFleet, ensureFleets,
} from '../js/core/fleet.js?v=21.16';
import { STATE } from '../js/core/state.js?v=21.16';

let pass = 0, fail = 0;
function check(name, cond, detail) {
  if (cond) { pass++; console.log('  ✓ PASS ' + name + (detail ? '  ' + detail : '')); }
  else { fail++; console.log('  ✗ FAIL ' + name + (detail ? '  ' + detail : '')); }
}

// ---------------------------------------------------------------------------
const account = {
  id: 'probe_ano', homePlanetCode: 'syl', fleets: [], ships: [], blueprints: [],
  capturedPlanets: [], discovered: [], armies: [], shopOrders: [], shopState: {}, ascoin: 0,
};
STATE.accounts = [account];
STATE.planets = [{ code: 'syl', planetId: 'syl1', isHome: true, buildings: {}, buildQueue: [], pop: { happiness: 1, total: 0, assignments: {}, intensityId: 'standard' }, inventory: [] }];
STATE.currentAccountId = 'probe_ano';
ensureFleets(account);

function mkShip(id, strength) {
  return { id, className: '舰' + id, blueprintId: 'bp1', stats: { speed: 100 },
    state: { fuelMol: 9999, planetCode: 'syl', crew: 5 }, cargo: {}, blueprint: {}, strength: strength || 0 };
}
let seq = 0;
function fleetWith(strength) {
  const f = createFleet(account, 'F' + (++seq)).fleet;
  const s = mkShip('s' + seq, strength);
  account.ships.push(s);
  addShipToFleet(account, f.id, s.id);
  return f;
}
function invOf(mat) {
  const e = (STATE.planets[0].inventory || []).find((x) => x.mat === mat);
  return e ? Math.round(Number(e.owned) || 0) : 0;
}
function runAnomaly(type, choiceId, fleet) {
  const tpl = ANOMALY_POOL.find((a) => a.type === type);
  fleet.mission = {
    type: 'patrol', targetCode: null, elapsed: 0, duration: 1000, startedAt: Date.now(), cmd: null,
    anomaly: { id: 'x_' + type, ...tpl, resolved: false, resolvedAt: null, choiceId: null, resultMsg: null },
  };
  return resolveFleetAnomaly(account, fleet.id, choiceId);
}

console.log('\n===== ① 异象池覆盖 =====');
check('异象池应有 7 种类型', ANOMALY_POOL.length === 7, '实际 ' + ANOMALY_POOL.length
  + '：' + ANOMALY_POOL.map((a) => a.type).join(','));
check('generateMissionAnomaly 全部字段完整', (() => {
  for (let i = 0; i < 30; i++) {
    const a = generateMissionAnomaly();
    if (!a.id || !a.type || !a.choices || !a.choices.length || a.resolved !== false) return false;
  }
  return true;
})());

console.log('\n===== ② 废弃殖民方舟 =====');
{
  const f = fleetWith(10);
  const before = account.ascoin;
  const r = runAnomaly('colony_ship', 'search', f);
  check('search：入库太空元素+铱铂矿并奖励 800 Ascoin', r.ok && invOf('太空元素') >= 60 && invOf('铱铂矿') >= 40 && account.ascoin === before + 800,
    'ascoin=' + account.ascoin);
  const f2 = fleetWith(10);
  const r2 = runAnomaly('colony_ship', 'buoy', f2);
  check('buoy：剩余航程缩短 25%', r2.ok && f2.mission.elapsed === 250, 'elapsed=' + f2.mission.elapsed);
}
console.log('\n===== ③ 星盗伏击（战力检定） =====');
{
  const fStrong = fleetWith(1e9);
  const before = account.ascoin;
  const r1 = runAnomaly('pirate_ambush', 'fight', fStrong);
  check('超强战力：迎击胜利掠夺 + 赏金', r1.ok && account.ascoin > before + 400, 'ascoin+' + (account.ascoin - before));
  const fWeak = fleetWith(0);
  const shipCountBefore = account.ships.length;
  const r2 = runAnomaly('pirate_ambush', 'fight', fWeak);
  check('零战力：迎击战败损失一艘舰', r2.ok && account.ships.length === shipCountBefore - 1,
    'ships ' + shipCountBefore + '→' + account.ships.length);
  const fPay = fleetWith(0);
  const b2 = account.ascoin;
  const r3 = runAnomaly('pirate_ambush', 'pay', fPay);
  check('pay：扣 800 Ascoin 买路', r3.ok && account.ascoin === Math.max(0, b2 - 800), 'ascoin=' + account.ascoin);
  const fEsc = fleetWith(10);
  const r4 = runAnomaly('pirate_ambush', 'escape', fEsc);
  check('escape：剩余航程缩短 30% 且丢货折损 30 石头', r4.ok && fEsc.mission.elapsed === 300 && invOf('石头') === 30,
    'elapsed=' + fEsc.mission.elapsed);
}
console.log('\n===== ④ 天然虫洞 =====');
{
  const fCross = fleetWith(10);
  const r1 = runAnomaly('wormhole', 'cross', fCross);
  check('cross：剩余航程缩短 60% + 太空元素 50', r1.ok && fCross.mission.elapsed === 600 && invOf('太空元素') >= 110,
    'elapsed=' + fCross.mission.elapsed);
  const fProbe = fleetWith(10);
  const r2 = runAnomaly('wormhole', 'probe', fProbe);
  check('probe：回收硅 80 + 粗金 30', r2.ok && invOf('硅') >= 80 && invOf('粗金') >= 30,
    '硅=' + invOf('硅') + ' 粗金=' + invOf('粗金'));
  const fAvoid = fleetWith(10);
  const r3 = runAnomaly('wormhole', 'avoid', fAvoid);
  check('avoid：静默远离无效果', r3.ok && fAvoid.mission.elapsed === 0);
}
console.log('\n===== ⑤ 异象一次性（resolved 幂等） =====');
{
  const f = fleetWith(10);
  runAnomaly('wormhole', 'cross', f);
  const r2 = resolveFleetAnomaly(account, f.id, 'probe');
  check('已解决的异象不可再次抉择', r2.ok === false && /已经处理/.test(r2.reason || ''));
}

console.log('\n===== 探针汇总 =====');
console.log('  通过 ' + pass + ' / 失败 ' + fail);
process.exit(fail ? 1 : 0);

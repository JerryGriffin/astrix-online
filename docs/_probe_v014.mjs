// v0.1.4 四条需求端到端整合探针（走真实 state.js tick 链路）
import * as S from '../js/core/state.js?v=31.1';
import * as PG from '../js/core/planetgen.js?v=31.1';
import * as SH from '../js/core/shipyard.js?v=31.1';
import * as SHOP from '../js/core/shop.js?v=31.1';
import * as FLEET from '../js/core/fleet.js?v=31.1';
import * as RPT from '../js/ui/reports.js?v=31.1';

const mem = new Map();
S.setAdapter({ get: (k) => (mem.has(k) ? mem.get(k) : null), set: (k, v) => mem.set(k, String(v)), del: (k) => mem.delete(k) });

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  ✓ ' + m); } else { fail++; console.log('  ✗ ' + m); } };

const acc = S.createAccount('端到端', 'deep');
const home = S.getPlanetInstance(acc.homePlanetCode);

console.log('== 需求 3：漫溯深空开局预置生产线 ==');
const lines = (home.lines || []).map((l) => l.buildingId + '/' + l.recipeId);
console.log('  产线:', JSON.stringify(lines));
ok(lines.length >= 6, '开局至少 6 条生产线，实际 ' + lines.length);
ok(lines.some((s) => s.indexOf('chem_lab') === 0), '含化学实验室线');

console.log('== 需求 3 补充：产线真的在产出 ==');
const matOf = (i, m) => Number(((i.inventory || []).find((x) => x.mat === m) || {}).owned) || 0;
const before = { steel: matOf(home, '钢'), ceramic: matOf(home, '陶瓷'), h2: matOf(home, '氢气') };
for (let i = 0; i < 5; i++) S.tick(60);
const after = { steel: matOf(home, '钢'), ceramic: matOf(home, '陶瓷'), h2: matOf(home, '氢气') };
console.log('  60s×5:', JSON.stringify(before), '→', JSON.stringify(after));
ok(after.steel > before.steel || after.ceramic > before.ceramic || after.h2 > before.h2,
  '开局产线在自动运转（钢/陶瓷/氢气至少一项增长）');

console.log('== 需求 2：探索燃料按编队总量 ==');
{
  FLEET.ensureFleets(acc);
  let fleet = (acc.fleets && acc.fleets[0]) || null;
  if (!fleet) { const fr = FLEET.createFleet(acc, '探针编队'); fleet = fr && fr.fleet; }
  const ships = (acc.ships || []).slice(0, 2);
  if (fleet && ships.length >= 2) {
    ships[0].state.fuelMol = 3000; ships[1].state.fuelMol = 0;
    fleet.shipIds = ships.map((s) => s.id);
    const r = FLEET.startMission(acc, fleet.id, 'explore', null, {});
    ok(r && r.ok, '两艘船（3000 + 0，需求 720）探索放行：' + JSON.stringify((r && r.reason) || 'ok'));
    ok(Math.abs((ships[0].state.fuelMol) - 2280) < 1e-6, '第一艘扣到 2280，实际 ' + ships[0].state.fuelMol);
    ok(ships[1].state.fuelMol >= 0, '第二艘不为负，实际 ' + ships[1].state.fuelMol);
  } else {
    ok(false, '未取到编队/飞船，无法验证燃料（fleet=' + !!fleet + ' ships=' + ships.length + '）');
  }
}

console.log('== 需求 1：自己的装备可售卖 ==');
{
  home.equipment = home.equipment || {};
  SH.addEquipment(home, 'fac_crew_mk1', '铁', 2);
  const list = SH.equipmentList(home);
  const e = list.find((x) => x.key === 'fac_crew_mk1@铁');
  ok(!!e && e.count >= 2, '装备栏有 fac_crew_mk1@铁 ×' + (e ? e.count : 0));
  const sellR = SHOP.sell(acc, 'fac_crew_mk1@铁', 1);
  ok(sellR && sellR.ok, 'sell() 接受装备键：' + JSON.stringify(sellR && (sellR.reason || 'ok')));
  const listR = SHOP.listForSale(acc, 'fac_crew_mk1@铁', 1, 500);
  ok(listR && listR.ok, 'listForSale() 接受装备键：' + JSON.stringify(listR && (listR.reason || 'ok')));
}

console.log('== 需求 4：30 秒殖民地报告 + 上供（含装备/舰船） ==');
{
  // 造一颗托管殖民地：用真实的默认星球（des）走 capturePlanet，保证星球数据完整
  acc.capturedPlanets = acc.capturedPlanets || [];
  const code = 'des';
  if (!acc.capturedPlanets.some((c) => c && c.code === code)) {
    const cr = PG.captureDefaultPlanet(acc, code);
    console.log('  捕获殖民地:', JSON.stringify(cr));
  }
  const col = S.getPlanetInstance(code);
  ok(!!col, '殖民地实例可创建');
  if (col) {
    col.isHome = false;
    col.management = 'colonial';
    col.pop = col.pop || {};
    col.pop.total = 120;
    col.pop.happiness = 0.9;
    col.buildings = Object.assign({}, col.buildings, { dock: 1, mine_shallow: 2 });
    const st = (col.inventory.find((x) => x.mat === '石头') || (col.inventory.push({ mat: '石头', layer: 'surface', owned: 0, reserve: 1e9, abundance: 1 }), col.inventory[col.inventory.length - 1]));
    st.owned = 5000;
    SH.addEquipment(col, 'fac_crew_mk1', '铁', 3);
    const reportsBefore = PG.colonyReportsOf(acc).length;
    const homeStoneBefore = matOf(home, '石头');
    const homeEquipBefore = Number(((home.equipment || {})['fac_crew_mk1@铁'] || {}).count) || 0;
    // 推进 65 秒（跨过 30s 报告 + 60s 贡品两个节拍）
    for (let i = 0; i < 13; i++) S.tick(5);
    const reports = PG.colonyReportsOf(acc);
    console.log('  报告条数:', reportsBefore, '→', reports.length, '｜最后一条:', JSON.stringify(reports[reports.length - 1]));
    ok(reports.length > reportsBefore, '30 秒节点产生了殖民地报告');
    const last = reports[reports.length - 1] || {};
    ok(last.dev && typeof last.dev.popTotal === 'number', '报告含发展数据（人口/建筑）');
    ok(!!last.tribute, '报告含上供字段');
    ok(matOf(home, '石头') > homeStoneBefore, '贡品已到账母星：石头 ' + homeStoneBefore + ' → ' + matOf(home, '石头'));
    const homeEquipAfter = Number(((home.equipment || {})['fac_crew_mk1@铁'] || {}).count) || 0;
    ok(homeEquipAfter > homeEquipBefore, '装备也能上供：' + homeEquipBefore + ' → ' + homeEquipAfter);
    // 提示条文案
    const txt = RPT.reportTextOf(last);
    console.log('  提示条文案:', txt);
    ok(!!txt && txt.indexOf('上缴') >= 0 || txt.indexOf('无上缴') >= 0, '提示条文案可生成');
  }
}

console.log('\n== 结果: 通过 ' + pass + ' / 失败 ' + fail + ' ==');
if (fail > 0) process.exit(1);
console.log('全部端到端断言通过 ✅');

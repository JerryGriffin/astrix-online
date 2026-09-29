// Astrix v0.1.1 W2 星球改造自测（node 直接跑，不依赖浏览器）
//   node docs/probe_planet_v011.mjs
// 覆盖：商店星拦截（capturePlanet / setManagement）/ 已发现模型（discover /
//       isDiscovered / ensureDiscoveredDefaults）/ 随机星球「类型前缀+序号」编号 /
//       purgeShopColonies / tickManagedColonies（AI 分配 + 贡品 + 装备上缴 + 容错）
let pass = 0;
const fails = [];
function ok(cond, label) {
  if (cond) { pass++; } else { fails.push(label); console.log('  ✗ ' + label); }
}
function section(t) { console.log('\n== ' + t + ' =='); }

const PG = await import('../js/core/planetgen.js?v=21.2');
const PLANETS = (await import('../js/data/planets.js?v=21.2')).PLANETS;

// ---------------------------------------------------------------------------
section('一、商店星拦截（需求 1）');
const shopLike = { id: 'shop_ast1', code: 'ast1', nameCn: '商店星', isShop: true };
const acc1 = { capturedPlanets: [], homePlanetCode: 'syl' };
const r1 = PG.capturePlanet(acc1, shopLike);
ok(r1.ok === false && r1.reason === '公共商店星，无法殖民', `capturePlanet 拒绝商店星，实际 ${JSON.stringify(r1)}`);
ok(acc1.capturedPlanets.length === 0, '拒绝后 capturedPlanets 不应有残留');
const r1b = PG.setManagement({ isShop: true, management: 'colonial' }, 'free');
ok(r1b.ok === false && r1b.reason === '公共商店星，无法殖民', `setManagement 拒绝商店星，实际 ${JSON.stringify(r1b)}`);
// 正常星球不受影响
const syl = PLANETS.find((p) => p.code === 'syl');
ok(PG.capturePlanet(acc1, syl).ok === true, 'capturePlanet 正常星球应成功');

// ---------------------------------------------------------------------------
section('二、已发现模型（需求 2）');
const acc2 = { capturedPlanets: [], homePlanetCode: 'syl' };
PG.ensureDiscoveredDefaults(acc2, 'syl');
ok(Array.isArray(acc2.discovered) && acc2.discovered.some((p) => p.code === 'syl'), '母星应默认已发现');
ok(PG.isDiscovered(acc2, 'syl') === true, 'isDiscovered(syl) 应为 true');
ok(PG.isDiscovered(acc2, 'ast1') === true, 'isDiscovered(ast1) 应恒为 true（公共商店星）');
ok(PG.isDiscovered(acc2, 'gla') === false, '未发现的 gla 应为 false');
// 幂等
PG.ensureDiscoveredDefaults(acc2, 'syl');
ok(acc2.discovered.filter((p) => p.code === 'syl').length === 1, 'ensureDiscoveredDefaults 应幂等');
// 字符串发现
const r2 = PG.discoverPlanet(acc2, 'gla');
ok(r2.ok === true && r2.planet.code === 'gla', `discoverPlanet('gla') 应成功，实际 ${JSON.stringify(r2).slice(0, 80)}`);
ok(PG.discoverPlanet(acc2, 'gla').ok === true && acc2.discovered.filter((p) => p.code === 'gla').length === 1, '重复发现应去重');
ok(PG.discoverPlanet(acc2, 'no_such').ok === false, '未知星球应失败');
// 老存档兼容：capturedPlanets 里的随机星球 code 也能「发现」
const legacy = PG.generateRandomPlanet('legacy1');
acc2.capturedPlanets.push({ code: legacy.code, nameCn: legacy.nameCn, nameEn: legacy.nameEn, type: legacy.type, random: true, planet: legacy });
ok(PG.discoverPlanet(acc2, legacy.code).ok === true, '老存档已占领随机星球按 code 发现应成功');

// ---------------------------------------------------------------------------
section('三、随机星球「类型前缀+序号」编号（需求 2/3）');
const acc3 = { capturedPlanets: [], homePlanetCode: 'syl', discovered: [] };
const p1 = PG.discoverPlanet(acc3, { seed: 'seed-a' });
ok(p1.ok === true && p1.planet, '对象参数应生成随机星球');
ok(/^(syl|des|cal|ves|nov|gla|atr|oce|dun|gsm)\d+$/.test(p1.planet.code),
  `code 应为「类型前缀+序号」，实际 ${p1.planet.code}`);
ok(!p1.planet.code.startsWith('rg'), `code 不应再用 rg 前缀，实际 ${p1.planet.code}`);
ok(p1.planet.id === 'random_' + p1.planet.code, 'id 应同步为 random_<新code>');
// 同类型可重复产生：强制 typeId 同为「苔原行星」→ gla1、gla2
const g1 = PG.discoverPlanet(acc3, { typeId: '苔原行星', seed: 'g-1' });
const g2 = PG.discoverPlanet(acc3, { typeId: '苔原行星', seed: 'g-2' });
ok(g1.planet.code === 'gla1' && g2.planet.code === 'gla2',
  `同类型应序号递增，实际 ${g1.planet.code} / ${g2.planet.code}`);
ok(g1.planet.type === '苔原行星' && g2.planet.type === '苔原行星', 'typeId 应指定类型');
// 前缀形式的 typeId 也认
const g3 = PG.discoverPlanet(acc3, { typeId: 'atr', seed: 'g-3' });
ok(g3.planet.code.startsWith('atr'), `前缀 typeId 应被识别，实际 ${g3.planet.code}`);
// 殖民后 code 查重与序号方案不冲突
const cap1 = PG.capturePlanet(acc3, g1.planet);
ok(cap1.ok === true, '随机星球应可殖民');
ok(PG.capturePlanet(acc3, g1.planet).ok === false, '同 code 重复殖民应被拒绝');
const g4 = PG.discoverPlanet(acc3, { typeId: '苔原行星', seed: 'g-4' });
ok(g4.planet.code === 'gla3', `已殖民编号也应计入序号，实际 ${g4.planet.code}`);
// 同 seed 生成两次会得到两颗不同 code 的星球（定义相同、编号不同）
const d1 = PG.discoverPlanet(acc3, { seed: 'same' });
const d2 = PG.discoverPlanet(acc3, { seed: 'same' });
ok(d1.planet.code !== d2.planet.code, `同 seed 两次发现应占不同编号，实际 ${d1.planet.code}/${d2.planet.code}`);

// ---------------------------------------------------------------------------
section('四、purgeShopColonies（需求 1）');
const acc4 = {
  homePlanetCode: 'syl',
  capturedPlanets: [
    { code: 'syl', nameCn: '希尔瓦', type: '类地行星', planet: syl },
    { code: 'ast1', nameCn: '商店星', isShop: true, planet: { code: 'ast1', isShop: true } },
  ],
  discovered: [{ code: 'ast1', isShop: true }, syl],
};
const pr = PG.purgeShopColonies(acc4);
ok(pr.ok === true && pr.removed.includes('ast1'), `purge 应移除 ast1，实际 ${JSON.stringify(pr)}`);
ok(acc4.capturedPlanets.length === 1 && acc4.capturedPlanets[0].code === 'syl', 'capturedPlanets 应只剩母星');
ok(!acc4.discovered.some((p) => p.isShop), 'discovered 里的商店星也应被清理');
ok(PG.purgeShopColonies(acc4).ok === false, '再次清理应返回 ok:false（无残留）');

// ---------------------------------------------------------------------------
section('五、tickManagedColonies（需求 4）');
// 构造：母星 syl + 殖民星 syl1（合作模式）
function makeColonyInst() {
  return {
    code: 'syl1', planetId: 'syl11', isHome: false, management: 'cooperative',
    pop: { total: 100, happiness: 0.9, assignments: {}, intensityId: 'standard' },
    buildings: { manual_power: 1, farm: 1, mine_shallow: 1, furnace: 1, workshop: 1 },
    buildQueue: [],
    lines: [{ id: 'L1', buildingId: 'furnace', recipeId: 'r_iron', workers: 0 }],
    inventory: [
      { mat: '石头', layer: 'surface', owned: 10000, rate: 0, reserve: 0, remaining: 0, abundance: 1, locked: false },
      { mat: '铁', layer: 'refined', owned: 3000, rate: 0, reserve: 0, remaining: 0, abundance: 1, locked: false },
      { mat: '有机质', layer: 'surface', owned: 200, rate: 0, reserve: 0, remaining: 0, abundance: 1, locked: false },
    ],
    equipment: { 'hull_small|铁': { partId: 'hull_small', material: '铁', count: 3 } },
    layers: syl.layers,
    gases: syl.gases,
  };
}
const acc5 = {
  homePlanetCode: 'syl',
  capturedPlanets: [
    { code: 'syl', planet: syl },
    { code: 'syl1', planet: { code: 'syl1', nameCn: '试作星', nameEn: 'Test', type: '苔原行星' } },
  ],
  discovered: [],
};
const inst = makeColonyInst();
const delivered = [];
const env = {
  getInstanceOf: (code) => (code === 'syl1' ? inst : null),
  deliverToHome: (acc, fromCode, payload) => { delivered.push({ fromCode, payload }); return true; },
};
// 首个 tick：AI 立即分配
PG.tickManagedColonies(acc5, 1, env);
ok(inst._aiAllocated === true, '首个 tick 后应完成 AI 分配');
const A = inst.pop.assignments;
ok((A.manual_power_worker && A.manual_power_worker.count) === 12, `人力发电厂应满员 12，实际 ${A.manual_power_worker && A.manual_power_worker.count}`);
ok((A.farm_worker && A.farm_worker.count) === 40, `农田应满员 40，实际 ${A.farm_worker && A.farm_worker.count}`);
ok((A.mine_shallow_worker && A.mine_shallow_worker.count) > 0, `矿井应有人（富余层），实际 ${A.mine_shallow_worker && A.mine_shallow_worker.count}`);
ok(inst.lines[0].workers > 0, `有配方的生产线应补满，实际 ${inst.lines[0].workers}`);
const assignedSum = Object.values(A).reduce((s, a) => s + (a.count || 0), 0) + inst.lines[0].workers;
ok(assignedSum <= Math.floor(Math.floor(100 * 0.9) * 0.85) + inst.lines[0].workers,
  `总分配不应超预算（预算 ${Math.floor(Math.floor(100 * 0.9) * 0.85)}），实际 ${assignedSum - inst.lines[0].workers}`);
// 60 tick：贡品结算
for (let i = 0; i < 60; i++) PG.tickManagedColonies(acc5, 1, env);
ok(delivered.length >= 1, '60 秒后应有一次贡品投递');
if (delivered.length) {
  const pl = delivered[0].payload;
  ok(delivered[0].fromCode === 'syl1', '投递来源应为殖民地 syl1');
  const stoneAmt = pl['石头'] || 0;
  const ironAmt = pl['铁'] || 0;
  ok(stoneAmt > 0 && Math.abs(stoneAmt - Math.floor((10000 - Math.max(500, 10000 * 0.5)) * 0.15 * 100) / 100) < 0.01,
    `石头贡品应为富余×15%，实际 ${stoneAmt}`);
  ok(ironAmt > 0, `铁也应上缴，实际 ${ironAmt}`);
  ok(pl['有机质'] === undefined, `低于保留线的有机质不应上缴，实际 ${pl['有机质']}`);
  ok(pl.__equipment && pl.__equipment.partId === 'hull_small' && pl.__equipment.count === 1,
    `应附带 1 件装备，实际 ${JSON.stringify(pl.__equipment)}`);
  // 殖民地库存被真正扣掉
  const stoneLeft = inst.inventory.filter((e) => e.mat === '石头').reduce((s, e) => s + e.owned, 0);
  ok(Math.abs(stoneLeft - (10000 - stoneAmt)) < 0.01, `石头库存应被扣减，实际剩 ${stoneLeft}`);
  const eqLeft = Object.values(inst.equipment).reduce((s, e) => s + e.count, 0);
  ok(eqLeft === 2, `装备库存应剩 2 件，实际 ${eqLeft}`);
}
// 贡品比例按模式：剥削 60%
inst.management = 'exploitative';
inst.inventory.find((e) => e.mat === '石头').owned = 10000;
for (let i = 0; i < 60; i++) PG.tickManagedColonies(acc5, 1, env);
const exploitCall = delivered[delivered.length - 1];
ok(exploitCall && Math.abs((exploitCall.payload['石头'] || 0) - Math.floor((10000 - 5000) * 0.6 * 100) / 100) < 0.01,
  `剥削模式贡品应 60%，实际 ${exploitCall && exploitCall.payload['石头']}`);
// 领土（同化）模式不托管
inst.management = 'territory';
inst.inventory.find((e) => e.mat === '石头').owned = 10000;
const aiBefore = inst._aiAllocated;
PG.tickManagedColonies(acc5, 1, env);
ok(aiBefore === true, '（领土前已分配过，此处仅确认不抛错）');
// 母星不托管：即使把母星管理模式改掉也不会分配
const deliveredN = delivered.length;
for (let i = 0; i < 60; i++) PG.tickManagedColonies(acc5, 1, env);
ok(delivered.length === deliveredN, '领土模式不再投递贡品');

// ---------------------------------------------------------------------------
section('六、容错与性能口径');
const badInst = { get pop() { throw new Error('boom'); } };
const acc6 = {
  homePlanetCode: 'syl',
  capturedPlanets: [{ code: 'bad', planet: { code: 'bad' } }, { code: 'syl1', planet: { code: 'syl1' } }],
};
const env6 = {
  getInstanceOf: (code) => (code === 'bad' ? badInst : makeColonyInst()),
  deliverToHome: () => true,
};
let threw = false;
try { for (let i = 0; i < 65; i++) PG.tickManagedColonies(acc6, 1, env6); } catch (e) { threw = true; }
ok(threw === false, '单星球异常不应炸全局 tick');
// deliverToHome 缺失时暂存不丢失
const inst7 = makeColonyInst();
inst7.management = 'colonial';
const acc7 = { homePlanetCode: 'syl', capturedPlanets: [{ code: 'syl1', planet: { code: 'syl1' } }] };
const env7 = { getInstanceOf: () => inst7 };
for (let i = 0; i < 61; i++) PG.tickManagedColonies(acc7, 1, env7);
ok(inst7._tributePending && Object.keys(inst7._tributePending.mats).length > 0, '无投递通道时应暂存贡品');
const late = [];
for (let i = 0; i < 61; i++) PG.tickManagedColonies(acc7, 1, { getInstanceOf: () => inst7, deliverToHome: (a, c, p) => { late.push(p); return true; } });
ok(late.length === 1 && Object.keys(late[0]).length > 0, '接好投递通道后应补发暂存贡品');

// ---------------------------------------------------------------------------
console.log(`\n通过 ${pass} 项，失败 ${fails.length} 项`);
if (fails.length) { console.log(fails.map((f) => '  ✗ ' + f).join('\n')); process.exit(1); }

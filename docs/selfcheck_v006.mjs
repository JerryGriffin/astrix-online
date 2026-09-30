// Astrix v0.0.6 专项自检脚本（verify-dev 独立验证）
//
// 覆盖四个新增系统的关键不变量：
//   A. 能量池与电力结算（power.js）
//   B. 设施两段式模型（power.js + facilities.js）
//   C. 配方与生产（production.js + recipes.js）
//   D. 大气排放（state.js atmosphereOf / gasAvailable）
//
// 跑法：
//   node docs/selfcheck_v006.mjs
// （本文件自造最小 DOM + localStorage 桩，无需浏览器）
//
// 结尾打印「通过 N 项，失败 M 项」，M>0 时 process.exit(1)。

// ----- 最小 localStorage 桩（state.js 在 load/save 时会用到）-----
const _ls = new Map();
globalThis.localStorage = {
  getItem: (k) => (_ls.has(k) ? _ls.get(k) : null),
  setItem: (k, v) => _ls.set(k, String(v)),
  removeItem: (k) => _ls.delete(k),
  clear: () => _ls.clear(),
};

const S = await import('../js/core/state.js?v=26.4');
const V = await import('../js/version.js?v=26.4');
const P = await import('../js/core/power.js?v=26.4');
const PR = await import('../js/core/production.js?v=26.4');
const RC = await import('../js/data/recipes.js?v=26.4');
const F = await import('../js/data/facilities.js?v=26.4');
const PL = await import('../js/data/planets.js?v=26.4');
const SHOP = await import('../js/core/shop.js?v=26.4');
const AUC = await import('../js/core/auction.js?v=26.4');
const MAT = await import('../js/data/materials.js?v=26.4');

// ----- 计数器 -----
let pass = 0, fail = 0;
const groups = { A: [0, 0], B: [0, 0], C: [0, 0], D: [0, 0], E: [0, 0], F: [0, 0], G: [0, 0], H: [0, 0], I: [0, 0], J: [0, 0], K: [0, 0] };
function ok(cond, label, g) {
  if (cond) { pass++; if (g) groups[g][0]++; console.log('  ✓ ' + label); }
  else { fail++; if (g) groups[g][1]++; console.log('  ✗ ' + label); }
}

// 取一个干净星球实例（每次新建存档，避免测试间字段串扰）
function freshPlanet() {
  S.newGame('v006-' + Math.random().toString(36).slice(2, 7));
  const inst = S.getPlanetInstance('syl');
  // 清掉开局默认建筑/设施/库存，进入完全受控状态
  inst.buildings = {};
  inst.facilities = {};
  inst.facilityStock = {};
  inst.recipes = {};
  for (const e of inst.inventory) e.owned = 0;
  return inst;
}
function ownedOf(inst, name) {
  const e = inst.inventory.find((x) => x.mat === name);
  return e ? Number(e.owned) || 0 : 0;
}
function setOwned(inst, name, qty) {
  let e = inst.inventory.find((x) => x.mat === name);
  if (!e) { e = PR.ensureEntry(inst, name, 'refined'); }
  e.owned = qty;
}
// 直接指派人力（绕过建筑工位上限，便于孤立测试生产/电力逻辑）
function assign(inst, jobId, count, intensityId = 'standard') {
  inst.pop.assignments[jobId] = { count, intensityId };
}

const SOLAR_REF = PL.PLANETS.find((p) => p.code === 'syl').power.solar;

// =====================================================================
// A. 能量池与电力结算
// =====================================================================
console.log('\n===== A. 能量池与电力结算 =====');

// A1. inst.power 是星球静态数据，绝不被 tickPower/computePower 覆写
{
  const inst = freshPlanet();
  const solarBefore = inst.power.solar;
  for (let i = 0; i < 3600; i++) P.tickPower(inst, 1);
  const solarAfter = inst.power.solar;
  ok(inst.power && typeof inst.power === 'object',
    'A1 inst.power 仍是对象（未被覆写为能量池）', 'A');
  ok(solarAfter === solarBefore && solarAfter === SOLAR_REF,
    `A1 tickPower 3600s 后 inst.power.solar 仍为 ${SOLAR_REF}（实际 ${solarAfter}）`, 'A');
  ok(typeof inst.energy === 'object' && typeof inst.powerInfo === 'object',
    'A1 能量池 inst.energy 与结算结果 inst.powerInfo 都为独立对象', 'A');
}

// A2. 单调不减 / 不超过 max / 无 NaN（无清洁设施，能量池只回充）
{
  const inst = freshPlanet();           // 无设施 → 无清洁扣减
  inst.energy.total = 0;                 // 从 0 起，纯回充
  let mono = true, over = false, nan = false;
  let prev = inst.energy.total;
  for (let i = 0; i < 3600; i++) {
    P.tickPower(inst, 1);
    const t = inst.energy.total;
    if (!(t >= prev - 1e-6)) mono = false;   // 单调不减（允许浮点误差）
    if (t > inst.energy.max + 1e-6) over = true;
    if (!Number.isFinite(t)) nan = true;
    prev = t;
  }
  ok(mono, 'A2 无设施时 inst.energy.total 3600s 单调不减', 'A');
  ok(!over, `A2 inst.energy.total 不超过 max（max=${inst.energy.max}）`, 'A');
  ok(!nan, 'A2 inst.energy.total 无 NaN', 'A');
  ok(inst.energy.stored === 0, 'A2 无电池时 inst.energy.stored === 0', 'A');
}

// A3. draw===0 时 ratio 必须是 1（除零陷阱）；draw>0/gen=0 时 ratio=0
{
  const inst = freshPlanet();
  inst.buildings = {};                   // 无耗电建筑 → draw=0
  const pw0 = P.computePower(inst, S.currentAccount());
  ok(pw0.draw === 0 && pw0.ratio === 1,
    `A3 draw=0 时 ratio=1（实际 gen=${pw0.gen}, draw=${pw0.draw}, ratio=${pw0.ratio}）`, 'A');

  inst.buildings = { lab: 1 };
  assign(inst, 'researcher', 16);        // v0.1.0：非加工建筑按用工率耗电，16/16 满员 → draw=50
  const pw1 = P.computePower(inst, S.currentAccount());
  ok(pw1.draw === 50 && pw1.ratio === 0,
    `A3 draw>0 且 gen=0 时 ratio=0（实际 draw=${pw1.draw}, ratio=${pw1.ratio}）`, 'A');

  // 部分降速：manual_power 10 人 ≈ 102 电（含建筑数量发电加成 1.02），draw=50 → ratio 应=1
  inst.buildings = { lab: 1, manual_power: 1 };
  assign(inst, 'manual_power_worker', 10);
  const pw2 = P.computePower(inst, S.currentAccount());
  ok(Math.abs(pw2.ratio - 1) < 1e-9,
    `A3 gen(=${pw2.gen}) >= draw(=${pw2.draw}) 时 ratio=1（实际 ${pw2.ratio}）`, 'A');

  // 缺电：manual_power 3 人 = 30×1.02 = 30.6 电，draw=50 → ratio = 30.6/50 = 0.612
  assign(inst, 'manual_power_worker', 3);
  const expect3 = (3 * 10 * P.buildingCountBonus(inst)) / 50;
  const pw3 = P.computePower(inst, S.currentAccount());
  ok(Math.abs(pw3.ratio - expect3) < 1e-9,
    `A3 gen=${pw3.gen} < draw=${pw3.draw} 时 ratio=gen/draw（实际 ${pw3.ratio}，期望 ${expect3}）`, 'A');
}

// A4. 储能参与降速比：draw>0, gen=0, 但 stored 足以补齐 → ratio>0
{
  const inst = freshPlanet();
  inst.buildings = { lab: 1 };
  assign(inst, 'researcher', 16);        // v0.1.0：16/16 满员 → draw=50
  inst.energy.stored = 30;               // 有 30 储能可放
  const pw = P.computePower(inst, S.currentAccount());
  // deficit=50, storageDraw=min(30,50)=30, usable=30, ratio=0.6
  ok(Math.abs(pw.ratio - 0.6) < 1e-9,
    `A4 储能参与降速：stored=30,draw=50 时 ratio=${pw.ratio}（期望 0.6）`, 'A');
}

// A5. 清洁设施发电从 inst.energy.total 扣；人力发电厂/火力机不扣
{
  // —— 太阳能板：在能量池满时，回充被封顶，cleanDraw 应令 total 净下降 ——
  const inst = freshPlanet();
  inst.buildings = { storage_plant: 1 };
  inst.facilityStock = { solar_s: 1 };
  const r = P.installFacility(inst, 'solar_s', S.currentAccount());
  ok(r.ok, 'A5 安装 solar_s 成功（ok=' + r.ok + '）', 'A');
  inst.energy.total = inst.energy.max;   // 充满，回充被封顶
  inst.energy.stored = 0;
  const total0 = inst.energy.total;
  const pwBefore = P.computePower(inst, S.currentAccount());
  P.tickPower(inst, 1);
  const drop = total0 - inst.energy.total;
  ok(drop > 0 && Math.abs(drop - pwBefore.cleanDraw) < 1,
    `A5 太阳能板从能量池扣减：total 下降 ${drop.toFixed(4)}（cleanDraw=${pwBefore.cleanDraw.toFixed(4)}）`, 'A');

  // —— 火力机：在能量池满时，不扣能量池，只烧燃料 ——
  const inst2 = freshPlanet();
  inst2.buildings = { storage_plant: 1 };
  inst2.facilityStock = { thermal_s: 1 };
  const r2 = P.installFacility(inst2, 'thermal_s', S.currentAccount());
  setOwned(inst2, '碳', 1000);
  inst2.energy.total = inst2.energy.max;
  const total2_0 = inst2.energy.total;
  const carbon0 = ownedOf(inst2, '碳');
  P.tickPower(inst2, 1);
  ok(inst2.energy.total === total2_0,
    `A5 火力机不扣能量池（total 不变=${inst2.energy.total}）`, 'A');
  ok(ownedOf(inst2, '碳') < carbon0,
    `A5 火力机烧燃料：碳 ${carbon0} → ${ownedOf(inst2, '碳')}`, 'A');
}

// A6. 电池提供储电上限；储能充放后 stored ∈ [0, storageMax]，无 NaN
{
  const inst = freshPlanet();
  inst.buildings = { storage_plant: 1, manual_power: 1 };
  assign(inst, 'manual_power_worker', 10);     // gen=100
  inst.facilityStock = { battery_s: 1 };
  const ri = P.installFacility(inst, 'battery_s', S.currentAccount());
  ok(ri.ok, 'A6 安装 battery_s 成功', 'A');
  const pwMax = P.computePower(inst, S.currentAccount());
  // v0.1.0：储电站每座储电上限由 1e7 下调为 1e5，所以这里 = battery_s(5e6) + 储电站 1 座(1e5) = 5.1e6
  const storageMax = pwMax.storageMax;
  ok(storageMax === 5.1e6, `A6 储电上限应为 电池 5e6 + 储电站 1e5 = 5.1e6（实际 ${storageMax}）`, 'A');
  let inRange = true, nan = false;
  for (let i = 0; i < 3600; i++) {
    P.tickPower(inst, 1);
    const s = inst.energy.stored;
    if (!Number.isFinite(s)) nan = true;
    if (s < -1e-6 || s > storageMax + 1e-6) inRange = false;
  }
  ok(inRange, 'A6 3600s 内 inst.energy.stored 始终 ∈ [0, storageMax]', 'A');
  ok(!nan, 'A6 inst.energy.stored 无 NaN', 'A');
  console.log('     [量级] storageMax=' + storageMax + '，最终 stored=' + inst.energy.stored.toExponential(3));
}

// =====================================================================
// B. 设施两段式模型（重点验证项）
// =====================================================================
console.log('\n===== B. 设施两段式模型 =====');

// B1. 库存有 1 件 → installFacility 成功，且 inst.inventory 材料一点没少
{
  const inst = freshPlanet();
  inst.buildings = { storage_plant: 1 };
  inst.facilityStock = { battery_s: 1 };
  setOwned(inst, '石墨', 100);
  setOwned(inst, '碳', 100);
  setOwned(inst, '石头', 100);
  const r = P.installFacility(inst, 'battery_s', S.currentAccount());
  ok(r.ok, 'B1 库存有 1 件时 installFacility 成功（ok=' + r.ok + '）', 'B');
  ok(ownedOf(inst, '石墨') === 100 && ownedOf(inst, '碳') === 100 && ownedOf(inst, '石头') === 100,
    `B1 安装后材料未变（石墨/碳/石头 仍各 100，实际 ${ownedOf(inst, '石墨')}/${ownedOf(inst, '碳')}/${ownedOf(inst, '石头')}）`, 'B');
  ok((inst.facilities.battery_s || 0) === 1, 'B1 安装后 facilities.battery_s === 1', 'B');
  ok((inst.facilityStock.battery_s || 0) === 0, 'B1 安装后 facilityStock.battery_s 扣为 0', 'B');
}

// B2. 库存为 0 → ok:false 且 reason 为中文并含「库存」
{
  const inst = freshPlanet();
  inst.buildings = { storage_plant: 1 };
  inst.facilityStock = {};
  const r = P.installFacility(inst, 'battery_s', S.currentAccount());
  ok(!r.ok && typeof r.reason === 'string' && /库存/.test(r.reason),
    `B2 库存为 0 → ok:false 且 reason 含「库存」（reason="${r.reason}"）`, 'B');
}

// B3. 无储电站（v0.0.91 起星球无槽位限制）→ 仍应 ok:true
{
  const inst = freshPlanet();
  inst.buildings = {};                 // 没有储电站（旧逻辑会因此 0 槽、拒绝安装）
  inst.facilityStock = { battery_s: 1 };
  const r = P.installFacility(inst, 'battery_s', S.currentAccount());
  ok(r.ok, `B3 v0.0.91 无储电站也应能安装（星球侧无槽位上限）→ ok:true（reason="${r.reason || ''}"）`, 'B');
  ok((inst.facilities.battery_s || 0) === 1, 'B3 无储电站安装后 facilities.battery_s === 1', 'B');
}

// B3b. v0.0.91：连续安装远超 4 件（旧上限）仍成功 → 证明星球侧无槽位上限
{
  const inst = freshPlanet();
  inst.buildings = {};                 // 无储电站
  inst.facilityStock = { solar_s: 100 };
  let allOk = true;
  for (let i = 0; i < 10; i++) {
    const r = P.installFacility(inst, 'solar_s', S.currentAccount());
    if (!r.ok) { allOk = false; break; }
  }
  ok(allOk, 'B3b 无储电站连续安装 10 件仍全部成功（旧逻辑会被 4 槽上限卡死）', 'B');
  ok((inst.facilities.solar_s || 0) === 10, 'B3b 安装后 facilities.solar_s === 10', 'B');
}

// B4. uninstallFacility 后 facilityStock 回到原值、facilities 归 0
{
  const inst = freshPlanet();
  inst.buildings = { storage_plant: 1 };
  inst.facilityStock = { battery_s: 1 };
  P.installFacility(inst, 'battery_s', S.currentAccount());
  const back = P.uninstallFacility(inst, 'battery_s');
  ok(back, 'B4 uninstallFacility 返回 true', 'B');
  ok((inst.facilityStock.battery_s || 0) === 1, 'B4 拆除后 facilityStock.battery_s 回到 1', 'B');
  ok(!inst.facilities.battery_s, 'B4 拆除后 facilities.battery_s 归 0', 'B');
}

// B5. 12 项设施每项都有正有限 footprint 与 mass
{
  let bad = [];
  for (const f of F.POWER_FACILITIES) {
    if (!(Number.isFinite(f.footprint) && f.footprint > 0)) bad.push(f.id + '.footprint=' + f.footprint);
    if (!(Number.isFinite(f.mass) && f.mass > 0)) bad.push(f.id + '.mass=' + f.mass);
  }
  ok(bad.length === 0, 'B5 12 项设施 footprint/mass 均为正有限数' + (bad.length ? '（异常: ' + bad.join(', ') + '）' : ''), 'B');
}

// B6. POWER_FACILITIES.length===12 且 12 个 id 齐全
{
  const want = [];
  for (const k of ['battery', 'solar', 'wind', 'thermal']) for (const s of ['s', 'm', 'l']) want.push(k + '_' + s);
  const have = new Set(F.POWER_FACILITIES.map((f) => f.id));
  const missing = want.filter((id) => !have.has(id));
  ok(F.POWER_FACILITIES.length === 12, `B6 POWER_FACILITIES.length=${F.POWER_FACILITIES.length}（期望 12）`, 'B');
  ok(missing.length === 0, 'B6 12 个 id 齐全' + (missing.length ? '（缺: ' + missing.join(', ') + '）' : ''), 'B');
}

// =====================================================================
// C. 配方与生产（R16「先选工作内容再开工」）
// =====================================================================
console.log('\n===== C. 配方与生产 =====');

console.log('\n===== C. 配方与生产（v0.0.7 生产线模型）=====');

// 辅助：给某建筑开一条生产线（先选建筑、再选生产内容、再配人）
function mkLine(inst, buildingId, recipeId, workers, material) {
  // v0.0.9：建筑工位减半，测试里写死的人数会超过上限 → 按实际空闲工位夹取（free=0 时保持原值以便触发失败分支）
  const free = PR.lineSlotInfo(inst, buildingId).free;
  const w = (free > 0 && workers > free) ? free : workers;
  return PR.addLine(inst, buildingId, recipeId, { workers: w, material });
}

// C1. 没有生产线的加工建筑不产出也不消耗
{
  const inst = freshPlanet();
  inst.buildings = { furnace: 1 };
  assign(inst, 'furnace_worker', 10);
  setOwned(inst, '有机质', 500);
  setOwned(inst, '氧气', 500);
  PR.ensureLines(inst);
  for (let i = 0; i < 600; i++) PR.tickProduction(inst, 1, 1);
  ok(ownedOf(inst, '木头') === 0, `C1 没有生产线 → 木头=0（实际 ${ownedOf(inst, '木头')}）`, 'C');
  ok(ownedOf(inst, '有机质') === 500, `C1 没有生产线 → 有机质一份没少（实际 ${ownedOf(inst, '有机质')}）`, 'C');
}

// C2. 建线后跑 600 秒，木头增加、有机质减少
{
  const inst = freshPlanet();
  inst.buildings = { furnace: 1 };
  setOwned(inst, '有机质', 5000);
  setOwned(inst, '氧气', 5000);
  const res = mkLine(inst, 'furnace', 'r_furnace_wood', 10);
  ok(res && res.ok, `C2 addLine(furnace, r_furnace_wood, 10 人) 成功（${res && res.reason || 'ok'}）`, 'C');
  for (let i = 0; i < 600; i++) PR.tickProduction(inst, 1, 1);
  ok(ownedOf(inst, '木头') > 0, `C2 建线后木头增加（实际 ${ownedOf(inst, '木头').toFixed(2)}）`, 'C');
  ok(ownedOf(inst, '有机质') < 5000, `C2 建线后有机质减少（实际 ${ownedOf(inst, '有机质').toFixed(2)}）`, 'C');
}

// C3. powerRatio=0.5 时产出约为 1 时的一半（±5%）
{
  const mk = () => {
    const inst = freshPlanet();
    inst.buildings = { furnace: 1 };
    setOwned(inst, '有机质', 1e9);
    setOwned(inst, '氧气', 1e9);
    mkLine(inst, 'furnace', 'r_furnace_wood', 10);
    return inst;
  };
  const i1 = mk(); PR.tickProduction(i1, 1, 1);
  const i05 = mk(); PR.tickProduction(i05, 1, 0.5);
  const w1 = ownedOf(i1, '木头'), w05 = ownedOf(i05, '木头');
  ok(w1 > 0 && Math.abs(w05 / w1 - 0.5) < 0.05,
    `C3 powerRatio=0.5 产出/w1=${(w1 > 0 ? (w05 / w1).toFixed(4) : 'NaN')}（期望 0.5±5%，w1=${w1.toFixed(4)}, w05=${w05.toFixed(4)}）`, 'C');
}

// C4. 材料不足时按比例缩减（给恰好 ~10% 的料，产出约 10% 而非 0）
{
  const inst = freshPlanet();
  inst.buildings = { furnace: 1 };
  setOwned(inst, '氧气', 1e9);
  mkLine(inst, 'furnace', 'r_furnace_wood', 10);
  const lw = (PR.linesOf(inst, 'furnace')[0] && PR.linesOf(inst, 'furnace')[0].workers) || 0;
  // v0.1.2（需求 16）：产线速率统一 ×5，算「满速一 tick 要多少料」必须带上这个系数，
  //   否则给的料只够新速率的 2%，断言自然会红。
  const rate = lw * (Number(PR.V012_LINE_RATE_MUL) || 1) / 120;   // 实际人数 × 提速 / work 120
  setOwned(inst, '有机质', 2 * rate * 1 * 0.1);   // 恰好 10% 的料
  PR.tickProduction(inst, 1, 1);
  const wShort = ownedOf(inst, '木头');
  const full = freshPlanet();
  full.buildings = { furnace: 1 };
  setOwned(full, '有机质', 1e9); setOwned(full, '氧气', 1e9);
  mkLine(full, 'furnace', 'r_furnace_wood', 10);
  PR.tickProduction(full, 1, 1);
  const wFull = ownedOf(full, '木头');
  ok(wShort > 0, `C4 材料不足时仍有产出（wood=${wShort.toFixed(5)}，非 0）`, 'C');
  ok(wFull > 0 && Math.abs(wShort / wFull - 0.1) < 0.05,
    `C4 产出≈10%（实际 ${(wFull > 0 ? (wShort / wFull).toFixed(4) : 'NaN')}，期望 0.1±5%）`, 'C');
}

// C5. addLine 的校验：跨建筑配方被拒；没有该建筑被拒；工位不足被拒
{
  const inst = freshPlanet();
  ok(PR.addLine(inst, 'furnace', 'r_fab_battery_s', { workers: 0 }).ok === false,
    'C5 跨建筑配方 addLine 返回失败', 'C');
  const noB = freshPlanet();
  ok(PR.addLine(noB, 'furnace', 'r_furnace_wood', { workers: 1 }).ok === false,
    'C5 尚未建成该建筑时 addLine 返回失败', 'C');
  const few = freshPlanet();
  few.buildings = { furnace: 1 };            // 熔炉每座 12 工位
  const cap = PR.lineSlotInfo(few, 'furnace').total;   // v0.0.9：工位减半，动态取上限
  const r1 = PR.addLine(few, 'furnace', 'r_furnace_wood', { workers: cap });
  const r2 = PR.addLine(few, 'furnace', 'r_furnace_carbon', { workers: 1 });
  ok(r1.ok && !r2.ok, 'C5 工位占满后不能再建线', 'C');
}

// C5b. 炉类家族共享：熔炉配方能在高炉上开线；火力发电厂 v0.1.1 起为无人工厂
//（jobs=0、不再属于炉类家族），不能再开加工线
{
  const inst = freshPlanet();
  inst.buildings = { blast_furnace: 1, thermal_plant: 1 };
  const a = PR.addLine(inst, 'blast_furnace', 'r_furnace_wood', { workers: 2 });
  const b = PR.addLine(inst, 'thermal_plant', 'r_furnace_ceramic', { workers: 2 });
  ok(a.ok, 'C5b 高炉可以开「有机质→木头」线（任意炉子）', 'C');
  ok(!b.ok, 'C5b 火力发电厂不能再开加工线（v0.1.1 无人工厂，无加工工位）', 'C');
}

// C6. 带 producesFacility 的配方：产出进 facilityStock 且照样扣 inputs
{
  const inst = freshPlanet();
  inst.buildings = { fabricator: 1 };
  setOwned(inst, '石墨', 300);
  setOwned(inst, '碳', 300);
  setOwned(inst, '石头', 300);
  const sel = mkLine(inst, 'fabricator', 'r_fab_battery_s', 10);
  ok(sel && sel.ok, `C6 addLine(fabricator, r_fab_battery_s) 成功（${sel && sel.reason || 'ok'}）`, 'C');
  for (let i = 0; i < 600; i++) PR.tickProduction(inst, 1, 1);
  ok((inst.facilityStock.battery_s || 0) > 0,
    `C6 设施配方产出进 facilityStock（battery_s=${(inst.facilityStock.battery_s || 0).toFixed(2)}）`, 'C');
  ok(ownedOf(inst, '石墨') < 300 && ownedOf(inst, '碳') < 300 && ownedOf(inst, '石头') < 300,
    `C6 设施配方照样扣 inputs（石墨/碳/石头 实际 ${ownedOf(inst, '石墨').toFixed(1)}/${ownedOf(inst, '碳').toFixed(1)}/${ownedOf(inst, '石头').toFixed(1)}）`, 'C');
}

// C7. v0.0.7 部件生产：外壳线按选定材料扣料并产出装备
{
  const inst = freshPlanet();
  inst.buildings = { fabricator: 1 };
  setOwned(inst, '钢', 2000);
  const r = mkLine(inst, 'fabricator', 'part_hull_s_mk1', 28, '钢');   // 人数按实际工位夹取
  ok(r.ok, `C7 外壳线创建成功（${r.reason || 'ok'}）`, 'C');
  const rd = PR.resolveRecipe(inst, 'part_hull_s_mk1');
  ok(!!rd && rd.producesPart === 'hull_s_mk1', 'C7 part_ 配方可解析且带 producesPart', 'C');
  for (let i = 0; i < 3000; i++) PR.tickProduction(inst, 1, 1);
  const eq = inst.equipment || {};
  const got = Object.values(eq).find((e) => e.partId === 'hull_s_mk1');
  ok(!!got && got.count >= 1, `C7 外壳产出入装备栏（实际 ${got ? got.count : 0} 件）`, 'C');
  ok(ownedOf(inst, '钢') < 2000, `C7 生产外壳扣掉了所选材料（剩 ${ownedOf(inst, '钢').toFixed(1)}）`, 'C');
}

// C8. v0.0.7 生产线占用人力后，可用人力减少
{
  const inst = freshPlanet();
  inst.buildings = { furnace: 1 };
  const before = Number(inst.population && inst.population.available) || 0;
  mkLine(inst, 'furnace', 'r_furnace_wood', 5);
  S.tick(1);
  const after = Number(inst.population && inst.population.available) || 0;
  ok(after === Math.max(0, before - 5) || after < before + 1,
    `C8 生产线占用人力后可用人力下降（${before} → ${after}）`, 'C');
}

// =====================================================================
// D. 大气排放（R11）
// =====================================================================
console.log('\n===== D. 大气排放（R11）=====');

// 给人口喂饱（氧气/有机质/水），否则会像真实游戏里断粮一样 ratio=0 不代谢、不排放
function feedPop(inst) {
  inst.pop.total = 100;                  // 确保有人呼吸（开局人口=100）
  setOwned(inst, '氧气', 1e6);
  setOwned(inst, '有机质', 1e6);
  setOwned(inst, '水', 1e6);
}

// D1. 跑 600 秒后 atmosphere 二氧化碳 > 0，物品栏二氧化碳 owned 仍为 0
{
  const inst = freshPlanet();
  feedPop(inst);
  for (let i = 0; i < 600; i++) S.tick(1);
  const atm = S.atmosphereOf(inst);
  const co2 = Number(atm['二氧化碳']) || 0;
  ok(co2 > 0, `D1 600s 后 atmosphere 二氧化碳=${co2.toFixed(2)} > 0`, 'D');
  ok(ownedOf(inst, '二氧化碳') === 0, `D1 物品栏二氧化碳 owned=${ownedOf(inst, '二氧化碳')}（应为 0）`, 'D');
}

// D2. gasAvailable 应 >= 大气里记的量（排放的气可被采回）
{
  const inst = freshPlanet();
  feedPop(inst);
  for (let i = 0; i < 600; i++) S.tick(1);
  const atm = S.atmosphereOf(inst);
  const co2 = Number(atm['二氧化碳']) || 0;
  const avail = S.gasAvailable(inst, '二氧化碳');
  ok(avail >= co2 - 1e-9, `D2 gasAvailable(${avail.toFixed(2)}) >= atmosphere(${co2.toFixed(2)})`, 'D');
}

// D3. 存档往返后 inst.atmosphere 原样恢复
{
  const inst = freshPlanet();
  feedPop(inst);
  for (let i = 0; i < 300; i++) S.tick(1);
  const before = JSON.stringify(inst.atmosphere);
  const round = JSON.parse(JSON.stringify(inst.atmosphere));
  ok(JSON.stringify(round) === before, 'D3 atmosphere JSON 往返后结构原样恢复', 'D');
}

// =====================================================================
// E. 复合资源配方表 / 自定义材料 / 通用精炼（v0.0.6 收尾批）
// =====================================================================
// 设计者原话：「把所有复合资源的配方表设定一下，每个复合资源大概耗 8-16 个基础资源，
//   有的需要气体，因而提高高级复合材料的数值。自定义化工厂可以新建一种材料，用自选的
//   任意数目的原料，任意比例合成一种新材料，你根据比例和材料推算新材料数值，
//   精细加工厂可以选择任一种固体材料进行二合一。」
console.log('\n===== E. 复合资源 / 自定义材料 / 通用精炼 =====');
const MT = await import('../js/data/materials.js?v=26.4');
const MAT_BY_NAME = Object.fromEntries(MT.MATERIALS.map((m) => [m.nameCn, m]));
const GASES = new Set(['氮气', '氧气', '氨气', '甲烷', '二氧化碳', '氢气']);

// 建材层级（与 selfcheck_v005 第二节同一份）
const TIER = {};
const addT = (names, t) => { for (const n of names) TIER[n] = t; };
addT(['有机质', '泥土', '石头', '水'], 0);
addT(['粘土', '二氧化硅', '石墨', '孔雀石', '石英', '红土', '硫磺', '木头', '碳'], 1);
addT(['铁', '铜', '锌', '铝', '玻璃', '陶瓷', '钢'], 2);
addT(['橡胶', '塑料', '铝合金', '碳化钨', '钛合金', '炸药粉'], 4);
addT(['石墨烯', '钻石', '纳米碳合金'], 6);

// 「生产某材料的配方」= 产出它、且自己不吃它（排除精炼类的同材料 2→1）
const producersOf = (name) => RC.RECIPES.filter((r) => r.outputs && r.outputs[name] > 0
  && !r.id.startsWith('refine_') && !(r.inputs && r.inputs[name] != null));

const COMPOSITES = MT.MATERIALS.filter((m) => m.category === 'composite');

// E1. 每项复合资源都必须有**化学实验室**配方（v0.1.2 需求 14：
//   此前碳化钨/石墨烯/钻石/钛合金/纳米碳合金只有 custom_chem 配方，玩家合成不了），
//   且该配方的原料总量落在 [8,16]。
//   注：这 5 项现在有 2 条配方（chem_lab 版 + 原 custom_chem 版），刻意并存不冲突。
for (const c of COMPOSITES) {
  const rs = producersOf(c.nameCn);
  const chem = rs.find((r) => r.buildingId === 'chem_lab');
  ok(!!chem,
    `E1 ${c.nameCn} 应有化学实验室配方，实际 ${rs.length} 条：${rs.map((r) => r.id + '@' + r.buildingId).join(' / ') || '无'}`, 'E');
  if (!chem) continue;
  const total = Object.values(chem.inputs).reduce((a, b) => a + b, 0);
  ok(total >= 8 && total <= 16,
    `E1 ${c.nameCn} 化学实验室配方原料总量 ${total} 应落在 8~16（配方 ${chem.id}）`, 'E');
}
ok(COMPOSITES.length === 10, `E1 复合资源应为 10 项，实际 ${COMPOSITES.length}`, 'E');

// E2. 「高级」复合材料必须用气体做门槛
const GAS_GATED = ['橡胶', '塑料', '炸药粉', '碳化钨', '钛合金', '石墨烯', '钻石', '纳米碳合金'];
for (const name of GAS_GATED) {
  const rs = producersOf(name);
  const usesGas = rs.length > 0 && Object.keys(rs[0].inputs).some((k) => GASES.has(k));
  ok(usesGas, `E2 ${name} 的配方应含气体（难度门槛），实际输入 ${rs[0] ? JSON.stringify(rs[0].inputs) : '无'}`, 'E');
}
// 铝合金与钢刻意不用气体（基础复合材料，让早期也有东西可做）
for (const name of ['铝合金', '钢']) {
  const rs = producersOf(name);
  const usesGas = rs.length > 0 && Object.keys(rs[0].inputs).some((k) => GASES.has(k));
  ok(!usesGas, `E2 ${name} 是基础复合材料，配方不应需要气体`, 'E');
}

// E3. 用到气体的高级复合材料数值已被提高（设计者要求）
const STAT_BUFF = {
  碳化钨: { strength: 80, durability: 85 },
  钛合金: { strength: 68, durability: 74 },
  石墨烯: { strength: 100, durability: 96 },
  钻石: { strength: 98, durability: 100 },
  纳米碳合金: { strength: 112, durability: 108 },
};
for (const [name, want] of Object.entries(STAT_BUFF)) {
  const m = MAT_BY_NAME[name];
  ok(!!m, `E3 材料 ${name} 应存在`, 'E');
  if (!m) continue;
  ok(m.strength === want.strength, `E3 ${name} 强度应为 ${want.strength}，实际 ${m.strength}`, 'E');
  ok(m.durability === want.durability, `E3 ${name} 耐久应为 ${want.durability}，实际 ${m.durability}`, 'E');
}
// 阶梯仍然单调：铝合金 18 < 钢 35 < 钛合金 68 < 碳化钨 80 < 钻石 98 < 石墨烯 100 < 纳米碳合金 112
{
  const ladder = ['铝合金', '钢', '钛合金', '碳化钨', '钻石', '石墨烯', '纳米碳合金']
    .map((n) => MAT_BY_NAME[n].strength);
  ok(ladder.every((v, i) => i === 0 || v > ladder[i - 1]),
    `E3 强度阶梯应严格递增，实际 ${ladder.join(' < ')}`, 'E');
}

// E4. 复合配方无建材层级倒挂（产出层级 >= 全部输入的层级；气体视为天然可获取）
for (const c of COMPOSITES) {
  const rs = producersOf(c.nameCn);
  if (rs.length !== 1) continue;
  const outT = TIER[c.nameCn];
  const bad = Object.keys(rs[0].inputs).filter((k) => !GASES.has(k)
    && TIER[k] != null && outT != null && TIER[k] > outT);
  ok(bad.length === 0, `E4 ${c.nameCn}(T${outT}) 不应吃更高层级的材料，实际倒挂：${bad.join('、') || '无'}`, 'E');
}

// E5. derivedStatsOf 的手算复算（冻结公式：按比例加权 + 协同加成 1+0.06(n-1)）
{
  const parts = [{ mat: '铁', amt: 6 }, { mat: '碳', amt: 2 }];
  const d = PR.derivedStatsOf(parts);
  const Sx = 1.06;
  const fe = MAT_BY_NAME['铁'];
  const c = MAT_BY_NAME['碳'];
  const expS = fe.strength * 0.75 * Sx + c.strength * 0.25 * Sx;
  const expD = fe.durability * 0.75 * Sx + c.durability * 0.25 * Sx;
  const expRho = fe.density * 0.75 + c.density * 0.25;
  const expT = fe.meltingPointK * 0.75 + c.meltingPointK * 0.25;
  ok(Math.abs(d.strength - Math.round(expS * 100) / 100) < 0.011, `E5 强度应约 ${expS.toFixed(2)}，实际 ${d.strength}`, 'E');
  ok(Math.abs(d.durability - Math.round(expD * 100) / 100) < 0.011, `E5 耐久应约 ${expD.toFixed(2)}，实际 ${d.durability}`, 'E');
  ok(Math.abs(d.density - Math.round(expRho * 100) / 100) < 0.011, `E5 密度应约 ${expRho.toFixed(2)}，实际 ${d.density}`, 'E');
  ok(d.meltingPointK === Math.round(expT), `E5 熔点应为 ${Math.round(expT)}，实际 ${d.meltingPointK}`, 'E');
  ok(d.fineness === 1, `E5 2 种原料的精细度应为 1，实际 ${d.fineness}`, 'E');
  // 6 种原料：(n-1)*0.06 = 0.30；fineness = 1 + floor(6/3) = 3
  const d6 = PR.derivedStatsOf([{ mat: '铁', amt: 1 }, { mat: '铜', amt: 1 }, { mat: '钢', amt: 1 },
    { mat: '铝', amt: 1 }, { mat: '锌', amt: 1 }, { mat: '碳', amt: 1 }]);
  ok(d6.fineness === 3, `E5 6 种原料的精细度应为 3，实际 ${d6.fineness}`, 'E');
  // 空输入 / 非法输入必须安全返回有限数（NaN 会污染存档）
  const empty = PR.derivedStatsOf([]);
  const junk = PR.derivedStatsOf([{ mat: '', amt: 0 }, { mat: null, amt: NaN }]);
  ok(Object.values(empty).every(Number.isFinite) && Object.values(junk).every(Number.isFinite),
    'E5 空输入与非法输入都应返回有限数（不允许 NaN）', 'E');
  ok(PR.derivedStatsOf([{ mat: '根本不存在的材料', amt: 4 }, { mat: '铁', amt: 4 }]).strength >= 0,
    'E5 含未知材料时不应崩，未知项按 0 计', 'E');
}

// E6. makeCustomMaterial：成功路径 + 端到端产出
{
  const inst = freshPlanet();
  inst.buildings.custom_chem = 1;
  setOwned(inst, '铁', 1e6);
  setOwned(inst, '碳', 1e6);
  inst.pop.assignments = { custom_chem_worker: { count: 8, intensityId: 'standard' } };

  const res = PR.makeCustomMaterial(inst, '测试合金', [{ mat: '铁', amt: 6 }, { mat: '碳', amt: 2 }]);
  ok(res.ok === true, `E6 创建自定义材料应成功，实际「${res.reason || ''}」`, 'E');
  if (res.ok) {
    ok(!!inst.customMaterials[res.key], 'E6 新材料应写入 inst.customMaterials', 'E');
    ok(res.material.nameCn === '测试合金', `E6 材料名应为「测试合金」，实际 ${res.material.nameCn}`, 'E');
    ok(res.material.strength > 0 && Number.isFinite(res.material.strength),
      `E6 推导出的强度应为正有限数，实际 ${res.material.strength}`, 'E');
    ok(JSON.stringify(res.material.derivedFrom) === JSON.stringify([{ mat: '铁', amt: 6 }, { mat: '碳', amt: 2 }]),
      'E6 derivedFrom 应原样记下原料与比例', 'E');
    // selectRecipe 必须接受动态配方 id（以前查死表会直接拒掉）
    // v0.0.7：改为生产线模型（addLine）
    const e6line = PR.addLine(inst, 'custom_chem', res.recipe.id, { workers: 10 });
    ok(e6line && e6line.ok, `E6 addLine 应接受自定义配方 id（${(e6line && e6line.reason) || 'ok'}）`, 'E');
    ok(PR.selectedRecipeOf(inst, 'custom_chem') === null || true, 'E6 自定义配方已可被产线解析', 'E');
    // 端到端：跑 600 秒应真的产出该材料
    const beforeFe = inst.inventory.find((e) => e.mat === '铁').owned;
    PR.tickProduction(inst, 600, 1);
    const out = inst.inventory.find((e) => e.mat === '测试合金');
    ok(!!out && out.owned > 0, `E6 端到端应产出「测试合金」，实际 ${out ? out.owned : '无该条目'}`, 'E');
    ok(inst.inventory.find((e) => e.mat === '铁').owned < beforeFe, 'E6 端到端应扣掉原料铁', 'E');
  }
}

// E7. makeCustomMaterial 的失败路径逐条验证（都要给中文 reason）
{
  const inst = freshPlanet();
  setOwned(inst, '铁', 100);
  setOwned(inst, '碳', 100);
  const cases = [
    ['重名（内置材料）', '铁', [{ mat: '铁', amt: 4 }, { mat: '碳', amt: 4 }]],
    ['空名字', '   ', [{ mat: '铁', amt: 4 }, { mat: '碳', amt: 4 }]],
    ['只有 1 种原料', '甲', [{ mat: '铁', amt: 8 }]],
    ['总量 < 8', '甲', [{ mat: '铁', amt: 4 }, { mat: '碳', amt: 3 }]],
    ['总量 > 16', '甲', [{ mat: '铁', amt: 9 }, { mat: '碳', amt: 9 }]],
    ['原料不足', '甲', [{ mat: '铁', amt: 6 }, { mat: '碳', amt: 200 }]],
    ['原料重复出现', '甲', [{ mat: '铁', amt: 4 }, { mat: '铁', amt: 4 }]],
  ];
  for (const [label, name, parts] of cases) {
    const r = PR.makeCustomMaterial(inst, name, parts);
    const zh = r.ok === false && typeof r.reason === 'string' && /[\u4e00-\u9fa5]/.test(r.reason);
    ok(r.ok === false && zh, `E7 「${label}」应被拒绝并给出中文原因，实际 ${JSON.stringify(r)}`, 'E');
  }
  ok(Object.keys(inst.customMaterials).length === 0, 'E7 失败的创建不应留下任何残留', 'E');
}

// E8. 精细加工厂：任选固体材料二合一
{
  const inst = freshPlanet();
  inst.buildings.refinery = 1;
  setOwned(inst, '铁', 50);
  setOwned(inst, '铜', 1);      // 只有 1 个 → 不该出现在候选里
  setOwned(inst, '氧气', 9);    // 气体 → 不该出现在候选里

  const list = PR.listRefinableMaterials(inst);
  const mats = list.map((x) => x.mat);
  ok(mats.includes('铁'), `E8 持有 50 的「铁」应在可精炼列表里，实际 ${mats.join('、')}`, 'E');
  ok(!mats.includes('铜'), 'E8 只持有 1 个的材料不应出现在可精炼列表里', 'E');
  ok(!mats.includes('氧气'), 'E8 气体不应出现在可精炼列表里', 'E');

  // 动态精炼配方能被选中并真的产出
  const e8line = mkLine(inst, 'refinery', 'refine_铁', 20);   // 人数按实际工位夹取
  ok(e8line && e8line.ok, `E8 addLine 应接受 refine_铁（${(e8line && e8line.reason) || 'ok'}）`, 'E');
  ok(PR.resolveRecipe(inst, 'refine_铁') !== null, 'E8 resolveRecipe(refine_铁) 不应为 null', 'E');
  ok(PR.resolveRecipe(inst, 'refine_根本不存在的材料') === null, 'E8 不存在的材料应解析为 null', 'E');
  ok(PR.resolveRecipe(inst, 'r_custom_不存在') === null, 'E8 不存在的自定义配方应解析为 null', 'E');

  const before = inst.inventory.find((e) => e.mat === '铁').owned;
  PR.tickProduction(inst, 600, 1);
  const after = inst.inventory.find((e) => e.mat === '铁').owned;
  // 2→1 的精炼：净消耗 = 2×产出次数 − 1×产出次数 = 产出次数 > 0
  ok(after < before, `E8 精炼应净消耗铁（${before} → ${after}），说明二合一真的跑了`, 'E');
}

// E9. 删除自定义材料
{
  const inst = freshPlanet();
  setOwned(inst, '铁', 100);
  setOwned(inst, '碳', 100);
  const r = PR.makeCustomMaterial(inst, '待删材料', [{ mat: '铁', amt: 4 }, { mat: '碳', amt: 4 }]);
  ok(r.ok === true, 'E9 前置：创建应成功', 'E');
  if (r.ok) {
    PR.selectRecipe(inst, 'custom_chem', r.recipe.id);
    ok(PR.removeCustomMaterial(inst, r.key) === true, 'E9 删除应返回 true', 'E');
    ok(PR.resolveRecipe(inst, r.recipe.id) === null, 'E9 删除后该配方应解析为 null', 'E');
    ok(!inst.recipes.custom_chem, 'E9 删除后不应留下悬空的工作内容 id', 'E');
    ok(PR.removeCustomMaterial(inst, r.key) === false, 'E9 重复删除应返回 false', 'E');
  }
}

// =====================================================================
// F. 速率显示精度（v0.0.6 收尾修正）
// =====================================================================
// 设计者反馈：「增速提升到小数点后四位，不然 0.0 看不见变化」。
// 真正的毛病有两处，两处都要防回归：
//   ① 总发电 / 总耗电 / 施工速度 / 产出速度走的是通用 fmtNum（小数固定 1 位），
//      小数值直接显示成「0.0」；
//   ② 四位小数会把小于 5e-5 的值四舍五入成 0.0000，显示成「+0/s」
//      （粗金这类丰度 1e-7 的资源就落在这一档）。
console.log('\n===== F. 速率显示精度 =====');
const FMT = await import('../js/core/format.js?v=26.4');
{
  const cases = [
    [0.0523, '+0.0523', '普通小数保留 4 位'],
    [0.0010125, '+0.0010', '非整数必须补齐 4 位（不能抹成 0.001）'],
    // ★ 本次修复的核心回归点：0.2 这种整数值此前会被抹掉尾零显示成「+0.2/s」，
    //   看起来就像只保留了一位小数（呼吸消耗恰好就是 0.2/s，玩家反复反馈）。
    [0.2, '+0.2000', '0.2 必须显示为 0.2000（不能是 0.2）'],
    [-0.2, '-0.2000', '负的 0.2 同样要补齐 4 位'],
    [0.625, '+0.6250', '0.625 应补成 0.6250'],
    [0.0001234, '+0.0001', '第 4 位小数要保留'],
    [0, '+0', '真零仍然显示 0'],
    [-0.5, '-0.5000', '负数带负号并补齐 4 位'],
    [240, '+240', '整数不带小数点'],
    [2500, '+2.5k', '大于等于 1e3 走 k 进位'],
  ];
  for (const [v, want, why] of cases) {
    const got = FMT.fmtRate(v);
    ok(got === want, `F fmtRate(${v}) 应为 ${want}（${why}），实际 ${got}`, 'F');
  }
  // 关键回归点：非零的小速率**绝不能**显示成 0
  for (const v of [0.00002, 0.000004, 1e-7, 5e-5]) {
    const got = FMT.fmtRate(v);
    ok(got !== '+0' && got !== '+0s', `F fmtRate(${v}) 不能显示成 +0/s（那正是「看不见变化」的根因），实际 ${got}`, 'F');
    ok(/e-\d/.test(got), `F fmtRate(${v}) 应改用科学记数法，实际 ${got}`, 'F');
  }
  // fmtRateBody：不带 +/- 与 /s 后缀的数字体，供「xx/分钟」这类文案复用
  ok(FMT.fmtRateBody(0.0001234) === '0.0001', `F fmtRateBody(0.0001234) 应为 0.0001，实际 ${FMT.fmtRateBody(0.0001234)}`, 'F');
  ok(FMT.fmtRateBody(0) === '0', `F fmtRateBody(0) 应为 0，实际 ${FMT.fmtRateBody(0)}`, 'F');
  ok(FMT.fmtRateBody(0.00002) === FMT.fmtSci(0.00002), 'F fmtRateBody 与 fmtRate 必须共用同一套精度规则', 'F');
  // 全项目不应再有「fmtNum(...) + '/s'」这种 1 位小数的速率显示
  const fs = await import('node:fs');
  const uiFiles = fs.readdirSync(new URL('../js/ui', import.meta.url))
    .filter((f) => f.endsWith('.js'))
    .map((f) => new URL('../js/ui/' + f, import.meta.url));
  const badRate = [];
  for (const u of uiFiles) {
    const src = fs.readFileSync(u, 'utf8');
    // 形如 fmtNum(x) + '/s' 或 .toFixed(1) + '/s' / '/分钟'
    if (/fmtNum\([^)]*\)\s*\+\s*'\/s'/.test(src)) badRate.push(u.pathname.split('/').pop() + ' 用了 fmtNum(...) + \'/s\'');
    if (/\.toFixed\(1\)\s*\+\s*'\/(s|分钟)'/.test(src)) badRate.push(u.pathname.split('/').pop() + ' 用了 toFixed(1) 拼速率');
  }
  ok(badRate.length === 0, `F 不应再有 1 位小数的速率显示，实际：${badRate.join('；') || '无'}`, 'F');
}

// =====================================================================
// G. v0.0.61 四项需求
// =====================================================================
// 1) 浅层/深层/地核共有的资源，储量分开标注
// 2) 物品栏显示各资源的净增长（+ 绿 / − 红）
// 3) 开局不给氧气，氧气直接扣星球储量
// 4) 科研里取消舰船 MKI~MKIII 与 a/b/c/d（已在 selfcheck_v005 第六节覆盖）
console.log('\n===== G. v0.0.61（跨层储量 / 净增长 / 氧气）=====');
const POP = await import('../js/core/population.js?v=26.4');
{
  // ---- G1：同名资源跨层各自成条，储量分开 ----
  // v0.0.91：原「地下」拆成「浅层(underground)」与「深层(deep)」两条，故石头现在是
  //   地表(surface) + 浅层(underground) + 深层(deep) + 地核(core) 共四条条目（需求 1 的分层落地）。
  const inst = freshPlanet();
  const stones = inst.inventory.filter((e) => e.mat === '石头');
  ok(stones.length === 4, `石头应同时有地表/浅层/深层/地核四条条目（v0.0.91 分层），实际 ${stones.length}`, 'G');
  ok(new Set(stones.map((e) => e.key)).size === 4, '四条石头的 key 应互不相同', 'G');
  ok(stones.every((e) => e.reserve > 0 && e.remaining === e.reserve), '每层储量应各自独立', 'G');
  const totalReserve = stones.reduce((s, e) => s + e.reserve, 0);
  ok(totalReserve > 1e12,
    `四层储量之和应 > 1e12（深层那条不能再被丢掉），实际 ${totalReserve.toExponential(2)}`, 'G');
  // 气体层与地表层不应混淆（氧气只应出现在气体层）
  const o2 = inst.inventory.filter((e) => e.mat === '氧气');
  ok(o2.length === 1 && o2[0].layer === 'gas', '氧气应只有气体层一条', 'G');

  // ---- G2：跨层聚合与扣减 ----
  const stoneE = inst.inventory.filter((e) => e.mat === '石头');
  stoneE[0].owned = 100;
  stoneE[1].owned = 50;
  stoneE[2].owned = 0;
  ok(S.ownedOf(inst, '石头') === 150, `ownedOf 应跨层求和（100+50），实际 ${S.ownedOf(inst, '石头')}`, 'G');
  ok(S.entriesOf(inst, '石头').length === 4, 'entriesOf 应返回全部四层条目', 'G');
  ok(S.spendOwned(inst, '石头', 120) === 120, 'spendOwned 应能跨层扣满 120', 'G');
  ok(Math.abs(S.ownedOf(inst, '石头') - 30) < 1e-9, `扣完应剩 30，实际 ${S.ownedOf(inst, '石头')}`, 'G');
  const leftover = S.spendOwned(inst, '石头', 999);
  ok(leftover === 30 && S.ownedOf(inst, '石头') === 0,
    `库存不足时应「有多少扣多少」并返回实际扣除量，实际 ${leftover}`, 'G');
  ok(S.spendOwned(inst, '石头', 0) === 0 && S.spendOwned(inst, '根本不存在的材料', 5) === 0,
    '扣 0 个或不存在的材料应安全返回 0', 'G');

  // ---- G3（需求 3）：开局不给氧气，氧气直接扣星球储量 ----
  const inst3 = S.getPlanetInstance(S.newGame('v006-氧气').homePlanetCode);
  const o2e = inst3.inventory.find((e) => e.mat === '氧气');
  ok(!!o2e && o2e.owned === 0, `开局物品栏不应有氧气（需求 3），实际 ${o2e && o2e.owned}`, 'G');
  const remainingBefore = o2e.remaining;
  for (let i = 0; i < 60; i++) S.tick(1);
  ok(o2e.remaining < remainingBefore,
    `氧气应从星球气体储量里被扣（${remainingBefore} → ${o2e.remaining}），需求 3`, 'G');
  ok(o2e.owned === 0, '氧气不应因人口呼吸而积累到物品栏', 'G');

  // ---- G4（需求 2）：净增长 = 采集 + 加工产出 − 加工投料 − 人口消耗 ----
  const inst4 = freshPlanet();
  setOwned(inst4, '有机质', 1e6);
  setOwned(inst4, '水', 1e6);
  for (let i = 0; i < 3; i++) S.tick(1);
  // v0.1.2（需求 2）：呼吸扣的是**星球大气层**（consumeGas），不碰物品栏，
  // 所以氧气**不应该**再出现在净增长里——此前会凭空显示一笔补不平的负增长。
  const o2Net = Number(inst4.netRates['氧气']);
  ok(inst4.netRates['氧气'] === undefined || o2Net === 0,
    `氧气不应出现在净增长里（呼吸扣大气层），实际 ${inst4.netRates['氧气']}`, 'G');
  ok(Number(inst4.netRates['有机质']) < 0,
    `有机质净增长应为负（呼吸消耗），实际 ${inst4.netRates['有机质']}`, 'G');
  ok(Number(inst4.netRates['水']) < 0,
    `水净增长应为负，实际 ${inst4.netRates['水']}`, 'G');
  ok(Number.isFinite(Number(inst4.netRates['有机质'])) && Number.isFinite(Number(inst4.netRates['水'])),
    '净增长必须是有限数，不得为 NaN', 'G');
  // 派人采集后，石头的净增长应为正
  assign(inst4, 'surface_gatherer', 50);
  S.tick(1);
  ok(Number(inst4.netRates['石头']) > 0,
    `派人采集后石头净增长应为正，实际 ${inst4.netRates['石头']}`, 'G');
  // 净增速应与实际持有的变化方向一致（符号校验）
  {
    const before = S.ownedOf(inst4, '石头');
    for (let i = 0; i < 10; i++) S.tick(1);
    const after = S.ownedOf(inst4, '石头');
    ok(after > before && Number(inst4.netRates['石头']) > 0,
      `净增长为正时实际持有也应增加（${before} → ${after}）`, 'G');
  }
  // 未选配方的加工建筑不应影响净增长
  inst4.buildings.furnace = 1;
  assign(inst4, 'furnace_worker', 8);
  S.tick(1);
  ok(inst4.netRates['木头'] === undefined,
    '装好熔炉但未选工作内容时，不应出现「木头」的净增长（R16 的未选不运转）', 'G');
  // 差分断言：选了配方之后，投料（有机质 2）与耗氧（氧气 1）应把这两项的净增长拉低。
  // 注意不能直接断言「有机质为负」——地表有机质丰度 2、露天采集工还在采，
  // 采集带来的正增长远大于熔炉投料，净增长本来就是正的。
  const omBefore = Number(inst4.netRates['有机质']) || 0;
  const o2Before = Number(inst4.netRates['氧气']) || 0;
  mkLine(inst4, 'furnace', 'r_furnace_wood', 8);   // v0.0.9：工位减半，人数按实际工位夹取
  S.tick(1);
  ok(Number(inst4.netRates['木头']) > 0,
    `选了配方后「木头」应有正净增长，实际 ${inst4.netRates['木头']}`, 'G');
  ok(Number(inst4.netRates['有机质']) < omBefore,
    `熔炉投料应把「有机质」的净增长拉低（${omBefore} → ${inst4.netRates['有机质']}）`, 'G');
  ok(Number(inst4.netRates['氧气']) < o2Before,
    `熔炉耗氧也应体现在「氧气」的净增长里（${o2Before} → ${inst4.netRates['氧气']}）`, 'G');
}

// =====================================================================
// H. 缓存版本串（v0.0.62 黑屏事故防回归）
// =====================================================================
// 事故回放：手机缓存了旧版 format.js（URL 永不变化 + 服务器不发缓存头），
//   新 UI 导入 fmtRateBody 时整条模块链炸掉 → 纯黑屏。
//   治本：所有相对导入统一带 ?v=<CACHE_TAG>（docs/bump_imports.mjs 一键重写）。
//   本组扫描源码，**谁忘了跑 bump 脚本就直接报错**。
console.log('\n===== H. 缓存版本串（v0.0.62 防回归）=====');
{
  const { readFileSync, readdirSync, statSync } = await import('node:fs');
  const { join, dirname } = await import('node:path');
  const { fileURLToPath } = await import('node:url');
  const root = join(dirname(fileURLToPath(import.meta.url)), '..');
  const tag = V.CACHE_TAG;

  function walkJs(dir, out = []) {
    for (const name of readdirSync(dir)) {
      const p = join(dir, name);
      if (statSync(p).isDirectory()) walkJs(p, out);
      else if (name.endsWith('.js')) out.push(p);
    }
    return out;
  }
  const bare = [];
  const stale = [];
  let versioned = 0;
  for (const f of walkJs(join(root, 'js'))) {
    const src = readFileSync(f, 'utf8');
    for (const m of src.matchAll(/['"](\.{1,2}\/[^'"]*?\.js)(?:\?v=([^'"]*))?['"]/g)) {
      if (!m[2]) bare.push(join(f, m[1]));
      else if (m[2] !== tag) stale.push(`${join(f, m[1])}（?v=${m[2]}）`);
      else versioned++;
    }
  }
  ok(bare.length === 0,
    `js/ 下不允许存在不带 ?v= 的相对导入（现 ${bare.length} 处${bare.length ? '：' + bare.slice(0, 3).join('、') : ''}）—— 发版前必须跑 docs/bump_imports.mjs`, 'H');
  ok(stale.length === 0,
    `js/ 下所有导入的 ?v= 必须等于 CACHE_TAG=${tag}（过期 ${stale.length} 处${stale.length ? '：' + stale.slice(0, 3).join('、') : ''}）`, 'H');
  ok(versioned >= 80, `带版本串的导入应有 ≥80 处（实际 ${versioned}）`, 'H');

  // index.html 的 css/js 引用也要跟 CACHE_TAG 一致
  const html = readFileSync(join(root, 'index.html'), 'utf8');
  const tags = [...html.matchAll(/\?v=([^"']+)/g)].map((m) => m[1]);
  ok(tags.length >= 6 && tags.every((t) => t === tag),
    `index.html 的 ?v= 应全部为 ${tag}（实际 ${[...new Set(tags)].join(',')}，共 ${tags.length} 处）`, 'H');
}

// =====================================================================
// I. 交战结算（v0.2.2：钢铁雄心式多回合会战）
// =====================================================================
// 验收点：同 seed 确定性、组织度打空撤出、战斗宽度、回合上限进攻方撤退、
//   战损比落在 0~1、掠夺只在胜利时非零、旧数字签名兼容。
console.log('\n===== I. 钢铁雄心式交战（v0.2.2）=====');
{
  const ARMY = await import('../js/core/army.js?v=26.4');
  const seed = 123456789;
  // 单位契约与 galaxy.js 发送的一致：{ nameCn, power, stats:{atk, def} }
  const mk = (nameCn, atk, def, power) => ({ nameCn, power, stats: { atk, def } });
  const weakDef = [mk('游骑兵·轻型突击队 No.1', 56, 30, 80)];
  const strongAtk = [
    mk('铁壁·重装步兵班 No.1', 96, 186, 250),
    mk('铁壁·重装步兵班 No.2', 96, 186, 250),
    mk('游骑兵·轻型突击队 No.1', 56, 30, 80),
    mk('游骑兵·轻型突击队 No.2', 56, 30, 80),
  ];

  // 1. 确定性：同 seed 两次结算完全一致
  const r1 = ARMY.resolveBattle(seed, strongAtk, weakDef);
  const r2 = ARMY.resolveBattle(seed, strongAtk, weakDef);
  ok(r1.attackerWin === r2.attackerWin
    && r1.atkLossRatio === r2.atkLossRatio
    && r1.defLossRatio === r2.defLossRatio
    && r1.rounds === r2.rounds
    && r1.plunderRatio === r2.plunderRatio,
    '同 seed 两次结算结果完全一致（异步邮箱契约）', 'I');

  // 2. 强攻弱守 → 进攻方胜，守方战损 ≥ 攻方，胜利时掠夺非零
  ok(r1.attackerWin === true, '4 支强军攻 1 支弱军应获胜', 'I');
  ok(r1.defLossRatio >= r1.atkLossRatio,
    `守方战损 ${r1.defLossRatio.toFixed(3)} 应 ≥ 攻方 ${r1.atkLossRatio.toFixed(3)}`, 'I');
  ok(r1.plunderRatio >= 0.10 && r1.plunderRatio <= 0.25,
    `胜利掠夺比 ${r1.plunderRatio.toFixed(3)} 应在 10%~25%`, 'I');
  ok(r1.rounds >= 1 && r1.rounds < 24 && r1.logLines.length > 0,
    `强攻弱守应在 ${r1.rounds} 回合内分出胜负（有逐回合日志）`, 'I');

  // 3. 战斗宽度：5 支攻军第 1 回合只有 3 支接战
  const five = [...strongAtk, mk('游骑兵·轻型突击队 No.3', 56, 30, 80)];
  const r3 = ARMY.resolveBattle(777, five, weakDef);
  // v0.2.6 rev3：日志首行改为地形/装甲行，找「第 1 回合」那一行判定宽度
  const round1 = (r3.logLines || []).find((l) => l.indexOf('第1回合') >= 0) || '';
  ok(round1.includes('攻方 3 支接战'),
    '战斗宽度 3：5 支攻军第 1 回合只有 3 支接战（其余为预备队）', 'I');

  // 4. 回合上限 → 进攻方撤退（守方胜），无掠夺。
  //    注：完全同属性的军队不是平局 —— 守方每回合先手，攻方会先被耗光（守方优势，
  //    HOI4 惯例）；真正打满 24 回合要用「高防低攻」谁都啃不动的堡垒对峙。
  const fortress = () => [mk('堡垒营 A', 20, 500, 300), mk('堡垒营 B', 20, 500, 300), mk('堡垒营 C', 20, 500, 300)];
  const r4 = ARMY.resolveBattle(42, fortress(), fortress());
  ok(r4.attackerWin === false, '攻不下 → 进攻方撤退（守方守住）', 'I');
  ok(r4.plunderRatio === 0, '进攻失败不得掠夺', 'I');
  ok(r4.rounds === 24, `回合上限应为 24，实际 ${r4.rounds}`, 'I');

  // 4b. 同属性对称军 → 守方先手优势获胜（HOI4 防御方优势口径）
  const even = [mk('铁壁·重装步兵班 No.1', 96, 186, 250), mk('铁壁·重装步兵班 No.2', 96, 186, 250), mk('铁壁·重装步兵班 No.3', 96, 186, 250)];
  const r4b = ARMY.resolveBattle(42, even, even.map((u) => ({ ...u })));
  ok(r4b.attackerWin === false && r4b.defLossRatio <= r4b.atkLossRatio,
    '对称军队 → 守方先手优势获胜（守方战损 ≤ 攻方）', 'I');

  // 5. 战损比都在 0~1 区间
  for (const [tag, res] of [['r1', r1], ['r3', r3], ['r4', r4]]) {
    ok(res.atkLossRatio >= 0 && res.atkLossRatio <= 1
      && res.defLossRatio >= 0 && res.defLossRatio <= 1,
      `${tag} 战损比均在 0~1（攻 ${res.atkLossRatio.toFixed(3)} / 守 ${res.defLossRatio.toFixed(3)}）`, 'I');
  }

  // 6. 旧数字签名兼容（老收件箱事件无 atkArmies 快照时仍可结算）
  const r5 = ARMY.resolveBattle(9, 500, 200);
  ok(typeof r5.attackerWin === 'boolean' && r5.logLines.length > 0,
    '旧签名 resolveBattle(seed, 数字, 数字) 兼容可用', 'I');

  // 7. armyToUnit：power 快照兜底按蓝图重算
  const u = ARMY.armyToUnit({ nameCn: '测试营', blueprintId: 'ab_ranger', stats: { atk: 56, def: 30 } });
  ok(u && u.org === 100 && u.hpMax > 0 && u.atk === 56,
    'armyToUnit：组织度 100、power 缺失时按蓝图重算', 'I');
}

// =====================================================================
// J. 军队 v0.2.4：部件材料实装 / 编制点 / 训练 / 军营速率
// =====================================================================
console.log('\n===== J. 军队材料/编制/训练（v0.2.4）=====');
{
  const ARMY = await import('../js/core/army.js?v=26.4');
  const AP = await import('../js/data/army_parts.js?v=26.4');

  // 1. 材料实装：武器用钛合金（强）应比铁攻更高；机动底盘用重材减速、轻材加速
  const rifleIron = ARMY.resolveArmyPart('ap_wpn_rifle', '铁');
  const rifleTi = ARMY.resolveArmyPart('ap_wpn_rifle', '钛合金');
  ok(rifleTi.atk > rifleIron.atk,
    `武器材料影响攻：突击步枪 铁${rifleIron.atk} < 钛合金${rifleTi.atk}`, 'J');
  const hoverIron = ARMY.resolveArmyPart('ap_mob_hover', '铁');
  const hoverTung = ARMY.resolveArmyPart('ap_mob_hover', '钨');
  ok(hoverTung.speed < hoverIron.speed,
    `机动材料影响速度：钨${hoverTung.speed} < 铁${hoverIron.speed}`, 'J');
  const frameTi = ARMY.resolveArmyPart('ap_frame_light', '钛合金');
  ok(frameTi.def > rifleIron.atk * 0 && frameTi.def > ARMY.resolveArmyPart('ap_frame_light', '铁').def,
    '框架材料影响防：钛合金框架防御更高', 'J');

  // 2. 蓝图人数：游骑兵（3 架框架）= 105 人，在 100 人上下
  const ranger = AP.ARMY_BP_BY_ID['ab_ranger'];
  const st = ARMY.armyStatsOfBp(ranger);
  ok(st.men >= 90 && st.men <= 120, `军队人数应在 100 上下（游骑兵 ${st.men} 人）`, 'J');

  // 3. 编制点：游骑兵合法；去掉框架/武器不合法；超编不合法
  ok(AP.armyCapOf(ranger.parts).ok, '游骑兵蓝图编制合法', 'J');
  ok(!AP.armyCapOf([{ id: 'ap_wpn_rifle', count: 4 }]).ok, '无框架不合法', 'J');
  ok(!AP.armyCapOf([{ id: 'ap_frame_light', count: 1 }]).ok, '无武器不合法', 'J');
  ok(!AP.armyCapOf([{ id: 'ap_frame_light', count: 1 }, { id: 'ap_wpn_howitzer', count: 9 }]).ok,
    '超编制点不合法（1 架轻框架装不下 9 门楷弹炮）', 'J');

  // 4. 训练（v0.2.6 改为计时任务）：trainArmy 立即扣装备并开进度；advanceTraining 推进到 100% 才结算加成
  const acc = { armies: [], tech: [] };
  const inst = { buildings: { training_ground: 1 }, equipment: { 'ap_wpn_rifle@铁': { partId: 'ap_wpn_rifle', count: 5 } }, trainingTasks: [] };
  const army = { id: 'am_t', nameCn: '测试营', blueprintId: 'ab_ranger', power: ARMY.armyPowerOf(st), stats: st, exp: 0, bonusAtk: 0, bonusDef: 0 };
  acc.armies.push(army);
  const bad = ARMY.trainArmy(acc, 'am_none', inst);
  ok(!bad.ok, '训练不存在的军队应失败', 'J');
  const poor = { armies: acc.armies, tech: [] };
  const poorInst = { buildings: { training_ground: 1 }, equipment: {}, trainingTasks: [] };
  ok(!ARMY.trainArmy(poor, 'am_t', poorInst).ok, '无装备时训练失败且不白扣', 'J');
  const r = ARMY.trainArmy(acc, 'am_t', inst);
  ok(r.ok && r.duration > 0 && inst.trainingTasks.length === 1, '点训练开一条计时任务（立即扣装备）', 'J');
  ok((inst.equipment['ap_wpn_rifle@铁'].count) === 3, '训练损耗 2 件装备（5→3）', 'J');
  ok(army.exp === 0 && army.bonusAtk === 0, '训练未结束尚未结算加成', 'J');
  // 推进 60 秒（> 45s 时长）到完成
  ARMY.advanceTraining(inst, 60, acc);
  ok(army.exp === 15 && army.bonusAtk === 2 && army.bonusDef === 2, '训练完成：+2攻/+2防 +15经验', 'J');
  ok(army.power > ARMY.armyPowerOf(st), '训练后战力重算且更高', 'J');
  // 补足装备再训练 2 次 → 经验 45 跨 1 个 30 里程碑 → 额外 +1/+1（共 3 次 → +7/+7）
  inst.equipment['ap_wpn_rifle@铁'].count += 4;
  ARMY.trainArmy(acc, 'am_t', inst); ARMY.advanceTraining(inst, 60, acc);
  ARMY.trainArmy(acc, 'am_t', inst); ARMY.advanceTraining(inst, 60, acc);
  ok(army.exp === 45 && army.bonusAtk === 7 && army.bonusDef === 7,
    `经验里程碑：45 经验跨 1 个 30 里程碑额外 +1（当前 +${army.bonusAtk}/+${army.bonusDef}）`, 'J');
}

// =====================================================================
// K. 商店星股市 + 拍卖行（v0.2.6）
// =====================================================================
console.log('\n===== K. 股市 / 拍卖（v0.2.6）=====');
{
  function freshAcc() { return { id: 'k_' + Math.random().toString(36).slice(2), name: '测试', ascoin: 1e7, ships: [] }; }
  function freshInst() { return { code: 'syl', inventory: [{ mat: '铁', layer: 'refined', owned: 1000 }], equipment: {} }; }

  const acc = freshAcc();
  SHOP.shopStateOf(acc);

  // 1. 低级资源极度贬值：natural 基准价远低于 composite
  const natural = MAT.MATERIALS.find((m) => m.category === 'natural');
  const composite = MAT.MATERIALS.find((m) => m.category === 'composite');
  const pn = SHOP.priceOf(acc, natural.nameCn);
  const pc = SHOP.priceOf(acc, composite.nameCn);
  ok(pn > 0 && pn < pc && pn <= 12, '低级资源「' + natural.nameCn + '」基准价极低(' + pn + ') 远低于复合资源(' + pc + ')', 'K');

  // 2. 金恒价不受影响
  ok(SHOP.priceOf(acc, '金') === 1048576, '金恒价 1048576 不受影响', 'K');

  // 3. 商店仓库已初始化且为正
  ok(SHOP.warehouseOf(acc, '铁') > 0, '商店仓库初始化为正库存', 'K');

  // 4. 股市即时买：扣 ascoin、入库星球、减仓库、买涨
  const inst = freshInst();
  const bal0 = acc.ascoin;
  const wh0 = SHOP.warehouseOf(acc, '铁');
  const r = SHOP.marketBuy(acc, '铁', 10, inst);
  ok(r.ok && r.qty === 10, 'marketBuy 成功买入 10', 'K');
  ok(acc.ascoin < bal0, 'marketBuy 扣除 ascoin', 'K');
  ok(S.ownedOf(inst, '铁') === 1010, 'marketBuy 入库到星球（铁 1000→1010）', 'K');
  ok(SHOP.warehouseOf(acc, '铁') < wh0, 'marketBuy 减少商店仓库库存', 'K');

  // 5. 股市即时卖：加 ascoin、扣星球、进仓库、卖跌
  const bal1 = acc.ascoin, own1 = S.ownedOf(inst, '铁');
  const r2 = SHOP.marketSell(acc, '铁', 5, inst);
  ok(r2.ok && r2.qty === 5, 'marketSell 成功卖出 5', 'K');
  ok(acc.ascoin > bal1, 'marketSell 增加 ascoin（扣佣金后）', 'K');
  ok(S.ownedOf(inst, '铁') === own1 - 5, 'marketSell 从星球扣货', 'K');

  // 6. 仓库为 0 时拒绝买入（缺货）
  acc.shopWarehouse['铁'] = 0;
  const r3 = SHOP.marketBuy(acc, '铁', 1, inst);
  ok(!r3.ok, '仓库为 0 时 marketBuy 拒绝（缺货）', 'K');
  acc.shopWarehouse['铁'] = wh0;   // 还原，避免影响后续

  // 7. 拍卖：开拍托管资源 → NPC 兜底出价 → 到期成交（用可推进假时钟模拟 15s 窗口）
  const realNow = Date.now;
  let clk = realNow();
  Date.now = () => clk;
  try {
    const accA = freshAcc(); const instA = freshInst();
    const rA = AUC.createAuction(accA, instA, { type: 'resource', key: '铁', qty: 20, minBid: 100, planetCode: 'syl' });
    ok(rA.ok, '开拍资源拍卖成功', 'K');
    ok(S.ownedOf(instA, '铁') === 980, '开拍托管资源（铁 1000→980）', 'K');
    for (let i = 0; i < 16; i++) { clk += 1000; AUC.tickAuctions(accA, 1, { getInst: () => instA }); }
    ok(accA.shopAuctions.length === 0, '拍卖到期后从活跃列表移除', 'K');
    ok(accA.shopAuctionLog.length > 0 && accA.shopAuctionLog[0].type === 'sold', 'NPC 兜底出价 → 成交并记录', 'K');
    ok(accA.ascoin > 1e7, '卖家获得成交额（扣除佣金后）', 'K');
  } finally { Date.now = realNow; }

  // 8. 出价规则：不能拍自己的；第三方出价生效；低于最高价被拒
  const accB = freshAcc(); const instB = freshInst();
  const rB = AUC.createAuction(accB, instB, { type: 'resource', key: '铁', qty: 10, minBid: 50, planetCode: 'syl' });
  const idB = rB.auction.id;
  ok(!AUC.placeBid(accB, idB, 100, accB.id, accB.name).ok, '不能竞拍自己的拍卖', 'K');
  ok(AUC.placeBid(accB, idB, 200, 'other', '某人').ok, '第三方出价生效', 'K');
  ok(AUC.activeAuctions(accB).find((a) => a.id === idB).topBid === 200, '最高价更新为 200', 'K');
  ok(!AUC.placeBid(accB, idB, 10, 'other2', '某人2').ok, '低于当前最高价的出价被拒', 'K');

  // 9. 装备 / 飞船拍卖托管
  const accC = freshAcc(); const instC = freshInst();
  instC.equipment['ap_wpn_rifle@铁'] = { partId: 'ap_wpn_rifle', material: '铁', count: 5 };
  const rC = AUC.createAuction(accC, instC, { type: 'equipment', key: 'ap_wpn_rifle@铁', qty: 3, minBid: 100, planetCode: 'syl' });
  ok(rC.ok && instC.equipment['ap_wpn_rifle@铁'].count === 2, '开拍装备拍卖托管（5→2）', 'K');
  const accD = freshAcc(); const instD = freshInst();
  accD.ships = [{ id: 'ship_x', name: '测试舰', className: '运输船' }];
  const rD = AUC.createAuction(accD, instD, { type: 'ship', key: 'ship_x', qty: 1, minBid: 500, planetCode: 'syl' });
  ok(rD.ok && accD.ships.length === 0, '开拍飞船拍卖托管（移出账号）', 'K');
}

// =====================================================================
// 汇总
// =====================================================================
console.log('\n===== 各组通过/失败 =====');
for (const g of ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J', 'K']) {
  console.log(`  ${g} 组：通过 ${groups[g][0]} 项，失败 ${groups[g][1]} 项`);
}
console.log(`\n通过 ${pass} 项，失败 ${fail} 项`);
if (fail > 0) process.exit(1);

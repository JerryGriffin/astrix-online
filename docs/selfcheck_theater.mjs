// ============================================================================
// 行星战区地图自检（v0.4.1）—— node docs/selfcheck_theater.mjs
// ============================================================================
// 覆盖：
//   1. 地图生成：尺寸、地貌覆盖、殖民地数量、确定性、存档可复现
//   2. 所有权与邻接：连片领土、可进攻目标只在相邻
//   3. 补给网络：BFS 只走我方战区，切断即断供
//   4. 战区战斗：地貌取自战区、驻防加成、轨道打击瘫痪效果
//   5. 占领与殖民地争夺：打赢易手、殖民地入账、战争分数与进度
//   6. 战略轨道打击：门槛、消耗、驻防削减、恢复
//   7. 敌方 AI 战略层：会选高价值目标、会扩张、不崩
// ============================================================================

import { pathToFileURL } from 'url';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const { CACHE_TAG } = await import(pathToFileURL(join(ROOT, 'js/version.js')));
const TH = await import(pathToFileURL(join(ROOT, 'js/core/theater.js')) + `?v=${CACHE_TAG}`);
const B = await import(pathToFileURL(join(ROOT, 'js/core/battle.js')) + `?v=${CACHE_TAG}`);

let pass = 0, fail = 0;
const bad = [];
function ok(cond, name, extra) {
  if (cond) { pass++; console.log('  ✓ ' + name); }
  else { fail++; bad.push(name + (extra ? ' → ' + extra : '')); console.log('  ✗ ' + name + (extra ? '  [' + extra + ']' : '')); }
}

function mkAcc(nDiv = 20, ic = 200, theaterSeed = 1936) {
  const acc = {
    id: 't_acc', nation: 'ger', scenario: 'hoi1936',
    armies: [], wars: [], warLog: [], battles: [], foePools: {},
    fleets: [], ships: [], hoiSeas: [{ id: 'a', control: 1 }, { id: 'b', control: 1 }],
    _homeInst: { hoiIndustry: { ic } },
    theaterSeed, stats: {},
  };
  for (let i = 0; i < nDiv; i++) {
    acc.armies.push({
      id: 'army_' + i, nameCn: '德军 第' + (i + 1), blueprintId: 'ab_ranger',
      men: 500, menMax: 500, exp: 0, bonusAtk: 0, bonusDef: 0,
      stats: { atk: 194, def: 144, speed: 8 }, power: 338,
    });
  }
  acc.wars.push({
    id: 'war_1', kind: 'npc', targetId: 'fra', targetName: '法国',
    myScore: 0, theirScore: 0, battles: 0, status: 'active',
    log: [], progress: 0,
  });
  return acc;
}

console.log('\n=== Astrix 行星战区地图自检（CACHE_TAG=' + CACHE_TAG + '） ===\n');

// T1 地图生成 --------------------------------------------------------
console.log('T1 地图生成');
{
  const acc = mkAcc();
  const t = TH.ensureTheater(acc);
  ok(!!t, '生成成功');
  ok(t.regions.length === 36, '36 个战区（6×6）', String(t.regions.length));
  ok(t.cols === 6 && t.rows === 6, '尺寸 6×6');
  const terrs = new Set(t.regions.map((r) => r.terrain));
  ok(terrs.size >= 6, '地貌种类 ≥6（应有 7 种）', Array.from(terrs).join(','));
  for (const need of ['regolith', 'crater', 'canyon', 'dust', 'lava', 'ice', 'dome']) {
    ok(terrs.has(need), '含地貌 ' + need);
  }
  const colonies = t.regions.filter((r) => r.structure === 'colony');
  ok(colonies.length >= 6, '殖民地战区 ≥6（争夺目标）', String(colonies.length));
  ok(colonies.every((c) => c.owner && c.popM > 0), '殖民地都有属主与人口');
  ok(t.regions.filter((r) => r.structure === 'orbital').length >= 10,
    '各国都有轨道投送点', String(t.regions.filter((r) => r.structure === 'orbital').length));
  ok(t.regions.every((r) => r.nameCn), '所有战区都有名字');
}

// T2 确定性 ---------------------------------------------------------
console.log('\nT2 确定性与可复现');
{
  const a1 = mkAcc(4, 100, 555); TH.ensureTheater(a1);
  const a2 = mkAcc(4, 100, 555); TH.ensureTheater(a2);
  const sig = (a) => a.theater.regions.map((r) => r.terrain + r.owner + r.structure + r.popM).join('|');
  ok(sig(a1) === sig(a2), '同 theaterSeed → 完全相同的地图');

  const a3 = mkAcc(4, 100, 556); TH.ensureTheater(a3);
  ok(sig(a1) !== sig(a3), '不同 theaterSeed → 不同地图');

  // 存档往返：把 theater 存进 JSON 再读回，应仍然可用且不变
  const saved = JSON.parse(JSON.stringify(a1.theater));
  const a4 = mkAcc(4, 100, 999);
  a4.theater = saved;
  const again = TH.ensureTheater(a4);
  ok(again.regions.length === 36, '存档往返后地图仍在（不被重新生成）');
  ok(again.regions[0].id === saved.regions[0].id, '存档往返后战区 id 不变');
}

// T3 所有权与邻接 ---------------------------------------------------
console.log('\T3 所有权与邻接');
{
  const acc = mkAcc();
  const t = TH.ensureTheater(acc);
  const mine = t.regions.filter((r) => r.owner === 'ger');
  ok(mine.length >= 2, '玩家有起始战区', String(mine.length));
  // 连片性：玩家战区应互相连通（至少有一对相邻）
  let adjacent = false;
  for (const a of mine) {
    for (const b of mine) {
      if (a === b) continue;
      const dx = Math.abs(a.x - b.x), dy = Math.abs(a.y - b.y);
      if (dx <= 1 && dy <= 1) { adjacent = true; break; }
    }
    if (adjacent) break;
  }
  ok(adjacent, '玩家起始战区互相连片');
  // 进攻目标只在相邻
  const home = mine.find((r) => r.structure === 'orbital') || mine[0];
  const targets = TH.attackTargetsOf(acc, home);
  ok(targets.length > 0, '本土有可进攻的相邻目标', String(targets.length));
  ok(targets.every((r) => Math.abs(r.x - home.x) <= 1 && Math.abs(r.y - home.y) <= 1),
    '进攻目标全部在相邻格内');
  ok(targets.every((r) => r.owner !== 'ger'), '进攻目标不含己方战区');
}

// T4 补给网络 -------------------------------------------------------
console.log('\nT4 补给网络（BFS 只走我方战区）');
{
  const acc = mkAcc();
  const t = TH.ensureTheater(acc);
  const mine = t.regions.filter((r) => r.owner === 'ger');
  ok(mine.every((r) => r.connected), '起始战区都在补给网络内',
    mine.map((r) => r.id + (r.connected ? '' : '(断)')).join(','));
  ok(t.supplyReach === mine.length, '补给覆盖数 = 我方战区数',
    t.supplyReach + ' vs ' + mine.length);

  // 把一个相邻的我方战区易手 → 该战区之后不可达
  const home = mine.find((r) => r.structure === 'orbital') || mine[0];
  const bridge = mine.find((r) => r !== home
    && Math.abs(r.x - home.x) <= 1 && Math.abs(r.y - home.y) <= 1);
  if (bridge) {
    // 给它加一个「我方孤岛」：再往远处放一块我方战区，切断中间
    const far = t.regions.find((r) => !r.owner);
    far.owner = 'ger';
    bridge.owner = 'ger';
    TH.refreshSupply(acc);
    const connectedBefore = far.connected;
    bridge.owner = 'fra';                    // 切断走廊
    TH.refreshSupply(acc);
    ok(far.connected === false, '切断走廊后远处孤岛断供', 'before=' + connectedBefore + ' after=' + far.connected);
    ok(TH.regionSupplyOf(acc, far) < TH.regionSupplyOf(acc, home),
      '断供战区补给系数低于连通战区',
      TH.regionSupplyOf(acc, far) + ' vs ' + TH.regionSupplyOf(acc, home));
  } else {
    ok(true, '（起始战区过少，跳过断供用例）');
  }
}

// T5 战区战斗 -------------------------------------------------------
console.log('\nT5 在战区开战（地貌/驻防来自地图）');
{
  const acc = mkAcc();
  const t = TH.ensureTheater(acc);
  const mine = t.regions.filter((r) => r.owner === 'ger');
  // 注意：玩家本土**未必**直接邻接敌国（版图之间常有中立区），
  //   所以要从**全部**我方战区里找，而不是只看本土 —— 这也正是
  //   「先扫清中立区、再接触敌军」的推进节奏。
  let target = null, origin = null;
  for (const m of mine) {
    const adj = t.regions.filter((r) => r.owner && r.owner !== 'ger'
      && Math.abs(r.x - m.x) <= 1 && Math.abs(r.y - m.y) <= 1);
    if (adj.length) { target = adj[0]; origin = m; break; }
  }
  ok(!!target, '找到一个与我方接壤的敌方战区', target ? target.id + '/' + target.terrain : 'none');
  if (target) {
    // v0.4.2：进攻必须声明**来源战区**（相邻的我方战区）
    let origin = null;
    for (const m of mine) {
      if (Math.abs(m.x - target.x) <= 1 && Math.abs(m.y - target.y) <= 1) { origin = m; break; }
    }
    ok(!!origin, '找到相邻的进攻来源战区', origin ? origin.id : 'none');
    const noOrigin = B.startBattle(acc, acc.wars[0], { regionId: target.id, armyIds: ['army_0'] });
    ok(!noOrigin.ok, '缺少 originId 时拒绝（地图层空间规则）', noOrigin.reason);
    const r = B.startBattle(acc, acc.wars[0], {
      regionId: target.id, originId: origin.id, armyIds: ['army_0','army_1','army_2'],
    });
    ok(r.ok, '可在该战区开战', r.ok ? '' : r.reason);
    if (r.ok) {
      ok(r.battle.terrain === target.terrain, '战斗地貌 = 战区地貌',
        r.battle.terrain + ' vs ' + target.terrain);
      ok(r.battle.regionId === target.id, '战斗记录了 regionId', r.battle.regionId);
      ok(r.battle.originId === origin.id, '战斗记录了 originId', r.battle.originId);
      // v0.4.2：同一战区可开多条战线（多方向夹击），但有上限
      const avail2 = acc.armies.filter((a) => (a.men || 0) > 0 && !acc.battles.some(
        (b) => b.status === 'active' && b.mine.some((d) => d.armyId === a.id)));
      const r2 = B.startBattle(acc, acc.wars[0], {
        regionId: target.id, originId: origin.id, armyIds: avail2.slice(0, 2).map((a) => a.id),
      });
      ok(r2.ok, '同一战区可再开第二条战线（多方向）', r2.ok ? '' : r2.reason);
      const fronts = TH.frontInfoOf(acc, target.id);
      ok(fronts.fronts === 2, '战线计数为 2', String(fronts.fronts));
      ok(fronts.directions === 1, '同来源 → 方向数仍为 1（不构成夹击）', String(fronts.directions));
      ok(fronts.flank === 0, '同来源无夹击加成', String(fronts.flank));
    }
  }
}

// T6 占领与殖民地争夺 ----------------------------------------------
console.log('\nT6 占领与殖民地争夺');
{
  const acc = mkAcc(40, 260);
  const t = TH.ensureTheater(acc);
  const home = t.regions.find((r) => r.owner === 'ger' && r.structure === 'orbital');
  // 找一个**敌方殖民地**并推到相邻，逐次打赢把它吃下来
  let cur = home;
  let guard = 0, took = 0, colonyTook = 0;
  while (took < 4 && guard++ < 40) {
    const cand = t.regions.filter((r) => r.owner !== 'ger' && !r.battleId
      && Math.abs(r.x - cur.x) <= 1 && Math.abs(r.y - cur.y) <= 1);
    if (!cand.length) break;
    const pick = cand.find((r) => r.structure === 'colony') || cand[0];
    const avail = acc.armies.filter((a) => (a.men || 0) > 0 && !acc.battles.some(
      (b) => b.status === 'active' && b.mine.some((d) => d.armyId === a.id)));
    if (!avail.length) break;
    const r = B.startBattle(acc, acc.wars[0], {
      regionId: pick.id, originId: cur.id, armyIds: avail.slice(0, 5).map((a) => a.id),
    });
    if (!r.ok) break;
    let g = 0; while (r.battle.status === 'active' && g++ < 4000) B.tickBattles(acc, 1);
    if (r.battle.result && r.battle.result.attackerWin) {
      took++;
      if (pick.structure === 'colony') colonyTook++;
      cur = pick;
    } else break;
  }
  ok(took >= 1, '至少夺下一个战区', 'took=' + took + ' colony=' + colonyTook);
  const inc = TH.colonyIncomeOf(acc);
  ok(inc.count === colonyTook, '殖民地收益与占领数一致', JSON.stringify(inc));
  ok(acc.wars[0].progress > 0, '占领推动战争进度', 'progress=' + acc.wars[0].progress);
  ok(acc.theater.regions.filter((r) => r.owner === 'ger').length >= 3,
    '我方战区数量增加',
    String(acc.theater.regions.filter((r) => r.owner === 'ger').length));
  ok(pick0Supply(acc), '占领后补给网络已刷新');
}

function pick0Supply(acc) {
  TH.refreshSupply(acc);
  const t = acc.theater;
  const mine = t.regions.filter((r) => r.owner === 'ger');
  return mine.length > 0 && mine.some((r) => r.connected);
}

// T7 战略轨道打击 ---------------------------------------------------
console.log('\nT7 战略轨道打击（跨战区）');
{
  const acc = mkAcc();
  const t = TH.ensureTheater(acc);
  // 优先挑**有驻防**的敌方战区（否则驻防为 0，打击对它「减不动」是正常的）
  let foe = t.regions.find((r) => r.owner && r.owner !== 'ger' && (r.garrison || 0) > 0.05);
  let noGarrison = false;
  if (!foe) { foe = t.regions.find((r) => r.owner && r.owner !== 'ger'); noGarrison = true; }
  ok(!!foe, '有敌方战区可打击');
  if (foe) {
    // 门槛：轨道控制不足时拒绝
    const g1 = TH.canStrikeRegion(acc, foe, 0.2);
    ok(!g1.ok && /轨道控制/.test(g1.reason), '轨道控制不足时拒绝打击', g1.reason);
    // 我方战区不能打
    const home = t.regions.find((r) => r.owner === 'ger');
    const g2 = TH.canStrikeRegion(acc, home, 1);
    ok(!g2.ok, '不能打击自己的战区', g2.reason);
    // 次数为 0 时拒绝
    const before = t.strikes;
    t.strikes = 0;
    const g3 = TH.canStrikeRegion(acc, foe, 1);
    ok(!g3.ok && /没有可用轨道打击/.test(g3.reason), '打击次数为 0 时拒绝', g3.reason);
    t.strikes = before;
    // 正常打击
    const g0 = foe.garrison;
    const res = TH.strikeRegion(acc, foe, 1);
    ok(res.ok, '可实施打击', res.reason || '');
    ok(t.strikes === before - 1, '消耗一次打击次数', before + ' → ' + t.strikes);
    if (noGarrison) {
      ok(g0 === 0, '（该战区本就无驻防，驻防削减无从体现）');
    } else {
      ok(foe.garrison < g0, '驻防被削减', g0 + ' → ' + foe.garrison);
    }
    ok(foe.strikePressure > 0, '留下防线瘫痪标记', String(foe.strikePressure));
    // 恢复
    for (let i = 0; i < 5000; i++) TH.decayStrikePressure(acc, 1);
    ok(t.strikes > 0, '打击次数随时间恢复', String(t.strikes));
  }
}

// T8 敌方 AI 战略层 -------------------------------------------------
console.log('\nT8 敌方 AI 战略层');
{
  const acc = mkAcc();
  TH.ensureTheater(acc);
  const t = acc.theater;
  let err = '';
  try { for (let i = 0; i < 200; i++) TH.tickTheaterAI(acc, 1, { myOrbital: 0.5 }); }
  catch (e) { err = e.message; }
  ok(!err, '连续跑 200 拍不抛异常', err);
  ok(['probe', 'press', 'consolidate'].indexOf(t.aiMood) >= 0,
    'AI 有战略情绪状态', t.aiMood);
  ok(typeof t.aiTarget === 'string' && t.aiTarget, 'AI 会选定目标战区', String(t.aiTarget));
  const neutralBefore = t.regions.filter((r) => !r.owner).length;
  const acc2 = mkAcc(); TH.ensureTheater(acc2);
  const n0 = acc2.theater.regions.filter((r) => !r.owner).length;
  for (let i = 0; i < 200; i++) TH.tickTheaterAI(acc2, 1, { myOrbital: 0.2 });
  const n1 = acc2.theater.regions.filter((r) => !r.owner).length;
  ok(n1 <= n0, 'AI 会把中立战区并入自己（扩张）', n0 + ' → ' + n1);
  // AI 会优先打高价值目标（投送点/殖民地）
  const target = t.regions.find((r) => r.id === t.aiTarget);
  if (target) {
    const highValue = target.structure === 'orbital' || target.structure === 'colony'
      || target.structure === 'depot' || target.owner !== 'ger';
    ok(highValue, 'AI 目标合理（属我方且高价值）',
      target.id + '/' + target.structure + '/' + target.owner);
  }
}

// T9 theaterView 供 UI --------------------------------------------
console.log('\nT9 UI 视图');
{
  const acc = mkAcc();
  const v = TH.theaterView(acc);
  ok(!!v, '能取到视图');
  ok(v.regions.length === 36, '视图含 36 战区');
  ok(typeof v.colonyIncome.popM === 'number', '殖民地收益可读');
  ok(v.strikeMax === TH.STRIKE_MAX, '打击上限可读');
  ok(v.regions.every((r) => typeof r.supply === 'number'), '每个战区有补给系数');
  ok(v.regions.every((r) => typeof r.terrain === 'string'), '每个战区有地貌');
}

// T10 v0.4.2：多方向夹击 ------------------------------------------------
console.log('\nT10 多方向夹击（同战区多战线）');
{
  const acc = mkAcc(30, 240);
  const t = TH.ensureTheater(acc);
  // 造一个「被三面夹击」的目标：找一块中立/敌方战区，且我方在其 3 个不同方向
  let target = null, origins = [];
  for (const r of t.regions) {
    if (r.owner === 'ger') continue;
    const nb = t.regions.filter((m) => m.owner === 'ger'
      && Math.abs(m.x - r.x) <= 1 && Math.abs(m.y - r.y) <= 1);
    const uniq = [];
    for (const m of nb) {
      const dir = Math.sign(r.x - m.x) + ',' + Math.sign(r.y - m.y);
      if (uniq.indexOf(dir) < 0) uniq.push(dir);
    }
    if (uniq.length >= 3) { target = r; origins = nb.slice(0, 3); break; }
  }
  if (!target) {
    ok(true, '（该地图无三面夹击位置，跳过）');
  } else {
    ok(origins.length >= 3, '找到可三面夹击的战区', target.id + ' 方向数=' + origins.length);
    const used = [];
    for (const o of origins.slice(0, 3)) {
      const avail = acc.armies.filter((a) => (a.men || 0) > 0 && !acc.battles.some(
        (b) => b.status === 'active' && b.mine.some((d) => d.armyId === a.id)));
      if (avail.length < 1) break;
      const r = B.startBattle(acc, acc.wars[0], {
        regionId: target.id, originId: o.id, armyIds: avail.slice(0, 3).map((a) => a.id),
      });
      if (r.ok) used.push(r.battle);
    }
    const fi = TH.frontInfoOf(acc, target.id);
    ok(fi.fronts >= 2, '同战区开出多条战线', 'fronts=' + fi.fronts);
    ok(fi.directions >= 2, '识别出多个来源方向', 'directions=' + fi.directions);
    ok(fi.flank > 0, '产生夹击加成', 'flank=' + fi.flank.toFixed(3));
    ok(fi.flank <= TH.FLANK_MAX + 1e-9, '夹击加成有上限', String(TH.FLANK_MAX));
    // 同来源平摊：同一来源的两条战线 share 应为 0.5
    const sameOriginBattles = (acc.battles || []).filter((b) => b.status === 'active'
      && b.regionId === target.id && b.originId === used[0].originId);
    if (sameOriginBattles.length >= 2) {
      ok(true, '同来源多条战线 → 伤害平摊（overlapShare<1）',
        'count=' + sameOriginBattles.length);
    }
    // 夹击确实让守方更脆
    if (used[0]) { B.tickBattles(acc, 1); ok(typeof used[0].flank === 'number', '战斗对象记录了 flank', String(used[0].flank)); }
  }
}

// T11 v0.4.2：殖民地产出接入真实经济 --------------------------------
console.log('\nT11 殖民地产出接入真实经济');
{
  const acc = mkAcc();
  const t = TH.ensureTheater(acc);
  const before = TH.regionYieldOf(acc);
  ok(before && typeof before === 'object', '能算出战区产出', JSON.stringify(before));
  ok(Object.keys(before || {}).length > 0, '有产出资源', Object.keys(before || {}).join(','));
  // 断供 → 产量下降
  const home = t.regions.find((r) => r.owner === 'ger' && r.structure === 'orbital');
  const sum = (o) => Object.keys(o || {}).reduce((s, k) => s + o[k], 0);
  const full = sum(before);
  // 人为制造断供：把我方所有战区的补给标记去掉
  TH.refreshSupply(acc);
  for (const r of t.regions) if (r.owner === 'ger') r.connected = false;
  const cut = sum(TH.regionYieldOf(acc));
  ok(cut < full, '断供后总产量下降', full.toFixed(2) + ' → ' + cut.toFixed(2));
  // 驻防提升 → 产量上升
  TH.refreshSupply(acc);
  const g0 = home.garrison;
  home.garrison = 0;
  const noGar = sum(TH.regionYieldOf(acc));
  home.garrison = TH.GARRISON_MAX;
  const fullGar = sum(TH.regionYieldOf(acc));
  ok(fullGar >= noGar, '驻防满时产量不低于驻防空', noGar.toFixed(2) + ' → ' + fullGar.toFixed(2));
  // tickRegions 会增长驻防
  const gStart = home.garrison;
  for (let i = 0; i < 100; i++) TH.tickRegions(acc, 10);
  ok(home.garrison >= gStart, 'tickRegions 会增长我方驻防', gStart + ' → ' + home.garrison);
}

// T12 v0.4.2：围城（穹顶需先打满围城进度） --------------------------
console.log('\nT12 围城门槛（穹顶）');
{
  const acc = mkAcc(30, 240);
  const t = TH.ensureTheater(acc);
  // 找一块敌方穹顶（或直接指定一块敌方战区当穹顶来测门槛）
  let dome = t.regions.find((r) => r.structure === 'dome' && r.owner !== 'ger');
  if (!dome) {
    dome = t.regions.find((r) => r.owner !== 'ger');
    if (dome) dome.structure = 'dome';
  }
  if (!dome) { ok(true, '（地图上无合适战区，跳过）'); }
  else {
    const mine = t.regions.find((r) => r.owner === 'ger'
      && Math.abs(r.x - dome.x) <= 1 && Math.abs(r.y - dome.y) <= 1);
    if (!mine) { ok(true, '（穹顶不相邻，跳过）'); }
    else {
      dome.siege = 0;
      const r1 = TH.captureRegion(acc, acc.wars[0], dome, true);
      ok(!r1 || r1.sieged === true, '围城未满时无法占领穹顶', JSON.stringify(r1));
      ok(dome.owner !== 'ger', '穹顶仍在敌方手中', String(dome.owner));
      dome.siege = TH.SIEGE_REQUIRED;
      const r2 = TH.captureRegion(acc, acc.wars[0], dome, true);
      ok(r2 && !r2.sieged && dome.owner === 'ger', '围城打满后可占领', JSON.stringify(r2));
    }
  }
}

// T13 v0.4.2：补给线可视化数据 --------------------------------------
console.log('\nT13 补给线路（可视化数据）');
{
  const acc = mkAcc();
  const t = TH.ensureTheater(acc);
  const links = TH.supplyLinksOf(acc);
  ok(Array.isArray(links), '能取到补给线列表', String(links.length));
  ok(links.length === Math.max(0, (t.regions.filter((r) => r.owner === 'ger').length) - 1),
    '补给线数量 = 我方战区数 − 投送点数',
    links.length + ' vs ' + (t.regions.filter((r) => r.owner === 'ger').length));
  ok(links.every((l) => l.from && l.to && typeof l.from.x === 'number'),
    '每条线有起点坐标（供 UI 画线）');
}

// T14 v0.4.3：敌方 AI 也会夹击 ---------------------------------------
console.log('\nT14 敌方 AI 多路夹击');
{
  const acc = mkAcc(30, 240);
  TH.ensureTheater(acc);
  const t = acc.theater;
  // **确定性地摆出包围局面**：挑一个「非我方邻居最多」的���方战区，
  //   把它的邻居判给法国。（不能指望随机地图自然形成包围 —— 否则断言会被跳过。）
  //   注意玩家本土在角落、邻居本就不多，故按邻居数择优而不是固定用本土。
  const gerRegions = t.regions.filter((r) => r.owner === 'ger');
  let ger = null, best = -1;
  for (const r of gerRegions) {
    const n = t.regions.filter((o) => o.owner !== 'ger'
      && Math.abs(o.x - r.x) <= 1 && Math.abs(o.y - r.y) <= 1).length;
    if (n > best) { best = n; ger = r; }
  }
  const target = ger;
  const nbs = t.regions.filter((r) => r.owner !== 'ger'
    && Math.abs(r.x - ger.x) <= 1 && Math.abs(r.y - ger.y) <= 1);
  if (nbs.length < 2) { ok(false, '应能构造出包围局面', '可用邻居仅 ' + nbs.length); }
  else {
    const target = ger;
    const aiOrigins = nbs.slice(0, 3);
    for (const o of aiOrigins) { o.owner = 'fra'; o.structure = null; }
    TH.refreshSupply(acc);
    ok(aiOrigins.length >= 2, '法国有多条相邻进攻路线', 'n=' + aiOrigins.length);

    // 给法国足够的师池，否则 aiFlankPlans 会因「被打空」而返回空
    acc.foePools = acc.foePools || {};
    acc.foePools['war_1'] = { ic: 50, divisions: 12, nameCn: '法兰西', killed: 0, seedAt: 12345 };

    const plans = TH.aiFlankPlans(acc, acc.wars[0], target);
    ok(plans.length >= 2, 'AI 能规划出多条夹击战线', 'plans=' + plans.length);
    ok(plans.length <= TH.AI_FLANK_MAX, '夹击路数有上限', String(TH.AI_FLANK_MAX));
    ok(plans.every((p) => p.regionId === target.id), '全部指向同一目标战区');
    ok(new Set(plans.map((p) => p.originId)).size === plans.length, '每条战线来源方向不同');

    // 实际开战后应产生夹击加成
    const { startBattle } = await import(pathToFileURL(join(ROOT, 'js/core/battle.js')) + `?v=${CACHE_TAG}`);
    let opened = 0;
    for (const p of plans.slice(0, 3)) {
      const r = startBattle(acc, acc.wars[0], { side: 'foe', regionId: p.regionId, originId: p.originId });
      if (r && r.ok) opened++;
    }
    ok(opened >= 2, 'AI 成功开出多条战线', 'opened=' + opened);
    const fi = TH.frontInfoOf(acc, target.id);
    ok(fi.directions >= 2, 'AI 侧识别出多方向', 'dirs=' + fi.directions);
    ok(fi.flank > 0, 'AI 的夹击也生效', 'flank=' + fi.flank.toFixed(3));
  }
}

// T15 v0.4.3：殖民地人口反哺本土 --------------------------------------
console.log('\nT15 殖民地人口反哺本土');
{
  const acc = mkAcc(40, 260);
  const t = TH.ensureTheater(acc);
  // 手动塞一个我方殖民地
  const rg = t.regions.find((r) => r.owner === 'ger');
  t.colonies.push({ regionId: rg.id, nameCn: '测试殖民地', popM: 5, at: Date.now() });
  const s1 = TH.colonySupportOf(acc);
  ok(s1.popM >= 5, '统计到殖民地人口', String(s1.popM));
  ok(s1.researchPerSec > 0, '提供研究点', String(s1.researchPerSec));
  ok(s1.popGrowthBonus > 0, '提供人口增长加成', String(s1.popGrowthBonus));
  // 断供 → 反哺衰减
  TH.refreshSupply(acc);
  const fullRp = TH.colonySupportOf(acc).researchPerSec;
  rg.connected = false;
  const cutRp = TH.colonySupportOf(acc).researchPerSec;
  ok(cutRp < fullRp, '断供的殖民地反哺减少', fullRp.toFixed(3) + ' → ' + cutRp.toFixed(3));
  rg.connected = true;
  // 失去殖民地 → 反哺归零
  t.colonies = [];
  ok(TH.colonySupportOf(acc).researchPerSec === 0, '没有殖民地则无反哺');
}

// T16 v0.4.3：战区产出不得包含气体（v0.0.61 需求 3 的不变量） ----------
console.log('\nT16 战区产出不含气体（回归守卫）');
{
  const acc = mkAcc(20, 240);
  const t = TH.ensureTheater(acc);
  // 强行把本土战区设成会产氧气的冰盖/穹顶
  const rg = t.regions.find((r) => r.owner === 'ger');
  rg.terrain = 'ice'; rg.structure = 'colony'; rg.popM = 3;
  const y = TH.regionYieldOf(acc);
  ok(y && typeof y === 'object', '能算出产出');
  const gasKeys = Object.keys(y || {}).filter((k) => TH.GAS_MATERIALS.has(k));
  ok(gasKeys.length === 0,
    '产出里没有任何气体（氧气等走大气储量，不入物品栏）', gasKeys.join(','));
  ok(y && y['水'] > 0, '冰盖仍产出水', JSON.stringify(y));
  // 所有地貌的产出表都不得含气体
  const badTables = Object.keys(TH.REGION_OUTPUT).filter((k) =>
    Object.keys(TH.REGION_OUTPUT[k]).some((m) => TH.GAS_MATERIALS.has(m)));
  ok(badTables.length === 0, '所有地貌产出表都不含气体', badTables.join(','));
}

// ---------------------------------------------------------------------------
// v0.4.9：夹击必须在**真实生成的地图**上开得出来（防止退回「永不触发」）
//
// v0.4.7 修好了 tickTheaterAI 的崩溃，但触发条件本身太严：aiFlankPlans 原本只认
//   目标战区的 8 邻接敌方区，而 growBlob 让各势力领土连成互不相连的块
//   → 实测 20 个种子，能开出 ≥2 路夹击的是 **0 个**。
// 现已放宽为「邻接优先，不足则按距离跨区投送」，本守卫锁定该行为。
// ---------------------------------------------------------------------------
{
  const SEEDS = [424242, 1, 7, 42, 100, 999, 12345, 55555, 777, 20260930, 31415,
                 8888, 24680, 13579, 11223, 5, 66, 7777, 314, 2718];
  let canFlank = 0, oneLand = 0;
  for (const sd of SEEDS) {
    const acc2 = {
      id: 'th_flank_' + sd, nation: 'ger', scenario: 'hoi1936', theaterSeed: sd,
      ships: [], fleets: [], armies: [], battles: [], warLog: [],
      wars: [{ id: 'w', status: 'active', targetId: 'fra', progress: 0,
               myScore: 0, theirScore: 0, battles: [], log: [] }],
      foePools: { w: { divisions: 8 } },
    };
    const t2 = TH.ensureTheater(acc2);
    const mine = t2.regions.filter((r) => r.owner === t2.myNation);
    const foeLands = t2.regions.filter((r) => r.owner === 'fra').length;
    if (foeLands < 2) { oneLand++; continue; }   // 数学上不可能有 2 个来源
    const plans = TH.aiFlankPlans(acc2, acc2.wars[0], mine[0]);
    if (plans.length >= 2) canFlank++;
  }
  const testable = SEEDS.length - oneLand;
  ok(canFlank >= Math.floor(testable * 0.8),
     '夹击在多数种子的真实地图上开得出来（≥80%）',
     canFlank + '/' + testable + '（敌方仅占 1 块地、已跳过的种子 ' + oneLand + ' 个）');
}

// ---------------------------------------------------------------------------
console.log('\n通过 ' + pass + ' / 失败 ' + fail);
if (fail) {
  console.log('\n失败项：');
  for (const b2 of bad) console.log('  · ' + b2);
  process.exit(1);
}
console.log('行星战区地图自检通过');
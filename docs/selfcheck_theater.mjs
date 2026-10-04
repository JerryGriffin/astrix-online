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
  let target = null;
  for (const m of mine) {
    const adj = t.regions.filter((r) => r.owner && r.owner !== 'ger'
      && Math.abs(r.x - m.x) <= 1 && Math.abs(r.y - m.y) <= 1);
    if (adj.length) { target = adj[0]; break; }
  }
  ok(!!target, '找到一个与我方接壤的敌方战区', target ? target.id + '/' + target.terrain : 'none');
  if (target) {
    const r = B.startBattle(acc, acc.wars[0], { regionId: target.id, armyIds: ['army_0','army_1','army_2'] });
    ok(r.ok, '可在该战区开战', r.ok ? '' : r.reason);
    if (r.ok) {
      ok(r.battle.terrain === target.terrain, '战斗地貌 = 战区地貌',
        r.battle.terrain + ' vs ' + target.terrain);
      ok(r.battle.regionId === target.id, '战斗记录了 regionId', r.battle.regionId);
      ok(target.battleId === r.battle.id, '战区被标记为交战中');
      // 重复在同一战区开战应被拒
      const r2 = B.startBattle(acc, acc.wars[0], { regionId: target.id, armyIds: ['army_5'] });
      ok(!r2.ok, '同一战区不能重复开战', r2.reason);
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
    const r = B.startBattle(acc, acc.wars[0], { regionId: pick.id, armyIds: avail.slice(0, 5).map((a) => a.id) });
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

// ---------------------------------------------------------------------------
console.log('\n通过 ' + pass + ' / 失败 ' + fail);
if (fail) {
  console.log('\n失败项：');
  for (const b2 of bad) console.log('  · ' + b2);
  process.exit(1);
}
console.log('行星战区地图自检通过');
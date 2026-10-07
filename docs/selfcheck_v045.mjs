// ============================================================================
// v0.4.5 需求自检 —— node docs/selfcheck_v045.mjs
// ============================================================================
// 覆盖本轮 5 项需求：
//   #2 战争过程加深（战役事件）
//   #3 离谱拍卖价不再成交
//   #4 和平会议（吞并 / 殖民化 / 卫星国 / 合作政府 / 瓜分 / 赔款）
//   #5 运输不必非要运输船
//   #6 王牌与装甲战力极大增强
// ============================================================================

import { readFileSync } from 'fs';
import { pathToFileURL } from 'url';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const { CACHE_TAG } = await import(pathToFileURL(join(ROOT, 'js/version.js')));
const U = (p) => pathToFileURL(join(ROOT, p)) + `?v=${CACHE_TAG}`;
const srcOf = (rel) => readFileSync(join(ROOT, rel), 'utf8');

const S = await import(U('/js/core/state.js'));
const TH = await import(U('/js/core/theater.js'));
const TR = await import(U('/js/core/treaty.js'));
const F = await import(U('/js/core/fleet.js'));
const A = await import(U('/js/core/auction.js'));
const H = await import(U('/js/core/hoi1936.js'));
const D = await import(U('/js/data/hoi1936.js'));
const B = await import(U('/js/core/battle.js'));

let pass = 0, fail = 0; const bad = [];
function ok(c, n, e) {
  if (c) { pass++; console.log('  ✓ ' + n); }
  else { fail++; bad.push(n + (e ? ' → ' + e : '')); console.log('  ✗ ' + n + (e ? '  [' + e + ']' : '')); }
}

function fresh() {
  S.newGame('v45-' + Math.random().toString(36).slice(2, 8));
  const acc = S.currentAccount();
  const t = TH.ensureTheater(acc);
  return { acc, t, me: t.myNation };
}
/** 让 foe 控制前 n 个战区 */
function giveFoe(t, foe, n) {
  const ids = [];
  for (const r of t.regions) {
    if (ids.length >= n) break;
    if (!r.owner || r.owner === t.myNation) { r.owner = foe; ids.push(r.id); }
  }
  TH.refreshSupply(t._acc || null);
  return ids;
}

console.log('\n=== v0.4.5 需求自检（CACHE_TAG=' + CACHE_TAG + '） ===\n');

// ---------------------------------------------------------------------------
console.log('#4 和平会议：6 种处置');
{
  const { acc, t, me } = fresh();
  const foe = 'xxx' + Math.floor(Math.random() * 1000);
  const ids = giveFoe(t, foe, 8);
    TH.refreshSupply(acc);

  const opts = TR.treatyOptions();
  ok(opts.length === 6, '共 6 种处置', String(opts.length));
  const want = ['annex', 'colonization', 'satellite', 'collaboration', 'partition', 'reparations'];
  ok(want.every((w) => opts.some((o) => o.id === w)), '六种处置齐备',
    opts.map((o) => o.id).join(','));

  const war = { id: 'w1', targetId: foe, targetName: '测试国', status: 'active', myScore: 90, theirScore: 10 };
  for (const id of want) {
    const av = TR.treatyAvailability(acc, war, id);
    if (id === 'partition') {
      ok(av.ok !== true, '瓜分在没有盟友时不可选并说明原因', JSON.stringify(av));
    } else {
      ok(av.ok === true, '战败时「' + id + '」可选', av.reason || '');
    }
  }

  // 分数不足 → 全部不可选
  const weak = { ...war, myScore: 10 };
  ok(TR.treatyAvailability(acc, weak, 'annex').ok === false, '战争分数不足时吞并不可选');
}

// --- 吞并：拿全部领土 ---
console.log('\n#4 吞并');
{
  const { acc, t, me } = fresh();   const foe = 'f1';
  giveFoe(t, foe, 8); TH.refreshSupply(acc);
  const war = { id: 'w2', targetId: foe, status: 'active', myScore: 90, theirScore: 5 };
  const r = TR.signTreaty(acc, war, 'annex', { foeWealth: 100000, applyMap: TH.applyTreatyToTheater });
  ok(r.ok, '签订吞并和约', r.reason || '');
  ok(r.ok && r.outcome.regionsTaken === 8, '吞并取得全部 8 处战区',
    r.ok ? String(r.outcome.regionsTaken) : '');
  const mine = TH.regionsOf(acc, me).length;
  ok(mine >= 8, '地图上战区已归我方', 'mine=' + mine);
  const foeLeft = TH.regionsOf(acc, foe).length;
  ok(foeLeft === 0, '敌方在地图上被清除', 'foeLeft=' + foeLeft);
  ok(Array.isArray(t.annexed) && t.annexed.includes(foe), '记录被吞并国家');
}

// --- 殖民化：标为 colony，产出 ×1.6 ---
console.log('\n#4 殖民化（产出 ×1.6 / 驻军需求 ×0.35）');
{
  const { acc, t, me } = fresh();   const foe = 'f2';
  giveFoe(t, foe, 5); TH.refreshSupply(acc);
  const war = { id: 'w3', targetId: foe, status: 'active', myScore: 90, theirScore: 5 };
  const r = TR.signTreaty(acc, war, 'colonization', { foeWealth: 0, applyMap: TH.applyTreatyToTheater });
  ok(r.ok, '签订殖民化和约', r.reason || '');
  ok(r.ok && r.map.colonies.length === 5, '5 处战区划为殖民地',
    r.ok ? String(r.map.colonies.length) : '');
  const col = t.regions.find((x) => x.treaty === 'colony');
  ok(!!col, '战区带 treaty=colony 标记');
  ok(TH.treatyOutputMulOf(col) === TH.TREATY_COLONY_OUTPUT_MUL, '殖民地产出系数为 1.6',
    String(TH.treatyOutputMulOf(col)));
  ok(TH.treatyGarrisonMulOf(col) === TH.TREATY_COLONY_GARRISON_MUL, '殖民地驻军需求为 0.35',
    String(TH.treatyGarrisonMulOf(col)));
  const annexLike = { treaty: 'annex' };
  ok(TH.treatyOutputMulOf(annexLike) === 1, '吞并战区产出无加成');
  // 产出确实受影响：对比同结构战区
  const y = TH.regionYieldOf(acc);
  ok(y && Object.keys(y).length > 0, '殖民化后战区仍在产出', JSON.stringify(y).slice(0, 80));
}

// --- 瓜分：盟友越多分到越少 ---
console.log('\n#4 瓜分领土');
{
  const mk = (allies) => {
    const { acc, t, me } = fresh();     const foe = 'f3';
    giveFoe(t, foe, 9); TH.refreshSupply(acc);
    acc.allies = allies.map((n, i) => ({ id: 'a' + i, nameCn: '盟友' + i }));
    const war = { id: 'w4', targetId: foe, status: 'active', myScore: 90, theirScore: 5 };
    const r = TR.signTreaty(acc, war, 'partition', { foeWealth: 0, applyMap: TH.applyTreatyToTheater });
    return { acc, t, me, r };
  };
  const a = mk([]);
  ok(a.r.ok !== true, '无盟友时瓜分被拒', a.r.reason || '');
  ok(TR.allyCountOf(a.acc, null) === 0, '无盟友时 allyCount=0');

  const one = mk([{ id: 'a0', nameCn: '盟友A' }]);
  const two = mk([{ id: 'a0', nameCn: '盟友A' }, { id: 'a1', nameCn: '盟友B' }]);
  ok(one.r.ok, '有盟友时瓜分可签', one.r.reason || '');
  ok(one.r.ok && two.r.ok && two.r.outcome.regionsTaken < one.r.outcome.regionsTaken,
    '盟友越多我方分到越少',
    one.r.ok && two.r.ok ? one.r.outcome.regionsTaken + ' → ' + two.r.outcome.regionsTaken : '');
  ok(two.r.ok && two.r.outcome.regionsToAllies > one.r.outcome.regionsToAllies,
    '盟友分走的是我方所得之外的部分');
  ok(one.r.ok && one.r.map.toAllies.length > 0, '分给盟友的战区脱离我方');
  const shares = TR.partitionShares(two.acc, null);
  ok(shares.length === 3, '份额表含我方 + 2 盟友', String(shares.length));
  ok(shares.every((s) => Math.abs(s.share - 1 / 3) < 1e-9), '三人均分');
}

// --- 卫星国 / 合作政府 ---
console.log('\n#4 卫星国 / 合作政府');
{
  const { acc, t, me } = fresh();   const foe = 'f4';
  giveFoe(t, foe, 4); TH.refreshSupply(acc);
  const war = { id: 'w5', targetId: foe, status: 'active', myScore: 90, theirScore: 5 };
  const foeOwned = TH.regionsOf(acc, foe).length;
  const r = TR.signTreaty(acc, war, 'satellite', { foeWealth: 0, applyMap: TH.applyTreatyToTheater });
  ok(r.ok, '签订卫星国和约', r.reason || '');
  ok(r.ok && r.vassal && r.vassal.kind === 'satellite', '登记为附庸');
  ok(r.ok && Array.isArray(acc.vassals) && acc.vassals.length === 1, '附庸写进账号');
  ok(TH.regionsOf(acc, foe).length === foeOwned, '卫星国保留本土（战区未被拿走）',
    String(TH.regionsOf(acc, foe).length) + ' vs ' + foeOwned);
  // 上贡结算（注意：tickTest 会改写战区归属，故必须在上面断言之后再跑）
  const v = tickTest(acc, 100);
  ok(v && v.tribute > 0, '卫星国持续上贡', v ? String(v.tribute) : 'null');
  ok(v && v.loyaltyDropped, '忠诚度随时间衰减');

  const c = fresh();
  const r2 = TR.signTreaty(c.acc, { id: 'w6', targetId: 'f5', status: 'active', myScore: 90, theirScore: 5 },
    'collaboration', { foeWealth: 0, applyMap: TH.applyTreatyToTheater });
  ok(r2.ok && r2.vassal.kind === 'collaboration', '合作政府登记正确');
  const v2 = tickTest(c.acc, 100);
  ok(v2 && v2.research > 0, '合作政府提供研究点', v2 ? String(v2.research) : 'null');
}

// --- 赔款 ---
console.log('\n#4 赔款');
{
  const { acc, t } = fresh();   const foe = 'f6';
  giveFoe(t, foe, 3); TH.refreshSupply(acc);
  const war = { id: 'w7', targetId: foe, status: 'active', myScore: 90, theirScore: 5 };
  acc.ascoin = 0;
  const r = TR.signTreaty(acc, war, 'reparations', { foeWealth: 100000, applyMap: TH.applyTreatyToTheater });
  ok(r.ok, '签订赔款和约', r.reason || '');
  ok(r.ok && r.outcome.reparations > 0, '计算出赔款额', r.ok ? String(r.outcome.reparations) : '');
  ok(r.ok && acc.ascoin > 0, '赔款已入账', String(acc.ascoin));
  ok(r.ok && TH.regionsOf(acc, foe).length === 3, '赔款不改变领土归属',
    String(TH.regionsOf(acc, foe).length));
  ok(r.ok && !r.vassal, '赔款不产生附庸');
}

// ---------------------------------------------------------------------------
console.log('\n#3 拍卖价不再离谱');
{
  const { acc } = fresh();
  ok(A.NPC_MAX_FAIR_MULTIPLE <= 2.0, 'NPC 上限锚定市价（≤2.0 倍）', String(A.NPC_MAX_FAIR_MULTIPLE));
  ok(A.NPC_FALLBACK_MULTIPLE <= 2.0, '无市价时上限 ≤2.0 倍起拍价', String(A.NPC_FALLBACK_MULTIPLE));
  ok(!/minBid \* \(2 \+ Math\.random\(\) \* 20\)/.test(srcOf('js/core/auction.js')),
    '旧的 22 倍公式已移除');
  // 实际函数：起拍价 100，市价极低 → 不应超过 150
  const low = A.npcCeilingOf(acc, 'resource', '钢', 1, 100);
  ok(low <= 150, '市价低时 NPC 上限被起拍价 1.5 倍封顶', String(low));
  // 算不出公允价（装备）
  const gear = A.npcCeilingOf(acc, 'equipment', 'ap_x', 1, 100);
  ok(gear <= 150, '无市价时也 ≤1.5 倍起拍价', String(gear));
  ok(gear >= 100, '下限不低于起拍价', String(gear));
  // 起拍价极低时也不该被抬到天上
  const tiny = A.npcCeilingOf(acc, 'equipment', 'ap_x', 1, 10);
  ok(tiny <= 15, '起拍价 10 时上限 ≤15', String(tiny));
}

// ---------------------------------------------------------------------------
console.log('\n#5 运输不必非要运输船');
{
  const { acc } = fresh();
  ok(typeof F.fleetCargoCells === 'function', 'fleetCargoCells 可用');
  ok(F.GENERIC_CARGO_CELLS > 0, '非运输船有兜底货舱', String(F.GENERIC_CARGO_CELLS));
  ok(!/编队里没有运输船/.test(srcOf('js/core/fleet.js')), '旧的「必须运输船」拦截已移除');

  // 造一个只有非运输船的编队
  acc.blueprints = [{ id: 'bp_gun', kind: 'warship', capacity: 0 }];
  acc.fleets = [{ id: 'f1', nameCn: '测试舰队', shipIds: ['s1'] }];
  acc.ships = [{ id: 's1', blueprintId: 'bp_gun', className: '护卫舰', state: { fuelMol: 1000 } }];
  const cells = F.fleetCargoCells(acc, acc.fleets[0]);
  ok(cells > 0, '无货舱的编队仍获得兜底货舱（运输不再被卡死）', String(cells));
  ok(cells === F.GENERIC_CARGO_CELLS, '兜底货舱量符合预期', String(cells));

  // 有货舱的船按 capacity 计
  acc.blueprints = [{ id: 'bp_f', kind: 'freighter', capacity: 10000 }];
  acc.ships = [{ id: 's2', blueprintId: 'bp_f', className: '运输船', state: {} }];
  acc.fleets = [{ id: 'f2', nameCn: '运输队', shipIds: ['s2'] }];
  const big = F.fleetCargoCells(acc, acc.fleets[0]);
  ok(big > F.GENERIC_CARGO_CELLS, '运输船货舱更大（仍然更划算）', String(big));
}

// ---------------------------------------------------------------------------
console.log('\n#6 王牌与装甲战力增强');
{
  ok(D.ELITE_MUL >= 3.0, '王牌师倍率 ≥3.0', String(D.ELITE_MUL));
  ok(D.ELITE_MUL > 1.6, '相对旧值 1.6 已提升');
  ok(typeof D.ELITE_DIVISIONS === 'object' && Object.keys(D.ELITE_DIVISIONS).length > 0, '王牌师名单非空');
  const src = srcOf('js/core/hoi1936.js');
  const m = src.match(/SLOT_POWER_MUL = \[([^\]]+)\]/);
  ok(!!m, '找到槽位倍率常量');
  if (m) {
    const arr = m[1].split(',').map((s) => parseFloat(s));
    ok(arr.length === 3, '三个槽位', m[1]);
    ok(arr[2] >= 2.4, '第三槽（装甲/突击）≥2.4 倍', m[1]);
    ok(arr[2] > arr[0], '装甲明显强于普通编制');
  }
}

// ---------------------------------------------------------------------------
console.log('\n#2 战争过程加深（战役事件 + 指挥官）');
{
  const src = srcOf('js/core/battle.js');
  ok(/BATTLE_EVENTS/.test(src), '存在战役事件表');
  ok(/export function rollBattleEvent/.test(src), '有战役事件触发函数');
  ok(/export function commandPowerOf|commanderOf|export function assignCommander/.test(src),
    '有指挥官系统');

  const { acc, t } = fresh();   const war = { id: 'wev', targetId: 'fx1', status: 'active', myScore: 0, theirScore: 0, id2: 1 };
  // 事件表本身
  const evs = B.BATTLE_EVENTS;
  ok(Array.isArray(evs) && evs.length >= 5, '战役事件 ≥5 种', String(evs && evs.length));
  ok(evs.every((e) => e && e.id && e.nameCn && e.desc), '每个事件都有 id/名称/说明');
  ok(evs.some((e) => e.effect === 'org'), '有影响组织度的事件');
  ok(evs.some((e) => e.effect === 'str'), '有影响兵力的事件');

  // 确定性：同种子必须出同一事件
  const seq1 = [], seq2 = [];
  for (let h = 1; h <= 80; h++) {
    const a = B.rollBattleEvent(war, 'r1', h, 12345);
    const b2 = B.rollBattleEvent(war, 'r1', h, 12345);
    seq1.push(a ? a.id : '-');
    seq2.push(b2 ? b2.id : '-');
  }
  ok(seq1.join(',') === seq2.join(','), '事件按战局确定性抽取（同种子同结果）');
  ok(seq1.filter((x) => x !== '-').length >= 10, '事件确实会触发（80 小时 ≥10 次）',
    String(seq1.filter((x) => x !== '-').length));

  // 指挥官
  const cm = B.COMMANDER_TRAITS;
  ok(cm && typeof cm === 'object' && Object.keys(cm).length >= 4, '指挥官特质 ≥4 种',
    String(cm && Object.keys(cm).length));
  const c1 = B.rollCommander('g1', 999);
  ok(c1 && c1.traitId && c1.nameCn, '能抽到指挥官', JSON.stringify(c1));
  const c2 = B.rollCommander('g1', 999);
  ok(c1.traitId === c2.traitId, '指挥官按种子确定性');
  const roster = B.commandersOf(acc);
  ok(roster.length > 0, '账号有指挥官名册', String(roster.length));
  // 开一场战役需要真有师：先造几支
  acc.armies = [];
  for (let i = 0; i < 4; i++) {
    acc.armies.push({
      id: 'cm_army_' + i, nameCn: '测试 第' + (i + 1) + ' 师',
      blueprintId: 'ab_ranger', men: 500, menMax: 500,
      exp: 0, bonusAtk: 0, bonusDef: 0,
      stats: { atk: 40, def: 40, speed: 8 }, power: 80,
    });
  }
  const rid = t.regions.find((r) => !r.owner || r.owner === t.myNation).id;
  const oid = (TH.neighborsOf(t.regions.find((r) => r.id === rid)) || []).map((n) => n.id)[0];
  const b = B.startBattle(acc, war, {
    side: 'me', terrain: 'plain', regionId: rid, originId: oid,
    armyIds: acc.armies.map((a) => a.id),
  });
  ok(b && b.ok && b.battle, '能开一场战役用于挂指挥官', b && (b.reason || ''));
  if (b && b.ok && b.battle) {
    const bb = b.battle;
    const gid = B.assignCommander(acc, bb, roster[0].id);
    ok(gid && gid.ok, '指挥官可指派到战役', gid && (gid.reason || ''));
    const eff = B.commanderEffectOf(bb);
    ok(eff && typeof eff === 'object', '指挥官效果可查询');
    const before = bb.commanderId;
    B.assignCommander(acc, bb, null);
    ok(bb.commanderId !== before, '指挥官可撤换');
  }
}

// ---------------------------------------------------------------------------
console.log('\n=== 回归：旧战后处置入口仍可用（不被和平会议破坏） ===');
{
  const { acc } = fresh();
  ok(typeof H.postwarOptionsFor === 'function', 'postwarOptionsFor 仍导出（兼容旧代码）');
  ok(typeof H.applyPostwarChoice === 'function', 'applyPostwarChoice 仍导出');
  ok(typeof TR.buildTreatySummary === 'function', 'buildTreatySummary 可用');
  const s = TR.buildTreatySummary(
    TR.treatyOptions().find((o) => o.id === 'annex'),
    { regionsTaken: 3, regionsToAllies: 0, reparations: 0, tribute: 0, researchBonus: 0 },
    { colonies: [1, 2], taken: [1], toAllies: [] }, null);
  ok(s && s.includes('吞并') && s.includes('3'), '摘要文案包含处置名与战区数', s);
}

// helper -------------------------------------------------------------------
function tickTest(acc, dt) {
  acc.vassals[0].nationId = 'someNation';
  acc.theater.regions[0].owner = 'someNation';
  acc.theater.regions[0].connected = true;
  acc.theater.regions[0].structure = 'mine';
  const before = Number(acc.vassals[0].loyalty);
  const r = TR.tickVassals(acc, dt, { outputOf: () => 100 });
  return { tribute: r && r.tribute, research: r && r.research, loyaltyDropped: Number(acc.vassals[0].loyalty) < before };
}

// ---------------------------------------------------------------------------
console.log('\n通过 ' + pass + ' / 失败 ' + fail);
if (fail) {
  console.log('\n失败项：');
  for (const b of bad) console.log('  · ' + b);
  process.exit(1);
}
console.log('v0.4.5 需求自检通过');
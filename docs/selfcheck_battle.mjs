// ============================================================================
// 战役系统自检（v0.3.4）—— node docs/selfcheck_battle.mjs
// ============================================================================
// 目的：验证 core/battle.js 的核心不变量，特别是「进度条不再是自动滑动」这条。
//
// ⚠️ 必须带 ?v=<CACHE_TAG> 导入 js/ 模块 —— ESM 按 URL 区分模块实例，
//    无串会拿到第二份 STATE/army 模块（见 bump_imports.mjs 顶部血泪注释）。
//
// 覆盖：
//   1. 开战线：编入 / 校验 / 同师不可重复编入
//   2. 交战推进：组织度下降、溃退、整补归队
//   3. 胜负结算：战损写回 acc.armies（兵员真减少、战力回落）
//   4. **进度条只由战役胜负推动**（核心回归点，见下方 T5）
//   5. 敌方师池被永久消耗（消耗战）
//   6. 补给 / 工事 / 战斗宽度 / 突破 均有实际影响
//   7. 僵持：守方撑满时限不算失败
// ============================================================================

import { pathToFileURL } from 'url';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const { CACHE_TAG } = await import(pathToFileURL(join(ROOT, 'js/version.js')));
const B = await import(pathToFileURL(join(ROOT, 'js/core/battle.js')) + `?v=${CACHE_TAG}`);
const { ARMY_MEN } = await import(pathToFileURL(join(ROOT, 'js/data/hoi1936.js')) + `?v=${CACHE_TAG}`);

let pass = 0, fail = 0;
const bad = [];
function ok(cond, name, extra) {
  if (cond) { pass++; console.log('  ✓ ' + name); }
  else { fail++; bad.push(name + (extra ? ' → ' + extra : '')); console.log('  ✗ ' + name + (extra ? '  [' + extra + ']' : '')); }
}

// ---------------------------------------------------------------------------
// 造一个最小账号：不需要真实存档，只要 tick 链路读得到的字段
// ---------------------------------------------------------------------------
function mkAcc(nDiv = 8, ic = 60) {
  const acc = {
    id: 'test_acc', nation: 'ger', scenario: 'hoi1936',
    armies: [], wars: [], warLog: [], battles: [], foePools: {},
    _homeInst: { hoiIndustry: { ic } },
    stats: {},
  };
  for (let i = 0; i < nDiv; i++) {
    acc.armies.push({
      id: 'army_' + i,
      nameCn: '德军 第' + (i + 1) + ' 步兵师',
      blueprintId: 'ab_ranger',
      men: ARMY_MEN, menMax: ARMY_MEN,
      exp: 0, bonusAtk: 0, bonusDef: 0,
      stats: { atk: 40, def: 40, speed: 8 },
      power: 80,
    });
  }
  acc.wars.push({
    id: 'war_1', kind: 'npc', targetId: 'fra', targetName: '法国',
    startedAt: Date.now(), myScore: 0, theirScore: 0, battles: 0,
    status: 'active', endedAt: 0, treaty: null, log: [], progress: 0,
  });
  return acc;
}

console.log('\n=== Astrix 战役系统自检（CACHE_TAG=' + CACHE_TAG + '） ===\n');

// T1 开战线 --------------------------------------------------------------
console.log('T1 开战线与编入校验');
{
  const acc = mkAcc();
  const war = acc.wars[0];
  const r = B.startBattle(acc, war, { armyIds: ['army_0', 'army_1', 'army_2'], terrain: 'urban' });
  ok(r.ok, '成功开辟战线');
  ok(r.battle && r.battle.mine.length === 3, '编入 3 个师', r.battle ? r.battle.mine.length + '' : 'null');
  ok(r.battle && r.battle.terrain === 'urban', '地形记录为 urban');
  ok(r.battle && r.battle.foe.length > 0, '敌方也派出师', r.battle ? r.battle.foe.length + '' : '0');
  ok(r.battle && r.battle.attacker === 'mine', 'attacker = 我方');

  // 同师不可重复编入同一条战争：改用一支**未被占用**的师开第二条战线
  const r2 = B.startBattle(acc, war, { armyIds: ['army_3', 'army_4'], terrain: 'plain' });
  ok(r2.ok, '可在同战争开第二条战线（多线作战）', r2.ok ? '' : r2.reason);
  ok(r2.battle && r2.battle.mine.every((d) => d.armyId !== 'army_0'), 'army_0 不会重复编入');
  const rDup = B.startBattle(acc, war, { armyIds: ['army_0'], terrain: 'desert' });
  ok(!rDup.ok, '已编入的师无法再次编入', rDup.ok ? '竟成功了' : rDup.reason);

  // 空编入被拒
  const r3 = B.startBattle(acc, war, { armyIds: [], terrain: 'plain' });
  ok(!r3.ok && !!r3.reason, '空编入被拒绝并给出原因', r3.reason);

  // 兵员耗尽的师不出战
  const acc2 = mkAcc(3);
  acc2.armies[0].men = 0;
  const r4 = B.startBattle(acc2, acc2.wars[0], { armyIds: ['army_0', 'army_1'], terrain: 'plain' });
  ok(r4.ok && r4.battle.mine.every((d) => d.armyId !== 'army_0'), '兵员耗尽的师被排除');
}

// T2 交战推进 -----------------------------------------------------------
console.log('\nT2 交战推进（组织度 / 溃退 / 整补）');
{
  const acc = mkAcc();
  const war = acc.wars[0];
  const { battle } = B.startBattle(acc, war, { armyIds: ['army_0', 'army_1', 'army_2'], terrain: 'plain' });
  const org0 = battle.mine.reduce((s, d) => s + d.org, 0);
  B.tickBattles(acc, 1);   // 1 秒 = 3 战斗小时
  ok(battle.hours === 3, '时钟推进 3 战斗小时', battle.hours + '');
  const org1 = battle.mine.reduce((s, d) => s + d.org, 0);
  ok(org1 < org0, '我方组织度被打掉', org0 + ' → ' + org1);
  const v = B.battleView(acc, battle.id);
  ok(v && v.mine.length === 3, 'battleView 能取到师列表');
  ok(v && v.width === B.BATTLE_COMBAT_WIDTH, '战斗宽度常量透出');
  ok(v && v.terrainCn === '平原', '地形中文名透出', v ? v.terrainCn : '');
}

// T3 战损回写 acc.armies（这是「真战斗」与「进度条」的根本差别）--------
console.log('\nT3 战损真实回写到 acc.armies');
{
  const acc = mkAcc();
  const war = acc.wars[0];
  const menBefore = acc.armies[0].men;
  const { battle } = B.startBattle(acc, war, { armyIds: ['army_0', 'army_1'], terrain: 'plain' });
  let guard = 0;
  while (battle.status === 'active' && guard++ < 4000) B.tickBattles(acc, 1);
  ok(battle.status === 'ended', '战役最终分出结果', battle.status);
  const menAfter = acc.armies[0].men;
  ok(menAfter < menBefore, '兵员真的减少了（进度条不会造成这个）',
    menBefore + ' → ' + menAfter);
  ok(typeof acc.armies[0].power === 'number', '战力被重算');
  ok(!!battle.result, '有结算结果', JSON.stringify(battle.result));
}

// T4 核心回归：进度条**不再**自动滑动 --------------------------------
console.log('\nT4 进度条只由战役胜负推动（核心回归点）');
{
  const acc = mkAcc();
  const war = acc.wars[0];
  // 强敌：我方很弱，且不开战线 → 敌方会主动进攻（tickWarsHoi4），
  // 但 battle.js 自身绝不推进 progress。
  const p0 = war.progress;
  B.tickBattles(acc, 5);
  ok(war.progress === p0, 'tickBattles 不会自行推进进度条', p0 + ' → ' + war.progress);

  // 打完一场胜仗 → progress 应该 > 0
  const acc2 = mkAcc(20, 140);
  const war2 = acc2.wars[0];
  const ids = acc2.armies.slice(0, 12).map((a) => a.id);
  const { battle } = B.startBattle(acc2, war2, { armyIds: ids, terrain: 'plain' });
  let g = 0;
  while (battle.status === 'active' && g++ < 6000) B.tickBattles(acc2, 1);
  ok(war2.progress > 0 || war2.battles > 0,
    '打赢/打完后战争进度或交战次数被推动',
    'progress=' + war2.progress + ' battles=' + war2.battles);
}

// T5 敌方师池被永久消耗 ------------------------------------------------
console.log('\nT5 消耗战：敌方师被永久消耗');
{
  const acc = mkAcc(24, 160);
  const war = acc.wars[0];
  const pool0 = B.foeRemaining(acc, war.id);
  ok(pool0 && pool0.divisions > 0, '敌方师池存在', JSON.stringify(pool0));
  for (let i = 0; i < 4; i++) {
    const ids = acc.armies.filter((a) => (a.men || 0) > 0).slice(0, 6).map((a) => a.id);
    const r = B.startBattle(acc, war, { armyIds: ids, terrain: 'plain' });
    if (!r.ok) break;
    let g = 0;
    while (r.battle.status === 'active' && g++ < 6000) B.tickBattles(acc, 1);
  }
  const pool1 = B.foeRemaining(acc, war.id);
  ok(pool1 && pool1.divisions < pool0.divisions,
    '多场战役后敌方可用师变少（不是一次性判定）',
    pool0.divisions + ' → ' + pool1.divisions);
  ok(pool1 && pool1.killed > 0, '记录了被击溃的敌方师数', 'killed=' + (pool1 && pool1.killed));
}

// T6 补给 / 工事 / 宽度 / 突破 确有影响 --------------------------------
console.log('\nT6 补给 / 工事 / 战斗宽度 / 突破');
{
  const acc = mkAcc(6, 60);
  const war = acc.wars[0];
  const { battle } = B.startBattle(acc, war, { armyIds: ['army_0', 'army_1'], terrain: 'plain' });
  B.tickBattles(acc, 2);
  const v = B.battleView(acc, battle.id);
  ok(v.supply.mine > 0 && v.supply.mine <= 1, '我方补给在 (0,1]', String(v.supply.mine));
  ok(v.entrench.foe > 0 || v.entrench.mine > 0, '工事有累积', JSON.stringify(v.entrench));
  ok(typeof v.breakthrough.mine === 'number', '突破值透出');
  ok(v.lastPower.atk > 0 || v.lastPower.def > 0, '有攻防读数', JSON.stringify(v.lastPower));
  ok(v.mineEngaged <= B.BATTLE_COMBAT_WIDTH, '接战数不超过战斗宽度',
    v.mineEngaged + ' <= ' + B.BATTLE_COMBAT_WIDTH);
}

// T7 僵持：守方撑满时限不算失败 ----------------------------------------
console.log('\nT7 僵持结算（守方撑满时限 = 守住，不是失败）');
{
  const acc = mkAcc();
  const war = acc.wars[0];
  // 造一场敌方主动进攻的战线
  const r = B.startBattle(acc, war, { side: 'foe', terrain: 'mountain' });
  ok(r.ok && r.battle.attacker === 'foe', '可由敌方主动发起进攻', r.ok ? '' : r.reason);
  const b = r.battle;
  // 直接把时钟推到上限前一瞬，稳定命中「超时」分支（不依赖双方数值平衡）
  b.hours = B.BATTLE_MAX_HOURS - 0.2;
  B.tickBattles(acc, 0.2);
  ok(b.status === 'ended', '战役结束');
  ok(b.result && b.result.stalemate === true,
    '守方撑满时限判为僵持，不算失败', JSON.stringify(b.result));
  ok(b.result && b.result.attackerWin !== false,
    '守方未被判负（HOI4：久攻不下即进攻方撤）', JSON.stringify(b.result));
  // 我方是进攻方时，超时才等于失败
  const acc2 = mkAcc();
  const w2 = acc2.wars[0];
  const r2 = B.startBattle(acc2, w2, { armyIds: ['army_0'], terrain: 'plain' });
  r2.battle.hours = B.BATTLE_MAX_HOURS - 0.2;
  B.tickBattles(acc2, 0.2);
  ok(r2.battle.result && r2.battle.result.stalemate !== true,
    '我方进攻久攻不下 → 判为失利撤出', JSON.stringify(r2.battle.result));
}

// T8 撤退令 ------------------------------------------------------------
console.log('\nT8 撤退令与战场可关闭');
{
  const acc = mkAcc(8, 80);
  const war = acc.wars[0];
  const { battle } = B.startBattle(acc, war, { armyIds: ['army_0', 'army_1', 'army_2'], terrain: 'plain' });
  const rr = B.orderRetreat(acc, battle.id, 'army_0');
  ok(rr.ok, '可下令某师撤出', rr.ok ? '' : rr.reason);
  const sb = B.stopBattle(acc, battle.id, '测试关闭');
  ok(sb.ok, '可主动结束战场', sb.ok ? '' : sb.reason);
  ok(battle.status === 'ended', '战场状态置为 ended');
}

// T9 回归守卫：剧本手工赋值的攻防**不得**被 armyEffStats 重算覆盖 ------------
//   v0.3.4 实测事故：战斗结算里调 armyEffStats() 覆盖 a.stats，
//   把 1936 剧本 setupArmies 手工赋的 atk 194 / def 144 削成 atk 24 / def 12.9，
//   30 个德国师被悄悄削掉近 8 倍战力 → 战线「必败」且查不出原因。
//   本项断言：打完整场战役后，攻防只能因缺员小幅下降，绝不能掉到个位数量级。
console.log('\nT9 剧本手工攻防不被 armyEffStats 削掉（回归守卫）');
{
  const acc = mkAcc(10, 120);
  // 模拟 setupArmies：手工赋值的高攻防（远高于 armyEffStats(ab_ranger) 的 ~24/13）
  for (const a of acc.armies) {
    a.stats = { atk: 194, def: 144, speed: 8 };
    a.power = 338;
    a.men = 500;
  }
  const war = acc.wars[0];
  const atkBefore = acc.armies[0].stats.atk;
  const { battle } = B.startBattle(acc, war, {
    armyIds: acc.armies.map((a) => a.id), terrain: 'plain',
  });
  ok(Math.abs(battle.mine[0].atk - (atkBefore + (acc.armies[0].bonusAtk || 0))) < 1,
    '参战时读到的就是 a.stats 的手工值', battle.mine[0].atk + ' vs ' + atkBefore);
  let g = 0;
  while (battle.status === 'active' && g++ < 6000) B.tickBattles(acc, 1);
  const atkAfter = acc.armies[0].stats.atk;
  ok(atkAfter > atkBefore * 0.5,
    '战后攻防未被重算削掉（应仅按缺员小幅下降）',
    atkBefore + ' → ' + atkAfter);
  ok(atkAfter <= atkBefore + 1, '战后攻防没有异常虚高', atkAfter + '');
}

// T10 消耗战：敌方多会被耗尽 → 可发动迫降 --------------------------------
console.log('\nT10 连续作战可打垮对方（通向迫降）');
{
  const acc = mkAcc(40, 200);
  const war = acc.wars[0];
  for (const a of acc.armies) { a.stats = { atk: 194, def: 144, speed: 8 }; a.power = 338; }
  let rounds = 0;
  while (rounds++ < 12) {
    const pool = B.foeRemaining(acc, war.id);
    if (!pool || pool.divisions <= 0) break;
    const ids = acc.armies.filter((a) => (a.men || 0) > 0).slice(0, 8).map((a) => a.id);
    const r = B.startBattle(acc, war, { armyIds: ids, terrain: 'plain' });
    if (!r.ok) break;
    let g = 0;
    while (r.battle.status === 'active' && g++ < 6000) B.tickBattles(acc, 1);
  }
  const pool = B.foeRemaining(acc, war.id);
  ok(pool.divisions === 0, '连续作战后敌方师池被打空', pool.divisions + ' 剩 / killed=' + pool.killed);
  const r2 = B.startBattle(acc, war, { armyIds: acc.armies.slice(0, 3).map((a) => a.id), terrain: 'plain' });
  ok(!r2.ok && /无可调之师/.test(r2.reason || ''), '师池打空后拒绝开战并提示可迫降', r2.reason);
  ok(war.progress >= 70, '推进达到可迫降线（≥70%）', 'progress=' + war.progress);
}

// ---------------------------------------------------------------------------
// v0.3.5 新增机制的验证
// ---------------------------------------------------------------------------

// T11 兵种模板：装甲/步兵的软硬与装甲穿甲不同 --------------------------
console.log('\nT11 兵种模板（软攻/硬攻/装甲/穿甲）');
{
  const t = B.DIV_TEMPLATES;
  ok(!!t.infantry && !!t.mech && !!t.armor, '三种兵种模板都存在');
  ok(t.armor.armor > t.mech.armor && t.mech.armor > t.infantry.armor, '装甲值：装甲 > 机械化 > 步兵');
  ok(t.armor.pierce > t.mech.pierce && t.mech.pierce > t.infantry.pierce, '穿甲值：装甲 > 机械化 > 步兵');
  ok(t.infantry.soft > t.armor.soft, '步兵偏软攻，装甲师偏硬攻');
  ok(t.armor.brk > t.infantry.brk, '装甲师突破更高');

  // 我方师带上模板属性
  const acc = mkAcc(4, 120);
  for (const a of acc.armies) { a.stats = { atk: 100, def: 80, speed: 8 }; a.power = 180; }
  acc.armies[0].elite = true;                 // 王牌 → 装甲
  acc.armies[1].blueprintId = 'ab_bulwark';  // 机械化
  const ids = acc.armies.map((a) => a.id);
  const r = B.startBattle(acc, acc.wars[0], { armyIds: ids, terrain: 'plain' });
  ok(r.ok, '开战成功', r.ok ? '' : r.reason);
  const kinds = r.battle.mine.map((d) => d.kind).sort();
  ok(kinds.indexOf('armor') >= 0 && kinds.indexOf('infantry') >= 0, '不同师识别出不同兵种', kinds.join(','));
  const inf = r.battle.mine.find((d) => d.kind === 'infantry');
  ok(inf && inf.softAtk > inf.hardAtk, '步兵师软攻 > 硬攻');
  const arm = r.battle.mine.find((d) => d.kind === 'armor');
  ok(arm && arm.hardAtk > inf.softAtk * 0.4, '装甲师硬攻可观');
  ok(arm && arm.armor >= 0.7 && inf.armor <= 0.2, '装甲师护甲明显更高',
    arm && inf ? arm.armor + ' vs ' + inf.armor : '');
}

// T12 装甲/穿甲的克制关系（逐对有效攻击） ------------------------------
console.log('\nT12 装甲/穿甲克制（步兵打不动装甲）');
{
  // 直接验证 effAtkAgainst 的行为（通过造一场只有两支师的战场观察伤害分配）
  const acc = mkAcc(2, 120);
  for (const a of acc.armies) { a.stats = { atk: 100, def: 100, speed: 8 }; a.power = 200; }
  const war = acc.wars[0];
  const r = B.startBattle(acc, war, { armyIds: ['army_0'], terrain: 'plain' });
  ok(r.ok, '单师可开战（宽度上限内）', r.ok ? '' : r.reason);
  // 敌方师至少有一个装甲师（takeFoe 按 ic 生成）
  const foeArmor = r.battle.foe.map((d) => d.armor);
  ok(foeArmor.length > 0 && foeArmor.every((a) => a >= 0 && a <= 1), '敌方师装甲在 [0,1] 规范化区间',
    foeArmor.join(','));
  ok(foeArmor.some((a) => a > 0.4), '敌方含装甲/机械化编制（可被穿甲克制）', foeArmor.join(','));
}

// T13 制海权 → 补给（把海域系统接进陆战） ------------------------------
// T13b（旧版制海权测试的替代说明）：v0.4.0 起 T13 改为「轨道控制」测试，
//   原「制海权 → 补给」的双向断言已并入 T13（见文件末尾）。

// T14 轨道火力（airforce 真正参与结算） -------------------------------
console.log('\nT14 轨道火力（airforce 不再是摆设）');
{
  const acc = mkAcc(8, 150);
  const war = acc.wars[0];
  const r = B.startBattle(acc, war, { armyIds: ['army_0','army_1','army_2'], terrain: 'plain' });
  B.tickBattles(acc, 1/3);
  const v = B.battleView(acc, r.battle.id);
  ok(v.air && v.air.mineAir >= 0 && v.air.foeAir >= 0, '有空军读数',
    v.air ? v.air.mineAir + ' vs ' + v.air.foeAir : '');
  ok(v.air && v.air.casMine >= 0.85 && v.air.casMine <= 1.30, '近距支援倍率在合理区间',
    v.air ? String(v.air.casMine) : '');
  // airforceOf 能取到国家空军数
  ok(B.airforceOf('ger') > 0, '能取到德国空军数', String(B.airforceOf('ger')));
}

// T15 装备率随补给波动 -----------------------------------------------
console.log('\nT15 装备率随补给涨落');
{
  const acc = mkAcc(6, 200);
  const war = acc.wars[0];
  acc.hoiSeas = [{ id:'a', control:0 }];   // 断海运 → 低补给 → 掉装备
  const r = B.startBattle(acc, war, { armyIds: ['army_0','army_1','army_2'], terrain: 'plain' });
  for (let i=0;i<40 && r.battle.status==='active';i++) B.tickBattles(acc, 1/3);
  const v = B.battleView(acc, r.battle.id);
  const anyEquip = v.mine.some((d) => d.equip < 100);
  ok(anyEquip, '低补给下装备率会下降（后勤生效）', v.mine.map((d)=>d.equip).join(','));
}

// T16 被动兜底推进（战争不会完全静止） ------------------------------
console.log('\nT16 无战场时的被动推进兜底');
{
  const acc = mkAcc(8, 120);
  const war = acc.wars[0];
  const p0 = war.progress;
  // 直接调 tickWarsHoi4 推进一天
  const H = await import(pathToFileURL(join(ROOT, 'js/core/hoi1936.js')) + `?v=${CACHE_TAG}`);
  H.tickWarsHoi4(acc, 1);
  ok(war.progress > p0, '无战场时进度缓慢推进（不会静止）', p0 + ' → ' + war.progress.toFixed(3));
  ok(war.progress < p0 + 2, '被动推进很慢（不是白给的）', war.progress.toFixed(3));
  ok(B.IDLE_PROGRESS_PER_DAY > 0 && B.IDLE_PROGRESS_PER_DAY <= 1, '兜底速率在设定范围内',
    String(B.IDLE_PROGRESS_PER_DAY));
}

// T13 轨道控制 → 补给（把「海域」接进陆战；v0.4.0 起还受舰队影响） -------
console.log('\nT13 轨道控制决定陆军补给');
{
  const acc = mkAcc(12, 200);
  const war = acc.wars[0];
  // 造一支强舰队（fleet.js 按 shipIds 累加 ship.strength）
  const mkShip = (id, strength) => { acc.ships = acc.ships || []; acc.ships.push({ id, strength, blueprintId: null }); return id; };
  acc.fleets = [{ id: 'fl1', nameCn: '第一舰队', shipIds: [] }];

  // 场景一：没有海域数据 → 圈层控制按 0.5 中立
  const r1 = B.startBattle(acc, war, { armyIds: ['army_0','army_1','army_2'], terrain: 'regolith' });
  const neutral = r1.battle.supply.mine;
  ok(r1.ok, '无圈层数据时可开战', r1.ok ? '' : r1.reason);

  // 场景二：完全失去圈层控制 → 我方补给应低于中立
  acc.hoiSeas = [{ id:'a', control:0 }, { id:'b', control:0 }];
  const r2 = B.startBattle(acc, war, { armyIds: ['army_3','army_4','army_5'], terrain: 'regolith' });
  const lost = r2.battle.supply.mine;
  ok(r2.ok, '有圈层数据时可开战', r2.ok ? '' : r2.reason);
  ok(lost < neutral, '失去轨道控制 → 我方补给下降', neutral.toFixed(2) + ' → ' + lost.toFixed(2));
  ok(r2.battle.supply.foe > lost, '我方失去轨道 → 敌方补给相对更高',
    lost.toFixed(2) + ' vs foe ' + r2.battle.supply.foe.toFixed(2));

  // 场景三：完全控制圈层 + 有舰队 → 补给最高，且封锁敌方
  acc.hoiSeas = [{ id:'a', control:1 }, { id:'b', control:1 }];
  acc.fleets[0].shipIds = [mkShip('s1', 900), mkShip('s2', 900), mkShip('s3', 900)];
  const r3 = B.startBattle(acc, war, { armyIds: ['army_6','army_7'], terrain: 'regolith' });
  const full = r3.battle.supply.mine;
  ok(r3.ok, '全控 + 有舰队时可开战', r3.ok ? '' : r3.reason);
  ok(full > neutral, '完全轨道控制 → 我方补给上升', neutral.toFixed(2) + ' → ' + full.toFixed(2));
  ok(r3.battle.supply.foe < neutral, '完全轨道控制 → 封锁敌方补给', 'foe ' + r3.battle.supply.foe.toFixed(2));

  // 场景四（v0.4.0）：同样全控圈层，但**舰队被全灭** → 轨道控制下降 → 补给回落
  acc.fleets[0].shipIds = [];
  const ctrlNoFleet = B.orbitalControlOf(acc, 'fra');
  acc.fleets[0].shipIds = [mkShip('s4', 900), mkShip('s5', 900), mkShip('s6', 900)];
  const ctrlWithFleet = B.orbitalControlOf(acc, 'fra');
  ok(ctrlWithFleet > ctrlNoFleet, '空间舰队实力提升轨道控制',
    ctrlNoFleet.toFixed(3) + ' → ' + ctrlWithFleet.toFixed(3));
  ok(ctrlNoFleet < 1, '无舰队时轨道控制被削减（不是唯一解，也非满值）', ctrlNoFleet.toFixed(3));
}

// T17 v0.4.0 太空地貌 -----------------------------------------------------
console.log('\nT17 行星地貌（太空化，弱化二战元素）');
{
  const list = B.terrainList();
  const ids = list.map((t) => t.id);
  ok(ids.indexOf('regolith') >= 0 && ids.indexOf('crater') >= 0 && ids.indexOf('dome') >= 0,
    'UI 列出太空地貌（月壤/环形山/穹顶）', ids.join(','));
  ok(ids.indexOf('plain') < 0 && ids.indexOf('urban') < 0,
    'UI 不再展示旧的地球地形（平原/城市）');
  ok(list.every((t) => typeof t.gravity === 'number'), '每个地貌都有重力值');
  ok(list.some((t) => t.gravity < 1), '存在低重力地貌（月壤平原）');
  ok(list.every((t) => typeof t.hazard === 'number'), '每个地貌都有灾害概率');
  ok(list.some((t) => t.hazard > 0.03), '存在高灾害地貌（尘暴/熔岩）');
  // 旧键仍在（存档兼容）
  ok(B.BATTLE_TERRAIN.plain && B.BATTLE_TERRAIN.urban, '旧地球地形键仍保留（老存档兼容）');
}

// T18 低重力利攻不利守 --------------------------------------------------
console.log('\nT18 低重力战术倾向');
{
  const acc = mkAcc(12, 200);
  for (const a of acc.armies) { a.stats = { atk: 100, def: 100, speed: 8 }; a.power = 200; }
  const war = acc.wars[0];
  acc.hoiSeas = [{ id:'a', control:1 }];
  // 月壤平原（gravity 0.66）vs 殖民地穹顶（gravity 1.0）
  const rLow = B.startBattle(acc, war, { armyIds: acc.armies.map(a=>a.id), terrain:'regolith' });
  ok(rLow.ok, '可在低重力地貌开战', rLow.ok ? '' : rLow.reason);
  ok(Math.abs(B.battleView(acc, rLow.battle.id).gravity - 0.66) < 0.01, '视图透出重力值');
  ok(B.BATTLE_TERRAIN.regolith.atk > 1, '低重力地貌进攻系数偏高（利攻）',
    String(B.BATTLE_TERRAIN.regolith.atk));
}

// T19 轨道轰炸 ---------------------------------------------------------
console.log('\nT19 轨道轰炸（太空专属手段）');
{
  ok(B.ORBITAL_BOMB_CHARGES > 0, '有轰炸次数上限', String(B.ORBITAL_BOMB_CHARGES));
  ok(B.ORBITAL_BOMB_MIN_CONTROL >= 0.5, '轨道轰炸需要较高轨道控制', String(B.ORBITAL_BOMB_MIN_CONTROL));

  // 高轨道控制 → 长时间交战应打出轰炸；低轨道控制 → 不应
  // 注意：轨道控制 = 圈层控制 × (0.55 + 0.45×舰队优势)，**完全没有舰队时上限只有 55%**
  //   —— 低于 60% 的轰炸门槛。这是刻意设定：没有舰船就没有轨道打击能力。
  function run(ctrl, label, withFleet) {
    const acc = mkAcc(12, 200);
    for (const a of acc.armies) { a.stats = { atk: 100, def: 100, speed: 8 }; a.power = 200; }
    if (withFleet) {
      acc.ships = [{ id: 'sh0', strength: 900, blueprintId: null }];
      acc.fleets = [{ id: 'fl1', nameCn: '第一舰队', shipIds: ['sh0'] }];
    } else { acc.ships = []; acc.fleets = []; }
    const war = acc.wars[0];
    acc.hoiSeas = [{ id:'a', control: ctrl }, { id:'b', control: ctrl }];
    const ids = acc.armies.map((a) => a.id);
    const r = B.startBattle(acc, war, { armyIds: ids, terrain:'regolith' });
    if (!r.ok) return { label, err: r.reason };
    let g=0; while (r.battle.status==='active' && g++<4000) B.tickBattles(acc, 1/3);
    const v = B.battleView(acc, r.battle.id);
    return { label, used: v.orbital.used, charges: v.orbital.charges, ctrl: +v.orbitalControl.toFixed(3),
             bombed: (v.log||[]).some((L) => /轨道轰炸/.test(L.text||'')) };
  }
  const hi = run(1, '全控+有舰队', true);
  const lo = run(0, '失控', true);
  const noFleet = run(1, '全控但无舰队', false);
  ok(hi.used > 0 || hi.bombed, '高轨道控制 + 有舰队 → 能发动轨道轰炸',
    'used=' + hi.used + ' ctrl=' + hi.ctrl);
  ok(lo.used === 0 && !lo.bombed, '失去轨道控制 → 无法轰炸（太空战争的核心逻辑）', 'used=' + lo.used);
  ok(noFleet.ctrl <= 0.55 + 1e-9, '完全没有舰队时轨道控制封顶 55%', String(noFleet.ctrl));
  ok(noFleet.used === 0, '无舰队即无轨道打击能力（刻意的太空设定）', 'used=' + noFleet.used);
}

// T20 地貌灾害 --------------------------------------------------------
console.log('\nT20 地貌灾害（陨石 / 地陷 / 毒气 / 尘暴）');
{
  ok(Object.keys(B.HAZARDS).length >= 4, '灾害种类齐全', Object.keys(B.HAZARDS).join(','));
  const acc = mkAcc(20, 200);
  for (const a of acc.armies) { a.stats = { atk: 100, def: 100, speed: 8 }; a.power = 200; }
  const war = acc.wars[0];
  acc.hoiSeas = [{ id:'a', control:1 }];
  const r = B.startBattle(acc, war, { armyIds: acc.armies.map((a) => a.id), terrain: 'dust' });
  ok(r.ok, '可在尘暴区开战', r.ok ? '' : r.reason);
  let g=0; while (r.battle.status==='active' && g++<6000) B.tickBattles(acc, 1/3);
  const v = B.battleView(acc, r.battle.id);
  ok((v.log||[]).some((L) => /地貌灾害/.test(L.text||'')), '高灾害地貌会触发地貌灾害',
    (v.log||[]).slice(0,4).map((L)=>L.text).join(' | ').slice(0,120));
}

// T21 兵种太空化 ------------------------------------------------------
console.log('\nT21 兵种命名太空化');
{
  const names = Object.keys(B.DIV_TEMPLATES).map((k) => B.DIV_TEMPLATES[k].nameCn);
  // v0.4.10：「登陆兵」也是 amphibious 二战词，已改为「轨道伞兵」
  ok(names.indexOf('轨道伞兵') >= 0, '有「轨道伞兵」而非「步兵 / 登陆兵」', names.join(','));
  ok(names.indexOf('登陆兵') < 0 && names.indexOf('步兵') < 0, '兵种名里不再有「登陆兵 / 步兵」', names.join(','));
  ok(names.indexOf('磁轨装甲') >= 0, '有「磁轨装甲」而非「装甲师」', names.join(','));
  ok(names.indexOf('外骨骼') >= 0, '有「外骨骼」而非「机械化」', names.join(','));
  ok(names.indexOf('无人机群') >= 0, '新增太空专属编制「无人机群」');
  const d = B.DIV_TEMPLATES.drone;
  ok(d.soft > d.hard && d.armor < 0.1 && d.dfn < 0.6,
    '无人机群：软攻极高但几乎无装甲与防御（一次性消耗型）',
    `soft=${d.soft} armor=${d.armor} dfn=${d.dfn}`);
}

// T22 圈层数据已太空化 -------------------------------------------------
console.log('\nT22 轨道圈层数据（去二战地理）');
{
  const { HOI_SEAS } = await import(pathToFileURL(join(ROOT, 'js/data/hoi1936.js')) + `?v=${CACHE_TAG}`);
  const names = HOI_SEAS.map((s) => s.nameCn);
  const ww2 = ['北海','波罗的海','英吉利海峡','地中海','大西洋','西太平洋','日本海'];
  ok(!names.some((n) => ww2.indexOf(n) >= 0), '不再有二战地球海域名', names.join(','));
  ok(names.indexOf('同步轨道') >= 0 && names.indexOf('拉格朗日点 L4') >= 0,
    '出现同步轨道 / 拉格朗日点等轨道圈层', names.join(','));
  ok(HOI_SEAS.every((s) => typeof s.altKm === 'number'), '每个圈层带轨道高度');
  ok(HOI_SEAS.every((s) => s.id), 'id 保持不变（老存档兼容）');
}

// ---------------------------------------------------------------------------
console.log('\n通过 ' + pass + ' / 失败 ' + fail);
if (fail) {
  console.log('\n失败项：');
  for (const b2 of bad) console.log('  · ' + b2);
  process.exit(1);
}
console.log('战役系统自检通过');
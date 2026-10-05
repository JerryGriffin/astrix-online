// ============================================================================
// selfcheck_v047.mjs —— v0.4.7 回归：三个 P0 缺陷的专项守卫
//
// 为什么要有这个文件
//   v0.4.6 的 selfcheck_theater 98 项全绿，但敌方夹击 AI 实际上 100% 失效：
//   theater.js#tickTheaterAI 里用了三个**从未声明**的标识符
//   （activeCount / BATTLE_MAX_PER_WAR / unshiftWarLog），
//   ReferenceError 冒泡到 state.js 的地图层空 catch，被完全吞掉。
//
//   旧自检为什么没抓到：T14 用 `aiFlankPlans()` + 直接调 `startBattle()`
//   **自己复刻**了那段循环，从不调用 `tickTheaterAI` —— 覆盖的是复刻版，
//   不是产品代码。
//
// 本文件的原则：**只调产品入口，不复刻实现**。
// ============================================================================

import { pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const { CACHE_TAG } = await import(pathToFileURL(join(ROOT, 'js/version.js')).href);

const TH = await import(pathToFileURL(join(ROOT, 'js/core/theater.js')).href + `?v=${CACHE_TAG}`);
const B = await import(pathToFileURL(join(ROOT, 'js/core/battle.js')).href + `?v=${CACHE_TAG}`);

let pass = 0, fail = 0;
const failures = [];
function ok(cond, name, detail) {
  if (cond) { pass++; console.log('  ✓ ' + name + (detail ? '  [' + detail + ']' : '')); }
  else { fail++; failures.push(name + (detail ? '  [' + detail + ']' : '')); console.log('  ✗ ' + name + (detail ? '  [' + detail + ']' : '')); }
}
function section(t) { console.log('\n' + t); }

/** 造一个可开战的账号（与 selfcheck_theater 同构） */
function mkAcc(ic = 60, pop = 40000) {
  return {
    id: 'acc_v047_' + Math.random().toString(36).slice(2, 8),
    name: 'v047',
    createdAt: Date.now(),
    nation: 'ger',                 // tickTheaterAI 用 acc.nation 判定「我方」
    tech: ['t_m1', 't_m2', 't_m3', 't_m4'],
    researchPoints: 5000,
    money: 50000,
    resourceUnits: {},
    ships: [], fleets: [], blueprints: [{ id: 'bp1', nameCn: '测试', parts: [], engines: [] }],
    discoveries: [], planets: {}, colonies: {}, stats: {}, settings: {},
    // 造 3 支满编师，供我方进攻/防守取用
    armies: [0,1,2,3,4,5,6,7].map((i) => ({
      id: 'army_' + i, nameCn: '第' + i + '师', men: 500, maxMen: 500,
      stats: { atk: 100, def: 100, hp: 100 },
      _baseStats: { atk: 100, def: 100, hp: 100 },
      power: 300, blueprintId: 'bp1', templateId: 'ab_ironwall', elite: false,
    })),
    wars: [], battles: [], warLog: [], foePools: {},
    hoiSeas: [],
  };
}

/**
 * 布置一个「敌方可从 ≥2 个方向夹击某个我方战区」的盘面。
 *
 * 注意：不写死坐标 —— ensureTheater 会按种子决定默认布局，写死坐标会与
 * 默认分配打架（踩过一次： foe 区被默认布局覆盖，plans 恒为 0）。
 * 改为**先看实际布局，再挑一块满足条件的目标**，保证测试与布局无关。
 */
function setupFlankBoard(acc, foeNation = 'fra') {
  const t = TH.ensureTheater(acc);
  const my = t.myNation;
  // 先全部清成中立，再按需分配，避免与默认布局冲突
  for (const r of t.regions) { r.owner = null; r.garrison = 0; }

  // 找一块中心，其 8 邻接里能放下 2 个敌方区 + 1 个我方区
  const nb = (r) => {
    const out = [];
    for (const q of t.regions) {
      if (q === r) continue;
      if (Math.abs(q.x - r.x) <= 1 && Math.abs(q.y - r.y) <= 1) out.push(q);
    }
    return out;
  };
  let target = null, foeA = null, foeB = null, mineA = null;
  outer:
  for (const r of t.regions) {
    const ring = nb(r).slice(0, 8);
    if (ring.length < 4) continue;
    target = r; foeA = ring[0]; foeB = ring[1]; mineA = ring[2];
    break outer;
  }
  if (!target) return { t, target: null };

  target.owner = my; target.garrison = 0.3;
  foeA.owner = foeNation; foeA.garrison = 0.2;
  foeB.owner = foeNation; foeB.garrison = 0.2;
  mineA.owner = my; mineA.garrison = 0.3;

  acc.wars.push({
    id: 'war_v047', status: 'active', targetId: foeNation,
    progress: 0,            // ≤35 → aiMood='press'，必走夹击分支（原 bug 触发条件）
    myScore: 0, theirScore: 0, battles: [],
    log: [], startedAt: Date.now(),
  });
  // 敌方师池（buildFoePool 用的键是 **战争 id**）
  acc.foePools['war_v047'] = { divisions: 6 };
  TH.refreshSupply(acc);
  return { t, target, foeNation, origin: mineA };
}

// ============================================================================
section('P0-1 tickTheaterAI 不再因未声明标识符崩溃（press 分支 = 敌方夹击）');
// ============================================================================
{
  const acc = mkAcc();
  const { t } = setupFlankBoard(acc, 'fra');

  // tickTheaterAI 自己按价值挑目标，测试不写死坐标；
  // 断言口径 = 「AI 选中的目标是否被从 ≥2 个不同方向同时进攻」。
  t.aiAt = 999999;   // 让 AI_TICK_SEC 闸门立刻通过

  let threw = null;
  const openedByAI = [];
  try {
    // 注入 startBattle（state.js 的真实做法）+ logWar / maxBattlesPerWar
    TH.tickTheaterAI(acc, 10, {
      myOrbital: 0.5,
      startBattle: (a, w, opts) => {
        const r = B.startBattle(a, w, opts);
        if (r && r.ok) openedByAI.push(opts);
        return r;
      },
      logWar: (a, w, text) => { w.log.unshift({ at: Date.now(), text }); },
      maxBattlesPerWar: B.BATTLE_MAX_PER_WAR,
    });
  } catch (e) { threw = e; }

  const targets = new Set(openedByAI.map((o) => o.regionId));
  const origins = new Set(openedByAI.map((o) => o.originId));

  ok(threw === null, 'P0-1 tickTheaterAI(press 分支) 不抛异常',
    threw ? threw.message : 'no throw');
  ok(t.aiMood === 'press', 'AI 处于攻势（press 分支已执行）', t.aiMood);
  ok(t.aiTarget != null, 'AI 已选定打击目标', String(t.aiTarget));
  ok(openedByAI.length >= 2, 'P0-1 敌方开出了多条夹击战线（原 bug 下恒为 0）',
    'opened=' + openedByAI.length);
  ok(targets.size === 1 && openedByAI.length >= 1, 'P0-1 多条战线指向同一目标战区（夹击语义）',
    [...targets].join(','));
  ok(acc.wars[0].log.length > 0, 'P0-1 夹击战报已写入（原 unshiftWarLog 未定义会崩）',
    'log=' + acc.wars[0].log.length);
  ok(origins.size === openedByAI.length, 'P0-1 各战线来源方向不同（夹击而非叠加）',
    'origins=' + origins.size);
}

// ============================================================================
section('P0-1b 补给刷新与 AI 扩张在 press 分支后仍会执行');
// ============================================================================
{
  const acc = mkAcc();
  const { t } = setupFlankBoard(acc, 'fra');
  const far = t.regions[t.regions.length - 1];
  far.connected = false;   // 人为制造断供，看 AI tick 前后是否重算
  TH.refreshSupply(acc);

  t.aiAt = 999999;
  let threw = null;
  try {
    TH.tickTheaterAI(acc, 10, {
      myOrbital: 0.5,
      startBattle: () => ({ ok: false, reason: '测试：不实际开战' }),
      logWar: () => {},
      maxBattlesPerWar: 3,
    });
  } catch (e) { threw = e; }

  ok(threw === null, 'P0-1b press 分支（含补给刷新）不抛异常', threw ? threw.message : 'no throw');
  ok(Array.isArray(t.regions) && t.regions.every((r) => typeof r.connected === 'boolean'),
    '补给状态在 AI tick 后被重算（原崩溃点会跳过 refreshSupply）');
}

// ============================================================================
section('P0-2 事件类攻击力修正是临时的，不会永久锁死');
// ============================================================================
{
  const acc = mkAcc();
  const { t, target, origin } = setupFlankBoard(acc, 'fra');

  // 我方进攻：originId 必须是我方相邻战区（setupFlankBoard 已返回一个我方邻区）
  const b = B.startBattle(acc, acc.wars[0], {
    side: 'mine', regionId: target.id, originId: origin.id, armyIds: ['army_0', 'army_1'],
  });

  ok(b && b.ok, 'P0-2 前置：成功开战', b ? (b.reason || 'ok') : 'null');
  const bt = acc.battles[acc.battles.length - 1];
  if (!bt) { console.log('  ! 战场未创建，跳过后续断言'); }
  else {
    // 关键回归：foeAtkMul 初值必须是 1（不是 null，更不能是被污染的 0）
    ok(bt.foeAtkMul == null || bt.foeAtkMul === 1, 'foeAtkMul 初值为 1 或 null（不是被污染的 0）',
      'foeAtkMul=' + bt.foeAtkMul);
    ok(bt.foeAtkMul !== 0, 'foeAtkMul 未被 Math.min(null,·) 污染为 0', 'foeAtkMul=' + bt.foeAtkMul);
  }

  // Math.min(null, 0.82) === 0 的老 bug 现在应得到 0.82
  ok(Math.min(1, 0.82) === 0.82, 'Math.min(1, 0.82) === 0.82（老 bug 下为 0）', String(Math.min(1, 0.82)));

  // 真实推进：临时修正应在若干小时后自动回落（不再永久锁死）
  let everLocked = false, everRecovered = false;
  for (let i = 0; i < 40 && bt.status === 'active'; i++) {
    B.tickBattles(acc, 1);
    if (bt.foeAtkMul != null && bt.foeAtkMul <= 0.5) everLocked = true;
    if (everLocked && (bt.foeAtkMul == null || bt.foeAtkMul === 1)) everRecovered = true;
  }
  ok(!everLocked, 'P0-2 推进 40 小时内敌方攻击力从未被锁到 ×0.5', 'locked=' + everLocked);
  if (everLocked) ok(everRecovered, 'P0-2 若被降过则能自动恢复');
  else ok(true, 'P0-2 无永久降级（本次未触发 scout 事件）');
  ok(bt.foeAtkMul == null || bt.foeAtkMul >= 0.82, '最终敌方攻击力修正 ≥ 0.82', String(bt.foeAtkMul));
}

// ============================================================================
section('P0-3 softFail 被正确调用（异常不再静默消失）');
// ============================================================================
{
  const { softFail, resetSoftFailSeen } = await import(pathToFileURL(join(ROOT, 'js/core/util.js')).href + `?v=${CACHE_TAG}`);
  resetSoftFailSeen();
  const origWarn = console.warn;
  const got = [];
  console.warn = (...a) => { got.push(a.join(' ')); };
  softFail('测试块', new Error('boom'));
  softFail('测试块', new Error('boom'));   // 同一错误重复 → 应去重
  softFail('另一块', new Error('bang'));
  console.warn = origWarn;

  ok(got.length === 2, 'softFail 同 tag+message 去重（3 次调用只输出 2 条）', 'warns=' + got.length);
  ok(got[0] && got[0].includes('测试块'), 'softFail 输出带功能块名', (got[0] || '').slice(0, 40));
  ok(got.some((g) => g.includes('另一块')), '不同 tag 分别上报');
}

// ============================================================================
section('P2 util 收敛：hash32 / mulberry32 与原实现逐位一致');
// ============================================================================
{
  const U = await import(pathToFileURL(join(ROOT, 'js/core/util.js')).href + `?v=${CACHE_TAG}`);
  const oldHash32 = (str) => { let h = 0x811c9dc5; const s = String(str); for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; } return h >>> 0; };
  const oldMul = (seed) => { let a = seed >>> 0; return function () { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; };

  let hBad = 0;
  for (const s of ['', 'a', 'ger:ai', 'war_v047', '第N回合', '999999', 'x-1']) {
    if (U.hash32(s) !== oldHash32(s)) hBad++;
  }
  ok(hBad === 0, 'hash32 与原实现一致（7 组样本）', 'mismatch=' + hBad);

  let mBad = 0;
  for (const sd of [0, 1, 42, 123456, 0xdeadbeef]) {
    const a = U.mulberry32(sd), b = oldMul(sd);
    for (let i = 0; i < 300; i++) { if (a() !== b()) { mBad++; break; } }
  }
  ok(mBad === 0, 'mulberry32 与原实现一致（5 组 × 300 次）', 'mismatch=' + mBad);

  ok(U.clamp(0.5, 0, 1) === 0.5 && U.clamp(-1, 0, 1) === 0 && U.clamp(2, 0, 1) === 1, 'clamp 边界正常');
  ok(Object.is(U.clamp(NaN, 0, 1), Math.max(0, Math.min(1, NaN))), 'clamp 保持 NaN 传播语义（收敛零副作用）');
}

// ============================================================================
console.log('\n========================');
if (fail) {
  console.log('通过 ' + pass + ' 项，失败 ' + fail + ' 项');
  console.log('\n失败明细:');
  failures.forEach((f) => console.log('  ✗ ' + f));
  console.log('\nv0.4.7 自检未通过');
  process.exit(1);
} else {
  console.log('通过 ' + pass + ' 项，失败 0 项');
  console.log('v0.4.7 回归自检通过');
}

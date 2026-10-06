// 1936 剧本核心（v0.2.6）：国策 / 海域 / 编制与舰队 / 生产线铺设 / 剧本日历
//
// 设计者要求（对应实现）：
//   * 德国人力 80000，其他国家按真实人口比例放缩        → popOf()
//   * 每国侧重不同的生产线、独特装备流水线              → setupLines()
//   * 一支军队 500 人 + 各国自己的编制                  → setupArmies()
//   * 舰队实力按 1936 真实海军实力算、舰队名同史实      → setupNavy()
//   * 德意同盟（阵营）                                  → bloc 与 setupBloc()
//   * 游玩时显示时间到天                                → scenarioDateOf()
//   * HOI4 风格国策（三支六策，按天推进）               → focus 系列
//   * 海域（制海权争夺 + 海战）                          → sea 系列
import { HOI_NATIONS, HOI_BY_ID, HOI_MAIN_NATIONS, HOI_MAIN_BY_ID, HOI_DEEP, HOI_SEAS, ARMY_MEN, popOf, BLOC_NAME, HOI_SCENARIO_ID,
  workforceOf, ARMY_POWER_PER_DIV, WORKFORCE_PER_IC, NAVY_MUL, GEAR_PARTS, SHIP_NAMES, ARMY_BP_NAME, HOI_BG, SHIP_CLASSES, POST_WAR_OPTIONS, GER_PUPPETS, ARMY_BP_LINE, warshipTonnageOf, WAR_LINE, EXTRA_FOCUS_TEMPLATE, JUSTIFY_DAYS, NATION_SEA_REGION, SEA_INITIAL_CONTROL, NAVAL_INVASION_CONTROL,
  // v0.3.3：历史事件时间表（「战争按历史来，不要随便乱宣战」）
  HIST_TIMELINE, histEventsAt, histWarBetween, histWarTargetsFor } from '../data/hoi1936.js?v=54.5';
import { BUILDING_BY_ID } from '../data/buildings.js?v=54.5';
import { ARMY_BP_BY_ID, ARMY_BLUEPRINTS } from '../data/army_parts.js?v=54.5';
import { JOBS_BY_BUILDING, assignWorkers, jobCapacity, getAvailable } from './population.js?v=54.5';
import { ELITE_DIVISIONS, ELITE_MUL } from '../data/hoi1936.js?v=54.5';
// v0.3.3：战争槽位上限（与 core/war.js 同源；war.js 不 import 本文件，无循环依赖）
import { WAR_MAX_ACTIVE } from './war.js?v=54.5';
// v0.3.4：战役系统（敌方主动进攻 + 战线管理）。battle.js 不 import 本文件，无循环依赖。
import { startBattle, listBattles, BATTLE_MAX_PER_WAR, IDLE_PROGRESS_PER_DAY, SPACE_TERRAIN_IDS } from './battle.js?v=54.5';

// 依赖注入（避免与 state.js / production.js 形成循环导入）
let _getInst = null;
let _addLine = null;
let _lineWorkers = null;
export function setHoiDeps(deps) {
  if (deps && typeof deps.getInst === 'function') _getInst = deps.getInst;
  if (deps && typeof deps.addLine === 'function') _addLine = deps.addLine;
  if (deps && typeof deps.lineWorkers === 'function') _lineWorkers = deps.lineWorkers;
}

// ============================================================================
// v0.4.9：剧本适配层（scenario adapter）
//
// 为什么需要这一层
//   本文件原本把数据源写死成 1936：`fociOf` 查 `HOI_DEEP[n]`、`ensureSeas` 遍历
//   `HOI_SEAS`、`ensureFocus`… 全部直接引用 1936 的表。机制（国策树 / 阵营 /
//   轨道圈层 / 正当化 / 战役）本身是通用的，不该被单个剧本的数据绑死。
//
//   现在：所有数据读取都经由 `S(acc)` 拿到的适配器，按 acc.scenario 路由到
//   对应剧本的表。**1936 的行为逐字不变**（适配器在 hoi1936 时原样返回旧表），
//   而科幻剧本（data/scenario_sci.js）可以复用同一套机制。
//
//   新增剧本只需在 scenarioAdapterOf() 里加一个分支。
// ============================================================================
import {
  SCI_SCENARIO_ID, SCI_NATIONS, SCI_BY_ID, SCI_MAIN_NATIONS, SCI_MAIN_BY_ID, SCI_DEEP,
  SCI_SEAS, SCI_SEA_INITIAL_CONTROL, SCI_SEA_RIVAL, SCI_SEA_REGIONS, SCI_BLOC_NAME, SCI_BG, SCI_TIMELINE,
  SCI_ARMY_BP_NAME, SCI_SHIP_NAMES, SCI_SHIP_CLASSES, SCI_POST_WAR_OPTIONS,
  SCI_ARMY_BP_LINE, SCI_ELITE_DIVISIONS, SCI_ELITE_MUL, SCI_NAVY_MUL,
  SCI_WORKFORCE_PER_IC, SCI_POWER_PER_DIV, sciPopOf, sciWorkforceOf,
} from '../data/scenario_sci.js?v=54.5';

function hoiAdapter() {
  return {
    id: HOI_SCENARIO_ID,
    nations: HOI_NATIONS,
    byId: HOI_BY_ID,
    main: HOI_MAIN_NATIONS,
    mainById: HOI_MAIN_BY_ID,
    deep: HOI_DEEP,
    seas: HOI_SEAS,
    seaInit: SEA_INITIAL_CONTROL,
    // v0.4.9：seaRivals() 靠「哪国能在哪个区域竞争」这张表算 AI 巡航压力，
    //   原来固定用 NATION_SEA_REGION（1936 的地球海区划分）——
    //   科幻剧本的势力没有这张表，需要自己提供（见 sciAdapter 的 seaRegions）。
    seaRegions: NATION_SEA_REGION,
    blocName: BLOC_NAME,
    bg: HOI_BG,
    timeline: HIST_TIMELINE,
    eliteDivisions: ELITE_DIVISIONS,
    eliteMul: ELITE_MUL,
    navyMul: NAVY_MUL,
    armyBpName: ARMY_BP_NAME,
    shipNames: SHIP_NAMES,
    shipClasses: SHIP_CLASSES,
    postWarOptions: POST_WAR_OPTIONS,
    armyBpLine: ARMY_BP_LINE,
    workforcePerIc: WORKFORCE_PER_IC,
    powerPerDiv: ARMY_POWER_PER_DIV,
    popOf,
    workforceOf,
    // 1936 特有：按剧本时间线门控宣战
    histGate: true,
  };
}

function sciAdapter() {
  return {
    id: SCI_SCENARIO_ID,
    nations: SCI_NATIONS,
    byId: SCI_BY_ID,
    main: SCI_MAIN_NATIONS,
    mainById: SCI_MAIN_BY_ID,
    deep: SCI_DEEP,
    seas: SCI_SEAS,
    seaInit: SCI_SEA_INITIAL_CONTROL,
    // 科幻剧本的圈层竞争关系：直接用 SCI_SEA_RIVAL（圈层 → 竞争势力 id 列表），
    //   语义与 1936 的「按 region 反查」不同，因此额外提供 seaRivalBySea，
    //   seaRivals() 会优先读它。
    seaRegions: SCI_SEA_REGIONS,
    seaRivalBySea: SCI_SEA_RIVAL,
    blocName: SCI_BLOC_NAME,
    bg: SCI_BG,
    timeline: SCI_TIMELINE,
    eliteDivisions: SCI_ELITE_DIVISIONS,
    eliteMul: SCI_ELITE_MUL,
    navyMul: SCI_NAVY_MUL,
    armyBpName: SCI_ARMY_BP_NAME,
    shipNames: SCI_SHIP_NAMES,
    shipClasses: SCI_SHIP_CLASSES,
    postWarOptions: SCI_POST_WAR_OPTIONS,
    armyBpLine: SCI_ARMY_BP_LINE,
    workforcePerIc: SCI_WORKFORCE_PER_IC,
    powerPerDiv: SCI_POWER_PER_DIV,
    popOf: sciPopOf,
    workforceOf: sciWorkforceOf,
    histGate: false,   // 科幻剧本不按史实年份门控宣战
  };
}

/** 取账号所属剧本的适配器（无 scenario / 未知值 → 科幻，普通开局即走这条） */
export function scenarioAdapterOf(acc) {
  const s = acc && acc.scenario ? String(acc.scenario) : '';
  return s === HOI_SCENARIO_ID ? hoiAdapter() : sciAdapter();
}

/**
 * 只有一个「势力 id」、没有 acc 时的适配器选择（如 setupLines(inst, nation)）。
 * 按 id 前缀判定 —— 两套剧本的 id 天然隔离（'sci_*' vs 'ger'/'fra'…），
 * 前缀约定见 data/scenario_sci.js 顶部说明。
 */
export function adapterOfNation(nationOrId) {
  const id = typeof nationOrId === 'string' ? nationOrId
    : (nationOrId && nationOrId.id) || '';
  return String(id).indexOf('sci_') === 0 ? sciAdapter() : hoiAdapter();
}

/** 直接取科幻适配器（state.js 建档时用；等价于 scenarioAdapterOf({scenario:'scifi'})） */
export function sciAdapterOf() { return sciAdapter(); }
/** 直接取 1936 适配器 */
export function hoiAdapterOf() { return hoiAdapter(); }

// ============================================================================
// 剧本日历：1 真实秒 = 1 游戏天；起点固定 1936-01-01
// ============================================================================
export const SCENARIO_EPOCH = Date.UTC(1936, 0, 1);
export const GAME_DAYS_PER_SEC = 1;

export function gameDaysOf(acc) {
  if (!acc || !acc.scenarioStartedAt) return 0;
  return Math.max(0, ((Date.now() - acc.scenarioStartedAt) / 1000) * GAME_DAYS_PER_SEC);
}

/** 「1936年3月14日」 */
export function scenarioDateOf(acc) {
  const d = new Date(SCENARIO_EPOCH + Math.floor(gameDaysOf(acc)) * 86400000);
  return d.getUTCFullYear() + '年' + (d.getUTCMonth() + 1) + '月' + d.getUTCDate() + '日';
}

// ============================================================================
// 国策（HOI4 风格）：每国三支（工业 / 军事 / 外交）共六策，按游戏天数推进
//   acc.hoiFocus = { current: {id, progressDays, needDays} | null, done: [id...], buffs: {...} }
// ============================================================================
export function ensureFocus(acc) {
  if (!acc) return null;
  if (!acc.hoiFocus || typeof acc.hoiFocus !== 'object') {
    acc.hoiFocus = { current: null, done: [], buffs: { atkMul: 1, defMul: 1, lineMul: 1 } };
  }
  const f = acc.hoiFocus;
  if (!Array.isArray(f.done)) f.done = [];
  if (!f.buffs) f.buffs = { atkMul: 1, defMul: 1, lineMul: 1, justifyMul: 1 };
  if (f.buffs.atkMul == null) f.buffs.atkMul = 1;
  if (f.buffs.defMul == null) f.buffs.defMul = 1;
  if (f.buffs.lineMul == null) f.buffs.lineMul = 1;
  if (f.buffs.justifyMul == null) f.buffs.justifyMul = 1;
  return f;
}

/**
 * 国策总表（v0.3.0 扩充）：本国策 + 通用扩策（+3）+ 德国战争线（+4）
 */
export function fociOf(acc) {
  const n = acc && acc.nation;
  // v0.4.9：数据源按剧本路由（1936 → HOI_DEEP；科幻 → SCI_DEEP）
  const A = scenarioAdapterOf(acc);
  const deep = A.deep[n];
  if (!deep) return [];
  const base = (deep.foci || []).slice();
  const extras = EXTRA_FOCUS_TEMPLATE.map((t) => Object.assign({}, t, { id: n + t.suffix }));
  // 战争线只有 1936 有（它是史实事件链：莱茵兰/奥地利/但泽…）；
  // 科幻剧本的「战争」通过 SCI_TIMELINE 的局势转折 + 战区地图推进，不走这条线。
  const war = A.histGate ? ((WAR_LINE[n] || []).slice()) : [];
  return base.concat(extras, war);
}

export function focusOptionsOf(acc) {
  const A = scenarioAdapterOf(acc);
  const deep = A.deep[acc && acc.nation];
  if (!deep) return [];
  const f = ensureFocus(acc);
  const all = fociOf(acc);
  const byBranch = {};
  for (const x of all) (byBranch[x.branch] = byBranch[x.branch] || []).push(x);
  return all.map((x) => {
    const done = f.done.indexOf(x.id) >= 0;
    const list = byBranch[x.branch] || [];
    const idx = list.findIndex((y) => y.id === x.id);
    const prev = idx > 0 ? list[idx - 1] : null;
    let locked = null;
    // 规则 1：同支按序推进（后一策需前一策完成）
    if (!done && prev && f.done.indexOf(prev.id) < 0) locked = '需先完成同支国策「' + prev.nameCn + '」';
    // 规则 2：外交线互斥（选了一策后，同支另一策永久锁定）
    if (!done && !locked && x.branch === '外交') {
      const other = list.find((y) => y.id !== x.id && f.done.indexOf(y.id) >= 0);
      if (other) locked = '与已完成的「' + other.nameCn + '」互斥';
    }
    return Object.assign({ done: done, locked: locked, branchIdx: idx }, x);
  });
}

export function startFocus(acc, focusId) {
  const deep = scenarioAdapterOf(acc).deep[acc && acc.nation];
  if (!deep) return { ok: false, reason: '该势力没有国策数据' };
  const f = ensureFocus(acc);
  if (f.current) return { ok: false, reason: '已有国策正在推进（' + f.current.nameCn + '）' };
  const def = fociOf(acc).find((x) => x.id === focusId);
  if (!def) return { ok: false, reason: '找不到该策' };
  if (f.done.indexOf(focusId) >= 0) return { ok: false, reason: '该策已完成' };
  const opt = focusOptionsOf(acc).find((x) => x.id === focusId);
  if (opt && opt.locked) return { ok: false, reason: opt.locked };
  f.current = { id: def.id, nameCn: def.nameCn, progressDays: 0, needDays: def.days, branch: def.branch };
  return { ok: true, current: f.current, def };
}

/** 每秒调用：推进国策进度（按游戏天数），完成时结算效果 */
export function tickFocus(acc, dtSec) {
  const f = ensureFocus(acc);
  if (!f || !f.current) return null;
  f.current.progressDays += Math.max(0, Number(dtSec) || 0) * GAME_DAYS_PER_SEC;
  if (f.current.progressDays < f.current.needDays) return null;
  const def = fociOf(acc).find((x) => x.id === f.current.id);
  const doneId = f.current.id;
  f.done.push(doneId);
  const finished = f.current;
  f.current = null;
  applyFocusEffect(acc, def ? def.effect : null);
  return { id: doneId, nameCn: finished.nameCn, def };
}

/** 国策效果结算 */
function applyFocusEffect(acc, eff) {
  if (!acc || !eff) return;
  const f = ensureFocus(acc);
  const b = f.buffs;
  if (eff.research) acc.researchPoints = (Number(acc.researchPoints) || 0) + eff.research;
  if (eff.pop) {
    try {
      const P = getHomeInstLocal(acc);
      if (P && P.pop) P.pop.total = (Number(P.pop.total) || 0) + eff.pop;
    } catch (e) { /* 忽略 */ }
  }
  if (eff.armyAtkMul) b.atkMul *= eff.armyAtkMul;
  if (eff.armyDefMul) b.defMul *= eff.armyDefMul;
  if (eff.lineMul) b.lineMul *= eff.lineMul;
  if (eff.allyBloc && eff.allyBloc === (A.deep[acc.nation] || {}).bloc) {
    // 强化同阵营（盟友在开局已建立，这里只作为外交进度）
  }
  if (eff.navy) addNavyShips(acc, eff.navy);
  if (eff.justifyMul) b.justifyMul = (b.justifyMul || 1) * eff.justifyMul;
  if (eff.justifyAgainst) { try { startJustify(acc, eff.justifyAgainst); } catch (e) { /* 忽略 */ } }
}

// ============================================================================
// 海域：制海权争夺（HOI4 风格海域）—— 巡逻舰队 vs 敌方海上压力
//   acc.hoiSeas = [{ id, nameCn, control (0~1 我方), lastResult }]
// ============================================================================
export function ensureSeas(acc) {
  if (!acc) return [];
  if (!Array.isArray(acc.hoiSeas) || !acc.hoiSeas.length) {
    const A0 = scenarioAdapterOf(acc);
    acc.hoiSeas = A0.seas.map((s) => {
      const init = (A0.seaInit[s.id] || {});
      const mine = Number(init[acc.nation]) || 0;    // 本国开局既有制海权（英国控制英吉利海峡）
      const best = Object.keys(init).reduce((m, k) => Math.max(m, Number(init[k]) || 0), 0);
      return {
        id: s.id, nameCn: s.nameCn, base: s.base, region: s.region,
        control: mine || (best > 0 ? Math.max(0.05, 0.35 - best * 0.3) : 0.5),
        aiMax: best,
        lastResult: null,
      };
    });
  }
  return acc.hoiSeas;
}

/** 该势力能否在该圈层行动（v0.4.9：范围表按剧本路由） */
export function canSailIn(acc, seaId) {
  const A = scenarioAdapterOf(acc);
  const sea = A.seas.find((x) => x.id === seaId);
  if (!sea) return false;
  const regions = A.seaRegions[acc && acc.nation] || [];
  return regions.indexOf(sea.region) >= 0;
}

/** 该圈层里「非我方、非盟友」势力的实力（AI 巡航压力） */
export function seaRivals(acc, seaId) {
  const A = scenarioAdapterOf(acc);
  const sea = A.seas.find((x) => x.id === seaId);
  if (!sea) return 0;
  const allied = Array.isArray(acc.npcAllies) ? acc.npcAllies : [];
  let sum = 0;
  for (const n of A.nations) {
    if (n.id === acc.nation) continue;
    if (allied.indexOf(n.nameCn) >= 0) continue;
    if ((A.seaRegions[n.id] || []).indexOf(sea.region) < 0) continue;
    const init = ((A.seaInit[seaId] || {})[n.id]) || 0;
    sum += (n.navy * 20 + n.ic * 3) * (1 + init);
  }
  return sum;
}

/** 投送门槛：跨战区投送兵力需该战区轨道控制 ≥ NAVAL_INVASION_CONTROL */
export function canInvadeFrom(acc, seaId) {
  const sea = ensureSeas(acc).find((x) => x.id === seaId);
  if (!sea) return { ok: true };
  if (sea.control >= NAVAL_INVASION_CONTROL) return { ok: true, control: sea.control };
  return { ok: false, reason: '投送需要该战区轨道控制 ≥ ' + Math.round(NAVAL_INVASION_CONTROL * 100) + '%（' + sea.nameCn + ' 当前 ' + Math.round(sea.control * 100) + '%）' };
}

/** 敌方海上压力：与我方交战国家（含阵营）的海军实力合计 */
export function enemySeaPressure(acc) {
  const A = scenarioAdapterOf(acc);
  const wars = Array.isArray(acc.wars) ? acc.wars.filter((w) => w && w.status === 'active') : [];
  let pressure = 0;
  for (const w of wars) {
    const id = String(w.targetId || '').replace(/^hoi_/, '');
    const n = A.byId[id] || A.nations.find((x) => x.nameCn === w.targetName);
    if (n) pressure += n.navy * 18 + n.ic * 4;
  }
  return pressure;
}

/** 派舰队争夺海域：myNavyStr 为参战舰队战力 */
export function contestSea(acc, seaId, myNavyStr) {
  const seas = ensureSeas(acc);
  const sea = seas.find((s) => s.id === seaId);
  if (!sea) return { ok: false, reason: '未知海域' };
  if (!canSailIn(acc, seaId)) {
    return { ok: false, reason: '本国舰队无法进入该轨道圈层（该圈层不属于本国作战区域）' };
  }
  const mine = Math.max(0, Number(myNavyStr) || 0);
  // v0.3.1：敌方压力 = 该海域内竞争国家（含 AI 巡航）的实力 + 其既有制海权
  const foe = (seaRivals(acc, seaId) + (Number(sea.aiMax) || 0) * 300) * (0.6 + Math.random() * 0.5);
  const ratio = mine / Math.max(1, mine + foe);
  // 制海权向战果比例靠拢（每轮推进 30%）
  sea.control = Math.max(0, Math.min(1, sea.control + (ratio - sea.control) * 0.3));
  const win = ratio >= 0.5;
  const sunk = win ? 0 : Math.max(1, Math.round((1 - ratio) * 3));
  sea.lastResult = {
    at: Date.now(), win, mine: Math.round(mine), foe: Math.round(foe),
    control: Math.round(sea.control * 100), sunk,
  };
  return {
    ok: true, win, control: sea.control, mine: Math.round(mine), foe: Math.round(foe), sunk,
    logs: [
      (win ? '我方' : '敌方') + '掌握轨道主动（我方舰队战力 ' + Math.round(mine) + ' vs 敌方 ' + Math.round(foe) + '）',
      '轨道控制 → ' + Math.round(sea.control * 100) + '%',
      win ? '敌方护航编队被驱离轨道' : '我方损失 ' + sunk + ' 艘舰艇',
    ],
  };
}

// ============================================================================
// 开局铺设：编制军队 / 历史舰队 / 侧重生产线 / 独特装备线 / 阵营
// ============================================================================
function getHomeInstLocal(acc) {
  try { return _getInst ? _getInst(acc.homePlanetCode) : null; } catch (e) { return null; }
}

/** 军队：每支 500 人，按本国编制与侧重生成 */
export function setupArmies(acc, nation) {
  const A = scenarioAdapterOf(acc);
  const n = typeof nation === 'string' ? A.byId[nation] : nation;
  if (!n) return { armies: [], blueprintId: null };
  const deep = A.deep[n.id] || {};
  // v0.2.6 rev3：**师数 = 1936 年真实师数**（德国 30 / 苏联 92 / 中国 120 …），每师 500 人
  const count = Math.max(2, Math.min(130, Math.round(n.divisions)));
  // v0.2.6 rev8：高工业国家师级战力增强（工业越高，师装备越精良）
  const perPower = Math.round(ARMY_POWER_PER_DIV * (1 + Math.min(1.2, n.ic / 120)));
  acc.armies = [];
  // v0.2.6 rev9：军队蓝图更多 —— 步兵 / 装甲 / 机械化 三类轮转
  const bpLine = A.armyBpLine[n.id] || [deep.armyName || '步兵师'];
  acc.hoiArmyBps = bpLine;
  for (let i = 0; i < count; i++) {
    const bpName = bpLine[i % bpLine.length];
    // v0.2.9：按兵种给战力 —— 第 3 类（装甲/突击编制）大幅增强
    // v0.4.5（需求 6）：兵种槽位倍率 —— 装甲/突击编制大幅加强（原 1.0 / 1.15 / 1.5）。
//   装甲师与突击编制是**突破敌方防线**的主力，给到 1.0 / 1.5 / 2.4：
//   第 3 张（装甲/突击）单独就能压制普通步兵编制，配合硬攻/装甲/穿甲形成明确分工。
const SLOT_POWER_MUL = [1.0, 1.5, 2.4];
    const slotMul = SLOT_POWER_MUL[i % 3] || 1;
    acc.armies.push({
      id: 'army_' + n.id + '_' + i,
      nameCn: n.nameCn + ' 第' + (i + 1) + ' ' + bpName,
      blueprintId: 'ab_ranger',
      bpNameCn: bpName,
      men: ARMY_MEN,
      exp: 0, bonusAtk: 0, bonusDef: 0,
      stats: {
        atk: Math.round(perPower * (deep.atkMul || 1) * slotMul),
        def: Math.round(perPower * (deep.defMul || 1) * slotMul),
        speed: 8,
      },
      power: Math.round(perPower * ((deep.atkMul || 1) + (deep.defMul || 1)) / 2 * slotMul),
    });
  }
  // v0.2.9：军队蓝图历史化 —— 该国的三张兵种蓝图改名为本国史实名，
  //   并给「装甲师」等突击编制更高的基础战力（大幅增强）
  try {
    const bpLine0 = A.armyBpLine[n.id] || [];
    // 用蓝图表的实际顺序（避免硬编码 id 与实际数据不符）
    const BP_IDS = (ARMY_BLUEPRINTS || []).map((b) => b && b.id).filter(Boolean);
    if (!BP_IDS.length) BP_IDS.push('ab_ranger', 'ab_bulwark', 'ab_thunder');
    const POWER_MUL_BY_SLOT = SLOT_POWER_MUL;   // 第二/第三张（装甲/机械化和突击编制）更强
    for (let i = 0; i < Math.min(3, BP_IDS.length); i++) {
      const bp = ARMY_BP_BY_ID[BP_IDS[i]];
      if (!bp) continue;
      if (bpLine0[i]) bp.nameCn = bpLine0[i];
      bp.men = ARMY_MEN;
      bp.hoiPowerMul = POWER_MUL_BY_SLOT[i] || 1;
    }
    acc.hoiArmyBps = bpLine0;
  } catch (e) { /* 忽略 */ }

  // v0.2.6 rev5：王牌师（史实名，战力与属性显著更强）
  const elites = A.eliteDivisions[n.id] || [];
  for (let i = 0; i < elites.length && i < acc.armies.length; i++) {
    const a = acc.armies[i];
    a.nameCn = elites[i] + '（王牌师）';
    a.elite = true;
    a.power = Math.round(a.power * ELITE_MUL);
    a.stats = {
      atk: Math.round(a.stats.atk * ELITE_MUL),
      def: Math.round(a.stats.def * ELITE_MUL),
      speed: a.stats.speed,
    };
  }
  // v0.2.6 rev3：师蓝图历史化（如德国「装甲师（1936 编制）」）
  if (A.armyBpName[n.id] && Array.isArray(acc.blueprints) && acc.blueprints.length) {
    try { acc.blueprints[0].nameCn = A.armyBpName[n.id]; acc.blueprint = acc.blueprints[0]; } catch (e) { /* 忽略 */ }
  }
  return acc.armies.length;
}

// ---------------------------------------------------------------------------
// 工业建筑群（v0.2.6 rev3）：按国家工业与人口规模铺开大量建筑，
//   为「生产线大量工人」提供工位（工位 = 建筑数 × 该建筑 jobs）
// ---------------------------------------------------------------------------
export function setupFactories(inst, nation) {
  const A = adapterOfNation(nation);
  const n = typeof nation === 'string' ? A.byId[nation] : nation;
  if (!n) return 0;
  if (!inst) return 0;
  const ic = n.ic;
  // 住房：按「庇护需求」配足（每栋 house 提供 40 庇护）——
  //   v0.2.6 rev6 修复：此前按人口×12 估算，8 万人口只有 832 栋（庇护覆盖 42%）→ 幸福度被持续拉低
  const SHELTER_PER_HOUSE = (BUILDING_BY_ID.house && BUILDING_BY_ID.house.shelter) || 40;
  const needHouse = Math.ceil((popOf(n) * 1.15) / SHELTER_PER_HOUSE);
  inst.buildings = {
    workshop: Math.max(20, Math.round(ic * 5)),
    house: needHouse,
    manual_power: 10,
    farm: Math.max(20, Math.round(ic * 6)),
    gas_collector: Math.max(6, Math.round(ic / 4)),
    furnace: Math.max(20, Math.round(ic * 10)),
    blast_furnace: Math.max(10, Math.round(ic * 5)),
    electrolyzer: Math.max(6, Math.round(ic * 1.5)),
    thermal_plant: Math.max(10, Math.round(ic * 5)),
    clean_plant: Math.max(4, Math.round(ic)),
    mine_shallow: Math.max(10, Math.round(ic * 4)),
    mine_deep: Math.max(6, Math.round(ic * 3)),
    mine_core: Math.max(2, Math.round(ic)),
    storage_plant: Math.max(6, Math.round(ic)),
    lab: Math.max(4, Math.round(ic * 2)),
    fabricator: Math.max(10, Math.round(ic * 5)),
    chem_lab: Math.max(4, Math.round(ic * 2)),
    refinery: Math.max(2, Math.round(ic)),
    dock: Math.max(1, Math.round(n.navy / 4)),
    repair_bay: Math.max(1, Math.round(n.navy / 6)),
    barracks: Math.max(2, Math.round(n.divisions / 2)),
    training_ground: Math.max(2, Math.round(n.divisions / 6)),
  };
  // 记录工业规模，供 UI 展示
  inst.hoiIndustry = { ic: ic, buildings: Object.values(inst.buildings).reduce((a, b) => a + b, 0) };
  return inst.hoiIndustry.buildings;
}

/** 舰队：按 1936 真实海军实力造舰，并以史实舰队名编队 */
export function setupNavy(acc, nation, createShipFn, defaultBlueprintsFn) {
  const A = scenarioAdapterOf(acc);
  const n = typeof nation === 'string' ? A.byId[nation] : nation;
  if (!n) return { fleets: [], blueprints: [] };
  const deep = A.deep[n.id] || {};
  acc.ships = acc.ships || [];
  acc.fleets = acc.fleets || [];
  // v0.2.6 rev3：舰艇数与吨位结构挂钩 1936 真实海军实力
  //   （英国 66 舰 → 30 艘并偏大型舰，中国 4 舰 → 2 艘小型舰）
  const shipCount = Math.max(1, Math.min(40, Math.round(n.navy / 2.2)));
  // 优先复用账号已有的舰船蓝图（保证历史化命名落到玩家真正使用的蓝图对象上）
  const bps = (Array.isArray(acc.blueprints) && acc.blueprints.length)
    ? acc.blueprints
    : (defaultBlueprintsFn ? defaultBlueprintsFn() : []);
  // v0.2.6 rev3：舰船蓝图历史化（德国 Z 级驱逐舰 / U 型潜艇，英国皇家方舟级航母…）
  const sn = A.shipNames[n.id] || [];
  for (let i = 0; i < bps.length && i < sn.length; i++) {
    try { bps[i].nameCn = sn[i]; } catch (e) { /* 忽略 */ }
  }
  // v0.2.6 rev8：史实舰级表（含航母 / 战列舰）—— 有航母战列舰的国家就有对应舰种
  acc.hoiShipClasses = A.shipClasses[n.id] || sn;
  acc.blueprints = bps;
  if (!acc.blueprint && bps.length) acc.blueprint = bps[0];
  const hulls = bps.length ? bps : [];
  // v0.2.6 rev9：直接建**蓝图对应的战舰**（战列舰/航母/重巡/驱逐/潜艇），
  //   不再用探索船、运输船充数 —— 舰只自带吨位 strength（fleetPowerOf 口径）
  const classes = A.shipClasses[n.id] || sn || [n.nameCn + ' 战舰'];
  const capitalShare = Math.min(0.45, n.navy / 150);       // 海军越强，主力舰占比越高
  for (let i = 0; i < shipCount; i++) {
    // 前若干艘放主力舰（战列舰/航母/战巡），随后是巡洋/驱逐/潜艇
    let cls;
    if (i < Math.max(1, Math.round(shipCount * capitalShare))) {
      const capIdx = (n.navy >= 30 && classes.length > 1) ? (i % Math.min(2, classes.length)) : 0;
      cls = classes[capIdx];
    } else {
      // 其余舰只覆盖全部次级舰级（巡洋 / 驱逐 / 潜艇），保证编成完整
      const rest = classes.slice(2);
      const pool = rest.length ? rest : classes;
      cls = pool[(i - Math.round(shipCount * capitalShare)) % pool.length];
    }
    const ton = warshipTonnageOf(cls);
    acc.ships.push({
      id: 'warship_' + n.id + '_' + i,
      nameCn: cls + ' ' + (i + 1),
      className: cls,          // v0.3.2：舰队页/详情页按 className 显示（缺它会退化成「飞船」）
      shipClass: cls,
      stats: { speed: Math.max(6, Math.round(ton / 12)) },
      kind: 'warship',
      mark: 1,
      strength: Math.round(ton * 12 * (A.navyMul[n.id] || 1)),
      hp: Math.round(ton * 8),
      // v0.2.9 修复：补齐舰队/飞船详情页所需字段（缺 blueprintId 会导致页面打不开）
      blueprintId: (acc.blueprints && acc.blueprints[0] && acc.blueprints[0].id) || 'bp_scout',
      mark: 1,
      parts: {},
      capacity: 0,
      commissionedAt: Date.now(),
      state: { fuelMol: 2000 },
      planetCode: acc.homePlanetCode,
      cargo: {},
    });
  }
  // 编队：按 share 分配（真实舰队名）
  const fleetDefs = deep.fleets || [{ nameCn: n.nameCn + '海军', share: 1 }];
  let cursor = 0;
  for (const fd of fleetDefs) {
    const take = Math.max(1, Math.round(shipCount * (Number(fd.share) || 1)));
    const ids = acc.ships.slice(cursor, cursor + take).map((s) => s.id);
    cursor += take;
    if (!ids.length) continue;
    acc.fleets.push({
      id: 'fleet_' + n.id + '_' + acc.fleets.length,
      nameCn: fd.nameCn,
      shipIds: ids,
      command: null,
      mission: null,
      homePlanetCode: acc.homePlanetCode,
      lastResult: null,
    });
  }
  acc.hoiNavyMul = A.navyMul[n.id] || 1;   // 海军传统加成（强国同吨位更强）
  return { ships: acc.ships.length, fleets: acc.fleets.length, navyMul: acc.hoiNavyMul };
}

/** 国策加成舰队补充（effects.navy） */
export function addNavyShips(acc, count) {
  const ids = (acc && acc.ships) ? acc.ships.map((s) => s.id) : [];
  const freed = (acc.fleets || []).reduce((n, f) => n + (f.shipIds || []).length, 0);
  // 简化：直接在母星库存里加「舰船建造券」不可行，改为把已有舰只移入首个舰队
  const unassigned = ids.filter((id) => !(acc.fleets || []).some((f) => (f.shipIds || []).indexOf(id) >= 0));
  const f = (acc.fleets || [])[0];
  if (f && unassigned.length) {
    const take = unassigned.slice(0, Math.max(1, count));
    f.shipIds = (f.shipIds || []).concat(take);
    return take.length;
  }
  return 0;
}

/**
 * 属地星球配置（v0.2.6 rev6）：按属地人口配足住房/农田/矿井/加工 ——
 *   修复「殖民地幸福度不受控下降」：此前属地住房只有 4 栋、人口上万 → 庇护塌陷
 */
export function setupColony(inst2, n, colonyPop) {
  if (!inst2) return 0;
  const SHELTER_PER_HOUSE = (BUILDING_BY_ID.house && BUILDING_BY_ID.house.shelter) || 40;
  const pop = Math.max(200, Math.round(colonyPop));
  const house = Math.ceil((pop * 1.2) / SHELTER_PER_HOUSE);
  inst2.buildings = {
    house: house,
    farm: Math.max(6, Math.round(pop / 900)),
    mine_shallow: Math.max(6, Math.round(pop / 1200)),
    mine_deep: Math.max(3, Math.round(pop / 2400)),
    mine_core: Math.max(1, Math.round(pop / 6000)),
    workshop: Math.max(3, Math.round(pop / 2000)),
    storage_plant: Math.max(2, Math.round(pop / 3000)),
    gas_collector: Math.max(2, Math.round(pop / 3000)),
    thermal_plant: Math.max(2, Math.round(pop / 3000)),
    electrolyzer: Math.max(1, Math.round(pop / 4000)),
    refinery: Math.max(1, Math.round(pop / 6000)),
    lab: Math.max(1, Math.round(pop / 8000)),
    manual_power: 2,
  };
  if (inst2.pop) inst2.pop.consumeScale = 1 / 650;
  return house;
}

/**
 * 侧重生产线 + 装备流水线（v0.2.6 rev3）：
 *   · 工人总数 = 工业 × 415（德国 ≈ 20000 人）
 *   · 按各国侧重权重分配到不同配方（钢 / 铁 / 铝 / 塑料 / 橡胶 / 陶瓷…）
 *   · 若建筑工位不足，自动加建该建筑（工位 = 建筑数 × jobs）
 *   · 装备流水线（part_<部件id>）一并拉好，材料取本国独特装备材料
 */
export function setupLines(inst, nation) {
  const A = adapterOfNation(nation);
  const n = typeof nation === 'string' ? A.byId[nation] : nation;
  if (!n) return 0;
  const deep = A.deep[n.id] || {};
  const done = { lines: [], workers: 0 };
  if (!inst || !_addLine) return done;
  const total = workforceOf(n);
  const specs = (deep.lines || []);
  if (!specs.length) return done;
  // ① 先规划所有线（建筑 / 配方 / 工人数）
  const plan = [];
  // v0.2.6 rev8：优先资源生产 —— 资源线 72%、装备线 28%
  const mainTotal = Math.round(total * 0.72);
  const per = Math.max(20, Math.round(mainTotal / specs.length));
  for (const L of specs) plan.push({ buildingId: L.buildingId, recipeId: L.recipeId, workers: per });
  const mat = (deep.gear && deep.gear[0] && deep.gear[0].material) || '钢';
  const gearTotal = Math.round(total * 0.28);
  const perGear = Math.max(20, Math.round(gearTotal / GEAR_PARTS.length));
  for (const pid of GEAR_PARTS) plan.push({ buildingId: 'fabricator', recipeId: 'part_' + pid, workers: perGear, material: mat });
  // ①a 必备资源线（所有国家）：碳 / 钢 / 铝 / 铁 —— 保证基础资源永不断供
  const MUST_LINES = [
    { buildingId: 'furnace', recipeId: 'r_furnace_carbon' },     // 碳
    { buildingId: 'furnace', recipeId: 'r_furnace_wood' },       // 木炭
    { buildingId: 'refinery', recipeId: 'r_refine_steel' },      // 钢
    { buildingId: 'blast_furnace', recipeId: 'r_bf_aluminum' },  // 铝
    { buildingId: 'blast_furnace', recipeId: 'r_bf_iron' },      // 铁
  ];
  for (const L of MUST_LINES) {
    if (!plan.some((x) => x.buildingId === L.buildingId && x.recipeId === L.recipeId)) {
      // 钢 / 碳 / 铝合金等基础资源线给足人力（碳尤其吃紧 → 额外加人）
      const isCarbon = L.recipeId === 'r_furnace_carbon' || L.recipeId === 'r_furnace_wood';
      plan.push({ buildingId: L.buildingId, recipeId: L.recipeId, workers: isCarbon ? 900 : 520 });
    }
  }
  // ①b 高工业国家（ic ≥ 40）：高炉各类矿 + 全部化工复合资源铺线，避免缺料
  if (n.ic >= 40) {
    for (const rid of ['r_bf_iron', 'r_bf_copper', 'r_bf_zinc', 'r_bf_aluminum', 'r_bf_manganese', 'r_bf_tungsten']) {
      plan.push({ buildingId: 'blast_furnace', recipeId: rid, workers: 160 });
    }
    for (const rid of ['r_chem_plastic', 'r_chem_rubber', 'r_chem_aluminum_alloy', 'r_chem_explosive',
      'r_chem_tungsten_carbide', 'r_chem_graphene', 'r_chem_titanium_alloy']) {
      plan.push({ buildingId: 'chem_lab', recipeId: rid, workers: 140 });
    }
    for (const rid of ['r_refine_steel', 'r_refine_iron', 'r_refine_copper', 'r_refine_titanium']) {
      plan.push({ buildingId: 'refinery', recipeId: rid, workers: 160 });
    }
  }
  // ② 按建筑汇总工位需求，一次性加建到位（工位 = 建筑数 × jobs）
  const needBuild = {};
  for (const pl of plan) needBuild[pl.buildingId] = (needBuild[pl.buildingId] || 0) + pl.workers;
  for (const bid in needBuild) {
    const jobs = (BUILDING_BY_ID[bid] && BUILDING_BY_ID[bid].jobs) || 4;
    const need = Math.ceil((needBuild[bid] / Math.max(1, jobs)) * 1.2) + 2;
    const cur = Number(inst.buildings[bid]) || 0;
    if (cur < need) inst.buildings[bid] = need;
  }
  // ③ 挂线（工位已就位，逐条按计划施工人）
  for (const pl of plan) {
    try {
      const opts = pl.material ? { workers: pl.workers, material: pl.material } : { workers: pl.workers };
      let r = _addLine(inst, pl.buildingId, pl.recipeId, opts);
      if (!r || r.ok === false) {
        // 工位仍不足（多条线共享同一建筑）→ 再加建 30% 后重试一次
        const cur = Number(inst.buildings[pl.buildingId]) || 0;
        inst.buildings[pl.buildingId] = Math.ceil(cur * 1.3) + 2;
        r = _addLine(inst, pl.buildingId, pl.recipeId, opts);
      }
      if (r && r.ok !== false) { done.lines.push(pl.buildingId + ':' + pl.recipeId); done.workers += pl.workers; }
    } catch (e) { /* 忽略 */ }
  }
  return done;
}

/** 阵营：同阵营国家自动成为盟友（德意同盟等） */
export function setupBloc(acc, nation) {
  const A = scenarioAdapterOf(acc);
  const n = typeof nation === 'string' ? A.byId[nation] : nation;
  if (!n) return;
  const deep = A.deep[n.id] || {};
  if (!Array.isArray(acc.npcAllies)) acc.npcAllies = [];
  if (!deep.bloc || deep.bloc === 'neutral') return [];
  const mates = A.nations.filter((x) => x.id !== n.id && (A.deep[x.id] || {}).bloc === deep.bloc);
  for (const m of mates) {
    if (acc.npcAllies.indexOf(m.nameCn) < 0) acc.npcAllies.push(m.nameCn);
  }
  return mates.map((m) => m.nameCn);
}

/**
 * 外交 AI（v0.3.3 重写）：**严格按历史时间表推进，不再随机宣战**
 *
 * 旧实现（v0.2.6 rev3）的问题：每 30 游戏天用 `Math.random()` 从 11 国里随机抽一个，
 * 只要「我方较弱 × 0.85」且 `Math.random() < 0.35` 就立刻宣战 —— 全程不看日期，
 * 于是 1936 年 1 月就可能和美苏开战。
 *
 * 现在改为查表驱动（data/hoi1936.js#HIST_TIMELINE）：
 *   ① 只有当今日**落在某个历史节点窗口内**（day ± window）才可能触发；
 *   ② 触发对象只能是该节点 actors 里与玩家交战的那一方；
 *   ③ 每个节点每场只触发一次（acc.hoiHistFired 记录已触发 key），不会重复刷屏；
 *   ④ 节点未到时，AI 最多只会「提议结盟」（同 bloc 或史实友好方），不会开火。
 */
export function tickDiploAI(acc, dtSec) {
  const A = scenarioAdapterOf(acc);
  if (!acc || acc.scenario !== HOI_SCENARIO_ID) return null;
  const days = (Number(dtSec) || 0) * GAME_DAYS_PER_SEC;
  acc.hoiDiploDays = (Number(acc.hoiDiploDays) || 0) + days;
  if (acc.hoiDiploDays < 30) return null;
  acc.hoiDiploDays = 0;

  const mine = A.mainById[acc.nation];
  if (!mine) return null;
  if (!acc.hoiHistFired || typeof acc.hoiHistFired !== 'object') acc.hoiHistFired = {};

  const today = Math.floor(gameDaysOf(acc));
  const wars = Array.isArray(acc.wars) ? acc.wars.filter((w) => w && w.status === 'active') : [];
  const atWarIds = new Set(wars.map((w) => String(w.targetId || '').replace(/^hoi_/, '')));
  const allied = Array.isArray(acc.npcAllies) ? acc.npcAllies : [];

  // ===== ① 战争：只在历史节点窗口内、且对象是史实交战方 =====
  const myTargets = histWarTargetsFor(acc.nation, today);
  for (const t of myTargets) {
    const key = 'w:' + t.event.day + ':' + t.foe;
    if (acc.hoiHistFired[key]) continue;
    if (atWarIds.has(t.foe)) continue;               // 已在交战
    if (wars.length >= WAR_MAX_ACTIVE) continue;     // 战争槽位已满
    acc.hoiHistFired[key] = 1;
    const foe = A.byId[t.foe];
    if (!foe) continue;
    const w = {
      id: 'war_hist_' + t.event.day + '_' + t.foe + '_' + Date.now().toString(36),
      kind: 'npc', targetId: 'hoi_' + t.foe,
      targetName: foe.nameCn, startedAt: Date.now(), myScore: 0, theirScore: 10,
      battles: 0, status: 'active', endedAt: 0, treaty: null, progress: 0,
      histKey: t.event.day + ':' + t.foe,
      log: [{ at: Date.now(), text: t.event.desc + '（' + foe.nameCn + ' 对我方宣战）' }],
    };
    acc.wars.push(w);
    acc.warLog.unshift({ at: Date.now(), text: '【' + t.event.nameCn + '】' + t.event.desc });
    return { type: 'war', nation: foe.nameCn, hist: t.event.nameCn };
  }

  // ===== ② 结盟：同阵营自动为友；否则只在历史节点窗口内缔结（低概率）=====
  const candidates = HOI_MAIN_NATIONS.filter((x) =>
    x.id !== acc.nation && allied.indexOf(x.nameCn) < 0 && !atWarIds.has(x.id));
  if (!candidates.length) return null;

  const myBloc = (A.deep[acc.nation] || {}).bloc;
  const sameBloc = candidates.filter((x) => myBloc && (A.deep[x.id] || {}).bloc === myBloc);
  if (sameBloc.length && allied.indexOf(sameBloc[0].nameCn) < 0) {
    // 同阵营：立即缔约（史实轴心/同盟国的天然盟友关系）
    const p = sameBloc[0];
    acc.npcAllies.push(p.nameCn);
    acc.warLog.unshift({ at: Date.now(), text: '与 ' + p.nameCn + ' 缔结盟约（同阵营）' });
    return { type: 'ally', nation: p.nameCn };
  }

  // 异阵营：仅当今日处于某个战争节点窗口内，才可能「因战时合纵」结盟（30%）
  const inWarWindow = histEventsAt(today).some((e) => e.kind === 'war');
  if (inWarWindow && Math.random() < 0.30) {
    const p = candidates[Math.floor(Math.random() * candidates.length)];
    acc.npcAllies.push(p.nameCn);
    acc.warLog.unshift({ at: Date.now(), text: '与 ' + p.nameCn + ' 缔结盟约（战时合纵）' });
    return { type: 'ally', nation: p.nameCn };
  }
  return null;
}

/**
 * 岗位分配（v0.2.6 rev5）：让**每座建筑都有人工作**
 *   · 可用人力 = 总可用 − 生产线工人（产线工人已占用的不计入岗位）
 *   · 优先顺序：农田 / 各层矿井 / 电解池 / 科研所 / 采集与加工，最后填其余建筑
 *   · 每职业按「建筑数 × 岗位数」上限填充，力尽为止
 */
const STAFF_PRIORITY = [
  'farm', 'mine_shallow', 'mine_deep', 'mine_core', 'gas_collector', 'electrolyzer',
  'lab', 'refinery', 'chem_lab', 'blast_furnace', 'furnace', 'fabricator',
  'thermal_plant', 'clean_plant', 'workshop', 'storage_plant', 'dock', 'repair_bay',
];
export function staffBuildings(pop, inst) {
  if (!pop || !inst) return { jobs: 0, staffed: [] };
  const counts = inst.buildings || {};
  let avail = 0;
  try { avail = getAvailable(pop); } catch (e) { avail = 0; }
  const lineWorkers = _lineWorkers ? (Number(_lineWorkers(inst)) || 0) : 0;
  avail = Math.max(0, avail - lineWorkers);
  const order = STAFF_PRIORITY.concat(Object.keys(counts).filter((k) => STAFF_PRIORITY.indexOf(k) < 0));
  const staffed = [];
  let total = 0;
  for (const bid of order) {
    if (avail <= 0) break;
    const cnt = Number(counts[bid]) || 0;
    if (!cnt) continue;
    for (const j of (JOBS_BY_BUILDING[bid] || [])) {
      if (avail <= 0) break;
      let cap = 0;
      try { cap = jobCapacity(pop, j.id, counts); } catch (e) { cap = 0; }
      if (cap <= 0) continue;
      const already = pop.assignments[j.id] ? (pop.assignments[j.id].count || 0) : 0;
      const room = Math.max(0, cap - already);
      if (room <= 0) continue;
      const take = Math.min(room, avail);
      try { assignWorkers(pop, j.id, already + take, counts); } catch (e) { /* 忽略 */ }
      avail -= take;
      total += take;
      staffed.push(j.id + ':' + take);
    }
  }
  return { jobs: total, staffed: staffed };
}

/**
 * 舰名历史化（v0.2.6 rev6）：账号里**所有**舰只（含未编入舰队的「仓库舰」）
 *   一律按本国史实舰级命名，形如「Z 级驱逐舰 3」「U 型潜艇 1」
 */
export function ensureShipNames(acc, nation) {
  const A = scenarioAdapterOf(acc);
  if (!acc || !Array.isArray(acc.ships)) return 0;
  const n = typeof nation === 'string' ? A.byId[nation] : nation;
  const names = A.shipNames[n && n.id] || (n ? [n.nameCn + ' 舰'] : ['战舰']);
  const counters = {};
  let fixed = 0;
  let i = 0;
  for (const sh of acc.ships) {
    if (!sh) continue;
    // v0.3.2：优先沿用舰只自身的舰级（className），否则按史实舰级循环
    const cls = sh.className || names[i % names.length] || names[0];
    i++;
    counters[cls] = (counters[cls] || 0) + 1;
    const expect = cls + ' ' + counters[cls];
    if (sh.nameCn !== expect) { sh.nameCn = expect; fixed++; }
  }
  return fixed;
}

/**
 * 旧存档自愈（v0.2.6 rev7）：1936 剧本的老存档里，星球住房是按旧公式配的
 *   （8 万人口只有 832 栋、属地只有 4 栋）→ 庇护长期不足 → 幸福度不受控下降。
 *   本函数在进入存档后自动把住房补到「庇护需求」水平，并把已被拖垮的幸福度拉回恢复起点。
 *   幂等：住房达标即不再改动。
 */
export function repairScenarioEstates(acc) {
  const A = scenarioAdapterOf(acc);
  if (!acc || acc.scenario !== HOI_SCENARIO_ID) return 0;
  const SPH = (BUILDING_BY_ID.house && BUILDING_BY_ID.house.shelter) || 40;
  const codes = [];
  if (acc.homePlanetCode) codes.push(acc.homePlanetCode);
  if (acc.colonyCode) codes.push(acc.colonyCode);
  for (const c of (Array.isArray(acc.capturedPlanets) ? acc.capturedPlanets : [])) if (c && c.code) codes.push(c.code);
  let fixed = 0;
  for (const code of Array.from(new Set(codes))) {
    const inst = _getInst ? _getInst(code) : null;
    if (!inst || !inst.pop) continue;
    const pop = Number(inst.pop.total) || 0;
    if (pop <= 0) continue;
    if (!(Number(inst.pop.consumeScale) > 0)) inst.pop.consumeScale = 1 / 650;
    const need = Math.ceil((pop * 1.15) / SPH);
    const cur = Number(inst.buildings && inst.buildings.house) || 0;
    if (cur < need) {
      if (!inst.buildings) inst.buildings = {};
      inst.buildings.house = need;
      fixed++;
    }
    // 被长期拖垮的幸福度：给一个可恢复的起点（不直接拉满，保留博弈空间）
    if (!(Number(inst.pop.happiness) > 0.55)) inst.pop.happiness = 0.72;
    try { applyInfiniteReserve(inst); } catch (e) { /* v0.3.1：老档储量补 ∞ */ }
  }
  // v0.3.1：老档舰队自愈 —— 旧代码造的战舰缺字段（飞船页打不开）：补齐字段 + 史实名
  try {
    const nation = A.byId[acc.nation];
    if (nation) {
      const classes = A.shipClasses[nation.id] || [];
      let i2 = 0;
      for (const sh of (acc.ships || [])) {
        if (!sh) continue;
        if (classes.length) { sh.nameCn = classes[i2 % classes.length] + ' ' + (i2 + 1); if (!sh.shipClass) sh.shipClass = classes[i2 % classes.length]; }
        if (!sh.blueprintId) sh.blueprintId = (acc.blueprints && acc.blueprints[0] && acc.blueprints[0].id) || 'bp_scout';
        if (sh.mark == null) sh.mark = 1;
        if (!sh.parts) sh.parts = {};
        if (sh.capacity == null) sh.capacity = 0;
        if (!sh.state) sh.state = { fuelMol: 2000 };
        if (!(Number(sh.strength) > 0)) sh.strength = Math.round(warshipTonnageOf(sh.shipClass || '') * 12);
        if (!sh.className && sh.shipClass) sh.className = sh.shipClass;
        if (!sh.className && classes.length) sh.className = classes[i2 % classes.length];
        if (!sh.stats) sh.stats = { speed: Math.round(warshipTonnageOf(sh.className || '') / 12) };
        if (!sh.kind) sh.kind = 'warship';
        i2++;
      }
    }
  } catch (e) { /* 忽略 */ }
  return fixed;
}

/**
 * 战后处置（v0.2.6 rev8）：迫降某国后可选「吞并」或「成立傀儡政权」（史实名）
 *   · 吞并：按对方工业值折半直接并入（钢材/物资入库 + 工业建筑增加）
 *   · 傀儡：对方转为附庸盟友（提供贡品，并出现在盟友列表）
 */
export function postwarOptionsFor(nationId) {
  // v0.4.9：按势力 id 前缀选剧本（sci_ → 科幻；其余 → 1936）
  const A = adapterOfNation(nationId);
  return A.postWarOptions[nationId] || [{ key: 'annex', nameCn: '并入版图' }];
}

export function applyPostwarChoice(acc, nationId, choice) {
  const n = scenarioAdapterOf(acc).byId[nationId];
  if (!acc || !n) return { ok: false, reason: '国家数据缺失' };
  const inst = _getInst ? _getInst(acc.homePlanetCode) : null;
  const isPuppet = choice === 'puppet';
  if (!isPuppet) {
    // 吞并：工业与库存并入
    const steel = Math.round(n.ic * 400), iron = Math.round(n.ic * 500);
    try {
      if (inst) {
        if (inst.buildings) {
          inst.buildings.refinery = (Number(inst.buildings.refinery) || 0) + Math.max(2, Math.round(n.ic / 6));
          inst.buildings.blast_furnace = (Number(inst.buildings.blast_furnace) || 0) + Math.max(2, Math.round(n.ic / 8));
        }
        for (const [mat, qty] of [['钢', steel], ['铁', iron], ['铝', Math.round(n.ic * 200)]]) {
          const e = (inst.inventory || []).find((x) => x && x.mat === mat);
          if (e) e.owned = (Number(e.owned) || 0) + qty;
        }
      }
    } catch (e) { /* 忽略 */ }
    acc.warLog.unshift({ at: Date.now(), text: '【战后处置】吞并 ' + n.nameCn
      + '：并入钢材 ' + steel + '、铁矿 ' + iron + ' 与部分工业建筑。' });
    const p = POST_WAR_OPTIONS[nationId];
    const label = p && p[1] ? p[1].nameCn : n.nameCn;
    return { ok: true, mode: 'annex', text: '已吞并 ' + n.nameCn + '（对应傀儡方案「' + label + '」未采用）', steel, iron };
  }
  // 傀儡：转附庸（盟友 + 贡品标记）
  if (!Array.isArray(acc.npcAllies)) acc.npcAllies = [];
  const p = POST_WAR_OPTIONS[nationId];
  const puppetName = (p && p[1] ? p[1].nameCn.replace(/^成立「|」.*$/g, '') : n.nameCn + ' 傀儡政府');
  if (acc.npcAllies.indexOf(n.nameCn) < 0) acc.npcAllies.push(n.nameCn);
  acc.puppets = Array.isArray(acc.puppets) ? acc.puppets : [];
  acc.puppets.push({ nationId: n.id, nameCn: puppetName, at: Date.now() });
  acc.warLog.unshift({ at: Date.now(), text: '【战后处置】成立傀儡政权「' + puppetName + '」（' + n.nameCn + ' 转为附庸）。' });
  return { ok: true, mode: 'puppet', puppetName, text: '已成立「' + puppetName + '」' };
}

/** 德国专属：开局即拥有斯洛伐克领地（附庸 + 小属地） */
export function setupGermanPuppets(acc) {
  if (!acc || acc.nation !== 'ger') return 0;
  acc.puppets = Array.isArray(acc.puppets) ? acc.puppets : [];
  if (!acc.puppets.some((x) => x && x.nationId === 'slovakia')) {
    acc.puppets.push({ nationId: 'slovakia', nameCn: GER_PUPPETS.slovakia.nameCn, at: Date.now(), initial: true });
  }
  acc.warLog.unshift({ at: Date.now(), text: '【附庸】' + GER_PUPPETS.slovakia.desc + '（本土以南，提供原材料贡品）' });
  return 1;
}

/**
 * 战争推进（v0.3.4 重写：进度不再自动滑动，改为「打出来的」）
 *
 * v0.3.3 的做法是一根**按实力差自动滑动的进度条**：
 *     w.progress += (ratio - 0.5) * 4 * days    ratio = 我方/(我方+敌方)
 * 玩家看得见 0~100 的绿红条，但看不见任何战斗：师不会接敌、不会因伤亡变弱，
 * 打赢也没有部队永久损失 —— 「推进 70% 可迫降」与「真打了几场硬仗」无关。
 *
 * v0.3.4：进度条**降级为结果**。
 *   · 真正的交战搬到 core/battle.js 的战役系统：师级接敌、组织度、补给、
 *     工事、增援，战损**直接回写 acc.armies**（兵员/经验/战力），敌方师被永久消耗；
 *   · w.progress 由**战役胜负**增减（见 battle.js#resolveBattleEnd）；
 *   · 本函数**不再触碰 w.progress**，只负责两件事：
 *       ① 没有战场时，敌方按实力优势主动发起进攻（否则战争完全静止）；
 *       ② 老存档兜底：确保 wars 有 progress 初值。
 */
export function tickWarsHoi4(acc, dtSec) {
  const A = scenarioAdapterOf(acc);
  if (!acc || !Array.isArray(acc.wars)) return;
  const days = (Number(dtSec) || 0) * GAME_DAYS_PER_SEC;
  if (days <= 0) return;
  const n = A.byId[acc.nation];
  if (!n) return;

  // ---- 我方真实实力（仅用于判断「该不该被敌方打」，不再用于推进进度）----
  let armyStr = 0;
  for (const a of (Array.isArray(acc.armies) ? acc.armies : [])) {
    if (!a) continue;
    armyStr += (Number(a.power) || 0) * (1 + (Number(a.exp) || 0) / 200);
  }
  let icNow = 0;
  try {
    const inst = getHomeInstLocal(acc);
    if (inst && inst.hoiIndustry) icNow = Number(inst.hoiIndustry.ic) || 0;
  } catch (e) { icNow = 0; }
  const atkBuff = (acc.hoiFocus && acc.hoiFocus.buffs) ? (Number(acc.hoiFocus.buffs.atkMul) || 1) : 1;
  const myStr = (armyStr + icNow * 2 + n.divisions * 4) * atkBuff;

  for (const w of acc.wars) {
    if (!w || w.status !== 'active') continue;
    // 老存档兜底：进度字段缺失时补 0（v0.3.3 之前没有这个字段）
    if (w.progress == null) w.progress = 0;

    // ① 该战争已有战场 → 交给 battle.js 推进，本函数不干预
    let activeCount = 0;
    if (Array.isArray(acc.battles)) {
      for (const b of acc.battles) if (b && b.warId === w.id && b.status === 'active') activeCount++;
    }
    if (activeCount > 0) continue;

    // ② 没有战场时的被动推进（v0.3.5）：占领区巩固 / 低烈度冲突。
    //   v0.3.4 把 progress 完全交给战役后，战争在玩家不操作时会彻底静止。
    //   这里给一个极慢的兜底漂移（0.35 / 游戏天 ⇒ 独自推到 70% 要 200 天），
    //   只保证战争不会僵住，绝不构成「不操作也能赢」的捷径。
    try {
      const before = Number(w.progress) || 0;
      if (before < 100) {
        w.progress = Math.min(100, before + IDLE_PROGRESS_PER_DAY * days);
      }
    } catch (e) { /* 忽略 */ }

    // ② 没有战场：敌方实力明显占优时主动打过来（HOI4 的「对方先动手」）
    //    节拍由 _foeStrikeAt 控制，避免每秒都开新战场。
    const foe = A.byId[String(w.targetId || '').replace(/^hoi_/, '')];
    const myScore = Number(w.myScore) || 0;
    const battles = Number(w.battles) || 0;
    const wear = Math.max(0.25, 1 - (myScore * 0.012) - (battles * 0.01));
    const foeBase = foe ? (foe.divisions * 10 + foe.ic * 2) : 200;
    const foeStr = foeBase * wear;
    if (foeStr <= myStr * 1.15) continue;          // 敌方不占优就不主动打
    if (!foe || !foe.divisions) continue;          // 对方没师了，打不了

    const last = Number(w._foeStrikeAt) || 0;
    const coolMs = 20000;                            // 两次主动进攻至少隔 20 秒（游戏时间）
    if (Date.now() - last < coolMs) continue;
    w._foeStrikeAt = Date.now();

    try {
      const list = listBattles(acc, w.id);
      if (list.filter((b) => b && b.status === 'active').length >= BATTLE_MAX_PER_WAR) continue;
      const r = startBattle(acc, w, { side: 'foe', terrain: pickFoeTerrain(w) });
      if (r && r.ok && r.battle) {
        pushWarLog(acc, w, '敌方 ' + (foe.nameCn || w.targetName) + ' 主动发起进攻 —— 双方进入交战。');
      }
    } catch (e) { /* 单场进攻异常不拖垮心跳 */ }
  }
}

/**
 * 敌方进攻的战场地形（按战争进度轮换，制造不同战术处境）
 * v0.4.7 修复：此前用 ['plain','forest','urban','mountain','desert'] —— 这五个
 *   是 v0.4.0 之前的**地球地形**，虽在 BATTLE_TERRAIN 里保留以兼容老存档，
 *   但 UI 只展示 SPACE_TERRAIN_IDS 的 7 项太空地貌。敌方打出的地形玩家
 *   在 UI 里根本看不到选项。现统一用太空地貌。
 */
function pickFoeTerrain(war) {
  const list = SPACE_TERRAIN_IDS;
  const i = Math.floor((Number(war.progress) || 0) / 20) % list.length;
  return list[i];
}

function pushWarLog(acc, war, text) {
  const at = Date.now();
  war.log = Array.isArray(war.log) ? war.log : [];
  war.log.unshift({ at, text });
  if (war.log.length > 30) war.log.length = 30;
  if (Array.isArray(acc.warLog)) {
    acc.warLog.unshift({ at, text });
    if (acc.warLog.length > 60) acc.warLog.length = 60;
  }
}

/**
 * v0.4.9 **已删除** `reinforceArmy`（原第 1101~1157 行）与其「35% 凭空下限」。
 *
 *   删除理由：这套补员只挂在「军队」页一个按钮上，且要求星球仍有**未分配人力**。
 *   玩家的兵力几乎总被岗位与产线占满 → 永远返回「可用人力不足」，表现为**按钮完全无效**；
 *   同时兵员**没有任何自动恢复**，被打残的师要手点几十次；
 *   而且 `GEAR_FLOOR = 0.35` 那个下限等于在一件装备都没有时**凭空补出 35% 的兵**。
 *   替代实现：`core/army.js#recoverArmies`（常态自动整补，受人力与装备约束）
 *   与 `core/army.js#reinforceArmy`（手动紧急补员，缺料如实回报）。
 *   本文件仍导出 ARMY_MEN_MAX 作为**只读兼容别名**，避免旧存档 / 旧调用报错。
 */
export const ARMY_MEN_MAX = ARMY_MEN;
export const REINFORCE_PER_DAY = 25;      // 仅保留兼容；实际恢复速率见 army.js#recoverArmies

/**
 * 1936 剧本：星球储存资源设为「无限」（v0.2.7）
 *   实现口径：把物品栏所有条目的 玩家持有 / 储量上限 置为 INFINITE_STOCK(1e15)，
 *   气体层剩余量同样置满；UI 对 ≥1e15 的数值显示为「∞」。
 *   注意不用真正的 Infinity —— 它 JSON 化会变成 null，会毁掉存档。
 */
export const INFINITE_STOCK = 1e15;
/**
 * v0.2.8 修正：**只有储量无限** —— 星球矿藏剩余（remaining）与储藏上限（reserve）置满，
 *   **物品栏持有（owned）不动**（按各国历史产量推算的起始库存，靠采集/生产增长）。
 */
export function applyInfiniteReserve(inst) {
  if (!inst) return 0;
  let n = 0;
  for (const e of (inst.inventory || [])) {
    if (!e) continue;
    e.reserve = Math.max(Number(e.reserve) || 0, INFINITE_STOCK);
    if (Number(e.remaining) > 0) e.remaining = INFINITE_STOCK;   // 矿藏永不枯竭
    n++;
  }
  return n;
}

/**
 * 战争正当化（v0.3.0，HOI4 式）：宣战前需正当化，默认 60 游戏天。
 *   · 轴心国（bloc 'axis'）可正当化**任意国家**
 *   · 其他国家只能正当化「非同阵营、且综合国力不高于自己 1.5 倍」的国家
 *   · 国策的 justifyMul 可缩短正当化时间
 *   acc.hoiJustify = { targetId, targetName, daysLeft, daysNeed }
 */
export function canJustify(acc, nationId) {
  const A = scenarioAdapterOf(acc);
  const me = A.byId[acc && acc.nation];
  const target = A.byId[nationId];
  if (!me || !target) return { ok: false, reason: '国家数据缺失' };
  if (nationId === me.id) return { ok: false, reason: '不能对自己宣战' };
  const myBloc = (A.deep[me.id] || {}).bloc;
  const theirBloc = (A.deep[target.id] || {}).bloc;
  if (myBloc && theirBloc && myBloc === theirBloc && myBloc !== 'neutral') {
    return { ok: false, reason: '同阵营国家不能宣战（' + (A.blocName[myBloc] || '') + '）' };
  }
  if (myBloc !== 'axis') {
    const mine = me.ic + me.divisions / 2 + me.navy / 3;
    const theirs = target.ic + target.divisions / 2 + target.navy / 3;
    if (theirs > mine * 1.5) {
      return { ok: false, reason: '国力差距过大（非轴心国只能正当化国力不高于自己 1.5 倍的国家）' };
    }
  }
  return { ok: true };
}

// ============================================================================
// v0.3.3：宣战历史门控（「战争按历史来，不要随便乱宣战」的玩家侧）
// ============================================================================
// 与 tickDiploAI 用同一张 HIST_TIMELINE：玩家只能对「今日附近确有史实交战节点」
// 的国家宣战。返回值可直接喂给 war.js#declareWar 的 opts.histGate ——
// 由调用方注入，避免 core/war.js 反向依赖 data/hoi1936.js（它服务所有剧本）。
//
// 注意与 canJustify 的分工：canJustify 管「有没有理由打」（阵营/国力差），
// histGate 管「历史上该不该在这时候打」。两者是**与**关系，需同时满足。

/** 该国当前是否可作为宣战目标（仅历史门控，不含阵营/国力判定） */
export function histWarGateFor(acc, nationId) {
  if (!acc || acc.scenario !== HOI_SCENARIO_ID) return { ok: true };   // 非 1936 不门控
  const A = scenarioAdapterOf(acc);
  const today = Math.floor(gameDaysOf(acc));
  const mine = acc.nation;
  if (!mine) return { ok: false, reason: '势力数据缺失' };
  if (mine === nationId) return { ok: false, reason: '不能对自己宣战' };

  // 已在此节点交战过则不再重复放行
  const wars = Array.isArray(acc.wars) ? acc.wars : [];
  const already = wars.find((w) => w && String(w.targetId || '').replace(/^hoi_/, '') === nationId);
  if (already) return { ok: false, reason: '与「' + (A.byId[nationId] || {}).nameCn + '」的战争已在持续中' };

  const targets = histWarTargetsFor(mine, today);
  const hit = targets.find((t) => t.foe === nationId);
  if (hit) {
    return {
      ok: true,
      histKey: String(hit.event.day) + ':' + nationId,
      eventName: hit.event.nameCn,
      desc: hit.event.desc,
    };
  }
  // 下一个历史节点（用于 UI 提示「何时可宣战」）
  const upcoming = HIST_TIMELINE
    .filter((e) => e.kind === 'war'
      && (e.actors.indexOf(mine) >= 0)
      && e.day > today)
    .sort((a, b) => a.day - b.day)[0];
  const upFoe = upcoming ? (upcoming.actors.find((x) => x !== mine) || '') : '';
  return {
    ok: false,
    reason: '历史上此时尚未与「' + ((A.byId[nationId] || {}).nameCn || nationId) + '」交战'
      + (upcoming && upFoe === nationId
        ? '（预计 ' + Math.ceil(upcoming.day - today) + ' 游戏天后：' + upcoming.nameCn + '）'
        : '（本国近期无对它的历史战争节点）'),
    nextEventDay: upcoming ? upcoming.day : null,
  };
}

/** 玩家今日可宣战的历史目标列表（供 UI 下拉栏渲染「可宣战对象」） */
export function listHistTargets(acc) {
  // v0.4.9：历史节点门控是 1936 专属 —— 科幻剧本没有「史实年份」，
  //   它的宣战目标来自战区地图上的敌对势力（ui/hoi.js 的势力面板），不按年份解锁。
  if (!acc || acc.scenario !== HOI_SCENARIO_ID) return [];
  const A = scenarioAdapterOf(acc);
  const today = Math.floor(gameDaysOf(acc));
  return histWarTargetsFor(acc.nation, today)
    .map((t) => ({
      nationId: t.foe,
      nameCn: (A.byId[t.foe] || {}).nameCn || t.foe,
      flag: (A.byId[t.foe] || {}).flag || '',
      eventName: t.event.nameCn,
      desc: t.event.desc,
      day: t.event.day,
    }));
}

export function startJustify(acc, nationId) {
  const chk = canJustify(acc, nationId);
  if (!chk.ok) return chk;
  const n = scenarioAdapterOf(acc).byId[nationId];
  const f = ensureFocus(acc);
  const need = Math.max(15, Math.round(JUSTIFY_DAYS * (Number(f.buffs.justifyMul) || 1)));
  acc.hoiJustify = { targetId: nationId, targetName: n.nameCn, daysLeft: need, daysNeed: need, at: Date.now() };
  return { ok: true, daysNeed: need, targetName: n.nameCn };
}

export function justifyStatusOf(acc, nationId) {
  const j = acc && acc.hoiJustify;
  if (!j) return null;
  if (nationId && j.targetId !== nationId) return null;
  return j;
}

export function tickJustify(acc, dtSec) {
  const j = acc && acc.hoiJustify;
  if (!j) return null;
  const days = (Number(dtSec) || 0) * GAME_DAYS_PER_SEC;
  j.daysLeft = Math.max(0, (Number(j.daysLeft) || 0) - days);
  if (j.daysLeft <= 0) {
    j.ready = true;   // 正当化完成：可以宣战
    return { type: 'ready', targetName: j.targetName };
  }
  return null;
}

export function backgroundOf(acc) {
  if (!acc) return '';
  return scenarioAdapterOf(acc).bg[acc.nation] || '';
}

export function blocNameOf(acc) {
  const A = scenarioAdapterOf(acc);
  const deep = A.deep[acc && acc.nation];
  return deep ? (A.blocName[deep.bloc] || '无所属') : '';
}

export function deepOf(acc) {
  return scenarioAdapterOf(acc).deep[acc && acc.nation] || null;
}

export function nationOf(acc) {
  if (!acc) return null;
  return scenarioAdapterOf(acc).byId[acc.nation] || null;
}

export { HOI_SCENARIO_ID, popOf };

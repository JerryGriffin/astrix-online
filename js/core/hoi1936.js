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
import { HOI_NATIONS, HOI_BY_ID, HOI_DEEP, HOI_SEAS, ARMY_MEN, popOf, BLOC_NAME, HOI_SCENARIO_ID } from '../data/hoi1936.js?v=26.2';

// 依赖注入（避免与 state.js / production.js 形成循环导入）
let _getInst = null;
let _addLine = null;
export function setHoiDeps(deps) {
  if (deps && typeof deps.getInst === 'function') _getInst = deps.getInst;
  if (deps && typeof deps.addLine === 'function') _addLine = deps.addLine;
}

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
  if (!f.buffs) f.buffs = { atkMul: 1, defMul: 1, lineMul: 1 };
  if (f.buffs.atkMul == null) f.buffs.atkMul = 1;
  if (f.buffs.defMul == null) f.buffs.defMul = 1;
  if (f.buffs.lineMul == null) f.buffs.lineMul = 1;
  return f;
}

export function focusOptionsOf(acc) {
  const deep = HOI_DEEP[acc && acc.nation];
  if (!deep) return [];
  const f = ensureFocus(acc);
  return deep.foci.map((x) => Object.assign({ done: f.done.indexOf(x.id) >= 0 }, x));
}

export function startFocus(acc, focusId) {
  const deep = HOI_DEEP[acc && acc.nation];
  if (!deep) return { ok: false, reason: '非 1936 剧本存档' };
  const f = ensureFocus(acc);
  if (f.current) return { ok: false, reason: '已有国策正在推进（' + f.current.nameCn + '）' };
  const def = deep.foci.find((x) => x.id === focusId);
  if (!def) return { ok: false, reason: '找不到该策' };
  if (f.done.indexOf(focusId) >= 0) return { ok: false, reason: '该策已完成' };
  f.current = { id: def.id, nameCn: def.nameCn, progressDays: 0, needDays: def.days, branch: def.branch };
  return { ok: true, current: f.current, def };
}

/** 每秒调用：推进国策进度（按游戏天数），完成时结算效果 */
export function tickFocus(acc, dtSec) {
  const f = ensureFocus(acc);
  if (!f || !f.current) return null;
  f.current.progressDays += Math.max(0, Number(dtSec) || 0) * GAME_DAYS_PER_SEC;
  if (f.current.progressDays < f.current.needDays) return null;
  const deep = HOI_DEEP[acc.nation];
  const def = deep && deep.foci.find((x) => x.id === f.current.id);
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
  if (eff.allyBloc && eff.allyBloc === (HOI_DEEP[acc.nation] || {}).bloc) {
    // 强化同阵营（盟友在开局已建立，这里只作为外交进度）
  }
  if (eff.navy) addNavyShips(acc, eff.navy);
}

// ============================================================================
// 海域：制海权争夺（HOI4 风格海域）—— 巡逻舰队 vs 敌方海上压力
//   acc.hoiSeas = [{ id, nameCn, control (0~1 我方), lastResult }]
// ============================================================================
export function ensureSeas(acc) {
  if (!acc) return [];
  if (!Array.isArray(acc.hoiSeas) || !acc.hoiSeas.length) {
    acc.hoiSeas = HOI_SEAS.map((s) => ({ id: s.id, nameCn: s.nameCn, base: s.base, control: 0.5, lastResult: null }));
  }
  return acc.hoiSeas;
}

/** 敌方海上压力：与我方交战国家（含阵营）的海军实力合计 */
export function enemySeaPressure(acc) {
  const wars = Array.isArray(acc.wars) ? acc.wars.filter((w) => w && w.status === 'active') : [];
  let pressure = 0;
  for (const w of wars) {
    const id = String(w.targetId || '').replace(/^hoi_/, '');
    const n = HOI_BY_ID[id] || HOI_NATIONS.find((x) => x.nameCn === w.targetName);
    if (n) pressure += n.navy * 18 + n.ic * 4;
  }
  return pressure;
}

/** 派舰队争夺海域：myNavyStr 为参战舰队战力 */
export function contestSea(acc, seaId, myNavyStr) {
  const seas = ensureSeas(acc);
  const sea = seas.find((s) => s.id === seaId);
  if (!sea) return { ok: false, reason: '未知海域' };
  const mine = Math.max(0, Number(myNavyStr) || 0);
  const foe = enemySeaPressure(acc) * (0.5 + Math.random() * 0.6);
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
      (win ? '我方' : '敌方') + '掌握主动（我方战力 ' + Math.round(mine) + ' vs 敌方 ' + Math.round(foe) + '）',
      '制海权 → ' + Math.round(sea.control * 100) + '%',
      win ? '敌方护航队被驱逐' : '我方损失 ' + sunk + ' 艘舰艇',
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
  const n = typeof nation === 'string' ? HOI_BY_ID[nation] : nation;
  const deep = HOI_DEEP[n.id] || {};
  const count = Math.max(2, Math.min(14, Math.round(n.divisions / 6)));
  const perPower = Math.max(60, Math.round(n.divisions * 11));
  acc.armies = [];
  for (let i = 0; i < count; i++) {
    acc.armies.push({
      id: 'army_' + n.id + '_' + i,
      nameCn: n.nameCn + ' 第' + (i + 1) + (deep.armyName || '师'),
      blueprintId: 'ab_ranger',
      men: ARMY_MEN,
      exp: 0, bonusAtk: 0, bonusDef: 0,
      stats: {
        atk: Math.round(perPower * 0.5 * (deep.atkMul || 1)),
        def: Math.round(perPower * 0.42 * (deep.defMul || 1)),
        speed: 8,
      },
      power: Math.round(perPower * ((deep.atkMul || 1) + (deep.defMul || 1)) / 2),
    });
  }
  return acc.armies.length;
}

/** 舰队：按 1936 真实海军实力造舰，并以史实舰队名编队 */
export function setupNavy(acc, nation, createShipFn, defaultBlueprintsFn) {
  const n = typeof nation === 'string' ? HOI_BY_ID[nation] : nation;
  const deep = HOI_DEEP[n.id] || {};
  acc.ships = acc.ships || [];
  acc.fleets = acc.fleets || [];
  // 舰艇数：按真实海军规模缩放（navy 6~66 → 2~20 艘），每舰实力反映吨位
  const shipCount = Math.max(1, Math.min(20, Math.round(n.navy / 3.2)));
  const bps = defaultBlueprintsFn ? defaultBlueprintsFn() : [];
  const hulls = bps.length ? bps : [];
  for (let i = 0; i < shipCount; i++) {
    const bp = hulls[i % Math.max(1, hulls.length)];
    if (!bp) break;
    try {
      const r = createShipFn(bp, { ships: acc.ships, account: acc, planetCode: acc.homePlanetCode, researched: acc.tech });
      if (r && r.ok && r.ship) {
        r.ship.nameCn = n.nameCn + ' ' + (i + 1) + ' 号舰';
        r.ship.state = r.ship.state || {};
        r.ship.state.fuelMol = Math.max(Number(r.ship.state.fuelMol) || 0, 2000);
        acc.ships.push(r.ship);
      }
    } catch (e) { /* 忽略单舰失败 */ }
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
  return { ships: acc.ships.length, fleets: acc.fleets.length };
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

/** 侧重生产线 + 独特装备流水线：铺设到本土星球（不占农田，跳过 farm） */
export function setupLines(inst, nation) {
  const n = typeof nation === 'string' ? HOI_BY_ID[nation] : nation;
  const deep = HOI_DEEP[n.id] || {};
  const added = [];
  if (!inst) return added;
  for (const L of (deep.lines || [])) {
    try {
      if (!_addLine) continue;
      const r = _addLine(inst, L.buildingId, L.recipeId, { workers: L.workers });
      if (r && r.ok !== false) added.push(L.buildingId + ':' + L.recipeId);
    } catch (e) { /* 忽略 */ }
  }
  return added;
}

/** 阵营：同阵营国家自动成为盟友（德意同盟等） */
export function setupBloc(acc, nation) {
  const n = typeof nation === 'string' ? HOI_BY_ID[nation] : nation;
  const deep = HOI_DEEP[n.id] || {};
  if (!Array.isArray(acc.npcAllies)) acc.npcAllies = [];
  if (!deep.bloc || deep.bloc === 'neutral') return [];
  const mates = HOI_NATIONS.filter((x) => x.id !== n.id && (HOI_DEEP[x.id] || {}).bloc === deep.bloc);
  for (const m of mates) {
    if (acc.npcAllies.indexOf(m.nameCn) < 0) acc.npcAllies.push(m.nameCn);
  }
  return mates.map((m) => m.nameCn);
}

export function blocNameOf(acc) {
  const deep = HOI_DEEP[acc && acc.nation];
  return deep ? (BLOC_NAME[deep.bloc] || '不结盟') : '';
}

export function deepOf(acc) {
  return HOI_DEEP[acc && acc.nation] || null;
}

export function nationOf(acc) {
  return (acc && HOI_BY_ID[acc.nation]) || null;
}

export { HOI_SCENARIO_ID, popOf };

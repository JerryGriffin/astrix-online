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
import { HOI_NATIONS, HOI_BY_ID, HOI_DEEP, HOI_SEAS, ARMY_MEN, popOf, BLOC_NAME, HOI_SCENARIO_ID,
  workforceOf, ARMY_POWER_PER_DIV, NAVY_MUL, GEAR_PARTS, SHIP_NAMES, ARMY_BP_NAME, HOI_BG } from '../data/hoi1936.js?v=26.7';
import { BUILDING_BY_ID } from '../data/buildings.js?v=26.7';
import { JOBS_BY_BUILDING, assignWorkers, jobCapacity, getAvailable } from './population.js?v=26.7';
import { ELITE_DIVISIONS, ELITE_MUL } from '../data/hoi1936.js?v=26.7';

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
  const byBranch = {};
  for (const x of deep.foci) (byBranch[x.branch] = byBranch[x.branch] || []).push(x);
  return deep.foci.map((x) => {
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
  const deep = HOI_DEEP[acc && acc.nation];
  if (!deep) return { ok: false, reason: '非 1936 剧本存档' };
  const f = ensureFocus(acc);
  if (f.current) return { ok: false, reason: '已有国策正在推进（' + f.current.nameCn + '）' };
  const def = deep.foci.find((x) => x.id === focusId);
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
  // v0.2.6 rev3：**师数 = 1936 年真实师数**（德国 30 / 苏联 92 / 中国 120 …），每师 500 人
  const count = Math.max(2, Math.min(130, Math.round(n.divisions)));
  const perPower = ARMY_POWER_PER_DIV;
  acc.armies = [];
  for (let i = 0; i < count; i++) {
    acc.armies.push({
      id: 'army_' + n.id + '_' + i,
      nameCn: n.nameCn + ' 第' + (i + 1) + (deep.armyName || '师'),
      blueprintId: 'ab_ranger',
      men: ARMY_MEN,
      exp: 0, bonusAtk: 0, bonusDef: 0,
      stats: {
        atk: Math.round(perPower * (deep.atkMul || 1)),
        def: Math.round(perPower * (deep.defMul || 1)),
        speed: 8,
      },
      power: Math.round(perPower * ((deep.atkMul || 1) + (deep.defMul || 1)) / 2),
    });
  }
  // v0.2.6 rev5：王牌师（史实名，战力与属性显著更强）
  const elites = ELITE_DIVISIONS[n.id] || [];
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
  if (ARMY_BP_NAME[n.id] && Array.isArray(acc.blueprints) && acc.blueprints.length) {
    try { acc.blueprints[0].nameCn = ARMY_BP_NAME[n.id]; acc.blueprint = acc.blueprints[0]; } catch (e) { /* 忽略 */ }
  }
  return acc.armies.length;
}

// ---------------------------------------------------------------------------
// 工业建筑群（v0.2.6 rev3）：按国家工业与人口规模铺开大量建筑，
//   为「生产线大量工人」提供工位（工位 = 建筑数 × 该建筑 jobs）
// ---------------------------------------------------------------------------
export function setupFactories(inst, nation) {
  const n = typeof nation === 'string' ? HOI_BY_ID[nation] : nation;
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
  const n = typeof nation === 'string' ? HOI_BY_ID[nation] : nation;
  const deep = HOI_DEEP[n.id] || {};
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
  const sn = SHIP_NAMES[n.id] || [];
  for (let i = 0; i < bps.length && i < sn.length; i++) {
    try { bps[i].nameCn = sn[i]; } catch (e) { /* 忽略 */ }
  }
  acc.blueprints = bps;
  if (!acc.blueprint && bps.length) acc.blueprint = bps[0];
  const hulls = bps.length ? bps : [];
  for (let i = 0; i < shipCount; i++) {
    const bp = hulls[i % Math.max(1, hulls.length)];
    if (!bp) break;
    try {
      const r = createShipFn(bp, { ships: acc.ships, account: acc, planetCode: acc.homePlanetCode, researched: acc.tech });
      if (r && r.ok && r.ship) {
        r.ship.nameCn = (bp.nameCn || (n.nameCn + ' 舰')) + ' ' + (i + 1);
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
  acc.hoiNavyMul = NAVY_MUL[n.id] || 1;   // 海军传统加成（强国同吨位更强）
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
  const n = typeof nation === 'string' ? HOI_BY_ID[nation] : nation;
  const deep = HOI_DEEP[n.id] || {};
  const done = { lines: [], workers: 0 };
  if (!inst || !_addLine) return done;
  const total = workforceOf(n);
  const specs = (deep.lines || []);
  if (!specs.length) return done;
  // ① 先规划所有线（建筑 / 配方 / 工人数）
  const plan = [];
  const mainTotal = Math.round(total * 0.45);
  const per = Math.max(20, Math.round(mainTotal / specs.length));
  for (const L of specs) plan.push({ buildingId: L.buildingId, recipeId: L.recipeId, workers: per });
  const mat = (deep.gear && deep.gear[0] && deep.gear[0].material) || '钢';
  const gearTotal = Math.round(total * 0.55);
  const perGear = Math.max(20, Math.round(gearTotal / GEAR_PARTS.length));
  for (const pid of GEAR_PARTS) plan.push({ buildingId: 'fabricator', recipeId: 'part_' + pid, workers: perGear, material: mat });
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

/**
 * 外交 AI（v0.2.6 rev3）：AI 国家会主动行动 ——
 *   · 每 30 游戏天判定一次：非盟友、非交战国可能「向我方宣战」（我方越弱越可能）
 *   · 也可能「提议结盟」（我方越强、战争越少越可能）
 *   · 结果写入 acc.wars / acc.npcAllies 与 warLog（战争面板可见）
 */
export function tickDiploAI(acc, dtSec) {
  if (!acc || acc.scenario !== HOI_SCENARIO_ID) return null;
  const days = (Number(dtSec) || 0) * GAME_DAYS_PER_SEC;
  acc.hoiDiploDays = (Number(acc.hoiDiploDays) || 0) + days;
  if (acc.hoiDiploDays < 30) return null;
  acc.hoiDiploDays = 0;
  const mine = HOI_BY_ID[acc.nation];
  if (!mine) return null;
  const allied = Array.isArray(acc.npcAllies) ? acc.npcAllies : [];
  const wars = Array.isArray(acc.wars) ? acc.wars.filter((w) => w && w.status === 'active') : [];
  const atWarNames = wars.map((w) => w.targetName);
  const others = HOI_NATIONS.filter((x) => x.id !== acc.nation && allied.indexOf(x.nameCn) < 0 && atWarNames.indexOf(x.nameCn) < 0);
  if (!others.length) return null;
  // 我方国力（工业 + 师数/2 + 海军/2）与候选国比较
  const myPower = mine.ic + mine.divisions / 2 + mine.navy / 2;
  const pick = others[Math.floor(Math.random() * others.length)];
  const theirPower = pick.ic + pick.divisions / 2 + pick.navy / 2;
  const weak = myPower < theirPower * 0.85;
  // 战争过多时不再主动开战
  const warRoom = wars.length < 3;
  if (weak && warRoom && Math.random() < 0.35) {
    const w = {
      id: 'war_ai_' + Date.now().toString(36), kind: 'npc', targetId: 'hoi_' + pick.id,
      targetName: pick.nameCn, startedAt: Date.now(), myScore: 0, theirScore: 10,
      battles: 0, status: 'active', endedAt: 0, treaty: null,
      log: [{ at: Date.now(), text: pick.nameCn + ' 判断我方虚弱，主动向我方宣战！' }],
    };
    acc.wars.push(w);
    acc.warLog.unshift({ at: Date.now(), text: pick.nameCn + ' 主动宣战（我方被动应战）' });
    return { type: 'war', nation: pick.nameCn };
  }
  if (!weak && wars.length === 0 && Math.random() < 0.30) {
    acc.npcAllies.push(pick.nameCn);
    acc.warLog.unshift({ at: Date.now(), text: '与 ' + pick.nameCn + ' 缔结盟约（AI 主动示好）' });
    return { type: 'ally', nation: pick.nameCn };
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
  if (!acc || !Array.isArray(acc.ships)) return 0;
  const n = typeof nation === 'string' ? HOI_BY_ID[nation] : nation;
  const names = SHIP_NAMES[n && n.id] || (n ? [n.nameCn + ' 舰'] : ['战舰']);
  const counters = {};
  let fixed = 0;
  let i = 0;
  for (const sh of acc.ships) {
    if (!sh) continue;
    // 按舰级循环命名（驱逐 / 巡洋 / 潜艇 …），保证仓库里的舰队也是史实编制感
    const idx = i % names.length;
    i++;
    const cls = names[idx] || names[0];
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
  }
  return fixed;
}

export function backgroundOf(acc) {
  return (acc && HOI_BG[acc.nation]) || '';
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

// 战争系统（v0.2.6）：联盟战争 / 国家战争 —— 持续过程，只有「投降 + 签订条约」才能结束
//
// 设计（设计者要求）：
//   * 战争一经宣战即**持续存在**（跨存档、跨会话），不会因时间或单次战役自动结束；
//   * 每次交战按结果累加**战争分数**（我方战果 vs 敌方战果）；
//   * 结束只有一条路：一方**投降并签订条约** —— 胜方开条件（赔款 / 物资 / 承认战败），
//     败方接受后战争才真正结束（treaty 写入日志）。
//   * 对电脑国家：分数达到「迫降线」后可单向迫降签约；也可随时提出停战（对方可能拒绝）。
//   * 对真人玩家：宣战 / 停战 / 投降均走事件信箱（war_declare / treaty_offer / treaty_accept）。
//
// 数据结构挂在账号上：
//   acc.wars    = [{ id, kind:'npc'|'player', targetId, targetName, startedAt, myScore, theirScore,
//                    battles, status:'active'|'ended', endedAt, treaty, log:[] }]
//   acc.warLog  = [{ at, text }]   —— 最近战报（上限 60）

export const WAR_FORCE_SURRENDER_SCORE = 60;   // 迫降线：我方战争分数 ≥ 60 可迫降电脑国家
export const WAR_MAX_ACTIVE = 4;               // 同时进行的战争上限（避免开局多线崩盘）
export const TREATY_REPARATION_RATE = 0.35;    // 赔款 = 战败方国库 × 35%
const WARLOG_CAP = 60;

// ============================================================================
// 舰队会战的海军系数（v0.4.24）
// ============================================================================
// 这两个常量放在 war.js 而不是 battle.js / fleetwar.js，是为了**避免模块环**：
//   battle.js 已经 import 了 fleet.js，fleet.js 又 import state.js，state.js 再 import battle.js
//   （既有环，靠「只在函数体内使用」跑得通）。舰队会战判定（fleetwar.js）要用同一个换算系数，
//   若它去 import battle.js，就会再多绕一圈。war.js 是零依赖叶子模块，放这里最稳。
export const NAVY_TO_SHIP_POWER = 12;   // 1 单位「史实海军」折合 12 点舰队战力（battle.js 也用它）
export const FLEET_EDGE_MAX = 0.3;      // 舰队会战对轨道控制实力的最大修正幅度

/** 确保账号上有舰队会战附加数据（老存档自动迁移） */
export function ensureNaval(acc) {
  if (!acc) return { edge: {}, log: [] };
  if (!acc.fleetEdge || typeof acc.fleetEdge !== 'object' || Array.isArray(acc.fleetEdge)) {
    acc.fleetEdge = {};
  }
  if (!Array.isArray(acc.fleetLog)) acc.fleetLog = [];
  return { edge: acc.fleetEdge, log: acc.fleetLog };
}

/** 对某势力的舰队会战优势（−0.3 ~ +0.3）：胜仗加分、败仗扣分，影响轨道控制 */
export function navalEdgeOf(acc, targetId) {
  const key = String(targetId || '');
  if (!key) return 0;
  const nav = ensureNaval(acc);
  const v = Number(nav.edge[key]);
  if (!Number.isFinite(v)) return 0;
  return Math.max(-FLEET_EDGE_MAX, Math.min(FLEET_EDGE_MAX, v));
}

/** 累加舰队会战优势（会战结束后调用）；返回加完之后的值 */
export function addNavalEdge(acc, targetId, delta) {
  const key = String(targetId || '');
  if (!key) return 0;
  const nav = ensureNaval(acc);
  const cur = navalEdgeOf(acc, key);
  const next = Math.max(-FLEET_EDGE_MAX, Math.min(FLEET_EDGE_MAX, cur + (Number(delta) || 0)));
  nav.edge[key] = next;
  return next;
}

export function ensureWars(acc) {
  if (!acc) return [];
  if (!Array.isArray(acc.wars)) acc.wars = [];
  if (!Array.isArray(acc.warLog)) acc.warLog = [];
  return acc.wars;
}

let _seq = 0;
function warId() { return 'war_' + Date.now().toString(36) + '_' + (_seq++).toString(36); }

export function activeWarsOf(acc) {
  return ensureWars(acc).filter((w) => w && w.status === 'active');
}

export function warWith(acc, targetId) {
  return activeWarsOf(acc).find((w) => w && w.targetId === targetId) || null;
}

function pushLog(acc, war, text) {
  const at = Date.now();
  war.log = Array.isArray(war.log) ? war.log : [];
  war.log.unshift({ at, text });
  if (war.log.length > 30) war.log.length = 30;
  acc.warLog.unshift({ at, text });
  if (acc.warLog.length > WARLOG_CAP) acc.warLog.length = WARLOG_CAP;
}

/** 宣战：对电脑国家（kind='npc'）或真人玩家（kind='player'）
 *
 *  v0.3.3：新增 opts.histGate —— 「战争按历史来」的可选门控。
 *    传入 { ok:false, reason } 则拒绝宣战。**由调用方（1936 剧本侧）注入**，
 *    以免 core/war.js 反向依赖 data/hoi1936.js（它服务于所有剧本，不只 1936）。
 *    非 1936 剧本不传此参数，行为与旧版完全一致。
 */
export function declareWar(acc, target, opts) {
  if (!acc || !target || !target.id) return { ok: false, reason: '目标无效' };
  const gate = opts && opts.histGate;
  if (gate && gate.ok === false) {
    return { ok: false, reason: gate.reason || '当前历史节点不允许对该国宣战' };
  }
  ensureWars(acc);
  if (warWith(acc, target.id)) return { ok: false, reason: '与「' + (target.nameCn || target.id) + '」的战争已在持续中' };
  if (activeWarsOf(acc).length >= WAR_MAX_ACTIVE) {
    return { ok: false, reason: '同时最多进行 ' + WAR_MAX_ACTIVE + ' 场战争（先结束旧战争再宣战）' };
  }
  const war = {
    id: warId(),
    kind: target.kind === 'player' ? 'player' : 'npc',
    targetId: target.id,
    targetName: target.nameCn || target.id,
    startedAt: Date.now(),
    myScore: 0,
    theirScore: 0,
    battles: 0,
    status: 'active',
    endedAt: 0,
    treaty: null,
    log: [],
  };
  // v0.3.3：门控通过时记下所踩中的历史节点，便于战报与 UI 展示
  if (gate && gate.histKey) war.histKey = gate.histKey;
  ensureWars(acc).push(war);
  pushLog(acc, war, '向「' + war.targetName + '」宣战 —— 战争开始，只有投降签约才能结束。');
  return { ok: true, war };
}

/** 战役结果计入战争分数：win=true 我方胜。分数为主观战果（每役 +8 / 败 +6） */
export function addWarScore(acc, targetId, win, note) {
  const war = warWith(acc, targetId);
  if (!war) return { ok: false, reason: '没有与该目标的进行中战争' };
  war.battles += 1;
  if (win) { war.myScore += 8; war.theirScore += 2; }
  else { war.theirScore += 8; war.myScore += 2; }
  war.myScore = Math.min(100, war.myScore);
  war.theirScore = Math.min(100, war.theirScore);
  pushLog(acc, war, (win ? '战役获胜' : '战役失利') + '（我方战果 ' + war.myScore + ' : ' + war.theirScore + '）'
    + (note ? ' · ' + note : ''));
  return { ok: true, war };
}

/** 能否迫降（仅对电脑国家：我方分数达到迫降线） */
export function canForceSurrender(acc, targetId) {
  const war = warWith(acc, targetId);
  if (!war) return { ok: false, reason: '没有与该目标的进行中战争' };
  if (war.kind !== 'npc') return { ok: false, reason: '真人玩家必须由本人接受条约' };
  if (war.myScore < WAR_FORCE_SURRENDER_SCORE) {
    return { ok: false, reason: '我方战争分数 ' + war.myScore + ' / ' + WAR_FORCE_SURRENDER_SCORE + '，还不够迫降' };
  }
  return { ok: true, war };
}

/** 生成条约草案（败方 = 被击败方）：赔款 + 物资移交 + 承认战败 */
export function draftTreaty(war, loserWealth, loserGoods) {
  const reparations = Math.max(500, Math.round((Number(loserWealth) || 0) * TREATY_REPARATION_RATE));
  const goods = {};
  for (const k in (loserGoods || {})) {
    const v = Number(loserGoods[k]) || 0;
    if (v > 0) goods[k] = Math.floor(v * 0.4);
  }
  return { reparations, goods, admitted: true, at: Date.now() };
}

/** 结束战争（写入条约）。winner: 'me' | 'them' */
export function endWar(acc, targetId, winner, treaty, note) {
  const war = warWith(acc, targetId);
  if (!war) return { ok: false, reason: '没有与该目标的进行中战争' };
  war.status = 'ended';
  war.endedAt = Date.now();
  war.treaty = Object.assign({ winner: winner === 'them' ? 'them' : 'me' }, treaty || {});
  pushLog(acc, war, '签订条约：' + (winner === 'me' ? '我方' : '对方') + '获胜'
    + (note ? ' · ' + note : '') + ' —— 战争结束。');
  return { ok: true, war };
}

/** 投降（我方战败）：按对方条件签约结束 */
export function surrenderWar(acc, targetId, terms, note) {
  return endWar(acc, targetId, 'them', terms || {}, note || '我方投降');
}


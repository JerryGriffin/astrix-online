// ============================================================================
// 和平会议（v0.4.5 需求 4）—— 参考《钢铁雄心 4》的战后处置
// ============================================================================
//
// 设计背景：v0.3.x 的战争只有一种结局 —— 达到迫降线后签一份
//   「赔款 + 物资移交 + 承认战败」的单一和约（war.js#draftTreaty）。
//   玩家打赢之后**没有任何选择**：既不能吞并土地，也不能扶植傀儡，
//   于是「战争」与「占地」始终脱节 —— 打了胜仗，地图上一个战区也不会变。
//
// 本模块把战后处置做成**可选项**（对齐 HOI4 和平会议的思路）：
//   · 吞并 annexation      —— 取得对方全部战区（彻底消灭该势力）
//   · 殖民化 colonization   —— 把对方战区转为「殖民地」：不驻军、纯产出，
//                              但补给依赖本土、且易被对方反攻夺回
//   · 卫星国 satellite     —— 对方保留本土，改为附庸：上贡、不再独立宣战
//   · 合作政府 collaboration —— 扶植合作政权：长期资源来源 + 共享科研
//   · 瓜分领土 partition    —— 与**盟友**瓜分：盟友越多自己分到越少
//   · 赔款 reparations      —— 一次性掠夺（资源 + Ascoin）
//
// 关键设计：每种处置都有**真实代价与副作用**，不是换个文案。
//   · 吞并：占得多，但要驻军、补给压力大，且该国残余势力会报复
//   · 殖民化：产出高、驻军需求低，但被对方反扑时容易丢
//   · 卫星国/合作政府：最省事，但对方保留独立外交与战力，日后可能翻脸
//   · 瓜分：盟友分走一部分，换来盟友参战
//
// 不 import state.js（账号对象由调用方传入），与 war.js 同构。
// ============================================================================

import { HOI_BY_ID } from '../data/hoi1936.js?v=56.7';
import {
  regionsOf, applyTreatyToTheater, treatyOutputMulOf,
} from './theater.js?v=56.7';

// --- 和约选项 -------------------------------------------------------------
export const TREATY_OPTIONS = [
  {
    id: 'annex', nameCn: '吞并', icon: '⚔',
    desc: '取得对方全部战区，势力彻底消失。占得最多，但要长期驻军、补给压力大。',
    cost: { score: 60 },
    effect: '得到对方全部战区；该国从地图上消失',
    risk: '驻军与补给压力最高',
  },
  {
    id: 'colonization', nameCn: '殖民化', icon: '🛰',
    desc: '把对方战区转为殖民地：不需驻军、产出更高，但补给依赖本土，易被反扑夺回。',
    cost: { score: 60 },
    effect: '战区变为殖民地，产出 ×1.6、驻军需求大幅降低',
    risk: '防守薄弱，被反攻容易丢失',
  },
  {
    id: 'satellite', nameCn: '卫星国', icon: '🛰',
    desc: '对方保留本土，改为附庸：按期上贡，不能再独立宣战。',
    cost: { score: 55 },
    effect: '对方成为附庸，按期上贡资源',
    risk: '保留独立外交与战力，日后可能翻脸',
  },
  {
    id: 'collaboration', nameCn: '合作政府', icon: '🤝',
    desc: '扶植合作政权：保留其名义主权，换取长期资源与科研共享。',
    cost: { score: 55 },
    effect: '建立合作政权，长期提供资源与研究点',
    risk: '合作度随时间衰减，需维持',
  },
  {
    id: 'partition', nameCn: '瓜分领土', icon: '⚖',
    desc: '与盟友瓜分对方领土：盟友越多，自己分到越少，但换来盟友参战。',
    cost: { score: 60 },
    effect: '按盟友数量瓜分战区',
    risk: '盟友分走大部分，自己所得有限',
  },
  {
    id: 'reparations', nameCn: '赔款', icon: '💰',
    desc: '只掠夺资源与资金，不改变领土。最保守的选择。',
    cost: { score: 50 },
    effect: '一次性获得资源与 Ascoin',
    risk: '对方国力未损，日后必然再战',
  },
];

export function treatyOptions() { return TREATY_OPTIONS.slice(); }

export function treatyOptionById(id) {
  return TREATY_OPTIONS.find((o) => o.id === id) || null;
}

// --- 参数 ----------------------------------------------------------------
export const SATELLITE_TRIBUTE_RATE = 0.18;      // 附庸上贡：其产出的一部分
export const COLLABORATION_RATE = 0.12;          // 合作政府：长期资源分成
export const COLLABORATION_RESEARCH = 0.03;      // 合作政府：研究点分成
export const COLLABORATION_DECAY_PER_DAY = 0.004; // 合作度自然衰减
export const REPARATION_RATE = 0.45;             // 赔款 = 对方财富的百分比

// v0.4.7：殖民化产出加成的**唯一来源**。
//   此前这里写 COLONIZATION_OUTPUT_MUL = 1.6、theater.js 写 TREATY_COLONY_OUTPUT_MUL = 1.6，
//   ui/treaty.js 的文案里还有两处字面量 1.6 —— 同一个数字四个地方。
//   现统一由 theater.js 导出（真正参与地图结算的那个），本文件 import 后再转出，
//   保证老调用方仍能拿到常量，但**只有一个值**。
import {
  TREATY_COLONY_OUTPUT_MUL as COLONIZATION_OUTPUT_MUL,
  TREATY_COLONY_GARRISON_MUL as COLONIZATION_GARRISON_MUL,
} from './theater.js?v=56.7';
export { COLONIZATION_OUTPUT_MUL, COLONIZATION_GARRISON_MUL };

// v0.4.7：上贡/科研积分 → Ascoin / 研究点 的换算汇率。
//   tickVassals 返回的 tribute/research 是「战区产出 × 分成率 × 忠诚度 × dt」的**积分**，
//   量级很小（远小于 1），直接入账几乎看不出变化。state.js 此前写死 `* 1000`
//   却没有任何注释说明依据，属于典型魔法数 —— 此处显式命名，含义写进注释。
export const VASSAL_ASCOIN_RATE = 1000;          // 1 积分上贡 → 1000 Ascoin
export const VASSAL_RESEARCH_RATE = 1000;        // 1 积分科研 → 1000 研究点

/** 某选项在当前战局下是否可用（并给出不可用原因） */
export function treatyAvailability(acc, war, optionId) {
  const opt = treatyOptionById(optionId);
  if (!opt) return { ok: false, reason: '未知的和约类型' };
  if (!war || war.status !== 'active') return { ok: false, reason: '这场战争不在进行中' };
  const my = Number(war.myScore) || 0;
  const need = Number(opt.cost && opt.cost.score) || 0;
  if (my < need) return { ok: false, reason: '战争分数不足：' + my + '/' + need };
  if (optionId === 'partition') {
    const allies = allyCountOf(acc, war);
    if (allies <= 0) return { ok: false, reason: '瓜分需要至少 1 个盟友（当前没有盟友参战）' };
  }
  return { ok: true, option: opt };
}

/** 我方盟友数（用于瓜分）：1936 剧本里与我有共同敌人的国家视为盟友 */
export function allyCountOf(acc, war) {
  // 当前剧本用「共同参战方」表示盟友：acc.allies 由外交层写入；
  // 没有外交层时退化为 0（不可瓜分），保证不会凭空分给不存在的盟友。
  const list = Array.isArray(acc && acc.allies) ? acc.allies : [];
  return list.length;
}

/** 瓜分时各方份额：盟友越多，我方分到越少（HOI4 的和谈分赃逻辑） */
export function partitionShares(acc, war) {
  const allies = allyCountOf(acc, war);
  const shares = [{ id: acc.id, name: '我方', share: 1 / (allies + 1), isMe: true }];
  for (const a of (Array.isArray(acc.allies) ? acc.allies : [])) {
    shares.push({ id: a.id, name: a.nameCn || a.name || '盟友', share: 1 / (allies + 1), isMe: false });
  }
  return shares;
}

// ============================================================================
// 和约应用 —— 由调用方（theater.js / war.js）传入具体副作用函数，
// 避免本模块反向依赖地图层，保持单向分层。
// ============================================================================

/**
 * 计算（但不执行）一份和约的完整结果，供 UI 预览与结算共用。
 * @param {object} env {
 *   regionsOfFoe: 该国在我方地图上拥有的战区数组,
 *   allyCount, foeWealth, foeOutput
 * }
 */
export function treatyOutcome(acc, war, optionId, env) {
  const e = env || {};
  const opt = treatyOptionById(optionId);
  if (!opt) return null;
  const foeRegions = Array.isArray(e.regionsOfFoe) ? e.regionsOfFoe : [];
  const allies = Math.max(0, Number(e.allyCount) || 0);
  const out = {
    id: opt.id, nameCn: opt.nameCn, effect: opt.effect, risk: opt.risk,
    regionsTaken: 0, regionsToAllies: 0,
    reparations: 0, tribute: 0, outputBonus: 0, researchBonus: 0,
  };
  if (optionId === 'annex') {
    out.regionsTaken = foeRegions.length;
    out.outputBonus = 1.0;
  } else if (optionId === 'colonization') {
    out.regionsTaken = foeRegions.length;
    out.outputBonus = COLONIZATION_OUTPUT_MUL;
  } else if (optionId === 'partition') {
    const mine = Math.floor(foeRegions.length / (allies + 1));
    out.regionsTaken = mine;
    out.regionsToAllies = foeRegions.length - mine;
  } else if (optionId === 'satellite') {
    out.tribute = SATELLITE_TRIBUTE_RATE;
  } else if (optionId === 'collaboration') {
    out.outputBonus = COLLABORATION_RATE;
    out.researchBonus = COLLABORATION_RESEARCH;
  } else if (optionId === 'reparations') {
    out.reparations = Math.round(Math.max(500, (Number(e.foeWealth) || 0) * REPARATION_RATE));
  }
  return out;
}

/** 战后把「附庸 / 合作政府」记进账号（供 tick 持续结算） */
export function registerVassalState(acc, war, optionId) {
  if (!acc) return null;
  if (!Array.isArray(acc.vassals)) acc.vassals = [];
  if (!Array.isArray(acc.collaborators)) acc.collaborators = [];
  const n = HOI_BY_ID[String(war && war.targetId || '').replace(/^hoi_/, '')];
  const entry = {
    nationId: String(war && war.targetId || ''),
    nameCn: (n && n.nameCn) || (war && war.targetName) || '附庸',
    kind: optionId === 'collaboration' ? 'collaboration' : 'satellite',
    since: Date.now(),
    lastPay: 0,
    loyalty: 1,            // 合作度 / 忠诚度（会随时间衰减）
  };
  const i = acc.vassals.findIndex((v) => v && v.nationId === entry.nationId);
  if (i >= 0) acc.vassals[i] = entry; else acc.vassals.push(entry);
  return entry;
}

/**
 * 每 tick 结算附庸 / 合作政府的上贡与忠诚衰减（由 state.js 接线）。
 * @param {object} fns { outputOf(nationId), wealthOf(nationId) } —— 由调用方注入，避免依赖地图层
 */
export function tickVassals(acc, dtSec, fns) {
  if (!acc || !Array.isArray(acc.vassals) || !acc.vassals.length) return null;
  const dt = Number(dtSec) || 0;
  if (!(dt > 0)) return null;
  const days = dt / 86400 * 3600;   // 与游戏时间轴对齐：1 秒 ≈ 1 天（1936 剧本口径）
  let tribute = 0, research = 0;
  for (const v of acc.vassals) {
    if (!v) continue;
    v.loyalty = Math.max(0.15, (Number(v.loyalty) || 1) - COLLABORATION_DECAY_PER_DAY * days);
    let out = 0;
    try { out = (fns && fns.outputOf) ? (Number(fns.outputOf(v.nationId)) || 0) : 0; } catch (e) { out = 0; }
    if (v.kind === 'satellite') {
      tribute += out * SATELLITE_TRIBUTE_RATE * v.loyalty * dt;
    } else if (v.kind === 'collaboration') {
      tribute += out * COLLABORATION_RATE * v.loyalty * dt;
      research += out * COLLABORATION_RESEARCH * v.loyalty * dt;
    }
  }
  return { tribute, research, count: acc.vassals.length };
}

/**
 * 签订和约（v0.4.5）：**唯一入口** —— 把「选哪一种处置」与「真正落地」绑在一起。
 *
 * 此前 UI 直接调 `applyPostwarChoice`（hoi1936.js），而那个函数只改工业值与名字，
 * 地图上一个战区都不会变。本函数是新的唯一入口，UI 不应再直接调旧函数。
 *
 * @param {object} env {
 *   foeWealth: 对方财富（赔款用）,
 *   loserGoods: 对方物资（移交用）,
 *   applyMap: (acc, war, optionId, allyCount) => 地图改动（注入避免循环依赖时可省）,
 *   grantAscoin: (n) => void
 * }
 */
export function signTreaty(acc, war, optionId, env) {
  const e = env || {};
  const chk = treatyAvailability(acc, war, optionId);
  if (!chk.ok) return chk;
  const opt = chk.option;
  const t = regionsOf(acc, war.targetId);
  const allies = allyCountOf(acc, war);
  const out = treatyOutcome(acc, war, optionId, {
    regionsOfFoe: t,
    allyCount: allies,
    foeWealth: e.foeWealth,
  });

  // ---- 地图改动（领土 / 殖民地 / 瓜分）----
  let map = null;
  try {
    map = (typeof e.applyMap === 'function')
      ? e.applyMap(acc, war, optionId, allies)
      : applyTreatyToTheater(acc, war, optionId, allies);
  } catch (err) {
    console.error('[signTreaty] 地图处置失败:', optionId, err);
    return { ok: false, reason: '地图处置失败：' + (err && err.message) };
  }

  // ---- 附庸 / 合作政府登记（供 tickVassals 持续结算）----
  let vassal = null;
  if (optionId === 'satellite' || optionId === 'collaboration') {
    vassal = registerVassalState(acc, war, optionId);
    if (vassal && Array.isArray(acc.npcAllies)) {
      if (acc.npcAllies.indexOf(vassal.nameCn) < 0) acc.npcAllies.push(vassal.nameCn);
    }
  }

  // ---- 赔款入账 ----
  if (optionId === 'reparations' && out && out.reparations > 0) {
    if (typeof e.grantAscoin === 'function') e.grantAscoin(out.reparations);
    else acc.ascoin = (Number(acc.ascoin) || 0) + out.reparations;
  }

  const summary = buildTreatySummary(opt, out, map, vassal);
  if (Array.isArray(acc.warLog)) {
    acc.warLog.unshift({ at: Date.now(), text: '【和平会议】' + summary });
  }
  return { ok: true, option: opt, outcome: out, map, vassal, summary };
}

/** 生成一句人话摘要（写战史 + 给 UI 直接显示） */
export function buildTreatySummary(opt, out, map, vassal) {
  if (!opt) return '';
  const p = [];
  p.push('【' + opt.nameCn + '】');
  if (out && out.regionsTaken > 0) p.push('取得战区 ' + out.regionsTaken + ' 处');
  if (map && map.colonies && map.colonies.length) {
    p.push('其中 ' + map.colonies.length + ' 处划为殖民地（产出 ×1.6、驻军需求降至 35%）');
  }
  if (out && out.regionsToAllies > 0) {
    p.push('分予盟友 ' + out.regionsToAllies + ' 处');
  }
  if (out && out.reparations > 0) p.push('赔款 ' + out.reparations + ' Ascoin');
  if (vassal) {
    p.push(vassal.kind === 'satellite'
      ? ('「' + vassal.nameCn + '」成为附庸，按期上贡')
      : ('扶植「' + vassal.nameCn + '」为合作政府，共享资源与研究'));
  }
  if (p.length === 1) p.push('仅掠夺资源，领土归属不变');
  return p.join('，') + '。';
}

/** 某个国家是否已是我的附庸/合作政府（外交层判断用） */
export function isVassalOf(acc, nationId) {
  if (!acc || !Array.isArray(acc.vassals)) return null;
  return acc.vassals.find((v) => v && v.nationId === String(nationId)) || null;
}
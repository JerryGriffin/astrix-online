// 电脑账号（Astrix v0.1.0）
// 纯算法模块：**不 import state.js / shop.js**（避免与 state 形成循环依赖）。
// 需要外部能力（价格、建议价、扣税等）时由 state.js 通过 env 传进来。
//
// 设计者 [重要] 需求：
//   「离线存档中新建几个会不断发展的电脑账号，可能与玩家冲突或贸易，
//     他们也会购买 ast1 中的商品导致价格浮动，增加一个电脑 Royal，已经是大后期水平，但较为友好」
//   「电脑也会向交易池中投入自己的物品」
//
// 数据落在账号上：acc.npcs = [{ id, nameCn, power, friendliness, ascoin, inventory, lastTick }]
// 事件：acc.npcEvents = [{ id, npcId, kind, message, at }]（只记录，供 UI 展示）

import { MATERIALS } from '../data/materials.js?v=21.1';

// 4 个电脑账号：3 个普通 + Royal（大后期但友好）
const NPC_DEFS = [
  { key: 'pioneer', nameCn: '开拓者', power: 0.35, friendliness: 0.55, ascoin: 2e6,
    desc: '务实的中期势力，偏好买卖矿石与合金。' },
  { key: 'guild', nameCn: '商会', power: 0.50, friendliness: 0.45, ascoin: 8e6,
    desc: '精于算计的贸易集团，出手频繁。' },
  { key: 'scavenger', nameCn: '拾荒团', power: 0.25, friendliness: 0.60, ascoin: 6e5,
    desc: '游走边缘的小势力，常低价抛货。' },
  { key: 'royal', nameCn: 'Royal', power: 0.90, friendliness: 0.85, ascoin: 5e9,
    desc: '大后期势力，对玩家最友好，愿意以高价收购与赠送稀有物资。' },
];

/** 惰性初始化电脑账号（老存档安全） */
export function ensureNpcs(acc) {
  if (!acc) return [];
  if (!Array.isArray(acc.npcs)) acc.npcs = [];
  for (const def of NPC_DEFS) {
    if (acc.npcs.some((n) => n && n.key === def.key)) continue;
    acc.npcs.push({
      id: 'npc_' + def.key,
      key: def.key,
      nameCn: def.nameCn,
      desc: def.desc,
      power: def.power,             // 发展阶段 0~1
      friendliness: def.friendliness, // 友善度 0~1
      ascoin: def.ascoin,
      inventory: {},
      lastTick: 0,
    });
  }
  if (!Array.isArray(acc.npcEvents)) acc.npcEvents = [];
  return acc.npcs;
}

export function listNpcs(acc) {
  return ensureNpcs(acc);
}

export function npcEventsOf(acc) {
  if (!acc) return [];
  if (!Array.isArray(acc.npcEvents)) acc.npcEvents = [];
  return acc.npcEvents;
}

export function clearNpcEvent(acc, eventId) {
  if (!acc || !Array.isArray(acc.npcEvents)) return false;
  const i = acc.npcEvents.findIndex((e) => e && e.id === eventId);
  if (i < 0) return false;
  acc.npcEvents.splice(i, 1);
  return true;
}

let _seq = 0;
function genEventId() {
  _seq = (_seq + 1) % 100000;
  return 'npcev_' + Date.now().toString(36) + '_' + _seq;
}
function pushEvent(acc, npc, kind, message) {
  if (!Array.isArray(acc.npcEvents)) acc.npcEvents = [];
  acc.npcEvents.push({ id: genEventId(), npcId: npc.id, npcNameCn: npc.nameCn, kind, message, at: Date.now() });
  // 只保留最近 30 条，避免存档膨胀
  if (acc.npcEvents.length > 30) acc.npcEvents.splice(0, acc.npcEvents.length - 30);
}

// 电脑账号会产出的材料池（按发展阶段挑选）
const NPC_MATS_LOW = ['石头', '泥土', '有机质', '水', '粘土', '石墨'];
const NPC_MATS_MID = ['铁', '铜', '锌', '铝', '钢', '玻璃', '陶瓷', '石英', '赤铁矿'];
const NPC_MATS_HIGH = ['钛', '钨', '锰', '银', '金', '钢', '铝合金', '碳化钨', '钛合金'];

// v0.1.2 R9：装备类商品池（外壳 / 引擎 / 武器 / 设施部件）。
// 键约定走 partId@材料（与 v0.1.1 贡品契约同口径），材料只取有强度属性的常见材料。
// 中阶势力卖低阶部件，高阶（含 Royal）卖中高阶部件。
const NPC_EQUIP_MID = ['hull_s_mk1', 'engine_basic', 'wpn_mg_mk1', 'fac_crew_mk1'];
const NPC_EQUIP_HIGH = [
  'hull_m_mk1', 'hull_l_mk1', 'engine_heavy_mk1', 'engine_super_mk1',
  'wpn_cannon_mk1', 'wpn_rocket_mk1', 'fac_cargo_l_mk1', 'fac_armor_mk1',
];
// 装备可附着的材料（影响强度 → 价格）
const NPC_EQUIP_MATS = ['铁', '钢', '钛', '铝合金', '钛合金', '碳化钨'];

function matPool(power) {
  if (power >= 0.8) return NPC_MATS_HIGH.concat(NPC_MATS_MID);
  if (power >= 0.45) return NPC_MATS_MID.concat(NPC_MATS_LOW);
  return NPC_MATS_LOW;
}

// v0.1.2 R9：按阶段挑装备部件 id 池
function equipPool(power) {
  if (power >= 0.45) return NPC_EQUIP_HIGH.concat(NPC_EQUIP_MID);
  return NPC_EQUIP_MID;
}

// v0.1.2 R9：随机生成一个合法装备键（partId@材料）
function pickEquipKey(power) {
  const pool = equipPool(power);
  const partId = pool[Math.floor(Math.random() * pool.length)];
  const mat = NPC_EQUIP_MATS[Math.floor(Math.random() * NPC_EQUIP_MATS.length)];
  return partId + '@' + mat;
}

/**
 * 电脑账号随时间发展（每秒由 state.js 的心跳调用）
 *   env = {
 *     priceOf(mat) -> number,             // 商店当前价
 *     bumpPrice(mat, mul) -> void,        // 成交推动（买涨）
 *     suggestPriceOf(mat) -> number,      // 建议售价
 *     listOnMarket(npc, mat, qty, price), // 把电脑的货挂到交易池
 *     takeFromMarket(npc, mat, price),    // 电脑买入玩家/他人的低价挂单（返回成交后的价格）
 *   }
 */
export function tickNpcs(acc, dt, env) {
  if (!acc) return;
  const npcs = ensureNpcs(acc);
  env = env || {};
  dt = Math.max(0, Number(dt) || 0);
  if (!(dt > 0)) return;

  for (const npc of npcs) {
    // 1) 发展：阶段缓慢上升（Royal 起步就是 0.9，几乎封顶）
    const cap = npc.key === 'royal' ? 1 : 0.95;
    npc.power = Math.min(cap, (Number(npc.power) || 0) + 0.00002 * dt);

    // 2) 产出：阶段越高产得越多
    const rate = (0.5 + npc.power * 8) * dt;          // 每秒产出的「批数」
    const pool = matPool(npc.power);
    const pickMat = pool[Math.floor(Math.random() * pool.length)];
    npc.inventory[pickMat] = (Number(npc.inventory[pickMat]) || 0) + rate;

    // 3) 赚钱（模拟贸易利润）
    npc.ascoin += (1e3 + npc.power * 5e4) * dt;

    // 4) 买入交易池里的低价挂单（价格越低越可能成交 —— 由 env 侧实现概率判定）
    if (!npc._buyAcc) npc._buyAcc = 0;
    npc._buyAcc += dt;
    if (npc._buyAcc >= 5 && typeof env.takeFromMarket === 'function') {   // 每 5 秒尝试一次
      npc._buyAcc = 0;
      const r = env.takeFromMarket(npc);
      if (r && r.bought) {
        pushEvent(acc, npc, 'trade',
          npc.nameCn + ' 以 ' + Math.round(r.price) + ' Ascoin 买走了挂牌的 ' + r.mat + ' ×' + r.qty + '。');
      }
    }

    // 5) 向交易池投入自己的物品（阶段越高、越可能挂单）
    // v0.1.2 R9：挂单频率大幅提高 —— 改前 listEvery：royal 12s / 其它 25s → 改后 royal 0.5s / 其它 0.7s
    // （配合交易池上限 40→120，且电脑买家 tickListings 按原式成交，挂单量明显增多、池内可选项更丰富）。
    if (!npc._listAcc) npc._listAcc = 0;
    npc._listAcc += dt;
    const listEvery = npc.key === 'royal' ? 0.5 : 0.7;
    if (npc._listAcc >= listEvery && typeof env.listOnMarket === 'function') {
      npc._listAcc = 0;
      // v0.1.2 R9：阶段 ≥0.45 的势力有概率卖装备而非材料（每次挂单二选一，避免挤占材料供给）
      const sellEquip = npc.power >= 0.45 && Math.random() < 0.6;
      if (sellEquip) {
        const mat = pickEquipKey(npc.power);
        const qty = 1 + Math.floor(Math.random() * 2);   // 装备 1~3 件
        const base = typeof env.suggestPriceOf === 'function' ? env.suggestPriceOf(mat) : 500;
        const mul = npc.key === 'royal' ? (0.9 + Math.random() * 0.2) : (1.0 + Math.random() * 0.4);
        const price = Math.max(1, Math.round(base * mul));
        env.listOnMarket(npc, mat, qty, price);
      } else {
        const mats = Object.keys(npc.inventory).filter((m) => Number(npc.inventory[m]) >= 5);
        if (mats.length) {
          const mat = mats[Math.floor(Math.random() * mats.length)];
          const qty = Math.floor(Math.min(npc.inventory[mat], 5 + Math.random() * 40));
          if (qty > 0) {
            const base = typeof env.suggestPriceOf === 'function' ? env.suggestPriceOf(mat) : 100;
            // 普通势力挂得偏贵（想赚），Royal 挂得便宜（友好）
            const mul = npc.key === 'royal' ? (0.9 + Math.random() * 0.2) : (1.0 + Math.random() * 0.4);
            const price = Math.max(1, Math.round(base * mul));
            npc.inventory[mat] = Math.max(0, npc.inventory[mat] - qty);
            env.listOnMarket(npc, mat, qty, price);
          }
        }
      }
    }

    // 6) 偶发事件（只记录，不扣玩家东西）
    if (!npc._evAcc) npc._evAcc = 0;
    npc._evAcc += dt;
    if (npc._evAcc >= 120) {          // 每 2 分钟一次
      npc._evAcc = 0;
      const roll = Math.random();
      const friendly = (Number(npc.friendliness) || 0.5) >= 0.7;
      if (roll < 0.45) {
        pushEvent(acc, npc, 'trade',
          npc.nameCn + ' 在市场抛出了 ' + (NPC_MATS_LOW.concat(NPC_MATS_MID))[Math.floor(Math.random() * 12)] + '，价格有波动。');
      } else if (roll < 0.75 && !friendly) {
        pushEvent(acc, npc, 'conflict', npc.nameCn + ' 在你常走的航路上活动，注意舰队巡航。');
      } else {
        pushEvent(acc, npc, 'gift',
          friendly
            ? npc.nameCn + ' 向你致意，表示愿意在贸易中给你让利。'
            : npc.nameCn + ' 传来一份含糊的问候。');
      }
    }
  }
}

/** 电脑账号总览（UI 用） */
export function npcSummary(acc) {
  return ensureNpcs(acc).map((n) => ({
    id: n.id, nameCn: n.nameCn, desc: n.desc,
    power: Math.round((Number(n.power) || 0) * 100),
    friendliness: Math.round((Number(n.friendliness) || 0) * 100),
    ascoin: Math.floor(Number(n.ascoin) || 0),
    mats: Object.keys(n.inventory || {}).filter((m) => Number(n.inventory[m]) >= 1).length,
  }));
}

/** 材料表里是否存在（供估值兜底判断） */
export function isKnownMaterial(matName) {
  return MATERIALS.some((m) => m.nameCn === matName);
}

// 拍卖行（Astrix v0.2.6）：15 秒竞价窗口，出价最高者得；可拍卖资源 / 装备 / 飞船。
// 纯算法模块，零依赖，浏览器直接 import（state.js 心跳每秒调用 tickAuctions）。
//
// 设计者需求：
//   - 商店星改股市 + 拍卖：每种资源随时可买卖（股市）；同时做成「类似拍卖的机制」，
//     15 秒内出价最高的得到，每个人可以售卖资源、装备和舰队/飞船。
//   - 在线模式走云端真实跨玩家竞价；离线模式用本地 NPC 兜底。
//   说明：当前云后端（cloud.js）只有 1:1 私信表 galaxy_incidents，没有「公共可读拍卖板」，
//   故跨玩家在线竞价暂以本地 NPC 兜底（在线/离线同逻辑）；tickAuctions 预留 cloud 同步钩子，
//   若日后云端提供公共板即可无缝接入（见 opts.syncCloud）。

import { isEquipmentKey, ascoinOf, priceOf } from './shop.js?v=57.8';
import { ownedOf, spendOwned, getPlanetInstance } from './state.js?v=57.8';
import { equipmentList } from './shipyard.js?v=57.8';
import { MATERIALS } from '../data/materials.js?v=57.8';

const AUCTION_DEFAULT_SEC = 15;     // 竞价窗口（秒）
const AUCTION_FEE = 0.05;           // 卖家佣金（成交额的 5% 归平台）
const LOG_CAP = 12;                 // 成交/流拍记录保留条数

let _seq = 0;
function genAuctionId() {
  _seq = (_seq + 1) % 100000;
  return 'auc_' + Date.now().toString(36) + '_' + _seq;
}

export function ensureAuctions(acc) {
  if (!acc) return;
  if (!Array.isArray(acc.shopAuctions)) acc.shopAuctions = [];
  if (!Array.isArray(acc.shopAuctionLog)) acc.shopAuctionLog = [];
}

// ---- 可拍卖资产枚举（供 UI 构建「开拍」表单）----
// 资源：当前星球实例库存中持有的、可按名称交易的材料（不含装备键）
export function myAuctionableResources(acc, inst) {
  if (!inst || !Array.isArray(inst.inventory)) return [];
  const out = [];
  for (const e of inst.inventory) {
    if (!e || !e.mat) continue;
    if (isEquipmentKey(e.mat)) continue;
    const n = Number(e.owned) || 0;
    if (n > 0) out.push({ key: e.mat, label: e.mat, qty: n, kind: 'resource' });
  }
  return out;
}
// 装备：当前星球实例 inst.equipment 中持有的部件（key = partId@材料）
export function myAuctionableEquipment(acc, inst) {
  if (!inst || !inst.equipment) return [];
  return equipmentList(inst)
    .filter((e) => e.count > 0)
    .map((e) => ({ key: e.key, label: ((e.part && e.part.nameCn) || e.partId) + (e.material ? '（' + e.material + '）' : ''), qty: e.count, kind: 'equipment' }));
}
// 飞船：账号全局 acc.ships（飞船不属于某个星球实例，单独列出）
export function myAuctionableShips(acc) {
  if (!acc || !Array.isArray(acc.ships)) return [];
  return acc.ships.map((s) => ({ key: s.id, label: (s.name || s.className || '飞船'), qty: 1, kind: 'ship', ship: s }));
}

// ---- 资产托管（escrow）与退还 ----
function escrow(acc, inst, type, key, qty) {
  if (type === 'resource') {
    if (ownedOf(inst, key) < qty) return { ok: false, reason: '库存不足：需要 ' + qty + '，只有 ' + Math.floor(ownedOf(inst, key)) };
    spendOwned(inst, key, qty);
    return { ok: true };
  }
  if (type === 'equipment') {
    const eq = inst.equipment && inst.equipment[key];
    const have = eq ? (Number(eq.count) || 0) : 0;
    if (have < qty) return { ok: false, reason: '装备不足：需要 ' + qty + '，只有 ' + Math.floor(have) };
    eq.count = have - qty;
    if (eq.count <= 0) delete inst.equipment[key];
    return { ok: true };
  }
  if (type === 'ship') {
    const i = (acc.ships || []).findIndex((s) => s && s.id === key);
    if (i < 0) return { ok: false, reason: '找不到该飞船' };
    const ship = acc.ships.splice(i, 1)[0];
    return { ok: true, asset: ship };
  }
  return { ok: false, reason: '未知资产类型' };
}
function restore(acc, inst, type, key, qty, asset) {
  if (type === 'resource') {
    // 进库存（与 ownedOf 同口径：用 ensureEntry 找/建条目）
    if (inst && Array.isArray(inst.inventory)) {
      let e = inst.inventory.find((x) => x && x.mat === key);
      if (!e) { e = { mat: key, layer: 'refined', owned: 0 }; inst.inventory.push(e); }
      e.owned = (Number(e.owned) || 0) + qty;
    }
  } else if (type === 'equipment') {
    if (inst && inst.equipment) {
      const cur = inst.equipment[key];
      if (cur && typeof cur === 'object') cur.count = (Number(cur.count) || 0) + qty;
      else {
        const at = key.indexOf('@');
        inst.equipment[key] = { partId: key.slice(0, at), material: key.slice(at + 1) || null, count: qty };
      }
    }
  } else if (type === 'ship') {
    if (asset && Array.isArray(acc.ships) && !acc.ships.some((s) => s && s.id === asset.id)) acc.ships.push(asset);
  }
}

/**
 * 开拍：托管资产并写入一条拍卖。
 *   opts = { type:'resource'|'equipment'|'ship', key, qty, minBid, durationSec? }
 *   sellerId/sellerName 来自 acc（玩家本人）
 * → { ok, auction?, reason? }
 */
export function createAuction(acc, inst, opts) {
  if (!acc) return { ok: false, reason: '账号缺失' };
  const type = opts && opts.type;
  const key = opts && opts.key;
  const qty = Math.floor(Number(opts && opts.qty) || 0);
  const minBid = Math.floor(Number(opts && opts.minBid) || 0);
  const planetCode = (opts && opts.planetCode) || null;
  const dur = Math.max(5, Math.min(60, Math.floor(Number(opts && opts.durationSec) || AUCTION_DEFAULT_SEC)));
  if (!(type === 'resource' || type === 'equipment' || type === 'ship')) return { ok: false, reason: '资产类型无效' };
  if (!key) return { ok: false, reason: '未选择资产' };
  if (!(qty > 0)) return { ok: false, reason: '数量必须是正整数' };
  if (!(minBid > 0)) return { ok: false, reason: '起拍价必须是正数' };
  ensureAuctions(acc);
  const hold = type === 'ship' ? myAuctionableShips(acc).find((x) => x.key === key)
    : type === 'equipment' ? myAuctionableEquipment(acc, inst).find((x) => x.key === key)
    : myAuctionableResources(acc, inst).find((x) => x.key === key);
  if (!hold) return { ok: false, reason: '你当前没有该资产' };
  if (qty > hold.qty) return { ok: false, reason: '数量超过持有：最多 ' + hold.qty };
  const esc = escrow(acc, inst, type, key, qty);
  if (!esc.ok) return esc;
  const auction = {
    id: genAuctionId(),
    sellerId: acc.id,
    sellerName: acc.name || '玩家',
    type, key, label: hold.label, qty,
    planetCode,                  // 资产来源星球（流拍退还时回到此处）
    minBid,
    topBid: 0,
    topBidder: null,
    topBidderName: null,
    endsAt: Date.now() + dur * 1000,
    durationSec: dur,
    createdAt: Date.now(),
    status: 'active',         // active | ended
    asset: esc.asset || null, // 飞船托管对象（其余类型结算时按 key 重建）
    // v0.4.5（需求 3「过于离谱的拍卖价不要有人买」）：
    //   旧算法 `max(minBid*2, minBid*(2 + rand*20))` 让 NPC 上限高达起拍价的 **22 倍**，
    //   再叠加 tick 里 `topBid*(1.1~1.35)` 的复利式抬价，成交价会被推到天文数字。
    //   现改为**锚定公允价**（见 npcCeilingOf）。
    npcCeiling: npcCeilingOf(acc, type, key, qty, minBid),
  };
  acc.shopAuctions.push(auction);
  return { ok: true, auction };
}

/** v0.4.5：NPC 出价上限 —— 锚定市价，杜绝离谱成交价 */
export const NPC_MAX_FAIR_MULTIPLE = 1.8;   // 资源类：最高出到市价的 1.8 倍
export const NPC_FALLBACK_MULTIPLE = 1.5;   // 算不出市价时：最高出到起拍价的 1.5 倍
export function npcCeilingOf(acc, type, key, qty, minBid) {
  const base = Math.max(1, Number(minBid) || 1);
  let fair = 0;
  if (type === 'resource') {
    try {
      const one = priceOf(acc, key);
      if (one > 0) fair = one * (Number(qty) || 1);
    } catch (e) { fair = 0; }
  }
  if (fair > 0) {
    // 公允价过低时（玩家故意天价起拍想抬价）也不允许 NPC 超过起拍价的 1.5 倍
    const cap = Math.min(fair * NPC_MAX_FAIR_MULTIPLE, base * 1.5);
    return Math.max(base, Math.round(cap));
  }
  return Math.max(base, Math.round(base * NPC_FALLBACK_MULTIPLE));
}

/** 出价：amount 必须高于当前最高价（首拍需 ≥ 起拍价），且出价人不能拍自己的单 */
export function placeBid(acc, auctionId, amount, bidderId, bidderName) {
  if (!acc) return { ok: false, reason: '账号缺失' };
  ensureAuctions(acc);
  const a = acc.shopAuctions.find((x) => x && x.id === auctionId);
  if (!a) return { ok: false, reason: '找不到该拍卖' };
  if (a.status !== 'active') return { ok: false, reason: '该拍卖已结束' };
  if (a.sellerId && bidderId && a.sellerId === bidderId) return { ok: false, reason: '不能竞拍自己的拍卖' };
  const amt = Math.floor(Number(amount) || 0);
  const need = a.topBid > 0 ? a.topBid + 1 : a.minBid;
  if (!(amt >= need)) return { ok: false, reason: '出价需 ≥ ' + need + ' Ascoin' };
  // 玩家出价需校验余额；NPC 出价由 tick 内部直接给额度（不校验）
  if (bidderId === acc.id && ascoinOf(acc) < amt) return { ok: false, reason: 'Ascoin 不足：需要 ' + amt };
  a.topBid = amt;
  a.topBidder = bidderId;
  a.topBidderName = bidderName || '匿名';
  return { ok: true, amount: amt };
}

function settle(acc, inst, a) {
  ensureAuctions(acc);
  // 流拍退还目标星球：优先资产来源星球，回退到调用方传入的 inst
  const targetInst = (a.planetCode && typeof getPlanetInstance === 'function')
    ? getPlanetInstance(a.planetCode) : inst;
  if (a.topBid > 0 && a.topBidder) {
    const npcSeller = a.sellerId && String(a.sellerId).startsWith('npc_');
    if (npcSeller) {
      // v0.2.10 NPC 挂单：买家（本地玩家）支付货款，货由 restore() 发入玩家星球
      acc.ascoin = (Number(acc.ascoin) || 0) - a.topBid;
      restore(acc, targetInst, a.type, a.key, a.qty, a.asset);
      acc.shopAuctionLog.unshift({
        type: 'bought_npc', label: a.label, qty: a.qty, price: a.topBid,
        buyer: a.topBidderName || '匿名', seller: a.sellerName || '电脑势力', at: Date.now(),
      });
    } else {
      // 成交：卖家获得（成交额 ×(1-佣金)）
      const net = Math.round(a.topBid * (1 - AUCTION_FEE));
      acc.ascoin = (Number(acc.ascoin) || 0) + net;
      // 资产已被托管（escrow 时已移出），中标方（本地为 NPC）取得资产 → 不返还
      acc.shopAuctionLog.unshift({
        type: 'sold', label: a.label, qty: a.qty, price: a.topBid,
        net, buyer: a.topBidderName || '匿名', at: Date.now(),
      });
    }
  } else if (a.sellerId && String(a.sellerId).startsWith('npc_')) {
    // NPC 挂单流拍：无货可退，仅记日志移除
    acc.shopAuctionLog.unshift({
      type: 'noflow', label: a.label, qty: a.qty, at: Date.now(),
    });
  } else {
    // 流拍：退还资产给卖家（回到来源星球）
    restore(acc, targetInst, a.type, a.key, a.qty, a.asset);
    acc.shopAuctionLog.unshift({
      type: 'noflow', label: a.label, qty: a.qty, at: Date.now(),
    });
  }
  if (acc.shopAuctionLog.length > LOG_CAP) acc.shopAuctionLog.length = LOG_CAP;
}

/**
 * 每秒推进拍卖：倒计时、NPC 出价、到期结算。
 *   opts.online    是否在线模式（当前同本地 NPC 兜底，预留云端同步钩子）
 *   opts.syncCloud 可选异步同步函数（云端公共板）；不存在则忽略
 * dt 单位秒。
 */
export function tickAuctions(acc, dt, opts) {
  if (!acc) return;
  ensureAuctions(acc);
  const inst = (opts && opts.getInst) ? opts.getInst() : null;
  const steps = Math.max(1, Math.ceil(Number(dt) || 1));
  for (let s = 0; s < steps; s++) {
    for (const a of [...acc.shopAuctions]) {
      if (a.status !== 'active') continue;
      if (Date.now() >= a.endsAt) {
        a.status = 'ended';
        settle(acc, inst, a);
        const i = acc.shopAuctions.indexOf(a);
        if (i >= 0) acc.shopAuctions.splice(i, 1);
        continue;
      }
      // NPC 兜底出价：在窗口内持续抬高，逼近 npcCeiling（v0.2.10：NPC 自己的挂单不参与）
      const npcSeller = a.sellerId && String(a.sellerId).startsWith('npc_');
      const remainMs = a.endsAt - Date.now();
      const remainSec = remainMs / 1000;
      // 越临近结束出价越积极；但不超过上限
      const p = Math.min(0.9, 0.25 + (1 - Math.min(1, remainSec / a.durationSec)) * 0.5);
      if (!npcSeller && a.topBid < a.npcCeiling && Math.random() < p) {
        // v0.4.5：抬价幅度收敛（原 1.1~1.35 会复利式滚到天文数字），
        //   且**永远不会超过 npcCeiling**（该上限已由市价锚定）。
        const step = a.topBid > 0
          ? Math.max(1, Math.round(a.topBid * (1.04 + Math.random() * 0.10)))
          : a.minBid;
        const next = Math.min(a.npcCeiling, step);
        if (next > a.topBid) {
          a.topBid = next;
          a.topBidder = 'npc';
          a.topBidderName = '星际买家';
        }
      }
      // 在线模式预留：真实跨玩家竞价（当前云后端无公共板，钩子为空则跳过）
      if (opts && typeof opts.syncCloud === 'function') {
        try { opts.syncCloud(a); } catch (e) { /* 忽略云端同步错误 */ }
      }
    }
  }
}

/**
 * NPC 拍卖挂单生成器（v0.2.10）：拍卖行实时出现电脑势力的挂单，玩家竞价拿货。
 * 每 60~120 秒尝试一次；活跃拍卖 ≥ 8 时不再生成；时长 3~8 分钟。
 * 起拍价按市价 ×0.7~1.0；无 NPC 自己竞价，流拍直接移除。
 */
const NPC_AUCTION_SELLERS = ['开拓者商会', '商队自由港', '拾荒团', '皇家堡垒'];
const NPC_AUCTION_ACTIVE_CAP = 8;
let _npcAuctionNextAt = 0;

export function tickNpcAuctionSpawner(acc) {
  if (!acc) return;
  ensureAuctions(acc);
  if (Date.now() < _npcAuctionNextAt) return;
  _npcAuctionNextAt = Date.now() + (60 + Math.random() * 60) * 1000;
  const active = acc.shopAuctions.filter((x) => x && x.status === 'active');
  if (active.length >= NPC_AUCTION_ACTIVE_CAP) return;
  // 首次（池里还没有 NPC 单）连发 2 单，避免新会话空荡
  const npcActive = active.filter((x) => x.sellerId && String(x.sellerId).startsWith('npc_')).length;
  const spawnN = npcActive === 0 ? 2 : 1;
  const pool = MATERIALS.filter((m) => m.id !== 'gold');
  for (let i = 0; i < spawnN && active.length + i < NPC_AUCTION_ACTIVE_CAP; i++) {
    const m = pool[Math.floor(Math.random() * pool.length)];
    const qty = 10 + Math.floor(Math.random() * 190);
    const unit = Math.max(1, priceOf(acc, m.nameCn));
    const minBid = Math.max(1, Math.round(unit * qty * (0.7 + Math.random() * 0.3)));
    const dur = 180 + Math.floor(Math.random() * 300);
    const seller = NPC_AUCTION_SELLERS[Math.floor(Math.random() * NPC_AUCTION_SELLERS.length)];
    acc.shopAuctions.push({
      id: genAuctionId(),
      sellerId: 'npc_' + seller,
      sellerName: seller,
      type: 'resource', key: m.nameCn, label: m.nameCn, qty,
      planetCode: acc.homePlanetCode || null,
      minBid,
      topBid: 0, topBidder: null, topBidderName: null,
      endsAt: Date.now() + dur * 1000,
      durationSec: dur,
      createdAt: Date.now(),
      status: 'active',
      asset: null,
      npcCeiling: 0,   // NPC 不拍自己的单
    });
  }
}

export function activeAuctions(acc) {
  ensureAuctions(acc);
  return acc.shopAuctions.filter((a) => a && a.status === 'active')
    .map((a) => ({ ...a, remainMs: Math.max(0, a.endsAt - Date.now()) }))
    .sort((x, y) => x.endsAt - y.endsAt);
}
export function auctionLog(acc) {
  ensureAuctions(acc);
  return acc.shopAuctionLog || [];
}

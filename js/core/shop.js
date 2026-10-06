// 商店星 Ast1：物资 ↔ ascoin 互换（Astrix v0.0.92）
// 纯算法模块，零依赖，浏览器直接 import。
//
// 设计者 [重要] 需求：「新增一个星球-商店星 Ast1，可以用物资与 ascoin 互换，
//   价格实时改变，需要运输船运输」。
// 已确认的价格模型：**基准价 + 成交推动**（买涨卖跌）+ 随时间向基准价自然回归。
// 运输：本模块只负责「下单与结算」；**货必须由运输船运**（运输判定在 core/fleet.js，
//   订单上带 cells 供其判断载货格数是否够）。

import { MATERIALS } from '../data/materials.js?v=54.5';
import { ownedOf, spendOwned, currentAccount, STATE } from './state.js?v=54.5';
import { ensureEntry } from './production.js?v=54.5';
import { ASCOIN_PER_GOLD } from './currency.js?v=54.5';
// v0.1.2 R9：装备类交易键走 partId@材料（与 v0.1.1 贡品契约同口径），
// 需能识别部件 id 并估值，故引入部件数据表（PART_BY_ID）与 resolvePart。
import { PART_BY_ID } from '../data/ship_parts.js?v=54.5';
import { resolvePart } from './shipyard.js?v=54.5';

const MAT_BY_NAME = Object.fromEntries(MATERIALS.map((m) => [m.nameCn, m]));

// 需求22：金（gold）价格恒为 1048576 Ascoin（= ASCOIN_PER_GOLD，2^20），
// 不参与成交推动（买涨/卖跌）与自然回归。本模块所有会写 shopState price 的地方
// 都用此函数跳过金。mat 传材料的 nameCn。
function isGold(matName) {
  const m = MAT_BY_NAME[matName];
  return !!m && m.id === 'gold';
}

// ============================================================================
// 商店星本体（结构对齐 js/data/planets.js 的星球对象，但不写进那个文件）
// ============================================================================
export const SHOP_PLANET = {
  id: 'shop_ast1',
  code: 'ast1',
  nameCn: '商店星',
  nameEn: 'Ast1',
  type: '商业空间站',
  isShop: true,
  description: '一座往来商船云集的商业空间站：用物资换 ascoin，或用 ascoin 换物资，价格随成交实时变化。',
  orbit: { radius: 18, phase: 180 },
  layers: { surface: [], underground: [], deep: [], core: [] },
  gases: [],
  power: { totalEnergy: 0, hydro: 0, wind: 0, solar: 0 },
  population: { total: 0, available: 0 },
  needsImmigration: false,
  canRebel: false,
};

// ============================================================================
// 基准价：按材料的稀缺度给（自然 < 精炼 < 复合；再用强度+耐久微调）
// ============================================================================
function categoryOf(m) { return m.category || 'natural'; }

function basePriceOf(m) {
  // 需求22：金（gold）价格恒为 ASCOIN_PER_GOLD = 1048576 Ascoin（货币锚定，设计者规则
  // 「1048576 Ascoin 恒等于 1 金」），不套用普通材料公式，也不受成交浮动影响。
  if (m.id === 'gold' || m.nameCn === '金') return ASCOIN_PER_GOLD;
  // 镒（Eridium）：高级货币级物资，设计者明确「价格至少 1e8」。
  // 它是游戏内顶级稀有 + 高级结算货币，基准价单独抬到 1e8 起步，不受普通材料公式的 5000 上限约束。
  if (m.id === 'eridium' || m.nameCn === '镒') {
    const raw = 10 + (Number(m.strength) || 0) * 60 + (Number(m.durability) || 0) * 8;
    return Math.max(1e8, Math.round(raw));
  }
  const cat = categoryOf(m);
  const raw = 10 + (Number(m.strength) || 0) * 60 + (Number(m.durability) || 0) * 8;
  // v0.2.6 股市改版：基准价按层级拉开，并让「低级资源（natural）极度不值钱」——
  //   原 natural 档最低 10、与 refined(×2.5) 差距不大；现改为 natural 仅 ×0.12（几乎白送），
  //   refined ×1.0、composite ×4，凸显「越原始越廉价、越深加共越值钱」的股市感。
  if (cat === 'composite') return Math.max(50, Math.min(20000, Math.round(raw * 4)));
  if (cat === 'refined') return Math.max(5, Math.min(8000, Math.round(raw * 1.0)));
  return Math.max(1, Math.round(raw * 0.12));   // natural：极低基准价
}

// ============================================================================
// 商店星仓库（v0.2.6 股市）：每种物资的商店库存。买=从仓库减、卖=进仓库增；
// 仓库随心跳缓慢回补到基线，保证市场长期有供给。价格随成交实时涨跌（买涨卖跌）+ 自然回归。
// ============================================================================
export function warehouseBaseline(m) {
  const cat = categoryOf(m);
  if (m.id === 'gold') return 1e9;
  if (m.id === 'eridium') return 200;
  if (cat === 'composite') return 240;
  if (cat === 'refined') return 1200;
  return 6000;   // natural：低级资源库存极大（配合极低单价）
}

/** 惰性初始化账号的商店仓库：acc.shopWarehouse = { [matNameCn]: qty } */
export function ensureShopWarehouse(acc) {
  if (!acc) return;
  if (!acc.shopWarehouse || typeof acc.shopWarehouse !== 'object') acc.shopWarehouse = {};
  for (const m of MATERIALS) {
    if (acc.shopWarehouse[m.nameCn] == null) acc.shopWarehouse[m.nameCn] = warehouseBaseline(m);
  }
}

export function warehouseOf(acc, mat) {
  ensureShopWarehouse(acc);
  return Number(acc.shopWarehouse[mat]) || 0;
}

// 可交易物资：材料表里的全部 nameCn
const TRADABLES = MATERIALS.map((m) => m.nameCn);

// v0.1.2 R9：装备类交易键判定（与 v0.1.1 贡品契约 state.js#deliverTributeToHome 同口径）。
// 形如 'hull_s_mk1@钛'、'engine_basic@钢'、'wpn_mg@碳化钨'、'fac_crew_mk1@铝合金'，
// 即「部件 id @ 材料名」。材料名可空（部分设施部件不可选材料，键形如 'fac_x_mk1@'）。
export function isEquipmentKey(mat) {
  if (typeof mat !== 'string' || mat.indexOf('@') < 0) return false;
  const partId = mat.slice(0, mat.indexOf('@'));
  return !!PART_BY_ID[partId];
}

// 是否可交易：材料表内材料 或 合法装备键（v0.1.2 R9 扩展，供 buy/sell 放行装备）
function isTradable(mat) {
  return TRADABLES.indexOf(mat) >= 0 || isEquipmentKey(mat);
}

// 装备估值（仅作挂单参考价 / 直售价，不参与成交推动）：用 resolvePart 拿实装主属性。
function equipmentValue(mat) {
  const i = mat.indexOf('@');
  const partId = mat.slice(0, i);
  const material = mat.slice(i + 1) || null;
  const p = resolvePart(partId, material);
  if (!p) return 0;
  // 主属性锚：外壳结构 / 引擎推力 / 武器伤害 / 设施占地或结构加成 / 容量，取最大者
  const power = Math.max(
    Number(p.struct) || 0, Number(p.damage) || 0, Number(p.thrust) || 0,
    Number(p.capacity) || 0, Number(p.footprint) || 0, 1,
  );
  // 质量越大越贵（用料多），给个温和折减避免轻件过廉
  const massPenalty = Math.max(0.4, 1 / (1 + (Number(p.mass) || 1) / 60));
  return Math.max(50, Math.round(power * 40 * (Number(p.structMul) || 1) * massPenalty));
}

/** 惰性初始化账号的商店状态：acc.shopState = { [mat]: { price, base } } */
export function shopStateOf(acc) {
  if (!acc) return {};
  if (!acc.shopState || typeof acc.shopState !== 'object') acc.shopState = {};
  ensureShopWarehouse(acc);   // v0.2.6：同步初始化商店仓库
  for (const m of MATERIALS) {
    if (!acc.shopState[m.nameCn]) {
      const base = basePriceOf(m);
      acc.shopState[m.nameCn] = { price: base, base };
    }
    // 需求22：金恒价——旧存档里金的 base/price 可能是旧公式价（1175）或被浮动过，
    // 一律强制校正回 ASCOIN_PER_GOLD，保证「买价/卖价恒为 1048576」。
    else if (m.id === 'gold') {
      const g = acc.shopState[m.nameCn];
      if ((Number(g.price) || 0) !== ASCOIN_PER_GOLD || (Number(g.base) || 0) !== ASCOIN_PER_GOLD) {
        g.price = ASCOIN_PER_GOLD;
        g.base = ASCOIN_PER_GOLD;
      }
    }
  }
  return acc.shopState;
}

export function priceOf(acc, mat) {
  const st = shopStateOf(acc)[mat];
  if (st) return Number(st.price) || 0;
  if (isEquipmentKey(mat)) return equipmentValue(mat);   // v0.1.2 R9：装备直估价
  const m = MATERIALS.find((x) => x.nameCn === mat);
  return m ? basePriceOf(m) : 0;
}

/** 全部报价（按价格降序） */
export function shopPrices(acc) {
  const st = shopStateOf(acc);
  return Object.keys(st)
    .map((mat) => ({ mat, price: Number(st[mat].price) || 0, base: Number(st[mat].base) || 0 }))
    .sort((a, b) => b.price - a.price || a.mat.localeCompare(b.mat, 'zh'));
}

/** 价格自然回归 + 仓库缓慢回补（由心跳每秒调用）。金恒价跳过回归 */
export function tickShop(acc, dt, opts) {
  if (!acc) return;
  const st = shopStateOf(acc);
  // v0.2.12：在线共享市场（fleet.js 共享同步已接管价格 / 仓库回补）——
  //   跳过本地价格回归 + 仓库回补 + 随机噪声，保证全服价格与库存一致
  if (opts && opts.skipNoise) return;
  const k = Math.min(1, 0.01 * (Number(dt) || 0));
  for (const mat in st) {
    if (isGold(mat)) continue;   // 需求22：金不参与回归，恒为 ASCOIN_PER_GOLD
    const s = st[mat];
    s.price = s.price + (s.base - s.price) * k;
  }
  // v0.2.6 股市：仓库随心跳缓慢回补到基线（每秒 2%），保证长期供给、避免买空后永久缺货
  ensureShopWarehouse(acc);
  const kr = Math.min(1, 0.02 * (Number(dt) || 0));
  for (const m of MATERIALS) {
    if (m.id === 'gold') continue;
    const base = warehouseBaseline(m);
    const cur = Number(acc.shopWarehouse[m.nameCn]) || 0;
    if (cur < base) acc.shopWarehouse[m.nameCn] = cur + (base - cur) * kr;
  }
  // v0.2.12：模拟行情持续波动 —— 每秒 ±0.18% 随机游走（受 base×[0.2, 4] 约束）
  const amt = Math.min(2, Number(dt) || 0);
  for (const mat in st) {
    if (isGold(mat)) continue;
    const s = st[mat];
    const drift = (Math.random() * 2 - 1) * 0.0018 * amt;
    s.price = clampShared(s.price * (1 + drift), s.base);
  }
}

/** 价格安全区间：base 的 [0.2, 4] 倍（防止随机游走跑飞） */
function clampShared(price, base) {
  const p = Number(price) || 0;
  const b = Number(base) || 1;
  return Math.max(b * 0.2, Math.min(b * 4, p));
}

/** 当前价格快照 { mat: price }（共享市场同步用） */
export function priceSnapshotOf(acc) {
  const st = shopStateOf(acc);
  const out = {};
  for (const mat in st) out[mat] = Math.round(Number(st[mat].price) || 0);
  return out;
}

/** 应用外部（全服共享）价格；base 由本地公式保底，price 夹在安全区间内 */
export function applySharedPrice(acc, mat, price, base) {
  if (!mat || isGold(mat)) return;
  const st = shopStateOf(acc);
  const cur = st[mat] || (st[mat] = { price: Number(price) || 1, base: Number(base) || 1 });
  if (base != null && Number(base) > 0) cur.base = Number(base);
  cur.price = clampShared(price, cur.base);
}

// ============================================================================
// 买卖（下单）与运输（送达）
// ============================================================================
// 订单存在账号上：acc.shopOrders = [{ id, side:'buy'|'sell', mat, qty, price, cost, cells, delivered, at }]
let _seq = 0;
function genOrderId() {
  _seq = (_seq + 1) % 100000;
  return 'ord_' + Date.now().toString(36) + '_' + _seq;
}
export function pendingOrders(acc) {
  if (!acc) return [];
  if (!Array.isArray(acc.shopOrders)) acc.shopOrders = [];
  return acc.shopOrders.filter((o) => o && !o.delivered);
}
export function allOrders(acc) {
  if (!acc) return [];
  if (!Array.isArray(acc.shopOrders)) acc.shopOrders = [];
  return acc.shopOrders;
}

export function ascoinOf(acc) {
  const v = Number(acc && acc.ascoin);
  return Number.isFinite(v) ? v : 0;
}
export function ascoinBalance(acc) { return ascoinOf(acc); }

/**
 * 买入（花 ascoin 买物资）：下单后**等运输船送达**才真正入库
 *   → { ok, reason?, order?, cost, price }
 */
export function buy(acc, mat, qty) {
  if (!acc) return { ok: false, reason: '账号缺失' };
  if (!isTradable(mat)) return { ok: false, reason: '商店不经营这种物资' };
  const n = Math.floor(Number(qty) || 0);
  if (!(n > 0)) return { ok: false, reason: '数量必须是正整数' };
  const st = shopStateOf(acc);
  const price = priceOf(acc, mat);
  const cost = Math.round(price * n);
  if (ascoinOf(acc) < cost) {
    return { ok: false, reason: 'Ascoin 不足：需要 ' + cost + '，现有 ' + Math.floor(ascoinOf(acc)) };
  }
  acc.ascoin = ascoinOf(acc) - cost;
  // v0.1.2 R9：金恒价跳过；装备无 shopState 条目 → 跳过买涨
  if (!isGold(mat) && st[mat]) st[mat].price = Math.min(st[mat].base * 5, st[mat].price * 1.02);
  const order = { id: genOrderId(), side: 'buy', mat, qty: n, price, cost, cells: 1, delivered: false, at: Date.now() };
  allOrders(acc).push(order);
  return { ok: true, order, cost, price };
}

/**
 * 卖出（把货卖给商店换 ascoin）：**必须先把货送到商店星**才能结算
 *   → { ok, reason?, order? }
 */
export function sell(acc, mat, qty) {
  if (!acc) return { ok: false, reason: '账号缺失' };
  if (!isTradable(mat)) return { ok: false, reason: '商店不经营这种物资' };
  const n = Math.floor(Number(qty) || 0);
  if (!(n > 0)) return { ok: false, reason: '数量必须是正整数' };
  const price = priceOf(acc, mat);
  const order = {
    id: genOrderId(), side: 'sell', mat, qty: n, price,
    // 需求21：到手价 = 挂单价 × (1 - MARKET_FEE)，统一 5% 佣金口径
    cost: Math.round(price * n * (1 - MARKET_FEE)),
    cells: 1, delivered: false, at: Date.now(),
  };
  allOrders(acc).push(order);
  return { ok: true, order, price };
}

/**
 * 送达订单（由运输指令在货物真正运到后调用）
 *   buy  → 把物资加进目标星球物品栏
 *   sell → 从目标星球扣掉物资并给 ascoin
 */
export function deliverOrder(acc, orderId, inst) {
  const order = allOrders(acc).find((o) => o && o.id === orderId);
  if (!order) return { ok: false, reason: '找不到该订单' };
  if (order.delivered) return { ok: false, reason: '该订单已送达' };
  if (!inst) return { ok: false, reason: '缺少目标星球' };

  if (order.side === 'buy') {
    // v0.1.2 R9：装备键入库到 inst.equipment（键即 partId@材料），与贡品契约同口径
    if (isEquipmentKey(order.mat)) {
      if (!inst.equipment || typeof inst.equipment !== 'object') inst.equipment = {};
      const cur = inst.equipment[order.mat];
      if (cur && typeof cur === 'object') {
        cur.count = (Number(cur.count) || 0) + order.qty;
      } else {
        const at = order.mat.indexOf('@');
        inst.equipment[order.mat] = {
          partId: order.mat.slice(0, at),
          material: order.mat.slice(at + 1) || null,
          count: order.qty,
        };
      }
      order.delivered = true;
      return { ok: true, message: '商店的装备 ' + order.mat + ' ×' + order.qty + ' 已运抵。' };
    }
    const e = ensureEntry(inst, order.mat, 'refined');
    e.owned = Math.max(0, (Number(e.owned) || 0) + order.qty);
    order.delivered = true;
    return { ok: true, message: '商店的 ' + order.mat + ' ×' + order.qty + ' 已运抵。' };
  }
  // sell
  // v0.1.2 R9：装备从 inst.equipment 扣减
  if (isEquipmentKey(order.mat)) {
    const eq = inst.equipment && inst.equipment[order.mat];
    const have = eq ? (Number(eq.count) || 0) : 0;
    if (have < order.qty) {
      return { ok: false, reason: '装备不足：需要 ' + order.qty + '，该星球只有 ' + Math.floor(have) };
    }
    eq.count = Math.max(0, (Number(eq.count) || 0) - order.qty);
    if (eq.count <= 0) delete inst.equipment[order.mat];
    acc.ascoin = ascoinOf(acc) + order.cost;
    order.delivered = true;
    return { ok: true, message: '卖出装备 ' + order.mat + ' ×' + order.qty + '，获得 ' + order.cost + ' Ascoin。' };
  }
  const have = ownedOf(inst, order.mat);
  if (have < order.qty) {
    return { ok: false, reason: '货物不足：需要 ' + order.qty + '，该星球只有 ' + Math.floor(have) };
  }
  spendOwned(inst, order.mat, order.qty);
  acc.ascoin = ascoinOf(acc) + order.cost;
  const st = shopStateOf(acc);
  // 金恒价，跳过卖跌；装备无 shopState 条目 → 跳过
  if (!isGold(order.mat) && st[order.mat]) st[order.mat].price = Math.max(st[order.mat].base * 0.2, st[order.mat].price * 0.98);
  order.delivered = true;
  return { ok: true, message: '卖出 ' + order.mat + ' ×' + order.qty + '，获得 ' + order.cost + ' Ascoin。' };
}

/** 给 ascoin 充值（调试 / 后续任务奖励用） */
export function grantAscoin(acc, amt) {
  if (!acc) return 0;
  acc.ascoin = ascoinOf(acc) + Math.max(0, Math.round(Number(amt) || 0));
  return acc.ascoin;
}

// ============================================================================
// 股市即时交易（v0.2.6）：每种资源随时可买卖，价格随成交实时涨跌（买涨卖跌）+ 自然回归，
// 货物从「商店星仓库」增减（买减卖增，仓库随心跳回补）。无需运输船、即时交割。
//   marketBuy  → 花 ascoin，从仓库扣货并入库到目标星球，价格买涨
//   marketSell → 从目标星球扣货进仓库，按（价 ×(1-佣金)）付 ascoin，价格卖跌
// 装备不在股市内（请走「挂单/拍卖」），股市只做材料（MATERIALS 表内资源）。
// ============================================================================
export function marketBuy(acc, mat, qty, inst) {
  if (!acc) return { ok: false, reason: '账号缺失' };
  if (!isTradable(mat)) return { ok: false, reason: '商店不经营这种物资' };
  if (isEquipmentKey(mat)) return { ok: false, reason: '装备请在「挂单/拍卖」中交易' };
  const n = Math.floor(Number(qty) || 0);
  if (!(n > 0)) return { ok: false, reason: '数量必须是正整数' };
  ensureShopWarehouse(acc);
  const stock = warehouseOf(acc, mat);
  if (stock <= 0) return { ok: false, reason: SHOP_PLANET.nameCn + ' 的「' + mat + '」暂时缺货' };
  const buyN = Math.min(n, Math.floor(stock));
  const price = priceOf(acc, mat);
  const cost = Math.round(price * buyN);
  if (ascoinOf(acc) < cost) return { ok: false, reason: 'Ascoin 不足：需要 ' + cost + '，现有 ' + Math.floor(ascoinOf(acc)) };
  acc.ascoin = ascoinOf(acc) - cost;
  acc.shopWarehouse[mat] = stock - buyN;
  // 买涨：成交推动（金恒价跳过）。成交量相对库存越大，涨幅越明显
  if (!isGold(mat)) {
    const st = shopStateOf(acc)[mat];
    if (st) {
      const surge = 1 + Math.min(0.06, 0.015 * (buyN / Math.max(1, stock)));
      st.price = Math.min(st.base * 6, st.price * surge);
    }
  }
  const e = ensureEntry(inst, mat, 'refined');
  if (e) e.owned = (Number(e.owned) || 0) + buyN;
  return { ok: true, qty: buyN, cost, price };
}

export function marketSell(acc, mat, qty, inst) {
  if (!acc) return { ok: false, reason: '账号缺失' };
  if (!isTradable(mat)) return { ok: false, reason: '商店不经营这种物资' };
  if (isEquipmentKey(mat)) return { ok: false, reason: '装备请在「挂单/拍卖」中交易' };
  const n = Math.floor(Number(qty) || 0);
  if (!(n > 0)) return { ok: false, reason: '数量必须是正整数' };
  if (!inst) return { ok: false, reason: '缺少目标星球' };
  const have = ownedOf(inst, mat);
  if (have < n) return { ok: false, reason: '货物不足：需要 ' + n + '，该星球只有 ' + Math.floor(have) };
  const price = priceOf(acc, mat);
  const gross = Math.round(price * n);
  const net = Math.round(gross * (1 - MARKET_FEE));
  spendOwned(inst, mat, n);
  acc.ascoin = ascoinOf(acc) + net;
  // 进仓库增（封顶基线 ×4，避免无限堆积把价格压死）
  ensureShopWarehouse(acc);
  const cap = warehouseBaseline(MATERIALS.find((x) => x.nameCn === mat)) * 4;
  acc.shopWarehouse[mat] = Math.min(cap, (Number(acc.shopWarehouse[mat]) || 0) + n);
  // 卖跌（金恒价跳过）
  if (!isGold(mat)) {
    const st = shopStateOf(acc)[mat];
    if (st) st.price = Math.max(st.base * 0.15, st.price * 0.97);
  }
  return { ok: true, qty: n, gain: net, price };
}

// ============================================================================
// 交易池（v0.1.0）：玩家 / 电脑都可以把自己的任意物品挂单买卖
// 数据结构：acc.shopListings = [{ id, sellerAccountId, mat, qty, price, at }]
//   sellerAccountId 为 acc.id 表示玩家自己的挂单；为 npc.id 表示电脑账号挂单。
// ============================================================================
// 需求21：交易佣金统一口径——卖方到手 = 成交额 × (1 - MARKET_FEE)，平台抽 5%。
// 适用所有卖出路径：直售 sell()/deliverOrder()、挂单成交 creditSeller()（含
// buyListing / tickListings / npcTakeFromMarket 三条成交路径）。展示端
// （ui/fleet.js）按 marketListings 返回的 netPrice 口径展示到手价。
export const MARKET_FEE = 0.05;

// v0.2.0 定价弹性硬门槛：挂单价 > 建议价 × 8 视为「定价离谱」，电脑买家与 NPC 一律跳过。
// （此前只是概率 ∝ 建议价/挂单价 → 趋近 0 但不等于 0，离谱高价仍有极小概率被买走。）
export const SHOP_ABSURD_RATIO = 8;

function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }

// 把卖单结算款发给挂单者（玩家或电脑账号）。
// 佣金口径：total 为成交全额（挂牌价 × 成交数量），本函数统一扣除 MARKET_FEE
// 后把净额给卖方——即「卖方到手 = 成交额 × 95%」。三条成交路径
// （玩家买走 buyListing / 电脑买家 tickListings / NPC 抢单 npcTakeFromMarket）
// 一律经此函数结算，保证与直售 sell() 的 95% 到手口径一致。
function creditSeller(acc, listing, total) {
  const net = Math.round((Number(total) || 0) * (1 - MARKET_FEE));
  if (listing.sellerAccountId === acc.id) {
    acc.ascoin = ascoinOf(acc) + net;
    return;
  }
  const npc = (acc.npcs || []).find((n) => n.id === listing.sellerAccountId);
  if (npc) npc.ascoin = (Number(npc.ascoin) || 0) + net;
}

function genListingId() {
  _seq = (_seq + 1) % 100000;
  return 'lst_' + Date.now().toString(36) + '_' + _seq;
}

// 在玩家已加载的星球实例里查找自定义材料（inst.customMaterials），用于估价
function findCustomMaterials(acc) {
  for (const inst of (STATE.planets || [])) {
    if (inst && inst.customMaterials) return inst.customMaterials;
  }
  return null;
}

/**
 * 建议售价（v0.1.0）：玩家挂单时给一个参考价。
 *   - 商店经营的 materials 表内材料：当前价 × 0.9（略低于现价更易被买走；
 *     成交后卖方到手为成交额 × (1 - MARKET_FEE)，见 creditSeller），向上取整。
 *   - 自定义材料 / 装备部件（不在 MATERIALS 里）：按「强度 + 耐久 + 精细度」估个价，最低 10。
 *     inst 优先用传入的星球实例；未传则回退到当前账号已加载的星球实例。
 */
export function suggestPriceOf(acc, mat, inst) {
  const m = MAT_BY_NAME[mat];
  if (m) {
    const price = priceOf(acc, mat);
    return Math.ceil(price * 0.9);
  }
  // v0.1.2 R9：装备键（partId@材料）直接估值，略低于直售价更易成交
  if (isEquipmentKey(mat)) {
    const v = equipmentValue(mat);
    return Math.max(10, Math.round(v * 0.9));
  }
  // 自定义材料：估个价
  let strength = 0, durability = 0, fineness = 1;
  const cm = (inst && inst.customMaterials) || findCustomMaterials(acc);
  if (cm) {
    for (const k in cm) {
      const mm = cm[k] && cm[k].material;
      if (mm && mm.nameCn === mat) {
        strength = Number(mm.strength) || 0;
        durability = Number(mm.durability) || 0;
        fineness = Number(mm.fineness) || 1;
        break;
      }
    }
  }
  return Math.max(10, Math.round((strength + durability) * fineness * 10));
}

/** 把玩家的任意物品挂到交易池（不限 materials 表内），返回 { ok, listing } */
export function listForSale(acc, mat, qty, price) {
  if (!acc) return { ok: false, reason: '账号缺失' };
  const n = Math.floor(Number(qty) || 0);
  const p = Math.floor(Number(price) || 0);
  if (!(n > 0)) return { ok: false, reason: '数量必须是正整数' };
  if (!(p > 0)) return { ok: false, reason: '定价必须是正数' };
  if (!Array.isArray(acc.shopListings)) acc.shopListings = [];
  const listing = {
    id: genListingId(),
    sellerAccountId: acc.id,
    mat,
    qty: n,
    price: p,
    at: Date.now(),
  };
  acc.shopListings.push(listing);
  return { ok: true, listing };
}

/** 读取交易池；可传 mat 过滤。含玩家自己的与「其它人（电脑）」的挂单。
 * 需求21：每条返回条目额外带「到手单价」netPrice = 挂牌价 × (1 - MARKET_FEE)，
 * 展示端（ui/fleet.js）按 netPrice 口径展示卖方到手，与成交结算（creditSeller）一致。 */
export function marketListings(acc, mat) {
  if (!acc || !Array.isArray(acc.shopListings)) return [];
  const list = mat ? acc.shopListings.filter((l) => l.mat === mat) : acc.shopListings;
  return list.map((l) => ({
    ...l,
    netPrice: Math.round((Number(l.price) || 0) * (1 - MARKET_FEE)),
  }));
}

/** 撤单（玩家只能撤自己的，调用方负责只把玩家自己的挂单 id 传进来） */
export function cancelListing(acc, listingId) {
  if (!acc || !Array.isArray(acc.shopListings)) return { ok: false, reason: '没有交易池' };
  const i = acc.shopListings.findIndex((l) => l.id === listingId);
  if (i < 0) return { ok: false, reason: '找不到该挂单' };
  acc.shopListings.splice(i, 1);
  return { ok: true };
}

/** 买入别人的挂单：玩家付 ascoin，物品进当前星球物品栏，价格被买涨 */
export function buyListing(acc, listingId, inst) {
  if (!acc) return { ok: false, reason: '账号缺失' };
  const pool = acc.shopListings || [];
  const L = pool.find((l) => l.id === listingId);
  if (!L) return { ok: false, reason: '找不到该挂单' };
  if (L.sellerAccountId === acc.id) return { ok: false, reason: '不能购买自己的挂单' };
  const total = Math.round(L.price * L.qty);
  if (ascoinOf(acc) < total) return { ok: false, reason: 'Ascoin 不足：需要 ' + total + '，现有 ' + Math.floor(ascoinOf(acc)) };
  acc.ascoin = ascoinOf(acc) - total;
  creditSeller(acc, L, total);                 // 款项结算给卖方（电脑账号）
  if (inst) {
    // v0.1.2 R9：装备键入 inst.equipment（与贡品契约同口径）
    if (isEquipmentKey(L.mat)) {
      if (!inst.equipment || typeof inst.equipment !== 'object') inst.equipment = {};
      const cur = inst.equipment[L.mat];
      if (cur && typeof cur === 'object') {
        cur.count = (Number(cur.count) || 0) + L.qty;
      } else {
        const at = L.mat.indexOf('@');
        inst.equipment[L.mat] = {
          partId: L.mat.slice(0, at),
          material: L.mat.slice(at + 1) || null,
          count: L.qty,
        };
      }
    } else {
      const e = ensureEntry(inst, L.mat, 'refined');
      if (e) e.owned = (Number(e.owned) || 0) + L.qty;
    }
  }
  nudgePriceUp(acc, L.mat, 1.02);              // 成交推动：买涨
  const i = pool.findIndex((l) => l.id === listingId);
  if (i >= 0) pool.splice(i, 1);
  return { ok: true, mat: L.mat, qty: L.qty, price: L.price };
}

/**
 * 价格上浮（成交推动）。仅在 materials 表内材料有 shopState 时生效。
 *   mult 默认 1.02（买涨），封顶 base × capMul（默认 5）。
 *   需求22：金恒价（ASCOIN_PER_GOLD），挂单/直售成交都不推动金价，直接跳过。
 */
export function nudgePriceUp(acc, mat, mult = 1.02, capMul = 5) {
  if (isGold(mat)) return;
  const st = shopStateOf(acc)[mat];
  if (!st) return;
  st.price = Math.min(st.base * capMul, st.price * mult);
}

/** 需求16：清理交易池里的卖空单/脏数据——qty<=0（卖空）、price<=0、缺字段条目一律移除 */
function purgeDeadListings(pool) {
  for (let i = pool.length - 1; i >= 0; i--) {
    const L = pool[i];
    const qty = Math.floor(Number(L && L.qty));
    const price = Number(L && L.price);
    if (!L || !(qty > 0) || !(price > 0)) pool.splice(i, 1);
  }
}

/**
 * 交易池的「电脑买家」：每秒对每条挂单按 p = clamp(0.35 * (建议价 / 挂牌价), 0, 0.9) 判定一次，
 * 价格越低越可能被买走。被买走则把 ascoin 结算给挂单者（到手=成交额×(1-MARKET_FEE)，
 * 见 creditSeller）、物品从挂单移除、价格被买涨。
 * 设计者：「定价越低，电脑购买的可能性越大」。
 * 需求16：调用前后都清理卖空单（qty<=0）与脏数据；签名 tickListings(acc, dt)，
 * 由 state.js 心跳每秒接线调用。
 */
export function tickListings(acc, dt) {
  if (!acc) return;
  if (!Array.isArray(acc.shopListings)) acc.shopListings = [];
  const pool = acc.shopListings;
  purgeDeadListings(pool);
  const steps = Math.max(1, Math.ceil(Number(dt) || 1));
  for (let s = 0; s < steps; s++) {
    for (const L of [...pool]) {
      if (L.price <= 0) continue;
      const sugg = suggestPriceOf(acc, L.mat);
      // v0.2.0 定价弹性（硬门槛）：离谱高价直接无人问津（与 npcTakeFromMarket 同一倍率）
      if (sugg > 0 && L.price > sugg * SHOP_ABSURD_RATIO) continue;
      const p = clamp(0.35 * (sugg / L.price), 0, 0.9);
      if (Math.random() < p) {
        const total = Math.round(L.price * L.qty);
        creditSeller(acc, L, total);
        nudgePriceUp(acc, L.mat, 1.02);
        const i = pool.findIndex((l) => l.id === L.id);
        if (i >= 0) pool.splice(i, 1);
      }
    }
    purgeDeadListings(pool);
  }
}

// ============================================================================
// v0.1.0：电脑账号（npc.js）的交易池接口
// ============================================================================
// npc.js 是叶子模块（不 import 本文件），由 state.js 通过 env 注入这两个回调。
/** 电脑账号把自己的货挂到交易池 */
export function npcListOnMarket(acc, npc, mat, qty, price) {
  if (!acc || !npc) return null;
  if (!Array.isArray(acc.shopListings)) acc.shopListings = [];
  const L = {
    id: genListingId(),
    sellerAccountId: npc.id,
    sellerNameCn: npc.nameCn || '电脑账号',
    mat,
    qty: Math.max(1, Math.floor(Number(qty) || 1)),
    price: Math.max(1, Math.round(Number(price) || 1)),
    at: Date.now(),
  };
  acc.shopListings.push(L);
  // v0.1.2 R9：交易池上限 改前 40 条 → 改后 120 条（配合 npc.js 缩短 listEvery，挂单量明显增多，
  // 同时保留上限防止 tickListings 性能恶化）。优先丢掉最旧的电脑挂单（不动玩家自己的）。
  if (acc.shopListings.length > 120) {
    const i = acc.shopListings.findIndex((l) => l.sellerAccountId !== acc.id);
    if (i >= 0) acc.shopListings.splice(i, 1);
  }
  return L;
}

/**
 * 某个电脑账号尝试买走交易池里**最便宜**的一条挂单（设计者：定价越低越可能被买走）
 *   概率 p = clamp(0.35 × 建议价 / 挂单价, 0, 0.9)
 *   成交：买家扣 ascoin、卖家收款（到手=成交额×(1-MARKET_FEE)，见 creditSeller）、
 *   挂单移除、商店价被买涨（金恒价，见 nudgePriceUp）。
 *   需求16：支持部分成交——NPC 买不起整单时按余额买下尽可能多的数量，
 *   挂单 qty 正确递减，递减到 0 时从交易池移除。
 *   → { bought, mat?, qty?, price?, cost? }
 */
export function npcTakeFromMarket(acc, npc) {
  if (!acc || !npc || !Array.isArray(acc.shopListings) || !acc.shopListings.length) return { bought: false };
  const pool = acc.shopListings;
  purgeDeadListings(pool);   // 需求16：先清掉卖空单/脏数据，避免选中无效挂单
  // 只挑「不是自己挂的」单子，按单价升序（便宜的先被看到）
  const cands = pool.filter((l) => l.sellerAccountId !== npc.id).sort((a, b) => a.price - b.price);
  if (!cands.length) return { bought: false };
  const L = cands[0];
  const sugg = suggestPriceOf(acc, L.mat);
  // v0.2.0 定价弹性（硬门槛）：定价超过建议价 8 倍 = 定价离谱，NPC 一律不买、不看概率
  if (sugg > 0 && L.price > sugg * SHOP_ABSURD_RATIO) return { bought: false, skippedAbsurd: true };
  const p = Math.max(0, Math.min(0.9, 0.35 * (L.price > 0 ? sugg / L.price : 0)));
  if (Math.random() > p) return { bought: false };
  // 需求16：部分成交——最多买到「余额买得起」与「挂单剩余」中的较小者
  const afford = Math.floor((Number(npc.ascoin) || 0) / L.price);
  const buyQty = Math.min(L.qty, Math.max(0, afford));
  if (!(buyQty > 0)) return { bought: false };   // 一件都买不起
  const total = Math.round(L.price * buyQty);
  npc.ascoin = (Number(npc.ascoin) || 0) - total;
  creditSeller(acc, L, total);          // 卖家收款（玩家自己的挂单 → 直接进 ascoin，扣 5% 佣金）
  nudgePriceUp(acc, L.mat, 1.02);       // 成交推动：买涨
  L.qty = Math.max(0, (Number(L.qty) || 0) - buyQty);   // 部分成交：递减挂单数量
  if (L.qty <= 0) {                     // 卖空 → 从交易池移除
    const i = pool.findIndex((l) => l.id === L.id);
    if (i >= 0) pool.splice(i, 1);
  }
  return { bought: true, mat: L.mat, qty: buyQty, price: L.price, cost: total };
}

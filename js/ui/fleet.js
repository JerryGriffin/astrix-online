// 舰队页面（Astrix v0.1.1）：编队 / 持续任务 / 船载仓库 / 殖民管理 / 商店星
// 纯 UI，零依赖。数据逻辑在 js/core/fleet.js、planetgen.js、shop.js。
// 更新：v0.1.1 五指令改为持续任务（startMission，任务行显示倒计时），
//       新增船载仓库面板；编队 / 五指令区块挂船坞门禁；交易池区 2s 心跳局部刷新。

import { fmtNum, fmtRate, fmtTime } from '../core/format.js?v=20.11';
import {
  listFleets, createFleet, disbandFleet, addShipToFleet, removeShipFromFleet,
  fleetSpeedOf, fleetPowerOf, executeCommand,
  startMission, cancelMission, fleetMissionLabel, defenseBonusOf,
  shipCargoOf, loadShipCargo, unloadShipCargo,
  shipCargoMassOf, shipCargoCellsOf, shipCargoCellsMax, effectiveSpeedOf,
} from '../core/fleet.js?v=20.11';
import { equipmentList } from '../core/shipyard.js?v=20.11';
import {
  MANAGEMENT_MODES, MANAGEMENT_BY_ID, modeOf, setManagement,
  TERRITORY_ASSIMILATE_SEC, TERRITORY_HAPPY_THRESHOLD,
} from '../core/planetgen.js?v=20.11';
import {
  SHOP_PLANET, shopPrices, sell, pendingOrders, deliverOrder, ascoinBalance,
  suggestPriceOf, listForSale, marketListings, cancelListing, buyListing, priceOf, shopStateOf,
  MARKET_FEE, marketBuy, marketSell, warehouseOf, ensureShopWarehouse,
} from '../core/shop.js?v=20.11';
import {
  createAuction, placeBid, activeAuctions, auctionLog,
  myAuctionableResources, myAuctionableEquipment, myAuctionableShips, ensureAuctions,
} from '../core/auction.js?v=20.11';
import { getPlanetInstance, currentAccount, ownedOf } from '../core/state.js?v=20.11';

// HTML 转义（防 XSS，与其它面板一致）
function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
}
function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
}
function btn(text, cls) {
  const b = el('button', 'btn ' + (cls || ''), text);
  b.type = 'button';
  return b;
}

const CMD_LABEL = {
  explore: '探索', defense: '低空防卫', patrol: '巡航', transport: '运输', land: '登陆',
};
const CMD_TIP = {
  explore: '派出舰队探索未知星域，任务完成后结算：大概率发现星球（小概率是随机星球），也可能遇袭或一无所获',
  defense: '舰队驻留母星空域执行低空防卫，立即生效；手动取消任务才结束',
  patrol: '派出舰队巡航，任务完成后结算：可能探测到其它编队并交战',
  transport: '需要编队里有运输船；把物资运到目的地星球，抵达后自动卸货',
  land: '军队系统开发中，暂时不可用',
};

// ============================================================================
// 心跳（v0.1.1 需求 D）：2000ms 局部刷新，只碰「任务倒计时行」与「交易池挂单区」，
// 不整页重绘、不打断输入焦点；页面隐藏或面板未挂载时跳过 / 停表。
// ============================================================================
function startFleetHeartbeat(container, updaters) {
  if (container._hbTimer) { clearInterval(container._hbTimer); container._hbTimer = null; }
  if (!updaters.length) return;
  container._hbTimer = setInterval(() => {
    if (typeof document !== 'undefined' && document.hidden) return;
    // 面板已被其它子页替换（无门牌）时自动停表
    if (!container.querySelector('.fleet-page-root')) {
      if (container._hbTimer) { clearInterval(container._hbTimer); container._hbTimer = null; }
      return;
    }
    for (const fn of updaters) {
      try { fn(); } catch (e) { /* 单个刷新失败不拖垮心跳 */ }
    }
  }, 2000);
}

export function renderShop(container, ctx) {
  const account = (ctx && ctx.account) || currentAccount();
  const planetCode = (ctx && ctx.planetCode) || (account && account.homePlanetCode) || 'syl';
  const openModal = ctx && ctx.openModal ? ctx.openModal : null;
  const rerender = ctx && typeof ctx.rerender === 'function' ? ctx.rerender : null;
  const inst = getPlanetInstance(planetCode);
  // 清掉上一次的心跳，避免切页后定时器泄漏（与 v0.2.0 面板守卫同口径）
  if (container._shopTimer) { clearInterval(container._shopTimer); container._shopTimer = null; }
  container.innerHTML = '';
  container.className = 'fleet-wrap';
  if (!account) { container.appendChild(el('p', 'muted', '账号数据缺失。')); return; }
  const redraw = () => { if (rerender) rerender(); else renderShop(container, ctx); };

  const market = buildMarketSection(account, inst, openModal, redraw);
  const auction = buildAuctionSection(account, inst, planetCode, openModal, redraw);
  container.appendChild(market.section);
  container.appendChild(auction.section);
  // 原「待运输订单」（旧存档的买/卖交割单，仍可标记送达；新股市为即时交割不再产生）
  container.appendChild(buildPendingOrders(account, inst, openModal, redraw));
  // 原挂单/交易池（设计者要求：原有挂单在下方，与股市/拍卖共存）
  container.appendChild(buildListingPool(account, inst, openModal, redraw, null));

  // 1s 心跳：实时刷新股价/仓库、拍卖倒计时与挂单池（不打断输入焦点，面板被替换则自停）
  container._shopTimer = setInterval(() => {
    if (typeof document !== 'undefined' && document.hidden) return;
    if (!container.querySelector('.shop-market-grid')) {
      if (container._shopTimer) { clearInterval(container._shopTimer); container._shopTimer = null; }
      return;
    }
    try { market.refresh(); } catch (e) { /* 忽略 */ }
    try { auction.refresh(); } catch (e) { /* 忽略 */ }
  }, 1000);
}

// 趋势箭头 + 颜色（涨绿跌红，与物品栏配色一致）
function fmtTrend(price, base) {
  if (price > base) return { arrow: '▲', color: '#9FE1CB' };
  if (price < base) return { arrow: '▼', color: '#f09595' };
  return { arrow: '—', color: '#94a3b8' };
}

// ============================================================================
// 股市（v0.2.6）：每种资源一行，实时价 + 涨跌箭头 + 商店仓库库存 + 即时买/卖
// ============================================================================
function buildMarketSection(account, inst, openModal, redraw) {
  const sec = el('section', 'fac-group');
  sec.appendChild(el('div', 'res-section-title', SHOP_PLANET.nameCn + ' · 星际股市'));
  const bal = el('div', 'res-sub muted');
  bal.style.marginBottom = '8px';
  bal.textContent = '即时交易，价格随成交实时涨跌（买涨卖跌）。当前余额 ' + fmtNum(ascoinBalance(account)) + ' Ascoin。';
  sec.appendChild(bal);

  const grid = el('div', 'shop-market-grid');
  const refs = new Map();   // mat -> { priceEl, stockEl }

  const prices = shopPrices(account);
  for (const p of prices) {
    const row = el('div', 'shop-mk-row');
    row.appendChild(el('div', 'shop-mk-name', p.mat));
    const priceEl = el('div', 'shop-mk-price');
    const stockEl = el('div', 'shop-mk-stock');
    row.appendChild(priceEl);
    row.appendChild(stockEl);

    const qty = document.createElement('input');
    qty.type = 'number'; qty.min = '1'; qty.value = '1'; qty.className = 'shop-qty shop-mk-qty';
    qty.style.minHeight = '40px'; qty.style.minWidth = '68px';

    const buyB = btn('买', 'btn-sm'); buyB.style.minHeight = '40px';
    const sellB = btn('卖', 'btn-sm'); sellB.style.minHeight = '40px';
    buyB.addEventListener('click', () => {
      const r = marketBuy(account, p.mat, qty.value, inst);
      if (!r.ok) { if (openModal) openModal({ title: '无法买入', body: '<p>' + esc(r.reason) + '</p>' }); else alert(r.reason); return; }
      if (openModal) openModal({ title: '买入成功', body: '<p>' + esc(p.mat) + ' ×' + r.qty + '，花费 ' + fmtNum(r.cost) + ' Ascoin。</p>' });
      refresh();   // 即时刷新股价/仓库/余额
    });
    sellB.addEventListener('click', () => {
      const r = marketSell(account, p.mat, qty.value, inst);
      if (!r.ok) { if (openModal) openModal({ title: '无法卖出', body: '<p>' + esc(r.reason) + '</p>' }); else alert(r.reason); return; }
      if (openModal) openModal({ title: '卖出成功', body: '<p>' + esc(p.mat) + ' ×' + r.qty + '，获得 ' + fmtNum(r.gain) + ' Ascoin。</p>' });
      refresh();
    });
    const act = el('div', 'shop-mk-act');
    act.append(qty, buyB, sellB);
    row.appendChild(act);
    grid.appendChild(row);
    refs.set(p.mat, { priceEl, stockEl });
  }
  sec.appendChild(grid);

  function refresh() {
    bal.textContent = '即时交易，价格随成交实时涨跌（买涨卖跌）。当前余额 ' + fmtNum(ascoinBalance(account)) + ' Ascoin。';
    const st = shopStateOf(account);
    for (const [mat, ref] of refs) {
      const s = st[mat];
      const price = s ? Number(s.price) || 0 : 0;
      const base = s ? Number(s.base) || 0 : 0;
      const t = fmtTrend(price, base);
      ref.priceEl.textContent = fmtNum(price) + ' ' + t.arrow;
      ref.priceEl.style.color = t.color;
      ref.stockEl.textContent = '仓 ' + fmtNum(warehouseOf(account, mat));
      ref.stockEl.style.color = '#94a3b8';
    }
  }
  refresh();
  return { section: sec, refresh };
}

// ============================================================================
// 拍卖行（v0.2.6）：15 秒竞价窗口，出价最高者得；可拍卖资源 / 装备 / 飞船
// ============================================================================
function buildAuctionSection(account, inst, planetCode, openModal, redraw) {
  ensureAuctions(account);
  const sec = el('section', 'fac-group');
  sec.appendChild(el('div', 'res-section-title', '拍卖行（15 秒竞价）'));
  sec.appendChild(el('p', 'muted', '开拍后 15 秒内出价最高者得；无人出价则流拍、资产退还。可拍卖资源、装备与飞船，离线由星际买家（NPC）兜底出价。'));

  // --- 开拍表单 ---
  const form = el('div', 'shop-auc-form');
  const typeSel = document.createElement('select');
  typeSel.className = 'pop-sel'; typeSel.style.minHeight = '44px';
  for (const t of [['resource', '资源'], ['equipment', '装备'], ['ship', '飞船']]) {
    const o = document.createElement('option'); o.value = t[0]; o.textContent = t[1]; typeSel.appendChild(o);
  }
  const itemSel = document.createElement('select');
  itemSel.className = 'pop-sel'; itemSel.style.minHeight = '44px';
  const qtyIn = document.createElement('input');
  qtyIn.type = 'number'; qtyIn.min = '1'; qtyIn.value = '1'; qtyIn.className = 'shop-qty'; qtyIn.style.minHeight = '40px'; qtyIn.style.minWidth = '64px';
  const bidIn = document.createElement('input');
  bidIn.type = 'number'; bidIn.min = '1'; bidIn.value = '100'; bidIn.className = 'shop-qty'; bidIn.style.minHeight = '40px'; bidIn.style.minWidth = '96px';
  const startB = btn('开始拍卖', 'btn-sm'); startB.style.minHeight = '40px';

  function fillItems() {
    while (itemSel.children.length) itemSel.removeChild(itemSel.children[0]);
    const type = typeSel.value;
    const list = type === 'equipment' ? myAuctionableEquipment(account, inst)
      : type === 'ship' ? myAuctionableShips(account)
      : myAuctionableResources(account, inst);
    if (!list.length) {
      const o = document.createElement('option'); o.value = ''; o.textContent = '（没有可拍卖的' + (type === 'ship' ? '飞船' : type === 'equipment' ? '装备' : '资源') + '）'; itemSel.appendChild(o);
    }
    for (const it of list) {
      const o = document.createElement('option'); o.value = it.key; o.textContent = it.label + ' ×' + fmtNum(it.qty); itemSel.appendChild(o);
    }
  }
  typeSel.addEventListener('change', fillItems);
  fillItems();

  startB.addEventListener('click', () => {
    const type = typeSel.value;
    const key = itemSel.value;
    if (!key) { if (openModal) openModal({ title: '无法开拍', body: '<p>没有可拍卖的资产。</p>' }); else alert('没有可拍卖的资产'); return; }
    const r = createAuction(account, inst, { type, key, qty: qtyIn.value, minBid: bidIn.value, planetCode, durationSec: 15 });
    if (!r.ok) { if (openModal) openModal({ title: '无法开拍', body: '<p>' + esc(r.reason) + '</p>' }); else alert(r.reason); return; }
    if (openModal) openModal({ title: '已开拍', body: '<p>' + esc(r.auction.label) + ' ×' + r.auction.qty + ' 已上架，起拍价 ' + fmtNum(r.auction.minBid) + ' Ascoin，15 秒后落槌。</p>' });
    refreshAuction();
  });

  form.append(
    labelSpan('类型'), typeSel,
    labelSpan('资产'), itemSel,
    labelSpan('数量'), qtyIn,
    labelSpan('起拍价'), bidIn,
    startB,
  );
  sec.appendChild(form);

  const listWrap = el('div', 'shop-auc-list');
  const logWrap = el('div', 'shop-auc-log');
  sec.append(listWrap, logWrap);

  function refreshAuction() {
    // 活跃拍卖列表（无内联输入，可安全整块重建）
    listWrap.innerHTML = '';
    listWrap.appendChild(el('div', 'res-sub muted', '进行中的拍卖'));
    const acts = activeAuctions(account);
    if (!acts.length) listWrap.appendChild(el('p', 'muted', '暂无进行中的拍卖，去上方开一单吧。'));
    for (const a of acts) {
      const line = el('div', 'fleet-ship shop-auc-item');
      const top = a.topBid > 0 ? (fmtNum(a.topBid) + ' Ascoin（' + (a.topBidderName || '匿名') + '）') : '尚无出价';
      line.appendChild(el('span', null,
        a.label + ' ×' + a.qty + '　最高 ' + top + '　剩 ' + fmtTime(Math.ceil(a.remainMs / 1000))));
      if (a.sellerId !== account.id) {
        const bb = btn('出价', 'btn-sm'); bb.style.minHeight = '40px';
        bb.addEventListener('click', () => openBidModal(a));
        line.appendChild(bb);
      } else {
        line.appendChild(el('span', 'auc-mine', '我的拍卖'));
      }
      listWrap.appendChild(line);
    }
    // 成交 / 流拍记录
    logWrap.innerHTML = '';
    logWrap.appendChild(el('div', 'res-sub muted', '最近记录'));
    const log = auctionLog(account);
    if (!log.length) logWrap.appendChild(el('p', 'muted', '暂无记录。'));
    for (const r of log) {
      const line = el('div', 'fleet-ship shop-auc-logitem');
      if (r.type === 'sold') {
        line.appendChild(el('span', null, '成交 ' + r.label + ' ×' + r.qty + ' @ ' + fmtNum(r.price) + '（到手 ' + fmtNum(r.net) + '）'));
      } else {
        line.appendChild(el('span', null, '流拍 ' + r.label + ' ×' + r.qty + '（已退还）'));
      }
      logWrap.appendChild(line);
    }
  }

  function openBidModal(a) {
    const div = document.createElement('div');
    const need = a.topBid > 0 ? a.topBid + 1 : a.minBid;
    div.innerHTML = '<p style="color:#94a3b8;font-size:13px;">对「' + esc(a.label) + ' ×' + a.qty
      + '」出价，需 ≥ ' + fmtNum(need) + ' Ascoin。</p>'
      + '<input type="number" id="auc-bid-amt" min="' + need + '" value="' + need
      + '" style="width:100%;min-height:44px;background:#0b101c;border:1px solid #22354c;color:#c8d4e0;border-radius:6px;padding:8px 12px;font-size:14px;">';
    if (openModal) {
      openModal({ title: '出价：' + a.label, body: div });
      setTimeout(() => {
        const inp = document.getElementById('auc-bid-amt');
        const conf = document.createElement('button');
        conf.textContent = '确认出价'; conf.style.cssText = 'width:100%;min-height:44px;margin-top:10px;background:#7cd7ff;color:#0b101c;font-weight:bold;border:none;border-radius:6px;cursor:pointer;';
        conf.onclick = () => {
          const r = placeBid(account, a.id, inp.value, account.id, account.name || '玩家');
          if (!r.ok) { alert(r.reason); return; }
          if (openModal) openModal({ title: '出价成功', body: '<p>你已对「' + esc(a.label) + '」出价 ' + fmtNum(Number(inp.value)) + ' Ascoin。</p>' });
          refreshAuction();
        };
        div.appendChild(conf);
      }, 30);
    }
  }

  refreshAuction();
  return { section: sec, refresh: refreshAuction };
}

function labelSpan(t) {
  const s = el('span', 'shop-auc-label', t);
  return s;
}

// 原「待运输订单」：旧存档买/卖交割单仍可标记送达（新股市为即时交割，不再产生此类订单）
function buildPendingOrders(account, inst, openModal, redraw) {
  const box = el('section', 'fac-group');
  box.appendChild(el('div', 'res-section-title', '待运输订单'));
  const orders = pendingOrders(account);
  if (!orders.length) { box.appendChild(el('p', 'muted', '暂无待运输订单。')); return box; }
  for (const o of orders) {
    const line = el('div', 'fleet-ship');
    line.appendChild(el('span', null,
      (o.side === 'buy' ? '买入 ' : '卖出 ') + o.mat + ' ×' + o.qty + '（' + (o.side === 'buy' ? '花费 ' : '获得 ') + o.cost + ' Ascoin）'));
    const db = btn('标记已送达', 'btn-sm');
    db.style.minHeight = '40px';
    db.addEventListener('click', () => {
      const r = deliverOrder(account, o.id, inst);
      if (!r.ok) { if (openModal) openModal({ title: '无法送达', body: '<p>' + esc(r.reason) + '</p>' }); else alert(r.reason); return; }
      if (openModal) openModal({ title: '运输完成', body: '<p>' + esc(r.message) + '</p>' });
      redraw();
    });
    line.appendChild(db);
    box.appendChild(line);
  }
  return box;
}

// 交易池区块：自己的挂单（可撤单）+ 别人的挂单（可买入），定价旁显示建议售价
// hb = { updaters: [] } 时，把「重建挂单列表」注册进心跳（只重建本区块，不碰输入焦点）
function buildListingPool(account, inst, openModal, redraw, hb) {
  const box = el('section', 'fac-group shop-pool');
  box.appendChild(el('div', 'res-section-title', '我的挂单 / 交易池'));
  const body = el('div', 'shop-pool-body');
  box.appendChild(body);

  function fill() {
    body.innerHTML = '';
    const pool = marketListings(account);
    const mine = pool.filter((l) => l.sellerAccountId === account.id);
    const others = pool.filter((l) => l.sellerAccountId !== account.id);

    body.appendChild(el('div', 'res-sub muted', '我的挂单（可撤单）'));
    if (!mine.length) body.appendChild(el('p', 'muted', '还没有挂单。'));
    for (const L of mine) {
      const line = el('div', 'fleet-ship');
      // v0.1.1（需求 21）：卖方挂单显式展示佣金后的到手单价与整单到手（netPrice 由 shop.js 提供）
      const mineUnit = (L.netPrice != null)
        ? Number(L.netPrice)
        : Math.round((Number(L.price) || 0) * (1 - MARKET_FEE));
      line.appendChild(el('span', null, L.mat + ' ×' + L.qty + ' @ ' + fmtNum(L.price)
        + '　到手 ' + fmtNum(mineUnit) + ' / 件 ＝ ' + fmtNum(mineUnit * (Number(L.qty) || 0)) + ' Ascoin'));
      const cb = btn('撤单', 'btn-sm'); cb.style.minHeight = '44px';
      cb.addEventListener('click', () => { const r = cancelListing(account, L.id); if (!r.ok) { alert(r.reason); return; } redraw(); });
      line.appendChild(cb);
      body.appendChild(line);
    }

    body.appendChild(el('div', 'res-sub muted', '交易池（其它玩家 / 电脑，可买入）'));
    if (!others.length) body.appendChild(el('p', 'muted', '暂无其它挂单。'));
    for (const L of others) {
      const line = el('div', 'fleet-ship');
      line.appendChild(el('span', null, L.mat + ' ×' + L.qty + ' @ ' + fmtNum(L.price) + ' Ascoin'));
      const bb = btn('买入', 'btn-sm'); bb.style.minHeight = '44px';
      bb.addEventListener('click', () => {
        const r = buyListing(account, L.id, inst);
        if (!r.ok) { alert(r.reason); return; }
        if (openModal) openModal({ title: '买入成功', body: '<p>买入 ' + esc(L.mat) + ' ×' + L.qty
          + '，花费 ' + Math.round(L.price * L.qty) + ' Ascoin。</p>' });
        redraw();
      });
      line.appendChild(bb);
      body.appendChild(line);
    }
  }
  fill();
  if (hb && Array.isArray(hb.updaters)) hb.updaters.push(fill);
  return box;
}

// ============================================================================
// 船载仓库面板（v0.1.1 需求 B）：选船 → 材料下拉 + 数量 → 装载 / 卸下
// ============================================================================
function buildCargoPanel(account, inst) {
  const sec = el('section', 'fac-group');
  sec.appendChild(el('div', 'res-section-title', '船载仓库'));
  sec.appendChild(el('p', 'muted',
    '把星球物资装进飞船货舱：每 250 单位占 1 格、每单位 1t。装得越重航速越慢（最慢降到 40%）。'));

  const ships = (account.ships || []).filter(Boolean);
  if (!ships.length) {
    sec.appendChild(el('p', 'muted', '还没有飞船。先在「舰船」页造船，再来装货。'));
    return sec;
  }

  const shipSel = document.createElement('select');
  shipSel.className = 'pop-sel';
  shipSel.style.minHeight = '44px';
  for (const s of ships) {
    const o = document.createElement('option');
    o.value = s.id;
    o.textContent = (s.name || s.className || '飞船') + '（' + (s.className || '飞船') + '）';
    shipSel.appendChild(o);
  }

  const matSel = document.createElement('select');
  matSel.className = 'pop-sel';
  matSel.style.minHeight = '44px';
  {
    const seen = new Set();
    for (const e of (inst && Array.isArray(inst.inventory) ? inst.inventory : [])) {
      if (!e || !e.mat || seen.has(e.mat)) continue;
      if (!((Number(e.owned) || 0) > 0)) continue;   // 与物品栏 ownedOf 口径一致：只列持有的
      seen.add(e.mat);
      const o = document.createElement('option');
      o.value = e.mat;
      o.textContent = e.mat + '（持有 ' + fmtNum(ownedOf(inst, e.mat)) + '）';
      matSel.appendChild(o);
    }
    if (!matSel.children.length) {
      const o = document.createElement('option');
      o.value = '';
      o.textContent = '（星球上没有可装载的材料）';
      matSel.appendChild(o);
    }
  }

  const qty = document.createElement('input');
  qty.type = 'number'; qty.min = '1'; qty.value = '10';
  qty.className = 'shop-qty';
  qty.style.minHeight = '44px'; qty.style.minWidth = '88px';

  const lb = btn('装进货舱', 'btn-sm'); lb.style.minHeight = '44px';
  const ub = btn('卸下到星球', 'btn-sm'); ub.style.minHeight = '44px';
  const infoLine = el('div', 'fac-line2 muted', '');
  const errLine = el('div', 'fac-line4', '');
  errLine.style.color = '#ff9a76';

  function curShip() { return ships.find((s) => s && s.id === shipSel.value) || ships[0]; }

  function refreshInfo() {
    const s = curShip();
    if (!s) { infoLine.textContent = ''; return; }
    const cells = shipCargoCellsOf(s);
    const max = shipCargoCellsMax(s);
    const mass = shipCargoMassOf(s);
    const v0 = Number(s.stats && s.stats.speed) || 0;
    const v1 = effectiveSpeedOf(s);
    const pct = v0 > 0 ? Math.round((v1 / v0) * 100) : 100;
    const cargo = shipCargoOf(s);
    const items = Object.keys(cargo)
      .filter((m) => (Number(cargo[m]) || 0) > 0)
      .map((m) => m + ' ×' + fmtNum(cargo[m]))
      .join('、');
    infoLine.textContent = '货舱 ' + cells + '/' + max + ' 格 · 载货 ' + fmtNum(mass)
      + ' · 航速 ' + fmtNum(v0) + ' → ' + fmtNum(v1) + '（' + pct + '%）'
      + (items ? ' · 舱内：' + items : ' · 舱内空');
  }

  shipSel.addEventListener('change', () => { errLine.textContent = ''; refreshInfo(); });
  lb.addEventListener('click', () => {
    errLine.textContent = '';
    const s = curShip();
    if (!matSel.value) { errLine.textContent = '请选择要装载的材料'; return; }
    const r = loadShipCargo(account, s.id, matSel.value, qty.value);
    if (!r.ok) { errLine.textContent = r.reason || '装载失败'; return; }
    errLine.textContent = '已装进货舱：' + matSel.value + ' ×' + fmtNum(Math.floor(Number(qty.value) || 0));
    refreshInfo();
  });
  ub.addEventListener('click', () => {
    errLine.textContent = '';
    const s = curShip();
    if (!matSel.value) { errLine.textContent = '请选择要卸下的材料'; return; }
    const r = unloadShipCargo(account, s.id, matSel.value, qty.value);
    if (!r.ok) { errLine.textContent = r.reason || '卸下失败'; return; }
    errLine.textContent = '已卸到星球：' + matSel.value + ' ×' + fmtNum(Math.floor(Number(qty.value) || 0));
    refreshInfo();
  });

  sec.appendChild(shipSel);
  sec.appendChild(matSel);
  sec.append(qty, lb, ub);
  sec.appendChild(infoLine);
  sec.appendChild(errLine);
  refreshInfo();
  return sec;
}

// ============================================================================
// 嵌入舰队页的商店星区块（v0.2.6）：renderFleet 第 4 区调用。
// 与独立商店页 renderShop（colony.js 的商店星入口用）同内容——股市 + 拍卖 + 待运输订单 + 挂单池，
// 但**不接管容器、不挂自己的定时器**：股价/拍卖的局部刷新注册进 hb.updaters，
// 由舰队页心跳（startFleetHeartbeat）统一驱动，避免双定时器互相覆盖。
// ============================================================================
function buildShopSection(account, inst, openModal, redraw, hb) {
  const wrap = el('section', 'fac-group fleet-page-root');
  const market = buildMarketSection(account, inst, openModal, redraw);
  const auction = buildAuctionSection(account, inst, account.homePlanetCode, openModal, redraw);
  wrap.appendChild(market.section);
  wrap.appendChild(auction.section);
  // 原「待运输订单」（旧存档的买/卖交割单，仍可标记送达；新股市为即时交割不再产生）
  wrap.appendChild(buildPendingOrders(account, inst, openModal, redraw));
  // 原挂单/交易池（设计者要求：原有挂单在下方，与股市/拍卖共存）
  wrap.appendChild(buildListingPool(account, inst, openModal, redraw, hb));
  if (hb && Array.isArray(hb.updaters)) {
    hb.updaters.push(() => {
      try { market.refresh(); } catch (e) { /* 忽略 */ }
      try { auction.refresh(); } catch (e) { /* 忽略 */ }
    });
  }
  return wrap;
}

export function renderFleet(container, ctx) {
  const account = (ctx && ctx.account) || currentAccount();
  const planetCode = (ctx && ctx.planetCode) || (account && account.homePlanetCode) || 'syl';
  const openModal = ctx && ctx.openModal ? ctx.openModal : null;
  const rerender = ctx && typeof ctx.rerender === 'function' ? ctx.rerender : null;

  container.innerHTML = '';
  container.className = 'fleet-wrap';
  if (!account) { container.appendChild(el('p', 'muted', '账号数据缺失。')); return; }

  const inst = getPlanetInstance(planetCode);
  const updaters = [];
  const hb = { updaters };
  const redraw = () => { if (rerender) rerender(); else renderFleet(container, ctx); };

  // ===================== 船坞门禁（v0.1.1 需求 C）=====================
  // 设计者：编队 / 五指令与贸易殖民一样需要船坞 —— 没船坞整页只给门槛提示。
  const hasDock = inst && inst.buildings && Number(inst.buildings.dock) > 0;
  if (!hasDock) {
    const gate = el('section', 'fac-group fleet-page-root');
    gate.appendChild(el('div', 'res-section-title', '舰队与殖民'));
    gate.appendChild(el('p', 'muted',
      '需要船坞：船坞尚未建成，先造出船坞才能编队执行星际指令、进行星际贸易与殖民。'));
    container.appendChild(gate);
    startFleetHeartbeat(container, updaters);
    return;
  }

  // ===================== 1. 编队 =====================
  const fSec = el('section', 'fac-group fleet-page-root');
  fSec.appendChild(el('div', 'res-section-title', '编队'));
  fSec.appendChild(el('p', 'muted',
    '把飞船编成舰队后派出持续任务：探索 / 低空防卫 / 巡航 / 运输（登陆待军队系统开放）。任务按时长推进，完成自动结算。'));

  const fleets = listFleets(account);
  if (!fleets.length) fSec.appendChild(el('p', 'muted', '还没有编队。先造几艘船，再点下面新建编队。'));

  for (const fleet of fleets) {
    const row = el('div', 'fac-row');
    const speed = fleetSpeedOf(account, fleet.id);
    const power = Math.round(fleetPowerOf(account, fleet));
    const head = el('div', 'fac-line1');
    head.innerHTML = '<span class="fac-title">' + esc(fleet.nameCn) + '</span>'
      + '<span class="fac-mark muted">' + fleet.shipIds.length + ' 艘 · 航速 ' + fmtNum(speed)
      + ' · 战力 ' + fmtNum(power) + '</span>';
    row.appendChild(head);

    // 船列表 + 移除
    const shipsBox = el('div', 'fac-line2 muted');
    if (!fleet.shipIds.length) shipsBox.textContent = '（空编队）';
    row.appendChild(shipsBox);
    for (const sid of fleet.shipIds) {
      const s = (account.ships || []).find((x) => x && x.id === sid);
      const line = el('div', 'fleet-ship');
      line.appendChild(el('span', null, s ? (s.className || '飞船') : sid));
      const rm = btn('移出', 'btn-sm');
      rm.addEventListener('click', () => {
        const r = removeShipFromFleet(account, fleet.id, sid);
        if (!r.ok) { alert(r.reason); return; }
        redraw();
      });
      line.appendChild(rm);
      row.appendChild(line);
    }

    // 加入船只（未入编队、也未编入任何军队的 —— v0.2.10 军队/舰队互斥）
    const free = (account.ships || []).filter((s) => s && !fleets.some((f) => f.shipIds.includes(s.id))
      && !shipArmyOf(account, s.id));
    if (free.length) {
      const addBox = el('div', 'fleet-add');
      const sel = document.createElement('select');
      sel.className = 'pop-sel';
      for (const s of free) {
        const o = document.createElement('option');
        o.value = s.id;
        o.textContent = (s.className || '飞船') + (s.stats ? '（航速 ' + fmtNum(s.stats.speed) + '）' : '');
        sel.appendChild(o);
      }
      const ab = btn('加入编队', 'btn-primary');
      ab.addEventListener('click', () => {
        const r = addShipToFleet(account, fleet.id, sel.value);
        if (!r.ok) { alert(r.reason); return; }
        redraw();
      });
      addBox.append(sel, ab);
      row.appendChild(addBox);
    }

    // 任务行：任务中显示倒计时（心跳局部刷新），可手动取消
    if (fleet.mission) {
      const mLine = el('div', 'fac-line4 muted fleet-mission');
      row.appendChild(mLine);
      const startedAt = fleet.mission.startedAt;
      const upd = () => {
        const cur = fleet.mission;
        if (!cur || cur.startedAt !== startedAt) { redraw(); return; }   // 任务结束 → 整页刷新出结果
        if (cur.type === 'defense') {
          mLine.textContent = '任务中：' + fleetMissionLabel(cur)
            + '（驻留 · 当前防御加成 +' + defenseBonusOf(account) + '）';
          return;
        }
        const remain = Math.max(0, (Number(cur.duration) || 0) - (Number(cur.elapsed) || 0));
        mLine.textContent = '任务中：' + fleetMissionLabel(cur) + '（剩余 ' + fmtTime(remain) + '）';
      };
      updaters.push(upd);
      upd();
      const cx = btn('取消任务', 'btn-sm');
      cx.addEventListener('click', () => {
        const r = cancelMission(account, fleet.id);
        if (!r.ok) { alert(r.reason); return; }
        redraw();
      });
      row.appendChild(cx);
    }

    // 五个指令（改为发起持续任务；任务中按钮禁用）
    const cmdBox = el('div', 'fleet-cmds');
    for (const cmd of ['explore', 'defense', 'patrol', 'transport', 'land']) {
      const b = btn(CMD_LABEL[cmd], cmd === 'explore' ? 'btn-primary' : '');
      b.title = CMD_TIP[cmd];
      b.disabled = fleet.shipIds.length === 0 || !!fleet.mission;
      b.addEventListener('click', () => runCommand(fleet, cmd));
      cmdBox.appendChild(b);
    }
    row.appendChild(cmdBox);

    const del = btn('解散编队', 'btn-danger btn-sm');
    del.addEventListener('click', () => { disbandFleet(account, fleet.id); redraw(); });
    row.appendChild(del);

    if (fleet.lastResult) {
      row.appendChild(el('div', 'fac-line4 muted',
        '上次：' + (CMD_LABEL[fleet.lastResult.cmd] || '任务') + ' · ' + fleet.lastResult.message));
    }
    fSec.appendChild(row);
  }

  // 新建编队
  {
    const box = el('div', 'fleet-add');
    const inp = document.createElement('input');
    inp.type = 'text';
    inp.className = 'acc-new-input';
    inp.placeholder = '新编队名称（如：远征队）';
    const b = btn('新建编队', 'btn-primary');
    b.addEventListener('click', () => {
      const r = createFleet(account, inp.value);
      if (!r.ok) { alert(r.reason); return; }
      redraw();
    });
    box.append(inp, b);
    fSec.appendChild(box);
  }
  container.appendChild(fSec);

  // ===================== 2. 船载仓库 =====================
  container.appendChild(buildCargoPanel(account, inst));

  // ===================== 3. 殖民管理 =====================
  const mSec = el('section', 'fac-group');
  mSec.appendChild(el('div', 'res-section-title', '殖民管理'));
  const captured = Array.isArray(account.capturedPlanets) ? account.capturedPlanets : [];
  if (!captured.length) {
    mSec.appendChild(el('p', 'muted', '还没有殖民星球。用舰队「探索」去发现并占领新的星球。'));
  }
  for (const cap of captured) {
    const ci = getPlanetInstance(cap.code);
    if (!ci) continue;
    const row = el('div', 'fac-row');
    const happy = Number(ci.pop ? ci.pop.happiness : 0) || 0;
    const indep = Number(ci.independence) || 0;
    const mode = ci.isHome ? null : modeOf(ci);
    row.appendChild(el('div', 'fac-line1',
      cap.nameCn + '（' + cap.type + '）' + (ci.isHome ? ' · 母星' : '')));
    row.appendChild(el('div', 'fac-line2 muted',
      '幸福度 ' + happy.toFixed(2) + ' · 独立倾向 ' + indep.toFixed(2)
      + (mode ? ' · 管理模式：' + mode.nameCn : '')
      + (ci.territoryAssimilated ? ' · 已同化为领土' : '')));
    if (!ci.isHome) {
      const sel = document.createElement('select');
      sel.className = 'pop-sel';
      for (const m of MANAGEMENT_MODES) {
        const o = document.createElement('option');
        o.value = m.id;
        o.textContent = m.nameCn + (m.locked && !ci.territoryAssimilated ? '（需同化后解锁）' : '');
        o.disabled = !!m.locked && !ci.territoryAssimilated;
        if (ci.management === m.id) o.selected = true;
        sel.appendChild(o);
      }
      sel.addEventListener('change', () => {
        const r = setManagement(ci, sel.value);
        if (!r.ok) { alert(r.reason); sel.value = ci.management || 'colonial'; return; }
        redraw();
      });
      row.appendChild(sel);
      row.appendChild(el('div', 'fac-line4 muted',
        mode ? mode.desc : ''
        + '｜幸福度 ≥ ' + TERRITORY_HAPPY_THRESHOLD + ' 持续 ' + fmtTime(TERRITORY_ASSIMILATE_SEC)
        + ' 会后同化成领土'
        + (ci.territoryProgress ? '（已累计 ' + fmtTime(Math.floor(ci.territoryProgress)) + '）' : '')));
    }
    mSec.appendChild(row);
  }
  container.appendChild(mSec);

  // ===================== 4. 商店星 =====================
  container.appendChild(buildShopSection(account, inst, openModal, redraw, hb));

  // 挂上心跳（任务倒计时 + 交易池局部刷新）
  startFleetHeartbeat(container, updaters);

  // v0.1.2 R12：运输发起改为表单——目的地/数量输入，物资名用下拉（持有>0），不再 prompt 输物资名
  function openTransportForm(fleet) {
    const capList = (account.capturedPlanets || []).map((c) => c.code);
    const form = el('div', 'transport-form');

    form.appendChild(el('div', 'res-sub muted', '目的地星球编号（已殖民星球，如 ' + (capList[0] || 'des') + '）'));
    const targetInp = document.createElement('input');
    targetInp.type = 'text'; targetInp.className = 'acc-new-input';
    targetInp.value = capList[0] || 'des';
    targetInp.placeholder = '例：' + (capList[0] || 'des');
    form.appendChild(targetInp);

    form.appendChild(el('div', 'res-sub muted', '要运输的物资（仅列出当前星球持有 > 0 的）'));
    const matSel = document.createElement('select');
    matSel.className = 'pop-sel'; matSel.style.minHeight = '44px';
    const held = (inst && Array.isArray(inst.inventory) ? inst.inventory : [])
      .filter((e) => e && e.mat && (Number(e.owned) || 0) > 0);
    if (held.length) {
      const ph = document.createElement('option'); ph.value = ''; ph.textContent = '请选择物资'; matSel.appendChild(ph);
      const seen = new Set();
      for (const e of held) {
        if (seen.has(e.mat)) continue; seen.add(e.mat);
        const o = document.createElement('option');
        o.value = e.mat;
        o.textContent = e.mat + '（持有 ' + fmtNum(ownedOf(inst, e.mat)) + '）';
        matSel.appendChild(o);
      }
    } else {
      const o = document.createElement('option'); o.value = ''; o.textContent = '（当前星球没有持有的材料）'; matSel.appendChild(o);
    }
    form.appendChild(matSel);

    form.appendChild(el('div', 'res-sub muted', '数量'));
    const qtyInp = document.createElement('input');
    qtyInp.type = 'number'; qtyInp.min = '1'; qtyInp.value = '10'; qtyInp.className = 'shop-qty';
    qtyInp.style.minHeight = '44px'; qtyInp.style.minWidth = '88px';
    form.appendChild(qtyInp);

    const errLine = el('div', 'fac-line4', ''); errLine.style.color = '#ff9a76';
    form.appendChild(errLine);

    const go = btn('确认运输', 'btn-primary'); go.style.minHeight = '44px';
    go.addEventListener('click', () => {
      const target = (targetInp.value || '').trim();
      const mat = matSel.value;
      const qty = Math.floor(Number(qtyInp.value) || 0);   // 数字校验：非正整数不给过
      if (!target) { errLine.textContent = '请填写目的地星球编号'; return; }
      if (!mat) { errLine.textContent = '请选择要运输的物资'; return; }
      if (!(qty > 0)) { errLine.textContent = '数量必须为正整数'; return; }
      const r = startMission(account, fleet.id, 'transport', target, { [mat]: qty });
      if (!r.ok) { errLine.textContent = '无法发起：' + (r.reason || '任务发起失败'); return; }
      if (closeFn) closeFn();
      redraw();
    });
    form.appendChild(go);

    const closeFn = openModal ? openModal({ title: '发起运输任务', body: form }) : null;
    if (!openModal) {
      container.appendChild(el('div', 'res-section-title', '发起运输任务'));
      container.appendChild(form);
    }
  }

  // ===================== 指令执行（发起持续任务）=====================
  function runCommand(fleet, cmd) {
    if (cmd === 'land') {
      const res = executeCommand(account, fleet.id, 'land', { planetCode });
      if (!res.ok) alert(res.message || res.reason || '指令失败');
      return;
    }
    if (fleet.mission) {
      alert('编队任务中：' + fleetMissionLabel(fleet.mission) + '，请先取消当前任务');
      return;
    }
    if (cmd === 'transport') {
      openTransportForm(fleet);
      return;
    }
    // explore / patrol / defense：立即出发；explore 的发现与遭遇在任务完成后的 lastResult 展示
    const r = startMission(account, fleet.id, cmd);
    if (!r.ok) { alert(r.reason || '任务发起失败'); return; }
    redraw();
  }
}

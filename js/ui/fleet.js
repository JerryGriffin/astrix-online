// 舰队战备与战术指挥中心（Astrix v0.2.0）
// 提供编队战备管理、实时战术交互交战视窗、船载物流、殖民地政令与星港贸易。
// 纯原生 ES 模块，深空玻璃拟态风格，移动端与 PC 端自适应（点击区 >= 44px）。

import { fmtNum, fmtRate, fmtTime } from '../core/format.js?v=21.17';
import {
  listFleets, createFleet, disbandFleet, addShipToFleet, removeShipFromFleet,
  fleetSpeedOf, fleetPowerOf, executeCommand,
  startMission, cancelMission, fleetMissionLabel, defenseBonusOf,
  shipCargoOf, loadShipCargo, unloadShipCargo,
  shipCargoMassOf, shipCargoCellsOf, shipCargoCellsMax, effectiveSpeedOf,
  resolveFleetAnomaly,
  listLandTargets, estimateGarrisonOf, embarkedArmiesOf, findPlanetDef, MISSION_DISTANCE, EXPLORE_FUEL_PER_DIST,
} from '../core/fleet.js?v=21.17';
import { embarkableArmies } from '../core/army.js?v=21.17';
import { equipmentList } from '../core/shipyard.js?v=21.17';
import {
  MANAGEMENT_MODES, MANAGEMENT_BY_ID, modeOf, setManagement,
  TERRITORY_ASSIMILATE_SEC, TERRITORY_HAPPY_THRESHOLD,
} from '../core/planetgen.js?v=21.17';
import {
  SHOP_PLANET, shopPrices, sell, pendingOrders, deliverOrder, ascoinBalance,
  suggestPriceOf, listForSale, marketListings, cancelListing, buyListing, priceOf, shopStateOf,
  MARKET_FEE,
} from '../core/shop.js?v=21.17';
import { getPlanetInstance, currentAccount, ownedOf } from '../core/state.js?v=21.17';
import { openBattleView } from './combat.js?v=21.17';
import { detectShipRole, SHIP_ROLES } from '../core/combat.js?v=21.17';
import { isSoundEnabled, toggleSound, playPing, playVictory, playWarp, playExplosion } from '../core/sound.js?v=21.17';

// HTML 转义
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
  explore: '🔍 探索', defense: '🛡️ 低空防卫', patrol: '📡 巡航', transport: '📦 运输', land: '🪖 登陆',
};
// 短提示（鼠标悬停）与完整详解（点击图例卡弹出的说明窗）分开：
//   · title 只放一句话，避免悬停时浮出一整段长文遮挡界面；
//   · 完整规则收进「指令详解」弹窗，配合图标逐条呈现（rev15：长文本图形化）。
const CMD_TIP = {
  explore: '探索未知星域，可能发现星球或遭遇战',
  defense: '驻留母星空域，提升行星防御',
  patrol: '巡航拦截敌对侦察舰并触发交火',
  transport: '把物资运到目标星球，需运输船',
  land: '投送地面部队换防或发动登陆战',
};
const CMD_ORDER = ['explore', 'defense', 'patrol', 'transport', 'land'];
const CMD_DETAIL = {
  explore: {
    req: '任意编队',
    gain: '新星球 / 战利品',
    risk: '遭遇战与战损',
    text: '派出舰队探索未知星域，任务完成后结算：大概率发现新星球并立即纳入版图，也可能发生空间遭遇战。',
  },
  defense: {
    req: '任意编队',
    gain: '行星防御加成',
    risk: '占用编队',
    text: '舰队驻留母星空域执行低空防卫，为所在星球叠加要塞防御力；属长期驻守任务，需手动召回才会结束。',
  },
  patrol: {
    req: '任意编队',
    gain: '歼灭侦察舰 / 战利品',
    risk: '己方掉舰',
    text: '派出舰队巡航，任务期间可能拦截敌对侦察舰并触发实时战术交火，胜利可获得随机战利品与赏金。',
  },
  transport: {
    req: '编队含运输船',
    gain: '物资送达目的地',
    risk: '占用货舱格位',
    text: '把母星物资运抵目标星球，抵达后自动卸货入账；需要编队里配属了运输船，且载货格数足够。',
  },
  land: {
    req: '编队 + 地面部队',
    gain: '换防 / 占领星球',
    risk: '部队折损',
    text: '搭载地面部队执行登陆任务：己方星球直接换防驻扎；未知星球将发动登陆战，守军规模随星球丰度上升，'
      + '胜利可占领星球并掠夺地表矿脉战利品，失败则部队折损、幸存者撤回母星。',
  },
};

// 图形化任务指令图例（rev15）：5 张图标卡 + 一张「指令详解」弹窗入口，
// 取代此前只挂在按钮 title 上、玩家基本不会读到的大段说明文字。
function buildMissionLegend(openModal) {
  const box = el('div');
  box.style.cssText = 'display:flex;flex-wrap:wrap;gap:8px;align-items:stretch;margin:8px 0 4px;';
  for (const cmd of CMD_ORDER) {
    const d = CMD_DETAIL[cmd];
    const card = el('button');
    card.type = 'button';
    card.style.cssText = 'flex:1 1 108px;min-width:104px;min-height:64px;text-align:left;cursor:pointer;'
      + 'padding:8px 10px;border-radius:8px;border:1px solid rgba(124,215,255,0.22);'
      + 'background:rgba(124,215,255,0.06);color:#cbd5e1;font-size:11px;line-height:1.35;';
    card.innerHTML = '<div style="font-size:12px;font-weight:bold;color:#7cd7ff;">' + CMD_LABEL[cmd] + '</div>'
      + '<div style="margin-top:3px;color:#94a3b8;">前置 · ' + d.req + '</div>'
      + '<div style="margin-top:2px;color:#9FE1CB;">收益 · ' + d.gain + '</div>';
    card.title = CMD_TIP[cmd] + '（点击查看完整规则）';
    card.addEventListener('click', () => {
      if (!openModal) return;
      const body = document.createElement('div');
      body.innerHTML = CMD_ORDER.map((c) => {
        const dd = CMD_DETAIL[c];
        return '<div style="border:1px solid #22354c;border-radius:8px;padding:10px 12px;margin-bottom:8px;background:rgba(0,0,0,0.25);">'
          + '<div style="font-weight:bold;color:#7cd7ff;font-size:13px;margin-bottom:4px;">' + CMD_LABEL[c] + '</div>'
          + '<div style="color:#cbd5e1;font-size:12px;line-height:1.6;margin-bottom:6px;">' + esc(dd.text) + '</div>'
          + '<div style="display:flex;flex-wrap:wrap;gap:6px;font-size:11px;">'
          + '<span style="padding:2px 8px;border-radius:10px;background:rgba(56,189,248,0.12);border:1px solid #38bdf840;color:#7cd7ff;">前置：' + esc(dd.req) + '</span>'
          + '<span style="padding:2px 8px;border-radius:10px;background:rgba(159,225,203,0.10);border:1px solid #9FE1CB40;color:#9FE1CB;">收益：' + esc(dd.gain) + '</span>'
          + '<span style="padding:2px 8px;border-radius:10px;background:rgba(240,149,149,0.10);border:1px solid #f0959540;color:#f09595;">风险：' + esc(dd.risk) + '</span>'
          + '</div></div>';
      }).join('');
      openModal({ title: '星际任务指令详解', body });
    });
    box.appendChild(card);
  }
  return box;
}

// 统计小卡片（v0.2.3：概况区从一行长文本改为图标数字卡片，便于一眼读数）
function fleetStatCard(icon, label, val, color) {
  return '<div style="flex:1;min-width:96px;background:rgba(0,0,0,0.3);border:1px solid rgba(255,255,255,0.08);'
    + 'border-radius:6px;padding:8px 10px;text-align:center;">'
    + '<div style="font-size:16px;font-weight:bold;color:' + color + ';">' + icon + ' ' + val + '</div>'
    + '<div style="font-size:10px;color:#94a3b8;margin-top:2px;">' + label + '</div></div>';
}

// 周期性局部刷新心跳
function startFleetHeartbeat(container, updaters) {
  if (container._hbTimer) { clearInterval(container._hbTimer); container._hbTimer = null; }
  if (!updaters.length) return;
  container._hbTimer = setInterval(() => {
    if (typeof document !== 'undefined' && document.hidden) return;
    if (!container.querySelector('.fleet-page-root')) {
      if (container._hbTimer) { clearInterval(container._hbTimer); container._hbTimer = null; }
      return;
    }
    for (const fn of updaters) {
      try { fn(); } catch (e) {}
    }
  }, 1000);
}

// ============================================================================
// 一、商店星独立面板导出（保留既有对外契约）
// ============================================================================
export function renderShop(container, ctx) {
  const account = (ctx && ctx.account) || currentAccount();
  const planetCode = (ctx && ctx.planetCode) || (account && account.homePlanetCode) || 'syl';
  const openModal = ctx && ctx.openModal ? ctx.openModal : null;
  const rerender = ctx && typeof ctx.rerender === 'function' ? ctx.rerender : null;
  const inst = getPlanetInstance(planetCode);
  container.innerHTML = '';
  container.className = 'fleet-wrap';
  if (!account) { container.appendChild(el('p', 'muted', '账号数据缺失。')); return; }
  const redraw = () => { if (rerender) rerender(); else renderShop(container, ctx); };
  container.appendChild(buildShopSection(account, inst, openModal, redraw));
}

function buildShopSection(account, inst, openModal, redraw, hb) {
  const sSec = el('section', 'fac-group');
  sSec.appendChild(el('div', 'res-section-title', SHOP_PLANET.nameCn + '（' + SHOP_PLANET.nameEn + '）'));
  sSec.appendChild(el('p', 'muted',
    SHOP_PLANET.description + '　当前余额 ' + fmtNum(ascoinBalance(account)) + ' Ascoin。'
    + ' 买卖只是下单，货物需要运输船送达（订单会列在下面）。'));

  const orders = pendingOrders(account);
  if (orders.length) {
    sSec.appendChild(el('div', 'res-sub muted', '待运输订单'));
    for (const o of orders) {
      const line = el('div', 'fleet-ship');
      line.appendChild(el('span', null,
        (o.side === 'buy' ? '买 ' : '卖 ') + o.mat + ' ×' + o.qty + '（' + (o.side === 'buy' ? '付 ' : '得 ') + o.cost + ' Ascoin）'));
      if (o.delivered) {
        line.appendChild(el('span', 'fac-mark', '已送达'));
      } else {
        const db = btn('标记已送达', 'btn-sm');
        db.addEventListener('click', () => {
          const r = deliverOrder(account, o.id);
          if (!r.ok) { alert(r.reason); return; }
          redraw();
        });
        line.appendChild(db);
      }
      sSec.appendChild(line);
    }
  }

  // 交易池区
  const mktSec = el('div', 'fleet-market');
  mktSec.appendChild(el('div', 'res-sub muted', '星际物资交易市集（电脑实时撮合）'));

  const prices = shopPrices(account);
  const rows = el('div', 'fleet-prices');
  for (const mat in prices) {
    const row = el('div', 'fleet-price-row');
    row.innerHTML = '<span>' + mat + '</span><span>' + fmtNum(prices[mat]) + ' Ascoin</span>';
    const bb = btn('买', 'btn-sm');
    bb.addEventListener('click', () => {
      openTradeDialog(account, mat, 'buy', prices[mat], openModal, redraw);
    });
    const sb = btn('卖', 'btn-sm');
    sb.addEventListener('click', () => {
      openTradeDialog(account, mat, 'sell', prices[mat], openModal, redraw);
    });
    row.append(bb, sb);
    rows.appendChild(row);
  }
  mktSec.appendChild(rows);
  sSec.appendChild(mktSec);
  return sSec;
}

function openTradeDialog(account, mat, side, price, openModal, redraw) {
  const div = document.createElement('div');
  div.innerHTML = `
    <p style="color:#94a3b8;font-size:13px;line-height:1.5;">${side === 'buy' ? '从星际市集采购' : '向星际市集挂单出售'}物资「${mat}」，单价约 ${fmtNum(price)} Ascoin。</p>
    <div style="margin:12px 0;">
      <label style="font-size:12px;color:#94a3b8;display:block;margin-bottom:4px;">交易数量：</label>
      <input type="number" id="trade-mkt-qty" min="1" max="10000" value="10"
             style="width:100%;min-height:44px;background:#0b101c;border:1px solid #22354c;color:#c8d4e0;border-radius:6px;padding:8px 12px;font-size:14px;">
    </div>
    <button id="btn-mkt-confirm" style="width:100%;min-height:44px;background:#7cd7ff;color:#0b101c;font-weight:bold;border:none;border-radius:6px;cursor:pointer;">确认下单</button>
  `;
  if (openModal) {
    openModal({ title: `${side === 'buy' ? '买入' : '卖出'}：${mat}`, body: div });
    setTimeout(() => {
      const btnConf = document.getElementById('btn-mkt-confirm');
      const inp = document.getElementById('trade-mkt-qty');
      if (btnConf && inp) {
        btnConf.onclick = () => {
          const qty = parseInt(inp.value, 10) || 10;
          if (side === 'buy') {
            const r = listForSale(account, mat, qty, price);
            alert(r.ok ? '采购订单已建立' : (r.reason || '下单失败'));
          } else {
            const r = sell(account, mat, qty);
            alert(r.ok ? '出售订单已下达' : (r.reason || '下单失败'));
          }
          redraw();
        };
      }
    }, 50);
  }
}

// ============================================================================
// 二、船载仓储面板
// ============================================================================
function buildCargoPanel(account, inst) {
  const cSec = el('section', 'fac-group');
  cSec.appendChild(el('div', 'res-section-title', '船载仓库管理'));
  cSec.appendChild(el('p', 'muted', '为在泊舰船调拨随舰物资或装卸货运物资。'));

  const ships = Array.isArray(account.ships) ? account.ships : [];
  if (!ships.length) {
    cSec.appendChild(el('p', 'muted', '当前港口暂无战舰。'));
    return cSec;
  }

  for (const s of ships) {
    const row = el('div', 'fac-row');
    const cargo = shipCargoOf(s);
    const cargoKeys = Object.keys(cargo);
    const used = shipCargoCellsOf(s);
    const cap = shipCargoCellsMax(s);
    const pct = cap > 0 ? Math.max(0, Math.min(100, (used / cap) * 100)) : 0;
    const mass = shipCargoMassOf(s);

    // rev15：从「已载货物: A ×1, B ×2, …」一行长串改为
    //   「舰名 + 容量条 + 货物徽章网格」，满舱红色预警、空舱灰字占位。
    const head = el('div', 'fac-line1');
    head.style.cssText = 'display:flex;justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap;';
    head.innerHTML = '<b>' + esc(s.name || s.className || '飞船') + '</b>'
      + '<span style="font-size:11px;color:' + (pct >= 90 ? '#f09595' : '#94a3b8') + ';">'
      + '货舱 ' + fmtNum(used) + ' / ' + fmtNum(cap) + ' 格 · 载重 ' + fmtNum(mass) + '</span>';
    row.appendChild(head);

    const bar = el('div');
    bar.style.cssText = 'height:6px;border-radius:3px;background:#0f1720;overflow:hidden;margin:6px 0 8px;';
    bar.innerHTML = '<i style="display:block;height:100%;width:' + pct.toFixed(1) + '%;background:'
      + (pct >= 90 ? '#f09595' : '#5DCAA5') + ';transition:width .3s;"></i>';
    row.appendChild(bar);

    const grid = el('div');
    grid.style.cssText = 'display:flex;flex-wrap:wrap;gap:6px;';
    if (!cargoKeys.length) {
      grid.innerHTML = '<span style="font-size:11px;color:#64748b;padding:2px 0;">空舱待命 —— 可在运输任务中装载物资</span>';
    } else {
      grid.innerHTML = cargoKeys.map((k) => '<span style="font-size:11px;padding:2px 8px;border-radius:10px;'
        + 'background:rgba(124,215,255,0.08);border:1px solid #7cd7ff33;color:#cbd5e1;">'
        + esc(k) + ' <b style="color:#7cd7ff;">×' + fmtNum(cargo[k]) + '</b></span>').join('');
    }
    row.appendChild(grid);
    cSec.appendChild(row);
  }
  return cSec;
}

// ============================================================================
// 三、舰队战备主入口（全面重写：支持编队管理与实时交互式战术战斗演练）
// ============================================================================
export function renderFleet(container, ctx) {
  const account = (ctx && ctx.account) || currentAccount();
  const planetCode = (ctx && ctx.planetCode) || (account && account.homePlanetCode) || 'syl';
  const openModal = ctx && ctx.openModal ? ctx.openModal : null;
  const closeModal = ctx && ctx.closeModal ? ctx.closeModal : null;
  const rerender = ctx && typeof ctx.rerender === 'function' ? ctx.rerender : null;

  container.innerHTML = '';
  container.className = 'fleet-wrap';
  if (!account) { container.appendChild(el('p', 'muted', '账号数据缺失。')); return; }

  const inst = getPlanetInstance(planetCode);
  const updaters = [];
  const redraw = () => { if (rerender) rerender(); else renderFleet(container, ctx); };

  // 船坞门禁
  const hasDock = inst && inst.buildings && Number(inst.buildings.dock) > 0;
  if (!hasDock) {
    const gate = el('section', 'fac-group fleet-page-root');
    gate.appendChild(el('div', 'res-section-title', '舰队指挥中心'));
    gate.appendChild(el('p', 'muted',
      '门槛提示：母星尚未建造「船坞」，造出船坞后方可编组太空舰队、执行星际巡航与进行实时战术交火。'));
    container.appendChild(gate);
    startFleetHeartbeat(container, updaters);
    return;
  }

  // 1. 顶部战备概况与战术交战演练入口
  const fleets = listFleets(account);
  const totalShips = (account.ships || []).length;
  let totalFleetPower = 0;
  fleets.forEach((f) => { totalFleetPower += fleetPowerOf(account, f); });
  // v0.2.3：在泊待命 = 尚未编入任何编队的舰船（提醒玩家有闲置战力可用）
  const idleShips = (account.ships || []).filter((s) => s && !fleets.some((f) => f.shipIds.includes(s.id))).length;

  const summary = document.createElement('div');
  summary.className = 'glass fleet-page-root';
  summary.style.cssText = 'padding:16px;border-radius:8px;margin-bottom:14px;border:1px solid rgba(124,215,255,0.25);display:flex;flex-wrap:wrap;gap:14px;justify-content:space-between;align-items:center;';

  summary.innerHTML = `
    <div style="flex:1;min-width:260px;">
      <div style="font-size:17px;font-weight:bold;color:#7cd7ff;display:flex;align-items:center;gap:8px;">
        <span>🚀 太空舰队与战术指挥中心</span>
      </div>
      <div style="display:flex;flex-wrap:wrap;gap:8px;margin-top:10px;">
        ${fleetStatCard('🛸', '总编队', fleets.length, '#7cd7ff')}
        ${fleetStatCard('🚀', '现役舰船', totalShips, '#9FE1CB')}
        ${fleetStatCard('⚓', '在泊待命', idleShips, idleShips > 0 ? '#ffc46b' : '#64748b')}
        ${fleetStatCard('⚔️', '编队总战力', fmtNum(Math.round(totalFleetPower)), '#fda4af')}
      </div>
    </div>
  `;

  // 战术交互实战演练按钮
  const btnDrill = document.createElement('button');
  btnDrill.className = 'btn-action';
  btnDrill.style.cssText = 'min-height:44px;padding:8px 18px;border-radius:6px;border:1px solid #7cd7ff;background:linear-gradient(135deg, rgba(124,215,255,0.25), rgba(99,102,241,0.25));color:#f1f5f9;font-weight:bold;font-size:13px;cursor:pointer;display:flex;align-items:center;gap:8px;';
  btnDrill.innerHTML = '<span>⚔️ 发起战术交火推演</span>';
  btnDrill.onclick = () => {
    const pShips = (account.ships && account.ships.length > 0) ? account.ships.slice(0, 4) : [];
    let chosenDoctrine = 'blitzkrieg';
    // v0.2.3 修复：此前 div 未定义（ReferenceError），推演弹窗完全打不开
    const div = document.createElement('div');
    div.innerHTML = `
      <p style="color:#94a3b8;font-size:13px;line-height:1.5;margin-bottom:10px;">
        指挥部实时全息推演系统。请配置本次战役所贯彻的<b>最高军事统帅学说</b>与作战方案：
      </p>
      <!-- 钢铁雄心式学说选择区 -->
      <div style="margin-bottom:12px;background:rgba(0,0,0,0.3);padding:10px;border-radius:6px;border:1px solid rgba(124,215,255,0.2);">
        <div style="font-size:12px;font-weight:bold;color:#fde047;margin-bottom:6px;">🎖️ 战略学说贯彻：</div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:6px;" id="bt-doctrine-picker">
          <button type="button" data-doc="blitzkrieg" style="padding:6px;border-radius:4px;border:1px solid #eab308;background:rgba(234,179,8,0.2);color:#fde047;font-size:11px;cursor:pointer;text-align:left;">
            <b>⚡ 闪电突穿</b><br><span style="font-size:10px;opacity:0.8;">火力+20%·电容+25·闪避+10%</span>
          </button>
          <button type="button" data-doc="superior_firepower" style="padding:6px;border-radius:4px;border:1px solid #334155;background:rgba(255,255,255,0.04);color:#94a3b8;font-size:11px;cursor:pointer;text-align:left;">
            <b>🎯 优势火力</b><br><span style="font-size:10px;opacity:0.8;">暴击+20%·爆伤+30%·回能+20%</span>
          </button>
          <button type="button" data-doc="grand_battleplan" style="padding:6px;border-radius:4px;border:1px solid #334155;background:rgba(255,255,255,0.04);color:#94a3b8;font-size:11px;cursor:pointer;text-align:left;">
            <b>🛡️ 大纵深防御</b><br><span style="font-size:10px;opacity:0.8;">装甲护盾+35%·全伤减免15%</span>
          </button>
          <button type="button" data-doc="guerilla_warfare" style="padding:6px;border-radius:4px;border:1px solid #334155;background:rgba(255,255,255,0.04);color:#94a3b8;font-size:11px;cursor:pointer;text-align:left;">
            <b>🐺 狼群破袭</b><br><span style="font-size:10px;opacity:0.8;">航速+30%·真实穿透+20%</span>
          </button>
        </div>
      </div>

      <div style="font-size:12px;font-weight:bold;color:#7cd7ff;margin-bottom:6px;">🎯 选择交火战役推演场景：</div>
      <div style="display:flex;flex-direction:column;gap:10px;">
        <button id="bt-scen-1" style="padding:10px 14px;border-radius:6px;background:rgba(56,189,248,0.1);border:1px solid #38bdf850;color:#f1f5f9;cursor:pointer;text-align:left;">
          <div style="font-weight:bold;color:#7cd7ff;">🌌 场景 A：深空哨戒巡逻遭遇战（初级）</div>
          <div style="font-size:12px;color:#94a3b8;margin-top:2px;">假想敌：2 艘轻型突击截击舰 · 检验基础机动与副炮近防</div>
        </button>
        <button id="bt-scen-2" style="padding:10px 14px;border-radius:6px;background:rgba(129,140,248,0.1);border:1px solid #818cf850;color:#f1f5f9;cursor:pointer;text-align:left;">
          <div style="font-weight:bold;color:#a5b4fc;">🏴‍☠️ 场景 B：星盗劫掠特遣战斗群（进阶）</div>
          <div style="font-size:12px;color:#94a3b8;margin-top:2px;">假想敌：1 艘破盾驱逐舰 + 1 艘导弹巡洋舰 · 检验护盾过载与反舰鱼雷</div>
        </button>
        <button id="bt-scen-3" style="padding:10px 14px;border-radius:6px;background:rgba(244,63,94,0.1);border:1px solid #f43f5e50;color:#f1f5f9;cursor:pointer;text-align:left;">
          <div style="font-weight:bold;color:#fda4af;">💥 场景 C：深空无畏战列舰要塞决战（终极）</div>
          <div style="font-size:12px;color:#94a3b8;margin-top:2px;">假想敌：1 艘重装战列舰 + 1 艘空天母舰 + 2 艘护卫舰 · 检验天基湮灭轰炸、纳米抢修与 EMP 磁暴</div>
        </button>
      </div>
    `;

    openModal({ title: '选择战略学说与交火推演场景', body: div });

    setTimeout(() => {
      const docBtns = div.querySelectorAll('#bt-doctrine-picker button');
      docBtns.forEach((b) => {
        b.onclick = () => {
          chosenDoctrine = b.getAttribute('data-doc');
          docBtns.forEach((ob) => {
            const isMatch = ob.getAttribute('data-doc') === chosenDoctrine;
            ob.style.borderColor = isMatch ? '#eab308' : '#334155';
            ob.style.background = isMatch ? 'rgba(234,179,8,0.2)' : 'rgba(255,255,255,0.04)';
            ob.style.color = isMatch ? '#fde047' : '#94a3b8';
          });
        };
      });

      const b1 = document.getElementById('bt-scen-1');
      const b2 = document.getElementById('bt-scen-2');
      const b3 = document.getElementById('bt-scen-3');

      if (b1) {
        b1.onclick = () => {
          closeModal();
          openBattleView({ openModal, closeModal, onBattleEnd: () => redraw() }, {
            title: '深空哨戒巡逻遭遇战',
            doctrine: chosenDoctrine,
            playerShips: pShips,
            enemyShips: [
              { name: '星盗截击侦察艇 Alpha', dryMass: 250, thrust: 360, role: 'interceptor' },
              { name: '星盗截击侦察艇 Beta', dryMass: 260, thrust: 350, role: 'interceptor' },
            ],
          });
        };
      }
      if (b2) {
        b2.onclick = () => {
          closeModal();
          openBattleView({ openModal, closeModal, onBattleEnd: () => redraw() }, {
            title: '星盗劫掠特遣战斗群',
            doctrine: chosenDoctrine,
            playerShips: pShips,
            enemyShips: [
              { name: '星盗掠夺驱逐舰', dryMass: 450, thrust: 280, role: 'destroyer' },
              { name: '铁血打击巡洋舰', dryMass: 650, thrust: 260, role: 'cruiser' },
            ],
          });
        };
      }
      if (b3) {
        b3.onclick = () => {
          closeModal();
          openBattleView({ openModal, closeModal, onBattleEnd: () => redraw() }, {
            title: '深空无畏战列舰要塞决战',
            doctrine: chosenDoctrine,
            playerShips: pShips,
            enemyShips: [
              { name: '要塞无畏重装战列舰', dryMass: 1100, thrust: 220, role: 'battleship' },
              { name: '深空幽灵空天母舰', dryMass: 850, thrust: 240, role: 'carrier' },
              { name: '近防护卫哨舰 A', dryMass: 280, thrust: 320, role: 'interceptor' },
              { name: '近防护卫哨舰 B', dryMass: 280, thrust: 320, role: 'interceptor' },
            ],
          });
        };
      }
    }, 50);
  };

  const btnSound = document.createElement('button');
  btnSound.className = 'btn-action';
  btnSound.style.cssText = 'min-height:44px;padding:8px 14px;border-radius:6px;border:1px solid #334155;background:rgba(255,255,255,0.06);color:#cbd5e1;font-size:13px;cursor:pointer;display:flex;align-items:center;gap:6px;';
  btnSound.innerHTML = isSoundEnabled() ? '🔊 舰载音频: 开' : '🔇 舰载音频: 关';
  btnSound.onclick = () => {
    const on = toggleSound();
    btnSound.innerHTML = on ? '🔊 舰载音频: 开' : '🔇 舰载音频: 关';
    btnSound.style.color = on ? '#7cd7ff' : '#94a3b8';
    if (on) playPing();
  };

  summary.appendChild(btnDrill);
  summary.appendChild(btnSound);
  container.appendChild(summary);

  // 2. 编队列表与任务控制区
  const fSec = el('section', 'fac-group');
  fSec.appendChild(el('div', 'res-section-title', '现役特遣编队'));
  // rev15：原先这里是一整段说明文字（编队管理 + 五条指令各干什么），玩家基本不读；
  //   现在改为「五行图标指令卡 + 详解弹窗」的图形化图例，文字只在点击后出现。
  fSec.appendChild(buildMissionLegend(openModal));

  if (!fleets.length) {
    fSec.appendChild(el('p', 'muted', '暂无组建编队。请在下方输入名称新建编队。'));
  }

  for (const fleet of fleets) {
    const row = el('div', 'fac-row');
    const speed = fleetSpeedOf(account, fleet.id);
    const power = Math.round(fleetPowerOf(account, fleet));

    const head = el('div', 'fac-line1');
    head.style.cssText = 'display:flex;justify-content:space-between;align-items:center;margin-bottom:6px;gap:8px;flex-wrap:wrap;';
    // v0.2.3：属性改徽章（chip）排布，任务中的编队直接在名称旁显示任务徽章
    head.innerHTML = `
      <div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap;">
        <span class="fac-title" style="font-size:15px;color:#f1f5f9;">${esc(fleet.nameCn)}</span>
        ${fleet.mission ? `<span style="font-size:11px;padding:2px 8px;border-radius:10px;background:rgba(56,189,248,0.15);border:1px solid #38bdf850;color:#7cd7ff;">${esc(fleetMissionLabel(fleet.mission))}</span>` : ''}
        <span style="font-size:11px;padding:2px 8px;border-radius:10px;background:rgba(255,255,255,0.05);border:1px solid #33415580;color:#94a3b8;">🚀 ${fleet.shipIds.length} 艘</span>
        <span style="font-size:11px;padding:2px 8px;border-radius:10px;background:rgba(255,255,255,0.05);border:1px solid #33415580;color:#94a3b8;">💨 航速 ${fmtNum(speed)}</span>
        <span style="font-size:11px;padding:2px 8px;border-radius:10px;background:rgba(159,225,203,0.08);border:1px solid #9FE1CB40;color:#9FE1CB;">⚔️ 战力 ${fmtNum(power)}</span>
      </div>
    `;

    // 针对该编队的战术实战交战按钮
    const btnBattleThis = document.createElement('button');
    btnBattleThis.style.cssText = 'padding:4px 12px;min-height:36px;border-radius:4px;border:1px solid rgba(240,149,149,0.5);background:rgba(240,149,149,0.12);color:#f09595;font-size:12px;font-weight:bold;cursor:pointer;';
    btnBattleThis.textContent = '⚔️ 战术实操交战';
    btnBattleThis.onclick = () => {
      const fleetShips = (account.ships || []).filter((s) => fleet.shipIds.includes(s.id));
      openBattleView({ openModal, closeModal, onBattleEnd: () => redraw() }, {
        title: `编队【${fleet.nameCn}】战术接战`,
        playerShips: fleetShips,
      });
    };
    head.appendChild(btnBattleThis);
    row.appendChild(head);

    // 舰船名单与移出
    const shipsBox = el('div', 'fac-line2 muted');
    if (!fleet.shipIds.length) {
      shipsBox.textContent = '（空编队——先在下方「加入编队」选入在泊战舰，再发起星际任务）';
      shipsBox.style.cssText = 'padding:6px 8px;border:1px dashed #334155;border-radius:4px;color:#64748b;font-size:12px;';
    }
    row.appendChild(shipsBox);

    for (const sid of fleet.shipIds) {
      const s = (account.ships || []).find((x) => x && x.id === sid);
      const roleId = detectShipRole(s || {});
      const roleMeta = SHIP_ROLES[roleId] || {};
      const line = el('div', 'fleet-ship');
      line.style.cssText = 'display:flex;justify-content:space-between;align-items:center;padding:4px 8px;background:rgba(0,0,0,0.2);border-radius:4px;margin-bottom:4px;';
      // v0.2.3：舰船行尾部显示单船战力（与编队总战力同口径，取 strength）
      const shipPower = s ? Math.round(Number(s.strength) || 0) : 0;
      const label = document.createElement('span');
      label.innerHTML = `<span style="margin-right:6px;">${roleMeta.icon || '🚀'}</span><span style="font-weight:500;">${esc(s ? (s.className || s.name || '飞船') : sid)}</span> <span style="font-size:11px;color:#7cd7ff;margin-left:4px;">[${roleMeta.name || '战舰'}]</span>`
        + (shipPower > 0 ? ` <span style="font-size:10px;color:#64748b;margin-left:6px;">⚔️ ${fmtNum(shipPower)}</span>` : '');
      line.appendChild(label);
      const rm = btn('移出', 'btn-sm');
      rm.addEventListener('click', () => {
        const r = removeShipFromFleet(account, fleet.id, sid);
        if (!r.ok) { alert(r.reason); return; }
        redraw();
      });
      line.appendChild(rm);
      row.appendChild(line);
    }

    // 加入舰船
    const free = (account.ships || []).filter((s) => s && !fleets.some((f) => f.shipIds.includes(s.id)));
    if (free.length) {
      const addBox = el('div', 'fleet-add');
      addBox.style.cssText = 'margin-top:6px;display:flex;gap:8px;';
      const sel = document.createElement('select');
      sel.className = 'pop-sel';
      sel.style.cssText = 'flex:1;min-height:44px;background:#0b101c;border:1px solid #22354c;color:#c8d4e0;border-radius:6px;padding:8px;';
      for (const s of free) {
        const o = document.createElement('option');
        o.value = s.id;
        o.textContent = (s.className || s.name || '飞船') + (s.stats ? '（战力 ' + fmtNum(s.stats.power || 30) + '）' : '');
        sel.appendChild(o);
      }
      const ab = btn('加入编队', 'btn-primary');
      ab.style.minHeight = '44px';
      ab.addEventListener('click', () => {
        const r = addShipToFleet(account, fleet.id, sel.value);
        if (!r.ok) { alert(r.reason); return; }
        redraw();
      });
      addBox.append(sel, ab);
      row.appendChild(addBox);
    }

    // 动态星际巡航雷达与深空异象 HUD
    if (fleet.mission) {
      const radarBox = document.createElement('div');
      radarBox.className = 'fleet-mission-radar';
      radarBox.style.cssText = 'padding:12px;background:radial-gradient(ellipse at bottom, #111e30 0%, #080c14 100%);border:1px solid #38bdf840;border-radius:8px;margin:10px 0;position:relative;overflow:hidden;';

      const radarHeader = document.createElement('div');
      radarHeader.style.cssText = 'display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;font-size:13px;';
      radarHeader.innerHTML = `
        <span style="font-weight:bold;color:#7cd7ff;display:flex;align-items:center;gap:6px;">
          <span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:#38bdf8;box-shadow:0 0 8px #38bdf8;"></span>
          ${fleetMissionLabel(fleet.mission)}
        </span>
        <span id="m-remain-${fleet.id}" style="color:#94a3b8;font-family:monospace;">计算中...</span>
      `;
      radarBox.appendChild(radarHeader);

      // 动态星际巡航轨道与旗舰进度条
      const track = document.createElement('div');
      track.style.cssText = 'height:28px;background:rgba(0,0,0,0.4);border:1px solid #1e293b;border-radius:14px;position:relative;margin-bottom:10px;overflow:hidden;display:flex;align-items:center;padding:0 8px;';
      track.innerHTML = `
        <div id="m-track-bar-${fleet.id}" style="position:absolute;left:0;top:0;bottom:0;width:0%;background:linear-gradient(90deg, rgba(56,189,248,0.1), rgba(56,189,248,0.35));border-right:2px solid #38bdf8;transition:width 0.5s ease;"></div>
        <div id="m-ship-icon-${fleet.id}" style="position:absolute;left:0%;transform:translateX(-50%);font-size:16px;z-index:2;filter:drop-shadow(0 0 6px #38bdf8);transition:left 0.5s ease;">🚀</div>
        <div style="position:absolute;right:8px;font-size:12px;z-index:1;color:#64748b;">🌌 巡航航道</div>
      `;
      radarBox.appendChild(track);

      // 实时遥测指标
      const fSpeed = fleetSpeedOf(account, fleet.id);
      const fPower = Math.round(fleetPowerOf(account, fleet));
      const telemetry = document.createElement('div');
      telemetry.style.cssText = 'display:flex;justify-content:space-between;font-size:11px;color:#94a3b8;background:rgba(255,255,255,0.03);padding:6px 10px;border-radius:4px;';
      telemetry.innerHTML = `
        <span>巡航航速：<b style="color:#f1f5f9;">${fmtNum(fSpeed)}</b> 千米/秒</span>
        <span>编队战备力：<b style="color:#9FE1CB;">${fmtNum(fPower)}</b> 点</span>
        <span>护航舰数：<b style="color:#7cd7ff;">${fleet.shipIds.length}</b> 艘</span>
      `;
      radarBox.appendChild(telemetry);

      // 深空异象交互雷达（若触发）
      if (fleet.mission.anomaly) {
        const ano = fleet.mission.anomaly;
        const anoDiv = document.createElement('div');
        if (!ano.resolved) {
          anoDiv.className = 'anomaly-alert';
          anoDiv.style.cssText = 'margin-top:10px;padding:10px 12px;border-radius:6px;background:rgba(251,191,36,0.08);border:1px solid #f59e0b;';
          anoDiv.innerHTML = `
            <div style="font-weight:bold;color:#fbbf24;display:flex;align-items:center;gap:6px;font-size:13px;margin-bottom:4px;">
              <span>${ano.icon}</span>
              <span>深空传感器捕获：${esc(ano.title)}</span>
            </div>
            <p style="color:#cbd5e1;font-size:12px;line-height:1.5;margin-bottom:8px;">${esc(ano.desc)}</p>
            <div style="display:flex;flex-wrap:wrap;gap:8px;" id="ano-choices-${fleet.id}">
              ${ano.choices.map((c) => `
                <button class="btn-ano-choice" data-cid="${c.id}" style="flex:1;min-width:130px;min-height:36px;padding:6px 10px;border-radius:4px;border:1px solid rgba(251,191,36,0.5);background:rgba(251,191,36,0.15);color:#fef3c7;font-size:12px;cursor:pointer;text-align:left;">
                  <div style="font-weight:bold;">${esc(c.text)}</div>
                  <div style="font-size:10px;color:#fde68a;">${esc(c.effect)}</div>
                </button>
              `).join('')}
            </div>
          `;
          setTimeout(() => {
            const cBox = anoDiv.querySelector(`#ano-choices-${fleet.id}`);
            if (cBox) {
              cBox.querySelectorAll('.btn-ano-choice').forEach((b) => {
                b.onclick = () => {
                  const cid = b.getAttribute('data-cid');
                  b.disabled = true;
                  const res = resolveFleetAnomaly(account, fleet.id, cid);
                  if (res.ok) {
                    playVictory();
                    alert(res.resultMsg);
                  }
                  redraw();
                };
              });
            }
          }, 40);
        } else {
          anoDiv.style.cssText = 'margin-top:8px;padding:8px 10px;border-radius:4px;background:rgba(16,185,129,0.08);border:1px solid #10b98150;font-size:12px;color:#6ee7b7;';
          anoDiv.innerHTML = `<span>${ano.icon}</span> <b>${esc(ano.title)}</b>：${esc(ano.resultMsg)}`;
        }
        radarBox.appendChild(anoDiv);
      }

      // 实时定时刷新雷达与倒计时
      const startedAt = fleet.mission.startedAt;
      const upd = () => {
        const cur = fleet.mission;
        if (!cur || cur.startedAt !== startedAt) { redraw(); return; }
        const remainEl = document.getElementById(`m-remain-${fleet.id}`);
        const barEl = document.getElementById(`m-track-bar-${fleet.id}`);
        const shipEl = document.getElementById(`m-ship-icon-${fleet.id}`);

        if (cur.type === 'defense') {
          if (remainEl) remainEl.textContent = '低空警戒驻留 · 防御 +' + defenseBonusOf(account);
          if (barEl) barEl.style.width = '100%';
          if (shipEl) shipEl.style.left = '50%';
          return;
        }

        const dur = Math.max(1, Number(cur.duration) || 1);
        const elp = Math.min(dur, Number(cur.elapsed) || 0);
        const pct = Math.min(100, Math.max(0, (elp / dur) * 100));
        const rem = Math.max(0, dur - elp);

        if (remainEl) remainEl.textContent = `剩余时间：${fmtTime(rem)} (${pct.toFixed(1)}%)`;
        if (barEl) barEl.style.width = `${pct}%`;
        if (shipEl) shipEl.style.left = `${Math.min(92, Math.max(2, pct))}%`;
      };
      updaters.push(upd);
      upd();

      const cx = btn('召回取消任务', 'btn-sm');
      cx.style.cssText = 'min-height:36px;margin-top:8px;';
      cx.addEventListener('click', () => {
        const r = cancelMission(account, fleet.id);
        if (!r.ok) { alert(r.reason); return; }
        redraw();
      });
      radarBox.appendChild(cx);

      row.appendChild(radarBox);
    }

    // 五项持续任务指令（v0.2.3：加分组标题，按钮带图标更易辨识）
    const cmdsLabel = el('div', 'fac-line2 muted', '星际任务指令：');
    cmdsLabel.style.cssText = 'font-size:11px;margin-top:10px;';
    row.appendChild(cmdsLabel);
    const cmdBox = el('div', 'fleet-cmds');
    cmdBox.style.cssText = 'display:flex;flex-wrap:wrap;gap:8px;margin-top:4px;';
    for (const cmd of ['explore', 'defense', 'patrol', 'transport', 'land']) {
      const b = btn(CMD_LABEL[cmd], cmd === 'explore' ? 'btn-primary' : '');
      b.style.cssText = 'min-height:44px;padding:6px 14px;border-radius:6px;';
      b.title = CMD_TIP[cmd];
      b.disabled = fleet.shipIds.length === 0 || !!fleet.mission;
      b.addEventListener('click', () => runCommand(fleet, cmd));
      cmdBox.appendChild(b);
    }
    row.appendChild(cmdBox);

    const del = btn('解散编队', 'btn-danger btn-sm');
    del.style.cssText = 'min-height:44px;margin-top:8px;border:1px solid #f0959550;background:rgba(240,149,149,0.1);color:#f09595;';
    del.addEventListener('click', () => {
      if (confirm(`确定解散编队「${fleet.nameCn}」吗？`)) {
        disbandFleet(account, fleet.id);
        redraw();
      }
    });
    row.appendChild(del);

    if (fleet.lastResult) {
      // rev15：结算结果从一行灰字改为「任务徽章 + 结果卡」，卡片左侧色条区分成败。
      const msg = String(fleet.lastResult.message || '');
      const bad = /失败|折损|损失|失利|受阻|损毁|沉/.test(msg);
      const accent = bad ? '#f09595' : '#9FE1CB';
      const lres = el('div');
      lres.style.cssText = 'margin-top:8px;padding:8px 10px 8px 12px;border-radius:6px;'
        + 'background:rgba(0,0,0,0.25);border:1px solid #1e293b;border-left:3px solid ' + accent + ';'
        + 'font-size:12px;line-height:1.6;color:#cbd5e1;';
      lres.innerHTML = '<span style="font-size:11px;padding:2px 8px;border-radius:10px;margin-right:6px;'
        + 'background:rgba(255,255,255,0.06);border:1px solid #33415580;color:' + accent + ';">'
        + (bad ? '⚠️ ' : '✅ ') + esc(CMD_LABEL[fleet.lastResult.cmd] || '任务') + '</span>'
        + esc(msg);
      row.appendChild(lres);
    }
    fSec.appendChild(row);
  }

  // 新建编队卡片
  const addCard = el('div', 'fleet-add');
  addCard.style.cssText = 'margin-top:10px;display:flex;gap:8px;';
  const nameInp = document.createElement('input');
  nameInp.type = 'text';
  nameInp.className = 'acc-new-input';
  nameInp.style.cssText = 'flex:1;min-height:44px;padding:8px 12px;background:#0b101c;border:1px solid #22354c;border-radius:6px;color:#c8d4e0;font-size:14px;';
  nameInp.placeholder = '输入新特遣舰队名称（如：第一开拓舰队）';
  const btnCreate = btn('组建新舰队', 'btn-primary');
  btnCreate.style.minHeight = '44px';
  btnCreate.addEventListener('click', () => {
    const r = createFleet(account, nameInp.value);
    if (!r.ok) { alert(r.reason); return; }
    redraw();
  });
  addCard.append(nameInp, btnCreate);
  fSec.appendChild(addCard);

  container.appendChild(fSec);

  // 3. 船载仓储管理
  container.appendChild(buildCargoPanel(account, inst));

  // 4. 殖民地管理
  const mSec = el('section', 'fac-group');
  mSec.appendChild(el('div', 'res-section-title', '星际主权与殖民地管辖'));
  const captured = Array.isArray(account.capturedPlanets) ? account.capturedPlanets : [];
  if (!captured.length) {
    mSec.appendChild(el('p', 'muted', '暂无直属殖民星球。可通过舰队「探索」发现并捕获行星。'));
  }
  for (const cap of captured) {
    const ci = getPlanetInstance(cap.code);
    if (!ci) continue;
    const row = el('div', 'fac-row');
    const happy = Number(ci.pop ? ci.pop.happiness : 0) || 0;
    const indep = Number(ci.independence) || 0;
    const mode = ci.isHome ? null : modeOf(ci);
    row.appendChild(el('div', 'fac-line1', cap.nameCn + '（' + cap.type + '）' + (ci.isHome ? ' · 执政母星' : '')));
    // rev15：「居民幸福度 0.82 · 独立倾向 0.03 · 管理模式：合作 · 已同化为领土」一行串字
    //   拆成「属性徽章 + 两条迷你进度条」，颜色直接对应危险度（独立倾向越高越红）。
    const chips = el('div');
    chips.style.cssText = 'display:flex;flex-wrap:wrap;gap:6px;margin:4px 0 6px;';
    chips.innerHTML = (mode
      ? '<span style="font-size:11px;padding:2px 8px;border-radius:10px;background:rgba(124,215,255,0.10);border:1px solid #7cd7ff33;color:#7cd7ff;">🏛️ ' + esc(mode.nameCn) + '</span>'
      : '<span style="font-size:11px;padding:2px 8px;border-radius:10px;background:rgba(255,255,255,0.05);border:1px solid #33415580;color:#94a3b8;">🏠 执政母星</span>')
      + (ci.territoryAssimilated
        ? '<span style="font-size:11px;padding:2px 8px;border-radius:10px;background:rgba(159,225,203,0.10);border:1px solid #9FE1CB40;color:#9FE1CB;">✅ 已同化为领土</span>'
        : '<span style="font-size:11px;padding:2px 8px;border-radius:10px;background:rgba(255,255,255,0.05);border:1px solid #33415580;color:#94a3b8;">🕓 尚未同化</span>');
    row.appendChild(chips);

    const bars = el('div');
    bars.style.cssText = 'display:flex;flex-wrap:wrap;gap:12px;';
    const miniBar = (label, val, max, color) => {
      const p = Math.max(0, Math.min(100, (val / max) * 100));
      return '<div style="flex:1 1 120px;min-width:110px;">'
        + '<div style="display:flex;justify-content:space-between;font-size:11px;color:#94a3b8;">'
        + '<span>' + label + '</span><b style="color:' + color + ';">' + val.toFixed(2) + '</b></div>'
        + '<div style="height:6px;border-radius:3px;background:#0f1720;overflow:hidden;margin-top:3px;">'
        + '<i style="display:block;height:100%;width:' + p.toFixed(1) + '%;background:' + color + ';"></i></div></div>';
    };
    bars.innerHTML = miniBar('😊 居民幸福度', happy, 1, happy >= 0.8 ? '#9FE1CB' : happy >= 0.5 ? '#ffc46b' : '#f09595')
      + miniBar('⚡ 独立倾向', indep, 1, indep >= 0.5 ? '#f09595' : indep >= 0.2 ? '#ffc46b' : '#64748b');
    row.appendChild(bars);
    mSec.appendChild(row);
  }
  container.appendChild(mSec);

  // 5. 商店星
  container.appendChild(buildShopSection(account, inst, openModal, redraw, { updaters }));

  startFleetHeartbeat(container, updaters);

  // 任务分发处理
  function runCommand(fleet, cmd) {
    if (cmd === 'land') {
      openLandDialog(fleet, redraw);
      return;
    }
    if (fleet.mission) {
      alert('编队任务执行中：' + fleetMissionLabel(fleet.mission));
      return;
    }
    if (cmd === 'transport') {
      openTransportDialog(fleet);
      return;
    }
    const r = startMission(account, fleet.id, cmd);
    if (!r.ok) { alert(r.reason || '任务发起失败'); return; }
    redraw();
  }

  function openTransportDialog(fleet) {
    // v0.2.2：恢复 R12 契约 —— 物资品类与目的地一律用下拉选择，不再手填文本。
    //   目的地 = 已占领星球（捕获列表）；货单候选 = 当前星球物品栏持有 > 0 的条目。
    const capList = (account.capturedPlanets || []).map((c) => c && c.code).filter(Boolean);
    const heldMats = [];
    try {
      const agg = new Map();
      for (const e of ((inst && inst.inventory) || [])) {
        if (!e || !e.mat) continue;
        const n = Number(e.owned) || 0;
        if (n > 0) agg.set(e.mat, (agg.get(e.mat) || 0) + n);
      }
      for (const [m, n] of agg) heldMats.push({ mat: m, owned: n });
    } catch (e) { /* 物品栏异常时退化为空列表 */ }
    heldMats.sort((a, b) => a.mat.localeCompare(b.mat, 'zh'));

    const form = el('div', 'transport-form');
    // rev15：说明由一段文字改为 3 枚图标要点（要点之间用竖线分隔，扫一眼即可理解流程）
    const infoP = el('div');
    infoP.style.cssText = 'display:flex;flex-wrap:wrap;gap:8px;margin:2px 0 12px;';
    infoP.innerHTML = ['🚚 由该编队直送', '📦 按物资品类装载', '🏠 抵达自动入库']
      .map((t) => '<span style="font-size:11px;padding:3px 10px;border-radius:10px;background:rgba(56,189,248,0.08);'
        + 'border:1px solid #38bdf833;color:#7cd7ff;">' + t + '</span>').join('');
    form.appendChild(infoP);

    // 目的地
    const tgtLabel = el('label', null, '🎯 目的地星球');
    tgtLabel.style.cssText = 'font-size:12px;color:#94a3b8;display:block;margin-bottom:4px;';
    const tgtSel = document.createElement('select');
    tgtSel.id = 'tp-target-code';
    tgtSel.style.cssText = 'width:100%;min-height:44px;background:#0b101c;border:1px solid #22354c;color:#c8d4e0;border-radius:6px;padding:8px 12px;font-size:14px;';
    for (const c of (capList.length ? capList : ['des'])) {
      const o = document.createElement('option');
      o.value = c;
      o.textContent = c;
      tgtSel.appendChild(o);
    }
    const tgtBox = el('div');
    tgtBox.style.cssText = 'margin-bottom:12px;';
    tgtBox.append(tgtLabel, tgtSel);
    if (!capList.length) {
      const warn = el('div', null, '尚无已占领殖民地，先去探索占领星球。');
      warn.style.cssText = 'font-size:11px;color:#f09595;margin-top:4px;';
      tgtBox.appendChild(warn);
    }

    // 物资品类（当前星球持有 > 0）
    const matLabel = el('label', null, '📦 物资品类（仅列出当前星球持有）');
    matLabel.style.cssText = 'font-size:12px;color:#94a3b8;display:block;margin-bottom:4px;';
    const matSel2 = document.createElement('select');
    matSel2.id = 'tp-mat-name';
    matSel2.style.cssText = 'width:100%;min-height:44px;background:#0b101c;border:1px solid #22354c;color:#c8d4e0;border-radius:6px;padding:8px 12px;font-size:14px;';
    for (const h of heldMats) {
      const o = document.createElement('option');
      o.value = h.mat;
      o.textContent = h.mat + '（持有 ' + fmtNum(h.owned) + '）';
      matSel2.appendChild(o);
    }
    if (!heldMats.length) {
      const o = document.createElement('option');
      o.value = '';
      o.textContent = '（当前星球没有持有物资）';
      matSel2.appendChild(o);
    }
    const matBox = el('div');
    matBox.style.cssText = 'margin-bottom:12px;';
    matBox.append(matLabel, matSel2);

    // 数量
    const qtyLabel = el('label', null, '🔢 运送数量');
    qtyLabel.style.cssText = 'font-size:12px;color:#94a3b8;display:block;margin-bottom:4px;';
    const qtyInput = document.createElement('input');
    qtyInput.type = 'number';
    qtyInput.id = 'tp-qty';
    qtyInput.min = '1';
    qtyInput.value = '50';
    qtyInput.style.cssText = 'width:100%;min-height:44px;box-sizing:border-box;background:#0b101c;border:1px solid #22354c;color:#c8d4e0;border-radius:6px;padding:8px 12px;font-size:14px;';
    const qtyBox = el('div');
    qtyBox.style.cssText = 'margin-bottom:12px;';
    qtyBox.append(qtyLabel, qtyInput);

    const confirmBtn = el('button', null, '下达启航指令');
    confirmBtn.id = 'btn-tp-confirm';
    confirmBtn.style.cssText = 'width:100%;min-height:44px;background:#7cd7ff;color:#050814;font-weight:bold;border:none;border-radius:6px;cursor:pointer;';

    form.append(tgtBox, matBox, qtyBox, confirmBtn);

    if (openModal) {
      openModal({ title: '发起舰队运输任务', body: form });
      setTimeout(() => {
        const btn = document.getElementById('btn-tp-confirm');
        if (btn) {
          btn.onclick = () => {
            const tgt = document.getElementById('tp-target-code').value;
            const mat = document.getElementById('tp-mat-name').value;
            const qty = parseInt(document.getElementById('tp-qty').value, 10) || 10;
            if (!mat) { alert('当前星球没有可运送的物资'); return; }
            const r = startMission(account, fleet.id, 'transport', tgt, { [mat]: qty });
            if (!r.ok) { alert(r.reason || '无法发起'); return; }
            if (closeModal) closeModal();
            redraw();
          };
        }
      }, 50);
    }
  }

  // ============================================================================
  // 登陆任务弹窗（v0.2.2）：选目标 + 选部队 → 发起登陆任务
  // ============================================================================
  function openLandDialog(fleet) {
    const targets = listLandTargets(account);
    const armies = embarkableArmies(account);
    if (!targets.length) { alert('暂无可用登陆目标'); return; }

    const form = el('div');
    form.style.cssText = 'color:#c8d4e0;font-size:13px;';

    const tgtLabel = el('label', null, '🎯 登陆目标');
    tgtLabel.style.cssText = 'display:block;margin-bottom:4px;color:#94a3b8;font-size:12px;';
    const tgtSel = document.createElement('select');
    tgtSel.id = 'land-target-sel';
    tgtSel.style.cssText = 'width:100%;min-height:44px;background:#0b101c;border:1px solid #22354c;color:#c8d4e0;border-radius:6px;padding:8px 12px;font-size:14px;';
    for (const t of targets) {
      const opt = document.createElement('option');
      opt.value = t.code;
      opt.textContent = t.nameCn + '（' + t.code + '）· ' + (t.owned ? '己方星球（换防）' : '未知区域（登陆战）');
      tgtSel.appendChild(opt);
    }

    // rev15：情报区由「一整段文字」改为图形化 ——
    //   上方 4 张指标卡（航程 / 单船燃料 / 守军规模 / 我方战力），
    //   下方战力对比条：守军预估区间画成色带、我方战力画成指针，胜算一眼可读；
    //   结论收成一枚徽章，不再堆在句尾。
    const intel = el('div');
    intel.style.cssText = 'margin:10px 0 12px;';
    const metrics = el('div');
    metrics.style.cssText = 'display:flex;flex-wrap:wrap;gap:8px;margin-bottom:8px;';
    const compare = el('div');
    compare.style.cssText = 'border:1px solid #22354c;border-radius:8px;background:rgba(0,0,0,0.3);padding:10px 12px;';
    const verdict = el('div');
    verdict.style.cssText = 'font-size:12px;margin-top:8px;line-height:1.6;';
    intel.append(metrics, compare, verdict);

    const armyLabel = el('label', null, '🪖 选择出征部队（' + armies.length + ' 支可用）');
    armyLabel.style.cssText = 'display:block;margin-bottom:6px;color:#94a3b8;font-size:12px;';
    const armyBox = el('div');
    armyBox.style.cssText = 'max-height:220px;overflow-y:auto;border:1px solid #22354c;border-radius:6px;padding:6px;background:rgba(0,0,0,0.25);';
    if (!armies.length) {
      armyBox.appendChild(el('div', null, '没有可出征的部队（其余部队可能已随其它编队出征）。'));
      armyBox.style.cssText += 'color:#64748b;padding:14px;text-align:center;';
    }
    const checks = [];
    armies.forEach((a, i) => {
      const lab = document.createElement('label');
      lab.style.cssText = 'display:flex;align-items:center;gap:8px;padding:8px 6px;min-height:40px;cursor:pointer;border-bottom:1px dashed #1a2940;';
      const cb = document.createElement('input');
      cb.type = 'checkbox';
      cb.value = a.id;
      cb.dataset.power = (a.stats && a.stats.power) || 0;
      const info = document.createElement('span');
      info.style.cssText = 'flex:1;font-size:12px;';
      info.innerHTML = esc(a.nameCn)
        + ' <span style="color:#9FE1CB;">战力 ' + fmtNum((a.stats && a.stats.power) || 0) + '</span>'
        + ' <span style="color:#64748b;">· 现驻 ' + esc(a.planetCode || account.homePlanetCode || 'syl') + '</span>';
      lab.append(cb, info);
      armyBox.appendChild(lab);
      checks.push(cb);
      cb.addEventListener('change', updateIntel);
    });

    const ourLine = el('div');
    const errLine = el('div');
    errLine.style.cssText = 'color:#ff6b81;font-size:12px;margin:8px 0;min-height:16px;';
    const confirmBtn = btn('下达登陆指令', 'btn-primary');
    confirmBtn.style.cssText = 'width:100%;min-height:44px;background:#7cd7ff;color:#050814;font-weight:bold;border:none;border-radius:6px;cursor:pointer;';

    function selectedArmyIds() {
      return checks.filter((c) => c.checked).map((c) => c.value);
    }
    function selectedPower() {
      return checks.reduce((s, c) => s + (c.checked ? (Number(c.dataset.power) || 0) : 0), 0);
    }
    // 指标卡（与舰队长文本改造同款视觉语言）
    function liCard(icon, label, value, color) {
      return '<div style="flex:1 1 92px;min-width:88px;background:rgba(0,0,0,0.32);border:1px solid rgba(255,255,255,0.08);'
        + 'border-radius:6px;padding:6px 8px;text-align:center;">'
        + '<div style="font-size:13px;font-weight:bold;color:' + color + ';">' + icon + ' ' + value + '</div>'
        + '<div style="font-size:10px;color:#94a3b8;margin-top:2px;">' + label + '</div></div>';
    }

    function updateIntel() {
      const t = targets.find((x) => x.code === tgtSel.value);
      if (!t) return;
      const v = fleetSpeedOf(account, fleet.id);
      const dur = Math.round(Math.min(9000, Math.max(150, MISSION_DISTANCE.land / Math.max(1, v))));
      const fuel = Math.round(MISSION_DISTANCE.land * EXPLORE_FUEL_PER_DIST);
      const our = selectedPower();
      const picked = checks.filter((c) => c.checked).length;

      if (t.owned) {
        metrics.innerHTML = liCard('⏱️', '航程耗时', fmtTime(dur), '#7cd7ff')
          + liCard('⛽', '单船燃料', fmtNum(fuel) + ' mol', '#ffc46b')
          + liCard('🪖', '出征部队', picked + ' 支', '#9FE1CB')
          + liCard('🛡️', '目标归属', '己方', '#9FE1CB');
        compare.innerHTML = '<div style="font-size:12px;color:#9FE1CB;line-height:1.6;">'
          + '<b>换防任务</b>：目标为己方星球，抵达后全军换防驻扎，不触发战斗。</div>';
        verdict.innerHTML = '';
        return;
      }

      const def = findPlanetDef(account, t.code);
      const est = estimateGarrisonOf(def);
      metrics.innerHTML = liCard('⏱️', '航程耗时', fmtTime(dur), '#7cd7ff')
        + liCard('⛽', '单船燃料', fmtNum(fuel) + ' mol', '#ffc46b')
        + liCard('🛡️', '守军规模', fmtNum(est.min) + ' ~ ' + fmtNum(est.max), '#ffc46b')
        + liCard('⚔️', '我方战力', fmtNum(our), our > 0 ? '#9FE1CB' : '#64748b');

      // 战力对比条：色带 = 守军预估区间，竖线 = 我方战力
      const scale = Math.max(1, our, est.max);
      const minPct = Math.max(0, Math.min(100, (est.min / scale) * 100));
      const maxPct = Math.max(minPct, Math.min(100, (est.max / scale) * 100));
      const ourPct = Math.max(0, Math.min(100, (our / scale) * 100));
      compare.innerHTML =
        '<div style="font-size:11px;color:#94a3b8;margin-bottom:6px;">战力对比 · <span style="color:#fbbf24;">色带</span>'
        + '为守军预估区间，<span style="color:#9FE1CB;">竖线</span>为我方登陆部队战力</div>'
        + '<div style="position:relative;height:20px;border-radius:10px;background:rgba(255,255,255,0.05);border:1px solid #1e293b;">'
        + '<div style="position:absolute;top:0;bottom:0;left:' + minPct.toFixed(1) + '%;width:' + Math.max(1.5, maxPct - minPct).toFixed(1)
        + '%;background:linear-gradient(90deg, rgba(251,191,36,0.30), rgba(240,149,149,0.45));border-left:1px solid #fbbf24;border-right:1px solid #f09595;"></div>'
        + '<div style="position:absolute;top:-3px;bottom:-3px;left:' + ourPct.toFixed(1)
        + '%;width:3px;background:#9FE1CB;box-shadow:0 0 6px #9FE1CB;transform:translateX(-1.5px);"></div>'
        + '</div>'
        + '<div style="display:flex;justify-content:space-between;font-size:10px;color:#64748b;margin-top:4px;">'
        + '<span>0</span><span>守军 ' + fmtNum(est.min) + ' ~ ' + fmtNum(est.max) + '</span><span>' + fmtNum(scale) + '</span></div>';

      const vd = (our > 0 && our >= est.max) ? ['#9FE1CB', '✅ 胜算极高', '我方战力已达守军上限之上']
        : (our > 0 && our >= est.min) ? ['#ffc46b', '⚠️ 胜负难料', '我方战力落在守军预估区间内']
          : our > 0 ? ['#f09595', '⛔ 风险极高', '我方战力低于守军下限']
            : ['#64748b', '— 待编队', '请勾选出征部队以评估胜算'];
      verdict.innerHTML = '<span style="padding:3px 10px;border-radius:10px;border:1px solid ' + vd[0] + '66;color:' + vd[0] + ';white-space:nowrap;">' + vd[1] + '</span>'
        + '<span style="color:#94a3b8;margin-left:8px;">' + vd[2] + '（守军规模随星球资源丰度上升）</span>';
    }
    tgtSel.addEventListener('change', updateIntel);
    updateIntel();

    confirmBtn.addEventListener('click', () => {
      const ids = selectedArmyIds();
      if (!ids.length) { errLine.textContent = '请至少选择一支部队出征。'; return; }
      const r = startMission(account, fleet.id, 'land', tgtSel.value, { armyIds: ids });
      if (!r.ok) { errLine.textContent = r.reason || '无法发起登陆任务'; return; }
      if (closeModal) closeModal();
      redraw();
    });

    form.append(tgtLabel, tgtSel, intel, armyLabel, armyBox, ourLine, errLine, confirmBtn);
    if (openModal) openModal({ title: '发起登陆任务：' + fleet.nameCn, body: form });
  }
}

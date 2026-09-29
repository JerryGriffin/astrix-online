// 舰队战备与战术指挥中心（Astrix v0.2.0）
// 提供编队战备管理、实时战术交互交战视窗、船载物流、殖民地政令与星港贸易。
// 纯原生 ES 模块，深空玻璃拟态风格，移动端与 PC 端自适应（点击区 >= 44px）。

import { fmtNum, fmtRate, fmtTime } from '../core/format.js?v=21.3';
import {
  listFleets, createFleet, disbandFleet, addShipToFleet, removeShipFromFleet,
  fleetSpeedOf, fleetPowerOf, executeCommand,
  startMission, cancelMission, fleetMissionLabel, defenseBonusOf,
  shipCargoOf, loadShipCargo, unloadShipCargo,
  shipCargoMassOf, shipCargoCellsOf, shipCargoCellsMax, effectiveSpeedOf,
  resolveFleetAnomaly,
} from '../core/fleet.js?v=21.3';
import { equipmentList } from '../core/shipyard.js?v=21.3';
import {
  MANAGEMENT_MODES, MANAGEMENT_BY_ID, modeOf, setManagement,
  TERRITORY_ASSIMILATE_SEC, TERRITORY_HAPPY_THRESHOLD,
} from '../core/planetgen.js?v=21.3';
import {
  SHOP_PLANET, shopPrices, sell, pendingOrders, deliverOrder, ascoinBalance,
  suggestPriceOf, listForSale, marketListings, cancelListing, buyListing, priceOf, shopStateOf,
  MARKET_FEE,
} from '../core/shop.js?v=21.3';
import { getPlanetInstance, currentAccount, ownedOf } from '../core/state.js?v=21.3';
import { openBattleView } from './combat.js?v=21.3';
import { detectShipRole, SHIP_ROLES } from '../core/combat.js?v=21.3';
import { isSoundEnabled, toggleSound, playPing, playVictory, playWarp, playExplosion } from '../core/sound.js?v=21.3';

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
  explore: '探索', defense: '低空防卫', patrol: '巡航', transport: '运输', land: '登陆',
};
const CMD_TIP = {
  explore: '派出舰队探索未知星域，任务完成后结算：大概率发现新星球，也可能发生空间遭遇战',
  defense: '舰队驻留母星空域执行低空防卫，增加行星要塞防御力；手动取消任务才结束',
  patrol: '派出舰队巡航，任务期间可能拦截敌对侦察舰并触发实时战术交火',
  transport: '需编队配属运输船；把物资运到目的地星球，抵达后自动卸货',
  land: '军队系统已开放，可在军队面板进行成建制整编与星球登陆驻防',
};

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
    const head = el('div', 'fac-line1');
    head.innerHTML = `<b>${esc(s.name || s.className || '飞船')}</b> <span class="fac-mark muted">已载货物: ${cargoKeys.length ? cargoKeys.map((k) => `${k} ×${cargo[k]}`).join(', ') : '空'}</span>`;
    row.appendChild(head);
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

  const summary = document.createElement('div');
  summary.className = 'glass fleet-page-root';
  summary.style.cssText = 'padding:16px;border-radius:8px;margin-bottom:14px;border:1px solid rgba(124,215,255,0.25);display:flex;flex-wrap:wrap;gap:14px;justify-content:space-between;align-items:center;';

  summary.innerHTML = `
    <div>
      <div style="font-size:17px;font-weight:bold;color:#7cd7ff;display:flex;align-items:center;gap:8px;">
        <span>🚀 太空舰队与战术指挥中心</span>
      </div>
      <div style="font-size:12px;color:#94a3b8;margin-top:4px;line-height:1.5;">
        总编队：<b style="color:#f1f5f9;">${fleets.length}</b> 支 · 现役舰船：<b style="color:#9FE1CB;">${totalShips}</b> 艘 · 编队总战力：<b style="color:#7cd7ff;">${fmtNum(Math.round(totalFleetPower))}</b>
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
    const div = document.createElement('div');
    div.innerHTML = `
      <p style="color:#94a3b8;font-size:13px;line-height:1.5;margin-bottom:14px;">
        指挥部实时全息推演系统。请选择模拟假想敌作战方案，实战演练舰种配合、手动点选集火与 EMP 磁暴指令：
      </p>
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
          <div style="font-size:12px;color:#94a3b8;margin-top:2px;">假想敌：1 艘重装战列舰 + 1 艘空天母舰 + 2 艘护卫舰 · 检验 EMP 磁暴与跳帮强袭</div>
        </button>
      </div>
    `;

    openModal({ title: '选择战术交火推演场景', body: div });

    setTimeout(() => {
      const b1 = document.getElementById('bt-scen-1');
      const b2 = document.getElementById('bt-scen-2');
      const b3 = document.getElementById('bt-scen-3');

      if (b1) {
        b1.onclick = () => {
          closeModal();
          openBattleView({ openModal, closeModal, onBattleEnd: () => redraw() }, {
            title: '深空哨戒巡逻遭遇战',
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
  fSec.appendChild(el('p', 'muted', '管理各舰队舰艇配属与星际任务（探索、防卫、巡航、运输）。点击编队右侧「实时对战」可直接进入交互指挥视窗。'));

  if (!fleets.length) {
    fSec.appendChild(el('p', 'muted', '暂无组建编队。请在下方输入名称新建编队。'));
  }

  for (const fleet of fleets) {
    const row = el('div', 'fac-row');
    const speed = fleetSpeedOf(account, fleet.id);
    const power = Math.round(fleetPowerOf(account, fleet));

    const head = el('div', 'fac-line1');
    head.style.cssText = 'display:flex;justify-content:space-between;align-items:center;margin-bottom:6px;';
    head.innerHTML = `
      <div>
        <span class="fac-title" style="font-size:15px;color:#f1f5f9;">${esc(fleet.nameCn)}</span>
        <span class="fac-mark muted" style="margin-left:8px;">${fleet.shipIds.length} 艘 · 航速 ${fmtNum(speed)} · 战力 <b style="color:#9FE1CB">${fmtNum(power)}</b></span>
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
    if (!fleet.shipIds.length) shipsBox.textContent = '（空编队，请点击下方加入在泊战舰）';
    row.appendChild(shipsBox);

    for (const sid of fleet.shipIds) {
      const s = (account.ships || []).find((x) => x && x.id === sid);
      const roleId = detectShipRole(s || {});
      const roleMeta = SHIP_ROLES[roleId] || {};
      const line = el('div', 'fleet-ship');
      line.style.cssText = 'display:flex;justify-content:space-between;align-items:center;padding:4px 8px;background:rgba(0,0,0,0.2);border-radius:4px;margin-bottom:4px;';
      const label = document.createElement('span');
      label.innerHTML = `<span style="margin-right:6px;">${roleMeta.icon || '🚀'}</span><span style="font-weight:500;">${esc(s ? (s.className || s.name || '飞船') : sid)}</span> <span style="font-size:11px;color:#7cd7ff;margin-left:4px;">[${roleMeta.name || '战舰'}]</span>`;
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
        <span>巡航航速：<b style="color:#f1f5f9;">${fmtNum(fSpeed)}</b> km/s</span>
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

    // 五项持续任务指令
    const cmdBox = el('div', 'fleet-cmds');
    cmdBox.style.cssText = 'display:flex;flex-wrap:wrap;gap:8px;margin-top:8px;';
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
      const lres = el('div', 'fac-line4 muted', '上次作战：' + (CMD_LABEL[fleet.lastResult.cmd] || '任务') + ' · ' + fleet.lastResult.message);
      lres.style.marginTop = '6px';
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
    row.appendChild(el('div', 'fac-line2 muted', '居民幸福度 ' + happy.toFixed(2) + ' · 独立倾向 ' + indep.toFixed(2) + (mode ? ' · 管理模式：' + mode.nameCn : '') + (ci.territoryAssimilated ? ' · 已同化为领土' : '')));
    mSec.appendChild(row);
  }
  container.appendChild(mSec);

  // 5. 商店星
  container.appendChild(buildShopSection(account, inst, openModal, redraw, { updaters }));

  startFleetHeartbeat(container, updaters);

  // 任务分发处理
  function runCommand(fleet, cmd) {
    if (cmd === 'land') {
      const res = executeCommand(account, fleet.id, 'land', { planetCode });
      if (!res.ok) alert(res.message || res.reason || '指令失败');
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
    const capList = (account.capturedPlanets || []).map((c) => c.code);
    const form = el('div', 'transport-form');
    form.innerHTML = `
      <p style="color:#94a3b8;font-size:13px;line-height:1.5;">指派编队运送母星物资直达目标殖民地仓储。</p>
      <div style="margin-bottom:12px;">
        <label style="font-size:12px;color:#94a3b8;display:block;margin-bottom:4px;">目的地：</label>
        <input type="text" id="tp-target-code" value="${capList[0] || 'des'}" style="width:100%;min-height:44px;background:#0b101c;border:1px solid #22354c;color:#c8d4e0;border-radius:6px;padding:8px 12px;font-size:14px;">
      </div>
      <div style="margin-bottom:12px;">
        <label style="font-size:12px;color:#94a3b8;display:block;margin-bottom:4px;">物资品类：</label>
        <input type="text" id="tp-mat-name" value="铁" style="width:100%;min-height:44px;background:#0b101c;border:1px solid #22354c;color:#c8d4e0;border-radius:6px;padding:8px 12px;font-size:14px;">
      </div>
      <div style="margin-bottom:12px;">
        <label style="font-size:12px;color:#94a3b8;display:block;margin-bottom:4px;">运送数量：</label>
        <input type="number" id="tp-qty" value="50" min="1" max="10000" style="width:100%;min-height:44px;background:#0b101c;border:1px solid #22354c;color:#c8d4e0;border-radius:6px;padding:8px 12px;font-size:14px;">
      </div>
      <button id="btn-tp-confirm" style="width:100%;min-height:44px;background:#7cd7ff;color:#050814;font-weight:bold;border:none;border-radius:6px;cursor:pointer;">下达启航指令</button>
    `;

    if (openModal) {
      openModal({ title: '发起舰队运输任务', body: form });
      setTimeout(() => {
        const btn = document.getElementById('btn-tp-confirm');
        if (btn) {
          btn.onclick = () => {
            const tgt = document.getElementById('tp-target-code').value;
            const mat = document.getElementById('tp-mat-name').value;
            const qty = parseInt(document.getElementById('tp-qty').value, 10) || 10;
            const r = startMission(account, fleet.id, 'transport', tgt, { [mat]: qty });
            if (!r.ok) { alert(r.reason || '无法发起'); return; }
            if (closeModal) closeModal();
            redraw();
          };
        }
      }, 50);
    }
  }
}

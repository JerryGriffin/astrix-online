// 星际大厅与在线星图界面（Astrix v0.2.0）
// 纯原生 ES 模块，深空玻璃拟态风格，移动端与 PC 端自适应（点击区 >= 44px）

import { currentAccount, getPlanetInstance, ownedOf } from '../core/state.js?v=21.3';
import {
  ensureCloudProfile, bindEmail, getShieldStatus, fetchGalaxyRegistry,
  getInbox, markMessageRead, markAllMessagesRead, unreadCount,
  sendGalaxyRaid, sendGalaxyTrade, evaluateFleetPower,
  syncOnlineServer, fetchRemoteGalaxyRegistry, fetchOnlineChatMessages, sendOnlineChatMessage,
  fetchOnlineMarketListings, buyOnlineMarketListing, createOnlineMarketListing
} from '../core/cloud.js?v=21.3';
import { listFleets } from '../core/fleet.js?v=21.3';
import { fmtNum } from '../core/format.js?v=21.3';
import { openBattleView } from './combat.js?v=21.3';
import { playWarp, playPing, playVictory } from '../core/sound.js?v=21.3';

function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
}

export function renderGalaxy(root, ctx) {
  const { openModal, closeModal, onBack } = ctx;
  const acc = currentAccount();
  if (!acc) {
    root.innerHTML = '<div class="glass" style="padding:24px;text-align:center;">请先载入或创建指挥官存档。</div>';
    return;
  }

  const profile = ensureCloudProfile(acc);
  let searchQuery = '';
  let selectedFaction = 'all';

  function refresh() {
    renderView();
  }

  function renderView() {
    root.innerHTML = '';
    const container = document.createElement('div');
    container.className = 'galaxy-view';
    container.style.cssText = 'padding:16px;max-width:960px;margin:0 auto;color:#c8d4e0;';

    // 1. 顶部状态栏（身份、保护盾、信箱）
    const header = document.createElement('div');
    header.className = 'glass';
    header.style.cssText = 'padding:16px;margin-bottom:16px;border-radius:10px;display:flex;flex-wrap:wrap;gap:12px;justify-content:space-between;align-items:center;';

    const idBox = document.createElement('div');
    idBox.innerHTML = `
      <div style="font-size:16px;font-weight:bold;color:#7cd7ff;display:flex;align-items:center;gap:8px;">
        <span>🛰️ ${escapeHtml(profile.callsign)}</span>
        <span style="font-size:12px;color:#7d8a97;background:rgba(255,255,255,0.06);padding:2px 6px;border-radius:4px;">${escapeHtml(profile.commanderId)}</span>
      </div>
      <div style="font-size:12px;color:#94a3b8;margin-top:4px;">
        邮箱：${profile.email ? escapeHtml(profile.email) : '<span style="color:#ffc46b">未绑定（支持跨端同步）</span>'}
      </div>
    `;

    const btnGroup = document.createElement('div');
    btnGroup.style.cssText = 'display:flex;gap:8px;flex-wrap:wrap;align-items:center;';

    // 绑定邮箱按钮
    const btnEmail = document.createElement('button');
    btnEmail.className = 'btn-action';
    btnEmail.style.cssText = 'padding:6px 12px;min-height:44px;border:1px solid #345;border-radius:6px;background:rgba(124,215,255,0.08);color:#7cd7ff;cursor:pointer;';
    btnEmail.textContent = profile.email ? '更换邮箱' : '绑定邮箱';
    btnEmail.onclick = () => openEmailModal();
    btnGroup.appendChild(btnEmail);

    // 保护盾状态
    const shield = getShieldStatus(acc);
    const shieldTag = document.createElement('div');
    shieldTag.style.cssText = `padding:6px 12px;min-height:44px;border-radius:6px;display:flex;align-items:center;font-size:13px;border:1px solid ${shield.active ? '#ffc46b' : '#345'};background:${shield.active ? 'rgba(255,196,107,0.1)' : 'rgba(255,255,255,0.04)'};color:${shield.active ? '#ffc46b' : '#94a3b8'};`;
    shieldTag.innerHTML = `🛡️ ${shield.text}`;
    btnGroup.appendChild(shieldTag);

    // 信箱入口（带未读徽标）
    const unread = unreadCount(acc);
    const btnInbox = document.createElement('button');
    btnInbox.className = 'btn-action';
    btnInbox.style.cssText = 'padding:6px 14px;min-height:44px;border:1px solid #345;border-radius:6px;background:rgba(124,215,255,0.12);color:#c8d4e0;cursor:pointer;position:relative;';
    btnInbox.innerHTML = `📬 星际信箱 ${unread > 0 ? `<span style="background:#ff6b81;color:#fff;font-size:11px;padding:2px 6px;border-radius:10px;margin-left:4px;">${unread}</span>` : ''}`;
    btnInbox.onclick = () => openInboxModal();
    btnGroup.appendChild(btnInbox);

    // 公频通讯入口
    const btnChat = document.createElement('button');
    btnChat.className = 'btn-action';
    btnChat.style.cssText = 'padding:6px 14px;min-height:44px;border:1px solid #38bdf850;border-radius:6px;background:rgba(56,189,248,0.15);color:#7cd7ff;cursor:pointer;';
    btnChat.innerHTML = '💬 星区广播通信';
    btnChat.onclick = () => openChatModal();
    btnGroup.appendChild(btnChat);

    // 全星区在线集市入口
    const btnMarket = document.createElement('button');
    btnMarket.className = 'btn-action';
    btnMarket.style.cssText = 'padding:6px 14px;min-height:44px;border:1px solid #10b98150;border-radius:6px;background:rgba(16,185,129,0.15);color:#6ee7b7;cursor:pointer;';
    btnMarket.innerHTML = '🌐 全星区集市';
    btnMarket.onclick = () => openMarketModal();
    btnGroup.appendChild(btnMarket);

    header.appendChild(idBox);
    header.appendChild(btnGroup);
    container.appendChild(header);

    // 2. 搜索与过滤工具栏
    const filterBar = document.createElement('div');
    filterBar.style.cssText = 'margin-bottom:16px;display:flex;flex-wrap:wrap;gap:10px;align-items:center;';

    const searchInput = document.createElement('input');
    searchInput.type = 'text';
    searchInput.placeholder = '定向搜索星系名称 / 指挥官 / 编号…';
    searchInput.value = searchQuery;
    searchInput.style.cssText = 'flex:1;min-width:240px;min-height:44px;padding:8px 12px;background:#0b101c;border:1px solid #22354c;border-radius:6px;color:#c8d4e0;font-size:14px;';
    searchInput.oninput = (e) => {
      searchQuery = e.target.value;
      renderCards(cardContainer);
    };
    filterBar.appendChild(searchInput);

    container.appendChild(filterBar);

    // 3. 星球列表网格
    const cardContainer = document.createElement('div');
    cardContainer.style.cssText = 'display:grid;grid-template-columns:repeat(auto-fill, minmax(290px, 1fr));gap:14px;';
    renderCards(cardContainer);
    container.appendChild(cardContainer);

    root.appendChild(container);
  }

  function renderCards(grid) {
    grid.innerHTML = '';
    const systems = fetchGalaxyRegistry(acc, searchQuery);

    if (systems.length === 0) {
      grid.innerHTML = '<div style="grid-column:1/-1;padding:32px;text-align:center;color:#64748b;">未搜索到符合条件的星系。</div>';
      return;
    }

    for (const sys of systems) {
      const card = document.createElement('div');
      card.className = 'glass';
      card.style.cssText = 'padding:14px;border-radius:8px;display:flex;flex-direction:column;justify-content:space-between;gap:10px;border:1px solid rgba(124,215,255,0.15);';

      // 保护盾判定
      const hasShield = sys.shieldUntil && sys.shieldUntil > Date.now();

      const top = document.createElement('div');
      top.innerHTML = `
        <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:6px;">
          <div>
            <span style="font-weight:bold;font-size:15px;color:#f1f5f9;">${escapeHtml(sys.planetNameCn)}</span>
            <span style="font-size:11px;color:#7d8a97;margin-left:4px;">${escapeHtml(sys.planetCode)}</span>
          </div>
          <span style="font-size:11px;padding:2px 6px;border-radius:4px;background:rgba(255,255,255,0.06);color:${sys.factionColor || '#7cd7ff'};border:1px solid ${sys.factionColor || '#7cd7ff'}40;">
            ${escapeHtml(sys.faction)}
          </span>
        </div>
        <div style="font-size:12px;color:#94a3b8;line-height:1.5;">
          <div>指挥官：<b>${escapeHtml(sys.callsign)}</b> ${sys.isNpc ? '<span style="color:#7d8a97">(NPC)</span>' : '<span style="color:#7cd7ff">(玩家)</span>'}</div>
          <div>距离：${sys.distanceLy === 0 ? '<span style="color:#9FE1CB">母星主权区</span>' : `${sys.distanceLy} 光年`} · 人口：${fmtNum(sys.population)}</div>
          <div>要塞战力：<b style="color:${sys.defensePower > 2500 ? '#f09595' : '#9FE1CB'}">${fmtNum(sys.defensePower)}</b></div>
        </div>
        ${hasShield ? '<div style="margin-top:6px;font-size:11px;color:#ffc46b;background:rgba(255,196,107,0.1);padding:3px 6px;border-radius:4px;">🛡️ 免战护盾保护中</div>' : ''}
        <div style="margin-top:6px;font-size:12px;color:#cbd5e1;background:rgba(0,0,0,0.25);padding:6px;border-radius:4px;line-height:1.4;">
          ${escapeHtml(sys.intel || '暂无详细战略简报。')}
        </div>
      `;

      // 特产在售标签
      const goodsBox = document.createElement('div');
      goodsBox.style.cssText = 'margin-top:4px;font-size:12px;';
      if (sys.goods && sys.goods.length > 0) {
        goodsBox.innerHTML = '<span style="color:#64748b;">特产：</span>' + sys.goods.map((g) => (
          `<span style="display:inline-block;background:rgba(124,215,255,0.08);color:#93c5fd;padding:2px 5px;border-radius:3px;margin:2px 4px 2px 0;">${escapeHtml(g.nameCn || g.mat)} · ${g.priceAscoin}₳</span>`
        )).join('');
      }
      top.appendChild(goodsBox);

      // 底部操作按钮
      const actions = document.createElement('div');
      actions.style.cssText = 'display:flex;gap:8px;margin-top:8px;';

      if (sys.commanderId === profile.commanderId) {
        actions.innerHTML = '<div style="flex:1;text-align:center;padding:8px;color:#64748b;font-size:12px;background:rgba(255,255,255,0.03);border-radius:4px;">自方主权基地</div>';
      } else {
        const btnTrade = document.createElement('button');
        btnTrade.className = 'btn-action';
        btnTrade.style.cssText = 'flex:1;min-height:44px;background:rgba(159,225,203,0.12);border:1px solid #9FE1CB40;color:#9FE1CB;border-radius:6px;cursor:pointer;font-size:13px;font-weight:600;';
        btnTrade.textContent = '🤝 贸易交割';
        btnTrade.onclick = () => openTradeModal(sys);

        const btnRaid = document.createElement('button');
        btnRaid.className = 'btn-action';
        btnRaid.style.cssText = `flex:1;min-height:44px;background:${hasShield ? 'rgba(255,255,255,0.05)' : 'rgba(240,149,149,0.12)'};border:1px solid ${hasShield ? '#475569' : '#f0959540'};color:${hasShield ? '#64748b' : '#f09595'};border-radius:6px;cursor:${hasShield ? 'not-allowed' : 'pointer'};font-size:13px;font-weight:600;`;
        btnRaid.textContent = '⚔️ 远征进攻';
        btnRaid.disabled = !!hasShield;
        btnRaid.title = hasShield ? '目标处于免战护盾中' : '派遣舰队突防要塞并掠夺战利品';
        btnRaid.onclick = () => openRaidModal(sys);

        actions.appendChild(btnTrade);
        actions.appendChild(btnRaid);
      }

      card.appendChild(top);
      card.appendChild(actions);
      grid.appendChild(card);
    }
  }

  // ==========================================================================
  // 弹窗实现：绑定邮箱、信箱、贸易、远征
  // ==========================================================================

  function openEmailModal() {
    const div = document.createElement('div');
    div.innerHTML = `
      <p style="color:#94a3b8;font-size:13px;line-height:1.6;margin-bottom:12px;">
        绑定邮箱后，指挥官身份凭据将与云端关联，便于多端同步与跨设备漫游。
      </p>
      <input type="email" id="cloud-email-input" placeholder="commander@domain.com"
             value="${escapeHtml(profile.email || '')}"
             style="width:100%;min-height:44px;box-sizing:border-box;background:#0b101c;border:1px solid #22354c;border-radius:6px;padding:8px 12px;color:#c8d4e0;font-size:14px;margin-bottom:12px;">
      <div id="email-err" style="color:#ff6b81;font-size:12px;margin-bottom:10px;"></div>
      <button id="btn-save-email" style="width:100%;min-height:44px;background:#7cd7ff;color:#0b101c;font-weight:bold;border:none;border-radius:6px;cursor:pointer;">确认绑定</button>
    `;

    openModal({ title: '指挥官云档案绑定', body: div });

    setTimeout(() => {
      const btn = document.getElementById('btn-save-email');
      const inp = document.getElementById('cloud-email-input');
      const err = document.getElementById('email-err');
      if (btn && inp) {
        btn.onclick = () => {
          const res = bindEmail(acc, inp.value);
          if (!res.ok) {
            err.textContent = res.reason;
          } else {
            closeModal();
            refresh();
          }
        };
      }
    }, 50);
  }

  function openInboxModal() {
    const list = getInbox(acc);
    const div = document.createElement('div');
    div.style.cssText = 'max-height:420px;overflow-y:auto;';

    if (list.length === 0) {
      div.innerHTML = '<div style="padding:24px;text-align:center;color:#64748b;">星际信箱空空如也，暂无最新战报或回执。</div>';
    } else {
      const tool = document.createElement('div');
      tool.style.cssText = 'display:flex;justify-content:flex-end;margin-bottom:10px;';
      const markAll = document.createElement('button');
      markAll.style.cssText = 'background:none;border:none;color:#7cd7ff;font-size:12px;cursor:pointer;padding:4px 8px;';
      markAll.textContent = '全部标为已读';
      markAll.onclick = () => {
        markAllMessagesRead(acc);
        openInboxModal();
        refresh();
      };
      tool.appendChild(markAll);
      div.appendChild(tool);

      for (const m of list) {
        const item = document.createElement('div');
        item.style.cssText = `padding:10px;margin-bottom:8px;border-radius:6px;border:1px solid #22354c;background:${m.read ? 'rgba(255,255,255,0.02)' : 'rgba(124,215,255,0.06)'};`;
        const timeStr = new Date(m.at).toLocaleTimeString();
        item.innerHTML = `
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:4px;">
            <span style="font-weight:bold;color:${m.type.includes('win') ? '#9FE1CB' : m.type.includes('loss') ? '#f09595' : '#7cd7ff'}">${escapeHtml(m.title)}</span>
            <span style="font-size:11px;color:#64748b;">${timeStr}</span>
          </div>
          <div style="font-size:12px;color:#c8d4e0;line-height:1.4;margin-bottom:4px;">${escapeHtml(m.body)}</div>
          ${m.details ? `<div style="font-size:11px;color:#94a3b8;white-space:pre-wrap;background:rgba(0,0,0,0.3);padding:6px;border-radius:4px;">${escapeHtml(m.details)}</div>` : ''}
        `;
        div.appendChild(item);
      }
    }

    openModal({ title: '星际信箱与回执', body: div });
  }

  function openTradeModal(sys) {
    const goods = sys.goods || [];
    if (goods.length === 0) {
      alert('该星球暂无挂售货物。');
      return;
    }

    const div = document.createElement('div');
    div.innerHTML = `
      <p style="color:#94a3b8;font-size:13px;line-height:1.5;margin-bottom:12px;">
        从「${escapeHtml(sys.planetNameCn)}」直采特产，交割后由星际物流直接运抵母星物品栏。
      </p>
      <div style="margin-bottom:12px;">
        <label style="font-size:12px;color:#94a3b8;display:block;margin-bottom:4px;">选择采购品类：</label>
        <select id="trade-mat-sel" style="width:100%;min-height:44px;background:#0b101c;border:1px solid #22354c;color:#c8d4e0;border-radius:6px;padding:8px;">
          ${goods.map((g) => `<option value="${escapeHtml(g.mat)}">${escapeHtml(g.nameCn || g.mat)}（单价 ${g.priceAscoin}₳，库存 ${fmtNum(g.stock)}）</option>`).join('')}
        </select>
      </div>
      <div style="margin-bottom:12px;">
        <label style="font-size:12px;color:#94a3b8;display:block;margin-bottom:4px;">采购数量：</label>
        <input type="number" id="trade-qty-inp" min="1" max="10000" value="50"
               style="width:100%;min-height:44px;box-sizing:border-box;background:#0b101c;border:1px solid #22354c;color:#c8d4e0;border-radius:6px;padding:8px 12px;font-size:14px;">
      </div>
      <div id="trade-summary" style="font-size:12px;color:#7cd7ff;margin-bottom:12px;"></div>
      <div id="trade-err" style="color:#ff6b81;font-size:12px;margin-bottom:10px;"></div>
      <button id="btn-confirm-trade" style="width:100%;min-height:44px;background:#9FE1CB;color:#0b101c;font-weight:bold;border:none;border-radius:6px;cursor:pointer;">确认交割</button>
    `;

    openModal({ title: `与 ${sys.planetNameCn} 贸易交割`, body: div });

    setTimeout(() => {
      const sel = document.getElementById('trade-mat-sel');
      const inp = document.getElementById('trade-qty-inp');
      const sum = document.getElementById('trade-summary');
      const err = document.getElementById('trade-err');
      const btn = document.getElementById('btn-confirm-trade');

      function updateSum() {
        const mat = sel.value;
        const g = goods.find((x) => x.mat === mat);
        const qty = parseInt(inp.value, 10) || 0;
        const cost = (g ? g.priceAscoin : 0) * qty;
        const curAscoin = Math.floor(Number(acc.ascoin) || 0);
        sum.innerHTML = `交割总额：<b>${cost}</b> Ascoin（当前持有 <b>${curAscoin}</b> ₳ / 折合 <b>${goldCost}</b> 纯金）`;
      }
      sel.onchange = updateSum;
      inp.oninput = updateSum;
      updateSum();

      btn.onclick = () => {
        const mat = sel.value;
        const qty = parseInt(inp.value, 10) || 0;
        if (qty <= 0) {
          err.textContent = '采购数量必须大于 0';
          return;
        }
        const res = sendGalaxyTrade(acc, null, sys, mat, qty);
        if (!res.ok) {
          err.textContent = res.reason;
        } else {
          playVictory();
          closeModal();
          alert(res.msg);
          refresh();
        }
      };
    }, 50);
  }

  function generateDefenderShips(sys) {
    const p = sys.defensePower || 1000;
    const count = Math.max(2, Math.min(5, Math.round(p / 700)));
    const ships = [];
    for (let i = 0; i < count; i++) {
      const isCapital = i === 0;
      const roleId = isCapital ? (p >= 3000 ? 'battleship' : 'cruiser') : (i % 2 === 0 ? 'destroyer' : 'interceptor');
      const hp = isCapital ? Math.round(p * 0.7 + 600) : Math.round(p * 0.25 + 250);
      const shield = isCapital ? Math.round(p * 0.5 + 400) : Math.round(p * 0.15 + 150);
      const firepower = isCapital ? Math.round(p * 0.1 + 60) : Math.round(p * 0.05 + 30);
      ships.push({
        id: `def_${sys.id || 'planet'}_${i}`,
        name: isCapital ? `${sys.planetNameCn}·轨道要塞核心舰` : `${sys.planetNameCn}·护卫哨艇 #${i}`,
        roleId,
        role: roleId,
        hullMax: hp,
        shieldMax: shield,
        firepower: firepower,
        speed: 12 + (count - i),
        critChance: 0.1,
      });
    }
    return ships;
  }

  async function openChatModal() {
    const div = document.createElement('div');
    div.style.cssText = 'display:flex;flex-direction:column;gap:12px;height:450px;max-height:70vh;';
    div.innerHTML = `
      <div style="font-size:12px;color:#94a3b8;padding:6px 10px;background:rgba(56,189,248,0.08);border-radius:6px;border:1px solid rgba(56,189,248,0.2);">
        📡 实时全星区超空间广播频段已连接（跨玩家公频通讯通道）
      </div>
      <div id="chat-msg-list" style="flex:1;overflow-y:auto;background:rgba(0,0,0,0.3);border:1px solid #22354c;border-radius:8px;padding:12px;display:flex;flex-direction:column;gap:8px;">
        <div style="color:#64748b;text-align:center;padding:20px;">正在连接超空间广播频段...</div>
      </div>
      <div style="display:flex;gap:8px;align-items:center;">
        <input type="text" id="chat-input" placeholder="输入广播信息（按 Enter 发送）..." maxlength="120"
               style="flex:1;min-height:44px;padding:8px 12px;background:#0b101c;border:1px solid #22354c;border-radius:6px;color:#c8d4e0;font-size:14px;">
        <button id="btn-send-chat" style="min-height:44px;padding:0 16px;background:#38bdf8;color:#0b101c;font-weight:bold;border:none;border-radius:6px;cursor:pointer;white-space:nowrap;">
          发送广播
        </button>
      </div>
    `;

    openModal({ title: '💬 全星区超空间公频广播', body: div });

    setTimeout(async () => {
      const msgList = document.getElementById('chat-msg-list');
      const input = document.getElementById('chat-input');
      const btnSend = document.getElementById('btn-send-chat');
      if (!msgList || !input || !btnSend) return;

      async function refreshMessages() {
        const res = await fetchOnlineChatMessages();
        const msgs = (res && res.messages) ? res.messages : [];
        if (msgs.length === 0) {
          msgList.innerHTML = '<div style="color:#64748b;text-align:center;padding:20px;">当前公频尚无广播讯息，发一条向全星际打个招呼吧！</div>';
          return;
        }
        msgList.innerHTML = msgs.map((m) => {
          const isMe = m.senderId === profile.commanderId;
          const time = new Date(m.time).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
          return `
            <div style="padding:6px 10px;border-radius:6px;background:${isMe ? 'rgba(56,189,248,0.12)' : 'rgba(255,255,255,0.03)'};border:1px solid ${isMe ? '#38bdf840' : '#22354c'};">
              <div style="display:flex;justify-content:space-between;font-size:11px;color:${isMe ? '#7cd7ff' : '#94a3b8'};margin-bottom:2px;">
                <span>${escapeHtml(m.senderName)} <span style="font-size:10px;color:#64748b;">[${escapeHtml(m.senderId)}]</span></span>
                <span>${time}</span>
              </div>
              <div style="font-size:13px;color:#f1f5f9;line-height:1.4;word-break:break-word;">${escapeHtml(m.text)}</div>
            </div>
          `;
        }).join('');
        msgList.scrollTop = msgList.scrollHeight;
      }

      await refreshMessages();

      async function doSend() {
        const text = input.value.trim();
        if (!text) return;
        input.value = '';
        btnSend.disabled = true;
        playPing();
        await sendOnlineChatMessage(acc, text);
        btnSend.disabled = false;
        await refreshMessages();
        input.focus();
      }

      btnSend.onclick = doSend;
      input.onkeydown = (e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          doSend();
        }
      };
    }, 50);
  }

  async function openMarketModal() {
    const homeCode = acc.homePlanetCode || 'syl';
    const inst = getPlanetInstance(homeCode) || getPlanetInstance(homeCode.replace(/\d+$/, ''));
    let activeTab = 'browse'; // 'browse' | 'list'

    const div = document.createElement('div');
    div.style.cssText = 'display:flex;flex-direction:column;gap:12px;height:480px;max-height:75vh;';
    div.innerHTML = `
      <div style="display:flex;gap:8px;border-bottom:1px solid #22354c;padding-bottom:8px;">
        <button id="market-tab-browse" style="flex:1;min-height:40px;background:rgba(16,185,129,0.2);color:#6ee7b7;font-weight:bold;border:1px solid #10b98160;border-radius:6px;cursor:pointer;">
          🛒 浏览在售货单
        </button>
        <button id="market-tab-post" style="flex:1;min-height:40px;background:rgba(255,255,255,0.05);color:#94a3b8;font-weight:bold;border:1px solid #22354c;border-radius:6px;cursor:pointer;">
          📦 上架挂售物资
        </button>
      </div>
      <div id="market-content" style="flex:1;overflow-y:auto;display:flex;flex-direction:column;">
      </div>
    `;

    openModal({ title: '🌐 全星区跳蚤集市 (Live Market)', body: div });

    setTimeout(() => {
      const tabBrowse = document.getElementById('market-tab-browse');
      const tabPost = document.getElementById('market-tab-post');
      const content = document.getElementById('market-content');
      if (!tabBrowse || !tabPost || !content) return;

      function switchTab(tab) {
        activeTab = tab;
        if (tab === 'browse') {
          tabBrowse.style.background = 'rgba(16,185,129,0.2)';
          tabBrowse.style.color = '#6ee7b7';
          tabBrowse.style.borderColor = '#10b98160';
          tabPost.style.background = 'rgba(255,255,255,0.05)';
          tabPost.style.color = '#94a3b8';
          tabPost.style.borderColor = '#22354c';
          renderBrowse();
        } else {
          tabPost.style.background = 'rgba(16,185,129,0.2)';
          tabPost.style.color = '#6ee7b7';
          tabPost.style.borderColor = '#10b98160';
          tabBrowse.style.background = 'rgba(255,255,255,0.05)';
          tabBrowse.style.color = '#94a3b8';
          tabBrowse.style.borderColor = '#22354c';
          renderPost();
        }
      }

      tabBrowse.onclick = () => switchTab('browse');
      tabPost.onclick = () => switchTab('list');

      async function renderBrowse() {
        content.innerHTML = '<div style="color:#64748b;text-align:center;padding:30px;">正在连接星际集市数据库...</div>';
        const listings = await fetchOnlineMarketListings();
        if (listings.length === 0) {
          content.innerHTML = `
            <div style="padding:30px;text-align:center;color:#64748b;">
              当前全星区集市暂无挂单。<br>
              <span style="font-size:12px;color:#94a3b8;margin-top:6px;display:inline-block;">你可以点击上方「上架挂售物资」成为第一个星际大亨！</span>
            </div>
          `;
          return;
        }

        const curAscoin = Math.floor(Number(acc.ascoin) || 0);
        content.innerHTML = `
          <div style="display:flex;justify-content:space-between;align-items:center;font-size:12px;color:#94a3b8;margin-bottom:8px;">
            <span>当前持有：<b style="color:#7cd7ff">${curAscoin}</b> Ascoin</span>
            <button id="btn-refresh-market" style="padding:4px 10px;background:rgba(255,255,255,0.06);border:1px solid #334155;color:#c8d4e0;border-radius:4px;cursor:pointer;">🔄 刷新集市</button>
          </div>
          <div id="market-items-list" style="display:flex;flex-direction:column;gap:8px;"></div>
        `;

        const refreshBtn = document.getElementById('btn-refresh-market');
        if (refreshBtn) refreshBtn.onclick = () => renderBrowse();

        const itemsList = document.getElementById('market-items-list');
        for (const item of listings) {
          const isMyListing = item.sellerId === profile.commanderId;
          const totalCost = item.priceAscoin * item.qty;
          const card = document.createElement('div');
          card.style.cssText = 'padding:10px 12px;border-radius:6px;background:rgba(0,0,0,0.3);border:1px solid #22354c;display:flex;justify-content:space-between;align-items:center;gap:10px;';
          card.innerHTML = `
            <div style="flex:1;">
              <div style="font-size:14px;font-weight:bold;color:#f1f5f9;display:flex;align-items:center;gap:6px;">
                <span>${escapeHtml(item.nameCn)}</span>
                <span style="font-size:12px;color:#6ee7b7;background:rgba(16,185,129,0.15);padding:1px 6px;border-radius:4px;">×${item.qty}</span>
              </div>
              <div style="font-size:11px;color:#94a3b8;margin-top:2px;">
                卖家：<span style="color:#c8d4e0;">${escapeHtml(item.sellerCallsign)}</span>
                ${isMyListing ? '<span style="color:#ffc46b;margin-left:4px;">(我的货单)</span>' : ''}
              </div>
              <div style="font-size:12px;color:#7cd7ff;margin-top:2px;">
                单价 <b>${item.priceAscoin}</b> ₳ | 总计 <b>${totalCost}</b> Ascoin
              </div>
            </div>
            <div>
              <button class="btn-buy-listing" data-id="${item.id}" ${isMyListing ? 'disabled' : ''} style="min-height:38px;padding:0 14px;border:none;border-radius:6px;background:${isMyListing ? '#334155' : '#10b981'};color:${isMyListing ? '#64748b' : '#0b101c'};font-weight:bold;cursor:${isMyListing ? 'not-allowed' : 'pointer'};">
                ${isMyListing ? '自挂货单' : '采购交割'}
              </button>
            </div>
          `;
          itemsList.appendChild(card);
        }

        itemsList.querySelectorAll('.btn-buy-listing').forEach((btn) => {
          btn.addEventListener('click', async () => {
            const listingId = btn.getAttribute('data-id');
            btn.disabled = true;
            btn.textContent = '交割中...';
            const res = await buyOnlineMarketListing(acc, listingId);
            if (!res.ok) {
              alert(res.reason || '采购失败');
              btn.disabled = false;
              btn.textContent = '采购交割';
            } else {
              playVictory();
              alert(res.msg);
              refresh();
              renderBrowse();
            }
          });
        });
      }

      function renderPost() {
        if (!inst || !Array.isArray(inst.inventory)) {
          content.innerHTML = '<div style="padding:20px;text-align:center;color:#64748b;">母星仓储数据暂不可用。</div>';
          return;
        }

        const availableMats = inst.inventory.filter((e) => (Number(e.owned) || 0) >= 1);
        if (availableMats.length === 0) {
          content.innerHTML = `
            <div style="padding:30px;text-align:center;color:#64748b;">
              母星仓储中暂无可挂售的物资。<br>
              <span style="font-size:12px;color:#94a3b8;margin-top:6px;display:inline-block;">请先在工厂或矿区采集生产一些物资后再来挂单！</span>
            </div>
          `;
          return;
        }

        content.innerHTML = `
          <div style="background:rgba(0,0,0,0.25);border:1px solid #22354c;border-radius:8px;padding:14px;display:flex;flex-direction:column;gap:10px;">
            <div>
              <label style="font-size:12px;color:#94a3b8;display:block;margin-bottom:4px;">选择出售物资：</label>
              <select id="post-mat-sel" style="width:100%;min-height:44px;background:#0b101c;border:1px solid #22354c;color:#c8d4e0;border-radius:6px;padding:8px 12px;font-size:14px;">
                ${availableMats.map((e) => `<option value="${escapeHtml(e.mat)}">${escapeHtml(e.mat)} (当前存量: ${Math.floor(e.owned)})</option>`).join('')}
              </select>
            </div>
            <div>
              <label style="font-size:12px;color:#94a3b8;display:block;margin-bottom:4px;">上架数量：</label>
              <input type="number" id="post-qty-inp" min="1" max="10000" value="10"
                     style="width:100%;min-height:44px;box-sizing:border-box;background:#0b101c;border:1px solid #22354c;color:#c8d4e0;border-radius:6px;padding:8px 12px;font-size:14px;">
            </div>
            <div>
              <label style="font-size:12px;color:#94a3b8;display:block;margin-bottom:4px;">出售单价 (Ascoin)：</label>
              <input type="number" id="post-price-inp" min="1" max="100000" value="50"
                     style="width:100%;min-height:44px;box-sizing:border-box;background:#0b101c;border:1px solid #22354c;color:#c8d4e0;border-radius:6px;padding:8px 12px;font-size:14px;">
            </div>
            <div id="post-summary" style="font-size:12px;color:#6ee7b7;margin-top:2px;"></div>
            <div id="post-err" style="color:#ff6b81;font-size:12px;"></div>
            <button id="btn-submit-post" style="width:100%;min-height:44px;background:#10b981;color:#0b101c;font-weight:bold;border:none;border-radius:6px;cursor:pointer;margin-top:4px;">
              🚀 确认发布到全星区集市
            </button>
          </div>
        `;

        const matSel = document.getElementById('post-mat-sel');
        const qtyInp = document.getElementById('post-qty-inp');
        const priceInp = document.getElementById('post-price-inp');
        const summary = document.getElementById('post-summary');
        const err = document.getElementById('post-err');
        const btnSubmit = document.getElementById('btn-submit-post');

        function updatePostSum() {
          const q = parseInt(qtyInp.value, 10) || 0;
          const p = parseInt(priceInp.value, 10) || 0;
          summary.innerHTML = `预计回款总额：<b>${q * p}</b> Ascoin`;
        }
        matSel.onchange = updatePostSum;
        qtyInp.oninput = updatePostSum;
        priceInp.oninput = updatePostSum;
        updatePostSum();

        btnSubmit.onclick = async () => {
          const mat = matSel.value;
          const qty = parseInt(qtyInp.value, 10) || 0;
          const priceAscoin = parseInt(priceInp.value, 10) || 0;
          if (qty <= 0 || priceAscoin <= 0) {
            err.textContent = '数量与单价必须大于 0';
            return;
          }
          btnSubmit.disabled = true;
          btnSubmit.textContent = '正在挂单...';
          const res = await createOnlineMarketListing(acc, { mat, nameCn: mat, qty, priceAscoin });
          if (!res.ok) {
            err.textContent = res.reason || '挂单失败';
            btnSubmit.disabled = false;
            btnSubmit.textContent = '🚀 确认发布到全星区集市';
          } else {
            playVictory();
            alert(res.msg);
            refresh();
            switchTab('browse');
          }
        };
      }

      renderBrowse();
    }, 50);
  }

  function openRaidModal(sys) {
    const fleets = listFleets(acc);
    const div = document.createElement('div');
    const dist = sys.distanceLy || 2.0;
    const fuelNeed = Math.round(dist * 150);

    div.innerHTML = `
      <p style="color:#94a3b8;font-size:13px;line-height:1.5;margin-bottom:12px;">
        派遣主力舰队执行突击掠夺。若攻破敌要塞阵列，将劫掠其 5%~10% 的特产仓储运回母星，战后该星将进入 12 小时免战保护。
      </p>
      <div style="background:rgba(0,0,0,0.25);padding:10px;border-radius:6px;font-size:12px;color:#c8d4e0;margin-bottom:12px;">
        <div>目标防线评级：<b>${fmtNum(sys.defensePower)}</b> 点</div>
        <div>往返航程距离：<b>${dist}</b> 光年（需要消耗 <b>${fuelNeed}</b> mol 甲烷/氢气）</div>
      </div>
      <div style="margin-bottom:12px;">
        <label style="font-size:12px;color:#94a3b8;display:block;margin-bottom:4px;">指派突击编队：</label>
        <select id="raid-fleet-sel" style="width:100%;min-height:44px;background:#0b101c;border:1px solid #22354c;color:#c8d4e0;border-radius:6px;padding:8px;">
          ${fleets.length === 0 ? '<option value="">(当前无可用编队，请先在舰队页组建)</option>' : fleets.map((f) => `<option value="${f.id}">${escapeHtml(f.nameCn)}（战力评估：${evaluateFleetPower(acc, f)}）</option>`).join('')}
        </select>
      </div>
      <div id="raid-err" style="color:#ff6b81;font-size:12px;margin-bottom:10px;"></div>
      <div style="display:flex;gap:10px;flex-wrap:wrap;">
        <button id="btn-tactical-raid" style="flex:1;min-width:130px;min-height:44px;background:#38bdf8;color:#0b101c;font-weight:bold;border:none;border-radius:6px;cursor:pointer;">⚔️ 亲临实操交火</button>
        <button id="btn-confirm-raid" style="flex:1;min-width:130px;min-height:44px;background:#f09595;color:#0b101c;font-weight:bold;border:none;border-radius:6px;cursor:pointer;">⚡ 快速推演突击</button>
      </div>
    `;

    openModal({ title: `远征进攻：${sys.planetNameCn}`, body: div });

    setTimeout(() => {
      const sel = document.getElementById('raid-fleet-sel');
      const err = document.getElementById('raid-err');
      const btnTactical = document.getElementById('btn-tactical-raid');
      const btnQuick = document.getElementById('btn-confirm-raid');

      if (btnQuick) {
        btnQuick.onclick = () => {
          const fleetId = sel.value;
          if (!fleetId) {
            err.textContent = '请先指派具备战斗力的空闲编队';
            return;
          }
          playWarp();
          const res = sendGalaxyRaid(acc, fleetId, sys);
          if (!res.ok) {
            err.textContent = res.reason;
          } else {
            closeModal();
            alert(res.msg);
            refresh();
          }
        };
      }

      if (btnTactical) {
        btnTactical.onclick = () => {
          const fleetId = sel.value;
          if (!fleetId) {
            err.textContent = '请先指派具备战斗力的空闲编队';
            return;
          }
          const fleet = fleets.find((f) => f.id === fleetId);
          if (!fleet || !fleet.shipIds || fleet.shipIds.length === 0) {
            err.textContent = '该编队没有指派战舰';
            return;
          }
          playWarp();
          const fleetShips = (acc.ships || []).filter((s) => fleet.shipIds.includes(s.id));
          const defenderShips = generateDefenderShips(sys);

          closeModal();
          openBattleView(fleetShips, defenderShips, {
            attackerName: `${profile.callsign} [${fleet.nameCn}]`,
            defenderName: `${sys.planetNameCn} 防御阵列`,
            openModal,
            closeModal,
            onFinish: (result) => {
              const res = sendGalaxyRaid(acc, fleetId, sys, { forceWin: result.win });
              refresh();
            },
          });
        };
      }
    }, 50);
  }

  // 初始启动
  refresh();
}

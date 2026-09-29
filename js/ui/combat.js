// 舰队实时交互交战视窗（Astrix v0.2.0）
// 纯原生 ES 模块，深空玻璃拟态风格，支持移动端与 PC 端响应式与实时交互指令。

import {
  createBattleSession, tickBattle, executeTacticalCommand, TACTICAL_COMMANDS
} from '../core/combat.js?v=20.0';
import { fmtNum } from '../core/format.js?v=20.0';

function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
}

/**
 * 在目标容器或模态层中渲染完整交互式战斗视窗
 */
export function openBattleView(ctx, options = {}) {
  const { openModal, closeModal, onBattleEnd } = ctx;
  const session = createBattleSession(options.playerShips || [], options.enemyShips || [], options);

  let timer = null;
  let timeScale = 1.0;
  let autoBattle = false;

  const root = document.createElement('div');
  root.className = 'battle-arena-root';
  root.style.cssText = 'display:flex;flex-direction:column;gap:12px;color:#c8d4e0;font-size:13px;max-width:920px;margin:0 auto;';

  // 1. 顶部控制栏与态势
  const header = document.createElement('div');
  header.style.cssText = 'display:flex;justify-content:space-between;align-items:center;background:rgba(0,0,0,0.4);padding:10px 14px;border-radius:8px;border:1px solid rgba(124,215,255,0.2);';
  header.innerHTML = `
    <div>
      <span style="font-weight:bold;font-size:16px;color:#7cd7ff;">⚔️ ${esc(session.title)}</span>
      <span id="bt-time-label" style="margin-left:12px;font-size:12px;color:#94a3b8;">作战耗时：00:00</span>
    </div>
    <div style="display:flex;gap:8px;align-items:center;">
      <button id="bt-btn-speed" style="padding:4px 10px;min-height:36px;border-radius:4px;background:rgba(255,255,255,0.06);border:1px solid #475569;color:#cbd5e1;cursor:pointer;">1.0x 航速</button>
      <button id="bt-btn-auto" style="padding:4px 10px;min-height:36px;border-radius:4px;background:rgba(255,255,255,0.06);border:1px solid #475569;color:#cbd5e1;cursor:pointer;">🤖 自动托管: 关</button>
    </div>
  `;
  root.appendChild(header);

  // 2. 战场主画卷（双方舰阵雷达对峙区）
  const stage = document.createElement('div');
  stage.style.cssText = 'position:relative;height:240px;background:radial-gradient(ellipse at center, #0f172a 0%, #050814 100%);border-radius:8px;border:1px solid rgba(124,215,255,0.25);overflow:hidden;display:flex;justify-content:space-between;padding:16px 24px;';
  stage.innerHTML = `
    <div style="position:absolute;inset:0;opacity:0.25;background-image:radial-gradient(#7cd7ff 1px, transparent 1px);background-size:24px 24px;pointer-events:none;"></div>
    <!-- 己方舰队列阵 -->
    <div id="bt-player-formation" style="display:flex;flex-direction:column;gap:10px;justify-content:center;z-index:2;min-width:180px;"></div>
    <!-- 战场中央光效与弹道指示 -->
    <div id="bt-fx-zone" style="flex:1;position:relative;pointer-events:none;display:flex;align-items:center;justify-content:center;">
      <div id="bt-fx-label" style="font-size:14px;color:#93c5fd;font-weight:bold;opacity:0.8;text-align:center;">交火接触中…</div>
    </div>
    <!-- 敌方舰队列阵 -->
    <div id="bt-enemy-formation" style="display:flex;flex-direction:column;gap:10px;justify-content:center;z-index:2;min-width:180px;"></div>
  `;
  root.appendChild(stage);

  // 3. 指挥官能量与战术指令按键板
  const cmdPanel = document.createElement('div');
  cmdPanel.style.cssText = 'background:rgba(0,0,0,0.35);padding:12px;border-radius:8px;border:1px solid rgba(124,215,255,0.15);';

  const energyBarBox = document.createElement('div');
  energyBarBox.style.cssText = 'margin-bottom:10px;display:flex;align-items:center;gap:12px;';
  energyBarBox.innerHTML = `
    <span style="font-size:12px;color:#94a3b8;min-width:90px;">⚡ 战术指令电容：</span>
    <div style="flex:1;height:10px;background:#1e293b;border-radius:5px;overflow:hidden;border:1px solid #334155;">
      <div id="bt-energy-fill" style="height:100%;width:50%;background:linear-gradient(90deg, #38bdf8, #818cf8);transition:width 0.2s;"></div>
    </div>
    <span id="bt-energy-num" style="font-size:12px;font-weight:bold;color:#7cd7ff;min-width:55px;">50 / 100</span>
  `;
  cmdPanel.appendChild(energyBarBox);

  // 指令按钮栅格
  const btnGrid = document.createElement('div');
  btnGrid.style.cssText = 'display:grid;grid-template-columns:repeat(auto-fit, minmax(130px, 1fr));gap:8px;';

  for (const cmdKey in TACTICAL_COMMANDS) {
    const cmd = TACTICAL_COMMANDS[cmdKey];
    const b = document.createElement('button');
    b.id = `bt-cmd-${cmd.id}`;
    b.className = 'btn-action';
    b.style.cssText = 'min-height:50px;padding:6px;border-radius:6px;border:1px solid #334155;background:rgba(124,215,255,0.08);color:#c8d4e0;cursor:pointer;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:2px;';
    b.title = cmd.desc;
    b.innerHTML = `
      <div style="font-weight:bold;font-size:13px;">${cmd.icon} ${cmd.name}</div>
      <div style="font-size:11px;color:#94a3b8;">${cmd.costEnergy} ⚡ · <span class="bt-cd-label">就绪</span></div>
    `;
    b.onclick = () => {
      const res = executeTacticalCommand(session, cmd.id);
      if (!res.ok) {
        showFloatingFx(res.reason, '#ff6b81');
      } else {
        showFloatingFx(cmd.name + '！', '#7cd7ff');
      }
      renderView();
    };
    btnGrid.appendChild(b);
  }
  cmdPanel.appendChild(btnGrid);
  root.appendChild(cmdPanel);

  // 4. 实时战况通信记录区
  const logBox = document.createElement('div');
  logBox.style.cssText = 'background:rgba(0,0,0,0.5);border-radius:8px;padding:10px 14px;border:1px solid #1e293b;height:120px;overflow-y:auto;font-size:12px;line-height:1.6;font-family:monospace;';
  logBox.id = 'bt-log-box';
  root.appendChild(logBox);

  // 浮动特效提示
  function showFloatingFx(text, color = '#7cd7ff') {
    const fx = document.getElementById('bt-fx-label');
    if (!fx) return;
    fx.textContent = text;
    fx.style.color = color;
    fx.style.transform = 'scale(1.2)';
    setTimeout(() => { if (fx) fx.style.transform = 'scale(1.0)'; }, 300);
  }

  // 渲染双方战舰健康状态条
  function renderShips() {
    const pBox = document.getElementById('bt-player-formation');
    const eBox = document.getElementById('bt-enemy-formation');
    if (!pBox || !eBox) return;

    pBox.innerHTML = session.playerShips.map((s) => {
      const hullPct = Math.round((s.hull / s.hullMax) * 100);
      const shieldPct = Math.round((s.shield / s.shieldMax) * 100);
      return `
        <div style="opacity:${s.alive ? 1 : 0.35};border-left:3px solid ${s.alive ? '#38bdf8' : '#64748b'};padding-left:8px;">
          <div style="font-weight:bold;font-size:12px;color:${s.alive ? '#f1f5f9' : '#94a3b8'};display:flex;justify-content:space-between;">
            <span>${esc(s.name)}</span>
            <span style="font-size:11px;color:#94a3b8;">${s.alive ? '交战' : '解体'}</span>
          </div>
          <!-- 护盾条 -->
          <div style="height:4px;background:#1e293b;border-radius:2px;margin:3px 0 2px;overflow:hidden;">
            <div style="height:100%;width:${shieldPct}%;background:#38bdf8;transition:width 0.2s;"></div>
          </div>
          <!-- 装甲结构条 -->
          <div style="height:4px;background:#1e293b;border-radius:2px;overflow:hidden;">
            <div style="height:100%;width:${hullPct}%;background:${hullPct > 35 ? '#10b981' : '#ef4444'};transition:width 0.2s;"></div>
          </div>
        </div>
      `;
    }).join('');

    eBox.innerHTML = session.enemyShips.map((s) => {
      const hullPct = Math.round((s.hull / s.hullMax) * 100);
      const shieldPct = Math.round((s.shield / s.shieldMax) * 100);
      return `
        <div style="opacity:${s.alive ? 1 : 0.35};border-right:3px solid ${s.alive ? '#f43f5e' : '#64748b'};padding-right:8px;text-align:right;">
          <div style="font-weight:bold;font-size:12px;color:${s.alive ? '#f1f5f9' : '#94a3b8'};display:flex;justify-content:space-between;">
            <span style="font-size:11px;color:#94a3b8;">${s.alive ? '交战' : '解体'}</span>
            <span>${esc(s.name)}</span>
          </div>
          <!-- 护盾条 -->
          <div style="height:4px;background:#1e293b;border-radius:2px;margin:3px 0 2px;overflow:hidden;">
            <div style="height:100%;width:${shieldPct}%;background:#f43f5e;float:right;transition:width 0.2s;"></div>
          </div>
          <!-- 装甲结构条 -->
          <div style="height:4px;background:#1e293b;border-radius:2px;overflow:hidden;clear:both;">
            <div style="height:100%;width:${hullPct}%;background:${hullPct > 35 ? '#f59e0b' : '#ef4444'};float:right;transition:width 0.2s;"></div>
          </div>
        </div>
      `;
    }).join('');
  }

  // 刷新状态与日志
  function renderView() {
    // 耗时
    const tLbl = document.getElementById('bt-time-label');
    if (tLbl) {
      const sec = Math.floor(session.timeSec);
      const m = String(Math.floor(sec / 60)).padStart(2, '0');
      const s = String(sec % 60).padStart(2, '0');
      tLbl.textContent = `作战耗时：${m}:${s}`;
    }

    // 能量条
    const fill = document.getElementById('bt-energy-fill');
    const num = document.getElementById('bt-energy-num');
    if (fill && num) {
      const pct = Math.round((session.energy / session.energyMax) * 100);
      fill.style.width = pct + '%';
      num.textContent = `${Math.floor(session.energy)} / ${session.energyMax}`;
    }

    // 指令冷却更新
    for (const cmdKey in TACTICAL_COMMANDS) {
      const btn = document.getElementById(`bt-cmd-${cmdKey}`);
      if (btn) {
        const cd = session.cooldowns[cmdKey] || 0;
        const cost = TACTICAL_COMMANDS[cmdKey].costEnergy;
        const cdLbl = btn.querySelector('.bt-cd-label');
        if (cd > 0) {
          btn.style.opacity = '0.5';
          if (cdLbl) cdLbl.textContent = `${cd.toFixed(1)}s`;
        } else if (session.energy < cost) {
          btn.style.opacity = '0.6';
          if (cdLbl) cdLbl.textContent = '能量不足';
        } else {
          btn.style.opacity = '1.0';
          if (cdLbl) cdLbl.textContent = '就绪';
        }
      }
    }

    // 战舰生命条
    renderShips();

    // 日志更新
    const lb = document.getElementById('bt-log-box');
    if (lb) {
      lb.innerHTML = session.logs.map((l) => {
        let col = '#94a3b8';
        if (l.type === 'crit') col = '#fbbf24';
        else if (l.type === 'skill') col = '#38bdf8';
        else if (l.type === 'win') col = '#34d399';
        else if (l.type === 'loss') col = '#f87171';
        else if (l.type === 'drone') col = '#c084fc';
        return `<div style="color:${col};margin-bottom:2px;">${esc(l.text)}</div>`;
      }).join('');
    }

    // 终局弹窗
    if (session.ended) {
      stopLoop();
      showResultModal();
    }
  }

  function showResultModal() {
    const isWin = session.winner === 'player';
    const resDiv = document.createElement('div');
    resDiv.style.cssText = 'padding:16px;text-align:center;color:#c8d4e0;';

    resDiv.innerHTML = `
      <div style="font-size:42px;margin-bottom:10px;">${isWin ? '🏆' : '💥'}</div>
      <h3 style="color:${isWin ? '#9FE1CB' : '#f09595'};margin:0 0 10px;font-size:20px;">
        ${isWin ? '战术推演大捷 · 敌军全歼' : '战术受阻 · 舰队受创撤退'}
      </h3>
      <p style="font-size:13px;color:#94a3b8;line-height:1.6;margin-bottom:16px;">
        ${isWin ? '我方舰队在指挥官的精准战术部署下，成功瓦解敌方战斗群阵列，全歼目标！' : '敌方火力过于凶悍，我方各舰船体受损过半，被迫启动亚空间跳跃撤离。'}
      </p>
      <div style="background:rgba(0,0,0,0.3);padding:12px;border-radius:6px;font-size:12px;margin-bottom:16px;text-align:left;line-height:1.8;">
        <div>战斗用时：<b>${Math.floor(session.timeSec)} 秒</b></div>
        <div>我方存活战舰：<b>${session.playerShips.filter((s) => s.alive).length} / ${session.playerShips.length}</b></div>
        <div>击毁敌舰数量：<b>${session.enemyShips.filter((s) => !s.alive).length} / ${session.enemyShips.length}</b></div>
        ${isWin ? '<div style="color:#9FE1CB;">获得战功奖励：+500 军功经验 · +20,000 Ascoin</div>' : ''}
      </div>
      <button id="bt-close-final" style="width:100%;min-height:44px;border-radius:6px;border:none;background:#7cd7ff;color:#050814;font-weight:bold;font-size:14px;cursor:pointer;">返回舰队中心</button>
    `;

    openModal({ title: isWin ? '胜利结算' : '战损结算', body: resDiv });
    setTimeout(() => {
      const b = document.getElementById('bt-close-final');
      if (b) {
        b.onclick = () => {
          closeModal();
          if (typeof onBattleEnd === 'function') onBattleEnd(session);
        };
      }
    }, 50);
  }

  // 战斗心跳推演循环
  function startLoop() {
    stopLoop();
    timer = setInterval(() => {
      // 自动战斗模式：有能量就自动释放可用技能
      if (autoBattle && !session.ended) {
        for (const k of ['focus', 'torpedo', 'shield', 'drones']) {
          if (session.energy >= TACTICAL_COMMANDS[k].costEnergy && session.cooldowns[k] <= 0) {
            executeTacticalCommand(session, k);
            break;
          }
        }
      }
      tickBattle(session, 0.5 * timeScale);
      renderView();
    }, 500);
  }

  function stopLoop() {
    if (timer) {
      clearInterval(timer);
      timer = null;
    }
  }

  // 事件绑定：航速切换与自动托管
  setTimeout(() => {
    const btnSpeed = document.getElementById('bt-btn-speed');
    const btnAuto = document.getElementById('bt-btn-auto');
    if (btnSpeed) {
      btnSpeed.onclick = () => {
        timeScale = timeScale === 1.0 ? 2.0 : 1.0;
        btnSpeed.textContent = `${timeScale.toFixed(1)}x 航速`;
        btnSpeed.style.background = timeScale > 1 ? 'rgba(124,215,255,0.18)' : 'rgba(255,255,255,0.06)';
      };
    }
    if (btnAuto) {
      btnAuto.onclick = () => {
        autoBattle = !autoBattle;
        btnAuto.textContent = `🤖 自动托管: ${autoBattle ? '开' : '关'}`;
        btnAuto.style.background = autoBattle ? 'rgba(159,225,203,0.2)' : 'rgba(255,255,255,0.06)';
        btnAuto.style.color = autoBattle ? '#9FE1CB' : '#cbd5e1';
      };
    }
  }, 50);

  renderView();
  startLoop();

  // 若作为弹窗打开
  if (typeof openModal === 'function') {
    openModal({ title: `战术交战：${session.title}`, body: root, onClose: () => stopLoop() });
  }

  return { root, session, stopLoop };
}

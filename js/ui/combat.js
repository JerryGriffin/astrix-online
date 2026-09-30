// 舰队实时交互交战视窗（Astrix v0.2.0）
// 纯原生 ES 模块，深空玻璃拟态风格，配备动态激光弹道、伤害跳字浮层、护盾波动与高能粒子特效。

import {
  createBattleSession, tickBattle, executeTacticalCommand, TACTICAL_COMMANDS,
  SHIP_ROLES, BATTLE_DOCTRINES, getBattleReport
} from '../core/combat.js?v=21.13';
import { fmtNum } from '../core/format.js?v=21.13';
import { playLaser, playExplosion, playShield, playWarp, playVictory, playPing } from '../core/sound.js?v=21.13';

function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
}

/**
 * 在目标容器或模态层中渲染完整交互式战斗视窗
 * 支持两种调用签名：
 * 1. openBattleView(ctx, options)
 * 2. openBattleView(playerShips, enemyShips, options)
 */
export function openBattleView(arg1, arg2, arg3) {
  let ctx, options;
  if (Array.isArray(arg1) || Array.isArray(arg2)) {
    options = arg3 || {};
    options.playerShips = Array.isArray(arg1) ? arg1 : [];
    options.enemyShips = Array.isArray(arg2) ? arg2 : [];
    ctx = {
      openModal: options.openModal,
      closeModal: options.closeModal,
      onBattleEnd: options.onBattleEnd || options.onFinish,
    };
  } else {
    ctx = arg1 || {};
    options = arg2 || {};
  }

  const { openModal, closeModal, onBattleEnd } = ctx;
  const session = createBattleSession(options.playerShips || [], options.enemyShips || [], options);

  let timer = null;
  let timeScale = 1.0;
  let autoBattle = false;

  const root = document.createElement('div');
  root.className = 'battle-arena-root';
  root.style.cssText = 'display:flex;flex-direction:column;gap:12px;color:#c8d4e0;font-size:13px;max-width:940px;margin:0 auto;position:relative;';

  // 1. 顶部控制栏与态势
  const header = document.createElement('div');
  header.style.cssText = 'display:flex;justify-content:space-between;align-items:center;background:rgba(0,0,0,0.55);padding:10px 14px;border-radius:8px;border:1px solid rgba(124,215,255,0.25);';
  header.innerHTML = `
    <div>
      <span style="font-weight:bold;font-size:16px;color:#7cd7ff;">⚔️ ${esc(session.title)}</span>
      <span id="bt-time-label" style="margin-left:10px;font-size:12px;color:#94a3b8;">作战耗时：00:00</span>
      <span id="bt-doctrine-tag" style="margin-left:8px;font-size:11px;padding:2px 8px;border-radius:4px;background:rgba(234,179,8,0.18);border:1px solid rgba(234,179,8,0.4);color:#fde047;" title="${esc(session.doctrineInfo?.desc || '')}">
        ${session.doctrineInfo?.icon || '⚡'} 学说：${esc(session.doctrineInfo?.name || '闪电突穿')}
      </span>
      <span id="bt-target-hint" style="margin-left:8px;font-size:11px;color:#38bdf8;">(点击敌舰锁定集火)</span>
    </div>
    <div style="display:flex;gap:8px;align-items:center;">
      <button id="bt-btn-speed" style="padding:4px 10px;min-height:36px;border-radius:4px;background:rgba(255,255,255,0.06);border:1px solid #475569;color:#cbd5e1;cursor:pointer;">1.0x 航速</button>
      <button id="bt-btn-auto" style="padding:4px 10px;min-height:36px;border-radius:4px;background:rgba(255,255,255,0.06);border:1px solid #475569;color:#cbd5e1;cursor:pointer;">🤖 自动战术: 关</button>
    </div>
  `;
  root.appendChild(header);

  // 2. 战场主画卷（双方舰阵雷达对峙区 + 激光弹道与跳字层）
  const stage = document.createElement('div');
  stage.id = 'bt-battle-stage';
  stage.style.cssText = 'position:relative;min-height:270px;background:radial-gradient(ellipse at center, #0b1533 0%, #030612 100%);border-radius:8px;border:1px solid rgba(124,215,255,0.3);overflow:hidden;display:flex;justify-content:space-between;padding:16px 20px;gap:12px;';
  stage.innerHTML = `
    <!-- 星空背景与雷达扫描线 -->
    <div style="position:absolute;inset:0;opacity:0.25;background-image:radial-gradient(#38bdf8 1px, transparent 1px);background-size:24px 24px;pointer-events:none;"></div>
    <div id="bt-screen-flash" style="position:absolute;inset:0;pointer-events:none;z-index:5;transition:background 0.3s;"></div>

    <!-- 己方舰队列阵 -->
    <div id="bt-player-formation" style="flex:1;display:flex;flex-direction:column;gap:10px;justify-content:center;z-index:2;max-width:44%;"></div>

    <!-- 战场中央动态交火指示与弹道轨迹层 -->
    <div id="bt-fx-zone" style="flex:0 0 110px;position:relative;pointer-events:none;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:6px;z-index:4;">
      <div id="bt-fx-icon" style="font-size:24px;transition:transform 0.2s;">⚡</div>
      <div id="bt-fx-label" style="font-size:12px;color:#93c5fd;font-weight:bold;text-align:center;transition:all 0.2s;">交火接触中</div>
      <!-- 动态弹道图层 -->
      <div id="bt-laser-layer" style="position:absolute;inset:0;pointer-events:none;"></div>
    </div>

    <!-- 敌方舰队列阵（支持点击锁定目标） -->
    <div id="bt-enemy-formation" style="flex:1;display:flex;flex-direction:column;gap:10px;justify-content:center;z-index:2;max-width:44%;"></div>
  `;
  root.appendChild(stage);

  // 3. 指挥官战术电容与 7 大指令按键板
  const cmdPanel = document.createElement('div');
  cmdPanel.style.cssText = 'background:rgba(0,0,0,0.4);padding:12px;border-radius:8px;border:1px solid rgba(124,215,255,0.2);';

  const energyBarBox = document.createElement('div');
  energyBarBox.style.cssText = 'margin-bottom:10px;display:flex;align-items:center;gap:12px;';
  energyBarBox.innerHTML = `
    <span style="font-size:12px;color:#94a3b8;min-width:90px;">⚡ 战术指令电容：</span>
    <div style="flex:1;height:10px;background:#1e293b;border-radius:5px;overflow:hidden;border:1px solid #334155;">
      <div id="bt-energy-fill" style="height:100%;width:50%;background:linear-gradient(90deg, #38bdf8, #818cf8);transition:width 0.2s;"></div>
    </div>
    <span id="bt-energy-num" style="font-size:12px;font-weight:bold;color:#7cd7ff;min-width:60px;">50 / 100</span>
  `;
  cmdPanel.appendChild(energyBarBox);

  // 指令按钮网格
  const btnGrid = document.createElement('div');
  btnGrid.style.cssText = 'display:grid;grid-template-columns:repeat(auto-fit, minmax(115px, 1fr));gap:8px;';

  for (const cmdKey in TACTICAL_COMMANDS) {
    const cmd = TACTICAL_COMMANDS[cmdKey];
    const b = document.createElement('button');
    b.id = `bt-cmd-${cmd.id}`;
    b.className = 'btn-action';
    b.style.cssText = 'min-height:52px;padding:6px 8px;border-radius:6px;border:1px solid #334155;background:rgba(124,215,255,0.08);color:#c8d4e0;cursor:pointer;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:2px;transition:all 0.15s;';
    b.title = cmd.desc;
    b.innerHTML = `
      <div style="font-weight:bold;font-size:13px;display:flex;align-items:center;gap:4px;">
        <span>${cmd.icon}</span><span>${cmd.name}</span>
      </div>
      <div style="font-size:11px;color:#94a3b8;">${cmd.costEnergy}⚡ · <span class="bt-cd-label">就绪</span></div>
    `;
    b.onclick = () => {
      const res = executeTacticalCommand(session, cmd.id);
      if (!res.ok) {
        showFloatingFx(res.reason, '#ff6b81', '⚠️');
      } else {
        showFloatingFx(cmd.name + '！', '#7cd7ff', cmd.icon);
        triggerSkillVisualFx(cmd.id);
      }
      renderView();
    };
    btnGrid.appendChild(b);
  }
  cmdPanel.appendChild(btnGrid);
  root.appendChild(cmdPanel);

  // 4. 实时战况通信记录区
  const logBox = document.createElement('div');
  logBox.style.cssText = 'background:rgba(0,0,0,0.55);border-radius:8px;padding:10px 14px;border:1px solid #1e293b;height:130px;overflow-y:auto;font-size:12px;line-height:1.6;font-family:monospace;';
  logBox.id = 'bt-log-box';
  root.appendChild(logBox);

  // 浮动特效提示
  function showFloatingFx(text, color = '#7cd7ff', icon = '⚡') {
    const fx = document.getElementById('bt-fx-label');
    const ic = document.getElementById('bt-fx-icon');
    if (fx) {
      fx.textContent = text;
      fx.style.color = color;
      fx.style.transform = 'scale(1.15)';
      setTimeout(() => { if (fx) fx.style.transform = 'scale(1.0)'; }, 350);
    }
    if (ic) {
      ic.textContent = icon;
      ic.style.transform = 'scale(1.3) rotate(15deg)';
      setTimeout(() => { if (ic) ic.style.transform = 'scale(1.0) rotate(0deg)'; }, 350);
    }
  }

  // 触发技能全屏或弹道视觉特效与音效
  function triggerSkillVisualFx(cmdId) {
    const flash = document.getElementById('bt-screen-flash');
    const laserLayer = document.getElementById('bt-laser-layer');

    if (cmdId === 'emp') {
      playWarp();
      if (flash) {
        flash.style.background = 'rgba(96, 165, 250, 0.4)';
        setTimeout(() => { if (flash) flash.style.background = 'transparent'; }, 400);
      }
    } else if (cmdId === 'torpedo') {
      playExplosion(true);
      if (laserLayer) {
        const torp = document.createElement('div');
        torp.style.cssText = 'position:absolute;top:50%;left:5%;font-size:20px;z-index:8;animation:torpedo-travel 0.8s ease-in-out forwards;';
        torp.textContent = '🚀💥';
        laserLayer.appendChild(torp);
        setTimeout(() => torp.remove(), 800);
      }
    } else if (cmdId === 'focus') {
      playLaser(true);
      if (flash) {
        flash.style.background = 'rgba(250, 204, 21, 0.2)';
        setTimeout(() => { if (flash) flash.style.background = 'transparent'; }, 300);
      }
    } else if (cmdId === 'shield') {
      playShield();
    } else if (cmdId === 'drones') {
      playLaser(false);
      if (laserLayer) {
        const drone = document.createElement('div');
        drone.style.cssText = 'position:absolute;z-index:8;animation:drone-flight 1.2s ease-in-out forwards;font-size:22px;';
        drone.textContent = '🐝🚀';
        laserLayer.appendChild(drone);
        setTimeout(() => drone.remove(), 1200);
      }
    } else if (cmdId === 'boarding') {
      playExplosion(false);
    } else if (cmdId === 'orbital_bombard') {
      playExplosion(true);
      if (flash) {
        flash.style.background = 'rgba(239, 68, 68, 0.45)';
        setTimeout(() => { if (flash) flash.style.background = 'transparent'; }, 500);
      }
      const stageEl = document.getElementById('bt-battle-stage');
      if (stageEl) {
        stageEl.classList.add('screen-shake');
        setTimeout(() => stageEl.classList.remove('screen-shake'), 400);
      }
    } else if (cmdId === 'overclock_repair') {
      playShield();
      if (flash) {
        flash.style.background = 'rgba(52, 211, 153, 0.25)';
        setTimeout(() => { if (flash) flash.style.background = 'transparent'; }, 400);
      }
    }
  }

  // 动态生成伤害跳字
  function spawnDamageNumber(targetEl, text, color = '#f87171') {
    if (!targetEl) return;
    const stageEl = document.getElementById('bt-battle-stage');
    if (!stageEl) return;

    const tRect = targetEl.getBoundingClientRect();
    const sRect = stageEl.getBoundingClientRect();
    const x = tRect.left - sRect.left + (tRect.width / 2) + (Math.random() * 20 - 10);
    const y = tRect.top - sRect.top + (Math.random() * 15);

    const dmgEl = document.createElement('div');
    dmgEl.className = 'floating-text-item';
    dmgEl.style.left = `${x}px`;
    dmgEl.style.top = `${y}px`;
    dmgEl.style.color = color;
    dmgEl.textContent = text;
    stageEl.appendChild(dmgEl);
    setTimeout(() => dmgEl.remove(), 900);
  }

  // 动态生成激光开火光束
  function spawnLaserTracer(fromPlayer = true) {
    const laserLayer = document.getElementById('bt-laser-layer');
    if (!laserLayer) return;

    const line = document.createElement('div');
    const y = Math.round(15 + Math.random() * 70);
    const color = fromPlayer ? 'linear-gradient(90deg, #38bdf8, #818cf8)' : 'linear-gradient(90deg, #f43f5e, #fbbf24)';
    const anim = fromPlayer ? 'laser-shoot-p2e 0.28s ease-out forwards' : 'laser-shoot-e2p 0.28s ease-out forwards';

    line.style.cssText = `position:absolute;top:${y}%;left:0;right:0;height:2px;background:${color};box-shadow:0 0 8px ${fromPlayer ? '#38bdf8' : '#f43f5e'};animation:${anim};pointer-events:none;`;
    laserLayer.appendChild(line);
    setTimeout(() => line.remove(), 280);
  }

  // 渲染双方战舰卡片
  function renderShips() {
    const pBox = document.getElementById('bt-player-formation');
    const eBox = document.getElementById('bt-enemy-formation');
    if (!pBox || !eBox) return;

    // 己方舰队列阵
    pBox.innerHTML = session.playerShips.map((s) => {
      const hullPct = Math.round((s.hull / s.hullMax) * 100);
      const shieldPct = Math.round((s.shield / s.shieldMax) * 100);
      const isLowHp = s.alive && hullPct <= 25;
      return `
        <div id="bt-player-${s.id}" class="${isLowHp ? 'ship-low-hp' : ''}" style="opacity:${s.alive ? 1 : 0.35};border-left:3px solid ${s.alive ? '#38bdf8' : '#64748b'};background:${s.alive ? 'rgba(56,189,248,0.06)' : 'rgba(0,0,0,0.2)'};padding:6px 8px;border-radius:0 6px 6px 0;transition:all 0.2s;">
          <div style="font-weight:bold;font-size:12px;color:${s.alive ? '#f1f5f9' : '#94a3b8'};display:flex;justify-content:space-between;align-items:center;">
            <span>${s.roleIcon || '🚀'} ${esc(s.name)}</span>
            <span style="font-size:11px;color:${s.alive ? '#7cd7ff' : '#64748b'};">${s.alive ? esc(s.roleName) : '解体'}</span>
          </div>
          <!-- 护盾条与数值 -->
          <div style="display:flex;justify-content:space-between;font-size:10px;color:#38bdf8;margin-top:2px;">
            <span>护盾偏转</span><span>${s.shield} / ${s.shieldMax}</span>
          </div>
          <div style="height:4px;background:#1e293b;border-radius:2px;overflow:hidden;margin-bottom:3px;">
            <div style="height:100%;width:${shieldPct}%;background:#38bdf8;transition:width 0.25s;"></div>
          </div>
          <!-- 装甲结构条与数值 -->
          <div style="display:flex;justify-content:space-between;font-size:10px;color:${hullPct > 35 ? '#34d399' : '#f87171'};">
            <span>装甲船体</span><span>${s.hull} / ${s.hullMax}</span>
          </div>
          <div style="height:4px;background:#1e293b;border-radius:2px;overflow:hidden;">
            <div style="height:100%;width:${hullPct}%;background:${hullPct > 35 ? '#10b981' : '#ef4444'};transition:width 0.25s;"></div>
          </div>
        </div>
      `;
    }).join('');

    // 敌方舰队列阵（支持点击锁定集火）
    eBox.innerHTML = session.enemyShips.map((s) => {
      const hullPct = Math.round((s.hull / s.hullMax) * 100);
      const shieldPct = Math.round((s.shield / s.shieldMax) * 100);
      const isTargeted = session.designatedTargetId === s.id && s.alive;
      const isLowHp = s.alive && hullPct <= 25;
      return `
        <div id="bt-enemy-${s.id}" data-enemy-id="${s.id}" class="${isTargeted ? 'ship-targeted' : isLowHp ? 'ship-low-hp' : ''}" style="cursor:${s.alive ? 'pointer' : 'default'};opacity:${s.alive ? 1 : 0.35};border-right:3px solid ${isTargeted ? '#facc15' : s.alive ? '#f43f5e' : '#64748b'};background:${isTargeted ? 'rgba(250,204,21,0.15)' : s.alive ? 'rgba(244,63,94,0.06)' : 'rgba(0,0,0,0.2)'};padding:6px 8px;border-radius:6px 0 0 6px;text-align:right;transition:all 0.2s;" title="${s.alive ? '点击将此舰锁定为首要集火目标' : ''}">
          <div style="font-weight:bold;font-size:12px;color:${isTargeted ? '#facc15' : s.alive ? '#f1f5f9' : '#94a3b8'};display:flex;justify-content:space-between;align-items:center;">
            <span style="font-size:11px;color:${isTargeted ? '#facc15' : '#f43f5e'};">${isTargeted ? '🎯[集火锁定]' : s.alive ? esc(s.roleName) : '解体'}</span>
            <span>${esc(s.name)} ${s.roleIcon || '💥'}</span>
          </div>
          <!-- 护盾条与数值 -->
          <div style="display:flex;justify-content:space-between;font-size:10px;color:#f43f5e;margin-top:2px;">
            <span>${s.shield} / ${s.shieldMax}</span><span>护盾偏转</span>
          </div>
          <div style="height:4px;background:#1e293b;border-radius:2px;overflow:hidden;margin-bottom:3px;">
            <div style="height:100%;width:${shieldPct}%;background:#f43f5e;float:right;transition:width 0.25s;"></div>
          </div>
          <!-- 装甲结构条与数值 -->
          <div style="display:flex;justify-content:space-between;font-size:10px;color:${hullPct > 35 ? '#fbbf24' : '#ef4444'};clear:both;">
            <span>${s.hull} / ${s.hullMax}</span><span>装甲船体</span>
          </div>
          <div style="height:4px;background:#1e293b;border-radius:2px;overflow:hidden;">
            <div style="height:100%;width:${hullPct}%;background:${hullPct > 35 ? '#f59e0b' : '#ef4444'};float:right;transition:width 0.25s;"></div>
          </div>
        </div>
      `;
    }).join('');
  }

  // 绑定敌舰容器的事件委托（无论 innerHTML 如何重绘都不会漏掉任何点击）
  setTimeout(() => {
    const eBox = document.getElementById('bt-enemy-formation');
    if (eBox) {
      eBox.onclick = (e) => {
        const card = e.target.closest('[data-enemy-id]');
        if (!card) return;
        const id = card.getAttribute('data-enemy-id');
        const s = session.enemyShips.find((x) => x.id === id);
        if (s && s.alive) {
          session.designatedTargetId = session.designatedTargetId === s.id ? null : s.id;
          if (session.designatedTargetId) {
            showFloatingFx(`已锁定【${s.name}】！`, '#facc15', '🎯');
            session.logs.unshift({ text: `🎯 指挥官下达战术标定：全军集火锁定目标【${s.name}】！`, type: 'skill' });
          } else {
            showFloatingFx('已解除集火锁定', '#94a3b8', '⚡');
          }
          renderShips();
        }
      };
    }
  }, 30);

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
        else if (l.type === 'emp') col = '#60a5fa';
        return `<div style="color:${col};margin-bottom:2px;">${esc(l.text)}</div>`;
      }).join('');
    }

    // 终局弹窗
    if (session.ended) {
      stopLoop();
      showResultModal();
    }
  }

  // 展现升级版战后战绩统计报告（AAR）
  function showResultModal() {
    const report = getBattleReport(session);
    const isWin = report.winner === 'player';
    if (isWin) {
      playVictory();
    } else {
      playExplosion(true);
    }
    const resDiv = document.createElement('div');
    resDiv.style.cssText = 'padding:16px;text-align:center;color:#c8d4e0;max-height:75vh;overflow-y:auto;';

    resDiv.innerHTML = `
      <div style="font-size:42px;margin-bottom:8px;">${isWin ? '🏆' : '💥'}</div>
      <div style="display:inline-block;padding:2px 14px;border-radius:12px;font-weight:bold;font-size:14px;margin-bottom:8px;background:${isWin ? 'rgba(52,211,153,0.2)' : 'rgba(239,68,68,0.2)'};color:${isWin ? '#34d399' : '#f87171'};border:1px solid ${isWin ? '#34d399' : '#f87171'};">
        战术评级：${report.rank} 级 · ${isWin ? (report.rank === 'S' ? '完美歼灭' : '辉煌大捷') : '战损撤退'}
      </div>
      <p style="font-size:13px;color:#94a3b8;line-height:1.6;margin-bottom:14px;">
        ${isWin ? '我方舰队在指挥官的精准战术部署下，成功瓦解敌方战术战斗群，全歼目标！' : '敌方火力过于凶悍，我方各舰船体受损过半，已按战术条令脱离接触。'}
      </p>

      <!-- MVP 旗舰勋章 -->
      ${report.mvp ? `
        <div style="background:linear-gradient(135deg, rgba(250,204,21,0.15), rgba(56,189,248,0.1));padding:10px 14px;border-radius:8px;border:1px solid #facc15;margin-bottom:14px;text-align:left;display:flex;justify-content:space-between;align-items:center;">
          <div>
            <div style="font-size:11px;color:#facc15;font-weight:bold;">⭐ 本场战斗 MVP 旗舰</div>
            <div style="font-size:15px;font-weight:bold;color:#f1f5f9;margin-top:2px;">${esc(report.mvp.name)}</div>
          </div>
          <div style="text-align:right;font-size:12px;color:#c8d4e0;">
            <div>累计输出：<b style="color:#7cd7ff;">${fmtNum(report.mvp.damageDealt || 0)}</b></div>
            <div>击沉战果：<b style="color:#f87171;">${report.mvp.kills || 0}</b> 艘</div>
          </div>
        </div>
      ` : ''}

      <!-- 战斗概况与各舰战绩表 -->
      <div style="background:rgba(0,0,0,0.35);padding:12px;border-radius:8px;font-size:12px;margin-bottom:16px;text-align:left;line-height:1.8;border:1px solid #1e293b;">
        <div style="display:flex;justify-content:space-between;margin-bottom:6px;border-bottom:1px solid #334155;padding-bottom:4px;">
          <span>作战耗时：<b>${report.timeSec} 秒</b></span>
          <span>我方存活：<b>${session.playerShips.length - report.playerLost} / ${session.playerShips.length}</b></span>
          <span>击毁敌舰：<b>${report.enemyKilled} / ${session.enemyShips.length}</b></span>
        </div>
        <div style="font-weight:bold;color:#7cd7ff;margin-bottom:4px;">📊 编队单舰作战统计：</div>
        <div style="max-height:140px;overflow-y:auto;">
          ${session.playerShips.map((s) => `
            <div style="display:flex;justify-content:space-between;padding:3px 0;font-size:11px;color:#94a3b8;border-bottom:1px dashed #1e293b;">
              <span style="color:${s.alive ? '#f1f5f9' : '#64748b'};">${s.roleIcon || '🚀'} ${esc(s.name)} [${s.alive ? '存活' : '击毁'}]</span>
              <span>输出 <b>${fmtNum(s.damageDealt || 0)}</b> · 承伤 ${fmtNum(s.damageTaken || 0)} · 击沉 ${s.kills || 0}</span>
            </div>
          `).join('')}
        </div>
        ${isWin ? '<div style="color:#34d399;margin-top:8px;font-weight:bold;">🎖️ 缴获与战功：+800 军功经验 · +25,000 Ascoin · 物资战利品已入库</div>' : ''}
      </div>

      <button id="bt-close-final" style="width:100%;min-height:44px;border-radius:6px;border:none;background:#7cd7ff;color:#050814;font-weight:bold;font-size:14px;cursor:pointer;">返回指挥中心</button>
    `;

    // 直接在元素上绑定点击事件，无需等待 setTimeout，零延迟更稳固
    const btnClose = resDiv.querySelector('#bt-close-final');
    if (btnClose) {
      btnClose.onclick = () => {
        closeModal();
        if (typeof onBattleEnd === 'function') onBattleEnd({ ...session, win: isWin });
      };
    }

    openModal({ title: isWin ? '胜利结算战报' : '战损评估报告', body: resDiv });
  }

  // 战斗推演定时器循环（加入动态激光光束与跳字生成）
  function startLoop() {
    stopLoop();
    timer = setInterval(() => {
      // 自动战斗模式：有能量就自动释放可用技能
      if (autoBattle && !session.ended) {
        for (const k of ['orbital_bombard', 'focus', 'torpedo', 'emp', 'boarding', 'shield', 'overclock_repair', 'drones']) {
          if (session.energy >= TACTICAL_COMMANDS[k].costEnergy && session.cooldowns[k] <= 0) {
            executeTacticalCommand(session, k);
            triggerSkillVisualFx(k);
            break;
          }
        }
      }

      // 执行交火运算步进
      tickBattle(session, 0.5 * timeScale);

      // 若双方均有存活舰艇，随机生成弹道视觉效果与跳字
      const aliveP = session.playerShips.filter((s) => s.alive);
      const aliveE = session.enemyShips.filter((s) => s.alive);

      if (aliveP.length > 0 && aliveE.length > 0) {
        // 己方激光射击动画
        spawnLaserTracer(true);
        // 敌方激光反击动画
        if (Math.random() < 0.8) {
          setTimeout(() => spawnLaserTracer(false), 120);
        }

        // 随机在目标上方冒出跳字与音效
        if (session.logs.length > 0) {
          const latestLog = session.logs[0];
          if (latestLog.type === 'crit') {
            playExplosion(false);
            root.classList.add('screen-shake');
            setTimeout(() => root.classList.remove('screen-shake'), 350);
            const eTarget = (session.designatedTargetId && aliveE.find((x) => x.id === session.designatedTargetId)) || aliveE[0];
            const el = document.getElementById(`bt-enemy-${eTarget.id}`);
            if (el) spawnDamageNumber(el, '💥 CRIT!', '#facc15');
          } else if (latestLog.type === 'fire') {
            playLaser(false);
            const eTarget = aliveE[Math.floor(Math.random() * aliveE.length)];
            const el = document.getElementById(`bt-enemy-${eTarget.id}`);
            if (el) spawnDamageNumber(el, `-${Math.round(20 + Math.random() * 40)}`, '#38bdf8');
          } else if (latestLog.type === 'enemy-fire') {
            playLaser(true);
            const pTarget = aliveP[Math.floor(Math.random() * aliveP.length)];
            const el = document.getElementById(`bt-player-${pTarget.id}`);
            if (el) spawnDamageNumber(el, `-${Math.round(15 + Math.random() * 30)}`, '#f43f5e');
          }
        }
      }

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
        btnAuto.textContent = `🤖 自动战术: ${autoBattle ? '开' : '关'}`;
        btnAuto.style.background = autoBattle ? 'rgba(52,211,153,0.2)' : 'rgba(255,255,255,0.06)';
        btnAuto.style.color = autoBattle ? '#34d399' : '#cbd5e1';
      };
    }
  }, 40);

  renderView();
  startLoop();

  // 若作为弹窗打开
  if (typeof openModal === 'function') {
    openModal({ title: `战术交战：${session.title}`, body: root, onClose: () => stopLoop() });
  }

  return { root, session, stopLoop };
}

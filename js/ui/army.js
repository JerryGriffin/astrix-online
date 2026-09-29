// 军队系统用户界面（Astrix v0.2.0）
// 纯原生 ES 模块，深空玻璃拟态风格，移动端与 PC 端自适应（点击区 >= 44px）

import { currentAccount, getPlanetInstance } from '../core/state.js?v=21.3';
import {
  ARMY_BLUEPRINTS, ARMY_BP_BY_ID, ARMY_PART_BY_ID, armyBpPartNeeds, armyBpMaterialNeeds
} from '../data/army_parts.js?v=21.3';
import {
  listArmies, ensureArmies, armyStatsOf, stationedArmyPower, toggleStationed, disbandArmy,
  getArmyPartStock, canAssembleArmy, startArmyAssemble, cancelArmyAssemble
} from '../core/army.js?v=21.3';
import { fmtNum } from '../core/format.js?v=21.3';

function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
}

export function renderArmy(root, ctx) {
  const { openModal, closeModal, planetCode } = ctx;
  const acc = currentAccount();
  const inst = getPlanetInstance(planetCode || (acc && acc.homePlanetCode) || 'syl');

  if (!acc || !inst) {
    root.innerHTML = '<div class="glass" style="padding:24px;text-align:center;">星球或账号数据缺失。</div>';
    return;
  }

  ensureArmies(acc);
  let activeTab = 'blueprints'; // 'blueprints' | 'units'

  function refresh() {
    renderView();
  }

  function renderView() {
    root.innerHTML = '';
    const container = document.createElement('div');
    container.className = 'army-container';
    container.style.cssText = 'padding:14px;max-width:960px;margin:0 auto;color:#c8d4e0;';

    // 1. 顶部战力与驻防概况
    const totalPower = stationedArmyPower(acc, inst.code || planetCode);
    const armies = listArmies(acc);
    const stationedCount = armies.filter((a) => a.stationed !== false).length;
    const hasCommandTech = Array.isArray(acc.tech) && acc.tech.includes('t_m5');

    const header = document.createElement('div');
    header.className = 'glass';
    header.style.cssText = 'padding:16px;border-radius:8px;margin-bottom:14px;display:flex;flex-wrap:wrap;gap:16px;justify-content:space-between;align-items:center;';

    const left = document.createElement('div');
    left.innerHTML = `
      <div style="font-size:17px;font-weight:bold;color:#7cd7ff;display:flex;align-items:center;gap:8px;">
        <span>🪖 行星防卫与陆战部队</span>
      </div>
      <div style="font-size:12px;color:#94a3b8;margin-top:6px;line-height:1.5;">
        现役编成：<b style="color:#f1f5f9;">${armies.length}</b> 个营（驻防中 <b style="color:#9FE1CB;">${stationedCount}</b> 个）
        <span style="margin:0 6px;">·</span>
        地面要塞防卫战力：<b style="color:#9FE1CB;font-size:14px;">+${fmtNum(totalPower)}</b>
      </div>
    `;

    const nav = document.createElement('div');
    nav.style.cssText = 'display:flex;gap:8px;';

    const btnBp = document.createElement('button');
    btnBp.className = 'btn-action' + (activeTab === 'blueprints' ? ' active' : '');
    btnBp.style.cssText = `padding:8px 16px;min-height:44px;border:1px solid #345;border-radius:6px;background:${activeTab === 'blueprints' ? 'rgba(124,215,255,0.2)' : 'rgba(255,255,255,0.04)'};color:#c8d4e0;cursor:pointer;font-size:13px;font-weight:bold;`;
    btnBp.textContent = '📋 编制蓝图与整编';
    btnBp.onclick = () => { activeTab = 'blueprints'; refresh(); };

    const btnUnits = document.createElement('button');
    btnUnits.className = 'btn-action' + (activeTab === 'units' ? ' active' : '');
    btnUnits.style.cssText = `padding:8px 16px;min-height:44px;border:1px solid #345;border-radius:6px;background:${activeTab === 'units' ? 'rgba(124,215,255,0.2)' : 'rgba(255,255,255,0.04)'};color:#c8d4e0;cursor:pointer;font-size:13px;font-weight:bold;`;
    btnUnits.textContent = `🎖️ 现役部队 (${armies.length})`;
    btnUnits.onclick = () => { activeTab = 'units'; refresh(); };

    nav.appendChild(btnBp);
    nav.appendChild(btnUnits);

    header.appendChild(left);
    header.appendChild(nav);
    container.appendChild(header);

    // 科技未就绪警示
    if (!hasCommandTech) {
      const tip = document.createElement('div');
      tip.style.cssText = 'padding:10px 14px;border-radius:6px;background:rgba(255,196,107,0.12);border:1px solid #ffc46b50;color:#ffc46b;font-size:12px;margin-bottom:14px;display:flex;align-items:center;gap:8px;';
      tip.innerHTML = '⚠️ <b>战略提示</b>：军事科技「军队指挥」尚未解锁。军事部件已可在制造车间批量试制，但成建制组装成军需要先在科研面板研发「军队指挥」。';
      container.appendChild(tip);
    }

    // 2. 正在推进的组装线（如果存在）
    const buildLines = acc.armyBuildLines || [];
    if (buildLines.length > 0) {
      const linesCard = document.createElement('div');
      linesCard.className = 'glass';
      linesCard.style.cssText = 'padding:14px;border-radius:8px;margin-bottom:14px;border:1px solid rgba(124,215,255,0.25);';
      linesCard.innerHTML = '<div style="font-weight:bold;font-size:14px;color:#7cd7ff;margin-bottom:10px;">⚙️ 部队整编产线</div>';

      for (const line of buildLines) {
        const row = document.createElement('div');
        row.style.cssText = 'display:flex;flex-wrap:wrap;gap:10px;align-items:center;justify-content:space-between;padding:8px;background:rgba(0,0,0,0.25);border-radius:6px;margin-bottom:6px;';
        const pct = Math.min(100, Math.floor((line.progress || 0) * 100));

        row.innerHTML = `
          <div style="flex:1;min-width:200px;">
            <div style="font-size:13px;font-weight:bold;color:#f1f5f9;">${escapeHtml(line.nameCn)}</div>
            <div style="font-size:11px;color:#94a3b8;margin-top:2px;">指派组装工人：${line.workers} 人 · 进度 ${pct}%</div>
            <div style="width:100%;height:6px;background:#1e293b;border-radius:3px;margin-top:6px;overflow:hidden;">
              <div style="width:${pct}%;height:100%;background:#9FE1CB;transition:width 0.3s;"></div>
            </div>
          </div>
        `;

        const btnCancel = document.createElement('button');
        btnCancel.style.cssText = 'min-height:44px;padding:6px 14px;border:1px solid #f0959550;background:rgba(240,149,149,0.12);color:#f09595;border-radius:6px;cursor:pointer;font-size:12px;';
        btnCancel.textContent = '取消退件';
        btnCancel.onclick = () => {
          const res = cancelArmyAssemble(acc, inst, line.id);
          if (res.ok) {
            refresh();
          } else {
            alert(res.reason || '取消失败');
          }
        };
        row.appendChild(btnCancel);
        linesCard.appendChild(row);
      }
      container.appendChild(linesCard);
    }

    // 3. 内容区：蓝图与现役列表分发
    if (activeTab === 'blueprints') {
      renderBlueprints(container);
    } else {
      renderUnits(container);
    }

    root.appendChild(container);
  }

  // --------------------------------------------------------------------------
  // 蓝图列表与整编
  // --------------------------------------------------------------------------
  function renderBlueprints(parent) {
    const grid = document.createElement('div');
    grid.style.cssText = 'display:grid;grid-template-columns:repeat(auto-fill, minmax(290px, 1fr));gap:14px;';

    for (const bp of ARMY_BLUEPRINTS) {
      const card = document.createElement('div');
      card.className = 'glass';
      card.style.cssText = 'padding:14px;border-radius:8px;display:flex;flex-direction:column;justify-content:space-between;border:1px solid rgba(124,215,255,0.15);';

      const stats = armyStatsOf(bp.id);
      const needs = armyBpPartNeeds(bp.id);
      const canDo = canAssembleArmy(acc, inst, bp.id);

      // 部件满足状态统计
      const partStatusList = [];
      for (const pid in needs) {
        const p = ARMY_PART_BY_ID[pid];
        const needCount = needs[pid];
        const haveCount = getArmyPartStock(inst, pid);
        const ok = haveCount >= needCount;
        partStatusList.push({
          name: p ? p.nameCn : pid,
          need: needCount,
          have: haveCount,
          ok,
        });
      }

      const top = document.createElement('div');
      top.innerHTML = `
        <div style="font-size:16px;font-weight:bold;color:#f1f5f9;margin-bottom:4px;">${escapeHtml(bp.nameCn)}</div>
        <div style="font-size:12px;color:#94a3b8;line-height:1.4;margin-bottom:8px;">${escapeHtml(bp.desc)}</div>
        <div style="background:rgba(0,0,0,0.3);padding:8px;border-radius:6px;font-size:12px;margin-bottom:8px;line-height:1.6;">
          <div style="display:flex;justify-content:space-between;">
            <span>⚔️ 火力: <b style="color:#f09595">${stats.atk}</b></span>
            <span>🛡️ 防护: <b style="color:#7cd7ff">${stats.def}</b></span>
            <span>⚡ 机动: <b style="color:#ffc46b">${stats.speed}</b></span>
          </div>
          <div style="margin-top:4px;border-top:1px dashed #334155;padding-top:4px;display:flex;justify-content:space-between;">
            <span>综合战力: <b style="color:#9FE1CB;font-size:13px;">${fmtNum(stats.power)}</b></span>
            <span style="color:#94a3b8;">工作量: ${fmtNum(bp.buildWork)}</span>
          </div>
        </div>
        <div style="font-size:12px;margin-bottom:10px;">
          <div style="color:#94a3b8;margin-bottom:4px;">所需军事装备部件：</div>
          <div style="display:flex;flex-wrap:wrap;gap:4px;">
            ${partStatusList.map((it) => (
              `<span style="padding:2px 6px;border-radius:4px;font-size:11px;background:${it.ok ? 'rgba(159,225,203,0.1)' : 'rgba(240,149,149,0.12)'};border:1px solid ${it.ok ? '#9FE1CB40' : '#f0959540'};color:${it.ok ? '#9FE1CB' : '#f09595'};">
                ${escapeHtml(it.name)} ×${it.need} (${it.have})
              </span>`
            )).join('')}
          </div>
        </div>
      `;

      const btnAssemble = document.createElement('button');
      btnAssemble.className = 'btn-action';
      btnAssemble.style.cssText = `width:100%;min-height:44px;border-radius:6px;font-size:13px;font-weight:bold;cursor:${canDo.ok ? 'pointer' : 'not-allowed'};border:1px solid ${canDo.ok ? '#7cd7ff50' : '#334155'};background:${canDo.ok ? 'rgba(124,215,255,0.18)' : 'rgba(255,255,255,0.04)'};color:${canDo.ok ? '#7cd7ff' : '#64748b'};`;
      btnAssemble.textContent = canDo.ok ? '🔨 开启整编产线' : (canDo.reason || '条件不足');
      btnAssemble.disabled = !canDo.ok;
      btnAssemble.onclick = () => {
        if (canDo.ok) openAssembleModal(bp);
      };

      card.appendChild(top);
      card.appendChild(btnAssemble);
      grid.appendChild(card);
    }

    parent.appendChild(grid);
  }

  // --------------------------------------------------------------------------
  // 现役部队管理
  // --------------------------------------------------------------------------
  function renderUnits(parent) {
    const armies = listArmies(acc);
    if (armies.length === 0) {
      parent.innerHTML = `
        <div class="glass" style="padding:32px;text-align:center;color:#64748b;">
          当前尚无现役地面部队编制。<br>
          可在制造车间生产武器装甲后，进入「编制蓝图」进行组建整编。
        </div>
      `;
      return;
    }

    const list = document.createElement('div');
    list.style.cssText = 'display:flex;flex-direction:column;gap:10px;';

    for (const a of armies) {
      const card = document.createElement('div');
      card.className = 'glass';
      card.style.cssText = 'padding:14px;border-radius:8px;display:flex;flex-wrap:wrap;justify-content:space-between;align-items:center;gap:12px;border:1px solid rgba(124,215,255,0.15);';

      const stats = a.stats || {};
      const isStationed = a.stationed !== false;

      const info = document.createElement('div');
      info.style.cssText = 'flex:1;min-width:240px;';
      info.innerHTML = `
        <div style="display:flex;align-items:center;gap:8px;margin-bottom:4px;">
          <span style="font-size:15px;font-weight:bold;color:#f1f5f9;">${escapeHtml(a.nameCn)}</span>
          <span style="font-size:11px;padding:2px 6px;border-radius:4px;background:${isStationed ? 'rgba(159,225,203,0.15)' : 'rgba(255,255,255,0.06)'};color:${isStationed ? '#9FE1CB' : '#94a3b8'};border:1px solid ${isStationed ? '#9FE1CB50' : '#475569'};">
            ${isStationed ? '🛡️ 驻防本星' : '⚡ 机动备勤'}
          </span>
        </div>
        <div style="font-size:12px;color:#94a3b8;display:flex;gap:14px;margin-top:4px;">
          <span>火力: <b style="color:#f09595">${stats.atk || 0}</b></span>
          <span>防护: <b style="color:#7cd7ff">${stats.def || 0}</b></span>
          <span>机动: <b style="color:#ffc46b">${stats.speed || 0}</b></span>
          <span>综合战力: <b style="color:#9FE1CB">${fmtNum(stats.power || 0)}</b></span>
        </div>
      `;

      const actions = document.createElement('div');
      actions.style.cssText = 'display:flex;gap:8px;align-items:center;';

      // 驻防状态切换
      const btnToggle = document.createElement('button');
      btnToggle.className = 'btn-action';
      btnToggle.style.cssText = `padding:6px 12px;min-height:44px;border-radius:6px;font-size:12px;cursor:pointer;border:1px solid ${isStationed ? '#7cd7ff50' : '#9FE1CB50'};background:${isStationed ? 'rgba(124,215,255,0.1)' : 'rgba(159,225,203,0.12)'};color:${isStationed ? '#7cd7ff' : '#9FE1CB'};`;
      btnToggle.textContent = isStationed ? '转入机动备勤' : '驻防本星防线';
      btnToggle.onclick = () => {
        toggleStationed(acc, a.id);
        refresh();
      };

      // 解散编制
      const btnDisband = document.createElement('button');
      btnDisband.className = 'btn-action';
      btnDisband.style.cssText = 'padding:6px 12px;min-height:44px;border:1px solid #f0959540;background:rgba(240,149,149,0.08);color:#f09595;border-radius:6px;cursor:pointer;font-size:12px;';
      btnDisband.textContent = '解散编制';
      btnDisband.onclick = () => {
        if (confirm(`确定要解散部队「${a.nameCn}」吗？部分部件将返还归入装备库。`)) {
          disbandArmy(acc, inst, a.id);
          refresh();
        }
      };

      actions.appendChild(btnToggle);
      actions.appendChild(btnDisband);

      card.appendChild(info);
      card.appendChild(actions);
      list.appendChild(card);
    }

    parent.appendChild(list);
  }

  // --------------------------------------------------------------------------
  // 组建整编弹窗
  // --------------------------------------------------------------------------
  function openAssembleModal(bp) {
    const div = document.createElement('div');
    div.innerHTML = `
      <p style="color:#94a3b8;font-size:13px;line-height:1.5;margin-bottom:12px;">
        为「${escapeHtml(bp.nameCn)}」建立整编产线。系统将从母星装备库扣齐相应军事部件并投入组装人力。
      </p>
      <div style="margin-bottom:12px;">
        <label style="font-size:12px;color:#94a3b8;display:block;margin-bottom:4px;">指派组装工人（默认 10 人）：</label>
        <input type="number" id="army-workers-inp" min="1" max="500" value="10"
               style="width:100%;min-height:44px;box-sizing:border-box;background:#0b101c;border:1px solid #22354c;color:#c8d4e0;border-radius:6px;padding:8px 12px;font-size:14px;">
      </div>
      <div id="army-assemble-err" style="color:#ff6b81;font-size:12px;margin-bottom:10px;"></div>
      <button id="btn-confirm-assemble" style="width:100%;min-height:44px;background:#7cd7ff;color:#0b101c;font-weight:bold;border:none;border-radius:6px;cursor:pointer;">确认下达整编指令</button>
    `;

    openModal({ title: `整编部队：${bp.nameCn}`, body: div });

    setTimeout(() => {
      const inp = document.getElementById('army-workers-inp');
      const err = document.getElementById('army-assemble-err');
      const btn = document.getElementById('btn-confirm-assemble');

      if (btn && inp) {
        btn.onclick = () => {
          const w = parseInt(inp.value, 10) || 10;
          const res = startArmyAssemble(acc, inst, bp.id, w);
          if (!res.ok) {
            err.textContent = res.reason || '组建失败';
          } else {
            closeModal();
            refresh();
          }
        };
      }
    }, 50);
  }

  refresh();

  // 定时刷新进度条（当有部队整编产线时）
  if (root._armyTimer) { clearInterval(root._armyTimer); root._armyTimer = null; }
  let prevHadLines = (acc.armyBuildLines || []).length > 0;
  root._armyTimer = setInterval(() => {
    if (!root.isConnected && !(typeof document !== 'undefined' && document.body && document.body.contains(root))) {
      clearInterval(root._armyTimer);
      root._armyTimer = null;
      return;
    }
    const ae = (typeof document !== 'undefined' && document.activeElement) || null;
    if (ae && typeof root.contains === 'function' && root.contains(ae)) return; // 正在操作输入框，避免打断
    const lines = acc.armyBuildLines || [];
    const had = lines.length > 0;
    if (had || prevHadLines) {
      prevHadLines = had;
      refresh();
    }
  }, 1000);
}

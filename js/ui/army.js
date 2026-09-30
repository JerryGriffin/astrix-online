// 军队页（Astrix v0.2.4）
// 「单兵武器 t_m1」研究前军队 tab 也会显示（v0.2.4：按钮常驻，页内提示需解锁的科技）：
//   * 子导航「我的军队 | 设计与建造」（UI 与舰队页同构，fleet-subnav 样式复用）；
//   * 三张默认蓝图（游骑兵 / 铁壁 / 雷霆）随军事科技逐级解锁；「设计与建造」可像
//     钢铁雄心的编制设计器一样自组兵种（选框架/机动/武器/装甲/支援 + 材料，编制点校验）；
//   * 部件在制造车间按生产线生产（可自选材料，不同材料造出的军队数值不同）；
//   * 组装线由「军营」驱动（无工位、不占人力，每座军营 60 点固定建造人力）；
//     **装备未齐不能开线**（v0.2.4 取消「先挂着」）；
//   * 「训练场」建成后可在建制军队里训练：损耗 2 件装备 → +2 攻/+2 防 + 15 经验；
//   * 每支军队人数在 100 人上下（由框架数决定），列内展示。
// 本页由 planet.js 的 showPanel 动态接入，异常只影响本 tab。

import {
  ARMY_BLUEPRINTS, ARMY_PART_BY_ID, ARMY_SLOT_BY_CAT, ARMY_PART_COST,
  armyCapOf, armyBpPartNeeds, armyBpMaterialNeeds,
} from '../data/army_parts.js?v=20.16';
import {
  armyStatsOfBp, armyPowerOf, armyPowerOfInstance, armyBuildCheck, listArmies, disbandArmy,
  getArmyBp, armyEffStats, armyPartMaterialOptions, trainArmy, cancelTraining, ARMY_LABOR_PER_BARRACKS,
  attachShipToArmy, detachShipFromArmy, shipEligibleForArmy, shipArmyOf, ARMY_SHIP_TECH,
} from '../core/army.js?v=20.16';
import { addLine, removeLine } from '../core/production.js?v=20.16';
import { fmtNum, fmtTime } from '../core/format.js?v=20.16';
import { currentAccount, getBuildingCounts } from '../core/state.js?v=20.16';
import { TECH_BY_ID } from '../data/techs.js?v=20.16';

const ARMY_TECH = 't_m1';
const ARMY_CATS = ['frame', 'mobility', 'weapon', 'armor', 'support'];
const ARMY_CAT_NAMES = { frame: '框架', mobility: '机动', weapon: '武器', armor: '装甲', support: '支援' };

function techNameCn(id) {
  const t = TECH_BY_ID[id];
  return (t && t.nameCn) || id;
}

function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = String(text);
  return e;
}

function countPartsOwned(inst, partId) {
  if (!inst || !inst.equipment) return 0;
  let n = 0;
  for (const key in inst.equipment) {
    const e = inst.equipment[key];
    if (e && e.partId === partId) n += Number(e.count) || 0;
  }
  return n;
}

/** 蓝图是否已可用：默认蓝图看 tech 字段；自定义蓝图看全部部件的科技是否研究齐 */
function bpUnlockedOf(bp, techSet) {
  if (!bp) return false;
  if (bp.tech) return techSet.has(bp.tech);
  for (const it of (bp.parts || [])) {
    const p = ARMY_PART_BY_ID[it.id];
    if (p && p.tech && !techSet.has(p.tech)) return false;
  }
  return (bp.parts || []).length > 0;
}

/** 自定义蓝图组装工作量 = Σ部件工作量 ×1.25 + 500（与默认蓝图的口径同量级） */
function customBuildWork(parts) {
  let sum = 0;
  for (const it of (parts || [])) {
    const p = ARMY_PART_BY_ID[it.id];
    if (p) sum += (Number(p.work) || 0) * (Number(it.count) || 0);
  }
  return Math.round(sum * 1.25) + 500;
}

export function renderArmyPage(root, ctx) {
  ctx = ctx || {};
  const acc = ctx.account || currentAccount();
  const inst = ctx.planet || null;
  root.innerHTML = '';
  root.appendChild(el('div', 'page-title', '军队'));

  const techSet = new Set((acc && Array.isArray(acc.tech)) ? acc.tech : []);

  // —— 门禁：单兵武器科技。v0.2.4：军队 tab 恒显示，未解锁只提示（不再藏按钮）——
  if (!techSet.has(ARMY_TECH)) {
    const tip = el('div', 'muted');
    tip.style.padding = '14px 4px';
    tip.textContent = '军队系统尚未解锁：在科研「设施」分类研究「基础军用装备 M1」（前置：已建成军营）即可列装基础步兵'
      + '（军事部件在制造车间按生产线生产，进装备栏；后续研究 高级军用装备 M2 / 超级军用装备 M3 解锁更重型的兵种与部件，'
      + 'M3 还可将飞船编入军队、大幅提升部队数值）。';
    root.appendChild(tip);
    return;
  }

  // —— 子导航（与舰队页同构）：容器上记 _armySub，跨重绘保留 ——
  const subNav = el('div', 'fleet-subnav');
  const subContent = el('div', 'fleet-subcontent');
  root.appendChild(subNav);
  root.appendChild(subContent);
  const defs = [{ key: 'troops', label: '我的军队' }, { key: 'design', label: '设计与建造' }];
  const btns = {};
  defs.forEach((d) => {
    const b = el('button', 'fleet-subnav-btn', d.label);
    b.addEventListener('click', () => {
      root._armySub = d.key;
      selectSub(d.key);
    });
    btns[d.key] = b;
    subNav.appendChild(b);
  });
  function selectSub(k) {
    Object.entries(btns).forEach(([kk, b]) => b.classList.toggle('active', kk === k));
    subContent.innerHTML = '';
    if (k === 'design') {
      renderArmyDesigner(subContent, root, ctx, techSet);
    } else {
      renderTroops(subContent, root, ctx, techSet);
    }
  }
  selectSub(root._armySub === 'design' ? 'design' : 'troops');

  // 每秒轻刷新（进度条与缺件状态）。守卫不能用 root.isConnected ——
  // planet.js 切 tab 复用同一个 contentInner，isConnected 恒 true，
  // 旧定时器会把军队页重绘回去盖掉新 tab（v0.2.0 冒烟抓到）。改为检查本页标记。
  // v0.2.4：设计子页不自动重绘（避免清掉正在编辑的编制）。
  // v0.2.6：先清旧定时器再建新，避免每次重绘叠加无限增长的定时器（此前泄漏）。
  if (root._armyTimer) { clearInterval(root._armyTimer); root._armyTimer = null; }
  root._armyTimer = setInterval(() => {
    const title = root.querySelector && root.querySelector('.page-title');
    if (!title || title.textContent !== '军队') { clearInterval(root._armyTimer); root._armyTimer = null; return; }
    if (root._armySub === 'design') return;
    const accNow = ctx.account || currentAccount();
    const instNow = ctx.planet || null;
    if (!instNow) return;
    const active = document.activeElement;
    if (active && root.contains(active) && (active.tagName === 'INPUT' || active.tagName === 'SELECT')) return;
    renderArmyPage(root, Object.assign({}, ctx, { account: accNow }));
  }, 1000);
}

// ============================================================================
// 我的军队：组装线（军营驱动）+ 蓝图开线 + 建制军队（训练）
// ============================================================================
function renderTroops(sec, root, ctx, techSet) {
  const acc = ctx.account || currentAccount();
  const inst = ctx.planet || null;
  const counts = getBuildingCounts(inst);
  const barracks = Number(counts.barracks) || 0;
  const training = Number(counts.training_ground) || 0;
  const armies = listArmies(acc);
  const totalPower = armies.reduce((n, a) => n + armyPowerOfInstance(a), 0);
  const lines = (inst.lines || []).filter((l) => l && l.armyBlueprintId);

  // ---- 顶部概况卡（借鉴卡片式军队界面：一屏看全兵力/产能） ----
  const header = el('div', 'army-header');
  const hLeft = el('div');
  hLeft.appendChild(el('div', 't', '🪖 行星防卫与陆战部队'));
  const hSub = el('div', 's');
  hSub.innerHTML = '现役编成 <b>' + armies.length + '</b> 支 · 总战力 <b class="ok">'
    + fmtNum(totalPower) + '</b> · 组装线 <b>' + lines.length + '</b> 条'
    + '　·　军营 <b class="' + (barracks > 0 ? 'ok' : 'warn') + '">' + barracks + '</b> 座（建造人力 '
    + fmtNum(barracks * ARMY_LABOR_PER_BARRACKS) + '）'
    + (training > 0 ? '　·　训练场 <b class="ok">' + training + '</b> 座' : '');
  hLeft.appendChild(hSub);
  header.appendChild(hLeft);
  sec.appendChild(header);

  // ---- 组装生产线 ----
  const secLine = el('div', 'panel-section');
  secLine.appendChild(el('div', 'section-title', '军队组装生产线'));
  if (!lines.length) {
    secLine.appendChild(el('div', 'muted', '还没有组装线 —— 在下方选择一张蓝图开设生产线，装备齐全才能开工。'));
  }
  for (const line of lines) {
    const bp = getArmyBp(acc, line.armyBlueprintId);
    const row = el('div', 'army-line-row');
    const prog = Math.min(0.999999, Number((inst.armyProgress || {})[line.armyBlueprintId]) || 0);
    const chk = armyBuildCheck(inst, bp || line.armyBlueprintId);
    const stuck = !chk.ok && prog > 0.98;
    const head = el('div', 'army-line-head');
    head.appendChild(el('b', null, bp ? bp.nameCn : line.armyBlueprintId));
    head.appendChild(el('span', 'muted', '　军营驱动 · ' + fmtNum(barracks * ARMY_LABOR_PER_BARRACKS) + ' 建造人力'));
    row.appendChild(head);
    const bar = el('div', 'army-progress');
    const fill = el('div', 'army-progress-fill');
    fill.style.width = (prog * 100).toFixed(1) + '%';
    bar.appendChild(fill);
    row.appendChild(bar);
    const stat = el('div', 'army-line-stat');
    if (stuck) {
      const missTxt = chk.missing.map((m) => {
        const p = ARMY_PART_BY_ID[m.partId];
        return (p ? p.nameCn : m.partId) + ' ' + m.have + '/' + m.need;
      }).join('、');
      stat.appendChild(el('span', 'army-miss', '缺件：' + missTxt));
    } else {
      stat.appendChild(el('span', 'muted', '进度 ' + (prog * 100).toFixed(1) + '%'));
    }
    const cancelBtn = el('button', 'btn btn-sm', '取消');
    cancelBtn.addEventListener('click', () => {
      removeLine(inst, line.id);
      renderArmyPage(root, ctx);
    });
    stat.appendChild(cancelBtn);
    row.appendChild(stat);
    secLine.appendChild(row);
  }
  sec.appendChild(secLine);

  // ---- 蓝图与开线（卡片网格） ----
  const customs = (acc && Array.isArray(acc.armyBlueprints)) ? acc.armyBlueprints : [];
  const secBp = el('div', 'panel-section');
  secBp.appendChild(el('div', 'section-title',
    '编制蓝图（默认 ' + ARMY_BLUEPRINTS.length + ' 张 + 自定义 ' + customs.length + ' 张）'));
  const grid = el('div', 'army-bp-grid');
  for (const bp of ARMY_BLUEPRINTS.concat(customs)) {
    grid.appendChild(buildBpCard(bp, root, ctx, techSet, barracks));
  }
  secBp.appendChild(grid);
  sec.appendChild(secBp);

  // ---- 建制军队（含训练）----
  const secArmies = el('div', 'panel-section');
  secArmies.appendChild(el('div', 'section-title', '现役部队（' + armies.length + ' 支）'));
  if (!armies.length) {
    secArmies.appendChild(el('div', 'muted', '还没有成军建制 —— 在上方蓝图卡点「开设组装线」，部件齐、进度满即成军。'));
  } else if (!(training > 0)) {
    secArmies.appendChild(el('div', 'muted',
      '建成「训练场」（t_m2）后可在这里训练军队：每次训练损耗 2 件军事装备，'
      + '该军队永久 +2 攻 / +2 防并获得 15 点经验。'));
  }
  for (const a of armies) {
    secArmies.appendChild(buildArmyRow(a, root, ctx, training));
  }
  sec.appendChild(secArmies);
}

// ---- 蓝图卡（数值面板 / 部件胶囊 / 全宽开线按钮） ----
function buildBpCard(bp, root, ctx, techSet, barracks) {
  const acc = ctx.account || currentAccount();
  const inst = ctx.planet || null;
  const card = el('div', 'army-bp-card');
  const isCustom = !bp.tech;
  const unlocked = bpUnlockedOf(bp, techSet);
  const title = el('div', 'army-bp-title');
  title.appendChild(el('b', null, bp.nameCn + (isCustom ? '（自定义）' : '')));
  if (!unlocked) title.appendChild(el('span', 'army-bp-lock', '　🔒'));
  card.appendChild(title);
  if (bp.desc) card.appendChild(el('div', 'army-bp-desc muted', bp.desc));

  // 数值面板：火力红 / 防护青 / 机动琥珀 + 战力绿
  const stats = armyStatsOfBp(bp);
  const box = el('div', 'army-stat-box');
  box.innerHTML =
    '<span>⚔ 火力 <b class="atk">' + stats.atk + '</b></span>'
    + '<span>🛡 防护 <b class="def">' + stats.def + '</b></span>'
    + '<span>⚡ 机动 <b class="spd">' + stats.speed + '</b></span>'
    + '<span>👥 人数 <b>' + stats.men + '</b></span>'
    + '<span class="row2"><span>综合战力 <b class="pwr">' + armyPowerOf(stats) + '</b></span>'
    + '<span class="muted">工作量 ' + fmtNum(bp.buildWork) + '</span></span>';
  card.appendChild(box);

  // 部件胶囊（够 = 绿 / 缺 = 红，含自选材料标注）
  const need = armyBpPartNeeds(bp);
  const chips = el('div', 'army-chips');
  let allEnough = true;
  let missCount = 0;
  for (const partId in need) {
    const p = ARMY_PART_BY_ID[partId];
    const owned = countPartsOwned(inst, partId);
    const enough = owned >= need[partId];
    if (!enough) { allEnough = false; missCount += need[partId] - owned; }
    const matNote = (bp.parts || []).filter((it) => it.id === partId)
      .map((it) => it.material && it.material !== '铁' ? '@' + it.material : '').join('');
    const chip = el('span', 'army-chip ' + (enough ? 'ok' : 'lack'),
      (p ? p.nameCn : partId) + matNote + ' ×' + need[partId] + '（有 ' + owned + '）');
    chips.appendChild(chip);
  }
  card.appendChild(chips);

  // 材料预算（部件的生产用料）
  const mats = armyBpMaterialNeeds(bp);
  const matTxt = Object.keys(mats).map((m) => m + ' ' + mats[m]).join(' · ');
  card.appendChild(el('div', 'muted army-bp-mats', '材料预算：' + matTxt));

  // 未解锁提示（琥珀条）
  if (!unlocked) {
    const needTech = bp.tech
      ? '需研究「' + techNameCn(bp.tech) + '」后解锁此兵种'
      : '部件科技未研究齐，解锁对应军事科技后可组装';
    card.appendChild(el('div', 'army-bp-locked muted', '⚠ ' + needTech));
  }

  // 全宽开线按钮：不可开工时直接显示原因
  const goBtn = el('button', 'army-go',
    !unlocked ? '未解锁'
    : (!(barracks > 0)) ? '需建军营'
    : (!allEnough ? '装备未齐，不能开工' : '开设组装线'));
  goBtn.disabled = !unlocked || !allEnough || !(barracks > 0);
  if (!unlocked && bp.tech) goBtn.title = '需研究「' + techNameCn(bp.tech) + '」';
  if (!allEnough && missCount > 0) goBtn.title = '还差 ' + missCount + ' 件军事装备';
  const msg = el('span', 'army-form-msg muted');
  goBtn.addEventListener('click', () => {
    const res = addLine(inst, 'barracks', null, {
      armyBlueprintId: isCustom ? null : bp.id,
      armyBlueprint: isCustom ? bp : undefined,
      workers: 0,
    });
    if (res && res.ok) {
      msg.textContent = '已开设组装线（军营驱动）';
      renderArmyPage(root, ctx);
    } else {
      msg.textContent = (res && res.reason) || '开线失败';
    }
  });
  card.appendChild(goBtn);
  card.appendChild(msg);
  return card;
}

// ---- 现役部队卡（徽标 / 彩色数值 / 训练） ----
function buildArmyRow(a, root, ctx, trainingCount) {
  const acc = ctx.account || currentAccount();
  const inst = ctx.planet || null;
  const row = el('div', 'army-unit-row');
  const info = el('div', 'army-unit-info');
  const nameLine = el('div');
  nameLine.appendChild(el('b', null, a.nameCn || a.id));
  const exp = Number(a.exp) || 0;
  if (exp > 0) {
    const badge = el('span', 'army-badge exp', '🎖 经验 ' + exp);
    nameLine.appendChild(badge);
  }
  info.appendChild(nameLine);
  const st = armyEffStats(a);
  const men = Number(a.men) || st.men || 0;
  const bA = Number(a.bonusAtk) || 0;
  const bD = Number(a.bonusDef) || 0;
  const statLine = el('div', 's muted');
  statLine.innerHTML = '👥 ' + men + ' 人 · ⚔ 火力 <b style="color:#f09595">' + st.atk + '</b>'
    + ' · 🛡 防护 <b style="color:var(--cyan)">' + st.def + '</b>'
    + ' · ⚡ 机动 <b style="color:#ffc46b">' + st.speed + '</b>'
    + ' · 综合战力 <b style="color:#9FE1CB">' + armyPowerOfInstance(a) + '</b>'
    + ((bA || bD) ? ' · <span style="color:#9FE1CB">训练加成 +' + bA + '/+' + bD + '</span>' : '');
  info.appendChild(statLine);

  // v0.2.10：编入飞船（t_m3 解锁；互斥：舰队/其它军队占用不可选；每军限 1 艘旗舰）
  {
    const hasShipTech = Array.isArray(acc.tech) && acc.tech.includes(ARMY_SHIP_TECH);
    const ships = Array.isArray(acc.ships) ? acc.ships : [];
    if (a.shipId) {
      const ship = ships.find((s) => s && s.id === a.shipId);
      const shipLine = el('div', 's muted');
      shipLine.innerHTML = '🚀 编入飞船：<b style="color:#9FE1CB">'
        + (ship ? (ship.name || ship.className || ship.id) : a.shipId)
        + '</b>（战力 ' + fmtNum((a.shipBonus && a.shipBonus.strength) || 0)
        + ' · 火力 +60% 防护 +40% 战力 +25%）';
      const detach = el('button', 'btn btn-sm', '解编飞船');
      detach.style.marginLeft = '8px';
      detach.addEventListener('click', () => {
        const r = detachShipFromArmy(acc, a.id);
        if (!r.ok) { alert(r.reason); return; }
        renderArmyPage(root, ctx);
      });
      shipLine.appendChild(detach);
      info.appendChild(shipLine);
    } else if (hasShipTech) {
      const eligible = ships.filter((s) => s && shipEligibleForArmy(acc, s.id).ok);
      if (eligible.length) {
        const shipLine = el('div', 's muted');
        shipLine.appendChild(document.createTextNode('编入飞船（M3 解锁）：'));
        const sel = document.createElement('select');
        sel.className = 'pop-sel';
        sel.style.minHeight = '40px';
        for (const s of eligible) {
          const o = document.createElement('option');
          o.value = s.id;
          o.textContent = (s.name || s.className || '飞船') + '（战力 ' + fmtNum(s.strength) + '）';
          sel.appendChild(o);
        }
        const attach = el('button', 'btn btn-sm', '编入军队');
        attach.style.marginLeft = '8px';
        attach.style.minHeight = '40px';
        attach.addEventListener('click', () => {
          const r = attachShipToArmy(acc, a.id, sel.value);
          if (!r.ok) { alert(r.reason); return; }
          renderArmyPage(root, ctx);
        });
        shipLine.append(sel, attach);
        info.appendChild(shipLine);
      }
    }
  }
  row.appendChild(info);

  // v0.2.6：训练中显示进度条 + 取消；否则显示训练按钮（需训练场）
  const task = (inst.trainingTasks || []).find((t) => t.armyId === a.id);
  if (task) {
    const prog = Math.min(1, Number(task.progress) / Number(task.duration));
    const bar = el('div', 'army-train-bar');
    const fill = el('div', 'army-train-fill');
    fill.style.width = (prog * 100).toFixed(1) + '%';
    bar.appendChild(fill);
    const remain = Math.max(0, Number(task.duration) - Number(task.progress));
    const pct = el('span', 'muted army-train-pct', '训练中 ' + Math.floor(prog * 100) + '% · 剩 ' + fmtTime(remain));
    row.appendChild(bar);
    row.appendChild(pct);
    const cancel = el('button', 'btn btn-sm btn-danger', '取消训练');
    cancel.addEventListener('click', () => { cancelTraining(inst, a.id); renderArmyPage(root, ctx); });
    row.appendChild(cancel);
  } else {
    const trainBtn = el('button', 'btn btn-sm', '训练');
    if (!(trainingCount > 0)) {
      trainBtn.setAttribute('disabled', 'disabled');
      trainBtn.title = '需要先建成「训练场」（t_m2）';
    } else {
      trainBtn.addEventListener('click', () => {
        const r = trainArmy(acc, a.id, inst);
        if (r && r.ok) {
          renderArmyPage(root, ctx);
        } else {
          trainBtn.title = (r && r.reason) || '训练失败';
          trainBtn.textContent = '!';
        }
      });
    }
    row.appendChild(trainBtn);
  }

  const disb = el('button', 'btn btn-sm btn-danger', '解散');
  disb.addEventListener('click', () => {
    disbandArmy(acc, a.id);
    renderArmyPage(root, ctx);
  });
  row.appendChild(disb);
  return row;
}

// ============================================================================
// 设计与建造：钢铁雄心式编制设计器（UI 与舰队设计页同构）
// ============================================================================
function renderArmyDesigner(sec, root, ctx, techSet) {
  const acc = ctx.account || currentAccount();
  // 草稿挂 root 上，跨重绘保留
  if (!root._armyDraft) {
    root._armyDraft = {
      nameCn: '自定义军队',
      parts: [
        { id: 'ap_frame_light', count: 2, material: '铁' },
        { id: 'ap_wpn_rifle', count: 2, material: '铁' },
      ],
    };
  }
  const draft = root._armyDraft;

  const wrap = el('div', 'design-wrap');
  const head = el('div', 'res-head glass');
  head.innerHTML = '<div class="res-head-item"><span class="res-k">编制点</span>'
    + '<span class="res-v cyan" data-dsn-cap>—</span></div>'
    + '<div class="res-head-item res-note muted">框架提供编制点，其余部件占用；'
    + '≥1 框架 + ≥1 武器且不超编才能保存。部件材料不同，军队数值不同。</div>';
  wrap.appendChild(head);

  // 名称
  const nameRow = el('div', 'bp-row');
  nameRow.appendChild(el('span', 'bp-label', '名称'));
  const nameInput = document.createElement('input');
  nameInput.type = 'text';
  nameInput.className = 'bp-input bp-input-wide';
  nameInput.value = draft.nameCn;
  nameInput.addEventListener('change', () => { draft.nameCn = nameInput.value.trim() || '自定义军队'; });
  nameRow.appendChild(nameInput);
  wrap.appendChild(nameRow);

  // 分类别部件区：加件下拉 + 已加列表（材料自选 + 数量 + 移除）
  const partsWrap = el('div', 'dsn-army-parts');
  wrap.appendChild(partsWrap);
  function renderParts() {
    partsWrap.innerHTML = '';
    for (const cat of ARMY_CATS) {
      const unlockedParts = Object.values(ARMY_PART_BY_ID).filter(
        (p) => p.cat === cat && (!p.tech || techSet.has(p.tech)));
      const sub = el('div', 'bp-sub', ARMY_CAT_NAMES[cat]
        + '（每件占编制点 ' + (ARMY_PART_COST[cat] || 0) + '）');
      partsWrap.appendChild(sub);
      if (cat === 'frame') {
        const fr = draft.parts.filter((it) => (ARMY_PART_BY_ID[it.id] || {}).cat === 'frame');
        sub.textContent += ' · 当前 ' + fr.reduce((n, it) => n + (Number(it.count) || 0), 0) + ' 架';
      }
      // 已加的部件行
      draft.parts.forEach((it, i) => {
        const p = ARMY_PART_BY_ID[it.id];
        if (!p || p.cat !== cat) return;
        const row = el('div', 'bp-row');
        row.appendChild(el('span', 'bp-label', p.nameCn));
        // 材料自选
        const matOpts = armyPartMaterialOptions(it.id);
        if (matOpts.length) {
          const sel = document.createElement('select');
          sel.className = 'bp-select';
          for (const m of matOpts) {
            const o = document.createElement('option');
            o.value = m; o.textContent = m;
            if ((it.material || '铁') === m) o.setAttribute('selected', 'selected');
            sel.appendChild(o);
          }
          sel.addEventListener('change', () => { it.material = sel.value; refreshEval(); });
          row.appendChild(sel);
        }
        // 数量
        const cnt = document.createElement('input');
        cnt.type = 'number'; cnt.min = '1'; cnt.className = 'bp-input';
        cnt.value = String(Number(it.count) || 1);
        cnt.addEventListener('change', () => {
          it.count = Math.max(1, Math.floor(Number(cnt.value) || 1));
          refreshEval();
        });
        row.appendChild(cnt);
        const rm = el('button', 'btn btn-sm btn-danger bp-remove', '移除');
        rm.addEventListener('click', () => {
          draft.parts.splice(draft.parts.indexOf(it), 1);
          renderParts(); refreshEval();
        });
        row.appendChild(rm);
        partsWrap.appendChild(row);
      });
      // 加件下拉
      if (unlockedParts.length) {
        const addRow = el('div', 'bp-row');
        const sel = document.createElement('select');
        sel.className = 'bp-select';
        for (const p of unlockedParts) {
          const o = document.createElement('option');
          o.value = p.id; o.textContent = p.nameCn + '（编制 ' + (ARMY_PART_COST[cat] || 0) + '）';
          sel.appendChild(o);
        }
        const addBtn = el('button', 'btn btn-sm bp-add', '+ 加一件');
        addBtn.addEventListener('click', () => {
          draft.parts.push({ id: sel.value, count: 1, material: '铁' });
          renderParts(); refreshEval();
        });
        addRow.appendChild(sel);
        addRow.appendChild(addBtn);
        partsWrap.appendChild(addRow);
      } else {
        partsWrap.appendChild(el('p', 'bp-tip muted',
          '尚未解锁该类部件 —— 研究军事科技后开放（基础 M1：框架/步枪/轻甲/轮式底盘；高级 M2：重型框架/重机枪/复合装甲/悬浮·履带/榴弹炮/激光器/装甲车；超级 M3：高能激光炮/力场装甲/雷达/补给 + 飞船编入）。'));
      }
    }
  }
  renderParts();

  // 实时数值 + 编制 + 保存
  const evalBox = el('div', 'bp-eval-grid');
  wrap.appendChild(evalBox);
  const capEl = head.querySelector('[data-dsn-cap]');
  const saveMsg = el('div', 'muted');
  function refreshEval() {
    const stats = armyStatsOfBp(draft);
    const cap = armyCapOf(draft.parts);
    if (capEl) capEl.textContent = cap.used + ' / ' + cap.cap
      + (cap.ok ? ' ✓' : (cap.frames < 1 ? '（至少 1 架框架）' : cap.weapons < 1 ? '（至少 1 件武器）' : '（超编）'));
    evalBox.innerHTML = '';
    const rows = [
      ['攻击', fmtNum(stats.atk)], ['防御', fmtNum(stats.def)], ['机动', fmtNum(stats.speed)],
      ['人数', stats.men + ' 人'], ['总质量', fmtNum(stats.mass)],
      ['组装工作量', fmtNum(customBuildWork(draft.parts)) + ' 人·秒'],
      ['战力', armyPowerOf(stats)],
    ];
    for (const [k, v] of rows) {
      const cell = el('div', 'bp-eval-cell');
      cell.innerHTML = '<span class="bp-eval-k muted">' + k + '</span><span class="bp-eval-v">' + v + '</span>';
      evalBox.appendChild(cell);
    }
    saveBtn.disabled = !cap.ok;
    saveBtn.title = cap.ok ? '' : '编制不合法：至少 1 架框架、1 件武器，且不超编制点';
  }
  const actions = el('div', 'bp-actions');
  const saveBtn = el('button', 'btn btn-primary', '保存蓝图');
  saveBtn.addEventListener('click', () => {
    if (!Array.isArray(acc.armyBlueprints)) acc.armyBlueprints = [];
    const bp = {
      id: 'abc_' + Date.now().toString(36),
      nameCn: draft.nameCn || '自定义军队',
      tech: null,
      buildWork: customBuildWork(draft.parts),
      parts: draft.parts.map((it) => ({ id: it.id, count: Math.max(1, Math.floor(Number(it.count) || 1)), material: it.material || '铁' })),
    };
    acc.armyBlueprints.push(bp);
    root._armyDraft = null;   // 下次进入给新草稿
    saveMsg.textContent = '已保存「' + bp.nameCn + '」——到「我的军队」页开线组装。';
    refreshEval();
  });
  actions.appendChild(saveBtn);
  wrap.appendChild(actions);
  wrap.appendChild(saveMsg);

  sec.appendChild(wrap);
  refreshEval();
}

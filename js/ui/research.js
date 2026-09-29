// 科研面板（Astrix v0.0.4）
//
// ============================================================================
// 三大方向（设计者要求）
// ============================================================================
//   科技 tech    —— 科技树：解锁建筑、资源与舰船装备（js/data/techs.js）
//   升级 upgrade —— 永久效率提升，可重复升到上限（js/data/upgrades.js）
//   设施 facility—— 船上设施目录：乘员仓 / 仓库 / 机库 / 装甲（js/data/ship_parts.js）
// 「船上设施」已从科技树移到「设施」子分类，科技树里只保留解锁它们的节点。
//
// 研究点存放在账号对象上（acc.researchPoints / acc.tech / acc.upgrades）。
import { TECHS, TECH_BY_ID, BRANCHES, techsByTier, canResearch, missingPrereqs, facilityTechs } from '../data/techs.js?v=21.2';
import { researchTech, buyUpgrade, currentAccount, getPlanetInstance, RESEARCH_UNIT } from '../core/state.js?v=21.2';
import { UPGRADES, upgradeCost, upgradeMul, upgradeFactorAt } from '../data/upgrades.js?v=21.2';
import { BUILDING_BY_ID } from '../data/buildings.js?v=21.2';
import { FACILITIES, MATERIAL_SLOTS, DEFAULT_MATERIAL, isPartUnlocked } from '../data/ship_parts.js?v=21.2';
import { materialMul, resolvePart } from '../core/shipyard.js?v=21.2';
import { fmtNum, fmtTime, fmtRate } from '../core/format.js?v=21.2';
import { jobsOfBuilding, jobOutput } from '../core/population.js?v=21.2';

function esc(s) {
  return String(s).replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
}

function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
}

// 电力设施科技 id 末尾的档位号（t_fac_battery_1 → 1），用于同组内按档位排序
function facTierNum(id) {
  const m = String(id).match(/_(\d+)$/);
  return m ? parseInt(m[1], 10) : 0;
}

// 把「乘算系数相对 1 的偏移」格式化为带符号百分比（如 +16.0% / -20.5%），整数去小数。
function fmtEffPct(mul) {
  const pct = (mul - 1) * 100;
  const r = Math.round(pct * 10) / 10;
  const s = (r >= 0 ? '+' : '') + (Number.isInteger(r) ? String(r) : r.toFixed(1));
  return s + '%';
}

// 确保账号上有科研字段（兼容旧存档）
function ensureFields(acc) {
  if (!Array.isArray(acc.tech)) acc.tech = [];
  if (!Number.isFinite(acc.researchPoints)) acc.researchPoints = 0;
  if (!acc.upgrades || typeof acc.upgrades !== 'object') acc.upgrades = {};
}

// 当前选中的方向（模块级记忆，切 tab 不丢）
let activeSection = 'tech';

export function renderResearch(root, ctx) {
  // v0.1.0：允许「科技集合变化 → 自我重绘」，重入前先清掉旧定时器，避免定时器叠加
  if (root && root._resTimer) { clearInterval(root._resTimer); root._resTimer = null; }
  const { account, planetCode } = ctx || {};
  if (!account) {
    root.innerHTML = '<div class="placeholder glass"><div class="ph-title">账号数据缺失</div></div>';
    return;
  }
  ensureFields(account);

  // 取星球实例算「有效科研人力」与「电力降速比」（无则按满电 1 处理）
  const inst = planetCode ? getPlanetInstance(planetCode) : null;

  // 研究点每秒增速 = 科研所「有效人力」× RESEARCH_UNIT × 电力降速比，
  // 与 state.js 的 advanceResearch 同口径（不另造公式），保证显示数字就是真实增长量。
  // 有效人力 = Σ jobOutput(pop, 'researcher')（人数 × 强度产出倍率）。
  function resGrowthPerSec() {
    if (!inst || !inst.pop) return 0;
    const ratio = (inst.powerInfo && Number.isFinite(inst.powerInfo.ratio)) ? inst.powerInfo.ratio : 1;
    let labor = 0;
    for (const j of jobsOfBuilding('lab')) labor += jobOutput(inst.pop, j.id);
    return labor * RESEARCH_UNIT * ratio;
  }

  root.innerHTML = '';
  const wrap = el('div', 'research-wrap');
  const techSet = new Set(account.tech);
  // v0.0.61：舰船科技已全部移除（包括 a/b/c/d 编号与 MK I~III），科技区就是全部节点。
  const techRegion = TECHS;
  const techTotal = techRegion.length;

  // ===== 顶部概览 =====
  // 用真实 DOM 节点持有数据点（pointsNode / techCountNode / growthNode），
  // 避免依赖属性选择器 querySelector('[data-...]')：本面板会在渲染时同步刷新增长数字，
  // 而最小 DOM 桩的属性选择器支持有限，直接持引用更稳妥（真浏览器中也更省一次查询）。
  const head = el('div', 'res-head glass');

  const itemPoints = el('div', 'res-head-item');
  itemPoints.appendChild(el('span', 'res-k', '研究点'));
  const pointsNode = el('span', 'res-v cyan');
  pointsNode.textContent = fmtNum(account.researchPoints);
  const growthNode = el('span', 'res-growth');
  itemPoints.append(pointsNode, growthNode);

  const itemTech = el('div', 'res-head-item');
  itemTech.appendChild(el('span', 'res-k', '已解锁科技'));
  const techCountNode = el('span', 'res-v');
  techCountNode.textContent = techRegion.filter((t) => techSet.has(t.id)).length + ' / ' + techTotal;
  itemTech.appendChild(techCountNode);

  const itemNote = el('div', 'res-head-item res-note',
    '科研所每工位产出 0.05 研究点/秒，整体耗电 50 电/秒');

  head.append(itemPoints, itemTech, itemNote);
  wrap.appendChild(head);

  // 研究点每秒都在涨（科研所运转时），挂 1 秒定时器只刷新顶部数字，避免整块重绘冲掉按钮与滚动位置。
  // 重复进入面板时先清旧定时器，避免叠加；面板被卸载（.research-wrap 不存在）时自动停。
  if (root._resTimer) { clearInterval(root._resTimer); root._resTimer = null; }
  function updateGrowth() {
    const g = resGrowthPerSec();
    // 正值绿色、0 用灰色（与设计者配色一致）
    if (g > 1e-9) {
      growthNode.textContent = '(' + fmtRate(g) + ')';
      growthNode.setAttribute('style', 'color:#9FE1CB');
    } else {
      growthNode.textContent = '(0)';
      growthNode.setAttribute('style', 'color:#7d8a97');
    }
  }
  updateGrowth();
  // v0.1.0：除了刷新点数与增速，还要**检测科技集合是否变化** ——
  //   研究完成（或离线结算里完成）后立刻整块重绘：卡片变绿色「已解锁」，
  //   以它为前置的后继科技立刻变为可研究，不需要玩家手动切页刷新。
  let _lastTechKey = (account.tech || []).join('|');
  root._resTimer = setInterval(() => {
    if (!root.querySelector('.research-wrap')) { clearInterval(root._resTimer); root._resTimer = null; return; }
    const ts = new Set(account.tech);
    const key = (account.tech || []).join('|');
    if (key !== _lastTechKey) {          // 科技集合变了 → 立刻重绘
      _lastTechKey = key;
      renderResearch(root, ctx);       // 整块重绘：已研究变绿、后继科技变为可研究
      return;
    }
    pointsNode.textContent = fmtNum(account.researchPoints);
    techCountNode.textContent = techRegion.filter((t) => ts.has(t.id)).length + ' / ' + techTotal;
    updateGrowth();
  }, 1000);

  // ===== 三大方向切换 =====
  const nav = el('div', 'res-nav');
  const sections = [
    ['tech', '科技'],
    ['upgrade', '升级'],
    ['facility', '设施'],
  ];
  const body = el('div', 'res-body');
  const render = () => {
    nav.querySelectorAll('.res-nav-btn').forEach((b) => {
      b.classList.toggle('active', b.dataset.sec === activeSection);
    });
    body.innerHTML = '';
    if (activeSection === 'tech') renderTechSection(body, ctx, techSet, render);
    else if (activeSection === 'upgrade') renderUpgradeSection(body, ctx, account, render);
    else renderFacilitySection(body, ctx, techSet, render);
  };
  for (const [key, label] of sections) {
    const b = el('button', 'res-nav-btn', label);
    b.dataset.sec = key;
    b.addEventListener('click', () => { activeSection = key; render(); });
    nav.appendChild(b);
  }
  wrap.append(nav, body);
  root.appendChild(wrap);
  render();
}

// ============================================================================
// 一、科技
// ============================================================================
function renderTechSection(body, ctx, techSet, rerender) {
  const title = el('div', 'res-section-title', '科技树');
  body.appendChild(title);

  const tiers = techsByTier();
  tiers.forEach((list, tier) => {
    if (!list || !list.length) return;
    const row = el('div', 'res-tier');

    const tag = el('div', 'res-tier-tag', 'T' + tier);
    row.appendChild(tag);

    const cards = el('div', 'res-cards');
    for (const t of list) {
      if (t.section === 'facility') continue;   // 舰船研发已挪到「设施」分区
      const researched = techSet.has(t.id);
      const ready = canResearch(t.id, techSet);
      const missing = missingPrereqs(t.id, techSet);
      const affordable = ctx.account.researchPoints >= t.cost;

      const b = (t.unlocksBuilding && BUILDING_BY_ID[t.unlocksBuilding]) || null;
      const bName = b ? b.nameCn : null;
      const stateText = researched ? '已解锁'
        : !ready ? ('需 ' + missing.map((m) => (TECH_BY_ID[m] ? TECH_BY_ID[m].code : m)).join(' + '))
          : affordable ? '可研究' : '研究点不足';

      // v0.0.9：科技行简介里显示该科技解锁建筑的「建造花费」（无单位，次要色 muted）。
      // 仅当该科技节点挂了 unlocksBuilding 时才显示这一行；纯解锁资源/舰船部件的科技不显示。
      let unlockLine;
      if (b && b.baseCost && Object.keys(b.baseCost).length) {
        const costStr = Object.entries(b.baseCost)
          .map(([mat, num]) => mat + ' ' + num).join(' · ');
        unlockLine = '<span class="muted">解锁建筑：' + esc(bName) + '（造价 ' + costStr + '）</span>';
      } else if (t.partCategory) {
        unlockLine = '<span class="res-unlock">解锁舰船部件</span>';
      } else {
        unlockLine = '<span class="res-unlock muted">资源解锁</span>';
      }

      const card = el('button', 'res-card'
        + (researched ? ' is-done' : ready ? ' is-ready' : ' is-locked'));
      card.type = 'button';

      card.innerHTML =
        '<div class="res-card-top">'
        + '<span class="res-code">' + esc(t.code) + '</span>'
        + '<span class="res-name">' + esc(t.nameCn) + '</span>'
        + '</div>'
        + '<div class="res-card-mid">'
        + '<span class="res-cost">' + fmtNum(t.cost) + ' 研究点</span>'
        + unlockLine
        + '</div>'
        + '<div class="res-card-bot ' + (researched ? 'ok' : ready ? 'ready' : 'lock') + '">'
        + esc(stateText) + '<span class="res-branch muted">' + esc(BRANCHES[t.branch] || '') + '</span>'
        + '</div>';

      card.addEventListener('click', () => openTechDetail(ctx, t, { researched, ready, missing, affordable }, rerender));
      cards.appendChild(card);
    }
    row.appendChild(cards);
    body.appendChild(row);
  });
}

// ============================================================================
// 二、升级
// ============================================================================
function renderUpgradeSection(body, ctx, account, rerender) {
  const title = el('div', 'res-section-title', '永久升级');
  body.appendChild(title);
  body.appendChild(el('p', 'res-sub muted',
    '升级是永久性的效率提升，与解锁建筑的「科技」是两套体系；每项都有等级上限。'));

  const grid = el('div', 'res-upgrades');
  for (const u of UPGRADES) {
    const lv = account.upgrades[u.id] || 0;
    const cost = upgradeCost(u, lv);
    const maxed = lv >= u.maxLevel;
    // 当前/下一级效果一律用 upgradeMul / upgradeFactorAt 算，不手写公式
    const curMul = upgradeMul(account, u.id);
    const nextMul = upgradeFactorAt(u, lv + 1);
    const effText = (lv === 0)
      ? '未生效 · 下一级 ' + fmtEffPct(nextMul)
      : '当前 ' + fmtEffPct(curMul) + ' / 下一级 ' + fmtEffPct(nextMul);
    const card = el('button', 'res-upg' + (maxed ? ' is-done' : account.researchPoints >= cost ? ' is-ready' : ''));
    card.type = 'button';
    card.innerHTML =
      '<div class="res-upg-name">' + esc(u.nameCn)
      + '<span class="res-upg-lv">Lv ' + lv + '/' + u.maxLevel + '</span></div>'
      + '<div class="res-upg-eff muted">' + esc(effText) + '</div>'
      + '<div class="res-upg-cost">' + (maxed ? '已满级' : fmtNum(cost) + ' 研究点') + '</div>';
    card.addEventListener('click', () => openUpgradeDetail(ctx, u, lv, cost, maxed, rerender));
    grid.appendChild(card);
  }
  body.appendChild(grid);
}

// ============================================================================
// 三、设施（船上设施目录）
// ============================================================================
function renderFacilitySection(body, ctx, techSet, rerender) {
  const title = el('div', 'res-section-title', '船上设施');
  body.appendChild(title);
  body.appendChild(el('p', 'res-sub muted',
    '船上设施目录（飞船蓝图的积木）。v0.0.61 起：**造出船坞即可使用全部舰船部件**，不再需要单独研究。'));

  // ===== 0) 电力设施解锁（v0.0.7，12 个 section:'facility' 科技节点）=====
  // 排在「船上设施目录」之前。按 4 类（电池组 / 光伏 / 风力 / 火力）分组、每类内按档位排序。
  // 逐级显示：设计者要求「解锁了再解锁 mkii，在此之前 mkii 不显示」——某一档的前置档未研究时，
  // 该档及其之后的档位整条不渲染。已研究 → 已研究；可研究 → 研究按钮；研究点不足 → 原因。
  // 复用既有 el / fac-row / canResearch / missingPrereqs / researchTech 与 fac-row 样式。
  body.appendChild(el('div', 'res-section-title', '电力设施解锁'));
  body.appendChild(el('p', 'res-sub muted',
    '电池组 / 光伏 / 风力 / 火力四类发电与储电设施的分级解锁。逐级研究：解锁了低档才能研究下一档。'));

  // 用账号最新的已研究集合判定（研究后立即重绘能正确反映），避免沿用渲染时快照导致刚研究的节点不翻牌
  const techSetNow = new Set(ctx.account.tech || []);
  const facTechs = facilityTechs();
  const facCats = [
    { key: 'battery', nameCn: '电池组' },
    { key: 'solar', nameCn: '光伏' },
    { key: 'wind', nameCn: '风力' },
    { key: 'thermal', nameCn: '火力' },
  ];
  for (const cat of facCats) {
    const list = facTechs
      .filter((t) => t.id.indexOf('_' + cat.key + '_') >= 0)
      .sort((a, b) => facTierNum(a.id) - facTierNum(b.id));
    if (!list.length) continue;
    const box = el('details', 'fac-group');
    box.open = true;
    const sum = el('summary', 'fac-sum');
    sum.innerHTML = `<span class="fac-name">${esc(cat.nameCn)}</span>`
      + `<span class="fac-note muted">逐级解锁</span>`;
    box.appendChild(sum);

    // 逐级显示：第 1 档始终出现（其前置是主科技树里的 B1/B5/B8，已在科技区列出）；
    // 第 n(n>1) 档仅当前一档已研究时才出现，否则连同之后所有档位一起不渲染。
    let prevResearched = true;
    for (const t of list) {
      if (!prevResearched) break;
      const researched = techSetNow.has(t.id);
      const ready = canResearch(t.id, techSetNow);
      const missing = missingPrereqs(t.id, techSetNow);
      const affordable = ctx.account.researchPoints >= t.cost;
      const row = el('div', 'fac-row' + (researched ? ' is-done' : ready ? ' is-ready' : ' is-locked'));
      const stateText = researched ? '<span class="ok-green">已解锁</span>'
        : !ready ? ('需 ' + missing.map((m) => (TECH_BY_ID[m] ? TECH_BY_ID[m].code : m)).join(' + '))
          : affordable ? '可研究' : '研究点不足';
      row.innerHTML =
        `<div class="fac-line1"><span class="fac-title">${esc(t.nameCn)}</span>`
        + `<span class="fac-mark">${esc(t.code)}</span>`
        + (researched ? '<span class="fac-lock fac-done">已解锁</span>'
            : ready ? '' : '<span class="fac-lock">未解锁</span>') + '</div>'
        + `<div class="fac-line2 muted">${fmtNum(t.cost)} 研究点`
        + (stateText ? ' · ' + stateText : '') + '</div>';
      if (!researched) {
        const btn = el('button', 'btn btn-sm btn-primary', '研究');
        btn.disabled = !(ready && affordable);
        if (!ready) btn.title = '前置科技未完成';
        else if (!affordable) btn.title = '研究点不足';
        btn.addEventListener('click', (e) => {
          e.stopPropagation();
          const r = researchTech(t.id);
          if (!r.ok) { rerender(); return; }   // 失败（如研究点不足）重绘后状态行会显示原因
          rerender();
        });
        row.appendChild(btn);
      }
      row.addEventListener('click', () => openTechDetail(ctx, t, { researched, ready, missing, affordable }, rerender));
      box.appendChild(row);
      prevResearched = researched;
    }
    body.appendChild(box);
  }

  // ===== 1) 船上设施目录（乘员仓 / 仓库 / 机库 / 装甲）=====
  body.appendChild(el('div', 'res-section-title', '船上设施目录'));

  // 按基础型号分组（乘员仓 / 仓库 / 机库 / 装甲）
  const groups = [
    { prefix: 'fac_crew', nameCn: '乘员仓', note: '提供载员名额与生命维持，决定温度安全区间' },
    { prefix: 'fac_cargo', nameCn: '仓库', note: '装货效率远高于所占容量，运输船的核心' },
    { prefix: 'fac_hangar', nameCn: '机库', note: '容纳小型飞行器，只有大型以上外壳装得下' },
    { prefix: 'fac_armor', nameCn: '装甲', note: '可自选材料，材料强度直接换成船体结构强度' },
  ];

  for (const g of groups) {
    const list = FACILITIES.filter((f) => f.id.startsWith(g.prefix))
      .sort((a, b) => a.mark - b.mark);
    if (!list.length) continue;

    const box = el('details', 'fac-group');
    box.open = true;
    const sum = el('summary', 'fac-sum');
    sum.innerHTML = `<span class="fac-name">${esc(g.nameCn)}</span>`
      + `<span class="fac-note muted">${esc(g.note)}</span>`;
    box.appendChild(sum);

    for (const f of list) {
      const unlocked = isPartUnlocked(f.id, techSet);
      const row = el('div', 'fac-row' + (unlocked ? '' : ' is-locked'));
      const b = { footprint: f.footprint, mass: f.mass };
      const extra = [];
      if (f.crew) extra.push(`载员 ${fmtNum(f.crew)} 人`);
      if (f.cargoVol) extra.push(`货舱 ${fmtNum(f.cargoVol)} m³`);
      if (f.hangarSlots) extra.push(`机位 ${fmtNum(f.hangarSlots)}`);
      if (f.structAdd) extra.push(`结构 +${fmtNum(f.structAdd)}`);
      if (f.tempBandBonus) extra.push(`温度区间 ±${f.tempBandBonus} K`);

      row.innerHTML =
        `<div class="fac-line1"><span class="fac-title">${esc(f.nameCn)}</span>`
        + `<span class="fac-mark">${esc(f.markLabel)}</span>`
        + (unlocked ? '' : '<span class="fac-lock">未解锁</span>') + '</div>'
        + `<div class="fac-line2 muted">占地 ${fmtNum(b.footprint)} m³ · 质量 ${fmtNum(b.mass)} t`
        + (extra.length ? ' · ' + extra.join(' · ') : '') + '</div>'
        + `<div class="fac-line3 muted">${esc(f.desc)}</div>`;

      if (f.materialSlot) {
        const mats = (MATERIAL_SLOTS[f.materialSlot] || []).join(' / ');
        const line = el('div', 'fac-line4 muted');
        line.textContent = '可选材料：' + mats;
        row.appendChild(line);
      }

      row.addEventListener('click', () => openFacilityDetail(ctx, f, unlocked));
      box.appendChild(row);
    }
    body.appendChild(box);
  }
}

// ============================================================================
// 详情弹层
// ============================================================================
function openTechDetail(ctx, t, st, rerender) {
  const body = document.createElement('div');
  const lines = [];
  lines.push('<p class="res-desc">' + esc(t.desc) + '</p>');
  lines.push('<div class="res-kv"><span>编号</span><b>' + esc(t.code) + '</b></div>');
  lines.push('<div class="res-kv"><span>研究点花费</span><b>' + fmtNum(t.cost) + '</b></div>');
  lines.push('<div class="res-kv"><span>前置科技</span><b>'
    + (t.prereq.length ? t.prereq.map((p) => (TECH_BY_ID[p] ? TECH_BY_ID[p].code + ' ' + TECH_BY_ID[p].nameCn : p)).join('、') : '无')
    + '</b></div>');
  if (t.unlocksBuilding && BUILDING_BY_ID[t.unlocksBuilding]) {
    const b = BUILDING_BY_ID[t.unlocksBuilding];
    lines.push('<div class="res-kv"><span>解锁建筑</span><b>' + esc(b.nameCn) + '</b></div>');
    lines.push('<div class="res-kv"><span>该建筑耗电</span><b>'
      + (b.powerDraw ? b.powerDraw + ' /秒' : '不耗电') + '</b></div>');
    lines.push('<div class="res-kv"><span>该建筑岗位</span><b>' + b.jobs + '</b></div>');
    lines.push('<div class="res-kv"><span>施工工作量</span><b>' + fmtTime(b.work) + '（1 名建筑工）</b></div>');
  }
  if (t.unlockResources && t.unlockResources.length) {
    lines.push('<div class="res-kv"><span>解锁采集</span><b>' + t.unlockResources.map(esc).join('、') + '</b></div>');
  }
  lines.push('<div class="res-kv"><span>状态</span><b>' + (st.researched ? '<span class="ok-green">已解锁</span>' : st.ready ? '可研究' : '前置未满足') + '</b></div>');

  body.innerHTML = lines.join('');

  const tip = document.createElement('p');
  tip.className = 'modal-tip muted';
  tip.textContent = '研究点由科研所的科研人员产出（每工位 0.05 点/秒）。';

  // v0.0.52：研究按钮真正扣研究点（此前只显示不结算）
  if (!st.researched) {
    const btn = document.createElement('button');
    btn.className = 'btn btn-primary';
    btn.textContent = '研究 · 花费 ' + fmtNum(t.cost) + ' 研究点';
    btn.disabled = !(st.ready && st.affordable);
    if (!st.ready) btn.title = '前置科技未完成';
    else if (!st.affordable) btn.title = '研究点不足';
    btn.onclick = () => {
      const r = researchTech(t.id);
      if (!r.ok) {
        tip.className = 'modal-tip';
        tip.textContent = r.reason;
        return;
      }
      tip.className = 'modal-tip cyan';
      tip.textContent = '研究完成：' + t.nameCn + '（已扣除 ' + fmtNum(r.spent) + ' 研究点）';
      btn.disabled = true;
      if (typeof rerender === 'function') rerender();
    };
    body.appendChild(btn);
  } else {
    tip.textContent = '已解锁。';
  }

  body.appendChild(tip);
  ctx.openModal({ title: t.code + ' ' + t.nameCn, body, sheet: true });
}

function openUpgradeDetail(ctx, u, lv, cost, maxed, rerender) {
  const body = document.createElement('div');
  // 当前/下一级效果用 upgradeFactorAt 算（lv 即当前等级），不手写公式
  const curMul = upgradeFactorAt(u, lv);
  const nextMul = upgradeFactorAt(u, lv + 1);
  body.innerHTML =
    '<p class="res-desc">' + esc(u.desc) + '</p>'
    + '<div class="res-kv"><span>当前等级</span><b>Lv ' + lv + ' / ' + u.maxLevel + '</b></div>'
    + '<div class="res-kv"><span>当前效果</span><b>' + (lv === 0 ? '未生效' : fmtEffPct(curMul)) + '</b></div>'
    + '<div class="res-kv"><span>升一级后</span><b>' + fmtEffPct(nextMul) + '</b></div>'
    + '<div class="res-kv"><span>效果模型</span><b>首级 ' + fmtEffPct(1 + (u.effectBase || 0)) + ' · 底数 ×' + (u.effectPow || 1.6) + ' 乘方</b></div>'
    + '<div class="res-kv"><span>下级花费</span><b>' + (maxed ? '已满级' : fmtNum(cost) + ' 研究点') + '</b></div>'
    + '<div class="res-kv"><span>价格增长</span><b>×' + u.growth + ' / 级</b></div>';

  const account = (ctx && ctx.account) || currentAccount();
  const tip = document.createElement('p');
  tip.className = 'modal-tip muted';
  if (!maxed) {
    const btn = document.createElement('button');
    btn.className = 'btn btn-primary';
    btn.textContent = '升到 Lv ' + (lv + 1) + ' · 花费 ' + fmtNum(cost) + ' 研究点';
    btn.disabled = !(account && Number(account.researchPoints) >= cost);
    if (btn.disabled) btn.title = '研究点不足';
    btn.onclick = () => {
      const r = buyUpgrade(u.id);
      if (!r.ok) { tip.className = 'modal-tip'; tip.textContent = r.reason; return; }
      tip.className = 'modal-tip cyan';
      tip.textContent = '已升到 Lv ' + r.level + '（扣除 ' + fmtNum(r.spent) + ' 研究点）';
      btn.disabled = true;
      if (typeof rerender === 'function') rerender();
    };
    body.appendChild(btn);
  } else {
    tip.textContent = '已满级。';
  }
  body.appendChild(tip);
  ctx.openModal({ title: '升级 · ' + u.nameCn, body, sheet: true });
}

// 设施详情：额外展示「默认材料下的实装属性」，让玩家知道材料的影响
function openFacilityDetail(ctx, f, unlocked) {
  const body = document.createElement('div');
  const lines = [];
  lines.push('<p class="res-desc">' + esc(f.desc) + '</p>');
  lines.push('<div class="res-kv"><span>型号</span><b>' + esc(f.markLabel) + '</b></div>');
  lines.push('<div class="res-kv"><span>类别</span><b>船上设施</b></div>');
  lines.push('<div class="res-kv"><span>占地</span><b>' + fmtNum(f.footprint) + ' m³</b></div>');
  lines.push('<div class="res-kv"><span>质量</span><b>' + fmtNum(f.mass) + ' t</b></div>');
  if (f.crew) lines.push('<div class="res-kv"><span>载员</span><b>' + fmtNum(f.crew) + ' 人</b></div>');
  if (f.cargoVol) lines.push('<div class="res-kv"><span>货舱</span><b>' + fmtNum(f.cargoVol) + ' m³</b></div>');
  if (f.hangarSlots) lines.push('<div class="res-kv"><span>机位</span><b>' + fmtNum(f.hangarSlots) + '</b></div>');
  if (f.structAdd) lines.push('<div class="res-kv"><span>结构加成</span><b>+' + fmtNum(f.structAdd) + '</b></div>');
  if (f.tempBandBonus) lines.push('<div class="res-kv"><span>温度区间</span><b>±' + f.tempBandBonus + ' K</b></div>');

  if (f.materialSlot) {
    const def = DEFAULT_MATERIAL[f.materialSlot];
    const r = resolvePart(f.id, def);
    const mul = materialMul(def);
    lines.push('<div class="res-kv"><span>可选材料</span><b>' + (MATERIAL_SLOTS[f.materialSlot] || []).join('、') + '</b></div>');
    lines.push('<div class="res-kv"><span>默认材料</span><b>' + esc(def)
      + '（结构 ×' + mul.structMul.toFixed(2) + ' · 质量 ×' + mul.massMul.toFixed(2) + '）</b></div>');
    if (r) {
      lines.push('<div class="res-kv"><span>实装质量</span><b>' + fmtNum(r.mass) + ' t</b></div>');
      if (r.structAdd) lines.push('<div class="res-kv"><span>实装结构加成</span><b>+' + fmtNum(r.structAdd) + '</b></div>');
      lines.push('<div class="res-kv"><span>耐热上限</span><b>' + fmtNum(r.maxTempK) + ' K</b></div>');
    }
  }
  lines.push('<div class="res-kv"><span>解锁状态</span><b>' + (unlocked ? '已解锁' : '未解锁（需研究对应支线科技）') + '</b></div>');

  body.innerHTML = lines.join('');
  ctx.openModal({ title: '设施 · ' + f.nameCn, body, sheet: true });
}

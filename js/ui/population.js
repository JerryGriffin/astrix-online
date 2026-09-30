// 人力面板 UI（Astrix，零依赖原生 ES module）
// 数据来自 js/core/population.js（分配与代谢）与 js/core/state.js（建筑计数）。
//
// ============================================================================
// v0.0.5 改版要点（设计者给定）
// ============================================================================
// 1. **只显示能分配的岗位**：需要建筑的岗位，只有该建筑已建成（数量 > 0）才出现；
//    未建成 / 未解锁的一律不显示（底部用一行小字告知隐藏了多少个）。
// 2. **改为按建筑分组**：组头显示该建筑的
//    座数 × 每座工位数 = 总工位 · 已指派 · **空闲工位**（=建筑数×工位数−已指派人数）。
//    一个建筑下的多个职业（如制造车间的「小型物件工 / 中型物件工」）共用一个工位池，
//    于是「多个人可以在一个建筑里面从事不同的工作」。
// 3. **新增人数输入栏**：每行都有 −/输入框/＋/满员，方便大规模分配（人数很多时不用点几百次）。
// 4. 顶部营养区改为 3 消耗（氧气/有机质/水）+ 3 产出（二氧化碳/甲烷/氨气）。

import { fmtNum, fmtRate } from '../core/format.js?v=26.8';
import { BUILDINGS, BUILDING_BY_ID } from '../data/buildings.js?v=26.8';
import {
  createPopulation, assignWorkers, setJobIntensity, getIntensity,
  getTotalLabor, getAssigned, getAvailable, consumptionPerSec, metabolitePerSec,
  JOBS, JOBS_BY_BUILDING, WORK_INTENSITY,
  assignedToBuilding, freeSlots, jobCapacity, hiddenJobCount, getJobCount,
  MANAGE_MODES, manageModeOf,
} from '../core/population.js?v=26.8';
import { getBuildingCounts, currentAccount } from '../core/state.js?v=26.8';
import { ARMY_BP_BY_ID } from '../data/army_parts.js?v=26.8';   // v0.2.0 军队组装线命名
// v0.1.1（需求 20）：殖民管理模式——判断本星球是否由电脑接管发展
import { modeOf } from '../core/planetgen.js?v=26.8';
// v0.2.3（需求）：殖民地报告历史已从人力页移除 —— 报告只在「星球选择 / 星际」的
//   每颗星球行内联展示（colony.js），不再在人力页保留历史副本。
// v0.0.7：生产线接口（核心模块正在实现中）。用命名空间导入 + 函数存在性守卫，
//   若接口尚未落地（addLine 等不是函数），本文件不会报错，也不渲染生产线区块。
import * as PR from '../core/production.js?v=26.8';

// 取/建星球上的人口对象（挂在 planet.pop，首次访问惰性创建）
function ensurePop(planet) {
  if (!planet.pop) {
    const total = (planet.population && Number(planet.population.total)) || 0;
    planet.pop = createPopulation(total);
  }
  return planet.pop;
}

// 幸福度颜色反馈
function happinessColor(h) {
  if (h >= 0.7) return '#2ecc71'; // 好
  if (h >= 0.4) return '#f39c12'; // 一般
  return '#e74c3c';               // 差
}

// v0.1.1（需求 10a）：「可用人力」必须同时扣除岗位分配与生产线占用的人数。
// 优先用 core/production.js 的 freeLaborOf（权威口径），接口缺失时回退为 getAvailable − lineWorkersTotal。
function availLaborOf(planet, pop) {
  if (typeof PR.freeLaborOf === 'function') {
    const v = Number(PR.freeLaborOf(planet));
    if (Number.isFinite(v)) return Math.max(0, v);
  }
  const lineW = (typeof PR.lineWorkersTotal === 'function') ? (Number(PR.lineWorkersTotal(planet)) || 0) : 0;
  return Math.max(0, getAvailable(pop) - lineW);
}

function el(tag, attrs = {}, children = []) {
  const e = document.createElement(tag);
  for (const k in attrs) {
    if (k === 'style') e.setAttribute('style', attrs[k]);
    else if (k === 'text') e.textContent = attrs[k];
    else if (k === 'html') e.innerHTML = attrs[k];
    else e.setAttribute(k, attrs[k]);
  }
  for (const c of [].concat(children)) if (c) e.appendChild(c);
  return e;
}

const PANEL_CSS = `
  .pop-panel { font-family: system-ui, sans-serif; color: #e8eef2; padding: 12px; box-sizing: border-box; }
  .pop-stats { display: flex; gap: 10px; flex-wrap: wrap; margin-bottom: 10px; }
  .pop-stat { flex: 1 1 30%; min-width: 104px; background: #1b2530; border-radius: 10px; padding: 10px 12px; }
  .pop-stat .lbl { font-size: 12px; opacity: .7; }
  .pop-stat .val { font-size: 21px; font-weight: 700; margin-top: 2px; }
  .pop-card { background: #1b2530; border-radius: 10px; padding: 10px 12px; margin-bottom: 10px; font-size: 13px; line-height: 1.9; }
  .pop-card .k { opacity: .7; }
  .pop-card .neg { color: #f09595; }
  .pop-card .pos { color: #9FE1CB; }
  .pop-group { margin-bottom: 12px; border: 1px solid #2a3645; border-radius: 10px; overflow: hidden; }
  .pop-ghead { padding: 9px 12px; background: #16202b; display: flex; flex-wrap: wrap; gap: 4px 10px; align-items: baseline; }
  .pop-ghead .gname { font-weight: 600; }
  .pop-ghead .gmeta { font-size: 12px; opacity: .75; }
  .pop-ghead .gfree { font-size: 12px; color: #9FE1CB; font-weight: 600; }
  .pop-ghead .gfree.zero { color: #f09595; }
  .pop-job { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; padding: 8px 12px; min-height: 44px; border-top: 1px solid #223040; }
  .pop-job .name { flex: 1 1 150px; min-width: 0; }
  .pop-job .name .d { font-size: 11px; opacity: .6; line-height: 1.4; }
  .pop-job button { min-width: 40px; min-height: 40px; font-size: 17px; border: none; border-radius: 8px; background: #2d3e50; color: #fff; cursor: pointer; }
  .pop-job button:active { background: #3a5066; }
  .pop-job button.small { font-size: 12px; padding: 0 8px; }
  .pop-job input.cnt-in { width: 76px; min-height: 40px; text-align: center; font-size: 15px; font-weight: 700;
    border-radius: 8px; background: #101820; color: #fff; border: 1px solid #34465a; box-sizing: border-box; }
  .pop-job select { min-height: 40px; border-radius: 8px; background: #2d3e50; color: #fff; border: none; padding: 0 6px; }
  .pop-hint { font-size: 12px; opacity: .6; padding: 4px 2px 10px; line-height: 1.6; }
  .pop-unassigned { padding: 10px 12px; background: #14202b; border-radius: 10px; font-weight: 600; }
  /* v0.2.11 管理模式 */
  .pop-mode-row { display: flex; flex-wrap: wrap; gap: 8px; margin: 8px 0; }
  .pop-mode-btn { min-height: 44px; border-radius: 8px; background: #2d3e50; color: #fff; border: none; cursor: pointer; padding: 0 12px; font-weight: 600; }
  .pop-mode-btn.active { background: #2a5a4d; outline: 2px solid #9FE1CB; }
  .pop-mode-desc { font-size: 12px; line-height: 1.9; padding: 6px 2px; }
  .pop-mode-desc .cur { color: #9FE1CB; }
`;

// 渲染人力面板到 root 容器
// v0.1.1（需求 20）：是否与 tickManagedColonies 的托管口径一致——
// 母星、公共商店星、以及已同化为「领土」的星球不托管；仅被「发现」而未殖民的预览实例也不托管。
function isManagedColony(inst) {
  if (!inst || inst.isHome || inst.isShop) return false;
  const acc = currentAccount();
  const caps = acc && Array.isArray(acc.capturedPlanets) ? acc.capturedPlanets : [];
  if (!caps.some((c) => c && c.code === inst.code)) return false;
  const mode = modeOf(inst);
  return !(mode && mode.id === 'territory');
}

export function renderPopulation(root, planet) {
  const pop = ensurePop(planet);
  const counts = getBuildingCounts(planet);
  root.innerHTML = '';
  // v0.0.7：清掉上一次的生产线刷新定时器（整面板重绘时一并重置）
  if (root._popLineTimer) { clearInterval(root._popLineTimer); root._popLineTimer = null; }
  root.appendChild(el('style', { text: PANEL_CSS }));

  const panel = el('div', { class: 'pop-panel' });

  // ---- 管理模式（v0.2.11）：写在最上方，每种模式的效果一目了然 ----
  {
    const cur = manageModeOf(planet);
    const box = el('div', { class: 'pop-card' });
    box.appendChild(el('div', { class: 'section-title', text: '管理模式' }));
    const row = el('div', { class: 'pop-mode-row' });
    for (const m of MANAGE_MODES) {
      const b = el('button', { class: 'pop-mode-btn' + (m.id === cur.id ? ' active' : ''), text: m.icon + ' ' + m.nameCn });
      b.addEventListener('click', () => {
        planet.manageMode = m.id;
        if (planet.pop) planet.pop.manageMode = m.id;   // 立即同步消耗展示
        renderPopulation(root, planet);
      });
      row.appendChild(b);
    }
    box.appendChild(row);
    const list = el('div', { class: 'pop-mode-desc' });
    for (const m of MANAGE_MODES) {
      const line = el('div', { class: m.id === cur.id ? 'cur' : '' });
      line.appendChild(el('b', { text: m.icon + ' ' + m.nameCn }));
      line.appendChild(document.createTextNode('　' + m.desc + (m.id === cur.id ? '　◀ 当前' : '')));
      list.appendChild(line);
    }
    box.appendChild(list);
    panel.appendChild(box);
  }

  // ---- 顶部四个数字 ----
  panel.appendChild(el('div', { class: 'pop-stats' }, [
    el('div', { class: 'pop-stat' }, [
      el('div', { class: 'lbl', text: '总人数' }),
      el('div', { class: 'val', text: fmtNum(Math.floor(pop.total)) }),
    ]),
    el('div', { class: 'pop-stat' }, [
      el('div', { class: 'lbl', text: '总人力' }),
      el('div', { class: 'val', text: fmtNum(getTotalLabor(pop)) }),
    ]),
    el('div', { class: 'pop-stat' }, [
      el('div', { class: 'lbl', text: '可用人力' }),
      el('div', { class: 'val', text: fmtNum(availLaborOf(planet, pop)) }),
    ]),
    el('div', { class: 'pop-stat' }, [
      el('div', { class: 'lbl', text: '幸福度' }),
      el('div', { class: 'val', style: `color:${happinessColor(pop.happiness)}`, text: Math.round(pop.happiness * 100) + '%' }),
    ]),
  ]));

  // v0.1.1（需求 20）：托管殖民地提示——电脑每 30 秒重排人力与生产线
  if (isManagedColony(planet)) {
    const mode = modeOf(planet);
    panel.appendChild(el('div', { class: 'pop-card' }, [
      el('div', {}, [
        el('span', { class: 'k', text: '本星球由电脑接管发展（管理模式：' + ((mode && (mode.nameCn || mode.label || mode.id)) || '默认') + '）' }),
      ]),
      el('div', { class: 'muted', text: '人力与生产线每 30 秒由电脑自动重排，此处手动分配会在下一次重排时被覆盖；该星球会按模式比例向母星上缴贡品。' }),
    ]));
  }

  // （v0.2.3：殖民地报告历史区块已移除 —— 报告内联在各星球行，见 colony.js）

  // ---- 营养代谢：3 消耗 + 3 产出 ----
  const cons = consumptionPerSec(pop);
  const prod = metabolitePerSec(pop);
  panel.appendChild(el('div', { class: 'pop-card' }, [
    el('div', {}, [
      el('span', { class: 'k', text: '每秒消耗 ' }),
      el('span', { class: 'neg', text: `氧气 ${fmtRate(cons.oxygen)} · 有机质 ${fmtRate(cons.organic)} · 水 ${fmtRate(cons.water)}` }),
    ]),
    el('div', {}, [
      // v0.0.6（需求 R11）：呼吸产物不再进物品栏，而是**排入星球大气层**
      el('span', { class: 'k', text: '每秒排入大气 ' }),
      el('span', { class: 'pos', text: `二氧化碳 ${fmtRate(prod.co2)} · 甲烷 ${fmtRate(prod.methane)} · 氨气 ${fmtRate(prod.ammonia)}` }),
    ]),
    el('div', { class: 'k', text: '呼吸产物会积存在星球大气层里，可以用大气收集器重新采回来（进「物品栏」的星球储藏栏查看）。' }),
    el('div', { class: 'k', text: '工作强度**同时**放大消耗与产出，且档位越高越「划算」——产出涨幅略大于消耗涨幅（极限档：产出 ×2.40 / 消耗 ×5.00）。' }),
  ]));

  // ---- 分组：先「无需建筑」，再按建筑（只显示已建成的） ----
  const groups = [];

  const freeJobs = JOBS.filter((j) => !j.buildingId);
  if (freeJobs.length) {
    let assignedFree = 0;
    for (const j of freeJobs) assignedFree += getJobCount(pop, j.id);
    groups.push({
      key: '__nobuilding',
      nameCn: '无需建筑',
      meta: '露天就能开工',
      slots: null,               // 无固定工位，直接受可用人力限制
      assigned: assignedFree,
      jobs: freeJobs,
    });
  }

  for (const b of BUILDINGS) {
    const n = Number(counts[b.id] || 0);
    if (n <= 0) continue;                                  // 未建成的一律不显示
    const jobs = JOBS_BY_BUILDING[b.id] || [];
    if (!jobs.length) continue;
    groups.push({
      key: b.id,
      nameCn: b.nameCn,
      count: n,
      slots: n * b.jobs,
      assigned: assignedToBuilding(pop, b.id),
      free: freeSlots(pop, b.id, counts),
      jobs,
    });
  }

  for (const g of groups) {
    const wrap = el('div', { class: 'pop-group' });
    const head = el('div', { class: 'pop-ghead' });
    head.appendChild(el('span', { class: 'gname', text: g.nameCn + (g.count ? ' ×' + fmtNum(g.count) : '') }));
    if (g.slots == null) {
      head.appendChild(el('span', { class: 'gmeta', text: g.meta + ' · 已指派 ' + fmtNum(g.assigned) }));
    } else {
      head.appendChild(el('span', { class: 'gmeta',
        text: `工位 ${fmtNum(g.slots)} · 已指派 ${fmtNum(g.assigned)}` }));
      head.appendChild(el('span', { class: 'gfree' + (g.free > 0 ? '' : ' zero'),
        text: '空闲工位 ' + fmtNum(g.free) }));
    }
    wrap.appendChild(head);

    for (const job of g.jobs) {
      const a = pop.assignments[job.id] || { count: 0, intensityId: 'standard' };
      const cnt = a.count || 0;

      const minus = el('button', { text: '−', title: '减少 1 人' });
      const plus = el('button', { text: '＋', title: '增加 1 人' });
      const full = el('button', { class: 'small', text: '满员', title: '尽量填满该岗位' });

      const input = el('input', {
        class: 'cnt-in', type: 'number', min: '0', step: '1',
        inputmode: 'numeric', value: String(cnt),
      });

      const commit = (target) => {
        assignWorkers(pop, job.id, target, counts);
        renderPopulation(root, planet);
      };

      minus.addEventListener('click', () => commit(cnt - 1));
      plus.addEventListener('click', () => commit(cnt + 1));
      full.addEventListener('click', () => commit(jobCapacity(pop, job.id, counts)));
      input.addEventListener('change', () => commit(input.value));
      // 回车直接生效，避免输入框失焦才提交
      input.addEventListener('keydown', (e) => { if (e.key === 'Enter') commit(input.value); });

      const sel = el('select', { title: '工作强度' });
      for (const w of WORK_INTENSITY) {
        const opt = el('option', { value: w.id, text: w.nameCn + ' ×' + w.outputMul });
        if (w.id === a.intensityId) opt.setAttribute('selected', 'selected');
        sel.appendChild(opt);
      }
      sel.addEventListener('change', (e) => {
        setJobIntensity(pop, job.id, e.target.value);
        renderPopulation(root, planet);
      });

      wrap.appendChild(el('div', { class: 'pop-job' }, [
        el('div', { class: 'name' }, [
          el('div', { text: job.nameCn }),
          el('div', { class: 'd', text: job.desc }),
        ]),
        minus, input, plus, full, sel,
      ]));
    }
    panel.appendChild(wrap);
  }

  // ---- v0.0.7：生产线区块（先选建筑、再选生产内容、分配人力）----
  renderProductionBlock(panel, root, planet);

  // ---- 隐藏岗位提示（只显示能分配的，所以要告诉玩家还剩多少没出现） ----
  const hidden = hiddenJobCount(counts);
  if (hidden > 0) {
    panel.appendChild(el('div', { class: 'pop-hint',
      text: '另有 ' + hidden + ' 个岗位因对应建筑尚未建成（或科技未解锁）而暂不显示——把建筑造出来，岗位就会出现。' }));
  }

  // ---- 底部汇总 ----
  const assigned = getAssigned(pop);
  panel.appendChild(el('div', { class: 'pop-unassigned' }, [
    el('span', { text: `已分配 ${fmtNum(assigned)} · 未分配人力 ${fmtNum(availLaborOf(planet, pop))}` }),
  ]));

  root.appendChild(panel);
}

// 供其它面板（如建筑/舰队）查询某岗位占用情况，避免重复实现
export function jobSlotText(pop, buildingId, counts) {
  return '空闲工位 ' + fmtNum(freeSlots(pop, buildingId, counts));
}

// ============================================================================
// v0.0.7：生产线区块
// ============================================================================
// 设计者要求把加工类建筑改成「生产线模式」：在人力面板新建生产线，先选建筑、
// 再选生产内容，合理分配人力。工人不计入「岗位分配」，单独占用建筑的产线工位池
// （= 建筑数 × 该建筑 jobs，由 core/production.js 的 lineSlotInfo 给出）。

// 配方投入产出数量标注：有机质 ×2 + 氧气 ×1 → 木头 ×1；设施配方标注「产出：设施」
function recipeQuantityText(r) {
  if (!r) return '';
  if (r.producesFacility) return '产出：设施';
  const ins = r.inputs || {};
  const outs = r.outputs || {};
  const inStr = Object.entries(ins).map(([k, v]) => k + ' ×' + fmtNum(v)).join(' + ');
  const outStr = Object.entries(outs).map(([k, v]) => k + ' ×' + fmtNum(v)).join(' + ');
  if (!inStr && !outStr) return '';
  if (!inStr) return '→ ' + outStr;
  if (!outStr) return inStr + ' →';
  return inStr + ' → ' + outStr;
}

// 速率数字统一走 core/format.js 的 fmtRate（固定 4 位小数，已是全项目唯一精度规则）

function buildingCountOf(planet, bid) {
  return Number(getBuildingCounts(planet)[bid] || 0);
}

// 尽力解析造船线（blueprintId）的蓝图名；未知结构时回退到 id
function resolveBlueprintName(bpId) {
  try {
    const acc = currentAccount();
    const bp = acc && acc.blueprint;
    if (bp && Array.isArray(bp.parts)) {
      const p = bp.parts.find((x) => x && x.id === bpId);
      if (p) return p.nameCn || p.name || bpId;
    }
    if (bp && bp.id === bpId) return bp.nameCn || bp.name || bpId;
  } catch (e) { /* 忽略解析失败 */ }
  return null;
}

// 生产线的一行文本：建筑类型 · 生产内容（含数量）
function lineContentLabel(planet, line) {
  // v0.2.0 军队组装线：无配方，按蓝图命名
  if (line.armyBlueprintId) {
    const ab = ARMY_BP_BY_ID[line.armyBlueprintId];
    return (ab ? ab.nameCn : line.armyBlueprintId) + '（组装军队）';
  }
  if (line.blueprintId) {
    const name = resolveBlueprintName(line.blueprintId);
    return (name ? name : line.blueprintId) + '（造船）';
  }
  const recs = PR.recipesForBuilding(planet, line.buildingId, currentAccount());
  const rec = recs.find((r) => r.id === line.recipeId) || null;
  const base = rec ? rec.nameCn : (line.recipeId || '未知内容');
  return base + (rec ? (' ' + recipeQuantityText(rec)) : '');
}

function renderProductionBlock(panel, root, planet) {
  // 函数存在性守卫：核心模块的产线接口可能尚未落地，未就绪则不渲染、不报错
  const ready = typeof PR.addLine === 'function'
    && typeof PR.linesOf === 'function'
    && typeof PR.removeLine === 'function'
    && typeof PR.setLineWorkers === 'function'
    && typeof PR.setLineIntensity === 'function'
    && typeof PR.lineSlotInfo === 'function'
    && typeof PR.recipesForBuilding === 'function'
    && typeof PR.lineRateOf === 'function';
  if (!ready) return;

  const block = el('div', { class: 'pop-prod' });
  block.appendChild(el('div', { class: 'pop-prod-title', text: '生产线' }));
  block.appendChild(el('div', { class: 'pop-prod-sub',
    text: '在「建筑」面板建好加工厂后，在此新建生产线：先选建筑、再选生产内容，合理分配人力。'
      + '这里的人不计入上面的「岗位分配」——它们单独占用建筑的产线工位。' }));

  const linesWrap = el('div', { class: 'pop-lines' });
  block.appendChild(linesWrap);

  // 新建表单的临时状态
  const draft = { buildingId: null, recipeId: null, material: null };
  // 刷新引用的当前集合（每秒只更新其中的数字文本，不重建）
  let refs = { overviews: [], lineRows: [] };

  // ---- 新建生产线表单（三段式：选建筑 → 选生产内容 → 人数/材料）----
  function buildNewLineForm() {
    const form = el('div', { class: 'pop-newline' });
    form.appendChild(el('div', { class: 'pop-newline-title', text: '新建生产线' }));

    // 第一步：选建筑（已建成≥1 且可选项非空），并显示该建筑工位占用
    const builtOptions = BUILDINGS.filter((b) => {
      const n = buildingCountOf(planet, b.id);
      return n > 0 && PR.recipesForBuilding(planet, b.id, currentAccount()).length > 0;
    });
    const bSel = el('select', { class: 'pop-sel', title: '第一步：选择建筑' });
    bSel.appendChild(el('option', { value: '', text: '① 选择建筑…' }));
    for (const b of builtOptions) {
      const info = PR.lineSlotInfo(planet, b.id);
      bSel.appendChild(el('option', { value: b.id,
        text: b.nameCn + '（已用 ' + fmtNum(info.used) + ' / 总数 ' + fmtNum(info.total) + '）' }));
    }

    // 第二步：选生产内容（标注投入产出数量）
    const rSel = el('select', { class: 'pop-sel', title: '第二步：选择生产内容' });
    rSel.appendChild(el('option', { value: '', text: '② 选择生产内容…' }));
    rSel.disabled = true;

    // 第三步：材料下拉（仅部件配方带 materials 时出现）+ 人数 + 确认
    const mSel = el('select', { class: 'pop-sel pop-sel-mat', title: '第三步：选择材料' });
    mSel.style.display = 'none';
    const wLabel = el('span', { class: 'pop-wlabel', text: '人数' });
    const wInput = el('input', { class: 'pop-wcnt', type: 'number', min: '0', step: '1', inputmode: 'numeric', value: '0' });
    wInput.disabled = true;
    const confirmBtn = el('button', { class: 'btn btn-primary', text: '确认新建' });
    confirmBtn.disabled = true;
    const reason = el('div', { class: 'pop-newline-reason' });

    bSel.addEventListener('change', () => {
      reason.textContent = '';
      const bid = bSel.value;
      draft.buildingId = bid || null;
      draft.recipeId = null;
      draft.material = null;
      rSel.innerHTML = '';
      rSel.appendChild(el('option', { value: '', text: '② 选择生产内容…' }));
      if (!bid) {
        rSel.disabled = true;
        mSel.style.display = 'none';
        wInput.disabled = true;
        confirmBtn.disabled = true;
        return;
      }
      for (const r of PR.recipesForBuilding(planet, bid, currentAccount())) {
        rSel.appendChild(el('option', { value: r.id, text: r.nameCn + '　' + recipeQuantityText(r) }));
      }
      rSel.disabled = false;
      wInput.disabled = false;
      confirmBtn.disabled = false;
    });

    rSel.addEventListener('change', () => {
      reason.textContent = '';
      const rid = rSel.value;
      draft.recipeId = rid || null;
      draft.material = null;
      mSel.style.display = 'none';
      mSel.innerHTML = '';
      if (!rid) return;
      const rec = PR.recipesForBuilding(planet, draft.buildingId, currentAccount()).find((r) => r.id === rid);
      if (rec && Array.isArray(rec.materials) && rec.materials.length) {
        const def = rec.defaultMaterial || rec.materials[0];
        for (const m of rec.materials) {
          const o = el('option', { value: m, text: m });
          if (m === def) o.setAttribute('selected', 'selected');
          mSel.appendChild(o);
        }
        draft.material = def;
        mSel.style.display = '';
      }
    });
    mSel.addEventListener('change', () => { draft.material = mSel.value; });

    confirmBtn.addEventListener('click', () => {
      reason.textContent = '';
      const bid = draft.buildingId;
      const rid = draft.recipeId;
      if (!bid || !rid) { reason.textContent = '请先选择建筑与生产内容。'; return; }
      let w = Math.floor(Number(wInput.value) || 0);
      if (!(w >= 0)) w = 0;
      const info = PR.lineSlotInfo(planet, bid);
      const max = info.free > 0 ? info.free : 0;   // 新线：上限 = 空闲工位
      if (w > max) { w = max; reason.textContent = '人数已夹取到上限 ' + max + '（该建筑空闲工位）。'; }
      const opts = { workers: w };
      if (draft.material) opts.material = draft.material;
      const res = PR.addLine(planet, bid, rid, opts);
      if (!res || !res.ok) { reason.textContent = (res && res.reason) || '新建失败。'; return; }
      // 重置表单
      bSel.value = '';
      rSel.innerHTML = '';
      rSel.appendChild(el('option', { value: '', text: '② 选择生产内容…' }));
      rSel.disabled = true;
      mSel.style.display = 'none';
      mSel.innerHTML = '';
      wInput.value = '0';
      wInput.disabled = false;
      confirmBtn.disabled = true;
      draft.buildingId = null;
      draft.recipeId = null;
      draft.material = null;
      rebuild();
    });

    const row1 = el('div', { class: 'pop-newline-row' }, [bSel]);
    const row2 = el('div', { class: 'pop-newline-row' }, [rSel]);
    const row3 = el('div', { class: 'pop-newline-row' }, [mSel, wLabel, wInput, confirmBtn]);
    form.appendChild(row1);
    form.appendChild(row2);
    form.appendChild(row3);
    form.appendChild(reason);
    return form;
  }

  // ---- 单条生产线行 ----
  // v0.1.3（需求 1）：每条线标明「生产效率」——实际产出速率（含断供/缺电折减）+ 降速原因。
  //   速率口径统一走 fmtRate（铁律：禁止手拼 '/s'）。
  function lineRateText(planet, line) {
    const rate = PR.lineRateOf(planet, line);
    if (!(rate > 0)) return '';
    let txt = '　产出速率 ' + fmtRate(rate);
    const supply = Number(line._ratio);
    if (Number.isFinite(supply) && supply < 1) txt += '（缺料 ×' + supply.toFixed(2) + '）';
    else {
      const pr = Number(planet.powerInfo && planet.powerInfo.ratio);
      if (Number.isFinite(pr) && pr < 1) txt += '（缺电 ×' + pr.toFixed(2) + '）';
    }
    return txt;
  }

  function buildLineRow(line) {
    const row = el('div', { class: 'fac-row' });
    const label = (BUILDING_BY_ID[line.buildingId] ? BUILDING_BY_ID[line.buildingId].nameCn : line.buildingId)
      + ' · ' + lineContentLabel(planet, line);
    row.appendChild(el('div', { class: 'fac-line1' }, [el('span', { class: 'fac-title', text: label })]));

    const w = line.workers || 0;
    const minus = el('button', { class: 'pop-step', text: '−', title: '减少 1 人' });
    const plus = el('button', { class: 'pop-step', text: '＋', title: '增加 1 人' });
    const input = el('input', { class: 'pop-wcnt', type: 'number', min: '0', step: '1', inputmode: 'numeric', value: String(w) });
    const rateEl = el('span', { class: 'pop-line-rate' });
    const del = el('button', { class: 'pop-line-del', text: '删除', title: '删除这条生产线' });

    // 每条线单独的工作强度下拉（默认当前值：线自带或全局）
    const curInt = line.intensityId || (planet.pop && planet.pop.intensityId) || 'standard';
    const intSel = el('select', { class: 'pop-line-int', title: '工作强度' });
    for (const w of WORK_INTENSITY) {
      const opt = el('option', { value: w.id, text: w.nameCn + ' ×' + w.outputMul });
      if (w.id === curInt) opt.setAttribute('selected', 'selected');
      intSel.appendChild(opt);
    }
    intSel.addEventListener('change', () => {
      PR.setLineIntensity(planet, line.id, intSel.value);
      rebuild();
    });

    const commit = (n) => {
      n = Math.floor(Number(n) || 0);
      if (!(n >= 0)) n = 0;
      const info = PR.lineSlotInfo(planet, line.buildingId);
      // 上限 = 总数 −（已用 − 本线已有），即本线还能再分到的上限
      const max = info.total - (info.used - (line.workers || 0));
      if (max < 0) { n = 0; } else if (n > max) { n = max; }
      const res = PR.setLineWorkers(planet, line.id, n);
      if (!res || !res.ok) { rebuild(); return; }
      line.workers = res.workers;
      rebuild();
    };
    minus.addEventListener('click', () => commit(w - 1));
    plus.addEventListener('click', () => commit(w + 1));
    input.addEventListener('change', () => commit(input.value));
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') commit(input.value); });
    del.addEventListener('click', () => {
      const ok = PR.removeLine(planet, line.id);
      if (ok) rebuild();
    });

    row.appendChild(el('div', { class: 'fac-line2' }, [
      el('span', { class: 'pop-wlabel', text: '人数' }), minus, input, plus, intSel, rateEl, del,
    ]));
    // v0.1.3：创建行时立即填一次效率，不等 1 秒定时器（否则首屏是空的）
    if (rateEl) rateEl.textContent = lineRateText(planet, line);
    refs.lineRows.push({ line, input, rateEl });
    return row;
  }

  // ---- 整块重建（按钮触发的离散动作才调用；每秒刷新只改数字文本）----
  function rebuild() {
    linesWrap.innerHTML = '';
    refs = { overviews: [], lineRows: [] };

    linesWrap.appendChild(buildNewLineForm());

    const lines = PR.linesOf(planet);
    const lineBids = new Set(lines.map((l) => l.buildingId));

    // 工位总览：覆盖「有生产线」或「已建成且有可选配方」的每种建筑
    const ovBids = new Set(lineBids);
    for (const b of BUILDINGS) {
      const n = buildingCountOf(planet, b.id);
      if (n > 0 && PR.recipesForBuilding(planet, b.id, currentAccount()).length) ovBids.add(b.id);
    }
    for (const bid of ovBids) {
      const info = PR.lineSlotInfo(planet, bid);
      const over = info.used > info.total;
      const ov = el('div', { class: 'pop-ov' + (over ? ' over' : '') });
      ov.appendChild(el('span', { class: 'pop-ov-name', text: (BUILDING_BY_ID[bid] ? BUILDING_BY_ID[bid].nameCn : bid) }));
      const usedEl = el('span', { class: 'pop-ov-used', text: fmtNum(info.used) });
      const totalEl = el('span', { class: 'pop-ov-total', text: fmtNum(info.total) });
      ov.appendChild(el('span', { class: 'pop-ov-label', text: ' 工位 已用 ' }));
      ov.appendChild(usedEl);
      ov.appendChild(el('span', { class: 'pop-ov-label', text: ' / 总数 ' }));
      ov.appendChild(totalEl);
      refs.overviews.push({ bid, root: ov, usedEl, totalEl });
      linesWrap.appendChild(ov);
    }

    // 生产线列表：按建筑分组
    let anyLine = false;
    for (const bid of lineBids) {
      anyLine = true;
      const g = el('div', { class: 'pop-line-group' });
      g.appendChild(el('div', { class: 'pop-line-group-head', text: BUILDING_BY_ID[bid] ? BUILDING_BY_ID[bid].nameCn : bid }));
      for (const line of lines.filter((l) => l.buildingId === bid)) g.appendChild(buildLineRow(line));
      linesWrap.appendChild(g);
    }
    if (!anyLine) {
      linesWrap.appendChild(el('div', { class: 'pop-prod-empty', text: '还没有生产线。用上面的表单新建一条吧。' }));
    }
  }

  // ---- 每秒只刷新数字文本（不重建，避免丢失输入焦点）----
  function refreshNumbers() {
    if (!refs) return;
    for (const o of refs.overviews) {
      const info = PR.lineSlotInfo(planet, o.bid);
      if (o.usedEl) o.usedEl.textContent = fmtNum(info.used);
      if (o.totalEl) o.totalEl.textContent = fmtNum(info.total);
      if (o.root) o.root.classList.toggle('over', info.used > info.total);
    }
    for (const lr of refs.lineRows) {
      if (lr.rateEl) lr.rateEl.textContent = lineRateText(planet, lr.line);
      // 输入框非聚焦时才回写，避免打断正在输入的人数
      if (lr.input && document.activeElement !== lr.input) {
        lr.input.value = String(lr.line.workers || 0);
      }
    }
  }

  rebuild();
  panel.appendChild(block);

  // 每秒刷新数字（沿用现有面板的定时器写法：先判断面板是否还在、是否正在操作）
  if (root._popLineTimer) { clearInterval(root._popLineTimer); root._popLineTimer = null; }
  root._popLineTimer = setInterval(() => {
    if (!root.querySelector || !root.querySelector('.pop-prod')) { clearInterval(root._popLineTimer); root._popLineTimer = null; return; }
    const ae = (typeof document !== 'undefined' && document.activeElement) || null;
    if (ae && typeof root.contains === 'function' && root.contains(ae)) return;   // 正在操作，别打断
    refreshNumbers();
  }, 1000);
}

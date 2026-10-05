// 船坞界面（Astrix v0.0.4）
//
// ============================================================================
// 职责
// ============================================================================
// 两件事：
//   1. 蓝图编辑器——挑外壳、装引擎、加武器与设施、每件都能自选材料；
//      实时显示「容量 / 占地、槽位、总质量、推力、航速、起飞燃料、评估类型与强度」；
//      容量不足或超重时禁止建造并说明原因。
//   2. 飞船列表——点开任意一艘看它的物品栏与四项能量
//      （温度 / 内能 / 动能 / 势能〔相对最近星球〕），可改名、加注燃料、起飞。
//
// 全部数值计算都在 js/core/shipyard.js，本文件只负责渲染与交互。

import { MATERIALS } from '../data/materials.js?v=49.2';
import {
  HULLS, ENGINES, WEAPONS, FACILITIES,
  MATERIAL_SLOTS, DEFAULT_MATERIAL,
  isPartUnlocked,
} from '../data/ship_parts.js?v=49.2';
import { POWER_FACILITIES, POWER_FACILITY_BY_ID } from '../data/facilities.js?v=49.2';
import { FUELS } from '../data/fuels.js?v=49.2';
import {
  emptyBlueprint, evaluateBlueprint, launchShip, tickShip,
  resolvePart, materialMul, materialOptionsFor, safeTempBand, tempStatus, envTempK, equilibriumTemp,
  ensureBlueprints, shipBuildCheck, findBlueprint, blueprintBuildCost,
  blueprintOfShip,
} from '../core/shipyard.js?v=49.2';
import { BUILDING_BY_ID } from '../data/buildings.js?v=49.2';
import { fmtNum, fmtTime } from '../core/format.js?v=49.2';
// v0.0.5：建筑计数已迁到星球实例（inst.buildings），船坞工占用来自人力系统
import { getPlanetInstance, getBuildingCounts, currentAccount } from '../core/state.js?v=49.2';
import { jobsOfBuilding, getJobCount, buildingSlots, assignedToBuilding, freeSlots, getIntensity } from '../core/population.js?v=49.2';
// v0.1.1（需求 3）：建造按钮改为创建 dock 造船线，走生产线的工位与人力结算
import { addLine, ensureLines, linesOf, removeLine, lineSlotInfo, freeLaborOf, materialLookup } from '../core/production.js?v=49.2';
// R19-2：造船除装备外按部件扣材料（spendOwned 整笔扣，ownedOf 查库存），不碰 core/state.js
import { ownedOf, spendOwned } from '../core/state.js?v=49.2';
// v0.4.7：el() 收敛到 ui/common.js（此前本文件自带一份；全项目共 14 份、两种不兼容签名，
//   v0.3.2「列强区块不显示」即源于把 A 型调用写进了 B 型文件）
import { el } from './common.js?v=49.2';

const SHIP_BUILDING_ID = 'dock';
const SHIP_TECH_ID = 't_e3';

function esc(s) {
  return String(s).replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
}

// 该部件 id 是否属于「船上设施列表」（用于从 bp.parts 里挑出设施行）。
// 既包含传统的 fac_*（乘员仓/仓库/机库/装甲），也包含 12 项电力设施
// （电池/光伏/风机/燃机，id 形如 battery_s），后者不在 PART_BY_ID 而在 POWER_FACILITY_BY_ID。
// ⚠ 之前这里写成 `startsWith('fac_')`，会把电力设施整组过滤掉——装得上、看不到、也算不到占地。
function isFacilityPartId(id) {
  return typeof id === 'string' && (id.startsWith('fac_') || !!POWER_FACILITY_BY_ID[id]);
}

// 设施下拉项文案。nameCn 已含尺寸（如「小型电池」），不要重复拼 sizeLabel。
// 电力设施无 crew/cargo/hangar/struct，补上储电/发电摘要（fmtNum 走 format.js）。
function facOptionLabel(f) {
  if (POWER_FACILITY_BY_ID[f.id]) {
    if (f.kind === 'storage') return `${f.nameCn}（储电 ${fmtNum(f.capacity)}）`;
    if (f.kind === 'thermal') return `${f.nameCn}（发电 ${fmtNum(f.powerOut)} · 耗${f.fuel} ${fmtNum(f.fuelPerSec)}）`;
    return `${f.nameCn}（发电 ${fmtNum(f.powerOut)}）`;
  }
  const extra = f.crew ? `载员 ${f.crew}` : f.cargoVol ? `货舱 ${f.cargoVol}`
    : f.hangarSlots ? `机位 ${f.hangarSlots}` : f.structAdd ? `强度 +${f.structAdd}` : '';
  return `${f.nameCn}（占地 ${f.footprint} · ${extra}）`;
}

// J → 可读能量文本
function fmtEnergy(j) {
  const v = Number(j) || 0;
  if (v === 0) return '0 J';
  const units = [[1e15, 'PJ'], [1e12, 'TJ'], [1e9, 'GJ'], [1e6, 'MJ'], [1e3, 'kJ']];
  for (const [k, u] of units) if (Math.abs(v) >= k) return (v / k).toFixed(2) + ' ' + u;
  return v.toFixed(1) + ' J';
}

// 确保账号上有舰船与蓝图字段（兼容旧存档）
function ensureShipFields(acc) {
  if (!Array.isArray(acc.ships)) acc.ships = [];
  if (!acc.blueprint || typeof acc.blueprint !== 'object') acc.blueprint = null;
  if (!Array.isArray(acc.buildings)) acc.buildings = [];
}

// 当前账号已研究的科技集合
function researchedOf(acc) {
  return new Set(Array.isArray(acc.tech) ? acc.tech : []);
}

// 已建成建筑的数量表 { buildingId: n }
// v0.0.5：建筑计数存在星球实例上（inst.buildings = { id: 座数 }），
// 旧存档的账号级 acc.buildings 数组只作兼容兜底。
function buildingCountsOf(ctx) {
  const code = (ctx && ctx.planetCode) || 'syl';
  const inst = getPlanetInstance(code);
  const counts = {};
  const raw = inst ? getBuildingCounts(inst) : {};
  for (const id in raw) counts[id] = Number(raw[id]) || 0;
  if (!Object.keys(counts).length) {
    const acc = (ctx && ctx.account) || {};
    for (const id of acc.buildings || []) counts[id] = (counts[id] || 0) + 1;
  }
  return { counts, inst };
}

// 该星球上船坞工的在岗人数（没有船坞工就造不出船）
export function dockWorkerCount(inst) {
  if (!inst || !inst.pop) return 0;
  let n = 0;
  for (const j of jobsOfBuilding(SHIP_BUILDING_ID)) n += getJobCount(inst.pop, j.id);
  return n;
}

// ============================================================================
// 造船门槛（v0.0.5，与「建筑工厂必须有人」同一套规则）
// ============================================================================
// 返回 null 表示可以开工；否则返回一句中文原因。
// 判定顺序：科技 → 船坞建筑 → 船坞里有没有分配到「船坞工」。
export function shipBuildBlockReason(inst, counts) {
  const c = counts || (inst ? getBuildingCounts(inst) : {});
  if (!(c[SHIP_BUILDING_ID] > 0)) {
    return '本星球还没有建成船坞，请先到「建筑」面板建一座船坞。';
  }
  if (dockWorkerCount(inst) <= 0) {
    return '船坞里没人：请到「人力」面板把工人分配到「船坞工」，否则船坞不会组装飞船。';
  }
  return null;
}

// 供 UI 与自检统一调用的就绪判定
export function isShipyardReady(inst, account) {
  const counts = inst ? getBuildingCounts(inst) : {};
  if (!(counts[SHIP_BUILDING_ID] > 0)) {
    return { ok: false, reason: '本星球还没有建成船坞，请先到「建筑」面板建一座船坞。' };
  }
  const reason = shipBuildBlockReason(inst, counts);
  if (reason) return { ok: false, reason };
  if (!account) return { ok: false, reason: '账号数据缺失。' };
  return { ok: true, reason: null };
}

// ============================================================================
// dock 造船线（v0.1.1，需求 3）
// ============================================================================
// 首选走 production.addLine 开线（dock 线约定：blueprintId 代替 recipeId）。
// addLine 的 dock 支持由生产线侧落地；若当前版本尚未支持（报「找不到该生产内容」），
// 则按 v0.0.7 冻结的造船线结构 { id, buildingId:'dock', blueprintId, workers }
// 就地建线，工位与人力上限用 production 导出的 lineSlotInfo / freeLaborOf 把关，
// 语义与 addLine 保持一致（每次点击 = 一条新线）。
let _dockLineSeq = 0;
export function createDockLine(inst, blueprintId, workers) {
  const res = addLine(inst, SHIP_BUILDING_ID, blueprintId, { workers, blueprintId });
  if (res.ok) {
    // 规范化：dock 线统一用 blueprintId 字段（ui/population.js 的线名解析按此字段读）
    if (res.line && res.line.blueprintId == null) res.line.blueprintId = blueprintId;
    if (res.line && res.line.recipeId === blueprintId) delete res.line.recipeId;
    return res;
  }
  if (res.reason !== '找不到该生产内容' && res.reason !== '该生产内容不能在此建筑上生产') return res;
  // 兜底建线（addLine 尚未支持 dock 时的临时路径，接口落地后自然不再触发）
  ensureLines(inst);
  const slot = lineSlotInfo(inst, SHIP_BUILDING_ID);
  if (workers > slot.free) return { ok: false, reason: '工位不足，还剩 ' + slot.free + ' 个' };
  const free = freeLaborOf(inst);
  if (workers > free) return { ok: false, reason: '可用人力不足，还剩 ' + free + ' 人' };
  _dockLineSeq = (_dockLineSeq + 1) % 100000;
  const line = { id: 'line_' + Date.now().toString(36) + '_' + _dockLineSeq, buildingId: SHIP_BUILDING_ID, blueprintId, workers };
  inst.lines.push(line);
  return { ok: true, line };
}

// ============================================================================
// 造船材料需求（R19-2）
// ============================================================================
// 蓝图按部件消耗材料：外壳 1 份（hullMaterial）、每台引擎 1 份、每个部件 1 份
// （material 为 null 的设施如乘员仓/货舱不耗材料，与 shipBuildCheck 的装备口径一致：
// 每件部件 = 1 单位）。蓝图里没有「每件材料数量」字段，故单位数 = 部件实例数。
export function blueprintMaterialNeeds(bp) {
  const need = {};
  const add = (mat) => { if (mat) need[mat] = (need[mat] || 0) + 1; };
  add(bp.hullMaterial);
  for (const e of (bp.engines || [])) add(e.material);
  for (const p of (bp.parts || [])) add(p.material);
  return need;
}

// 造船材料校验：任一材料不足时返回「缺少 XX×N」（N = 缺额），否则返回 null。
// 与 shipBuildCheck（校验装备/电力设施/合法性）互补——建造时除装备外再按部件扣材料。
// 调用方须「先整笔校验、再整笔扣」，绝不允许扣一半还下水（见 buildBlueprintEditor 的建造按钮）。
export function materialBuildBlockReason(inst, bp) {
  const need = blueprintMaterialNeeds(bp);
  const miss = [];
  for (const mat in need) {
    const have = ownedOf(inst, mat);
    const n = need[mat];
    if (have < n) miss.push(`${mat}×${n - have}`);
  }
  return miss.length ? '缺少 ' + miss.join('、') : null;
}

// 线的工作强度产出倍率（与 core/production.js 的 intensityMulOf 同口径：
// 优先用线自带的 intensityId，无则沿用全局 inst.pop.intensityId）
function lineIntensityMulOf(inst, line) {
  const id = (line && line.intensityId != null)
    ? line.intensityId
    : (inst && inst.pop ? inst.pop.intensityId : null);
  return Number(getIntensity(id).outputMul) || 0;
}

// 电力降速比（缺 inst.powerInfo 时按 1 估算，与 production.lineRateOf 一致）
function powerRatioOf(inst) {
  const r = inst && inst.powerInfo ? Number(inst.powerInfo.ratio) : NaN;
  return Number.isFinite(r) ? Math.max(0, r) : 1;
}

// 单条 dock 线的进度速率（进度/秒）= 工人 × 强度 × 电力比 / 蓝图工作量。
// 与 core/shipyard.js shipBuildTick 的推进口径一致（labor = workers × 强度倍率）。
function dockLineRateOf(inst, line, bp) {
  const C = blueprintBuildCost(bp);
  if (!(C > 0)) return 0;
  const workers = Number(line.workers) || 0;
  if (!(workers > 0)) return 0;
  const ratio = powerRatioOf(inst);
  if (!(ratio > 0)) return 0;
  return (workers * lineIntensityMulOf(inst, line) * ratio) / C;
}

// 造船线列表：蓝图名、工人数、进度条、预计剩余时长（进度速率反推，走 fmtTime）
function buildDockLinesSection(account, inst, rerender) {
  const box = el('div', 'yard-lines');
  box.appendChild(el('div', 'res-section-title', '造船线'));
  const lines = linesOf(inst, SHIP_BUILDING_ID);
  if (!lines.length) {
    box.appendChild(el('p', 'muted', '暂无造船线：在「设计与建造」页或蓝图卡点「建造」即可开工。'));
    return box;
  }
  const list = el('div', 'bp-shipyard-list');
  const progAll = (inst && inst.shipProgress && typeof inst.shipProgress === 'object') ? inst.shipProgress : {};
  for (const line of lines) {
    const bp = findBlueprint(account, line.blueprintId);
    const name = bp ? bp.nameCn : (line.blueprintId || '未知蓝图');
    const C = bp ? blueprintBuildCost(bp) : 0;
    const prog = Math.max(0, Math.min(1, Number(progAll[line.blueprintId]) || 0));
    const rate = bp ? dockLineRateOf(inst, line, bp) : 0;
    const workers = Number(line.workers) || 0;

    const card = el('div', 'bp-bp-card glass');
    const head = el('div', 'bp-bp-head');
    head.appendChild(el('span', 'bp-bp-name', name));
    head.appendChild(el('span', 'bp-bp-kind muted', '造船线 · ' + workers + ' 人'));
    card.appendChild(head);

    // 进度条（内联样式，避免依赖额外 CSS）
    const bar = el('div', 'bp-line-bar');
    bar.style.cssText = 'height:8px;border-radius:4px;background:#18222e;overflow:hidden;margin:6px 0;';
    const fill = el('div', 'bp-line-fill');
    fill.style.cssText = 'height:100%;background:#3fb6ff;border-radius:4px;';
    fill.style.width = Math.round(prog * 100) + '%';
    bar.appendChild(fill);
    card.appendChild(bar);

    const sub = el('div', 'bp-bp-sub muted');
    if (!(C > 0)) {
      sub.textContent = '蓝图工作量异常，无法推进。';
    } else if (prog >= 1 - 1e-6) {
      sub.textContent = '进度已满但缺料停滞：请补齐装备库存（缺件见上方蓝图卡）。';
    } else if (!(rate > 0)) {
      sub.textContent = workers > 0
        ? '暂停：电力不足，生产线停摆。'
        : '暂停：线上没有工人，请到「人力」面板给这条线加人。';
    } else {
      // 剩余时长 = 剩余工作量 ÷ 当前进度速率（口径与 shipBuildTick 一致）
      sub.textContent = '进度 ' + Math.round(prog * 100) + '% · 剩余 ' + fmtTime(((1 - prog) * C) / rate);
    }
    card.appendChild(sub);

    const cancel = el('button', 'btn btn-sm btn-danger', '取消造船线');
    cancel.onclick = () => {
      removeLine(inst, line.id);
      rerender();
    };
    card.appendChild(cancel);
    list.appendChild(card);
  }
  box.appendChild(list);
  return box;
}

// ============================================================================
// 蓝图与建造（v0.0.7）：只读展示账号的全部蓝图、可建造性、缺件清单与建造进度。
// 这里不做「新建造船生产线」（在人力面板），只展示 + 「设为当前蓝图」按钮。
// ============================================================================
function buildBlueprintList(account, ctx, inst, rerender) {
  const box = el('div', 'yard-blueprints');
  box.appendChild(el('div', 'res-section-title', '蓝图与建造'));
  ensureBlueprints(account);
  if (!account.blueprints.length) {
    box.appendChild(el('p', 'bp-tip muted', '还没有已保存的蓝图，请到「设计与建造」里规划一艘。'));
    return box;
  }
  const grid = el('div', 'bp-shipyard-list');
  for (const bp of account.blueprints) {
    const card = el('div', 'bp-bp-card glass');
    // 标题行：蓝图名 + 类型
    const head = el('div', 'bp-bp-head');
    head.appendChild(el('span', 'bp-bp-name', bp.nameCn));
    head.appendChild(el('span', 'bp-bp-kind muted', bp.kind || ''));
    if (account.blueprint && account.blueprint.id === bp.id) {
      head.appendChild(el('span', 'bp-bp-current', '当前'));
    }
    card.appendChild(head);

    const chk = shipBuildCheck(inst, account, bp.id);
    const sub = el('div', 'bp-bp-sub muted');
    sub.textContent = '类型 ' + (bp.kind || '—') + ' · 外壳 ' + (bp.hullId || '—')
      + ' · 引擎 ' + (bp.engines ? bp.engines.length : 0) + ' · 部件 ' + (bp.parts ? bp.parts.length : 0);
    card.appendChild(sub);

    // 可建造性
    const status = el('div', 'bp-bp-status');
    if (chk.ok) {
      status.appendChild(el('span', 'bp-bp-ok', '可建造'));
    } else {
      for (const r of chk.reasons) status.appendChild(el('div', 'bp-bp-reason', r));
      if (chk.missing.length) {
        const miss = el('div', 'bp-bp-miss');
        for (const it of chk.missing) {
          const p = resolvePart(it.partId, it.material);
          const name = p ? p.nameCn : it.partId;
          miss.appendChild(el('span', 'bp-bp-miss-item', name + ' ×' + it.need));
        }
        status.appendChild(miss);
      }
    }
    card.appendChild(status);

    // 建造进度
    const prog = (inst && inst.shipProgress && Number(inst.shipProgress[bp.id])) || 0;
    const pct = Math.round(prog * 100);
    const progRow = el('div', 'bp-bp-prog muted');
    progRow.textContent = '进度 ' + pct + '%';
    card.appendChild(progRow);

    // 「设为当前蓝图」按钮
    const setBtn = el('button', 'btn btn-sm', '设为当前蓝图');
    setBtn.disabled = !!(account.blueprint && account.blueprint.id === bp.id);
    setBtn.addEventListener('click', () => {
      account.blueprint = bp;
      rerender();
    });
    card.appendChild(setBtn);

    grid.appendChild(card);
  }
  box.appendChild(grid);
  return box;
}

// ============================================================================
// 主渲染
// ============================================================================
export function renderShipyard(root, ctx) {
  const { account } = ctx || {};
  if (!account) {
    root.innerHTML = '<div class="placeholder glass"><div class="ph-title">账号数据缺失</div></div>';
    return;
  }
  ensureShipFields(account);

  root.innerHTML = '';
  const wrap = el('div', 'yard-wrap');
  const { counts, inst } = buildingCountsOf(ctx);
  const dockCount = counts[SHIP_BUILDING_ID] || 0;
  // v0.1.2：蓝图编辑器搬到「设计」分支时，把下面这行的 `researched` 定义一起删掉了，
  //   导致舰船页一打开就 ReferenceError（子页按钮都渲染不出来）。这里补回来。
  const researched = researchedOf(account);
  const techDone = researched.has(SHIP_TECH_ID);

  // ===== 门槛：必须先有船坞 =====
  if (!techDone || dockCount <= 0) {
    const ph = el('div', 'placeholder glass');
    ph.innerHTML =
      '<div class="ph-title">船坞尚未建成</div>'
      + '<div class="ph-sub muted">'
      + (!techDone
        ? '请先在「科研 → 科技」中研究 E3 船坞（前置 C2 深层矿井）。'
        : 'E3 船坞已研究，但本星球还没有建成船坞建筑——请到「建筑」面板建造一座船坞。')
      + '</div>';
    wrap.appendChild(ph);
    root.appendChild(wrap);
    // 门槛未达成：本页无产线可刷新，但仍需清掉上一轮可能残留的定时器
    if (root._yardTimer) { clearInterval(root._yardTimer); root._yardTimer = null; }
    return;
  }

  const dock = BUILDING_BY_ID[SHIP_BUILDING_ID];
  // v0.1.1（需求 4）：MK 分级已取消，顶部概览不再展示「可用型号」
  // v0.0.5：船坞工在岗情况（与建筑「建筑工硬门槛」同一套规则：没人就不开工）
  const dockWorkers = dockWorkerCount(inst);
  const dockSlots = buildingSlots(SHIP_BUILDING_ID, counts);
  const dockAssigned = assignedToBuilding(inst && inst.pop, SHIP_BUILDING_ID);
  const dockFree = freeSlots(inst && inst.pop, SHIP_BUILDING_ID, counts);

  // ===== 顶部概览 =====
  const head = el('div', 'yard-head glass');
  head.innerHTML =
    `<div class="yard-head-item"><span class="yard-k">船坞</span>`
    + `<span class="yard-v cyan">${dockCount} 座</span></div>`
    + `<div class="yard-head-item"><span class="yard-k">舰船</span>`
    + `<span class="yard-v">${account.ships.length} 艘</span></div>`
    + `<div class="yard-head-item"><span class="yard-k">船坞工</span>`
    + `<span class="yard-v ${dockWorkers > 0 ? 'cyan' : ''}">${dockWorkers} 人</span>`
    + `<span class="muted"> · 工位 ${fmtNum(dockSlots)} · 已指派 ${fmtNum(dockAssigned)} · 空闲 ${fmtNum(dockFree)}</span></div>`
    + `<div class="yard-head-item yard-note muted">`
    + (dockWorkers > 0
      ? `船坞在开工（每座船坞提供 ${dock ? dock.jobs : 0} 个工位）`
      : `船坞里没人：请到「人力」面板把工人分配到「船坞工」，否则无法组装飞船`) + '</div>';
  wrap.appendChild(head);

  // ===== 蓝图与建造（v0.0.7，只读展示）=====
  // R4：蓝图「编辑器」已迁到「舰队 → 设计」分支（js/ui/design.js 的 renderDesign），
  //   舰船分支只保留蓝图列表、造船线、编队与飞船列表，不再内嵌编辑器。
  wrap.appendChild(buildBlueprintList(account, ctx, inst, () => renderShipyard(root, ctx)));

  // ===== 造船线（v0.1.1，需求 3）：进行中的 dock 生产线 =====
  wrap.appendChild(buildDockLinesSection(account, inst, () => renderShipyard(root, ctx)));

  // ===== 飞船列表 =====
  const listTitle = el('div', 'res-section-title', `我的舰船（${account.ships.length}）`);
  wrap.appendChild(listTitle);

  if (account.ships.length === 0) {
    const ph = el('div', 'placeholder glass');
    ph.innerHTML = '<div class="ph-title">还没有舰船</div>'
      + '<div class="ph-sub muted">在「舰队 → 设计与建造」里配好一艘蓝图，点「建造」即可开 dock 造船线下水。</div>';
    wrap.appendChild(ph);
  } else {
    const list = el('div', 'yard-ships');
    for (const ship of account.ships) {
      list.appendChild(buildShipRow(ship, ctx, account, () => renderShipyard(root, ctx)));
    }
    wrap.appendChild(list);
  }

  root.appendChild(wrap);

  // ===== v0.3.3：每秒实时刷新 =====
  // 此前本页**完全没有 setInterval**：shipBuildTick 在后台每秒推进造船进度，
  // 但造船页只在「打开页面 / 点按钮」时算一次，导致玩家看到「造船线不动、时间不对」。
  // 守卫沿用 ui/army.js 的既有约定：
  //   * 不能用 root.isConnected —— planet.js 切 tab 复用同一个 contentInner，
  //     isConnected 恒 true，旧定时器会把本页重绘回去盖掉新 tab；
  //     故改用本页标记（.yard-wrap）+ tab 标题双重校验。
  //   * 先清旧定时器再建新，避免每次重绘叠加（此前 army 页出现过定时器泄漏）。
  //   * 用户正在输入/选择时跳过，避免打断操作。
  if (root._yardTimer) { clearInterval(root._yardTimer); root._yardTimer = null; }
  root._yardTimer = setInterval(() => {
    if (!root.querySelector || !root.querySelector('.yard-wrap')) {
      clearInterval(root._yardTimer); root._yardTimer = null; return;
    }
    const active = typeof document !== 'undefined' ? document.activeElement : null;
    if (active && root.contains(active) && (active.tagName === 'INPUT' || active.tagName === 'SELECT')) return;
    const accNow = ctx.account || currentAccount();
    if (!accNow) return;
    renderShipyard(root, Object.assign({}, ctx, { account: accNow }));
  }, 1000);
}

// ============================================================================
// 蓝图编辑器
// ============================================================================
export function buildBlueprintEditor(account, ctx, bp, researched, rerender, blockReason) {
  const box = el('div', 'bp-box');
  // v0.4.6：材料候选需要星球实例（读 inst.customMaterials 自定义合金）
  const inst = getPlanetInstance((bp && bp.planetCode) || (ctx && ctx.planetCode) || 'syl');

  // 可选部件（按已研究科技与型号过滤）
  const hullOptions = HULLS.filter((h) => isPartUnlocked(h.id, researched));
  const engineOptions = ENGINES.filter((e) => isPartUnlocked(e.id, researched));
  const weaponOptions = WEAPONS.filter((w) => isPartUnlocked(w.id, researched));
  const facOptions = [
    ...FACILITIES.filter((f) => isPartUnlocked(f.id, researched)),
    // 电力设施（电池/光伏/风机/燃机）：门槛是 B8 储电站科技是否已研究。
    // B8 是引入「设施」这套概念的科技节点，研究后 12 项全部可选；未研究则不显示。
    ...(researched.has('t_b8') ? POWER_FACILITIES : []),
  ];

  // 兜底：如果连一个外壳都没解锁（理论上不会），给个提示
  if (hullOptions.length === 0) {
    box.innerHTML = '<p class="muted">尚未解锁任何舰船外壳，请先研究「a 舰船外壳」。</p>';
    return box;
  }
  if (!hullOptions.some((h) => h.id === bp.hullId)) bp.hullId = hullOptions[0].id;

  // ---- 外壳 ----
  const hullRow = el('div', 'bp-row');
  hullRow.appendChild(el('span', 'bp-label', '外壳'));
  const hullSel = makeSelect(hullOptions.map((h) => [h.id, `${h.nameCn}（容量 ${h.capacity} · 槽位 ${h.slots}）`]), bp.hullId, (v) => {
    bp.hullId = v; rerender();
  });
  hullRow.appendChild(hullSel);
  hullRow.appendChild(makeMaterialSelect('hull', bp.hullMaterial, (v) => { bp.hullMaterial = v; rerender(); }, inst));
  box.appendChild(hullRow);

  // ---- 引擎 ----
  const engTitle = el('div', 'bp-sub', '引擎（最多 4 台）');
  box.appendChild(engTitle);
  (bp.engines || []).forEach((eng, i) => {
    const row = el('div', 'bp-row');
    row.appendChild(el('span', 'bp-label', '引擎' + (i + 1)));
    row.appendChild(makeSelect(engineOptions.map((e) => [e.id, `${e.nameCn}（推力 ${e.thrust} · ${e.mass}）`]), eng.id, (v) => {
      eng.id = v; rerender();
    }));
    row.appendChild(makeMaterialSelect('engine', eng.material, (v) => { eng.material = v; rerender(); }, inst));
    row.appendChild(removeButton(() => { bp.engines.splice(i, 1); rerender(); }));
    box.appendChild(row);
  });
  if ((bp.engines || []).length < 4) {
    box.appendChild(addButton('+ 加一台引擎', () => {
      bp.engines.push({ id: engineOptions[0] ? engineOptions[0].id : 'engine_basic', material: DEFAULT_MATERIAL.engine });
      rerender();
    }));
  }

  // ---- 武器 ----
  const wTitle = el('div', 'bp-sub', '舰载武器');
  box.appendChild(wTitle);
  const weaponParts = (bp.parts || []).map((p, i) => ({ p, i })).filter(({ p }) => p.id.startsWith('wpn_'));
  weaponParts.forEach(({ p, i }) => {
    const row = el('div', 'bp-row');
    row.appendChild(el('span', 'bp-label', '武器'));
    row.appendChild(makeSelect(weaponOptions.map((w) => [w.id, `${w.nameCn}（伤害 ${w.damage} · 占地 ${w.footprint}）`]), p.id, (v) => {
      p.id = v; rerender();
    }));
    row.appendChild(makeMaterialSelect('weapon', p.material, (v) => { p.material = v; rerender(); }, inst));
    row.appendChild(removeButton(() => { bp.parts.splice(i, 1); rerender(); }));
    box.appendChild(row);
  });
  if (weaponOptions.length) {
    box.appendChild(addButton('+ 加一件武器', () => {
      bp.parts.push({ id: weaponOptions[0].id, material: DEFAULT_MATERIAL.weapon });
      rerender();
    }));
  } else {
    box.appendChild(el('p', 'bp-tip muted', '尚未研究「c 武器」。'));
  }

  // ---- 船上设施 ----
  const fTitle = el('div', 'bp-sub', '船上设施');
  box.appendChild(fTitle);
  const facParts = (bp.parts || []).map((p, i) => ({ p, i })).filter(({ p }) => isFacilityPartId(p.id));
  facParts.forEach(({ p, i }) => {
    const row = el('div', 'bp-row');
    row.appendChild(el('span', 'bp-label', '设施'));
    row.appendChild(makeSelect(facOptions.map((f) => [f.id, facOptionLabel(f)]), p.id, (v) => { p.id = v; rerender(); }));
    const fac = facOptions.find((f) => f.id === p.id);
    if (fac && fac.materialSlot) {
      row.appendChild(makeMaterialSelect(fac.materialSlot, p.material, (v) => { p.material = v; rerender(); }));
    } else {
      row.appendChild(el('span', 'bp-gap'));
    }
    row.appendChild(removeButton(() => { bp.parts.splice(i, 1); rerender(); }));
    box.appendChild(row);
  });
  if (facOptions.length) {
    box.appendChild(addButton('+ 加一件设施', () => {
      bp.parts.push({ id: 'fac_crew_mk1', material: null });
      rerender();
    }));
  }

  // ---- 燃料与高度 ----
  const miscRow = el('div', 'bp-row');
  miscRow.appendChild(el('span', 'bp-label', '起飞燃料'));
  miscRow.appendChild(makeSelect(FUELS.map((f) => [f.nameCn, `${f.nameCn}（热值 ${fmtNum(f.heatValue)}）`]), bp.fuelName, (v) => {
    bp.fuelName = v; rerender();
  }));
  miscRow.appendChild(el('span', 'bp-label', '起始高度'));
  const alt = document.createElement('input');
  alt.type = 'number';
  alt.className = 'bp-input';
  alt.value = String(bp.altitudeM ?? 1000);
  alt.min = '0';
  alt.addEventListener('change', () => {
    bp.altitudeM = Math.max(0, Number(alt.value) || 0);
    rerender();
  });
  miscRow.appendChild(alt);
  box.appendChild(miscRow);

  // ---- 实时评估 ----
  const ev = evaluateBlueprint(bp, { researched, ships: account.ships });
  box.appendChild(buildEvalPanel(bp, ev, ctx.planetCode));

  // ---- 建造（v0.1.1，需求 3：改为创建 dock 造船线，耗时建造）----
  // 不再即时 createShip：点「建造」= 开一条 dock 生产线，由 state tick 推进
  // inst.shipProgress[blueprintId]，满进度且装备齐备时自动下水并扣装备/设施库存。
  const actions = el('div', 'bp-actions');
  const buildStatus = el('div', 'bp-build-status');
  const buildBtn = el('button', 'btn btn-primary', '建造');
  // v0.0.5：除了蓝图本身合法，还必须「船坞里有船坞工」才能开工
  buildBtn.disabled = !ev.ok || !!blockReason;
  buildBtn.onclick = () => {
    buildStatus.textContent = '';
    buildStatus.className = 'bp-build-status';
    if (blockReason) {
      buildStatus.textContent = blockReason;
      buildStatus.className = 'bp-build-status err';
      return;
    }
    const inst = getPlanetInstance(bp.planetCode || (ctx && ctx.planetCode) || 'syl');
    // 校验复用 shipBuildCheck：蓝图合法、部件解锁、装备库存、电力设施库存
    const chk = shipBuildCheck(inst, account, bp.id);
    if (!chk.ok) {
      const msgs = chk.reasons.slice();
      for (const it of chk.missing) {
        const p = resolvePart(it.partId, it.material);
        msgs.push((p ? p.nameCn : it.partId) + ' 库存不足（需 ' + it.need + ' · 有 ' + it.have + '）');
      }
      buildStatus.textContent = '无法开工：' + msgs.join('；');
      buildStatus.className = 'bp-build-status err';
      return;
    }
    // R19-2：材料校验（蓝图上按部件算材料需求）。材料不足直接中止，绝不扣一半还下水。
    const matReason = materialBuildBlockReason(inst, bp);
    if (matReason) {
      buildStatus.textContent = '无法开工：' + matReason;
      buildStatus.className = 'bp-build-status err';
      return;
    }
    // 齐备才整笔扣料（spendOwned 从持有最多的条目开始扣，扣够为止；上面已先校验全齐）
    const matNeeds = blueprintMaterialNeeds(bp);
    for (const mat in matNeeds) spendOwned(inst, mat, matNeeds[mat]);
    // 开线人数：把船坞剩余工位与可用人力一次性占满（上限内越多人造得越快）
    const slot = lineSlotInfo(inst, SHIP_BUILDING_ID);
    const free = freeLaborOf(inst);
    const want = Math.min(slot.free, free);
    if (want <= 0) {
      buildStatus.textContent = '无法开工：' + (slot.free <= 0 ? '船坞产线工位已满。' : '没有可分配的空闲人力。');
      buildStatus.className = 'bp-build-status err';
      return;
    }
    const res = createDockLine(inst, bp.id, want);
    if (!res.ok) {
      buildStatus.textContent = '无法开工：' + res.reason;
      buildStatus.className = 'bp-build-status err';
      return;
    }
    rerender();
  };
  actions.appendChild(buildBtn);
  const resetBtn = el('button', 'btn', '重置蓝图');
  resetBtn.onclick = () => {
    account.blueprint = emptyBlueprint();
    account.blueprint.planetCode = bp.planetCode;
    rerender();
  };
  actions.appendChild(resetBtn);
  box.appendChild(actions);
  // 行内结果（失败原因不弹窗，显示在按钮下方；成功后整体重绘、由「造船线」区反馈）
  box.appendChild(buildStatus);
  // 语义提示：同一蓝图重复点「建造」会再开一条新线并行加速（addLine 现有语义）
  const buildTip = el('div', 'bp-tip muted');
  buildTip.textContent = '点「建造」会创建一条造船线（耗时建造）：线上的工人推进进度，'
    + '满进度且装备库存齐备时自动下水并扣件。重复点击会另开一条新线，同蓝图多线并行加速。';
  box.appendChild(buildTip);
  // 门槛提示（不满足时给一句人话，说明为什么按钮点不动）
  if (blockReason) {
    const warn = el('div', 'bp-block muted');
    warn.textContent = blockReason;
    box.appendChild(warn);
  }

  return box;
}

// 评估面板：容量 / 质量 / 航速 / 起飞燃料 / 类型 / 强度
function buildEvalPanel(bp, ev, planetCode) {
  const panel = el('div', 'bp-eval glass');

  const rows = [
    ['容量占用', `${fmtNum(ev.footprint)} / ${fmtNum(ev.capacity)}`
      + (ev.footprintLeft < 0 ? ` <span class="bad">超 ${fmtNum(-ev.footprintLeft)}</span>` : '')],
    ['部件槽位', `${ev.slotsUsed} / ${ev.slots}`],
    ['总质量', `${fmtNum(ev.massT)}`],
    ['总推力', `${fmtNum(ev.thrust)}`],
    ['航速', `${fmtNum(ev.speed)}`],
    ['起飞燃料', `${fmtNum(ev.takeoffFuelMol)}`],
    ['结构强度', fmtNum(ev.agg.struct)],
    ['火力', ev.agg.damage ? `${fmtNum(ev.agg.damage)}（射程 ${fmtNum(ev.agg.rangeKm)}）` : '无武装'],
    ['载货 / 载员', `${fmtNum(ev.agg.cargoVol)} / ${fmtNum(ev.agg.crewMax)} 人`],
    ['耐热上限', `${fmtNum(ev.agg.maxTempK)}`],
    ['预计稳定温度', `${fmtNum(equilibriumTemp(bp, planetCode))}（环境 ${fmtNum(envTempK(planetCode))}）`],
  ];

  const grid = el('div', 'bp-eval-grid');
  for (const [k, v] of rows) {
    const cell = el('div', 'bp-eval-cell');
    cell.innerHTML = `<span class="bp-eval-k muted">${esc(k)}</span><span class="bp-eval-v">${v}</span>`;
    grid.appendChild(cell);
  }
  panel.appendChild(grid);

  // 评估结论
  const verdict = el('div', 'bp-verdict');
  verdict.innerHTML = `<span class="bp-v-name">${esc(ev.className)}</span>`
    + `<span class="bp-v-tag">${esc(ev.grade)}级</span>`
    + `<span class="bp-v-tag">强度 ${ev.strength}</span>`; // v0.1.1（需求 4）：不再展示 MK
  panel.appendChild(verdict);

  // 问题与提醒
  if (ev.errors.length) {
    const ul = el('ul', 'bp-issues err');
    ev.errors.forEach((e) => ul.appendChild(el('li', null, e)));
    panel.appendChild(ul);
  }
  if (ev.warnings.length) {
    const ul = el('ul', 'bp-issues warn');
    ev.warnings.forEach((w) => ul.appendChild(el('li', null, w)));
    panel.appendChild(ul);
  }
  return panel;
}

// ============================================================================
// 飞船行 + 详情
// ============================================================================
function buildShipRow(ship, ctx, account, rerender) {
  // v0.3.2：1936 剧本的历史战舰（kind='warship'）没有 Astrix 物理字段，
  //   走 HOI4 风格卡片，避免读取 TempK/massT 等缺失字段导致整页崩溃。
  if (ship.kind === 'warship') return buildHoiShipRow(ship, ctx, account, rerender);
  const st = ship.state;
  const ts = tempStatus(st.TempK, ship.stats.tempBandBonus);
  const row = el('div', 'yard-ship glass');

  // v0.1.1（需求 3/4）：舰船分区只留概要（名称/类型/容量/质量/航速）+ 该船的工作量，
  //   不展示蓝图部件明细。工作量口径 = core/shipyard.js blueprintBuildCost(ship.blueprint)
  //   = 6000 + 外壳容量×12 + 部件工作量合计×1.5（人·秒）。
  const work = (() => { const bp = blueprintOfShip(account, ship); return bp ? blueprintBuildCost(bp) : 0; })();
  const info = el('div', 'ys-info');
  info.innerHTML =
    `<div class="ys-name">${esc(ship.name)}</div>`
    + `<div class="ys-meta muted">${esc(ship.className)} · ${esc(ship.grade)}级 · 强度 ${ship.strength}</div>`
    + `<div class="ys-meta muted">容量 ${fmtNum(ship.stats.capacity)} · 质量 ${fmtNum(ship.stats.massT)}`
    + ` · 航速 ${fmtNum(ship.stats.speed)} · 工作量 ${fmtNum(work)}</div>`;
  row.appendChild(info);

  const badge = el('div', 'ys-badge ' + ts.id);
  badge.textContent = `${Math.round(st.TempK)} · ${ts.label}`;
  row.appendChild(badge);

  const open = el('button', 'btn btn-sm', '查看');
  open.onclick = () => openShipDetail(ship, ctx, account, rerender);
  row.appendChild(open);

  return row;
}

// v0.3.2：1936 历史战舰的舰船卡片（无 Astrix 物理字段，走 HOI4 风格）
function buildHoiShipRow(ship, ctx, account, rerender) {
  const row = el('div', 'yard-ship glass');
  const fleet = (account.fleets || []).find((f) => (f.shipIds || []).includes(ship.id));
  const info = el('div', 'ys-info');
  info.innerHTML =
    `<div class="ys-name">${esc(ship.nameCn)}</div>`
    + `<div class="ys-meta muted">${esc(ship.className)} · 强度 ${fmtNum(ship.strength || 0)} · HP ${fmtNum(ship.hp || 0)}</div>`
    + `<div class="ys-meta muted">航速 ${fmtNum((ship.stats && ship.stats.speed) || 0)} · ${esc(fleet ? ('隶属 ' + fleet.nameCn) : '未编队')}</div>`;
  row.appendChild(info);
  const open = el('button', 'btn btn-sm', '查看');
  open.onclick = () => openHoiShipDetail(ship, ctx, account, rerender);
  row.appendChild(open);
  return row;
}

// v0.3.2：1936 历史战舰的详情弹窗（HOI4 风格：舰级 / 强度 / HP / 航速 / 隶属舰队 / 状态）
function openHoiShipDetail(ship, ctx, account, rerender) {
  const body = el('div', 'sp-detail');
  const fleet = (account.fleets || []).find((f) => (f.shipIds || []).includes(ship.id));
  const kv = el('div', 'sp-kv');
  const rows = [
    ['舰名', ship.nameCn],
    ['舰级', ship.className],
    ['强度', fmtNum(ship.strength || 0)],
    ['装甲 / HP', fmtNum(ship.hp || 0)],
    ['航速', fmtNum((ship.stats && ship.stats.speed) || 0)],
    ['隶属舰队', fleet ? fleet.nameCn : '未编入任何舰队'],
    ['状态', (fleet && fleet.mission) ? ('执行任务：' + (fleet.mission.type || '—')) : '驻港待命'],
    ['服役日期', new Date(ship.commissionedAt || Date.now()).toLocaleDateString('zh-CN')],
  ];
  for (const [k, v] of rows) {
    const r = el('div', 'sp-row');
    r.innerHTML = `<span class="sp-k muted">${esc(k)}</span><span class="sp-v">${esc(v)}</span>`;
    kv.appendChild(r);
  }
  body.appendChild(kv);
  const tip = el('p', 'sp-temp-tip muted');
  tip.textContent = '这是 1936 剧本的历史战舰：在「舰队」页可将其编入舰队、执行巡航 / 运输 / 登陆等任务。';
  body.appendChild(tip);
  ctx.openModal({ title: ship.nameCn, body, sheet: true });
}

function openShipDetail(ship, ctx, account, rerender) {
  if (ship.kind === 'warship') { openHoiShipDetail(ship, ctx, account, rerender); return; }
  const body = el('div', 'sp-detail');

  // 每次操作后整体重建（温度/能量/船员都会变）
  const rebuild = () => {
    body.innerHTML = '';
    const s = ship.state;
    const band = safeTempBand(ship.stats.tempBandBonus);
    const ts = tempStatus(s.TempK, ship.stats.tempBandBonus);

    // ---- 状态概览 ----
    const kv = el('div', 'sp-kv');
    const lines = [
      ['类型', `${ship.className}（${ship.grade}级 · 强度 ${ship.strength}）`],
      // v0.1.1（需求 4）：MK 分级已取消，不再展示 MK 等级行
      ['质量 / 航速', `${fmtNum(ship.stats.massT)} · ${fmtNum(ship.stats.speed)}`],
      ['所在星球 / 高度', `${esc(s.planetCode)} · ${fmtNum(s.altitudeM)}`],
      ['当前速度', `${fmtNum(s.velocityMps)}`],
      ['燃料', `${esc(s.fuelName)} · ${fmtNum(s.fuelMol)}（起飞需 ${fmtNum(ship.stats.takeoffFuelMol)}）`],
      ['船员', `${fmtNum(s.crew)} / ${fmtNum(s.crewMax)}${s.derelict ? '（已全员死亡，成为幽灵船）' : ''}`],
      ['船体完整度', `${(s.hullIntegrity * 100).toFixed(1)}%`],
    ];
    for (const [k, v] of lines) {
      const row = el('div', 'sp-row');
      row.innerHTML = `<span class="sp-k muted">${esc(k)}</span><span class="sp-v">${v}</span>`;
      kv.appendChild(row);
    }
    body.appendChild(kv);

    // ---- 四项能量（温度 / 内能 / 动能 / 势能）----
    const eTitle = el('div', 'res-section-title', '物理状态');
    body.appendChild(eTitle);
    const egrid = el('div', 'sp-grid');
    const energyRows = [
      ['温度', `${fmtNum(s.TempK)}`, ts.label, ts.id],
      ['内能', fmtEnergy(s.internalEnergyJ), `热容 ${fmtNum(Math.round(ship.stats.heatCapacity / 1000))}`, ''],
      ['动能', fmtEnergy(s.kineticEnergyJ), '0.5·m·v²', ''],
      ['势能', fmtEnergy(s.potentialEnergyJ), '相对最近星球 · m·g·h', ''],
    ];
    for (const [k, v, sub, cls] of energyRows) {
      const c = el('div', 'sp-card glass' + (cls ? ' ' + cls : ''));
      c.innerHTML = `<div class="sp-card-k muted">${esc(k)}</div>`
        + `<div class="sp-card-v">${v}</div>`
        + `<div class="sp-card-s muted">${esc(sub)}</div>`;
      egrid.appendChild(c);
    }
    body.appendChild(egrid);

    // 温度安全区间提示
    const tip = el('p', 'sp-temp-tip muted');
    tip.textContent =
      `安全区间 ${band.min}~${band.max}，超出后开始死船员；`
      + `船体材料耐热上限 ${ship.stats.maxTempK}，超过会烧穿船体。`
      + `当前环境温度 ${envTempK(s.planetCode)}。`;
    body.appendChild(tip);

    // ---- 物品栏 ----
    const iTitle = el('div', 'res-section-title', '船上物品栏');
    body.appendChild(iTitle);
    const inv = el('div', 'sp-inv');
    const entries = Object.entries(ship.inventory || {}).filter(([, v]) => v > 0);
    if (entries.length === 0) {
      inv.innerHTML = '<p class="muted">空舱。</p>';
    } else {
      for (const [name, qty] of entries) {
        const r = el('div', 'sp-inv-row');
        r.innerHTML = `<span class="sp-inv-k">${esc(name)}</span><span class="sp-inv-v">${fmtNum(qty)}</span>`;
        inv.appendChild(r);
      }
    }
    body.appendChild(inv);

    // ---- 操作 ----
    const acts = el('div', 'sp-actions');

    // 加注燃料
    const fuelInput = document.createElement('input');
    fuelInput.type = 'number';
    fuelInput.className = 'bp-input';
    fuelInput.min = '0';
    fuelInput.value = '1000';
    const fuelBtn = el('button', 'btn btn-sm', '加注燃料');
    fuelBtn.onclick = () => {
      const n = Math.max(0, Number(fuelInput.value) || 0);
      ship.state.fuelMol += n;
      rebuild();
      rerender();
    };
    acts.append(fuelInput, fuelBtn);

    // 起飞
    const launchBtn = el('button', 'btn btn-sm btn-primary', ship.state.flying ? '降落 / 停航' : '起飞');
    launchBtn.onclick = () => {
      if (ship.state.flying) {
        ship.state.flying = false;
      } else {
        const r = launchShip(ship);
        if (!r.ok) {
          ctx.openModal({ title: '无法起飞', body: simpleBody(esc(r.reason)), sheet: true });
          return;
        }
      }
      rebuild();
      rerender();
    };
    acts.appendChild(launchBtn);

    // 推进 60 秒（手动推演，便于观察温度与能量变化）
    const tickBtn = el('button', 'btn btn-sm', '推演 60 秒');
    tickBtn.onclick = () => {
      // v0.4.7：传 acc —— 蓝图不再随船存储，tickShip 需按 blueprintId 回查
      for (let i = 0; i < 60; i++) tickShip(ship, 1, { planetCode: s.planetCode, acc: account });
      rebuild();
      rerender();
    };
    acts.appendChild(tickBtn);

    // 改名
    const nameInput = document.createElement('input');
    nameInput.type = 'text';
    nameInput.className = 'bp-input bp-input-wide';
    nameInput.value = ship.name;
    const nameBtn = el('button', 'btn btn-sm', '改名');
    nameBtn.onclick = () => {
      const v = nameInput.value.trim();
      if (v) ship.name = v;
      rebuild();
      rerender();
    };
    acts.append(nameInput, nameBtn);

    // 拆解
    const scrapBtn = el('button', 'btn btn-sm btn-danger', '拆解');
    scrapBtn.onclick = () => {
      account.ships = account.ships.filter((x) => x.id !== ship.id);
      closeModal();
      rerender();
    };
    acts.appendChild(scrapBtn);

    body.appendChild(acts);
  };

  rebuild();
  const closeModal = ctx.openModal({ title: ship.name, body, sheet: true });
}

// ============================================================================
// 小工具
// ============================================================================
function makeSelect(options, value, onChange) {
  const sel = document.createElement('select');
  sel.className = 'bp-select';
  for (const [v, label] of options) {
    const o = document.createElement('option');
    o.value = v;
    o.textContent = label;
    sel.appendChild(o);
  }
  sel.value = value;
  sel.addEventListener('change', () => onChange(sel.value));
  return sel;
}

// v0.4.6 需求 11：候选材料改为**全材料**（含自定义化工厂造出来的合金），
//   唯一门槛是不能用气体。MATERIAL_SLOTS 降级为「推荐」标记（只影响排序与提示）。
function makeMaterialSelect(slot, value, onChange, inst) {
  const opts = materialOptionsFor(slot, inst, { lookup: materialLookup(inst) });
  const rows = opts.map((o) => {
    const tags = [];
    if (o.custom) tags.push('自造');
    if (o.recommended) tags.push('推荐');
    const suffix = tags.length ? ' · ' + tags.join(' ') : '';
    return [o.name, `${o.name}（结构 ×${o.structMul.toFixed(2)} · 质量 ×${o.massMul.toFixed(2)}${suffix}）`];
  });
  if (value && !opts.some((o) => o.name === value)) rows.unshift([value, `${value}（当前蓝图所用）`]);
  return makeSelect(rows, value || DEFAULT_MATERIAL[slot], onChange);
}

function addButton(label, onClick) {
  const b = el('button', 'btn btn-sm bp-add', label);
  b.onclick = onClick;
  return b;
}

function removeButton(onClick) {
  const b = el('button', 'btn btn-sm btn-danger bp-remove', '移除');
  b.onclick = onClick;
  return b;
}

function simpleBody(html) {
  const d = document.createElement('div');
  d.innerHTML = '<p class="sp-simple">' + html + '</p>';
  return d;
}

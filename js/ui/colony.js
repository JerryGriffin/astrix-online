// 殖民地管理面板（Astrix v0.1.1；零依赖原生 ES module）
// 列出**已发现**的星球（母星 + 探索发现 + 老存档已占领 + 商店星入口），展示殖民状态、
// 人口、幸福度、庇护覆盖率、管理模式（托管说明与贡品比例）、资源概况、能量池与环境乘数，
// 并提供「进入 / 殖民」操作。
//
// 铁律：
//  - 先「探索到」（acc.discovered）才能管理：未发现的星球不展示、不可殖民。
//  - 渲染列表时**绝不**对未殖民星球调用 getPlanetInstance（那会惰性建实例=误殖民）。
//    只看 STATE.planets 里已存在的实例判断「是否已殖民」；未殖民的只读星球静态数据。
//  - 只有点击「殖民」确认后，才 capturePlanet（登记进 acc.capturedPlanets）+ getPlanetInstance。
//  - 商店星 ast1 是公共的（所有旅行者共用）：显示徽标、隐藏殖民/管理按钮，绝不自动 capturePlanet。
//  - 所有数字走 js/core/format.js；文本一律用 el({text})（textContent）做 HTML 转义。
//  - 样式内联注入，不碰 css/ 目录。

import { PLANETS } from '../data/planets.js?v=20.13';
import {
  STATE, getPlanetInstance, shelterRatio, ownedOf,
} from '../core/state.js?v=20.13';
import { fmtNum } from '../core/format.js?v=20.13';
// v0.1.2（R8）：调派人力从母星扣「可用人力」，走 population.js 既有接口，不硬改字段
import { getAvailable } from '../core/population.js?v=20.13';
// v0.1.5（需求 2）：运输物资到殖民地 —— 复用 fleet.js 的运输任务（startMission + listFleets）
import { startMission, listFleets } from '../core/fleet.js?v=20.13';
// v0.0.93：商店星 Ast1（独立星球入口）+ 商店面板（舰队页复用）
import { SHOP_PLANET } from '../core/shop.js?v=20.13';
// v0.1.1：发现门禁 + 商店星拦截 + 托管说明
import {
  capturePlanet, ensureDiscoveredDefaults, purgeShopColonies,
  modeOf, TRIBUTE_RATES, MANAGEMENT_MODES,
} from '../core/planetgen.js?v=20.13';
import { renderShop } from './fleet.js?v=20.13';
// v0.2.1：殖民地报告内联化 —— 每颗星球行内直接显示最新报告（不再弹右下角提示条）
import { reportTextOf } from './reports.js?v=20.13';

const CSS = `
  .col-panel { font-family: system-ui, -apple-system, "Segoe UI", sans-serif; color: #e8eef2; padding: 12px; box-sizing: border-box; max-width: 960px; margin: 0 auto; }
  .col-title { font-size: 16px; font-weight: 700; margin: 0 0 4px; color: #9FE1CB; }
  .col-sub { font-size: 12px; opacity: .6; margin: 0 0 12px; }
  .col-overview { display: grid; grid-template-columns: repeat(auto-fit, minmax(140px, 1fr)); gap: 8px; margin-bottom: 12px; }
  .col-ov-item { background: #16202b; border: 1px solid #2a3645; border-radius: 10px; padding: 9px 11px; }
  .col-ov-label { font-size: 11px; opacity: .65; }
  .col-ov-val { display: block; font-size: 18px; font-weight: 700; color: #5DCAA5; margin-top: 3px; }
  .col-ov-val.cyan { color: #5cc8e0; }
  .col-list { display: flex; flex-direction: column; gap: 8px; }
  .col-row { background: #1b2530; border: 1px solid #223040; border-radius: 12px; padding: 10px 12px; display: grid; grid-template-columns: 1fr auto; gap: 8px 12px; align-items: center; }
  .col-row.can-rebel { border-color: #5a3340; }
  .col-row.shop-row { border-color: #3a5a78; }
  .col-main { min-width: 0; }
  .col-row-head { display: flex; align-items: baseline; gap: 8px; flex-wrap: wrap; }
  .col-name { font-size: 15px; font-weight: 700; }
  .col-en { font-size: 12px; opacity: .6; }
  .col-type { font-size: 11px; padding: 2px 7px; border-radius: 6px; background: #16202b; border: 1px solid #2a3645; color: #9FE1CB; }
  .col-badge-shop { font-size: 11px; padding: 2px 7px; border-radius: 6px; background: #233648; border: 1px solid #3a5a78; color: #ffd27f; }
  .col-line { font-size: 12px; line-height: 1.7; margin-top: 3px; }
  .col-line .k { opacity: .65; }
  .col-status.col-yes { color: #9FE1CB; font-weight: 600; }
  .col-status.col-no { color: #f09595; font-weight: 600; }
  .col-badge-rebel { font-size: 11px; padding: 2px 7px; border-radius: 6px; background: #3a2a2a; color: #ffd9d9; margin-left: 6px; }
  .col-note { font-size: 11px; color: #f09595; opacity: .85; }
  .col-manage { font-size: 11px; color: #ffd27f; opacity: .95; }
  .col-manage.assimilated { color: #9FE1CB; }
  /* v0.2.1：殖民地报告内联行（取代右下角弹窗） */
  .col-report { font-size: 11px; color: #9FE1CB; opacity: .92; margin-top: 5px; line-height: 1.6; background: rgba(159,225,203,0.07); border: 1px solid rgba(159,225,203,0.18); border-radius: 8px; padding: 5px 8px; }
  .col-res { font-size: 11px; opacity: .8; margin-top: 4px; line-height: 1.6; }
  .col-energy { font-size: 11px; opacity: .85; margin-top: 2px; }
  .col-energy .env-hydro { color: #5cc8e0; }
  .col-energy .env-wind { color: #9FE1CB; }
  .col-energy .env-solar { color: #ffd27f; }
  .col-btn { min-height: 40px; min-width: 76px; border: none; border-radius: 9px; font-weight: 600; cursor: pointer; padding: 0 14px; align-self: center; }
  .col-colonize { background: #2d5b7a; color: #fff; }
  .col-colonize:hover { background: #356b8f; }
  .col-enter { background: #245a4a; color: #d6fff0; }
  .col-enter:hover { background: #2c6d59; }
  .col-btn[disabled] { background: #28323d; color: #7d8a97; cursor: not-allowed; }
  /* v0.1.2（R7/R8）：管理模式下拉 + 殖民确认里的调派人力下拉 */
  .col-manage-sel, .col-confirm-sel { font-size: 12px; background: #16202b; color: #e8eef2; border: 1px solid #2a3645; border-radius: 6px; padding: 3px 6px; max-width: 160px; }
  .col-confirm-row { font-size: 12px; margin: 4px 0; }
  .col-confirm-note { font-size: 11px; color: #9FE1CB; opacity: .9; margin: 2px 0 8px; line-height: 1.6; }
  .col-confirm-note.warn { color: #f09595; }
  .col-foot { font-size: 12px; opacity: .65; line-height: 1.7; margin-top: 14px; padding: 10px 12px; background: #16202b; border: 1px solid #2a3645; border-radius: 10px; }
  .col-foot b { color: #9FE1CB; }
  /* 殖民确认模态（body 为 DOM 节点，沿用主题色） */
  .col-confirm-text { font-size: 13px; line-height: 1.6; margin: 0 0 6px; }
  .col-confirm-warn { font-size: 12px; color: #f09595; line-height: 1.6; margin: 0 0 10px; }
  .col-confirm-btns { display: flex; gap: 8px; justify-content: flex-end; }
  .col-confirm-btns .col-btn { min-width: 64px; }
  @media (max-width: 560px) {
    .col-row { grid-template-columns: 1fr; }
    .col-btn { width: 100%; }
  }
`;

// 建立节点的小工具（照抄 buildings.js 的模式；text 走 textContent，自动转义）
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

// 取某 code 的已殖民实例（只读 STATE.planets，绝不惰性创建）
function instanceOf(code) {
  return STATE.planets.find((p) => p.code === code) || null;
}

// ============================================================================
// v0.1.2（R5 / R8）纯函数：进入门槛 + 调派人力
// 抽成模块级导出，便于探针（docs/_probe_planet.mjs）直接断言，不依赖 DOM。
// ============================================================================

// R5 进入门槛：只有母星或已同化（领土模式）的星球能「进入」，其余只能看概况。
export function canEnterPlanet(inst) {
  if (!inst) return false;
  return !!inst.isHome || modeOf(inst).id === 'territory';
}

// R8 调派人力：从母星实例扣 N 个可用人力，加到新星实例上。
//   · 走 population.js 的 getAvailable / pop.total 接口，不硬改 available 等派生字段；
//   · 实际调派数 = min(N, 母星可用人力)，不会把母星抽成负数；
//   · 返回真正调派的人数（用于核对「母星减、新星加、总数守恒」）。
export function dispatchWorkforce(homeInst, newInst, n) {
  if (!homeInst || !homeInst.pop || !newInst || !newInst.pop || !(n > 0)) return 0;
  const avail = getAvailable(homeInst.pop);
  const move = Math.max(0, Math.min(Math.floor(Number(n) || 0), Math.floor(avail)));
  if (move <= 0) return 0;
  homeInst.pop.total = Math.max(0, (Number(homeInst.pop.total) || 0) - move);
  newInst.pop.total = (Number(newInst.pop.total) || 0) + move;
  return move;
}

// 资源概况：地表 / 地下 / 地核 / 气体 各几种
function resourceSummary(p) {
  const layers = p.layers || {};
  const surface = (layers.surface || []).length;
  const underground = (layers.underground || []).length;
  const core = (layers.core || []).length;
  const gases = (p.gases || []).length;
  return `地表 ${surface} · 地下 ${underground} · 地核 ${core} · 气体 ${gases}`;
}

// v0.2.1：取某星球最新一条殖民地报告（acc.colonyReports 按 at 倒序取第一条匹配 code）
function latestReportOf(acc, code) {
  const list = (acc && Array.isArray(acc.colonyReports)) ? acc.colonyReports : [];
  let best = null;
  for (const r of list) {
    if (r && (r.code === code)) {
      if (!best || Number(r.at) > Number(best.at)) best = r;
    }
  }
  return best;
}

function currentAccountSafe() {
  try {
    // state.js 的账号从 STATE.accounts 里取（避免额外导入造成耦合）
    const id = STATE && STATE.currentAccountId;
    if (!id || !Array.isArray(STATE.accounts)) return null;
    return STATE.accounts.find((a) => a && a.id === id) || null;
  } catch (e) { return null; }
}

// v0.1.1 需求 1：清理老存档里误占的商店星 —— acc.capturedPlanets 走 purgeShopColonies，
// STATE.planets 里残留的 ast1 实例就地移除（否则概览统计会把它算成殖民地）。
function dropShopResidue(acc) {
  try { if (acc) purgeShopColonies(acc); } catch (e) { /* 忽略 */ }
  try {
    const i = STATE.planets.findIndex((p) => p && (p.isShop || p.code === SHOP_PLANET.code));
    if (i >= 0) STATE.planets.splice(i, 1);
  } catch (e) { /* 忽略 */ }
}

// 当前「已知」的星球行数据：母星 + 已发现（含未殖民）+ 老存档已占领（兼容），去重。
// 未发现的星球绝不出现。商店星不进这个列表（由 draw 单独渲染入口行）。
function knownPlanetsOf(acc) {
  const out = [];
  const seen = new Set();
  const push = (p) => {
    if (!p || !p.code || p.isShop || seen.has(p.code)) return;
    seen.add(p.code);
    out.push(p);
  };
  const homeCode = acc && acc.homePlanetCode;
  const home = homeCode ? PLANETS.find((x) => x.code === homeCode) : null;
  if (home) push(home);
  if (acc && Array.isArray(acc.discovered)) for (const p of acc.discovered) push(p);
  // 兼容老存档：v0.0.92 时代探索即占领，capturedPlanets 里的星球可能还没登记进 discovered
  if (acc && Array.isArray(acc.capturedPlanets)) {
    for (const cap of acc.capturedPlanets) {
      if (cap && cap.planet) push(cap.planet);
      else {
        const def = PLANETS.find((x) => x.code === (cap && cap.code));
        if (def) push(def);
      }
    }
  }
  out.sort((a, b) => (a.orbit && a.orbit.radius ? a.orbit.radius : 0) - (b.orbit && b.orbit.radius ? b.orbit.radius : 0));
  return out;
}

export function renderColony(root, ctx) {
  const openModal = ctx && ctx.openModal;
  const closeModal = ctx && ctx.closeModal;
  const onEnterPlanet = (ctx && typeof ctx.onEnterPlanet === 'function') ? ctx.onEnterPlanet : null;

  // 动态引用（draw 每次重绘都会刷新，定时器据此做局部更新，不整块重绘）
  let ovRefs = null;          // { colonized, totalPop, labor, happiness }
  let liveRefs = [];          // [{ code, refs:{ pop, happiness, shelter } }]

  // ---- 顶部概览（按当前 STATE.planets 实时统计；商店星实例不算殖民地）----
  function updateOverview() {
    const acc = currentAccountSafe();
    const insts = STATE.planets.filter((p) => p && !p.isShop && p.code !== SHOP_PLANET.code);
    const colonized = insts.length;
    const known = knownPlanetsOf(acc).length;
    let totalPop = 0, totalLabor = 0, totalAvail = 0, happySum = 0;
    for (const inst of insts) {
      const pop = inst.population || { total: 0, available: 0 };
      totalPop += pop.total || 0;
      totalLabor += pop.total || 0;
      totalAvail += pop.available || 0;
      happySum += (inst.happiness != null ? inst.happiness : 1);
    }
    const avg = colonized ? happySum / colonized : 0;
    if (ovRefs) {
      ovRefs.colonized.textContent = colonized + ' / ' + Math.max(known, colonized);
      ovRefs.totalPop.textContent = fmtNum(totalPop);
      ovRefs.labor.textContent = fmtNum(totalLabor) + ' / ' + fmtNum(totalAvail);
      ovRefs.happiness.textContent = Math.round(avg * 100) + '%';
    }
  }

  // ---- 已殖民星球行：局部更新会变的数字（人口 / 幸福度 / 庇护）----
  function updateLive() {
    for (const item of liveRefs) {
      const inst = instanceOf(item.code);
      if (!inst) continue;
      const pop = inst.population || { total: 0, available: 0 };
      item.refs.pop.textContent = '人口 ' + fmtNum(pop.total || 0) + ' · 可用人力 ' + fmtNum(pop.available || 0);
      item.refs.happiness.textContent = Math.round((inst.happiness != null ? inst.happiness : 1) * 100) + '%';
      item.refs.shelter.textContent = Math.round(shelterRatio(inst) * 100) + '%';
    }
  }

  // ---- 殖民确认模态（body 用 DOM 节点，按钮自带事件，无需 import main.js）----
  // v0.1.1：先 capturePlanet（登记进 acc.capturedPlanets；商店星会被拒绝）再 getPlanetInstance。
  function buildConfirmBody(p) {
    const wrap = el('div', { class: 'col-confirm' });
    wrap.appendChild(el('p', { class: 'col-confirm-text',
      text: `确认在「${p.nameCn}（${p.nameEn}）」建立殖民地据点？` }));
    if (p.needsImmigration) {
      wrap.appendChild(el('p', { class: 'col-confirm-warn',
        text: '该星球本地无人力，需从希尔瓦移民才能开工。' }));
    }

    // v0.1.2（R8）：调派人力下拉 —— 从母星抽调可用人力到新殖民地
    const acc0 = currentAccountSafe();
    const homeCode = acc0 && acc0.homePlanetCode;
    let homeInst = null, homeAvail = 0;
    if (homeCode) {
      try { homeInst = getPlanetInstance(homeCode); } catch (e) { homeInst = null; }
      if (homeInst && homeInst.pop) homeAvail = getAvailable(homeInst.pop);
    }
    const levels = [0, 10, 25, 50];
    const sel = el('select', { class: 'col-confirm-sel' });
    for (const lv of levels) {
      const opt = el('option', { value: String(lv),
        text: lv === 0 ? '不调派（0）' : ('调派 ' + lv + ' 可用人力') });
      // 母星可用人力不足时该选项置灰
      if (lv > 0 && lv > homeAvail) opt.setAttribute('disabled', 'disabled');
      sel.appendChild(opt);
    }
    wrap.appendChild(el('div', { class: 'col-confirm-row' }, [
      el('span', { class: 'k', text: '调派人力 ' }),
      sel,
    ]));
    wrap.appendChild(el('div', {
      class: 'col-confirm-note' + (homeAvail > 0 ? '' : ' warn'),
      text: '母星「' + (homeCode || '—') + '」当前可用人力 ' + fmtNum(Math.floor(homeAvail))
        + (homeAvail > 0 ? '；超出可用人力的选项已置灰，调派后从母星扣除、计入新星。'
                         : '；母星暂无剩余可用人力，只能选择「不调派」。'),
    }));

    const row = el('div', { class: 'col-confirm-btns' });
    const ok = el('button', { class: 'col-btn col-colonize', text: '确认殖民' });
    ok.addEventListener('click', () => {
      if (closeModal) closeModal();
      const acc = currentAccountSafe();
      if (acc) {
        const r = capturePlanet(acc, p);
        if (!r.ok) {
          // 理论上到不了这里（商店星没有殖民按钮）；兜底提示，不建实例
          try { window.alert(r.reason || '无法殖民'); } catch (e) { /* 忽略 */ }
          return;
        }
      }
      const ni = getPlanetInstance(p.code);   // 殖民：惰性建立星球实例（写入开局物资）
      // v0.1.2（R8）：从母星调派人力到新星（走 dispatchWorkforce，总数守恒）
      const n = Number(sel.value) || 0;
      if (n > 0 && homeInst && ni) {
        dispatchWorkforce(homeInst, ni, n);
      }
      draw();                       // 仅殖民成功后整体重绘一次
    });
    const cancel = el('button', { class: 'col-btn', text: '取消' });
    cancel.addEventListener('click', () => { if (closeModal) closeModal(); });
    row.appendChild(ok);
    row.appendChild(cancel);
    wrap.appendChild(row);
    return wrap;
  }

  // ---- 向殖民地运送人力（v0.2.3）----
  // 母星（源）→ 本星（目的地）：走 dispatchWorkforce（增减 pop.total，总数守恒，
  // 可用人力每 tick 由 getAvailable 重新派生），不硬改 available 等派生字段。
  // 人力是「人」，不走船队运输任务，立即抵达。
  function buildWorkforceBody(p, inst) {
    const acc = currentAccountSafe();
    const homeCode = acc && acc.homePlanetCode;
    let homeInst = null, homeAvail = 0;
    if (homeCode) {
      try { homeInst = getPlanetInstance(homeCode); } catch (e) { homeInst = null; }
      if (homeInst && homeInst.pop) homeAvail = getAvailable(homeInst.pop);
    }
    const wrap = el('div', { class: 'col-confirm' });
    wrap.appendChild(el('p', { class: 'col-confirm-text',
      text: '从母星「' + (homeCode || '—') + '」向「' + p.nameCn + '」运送人力（移民立即抵达，不走船队）。' }));
    const input = el('input', {
      class: 'col-confirm-sel', type: 'number', min: '1',
      value: String(Math.max(1, Math.min(25, Math.floor(homeAvail)))),
      style: 'width:120px;',
    });
    const hasAvail = homeAvail > 0 && !!homeInst;
    if (!hasAvail) input.setAttribute('disabled', 'disabled');
    wrap.appendChild(el('div', { class: 'col-confirm-row' }, [
      el('span', { class: 'k', text: '运送人数 ' }),
      input,
    ]));
    wrap.appendChild(el('div', {
      class: 'col-confirm-note' + (hasAvail ? '' : ' warn'),
      text: '母星当前可用人力 ' + fmtNum(Math.floor(homeAvail))
        + '（可用人力 = 总人力 × 劳动参与率 × 幸福度 − 已分配岗位与产线）。'
        + (hasAvail ? '运送后从母星扣除、计入本星，总数守恒。' : '母星暂无剩余可用人力，无法运送。'),
    }));
    const msg = el('div', { class: 'col-confirm-note' });
    const row = el('div', { class: 'col-confirm-btns' });
    const ok = el('button', { class: 'col-btn col-colonize', text: '确认运送' });
    if (!hasAvail) ok.setAttribute('disabled', 'disabled');
    ok.addEventListener('click', () => {
      const n = Math.floor(Number(input.value) || 0);
      if (!(n > 0)) { msg.textContent = '请输入大于 0 的人数。'; return; }
      if (!homeInst) { msg.textContent = '找不到母星实例，无法运送。'; return; }
      const moved = dispatchWorkforce(homeInst, inst, n);
      if (!(moved > 0)) {
        msg.textContent = '运送失败：母星可用人力不足（当前 '
          + fmtNum(Math.floor(getAvailable(homeInst.pop))) + '）。';
        return;
      }
      if (closeModal) closeModal();
      draw();
    });
    const cancel = el('button', { class: 'col-btn', text: '取消' });
    cancel.addEventListener('click', () => { if (closeModal) closeModal(); });
    row.appendChild(ok);
    row.appendChild(cancel);
    wrap.appendChild(msg);
    wrap.appendChild(row);
    return wrap;
  }

  // ---- 运输物资到殖民地（v0.1.5 需求 2）----
  // 选一支编队（需含运输船）+ 一种源星球持有 > 0 的物资 + 数量，发起 transport 任务。
  // 货单在船队抵达时由 fleet.js 从编队母星（源）搬到目标殖民地（toCode = 本星球 code）。
  function buildTransportBody(p, inst) {
    const acc = currentAccountSafe();
    const wrap = el('div', { class: 'col-confirm' });
    wrap.appendChild(el('p', { class: 'col-confirm-text',
      text: `向「${p.nameCn}（${p.nameEn}）」运输物资：选择一支含运输船的编队，并指定要运送的材料与数量。` }));

    // 编队选择（列出全部编队；运输船校验交给 startMission，失败会在下方给出明确原因）
    const fleets = (acc && listFleets(acc)) || [];
    const fleetSel = el('select', { class: 'col-confirm-sel' });
    if (fleets.length) {
      for (const f of fleets) {
        const n = (f.shipIds || []).length;
        const o = el('option', { value: f.id, text: (f.nameCn || f.id) + '（' + n + ' 艘）' });
        fleetSel.appendChild(o);
      }
    } else {
      fleetSel.appendChild(el('option', { value: '', text: '（暂无编队）' }));
    }
    wrap.appendChild(el('div', { class: 'col-confirm-row' }, [
      el('span', { class: 'k', text: '编队 ' }), fleetSel,
    ]));

    // 源星球（编队母星）库存：仅列出持有 > 0 的物资
    const homeCode = (fleets[0] && fleets[0].homePlanetCode) || (acc && acc.homePlanetCode);
    let srcInst = null;
    try { if (homeCode) srcInst = getPlanetInstance(homeCode); } catch (e) { srcInst = null; }
    const matSel = el('select', { class: 'col-confirm-sel' });
    const held = (srcInst && Array.isArray(srcInst.inventory) ? srcInst.inventory : [])
      .filter((e) => e && e.mat && (Number(e.owned) || 0) > 0);
    const seen = new Set();
    for (const e of held) {
      if (seen.has(e.mat)) continue; seen.add(e.mat);
      matSel.appendChild(el('option', { value: e.mat,
        text: e.mat + '（持有 ' + fmtNum(ownedOf(srcInst, e.mat)) + '）' }));
    }
    if (!held.length) matSel.appendChild(el('option', { value: '', text: '（源星球没有持有的材料）' }));
    wrap.appendChild(el('div', { class: 'col-confirm-row' }, [
      el('span', { class: 'k', text: '物资 ' }), matSel,
    ]));

    // 数量
    const qtyInp = el('input', { type: 'number', min: '1', value: '10', class: 'col-confirm-sel' });
    qtyInp.style.minWidth = '88px'; qtyInp.style.minHeight = '40px';
    wrap.appendChild(el('div', { class: 'col-confirm-row' }, [
      el('span', { class: 'k', text: '数量 ' }), qtyInp,
    ]));

    wrap.appendChild(el('div', { class: 'col-confirm-note',
      text: '运输任务需要编队里至少有一艘运输船；物资将在抵达「' + (p.nameCn || p.code)
        + '」后自动从「' + (homeCode || '—') + '」搬运入账（按载货格数校验，装不下会提示）。' }));

    const errLine = el('div', { class: 'col-confirm-warn', text: '' });
    wrap.appendChild(errLine);

    const row = el('div', { class: 'col-confirm-btns' });
    const ok = el('button', { class: 'col-btn col-colonize', text: '确认运输' });
    ok.addEventListener('click', () => {
      const fleetId = fleetSel.value;
      const mat = matSel.value;
      const qty = Math.floor(Number(qtyInp.value) || 0);
      if (!fleetId) { errLine.textContent = '请选择编队'; return; }
      if (!mat) { errLine.textContent = '请选择要运输的物资'; return; }
      if (!(qty > 0)) { errLine.textContent = '数量必须为正整数'; return; }
      const r = startMission(acc, fleetId, 'transport', p.code, { [mat]: qty });
      if (!r.ok) { errLine.textContent = '无法发起：' + (r.reason || '任务发起失败'); return; }
      if (closeModal) closeModal();
      draw();                       // 发起成功后整体重绘一次
    });
    const cancel = el('button', { class: 'col-btn', text: '取消' });
    cancel.addEventListener('click', () => { if (closeModal) closeModal(); });
    row.appendChild(ok);
    row.appendChild(cancel);
    wrap.appendChild(row);
    return wrap;
  }

  // ---- 管理模式说明（v0.1.1 需求 4：托管星球显示「由电脑接管发展」与贡品比例）----
  function managementLine(inst) {
    if (!inst || inst.isHome) return null;
    const mode = modeOf(inst);
    if (mode.id === 'territory') {
      return el('div', { class: 'col-line' }, [
        el('span', { class: 'k', text: '管理模式 ' }),
        el('span', { class: 'col-manage assimilated', text: '领土 · 已同化为领土，不再由电脑接管' }),
      ]);
    }
    const ratePct = Math.round((TRIBUTE_RATES[mode.id] != null ? TRIBUTE_RATES[mode.id] : 0) * 100);
    return el('div', { class: 'col-line' }, [
      el('span', { class: 'k', text: '管理模式 ' }),
      el('span', { class: 'col-manage',
        text: mode.nameCn + ' · 由电脑接管发展 · 贡品比例 ' + ratePct + '%' }),
      el('span', { class: 'k',
        text: '（人力与生产线每 30 秒由电脑自动重排，每 60 秒向母星上缴富余资源与装备；'
          + '托管期间无需手动分配）' }),
    ]);
  }

  // ---- 单行：名称 / 状态 / 人口 / 幸福度 / 庇护 / 管理模式 / 资源 / 能量 / 按钮 ----
  function buildRow(p) {
    const code = p.code;
    const inst = instanceOf(code);
    const colonized = !!inst;

    const main = el('div', { class: 'col-main' });

    // 头部：名称 + 英文名 + 类型徽章
    const head = el('div', { class: 'col-row-head' }, [
      el('span', { class: 'col-name', text: p.nameCn }),
      el('span', { class: 'col-en', text: p.nameEn }),
      el('span', { class: 'col-type', text: p.type }),
    ]);
    main.appendChild(head);

    // 殖民状态 + 独立倾向徽章
    const statusLine = el('div', { class: 'col-line' }, [
      el('span', { class: 'k', text: '殖民状态 ' }),
      el('span', { class: colonized ? 'col-status col-yes' : 'col-status col-no',
        text: colonized ? ('已殖民 · ' + inst.planetId) : '已发现 · 未殖民' }),
    ]);
    if (p.canRebel) {
      statusLine.appendChild(el('span', { class: 'col-badge-rebel', text: '有独立倾向' }));
    }
    main.appendChild(statusLine);

    // 本地人口
    const popLine = el('div', { class: 'col-line', text: '本地人口 ' });
    let popSpan = null;
    if (colonized) {
      const pop = inst.population || { total: 0, available: 0 };
      popSpan = el('span', { text: '人口 ' + fmtNum(pop.total || 0) + ' · 可用人力 ' + fmtNum(pop.available || 0) });
      popLine.appendChild(popSpan);
      if ((pop.total || 0) <= 0 && p.needsImmigration) {
        popLine.appendChild(el('span', { class: 'col-note', text: '（需从希尔瓦移民）' }));
      }
    } else {
      popLine.appendChild(el('span', { text: '无人' }));
      if (p.needsImmigration) {
        popLine.appendChild(el('span', { class: 'col-note', text: ' · 本星球无人力，需从希尔瓦移民' }));
      }
    }
    main.appendChild(popLine);

    // 幸福度 / 庇护覆盖率（仅已殖民）
    let happySpan = null, shelterSpan = null;
    if (colonized) {
      happySpan = el('span', { text: Math.round((inst.happiness != null ? inst.happiness : 1) * 100) + '%' });
      shelterSpan = el('span', { text: Math.round(shelterRatio(inst) * 100) + '%' });
      main.appendChild(el('div', { class: 'col-line' }, [
        el('span', { class: 'k', text: '幸福度 ' }),
        happySpan,
        el('span', { class: 'k', text: '　庇护覆盖率 ' }),
        shelterSpan,
      ]));
      // 管理模式说明（托管星球：由电脑接管发展 + 贡品比例）
      const mLine = managementLine(inst);
      if (mLine) main.appendChild(mLine);

      // v0.1.2（R7）：每个已殖民星球（母星除外）可切换管理模式的下拉
      if (!inst.isHome) {
        const sel = el('select', { class: 'col-manage-sel' });
        for (const m of MANAGEMENT_MODES) {
          const opt = el('option', { value: m.id, text: m.nameCn + '（' + m.id + '）' });
          if ((inst.management || 'colonial') === m.id) opt.setAttribute('selected', 'selected');
          // 领土一开始 locked（需先同化），未同化时禁用该选项
          if (m.locked && !inst.territoryAssimilated) opt.setAttribute('disabled', 'disabled');
          sel.appendChild(opt);
        }
        sel.addEventListener('change', () => {
          // change 时调 setManagement 并重绘；失败时还原选择（locked 项本就 disable，兜底）
          const r = setManagement(inst, sel.value);
          if (!r.ok) {
            sel.value = inst.management || 'colonial';
            return;
          }
          draw();
        });
        main.appendChild(el('div', { class: 'col-line' }, [
          el('span', { class: 'k', text: '管理模式 ' }),
          sel,
          el('span', { class: 'k',
            text: '（change 即生效；领土需幸福度长期很高自动同化后可选）' }),
        ]));
      }

      // v0.2.1：殖民地报告内联显示（最新一条，取代右下角弹窗）
      const rep = latestReportOf(currentAccountSafe(), code);
      if (rep) {
        const t = new Date(Number(rep.at) || Date.now());
        const hh = String(t.getHours()).padStart(2, '0');
        const mm = String(t.getMinutes()).padStart(2, '0');
        const ss = String(t.getSeconds()).padStart(2, '0');
        main.appendChild(el('div', { class: 'col-report muted', text:
          '📡 ' + hh + ':' + mm + ':' + ss + '　' + reportTextOf(rep) }));
      }
    }

    // 资源概况
    main.appendChild(el('div', { class: 'col-res', text: '资源概况 ' + resourceSummary(p) }));

    // 能量池 + 环境乘数（清洁能源发电的环境乘数，一眼看出星球差异）
    main.appendChild(el('div', { class: 'col-energy' }, [
      el('span', { class: 'k', text: '能量池 ' }),
      el('span', { class: 'cyan', text: fmtNum(p.power && p.power.totalEnergy) }),
      el('span', { class: 'k', text: '　环境乘数 ' }),
      el('span', { class: 'env-hydro', text: '水利 ' + ((p.power && p.power.hydro) || 0) }),
      el('span', { text: ' / ' }),
      el('span', { class: 'env-wind', text: '风力 ' + ((p.power && p.power.wind) || 0) }),
      el('span', { text: ' / ' }),
      el('span', { class: 'env-solar', text: '太阳能 ' + ((p.power && p.power.solar) || 0) }),
    ]));

    // 按钮
    let btnWrap;
    if (colonized) {
      // v0.1.2（R5）：只有母星 / 已同化（领土）能「进入」，其余只渲染概况、按钮 disabled
      btnWrap = el('div', { style: 'display:flex; flex-direction:column; gap:8px; align-self:center;' });
      if (canEnterPlanet(inst)) {
        const enterBtn = el('button', { class: 'col-btn col-enter', text: '进入' });
        if (onEnterPlanet) {
          enterBtn.addEventListener('click', () => onEnterPlanet(code));
        } else {
          // 没有进入回调：禁用按钮，提示在主界面切换（绝不 import main.js）
          enterBtn.setAttribute('disabled', 'disabled');
          enterBtn.setAttribute('title', '该星球已是你的殖民地，可在主界面切换');
        }
        btnWrap.appendChild(enterBtn);
      } else {
        const enterBtn = el('button', { class: 'col-btn col-enter', text: '进入', disabled: 'disabled' });
        enterBtn.setAttribute('title', '未同化，仅可查看概况');
        btnWrap.appendChild(enterBtn);
      }
      // v0.1.5（需求 2）：向殖民地运输物资——母星（源）→ 本星（目的地）的运输任务
      if (!inst.isHome) {
        const tBtn = el('button', { class: 'col-btn col-colonize', text: '运输物资' });
        tBtn.addEventListener('click', () => {
          if (openModal) openModal({ title: '向 ' + p.nameCn + ' 运输物资', body: buildTransportBody(p, inst) });
        });
        btnWrap.appendChild(tBtn);
        // v0.2.3：向殖民地运送人力 —— 母星可用人力 → 本星人口（立即抵达，总数守恒）
        const wfBtn = el('button', { class: 'col-btn col-colonize', text: '运送人力' });
        wfBtn.addEventListener('click', () => {
          if (openModal) openModal({ title: '向 ' + p.nameCn + ' 运送人力', body: buildWorkforceBody(p, inst) });
        });
        btnWrap.appendChild(wfBtn);
      }
    } else {
      btnWrap = el('button', { class: 'col-btn col-colonize', text: '殖民' });
      btnWrap.setAttribute('data-code', code);
      btnWrap.addEventListener('click', () => {
        if (openModal) openModal({ title: '建立殖民地 · ' + p.nameCn, body: buildConfirmBody(p) });
      });
    }

    const row = el('div', { class: 'col-row' + (p.canRebel ? ' can-rebel' : '') }, [main, btnWrap]);

    // 收集可变数字节点引用（仅已殖民）
    let refs = null;
    if (colonized) {
      refs = { pop: popSpan, happiness: happySpan, shelter: shelterSpan };
    }
    return { el: row, refs, code, colonized };
  }

  function draw() {
    root.innerHTML = '';
    root.appendChild(el('style', { text: CSS }));

    const acc = currentAccountSafe();
    dropShopResidue(acc);                       // v0.1.1：老存档误占商店星的兜底清理
    try { ensureDiscoveredDefaults(acc, acc && acc.homePlanetCode); } catch (e) { /* 忽略 */ }

    const panel = el('div', { class: 'col-panel' });
    panel.appendChild(el('div', { class: 'col-title', text: '殖民地管理' }));
    panel.appendChild(el('div', { class: 'col-sub',
      text: '统筹帝国疆域：只有探索发现的星球才会出现在这里；殖民扩张，托管星球由电脑代管并向母星上缴贡品。' }));

    // 顶部概览
    const overview = el('div', { class: 'col-overview' });
    const mk = (label) => {
      const val = el('span', { class: 'col-ov-val', text: '—' });
      const item = el('div', { class: 'col-ov-item' }, [el('div', { class: 'col-ov-label', text: label }), val]);
      return { item, val };
    };
    const c1 = mk('已殖民 / 已发现'), c2 = mk('帝国总人口'), c3 = mk('总人力 / 可用'), c4 = mk('平均幸福度');
    c4.val.className = 'col-ov-val cyan';
    overview.appendChild(c1.item);
    overview.appendChild(c2.item);
    overview.appendChild(c3.item);
    overview.appendChild(c4.item);
    panel.appendChild(overview);
    ovRefs = { colonized: c1.val, totalPop: c2.val, labor: c3.val, happiness: c4.val };

    // 星球列表（母星 + 已发现，按 orbit.radius 从小到大；未发现的不展示）
    const list = el('div', { class: 'col-list' });
    liveRefs = [];
    for (const p of knownPlanetsOf(acc)) {
      const r = buildRow(p);
      if (r.colonized && r.refs) liveRefs.push({ code: r.code, refs: r.refs });
      list.appendChild(r.el);
    }

    // v0.1.1：商店星 Ast1 —— 公共商业空间站，独立条目（没有矿层，进入即是商店）。
    // 需求 1：显示「公共商店星」徽标；**绝不自动 capturePlanet**；没有殖民/管理按钮。
    {
      const row = el('div', { class: 'col-row shop-row' });
      const main = el('div', { class: 'col-main' });
      main.appendChild(el('div', { class: 'col-row-head' }, [
        el('span', { class: 'col-name', text: SHOP_PLANET.nameCn + '（' + SHOP_PLANET.nameEn + '）' }),
        el('span', { class: 'col-type', text: SHOP_PLANET.type }),
        el('span', { class: 'col-badge-shop', text: '公共商店星 · 所有旅行者共用' }),
      ]));
      main.appendChild(el('div', { class: 'col-line col-sub',
        text: '商业空间站 · 物资与 Ascoin 互换，价格随成交实时变化；买卖只是下单，货需要运输船送达。不参与殖民与管理。' }));
      row.appendChild(main);
      // v0.1.0（设计者）：「贸易与殖民」在造出船坞后才显示 —— 商店星同理
      const hasDock = (() => {
        try {
          const inst = getPlanetInstance(STATE && STATE.currentAccountId ? (acc || {}).homePlanetCode : null);
          return !!(inst && inst.buildings && Number(inst.buildings.dock) > 0);
        } catch (e) { return false; }
      })();
      if (hasDock) {
        const btn = el('button', { class: 'col-btn col-enter', text: '进入商店' });
        btn.type = 'button';
        btn.addEventListener('click', () => {
          if (openModal) {
            const box = el('div', { class: 'shop-modal' });
            openModal({ title: '商店星 Ast1', body: box });
            const paint = () => renderShop(box, { ...ctx, rerender: paint });
            paint();
          } else {
            list.innerHTML = '';
            renderShop(list, ctx);
          }
        });
        row.appendChild(btn);
      } else {
        row.appendChild(el('div', { class: 'col-sub muted',
          text: '（船坞建成后开放：先造出船坞才能前往商业空间站）' }));
      }
      list.appendChild(row);
    }
    panel.appendChild(list);

    // 底部玩法说明
    panel.appendChild(el('div', { class: 'col-foot', text:
      '玩法提示：先用舰队探索发现星球，发现后才能在这里殖民；殖民只是建立据点，不会自动带来人力，' +
      '其余星球须从希尔瓦移民才能开工。殖民后除「领土」外的管理模式由电脑接管发展，' +
      '会自动分配人力与生产线，并定期向母星上缴富余资源与装备；幸福度长期很高会自动同化成领土。' +
      '庇护覆盖率低于 100% 会拉低幸福度；幸福度低于 50% 时人口会开始倒扣。' }));

    root.appendChild(panel);
    updateOverview();
    updateLive();
  }

  draw();

  // 面板是否还挂在页面上（切走 tab 后 root 内容会被清空，此时停掉计时器）
  function isMounted() {
    if (typeof root.querySelector === 'function') return !!root.querySelector('.col-panel');
    return true;
  }

  // 定时刷新：只更新会变的人口 / 幸福度 / 庇护数字，不整块重绘（避免冲掉滚动位置）
  if (root._colTimer) { clearInterval(root._colTimer); root._colTimer = null; }
  root._colTimer = setInterval(() => {
    if (!isMounted()) { clearInterval(root._colTimer); root._colTimer = null; return; }
    updateOverview();
    updateLive();
  }, 1000);
}

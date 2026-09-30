// 殖民地报告展示（v0.1.4 需求 4）
// ============================================================================
// 数据来自 core/planetgen.js：每 30 秒为每颗**托管殖民地**追加一条报告到 acc.colonyReports：
//   { at, code, nameCn, modeId, modeNameCn,
//     dev: { popDelta, buildingsDelta, popTotal, buildingsTotal },
//     tribute: { mats: {材料: 数量}, equip: {partId, material, count}|null, ships: 0|1 } }
//
// 本模块只做展示，不产数据、不改存档结构：
//   1) startReportToasts(getAccount)：轮询新报告，以**右下角浮动提示条**淡入淡出，
//      不打断玩家操作（v0.1.4 已拍板：浮动提示条 + 「人力」页保留历史）。
//   2) buildReportHistory(acc, limit)：给「人力」页渲染最近若干条历史。
//
// 依赖方向：ui → core（只读 currentAccount 的账号对象），不反向依赖。
// ============================================================================

import { fmtNum } from '../core/format.js?v=26.4';

const TOAST_LIFE_MS = 9000;     // 单条提示停留时长
const TOAST_MAX = 3;            // 同屏最多几条（多余的排队）
const POLL_MS = 1000;

// 提示条的挂载容器（整个会话共用一个，避免反复增删节点）
let layer = null;

function ensureLayer() {
  if (layer && layer.isConnected) return layer;
  if (typeof document === 'undefined') return null;
  layer = document.createElement('div');
  layer.className = 'colony-report-layer';
  // 内联样式：这块是 v0.1.4 新增的小组件，不想为它再动 css 文件的缓存串
  layer.style.cssText = [
    'position:fixed', 'right:12px', 'bottom:76px', 'z-index:9000',
    'display:flex', 'flex-direction:column', 'gap:6px',
    'max-width:min(86vw,360px)', 'pointer-events:none',
  ].join(';');
  document.body.appendChild(layer);
  return layer;
}

/** 报告里「上缴内容」的摘要文案 */
export function tributeSummaryOf(tribute) {
  if (!tribute) return '';
  const parts = [];
  const mats = tribute.mats || {};
  for (const m in mats) {
    const n = Number(mats[m]) || 0;
    if (n > 0) parts.push(m + ' ' + fmtNum(Math.round(n * 100) / 100));
  }
  if (tribute.equip) parts.push('装备 ' + (Number(tribute.equip.count) || 1) + ' 件');
  if (Number(tribute.ships) > 0) parts.push('舰船 ' + Number(tribute.ships) + ' 艘');
  return parts.join('、');
}

/** 报告主体文案（提示条与历史共用） */
export function reportTextOf(r) {
  if (!r) return '';
  const d = r.dev || {};
  // 人口是小数累积（含成长小数），展示取整；差值不足 1 就不摆箭头，避免「↑0.0554」这种噪音
  const popT = Math.round(Number(d.popTotal) || 0);
  const popD = Math.round(Number(d.popDelta) || 0);
  const bldT = Math.round(Number(d.buildingsTotal) || 0);
  const bldD = Math.round(Number(d.buildingsDelta) || 0);
  const devBits = [
    '人口 ' + fmtNum(popT) + (popD > 0 ? ' ↑' + fmtNum(popD) : popD < 0 ? ' ↓' + fmtNum(-popD) : ''),
    '建筑 ' + fmtNum(bldT) + (bldD > 0 ? ' ↑' + fmtNum(bldD) : bldD < 0 ? ' ↓' + fmtNum(-bldD) : ''),
  ];
  const trib = tributeSummaryOf(r.tribute);
  return (r.nameCn || r.code) + '（' + (r.modeNameCn || '托管') + '）：' + devBits.join(' · ')
    + (trib ? '　上缴 ' + trib : '　本期无上缴');
}

function showToast(r) {
  const host = ensureLayer();
  if (!host) return;
  while (host.children.length >= TOAST_MAX) host.removeChild(host.firstChild);
  const box = document.createElement('div');
  box.className = 'colony-report-toast';
  box.style.cssText = [
    'pointer-events:auto', 'background:rgba(18,26,38,0.94)', 'border:1px solid rgba(120,200,220,0.35)',
    'border-radius:10px', 'padding:8px 10px', 'color:#dce9f2', 'font-size:12px', 'line-height:1.5',
    'box-shadow:0 6px 18px rgba(0,0,0,0.35)', 'opacity:0', 'transform:translateY(8px)',
    'transition:opacity .28s ease, transform .28s ease',
  ].join(';');
  const head = document.createElement('div');
  head.textContent = '殖民地报告';
  head.style.cssText = 'font-weight:600;color:#9FE1CB;margin-bottom:2px';
  const body = document.createElement('div');
  body.textContent = reportTextOf(r);
  box.appendChild(head);
  box.appendChild(body);
  host.appendChild(box);
  requestAnimationFrame(() => { box.style.opacity = '1'; box.style.transform = 'translateY(0)'; });
  setTimeout(() => {
    box.style.opacity = '0';
    box.style.transform = 'translateY(8px)';
    setTimeout(() => { if (box.parentNode) box.parentNode.removeChild(box); }, 320);
  }, TOAST_LIFE_MS);
}

/**
 * 启动报告轮询：把 getAccount() 返回账号的新报告（at > 上次已展示时间）逐条弹出。
 * 只记录「已展示到的时间戳」，不写进账号存档（避免污染存档结构）。
 * 返回一个停止函数（测试或退出时用）。
 */
export function startReportToasts(getAccount) {
  if (typeof document === 'undefined') return () => {};
  let seenAt = Date.now();                 // 启动前积压的旧报告不再补弹
  const timer = setInterval(() => {
    let acc = null;
    try { acc = getAccount ? getAccount() : null; } catch (e) { acc = null; }
    if (!acc) return;
    const list = Array.isArray(acc.colonyReports) ? acc.colonyReports : [];
    if (!list.length) return;
    // 账号切换（新档）时把水位重置到当前时间，避免把别的档的历史一次性喷出来
    if (acc.id !== startReportToasts._accId) {
      startReportToasts._accId = acc.id;
      seenAt = Date.now();
      return;
    }
    const fresh = list.filter((r) => r && Number(r.at) > seenAt);
    if (!fresh.length) return;
    seenAt = fresh.reduce((mx, r) => Math.max(mx, Number(r.at) || 0), seenAt);
    fresh.slice(-TOAST_MAX).forEach(showToast);
  }, POLL_MS);
  return () => clearInterval(timer);
}

/** 「人力」页的历史区块（最近 limit 条，倒序） */
export function buildReportHistory(acc, limit = 12) {
  const box = document.createElement('div');
  const list = Array.isArray(acc && acc.colonyReports) ? acc.colonyReports.slice(-limit).reverse() : [];
  if (!list.length) {
    const empty = document.createElement('div');
    empty.className = 'muted';
    empty.textContent = '暂无殖民地报告（托管殖民地每 30 秒会产生一条）。';
    box.appendChild(empty);
    return box;
  }
  for (const r of list) {
    const row = document.createElement('div');
    row.className = 'colony-report-row';
    row.style.cssText = 'padding:4px 0;border-bottom:1px dashed rgba(255,255,255,0.08);font-size:12px';
    const t = new Date(Number(r.at) || Date.now());
    const hh = String(t.getHours()).padStart(2, '0');
    const mm = String(t.getMinutes()).padStart(2, '0');
    const ss = String(t.getSeconds()).padStart(2, '0');
    row.textContent = hh + ':' + mm + ':' + ss + '　' + reportTextOf(r);
    box.appendChild(row);
  }
  return box;
}

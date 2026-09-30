// 应用入口：路由、全局模态层与启动（Astrix）
import { STATE, loadState, createAccount, currentAccount, saveState, tick, settleOffline, OFFLINE_RATIO, setStorageMode } from './core/state.js?v=21.16';
import { renderStart } from './ui/start.js?v=21.16';
import { renderPlanet } from './ui/planet.js?v=21.16';
import { renderGalaxy } from './ui/galaxy.js?v=21.16';
import { startReportToasts } from './ui/reports.js?v=21.16';
import { syncOnlineServer } from './core/cloud.js?v=21.16';

const root = document.getElementById('app');
const modalRoot = document.getElementById('modal-root');

// ===== 全局模态层 =====
let currentModal = null;

function closeModal() {
  if (currentModal) {
    currentModal.remove();
    currentModal = null;
  }
}

// 打开一个模态层。opts: { title, body(DOM 或字符串), sheet(移动端是否从底部滑出) }
function openModal(opts) {
  closeModal();
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';

  const panel = document.createElement('div');
  panel.className = 'modal-panel';

  const header = document.createElement('div');
  header.className = 'modal-header';
  const h = document.createElement('h3');
  h.textContent = opts.title || '';
  const close = document.createElement('button');
  close.className = 'modal-close';
  close.textContent = '×';
  close.setAttribute('aria-label', '关闭');
  header.appendChild(h);
  header.appendChild(close);

  const body = document.createElement('div');
  body.className = 'modal-body';
  if (typeof opts.body === 'string') {
    body.innerHTML = opts.body;
  } else if (opts.body) {
    body.appendChild(opts.body);
  }

  panel.appendChild(header);
  panel.appendChild(body);
  overlay.appendChild(panel);
  modalRoot.appendChild(overlay);

  close.addEventListener('click', closeModal);
  overlay.addEventListener('click', (e) => { if (e.target === overlay) closeModal(); });
  document.addEventListener('keydown', escClose);

  // 触发进场动画
  requestAnimationFrame(() => overlay.classList.add('open'));
  currentModal = overlay;
  return closeModal;
}

function escClose(e) {
  if (e.key === 'Escape') { closeModal(); document.removeEventListener('keydown', escClose); }
}

// 把离线秒数翻译成中文时长（如「1 小时 20 分」），用于离线结算面板。
function fmtOfflineDur(sec) {
  sec = Math.floor(Number(sec) || 0);
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  if (h > 0) return `${h} 小时 ${m} 分`;
  if (m > 0) return `${m} 分 ${s} 秒`;
  return `${s} 秒`;
}

// 离线收益结算面板：settleOffline() 返回 null 表示无需结算（老存档 / 离线过短）。
function showOfflineSettlement() {
  let info = null;
  try { info = settleOffline(); } catch (e) { return; }   // 结算异常不应拖垮启动
  if (!info) return;
  const ratioText = '1/' + Math.round(1 / (Number(OFFLINE_RATIO) || 1));
  // v0.1.2（需求 3）：离开时长**按存档各自显示**，不再把各档秒数求和。
  //   此前「离开 30 小时」可能是 3 个档各 10 小时加出来的，看着像算错。
  const per = Array.isArray(info.perAccount) ? info.perAccount : [];
  const curId = STATE.currentAccountId;
  let body = '';
  if (per.length) {
    const lines = per.slice().sort((a, b) => (a.id === curId ? -1 : b.id === curId ? 1 : 0)).map((p) => {
      const tag = p.id === curId ? '<b>本档</b>' : '存档';
      return `${tag}「${p.name}」离开 <b>${fmtOfflineDur(p.seconds)}</b>／推进 <b>${fmtOfflineDur(p.applied)}</b>`;
    });
    body = lines.join('<br>');
  } else {
    body = `离开 <b>${fmtOfflineDur(info.seconds)}</b>／推进 <b>${fmtOfflineDur(info.applied)}</b>`;
  }
  body += `<br><span class="muted">按离线产量 ${ratioText} 结算`;
  if (info.capped) body += '；离线收益上限 12 小时，超出部分不计';
  body += '</span>';
  if (Number(info.accounts) > 1) {
    body += `<br>本次共推进 <b>${info.accounts}</b> 个存档，每个存档按自己的离开时长独立结算`;
  }
  openModal({ title: '离线结算', body });
}

// ===== 路由 =====
function ensureAccount() {
  if (STATE.accounts.length === 0) createAccount('指挥官');
  if (!STATE.currentAccountId) STATE.currentAccountId = STATE.accounts[0].id;
  return currentAccount();
}

const nav = {
  showStart() {
    renderStart(root, {
      openModal,
      closeModal,
      enterOffline: onOffline,
      enterOnline: onOnline,
    });
  },
  showPlanet(code) {
    const acc = currentAccount();
    const target = code || (acc && acc.homePlanetCode);
    renderPlanet(root, {
      openModal,
      closeModal,
      planetCode: target,
      onBack: nav.showStart,
      // v0.1.2（需求 5）：这个回调此前**根本没传下来** —— planet.js:238-242 检查
      //   `typeof ctx.onEnterPlanet === 'function'`，拿不到就什么都不做，
      //   于是星球选择里的「进入」按钮一直是 disabled，点了没反应。
      //   现在传进来：切到选中星球（同化星球/母星，见 colony.js 的进入门槛）。
      onEnterPlanet: (c) => nav.showPlanet(c),
    });
  },
  showGalaxy() {
    ensureAccount();
    renderGalaxy(root, {
      openModal,
      closeModal,
      onBack: nav.showStart,
    });
  },
};

function onOffline() {
  // v0.0.61（rev2）：进入星球前必须关掉还开着的「选择存档」弹窗。
  closeModal();
  setStorageMode('offline');
  ensureAccount();
  STATE.mode = 'offline';
  nav.showPlanet();
}

function onOnline(acc) {
  closeModal();
  if (acc && acc.id) {
    STATE.currentAccountId = acc.id;
  }
  ensureAccount();
  STATE.mode = 'online';
  // 在线模式进入母星主界面（带在线状态和星际大厅入口），同时首发心跳同步
  const current = currentAccount();
  if (current) {
    syncOnlineServer(current).catch(() => {});
  }
  nav.showPlanet();
}

// ===== 全局游戏心跳（v0.0.2）=====
// 之前 tick 只由物品栏内部定时器驱动，切到别的 tab 或返回主界面后产出就停了、
// 进度也从不落盘。这里统一用 1 秒心跳推进，任何界面下资源都在增长；
// state.js 的 tick 内置自动存档（每 AUTOSAVE_INTERVAL 秒写一次）。
let _heartbeat = null;
let _onlineSyncTicks = 0;
function startLoop() {
  if (_heartbeat) return;
  _heartbeat = setInterval(() => {
    const acc = currentAccount();
    if (!acc) return;
    acc.stats.playTimeSec = (acc.stats.playTimeSec || 0) + 1;
    tick(1);

    // 在线模式每 10 秒自动向全服网络广播一次心跳快照与防御战力
    if (STATE.mode === 'online') {
      _onlineSyncTicks++;
      if (_onlineSyncTicks >= 10) {
        _onlineSyncTicks = 0;
        syncOnlineServer(acc).catch(() => {});
      }
    }
  }, 1000);
}

// 关页面前强制落盘一次，避免丢掉最后一次自动存档之后的那几秒
window.addEventListener('beforeunload', () => { try { saveState(); } catch (e) { /* 忽略 */ } });

// ===== 启动 =====
loadState();
nav.showStart();
startLoop();
// v0.1.4（需求 4）：殖民地报告浮动提示条 —— 托管殖民地每 30 秒产生一条报告，
//   这里每秒轮询新条目，用右下角提示条淡入淡出，不打断操作（历史可在「人力」页翻）。
startReportToasts(currentAccount);
// v0.0.8：离线结算。放在 showStart 之后——结算会跑很多 tick，弹面板前确保 UI 已渲染。
showOfflineSettlement();

// 启动完成：移除 index.html 里的「启动守卫」加载屏。
//   v0.0.61（rev3）修复移动端黑屏：此前模块加载失败/启动抛错时页面只剩深空背景，
//   错误被吞掉。守卫会把这类失败显示成可复制的错误面板，走到这里说明一切正常。
if (typeof window.__bootDone === 'function') window.__bootDone();

// 便于调试
window.ASTRIX = { STATE, openModal, closeModal };

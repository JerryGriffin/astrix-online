// 应用入口：路由、全局模态层与启动（Astrix）
import { STATE, loadState, createAccount, currentAccount, saveState, tick, settleOffline, OFFLINE_RATIO } from './core/state.js?v=64.15';
import { renderStart, openAccountPicker } from './ui/start.js?v=64.15';
import { renderPlanet } from './ui/planet.js?v=64.15';
// v0.4.16：本文件原先自带一份 el()，与 ui/common.js 的 el 并存 ——
//   两种不兼容签名正是 v0.3.2「列强区块不显示」的根因（全库曾有 14 份 el）。
//   本文件只用三参数位置式，与 common 版兼容，故统一从 common 引入。
import { el } from './ui/common.js?v=64.15';
// v0.2.1：在线模式前置 —— 进入游戏前必须先绑定邮箱（验证码登录 / 注册）
import { cloudUser, loginWithName, registerWithName, ensureReady } from './core/cloud.js?v=64.15';
// v0.4.23：心跳按真实经过时间推进（后台标签页被节流时不再丢进度），见下方 startLoop
import { splitBeat, drainBacklog } from './core/util.js?v=64.15';

const root = document.getElementById('app');
const modalRoot = document.getElementById('modal-root');

// ===== 全局模态层 =====
let currentModal = null;
let _modalSeq = 0;
let _lastFocused = null;          // 打开弹窗前焦点所在的元素，关闭后还原

// v0.4.23：键盘可达性 —— Tab 必须被关在弹窗内，否则焦点会跑到被遮住的背景页面上，
//   键盘用户（以及读屏软件）会在「看不见的地方」操作，看起来像界面卡死。
const FOCUSABLE_SELECTOR = 'button:not([disabled]), [href], input:not([disabled]), '
  + 'select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

function focusablesIn(host) {
  if (!host || typeof host.querySelectorAll !== 'function') return [];
  return Array.prototype.slice.call(host.querySelectorAll(FOCUSABLE_SELECTOR))
    .filter((n) => {
      if (!n || n.disabled || n.hidden) return false;
      // display:none 的控件（如存档导入用的隐藏 file input）能被选中但聚焦无效，
      //   会让「焦点交给弹窗」变成「焦点掉回 body」，必须排除
      try { return typeof n.getClientRects === 'function' ? n.getClientRects().length > 0 : true; }
      catch (e) { return true; }
    });
}

// 滚动锁：弹窗打开时锁住页面滚动（移动端尤其明显 —— 否则手指划过弹窗会滚动背后的列表）
function setPageScrollLocked(on) {
  const el = typeof document !== 'undefined' ? document.documentElement : null;
  if (!el || !el.classList) return;
  if (on) el.classList.add('modal-open');
  else el.classList.remove('modal-open');
}

function closeModal() {
  if (currentModal) {
    currentModal.remove();
    currentModal = null;
  }
  // v0.4.21（内存泄漏修复）：监听器挂在 document 上，此前只有按 Esc 关闭才会摘除；
  //   点 × 、点遮罩、或代码里直接调 closeModal()（切视图前清理弹窗到处都是）时
  //   监听器永久残留 —— 开 N 个弹窗就漏 N 个 keydown 闭包，长会话下越积越多。
  // v0.4.23：同一个监听器现在同时负责 Esc 与 Tab 焦点环，仍在关闭时统一摘除。
  document.removeEventListener('keydown', onModalKeydown);
  setPageScrollLocked(false);
  // 焦点还原：弹窗是从某个按钮打开的，关掉后焦点回到那个按钮，
  //   否则会掉到 <body> 上，键盘用户得从头 Tab 一遍。
  const back = _lastFocused;
  _lastFocused = null;
  if (back && back.isConnected && typeof back.focus === 'function') {
    try { back.focus(); } catch (e) { /* 元素已不可聚焦，忽略 */ }
  }
}

// 打开一个模态层。opts: { title, body(DOM 或字符串), sheet(移动端是否从底部滑出) }
function openModal(opts) {
  closeModal();
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';

  const panel = document.createElement('div');
  panel.className = 'modal-panel';
  panel.tabIndex = -1;                       // 没有任何可聚焦控件时把焦点放在面板上

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

  // 语义化：role=dialog + aria-modal 让读屏软件把它当成独立对话框，
  //   aria-labelledby 把标题与对话框关联起来（否则只念「对话框」，不念标题）
  const titleId = 'modal-title-' + (++_modalSeq);
  h.id = titleId;
  overlay.setAttribute('role', 'dialog');
  overlay.setAttribute('aria-modal', 'true');
  overlay.setAttribute('aria-labelledby', titleId);

  _lastFocused = document.activeElement && document.activeElement !== document.body
    ? document.activeElement
    : null;

  close.addEventListener('click', closeModal);
  overlay.addEventListener('click', (e) => { if (e.target === overlay) closeModal(); });
  document.addEventListener('keydown', onModalKeydown);
  setPageScrollLocked(true);

  // 触发进场动画，并把焦点交给弹窗内容
  requestAnimationFrame(() => {
    overlay.classList.add('open');
    const list = focusablesIn(body);
    const target = list[0] || (focusablesIn(panel)[0] || panel);
    try { target.focus(); } catch (e) { /* 忽略 */ }
  });
  currentModal = overlay;
  return closeModal;
}

// 弹窗内的全局键盘处理：Esc 关闭、Tab 焦点环
function onModalKeydown(e) {
  if (!currentModal) return;
  if (e.key === 'Escape') {
    // 中文输入法组词时按 Esc 是「取消候选」，不能顺手把弹窗也关掉
    if (e.isComposing) return;
    closeModal();
    return;
  }
  if (e.key !== 'Tab') return;
  const panel = currentModal.querySelector('.modal-panel');
  if (!panel) return;
  const list = focusablesIn(panel);
  if (!list.length) { e.preventDefault(); return; }
  const first = list[0];
  const last = list[list.length - 1];
  const active = document.activeElement;
  if (!panel.contains(active)) { e.preventDefault(); first.focus(); return; }
  if (e.shiftKey && active === first) { e.preventDefault(); last.focus(); }
  else if (!e.shiftKey && active === last) { e.preventDefault(); first.focus(); }
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
};

function onOffline() {
  // v0.0.61（rev2）：进入星球前必须关掉还开着的「选择存档」弹窗。
  //   此前从弹窗里点「+ 新建存档」或某行「进入」→ enterOffline() 直接切视图，
  //   弹窗却留在屏幕上盖住星球界面，玩家得手动点 ×（或点弹窗外）才能看到游戏。
  closeModal();
  ensureAccount();
  STATE.mode = 'offline';
  nav.showPlanet();
}

// v0.2.1：在线模式前置 —— 必须先绑定邮箱（验证码登录 / 注册）才能开始游玩。
//   v0.2.5：先 ensureReady() 恢复会话 —— 已登录过邮箱的玩家**下次直接进入**，不再重复登录；
//   在线存档选择界面按邮箱（云账号 uid）分池。
async function onOnline() {
  closeModal();
  openModal({ title: '连接云服务', body: '正在恢复登录状态…' });
  const ok = await ensureReady();
  closeModal();
  if (ok && cloudUser()) { openOnlinePicker(); return; }
  openOnlineBindModal(() => openOnlinePicker());
}

function openOnlinePicker() {
  const u = cloudUser();
  // v0.2.5：在线池按邮箱（uid）分开 —— 必须先定池再载入
  STATE.onlinePoolId = (u && (u.id || u.email)) || null;
  openAccountPicker(
    { openModal, closeModal, enterOnlineGame: onEnterOnlineGame },
    'online',
    u ? (u.email || u.id) : '未登录',
  );
}

// 在线池「进入 / 新建」后的进游戏回调（绑定已完成，直接进星球）
function onEnterOnlineGame() {
  closeModal();
  STATE.mode = 'online';
  ensureAccount();
  nav.showPlanet();
}

// 邮箱绑定模态：验证码登录 / 注册（复用 cloud.js 的 sendEmailOtp / verifyEmailOtp）。
// 成功后回调 onBound（进入在线模式）。
function openOnlineBindModal(onBound) {
  // v0.2.10：登录改「账号名 + 密码」，不强制邮箱 —— 账号名映射为合成邮箱后走密码注册 / 登录
  const wrap = document.createElement('div');
  wrap.appendChild(el('p', 'modal-tip',
    '在线模式 · 登录 / 注册：输入账号名与密码即可（无需邮箱）。账号与云端关联，可跨端同步、浏览其他玩家星球并贸易 / 结盟 / 进攻。'));

  const f = document.createElement('div');
  f.className = 'galaxy-form';
  const name = document.createElement('input');
  name.type = 'text'; name.placeholder = '账号名'; name.autocomplete = 'username';
  const pw = document.createElement('input');
  pw.type = 'password'; pw.placeholder = '密码'; pw.autocomplete = 'current-password';
  const btnGo = el('button', 'btn btn-primary', '登录 / 注册');
  const msg = el('div', 'muted');
  f.append(name, pw, btnGo);
  wrap.appendChild(f);
  wrap.appendChild(msg);
  const go = async () => {
    const n = name.value.trim();
    if (!n) { msg.textContent = '请输入账号名。'; return; }
    if (!pw.value || pw.value.length < 4) { msg.textContent = '密码至少 4 位。'; return; }
    msg.textContent = '登录中…';
    let r = await loginWithName(n, pw.value);
    if (!r.ok && r.reason === '账号不存在') {
      msg.textContent = '新账号，注册中…';
      r = await registerWithName(n, pw.value);
      if (!r.ok) { msg.textContent = '注册失败：' + (r.reason || '未知错误'); return; }
      msg.textContent = '注册成功，欢迎，' + n + '！';
    } else if (!r.ok) {
      msg.textContent = r.reason || '登录失败';
      return;
    }
    closeModal();
    onBound && onBound();
  };
  btnGo.addEventListener('click', go);
  pw.addEventListener('keydown', (e) => { if (e.key === 'Enter') go(); });
  name.addEventListener('keydown', (e) => { if (e.key === 'Enter') go(); });

  openModal({ title: '在线模式 · 登录 / 注册', body: wrap, sheet: true });

}

// 小工具：建元素（与 ui 模块同款，避免为 main 单独 import）

// ===== 全局游戏心跳（v0.0.2）=====
// 之前 tick 只由物品栏内部定时器驱动，切到别的 tab 或返回主界面后产出就停了、
// 进度也从不落盘。这里统一用 1 秒心跳推进，任何界面下资源都在增长；
// state.js 的 tick 内置自动存档（每 AUTOSAVE_INTERVAL 秒写一次）。
//
// v0.4.23：心跳改成**按真实经过时间**推进，而不是「每触发一次算 1 秒」。
//   原因：浏览器会对后台标签页的定时器节流 —— 隐藏超过 5 分钟后，
//   Chrome 保证的唤醒频率只有**每分钟一次**。旧写法于是在挂后台时
//   只按 1 秒/分钟的速度推进（实际速率约 1.7%），玩家切回来发现
//   产出 / 施工 / 造船几乎没动，且界面上没有任何提示。
//
//   实现分两步（都在 core/util.js，可单测）：
//     ① splitBeat：把真实间隔换成「该记多少秒」（不足 1 秒的余量留到下一拍），
//        并给积压设上限 —— 合盖三小时再打开，不能要求补算一万秒；
//     ② drainBacklog：从积压里**按 1 秒一步**补算，受时间预算与步数双重限制。
//   不用 tick(300) 一把结算，是因为状态里有按 dt 线性松弛的量（幸福度），
//   dt 给大会一步冲过目标值再被夹到 1，数值直接失真。
//   后台时给更宽的预算（反正看不见，不怕卡），回到前台只做轻量补算，
//   保证「切回来就能操作」。
const MAX_BACKLOG = 1800;               // 积压上限 30 分钟，超出丢弃
const CATCHUP_VISIBLE = { budgetMs: 60, maxSteps: 120 };
const CATCHUP_HIDDEN = { budgetMs: 800, maxSteps: 900 };
let _heartbeat = null;
let _beatAt = 0;                        // 上一拍的时间戳（ms）
let _beatCarry = 0;                     // 不足 1 秒的余量，累加到下一拍
let _backlog = 0;                       // 尚未补算的游戏秒数
function startLoop() {
  if (_heartbeat) return;
  _beatAt = Date.now();
  _heartbeat = setInterval(() => {
    const now = Date.now();
    const beat = splitBeat((now - _beatAt) / 1000, _beatCarry, MAX_BACKLOG);
    _beatAt = now;
    _beatCarry = beat.carry;
    _backlog += beat.steps;
    const acc = currentAccount();
    // 还没有存档（开始界面）时不累计：否则新建存档的第一拍会凭空补上一大段
    if (!acc) { _backlog = 0; return; }
    if (_backlog < 1) return;
    const budget = (typeof document !== 'undefined' && document.hidden) ? CATCHUP_HIDDEN : CATCHUP_VISIBLE;
    const r = drainBacklog(_backlog, {
      step: () => tick(1),
      budgetMs: budget.budgetMs,
      maxSteps: budget.maxSteps,
    });
    _backlog = r.rest;
    if (r.done > 0) acc.stats.playTimeSec = (acc.stats.playTimeSec || 0) + r.done;
  }, 1000);
}

// 关页面前强制落盘一次，避免丢掉最后一次自动存档之后的那几秒
window.addEventListener('beforeunload', () => { try { saveState(); } catch (e) { /* 忽略 */ } });

// ===== 启动 =====
loadState();
nav.showStart();
startLoop();
// v0.2.1：殖民地报告改为内联（每颗星球行内直接显示），不再弹右下角浮动提示条。
//   （历史仍可在「人力」页回看，见 population.js 的 buildReportHistory。）
// v0.0.8：离线结算。放在 showStart 之后——结算会跑很多 tick，弹面板前确保 UI 已渲染。
showOfflineSettlement();

// 启动完成：移除 index.html 里的「启动守卫」加载屏。
//   v0.0.61（rev3）修复移动端黑屏：此前模块加载失败/启动抛错时页面只剩深空背景，
//   错误被吞掉。守卫会把这类失败显示成可复制的错误面板，走到这里说明一切正常。
if (typeof window.__bootDone === 'function') window.__bootDone();

// 便于调试
window.ASTRIX = { STATE, openModal, closeModal };

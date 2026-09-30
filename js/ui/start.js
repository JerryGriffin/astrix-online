// 开始界面：标题、离线/在线模式、账号选择、各次要入口模态层（Astrix）
import {  STATE, createAccount, switchAccount, deleteAccount, currentAccount, START_MODES, switchPool  } from '../core/state.js?v=20.9';
import { fmtNum, fmtTime } from '../core/format.js?v=20.9';
// 版本号与更新日志的唯一来源：任何地方要显示版本都从这里取，改版本只改 js/version.js 一处
import { VERSION, VERSIONS } from '../version.js?v=20.9';

// 创建元素的小工具
function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
}

// 自定义二次确认弹层
function confirmModal(ctx, title, msg, onYes) {
  const wrap = document.createElement('div');
  const p = document.createElement('p');
  p.textContent = msg;
  const actions = document.createElement('div');
  actions.className = 'modal-actions';
  const yes = el('button', 'btn btn-danger', '确认');
  const no = el('button', 'btn', '取消');
  actions.append(yes, no);
  wrap.append(p, actions);
  const close = ctx.openModal({ title, body: wrap, sheet: true });
  yes.onclick = () => { close(); onYes(); };
  no.onclick = () => close();
}

// ===== 渲染开始界面 =====
export function renderStart(root, ctx) {
  root.innerHTML = '';
  root.className = 'screen screen-start';

  const wrap = el('div', 'start-wrap');

  const title = el('h1', 'start-title', 'ASTRIX');
  const sub = el('p', 'start-sub', '太空探索 · 殖民 · 争霸');
  const ver = el('p', 'start-ver', VERSION);

  // 主模式按钮：在线模式置顶（需先绑定邮箱），离线模式在下
  const modes = el('div', 'start-modes');
  modes.append(
    // v0.2.1：在线模式启用 —— 点击后要求先绑定邮箱（验证码登录 / 注册）才进入游戏
    modeButton('在线模式', '绑定邮箱即可开始游玩', () => ctx.enterOnline(), false),
    // v0.0.51：副文案由「全部是人机」改为「与电脑对抗」
    modeButton('离线模式', '与电脑对抗', () => handleOffline(ctx), true),
  );

  // 次要入口
  const secondary = el('div', 'start-secondary');
  const entries = [
    ['更新日志', () => openChangelog(ctx)],
    ['玩法提示', () => openTips(ctx)],
    ['统计数据与成就', () => openStats(ctx)],
    ['mod 管理', () => openMod(ctx)],
    ['设置', () => openSettings(ctx)],
    // v0.2.8：GitHub 仓库入口（源码与镜像发布地址）
    ['GitHub', () => window.open('https://github.com/JerryGriffin/astrix-online/', '_blank', 'noopener')],
  ];
  entries.forEach(([label, fn]) => {
    const b = el('button', 'sec-btn', label);
    b.addEventListener('click', fn);
    secondary.appendChild(b);
  });

  wrap.append(title, sub, ver, modes, secondary);
  root.appendChild(wrap);
}

function modeButton(label, sub, onClick, primary, soon) {
  const cls = 'mode-btn' + (primary ? ' mode-primary' : '') + (soon ? ' mode-soon' : '');
  const b = el('button', cls);
  b.append(el('span', 'mode-label', label), el('span', 'mode-sub muted', sub));
  if (soon) b.setAttribute('aria-disabled', 'true');
  b.addEventListener('click', onClick);
  return b;
}

// ===== 离线模式：账号选择 =====
function handleOffline(ctx) {
  // v0.0.6（需求 R6：修复「只有一个离线存档时无法删除」）：
  //   **始终**先开存档选择界面，不再「没有存档就直接进游戏」。
  //
  //   旧写法是 `if (STATE.accounts.length === 0) { ctx.enterOffline(); return; }`，
  //   而 ctx.enterOffline 会走到 main.js 的 ensureAccount()：
  //       if (STATE.accounts.length === 0) createAccount('指挥官');
  //   于是「删掉最后一个存档 → 退回开始界面 → 再点离线模式」会立刻看到一个
  //   崭新的「指挥官」存档，玩家的感受就是「只有一个存档时根本删不掉」。
  //   多存档时永远掉不到 0，所以只有单存档才撞得上这个坑 —— 这正是那个 bug
  //   「只在只有一个存档时出现」的原因。
  //
  //   注意：删除动作本身（deleteAccount + 列表重绘）从 v0.0.51 起就是好的，
  //   真正的幻影是「删完又被自动重建」。现在统一进选择界面：列表为空时
  //   界面上只剩「+ 新建存档」，建不建由玩家自己决定。
  openAccountPicker(ctx);
}

// 存档选择界面（v0.2.5：按池打开 —— offline / online 两池完全独立）。
// 导出供 main.js 的在线流程复用；先切池（自动落盘当前池）再渲染列表。
// titleNote：在线池标题后缀（当前邮箱），让玩家可自查所在存档池。
export function openAccountPicker(ctx, pool, titleNote) {
  pool = pool === 'online' ? 'online' : 'offline';
  try { switchPool(pool); } catch (e) { /* 切池失败也继续渲染（空列表可新建） */ }
  const body = document.createElement('div');
  renderAccountList(body, ctx, pool);
  const title = pool === 'online'
    ? ('在线存档 · ' + (titleNote || '') + '（与离线存档相互独立）')
    : '选择存档';
  ctx.openModal({ title, body, sheet: true });
}

function renderAccountList(body, ctx, pool) {
  const enterGame = () => (pool === 'online'
    ? (typeof ctx.enterOnlineGame === 'function' ? ctx.enterOnlineGame() : null)
    : ctx.enterOffline());
  body.innerHTML = '';
  STATE.accounts.forEach((acc) => {
    const row = el('div', 'acc-row');
    const info = el('div', 'acc-info');
    info.innerHTML =
      `<div class="acc-name">${escapeHtml(acc.name)}</div>` +
      `<div class="acc-meta muted">母星 ${escapeHtml(acc.homePlanetCode)}1 · ${acc.planetsOwned.length} 个殖民地</div>`;
    const actions = el('div', 'acc-actions');
    const isCurrent = acc.id === STATE.currentAccountId;
    // 当前存档显示「进入」（续玩）；其它存档显示「切换」后进入
    const enter = el('button', 'btn btn-sm' + (isCurrent ? ' btn-primary' : ''), isCurrent ? '进入' : '切换');
    enter.onclick = () => { if (!isCurrent) switchAccount(acc.id); enterGame(); };
    const del = el('button', 'btn btn-sm btn-danger', '删除');
    del.onclick = () => {
      actions.innerHTML = '';
      const yes = el('button', 'btn btn-sm btn-danger', '确认删除');
      const no = el('button', 'btn btn-sm', '取消');
      yes.onclick = () => {
        deleteAccount(acc.id);
        // v0.0.51 修复「删除存档无效」：
        // 此前删完最后一个存档会走 ctx.enterOffline()，而 enterOffline → ensureAccount()
        // 发现没有账号就**立刻新建一个「指挥官」**，于是玩家下次点「离线模式」又看到存档，
        // 观感就是「删除没生效」。
        // 现在：无论删没删空，都留在存档选择界面重绘列表——
        // 删空时列表为空、只剩下方的新建存档表单，玩家可以自己决定要不要建新的。
        renderAccountList(body, ctx, pool);
        if (STATE.accounts.length === 0) {
          const tip = el('p', 'modal-tip', '存档已全部删除。可在下方新建一个。');
          body.insertBefore(tip, body.firstChild);
        }
      };
      no.onclick = () => renderAccountList(body, ctx, pool);
      actions.append(yes, no);
    };
    actions.append(enter, del);
    row.append(info, actions);
    body.appendChild(row);
  });
  renderNewSaveForm(body, ctx, pool);
}

// 新建存档：用模态内联表单替代 window.prompt（更稳健、可被自动化驱动）
// v0.2.5：在线池只允许「初登星球」开局（漫溯深空仅限离线模式）
function renderNewSaveForm(body, ctx, pool) {
  const isOnline = pool === 'online';
  const form = el('div', 'acc-new-form');
  const input = document.createElement('input');
  input.type = 'text';
  input.className = 'acc-new-input';
  input.placeholder = '输入新存档名称';
  input.value = '深空旅人';
  input.setAttribute('aria-label', '新存档名称');
  // v0.1.0（设计者 [重要]）：新建存档时选择「初登星球」或「漫溯深空」
  //   初登星球 = 标准白手起家；漫溯深空 = 已到船坞科技的中期存档（随机 10 艘飞船）
  const modeRow = el('div', 'acc-mode-row');
  const modeTip = el('p', 'acc-new-tip muted', '');
  let mode = 'fresh';
  if (!isOnline) {
    const modeBtns = {};
    for (const m of START_MODES) {
      const b = el('button', 'btn acc-mode-btn' + (m.id === mode ? ' active' : ''), m.nameCn);
      b.type = 'button';
      b.style.minHeight = '44px';
      b.onclick = () => {
        mode = m.id;
        for (const k in modeBtns) modeBtns[k].classList.toggle('active', k === mode);
        modeTip.textContent = m.desc;
      };
      modeBtns[m.id] = b;
      modeRow.appendChild(b);
    }
    modeTip.textContent = START_MODES[0].desc;
  } else {
    modeTip.textContent = '在线模式仅支持「初登星球」开局（漫溯深空仅限离线模式）。';
  }

  const add = el('button', 'btn btn-primary', '+ 新建存档');
  const tip = el('p', 'acc-new-tip muted', '');
  const submit = () => {
    const name = input.value.trim();
    if (!name) { input.focus(); return; }
    if (STATE.accounts.some((a) => a.name === name)) {
      tip.textContent = '已存在同名存档，请换一个名称。';
      input.focus();
      return;
    }
    // v0.1.0：按所选开局模式建档（'deep' = 漫溯深空）；v0.2.5：在线池恒 fresh
    createAccount(name, isOnline ? 'fresh' : mode);
    if (isOnline) {
      if (typeof ctx.enterOnlineGame === 'function') ctx.enterOnlineGame();
      else ctx.enterOffline();
    } else {
      ctx.enterOffline();
    }
  };
  add.onclick = submit;
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') submit(); });
  form.append(input, modeRow, modeTip, add);
  form.appendChild(tip);
  body.appendChild(form);
}

// ===== 次要入口内容 =====
function openChangelog(ctx) {
  const body = document.createElement('div');
  // 更新日志来自 js/version.js（唯一来源），此处不再硬编码版本号与条目
  const parts = ['<div class="changelog">'];
  for (const [verName, date, items] of VERSIONS) {
    parts.push('<div class="cl-item">');
    parts.push('<div class="cl-ver">' + verName + ' <span class="muted">· ' + date + '</span></div>');
    parts.push('<ul class="cl-list">');
    for (const it of items) parts.push('<li>' + it + '</li>');
    parts.push('</ul></div>');
  }
  parts.push('</div>');
  body.innerHTML = parts.join('');
  ctx.openModal({ title: '更新日志', body });
}

function openTips(ctx) {
  const tips = [
    '资源采集是发展的根基：地表、地下、地核与气体各有专属储量与丰度，丰度越高越好挖。',
    '占领星球能扩大资源版图，但星球幸福度过低会触发独立倾向，需注意维持人力供给。',
    '人力分为总人力与可用人力，可用人力决定你同时能开展多少生产活动。',
    '科技是质变关键，优先解锁采集与精炼科技可显著提升效率。',
    '能量是运行的血液，水能、风能、太阳能系数影响你的发电上限。',
    '战争与舰队是后期争霸手段，前期建议稳健经营、积累物资。',
    '幸福度受居住条件与资源供给影响，断粮或过载会迅速拉低它。',
  ];
  const body = document.createElement('div');
  const ul = el('ul', 'tip-list');
  tips.forEach((t) => ul.appendChild(el('li', null, t)));
  body.appendChild(ul);
  ctx.openModal({ title: '玩法提示', body });
}

function openStats(ctx) {
  const acc = currentAccount();
  const stats = [
    ['累计游玩时间', fmtTime(acc ? acc.stats.playTimeSec : 0)],
    ['占领星球数', (acc ? acc.stats.planetsCaptured : 0) + ' 个'],
    ['累计采集资源量', fmtNum(acc ? acc.stats.resourcesCollected : 0)],
  ];
  const body = document.createElement('div');
  const grid = el('div', 'stat-grid');
  stats.forEach(([k, v]) => {
    const card = el('div', 'stat-card glass');
    card.append(el('div', 'stat-val', v), el('div', 'stat-key muted', k));
    grid.appendChild(card);
  });
  body.appendChild(grid);
  body.appendChild(el('p', 'modal-tip ach-tip', '成就系统开发中')); // 占位
  ctx.openModal({ title: '统计数据与成就', body });
}

function openMod(ctx) {
  const body = document.createElement('div');
  body.appendChild(el('p', 'modal-tip', '离线模式 mod 系统开发中，敬请期待。'));
  const only = el('p', 'modal-tip mod-offline-only', '⚠ 只对离线模式生效');
  body.appendChild(only);
  const btn = el('button', 'btn', '导入 mod');
  btn.disabled = true;
  body.appendChild(btn);
  ctx.openModal({ title: 'mod 管理', body });
}

function openSettings(ctx) {
  const body = document.createElement('div');
  const acc = currentAccount();

  // 音效开关
  const soundOn = STATE.ui.soundOn !== false;
  const soundBtn = el('button', 'btn', soundOn ? '音效：开' : '音效：关');
  soundBtn.onclick = () => {
    STATE.ui.soundOn = !STATE.ui.soundOn;
    soundBtn.textContent = STATE.ui.soundOn ? '音效：开' : '音效：关';
  };

  // 数字格式
  const fullNum = !!STATE.ui.fullNumber;
  const numBtn = el('button', 'btn', '数字格式：' + (fullNum ? '完整' : '简化'));
  numBtn.onclick = () => {
    STATE.ui.fullNumber = !STATE.ui.fullNumber;
    numBtn.textContent = '数字格式：' + (STATE.ui.fullNumber ? '完整' : '简化');
  };

  const clearBtn = el('button', 'btn btn-danger', '清除本地存档');
  clearBtn.onclick = () => {
    confirmModal(ctx, '清除本地存档', '确定清除所有本地存档？此操作不可恢复。', () => {
      Object.keys(localStorage).forEach((k) => {
        if (k.startsWith('astrix.save.')) localStorage.removeItem(k);
      });
      location.reload();
    });
  };

  [['音效', soundBtn], ['数字格式', numBtn], ['存档', clearBtn]].forEach(([label, control]) => {
    const row = el('div', 'set-row');
    row.append(el('span', 'set-label', label), control);
    body.appendChild(row);
  });

  ctx.openModal({ title: '设置', body });
}

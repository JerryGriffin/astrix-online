// 开始界面：标题、离线/在线模式、账号选择、各次要入口模态层（Astrix）
import {  STATE, createAccount, switchAccount, deleteAccount, currentAccount, START_MODES, setStorageMode, getStorageMode  } from '../core/state.js?v=21.17';
import { fmtNum, fmtTime } from '../core/format.js?v=21.17';
import { isSoundEnabled, toggleSound } from '../core/sound.js?v=21.17';
// 版本号与更新日志的唯一来源：任何地方要显示版本都从这里取，改版本只改 js/version.js 一处
import { VERSION, VERSIONS } from '../version.js?v=21.17';
// v0.2.2：离线 mod 系统
import { listMods, installMod, setModEnabled, removeMod, modEffects } from '../core/mods.js?v=21.17';

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

// 在线模式永久认证信息管理
const ONLINE_AUTH_KEY = 'astrix.online.auth';

function getOnlineAuth() {
  try {
    const raw = localStorage.getItem(ONLINE_AUTH_KEY);
    if (!raw) return null;
    const data = JSON.parse(raw);
    if (data && data.email && typeof data.email === 'string') return data;
  } catch (e) {}
  return null;
}

function setOnlineAuth(data) {
  try {
    if (!data) localStorage.removeItem(ONLINE_AUTH_KEY);
    else localStorage.setItem(ONLINE_AUTH_KEY, JSON.stringify(data));
  } catch (e) {}
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

  // 主模式按钮：在线星际模式与离线单机模式
  const modes = el('div', 'start-modes');
  modes.append(
    modeButton('在线星际', '星际星系 · 贸易与远征', () => handleOnline(ctx), true, false),
    modeButton('离线模式', '与电脑对抗', () => handleOffline(ctx), false, false),
  );

  // 次要入口
  const secondary = el('div', 'start-secondary');
  const entries = [
    ['更新日志', () => openChangelog(ctx)],
    ['玩法提示', () => openTips(ctx)],
    ['统计数据与成就', () => openStats(ctx)],
    ['模组管理', () => openMod(ctx)],
    ['设置', () => openSettings(ctx)],
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

// ===== 在线模式：邮箱认证与在线独立存档 =====
function handleOnline(ctx) {
  const auth = getOnlineAuth();
  if (auth && auth.email) {
    // 登录一次，永久免登：已登录过直接进入在线存档列表
    setStorageMode('online', auth.email);
    openOnlineAccountPicker(ctx, auth.email);
  } else {
    // 首次进入在线模式，弹出邮箱绑定与验证界面
    openOnlineLoginModal(ctx);
  }
}

function openOnlineLoginModal(ctx) {
  const body = document.createElement('div');
  body.className = 'glass';
  body.style.cssText = 'padding:14px;border-radius:8px;';

  const desc = el('p', '', '在线模式各账号存档相互独立，进度与邮箱绑定。首次验证后永久免登。');
  desc.style.cssText = 'font-size:13px;color:#94a3b8;line-height:1.5;margin-bottom:14px;';

  const emailLabel = el('label', '', '云账号邮箱：');
  emailLabel.style.cssText = 'display:block;font-size:12px;color:#7cd7ff;margin-bottom:4px;';
  const emailInput = document.createElement('input');
  emailInput.type = 'email';
  emailInput.placeholder = 'commander@space.net';
  emailInput.className = 'acc-new-input';
  emailInput.style.cssText = 'width:100%;min-height:44px;box-sizing:border-box;margin-bottom:12px;padding:8px 12px;background:#0b101c;border:1px solid #22354c;border-radius:6px;color:#c8d4e0;font-size:14px;';

  const codeLabel = el('label', '', '安全验证码（首次登录请输入 6 位验证码，测试期支持 666888 或任意6位数字）：');
  codeLabel.style.cssText = 'display:block;font-size:12px;color:#7cd7ff;margin-bottom:4px;';
  const codeRow = el('div', '');
  codeRow.style.cssText = 'display:flex;gap:8px;align-items:center;margin-bottom:14px;';
  const codeInput = document.createElement('input');
  codeInput.type = 'text';
  codeInput.placeholder = '6 位验证码';
  codeInput.maxLength = 6;
  codeInput.value = '666888';
  codeInput.style.cssText = 'flex:1;min-height:44px;padding:8px 12px;box-sizing:border-box;background:#0b101c;border:1px solid #22354c;border-radius:6px;color:#c8d4e0;font-size:15px;letter-spacing:2px;font-family:monospace;';
  const codeBtn = el('button', 'btn btn-sm', '一键填码');
  codeBtn.style.cssText = 'min-height:44px;white-space:nowrap;padding:0 12px;';
  codeBtn.onclick = () => {
    codeInput.value = '666888';
  };
  codeRow.append(codeInput, codeBtn);

  const tip = el('div', 'acc-new-tip', '');
  tip.style.cssText = 'color:#ff6b81;font-size:12px;margin-bottom:10px;min-height:18px;';

  const actions = el('div', '');
  actions.style.cssText = 'display:flex;gap:10px;justify-content:flex-end;';
  const cancelBtn = el('button', 'btn', '取消');
  cancelBtn.style.minHeight = '44px';
  const loginBtn = el('button', 'btn btn-primary', '登录并进入在线存档池');
  loginBtn.style.minHeight = '44px';

  actions.append(cancelBtn, loginBtn);
  body.append(desc, emailLabel, emailInput, codeLabel, codeRow, tip, actions);

  const close = ctx.openModal({ title: '在线星际 · 账号登录与绑定', body, sheet: true });
  cancelBtn.onclick = () => close();

  const doSubmit = () => {
    const email = emailInput.value.trim().toLowerCase();
    const code = codeInput.value.trim();
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      tip.textContent = '请输入合法的邮箱格式（如 player@domain.com）。';
      emailInput.focus();
      return;
    }
    if (!code || code.length < 4) {
      tip.textContent = '请输入有效的安全验证码。';
      codeInput.focus();
      return;
    }

    // 登录成功，写入永久免登凭证
    setOnlineAuth({
      email,
      verifiedAt: Date.now(),
      token: 'tk_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8),
    });

    close();
    setStorageMode('online', email);
    openOnlineAccountPicker(ctx, email);
  };

  loginBtn.onclick = doSubmit;
  codeInput.onkeydown = (e) => { if (e.key === 'Enter') doSubmit(); };
  emailInput.onkeydown = (e) => { if (e.key === 'Enter') doSubmit(); };
}

function openOnlineAccountPicker(ctx, email) {
  const body = document.createElement('div');
  renderOnlineAccountList(body, ctx, email);
  ctx.openModal({ title: `在线存档池（${email}）`, body, sheet: true });
}

function renderOnlineAccountList(body, ctx, email) {
  body.innerHTML = '';

  const headerBar = el('div', 'glass');
  headerBar.style.cssText = 'display:flex;justify-content:space-between;align-items:center;padding:10px 14px;border-radius:6px;margin-bottom:12px;background:rgba(124,215,255,0.06);border:1px solid rgba(124,215,255,0.2);';
  headerBar.innerHTML = `
    <div style="font-size:13px;color:#c8d4e0;">
      <span>云端账号：</span><b style="color:#7cd7ff;">${escapeHtml(email)}</b>
      <span style="font-size:11px;color:#94a3b8;margin-left:6px;">(永久免登已激活)</span>
    </div>
  `;
  const switchAccBtn = el('button', 'btn btn-sm', '切换账号 / 退出');
  switchAccBtn.style.cssText = 'font-size:12px;padding:4px 10px;';
  switchAccBtn.onclick = () => {
    setOnlineAuth(null);
    setStorageMode('offline');
    ctx.closeModal();
    openOnlineLoginModal(ctx);
  };
  headerBar.appendChild(switchAccBtn);
  body.appendChild(headerBar);

  if (STATE.accounts.length === 0) {
    const tip = el('p', 'modal-tip', '该邮箱下暂无在线存档。请在下方创建新存档（在线模式强制为「初登星球」全新开局）。');
    tip.style.cssText = 'color:#ffc46b;margin-bottom:12px;';
    body.appendChild(tip);
  } else {
    STATE.accounts.forEach((acc) => {
      const row = el('div', 'acc-row');
      const info = el('div', 'acc-info');
      info.innerHTML =
        `<div class="acc-name">${escapeHtml(acc.name)} <span style="font-size:11px;color:#6ee7b7;border:1px solid #10b98140;padding:1px 5px;border-radius:3px;">初登星球</span></div>` +
        `<div class="acc-meta muted">母星 ${escapeHtml(acc.homePlanetCode)}1 · ${acc.planetsOwned.length} 个殖民地</div>`;
      const actions = el('div', 'acc-actions');
      const isCurrent = acc.id === STATE.currentAccountId;
      const enter = el('button', 'btn btn-sm' + (isCurrent ? ' btn-primary' : ''), isCurrent ? '进入星系' : '切换');
      enter.onclick = () => {
        if (!isCurrent) switchAccount(acc.id);
        ctx.enterOnline(acc);
      };
      const del = el('button', 'btn btn-sm btn-danger', '删除');
      del.onclick = () => {
        actions.innerHTML = '';
        const yes = el('button', 'btn btn-sm btn-danger', '确认删除');
        const no = el('button', 'btn btn-sm', '取消');
        yes.onclick = () => {
          deleteAccount(acc.id);
          renderOnlineAccountList(body, ctx, email);
        };
        no.onclick = () => renderOnlineAccountList(body, ctx, email);
        actions.append(yes, no);
      };
      actions.append(enter, del);
      row.append(info, actions);
      body.appendChild(row);
    });
  }

  // 渲染新建表单（在线模式强制只能选择「初登星球」）
  renderNewSaveForm(body, ctx, true, email);
}

// ===== 离线模式：账号选择 =====
function handleOffline(ctx) {
  // 切换为离线模式存储池
  setStorageMode('offline');
  openAccountPicker(ctx);
}

function openAccountPicker(ctx) {
  const body = document.createElement('div');
  renderAccountList(body, ctx);
  ctx.openModal({ title: '选择离线单机存档', body, sheet: true });
}

function renderAccountList(body, ctx) {
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
    enter.onclick = () => { if (!isCurrent) switchAccount(acc.id); ctx.enterOffline(); };
    const del = el('button', 'btn btn-sm btn-danger', '删除');
    del.onclick = () => {
      actions.innerHTML = '';
      const yes = el('button', 'btn btn-sm btn-danger', '确认删除');
      const no = el('button', 'btn btn-sm', '取消');
      yes.onclick = () => {
        deleteAccount(acc.id);
        renderAccountList(body, ctx);
        if (STATE.accounts.length === 0) {
          const tip = el('p', 'modal-tip', '存档已全部删除。可在下方新建一个。');
          body.insertBefore(tip, body.firstChild);
        }
      };
      no.onclick = () => renderAccountList(body, ctx);
      actions.append(yes, no);
    };
    actions.append(enter, del);
    row.append(info, actions);
    body.appendChild(row);
  });
  renderNewSaveForm(body, ctx, false);
}

// 新建存档：用模态内联表单替代 window.prompt（更稳健、可被自动化驱动）
// isOnline = true 时，强制锁定为「初登星球」开局，隐藏并禁止「漫溯深空」
function renderNewSaveForm(body, ctx, isOnline = false, email = '') {
  const form = el('div', 'acc-new-form');
  const input = document.createElement('input');
  input.type = 'text';
  input.className = 'acc-new-input';
  input.placeholder = isOnline ? '输入在线指挥官名称' : '输入新存档名称';
  input.value = isOnline ? '星区指挥官' : '深空旅人';
  input.setAttribute('aria-label', '新存档名称');

  const modeRow = el('div', 'acc-mode-row');
  const modeTip = el('p', 'acc-new-tip muted', '');
  let mode = 'fresh';

  if (isOnline) {
    // 在线模式：强制且仅限「初登星球」开局
    const b = el('button', 'btn acc-mode-btn active', '初登星球（在线限定）');
    b.type = 'button';
    b.style.minHeight = '44px';
    b.disabled = true;
    modeRow.appendChild(b);
    modeTip.textContent = '在线联机模式为保障全服公平竞技与贸易生态，仅允许「初登星球」全新开局。';
  } else {
    // 离线模式：提供「初登星球」与「漫溯深空」
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
  }

  const add = el('button', 'btn btn-primary', isOnline ? '+ 新建在线存档' : '+ 新建存档');
  const tip = el('p', 'acc-new-tip muted', '');
  const submit = () => {
    const name = input.value.trim();
    if (!name) { input.focus(); return; }
    if (STATE.accounts.some((a) => a.name === name)) {
      tip.textContent = '已存在同名存档，请换一个名称。';
      input.focus();
      return;
    }
    // 在线模式强制为 fresh
    const finalMode = isOnline ? 'fresh' : mode;
    const acc = createAccount(name, finalMode);
    if (isOnline) {
      ctx.enterOnline(acc);
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
  const playTime = acc?.stats?.playTimeSec || 0;
  const planetsCaptured = acc?.stats?.planetsCaptured || (acc?.planetsOwned?.length ? acc.planetsOwned.length - 1 : 0);
  const resourcesCollected = acc?.stats?.resourcesCollected || 0;
  const techCount = acc?.tech?.length || 0;
  const shipsCount = acc?.ships?.length || 0;
  const armyCount = acc?.armies?.length || 0;
  const coloniesCount = acc?.planetsOwned?.length || 1;

  // 1. 指挥官荣誉军衔系统 (Commander Rank Evaluation)
  // 综合评估：总开采量、科技数、战舰数、殖民星球数、游玩时间
  const rankScore = (resourcesCollected / 500) + (techCount * 40) + (shipsCount * 30) + (armyCount * 25) + (coloniesCount * 50) + (playTime / 60);
  const RANKS = [
    { title: '预备宇航学员', icon: '🧑‍🚀', minScore: 0, nextScore: 100, desc: '初入星渊的拓荒新星，正在接受母星轨道领航条例训练。' },
    { title: '星际巡航少尉', icon: '🎖️', minScore: 100, nextScore: 300, desc: '具备独立指挥巡逻艇与采矿作业的合格初级军官。' },
    { title: '先锋突击少校', icon: '⚔️', minScore: 300, nextScore: 800, desc: '征服多处外星地质裂隙与地底矿脉的精锐开拓者。' },
    { title: '深空分舰队中校', icon: '🚀', minScore: 800, nextScore: 1800, desc: '统领多艘主力战舰与军团的深空前线指挥中坚。' },
    { title: '星区舰队上将', icon: '⭐', minScore: 1800, nextScore: 4000, desc: '主宰恒星系航道秩序与殖民疆域扩张的星区巨擘。' },
    { title: '星际最高统帅', icon: '👑', minScore: 4000, nextScore: 10000, desc: '威名响彻整个银河星网的终极文明缔造者与深空主宰。' },
  ];
  let curRank = RANKS[0];
  let nextRank = RANKS[1];
  for (let i = RANKS.length - 1; i >= 0; i--) {
    if (rankScore >= RANKS[i].minScore) {
      curRank = RANKS[i];
      nextRank = RANKS[i + 1] || null;
      break;
    }
  }
  const curBase = curRank.minScore;
  const targetDiff = nextRank ? (nextRank.minScore - curBase) : 1000;
  const progressRatio = nextRank ? Math.min(1, Math.max(0, (rankScore - curBase) / targetDiff)) : 1;

  // 2. 八大星际勋章殿堂 (Cosmic Achievements)
  const ACHIEVEMENTS = [
    {
      id: 'first_step',
      name: '第一滴晨曦',
      badge: '🌅',
      desc: '累计完成 3 分钟深空殖民基地运营。',
      unlocked: playTime >= 180,
      progress: Math.min(100, Math.floor((playTime / 180) * 100)),
      hint: `${fmtTime(playTime)} / 3分00秒`,
    },
    {
      id: 'mining_magnate',
      name: '行星采矿大亨',
      badge: '⛏️',
      desc: '累计从地表与深地层开采逾 1,000 战略物资。',
      unlocked: resourcesCollected >= 1000,
      progress: Math.min(100, Math.floor((resourcesCollected / 1000) * 100)),
      hint: `${fmtNum(resourcesCollected)} / 1,000`,
    },
    {
      id: 'tech_luminary',
      name: '量子求索者',
      badge: '🔬',
      desc: '在科技树中攻克突破 5 项核心科研技术。',
      unlocked: techCount >= 5,
      progress: Math.min(100, Math.floor((techCount / 5) * 100)),
      hint: `${techCount} / 5 项`,
    },
    {
      id: 'fleet_admiral',
      name: '星海巡航群',
      badge: '🛸',
      desc: '建造并入列至少 3 艘星际战舰或深空工程船。',
      unlocked: shipsCount >= 3,
      progress: Math.min(100, Math.floor((shipsCount / 3) * 100)),
      hint: `${shipsCount} / 3 艘`,
    },
    {
      id: 'army_legion',
      name: '铁血地面军团',
      badge: '🪖',
      desc: '整编组建至少 2 支具备战备能力的行星陆战队。',
      unlocked: armyCount >= 2,
      progress: Math.min(100, Math.floor((armyCount / 2) * 100)),
      hint: `${armyCount} / 2 支`,
    },
    {
      id: 'galaxy_colonizer',
      name: '星辰插旗者',
      badge: '🪐',
      desc: '将文明版图拓展至 2 颗或以上星系天体。',
      unlocked: coloniesCount >= 2,
      progress: Math.min(100, Math.floor((coloniesCount / 2) * 100)),
      hint: `${coloniesCount} / 2 颗`,
    },
    {
      id: 'deep_explorer',
      name: '群星漫溯者',
      badge: '🌌',
      desc: '深空指挥长跑：累计在线指挥 15 分钟以上。',
      unlocked: playTime >= 900,
      progress: Math.min(100, Math.floor((playTime / 900) * 100)),
      hint: `${fmtTime(playTime)} / 15分00秒`,
    },
    {
      id: 'apex_overlord',
      name: '深空银河霸权',
      badge: '👑',
      desc: '指挥官综合功勋积分突破 1,000 点。',
      unlocked: rankScore >= 1000,
      progress: Math.min(100, Math.floor((rankScore / 1000) * 100)),
      hint: `${Math.floor(rankScore)} / 1,000 点`,
    },
  ];

  const unlockedCount = ACHIEVEMENTS.filter((a) => a.unlocked).length;

  const body = document.createElement('div');
  body.className = 'stats-ach-container';

  // 基础统计卡片
  const stats = [
    ['累计指挥历程', fmtTime(playTime)],
    ['已掌控星体', coloniesCount + ' 颗'],
    ['累计开采资源', fmtNum(resourcesCollected)],
    ['科研突破技术', techCount + ' 项'],
    ['深空战舰数量', shipsCount + ' 艘'],
    ['军备陆战序列', armyCount + ' 支'],
  ];
  const grid = el('div', 'stat-grid');
  stats.forEach(([k, v]) => {
    const card = el('div', 'stat-card glass');
    card.append(el('div', 'stat-val', v), el('div', 'stat-key muted', k));
    grid.appendChild(card);
  });
  body.appendChild(grid);

  // 指挥官军衔 HUD
  const rankBox = el('div', 'rank-hud glass');
  const rankTop = el('div', 'rank-top-row');
  const rankTitleWrap = el('div', 'rank-title-wrap');
  rankTitleWrap.innerHTML = `
    <div class="rank-icon-big">${curRank.icon}</div>
    <div class="rank-name-box">
      <div class="rank-honor-label muted">舰队最高司令部特授军衔</div>
      <div class="rank-name-text">${curRank.title}</div>
    </div>
  `;
  const rankScoreBadge = el('div', 'rank-score-badge');
  rankScoreBadge.innerHTML = `<span class="muted">统帅功勋分</span> <strong>${Math.floor(rankScore)}</strong>`;
  rankTop.append(rankTitleWrap, rankScoreBadge);

  const rankDesc = el('div', 'rank-desc-text', curRank.desc);

  const rankBarWrap = el('div', 'rank-bar-wrap');
  const rankProgress = el('div', 'rank-progress-bar');
  rankProgress.style.width = `${Math.round(progressRatio * 100)}%`;
  rankBarWrap.appendChild(rankProgress);

  const rankNextTip = el('div', 'rank-next-tip muted');
  rankNextTip.textContent = nextRank
    ? `晋升【${nextRank.title}】还需 ${(nextRank.minScore - Math.floor(rankScore)).toFixed(0)} 功勋分 (进度 ${Math.round(progressRatio * 100)}%)`
    : `★ 已获封最高统帅荣誉军衔，受万星敬仰！`;

  rankBox.append(rankTop, rankDesc, rankBarWrap, rankNextTip);
  body.appendChild(rankBox);

  // 成就殿堂头部
  const achHeader = el('div', 'ach-header');
  achHeader.innerHTML = `
    <div class="ach-header-title">🏅 星际成就勋章殿堂 (${unlockedCount} / ${ACHIEVEMENTS.length})</div>
    <div class="ach-header-rate muted">成就达成率：${Math.round((unlockedCount / ACHIEVEMENTS.length) * 100)}%</div>
  `;
  body.appendChild(achHeader);

  // 成就卡片网格
  const achGrid = el('div', 'ach-cards-grid');
  ACHIEVEMENTS.forEach((ach) => {
    const card = el('div', `ach-card glass ${ach.unlocked ? 'ach-unlocked' : 'ach-locked'}`);
    const badge = el('div', 'ach-badge', ach.badge);
    const content = el('div', 'ach-content');
    const header = el('div', 'ach-card-header');
    const title = el('div', 'ach-title', ach.name);
    const status = el('span', `ach-status-tag ${ach.unlocked ? 'tag-unlocked' : 'tag-locked'}`, ach.unlocked ? '✓ 已加冕' : '进行中');
    header.append(title, status);

    const desc = el('div', 'ach-desc muted', ach.desc);

    const progressBox = el('div', 'ach-prog-box');
    const progTrack = el('div', 'ach-prog-track');
    const progFill = el('div', 'ach-prog-fill');
    progFill.style.width = `${ach.progress}%`;
    progTrack.appendChild(progFill);
    const hint = el('div', 'ach-prog-hint muted', ach.hint);
    progressBox.append(progTrack, hint);

    content.append(header, desc, progressBox);
    card.append(badge, content);
    achGrid.appendChild(card);
  });
  body.appendChild(achGrid);

  ctx.openModal({ title: '指挥官统帅殿堂与星际成就', body });
}

// ============================================================================
// 模组管理（v0.2.2 落地）：JSON 导入 / 启停 / 卸载，仅离线模式生效
// ============================================================================
const MOD_SAMPLE = {
  name: '畅玩加速包',
  version: '1.0',
  author: '指挥官',
  desc: '采集/生产/科研 3 倍，开局追加物资',
  effects: {
    collectRateMul: 3,
    lineRateMul: 3,
    researchRateMul: 3,
    powerOutputMul: 1.5,
    startAscoin: 500000,
    startResources: { '石头': 5000, '水': 5000, '铁': 1000 },
  },
};

function fmtModEffectLine(fx) {
  const parts = [];
  const mulNames = {
    collectRateMul: '采集', lineRateMul: '生产', researchRateMul: '科研', powerOutputMul: '发电',
  };
  for (const k in mulNames) {
    const v = Number(fx[k]);
    if (Number.isFinite(v) && v !== 1) parts.push(mulNames[k] + ' ×' + v);
  }
  if (Number(fx.startAscoin) > 0) parts.push('开局 +' + fmtNum(fx.startAscoin) + ' Ascoin');
  const res = fx.startResources || {};
  const resKeys = Object.keys(res);
  if (resKeys.length) {
    parts.push('开局 ' + resKeys.map((m) => m + '×' + fmtNum(res[m])).join('、'));
  }
  return parts.length ? parts.join(' · ') : '（无生效数值）';
}

function openMod(ctx) {
  const body = document.createElement('div');

  body.appendChild(el('p', 'modal-tip',
    '导入 JSON 格式的模组文件，为离线游戏调整数值倍率或开局物资。倍率对离线模式的全部存档生效，开局物资只对导入后新建的存档生效。不会上传、不影响在线模式。'));

  // 当前生效的总效果
  const fx = modEffects();
  const fxLine = el('p', 'modal-tip', '当前合成效果：' + fmtModEffectLine(fx));
  fxLine.style.color = '#9FE1CB';
  body.appendChild(fxLine);

  // 已安装列表
  const mods = listMods();
  if (mods.length) {
    const listTitle = el('div', null, '已安装（' + mods.length + '）');
    listTitle.style.cssText = 'font-size:13px;font-weight:bold;color:#7cd7ff;margin:10px 0 6px;';
    body.appendChild(listTitle);
    for (const m of mods) {
      const row = document.createElement('div');
      row.style.cssText = 'display:flex;align-items:center;gap:8px;padding:8px;border:1px solid #22354c;border-radius:6px;margin-bottom:6px;background:rgba(0,0,0,0.25);';
      const info = document.createElement('div');
      info.style.cssText = 'flex:1;min-width:0;';
      info.innerHTML = '<b style="color:#f1f5f9;">' + escapeHtml(m.name) + '</b>'
        + ' <span style="color:#64748b;font-size:11px;">v' + escapeHtml(m.version || '') + ' · ' + escapeHtml(m.author || '') + '</span>'
        + '<div style="font-size:11px;color:#94a3b8;margin-top:2px;word-break:break-all;">'
        + (m.desc ? escapeHtml(m.desc) + '<br>' : '')
        + '<span style="color:#9FE1CB;">' + escapeHtml(fmtModEffectLine(m.effects || {})) + '</span></div>';
      const tog = el('button', 'btn btn-sm', m.enabled === false ? '已停用' : '已启用');
      tog.style.cssText = 'min-height:36px;' + (m.enabled === false
        ? 'background:rgba(255,255,255,0.06);color:#64748b;'
        : 'background:rgba(159,225,203,0.15);color:#9FE1CB;');
      tog.addEventListener('click', () => {
        setModEnabled(m.id, m.enabled === false);
        closeModal();
        openMod(ctx);
      });
      const del = el('button', 'btn btn-sm btn-danger', '卸载');
      del.style.cssText = 'min-height:36px;';
      del.addEventListener('click', () => {
        confirmModal(ctx, '卸载模组', `确定卸载「${m.name}」吗？（开局资源类效果对已建存档不回滚）`, () => {
          removeMod(m.id);
          closeModal();
          openMod(ctx);
        });
      });
      row.append(info, tog, del);
      body.appendChild(row);
    }
  } else {
    body.appendChild(el('p', 'modal-tip muted', '尚未安装任何模组。'));
  }

  // 导入区
  const impTitle = el('div', null, '导入新模组');
  impTitle.style.cssText = 'font-size:13px;font-weight:bold;color:#7cd7ff;margin:12px 0 6px;';
  body.appendChild(impTitle);

  const ta = document.createElement('textarea');
  ta.id = 'mod-json-input';
  ta.placeholder = '把模组的 JSON 内容粘贴到这里，或点击下方「载入示例」参考格式…';
  ta.style.cssText = 'width:100%;height:130px;box-sizing:border-box;background:#0b101c;color:#c8d4e0;border:1px solid #22354c;border-radius:6px;padding:10px;font:12px/1.5 ui-monospace,Consolas,monospace;white-space:pre;word-break:break-all;';
  body.appendChild(ta);

  const err = el('div', null, '');
  err.style.cssText = 'color:#ff6b81;font-size:12px;margin:6px 0;min-height:16px;';
  body.appendChild(err);

  const btnRow = document.createElement('div');
  btnRow.style.cssText = 'display:flex;gap:8px;flex-wrap:wrap;';
  const btnSample = el('button', 'btn', '载入示例');
  btnSample.style.minHeight = '44px';
  btnSample.addEventListener('click', () => { ta.value = JSON.stringify(MOD_SAMPLE, null, 2); });
  const btnFile = el('button', 'btn', '从文件导入');
  btnFile.style.minHeight = '44px';
  btnFile.addEventListener('click', () => {
    const inp = document.createElement('input');
    inp.type = 'file';
    inp.accept = '.json,application/json';
    inp.addEventListener('change', () => {
      const f = inp.files && inp.files[0];
      if (!f) return;
      const reader = new FileReader();
      reader.addEventListener('load', () => { ta.value = String(reader.result || ''); });
      reader.readAsText(f);
    });
    inp.click();
  });
  const btnInstall = el('button', 'btn btn-primary', '安装模组');
  btnInstall.style.minHeight = '44px';
  btnInstall.addEventListener('click', () => {
    const r = installMod(ta.value);
    if (!r.ok) { err.textContent = r.reason || '安装失败'; return; }
    closeModal();
    openMod(ctx);
  });
  btnRow.append(btnSample, btnFile, btnInstall);
  body.appendChild(btnRow);

  body.appendChild(el('p', 'modal-tip mod-offline-only', '⚠ 只对离线模式生效；在线模式一律忽略模组数值。'));

  ctx.openModal({ title: '模组管理', body });
}

function openSettings(ctx) {
  const body = document.createElement('div');
  const acc = currentAccount();

  // 音效开关
  const soundOn = isSoundEnabled();
  STATE.ui.soundOn = soundOn;
  const soundBtn = el('button', 'btn', soundOn ? '音效：开' : '音效：关');
  soundBtn.onclick = () => {
    const next = toggleSound();
    STATE.ui.soundOn = next;
    soundBtn.textContent = next ? '音效：开' : '音效：关';
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

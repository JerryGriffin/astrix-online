// 开始界面：标题、离线/在线模式、账号选择、各次要入口模态层（Astrix）
import {  STATE, createAccount, switchAccount, deleteAccount, currentAccount, START_MODES  } from '../core/state.js?v=21.8';
import { fmtNum, fmtTime } from '../core/format.js?v=21.8';
import { isSoundEnabled, toggleSound } from '../core/sound.js?v=21.8';
// 版本号与更新日志的唯一来源：任何地方要显示版本都从这里取，改版本只改 js/version.js 一处
import { VERSION, VERSIONS } from '../version.js?v=21.8';

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

  // 主模式按钮：在线星际模式与离线单机模式
  const modes = el('div', 'start-modes');
  modes.append(
    modeButton('在线星际', '星际星系 · 贸易与远征', () => ctx.enterOnline(), true, false),
    modeButton('离线模式', '与电脑对抗', () => handleOffline(ctx), false, false),
  );

  // 次要入口
  const secondary = el('div', 'start-secondary');
  const entries = [
    ['更新日志', () => openChangelog(ctx)],
    ['玩法提示', () => openTips(ctx)],
    ['统计数据与成就', () => openStats(ctx)],
    ['mod 管理', () => openMod(ctx)],
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

function openAccountPicker(ctx) {
  const body = document.createElement('div');
  renderAccountList(body, ctx);
  ctx.openModal({ title: '选择存档', body, sheet: true });
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
        // v0.0.51 修复「删除存档无效」：
        // 此前删完最后一个存档会走 ctx.enterOffline()，而 enterOffline → ensureAccount()
        // 发现没有账号就**立刻新建一个「指挥官」**，于是玩家下次点「离线模式」又看到存档，
        // 观感就是「删除没生效」。
        // 现在：无论删没删空，都留在存档选择界面重绘列表——
        // 删空时列表为空、只剩下方的新建存档表单，玩家可以自己决定要不要建新的。
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
  renderNewSaveForm(body, ctx);
}

// 新建存档：用模态内联表单替代 window.prompt（更稳健、可被自动化驱动）
function renderNewSaveForm(body, ctx) {
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
    // v0.1.0：按所选开局模式建档（'deep' = 漫溯深空）
    createAccount(name, mode);
    ctx.enterOffline();
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

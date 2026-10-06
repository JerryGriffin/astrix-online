// v0.4.16（① 入口整合）：把「电脑势力星球」从星际页搬到「军事」入口下。
//
// 起因：同一个页面上同时摆着两套战斗入口 —— 星际页的「进攻 NPC」按钮（一次性
//   resolveBattle 结算，掠夺金库）与战区页的战役体系（持久战区 + 逐小时推进）。
//   用户诉求是「战斗系统不要在多个入口里面存在各种新旧窗口」。
//
// 为什么不把 NPC 塞进战区地图：NPC 是**贸易站**（有买卖价、金库、守军战力），
//   而战区地图表达的是**领土归属**（战区占领 / 补给 / 围城）。硬把 NPC 画成地图
//   势力会混淆两种语义 —— NPC 没有「战区」可占。所以这里做的是**入口归一**：
//   把 NPC 的交易与进攻整体迁到「军事 → 势力」子页，星际页不再重复提供。
//
// 代码仍留在 galaxy.js（避免大规模跨模块搬移的风险），只对外暴露一个面板函数。
import { readFileSync, writeFileSync } from 'fs';

const FILE = 'js/ui/galaxy.js';
let src = readFileSync(FILE, 'utf8');
const EOL = src.includes('\r\n') ? '\r\n' : '\n';
src = src.split(EOL).join('\n');
let n = 0;
function must(c, what) { if (!c) { console.error('✗ ' + what); process.exit(1); } n++; }

// ---------------------------------------------------------------- 1) 星际页移除 NPC 区块
const OLD_SEC = `  // ---- 3.5 电脑势力星球（v0.2.10：独立区块 + 同步渲染，不依赖云端请求，永远可见）----
  const npcSec = el('div', 'gx-section');
  npcSec.appendChild(el('div', 'section-title', '电脑势力星球'));
  npcSec.appendChild(el('div', 'muted', '即时交易 / 进攻 / 结盟（盟友购买价 9 折、互不侵犯）。'));
  npcGrid.id = 'gx-npc-grid';
  npcSec.appendChild(npcGrid);
  body.appendChild(npcSec);
  renderNpcGrid(npcGrid, ctx, rerender, acc, '');`;

const NEW_SEC = `  // v0.4.16 **入口整合**：电脑势力星球（交易 / 进攻 / 结盟）已迁到
  //   「军事 → 势力」子页。这里**只留一个指引**，不再重复提供第二个入口 ——
  //   此前星际页与战区页同时摆着两套战斗入口，正是「多个入口里存在新旧窗口」。
  //   仍保留 npcGrid 这个空容器：搜索栏还要在本地模式下驱动它（见下）。
  const npcSec = el('div', 'gx-section');
  npcSec.appendChild(el('div', 'section-title', '电脑势力'));
  npcSec.appendChild(el('div', 'muted',
    '势力交易与进攻已移至「军事 → 势力」页（与战区战役同属一个入口）。'));
  npcGrid.id = 'gx-npc-grid';
  npcSec.appendChild(npcGrid);
  body.appendChild(npcSec);`;
must(src.includes(OLD_SEC), '星际页的 NPC 区块');
src = src.replace(OLD_SEC, () => NEW_SEC);

// 搜索栏不再驱动 NPC 网格（NPC 已迁走）
const OLD_SEARCH = `  searchInput.addEventListener('input', () => {
    query = searchInput.value.trim().toLowerCase();
    renderNpcGrid(npcGrid, ctx, rerender, acc, query);
    renderPlanetGrid(planetGrid, ctx, rerender, u, acc, query);
  });`;
const NEW_SEARCH = `  searchInput.addEventListener('input', () => {
    query = searchInput.value.trim().toLowerCase();
    // v0.4.16：NPC 网格迁到「军事 → 势力」，搜索只过滤本页的玩家星球
    renderPlanetGrid(planetGrid, ctx, rerender, u, acc, query);
  });`;
must(src.includes(OLD_SEARCH), '搜索栏的 input 回调');
src = src.replace(OLD_SEARCH, () => NEW_SEARCH);

// ---------------------------------------------------------------- 2) 导出独立面板
const ANCHOR = `/** 电脑势力星球网格（v0.2.10：独立同步渲染，不依赖云端） */`;
const PANEL = `/**
 * 「军事 → 势力」子页：电脑势力的交易 / 进攻 / 结盟。
 *
 * v0.4.16 从星际页整体迁来，作为军事系统的**唯一**势力入口。
 * 代码仍在 galaxy.js 内（避免跨模块搬移的风险），只在这里对外暴露一个可独立
 * 挂载的面板 —— 星际页不再重复渲染这一块。
 */
export function renderForcesPanel(root, ctx) {
  root.innerHTML = '';
  const acc = currentAccount();
  if (!acc) { root.appendChild(el('div', 'muted', '账号数据缺失。')); return; }

  const sec = el('div', 'gx-section');
  sec.appendChild(el('div', 'section-title', '电脑势力'));
  sec.appendChild(el('div', 'muted',
    '即时交易 / 进攻 / 结盟（盟友购买价 9 折、互不侵犯）。'
    + '势力是**贸易站**而非领土持有者，所以进攻按一次性战役结算并掠夺金库，'
    + '不像战区那样逐小时推进 —— 两者是不同性质的目标。'));

  const grid = el('div', 'gx-grid');
  grid.id = 'gx-forces-grid';

  // 搜索：只过滤本页的势力，不牵连星际页
  const searchWrap = el('div', 'gx-search');
  const input = document.createElement('input');
  input.type = 'text';
  input.placeholder = '搜索势力 / 驻地 / 代号…';
  searchWrap.appendChild(input);
  sec.appendChild(searchWrap);

  sec.appendChild(grid);
  root.appendChild(sec);

  const rerender = () => renderForcesPanel(root, ctx);
  renderNpcGrid(grid, ctx, rerender, acc, '');
  input.addEventListener('input', () => {
    renderNpcGrid(grid, ctx, rerender, acc, input.value.trim().toLowerCase());
  });
}

`;
must(src.includes(ANCHOR), 'renderNpcGrid 的注释锚点');
src = src.replace(ANCHOR, () => PANEL + ANCHOR);

writeFileSync(FILE, src.split('\n').join(EOL), 'utf8');
console.log('✓ galaxy.js：NPC 迁出星际页，新增 renderForcesPanel（' + n + ' 处改动）');
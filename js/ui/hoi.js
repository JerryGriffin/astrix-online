// 国策与轨道圈层面板（v0.2.6 官方 mod 1936 剧本）
// v0.4.0 太空化：原「海域 / 制海权 / 海军 / 空军」整套二战地球语境已改为
//   **轨道圈层 / 轨道控制 / 空间舰队 / 轨道火力**，玩法逻辑保留、命名去二战化。
//   · 轨道圈层：母星行星的 7 个轨道圈层，争夺轨道控制权（决定陆战补给上限与能否轨道轰炸）
//   · 顶部：剧本日历（到天）、国家、阵营、人口、军队 / 舰队概览
//   · 国策树：工业 / 军事 / 外交三支，各两支；按游戏天数推进，完成即生效
//   · 轨道圈层：母星行星的 7 个轨道圈层，争夺轨道控制权
import { fmtNum } from '../core/format.js?v=57.8';
import { currentAccount, getPlanetInstance } from '../core/state.js?v=57.8';
import { listArmies, totalArmyPowerOf } from '../core/army.js?v=57.8';
import { listFleets, fleetPowerOf } from '../core/fleet.js?v=57.8';
import {
  scenarioDateOf, gameDaysOf, ensureFocus, focusOptionsOf, startFocus,
  ensureSeas, contestSea, blocNameOf, nationOf, deepOf, enemySeaPressure, backgroundOf, HOI_SCENARIO_ID,
  listHistTargets, histWarGateFor,
  // v0.4.7：兵员数不再在 UI 里写死 500，改引核心常量（单一来源）
  //   ARMY_MEN 本身在 data/hoi1936.js 且 core 层未 re-export，
  //   这里用 core/hoi1936.js 已经导出的 ARMY_MEN_MAX（= ARMY_MEN 的再导出）。
  ARMY_MEN_MAX,
} from '../core/hoi1936.js?v=57.8';
// v0.3.3：战争数据（实时交战双方状态）
// v0.4.8：declareWar / warWith —— 非 1936 剧本的战区页要能直接对敌对势力宣战
import { activeWarsOf, declareWar, warWith } from '../core/war.js?v=57.8';
// v0.4.8：通用势力名解析（fac_* 势力在非 1936 剧本下用于战区归属显示）
import { factionNameCn, factionFlag, factionDesc, factionPower} from '../data/factions.js?v=57.8';
// v0.3.4：战役系统（师级交战 / 组织度 / 补给 / 工事 / 增援）—— 替代「只有进度条」
import {
  listBattles, battleView, startBattle, committableArmies, foeRemaining,
  orderRetreat, stopBattle, terrainList, BATTLE_MAX_PER_WAR, BATTLE_COMBAT_WIDTH,
  ORBITAL_BOMB_CHARGES, orbitalControlOf,
  // v0.4.5（需求 2）：指挥官 + 战役事件
  commandersOf, assignCommander, battleById,
} from '../core/battle.js?v=57.8';
// v0.4.1：行星战区地图（战区归属 / 补给网络 / 战略轨道打击 / 殖民地争夺）
import {
  ensureTheater, theaterView, attackTargetsOf, canStrikeRegion, strikeRegion,
  colonyIncomeOf, REGION_STRUCTURES, STRIKE_MAX, supplyLinksOf,
  frontInfoOf as THfrontInfo, canOpenFront as THcanFront,
  REGION_MAX_FRONTS as TH_MAX_FRONTS, SIEGE_REQUIRED as TH_SIEGE,
  regionYieldOf, colonySupportOf, regionById,
} from '../core/theater.js?v=57.8';
// v0.4.9 入口整合：战争终局（和平会议 / 投降）接入本页 —— 此前这两个操作**只在
//   「星际页」的国家卡片上**，而仗是在本页的战区地图上打的，玩家打完找不到地方结束战争。
import { surrenderWar } from '../core/war.js?v=57.8';
import { openPeaceConference } from './treaty.js?v=57.8';
import { HOI_BY_ID, HIST_TIMELINE} from '../data/hoi1936.js?v=57.8';
// v0.4.7：el() 收敛到 ui/common.js（此前本文件自带一份；全项目共 14 份、两种不兼容签名，
//   v0.3.2「列强区块不显示」即源于把 A 型调用写进了 B 型文件）
import { el, ensureStyle } from './common.js?v=57.8';

// v0.4.1：地图交互状态（同样放模块级，避免每秒重绘冲掉选中项）
// v0.4.3：plan = 多路战线规划（同时开辟多条战线），mode='plan' 时点目标只入队不立即开战
const _mapSel = { regionId: null, plan: [], mode: 'single' };

// v0.3.4：开辟战线的选择状态放**模块级** —— 本页每秒整块重绘（见文件末尾 _hoiTimer），
//   若把勾选存在 DOM 里会被每次重绘冲掉，用户根本没法挑兵。
// v0.4.7：默认值由 'plain' 改为 'regolith' —— 'plain' 是 v0.4.0 之前的地球地形，
//   UI 下拉框只列太空地貌（SPACE_TERRAIN_IDS），玩家不选地形直接开战时
//   会被 startBattle 兜底成 'regolith'，导致这个默认值形同虚设。
const _lineSel = { warId: null, ids: [], terrain: 'regolith', msg: '', originId: null, targetId: null };

const CSS = `
  .hoi-panel { font-family: system-ui, sans-serif; color: #e8eef2; padding: 12px; box-sizing: border-box; }
  .hoi-head { background: linear-gradient(180deg, #1c2733, #16202b); border: 1px solid #2a3645; border-radius: 10px; padding: 12px; margin-bottom: 12px; }
  .hoi-date { font-size: 24px; font-weight: 800; letter-spacing: 1px; color: #ffd479; }
  .hoi-sub { font-size: 12px; opacity: .8; margin-top: 4px; line-height: 1.8; }
  .hoi-stats { display: flex; gap: 8px; flex-wrap: wrap; margin-top: 8px; }
  .hoi-stat { background: #101820; border-radius: 8px; padding: 8px 10px; min-width: 96px; }
  .hoi-stat .lbl { font-size: 11px; opacity: .65; }
  .hoi-stat .val { font-size: 16px; font-weight: 700; }
  .hoi-sec { border: 1px solid #2a3645; border-radius: 10px; margin-bottom: 12px; overflow: hidden; }
  .hoi-sec-h { padding: 9px 12px; background: #16202b; font-weight: 700; display: flex; justify-content: space-between; align-items: baseline; }
  .hoi-branch { padding: 8px 12px; }
  .hoi-branch > .bn { font-size: 12px; color: #9FE1CB; font-weight: 700; margin: 6px 0 4px; }
  .hoi-focus { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; padding: 8px; min-height: 44px; border-top: 1px solid #223040; }
  .hoi-focus .nm { flex: 1 1 150px; min-width: 0; }
  .hoi-focus .nm .d { font-size: 11px; opacity: .65; line-height: 1.5; }
  .hoi-focus .tag { font-size: 11px; padding: 2px 6px; border-radius: 8px; border: 1px solid #34465a; }
  .hoi-focus .tag.done { color: #9FE1CB; border-color: rgba(159,225,203,.5); }
  .hoi-focus button { min-height: 40px; border-radius: 8px; border: none; background: #2d3e50; color: #fff; cursor: pointer; padding: 0 10px; }
  .hoi-focus button.primary { background: #2a5a4d; }
  .hoi-bar { height: 8px; border-radius: 4px; background: #101820; overflow: hidden; margin-top: 4px; }
  .hoi-bar > i { display: block; height: 100%; background: #9FE1CB; }
  .hoi-sea { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; padding: 8px 12px; border-top: 1px solid #223040; min-height: 44px; }
  .hoi-sea .nm { flex: 1 1 120px; }
  .hoi-sea .ctl { width: 120px; }
  .hoi-sea button { min-height: 40px; border-radius: 8px; border: none; background: #2d3e50; color: #fff; cursor: pointer; padding: 0 10px; }
  .hoi-note { font-size: 12px; opacity: .65; padding: 0 2px 8px; line-height: 1.7; }
  /* —— v0.3.3 战争区块 —— */
  .hoi-war-sel { min-height:40px; border-radius:8px; background:#2d3e50; color:#fff; border:none; padding:0 8px; max-width:100%; }
  .hoi-war-side { flex: 1 1 220px; min-width:0; border-radius:8px; padding:8px 10px; background:#101820; border:1px solid #223040; }
  .hoi-war-side .who { font-size:14px; font-weight:700; display:flex; align-items:center; gap:6px; }
  .hoi-war-side .who .fl { font-size:16px; }
  .hoi-war-side .kv { display:flex; justify-content:space-between; font-size:12px; padding:2px 0; opacity:.92; }
  .hoi-war-side .kv .k { opacity:.6; }
  .hoi-war-side .kv .v { font-weight:600; }
  .hoi-war-vs { text-align:center; font-size:11px; opacity:.6; padding:2px 0; }
  .hoi-war-row { display:flex; gap:8px; flex-wrap:wrap; padding:8px 12px; border-top:1px solid #223040; }
  .hoi-war-ongoing { display:flex; flex-wrap:wrap; gap:6px; padding:8px 12px 0; }
  .hoi-war-chip { font-size:11px; border:1px solid #34465a; border-radius:10px; padding:2px 8px; }
  .hoi-war-chip.hot { color:#f09595; border-color:rgba(240,149,149,.5); }
  /* v0.4.8：势力宣战面板（对所有剧本可用） */
  .hoi-fac-row { display:flex; align-items:center; gap:10px; flex-wrap:wrap;
    padding:10px 12px; margin:6px 0; background:#16202b; border:1px solid #2a3645; border-radius:10px; }
  .hoi-fac-info { flex:1 1 240px; min-width:0; }
  .hoi-fac-name { font-size:14px; font-weight:700; color:#e8eef2; }
  .hoi-fac-meta { font-size:12px; margin-top:2px; }
  .hoi-fac-desc { font-size:11px; margin-top:3px; line-height:1.6; opacity:.75; }
  @media (max-width:560px) {
    .hoi-fac-row { padding:10px; }
    .hoi-fac-info { flex:1 1 100%; }
    .hoi-fac-row .army-go { width:100%; min-height:44px; }   /* 移动端点击区 ≥44px */
  }
`;


// ============================================================================
// v0.4.1：行星战区地图 —— 把抽象战线变成一张能推进的地图
// ============================================================================
const TERRAIN_CN = {
  regolith: '月壤平原', crater: '环形山', canyon: '深峡谷',
  dust: '尘暴区', lava: '熔岩地', ice: '冰盖', dome: '殖民地穹顶',
};
const TERRAIN_GRAV = {
  regolith: 0.66, crater: 0.90, canyon: 0.95,
  dust: 0.90, lava: 1.04, ice: 0.97, dome: 1.00,
};
const STRUCT_SYM = { orbital: 'O', depot: 'D', colony: 'C', mine: 'M', dome: 'Q' };

/**
 * 势力宣战面板（v0.4.8）—— 非 1936 剧本下让玩家能主动对地图上的敌对势力开战。
 *
 * 为什么需要
 *   战区地图原本只在「有战争」时出现，而宣战入口又只在 1936 剧本的星系页
 *   （依赖历史节点门禁）。结果非 1936 存档打开战区页既看不到地图、也无法开战 ——
 *   地图成了纯装饰。这里补上「看到势力 → 点它 → 宣战」的闭环。
 *
 * 复用 core/war.js#declareWar（该模块本就是剧本无关的），
 * 不传 histGate —— 意味着非 1936 剧本没有历史节点限制，可自由开战。
 */
function buildFactionWarBoard(acc, refresh) {
  const wrap = el('div', 'hoi-sec');
  const t = ensureTheater(acc);
  wrap.appendChild(el('div', 'hoi-sec-h', [
    el('span', null, '敌对势力'),
    el('span', { class: 'hoi-sub', text: '选择一个势力宣战，战役胜利即可占领其战区' }),
  ]));
  if (!t || !Array.isArray(t.regions)) return wrap;

  // 汇总地图上的全部敌方势力（按战区数排序，多的排前面）
  const byOwner = new Map();
  for (const r of t.regions) {
    if (!r.owner || r.owner === t.myNation) continue;
    if (!byOwner.has(r.owner)) byOwner.set(r.owner, []);
    byOwner.get(r.owner).push(r);
  }
  if (!byOwner.size) {
    wrap.appendChild(el('div', 'hoi-note', '地图上暂无其他势力 —— 全部战区都已并入我方版图。'));
    return wrap;
  }

  const list = Array.from(byOwner.entries())
    .sort((a, b) => b[1].length - a[1].length);

  for (const [owner, regs] of list) {
    const atWar = !!warWith(acc, owner);
    const name = factionNameCn(owner, HOI_BY_ID);
    const flag = factionFlag(owner, HOI_BY_ID);
    const pw = factionPower(owner, HOI_BY_ID);
    const colonies = regs.filter((r) => r.structure === 'colony').length;
    const domes = regs.filter((r) => r.structure === 'dome').length;

    const row = el('div', 'hoi-fac-row');
    const info = el('div', 'hoi-fac-info');
    const nm = (flag ? flag + ' ' : '') + name + (atWar ? '（交战中）' : '');
    info.appendChild(el('div', { class: 'hoi-fac-name', text: nm }));
    const detailBits = [regs.length + ' 处战区'];
    if (colonies) detailBits.push('殖民地 ' + colonies);
    if (domes) detailBits.push('穹顶 ' + domes);
    detailBits.push('实力 ≈ 师 ' + pw.divisions + ' / 工业 ' + pw.ic);
    info.appendChild(el('div', { class: 'hoi-fac-meta muted', text: detailBits.join(' · ') }));
    const desc = factionDesc(owner, HOI_BY_ID);
    if (desc) info.appendChild(el('div', { class: 'hoi-fac-desc muted', text: desc }));
    row.appendChild(info);

    const btn = el('button', 'army-go btn btn-sm' + (atWar ? '' : ' btn-primary'),
      atWar ? '查看战场' : '宣战');
    if (!atWar) {
      btn.onclick = () => {
        const r = declareWar(acc, { id: owner, nameCn: name, kind: 'npc' });
        if (r && r.ok) {
          if (typeof refresh === 'function') refresh();
        } else {
          alert((r && r.reason) || '宣战失败');
        }
      };
    } else {
      btn.onclick = () => { if (typeof refresh === 'function') refresh(); };
    }
    row.appendChild(btn);
    wrap.appendChild(row);
  }
  return wrap;
}

/** 行星战区地图（网格 + 选中详情 + 进攻/打击按钮） */
function buildTheaterMap(acc, war, refresh) {
  const wrap = el('div', 'hoi-map-wrap');
  const v = theaterView(acc);
  if (!v) return wrap;

  const head = el('div', 'hoi-map-head');
  head.appendChild(el('span', { class: 'hoi-map-title', text: '行星战区图 ' + v.cols + '×' + v.rows }));
  const inc = v.colonyIncome;
  // v0.4.2：把**真实产出**也摆出来（每秒注入物品栏的物资），让玩家看懂地图为何值钱。
  //   按「每分钟」显示 —— 直接显示每秒会是 0.00x 这种没信息量的数字。
  let ytxt = '';
  try {
    const y = regionYieldOf(acc);
    if (y && Object.keys(y).length) {
      ytxt = '　产出/分 ' + Object.keys(y).slice(0, 5)
        .map((m) => m + ' +' + (Math.round((y[m] || 0) * 60 * 100) / 100)).join('　');
    }
  } catch (e) { /* 忽略 */ }
  head.appendChild(el('span', { class: 'hoi-sub',
    text: '殖民地 ' + inc.count + ' 处（' + inc.popM + ' 百万人口'
      + (inc.lostPopM ? '，已失 ' + inc.lostPopM + ' 百万' : '') + '）'
      + '　补给网络覆盖 ' + v.reach + ' 战区'
      + '　轨道打击 ' + v.strikes + '/' + v.strikeMax
      + (ytxt ? '\n' + ytxt : '') }));
  head.lastChild.style.whiteSpace = 'pre-line';
  wrap.appendChild(head);

  // v0.4.3：殖民地人口反哺本土（研究点 + 人口增长加成）
  try {
    const sup = colonySupportOf(acc);
    if (sup && sup.popM > 0) {
      const sb = el('div', 'hoi-colony-support');
      sb.appendChild(el('span', null,
        '殖民地人口反哺：研究点 +' + (Math.round(sup.researchPerSec * 100) / 100) + '/秒'
        + '　本土人口增长 +' + Math.round(sup.popGrowthBonus * 10000) / 100 + '%'));
      wrap.appendChild(sb);
    }
  } catch (e) { /* 忽略 */ }

  // ---- 网格 ----
  const grid = el('div', 'hoi-map');
  grid.style.gridTemplateColumns = 'repeat(' + v.cols + ', minmax(0,1fr))';
  const ctrl = orbitalControlOf(acc, war && war.targetId);
  for (const r of v.regions) {
    const cell = el('button', 'hoi-cell');
    cell.type = 'button';
    cell.className = 'hoi-cell'
      + (r.isMine ? ' mine' : (r.owner ? ' foe' : ' neutral'))
      + (_mapSel.regionId === r.id ? ' sel' : '')
      + (r.battleId ? ' fighting' : '')
      + (r.structure === 'colony' ? ' has-colony' : '');
    cell.appendChild(el('span', { class: 'sym', text: STRUCT_SYM[r.structure] || '·' }));
    cell.appendChild(el('span', { class: 'nm', text: r.nameCn || r.id }));
    cell.appendChild(el('span', { class: 'terr', text: TERRAIN_CN[r.terrain] || r.terrain }));
    const tags = [];
    if (r.isMine && !r.connected) tags.push('断供');
    if (r.strikePressure > 0.25) tags.push('被打击');
    if (r.battleId) tags.push('交战中');
    if (r.structure === 'colony') tags.push(r.popM + 'M');
    if (tags.length) cell.appendChild(el('span', { class: 'tags', text: tags.join('·') }));
    cell.title = (r.nameCn || r.id) + '｜' + (TERRAIN_CN[r.terrain] || r.terrain)
      + '（' + (TERRAIN_GRAV[r.terrain] || 1).toFixed(2) + 'g）'
      + '｜属主：' + (r.owner ? (factionNameCn(r.owner, HOI_BY_ID)) : '中立')
      + (r.structureCn ? '｜' + r.structureCn : '')
      + '｜驻防 ' + Math.round(r.garrison * 100) + '%'
      + '｜补给 ' + Math.round(r.supply * 100) + '%';
    cell.addEventListener('click', () => {
      _mapSel.regionId = (_mapSel.regionId === r.id ? null : r.id);
      refresh && refresh();
    });
    grid.appendChild(cell);
  }
  wrap.appendChild(grid);

  // ---- 补给线可视化（v0.4.2）：SVG 覆盖层，画出「补给从哪来」----
  //   断供时能一眼看出断在哪一环 —— 这是地图层最需要被看见的信息。
  try {
    const links = supplyLinksOf(acc);
    if (links && links.length) {
      const NS = 'http://www.w3.org/2000/svg';
      const svg = document.createElementNS(NS, 'svg');
      svg.setAttribute('class', 'hoi-map-links');
      svg.setAttribute('viewBox', '0 0 ' + v.cols + ' ' + v.rows);
      svg.setAttribute('preserveAspectRatio', 'none');
      for (const l of links) {
        const ln = document.createElementNS(NS, 'line');
        ln.setAttribute('x1', String(l.from.x + 0.5));
        ln.setAttribute('y1', String(l.from.y + 0.5));
        ln.setAttribute('x2', String(l.to.x + 0.5));
        ln.setAttribute('y2', String(l.to.y + 0.5));
        ln.setAttribute('vector-effect', 'non-scaling-stroke');
        svg.appendChild(ln);
      }
      wrap.appendChild(svg);
    }
  } catch (e) { /* 可视化失败不影响地图本体 */ }

  // ---- 图例 ----
  const legend = el('div', 'hoi-map-legend');
  legend.appendChild(el('span', { class: 'lg mine', text: '我方' }));
  legend.appendChild(el('span', { class: 'lg foe', text: '敌方' }));
  legend.appendChild(el('span', { class: 'lg neutral', text: '中立' }));
  legend.appendChild(el('span', { class: 'lg link', text: '补给线' }));
  legend.appendChild(el('span', { class: 'lg cut', text: '断供' }));
  legend.appendChild(el('span', { class: 'lg struct', text: 'O投送点 D补给 C殖民地 M矿场 Q穹顶' }));
  wrap.appendChild(legend);

  // ---- v0.4.3：多路战线规划 ----
  wrap.appendChild(buildPlanBar(acc, war, refresh));

  // ---- 选中战区详情 + 操作 ----
  if (_mapSel.regionId) {
    const r = v.regions.find((x) => x.id === _mapSel.regionId);
    if (r) wrap.appendChild(buildRegionPanel(acc, war, r, ctrl, refresh));
  } else {
    wrap.appendChild(el('div', 'hoi-note',
      '点击战区查看详情：从**相邻战区**发动进攻，或对敌方战区实施**战略轨道打击**。'
      + '补给只在我方连片战区内流通（青色补给线）—— 没被覆盖的战区会挨饿，'
      + '所以推进要「打穿走廊」。'
      + '同一战区可从**多个方向**同时进攻形成**夹击**；殖民地穹顶需先打满**围城进度**才能占领。'));
  }
  return wrap;
}

/** v0.4.3：多路战线规划条 —— 一次规划、同时开辟多条战线 */
function buildPlanBar(acc, war, refresh) {
  const bar = el('div', 'hoi-plan');
  if (!war || war.status !== 'active') return bar;
  const busy = (acc.battles || []).filter((b) => b && b.status === 'active').length;
  const room = Math.max(0, BATTLE_MAX_PER_WAR - busy);

  const modeBtn = el('button', 'hoi-mini-btn' + (_mapSel.mode === 'plan' ? ' on' : ''),
    _mapSel.mode === 'plan' ? '规划模式：开（点目标加入队列）' : '规划模式：关');
  modeBtn.title = '开启后，点相邻目标只会加入规划队列，可一次开辟多条战线形成夹击';
  modeBtn.addEventListener('click', () => {
    _mapSel.mode = (_mapSel.mode === 'plan' ? 'single' : 'plan');
    refresh && refresh();
  });
  bar.appendChild(modeBtn);

  bar.appendChild(el('span', 'hoi-note',
    '进行中 ' + busy + '/' + BATTLE_MAX_PER_WAR + '　规划中 ' + _mapSel.plan.length + ' 条'));

  for (let i = 0; i < _mapSel.plan.length; i++) {
    const p = _mapSel.plan[i];
    const t = ensureTheater(acc);
    const tg = (t.regions || []).find((r) => r.id === p.regionId);
    const og = (t.regions || []).find((r) => r.id === p.originId);
    if (!tg) { _mapSel.plan.splice(i, 1); i--; continue; }
    const item = el('span', 'hoi-plan-item', (og ? og.nameCn : '?') + ' → ' + tg.nameCn);
    const del = el('button', 'hoi-mini-btn x', '×');
    del.addEventListener('click', () => {
      const k = _mapSel.plan.findIndex((q) => q.regionId === p.regionId && q.originId === p.originId);
      if (k >= 0) _mapSel.plan.splice(k, 1);
      refresh && refresh();
    });
    item.appendChild(del);
    bar.appendChild(item);
  }

  if (_mapSel.plan.length) {
    const go = el('button', 'btn btn-primary hoi-go',
      '同时开战（' + Math.min(_mapSel.plan.length, room || _mapSel.plan.length) + ' 条）');
    if (!room) { go.disabled = true; go.title = '同时进行的战线已满'; }
    go.addEventListener('click', () => {
      const msgs = [];
      let n = 0;
      for (const p of _mapSel.plan.slice()) {
        const b = (acc.battles || []).filter((x) => x && x.status === 'active').length;
        if (b >= BATTLE_MAX_PER_WAR) { msgs.push('战线数已达上限'); break; }
        const busyIds = (acc.battles || []).filter((x) => x && x.status === 'active')
          .flatMap((x) => (x.mine || []).map((d) => d.armyId));
        const avail = (committableArmies(acc, war.id) || []).filter((a) => busyIds.indexOf(a.id) < 0);
        if (!avail.length) { msgs.push('没有可用师了'); break; }
        const r = startBattle(acc, war, {
          regionId: p.regionId, originId: p.originId,
          armyIds: avail.slice(0, BATTLE_COMBAT_WIDTH + 1).map((a) => a.id),
        });
        if (r.ok) n++;
        else msgs.push(r.reason || '开战失败');
      }
      _mapSel.plan = [];
      if (msgs.length) alert('已开辟 ' + n + ' 条战线：\n' + msgs.join('\n'));
      refresh && refresh();
    });
    bar.appendChild(go);
    const clr = el('button', 'hoi-mini-btn', '清空规划');
    clr.addEventListener('click', () => { _mapSel.plan = []; refresh && refresh(); });
    bar.appendChild(clr);
  }
  return bar;
}

/** 选中战区的详情与操作 */
function buildRegionPanel(acc, war, r, ctrl, refresh) {
  const t = ensureTheater(acc);
  const raw = (t.regions || []).find((x) => x.id === r.id);
  const box = el('div', 'hoi-region');
  const ownerNation = r.owner ? (factionNameCn(r.owner, HOI_BY_ID)) : '中立';
  const meta = el('div', 'hoi-region-head');
  meta.appendChild(el('span', { class: 'nm', text: r.nameCn || r.id }));
  meta.appendChild(el('span', { class: 'hoi-sub',
    text: (TERRAIN_CN[r.terrain] || r.terrain) + '（' + (TERRAIN_GRAV[r.terrain] || 1).toFixed(2) + 'g）'
      + '　属主：' + ownerNation
      + (r.structureCn ? '　' + r.structureCn : '')
      + (r.structure === 'colony' ? '（' + r.popM + ' 百万）' : '')
      + '　驻防 ' + Math.round(r.garrison * 100) + '%'
      + '　补给 ' + Math.round(r.supply * 100) + '%'
      + (r.connected ? '' : '　断供')
      + (r.strikePressure > 0.2 ? '　防线瘫 ' + Math.round(r.strikePressure * 100) + '%' : '') }));
  box.appendChild(meta);
  const st = r.structure && REGION_STRUCTURES[r.structure];
  if (st) box.appendChild(el('div', { class: 'hoi-note', text: st.desc }));

  const row = el('div', 'hoi-region-acts');
  const view = theaterView(acc);
  const fi = raw ? THfrontInfo(acc, raw.id) : null;

  // ---- 从我方战区向相邻目标进攻（v0.4.2：声明来源，支持多方向夹击）----
  if (raw && r.isMine && war && war.status === 'active') {
    const busy = (acc.battles || []).filter((b) => b && b.status === 'active')
      .flatMap((b) => (b.mine || []).map((d) => d.armyId));
    const avail = (committableArmies(acc, war.id) || []).filter((a) => busy.indexOf(a.id) < 0);
    const targets = [];
    try { for (const x of attackTargetsOf(acc, raw)) if (x && x.id) targets.push(x); } catch (e) { /* 忽略 */ }
    if (targets.length) {
      row.appendChild(el('span', 'hoi-note', '由此进攻（多路同时打可形成夹击）：'));
      for (const tg of targets) {
        const tName = tg.owner ? (factionNameCn(tg.owner, HOI_BY_ID)) : '中立';
        const tf = THfrontInfo(acc, tg.id);
        const inPlan = _mapSel.plan.some((q) => q.regionId === tg.id && q.originId === raw.id);
        const btn = el('button', 'hoi-mini-btn'
          + (tg.owner ? '' : ' neutral')
          + (inPlan ? ' on' : '')
          + (tf && tf.directions >= 2 ? ' flank' : ''),
          (inPlan ? '✓ ' : '') + (tg.nameCn || tg.id) + '·' + tName
          + (tg.owner ? ' 驻防' + Math.round((tg.garrison || 0) * 100) + '%' : '')
          + (tg.structure === 'colony' ? ' ★殖民地' : '')
          + (tg.structure === 'dome' ? ' 需围城' : '')
          + (tf && tf.fronts ? ' 前线' + tf.fronts : '')
          + (tf && tf.directions >= 2 ? ' 夹击+' + Math.round(tf.flank * 100) + '%' : ''));
        btn.disabled = !(avail.length) || !THcanFront(acc, tg.id);
        const why = !avail.length ? '没有可用师（都在其他战线或兵员已耗尽）'
          : !THcanFront(acc, tg.id) ? '该战区战线已满'
          : (tf && tf.directions >= 2 ? '已形成夹击：防御削弱 ' + Math.round(tf.flank * 100) + '%' : '开战');
        btn.title = why;
        btn.addEventListener('click', () => {
          // 规划模式：只入队，不立即开战
          if (_mapSel.mode === 'plan') {
            const k = _mapSel.plan.findIndex((q) => q.regionId === tg.id && q.originId === raw.id);
            if (k >= 0) _mapSel.plan.splice(k, 1);
            else _mapSel.plan.push({ regionId: tg.id, originId: raw.id });
            refresh && refresh();
            return;
          }
          const pick = avail.slice(0, BATTLE_COMBAT_WIDTH + 1).map((a) => a.id);
          const r2 = startBattle(acc, war, { regionId: tg.id, originId: raw.id, armyIds: pick });
          if (!r2.ok) { alert(r2.reason); return; }
          _mapSel.regionId = tg.id;
          refresh && refresh();
        });
        row.appendChild(btn);
      }
    } else {
      row.appendChild(el('span', 'hoi-note', '周边没有可进攻目标。'));
    }
  }

  // ---- 选中的是敌方战区：显示前线态势与围城进度 ----
  if (!r.isMine && fi) {
    row.appendChild(el('span', { class: 'hoi-note',
      text: '前线 ' + fi.fronts + '/' + TH_MAX_FRONTS + ' 条　来源方向 ' + fi.directions
        + (fi.flank > 0 ? '　**夹击加成 +' + Math.round(fi.flank * 100) + '% 防御削弱**' : '')
        + (raw && raw.structure === 'dome' ? '　围城 ' + Math.round(((Number(raw.siege) || 0) / TH_SIEGE) * 100) + '%' : '') }));
  }

  // ---- 战略轨道打击（跨战区）----
  if (!r.isMine) {
    const gate = canStrikeRegion(acc, raw, ctrl);
    const btn = el('button', 'hoi-mini-btn danger',
      '轨道打击（余 ' + (view ? view.strikes : 0) + '）');
    btn.disabled = !gate.ok;
    btn.title = gate.ok ? '从轨道瘫痪该战区守军，使其更易被地面突袭' : gate.reason;
    btn.addEventListener('click', () => {
      const res = strikeRegion(acc, raw, ctrl);
      if (!res.ok) { alert(res.reason); return; }
      alert(res.desc);
      refresh && refresh();
    });
    row.appendChild(btn);
    if (!gate.ok) row.appendChild(el('span', { class: 'hoi-note', text: gate.reason }));
  }
  box.appendChild(row);
  return box;
}

// ============================================================================
// v0.3.4：战线面板 —— 把「只有一根进度条」换成看得见的师级交战
// ============================================================================

/** 一条细进度条（组织度 / 兵力 / 工事 / 突破 共用） */
function miniBar(ratio, color, cls) {
  const b = el('div', 'hoi-mini' + (cls ? ' ' + cls : ''));
  const pct = Math.max(0, Math.min(100, (Number(ratio) || 0) * 100));
  b.appendChild(el('i', { style: 'width:' + pct + '%;background:' + color }));
  return b;
}

/** 一个师的一行：名称 / 状态 / 组织度 / 兵力 */
function divisionRow(d, onRetreat) {
  const row = el('div', 'hoi-div' + (d.isMine ? '' : ' foe'));
  const top = el('div', 'hoi-div-top');
  top.appendChild(el('span', { class: 'nm', text: d.nameCn }));
  top.appendChild(el('span', { class: 'st s-' + d.state, text: d.stateCn }));
  row.appendChild(top);
  const bars = el('div', 'hoi-div-bars');
  const orgWrap = el('div', 'w');
  orgWrap.appendChild(el('span', { class: 'lb', text: '组织' }));
  orgWrap.appendChild(miniBar(d.org / (d.orgMax || 100), d.org > 50 ? '#7cd7ff' : (d.org > 0 ? '#f0c76b' : '#f09595')));
  bars.appendChild(orgWrap);
  const strWrap = el('div', 'w');
  strWrap.appendChild(el('span', { class: 'lb', text: '兵力' }));
  strWrap.appendChild(miniBar(d.strRatio, d.strRatio > 0.6 ? '#9FE1CB' : (d.strRatio > 0 ? '#f0c76b' : '#f09595')));
  bars.appendChild(strWrap);
  // v0.3.5：装备率（后勤）—— 补给断了它就掉，掉光战斗力腰斩
  const eqWrap = el('div', 'w');
  eqWrap.appendChild(el('span', { class: 'lb', text: '装备' }));
  eqWrap.appendChild(miniBar(d.equip / 100, d.equip > 60 ? '#9FE1CB' : (d.equip > 30 ? '#f0c76b' : '#f09595')));
  bars.appendChild(eqWrap);
  row.appendChild(bars);
  // 六项 HOI4 属性：软攻 / 硬攻 / 突破 / 防御 / 装甲 / 穿甲
  row.appendChild(el('div', { class: 'hoi-div-meta',
    text: '软' + d.softAtk + ' 硬' + d.hardAtk + ' 突' + d.breakthrough + ' 防' + d.defense
      + ' · 装甲' + Math.round(d.armor * 100) + '% 穿' + Math.round(d.pierce * 100) + '%'
      + ' · 经' + d.xp }));
  row.appendChild(el('div', { class: 'hoi-div-kind', text: d.kindCn }));
  // 撤退令（HOI4 的撤退命令）：只在我方、且仍接战时给
  if (d.isMine && d.armyId && d.state !== 'done' && onRetreat) {
    const rb = el('button', 'hoi-mini-btn', '撤出');
    rb.addEventListener('click', onRetreat);
    row.appendChild(rb);
  }
  return row;
}

/** 一个战场的卡片 */
function battleCard(acc, b, refresh) {
  const v = battleView(acc, b.id);
  const card = el('div', 'hoi-battle');

  const top = el('div', 'hoi-battle-top');
  top.appendChild(el('span', { class: 'hoi-battle-title',
    text: (v.attackerCn || '交战') + ' · ' + v.terrainCn }));
  top.appendChild(el('span', { class: 'hoi-sub',
    text: '交战 ' + v.hours + '/' + v.maxHours + ' 小时 · 接战 ' + v.mineEngaged + ' vs ' + v.foeEngaged
      + '（战斗宽度 ' + v.width + '）' }));
  card.appendChild(top);

  if (v.warning) card.appendChild(el('div', 'hoi-warn', v.warning));

  // 关键读数：补给 / 工事 / 突破 / 攻防
  const stats = el('div', 'hoi-battle-stats');
  function stat(k, v2, ratio, color) {
    const s = el('div', 's');
    s.appendChild(el('span', { class: 'k', text: k }));
    const val = el('span', { class: 'v', text: v2 });
    s.appendChild(val);
    if (ratio != null) s.appendChild(miniBar(ratio, color));
    return s;
  }
  stats.appendChild(stat('我方补给', Math.round(v.supply.mine * 100) + '%', v.supply.mine,
    v.supply.mine > 0.6 ? '#9FE1CB' : '#f0c76b'));
  stats.appendChild(stat('敌方补给', Math.round(v.supply.foe * 100) + '%', v.supply.foe,
    v.supply.foe > 0.6 ? '#f09595' : '#7cd7ff'));
  // v0.3.5：制海权 → 补给上限（v0.4.0 起叫「轨道控制」，且受空间舰队实力影响）
  stats.appendChild(stat('轨道控制（补给上限）', Math.round((v.orbitalControl == null ? 0.5 : v.orbitalControl) * 100) + '%',
    v.orbitalControl, v.orbitalControl > 0.6 ? '#7cd7ff' : '#f0c76b'));
  // v0.4.0：轨道轰炸余弹（ORBITAL_BOMB_CHARGES 是本模块顶部直接 import 的绑定，不是 B.* ）
  stats.appendChild(stat('轨道轰炸弹', (v.orbital ? v.orbital.charges : 0) + ' / ' + ORBITAL_BOMB_CHARGES
    + (v.orbital && v.orbital.used ? '（已用 ' + v.orbital.used + '）' : ''),
    v.orbital ? v.orbital.charges / ORBITAL_BOMB_CHARGES : 0, '#f09595'));
  // v0.4.0：低重力 —— 太空独有的战术维度
  stats.appendChild(stat('重力', (v.gravity == null ? 1 : v.gravity).toFixed(2) + ' g'
    + (v.gravity < 0.9 ? '（利攻）' : (v.gravity > 1.01 ? '（利守）' : '')),
    v.gravity == null ? 1 : v.gravity, '#9FE1CB'));
  // v0.4.0：轨道火力 / 无人机群（读 airforce 字段，但不再是二战飞机）
  stats.appendChild(stat('轨道火力 我/敌', (v.air ? v.air.mineAir : 0) + ' / ' + (v.air ? v.air.foeAir : 0),
    v.air ? v.air.supMine : 0.5, v.air && v.air.supMine > 0.5 ? '#9FE1CB' : '#f0c76b'));
  stats.appendChild(stat('近距支援 我/敌',
    '×' + (v.air ? v.air.casMine.toFixed(2) : '1.00') + ' / ×' + (v.air ? v.air.casFoe.toFixed(2) : '1.00'),
    null, '#7cd7ff'));
  stats.appendChild(stat('我方工事', Math.round(v.entrench.mine * 100) + '%', v.entrench.mine, '#7cd7ff'));
  stats.appendChild(stat('敌方工事', Math.round(v.entrench.foe * 100) + '%', v.entrench.foe, '#f09595'));
  stats.appendChild(stat('突破', Math.round((v.breakthrough.mine || 0) * 100) + '%', v.breakthrough.mine, '#9FE1CB'));
  stats.appendChild(stat('压制', Math.round((v.breakthrough.foe || 0) * 100) + '%', v.breakthrough.foe, '#f09595'));
  stats.appendChild(stat('本时辰攻/防读数', (v.lastPower.atk || 0) + ' / ' + (v.lastPower.def || 0), null, '#7cd7ff'));
  card.appendChild(stats);

  // 双方师列表
  const cols = el('div', 'hoi-battle-cols');
  const mineBox = el('div', 'col mine');
  mineBox.appendChild(el('div', { class: 'ch', text: '我方 ' + v.mine.length + ' 个师' }));
  for (const d of v.mine) {
    mineBox.appendChild(divisionRow(d, () => {
      const r = orderRetreat(acc, v.id, d.armyId);
      if (r && !r.ok) alert(r.reason);
      refresh && refresh();
    }));
  }
  const foeBox = el('div', 'col foe');
  foeBox.appendChild(el('div', { class: 'ch', text: '敌方 ' + v.foe.length + ' 个师' }));
  for (const d of v.foe) foeBox.appendChild(divisionRow(d, null));
  cols.appendChild(mineBox);
  cols.appendChild(foeBox);
  card.appendChild(cols);

  // v0.4.5（需求 2）：指挥官指派 —— 让「谁来指挥这条战线」成为一个真实决策
  if (v.status === 'active') {
    const cmdBox = el('div', 'hoi-cmd-box');
    const cur = v.commander;
    cmdBox.appendChild(el('div', { class: 'ch', text: '指挥官' }));
    if (cur) {
      const ce = v.commanderEffect || {};
      const tags = [];
      if (ce.atkMul && ce.atkMul !== 1) tags.push('攻 ×' + ce.atkMul.toFixed(2));
      if (ce.entrenchMul && ce.entrenchMul !== 1) tags.push('工事 ×' + ce.entrenchMul.toFixed(2));
      if (ce.supplyMul && ce.supplyMul !== 1) tags.push('补给 ×' + ce.supplyMul.toFixed(2));
      if (ce.orgRegenMul && ce.orgRegenMul !== 1) tags.push('整补 ×' + ce.orgRegenMul.toFixed(2));
      if (ce.casualtyMul && ce.casualtyMul !== 1) tags.push('减员 ×' + ce.casualtyMul.toFixed(2));
      if (ce.xpMul && ce.xpMul !== 1) tags.push('经验 ×' + ce.xpMul.toFixed(2));
      if (ce.equipRecoverMul && ce.equipRecoverMul !== 1) tags.push('装备恢复 ×' + ce.equipRecoverMul.toFixed(2));
      cmdBox.appendChild(el('div', { class: 'hoi-cmd-cur', text:
        '★ ' + cur.nameCn + ' · ' + cur.traitName + ' · 技能 ' + (Number(cur.skill) || 1).toFixed(2) }));
      cmdBox.appendChild(el('div', { class: 'hoi-cmd-desc', text: cur.traitDesc + (tags.length ? '（生效：' + tags.join('、') + '）' : '') }));
    } else {
      cmdBox.appendChild(el('div', { class: 'hoi-cmd-desc', text: '本战线暂无指挥官 —— 没有指挥加成，组织度恢复与工事累积均为基准值。' }));
    }
    const sel = document.createElement('select');
    sel.className = 'hoi-cmd-sel';
    const blank = document.createElement('option');
    blank.value = '';
    blank.textContent = '— 不派指挥官 —';
    sel.appendChild(blank);
    for (const c of commandersOf(acc)) {
      const o = document.createElement('option');
      o.value = c.id;
      o.textContent = c.nameCn + '（' + c.traitName + ' 技能 ' + (Number(c.skill) || 1).toFixed(2) + '）';
      sel.appendChild(o);
    }
    sel.value = cur ? cur.id : '';
    sel.addEventListener('change', () => {
      const r = assignCommander(acc, battleById(acc, v.id), sel.value || null);
      if (r && !r.ok) { alert(r.reason); return; }
      refresh && refresh();
    });
    cmdBox.appendChild(sel);
    card.appendChild(cmdBox);
  }

  // v0.4.5（需求 2）：战役事件 —— 让战争「有事情发生」看得见
  if (v.events && v.events.length) {
    const evBox = el('div', 'hoi-event-box');
    evBox.appendChild(el('div', { class: 'ch', text: '战役事件' }));
    for (const E of v.events.slice(0, 5)) {
      evBox.appendChild(el('div', { class: 'li', text: '[' + (E.hours || 0) + 'h] 【' + (E.nameCn || '') + '】' + (E.text || '') }));
    }
    card.appendChild(evBox);
  }

  // 交战日志
  if (v.log && v.log.length) {
    const lg = el('div', 'hoi-battle-log');
    lg.appendChild(el('div', { class: 'ch', text: '交战记录' }));
    for (const L of v.log.slice(0, 6)) {
      lg.appendChild(el('div', { class: 'li', text: '· [' + (L.hours || 0) + 'h] ' + (L.text || '') }));
    }
    card.appendChild(lg);
  }

  // 操作：结束战线（HOI4 的「停止战斗 / 撤离」）
  const acts = el('div', 'hoi-battle-acts');
  const stopBtn = el('button', 'hoi-mini-btn danger', '全线撤出（结束本战场）');
  stopBtn.addEventListener('click', () => {
    const r = stopBattle(acc, v.id, '玩家下令全线撤出');
    if (r && !r.ok) alert(r.reason);
    refresh && refresh();
  });
  acts.appendChild(stopBtn);
  card.appendChild(acts);
  return card;
}

/**
 * v0.4.9 **战区进攻指挥 + 战争终局**（替换旧的 buildOpenLine）
 * ============================================================================
 *
 * 【为什么删掉旧的「开辟新战线」】
 *   旧版有一个独立的开打面板：挑师 + **手选地形**，调用
 *   `startBattle(acc, war, { armyIds, terrain })` —— **不传 regionId / originId**。
 *
 *   后果很严重：这场仗在地图上**不属于任何战区**，于是
 *     · `captureRegion` 永远不会执行 → 打赢也不占地、战争分数不涨；
 *     · 地形由玩家手选，绕过了战区的重力/地貌/驻防/补给网络；
 *     · 与战区地图那套「选我方战区 → 相邻目标 → 多路夹击」完全并行，
 *       两套开打入口互相冲突 —— 这正是「旧的冗余战斗系统」。
 *
 *   现在**只有一条开打路径**：必须从战区地图发起（我方战区 → 相邻目标）。
 *
 * 【本面板的职责】
 *   1. 战区进攻指挥：选出发战区 → 选目标 → **挑哪些师投入**
 *      （此前由前端硬编码 `avail.slice(0, width+1)` 自动挑，玩家完全无法选择自己的师）；
 *   2. 战争终局：和平会议 / 我方投降 —— 让「打完 → 结束战争」在同一页闭环。
 */
function buildTheaterCommand(acc, war, refresh, ctx) {
  const box = el('div', 'hoi-open');
  if (_lineSel.warId !== war.id) { _lineSel.warId = war.id; _lineSel.ids = []; _lineSel.msg = ''; _lineSel.originId = null; _lineSel.targetId = null; }

  const active = listBattles(acc, war.id).filter((b) => b.status === 'active');
  const pool = foeRemaining(acc, war.id);
  const busyIds = (acc.battles || []).filter((b) => b && b.status === 'active')
    .flatMap((b) => (b.mine || []).map((d) => d.armyId));
  const avail = (committableArmies(acc, war.id) || []).filter((a) => busyIds.indexOf(a.id) < 0);

  // ---- ① 战争终局：和平会议 / 我方投降 ----
  box.appendChild(buildWarEndRow(acc, war, refresh, ctx));

  const myScore = Number(war.myScore) || 0;
  box.appendChild(el('div', 'hoi-sub',
    '战区进攻指挥 · 战争分数 ' + myScore + ' : ' + (Number(war.theirScore) || 0)
    + '　同时接战上限 ' + BATTLE_MAX_PER_WAR + ' 个战场'
    + (pool ? '　敌方余 ' + pool.divisions + ' 师' : '')));

  if (active.length >= BATTLE_MAX_PER_WAR) {
    box.appendChild(el('div', 'hoi-warn', '同时最多 ' + BATTLE_MAX_PER_WAR + ' 个战场，先等一个分出胜负。'));
    return box;
  }
  if (pool && pool.divisions <= 0) {
    box.appendChild(el('div', 'hoi-warn', '对方已无可调之师（已被打垮）—— 现在可以召开和平会议强制签约。'));
    return box;
  }
  if (!avail.length) {
    box.appendChild(el('div', 'hoi-warn',
      '没有可用师：所有师都已投入其他战线，或兵员已耗尽（兵员会随时间自动恢复，也可在「军队」页紧急补员）。'));
    return box;
  }

  // ---- ② 选出发战区（必须是我方战区，且要有相邻目标）----
  const tv = theaterView(acc);
  const origins = (tv.regions || []).filter((r) => r.isMine);
  if (!origins.length) {
    box.appendChild(el('div', 'hoi-warn',
      '你在行星地图上**一处战区都不占**，无法发起进攻 —— 先在上面的地图上推进战线。'));
    return box;
  }
  const withTargets = origins.filter((r) => {
    try { return (attackTargetsOf(acc, rawRegionOf(acc, r.id)) || []).length > 0; }
    catch (e) { return false; }
  });
  if (!withTargets.length) {
    box.appendChild(el('div', 'hoi-warn',
      '你的 ' + origins.length + ' 处战区周边都没有可进攻的目标（相邻战区还没打到）。'));
    return box;
  }

  if (!_lineSel.originId || !withTargets.some((r) => r.id === _lineSel.originId)) {
    _lineSel.originId = withTargets[0].id;
  }
  box.appendChild(el('span', 'hoi-note', '出发战区：'));
  const oSel = document.createElement('select');
  oSel.className = 'hoi-sel';
  for (const r of withTargets) {
    const o = document.createElement('option');
    o.value = r.id;
    let cnt = 0;
    try { cnt = (attackTargetsOf(acc, rawRegionOf(acc, r.id)) || []).length; } catch (e) { cnt = 0; }
    o.textContent = r.nameCn + '（相邻目标 ' + cnt + ' 个）';
    if (r.id === _lineSel.originId) o.selected = true;
    oSel.appendChild(o);
  }
  oSel.addEventListener('change', () => {
    _lineSel.originId = oSel.value;
    _lineSel.targetId = null;
    refresh && refresh();
  });
  box.appendChild(oSel);

  // ---- ③ 选目标战区 ----
  const originRaw = rawRegionOf(acc, _lineSel.originId);
  let targets = [];
  try { targets = (attackTargetsOf(acc, originRaw) || []).filter((x) => x && x.id); }
  catch (e) { targets = []; }
  if (!_lineSel.targetId || !targets.some((t) => t.id === _lineSel.targetId)) {
    _lineSel.targetId = targets.length ? targets[0].id : null;
  }
  box.appendChild(el('span', 'hoi-note', '目标战区：'));
  const tSel = document.createElement('select');
  tSel.className = 'hoi-sel';
  for (const t of targets) {
    const o = document.createElement('option');
    o.value = t.id;
    const who = t.owner ? factionNameCn(t.owner, HOI_BY_ID) : '中立';
    const fi = THfrontInfo(acc, t.id);
    o.textContent = (t.nameCn || t.id) + '·' + who
      + ' 驻防' + Math.round((Number(t.garrison) || 0) * 100) + '%'
      + (t.structure === 'colony' ? ' ★殖民地' : '')
      + (t.structure === 'dome' ? ' 需围城' : '')
      + (fi && fi.directions >= 2 ? ' 夹击+' + Math.round(fi.flank * 100) + '%' : '');
    if (t.id === _lineSel.targetId) o.selected = true;
    tSel.appendChild(o);
  }
  tSel.addEventListener('change', () => { _lineSel.targetId = tSel.value; refresh && refresh(); });
  box.appendChild(tSel);

  // ---- ④ 挑投入的师（玩家可选，不再由前端硬编码自动挑）----
  // 地形不再手选：地形由目标战区决定（gravity / hazard / 驻防 / 补给都算在战区里）。
  const list = el('div', 'hoi-open-list');
  for (const a of avail.slice(0, 60)) {
    const lab = el('label', 'hoi-pick');
    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.checked = _lineSel.ids.indexOf(a.id) >= 0;
    cb.addEventListener('change', () => {
      const i = _lineSel.ids.indexOf(a.id);
      if (i >= 0) _lineSel.ids.splice(i, 1); else _lineSel.ids.push(a.id);
      refresh && refresh();
    });
    lab.appendChild(cb);
    lab.appendChild(el('span', { class: 'nm', text: a.nameCn }));
    lab.appendChild(el('span', { class: 'hoi-sub',
      text: '[' + a.kindCn + '] ' + a.men + '人 软' + a.softAtk + '/硬' + a.hardAtk
        + ' 防' + a.defense + ' 装' + Math.round(a.armor * 100) + '% 穿' + Math.round(a.pierce * 100) + '%'
        + (a.elite ? ' 王牌' : '') }));
    list.appendChild(lab);
  }
  box.appendChild(list);

  const row = el('div', 'hoi-open-row');
  const strength = (a) => (Number(a.softAtk) || 0) + (Number(a.hardAtk) || 0) + (Number(a.defense) || 0);
  const allBtn = el('button', 'hoi-mini-btn', '全选');
  allBtn.addEventListener('click', () => {
    _lineSel.ids = avail.slice(0, BATTLE_COMBAT_WIDTH + 2).map((a) => a.id);
    refresh && refresh();
  });
  row.appendChild(allBtn);
  const bestBtn = el('button', 'hoi-mini-btn', '选最强');
  bestBtn.addEventListener('click', () => {
    _lineSel.ids = avail.slice().sort((x, y) => strength(y) - strength(x))
      .slice(0, BATTLE_COMBAT_WIDTH + 2).map((a) => a.id);
    refresh && refresh();
  });
  row.appendChild(bestBtn);
  const noneBtn = el('button', 'hoi-mini-btn', '清空');
  noneBtn.addEventListener('click', () => { _lineSel.ids = []; refresh && refresh(); });
  row.appendChild(noneBtn);

  const targetName = _lineSel.targetId
    ? ((targets.find((t) => t.id === _lineSel.targetId) || {}).nameCn || '目标') : '无目标';
  const go = el('button', 'btn btn-primary hoi-go',
    '开辟战线（' + targetName + ' · 已选 ' + _lineSel.ids.length + ' 个师）');
  go.disabled = !_lineSel.targetId || !_lineSel.ids.length;
  go.title = !_lineSel.ids.length ? '先勾选要投入的师'
    : !_lineSel.targetId ? '先选目标战区' : '开战';
  go.addEventListener('click', () => {
    const r = startBattle(acc, war, {
      regionId: _lineSel.targetId, originId: _lineSel.originId,
      armyIds: _lineSel.ids.slice(),
    });
    if (!r.ok) { alert(r.reason || '无法开辟战线'); return; }
    _lineSel.ids = [];
    _lineSel.targetId = null;
    refresh && refresh();
  });
  row.appendChild(go);
  box.appendChild(row);

  box.appendChild(el('div', 'hoi-note',
    'v0.4.9：**只能从战区地图发起进攻** —— 此前还有一个「手选地形开打」的旧入口，'
    + '打出来的仗不属于任何战区，打赢也不占地、战争分数也不涨，已删除。'
    + '地形由目标战区决定：低重力利攻、殖民地穹顶难破、高危地貌会随机触发灾害。'));
  return box;
}

/** 取战区原始对象（含 owner / garrison / structure；theaterView 的视图可能已裁剪） */
function rawRegionOf(acc, regionId) {
  try { return regionById(ensureTheater(acc), regionId); } catch (e) { return null; }
}

// 敌国对象 / 名称（v0.4.9 提到模块级：战区指挥面板与战争终局行都要用）
//   非 1936 剧本的 targetId 是通用势力 id（fac_*），只查 HOI_BY_ID 会返回 null
//   → 战报与下拉栏显示「未知」，故用 factionNameCn 兜底。
function foeOf(w) {
  const id = String(w && w.targetId || '').replace(/^hoi_/, '');
  return HOI_BY_ID[id] || null;
}
function foeNameOf(w) {
  const f = foeOf(w);
  if (f) return f.nameCn;
  return factionNameCn(String(w && w.targetId || '').replace(/^hoi_/, ''), HOI_BY_ID)
    || (w && w.targetName) || '未知';
}

/**
 * v0.4.9 战争终局行：和平会议 / 我方投降。
 *   这两个操作此前**只存在于「星际页」的国家卡片上**，而战争是在本页的战区地图上打的 ——
 *   玩家打完仗回到本页找不到任何结束战争的手段。
 */
function buildWarEndRow(acc, war, refresh, ctx) {
  const row = el('div', 'hoi-warend');
  const myScore = Number(war.myScore) || 0;
  const canForce = myScore >= 60;
  row.appendChild(el('span', 'hoi-note',
    '战争终局 · 分数 ' + myScore + ' : ' + (Number(war.theirScore) || 0)
    + '　' + (canForce ? '已达迫降线（≥60），可召开和平会议' : '战争分数达到 60 才能强制签约')));

  const pc = el('button', 'btn btn-sm btn-primary', '和平会议（吞并 / 殖民 / 瓜分…）');
  pc.disabled = !canForce;
  pc.title = canForce ? '选择战后处置' : '战争分数不足 60';
  pc.addEventListener('click', () => {
    const foe = { nameCn: foeNameOf(war) };
    openPeaceConference(acc, war, foe, { ascoin: Number(acc.ascoin) || 0 },
      { openModal: (o) => (ctx && ctx.openModal ? ctx.openModal(o) : null), closeModal: null },
      () => { refresh && refresh(); });
  });
  row.appendChild(pc);

  const sur = el('button', 'btn btn-sm btn-danger', '我方投降');
  sur.title = '结束战争并按对方条件支付赔款（已打下的战区会保留）';
  sur.addEventListener('click', () => {
    const pay = Math.max(500, Math.round((Number(acc.ascoin) || 0) * 0.15));
    if (!window.confirm('确定向「' + foeNameOf(war) + '」投降？\n\n'
      + '将支付赔款 ' + fmtNum(pay) + ' Ascoin，战争立即结束。\n'
      + '战区归属不变（已打下的会保留）。')) return;
    const r = surrenderWar(acc, war.targetId, { reparations: pay },
      '我方投降并支付赔款 ' + pay);
    if (!r.ok) { alert(r.reason || '投降失败'); return; }
    alert('已向「' + foeNameOf(war) + '」投降，战争结束。');
    refresh && refresh();
  });
  row.appendChild(sur);
  return row;
}

/** 战线总面板 */
function buildBattleSection(acc, war, refresh, ctx) {
  const sec = el('div', 'hoi-battles');
  const battles = listBattles(acc, war.id);
  const active = battles.filter((b) => b.status === 'active');
  const done = battles.filter((b) => b.status !== 'active').slice(-4).reverse();
  const pool = foeRemaining(acc, war.id);

  const h = el('div', 'hoi-battle-h');
  h.appendChild(el('span', null, '战线 · 师级交战'));
  h.appendChild(el('span', { class: 'hoi-sub',
    text: '进行中 ' + active.length + '/' + BATTLE_MAX_PER_WAR
      + (pool ? '　敌方余 ' + pool.divisions + ' 个师（累计击溃 ' + pool.killed + '）' : '') }));
  sec.appendChild(h);

  if (!active.length) {
    sec.appendChild(el('div', 'hoi-note',
      '尚未开辟战线。选好师与地形后点「开辟战线」，或等待敌方主动进攻。'));
  }
  for (const b of active) sec.appendChild(battleCard(acc, b, refresh));

  sec.appendChild(buildTheaterCommand(acc, war, refresh, ctx));

  if (done.length) {
    const dh = el('div', 'hoi-done');
    dh.appendChild(el('div', { class: 'ch', text: '近期结束的战役' }));
    for (const b of done) {
      const r = b.result || {};
      const txt = r.stalemate ? '僵持未决' : (r.attackerWin ? '胜利' : '失利');
      dh.appendChild(el('div', { class: 'li', text:
        '· ' + ((BATTLE_TERRAIN_CN(b.terrain)) || '') + '　' + txt
        + '　' + (r.hours || 0) + ' 小时　我方损失 ' + (r.lostMen || 0) + ' 人　击溃敌方 ' + (r.foeKilled || 0) + ' 师' }));
    }
    sec.appendChild(dh);
  }
  return sec;
}

// 地形中文名（buildBattleSection 结束战役列表用；避免重复 import 整个常量表）
function BATTLE_TERRAIN_CN(id) {
  const t = terrainList().find((x) => x.id === id);
  return t ? t.nameCn : '';
}

export function renderHoi(root, ctx) {
  const acc = currentAccount();
  // v0.3.4：战线操作（开辟/撤出/结束）后立刻重绘，不必等下一秒的定时器
  const refresh = () => renderHoi(root, ctx);
  root.innerHTML = '';
  if (!acc) {
    // 没有账号：清掉残留定时器即可（否则旧 timer 会继续往已重绘的 root 里写）
    if (root._hoiTimer) { clearInterval(root._hoiTimer); root._hoiTimer = null; }
    root.appendChild(el('div', { class: 'hoi-panel' },
      el('p', { class: 'hoi-note', text: '请先进入游戏。' })));
    return;
  }
  // v0.4.8：行星战区地图对**所有剧本**开放。
  //   此前这一页整个被 `acc.scenario !== HOI_SCENARIO_ID` 挡掉，只有「风暴前夜」可见 ——
  //   而行星战区地图本是通用系统（core/theater.js 与 core/war.js 都不依赖 1936）。
  //   现在：地图 / 补给 / 战区列表 / 战争进度对所有剧本显示；
  //   而**剧本专属**区块（国策树、轨道圈层、历史节点日历、1936 开局旁白）
  //   仍只在「风暴前夜」下出现。
  const isHoi = acc.scenario === HOI_SCENARIO_ID;
// v0.4.10：**国策树开放给普通模式**。
//   此前国策被 `isHoi` 挡住，但 `applySciStart`（所有模式都跑）已经给科幻势力
//   建好了 `acc.hoiFocus` 与自己的六条国策 —— 数据在、界面看不到，玩家永远点不到。
//   这正是「风暴前夜的机制没有移植到普通模式」的典型残留。
//   现在按「**该存档是否真的有国策数据**」来决定显示，而不是按剧本 id。
// 注意：国策**选项**不在 acc.hoiFocus 里（那只是 {current, done, buffs} 的进度），
  //   选项由 focusOptionsOf(acc) 按当前剧本的适配器取。所以判据要用它。
  const hasFocus = (focusOptionsOf(acc) || []).length > 0;
  // v0.4.16：样式只注入一次，挂到 document.head 上。
  //   此前是 root.appendChild(el('style', { text: CSS }))，而 renderHoi **每秒**整体
  //   重绘 —— 于是这约 1000 行 CSS 每秒被重新插入、重新解析，再被 innerHTML=''
  //   丢掉。纯浪费；副作用是整段 CSS 文本混进了面板的 textContent，
  //   任何读面板文字的地方都会读到一堆 CSS 规则。
  ensureStyle('hoi-css', CSS);
  const panel = el('div', 'hoi-panel');

  const n = nationOf(acc);
  // v0.4.8：非 1936 剧本下 nationOf 返回 null，这里给出**通用**的我方显示名，
  //   供下拉栏 / 交战双方面板使用（此前直接读 n.nameCn 会抛 TypeError）。
  const myNameCn = n ? n.nameCn : (acc.name || '我方');
  const deep = deepOf(acc) || {};
  const f = ensureFocus(acc);
  const seas = ensureSeas(acc);
  const navies = listFleets(acc);
  // v0.4.9 修：传编队对象，并**不再吞异常** —— 旧写法传 x.id 会抛
  //   「fleet.shipIds is not iterable」，又被 try/catch 吃掉，舰队战力恒显示 0。
  const navPower = navies.reduce((s, f) => s + (fleetPowerOf(acc, f) || 0), 0);

  // ---- 顶部：国情概览 ----
  // v0.4.8：拆成「通用概览」与「1936 专属」两段。
  //   剧本日历 / 国名 / 首都 / 阵营 / 编制 / 史实海军换算都依赖 1936 数据，
  //   在其他剧本下要么是 null 要么是误导（如「国内工业 —」）——
  //   所以只有 stats 里的通用项（人口 / 军队 / 战力）对所有剧本显示。
  const head = el('div', 'hoi-head');
  if (isHoi) {
    head.appendChild(el('div', 'hoi-date', scenarioDateOf(acc)));
    head.appendChild(el('div', 'hoi-sub',
      (n ? (n.flag + ' ' + n.nameCn + '（' + n.nameEn + '）') : '未知国家')
    + ' · 首都 ' + (n ? n.capital : '—')
    + ' · 阵营：' + (blocNameOf(acc) || '不结盟')
    + '　|　剧本已进行 ' + Math.floor(gameDaysOf(acc)) + ' 天'));
    if (n) {
      head.appendChild(el('div', 'hoi-sub',
        '本体编制：' + (deep.armyName || '轨道伞兵师') + '（每支 ' + ARMY_MEN_MAX + ' 人）'
        + '　|　史实海军 ' + n.navy + ' 舰 → 游戏内 ' + acc.ships.length + ' 艘 / ' + navies.length + ' 支舰队'));
    }
  } else {
    // v0.4.8：非 1936 存档给一行中性抬头（不编造国名/阵营）
    head.appendChild(el('div', 'hoi-sub',
      '行星战区 · ' + (acc.name || '指挥官')
      + '　|　战役可视化对所有剧本开放；国策与轨道圈层为「风暴前夜」专属。'));
  }
  const stats = el('div', 'hoi-stats');
  const addStat = (lbl, val) => stats.appendChild(el('div', 'hoi-stat', [
    el('div', { class: 'lbl', text: lbl }), el('div', { class: 'val', text: val }),
  ]));
  const homeInst = getPlanetInstance(acc.homePlanetCode);
  addStat('人口', fmtNum(Math.floor((homeInst.pop && homeInst.pop.total) || 0)));
  addStat('军队', listArmies(acc).length + ' 支');
  addStat('地面军战力', fmtNum(totalArmyPowerOf(acc)));
  addStat('舰队战力', fmtNum(Math.round(navPower)));
  // v0.4.8：以下四项是 1936 剧本专属（读 hoiIndustry / hoiWorkforce / hoiNavyMul），
  //   其他剧本下恒为空或显示 0，会让玩家误以为「工业为零」。
  if (isHoi) {
    addStat('国内工业', n ? String(n.ic) : '—');
    addStat('工业建筑', fmtNum(homeInst.hoiIndustry ? homeInst.hoiIndustry.buildings : 0) + ' 座');
    addStat('产线工人', fmtNum(acc.hoiWorkforce || 0));
    addStat('舰队传统', '×' + (Number(acc.hoiNavyMul) || 1).toFixed(2));
  }
  head.appendChild(stats);
  const bg = isHoi ? backgroundOf(acc) : null;   // v0.4.8：历史旁白仅 1936
  if (bg) {
    const bgBox = el('div', 'hoi-sub');
    bgBox.style.cssText = 'margin-top:8px;padding:8px 10px;background:#101820;border-radius:8px;font-size:12px;line-height:1.8;';
    bgBox.textContent = '📜 ' + bg;
    head.appendChild(bgBox);
  }
  panel.appendChild(head);

  // v0.4.10：国策树对**所有有国策数据的剧本**显示（1936 与科幻势力通用）
  if (hasFocus) {
  // ---- 国策树 ----
  const focusSec = el('div', 'hoi-sec');
  const cur = f.current;
  focusSec.appendChild(el('div', 'hoi-sec-h', [
    el('span', null, '国策'),
    el('span', { class: 'hoi-sub', text: cur ? ('推进中：' + cur.nameCn + '（' + Math.floor(cur.progressDays) + '/' + cur.needDays + ' 天）') : '空闲（可选择一项国策）' }),
  ]));
  focusSec.appendChild(el('div', 'hoi-note', '国策按游戏天数推进（1 秒 = 1 天）。三支六策，每支侧重不同：工业扩张 / 军事理论 / 外交同盟。'));
  const opts = focusOptionsOf(acc);
  const branches = ['工业', '军事', '外交'];
  for (const br of branches) {
    const wrap = el('div', 'hoi-branch');
    wrap.appendChild(el('div', 'bn', br + '线'));
    for (const o of opts.filter((x) => x.branch === br)) {
      const row = el('div', 'hoi-focus');
      const nm = el('div', 'nm');
      nm.appendChild(el('div', null, o.nameCn + '　' + o.days + ' 天'));
      nm.appendChild(el('div', 'd', o.desc || ''));
      row.appendChild(nm);
      if (o.done) {
        row.appendChild(el('span', 'tag done', '已完成'));
      } else if (cur && cur.id === o.id) {
        const bar = el('div', 'hoi-bar');
        bar.appendChild(el('i', { style: 'width:' + Math.min(100, (cur.progressDays / cur.needDays) * 100) + '%' }));
        row.appendChild(bar);
        row.appendChild(el('span', 'tag', '进行中'));
      } else if (o.locked) {
        const tag = el('span', 'tag', '锁定');
        tag.title = o.locked;
        row.appendChild(tag);
        row.appendChild(el('span', 'd', o.locked));
      } else {
        const b = el('button', cur ? '' : 'primary', cur ? '排队中' : '开始');
        if (!cur) {
          b.addEventListener('click', () => {
            const r = startFocus(acc, o.id);
            if (!r.ok) { alert(r.reason); return; }
            renderHoi(root, ctx);
          });
        } else b.disabled = true;
        row.appendChild(b);
      }
      wrap.appendChild(row);
    }
    focusSec.appendChild(wrap);
  }
  panel.appendChild(focusSec);
  }   // v0.4.10：end if (hasFocus) —— 国策树按「有没有国策数据」决定

  // ==========================================================================
  // v0.3.3：战争 —— 下拉栏选战争 + 交战双方实时状态
  // ==========================================================================
  // 需求：「1936 剧本下新增下拉栏新增战争，可以看到实时交战双方实时状态」。
  // 实现要点：
  //   · 下拉栏列出全部进行中的战争（option 文本 = 「我方 vs 敌方 · 历史事件名」）
  //   · 选中后下方并排显示双方：国旗/国名/首都、兵力、工业、战争分数、推进条
  //   · **敌方国名必须走 HOI_BY_ID 反查**：w.targetName 语义不一致 ——
  //     玩家宣战时存的是**首都**（galaxy.js: nameCn: n.capital），
  //     AI 宣战时存的才是国名。直接用 targetName 会显示成「柏林」而非「德意志国」。
  const warSec = el('div', 'hoi-sec');
  const wars = activeWarsOf(acc);
  const warTotal = Array.isArray(acc && acc.wars) ? acc.wars.length : 0;
  warSec.appendChild(el('div', 'hoi-sec-h', [
    el('span', null, '战争'),
    el('span', { class: 'hoi-sub', text: '进行中 ' + wars.length + ' 场 / 共 ' + warTotal + ' 场' }),
  ]));

  // v0.4.9：foeOf / foeNameOf 已提到**模块级**（见文件上方）——
  //   战区指挥面板与战争终局行也要用它们，这里不再定义同名局部函数（否则会自我递归）。
  // 我方「实时」战力：用玩家真实的军队与舰队，而非 1936 静态值
  function myLive() {
    const inst = getPlanetInstance(acc.homePlanetCode);
    let armyStr = 0, armyCount = 0;
    for (const a of listArmies(acc)) {
      if (!a) continue;
      armyCount++;
      try { armyStr += (a.power || 0); } catch (e) { /* 忽略单条异常 */ }
    }
    let fleetStr = 0, fleetCount = 0;
    for (const fl of listFleets(acc)) {
      if (!fl) continue;
      fleetCount += (fl.shipIds || []).length;
      fleetStr += fleetPowerOf(acc, fl) || 0;   // v0.4.9：传编队对象，不吞异常
    }
    // v0.4.8：`n` 是 1936 的国家对象，其他剧本下 nationOf(acc) 返回 **null** ——
    //   此前直接读 n.ic 会抛 TypeError（曾导致非 1936 存档宣战后整页崩）。
    const ic = inst && inst.hoiIndustry ? (Number(inst.hoiIndustry.ic) || 0)
      : (n ? (Number(n.ic) || 0) : 0);
    const pop = inst && inst.pop ? (Number(inst.pop.total) || 0) : 0;
    return { armyStr, armyCount, fleetStr, fleetCount, ic, pop, inst };
  }

  if (!wars.length && !isHoi) {
    // v0.4.8：非 1936 剧本无战争时 —— 仍然**显示战区地图**，并给出可直接开战的势力列表。
    //   此前这一段只对 1936 有内容（历史节点提示），而战区地图又只嵌在
    //   「有战争」的下拉栏里 → 其他剧本打开本页只能看到一句「当前无战争」。
    //   现在：地图常驻 + 点势力即可宣战，战争系统对所有剧本可用。
    warSec.appendChild(el('div', 'hoi-note',
      '当前无战争。行星战区上的敌对势力都可以主动宣战 —— 打赢战役即可逐步占领其战区。'));
    warSec.appendChild(buildTheaterMap(acc, null, refresh));
    warSec.appendChild(buildFactionWarBoard(acc, refresh));
  } else if (!wars.length) {
    // 无战争：给出下一个历史节点提示，让玩家知道「什么时候能开战」
    const today = Math.floor(gameDaysOf(acc));
    const upcoming = HIST_TIMELINE
      .filter((e) => e.kind === 'war' && e.actors.indexOf(acc.nation) >= 0 && e.day > today)
      .sort((a, b) => a.day - b.day)[0];
    warSec.appendChild(el('div', 'hoi-note',
      '当前无战争。按历史时间表，下一个与本国有交战的节点为：'
      + (upcoming
        ? '【' + upcoming.nameCn + '】' + upcoming.dateCn + '（还有 ' + Math.ceil(upcoming.day - today) + ' 游戏天）'
        : '剧本时间表内已无本国的战争节点')
      + '。未到历史节点时无法宣战 —— 战争按史实推进。'));
    // 历史节点一览（近 8 个）
    const near = HIST_TIMELINE
      .filter((e) => e.kind === 'war')
      .slice(0, 8);
    if (near.length) {
      const chips = el('div', 'hoi-war-ongoing');
      for (const e of near) {
        const done = today >= e.day;
        const c = el('span', { class: 'hoi-war-chip' + (done ? ' hot' : ''), text: e.dateCn + ' ' + e.nameCn });
        chips.appendChild(c);
      }
      warSec.appendChild(chips);
    }
  } else {
    // ---- 下拉栏 ----
    const selRow = el('div', 'hoi-branch');
    const warSel = document.createElement('select');
    warSel.className = 'hoi-war-sel';
    for (const w of wars) {
      const foe = foeOf(w);
      const foeName = foeNameOf(w);
      const evName = w.histKey ? ('（' + (HIST_TIMELINE.find((e) => String(e.day) === String(w.histKey).split(':')[0]) || {}).nameCn + '）') : '';
      const o = document.createElement('option');
      o.value = w.id;
      o.textContent = myNameCn + ' vs ' + foeName + evName;
      warSel.appendChild(o);
    }
    selRow.appendChild(el('span', 'hoi-note', '选择战争：'));
    selRow.appendChild(warSel);
    warSec.appendChild(selRow);

    // ---- 双方实时状态（随下拉栏切换局部重绘）----
    const body = el('div', 'hoi-war-row');
    warSec.appendChild(body);

    function paintWar() {
      body.innerHTML = '';
      const w = wars.find((x) => x.id === warSel.value) || wars[0];
      if (!w) return;
      const foe = foeOf(w);
      const foeName = foeNameOf(w);
      const my = myLive();
      const days = Math.max(0, Math.round((Date.now() - (w.startedAt || Date.now())) / 86400000 * 10) / 10);

      function side(who, flag, capital, vals) {
        const box = el('div', 'hoi-war-side');
        const head = el('div', 'who');
        if (flag) head.appendChild(el('span', { class: 'fl', text: flag }));
        head.appendChild(el('span', null, who));
        if (capital) head.appendChild(el('span', { class: 'hoi-note', text: '· ' + capital }));
        box.appendChild(head);
        for (const [k, v] of vals) {
          const r = el('div', 'kv');
          r.appendChild(el('span', { class: 'k', text: k }));
          r.appendChild(el('span', { class: 'v', text: v }));
          box.appendChild(r);
        }
        return box;
      }

      const scoreTotal = (Number(w.myScore) || 0) + (Number(w.theirScore) || 0) || 1;
      const myPct = Math.round((Number(w.myScore) || 0) / scoreTotal * 100);

      body.appendChild(side(myNameCn, n ? n.flag : '🏳', n ? n.capital : '—', [
        ['地面军', my.armyCount + ' 支 · 战力 ' + fmtNum(Math.round(my.armyStr))],
        ['舰队', my.fleetCount + ' 艘 · 战力 ' + fmtNum(Math.round(my.fleetStr))],
        ['工业 / 人口', fmtNum(my.ic) + ' / ' + fmtNum(my.pop)],
        ['战争分数', String(Number(w.myScore) || 0) + '（' + myPct + '%）'],
      ]));
      body.appendChild(el('div', 'hoi-war-vs', '交战\n' + Math.round(days) + ' 天'));
      body.appendChild(side(foeName, foe ? foe.flag : '🏳', foe ? foe.capital : '', [
        // v0.3.3：敌方为 1936 基准静态值（列强数据表），非其实时发展值
        ['陆军（1936 基准）', (foe ? foe.divisions : '?') + ' 个师'],
        ['工业 / 舰队 / 轨道火力（1936 基准）',
          (foe ? foe.ic : '?') + ' / ' + (foe ? foe.navy : '?') + ' / ' + (foe ? foe.airforce : '?')],
        ['人口（1936 基准）', (foe ? foe.popM : '?') + ' 百万'],
        ['战争分数', String(Number(w.theirScore) || 0) + '（' + (100 - myPct) + '%）'],
      ]));

      // 推进条：v0.3.4 起它只是**战役胜负的结果**，不再自行滑动（见 battle.js）
      const prog = Math.max(0, Math.min(100, Number(w.progress) || 0));
      const bar = el('div', { style: 'flex:1 1 100%;' });
      bar.appendChild(el('div', { class: 'hoi-note', text: '战线推进 ' + Math.round(prog)
        + '%　（由战役胜负推动：打赢一场 +14%，打退敌方进攻仅 +3%，推进≥70% 可发动迫降）' }));
      const pb = el('div', 'hoi-bar');
      pb.appendChild(el('i', { style: 'width:' + prog + '%;background:' + (prog >= 70 ? '#9FE1CB' : '#f09595') }));
      bar.appendChild(pb);
      body.appendChild(bar);

      // ===== v0.4.1：行星战区地图（先看地图，再决定在哪开战）=====
      body.appendChild(buildTheaterMap(acc, w, refresh));
      // ===== v0.3.4：战线（真实交战）=====
      body.appendChild(buildBattleSection(acc, w, refresh, ctx));

      const logs = Array.isArray(w.log) ? w.log.slice(0, 3) : [];
      if (logs.length) {
        const lg = el('div', { style: 'flex:1 1 100%;' });
        lg.appendChild(el('div', { class: 'hoi-note', text: '最近战报：' }));
        for (const L of logs) lg.appendChild(el('div', { class: 'hoi-note', text: '· ' + (L.text || '') }));
        body.appendChild(lg);
      }
    }
    warSel.addEventListener('change', paintWar);
    paintWar();
  }
  panel.appendChild(warSec);

  // v0.4.8：轨道圈层为 1936 专属（读 hoiSeas / 敌方海军压力）
  if (isHoi) {
  // ---- 轨道圈层 ----
  const seaSec = el('div', 'hoi-sec');
  const pressure = enemySeaPressure(acc);
  seaSec.appendChild(el('div', 'hoi-sec-h', [
    el('span', null, '轨道圈层与控制权'),
    el('span', { class: 'hoi-sub', text: '敌方轨道压力 ' + fmtNum(Math.round(pressure)) + (pressure ? '' : '（当前无敌意舰队）') }),
  ]));
  seaSec.appendChild(el('div', 'hoi-note', '派空间舰队巡航以争夺轨道控制权（0~100%）。轨道战按双方舰队实力结算，失利会有舰艇损失。轨道控制直接决定地面补给上限，并解锁轨道轰炸 —— 先夺轨道、再打地面。'));
  const seaBtnRow = el('div', 'hoi-branch');
  const seaSel = document.createElement('select');
  seaSel.style.cssText = 'min-height:40px;border-radius:8px;background:#2d3e50;color:#fff;border:none;padding:0 8px;';
  if (!navies.length) {
    const o = document.createElement('option');
    o.textContent = '（尚无舰队）';
    seaSel.appendChild(o);
  }
  for (const fl of navies) {
    const o = document.createElement('option');
    o.value = fl.id;
    o.textContent = fl.nameCn + '（' + (fl.shipIds || []).length + ' 艘）';
    seaSel.appendChild(o);
  }
  const out = el('div', 'hoi-note');
  seaBtnRow.appendChild(el('span', 'hoi-note', '巡航舰队：'));
  seaBtnRow.appendChild(seaSel);
  seaSec.appendChild(seaBtnRow);
  for (const s of seas) {
    const row = el('div', 'hoi-sea');
    const nm = el('div', 'nm');
    nm.appendChild(el('div', null, s.nameCn));
    nm.appendChild(el('div', 'd', '基准强度 ' + s.base + (s.lastResult ? ' · 上次：' + (s.lastResult.win ? '我方主动' : '敌方主动') + '（损失 ' + s.lastResult.sunk + '）' : '')));
    nm.lastChild.style.cssText = 'font-size:11px;opacity:.65;';
    row.appendChild(nm);
    const ctl = el('div', 'ctl');
    ctl.appendChild(el('div', { class: 'hoi-note', text: '轨道控制 ' + Math.round(s.control * 100) + '%' }));
    const bar = el('div', 'hoi-bar');
    bar.appendChild(el('i', { style: 'width:' + Math.round(s.control * 100) + '%;background:' + (s.control >= 0.5 ? '#9FE1CB' : '#f09595') }));
    ctl.appendChild(bar);
    row.appendChild(ctl);
    const go = el('button', null, '巡航争夺轨道');
    go.addEventListener('click', () => {
      const fl = navies.find((x) => x.id === seaSel.value);
      if (!fl) { alert('先组建 / 选择一支舰队。'); return; }
      let pw = 0;
      pw = fleetPowerOf(acc, fl) || 0;   // v0.4.9：传编队对象，不吞异常
      // 舰队规模换算成海上战力（HOI4 风格：吨位与数量）
      const myNavyStr = (pw + (fl.shipIds || []).length * 60 + n.navy * 6) * (Number(acc.hoiNavyMul) || 1);
      const r = contestSea(acc, s.id, myNavyStr);
      if (!r.ok) { alert(r.reason); return; }
      // 失利损失舰艇：从该舰队移除船（船同时从 acc.ships 摘除）
      if (r.sunk > 0) {
        for (let i = 0; i < r.sunk; i++) {
          const sid = (fl.shipIds || []).pop();
          if (sid == null) break;
          const idx = acc.ships.findIndex((x) => x && x.id === sid);
          if (idx >= 0) acc.ships.splice(idx, 1);
        }
      }
      alert(r.logs.join('\n'));
      renderHoi(root, ctx);
    });
    row.appendChild(go);
    seaSec.appendChild(row);
  }
  panel.appendChild(seaSec);
  }   // v0.4.8：end if (isHoi) —— 轨道圈层仅「风暴前夜」显示

  // ---- 口径说明 ----
  // v0.4.8：按剧本给不同说明 —— 非 1936 存档不再显示「本页为 1936 专属」这种
  //   与实际不符的话（战区地图现在对所有剧本开放）。
  panel.appendChild(el('p', 'hoi-note', isHoi
    ? '说明：本页为官方 mod「1936 剧本」专属。交战采用钢铁雄心式多回合结算（编队宽度 3、组织度耗尽撤退）；'
      + '轨道战按舰队实力与真实海军规模换算（含舰队传统加成）；国策按游戏天数推进，'
      + '同支国策需按序解锁，外交线两策互斥。'
      + '战争严格按历史时间表推进：只有踩到对应史实节点才可宣战，AI 也只在节点日开战；'
      + '「战争」栏可下拉选择进行中的战争并查看双方实时状态（我方为真实 army/fleet/工业，'
      + '敌方为 1936 年基准静态值）。'
      + '另外：「星球管理 → 战时总动员」在全存档可用（产出 +30%、幸福度下滑）。'
    : '说明：行星战区地图与战争结算对所有剧本开放。交战采用钢铁雄心式多回合结算'
      + '（编队宽度 3、组织度耗尽撤退）；补给只在我方连片战区内流通，'
      + '断供或失守会大幅压低该战区产出。'
      + '「国策」与「轨道圈层」为「风暴前夜」剧本专属，本页不显示。'
      + '另外：「星球管理 → 战时总动员」在全存档可用（产出 +30%、幸福度下滑）。'));

  root.appendChild(panel);

  // ===== v0.3.3：每秒实时刷新 =====
  // 此前本页**完全没有 setInterval**：剧本日期、战争分数、战场推进、制海权都在后台
  // 每秒推进（core/hoi1936.js 由 state.js#tick 驱动），但页面只在「打开 / 点按钮」
  // 时算一次 —— 玩家看到的是静止的数字。
  // 守卫沿用 ui/army.js / ui/shipyard.js 的既有约定：
  //   * 不能用 root.isConnected —— planet.js 切 tab 复用同一个 contentInner，
  //     isConnected 恒 true，旧定时器会把本页重绘回去盖掉新 tab；
  //     故用本页标记 .hoi-panel 判断。
  //   * 先清旧定时器再建新，避免每次重绘叠加。
  //   * 用户正在操作 select（下拉栏）时跳过，避免打断选择。
  if (root._hoiTimer) { clearInterval(root._hoiTimer); root._hoiTimer = null; }
  root._hoiTimer = setInterval(() => {
    if (!root.querySelector || !root.querySelector('.hoi-panel')) {
      clearInterval(root._hoiTimer); root._hoiTimer = null; return;
    }
    const active = typeof document !== 'undefined' ? document.activeElement : null;
    if (active && root.contains && root.contains(active) && active.tagName === 'SELECT') return;
    const accNow = currentAccount();
    if (!accNow) return;
    renderHoi(root, Object.assign({}, ctx, { account: accNow }));
  }, 1000);
}

// 物品栏（Astrix）
// 数据模型：星球实例（STATE.planets 中的对象）上挂 inventory 数组，
//   条目结构 { key, mat, layer, owned, rate, reserve, remaining, abundance, locked }。
//
// ============================================================================
// v0.0.61 改版（设计者三条需求）
// ============================================================================
// 【需求 1】浅层 / 深层 / 地核都有的资源，**储量分开标注**。
//   此前 buildPlanetInventory 按资源名去重、只保留第一个所属层，
//   于是所有星球的「石头」只留下地表那条 —— 地下的 1e12、地核的 2e6 被整个丢掉、采不到。
//   现在每个「资源 × 层」各成一条，所以：
//     * 「物品栏」栏按**材料**聚合显示一行（同一种材料就是一种材料，总量才是玩家关心的）；
//     * 「星球储藏」栏按**材料 × 层**分开显示，每行标注所属层与那一层自己的剩余储量。
//
// 【需求 2】显示各资源的**净增长**：`-` 用红色，`+` 用绿色。
//   净增长 = 采集 + 加工产出 − 加工投料 − 人口代谢消耗，由 state.js 每 tick 算好
//   挂在 `inst.netRates` 上；这里只负责显示与上色（0 不显示）。
//
// 【需求 3】开局不给氧气，氧气直接从星球气体储量里扣 —— 所以氧气的 `owned` 会是 0，
//   但它有负的净增长。因此「物品栏」的显示条件从「owned > 0」放宽为
//   「owned > 0 或有非零净增长」，否则玩家根本看不到氧气在减少。
//
// 更新：每秒 tick 后只重绘数字文本，不重建整表（事件委托 + 文本节点更新），避免点击失效。
// 所有数字显示一律走 format.js 的 fmtNum / fmtRate / fmtRateBody / fmtSci。
// 样式集中在 css/planet.css。

import { MATERIALS } from '../data/materials.js?v=21.18';
import { fmtNum, fmtRate, fmtSci, richText } from '../core/format.js?v=21.18';
import { getPlanetInstance, tick, currentAccount, atmosphereOf, ownedOf, rateOf } from '../core/state.js?v=21.18';
import { computePower, thermalFuelRates } from '../core/power.js?v=21.18';
import { equipmentList } from '../core/shipyard.js?v=21.18';
import { materialLabel, productionRates, farmRates, farmSupplyOf } from '../core/production.js?v=21.18';
import { BUILDING_BY_ID } from '../data/buildings.js?v=21.18';
import { NUTRIENT_NAMES, METABOLITE_NAMES, consumptionPerSec, metabolitePerSec } from '../core/population.js?v=21.18';
import { playPing } from '../core/sound.js?v=21.18';
// v0.2.3：军工与地面部队概览（真实数据，替换原装饰性假 HUD）
import { ARMY_PART_BY_ID } from '../data/army_parts.js?v=21.18';
import { stationedArmyPower } from '../core/army.js?v=21.18';

// 地层扫描雷达配置
const STRATA_CONFIG = [
  { id: 'all', nameCn: '全地层', icon: '🪐', depth: '全息透视' },
  { id: 'gas', nameCn: '气体层', icon: '🌌', depth: '大气逸散' },
  { id: 'surface', nameCn: '地表风蚀', icon: '🏔️', depth: '0 km' },
  { id: 'underground', nameCn: '浅层地裂', icon: '⛏️', depth: '10 km' },
  { id: 'deep', nameCn: '深地幔流', icon: '🌋', depth: '80 km' },
  { id: 'core', nameCn: '磁化地核', icon: '⚛️', depth: '500 km' },
];

// 分组顺序与中文标题
// v0.0.91：同事把星球数据拆成 surface(地表) / underground(浅层) / deep(深层) / core(地核) / gas(气体) 五层。
//   故 underground 改标「浅层」、新增 deep「深层」，core / gas / surface 不变。
const LAYER_LABEL = { surface: '地表', underground: '浅层', deep: '深层', core: '地核', gas: '气体' };

// 星球储藏的层显示顺序（surface → underground → deep → core → gas）
const LAYER_ORDER = { surface: 0, underground: 1, deep: 2, core: 3, gas: 4 };

// ============================================================================
// 采集「为什么不动」的原因文案（rev16 修复「采集时显示不增不减」）
// ============================================================================
// 背景：地表在「A1 深度采集」研究出来之前，粘土 / 石英 / 石墨 / 孔雀石 / 二氧化硅 /
//   红土 / 硫磺等**只有 rate = 0 且 locked = true**（见 state.js#recalcRates）；
//   地下 / 深层 / 地核 / 气体层则要先建成对应建筑。
//   此前这些状态在物品栏里**没有任何呈现**：净增长列是空白，点开的详情写「0（不增不减）」，
//   而「来源 / 消耗」还会谎称「未分配人力」——玩家明明派了露天采集工去采粘土，界面却
//   显示既不增也不减，于是报「物品栏 bug，采集时显示不增不减」。
//   现在把 state.js 已经算好的 `locked` 标记真正用起来，把原因如实说出来。
const MINABLE_LAYERS = { surface: 1, underground: 1, deep: 1, core: 1, gas: 1 };

// rev18：与 state.js#POWERED_GATHER_LAYERS 同口径 —— 这几层靠耗电建筑开采，缺电时按比例降速/停产。
//   露天采集（surface）是纯手工劳动，不吃电力降速。
const POWERED_LAYERS = { underground: 1, deep: 1, core: 1, gas: 1 };

// 该层未解锁时需要什么（地表是科技门槛，其余是建筑门槛）
const LAYER_UNLOCK_BUILDING = {
  underground: '浅层矿井', deep: '深层矿井', core: '地心矿井', gas: '大气收集器',
};
const SURFACE_UNLOCK_HINT = '需研究「A1 深度采集」';
const NO_POWER_HINT = '电力不足，停产';

// 某一层「采不到」的解锁条件（仅用于已 locked 的条目）
function layerLockHint(layer) {
  if (layer === 'surface') return SURFACE_UNLOCK_HINT;
  const need = LAYER_UNLOCK_BUILDING[layer];
  return need ? '需建造「' + need + '」' : '该层尚未开放';
}

// 原因文案的前缀图标（rev16 立规：需解锁条件用 🔒；rev18 补电力用 ⚡）
function reasonPrefix(why) {
  if (why.startsWith('需')) return '🔒 ';
  if (why.startsWith('电力')) return '⚡ ';
  return '';
}

// 某材料「净增长为 0」的真实原因。返回简短中文；正常在产或无采集层时返回 ''。
//   '' 以外的取值只有五种：需研究…/需建造…（未解锁）、电力不足（停产）、已采尽、未分配人力。
function noGainReasonOf(planet, mat) {
  const list = ((planet && planet.inventory) || [])
    .filter((e) => e && e.mat === mat && MINABLE_LAYERS[e.layer]);
  if (!list.length) return '';                                  // 加工产物（refined）不参与采集说明
  const producing = list.filter((e) => Number(e.rate) > 0);
  if (producing.length) {
    // rev18：有层在采、净增长却仍为 0 —— 唯一常见成因是缺电：
    //   耗电层（浅层/深层/地核/气体）按 powerInfo.ratio 降速，ratio = 0 时整层停产。
    //   此前这里一律返回 ''（= 正常），于是缺电时净增长列一片空白、详情写「0（不增不减）」，
    //   玩家明明派了矿工却看不到任何解释 —— 与 rev16 修的「不增不减」是同一类问题。
    const ratio = Number(planet && planet.powerInfo && planet.powerInfo.ratio);
    if (Number.isFinite(ratio) && ratio <= 0 && producing.some((e) => POWERED_LAYERS[e.layer])) {
      return NO_POWER_HINT;
    }
    return '';                                                  // 正在产 → 正常
  }
  // ① 还有「已解锁且尚有储量」的层 → 纯粹是没人干，与解锁无关（最关键：别把
  //    「石头地上就能挖、只是没派人」误报成「需建造浅层矿井」）。
  if (list.some((e) => !e.locked && stockOf(e, planet) > 0)) return '未分配人力';
  // ② 全都被锁住 → 给出解锁条件；地表是科技门槛、最容易解锁，优先提示它
  const lockedSurface = list.find((e) => e.locked && e.layer === 'surface');
  if (lockedSurface) return SURFACE_UNLOCK_HINT;
  const lockedOther = list.find((e) => e.locked);
  if (lockedOther) return layerLockHint(lockedOther.layer);
  // ③ 都已解锁但没有可采储量
  return '已采尽';
}

// 净增长配色（需求 2：+ 绿、− 红）
const NET_POS = '#9FE1CB';
const NET_NEG = '#f09595';
const NET_ZERO = '#7d8a97';

// 兼容两种调用：直接传星球实例；或传 { openModal, planetCode, account }
function resolveInstance(planetOrCtx) {
  if (planetOrCtx && (planetOrCtx.layers || planetOrCtx.planetId || planetOrCtx.inventory || planetOrCtx.code || planetOrCtx.id)) {
    return planetOrCtx; // 已是星球实例
  }
  const ctx = planetOrCtx || {};
  const code = ctx.planetCode || (currentAccount() && currentAccount().homePlanetCode) || 'syl';
  return getPlanetInstance(code);
}

// ============================================================================
// v0.0.7：当前活动物品栏容器 + 全局 250ms 刷新
// ============================================================================
// 旧写法把 refresh 挂在 container._invTimer 上，玩家切到别的 tab 再切回来时，
// contentInner 被清空重渲染，旧节点的 _invRefresh 指向已卸载的子节点、数字不再更新。
// 改用「模块级 active 记录正在显示的那个容器」，定时器只刷 active；面板被卸载
// （isConnected 为 false）时把 active 置空，切回来重新 render 时再更新 active。
let activeInventory = null;
let invRefreshTimer = null;

// 丰度格式化：极小走科学记数法
function fmtAbundance(a) {
  if (a < 0.01) return fmtSci(a);
  return Number.isInteger(a) ? String(a) : parseFloat(a.toFixed(2)).toString();
}

// 防 XSS 的 HTML 转义
function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
}

// 剩余储量：优先用 remaining（v0.0.5），旧存档回退到 reserve - owned
function remainOf(entry) {
  if (Number.isFinite(entry.remaining)) return Math.max(0, entry.remaining);
  return Math.max(0, (Number(entry.reserve) || 0) - (Number(entry.owned) || 0));
}

// 可采总量（v0.0.6，需求 R11）：
//   气体层还要加上玩家呼吸排放进大气的那份 —— 排放的气是可以被大气收集器再采回来的。
function stockOf(entry, planet) {
  const base = remainOf(entry);
  if (!planet || entry.layer !== 'gas') return base;
  const atm = atmosphereOf(planet);
  return base + (Number(atm[entry.mat]) || 0);
}

// 某材料的净增长速度（state.js 每 tick 算好）
function netOf(planet, mat) {
  const t = planet && planet.netRates;
  const v = t ? Number(t[mat]) : 0;
  return Number.isFinite(v) ? v : 0;
}

// v0.1.0：精细度显示。规则：材料名 + "+" + (精细度 − 1)，只在精细度 > 1 时加后缀；
//   精细度 1 显示原名。本地版（fineness 已知时直接用）；材料名已知、需查表时用 core 的 materialLabel。
function matLabel(mat, fineness) {
  return fineness > 1 ? mat + '+' + (fineness - 1) : mat;
}

// 把物品栏条目按**材料**聚合（v0.0.61 需求 1）
// 显示条件：owned > 0 或 有非零净增长（后者是为了让「开局 0 库存的氧气」也能露脸）
function aggregateOwned(inv, planet) {
  const map = new Map();
  for (const e of inv) {
    const owned = Number(e.owned) || 0;
    const net = netOf(planet, e.mat);
    if (!(owned > 0) && net === 0) continue;
    let it = map.get(e.mat);
    if (!it) {
      it = { mat: e.mat, owned: 0, net, entry: e, layers: [] };
      map.set(e.mat, it);
    }
    it.owned += owned;
    it.layers.push(e);
  }
  return [...map.values()].sort((a, b) => b.owned - a.owned || a.mat.localeCompare(b.mat, 'zh'));
}

// 主入口：渲染物品栏到 container
export function renderInventory(container, planetOrCtx) {
  const planet = resolveInstance(planetOrCtx);
  // 复用主应用注入的 openModal（与开始界面同源、样式统一）
  const openModal = planetOrCtx && planetOrCtx.openModal ? planetOrCtx.openModal : null;
  if (!planet) {
    container.innerHTML = '<p class="muted">星球数据缺失。</p>';
    if (activeInventory === container) activeInventory = null;
    return;
  }
  const inv = planet.inventory || [];
  container.innerHTML = '';
  container.className = 'inventory';

  // 顶部概览：物品种类数 / 总持有 / 可用人力 / 总人力
  const overview = document.createElement('div');
  overview.className = 'inv-overview';
  container.appendChild(overview);

  // 物品栏区块
  const ownedWrap = document.createElement('section');
  ownedWrap.className = 'inv-block';
  const ownedTitle = document.createElement('div');
  ownedTitle.className = 'inv-block-title';
  ownedTitle.innerHTML = '物品栏<span class="inv-block-sub muted"> · 按资源汇总，含净增长（绿涨红跌）；🔒 表示尚未开放采集</span>';
  const ownedGrid = document.createElement('div');
  ownedGrid.className = 'inv-grid';
  ownedWrap.append(ownedTitle, ownedGrid);

  // 装备区块（v0.0.7）：制造车间产出的外壳 / 引擎 / 武器 / 船上设施
  const equipWrap = document.createElement('section');
  equipWrap.className = 'inv-block inv-block-equip';
  const equipTitle = document.createElement('div');
  equipTitle.className = 'inv-block-title';
  equipTitle.innerHTML = '装备<span class="inv-block-sub muted"> · 制造车间产出的外壳 / 引擎 / 武器 / 船上设施</span>';
  const equipGrid = document.createElement('div');
  equipGrid.className = 'inv-grid';
  equipWrap.append(equipTitle, equipGrid);

  // ============================================================================
  // v0.2.3：军备与地面部队概览（真实数据）
  // ============================================================================
  // 替换原「战时军工重工业动员枢纽」装饰性 HUD —— 那块的产能数字是硬编码的、
  // 两个按钮只改一行随机文案（且调用了未导入的 playShield/playLaser，点击即报错），
  // 没有任何游戏效果。现在只显示存档里的真实军事内容：
  //   ① 军事部件库存（装备库里 ap_* 开头的部件，含材料与数量）
  //   ② 现役部队与地面防卫战力（core/army.js 实时口径）
  //   ③ 整编产线真实进度
  // 没有任何军事内容时整块隐藏，不再占用首页空间。
  const acc0 = currentAccount();
  const milEquip = equipmentList(planet).filter((e) => e.count > 0 && String(e.partId || '').startsWith('ap_'));
  const milArmies = acc0 && Array.isArray(acc0.armies) ? acc0.armies : [];
  const milLines2 = acc0 && Array.isArray(acc0.armyBuildLines) ? acc0.armyBuildLines : [];
  const hasMilContent = milEquip.length > 0 || milArmies.length > 0 || milLines2.length > 0;

  let milSection = null;
  if (hasMilContent) {
    milSection = document.createElement('section');
    milSection.className = 'inv-block';
    const milTitle = document.createElement('div');
    milTitle.className = 'inv-block-title';
    milTitle.innerHTML = '🪖 军备与地面部队<span class="inv-block-sub muted"> · 真实库存与整编进度（整编 / 驻防 / 登陆在「军队」与「舰队」页操作）</span>';
    const milGrid = document.createElement('div');
    milGrid.className = 'inv-grid';
    milSection.append(milTitle, milGrid);

    const milRows = [];
    for (const e of milEquip.slice(0, 6)) {
      const p = ARMY_PART_BY_ID[e.partId];
      milRows.push('军事部件 · ' + (p ? p.nameCn : e.partId)
        + '（' + materialLabel(planet, e.material == null ? '通用材料' : e.material) + '）×' + fmtNum(e.count));
    }
    if (milEquip.length > 6) milRows.push('……另有 ' + (milEquip.length - 6) + ' 种军事部件在装备库');
    if (milArmies.length) {
      const stationedN = milArmies.filter((a) => a && a.stationed !== false && !a.embarkFleet).length;
      const embarkedN = milArmies.filter((a) => a && a.embarkFleet).length;
      const pw = stationedArmyPower(acc0, planet.code);
      milRows.push('现役部队 ' + milArmies.length + ' 个营（驻防 ' + stationedN
        + (embarkedN ? ' · 随舰队出征 ' + embarkedN : '') + '）· 本星地面防卫 +' + fmtNum(pw));
    }
    for (const l of milLines2.slice(0, 4)) {
      milRows.push('整编中：' + (l.nameCn || '部队') + ' · 进度 ' + Math.min(100, Math.floor((Number(l.progress) || 0) * 100)) + '%');
    }
    if (milLines2.length > 4) milRows.push('……另有 ' + (milLines2.length - 4) + ' 条整编产线');

    for (const t of milRows) {
      const row = document.createElement('div');
      row.className = 'inv-row';
      const name = document.createElement('span');
      name.className = 'inv-name';
      name.textContent = t;
      row.appendChild(name);
      milGrid.appendChild(row);
    }
  }

  const storeWrap = document.createElement('section');
  storeWrap.className = 'inv-block inv-block-store';
  const storeTitle = document.createElement('div');
  storeTitle.className = 'inv-block-title';
  storeTitle.innerHTML = '星球储藏<span class="inv-block-sub muted"> · 按「资源 × 层」分开标注剩余储量，采集会扣减；🔒 表示该层尚未开放</span>';

  // v0.2.3：地层筛选条（保留真实功能：点按层卡片即可筛选下方储藏表；
  //   删除原「地质断层雷达」里纯装饰的假声纳按钮、地震波动画与随机伪造回波文案）
  let selectedLayer = 'all';
  const strataHud = document.createElement('div');
  strataHud.className = 'strata-scanner glass';
  strataHud.style.cssText = 'margin:8px 0 12px 0;padding:12px;border-radius:8px;border:1px solid #38bdf835;background:rgba(15,23,42,0.65);';

  const radarHeader = document.createElement('div');
  radarHeader.style.cssText = 'font-size:13px;font-weight:bold;color:#7cd7ff;margin-bottom:8px;';
  radarHeader.textContent = '📡 按地层筛选储藏';

  const waveContainer = null;   // v0.2.3：地震波动画与伪造回波文案已删除（纯装饰）

  const strataRow = document.createElement('div');
  strataRow.style.cssText = 'display:flex;gap:6px;flex-wrap:wrap;';

  const storeGrid = document.createElement('div');
  storeGrid.className = 'inv-grid';

  function applyStrataFilter() {
    for (const b of strataRow.children) {
      const match = b.dataset.layer === selectedLayer;
      b.className = match ? 'stratum-card-active' : '';
      b.style.borderColor = match ? '#38bdf8' : '#22354c';
      b.style.background = match ? 'rgba(56,189,248,0.2)' : 'rgba(255,255,255,0.04)';
      b.style.color = match ? '#7cd7ff' : '#94a3b8';
    }
    const rows = storeGrid.querySelectorAll('.inv-row-store');
    rows.forEach((r) => {
      if (selectedLayer === 'all') {
        r.style.display = '';
      } else {
        r.style.display = (r.dataset.layer === selectedLayer) ? '' : 'none';
      }
    });
  }

  for (const s of STRATA_CONFIG) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.dataset.layer = s.id;
    btn.style.cssText = 'flex:1;min-width:76px;padding:6px 4px;font-size:11px;border-radius:6px;border:1px solid #22354c;background:rgba(255,255,255,0.04);color:#94a3b8;cursor:pointer;text-align:center;transition:all 0.2s ease;';
    btn.innerHTML = `<div style="font-size:13px;">${s.icon}</div><div style="font-weight:bold;margin-top:2px;">${s.nameCn}</div><div style="font-size:10px;opacity:0.75;">${s.depth}</div>`;
    btn.onclick = () => {
      selectedLayer = s.id;
      playPing();
      applyStrataFilter();
    };
    strataRow.appendChild(btn);
  }

  strataHud.append(radarHeader, strataRow);
  storeWrap.append(storeTitle, strataHud, storeGrid);

  if (milSection) container.append(milSection);   // v0.2.3：仅在有真实军事内容时插入
  container.append(ownedWrap, equipWrap, storeWrap);

  // ========================================================================
  // 行集合动态重建（v0.0.62）
  // ========================================================================
  // 背景：全新档第一次渲染时 netRates 还是空表，0 库存的氧气（要靠负净增长才露脸）
  //   建不出行来，得等重进物品栏才出现。
  // 方案：buildRows() 负责建行；refresh() 每秒先比对「可见行集合」的指纹，
  //   变了才整表重建（罕见事件），否则只更新数字。
  //   指纹只取成员资格（owned>0 或 net≠0、储量>0），不取数值 ——
  //   所以持有量正常涨跌不会触发重建，不会每秒闪一下。
  const refs = [];

  // 事件委托：整表只绑一次（行集合动态重建，不重绑，避免监听器叠加）
  if (!container._invBound) {
    container._invBound = true;
    container.addEventListener('click', (e) => {
      const row = e.target.closest('.inv-row');
      if (!row) return;
      const mat = row.dataset.mat;
      const layer = row.dataset.layer || '';
      if (!mat) return;
      openDetail(mat, layer, planet, openModal, inv);
    });
  }

  // 可见行集合的指纹：物品栏按材料、储藏按「材料×层」，只看成员资格。
  // ⚠ rev16：必须**与数值无关**。此前直接取 aggregateOwned 的输出顺序，
  //   而它是按「持有量降序」排的 —— 采集时各资源持有量此消彼长、排名一变，
  //   指纹就变，于是每个刷新周期都整表重建；重建那一帧新行的数字还是空的，
  //   看起来正好像「采集时显示不增不减」。这里统一按名称排序，彻底消除该抖动。
  function rowsKey() {
    const owned = aggregateOwned(inv, planet).map((i) => i.mat).sort().join('|');
    const store = inv.filter((e) => stockOf(e, planet) > 0)
      .map((e) => e.mat + ':' + e.layer).sort().join('|');
    return owned + '//' + store;
  }

  function buildRows() {
    refs.length = 0;
    ownedGrid.innerHTML = '';
    storeGrid.innerHTML = '';
    const ownedItems = aggregateOwned(inv, planet);
    // 储藏按 surface → underground → deep → core → gas 排序；层名认不出时排到最后
    const storeItems = inv.filter((e) => stockOf(e, planet) > 0)
      .sort((a, b) => ((LAYER_ORDER[a.layer] ?? 99) - (LAYER_ORDER[b.layer] ?? 99)));
    for (const item of ownedItems) {
      const row = buildRow(item, 'owned', planet);
      ownedGrid.appendChild(row);
      refs.push({ kind: 'owned', item, rowEl: row, ownedEl: row._owned, rateEl: row._rate });
    }
    for (const entry of storeItems) {
      const row = buildRow(entry, 'store', planet);
      storeGrid.appendChild(row);
      refs.push({ kind: 'store', entry, rowEl: row, remainEl: row._remain, abEl: row._ab });
    }
    if (ownedItems.length === 0) ownedGrid.appendChild(emptyHint('暂无持有物品'));
    if (storeItems.length === 0) storeGrid.appendChild(emptyHint('该星球资源已采尽'));
    applyStrataFilter();
    container._invRowsKey = rowsKey();
    buildEquipRows();
  }

  // 装备区块：数据来自 core/shipyard.js 的 equipmentList(planet)。
  // 每行：部件名 · 材料 ×数量；count<=0 不显示；空则占位。
  // 行数少，每次刷新直接重建该区块内部行即可。
  // v0.1.1（需求 13）防御性修复：装备行渲染若抛异常（数据异常 / 回归 bug），
  //   不能连累整个物品栏渲染链——整体 try/catch，异常时 console.error 并显示空态提示。
  function buildEquipRows() {
    equipGrid.innerHTML = '';
    try {
      const list = equipmentList(planet).filter((e) => e.count > 0);
      if (list.length === 0) {
        equipGrid.appendChild(emptyHint('暂无装备，去制造车间生产部件'));
        return;
      }
      for (const e of list) {
        const row = document.createElement('div');
        row.className = 'inv-row inv-row-equip';
        const name = document.createElement('span');
        name.className = 'inv-name';
        name.textContent = e.part ? e.part.nameCn : e.partId;
        const val = document.createElement('span');
        val.className = 'inv-val';
        const mat = e.material != null ? e.material : '通用材料';
        val.textContent = materialLabel(planet, mat) + ' ×' + fmtNum(e.count);
        const sep = document.createElement('span');
        sep.className = 'inv-sep muted';
        sep.textContent = ' · ';
        row.append(name, sep, val);
        equipGrid.appendChild(row);
      }
    } catch (err) {
      console.error('[inventory] 装备清单渲染失败：', err);
      equipGrid.appendChild(emptyHint('装备清单暂时无法显示'));
    }
  }

  buildRows();

  // 刷新数字部分（被每秒 tick 调用；集合变化时整表重建，罕见）
  function refresh() {
    // 集合指纹变了才整表重建；**重建后继续往下填数字**——此前这里 return 掉，
    //   于是新行要等下一个刷新周期（250ms）才有数字，中间那一帧整表空白，
    //   看起来正像「采集时数字不动」。rev16 起不再有这一帧。
    if (container._invRowsKey !== rowsKey()) buildRows();
    let totalOwned = 0;
    for (const r of refs) {
      if (r.kind === 'owned') {
        // v0.0.8（设计者第 3 条）：持有量必须用当前实时聚合值，不能用建行那一刻
        //   aggregateOwned 的快照 r.item.owned——否则采集 / 加工 / 人口代谢让数量变了，
        //   这里显示的还是旧值。改走 ownedOf(planet, mat) 跨层实时重算。
        const owned = ownedOf(planet, r.item.mat);
        totalOwned += owned;
        r.ownedEl.textContent = fmtNum(owned);
        // 需求 2：显示净增长，+ 绿、− 红；为 0 时不显示数字，
        //   但必须说明「为什么是 0」（未解锁 / 已采尽 / 未分配人力）——rev16 修复。
        const net = netOf(planet, r.item.mat);
        if (net !== 0) {
          r.rateEl.textContent = ' ' + fmtRate(net);
          r.rateEl.setAttribute('style', 'color:' + (net > 0 ? NET_POS : NET_NEG));
        } else {
          const why = noGainReasonOf(planet, r.item.mat);
          r.rateEl.textContent = why ? ' ' + reasonPrefix(why) + why : '';
          r.rateEl.setAttribute('style', 'color:' + NET_ZERO);
        }
      } else {
        r.remainEl.textContent = fmtNum(stockOf(r.entry, planet));
        // rev16：被锁的层（未建矿井 / 未研究深度采集）在丰度后标出解锁条件，
        //   否则玩家看到「剩余储量 500k」却怎么都采不动，无从判断卡在哪。
        //   解锁状态是实时变的（建成矿井 / 研究完科技），所以这里每帧同步一次灰显样式。
        r.rowEl.classList.toggle('inv-row-locked', !!r.entry.locked);
        r.abEl.textContent = '丰度 ' + fmtAbundance(r.entry.abundance)
          + (r.entry.locked ? ' · 🔒 ' + layerLockHint(r.entry.layer) : '');
      }
    }
    const avail = planet.population?.available ?? 0;
    const total = planet.population?.total ?? 0;
    overview.textContent = '';
    overview.append(
      document.createTextNode('物品种类 ' + inv.length),
      document.createTextNode(' · 总持有 ' + fmtNum(totalOwned)),
      document.createTextNode(' · 人力 ' + fmtNum(avail) + ' / ' + fmtNum(total)),
    );
    // v0.0.6（需求 R9）：概览里加「净产电」与「储电量」。
    const pw = planet.powerInfo || computePower(planet, currentAccount());
    const net = (Number(pw.gen) || 0) - (Number(pw.draw) || 0);
    const pwr = document.createElement('span');
    pwr.className = 'inv-power';
    pwr.setAttribute('style', 'color:' + (net < -1e-9 ? NET_NEG : NET_POS));
    pwr.textContent = ' · 净产电 ' + fmtRate(net)
      + ' · 储电 ' + fmtNum(pw.storage) + ' / ' + fmtNum(pw.storageMax);
    overview.appendChild(pwr);
    buildEquipRows();
  }

  refresh();
  // 让最新一次 render 的 refresh 成为活动刷新函数，并标记本容器为当前活动容器
  container._invRefresh = refresh;
  activeInventory = container;
  // v0.0.7：全局唯一 250ms 定时器，只刷 active 容器——
  // 玩家切到别的 tab 再切回来，active 已重新指向当前容器，数字继续更新。
  if (!invRefreshTimer) {
    invRefreshTimer = setInterval(() => {
      const c = activeInventory;
      if (!c || !c.isConnected) { activeInventory = null; return; }
      if (c._invRefresh) c._invRefresh();
    }, 250);
  }
}

// 构建一行紧凑按钮（单行，移动端点击区 ≥44px）。
// kind: 'owned' → item 是聚合后的 { mat, owned, net, layers }
//       'store' → item 是单条库存条目（带 layer）
function buildRow(item, kind, planetRef) {
  const row = document.createElement('button');
  row.type = 'button';
  row.className = 'inv-row' + (kind === 'store' ? ' inv-row-store' : '')
    + (kind === 'store' && item.locked ? ' inv-row-locked' : '');   // rev16：未解锁的层灰显
  row.dataset.mat = item.mat;
  if (kind === 'store') row.dataset.layer = item.layer;

  const name = document.createElement('span');
  name.className = 'inv-name';
  if (kind === 'store') {
    // 需求 1：储藏栏标注所属层（地表 / 地下 / 地核 / 气体）
    const chip = document.createElement('span');
    chip.className = 'inv-chip inv-chip-' + item.layer;
    chip.textContent = LAYER_LABEL[item.layer] || item.layer;
    name.appendChild(chip);
  }
  // v0.1.0：精细度 >1 的材料显示成「铁+6」（materialLabel 需要星球实例查自定义材料）
  name.appendChild(document.createTextNode(materialLabel(planetRef, item.mat)));

  const val = document.createElement('span');
  val.className = 'inv-val';
  if (kind === 'owned') {
    const ownedEl = document.createElement('b');
    ownedEl.className = 'inv-owned';
    const rateEl = document.createElement('i');
    rateEl.className = 'inv-rate';
    val.append(ownedEl, rateEl);
    row._owned = ownedEl;
    row._rate = rateEl;
  } else {
    const remainEl = document.createElement('b');
    remainEl.className = 'inv-remain';
    const abEl = document.createElement('i');
    abEl.className = 'inv-ab muted';
    val.append(remainEl, document.createTextNode(' · '), abEl);
    row._remain = remainEl;
    row._ab = abEl;
  }

  row.append(name, val);
  return row;
}

function emptyHint(text) {
  const p = document.createElement('p');
  p.className = 'inv-empty muted';
  p.textContent = text;
  return p;
}

// v0.0.61：在星球实例的自定义材料表里找材料。
// 自定义化工厂造出来的材料不在静态的 MATERIALS 表里，不查这一遍就会显示「暂无资料」。
function findCustomMaterial(planet, nameCn) {
  const t = planet && planet.customMaterials;
  if (!t || typeof t !== 'object') return null;
  for (const k in t) {
    const m = t[k] && t[k].material;
    if (m && m.nameCn === nameCn) return m;
  }
  return null;
}

// v0.1.1（需求 8）：材料「来源 / 消耗」明细。
//   来源 = 各层采集条目的 rate（state.js 每 tick 写，标注所属层）
//        + 生产线产出（production.js productionRates 按建筑汇总，含速率）
//        + 农田产出（农田工岗位驱动的固定配方）
//        + 人口代谢排出（population.js metabolitePerSec）；
//   消耗 = 生产线投入（**只算真正从物品栏扣的**：气体投料走星球储量，不算）
//        + 农田投料（同上）+ 火力设施燃料 + 人口代谢消耗（population.js consumptionPerSec）。
//   生产线速率的电力比从 inst.powerInfo.ratio 取；拿不到按 1 估算并标 noPowerRatio。
//
// ⚠ rev18：本表必须与 state.js#computeNetRates（「净增长」列）**逐项同源**，否则
//   详情写「+38.77 浅层采集」、净增长却写 0，玩家会直接判定「采集坏了」。
//   因此：① 采集速率要乘电力降速比（缺电时不能谎报产出）；
//        ② 投料改用 ownedInputs（气体投入不算物品栏负增长）；
//        ③ 补上农田与火力燃料 —— 此前这两项在详情里完全看不到。
function buildMaterialFlow(planet, mat) {
  const sources = [];
  const consumes = [];
  let noPowerRatio = false;
  const pwRatio = planet && planet.powerInfo ? Number(planet.powerInfo.ratio) : NaN;
  const ratio = Number.isFinite(pwRatio) ? pwRatio : (noPowerRatio = true, 1);

  // ① 采集：每层一条（e.rate 是该层当前采集速率，未分配人力 / 已采尽时为 0）
  //   rev18：耗电层乘电力降速比 —— 缺电时实际不产，这里就应当显示 0（甚至不列来源）。
  for (const e of ((planet && planet.inventory) || [])) {
    if (!e || e.mat !== mat) continue;
    const r = (Number(e.rate) || 0) * (POWERED_LAYERS[e.layer] ? ratio : 1);
    if (r > 0) sources.push({ label: (LAYER_LABEL[e.layer] || e.layer) + '采集', rate: r });
  }

  // ② 生产线：按建筑汇总的产出 / 投入速率（productionRates 内部会跳过 dock 造船线）
  const rates = productionRates(planet, ratio, currentAccount());
  for (const bid in rates) {
    const slot = rates[bid];
    const bName = (BUILDING_BY_ID[bid] && BUILDING_BY_ID[bid].nameCn) || bid;
    for (const k in (slot.outputs || {})) {
      if (k !== mat) continue;
      const out = Number(slot.outputs[k]) || 0;
      if (out > 0) sources.push({ label: bName + '产出', rate: out });
    }
    // rev18：只算真正从物品栏扣掉的投料（气体走 _consumeGas 扣星球储量 / 大气层）
    const paid = (slot.ownedInputs && typeof slot.ownedInputs === 'object') ? slot.ownedInputs : (slot.inputs || {});
    const inp = Number(paid[mat]) || 0;
    if (inp > 0) consumes.push({ label: bName + '投入', rate: inp });
  }

  // ②b rev18：农田（农田工岗位驱动，不走生产线）
  const farm = farmRates(planet, ratio);
  if (farm.active) {
    const supply = farmSupplyOf(planet);
    const fRate = farm.rate * supply;
    const fOut = Number(farm.outputs[mat]) || 0;
    if (fOut > 0 && fRate > 0) sources.push({ label: '农田产出', rate: fOut * fRate });
    const fIn = Number(farm.ownedInputs[mat]) || 0;
    if (fIn > 0 && fRate > 0) consumes.push({ label: '农田投入', rate: fIn * fRate });
  }

  // ②c rev18：火力设施烧掉的燃料（真的从物品栏扣）
  const fuel = thermalFuelRates(planet);
  if (Number(fuel[mat]) > 0) consumes.push({ label: '火力设施燃料', rate: Number(fuel[mat]) });

  // ③ 人口代谢（population.js 以 key 计，这里翻回材料中文名对上号）
  const pop = planet && planet.pop ? planet.pop : null;
  if (pop) {
    const cons = consumptionPerSec(pop);
    for (const k of Object.keys(NUTRIENT_NAMES)) {
      if (NUTRIENT_NAMES[k] === mat && Number(cons[k]) > 0) {
        consumes.push({ label: '人口消耗', rate: Number(cons[k]) });
      }
    }
    const met = metabolitePerSec(pop);
    for (const k of Object.keys(METABOLITE_NAMES)) {
      if (METABOLITE_NAMES[k] === mat && Number(met[k]) > 0) {
        sources.push({ label: '人口排出', rate: Number(met[k]) });
      }
    }
  }
  return { sources, consumes, noPowerRatio };
}

// 「来源 / 消耗」一行：正负配色遵循项目约定（+ 绿 #9FE1CB / − 红 #f09595），
// 速率格式化走 format.js 的 fmtRate（禁止手拼 '/s' 或 toFixed 拼接）。
function flowRowHtml(label, rate) {
  const v = Number(rate) || 0;
  const color = v > 0 ? NET_POS : v < 0 ? NET_NEG : NET_ZERO;
  return '<tr><td class="dt-key muted">' + escapeHtml(label) + '</td>'
    + '<td class="dt-val" style="color:' + color + '">' + escapeHtml(fmtRate(v)) + '</td></tr>';
}

// 点击某行：弹出详情层（材料属性 + 本星球数据），复用主应用 openModal
//   layer === ''  → 物品栏行：按材料聚合展示（跨层持有量、净增长、各层明细）
//   layer !== ''  → 储藏行：展示那一层自己的剩余储量与丰度
function openDetail(mat, layer, planet, openModal, inv) {
  if (!openModal) return;
  const material = MATERIALS.find((m) => m.nameCn === mat)
    || findCustomMaterial(planet, mat)
    || null;

  // 介绍：查不到材料显示「暂无资料，等待补充」
  let html = '<div class="detail-section">';
  html += '<h4 class="detail-h">介绍</h4>';
  html += '<p class="detail-desc">' + richText(material ? (material.description || '暂无资料，等待补充') : '暂无资料，等待补充') + '</p>';
  html += '</div>';

  // 属性表：查不到的字段显示 —
  const attrs = [
    ['强度', material?.strength],
    ['耐久', material?.durability],
    ['密度', material?.density],
    ['精细度', material?.fineness],
    ['比热容 (J/(mol·K))', material?.molarHeatCapacity],
    ['熔点 (K)', material?.meltingPointK],
    ['特殊能力', material?.special],
  ];
  html += '<div class="detail-section"><h4 class="detail-h">属性</h4>';
  html += '<table class="detail-table">';
  for (const [k, v] of attrs) {
    html += '<tr><td class="dt-key muted">' + escapeHtml(k) + '</td><td class="dt-val">' +
      escapeHtml(v == null ? '—' : String(v)) + '</td></tr>';
  }
  html += '</table></div>';

  // v0.0.6 收尾批：自定义材料额外显示「合成来源」
  if (material && Array.isArray(material.derivedFrom) && material.derivedFrom.length) {
    const src = material.derivedFrom.map((p) => materialLabel(planet, p.mat) + ' ×' + fmtNum(p.amt)).join('、');
    html += '<div class="detail-section"><h4 class="detail-h">合成来源</h4>';
    html += '<p class="detail-desc">' + escapeHtml(src) + '</p></div>';
  }

  // 本星球数据
  const entries = inv.filter((e) => e.mat === mat);
  const net = netOf(planet, mat);
  // rev16：净增长为 0 时必须说清原因（未解锁 / 已采尽 / 未分配人力），
  //   此前一律写「0（不增不减）」——玩家明明派了人去采，看到的却是「不增不减」。
  const noGain = net === 0 ? noGainReasonOf(planet, mat) : '';
  const netText = net !== 0
    ? fmtRate(net) + (net > 0 ? '（增长）' : '（消耗）')
    : '0（' + (noGain || '不增不减') + '）';
  const rows = [
    ['玩家持有', fmtNum(entries.reduce((s, e) => s + (Number(e.owned) || 0), 0))],
    ['净增长', netText],
  ];
  if (layer) {
    const e = entries.find((x) => x.layer === layer);
    if (e) {
      const remain = stockOf(e, planet);
      const totalReserve = Number(e.reserve) || 0;
      const takenRatio = totalReserve > 0 ? ((totalReserve - Math.min(remain, totalReserve)) / totalReserve * 100) : 0;
      rows.push(['所属层', LAYER_LABEL[e.layer] || e.layer]);
      rows.push(['该层剩余储量', fmtNum(remain)]);
      rows.push(['该层原始储量', fmtNum(totalReserve)]);
      rows.push(['该层已开采比例', takenRatio > 0 ? takenRatio.toFixed(4) + '%' : '0%']);
      rows.push(['该层丰度', fmtAbundance(e.abundance)]);
      rows.push(['该层增速', e.rate > 0 ? fmtRate(e.rate) : '0（未分配人力或已采尽）']);
    }
  } else if (entries.length > 1) {
    // 需求 1：同名资源跨层时，把各层明细列出来，储量一目了然（按层顺序排）
    for (const e of [...entries].sort((a, b) => ((LAYER_ORDER[a.layer] ?? 99) - (LAYER_ORDER[b.layer] ?? 99)))) {
      rows.push(['　' + (LAYER_LABEL[e.layer] || e.layer) + ' 剩余储量', fmtNum(stockOf(e, planet))]);
    }
  } else if (entries.length === 1) {
    const e = entries[0];
    rows.push(['所属层', LAYER_LABEL[e.layer] || e.layer]);
    rows.push(['剩余储量', fmtNum(stockOf(e, planet))]);
    rows.push(['原始储量', fmtNum(Number(e.reserve) || 0)]);
    rows.push(['丰度', fmtAbundance(e.abundance)]);
  }
  html += '<div class="detail-section"><h4 class="detail-h">本星球数据</h4>';
  html += '<table class="detail-table">';
  for (const [k, v] of rows) {
    html += '<tr><td class="dt-key muted">' + escapeHtml(k) + '</td><td class="dt-val">' +
      escapeHtml(String(v)) + '</td></tr>';
  }
  html += '</table></div>';

  // v0.1.1（需求 8）：来源 / 消耗 —— 这个材料的速率从哪来、到哪去
  // v0.1.2：构建简介用 try/catch 包住，失败时退化显示，杜绝「点了没反应」
  html += '<div class="detail-section"><h4 class="detail-h">来源 / 消耗</h4>';
  html += '<table class="detail-table">';
  try {
    const flow = buildMaterialFlow(planet, mat);
    if (!flow.sources.length && !flow.consumes.length) {
      // rev16：此前这里写死「未分配人力」——但资源被科技 / 建筑锁住时人力早就派过了，
      //   这句谎言正是玩家以为「采集坏了」的直接原因。改成如实说明。
      const why = noGainReasonOf(planet, mat);
      html += '<tr><td class="dt-val muted">当前没有产出，也没有消耗。'
        + (why ? '原因：' + escapeHtml(why) + '。' : '') + '</td></tr>';
    } else {
      for (const r of flow.sources) html += flowRowHtml('来源 · ' + r.label, r.rate);
      for (const r of flow.consumes) html += flowRowHtml('消耗 · ' + r.label, -r.rate);
    }
    if (flow.noPowerRatio) {
      html += '<tr><td class="dt-key muted">口径</td><td class="dt-val muted">生产线速率未计电力降速</td></tr>';
    }
  } catch (err) {
    console.warn('[inventory] 来源/消耗明细构建失败，已退化显示：', err);
    html += '<tr><td class="dt-val muted">暂无来源 / 消耗明细</td></tr>';
  }
  html += '</table></div>';

  html += '<p class="detail-desc muted">开采出来的量会从对应层的「剩余储量」里扣掉，采尽即停产。'
    + '净增长 = 采集 + 加工产出 − 加工投料 − 人口消耗。</p>';

  const title = material ? (matLabel(mat, material.fineness) + '（' + (material.nameEn || '') + '）') : mat;
  openModal({ title, body: html });
}

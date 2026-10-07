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

import { MATERIALS } from '../data/materials.js?v=60.11';
import { fmtNum, fmtRate, fmtSci } from '../core/format.js?v=60.11';
import { getPlanetInstance, tick, currentAccount, atmosphereOf, ownedOf} from '../core/state.js?v=60.11';
import { computePower } from '../core/power.js?v=60.11';
import { equipmentList } from '../core/shipyard.js?v=60.11';
import { materialLabel, productionRates } from '../core/production.js?v=60.11';
import { BUILDING_BY_ID } from '../data/buildings.js?v=60.11';
import { NUTRIENT_NAMES, METABOLITE_NAMES, consumptionPerSec, metabolitePerSec } from '../core/population.js?v=60.11';
import { esc } from './common.js?v=60.11';

// 分组顺序与中文标题
// v0.0.91：同事把星球数据拆成 surface(地表) / underground(浅层) / deep(深层) / core(地核) / gas(气体) 五层。
//   故 underground 改标「浅层」、新增 deep「深层」，core / gas / surface 不变。
const LAYER_LABEL = { surface: '地表', underground: '浅层', deep: '深层', core: '地核', gas: '气体' };

// 星球储藏的层显示顺序（surface → underground → deep → core → gas）
const LAYER_ORDER = { surface: 0, underground: 1, deep: 2, core: 3, gas: 4 };

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
  ownedTitle.innerHTML = '物品栏<span class="inv-block-sub muted"> · 按资源汇总，含净增长（绿涨红跌）</span>';
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

  const storeWrap = document.createElement('section');
  storeWrap.className = 'inv-block inv-block-store';
  const storeTitle = document.createElement('div');
  storeTitle.className = 'inv-block-title';
  storeTitle.innerHTML = '星球储藏<span class="inv-block-sub muted"> · 按「资源 × 层」分开标注剩余储量，采集会扣减</span>';
  const storeGrid = document.createElement('div');
  storeGrid.className = 'inv-grid';
  storeWrap.append(storeTitle, storeGrid);

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

  // 可见行集合的指纹：物品栏按材料、储藏按「材料×层」，只看成员资格
  function rowsKey() {
    const owned = aggregateOwned(inv, planet).map((i) => i.mat).join('|');
    const store = inv.filter((e) => stockOf(e, planet) > 0)
      .map((e) => e.mat + ':' + e.layer).join('|');
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
      refs.push({ kind: 'owned', item, ownedEl: row._owned, rateEl: row._rate });
    }
    for (const entry of storeItems) {
      const row = buildRow(entry, 'store', planet);
      storeGrid.appendChild(row);
      refs.push({ kind: 'store', entry, remainEl: row._remain, abEl: row._ab });
    }
    if (ownedItems.length === 0) ownedGrid.appendChild(emptyHint('暂无持有物品'));
    if (storeItems.length === 0) storeGrid.appendChild(emptyHint('该星球资源已采尽'));
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
        // v0.2.8：装备名显示为「中文名@材料」（设计者要求，如 大型装甲@钢）；
        // 军用部件此前不在 PART_BY_ID 里，会露出英文 partId——equipmentList 已补 ARMY_PART_BY_ID 回退。
        const name = document.createElement('span');
        name.className = 'inv-name';
        const mat = e.material != null ? e.material : '通用材料';
        name.textContent = (e.part ? e.part.nameCn : e.partId) + '@' + materialLabel(planet, mat);
        const val = document.createElement('span');
        val.className = 'inv-val';
        val.textContent = '×' + fmtNum(e.count);
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
    if (container._invRowsKey !== rowsKey()) { buildRows(); return; }
    let totalOwned = 0;
    for (const r of refs) {
      if (r.kind === 'owned') {
        // v0.0.8（设计者第 3 条）：持有量必须用当前实时聚合值，不能用建行那一刻
        //   aggregateOwned 的快照 r.item.owned——否则采集 / 加工 / 人口代谢让数量变了，
        //   这里显示的还是旧值。改走 ownedOf(planet, mat) 跨层实时重算。
        const owned = ownedOf(planet, r.item.mat);
        totalOwned += owned;
        r.ownedEl.textContent = fmtNum(owned);
        // 需求 2：显示净增长，+ 绿、− 红；为 0 时不显示（不占位）
        const net = netOf(planet, r.item.mat);
        r.rateEl.textContent = net !== 0 ? ' ' + fmtRate(net) : '';
        r.rateEl.setAttribute('style', 'color:' + (net > 0 ? NET_POS : net < 0 ? NET_NEG : NET_ZERO));
      } else {
        r.remainEl.textContent = fmtNum(stockOf(r.entry, planet));
        r.abEl.textContent = '丰度 ' + fmtAbundance(r.entry.abundance);
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
  row.className = 'inv-row' + (kind === 'store' ? ' inv-row-store' : '');
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
//        + 人口代谢排出（population.js metabolitePerSec）；
//   消耗 = 生产线投入（按建筑汇总）+ 人口代谢消耗（population.js consumptionPerSec）。
//   生产线速率的电力比从 inst.powerInfo.ratio 取；拿不到按 1 估算并标 noPowerRatio。
function buildMaterialFlow(planet, mat) {
  const sources = [];
  const consumes = [];
  let noPowerRatio = false;
  const pwRatio = planet && planet.powerInfo ? Number(planet.powerInfo.ratio) : NaN;
  const ratio = Number.isFinite(pwRatio) ? pwRatio : (noPowerRatio = true, 1);

  // ① 采集：每层一条（e.rate 是该层当前采集速率，未分配人力 / 已采尽时为 0）
  for (const e of ((planet && planet.inventory) || [])) {
    if (!e || e.mat !== mat) continue;
    const r = Number(e.rate) || 0;
    if (r > 0) sources.push({ label: (LAYER_LABEL[e.layer] || e.layer) + '采集', rate: r });
  }

  // ② 生产线：按建筑汇总的产出 / 投入速率（productionRates 内部会跳过 dock 造船线）
  const rates = productionRates(planet, ratio, currentAccount());
  for (const bid in rates) {
    const slot = rates[bid];
    const bName = (BUILDING_BY_ID[bid] && BUILDING_BY_ID[bid].nameCn) || bid;
    const out = Number(slot.outputs && slot.outputs[mat]) || 0;
    if (out > 0) sources.push({ label: bName + '产出', rate: out });
    const inp = Number(slot.inputs && slot.inputs[mat]) || 0;
    if (inp > 0) consumes.push({ label: bName + '投入', rate: inp });
  }

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
  return '<tr><td class="dt-key muted">' + esc(label) + '</td>'
    + '<td class="dt-val" style="color:' + color + '">' + esc(fmtRate(v)) + '</td></tr>';
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
  html += '<p class="detail-desc">' + esc(material ? (material.description || '暂无资料，等待补充') : '暂无资料，等待补充') + '</p>';
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
    html += '<tr><td class="dt-key muted">' + esc(k) + '</td><td class="dt-val">' +
      esc(v == null ? '—' : String(v)) + '</td></tr>';
  }
  html += '</table></div>';

  // v0.0.6 收尾批：自定义材料额外显示「合成来源」
  if (material && Array.isArray(material.derivedFrom) && material.derivedFrom.length) {
    const src = material.derivedFrom.map((p) => materialLabel(planet, p.mat) + ' ×' + fmtNum(p.amt)).join('、');
    html += '<div class="detail-section"><h4 class="detail-h">合成来源</h4>';
    html += '<p class="detail-desc">' + esc(src) + '</p></div>';
  }

  // 本星球数据
  const entries = inv.filter((e) => e.mat === mat);
  const net = netOf(planet, mat);
  const netText = net === 0 ? '0（不增不减）' : fmtRate(net) + (net > 0 ? '（增长）' : '（消耗）');
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
      rows.push(['该层剩余储量', (remain >= 1e15) ? '∞' : fmtNum(remain)]);
      rows.push(['该层原始储量', (totalReserve >= 1e15) ? '∞' : fmtNum(totalReserve)]);
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
    html += '<tr><td class="dt-key muted">' + esc(k) + '</td><td class="dt-val">' +
      esc(String(v)) + '</td></tr>';
  }
  html += '</table></div>';

  // v0.1.1（需求 8）：来源 / 消耗 —— 这个材料的速率从哪来、到哪去
  // v0.1.2：构建简介用 try/catch 包住，失败时退化显示，杜绝「点了没反应」
  html += '<div class="detail-section"><h4 class="detail-h">来源 / 消耗</h4>';
  html += '<table class="detail-table">';
  try {
    const flow = buildMaterialFlow(planet, mat);
    if (!flow.sources.length && !flow.consumes.length) {
      html += '<tr><td class="dt-val muted">当前没有来源，也没有消耗（未分配人力、未开生产线）。</td></tr>';
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

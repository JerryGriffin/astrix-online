// 电力面板 UI（Astrix v0.0.6，零依赖原生 ES module）
// 展示：顶部概览（发电/耗电/净产/储电/能量池/降速比）、储电站与设施槽、
// 12 项电力设施的安装/拆除、设施详情。样式内联注入，不污染 css/ 目录。
//
// ctx = { openModal, closeModal, planet, account }，planet 为星球实例。

import {
  computePower, energyOf,
  installedFacilities, installFacility, uninstallFacility, facilityStockOf,
  panelEffOf, facilityFuelOf, buildingCountBonus,
} from '../core/power.js?v=42.7';
import { POWER_FACILITIES, POWER_FACILITY_BY_ID } from '../data/facilities.js?v=42.7';
import { BUILDING_BY_ID } from '../data/buildings.js?v=42.7';
import { RECIPES } from '../data/recipes.js?v=42.7';
import { linesOf } from '../core/production.js?v=42.7';
import { jobsOfBuilding, jobOutput, assignedToBuilding, buildingSlots } from '../core/population.js?v=42.7';
import { fmtNum, fmtRate, fmtRateBody } from '../core/format.js?v=42.7';

const CSS = `
  .pwr-panel { font-family: system-ui, sans-serif; color: #e8eef2; padding: 12px; box-sizing: border-box; }
  .pwr-overview { background: #1b2530; border-radius: 10px; padding: 10px 12px; margin-bottom: 12px; font-size: 13px; line-height: 1.9; }
  .pwr-overview .k { opacity: .7; }
  .pwr-overview .ok { color: #9FE1CB; font-weight: 600; }
  .pwr-overview .bad { color: #f09595; font-weight: 600; }
  .pwr-warn { background: #3a2020; border: 1px solid #f09595; color: #f09595; border-radius: 8px; padding: 8px 12px; margin-bottom: 12px; font-size: 13px; font-weight: 600; }
  .pwr-slotbox { background: #16202b; border: 1px solid #2a3645; border-radius: 10px; padding: 8px 12px; margin-bottom: 12px; font-size: 13px; }
  .pwr-slotbox .free { color: #9FE1CB; font-weight: 600; }
  .pwr-slotbox .full { color: #f09595; font-weight: 600; }
  .pwr-hint { background: #16202b; border: 1px solid #2a3645; border-left: 3px solid #5DCAA5; border-radius: 8px; padding: 8px 12px; margin-bottom: 12px; font-size: 12px; line-height: 1.5; opacity: .9; }
  .pwr-grid { display: grid; grid-template-columns: 1fr; gap: 8px; }
  .pwr-card { border: 1px solid #2a3645; border-radius: 10px; padding: 10px 12px; background: #16202b; }
  .pwr-card .p-head { display: flex; align-items: center; gap: 8px; }
  .pwr-card .p-name { font-weight: 600; cursor: pointer; color: #9FE1CB; }
  .pwr-card .p-name:hover { text-decoration: underline; }
  .pwr-card .p-tag { font-size: 11px; padding: 2px 6px; border-radius: 6px; background: #24323f; color: #9FE1CB; }
  .pwr-card .p-tag.storage { color: #9FE1CB; }
  .pwr-card .p-tag.solar { color: #9FE1CB; }
  .pwr-card .p-tag.wind { color: #9FE1CB; }
  .pwr-card .p-tag.thermal { color: #f0c495; }
  .pwr-card .p-sub { font-size: 11px; opacity: .65; margin: 4px 0 6px; line-height: 1.45; }
  .pwr-card .p-line { font-size: 12px; opacity: .9; }
  .pwr-card .p-actions { display: flex; align-items: center; gap: 8px; margin-top: 8px; flex-wrap: wrap; }
  .pwr-card .p-count { font-size: 12px; color: #9FE1CB; }
  .pwr-card button { min-height: 40px; min-width: 72px; border: none; border-radius: 8px; background: #2d5b7a; color: #fff; font-weight: 600; cursor: pointer; }
  .pwr-card button.uninstall { background: #3a2a2a; color: #ffd9d9; }
  .pwr-card button[disabled] { background: #28323d; color: #7d8a97; cursor: not-allowed; }
  .pwr-hint2 { font-size: 12px; opacity: .6; padding: 4px 2px 12px; line-height: 1.6; }
`;

function el(tag, attrs = {}, children = []) {
  const e = document.createElement(tag);
  for (const k in attrs) {
    if (k === 'style') e.setAttribute('style', attrs[k]);
    else if (k === 'text') e.textContent = attrs[k];
    else if (k === 'html') e.innerHTML = attrs[k];
    else e.setAttribute(k, attrs[k]);
  }
  for (const c of [].concat(children)) if (c) e.appendChild(c);
  return e;
}

function num(v, d = 0) {
  const n = Number(v);
  return Number.isFinite(n) ? n : d;
}

// 造价对象 → 「粘土 300 · 二氧化硅 200」
function costText(cost) {
  return Object.entries(cost || {})
    .map(([k, v]) => k + ' ' + fmtNum(v))
    .join(' · ') || '免费';
}

// 设施效果描述行（v0.0.7 去单位：去掉 m³ / t / /秒 等后缀，只保留数字）
function effectText(f) {
  if (f.kind === 'storage') return '储电上限 ' + fmtNum(f.capacity) + '　占地 ' + fmtNum(f.footprint) + '　质量 ' + fmtNum(f.mass);
  if (f.kind === 'solar') return '发电 ' + fmtNum(f.powerOut) + ' × 星球日照系数　占地 ' + fmtNum(f.footprint);
  if (f.kind === 'wind') return '发电 ' + fmtNum(f.powerOut) + ' × 星球风力系数　占地 ' + fmtNum(f.footprint);
  if (f.kind === 'thermal') return '发电 ' + fmtNum(f.powerOut) + '（烧 ' + f.fuel + '，' + fmtNum(f.fuelPerSec) + '·座）';
  return '';
}

// v0.0.9：发电绿色正值 / 耗电红色负号，统一口径
function genVal(v) { return el('span', { class: 'pwr-src-val gen', text: fmtRate(v) }); }
function drawVal(v) { return el('span', { class: 'pwr-src-val draw', text: fmtRate(-v) }); }

// 有效人力（与 core/power.js 的 laborOf 一致）：某建筑下所有职业（人数 × 强度产出倍率）之和
function laborOf(pop, buildingId) {
  if (!pop) return 0;
  let labor = 0;
  for (const j of jobsOfBuilding(buildingId)) labor += jobOutput(pop, j.id);
  return labor;
}

// 玩家持有的某种燃料量（与 core/power.js 的 fuelOwnedOf 一致）
function fuelOwnedOf(inst, fuelName) {
  if (!fuelName) return 0;
  const inv = inst.inventory || [];
  const e = inv.find((x) => x && x.mat === fuelName);
  return e ? num(e.owned, 0) : 0;
}

// v0.0.9：逐条拆解发电 / 耗电来源，口径与 computePower 完全一致（不另起一套模型）
// v0.1.1（需求 6）：发电一律乘 buildingCountBonus（computePower 是这么算的，不乘分项对不上合计）；
//   非加工建筑耗电改为「按用工率分摊」（powerDraw × 在岗人数/工位总数），不再按满座展示，
//   并修掉 `running = !!inst.recipes[id]` 的旧判定（inst.recipes 自 v0.0.9 起恒空）。
function buildSources(inst, pw, account = null) {
  const pop = inst.pop;
  const buildings = inst.buildings || {};
  const facilities = inst.facilities || {};
  const sp = inst.power || {};
  const solar = num(sp.solar, 0);
  const wind = num(sp.wind, 0);
  const recipeBuilding = new Set(RECIPES.map((r) => r.buildingId));
  const genBonus = buildingCountBonus(inst, account);   // 与 computePower 的发电加成同源

  const genRows = [];
  const drawRows = [];

  // 发电：powerOut > 0 的建筑（房屋 / 火力发电厂 / 清洁发电厂 jobs=0 按座数；其余按有效人力）
  for (const b of Object.values(BUILDING_BY_ID)) {
    if (!b || !(b.powerOut > 0)) continue;
    const n = num(buildings[b.id], 0);
    if (n <= 0) continue;
    const val = ((Number(b.jobs) === 0) ? b.powerOut * n : laborOf(pop, b.id) * b.powerOut) * genBonus;
    if (val > 1e-12) genRows.push({ name: b.nameCn, val });
  }

  // 发电：已装设施（光伏 / 风电 / 火电）；储电类不发电，也纳入明细展示储能量（需求 12）
  for (const fid in facilities) {
    const cnt = num(facilities[fid], 0);
    if (cnt <= 0) continue;
    const f = POWER_FACILITY_BY_ID[fid];
    if (!f) continue;
    if (f.kind === 'storage') {
      genRows.push({
        name: f.nameCn + ' × ' + fmtNum(cnt),
        val: 0,
        note: '储电上限 ' + fmtNum(num(f.capacity, 0) * cnt) + '（不发电）',
      });
      continue;
    }
    let val = 0;
    if (f.kind === 'solar') val = num(f.powerOut, 0) * cnt * solar * panelEffOf(inst, f) * genBonus;
    else if (f.kind === 'wind') val = num(f.powerOut, 0) * cnt * wind * genBonus;
    else if (f.kind === 'thermal') {
      const fuelName = facilityFuelOf(inst, f);
      if (fuelOwnedOf(inst, fuelName) > 1e-9) val = num(f.powerOut, 0) * cnt * genBonus;
    }
    if (val > 1e-12) genRows.push({ name: f.nameCn, val });
  }

  // 耗电：每个有 powerDraw 的建筑
  //   加工建筑按「运转中的生产线条数 × powerDraw」计（与 computePower 一致）；
  //   非加工建筑按用工率分摊：powerDraw ×（在岗人数 / 工位总数），没人值守就不耗电。
  for (const id in buildings) {
    const b = BUILDING_BY_ID[id];
    if (!b) continue;
    const n = num(buildings[id], 0);
    if (n <= 0 || !(b.powerDraw > 0)) continue;
    if (recipeBuilding.has(id)) {
      const running = linesOf(inst, id).filter((l) => l && (Number(l.workers) || 0) > 0).length;
      if (running > 0) drawRows.push({ name: b.nameCn + '（' + running + ' 条产线）', val: running * b.powerDraw });
    } else {
      const slots = buildingSlots(id, buildings);     // = 座数 × 每座工位
      const onJob = assignedToBuilding(pop, id);      // 该建筑下所有职业在岗人数
      const util = slots > 0 ? onJob / slots : 0;
      const val = b.powerDraw * util;
      if (val > 1e-12) drawRows.push({ name: b.nameCn, val });
    }
  }

  return { genRows, drawRows };
}

// v0.0.9：折叠区块「电力来源 / 消耗明细」（默认折叠，点标题展开/收起，可点击区 ≥44px）
function buildSourcesSection(inst, pw, collapsed, account = null) {
  const wrap = el('div', { class: 'pwr-sources' + (collapsed ? ' collapsed' : '') });
  const head = el('div', { class: 'pwr-sources-head', role: 'button', tabindex: '0' }, [
    el('span', { class: 'pwr-sources-arrow', text: '▾' }),
    el('span', { text: '电力来源 / 消耗明细' }),
  ]);
  wrap.appendChild(head);

  const body = el('div', { class: 'pwr-sources-body' });
  const { genRows, drawRows } = buildSources(inst, pw, account);
  const cols = el('div', { class: 'pwr-sources-cols' });

  const genCol = el('div', { class: 'pwr-sources-col' }, [
    el('div', { class: 'pwr-sources-coltitle gen', text: '发电' }),
  ]);
  for (const r of genRows) {
    genCol.appendChild(el('div', { class: 'pwr-src-row' }, [
      el('span', { class: 'pwr-src-name', text: r.name }),
      // 储电类不发电：展示储电上限说明文字而非速率值（需求 12）
      r.note ? el('span', { class: 'pwr-src-name', text: r.note }) : genVal(r.val),
    ]));
  }
  if (!genRows.length) genCol.appendChild(el('div', { class: 'pwr-src-row' }, [el('span', { class: 'pwr-src-name', text: '（暂无）' })]));

  const drawCol = el('div', { class: 'pwr-sources-col' }, [
    el('div', { class: 'pwr-sources-coltitle draw', text: '耗电' }),
  ]);
  for (const r of drawRows) {
    drawCol.appendChild(el('div', { class: 'pwr-src-row' }, [
      el('span', { class: 'pwr-src-name', text: r.name }),
      drawVal(r.val),
    ]));
  }
  if (!drawRows.length) drawCol.appendChild(el('div', { class: 'pwr-src-row' }, [el('span', { class: 'pwr-src-name', text: '（暂无）' })]));

  cols.appendChild(genCol);
  cols.appendChild(drawCol);
  body.appendChild(cols);

  // 合计：直接采用 computePower 的权威值，保证展示口径一致
  body.appendChild(el('div', { class: 'pwr-src-row pwr-src-total' }, [
    el('span', { class: 'pwr-src-name', text: '发电合计' }),
    genVal(pw.gen),
  ]));
  body.appendChild(el('div', { class: 'pwr-src-row pwr-src-total' }, [
    el('span', { class: 'pwr-src-name', text: '耗电合计' }),
    drawVal(pw.draw),
  ]));
  body.appendChild(el('div', { class: 'pwr-sources-note',
    text: '光伏 / 风电设施从星球能量池抽取清洁能（' + fmtRate(pw.cleanDraw) + '），其发电已计入上方「发电」。' }));

  wrap.appendChild(body);
  return { wrap, head };
}

export function renderPower(root, ctx) {
  const planet = (ctx && ctx.planet) || null;
  const account = (ctx && ctx.account) || null;
  const openModal = ctx && ctx.openModal;

  if (!root) return;
  root.innerHTML = '';
  root.appendChild(el('style', { text: CSS }));

  function draw() {
    root.innerHTML = '';
    root.appendChild(el('style', { text: CSS }));

    if (!planet) {
      root.appendChild(el('p', { text: '星球数据缺失。' }));
      return;
    }

    energyOf(planet);
    const pw = computePower(planet, account);
    const energy = planet.energy;
    const panel = el('div', { class: 'pwr-panel' });

    // ---- 顶部：电力来源 / 消耗明细（默认折叠）----
    const sourcesCollapsed = root._pwrSourcesCollapsed !== false;
    const { wrap: sourcesWrap, head: sourcesHead } = buildSourcesSection(planet, pw, sourcesCollapsed, account);
    const toggleSources = () => {
      root._pwrSourcesCollapsed = !(root._pwrSourcesCollapsed !== false);
      sourcesWrap.classList.toggle('collapsed', root._pwrSourcesCollapsed !== false);
    };
    sourcesHead.addEventListener('click', toggleSources);
    sourcesHead.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggleSources(); }
    });
    panel.appendChild(sourcesWrap);

    // ---- 顶部概览 ----
    const overview = el('div', { class: 'pwr-overview' });
    const ratioPct = Math.round(pw.ratio * 100);
    overview.appendChild(el('div', {}, [
      el('span', { class: 'k', text: '总发电 ' }),
      // v0.0.6：发电/耗电是**每秒**速率，必须走 4 位精度。
      //   之前用 fmtNum（小数固定 1 位）配 "/s"，发电量小于 0.05 就显示成「0.0/s」，
      //   玩家看到的就是「数字一动不动」。
      el('span', { class: 'ok', text: fmtRate(pw.gen) }),
      el('span', { class: 'k', text: '　总耗电 ' }),
      el('span', { class: 'bad', text: fmtRate(-pw.draw) }),
      el('span', { class: 'k', text: '　净产电 ' }),
      el('span', { class: pw.storageRate >= 0 ? 'ok' : 'bad', text: fmtRate(pw.storageRate) }),
    ]));
    overview.appendChild(el('div', {}, [
      el('span', { class: 'k', text: '储电 ' }),
      el('span', { class: 'ok', text: fmtNum(pw.storage) + ' / ' + fmtNum(pw.storageMax) }),
      el('span', { class: 'k', text: '　星球能量池 ' }),
      el('span', { class: 'ok', text: fmtNum(energy.total) + ' / ' + fmtNum(energy.max) }),
    ]));
    overview.appendChild(el('div', {}, [
      el('span', { class: 'k', text: '缺电降速比 ' }),
      el('span', { class: ratioPct < 100 ? 'bad' : 'ok', text: ratioPct + '%' }),
      pw.fuelShort ? el('span', { class: 'bad', text: '　⚠ 火力燃料不足' }) : null,
    ]));
    panel.appendChild(overview);

    // ---- 缺电警告 ----
    if (pw.ratio < 1) {
      panel.appendChild(el('div', { class: 'pwr-warn', text: '电力不足，全体耗电建筑降速运行（当前效率 ' + ratioPct + '%）。' }));
    }

    // ---- 储电站（单纯电池）+ 库存合计 ----
    const slots = el('div', { class: 'pwr-slotbox' });
    const spCount = (planet.buildings && planet.buildings['storage_plant']) || 0;
    const stock = facilityStockOf(planet);
    let stockTotal = 0;
    for (const f of POWER_FACILITIES) stockTotal += Math.floor(num(stock[f.id], 0));
    // v0.0.91：储电站是单纯电池，不提供设施槽；电力设施在星球上任意安装，不受槽位限制。
    slots.appendChild(el('div', { html:
      '储电站 <b>' + fmtNum(spCount) + '</b> 座（单纯电池：每座 1e5 储电上限）　库存合计 <b>' + fmtNum(stockTotal) + '</b>' }));
    panel.appendChild(slots);

    // ---- 关键提示：设施需在建造车间生产 ----
    panel.appendChild(el('div', { class: 'pwr-hint',
      text: '设施要在建造车间的「工作内容」里选配方生产出来，再安装到这里。造价与工作量是付给建造车间的，安装本身只消耗已造好的库存。' }));

    // ---- 安装设施：卡片列表 = 「已装 ∪ 有库存」并集（v0.1.1 需求 12）----
    //   旧逻辑只列「库存 ≥ 1」的设施：装完最后一件时库存键被删（installFacility 里 delete stock[id]），
    //   整张卡连同「已装 N 座」与拆除按钮一起消失，玩家无处拆除、误以为安装出错。
    //   现在已安装的设施永远保留卡片；安装按钮是否可用只取决于库存，拆除/计数只看已装数。
    const installed = installedFacilities(planet);
    const ownedList = POWER_FACILITIES.filter((f) =>
      Math.floor(num(stock[f.id], 0)) >= 1 || num(installed[f.id], 0) > 0);
    if (!ownedList.length) {
      panel.appendChild(el('div', { class: 'pwr-hint',
        text: '先在制造车间生产电力设施，再到这里安装。' }));
    } else {
      const grid = el('div', { class: 'pwr-grid' });
      for (const f of ownedList) {
        const cnt = installed[f.id] || 0;
        const stockN = Math.floor(num(stock[f.id], 0));
        const card = el('div', { class: 'pwr-card' });

        const head = el('div', { class: 'p-head' }, [
          el('span', {
            class: 'p-name', text: f.nameCn + (stockN > 0 ? ' × ' + fmtNum(stockN) : ''),
            title: '点击查看详情',
          }),
          el('span', { class: 'p-tag ' + f.kind, text: f.sizeLabel }),
          el('span', { class: 'p-tag ' + f.kind, text: ({ storage: '储电', solar: '光伏', wind: '风电', thermal: '火电' })[f.kind] }),
        ]);
        // 点击名称弹详情
        head.querySelector('.p-name').addEventListener('click', () => openDetail(f, openModal));
        card.appendChild(head);

        card.appendChild(el('div', { class: 'p-sub', text: f.desc || '' }));
        card.appendChild(el('div', { class: 'p-line', text: '造价 ' + costText(f.baseCost) + '　工作量 ' + fmtNum(f.work) }));
        card.appendChild(el('div', { class: 'p-line', text: '效果 ' + effectText(f) }));
        card.appendChild(el('div', { class: 'p-line', text: '已装 ' + fmtNum(cnt) + ' 座' }));

        const actions = el('div', { class: 'p-actions' });
        if (cnt > 0) {
          actions.appendChild(el('span', { class: 'p-count', text: '已装 ' + fmtNum(cnt) + ' 座' }));
          const unBtn = el('button', { class: 'uninstall', text: '拆除' });
          unBtn.addEventListener('click', () => { uninstallFacility(planet, f.id); draw(); });
          actions.appendChild(unBtn);
        }
        const insBtn = el('button', { class: 'install', text: '安装' });
        if (stockN < 1) {
          insBtn.setAttribute('disabled', 'disabled');
          insBtn.title = '请先在建造车间生产「' + f.nameCn + '」';
        } else {
          insBtn.title = '安装 ' + f.nameCn;
        }
        insBtn.addEventListener('click', () => {
          const res = installFacility(planet, f.id, account);
          if (!res.ok) {
            if (openModal) openModal({ title: '无法安装：' + f.nameCn, body: '<p class="p-sub">' + res.reason + '</p>' });
            else window.alert && window.alert(res.reason);
            return;
          }
          draw();
        });
        actions.appendChild(insBtn);
        card.appendChild(actions);

        grid.appendChild(card);
      }
      panel.appendChild(grid);
    }

    panel.appendChild(el('div', { class: 'pwr-hint2',
      text: '储电站是单纯的电池（每座储电上限 1e5）：电池存盈余电力、光伏/风电从星球能量池取清洁能（不耗燃料）、火电烧燃料稳定输出。' +
            '电力设施在星球上任意安装，不受槽位限制。缺电时系统按缺口比例用储能放电补齐，储能耗尽则全体耗电建筑按 ratio 降速。' }));

    root.appendChild(panel);
  }

  function openDetail(f, openModal) {
    const body =
      '<div class="pwr-panel">' +
      '<p class="p-sub">' + (f.desc || '') + '</p>' +
      '<p class="p-line"><b>类型</b>：' + ({ storage: '储电', solar: '太阳能', wind: '风力', thermal: '火力' })[f.kind] + '（' + f.sizeLabel + '）</p>' +
      '<p class="p-line"><b>造价</b>：' + costText(f.baseCost) + '</p>' +
      '<p class="p-line"><b>工作量</b>：' + fmtNum(f.work) + '</p>' +
      '<p class="p-line"><b>效果</b>：' + effectText(f) + '</p>' +
      (f.kind === 'thermal' ? '<p class="p-line"><b>燃料</b>：' + f.fuel + '，每座 ' + fmtRateBody(f.fuelPerSec) + '</p>' : '') +
      '</div>';
    if (openModal) openModal({ title: f.nameCn, body });
    else window.alert && window.alert(f.nameCn + '\n' + (f.desc || ''));
  }

  draw();

  // 面板是否还挂在页面上（切换 tab 后 root 内容会被清空，此时停掉计时器）
  function isMounted() {
    if (typeof root.querySelector === 'function') return !!root.querySelector('.pwr-panel');
    return true;
  }

  // 1 秒刷新数字
  if (root._pwrTimer) { clearInterval(root._pwrTimer); root._pwrTimer = null; }
  root._pwrTimer = setInterval(() => {
    if (!isMounted()) { clearInterval(root._pwrTimer); root._pwrTimer = null; return; }
    draw();
  }, 1000);
}

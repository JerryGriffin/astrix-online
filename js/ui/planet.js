// 星球界面：顶部信息条、底部菜单与各 tab 面板（Astrix）
//
// ============================================================================
// v0.0.6 改动
// ============================================================================
// 1. 顶栏的「能量」不再读星球**静态初值**（planet.power.totalEnergy），
//    改读实例上的**实时能量池** `inst.energy.total / inst.energy.max`——它会被
//    太阳辐射缓慢回充、被清洁能源发电扣减，是个会动的数字。顶栏因此加了 1 秒刷新。
// 2. 顶栏新增「电力」一项，显示当前电力降速比（100% = 电力充足；不足则标红）。
// 3. 底部菜单新增「电力」tab（储电站与设施，js/ui/power.js）。
// 4. 底部菜单的「殖民」占位 tab 被 **「星球选择」** 取代（需求 R13）：
//    它只在**造出船坞之后**才出现，用于管理各殖民地的发展（js/ui/colony.js）。
import { PLANETS } from '../data/planets.js?v=26.4';
import { getPlanetByCode as _idxGetPlanet } from '../data/index.js?v=26.4';
import { STATE, currentAccount, getPlanetInstance, buildingCount } from '../core/state.js?v=26.4';
import { fmtNum } from '../core/format.js?v=26.4';
import { renderInventory } from './inventory.js?v=26.4';
import { renderResearch } from './research.js?v=26.4';
import { renderShipyard } from './shipyard.js?v=26.4';
// v0.0.92：舰队编队 / 星际指令 / 殖民管理 / 商店星
import { renderFleet as renderFleetPage } from './fleet.js?v=26.4';
import { renderBuildings } from './buildings.js?v=26.4';
import { renderDesign } from './design.js?v=26.4';

// 优先走数据层 index.js 的查询函数（数据层修正后生效），失败则直接扫描 PLANETS 兜底，
// 以兼容不同字段命名（id/code、name/nameCn）。
function resolvePlanet(code) {
  return (_idxGetPlanet && _idxGetPlanet(code)) || PLANETS.find((p) => p.id === code || p.code === code) || null;
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
}

export function renderPlanet(root, ctx) {
  const { openModal, closeModal, planetCode, onBack } = ctx;
  const planet = resolvePlanet(planetCode);
  const account = currentAccount();
  if (!planet || !account) {
    root.innerHTML = '<p class="muted" style="padding:24px">星球或账号数据缺失。</p>';
    return;
  }

  // 取星球实例（人口、幸福度、能量池、电力等运行时状态都在实例上，静态数据只是初值）
  const inst = getPlanetInstance(planetCode);
  const src = inst || planet;

  // 兼容两种数据字段命名（name/nameCn、desc/description、power.total/totalEnergy）
  const nameCn = planet.nameCn ?? planet.name ?? planetCode;
  const ownedCode = account.planetsOwned[0] || (planetCode + '1');

  // v0.0.9：顶栏不再显示「能量」一项（设计者要求整项去掉），故删除能量池的实时读法。
  //   电力降速比仍在（readPower），其余顶栏项保持不动。
  const readPower = () => (inst && inst.powerInfo) || null;
  const readPop = () => (src.population) || planet.population || { total: 0, available: 0 };
  const readHappiness = () => (typeof src.happiness === 'number' ? src.happiness : (planet.happiness ?? 1));

  root.innerHTML = '';
  root.className = 'screen screen-planet';

  // ===== 顶部信息条 =====
  // v0.0.6：人力 / 幸福度 / 能量 / 电力都改成「挂引用 + 每秒只改文本」，
  //   否则太阳辐射一回充，顶栏那个静止的能量数字会立刻显得像坏了。
  const topbar = document.createElement('header');
  topbar.className = 'planet-topbar';
  const inner = document.createElement('div');
  inner.className = 'topbar-inner';

  const makeItem = (label) => {
    const box = document.createElement('div');
    box.className = 'tb-item';
    const lb = document.createElement('span');
    lb.className = 'tb-label';
    lb.textContent = label;
    const val = document.createElement('span');
    val.className = 'tb-val';
    box.append(lb, val);
    return { box, val };
  };

  const itAccount = makeItem('账号');
  itAccount.val.textContent = account.name;
  const itPlanet = makeItem('星球');
  itPlanet.val.innerHTML = escapeHtml(nameCn) + ' <span class="muted">' + escapeHtml(ownedCode) + '</span>';
  const itLabor = makeItem('人力');
  const itHappy = makeItem('幸福度');
  const itPower = makeItem('电力');
  // v0.0.91：顶栏新增「独立倾向」一项（读 inst.independence，取不到按 0；母星应为 0）。
  //   不带单位符号；>0.5 红色警示 / >0.2 橙色 / 否则次要色（muted）。
  const itIndep = makeItem('独立倾向');

  // v0.0.9：顶栏「能量」整项去掉（设计者要求），不再渲染。其余项保持不动。
  inner.append(itAccount.box, itPlanet.box, itLabor.box, itHappy.box, itPower.box, itIndep.box);
  topbar.appendChild(inner);

  // 顶栏刷新（只改文本，不重建节点）
  function refreshTopbar() {
    const pop = readPop();
    itLabor.val.textContent = fmtNum(pop.available) + ' / ' + fmtNum(pop.total);
    itHappy.val.textContent = Math.round(readHappiness() * 100) + '%';
    const pw = readPower();
    if (pw && Number.isFinite(pw.ratio)) {
      const pct = Math.round(pw.ratio * 100);
      itPower.val.textContent = pct + '%';
      itPower.val.setAttribute('style', pct >= 100 ? 'color:#9FE1CB' : 'color:#f09595');
      itPower.val.title = pct >= 100 ? '电力充足' : '电力不足，全部耗电建筑按此比例降速运行';
    } else {
      itPower.val.textContent = '—';
    }
    // 独立倾向：inst.independence 取不到按 0；>0.5 红 / >0.2 橙 / 否则次要色（muted）
    const indep = Number(inst && inst.independence) || 0;
    itIndep.val.textContent = (indep === 0 ? '0' : indep.toFixed(2));
    const indepColor = indep > 0.5 ? '#f09595' : indep > 0.2 ? '#ffc46b' : '#7d8a97';
    itIndep.val.setAttribute('style', 'color:' + indepColor);
  }
  refreshTopbar();

  // 内容区
  const content = document.createElement('main');
  content.className = 'planet-content';
  const contentInner = document.createElement('div');
  contentInner.className = 'content-inner';
  content.appendChild(contentInner);

  // ===== 底部菜单 =====
  const bottom = document.createElement('nav');
  bottom.className = 'planet-bottombar';

  // v0.0.6（需求 R13）：「星球选择」只在造出船坞之后才出现在菜单里。
  //   原来这里挂的是个纯占位的「殖民」tab（点了只显示「尚未开放」），
  //   现在由真正能用的「星球选择」取代它，避免两个含义重叠的入口并存。
  const hasDock = buildingCount(inst, 'dock') > 0;
  // v0.2.4：军队 tab 恒显示（未研究「单兵武器 t_m1」时军队页内提示需解锁的科技，不再藏按钮）。
  const tabs = [
    { key: 'inv', label: '物品栏' },
    { key: 'pop', label: '人力' },
    { key: 'res', label: '科研' },
    { key: 'build', label: '建筑' },
    { key: 'power', label: '电力' },     // v0.0.6 新增：储电站与设施
    { key: 'fleet', label: '舰队' },
    { key: 'army', label: '军队' },
  ];
  // v0.2.0：星际（云服务跨玩家）与「星球选择」在造出船坞后才进入菜单。
  // v0.2.1：星际仅在线模式开放（离线模式只经营本地殖民地，无星际 tab）；
  //   在线模式用「星际」承载殖民地管理，不再有独立的「星球选择」tab。
  // v0.2.6：1936 剧本存档增加「国策」页（国策树 + 海域）
  if (account && account.scenario === 'hoi1936') {
    tabs.push({ key: 'hoi', label: '国策' });
  }
  if (hasDock) {
    if (STATE.mode === 'online') {
      tabs.push({ key: 'galaxy', label: '星际' });
    } else {
      tabs.push({ key: 'colony', label: '星球选择' });
    }
  }

  const tabBtns = {};
  tabs.forEach((t) => {
    const b = document.createElement('button');
    b.className = 'tab-btn';
    b.textContent = t.label;
    b.addEventListener('click', () => selectTab(t.key));
    tabBtns[t.key] = b;
    bottom.appendChild(b);
  });
  const back = document.createElement('button');
  back.className = 'tab-btn tab-back';
  back.textContent = '返回主界面';
  back.addEventListener('click', () => onBack());
  bottom.appendChild(back);

  root.append(topbar, content, bottom);

  function labelOf(key) {
    return (tabs.find((t) => t.key === key) || {}).label || '';
  }

  // v0.0.7：当前选中的 tab 与「重绘当前 tab」回调，供设计面板等子面板在
  // 数据变化后刷新整块（与科研面板顶部研究点刷新是两套机制，互不干扰）。
  let currentTab = 'inv';
  function rerender() { selectTab(currentTab); }

  function selectTab(key) {
    currentTab = key;
    Object.entries(tabBtns).forEach(([k, b]) => b.classList.toggle('active', k === key));
    if (key === 'inv') {
      renderInventory(contentInner, { openModal, closeModal, planetCode, account });
    } else if (key === 'res') {
      renderResearch(contentInner, { openModal, closeModal, planetCode, account, planet });
    } else if (key === 'fleet') {
      renderFleet(contentInner);
    } else if (key === 'build') {
      // v0.0.5：建筑面板接入真功能（造价 / 解锁 / 工位占用 / 施工队列）
      // v0.0.6：建筑面板新增「工作内容（配方）选择」——加工类建筑先选配方才开工
      renderBuildings(contentInner, { openModal, closeModal, planetCode, account, planet: getPlanetInstance(planetCode) });
    } else if (key === 'pop') {
      // 人力模块（js/ui/population.js）用动态 import 接入，
      // 即使该文件异常，也只会在点击时占位，不会拖垮整个应用。
      showPopulation(contentInner);
    } else if (key === 'power') {
      showPower(contentInner);
    } else if (key === 'colony') {
      showColony(contentInner);
    } else if (key === 'army') {
      // v0.2.0：军队页（组装生产线 / 蓝图 / 建制军队）
      showArmy(contentInner);
    } else if (key === 'hoi') {
      // v0.2.6：1936 剧本国策与海域面板
      showHoi(contentInner);
    } else if (key === 'galaxy') {
      // v0.2.0：星际页（云服务跨玩家：登录 / 快照发布 / 收件箱 / 贸易·进攻）
      showGalaxy(contentInner);
    } else {
      contentInner.innerHTML =
        `<div class="placeholder glass">` +
        `<div class="ph-title">v0.0.6 尚未开放</div>` +
        `<div class="ph-sub muted">「${escapeHtml(labelOf(key))}」功能将在后续版本推出。</div></div>`;
    }
  }

  // 统一的「动态 import 一个面板模块」加载器：
  // 面板文件即使缺失或抛错，也只在该 tab 内占位，不会拖垮整个应用。
  async function showPanel(root, modPath, fnName, args, title) {
    root.innerHTML = '<div class="placeholder glass"><div class="ph-title">' + escapeHtml(title) + '加载中…</div></div>';
    try {
      const mod = await import(/* webpackIgnore: true */ modPath);
      const fn = mod[fnName] || mod.default;
      if (typeof fn !== 'function') {
        root.innerHTML = '<div class="placeholder glass"><div class="ph-title">' + escapeHtml(title) + '模块未就绪</div>'
          + '<div class="ph-sub muted">' + escapeHtml(fnName) + ' 未导出。</div></div>';
        return;
      }
      fn(...args);
    } catch (e) {
      root.innerHTML = '<div class="placeholder glass"><div class="ph-title">' + escapeHtml(title) + '加载失败</div>'
        + '<div class="ph-sub muted">' + escapeHtml(e.message) + '</div></div>';
    }
  }

  // 动态接入人力面板：renderPopulation(contentRoot, currentPlanet)
  function showPopulation(root) {
    return showPanel(root, './population.js?v=26.4', 'renderPopulation', [root, getPlanetInstance(planetCode)], '人力系统');
  }

  // v0.0.6：电力面板（储电站、12 项电力设施、发电/耗电/储能结算）
  function showPower(root) {
    return showPanel(root, './power.js?v=26.4', 'renderPower', [root, {
      openModal, closeModal, planetCode, account, planet: getPlanetInstance(planetCode),
    }], '电力系统');
  }

  // v0.0.6（需求 R13）：星球选择 / 殖民地管理
  function showColony(root) {
    return showPanel(root, './colony.js?v=26.4', 'renderColony', [root, {
      openModal, closeModal, planetCode, account, planet: getPlanetInstance(planetCode),
      // v0.1.1（需求 17）：透传给 main.js 的真实路由（nav.showPlanet(code)）。
      //   此前这里是「目标 ≠ 当前就 onBack 回主界面」的桩，星球切换从未生效。
      onEnterPlanet: (code) => {
        if (code && code !== planetCode && typeof ctx.onEnterPlanet === 'function') {
          ctx.onEnterPlanet(code);
        }
      },
    }], '星球选择');
  }

  // v0.2.0：军队页（组装生产线 / 三张蓝图 / 建制军队）。内部有 t_m5 + 制造车间门禁。
  // v0.2.6：1936 剧本国策 / 海域面板（异步动态 import）
  function showHoi(root) {
    return showPanel(root, './hoi.js?v=26.4', 'renderHoi', [root, { account, planetCode, openModal, closeModal }], '国策');
  }

  function showArmy(root) {
    return showPanel(root, './army.js?v=26.4', 'renderArmyPage', [root, {
      openModal, closeModal, planetCode, account, planet: getPlanetInstance(planetCode),
    }], '军队系统');
  }

  // v0.2.0：星际页（云服务跨玩家）。ensureReady 懒加载 SDK，异常只影响本 tab。
  // v0.2.1：透传 onEnterPlanet —— 在线模式星际页内嵌了殖民地管理，点「进入」要切到该星球。
  function showGalaxy(root) {
    return showPanel(root, './galaxy.js?v=26.4', 'renderGalaxy', [root, {
      openModal, closeModal, planetCode, account,
      onEnterPlanet: (code) => {
        if (code && code !== planetCode && typeof ctx.onEnterPlanet === 'function') {
          ctx.onEnterPlanet(code);
        }
      },
    }], '星际');
  }

  // v0.0.8：舰队面板。顶部分支「舰船 / 设计」——「设计」是造出船坞后才出现的子分支，
  //   未建船坞时只显示「舰船」（且船坞面板本身会给「船坞尚未建成」门槛提示），不留设计占位。
  function renderFleet(container) {
    container.innerHTML = '';
    const subNav = document.createElement('div');
    subNav.className = 'fleet-subnav';
    const subContent = document.createElement('div');
    subContent.className = 'fleet-subcontent';
    container.append(subNav, subContent);

    // 显示条件：inst.buildings.dock > 0 才出现「设计」入口（与「星球选择」同源口径）
    const hasDock = buildingCount(inst, 'dock') > 0;
    // v0.0.92：「舰队与殖民」子页提供编队 / 五指令 / 殖民管理 / 商店星
    const defs = [{ key: 'ship', label: '舰船' }, { key: 'expedition', label: '舰队与殖民' }];
    // v0.2.1：设计子页改名「设计与建造」
    if (hasDock) defs.push({ key: 'design', label: '设计与建造' });

    const btns = {};
    defs.forEach((d) => {
      const b = document.createElement('button');
      b.className = 'fleet-subnav-btn';
      b.textContent = d.label;
      b.addEventListener('click', () => selectFleetTab(d.key));
      btns[d.key] = b;
      subNav.appendChild(b);
    });

    function selectFleetTab(k) {
      Object.entries(btns).forEach(([kk, b]) => b.classList.toggle('active', kk === k));
      subContent.innerHTML = '';
      if (k === 'expedition') {
        renderFleetPage(subContent, { openModal, closeModal, planetCode, account, rerender: () => selectFleetTab('expedition') });
      } else if (k === 'design') {
        // 设计子面板刷新时只重绘自己（rerender 指向本子分支），不会跳回舰船
        renderDesign(subContent, { openModal, closeModal, planetCode, account, rerender: () => selectFleetTab('design') });
      } else {
        renderShipyard(subContent, { openModal, closeModal, planetCode, account, planet: getPlanetInstance(planetCode) });
      }
    }
    selectFleetTab('ship');
  }

  // 顶栏每秒刷新，切走星球界面后自动清理
  if (root._tbTimer) { clearInterval(root._tbTimer); root._tbTimer = null; }
  root._tbTimer = setInterval(() => {
    if (!root.querySelector || !root.querySelector('.planet-topbar')) {
      clearInterval(root._tbTimer); root._tbTimer = null; return;
    }
    refreshTopbar();
  }, 1000);

  selectTab('inv');
}

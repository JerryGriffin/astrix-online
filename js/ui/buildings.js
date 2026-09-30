// 建筑面板 UI（Astrix v0.0.7，零依赖原生 ES module）
// 列出全部「已解锁」建筑、按科技解锁状态区分、显示已有座数与工位占用、
// 按 growth 递增的下一座造价、施工进度条，并提供「建造 / 取消」操作。
// 样式内联注入，不污染 css/ 目录。
//
// ============================================================================
// v0.0.7 改动：生产安排迁移到「人力」面板
// ============================================================================
// 设计者要求：
//   1. 删除建筑卡片上的「选择工作内容」整块 UI（配方挑选 + 选好即运转）。
//      生产安排改为在「人力」面板新建「生产线」：先选建筑、再选生产内容。
//   2. 科研所（id=lab）永远置顶。
//   3. unlockTech 非空且对应科技未研究的建筑，整条不渲染（不留占位）。
//   4. 配方的投入产出数量标注移到「人力」面板的生产内容选择处（见 population.js）。
//
// 与人力系统的关系：
//   建筑提供工位 → 人力面板按建筑分组分配人 → 分配了「建筑工」才有人施工（硬门槛）。

import { BUILDINGS, BUILDING_BY_ID, CATEGORIES, buildingCost } from '../data/buildings.js?v=21.17';
import { fmtNum, fmtTime, fmtRateBody, richText } from '../core/format.js?v=21.17';
import {
  getBuildingCounts, buildingCount, costOfNext, isBuildingUnlocked,
  startBuild, cancelBuild, buildQueueOf, BUILD_QUEUE_MAX, currentAccount,
} from '../core/state.js?v=21.17';
import { buildingSlots, assignedToBuilding, freeSlots } from '../core/population.js?v=21.17';
import { buildRateOf, buildBlockReason } from '../core/construction.js?v=21.17';

const CSS = `
  .bld-panel { font-family: system-ui, sans-serif; color: #e8eef2; padding: 12px; box-sizing: border-box; }
  .bld-status { background: #1b2530; border-radius: 10px; padding: 10px 12px; margin-bottom: 10px; font-size: 13px; line-height: 1.9; }
  .bld-status .k { opacity: .7; }
  .bld-status .ok { color: #9FE1CB; font-weight: 600; }
  .bld-status .bad { color: #f09595; font-weight: 600; }
  .bld-move { background: #16202b; border: 1px solid #2a3645; border-left: 3px solid #2d5b7a; border-radius: 10px;
    padding: 9px 12px; margin-bottom: 10px; font-size: 12px; line-height: 1.7; color: #cfe2f2; }
  .bld-queue { background: #16202b; border: 1px solid #2a3645; border-radius: 10px; padding: 8px 12px; margin-bottom: 12px; }
  .bld-qhead { font-weight: 600; font-size: 13px; margin-bottom: 6px; }
  .bld-qitem { margin-bottom: 8px; }
  .bld-qrow { display: flex; align-items: center; gap: 8px; font-size: 12px; }
  .bld-qrow .qname { flex: 1 1 auto; min-width: 0; }
  .bld-qrow button { min-height: 34px; min-width: 56px; border: none; border-radius: 8px; background: #3a2a2a; color: #ffd9d9; cursor: pointer; }
  .bld-bar { height: 8px; border-radius: 4px; background: #0f1720; overflow: hidden; margin-top: 4px; }
  .bld-bar > i { display: block; height: 100%; background: #5DCAA5; }
  .bld-cat { margin-bottom: 12px; border: 1px solid #2a3645; border-radius: 10px; overflow: hidden; }
  .bld-cat > h3 { margin: 0; padding: 9px 12px; background: #16202b; font-size: 13px; font-weight: 600; }
  .bld-row { display: flex; flex-wrap: wrap; align-items: center; gap: 6px 10px; padding: 9px 12px; border-top: 1px solid #223040; min-height: 44px; }
  .bld-row .b-main { flex: 1 1 190px; min-width: 0; }
  .bld-row .b-name { font-weight: 600; }
  .bld-row .b-name .own { color: #9FE1CB; margin-left: 6px; font-size: 12px; }
  .bld-row .b-desc { font-size: 11px; opacity: .6; line-height: 1.45; }
  .bld-row .b-power { font-size: 12px; opacity: .85; margin-top: 2px; }
  .bld-row .b-power .out { color: #9FE1CB; }
  .bld-row .b-power .draw { color: #f0c895; }
  .bld-row .b-cost { font-size: 12px; opacity: .85; }
  .bld-row .b-slots { font-size: 12px; }
  .bld-row .b-slots .free { color: #9FE1CB; font-weight: 600; }
  .bld-row .b-slots .full { color: #f09595; font-weight: 600; }
  .bld-row button.build { min-height: 40px; min-width: 72px; border: none; border-radius: 8px; background: #2d5b7a; color: #fff; font-weight: 600; cursor: pointer; }
  .bld-row button.build[disabled] { background: #28323d; color: #7d8a97; cursor: not-allowed; }
  .bld-hint { font-size: 12px; opacity: .6; padding: 2px 2px 12px; line-height: 1.6; }
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

// 造价对象 → 「石头 800 · 泥土 500」
function costText(cost) {
  return Object.entries(cost || {})
    .map(([k, v]) => k + ' ' + fmtNum(v))
    .join(' · ') || '免费';
}

export function renderBuildings(root, ctx) {
  const planet = ctx && ctx.planet ? ctx.planet : null;
  const account = (ctx && ctx.account) || currentAccount();
  const openModal = ctx && ctx.openModal;
  if (!planet) {
    root.innerHTML = '<p class="muted">星球数据缺失。</p>';
    return;
  }

  root.innerHTML = '';
  root.appendChild(el('style', { text: CSS }));

  function draw() {
    root.innerHTML = '';
    root.appendChild(el('style', { text: CSS }));

    const panel = el('div', { class: 'bld-panel' });
    const counts = getBuildingCounts(planet);
    const pop = planet.pop;
    const queue = buildQueueOf(planet);

    // 施工不吃电力降速（否则开局无电时连第一座发电厂都造不出来），这里只报人手门槛
    const pw = planet.powerInfo || null;
    const ratio = pw && Number.isFinite(pw.ratio) ? pw.ratio : 1;
    // v0.1.2（需求 19）：带上 account，展示的施工速率要与实际一致（吃「建筑施工」升级）
    const rate = buildRateOf(pop, counts, account);
    const block = buildBlockReason(pop, counts);

    // ---- 施工状态 ----
    const status = el('div', { class: 'bld-status' });
    status.appendChild(el('div', {}, [
      el('span', { class: 'k', text: '施工能力 ' }),
      el('span', { class: rate > 0 ? 'ok' : 'bad', text: rate > 0 ? fmtRateBody(rate * 60) + ' 人·秒/分钟' : '停摆' }),
      el('span', { class: 'k', text: '　施工队列 ' + queue.length + ' / ' + BUILD_QUEUE_MAX }),
    ]));
    const blockText = block || '已满足：建筑工厂有人在工作（施工由人力驱动，不受电力影响）';
    status.appendChild(el('div', {}, [
      el('span', { class: 'k', text: '门槛 ' }),
      el('span', { class: block ? 'bad' : 'ok', text: blockText }),
    ]));
    if (ratio < 1) {
      status.appendChild(el('div', {}, [
        el('span', { class: 'k', text: '电力 ' }),
        el('span', { class: 'bad', text: Math.round(ratio * 100) + '%　加工类建筑会按此比例降速，施工不受影响' }),
      ]));
    }
    panel.appendChild(status);

    // v0.0.7：生产安排已迁移到「人力」面板
    panel.appendChild(el('div', { class: 'bld-move',
      text: '生产安排已迁移到「人力」面板：在那里新建生产线（先选建筑、再选生产内容）。' }));

    // ---- 施工队列 ----
    if (queue.length) {
      const box = el('div', { class: 'bld-queue' });
      box.appendChild(el('div', { class: 'bld-qhead', text: '正在施工（工程总装序列）' }));
      queue.forEach((item, i) => {
        const pct = Math.min(100, item.work > 0 ? (item.progress / item.work * 100) : 0);
        const left = rate > 0 ? (item.work - item.progress) / rate : Infinity;
        const row = el('div', { class: 'bld-qitem' });

        let stage = '🏗️ 阶段一：地质勘探与耐压地基开挖';
        if (pct >= 75) stage = '⚡ 阶段三：超导管网并网与设备总调测';
        else if (pct >= 35) stage = '⚙️ 阶段二：合金骨架吊装与抗辐射封装';

        row.appendChild(el('div', { class: 'bld-qrow' }, [
          el('span', { class: 'qname', text: `${item.nameCn} · ${stage} (${pct.toFixed(1)}%) · 剩余 ${Number.isFinite(left) ? fmtTime(left) : '∞（无人施工）'}` }),
          (() => {
            const b = el('button', { text: '取消' });
            b.addEventListener('click', () => { cancelBuild(planet, i); draw(); });
            return b;
          })(),
        ]));
        const bar = el('div', { class: 'bld-bar' });
        bar.appendChild(el('i', { style: `width:${pct}%;background:linear-gradient(90deg, #5DCAA5, #38bdf8);box-shadow:0 0 6px #5DCAA5;` }));
        row.appendChild(bar);
        box.appendChild(row);
      });
      panel.appendChild(box);
    }

    // ---- 单张建筑卡 ----
    function renderRow(b) {
      const n = buildingCount(planet, b.id);
      const cost = costOfNext(planet, b.id);
      const slots = buildingSlots(b.id, counts);
      const assigned = assignedToBuilding(pop, b.id);
      const free = freeSlots(pop, b.id, counts);

      const main = el('div', { class: 'b-main' });
      main.appendChild(el('div', { class: 'b-name' }, [
        el('span', { text: b.nameCn }),
        n > 0 ? el('span', { class: 'own', text: '已有 ' + fmtNum(n) + ' 座' }) : null,
      ]));
      main.appendChild(el('div', { class: 'b-desc', html: richText(b.desc || '') }));
      // 发电 / 耗电 静态信息（文案不带单位，见 v0.0.7 去单位约定）
      if (b.powerOut > 0 || b.powerDraw > 0) {
        const parts = [];
        if (b.powerOut > 0) parts.push(el('span', { class: 'out', text: '发电 ' + fmtNum(b.powerOut) }));
        if (b.powerDraw > 0) parts.push(el('span', { class: 'draw', text: '耗电 ' + fmtNum(b.powerDraw) }));
        main.appendChild(el('div', { class: 'b-power' }, parts));
      }

      const slotBox = el('div', { class: 'b-slots' });
      if (!(Number(b.jobs) > 0)) {
        // 房屋（提供庇护）与储电站（无人值守）都不提供工位
        slotBox.appendChild(el('span', { class: 'muted',
          text: b.shelter ? '提供庇护，不提供工位' : '无人值守，不提供工位' }));
      } else if (n > 0) {
        slotBox.appendChild(el('span', { html:
          `工位 ${fmtNum(slots)} · 已指派 ${fmtNum(assigned)} · <span class="${free > 0 ? 'free' : 'full'}">空闲 ${fmtNum(free)}</span>` }));
      } else {
        slotBox.appendChild(el('span', { class: 'muted', text: `每座 ${fmtNum(b.jobs)} 工位` }));
      }

      const costBox = el('div', { class: 'b-cost', text: '造价 ' + costText(cost) });

      const btn = el('button', { class: 'build', text: n > 0 ? '再建一座' : '建造' });
      const disabled = rate <= 0 || queue.length >= BUILD_QUEUE_MAX;
      if (disabled) btn.setAttribute('disabled', 'disabled');
      btn.addEventListener('click', () => {
        const res = startBuild(planet, b.id, account);
        if (!res.ok) {
          if (openModal) openModal({ title: '无法建造：' + b.nameCn, body: '<p class="detail-desc">' + res.reason + '</p>' });
          else window.alert && window.alert(res.reason);
          return;
        }
        draw();
      });

      return el('div', { class: 'bld-row' }, [main, slotBox, costBox, btn]);
    }

    // v0.0.7：科研所（id=lab）永远置顶
    const lab = BUILDING_BY_ID['lab'];
    if (lab && isBuildingUnlocked(planet, 'lab', account)) {
      const wrap = el('div', { class: 'bld-cat' });
      wrap.appendChild(el('h3', { text: '科研（置顶）' }));
      wrap.appendChild(renderRow(lab));
      panel.appendChild(wrap);
    }

    // ---- 按类别列建筑（排除 lab；未解锁的整条不渲染）----
    const catOrder = Object.keys(CATEGORIES);
    for (const cat of catOrder) {
      const list = BUILDINGS.filter((b) => b.category === cat && b.id !== 'lab');
      const visible = list.filter((b) => isBuildingUnlocked(planet, b.id, account));
      if (!visible.length) continue;
      const wrap = el('div', { class: 'bld-cat' });
      wrap.appendChild(el('h3', { text: CATEGORIES[cat] || cat }));
      for (const b of visible) wrap.appendChild(renderRow(b));
      panel.appendChild(wrap);
    }

    panel.appendChild(el('div', { class: 'bld-hint',
      text: '施工是硬门槛：必须先在「人力」里把工人分配进建筑工厂当建筑工，工地上才会开工；没人则施工速度恒为 0。'
        + '造价随已有座数按增长率递增，取消施工全额退还材料。'
        + '加工类建筑（熔炉、高炉、化工、制造车间等）的生产安排已迁移到「人力」面板——在那里新建生产线（先选建筑、再选生产内容）。' }));

    root.appendChild(panel);
  }

  draw();

  // 面板是否还挂在页面上（切换 tab 后 root 内容会被清空，此时停掉计时器）
  function isMounted() {
    if (typeof root.querySelector === 'function') return !!root.querySelector('.bld-panel');
    return true;
  }

  // 定时刷新：只在有工程在施工时重绘。
  // 多了一个防护——如果玩家正在操作面板上的下拉框/按钮，这一次重绘就跳过。
  if (root._bldTimer) { clearInterval(root._bldTimer); root._bldTimer = null; }
  // prevHadQueue 记录「上一次重绘时队列是否非空」。
  // 旧逻辑只在队列非空时才重绘：施工完成的最后一刻队列被清空（advanceConstruction 里 shift），
  // 于是后续不再触发重绘，进度条整块（“正在施工”标题 + 进度条）会一直挂在面板上，下次刷新也不会消失。
  // 修正：队列从「有」变「空」的那一次也必须补一次重绘，把进度条清掉并刷新建筑数量。
  let prevHadQueue = buildQueueOf(planet).length > 0;
  root._bldTimer = setInterval(() => {
    if (!isMounted()) { clearInterval(root._bldTimer); root._bldTimer = null; return; }
    const ae = (typeof document !== 'undefined' && document.activeElement) || null;
    if (ae && typeof root.contains === 'function' && root.contains(ae)) return;   // 正在操作，别打断
    const q = buildQueueOf(planet);
    const had = q.length > 0;
    if (had || prevHadQueue) {   // 队列非空时持续刷新；刚清空时也补刷新一次以移除进度条
      prevHadQueue = had;
      draw();
    }
  }, 1000);
}

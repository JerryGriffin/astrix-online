// 设计面板（Astrix v0.0.7）
//
// ============================================================================
// 职责
// ============================================================================
// 星球内菜单「设计」：玩家在这里**规划新飞船**并把它存进账号的 acc.blueprints。
//   · 选外壳（5 种大小），为外壳与每个部件从物品栏已有材料中自选材料；
//   · 装引擎 / 武器 / 船上设施，实时显示容量占用、总质量、结构强度、MK 等级；
//   · 按外壳大小消耗研究点（超小 2000 / 小 5000 / 中 12000 / 大 30000 / 超大 60000），
//     研究点不足时「设计」按钮禁用并显示原因；
//   · 设计完成把蓝图存进 acc.blueprints（用 genBlueprintId 生成 id）并设为 acc.blueprint。
//
// 风格与 js/ui/research.js 一致（el / fac-row / fac-line1..4 / btn btn-primary），
// 蓝图编辑器复用 js/ui/shipyard.js 的 bp-* 类。所有计算都在 js/core/shipyard.js。
//
// 本文件不碰 js/ui/planet.js：在 planet.js 里挂一个「设计」tab 接 renderDesign 即可
// （接线代码见向设计者汇报的「planet.js 接线」一节）。

import {
  HULLS, ENGINES, WEAPONS, FACILITIES,
  DEFAULT_MATERIAL,
} from '../data/ship_parts.js?v=49.1';
import {
  evaluateBlueprint, materialMul, materialOptionsFor,
  ensureBlueprints, genBlueprintId, kindOfHull, HULL_RP_COST,
  equipmentList, emptyBlueprint, shipBuildCheck,
} from '../core/shipyard.js?v=49.1';
import { getPlanetInstance, ownedOf, getBuildingCounts, spendOwned } from '../core/state.js?v=49.1';
import { lineSlotInfo, freeLaborOf, materialLookup } from '../core/production.js?v=49.1';
import { fmtNum } from '../core/format.js?v=49.1';
// v0.4.7：el() 收敛到 ui/common.js（此前本文件自带一份；全项目共 14 份、两种不兼容签名，
//   v0.3.2「列强区块不显示」即源于把 A 型调用写进了 B 型文件）
import { el } from './common.js?v=49.1';
// R4：蓝图编辑器（含「建造」开 dock 线）从 shipyard.js 的舰船分支迁到「设计」分支。
//   这里只复用函数，编辑器本体仍定义在 shipyard.js（其天然的归属），按其渲染。
import {
  buildBlueprintEditor, shipBuildBlockReason,
  materialBuildBlockReason, createDockLine, blueprintMaterialNeeds,
} from './shipyard.js?v=49.1';

function esc(s) {
  return String(s).replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
}

function makeSelect(options, value, onChange) {
  const sel = document.createElement('select');
  sel.className = 'bp-select';
  for (const [v, label] of options) {
    const o = document.createElement('option');
    o.value = v;
    o.textContent = label;
    sel.appendChild(o);
  }
  sel.value = value;
  sel.addEventListener('change', () => onChange(sel.value));
  return sel;
}

// v0.1.0：ownedMat 是 renderDesign 内的局部集合，必须由调用方传进来（此前直接引用外层变量 → 未定义报错）
// v0.4.6 需求 11：候选材料改为**全材料**（含自定义化工厂造出来的合金），
//   唯一门槛是不能用气体。MATERIAL_SLOTS 降级为「推荐」标记，只影响排序与提示。
//   旧实现 `.filter(ownedMat.has)` 会把没库存的材料全滤掉 —— 现在只做灰显，不再剔除，
//   这样玩家能提前看到「我造出来的合金在这里能用」。
function makeMaterialSelect(slot, value, onChange, ownedMat, inst) {
  const opts = materialOptionsFor(slot, inst, { lookup: materialLookup(inst) });
  const def = DEFAULT_MATERIAL[slot];
  const rows = opts.map((o) => {
    const tags = [];
    if (o.custom) tags.push('自造');
    if (o.recommended) tags.push('推荐');
    if (ownedMat && !ownedMat.has(o.name)) tags.push('暂无库存');
    const suffix = tags.length ? '· ' + tags.join(' ') : '';
    return [o.name, `${o.name}（结构 ×${o.structMul.toFixed(2)} · 质量 ×${o.massMul.toFixed(2)}${suffix ? ' · ' + suffix : ''}）`];
  });
  // 当前选中的值即使已不在候选里也保留（老蓝图引用了已删除材料时不至于空白）
  if (value && !opts.some((o) => o.name === value)) {
    rows.unshift([value, `${value}（当前蓝图所用）`]);
  }
  return makeSelect(rows, value || def, onChange);
}

function addButton(label, onClick) {
  const b = el('button', 'btn btn-sm bp-add', label);
  b.onclick = onClick;
  return b;
}

function removeButton(onClick) {
  const b = el('button', 'btn btn-sm btn-danger bp-remove', '移除');
  b.onclick = onClick;
  return b;
}

// 设施下拉项文案（只列 4 种船上设施，不含 12 项电力设施）
function facOptionLabel(f) {
  const extra = f.crew ? `载员 ${f.crew}`
    : f.cargoVol ? `货舱 ${f.cargoVol}`
    : f.hangarSlots ? `机位 ${f.hangarSlots}`
    : f.structAdd ? `强度 +${f.structAdd}`
    : '';
  return `${f.nameCn}（占地 ${f.footprint} · ${extra}）`;
}

// 主入口：渲染设计面板到 container。
// ctx 与 renderInventory 同构：{ openModal, closeModal, planetCode, account, rerender }
export function renderDesign(container, ctx) {
  // v0.1.0：planetCode 必须从 ctx 里取出来（此前直接用了未声明的 planetCode → 设计面板一打开就报错）
  const { account, planetCode } = ctx || {};
  if (!account) {
    container.innerHTML = '<div class="placeholder glass"><div class="ph-title">账号数据缺失</div></div>';
    return;
  }
  ensureBlueprints(account);   // 兼容老存档：确保有 acc.blueprints 与当前选中蓝图

  // v0.0.8：设施候选只列玩家当前拥有的（物品栏材料 / 装备栏部件）。
  //   物品栏：ownedOf(inst, mat) > 0；装备栏：equipmentList(inst) 含该部件且 count > 0。
  //   取不到星球实例时退化为「全部可列」（设计入口本就只在造出船坞后出现，inst 必存在）。
  const inst = planetCode ? getPlanetInstance(planetCode) : null;
  // v0.4.6：材料候选表（内置 + 自定义合金），供所有材料下拉复用
  const matLookup = materialLookup(inst);
  const ownedMat = new Set();
  const ownedEquip = new Set();
  if (inst) {
    for (const e of (inst.inventory || [])) {
      if (Number(e.owned) > 0) ownedMat.add(e.mat);
    }
    for (const eq of equipmentList(inst)) {
      if (Number(eq.count) > 0) ownedEquip.add(eq.partId);
    }
  }
  // 设施是否可选：玩家已造出该装备，或拥有该设施所需材料（按 materialSlot 判定）。
  function facAvailable(f) {
    if (ownedEquip.has(f.id)) return true;
    if (f.materialSlot) {
      // v0.4.6：改为「玩家持有**任意**可投料材料」即可选，不再只看硬编码白名单
      const mats = materialOptionsFor(f.materialSlot, inst, { lookup: matLookup }).map((o) => o.name);
      if (mats.some((m) => ownedMat.has(m))) return true;
    }
    return false;
  }

  container.innerHTML = '';
  const wrap = el('div', 'design-wrap');
  const researched = new Set(Array.isArray(account.tech) ? account.tech : []);

  // 草稿（规划中的新飞船）。初始给一个小型外壳 + 1 基础引擎 + 1 乘员仓，方便上手。
  const draft = {
    hullId: 'hull_s_mk1',
    hullMaterial: DEFAULT_MATERIAL.hull,
    engines: [{ id: 'engine_basic', material: DEFAULT_MATERIAL.engine }],
    parts: [{ id: 'fac_crew_mk1', material: null }],
    fuelName: '甲烷',
    altitudeM: 1000,
    planetCode: (ctx && ctx.planetCode) || 'syl',
    nameCn: '自定义飞船',
  };

  // ===== 顶部概览 =====
  const head = el('div', 'res-head glass');
  head.innerHTML =
    '<div class="res-head-item"><span class="res-k">研究点</span>'
    + '<span class="res-v cyan" data-dsn-points>' + fmtNum(account.researchPoints) + '</span></div>'
    + '<div class="res-head-item res-note muted">设计新飞船会按外壳大小消耗研究点。</div>';
  wrap.appendChild(head);

  // ===== 已保存蓝图（设为当前）=====
  const savedBox = el('div', 'dsn-saved');
  savedBox.appendChild(el('div', 'res-section-title', '已保存蓝图（' + account.blueprints.length + '）'));
  if (account.blueprints.length) {
    const row = el('div', 'bp-row');
    row.appendChild(el('span', 'bp-label', '当前'));
    const curId = account.blueprint ? account.blueprint.id : '';
    const sel = makeSelect(
      account.blueprints.map((b) => [b.id, `${b.nameCn}（${b.kind}）`]),
      curId,
      (v) => {
        const b = account.blueprints.find((x) => x.id === v);
        if (b) account.blueprint = b;
        container._designExpanded = false;   // v0.2.1：切换蓝图后默认回到紧凑数值视图
        if (typeof ctx.rerender === 'function') ctx.rerender();
      },
    );
    row.appendChild(sel);
    savedBox.appendChild(row);
  } else {
    savedBox.appendChild(el('p', 'bp-tip muted', '还没有已保存的蓝图。'));
  }
  wrap.appendChild(savedBox);

  // ===== 蓝图设计 / 编辑（R4：从舰船分支迁来）=====
  // 在「设计」页直接编辑当前蓝图（account.blueprint，先 ensureBlueprints 再读，v0.1.1 id 铁律），
  // 并能点「建造」开 dock 造船线（材料校验/扣料在 buildBlueprintEditor 内，见 R19-2）。
  // v0.2.1：已保存蓝图默认只显示数值（容量/质量/航速/强度…），不再罗列具体设施；
  //   点「展开编辑」才显示完整设施 / 材料编辑器与「建造」按钮（expanded 状态挂在 container 上跨重绘保留）。
  const editBox = el('div', 'dsn-edit');
  editBox.appendChild(el('div', 'res-section-title', '蓝图设计 / 编辑（建造）'));
  // 兜底：确保当前蓝图存在且带 id（默认蓝图已带 id；老存档在此补齐）
  ensureBlueprints(account);
  if (!account.blueprint || !account.blueprint.hullId) account.blueprint = emptyBlueprint();
  const isSaved = !!(account.blueprint && account.blueprints.some((b) => b.id === account.blueprint.id));
  const expanded = !!container._designExpanded;
  const counts = getBuildingCounts(inst);
  const blockReason = shipBuildBlockReason(inst, counts);
  const rerenderDesign = () =>
    (typeof ctx.rerender === 'function' ? ctx.rerender() : renderDesign(container, ctx));
  if (isSaved && !expanded) {
    editBox.appendChild(buildCompactSavedCard(account.blueprint, rerenderDesign));
  } else {
    editBox.appendChild(
      buildBlueprintEditor(account, ctx, account.blueprint, researched, rerenderDesign, blockReason),
    );
  }
  wrap.appendChild(editBox);

  // ===== 设计编辑器 =====
  const box = el('div', 'bp-box');
  box.appendChild(el('div', 'res-section-title', '设计新飞船'));

  const hullOptions = HULLS;
  if (!hullOptions.some((h) => h.id === draft.hullId)) draft.hullId = hullOptions[0].id;

  // ---- 名字 ----
  const nameRow = el('div', 'bp-row');
  nameRow.appendChild(el('span', 'bp-label', '名称'));
  const nameInput = document.createElement('input');
  nameInput.type = 'text';
  nameInput.className = 'bp-input bp-input-wide';
  nameInput.value = draft.nameCn;
  nameInput.addEventListener('change', () => { draft.nameCn = nameInput.value.trim() || '自定义飞船'; });
  nameRow.appendChild(nameInput);
  box.appendChild(nameRow);

  // ---- 外壳 ----
  const hullRow = el('div', 'bp-row');
  hullRow.appendChild(el('span', 'bp-label', '外壳'));
  const costHint = el('span', 'bp-unit muted');
  hullRow.appendChild(makeSelect(hullOptions.map((h) => [h.id, `${h.nameCn}（容量 ${h.capacity} · 槽位 ${h.slots}）`]), draft.hullId, (v) => {
    draft.hullId = v;
    draft.hullMaterial = DEFAULT_MATERIAL.hull;
    render();
  }));
  hullRow.appendChild(makeMaterialSelect('hull', draft.hullMaterial, (v) => { draft.hullMaterial = v; render(); }, ownedMat, inst));
  hullRow.appendChild(costHint);
  box.appendChild(hullRow);

  // ---- 引擎 ----
  box.appendChild(el('div', 'bp-sub', '引擎（最多 4 台）'));
  const renderEngines = () => {
    engineWrap.innerHTML = '';
    (draft.engines || []).forEach((eng, i) => {
      const row = el('div', 'bp-row');
      row.appendChild(el('span', 'bp-label', '引擎' + (i + 1)));
      row.appendChild(makeSelect(ENGINES.map((e) => [e.id, `${e.nameCn}（推力 ${e.thrust} · ${e.mass}）`]), eng.id, (v) => {
        eng.id = v; render();
      }));
      row.appendChild(makeMaterialSelect('engine', eng.material, (v) => { eng.material = v; render(); }, ownedMat, inst));
      row.appendChild(removeButton(() => { draft.engines.splice(i, 1); render(); }));
      engineWrap.appendChild(row);
    });
    if ((draft.engines || []).length < 4) {
      engineWrap.appendChild(addButton('+ 加一台引擎', () => {
        draft.engines.push({ id: ENGINES[0] ? ENGINES[0].id : 'engine_basic', material: DEFAULT_MATERIAL.engine });
        render();
      }));
    }
  };
  const engineWrap = el('div', 'dsn-group');
  box.appendChild(engineWrap);

  // ---- 武器 ----
  box.appendChild(el('div', 'bp-sub', '舰载武器'));
  const renderWeapons = () => {
    weaponWrap.innerHTML = '';
    const weaponParts = (draft.parts || []).map((p, i) => ({ p, i })).filter(({ p }) => p.id.startsWith('wpn_'));
    weaponParts.forEach(({ p, i }) => {
      const row = el('div', 'bp-row');
      row.appendChild(el('span', 'bp-label', '武器'));
      row.appendChild(makeSelect(WEAPONS.map((w) => [w.id, `${w.nameCn}（伤害 ${w.damage} · 占地 ${w.footprint}）`]), p.id, (v) => {
        p.id = v; render();
      }));
      row.appendChild(makeMaterialSelect('weapon', p.material, (v) => { p.material = v; render(); }, ownedMat, inst));
      row.appendChild(removeButton(() => { draft.parts.splice(i, 1); render(); }));
      weaponWrap.appendChild(row);
    });
    if (WEAPONS.length) {
      weaponWrap.appendChild(addButton('+ 加一件武器', () => {
        draft.parts.push({ id: WEAPONS[0].id, material: DEFAULT_MATERIAL.weapon });
        render();
      }));
    }
  };
  const weaponWrap = el('div', 'dsn-group');
  box.appendChild(weaponWrap);

  // ---- 船上设施 ----
  box.appendChild(el('div', 'bp-sub', '船上设施'));
  const renderFacilities = () => {
    facWrap.innerHTML = '';
    const facParts = (draft.parts || []).map((p, i) => ({ p, i })).filter(({ p }) => p.id.startsWith('fac_'));
    facParts.forEach(({ p, i }) => {
      const row = el('div', 'bp-row');
      row.appendChild(el('span', 'bp-label', '设施'));
      // 候选只列玩家拥有的设施；当前已选的一律保留（即便暂时没库存也不让它从下拉框消失）
      const opts = FACILITIES
        .filter((f) => facAvailable(f) || f.id === p.id)
        .map((f) => [f.id, facOptionLabel(f)]);
      row.appendChild(makeSelect(opts, p.id, (v) => {
        p.id = v; render();
      }));
      const fac = FACILITIES.find((f) => f.id === p.id);
      if (fac && fac.materialSlot) {
        row.appendChild(makeMaterialSelect(fac.materialSlot, p.material, (v) => { p.material = v; render(); }, ownedMat));
      } else {
        row.appendChild(el('span', 'bp-gap'));
      }
      row.appendChild(removeButton(() => { draft.parts.splice(i, 1); render(); }));
      facWrap.appendChild(row);
    });
    // 没有可添加的设施时给一句提示，而不是空着
    const addable = FACILITIES.filter((f) => facAvailable(f));
    if (addable.length) {
      facWrap.appendChild(addButton('+ 加一件设施', () => {
        draft.parts.push({ id: addable[0].id, material: null });
        render();
      }));
    } else {
      facWrap.appendChild(el('p', 'bp-tip muted', '先在制造车间生产，或先采集到该材料'));
    }
  };
  const facWrap = el('div', 'dsn-group');
  box.appendChild(facWrap);

  // ---- 实时评估 ----
  const evalPanel = el('div', 'bp-eval glass');
  box.appendChild(evalPanel);

  // ---- 操作 ----
  const actions = el('div', 'bp-actions');
  const designBtn = el('button', 'btn btn-primary', '设计');
  actions.appendChild(designBtn);
  box.appendChild(actions);

  wrap.appendChild(box);
  container.appendChild(wrap);

  // ========================================================================
  // 重新渲染（仅刷新动态部分；容器整体只在 renderDesign 入口建一次）
  // ========================================================================
  function render() {
    renderEngines();
    renderWeapons();
    renderFacilities();

    const rpCost = HULL_RP_COST[draft.hullId] || 0;
    costHint.textContent = '研究点 ' + fmtNum(rpCost);

    const ev = evaluateBlueprint(draft, { researched, ships: account.ships, lookup: matLookup });
    evalPanel.innerHTML = '';
    const grid = el('div', 'bp-eval-grid');
    const rows = [
      ['容量占用', `${fmtNum(ev.footprint)} / ${fmtNum(ev.capacity)}`
        + (ev.footprintLeft < 0 ? ` <span class="bad">超 ${fmtNum(-ev.footprintLeft)}</span>` : '')],
      ['总质量', fmtNum(ev.massT)],
      ['总推力', fmtNum(ev.thrust)],
      ['航速', fmtNum(ev.speed)],
      ['结构强度', fmtNum(ev.agg.struct)],
      ['MK 等级', ev.markLabel],
      ['类型', ev.className],
      ['强度', ev.strength + '（' + ev.grade + '级）'],
    ];
    for (const [k, v] of rows) {
      const cell = el('div', 'bp-eval-cell');
      cell.innerHTML = `<span class="bp-eval-k muted">${esc(k)}</span><span class="bp-eval-v">${v}</span>`;
      grid.appendChild(cell);
    }
    evalPanel.appendChild(grid);

    if (ev.errors.length) {
      const ul = el('ul', 'bp-issues err');
      ev.errors.forEach((e) => ul.appendChild(el('li', null, e)));
      evalPanel.appendChild(ul);
    }
    if (ev.warnings.length) {
      const ul = el('ul', 'bp-issues warn');
      ev.warnings.forEach((w) => ul.appendChild(el('li', null, w)));
      evalPanel.appendChild(ul);
    }

    // 研究点门槛
    const rp = Number(account.researchPoints) || 0;
    const rpOk = rp >= rpCost;
    const bpOk = ev.ok;
    const reasons = [];
    if (!bpOk) reasons.push('蓝图不合法：' + (ev.errors[0] || '请检查容量/槽位/引擎/乘员仓'));
    if (!rpOk) reasons.push(`研究点不足：需要 ${fmtNum(rpCost)}，现有 ${fmtNum(rp)}`);

    designBtn.disabled = !(bpOk && rpOk);
    designBtn.onclick = () => {
      if (!(bpOk && rpOk)) {
        ctx.openModal({ title: '无法设计', body: simpleBody(esc(reasons.join('。<br>')) + '。'), sheet: true });
        return;
      }
      const bp = {
        id: genBlueprintId(kindOfHull(draft.hullId)),
        nameCn: draft.nameCn,
        kind: kindOfHull(draft.hullId),
        hullId: draft.hullId,
        hull: draft.hullId,
        hullMaterial: draft.hullMaterial,
        engines: draft.engines.map((e) => ({ id: e.id, material: e.material })),
        parts: draft.parts.map((p) => ({ id: p.id, material: p.material })),
        fuelName: draft.fuelName,
        altitudeM: draft.altitudeM,
        planetCode: draft.planetCode,
        createdAt: Date.now(),
      };
      account.researchPoints = rp - rpCost;
      ensureBlueprints(account);
      account.blueprints.push(bp);
      account.blueprint = bp;
      const bodyHtml = '已保存蓝图：<b>' + esc(bp.nameCn) + '</b><br>类型 '
        + esc(bp.kind) + ' · 消耗研究点 ' + fmtNum(rpCost);
      ctx.openModal({ title: '设计完成', body: simpleBody(bodyHtml), sheet: true });
      if (typeof ctx.rerender === 'function') ctx.rerender();
    };

    const warn = el('div', 'bp-block muted');
    warn.textContent = reasons.join('；') || '蓝图合法，研究点充足，可设计。';
    actions.appendChild(warn);
    // 避免重复追加：每次 render 后只保留一个提示
    if (actions._warn && actions._warn !== warn) actions._warn.remove();
    actions._warn = warn;
  }

  function simpleBody(html) {
    const d = document.createElement('div');
    d.innerHTML = '<p class="sp-simple">' + html + '</p>';
    return d;
  }

  // v0.2.1：已保存蓝图的紧凑卡片 —— 只展示数值（不罗列具体设施 / 材料），
  //   点「展开编辑」切到 buildBlueprintEditor（含完整编辑器与「建造」按钮）。
  function buildCompactSavedCard(bp, rerender) {
    const card = el('div', 'dsn-saved-card glass');
    card.appendChild(el('div', 'dsn-saved-hint muted',
      '已保存蓝图 · 仅展示数值（右侧可直接建造；点「展开编辑」修改设施 / 材料）'));
    const ev = evaluateBlueprint(bp, { researched, ships: account.ships, lookup: matLookup });
    const grid = el('div', 'bp-eval-grid');
    const rows = [
      ['容量占用', `${fmtNum(ev.footprint)} / ${fmtNum(ev.capacity)}`
        + (ev.footprintLeft < 0 ? ` <span class="bad">超 ${fmtNum(-ev.footprintLeft)}</span>` : '')],
      ['总质量', fmtNum(ev.massT)],
      ['总推力', fmtNum(ev.thrust)],
      ['航速', fmtNum(ev.speed)],
      ['结构强度', fmtNum(ev.agg.struct)],
      ['MK 等级', ev.markLabel],
      ['类型', ev.className],
      ['强度', ev.strength + '（' + ev.grade + '级）'],
    ];
    for (const [k, v] of rows) {
      const cell = el('div', 'bp-eval-cell');
      cell.innerHTML = `<span class="bp-eval-k muted">${esc(k)}</span><span class="bp-eval-v">${v}</span>`;
      grid.appendChild(cell);
    }
    card.appendChild(grid);
    // v0.2.2：蓝图右侧直接建造 —— 不再要求先「展开编辑」才能造。
    //   已保存蓝图的材料/设施都已定，建造只差配员：与编辑器「建造」同一套校验与扣料。
    const buildRow = el('div', 'dsn-build-row');
    buildRow.appendChild(el('span', 'bp-label', '配员'));
    const wInput = document.createElement('input');
    wInput.type = 'number';
    wInput.min = '1';
    wInput.className = 'bp-input';
    const slot0 = lineSlotInfo(inst, 'dock');
    wInput.value = String(Math.max(1, Math.min(slot0.free, freeLaborOf(inst), 10)));
    const buildBtn = el('button', 'btn btn-primary', '建造');
    buildBtn.disabled = !ev.ok;
    if (!ev.ok) buildBtn.title = '蓝图非法（容量超限等），请展开编辑修正后再建造';
    const status = el('span', 'dsn-build-msg muted');
    buildBtn.addEventListener('click', () => {
      status.textContent = '';
      status.className = 'dsn-build-msg muted';
      const target = getPlanetInstance(bp.planetCode || (ctx && ctx.planetCode) || 'syl');
      const block = shipBuildBlockReason(target, getBuildingCounts(target));
      if (block) { status.textContent = block; status.className = 'dsn-build-msg err'; return; }
      const chk = shipBuildCheck(target, account, bp.id);
      if (!chk.ok) {
        const msgs = (chk.reasons || []).slice();
        if (chk.missing && chk.missing.length) msgs.push('装备缺件 ' + chk.missing.length + ' 项');
        status.textContent = '无法开工：' + (msgs.join('；') || '校验未通过');
        status.className = 'dsn-build-msg err';
        return;
      }
      const matReason = materialBuildBlockReason(target, bp);
      if (matReason) { status.textContent = '无法开工：' + matReason; status.className = 'dsn-build-msg err'; return; }
      // 齐备才整笔扣料（与编辑器同口径：先校验全齐，再 spendOwned）
      const matNeeds = blueprintMaterialNeeds(bp);
      for (const mat in matNeeds) spendOwned(target, mat, matNeeds[mat]);
      const slotNow = lineSlotInfo(target, 'dock');
      const free = freeLaborOf(target);
      if (slotNow.free <= 0 || free <= 0) {
        status.textContent = '无法开工：' + (slotNow.free <= 0 ? '船坞产线工位已满。' : '没有可分配的空闲人力。');
        status.className = 'dsn-build-msg err';
        return;
      }
      const want = Math.max(1, Math.min(slotNow.free, free, Math.floor(Number(wInput.value) || 1)));
      const res = createDockLine(target, bp.id, want);
      if (!res.ok) { status.textContent = '无法开工：' + res.reason; status.className = 'dsn-build-msg err'; return; }
      rerender();
    });
    buildRow.appendChild(wInput);
    buildRow.appendChild(buildBtn);
    buildRow.appendChild(status);
    card.appendChild(buildRow);
    const btn = el('button', 'btn btn-sm btn-primary', '展开编辑');
    btn.onclick = () => { container._designExpanded = true; rerender(); };
    card.appendChild(btn);
    return card;
  }

  // 顶栏研究点每秒刷新（与科研面板一致），切走自动清理
  const pointsNode = head.querySelector('[data-dsn-points]');
  if (container._dsnTimer) { clearInterval(container._dsnTimer); container._dsnTimer = null; }
  container._dsnTimer = setInterval(() => {
    if (!container.querySelector('.design-wrap')) { clearInterval(container._dsnTimer); container._dsnTimer = null; return; }
    pointsNode.textContent = fmtNum(account.researchPoints);
  }, 1000);

  render();
}

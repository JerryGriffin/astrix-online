// ============================================================================
// 自定义化工厂 UI（v0.4.6 需求 12）
// ============================================================================
//
// 为什么单独一个文件：`core/production.js#makeCustomMaterial` 与「自定义化工厂」
// 建筑在 v0.0.6 就已存在，但**整个 UI 层没有入口** —— 需求「自定义化工厂是任意
// 自选任意数目的原料合成自定义合金」只做了一半：数据层有，入口没有。
// 这里补上界面，并按 v0.4.6 的新规则展示：
//   · 原料种数 / 总量上限已放开（最多 24 种、总量 2048）
//   · **定义配方不再要求当场凑齐原料** —— 缺料只提示，不阻断（否则玩家在设计
//     阶段就被库存卡住，明明想好配方却存不进去）
//   · 合成工时随复杂度上升 —— 所以 UI 必须**实时显示工时与推导属性**，
//     否则玩家会误以为「多掺材料」是白赚的
// ============================================================================

import { fmtNum } from '../core/format.js?v=55.6';
import * as PR from '../core/production.js?v=55.6';
import { materialOptionsFor, materialLookupFor } from '../core/shipyard.js?v=55.6';
import { getBuildingCounts, ownedOf } from '../core/state.js?v=55.6';
// v0.4.7：el() 收敛到 ui/common.js（此前本文件自带一份；全项目共 14 份、两种不兼容签名，
//   v0.3.2「列强区块不显示」即源于把 A 型调用写进了 B 型文件）
import { el } from './common.js?v=55.6';

// ---------------------------------------------------------------------------
// 主入口。返回 null 表示该星球没有自定义化工厂，调用方不要渲染。
// ---------------------------------------------------------------------------
export function renderAlloyForge(planet, rerender) {
  let counts = {};
  try { counts = getBuildingCounts(planet) || {}; } catch (e) { counts = {}; }
  if (!(Number(counts.custom_chem) > 0)) return null;

  const box = el('div', 'alloy-forge');
  const lookup = materialLookupFor(planet);

  box.appendChild(el('div', 'alloy-forge-title', '自定义化工厂 · 合金配方'));
  box.appendChild(el('div', 'alloy-forge-sub',
    '任意自选原料、合成任意数目的自定义合金。原料最多 ' + PR.CUSTOM_KIND_MAX
    + ' 种、总量 ' + PR.CUSTOM_AMT_MAX + '（总量至少 ' + PR.CUSTOM_AMT_MIN + '）。'
    + '合金的强度/耐久性/密度由原料比例推导，'
    + '**掺的料越多，属性协同加成越高，但合成工时也越长** —— 需要权衡。'));

  // ---- 已有合金列表 ----
  const list = PR.listCustomMaterials(planet);
  if (list.length) {
    const lw = el('div', 'alloy-list');
    lw.appendChild(el('div', 'alloy-list-title', '已定义的合金（' + list.length + ' 种）'));
    for (const it of list) {
      const m = it.material, r = it.recipe;
      const row = el('div', 'alloy-row');
      const head = el('div', 'alloy-row-head');
      head.appendChild(el('b', null, m.nameCn));
      head.appendChild(el('span', 'alloy-tag', '精细度 ' + (Number(m.fineness) || 1)));
      head.appendChild(el('span', 'alloy-tag', '工时 ' + fmtNum(r.work)));
      const del = el('button', 'btn btn-sm btn-danger', '删除');
      del.addEventListener('click', () => {
        if (!window.confirm('删除合金「' + m.nameCn + '」？\n已有生产线若正在生产它会停线。')) return;
        PR.removeCustomMaterial(planet, it.key);
        rerender && rerender();
      });
      head.appendChild(del);
      row.appendChild(head);
      row.appendChild(el('div', 'alloy-row-desc',
        '强度 ' + (Number(m.strength) || 0).toFixed(1)
        + ' · 耐久性 ' + (Number(m.durability) || 0).toFixed(1)
        + ' · 密度 ' + (Number(m.density) || 0).toFixed(2)
        + ' · 熔点 ' + fmtNum(m.meltingPointK) + ' K'));
      row.appendChild(el('div', 'alloy-row-ingr', '配方：' + m.description.replace('自定义材料：', '')));
      lw.appendChild(row);
    }
    box.appendChild(lw);
  } else {
    box.appendChild(el('div', 'alloy-empty',
      '还没有定义任何合金。用下面的表单造第一种吧。'));
  }

  // ---- 新建合金表单 ----
  const draft = { name: '', parts: [{ mat: '', amt: 4 }, { mat: '', amt: 4 }] };

  const form = el('div', 'alloy-form');
  form.appendChild(el('div', 'alloy-form-title', '定义新合金'));

  // 名称
  const nameRow = el('div', 'alloy-name-row');
  nameRow.appendChild(el('span', 'alloy-lbl', '名称'));
  const nameIn = document.createElement('input');
  nameIn.type = 'text';
  nameIn.className = 'alloy-in';
  nameIn.maxLength = 12;
  nameIn.placeholder = '2~12 个字，只能用文字或字母';
  nameIn.addEventListener('input', () => { draft.name = nameIn.value; updatePreview(); });
  nameRow.appendChild(nameIn);
  form.appendChild(nameRow);

  // 原料行
  const ingWrap = el('div', 'alloy-ing-wrap');
  form.appendChild(ingWrap);
  const ingHint = el('div', 'alloy-hint',
    '至少 2 种原料。数量是该合金的配比单位 —— 比例决定推导属性。');
  form.appendChild(ingHint);

  // 实时预览
  const preview = el('div', 'alloy-preview');
  form.appendChild(preview);

  // 按钮
  const acts = el('div', 'alloy-acts');
  const addBtn = el('button', 'btn btn-sm', '+ 增加一种原料');
  addBtn.addEventListener('click', () => {
    if (draft.parts.length >= PR.CUSTOM_KIND_MAX) {
      alert('原料种数最多 ' + PR.CUSTOM_KIND_MAX + ' 种。');
      return;
    }
    draft.parts.push({ mat: '', amt: 4 });
    renderIngs();
  });
  const okBtn = el('button', 'btn btn-sm btn-primary', '定义合金');
  okBtn.addEventListener('click', submit);
  const wipeBtn = el('button', 'btn btn-sm', '清空');
  wipeBtn.addEventListener('click', () => {
    draft.name = '';
    draft.parts = [{ mat: '', amt: 4 }, { mat: '', amt: 4 }];
    nameIn.value = '';
    renderIngs();
    updatePreview();
  });
  acts.appendChild(addBtn);
  acts.appendChild(okBtn);
  acts.appendChild(wipeBtn);
  form.appendChild(acts);

  const warnBox = el('div', 'alloy-warn');
  form.appendChild(warnBox);

  // ---- 原料候选（除气体外全部可选，含其它自定义合金 —— 可层层合成）----
  const candidates = materialOptionsFor('hull', planet, { lookup })
    .map((o) => o.name)
    // 按持有量排序：优先把自己有的排在前面，少翻下拉
    .sort((a, b) => (ownedOf(planet, b) || 0) - (ownedOf(planet, a) || 0));

  function renderIngs() {
    ingWrap.innerHTML = '';
    draft.parts.forEach((p, i) => {
      const row = el('div', 'alloy-ing-row');
      const sel = document.createElement('select');
      sel.className = 'alloy-sel';
      const blank = document.createElement('option');
      blank.value = '';
      blank.textContent = '— 选材料 —';
      sel.appendChild(blank);
      for (const name of candidates) {
        const o = document.createElement('option');
        o.value = name;
        const mul = materialLookupFor(planet)[name];
        const held = ownedOf(planet, name) || 0;
        const tag = mul && mul.special === '自定义合成' ? '·自造' : '';
        o.textContent = name + (tag ? '（' + tag.slice(1) + '）' : '') + ' 持有 ' + fmtNum(held);
        if (p.mat === name) o.setAttribute('selected', 'selected');
        sel.appendChild(o);
      }
      sel.addEventListener('change', () => { p.mat = sel.value; updatePreview(); });
      row.appendChild(sel);

      const amt = document.createElement('input');
      amt.type = 'number';
      amt.min = '1';
      amt.className = 'alloy-amt';
      amt.value = String(p.amt);
      amt.addEventListener('change', () => {
        p.amt = Math.max(1, Math.floor(Number(amt.value) || 1));
        amt.value = String(p.amt);
        updatePreview();
      });
      row.appendChild(amt);

      const rm = el('button', 'btn btn-sm btn-danger', '−');
      if (draft.parts.length <= 2) {
        rm.disabled = true;
        rm.title = '至少保留 2 种原料';
      }
      rm.addEventListener('click', () => {
        draft.parts.splice(i, 1);
        renderIngs();
        updatePreview();
      });
      row.appendChild(rm);
      ingWrap.appendChild(row);
    });
    updatePreview();
  }

  /** 实时预览：推导属性 + 合成工时 + 缺料提示（全部走 core 同一套公式） */
  function updatePreview() {
    const parts = draft.parts.filter((p) => p.mat);
    const total = parts.reduce((s, p) => s + (Number(p.amt) || 0), 0);
    preview.innerHTML = '';
    if (!parts.length) {
      preview.appendChild(el('div', 'muted', '选择原料后这里会实时显示推导属性与合成工时。'));
      return;
    }
    const stats = PR.derivedStatsOf(parts, materialLookupFor(planet));
    const work = PR.customWorkOf(parts.length, total);
    const line = el('div', 'alloy-prev-line');
    line.textContent = parts.length + ' 种原料 · 总量 ' + total
      + ' · 精细度 ' + (stats.fineness || 1)
      + ' · 合成工时 ' + fmtNum(work);
    preview.appendChild(line);
    const line2 = el('div', 'alloy-prev-line');
    line2.textContent = '推导属性：强度 ' + (Number(stats.strength) || 0).toFixed(1)
      + ' · 耐久性 ' + (Number(stats.durability) || 0).toFixed(1)
      + ' · 密度 ' + (Number(stats.density) || 0).toFixed(2)
      + ' · 熔点 ' + fmtNum(stats.meltingPointK) + ' K';
    preview.appendChild(line2);
    // 缺料提示（不阻断 —— v0.4.6 起定义不需要当场凑齐）
    const lack = [];
    for (const p of parts) {
      const have = ownedOf(planet, p.mat) || 0;
      if (have < p.amt) lack.push(p.mat + ' ' + fmtNum(have) + '/' + fmtNum(p.amt));
    }
    if (lack.length) {
      preview.appendChild(el('div', 'alloy-lack',
        '当前缺料（不影响定义，开工前补齐即可）：' + lack.join('、')));
    }
    if (parts.length < 2) {
      preview.appendChild(el('div', 'alloy-lack', '至少还要 ' + (2 - parts.length) + ' 种原料。'));
    }
  }

  function submit() {
    const parts = draft.parts.filter((p) => p.mat && String(p.mat).trim());
    const r = PR.makeCustomMaterial(planet, draft.name, parts);
    if (!r.ok) { alert(r.reason || '定义失败'); return; }
    // v0.4.6：缺料是**警告**，不是失败 —— 告知玩家即可，不要打断
    let msg = '已定义合金「' + r.material.nameCn + '」：'
      + '强度 ' + (Number(r.material.strength) || 0).toFixed(1)
      + '、精细度 ' + (Number(r.material.fineness) || 1)
      + '、合成工时 ' + fmtNum(r.recipe.work) + '。\n\n'
      + '现在可以在「生产线」里为自定义化工厂开一条线来量产它。';
    if (r.warnings && r.warnings.length) {
      msg += '\n\n当前缺料（开工前补齐即可）：\n· ' + r.warnings.join('\n· ');
    }
    msg += '\n\n提示：它已经可以在部件、蓝图与军事部件的材料下拉里选到了。';
    alert(msg);
    rerender && rerender();
  }

  renderIngs();
  box.appendChild(form);
  return box;
}

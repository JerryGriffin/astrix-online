// ============================================================================
// ui/common.js —— UI 层公共工具（v0.4.7 新增）
//
// 为什么要建这个文件
//   本项目零构建、没有公共依赖层，`el()` 此前在 **14 个 UI 文件里各写一份**，
//   且存在**两种不兼容签名**：
//     A 型  el(tag, cls, text)              —— 9 个文件（galaxy/fleet/army/…）
//     B 型  el(tag, attrs = {}, children=[]) —— 5 个文件（hoi/colony/population/…）
//   两者对 `el(tag, null, '文本')` 的处理完全不同（A 跳过 null 当 class，
//   B 把 null 当 attrs 走 for-in），跨文件复制粘贴必然埋 bug。
//
//   v0.3.2 的「列强区块不显示」就是这个问题的一次真实爆发：
//   `el('div', 'res-section-title', '列强')` 在 B 型 colony.js 里把字符串
//   当成 children 传给 appendChild → "parameter 1 is not of type 'Node'"。
//
// 本文件提供**一个同时兼容 A/B 两种调用形态**的实现，逐步把各文件切过来。
// ============================================================================

/**
 * 创建元素（兼容两种历史签名）。
 *
 * A 型：el(tag, cls, text)               —— 第二参是 class 字符串，第三参是文本
 * B 型：el(tag, attrs, children)        —— 第二参是属性对象，第三参是子节点数组
 * 混合：el(tag, null, text)              —— class/attrs 省略
 *      el(tag, { class, text, html, style, ...attrs })
 *
 * @param {string} tag 标签名
 * @param {string|object|null} clsOrAttrs class 字符串 或 属性对象
 * @param {string|Node|Array|null} textOrChildren 文本 或 子节点
 * @returns {HTMLElement}
 */
export function el(tag, clsOrAttrs, textOrChildren) {
  const e = document.createElement(tag);

  // ---- 第二参：class 字符串 或 属性对象 ----
  if (typeof clsOrAttrs === 'string') {
    if (clsOrAttrs) e.className = clsOrAttrs;
  } else if (clsOrAttrs && typeof clsOrAttrs === 'object') {
    for (const k in clsOrAttrs) {
      const v = clsOrAttrs[k];
      if (v == null) continue;
      if (k === 'text') { e.textContent = String(v); }
      else if (k === 'html') { e.innerHTML = String(v); }
      else if (k === 'class') { e.className = String(v); }
      else if (k === 'style') {
        if (typeof v === 'string') e.setAttribute('style', v);
        else for (const sk in v) e.style[sk] = v[sk];
      } else if (k === 'dataset') {
        for (const dk in v) e.dataset[dk] = v[dk];
      } else if (k.slice(0, 2) === 'on' && typeof v === 'function') {
        e.addEventListener(k.slice(2).toLowerCase(), v);
      } else if (k === 'value' || k === 'checked' || k === 'disabled' || k === 'selected') {
        // 这些是**属性**而非内容，写 property 才能让表单控件生效
        e[k] = v;
      } else {
        e.setAttribute(k, String(v));
      }
    }
  }

  // ---- 第三参：文本 或 子节点 ----
  if (textOrChildren != null) {
    if (Array.isArray(textOrChildren)) {
      for (const c of textOrChildren) if (c) e.appendChild(c);
    } else if (typeof textOrChildren === 'string' || typeof textOrChildren === 'number') {
      e.appendChild(document.createTextNode(String(textOrChildren)));
    } else if (textOrChildren.nodeType) {
      e.appendChild(textOrChildren);
    }
  }
  return e;
}

/**
 * 把一段 CSS 注入 document.head，同一 id 只注入一次。
 *
 * v0.4.16：此前 buildings / colony / hoi / population / power 五个模块都是
 *   root.appendChild(el('style', { text: CSS })) —— 样式跟着面板一起被
 *   innerHTML 清空而反复重建。带定时重绘的页面每秒要重新插入并解析一遍这整块 CSS，
 * 而且 CSS 文本会混进容器的 textContent。统一收敛到这里。
 *
 * @param {string} id  幂等键，通常是 '<模块>-css'
 * @param {string} css CSS 文本
 */
export function ensureStyle(id, css) {
  // 宿主可能没有 head（Node 端自检用的极简 DOM 垫片就没有），此时静默跳过 ——
  // 样式缺失只是掉回无样式显示，不该让整个面板渲染失败。
  if (typeof document === 'undefined' || !document.head) return;
  if (document.getElementById(id)) return;
  const st = document.createElement('style');
  st.id = id;
  st.textContent = css;
  document.head.appendChild(st);
}

/**
 * HTML 转义 —— **全项目唯一实现**。
 *
 * v0.4.20 收敛：此前 `esc` / `escapeHtml` 在各 UI 文件里各有一份副本
 *   （design / fleet / galaxy / research / shipyard 各一份 `esc`，
 *     inventory / planet / start 各一份 `escapeHtml`，共 8 份），
 *   而本文件这一份是其中**唯一漏掉单引号**的：副本都转 `'` → `&#39;`，它不转。
 *   直接合并会丢掉单引号转义（值若落在单引号引起来的属性里就能注入），
 *   所以这里先把它补成**完整超集**（转义 & < > " ' 五个字符 + null 兜底），
 *   再让其余 8 处统统一 import 使用。
 *
 * `s == null` 兜底：副本里的 `String(s)` 会把 null/undefined 渲染成 "null" 字样。
 */
export function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** 按钮：与各 UI 文件里重复的 btn() 一致 */
export function btn(text, cls) {
  const b = document.createElement('button');
  b.className = 'btn' + (cls ? ' ' + cls : '');
  b.textContent = text;
  return b;
}

// ---------------------------------------------------------------------------
// v0.4.20：以下 3 个 DOM 辅助函数此前在 ui/design.js 与 ui/shipyard.js 里
//   各抄一份（逐字节相同），收敛到这里。
//   注意 makeMaterialSelect / facOptionLabel 两边**已经不一致**（真实分叉），
//   没有合并 —— 那种情况要先定谁的行为是对的，否则就是在改玩法。
// ---------------------------------------------------------------------------

export function makeSelect(options, value, onChange) {
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

export function addButton(label, onClick) {
  const b = el('button', 'btn btn-sm bp-add', label);
  b.onclick = onClick;
  return b;
}

export function removeButton(onClick) {
  const b = el('button', 'btn btn-sm btn-danger bp-remove', '移除');
  b.onclick = onClick;
  return b;
}

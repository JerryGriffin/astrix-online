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
 * HTML 转义 —— 各 UI 文件里常重复写 `esc()`，这里给一份统一实现。
 * 注意：只用于**文本内容**；要输出 HTML 时请显式用 el(tag,{html}) 并自行确保安全。
 */
export function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** 按钮：与各 UI 文件里重复的 btn() 一致 */
export function btn(text, cls) {
  const b = document.createElement('button');
  b.className = 'btn' + (cls ? ' ' + cls : '');
  b.textContent = text;
  return b;
}

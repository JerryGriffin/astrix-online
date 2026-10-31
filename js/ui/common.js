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

/**
 * 说明文本的「行内标记」渲染（v0.4.25）。
 *
 * 背景：`js/data/*.js` 里的 desc 长期用 `**强调**` 写重点（buildings 14 处、
 * techs 8 处、recipes 4 处），但 UI 一侧一直用 `text:` / `esc()` 直接输出，
 * 玩家看到的是字面星号（如「庇护总量决定**居住容量**」）。
 *
 * 约定：说明文本**只允许一种标记** —— `**粗体**`，其余字符一律转义，
 * 因此不存在注 HTML 的风险（先 escape 再替换，顺序不能反）。
 * 纯文本场景（写进 textContent / title / alert）用 stripMdInline。
 */
export function mdInline(s) {
  return esc(s).replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
}

/** 去掉 `**` 但保留纯文本（textContent / title / alert 场景） */
export function stripMdInline(s) {
  return String(s == null ? '' : s).replace(/\*\*/g, '');
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

// ============================================================================
// 界面刷新定时器（v0.4.22 新增）
// ============================================================================
// 为什么抽出来
//   v0.4.21 之前，13 个 UI 页各自复制粘贴同一段 setInterval：
//     ① 先 clearInterval 旧表 —— 否则每次重绘就叠一个新表（army 页曾泄漏）；
//     ② 回调开头挡后台标签页（document.hidden）—— 否则每秒白刷看不见的界面；
//     ③ 再判断本页是否还挂着 —— 但**不能用 isConnected**：planet.js 切 tab 时
//        复用同一个 contentInner，isConnected 恒为 true，旧表会把新 tab 盖回去
//        （v0.2.0 冒烟抓到的真实事故），所以各页只能写「查自己的门牌类名」。
//   三段逻辑一模一样地散在 14 个文件里，改一处口径要改 14 遍。这里收敛成两个函数。
//
// 用法（与旧写法等价）：
//   uiTick(root, '_armyTimer', () => renderArmyPage(root, ctx), {
//     alive: () => root.querySelector('.page-title')?.textContent === '军队',
//   });
//   stopUiTick(root, '_armyTimer');   // 需要提前停表时
//
// 注意：
//   * `alive` 返回 false 时**自动停表**，不需要在回调里再 clearInterval；
//   * 定时器句柄仍挂在 host[key] 上，方便调试与兼容既有代码；
//   * 页面不可见时只是「跳过本次」，不停表 —— 回到前台立刻恢复。
export function stopUiTick(host, key) {
  if (host && host[key]) { clearInterval(host[key]); host[key] = null; }
}

export function uiTick(host, key, step, opts = {}) {
  const ms = opts.ms || 1000;
  const alive = typeof opts.alive === 'function' ? opts.alive : null;
  stopUiTick(host, key);
  host[key] = setInterval(() => {
    // 后台标签页不刷新：不可见的界面重绘纯属浪费 CPU，回到前台后下一拍即恢复
    if (typeof document !== 'undefined' && document.hidden) return;
    if (alive && !alive()) { stopUiTick(host, key); return; }
    step();
  }, ms);
  return host[key];
}

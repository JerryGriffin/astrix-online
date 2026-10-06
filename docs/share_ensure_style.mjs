// v0.4.16（③ 冗余清理）：把「样式注入」收敛成 common.js 里的一个 ensureStyle
//
// 问题：buildings / colony / hoi / population / power 五个模块各自
//   `root.appendChild(el('style', { text: CSS }))` 把整块样式塞进渲染容器。
//   其中 buildings / colony / hoi / power 都有定时整体重绘，于是这段 CSS 每秒被
//   重新插入、重新解析，再被 innerHTML='' 丢掉 —— 纯浪费；副作用是整段 CSS 文本
//   混进了容器的 textContent，任何读面板文字的地方（搜索、断言、无障碍）都会读到
//   一堆 CSS 规则。v0.4.16 在浏览器里实测：战区页 textContent 5752 字符里有
//   大半是 CSS，改完降到 1666。
//
// 做法：common.js 导出唯一的 ensureStyle(id, css)，按 id 去重后挂到 document.head。
//   样式 id 用 '<模块>-css' 命名，与现有常量名对应，便于排查。
import { readFileSync, writeFileSync } from 'fs';

const E = (s) => s;

// ---------------------------------------------------------------- 1) common.js 加 helper
{
  const FILE = 'js/ui/common.js';
  let src = readFileSync(FILE, 'utf8');
  const EOL = src.includes('\r\n') ? '\r\n' : '\n';
  src = src.split(EOL).join('\n');
  if (src.includes('export function ensureStyle')) {
    console.log('· common.js 已有 ensureStyle，跳过');
  } else {
    const helper = `
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
  if (typeof document === 'undefined') return;
  if (document.getElementById(id)) return;
  const st = document.createElement('style');
  st.id = id;
  st.textContent = css;
  document.head.appendChild(st);
}
`;
    const anchor = src.match(/^export function esc\(s\) \{/m);
    if (!anchor) { console.error('✗ common.js 找不到 esc'); process.exit(1); }
    src = src.replace(anchor[0], () => helper.trimStart() + '\n' + anchor[0]);
    writeFileSync(FILE, src.split('\n').join(EOL), 'utf8');
    console.log('✓ common.js 新增 ensureStyle');
  }
}

// ---------------------------------------------------------------- 2) 各模块改用共用 helper
const PATCH = [
  // [文件, 旧的注入语句, 新的调用, 样式 id, 常量名, 该文件里的注入次数]
  ['js/ui/buildings.js', "root.appendChild(el('style', { text: CSS }));", 2, 'buildings-css', 'CSS'],
  ['js/ui/colony.js', "root.appendChild(el('style', { text: CSS }));", 1, 'colony-css', 'CSS'],
  ['js/ui/population.js', "root.appendChild(el('style', { text: PANEL_CSS }));", 1, 'population-css', 'PANEL_CSS'],
  ['js/ui/power.js', "root.appendChild(el('style', { text: CSS }));", 2, 'power-css', 'CSS'],
];

for (const [file, oldStmt, expected, styleId, constName] of PATCH) {
  let src = readFileSync(file, 'utf8');
  const EOL = src.includes('\r\n') ? '\r\n' : '\n';
  src = src.split(EOL).join('\n');

  const count = src.split(oldStmt).length - 1;
  if (count !== expected) {
    console.log('  ! ' + file + ' 预期 ' + expected + ' 处，实际 ' + count + ' 处 —— 跳过');
    continue;
  }
  src = src.split(oldStmt).join(`ensureStyle('${styleId}', ${constName});`);

  // 补 import
  src = src.replace(
    /^import \{ el \} from '\.\/common\.js\?v=[^']*';/m,
    (m) => m.replace('{ el }', '{ el, ensureStyle }'),
  );

  writeFileSync(file, src.split('\n').join(EOL), 'utf8');
  console.log('  ✓ ' + file + '  ' + count + ' 处 → ensureStyle(\'' + styleId + '\', ' + constName + ')');
}

// ---------------------------------------------------------------- 3) hoi.js 改用共用 helper
{
  const FILE = 'js/ui/hoi.js';
  let src = readFileSync(FILE, 'utf8');
  const EOL = src.includes('\r\n') ? '\r\n' : '\n';
  src = src.split(EOL).join('\n');
  // 删掉 v0.4.16 刚加的本地副本，改用 common 的
  const localHelper = src.match(/\/\*\*\n \* 把一段 CSS 注入 document\.head[\s\S]*?\n\}\n/);
  if (localHelper) {
    src = src.replace(localHelper[0], '');
    src = src.replace("ensureStyle('hoi-panel-css', CSS);", "ensureStyle('hoi-css', CSS);");
    src = src.replace(
      /^import \{ el \} from '\.\/common\.js\?v=[^']*';/m,
      (m) => m.replace('{ el }', '{ el, ensureStyle }'),
    );
    writeFileSync(FILE, src.split('\n').join(EOL), 'utf8');
    console.log('  ✓ js/ui/hoi.js  本地副本已删，改用 common.ensureStyle');
  } else {
    console.log('  ! hoi.js 未找到本地 ensureStyle 副本，跳过');
  }
}
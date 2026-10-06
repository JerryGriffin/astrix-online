// 扫描：哪些 UI 模块把整块 CSS 塞进渲染容器（el('style', ...)），
// 以及哪些容器每秒整体重绘 —— 这类样式会被反复插入+解析，还会污染 textContent。
import { readdirSync, statSync, readFileSync } from 'fs';
import { join, relative } from 'path';

const ROOT = process.cwd();
function walk(dir, out = []) {
  for (const n of readdirSync(dir)) {
    const p = join(dir, n);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.js$/.test(n)) out.push(p);
  }
  return out;
}

console.log('=== A. UI 模块里的样式注入 ===');
const hits = [];
for (const f of walk(join(ROOT, 'js', 'ui'))) {
  const src = readFileSync(f, 'utf8');
  const lines = src.split(/\r?\n/);
  lines.forEach((line, i) => {
    if (/(appendChild|append)\s*\(\s*el\(\s*'style'|createElement\(\s*'style'\s*\)|insertAdjacentHTML[\s\S]{0,40}<style/i.test(line)) {
      hits.push(relative(ROOT, f) + ':' + (i + 1) + '  ' + line.trim().slice(0, 96));
    }
  });
}
hits.forEach((h) => console.log('  ' + h));
if (!hits.length) console.log('  （无）');

console.log('\n=== B. 定时重绘频率（setInterval / 心跳）===');
for (const f of walk(join(ROOT, 'js', 'ui'))) {
  const src = readFileSync(f, 'utf8');
  const lines = src.split(/\r?\n/);
  lines.forEach((line, i) => {
    if (/setInterval/.test(line)) {
      console.log('  ' + relative(ROOT, f) + ':' + (i + 1) + '  ' + line.trim().slice(0, 96));
    }
  });
}

console.log('\n=== C. 同一份 CSS 常量被多处重复定义？===');
const cssConsts = [];
for (const f of walk(join(ROOT, 'js'))) {
  const src = readFileSync(f, 'utf8');
  const re = /^const (CSS|STYLE_CSS|_CSS)\b/gm;
  let m;
  while ((m = re.exec(src))) cssConsts.push(relative(ROOT, f) + '  ' + m[1]);
}
cssConsts.forEach((c) => console.log('  ' + c));
if (cssConsts.length > 1) {
  console.log('  → 共 ' + cssConsts.length + ' 处内联 CSS 常量（每处都会随重绘反复注入）');
}
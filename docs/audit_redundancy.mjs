// v0.4.16（③）冗余审计：扫描全库常见的冗余形态
//   A. 死 import（import 了但文件里再没出现第二次）
//   B. 重复的辅助函数实现（全库同名函数在多个文件里各写一遍）
//   C. 空实现 / 只有注释的函数
//   D. 重复的 el() 定义（v0.3.2 曾因两种不兼容签名踩坑）
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
const files = walk(join(ROOT, 'js'));

// ---------------------------------------------------------------- A. 死 import
console.log('=== A. 死 import（只出现 1 次 = 只在 import 行里）===');
let dead = 0;
for (const f of files) {
  const src = readFileSync(f, 'utf8');
  const lines = src.split(/\r?\n/);
  for (const line of lines) {
    const m = line.match(/^import\s*\{([^}]+)\}\s*from\s*['"][^'"]+['"]/);
    if (!m) continue;
    const names = m[1].split(',').map((s) => s.trim().split(/\s+as\s+/).pop()).filter(Boolean);
    const body = src.replace(line, '');
    for (const name of names) {
      const re = new RegExp('\\b' + name.replace(/[$]/g, '\\$') + '\\b');
      if (!re.test(body)) {
        console.log('  ' + relative(ROOT, f) + '  →  ' + name);
        dead++;
      }
    }
  }
}
if (!dead) console.log('  （无）');
console.log('  小计 ' + dead + ' 个死 import\n');

// ---------------------------------------------------------------- B. 重复实现
console.log('=== B. 同名顶层函数在多个文件里各写一遍 ===');
const byName = new Map();
for (const f of files) {
  const src = readFileSync(f, 'utf8');
  const re = /^(?:export\s+)?(?:async\s+)?function\s+(\w+)\s*\(/gm;
  let m;
  while ((m = re.exec(src))) {
    const name = m[1];
    if (!byName.has(name)) byName.set(name, []);
    byName.get(name).push(relative(ROOT, f));
  }
}
let dup = 0;
for (const [name, where] of byName) {
  const uniq = [...new Set(where)];
  if (uniq.length > 1) {
    dup++;
    console.log('  ' + name.padEnd(26) + ' → ' + uniq.join(', '));
  }
}
console.log('  小计 ' + dup + ' 组重名\n');

// ---------------------------------------------------------------- C. 空实现
console.log('=== C. 空函数体 / 只有注释 ===');
let empty = 0;
for (const f of files) {
  const src = readFileSync(f, 'utf8');
  const re = /function\s+(\w+)\s*\([^)]*\)\s*\{\s*(\/\/[^\n]*\s*)*\}/g;
  let m;
  while ((m = re.exec(src))) {
    const line = src.slice(0, m.index).split('\n').length;
    console.log('  ' + relative(ROOT, f) + ':' + line + '  ' + m[1] + '()');
    empty++;
  }
}
if (!empty) console.log('  （无）');
console.log('  小计 ' + empty + ' 处');

// ---------------------------------------------------------------- D. el() 定义
console.log('\n=== D. el() 的本地定义（应只在 ui/common.js 有一份）===');
let els = 0;
for (const f of files) {
  const src = readFileSync(f, 'utf8');
  if (/^\s*(export\s+)?function\s+el\s*\(/m.test(src) && !/ui[\\/]common\.js$/.test(f)) {
    console.log('  ' + relative(ROOT, f));
    els++;
  }
}
if (!els) console.log('  （只有 common.js 一份）');
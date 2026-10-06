// v0.4.18：修 galaxy.js —— 上一次删 1936 正当化分支时，大括号配平算错了
// （起始行 `} else if (!allied) {` 的前导 `}` 属于上一个块，把 depth 提前归零，
//  于是只删了 2 行，**原分支的函数体整段留了下来**，文件语法被破坏）。
// 这次按行定位：删掉从 `const j = f.hoi ?` 起到 `card.appendChild(act);` 之前的
// 全部残留（其中包含原 else-if 的收尾大括号）。
import { readFileSync, writeFileSync } from 'fs';

const FILE = 'js/ui/galaxy.js';
let src = readFileSync(FILE, 'utf8');
const EOL = src.includes('\r\n') ? '\r\n' : '\n';
let lines = src.split(EOL).join('\n').split('\n');

const start = lines.findIndex((l) => l.includes('const j = f.hoi ? justifyStatusOf'));
if (start < 0) { console.error('✗ 找不到残留起点'); process.exit(1); }

let end = -1;
for (let i = start; i < lines.length; i++) {
  if (/^\s*card\.appendChild\(act\);\s*$/.test(lines[i])) { end = i; break; }
}
if (end < 0) { console.error('✗ 找不到 card.appendChild(act); 终点'); process.exit(1); }

// end-1 应该是原 else-if 的收尾 `}`，一并删掉
console.log('删掉第 ' + (start + 1) + ' ~ ' + end + ' 行（残留的原 1936 分支函数体 + 其收尾大括号）');
console.log('  删前预览首行: ' + lines[start].trim());
console.log('  删前预览末行: ' + lines[end - 1].trim());

lines.splice(start, end - start);

writeFileSync(FILE, lines.join('\n').split('\n').join(EOL), 'utf8');
console.log('✓ 已删除残留');
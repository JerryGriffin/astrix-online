// 找大括号失衡的位置：逐行累计深度，报告首次变负、以及结尾非零
import { readFileSync } from 'fs';

const file = process.argv[2] || 'js/core/state.js';
const lines = readFileSync(file, 'utf8').split(/\r?\n/);

// 粗略剔除注释与字符串，避免误判
function codeOf(line) {
  let s = line.replace(/^\s*(\/\/|\*|\/\*).*$/, '');
  s = s.replace(/(['"`])(?:\\.|(?!\1)[^\\])*\1/g, '""');
  return s;
}

let depth = 0;
const trace = [];
for (let i = 0; i < lines.length; i++) {
  const c = codeOf(lines[i]);
  for (const ch of c) { if (ch === '{') depth++; else if (ch === '}') depth--; }
  if (depth < 0) { console.log('第 ' + (i + 1) + ' 行深度变负（多了一个 }）: ' + lines[i].trim().slice(0, 90)); process.exit(1); }
  trace.push(depth);
}
console.log('结尾深度 = ' + depth + (depth === 0 ? '（平衡）' : '（不平衡，多出 ' + depth + ' 个 { ）'));

// 若不平衡，报告最后一次深度为 0 的位置 —— 缺失的 } 就在其后
if (depth !== 0) {
  let last0 = -1;
  for (let i = 0; i < trace.length; i++) if (trace[i] === 0) last0 = i;
  console.log('最后一次深度归零在第 ' + (last0 + 1) + ' 行: ' + (lines[last0] || '').trim().slice(0, 90));
  console.log('第 ' + (last0 + 2) + ' 行起就再没闭合过: ' + (lines[last0 + 1] || '').trim().slice(0, 90));
}
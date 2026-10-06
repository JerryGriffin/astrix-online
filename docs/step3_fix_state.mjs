// v0.4.19 第三步：state.js 解开对已删除的 WWII 数据 / 函数的引用。
// 全部按行号操作 + 逐处校验，删完立刻做语法检查。
import { readFileSync, writeFileSync } from 'fs';

const FILE = 'js/core/state.js';
let lines = readFileSync(FILE, 'utf8').split(/\r?\n/);

const log = [];
function check(cond, msg) { if (!cond) { console.error('✗ ' + msg); process.exit(1); } }

// ---- 1) 删掉 data/hoi1936.js 的 import（整行） ----
{
  const i = lines.findIndex((l) => /from '\.\.\/data\/hoi1936\.js/.test(l));
  check(i >= 0, '找不到 data/hoi1936.js 的 import 行');
  console.log('  删掉第 ' + (i + 1) + ' 行（data/hoi1936.js import）');
  lines.splice(i, 1);
  log.push('删 data/hoi1936.js import');
}

// ---- 2) 从 core 的 import 块里剔掉已删除的函数 ----
{
  const DEAD = ['setupGermanPuppets', 'tickDiploAI'];
  const blockStart = lines.findIndex((l) => /^\s*import\s*\{/.test(l)
    && lines.slice(lines.indexOf(l)).find((x) => /from '\.\/hoi1936\.js/.test(x)));
  // 找到 core/hoi1936.js 的 import 语句范围
  let s = -1, e = -1;
  for (let i = 0; i < lines.length; i++) {
    if (/^\s*import\s*\{/.test(lines[i])) {
      let j = i, stmt = lines[i];
      while (!/from\s*['"]/.test(stmt) && j + 1 < lines.length) { j++; stmt += '\n' + lines[j]; }
      if (/from\s*['"]\.\/hoi1936\.js/.test(stmt)) { s = i; e = j; break; }
    }
  }
  check(s >= 0, '找不到 core/hoi1936.js 的 import 块');
  let block = lines.slice(s, e + 1).join('\n');
  for (const name of DEAD) {
    const re = new RegExp('(^|[\\s,{])' + name + '\\s*(,|\\})', 'm');
    if (!re.test(block)) { console.log('  · ' + name + ' 不在 import 块里'); continue; }
    block = block.replace(re, (m, p1, p2) => (p2 === ',' ? p1 : p1));
    log.push('import 剔掉 ' + name);
  }
  lines.splice(s, e - s + 1, ...block.split('\n'));
}

// ---- 3) 建号时的 1936 分支 ----
{
  const i = lines.findIndex((l) => l.includes("if (mode === 'hoi1936') {"));
  check(i >= 0, '找不到建号时的 hoi1936 分支');
  let top = i;
  while (top > 0 && /^\s*(\/\/|\*|\/\*)/.test(lines[top - 1])) top--;
  let d = 0, end = -1;
  for (let j = i; j < lines.length; j++) {
    for (const ch of lines[j]) { if (ch === '{') d++; else if (ch === '}') d--; }
    if (d === 0 && j > i) { end = j; break; }
  }
  check(end > i, '1936 开局分支未闭合');
  console.log('  删掉第 ' + (top + 1) + '~' + (end + 1) + ' 行（建号时的 1936 分支）');
  lines.splice(top, end - top + 1);
  log.push('删建号时的 1936 分支');
}

// ---- 4) setHoiDeps 调用（1936 专属的依赖注入） ----
{
  const i = lines.findIndex((l) => /^\s*setHoiDeps\(\{/.test(l));
  check(i >= 0, '找不到 setHoiDeps 调用');
  let d = 0, end = -1;
  for (let j = i; j < lines.length; j++) {
    for (const ch of lines[j]) { if (ch === '{') d++; else if (ch === '}') d--; }
    if (d === 0) { end = j; break; }
  }
  check(end > i, 'setHoiDeps 调用未闭合');
  lines.splice(i, end - i + 1);
  log.push('删 setHoiDeps 调用');
}

// ---- 5) tick 里的 1936 专属三件套 ----
{
  const i = lines.findIndex((l, idx) => l.includes("if (acc.scenario === 'hoi1936') {")
    && lines.slice(idx, idx + 6).join('\n').includes('tickDiploAI'));
  check(i >= 0, '找不到 tick 里的 1936 分支');
  let d = 0, end = -1;
  for (let j = i; j < lines.length; j++) {
    for (const ch of lines[j]) { if (ch === '{') d++; else if (ch === '}') d--; }
    if (d === 0 && j > i) { end = j; break; }
  }
  check(end > i, 'tick 的 1936 分支未闭合');
  let top = i;
  while (top > 0 && /^\s*(\/\/|\*|\/\*)/.test(lines[top - 1])) top--;
  console.log('  删掉第 ' + (top + 1) + '~' + (end + 1) + ' 行（tick 的 1936 分支）');
  lines.splice(top, end - top + 1);
  log.push('删 tick 的 1936 分支');
}

// ---- 6) START_MODES 里的 1936 选项 ----
{
  const i = lines.findIndex((l) => /id: 'hoi1936', nameCn:/.test(l));
  check(i >= 0, '找不到 START_MODES 的 1936 条目');
  let top = i;
  while (top > 0 && /^\s*(\/\/|\*|\/\*)/.test(lines[top - 1])) top--;
  let d = 0, end = -1;
  for (let j = i; j < lines.length; j++) {
    for (const ch of lines[j]) { if (ch === '{') d++; else if (ch === '}') d--; }
    if (d === 0 && j > i) { end = j; break; }
  }
  check(end > i, 'START_MODES 的 1936 条目未闭合');
  console.log('  删掉第 ' + (top + 1) + '~' + (end + 1) + ' 行（START_MODES 的 1936 条目）');
  lines.splice(top, end - top + 1);
  log.push('删 START_MODES 的 1936 条目');
}

// ---- 7) apply1936Start 整个函数 ----
{
  const i = lines.findIndex((l) => /function apply1936Start\(/.test(l));
  check(i >= 0, '找不到 apply1936Start');
  let d = 0, end = -1;
  for (let j = i; j < lines.length; j++) {
    for (const ch of lines[j]) { if (ch === '{') d++; else if (ch === '}') d--; }
    if (d === 0 && j > i) { end = j; break; }
  }
  check(end > i, 'apply1936Start 未闭合');
  let top = i;
  while (top > 0 && /^\s*(\/\/|\*|\/\*)/.test(lines[top - 1])) top--;
  console.log('  删掉第 ' + (top + 1) + '~' + (end + 1) + ' 行（apply1936Start）');
  lines.splice(top, end - top + 1);
  log.push('删 apply1936Start');
}

writeFileSync(FILE, lines.join('\n'), 'utf8');
console.log('\n✓ ' + log.length + ' 处改动：');
log.forEach((l) => console.log('  · ' + l));
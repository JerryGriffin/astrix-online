// v0.4.19 第一步：把 data/hoi1936.js 里「科幻路径仍需要」的通用常量抽到中性命名的
// js/data/scenario_common.js，然后 WWII 数据即可整段删除。
//
// 分析结论（docs/analyze_scenario_deps.mjs）：core/hoi1936.js 从 data/hoi1936.js
// 引入 34 个符号，其中只有 8 个在科幻路径上被真正调用：
//   ARMY_MEN / popOf / workforceOf / ARMY_POWER_PER_DIV / GEAR_PARTS / warshipTonnageOf
//   （+ HOI_SCENARIO_ID，但它只用于 `acc.scenario === HOI_SCENARIO_ID` 这种恒假比较）
// 其余 26 个全是 WWII 数据：真实国家表 / 阵营名 / 制海权 / 史实年历 / 战后处置 /
// 德国附庸 / 军舰线 / 宣战正当化 —— 全部可删。
import { readFileSync, writeFileSync } from 'fs';

const SRC = 'js/data/hoi1936.js';
const data = readFileSync(SRC, 'utf8');
const lines = data.split(/\r?\n/);

const KEEP = ['ARMY_MEN', 'popOf', 'workforceOf', 'ARMY_POWER_PER_DIV', 'GEAR_PARTS', 'warshipTonnageOf'];

/** 从一行起，用大括号配平切出一个完整的顶层定义（含前置注释） */
function sliceDef(name) {
  let s = -1;
  for (let i = 0; i < lines.length; i++) {
    if (new RegExp('^export (?:const|function|let|var) ' + name + '\\b').test(lines[i])) { s = i; break; }
  }
  if (s < 0) return null;
  // 带上紧邻的注释块
  let top = s;
  while (top > 0 && /^\s*(\/\/|\*|\/\*)/.test(lines[top - 1])) top--;
  const head = lines[s];
  if (!head.includes('{')) {
    return { top, end: s, text: lines.slice(top, s + 1).join('\n') };
  }
  let d = 0, e = -1;
  for (let j = s; j < lines.length; j++) {
    for (const ch of lines[j]) { if (ch === '{') d++; else if (ch === '}') d--; }
    if (d === 0) { e = j; break; }
  }
  return { top, end: e, text: lines.slice(top, e + 1).join('\n') };
}

const picked = [];
for (const k of KEEP) {
  const def = sliceDef(k);
  if (!def) { console.error('✗ 找不到 ' + k); process.exit(1); }
  picked.push(def);
  console.log('  抽取 ' + k.padEnd(24) + '第 ' + (def.top + 1) + '~' + (def.end + 1) + ' 行');
}

const HEADER = [
  '/**',
  ' * 剧本通用常量（v0.4.19 新建）',
  ' *',
  ' * 这些常量原先散在 js/data/hoi1936.js 里 —— 那份文件是一整套二战地球语境的数据',
  ' * （真实国家名、制海权、史实年历、战后处置、德国附庸……）。但其中有 7 个是**通用**的：',
  ' * 它们描述的是「一个建制师有多少人、每单位工业配多少工人、每艘船算多少吨」这类',
  ' * 与世界观无关的数值，科幻模式同样要用。',
  ' *',
  ' * v0.4.19 把这 7 个抽到这里并给文件一个中立的名字，WWII 数据部分则整体删除。',
  ' */',
  '',
  '',
].join('\n');

const OUT = HEADER + picked.map((d) => d.text).join('\n\n') + '\n';
writeFileSync('js/data/scenario_common.js', OUT, 'utf8');
console.log('\n✓ 已生成 js/data/scenario_common.js（' + OUT.split('\n').length + ' 行）');
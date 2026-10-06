// v0.4.19 第二步：从 core/hoi1936.js 删除 9 个完全依赖 WWII 数据的函数，并改写 import。
//
// 做法：**按行号倒序删除**（从后往前删，前面行的号才不受影响），
//   这正是上一轮翻车的地方 —— 正序删 + 正则跨行匹配把 state.js 改坏了。
//   每删完立刻做括号配平与语法校验。
import { readFileSync, writeFileSync } from 'fs';

const FILE = 'js/core/hoi1936.js';
let src = readFileSync(FILE, 'utf8');
const EOL = src.includes('\r\n') ? '\r\n' : '\n';
let lines = src.split(EOL).join('\n').split('\n');

// 9 个纯 WWII 函数（行号来自 docs/step2_analyze_core.mjs，1-based 闭区间）
const CUT = [
  ['hoiAdapter', 57, 89],
  ['fociOf', 186, 198],
  ['canInvadeFrom', 327, 332],
  ['tickDiploAI', 739, 803],
  ['applyPostwarChoice', 941, 976],
  ['setupGermanPuppets', 979, 987],
  ['histWarGateFor', 1177, 1215],
  ['listHistTargets', 1218, 1233],
  ['startJustify', 1235, 1243],
];

// 先校验每段确实是那个函数（避免行号漂移导致误删）
for (const [name, a, b] of CUT) {
  const head = lines[a - 1] || '';
  if (!new RegExp('function ' + name + '\\b').test(head)) {
    console.error('✗ 第 ' + a + ' 行不是 ' + name + '，实际是：' + head.trim().slice(0, 70));
    process.exit(1);
  }
}

// 倒序删除
for (const [name, a, b] of [...CUT].reverse()) {
  let top = a - 1;
  while (top > 0 && /^\s*(\/\/|\*|\/\*)/.test(lines[top - 1])) top--;
  lines.splice(top, b - top);
  console.log('  ✓ 删掉 ' + name);
}

src = lines.join('\n');

// ---- 改写 import：通用常量走 scenario_common.js，WWII 那批整个去掉 ----
const oldImp = src.match(/import \{[^}]*\} from '\.\.\/data\/hoi1936\.js\?v=[^']*';/);
if (!oldImp) { console.error('✗ 找不到 data/hoi1936.js 的 import'); process.exit(1); }
const NEW_IMP = [
  "// v0.4.19：原先这里一次性引入 34 个 WWII 符号（真实国家表 / 阵营名 / 制海权 /",
  "//   史实年历 / 战后处置 / 德国附庸 / 军舰线 / 宣战正当化）。分析后确认科幻路径",
  "//   只用到其中 7 个与世界观无关的数值常量，已抽到 data/scenario_common.js；",
  "//   其余 26 个 WWII 数据与依赖它们的 9 个函数已整体删除。",
  "import {",
  "  ARMY_MEN, popOf, workforceOf, ARMY_POWER_PER_DIV, GEAR_PARTS, warshipTonnageOf,",
  "} from '../data/scenario_common.js?v=58.9';",
].join('\n');
src = src.replace(oldImp[0], () => NEW_IMP);

writeFileSync(FILE, src.split('\n').join(EOL), 'utf8');
console.log('\n✓ import 已改写');
console.log('  行数 ' + lines.length + ' → ' + src.split('\n').length);
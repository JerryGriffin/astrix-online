import { readFileSync, writeFileSync } from 'fs';

const FILE = 'js/ui/hoi.js';
let src = readFileSync(FILE, 'utf8');
const EOL = src.includes('\r\n') ? '\r\n' : '\n';
src = src.split(EOL).join('\n');
const log = [];
function rep(from, to, why) {
  if (!src.includes(from)) { console.error('✗ ' + why + '\n--- 找的是 ---\n' + JSON.stringify(from)); process.exit(1); }
  src = src.replace(from, () => to);
  log.push('  ✓ ' + why);
}

// ① import 块：去掉已删的两个函数（按行处理，避免缩进/换行差异）
{
  const lines = src.split('\n');
  const i = lines.findIndex((l) => l.includes('listHistTargets') && l.includes('histWarGateFor'));
  if (i < 0) { console.error('✗ 找不到 listHistTargets/histWarGateFor 那一行'); process.exit(1); }
  console.log('  · 第 ' + (i + 1) + ' 行原文: ' + JSON.stringify(lines[i]));
  if (lines[i].replace(/\/\/[^\n]*/g, '').replace(/[,\s]/g, '').includes('listHistTargets')
      && lines[i].replace(/\/\/[^\n]*/g, '').replace(/[,\s]/g, '').includes('histWarGateFor')
      && lines[i].includes(',')) {
    lines.splice(i, 1);
    log.push('  ✓ import 去掉 listHistTargets / histWarGateFor');
  } else {
    lines[i] = lines[i].replace(/\s*listHistTargets\s*,\s*/, ' ').replace(/\s*,?\s*histWarGateFor\s*,?\s*/, ' ');
    log.push('  ✓ import 去掉 listHistTargets / histWarGateFor（同行）');
  }
  src = lines.join('\n');
}

rep("  const isHoi = acc.scenario === HOI_SCENARIO_ID;",
  [
    '  // v0.4.19：1936 mod 已删除（原先是 `acc.scenario === HOI_SCENARIO_ID`）。',
    '  //   acc.scenario 现在永远是科幻值，该判定恒为 false。',
    '  //   下面那几处 `if (isHoi)` 是**永不进入**的 1936 专属界面分支 —— 保留它们是有意的：',
    '  //   它们正好标出「哪些界面元素属于 1936 专属」，日后要彻底清理时一眼可见，',
    '  //   不必再从别处推断。',
    '  const isHoi = false;',
  ].join('\n'),
  'isHoi 改为常量 false');

rep('backgroundOf, HOI_SCENARIO_ID,', 'backgroundOf,', 'import 去掉 HOI_SCENARIO_ID');

writeFileSync(FILE, src.split('\n').join(EOL), 'utf8');
console.log(log.join('\n'));
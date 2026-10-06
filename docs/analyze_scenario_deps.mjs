// v0.4.19：分析「科幻路径真正用到」哪些数据常量（修正版：先定位 import 语句本身）
import { readFileSync } from 'fs';

const core = readFileSync('js/core/hoi1936.js', 'utf8');
const data = readFileSync('js/data/hoi1936.js', 'utf8');
const lines = core.split(/\r?\n/);

// 找出所有 import { ... } from '.../data/hoi1936.js' 语句（含多行）
const imported = new Set();
for (let i = 0; i < lines.length; i++) {
  if (!/^\s*import\s*\{/.test(lines[i])) continue;
  // 收集到结束的 from '...' 为止
  let stmt = lines[i];
  let j = i;
  while (!/from\s*['"][^'"]+\/data\/hoi1936\.js/.test(stmt) && j + 1 < lines.length) {
    j++;
    stmt += '\n' + lines[j];
  }
  if (!/from\s*['"][^'"]+\/data\/hoi1936\.js/.test(stmt)) continue;
  const braces = stmt.slice(stmt.indexOf('{') + 1, stmt.indexOf('}'));
  for (const raw of braces.split(',')) {
    const s = raw.replace(/\/\/[^\n]*/g, '').trim().split(/\s+as\s+/)[0].trim();
    if (s) imported.add(s);
  }
  i = j;
}

const SCI_FNS = ['sciAdapterOf', 'setupArmies', 'setupLines', 'setupBloc', 'setupFactories',
  'backgroundOf', 'repairScenarioEstates', 'staffBuildings', 'ensureFocus', 'tickFocus',
  'ensureSeas', 'blocNameOf', 'popOf', 'workforceOf', 'scenarioDateOf', 'gameDaysOf',
  'applyInfiniteReserve', 'setupColony', 'setupNavy', 'ensureShipNames'];

function bodyOf(name) {
  const i = core.search(new RegExp('(export )?(async )?function ' + name + '\\b'));
  if (i < 0) return '';
  const lb = core.indexOf('{', core.indexOf('(', i));
  let d = 0;
  for (let j = lb; j < core.length; j++) {
    if (core[j] === '{') d++;
    else if (core[j] === '}') { d--; if (d === 0) return core.slice(lb, j + 1); }
  }
  return '';
}

const sciText = SCI_FNS.map(bodyOf).join('\n');
const generic = [], ww2 = [];
for (const sym of imported) {
  (new RegExp('\\b' + sym + '\\b').test(sciText) ? generic : ww2).push(sym);
}

console.log('core/hoi1936.js 从 data/hoi1936.js 引入 ' + imported.size + ' 个符号\n');
console.log('【科幻路径用到 → 必须保留】' + generic.length + ' 个：');
console.log('  ' + generic.join(', ') + '\n');
console.log('【仅 1936 用到 → 可删】' + ww2.length + ' 个：');
console.log('  ' + ww2.join(', ') + '\n');

console.log('各自在 data/hoi1936.js 的定义位置：');
for (const sym of ww2.concat(generic)) {
  const m = new RegExp('export (?:const|function|let|var) ' + sym + '\\b').exec(data);
  if (m) {
    const ln = data.slice(0, m.index).split('\n').length;
    console.log('  ' + (generic.includes(sym) ? '[保留] ' : '[删  ] ') + sym.padEnd(26) + '第 ' + ln + ' 行');
  }
}
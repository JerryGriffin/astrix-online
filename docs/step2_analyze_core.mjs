// v0.4.19 第二步前置：列出 core/hoi1936.js 里每个顶层函数依赖哪些 WWII 数据符号
import { readFileSync } from 'fs';

const core = readFileSync('js/core/hoi1936.js', 'utf8');
const lines = core.split(/\r?\n/);

const WWII = ['HOI_NATIONS', 'HOI_BY_ID', 'HOI_MAIN_NATIONS', 'HOI_MAIN_BY_ID', 'HOI_DEEP',
  'HOI_SEAS', 'BLOC_NAME', 'WORKFORCE_PER_IC', 'NAVY_MUL', 'SHIP_NAMES', 'ARMY_BP_NAME',
  'HOI_BG', 'SHIP_CLASSES', 'POST_WAR_OPTIONS', 'GER_PUPPETS', 'ARMY_BP_LINE', 'WAR_LINE',
  'EXTRA_FOCUS_TEMPLATE', 'JUSTIFY_DAYS', 'NATION_SEA_REGION', 'SEA_INITIAL_CONTROL',
  'NAVAL_INVASION_CONTROL', 'HIST_TIMELINE', 'histEventsAt', 'histWarBetween', 'histWarTargetsFor',
  'HOI_SCENARIO_ID'];

// 找出所有顶层 function / export function 的位置与行范围
const defs = [];
for (let i = 0; i < lines.length; i++) {
  const m = lines[i].match(/^(?:export\s+)?(?:async\s+)?function\s+(\w+)\s*\(/);
  if (!m) continue;
  let d = 0, e = i, started = false;
  for (let j = i; j < lines.length; j++) {
    for (const ch of lines[j]) {
      if (ch === '{') { d++; started = true; }
      else if (ch === '}') { d--; }
    }
    if (started && d === 0) { e = j; break; }
  }
  defs.push({ name: m[1], start: i, end: e, body: lines.slice(i, e + 1).join('\n') });
}

const pure = [], mixed = [];
for (const d of defs) {
  const hits = WWII.filter((s) => new RegExp('\\b' + s + '\\b').test(d.body));
  if (hits.length) {
    (hits.length === 1 && hits[0] === 'HOI_SCENARIO_ID' ? mixed : pure).push({ ...d, hits });
  }
}

console.log('core/hoi1936.js 顶层函数共 ' + defs.length + ' 个\n');
console.log('【完全依赖 WWII 数据 → 可删】' + pure.length + ' 个：');
for (const d of pure) console.log('  ' + d.name.padEnd(26) + '第 ' + (d.start + 1) + '~' + (d.end + 1) + ' 行  ← ' + d.hits.join(', '));

console.log('\n【只用到 HOI_SCENARIO_ID（恒假比较）→ 可保留但要换写法】' + mixed.length + ' 个：');
for (const d of mixed) console.log('  ' + d.name.padEnd(26) + '第 ' + (d.start + 1) + ' 行');

console.log('\n【完全不含 WWII 符号 → 必须保留】');
for (const d of defs) {
  if (!WWII.some((s) => new RegExp('\\b' + s + '\\b').test(d.body))) console.log('  ' + d.name);
}
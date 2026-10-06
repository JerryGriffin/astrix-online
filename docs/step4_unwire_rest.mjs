// v0.4.19 第四步：解开 battle.js / theater.js / treaty.js / start.js / hoi.js 的引用，
// 然后删除 js/data/hoi1936.js。
import { readFileSync, writeFileSync, rmSync, existsSync } from 'fs';

const log = [], fail = [];
function edit(file, fn, why) {
  let src = readFileSync(file, 'utf8');
  const EOL = src.includes('\r\n') ? '\r\n' : '\n';
  const before = src;
  src = fn(src.split(EOL).join('\n'));
  if (src === before.split(EOL).join('\n')) { fail.push(file + ' → ' + why); return; }
  writeFileSync(file, src.split('\n').join(EOL), 'utf8');
  log.push('  ✓ ' + file.padEnd(22) + why);
}

// ---- battle.js：HOI_BY_ID 兜底查表 → 空对象 ----
edit('js/core/battle.js', (s) => {
  const re = /^import \{ HOI_BY_ID \} from '\.\.\/data\/hoi1936\.js\?v=[^']*';\r?\n/m;
  if (!re.test(s)) throw new Error('battle.js 找不到 HOI_BY_ID import');
  return s.replace(re, () =>
    '// v0.4.19：原先 import HOI_BY_ID 做势力名/战力兜底查表。正常模式下 owner 是\n'
    + '//   sci_* 势力 id，查 1936 国家表必然 miss，代码本来就只走 fallback 分支\n'
    + '//   （`n ? n.xxx : 0 / 0.5`）。1936 mod 已删除，这里换成空对象，行为不变。\n'
    + 'const HOI_BY_ID = Object.create(null);\n');
}, 'HOI_BY_ID 兜底表 → 空对象');

// ---- treaty.js：同上 ----
edit('js/core/treaty.js', (s) => {
  const re = /^import \{ HOI_BY_ID \} from '\.\.\/data\/hoi1936\.js\?v=[^']*';\r?\n/m;
  if (!re.test(s)) throw new Error('treaty.js 找不到 HOI_BY_ID import');
  return s.replace(re, () =>
    '// v0.4.19：同上 —— 1936 已删除，兜底查表换成空对象，行为不变\n'
    + 'const HOI_BY_ID = Object.create(null);\n');
}, 'HOI_BY_ID 兜底表 → 空对象');

// ---- theater.js：删 import + isHoi 分支 ----
edit('js/core/theater.js', (s) => {
  s = s.replace(/^import \{ HOI_BY_ID, HOI_MAIN_NATIONS \} from '\.\.\/data\/hoi1936\.js\?v=[^']*';\r?\n/m,
    () => '// v0.4.19：1936 mod 已删除（原先 import HOI_BY_ID / HOI_MAIN_NATIONS）\n');
  s = s.replace(/[ \t]*const scenario = String\(acc\.scenario \|\| ''\);\r?\n[ \t]*const isHoi = scenario === 'hoi1936';\r?\n/, '');
  s = s.replace(
    /const rivals = \(isHoi \? HOI_MAIN_NATIONS : \(sciFactions && sciFactions\.length \? sciFactions : GENERIC_FACTIONS\)\)/,
    'const rivals = (sciFactions && sciFactions.length ? sciFactions : GENERIC_FACTIONS)');
  return s;
}, '删 HOI import 与 isHoi 分支');

// ---- start.js：删 HOI_NATIONS ----
edit('js/ui/start.js', (s) => {
  s = s.replace(/^import \{ HOI_NATIONS \} from '\.\.\/data\/hoi1936\.js\?v=[^']*';.*\r?\n/m, () => '');
  s = s.replace(/const factionList = \(\) => \(isSci\(\) \? SCI_NATIONS : HOI_NATIONS\);/,
    'const factionList = () => SCI_NATIONS;   // v0.4.19：1936 已删除，恒为科幻势力');
  s = s.replace(/let countryId = \(isSci\(\) \? SCI_NATIONS\[0\] : HOI_NATIONS\[0\]\)\.id;/,
    'let countryId = SCI_NATIONS[0].id;');
  return s;
}, '删 HOI_NATIONS 与 1936 分支');

// ---- hoi.js：HOI_BY_ID / HOI_SCENARIO_ID / HIST_TIMELINE ----
edit('js/ui/hoi.js', (s) => {
  // HOI_BY_ID 只作为 factionXxx() 的兜底表 → 空对象
  s = s.replace(/^import \{ HOI_BY_ID, HIST_TIMELINE\} from '\.\.\/data\/hoi1936\.js\?v=[^']*';\r?\n/m,
    () => '// v0.4.19：HOI_BY_ID / HIST_TIMELINE 随 1936 mod 一并删除。\n'
      + '//   战区属主是 sci_* 势力 id，查 1936 国家表必然 miss，factionXxx() 本来就走\n'
      + '//   自己的兜底分支；HIST_TIMELINE 只服务于 1936 的历史门控（已删）。\n'
      + 'const HOI_BY_ID = Object.create(null);\n'
      + 'const HIST_TIMELINE = [];\n');
  return s;
}, 'HOI_BY_ID / HIST_TIMELINE → 空值');

console.log(log.join('\n'));
if (fail.length) { console.log('\n未完成：'); fail.forEach((f) => console.log('  ✗ ' + f)); process.exit(1); }

// ---- 删除 WWII 数据文件 ----
for (const p of ['js/data/hoi1936.js']) {
  if (!existsSync(p)) { console.log('  · ' + p + ' 已不存在'); continue; }
  const n = readFileSync(p, 'utf8').split('\n').length;
  rmSync(p, { force: true });
  console.log('\n  ✓ 删除 ' + p + '（' + n + ' 行）');
}
// v0.4.18（Stage B 第二批）：解开 state.js / start.js / hoi.js 对 mod 的引用，然后删文件
import { readFileSync, writeFileSync, existsSync, rmSync } from 'fs';

const log = [], fail = [];
function lineSub(file, re, to, why) {
  let src = readFileSync(file, 'utf8');
  const EOL = src.includes('\r\n') ? '\r\n' : '\n';
  src = src.split(EOL).join('\n');
  if (!re.test(src)) { fail.push(file + ' → ' + why); return; }
  const b = src; src = src.replace(re, () => to);
  if (b === src) { fail.push(file + ' → ' + why + '（无变化）'); return; }
  writeFileSync(file, src.split('\n').join(EOL), 'utf8');
  log.push('  ✓ ' + file.padEnd(22) + why);
}

// ---------------------------------------------------------------- state.js
lineSub('js/core/state.js',
  /^import \{ HOI_NATIONS, HOI_BY_ID, HOI_SCENARIO_ID \} from '\.\.\/data\/hoi1936\.js\?v=[^']*';.*\r?\n/m,
  "",
  '删掉 HOI_NATIONS/HOI_BY_ID/HOI_SCENARIO_ID 的 import');

// 建号时的 1936 分支
lineSub('js/core/state.js',
  /\r?\n[^\n]*官方 mod「1936 剧本」开局[\s\S]*?\r?\n    \}\r?\n(?=\s*return acc;)/,
  "",
  '删掉建号时的 hoi1936 开局分支');

// apply1936Start 整个函数
{
  const FILE = 'js/core/state.js';
  let src = readFileSync(FILE, 'utf8');
  const EOL = src.includes('\r\n') ? '\r\n' : '\n';
  let lines = src.split(EOL).join('\n').split('\n');
  const s = lines.findIndex((l) => /function apply1936Start\(/.test(l));
  if (s < 0) fail.push(FILE + ' → 找不到 apply1936Start');
  else {
    let depth = 0, end = -1;
    for (let i = s; i < lines.length; i++) {
      for (const ch of lines[i]) { if (ch === '{') depth++; else if (ch === '}') depth--; }
      if (depth === 0 && i > s) { end = i; break; }
    }
    if (end < 0) fail.push(FILE + ' → apply1936Start 未闭合');
    else {
      let top = s;
      while (top > 0 && /^\s*(\/\/|\*|\/\*)/.test(lines[top - 1])) top--;
      console.log('  state.js 删掉第 ' + (top + 1) + ' ~ ' + (end + 1) + ' 行（apply1936Start）');
      lines.splice(top, end - top + 1);
      writeFileSync(FILE, lines.join('\n').split('\n').join(EOL), 'utf8');
      log.push('  ✓ js/core/state.js        删掉 apply1936Start（只在 mode===\'hoi1936\' 可达）');
    }
  }
}
// setupGermanPuppets 调用
lineSub('js/core/state.js',
  /^.*setupGermanPuppets\(acc\).*\r?\n/m,
  "",
  '删掉 setupGermanPuppets 调用（德国附庸）');

// 轨道 id 迁移（老存档 → 中性命名）
lineSub('js/core/state.js',
  /^\s*try \{ setupGermanPuppets\(acc\); \} catch \(e\) \{ softFail\('德国附庸', e\); \}\r?\n/m,
  "",
  '清理残留');

// ---------------------------------------------------------------- start.js
lineSub('js/ui/start.js',
  /^import \{ HOI_NATIONS \} from '\.\.\/data\/hoi1936\.js\?v=[^']*';.*\r?\n/m,
  "",
  '删掉 HOI_NATIONS 的 import');
lineSub('js/ui/start.js',
  /const factionList = \(\) => \(isSci\(\) \? SCI_NATIONS : HOI_NATIONS\);/,
  'const factionList = () => SCI_NATIONS;',
  'factionList 去掉 1936 分支（isSci 恒真）');
lineSub('js/ui/start.js',
  /let countryId = \(isSci\(\) \? SCI_NATIONS\[0\] : HOI_NATIONS\[0\]\)\.id;/,
  'let countryId = SCI_NATIONS[0].id;',
  'countryId 去掉 1936 分支');

console.log('\n--- 第二批完成 ---');
log.forEach((l) => console.log(l));
if (fail.length) { console.log('\n未完成：'); fail.forEach((f) => console.log('  ✗ ' + f)); process.exit(1); }
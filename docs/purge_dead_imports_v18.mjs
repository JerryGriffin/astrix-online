// v0.4.18：删掉 Stage A 之后新产生的 8 个死 import
import { readFileSync, writeFileSync } from 'fs';

const DEAD = {
  'js/ui/colony.js': ['HOI_NATIONS', 'startJustify', 'justifyStatusOf', 'canJustify', 'histWarGateFor'],
  'js/ui/galaxy.js': ['canJustify', 'justifyStatusOf', 'histWarGateFor'],
};

const isName = (s) => s.trim().split(/\s+as\s+/)[0].trim();
let removed = 0;
const problems = [];

for (const [file, names] of Object.entries(DEAD)) {
  let src = readFileSync(file, 'utf8');
  const EOL = src.includes('\r\n') ? '\r\n' : '\n';
  let lines = src.split(EOL).join('\n').split('\n');

  for (const name of names) {
    let hit = false;
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const lb = line.indexOf('{'), rb = line.indexOf('}', lb + 1);
      if (lb < 0 || rb < 0 || !/from\s*['"]/.test(line.slice(rb))) continue;
      const parts = line.slice(lb + 1, rb).split(',').map((s) => s.trim()).filter(Boolean);
      if (!parts.some((p) => isName(p) === name)) continue;
      const kept = parts.filter((p) => isName(p) !== name);
      if (kept.length) lines[i] = line.slice(0, lb + 1) + ' ' + kept.join(', ') + line.slice(rb);
      else lines.splice(i, 1);
      hit = true; removed++;
      break;
    }
    if (!hit) problems.push(file + ' → ' + name);
  }

  const after = lines.join('\n');
  for (const name of names) {
    if (new RegExp('\\b' + name + '\\b').test(after)) problems.push(file + ' → ' + name + '（删后仍被引用）');
  }
  writeFileSync(file, after.split('\n').join(EOL), 'utf8');
}

console.log('删除死 import ' + removed + ' 个');
if (problems.length) { console.log('未处理：'); problems.forEach((p) => console.log('  - ' + p)); process.exit(1); }
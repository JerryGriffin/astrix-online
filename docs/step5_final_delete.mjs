// v0.4.19 第五步（收尾）：解开最后两处引用，然后删除 WWII 数据文件
//
// ① core/hoi1936.js 第 29 行 `import { ELITE_DIVISIONS, ELITE_MUL } from '../data/hoi1936.js'`
//    —— 一处**潜伏的不一致**：setupArmies 走在科幻路径上，却拿 1936 的倍率做「王牌师」加成。
//    实测两个常量都是 3.2（SCI_ELITE_MUL === ELITE_MUL），所以改用科幻自己的
//    SCI_ELITE_MUL 是**零行为变化**，且把这条隐藏耦合摆平。
//    ELITE_DIVISIONS 则是纯死 import —— 第 396 行用的是适配器的 A.eliteDivisions。
// ② galaxy.js 的 HOI_NATIONS / HOI_BY_ID / HOI_SCENARIO_ID。
import { readFileSync, writeFileSync, rmSync, existsSync } from 'fs';

const log = [], fail = [];
function edit(file, fn, why) {
  let src = readFileSync(file, 'utf8');
  const EOL = src.includes('\r\n') ? '\r\n' : '\n';
  const norm = src.split(EOL).join('\n');
  const out = fn(norm);
  if (out === norm) { fail.push(file + ' → ' + why); return; }
  writeFileSync(file, out.split('\n').join(EOL), 'utf8');
  log.push('  ✓ ' + file.padEnd(22) + why);
}

// ---- ① core/hoi1936.js ----
edit('js/core/hoi1936.js', (s) => {
  const before = s;
  s = s.replace(/^import \{ ELITE_DIVISIONS, ELITE_MUL \} from '\.\.\/data\/hoi1936\.js\?v=[^']*';\r?\n/m,
    () => '// v0.4.19：原先从 data/hoi1936.js 引 ELITE_DIVISIONS / ELITE_MUL 给 setupArmies\n'
      + '//   的「王牌师」加成用 —— 科幻路径也走这个函数，却一直拿 1936 的常量，\n'
      + '//   是一处潜伏的跨剧本耦合（两个值实测都是 3.2，改用科幻自己的常量零行为变化）。\n'
      + '//   ELITE_DIVISIONS 则是死 import：第 396 行用的是适配器的 A.eliteDivisions。\n');
  s = s.replace(/\bELITE_MUL\b/g, 'SCI_ELITE_MUL');
  if (s === before) throw new Error('hoi1936.js 无变化');
  return s;
}, 'ELITE_MUL → SCI_ELITE_MUL，删死 import');

// ---- ② galaxy.js ----
edit('js/ui/galaxy.js', (s) => {
  s = s.replace(/^import \{ HOI_NATIONS, HOI_BY_ID, HOI_SCENARIO_ID \} from '\.\.\/data\/hoi1936\.js\?v=[^']*';.*\r?\n/m,
    () => '// v0.4.19：1936 mod 已删除。HOI_BY_ID 原本是势力名/旗/战力的兜底查表，\n'
      + '//   但正常模式的势力 id 是 fac_* / npc_*，查 1936 国家表必然 miss，\n'
      + '//   本来就走下面的兜底分支 —— 换成空对象行为不变。\n'
      + 'const HOI_BY_ID = Object.create(null);\n');
  // npcFactionsOf：删掉 1936 专属分支，恒返回 NPC_FACTIONS
  s = s.replace(
    /  if \(!acc \|\| acc\.scenario !== HOI_SCENARIO_ID\) return NPC_FACTIONS;[\s\S]*?\n  \}\)\;/,
    () => '  // v0.4.19：原先这里在 1936 剧本下把真实国家映射成可交易/可进攻的势力对象。\n'
      + '  //   1936 已删除，普通模式恒用通用 NPC 势力表。\n'
      + '  return NPC_FACTIONS;');
  return s;
}, 'HOI_* → 空对象，删 1936 势力映射分支');

console.log(log.join('\n'));
if (fail.length) { console.log('\n未完成：'); fail.forEach((f) => console.log('  ✗ ' + f)); process.exit(1); }

// ---- 全库确认无人引用后删除 ----
console.log('\n=== 删除前的最后确认 ===');
const { readdirSync, statSync } = await import('fs');
function walk(d, out = []) {
  for (const n of readdirSync(d)) {
    const p = d + '/' + n;
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.js$/.test(n)) out.push(p);
  }
  return out;
}
const still = [];
for (const f of walk('js')) {
  const lines = readFileSync(f, 'utf8').split(/\r?\n/);
  lines.forEach((l, i) => {
    if (/^\s*(\*|\/\/)/.test(l)) return;
    if (/data\/hoi1936/.test(l)) still.push(f + ':' + (i + 1) + '  ' + l.trim().slice(0, 80));
  });
}
if (still.length) {
  console.log('  仍有引用，未删除：');
  still.forEach((s) => console.log('    ' + s));
  process.exit(1);
}
console.log('  全库已无引用');

const n = readFileSync('js/data/hoi1936.js', 'utf8').split('\n').length;
rmSync('js/data/hoi1936.js', { force: true });
console.log('\n  ✓ 删除 js/data/hoi1936.js（' + n + ' 行 · 真实国家表 / 制海权 / 史实年历 / 德国附庸 / 军舰线）');
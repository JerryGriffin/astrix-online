// v0.4.18（Stage B 补完）：state.js 收尾 + 只删 data 文件
//
// ⚠️ 计划修正（实测得出，不是猜测）：
//   原以为 js/core/hoi1936.js（1285 行）也能删。实测 state.js 从它引入的 25 个符号里，
//   有 11 个**仍在普通模式（科幻势力）的活跃路径上**被调用：
//     sciAdapterOf(2) / setupArmies / setupLines / setupBloc / setupFactories /
//     staffBuildings / ensureFocus / tickFocus / ensureSeas / repairScenarioEstates / backgroundOf
//   也就是说 core/hoi1936.js 其实是**通用剧本引擎**（建军/产线/岗位/焦点树/圈层），
//   只是名字和里面一部分内容来自 1936。删掉它 = 普通模式直接崩。
//   因此本阶段**只删 js/data/hoi1936.js**（756 行，纯二战数据表：
//   真实国家名 / 海域 / 阵营 / 史实年历），core/hoi1936.js 保留并清理其用词。
import { readFileSync, writeFileSync, rmSync, existsSync } from 'fs';

const log = [], fail = [];
function lineSub(file, re, to, why) {
  let src = readFileSync(file, 'utf8');
  const EOL = src.includes('\r\n') ? '\r\n' : '\n';
  src = src.split(EOL).join('\n');
  if (!re.test(src)) { fail.push(file + ' → ' + why); return; }
  const b = src; src = src.replace(re, () => to);
  if (b === src) { fail.push(file + ' → ' + why + '（无变化）'); return; }
  writeFileSync(file, src.split('\n').join(EOL), 'utf8');
  log.push('  ✓ ' + file.padEnd(20) + why);
}

const F = 'js/core/state.js';

// ---- 1) 建号时的 1936 分支
lineSub(F,
  /\n[^\n]*官方 mod「1936 剧本」开局[\s\S]*?\n    \}\n/,
  "\n",
  '删掉建号时的 hoi1936 开局分支（apply1936Start 已删，这里是调用点）');

// ---- 2) setHoiDeps（只服务 1936 的依赖注入）
lineSub(F,
  /\n[^\n]*给 1936 剧本模块注入依赖[\s\S]*?\n  \}\);\n/,
  "\n",
  '删掉 setHoiDeps（1936 专属的依赖注入）');

// ---- 3) tick 里的 1936 专属三件套
lineSub(F,
  /\n[^\n]*但下面三件事仍是 1936 专属[\s\S]*?if \(acc\.scenario === 'hoi1936'\) \{[\s\S]*?\n          \}\n/,
  "\n",
  '删掉 tick 里的 tickDiploAI / tickWarsHoi4 / tickJustify（1936 专属）');

// ---- 4) START_MODES 里的冻结项
lineSub(F,
  /\n[^\n]*\*\*已冻结为 mod，默认不再显示在开局菜单\*\*[\s\S]*?需开启开发者模式。' \}],\n/,
  "\n  ];\n",
  'START_MODES 移除已删除的 1936 选项');

// ---- 5) state.js 的 import：剔掉 8 个已无引用的符号
{
  let src = readFileSync(F, 'utf8');
  const EOL = src.includes('\r\n') ? '\r\n' : '\n';
  src = src.split(EOL).join('\n');
  const dead = ['popOf', 'setupNavy', 'setupColony', 'ensureShipNames',
    'setupGermanPuppets', 'applyInfiniteReserve', 'scenarioDateOf', 'gameDaysOf', 'setHoiDeps'];
  let n = 0;
  for (const name of dead) {
    const body = src.split('\n').filter((l) => !/^\s*(import|from)/.test(l)).join('\n');
    if (new RegExp('\\b' + name + '\\b').test(body)) { fail.push(F + ' → ' + name + ' 仍被引用，跳过'); continue; }
    const re = new RegExp('(^|[\\s,{])' + name + '\\s*(,|\\})', 'm');
    const before = src;
    src = src.replace(re, (m, p1, p2) => (p2 === ',' ? p1 : p1));
    if (src !== before) n++;
  }
  writeFileSync(F, src.split('\n').join(EOL), 'utf8');
  log.push('  ✓ ' + F.padEnd(20) + 'import 剔掉 ' + n + ' 个已无引用的 1936 符号');
}

// ---- 6) 删除纯二战数据文件
for (const p of ['js/data/hoi1936.js']) {
  if (!existsSync(p)) { log.push('  · ' + p + ' 已不存在'); continue; }
  const n = readFileSync(p, 'utf8').split('\n').length;
  rmSync(p, { force: true });
  log.push('  ✓ 删除 ' + p + '（' + n + ' 行 · 真实国家名 / 海域 / 阵营 / 史实年历）');
}

console.log('\n--- 收尾完成 ---');
log.forEach((l) => console.log(l));
if (fail.length) { console.log('\n未完成：'); fail.forEach((f) => console.log('  ! ' + f)); }
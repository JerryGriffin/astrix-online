// v0.4.18：清除正常模式文件里的二战 / 1936 残留
//
// 审计（docs/find_ww2_exact.mjs）确认：1936 的 WWII 内容已经隔离在
// js/data/hoi1936.js 与 js/core/hoi1936.js 两个 mod 文件里，但**正常模式文件
// 里还残留着 1936 专属的 UI 分支与用词**，其中一处是会抛异常的活 bug。
//
// 本次处理（全部为「删除不可达代码」+ 「换词」，不改任何正常模式的数值/平衡）：
//   ① ui/galaxy.js  —— 删掉「正当化」宣战分支。
//      **这不只是措辞问题**：正常模式下 npcFactionsOf() 不会给势力对象挂 .hoi，
//      于是 j === null 走到 else 分支，渲染出一个「正当化战争」按钮；点击时执行
//      startJustify(acc, f.hoi.id) —— f.hoi 是 undefined，**直接抛 TypeError**。
//      即：正常模式的星际页上有一个必然崩溃的二战按钮。
//   ② ui/colony.js  —— 删掉 renderGreatPowers() 整个函数及其调用点。
//      它开头就 `if (acc.scenario !== 'hoi1936') return;`，1936 已隐藏 → 永远早退，
//      是纯粹的死代码，却把「列强 / 正当化 / 轴心国」带进了正常模式文件。
//   ③ core/battle.js —— 「过半师团已被打退」→「过半师团…」（师团是二战日军编制）。
//   ④ data/army_parts.js —— 「步兵」→「地面军」。
//   ⑤ data/scenario_sci.js —— 「赤铁矿装甲师」→「赤铁矿装甲旅」（装甲师是德军编制）。
import { readFileSync, writeFileSync } from 'fs';

const log = [];
const fail = [];
function edit(file, pairs) {
  let src = readFileSync(file, 'utf8');
  const EOL = src.includes('\r\n') ? '\r\n' : '\n';
  src = src.split(EOL).join('\n');
  for (const [from, to, why] of pairs) {
    const n = src.split(from).length - 1;
    if (n !== 1) { fail.push(file + ' → ' + why + '（命中 ' + n + ' 次，应为 1）'); continue; }
    src = src.replace(from, () => to);
    log.push('  ✓ ' + file + '  ' + why);
  }
  writeFileSync(file, src.split('\n').join(EOL), 'utf8');
}

// ---------------------------------------------------------------- ① galaxy.js
{
  const FILE = 'js/ui/galaxy.js';
  let src = readFileSync(FILE, 'utf8');
  const EOL = src.includes('\r\n') ? '\r\n' : '\n';
  const lines = src.split(EOL).join('\n').split('\n');

  // 定位 `} else if (!allied) {` 到与之配对的 `}` —— 用大括号配平，稳妥
  const start = lines.findIndex((l) => l.includes('} else if (!allied) {'));
  if (start < 0) { fail.push('galaxy.js → 找不到 else if (!allied) 块'); }
  else {
    let depth = 0, end = -1;
    for (let i = start; i < lines.length; i++) {
      for (const ch of lines[i]) { if (ch === '{') depth++; else if (ch === '}') depth--; }
      if (depth === 0 && i > start) { end = i; break; }
    }
    if (end < 0) { fail.push('galaxy.js → else if (!allied) 块未闭合'); }
    else {
      console.log('  galaxy.js 删掉第 ' + (start + 1) + ' ~ ' + (end + 1) + ' 行（1936 正当化宣战分支）');
      lines.splice(start, end - start + 1,
        '    } else if (!allied) {',
        '      // v0.4.18：这里原本是 1936 的「正当化」宣战分支，现已**删除**。',
        '      //   正常模式下 npcFactionsOf() 不会给势力对象挂 .hoi，于是 j === null，',
        '      //   代码会走到 else 分支渲染出一个「正当化战争」按钮；点击时执行',
        '      //   startJustify(acc, f.hoi.id) —— f.hoi 为 undefined，**直接抛 TypeError**。',
        '      //   即：正常模式的星际页上有一个必然崩溃的二战按钮。',
        '      //   宣战本就已在 v0.4.12 收敛到「战区」页，这里与战况分支一样只给指引。',
        '      const tip = el(\'span\', \'muted\', \'宣战请到「战区」页的「敌对势力」中操作\');',
        '      tip.style.fontSize = \'11px\';',
        '      act.appendChild(tip);',
        '    }');
      writeFileSync(FILE, lines.join('\n').split('\n').join(EOL), 'utf8');
      log.push('  ✓ galaxy.js  删除 1936 正当化宣战分支（修掉一个必然 TypeError 的按钮）');
    }
  }
}

// ---------------------------------------------------------------- ② colony.js
{
  const FILE = 'js/ui/colony.js';
  let src = readFileSync(FILE, 'utf8');
  const EOL = src.includes('\r\n') ? '\r\n' : '\n';
  const lines = src.split(EOL).join('\n').split('\n');

  // a) 删调用点
  const callAt = lines.findIndex((l) => l.includes('try { renderGreatPowers('));
  if (callAt >= 0) { lines.splice(callAt, 1); log.push('  ✓ colony.js  删掉 renderGreatPowers 调用点'); }
  else fail.push('colony.js → 找不到 renderGreatPowers 调用点');

  // b) 删函数定义（从它的注释块到函数体闭合）
  let s = lines.findIndex((l) => l.includes('function renderGreatPowers(root, ctx, acc) {'));
  if (s < 0) { fail.push('colony.js → 找不到 renderGreatPowers 定义'); }
  else {
    // 往上吃掉紧邻的注释与分隔线
    let top = s;
    while (top > 0 && /^\s*(\/\/|\/\*|\*)/.test(lines[top - 1])) top--;
    let depth = 0, end = -1;
    for (let i = s; i < lines.length; i++) {
      for (const ch of lines[i]) { if (ch === '{') depth++; else if (ch === '}') depth--; }
      if (depth === 0 && i > s) { end = i; break; }
    }
    if (end < 0) fail.push('colony.js → renderGreatPowers 未闭合');
    else {
      console.log('  colony.js 删掉第 ' + (top + 1) + ' ~ ' + (end + 1) + ' 行（renderGreatPowers 整个函数）');
      lines.splice(top, end - top + 1);
      log.push('  ✓ colony.js  删除 renderGreatPowers（scenario!==1936 早退的死代码）');
    }
  }
  writeFileSync(FILE, lines.join('\n').split('\n').join(EOL), 'utf8');
}

// ---------------------------------------------------------------- ③④⑤ 换词
edit('js/core/battle.js', [
  ["'过半师团已被打退，预备队不足'", "'过半建制已被打退，预备队不足'", '「师团」→「建制」（师团是二战日军编制）'],
]);
edit('js/data/army_parts.js', [
  ['单兵武器阶段即可列装的基础步兵', '单兵武器阶段即可列装的基础地面军', '「步兵」→「地面军」'],
  ["nameCn: '铁壁·重装步兵班'", "nameCn: '铁壁·重装地面班'", '「重装步兵班」→「重装地面班」'],
]);
edit('js/data/scenario_sci.js', [
  ["armyName: '赤铁矿装甲师'", "armyName: '赤铁矿装甲旅'", '「装甲师」→「装甲旅」（装甲师是德军编制）'],
]);

console.log('\n完成：');
log.forEach((l) => console.log(l));
if (fail.length) { console.log('\n未完成：'); fail.forEach((f) => console.log('  ✗ ' + f)); process.exit(1); }
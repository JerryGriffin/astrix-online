// v0.4.10 第二批去术语（第一批扫描后新发现的漏网）
import { readFileSync, writeFileSync } from 'fs';

const R = [
  ['js/ui/hoi.js', "addStat('陆军战力', fmtNum(totalArmyPowerOf(acc)));",
    "addStat('地面军战力', fmtNum(totalArmyPowerOf(acc)));", '战区页统计：陆军战力 → 地面军战力'],
  ['js/ui/hoi.js', "['陆军', my.armyCount + ' 支 · 战力 '",
    "['地面军', my.armyCount + ' 支 · 战力 '", '交战双方面板：我方陆军 → 地面军'],
  ['js/ui/hoi.js',
    "btn.title = gate.ok ? '从轨道瘫痪该战区守军，使其更易被登陆' : gate.reason;",
    "btn.title = gate.ok ? '从轨道瘫痪该战区守军，使其更易被地面突袭' : gate.reason;",
    '轨道打击按钮 title：登陆 → 地面突袭'],
  ['js/ui/hoi.js', "'本体编制：' + (deep.armyName || '登陆兵师')",
    "'本体编制：' + (deep.armyName || '轨道伞兵师')", '编制兜底名 → 轨道伞兵师'],
  ['js/ui/galaxy.js',
    "desc: n.desc + '　【人口 ' + n.popM + ' 百万 · 工业 ' + n.ic + ' · 陆军 ' + n.divisions",
    "desc: n.desc + '　【人口 ' + n.popM + ' 百万 · 工业 ' + n.ic + ' · 地面军 ' + n.divisions",
    '星际势力卡：陆军 → 地面军'],
  ['js/core/state.js', "+ '（1936 年 1 月 1 日 · 局势）'", "+ '（剧本开局 · 局势）'",
    '1936 分支的局势日志（该 mod 已冻结，顺手去掉年份）'],
];

let ok = 0, miss = 0;
for (const [file, from, to, why] of R) {
  const src = readFileSync(file, 'utf8');
  const n = src.split(from).length - 1;
  if (!n) { console.log('✗ 未命中 ' + file + '  [' + why + ']'); miss++; continue; }
  writeFileSync(file, src.split(from).join(to), 'utf8');
  console.log('✓ ' + file + '  [' + why + ']' + (n > 1 ? '  (命中 ' + n + ' 次)' : ''));
  ok++;
}
console.log('\n成功 ' + ok + ' / 未命中 ' + miss);
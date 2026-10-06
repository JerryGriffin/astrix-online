// ============================================================================
// v0.4.10 —— 彻底去二战 / 地球术语（仅限**普通模式**玩家可见的文案）
// ============================================================================
//
// 范围界定（重要）：
//   · `js/data/hoi1936.js` 与 `js/core/hoi1936.js` 里的真实国家名 / 战列舰 /
//     步兵师 / 制海权等**二战地球内容整体保留** —— 它们属于「风暴前夜」mod，
//     已从开局菜单隐藏、官方不再更新。按设计者的要求「原 1936 剧本相关内容
//     改为 mod」，删掉它们没有意义，只会让老存档打不开。
//   · 这里只清理**普通模式**（初登星球 / 漫溯深空 / 科幻势力）里玩家会看到的
//     二战词汇：陆军 / 海军 / 空军 / 登陆 / 巡洋舰 等。
//
// 做法：逐条 (文件, 原文, 新文) 精确替换，**找不到就报错**，不做模糊替换，
//       以免误伤注释、变量名或 1936 分支。
// ============================================================================

import { readFileSync, writeFileSync } from 'fs';

// [文件, 原文, 新文, 为什么]
const R = [
  // ---- 开局简报 / 势力信息（普通模式用的是 1620 那条；1813 是 1936 分支）----
  ['js/core/state.js',
    "+ ' · 陆军 ' + n.divisions + ' 师 · 海军 ' + n.navy + ' 舰 · 轨道火力 ' + n.airforce",
    "+ ' · 地面军 ' + n.divisions + ' 师 · 空间舰队 ' + n.navy + ' 舰 · 轨道火力 ' + n.airforce",
    '科幻势力开局简报：陆军/海军 → 地面军/空间舰队'],

  ['js/ui/colony.js',
    "+ ' · 陆军 ' + n.divisions + ' 师 · 海军 ' + n.navy + ' · 空军 ' + n.airforce",
    "+ ' · 地面军 ' + n.divisions + ' 师 · 空间舰队 ' + n.navy + ' · 轨道火力 ' + n.airforce",
    '殖民地势力概览：陆军/海军/空军 → 地面军/空间舰队/轨道火力'],

  ['js/ui/galaxy.js',
    "+ ' 师 · 海军 ' + n.navy + ' · 空军 ' + n.airforce + ' 百架'",
    "+ ' 师 · 空间舰队 ' + n.navy + ' · 轨道火力 ' + n.airforce",
    '势力列表：海军/空军百架 → 空间舰队/轨道火力'],

  ['js/ui/start.js',
    "+ ' · ' + (isSci() ? '轨道火力 ' : '空军 ') + n.airforce + '\\n'",
    "+ ' · 轨道火力 ' + n.airforce + '\\n'",
    '开局势力预览：两套剧本统一用「轨道火力」'],

  // ---- 兵种命名 ----
  ['js/core/battle.js',
    "nameCn: '登陆兵', full: '登陆兵师',",
    "nameCn: '轨道伞兵', full: '轨道伞兵师',",
    '「登陆兵」是 amphibious 二战词 → 轨道伞兵'],

  ['js/core/battle.js',
    "kindCn: d.kindCn || '登陆兵',",
    "kindCn: d.kindCn || '轨道伞兵',",
    '师级列表兜底名同步'],

  ['js/data/scenario_sci.js',
    "armyName: '轨道登陆军'",
    "armyName: '轨道投送军'",
    '科幻势力编制名：登陆 → 投送'],

  // ---- 战役 / 战区文案 ----
  ['js/core/theater.js',
    "'（该战区防御被瘫痪，更容易被登陆）',",
    "'（该战区防御被瘫痪，更容易被地面突袭）',",
    '战略轨道打击描述：登陆 → 地面突袭'],

  ['js/core/fleet.js',
    "reason: '军队系统开发中，登陆需要陆军部队（后续版本开放）'",
    "reason: '地面投送尚未开放（后续版本）'",
    '舰队指令 land 的说明：去掉「登陆/陆军」'],

  // ---- 舰队 UI ----
  ['js/ui/fleet.js',
    "land: '登陆',",
    "land: '地面投送',",
    '舰队指令名：登陆 → 地面投送'],

  ['js/ui/fleet.js',
    "'探索 / 低空防卫 / 巡航 / 运输（登陆待军队系统开放）。",
    "'探索 / 低空防卫 / 巡航 / 运输（地面投送待开放）。",
    '舰队指令说明同步'],

  // ---- 舰船命名 ----
  ['js/core/shipyard.js',
    "kind: 'cruiser', nameCn: '巡洋舰 MKI「游隼」',",
    "kind: 'cruiser', nameCn: '巡弋舰 MK-I「游隼」',",
    '巡洋舰 → 巡弋舰（kind 是内部标识，保持不变以兼容存档）'],

  ['js/data/ship_parts.js',
    "desc: '容纳小型飞行器的机库。每座可停放 2 架，让母舰不必亲自登陆。占地极大，只有大型以上外壳装得下。' },",
    "desc: '容纳小型飞行器的机库。每座可停放 2 架，让母舰不必亲自降轨。占地极大，只有大型以上外壳装得下。' },",
    '机库说明：登陆 → 降轨'],
];

let okCount = 0, failCount = 0;
for (const [file, from, to, why] of R) {
  let src;
  try { src = readFileSync(file, 'utf8'); }
  catch (e) { console.log('✗ 读不到 ' + file + ' → ' + e.message); failCount++; continue; }
  const n = src.split(from).length - 1;
  if (n === 0) { console.log('✗ 未命中 ' + file + '  [' + why + ']\n    原文: ' + from.slice(0, 70)); failCount++; continue; }
  if (n > 1) { console.log('⚠ ' + file + ' 命中 ' + n + ' 次（预期 1），已全部替换  [' + why + ']'); }
  const out = src.split(from).join(to);
  writeFileSync(file, out, 'utf8');   // 保持内容原样，Node 的 writeFileSync 不改换行风格
  console.log('✓ ' + file + '  [' + why + ']');
  okCount++;
}
console.log('\n成功 ' + okCount + ' / 未命中 ' + failCount);
if (failCount) process.exit(1);
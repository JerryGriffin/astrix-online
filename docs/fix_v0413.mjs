// v0.4.13 —— ①退役死 UI / ③补齐 GUI：舰队「地面投送」死按钮 + 残留二术语
import { readFileSync, writeFileSync } from 'fs';

const R = [
  // ---- ③ 舰队：移除必然失败的「地面投送」死按钮 ----
  ['js/ui/fleet.js',
    "const CMD_LABEL = {\n  explore: '探索', defense: '低空防卫', patrol: '巡航', transport: '运输', land: '地面投送',\n};",
    "// v0.4.13 入口整合：**`land`（地面投送）已从指令列表移除。**\n"
    + "//   它此前是**死 UI**：按钮照常渲染，但 core/fleet.js#startMission 一律返回\n"
    + "//   「地面投送尚未开放（后续版本）」—— 一个必然失败的按钮比没有更糟，\n"
    + "//   玩家只会以为整个舰队系统坏了。战区进攻由「战区」页直接调派军队完成\n"
    + "//   （选出发战区 → 目标 → 挑师），所以删掉它**不丢任何可用功能**。\n"
    + "const CMD_LABEL = {\n  explore: '探索', defense: '低空防卫', patrol: '巡航', transport: '运输',\n};",
    '舰队指令：移除死按钮 land'],
  ['js/ui/fleet.js',
    "  land: '地面投送尚未开放（后续版本）',\n",
    "",
    '清理对应的 CMD_TIP 条目'],
  ['js/ui/fleet.js',
    "（地面投送待开放）",
    "（进攻请到「战区」页调派军队）",
    '舰队指令说明：指向战区页'],

  // ---- ③ 军队：残留的二战「步兵」 ----
  ['js/ui/army.js',
    "即可列装基础步兵",
    "即可列装基础地面军",
    '军队页提示：列装基础步兵 → 基础地面军'],
];

let ok = 0, miss = 0;
for (const [file, from, to, why] of R) {
  const src = readFileSync(file, 'utf8');
  const n = src.split(from).length - 1;
  if (!n) { console.log('✗ 未命中 ' + file + '  [' + why + ']'); miss++; continue; }
  writeFileSync(file, src.split(from).join(to), 'utf8');
  console.log('✓ ' + file + '  [' + why + ']' + (n > 1 ? ' (命中 ' + n + ' 次)' : ''));
  ok++;
}
console.log('\n成功 ' + ok + ' / 未命中 ' + miss);
if (miss) process.exit(1);
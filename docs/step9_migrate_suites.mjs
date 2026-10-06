// v0.4.19 第九步：把 7 个自检套件从 1936 剧本迁到科幻剧本。
//
// v0.4.19 删除了 1936 mod，而这 7 个套件当年是**照着 1936 写的** —— 它们建账号时写
// `scenario: 'hoi1936'`、把属主设成 ger/fra、并按 HOI_MAIN_NATIONS 的规模断言
// （如「轨道投送点 >= 10」，那是 1936 的 9 家列强 + 本土）。剧本没了，断言自然落空。
//
// 这不是「测试坏了」，是**测试对象换了一个**：它们验证的机制（战区地图 / 战役 /
// 轨道控制 / 补给走廊）仍然存在于普通模式，只是要从科幻势力的视角验。
//
// 映射：1936 国家 id → 科幻势力 id（同为「我方 / 敌方」两个角色即可）
//   ger（我方）→ sci_martian
//   fra（敌方）→ sci_titan
import { readFileSync, writeFileSync } from 'fs';

const SUITES = ['battle', 'theater', 'v045', 'v047', 'v048', 'v049'];

// 逐条精确替换，避免误伤注释里的历史说明
const RULES = [
  ["scenario: 'hoi1936'", "scenario: 'scifi'"],
  ["scenario: 'hoi1936',", "scenario: 'scifi',"],
  ["'hoi1936'", "'scifi'"],
  ['"hoi1936"', "'scifi'"],
  ["nation: 'ger'", "nation: 'sci_martian'"],
  ["targetId: 'fra'", "targetId: 'sci_titan'"],
  ["targetName: '法国'", "targetName: '泰坦工业联合体'"],
  ["owner === 'ger'", "owner === 'sci_martian'"],
  ["owner !== 'ger'", "owner !== 'sci_martian'"],
  [".owner = 'ger'", ".owner = 'sci_martian'"],
  [".owner = 'fra'", ".owner = 'sci_titan'"],
  ["owner: 'ger'", "owner: 'sci_martian'"],
  ["owner: 'fra'", "owner: 'sci_titan'"],
];

const log = [];
for (const s of SUITES) {
  const FILE = 'docs/selfcheck_' + s + '.mjs';
  let src = readFileSync(FILE, 'utf8');
  const EOL = src.includes('\r\n') ? '\r\n' : '\n';
  src = src.split(EOL).join('\n');
  let n = 0;
  for (const [from, to] of RULES) {
    const c = src.split(from).length - 1;
    if (!c) continue;
    src = src.split(from).join(to);
    n += c;
  }
  if (!n) { log.push('  · ' + FILE + ' 无需改'); continue; }
  writeFileSync(FILE, src.split('\n').join(EOL), 'utf8');
  log.push('  ✓ ' + FILE.padEnd(30) + n + ' 处');
}

// theater 的轨道投送点阈值：1936 是 9 家列强 + 本土 = 10；科幻是 8 势力 + 本土 = 9
{
  const FILE = 'docs/selfcheck_theater.mjs';
  let src = readFileSync(FILE, 'utf8');
  const from = "t.regions.filter((r) => r.structure === 'orbital').length >= 10";
  const to = "t.regions.filter((r) => r.structure === 'orbital').length >= 9";
  if (src.includes(from)) {
    src = src.replace(from, () => to);
    writeFileSync(FILE, src, 'utf8');
    log.push('  ✓ theater 轨道投送点阈值 10 → 9（1936 九国 vs 科幻八势力）');
  }
}

console.log(log.join('\n'));
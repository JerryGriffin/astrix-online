// v0.4.13（③）重写 findDeployment：改用 battle.js/theater.js 的真实 API
// 之前那版是照字段名猜的，实测两处对不上：
//   · b.maxHours —— 原始 battle 对象上**没有**这个字段，只有 battleView() 的视图才补上；
//   · r.nameCn —— 战区未必有名字（hoi.js 里也是 `r.nameCn || r.id` 兜底）。
// 现在直接用 activeBattlesOf / regionById / BATTLE_MAX_HOURS，不再猜字段。
import { readFileSync, writeFileSync } from 'fs';

const FILE = 'js/ui/army.js';
let src = readFileSync(FILE, 'utf8');

const start = src.indexOf('function findDeployment(acc, armyId) {');
if (start < 0) { console.error('✗ 找不到 findDeployment'); process.exit(1); }
// 连带它上面的注释一起替换：从注释首行到函数结束的 '}\n'
const commentStart = src.lastIndexOf('// v0.4.13', start);
const bodyEnd = src.indexOf('\n}\n', start) + 3;
if (bodyEnd <= start) { console.error('✗ 找不到函数结尾'); process.exit(1); }

const repl = [
  '// v0.4.13（③）：查某支军队当前是否在某个进行中的战役里，以及它在哪个战区。',
  '//   刻意走 battle.js#activeBattlesOf 与 theater.js#regionById 这两个现成 API ——',
  '//   acc.battles 的字段（mine[].armyId / .state / hours / regionId）是引擎内部结构，',
  '//   直接读它一旦引擎改字段就会静默出错（v0.4.13 首次实现就踩了这个坑：',
  '//   原始 battle 对象上并没有 maxHours，只有 battleView() 的视图才补该字段）。',
  '//   交战上限取导出的 BATTLE_MAX_HOURS 常量，同样避免硬编码。',
  'function findDeployment(acc, armyId) {',
  '  const t = acc && acc.theater;',
  '  const battles = activeBattlesOf(acc);',
  '  for (const b of battles) {',
  '    const d = (b.mine || []).find((x) => x && x.armyId === armyId);',
  '    if (!d) continue;',
  '    const rg = b.regionId ? regionById(t, b.regionId) : null;',
  '    const stateCn = (',
  "      d.state === 'front' ? '接战中'",
  "      : d.state === 'reserve' ? '预备队'",
  "      : d.state === 'routed' ? '溃退整补中'",
  "      : d.state === 'done' ? '已撤出成建制'",
  "      : '待命');",
  '    return {',
  '      battleId: b.id, regionId: b.regionId || null,',
  '      regionName: (rg && (rg.nameCn || rg.id)) || \'未知战区\',',
  '      hours: Number(b.hours) || 0,',
  '      maxHours: BATTLE_MAX_HOURS,',
  '      state: d.state, stateCn,',
  '    };',
  '  }',
  '  return null;',
  '}',
  '',
  '',
].join('\n').replace(/\n/g, '\r\n');

src = src.slice(0, commentStart) + repl + src.slice(bodyEnd);
writeFileSync(FILE, src, 'utf8');

// ---- 补 import：activeBattlesOf / BATTLE_MAX_HOURS 来自 battle.js，
//      regionById 来自 theater.js。插在 renderArmyPage 之前，避免改动现有 import 顺序。 ----
let src2 = readFileSync(FILE, 'utf8');
const ANCHOR = 'export function renderArmyPage(root, ctx) {';
if (!src2.includes(ANCHOR)) { console.error('✗ 找不到 renderArmyPage 锚点'); process.exit(1); }
if (!/activeBattlesOf/.test(src2.split(ANCHOR)[0])) {
  const imp = [
    '// v0.4.13（③）部署徽标用到的引擎 API',
    "import { activeBattlesOf, BATTLE_MAX_HOURS } from '../core/battle.js?v=" + '52.3' + "';",
    "import { regionById } from '../core/theater.js?v=54.5';",
    '',
    '',
  ].join('\r\n');
  src2 = src2.replace(ANCHOR, imp + ANCHOR);
  writeFileSync(FILE, src2, 'utf8');
  console.log('✓ 重写 findDeployment + 补 import');
} else {
  console.log('· import 已存在');
}
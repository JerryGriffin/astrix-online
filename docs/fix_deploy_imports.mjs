// v0.4.13（③）给 army.js 补上部署徽标所需的两条 import
import { readFileSync, writeFileSync } from 'fs';

const FILE = 'js/ui/army.js';
let src = readFileSync(FILE, 'utf8');

const ANCHOR = 'export function renderArmyPage(root, ctx) {';

// 上一个脚本的判重有 bug（findDeployment 本身含 activeBattlesOf，落在锚点之前，
// 被误判成「import 已存在」）。这里改成直接查 import 语句本身。
const hasBattleImp = /^import \{[^}]*activeBattlesOf[^}]*\} from '\.\.\/core\/battle\.js/m.test(src);
const hasTheaterImp = /^import \{[^}]*regionById[^}]*\} from '\.\.\/core\/theater\.js/m.test(src);

if (hasBattleImp && hasTheaterImp) {
  console.log('· 两条 import 均已存在，无需改动');
} else {
  const imp = [
    '// v0.4.13（③）部署徽标用到的引擎 API：取进行中的战役、交战上限常量、查战区名',
    "import { activeBattlesOf, BATTLE_MAX_HOURS } from '../core/battle.js?v=53.4';",
    "import { regionById } from '../core/theater.js?v=53.4';",
    '',
    '',
  ].join('\r\n');
  src = src.replace(ANCHOR, imp + ANCHOR);
  writeFileSync(FILE, src, 'utf8');
  console.log('✓ 已插入 import');
}
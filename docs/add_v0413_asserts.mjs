// v0.4.13：往 selfcheck_fixes.mjs 追加入口整合 / GUI 的回归锁断言
import { readFileSync, writeFileSync } from 'fs';

const FILE = 'docs/selfcheck_fixes.mjs';
let src = readFileSync(FILE, 'utf8');
const EOL = src.includes('\r\n') ? '\r\n' : '\n';

if (src.includes('#v0.4.13 入口整合')) {
  console.log('· 断言已存在，跳过');
  process.exit(0);
}

// 用「console.log 通过/失败」那一整行做锚点，最稳（不受前导空格与换行风格影响）
const ANCHOR = "console.log('\\n通过 ' + pass + ' / 失败 ' + fail);";
if (!src.includes(ANCHOR)) {
  console.error('✗ 找不到结尾锚点');
  process.exit(1);
}

const lines = [
  '  // ---------------------------------------------------------------------------',
  '  // v0.4.13 入口整合 / GUI 补齐的回归锁',
  '  //   锁的是「不该再退化」的几件事：死按钮不能回来、并行入口不能复活、',
  '  //   部署徽标必须走引擎的真实 API（而不是照字段名猜）。',
  "  console.log('\\n#v0.4.13 入口整合 / GUI');",
  '  {',
  "    const fleet = srcOf('js/ui/fleet.js');",
  '    // ① 舰队「地面投送」是死按钮（core/fleet.js 一律返回「尚未开放」），不能回来',
  "    ok(!/land:\\s*'地面投送/.test(fleet), '舰队指令里没有死按钮 land');",
  "    ok(!/transport',\\s*'land'/.test(fleet), '舰队指令按钮循环不含 land');",
  "    ok(!/地面投送/.test(fleet), 'ui/fleet.js 不再出现「地面投送」字样');",
  '    // ② 战争操作只在战区页：galaxy.js 不该再有宣战 / 和平会议 / 投降的执行路径',
  "    const galaxy = srcOf('js/ui/galaxy.js');",
  "    ok(!/declareWar\\(/.test(galaxy), 'galaxy.js 不再调用 declareWar（宣战归战区页）');",
  "    ok(!/openPeaceConference\\(/.test(galaxy), 'galaxy.js 不再打开和平会议（归战区页）');",
  "    ok(!/surrenderWar\\(/.test(galaxy), 'galaxy.js 不再执行 surrenderWar（归战区页）');",
  "    ok(!galaxy.includes('* 0.35'), 'galaxy.js 不再按 35% 收投降赔款');",
  "    ok(/\\* 0\\.15/.test(srcOf('js/ui/hoi.js')), '投降赔款 15% 仍保留在战区页（没被误删）');",
  '  }',
  '  {',
  "    const army = srcOf('js/ui/army.js');",
  '    // ③ 补员按钮此前调用 getPlanetInstance 却从未 import → 浏览器里直接 ReferenceError',
  "    ok(/import \\{[^}]*getPlanetInstance[^}]*\\} from '\\.\\.\\/core\\/state\\.js/.test(army),",
  "      'army.js 已 import getPlanetInstance（否则补员按钮运行期报错）');",
  "    ok(!/步兵/.test(army), '军队页不再出现二战术语「步兵」');",
  '    // ④ 部署徽标必须走引擎真实 API，不能照字段名猜',
  '    //    原始 battle 对象上没有 maxHours，只有 battleView() 的视图才补该字段',
  '    ok(/function findDeployment\\(/.test(army), \'army.js 有 findDeployment 辅助函数\');',
  "    ok(/activeBattlesOf\\(acc\\)/.test(army), 'findDeployment 走 battle.js#activeBattlesOf');",
  "    ok(/regionById\\(t, b\\.regionId\\)/.test(army), 'findDeployment 走 theater.js#regionById 取战区名');",
  "    ok(/maxHours:\\s*BATTLE_MAX_HOURS/.test(army), '交战上限取导出常量 BATTLE_MAX_HOURS 而非硬编码');",
  "    ok(/rg\\.nameCn \\|\\| rg\\.id/.test(army), '战区名有 id 兜底（未必每个战区都有名字）');",
  "    ok(/army-deploy/.test(army), '军队行渲染 .army-deploy 徽标');",
  "    const css = srcOf('css/planet.css');",
  "    ok(/\\.army-deploy\\s*\\{/.test(css), '.army-deploy 有样式（否则徽标是裸文本）');",
  "    ok(/\\.army-deploy-tag\\s*\\{/.test(css), '.army-deploy-tag 有样式');",
  '  }',
  '',
].join(EOL);

src = src.replace(ANCHOR, lines + EOL + ANCHOR);
writeFileSync(FILE, src, 'utf8');
console.log('✓ 已追加 v0.4.13 断言（换行 ' + (EOL === '\r\n' ? 'CRLF' : 'LF') + '）');
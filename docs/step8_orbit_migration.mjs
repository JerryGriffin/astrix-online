// v0.4.19 第八步：老存档的轨道 id 迁移
//
// v0.4.19 把轨道圈层的内部键从地球海名（north_sea / baltic / atlantic…）改成
// 中性轨道名。acc.hoiSeas 是按 id 索引的，老存档若不迁移，新代码读不到旧键，
// 玩家的轨道控制度会凭空归零（= 制海权回到 0.5 中立）。
//
// 这里在 state.js 的 tick 里做一次幂等迁移：发现任何老 id 就整体重映射一次。
import { readFileSync, writeFileSync } from 'fs';

// ---- ① state.js：import ORBIT_ID_MIGRATION ----
{
  const FILE = 'js/core/state.js';
  let src = readFileSync(FILE, 'utf8');
  const EOL = src.includes('\r\n') ? '\r\n' : '\n';
  src = src.split(EOL).join('\n');
  const m = /import \{ ([^}]*) \} from '\.\.\/data\/scenario_sci\.js\?v=[^']*';/.exec(src);
  if (!m) { console.error('✗ state.js 找不到 scenario_sci 的 import'); process.exit(1); }
  if (!/ORBIT_ID_MIGRATION/.test(m[1])) {
    src = src.replace(m[0], () => m[0].replace(m[1], m[1] + ', ORBIT_ID_MIGRATION'));
  }
  writeFileSync(FILE, src.split('\n').join(EOL), 'utf8');
  console.log('  ✓ state.js 引入 ORBIT_ID_MIGRATION');
}

// ---- ② state.js：加迁移函数并在 tick 里调用 ----
{
  const FILE = 'js/core/state.js';
  let src = readFileSync(FILE, 'utf8');
  const EOL = src.includes('\r\n') ? '\r\n' : '\n');
  src = src.split(EOL).join('\n');

  const FN = [
    '/**',
    ' * v0.4.19：老存档的轨道圈层 id 迁移。',
    ' *',
    ' * 轨道圈层的内部键原是地球海名（north_sea / baltic / channel / med /',
    ' * atlantic / pacific_w / japan_sea），v0.4.19 改成中性轨道名。acc.hoiSeas 按',
    ' * id 索引，不迁移的话老存档读不到旧键，轨道控制度会凭空归零',
    ' *（制海权退回 0.5 中立），等于悄悄削弱了已有存档的战场态势。',
    ' *',
    ' * 幂等：迁移过一次的老 id 不会再出现，函数直接返回。',
    ' */',
    'export function migrateOrbitIds(acc) {',
    '  if (!acc || !Array.isArray(acc.hoiSeas) || !acc.hoiSeas.length) return 0;',
    '  let n = 0;',
    '  for (const s of acc.hoiSeas) {',
    '    if (!s || typeof s !== \'object\') continue;',
    '    const to = ORBIT_ID_MIGRATION[s.id];',
    '    if (!to) continue;',
    '    s.id = to;',
    '    n++;',
    '  }',
    '  return n;',
    '}',
    '',
  ].join('\n');

  // 插到 repairScenarioEstates 之前不合适，找一个稳定的锚点：ensureBattles 附近
  const ANCHOR = 'export function getPlanetInstance(code) {';
  if (!src.includes(ANCHOR)) { console.error('✗ 找不到 getPlanetInstance'); process.exit(1); }
  if (!src.includes('function migrateOrbitIds')) {
    src = src.replace(ANCHOR, () => FN + ANCHOR);
  }

  // 在 tick 的账号处理里调用一次
  const TICK = '          tickFocus(acc, dt);';
  if (src.includes(TICK)) {
    src = src.replace(TICK, () => TICK + '\n          try { migrateOrbitIds(acc); } catch (e) { /* 迁移失败不应中断心跳 */ }');
  }
  writeFileSync(FILE, src.split('\n').join(EOL), 'utf8');
  console.log('  ✓ 加入 migrateOrbitIds 并接入 tick');
}
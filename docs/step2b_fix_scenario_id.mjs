// v0.4.19：HOI_SCENARIO_ID 原先定义在 data/hoi1936.js（已删），本文件两处引用悬空。
//   · scenarioAdapterOf 原本 `s === HOI_SCENARIO_ID ? hoiAdapter() : sciAdapter()`
//     —— hoiAdapter 已随 WWII 数据一并删除，改为恒走 sciAdapter()。
//   · repairScenarioEstates 里的 `acc.scenario !== HOI_SCENARIO_ID` 早退
//     **原样保留**：1936 早已隐藏，该函数在科幻模式下本来就恒返回 0，
//     保留判断可确保行为零变化。
import { readFileSync, writeFileSync } from 'fs';

const FILE = 'js/core/hoi1936.js';
let src = readFileSync(FILE, 'utf8');
const EOL = src.includes('\r\n') ? '\r\n' : '\n';
src = src.split(EOL).join('\n');

// ① 在通用常量 import 之后插入本地常量
const ANCHOR = "} from '../data/scenario_common.js?v=58.9';";
if (!src.includes(ANCHOR)) { console.error('✗ 找不到 scenario_common import'); process.exit(1); }
const DEF = ANCHOR + [
  '',
  '',
  '/**',
  ' * 旧 1936 mod 的剧本 id。v0.4.19 起该 mod 已删除，这里只作为**旧存档识别标记**',
  ' * 保留 —— 手里还有 1936 存档的玩家，载入后会被当成科幻剧本处理（机制已由',
  ' * 普通模式接管），而不是直接崩溃。',
  ' */',
  "const HOI_SCENARIO_ID = 'hoi1936';",
].join('\n');
src = src.replace(ANCHOR, () => DEF);

// ② hoiAdapter 已删 → 恒走 sciAdapter
const OLD = 'return s === HOI_SCENARIO_ID ? hoiAdapter() : sciAdapter();';
const NEW = [
  '// v0.4.19：原先是 `s === HOI_SCENARIO_ID ? hoiAdapter() : sciAdapter()`，',
  '//   hoiAdapter 随 WWII 数据（真实国家表 / 深描 / 国策模板 / 史实年历）一并删除，',
  '//   现在恒走科幻适配器；旧 1936 存档载入后同样落到这里。',
  'return sciAdapter();',
].join('\n');
if (!src.includes(OLD)) { console.error('✗ 找不到 scenarioAdapterOf 的适配器分支'); process.exit(1); }
src = src.replace(OLD, () => NEW);

// ③ 顺带删掉因此不再需要的 s 变量
src = src.replace(
  "  const s = acc && acc.scenario ? String(acc.scenario) : '';\n",
  '',
);

writeFileSync(FILE, src.split('\n').join(EOL), 'utf8');
console.log('✓ HOI_SCENARIO_ID 本地化 + hoiAdapter 分支改道');
// v0.4.18（Stage B）：彻底删除 1936 mod
//
// Stage A 已清掉正常模式文件里的 1936 UI 残留（含一个必然 TypeError 的按钮）。
// 本阶段把 mod 本身连根拔起：js/data/hoi1936.js（756 行）与 js/core/hoi1936.js
// （1285 行）删除，并把 7 个引用方的用法全部替换为通用等价物。
//
// 关键判断（逐处查证，不是猜的）：
//   · battle.js / treaty.js / hoi.js 里的 HOI_BY_ID **全是兜底查表**，
//     正常模式下 owner 是 'sci_*'，查 HOI_BY_ID 必然 miss，走的本来就是 fallback
//     分支（`n ? n.xxx : 0/0.5`）→ 换成空对象，行为完全不变。
//   · theater.js 的 `isHoi ? HOI_MAIN_NATIONS : ...` 里 isHoi 恒为 false
//     （1936 已隐藏）→ 直接删掉这个分支。
//   · start.js 的 `isSci() ? SCI_NATIONS : HOI_NATIONS` 恒取前者 → 删掉后者。
//   · state.js 的 apply1936Start / setupGermanPuppets 只在 `mode === 'hoi1936'`
//     时可达 → 整个删掉。
//   · **唯一真数据依赖**：data/scenario_sci.js 第 117 行
//     `export { HOI_SEAS as SCI_SEAS } from './hoi1936.js?v=58.9'` —— 普通模式的轨道圈层
//     表是直接复用 1936 的（已太空化过，但 id 仍是 north_sea/baltic/atlantic…
//     这些地球海名，注释里自己承认了「历史遗留的内部标识」）。
//     必须把表**内联进 scenario_sci.js** 并把 id / region 改成中性命名。
import { readFileSync, writeFileSync } from 'fs';

const log = [], fail = [];
function sub(file, from, to, why, expect = 1) {
  let src = readFileSync(file, 'utf8');
  const EOL = src.includes('\r\n') ? '\r\n' : '\n';
  src = src.split(EOL).join('\n');
  const n = src.split(from).length - 1;
  if (n !== expect) { fail.push(file + ' → ' + why + '（命中 ' + n + '，应为 ' + expect + '）'); return; }
  writeFileSync(file, src.split(from).join(to).split('\n').join(EOL), 'utf8');
  log.push('  ✓ ' + file.padEnd(24) + why);
}
function lineSub(file, re, to, why) {
  let src = readFileSync(file, 'utf8');
  const EOL = src.includes('\r\n') ? '\r\n' : '\n';
  src = src.split(EOL).join('\n');
  if (!re.test(src)) { fail.push(file + ' → ' + why + '（正则未命中）'); return; }
  const before = src;
  src = src.replace(re, () => to);
  if (before === src) { fail.push(file + ' → ' + why + '（替换后无变化）'); return; }
  writeFileSync(file, src.split('\n').join(EOL), 'utf8');
  log.push('  ✓ ' + file.padEnd(24) + why);
}

// ---------------------------------------------------------------- 1) scenario_sci.js：内联轨道圈层
{
  const FILE = 'js/data/scenario_sci.js';
  const ORBITS = `// ---------------------------------------------------------------------------
// 三、母星轨道圈层（v0.4.18：由 1936 mod 的 HOI_SEAS 内联而来）
//   此前这里是一句 \`export { HOI_SEAS as SCI_SEAS } from './hoi1936.js?v=58.9'\` —— 普通模式的
//   轨道圈层表**直接复用 1936 mod 的数据**，于是：
//     · 删掉 mod 就没了普通模式的轨道系统；
//     · 那张表的 id 仍是 north_sea / baltic / atlantic / pacific_w / japan_sea
//       这些**地球海名**，region 键也是 europe / atlantic / asia。原注释自己承认
//       这是「历史遗留的内部标识，玩家看不到」—— 确实看不到，但它们一直躺在
//       正常模式的数据文件里，是二战/地球术语的最后一个藏身处。
//   现在表与命名都归本文件所有：id 改成中性轨道名，region 键改成三段式势力范围。
//   ⚠️ id 变更会影响**已存在的存档**（acc.hoiSeas 按 id 索引）。
//      见 core/state.js#migrateOrbitIds —— 老 id 会自动映射到新 id。
// ---------------------------------------------------------------------------
export const SCI_SEAS = [
  { id: 'orbit_low',nameCn: '近地轨道',   base: 400, region: 'inner', altKm: 400,    orbitMin: 92,   desc: '大气层上沿，轨道机动最频繁，运兵最快但易被拦截。' },
  { id: 'orbit_twilight', nameCn: '晨昏线轨道', base: 300, region: 'inner', altKm: 12000,  orbitMin: 180,  desc: '永昼与永夜交界，太阳能充足，适合长期部署轨道炮。' },
  { id: 'orbit_geostationary', nameCn: '同步轨道', base: 600, region: 'inner', altKm: 35786, orbitMin: 1440, desc: '静止轨道，轨道炮与通信中继的枢纽，制高点。' },
  { id: 'orbit_lagrange', nameCn: '拉格朗日点 L4', base: 500, region: 'inner', altKm: 1500000, orbitMin: 4320, desc: '平衡点，可长期屯兵，是深空投送的跳板。' },
  { id: 'gate_deepspace', nameCn: '深空门户', base: 900, region: 'between', altKm: 8000000, orbitMin: 12000, desc: '星际航道入口。控制它等于扼住对方的补给命脉。' },
  { id: 'orbit_polar', nameCn: '极地轨道', base: 800, region: 'outer', altKm: 800, orbitMin: 100, desc: '高倾角轨道，俯冲能力强，轨道轰炸命中率高。' },
  { id: 'orbit_atmos', nameCn: '气层防线', base: 350, region: 'outer', altKm: 60, orbitMin: 88, desc: '稠密大气层内，机动受限但可获得地表火力掩护。' },
];

// v0.4.18：老存档的轨道 id → 新 id 映射。老存档写的是地球海名
//   （north_sea / baltic / channel / med / atlantic / pacific_w / japan_sea），
//   它们在 v0.4.x 已被太空化（显示名早就是轨道名），所以这里只是把**内部键**
//   换成中性命名，数值与平衡不受影响。
export const ORBIT_ID_MIGRATION = {
  north_sea: 'orbit_low',
  baltic: 'orbit_twilight',
  channel: 'orbit_geostationary',
  med: 'orbit_lagrange',
  atlantic: 'gate_deepspace',
  pacific_w: 'orbit_polar',
  japan_sea: 'orbit_atmos',
};

// 各势力开局已控制的圈层（替代 1936 的「英国控制英吉利海峡 85%」这类设定）`;

  const OLD = `export { HOI_SEAS as SCI_SEAS } from './hoi1936.js?v=58.9';

// 各势力开局已控制的圈层（替代 1936 的「英国控制英吉利海峡 85%」这类设定）`;
  sub(FILE, OLD, ORBITS, '轨道圈层表内联并改为中性命名 + 老 id 迁移表');
}

// ---------------------------------------------------------------- 2) battle.js / treaty.js / hoi.js：HOI_BY_ID 兜底查表 → 空对象
for (const [f, why] of [
  ['js/core/battle.js', 'HOI_BY_ID 兜底查表移除（4 处本来就走 fallback）'],
  ['js/core/treaty.js', 'HOI_BY_ID 兜底查表移除（本来走 war.targetName）'],
]) {
  lineSub(f,
    /^import \{ HOI_BY_ID \} from '\.\.\/data\/hoi1936\.js\?v=[^']*';\r?\n/m,
    "// v0.4.18：原先 import HOI_BY_ID 做势力名/战力兜底查表。正常模式下 owner 是\n"
    + "//   'sci_*'，查 HOI_BY_ID 必然 miss，代码本来就只走 fallback 分支，\n"
    + "//   换成空对象行为完全不变 —— 1936 mod 已删除。\n"
    + "const HOI_BY_ID = Object.create(null);\n",
    why);
}

// ---------------------------------------------------------------- 3) theater.js
lineSub('js/core/theater.js',
  /^import \{ HOI_BY_ID, HOI_MAIN_NATIONS \} from '\.\.\/data\/hoi1936\.js\?v=[^']*';\r?\n/m,
  "",
  '删掉 HOI_BY_ID / HOI_MAIN_NATIONS 的 import');
lineSub('js/core/theater.js',
  /  const scenario = String\(acc\.scenario \|\| ''\);\r?\n  const isHoi = scenario === 'hoi1936';\r?\n/,
  "",
  '删掉 isHoi 判定（1936 已隐藏，恒为 false）');
lineSub('js/core/theater.js',
  /  const rivals = \(isHoi \? HOI_MAIN_NATIONS : \(sciFactions && sciFactions\.length \? sciFactions : GENERIC_FACTIONS\)\)/,
  "  const rivals = (sciFactions && sciFactions.length ? sciFactions : GENERIC_FACTIONS)",
  '势力来源去掉 isHoi 分支');

console.log('\n--- 第一批完成 ---');
log.forEach((l) => console.log(l));
if (fail.length) { console.log('\n未完成：'); fail.forEach((f) => console.log('  ✗ ' + f)); process.exit(1); }
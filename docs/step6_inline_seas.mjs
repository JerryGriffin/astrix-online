// v0.4.19 第六步：把轨道圈层表内联进 scenario_sci.js（最后一个依赖 WWII 数据文件的地方）
//
// `export { HOI_SEAS as SCI_SEAS } from './hoi1936.js'` —— 普通模式的轨道圈层表
// 一直是直接复用 1936 的。那张表的显示名早已太空化，但 **id 仍是地球海名**
//（north_sea / baltic / channel / med / atlantic / pacific_w / japan_sea），
// 原注释自己承认是「历史遗留的内部标识」；同时两张表之间是**循环依赖**
//（scenario_sci 重导出它，hoi1936 又反向 import 回来）。
//
// 这里把表内联进 scenario_sci.js，id 全部改成中性轨道命名，并附一份老 id 映射，
// 由 core/state.js 在载入时迁移老存档（acc.hoiSeas 按 id 索引）。
import { readFileSync, writeFileSync } from 'fs';

const FILE = 'js/data/scenario_sci.js';
let src = readFileSync(FILE, 'utf8');
const EOL = src.includes('\r\n') ? '\r\n' : '\n';
src = src.split(EOL).join('\n');

const OLD = "export { HOI_SEAS as SCI_SEAS } from './hoi1936.js?v=58.9';";

const NEW = [
  '// v0.4.19：轨道圈层表**内联到本文件**，并把 id 改成中性命名。',
  '//',
  "//   此前是一句 `export { HOI_SEAS as SCI_SEAS } from './hoi1936.js'` —— 普通模式的",
  '//   轨道圈层表一直直接复用 1936 mod 的数据。删掉 mod 就没了普通模式的轨道系统，',
  "//   而那张表的 id 仍是 north_sea / baltic / atlantic / pacific_w / japan_sea 这些",
  '//   **地球海名**（原注释自称「历史遗留的内部标识，玩家看不到」—— 确实看不到，',
  '//   但它们一直躺在正常模式的数据文件里）。现在表与命名都归本文件所有。',
  '//',
  '//   ⚠️ id 变更会影响**已存在的存档**（acc.hoiSeas 按 id 索引）。',
  '//      ORBIT_ID_MIGRATION 由 core/state.js 在载入时套用，老存档的轨道控制度不会丢。',
  'export const SCI_SEAS = [',
  "  { id: 'orbit_low',          nameCn: '近地轨道',     base: 400, region: 'inner',   altKm: 400,      orbitMin: 92,   desc: '大气层上沿，轨道机动最频繁，运兵最快但易被拦截。' },",
  "  { id: 'orbit_twilight',     nameCn: '晨昏线轨道',   base: 300, region: 'inner',   altKm: 12000,   orbitMin: 180,  desc: '永昼与永夜交界，太阳能充足，适合长期部署轨道炮。' },",
  "  { id: 'orbit_geostationary',nameCn: '同步轨道',     base: 600, region: 'inner',   altKm: 35786,   orbitMin: 1440, desc: '静止轨道，轨道炮与通信中继的枢纽，制高点。' },",
  "  { id: 'orbit_lagrange',     nameCn: '拉格朗日点 L4',base: 500, region: 'inner',   altKm: 1500000, orbitMin: 4320, desc: '平衡点，可长期屯兵，是深空投送的跳板。' },",
  "  { id: 'gate_deepspace',     nameCn: '深空门户',     base: 900, region: 'between', altKm: 8000000, orbitMin: 12000, desc: '星际航道入口。控制它等于扼住对方的补给命脉。' },",
  "  { id: 'orbit_polar',        nameCn: '极地轨道',     base: 800, region: 'outer',   altKm: 800,     orbitMin: 100,  desc: '高倾角轨道，俯冲能力强，轨道轰炸命中率高。' },",
  "  { id: 'orbit_atmos',        nameCn: '气层防线',     base: 350, region: 'outer',   altKm: 60,      orbitMin: 88,   desc: '稠密大气层内，机动受限但可获得地表火力掩护。' },",
  '];',
  '',
  '// 老存档的轨道 id → 新 id。数值口径未变（base / altKm / orbitMin 全部照抄），',
  '// 所以这只是一次**内部键**改名，平衡不受影响。',
  'export const ORBIT_ID_MIGRATION = {',
  "  north_sea: 'orbit_low',",
  "  baltic: 'orbit_twilight',",
  "  channel: 'orbit_geostationary',",
  "  med: 'orbit_lagrange',",
  "  atlantic: 'gate_deepspace',",
  "  pacific_w: 'orbit_polar',",
  "  japan_sea: 'orbit_atmos',",
  '};',
].join('\n');

if (!src.includes(OLD)) { console.error('✗ 找不到 SCI_SEAS 重导出行'); process.exit(1); }
src = src.replace(OLD, () => NEW);
writeFileSync(FILE, src.split('\n').join(EOL), 'utf8');
console.log('✓ 轨道圈层表已内联进 scenario_sci.js（id 改为中性轨道命名 + 老 id 映射）');
// ============================================================================
// selfcheck_v052.mjs —— v0.4.25：说明文本的行内标记（mdInline）
//
// 这一版的 bug 性质是「**数据层写的是 markdown，UI 层却按纯文本输出**」，
// 结果玩家在建筑卡上看到字面星号「庇护总量决定**居住容量**」。
// 这类问题的可怕之处在于：**它不会报错，也不影响任何数值**，
// 只有肉眼看界面才发现 —— 所以必须有断言兜住。
//
//   A. mdInline 语义：粗体转换 / HTML 转义 / 单星号不动 / null 兜底 / 多处配对
//   B. 数据层全表扫描：所有玩家可见的 desc 经 mdInline 后不得残留裸星号
//   C. 版本自洽（同前几套口径）
//
// 原则同前几套：只调产品入口，不复刻实现。
// ============================================================================
import { pathToFileURL, fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const { CACHE_TAG, VERSION, VERSION_NUM, REVISION } = await import(pathToFileURL(join(ROOT, 'js/version.js')).href);

let pass = 0, fail = 0;
const failures = [];
function ok(cond, name, detail) {
  if (cond) { pass++; console.log('  ✓ ' + name + (detail ? '  [' + detail + ']' : '')); }
  else {
    fail++; failures.push(name + (detail ? '  [' + detail + ']' : ''));
    console.log('  ✗ ' + name + (detail ? '  [' + detail + ']' : ''));
  }
}
function section(t) { console.log('\n' + t); }

const C = await import(pathToFileURL(join(ROOT, 'js/ui/common.js')).href + `?v=${CACHE_TAG}`);
const BD = await import(pathToFileURL(join(ROOT, 'js/data/buildings.js')).href + `?v=${CACHE_TAG}`);
const TH = await import(pathToFileURL(join(ROOT, 'js/data/techs.js')).href + `?v=${CACHE_TAG}`);
const RC = await import(pathToFileURL(join(ROOT, 'js/data/recipes.js')).href + `?v=${CACHE_TAG}`);
const P = await import(pathToFileURL(join(ROOT, 'js/core/population.js')).href + `?v=${CACHE_TAG}`);
const CL = await import(pathToFileURL(join(ROOT, 'js/data/changelog.js')).href + `?v=${CACHE_TAG}`);

// ============================================================================
section('A. mdInline 语义');
// ============================================================================
ok(C.mdInline('无标记') === '无标记', '无标记原样输出');
ok(C.mdInline('庇护总量决定**居住容量**（至少 20 人）')
  === '庇护总量决定<strong>居住容量</strong>（至少 20 人）', '**x** → <strong>x</strong>');
ok(C.mdInline('**A** 与 **B**') === '<strong>A</strong> 与 <strong>B</strong>', '同一句里多处粗体都能转');
ok(C.mdInline('单个星号 * 不是标记') === '单个星号 * 不是标记', '单星号原样保留');
ok(C.mdInline('**未闭合') === '**未闭合', '未闭合的 ** 不吞字（原样保留）');
ok(C.mdInline('<script>alert(1)</script>') === '&lt;script&gt;alert(1)&lt;/script&gt;', 'HTML 一律转义');
ok(C.mdInline('**<b>x</b>**') === '<strong>&lt;b&gt;x&lt;/b&gt;</strong>', '先转义再替换（粗体里夹标签也安全）');
ok(C.mdInline(null) === '' && C.mdInline(undefined) === '', 'null/undefined 兜底为空串');
ok(C.stripMdInline('产出**+30%**') === '产出+30%', 'stripMdInline 只去星号（纯文本场景）');

// ============================================================================
section('B. 数据层：所有玩家可见的 desc 经渲染后不得残留裸星号');
// ============================================================================
const cases = [];
for (const b of BD.BUILDINGS) cases.push(['建筑:' + b.nameCn, b.desc]);
for (const t of TH.TECHS) cases.push(['科技:' + (t.nameCn || t.id), t.desc]);
for (const r of RC.RECIPES) cases.push(['配方:' + (r.id || r.nameCn), r.desc]);
for (const m of (P.MANAGE_MODES || [])) cases.push(['人口模式:' + m.nameCn, m.desc]);
for (const j of (P.JOBS || [])) cases.push(['岗位:' + j.nameCn, j.desc]);

const withMd = cases.filter(([, d]) => typeof d === 'string' && d.includes('**'));
ok(withMd.length >= 8, '确实扫到了一批带 ** 的说明（防止扫描面写空了假绿）', withMd.length + ' 条');
const bad = withMd.filter(([, d]) => C.mdInline(d).includes('**'));
ok(bad.length === 0, '渲染后无残留裸星号', bad.length ? bad.map((x) => x[0]).join(', ') : '');
const noStrong = withMd.filter(([, d]) => !C.mdInline(d).includes('<strong>'));
ok(noStrong.length === 0, '带 ** 的说明确实产出了粗体节点', noStrong.length ? noStrong.map((x) => x[0]).join(', ') : '');
// 反向：不带 ** 的说明不得凭空长出标签
const plain = cases.filter(([, d]) => typeof d === 'string' && !d.includes('**'));
const ghost = plain.filter(([, d]) => C.mdInline(d).includes('<strong>'));
ok(ghost.length === 0, '无标记的说明不会凭空出现粗体', ghost.length ? ghost[0][0] : '');
// 所有说明都必须能被转义函数安全吃下（不允许返回 "undefined" 字样）
const undef = cases.filter(([, d]) => d != null && C.mdInline(d) === 'undefined');
ok(undef.length === 0, '没有说明被渲染成字符串 "undefined"');

// ============================================================================
section('C. 版本自洽');
// ============================================================================
const m = /^v(\d+)\.(\d+)\.(\d+)$/.exec(VERSION);
ok(!!m, 'VERSION 格式合法', VERSION);
if (m) {
  const num = Number(m[1]) * 100 + Number(m[2]) * 10 + Number(m[3]);
  ok(num === VERSION_NUM, 'VERSION_NUM = major×100 + minor×10 + patch', `${VERSION} → ${num} / ${VERSION_NUM}`);
}
ok(CACHE_TAG === VERSION_NUM + '.' + REVISION, 'CACHE_TAG 拼法正确', CACHE_TAG);
ok(CL.VERSIONS[0][0] === VERSION, '更新日志首条与 VERSION 一致', CL.VERSIONS[0][0]);
ok(/^\d{4}-\d{2}-\d{2}$/.test(CL.VERSIONS[0][1]), '更新日志首条日期格式合法', CL.VERSIONS[0][1]);

// ============================================================================
console.log('\n------------------------------------------------');
console.log(`v052: ${pass} 通过, ${fail} 失败`);
if (fail) { console.log('失败项：'); for (const f of failures) console.log('  - ' + f); process.exit(1); }

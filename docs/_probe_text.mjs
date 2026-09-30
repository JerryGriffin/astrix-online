// Astrix rev15 文本层探针：玩家可见文案的「汉化与整洁」回归哨兵
//
// 背景（rev15 修的两类问题，此后由本探针看住）：
//   ① 数据层描述里混进**内部标识**：custom_chem / refinePair(matName) / deliverToHome /
//      startMission / population/ / core 实现 / Astroneer 等实现细节被直接摊在玩家面前；
//   ② 描述里的 `**重点**` Markdown 标记**原样外露**（渲染点用 textContent / esc()，
//      于是玩家真的看到「农田**不走生产线**」这串带星号的文字）。
//
// 本探针不依赖 DOM：
//   · 直接 import 各 data 模块，逐条扫 desc / description 字段 → 断言无内部标识；
//   · 直接调 js/core/format.js#richText → 断言 `**x**` 变 `<b>x</b>`，且 HTML 仍被转义。
//
// 用法：node docs/_probe_text.mjs

const FMT = await import('../js/core/format.js?v=21.15');
const BD = await import('../js/data/buildings.js?v=21.15');
const RC = await import('../js/data/recipes.js?v=21.15');
const TH = await import('../js/data/techs.js?v=21.15');
const PF = await import('../js/data/facilities.js?v=21.15');
const MT = await import('../js/data/materials.js?v=21.15');
const AP = await import('../js/data/army_parts.js?v=21.15');
const FL = await import('../js/data/fuels.js?v=21.15');
const UG = await import('../js/data/upgrades.js?v=21.15');
const PL = await import('../js/data/planets.js?v=21.15');

let pass = 0, fail = 0;
const check = (name, ok, extra) => {
  if (ok) { pass++; console.log('  ✓ PASS ' + name); }
  else { fail++; console.log('  ✗ FAIL ' + name + (extra ? '  「' + extra + '」' : '')); }
};

// ---------------------------------------------------------------------------
// 一、内部标识不得出现在玩家可见描述里
// ---------------------------------------------------------------------------
// 每条规则 = [正则, 说明]。命中即失败，并把出问题的条目 id 打出来，方便定位。
const LEAKS = [
  [/\bcustom_chem\b/, '内部建筑 id（custom_chem）'],
  [/\brefinePair\s*\(/, '内部函数名（refinePair）'],
  [/\bdeliverToHome\b/, '内部字段名（deliverToHome）'],
  [/\bstartMission\b/, '内部函数名（startMission）'],
  [/population\//, '内部路径（population/）'],
  [/core\s*(从大气|实现)/, '内部模块名（core）'],
  [/Astroneer/, '外部作品名（Astroneer）'],
  [/atk 增益|def 增益/, '未汉化属性名（atk/def 增益）'],
  [/\bv0\.\d+\.\d+\s*(调整|起|修订|：)/, '开发版本备注（v0.x.x …）'],
];

function collect(list, label, key) {
  const K = key || 'desc';
  const bad = [];
  for (const it of (list || [])) {
    const text = String((it && (it[K] != null ? it[K] : it.description)) || '');
    for (const [re, why] of LEAKS) {
      if (re.test(text)) bad.push(label + '#' + (it && it.id) + ' → ' + why);
    }
  }
  return bad;
}

const allBad = [].concat(
  collect(BD.BUILDINGS, '建筑'),
  collect(RC.RECIPES, '配方'),
  collect(TH.TECHS, '科技'),
  collect(PF.POWER_FACILITIES, '电力设施'),
  collect(MT.MATERIALS, '材料', 'description'),
  collect(AP.ARMY_PARTS, '军事部件'),
  collect(UG.UPGRADES, '永久升级'),
  collect(FL.FUELS, '燃料'),
  collect(PL.PLANETS, '星球', 'description'),
);

console.log('\n一、描述文本内部标识扫描（' + (BD.BUILDINGS.length + RC.RECIPES.length + TH.TECHS.length
  + PF.POWER_FACILITIES.length + MT.MATERIALS.length + AP.ARMY_PARTS.length
  + UG.UPGRADES.length + FL.FUELS.length + PL.PLANETS.length) + ' 条）');
check('描述里不含内部标识 / 开发备注', allBad.length === 0, allBad.slice(0, 4).join('；'));

// ---------------------------------------------------------------------------
// 二、richText：Markdown 加粗真正生效，且不放松转义
// ---------------------------------------------------------------------------
console.log('\n二、js/core/format.js#richText');
check('普通文字原样返回', FMT.richText('农田不走生产线') === '农田不走生产线');
check('**x** 渲染为 <b>x</b>', FMT.richText('农田**不走生产线**') === '农田<b>不走生产线</b>');
check('多个加粗同时生效',
  FMT.richText('解锁**突击步枪**与**轻型框架**') === '解锁<b>突击步枪</b>与<b>轻型框架</b>');
check('单独星号不受影响', FMT.richText('2 * 3 = 6') === '2 * 3 = 6');
check('HTML 仍被转义（不因加粗放松 XSS 防护）',
  FMT.richText('<img src=x onerror=alert(1)>**危险**')
    === '&lt;img src=x onerror=alert(1)&gt;<b>危险</b>');
check('escapeHtml 导出可用', FMT.escapeHtml('a<b>&"\'') === 'a&lt;b&gt;&amp;&quot;&#39;');

// ---------------------------------------------------------------------------
// 三、带 ** 的描述必须能被渲染点消费（当前仅建筑 / 科技用到）
// ---------------------------------------------------------------------------
console.log('\n三、加粗标记的落点');
const boldOwners = [].concat(BD.BUILDINGS, TH.TECHS)
  .filter((x) => /\*\*[^*]+\*\*/.test(String(x.desc || '')));
const rendered = boldOwners.filter((x) => FMT.richText(x.desc).includes('<b>'));
check('所有含 ** 的描述都能被 richText 正确加粗（' + boldOwners.length + ' 条）',
  rendered.length === boldOwners.length);

console.log('\n===== 探针汇总 =====');
console.log('  通过 ' + pass + ' / 失败 ' + fail);
process.exit(fail ? 1 : 0);

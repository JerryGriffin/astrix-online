// docs/_probe_hist_war.mjs —— v0.3.3「战争按历史」玩家侧门控防回归
//
// 覆盖：
//   1. histWarGateFor：非节点期拒绝宣战，节点期放行
//   2. listHistTargets：可宣战目标列表随日期变化
//   3. declareWar(opts.histGate)：门控拒绝时不产生战争
//   4. tickDiploAI：非节点期不宣战 / 节点期只触发一次 / 对象为史实交战方
//   5. HOI_MAIN_NATIONS 口径：12 主国 + 3 历史对象国
import {
  histWarGateFor, listHistTargets, tickDiploAI, gameDaysOf, scenarioDateOf,
} from '../js/core/hoi1936.js?v=49.2';
import { HIST_TIMELINE, HOI_NATIONS, HOI_MAIN_NATIONS, HOI_BY_ID, histEventsAt, histWarBetween } from '../js/data/hoi1936.js?v=49.2';
import { declareWar, activeWarsOf } from '../js/core/war.js?v=49.2';

let pass = 0, fail = 0;
const check = (n, c, d) => { if (c) { pass++; console.log('  ✓ ' + n + (d ? '  ' + d : '')); } else { fail++; console.log('  ✗ ' + n + (d ? '  ' + d : '')); } };

// 造一个指定游戏日的账号（GAME_DAYS_PER_SEC = 1，1 真实秒 = 1 游戏天）
function accAt(nation, day) {
  return {
    id: 'p_' + nation + '_' + day, scenario: 'hoi1936', nation,
    scenarioStartedAt: Date.now() - day * 1000,
    wars: [], warLog: [], npcAllies: [], hoiDiploDays: 0, hoiHistFired: {},
    tech: [], armies: [], fleets: [], ships: [],
  };
}

// ---------------------------------------------------------------------------
console.log('\n===== 一、时间表数据完整性 =====');
{
  check('时间表非空', HIST_TIMELINE.length > 0, HIST_TIMELINE.length + ' 个节点');
  let bad = [];
  for (const e of HIST_TIMELINE) {
    if (!Array.isArray(e.actors) || e.actors.length < 2) bad.push(e.nameCn + '(actors)');
    for (const a of e.actors) if (!HOI_BY_ID[a]) bad.push(e.nameCn + '(' + a + '未定义)');
    if (typeof e.day !== 'number') bad.push(e.nameCn + '(day)');
  }
  check('所有节点 actors 可解析且 day 为数字', bad.length === 0, bad.slice(0, 5).join(','));

  // day 递增性：战争节点不应出现「时间倒流」（同一天不同国家可并列，故用 >=）
  const wars = HIST_TIMELINE.filter(e => e.kind === 'war').map(e => e.day);
  check('战争节点 day 单调不减（无时间倒流）', wars.every((d, i) => i === 0 || d >= wars[i - 1]),
    wars.join(','));

  check('histWarBetween(德,波,1939) 命中', !!histWarBetween('ger', 'pol', 1339));
  check('histWarBetween(德,美,1939) 不命中', !histWarBetween('ger', 'usa', 1339));
  check('histEventsAt(1339) 窗口内多节点', histEventsAt(1339).length >= 3, histEventsAt(1339).length + ' 个');
  check('histEventsAt(0) 开局无战争节点', histEventsAt(0).every(e => e.kind !== 'war'));

  // —— day 口径自检：每个节点的 day 必须真的落在它标注的史实日期上 ——
  // （v0.3.3 曾把 1939-09-01 误写成 973，正确是 1339，故必须有机器校验）
  const EPOCH = Date.UTC(1936, 0, 1);
  const dayOf = (cn) => {   // '1939年9月1日' → day
    const m = String(cn).match(/(\d{4})年(\d{1,2})月(\d{1,2})?/);
    if (!m) return null;
    return Math.round((Date.UTC(+m[1], +m[2] - 1, +(m[3] || 1)) - EPOCH) / 86400000);
  };
  const drift = [];
  for (const e of HIST_TIMELINE) {
    if (!e.dateCn) continue;
    const want = dayOf(e.dateCn);
    if (want == null) { drift.push(e.nameCn + '(dateCn 解析失败)'); continue; }
    if (want !== e.day) drift.push(e.nameCn + ' ' + e.dateCn + '→应 ' + want + ' 实为 ' + e.day);
  }
  check('所有节点 day 与标注史实日期一致', drift.length === 0, drift.join(' | '));

  // 抽查关键史实日期
  const key = [['德国入侵波兰', 1339], ['巴巴罗萨行动', 1999], ['太平洋战争爆发', 2167]];
  const keyBad = key.filter(([nm, d]) => {
    const e = HIST_TIMELINE.find(x => x.nameCn === nm);
    return !e || e.day !== d;
  }).map(([nm, d]) => nm + '(应 ' + d + ')');
  check('关键史实日期抽查（1939/1941 两次大战）', keyBad.length === 0, keyBad.join(','));
}

// ---------------------------------------------------------------------------
console.log('\n===== 二、HOI_MAIN_NATIONS 口径（12 主国 vs 3 对象国）=====');
{
  check('HOI_NATIONS = 15', HOI_NATIONS.length === 15, '实得 ' + HOI_NATIONS.length);
  check('HOI_MAIN_NATIONS = 12', HOI_MAIN_NATIONS.length === 12, '实得 ' + HOI_MAIN_NATIONS.length);
  const histOnly = HOI_NATIONS.filter(n => n.histOnly).map(n => n.id);
  check('histOnly 恰为 eth/aut/cze', histOnly.join(',') === 'eth,aut,cze', histOnly.join(','));
  check('主国不含 histOnly', HOI_MAIN_NATIONS.every(n => !n.histOnly));
  check('主国含 ger/sov/usa/jap', ['ger', 'sov', 'usa', 'jap'].every(id => HOI_MAIN_NATIONS.some(n => n.id === id)));
}

// ---------------------------------------------------------------------------
console.log('\n===== 三、histWarGateFor 玩家门控 =====');
{
  // 波兰 1936-01-11（day 10）：历史上此时未与德国交战
  const a1 = accAt('pol', 10);
  const g1 = histWarGateFor(a1, 'ger');
  check('1936 年 10 天：波兰不可对德宣战', g1.ok === false, g1.reason);
  check('拒绝理由含历史提示', /历史|节点/.test(g1.reason || ''), g1.reason);

  // 波兰 1939-09-01（day 973）：德国入侵波兰
  const a2 = accAt('pol', 1339);
  const g2 = histWarGateFor(a2, 'ger');
  check('1939-09-01：波兰可对德宣战', g2.ok === true, 'event=' + g2.eventName);
  check('放行时带 histKey', !!g2.histKey, g2.histKey);
  check('放行时带历史事件名', g2.eventName === '德国入侵波兰', g2.eventName);

  // 不能对自己
  const a3 = accAt('ger', 973);
  check('不能对自己宣战', histWarGateFor(a3, 'ger').ok === false);

  // 非 1936 剧本不门控
  const a4 = { nation: 'x', scenario: 'other', wars: [] };
  check('非 1936 剧本不门控', histWarGateFor(a4, 'ger').ok === true);
}

// ---------------------------------------------------------------------------
console.log('\n===== 四、listHistTargets 可宣战目标 =====');
{
  const a1 = accAt('pol', 10);
  check('1936-01-11 波兰无历史目标', listHistTargets(a1).length === 0, '实得 ' + listHistTargets(a1).length);

  const a2 = accAt('ger', 1339);
  const ts = listHistTargets(a2);
  const foes = ts.map(t => t.nationId);
  check('1939-09-01 德国目标含波兰', foes.indexOf('pol') >= 0, foes.join(','));
  check('1939-09-01 德国目标含英法', foes.indexOf('fra') >= 0 && foes.indexOf('eng') >= 0, foes.join(','));
  check('目标不含德国自己', foes.indexOf('ger') < 0);
  check('目标带中文名与旗标', ts.every(t => t.nameCn && typeof t.flag === 'string'), ts[0] ? ts[0].nameCn : '');
}

// ---------------------------------------------------------------------------
console.log('\n===== 五、declareWar 门控生效 =====');
{
  // 门控拒绝 → 不产生战争
  const a1 = accAt('pol', 10);
  const gate1 = histWarGateFor(a1, 'ger');
  const r1 = declareWar(a1, { id: 'hoi_ger', nameCn: '柏林', kind: 'npc' }, { histGate: gate1 });
  check('门控拒绝时 declareWar 失败', r1.ok === false, r1.reason);
  check('门控拒绝时无战争记录', a1.wars.length === 0);

  // 门控放行 → 产生战争，且记下 histKey
  const a2 = accAt('pol', 1339);
  const gate2 = histWarGateFor(a2, 'ger');
  const r2 = declareWar(a2, { id: 'hoi_ger', nameCn: '柏林', kind: 'npc' }, { histGate: gate2 });
  check('门控放行时 declareWar 成功', r2.ok === true, r2.reason || '');
  check('战争记下 histKey', r2.ok && r2.war.histKey === gate2.histKey, r2.ok ? r2.war.histKey : '');
  check('activeWarsOf 可见', activeWarsOf(a2).length === 1);

  // 不传 histGate（1936 但调用方未接门控）→ 仍可宣战（向后兼容）
  const a3 = accAt('pol', 10);
  const r3 = declareWar(a3, { id: 'hoi_ger', nameCn: '柏林', kind: 'npc' });
  check('未传 histGate 时保持旧行为（向后兼容）', r3.ok === true);
}

// ---------------------------------------------------------------------------
console.log('\n===== 六、tickDiploAI 历史驱动 =====');
{
  // 非节点期反复判定不宣战
  const a1 = accAt('pol', 10);
  for (let i = 0; i < 40; i++) { a1.hoiDiploDays = 0; tickDiploAI(a1, 31); }
  check('非节点期 40 次判定不宣战', a1.wars.length === 0, '战争 ' + a1.wars.length + ' 场');

  // 节点期触发，且对象正确
  const a2 = accAt('ger', 1339);
  for (let i = 0; i < 5 && !a2.wars.length; i++) { a2.hoiDiploDays = 0; tickDiploAI(a2, 31); }
  check('1939-09-01 德国对波兰开战', a2.wars.length > 0
    && String(a2.wars[0].targetId).replace(/^hoi_/, '') === 'pol',
    a2.wars[0] ? a2.wars[0].targetId : '(无)');

  // 同节点不重复触发
  for (let i = 0; i < 20; i++) { a2.hoiDiploDays = 0; tickDiploAI(a2, 31); }
  const polWars = a2.wars.filter(w => String(w.targetId).replace(/^hoi_/, '') === 'pol').length;
  check('同一节点只触发一次（对波 1 场）', polWars === 1, '实得 ' + polWars + ' 场');

  // 日本 1937 对中国，不打美国
  const a3 = accAt('jap', 553);
  for (let i = 0; i < 5 && !a3.wars.length; i++) { a3.hoiDiploDays = 0; tickDiploAI(a3, 31); }
  check('1937-06-07 日本对中国开战', a3.wars.length > 0
    && String(a3.wars[0].targetId).replace(/^hoi_/, '') === 'chn',
    a3.wars[0] ? a3.wars[0].targetId : '(无)');

  // 1941 美国对日宣战
  const a4 = accAt('usa', 2167);
  for (let i = 0; i < 5 && !a4.wars.length; i++) { a4.hoiDiploDays = 0; tickDiploAI(a4, 31); }
  const a4foe = a4.wars[0] ? String(a4.wars[0].targetId).replace(/^hoi_/, '') : '';
  check('1941-12 美国参战（对象为 ger 或 jap）',
    a4foe === 'ger' || a4foe === 'jap', a4foe);
}

// ---------------------------------------------------------------------------
console.log('\n===== 七、日期口径 =====');
{
  const a = accAt('ger', 1339);
  const d = gameDaysOf(a);
  check('gameDaysOf 约等于设定日', Math.abs(d - 1339) < 5, '实得 ' + d.toFixed(1));
  const s = scenarioDateOf(a);
  check('scenarioDateOf 显示 1939年9月1日', s === '1939年9月1日', s);
}

console.log('\n===== 汇总 =====');
console.log('  通过 ' + pass + ' / 失败 ' + fail);
if (fail === 0) console.log('  全部通过 ✅');
process.exit(fail === 0 ? 0 : 1);

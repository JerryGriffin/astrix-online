// v0.2.6 深化探针：人口比例 / 500 人编制 / 史实舰队 / 侧重生产线 / 阵营 / 国策 / 海域
import { STATE, createAccount, getPlanetInstance } from '../js/core/state.js?v=26.2';
import { HOI_NATIONS, HOI_BY_ID, HOI_DEEP, popOf, GER_POP_BASE, ARMY_MEN, HOI_SEAS } from '../js/data/hoi1936.js?v=26.2';
import { scenarioDateOf, ensureFocus, startFocus, tickFocus, focusOptionsOf, contestSea, ensureSeas, enemySeaPressure, blocNameOf, deepOf } from '../js/core/hoi1936.js?v=26.2';
import { consumptionPerSec } from '../js/core/population.js?v=26.2';
import { listFleets } from '../js/core/fleet.js?v=26.2';

let pass = 0, fail = 0;
function ok(cond, msg) { if (cond) { pass++; console.log('  ✓ ' + msg); } else { fail++; console.log('  ✗ ' + msg); } }

STATE.adapter = { get: () => null, set: () => {}, del: () => {} };

// ---- A. 人口按德国 80000 基准放缩 ----
ok(popOf('ger') === GER_POP_BASE, '德国人口 = ' + GER_POP_BASE + '（实际 ' + popOf('ger') + '）');
const ratio = popOf('sov') / popOf('ger');
ok(Math.abs(ratio - (168 / 69.3)) < 0.02, '苏联/德国人口比例 ≈ 真实比例（' + ratio.toFixed(2) + '）');
ok(popOf('chn') > popOf('usa') && popOf('usa') > popOf('ger'), '人口排序符合史实（中国 > 美国 > 德国）');

// ---- B. 德国开局：500 人编制 / 生产线 / 舰队 / 阵营 ----
const ger = createAccount('柏林', 'hoi1936', { countryId: 'ger' });
const gInst = getPlanetInstance(ger.homePlanetCode);
ok(gInst.pop.total === 80000, '德国母星人口 80000（实际 ' + gInst.pop.total + '）');
ok(Math.abs(gInst.pop.consumeScale - 1 / 650) < 1e-9, '大人口消耗已缩放（consumeScale=' + gInst.pop.consumeScale.toFixed(6) + '）');
const cps = consumptionPerSec(gInst.pop);
ok(cps.organic > 0 && cps.organic < 10, '80000 人每秒有机质消耗合理（' + cps.organic.toFixed(2) + '/s）');
ok(ger.armies.length > 0 && ger.armies.every((a) => a.men === ARMY_MEN), '每支军队 ' + ARMY_MEN + ' 人');
ok(ger.armies[0].nameCn.indexOf('装甲掷弹兵师') >= 0, '德国编制名 = 装甲掷弹兵师（实际 ' + ger.armies[0].nameCn + '）');
ok(ger.armies[0].stats.atk > ger.armies[0].stats.def, '德国编制偏攻击（atk ' + ger.armies[0].stats.atk + ' > def ' + ger.armies[0].stats.def + '）');
ok(ger.tech.includes('t_m3'), '德国军事科技已达 M3');

// 生产线（侧重：德国钢/铝/塑料）
let lines = 0;
for (const group of (gInst.lines || [])) { /* 兼容数组/对象结构 */ }
lines = Array.isArray(gInst.lines) ? gInst.lines.length : 0;
ok(lines > 0, '德国已铺设侧重生产线（' + lines + ' 条）');

// 史实舰队
const fleets = listFleets(ger);
ok(fleets.length === 1 && fleets[0].nameCn === '公海舰队', '德国舰队名 = 公海舰队（实际 ' + (fleets[0] && fleets[0].nameCn) + '）');
const navyShips = (fleets[0] && fleets[0].shipIds ? fleets[0].shipIds.length : 0);
ok(navyShips >= 4 && navyShips <= 12, '德国舰艇数按真实海军实力（24 舰 → ' + navyShips + ' 艘）');

// 阵营：德意同盟
ok(ger.npcAllies.indexOf('意大利') >= 0, '德意同盟已建立（盟友：' + ger.npcAllies.join('、') + '）');
ok(blocNameOf(ger) === '柏林—罗马轴心', '阵营名 = 柏林—罗马轴心');

// ---- C. 英国：不同侧重 + 多支史实舰队 ----
const eng = createAccount('伦敦', 'hoi1936', { countryId: 'eng' });
const eFleets = listFleets(eng).map((f) => f.nameCn);
ok(eFleets.indexOf('本土舰队') >= 0 && eFleets.indexOf('地中海舰队') >= 0, '英国两支史实舰队（' + eFleets.join(' / ') + '）');
ok(eng.armies[0].stats.def > eng.armies[0].stats.atk, '英国编制偏防御');
ok(eng.npcAllies.indexOf('法兰西') >= 0 && eng.npcAllies.indexOf('波兰') >= 0, '同盟国阵营（英法波）已建立');

// ---- D. 剧本日历（到天） ----
const d0 = scenarioDateOf(ger);
ok(/^1936年1月1日$/.test(d0), '开局日期 = 1936年1月1日（实际 ' + d0 + '）');
ger.scenarioStartedAt = Date.now() - 73 * 1000;   // 73 天后
ok(/^1936年3月14日$/.test(scenarioDateOf(ger)), '推进 73 天 → 1936年3月14日（实际 ' + scenarioDateOf(ger) + '）');

// ---- E. 国策：三支六策、按天推进、完成生效 ----
const opts = focusOptionsOf(ger);
ok(opts.length === 6, '德国 6 项国策（实际 ' + opts.length + '）');
ok(['工业', '军事', '外交'].every((b) => opts.some((x) => x.branch === b)), '三支齐全（工业 / 军事 / 外交）');
const r1 = startFocus(ger, 'ger_i1');   // 四年计划：120 天
ok(r1.ok && ensureFocus(ger).current.id === 'ger_i1', '可开始国策「四年计划」（120 天）');
ok(startFocus(ger, 'ger_i2').ok === false, '同一时间只能推进一项国策');
const research0 = ger.researchPoints;
tickFocus(ger, 61);
ok(ensureFocus(ger).current && ensureFocus(ger).current.progressDays === 61, '推进 61 天进度正确');
tickFocus(ger, 60);   // 累计 121 天 → 完成
const fc = ensureFocus(ger);
ok(!fc.current && fc.done.indexOf('ger_i1') >= 0, '121 天后国策完成');
ok(ger.researchPoints > research0, '国策效果生效（科研点 +' + (ger.researchPoints - research0) + '）');
ok((ger.hoiFocus.buffs.lineMul || 1) > 1, '产线加成已累积（lineMul=' + ger.hoiFocus.buffs.lineMul.toFixed(2) + '）');

// ---- F. 海域：制海权争夺 ----
const seas = ensureSeas(ger);
ok(seas.length === HOI_SEAS.length, '海域数量 = ' + HOI_SEAS.length);
ok(enemySeaPressure(ger) === 0, '未交战 → 无敌方海上压力');
const seaR = contestSea(ger, 'baltic', 900);
ok(seaR.ok && seaR.control > 0.5, '无敌人时巡航提升制海权（' + Math.round(seaR.control * 100) + '%）');
// 与海上强国交战后再测：敌方海上压力 > 0，弱小舰队会丢制海权
const W = await import('../js/core/war.js?v=26.2');
W.declareWar(ger, { id: 'hoi_eng', nameCn: '伦敦', kind: 'npc' });
ok(enemySeaPressure(ger) > 0, '与不列颠交战后敌方海上压力 > 0（' + Math.round(enemySeaPressure(ger)) + '）');
const before = seas.find((x) => x.id === 'atlantic').control;
const seaR2 = contestSea(ger, 'atlantic', 10);
ok(seaR2.ok && seaR2.control < before + 1e-9, '弱小舰队在敌方海域压制下制海权下降（' + Math.round(before * 100) + '% → ' + Math.round(seaR2.control * 100) + '%）');

// ---- G. 数据完整性：每国都有编制/舰队/生产线/国策 ----
let missing = [];
for (const n of HOI_NATIONS) {
  const d = HOI_DEEP[n.id];
  if (!d || !d.armyName || !d.fleets || !d.fleets.length || !d.lines || !d.lines.length || !d.foci || d.foci.length !== 6 || !d.bloc) missing.push(n.id);
}
ok(missing.length === 0, '12 国均有编制/舰队/生产线/六策/阵营' + (missing.length ? '（缺：' + missing.join(',') + '）' : ''));

console.log('');
console.log('通过 ' + pass + ' 项，失败 ' + fail + ' 项');
process.exit(fail ? 1 : 0);

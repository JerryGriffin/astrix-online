// v0.2.6 深化探针：人口比例 / 500 人编制 / 史实舰队 / 侧重生产线 / 阵营 / 国策 / 海域
import { STATE, createAccount, getPlanetInstance } from '../js/core/state.js?v=26.4';
import { HOI_NATIONS, HOI_BY_ID, HOI_DEEP, popOf, GER_POP_BASE, ARMY_MEN, HOI_SEAS } from '../js/data/hoi1936.js?v=26.4';
import { scenarioDateOf, ensureFocus, startFocus, tickFocus, focusOptionsOf, contestSea, ensureSeas, enemySeaPressure, blocNameOf, deepOf } from '../js/core/hoi1936.js?v=26.4';
import { consumptionPerSec } from '../js/core/population.js?v=26.4';
import { listFleets } from '../js/core/fleet.js?v=26.4';

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
const W = await import('../js/core/war.js?v=26.4');
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


// ---- H. rev3：生产线工人 / 建筑群 / 历史师数 / 史实蓝图 / 国策分支 / 外交 AI / 战时总动员 ----
import { workforceOf, SHIP_NAMES, ARMY_BP_NAME } from '../js/data/hoi1936.js?v=26.4';
import { tickDiploAI } from '../js/core/hoi1936.js?v=26.4';
import { MANAGE_MODES, tickPopulation } from '../js/core/population.js?v=26.4';
import { resolveBattle } from '../js/core/army.js?v=26.4';

const ger2 = createAccount('柏林2', 'hoi1936', { countryId: 'ger' });
const g2 = getPlanetInstance(ger2.homePlanetCode);
ok(Math.abs(ger2.hoiWorkforce - workforceOf('ger')) <= 40, '德国生产线工人 ≈ 20k（实际 ' + ger2.hoiWorkforce + '）');
ok(ger2.hoiWorkforce >= 19000, '德国工人数达 1.9 万以上');
ok(g2.hoiIndustry && g2.hoiIndustry.buildings > 2000, '德国工业建筑规模（' + (g2.hoiIndustry ? g2.hoiIndustry.buildings : 0) + ' 座）');
ok(ger2.hoiLines.length >= 8, '生产线已拉好（含装备线，共 ' + ger2.hoiLines.length + ' 条）');
ok(ger2.hoiLines.some((x) => x.indexOf('part_') >= 0), '装备生产线（part_*）已铺设');
ok(ger2.armies.length === HOI_BY_ID.ger.divisions, '德国师数 = 历史 30 个师（实际 ' + ger2.armies.length + '）');
const sov2 = createAccount('莫斯科2', 'hoi1936', { countryId: 'sov' });
ok(sov2.armies.length === HOI_BY_ID.sov.divisions, '苏联师数 = 历史 92 个师（实际 ' + sov2.armies.length + '）');
const chn2 = createAccount('南京2', 'hoi1936', { countryId: 'chn' });
ok(chn2.armies.length === HOI_BY_ID.chn.divisions, '中国师数 = 历史 120 个师（实际 ' + chn2.armies.length + '）');
const g2Fleets = listFleets(ger2);
const g2Ships = (g2Fleets[0] && g2Fleets[0].shipIds ? g2Fleets[0].shipIds.length : 0);
ok(g2Ships >= (HOI_BY_ID.eng.navy / 2.2) - 20, '德国舰船数按海军强度（' + g2Ships + ' 艘）');
const eng2 = createAccount('伦敦2', 'hoi1936', { countryId: 'eng' });
const e2Ships = eng2.ships.length;
ok(e2Ships > g2Ships, '英国舰船多于德国（' + e2Ships + ' > ' + g2Ships + '）');
ok(eng2.hoiNavyMul > ger2.hoiNavyMul, '英国海军传统高于德国（×' + eng2.hoiNavyMul + ' > ×' + ger2.hoiNavyMul + '）');
ok(ger2.blueprints[0].nameCn === SHIP_NAMES.ger[0], '德国舰船蓝图历史化（' + ger2.blueprints[0].nameCn + '）');
ok(ger2.armies[0].blueprintId === 'ab_ranger' && !!ARMY_BP_NAME.ger, '德国师蓝图历史化（' + ARMY_BP_NAME.ger + '）');

// 国策分支：同支按序 + 外交互斥
const g3 = createAccount('柏林3', 'hoi1936', { countryId: 'ger' });
const o3 = focusOptionsOf(g3);
const m2 = o3.find((x) => x.id === 'ger_m2');
ok(!!m2.locked, '军事第二策需先完成第一策（锁定原因：' + m2.locked + '）');
startFocus(g3, 'ger_d1');
tickFocus(g3, 91);
const o4 = focusOptionsOf(g3);
ok(!!o4.find((x) => x.id === 'ger_d2').locked, '外交线两策互斥（' + o4.find((x) => x.id === 'ger_d2').locked + '）');

// 外交 AI：多次判定应出现宣战或结盟
const g4 = createAccount('柏林4', 'hoi1936', { countryId: 'pol' });   // 波兰较弱 → 易被宣战
let ev = 0;
for (let i = 0; i < 40; i++) { g4.hoiDiploDays = 0; if (tickDiploAI(g4, 31)) ev++; }
ok(ev > 0, '外交 AI 有行动（' + ev + ' 次：宣战或结盟）');
ok(g4.wars.length + g4.npcAllies.length > 0, 'AI 行动已写入战争 / 盟友（战争 ' + g4.wars.length + ' / 盟友 ' + g4.npcAllies.length + '）');

// 战时总动员（全存档可用）
const mob = MANAGE_MODES.find((x) => x.id === 'mobilize');
ok(!!mob && mob.outputMul > 1 && mob.growthMul < 1 && mob.happinessDelta < 0, '战时总动员模式存在（产出 +' + Math.round((mob.outputMul - 1) * 100) + '% / 增长 ×' + mob.growthMul + '）');
const testPop = { total: 1000, happiness: 0.9, assignments: {}, manageMode: 'mobilize' };
tickPopulation(testPop, 10, { oxygen: 1e9, organic: 1e9, water: 1e9 }, { manageMode: 'mobilize' });
ok(testPop.happiness < 0.9, '战时总动员使幸福度下滑（' + testPop.happiness.toFixed(3) + '）');

// 交战 HOI4 化：地形 / 预备队 / 装甲
const base = [{ nameCn: 'A', power: 100, atk: 60, def: 40 }];
const plain = resolveBattle(12345, base, base, { terrain: 'plain' });
const mtn = resolveBattle(12345, base, [{ nameCn: 'D', power: 100, atk: 60, def: 40 }], { terrain: 'mountain' });
ok(typeof plain.log === 'string' && plain.log.indexOf('平原') >= 0, '交战日志含地形（' + (plain.log.split('\n')[0] || '') + '）');
const withRes = resolveBattle(999, base, base, { terrain: 'plain', atkReserves: [{ nameCn: 'R1', power: 80, atk: 50, def: 30 }] });
ok(typeof withRes.log === 'string' && withRes.log.indexOf('预备队') >= 0, '预备队增援已接入');

console.log('');
console.log('通过 ' + pass + ' 项，失败 ' + fail + ' 项');
process.exit(fail ? 1 : 0);

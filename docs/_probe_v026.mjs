// v0.2.6 探针：联盟战争（持续/分值/迫降条约/上限）+ 1936 剧本开局
import { declareWar, activeWarsOf, warWith, addWarScore, canForceSurrender, draftTreaty, endWar, surrenderWar, WAR_FORCE_SURRENDER_SCORE } from '../js/core/war.js?v=26.5';
import { STATE, createAccount, getPlanetInstance } from '../js/core/state.js?v=26.5';
import { HOI_NATIONS, HOI_BY_ID, popOf } from '../js/data/hoi1936.js?v=26.5';

let pass = 0, fail = 0;
function ok(cond, msg) { if (cond) { pass++; console.log('  ✓ ' + msg); } else { fail++; console.log('  ✗ ' + msg); } }

// ---------- A. 战争系统 ----------
const acc = { id: 'w1', ascoin: 100000, wars: [], warLog: [] };
const r1 = declareWar(acc, { id: 'hoi_ger', nameCn: '柏林', kind: 'npc' });
ok(r1.ok && warWith(acc, 'hoi_ger'), '宣战成功并进入持续战争状态');
ok(declareWar(acc, { id: 'hoi_ger', nameCn: '柏林', kind: 'npc' }).ok === false, '重复宣战被拒绝（战争已在持续）');

// 分数累加
for (let i = 0; i < 5; i++) addWarScore(acc, 'hoi_ger', true, '战役' + i);
let w = warWith(acc, 'hoi_ger');
ok(w.myScore === 40 && w.theirScore === 10, '5 胜后分数 = 40 : 10（实际 ' + w.myScore + ' : ' + w.theirScore + '）');
ok(canForceSurrender(acc, 'hoi_ger').ok === false, '分数未达 ' + WAR_FORCE_SURRENDER_SCORE + ' 时不能迫降');
for (let i = 0; i < 3; i++) addWarScore(acc, 'hoi_ger', true);
ok(canForceSurrender(acc, 'hoi_ger').ok === true, '分数达线后可迫降（实际 ' + warWith(acc, 'hoi_ger').myScore + '）');

// 条约 + 结束
const terms = draftTreaty(w, 90000, { '钢': 1000 });
ok(terms.reparations === 31500, '条约赔款 = 国库 ×35%（实际 ' + terms.reparations + '）');
ok(terms.goods['钢'] === 400, '条约物资移交 = 40%（实际 ' + terms.goods['钢'] + '）');
endWar(acc, 'hoi_ger', 'me', terms, '迫降签约');
ok(warWith(acc, 'hoi_ger') === null && acc.wars[0].status === 'ended', '签约后战争结束（唯一结束途径）');
ok(acc.warLog.length >= 8, '战争日志累积（' + acc.warLog.length + ' 条）');

// 持久化：序列化往返后战争仍在
const restored = JSON.parse(JSON.stringify({ wars: acc.wars }));
ok(restored.wars[0].status === 'ended' && restored.wars[0].treaty.reparations === 31500, '战争与条约可序列化持久（跨会话保留）');

// 上限
const acc2 = { id: 'w2', wars: [], warLog: [] };
for (let i = 0; i < 4; i++) declareWar(acc2, { id: 'npc_' + i, nameCn: '国' + i, kind: 'npc' });
ok(Object.keys(activeWarsOf(acc2)).length === 4, '可同时进行 4 场战争');
ok(declareWar(acc2, { id: 'npc_x', nameCn: 'X', kind: 'npc' }).ok === false, '第 5 场战争被拒绝（上限）');
surrenderWar(acc2, 'npc_0', { reparations: 100 }, '我方战败');
ok(activeWarsOf(acc2).length === 3, '投降后该场战争结束');

// ---------- B. 1936 剧本 ----------
STATE.adapter = { get: () => null, set: () => {}, del: () => {} };
const a = createAccount('剧本测试', 'hoi1936', { countryId: 'sov' });
ok(a.scenario === 'hoi1936' && a.nation === 'sov', '剧本标记与所选国家正确（苏联）');
const inst = getPlanetInstance(a.homePlanetCode);
ok(inst.nameCn.indexOf('莫斯科') === 0, '本土星球以首都命名（' + inst.nameCn + '）');
const n = HOI_BY_ID.sov;
ok(inst.pop.total === popOf(n), '人口按真实数据换算（德国 80000 基准，实际 ' + inst.pop.total + '）');
ok(a.armies.length === n.divisions, '军队数 = 历史师数（' + a.armies.length + ' 支）');
ok(!!a.colonyCode && getPlanetInstance(a.colonyCode).nameCn === n.colony.name, '属地星球已建立（' + n.colony.name + '）');
ok(Array.isArray(a.wars) && a.wars.length === 0, '开局无战争（玩家自行宣战）');
ok(a.tech.includes('t_e3') && a.tech.includes('t_m3'), '工业与军事科技已按 1936 列强水平铺开');

// 各国数据完整性
let dataOk = true;
for (const x of HOI_NATIONS) {
  if (!(x.popM > 0) || !(x.ic > 0) || !(x.divisions > 0) || !x.capital || !x.colony || !x.sell || !x.buys) dataOk = false;
}
ok(HOI_NATIONS.length === 12 && dataOk, '12 国数据完整（人口/工业/师/首都/属地/贸易表）');

console.log('');
console.log('通过 ' + pass + ' 项，失败 ' + fail + ' 项');
process.exit(fail ? 1 : 0);

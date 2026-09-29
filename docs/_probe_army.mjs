// 自动化探针：验证军队系统核心逻辑与制造车间军事部件联动（Astrix v0.2.0）
// 用法：node docs/_probe_army.mjs

import assert from 'assert';
import {
  STATE, createAccount, currentAccount, getPlanetInstance, setAdapter, tick
} from '../js/core/state.js?v=20.0';
import {
  armyStatsOf, listArmies, ensureArmies, stationedArmyPower,
  canAssembleArmy, startArmyAssemble, cancelArmyAssemble,
  tickArmyBuildLines, toggleStationed, disbandArmy
} from '../js/core/army.js?v=20.0';
import { ARMY_BLUEPRINTS, ARMY_BP_BY_ID, ARMY_PART_BY_ID, armyBpPartNeeds } from '../js/data/army_parts.js?v=20.0';
import { addEquipment } from '../js/core/shipyard.js?v=20.0';
import { recipesForBuilding, partRecipe } from '../js/core/production.js?v=20.0';
import { evaluateDefensePower } from '../js/core/cloud.js?v=20.0';

// 内存存储适配器
const mem = new Map();
globalThis.localStorage = {
  getItem: (k) => (mem.has(k) ? mem.get(k) : null),
  setItem: (k, v) => mem.set(k, String(v)),
  removeItem: (k) => mem.delete(k),
  clear: () => mem.clear(),
};
setAdapter({
  get: (k) => mem.get(k) || null,
  set: (k, v) => mem.set(k, String(v)),
  del: (k) => mem.delete(k),
});

console.log('=== 开始军队系统核心逻辑探针测试 ===');

// 1. 初始化账号与母星实例
createAccount('装甲军团司令');
const acc = currentAccount();
assert(acc, '必须成功创建账号');
const homeCode = acc.homePlanetCode || 'syl';
const inst = getPlanetInstance(homeCode) || getPlanetInstance(homeCode.replace(/\d+$/, ''));
assert(inst, '必须获取到母星实例');

// 2. 蓝图属性与战力计算
for (const bp of ARMY_BLUEPRINTS) {
  const stats = armyStatsOf(bp.id);
  assert(stats.power > 0, `${bp.nameCn} 综合战力必须为正数`);
  assert(stats.atk >= 0 && stats.def >= 0 && stats.speed > 0, `${bp.nameCn} 属性必须有效`);
}
const rangerStats = armyStatsOf('ab_ranger');
assert(rangerStats.speed > 20, '游骑兵突击队应具备高机动');

// 3. 制造车间候选配方检查
const rP = partRecipe('ap_wpn_rifle');
assert(rP && rP.producesPart === 'ap_wpn_rifle', '必须能为军事部件生成制造车间配方');
const fabRecipes = recipesForBuilding(inst, 'fabricator');
assert(fabRecipes.some((r) => r.producesPart === 'ap_wpn_rifle'), '制造车间必须包含突击步枪配方');
assert(fabRecipes.some((r) => r.producesPart === 'ap_mob_hover'), '制造车间必须包含悬浮底盘配方');

// 4. 组建部队门槛测试
const bpId = 'ab_ranger';
// 未研发 t_m5 时应被拦截
const noTechCheck = canAssembleArmy(acc, inst, bpId);
assert(!noTechCheck.ok && noTechCheck.reason.includes('军队指挥'), '缺少 t_m5 科技应被拦截');

// 解锁军队指挥科技
acc.tech.push('t_m5');
const noPartsCheck = canAssembleArmy(acc, inst, bpId);
assert(!noPartsCheck.ok && noPartsCheck.reason.includes('不足'), '缺少部件时应被拦截');

// 为装备库注入对应部件
const needs = armyBpPartNeeds(bpId);
for (const pid in needs) {
  const p = ARMY_PART_BY_ID[pid];
  const mat = (p && p.inputs && Object.keys(p.inputs)[0]) || '钢';
  addEquipment(inst, pid, mat, needs[pid] * 2);
}

const readyCheck = canAssembleArmy(acc, inst, bpId);
assert(readyCheck.ok, '部件与科技齐备时应当允许组装: ' + (readyCheck.reason || ''));

// 5. 开启整编产线与推进
const startRes = startArmyAssemble(acc, inst, bpId, 20);
assert(startRes.ok, '开启整编产线应成功');
assert.strictEqual(acc.armyBuildLines.length, 1, '应有 1 条进行中的组装线');

// 推进直到成军
let completed = [];
for (let i = 0; i < 300; i++) {
  const done = tickArmyBuildLines(acc, inst, 10, 1.0);
  if (done.length > 0) {
    completed = done;
    break;
  }
}
assert(completed.length > 0, '组装线推进至 100% 后必须自动生成部队');
const armies = listArmies(acc);
assert.strictEqual(armies.length, 1, '现役部队应增加 1 支');
assert(armies[0].nameCn.includes('游骑兵'), '部队名称应包含游骑兵');

// 6. 驻防防御战力与星际联动
const armyPwr = stationedArmyPower(acc, homeCode);
assert(armyPwr > 0, '驻防部队战力必须大于 0');
const baseDef = evaluateDefensePower(acc, inst);
assert(baseDef >= 200 + armyPwr, '星际母星防御力必须包含驻防部队战力加成');

// 切换备勤状态
toggleStationed(acc, armies[0].id);
assert(armies[0].stationed === false, '状态应切为机动备勤');
assert.strictEqual(stationedArmyPower(acc, homeCode), 0, '机动备勤状态不计入驻防要塞战力');

// 切回驻防
toggleStationed(acc, armies[0].id);
assert(armies[0].stationed === true, '应重新切回驻防');

// 7. 解散编制与部件返还（带 inst 为 null 的优雅降级测试）
const disbandRes = disbandArmy(acc, null, armies[0].id);
assert(disbandRes.ok, '解散编制即便 inst 为 null 也能通过 homePlanetCode 正常归库');
assert.strictEqual(listArmies(acc).length, 0, '现役部队应清空');

// 8. 多星球隔离防重叠推进测试
startArmyAssemble(acc, inst, bpId, 10);
assert.strictEqual(acc.armyBuildLines.length, 1, '应有 1 条在母星的产线');
const otherPlanetInst = { code: 'des1', nameCn: '荒漠星' };
const preProg = acc.armyBuildLines[0].progress;
// 传入非本星实例 tick，产线不应被错误推进
tickArmyBuildLines(acc, otherPlanetInst, 10, 1.0);
assert.strictEqual(acc.armyBuildLines[0].progress, preProg, '非所属星球实例 tick 时不得推进该产线进度');
cancelArmyAssemble(acc, inst, acc.armyBuildLines[0].id);
assert.strictEqual(acc.armyBuildLines.length, 0, '取消产线后列表应清空');

console.log('✅ 军队系统核心逻辑与制造车间联动探针测试全部通过！');

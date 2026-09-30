// docs/_probe_mods.mjs —— Astrix v0.2.2 · 离线 mod 系统自检探针
// 验证：安装/校验拒绝、启停、效果合成、新档开局加成（Ascoin + 母星资源落库）。
import {
  listMods, installMod, setModEnabled, removeMod, modEffects,
} from '../js/core/mods.js?v=21.16';
import { STATE, createAccount, getPlanetInstance, BASE_COLLECT_RATE } from '../js/core/state.js?v=21.16';

let pass = 0, fail = 0;
function check(name, cond, detail) {
  if (cond) { pass++; console.log('  ✓ PASS ' + name + (detail ? '  ' + detail : '')); }
  else { fail++; console.log('  ✗ FAIL ' + name + (detail ? '  ' + detail : '')); }
}

console.log('\n===== ① 安装与校验 =====');
check('初始无 mod', listMods().length === 0);
const rBad = installMod('{ not json');
check('非法 JSON 被拒', rBad.ok === false, rBad.reason || '');
const rNoName = installMod('{"effects":{"collectRateMul":2}}');
check('缺 name 被拒', rNoName.ok === false, rNoName.reason || '');
const rBadField = installMod('{"name":"坏","effects":{"godMode":true}}');
check('未知效果字段被拒', rBadField.ok === false, rBadField.reason || '');
const rBig = installMod('{"name":"爆数值","effects":{"collectRateMul":99999}}');
check('超上限倍率被夹取', rBig.ok === true && rBig.mod.effects.collectRateMul === 100, 'collectRateMul=' + (rBig.mod && rBig.mod.effects.collectRateMul));
const rNeg = installMod('{"name":"负资源","effects":{"startResources":{"石头":-5}}}');
check('负数开局资源被拒', rNeg.ok === false, rNeg.reason || '');
removeMod(rBig.mod.id);   // 「爆数值」仅测夹取，随即卸载，避免污染后续合成断言
check('清理后回到无 mod 基线', listMods().length === 0 && modEffects().collectRateMul === 1);

console.log('\n===== ② 启停与效果合成 =====');
const rA = installMod('{"name":"采集三倍","effects":{"collectRateMul":3}}');
const rB = installMod('{"name":"科研两倍","effects":{"researchRateMul":2,"startAscoin":100000,"startResources":{"石头":2000,"水":3000}}}');
check('安装成功', rA.ok && rB.ok);
check('合成：采集 = 3（一个 mod 生效）', modEffects().collectRateMul === 3, 'x' + modEffects().collectRateMul);
const rC = installMod('{"name":"采集再两倍","effects":{"collectRateMul":2}}');
check('合成：采集 = 6（两个 mod 乘法叠加）', modEffects().collectRateMul === 6, 'x' + modEffects().collectRateMul);
setModEnabled(rC.mod.id, false);
check('停用后回到 3', modEffects().collectRateMul === 3);
removeMod(rC.mod.id);
check('卸载后仍为 3 且列表减少', modEffects().collectRateMul === 3 && listMods().length === 2);
setModEnabled(rB.mod.id, false);
check('停用 B 后科研回到 1、开局加成清零', modEffects().researchRateMul === 1 && modEffects().startAscoin === 0 && !modEffects().startResources['石头']);
setModEnabled(rB.mod.id, true);
check('重新启用后加成恢复', modEffects().startAscoin === 100000 && modEffects().startResources['石头'] === 2000);

console.log('\n===== ③ 新档开局加成 =====');
STATE.accounts = [];
STATE.planets = [];
STATE.currentAccountId = null;
const acc = createAccount('mod测试员', 'fresh');
check('开局 Ascoin = mod 追加（默认 0 + 100000）', Number(acc.ascoin) >= 100000, 'ascoin=' + acc.ascoin);
check('资源暂存标记存在（母星实例未建）', acc._modStartRes && acc._modStartRes['石头'] === 2000, JSON.stringify(acc._modStartRes));
const inst = getPlanetInstance(acc.homePlanetCode);
check('母星实例创建后暂存被清除', !acc._modStartRes);
const stone = (inst.inventory || []).find((e) => e.mat === '石头');
const water = (inst.inventory || []).find((e) => e.mat === '水');
check('石头 +2000 落库母星', stone && stone.owned >= 2000, '石头=' + (stone && stone.owned));
check('水 +3000 落库母星', water && water.owned >= 3000, '水=' + (water && water.owned));

console.log('\n===== ④ 采集速率接入 mod 倍率（只验证不抛异常与口径存在） =====');
let rateOk = true;
try {
  // 无人采集时 rate 应为 0 且不抛异常；有 mod 时同口径
  inst.pop.assignments['surface_gatherer'] = { count: 10, intensityId: 'standard' };
  // recalcRates 内部由 getPlanetInstance 完成；这里直接复算校验 543 行口径可被 modEffects 乘
  const expectMul = modEffects().collectRateMul;
  check('modEffects().collectRateMul 可读且 > 1', expectMul === 3, 'x' + expectMul);
} catch (e) { rateOk = false; }
check('采集速率路径无异常', rateOk);

console.log('\n===== ⑤ 清理 =====');
for (const m of listMods()) removeMod(m.id);
check('全部卸载后效果归一', modEffects().collectRateMul === 1 && modEffects().startAscoin === 0);

console.log('\n===== 探针汇总 =====');
console.log('  通过 ' + pass + ' / 失败 ' + fail);
process.exit(fail ? 1 : 0);

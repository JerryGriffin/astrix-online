// docs/_probe_deploy_regress.mjs —— v0.3.3 军队组装「卡进度 / 无限扣装备」防回归
//
// 缺陷机制（已修）：
//   旧顺序 = 扣装备(305-317) → armyStatsOfBp(321) → arr.push(322) → 进度清零(336)
//   任一步抛错 → 装备已扣、进度不清零 → 下 tick 重入 chk.ok → 再扣一次 → 无限循环。
//   最恶劣形态：acc 为 null 时 listArmies(null) 返回**临时空数组**，push 随返回丢弃，
//   不抛错、不回滚、装备照扣 → 玩家只看到进度卡在 1−ε。
import { armyBuildTick, armyBuildCheck, listArmies } from '../js/core/army.js?v=49.2';
import { ARMY_BP_BY_ID, armyBpPartNeeds } from '../js/data/army_parts.js?v=49.2';

let pass = 0, fail = 0;
function check(name, cond, detail) {
  if (cond) { pass++; console.log('  ✓ ' + name + (detail ? '  ' + detail : '')); }
  else { fail++; console.log('  ✗ ' + name + (detail ? '  ' + detail : '')); }
}

const bpId = Object.keys(ARMY_BP_BY_ID)[0];
const bp = ARMY_BP_BY_ID[bpId];

// 造一个装备刚好够 1 支的 inst
function mkInst(times) {
  const inst = { equipment: {}, armyProgress: {} };
  const need = armyBpPartNeeds(bp);
  for (const p in need) inst.equipment['k_' + p] = { partId: p, count: need[p] * times };
  return inst;
}
const eqCount = (inst) => Object.values(inst.equipment).reduce((s, e) => s + (Number(e.count) || 0), 0);

// ---------------------------------------------------------------------------
console.log('\n===== 一、acc 为 null：绝不扣装备 =====');
{
  const inst = mkInst(1);
  const before = eqCount(inst);
  let threw = null;
  for (let i = 0; i < 5; i++) {   // 连跑 5 tick，旧版会把装备扣光
    try { armyBuildTick(inst, bpId, 1000, 10, 1, null); }
    catch (e) { threw = e; }
  }
  check('不抛错', !threw, threw ? threw.message : '');
  check('装备一件未少', eqCount(inst) === before, before + ' -> ' + eqCount(inst));
  check('进度封顶在 [0,1)', inst.armyProgress[bpId] < 1, 'prog=' + inst.armyProgress[bpId]);
}

// ---------------------------------------------------------------------------
console.log('\n===== 二、自定义蓝图 parts 缺失：抛错但绝不扣装备 =====');
{
  const badBp = { id: 'bp_bad', nameCn: '坏蓝图', buildWork: 1, parts: null };
  const acc = { armies: [], armyBlueprints: [badBp], tech: [], ships: [] };
  const inst = { equipment: { k1: { partId: 'ap_frame_light', count: 99 } }, armyProgress: {} };
  let threw = null;
  for (let i = 0; i < 3; i++) {
    try { armyBuildTick(inst, 'bp_bad', 1000, 10, 1, acc); }
    catch (e) { threw = e; }
  }
  check('确实抛错（说明走到了 armyStatsOfBp）', !!threw, threw ? threw.name : '未抛错');
  check('装备一件未少', eqCount(inst) === 99, '剩 ' + eqCount(inst));
  check('未产出军队', listArmies(acc).length === 0);
}

// ---------------------------------------------------------------------------
console.log('\n===== 三、正常路径：扣件与成军同生共死 =====');
{
  const acc = { armies: [], armyBlueprints: [], tech: [], ships: [] };
  const inst = mkInst(1);
  const before = eqCount(inst);
  const needAll = Object.values(armyBpPartNeeds(bp)).reduce((s, n) => s + n, 0);
  armyBuildTick(inst, bpId, 1000, 10, 1, acc);
  const arr = listArmies(acc);
  check('产出 1 支军队', arr.length === 1, arr.map(a => a.nameCn).join(','));
  check('装备精确扣掉 ' + needAll + ' 件', before - eqCount(inst) === needAll, before + ' -> ' + eqCount(inst));
  check('进度清零', inst.armyProgress[bpId] === 0, 'prog=' + inst.armyProgress[bpId]);
  check('军队带完整 stats', !!(arr[0] && arr[0].stats && arr[0].power > 0), 'power=' + (arr[0] || {}).power);
}

// ---------------------------------------------------------------------------
console.log('\n===== 四、装备刚好够 1 支：不得多扣 =====');
{
  const acc = { armies: [], armyBlueprints: [], tech: [], ships: [] };
  const inst = mkInst(2);
  const before = eqCount(inst);
  const needAll = Object.values(armyBpPartNeeds(bp)).reduce((s, n) => s + n, 0);
  for (let i = 0; i < 4; i++) armyBuildTick(inst, bpId, 1000, 10, 1, acc);   // 连跑 4 tick
  const arr = listArmies(acc);
  check('4 tick 后只产出 2 支（库存上限）', arr.length === 2, '实得 ' + arr.length);
  check('扣件总量 = 2 × ' + needAll, before - eqCount(inst) === needAll * 2, before + ' -> ' + eqCount(inst));
  check('装备恰好用尽', eqCount(inst) === 0, '剩 ' + eqCount(inst));
  check('编号 No.1/No.2', arr[0].nameCn.endsWith('No.1') && arr[1].nameCn.endsWith('No.2'),
    arr.map(a => a.nameCn).join(' | '));
}

// ---------------------------------------------------------------------------
console.log('\n===== 五、缺件时卡住但不扣任何装备 =====');
{
  const acc = { armies: [], armyBlueprints: [], tech: [], ships: [] };
  const inst = { equipment: {}, armyProgress: {} };     // 一件都没有
  let threw = null;
  for (let i = 0; i < 5; i++) {
    try { armyBuildTick(inst, bpId, 1000, 10, 1, acc); } catch (e) { threw = e; }
  }
  check('不抛错', !threw, threw ? threw.message : '');
  check('不产出军队', listArmies(acc).length === 0);
  check('进度卡在 1−ε', inst.armyProgress[bpId] > 0.999 && inst.armyProgress[bpId] < 1,
    'prog=' + inst.armyProgress[bpId]);
  check('装备仍为 0（无误扣）', eqCount(inst) === 0);
}

console.log('\n===== 汇总 =====');
console.log('  通过 ' + pass + ' / 失败 ' + fail);
if (fail === 0) console.log('  全部通过 ✅');
process.exit(fail === 0 ? 0 : 1);

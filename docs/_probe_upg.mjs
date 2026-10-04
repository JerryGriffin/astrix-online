// W-RESEARCH 探针（v0.1.2，R18）
// 所有相对导入带 ?v=11.0，严格照契约，避免双模块实例。
// 用途：核验科研升级「效果」由等差改为乘方（底数 1.6）。
// 运行：node docs/_probe_upg.mjs

import { UPGRADES, UPGRADE_BY_ID, upgradeMul, upgradeFactorAt } from '../js/data/upgrades.js?v=46.11';

let passed = 0;
let failed = 0;
const fails = [];

function check(name, cond, detail) {
  if (cond) {
    passed += 1;
    console.log(`  [PASS] ${name}${detail ? ' — ' + detail : ''}`);
  } else {
    failed += 1;
    fails.push(name);
    console.log(`  [FAIL] ${name}${detail ? ' — ' + detail : ''}`);
  }
}

// 造一个带指定等级的假账号
function accWith(key, lv) {
  return { upgrades: lv ? { [key]: lv } : {} };
}

// 兜底：探针容差（浮点）
const approx = (a, b, eps = 1e-9) => Math.abs(a - b) <= eps;

console.log('=== 1) 未购买时 upgradeMul 返回 1 ===');
for (const u of UPGRADES) {
  const v = upgradeMul(accWith(u.id, 0), u.id);
  check(`${u.id} 未购买 upgradeMul == 1`, v === 1, `实际 ${v}`);
}

console.log('=== 2) 6 项升级 1/2/3/5 级符合 1.6^(n-1) 叠加首级效果 ===');
const sixKeys = ['upg_collect', 'upg_refine', 'upg_power', 'upg_labor', 'upg_research', 'upg_build'];
for (const key of sixKeys) {
  const u = UPGRADE_BY_ID[key];
  const base = u.effectBase;
  const pow = u.effectPow || 1.6;
  for (const n of [1, 2, 3, 5]) {
    const expectedFactor = 1 + base * Math.pow(pow, n - 1);
    const got = upgradeMul(accWith(key, n), key);
    const expectedEff = base * Math.pow(pow, n - 1); // 效果_n
    const gotEff = got - 1;
    check(`${key} Lv${n} 效果 == ${base}×${pow}^(${n}-1)`,
      approx(gotEff, expectedEff) && approx(got, expectedFactor),
      `期望效果 ${expectedEff.toFixed(6)} / 系数 ${expectedFactor.toFixed(6)}，实际系数 ${got.toFixed(6)}`);
  }
}

console.log('=== 3) 6 个 key 都有定义 ===');
for (const key of sixKeys) {
  const defined = UPGRADE_BY_ID[key] != null;
  check(`${key} 已定义于 UPGRADES`, defined, defined ? `effectBase=${(UPGRADE_BY_ID[key].effectBase)} effectPow=${(UPGRADE_BY_ID[key].effectPow)}` : '缺失');
}

console.log('=== 4) 前 6 级数值表（系数 / 效果%）===');
console.log('  key          |' + [1, 2, 3, 4, 5, 6].map((n) => `Lv${n}系数`.padStart(11)).join(' |'));
for (const key of sixKeys) {
  const u = UPGRADE_BY_ID[key];
  const cells = [1, 2, 3, 4, 5, 6].map((n) => {
    const f = upgradeFactorAt(u, n);
    return (f.toFixed(4)).padStart(11);
  });
  console.log('  ' + key.padEnd(12) + ' |' + cells.join(' |'));
}
console.log('  （效果% = (系数-1)×100；build 为负向即工程量减少）');
// 额外打印 build 的效果% 表，便于直观核验负向乘方
console.log('  upg_build 效果%: ' +
  [1, 2, 3, 4, 5, 6].map((n) => ((upgradeFactorAt(UPGRADE_BY_ID.upg_build, n) - 1) * 100).toFixed(1) + '%').join(' / '));

console.log(`\n=== 结果: 通过 ${passed} / 失败 ${failed} ===`);
if (failed > 0) {
  console.log('失败项:', fails.join(', '));
  process.exit(1);
} else {
  console.log('全部探针通过 ✅');
}

// ============================================================================
// v0.4.6 需求自检 —— node docs/selfcheck_v046.mjs
// ============================================================================
//   #11 装备制造和蓝图可以选择任意材料（含自定义化工厂 / 精加工材料）
//   #12 自定义化工厂：任意自选任意数目的原料合成自定义合金
// ============================================================================

import { readFileSync } from 'fs';
import { pathToFileURL } from 'url';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const { CACHE_TAG } = await import(pathToFileURL(join(ROOT, 'js/version.js')));
const U = (p) => pathToFileURL(join(ROOT, p)) + `?v=${CACHE_TAG}`;
const srcOf = (rel) => readFileSync(join(ROOT, rel), 'utf8');

const S = await import(U('/js/core/state.js'));
const PR = await import(U('/js/core/production.js'));
const SY = await import(U('/js/core/shipyard.js'));
const AR = await import(U('/js/core/army.js'));
const MAT = await import(U('/js/data/materials.js'));
const SP = await import(U('/js/data/ship_parts.js'));

let pass = 0, fail = 0; const bad = [];
function ok(c, n, e) {
  if (c) { pass++; console.log('  ✓ ' + n); }
  else { fail++; bad.push(n + (e ? ' → ' + e : '')); console.log('  ✗ ' + n + (e ? '  [' + e + ']' : '')); }
}

console.log('\n=== v0.4.6 需求自检（CACHE_TAG=' + CACHE_TAG + '） ===\n');

// ---------------------------------------------------------------------------
console.log('#11 任意材料：候选不再受硬编码白名单限制');
{
  // 气体仍被排除（唯一物理门槛，沿用 v0.0.61 冻结名单）
  ok(SY.isStructurableMaterial('钢') === true, '钢可用');
  ok(SY.isStructurableMaterial('钛合金') === true, '钛合金可用');
  for (const g of ['氮气', '氧气', '氨气', '甲烷', '二氧化碳', '氢气']) {
    ok(SY.isStructurableMaterial(g) === false, '气体不可作结构材料：' + g);
  }
  ok(SY.isStructurableMaterial('不存在的材料') === false, '不存在的材料不可用');

  // 白名单里的经典材料仍都在（不能因为「放开」把老的弄丢）
  const opts = SY.materialOptionsFor('hull', null, {});
  ok(opts.length > 20, '候选材料数量远超旧白名单（10 种）', String(opts.length));
  for (const m of SP.MATERIAL_SLOTS.hull) {
    ok(opts.some((o) => o.name === m), '经典材料仍在候选内：' + m);
  }
  ok(opts.every((o) => !['氮气', '氧气', '甲烷', '氢气', '二氧化碳', '氨气'].includes(o.name)),
    '候选里没有任何气体');
  // 推荐标记：白名单降级为「推荐」，只影响排序
  ok(opts.some((o) => o.recommended && o.name === '钢'), '钢被标为推荐');
  ok(opts.some((o) => !o.recommended), '非白名单材料也存在（未标推荐）');
}

// ---------------------------------------------------------------------------
console.log('\n#11 自定义合金可被选中（核心诉求）');
{
  S.newGame('v046a');
  const acc = S.currentAccount();
  const inst = S.getPlanetInstance(acc.homePlanetCode);
  // 造一种自定义合金（用内置材料，配方合法）
  const r = PR.makeCustomMaterial(inst, '测试合金', [
    { mat: '铁', amt: 6 }, { mat: '钛', amt: 6 },
  ]);
  ok(r.ok, '能创建自定义合金', r.reason || '');
  const name = r.material && r.material.nameCn;

  // 候选清单里必须出现它
  const opts = SY.materialOptionsFor('hull', inst, { lookup: PR.materialLookup(inst) });
  const mine = opts.find((o) => o.name === name);
  ok(!!mine, '自定义合金出现在材料候选里');
  ok(mine && mine.custom === true, '被标记为「自造」');

  // 关键：倍率必须按它**真实的推导属性**结算，而不是退回 ×1.00
  const mulReal = SY.materialMul(name, PR.materialLookup(inst));
  const mulNoLookup = SY.materialMul(name, null);
  ok(mulReal.mat != null, 'materialMul 能查到自定义合金');
  ok(Math.abs(mulReal.structMul - SY.materialMul('铁', null).structMul) > 1e-9,
    '自定义合金的结构倍率 ≠ 铁（旧代码会静默退回 ×1.00）',
    'real=' + mulReal.structMul.toFixed(3) + ' fallback=' + mulNoLookup.structMul.toFixed(3));

  // ACTIVE_LOOKUP 桥接：深层路径（不传 lookup）也能拿到真实值
  const mulActive = SY.materialMul(name);
  ok(Math.abs(mulActive.structMul - mulReal.structMul) < 1e-9,
    '不传 lookup 时也能取到真实倍率（ACTIVE_LOOKUP 桥接生效）',
    mulActive.structMul.toFixed(3));

  // 军事部件材料候选同样包含自定义合金
  const apOpts = AR.armyPartMaterialOptions('ap_wpn_rifle', inst, { lookup: PR.materialLookup(inst) });
  ok(apOpts.some((o) => o.name === name), '军事部件也能用自定义合金');

  // 蓝图部件配方（制造车间生产线的材料候选）
  const fac = PR.recipesForBuilding(inst, 'fabricator', acc);
  const hullR = fac.find((r) => r.id === 'part_hull_s' || (r.id || '').startsWith('part_hull'));
  ok(!!hullR, '外壳部件配方存在');
  ok(hullR && Array.isArray(hullR.materials) && hullR.materials.includes(name),
    '外壳部件的可选材料含自定义合金',
    hullR ? String((hullR.materials || []).length) : '');
  ok(hullR && hullR.materials.length > SP.MATERIAL_SLOTS.hull.length,
    '可选材料数已超过旧白名单', hullR ? hullR.materials.length + ' vs ' + SP.MATERIAL_SLOTS.hull.length : '');

  // 删除后必须从候选里消失（否则成幽灵材料）
  ok(PR.removeCustomMaterial(inst, r.key), '能删除自定义合金');
  const opts2 = SY.materialOptionsFor('hull', inst, { lookup: PR.materialLookup(inst) });
  ok(!opts2.some((o) => o.name === name), '删除后不再出现在候选里');
  const mulAfter = SY.materialMul(name, PR.materialLookup(inst));
  ok(mulAfter.mat == null, '删除后 materialMul 查不到（不会继续参与结算）');
}

// ---------------------------------------------------------------------------
console.log('\n#11 蓝图可用自定义合金结算数值');
{
  S.newGame('v046b');
  const acc = S.currentAccount();
  const inst = S.getPlanetInstance(acc.homePlanetCode);
  const r = PR.makeCustomMaterial(inst, '高强合金', [
    { mat: '钢', amt: 8 }, { mat: '钨', amt: 8 },
  ]);
  ok(r.ok, '创建高强合金', r.reason || '');
  const nm = r.material.nameCn;
  const lookup = PR.materialLookup(inst);

  // 用它造一个舰船部件：结构倍率应真的影响结果
  const bpBase = { hullId: 'hull_s_mk1', hullMaterial: '铁', engines: [{ id: 'engine_basic', material: '铁' }], parts: [] };
  const bpAlloy = { ...bpBase, hullMaterial: nm };
  const evBase = SY.evaluateBlueprint(bpBase, { researched: new Set(), ships: [], lookup });
  const evAlloy = SY.evaluateBlueprint(bpAlloy, { researched: new Set(), ships: [], lookup });
  ok(!!evAlloy, '自定义合金蓝图可求值');
  const hullBase = evBase.agg, hullAlloy = evAlloy.agg;
  ok(hullAlloy && hullBase && hullBase.struct !== hullAlloy.struct,
    '舰体结构强度因材料不同而不同',
    hullBase && hullAlloy ? hullBase.struct + ' → ' + hullAlloy.struct : 'no agg');

  // 军队蓝图同理
  const ap = { parts: [{ id: 'ap_frame_heavy', count: 2, material: nm }, { id: 'ap_wpn_rifle', count: 4, material: nm }] };
  const apIron = { parts: [{ id: 'ap_frame_heavy', count: 2, material: '铁' }, { id: 'ap_wpn_rifle', count: 4, material: '铁' }] };
  const stA = AR.armyStatsOfBp(ap, lookup);
  const stI = AR.armyStatsOfBp(apIron, lookup);
  ok(stA.atk !== stI.atk, '军队攻击力因材料不同而不同', stI.atk + ' → ' + stA.atk);
}

// ---------------------------------------------------------------------------
console.log('\n#12 任意数目原料');
{
  ok(PR.CUSTOM_AMT_MAX >= 512, '原料总量上限已放开（≥512）', String(PR.CUSTOM_AMT_MAX));
  ok(PR.CUSTOM_KIND_MAX >= 12, '原料种数上限 ≥12', String(PR.CUSTOM_KIND_MAX));

  S.newGame('v046c');
  const acc = S.currentAccount();
  const inst = S.getPlanetInstance(acc.homePlanetCode);
  // 给足所有材料，避免缺料干扰
  for (const e of inst.inventory) e.owned = 1e6;

  // 2 种（最小）
  const r2 = PR.makeCustomMaterial(inst, '二元合金', [{ mat: '铁', amt: 4 }, { mat: '钢', amt: 4 }]);
  ok(r2.ok, '2 种原料可创建（最小）', r2.reason || '');

  // 12 种
  const many = [];
  const names = ['铁', '钢', '钛', '铝', '铜', '钨', '铱', '钚', '锂', '锰', '铀', '金'];
  for (let i = 0; i < 12; i++) many.push({ mat: names[i] || '铁', amt: 4 });
  const names2 = [...new Set(many.map((p) => p.mat))];
  const r12 = PR.makeCustomMaterial(inst, '十二元合金', names2.map((p) => ({ mat: p, amt: 4 })));
  ok(r12.ok, '12 种原料可创建', r12.reason || '');

  // 远超旧上限的总量（旧上限 16）
  const rBig = PR.makeCustomMaterial(inst, '巨量合金', [{ mat: '铁', amt: 200 }, { mat: '钢', amt: 200 }]);
  ok(rBig.ok, '总量 400 可创建（旧上限只有 16）', rBig.reason || '');

  // 超上限被拒
  const rOver = PR.makeCustomMaterial(inst, '超额合金', [{ mat: '铁', amt: PR.CUSTOM_AMT_MAX + 1 }, { mat: '钢', amt: 1 }]);
  ok(rOver.ok === false, '超过总量上限仍被拒绝');
  // 单种仍要求 ≥1 整数
  const rBad = PR.makeCustomMaterial(inst, '零量合金', [{ mat: '铁', amt: 0 }, { mat: '钢', amt: 8 }]);
  ok(rBad.ok === false, '数量 0 被拒绝');
  // 仍至少 2 种
  const rOne = PR.makeCustomMaterial(inst, '单料合金', [{ mat: '铁', amt: 16 }]);
  ok(rOne.ok === false, '只选 1 种原料仍被拒绝（需要至少 2 种）');
  // 不存在的材料仍被拒
  const rGhost = PR.makeCustomMaterial(inst, '幽灵合金', [{ mat: '玄冰', amt: 8 }, { mat: '铁', amt: 8 }]);
  ok(rGhost.ok === false, '不存在的材料被拒绝');
}

// ---------------------------------------------------------------------------
console.log('\n#12 定义配方不再要求「当场凑齐原料」');
{
  S.newGame('v046d');
  const acc = S.currentAccount();
  const inst = S.getPlanetInstance(acc.homePlanetCode);
  // 清空库存
  for (const e of inst.inventory) e.owned = 0;
  const r = PR.makeCustomMaterial(inst, '无料合金', [{ mat: '铁', amt: 100 }, { mat: '钢', amt: 100 }]);
  ok(r.ok, '库存为零时也能**定义**配方（旧代码会报「不足」）', r.reason || '');
  ok(Array.isArray(r.warnings) && r.warnings.length === 2, '缺料转为警告（2 条）',
    JSON.stringify(r.warnings));
  ok(r.ok && r.warnings[0].includes('现有 0'), '警告里如实说明缺多少', r.warnings && r.warnings[0]);
  ok(PR.customMaterialsOf(inst)[r.key] != null, '配方确实写入了');
}

// ---------------------------------------------------------------------------
console.log('\n#12 合成工时随复杂度增长（消除「无脑多掺」最优解）');
{
  ok(PR.customWorkOf(2, 16) > 0, '基础工时为正');
  const w2 = PR.customWorkOf(2, 16);
  const w12 = PR.customWorkOf(12, 48);
  const w24 = PR.customWorkOf(24, 480);
  ok(w12 > w2, '种数越多工时越长', w2 + ' → ' + w12);
  ok(w24 > w12, '种数与总量继续增长时工时继续上升', w12 + ' → ' + w24);
  // 协同加成是 1+0.06(n-1)，工时必须涨得比它快才有取舍
  const synergy2 = 1 + 0.06 * (2 - 1);
  const synergy24 = 1 + 0.06 * (24 - 1);
  ok(w24 / w2 > synergy24 / synergy2,
    '工时增幅 > 协同加成增幅（多掺不再是无脑赚）',
    'work×' + (w24 / w2).toFixed(2) + ' vs synergy×' + (synergy24 / synergy2).toFixed(2));

  // 实际创建的配方工时确实被写入
  S.newGame('v046e');
  const acc = S.currentAccount();
  const inst = S.getPlanetInstance(acc.homePlanetCode);
  for (const e of inst.inventory) e.owned = 1e6;
  const simple = PR.makeCustomMaterial(inst, '简单合金', [{ mat: '铁', amt: 4 }, { mat: '钢', amt: 4 }]);
  const complex = PR.makeCustomMaterial(inst, '复杂合金', [
    { mat: '铁', amt: 40 }, { mat: '钢', amt: 40 }, { mat: '钛', amt: 40 },
    { mat: '铝', amt: 40 }, { mat: '铜', amt: 40 }, { mat: '钨', amt: 40 },
  ]);
  ok(simple.ok && complex.ok, '两种合金都创建成功');
  ok(complex.recipe.work > simple.recipe.work * 3,
    '复杂合金工时显著更高（配方里真的写进去了）',
    simple.recipe.work + ' → ' + complex.recipe.work);
  ok(complex.recipe.kindCount === 6 && complex.recipe.totalAmt === 240,
    '配方记录了种数与总量（供 UI 展示）',
    complex.recipe.kindCount + '/' + complex.recipe.totalAmt);
  ok(complex.recipe.inputs && Object.keys(complex.recipe.inputs).length === 6,
    '配方投料含全部 6 种原料');
}

// ---------------------------------------------------------------------------
console.log('\n#12 自定义合金可作为「另一合金」的原料');
{
  S.newGame('v046f');
  const acc = S.currentAccount();
  const inst = S.getPlanetInstance(acc.homePlanetCode);
  for (const e of inst.inventory) e.owned = 1e6;
  const a = PR.makeCustomMaterial(inst, '底料合金', [{ mat: '铁', amt: 8 }, { mat: '钢', amt: 8 }]);
  ok(a.ok, '第一层合金创建成功', a.reason || '');
  // 库存里补上第一种合金
  PR.ensureEntry(inst, a.material.nameCn, 'refined').owned = 1e5;
  const b = PR.makeCustomMaterial(inst, '上层合金', [
    { mat: a.material.nameCn, amt: 8 }, { mat: '钛', amt: 8 },
  ]);
  ok(b.ok, '能用自定义合金当原料再造第二种合金', b.reason || '');
  ok(b.ok && b.material.strength > 0, '第二层合金属性被正确推导', b.material && String(b.material.strength));
}

// ---------------------------------------------------------------------------
console.log('\n回归：旧白名单接口未被破坏');
{
  ok(SP.MATERIAL_SLOTS && SP.MATERIAL_SLOTS.hull.length === 10, 'MATERIAL_SLOTS 仍导出（其他模块仍在用）');
  ok(SP.DEFAULT_MATERIAL && SP.DEFAULT_MATERIAL.hull === '铁', 'DEFAULT_MATERIAL 仍在');
  ok(typeof PR.materialLookup === 'function', 'production#materialLookup 仍导出（转发实现）');
  ok(typeof SY.materialLookupFor === 'function', 'shipyard#materialLookupFor 可用');
  // 老存档兼容：没有 customMaterials 字段时不能炸
  const fake = { inventory: [] };
  ok(SY.materialOptionsFor('hull', fake, {}).length > 0, '没有 customMaterials 字段时正常返回候选');
  ok(SY.materialOptionsFor('hull', null, {}).length > 0, 'inst 为 null 时正常返回候选');
  ok(SY.materialMul(null).structMul === 1, 'materialMul(null) 仍返回基准倍率');
  ok(SY.materialMul('不存在的材料').structMul === 1, '未知材料返回基准倍率');
  // 研究页仍读 MATERIAL_SLOTS
  ok(srcOf('js/ui/research.js').includes('MATERIAL_SLOTS'), 'research.js 的用法未被破坏');
}

// ---------------------------------------------------------------------------
console.log('\n通过 ' + pass + ' / 失败 ' + fail);
if (fail) {
  console.log('\n失败项：');
  for (const b of bad) console.log('  · ' + b);
  process.exit(1);
}
console.log('v0.4.6 需求自检通过');
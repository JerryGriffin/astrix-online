// 离线推进专项探针（v0.1.3）：验证采集 / 施工 / 生产线 在离线结算里真的推进
//
// 环境坑：Node 里没有 localStorage，state.js 默认 adapter 的 get 恒 null、set 静默失败，
//   会让「持久化 + 离线结算」整条链空转（看起来什么都不推进）。必须先注入内存 adapter。
import * as S from '../js/core/state.js?v=20.16';
import * as POP from '../js/core/population.js?v=20.16';
import * as P from '../js/core/production.js?v=20.16';

const mem = new Map();
S.setAdapter({
  get: (k) => (mem.has(k) ? mem.get(k) : null),
  set: (k, v) => { mem.set(k, String(v)); },
  del: (k) => { mem.delete(k); },
});

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  ✓ ' + m); } else { fail++; console.log('  ✗ ' + m); } };

function setup(name) {
  const acc = S.createAccount(name, 'fresh');
  const inst = S.getPlanetInstance(acc.homePlanetCode);
  POP.assignWorkers(inst.pop, 'surface_gatherer', 20, inst.buildings || {});
  POP.assignWorkers(inst.pop, 'builder', 15, inst.buildings || {});
  inst.buildings = Object.assign({}, inst.buildings, { furnace: 1 });
  const rec = P.recipesForBuilding(inst, 'furnace')[0];
  if (rec) P.addLine(inst, 'furnace', rec.id, { workers: 6 });
  const sb = S.startBuild(inst, 'house', acc);
  S.saveState();                      // 注意：saveState 会把 lastSeen 刷成现在，必须**之后**再改它
  return { acc, inst, built: !!(sb && sb.ok), recipe: rec };
}
const owned = (i, m) => Number(((i.inventory || []).find((x) => x.mat === m) || {}).owned) || 0;

console.log('=== 场景：新档 → 20 人采集 + 15 人建筑工 + 熔炉产线 → 离线 2 小时 ===');
const { acc, inst, built, recipe } = setup('离线测试');
const before = { stone: owned(inst, '石头'), wood: owned(inst, '木头'), queue: (inst.buildQueue || []).length };
ok(built, '施工队列已排入一座房屋');
ok(!!recipe, '熔炉产线已建立：' + (recipe ? recipe.nameCn : '无'));

acc.stats = acc.stats || {};
acc.stats.lastSeen = Date.now() - 2 * 3600 * 1000;
const info = S.settleOffline();

const after = S.getPlanetInstance(acc.homePlanetCode);
const res = {
  stone: owned(after, '石头'), wood: owned(after, '木头'),
  queue: (after.buildQueue || []).length,
  lineRatio: Number((after.lines || [])[0] && (after.lines || [])[0]._ratio),
};
console.log('  结算:', JSON.stringify({ seconds: info && info.seconds, applied: info && info.applied }));
console.log('  推进前:', JSON.stringify(before), '→ 推进后:', JSON.stringify(res));

ok(!!info && info.applied > 0, 'settleOffline 有返回推进时长（applied=' + (info && info.applied) + '）');
ok(res.stone > before.stone, `采集在离线中推进：石头 ${before.stone} → ${res.stone}`);
ok(res.queue < before.queue, `施工在离线中推进：队列 ${before.queue} → ${res.queue}`);
ok(res.wood > before.wood, `生产线在离线中推进：木头 ${before.wood} → ${res.wood}`);
// 内存必须与磁盘一致：此前结算只写盘、内存仍是旧实例，UI 显示「没推进」且下次存档把成果覆盖
const mem2 = S.getPlanetInstance(acc.homePlanetCode);
ok(Math.abs(owned(mem2, '木头') - res.wood) < 1e-6, '结算后内存实例已是推进过的新实例（不是旧快照）');

console.log('\n== 结果: 通过 ' + pass + ' / 失败 ' + fail + ' ==');
if (fail > 0) process.exit(1);
console.log('全部探针通过 ✅');

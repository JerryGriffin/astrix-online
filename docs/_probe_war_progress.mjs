// docs/_probe_war_progress.mjs —— v0.3.3 tickWarsHoi4 改用真实动态数据
//
// 旧缺陷：推进条读 data/hoi1936.js 的 1936 **静态** divisions/ic，
//         玩家扩军 / 补员 / 工业发展完全不影响推进条 →
//         「连败仍推进」「扩军后推进速度不变」等荒谬结果。
// 本探针验证：扩军与工业增长会真实改变推进速度。
import { tickWarsHoi4, setHoiDeps } from '../js/core/hoi1936.js?v=44.9';
import { HOI_BY_ID } from '../js/data/hoi1936.js?v=44.9';

let pass = 0, fail = 0;
const check = (n, c, d) => { if (c) { pass++; console.log('  ✓ ' + n + (d ? '  ' + d : '')); } else { fail++; console.log('  ✗ ' + n + (d ? '  ' + d : '')); } };

// 注入依赖：让 hoi1936 拿得到 inst.hoiIndustry
// ⚠️ setHoiDeps 是**全局单例**（_getInst 只存一个函数），且 getInst 返回的实例
//    是惰性求值的。所以用 currentIc 指向「当前正在 tick 的账号的 ic」，
//    并用 WeakMap 把账号与其 ic 一一对应，避免两个账号互相串味
//    （我第一版就踩了：两个账号共用一个变量，结果两条曲线完全相同）。
let currentIc = 20;
setHoiDeps({ getInst: () => ({ hoiIndustry: { ic: currentIc, buildings: 5 } }) });

const IC_OF = new WeakMap();     // acc → 自己的 ic 值

function mkAcc(nation, wars, armies, ic) {
  const a = {
    id: 'wp_' + nation + '_' + (IC_OF_序号()), scenario: 'hoi1936', nation,
    scenarioStartedAt: Date.now(), hoiFocus: null,
    wars, warLog: [], npcAllies: [], armies: armies || [],
  };
  IC_OF.set(a, ic == null ? 20 : ic);
  return a;
}
let _seq = 0;
function IC_OF_序号() { return ++_seq; }

/** tick 某个账号前把全局 ic 切到该账号自己的值 */
function tickAs(acc, dt) {
  currentIc = IC_OF.has(acc) ? IC_OF.get(acc) : 20;
  tickWarsHoi4(acc, dt);
}
const mkWar = (id, foe, my, their) => ({
  id, kind: 'npc', targetId: 'hoi_' + foe, targetName: 'x',
  startedAt: Date.now(), myScore: my || 0, theirScore: their || 0,
  battles: 0, status: 'active', endedAt: 0, treaty: null, progress: 0,
});

// ---------------------------------------------------------------------------
console.log('\n===== 一、扩军应加快推进（核心修复）=====');
{
  // 同一个对手，只改变我方军队数量
  const weak = mkAcc('ger', [mkWar('w1', 'fra')], [{ power: 100 }], 20);
  const strong = mkAcc('ger', [mkWar('w1', 'fra')], [{ power: 5000 }], 20);
  tickAs(weak, 30);
  tickAs(strong, 30);
  const pw = weak.wars[0].progress, ps = strong.wars[0].progress;
  check('弱军推进为负（我优劣势明显时不应猛推）', pw < 0 || pw === 0, 'prog=' + pw.toFixed(3));
  check('强军推进快于弱军', ps > pw, ps.toFixed(3) + ' > ' + pw.toFixed(3));
}

// ---------------------------------------------------------------------------
console.log('\n===== 二、工业增长应加快推进 =====');
{
  // ⚠️ 每个账号要有**独立**的 ic：getInst 是惰性求值闭包，若共用一个变量，
  //    先建的两个账号会读到同一个值（我第一版就踩了，结果两条曲线完全相同）。
  const lowIc = mkAcc('ger', [mkWar('w1', 'fra')], [{ power: 1000 }], 5);
  const highIc = mkAcc('ger', [mkWar('w1', 'fra')], [{ power: 1000 }], 120);
  tickAs(lowIc, 30);
  tickAs(highIc, 30);
  const a = lowIc.wars[0].progress, b = highIc.wars[0].progress;
  check('高工业推进快于低工业', b > a, b.toFixed(3) + ' > ' + a.toFixed(3));
}

// ---------------------------------------------------------------------------
console.log('\n===== 三、敌方战损衰减（打赢后推进更快）=====');
{
  const fresh = mkAcc('ger', [mkWar('w1', 'fra', 0, 0)], [{ power: 1500 }], 30);
  const worn = mkAcc('ger', [mkWar('w1', 'fra', 60, 10)], [{ power: 1500 }], 30);
  worn.wars[0].battles = 8;
  tickAs(fresh, 30);
  tickAs(worn, 30);
  const a = fresh.wars[0].progress, b = worn.wars[0].progress;
  check('我方占优时推进为正', a > 0, 'prog=' + a.toFixed(3));
  check('敌方受损后推进更快', b > a, b.toFixed(3) + ' > ' + a.toFixed(3));
}

// ---------------------------------------------------------------------------
console.log('\n===== 四、边界与鲁棒性 =====');
{
  // 无 armies 字段（旧档）
  const a1 = { id: 'x', scenario: 'hoi1936', nation: 'ger', wars: [mkWar('w1', 'fra')] };
  let threw = null;
  try { tickAs(a1, 30); } catch (e) { threw = e; }
  check('缺 armies 不抛错（旧档兼容）', !threw, threw ? threw.message : '');

  // progress 夹取在 0~100
  const a2 = mkAcc('ger', [mkWar('w1', 'fra', 200, 0)], [{ power: 999999 }], 999);
  for (let i = 0; i < 200; i++) tickAs(a2, 60);
  check('progress 不会超过 100', a2.wars[0].progress <= 100, 'prog=' + a2.wars[0].progress);

  // 已结束的战争不推进
  const a3 = mkAcc('ger', [mkWar('w1', 'fra')], [{ power: 9999 }], 99);
  a3.wars[0].status = 'ended';
  tickAs(a3, 60);
  check('已结束战争不再推进', a3.wars[0].progress === 0, 'prog=' + a3.wars[0].progress);

  // 非 1936 场景不推进
  const a4 = { id: 'y', scenario: 'classic', nation: 'ger', wars: [mkWar('w1', 'x')] };
  let t2 = null;
  try { tickAs(a4, 60); } catch (e) { t2 = e; }
  check('非 1936 存档不抛错', !t2, t2 ? t2.message : '');

  // 国策攻击加成生效
  const base = mkAcc('ger', [mkWar('w1', 'fra')], [{ power: 1200 }], 30);
  const buffed = mkAcc('ger', [mkWar('w1', 'fra')], [{ power: 1200 }], 30);
  buffed.hoiFocus = { buffs: { atkMul: 1.5 } };
  tickAs(base, 30);
  tickAs(buffed, 30);
  check('国策 atkMul 提升推进', buffed.wars[0].progress > base.wars[0].progress,
    buffed.wars[0].progress.toFixed(3) + ' > ' + base.wars[0].progress.toFixed(3));
}

// ---------------------------------------------------------------------------
console.log('\n===== 五、迫降线联动 =====');
{
  // 推进到 70 应自动把 myScore 提到 40
  const a = mkAcc('ger', [mkWar('w1', 'pol', 0, 0)], [{ power: 9000 }], 200);
  for (let i = 0; i < 200 && a.wars[0].progress < 70; i++) tickAs(a, 60);
  check('推进 ≥70% 后 myScore 提到 40（可迫降）', a.wars[0].myScore === 40,
    'prog=' + a.wars[0].progress.toFixed(1) + ' score=' + a.wars[0].myScore);
}

console.log('\n===== 汇总 =====');
console.log('  通过 ' + pass + ' / 失败 ' + fail);
if (fail === 0) console.log('  全部通过 ✅');
process.exit(fail === 0 ? 0 : 1);

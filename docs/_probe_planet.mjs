// 探针：W-PLANET（R5 / R7 / R8）行为断言
// 运行：node docs/_probe_planet.mjs
// 所有相对导入带 ?v=11.0（与契约一致，避免双份模块实例）。
//
// 断言覆盖：
//   1) R5 非同化非母星不给进入；母星 / 同化（领土）可进入
//   2) R7 setManagement 生效（含领土 locked 门禁）
//   3) R8 调派人力后母星减、新星加、总数守恒（且不会超扣母星可用人力）

// ---- 最小全局垫片（纯逻辑模块在 node 下不会触碰这些，但防万一顶层引用）----
if (typeof globalThis.window === 'undefined') globalThis.window = globalThis;
if (typeof globalThis.document === 'undefined') {
  globalThis.document = {
    createElement: () => ({ setAttribute() {}, appendChild() {}, addEventListener() {}, style: {}, set textContent(_) {}, get textContent() { return ''; } }),
    getElementById: () => null, querySelector: () => null, createTextNode: () => ({}),
  };
}
if (typeof globalThis.localStorage === 'undefined') {
  globalThis.localStorage = { getItem: () => null, setItem() {}, removeItem() {} };
}
if (typeof globalThis.alert === 'undefined') globalThis.alert = () => {};

import { STATE, getPlanetInstance, currentAccount } from '../js/core/state.js?v=26.6';
import { getAvailable } from '../js/core/population.js?v=26.6';
import {
  MANAGEMENT_MODES, modeOf, setManagement,
} from '../js/core/planetgen.js?v=26.6';
import { canEnterPlanet, dispatchWorkforce } from '../js/ui/colony.js?v=26.6';

// 仅允许本探针使用的账号，避免污染其它逻辑
const ACC_ID = 'probe_acc_planet';
STATE.accounts = [{ id: ACC_ID, name: 'probe', homePlanetCode: 'syl', capturedPlanets: [], discovered: [] }];
STATE.currentAccountId = ACC_ID;
STATE.planets = [];

let pass = 0, fail = 0;
function assert(name, cond, extra) {
  if (cond) { pass++; console.log('  ✓ ' + name); }
  else { fail++; console.log('  ✗ ' + name + (extra ? '  → ' + extra : '')); }
}

console.log('[R5] 进入门槛（canEnterPlanet）');
{
  const home = getPlanetInstance('syl');            // 母星
  home.pop.total = 1000; home.pop.happiness = 0.9;
  assert('母星可进入', canEnterPlanet(home) === true);

  const colony = getPlanetInstance('des');          // 殖民星球（默认 colonial，未同化）
  colony.pop.total = 50; colony.pop.happiness = 0.9;
  assert('非同化非母星不可进入', canEnterPlanet(colony) === false);
  assert('非同化星 modeOf 不是 territory', modeOf(colony).id !== 'territory');

  // 同化：手动置 territory 模式（同化后由 tick 自动发生）
  colony.territoryAssimilated = true;
  setManagement(colony, 'territory');
  assert('同化后 modeOf=territory', modeOf(colony).id === 'territory');
  assert('同化（领土）可进入', canEnterPlanet(colony) === true);

  // 未同化非母星 + 无实例 → 不进入
  assert('无实例不进入', canEnterPlanet(null) === false);
}

console.log('[R7] setManagement 生效');
{
  const c = getPlanetInstance('cal');               // 另一颗殖民星
  c.pop.total = 10; c.pop.happiness = 0.9;
  c.territoryAssimilated = false;

  const r1 = setManagement(c, 'exploitative');
  assert('setManagement(exploitative) 成功', r1.ok === true && c.management === 'exploitative');
  const r2 = setManagement(c, 'cooperative');
  assert('setManagement(cooperative) 成功', r2.ok === true && c.management === 'cooperative');

  // 母星不可设管理模式
  const home = STATE.planets.find((p) => p.isHome);
  const rh = setManagement(home, 'free');
  assert('母星 setManagement 被拒', rh.ok === false);

  // 领土 locked：未同化不可选
  const r3 = setManagement(c, 'territory');
  assert('未同化时 setManagement(territory) 被拒', r3.ok === false);

  // 模式枚举完整（5 种）
  assert('管理模式共 5 种', MANAGEMENT_MODES.length === 5
    && MANAGEMENT_MODES.map((m) => m.id).join(',') === 'free,cooperative,colonial,territory,exploitative');
}

console.log('[R8] 调派人力：母星减、新星加、总数守恒');
{
  const home = STATE.planets.find((p) => p.isHome);
  home.pop.total = 1000; home.pop.happiness = 0.9;
  const homeAvail = getAvailable(home.pop);
  assert('母星可用人力充足（≥50）', homeAvail >= 50, 'homeAvail=' + homeAvail);

  const ni = getPlanetInstance('ves');              // 新星（默认 total=0）
  ni.pop.total = 0; ni.pop.happiness = 0.9;

  const totalBefore = (home.pop.total || 0) + (ni.pop.total || 0);
  const moved = dispatchWorkforce(home, ni, 25);
  const totalAfter = (home.pop.total || 0) + (ni.pop.total || 0);

  assert('调派 25 成功', moved === 25, 'moved=' + moved);
  assert('母星减少 25', home.pop.total === 1000 - 25);
  assert('新星增加 25', ni.pop.total === 25);
  assert('总数守恒', totalBefore === totalAfter, totalBefore + ' vs ' + totalAfter);

  // 调派超过母星可用人力：应被夹取到可用上限，绝不超扣、总数仍守恒
  const availNow = getAvailable(home.pop);
  const huge = 99999;
  const moved2 = dispatchWorkforce(home, ni, huge);
  assert('超量调派被夹取到可用人力上限（不超扣）',
    moved2 <= availNow && moved2 > 0 && moved2 < huge, 'moved2=' + moved2 + ' avail=' + availNow);
  assert('二次调派后总数仍守恒',
    (home.pop.total || 0) + (ni.pop.total || 0) === totalBefore);

  // 调派 0 不改变任何状态
  const before = (home.pop.total || 0) + (ni.pop.total || 0);
  assert('调派 0 不移动', dispatchWorkforce(home, ni, 0) === 0);
  assert('调派 0 后总数不变', (home.pop.total || 0) + (ni.pop.total || 0) === before);
}

console.log('\n结果：通过 ' + pass + ' 项，失败 ' + fail + ' 项');
process.exit(fail === 0 ? 0 : 1);

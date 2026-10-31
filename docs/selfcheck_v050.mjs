// ============================================================================
// selfcheck_v050.mjs —— v0.4.23：存档导出/导入 + 心跳真实时间分片
//
// 覆盖两处**新能力**，它们都属于「不做断言就很容易静默坏掉」的类型：
//   A. 心跳分片：splitBeat() 是纯函数，但它的余量累加与上限截断直接决定
//      后台标签页回来时游戏推进多少秒 —— 算错就是全服玩家进度异常。
//   B. 存档导出/导入：跨设备迁移的核心路径。重点不是「能导出」，
//      而是三条硬约定有没有被守住：
//        ① 导入永远生成新 id（不覆盖同源存档）
//        ② 导入不切换当前存档
//        ③ 导入重置 lastSeen（不补一笔假离线收益）
//
// 原则同前几套：只调产品入口（exportAccount / importAccount / validateSaveFile），
// 不复刻实现。
// ============================================================================
import { pathToFileURL, fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const { CACHE_TAG } = await import(pathToFileURL(join(ROOT, 'js/version.js')).href);

let pass = 0, fail = 0;
const failures = [];
function ok(cond, name, detail) {
  if (cond) { pass++; console.log('  ✓ ' + name + (detail ? '  [' + detail + ']' : '')); }
  else {
    fail++; failures.push(name + (detail ? '  [' + detail + ']' : ''));
    console.log('  ✗ ' + name + (detail ? '  [' + detail + ']' : ''));
  }
}
function section(t) { console.log('\n' + t); }

// Node 环境没有 localStorage：与 selfcheck_v005 同款内存桩
globalThis.localStorage = (() => {
  const m = new Map();
  return {
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => m.set(k, String(v)),
    removeItem: (k) => m.delete(k),
    get length() { return m.size; },
    key: (i) => [...m.keys()][i],
  };
})();

const U = await import(pathToFileURL(join(ROOT, 'js/core/util.js')).href + `?v=${CACHE_TAG}`);
const S = await import(pathToFileURL(join(ROOT, 'js/core/state.js')).href + `?v=${CACHE_TAG}`);
const V = await import(pathToFileURL(join(ROOT, 'js/version.js')).href + `?v=${CACHE_TAG}`);

// ============================================================================
section('A. 心跳分片 splitBeat：真实间隔 → 整秒步进 + 余量');
{
  const b = (e, c, cap) => U.splitBeat(e, c, cap);

  let r = b(1, 0, 300);
  ok(r.steps === 1 && r.carry === 0, '1.000 秒 → 推进 1 秒', `steps=${r.steps} carry=${r.carry}`);

  // 定时器实测常见 1.002 秒：小数不能丢，否则每秒少算 2ms
  r = b(1.002, 0, 300);
  ok(r.steps === 1 && Math.abs(r.carry - 0.002) < 1e-9, '1.002 秒 → 1 秒 + 余量 0.002', `carry=${r.carry}`);

  // 余量必须累加：0.6 + 0.6 = 1.2 → 一步 + 余 0.2
  r = b(0.6, 0, 300);
  ok(r.steps === 0 && Math.abs(r.carry - 0.6) < 1e-9, '0.6 秒 → 不推进，留余量 0.6', `carry=${r.carry}`);
  r = b(0.6, r.carry, 300);
  ok(r.steps === 1 && Math.abs(r.carry - 0.2) < 1e-9, '再 0.6 秒 → 推进 1 秒，余 0.2', `carry=${r.carry}`);

  // 后台节流：Chrome 隐藏页每分钟唤醒一次 —— 这正是本次要修的场景
  r = b(60, 0, 300);
  ok(r.steps === 60, '隐藏标签页被节流到 60 秒一次 → 补算 60 秒（旧实现只走 1 秒）', `steps=${r.steps}`);

  // 合盖三小时：不能一次跑一万拍
  r = b(10800, 0, 300);
  ok(r.steps === 300, '一次空白 3 小时 → 截断到上限 300 秒', `steps=${r.steps}`);
  ok(r.carry === 0, '截断后余量清零（否则下一拍又会被顶到上限）', `carry=${r.carry}`);

  // 异常输入必须安全（心跳不能被一次 NaN 打死）
  ok(b(0, 0, 300).steps === 0, 'elapsed=0 → 不推进');
  ok(b(-5, 0, 300).steps === 0, 'elapsed 为负 → 不推进');
  ok(b(NaN, 0, 300).steps === 0, 'elapsed=NaN → 不推进');
  ok(b(5, NaN, 300).steps === 5, 'carry=NaN 时按 0 处理，仍推进 5 秒');
  ok(b(5, -3, 300).steps === 5, 'carry 为负时按 0 处理，不会倒扣');
  ok(b(5, 0, 0).steps === 5, 'cap<=0 表示不封顶');

  // 累计误差：模拟 3600 次 1.002 秒的真实间隔，总推进量应等于真实秒数（取整后）
  let carry = 0, total = 0;
  for (let i = 0; i < 3600; i++) {
    const x = U.splitBeat(1.002, carry, 300);
    total += x.steps; carry = x.carry;
  }
  ok(total === 3607, '3600 拍 × 1.002 秒 → 共推进 3607 秒（余量不丢）', `total=${total}`);
}

// ============================================================================
section('A2. 积压补算 drainBacklog：逐秒步进 + 预算/步数双重限制');
{
  let clock = 0;
  const now = () => clock;
  const mkStep = (costMs) => {
    const s = { n: 0, step: () => { s.n += 1; clock += (costMs || 1); } };
    return s;
  };

  // 常规：积压 10 秒、预算充足 → 10 步清空
  clock = 0;
  let s = mkStep(1);
  let r = U.drainBacklog(10, { step: s.step, now, budgetMs: 1000, maxSteps: 100 });
  ok(r.done === 10 && r.rest === 0, '积压 10 秒 → 补齐 10 步并清空', `done=${r.done} rest=${r.rest}`);
  ok(s.n === 10, 'step 被逐秒调用 10 次（不是一次 tick(10)）', `n=${s.n}`);

  // 步数上限：一拍最多补 120 步，剩下的留到下一拍
  clock = 0; s = mkStep(1);
  r = U.drainBacklog(300, { step: s.step, now, budgetMs: 100000, maxSteps: 120 });
  ok(r.done === 120 && r.rest === 180, '步数上限：300 秒积压一拍只补 120 秒', `done=${r.done} rest=${r.rest}`);

  // 时间预算：每步 10ms、预算 50ms → 补 5 步就收手
  clock = 0;
  s = mkStep(10);
  r = U.drainBacklog(100, { step: s.step, now, budgetMs: 50, maxSteps: 999 });
  ok(r.done === 5 && r.rest === 95, '预算 50ms / 每步 10ms → 只补 5 步', `done=${r.done} rest=${r.rest}`);

  // 不足 1 秒不推进，原样保留（等下一拍凑整）
  clock = 0; s = mkStep(1);
  r = U.drainBacklog(0.6, { step: s.step, now, budgetMs: 1000, maxSteps: 10 });
  ok(r.done === 0 && Math.abs(r.rest - 0.6) < 1e-9, '积压不足 1 秒 → 不推进，原样保留', `rest=${r.rest}`);
  ok(s.n === 0, '此时一次 tick 也不该跑');

  // 异常输入不能让心跳停摆
  ok(U.drainBacklog(NaN, { step: () => {}, now, budgetMs: 10 }).done === 0, 'backlog=NaN → 0 步');
  ok(U.drainBacklog(-5, { step: () => {}, now, budgetMs: 10 }).done === 0, 'backlog 为负 → 0 步');
  ok(U.drainBacklog(3, {}).done === 3, '未传 step 时按空函数处理，不抛异常');
}

// ============================================================================
section('B. 存档导出：结构、版本标记、星球实例随档走');
S.loadState('offline');
const acc0 = S.newGame('自检员');
const inst0 = S.getPlanetInstance(acc0.homePlanetCode);
// 打一个可辨认的进度标记
{
  const stone = inst0.inventory.find((x) => x.mat === '石头' && x.layer === 'surface')
    || inst0.inventory.find((x) => x.mat === '石头');
  stone.owned = 123456;
  acc0.researchPoints = 4321;
  acc0.stats.lastSeen = Date.now() - 3 * 86400e3;   // 假装三天前离开
  S.saveState();
}
const file0 = S.exportAccount(acc0);
ok(!!file0 && typeof file0 === 'object', 'exportAccount 返回对象');
ok(file0.tag === S.SAVE_FILE_TAG, '导出文件带固定标识', file0.tag);
ok(file0.schema === S.SAVE_FILE_SCHEMA, '导出文件带格式版本', `schema=${file0.schema}`);
ok(file0.gameVersion === V.VERSION, '导出文件记录当前游戏版本', file0.gameVersion);
ok(typeof file0.exportedAt === 'number' && Math.abs(Date.now() - file0.exportedAt) < 5000,
  '导出时间戳为当前时间');
ok(file0.account && file0.account.id === acc0.id, '导出内容包含该账号');
ok(Array.isArray(file0.planets) && file0.planets.length > 0, '导出内容包含星球实例', `n=${file0.planets.length}`);
ok(JSON.stringify(file0).length > 1000, '导出内容可被完整序列化（不是空壳）');
ok(S.validateSaveFile(file0) === null, '自己导出的文件必然通过校验');
{
  const st = file0.planets[0].inventory.find((x) => x.mat === '石头');
  ok(st && st.owned === 123456, '导出保留星球进度（石头 owned=123456）', st && String(st.owned));
}

// ============================================================================
section('C. 非法文件必须被拒绝，且给出中文原因');
{
  const cases = [
    [null, '不是存档对象'],
    [[], '不是存档对象'],
    [{}, '缺少标识'],
    [{ tag: 'other' }, '缺少标识'],
    [{ tag: S.SAVE_FILE_TAG, schema: 0, account: {} }, '格式版本号非法'],
    [{ tag: S.SAVE_FILE_TAG, schema: 999, account: {} }, '更新版本'],
    [{ tag: S.SAVE_FILE_TAG, schema: 1 }, '缺少账号数据'],
    [{ tag: S.SAVE_FILE_TAG, schema: 1, account: { id: 'x' } }, '缺少名称'],
    [{ tag: S.SAVE_FILE_TAG, schema: 1, account: { id: 'x', name: 'a', planetsOwned: 'syl1' } }, '殖民地列表损坏'],
    [{ tag: S.SAVE_FILE_TAG, schema: 1, account: { id: 'x', name: 'a', planetsOwned: [] }, planets: {} }, '星球实例数据损坏'],
  ];
  for (const [input, expect] of cases) {
    const msg = S.validateSaveFile(input);
    ok(typeof msg === 'string' && msg.includes(expect), `拒绝「${expect}」`, msg || '(未拒绝)');
    const r = S.importAccount(input);
    ok(r && r.ok === false && typeof r.reason === 'string', `importAccount 对同一样本返回失败`);
  }
  const before = S.STATE.accounts.length;
  S.importAccount(null);
  ok(S.STATE.accounts.length === before, '非法导入不会往存档列表里塞东西');
}

// ============================================================================
section('D. 导入：三条硬约定 + 星球数据真的能接着玩');
{
  const beforeAccounts = S.STATE.accounts.length;
  const beforeCurrent = S.STATE.currentAccountId;
  const r = S.importAccount(file0);
  ok(r && r.ok === true, '合法文件导入成功', r && r.reason);
  ok(S.STATE.accounts.length === beforeAccounts + 1, '存档列表 +1');
  ok(S.STATE.currentAccountId === beforeCurrent, '约定②：导入不切换当前存档');
  ok(r.id !== acc0.id, '约定①：导入生成新 id，不覆盖同源存档', r.id);
  ok(r.name === '自检员（导入）', '重名自动加后缀', r.name);

  const imported = S.STATE.accounts.find((a) => a.id === r.id);
  ok(!!imported, '导入的账号在列表里可查');
  ok(imported && Math.abs(imported.stats.lastSeen - Date.now()) < 5000,
    '约定③：lastSeen 重置为现在（不补三天假离线收益）',
    imported && new Date(imported.stats.lastSeen).toISOString());

  // 星球实例必须真的挂到新账号名下 —— 切过去读得到才算数
  S.switchAccount(r.id);
  const inst1 = S.getPlanetInstance(imported.homePlanetCode);
  ok(!!inst1, '切到导入档后能取到母星实例');
  const stone = inst1 && inst1.inventory.find((x) => x.mat === '石头');
  ok(stone && stone.owned === 123456, '导入档的星球进度与导出时一致', stone && String(stone.owned));
  ok(imported.researchPoints === 4321, '账号级进度（研究点）随档导入', String(imported.researchPoints));

  // 切回原档，原档数据不能被导入动作污染
  S.switchAccount(acc0.id);
  const inst0b = S.getPlanetInstance(acc0.homePlanetCode);
  const stone0 = inst0b.inventory.find((x) => x.mat === '石头');
  ok(stone0.owned === 123456 && acc0.researchPoints === 4321, '原档在导入后保持原样');

  // 同一个文件再导一次：应当再生成一个新 id，且名字继续去重
  const r2 = S.importAccount(file0);
  ok(r2.ok === true && r2.id !== r.id, '同一文件可重复导入（每次都是新档）');
  ok(r2.name !== imported.name, '第二次导入的名字不与第一次冲突', r2.name);
}

// ============================================================================
section('E. 结构缺失的老存档也能导入（不能让 UI / tick 崩）');
{
  const bare = {
    tag: S.SAVE_FILE_TAG, schema: 1,
    account: { id: 'legacy_1', name: '老档', planetsOwned: ['syl1'] },
  };
  const r = S.importAccount(bare);
  ok(r.ok === true, '最小字段的存档可导入');
  const a = S.STATE.accounts.find((x) => x.id === r.id);
  ok(a && Array.isArray(a.tech) && a.tech.length === 0, '缺失的 tech 补成空数组');
  ok(a && a.resources && typeof a.resources === 'object', '缺失的 resources 补成空对象');
  ok(a && Array.isArray(a.ships) && Array.isArray(a.buildings), '缺失的 ships/buildings 补成空数组');
  ok(a && a.homePlanetCode === 'syl', '缺失的母星编码回落到 syl', a && a.homePlanetCode);
  ok(a && a.stats && typeof a.stats.lastSeen === 'number', '补全 stats.lastSeen');

  // 导入后必须还能正常推进心跳
  let threw = null;
  try { S.tick(1); } catch (e) { threw = e; }
  ok(!threw, '导入畸形档后 tick(1) 仍可执行', threw && threw.message);
}

// ============================================================================
console.log('\n========================');
console.log(`通过 ${pass} 项，失败 ${fail} 项`);
if (fail) {
  console.log('失败项：');
  failures.forEach((f) => console.log('  - ' + f));
  process.exit(1);
}
console.log('v0.4.23 回归自检通过');

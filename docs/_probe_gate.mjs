// v0.2.6 rev4 探针：在线池开局模式门禁（非开发者只能初登星球）
import { STATE, createAccount, getPlanetInstance } from '../js/core/state.js?v=53.4';

let pass = 0, fail = 0;
function ok(cond, msg) { if (cond) { pass++; console.log('  ✓ ' + msg); } else { fail++; console.log('  ✗ ' + msg); } }

const store = {};
globalThis.localStorage = {
  getItem: (k) => (k in store ? store[k] : null),
  setItem: (k, v) => { store[k] = String(v); },
  removeItem: (k) => { delete store[k]; },
};
STATE.adapter = { get: () => null, set: () => {}, del: () => {} };

// 1) 在线 + 非开发者 → 1936 被强制降级为初登星球
STATE.mode = 'online';
store.astrix_dev = '0';
const a1 = createAccount('在线非开发者', 'hoi1936', { countryId: 'ger' });
ok(!a1.scenario && a1.nation == null, '在线 + 非开发者：1936 剧本被拒绝，降级为初登星球');
const i1 = getPlanetInstance(a1.homePlanetCode);
ok(i1.nameCn === '希尔瓦', '母星仍是默认母星（' + i1.nameCn + '）');
ok(!a1.hoiWorkforce, '未铺设 1936 工业（hoiWorkforce 为空）');

// 2) 在线 + 非开发者 → 漫溯深空同样降级
const a2 = createAccount('在线非开发者2', 'deep');
ok(!(a2.tech || []).includes('t_e3'), '在线 + 非开发者：漫溯深空也被降级');

// 3) 在线 + 开发者 → 1936 正常建立
store.astrix_dev = '1';
const a3 = createAccount('在线开发者', 'hoi1936', { countryId: 'ger' });
ok(a3.scenario === 'hoi1936' && a3.nation === 'ger', '在线 + 开发者：1936 剧本正常建立（' + a3.nation + '）');
ok(getPlanetInstance(a3.homePlanetCode).nameCn.indexOf('柏林') === 0, '本土星球 = 柏林（本土）');
ok(a3.hoiWorkforce > 19000, '工业与工人已铺设（' + a3.hoiWorkforce + ' 人）');

// 4) 离线 → 不受门禁影响（非开发者也可）
STATE.mode = 'offline';
store.astrix_dev = '0';
const a4 = createAccount('离线玩家', 'hoi1936', { countryId: 'sov' });
ok(a4.scenario === 'hoi1936' && a4.nation === 'sov', '离线模式：1936 剧本照常可用（无门禁）');
const a5 = createAccount('离线玩家2', 'deep');
ok((a5.tech || []).includes('t_e3'), '离线模式：漫溯深空照常可用');

console.log('');
console.log('通过 ' + pass + ' 项，失败 ' + fail + ' 项');
process.exit(fail ? 1 : 0);

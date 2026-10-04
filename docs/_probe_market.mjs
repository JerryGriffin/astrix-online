// v0.2.12 商店星探针：价格持续波动 / 共享价格应用与夹取 / 跳过噪声开关
import { tickShop, shopStateOf, applySharedPrice, priceSnapshotOf } from '../js/core/shop.js?v=46.11';

let pass = 0, fail = 0;
function ok(cond, msg) { if (cond) { pass++; console.log('  ✓ ' + msg); } else { fail++; console.log('  ✗ ' + msg); } }

const acc = { id: 'a1', ascoin: 100000, shopWarehouse: {}, shopState: {} };
// 初始化价格状态
const st = shopStateOf(acc);
const mat = '钢';
const base0 = st[mat].base;
const p0 = st[mat].price;

// 1) 离线：tickShop 持续波动（跑 60 秒模拟）
for (let i = 0; i < 60; i++) tickShop(acc, 1);
const p1 = st[mat].price;
ok(Math.abs(p1 - p0) > 1e-9, '离线价格持续波动（' + p0.toFixed(2) + ' → ' + p1.toFixed(2) + '）');

// 2) skipNoise：跳过波动（在线共享市场接管）
const p2a = st[mat].price;
for (let i = 0; i < 30; i++) tickShop(acc, 1, { skipNoise: true });
ok(st[mat].price === p2a, 'skipNoise=true 时价格不再本地波动（在线由共享行情接管）');

// 3) applySharedPrice：应用共享价 + 夹取到 base×[0.2,4]
applySharedPrice(acc, mat, base0 * 100, base0);
ok(Math.abs(st[mat].price - base0 * 4) < 1e-6, '过高的共享价被夹到 base×4');
applySharedPrice(acc, mat, 0.0001, base0);
ok(Math.abs(st[mat].price - base0 * 0.2) < 1e-6, '过低的共享价被夹到 base×0.2');

// 4) 金恒价不受影响
ok(priceSnapshotOf(acc)['金'] > 0, '价格快照包含金且为正');

console.log('');
console.log('通过 ' + pass + ' 项，失败 ' + fail + ' 项');
process.exit(fail ? 1 : 0);

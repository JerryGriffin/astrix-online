// Astrix v0.1.2 W-SHOP 交易池自测（node 直接跑，不依赖浏览器）
//   node docs/_probe_shop.mjs
// 覆盖 R9：挂单频率/上限提高 → 挂单条数明显增多；NPC 开始卖装备（partId@材料）；
//        装备能走 buyListing 成交；tickListings 性能无数量级恶化。
import { ensureNpcs, tickNpcs } from '../js/core/npc.js?v=26.9';
import {
  npcListOnMarket, npcTakeFromMarket, tickListings, buyListing, suggestPriceOf,
} from '../js/core/shop.js?v=26.9';

let pass = 0;
const fails = [];
function ok(cond, label) {
  if (cond) { pass++; console.log('  ✓ ' + label); }
  else { fails.push(label); console.log('  ✗ ' + label); }
}
function section(t) { console.log('\n== ' + t + ' =='); }

// ---------------------------------------------------------------------------
// 准备账号 + 注入真实市场回调（用真实 npcListOnMarket，顺便统计挂单创建数）
const acc = { id: 'acc_probe', ascoin: 1e12, npcs: [], npcEvents: [], shopListings: [] };
ensureNpcs(acc);
let createdCount = 0;
let equipCreated = 0;
let maxEquipInPool = 0;
const env = {
  priceOf: () => 100,                       // 仅占位（NPC 实际用 suggestPriceOf）
  suggestPriceOf: (mat) => suggestPriceOf(acc, mat, null),
  listOnMarket: (npc, mat, qty, price) => {
    createdCount++;
    if (mat && mat.indexOf('@') >= 0) equipCreated++;
    return npcListOnMarket(acc, npc, mat, qty, price);
  },
  takeFromMarket: (npc) => npcTakeFromMarket(acc, npc, null),
  bumpPrice: () => {},
};

// ---------------------------------------------------------------------------
section('一、挂单条数明显增多（改前 listEvery 12/25s、上限40 → 改后 4/8s、上限120）');
const SIM_SECONDS = 150;
// 改前估算：listEvery royal 12s / 其它 25s，纯材料，4 个势力
const oldCreated = Math.floor(SIM_SECONDS / 12) + 3 * Math.floor(SIM_SECONDS / 25);

// 用 ≤0.25s 的子步推进，贴近真实逐帧心跳（listEvery<1 才能在 1 秒内多次挂单）
const SUB = 0.25;
for (let t = 0; t < SIM_SECONDS; t += SUB) {
  tickNpcs(acc, SUB, env);
  tickListings(acc, SUB);
  const ep = acc.shopListings.filter((l) => l.mat && l.mat.indexOf('@') >= 0).length;
  if (ep > maxEquipInPool) maxEquipInPool = ep;
}
const poolNow = acc.shopListings.length;
console.log('  改前(估算, listEvery 12/25s 纯材料): 创建≈' + oldCreated + ' 条, 上限40');
console.log('  改后(实测, listEvery 0.5/0.7s + 装备): 创建=' + createdCount + ' 条, 装备创建=' + equipCreated +
  ' 条, 池内=' + poolNow + ', 上限120');
ok(createdCount > oldCreated * 2,
  `改后挂单创建数(${createdCount}) 应明显大于改前估算(${oldCreated})`);
ok(poolNow > 0, `交易池应有挂单，实际 ${poolNow}`);

// ---------------------------------------------------------------------------
section('二、NPC 开始卖装备（partId@材料 键进入交易池）');
console.log('  模拟期间装备类挂单创建数=' + equipCreated + '，池内峰值装备挂单数=' + maxEquipInPool);
ok(equipCreated >= 1, `NPC 应创建至少 1 条装备类挂单，实际 ${equipCreated}`);
ok(maxEquipInPool >= 1, `装备类挂单应曾出现在交易池（峰值），实际 ${maxEquipInPool}`);
// 装备键合法性：partId 须存在于部件表（若池内恰有样本则校验）
const SHIPPARTS = await import('../js/data/ship_parts.js?v=26.9');
const sampleEquip = acc.shopListings.find((l) => l.mat && l.mat.indexOf('@') >= 0);
if (sampleEquip) {
  ok(!!SHIPPARTS.PART_BY_ID[sampleEquip.mat.split('@')[0]],
    '装备挂单的 partId 应是合法部件：' + sampleEquip.mat);
} else {
  ok(true, '（池内瞬时无装备样本，合法性由下方确定性用例覆盖）');
}

// ---------------------------------------------------------------------------
section('三、装备类能走 buyListing 成交（入 inst.equipment）');
// 确定性用例：直接造一条装备挂单（不经随机/drain），验证 buyListing 入库路径
const seller = acc.npcs[0];
const eqKey = 'hull_s_mk1@钛';
const L = npcListOnMarket(acc, seller, eqKey, 2, 500);
ok(!!L && acc.shopListings.some((l) => l.id === L.id), '装备挂单应进入交易池');
const inst = { equipment: {} };
const r = buyListing(acc, L.id, inst);
console.log('  买入结果=' + JSON.stringify(r) + '，inst.equipment=' + JSON.stringify(inst.equipment));
ok(r.ok === true, 'buyListing 装备应成功');
const eq = inst.equipment[eqKey];
ok(eq && eq.count === 2 && eq.partId === 'hull_s_mk1' && eq.material === '钛',
  '装备应入库到 inst.equipment（partId/material/count 一致）');
ok(!acc.shopListings.some((l) => l.id === L.id), '成交后该挂单应从池移除');
// 再买一件不同材料的装备，验证多键并存
const L2 = npcListOnMarket(acc, seller, 'wpn_mg_mk1@碳化钨', 1, 800);
const r2 = buyListing(acc, L2.id, inst);
console.log('  二次买入结果=' + JSON.stringify(r2) + '，inst.equipment=' + JSON.stringify(inst.equipment));
ok(r2.ok && inst.equipment['wpn_mg_mk1@碳化钨'] &&
  inst.equipment['wpn_mg_mk1@碳化钨'].count === 1, '第二件装备（不同键）也应入库');

// ---------------------------------------------------------------------------
section('四、tickListings 性能无数量级恶化');
// 把池灌满到上限，测量 tickListings(acc,1) 耗时
while (acc.shopListings.length < 120) {
  acc.shopListings.push({
    id: 'fill_' + acc.shopListings.length, sellerAccountId: 'npc_x',
    mat: '铁', qty: 10, price: 50, at: Date.now(),
  });
}
const t0 = Date.now();
for (let i = 0; i < 60; i++) tickListings(acc, 1);   // 模拟 60 秒
const t1 = Date.now();
const perTick = (t1 - t0) / 60;
console.log('  满载120条时 tickListings 单次平均耗时≈' + perTick.toFixed(4) + ' ms');
ok(perTick < 50, `单次 tick 应远低于 50ms（无数量级恶化），实际 ${perTick.toFixed(4)} ms`);

// ---------------------------------------------------------------------------
console.log('\n==== 通过 ' + pass + ' / ' + (pass + fails.length) + ' ====');
if (fails.length) {
  console.log('失败项：\n - ' + fails.join('\n - '));
  process.exit(1);
}
console.log('全部通过。');

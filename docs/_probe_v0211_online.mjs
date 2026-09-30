// v0.2.10 在线专项探针：NPC 拍卖挂单 —— 生成 / 冷却 / 玩家中标付款 / 到期移除
import { ensureAuctions, tickNpcAuctionSpawner, tickAuctions, placeBid, activeAuctions } from '../js/core/auction.js?v=29.1';
import { getPlanetInstance } from '../js/core/state.js?v=29.1';
import { ownedOf } from '../js/core/state.js?v=29.1';

let pass = 0, fail = 0;
function ok(cond, msg) {
  if (cond) { pass++; console.log('  ✓ ' + msg); }
  else { fail++; console.log('  ✗ ' + msg); }
}

const acc = { id: 'acc_t', name: '测试官', tech: ['t_m1'], ascoin: 1000000, homePlanetCode: 'syl' };

// 1. 首次生成：池空 → 连发 2 单 NPC 挂单
ensureAuctions(acc);
tickNpcAuctionSpawner(acc);
let act = activeAuctions(acc);
ok(act.length === 2, `首次生成 2 单 NPC 挂单（实际 ${act.length}）`);
ok(act.every((a) => String(a.sellerId).startsWith('npc_') && a.npcCeiling === 0), '挂单均为 NPC 卖家（不自抬价）');
ok(act.every((a) => a.type === 'resource' && a.qty >= 10 && a.qty < 200), '挂单为资源、数量 10~199');

// 2. 冷却：立即再调不应新增
tickNpcAuctionSpawner(acc);
ok(activeAuctions(acc).length === 2, '冷却期内不重复生成');

// 3. 玩家中标：出价 → 强制到期 → 结算扣款 + 货入星球
const target = act[0];
const bid = target.minBid + 50;
const before = acc.ascoin;
const bidR = placeBid(acc, target.id, bid, 'acc_t', '测试官');
ok(bidR.ok, `玩家出价 ${bid} 成功`);
const inst = getPlanetInstance(acc.homePlanetCode);
const matName = target.key;
const ownedBefore = ownedOf(inst, matName);
for (const a of acc.shopAuctions) if (a.id === target.id) a.endsAt = Date.now() - 10;
tickAuctions(acc, 1, {});
ok(acc.ascoin === before - bid, `结算扣款 ${bid}（${before} → ${acc.ascoin}）`);
ok(ownedOf(inst, matName) === ownedBefore + target.qty, `货已入星球 ${matName} ×${target.qty}`);
ok(!acc.shopAuctions.some((x) => x.id === target.id), '已结算拍卖从活跃列表移除');
ok(acc.shopAuctionLog.some((l) => l.type === 'bought_npc' && l.price === bid), '日志记录 NPC 购入');

// 4. 流拍：无出价的 NPC 单到期直接移除（不产生任何进账）
const rest = activeAuctions(acc);
if (rest.length) {
  const a2 = rest[0];
  const coinBefore = acc.ascoin;
  for (const x of acc.shopAuctions) if (x.id === a2.id) x.endsAt = Date.now() - 10;
  tickAuctions(acc, 1, {});
  ok(acc.ascoin === coinBefore, '流拍 NPC 单不产生进账');
  ok(!acc.shopAuctions.some((x) => x.id === a2.id), '流拍单已移除');
}

// 5. 余额不足不能出价（手动构造高价单，绕过生成器冷却）
const acc2 = { id: 'acc2', name: '穷', tech: [], ascoin: 5, homePlanetCode: 'syl' };
ensureAuctions(acc2);
acc2.shopAuctions.push({
  id: 'auc_rich', sellerId: 'npc_测试', sellerName: '测试势力', type: 'resource',
  key: '钢', label: '钢', qty: 10, planetCode: 'syl', minBid: 999999,
  topBid: 0, topBidder: null, topBidderName: null,
  endsAt: Date.now() + 60000, durationSec: 60, createdAt: Date.now(),
  status: 'active', asset: null, npcCeiling: 0,
});
const r2 = placeBid(acc2, 'auc_rich', 999999, 'acc2', '穷');
ok(!r2.ok && /Ascoin 不足/.test(r2.reason), `余额不足时出价被拒（${r2.reason || '通过'}）`);

console.log(`\n通过 ${pass} 项，失败 ${fail} 项`);
process.exit(fail ? 1 : 0);

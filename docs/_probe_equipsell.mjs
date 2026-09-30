// docs/_probe_equipsell.mjs  —— Astrix v0.1.4 · W-EQUIPSELL 装备售卖自测
// 验证：玩家装备栏里的部件（partId@材料 键）能进商店下拉、能卖出 / 挂单。
// 所有相对导入一律带 ?v=13.2（与冻结契约一致）。
// Node 无 localStorage → 必须先 S.setAdapter 注入内存 Map，否则持久化链空转。
// 运行：node docs/_probe_equipsell.mjs
import * as S from '../js/core/state.js?v=26.6';
import { equipmentList } from '../js/core/shipyard.js?v=26.6';
import {
  sell, listForSale, deliverOrder, priceOf, suggestPriceOf,
} from '../js/core/shop.js?v=26.6';

// ---------------------------------------------------------------------------
// Node 内存适配器（无 localStorage，避免持久化链空转）
// ---------------------------------------------------------------------------
const mem = new Map();
S.setAdapter({
  get: (k) => (mem.has(k) ? mem.get(k) : null),
  set: (k, v) => { mem.set(k, v); },
  del: (k) => { mem.delete(k); },
});

let pass = 0, fail = 0;
function check(name, cond, detail) {
  if (cond) { pass++; console.log('  ✓ PASS ' + name + (detail ? '  ' + detail : '')); }
  else { fail++; console.log('  ✗ FAIL ' + name + (detail ? '  ' + detail : '')); }
}

// ---------------------------------------------------------------------------
// 构造账号 + 星球实例；装备直接塞 inst.equipment
// ---------------------------------------------------------------------------
const account = { id: 'acc_eq', ascoin: 1e9, shopState: {}, shopOrders: [], shopListings: [] };
const inst = {
  code: 'syl', isHome: true, buildings: { dock: 1 }, inventory: [],
  equipment: {
    'fac_crew_mk1@铁': { partId: 'fac_crew_mk1', material: '铁', count: 2 },
    'hull_s_mk1@钛': { partId: 'hull_s_mk1', material: '钛', count: 5 },
  },
};

console.log('\n===== W-EQUIPSELL 装备售卖自测 =====');

// 1. equipmentList 能列出两件装备，key 即 partId@材料
const list = equipmentList(inst);
const keys = list.map((e) => e.key).sort();
console.log('  equipmentList keys = ' + JSON.stringify(keys));
check('equipmentList 列出两件装备', list.length === 2, 'count=' + list.length);
check('装备键格式 = partId@材料', keys.join(',') === 'fac_crew_mk1@铁,hull_s_mk1@钛', 'keys=' + keys.join(','));
const crew = list.find((e) => e.key === 'fac_crew_mk1@铁');
check('装备项含 part（中文名）', !!(crew && crew.part && crew.part.nameCn), 'nameCn=' + (crew && crew.part && crew.part.nameCn));
check('持有数 count 正确', !!(crew && crew.count === 2), 'count=' + (crew && crew.count));

// 2. sell(acc, key, 1) 返回 ok（下单；实际扣库在 deliverOrder）
const ascoinBefore = account.ascoin;
const rSell = sell(account, 'fac_crew_mk1@铁', 1);
console.log('  sell 结果 = ' + JSON.stringify(rSell));
check('sell 装备键返回 ok', rSell.ok === true, 'ok=' + rSell.ok + (rSell.reason ? ' reason=' + rSell.reason : ''));
const ord = (account.shopOrders || []).find((o) => o.mat === 'fac_crew_mk1@铁');
check('卖出下单写订单(side=sell, mat=键)', !!(ord && ord.side === 'sell' && ord.qty === 1), 'order=' + JSON.stringify(ord));

// 2b. deliverOrder 真正从星球扣装备并给 ascoin（回合制闭环）
if (ord) {
  const rDel = deliverOrder(account, ord.id, inst);
  console.log('  deliverOrder 结果 = ' + JSON.stringify(rDel));
  check('deliverOrder 装备成功', rDel.ok === true, 'ok=' + rDel.ok + (rDel.reason ? ' reason=' + rDel.reason : ''));
  check('装备已扣减(count 2→1)', inst.equipment['fac_crew_mk1@铁'].count === 1, 'count=' + inst.equipment['fac_crew_mk1@铁'].count);
  const gotCost = rSell.order ? rSell.order.cost : rSell.cost;
  check('卖出获得 ascoin', account.ascoin === ascoinBefore + gotCost, 'ascoin=' + account.ascoin);
}

// 3. listForSale(acc, key, 1, 100) 返回 ok
const rList = listForSale(account, 'hull_s_mk1@钛', 1, 100);
console.log('  listForSale 结果 = ' + JSON.stringify(rList));
check('listForSale 装备键返回 ok', rList.ok === true, 'ok=' + rList.ok + (rList.reason ? ' reason=' + rList.reason : ''));
check('挂单写入交易池(mat=键)', !!account.shopListings.find((l) => l.mat === 'hull_s_mk1@钛'), 'listings=' + JSON.stringify(account.shopListings));

// 4. 价格 / 建议价对装备键可用（renderDetail 依赖 priceOf / suggestPriceOf）
const p = priceOf(account, 'fac_crew_mk1@铁');
const sugg = suggestPriceOf(account, 'fac_crew_mk1@铁', inst);
console.log('  priceOf(装备键)=' + p + '  suggestPriceOf(装备键)=' + sugg);
check('priceOf 对装备键返回估值(>0)', Number(p) > 0, 'price=' + p);
check('suggestPriceOf 对装备键返回建议价(>0)', Number(sugg) > 0, 'sugg=' + sugg);

console.log('\n===== 探针汇总 =====');
console.log('  通过 ' + pass + ' / 失败 ' + fail);
process.exit(fail ? 1 : 0);

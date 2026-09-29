// 自动化探针：验证星际云服务与在线星系核心逻辑（Astrix v0.2.0）
// 用法：node docs/_probe_galaxy.mjs

import assert from 'assert';
import {
  STATE, createAccount, currentAccount, getPlanetInstance, setAdapter, ownedOf
} from '../js/core/state.js?v=21.0';
import { ensureEntry } from '../js/core/production.js?v=21.0';
import {
  ensureCloudProfile, bindEmail, getShieldStatus, buildLocalSnapshot,
  fetchGalaxyRegistry, sendGalaxyTrade, sendGalaxyRaid, addMaterial,
  getInbox, markMessageRead, unreadCount, SHIELD_DURATION_MS
} from '../js/core/cloud.js?v=21.0';
import { createFleet, addShipToFleet } from '../js/core/fleet.js?v=21.0';

// 内存存储适配器（Node 环境无浏览器 localStorage）
const mem = new Map();
globalThis.localStorage = {
  getItem: (k) => (mem.has(k) ? mem.get(k) : null),
  setItem: (k, v) => mem.set(k, String(v)),
  removeItem: (k) => mem.delete(k),
  clear: () => mem.clear(),
};
setAdapter({
  get: (k) => mem.get(k) || null,
  set: (k, v) => mem.set(k, String(v)),
  del: (k) => mem.delete(k),
});

console.log('=== 开始星际云服务自动化探针测试 ===');

// 1. 初始化账号与母星实例
createAccount('星际元帅');
const acc = currentAccount();
assert(acc, '必须成功创建账号');
const homeCode = acc.homePlanetCode || 'syl';
const inst = getPlanetInstance(homeCode) || getPlanetInstance(homeCode.replace(/\d+$/, ''));
assert(inst, '必须获取到母星实例');

// 2. 指挥官云档案测试 (Q1-1C)
const profile = ensureCloudProfile(acc);
assert(profile.commanderId.startsWith('CMD-'), '指挥官编号格式必须正确');
assert(profile.callsign.includes('星际元帅'), '默认呼号应包含玩家名称');
assert(profile.email === null, '初始邮箱应为 null');

const bindRes = bindEmail(acc, 'commander@deepspace.org');
assert(bindRes.ok, '绑定有效邮箱必须成功');
assert.strictEqual(acc.cloudProfile.email, 'commander@deepspace.org', '邮箱状态应持久化');

const badEmail = bindEmail(acc, 'not-an-email');
assert(!badEmail.ok, '无效邮箱必须被拦截');

// 3. 初始保护盾状态
const shield = getShieldStatus(acc);
assert(shield.active, '新指挥官应享有初始免战护盾');

// 4. 快照打包与星系注册表 (Q3-A)
addMaterial(inst, '铁', 1000);
addMaterial(inst, '甲烷', 5000);
addMaterial(inst, '金', 10);
const snapshot = buildLocalSnapshot(acc);
assert(snapshot.commanderId === profile.commanderId, '快照指挥官 ID 必须匹配');
assert(snapshot.defensePower >= 200, '防御评估分必须有效');

const systems = fetchGalaxyRegistry(acc);
assert(systems.length >= 8, '星系注册表应至少包含母星和 7 个 NPC 星球');
const filtered = fetchGalaxyRegistry(acc, '织女');
assert(filtered.length >= 1 && filtered[0].planetNameCn.includes('织女'), '按关键字检索星系必须生效');

// 5. 星际贸易交割测试
const vega = systems.find((s) => s.planetCode === 'vega4');
assert(vega, '必须找到织女四贸易星');
const preSteel = ownedOf(inst, '钢') || 0;

// 5a. 用纯金结算
const tradeRes = sendGalaxyTrade(acc, null, vega, '钢', 20);
assert(tradeRes.ok, '星际贸易应当成功执行: ' + (tradeRes.reason || ''));
assert.strictEqual(ownedOf(inst, '钢'), preSteel + 20, '采购的物资必须直接入库母星物品栏');

// 5b. 直接用 acc.ascoin 结算
acc.ascoin = 10000;
const preAscoin = acc.ascoin;
const tradeAscoinRes = sendGalaxyTrade(acc, null, vega, '铝', 10);
assert(tradeAscoinRes.ok, '使用 Ascoin 支付贸易应成功');
assert(acc.ascoin < preAscoin, '应扣除相应 Ascoin 货款');
assert.strictEqual(tradeAscoinRes.totalCost, 650, '10 份铝 @ 65 = 650 Ascoin');
assert.strictEqual(acc.ascoin, preAscoin - 650, '剩余 Ascoin 应精确扣除 650');

// 6. 远征突击与战利品掠夺 (Q2-A)
const fRes = createFleet(acc, '突击第一舰队');
assert(fRes.ok, '创建编队成功');
const fleet = fRes.fleet;
// 注入两艘战舰
acc.ships = [
  { id: 'ship_1', nameCn: '战列舰-A', dryMass: 800, thrust: 1200, planetCode: 'syl1' },
  { id: 'ship_2', nameCn: '巡洋舰-B', dryMass: 500, thrust: 900, planetCode: 'syl1' },
];
addShipToFleet(acc, fleet.id, 'ship_1');
addShipToFleet(acc, fleet.id, 'ship_2');

// 寻找防御薄弱的拾荒星天狼B进行进攻
const sirius = systems.find((s) => s.planetCode === 'sirius_b');
assert(sirius, '必须找到天狼B星');
const raidRes = sendGalaxyRaid(acc, fleet.id, sirius);
assert(raidRes.ok, '远征指令应当顺利执行结算: ' + (raidRes.reason || ''));

if (raidRes.win) {
  assert(sirius.shieldUntil > Date.now(), '胜利后目标必须被赋予 12 小时免战保护盾');
  // 再次进攻应被保护盾拦截
  const blockedRaid = sendGalaxyRaid(acc, fleet.id, sirius);
  assert(!blockedRaid.ok && blockedRaid.reason.includes('免战护盾'), '免战护盾期内必须阻断进攻');
}

// 7. 信箱系统检查
const msgs = getInbox(acc);
assert(msgs.length >= 2, '信箱应至少包含一条贸易回执与一条战报');
assert(unreadCount(acc) > 0, '应存在未读消息');
markMessageRead(acc, msgs[0].id);

console.log('✅ 星际云服务自动化探针测试全部通过！');

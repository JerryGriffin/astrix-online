// docs/selfcheck_online_state.mjs
// 全服状态持久化自检（本地文件后端）
// ----------------------------------------------------------------------------
// 为什么要有这个探针：HuggingFace 免费层的容器磁盘是临时的，进程一旦重启
// （休眠唤醒 / 每次 git push 触发的重建），ONLINE_STORE 就全没了。server.mjs 为此
// 增加了快照持久化层。本探针用「起服务 → 造玩家数据 → 等落盘 → 重启 → 断言恢复」
// 这条真实路径验证它，而不是只测序列化函数。
//
// 注意（Windows 限制）：Windows 上 SIGTERM 是无条件终止、不会执行 Node 的处理器，
// 因此「停机刷盘」在 Windows 上无法验证。探针改为等待**节流保存**落盘 —— 这本来
// 就是主路径（SIGTERM 刷盘只是 Linux/HF 上的额外保险）。
//
// 覆盖：
//   ① 全服注册表（真实玩家）跨重启恢复，NPC 仍由代码预置
//   ② 公频历史跨重启恢复，两条种子欢迎语始终保留
//   ③ 玩家集市挂单跨重启恢复
//   ④ 已售出的 NPC 常驻货架不复活（consumedSeedListings）
//   ⑤ 攻防信箱（防御损失）与贸易结算回执跨重启恢复
//   ⑥ /api/online/status 如实报告后端、恢复结果与计数
//
// 用法：node docs/selfcheck_online_state.mjs
// 说明：不触碰真实的 data/online-state.json（用 ASTRIX_STATE_FILE 指向临时文件），
//       也不占用 8080（用 8137）。

import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = Number(process.env.PROBE_PORT || 8137);
const BASE = `http://127.0.0.1:${PORT}`;
const STATE_FILE = path.join(os.tmpdir(), `astrix-state-probe-${process.pid}.json`);

const errors = [];
function expect(cond, label, extra) {
  if (cond) {
    console.log('  ok  ' + label);
  } else {
    const msg = label + (extra === undefined ? '' : ' → ' + JSON.stringify(extra));
    errors.push(msg);
    console.log('  x   ' + msg);
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function waitFor(fn, timeoutMs) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    try { if (fn()) return true; } catch (e) { /* 继续等 */ }
    await sleep(150);
  }
  return false;
}

function startServer() {
  const proc = spawn(process.execPath, [path.join(ROOT, 'server.mjs')], {
    env: { ...process.env, PORT: String(PORT), ASTRIX_STATE_FILE: STATE_FILE },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let log = '';
  proc.stdout.on('data', (d) => { log += d.toString(); });
  proc.stderr.on('data', (d) => { log += d.toString(); });
  return { proc, log: () => log };
}

async function waitReady(timeoutMs = 10000) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    try {
      const r = await fetch(BASE + '/');
      await r.arrayBuffer();
      if (r.ok) return true;
    } catch (e) { /* 还没起来 */ }
    await sleep(120);
  }
  return false;
}

function stopServer(proc, timeoutMs = 10000) {
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      try { proc.kill('SIGKILL'); } catch (e) {}
      resolve('forced');
    }, timeoutMs);
    proc.once('exit', () => { clearTimeout(timer); resolve('exited'); });
    try { proc.kill('SIGTERM'); } catch (e) { clearTimeout(timer); resolve('failed'); }
  });
}

const post = async (p, body) => {
  const r = await fetch(BASE + p, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return { status: r.status, body: await r.json() };
};
const get = async (p) => {
  const r = await fetch(BASE + p);
  return { status: r.status, body: await r.json() };
};

let listingId = '';
let chatId = '';

async function phase1(instance) {
  console.log('\n-- 阶段一：产生全服数据，然后优雅停机落盘 --');
  expect(await waitReady(), '服务已在 ' + PORT + ' 端口就绪');

  const st = await get('/api/online/status');
  expect(st.status === 200, '/api/online/status 可访问', st.status);
  expect(st.body.state && st.body.state.backend === 'file', '状态后端为 file（ASTRIX_STATE_FILE 生效）', st.body.state);
  expect(st.body.state && st.body.state.restored === false, '首次启动应无历史快照可恢复', st.body.state && st.body.state.restored);

  const hbA = await post('/api/online/heartbeat', {
    commanderId: 'probe-A', callsign: '探针甲[自检]', fleetPower: 320, defensePower: 180,
    homePlanet: '希尔瓦', planetCode: 'syl', goods: [{ mat: '铁', nameCn: '纯铁', priceAscoin: 35, stock: 900 }],
  });
  const hbB = await post('/api/online/heartbeat', {
    commanderId: 'probe-B', callsign: '探针乙[自检]', fleetPower: 640, defensePower: 260,
    homePlanet: '盖亚', planetCode: 'gaia', goods: [],
  });
  expect(hbA.body.ok && hbB.body.ok, '两个探针指挥官心跳注册成功', [hbA.body, hbB.body]);

  const chat = await post('/api/online/chat', {
    commanderId: 'probe-A', callsign: '探针甲[自检]', text: '持久化自检消息：重启后我应当还在',
  });
  expect(chat.body.ok, '公频消息发送成功', chat.body);
  chatId = chat.body.message && chat.body.message.id;

  const list = await post('/api/online/market/list', {
    sellerId: 'probe-A', sellerCallsign: '探针甲[自检]', mat: '铁', nameCn: '铁锭', qty: 50, priceAscoin: 30,
  });
  expect(list.body.ok, '玩家集市挂单成功', list.body);
  listingId = list.body.listing && list.body.listing.id;

  const raid = await post('/api/online/raid', {
    attackerId: 'probe-A', attackerCallsign: '探针甲[自检]', targetId: 'probe-B', fleetPower: 320,
  });
  expect(raid.body.ok, '对 probe-B 发起攻防裁决成功', raid.body);

  // 买掉一个 NPC 常驻货架，用于验证「已售出不再复活」
  const buy = await post('/api/online/market/buy', {
    buyerId: 'probe-A', buyerCallsign: '探针甲[自检]', listingId: 'trade_init_1',
  });
  expect(buy.body.ok, '买下 NPC 常驻货架 trade_init_1', buy.body);

  const st2 = await get('/api/online/status');
  expect(st2.body.counts && st2.body.counts.players === 2, '状态接口报告 2 名真实玩家', st2.body.counts);
  expect(st2.body.counts && st2.body.counts.inboxOwners >= 2, '状态接口报告至少 2 个信箱所有者', st2.body.counts);

  // 关键：等「节流保存」把快照写盘。Windows 上 SIGTERM 是无条件终止、不会执行处理器，
  // 所以停机刷盘这条路在 Windows 上不可验证；而周期保存本来才是主路径，探针就按它验证。
  const wrote = await waitFor(() => fs.existsSync(STATE_FILE), 15000);
  expect(wrote, '节流保存已把快照写入磁盘', { log: instance.log().slice(-600) });

  const st3 = await get('/api/online/status');
  expect(st3.body.state && st3.body.state.lastSavedAt > 0, '状态接口记录了上次保存时间', st3.body.state);
  expect(st3.body.state && st3.body.state.dirty === false, '保存完成后脏标记已清除', st3.body.state);

  const how = await stopServer(instance.proc);
  expect(how === 'exited' || how === 'forced', '进程已停止', how);

  const snap = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
  expect(snap.version === 1, '快照版本号为 1', snap.version);
  expect(Array.isArray(snap.commanders) && snap.commanders.length === 2, '快照含 2 名真实玩家指挥官', snap.commanders && snap.commanders.length);
  expect(snap.commanders.every((c) => !c.isNpc), '快照不写入 NPC（NPC 由代码预置）');
  expect(Array.isArray(snap.consumedSeedListings) && snap.consumedSeedListings.includes('trade_init_1'), '快照记录了已售出的种子货架', snap.consumedSeedListings);
  expect(!snap.chatMessages.some((m) => String(m.id).startsWith('m_init')), '快照不重复写入种子欢迎语');
  expect(snap.inbox && Object.keys(snap.inbox).length >= 2, '快照含攻防与结算信箱', snap.inbox && Object.keys(snap.inbox).length);
}

async function phase2(instance) {
  console.log('\n-- 阶段二：重启同源服务，断言全服状态已恢复 --');
  expect(await waitReady(), '服务重启后就绪');

  const st = await get('/api/online/status');
  expect(st.body.state && st.body.state.restored === true, '状态接口报告「已从快照恢复」', st.body.state);
  expect(st.body.state && st.body.state.restoredCounts && st.body.state.restoredCounts.commanders === 2,
    '恢复计数：2 名玩家', st.body.state && st.body.state.restoredCounts);

  const cmd = await get('/api/online/commanders');
  const ids = (cmd.body.list || []).map((c) => c.commanderId);
  expect(ids.includes('probe-A') && ids.includes('probe-B'), '全服注册表恢复了两名玩家', ids);
  expect(ids.filter((i) => i.startsWith('NPC-')).length === 4, '4 个 NPC 势力仍在', ids);
  const a = (cmd.body.list || []).find((c) => c.commanderId === 'probe-A');
  expect(a && a.callsign === '探针甲[自检]', '玩家呼号等字段完整恢复', a && a.callsign);
  // 注意：/api/online/commanders 只外发公开字段，不含 fleetPower（战力由客户端在 raid 时自行上报）
  expect(a && a.defensePower === 180, '玩家防御战力字段恢复', a && a.defensePower);
  expect(a && a.planetCode === 'syl', '玩家母星编号字段恢复', a && a.planetCode);

  const chat = await get('/api/online/chat');
  const texts = (chat.body.messages || []).map((m) => m.text);
  expect(texts.some((t) => t && t.includes('持久化自检消息')), '公频历史消息恢复', texts.slice(-3));
  expect(texts.some((t) => t && t.includes('星区公频已接通')), '种子欢迎语仍然保留');
  const chatIds = (chat.body.messages || []).map((m) => m.id);
  expect(chatIds.includes(chatId), '恢复的正是同一条消息（按 id 比对）', chatId);

  const mkt = await get('/api/online/market');
  const listings = mkt.body.listings || [];
  const lids = listings.map((l) => l.id);
  expect(lids.includes(listingId), '玩家集市挂单恢复', [listingId, lids]);
  expect(!lids.includes('trade_init_1'), '已售出的 NPC 货架 trade_init_1 不再复活', lids);
  expect(lids.includes('trade_init_2') && lids.includes('trade_init_3'), '未售出的 NPC 常驻货架仍在', lids);

  const inboxB = await get('/api/online/inbox?commanderId=probe-B');
  expect(inboxB.body.ok && (inboxB.body.list || []).length > 0, 'probe-B 的攻防战报恢复', inboxB.body);
  expect((inboxB.body.list || []).some((m) => m.type === 'defense_loss' || m.type === 'defense_win'), '战报类型正确', inboxB.body.list);

  const inboxA = await get('/api/online/inbox?commanderId=probe-A');
  expect(inboxA.body.ok && Array.isArray(inboxA.body.list), 'probe-A 信箱可读取', inboxA.body);
  // trade_init_1 的卖家是 NPC 铁胡子船长，所以结算回执进的是 NPC-SRB 的信箱
  const inboxSeller = await get('/api/online/inbox?commanderId=NPC-SRB');
  expect((inboxSeller.body.list || []).some((m) => m.type === 'trade_earn'), 'NPC 卖家的贸易结算回执恢复', inboxSeller.body.list);

  const how = await stopServer(instance.proc);
  expect(how === 'exited' || how === 'forced', '二次停机正常', how);
}

// ===== 执行 =====
console.log('== Astrix 全服状态持久化自检 ==');
console.log('快照文件:', STATE_FILE);

try { fs.rmSync(STATE_FILE, { force: true }); } catch (e) {}

const s1 = startServer();
try {
  await phase1(s1);
} catch (e) {
  errors.push('阶段一异常: ' + (e && e.stack || e));
  console.log('  x   阶段一异常:', e && e.message || e);
  try { s1.proc.kill('SIGKILL'); } catch (err) {}
}

const s2 = startServer();
try {
  await phase2(s2);
} catch (e) {
  errors.push('阶段二异常: ' + (e && e.stack || e));
  console.log('  x   阶段二异常:', e && e.message || e);
  try { s2.proc.kill('SIGKILL'); } catch (err) {}
}

try { fs.rmSync(STATE_FILE, { force: true }); } catch (e) {}

console.log('\n== 结果 ==');
console.log('运行时异常数:', errors.length);
errors.forEach((e) => console.log('  x ' + e));
console.log(errors.length === 0 ? '全部通过' : '存在异常');
process.exit(errors.length === 0 ? 0 : 1);

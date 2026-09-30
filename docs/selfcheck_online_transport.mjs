// Astrix · 联机链路选路与公频契约自检（docs/selfcheck_online_transport.mjs）
//
// 为什么要有这个探针：公网联机有两条链路 —— 本地/局域网走 server.mjs（同源 REST），
// HuggingFace 静态托管走公网中继（没有服务端）。上层 UI 只认函数名与返回形状，
// 因此「选对了哪条链路」和「两条链路返回的是同一个形状」是整件事的成败所在，
// 而这两点都无法靠单测中继层覆盖。
//
// 本探针在 Node 里真实加载 cloud.js（与 _probe_galaxy.mjs 一样只需一个 localStorage 桩），
// 用可切换的 fetch 桩模拟两种部署环境，并断言：
//   1) 静态托管（/api/* 全部 404）→ 自动选中继，且真的建立连接、真的收发消息；
//   2) 同源服务端（/api/online/status 返回 200）→ 自动选服务端，且不会去连中继；
//   3) 公频返回形状在两条链路上完全一致（{ messages: [{ senderId, senderName, text, time }] }）
//      —— 这里同时钉住一个既存缺陷：服务端产出的是 { from, commanderId, at }，
//      与公频 UI 读取的字段对不上，导致公频列表在任何模式下都恒为空；
//   4) 服务端中途不可用时会自动降级到中继，而不是把功能整体卡死。

import assert from 'assert';

// relay.js 在模块加载时读 location 决定房间 —— 必须在动态 import 之前注入随机房间，
// 否则会与线上玩家共用 'main' 房间，断言会被他人消息污染。
const ROOM = 'gluetest-' + Math.random().toString(36).slice(2, 10);
globalThis.location = { search: '?room=' + ROOM };

globalThis.localStorage = (() => {
  const map = new Map();
  return {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => { map.set(String(k), String(v)); },
    removeItem: (k) => { map.delete(k); },
    clear: () => map.clear(),
    get length() { return map.size; },
    key: (i) => Array.from(map.keys())[i] ?? null,
  };
})();

const T = (ch) => `astrix/v022/${ROOM}/${ch}`;

const errors = [];
let passed = 0;
function expect(cond, label, extra) {
  if (cond) {
    passed++;
    console.log('  ok  ' + label);
  } else {
    const msg = label + (extra === undefined ? '' : ' → ' + JSON.stringify(extra));
    errors.push(msg);
    console.log('  x   ' + msg);
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
function waitFor(fn, timeoutMs, label) {
  return new Promise((resolve, reject) => {
    const t0 = Date.now();
    const timer = setInterval(() => {
      let ok = false;
      try { ok = !!fn(); } catch (e) { /* 未满足 */ }
      if (ok) { clearInterval(timer); resolve(true); }
      else if (Date.now() - t0 > timeoutMs) { clearInterval(timer); reject(new Error('超时：' + label)); }
    }, 120);
  });
}

// ---- 可切换的 fetch 桩（模拟两种部署环境）----------------------------------
// 'static' = HuggingFace 静态托管：/api/* 一律 404（曾经的线上真实状态）
// 'server' = 本地/局域网跑 server.mjs：/api/online/status 返回 200
let mode = 'static';
let failNext = false;
const calls = [];

function jsonRes(body, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    async json() { return body; },
    async text() { return JSON.stringify(body); },
  };
}

globalThis.fetch = async (url, opts) => {
  const u = String(url);
  const method = (opts && opts.method) || 'GET';
  calls.push(method + ' ' + u);

  if (mode === 'static') return jsonRes({ error: 'Not Found' }, 404);
  if (failNext) { failNext = false; throw new Error('模拟服务端不可用'); }

  if (u.includes('/api/online/status')) return jsonRes({ ok: true, state: { backend: 'file' } });
  if (u.includes('/api/online/chat')) {
    if (method === 'POST') return jsonRes({ ok: true, message: { id: 'x' } });
    // 刻意用服务端真实产出的字段名（from / commanderId / at）—— 与 UI 期望的不同
    return jsonRes({
      ok: true,
      messages: [{ id: 'srv-chat-1', from: '服务端甲', commanderId: 'SRV-A', text: '服务端公频消息', at: 1700000000000 }],
    });
  }
  if (u.includes('/api/online/commanders')) {
    return jsonRes({
      ok: true,
      list: [
        { commanderId: 'SRV-B', callsign: '服务端乙', isNpc: false, planetNameCn: '乙星' },
        { commanderId: 'NPC-VG4', callsign: '维加斯督军', isNpc: true, planetNameCn: '织女四' },
      ],
    });
  }
  if (u.includes('/api/online/market')) return jsonRes({ ok: true, listings: [{ id: 'srv-listing-1', sellerId: 'SRV-B', mat: '钢', nameCn: '精炼钢', qty: 5, priceAscoin: 80 }] });
  if (u.includes('/api/online/heartbeat')) return jsonRes({ ok: true, onlineCount: 2 });
  return jsonRes({ ok: true });
};

// ---- 加载被测模块 -----------------------------------------------------------
const cloud = await import('../js/core/cloud.js?v=21.18');
const relay = await import('../js/core/relay.js?v=21.18');
const { createMqttClient } = await import('../js/net/mqtt.js?v=21.18');

// ============================================================================
console.log('\n== A) 静态托管（HuggingFace）环境：应自动选中继 ==');
calls.length = 0;
let peer = null;

try {
  const players = await cloud.fetchRemoteGalaxyRegistry(null, '');
  expect(cloud.currentTransport() === 'relay', '★ /api/* 全部 404 时自动选中继链路', cloud.currentTransport());
  expect(calls.some((c) => c.includes('/api/online/status')), '先探测过同源服务端是否存在', calls.slice(0, 3));
  expect(!calls.some((c) => c.includes('/api/online/commanders')), '★ 选中继后不再向不存在的服务端发请求', calls);

  await waitFor(() => cloud.getRelayStatus().state === 'connected', 30000, '中继建立连接');
  expect(true, '中继链路已建立', { broker: cloud.getRelayStatus().broker, room: cloud.getRelayStatus().room });

  // 对端（模拟另一名玩家）向中继世界广播
  peer = createMqttClient({ brokers: relay.RELAY_BROKERS, onMessage: () => {}, onStatus: () => {} });
  peer.connect();
  await waitFor(() => peer.getState() === 'connected', 30000, '对端建立连接');
  for (const ch of ['presence', 'chat', 'market', 'snapshot', 'raid']) peer.subscribe(T(ch));
  await sleep(1200);

  peer.publish(T('chat'), JSON.stringify({
    t: 'chat', sid: 'peer', id: 'glue-chat-1', senderId: 'peer-alpha', senderName: '远方的指挥官', text: '来自公网的真实公频', time: Date.now(),
  }));
  await waitFor(() => relay.listChat().messages.some((x) => x.id === 'glue-chat-1'), 12000, '经中继收到公频');

  const chat = await cloud.fetchOnlineChatMessages();
  expect(chat && Array.isArray(chat.messages), '★ 公频返回 { messages: [...] }（对象而非裸数组）', chat && Object.keys(chat));
  expect(chat.messages.some((m) => m.id === 'glue-chat-1'), '公网对端的公频消息出现在列表里');
  const m = chat.messages.find((x) => x.id === 'glue-chat-1');
  expect(m && m.senderId === 'peer-alpha' && m.senderName === '远方的指挥官' && typeof m.time === 'number',
    '★ 公频字段为 UI 期望的 senderId / senderName / time', m);
  expect(m && m.text === '来自公网的真实公频', '公频正文完整');

  peer.publish(T('presence'), JSON.stringify({
    t: 'presence', sid: 'peer', commanderId: 'peer-alpha', callsign: '远方的指挥官', planetNameCn: '远方星', defensePower: 900,
  }));
  await waitFor(() => relay.listPlayers().some((x) => x.commanderId === 'peer-alpha'), 12000, '注册表出现对端');
  const reg = await cloud.fetchRemoteGalaxyRegistry(null, '');
  expect(reg.some((x) => x.commanderId === 'peer-alpha'), '★ 真实玩家出现在星图注册表（此前星图只有 NPC）');
  expect(!reg.some((x) => x.isNpc), '注册表不含 NPC（NPC 由本地常量提供，避免重复）');
  const cached = JSON.parse(localStorage.getItem('astrix.cloud.registry.cache') || '[]');
  expect(cached.some((x) => x.commanderId === 'peer-alpha'), '注册表已写入本地缓存供星图同步渲染读取');

  peer.publish(T('market'), JSON.stringify({
    t: 'listing', sid: 'peer',
    listing: { id: 'glue-listing-1', sellerId: 'peer-alpha', sellerCallsign: '远方的指挥官', mat: '硅', nameCn: '高纯硅晶', qty: 20, priceAscoin: 140, listedAt: Date.now() },
  }));
  await waitFor(() => relay.listListings().some((x) => x.id === 'glue-listing-1'), 12000, '集市出现对端货单');
  const listings = await cloud.fetchOnlineMarketListings();
  expect(listings.some((x) => x.id === 'glue-listing-1'), '★ 公网集市挂单对 UI 可见');

  const sent = await cloud.sendOnlineChatMessage({ id: 'glue-acc' }, '本机发出的公频');
  expect(sent && sent.ok === true, '发送公频经中继成功', sent);
  await waitFor(() => relay.listChat().messages.some((x) => x.text === '本机发出的公频'), 8000, '自己发的公频可见');
  expect(true, '自己发出的公频立刻出现在本地世界（无需等待回环）');
} catch (e) {
  expect(false, '静态托管环境整体流程', e.message);
}

// ============================================================================
console.log('\n== B) 同源服务端（本地/局域网）环境：应优先用服务端 ==');
try {
  cloud.resetTransport();
  mode = 'server';
  calls.length = 0;

  const chat = await cloud.fetchOnlineChatMessages();
  expect(cloud.currentTransport() === 'server', '★ 服务端可用时选中服务端链路', cloud.currentTransport());
  expect(calls.some((c) => c.includes('/api/online/chat')), '公频走同源 HTTP 接口', calls);
  expect(chat && Array.isArray(chat.messages) && chat.messages.length === 1, '服务端公频返回 { messages: [...] }', chat);
  const sm = chat.messages[0];
  expect(sm.senderId === 'SRV-A', '★ 服务端字段 commanderId 被归一为 senderId（修掉公频恒为空）', sm);
  expect(sm.senderName === '服务端甲', '★ 服务端字段 from 被归一为 senderName', sm);
  expect(sm.time === 1700000000000, '★ 服务端字段 at 被归一为 time', sm);

  const reg = await cloud.fetchRemoteGalaxyRegistry(null, '服务端乙');
  expect(reg.some((x) => x.commanderId === 'SRV-B'), '服务端注册表可读');
  expect(!reg.some((x) => x.isNpc), '★ 服务端返回的 NPC 条目被过滤（与中继链路口径一致）');

  const list = await cloud.fetchOnlineMarketListings();
  expect(list.some((x) => x.id === 'srv-listing-1'), '服务端集市可读');

  const hb = await cloud.syncOnlineServer(null);
  expect(hb === null, '无账号时心跳安全返回 null（不抛错）');
} catch (e) {
  expect(false, '服务端环境整体流程', e.message);
}

// ============================================================================
console.log('\n== C) 服务端中途不可用：应自动降级到中继 ==');
try {
  failNext = true;
  const chat = await cloud.fetchOnlineChatMessages();
  expect(cloud.currentTransport() === 'relay', '★ 服务端请求失败后自动降级到中继', cloud.currentTransport());
  expect(chat && Array.isArray(chat.messages), '降级后仍返回同一形状（UI 无感知）', chat && Object.keys(chat));
} catch (e) {
  expect(false, '降级流程', e.message);
}

// ============================================================================
console.log('\n== D) 复位与房间配置 ==');
try {
  cloud.resetTransport();
  expect(cloud.currentTransport() === null, 'resetTransport 后回到未探测状态');
  expect(cloud.getRelayRoom() === ROOM, '中继房间取自 ?room= 参数', { got: cloud.getRelayRoom(), want: ROOM });
  const next = cloud.setRelayRoom('ABC-123!@#');
  expect(next === 'abc-123', '★ 房间号被规范化为安全字符集', next);
  expect(cloud.getRelayRoom() === 'abc-123', '房间号已生效');
} catch (e) {
  expect(false, '复位与房间配置', e.message);
}

if (peer) peer.close();
cloud.publishBye();
relay.stopRelay();
await sleep(300);

console.log('\n== 结果 ==');
console.log('通过 ' + passed + ' 项，失败 ' + errors.length + ' 项');
errors.forEach((e) => console.log('  x ' + e));
assert(errors.length === 0, '存在失败断言');
process.exit(errors.length === 0 ? 0 : 1);

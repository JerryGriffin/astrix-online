// Astrix · 公网中继联机自检（docs/selfcheck_relay_online.mjs）
//
// 为什么要有这个探针：HuggingFace 免费层跑不了服务端（官方政策：计算型 Space 需付费），
// 公网联机改由「浏览器直连公共 MQTT 代理 + 客户端共同物化世界」承担。这条链路没有任何
// 服务端可断言，所以必须真的连上代理、真的收发报文、真的核对物化结果——只测序列化函数
// 等于什么都没测。
//
// 覆盖范围：
//   1) MQTT 3.1.1 报文编解码往返（含 varint、分片拼接、UTF-8、retain 标志）
//   2) 真实代理上的中继层物化：presence / chat / market / sold / raid / snapshot
//   3) 入站净化与限幅（公共主题必须假定载荷是敌意的）
//   4) 集市成交的确定性仲裁（先到先得）
//   5) 快照不得让已售货单复活
//   6) 房间隔离（?room=）
//   7) 代理故障切换（首个代理不可达时自动轮换）
//
// 运行：node docs/selfcheck_relay_online.mjs
// 需要能访问公共 MQTT 代理（WSS）。离线环境下本探针会失败，这是设计使然。

// relay.js 会在模块加载时读 location 决定房间 —— 这里在 import 之前注入一个随机房间，
// 避免与线上玩家共用 'main' 房间导致断言被他人消息污染。
const ROOM = 'selftest-' + Math.random().toString(36).slice(2, 10);
globalThis.location = { search: '?room=' + ROOM };

const { createMqttClient, encodeConnect, decodePackets, PACKET_TYPE } = await import('../js/net/mqtt.js?v=21.18');
const relay = await import('../js/core/relay.js?v=21.18');

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
      try { ok = !!fn(); } catch (e) { /* 断言函数自身抛错视作未满足 */ }
      if (ok) { clearInterval(timer); resolve(true); }
      else if (Date.now() - t0 > timeoutMs) { clearInterval(timer); reject(new Error('超时：' + label)); }
    }, 120);
  });
}

// ============================================================================
console.log('\n== 1) MQTT 报文编解码往返（离线可测）==');
{
  const connect = encodeConnect('astrix-selfcheck', 60);
  expect(connect[0] === (PACKET_TYPE.CONNECT << 4), 'CONNECT 类型正确', connect[0]);
  expect(connect[1] === connect.length - 2, 'CONNECT 剩余长度自洽');
  expect(connect[2] === 0x00 && connect[3] === 0x04, '协议名长度前缀正确');
  expect(String.fromCharCode(...connect.subarray(4, 8)) === 'MQTT', '协议名 = MQTT');
  expect(connect[8] === 0x04, '协议级别 = 4（3.1.1）');
  expect((connect[9] & 0x02) === 0x02, 'cleanSession 已置位');

  // 手工构造 PUBLISH(QoS0, retain) 报文以验证解析器
  const topic = T('chat');
  const payload = JSON.stringify({ t: 'chat', text: '星区广播 · UTF-8 ✓' });
  const tb = new TextEncoder().encode(topic);
  const pb = new TextEncoder().encode(payload);
  const body = new Uint8Array(2 + tb.length + pb.length);
  body[0] = (tb.length >> 8) & 0xff;
  body[1] = tb.length & 0xff;
  body.set(tb, 2);
  body.set(pb, 2 + tb.length);
  const raw = new Uint8Array(2 + body.length);
  raw[0] = (PACKET_TYPE.PUBLISH << 4) | 0x01;
  raw[1] = body.length;
  raw.set(body, 2);

  const r = decodePackets(raw);
  expect(r.packets.length === 1, '解出 1 个报文');
  expect(r.rest.length === 0, '无残余字节');
  expect(r.packets[0].topic === topic, '主题解析正确');
  expect(r.packets[0].retain === true, 'retain 标志解析正确');
  expect(new TextDecoder().decode(r.packets[0].payload) === payload, 'UTF-8 载荷解析正确');

  // 分片到达：必须等后续字节而不是误判
  const half = decodePackets(raw.subarray(0, 6));
  expect(half.packets.length === 0 && half.rest.length === 6, '不完整报文正确等待后续字节');
  const joined = decodePackets(new Uint8Array([...half.rest, ...raw.subarray(6)]));
  expect(joined.packets.length === 1 && joined.packets[0].topic === topic, '拼接后解析出完整报文');

  // 多字节剩余长度（>127 字节载荷）
  const big = JSON.stringify({ t: 'snapshot', blob: 'x'.repeat(600) });
  const bb = new TextEncoder().encode(big);
  const bigBody = new Uint8Array(2 + tb.length + bb.length);
  bigBody[0] = (tb.length >> 8) & 0xff;
  bigBody[1] = tb.length & 0xff;
  bigBody.set(tb, 2);
  bigBody.set(bb, 2 + tb.length);
  const rl = [];
  for (let v = bigBody.length; ;) {
    let b = v % 128;
    v = Math.floor(v / 128);
    if (v > 0) b |= 0x80;
    rl.push(b);
    if (v === 0) break;
  }
  const bigRaw = new Uint8Array(1 + rl.length + bigBody.length);
  bigRaw[0] = PACKET_TYPE.PUBLISH << 4;
  bigRaw.set(rl, 1);
  bigRaw.set(bigBody, 1 + rl.length);
  const rb = decodePackets(bigRaw);
  expect(rl.length > 1, '构造出了多字节剩余长度（varint）', rl.length);
  expect(rb.packets.length === 1 && new TextDecoder().decode(rb.packets[0].payload) === big, '多字节 varint 解析正确');
}

// ============================================================================
console.log('\n== 2) 代理故障切换 ==');
{
  const c = createMqttClient({
    // 首个地址必然连不上，验证会自动轮换到真实代理
    brokers: ['wss://127.0.0.1:9/mqtt', ...relay.RELAY_BROKERS],
    onMessage: () => {},
    onStatus: () => {},
  });
  c.connect();
  try {
    await waitFor(() => c.getState() === 'connected', 25000, '故障切换后建立连接');
    expect(true, '首个代理不可达时自动轮换到下一个', { broker: c.getBroker() });
  } catch (e) {
    expect(false, '首个代理不可达时自动轮换到下一个', e.message);
  }
  c.close();
}

// ============================================================================
console.log('\n== 3) 真实代理上的中继层物化 ==');
console.log('  房间: ' + ROOM);

const events = [];
relay.onWorldEvent((e) => events.push(e));
relay.ensureRelay();

const bSink = [];
const bClient = createMqttClient({
  brokers: relay.RELAY_BROKERS,
  onMessage: (topic, text) => bSink.push({ topic, text }),
  onStatus: () => {},
});

try {
  await waitFor(() => relay.getRelayStatus().state === 'connected', 30000, '中继建立连接');
  expect(true, '中继连接建立', { broker: relay.getRelayStatus().broker, room: relay.getRelayStatus().room });

  bClient.connect();
  await waitFor(() => bClient.getState() === 'connected', 30000, '对端建立连接');
  for (const ch of ['presence', 'chat', 'market', 'snapshot', 'raid']) bClient.subscribe(T(ch));
  await sleep(1200); // 等 SUBACK 生效

  // ---- presence：物化 + 邮箱剥离 + 限幅 ----
  const longCallsign = 'Z'.repeat(200);
  bClient.publish(T('presence'), JSON.stringify({
    t: 'presence', sid: 'probeB',
    commanderId: 'probe-alpha', callsign: longCallsign,
    email: 'should-not-leak@example.com',           // 公共主题上绝不允许出现
    planetNameCn: '自检母星', defensePower: 1234, faction: '自检同盟',
    goods: [{ mat: '铁', nameCn: '纯铁', priceAscoin: 30, stock: 100 }],
  }));
  await waitFor(() => relay.listPlayers().some((p) => p.commanderId === 'probe-alpha'), 12000, '收到 presence');
  const alpha = relay.listPlayers().find((p) => p.commanderId === 'probe-alpha');
  expect(!!alpha, '注册表物化出该指挥官');
  expect(alpha.callsign.length <= 48, '超长呼号被限幅', alpha.callsign.length);
  expect(alpha.email === undefined, '★ 邮箱不进入中继世界（隐私）', alpha.email);

  // ---- chat：物化为公频 UI 期望的形状 ----
  bClient.publish(T('chat'), JSON.stringify({
    t: 'chat', sid: 'probeB', id: 'probe-chat-1',
    senderId: 'probe-alpha', senderName: '自检甲', text: '中继公频自检消息', time: Date.now(),
  }));
  await waitFor(() => relay.listChat().messages.some((m) => m.id === 'probe-chat-1'), 12000, '收到 chat');
  const chatMsg = relay.listChat().messages.find((m) => m.id === 'probe-chat-1');
  expect(!!chatMsg, '公频消息物化成功');
  expect(chatMsg.senderId === 'probe-alpha' && chatMsg.senderName === '自检甲', '公频字段为 UI 期望的 senderId/senderName');
  expect(typeof chatMsg.time === 'number', '公频带 time 时间戳');

  // ---- market：挂单物化 ----
  bClient.publish(T('market'), JSON.stringify({
    t: 'listing', sid: 'probeB',
    listing: { id: 'probe-listing-1', sellerId: 'probe-alpha', sellerCallsign: '自检甲', mat: '硅', nameCn: '高纯硅晶', qty: 150, priceAscoin: 140, listedAt: Date.now() },
  }));
  await waitFor(() => relay.listListings().some((l) => l.id === 'probe-listing-1'), 12000, '收到挂单');
  expect(relay.listListings().some((l) => l.id === 'probe-listing-1'), '集市挂单物化成功');

  // ---- raid：实时战报投递给被攻击方 ----
  bClient.publish(T('presence'), JSON.stringify({ t: 'presence', sid: 'probeB', commanderId: 'probe-victim', callsign: '自检乙', planetNameCn: '受击星', defensePower: 500 }));
  await waitFor(() => relay.listPlayers().some((p) => p.commanderId === 'probe-victim'), 12000, '受害者上线');
  const before = events.length;
  bClient.publish(T('raid'), JSON.stringify({
    t: 'raid', sid: 'probeB', targetId: 'probe-victim', attackerId: 'probe-alpha',
    attackerCallsign: '自检甲', fleetPower: 800, targetDef: 500, win: true, shieldUntil: Date.now() + 3600000, at: Date.now(),
  }));
  await waitFor(() => events.length > before, 12000, '收到 raid 世界事件');
  const raidEvt = events[events.length - 1];
  expect(raidEvt && raidEvt.type === 'raid' && raidEvt.targetId === 'probe-victim', '被攻击方收到实时战报事件');
  expect(raidEvt.win === true && raidEvt.fleetPower === 800, '战报字段完整（胜负 / 战力）');
  await waitFor(() => (relay.listPlayers().find((p) => p.commanderId === 'probe-victim') || {}).shieldUntil > Date.now(), 8000, '免战力场同步到注册表');
  expect((relay.listPlayers().find((p) => p.commanderId === 'probe-victim') || {}).shieldUntil > Date.now(), '免战力场已同步（进攻方的护盾判定据此生效）');

  // ---- 出站：中继的动作对端能收到 ----
  const sentChat = relay.sendChat({ commanderId: 'probe-self', callsign: '自检本机' }, '出站公频消息');
  expect(sentChat.ok === true, '中继发送公频返回 ok');
  await waitFor(() => bSink.some((m) => m.topic === T('chat') && m.text.includes('出站公频消息')), 12000, '对端收到中继公频');
  expect(true, '中继发出的公频被对端收到');

  const created = relay.createListing({ commanderId: 'probe-self', callsign: '自检本机' }, { mat: '钢', nameCn: '精炼钢', qty: 20, priceAscoin: 50 });
  expect(created.ok === true && created.listing.id, '中继挂单返回 ok 且带 listing');
  await waitFor(() => bSink.some((m) => m.topic === T('market') && m.text.includes(created.listing.id)), 12000, '对端收到中继挂单');
  expect(true, '中继发出的挂单被对端收到');

  relay.publishPresence({ commanderId: 'probe-self', callsign: '自检本机', planetNameCn: '本机母星', defensePower: 700 });
  await waitFor(() => bSink.some((m) => m.topic === T('presence') && m.text.includes('probe-self')), 12000, '对端收到中继心跳');
  expect(true, '中继心跳被对端收到');
  expect(relay.listPlayers().some((p) => p.commanderId === 'probe-self'), '自身也计入在线列表');

  // ---- 成交仲裁（一）：更早的竞争声明必须胜出 ----
  bClient.publish(T('market'), JSON.stringify({
    t: 'claim', sid: 'probeB', listingId: 'probe-listing-1',
    buyerId: 'probe-alpha', buyerCallsign: '自检甲',
    claimId: 'probe-claim-earlier', at: Date.now() - 3000,
  }));
  await sleep(700);
  const loser = await relay.claimListing({ commanderId: 'probe-self', callsign: '自检本机' }, 'probe-listing-1');
  expect(loser.ok === false, '存在更早的竞争声明时采购被拒', loser);
  expect(/抢先|已下架|已被/.test(String(loser.reason)), '拒绝原因可读', loser.reason);

  // ---- 成交仲裁（二）：无竞争时应当成交并广播下架 ----
  bClient.publish(T('market'), JSON.stringify({
    t: 'listing', sid: 'probeB',
    listing: { id: 'probe-listing-2', sellerId: 'probe-victim', sellerCallsign: '自检乙', mat: '铁', nameCn: '纯铁', qty: 10, priceAscoin: 35, listedAt: Date.now() },
  }));
  await waitFor(() => relay.listListings().some((l) => l.id === 'probe-listing-2'), 12000, '第二张货单上架');
  const win = await relay.claimListing({ commanderId: 'probe-self', callsign: '自检本机' }, 'probe-listing-2');
  expect(win.ok === true, '无竞争时采购成功', win);
  expect(!relay.listListings().some((l) => l.id === 'probe-listing-2'), '成交后货单立即下架');
  await waitFor(() => bSink.some((m) => m.topic === T('market') && m.text.includes('"t":"sold"')), 10000, '对端收到成交广播');
  expect(true, '成交结果广播给全服（避免各端集市状态不一致）');

  // ---- 快照不得让已售货单复活 ----
  bClient.publish(T('market'), JSON.stringify({ t: 'sold', sid: 'probeB', listingId: 'probe-listing-1', buyerId: 'probe-alpha', at: Date.now() }));
  await waitFor(() => !relay.listListings().some((l) => l.id === 'probe-listing-1'), 12000, '已售货单被移除');
  expect(!relay.listListings().some((l) => l.id === 'probe-listing-1'), '已售货单从集市移除');
  bClient.publish(T('snapshot'), JSON.stringify({
    t: 'snapshot', sid: 'probeB', at: Date.now(),
    chat: [{ id: 'probe-chat-1', senderId: 'probe-alpha', senderName: '自检甲', text: '中继公频自检消息', time: Date.now() }],
    listings: [{ id: 'probe-listing-1', sellerId: 'probe-alpha', sellerCallsign: '自检甲', mat: '硅', nameCn: '高纯硅晶', qty: 150, priceAscoin: 140, listedAt: Date.now() }],
    commanders: [], soldIds: [],
  }));
  await sleep(1500);
  expect(!relay.listListings().some((l) => l.id === 'probe-listing-1'), '★ 快照不会让已售货单复活');

  // ---- 快照带出他人在线信息 ----
  bClient.publish(T('snapshot'), JSON.stringify({
    t: 'snapshot', sid: 'probeB', at: Date.now() + 1000,
    commanders: [{ commanderId: 'probe-gamma', callsign: '自检丙', planetNameCn: '丙星', defensePower: 900 }],
    chat: [], listings: [], soldIds: [],
  }));
  await waitFor(() => relay.listPlayers().some((p) => p.commanderId === 'probe-gamma'), 12000, '快照带出他人');
  expect(true, '快照可补齐他人在线信息（新加入者引导）');

  // ---- 房间隔离 ----
  bClient.publish(`astrix/v022/other-room-${ROOM}/chat`, JSON.stringify({
    t: 'chat', sid: 'probeB', id: 'probe-chat-other', senderId: 'probe-x', senderName: '别处', text: '不该看到的消息', time: Date.now(),
  }));
  await sleep(1200);
  expect(!relay.listChat().messages.some((m) => m.id === 'probe-chat-other'), '★ 其它房间的消息不会串进来');

  // ---- 入站限幅 ----
  bClient.publish(T('chat'), JSON.stringify({
    t: 'chat', sid: 'probeB', id: 'probe-chat-trunc', senderId: 'probe-alpha', senderName: '自检甲', text: 'T'.repeat(500), time: Date.now(),
  }));
  await waitFor(() => relay.listChat().messages.some((m) => m.id === 'probe-chat-trunc'), 12000, '收到超长消息');
  const trunc = relay.listChat().messages.find((m) => m.id === 'probe-chat-trunc');
  expect(trunc.text.length <= 200, '超长公频文本被限幅', trunc.text.length);

  // ---- 畸形载荷不得影响中继 ----
  bClient.publish(T('chat'), '{not json');
  bClient.publish(T('presence'), JSON.stringify({ t: 'presence' }));           // 缺 commanderId
  bClient.publish(T('market'), JSON.stringify({ t: 'listing', listing: {} }));  // 缺字段
  await sleep(1000);
  expect(relay.getRelayStatus().state === 'connected', '畸形载荷后中继仍然在线');

  // ---- retained 快照引导：后来者一订阅就能拿到世界 ----
  await waitFor(() => relay.getRelayStatus().snapshotAt > 0, 8000, '中继已发布过快照');
  const sinkC = [];
  const c = createMqttClient({
    brokers: relay.RELAY_BROKERS,
    onMessage: (topic, text) => sinkC.push({ topic, text }),
    onStatus: () => {},
  });
  c.connect();
  await waitFor(() => c.getState() === 'connected', 25000, '新客户端连接');
  c.subscribe(T('snapshot'));
  let gotRetained = false;
  try {
    await waitFor(() => sinkC.some((m) => m.topic === T('snapshot')), 10000, 'retained 快照');
    gotRetained = true;
  } catch (e) { /* 该代理不支持 retained 时走 hello 降级路径 */ }
  expect(gotRetained, '后加入者经 retained 快照直接拿到世界');
  if (gotRetained) {
    const snap = JSON.parse(sinkC.find((m) => m.topic === T('snapshot')).text);
    expect(typeof snap.at === 'number' && Array.isArray(snap.commanders), '快照结构完整（at + commanders）');
  }
  c.close();
} catch (e) {
  expect(false, '中继链路整体流程', e.message);
  console.log('  中继状态: ' + JSON.stringify(relay.getRelayStatus()));
}

relay.stopRelay();
bClient.close();
await sleep(400);

console.log('\n== 结果 ==');
console.log('通过 ' + passed + ' 项，失败 ' + errors.length + ' 项');
errors.forEach((e) => console.log('  x ' + e));
process.exit(errors.length === 0 ? 0 : 1);

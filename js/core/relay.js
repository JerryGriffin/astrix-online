// Astrix · 公网中继联机层（纯静态托管下的实时多人）
//
// 背景与取舍：HuggingFace 免费账号只能托管 Static Space —— 官方政策明确「运行计算
// 的 Space（Gradio/Docker）需付费」，`cpu-basic` 对免费账号配额为 0。也就是说公网
// 上不可能再跑 server.mjs，`/api/online/*` 永远 404。
//
// 于是把「全服」从「一台服务器」改成「一组客户端共同维护的广播世界」：
//   · 传输    —— 浏览器直连公共 MQTT 代理（WSS），零账号、零费用、零服务端计算；
//   · 权威性  —— 不再有权威服务端。每个客户端把收到的事件按确定性规则物化成本地世界，
//                因此所有人看到同一份状态，而不需要任何一方去「算」它；
//   · 引导    —— 世界快照以 retained 消息发布，后来者一订阅就拿到，无需等待他人上线；
//   · 存续    —— 公共代理不提供持久化，世界是会话级的（与「免费层容器磁盘重启即丢」
//                的既有结论一致，不构成回退）。
//
// 本模块只依赖 js/net/mqtt.js，**刻意不 import cloud.js**（避免循环依赖）：身份与快照
// 由调用方（cloud.js）传入，收到的世界事件（如被攻击）通过 onWorldEvent 回调抛出。
//
// 已知边界（写进 docs/ONLINE_RELAY.md，不掩饰）：
//   1) 公共代理是「尽力而为」服务，无 SLA；已内置多代理故障切换与自动重连。
//   2) 主题是公开的，任何人可订阅/发布 —— 故所有入站字段都做长度与数量限幅；
//      需要隔离可与朋友约定房间号（?room=xxx），提供的是隔离而非保密。
//   3) 集市「先到先得」用固定仲裁窗口近似（见 CLAIM_WINDOW_MS），极高并发下仍可能
//      出现双方各自扣款的极窄窗口；业余规模下可接受，文档已注明。

import { createMqttClient, randomToken } from '../net/mqtt.js?v=21.18';

// ---- 常量 -------------------------------------------------------------------

const RELAY_TAG = 'v022';
const ROOM_KEY = 'astrix.relay.room';

// 三个相互独立的公共 MQTT 代理：逐个尝试，失败自动轮换，避免单点。
const BROKERS = [
  'wss://broker.emqx.io:8084/mqtt',
  'wss://broker.hivemq.com:8884/mqtt',
  'wss://test.mosquitto.org:8081/',
];

const PRESENCE_TTL_MS = 3 * 60 * 1000; // 中继侧在线口径（服务端路径为 15 分钟；中继存在感廉价，收紧更贴合「现在在线」）
const PRESENCE_REFRESH_MS = 10 * 1000;
const PRUNE_INTERVAL_MS = 20 * 1000;
const CHAT_CAP = 80;
const CHAT_RETURN = 40;
const LISTING_CAP = 50;
const COMMANDER_CAP = 200;
const SNAPSHOT_INTERVAL_MS = 60 * 1000;
const SNAPSHOT_ARM_DELAY_MS = 2500;  // 收到 retained 快照前不发布，否则会用空世界覆盖它
const CLAIM_WINDOW_MS = 1200;
const HELLO_THROTTLE_MS = 5000;

// 入站限幅：公共主题任何人都能发布，必须假定载荷是敌意的。
const LIMITS = { callsign: 48, planetNameCn: 48, faction: 32, intel: 200, text: 200, id: 64 };

function clip(value, max) {
  return String(value == null ? '' : value).slice(0, max);
}

function toInt(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? Math.trunc(n) : fallback;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ---- 房间 -------------------------------------------------------------------

function sanitizeRoom(raw) {
  const s = String(raw || '').toLowerCase().replace(/[^a-z0-9_-]/g, '').slice(0, 24);
  return s || 'main';
}

function loadRoom() {
  try {
    const fromUrl = new URLSearchParams(location.search).get('room');
    if (fromUrl) return sanitizeRoom(fromUrl);
  } catch (e) { /* 非浏览器环境 */ }
  try {
    const saved = localStorage.getItem(ROOM_KEY);
    if (saved) return sanitizeRoom(saved);
  } catch (e) { /* 忽略 */ }
  return 'main';
}

let room = loadRoom();

function topic(channel) {
  return `astrix/${RELAY_TAG}/${room}/${channel}`;
}

// ---- 世界状态 ---------------------------------------------------------------

const world = {
  commanders: new Map(), // commanderId -> 已净化的注册表条目（含本地接收时刻）
  chat: [],              // [{ id, senderId, senderName, text, time }]
  listings: [],          // 与服务端同构的货单对象
  soldIds: new Set(),    // 已成交/已撤下的货单 id —— 防止快照把已售货单复活
  claims: new Map(),     // listingId -> [{ claimId, buyerId, at }]
  snapshotAt: 0,         // 已接受的最新快照时间戳（单调递增，LWW）
  dirty: false,
};

let client = null;
let started = false;
let sessionId = null;
let snapshotArmed = false;
let lastHelloReplyAt = 0;
let lastPresenceAt = 0;
let presenceTimer = null;
let snapshotTimer = null;
let pruneTimer = null;
let lastPresenceBody = null;
let lastError = '';
const statusListeners = new Set();
const worldListeners = new Set();

function notifyStatus() {
  const info = getRelayStatus();
  for (const fn of statusListeners) {
    try { fn(info); } catch (e) { /* 监听器异常不得影响中继 */ }
  }
}

function emitWorld(event) {
  for (const fn of worldListeners) {
    try { fn(event); } catch (e) { /* 同上 */ }
  }
}

// --- 入站净化 ----------------------------------------------------------------

// 只接受已知字段的**白名单**副本：既要挡住伪造，也不能把玩家的 email 之类
// 带进公共世界（buildLocalSnapshot 含 email，必须显式剔除）。
function sanitizeCommander(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const commanderId = clip(raw.commanderId, LIMITS.id);
  if (!commanderId) return null;
  const goods = Array.isArray(raw.goods) ? raw.goods.slice(0, 3).map((g) => ({
    mat: clip(g && g.mat, 24),
    nameCn: clip(g && g.nameCn, 24) || clip(g && g.mat, 24),
    priceAscoin: Math.max(0, toInt(g && g.priceAscoin)),
    stock: Math.max(0, toInt(g && g.stock)),
  })) : [];
  return {
    id: 'online_' + commanderId,
    isNpc: !!raw.isNpc,
    commanderId,
    callsign: clip(raw.callsign, LIMITS.callsign) || commanderId,
    planetCode: clip(raw.planetCode, 24) || 'syl',
    planetNameCn: clip(raw.planetNameCn, LIMITS.planetNameCn) || '殖民母星',
    faction: clip(raw.faction, LIMITS.faction) || '自由开拓同盟',
    factionColor: /^#[0-9a-fA-F]{3,8}$/.test(String(raw.factionColor)) ? raw.factionColor : '#7cd7ff',
    population: Math.max(0, toInt(raw.population, 100)),
    defensePower: Math.max(0, toInt(raw.defensePower, 500)),
    shieldUntil: Math.max(0, toInt(raw.shieldUntil)),
    distanceLy: Number.isFinite(Number(raw.distanceLy)) ? Number(raw.distanceLy) : 1.8,
    goods: goods.length ? goods : [{ mat: '铁', nameCn: '纯铁', priceAscoin: 30, stock: 500 }],
    intel: clip(raw.intel, LIMITS.intel) || '真实在线开拓指挥官',
  };
}

function sanitizeListing(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const id = clip(raw.id, LIMITS.id);
  const sellerId = clip(raw.sellerId, LIMITS.id);
  const mat = clip(raw.mat, 24);
  if (!id || !sellerId || !mat) return null;
  return {
    id,
    sellerId,
    sellerCallsign: clip(raw.sellerCallsign, LIMITS.callsign) || '匿名商人',
    mat,
    nameCn: clip(raw.nameCn, 24) || mat,
    qty: Math.max(1, toInt(raw.qty, 1)),
    priceAscoin: Math.max(1, toInt(raw.priceAscoin, 1)),
    listedAt: toInt(raw.listedAt, Date.now()),
  };
}

function sanitizeChat(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const text = clip(raw.text, LIMITS.text);
  const senderId = clip(raw.senderId, LIMITS.id);
  if (!text || !senderId) return null;
  return {
    id: clip(raw.id, LIMITS.id) || `chat_${toInt(raw.time, Date.now())}_${senderId}`,
    senderId,
    senderName: clip(raw.senderName, LIMITS.callsign) || senderId,
    text,
    time: toInt(raw.time, Date.now()),
  };
}

// --- 世界写入 ----------------------------------------------------------------

function upsertCommander(entry, opts = {}) {
  const clean = sanitizeCommander(entry);
  if (!clean) return false;
  if (!clean.isNpc && world.commanders.size >= COMMANDER_CAP && !world.commanders.has(clean.commanderId)) return false;
  const prev = world.commanders.get(clean.commanderId) || {};
  const merged = { ...prev, ...clean, lastSeen: Date.now() };
  // 免战力场是单调的：不能让一条旧事件把已生效的护盾抹掉
  merged.shieldUntil = Math.max(toInt(prev.shieldUntil), toInt(clean.shieldUntil));
  world.commanders.set(merged.commanderId, merged);
  if (!opts.silent) { world.dirty = true; notifyStatus(); }
  return true;
}

function pushChat(msg) {
  if (!msg) return false;
  if (world.chat.some((m) => m.id === msg.id)) return false;
  world.chat.push(msg);
  world.chat.sort((a, b) => a.time - b.time);
  if (world.chat.length > CHAT_CAP) world.chat = world.chat.slice(-CHAT_CAP);
  world.dirty = true;
  return true;
}

function pushListing(listing) {
  if (!listing) return false;
  if (world.soldIds.has(listing.id)) return false;
  if (world.listings.some((l) => l.id === listing.id)) return false;
  world.listings.unshift(listing);
  if (world.listings.length > LISTING_CAP) world.listings.length = LISTING_CAP;
  world.dirty = true;
  return true;
}

function markSold(listingId) {
  if (!listingId) return;
  world.soldIds.add(listingId);
  const before = world.listings.length;
  world.listings = world.listings.filter((l) => l.id !== listingId);
  if (world.listings.length !== before) world.dirty = true;
  // 已售集合不能无限增长
  if (world.soldIds.size > 400) world.soldIds = new Set(Array.from(world.soldIds).slice(-200));
}

function recordClaim(listingId, claim) {
  if (!listingId || !claim || !claim.claimId) return;
  const list = world.claims.get(listingId) || [];
  if (list.some((c) => c.claimId === claim.claimId)) return;
  list.push(claim);
  world.claims.set(listingId, list);
  if (world.claims.size > 200) {
    const keys = Array.from(world.claims.keys()).slice(0, 100);
    for (const k of keys) world.claims.delete(k);
  }
}

function prune() {
  const now = Date.now();
  let changed = false;
  for (const [id, c] of world.commanders) {
    if (!c.isNpc && now - c.lastSeen > PRESENCE_TTL_MS) {
      world.commanders.delete(id);
      changed = true;
    }
  }
  if (changed) notifyStatus();
}

// --- 快照 --------------------------------------------------------------------

function buildSnapshot() {
  return {
    t: 'snapshot',
    at: Date.now(),
    sid: sessionId,
    commanders: Array.from(world.commanders.values())
      .filter((c) => !c.isNpc)
      .map((c) => ({ ...sanitizeCommander(c) }))
      .filter(Boolean),
    chat: world.chat.slice(-CHAT_RETURN),
    listings: world.listings.slice(0, LISTING_CAP),
    soldIds: Array.from(world.soldIds).slice(-200),
  };
}

function applySnapshot(snap) {
  if (!snap || toInt(snap.at) <= world.snapshotAt) return false;
  if (Array.isArray(snap.soldIds)) for (const id of snap.soldIds) markSold(clip(id, LIMITS.id));
  if (Array.isArray(snap.commanders)) for (const c of snap.commanders) upsertCommander(c, { silent: true });
  if (Array.isArray(snap.listings)) for (const l of snap.listings) pushListing(sanitizeListing(l));
  if (Array.isArray(snap.chat)) for (const m of snap.chat) pushChat(sanitizeChat(m));
  world.snapshotAt = toInt(snap.at);
  world.dirty = false;
  notifyStatus();
  return true;
}

function maybePublishSnapshot(force = false) {
  if (!client || !snapshotArmed) return false;
  if (!force && !world.dirty) return false;
  const ok = client.publish(topic('snapshot'), JSON.stringify(buildSnapshot()), true);
  if (ok) world.dirty = false;
  return ok;
}

// --- 入站分发 ----------------------------------------------------------------

function handleMessage(topicStr, text) {
  let evt;
  try { evt = JSON.parse(text); } catch (e) { return; }
  if (!evt || typeof evt !== 'object') return;

  switch (evt.t) {
    case 'presence': {
      if (evt.sid && evt.sid === sessionId) { upsertCommander(evt, { silent: true }); return; }
      upsertCommander(evt);
      return;
    }
    case 'chat': {
      pushChat(sanitizeChat(evt));
      return;
    }
    case 'listing': {
      pushListing(sanitizeListing(evt.listing || evt));
      return;
    }
    case 'claim': {
      recordClaim(clip(evt.listingId, LIMITS.id), {
        claimId: clip(evt.claimId, LIMITS.id),
        buyerId: clip(evt.buyerId, LIMITS.id),
        at: toInt(evt.at, Date.now()),
      });
      return;
    }
    case 'sold': {
      markSold(clip(evt.listingId, LIMITS.id));
      return;
    }
    case 'raid': {
      // 中继只负责把战报实时送到被攻击方；胜负判定沿用原有的进攻方本地结算设计。
      const targetId = clip(evt.targetId, LIMITS.id);
      if (evt.sid !== sessionId) {
        const target = world.commanders.get(targetId);
        if (target && evt.shieldUntil) {
          target.shieldUntil = Math.max(toInt(target.shieldUntil), toInt(evt.shieldUntil));
          world.dirty = true;
        }
        emitWorld({
          type: 'raid',
          targetId,
          attackerId: clip(evt.attackerId, LIMITS.id),
          attackerCallsign: clip(evt.attackerCallsign, LIMITS.callsign),
          fleetPower: toInt(evt.fleetPower),
          win: !!evt.win,
          targetDef: toInt(evt.targetDef),
          shieldUntil: toInt(evt.shieldUntil),
          at: toInt(evt.at, Date.now()),
        });
      }
      return;
    }
    case 'hello': {
      if (evt.sid === sessionId) return;
      const now = Date.now();
      if (now - lastHelloReplyAt < HELLO_THROTTLE_MS) return;
      lastHelloReplyAt = now;
      // 非 retained 回应：让「代理未开启 retained 消息」时新加入者也能补齐世界。
      client && client.publish(topic('snapshot'), JSON.stringify(buildSnapshot()), false);
      return;
    }
    case 'snapshot': {
      applySnapshot(evt);
      return;
    }
    default:
      return;
  }
}

function handleStatus(state, detail) {
  if (state === 'error') lastError = String((detail && detail.reason) || '');
  notifyStatus();
}

// --- 生命周期 ----------------------------------------------------------------

export function ensureRelay() {
  if (started) return;
  started = true;
  sessionId = randomToken(4);

  client = createMqttClient({ brokers: BROKERS, onMessage: handleMessage, onStatus: handleStatus });
  client.onConnected(() => {
    for (const ch of ['presence', 'chat', 'market', 'snapshot', 'raid']) client.subscribe(topic(ch));
    // retained 快照通常立即到达；若 2 秒内世界仍空，说明该代理不支持 retained，
    // 改为广播 hello 请在线同伴补发。
    setTimeout(() => {
      if (world.snapshotAt === 0) {
        client.publish(topic('hello'), JSON.stringify({ t: 'hello', sid: sessionId, at: Date.now() }));
      }
      snapshotArmed = true;
      maybePublishSnapshot(true);
      if (lastPresenceBody) publishPresence(lastPresenceBody);
    }, SNAPSHOT_ARM_DELAY_MS);
  });
  client.connect();

  presenceTimer = setInterval(() => {
    if (lastPresenceBody) publishPresence(lastPresenceBody);
  }, PRESENCE_REFRESH_MS);
  snapshotTimer = setInterval(() => maybePublishSnapshot(false), SNAPSHOT_INTERVAL_MS);
  pruneTimer = setInterval(prune, PRUNE_INTERVAL_MS);
}

export function stopRelay() {
  if (!started) return;
  if (client) { try { client.close(); } catch (e) { /* 忽略 */ } }
  client = null;
  started = false;
  if (presenceTimer) { clearInterval(presenceTimer); presenceTimer = null; }
  if (snapshotTimer) { clearInterval(snapshotTimer); snapshotTimer = null; }
  if (pruneTimer) { clearInterval(pruneTimer); pruneTimer = null; }
}

// ---- 对外接口（供 cloud.js 调用，形状与 server.mjs 的产物保持一致） ----------

export function getRelayStatus() {
  return {
    state: client ? client.getState() : 'idle',
    broker: client ? client.getBroker() : '',
    clientId: sessionId || '',
    room,
    players: countPlayers(),
    snapshotAt: world.snapshotAt,
    lastError,
  };
}

export function onRelayStatus(fn) {
  statusListeners.add(fn);
  return () => statusListeners.delete(fn);
}

export function onWorldEvent(fn) {
  worldListeners.add(fn);
  return () => worldListeners.delete(fn);
}

export function getRelayRoom() { return room; }

export function setRelayRoom(next) {
  const clean = sanitizeRoom(next);
  if (clean === room) return room;
  try { localStorage.setItem(ROOM_KEY, clean); } catch (e) { /* 忽略 */ }
  room = clean;
  // 换房间 = 换世界：清空本地世界后重连
  world.commanders.clear();
  world.chat = [];
  world.listings = [];
  world.soldIds.clear();
  world.claims.clear();
  world.snapshotAt = 0;
  if (client) { client.close(); client = null; }
  started = false;
  ensureRelay();
  return room;
}

function countPlayers() {
  let n = 0;
  for (const c of world.commanders.values()) if (!c.isNpc) n++;
  return n;
}

/** 心跳：广播自己的注册表条目（含防御战力与护盾状态）。 */
export function publishPresence(snapshot) {
  if (!client) return false;
  lastPresenceBody = snapshot;
  lastPresenceAt = Date.now();
  return client.publish(topic('presence'), JSON.stringify({ t: 'presence', sid: sessionId, ...snapshot }));
}

/** 全服注册表（仅真实玩家；NPC 由 cloud.js 的本地常量提供，与服务端路径同一套合并逻辑）。 */
export function listPlayers() {
  const list = [];
  for (const c of world.commanders.values()) {
    if (c.isNpc) continue;
    list.push({ ...c, lastSeen: c.lastSeen });
  }
  return list;
}

export function listChat() {
  return { messages: world.chat.slice(-CHAT_RETURN) };
}

export function sendChat(profile, text) {
  if (!client) return { ok: false, reason: '中继未就绪' };
  const clean = clip(text, LIMITS.text).trim();
  if (!clean) return { ok: false, reason: '消息内容不可为空' };
  const msg = {
    id: `chat_${sessionId}_${randomToken(3)}`,
    senderId: clip(profile.commanderId, LIMITS.id),
    senderName: clip(profile.callsign, LIMITS.callsign),
    text: clean,
    time: Date.now(),
  };
  pushChat(msg);
  client.publish(topic('chat'), JSON.stringify({ t: 'chat', sid: sessionId, ...msg }));
  return { ok: true, message: msg };
}

export function listListings() {
  return world.listings.slice();
}

export function createListing(profile, { mat, nameCn, qty, priceAscoin }) {
  if (!client) return { ok: false, reason: '中继未就绪' };
  const listing = {
    id: `trade_${sessionId}_${randomToken(3)}`,
    sellerId: clip(profile.commanderId, LIMITS.id),
    sellerCallsign: clip(profile.callsign, LIMITS.callsign) || '匿名商人',
    mat: clip(mat, 24),
    nameCn: clip(nameCn, 24) || clip(mat, 24),
    qty: Math.max(1, toInt(qty, 1)),
    priceAscoin: Math.max(1, toInt(priceAscoin, 1)),
    listedAt: Date.now(),
  };
  pushListing(listing);
  client.publish(topic('market'), JSON.stringify({ t: 'listing', sid: sessionId, listing }));
  return { ok: true, listing };
}

/**
 * 集市成交：发布采购声明 → 等待仲裁窗口 → 按 (时间, claimId) 全序选出唯一赢家。
 * 该规则是确定性的，所有客户端独立计算都会得到同一个赢家；未中签者据此退款。
 */
export async function claimListing(profile, listingId) {
  if (!client) return { ok: false, reason: '中继未就绪' };
  if (world.soldIds.has(listingId)) return { ok: false, reason: '该货单已被其他指挥官采购或已下架' };
  if (!world.listings.some((l) => l.id === listingId)) {
    return { ok: false, reason: '该货单已被其他指挥官采购或已下架' };
  }

  const claimId = `${sessionId}-${randomToken(4)}`;
  const at = Date.now();
  const myClaim = { claimId, buyerId: clip(profile.commanderId, LIMITS.id), at };
  recordClaim(listingId, myClaim);
  client.publish(topic('market'), JSON.stringify({
    t: 'claim',
    sid: sessionId,
    listingId,
    buyerId: myClaim.buyerId,
    buyerCallsign: clip(profile.callsign, LIMITS.callsign),
    claimId,
    at,
  }));

  await sleep(CLAIM_WINDOW_MS);
  if (world.soldIds.has(listingId)) return { ok: false, reason: '该货单已被其他指挥官采购或已下架' };

  const contenders = (world.claims.get(listingId) || []).slice().sort((a, b) => (a.at - b.at) || (a.claimId < b.claimId ? -1 : 1));
  const winner = contenders[0];
  if (winner && winner.claimId !== claimId) {
    return { ok: false, reason: '该货单已被其他指挥官抢先采购' };
  }

  markSold(listingId);
  client.publish(topic('market'), JSON.stringify({
    t: 'sold', sid: sessionId, listingId, buyerId: myClaim.buyerId, claimId, at: Date.now(),
  }));
  return { ok: true, item: { id: listingId } };
}

/** 把一次进攻广播给全服 —— 被攻击方会实时收到战报并获得 12 小时免战力场。 */
export function broadcastRaid(profile, payload) {
  if (!client) return false;
  client.publish(topic('raid'), JSON.stringify({
    t: 'raid',
    sid: sessionId,
    attackerId: clip(profile.commanderId, LIMITS.id),
    attackerCallsign: clip(profile.callsign, LIMITS.callsign),
    ...payload,
  }));
  return true;
}

/** 离开时尽力而为地广播一次（浏览器不保证 beforeunload 一定发出）。 */
export function publishBye() {
  if (!client || !lastPresenceBody) return false;
  return client.publish(topic('presence'), JSON.stringify({ t: 'presence', sid: sessionId, ...lastPresenceBody, leave: true }));
}

export const RELAY_BROKERS = BROKERS;
export const RELAY_CONSTANTS = { PRESENCE_TTL_MS, CLAIM_WINDOW_MS, CHAT_CAP, LISTING_CAP };

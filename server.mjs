// Astrix 真实在线联机核心服务器（Astrix v0.2.0）
// 提供纯原生静态资源托管、全服星际注册表、实时公频广播与跨玩家异步/实时攻防对战 API。
// 零外部 npm 依赖，基于 Node.js 原生 http & crypto 模块构建（快照持久化用内置 fetch）。
//
// 全服状态持久化见下方「全服状态持久化」区块：默认写本地 data/online-state.json，
// 配好 HF_TOKEN + HF_STATE_REPO 后改为把快照提交到私有 Dataset 仓库（HuggingFace 官方
// 推荐的免费持久化方式），容器重建 / 休眠唤醒后仍可恢复全服注册表、公频、集市与信箱。

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)));
const PORT = process.env.PORT ? parseInt(process.env.PORT, 10) : 8080;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
};

// ============================================================================
// 全服在线数据结构（运行时驻留内存；持久化由下方「全服状态持久化」区块负责）
// ============================================================================
const ONLINE_STORE = {
  commanders: new Map(), // commanderId -> { commanderId, callsign, fleetPower, defensePower, homePlanet, goods, shieldUntil, lastSeen }
  chatMessages: [
    { id: 'm_init1', from: '星际深空广播', text: '【星区公频已接通】欢迎全星系开拓指挥官进入实时深空网络。', at: Date.now() - 3600000 },
    { id: 'm_init2', from: '织女四·重工枢纽', text: '【商会公报】大量高纯特种精炼钢已就绪，欢迎各星系船队前来洽谈采购。', at: Date.now() - 1800000 },
  ],
  tradeListings: [
    {
      id: 'trade_init_1',
      sellerId: 'NPC-SRB',
      sellerCallsign: '铁胡子船长 [深空拾荒团]',
      mat: '钛',
      nameCn: '钛合金粗胚',
      qty: 200,
      priceAscoin: 95,
      listedAt: Date.now() - 1200000,
    },
    {
      id: 'trade_init_2',
      sellerId: 'NPC-CEN',
      sellerCallsign: '阿加莎女执政官 [极光帝国]',
      mat: '硅',
      nameCn: '高纯硅晶',
      qty: 150,
      priceAscoin: 140,
      listedAt: Date.now() - 600000,
    },
    {
      id: 'trade_init_3',
      sellerId: 'NPC-VG4',
      sellerCallsign: '维加斯督军 [泛星际商会]',
      mat: '钢',
      nameCn: '精炼特种钢',
      qty: 300,
      priceAscoin: 80,
      listedAt: Date.now() - 300000,
    },
  ],
  inbox: new Map(), // commanderId -> [ { id, type, title, body, details, at, read } ]
};

// 预设 NPC 势力星球
const NPC_SYSTEMS = [
  { commanderId: 'NPC-VG4', callsign: '维加斯督军', faction: '泛星际商会', planetCode: 'vega4', planetNameCn: '织女四·重工枢纽', defensePower: 2600, distanceLy: 2.4, goods: [{ mat: '钢', nameCn: '精炼钢', priceAscoin: 85, stock: 2500 }] },
  { commanderId: 'NPC-SRB', callsign: '铁胡子船长', faction: '深空拾荒团', planetCode: 'sirius_b', planetNameCn: '天狼B·废弃矿业站', defensePower: 580, distanceLy: 1.2, goods: [{ mat: '铁', nameCn: '纯铁', priceAscoin: 35, stock: 8000 }] },
  { commanderId: 'NPC-CEN', callsign: '阿加莎女执政官', faction: '极光帝国', planetCode: 'centauri_lab', planetNameCn: '半人马α·科研前哨', defensePower: 1850, distanceLy: 3.6, goods: [{ mat: '硅', nameCn: '高纯硅晶', priceAscoin: 145, stock: 2200 }] },
  { commanderId: 'NPC-RGL', callsign: '老港督·雷诺', faction: '开拓者联合', planetCode: 'rigel_port', planetNameCn: '参宿七·能源补给港', defensePower: 3400, distanceLy: 4.8, goods: [{ mat: '甲烷', nameCn: '液化甲烷', priceAscoin: 30, stock: 12000 }] },
];

for (const npc of NPC_SYSTEMS) {
  ONLINE_STORE.commanders.set(npc.commanderId, {
    ...npc,
    isNpc: true,
    population: 3000,
    shieldUntil: 0,
    lastSeen: Date.now() + 864000000,
  });
}

// ============================================================================
// 全服状态持久化
// ----------------------------------------------------------------------------
// 为什么需要它：HuggingFace 免费层的容器磁盘是**临时**的——官方文档原文是
// 「its content will be lost if your Space restarts or is stopped」。而 ONLINE_STORE
// 只活在进程内存里，于是下面两件事都会把全服数据清零：
//   ① 免费层 48 小时无访问自动休眠，唤醒时容器从镜像冷启动；
//   ② 每次 git push 触发的重新构建。
// 官方为此给免费层指了两条路：升级付费持久盘，或**用一个 Dataset 仓库当数据存储**。
// 这里实现后者（不花钱、不动架构）。
//
// 三层后端，按配置自动选择，缺配置也绝不报错（只是退化为不持久）：
//   hf     —— 配好 HF_TOKEN + HF_STATE_REPO 时，快照提交到私有 Dataset 仓库。
//             快照独立于 Space 生命周期，重建 / 休眠唤醒都能恢复。
//   file   —— 未配 HF 时写本地 data/online-state.json（可用 ASTRIX_STATE_FILE 改路径）。
//             容器内同样是临时的，但本地与局域网部署是真持久，也覆盖「同一容器内
//             进程重启、盘还没被清」的场景。
//   memory —— ASTRIX_STATE_DISABLE=1 时完全不落盘，回到旧行为。
//
// 落盘策略：变更打脏标记 → 节流合并 → 定时刷盘；进程收到 SIGINT/SIGTERM 时立即刷盘
// （HF 休眠前会发 SIGTERM，这一步保住最后一段变更）。
// ============================================================================
const STATE_VERSION = 1;
const STATE_MAX_AGE_MS = 7 * 24 * 3600 * 1000; // 超过 7 天的玩家记录 / 公频 / 信箱不再恢复
const SNAPSHOT_NAME = 'online-state.json';
const STATE_FILE = process.env.ASTRIX_STATE_FILE
  ? path.resolve(process.env.ASTRIX_STATE_FILE)
  : path.join(ROOT, 'data', SNAPSHOT_NAME);
const HF_TOKEN = String(process.env.HF_TOKEN || '').trim();
const HF_STATE_REPO = String(process.env.HF_STATE_REPO || '').trim();
const HF_ENDPOINT = String(process.env.HF_ENDPOINT || 'https://huggingface.co').replace(/\/+$/, '');

// 种子数据的副本：用于「哪些是代码预置、哪些是玩家产生的」判定。
const SEED_CHAT_MESSAGES = ONLINE_STORE.chatMessages.map((m) => ({ ...m }));
const SEED_TRADE_LISTINGS = ONLINE_STORE.tradeListings.map((l) => ({ ...l }));
const SEED_LISTING_IDS = new Set(SEED_TRADE_LISTINGS.map((l) => l.id));

const stateStore = {
  backend: 'memory',
  dirty: false,
  saving: false,
  restored: null,
  lastSavedAt: 0,
  lastError: '',
  saveDelayMs: Infinity,
  timer: null,
  flushTimer: null,
  flushEveryMs: 120000,
};

function sanitizeStateError(e) {
  let s = String((e && e.message) || e || '未知错误');
  s = s.replace(/hf_[A-Za-z0-9]{6,}/g, 'hf_***');
  s = s.replace(/Bearer\s+[A-Za-z0-9._-]{6,}/gi, 'Bearer ***');
  return s.slice(0, 200);
}

function initStateBackend() {
  if (process.env.ASTRIX_STATE_DISABLE === '1') {
    stateStore.backend = 'memory';
    stateStore.saveDelayMs = Infinity;
    return;
  }
  if (HF_TOKEN && HF_STATE_REPO.includes('/')) {
    stateStore.backend = 'hf';
    stateStore.saveDelayMs = 60000; // 提交上游仓库需要节流，避免刷爆 Hub 提交历史
    return;
  }
  if (HF_TOKEN || HF_STATE_REPO) {
    console.warn('[state] HF_TOKEN 与 HF_STATE_REPO 需成对配置（后者形如 "用户名/仓库名"），本次退化为本地文件后端。');
  }
  stateStore.backend = 'file';
  stateStore.saveDelayMs = 2500;
}

function describeStateBackend() {
  if (stateStore.backend === 'hf') return `huggingface 数据集快照 (${HF_STATE_REPO})`;
  if (stateStore.backend === 'file') return `本地文件 (${path.relative(ROOT, STATE_FILE) || STATE_FILE})`;
  return '已关闭（纯内存，重启即清零）';
}

// ---- 快照序列化 / 反序列化 ----------------------------------------------------

// 会被写进快照的字段指纹。刻意不含 lastSeen —— 它每次心跳都变，不代表实质变化。
function persistableSignature(c) {
  return JSON.stringify([
    c.callsign, c.planetCode, c.planetNameCn, c.faction, c.population,
    c.defensePower, c.fleetPower, c.homePlanet, c.shieldUntil, c.goods || [],
  ]);
}

function serializeSnapshot() {
  const commanders = [];
  for (const c of ONLINE_STORE.commanders.values()) {
    if (!c.isNpc) commanders.push(c); // NPC 由代码预置，不入快照
  }
  const tradeListings = ONLINE_STORE.tradeListings.filter((l) => !SEED_LISTING_IDS.has(l.id));
  const consumedSeedListings = [...SEED_LISTING_IDS].filter(
    (id) => !ONLINE_STORE.tradeListings.some((l) => l.id === id)
  );
  return {
    version: STATE_VERSION,
    savedAt: Date.now(),
    commanders,
    chatMessages: ONLINE_STORE.chatMessages.filter((m) => !String(m.id).startsWith('m_init')),
    tradeListings,
    consumedSeedListings, // 已售出的 NPC 常驻货架，重启后不再复活
    inbox: Object.fromEntries(ONLINE_STORE.inbox),
  };
}

function applySnapshot(snap) {
  const restored = { commanders: 0, chat: 0, listings: 0, inbox: 0, seedSoldOut: 0 };
  if (!snap || typeof snap !== 'object') return restored;
  if (snap.version !== STATE_VERSION) {
    console.warn(`[state] 快照版本 ${snap.version} 与当前 ${STATE_VERSION} 不一致，仍按当前格式尽力恢复。`);
  }
  const now = Date.now();

  if (Array.isArray(snap.commanders)) {
    for (const c of snap.commanders) {
      if (!c || !c.commanderId || c.isNpc) continue;
      if (now - (Number(c.lastSeen) || 0) > STATE_MAX_AGE_MS) continue;
      ONLINE_STORE.commanders.set(c.commanderId, { ...c, isNpc: false });
      restored.commanders++;
    }
  }

  if (Array.isArray(snap.chatMessages)) {
    const kept = snap.chatMessages.filter((m) => m && m.text && now - (Number(m.at) || 0) <= STATE_MAX_AGE_MS);
    ONLINE_STORE.chatMessages = SEED_CHAT_MESSAGES.concat(kept).slice(-80);
    restored.chat = kept.length;
  }

  if (Array.isArray(snap.tradeListings)) {
    const consumed = new Set(Array.isArray(snap.consumedSeedListings) ? snap.consumedSeedListings : []);
    const shelves = SEED_TRADE_LISTINGS.filter((l) => !consumed.has(l.id));
    const playerListings = snap.tradeListings.filter((l) => l && l.id && !SEED_LISTING_IDS.has(l.id));
    ONLINE_STORE.tradeListings = shelves.concat(playerListings).slice(0, 50);
    restored.listings = playerListings.length;
    restored.seedSoldOut = consumed.size;
  }

  if (snap.inbox && typeof snap.inbox === 'object') {
    for (const [cid, list] of Object.entries(snap.inbox)) {
      if (!Array.isArray(list)) continue;
      const fresh = list.filter((m) => m && now - (Number(m.at) || 0) <= STATE_MAX_AGE_MS);
      if (fresh.length) {
        ONLINE_STORE.inbox.set(cid, fresh.slice(0, 30));
        restored.inbox += fresh.length;
      }
    }
  }
  return restored;
}

// ---- 本地文件后端 -------------------------------------------------------------

function writeStateFile(text) {
  fs.mkdirSync(path.dirname(STATE_FILE), { recursive: true });
  const tmp = STATE_FILE + '.tmp';
  fs.writeFileSync(tmp, text, 'utf8');
  fs.renameSync(tmp, STATE_FILE); // 原子替换：避免进程被杀时留下半截 JSON
}

function readStateFile() {
  try {
    if (fs.existsSync(STATE_FILE)) return fs.readFileSync(STATE_FILE, 'utf8');
  } catch (e) {
    console.error(`[state] 读取本地快照失败: ${sanitizeStateError(e)}`);
  }
  return null;
}

// ---- HuggingFace 数据集后端 ---------------------------------------------------
// 读取：GET  /datasets/{repo}/resolve/main/online-state.json
// 写入：POST /api/datasets/{repo}/commit/main（NDJSON：header 行 + file 行，内容 base64）
// 仓库不存在时自动创建私有 Dataset（POST /api/repos/create）。

function hfHeaders(extra) {
  return { Authorization: `Bearer ${HF_TOKEN}`, ...(extra || {}) };
}

// 快照仓库不可达时**绝不能拖住启动**：给所有上游请求加超时，超时按保存/读取失败处理
// （服务照常以内存态起服，在线玩法不受影响，只是这次没能持久化）。
function hfSignal(ms) {
  return typeof AbortSignal !== 'undefined' && AbortSignal.timeout ? AbortSignal.timeout(ms) : undefined;
}

function hfCommitBody(text) {
  return [
    JSON.stringify({ key: 'header', value: { summary: `astrix online state @ ${new Date().toISOString()}` } }),
    JSON.stringify({
      key: 'file',
      value: { path: SNAPSHOT_NAME, content: Buffer.from(text, 'utf8').toString('base64'), encoding: 'base64' },
    }),
  ].join('\n');
}

async function pullSnapshotFromHub() {
  const res = await fetch(`${HF_ENDPOINT}/datasets/${HF_STATE_REPO}/resolve/main/${SNAPSHOT_NAME}`, {
    headers: hfHeaders(),
    signal: hfSignal(15000),
  });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`读取快照仓库失败 HTTP ${res.status}`);
  return await res.text();
}

async function ensureHubRepo() {
  const res = await fetch(`${HF_ENDPOINT}/api/repos/create`, {
    method: 'POST',
    headers: hfHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify({ type: 'dataset', name: HF_STATE_REPO, private: true }),
    signal: hfSignal(15000),
  });
  if (!res.ok && res.status !== 409) {
    const detail = await res.text().catch(() => '');
    throw new Error(`自动创建快照仓库失败 HTTP ${res.status}${detail ? ' ' + detail : ''}`);
  }
}

async function pushSnapshotToHub(text) {
  const url = `${HF_ENDPOINT}/api/datasets/${HF_STATE_REPO}/commit/main`;
  const options = () => ({
    method: 'POST',
    headers: hfHeaders({ 'Content-Type': 'application/x-ndjson', Accept: 'application/json' }),
    body: hfCommitBody(text),
    signal: hfSignal(25000),
  });
  let res = await fetch(url, options());
  if (res.status === 404) {
    await ensureHubRepo(); // 首次运行：仓库还不存在，自动建一个再重试
    res = await fetch(url, options());
  }
  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    throw new Error(`提交快照失败 HTTP ${res.status}${detail ? ' ' + detail : ''}`);
  }
}

// ---- 保存 / 载入编排 ----------------------------------------------------------

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function armSave(delayMs, reason) {
  if (stateStore.timer || stateStore.backend === 'memory') return;
  stateStore.timer = setTimeout(() => {
    stateStore.timer = null;
    saveStateNow(reason);
  }, delayMs);
  if (stateStore.timer.unref) stateStore.timer.unref();
}

async function saveStateNow(reason) {
  if (stateStore.backend === 'memory') return false;
  if (stateStore.saving) {
    // 已有保存在进行中。别把这次的变更丢掉——补一次调度，等前一次收尾后再存。
    armSave(2000, 'retry-after-busy');
    return false;
  }
  if (!stateStore.dirty) return false;
  stateStore.saving = true;
  const text = JSON.stringify(serializeSnapshot());
  try {
    if (stateStore.backend === 'file') writeStateFile(text);
    else await pushSnapshotToHub(text);
    stateStore.dirty = false;
    stateStore.lastSavedAt = Date.now();
    stateStore.lastError = '';
    console.log(`[state] 快照已保存 (${stateStore.backend}/${reason}) ${text.length} 字节`);
    return true;
  } catch (e) {
    stateStore.lastError = sanitizeStateError(e);
    console.error(`[state] 快照保存失败 (${stateStore.backend}/${reason}): ${stateStore.lastError}`);
    armSave(30000, 'retry-after-error'); // 失败后退避重试，脏标记保留
    return false;
  } finally {
    stateStore.saving = false;
  }
}

function markStateDirty() {
  stateStore.dirty = true;
  armSave(stateStore.saveDelayMs, 'throttled');
}

async function loadPersistedState() {
  let raw = null;
  try {
    if (stateStore.backend === 'hf') raw = await pullSnapshotFromHub();
    else if (stateStore.backend === 'file') raw = readStateFile();
  } catch (e) {
    stateStore.lastError = sanitizeStateError(e);
    console.error(`[state] 读取快照失败 (${stateStore.backend}): ${stateStore.lastError}`);
    return false;
  }
  if (!raw) {
    console.log(`[state] 未发现历史快照（${stateStore.backend}），以初始世界开局。`);
    return false;
  }
  let snap = null;
  try {
    snap = JSON.parse(raw);
  } catch (e) {
    stateStore.lastError = '快照 JSON 解析失败';
    console.error('[state] 快照 JSON 解析失败，忽略并按初始世界开局。');
    return false;
  }
  const r = applySnapshot(snap);
  stateStore.restored = r;
  const at = snap.savedAt ? new Date(snap.savedAt).toLocaleString('zh-CN', { hour12: false }) : '未知时间';
  console.log(`[state] 已恢复快照（保存于 ${at}）：玩家 ${r.commanders} · 公频 ${r.chat} · 挂单 ${r.listings} · 信箱 ${r.inbox} 条`);
  return true;
}

function startStateAutosave() {
  if (stateStore.backend === 'memory') return;
  stateStore.flushTimer = setInterval(() => { saveStateNow('periodic'); }, stateStore.flushEveryMs);
  if (stateStore.flushTimer.unref) stateStore.flushTimer.unref();

  // 正常退出时的同步兜底（exit 处理器里不能有异步操作，所以只对本地文件后端有效）
  process.on('exit', () => {
    if (stateStore.backend !== 'file' || !stateStore.dirty) return;
    try {
      writeStateFile(JSON.stringify(serializeSnapshot()));
      stateStore.dirty = false;
    } catch (e) { /* 退出路径上无法再补救 */ }
  });

  // Linux（含 HuggingFace 容器）上休眠 / 重建前会发 SIGTERM，这一次刷盘能保住最后一段变更。
  // 注意：Windows 上 SIGTERM 是无条件终止、不会执行处理器，所以周期保存才是主路径。
  const shutdown = async () => {
    if (stateStore.timer) { clearTimeout(stateStore.timer); stateStore.timer = null; }
    const hardExit = setTimeout(() => process.exit(0), 8000);
    if (hardExit.unref) hardExit.unref();
    for (let i = 0; i < 60 && stateStore.saving; i++) await sleep(100); // 等在途保存收尾
    await saveStateNow('shutdown');
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

function parseBody(req) {
  return new Promise((resolve) => {
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => {
      try { resolve(JSON.parse(body || '{}')); } catch (e) { resolve({}); }
    });
  });
}

function jsonRes(res, obj, status = 200) {
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  });
  res.end(JSON.stringify(obj));
  return true;
}

// ============================================================================
// HTTP API 路由器
// ============================================================================
async function handleApi(req, res, pathname) {
  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    });
    res.end();
    return true;
  }

  // 1. 指挥官心跳与状态同步
  if (pathname === '/api/online/heartbeat' && req.method === 'POST') {
    const data = await parseBody(req);
    const cid = data.commanderId;
    if (!cid) return jsonRes(res, { ok: false, reason: '缺少 commanderId' }, 400);

    const existing = ONLINE_STORE.commanders.get(cid) || {};
    const prevSig = existing.commanderId ? persistableSignature(existing) : '';
    const updated = {
      ...existing,
      ...data,
      isNpc: false,
      lastSeen: Date.now(),
    };
    ONLINE_STORE.commanders.set(cid, updated);
    // 心跳每 10 秒一次，但其中只有 lastSeen 在变。只有「会被写进快照的字段」真的变了
    // 才打脏标记，否则会以心跳频率无谓刷盘（走 HF 后端时就是无谓刷提交历史）。
    if (persistableSignature(updated) !== prevSig) markStateDirty();
    return jsonRes(res, { ok: true, onlineCount: ONLINE_STORE.commanders.size });
  }

  // 2. 获取全服星系注册表（真实在线玩家 + NPC 星球）
  if (pathname === '/api/online/commanders' && req.method === 'GET') {
    const now = Date.now();
    const list = [];
    for (const [id, c] of ONLINE_STORE.commanders) {
      // 过滤掉超过 15 分钟未上线的玩家
      if (c.isNpc || (now - (c.lastSeen || 0) < 15 * 60 * 1000)) {
        list.push({
          id: 'online_' + id,
          isNpc: !!c.isNpc,
          commanderId: c.commanderId,
          callsign: c.callsign || id,
          planetCode: c.planetCode || 'syl',
          planetNameCn: c.planetNameCn || '殖民母星',
          faction: c.faction || '自由开拓同盟',
          factionColor: c.factionColor || '#7cd7ff',
          population: c.population || 100,
          defensePower: c.defensePower || 500,
          shieldUntil: c.shieldUntil || 0,
          distanceLy: c.distanceLy || 1.8,
          goods: c.goods || [{ mat: '铁', nameCn: '纯铁', priceAscoin: 30, stock: 500 }],
          intel: c.intel || (c.isNpc ? 'NPC 定居点' : '真实在线开拓指挥官'),
          lastSeen: c.lastSeen,
        });
      }
    }
    return jsonRes(res, { ok: true, list, total: list.length });
  }

  // 3. 星区实时公频聊天
  if (pathname === '/api/online/chat' && req.method === 'GET') {
    return jsonRes(res, { ok: true, messages: ONLINE_STORE.chatMessages.slice(-40) });
  }
  if (pathname === '/api/online/chat' && req.method === 'POST') {
    const data = await parseBody(req);
    const text = String(data.text || '').trim();
    if (!text) return jsonRes(res, { ok: false, reason: '消息内容不可为空' }, 400);

    const msg = {
      id: 'chat_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 6),
      from: data.callsign || data.commanderId || '未知指挥官',
      commanderId: data.commanderId,
      text: text.slice(0, 200),
      at: Date.now(),
    };
    ONLINE_STORE.chatMessages.push(msg);
    if (ONLINE_STORE.chatMessages.length > 80) ONLINE_STORE.chatMessages.shift();
    markStateDirty();
    return jsonRes(res, { ok: true, message: msg });
  }

  // 4. 远程战报收件箱
  if (pathname === '/api/online/inbox' && req.method === 'GET') {
    const urlObj = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
    const cid = urlObj.searchParams.get('commanderId');
    if (!cid) return jsonRes(res, { ok: false, reason: '缺少 commanderId' }, 400);
    const msgs = ONLINE_STORE.inbox.get(cid) || [];
    return jsonRes(res, { ok: true, list: msgs });
  }

  // 5. 对战突击裁决与战报实时送达
  if (pathname === '/api/online/raid' && req.method === 'POST') {
    const data = await parseBody(req);
    const { attackerId, attackerCallsign, targetId, fleetPower } = data;
    const target = ONLINE_STORE.commanders.get(targetId);
    if (!target) return jsonRes(res, { ok: false, reason: '未找到攻击目标' }, 404);

    const now = Date.now();
    if (target.shieldUntil && target.shieldUntil > now) {
      return jsonRes(res, { ok: false, reason: '对方处于免战护盾保护期内，不可进攻' }, 403);
    }

    const myPower = Number(fleetPower) || 500;
    const targetDef = Number(target.defensePower) || 800;
    const winRate = Math.min(0.92, Math.max(0.12, myPower / (myPower + targetDef)));
    const win = Math.random() < winRate;

    // 若胜利，目标获得 12 小时护盾
    if (win) {
      target.shieldUntil = now + 12 * 3600 * 1000;
    }

    // 给防守方塞入一封战报回执
    const victimInbox = ONLINE_STORE.inbox.get(targetId) || [];
    victimInbox.unshift({
      id: 'raid_' + Date.now().toString(36),
      type: win ? 'defense_loss' : 'defense_win',
      title: win ? `⚠️【空袭警报】母星遭遇 ${attackerCallsign} 突击` : `🛡️【防线告捷】成功拦截 ${attackerCallsign} 的进攻`,
      body: win ? `敌方突击舰队（战力 ${myPower}）突破了母星防线，掠夺了少量工业物资。已紧急激活 12 小时免战力场保护。` : `敌突击舰队（战力 ${myPower}）遭到我行星要塞与要塞防空火力的全域压制，已败退脱离。`,
      at: now,
      read: false,
    });
    ONLINE_STORE.inbox.set(targetId, victimInbox.slice(0, 30));
    markStateDirty();

    return jsonRes(res, {
      ok: true,
      win,
      myPower,
      targetDef,
      shieldUntil: target.shieldUntil,
      msg: win ? '远征突击取得大捷！' : '攻势遭遇敌方顽强抵抗，已被击退。',
    });
  }

  // 6. 全星区跨玩家物资交易市场
  if (pathname === '/api/online/market' && req.method === 'GET') {
    return jsonRes(res, { ok: true, listings: ONLINE_STORE.tradeListings });
  }
  if (pathname === '/api/online/market/list' && req.method === 'POST') {
    const data = await parseBody(req);
    const { sellerId, sellerCallsign, mat, nameCn, qty, priceAscoin } = data;
    if (!sellerId || !mat || !qty || !priceAscoin) {
      return jsonRes(res, { ok: false, reason: '缺少必填字段' }, 400);
    }
    const listing = {
      id: 'trade_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 6),
      sellerId,
      sellerCallsign: sellerCallsign || '匿名商人',
      mat,
      nameCn: nameCn || mat,
      qty: Math.max(1, parseInt(qty, 10)),
      priceAscoin: Math.max(1, parseInt(priceAscoin, 10)),
      listedAt: Date.now(),
    };
    ONLINE_STORE.tradeListings.unshift(listing);
    if (ONLINE_STORE.tradeListings.length > 50) ONLINE_STORE.tradeListings.pop();
    markStateDirty();
    return jsonRes(res, { ok: true, listing });
  }
  if (pathname === '/api/online/market/buy' && req.method === 'POST') {
    const data = await parseBody(req);
    const { buyerId, buyerCallsign, listingId } = data;
    const idx = ONLINE_STORE.tradeListings.findIndex((item) => item.id === listingId);
    if (idx === -1) {
      return jsonRes(res, { ok: false, reason: '该货单已被其他指挥官采购或已下架' }, 404);
    }
    const item = ONLINE_STORE.tradeListings.splice(idx, 1)[0];
    
    // 给卖家发送货款结算战报/信件
    const sellerInbox = ONLINE_STORE.inbox.get(item.sellerId) || [];
    const totalEarn = item.priceAscoin * item.qty;
    sellerInbox.unshift({
      id: 'earn_' + Date.now().toString(36),
      type: 'trade_earn',
      title: `💰【贸易交割】你的 ${item.nameCn} 已售出！`,
      body: `指挥官 ${buyerCallsign || buyerId} 采购了你挂售的 ${item.nameCn} ×${item.qty}，结算货款 +${totalEarn} Ascoin！`,
      at: Date.now(),
      read: false,
    });
    ONLINE_STORE.inbox.set(item.sellerId, sellerInbox.slice(0, 30));
    markStateDirty();

    return jsonRes(res, { ok: true, item, msg: '成功交割，物资已移交星际物流！' });
  }

  // 7. 持久化自检与运行状态（只读，用于确认快照后端是否生效）
  if (pathname === '/api/online/status' && req.method === 'GET') {
    let players = 0;
    for (const c of ONLINE_STORE.commanders.values()) if (!c.isNpc) players++;
    return jsonRes(res, {
      ok: true,
      state: {
        backend: stateStore.backend,
        backendDetail: describeStateBackend(),
        restored: !!stateStore.restored,
        restoredCounts: stateStore.restored,
        dirty: stateStore.dirty,
        lastSavedAt: stateStore.lastSavedAt,
        lastError: stateStore.lastError,
        snapshotFile: stateStore.backend === 'file' ? path.relative(ROOT, STATE_FILE) : SNAPSHOT_NAME,
      },
      counts: {
        commandersTotal: ONLINE_STORE.commanders.size,
        players,
        chatMessages: ONLINE_STORE.chatMessages.length,
        tradeListings: ONLINE_STORE.tradeListings.length,
        inboxOwners: ONLINE_STORE.inbox.size,
      },
    });
  }

  return false;
}

// ============================================================================
// 静态文件与服务器主干
// ============================================================================
const server = http.createServer(async (req, res) => {
  const urlObj = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const pathname = urlObj.pathname;

  // 拦截 API
  if (pathname.startsWith('/api/')) {
    const handled = await handleApi(req, res, pathname);
    if (!handled) {
      jsonRes(res, { ok: false, error: 'API endpoint not found' }, 404);
    }
    return;
  }

  // 静态文件托管
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');

  let filePath = pathname === '/' ? '/index.html' : pathname;
  const fullPath = path.join(ROOT, decodeURIComponent(filePath));

  if (!fullPath.startsWith(ROOT) || !fs.existsSync(fullPath) || fs.statSync(fullPath).isDirectory()) {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('404 Not Found');
    return;
  }

  const ext = path.extname(fullPath);
  res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
  fs.createReadStream(fullPath).pipe(res);
});

// 先选定持久化后端并尝试恢复上一次的全服快照，再开始监听（避免首次请求打到空世界）
initStateBackend();
const _stateRestored = await loadPersistedState();
startStateAutosave();

server.listen(PORT, '0.0.0.0', () => {
  console.log(`=======================================================`);
  console.log(` ASTRIX REAL-TIME MULTIPLAYER SERVER ONLINE            `);
  console.log(` Port: ${PORT}                                         `);
  console.log(` Web App: http://localhost:${PORT}/                   `);
  console.log(` API Endpoint: http://localhost:${PORT}/api/online/    `);
  console.log(` 状态持久化: ${describeStateBackend()}`);
  if (stateStore.lastError) console.log(` 持久化告警: ${stateStore.lastError}`);
  else if (_stateRestored) console.log(` 已从快照恢复全服状态                                  `);
  console.log(`=======================================================`);
});

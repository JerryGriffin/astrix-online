// Astrix 真实在线联机核心服务器（Astrix v0.2.0）
// 提供纯原生静态资源托管、全服星际注册表、实时公频广播与跨玩家异步/实时攻防对战 API。
// 零外部 npm 依赖，基于 Node.js 原生 http & crypto 模块构建。

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
// 全服在线数据结构（内存持久化，定期落盘）
// ============================================================================
const ONLINE_STORE = {
  commanders: new Map(), // commanderId -> { commanderId, callsign, fleetPower, defensePower, homePlanet, goods, shieldUntil, lastSeen }
  chatMessages: [
    { id: 'm_init1', from: '星际深空广播', text: '【星区公频已接通】欢迎全星系开拓指挥官进入实时深空网络。', at: Date.now() - 3600000 },
    { id: 'm_init2', from: '织女四·重工枢纽', text: '【商会公报】大量高纯特种精炼钢已就绪，欢迎各星系船队前来洽谈采购。', at: Date.now() - 1800000 },
  ],
  tradeListings: [],
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
    const updated = {
      ...existing,
      ...data,
      isNpc: false,
      lastSeen: Date.now(),
    };
    ONLINE_STORE.commanders.set(cid, updated);
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

    return jsonRes(res, {
      ok: true,
      win,
      myPower,
      targetDef,
      shieldUntil: target.shieldUntil,
      msg: win ? '远征突击取得大捷！' : '攻势遭遇敌方顽强抵抗，已被击退。',
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

server.listen(PORT, '0.0.0.0', () => {
  console.log(`=======================================================`);
  console.log(` ASTRIX REAL-TIME MULTIPLAYER SERVER ONLINE            `);
  console.log(` Port: ${PORT}                                         `);
  console.log(` Web App: http://localhost:${PORT}/                   `);
  console.log(` API Endpoint: http://localhost:${PORT}/api/online/    `);
  console.log(`=======================================================`);
});

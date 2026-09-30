// docs/selfcheck_server_surface.mjs
// 服务端对外暴露面自检
// ----------------------------------------------------------------------------
// 为什么要有这个探针：要把 server.mjs 放到公网（免费 Node 单端口托管 / 局域网联机），
// 它就是一台「谁都能访问的文件服务器」。此前静态托管是「命中即发」——ROOT 下任何文件
// 都能下载。实测在局域网/公网可直接取到：
//   /.git/config            内含带内嵌凭据的 remote URL（令牌泄漏，最严重）
//   /.workbuddy/memory/*.md 项目内部记忆
//   /server.mjs /docs/*     服务端源码与内部文档
//   另一处更致命的缺陷：GET /% 会让 decodeURIComponent 抛 URIError，处理器是 async 的，
//   异常升级为「未处理的 Promise 拒绝」，Node 22 默认据此终止进程 ⇒ **单请求远程 DoS**。
// 两处都已在 server.mjs 中修复（静态资源白名单 + 请求级 try/catch）。本探针把这些
// 结论钉死，防止以后回退。
//
// 覆盖：
//   A. 客户端必需资源仍可访问（白名单没有误伤游戏本体）
//   B. 敏感/内部文件一律 404，且不得泄漏任何凭据
//   C. 路径穿越的各种编码变体一律 404
//   D. 畸形请求不再杀死进程，且进程守卫未被触发（说明没有逃逸的未处理异常）
//   E. 容器契约成立：PORT 注入生效、与工作目录无关、同源提供静态资源与 API
//   F. 联机链路读写闭环仍完整（心跳/注册表/公频/集市/攻防/信箱/状态）
//
// 用法：node docs/selfcheck_server_surface.mjs
// 说明：不触碰真实的 data/online-state.json（用 ASTRIX_STATE_FILE 指向临时文件），
//       不占用 8080（用 8139），并以临时目录为工作目录启动以顺带验证 cwd 无关性。

import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = Number(process.env.PROBE_PORT || 8139);
const BASE = `http://127.0.0.1:${PORT}`;
const STATE_FILE = path.join(os.tmpdir(), `astrix-surface-probe-${process.pid}.json`);

const errors = [];
let passed = 0;
function expect(cond, label, extra) {
  if (cond) {
    passed += 1;
    console.log('  ok  ' + label);
  } else {
    const msg = label + (extra === undefined ? '' : ' → ' + JSON.stringify(extra));
    errors.push(msg);
    console.log('  x   ' + msg);
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function startServer() {
  const proc = spawn(process.execPath, [path.join(ROOT, 'server.mjs')], {
    // 故意用临时目录当工作目录：验证资源根由脚本自身位置解析，不依赖 cwd。
    cwd: os.tmpdir(),
    env: { ...process.env, PORT: String(PORT), ASTRIX_STATE_FILE: STATE_FILE },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let log = '';
  proc.stdout.on('data', (d) => { log += d.toString(); });
  proc.stderr.on('data', (d) => { log += d.toString(); });
  return { proc, log: () => log };
}

async function waitReady(timeoutMs = 12000) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    try {
      const r = await fetch(BASE + '/index.html');
      await r.arrayBuffer();
      if (r.ok) return true;
    } catch (e) { /* 还没起来 */ }
    await sleep(120);
  }
  return false;
}

function stopServer(proc, timeoutMs = 8000) {
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      try { proc.kill('SIGKILL'); } catch (e) {}
      resolve('forced');
    }, timeoutMs);
    proc.once('exit', () => { clearTimeout(timer); resolve('exited'); });
    try { proc.kill('SIGTERM'); } catch (e) { clearTimeout(timer); resolve('failed'); }
  });
}

async function status(p) {
  try {
    const r = await fetch(BASE + p);
    const text = await r.text();
    return { status: r.status, text, type: r.headers.get('content-type') || '', nosniff: r.headers.get('x-content-type-options') || '' };
  } catch (e) {
    return { status: 0, text: '', type: '', nosniff: '', err: String((e && e.message) || e) };
  }
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

// 公开站点绝不该出现的一组路径。
const SECRET_PATHS = [
  '/.git/config',
  '/.gitignore',
  '/.dockerignore',
  '/.workbuddy/memory/MEMORY.md',
  '/.workbuddy/memory/2026-09-30.md',
  '/.astrix_app.genie',
  '/config/applications.yaml',
  '/server.mjs',
  '/serve.mjs',
  '/launch.mjs',
  '/package.json',
  '/Dockerfile',
  '/README.md',
  '/start_online.bat',
  '/docs/DECISIONS.md',
  '/docs/_v005.log',
  '/docs/selfcheck_online_state.mjs',
  '/data/online-state.json',
];

// 路径穿越的常见编码变体。
const TRAVERSAL_PATHS = [
  '/js/../../.git/config',
  '/js/%2e%2e%2f%2e%2e%2f.git/config',
  '/js/..%2f..%2f.git%2fconfig',
  '/js/%2e%2e/%2e%2e/.git/config',
  '/js/..\\..\\.git\\config',
  '/./js/../../server.mjs',
  '/css/../../../etc/passwd',
  '/index.html%00.txt',
];

// 曾经能一击打挂进程的畸形请求。
// 注意：必须包含**白名单内**的畸形编码（/js/% 一类）。否则请求会在白名单那一步就被拒，
// 根本走不到 safeDecodePath，等于没测到真正的修复点。
const MALFORMED_PATHS = [
  '/%',
  '/%E4%B8',
  '/%zz',
  '/%00',
  '/js/%',
  '/js/%E4',
  '/js/%zz',
  '/css/%',
  '/js/%C0%AE%C0%AE/',
  '/' + 'a'.repeat(4000),
];

const instance = startServer();

try {
  console.log('-- 阶段 A/B：启动与暴露面 --');
  expect(await waitReady(), `服务已在 ${PORT} 端口就绪（以临时目录为 cwd 启动）`);

  // ---- A. 客户端必需资源 ----
  for (const [p, ct] of [
    ['/', 'text/html'],
    ['/index.html', 'text/html'],
    ['/js/main.js', 'text/javascript'],
    ['/js/version.js', 'text/javascript'],
    ['/js/core/cloud.js', 'text/javascript'],
    ['/css/base.css', 'text/css'],
  ]) {
    const r = await status(p);
    expect(r.status === 200, `客户端资源可访问 ${p}`, { status: r.status, err: r.err });
    expect(r.type.startsWith(ct), `${p} 的 Content-Type 正确`, r.type);
  }
  const jsRes = await fetch(BASE + '/js/main.js');
  await jsRes.arrayBuffer();
  expect(jsRes.headers.get('x-content-type-options') === 'nosniff', '静态响应带 X-Content-Type-Options: nosniff');

  // ---- B. 敏感文件 ----
  for (const p of SECRET_PATHS) {
    const r = await status(p);
    expect(r.status === 404, `敏感路径被拒绝 ${p}`, { status: r.status, size: r.text.length });
  }

  // 凭据泄漏的硬判定：任何响应里都不该出现 `https://user:token@`。
  let leaked = 0;
  for (const p of ['/.git/config', '/.git/config?x=1', '/js/../../.git/config', '/js/%2e%2e%2f%2e%2e%2f.git%2fconfig']) {
    const r = await status(p);
    if (/https:\/\/[^/\s]+@/.test(r.text)) leaked += 1;
  }
  expect(leaked === 0, '任何响应中都不含内嵌凭据的 URL（令牌未泄漏）', { leaked });

  // ---- C. 路径穿越 ----
  for (const p of TRAVERSAL_PATHS) {
    const r = await status(p);
    expect(r.status === 404, `路径穿越变体被拒绝 ${p}`, { status: r.status, size: r.text.length });
  }

  // ---- D. 畸形请求不致崩溃 ----
  const before = await status('/index.html');
  for (const p of MALFORMED_PATHS) {
    const r = await status(p);
    const shown = p.length > 32 ? `${p.slice(0, 20)}…（共 ${p.length} 字符）` : p;
    expect(r.status > 0 && r.status < 500, `畸形请求得到正常响应而非断连 ${shown}`, { status: r.status, err: r.err });
  }
  const r400 = await status('/api/online/nope-not-exist');
  expect(r400.status === 404, '未知 API 端点返回 404', r400.status);
  const after = await status('/index.html');
  expect(before.status === 200 && after.status === 200, '整轮畸形请求后服务仍存活', { before: before.status, after: after.status });
  expect(!instance.log().includes('[guard]'), '进程守卫未被触发（无逃逸的未处理异常）', instance.log().slice(-300));

  // ---- E. 容器契约 ----
  const st = await get('/api/online/status');
  expect(st.status === 200, '同源提供 API（/api/online/status）', st.status);
  expect(st.body.state && st.body.state.backend === 'file', '状态后端按 ASTRIX_STATE_FILE 选择为 file', st.body.state && st.body.state.backend);

  // ---- F. 联机链路闭环 ----
  console.log('-- 阶段 F：联机链路 --');
  const hbA = await post('/api/online/heartbeat', { commanderId: 'surf-A', callsign: '探针甲[表面]', fleetPower: 320, defensePower: 90, homePlanet: '希尔瓦', goods: [], shieldUntil: 0 });
  const hbB = await post('/api/online/heartbeat', { commanderId: 'surf-B', callsign: '探针乙[表面]', fleetPower: 300, defensePower: 150, homePlanet: '盖亚', goods: [], shieldUntil: 0 });
  expect(hbA.body.ok === true && hbB.body.ok === true, '两名玩家心跳注册成功', { a: hbA.body.onlineCount, b: hbB.body.onlineCount });

  const cmds = await get('/api/online/commanders');
  const list = cmds.body.list || [];
  expect(list.some((c) => c.commanderId === 'surf-A') && list.some((c) => c.commanderId === 'surf-B'), '全服注册表包含两名探针玩家', list.length);

  await post('/api/online/chat', { commanderId: 'surf-A', callsign: '探针甲[表面]', text: '暴露面自检消息' });
  const chat = await get('/api/online/chat');
  expect((chat.body.messages || []).some((m) => m.text === '暴露面自检消息'), '公频消息可写入并读回', (chat.body.messages || []).length);

  const listed = await post('/api/online/market/list', { sellerId: 'surf-A', sellerCallsign: '探针甲[表面]', mat: '铁', nameCn: '铁锭', qty: 50, priceAscoin: 30 });
  const listingId = listed.body.listing && listed.body.listing.id;
  expect(!!listingId, '集市挂单成功', listingId);

  const marketBefore = await get('/api/online/market');
  const nBefore = (marketBefore.body.listings || []).length;
  const bought = await post('/api/online/market/buy', { buyerId: 'surf-B', buyerCallsign: '探针乙[表面]', listingId });
  expect(bought.body.ok === true, '集市成交成功', bought.body.msg);
  const marketAfter = await get('/api/online/market');
  expect((marketAfter.body.listings || []).length === nBefore - 1, '成交后挂单从列表移除', { before: nBefore, after: (marketAfter.body.listings || []).length });
  const inboxA = await get('/api/online/inbox?commanderId=surf-A');
  expect((inboxA.body.list || []).some((m) => m.type === 'trade_earn'), '卖方收到贸易结算回执', (inboxA.body.list || []).map((m) => m.type));

  const raid = await post('/api/online/raid', { attackerId: 'surf-A', attackerCallsign: '探针甲[表面]', targetId: 'surf-B', fleetPower: 320 });
  expect(raid.status === 200 && typeof raid.body.win === 'boolean', '跨玩家攻防返回结算结果', raid.body);
  const inboxB = await get('/api/online/inbox?commanderId=surf-B');
  expect((inboxB.body.list || []).length > 0, '被攻击方收到战报', (inboxB.body.list || []).map((m) => m.type));

  // 敏感路径在攻击后依然关闭
  const still = await status('/.git/config');
  expect(still.status === 404, '联机交互后敏感路径依然关闭', still.status);
} catch (e) {
  errors.push('运行异常: ' + ((e && e.stack) || e));
  console.log('  x   运行异常:', (e && e.message) || e);
}

await stopServer(instance.proc);
try { fs.rmSync(STATE_FILE, { force: true }); } catch (e) {}

console.log('\n== 结果 ==');
console.log(`通过 ${passed} 项，失败 ${errors.length} 项`);
errors.forEach((e) => console.log('  x ' + e));
console.log(errors.length === 0 ? '全部通过' : '存在异常');
process.exit(errors.length === 0 ? 0 : 1);

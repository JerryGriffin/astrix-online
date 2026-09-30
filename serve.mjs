// ⚠️ 已废弃（v0.2.3）：本文件是早期的简易静态服务器，**当前无任何代码引用**。
// 项目实际入口是 server.mjs（start_online.bat → launch.mjs → server.mjs）。
//
// 请勿用它对外提供服务：它保留了 server.mjs 已修复的三处缺陷 ——
//   ① 无静态资源白名单 ⇒ 项目下所有文件（含 .git/config 的内嵌凭据）都可被下载；
//   ② decodeURIComponent 未做保护 ⇒ 畸形编码请求（如 `/%`）会抛错并终止进程；
//   ③ startsWith(ROOT) 前缀判定可被相邻目录绕过。
// 修复方案见 docs/SERVER_HARDENING.md。若确认无人依赖，建议直接删除本文件。

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
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

const server = http.createServer((req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 'no-cache');
  let p = decodeURIComponent(req.url.split('?')[0]);
  if (p === '/' || p === '') p = '/index.html';
  const f = path.join(ROOT, p);
  if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('404 Not Found');
    return;
  }
  const ext = path.extname(f);
  res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
  fs.createReadStream(f).pipe(res);
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`ASTRIX_SERVER_READY:http://localhost:${PORT}/`);
});

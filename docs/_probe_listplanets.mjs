// 星球列表读取探针：桥接 → 真实云 galaxy_planets 公开读
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const server = http.createServer((req, res) => {
  let p = decodeURIComponent(req.url.split('?')[0]);
  if (p === '/') p = '/index.html';
  const f = path.join(ROOT, p);
  if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); res.end(); return; }
  res.writeHead(200, { 'Content-Type': /\.js$/.test(p) ? 'text/javascript' : 'text/html' });
  fs.createReadStream(f).pipe(res);
});
await new Promise((r) => server.listen(8779, '127.0.0.1', r));
const require = createRequire('C:/Users/11603/.workbuddy/binaries/node/workspace/package.json');
const { chromium } = require('playwright-core');
const browser = await chromium.launch({ executablePath: 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', headless: true, args: ['--no-sandbox'] });
const page = await (await browser.newContext()).newPage();
await page.goto('http://127.0.0.1:8779/index.html', { waitUntil: 'load' });
await page.waitForTimeout(1000);
const res = await page.evaluate(async () => {
  const C = await import('/js/core/cloud.js?v=26.9');
  await C.ensureReady();
  return await C.listPublicPlanets();
});
console.log(JSON.stringify(res, null, 1));
await browser.close();
server.close();
process.exit(res.ok && res.planets.length >= 2 ? 0 : 1);

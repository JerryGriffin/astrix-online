// v0.2.10 玩法提示弹窗探针：点击「玩法提示」→ 断言新条目渲染
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
  res.writeHead(200, { 'Content-Type': /\.js$/.test(p) ? 'text/javascript' : p.endsWith('.css') ? 'text/css' : 'text/html' });
  fs.createReadStream(f).pipe(res);
});
await new Promise((r) => server.listen(8776, '127.0.0.1', r));
const require = createRequire('C:/Users/11603/.workbuddy/binaries/node/workspace/package.json');
const { chromium } = require('playwright-core');
const browser = await chromium.launch({ executablePath: 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', headless: true, args: ['--no-sandbox'] });
const page = await (await browser.newContext()).newPage();
const errs = [];
page.on('pageerror', (e) => errs.push(e.message));
await page.goto('http://127.0.0.1:8776/index.html', { waitUntil: 'load' });
await page.waitForTimeout(1000);
await page.evaluate(() => {
  const b = Array.from(document.querySelectorAll('button')).find((x) => x.textContent.trim() === '玩法提示');
  b.click();
});
await page.waitForTimeout(500);
const res = await page.evaluate(() => {
  const m = document.getElementById('modal-root');
  const t = m ? m.textContent : '';
  return {
    title: t.includes('玩法提示'),
    items: ['军备三级', '飞船编入', '星际股市', '拍卖行', '在线模式', '离线结算', '超级军用装备'].filter((k) => t.includes(k)).length,
    boldRendered: !!m.querySelector('.tip-list li b'),
  };
});
console.log('探针结果:', JSON.stringify(res));
console.log('页面异常:', errs.length ? errs : '无');
await browser.close();
server.close();
process.exit(res.title && res.items >= 6 && res.boldRendered && !errs.length ? 0 : 1);

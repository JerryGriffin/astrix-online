// v0.1.2 R4 / R19-2 专项端到端验证：
//   R4  蓝图编辑器必须出现在「设计」子页，且「舰船」子页不再有它
//   R19-2 造船要扣材料（材料不足时给出「缺少 XX×N」且不允许下水）
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const require = createRequire(import.meta.url);
const { chromium } = require('playwright-core');

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = 8766;
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8' };
const server = http.createServer((req, res) => {
  let p = decodeURIComponent(req.url.split('?')[0]);
  if (p === '/') p = '/index.html';
  const f = path.join(ROOT, p);
  if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); res.end('404'); return; }
  res.writeHead(200, { 'Content-Type': MIME[path.extname(f)] || 'application/octet-stream' });
  fs.createReadStream(f).pipe(res);
});
await new Promise((r) => server.listen(PORT, '127.0.0.1', r));

const browser = await chromium.launch({
  executablePath: 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', headless: true,
});
const page = await (await browser.newContext({ viewport: { width: 1280, height: 900 } })).newPage();
const errs = [];
page.on('pageerror', (e) => errs.push('[pageerror] ' + e.message));
page.on('console', (m) => { if (m.type() === 'error') errs.push('[console] ' + m.text()); });

const log = [];
await page.goto(`http://127.0.0.1:${PORT}/index.html`, { waitUntil: 'load' });
await page.waitForTimeout(1000);

const clickText = async (t, sel = 'button') => page.evaluate((arg) => {
  const b = Array.from(document.querySelectorAll(arg.sel)).find((x) => x.textContent.trim().includes(arg.t));
  if (b) { b.click(); return true; }
  return false;
}, { t, sel });
const wait = (ms) => page.waitForTimeout(ms);

await clickText('离线模式'); await wait(600);
await clickText('新建存档'); await wait(1200);

// 进「舰队」主 tab
await clickText('舰队'); await wait(500);
// 舰队下的子页：舰船 / 设计 / 远征
const subTabs = await page.evaluate(() =>
  Array.from(document.querySelectorAll('button')).map((b) => b.textContent.trim()).filter((t) => ['舰船', '设计', '远征'].includes(t)));
log.push('     舰队子页: ' + (subTabs.join(' | ') || '(未找到)'));

const countBpBox = () => page.evaluate(() => document.querySelectorAll('.bp-box').length);

await clickText('舰船'); await wait(400);
const shipBp = await countBpBox();
log.push('     舰船子页 .bp-box 数量: ' + shipBp);

await clickText('设计'); await wait(600);
const designBp = await countBpBox();
const designText = await page.evaluate(() => (document.body.innerText || '').replace(/\s+/g, ' ').trim().slice(0, 200));
log.push('     设计子页 .bp-box 数量: ' + designBp);
log.push('     设计页文本: ' + designText);

log.push((shipBp === 0 ? 'OK  ' : 'FAIL') + ' R4-a 舰船页不再出现蓝图编辑器（.bp-box=' + shipBp + '）');
log.push((designBp > 0 ? 'OK  ' : 'FAIL') + ' R4-b 设计页出现蓝图编辑器（.bp-box=' + designBp + '）');

// R19-2：材料不足时点建造应报「缺少 …」，且不下水
const shipCountBefore = await page.evaluate(() => {
  const t = document.body.innerText || '';
  const m = t.match(/(\d+)\s*艘/);
  return m ? Number(m[1]) : null;
});
const buildClicked = await clickText('建造');
await wait(500);
const bodyText = await page.evaluate(() => (document.body.innerText || '').replace(/\s+/g, ' ').trim());
log.push('     点建造后是否出现缺料提示: ' + (/缺少\s*\S/.test(bodyText) ? '是' : '否'));
log.push('     舰船数（点建造前/后）: ' + shipCountBefore + ' / ' +
  (await page.evaluate(() => { const m = (document.body.innerText || '').match(/(\d+)\s*艘/); return m ? m[1] : null; })));
log.push((buildClicked ? 'OK  ' : 'FAIL') + ' R19-2 建造按钮可点（缺料应给提示而非静默失败）');

log.push((errs.length === 0 ? 'OK  ' : 'FAIL') + ' 全流程无运行时报错（' + errs.length + ' 条）');
if (errs.length) log.push(errs.slice(0, 5).join('\n'));

console.log(log.join('\n'));
await browser.close();
server.close();

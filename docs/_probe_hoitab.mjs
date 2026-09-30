// 1936 存档：国策页签与面板实测（离线模式，真实点击流程）
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
await new Promise((r) => server.listen(8781, '127.0.0.1', r));
const require = createRequire('C:/Users/11603/.workbuddy/binaries/node/workspace/package.json');
const { chromium } = require('playwright-core');
const browser = await chromium.launch({ executablePath: 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', headless: true, args: ['--no-sandbox'] });
const page = await (await browser.newContext()).newPage();
const errs = [];
page.on('pageerror', (e) => errs.push(e.message));
await page.goto('http://127.0.0.1:8781/index.html', { waitUntil: 'load' });
await page.waitForTimeout(1200);

// 离线 → 新建存档（表单直接出现）→ 选 1936 → 选德国 → 建档进入
const step1 = await page.evaluate(() => {
  const b = Array.from(document.querySelectorAll('button')).find((x) => x.textContent.includes('离线模式'));
  if (!b) return { err: '没有离线模式按钮' };
  b.click(); return { ok: true };
});
await page.waitForTimeout(600);
// 若当前没有开局模式按钮（说明还在存档选择界面）→ 点「新建存档」打开表单
const step2 = await page.evaluate(() => {
  const has1936 = Array.from(document.querySelectorAll('button')).some((x) => x.textContent.trim() === '1936 剧本');
  if (has1936) return { opened: false };
  const add = Array.from(document.querySelectorAll('button')).find((x) => x.textContent.includes('新建存档'));
  if (add) add.click();
  return { opened: !!add };
});
await page.waitForTimeout(500);
const step3 = await page.evaluate(() => {
  const btns = Array.from(document.querySelectorAll('button'));
  const mode = btns.find((x) => x.textContent.trim() === '1936 剧本');
  if (!mode) return { err: '没有 1936 按钮', buttons: btns.map((b) => b.textContent.trim()).slice(0, 12) };
  mode.click();
  const sel = document.querySelector('#modal-root select');
  return { ok: true, hasSel: !!sel, countryVisible: sel ? sel.offsetParent !== null : false };
});
console.log('step3:', JSON.stringify(step3));
const step3b = await page.evaluate(() => {
  const go = Array.from(document.querySelectorAll('button')).find((x) => x.textContent.includes('新建存档') && !x.disabled);
  if (go) go.click();
  return { clicked: !!go, text: go ? go.textContent.trim() : '' };
});
console.log('step3b:', JSON.stringify(step3b));
await page.waitForTimeout(1800);
const res = await page.evaluate(() => {
  const tabs = Array.from(document.querySelectorAll('.tab-btn')).map((b) => b.textContent.trim());
  const has = tabs.indexOf('国策') >= 0;
  let panel = '';
  if (has) {
    const t = Array.from(document.querySelectorAll('.tab-btn')).find((b) => b.textContent.trim() === '国策');
    t.click();
  }
  return { tabs, hasHoi: has };
});
await page.waitForTimeout(1200);
const res2 = await page.evaluate(() => {
  const panel = document.querySelector('.hoi-panel');
  const txt = panel ? panel.textContent : '';
  return {
    panelOk: txt.includes('1936年'),
    hasFocus: txt.includes('国策') && txt.includes('工业线'),
    hasSeas: txt.includes('制海权'),
    placeholder: !panel || /加载失败|模块未就绪/.test(txt),
    snippet: (txt || document.body.textContent).replace(/\s+/g, ' ').slice(0, 120),
  };
});
// 点「开始」推进一项国策（直接验证可用性）
const res3 = await page.evaluate(() => {
  const panel = document.querySelector('.hoi-panel');
  if (!panel) return { err: '面板不存在' };
  const btn = Array.from(panel.querySelectorAll('button')).find((b) => b.textContent.trim() === '开始');
  if (!btn) return { err: '没有可开始的国策按钮' };
  btn.disabled = false;
  btn.click();
  return { clicked: true };
});
console.log('开始国策:', JSON.stringify(res3));
await page.waitForTimeout(2500);
const res4 = await page.evaluate(() => {
  const panel = document.querySelector('.hoi-panel');
  const txt = panel ? panel.textContent.replace(/\s+/g, ' ') : '';
  return { progressing: txt.includes('推进中'), snippet: txt.slice(0, 100) };
});
console.log('进度:', JSON.stringify(res4));
console.log('页签:', JSON.stringify(res.tabs));
console.log('面板:', JSON.stringify(res2));
console.log('页面异常:', errs.length ? errs.slice(0, 3) : '无');
await browser.close();
server.close();
const ok = res.hasHoi && res2.panelOk && res2.hasFocus && !res2.placeholder && res3.clicked && res4.progressing && !errs.length;
console.log(ok ? '探针通过' : '探针失败');
process.exit(ok ? 0 : 1);

// v0.1.5 浏览器冒烟：验证「运输物资」按钮渲染并打开运输弹窗（不崩）。
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = 8799;
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
};

const server = http.createServer((req, res) => {
  let p = decodeURIComponent(req.url.split('?')[0]);
  if (p === '/') p = '/index.html';
  const f = path.join(ROOT, p);
  if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) {
    res.writeHead(404); res.end('404'); return;
  }
  res.writeHead(200, { 'Content-Type': MIME[path.extname(f)] || 'application/octet-stream' });
  fs.createReadStream(f).pipe(res);
});
await new Promise((r) => server.listen(PORT, '127.0.0.1', r));

import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { chromium } = require('playwright-core');
const browser = await chromium.launch({
  executablePath: 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  headless: true,
});
const page = await (await browser.newContext({ viewport: { width: 1280, height: 900 } })).newPage();
const errs = [];
page.on('console', (m) => { if (m.type() === 'error') errs.push('[console] ' + m.text()); });
page.on('pageerror', (e) => errs.push('[pageerror] ' + e.message));

const log = [];
const wait = (ms) => page.waitForTimeout(ms);
const step = async (name, fn) => {
  try { const r = await fn(); log.push('OK   ' + name + (r ? ' · ' + r : '')); return true; }
  catch (e) { log.push('FAIL ' + name + ' -> ' + e.message); return false; }
};
const clickText = async (t, scopeSel) => {
  const ok = await page.evaluate(({ t, scopeSel }) => {
    const scope = scopeSel ? document.querySelector(scopeSel) : document;
    if (!scope) return false;
    const b = Array.from(scope.querySelectorAll('button')).find((x) => (x.textContent || '').trim().includes(t));
    if (!b) return false;
    b.click();
    return true;
  }, { t, scopeSel });
  await wait(600);
  return ok;
};
const modalBtns = () => page.evaluate(() => {
  const m = document.getElementById('modal-root');
  return m ? Array.from(m.querySelectorAll('button')).map((b) => b.textContent.trim()) : ['(no modal-root)'];
});

await page.goto(`http://127.0.0.1:${PORT}/index.html`, { waitUntil: 'load' });
await wait(1200);

await step('启动无运行时报错', async () => {
  if (errs.length) throw new Error(errs.slice(0, 3).join(' | '));
  return '0 条';
});

await clickText('离线模式');
log.push('     离线弹窗按钮: ' + JSON.stringify(await modalBtns()));

// 选「漫溯深空」开局
const modeClicked = await clickText('漫溯深空', '#modal-root');
log.push('     选漫溯深空: ' + modeClicked + ' · 按钮: ' + JSON.stringify(await modalBtns()));

// 提交新建存档（精确命中表单里的提交按钮）
const submitted = await page.evaluate(() => {
  const m = document.getElementById('modal-root');
  const b = m ? m.querySelector('.acc-new-form button.btn-primary') : null;
  if (!b) return false;
  b.click();
  return true;
});
await wait(1300);
log.push('     提交新建存档: ' + submitted);

const inGame = await page.evaluate(() => !!(window.ASTRIX && window.ASTRIX.STATE
  && window.ASTRIX.STATE.accounts && window.ASTRIX.STATE.accounts.length));
log.push('     已进入游戏(accounts>0): ' + inGame);

await step('深空开局母星实例存在', async () => {
  const home = await page.evaluate(() => {
    const S = window.ASTRIX.STATE;
    const h = (S.planets || []).find((p) => p.isHome);
    return h ? (h.pop && h.pop.total) : null;
  });
  log.push('     母星人口: ' + home);
  if (home === null || home === undefined) throw new Error('未找到母星实例');
  return '母星人口=' + home;
});

// 注入一个已殖民的非母星，用于触发「运输物资」按钮
const seeded = await page.evaluate(() => {
  const S = window.ASTRIX.STATE;
  const acc = S.accounts.find((a) => a.id === S.currentAccountId);
  if (!acc) return { err: 'no acc' };
  const home = (S.planets || []).find((p) => p.isHome);
  if (!home) return { err: 'no home instance' };
  const clone = JSON.parse(JSON.stringify(home));
  clone.code = 'tes'; clone.planetId = 'tes1'; clone.isHome = false;
  clone.pop = clone.pop || {}; clone.pop.total = 50;
  if (!S.planets.some((p) => p.code === 'tes')) S.planets.push(clone);
  const p = { code: 'tes', nameCn: '测试殖民星', nameEn: 'tes', type: '岩质行星', orbit: { radius: 99 }, canRebel: false };
  if (!Array.isArray(acc.discovered)) acc.discovered = [];
  if (!acc.discovered.some((x) => x.code === 'tes')) acc.discovered.push(p);
  return { ok: true, planets: S.planets.length };
});
log.push('     注入殖民地: ' + JSON.stringify(seeded));

// 切到殖民地面板（重绘，buildRow 会为新殖民星渲染「运输物资」按钮）
const switched = await clickText('星球选择');
log.push('     切到殖民地面板: ' + switched);

await step('殖民地面板渲染出「运输物资」按钮', async () => {
  const found = await page.evaluate(() =>
    Array.from(document.querySelectorAll('button')).some((b) => b.textContent.trim() === '运输物资'));
  if (!found) throw new Error('未找到「运输物资」按钮');
  return 'found';
});

// 点击「运输物资」→ 打开运输弹窗
const clicked = await page.evaluate(() => {
  const b = Array.from(document.querySelectorAll('button')).find((x) => x.textContent.trim() === '运输物资');
  if (!b) return { err: 'no btn' };
  b.click();
  return { ok: true };
});
await wait(400);
log.push('     点击运输物资: ' + JSON.stringify(clicked));

const modalText = await page.evaluate(() => {
  const m = document.getElementById('modal-root');
  return (m ? (m.innerText || '') : '').replace(/\s+/g, ' ').trim();
});
log.push('     运输弹窗内容: ' + (modalText || '(空)').slice(0, 220));

await step('运输弹窗正常打开（含「编队」选择，无异常）', async () => {
  if (!modalText || modalText.length < 10) throw new Error('弹窗为空（点了没反应 / 抛异常）');
  if (!/编队/.test(modalText)) throw new Error('弹窗缺少「编队」选择：' + modalText.slice(0, 80));
  if (/undefined|NaN|\[object/.test(modalText)) throw new Error('弹窗内容异常：' + modalText.slice(0, 80));
  return modalText.length + ' 字符';
});

await step('全流程无运行时报错', async () => {
  if (errs.length) throw new Error(errs.slice(0, 5).join(' | '));
  return '0 条';
});

console.log(log.join('\n'));
if (errs.length) console.log('\n错误明细:\n' + errs.slice(0, 10).join('\n'));

await browser.close();
server.close();

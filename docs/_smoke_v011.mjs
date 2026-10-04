// v0.1.1 浏览器冒烟：起本地静态服务 + msedge 无头跑一遍启动流程，
// 抓 console error / pageerror / 关键 UI 是否渲染。
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = 8765;
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
const require = createRequire('C:/Users/11603/.workbuddy/binaries/node/workspace/package.json');
const { chromium } = require('playwright-core');
const browser = await chromium.launch({
  executablePath: 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  headless: true,
});
const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
const page = await ctx.newPage();
const errs = [];
page.on('console', (m) => { if (m.type() === 'error') errs.push('[console] ' + m.text()); });
page.on('pageerror', (e) => errs.push('[pageerror] ' + e.message));

const log = [];
const step = (name, fn) => {
  try { const r = fn(); log.push('OK   ' + name + (r ? ' · ' + r : '')); }
  catch (e) { log.push('FAIL ' + name + ' -> ' + e.message); }
};

await page.goto(`http://127.0.0.1:${PORT}/index.html`, { waitUntil: 'load' });
await page.waitForTimeout(1200);

// 注意：step() 的回调在 Node 侧执行，**不能**在里面用 document/window
const title = await page.title();
log.push('     标题: ' + title);
step('页面标题已设置', () => {
  if (!title) throw new Error('标题为空');
  return title;
});

step('启动守卫未触发（无黑屏错误面板）', () => {
  if (errs.length) throw new Error(errs.slice(0, 3).join(' | '));
  return '无 console error';
});

// 主界面：应该有账号/开始游戏入口
const bodyText = await page.evaluate(() => document.body.innerText || '');
log.push('     主界面文本片段: ' + bodyText.replace(/\s+/g, ' ').trim().slice(0, 120));

step('主界面已渲染内容', () => {
  if (!bodyText || bodyText.length < 20) throw new Error('body 为空（疑似黑屏）');
  return bodyText.length + ' 字符';
});

// 尝试进入游戏：找「开始/进入」类按钮
const btnNames = await page.evaluate(() =>
  Array.from(document.querySelectorAll('button')).map((b) => b.textContent.trim()).slice(0, 30));
log.push('     按钮: ' + btnNames.join(' | '));

// 进入游戏：离线模式 → 后续向导（多级点击，每级打印按钮供诊断）
const dumpBtns = async () => (await page.evaluate(() =>
  Array.from(document.querySelectorAll('button')).map((b) => b.textContent.trim().slice(0, 24))));
const MENU = ['在线模式', '离线模式', '更新日志', '玩法提示', '统计数据与成就', 'mod 管理', '设置'];
const clickByText = async (t) => {
  const i = (await dumpBtns()).findIndex((x) => x.includes(t));
  if (i < 0) return false;
  await page.evaluate((k) => document.querySelectorAll('button')[k].click(), i);
  await page.waitForTimeout(700);
  return true;
};

await clickByText('离线模式');
log.push('     离线弹窗: ' + (await page.evaluate(() => {
  const m = document.getElementById('modal-root');
  return (m ? (m.innerText || '') : '(无 modal-root)').replace(/\s+/g, ' ').trim().slice(0, 300);
})));

for (let round = 0; round < 5; round++) {
  const btns = await dumpBtns();
  if (btns.some((b) => ['物品栏', '人力', '科研', '建筑', '电力', '舰队'].includes(b))) break;
  // 优先点弹窗里的按钮（跳过 × 与菜单项）
  const PRIORITY = ['新建存档', '确定', '确认', '进入', '开始'];
  const hit = await page.evaluate((arg) => {
    const menu = arg.menu, prio = arg.prio;
    const m = document.getElementById('modal-root');
    const pool = m ? Array.from(m.querySelectorAll('button')) : Array.from(document.querySelectorAll('button'));
    const cand = pool.filter((x) => {
      const t = x.textContent.trim();
      return t && t !== '×' && !menu.some((mm) => t.includes(mm));
    });
    const b = cand.find((x) => prio.some((p) => x.textContent.includes(p))) || cand[0];
    if (!b) return null;
    const t = b.textContent.trim().slice(0, 20);
    b.click();
    return t;
  }, { menu: MENU, prio: PRIORITY });
  if (!hit) break;
  await page.waitForTimeout(900);
  log.push('     第' + (round + 1) + '级点击: ' + hit);
}

const t2 = await page.evaluate(() => document.body.innerText || '');
log.push('     第二步文本: ' + t2.replace(/\s+/g, ' ').trim().slice(0, 200));
step('进入后仍有内容渲染', () => {
  if (!t2 || t2.length < 20) throw new Error('进入后 body 为空');
  return t2.length + ' 字符';
});

// v0.1.2（需求 1）：点物品栏资源条目必须弹出「来源-消耗明细」简介
const invOpen = await page.evaluate(() => {
  const row = document.querySelector('.inv-row');
  if (!row) return { err: '未找到 .inv-row' };
  row.click();
  return { clicked: true, label: (row.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 24) };
});
await page.waitForTimeout(300);
const invModal = await page.evaluate(() => {
  const m = document.getElementById('modal-root');
  return (m ? (m.innerText || '') : '').replace(/\s+/g, ' ').trim().slice(0, 160);
});
log.push('     资源行: ' + (invOpen.label || invOpen.err) + ' → 弹窗: ' + (invModal || '(空)'));
step('物品栏资源简介能正常打开（v0.1.2 需求 1）', () => {
  if (invOpen.err) throw new Error(invOpen.err);
  if (!invModal || invModal.length < 10) throw new Error('点了资源行但弹窗为空（仍是「没反应」）');
  if (/undefined|NaN|\[object/.test(invModal)) throw new Error('简介内容异常：' + invModal.slice(0, 80));
  return invModal.length + ' 字符';
});
await page.evaluate(() => { const m = document.getElementById('modal-root'); if (m) m.innerHTML = ''; });

// 切几个 tab 看看有没有崩
for (const t of ['物品栏', '人力', '科研', '建筑', '电力', '舰队', '星球选择']) {
  const hit = await page.evaluate((name) => {
    const b = Array.from(document.querySelectorAll('button')).find((x) => x.textContent.trim() === name);
    if (!b) return false;
    b.click();
    return true;
  }, t);
  if (!hit) { log.push('     tab 未找到: ' + t); continue; }
  await page.waitForTimeout(250);
  const txt = await page.evaluate(() => document.body.innerText || '');
  const bad = txt.includes('加载失败') || txt.includes('Cannot read') || txt.length < 20;
  log.push((bad ? 'FAIL' : 'OK  ') + ' tab ' + t + ' · ' + txt.length + ' 字符');
}

step('全流程无运行时报错', () => {
  if (errs.length) throw new Error(errs.slice(0, 5).join(' | '));
  return '0 条';
});

console.log(log.join('\n'));
if (errs.length) console.log('\n错误明细:\n' + errs.slice(0, 10).join('\n'));

await browser.close();
server.close();

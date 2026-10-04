// v0.2.8 商店星冒烟：验证星际股市网格 + 拍卖行（资源开拍）在真实浏览器中渲染且可交互
// 导航路径（真实 UI 流）：离线模式 → 星球视图 → 注入 dock（过舰队页船坞门禁）
//   → 底部 tab「舰队」→ 子导航「舰队与殖民」→ 等待 .shop-market-grid → 买/卖 + 开拍。
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = 8772;
const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon',
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
  headless: true, args: ['--no-sandbox'],
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
const VTAG = '32.1';   // 与 CACHE_TAG 同步（绝对路径动态 import 不会被动改写）

await page.goto(`http://127.0.0.1:${PORT}/index.html`, { waitUntil: 'load' });
await page.waitForTimeout(1200);

step('启动守卫未触发（无黑屏错误面板）', () => {
  if (errs.length) throw new Error(errs.slice(0, 3).join(' | '));
  return '无 console error';
});

// ---- 进入游戏：离线模式 → 逐级点进星球 ----
const MENU = ['在线模式', '离线模式', '更新日志', '玩法提示', '统计数据与成就', 'mod 管理', '设置'];
const clickByText = async (t) => {
  const i = (await page.evaluate(() => Array.from(document.querySelectorAll('button')).map((b) => b.textContent.trim())))
    .findIndex((x) => x.includes(t));
  if (i < 0) return false;
  await page.evaluate((k) => document.querySelectorAll('button')[k].click(), i);
  await page.waitForTimeout(600);
  return true;
};
await clickByText('离线模式');
for (let round = 0; round < 6; round++) {
  const hasTabs = await page.evaluate(() =>
    Array.from(document.querySelectorAll('button.tab-btn')).some((b) => b.textContent.trim() === '舰队'));
  if (hasTabs) break;
  const hit = await page.evaluate((arg) => {
    const menu = arg.menu, prio = ['新建存档', '确定', '确认', '进入', '开始'];
    const m = document.getElementById('modal-root');
    const pool = m ? Array.from(m.querySelectorAll('button')) : Array.from(document.querySelectorAll('button'));
    const cand = pool.filter((x) => { const t = x.textContent.trim(); return t && t !== '×' && !menu.some((mm) => t.includes(mm)); });
    const b = cand.find((x) => prio.some((p) => x.textContent.includes(p))) || cand[0];
    if (!b) return null;
    const t = b.textContent.trim().slice(0, 20);
    b.click();
    return t;
  }, { menu: MENU });
  if (!hit) break;
  await page.waitForTimeout(800);
  log.push('     第' + (round + 1) + '级点击: ' + hit);
}
// 等星球视图底部 tab 栏出现
await page.waitForFunction(() =>
  Array.from(document.querySelectorAll('button.tab-btn')).some((b) => b.textContent.trim() === '舰队'),
  { timeout: 10000 });
log.push('     已进入星球视图（底部 tab 栏出现）');

// ---- 注入 dock（过舰队页船坞门禁）+ 补 Ascoin（新档余额可能不足）----
await page.evaluate(async (v) => {
  const S = await import('/js/core/state.js?v=' + v);
  const acc = S.currentAccount();
  const inst = S.getPlanetInstance(acc.homePlanetCode);
  inst.buildings = inst.buildings || {};
  inst.buildings.dock = 1;
  acc.ascoin = (Number(acc.ascoin) || 0) + 100000;
}, VTAG);
log.push('     已注入 dock=1 与 Ascoin');

// ---- 底部 tab「舰队」→ 子导航「舰队与殖民」----
const clickTabByText = async (selector, text) => {
  const ok = await page.evaluate((arg) => {
    const b = Array.from(document.querySelectorAll(arg.selector)).find((x) => x.textContent.trim() === arg.text);
    if (!b) return false;
    b.click();
    return true;
  }, { selector, text });
  if (!ok) throw new Error('找不到按钮「' + text + '」（selector=' + selector + '）');
};
clickTabByText('.tab-btn', '舰队');
await page.waitForSelector('.fleet-subnav-btn', { timeout: 8000 });
clickTabByText('.fleet-subnav-btn', '舰队与殖民');

// ---- 商店星：星际股市网格 ----
await page.waitForSelector('.shop-market-grid', { timeout: 8000 });
const gridInfo = await page.evaluate(() => {
  const g = document.querySelector('.shop-market-grid');
  return { ok: !!g, rows: g.querySelectorAll('.shop-mk-row').length, hasPrice: !!g.querySelector('.shop-mk-price') };
});
step('星际股市网格渲染（每行含实时价）', () => {
  if (!gridInfo.ok) throw new Error('找不到 .shop-market-grid（商店星未渲染）');
  if (gridInfo.rows < 5) throw new Error('股市行数过少: ' + gridInfo.rows);
  if (!gridInfo.hasPrice) throw new Error('股市行缺价格元素');
  return 'rows=' + gridInfo.rows;
});

// ---- 关掉买入成功模态的辅助（openModal 会弹窗盖住页面，不影响 DOM 查询但保持干净）----
const closeModals = async () => {
  await page.evaluate(() => {
    const m = document.getElementById('modal-root');
    if (!m) return;
    const btn = Array.from(m.querySelectorAll('button')).find((b) => b.textContent.trim() === '×' || /关闭|确定|知道了/.test(b.textContent));
    if (btn) btn.click();
    else if (m.textContent.trim()) m.innerHTML = '';
  });
  await page.waitForTimeout(150);
};

// ---- 即时买：选一个 5 件总价 < 5 万的行买 5 个，校验余额变化 + 无异常 ----
const buyRes = await page.evaluate(async (v) => {
  // 从状态取真实价格选一个买得起的资源（DOM 价格文本带 k/m/g 后缀，不可靠），再按名称定位行
  const S = await import('/js/core/state.js?v=' + v);
  const shop = await import('/js/core/shop.js?v=' + v);
  const acc = S.currentAccount();
  const st = shop.shopStateOf(acc);
  const cheap = Object.keys(st).find((m) => { const p = Number(st[m] && st[m].price) || 0; return p > 0 && p * 5 < 50000; });
  if (!cheap) return { ok: false, reason: '没有买得起的资源（全部价格过高）' };
  const rows = Array.from(document.querySelectorAll('.shop-mk-row'));
  const target = rows.find((r) => ((r.querySelector('.shop-mk-name') || {}).textContent || '').trim() === cheap);
  if (!target) return { ok: false, reason: 'DOM 中找不到行：' + cheap };
  const input = target.querySelector('.shop-mk-qty');
  const buyBtn = Array.from(target.querySelectorAll('button')).find((b) => b.textContent.trim() === '买');
  const before = acc.ascoin;
  input.value = '5';
  input.dispatchEvent(new Event('input', { bubbles: true }));
  buyBtn.click();
  await new Promise((r) => setTimeout(r, 300));
  const after = S.currentAccount().ascoin;
  const modal = document.getElementById('modal-root');
  return { ok: true, matName: cheap, before, after, changed: after !== before,
    modalText: modal ? modal.textContent.trim().slice(0, 80) : '' };
}, VTAG);
await closeModals();
step('即时买：扣减 Ascoin 且未抛错', () => {
  if (!buyRes.ok) throw new Error(buyRes.reason);
  if (!buyRes.changed) throw new Error('买入 ' + buyRes.matName + ' 后 Ascoin 未变化（before=' + buyRes.before
    + '，弹窗=' + buyRes.modalText + '）');
  return buyRes.matName + ' · ascoin ' + Math.floor(buyRes.before) + '→' + Math.floor(buyRes.after);
});

// ---- 拍卖行：开拍一个资源拍卖（刚买的资源已在星球库存，可选）----
const aucRes = await page.evaluate(async (v) => {
  const form = document.querySelector('.shop-auc-form');
  if (!form) return { ok: false, reason: '找不到 .shop-auc-form（拍卖行未渲染）' };
  const sels = form.querySelectorAll('select');
  const typeSel = sels[0];
  typeSel.value = 'resource';
  typeSel.dispatchEvent(new Event('change', { bubbles: true }));
  await new Promise((r) => setTimeout(r, 150));
  const itemSel = form.querySelectorAll('select')[1];
  if (!itemSel || !itemSel.options.length || !itemSel.options[0].value) return { ok: false, reason: '无可选资源' };
  itemSel.value = itemSel.options[0].value;
  itemSel.dispatchEvent(new Event('change', { bubbles: true }));
  const nums = form.querySelectorAll('input[type=number]');
  if (nums.length >= 2) nums[nums.length - 1].value = '100';   // 起拍价 100
  const startBtn = Array.from(form.querySelectorAll('button')).find((b) => b.textContent.trim() === '开始拍卖');
  if (!startBtn) return { ok: false, reason: '无开始拍卖按钮' };
  startBtn.click();
  await new Promise((r) => setTimeout(r, 300));
  const items = document.querySelectorAll('.shop-auc-item').length;
  const S = await import('/js/core/state.js?v=' + v);
  return { ok: true, items, active: S.currentAccount().shopAuctions ? S.currentAccount().shopAuctions.length : -1 };
}, VTAG);
await closeModals();
step('拍卖行：开拍资源拍卖成功（活跃列表出现条目）', () => {
  if (!aucRes.ok) throw new Error(aucRes.reason || '开拍失败');
  if (aucRes.active < 1) throw new Error('shopAuctions 无活跃拍卖（active=' + aucRes.active + '）');
  return 'active=' + aucRes.active + ' domItems=' + aucRes.items;
});

step('全流程无运行时报错', () => {
  if (errs.length) throw new Error(errs.slice(0, 5).join(' | '));
  return '0 条';
});

console.log(log.join('\n'));
if (errs.length) console.log('\n错误明细:\n' + errs.slice(0, 10).join('\n'));
await browser.close();
server.close();
process.exit(log.some((l) => l.startsWith('FAIL')) || errs.length ? 1 : 0);

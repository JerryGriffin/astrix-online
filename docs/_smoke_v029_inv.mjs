// v0.2.9 冒烟：物品栏装备名中文化 —— 注入军用装备（ap_armor_composite@钢），
// 断言物品栏显示「复合装甲@钢」且不露出英文 partId。另验证在线入口快速失败不卡死。
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = 8773;
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
const VTAG = '20.14';

await page.goto(`http://127.0.0.1:${PORT}/index.html`, { waitUntil: 'load' });
await page.waitForTimeout(1200);

step('启动守卫未触发', () => {
  if (errs.length) throw new Error(errs.slice(0, 3).join(' | '));
  return '无 console error';
});

// ---- 进入离线游戏 ----
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
}
await page.waitForFunction(() =>
  Array.from(document.querySelectorAll('button.tab-btn')).some((b) => b.textContent.trim() === '物品栏'),
  { timeout: 10000 });
log.push('     已进入星球视图');

// ---- 注入军用装备（复合装甲@钢 ×3）+ 一件舰船部件对照 ----
await page.evaluate(async (v) => {
  const S = await import('/js/core/state.js?v=' + v);
  const acc = S.currentAccount();
  const inst = S.getPlanetInstance(acc.homePlanetCode);
  inst.equipment = inst.equipment || {};
  inst.equipment['ap_armor_composite@钢'] = { partId: 'ap_armor_composite', material: '钢', count: 3 };
  inst.equipment['hull_mki@铁'] = { partId: 'hull_mki', material: '铁', count: 2 };
}, VTAG);

// ---- 物品栏默认打开：断言装备名 ----
await page.waitForTimeout(600);
const invRes = await page.evaluate(() => {
  const txt = document.body.innerText;
  return {
    hasArmyCn: txt.includes('复合装甲@钢'),
    hasShipCn: txt.includes('@铁'),
    leakAp: txt.includes('ap_armor_composite'),
  };
});
step('物品栏装备名显示「复合装甲@钢」', () => {
  if (!invRes.hasArmyCn) throw new Error('未找到 复合装甲@钢（装备名中文化失败）');
  if (invRes.leakAp) throw new Error('仍露出英文 partId: ap_armor_composite');
  return '军用+舰船部件均中文化';
});

// ---- 在线入口快速失败不卡死（桥接桩路径回归）----
await page.evaluate(() => {
  const btns = Array.from(document.querySelectorAll('button'));
  // 回主界面 → 在线模式
  const back = btns.find((b) => b.textContent.trim() === '返回主界面');
  if (back) back.click();
});
await page.waitForTimeout(500);
const t0 = Date.now();
await clickByText('在线模式');
await page.waitForTimeout(2500);
const onlineRes = await page.evaluate(() => {
  const m = document.getElementById('modal-root');
  const txt = m ? m.textContent : '';
  return { hasCloudMsg: /云服务|连接/.test(txt), txt: txt.slice(0, 60) };
});
step('在线入口在跨域托管下快速降级到绑定模态（不卡死）', async () => {
  // ensureReady（桥接桩快速失败）→ onOnline 降级到「绑定邮箱」模态 = 快速失败证明
  if (!/绑定邮箱/.test(onlineRes.txt)) throw new Error('未降级到绑定模态：' + onlineRes.txt);
  const dt = Date.now() - t0;
  if (dt > 8000) throw new Error('响应耗时 ' + dt + 'ms（疑似卡死）');
  return (dt) + 'ms 内降级';
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

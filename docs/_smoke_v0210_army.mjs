// v0.2.10 冒烟：军队页 —— 新科技名/飞船编入 UI/编入后数值展示
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = 8775;
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
const page = await (await browser.newContext({ viewport: { width: 1280, height: 900 } })).newPage();
const errs = [];
page.on('pageerror', (e) => errs.push(e.message));

const log = [];
const step = (name, fn) => {
  try { const r = fn(); log.push('OK   ' + name + (r ? ' · ' + r : '')); }
  catch (e) { log.push('FAIL ' + name + ' -> ' + e.message); }
};
const VTAG = '26.9';

await page.goto(`http://127.0.0.1:${PORT}/index.html`, { waitUntil: 'load' });
await page.waitForTimeout(1200);

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
    b.click();
    return b.textContent.trim().slice(0, 20);
  }, { menu: MENU });
  if (!hit) break;
  await page.waitForTimeout(800);
}
await page.waitForFunction(() =>
  Array.from(document.querySelectorAll('button.tab-btn')).some((b) => b.textContent.trim() === '军队'),
  { timeout: 10000 });

// ---- 注入：军事科技 + 飞船 + 一支军队 ----
await page.evaluate(async (v) => {
  const S = await import('/js/core/state.js?v=' + v);
  const acc = S.currentAccount();
  acc.tech = Array.from(new Set([...(acc.tech || []), 't_m1', 't_m2', 't_m3']));
  acc._armyTechV3 = true;
  acc.ships = [{ id: 'sh_smoke', name: '先驱号', className: 'MKI级侦察船', strength: 1000, stats: { speed: 100 } }];
  acc.armies = [{ id: 'am_smoke', nameCn: '冒烟一营', blueprintId: 'ab_ranger', men: 105, stats: { atk: 24, def: 12.9, speed: 0 }, power: 34, bonusAtk: 0, bonusDef: 0, exp: 0 }];
}, VTAG);

// ---- 切到军队 tab ----
await page.evaluate(() => {
  const b = Array.from(document.querySelectorAll('button.tab-btn')).find((x) => x.textContent.trim() === '军队');
  b.click();
});
await page.waitForTimeout(800);

const ui1 = await page.evaluate(() => {
  const txt = document.body.innerText;
  return {
    hasArmy: txt.includes('冒烟一营'),
    hasAttachUI: txt.includes('编入飞船') && txt.includes('先驱号'),
    shipOption: !!Array.from(document.querySelectorAll('select option')).find((o) => o.textContent.includes('先驱号')),
  };
});
step('军队页渲染 + 编入飞船 UI（M3）出现', () => {
  if (!ui1.hasArmy) throw new Error('注入的军队未渲染');
  if (!ui1.hasAttachUI || !ui1.shipOption) throw new Error('编入飞船 UI 未出现（先驱号不可选）');
  return '先驱号在下拉中';
});

// ---- 点击编入 ----
await page.evaluate(() => {
  const sel = Array.from(document.querySelectorAll('select')).find((s) =>
    Array.from(s.options).some((o) => o.textContent.includes('先驱号')));
  const btn = sel.closest('div').querySelector('button');
  btn.click();
});
await page.waitForTimeout(600);
const ui2 = await page.evaluate(async (v) => {
  const txt = document.body.innerText;
  const S = await import('/js/core/state.js?v=' + v);
  const acc = S.currentAccount();
  const A = await import('/js/core/army.js?v=' + v);
  const a = acc.armies.find((x) => x.id === 'am_smoke');
  return {
    badge: txt.includes('编入飞船') && txt.includes('🚀'),
    detachBtn: !!Array.from(document.querySelectorAll('button')).find((b) => b.textContent.trim() === '解编飞船'),
    power: A.armyPowerOfInstance(a),
    shipId: a.shipId,
  };
}, VTAG);
step('编入成功：徽标 + 解编按钮 + 战力含 25% 飞船加成', () => {
  if (!ui2.badge || !ui2.detachBtn) throw new Error('编入后徽标/解编按钮未出现');
  if (!ui2.shipId) throw new Error('army.shipId 未写入');
  if (ui2.power < 1000) throw new Error('战力未包含飞船加成（power=' + ui2.power + '）');
  return '战力=' + ui2.power;
});

// ---- 解编 ----
await page.evaluate(() => {
  const b = Array.from(document.querySelectorAll('button')).find((x) => x.textContent.trim() === '解编飞船');
  b.click();
});
await page.waitForTimeout(600);
const ui3 = await page.evaluate(async (v) => {
  const S = await import('/js/core/state.js?v=' + v);
  const acc = S.currentAccount();
  const a = acc.armies.find((x) => x.id === 'am_smoke');
  const A = await import('/js/core/army.js?v=' + v);
  return { shipId: a.shipId, power: A.armyPowerOfInstance(a) };
}, VTAG);
step('解编恢复纯步兵数值', () => {
  if (ui3.shipId) throw new Error('解编后 shipId 未清除');
  if (ui3.power > 100) throw new Error('解编后战力未回落（power=' + ui3.power + '）');
  return '战力=' + ui3.power;
});

step('全流程无运行时报错', () => {
  if (errs.length) throw new Error(errs.slice(0, 3).join(' | '));
  return '0 条';
});

console.log(log.join('\n'));
await browser.close();
server.close();
process.exit(log.some((l) => l.startsWith('FAIL')) || errs.length ? 1 : 0);

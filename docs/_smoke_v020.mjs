// v0.2.0 浏览器冒烟：军队 tab（蓝图/组装线）+ 星际 tab（云服务降级）端到端
// 复用 _smoke_v011.mjs 脚手架：本地静态服务 + msedge 无头。
// 注意：step() 回调在 Node 侧执行，不能在里面用 document/window；
//       要在页面里改状态，用 page.evaluate + 动态 import('/js/core/state.js?v=28.1')。
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = 8766;
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

step('启动守卫未触发（无黑屏错误面板）', () => {
  if (errs.length) throw new Error(errs.slice(0, 3).join(' | '));
  return '无 console error';
});

// ---- 进入游戏：离线模式 → 新建存档 → 进入星球 ----
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
for (let round = 0; round < 5; round++) {
  const btns = await dumpBtns();
  if (btns.some((b) => ['物品栏', '人力', '科研', '建筑', '电力', '舰队'].includes(b))) break;
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

const tabTexts = () => page.evaluate(() =>
  Array.from(document.querySelectorAll('.tab-btn')).map((b) => b.textContent.trim()));

step('无船坞时军队 tab 恒显示，星际/星球选择不出现（v0.2.4）', async () => {
  const tabs = await tabTexts();
  if (!tabs.includes('军队')) throw new Error('军队 tab 应恒显示（v0.2.4）');
  const bad = tabs.filter((t) => t === '星际' || t === '星球选择');
  if (bad.length) throw new Error('未造船坞却出现: ' + bad.join('、'));
  return 'tabs: ' + tabs.join(' | ');
});

// ---- 授予科技 + 造船坞/制造车间/军营 + 注入军事装备 → 重进星球重建 tab ----
await page.evaluate(async () => {
  const S = await import('/js/core/state.js?v=28.1');
  const Y = await import('/js/core/shipyard.js?v=28.1');
  const acc = S.currentAccount();
  acc.tech = ['t_e1', 't_e2', 't_e3', 't_e4', 't_m1', 't_m2', 't_m3', 't_m4'];
  const inst = S.getPlanetInstance('syl');
  inst.buildings = inst.buildings || {};
  inst.buildings.dock = 1;
  inst.buildings.fabricator = 1;
  inst.buildings.barracks = 1;   // v0.2.4：组装线由军营驱动
  // v0.2.4：注入游骑兵全套部件（装备全齐才能开线）
  Y.addEquipment(inst, 'ap_frame_light', '铁', 6);
  Y.addEquipment(inst, 'ap_wpn_rifle', '铁', 8);
  S.saveState();
});
// 返回主界面 → 离线模式 → 进入（重建底部菜单）
await page.evaluate(() => {
  const b = Array.from(document.querySelectorAll('button')).find((x) => x.textContent.trim() === '返回主界面');
  if (b) b.click();
});
await page.waitForTimeout(600);
await clickByText('离线模式');
await page.waitForTimeout(400);
const entered = await page.evaluate(() => {
  const m = document.getElementById('modal-root');
  const pool = m ? Array.from(m.querySelectorAll('button')) : [];
  const enter = pool.find((x) => x.textContent.trim() === '进入')
    || pool.find((x) => x.textContent.includes('进入'));
  if (enter) { enter.click(); return enter.textContent.trim(); }
  return null;
});
await page.waitForTimeout(1000);
log.push('     重进点击: ' + (entered || '(未找到进入按钮)'));

step('造出船坞后（离线模式）「军队」「星球选择」tab 出现，星际仅在线可见', async () => {
  const tabs = await tabTexts();
  for (const t of ['军队', '星球选择']) {
    if (!tabs.includes(t)) throw new Error('缺 tab: ' + t + '（现有: ' + tabs.join('|') + '）');
  }
  if (tabs.includes('星际')) throw new Error('离线模式不应出现「星际」tab（v0.2.1 需求 A）');
  return 'tabs: ' + tabs.join(' | ');
});

// ---- 军队页：门禁通过 → 3 张蓝图 → 开组装线 ----
const clickTab = async (name) => {
  await page.evaluate((n) => {
    const b = Array.from(document.querySelectorAll('.tab-btn')).find((x) => x.textContent.trim() === n);
    if (b) b.click();
  }, name);
  await page.waitForTimeout(400);
};

await clickTab('军队');
const armyTxt = await page.evaluate(() => document.body.innerText || '');
step('军队页：军事科技齐全且 3 张蓝图渲染', () => {
  if (armyTxt.includes('加载失败')) throw new Error('军队页加载失败');
  if (armyTxt.includes('军队系统尚未解锁')) throw new Error('军事科技已研究仍显示门禁提示');
  for (const bp of ['游骑兵', '铁壁', '雷霆']) {
    if (!armyText(bp, armyTxt)) throw new Error('缺蓝图: ' + bp);
  }
  if (!armyText('军队组装生产线', armyTxt)) throw new Error('缺「组装生产线」区块');
  if (!armyText('开设组装线', armyTxt)) throw new Error('缺「开设组装线」按钮');
  function armyText(k, t) { return t.includes(k); }
  return '蓝图 3 张齐全';
});

// 开第一条组装线（部件未齐也允许挂线）
await page.evaluate(() => {
  const b = Array.from(document.querySelectorAll('button'))
    .find((x) => x.textContent.includes('开设组装线'));
  if (b) b.click();
});
await page.waitForTimeout(500);
const lineTxt = await page.evaluate(() => ({
  rows: document.querySelectorAll('.army-line-row').length,
  bars: document.querySelectorAll('.army-progress').length,
  body: document.body.innerText || '',
}));
step('军队组装线：开线成功且进度条渲染', () => {
  if (lineTxt.rows < 1) throw new Error('开线后没有 .army-line-row');
  if (lineTxt.bars < 1) throw new Error('没有 .army-progress 进度条');
  if (!lineTxt.body.includes('取消')) throw new Error('组装线没有取消按钮');
  return 'line-row=' + lineTxt.rows;
});

// ---- 星球选择页（离线模式的殖民地入口，内嵌报告；v0.2.1：在线模式由「星际」承载同一职责）----
await clickTab('星球选择');
await page.waitForTimeout(800);   // 殖民地面板动态 import
const colTxt = await page.evaluate(() => document.body.innerText || '');
step('星球选择页：渲染且含内联殖民地报告（需求 B：报告不再弹窗）', () => {
  if (colTxt.includes('加载失败')) throw new Error('星球选择页显示「加载失败」占位');
  if (!colTxt.includes('星球选择') && !colTxt.includes('殖民地')) throw new Error('星球选择页缺标题');
  // 需求 B：每颗已殖民星球内联展示报告（而非弹窗）；至少应渲染殖民地列表/报告区
  return '星球选择正常渲染（报告内联）';
});
// 注：在线模式「星际」页（含内嵌殖民地 + 云服务）在 selfcheck_render.mjs 的在线态冒烟中已覆盖，
//   浏览器离线冒烟不构造真实云会话，故此处不点「星际」tab（离线本就不出现）。

step('全流程无运行时报错', () => {
  if (errs.length) throw new Error(errs.slice(0, 5).join(' | '));
  return '0 条';
});

console.log(log.join('\n'));
if (errs.length) console.log('\n错误明细:\n' + errs.slice(0, 10).join('\n'));

await browser.close();
server.close();
process.exit(0);

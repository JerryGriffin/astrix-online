// ============================================================================
// selfcheck_v050_e2e.mjs —— v0.4.23 浏览器端到端：存档导出/导入 + 模态层可访问性
//
// 为什么不并进 selfcheck_smoke_browser
//   冒烟脚本的主线是「各页面能不能渲染」，跑一遍要建号进游戏；这里只需要**开始界面
//   的一个弹窗**，独立成文件可以更快定位失败，也便于单独重跑。
//
// 覆盖：
//   ① 存档列表出现「导出」按钮与「导入存档文件」入口（离线池）
//   ② 模态层具备 role=dialog / aria-modal / aria-labelledby，且 html 被加上滚动锁
//   ③ 打开后焦点落在弹窗内；连续 Tab 不会跑到背景页面
//   ④ Esc 关闭：弹窗移除、滚动锁解除、焦点还原到触发按钮
//   ⑤ 点「导出」真的会下载一个可解析、带标识的 JSON
//   ⑥ 导入该文件：存档 +1、当前存档不变、列表出现成功提示
//
// 用法：node docs/selfcheck_v050_e2e.mjs
// ============================================================================
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { homedir } from 'node:os';
import { createRequire } from 'node:module';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const { CACHE_TAG } = await import(new URL('file://' + path.join(ROOT, 'js/version.js').replace(/\\/g, '/')).href);

let pass = 0, fail = 0;
const failures = [];
function ok(cond, name, detail) {
  if (cond) { pass++; console.log('  ✓ ' + name + (detail ? '  [' + detail + ']' : '')); }
  else {
    fail++; failures.push(name + (detail ? '  [' + detail + ']' : ''));
    console.log('  ✗ ' + name + (detail ? '  [' + detail + ']' : ''));
  }
}
function section(t) { console.log('\n' + t); }

// ---- playwright-core 多候选加载（与冒烟脚本同口径）----
const PW_CANDIDATES = [
  () => createRequire(import.meta.url)('playwright-core'),
  () => createRequire(path.join(ROOT, 'package.json'))('playwright-core'),
  () => createRequire(process.env.ASTRIX_PW_WORKSPACE
    || path.join(homedir(), '.workbuddy/binaries/node/workspace/package.json'))('playwright-core'),
];
let playwright = null; let pwErr = null;
for (const fn of PW_CANDIDATES) {
  try { playwright = fn(); break; } catch (e) { pwErr = e; }
}
if (!playwright) {
  console.error('无法加载 playwright-core：' + (pwErr && pwErr.message));
  process.exit(1);
}

// ---- 静态服务器（随机端口，避免与冒烟脚本的 8811 抢）----
const server = http.createServer((req, res) => {
  let p = decodeURIComponent(req.url.split('?')[0]);
  if (p === '/') p = '/index.html';
  const f = path.join(ROOT, p);
  if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); res.end(); return; }
  // v0.4.25：按扩展名给 Content-Type。此前 css 一律按 text/html 发，Chrome 会拒绝加载样式表，
  //   于是这类浏览器自检实际上是在**没有任何 CSS** 的页面上跑的（断言碰巧只看文本，掩盖了布局）。
  const _ext = path.extname(p).toLowerCase();
  const _CT = { '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.html': 'text/html' };
  res.writeHead(200, { 'Content-Type': _CT[_ext] || 'text/html' });
  fs.createReadStream(f).pipe(res);
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const PORT = server.address().port;

const BROWSER_CANDIDATES = [
  process.env.ASTRIX_BROWSER,
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
].filter(Boolean);
let executablePath = null;
for (const c of BROWSER_CANDIDATES) { if (fs.existsSync(c)) { executablePath = c; break; } }

if (!executablePath) {
  console.error('找不到可用的 Chromium 系浏览器（可用 ASTRIX_BROWSER 指定）');
  server.close(); process.exit(1);
}

const browser = await playwright.chromium.launch({ executablePath, headless: true, args: ['--no-sandbox'] });
const context = await browser.newContext({ acceptDownloads: true });
const page = await context.newPage();
const pageErrs = [];
page.on('pageerror', (e) => pageErrs.push(e.message));

// 预置一个离线存档：直接测「存档列表」这一层，不必先跑完建号流程
const seed = {
  id: 'acc_seed_1', name: '回归测试档', createdAt: Date.now(),
  homePlanetCode: 'syl', planetsOwned: ['syl1'],
  resources: {}, tech: [], researchPoints: 777, upgrades: {}, buildings: [], ships: [],
  stats: { playTimeSec: 120, planetsLastSeen: 0, lastSeen: Date.now() },
};
await page.addInitScript(({ acc }) => {
  localStorage.setItem('astrix.save.index', JSON.stringify({
    mode: 'offline', currentAccountId: acc.id, ids: [acc.id],
  }));
  localStorage.setItem('astrix.save.' + acc.id, JSON.stringify(acc));
}, { acc: seed });

try {
  await page.goto(`http://127.0.0.1:${PORT}/index.html`, { waitUntil: 'load' });
  await page.waitForSelector('.screen-start', { timeout: 15000 });
  ok(true, '开始界面已渲染');

  // ---- 打开离线存档列表 ----
  await page.getByRole('button', { name: /离线模式/ }).first().click();
  await page.waitForSelector('.modal-overlay .acc-row', { timeout: 8000 });
  ok(true, '存档列表弹窗已打开');

  section('① 存档列表：导出按钮与导入入口');
  ok(await page.locator('.acc-row').count() === 1, '列表里有 1 个存档');
  ok(await page.locator('.acc-row button', { hasText: '导出' }).count() === 1, '每个存档都有「导出」按钮');
  ok(await page.locator('.acc-import-row button', { hasText: '导入存档文件' }).count() === 1,
    '离线池有「导入存档文件」入口');

  section('② 模态层语义与滚动锁');
  const attrs = await page.evaluate(() => {
    const ov = document.querySelector('.modal-overlay');
    const h3 = ov.querySelector('.modal-header h3');
    return {
      role: ov.getAttribute('role'),
      modal: ov.getAttribute('aria-modal'),
      labelledby: ov.getAttribute('aria-labelledby'),
      headingId: h3 && h3.id,
      scrollLocked: document.documentElement.classList.contains('modal-open'),
    };
  });
  ok(attrs.role === 'dialog', 'role=dialog', attrs.role);
  ok(attrs.modal === 'true', 'aria-modal=true', attrs.modal);
  ok(attrs.labelledby && attrs.labelledby === attrs.headingId, 'aria-labelledby 指向标题',
    attrs.labelledby + ' / ' + attrs.headingId);
  ok(attrs.scrollLocked, '弹窗打开时页面滚动被锁');

  section('③ 焦点进入弹窗且 Tab 不逃逸');
  const focusInside = await page.evaluate(() => {
    const panel = document.querySelector('.modal-panel');
    return !!(panel && panel.contains(document.activeElement));
  });
  ok(focusInside, '打开后焦点在弹窗内');
  for (let i = 0; i < 8; i++) await page.keyboard.press('Tab');
  const stillInside = await page.evaluate(() => {
    const panel = document.querySelector('.modal-panel');
    return !!(panel && panel.contains(document.activeElement));
  });
  ok(stillInside, '连续 Tab 8 次后焦点仍在弹窗内');

  section('④ Esc 关闭：清理状态 + 焦点还原');
  await page.keyboard.press('Escape');
  await page.waitForSelector('.modal-overlay', { state: 'detached', timeout: 5000 });
  const after = await page.evaluate(() => ({
    locked: document.documentElement.classList.contains('modal-open'),
    active: document.activeElement && document.activeElement.textContent,
  }));
  ok(!after.locked, '关闭后滚动锁已解除');
  ok(/离线模式/.test(after.active || ''), '焦点还原到触发按钮', after.active);

  section('⑤ 导出下载');
  // 重新打开列表再导出
  await page.getByRole('button', { name: /离线模式/ }).first().click();
  await page.waitForSelector('.modal-overlay .acc-row', { timeout: 8000 });
  const [download] = await Promise.all([
    page.waitForEvent('download', { timeout: 10000 }),
    page.locator('.acc-row button', { hasText: '导出' }).first().click(),
  ]);
  const fname = download.suggestedFilename();
  ok(/^astrix-save-.+\.json$/.test(fname), '下载文件名符合 astrix-save-*.json', fname);
  const tmp = path.join(os.tmpdir(), 'astrix-e2e-' + Date.now() + '.json');
  await download.saveAs(tmp);
  const raw = fs.readFileSync(tmp, 'utf8');
  let parsed = null;
  try { parsed = JSON.parse(raw); } catch (e) { /* 下面断言会报 */ }
  ok(!!parsed, '下载内容是合法 JSON');
  ok(parsed && parsed.tag === 'astrix.savefile', '下载内容带存档标识', parsed && parsed.tag);
  ok(parsed && parsed.account && parsed.account.name === '回归测试档', '下载内容就是被点的那一档');
  ok(parsed && parsed.gameVersion === (await import(new URL('file://' + path.join(ROOT, 'js/version.js').replace(/\\/g, '/')).href)).VERSION,
    '下载内容记录了当前游戏版本', parsed && parsed.gameVersion);

  section('⑥ 导入该文件');
  const before = await page.evaluate(() => ({
    n: window.ASTRIX.STATE.accounts.length,
    cur: window.ASTRIX.STATE.currentAccountId,
  }));
  await page.locator('.acc-import-row input[type=file]').setInputFiles(tmp);
  await page.waitForSelector('.acc-import-ok', { timeout: 8000 });
  const okText = await page.locator('.acc-import-ok').innerText();
  ok(/已导入/.test(okText), '出现导入成功提示', okText.slice(0, 40));
  const afterImp = await page.evaluate(() => ({
    n: window.ASTRIX.STATE.accounts.length,
    cur: window.ASTRIX.STATE.currentAccountId,
    names: window.ASTRIX.STATE.accounts.map((a) => a.name),
  }));
  ok(afterImp.n === before.n + 1, '存档数量 +1', `${before.n} → ${afterImp.n}`);
  ok(afterImp.cur === before.cur, '当前存档没有被切换');
  ok(afterImp.names.includes('回归测试档（导入）'), '导入档以「（导入）」后缀出现', afterImp.names.join(' / '));
  ok(await page.locator('.acc-row').count() === 2, '列表刷新为 2 行');

  section('⑦ 全程无未捕获异常');
  ok(pageErrs.length === 0, '页面无 pageerror', pageErrs.join(' | '));
} catch (e) {
  fail++;
  failures.push('脚本异常：' + e.message);
  console.log('  ✗ 脚本异常：' + e.message);
} finally {
  await browser.close();
  server.close();
}

console.log('\n========================');
console.log(`通过 ${pass} 项，失败 ${fail} 项`);
if (fail) {
  console.log('失败项：');
  failures.forEach((f) => console.log('  - ' + f));
  process.exit(1);
}
console.log('v0.4.23 浏览器自检通过');

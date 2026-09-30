// v0.2.10 rev15 星系页探针：NPC 卡渲染 / 无 [object] / 贸易弹窗可开 / 卡片明细 / 结盟按钮含诚意金
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
await new Promise((r) => server.listen(8777, '127.0.0.1', r));
const require = createRequire('C:/Users/11603/.workbuddy/binaries/node/workspace/package.json');
const { chromium } = require('playwright-core');
const browser = await chromium.launch({ executablePath: 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', headless: true, args: ['--no-sandbox'] });
const page = await (await browser.newContext()).newPage();
const errs = [];
page.on('pageerror', (e) => errs.push(e.message));
await page.goto('http://127.0.0.1:8777/index.html', { waitUntil: 'load' });
await page.waitForTimeout(1000);
const res = await page.evaluate(async () => {
  const chain = new Proxy({}, { get: (t, p) => (p === 'then' ? undefined : (..._a) => chain) });
  window.WorkBuddyCloud = {
    createWorkBuddyCloud: () => ({
      auth: { getSession: async () => ({ data: null, error: null }) },
      database: chain,
    }),
  };
  const G = await import('/js/ui/galaxy.js?v=26.9');
  const S = await import('/js/core/state.js?v=26.9');
  const acc = S.currentAccount() || { id: 't', name: '测试', homePlanetCode: 'syl', tech: [], ascoin: 999999 };
  S.STATE.mode = 'online';
  const root = document.createElement('div');
  document.body.appendChild(root);
  G.renderGalaxy(root, {
    account: acc, planetCode: 'syl',
    openModal: (opts) => {
      const d = document.createElement('div');
      d.id = 'probe-modal';
      d.textContent = opts.title + '|' + (typeof opts.body === 'string' ? opts.body : opts.body.textContent);
      document.body.appendChild(d);
      return () => d.remove();
    }, closeModal: () => {}, onEnterPlanet: () => {},
  });
  await new Promise((r) => setTimeout(r, 1200));
  const txt = root.textContent || '';
  const out = {
    npcCards: (txt.match(/电脑势力/g) || []).length,
    noObjectBug: !txt.includes('[object HTML'),
    allyCostShown: txt.includes('结盟（'),
    tradeDetail: txt.includes('出售：') && txt.includes('收购：'),
    playerCardHint: txt.includes('已知玩家星球'),
  };
  // 点第一个 NPC 贸易按钮 → 弹窗应出现（rev13 曾 ReferenceError 无反应）
  const tradeBtn = Array.from(root.querySelectorAll('button')).find((b) => b.textContent.trim() === '贸易');
  if (tradeBtn) {
    tradeBtn.click();
    await new Promise((r) => setTimeout(r, 300));
    const modal = document.getElementById('probe-modal');
    out.tradeModal = !!modal && modal.textContent.includes('购买（即时成交）');
    out.modalTitle = modal ? modal.textContent.slice(0, 40) : '(无)';
  } else out.tradeModal = false;
  return out;
});
console.log(JSON.stringify(res, null, 1));
console.log('页面异常:', errs.length ? errs.slice(0, 5) : '无');
await browser.close();
server.close();
process.exit(res.npcCards >= 4 && res.noObjectBug && res.tradeModal && res.tradeDetail && !errs.length ? 0 : 1);

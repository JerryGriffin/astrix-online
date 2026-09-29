const { chromium } = require('playwright-core');
(async () => {
  const b = await chromium.launch({ executablePath: 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', headless: true });
  const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
  const p = await ctx.newPage();
  p.on('pageerror', (e) => console.log('ERR:', e.message, '\nSTACK:', (e.stack || '').split('\n').slice(0, 4).join(' | ')));
  await p.goto('http://127.0.0.1:8765/', { waitUntil: 'load' });
  await p.waitForTimeout(1500);
  await p.evaluate(() => [...document.querySelectorAll('button')].find((x) => x.textContent.includes('离线模式'))?.click());
  await p.waitForTimeout(700);
  await p.evaluate(() => [...document.querySelectorAll('button')].find((x) => x.textContent.includes('新建存档'))?.click());
  await p.waitForTimeout(2000);
  for (const tab of ['物品栏', '人力', '科研', '建筑', '电力', '舰队']) {
    await p.evaluate((t) => [...document.querySelectorAll('button')].find((x) => x.textContent.trim() === t)?.click(), tab);
    await p.waitForTimeout(900);
  }
  await p.evaluate(() => [...document.querySelectorAll('.fleet-subnav-btn')].find((e) => e.textContent.includes('舰队与殖民'))?.click());
  await p.waitForTimeout(1500);
  await b.close();
})().catch((e) => { console.error('FATAL', e.message); });

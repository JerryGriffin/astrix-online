// 探针：离线买的永久升级是否串进在线档的科研面板（直接调 renderPlanet）
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = 8769;
const MIME = { '.html':'text/html;charset=utf-8', '.js':'text/javascript;charset=utf-8', '.css':'text/css;charset=utf-8' };
const server = http.createServer((req,res)=>{ let p=decodeURIComponent(req.url.split('?')[0]); if(p==='/')p='/index.html';
  const f=path.join(ROOT,p); if(!f.startsWith(ROOT)||!fs.existsSync(f)||fs.statSync(f).isDirectory()){res.writeHead(404);res.end();return;}
  res.writeHead(200,{'Content-Type':MIME[path.extname(f)]||'application/octet-stream'}); fs.createReadStream(f).pipe(res); });
await new Promise(r=>server.listen(PORT,'127.0.0.1',r));
const { createRequire } = await import('node:module');
const require = createRequire('C:/Users/11603/.workbuddy/binaries/node/workspace/package.json');
const { chromium } = require('playwright-core');
const browser = await chromium.launch({ executablePath:'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', headless:true });
const page = await browser.newPage();
const errs=[]; page.on('pageerror',e=>errs.push(e.message));
await page.goto(`http://127.0.0.1:${PORT}/index.html`,{waitUntil:'load'});
await page.waitForTimeout(1200);
// 1) 离线档买升级
const offLv = await page.evaluate(async ()=>{
  const S=await import('/js/core/state.js?v=20.6');
  S.switchPool('offline');
  const a=S.createAccount('离线主'); a.upgrades['upg_collect']=5; a.researchPoints=50000; S.saveState();
  return a.upgrades['upg_collect'];
});
// 2) 切在线池 + 新档，渲染星球界面（与真实进入同一渲染函数）
const out = await page.evaluate(async ()=>{
  const S=await import('/js/core/state.js?v=20.6');
  const P=await import('/js/ui/planet.js?v=20.6');
  S.STATE.onlinePoolId='uid_probe';
  S.switchPool('online');
  S.createAccount('在线新档');
  const root=document.createElement('div');
  document.body.appendChild(root);
  P.renderPlanet(root,{ openModal:()=>{}, closeModal:()=>{}, onBack:()=>{}, onEnterPlanet:()=>{} });
  const cur=S.currentAccount();
  const directLv=cur.upgrades['upg_collect']||0;
  // 点科研 tab
  const tab=[...root.querySelectorAll('.tab-btn')].find(b=>b.textContent==='科研');
  if(tab) tab.click();
  await new Promise(r=>setTimeout(r,800));
  const lvTexts=[...root.querySelectorAll('.res-upg-lv')].map(e=>e.textContent);
  const collect=[...root.querySelectorAll('.res-upg')].map(e=>e.textContent).find(t=>t.includes('采集'));
  return { directLv, lvTexts: lvTexts.join('|'), collect: collect?collect.replace(/\s+/g,' ').slice(0,80):'(未找到)' };
});
console.log('离线档 upg_collect =', offLv);
console.log('在线新档 directLv =', out.directLv, '· 科研页等级显示:', out.lvTexts || '(无)');
console.log('采集升级卡片:', out.collect);
const leaked = /Lv [1-9]/.test(out.lvTexts||'');
console.log(leaked ? '>>> 串档确认：离线升级出现在在线科研页' : '>>> 隔离正常：在线科研页全部 Lv0');
console.log('页面错误:', errs.length ? errs.join(' | ') : '无');
await browser.close(); server.close(); process.exit(0);

// 发版辅助：给 js/ 下所有相对模块导入 + index.html 的 css/js 引用统一加 ?v=<CACHE_TAG>
// 用法：node docs/bump_imports.mjs   （版本号唯一来源是 js/version.js 的 CACHE_TAG）
// 幂等：已带 ?v= 的会先剥掉再重写，重复跑无副作用。
// 背景（v0.0.62 黑屏事故）：静态部署不发 Cache-Control，浏览器对「久未改动的模块」
//   启发式缓存可达数天；只有 main.js 带 ?v= 时，被缓存的老模块（如 format.js）
//   会和新 UI 模块（要 fmtRateBody 导出）拼出 "does not provide an export named" 黑屏。
//   **每次发版必须跑一遍本脚本**，让整条 import 链的 URL 全部变化、强制回源。

import { readFileSync, writeFileSync, readdirSync, statSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath, pathToFileURL } from 'url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const { CACHE_TAG } = await import(pathToFileURL(join(ROOT, 'js/version.js')));

// 1) js/**/*.js：相对导入统一为 路径?v=<CACHE_TAG>
function walkJs(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walkJs(p, out);
    else if (name.endsWith('.js')) out.push(p);
  }
  return out;
}
const files = walkJs(join(ROOT, 'js'));
const re = /(['"])(\.{1,2}\/[^'"]*?\.js)(?:\?v=[^'"]*)?\1/g;
let changed = 0;
for (const f of files) {
  const src = readFileSync(f, 'utf8');
  const next = src.replace(re, (m, q, path) => `${q}${path}?v=${CACHE_TAG}${q}`);
  if (next !== src) { writeFileSync(f, next); changed++; }
}

// 2) 根目录 *.html（index.html + cloud-bridge.html 等）：css href / js src / 相对 import 的 ?v= 统一
//    cloud-bridge.html（v0.2.8）里有对 js/core/cloud.js 的相对导入，也必须跟同一 CACHE_TAG，
//    否则桥接 iframe 里的 cloud.js 与游戏主链形成两份模块实例（会话状态分裂）。
import { readdirSync as rdRoot } from 'fs';
for (const name of rdRoot(ROOT)) {
  if (!name.endsWith('.html')) continue;
  const htmlPath = join(ROOT, name);
  const html = readFileSync(htmlPath, 'utf8');
  const htmlNext = html.replace(/(\?v=)[^"']+/g, `$1${CACHE_TAG}`);
  if (htmlNext !== html) { writeFileSync(htmlPath, htmlNext); changed++; }
}

// 3) docs/*.mjs：自检脚本里对 js/ 模块的 import 也必须带**同一个** CACHE_TAG。
//    背景（v0.1.1 render 自检 13 项级联失败）：ESM 按 URL 区分模块实例——
//    UI 链加载的是 state.js?v=11.0，而自检脚本若 import '../js/core/state.js?v=26.4'（无串）
//    就会得到**第二份模块实例**（STATE 双份），于是 S.currentAccount() 恒为 null，
//    表现为「Cannot set properties of null (setting 'tech')」并级联炸掉整条船坞链。
//    所以这里与 js/ 用同一个正则，无串的补上、旧串的剥掉重写。
function walkDocs(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walkDocs(p, out);
    else if (name.endsWith('.mjs')) out.push(p);
  }
  return out;
}
for (const f of walkDocs(join(ROOT, 'docs'))) {
  const src = readFileSync(f, 'utf8');
  const next = src.replace(re, (m, q, path) => `${q}${path}?v=${CACHE_TAG}${q}`);
  if (next !== src) { writeFileSync(f, next); changed++; }
}

console.log(`CACHE_TAG=${CACHE_TAG}，改写 ${changed} 个文件`);

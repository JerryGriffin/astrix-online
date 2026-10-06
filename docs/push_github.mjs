// ============================================================================
// 无 git 时的 GitHub 推送兜底（v0.4.1）—— docs/push_github.mjs
// ============================================================================
// 背景：本机**没有安装 git**（Program Files / LOCALAPPDATA / scoop 均无 git.exe），
//   所以无法 `git add / commit / push`。但仓库 .git/config 里的 remote URL 内嵌了
//   访问令牌，于是改用 GitHub Git Data API 完成「提交并推送」。
//
// 安全约定：
//   * 令牌**只在内存中**从 .git/config 提取，绝不打印、绝不写入日志或文件；
//   * 不打印 remote URL（避免令牌随日志泄漏）。
//
// 用法：
//   node docs/push_github.mjs            # 提交全部改动并推送
//   node docs/push_github.mjs --dry      # 只看将提交哪些文件，不推送
// ============================================================================

import { readFileSync, statSync, readdirSync, existsSync } from 'fs';
import { join, dirname, relative, sep } from 'path';
import { fileURLToPath, pathToFileURL } from 'url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DRY = process.argv.includes('--dry');
const API = 'https://api.github.com';

// 从 .git/config 提取 owner/repo 与令牌（不打印）
//
// v0.4.10：**令牌优先取环境变量** GITHUB_TOKEN / GH_TOKEN。
//   起因：.git/config 里内嵌的那枚令牌已失效（GitHub 返回 Bad credentials），
//   而这台机器没有 git CLI，没法用 `git remote set-url` 换掉它。
//   现在只要在 PowerShell 里设一个环境变量就能推送，不必再去改 .git/config：
//       $env:GITHUB_TOKEN = 'ghp_xxx'
//       node docs\push_github.mjs
//   注意：仓库是**公开**的，所以 `docs/sync_from_github.mjs`（拉取）不需要任何凭据，
//   只有推送需要。
function readRemote() {
  const envToken = process.env.GITHUB_TOKEN || process.env.GH_TOKEN || '';
  const cfg = readFileSync(join(ROOT, '.git/config'), 'utf8');
  // 令牌里可能含 base64 风格的 '='，故用宽松匹配
  const m = cfg.match(/url\s*=\s*https:\/\/([^:@\/]+):([^@\/]+)@github\.com\/([^\/\s]+)\/([^\/\s]+?)(?:\.git)?\s*$/m);
  if (!m) return null;
  return {
    user: m[1],
    token: envToken || m[2],
    owner: m[3],
    repo: m[4],
    tokenSource: envToken ? '环境变量 GITHUB_TOKEN/GH_TOKEN' : '.git/config 内嵌',
  };
}

function api(path, opts = {}) {
  const headers = Object.assign({
    'Authorization': 'Bearer ' + R.token,
    'Accept': 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
    'User-Agent': 'astrix-push',
  }, opts.headers || {});
  return fetch(API + path, Object.assign({}, opts, { headers })).then(async (res) => {
    const txt = await res.text();
    let json = null;
    try { json = txt ? JSON.parse(txt) : null; } catch (e) { json = { raw: txt.slice(0, 400) }; }
    if (!res.ok) {
      const msg = (json && (json.message || (json.errors && JSON.stringify(json.errors)))) || ('HTTP ' + res.status);
      throw new Error(path.split('?')[0] + ' → ' + msg);
    }
    return json;
  });
}

// 需要纳入版本控制的文件（与 .gitignore 对齐：排除 .workbuddy / *.log / node.exe）
const IGNORE_DIR = new Set(['.git', 'node_modules', '.workbuddy']);
const IGNORE_FILE = new Set(['node.exe']);
const IGNORE_EXT = ['.log'];

function collect(dir, out = []) {
  for (const name of readdirSync(dir)) {
    if (IGNORE_DIR.has(name)) continue;
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) collect(p, out);
    else {
      const base = name.toLowerCase();
      if (IGNORE_FILE.has(base)) continue;
      if (IGNORE_EXT.some((e) => base.endsWith(e))) continue;
      out.push(p);
    }
  }
  return out;
}

const R = readRemote();
if (!R) {
  console.error('无法从 .git/config 解析出带令牌的 GitHub remote —— 无法推送。');
  process.exit(2);
}

// v0.4.14：**先实测令牌再动手**。
//   之前只有 api() 报错时才看得出令牌坏了，而那时已经把上百个 blob 传完了，
//   报错信息还被淹没在进度里。现在开头就验一次，失败直接退出并给出三条出路。
try {
  const me = await api('/user');
  console.log('  令牌有效，登录为 ' + (me && me.login ? me.login : '?') + '（来源: ' + R.tokenSource + '）');
} catch (e) {
  console.error('\n✗ 令牌无效或无权限，推送中止。');
  console.error('  来源: ' + R.tokenSource);
  console.error('');
  console.error('  三条出路，任选其一：');
  console.error('   1) 设一个环境变量（最快，优先用这个）:');
  console.error("      `$env:GITHUB_TOKEN = 'github_pat_...'   # 或 ghp_...");
  console.error('      node docs\\push_github.mjs');
  console.error('   2) 换一个令牌：https://github.com/settings/tokens');
  console.error('      fine-grained 只需给 ' + R.owner + '/' + R.repo + ' 这一个仓库、');
  console.error('      权限勾 Contents: Read and write 即可（比 classic 的 repo 全仓库权限安全得多）。');
  console.error('   3) 换掉 .git/config 里已失效的那枚（本机没有 git CLI 时需手改）：');
  console.error("      remote.origin.url = https://x-access-token:<新令牌>@github.com/" + R.owner + '/' + R.repo + '.git');
  process.exit(3);
}

console.log('目标仓库: ' + R.owner + '/' + R.repo + '   (令牌来源: ' + R.tokenSource + '，不会打印)');
  if (!R.token) {
    console.error('没有可用令牌。请设置环境变量后重试：');
    console.error('  $env:GITHUB_TOKEN = \'ghp_你的令牌\'');
    console.error('  node docs\\push_github.mjs');
    process.exit(1);
  }
console.log(DRY ? '【dry-run】只统计，不推送' : '开始推送…');

const files = collect(ROOT).map((p) => relative(ROOT, p).split(sep).join('/'));
console.log('待提交文件数: ' + files.length);

// 1) 取远端当前 ref
const ref = await api('/repos/' + R.owner + '/' + R.repo + '/git/ref/heads/main').catch(async (e) => {
  console.error('读取远端 main 失败: ' + e.message);
  process.exit(3);
});
const baseSha = ref.object.sha;
const baseCommit = await api('/repos/' + R.owner + '/' + R.repo + '/git/commits/' + baseSha);

// 2) 建 blob
let blobCount = 0, changedCount = 0;
const treeEntries = [];
for (const rel of files) {
  const content = readFileSync(join(ROOT, rel));
  const blob = await api('/repos/' + R.owner + '/' + R.repo + '/git/blobs', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ content: content.toString('base64'), encoding: 'base64' }),
  });
  treeEntries.push({ path: rel, mode: '100644', type: 'blob', sha: blob.sha });
  blobCount++;
  process.stdout.write('\r  blob ' + blobCount + '/' + files.length);
}
console.log('\n  blob 完成: ' + blobCount);

if (DRY) {
  console.log('dry-run 结束，未创建 commit。');
  process.exit(0);
}

// 3) 建 tree（基于远端当前 tree，逐项覆盖）
const newTree = await api('/repos/' + R.owner + '/' + R.repo + '/git/trees', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ base_tree: baseCommit.tree.sha, tree: treeEntries }),
});
console.log('  tree: ' + newTree.sha.slice(0, 10));

// v0.4.14 **零变化短路**：tree 与远端当前 tree 完全一致，说明本次没有任何
//   文件改动。此前仍会照样建一个 commit —— 产出的是内容相同的空提交，
//   白白推进历史，也让「刚才推了什么」变得难以分辨（曾出现 tree 哈希相同
//   却多出一个 commit 的情况）。这里直接判定为无需推送。
if (newTree.sha === baseCommit.tree.sha) {
  console.log('  tree 与远端一致 —— 本地与远端无差异，无需推送。');
  console.log('✅ 无需操作：' + R.owner + '/' + R.repo + ' @ ' + baseSha.slice(0, 10));
  process.exit(0);
}

// 4) 建 commit —— 版本号与条目**从 js/version.js 动态取**，不再硬编码
//    （原先写死 'v0.4.1'，结果推 v0.4.2 时提交信息仍是旧版本号，误导后续排查）
const V = await import(pathToFileURL(join(ROOT, 'js/version.js')).href + '?v=' + Date.now());
const vEntry = V.VERSIONS[0] || [V.VERSION, V.VERSION_DATE, []];
const vTitle = vEntry[0] || V.VERSION;
const entries = Array.isArray(vEntry[2]) ? vEntry[2] : [];
const body = entries.length
  ? entries.map((e) => '- ' + String(e).replace(/\*\*/g, '').slice(0, 160)).join('\n')
  : '（无更新日志条目）';
const msg = [
  'release(' + vTitle + '): ' + vEntry[1],
  '',
  body,
].join('\n');

const commit = await api('/repos/' + R.owner + '/' + R.repo + '/git/commits', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ message: msg, tree: newTree.sha, parents: [baseSha] }),
});
console.log('  commit: ' + commit.sha.slice(0, 10));

// 5) 更新 ref（先确认远端没被并行推进）
const cur = await api('/repos/' + R.owner + '/' + R.repo + '/git/ref/heads/main');
if (cur.object.sha !== baseSha) {
  console.error('远端 main 在我们操作期间被推进（并发写入），为避免覆盖已中止。');
  process.exit(4);
}
await api('/repos/' + R.owner + '/' + R.repo + '/git/refs/heads/main', {
  method: 'PATCH',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ sha: commit.sha, force: false }),
});
console.log('✅ 已推送: ' + R.owner + '/' + R.repo + ' @ ' + commit.sha.slice(0, 12));
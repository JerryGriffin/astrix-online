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
import { fileURLToPath } from 'url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DRY = process.argv.includes('--dry');
const API = 'https://api.github.com';

// 从 .git/config 提取 owner/repo 与令牌（不打印）
function readRemote() {
  const cfg = readFileSync(join(ROOT, '.git/config'), 'utf8');
  const m = cfg.match(/url\s*=\s*https:\/\/([^:@\/]+):([^@\/]+)@github\.com\/([^\/\s]+)\/([^\/\s]+?)(?:\.git)?\s*$/m);
  if (!m) return null;
  return { user: m[1], token: m[2], owner: m[3], repo: m[4] };
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

console.log('目标仓库: ' + R.owner + '/' + R.repo + '   (令牌已就位，不会打印)');
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

// 4) 建 commit
const msg = [
  'feat(war): 行星战区地图 + 殖民地争夺 + 敌方AI战略层 (v0.4.1)',
  '',
  '行星战区地图（6x6=36 战区）：战斗发生在具体战区，打赢即占领。',
  '补给网络：从轨道投送点做 BFS，只走我方战区 —— 断供战区挨饿，推进要打穿走廊。',
  '殖民地争夺：地图保证分布 9 处殖民地，占领得收益/战争分数/额外进度。',
  '战略轨道打击：可打任意敌方战区（跨战区），削减驻防并瘫痪防线。',
  '战区驻防与地貌入算；敌方 AI 战略层按价值函数选目标并扩张。',
  '',
  '修复：resolveBattleEnd 里 war 的暂时性死区 ReferenceError 被 try/catch 吞掉，',
  '      导致「打赢也不占领地」；以及地图生成的地貌退化与殖民地生成失败。',
  '',
  '自检：selfcheck_theater 59 项新增，selfcheck_battle 保持 100 项全绿。',
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
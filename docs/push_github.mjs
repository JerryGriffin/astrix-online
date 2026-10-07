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

// 需要纳入版本控制的文件。
//
// v0.4.15 **改为真正解析 .gitignore**。此前这里是一份**硬编码**忽略表
//（.git / node_modules / .workbuddy / node.exe / *.log），与仓库根目录的 .gitignore
// 完全脱钩 —— 往 .gitignore 里加任何规则都**不会生效**。这就是 v0.4.10~v0.4.14
// 之间那 66 个一次性调试文件（_probe_* / _smoke_* / *.log / 一次性迁移脚本）
// 一路被提交进仓库的根因：以为 .gitignore 管住了，其实并没有。
//
// 解析范围刻意保守，只支持 gitignore 里最常用、也最容易判对的几类写法：
//   · 空行 / # 注释          → 跳过
//   · 目录名（含尾斜杠）      → 该目录整棵跳过
//   · 前缀匹配（foo/）        → 仓库内 foo/ 下的东西全跳过
//   *   *.log / *.txt         → 按后缀匹配
//   ?   单字符通配             → 转成 . 之外的任意单字符
//   [a-z] / [!a-z] 字符类      → 支持（含取反）
// 其余写法（! 取反、** 跨目录）不解析 —— 但本仓库的 .gitignore 没用到，
// 遇到未支持的行会打印一行提示，避免「以为忽略了其实没忽略」。
const IGNORE_DIR = new Set(['.git', 'node_modules', '.workbuddy', '.ref']);

function parseGitignore(text) {
  const rules = [];
  for (const raw of text.split('\n')) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const negate = line.startsWith('!');
    const body = negate ? line.slice(1) : line;
    const dirOnly = body.endsWith('/');
    const anchored = body.includes('/') && !dirOnly && !body.startsWith('*');
    rules.push({
      negate,
      dirOnly,
      anchored,
      re: globToRe(dirOnly ? body.slice(0, -1) : body),
    });
  }
  return rules;
}

/** 把 gitignore 的 glob 转成正则。只支持上面列出的那几类写法。 */
function globToRe(g) {
  let re = '';
  for (let i = 0; i < g.length; i++) {
    const ch = g[i];
    if (ch === '*') {
      if (g[i + 1] === '*') { i++; re += '.*'; continue; }
      re += '[^/]*';
    } else if (ch === '?') re += '[^/]';
    else if (ch === '[') {
      let j = i + 1, neg = false;
      if (g[j] === '!' || g[j] === '^') { neg = true; j++; }
      let cls = '';
      while (j < g.length && g[j] !== ']') cls += g[j++];
      re += '[' + (neg ? '^' : '') + cls + ']';
      i = j;
    } else if ('.+^$()|[]\\'.includes(ch)) re += '\\' + ch;
    else re += ch;
  }
  return new RegExp('^' + re + '$');
}

const GITIGNORE = existsSync(join(ROOT, '.gitignore'))
  ? parseGitignore(readFileSync(join(ROOT, '.gitignore'), 'utf8'))
  : [];

/** 判断一个「相对仓库根的路径」是否被 .gitignore 排除。 */
function ignored(rel) {
  const p = rel.split(sep).join('/');
  const segs = p.split('/');
  let hit = false;
  for (const r of GITIGNORE) {
    if (r.dirOnly) {
      // 目录规则：任意一段目录名匹配即算忽略
      if (segs.slice(0, -1).some((sg) => r.re.test(sg))) { hit = !r.negate; continue; }
      if (r.re.test(segs[segs.length - 1])) { hit = !r.negate; continue; }
    } else if (r.re.test(p)) { hit = !r.negate; continue; }
    else if (r.anchored === false && r.re.test(segs[segs.length - 1])) { hit = !r.negate; continue; }
    else if (r.re.test(segs[segs.length - 1])) { hit = !r.negate; }
  }
  return hit;
}

const skipped = [];
function collect(dir, out = []) {
  for (const name of readdirSync(dir)) {
    if (IGNORE_DIR.has(name)) continue;
    const p = join(dir, name);
    const rel = relative(ROOT, p).split(sep).join('/');
    const st = statSync(p);
    if (st.isDirectory()) { collect(p, out); continue; }
    if (ignored(rel)) { skipped.push(rel); continue; }
    out.push(p);
  }
  return out;
}

const R = readRemote();
if (!R) {
  console.error('无法从 .git/config 解析出带令牌的 GitHub remote —— 无法推送。');
  process.exit(2);
}

// ---------------------------------------------------------------------------
// v0.4.20：行尾归一化（clean 过滤器）
// ---------------------------------------------------------------------------
// 为什么不直接上传工作区字节：git 的「工作区形态」与「对象库形态」是两回事。
//   本机 core.autocrlf=true → 工作区是 CRLF、对象库里存的是 LF。
//   本脚本走 Git Data API，**绕过 git 自身的 clean 过滤器**，
//   于是工作区的 CRLF 被原样写进对象库。
//
//   后果（实测）：110 个受控文件里有 76 个已经变成 CRLF 存储；
//   这些文件此后只要走一次正常 `git add`，git 就会按 clean 规则把它改判成 LF，
//   整篇 diff → 「同一文件在 CRLF / LF 之间反复翻面」，历史上一直无法收敛。
//
//   现在与 git 保持一致：文本 CRLF→LF；二进制（含 NUL 字节）原样。
//   判定口径与 git 的自动文本探测一致（NUL 字节 = 二进制）。
const AUTO_CRLF = readCoreConfig('autocrlf');
const HAS_TEXT_AUTO = (() => {
  try {
    // `* text=auto`（或 `* text`）＝仓库级权威声明：文本一律以 LF 入库
    return /^\s*\*\s+[^\n]*\btext\b/m.test(readFileSync(join(ROOT, '.gitattributes'), 'utf8'));
  } catch (e) { return false; }
})();
const NORMALIZE_EOL = AUTO_CRLF === 'true' || AUTO_CRLF === 'input' || HAS_TEXT_AUTO;

/**
 * 读 [core] 段里的某个键，按「全局 → 仓库」的顺序覆盖。
 *   注意 `git config --show-origin` 显示本机真值来自 **PortableGit 的系统级
 *   etc/gitconfig**（`autocrlf = true`），那一路径随安装位置变化、无法可靠推导，
 *   所以本脚本不以它为唯一依据 —— 仓库根的 `.gitattributes`（`* text=auto`）
 *   才是权威声明，只要它在，归一化就一定生效。
 */
function readCoreConfig(key) {
  const home = process.env.HOME || process.env.USERPROFILE || '';
  const candidates = [
    process.env.GIT_CONFIG_GLOBAL || '',
    home ? join(home, '.gitconfig') : '',
    home ? join(home, '.config', 'git', 'config') : '',
    join(ROOT, '.git', 'config'),
  ];
  let val = null;
  for (const f of candidates) {
    if (!f || !existsSync(f)) continue;
    let inCore = false;
    for (const raw of readFileSync(f, 'utf8').split(/\r?\n/)) {
      const line = raw.trim();
      if (!line || line.startsWith('#') || line.startsWith(';')) continue;
      const sec = line.match(/^\[([^\]]+)\]$/);
      if (sec) { inCore = sec[1].trim().toLowerCase() === 'core'; continue; }
      if (!inCore) continue;
      const kv = line.match(/^([^=]+?)\s*=\s*(.*)$/);
      if (kv && kv[1].trim().toLowerCase() === key) val = kv[2].trim().replace(/^"|"$/g, '').toLowerCase();
    }
  }
  return val;
}

function normalizeEol(buf) {
  if (!NORMALIZE_EOL) return buf;
  if (buf.includes(0)) return buf;              // 二进制：一个字节都不动
  const out = [];
  for (let i = 0; i < buf.length; i++) {
    if (buf[i] === 0x0d && buf[i + 1] === 0x0a) continue;   // 丢掉 CRLF 里的 CR
    out.push(buf[i]);
  }
  return Buffer.from(out);
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
if (skipped.length) {
  console.log('按 .gitignore 跳过 ' + skipped.length + ' 个文件'
    + (process.env.GITIGNORE_VERBOSE ? '' : '（设 GITIGNORE_VERBOSE=1 可列出）'));
  if (process.env.GITIGNORE_VERBOSE) skipped.forEach((f) => console.log('    - ' + f));
}

// 1) 取远端当前 ref 与 tree
//   tree 提前取：既用于下面「删除远端多余文件」，也用于**保留每个文件在远端的 mode**
//   （v0.4.20：此前 treeEntries 全部硬编码 '100644'，会把远端已设 100755 的文件
//    改回普通文件 —— 本仓库虽无脚本文件，但这是个会静默丢权限的坑）。
const ref = await api('/repos/' + R.owner + '/' + R.repo + '/git/ref/heads/main').catch(async (e) => {
  console.error('读取远端 main 失败: ' + e.message);
  process.exit(3);
});
const baseSha = ref.object.sha;
const baseCommit = await api('/repos/' + R.owner + '/' + R.repo + '/git/commits/' + baseSha);
const remoteTree = await api('/repos/' + R.owner + '/' + R.repo + '/git/trees/'
  + baseCommit.tree.sha + '?recursive=1');

const remoteFiles = [];
const remoteMode = new Map();
(function flattenRemote(node, prefix) {
  for (const e of node.tree || []) {
    const p = prefix ? prefix + '/' + e.path : e.path;
    if (e.type === 'tree') flattenRemote(e, p);
    else if (e.type === 'blob') { remoteFiles.push(p); remoteMode.set(p, e.mode || '100644'); }
  }
})(remoteTree, '');

// 2) 建 blob
// ⚠️ v0.4.20 修复本脚本最严重的一处缺陷：此前直接 readFileSync **工作区**内容当
//   blob 原样上传，把工作区的 CRLF 写进了 git 对象库（详见下方 normalizeEol 说明）。
//   实测修复前 110 个受控文件里有 76 个是 CRLF 存储。现在统一做 clean 归一化。
let blobCount = 0, eolFixed = 0;
const treeEntries = [];
for (const rel of files) {
  const raw = readFileSync(join(ROOT, rel));
  const content = normalizeEol(raw);
  if (!content.equals(raw)) eolFixed++;
  const blob = await api('/repos/' + R.owner + '/' + R.repo + '/git/blobs', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ content: content.toString('base64'), encoding: 'base64' }),
  });
  treeEntries.push({ path: rel, mode: remoteMode.get(rel) || '100644', type: 'blob', sha: blob.sha });
  blobCount++;
  process.stdout.write('\r  blob ' + blobCount + '/' + files.length);
}
console.log('\n  blob 完成: ' + blobCount
  + (eolFixed ? '（其中 ' + eolFixed + ' 个做了 CRLF→LF 归一化）' : ''));

// v0.4.15 **删除远端已不存在的文件**。
//   base_tree 是增量语义：不列出的条目保持不变，所以本地删掉的文件会**留在远端**。
//   这里把远端 tree 的 blob 路径全量拉下来，与本地列表比对，对「远端有、本地无」
//   的追加一条 `sha: null` —— 这是 Git Trees API 约定的删除写法。
//
//   关于 .gitignore：**不因被忽略就跳过删除**，这是刻意的。git 的语义是
//   .gitignore 只管「未跟踪文件要不要加入」；文件一旦被跟踪，.gitignore 对它的
//   修改与删除**没有任何影响**。v0.4.15 第一次写这里时错误地加了 `!ignored(p)`
//   过滤条件，结果那 55 个 docs/_probe_* 残留因为刚好命中新加的 `docs/*`
//   规则而被判为「忽略、不删」，一个都清不掉 —— 清理反而做成了空操作。
const localSet = new Set(files);
const toRemove = remoteFiles.filter((p) => !localSet.has(p));
if (toRemove.length) {
  console.log('  将从远端删除 ' + toRemove.length + ' 个文件（本地已不存在）:');
  if (toRemove.length <= 20) toRemove.forEach((p) => console.log('    - ' + p));
  else console.log('    （' + toRemove.slice(0, 10).join(', ') + ' … 共 ' + toRemove.length + ' 个）');
  for (const p of toRemove) {
    treeEntries.push({ path: p, mode: '100644', type: 'blob', sha: null });
  }
} else {
  console.log('  无需删除远端文件');
}

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
//
//    v0.4.20：支持 `--title "..."` / `--body "..."` 覆盖。
//      纯仓库维护类提交（行尾归一化、清冗余）不该硬套「release(x): 日期」——
//      否则历史里会出现两个同名 release 提交，分辨不出哪个是真发版。
const argOf = (name) => {
  const i = process.argv.indexOf(name);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : null;
};
const V = await import(pathToFileURL(join(ROOT, 'js/version.js')).href + '?v=' + Date.now());
const vEntry = V.VERSIONS[0] || [V.VERSION, V.VERSION_DATE, []];
const vTitle = vEntry[0] || V.VERSION;
const entries = Array.isArray(vEntry[2]) ? vEntry[2] : [];
const body = entries.length
  ? entries.map((e) => '- ' + String(e).replace(/\*\*/g, '').slice(0, 160)).join('\n')
  : '（无更新日志条目）';
const customTitle = argOf('--title');
const customBody = argOf('--body');
const msg = customTitle
  ? [customTitle, '', customBody || ''].join('\n')
  : [
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
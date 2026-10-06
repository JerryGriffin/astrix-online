// ============================================================================
// docs/sync_from_github.mjs —— 无 git CLI 的「拉取」工具
// ============================================================================
// 为什么需要它：这台机器没有 git.exe，而 .git/config 里内嵌的令牌已失效
// （Bad credentials），`docs/push_github.mjs` 推不上去。但仓库是**公开**的，
// 所以读取可以匿名走 GitHub API —— 于是「拉取」不需要任何凭据。
//
// 用法：
//   node docs/sync_from_github.mjs            只报告远端与本地的差异
//   node docs/sync_from_github.mjs --apply    把远端版本写回本地（仅列出的路径）
//   node docs/sync_from_github.mjs --apply --only js/ui/hoi.js,js/core/fleet.js
//
// 安全约束：
//   · --apply 只覆盖「远端存在且本地路径相同」的文件，不删除本地独有文件
//   · 覆盖前先在 docs/.sync_backup/<相对路径> 留一份本地副本
// ============================================================================

import { readFileSync, writeFileSync, mkdirSync, existsSync, copyFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OWNER = 'JerryGriffin';
const REPO = 'astrix-online';
const REF = 'main';
const API = 'https://api.github.com/repos/' + OWNER + '/' + REPO;

const args = process.argv.slice(2);
const APPLY = args.includes('--apply');
const onlyArg = args.find((a) => a.startsWith('--only='));
const ONLY = onlyArg ? onlyArg.slice('--only='.length).split(',').map((s) => s.trim()).filter(Boolean) : null;

// 远端目录里这些是工具/产物，不属于游戏代码，不需要同步
const SKIP_PREFIX = ['docs/', '.github/'];
const SKIP_NAMES = new Set(['LICENSE', '.gitignore']);

async function gh(path) {
  const url = API + path;
  const res = await fetch(url, { headers: { 'User-Agent': 'astrix-sync', Accept: 'application/vnd.github+json' } });
  if (!res.ok) throw new Error(res.status + ' ' + res.statusText + ' ← ' + url);
  return res.json();
}

async function readTree() {
  // 取 commit → tree（recursive）
  const c = await gh('/commits/' + REF);
  const tree = await gh('/git/trees/' + c.commit.tree.sha + '?recursive=1');
  return { sha: c.sha, files: (tree.tree || []).filter((e) => e.type === 'blob') };
}

function sha1Of(buf) {
  // 只需与远端 blob sha 比较做「是否相同」的快速判断；这里用长度+内容哈希代替
  let h = 5381;
  for (let i = 0; i < buf.length; i++) h = ((h * 33) ^ buf[i]) >>> 0;
  return buf.length + '-' + h.toString(16);
}

const { sha, files } = await readTree();
const remote = files.filter((e) => {
  if (SKIP_NAMES.has(e.path)) return false;
  if (SKIP_PREFIX.some((p) => e.path.startsWith(p))) return false;
  if (!/\.(js|mjs|css|html|json|md)$/i.test(e.path)) return false;
  if (ONLY && !ONLY.includes(e.path)) return false;
  return true;
});

console.log('远端 commit: ' + sha);
console.log('远端候选文件: ' + remote.length + (ONLY ? '（已按 --only 过滤）' : ''));
console.log('');

let same = 0, diff = 0, missing = 0;
const changed = [];
const backupRoot = join(ROOT, 'docs/.sync_backup');

for (const e of remote) {
  const localPath = join(ROOT, e.path);
  if (!existsSync(localPath)) { missing++; changed.push({ path: e.path, kind: 'new' }); continue; }
  const localBytes = readFileSync(localPath);
  // 远端 blob 是 git 对象（"blob <len>\0" + 内容），去掉头再比
  const j = await gh('/git/blobs/' + e.sha);
  const remoteBuf = Buffer.from(j.content, 'base64');
  const remoteCode = remoteBuf.subarray(remoteBuf.indexOf(0) + 1);
  if (remoteCode.equals(localBytes)) { same++; continue; }
  diff++;
  changed.push({ path: e.path, kind: 'diff', bytes: remoteCode.length, localBytes: localBytes.length });
}

console.log('相同: ' + same + '   不同: ' + diff + '   本地缺失: ' + missing);
console.log('');
for (const c of changed) {
  const size = c.kind === 'new' ? '' : ('  远端 ' + c.bytes + ' B / 本地 ' + c.localBytes + ' B');
  console.log('  [' + c.kind + '] ' + c.path + size);
}

if (!APPLY) {
  console.log('');
  console.log('（仅报告。加 --apply 才会写回本地；覆盖前会自动备份到 docs/.sync_backup/）');
  process.exit(0);
}

console.log('');
console.log('=== 写回本地 ===');
let written = 0;
for (const c of changed) {
  if (c.kind !== 'diff' && c.kind !== 'new') continue;
  const localPath = join(ROOT, c.path);
  if (existsSync(localPath)) {
    const bak = join(backupRoot, c.path);
    mkdirSync(dirname(bak), { recursive: true });
    copyFileSync(localPath, bak);
  }
  const j = await gh('/git/blobs/' + (remote.find((x) => x.path === c.path)).sha);
  const buf = Buffer.from(j.content, 'base64');
  const code = buf.subarray(buf.indexOf(0) + 1);
  mkdirSync(dirname(localPath), { recursive: true });
  writeFileSync(localPath, code);
  written++;
}
console.log('已写回 ' + written + ' 个文件（本地旧版本备份在 docs/.sync_backup/）');
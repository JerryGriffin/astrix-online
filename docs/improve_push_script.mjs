// v0.4.14 —— push_github.mjs 两处改进：
//   ① 推送前**实测**令牌，并在失败时给出可操作的提示（原来只打印
//      「.git/config 内嵌（可能已失效）」，既吓人又不说明到底行不行）；
//   ② 内容零变化时**不再生成冗余提交**（tree 哈希相同就直接跳过）。
import { readFileSync, writeFileSync } from 'fs';

const FILE = 'docs/push_github.mjs';
let src = readFileSync(FILE, 'utf8');
const EOL = src.includes('\r\n') ? '\r\n' : '\n';
const L = (s) => s.split(EOL).join('\n');   // 归一化成 LF 便于匹配，最后再转回

src = L(src);

// ---------------------------------------------------------------- ① 令牌来源文案
const oldSrc = "    tokenSource: envToken ? '环境变量 GITHUB_TOKEN/GH_TOKEN' : '.git/config 内嵌（可能已失效）',";
const newSrc = "    tokenSource: envToken ? '环境变量 GITHUB_TOKEN/GH_TOKEN' : '.git/config 内嵌',";
if (!src.includes(oldSrc)) { console.error('✗ 令牌来源那行没找到'); process.exit(1); }
src = src.replace(oldSrc, newSrc);

// ---------------------------------------------------------------- ② 零变化短路
const treeLine = "console.log('  tree: ' + newTree.sha.slice(0, 10));";
if (!src.includes(treeLine)) { console.error('✗ tree 日志那行没找到'); process.exit(1); }

const shortCircuit = [
  treeLine,
  '',
  '// v0.4.14 **零变化短路**：tree 与远端当前 tree 完全一致，说明本次没有任何',
  '//   文件改动。此前仍会照样建一个 commit —— 产出的是内容相同的空提交，',
  '//   白白推进历史，也让「刚才推了什么」变得难以分辨（曾出现 tree 哈希相同',
  '//   却多出一个 commit 的情况）。这里直接判定为无需推送。',
  "if (newTree.sha === baseCommit.tree.sha) {",
  "  console.log('  tree 与远端一致 —— 本地与远端无差异，无需推送。');",
  "  console.log('✅ 无需操作：' + R.owner + '/' + R.repo + ' @ ' + baseSha.slice(0, 10));",
  '  process.exit(0);',
  '}',
].join('\n');
src = src.replace(treeLine, shortCircuit);

// ---------------------------------------------------------------- ③ 推送前实测令牌
const runLine = "console.log('目标仓库: ' + R.owner + '/' + R.repo";
if (!src.includes(runLine)) { console.error('✗ 目标仓库日志那行没找到'); process.exit(1); }

const probe = [
  '// v0.4.14：**先实测令牌再动手**。',
  '//   之前只有 api() 报错时才看得出令牌坏了，而那时已经把上百个 blob 传完了，',
  '//   报错信息还被淹没在进度里。现在开头就验一次，失败直接退出并给出三条出路。',
  "try {",
  "  const me = await api('/user');",
  "  console.log('  令牌有效，登录为 ' + (me && me.login ? me.login : '?') + '（来源: ' + R.tokenSource + '）');",
  "} catch (e) {",
  "  console.error('\\n✗ 令牌无效或无权限，推送中止。');",
  "  console.error('  来源: ' + R.tokenSource);",
  "  console.error('');",
  "  console.error('  三条出路，任选其一：');",
  "  console.error('   1) 设一个环境变量（最快，优先用这个）:');",
  "  console.error(\"      `$env:GITHUB_TOKEN = 'github_pat_...'   # 或 ghp_...\");",
  "  console.error('      node docs\\\\push_github.mjs');",
  "  console.error('   2) 换一个令牌：https://github.com/settings/tokens');",
  "  console.error('      fine-grained 只需给 ' + R.owner + '/' + R.repo + ' 这一个仓库、');",
  "  console.error('      权限勾 Contents: Read and write 即可（比 classic 的 repo 全仓库权限安全得多）。');",
  "  console.error('   3) 换掉 .git/config 里已失效的那枚（本机没有 git CLI 时需手改）：');",
  "  console.error(\"      remote.origin.url = https://x-access-token:<新令牌>@github.com/\" + R.owner + '/' + R.repo + '.git');",
  '  process.exit(3);',
  '}',
  '',
  runLine,
].join('\n');
src = src.replace(runLine, probe);

writeFileSync(FILE, src.split('\n').join(EOL), 'utf8');
console.log('✓ push_github.mjs 已更新（令牌实测 + 零变化短路 + 提示文案）');
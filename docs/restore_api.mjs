// 从 GitHub API 的 contents 端点恢复文件（raw.githubusercontent 这条路现在连不上）
import { writeFileSync, readFileSync } from 'fs';

const cfg = readFileSync('.git/config', 'utf8');
const tok = (cfg.match(/url = https:\/\/[^:@\/]+:([^@\/]+)@github\.com/) || [])[1];
const file = process.argv[2];
const url = 'https://api.github.com/repos/JerryGriffin/astrix-online/contents/' + file;

for (let i = 1; i <= 5; i++) {
  try {
    const ac = new AbortController();
    const t = setTimeout(() => ac.abort(), 45000);
    const r = await fetch(url, {
      headers: {
        Authorization: 'Bearer ' + tok,
        'User-Agent': 'restore',
        Accept: 'application/vnd.github.raw',
      },
      signal: ac.signal,
    });
    clearTimeout(t);
    if (!r.ok) { console.log('  尝试 ' + i + '：HTTP ' + r.status); await new Promise((s) => setTimeout(s, 3000)); continue; }
    const text = await r.text();
    writeFileSync(file, text);
    console.log('✓ ' + file + ' 已恢复（' + text.split('\n').length + ' 行，第 ' + i + ' 次尝试）');
    process.exit(0);
  } catch (e) {
    console.log('  尝试 ' + i + ' 失败：' + e.message);
    await new Promise((s) => setTimeout(s, 3000));
  }
}
console.error('✗ API 路径也失败');
process.exit(1);
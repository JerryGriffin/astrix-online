// 从 GitHub 恢复单个文件（带重试，网络不稳）
import { writeFileSync } from 'fs';

const cfg = (await import('node:fs')).readFileSync('.git/config', 'utf8');
const tok = (cfg.match(/url = https:\/\/[^:@\/]+:([^@\/]+)@github\.com/) || [])[1];
const [, , , , file] = process.argv;
const url = 'https://raw.githubusercontent.com/JerryGriffin/astrix-online/main/' + file;

for (let attempt = 1; attempt <= 6; attempt++) {
  try {
    const ac = new AbortController();
    const t = setTimeout(() => ac.abort(), 30000);
    const r = await fetch(url, {
      headers: { Authorization: 'Bearer ' + tok, 'User-Agent': 'restore' },
      signal: ac.signal,
    });
    clearTimeout(t);
    if (!r.ok) { console.log('  尝试 ' + attempt + '：HTTP ' + r.status); await new Promise((s) => setTimeout(s, 2000)); continue; }
    const text = await r.text();
    writeFileSync(file, text);
    console.log('✓ ' + file + ' 已恢复（' + text.split('\n').length + ' 行，第 ' + attempt + ' 次尝试）');
    process.exit(0);
  } catch (e) {
    console.log('  尝试 ' + attempt + ' 失败：' + e.message);
    await new Promise((s) => setTimeout(s, 2500));
  }
}
console.error('✗ 重试 6 次仍失败');
process.exit(1);
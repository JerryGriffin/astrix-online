// v0.4.18：1936 mod 的依赖图 —— 决定「删到什么程度」才安全
import { readdirSync, statSync, readFileSync } from 'fs';
import { join, relative } from 'path';

const ROOT = process.cwd();
function walk(dir, out = []) {
  for (const n of readdirSync(dir)) {
    const p = join(dir, n);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.js$/.test(n)) out.push(p);
  }
  return out;
}
const files = walk(join(ROOT, 'js')).filter((f) => statSync(f).isFile());

console.log('=== 谁 import 了 hoi1936 ===');
for (const f of files) {
  const rel = relative(ROOT, f).split('\\').join('/');
  const src = readFileSync(f, 'utf8');
  const lines = src.split(/\r?\n/);
  lines.forEach((l, i) => {
    if (/from\s*['"][^'"]*hoi1936\.js/.test(l)) {
      const names = (l.match(/\{([^}]*)\}/) || [, ''])[1].split(',')
        .map((s) => s.trim()).filter(Boolean);
      console.log('  ' + rel + ':' + (i + 1));
      console.log('      ' + names.join(', '));
    }
  });
}

console.log('\n=== 动态 import / 字符串拼接引用 ===');
for (const f of files) {
  const src = readFileSync(f, 'utf8');
  if (/import\(['"][^'"]*hoi1936/.test(src) || /HOI1936|HOI_SCENARIO_ID|HOI_NATIONS|HOI_SEAS|HOI_BY_ID/.test(src)) {
    const rel = relative(ROOT, f).split('\\').join('/');
    const ids = ['HOI1936', 'HOI_SCENARIO_ID', 'HOI_NATIONS', 'HOI_SEAS', 'HOI_BY_ID']
      .filter((k) => src.includes(k));
    console.log('  ' + rel + '  →  ' + ids.join(', '));
  }
}

console.log('\n=== mod 专属文件的规模 ===');
for (const p of ['js/data/hoi1936.js', 'js/core/hoi1936.js']) {
  const src = readFileSync(join(ROOT, p), 'utf8');
  console.log('  ' + p + '  ' + src.split('\n').length + ' 行  '
    + (src.match(/^export /gm) || []).length + ' 个导出');
}
// 扫描「用户可见字符串字面量」里的二战 / 地球术语（排除注释行）
// 用法: node docs/_scan_terms.mjs
import { readFileSync, readdirSync, statSync } from 'fs';
import { join } from 'path';

const TERMS = ['制海权', '海军', '空军', '登陆兵', '步兵师', '装甲师', '师团', '本土', '陆军',
  '集团军', '动员', '登陆', '螺旋桨', '战列舰', '巡洋舰', '驱逐舰', '航空母舰',
  '本土舰队', '海域', '海运', '内战', '二战'];

function walk(dir, out = []) {
  for (const n of readdirSync(dir)) {
    const p = join(dir, n);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (n.endsWith('.js')) out.push(p);
  }
  return out;
}

// 粗略剥离注释：按行去掉 // 开头、以及 /* */ 块
function stripComments(src) {
  const lines = src.split(/\r?\n/);
  let inBlock = false;
  return lines.map((raw) => {
    let l = raw;
    if (inBlock) {
      const e = l.indexOf('*/');
      if (e < 0) return '';
      l = l.slice(e + 2);
      inBlock = false;
    }
    // 去掉行尾注释（不考虑字符串里的 //，本项目极少）
    const c = l.indexOf('//');
    if (c >= 0) l = l.slice(0, c);
    if (l.includes('/*')) {
      const e = l.indexOf('*/', l.indexOf('/*') + 2);
      if (e < 0) { inBlock = true; return l.slice(0, l.indexOf('/*')); }
      l = l.slice(0, l.indexOf('/*')) + ' ' + l.slice(e + 2);
    }
    return l;
  });
}

const files = walk('js');
const hits = {};
for (const f of files) {
  const src = readFileSync(f, 'utf8');
  const clean = stripComments(src);
  clean.forEach((l, i) => {
    if (!/['"]/.test(l)) return;              // 只看含引号的行（字符串字面量）
    for (const t of TERMS) {
      if (l.includes(t)) {
        (hits[t] = hits[t] || []).push(`${f.replace(/\\/g, '/')}:${i + 1}  ${l.trim().slice(0, 100)}`);
      }
    }
  });
}

const keys = Object.keys(hits).sort((a, b) => hits[b].length - hits[a].length);
for (const t of keys) {
  console.log(`\n=== ${t}  (${hits[t].length}) ===`);
  for (const h of hits[t].slice(0, 8)) console.log('  ' + h);
}
console.log('\n总计命中行: ' + Object.values(hits).reduce((s, a) => s + a.length, 0));
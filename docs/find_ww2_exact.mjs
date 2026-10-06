// v0.4.18：精确定位 WWII 残留（逐行给出上下文，便于人工判定真伪）
import { readdirSync, statSync, readFileSync } from 'fs';
import { join, relative } from 'path';

const ROOT = process.cwd();
function walk(dir, out = []) {
  for (const n of readdirSync(dir)) {
    const p = join(dir, n);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.(js|css|html)$/.test(n)) out.push(p);
  }
  return out;
}

// 只查**确定是 WWII / 地球专有**的词；补给线/骑兵 这类通用军事词单独归类
const HARD = [
  '德国', '纳粹', '轴心国', '同盟国', '第三帝国', '大日本', '德意志', '日本帝国',
  '柏林', '巴黎', '东京', '莫斯科', '普鲁士', '莱茵', '多瑙', '阿尔卑斯',
  '正当化', '巴巴罗萨', '四年计划', '三年计划', '总体战', '民族社会主义',
  '师团', '旅团', '方面军', '装甲师', '步兵师', '摩托化师',
  '步兵', '元首', '希特勒', '墨索里尼', '裕仁', '罗斯福', '斯大林', '丘吉尔',
  '欧洲', '亚洲',
];
const SOFT = ['补给线', '骑兵', '军衔', '将军', '元帅', '铁路', '港口', '油田', '煤矿', '钢铁厂', '装甲', '步兵'];

const MOD = new Set(['js/data/hoi1936.js', 'js/core/hoi1936.js']);

const files = walk(join(ROOT, 'js')).concat(walk(join(ROOT, 'css')));
const out = { hard: [], soft: [] };

for (const f of files) {
  const rel = relative(ROOT, f).split('\\').join('/');
  if (rel === 'js/version.js') continue;   // 版本日志是历史记录，保留
  const lines = readFileSync(f, 'utf8').split(/\r?\n/);
  lines.forEach((line, i) => {
    // 跳过纯注释行
    if (/^\s*(\/\/|\*|\/\*)/.test(line)) return;
    const code = line.replace(/\/\/.*$/, '');       // 去掉行尾注释
    for (const t of HARD) if (code.includes(t)) out.hard.push({ rel, ln: i + 1, t, code: code.trim() });
    for (const t of SOFT) if (code.includes(t)) out.soft.push({ rel, ln: i + 1, t, code: code.trim() });
  });
}

console.log('=== 硬命中（确定的 WWII / 地球专有词）===');
const byFile = new Map();
for (const h of out.hard) {
  if (!byFile.has(h.rel)) byFile.set(h.rel, []);
  byFile.get(h.rel).push(h);
}
for (const [rel, hits] of byFile) {
  console.log('\n  ' + rel + (MOD.has(rel) ? '   ← mod 专属文件' : ''));
  for (const h of hits.slice(0, 8)) {
    console.log('    ' + String(h.ln).padStart(5) + ' [' + h.t + ']  ' + h.code.slice(0, 96));
  }
  if (hits.length > 8) console.log('    … 另有 ' + (hits.length - 8) + ' 处');
}
console.log('\n硬命中文件数：' + byFile.size);

console.log('\n\n=== 软命中（通用军事词，多为误报；仅列非 mod 文件）===');
const sByFile = new Map();
for (const h of out.soft) {
  if (MOD.has(h.rel)) continue;
  if (!sByFile.has(h.rel)) sByFile.set(h.rel, []);
  sByFile.get(h.rel).push(h);
}
for (const [rel, hits] of sByFile) {
  console.log('  ' + rel + ' → ' + [...new Set(hits.map((h) => h.t))].join('、')
    + '  （' + hits.length + ' 处）');
  for (const h of hits.slice(0, 3)) console.log('      ' + h.ln + '  ' + h.code.slice(0, 92));
}
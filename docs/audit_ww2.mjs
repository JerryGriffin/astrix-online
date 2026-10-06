// v0.4.18：二战 / 地球相关内容的彻底审计
//
// 目的：确认「风暴前夜」1936 剧本与二战/地球术语**只**存在于冻结的 mod 文件里，
//   正常模式（普通太空剧本）一行都不该有。
//
// 分三档报告：
//   A. mod 专属文件（预期存在，但应被彻底隔离、且不再更新）
//   B. 正常模式文件里的残留（**这才是问题**，必须清零）
//   C. 通用引擎文件里的二战术语（即使只在 mod 分支用，也该换掉）
import { readdirSync, statSync, readFileSync } from 'fs';
import { join, relative } from 'path';

const ROOT = process.cwd();

function walk(dir, out = []) {
  for (const n of readdirSync(dir)) {
    const p = join(dir, n);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.(js|mjs|html|css|json|md)$/.test(n)) out.push(p);
  }
  return out;
}
const files = walk(join(ROOT, 'js')).concat(walk(join(ROOT, 'css'))).filter((f) => statSync(f).isFile());

// ---- 词表：二战轴心国/同盟国、真实国名、地球地理 ----
const TERMS = [
  // 国家 / 政权
  '德国', '纳粹', '轴心国', '同盟国', '第三帝国', '大日本', '意大利', '法国', '英国', '苏联',
  '德意志', '日本帝国', '大英', '美利坚', '俄罗斯', '波兰', '西班牙', '葡萄牙', '荷兰',
  '比利时', '希腊', '土耳其', '瑞典', '挪威', '丹麦', '芬兰', '瑞士', '奥地利', '捷克斯洛伐克',
  '南斯拉夫', '罗马尼亚', '保加利亚', '匈牙利', '爱尔兰', '乌克兰', '白俄罗斯',
  // 英文 id / 代码
  'ger', 'fra', 'jpn', 'ita', 'srb', 'pol', 'esp', 'ned', 'bel', 'gre', 'tur', 'swe', 'nor',
  'ger1936', 'gerritory', 'GER_',
  // 地球地理
  '欧洲', '亚洲', '柏林', '巴黎', '东京', '莫斯科', '伦敦', '维也纳', '华沙', '罗马',
  '普鲁士', '莱茵', '多瑙', '阿尔卑斯', '易北河', '奥得河',
  // 二战机制 / 词汇
  '正当化', '宣战理由', '停战协定', '闪电战', '闪击', '巴巴罗萨', '海狮行动',
  '总体战', '民族社会主义', '战时经济', '三年计划', '四年计划', '军费',
  '装甲师', '摩托化师', '步兵师', '骑兵师', '空军师', '航空师', '步兵', '骑兵', '炮兵',
  '师团', '旅团', '集团军', '方面军', '军衔', '将军', '元帅', '上校', '中校',
  '补给线', '铁路', '港口', '油田', '煤矿', '钢铁厂',
  // 真实战争/政治人物
  '希特勒', '墨索里尼', '裕仁', '罗斯福', '斯大林', '丘吉尔',
];

// mod 专属文件（预期容纳全部 WWII 内容）
const MOD_FILES = new Set([
  'js/data/hoi1936.js',
  'js/core/hoi1936.js',
]);

const stripComments = (s) =>
  s.split('\n')
    .map((l) => l.replace(/^\s*(\/\/|\*|\/\*).*$/, ''))
    .filter((l) => !/^\s*$/.test(l))
    .join('\n');

const buckets = { mod: [], leak: [] };

for (const f of files) {
  const rel = relative(ROOT, f).split('\\').join('/');
  const raw = readFileSync(f, 'utf8');
  // 只看「有效代码」：注释里的历史说明不算残留
  const code = stripComments(raw);
  const hits = [];
  for (const t of TERMS) {
    // 词边界：短英文 id 用词边界，避免 ger 命中 target
    const re = /^[a-z_]{2,}$/i.test(t)
      ? new RegExp('\\b' + t + '\\b', 'i')
      : new RegExp(t);
    if (re.test(code)) hits.push(t);
  }
  if (!hits.length) continue;
  const rec = { file: rel, hits: [...new Set(hits)] };
  (MOD_FILES.has(rel) ? buckets.mod : buckets.leak).push(rec);
}

console.log('=== A. mod 专属文件（预期容纳 WWII 内容，隔离在冻结 mod 里）===');
for (const r of buckets.mod) console.log('  ' + r.file + '  命中 ' + r.hits.length + ' 个词');
if (!buckets.mod.length) console.log('  （无）');

console.log('\n=== B. mod 之外的残留（这是必须清零的部分）===');
for (const r of buckets.leak) {
  console.log('  ' + r.file);
  console.log('      ' + r.hits.join('、'));
}
if (!buckets.leak.length) console.log('  （无残留）');

console.log('\n统计：mod 文件 ' + buckets.mod.length + ' 个 · 外部残留文件 ' + buckets.leak.length + ' 个');
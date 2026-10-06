// 查：除 planet/army/fleet/hoi 自身外，还有谁引用这三个 tab key
import { readdirSync, statSync, readFileSync } from 'fs';
import { join, relative } from 'path';

const ROOT = process.cwd();
const SELF = new Set(['planet.js', 'army.js', 'fleet.js', 'hoi.js']);

function walk(dir, out = []) {
  for (const n of readdirSync(dir)) {
    const p = join(dir, n);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.(js|mjs)$/.test(n)) out.push(p);
  }
  return out;
}

const NEEDLE = /selectTab\s*\(|\btab\s*===|'(army|hoi|fleet)'|"(army|hoi|fleet)"/g;

let hits = 0;
for (const f of walk(join(ROOT, 'js'))) {
  const base = f.split(/[\\/]/).pop();
  if (SELF.has(base)) continue;
  const src = readFileSync(f, 'utf8');
  const lines = src.split(/\r?\n/);
  lines.forEach((line, i) => {
    if (!NEEDLE.test(line)) return;
    NEEDLE.lastIndex = 0;
    hits++;
    console.log(relative(ROOT, f) + ':' + (i + 1) + '  ' + line.trim().slice(0, 100));
  });
  NEEDLE.lastIndex = 0;
}
console.log('\n共 ' + hits + ' 处');
if (!hits) console.log('（没有外部引用 —— tab key 只在 planet.js 内部使用，合并是安全的）');
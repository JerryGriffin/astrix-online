// v0.4.13（③）修语法：部署徽标里 el() 的 class 参数后漏了一个逗号
import { readFileSync, writeFileSync } from 'fs';

const FILE = 'js/ui/army.js';
let src = readFileSync(FILE, 'utf8');

const bad  = "dep.appendChild(el('span', 'army-deploy-txt'\n";
const good = "dep.appendChild(el('span', 'army-deploy-txt',\n";

const n = src.split(bad).length - 1;
if (n !== 1) { console.error('✗ 期望命中 1 次，实际 ' + n); process.exit(1); }

src = src.replace(bad, good);
writeFileSync(FILE, src, 'utf8');
console.log('✓ 补回缺失的逗号（命中 ' + n + ' 处）');
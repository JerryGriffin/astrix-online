// 通过 GitHub API 设置仓库的 license 分类（GitHub 据此在侧栏显示 License 徽章）
import { readFileSync } from 'fs';

const tok = (readFileSync('.git/config', 'utf8').match(/url = https:\/\/[^:@\/]+:([^@\/]+)@github\.com/) || [])[1];
if (!tok) { console.error('✗ 拿不到令牌'); process.exit(1); }

const H = {
  Authorization: 'Bearer ' + tok,
  Accept: 'application/vnd.github+json',
  'Content-Type': 'application/vnd.github+json',
  'User-Agent': 'astrix-license',
};

// 1) 先确认 LICENSE 已被 GitHub 识别
const lic = await (await fetch('https://api.github.com/repos/JerryGriffin/astrix-online/license', { headers: H })).json();
if (lic && lic.license) {
  console.log('✓ GitHub 已识别 LICENSE：' + lic.license.spdx_id + '（' + lic.license.name + '）');
} else {
  console.log('· GitHub 尚未识别（LICENSE 可能还没推上去）— 先推送再重跑本脚本');
}

// 2) 设置仓库 license 分类
const r = await fetch('https://api.github.com/repos/JerryGriffin/astrix-online', {
  method: 'PATCH',
  headers: H,
  body: JSON.stringify({
    license_template: 'mit',
    description: 'Astrix · 太空殖民 —— 零构建（原生 HTML/CSS/JS + ES Modules）太空殖民模拟游戏',
    has_wiki: false,
  }),
});
const j = await r.json();
if (!r.ok) {
  console.error('✗ 设置失败 HTTP ' + r.status + '：' + (j.message || ''));
  process.exit(1);
}
console.log('✓ 仓库 license = ' + (j.license ? j.license.spdx_id : '(未返回)'));
console.log('  description = ' + j.description);
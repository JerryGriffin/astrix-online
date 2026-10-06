// v0.4.13（③）军队页：显示该师当前的部署状态（战区 / 交战小时 / 师状态）
import { readFileSync, writeFileSync } from 'fs';

const FILE = 'js/ui/army.js';
let src = readFileSync(FILE, 'utf8');
const NL = src.includes('\r\n') ? '\r\n' : '\n';

// ---- 1) 注入 findDeployment 辅助函数（放在文件靠前的工具区，renderArmyPage 之前）----
const anchor = 'export function renderArmyPage(root, ctx) {';
if (!src.includes(anchor)) { console.error('✗ 找不到 renderArmyPage 锚点'); process.exit(1); }

const helper = [
  '// v0.4.13（③）：查某支军队当前是否在某个进行中的战役里，以及它在哪个战区。',
  '//   数据直接读 acc.battles —— 那是战役引擎的唯一事实来源，不另建索引（避免两份状态打架）。',
  '//   regionName 优先用战区的真实名字（core/theater.js 已生成），没有则退回「未知战区」。',
  'function findDeployment(acc, armyId) {',
  '  for (const b of (Array.isArray(acc && acc.battles) ? acc.battles : [])) {',
  '    if (!b || b.status !== \'active\') continue;',
  '    const d = (b.mine || []).find((x) => x && x.armyId === armyId);',
  '    if (!d) continue;',
  '    let regionName = \'未知战区\';',
  '    try {',
  '      const rg = (acc.theater && acc.theater.regions || [])',
  '        .find((r) => r && r.id === b.regionId);',
  '      if (rg && rg.nameCn) regionName = rg.nameCn;',
  '    } catch (e) { /* 战区尚未生成时不影响部署提示 */ }',
  '    const stateCn = (',
  '      d.state === \'front\' ? \'接战中\'',
  ': d.state === \'reserve\' ? \'预备队\'',
  ': d.state === \'routed\' ? \'溃退整补中\'',
  ': \'待命\');',
  '    return {',
  '      battleId: b.id, regionId: b.regionId || null, regionName,',
  '      hours: Number(b.hours) || 0,',
  '      maxHours: Number(b.maxHours) || 0,',
  '      state: d.state, stateCn,',
  '    };',
  '  }',
  '  return null;',
  '}',
  '',
  '',
].join('\n');

if (src.includes('function findDeployment(')) {
  console.log('· findDeployment 已存在，跳过注入');
} else {
  src = src.replace(anchor, helper + anchor);
  console.log('✓ 注入 findDeployment');
}

// ---- 2) 在 army row 上渲染部署徽标 ----
const marker = 'row.appendChild(info);';
if (!src.includes(marker)) { console.error('✗ 找不到 row.appendChild(info)'); process.exit(1); }
const block = [
  'row.appendChild(info);',
  '',
  '  // v0.4.13（③）：显示该师当前的部署状态。军队投入战役后 `committableArmies`',
  '  //   会把它排除，界面上就变成「这支师不见了」；本页此前完全不显示它去了哪个战区。',
  '  const inBattle = findDeployment(acc, a.id);',
  '  if (inBattle) {',
  '    const dep = el(\'div\', \'army-deploy\');',
  '    dep.appendChild(el(\'span\', \'army-deploy-tag\', \'⚔ 交战中\'));',
  '    dep.appendChild(el(\'span\', \'army-deploy-txt\'',
  '      inBattle.regionName + \' · \' + inBattle.hours + \'/\' + inBattle.maxHours + \' 小时\'',
  '      + \'　\' + inBattle.stateCn));',
  '    dep.title = \'该师正在战区作战，结束后回到待命列表\';',
  '    row.appendChild(dep);',
  '  }',
].join('\n');

const firstIdx = src.indexOf(marker);
if (src.slice(firstIdx, firstIdx + 400).includes('findDeployment(acc, a.id)')) {
  console.log('· 部署徽标已存在，跳过');
} else {
  src = src.slice(0, firstIdx) + block + src.slice(firstIdx + marker.length);
  console.log('✓ 插入部署徽标');
}

writeFileSync(FILE, src, 'utf8');
console.log('换行风格: ' + (NL === '\r\n' ? 'CRLF' : 'LF'));
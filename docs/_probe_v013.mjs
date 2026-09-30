// v0.1.3 需求专项探针（全部相对导入带 ?v=13.0，避免双模块实例）
import * as R from '../js/data/recipes.js?v=26.6';
import * as SP from '../js/data/ship_parts.js?v=26.6';
import * as S from '../js/core/state.js?v=26.6';

let pass = 0, fail = 0;
function ok(cond, msg) {
  if (cond) { pass++; console.log('  ✓ ' + msg); }
  else { fail++; console.log('  ✗ ' + msg); }
}

console.log('== 需求2 电解池 水+碳→甲烷+氧气 ==');
const m = R.RECIPES.find((r) => r.id === 'r_el_methane');
ok(!!m, 'r_el_methane 配方存在');
if (m) {
  ok(m.buildingId === 'electrolyzer', 'buildingId=electrolyzer，实际 ' + m.buildingId);
  ok(m.inputs['水'] === 2 && m.inputs['碳'] === 1, '输入 水2+碳1');
  ok(m.outputs['甲烷'] === 1 && m.outputs['氧气'] === 2, '输出 甲烷1+氧气2');
}

console.log('== 需求3 气体层采集 ×5 ==');
ok(S.GAS_COLLECT_RATE_MUL === 5, 'GAS_COLLECT_RATE_MUL=5');

console.log('== 需求4 乘员仓材料槽 ==');
const crew = SP.PART_BY_ID['fac_crew_mk1'] || SP.FACILITIES.find((f) => f.id === 'fac_crew');
ok(!!crew && crew.materialSlot === 'hull', 'fac_crew materialSlot=hull，实际 ' + (crew && crew.materialSlot));
ok(crew && SP.MATERIAL_SLOTS.hull.includes(SP.DEFAULT_MATERIAL.hull), '默认材料铁在 hull 槽内');

console.log('== 需求5 深空开局送燃料 ==');
const acc = S.createAccount('探针', 'deep');
ok(!!acc, '深空开局账号创建');
const ships = acc.ships || [];
ok(ships.length > 0, '开局有 ' + ships.length + ' 艘船');
const minFuel = Math.min(...ships.map((s) => Number(s.state && s.state.fuelMol) || 0));
ok(minFuel >= 2000, '每艘船燃料 ≥2000 mol，最小 ' + minFuel);

console.log('\n== 结果: 通过 ' + pass + ' / 失败 ' + fail + ' ==');
if (fail > 0) process.exit(1);
console.log('全部探针通过 ✅');

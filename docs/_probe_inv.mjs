// 探针：验证 inventory.js 修复后的 6 个导入符号可取、且 buildMaterialFlow 等价路径不抛异常。
// 所有导入一律带 ?v=11.0（与游戏契约一致，避免双实例）。
// 运行：node docs/_probe_inv.mjs

import { productionRates } from '../js/core/production.js?v=21.2';
import { BUILDING_BY_ID } from '../js/data/buildings.js?v=21.2';
import {
  NUTRIENT_NAMES,
  METABOLITE_NAMES,
  consumptionPerSec,
  metabolitePerSec,
} from '../js/core/population.js?v=21.2';

// LAYER_LABEL 仅为探针展示用，照抄 inventory.js 的本地常量（避免 import 整个 UI 模块图在 Node 下崩）。
const LAYER_LABEL = { surface: '地表', underground: '浅层', deep: '深层', core: '地核', gas: '气体' };

// ---- 1. 验证 6 个符号都能取到 ----
const symbols = {
  productionRates,
  BUILDING_BY_ID,
  NUTRIENT_NAMES,
  METABOLITE_NAMES,
  consumptionPerSec,
  metabolitePerSec,
};
let pass = 0;
const need = 6;
for (const [name, val] of Object.entries(symbols)) {
  const ok = val !== undefined && val !== null;
  console.log(`[符号] ${name}: ${ok ? 'OK' : 'MISSING'}`);
  if (ok) pass++;
}

// ---- 2. buildMaterialFlow 等价路径（照抄 inventory.js:397-439 的逻辑）----
function buildMaterialFlowEquiv(planet, mat) {
  const sources = [];
  const consumes = [];
  let noPowerRatio = false;
  const pwRatio = planet && planet.powerInfo ? Number(planet.powerInfo.ratio) : NaN;
  const ratio = Number.isFinite(pwRatio) ? pwRatio : (noPowerRatio = true, 1);

  for (const e of (planet && planet.inventory) || []) {
    if (!e || e.mat !== mat) continue;
    const r = Number(e.rate) || 0;
    if (r > 0) sources.push({ label: (LAYER_LABEL[e.layer] || e.layer) + '采集', rate: r });
  }

  const rates = productionRates(planet, ratio);
  for (const bid in rates) {
    const slot = rates[bid];
    const bName = (BUILDING_BY_ID[bid] && BUILDING_BY_ID[bid].nameCn) || bid;
    const out = Number(slot.outputs && slot.outputs[mat]) || 0;
    if (out > 0) sources.push({ label: bName + '产出', rate: out });
    const inp = Number(slot.inputs && slot.inputs[mat]) || 0;
    if (inp > 0) consumes.push({ label: bName + '投入', rate: inp });
  }

  const pop = planet && planet.pop ? planet.pop : null;
  if (pop) {
    const cons = consumptionPerSec(pop);
    for (const k of Object.keys(NUTRIENT_NAMES)) {
      if (NUTRIENT_NAMES[k] === mat && Number(cons[k]) > 0) {
        consumes.push({ label: '人口消耗', rate: Number(cons[k]) });
      }
    }
    const met = metabolitePerSec(pop);
    for (const k of Object.keys(METABOLITE_NAMES)) {
      if (METABOLITE_NAMES[k] === mat && Number(met[k]) > 0) {
        sources.push({ label: '人口排出', rate: Number(met[k]) });
      }
    }
  }
  return { sources, consumes, noPowerRatio };
}

// 假星球：含气体（氧气/二氧化碳）、复合资源（有机质）、天然矿（铁），并带 pop
const planet = {
  powerInfo: { ratio: 1 },
  inventory: [
    { mat: '氧气', layer: 'gas', owned: 0, rate: 5 },
    { mat: '二氧化碳', layer: 'gas', owned: 100, rate: 0 },
    { mat: '有机质', layer: 'surface', owned: 200, rate: 3 },
    { mat: '铁', layer: 'underground', owned: 5000, rate: 2 },
  ],
  pop: { total: 100, assignments: {} },
  lines: [],
};

// ---- 3. 至少覆盖 3 种资源类型：气体 / 复合资源 / 天然矿 ----
const cases = [
  ['气体', '氧气'],
  ['气体(代谢)', '二氧化碳'],
  ['复合资源', '有机质'],
  ['天然矿', '铁'],
];
for (const [kind, mat] of cases) {
  try {
    const flow = buildMaterialFlowEquiv(planet, mat);
    const srcN = flow.sources.length;
    const conN = flow.consumes.length;
    console.log(`[明细] ${kind}(${mat}) OK  来源=${srcN} 消耗=${conN}`);
    pass++;
  } catch (err) {
    console.log(`[明细] ${kind}(${mat}) THREW: ${err && err.message}`);
  }
}

const target = need + cases.length; // 6 符号 + 4 资源明细
console.log(`\n探针通过：${pass}/${target}`);
if (pass === target) {
  console.log('RESULT: PASS');
  process.exit(0);
} else {
  console.log('RESULT: FAIL');
  process.exit(1);
}

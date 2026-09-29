// 永久升级数据模块（Astrix）
// 纯 ES module，零依赖，浏览器直接 import。
//
// 说明：升级（UPGRADES）是永久提升效率/产出的体系，与「科技（TECHS）解锁建筑」是两套独立体系。
// 科技靠研究点解锁建筑与资源；升级靠研究点永久强化各项产出与建造速度。
//
// ============================================================================
// v0.1.2 R18：科研升级「效果」由等差改为乘方
// ============================================================================
// 价格字段（baseCost / growth）保持不变，仍是几何级：第 level 级花费 = baseCost × growth^level。
// 「效果」改为乘方形式：
//    效果_n = 首级效果(effectBase) × 底数(effectPow)^(n-1)   （n 从 1 开始）
// 导出 upgradeMul(acc, key) 返回该项当前的「乘算系数」：未购买返回 1，
// 已购买返回 1 + effectBase × effectPow^(level-1)。core 与 UI 都调它，禁止两处各写一套公式。
//
// ---- 各 key 的接线语义（供 Lead 在汇聚层 state.js / production.js / power.js 接线）----
//   upg_collect  → 采集速率（× upgradeMul，>1 加速采集工/采集建筑产出）
//   upg_refine   → 加工/冶炼产出（× upgradeMul，>1 提高精炼线产出）
//   upg_power    → 发电量（× upgradeMul，>1 提高发电设施出力）
//   upg_labor    → 人力产出（× upgradeMul，>1 提高各岗位 jobOutput）
//   upg_research → 研究点产出（× upgradeMul，>1 提高科研所增速）
//   upg_build    → 建筑施工工作量（× upgradeMul，此时系数 <1 表示减少工作量，build 升级负向）
//   offline_ratio→ 离线折算比例（线性 +0.05/级，已在 state.js 接线，不归本乘算模型，upgradeMul 对其返回 1）
//   extreme_work → 极限档产出/消耗倍率（已在 population.js 接线，不归本乘算模型，upgradeMul 对其返回 1）
// 注：后两项 effectBase 不设置，upgradeMul 默认返回 1，避免污染其既有线性接线。
// ============================================================================

export const UPGRADES = [
  { id: 'upg_collect', nameCn: '采集效率', effect: '+10% 采集速率', effectBase: 0.10, effectPow: 1.6, baseCost: 500, growth: 1.5, maxLevel: Infinity, desc: '每级 +10% 采集速率（乘方累积，底数 1.6），永久生效。' },
  { id: 'upg_refine', nameCn: '冶炼效率', effect: '+10% 冶炼产出', effectBase: 0.10, effectPow: 1.6, baseCost: 800, growth: 1.5, maxLevel: Infinity, desc: '每级 +10% 冶炼产出（乘方累积，底数 1.6），永久生效。' },
  { id: 'upg_power', nameCn: '发电效率', effect: '+10% 发电量', effectBase: 0.10, effectPow: 1.6, baseCost: 800, growth: 1.5, maxLevel: Infinity, desc: '每级 +10% 发电量（乘方累积，底数 1.6），永久生效。' },
  { id: 'upg_labor', nameCn: '人力效率', effect: '+10% 人力产出', effectBase: 0.10, effectPow: 1.6, baseCost: 1000, growth: 1.5, maxLevel: Infinity, desc: '每级 +10% 人力产出（乘方累积，底数 1.6），永久生效。' },
  { id: 'upg_research', nameCn: '研究效率', effect: '+10% 研究点产出', effectBase: 0.10, effectPow: 1.6, baseCost: 1200, growth: 1.5, maxLevel: Infinity, desc: '每级 +10% 研究点产出（乘方累积，底数 1.6），永久生效。' },
  { id: 'upg_build', nameCn: '建筑施工', effect: '-8% 建造工作量', effectBase: -0.08, effectPow: 1.6, baseCost: 1000, growth: 1.5, maxLevel: Infinity, desc: '每级 -8% 建造工作量（乘方累积，底数 1.6），系数 <1 表示减少。' },
  // v0.1.0 新增（效果接线在 state.js：按等级写离线折算比例）：
  //   基础 0.25，每级 +0.05（1 级 0.30 …）。线性，不归乘方模型，effectBase 不设置 → upgradeMul 返回 1。
  { id: 'offline_ratio', nameCn: '离线收益提升', effect: '离线折算比例 +0.05', baseCost: 20000, growth: 1.6, maxLevel: Infinity, desc: '离线时按应有产量的比例结算，每级 +0.05。' },
  // v0.1.0 新增（效果接线在 population.js：getIntensity 按 inst.pop.extremeWorkLevel 放大极限档）：
  //   每级让极限档产出倍率 ×1.10、消耗倍率 ×1.15。线性，不归乘方模型 → upgradeMul 返回 1。
  { id: 'extreme_work', nameCn: '极限工作强化', effect: '极限档产出 ×1.10、消耗 ×1.15（每级）', baseCost: 50000, growth: 1.8, maxLevel: Infinity, desc: '极限档产出更高、消耗也更高：每级让极限档产出倍率 ×1.10、消耗倍率 ×1.15。' },
];

// id → 定义 的查找表（供 upgradeMul / UI 直接按 key 取定义）
export const UPGRADE_BY_ID = Object.fromEntries(UPGRADES.map((u) => [u.id, u]));

// 第 level 级升级花费 = baseCost × growth^level（结果取整）。价格几何级，本版不动。
export function upgradeCost(upg, level) {
  return Math.round(upg.baseCost * Math.pow(upg.growth, level));
}

// 给定升级定义与等级，返回该等级的「乘算系数」。
// 等级 0（含未购买/非法）返回 1（恒等）。
// 效果_n = effectBase × effectPow^(n-1)，系数 = 1 + 效果_n。
export function upgradeFactorAt(upg, level) {
  const lv = Number(level) || 0;
  if (!lv) return 1;
  const base = (upg.effectBase != null) ? upg.effectBase : 0;
  const pow = (upg.effectPow != null) ? upg.effectPow : 1.6;
  return 1 + base * Math.pow(pow, lv - 1);
}

// 按账号当前等级返回某升级的乘算系数（未购买返回 1）。
// core（state/production/power 接线层）与 UI 都调它，避免两处各写一套公式。
export function upgradeMul(acc, key) {
  const u = UPGRADE_BY_ID[key];
  if (!u) return 1;
  const lv = (acc && acc.upgrades && acc.upgrades[key]) || 0;
  return upgradeFactorAt(u, lv);
}

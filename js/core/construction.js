// 施工系统核心逻辑（Astrix v0.0.4）
// 纯计算模块，不碰 DOM。
//
// ============================================================================
// 设计者 v0.0.4 的规则
// ============================================================================
// 「开局有一个建筑工厂，在其中工作才能建筑而非增加建筑速率」
// 也就是说：建筑工厂不是「加速器」，而是**硬门槛**——
//   1. 星球上必须先有至少 1 座建筑工厂，否则施工速度恒为 0；
//   2. 且必须有至少 1 名人力被分配到「建筑工」职业（该职业挂在建筑工厂下），
//      否则同样为 0；
//   3. 建筑工超过建筑工厂提供的工位总数时，多出来的人不产生施工速度。
// 结论：人 → 建筑工厂工位 → 施工速度（人·秒/秒）。

import { BUILDING_BY_ID } from '../data/buildings.js?v=26.7';
import { getJobCount, jobOutput } from './population.js?v=26.7';
// v0.1.2（需求 18/19）：永久升级「建筑施工」的乘方效果，唯一实现在 data/upgrades.js#upgradeMul
import { upgradeMul } from '../data/upgrades.js?v=26.7';

export const BUILDER_JOB_ID = 'builder';
export const BUILD_FACTORY_ID = 'workshop';

// 1 个有效建筑工每秒产出多少「人·秒」的施工量
export const WORK_PER_SEC = 1;

// 建筑工厂提供的总工位（counts 为 { [buildingId]: 数量 }）
export function buildFactorySlots(counts = {}) {
  const n = Number(counts[BUILD_FACTORY_ID]) || 0;
  const b = BUILDING_BY_ID[BUILD_FACTORY_ID];
  return n > 0 && b ? n * b.jobs : 0;
}

// 当前每秒的实际施工量（人·秒/秒）。返回 0 就表示「完全不能施工」。
// v0.1.2（需求 19）：接上「建筑施工」永久升级。该项是「减少建造工作量」，
//   所以这里要**提速**（乘 1/系数），并夹在 1~5 倍——不夹的话乘方效果到
//   中后期会把建造时间压到接近 0。
export function buildRateOf(pop, counts = {}, acc = null) {
  if (!pop) return 0;
  const slots = buildFactorySlots(counts);
  if (slots <= 0) return 0;                       // 没有建筑工厂 → 不能施工
  const output = jobOutput(pop, BUILDER_JOB_ID);  // 人数 × 强度产出倍率
  if (output <= 0) return 0;                      // 没人在建筑工厂 → 不能施工
  const speedMul = acc
    ? Math.min(5, Math.max(1, 1 / (Number(upgradeMul(acc, 'upg_build')) || 1)))
    : 1;
  return Math.min(output, slots) * WORK_PER_SEC * speedMul;
}

// 能否施工（UI 用它决定按钮是否可点）
export function canBuild(pop, counts = {}) {
  return buildRateOf(pop, counts) > 0;
}

// 给一个「为什么不能施工」的原因，直接喂给 UI
export function buildBlockReason(pop, counts = {}) {
  if (buildFactorySlots(counts) <= 0) {
    return '本星球还没有建筑工厂：必须先造一座，施工才会开工。';
  }
  if (getJobCount(pop, BUILDER_JOB_ID) <= 0) {
    return '建筑工厂里没人：请把人力分配到「建筑工」，否则施工速度恒为 0。';
  }
  return null;
}

// 某项工程（工作量 work 人·秒）在给定施工速度下要多久
export function buildTimeSec(work, rate) {
  if (!(rate > 0)) return Infinity;
  return work / rate;
}

// 某建筑的第 ownedCount+1 座，在该施工速度下要多久（秒）
export function buildTimeForBuilding(buildingId, ownedCount, rate) {
  const b = BUILDING_BY_ID[buildingId];
  if (!b) return Infinity;
  return buildTimeSec(b.work, rate);
}

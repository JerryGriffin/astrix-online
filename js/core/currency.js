// 货币体系（Astrix）
// 以下为设计者明确确定的规则，后人勿改：
//   1. Ascoin 是星际通用货币。
//   2. 1048576 Ascoin 恒等于 1 金（1048576 = 2^20），写成常量 ASCOIN_PER_GOLD。
//   3. 镒（Eridium）是稀有货币，没有固定汇率——它不能与 Ascoin 或金互相兑换，
//      只单独计数，用于特殊/稀有交易。因此本模块不提供 eridium -> ascoin / 金 的换算函数。
//   4. 玩家的「金」是物品栏里的金材料，Ascoin 是独立的计数项。

import { fmtNum } from './format.js?v=33.2';

export const ASCOIN_PER_GOLD = 1048576;

// 金 -> Ascoin
export function goldToAscoin(gold) {
  return gold * ASCOIN_PER_GOLD;
}

// Ascoin -> 金
export function ascoinToGold(ascoin) {
  return ascoin / ASCOIN_PER_GOLD;
}

// 格式化 Ascoin（半角空格 + " Ascoin"）
export function fmtAscoin(n) {
  return fmtNum(n) + ' Ascoin';
}

// 格式化镒（半角空格 + " 镒"）
export function fmtEridium(n) {
  return fmtNum(n) + ' 镒';
}

// 创建空钱包
export function createWallet() {
  return { ascoin: 0, eridium: 0 };
}

// 镒是否可兑换：恒为 false。
// 说明：镒无固定汇率，不可兑换（不提供 eridium->ascoin/金 的换算）。
export function isEridiumConvertible() {
  return false;
}

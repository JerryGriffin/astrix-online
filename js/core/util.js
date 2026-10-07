// ============================================================================
// core/util.js —— 通用小工具（v0.4.7 新增）
//
// 为什么要建这个文件
//   本项目零构建、无公共依赖层，clamp / mulberry32 / hash32 此前在 5~2 个模块里
//   各写一份（battle.js 的注释甚至写明「与 army.js 同款 mulberry32」）。
//   同一公式的多份副本是回归的温床 —— 改一处忘另一处，症状极难定位。
//   这里是它们（以及 softFail）的**唯一实现**，各模块改为 import。
//
// 铁律：本文件不得 import 任何项目内模块（保持零依赖，避免循环引用）。
// ============================================================================

/**
 * 数值夹取到 [lo, hi]
 *
 * 注意：刻意保留 NaN 传播语义（与收敛前各模块的 `Math.max(lo, Math.min(hi, v))`
 * 完全一致）。非数值输入仍返回 NaN，而不是回退到 lo —— 这样在收敛过程中
 * 不改变任何既有战斗/地图结果，零回归风险。
 */
export function clamp(v, lo, hi) {
  return Math.max(lo, Math.min(hi, v));
}

/** 夹取到 [0, 1]（比例类数值专用，避免各处重复写 Math.max(0, Math.min(1, x))） */
export function clamp01(v) {
  return clamp(v, 0, 1);
}

/**
 * 可复现的伪随机数发生器（mulberry32）。
 * 战斗与地图结算必须可复现 —— 用 Math.random() 会让同一份存档重算出不同结果。
 * @param {number} seed 32 位整数种子
 * @returns {() => number} 返回 [0,1) 的函数
 */
export function mulberry32(seed) {
  let a = (Number(seed) || 0) >>> 0;
  return function next() {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * 字符串 → 32 位整数哈希（FNV-1a 变体）。
 * 用于「按存档/战区种子稳定地取随机值」，保证同一 seed 永远得到同一结果。
 */
export function hash32(str) {
  const s = String(str == null ? '' : str);
  let h = 2166136261 >>> 0;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h >>> 0;
}

// ---------------------------------------------------------------------------
// softFail：静默失败的「可观测化」
//
// 背景（本项目反复踩的坑）
//   心跳/tick 里到处是 `catch (e) { /* 忽略 */ }`，一处异常就把整块功能静默停掉，
//   界面上表现为「按钮没反应 / 区块不显示 / 功能没生效」，且**没有任何日志**。
//   v0.4.6 的 P0-1（敌方夹击 AI 因未声明变量崩溃）就是这样被完全掩盖的 ——
//   自检全绿、功能整块失效、零线索。
//
// 用法
//   try { doSomething(); } catch (e) { softFail('地图层', e); }
//
// 语义
//   · 不抛、不中断心跳（保持原有意图：单块异常不拖垮整个 tick）
//   · 输出到 console.warn，带统一前缀便于检索与定位
//   · **同一条 tag+message 在一个会话内只报一次**（去重）——
//     每 tick 都抛的异常会把控制台刷爆，真正的错误反而看不见。
//   · 设 localStorage.astrix_softfail=1（或 ?softfail=1）可关闭去重、输出全部。
// ---------------------------------------------------------------------------

const SOFT_FAIL_SEEN = new Set();

function softFailAllEnabled() {
  try {
    if (typeof localStorage !== 'undefined' && localStorage.getItem('astrix_softfail') === '1') return true;
  } catch (e) { /* 隐私模式下读不到，忽略 */ }
  try {
    if (typeof location !== 'undefined' && /[?&]softfail=1/.test(location.search || '')) return true;
  } catch (e) { /* 非浏览器环境，忽略 */ }
  return false;
}

/**
 * 记录一处被吞掉的异常。
 * @param {string} tag 出错的功能块名，如 '地图层' / '战区产出'
 * @param {any} err 捕获到的异常
 */
export function softFail(tag, err) {
  const msg = (err && (err.message || err.stack)) || String(err || '未知错误');
  const key = String(tag) + '|' + msg.slice(0, 120);
  if (softFailAllEnabled() || !SOFT_FAIL_SEEN.has(key)) {
    if (!SOFT_FAIL_SEEN.has(key)) SOFT_FAIL_SEEN.add(key);
    console.warn('[Astrix] ' + tag + ' 异常（已忽略，不影响心跳）:', err);
  }
}

/** 仅供测试：清空去重缓存 */
export function resetSoftFailSeen() {
  SOFT_FAIL_SEEN.clear();
}

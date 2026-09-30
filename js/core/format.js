// 数字与时间格式化工具（Astrix 全局复用，无外部依赖）
// 单位：k=1e3, m=1e6, g=1e9, t=1e12，超过 1e15 走科学记数法。
// 另保留 fmtSigned / parseCount 以兼容其它模块的历史调用。
//
// ============================================================================
// v0.0.7 全站去单位（设计者要求「单位都不要显示」）
// ============================================================================
// 本次改动移除三处被拼进字符串的「单位」字样，调用方无需改动（函数名 / 签名不变）：
//   ① fmtRate(n)         —— 去掉结尾的 `/s`（此前返回 `+0.2000/s`，现返回 `+0.2000`）。
//   ② fmtTime(sec)       —— 去掉 `d / min / s` 进位后缀，不再把秒进位成「3d / 5min / 42s」，
//                            只返回纯数字串（仍保留「最多 1 位小数、整数不带小数点」的习惯：
//                            42 → `42`、90 → `90`、5400 → `5400`）。
//   注（v0.0.8）：上述「去掉 `s` 后缀」在 v0.0.8 被回退——时间单位 `s` 重新显示
//                （42 → `42s`），但 d / min 进位与**其余资源单位**仍不显示（见 fmtTime 注释）。
//   ③ 各 UI 文案里硬编码的单位（/秒、/s、K、t、m/s、电/秒、m³ 等）——见 js/ui/power.js 与
//                            js/ui/shipyard.js 的对应清理；数字本身一律保留。
// 注：fmtNum / fmtSci 的 k/m/g/t 是「数量级记号」（如 1200 → 1.2k），并非单位，保持现状。

// 保留至多 3 位有效数字并去掉末尾多余的 0
function trimToSig3(v) {
  if (!isFinite(v)) return '0';
  return parseFloat(v.toPrecision(3)).toString();
}

// 科学记数法尾数（1 位小数，去掉 .0）
function sciMantissa(v) {
  const m = v / Math.pow(10, Math.floor(Math.log10(v)));
  let s = m.toFixed(1);
  if (s.endsWith('.0')) s = s.slice(0, -2);
  return s;
}

// 数量格式化：自动进位到 k/m/g/t，超大走 1.5e15 形式。
// 进位修复（v0.0.7）：先按 3 位有效数字四舍五入到当前档，若结果达到下一档阈值（>=1000）
// 则继续进位——避免出现 `999.6 → 1000m`（应是 1g）、`9.999e8 → 1000m`（应是 1g）这类卡档。
//   999.4 → 999；999.6 → 1k；999.6e3(=999600) → 1m；9.996e8 → 1g；1e9 → 1g；负数同理（-999.6 → -1k）。
const _NUM_UNITS = ['', 'k', 'm', 'g', 't'];

export function fmtNum(n) {
  if (n === null || n === undefined || isNaN(n)) return '0';
  if (n === 0) return '0';
  const neg = n < 0;
  const v = Math.abs(n);
  let out, unit = '';
  if (v >= 1e15) {
    out = sciMantissa(v) + 'e' + Math.floor(Math.log10(v));
    return (neg ? '-' : '') + out;
  } else if (v >= 1e12) {
    out = trimToSig3(v / 1e12); unit = 't';
  } else if (v >= 1e9) {
    out = trimToSig3(v / 1e9); unit = 'g';
  } else if (v >= 1e6) {
    out = trimToSig3(v / 1e6); unit = 'm';
  } else if (v >= 1e3) {
    out = trimToSig3(v / 1e3); unit = 'k';
  } else {
    // < 1e3：直接按 3 位有效数字（parseFloat 会抹掉多余尾零，整数不带小数点）
    out = trimToSig3(v);
  }
  // 进位补档：四舍五入后若达到下一档阈值就向上一档进位，直至 < 1000 或已到最大档
  while (Number(out) >= 1000 && _NUM_UNITS.indexOf(unit) < _NUM_UNITS.length - 1) {
    const i = _NUM_UNITS.indexOf(unit);
    unit = _NUM_UNITS[i + 1];
    out = trimToSig3(Number(out) / 1000);
  }
  return (neg ? '-' : '') + out + unit;
}

// 去掉小数末尾多余的 0：0.0523 保持不变，5.0000 → 5，12.5000 → 12.5
function trimZeros(s) {
  return s.indexOf('.') < 0 ? s : s.replace(/\.?0+$/, '');
}

// 速率数字体（不带 +/-、不带 /s 后缀）。
// 供「每秒钟 xx」「xx/分钟」「xx 单位」这类自定义文案复用，
// 保证全项目的速率**只有这一套精度规则**，不再各处 toFixed(1) 各写各的。
//
// v0.0.6：三档
//   v >= 1e3          走 fmtNum 的 k/m/g 进位，避免长数字糊屏
//   1e-4 <= v < 1e3   **固定保留 4 位小数**
//   0 < v < 1e-4      改用科学记数法
//     ⚠ 这一档是必须的：四位小数已经把 0.00002 这种值四舍五入成 0.0000，
//       显示出来就是「+0/s」——玩家会说「肉眼完全看不见变化」。
//       稀有矿（粗金丰度 1e-7）与慢速气体的增速就落在这里，
//       宁可显示 1e-7 这种科学记数法，也绝不能让它看起来是 0。
//
// ⚠⚠ 关于「不再去掉尾零」（v0.0.61 修正）：
//   之前会把 0.2000 的尾零抹掉、显示成「0.2」，结果**看起来就像只保留了一位小数**——
//   而实际上呼吸消耗恰好就是 0.2/s 这种整数值，玩家反复反馈「增速只有一位小数」。
//   现在：整数仍按整数显示（240），**非整数一律补齐 4 位小数**（0.2000、0.6250、1.0125）。
export function fmtRateBody(n) {
  const v = Math.abs(Number(n) || 0);
  if (v === 0) return '0';
  if (v >= 1e3) return fmtNum(v);
  if (v < 1e-4) return fmtSci(v);
  if (Number.isInteger(v)) return String(v);
  return v.toFixed(4);
}

// 每秒增速：正数前缀 +，只返回带符号的数字体（v0.0.7 起不再拼 /s，全站去单位）
// v0.0.53：小数改为一律保留 **4 位**（再去掉多余尾零）。
//   此前走的是通用 fmtNum，小数只保留 1 位，0.0523 被显示成「+0.1」，
//   慢速资源（稀有矿、气体）的增速看着全都一样、甚至像没在涨。
// v0.0.6：精度规则抽成 fmtRateBody，并补上「小于 1e-4 走科学记数法」这一档。
// v0.0.7：去掉结尾的 `/s`（调用方文案若有单位自行处理；现统一不显示单位）。
export function fmtRate(n) {
  if (n === null || n === undefined || isNaN(n)) n = 0;
  return (n >= 0 ? '+' : '-') + fmtRateBody(n);
}

// 带 + 号的数值（负数自带负号）
export function fmtSigned(n) {
  const s = fmtNum(n);
  return n >= 0 ? '+' + s : s;
}

// 时间格式化：v0.0.7 起不再做 d/min/s 单位进位，只返回纯数字串（全站去单位）。
// v0.0.8：时间保留 `s` 单位，其余单位仍然不显示。
//   例：42 → `42s`、90 → `90s`、5400 → `5400s`、0.5 → `0.5s`。
//   仍保留「最多 1 位小数、整数不带小数点」的写法（在末尾补 `s`）。
export function fmtTime(sec) {
  if (sec === null || sec === undefined || isNaN(sec) || sec < 0) sec = 0;
  let s = (Math.round(sec * 10) / 10).toString();
  if (s.endsWith('.0')) s = s.slice(0, -2);
  return s + 's';
}

// 极小值科学记数法（如丰度 1e-5 显示 1e-5）
export function fmtSci(n) {
  if (n === 0 || n === null || n === undefined || isNaN(n)) return '0';
  const neg = n < 0;
  const v = Math.abs(n);
  const exp = Math.floor(Math.log10(v));
  let m = v / Math.pow(10, exp);
  let s = m.toFixed(1);
  if (s.endsWith('.0')) s = s.slice(0, -2);
  return (neg ? '-' : '') + s + 'e' + exp;
}

// 反向解析："100g"/"5m"/"1.5e15"/"500" -> 数字；失败返回 NaN
export function parseCount(str) {
  if (typeof str === 'number') return str;
  const s = String(str).trim().toLowerCase();
  const m = s.match(/^([+-]?[\d.eE+]+?)([kmgt])?$/);
  if (!m) {
    const f = parseFloat(s);
    return isNaN(f) ? NaN : f;
  }
  const val = parseFloat(m[1]);
  if (isNaN(val)) return NaN;
  if (m[2]) return val * { k: 1e3, m: 1e6, g: 1e9, t: 1e12 }[m[2]];
  return val;
}

// ============================================================================
// 富文本最小渲染器（rev15）
// ============================================================================
// 背景：data/ 层（buildings.js / techs.js）的描述文案里长期用 `**重点**` 标注强调，
//   但所有渲染点走的是 textContent / esc()，于是玩家看到的是**带星号的原始文本**
//   （例如「农田**不走生产线**」）。这里把「转义 + 加粗」收成一个函数，
//   渲染点统一改用它，既不放松 XSS 防护，也让作者的强调意图真正生效。
//
// 规则（刻意只支持这一条，避免引入完整 Markdown 依赖）：
//   `**文字**` → `<b>文字</b>`；其余字符一律 HTML 转义。
export function escapeHtml(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
}

export function richText(s) {
  return escapeHtml(s).replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>');
}

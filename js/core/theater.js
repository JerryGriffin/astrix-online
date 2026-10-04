// ============================================================================
// 行星战区地图（v0.4.1）—— 把「抽象战线」变成一张可以推进的行星地图
// ============================================================================
//
// 为什么要有这张图（v0.4.0 遗留的问题）：
//   v0.4.0 的战斗虽然有地形、补给、轨道轰炸，但**战场是抽象的** ——
//   玩家选一个地形开战，赢下来只加「战争分数」，与地图上任何具体位置无关。
//   于是三件事做不到：
//   ① **为什么要打**：赢一场没有任何空间上的收益，进度条纯属计数器；
//   ② **轨道轰炸没有战略价值**：只能打「我正在打的那场仗」，
//      而真正的战略价值是先瘫痪敌人的**另一处**要地，再从容登陆；
//   ③ **补给不是网络**：补给只按「投入师数 vs 工业」算，
//      没有「打穿走廊 / 绕远路」的概念，于是推进毫无空间逻辑。
//
// 本模块提供行星地图，让上面三件事成立：
//   · 母星行星划成 **6×6 = 36 个战区**，各有地貌、重力、驻防、建筑；
//   · **所有权 + 邻接**：战争的目的变成「占领敌方战区」，而不是抽象推进；
//   · **补给网络**：从我方轨道投送点出发、只经过我方战区做 BFS ——
//     补给线被切断的孤立战区会挨饿（打穿走廊才有意义）；
//   · **殖民地争夺**：地图上散布敌方殖民地，占领即获得人口与战争分数；
//   · **轨道轰炸变成战略手段**：可以打**任意**敌方战区（只要有轨道控制），
//     不限于正在交战的那一处 —— 「先瘫痪要地，再登陆」由此成立。
//
// 与既有系统的关系：
//   · 战斗结算仍由 battle.js#startBattle/stepHour 负责，本模块只管
//     「在哪打、打赢后归谁、补给通不通、殖民地归谁」；
//   · 1936 剧本的既有存档没有地图 —— ensureTheater 会按种子补生成，
//     玩家本国所在战区自动归自己，不影响既有进度；
//   · 不 import state.js（账号对象由调用方传入），与 battle.js 同构。
// ============================================================================

import { HOI_BY_ID, HOI_MAIN_NATIONS } from '../data/hoi1936.js?v=42.7';

export const THEATER_COLS = 6;
export const THEATER_ROWS = 6;
export const THEATER_SIZE = THEATER_COLS * THEATER_ROWS;

// 建筑的补给/战略意义
export const REGION_STRUCTURES = {
  orbital: { nameCn: '轨道投送点', supply: 1.00, desc: '本方作战的起点与投送门户，作战区补给网络的根。' },
  depot:   { nameCn: '补给枢纽',   supply: 1.00, desc: '同样作为补给网络节点，但没有轨道投送能力。' },
  dome:    { nameCn: '殖民地穹顶', supply: 0.85, desc: '加压穹顶，防御加成极高，是最难啃的据点。' },
  colony:  { nameCn: '殖民地',     supply: 0.80, desc: '有大量人口 —— 占领它直接获得收益与战争分数。' },
  mine:    { nameCn: '资源矿场',   supply: 0.90, desc: '采矿区，占领后可抽取资源。' },
};

// 驻防加成：占点部队提供的防御（同占领方）
export const GARRISON_MAX = 0.35;

/** 占领后驻防自然增长（每秒）：占领要「站得住」才会，否则打下来也守不住 */
export const GARRISON_GROWTH = 0.0022;      // /秒（约 6 分钟到满）
export const GARRISON_DECAY_ENEMY = 0.0016; // 敌方在无战区时缓慢恢复驻防

/** 围城：殖民地穹顶防御极高，需要先打「围城进度」才能占领 */
export const SIEGE_REQUIRED = 0.55;         // dome 类建筑需要的围城进度

/**
 * v0.4.2：战区产出类型。
 *   殖民地不只是「分数」，而是**真实经济来源** —— 各地貌/建筑产出不同资源，
 *   由 state.js 每 tick 把产出注入母星物品栏（真正的物资，而非计数器）。
 *   产出受该战区**补给网络**与**驻防**影响：断供或驻军不足 → 产量大跌。
 */
export const REGION_OUTPUT = {
  regolith: { 有机质: 1.0, 水: 0.8 },                 // 富含挥发物的风化层
  crater:   { 钢: 0.7, 铝: 0.5 },                     // 撞击溅射带出金属矿脉
  canyon:   { 钢: 0.9, 石头: 1.0 },                   // 裸露岩层
  dust:     { 硅: 0.6, 铝: 0.7, 有机质: 0.3 },        // 悬浮硅酸盐
  lava:     { 钢: 0.8, 铜: 0.6, 硫: 0.5 },           // 硫化物金属
  ice:      { 水: 1.2, 氧气: 0.6 },                   // 冰层与升华气
  dome:     { 有机质: 0.9, 氧气: 0.8, 硅: 0.5 },      // 穹顶生态圈
};
// 建筑对产出的额外加成（同一个地貌在不同建筑下产出不同）
export const STRUCTURE_OUTPUT_MUL = {
  colony: 1.6, mine: 1.35, dome: 1.0, depot: 0.85, orbital: 0.7,
};

// 地貌 → 战区名用词（太空化，不用地球地理）
const TERRAIN_WORDS = {
  regolith: ['静海', '灰潮', '寂原', '素壤'],
  crater:   ['赤铁坑', '幽环', '撞击谷', '陨痕'],
  canyon:   ['深谷', '裂谷', '断崖', '狭壑'],
  dust:     ['黄霾', '赤尘', '蔽日', '纱原'],
  lava:     ['炽原', '熔渊', '火喉', '赤脊'],
  ice:      ['霜原', '寒渊', '白垩', '冻环'],
  dome:     ['穹顶', '穹城', '绿洲罩', '护罩城'],
};

// ---------------------------------------------------------------------------
// 一、确定性工具（地图必须可复现，否则存档重开后版图会变）
// ---------------------------------------------------------------------------
function hash32(str) {
  let h = 0x811c9dc5;
  const s = String(str);
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
function smooth(t) { return t * t * (3 - 2 * t); }
/** 二维值噪声（格点 hash + 双线性平滑） */
function noise2(seed, x, y) {
  const xi = Math.floor(x), yi = Math.floor(y);
  const u = smooth(x - xi), v = smooth(y - yi);
  const a = hash32(seed + ':' + xi + ':' + yi) / 4294967296;
  const b = hash32(seed + ':' + (xi + 1) + ':' + yi) / 4294967296;
  const c = hash32(seed + ':' + xi + ':' + (yi + 1)) / 4294967296;
  const d = hash32(seed + ':' + (xi + 1) + ':' + (yi + 1)) / 4294967296;
  return (a * (1 - u) + b * u) * (1 - v) + (c * (1 - u) + d * u) * v;
}
/** 分形叠加噪声 —— 归一化到 [0,1]（除以振幅和，否则均值会偏高一截，
 *  导致地貌全挤在阈值表的高位段，出现「只有 4 种地貌」的现象） */
function fbm(seed, x, y, oct) {
  let v = 0, amp = 0.5, f = 1, norm = 0;
  const n = oct || 3;
  for (let i = 0; i < n; i++) {
    v += noise2(seed + ':o' + i, x * f, y * f) * amp;
    norm += amp;
    amp *= 0.5; f *= 2;
  }
  return clamp(norm > 0 ? v / norm : 0, 0, 1);
}

// ---------------------------------------------------------------------------
// 二、地图生成
// ---------------------------------------------------------------------------
export function ensureTheater(acc) {
  if (!acc) return null;
  if (!acc.theater || !Array.isArray(acc.theater.regions) || acc.theater.regions.length !== THEATER_SIZE) {
    acc.theater = generateTheater(acc);
    refreshSupply(acc);            // 刚生成完立刻算一次补给网络
    return acc.theater;
  }
  // 玩家本国必须存在（老存档补生成时用）
  if (!acc.theater.myNation) acc.theater.myNation = String(acc.nation || 'ger');
  return acc.theater;
}

/** 生成一张行星地图（确定性：同 acc.nation + 同 seed → 同版图） */
export function generateTheater(acc) {
  const myNation = String(acc.nation || 'ger');
  // ⚠️ 种子必须**可复现**：把 theaterSeed 存进 theater，之后任何时候都能重建同一张图。
  //   （只存 hash 后的 seed 不够 —— 无法反推出原始 theaterSeed。）
  const rawSeed = (acc.theaterSeed == null) ? (Date.now() % 100000) : Number(acc.theaterSeed);
  const seed = hash32('theater:' + myNation + ':' + rawSeed) >>> 0;

  // ---- 1) 地貌：按噪声**排名**分配，保证 7 种地貌每张图都出现 ----
  //   直接拿 fbm 值比阈值不可靠：6×6 的网格在噪声空间里只覆盖极小一块区域，
  //   采样到的值分布严重偏斜，实测出现过「整张图只有冰/环形山/峡谷 3 种」。
  //   解法：先算每格噪声，再**按排名**划带 —— 比例有保证，
  //   而噪声本身是平滑的，所以排名在空间上仍然连续，地貌照样成片。
  const regions = [];
  const cells = [];
  for (let y = 0; y < THEATER_ROWS; y++) {
    for (let x = 0; x < THEATER_COLS; x++) {
      const altN = fbm(seed, x * 0.55 + 3.1, y * 0.55 + 7.7, 3);
      const typeN = fbm(seed + ':t', x * 0.9 + 11.3, y * 0.9 + 2.9, 2);
      const r = { id: 'r' + x + '_' + y, x, y, terrain: null, owner: '', structure: null,
        popM: 0, garrison: 0, battleId: null, lastCaptureAt: 0, strikePressure: 0 };
      regions.push(r);
      cells.push({ r, k: altN * 0.85 + typeN * 0.15 });
    }
  }
  // 地貌配比（累计百分比边界）：低重力开阔地 → 高地 → 极地/穹顶
  const BANDS = [
    ['regolith', 0.20], ['dust', 0.32], ['lava', 0.40],
    ['crater', 0.58], ['canyon', 0.74],
    ['ice', 0.92], ['dome', 1.01],
  ];
  const order = cells.slice().sort((a, b) => a.k - b.k);
  for (let i = 0; i < order.length; i++) {
    const p = (i + 0.5) / order.length;
    let t = BANDS[BANDS.length - 1][0];
    for (const [name, edge] of BANDS) { if (p < edge) { t = name; break; } }
    order[i].r.terrain = t;
  }
  // 玩家本土战区（地图左下角起步，保证有立足点）
  const home = regions[0];
  home.owner = myNation;
  home.structure = 'orbital';
  home.nameCn = '本土 · ' + pickName(seed, home, 0);

  // ---- 2) 各主国本土 + 连片领土（按师数/工业决定面积）----
  const others = HOI_MAIN_NATIONS.filter((n) => n && n.id !== myNation);
  // 按实力降序，强者先占地（贪心扩张）
  const ranked = others.slice().sort((a, b) => (b.divisions * 2 + b.ic) - (a.divisions * 2 + a.ic));
  const taken = new Set([home.id]);
  // 起始点放在远离玩家的一侧，避免开局贴脸
  const spots = candidateHomes(regions, home, ranked.length);
  for (let i = 0; i < ranked.length; i++) {
    const n = ranked[i];
    const start = spots[i % spots.length];
    if (!start || taken.has(start.id)) continue;
    taken.add(start.id);
    start.owner = n.id;
    start.structure = 'orbital';
    start.nameCn = pickName(seed, start, i);
    // 目标面积：与该国实力成正比
    const size = clamp(Math.round(1 + (n.divisions / 130) * 4 + (n.ic / 170) * 2), 1, 7);
    growBlob(seed, start, n.id, size, taken, regions);
  }
  // 玩家起步领土：本土 + 相邻 2 个（中立）
  growBlob(seed, home, myNation, 3, taken, regions);

  // ---- 3) 建筑与殖民地 ----
  decorate(seed, regions, taken);
  // 命名（结构已命名的除外）
  let nameSeq = 0;
  for (const r of regions) {
    if (!r.nameCn) r.nameCn = pickName(seed, r, nameSeq++);
  }

  return {
    v: 1,
    seed,
    theaterSeed: rawSeed,
    cols: THEATER_COLS,
    rows: THEATER_ROWS,
    regions,
    myNation,
    colonies: [],          // 我方从敌方夺来的殖民地
    lostColonies: [],      // 我方丢掉、敌方夺走的殖民地
    strikes: 3,            // 可用战略轨道打击次数
    aiAt: 0,
    aiMood: 'probe',       // AI 战略情绪：probe / press / consolidate
  };
}

/** 起始本土候选点：按到玩家本土的曼哈顿距离从远到近 */
function candidateHomes(regions, home, n) {
  const others = regions.filter((r) => r !== home);
  const scored = others.map((r) => ({ r, d: Math.abs(r.x - home.x) + Math.abs(r.y - home.y) }));
  scored.sort((a, b) => (b.d - a.d) || ((a.r.x + a.r.y) - (b.r.x + b.r.y)));
  // 均匀取样，避免都挤在角落
  const step = Math.max(1, Math.floor(scored.length / Math.max(1, n)));
  const out = [];
  for (let i = 0; i < scored.length && out.length < n; i += step) out.push(scored[i].r);
  return out;
}

/** 从 start 出发随机生长 size 个连通战区归 owner 所有 */
function growBlob(seed, start, owner, size, taken, regions) {
  const byId = new Map(regions.map((r) => [r.id, r]));
  const frontier = [start];
  const owned = new Set([start.id]);
  let guard = 0;
  while (owned.size < size && frontier.length && guard++ < 400) {
    // 随机取一个扩展点（确定性：用 hash 决定索引）
    const idx = hash32(seed + ':g' + owner + ':' + owned.size) % frontier.length;
    const cur = frontier.splice(idx, 1)[0];
    const nbs = neighborsIn(regions, cur).filter((r) => !taken.has(r.id) && !owned.has(r.id));
    // 按 hash 顺序尝试加入
    for (let k = 0; k < nbs.length; k++) {
      const j = (hash32(seed + ':n' + owner + ':' + cur.id + ':' + k) % (nbs.length - k));
      const nb = nbs.splice(j, 1)[0];
      if (!nb) continue;
      if (owned.size >= size) break;
      owned.add(nb.id);
      nb.owner = owner;
      frontier.push(nb);
    }
    // 找不到空邻接就换个扩展点（从已占战区找还有空邻接的）
    if (!frontier.length) {
      for (const id of owned) {
        const p = byId.get(id);
        if (!p) continue;
        for (const nb of neighborsIn(regions, p)) {
          if (!taken.has(nb.id) && !owned.has(nb.id)) { frontier.push(nb); break; }
        }
      }
    }
  }
  return owned;
}

// ---------------------------------------------------------------------------
// 三、地貌与建筑
// ---------------------------------------------------------------------------
function pickName(seed, r, seq) {
  const words = TERRAIN_WORDS[r.terrain] || ['荒原'];
  const w = words[hash32(seed + ':n' + r.id) % words.length];
  return w + '·' + String.fromCharCode(65 + (seq % 26));
}

/** 建筑与殖民地：投送点 / 补给枢纽 / 穹顶 / 殖民地 / 矿场 */
function decorate(seed, regions, taken) {
  // 每个战区用自身 id 派生随机数（而不是共用一个递增计数器），
  //   否则顺序一变整张图的建筑分布就跟着漂移，不利于复现与排查。
  const rndOf = (r, salt) => hash32(seed + ':' + salt + ':' + r.id) / 4294967296;
  // 1) 先按目标数量挑出殖民地位置（保证一定数量，而不是靠概率碰运气）
  const TARGET_COLONY = 9;
  const candidates = regions.filter((r) => r.owner && r.structure !== 'orbital');
  const picked = new Set();
  for (let i = 0; i < TARGET_COLONY && candidates.length; i++) {
    // 从未选中的候选里按 hash 取一个，尽量分散
    const pool = candidates.filter((r) => !picked.has(r.id));
    if (!pool.length) break;
    const idx = hash32(seed + ':col' + i) % pool.length;
    picked.add(pool[idx].id);
  }
  for (const r of regions) {
    if (r.structure === 'orbital') continue;           // 各本土的轨道投送点已定
    if (picked.has(r.id)) {
      r.structure = 'colony';
      r.popM = Math.round((0.8 + rndOf(r, 'pop') * 7.0) * 10) / 10;   // 0.8~7.8 百万
      r.garrison = 0.20 + rndOf(r, 'gar') * 0.15;
      continue;
    }
    const roll = rndOf(r, 'str');
    if (roll < 0.22) {
      r.structure = 'depot';
      r.garrison = 0.05 + rndOf(r, 'gar') * 0.08;
    } else if (roll < 0.34 && r.terrain === 'dome') {
      r.structure = 'dome';
      r.garrison = 0.25 + rndOf(r, 'gar') * 0.10;
    } else if (roll < 0.58) {
      r.structure = 'mine';
      r.garrison = 0.05 + rndOf(r, 'gar') * 0.08;
    } else {
      r.structure = null;
      r.garrison = r.owner ? (0.04 + rndOf(r, 'gar') * 0.10) : 0;
    }
  }
}

// ---------------------------------------------------------------------------
// 四、邻接与查询
// ---------------------------------------------------------------------------
/** 8 邻接（含斜向）—— 斜向让「绕过去」成为可能，进攻不必直线推进 */
function neighborsIn(regions, region) {
  const out = [];
  if (!region || !Array.isArray(regions)) return out;
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      if (!dx && !dy) continue;
      const x = region.x + dx, y = region.y + dy;
      if (x < 0 || y < 0 || x >= THEATER_COLS || y >= THEATER_ROWS) continue;
      const r = regions.find((q) => q && q.x === x && q.y === y);
      if (r) out.push(r);
    }
  }
  return out;
}

/** 邻接战区（对外）：接受 theater 或单个 region（后者用本模块当前 theater） */
export function neighborsOf(region) {
  if (region && Array.isArray(region.regions)) return neighborsIn(region.regions, region);
  if (!currentTheater) return [];
  return neighborsIn(currentTheater.regions, region);
}
let currentTheater = null;

export function regAt(t, x, y) {
  if (!t || !Array.isArray(t.regions)) return null;
  return t.regions.find((r) => r && r.x === x && r.y === y) || null;
}
export function regionById(t, id) {
  if (!t || !Array.isArray(t.regions)) return null;
  return t.regions.find((r) => r && r.id === id) || null;
}
export function regionsOf(acc, owner) {
  const t = ensureTheater(acc);
  return t.regions.filter((r) => (owner === '' ? !r.owner : r.owner === owner));
}

// ---------------------------------------------------------------------------
// 五、补给网络 —— 地图层的核心机制
//   从我方「轨道投送点 / 补给枢纽」出发，只经过**我方战区**做 BFS。
//   → 补给必须靠「打穿走廊」推进，绕远路的孤立战区会挨饿。
//   → 被敌方切断（战区易手）会立刻让我方那一大片断供。
// ---------------------------------------------------------------------------
/** 只做「存在性保证」，不刷新补给网络 —— 供 refreshSupply 内部调用，避免互相递归 */
function ensureTheaterRaw(acc) {
  if (!acc) return null;
  if (!acc.theater || !Array.isArray(acc.theater.regions) || acc.theater.regions.length !== THEATER_SIZE) {
    acc.theater = generateTheater(acc);
  }
  if (!acc.theater.myNation) acc.theater.myNation = String(acc.nation || 'ger');
  return acc.theater;
}

export function refreshSupply(acc) {
  const t = ensureTheaterRaw(acc);      // ⚠️ 不能用 ensureTheater（会与本函数互相递归）
  if (!t) return null;
  currentTheater = t;
  const me = t.myNation;
  const regions = t.regions;
  // 起点：我方拥有的 orbital / depot
  const roots = regions.filter((r) => r.owner === me
    && r.structure && REGION_STRUCTURES[r.structure] && REGION_STRUCTURES[r.structure].supply >= 1);
  const seen = new Set(roots.map((r) => r.id));
  // BFS（8 邻接，只经过我方战区）
  const queue = roots.slice();
  while (queue.length) {
    const cur = queue.shift();
    for (const nb of neighborsIn(regions, cur)) {
      if (!nb || seen.has(nb.id)) continue;
      if (nb.owner !== me) continue;          // 只能经过我方战区
      seen.add(nb.id);
      queue.push(nb);
    }
  }
  // 写回 connected
  for (const r of t.regions) {
    r.connected = (r.owner === me) && seen.has(r.id);
    // 记录补给网络的「上游」战区（供 UI 画补给线，也是断供诊断的依据）
    if (r.connected) r.supplyFrom = r.supplyParent || null;
  }
  t.supplyReach = seen.size;
  currentTheater = t;
  return t;
}

/**
 * v0.4.2：计算补给网络的连接关系（父节点），供 UI 画线。
 *   从每个投送点/补给枢纽做多源 BFS，记录每个战区的补给来源上游。
 *   → UI 可以画出「补给线」，被打断时能立刻看出断在哪一环。
 */
export function supplyLinksOf(acc) {
  const t = ensureTheater(acc);
  if (!t) return [];
  const me = t.myNation;
  const regions = t.regions;
  const parent = new Map();          // regionId → 上游 regionId
  const roots = regions.filter((r) => r.owner === me
    && r.structure && REGION_STRUCTURES[r.structure]
    && REGION_STRUCTURES[r.structure].supply >= 1);
  const seen = new Set(roots.map((r) => r.id));
  const queue = roots.slice();
  while (queue.length) {
    const cur = queue.shift();
    for (const nb of neighborsIn(regions, cur)) {
      if (!nb || seen.has(nb.id)) continue;
      if (nb.owner !== me) continue;
      seen.add(nb.id);
      parent.set(nb.id, cur.id);
      queue.push(nb);
    }
  }
  const links = [];
  for (const [child, from] of parent.entries()) {
    const c = regionById(t, child), p = regionById(t, from);
    if (c && p) links.push({ from: { x: p.x, y: p.y }, to: { x: c.x, y: c.y }, regionId: child });
  }
  return links;
}

/**
 * v0.4.2：每 tick 推进战区状态 —— 驻防增长 / 围城推进 / 驻防衰减。
 * @param {object} inst 母星实例（用于查是否本地开战，避免无谓计算）
 */
export function tickRegions(acc, dtSec) {
  const t = ensureTheater(acc);
  if (!t) return;
  const dt = Number(dtSec) || 0;
  if (!(dt > 0)) return;
  const me = t.myNation;
  const active = new Set();
  for (const b of (Array.isArray(acc.battles) ? acc.battles : [])) {
    if (b && b.status === 'active' && b.regionId) active.add(b.regionId);
  }
  for (const r of t.regions) {
    if (r.battleId || active.has(r.id)) {
      // 交战中：围城进度推进（穹顶最难啃），驻防不恢复
      r.siege = clamp((Number(r.siege) || 0) + dt * 0.02, 0, SIEGE_REQUIRED);
      continue;
    }
    if (r.owner === me) {
      // 我方且已连通：驻防随时间增长（占领要站得住），断供则不增长
      if (r.connected) {
        r.garrison = Math.min(GARRISON_MAX, (Number(r.garrison) || 0) + GARRISON_GROWTH * dt);
      }
    } else if (r.owner) {
      // 敌方：缓慢恢复驻防（守住阵地），被我方打击过的恢复更慢
      const pressure = Number(r.strikePressure) || 0;
      r.garrison = Math.min(GARRISON_MAX,
        (Number(r.garrison) || 0) + GARRISON_DECAY_ENEMY * dt * (1 - pressure));
    }
  }
}

/**
 * v0.4.2：殖民地 / 战区产出（真实物资）。
 *   返回 { mat: amount }，由 state.js 注入物品栏。
 *   产量 = 基础 × 建筑加成 × 补给网络 × 驻防系数
 */
export function regionYieldOf(acc) {
  const t = ensureTheater(acc);
  if (!t) return null;
  const me = t.myNation;
  const out = {};
  const perColony = 0.60;    // 每处殖民地每秒每种资源的基础产出
  const perMine = 0.35;      // 矿场
  for (const r of t.regions) {
    if (r.owner !== me) continue;
    // 断供 → 产量腰斩；驻防不足 → 产量下降（没人守矿也挖不动）
    const supplyMul = r.connected ? 1 : 0.35;
    const garMul = 0.6 + 0.4 * clamp((Number(r.garrison) || 0) / 0.2, 0, 1);
    const stMul = STRUCTURE_OUTPUT_MUL[r.structure] != null ? STRUCTURE_OUTPUT_MUL[r.structure] : 0.5;
    let base = stMul;
    if (r.structure === 'colony') base = stMul;
    else if (r.structure === 'mine') base = stMul;
    else base = 0.45;                    // 空战区只有基础采集
    const table = REGION_OUTPUT[r.terrain] || {};
    const mul = base * supplyMul * garMul;
    if (mul <= 0) continue;
    for (const mat in table) {
      const amt = table[mat] * perColony * mul * (r.structure === 'colony' || r.structure === 'mine' ? 1 : 0.4);
      if (amt > 0) out[mat] = (out[mat] || 0) + amt;
    }
  }
  for (const mat in out) out[mat] = Math.round(out[mat] * 1000) / 1000;
  return out;
}

/** 某战区的补给系数 0~1（网络通 = 1；孤立 = 按结构打折；敌方 = 由攻方补给决定） */
export function regionSupplyOf(acc, region) {
  const t = ensureTheater(acc);
  if (!t || !region) return 0.5;
  if (region.owner !== t.myNation) {
    // 敌方/中立战区：我方在此作战靠的是空中投送，受轨道控制影响（由 battle.js 结算）
    return 0.5;
  }
  const st = region.structure && REGION_STRUCTURES[region.structure];
  const base = st ? st.supply : 0.9;
  return clamp(base * (region.connected ? 1 : 0.45), 0.1, 1);
}

// ---------------------------------------------------------------------------
// 六、占领与殖民地争夺
// ---------------------------------------------------------------------------
/** 战役胜利后结算战区归属 */
export function captureRegion(acc, war, region, mySideWon) {
  const t = ensureTheater(acc);
  if (!t || !region) return null;
  const me = t.myNation;
  const foe = String(war && war.targetId || '');
  const prevOwner = region.owner;
  if (!mySideWon) {
    // 我方被打出该战区 → 敌方占领，我方失去该处的补给节点与殖民地
    if (prevOwner === me) {
      region.owner = foe;
      if (region.structure === 'colony') {
        t.lostColonies.push({ regionId: region.id, nameCn: region.nameCn, popM: region.popM, at: Date.now() });
      }
    }
    refreshSupply(acc);
    return { owner: region.owner, colony: null, lost: prevOwner === me };
  }
  if (prevOwner === me) return { owner: me, colony: null, lost: false };
  // v0.4.2 **围城门槛**：殖民地穹顶防御极高（terrain.def ×1.45），
  //   光把守军打崩不足以占领 —— 必须先把**围城进度**打满。
  //   于是「硬啃穹顶」与「先围城 / 先轨道轰炸瘫痪」变成两条不同的战术路线。
  if (region.structure === 'dome') {
    const siege = clamp(Number(region.siege) || 0, 0, SIEGE_REQUIRED);
    if (siege < SIEGE_REQUIRED * 0.999) {
      return {
        owner: prevOwner, colony: null, lost: false, sieged: true,
        siegeNeed: SIEGE_REQUIRED, siege,
      };
    }
  }
  region.owner = me;
  region.lastCaptureAt = Date.now();
  // 首次占领 → 驻防清零（守军溃散），并补一点驻防（我方少量进驻）
  region.garrison = Math.min(GARRISON_MAX, (Number(region.garrison) || 0) * 0.2 + 0.05);
  region.siege = 0;
  let colony = null;
  if (region.structure === 'colony') {
    colony = { regionId: region.id, nameCn: region.nameCn, popM: region.popM, at: Date.now() };
    t.colonies.push(colony);
    // 殖民地直接换算战争分数（殖民地争夺是战争的主要目的之一）
    if (war && war.status === 'active') {
      war.myScore = Math.min(100, (Number(war.myScore) || 0) + 6);
      war.theirScore = Math.min(100, (Number(war.theirScore) || 0) + 1);
    }
  }
  refreshSupply(acc);
  return { owner: me, colony, lost: false };
}

/** 每战区最多同时进行的战线数（多方向夹击） */
export const REGION_MAX_FRONTS = 3;
/** 夹击：每多一个**不同来源方向**的正面进攻，守方防御额外下降 */
export const FLANK_PER_DIRECTION = 0.16;
export const FLANK_MAX = 0.34;

/** 某战区当前的进攻态势：{ fronts, directions, originCount(originId) } */
export function frontInfoOf(acc, regionId) {
  const battles = (Array.isArray(acc.battles) ? acc.battles : [])
    .filter((b) => b && b.status === 'active' && b.regionId === regionId);
  const origins = new Set();
  const perOrigin = {};
  for (const b of battles) {
    const o = b.originId || ('b' + b.id);
    origins.add(o);
    perOrigin[o] = (perOrigin[o] || 0) + 1;
  }
  return {
    fronts: battles.length,
    directions: origins.size,
    perOrigin,
    // 夹击强度：多方向才有效
    flank: clamp((origins.size - 1) * FLANK_PER_DIRECTION, 0, FLANK_MAX),
  };
}

/** 同一战区可再开几条战线 */
export function canOpenFront(acc, regionId) {
  return frontInfoOf(acc, regionId).fronts < REGION_MAX_FRONTS;
}
/** 我方殖民地收益（人口总计，用于面板与结算） */
export function colonyIncomeOf(acc) {
  const t = ensureTheater(acc);
  if (!t) return { count: 0, popM: 0 };
  const popM = t.colonies.reduce((s, c) => s + (Number(c.popM) || 0), 0);
  return { count: t.colonies.length, popM: Math.round(popM * 10) / 10 };
}

/** 殖民地战争进度奖励：占领殖民地额外推动战线 */
export function applyColonyProgress(war, gainCount) {
  if (!war || war.status !== 'active' || !(gainCount > 0)) return;
  war.progress = clamp((Number(war.progress) || 0) + gainCount * 2, 0, 100);
}

// ---------------------------------------------------------------------------
// 七、战略轨道打击（地图层的核心交互）
//   与 battle.js 里的「战役内轰炸」不同：这是**跨战区**的战略打击 ——
//   可以在任意敌方战区投下一发，先瘫痪要地，再从容进攻。这正是
//   「先夺轨道、再打地面」的太空战争形态，也是轨道轰炸真正的战略价值。
// ---------------------------------------------------------------------------
export const STRIKE_ORG_DAMAGE = 26;   // 对战区守军的组织度伤害
export const STRIKE_STR_DAMAGE = 120;  // 对战区守军的兵力伤害
export const STRIKE_GARRISON_BREAK = 0.5; // 削减驻防的比例

/** 能否对某敌方战区实施战略打击 */
export function canStrikeRegion(acc, region, orbitalControl) {
  const t = ensureTheater(acc);
  if (!t || !region) return { ok: false, reason: '战区不存在' };
  if (t.strikes <= 0) return { ok: false, reason: '没有可用轨道打击（等待轨道平台补充）' };
  if (region.owner === t.myNation) return { ok: false, reason: '不能打击自己的战区' };
  if (!(Number(orbitalControl) >= 0.6)) {
    return { ok: false, reason: '轨道控制不足 60%，无法实施轨道打击' };
  }
  return { ok: true };
}

/**
 * 实施一次战略轨道打击。
 * 效果：削该战区驻防与守军组织度/兵力；若该战区正在交战，双方都受影响（守方更惨）。
 */
export function strikeRegion(acc, region, orbitalControl) {
  const t = ensureTheater(acc);
  const gate = canStrikeRegion(acc, region, orbitalControl);
  if (!gate.ok) return gate;
  t.strikes -= 1;
  const ctrl = clamp(Number(orbitalControl) || 0, 0, 1);
  const power = 0.7 + 0.6 * ctrl;
  region.garrison = Math.max(0, (Number(region.garrison) || 0) * (1 - STRIKE_GARRISON_BREAK * power));
  region.lastStrikeAt = Date.now();
  // 削减该战区的敌方「战意」：用一个 strikePressure 字段表示守军被瘫痪的程度
  region.strikePressure = clamp((Number(region.strikePressure) || 0) + 0.45 * power, 0, 1);
  return {
    ok: true, regionId: region.id, nameCn: region.nameCn,
    garrison: region.garrison, pressure: region.strikePressure, strikesLeft: t.strikes,
    desc: '轨道打击命中 ' + region.nameCn + '：驻防削减，' +
      '守军组织度 −' + Math.round(STRIKE_ORG_DAMAGE * power) +
      '，兵力 −' + Math.round(STRIKE_STR_DAMAGE * power) +
      '（该战区防御被瘫痪，更容易被登陆）',
  };
}

/** 占领 / 推进会自然恢复 strikePressure */
export function decayStrikePressure(acc, dtSec) {
  const t = ensureTheater(acc);
  if (!t) return;
  for (const r of t.regions) {
    if (r.strikePressure > 0) {
      r.strikePressure = Math.max(0, r.strikePressure - (Number(dtSec) || 0) * 0.004);
    }
  }
  // 轨道打击次数随时间补充（有轨道控制时恢复更快）
  const ctrl = Number(t._ctrl) || 0;
  if (t.strikes < STRIKE_MAX) {
    t.strikeAcc = (Number(t.strikeAcc) || 0) + (Number(dtSec) || 0) * (0.006 + 0.01 * ctrl);
    while (t.strikeAcc >= 1 && t.strikes < STRIKE_MAX) { t.strikes += 1; t.strikeAcc -= 1; }
  }
}
export const STRIKE_MAX = 5;

// ---------------------------------------------------------------------------
// 八、敌方 AI 战略层（v0.4.1 第三项）
//   AI 不再只是「按实力差滑进度条」，而是会：
//     · 判断战线态势（我方推进/反攻），选择目标战区；
//     · 优先防守**殖民地与投送点**（这些丢了它就输）；
//     · 在需要时对我方战区实施**战略轨道打击**；
//     · 向中立战区扩张、连成自己的补给走廊；
//   节拍由 acc.theater.aiAt 控制（默认每 30 秒决策一次）。
// ---------------------------------------------------------------------------
export function tickTheaterAI(acc, dtSec, ctx) {
  const t = ensureTheater(acc);
  if (!t || !Array.isArray(acc.wars)) return;
  const now = Number(dtSec) || 0;
  t.aiAt = (Number(t.aiAt) || 0) + now;
  if (t.aiAt < AI_TICK_SEC) return;
  t.aiAt = 0;

  const me = t.myNation;
  const myRegions = t.regions.filter((r) => r.owner === me);
  if (!myRegions.length) return;

  for (const war of acc.wars) {
    if (!war || war.status !== 'active') continue;
    const foe = String(war.targetId || '');
    const foeRegions = t.regions.filter((r) => r.owner === foe);
    if (!foeRegions.length) continue;

    // ---- 1) 态势判断：谁在推进？（v0.3.5 起 progress 由战役胜负推动）----
    const prog = Number(war.progress) || 0;
    const myScore = Number(war.myScore) || 0;
    t.aiMood = prog >= 55 ? 'consolidate'      // 我方占优 → 敌方转入守势
      : (prog <= 35 ? 'press' : 'probe');      // 我方吃紧 → 敌方转入攻势

    // ---- 2) 敌方挑目标：优先打**我方殖民地 / 投送点**（价值最高）----
    const value = (r) => {
      let v = 0;
      if (r.structure === 'orbital') v += 40;
      else if (r.structure === 'colony') v += 35;
      else if (r.structure === 'dome') v += 20;
      else if (r.structure === 'depot') v += 25;
      else if (r.structure === 'mine') v += 10;
      if (!r.connected) v -= 15;              // 打击断供区收益更大
      if (r.garrison > 0.2) v -= 20;         // 重兵防守的不好打
      if (r.strikePressure > 0.3) v += 25;    // 被我方轨道打击过 → 防线已瘫
      return v + hash32(t.seed + ':ai' + r.id) % 5;   // 轻微随机，避免死板
    };
    const targets = myRegions.slice().sort((a, b) => value(b) - value(a));
    const pick = targets[0];
    if (pick) {
      t.aiTarget = pick.id;
      // ---- 3) 敌方若占轨道控制，则对我方目标战区实施战略打击 ----
      const foeCtrl = 1 - (ctx && Number(ctx.myOrbital) || 0.5);   // 简化为互为补数
      if (foeCtrl >= 0.6 && !t._foeStruck) {
        t._foeStruck = 1;
        pick.garrison = Math.max(0, (Number(pick.garrison) || 0) * 0.6);
        pick.strikePressure = clamp((Number(pick.strikePressure) || 0) + 0.3, 0, 1);
      }
    }
    // ---- 4) 敌方扩张：把中立战区并入自己，连成补给走廊 ----
    const neutral = t.regions.filter((r) => !r.owner);
    if (neutral.length && t.aiMood !== 'consolidate') {
      const cand = neutral.filter((n) => neighborsOf(n).some((x) => x.owner === foe));
      if (cand.length) {
        const g = cand[hash32(t.seed + ':ex' + (Number(war.battles) || 0)) % cand.length];
        g.owner = foe;
        g.garrison = 0.1;
      }
    }
  }
  refreshSupply(acc);
}
export const AI_TICK_SEC = 30;

// ---------------------------------------------------------------------------
// 九、给 UI 的只读视图
// ---------------------------------------------------------------------------
export function theaterView(acc) {
  const t = ensureTheater(acc);
  if (!t) return null;
  refreshSupply(acc);
  const me = t.myNation;
  const myRegions = t.regions.filter((r) => r.owner === me);
  const cols = t.colonies.reduce((s, c) => s + (Number(c.popM) || 0), 0);
  const lost = t.lostColonies.reduce((s, c) => s + (Number(c.popM) || 0), 0);
  return {
    cols: t.cols, rows: t.rows,
    strikes: t.strikes, strikeMax: STRIKE_MAX,
    aiMood: t.aiMood, aiTarget: t.aiTarget || null,
    colonyIncome: { count: t.colonies.length, popM: Math.round(cols * 10) / 10,
      lostPopM: Math.round(lost * 10) / 10 },
    reach: t.supplyReach || 0,
    regions: t.regions.map((r) => ({
      id: r.id, x: r.x, y: r.y,
      nameCn: r.nameCn,
      terrain: r.terrain,
      owner: r.owner,
      isMine: r.owner === me,
      structure: r.structure,
      structureCn: r.structure && REGION_STRUCTURES[r.structure]
        ? REGION_STRUCTURES[r.structure].nameCn : '',
      popM: r.popM,
      garrison: Math.round((Number(r.garrison) || 0) * 100) / 100,
      connected: !!r.connected,
      battleId: r.battleId || null,
      strikePressure: Math.round((Number(r.strikePressure) || 0) * 100) / 100,
      supply: Math.round(regionSupplyOf(acc, r) * 100) / 100,
      gravity: 1,
    })),
  };
}

/** 我方能进攻的目标：与我方战区相邻、且非我方所有 */
export function attackTargetsOf(acc, region) {
  const t = ensureTheater(acc);
  if (!t || !region) return [];
  return neighborsOf(region).filter((r) => r.owner !== t.myNation);
}

export { hash32 };
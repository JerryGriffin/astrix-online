// 星际航行与殖民：随机星球生成 + 发现/占领 + 管理模式 + 独立倾向 + 电脑托管（Astrix v0.1.1）
// 纯算法模块，零依赖，浏览器直接 import。
//
// 设计者 [重要] 需求（v0.0.9 明确、v0.0.92 落地、v0.1.1 扩展）：
//   * 探索有大概率发现默认星球、小概率发现**随机星球**（由本文件生成，名字/属性随机）；
//   * v0.1.1：发现 ≠ 殖民 —— 先「探索到」（acc.discovered）才能在殖民面板殖民/管理；
//   * 随机星球 code 改为「类型前缀+序号」（syl1、syl2…），同类型可重复产生；
//   * 商店星 ast1 是公共的：capturePlanet / setManagement 一律拦截；
//   * 除「领土（同化）」外，其它管理模式由电脑接管发展并定期向母星上缴贡品与装备。
//
// 重要约定：本模块**不 import state.js**（state.js 会 import 本模块，互相 import 会成环）。
//   需要 STATE.planets 的操作（如把新星球实例挂进存档）由调用方传入或通过回调完成。
//   同理也**不 import production.js / shop.js**（它们间接依赖 state.js / 会与本模块成环）。

import { PLANETS } from '../data/planets.js?v=55.6';
import { JOBS, getTotalLabor, buildingSlots } from './population.js?v=55.6';

// ============================================================================
// 管理模式（设计者已确认：同时影响 产出 / 幸福度 / 独立倾向）
// ============================================================================
// outputMul        该星球所有生产与采集的产出倍率
// happinessDelta   每 tick 叠加到幸福度上的修正（会被幸福度公式自身的目标值拉回，属持续压力/红利）
// independenceMul  独立倾向的增长倍率（0 = 永远不会独立；领土就是 0）
export const MANAGEMENT_MODES = [
  {
    id: 'free', nameCn: '自由', outputMul: 1.25, happinessDelta: 0.030, independenceMul: 1.6,
    desc: '当地人自治，产出中等偏高、人心最稳，但**独立倾向增长最快**。',
  },
  {
    id: 'cooperative', nameCn: '合作', outputMul: 1.10, happinessDelta: 0.015, independenceMul: 1.0,
    desc: '与你合作经营，产出与人心都小幅为正，独立倾�向按平均水平增长。',
  },
  {
    id: 'colonial', nameCn: '殖民', outputMul: 1.00, happinessDelta: 0.000, independenceMul: 0.6,
    desc: '标准殖民管理，产出与人心中性，独立倾向增长较慢。',
  },
  {
    id: 'territory', nameCn: '领土', outputMul: 0.85, happinessDelta: -0.010, independenceMul: 0.0,
    desc: '完全纳入版图：产出略低，但**独立倾向恒为 0**，永不会脱离。需要幸福度很高时自动同化。',
    locked: true,   // 一开始不可选
  },
  {
    id: 'exploitative', nameCn: '剥削', outputMul: 1.60, happinessDelta: -0.120, independenceMul: 2.5,
    desc: '榨取式经营：产出最高，但**人心暴跌、独立倾向飙升**，长期必反。',
  },
];
export const MANAGEMENT_BY_ID = Object.fromEntries(MANAGEMENT_MODES.map((m) => [m.id, m]));
export const DEFAULT_MANAGEMENT = 'colonial';

export function modeOf(inst) {
  const id = inst && inst.management;
  return MANAGEMENT_BY_ID[id] || MANAGEMENT_BY_ID[DEFAULT_MANAGEMENT];
}
// 该星球的产出倍率（母星恒为 1：母星不参与殖民管理）
export function outputMulOf(inst) {
  if (!inst || inst.isHome) return 1;
  return modeOf(inst).outputMul;
}
export function happinessDeltaOf(inst) {
  if (!inst || inst.isHome) return 0;
  return modeOf(inst).happinessDelta;
}

// 设置管理模式：领土一开始不可选（locked），已经同化成领土的星球可以保持
export function setManagement(inst, modeId) {
  if (!inst) return { ok: false, reason: '星球数据缺失' };
  if (inst.isShop) return { ok: false, reason: '公共商店星，无法殖民' };   // v0.1.1 需求 1
  const m = MANAGEMENT_BY_ID[modeId];
  if (!m) return { ok: false, reason: '未知的管理模式' };
  if (inst.isHome) return { ok: false, reason: '母星不参与殖民管理' };
  if (m.locked && !inst.territoryAssimilated) {
    return { ok: false, reason: '领土模式需要该星球先被同化（幸福度长期很高后自动发生）' };
  }
  inst.management = modeId;
  if (modeId !== 'territory') inst.territoryAssimilated = false;   // 改走别的模式就丢失同化
  return { ok: true, mode: m };
}

// ============================================================================
// 独立倾向（设计者：由幸福度驱动，母星恒为 0）
// ============================================================================
// 口径：目标值 = clamp01((0.5 - 幸福度) × 1.2) × 管理模式倍率
//   · 幸福度 ≥ 0.5 → 目标 0（人心安稳不会闹独立）
//   · 幸福度 0.2 → (0.3 × 1.2) = 0.36，再乘模式倍率
//   · 领土模式倍率 0 → 恒为 0
// 同化：非领土模式、幸福度 ≥ 0.8 时，`territoryProgress` 每秒 +1；
//   累计到 TERRITORY_ASSIMILATE_SEC（默认 10 分钟）后自动变领土（设计者：「一段时间后会同化成领土」）。
export const TERRITORY_ASSIMILATE_SEC = 600;
export const TERRITORY_HAPPY_THRESHOLD = 0.8;

export function independenceTargetOf(inst) {
  if (!inst || inst.isHome) return 0;
  const mode = modeOf(inst);
  if (mode.independenceMul <= 0) return 0;
  const happy = Number(inst.pop ? inst.pop.happiness : inst.happiness) || 0;
  const base = Math.max(0, Math.min(1, (0.5 - happy) * 1.2));
  return Math.max(0, Math.min(1, base * mode.independenceMul));
}

// 每 tick 推进独立倾向与同化进度（由 state.js 的 tick 调用）
export function tickIndependence(inst, dt) {
  if (!inst || inst.isHome) { if (inst) inst.independence = 0; return; }
  const target = independenceTargetOf(inst);
  const cur = Number(inst.independence) || 0;
  // 向目标逼近：涨得快（10 秒时间常数）、跌得慢（60 秒），体现「离心力一旦形成很难逆转」
  const tau = target > cur ? 10 : 60;
  const k = Math.min(1, dt / tau);
  inst.independence = Math.max(0, Math.min(1, cur + (target - cur) * k));

  // 同化：幸福度长期很高 → 自动变领土
  const happy = Number(inst.pop ? inst.pop.happiness : inst.happiness) || 0;
  if (!inst.territoryAssimilated && happy >= TERRITORY_HAPPY_THRESHOLD) {
    inst.territoryProgress = (Number(inst.territoryProgress) || 0) + dt;
    if (inst.territoryProgress >= TERRITORY_ASSIMILATE_SEC) {
      inst.territoryAssimilated = true;
      inst.management = 'territory';
      inst.independence = 0;
    }
  } else if (happy < TERRITORY_HAPPY_THRESHOLD) {
    // 幸福度掉下来就回退同化进度（不回退已同化状态）
    inst.territoryProgress = Math.max(0, (Number(inst.territoryProgress) || 0) - dt * 2);
  }
}

// ============================================================================
// 随机星球生成
// ============================================================================
// 名字池：中文名 + 英文名（设计者：「你自行取名，随机他们的星球属性」）
const NAME_POOL = [
  ['烬砂', 'Embersand'], ['霜环', 'Frostring'], ['翠谷', 'Verdantia'], ['苍泊', 'Palemere'],
  ['锈原', 'Rustvale'], ['晶簇', 'Crystalis'], ['黯潮', 'Duskflow'], ['曦洲', 'Aurorland'],
  ['玄砾', 'Obsidian'], ['鎏丘', 'Aurelia'], ['雾屿', 'Mistisle'], ['熔脊', 'Magmaridge'],
  ['银淞', 'Silverrime'], ['赤帆', 'Redsail'], ['靛窟', 'Indigolair'], ['鸣沙', 'Songdune'],
];
const TYPE_POOL = ['类地行星', '干旱行星', '苔原行星', '奇异行星', '辐射行星', '海洋行星', '荒漠卫星', '气态卫星'];
const GAS_POOL = ['氮气', '氧气', '氨气', '甲烷', '二氧化碳', '氢气', '氩气', '氦气', '硫磺气'];
// 可选矿脉池（只用材料表里真实存在的名字）
const ORE_POOL = [
  '石头', '泥土', '有机质', '水', '石墨', '粘土', '孔雀石', '二氧化硅', '石英', '红土', '硫磺',
  '赤铁矿', '金红石', '闪锌矿', '黑钨矿', '锂辉石', '软锰矿', '沥青铀矿', '铱铂矿', '粗银', '粗金',
];

// 确定性伪随机（mulberry32）：同一个 seed 永远生成同一颗星球
function rng(seed) {
  let a = 0;
  const s = String(seed);
  for (let i = 0; i < s.length; i++) a = (a * 31 + s.charCodeAt(i)) | 0;
  a = (a ^ 0x9e3779b9) | 0;
  return function next() {
    a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const pick = (next, arr) => arr[Math.floor(next() * arr.length) % arr.length];
// 数量级：1e3 ~ 1e12，按 10 的幂随机
const amountOf = (next, lo, hi) => {
  const e = lo + Math.floor(next() * (hi - lo + 1));
  return Math.round((1 + next() * 9) * Math.pow(10, e));
};

// 生成一颗随机星球（结构对齐 js/data/planets.js 的星球对象）
//   seed 相同 → 结果相同（便于「同一颗星球在存档里持久、可复现」）
export function generateRandomPlanet(seed) {
  const next = rng(seed);
  const code = 'rg' + Math.abs(Math.floor(next() * 1e9)).toString(36).slice(0, 6);
  const [nameCn, nameEn] = pick(next, NAME_POOL);
  const type = pick(next, TYPE_POOL);

  // 每层矿种数错开（地表少、浅层多、深层更多、地核最稀有）
  const layerCounts = {
    surface: 5 + Math.floor(next() * 3),
    underground: 7 + Math.floor(next() * 4),
    deep: 8 + Math.floor(next() * 4),
    core: 4 + Math.floor(next() * 3),
  };
  const layers = {};
  let layerIdx = 0;
  for (const layer of ['surface', 'underground', 'deep', 'core']) {
    layerIdx++;
    const used = new Set();
    const rows = [];
    for (let i = 0; i < layerCounts[layer]; i++) {
      let ore = pick(next, ORE_POOL);
      let guard = 0;
      while (used.has(ore) && guard++ < 20) ore = pick(next, ORE_POOL);
      if (used.has(ore)) continue;
      used.add(ore);
      // 储量：越深的层量级越大；丰度：地表 < 浅层 < 深层 < 地核
      const amount = amountOf(next, 4 + layerIdx, 7 + layerIdx * 2);
      const abundance = Math.pow(3, layerIdx - 1) * (0.5 + next() * 1.5);
      rows.push({ name: ore, amount, abundance: Math.round(abundance * 1000) / 1000 });
    }
    layers[layer] = rows;
  }

  // 气体：2~5 种
  const gasUsed = new Set();
  const gases = [];
  const gasN = 2 + Math.floor(next() * 4);
  for (let i = 0; i < gasN; i++) {
    const g = pick(next, GAS_POOL);
    if (gasUsed.has(g)) continue;
    gasUsed.add(g);
    gases.push({ name: g, amount: amountOf(next, 4, 10), abundance: Math.round((0.2 + next() * 2) * 1000) / 1000 });
  }

  return {
    id: 'random_' + code,
    code,
    nameCn,
    nameEn,
    type,
    description: '探索中发现的未知星球，资源与气候与母星系截然不同。',
    random: true,
    orbit: { radius: 30 + Math.floor(next() * 60), phase: Math.floor(next() * 360) },
    layers,
    gases,
    // 发电系数：随机星球光照/风力/水利各不相同
    power: {
      totalEnergy: amountOf(next, 12, 14),
      hydro: Math.round((0.3 + next() * 1.7) * 100) / 100,
      wind: Math.round((0.3 + next() * 1.7) * 100) / 100,
      solar: Math.round((0.3 + next() * 1.7) * 100) / 100,
      tempC: Math.round(-40 + next() * 100),
    },
    population: { total: 0, available: 0 },   // 新发现的星球开局无人，要靠运输/移民
    needsImmigration: true,
    canRebel: true,                            // 殖民星球可以独立
    minAbundanceHint: '资源丰度随机，深层与地核更富。',
  };
}

// 占领一颗星球：写进账号的已占领列表（供后续 getPlanetInstance 建实例）
//   acc.capturedPlanets: [{ code, nameCn, nameEn, type, planet }]
// v0.1.1 需求 1：商店星是公共的（所有旅行者共用），一律拒绝殖民。
export function capturePlanet(acc, planet) {
  if (!acc || !planet || !planet.code) return { ok: false, reason: '参数不合法' };
  if (planet.isShop) return { ok: false, reason: '公共商店星，无法殖民' };
  if (!Array.isArray(acc.capturedPlanets)) acc.capturedPlanets = [];
  if (acc.capturedPlanets.some((p) => p.code === planet.code)) {
    return { ok: false, reason: '该星球已在版图中' };
  }
  acc.capturedPlanets.push({
    code: planet.code, nameCn: planet.nameCn, nameEn: planet.nameEn,
    type: planet.type, random: !!planet.random, planet,
  });
  return { ok: true, entry: acc.capturedPlanets[acc.capturedPlanets.length - 1] };
}

// 默认星球被探索发现后也走同一套占领记录（只是 planet 用 PLANETS 里的静态数据）
export function captureDefaultPlanet(acc, planetCode) {
  const p = PLANETS.find((x) => x.code === planetCode);
  if (!p) return { ok: false, reason: '未知星球' };
  return capturePlanet(acc, p);
}

// 还没被占领的默认星球
export function uncapturedDefaults(acc) {
  const owned = new Set((acc && acc.capturedPlanets ? acc.capturedPlanets : []).map((p) => p.code));
  return PLANETS.filter((p) => !owned.has(p.code));
}

// 星球编号/名称唯一性（在线模式要用；离线侧先保证本地不重复）
export function planetCodeTaken(acc, code) {
  if (PLANETS.some((p) => p.code === code)) return true;
  if (isDiscovered(acc, code)) return true;   // v0.1.1：已发现的随机星球编号也算占用
  return (acc && acc.capturedPlanets ? acc.capturedPlanets : []).some((p) => p.code === code);
}

// ============================================================================
// 「已发现」模型（v0.1.1 需求 2，设计者已确认：先探索到才能管理）
// ============================================================================
// acc.discovered = [星球定义...] —— 探索到（无论是否已殖民）的星球定义表。
// 老存档没有该字段时惰性补 []。殖民面板只展示「母星 + 已发现 + 商店星入口」，
// 未发现的星球不可见也不可殖民。发现 ≠ 殖民：殖民仍要走 capturePlanet + getPlanetInstance。
export const SHOP_PLANET_CODE = 'ast1';   // 商店星固定编号（planetgen 不 import shop.js，避免成环）
// 商店星的极简描述（仅供 discoverPlanet('ast1') 返回；完整定义在 core/shop.js 的 SHOP_PLANET）
const SHOP_PLANET_LIKE = {
  id: 'shop_ast1', code: SHOP_PLANET_CODE, nameCn: '商店星', nameEn: 'Ast1',
  type: '商业空间站', isShop: true,
};

export function discoveredOf(acc) {
  if (!acc) return [];
  if (!Array.isArray(acc.discovered)) acc.discovered = [];
  return acc.discovered;
}

// 商店星公共可见（所有旅行者共用），无需登记进 discovered —— 这里特判，
// 避免 planetgen ← shop.js 的循环依赖。
export function isDiscovered(acc, code) {
  if (!code) return false;
  if (code === SHOP_PLANET_CODE) return true;
  return discoveredOf(acc).some((p) => p && p.code === code);
}

// 母星默认已发现（ast1 商店星由 isDiscovered 特判，无需落表）。幂等，启动/深空开局时由主代理调用。
export function ensureDiscoveredDefaults(acc, homeCode) {
  const list = discoveredOf(acc);
  if (homeCode && !list.some((p) => p && p.code === homeCode)) {
    const home = PLANETS.find((p) => p.code === homeCode);
    if (home) list.push(home);
  }
  return list;
}

// 类型前缀表：对齐 PLANETS 现有 code（syl 希尔瓦 / des 德索罗 / cal 卡利多 / ves 弗沙尼亚 /
// nov 诺福斯 / gla 格拉西欧 / atr 阿特洛克斯）；PLANETS 里没有的类型用新前缀。
const TYPE_PREFIX = {
  '类地行星': 'syl',
  '类地卫星': 'des',
  '干旱行星': 'cal',
  '奇异行星': 'ves',
  '奇异卫星': 'nov',
  '苔原行星': 'gla',
  '辐射行星': 'atr',
  '海洋行星': 'oce',
  '荒漠卫星': 'dun',
  '气态卫星': 'gsm',
};

// 「类型前缀+序号」：按 acc.discovered ∪ acc.capturedPlanets ∪ PLANETS 中已占用的 code 取下一个空号
// （如 syl1、syl2…；与基座星球 syl 不冲突，capturePlanet 的 code 查重也不会误伤）
function nextRandomCode(acc, prefix) {
  const taken = new Set();
  for (const p of PLANETS) if (p && p.code) taken.add(p.code);
  for (const p of discoveredOf(acc)) if (p && p.code) taken.add(p.code);
  for (const c of (Array.isArray(acc.capturedPlanets) ? acc.capturedPlanets : [])) {
    if (c && c.code) taken.add(c.code);
  }
  let n = 1;
  while (taken.has(prefix + n)) n += 1;
  return prefix + n;
}

// 发现一颗星球（发现 ≠ 殖民；殖民走 capturePlanet + getPlanetInstance）
//   codeOrSpec 为字符串 → PLANETS 固定星球 code（也兼容老存档 capturedPlanets 里的随机星球 code）
//   codeOrSpec 为对象 { typeId?, seed } → generateRandomPlanet(seed) 生成随机新星球：
//     · code 不再用 'rg'+seed，改为「类型前缀+序号」（syl1、syl2…）；
//     · typeId 可选：传类型名（如 '苔原行星'）或类型前缀（如 'gla'）可指定星球类型。
// 返回 { ok, planet?, reason? }
export function discoverPlanet(acc, codeOrSpec) {
  if (!acc) return { ok: false, reason: '账号数据缺失' };
  const list = discoveredOf(acc);
  if (typeof codeOrSpec === 'string') {
    const code = codeOrSpec.trim();
    if (code === SHOP_PLANET_CODE) return { ok: true, planet: SHOP_PLANET_LIKE };
    let p = PLANETS.find((x) => x.code === code) || null;
    if (!p) {
      const cap = (Array.isArray(acc.capturedPlanets) ? acc.capturedPlanets : [])
        .find((c) => c && c.code === code);
      p = (cap && cap.planet) || null;
    }
    if (!p) return { ok: false, reason: '未知星球：' + code };
    if (!list.some((x) => x && x.code === p.code)) list.push(p);
    return { ok: true, planet: p };
  }
  if (codeOrSpec && typeof codeOrSpec === 'object') {
    const seed = codeOrSpec.seed != null ? codeOrSpec.seed : ('rg' + Math.floor(Math.random() * 1e9));
    const p = generateRandomPlanet(seed);
    if (!p) return { ok: false, reason: '星球生成失败' };
    // typeId 可选：类型名或前缀都认
    const t = String(codeOrSpec.typeId || '').trim();
    if (t) {
      if (TYPE_PREFIX[t]) p.type = t;
      else {
        const hit = Object.entries(TYPE_PREFIX).find(([, pre]) => pre === t);
        if (hit) p.type = hit[0];
      }
    }
    p.code = nextRandomCode(acc, TYPE_PREFIX[p.type] || 'rg');
    p.id = 'random_' + p.code;
    if (!list.some((x) => x && x.code === p.code)) list.push(p);
    return { ok: true, planet: p };
  }
  return { ok: false, reason: '参数不合法' };
}

// 清理老存档里误占的商店星（v0.1.1 需求 1）：从 acc.capturedPlanets / acc.discovered 删除 isShop 星球。
// 返回 { ok, removed: [code...] }，主代理在启动时调用。
// （STATE.planets 里残留的 ast1 实例由调用方或 ui/colony.js 负责移除 —— planetgen 不 import state.js）
export function purgeShopColonies(acc) {
  const removed = [];
  const isShopEntry = (c) => !!(c && (c.isShop || c.code === SHOP_PLANET_CODE
    || (c.planet && (c.planet.isShop || c.planet.code === SHOP_PLANET_CODE))));
  if (acc && Array.isArray(acc.capturedPlanets)) {
    const kept = acc.capturedPlanets.filter((c) => {
      if (isShopEntry(c)) { removed.push(c.code || SHOP_PLANET_CODE); return false; }
      return true;
    });
    acc.capturedPlanets = kept;
  }
  if (acc && Array.isArray(acc.discovered)) {
    acc.discovered = acc.discovered.filter((c) => !isShopEntry(c));
  }
  return { ok: removed.length > 0, removed };
}

// ============================================================================
// 电脑托管殖民地（v0.1.1 需求 4，设计者已确认「要真实游玩的电脑而非随机给予」）
// ============================================================================
// 口径：
//   * 除「领土（同化）」外，其它管理模式由电脑接管该星球发展：
//       - 每 30s 按启发式重排人力与生产线：电力（发电厂满员）→ 食物（农田满员）
//         → 施工（有在建项目时留建筑工）→ 采集（按星球富余资源层加权）→ 生产线（有配方的线补满）；
//       - 每 60s 结算一次贡品：各资源超出保留线 max(500, 持有×50%) 的富余 × 模式比例 → 母星；
//         装备库存每次结算附带 1 件（若有）。
//   * 真实生产**复用 state.js 既有 tick 管线**：殖民地实例（getPlanetInstance 建的）与母星实例
//     同构、同在 STATE.planets 里，advanceProduction / tickProduction（core/production.js）
//     已对它们生效 —— 本函数不做二次产出，避免双重计算。
//   * 贡品经 env.deliverToHome(acc, fromCode, payload) 交主代理入库：
//       payload = { 材料名: 数量, ... }，可附带 { __equipment: { partId, material, count: 1 } }。
//   * 实例访问经 env.getInstanceOf(code)（主代理传 getPlanetInstance 即可）；
//     也兼容 env.instances（数组或 () => STATE.planets）。
//   * 性能：重活都在 30s/60s 节拍里，每 tick 只做计时器累加；单星球 try/catch 不炸全局。
export const MANAGED_AI_INTERVAL_SEC = 30;   // AI 重排人力/生产线的节拍
export const COLONY_REPORT_INTERVAL_SEC = 30;// 殖民地发展/上供报告节拍（与 AI 同频但独立计时）
export const TRIBUTE_INTERVAL_SEC = 60;      // 贡品结算节拍
export const TRIBUTE_RETAIN_FLOOR = 500;     // 保留线下限
export const TRIBUTE_RETAIN_RATIO = 0.5;     // 保留线 = max(500, 持有 × 50%)
// 贡品比例（与管理模式 id 一一对应；领土已被同化、不托管，比例仅存档备查）
export const TRIBUTE_RATES = {
  free: 0.05, cooperative: 0.15, colonial: 0.30, territory: 0.50, exploitative: 0.60,
};

// 发电厂优先级：清洁 / 火力（v0.1.1 起为无人工厂，工位 0 自动跳过，按座数白送电）
// → 人力（免费劳动力换电）→ 综合燃烧（要烧贵重燃料，最后才用）
const POWER_PRIORITY = [
  ['clean_plant', 'clean_plant_worker'],
  ['thermal_plant', 'thermal_plant_worker'],
  ['manual_power', 'manual_power_worker'],
  ['combustion_chamber', 'combustion_worker'],
];
// 采集岗位与对应资源层（富余度按该层 abundance 之和加权）
const GATHER_JOBS = [
  { jobId: 'surface_gatherer', layer: 'surface', buildingId: null },
  { jobId: 'mine_shallow_worker', layer: 'underground', buildingId: 'mine_shallow' },
  { jobId: 'mine_deep_worker', layer: 'underground', buildingId: 'mine_deep' },
  { jobId: 'mine_core_worker', layer: 'core', buildingId: 'mine_core' },
  { jobId: 'gas_collector_worker', layer: 'gas', buildingId: 'gas_collector' },
];

function resolveInstanceAccessor(env) {
  if (!env) return null;
  if (typeof env.getInstanceOf === 'function') return env.getInstanceOf;
  if (typeof env.instances === 'function') {
    return (code) => {
      const arr = env.instances();
      return Array.isArray(arr) ? (arr.find((p) => p && p.code === code) || null) : null;
    };
  }
  if (Array.isArray(env.instances)) {
    return (code) => env.instances.find((p) => p && p.code === code) || null;
  }
  return null;
}

// 每 tick 推进全部托管殖民地（主代理在 state.js 的 tick 里接线调用）
export function tickManagedColonies(acc, dt, env = {}) {
  if (!acc || !(Number(dt) > 0)) return;
  dt = Number(dt);
  const caps = Array.isArray(acc.capturedPlanets) ? acc.capturedPlanets : [];
  if (!caps.length) return;
  const homeCode = acc.homePlanetCode || null;
  const getInst = resolveInstanceAccessor(env);
  for (const cap of caps) {
    try {
      if (!cap || !cap.code) continue;
      if (homeCode && cap.code === homeCode) continue;                     // 母星不托管
      if (cap.isShop || (cap.planet && cap.planet.isShop)) continue;        // 商店星不托管
      const inst = getInst ? getInst(cap.code) : null;
      if (!inst || inst.isHome || inst.isShop) continue;
      const mode = modeOf(inst);
      if (mode.id === 'territory') continue;                               // 已同化成领土：不托管
      // ① AI 分配节拍（每 30s；首次立即分配一次，让接管立刻生效）
      inst._aiTimer = (Number(inst._aiTimer) || 0) + dt;
      if (!inst._aiAllocated || inst._aiTimer >= MANAGED_AI_INTERVAL_SEC) {
        inst._aiTimer = 0;
        inst._aiAllocated = true;
        aiAllocateWorkers(inst);
      }
      // ② 贡品节拍（每 60s）；本周期若触发，把结算结果记下来供报告附带上供内容
      let tributeResult = null;
      inst._tributeTimer = (Number(inst._tributeTimer) || 0) + dt;
      if (inst._tributeTimer >= TRIBUTE_INTERVAL_SEC) {
        inst._tributeTimer = 0;
        tributeResult = settleTribute(acc, cap.code, inst, mode, env) || null;
      }
      // ③ 报告节拍（每 30s，与 AI 同频但独立计时；不依赖贡品节拍）
      inst._reportTimer = (Number(inst._reportTimer) || 0) + dt;
      if (inst._reportTimer >= COLONY_REPORT_INTERVAL_SEC) {
        inst._reportTimer = 0;
        pushColonyReport(acc, cap, inst, mode, tributeResult);
        tributeResult = null;
      }
    } catch (e) { /* 单星球异常不炸全局 tick */ }
  }
}

// 为单颗殖民地追加一条报告（开发变化取「与上次快照差值」；本周期没到贡品节拍则 tribute 记空对象）
function pushColonyReport(acc, cap, inst, mode, tributeResult) {
  const reports = colonyReportsOf(acc);
  const popTotal = Number(inst.pop && inst.pop.total) || 0;
  const buildingsTotal = sumBuildings(inst.buildings);
  const prev = inst._reportSnapshot || null;
  const popDelta = prev ? popTotal - prev.popTotal : 0;
  const buildingsDelta = prev ? buildingsTotal - prev.buildingsTotal : 0;
  inst._reportSnapshot = { popTotal, buildingsTotal };

  // 本周期若触发了贡品结算，带上实际投递内容（资源 / 装备 / 舰船）；否则记空对象
  let tribute;
  if (tributeResult && (tributeResult.delivered || tributeResult.equipment || tributeResult.ship)) {
    const delivered = (tributeResult.delivered && typeof tributeResult.delivered === 'object')
      ? tributeResult.delivered : {};
    tribute = {
      mats: delivered,
      equip: tributeResult.equipment || null,
      ships: tributeResult.ship ? 1 : 0,
    };
  } else {
    tribute = {};
  }

  reports.push({
    at: Date.now(),
    code: cap.code,
    nameCn: cap.nameCn,
    modeId: mode.id,
    modeNameCn: mode.nameCn,
    dev: { popDelta, buildingsDelta, popTotal, buildingsTotal },
    tribute,
  });
  // 上限 60 条：超出丢最旧的，避免存档膨胀
  if (reports.length > 60) reports.splice(0, reports.length - 60);
}

// 建筑总座数：inst.buildings 是 { buildingId: 已建成数量 } 的计数表，求和即可
function sumBuildings(buildings) {
  if (!buildings || typeof buildings !== 'object') return 0;
  let s = 0;
  for (const k in buildings) {
    if (!Object.prototype.hasOwnProperty.call(buildings, k)) continue;
    const v = buildings[k];
    s += (typeof v === 'number' && isFinite(v)) ? v : 0;
  }
  return s;
}

// 殖民地发展/上供报告：惰性建 acc.colonyReports，上限 60 条（超出丢最旧的）
export function colonyReportsOf(acc) {
  if (!acc) return [];
  if (!Array.isArray(acc.colonyReports)) acc.colonyReports = [];
  return acc.colonyReports;
}

function layerScoreOf(inst, layer) {
  if (layer === 'gas') {
    return (Array.isArray(inst.gases) ? inst.gases : [])
      .reduce((s, g) => s + (Number(g && g.abundance) || 0), 0);
  }
  const rows = (inst.layers && inst.layers[layer]) || [];
  return rows.reduce((s, r) => s + (Number(r && r.abundance) || 0), 0);
}

function setJobCount(pop, jobId, n) {
  if (!pop.assignments[jobId]) pop.assignments[jobId] = { count: 0, intensityId: 'standard' };
  pop.assignments[jobId].count = Math.max(0, Math.floor(n));
}

// 电脑重排一颗托管星球的人力与生产线（每 30s 一次）。返回是否实际执行了分配。
export function aiAllocateWorkers(inst) {
  const pop = inst && inst.pop;
  if (!pop || !(Number(pop.total) > 0)) return false;
  const buildings = inst.buildings || {};
  const totalLabor = getTotalLabor(pop);
  if (!(totalLabor > 0)) return false;
  // 预算：可用人力上限 = floor(总人力 × 幸福度)（同 population.getAvailable 口径），再留 15% 余量防过劳
  const happy = Number(pop.happiness) > 0 ? Number(pop.happiness) : 1;
  let left = Math.floor(Math.floor(totalLabor * happy) * 0.85);
  const want = {};
  const take = (jobId, n) => {
    n = Math.max(0, Math.min(Math.floor(n), left));
    if (n > 0) { want[jobId] = (want[jobId] || 0) + n; left -= n; }
  };
  // ① 电力：选一座可用的发电厂（按优先级取第一座建成的），工位满员
  for (const [bid, jobId] of POWER_PRIORITY) {
    const slots = buildingSlots(bid, buildings);
    if (slots > 0) { take(jobId, slots); break; }
  }
  // ② 食物：农田工位满员
  const farmSlots = buildingSlots('farm', buildings);
  if (farmSlots > 0) take('farm_worker', farmSlots);
  // ③ 施工：有在建项目时留一些建筑工（真实游玩：电脑也要盖房子）
  if (Array.isArray(inst.buildQueue) && inst.buildQueue.length > 0 && left > 0) {
    const wSlots = buildingSlots('workshop', buildings);
    if (wSlots > 0) take('builder', Math.min(wSlots, Math.max(3, Math.ceil(left * 0.3))));
  }
  // ④ 采集：按星球富余资源层（abundance 之和）加权分配，最多再吃掉剩余人力的 70%（给生产线留人）
  const gatherBudget = Math.floor(left * 0.7);
  const gList = GATHER_JOBS
    .map((g) => ({
      jobId: g.jobId,
      slots: g.buildingId ? buildingSlots(g.buildingId, buildings) : Infinity,
      score: layerScoreOf(inst, g.layer),
    }))
    .filter((g) => g.score > 0 && g.slots > 0)
    .sort((a, b) => b.score - a.score);
  const scoreSum = gList.reduce((s, g) => s + g.score, 0);
  let gLeft = gatherBudget;
  for (const g of gList) {
    if (gLeft <= 0) break;
    const share = scoreSum > 0 ? Math.floor(gatherBudget * (g.score / scoreSum)) : 0;
    const n = Math.max(0, Math.min(share, g.slots === Infinity ? gLeft : g.slots, gLeft));
    if (n > 0) { want[g.jobId] = (want[g.jobId] || 0) + n; left -= n; gLeft -= n; }
  }
  // ⑤ 写回岗位分配表：先清零全部岗位再按 want 落盘；强度档沿用各岗位原值（新建为标准档）
  for (const j of JOBS) {
    const a = pop.assignments[j.id];
    if (want[j.id]) {
      if (!a) pop.assignments[j.id] = { count: want[j.id], intensityId: 'standard' };
      else a.count = want[j.id];
    } else if (a) a.count = 0;
  }
  for (const k in pop.assignments) {
    if (!JOBS.some((j) => j.id === k) && pop.assignments[k]) pop.assignments[k].count = 0; // 清脏 key
  }
  // ⑥ 生产线：托管期重排，先全部清零再按「有配方的线」逐条补满（造船线归 shipyard 管，跳过）
  //    简化口径：只认 line.recipeId 非空且所属建筑已建成；不替电脑新建生产线、不替电脑选配方。
  let lineBudget = left;
  const lines = Array.isArray(inst.lines) ? inst.lines : [];
  for (const l of lines) if (l) l.workers = 0;
  const usedByBid = {};
  for (const l of lines) {
    if (!l || !l.recipeId || lineBudget <= 0) continue;
    const bid = l.buildingId;
    if (!bid || bid === 'dock') continue;
    const slots = buildingSlots(bid, buildings);
    if (slots <= 0) continue;
    const cap = slots - (usedByBid[bid] || 0);
    if (cap <= 0) continue;
    const n = Math.min(cap, lineBudget);
    l.workers = n;
    usedByBid[bid] = (usedByBid[bid] || 0) + n;
    lineBudget -= n;
  }
  return true;
}

function tributePendingOf(inst) {
  if (!inst._tributePending || typeof inst._tributePending !== 'object') {
    inst._tributePending = { mats: {}, equip: null };
  }
  if (!inst._tributePending.mats || typeof inst._tributePending.mats !== 'object') {
    inst._tributePending.mats = {};
  }
  return inst._tributePending;
}

// 跨层扣减殖民地库存（与 production.js 的 spendTotal 同口径：从持有最多的条目开始扣）。
// 注：production.js 反向 import 了本模块（outputMulOf），这里不 import 它以免成环，故本地实现。
function spendAcrossLayers(inst, mat, amt) {
  let need = Number(amt) || 0;
  if (!(need > 0) || !Array.isArray(inst.inventory)) return 0;
  const list = inst.inventory
    .filter((e) => e && e.mat === mat)
    .sort((a, b) => (Number(b.owned) || 0) - (Number(a.owned) || 0));
  let taken = 0;
  for (const e of list) {
    if (need <= 1e-9) break;
    const have = Math.max(0, Number(e.owned) || 0);
    const use = Math.min(have, need);
    e.owned = have - use;
    taken += use;
    need -= use;
  }
  return taken;
}

// 每 60s 结算一次贡品与装备上缴。返回 { ok, delivered?, equipment?, reason? }。
export function settleTribute(acc, code, inst, mode, env = {}) {
  const rate = TRIBUTE_RATES[mode && mode.id] != null ? TRIBUTE_RATES[mode.id] : 0.15;
  // ① 汇总当前持有 → 计算超出保留线的富余 × 模式贡品比例
  const held = {};
  for (const e of (Array.isArray(inst.inventory) ? inst.inventory : [])) {
    if (!e || !e.mat) continue;
    held[e.mat] = (held[e.mat] || 0) + (Number(e.owned) || 0);
  }
  const payload = {};
  for (const mat in held) {
    const have = held[mat];
    if (!(have > 0)) continue;
    const retain = Math.max(TRIBUTE_RETAIN_FLOOR, have * TRIBUTE_RETAIN_RATIO);
    const surplus = have - retain;
    if (!(surplus > 0)) continue;
    const amt = Math.floor(surplus * rate * 100) / 100;   // 两位小数，避免浮点脏数据
    if (amt > 0) payload[mat] = amt;
  }
  // ② 装备上缴：每次结算附带 1 件（若有，取库存最多的那种）
  let equip = null;
  let best = 0;
  const eq = (inst.equipment && typeof inst.equipment === 'object') ? inst.equipment : {};
  for (const k in eq) {
    const e = eq[k];
    const c = e ? Number(e.count) || 0 : 0;
    if (c >= 1 && c > best) {
      best = c;
      equip = { partId: e.partId, material: e.material == null ? null : e.material, count: 1 };
    }
  }
  // ③ 合并历史积压（deliverToHome 未接好或上次投递失败时的暂存）
  const pending = tributePendingOf(inst);
  for (const mat in pending.mats) payload[mat] = (payload[mat] || 0) + pending.mats[mat];
  if (!equip && pending.equip) equip = pending.equip;
  // ③-1 舰船上供：船坞 ≥1 且账号舰队 ≥4，每 3 次贡品结算上供 1 艘（移到母星，不删除）
  //      取一艘 planetCode 属于该殖民地的船；找不到符合条件的船就跳过、不上供。
  let ship = null;
  inst._tributeCount = (Number(inst._tributeCount) || 0) + 1;
  const homePlanetCode = acc.homePlanetCode || null;
  if (inst._tributeCount % 3 === 0
      && (Number(inst.buildings && inst.buildings.dock) || 0) >= 1
      && Array.isArray(acc.ships) && acc.ships.length >= 4
      && homePlanetCode) {
    const found = acc.ships.find((s) => s && (s.planetCode === code || (s.state && s.state.planetCode === code)));
    if (found) {
      found.planetCode = homePlanetCode;
      if (found.state) found.state.planetCode = homePlanetCode;
      ship = found;
    }
  }
  if (!(Object.keys(payload).length > 0) && !equip && !ship) return { ok: true, delivered: {}, ship: null };
  // ④ 投递（主代理实现：加进母星球储藏 + 弹 NPC 事件文案）
  const deliver = env && typeof env.deliverToHome === 'function' ? env.deliverToHome : null;
  if (!deliver) {
    pending.mats = payload;
    pending.equip = equip;
    return { ok: false, reason: '未提供 deliverToHome，贡品暂存在殖民地', pending: payload, ship: ship };
  }
  const full = equip ? Object.assign({}, payload, { __equipment: equip }) : payload;
  let ok = true;
  try {
    const r = deliver(acc, code, full);
    if (r === false) ok = false;
  } catch (e) { ok = false; }
  if (!ok) {
    pending.mats = payload;
    pending.equip = equip;
    return { ok: false, reason: '投递失败，贡品暂存在殖民地', ship: ship };
  }
  // ⑤ 送达成功后才真正从殖民地扣库存与装备
  for (const mat in payload) spendAcrossLayers(inst, mat, payload[mat]);
  if (equip) {
    for (const k in eq) {
      const e = eq[k];
      if (!e || Number(e.count) < 1) continue;
      const sameMat = (e.material == null) ? (equip.material == null) : (e.material === equip.material);
      if (e.partId === equip.partId && sameMat) {
        e.count = Number(e.count) - 1;
        if (e.count <= 0) delete eq[k];
        break;
      }
    }
  }
  pending.mats = {};
  pending.equip = null;
  return { ok: true, delivered: payload, equipment: equip, ship };
}

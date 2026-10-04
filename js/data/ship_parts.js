// 飞船部件数据表（Astrix v0.0.4）
// 纯 ES module，零依赖，浏览器直接 import。
//
// ============================================================================
// 单位约定（全表统一，勿混用）
// ============================================================================
//   容量 capacity       m³   外壳能装下的总占地
//   占地 footprint      m³   一个设施/武器占掉多少容量
//   质量 mass           t    公吨（1 t = 1000 kg）
//   推力 thrust         kN   1 kN / 1 t = 1 m/s²，所以 thrust/mass 直接是加速度
//   速度 speed          m/s  由 js/core/shipyard.js 用「推力 + 总质量」算
//   燃料消耗 fuelBurn   mol/s 口径与 js/data/fuels.js 的 burnRate 一致
//   热量 heat           kW   运行时的散热功率（进热平衡方程）
//   耗电 power          kW   需要飞船自身电力供给（暂只做数值展示）
//
// ============================================================================
// 型号（mark）生成规则
// ============================================================================
// v0.0.61：MK 分级已取消（只保留 MKI 一档），但「基础值 + 型号倍率」的生成机制
// 仍然保留——日后若要加回更高档部件，改 MARKS 与 MARK_SCALE 即可整表生效。

// v0.0.61（设计者要求）：**MK 分级取消**——「科研里面舰船 mki-iii 去掉，无实际意义」。
// 只保留 MKI，于是 expand() 生成的部件 id 仍是 `xxx_mk1`（如 `hull_s_mk1`、`fac_crew_mk1`）
// ——**id 不变，老存档里的蓝图与飞船完全不受影响**，只是不再有 mk2 / mk3 型号。
export const MARKS = [
  { mark: 1, label: 'MKI', techId: null },
];

const MARK_SCALE = {
  hull: { capacity: 1.45, mass: 1.35, struct: 1.40, slots: 1.40 },
  engine: { thrust: 1.60, mass: 1.35, fuel: 1.45, heat: 1.45 },
  weapon: { damage: 1.55, footprint: 1.25, mass: 1.30, heat: 1.40, power: 1.30 },
  facility: { footprint: 1.20, mass: 1.25, crew: 1.50, cargo: 1.60, hangar: 1.50, struct: 1.50, tempband: 1.25 },
};

// 通用：把 base 表按 mark 展开成多条
function expand(kind, bases) {
  const out = [];
  for (const b of bases) {
    for (const { mark, label, techId } of MARKS) {
      const m = mark - 1;
      const s = MARK_SCALE[kind];
      const item = { ...b, category: kind, mark, markLabel: label, id: `${b.id}_mk${mark}`, nameCn: `${b.nameCn} ${label}` };
      if (techId) item.markTechId = techId;
      if (kind === 'hull') {
        item.capacity = Math.round(b.capacity * Math.pow(s.capacity, m));
        item.emptyMass = +(b.emptyMass * Math.pow(s.mass, m)).toFixed(2);
        item.structBase = +(b.structBase * Math.pow(s.struct, m)).toFixed(2);
        item.slots = Math.round(b.slots * Math.pow(s.slots, m));
      } else if (kind === 'engine') {
        item.thrust = Math.round(b.thrust * Math.pow(s.thrust, m));
        item.mass = +(b.mass * Math.pow(s.mass, m)).toFixed(2);
        item.fuelBurn = +(b.fuelBurn * Math.pow(s.fuel, m)).toFixed(4);
        item.heatKW = Math.round(b.heatKW * Math.pow(s.heat, m));
      } else if (kind === 'weapon') {
        item.damage = Math.round(b.damage * Math.pow(s.damage, m));
        item.footprint = Math.round(b.footprint * Math.pow(s.footprint, m));
        item.mass = +(b.mass * Math.pow(s.mass, m)).toFixed(2);
        item.heatKW = Math.round(b.heatKW * Math.pow(s.heat, m));
        item.powerKW = Math.round(b.powerKW * Math.pow(s.power, m));
      } else if (kind === 'facility') {
        item.footprint = Math.round(b.footprint * Math.pow(s.footprint, m));
        item.mass = +(b.mass * Math.pow(s.mass, m)).toFixed(2);
        if (b.crew) item.crew = Math.round(b.crew * Math.pow(s.crew, m));
        if (b.cargoVol) item.cargoVol = Math.round(b.cargoVol * Math.pow(s.cargo, m));
        if (b.hangarSlots) item.hangarSlots = Math.round(b.hangarSlots * Math.pow(s.hangar, m));
        if (b.structAdd) item.structAdd = +(b.structAdd * Math.pow(s.struct, m)).toFixed(2);
        if (b.tempBandBonus) item.tempBandBonus = +(b.tempBandBonus * Math.pow(s.tempband, m)).toFixed(1);
      }
      item.desc = b.desc;
      out.push(item);
    }
  }
  return out;
}

// ============================================================================
// 材质可选槽位：外壳 / 武器 / 装甲 / 引擎壳体 都可以自选材料，
// 材料的 强度 / 密度 / 熔点 / 比热容 会直接改写部件的属性（公式见 shipyard.js）。
// 强度基准取「钢 = 35」为 1.0 倍，所以在早期只有铝（6）、铁（15）时会明显吃亏。
// ============================================================================
export const MATERIAL_SLOTS = {
  hull: ['铝', '铝合金', '铁', '钢', '钛', '钛合金', '碳化钨', '陶瓷', '石墨烯', '纳米碳合金'],
  engine: ['铝', '铁', '钢', '钛', '钛合金', '碳化钨'],
  weapon: ['铁', '钢', '钛', '钛合金', '钨', '碳化钨', '石墨烯', '纳米碳合金'],
  armor: ['铁', '钢', '钛', '钨', '碳化钨', '陶瓷', '石墨烯', '纳米碳合金', '铱'],
};

// 每个材质槽的默认材料（新建蓝图时用），都选最便宜可得的那种
export const DEFAULT_MATERIAL = {
  hull: '铁',
  engine: '铁',
  weapon: '铁',
  armor: '铁',
};

// ============================================================================
// 一、舰船外壳（设计者要求：超小型 / 小型 / 中型 / 大型 / 超大型）
// ============================================================================
// capacity 是该船能装的「总占地」，slots 是可装的部件个数上限（防止堆一堆小件）。
// structBase 是结构强度基数，乘上材料强度倍率后就是船体耐久。
export const HULLS = expand('hull', [
  { id: 'hull_xs', nameCn: '超小型外壳', nameEn: 'Ultra-Light Hull',
    capacity: 60, emptyMass: 8, structBase: 12, slots: 6, materialSlot: 'hull',
    desc: '单人穿梭艇级别。容量极小但空重低，配上轻型引擎能跑出全星系最快的航速。' },
  { id: 'hull_s', nameCn: '小型外壳', nameEn: 'Small Hull',
    capacity: 180, emptyMass: 24, structBase: 22, slots: 12, materialSlot: 'hull',
    desc: '通用轻舟。够装一个乘员仓加少量武器或货舱，是最早能离开母星的实用船型。' },
  { id: 'hull_m', nameCn: '中型外壳', nameEn: 'Medium Hull',
    capacity: 520, emptyMass: 70, structBase: 38, slots: 24, materialSlot: 'hull',
    desc: '主力船型。容量、速度、强度都不吃亏，殖民与星际运输都靠它。' },
  { id: 'hull_l', nameCn: '大型外壳', nameEn: 'Large Hull',
    capacity: 1400, emptyMass: 190, structBase: 62, slots: 40, materialSlot: 'hull',
    desc: '远洋级船体。装得下机库与多重武器阵列，但需要重型以上引擎才推得动。' },
  { id: 'hull_xl', nameCn: '超大型外壳', nameEn: 'Super-Heavy Hull',
    capacity: 3600, emptyMass: 480, structBase: 95, slots: 64, materialSlot: 'hull',
    desc: '移动基地。只有超重型引擎配得动，造价与燃料都是天文数字，是文明级的工程。' },
]);

// ============================================================================
// 二、引擎（设计者要求：基础引擎 + 轻型 / 均衡 / 重型 / 超重型）
// ============================================================================
// 航速 = SPEED_K × 总推力 / 总质量^0.7（见 shipyard.js），所以推力/质量比就是一切。

// ----------------------------------------------------------------------------
// v0.0.8 新增：电力推进器（electric thruster）
// 设计目标「高效率低功率」：以电能代替化学燃料产生推力。
//   - powerDraw（耗电）：电/秒，明显低于同推力档化学引擎的燃料口径消耗；
//   - thrust：与同档化学引擎持平或略低；
//   - mass：略高（电机 + 电源），footprint 中等；
//   - effRatio：推力 ÷ 耗电，明显优于化学引擎（化学引擎不耗电、只烧燃料）。
// 3 个大小（小/中/大）× 3 个等级（I/II/III）= 9 项，全部随船坞（t_e3）解锁，
// 等级差异只体现在数值与造价上（mark 恒为 1，沿用现有一档）。
// 注意：化学引擎用 efficiency 字段衡量「燃料→推力」，量纲与电力推进器的 effRatio 不同，
//       故电力推进器不复用 efficiency（留给起飞燃料公式默认 0.40），只保留 powerDraw / effRatio。
const ETHRUSTER_DEFS = [
  // size: id 片段；cn: 中文大小；thrust/mass/powerDraw/footprint/heatKW 为 mk1 基础值；
  // work: 三档单件工作量（人·秒），随大小递增。
  // v0.3.3：随 CRAFT_WORK 的引擎档（40000，即 1/100 速率）同步上调 100 倍，
  //   否则自带 work 会绕过类别默认值，导致这批引擎速率仍是原来的 100 倍。
  { size: 's', cn: '小', thrust: 180, mass: 11, powerDraw: 38, footprint: 9, heatKW: 12, work: [45000, 60000, 75000] },
  { size: 'm', cn: '中', thrust: 300, mass: 24, powerDraw: 66, footprint: 16, heatKW: 20, work: [65000, 85000, 105000] },
  { size: 'l', cn: '大', thrust: 540, mass: 52, powerDraw: 118, footprint: 28, heatKW: 34, work: [85000, 105000, 120000] },
];
const ETHRUSTER_LEVELS = [
  { lv: 1, roman: 'I', scale: 1.0 },
  { lv: 2, roman: 'II', scale: 1.5 },
  { lv: 3, roman: 'III', scale: 2.2 },
];
const ETHRUSTERS = [];
for (const sz of ETHRUSTER_DEFS) {
  for (let i = 0; i < ETHRUSTER_LEVELS.length; i++) {
    const L = ETHRUSTER_LEVELS[i];
    const thrust = Math.round(sz.thrust * L.scale);
    const mass = +(sz.mass * L.scale).toFixed(2);
    const powerDraw = Math.round(sz.powerDraw * L.scale);
    const footprint = Math.round(sz.footprint * L.scale);
    const heatKW = Math.round(sz.heatKW * L.scale);
    const work = sz.work[i];
    ETHRUSTERS.push({
      id: `ethruster_${sz.size}_mk${L.lv}`,
      nameCn: `电力推进器·${sz.cn}${L.roman}`,
      nameEn: `Electric Thruster ${sz.cn} ${L.roman}`,
      mark: 1, markLabel: 'MKI', category: 'engine', materialSlot: 'engine',
      thrust, mass, powerDraw, footprint, heatKW, work,
      // 效率比（推力 ÷ 耗电），仅作设计展示用，不影响燃料公式
      effRatio: +(thrust / powerDraw).toFixed(2),
      desc: '电力推进器。以电能代替化学燃料产生推力，耗电低、推力对电力的转化效率优于化学引擎；'
          + '代价是电机与电源拉高了质量，且不烧燃料、起飞几乎不耗燃。'
          + `${sz.cn}型第 ${L.roman} 级。`,
    });
  }
}

export const ENGINES = [
  // 基础引擎：只有 MKI 一档，船坞一建成就能用（设计者原话「引擎最开始有基础引擎」）
  { id: 'engine_basic', nameCn: '基础引擎', nameEn: 'Basic Engine',
    mark: 1, markLabel: 'MKI', category: 'engine', materialSlot: 'engine',
    thrust: 120, mass: 6, fuelBurn: 0.02, heatKW: 15, efficiency: 0.30,
    desc: '最原始的化学推进器。推力小、效率低，但船坞一建成就能造，是所有飞船的起点。' },
  { id: 'engine_light', nameCn: '轻型引擎', nameEn: 'Light Engine',
    mki: { thrust: 200, mass: 8, fuelBurn: 0.03, heatKW: 18, efficiency: 0.42 },
    desc: '推力不大但极轻，推重比最高的一档。配超小型外壳能跑出全星系最快航速，代价是拉不动货。' },
  { id: 'engine_balanced', nameCn: '均衡引擎', nameEn: 'Balanced Engine',
    mki: { thrust: 340, mass: 18, fuelBurn: 0.05, heatKW: 26, efficiency: 0.45 },
    desc: '推力与重量平衡，中型船的标准配置。什么活都能干，什么都不突出。' },
  { id: 'engine_heavy', nameCn: '重型引擎', nameEn: 'Heavy Engine',
    mki: { thrust: 620, mass: 42, fuelBurn: 0.09, heatKW: 45, efficiency: 0.47 },
    desc: '大推力、沉。大型船体与武装运输船的必要配置，起飞燃料消耗也相应暴涨。' },
  { id: 'engine_super', nameCn: '超重型引擎', nameEn: 'Super-Heavy Engine',
    mki: { thrust: 1150, mass: 110, fuelBurn: 0.18, heatKW: 80, efficiency: 0.50 },
    desc: '只有它能推动超大型外壳。散热极高，必须有乘员仓之外的额外散热余量，否则容易过热。' },
].flatMap((e) => {
  if (e.mki) {
    return expand('engine', [{
      id: e.id, nameCn: e.nameCn, nameEn: e.nameEn,
      materialSlot: e.materialSlot || 'engine', desc: e.desc,
      thrust: e.mki.thrust, mass: e.mki.mass, fuelBurn: e.mki.fuelBurn,
      heatKW: e.mki.heatKW, efficiency: e.mki.efficiency,
    }]);
  }
  return [e];
}).concat(ETHRUSTERS);

// ============================================================================
// 三、舰载武器（设计者要求：机枪 / 舰炮 / 火箭 / 激光器 等）
// ============================================================================
export const WEAPONS = expand('weapon', [
  { id: 'wpn_mg', nameCn: '机枪', nameEn: 'Autocannon',
    materialSlot: 'weapon', damage: 8, footprint: 4, mass: 1.2, heatKW: 3, powerKW: 2, rangeKm: 2,
    desc: '动能速射武器。伤害低、占地小、几乎不过热，适合塞在剩余容量里做近防。' },
  { id: 'wpn_cannon', nameCn: '舰炮', nameEn: 'Naval Cannon',
    materialSlot: 'weapon', damage: 45, footprint: 22, mass: 9, heatKW: 18, powerKW: 8, rangeKm: 8,
    desc: '中口径动能炮。单发伤害高、射程中等，是主力舰的标准武装，热量也不难压。' },
  { id: 'wpn_rocket', nameCn: '火箭', nameEn: 'Rocket Battery',
    materialSlot: 'weapon', damage: 120, footprint: 36, mass: 14, heatKW: 22, powerKW: 6, rangeKm: 40,
    desc: '远程齐射武器。伤害与射程都最好，但要占地方又吃弹药，装多了容量立刻见底。' },
  { id: 'wpn_laser', nameCn: '激光器', nameEn: 'Laser Array',
    materialSlot: 'weapon', damage: 70, footprint: 30, mass: 11, heatKW: 55, powerKW: 40, rangeKm: 25,
    desc: '能量武器。中等伤害、射程远、耗电惊人、发热也最猛——'
        + '连续开火会把船体温推高，材料熔点低的外壳撑不住。' },
]);

// ============================================================================
// 四、船上设施（设计者要求：乘员仓 / 仓库 / 机库 / 装甲 等）
// ============================================================================
// 这四类也完整收录在「科研 → 设施」子分类里，供玩家先浏览再决定研究什么。
export const FACILITIES = expand('facility', [
  // v0.1.3（需求 4）：乘员仓开放材料自选（hull 材料槽）。
  //   材料影响质量（massMul）与耐热上限；老存档里 material:null 的条目会自动落到
  //   DEFAULT_MATERIAL.hull='铁'，无需迁移。
  { id: 'fac_crew', nameCn: '乘员仓', nameEn: 'Crew Quarters',
    materialSlot: 'hull', footprint: 30, mass: 6, crew: 60, tempBandBonus: 4,
    desc: '提供载员名额与生命维持。每座可载 60 人，并让全船的温度安全区间向两端各放宽 4 K'
        + '——没有乘员仓的船在温度波动下最先死人。可选材料：轻合金减重，耐热合金提高耐受上限。' },
  // v0.1.1（需求 10b，设计者确认口径）：货舱容量按**货舱自身占地**缩放——
  //   小型货舱 cargoVol = footprint × 0.1，大型货舱 cargoVol = footprint × 0.5。
  //   注意 fac_cargo 的 id 保持不变（老存档兼容），只改展示名与数值。
  { id: 'fac_cargo', nameCn: '小型货舱', nameEn: 'Small Cargo Hold',
    materialSlot: null, footprint: 60, mass: 10, cargoVol: 6,
    desc: '小型货物舱。占 60 m³ 船体容量，能装 6 m³ 货物。容量有限，适合早期探索船捎带少量物资。' },
  { id: 'fac_cargo_l', nameCn: '大型货舱', nameEn: 'Large Cargo Hold',
    materialSlot: null, footprint: 120, mass: 20, cargoVol: 60,
    desc: '大型货物舱。占 120 m³ 船体容量，能装 60 m³ 货物（装货效率是小型货舱的 5 倍），是运输船的核心。' },
  { id: 'fac_hangar', nameCn: '机库', nameEn: 'Hangar Bay',
    materialSlot: null, footprint: 200, mass: 45, hangarSlots: 2,
    desc: '容纳小型飞行器的机库。每座可停放 2 架，让母舰不必亲自登陆。占地极大，只有大型以上外壳装得下。' },
  { id: 'fac_armor', nameCn: '装甲', nameEn: 'Armor Plating',
    materialSlot: 'armor', footprint: 15, mass: 12, structAdd: 8,
    desc: '外挂装甲板。占地小、质量大，直接给船体加结构强度。'
        + '装甲是可自选材料的部件——用钨或碳化钨做，强度高但极重；用石墨烯做，又轻又硬但贵。' },
]);

export const ARMOR = FACILITIES.filter((f) => f.id.startsWith('fac_armor'));

// ============================================================================
// 索引与查询
// ============================================================================
export const ALL_PARTS = [...HULLS, ...ENGINES, ...WEAPONS, ...FACILITIES];
export const PART_BY_ID = Object.fromEntries(ALL_PARTS.map((p) => [p.id, p]));

export const PART_CATEGORIES = {
  hull: '舰船外壳',
  engine: '引擎',
  weapon: '武器',
  facility: '船上设施',
};

export function partsOf(category, mark) {
  const list = ALL_PARTS.filter((p) => p.category === category);
  return mark ? list.filter((p) => p.mark === mark) : list;
}

// 舰船部件的解锁条件。
// v0.0.61：由原来的「四条支线科技 + MK2/MK3」统一改为**船坞**。
// 设计者原话：「科研里面的 abcd 也去掉，一些基础船上设施的研究前置为船坞」。
// 取消 MK 分级后剩下的部件全是基础型号，所以一律「研究出船坞（t_e3）即可使用」。
// 注意：这里只负责舰船部件；电力设施（facilities.js）由 t_b8 单独把关，不走本函数。
export const SHIP_UNLOCK_TECH = 't_e3';

export function isPartUnlocked(partId, researched) {
  const p = PART_BY_ID[partId];
  if (!p) return false;
  const done = researched instanceof Set ? researched : new Set(researched || []);
  return done.has(SHIP_UNLOCK_TECH);
}

// 玩家当前可用的最高型号。v0.0.61：MK 分级取消，恒为 1。
export function maxMark() {
  return 1;
}

// ============================================================================
// 可制造部件清单（v0.0.7，设计者任务 1）
// ============================================================================
// 把「舰船部件」暴露成可被制造车间（fabricator）生产的物品，供 core 用
// 动态配方方式生成（类似现有 refine_<材料> 动态配方，配方生成在 recipes.js 之外做，
// 这里只给清单）。清单覆盖外壳 / 引擎 / 武器 / 船上设施四类。
//
// 单件工作量建议（设计者给定，按体量微调后最终值）：
//   外壳 600 / 引擎 400 / 武器 300 / 设施 250（见下面 WORK 表）。
//
// 字段说明（每条）：
//   partId        部件 id（如 hull_s_mk1 / fac_crew_mk1）——基础 id 绝不改
//   nameCn        中文名
//   category      hull | engine | weapon | facility
//   defaultMaterial  该部件槽位的默认材料（materialSlot 为 null 的设施返回 null）
//   materialSlot      材质槽名（hull/engine/weapon/armor/null）
//   materials        允许自选的材料清单（MATERIAL_SLOTS[slot]，无槽位则为 []）
//   work          单件工作量（人·秒）
//   footprint     单件在储藏中占用的体积（m³）：设施/武器取其 footprint；
//                 外壳取 capacity（代表其体量）；引擎无 footprint 字段，按 mass×2 估算占位。
//   mass          部件质量（t），方便配方/UI 展示
// v0.3.3：制造速率大幅下调。速率公式 production.js#tickProduction 为
//   rate = labor × powerRatio × V012_LINE_RATE_MUL ÷ recipe.work
// 即 **work 越大速率越低**。本次下调口径：
//   船上设施 facility  250   → 25000    （速率降为 1/100）
//   船外壳   hull      600   → 600000   （速率降为 1/1000）
//   引擎     engine   400   → 40000    （速率降为 1/100）
//   武器     weapon   300   → 30000    （速率降为 1/100）
// 注意：craftWorkOf 同时被 shipyard.js#blueprintBuildCost 消费（造船总工作量），
//   所以这里抬高 work 会同步拉长造船时间 —— 这是预期效果（造船也应变慢）。
const CRAFT_WORK = { hull: 600000, engine: 40000, weapon: 30000, facility: 25000 };

export function craftableParts() {
  const out = [];
  const push = (p) => {
    const slot = p.materialSlot || null;
    const def = slot ? DEFAULT_MATERIAL[slot] : null;
    let footprint = p.footprint;
    if (footprint == null) {
      if (p.category === 'hull') footprint = p.capacity;
      else if (p.category === 'engine') footprint = Math.max(1, Math.round((p.mass || 1) * 2));
      else footprint = 0;
    }
    out.push({
      partId: p.id,
      nameCn: p.nameCn,
      category: p.category,
      defaultMaterial: def,
      materialSlot: slot,
      materials: slot ? (MATERIAL_SLOTS[slot] || []) : [],
      // 部件自带 work 时优先（如 v0.0.8 电力推进器按大小档给 400~1200），否则按类别取默认工作量
      work: p.work != null ? p.work : (CRAFT_WORK[p.category] || 0),
      footprint,
      mass: p.mass != null ? p.mass : (p.emptyMass != null ? p.emptyMass : null),
    });
  };
  for (const h of HULLS) push(h);
  for (const e of ENGINES) push(e);
  for (const w of WEAPONS) push(w);
  for (const f of FACILITIES) push(f);
  return out;
}

// 按部件 id 取单件工作量（供 core 的船坞产出计算复用，单一数据源）
export function craftWorkOf(partId) {
  const base = PART_BY_ID[partId];
  if (!base) return 0;
  // 部件自带 work 时优先（如 v0.0.8 电力推进器按大小档给 400~1200），否则按类别取默认工作量
  if (base.work != null) return base.work;
  return CRAFT_WORK[base.category] || 0;
}

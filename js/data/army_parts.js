// 军事部件与军队蓝图数据（Astrix v0.2.0）
// 纯数据表模块，零依赖（仅引材料表做名称校验），浏览器直接 import。
//
// 设计约定（与舰船体系对齐）：
//   * 军事部件在「制造车间」（fabricator）按生产线生产，产出进 inst.equipment
//     （key = partId@材料，与舰船部件同一库存口径，见 production.js partRecipe 的 army 分支）。
//   * 每个部件**固定单一材料**（不走材料自选）——军队部件是小件，配方固定更直观；
//     inputs = { 材料名: 份数 }，生产 1 件的固定投料。
//   * 部件按军事科技逐级解锁：t_m1 基础军用装备 → t_m2 高级军用装备 → t_m3 超级军用装备（v0.2.10 三级）
//   v0.2.3：全部部件的固定投料 ×5（成军是一笔大投入，资源造价极大幅度上调；
//     工作量 buildWork 不变，只抬资源门槛）
//   * 蓝图 = 部件清单（id × count）。组装 1 支军队 = 按蓝图扣齐部件 + buildWork 人·秒工作量。
//   * 三张默认蓝图（设计者确认稿）：
//       ① 游骑兵·轻型突击队 —— 快 / 便宜 / 低装甲，侦察游击
//       ② 铁壁·重装步兵班   —— 慢 / 高装甲，正面推进
//       ③ 雷霆·机动炮组     —— 中速 / 远程高伤，火力支援

// 部件类别（决定其在战力公式里的权重口径）
export const ARMY_CATS = {
  frame: '框架',        // 承载结构：提供 编制（def 基数）
  mobility: '机动',     // 载具底盘：提供 speed
  weapon: '武器',       // 枪炮：提供 atk
  armor: '装甲',        // 防护：提供 def
  support: '支援',      // 观测/补给：提供 atk 增益或 def 增益
};

// ---------------------------------------------------------------------------
// 部件表
//   tech   解锁所需军事科技（t_m1~t_m3）
//   mass   单件质量（用于投料折算参考与蓝图总质量）
//   work   生产 1 件的工作量（人·秒）
//   inputs 固定投料（材料名 → 份数），材料全部来自 materials.js 真实材料
//   atk/def/speed 部件对战力的贡献（army.js#armyStatsOf 求和）
// ---------------------------------------------------------------------------
// v0.3.3：全部 ap_* 的 work 统一 ×100（制造速率降为原来的 1/100）。
//   速率公式见 production.js#tickProduction：rate = labor × powerRatio ÷ recipe.work，
//   work 越大速率越低。旧值区间 300~2800 → 新值 30000~280000。
// ---------------------------------------------------------------------------
export const ARMY_PARTS = [
  // —— 框架（t_m1 起就有基础框架，更重型框架随后续科技解锁）——
  { id: 'ap_frame_light', nameCn: '轻型框架', cat: 'frame', slot: 'hull', tech: 't_m1', mass: 80, work: 42000, cap: 10,
    inputs: { '铝': 150, '塑料': 30 },
    atk: 0, def: 10, speed: 0, desc: '班组成的基础承载结构，轻便但单薄。' },
  { id: 'ap_frame_heavy', nameCn: '重型框架', cat: 'frame', slot: 'hull', tech: 't_m2', mass: 260, work: 110000, cap: 14,
    inputs: { '钛合金': 90, '钢': 100, '橡胶': 30 },
    atk: 0, def: 30, speed: -4, desc: '装甲载具级框架，承载重装部件，代价是机动性。' },

  // —— 机动底盘（t_m1 轮式起步，t_m2 悬浮/履带/装甲车）——
  { id: 'ap_mob_hover', nameCn: '悬浮底盘', cat: 'mobility', slot: 'engine', tech: 't_m2', mass: 120, work: 70000,
    inputs: { '钛合金': 50, '石墨烯': 30, '氢气': 70 },
    atk: 0, def: 4, speed: 18, desc: '气垫悬浮，全地形高速机动。' },
  { id: 'ap_mob_track', nameCn: '履带底盘', cat: 'mobility', slot: 'engine', tech: 't_m2', mass: 210, work: 78000,
    inputs: { '钢': 110, '橡胶': 60 },
    atk: 0, def: 10, speed: 6, desc: '重装履带，慢但稳，适合正面推进。' },
  { id: 'ap_mob_wheel', nameCn: '轮式底盘', cat: 'mobility', slot: 'engine', tech: 't_m1', mass: 140, work: 62000,
    inputs: { '铝': 90, '橡胶': 50 },
    atk: 0, def: 5, speed: 13, desc: '公路轮式底盘，性价比最高的机动方案。' },
  { id: 'ap_mob_apc', nameCn: '装甲车底盘', cat: 'mobility', slot: 'engine', tech: 't_m2', mass: 300, work: 130000,
    inputs: { '钢': 160, '钛合金': 60, '橡胶': 70 },
    atk: 0, def: 22, speed: 8, desc: '装甲运兵载具底盘，防护与机动兼顾，机械化部队的中坚。' },

  // —— 武器（t_m1 步枪，t_m2 机炮/火炮/激光器，t_m3 高能激光炮）——
  { id: 'ap_wpn_rifle', nameCn: '突击步枪', cat: 'weapon', slot: 'weapon', tech: 't_m1', mass: 12, work: 30000,
    inputs: { '钢': 50, '塑料': 20 },
    atk: 14, def: 0, speed: 0, desc: '班组制式步枪，成本低、火力可靠。' },
  { id: 'ap_wpn_hmg', nameCn: '重机枪', cat: 'weapon', slot: 'weapon', tech: 't_m2', mass: 45, work: 56000,
    inputs: { '钢': 100, '铜': 40, '炸药粉': 20 },
    atk: 32, def: 0, speed: -2, desc: '压制性持续火力，阵地战核心。' },
  { id: 'ap_wpn_howitzer', nameCn: '榴弹炮', cat: 'weapon', slot: 'weapon', tech: 't_m2', mass: 380, work: 180000,
    inputs: { '碳化钨': 70, '钢': 150, '炸药粉': 60 },
    atk: 85, def: 0, speed: -8, desc: '远程压制火炮，单发毁伤惊人，依赖观测校射。' },
  { id: 'ap_wpn_laser', nameCn: '激光器', cat: 'weapon', slot: 'weapon', tech: 't_m2', mass: 70, work: 90000,
    inputs: { '铜': 80, '石墨烯': 50, '银': 20 },
    atk: 55, def: 0, speed: -1, desc: '聚焦激光束，无弹药后勤负担，高级部队的中坚火力。' },
  { id: 'ap_wpn_helaser', nameCn: '高能激光炮', cat: 'weapon', slot: 'weapon', tech: 't_m3', mass: 420, work: 280000,
    inputs: { '石墨烯': 120, '银': 60, '纳米碳合金': 40, '钛合金': 100 },
    atk: 135, def: 0, speed: -8, desc: '舰载级高能激光炮，单发汽化装甲，超级部队的招牌重火。' },

  // —— 装甲（t_m1 轻甲，t_m2 复合，t_m3 力场）——
  { id: 'ap_armor_light', nameCn: '轻型护甲', cat: 'armor', slot: 'armor', tech: 't_m1', mass: 60, work: 48000,
    inputs: { '铝': 110, '陶瓷': 30 },
    atk: 0, def: 16, speed: -1, desc: '插板式轻甲，防破片与流弹。' },
  { id: 'ap_armor_composite', nameCn: '复合装甲', cat: 'armor', slot: 'armor', tech: 't_m2', mass: 190, work: 98000,
    inputs: { '钛合金': 80, '陶瓷': 70, '纳米碳合金': 20 },
    atk: 0, def: 42, speed: -5, desc: '陶艺复合层，正面抗穿甲。' },
  { id: 'ap_armor_force', nameCn: '力场装甲', cat: 'armor', slot: 'armor', tech: 't_m3', mass: 260, work: 210000,
    inputs: { '石墨烯': 90, '纳米碳合金': 60, '银': 40 },
    atk: 0, def: 72, speed: -4, desc: '偏导力场发生器，将动能与热能偏转，接近免疫常规弹幕。' },

  // —— 支援（t_m3）——
  { id: 'ap_sup_radar', nameCn: '观测雷达', cat: 'support', slot: 'hull', tech: 't_m3', mass: 90, work: 86000,
    inputs: { '钢': 60, '银': 20, '玻璃': 40 },
    atk: 18, def: 0, speed: -2, desc: '校射观测，显著提升远程命中（atk 增益）。' },
  { id: 'ap_sup_supply', nameCn: '补给单元', cat: 'support', slot: 'hull', tech: 't_m3', mass: 110, work: 70000,
    inputs: { '铝': 70, '塑料': 50, '橡胶': 30 },
    atk: 0, def: 14, speed: 2, desc: '弹药油料随队补给，延长持续作战（def 增益）。' },
];

// v0.2.4：军事部件材料槽（复用舰船 MATERIAL_SLOTS 与 materialMul ——
//   不同材料造出的军队数值不同：武器材料放大 atk、框架/装甲材料放大 def、
//   机动底盘材料按质量倍率反比影响 speed）。
export const ARMY_SLOT_BY_CAT = {
  frame: 'hull', mobility: 'engine', weapon: 'weapon', armor: 'armor', support: 'hull',
};

// v0.2.4：编制点成本（类钢铁雄心编队宽度）—— 非框架部件占用编制点，
//   蓝图合法 = ≥1 框架 + ≥1 武器，且 Σ(件数×成本) ≤ Σ(框架 cap)。
export const ARMY_PART_COST = { frame: 0, mobility: 3, weapon: 2, armor: 2, support: 3 };

/** 蓝图（或草稿）的编制点占用：{ used, cap, ok } */
export function armyCapOf(parts) {
  let used = 0, cap = 0, frames = 0, weapons = 0;
  for (const it of (Array.isArray(parts) ? parts : [])) {
    const p = ARMY_PART_BY_ID[it.id];
    if (!p) continue;
    const n = Math.max(0, Number(it.count) || 0);
    if (p.cat === 'frame') { cap += (Number(p.cap) || 0) * n; frames += n; }
    else {
      used += (ARMY_PART_COST[p.cat] || 2) * n;
      if (p.cat === 'weapon') weapons += n;
    }
  }
  return { used, cap, frames, weapons, ok: frames >= 1 && weapons >= 1 && used <= cap };
}

export const ARMY_PART_BY_ID = Object.fromEntries(ARMY_PARTS.map((p) => [p.id, p]));

// 某军事部件是否已解锁（techSet = 账号 acc.tech）
export function isArmyPartUnlocked(partId, techSet) {
  const p = ARMY_PART_BY_ID[partId];
  if (!p) return false;
  if (!p.tech) return true;
  return !!(techSet && techSet.has && techSet.has(p.tech));
}

// 可生产的军事部件（已解锁的）
export function craftableArmyParts(techSet) {
  return ARMY_PARTS.filter((p) => isArmyPartUnlocked(p.id, techSet));
}

// ---------------------------------------------------------------------------
// 军队蓝图（3 张默认蓝图，设计者确认稿）
//   id        固定 id（生产线 / 进度表按它索引，**勿改**）
//   tech      组装门槛（军队指挥 t_m5）
//   buildWork 组装 1 支的总工作量（人·秒）
//   parts     部件清单 [{ id, count }]
// ---------------------------------------------------------------------------
export const ARMY_BLUEPRINTS = [
  {
    // v0.2.1：军队在「基础军用装备 t_m1」即解锁，游骑兵用纯 t_m1 部件，研究完 M1 立即可造。
    id: 'ab_ranger', nameCn: '游骑兵·轻型突击队', tech: 't_m1',
    desc: '轻型框架 + 突击步枪：单兵武器阶段即可列装的基础步兵，廉价、机动，适合侦察与维稳。',
    buildWork: 3000,
    parts: [
      { id: 'ap_frame_light', count: 3, material: '铁' },
      { id: 'ap_wpn_rifle', count: 4, material: '铁' },
    ],
  },
  {
    // v0.2.1：铁壁随「高级军用装备 t_m2」解锁（部件含 t_m2 重机枪/复合装甲，需相应科技后才齐料）。
    id: 'ab_ironwall', nameCn: '铁壁·重装步兵班', tech: 't_m2',
    desc: '重型框架 + 履带 + 重机枪 + 复合装甲：慢、贵、极高装甲，正面推进的中坚。',
    buildWork: 16000,
    parts: [
      { id: 'ap_frame_heavy', count: 2, material: '钢' },
      { id: 'ap_mob_track', count: 2, material: '钢' },
      { id: 'ap_wpn_hmg', count: 3, material: '钢' },
      { id: 'ap_armor_composite', count: 3, material: '钢' },
      { id: 'ap_sup_supply', count: 1, material: '铁' },
    ],
  },
  {
    // v0.2.1：雷霆随「超级军用装备 t_m3」解锁（部件含榴弹炮/雷达/补给，现均属 t_m2/t_m3）。
    id: 'ab_thunder', nameCn: '雷霆·机动炮组', tech: 't_m3',
    desc: '轮式底盘 + 榴弹炮 + 观测雷达 + 补给：中速远程火力支援，单发毁伤最高。',
    buildWork: 22000,
    parts: [
      { id: 'ap_frame_light', count: 2, material: '铁' },
      { id: 'ap_mob_wheel', count: 3, material: '铝' },
      { id: 'ap_wpn_howitzer', count: 2, material: '钢' },
      { id: 'ap_sup_radar', count: 1, material: '铁' },
      { id: 'ap_sup_supply', count: 1, material: '铁' },
    ],
  },
];

export const ARMY_BP_BY_ID = Object.fromEntries(ARMY_BLUEPRINTS.map((b) => [b.id, b]));

// 蓝图所需军事部件总清单（{ partId: count }），组装校验与生产进度用
// v0.2.4：兼容传蓝图对象（军队设计器的自定义蓝图不在 ARMY_BP_BY_ID 里）
export function armyBpPartNeeds(bpOrId) {
  const bp = (bpOrId && typeof bpOrId === 'object') ? bpOrId : ARMY_BP_BY_ID[bpOrId];
  const need = {};
  if (!bp) return need;
  for (const it of bp.parts) need[it.id] = (need[it.id] || 0) + (Number(it.count) || 0);
  return need;
}

// 蓝图组装所需材料总投料（{ 材料名: 份数 }）——部件已造好时只扣部件，此表用于 UI 展示与预算
export function armyBpMaterialNeeds(bpOrId) {
  const need = armyBpPartNeeds(bpOrId);
  const mats = {};
  for (const partId in need) {
    const p = ARMY_PART_BY_ID[partId];
    if (!p) continue;
    for (const m in (p.inputs || {})) {
      mats[m] = (mats[m] || 0) + (Number(p.inputs[m]) || 0) * need[partId];
    }
  }
  return mats;
}

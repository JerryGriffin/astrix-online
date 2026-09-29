// 军事部件与军队蓝图数据（Astrix v0.2.0）
// 纯数据表模块，零依赖（仅引材料表做名称校验），浏览器直接 import。
//
// 设计约定（与舰船体系对齐）：
//   * 军事部件在「制造车间」（fabricator）按生产线生产，产出进 inst.equipment
//     （key = partId@材料，与舰船部件同一库存口径，见 production.js partRecipe 的 army 分支）。
//   * 每个部件**固定单一材料**（不走材料自选）——军队部件是小件，配方固定更直观；
//     inputs = { 材料名: 份数 }，生产 1 件的固定投料。
//   * 部件按军事科技逐级解锁：t_m1 单兵武器 → t_m2 军用装甲 → t_m3 机动平台 → t_m4 火炮重武。
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
//   tech   解锁所需军事科技（t_m1~t_m4）
//   mass   单件质量（用于投料折算参考与蓝图总质量）
//   work   生产 1 件的工作量（人·秒）
//   inputs 固定投料（材料名 → 份数），材料全部来自 materials.js 真实材料
//   atk/def/speed 部件对战力的贡献（army.js#armyStatsOf 求和）
// ---------------------------------------------------------------------------
export const ARMY_PARTS = [
  // —— 框架（t_m1 起就有基础框架，更重型框架随后续科技解锁）——
  { id: 'ap_frame_light', nameCn: '轻型框架', cat: 'frame', tech: 't_m1', mass: 80, work: 420,
    inputs: { '铝': 30, '塑料': 6 },
    atk: 0, def: 10, speed: 0, desc: '班组成的基础承载结构，轻便但单薄。' },
  { id: 'ap_frame_heavy', nameCn: '重型框架', cat: 'frame', tech: 't_m2', mass: 260, work: 1100,
    inputs: { '钛合金': 18, '钢': 20, '橡胶': 6 },
    atk: 0, def: 30, speed: -4, desc: '装甲载具级框架，承载重装部件，代价是机动性。' },

  // —— 机动平台（t_m3）——
  { id: 'ap_mob_hover', nameCn: '悬浮底盘', cat: 'mobility', tech: 't_m3', mass: 120, work: 700,
    inputs: { '钛合金': 10, '石墨烯': 6, '氢气': 14 },
    atk: 0, def: 4, speed: 18, desc: '气垫悬浮，全地形高速机动。' },
  { id: 'ap_mob_track', nameCn: '履带底盘', cat: 'mobility', tech: 't_m3', mass: 210, work: 780,
    inputs: { '钢': 22, '橡胶': 12 },
    atk: 0, def: 10, speed: 6, desc: '重装履带，慢但稳，适合正面推进。' },
  { id: 'ap_mob_wheel', nameCn: '轮式底盘', cat: 'mobility', tech: 't_m3', mass: 140, work: 620,
    inputs: { '铝': 18, '橡胶': 10 },
    atk: 0, def: 5, speed: 13, desc: '公路轮式底盘，性价比最高的机动方案。' },

  // —— 单兵与班组武器（t_m1）——
  { id: 'ap_wpn_rifle', nameCn: '突击步枪', cat: 'weapon', tech: 't_m1', mass: 12, work: 300,
    inputs: { '钢': 10, '塑料': 4 },
    atk: 14, def: 0, speed: 0, desc: '班组制式步枪，成本低、火力可靠。' },
  { id: 'ap_wpn_hmg', nameCn: '重机枪', cat: 'weapon', tech: 't_m2', mass: 45, work: 560,
    inputs: { '钢': 20, '铜': 8, '炸药粉': 4 },
    atk: 32, def: 0, speed: -2, desc: '压制性持续火力，阵地战核心。' },
  { id: 'ap_wpn_howitzer', nameCn: '榴弹炮', cat: 'weapon', tech: 't_m4', mass: 380, work: 1800,
    inputs: { '碳化钨': 14, '钢': 30, '炸药粉': 12 },
    atk: 85, def: 0, speed: -8, desc: '远程压制火炮，单发毁伤惊人，依赖观测校射。' },

  // —— 装甲（t_m2）——
  { id: 'ap_armor_light', nameCn: '轻型护甲', cat: 'armor', tech: 't_m2', mass: 60, work: 480,
    inputs: { '铝': 22, '陶瓷': 6 },
    atk: 0, def: 16, speed: -1, desc: '插板式轻甲，防破片与流弹。' },
  { id: 'ap_armor_composite', nameCn: '复合装甲', cat: 'armor', tech: 't_m2', mass: 190, work: 980,
    inputs: { '钛合金': 16, '陶瓷': 14, '纳米碳合金': 4 },
    atk: 0, def: 42, speed: -5, desc: '陶艺复合层，正面抗穿甲。' },

  // —— 支援（t_m4）——
  { id: 'ap_sup_radar', nameCn: '观测雷达', cat: 'support', tech: 't_m4', mass: 90, work: 860,
    inputs: { '钢': 12, '银': 4, '玻璃': 8 },
    atk: 18, def: 0, speed: -2, desc: '校射观测，显著提升远程命中（atk 增益）。' },
  { id: 'ap_sup_supply', nameCn: '补给单元', cat: 'support', tech: 't_m4', mass: 110, work: 700,
    inputs: { '铝': 14, '塑料': 10, '橡胶': 6 },
    atk: 0, def: 14, speed: 2, desc: '弹药油料随队补给，延长持续作战（def 增益）。' },
];

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
    id: 'ab_ranger', nameCn: '游骑兵·轻型突击队', tech: 't_m5',
    desc: '悬浮底盘 + 突击步枪 + 轻甲：快、便宜、低装甲，适合侦察袭扰与追击。',
    buildWork: 9000,
    parts: [
      { id: 'ap_frame_light', count: 3 },
      { id: 'ap_mob_hover', count: 2 },
      { id: 'ap_wpn_rifle', count: 4 },
      { id: 'ap_armor_light', count: 2 },
    ],
  },
  {
    id: 'ab_ironwall', nameCn: '铁壁·重装步兵班', tech: 't_m5',
    desc: '重型框架 + 履带 + 重机枪 + 复合装甲：慢、贵、极高装甲，正面推进的中坚。',
    buildWork: 16000,
    parts: [
      { id: 'ap_frame_heavy', count: 2 },
      { id: 'ap_mob_track', count: 2 },
      { id: 'ap_wpn_hmg', count: 3 },
      { id: 'ap_armor_composite', count: 3 },
      { id: 'ap_sup_supply', count: 1 },
    ],
  },
  {
    id: 'ab_thunder', nameCn: '雷霆·机动炮组', tech: 't_m5',
    desc: '轮式底盘 + 榴弹炮 + 观测雷达 + 补给：中速远程火力支援，单发毁伤最高。',
    buildWork: 22000,
    parts: [
      { id: 'ap_frame_light', count: 2 },
      { id: 'ap_mob_wheel', count: 3 },
      { id: 'ap_wpn_howitzer', count: 2 },
      { id: 'ap_sup_radar', count: 1 },
      { id: 'ap_sup_supply', count: 1 },
    ],
  },
  {
    id: 'ab_titan', nameCn: '泰坦·重装机甲连', tech: 't_m5',
    desc: '双重框架 + 复合重甲 + 履带底盘 + 双榴弹重炮：陆战攻坚终极巨兽，极高装甲与爆发火力。',
    buildWork: 32000,
    parts: [
      { id: 'ap_frame_heavy', count: 4 },
      { id: 'ap_mob_track', count: 3 },
      { id: 'ap_wpn_howitzer', count: 2 },
      { id: 'ap_wpn_hmg', count: 2 },
      { id: 'ap_armor_composite', count: 4 },
      { id: 'ap_sup_supply', count: 2 },
    ],
  },
  {
    id: 'ab_specops', nameCn: '幽灵·隐秘特战突击队', tech: 't_m5',
    desc: '超轻框架 + 高速悬浮 + 高精度突击步枪 + 雷达侦测：超强渗透与闪击先锋，机动与夜战拔尖。',
    buildWork: 14000,
    parts: [
      { id: 'ap_frame_light', count: 2 },
      { id: 'ap_mob_hover', count: 3 },
      { id: 'ap_wpn_rifle', count: 6 },
      { id: 'ap_armor_light', count: 2 },
      { id: 'ap_sup_radar', count: 2 },
    ],
  },
];

export const ARMY_BP_BY_ID = Object.fromEntries(ARMY_BLUEPRINTS.map((b) => [b.id, b]));

// 蓝图所需军事部件总清单（{ partId: count }），组装校验与生产进度用
export function armyBpPartNeeds(bpId) {
  const bp = ARMY_BP_BY_ID[bpId];
  const need = {};
  if (!bp) return need;
  for (const it of bp.parts) need[it.id] = (need[it.id] || 0) + (Number(it.count) || 0);
  return need;
}

// 蓝图组装所需材料总投料（{ 材料名: 份数 }）——部件已造好时只扣部件，此表用于 UI 展示与预算
export function armyBpMaterialNeeds(bpId) {
  const need = armyBpPartNeeds(bpId);
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

// 配方表（Astrix v0.0.6）
// 纯数据模块，零依赖，浏览器直接 import。
//
// 契约来源：docs/TODO_v0.0.6.md 第 1.3 节（冻结接口），不得改名/改签名。
//
// 设计原则：
//   1. 所有 inputs / outputs 的 key 都必须是 js/data/materials.js 的 nameCn
//      或 js/data/planets.js 里出现过的资源名（气体 / 矿石 / 燃料）。
//   2. 价值链自洽：原料链不得倒挂（造某物不能用比它层级更高的材料）。
//      层级口径见 docs/TODO_v0.0.6.md 第 0 节「建材可获得性铁律」：
//        T0 有机质/泥土/石头/水
//        T1 粘土/二氧化硅/石墨/孔雀石/石英/红土/硫磺 + 熔炉产物(木头/碳) + 各天然原矿
//        T2 铁/铜/锌/铝/玻璃/陶瓷/钢
//        T4 钛/银/金/钨/锰/锂/铀/铱/钚/橡胶/塑料/铝合金/碳化钨/钛合金
//        T6 石墨烯
//      气体（氧气/氢气/二氧化碳/甲烷/氨气/氮气/氩气/氦气/硫磺气）属天然资源，不受层级限制。
//   3. work 量级：让「满员一座建筑」约十几秒出一批。
//      各建筑 jobs：furnace 12 / blast_furnace 20 / electrolyzer 12 / chem_lab 24 /
//      refinery 20 / custom_chem 32 / farm 16 / bio_factory 16 / fabricator 28。
//      取 work ≈ jobs × 10，使满员有效人力 / work ≈ 0.1 次/秒（≈10 秒/批）。
//   4. fabricator 的 12 个电力设施配方：outputs 留空 {}（产出由设施系统结算），
//      用 producesFacility 字段标记设施 id（不 import facilities.js，避免耦合），
//      inputs 遵守建材铁律（小型电池/光伏只用 T0~T1 材料）。

export const RECIPES = [
  // ===================== 熔炉 furnace（有机质→木头→碳）=====================
  {
    id: 'r_furnace_wood',
    buildingId: 'furnace',
    nameCn: '有机质 → 木头',
    inputs: { '有机质': 2, '氧气': 1 },
    outputs: { '木头': 1 },
    work: 120,
    desc: '露天有机质在炉内干馏成木头，消耗氧气并外排二氧化碳（二氧化碳由 population/建筑另行计入星球储藏）。',
    byproductNote: '副产物：二氧化碳',
  },
  {
    id: 'r_furnace_carbon',
    buildingId: 'furnace',
    nameCn: '木头 → 碳',
    inputs: { '木头': 2, '氧气': 1 },
    outputs: { '碳': 1 },
    work: 120,
    desc: '木头在缺氧下炭化得到纯碳，是后续冶炼与化工的骨架材料。',
    byproductNote: '副产物：二氧化碳',
  },
  {
    id: 'r_furnace_charcoal',
    buildingId: 'furnace',
    nameCn: '有机质 → 碳（直接干馏）',
    inputs: { '有机质': 4, '氧气': 2 },
    outputs: { '碳': 1 },
    work: 120,
    desc: '跳过木头环节，把有机质直接高温干馏成碳，过程更慢但省去中间步骤。',
    byproductNote: '副产物：二氧化碳',
  },

  {
    id: 'r_furnace_ceramic',
    buildingId: 'furnace',
    nameCn: '粘土 → 陶瓷（任意炉子）',
    inputs: { '粘土': 2 },
    outputs: { '陶瓷': 1 },
    work: 180,
    desc: '粘土在任意炉子中烧制成陶瓷，用作管件、绝缘与密封件。',
    byproductNote: '',
  },
  {
    // v0.0.7：原「制造车间里的铁+碳→钢」按其归属挪到化学实验室（设计者：那两条是化学实验室的内容）。
    // 化学实验室的建材层级为 T4，铁(T2)/碳(T1) 都低于它，不会倒挂。
    id: 'r_chem_steel',
    buildingId: 'chem_lab',
    nameCn: '铁 + 碳 → 钢',
    inputs: { '铁': 10, '碳': 4 },
    outputs: { '钢': 1 },
    work: 360,
    desc: '铁渗碳精炼成钢，作为结构件与复合材料的基材。钢是飞船结构强度的基准材料，不含气体。',
    byproductNote: '',
  },
  {
    id: 'r_chem_glass',
    buildingId: 'furnace',
    nameCn: '石英 + 碳 → 玻璃（任意炉子）',
    inputs: { '石英': 1, '碳': 1 },
    outputs: { '玻璃': 1 },
    work: 240,
    desc: '石英在任意炉子中高温熔融、加碳脱氧得到透明玻璃（透光建材）。',
    byproductNote: '',
  },
  {
    // v0.1.2 R17：新增二氧化硅路线制玻璃，与 r_chem_glass 同属炉类（furnace），work 照抄。
    id: 'r_chem_silica_glass',
    buildingId: 'furnace',
    nameCn: '二氧化硅 + 碳 → 玻璃（任意炉子）',
    inputs: { '二氧化硅': 32, '碳': 1 },
    outputs: { '玻璃': 1 },
    work: 240,
    desc: '二氧化硅在任意炉子中高温熔融、加碳脱氧得到透明玻璃（透光建材）。与石英路线并用，给二氧化硅一个明确消耗去向。',
    byproductNote: '',
  },

  // ===================== 高炉 blast_furnace（加碳还原 + 水煤气）=====================
  {
    id: 'r_bf_iron',
    buildingId: 'blast_furnace',
    nameCn: '赤铁矿 + 碳 → 铁',
    inputs: { '赤铁矿': 2, '碳': 1 },
    outputs: { '铁': 1 },
    work: 200,
    desc: '碳还原赤铁矿得到基础结构金属铁。',
    byproductNote: '',
  },
  {
    id: 'r_bf_copper',
    buildingId: 'blast_furnace',
    nameCn: '孔雀石 + 碳 → 铜',
    inputs: { '孔雀石': 2, '碳': 1 },
    outputs: { '铜': 1 },
    work: 200,
    desc: '碳还原孔雀石得到导电优良的红铜。',
    byproductNote: '',
  },
  {
    id: 'r_bf_zinc',
    buildingId: 'blast_furnace',
    nameCn: '闪锌矿 + 碳 → 锌',
    inputs: { '闪锌矿': 2, '碳': 1 },
    outputs: { '锌': 1 },
    work: 200,
    desc: '碳还原闪锌矿得到防腐蚀镀层金属锌。',
    byproductNote: '',
  },
  {
    id: 'r_bf_aluminum',
    buildingId: 'blast_furnace',
    nameCn: '红土 + 碳 → 铝',
    inputs: { '红土': 2, '碳': 1 },
    outputs: { '铝': 1 },
    work: 200,
    desc: '碳还原红土得到轻质银白金属铝。',
    byproductNote: '',
  },
  {
    id: 'r_bf_hydrogen',
    buildingId: 'blast_furnace',
    nameCn: '碳 + 水 → 氢气 + 二氧化碳',
    inputs: { '碳': 1, '水': 1 },
    outputs: { '氢气': 1, '二氧化碳': 1 },
    work: 200,
    desc: '碳与水发生水煤气反应制氢（生产冶金氢气的主要手段，合并了水煤气变换步骤）。',
    byproductNote: '副产物：二氧化碳',
  },

  // ===================== 电解池 electrolyzer（电解粗金属 + 电解水）=====================
  {
    id: 'r_el_silver',
    buildingId: 'electrolyzer',
    nameCn: '粗银 → 银',
    inputs: { '粗银': 2 },
    outputs: { '银': 1 },
    work: 120,
    desc: '电解提纯粗银得到高导电贵金属银。',
    byproductNote: '',
  },
  {
    id: 'r_el_gold',
    buildingId: 'electrolyzer',
    nameCn: '粗金 → 金',
    inputs: { '粗金': 2 },
    outputs: { '金': 1 },
    work: 120,
    desc: '电解提纯粗金得到惰性贵金属金。',
    byproductNote: '',
  },
  {
    id: 'r_el_water',
    buildingId: 'electrolyzer',
    nameCn: '水 → 氢气 + 氧气',
    inputs: { '水': 1 },
    outputs: { '氢气': 1, '氧气': 1 },
    work: 120,
    desc: '电解水同时得到氢气与氧气，是稳定的气体来源。',
    byproductNote: '',
  },
  // v0.1.3（需求 2）：重整制气。化学计量 C + 2H₂O → CH₄ + O₂（吸热，由电驱动）。
  //   甲烷是常用飞船燃料，给玩家一条不依赖大气甲烷储量的稳定燃料来源。
  {
    id: 'r_el_methane',
    buildingId: 'electrolyzer',
    nameCn: '水 → 甲烷 + 氧气',
    // v0.4.4（需求 13）：电解池**不再消耗碳**。
    //   原配方 C + 2H₂O → CH₄ + O₂ 需要碳，把「电解池」与「碳」死锁在一起 ——
    //   玩家在只有水的地方（例如殖民地的水冰采集点）完全无法产甲烷，
    //   而甲烷是常用飞船燃料，等于在没有碳的星球上彻底卡死。
    //   现改为电解池只吃水（本质是水的电解/合成），碳改由其他途径产出。
    inputs: { '水': 2 },
    outputs: { '甲烷': 1, '氧气': 2 },
    work: 120,
    desc: '水在电解池中合成甲烷并副产氧气（H₂O → CH₄ + O₂）。**不消耗碳**，'
      + '因此在缺碳的星球也能生产甲烷这一常用飞船燃料。',
    byproductNote: '',
  },
  // v0.1.3 修订（死锁修复）：这三种金属此前**没有任何产出途径** ——
  //   钛的唯一「产出」是精细加工厂的 2合1 升级（得先有钛才有的升），
  //   锰/钨更是连配方都没有，于是「铝合金要锰」「碳化钨要钨」两条链直接断死，
  //   连带地心矿井 / 精细加工厂 / 化学实验室全线建不出来。
  {
    id: 'r_el_titanium',
    buildingId: 'electrolyzer',
    nameCn: '金红石 → 钛',
    // v0.4.4（需求 13）：电解池**一律不消耗碳**（与 r_el_methane 一并调整）。
    //   原本钛也要配碳，等于整个电解池都被碳卡住。
    inputs: { '金红石': 2 },
    outputs: { '钛': 1 },
    work: 120,
    desc: '熔盐电解金红石（TiO₂）得到高强重比金属钛，航天与高端合金的基础。'
      + '**不消耗碳**，因此电解池的任何配方都不会被碳卡住。',
    byproductNote: '',
  },
  {
    id: 'r_bf_manganese',
    buildingId: 'blast_furnace',
    nameCn: '软锰矿 + 碳 → 锰',
    inputs: { '软锰矿': 2, '碳': 1 },
    outputs: { '锰': 1 },
    work: 200,
    desc: '碳还原软锰矿得到锰，是铝合金与特种钢的关键添加元素。',
    byproductNote: '',
  },
  {
    id: 'r_bf_tungsten',
    buildingId: 'blast_furnace',
    nameCn: '黑钨矿 + 碳 → 钨',
    inputs: { '黑钨矿': 2, '碳': 1 },
    outputs: { '钨': 1 },
    work: 200,
    desc: '碳还原黑钨矿得到难熔金属钨，碳化钨与穿甲材料的原料。',
    byproductNote: '',
  },
  {
    id: 'r_el_uranium',
    buildingId: 'electrolyzer',
    nameCn: '沥青铀矿 → 铀',
    inputs: { '沥青铀矿': 2 },
    outputs: { '铀': 1 },
    work: 120,
    desc: '电解提取沥青铀矿中的铀，用于核燃料。',
    byproductNote: '',
  },
  {
    id: 'r_el_lithium',
    buildingId: 'electrolyzer',
    nameCn: '锂辉石 → 锂',
    inputs: { '锂辉石': 2 },
    outputs: { '锂': 1 },
    work: 120,
    desc: '电解提取锂辉石中的锂，用于高电化学活性材料。',
    byproductNote: '',
  },

  // ===================== 化学实验室 chem_lab（复合资源）=====================
  {
    id: 'r_chem_plastic',
    buildingId: 'chem_lab',
    nameCn: '碳 + 氢气 → 塑料',
    inputs: { '碳': 8, '氢气': 4 },
    outputs: { '塑料': 1 },
    work: 320,
    desc: '碳与氢聚合得到轻质可塑的塑料。基础化工产物，用于密封件、管线与绝缘件；配方需氢气门槛（气体）。',
    byproductNote: '',
  },
  {
    id: 'r_chem_rubber',
    buildingId: 'chem_lab',
    nameCn: '碳 + 氢气 → 橡胶',
    inputs: { '碳': 8, '氢气': 6 },
    outputs: { '橡胶': 1 },
    work: 320,
    desc: '碳氢硫化得到弹性密封体橡胶。配方需氢气门槛（气体），用作密封、减震与轮胎。v0.1.2：去掉硫磺（硫磺改为仅天然矿藏，不再被配方消耗）。',
    byproductNote: '',
  },
  {
    id: 'r_chem_aluminum_alloy',
    buildingId: 'chem_lab',
    nameCn: '铝 + 铜 + 锰 → 铝合金',
    inputs: { '铝': 8, '铜': 2, '锰': 2 },
    outputs: { '铝合金': 1 },
    work: 320,
    desc: '铝熔合铜与锰强化成轻质高强铝合金，用于机身与结构件。（不含气体，门槛低于高级复合材料）',
    byproductNote: '',
  },
  {
    id: 'r_chem_explosive',
    buildingId: 'chem_lab',
    nameCn: '碳 + 氮气 → 炸药粉',
    inputs: { '碳': 6, '氮气': 8 },
    outputs: { '炸药粉': 1 },
    work: 320,
    desc: '碳在氮气氛围下合成敏感炸药粉，用于爆破与推进。配方需氮气门槛（气体）。v0.1.2：去掉硫磺（硫磺改为仅天然矿藏，不再被配方消耗）。',
    byproductNote: '',
  },
  {
    // v0.1.2 R14：为化学实验室补齐复合资源产出（与 custom_chem 配方并存，互不干扰）。
    // 输入只用现有基础资源（钨/碳/石墨/钛/铝/钢），不引入新资源、不触发层级倒挂。
    id: 'r_chem_tungsten_carbide',
    buildingId: 'chem_lab',
    nameCn: '钨 + 碳 + 氢气 → 碳化钨',
    inputs: { '钨': 6, '碳': 6, '氢气': 4 },
    outputs: { '碳化钨': 1 },
    work: 480,
    desc: '钨与碳在化学实验室内烧结成极硬耐磨的碳化钨，用于切削工具。化学实验室版（与 custom_chem 并存）。',
    byproductNote: '',
  },
  {
    id: 'r_chem_graphene',
    buildingId: 'chem_lab',
    nameCn: '石墨 + 碳 + 氢气 → 石墨烯',
    inputs: { '石墨': 8, '碳': 4, '氢气': 2 },
    outputs: { '石墨烯': 1 },
    work: 480,
    desc: '石墨在碳氛围下剥离成单层碳原子奇迹材料石墨烯。化学实验室版（与 custom_chem 并存）。',
    byproductNote: '',
  },
  {
    id: 'r_chem_diamond',
    buildingId: 'chem_lab',
    nameCn: '石墨 + 碳 + 甲烷 → 钻石',
    inputs: { '石墨': 8, '碳': 4, '甲烷': 2 },
    outputs: { '钻石': 1 },
    work: 480,
    desc: '高温高压下石墨被碳重构为三维最硬的钻石，顶级切削与装饰材料。化学实验室版（与 custom_chem 并存）。',
    byproductNote: '',
  },
  {
    id: 'r_chem_titanium_alloy',
    buildingId: 'chem_lab',
    nameCn: '钛 + 铝 + 碳 + 氮气 → 钛合金',
    inputs: { '钛': 8, '铝': 4, '碳': 2, '氮气': 2 },
    outputs: { '钛合金': 1 },
    work: 480,
    desc: '钛熔合铝与碳得到高强重比的先进钛合金。化学实验室版（与 custom_chem 并存）。',
    byproductNote: '',
  },
  {
    id: 'r_chem_nanocarbon',
    buildingId: 'chem_lab',
    nameCn: '钢 + 钛 + 碳 + 石墨 + 氮气 → 纳米碳合金',
    inputs: { '钢': 4, '钛': 4, '碳': 2, '石墨': 2, '氮气': 2 },
    outputs: { '纳米碳合金': 1 },
    work: 640,
    desc: '以钢/钛/碳/石墨为骨架熔铸的终极结构材料，轻质近乎不可摧。化学实验室版（与 custom_chem 并存）。',
    byproductNote: '',
  },
  // ===================== 精细加工厂 refinery（2→1 精细度 +1，通用规则）=====================
  {
    id: 'r_refine_demo',
    buildingId: 'refinery',
    nameCn: '【通用规则】材料 ×2 → 同名 ×1（精细度 +1）',
    inputs: { '铁': 2 },
    outputs: { '铁': 1 },
    work: 200,
    desc: '【通用规则】任意材料 ×2 → 同名材料 ×1，体积减半、属性与精细度 +1。'
        + '本配方为代表示例（铁）。更多材料请用下方具名配方，或调用 refinePair(matName) 在 UI 中即时扩展。',
    byproductNote: '',
  },
  {
    id: 'r_refine_iron',
    buildingId: 'refinery',
    nameCn: '铁 ×2 → 铁（精）',
    inputs: { '铁': 2 },
    outputs: { '铁': 1 },
    work: 200,
    desc: '两单位铁精炼为一单位高精细度铁。',
    byproductNote: '',
  },
  {
    id: 'r_refine_copper',
    buildingId: 'refinery',
    nameCn: '铜 ×2 → 铜（精）',
    inputs: { '铜': 2 },
    outputs: { '铜': 1 },
    work: 200,
    desc: '两单位铜精炼为一单位高精细度铜。',
    byproductNote: '',
  },
  {
    id: 'r_refine_steel',
    buildingId: 'refinery',
    nameCn: '钢 ×2 → 钢（精）',
    inputs: { '钢': 2 },
    outputs: { '钢': 1 },
    work: 200,
    desc: '两单位钢精炼为一单位高精细度钢。',
    byproductNote: '',
  },
  {
    id: 'r_refine_titanium',
    buildingId: 'refinery',
    nameCn: '钛 ×2 → 钛（精）',
    inputs: { '钛': 2 },
    outputs: { '钛': 1 },
    work: 200,
    desc: '两单位钛精炼为一单位高精细度钛。',
    byproductNote: '',
  },

  // ===================== 自定义化工厂 custom_chem（可自行定义）=====================
  {
    id: 'r_custom_graphene',
    buildingId: 'custom_chem',
    nameCn: '石墨 + 甲烷 → 石墨烯',
    inputs: { '石墨': 10, '甲烷': 4 },
    outputs: { '石墨烯': 1 },
    work: 480,
    desc: '把石墨在甲烷氛围下剥离成单层碳原子奇迹材料石墨烯。【可自行定义配方】配方需甲烷门槛（气体）。',
    byproductNote: '',
  },
  {
    id: 'r_custom_tungsten_carbide',
    buildingId: 'custom_chem',
    nameCn: '钨 + 碳 + 氢气 → 碳化钨',
    inputs: { '钨': 6, '碳': 6, '氢气': 2 },
    outputs: { '碳化钨': 1 },
    work: 480,
    desc: '钨与碳在氢气保护下烧结成极硬耐磨的碳化钨，用于切削工具。【可自行定义配方】配方需氢气门槛（气体）。',
    byproductNote: '',
  },
  {
    id: 'r_custom_titanium_alloy',
    buildingId: 'custom_chem',
    nameCn: '钛 + 铝 + 碳 + 氮气 → 钛合金',
    inputs: { '钛': 8, '铝': 4, '碳': 2, '氮气': 2 },
    outputs: { '钛合金': 1 },
    work: 480,
    desc: '钛熔合铝与碳，在氮气氛围下得到高强重比的先进钛合金。【可自行定义配方】配方需氮气门槛（气体）。',
    byproductNote: '',
  },
  {
    id: 'r_custom_diamond',
    buildingId: 'custom_chem',
    nameCn: '石墨 + 甲烷 + 氧气 → 钻石',
    inputs: { '石墨': 8, '甲烷': 4, '氧气': 2 },
    outputs: { '钻石': 1 },
    work: 480,
    desc: '高温高压下石墨被甲烷/氧气重构为三维最硬的钻石，顶级切削与装饰材料。【新增复合配方】配方需甲烷+氧气门槛（气体）。',
    byproductNote: '',
  },
  {
    id: 'r_custom_nanocarbon',
    buildingId: 'custom_chem',
    nameCn: '石墨烯 + 钛合金 + 碳化钨 + 甲烷 → 纳米碳合金',
    inputs: { '石墨烯': 4, '钛合金': 4, '碳化钨': 4, '甲烷': 4 },
    outputs: { '纳米碳合金': 1 },
    work: 640,
    desc: '以石墨烯/钛合金/碳化钨为骨架，在甲烷氛围下熔铸的终极结构材料，轻质近乎不可摧。【新增复合配方】配方需甲烷门槛（气体）。',
    byproductNote: '',
  },

  // ===================== 农田 farm（岗位驱动，固定配方：二氧化碳 + 水 → 有机质）=====================
  // 设计者 v0.0.91：农田不走生产线，只保留「二氧化碳 + 水 → 有机质」这一条。
  // v0.1.1（需求 7）：产出由 24 翻倍到 48（设计者确认：只翻倍产出，氧/水仍靠采集），
  // 投料与 work 不变；农田还吃 core 侧的「建筑数量效率」加成。
  {
    id: 'r_farm_organic_water',
    buildingId: 'farm',
    nameCn: '二氧化碳 + 水 → 有机质（农田工岗位）',
    inputs: { '二氧化碳': 4, '水': 2 },
    outputs: { '有机质': 48 },
    work: 192,
    desc: '农田工岗位驱动的固定配方：每批消耗二氧化碳 4、水 2，光合产出有机质 48。'
        + 'v0.1.1 调整：产出较上一版（24）翻倍，投料不变。'
        + 'v0.1.2 调整：工作量 960 → 192（产率 ×5，对应 R10），单位人力的净有机质产出进一步上升。'
        + '二氧化碳不足时由 core 从大气里取，本数据只写配方，扣料逻辑在 core 实现。',
    byproductNote: '',
  },

  // ===================== 生物工厂 bio_factory（耗 CO2 产气液）=====================
  {
    id: 'r_bio_oxygen',
    buildingId: 'bio_factory',
    nameCn: '二氧化碳 → 氧气 + 有机质',
    inputs: { '二氧化碳': 2 },
    outputs: { '氧气': 1, '有机质': 1 },
    work: 160,
    desc: '光合/生物固碳，产出可呼吸的氧气与生物质有机质。',
    byproductNote: '',
  },
  {
    id: 'r_bio_methane',
    buildingId: 'bio_factory',
    nameCn: '二氧化碳 + 有机质 → 甲烷 + 水',
    inputs: { '二氧化碳': 1, '有机质': 1 },
    outputs: { '甲烷': 1, '水': 1 },
    work: 160,
    desc: '厌氧消化，把二氧化碳与有机质转化为燃料甲烷并副产水。',
    byproductNote: '副产物：水',
  },
  {
    id: 'r_bio_ammonia',
    buildingId: 'bio_factory',
    nameCn: '氮气 + 氢气 + 有机质 → 氨气 + 水',
    inputs: { '氮气': 1, '氢气': 1, '有机质': 1 },
    outputs: { '氨气': 1, '水': 1 },
    work: 160,
    desc: '生物固氮，把氮气、氢气与有机质合成氨气（化肥/化工之源）。',
    byproductNote: '副产物：水',
  },

  // ===================== 制造车间 fabricator（小型/中型物品 + 12 项电力设施）=====================
  // —— 小型/中型物品（用真实材料代表螺栓、管件、结构件等部件）——
  // —— 12 项电力设施：outputs 留空，producesFacility 标记设施 id，inputs 遵守建材铁律 ——
  // 电池（T1 可造，只用 T0~T1 材料：石墨/碳/石头/石英/泥土）
  {
    id: 'r_fab_battery_s',
    buildingId: 'fabricator',
    nameCn: '制造：小型电池',
    inputs: { '石墨': 10, '碳': 10, '石头': 5 },
    outputs: {},
    work: 280,
    producesFacility: 'battery_s',
    desc: '组装小型电池（储电模块）。只用 T0~T1 材料，开局即可量产。',
    byproductNote: '',
  },
  {
    id: 'r_fab_battery_m',
    buildingId: 'fabricator',
    nameCn: '制造：中型电池',
    inputs: { '石墨': 40, '碳': 40, '石头': 20, '泥土': 10 },
    outputs: {},
    work: 560,
    producesFacility: 'battery_m',
    desc: '组装中型电池，储电量与用料同比放大。',
    byproductNote: '',
  },
  {
    id: 'r_fab_battery_l',
    buildingId: 'fabricator',
    nameCn: '制造：大型电池',
    inputs: { '石墨': 160, '碳': 160, '石头': 80, '石英': 20 },
    outputs: {},
    work: 1120,
    producesFacility: 'battery_l',
    desc: '组装大型电池，储电能力最强。',
    byproductNote: '',
  },
  // 太阳能板（T2~T4）
  {
    id: 'r_fab_solar_s',
    buildingId: 'fabricator',
    nameCn: '制造：小型光伏',
    inputs: { '石英': 10, '玻璃': 5 },
    outputs: {},
    work: 280,
    producesFacility: 'solar_s',
    desc: '组装小型光伏板，受星球日照系数影响发电。',
    byproductNote: '',
  },
  {
    id: 'r_fab_solar_m',
    buildingId: 'fabricator',
    nameCn: '制造：中型光伏',
    inputs: { '石英': 40, '玻璃': 20, '铝': 10 },
    outputs: {},
    work: 560,
    producesFacility: 'solar_m',
    desc: '组装中型光伏板。',
    byproductNote: '',
  },
  {
    id: 'r_fab_solar_l',
    buildingId: 'fabricator',
    nameCn: '制造：大型光伏',
    inputs: { '石英': 200, '玻璃': 100, '铝': 50, '钛合金': 20 },
    outputs: {},
    work: 1120,
    producesFacility: 'solar_l',
    desc: '组装大型光伏阵列，用料含钛合金以扛极端环境。',
    byproductNote: '',
  },
  // 风力机（T2~T4）
  {
    id: 'r_fab_wind_s',
    buildingId: 'fabricator',
    nameCn: '制造：小型风机',
    inputs: { '铁': 15, '石头': 10, '铜': 5 },
    outputs: {},
    work: 280,
    producesFacility: 'wind_s',
    desc: '组装小型风力发电机，受星球风力系数影响发电。',
    byproductNote: '',
  },
  {
    id: 'r_fab_wind_m',
    buildingId: 'fabricator',
    nameCn: '制造：中型风机',
    inputs: { '铁': 60, '铜': 20, '钢': 20, '铝': 10 },
    outputs: {},
    work: 560,
    producesFacility: 'wind_m',
    desc: '组装中型风力发电机。',
    byproductNote: '',
  },
  {
    id: 'r_fab_wind_l',
    buildingId: 'fabricator',
    nameCn: '制造：大型风机',
    inputs: { '铁': 300, '铜': 100, '钢': 100, '铝': 50, '钛合金': 20 },
    outputs: {},
    work: 1120,
    producesFacility: 'wind_l',
    desc: '组装大型风力发电机，叶片用钛合金强化。',
    byproductNote: '',
  },
  // 火力机（T3~T5，不超 T4 材料）
  {
    id: 'r_fab_thermal_s',
    buildingId: 'fabricator',
    nameCn: '制造：小型火力机',
    inputs: { '石头': 30, '铁': 20, '石墨': 10, '钢': 10 },
    outputs: {},
    work: 280,
    producesFacility: 'thermal_s',
    desc: '组装小型火力发电机（烧燃料发电）。',
    byproductNote: '',
  },
  {
    id: 'r_fab_thermal_m',
    buildingId: 'fabricator',
    nameCn: '制造：中型火力机',
    inputs: { '石头': 120, '铁': 80, '钢': 50, '钛合金': 20, '碳化钨': 10 },
    outputs: {},
    work: 560,
    producesFacility: 'thermal_m',
    desc: '组装中型火力发电机，耐耗件用钛合金与碳化钨。',
    byproductNote: '',
  },
  {
    id: 'r_fab_thermal_l',
    buildingId: 'fabricator',
    nameCn: '制造：大型火力机',
    inputs: { '石头': 600, '钢': 300, '钛合金': 100, '碳化钨': 50 },
    outputs: {},
    work: 1120,
    producesFacility: 'thermal_l',
    desc: '组装大型火力发电机，重工业级耐久。',
    byproductNote: '',
  },
];

export const RECIPE_BY_ID = Object.fromEntries(RECIPES.map((r) => [r.id, r]));

// 按建筑取配方（冻结接口）
export function recipesOfBuilding(buildingId) {
  return RECIPES.filter((r) => r.buildingId === buildingId);
}

// 按 id 取配方（冻结接口）
export function getRecipe(id) {
  return (id != null && RECIPE_BY_ID[id]) || null;
}

// 星球数据模块（Astrix）
// 数据来源：docs/planets.json（由研究子代理生成，本模块负责归一化与补全）
// 单位换算规则：储量 amount 为纯数字，k=10^3、m=10^6、g=10^9、t=10^12（注意 g 是 10^9 非克）。
// 字段归一化：nameZh→nameCn，reserve 字符串(带单位)→amount 数字，internalEnergy.referenceTempC→initialTempC，
//             initialLabor{total,usable}→population{total,available}，power.totalEnergy→power.totalEnergy。
// 补全/推断项：
//   - code：星球名前 3 字母小写（syl/des/cal/ves/nov/gla/atr），源数据缺失，本模块按规则生成。
//   - description：一句话中文定位描述（源数据无，按 Astroneer 设定补写，≤30字）。
//   - orbit：radius 按星系位置给 1~10（Sylva=3），phase 均匀分布于 0~2π（源数据无，本模块生成）。
//   - happiness：初始统一 1.0（源数据无）。
//   - canRebel：Sylva=false，其余=true（源数据无，按游戏设定补）。
// 七个星球（Sylva/Desolo/Calidor/Vesania/Novus/Glacio/Atrox）源数据齐全，无缺补。
//
// ========== v0.0.2 设计说明 ==========
// 1) 人力规则：仅希尔瓦开局有人口（v0.0.6：由 1000/900 改为 **100/90**）。其余 6 个星球开局无人
//    （population 均为 0/0），并标记 needsImmigration:true，UI 提示「本星球无人力，需从希尔瓦移民」。
//    —— 其他星球只能靠从希尔瓦移民来获得人力，无法在本地自然增长。
// 2) 氨气规则：氨（氨气/Ammonia）只以气态呈现在 gases 数组，不刷新在地表/地下/地核。
//    现有各星球 layers 中无「氨/氨气/Ammonia」条目（仅有「铵」铵盐，属性不同，保留）。
//    希尔瓦 gases 已有氨气；其余有大气的星球按特征补了微量氨气（标注【推断】）。
// 3) 燃料资源 fuels：每星球按自然合理性填写，仅填该星球合理存在的燃料。
//    燃料栏数值为设计推断，待调整。
//    覆盖燃料类型：碳、标准煤、铀、钚、氢气、联氨、甲烷。
//    说明：联氨为人工合成燃料，自然界基本不存在，故各星球均不列入自然矿藏（fuels）；
//          荒芜卫星（德索罗）无煤；气态/冰原星球氢气甲烷丰富；辐射星球铀钚较多。
//
// ========== v0.0.9 设计说明（资源层补全） ==========
// 1) 丰度递增：同一资源在地表丰度最低，地下更高，地核最高，严格满足
//    地表 < 地下 < 地核。口径：地下 = 地表 × 5，地核 = 地下 × 5
//    （地表出现的资源，深层/地心必须存在；原层已有的矿保持不变但同样满足递增）。
// 2) 地表资源补齐：每个星球 layers.surface 出现过的每种资源（气体走 gases，
//    不进 surface 条目）都补进 underground 与 core；原层没有则新增条目，
//    储量参考同层其它矿物的量级，同星球内风格一致。
// 3) 种类数目错开：underground 与 core 的条目数互不相等，且不同星球之间也错开
//    （给部分星球追加少量额外的深层矿实现），避免 7 个星球清一色一样。
// 4) 同名不重复：每层内同名资源不出现重复条目；若需合并则 amount 相加、abundance 取大。
//    资源名均取自 materials.js 的 nameCn，amount / abundance 均为正数有限数。
//
//
// ========== v0.0.91 设计说明（地下分层：浅层 / 深层） ==========
// 1) 原 underground 拆分为 underground（浅层）与新增 deep（深层）两层，储量各自独立：
//    浅层 = 原 underground × 40%，深层 = 原 underground × 60%（同一份储量不重复计算）。
//    丰度：深层 = 浅层 × 1.5（体现越深越丰富），并保持 地表 < 浅层 < 深层 < 地核 严格递增。
// 2) 每层内同名不重复；deep 不得包含 core 独有矿（如 太空元素）。
//    注：v0.0.9 已把全部地表资源补进 underground，故地表/浅层已无额外独立矿种可加入
//    deep（加入会同名重复），deep 矿物种类与浅层一致，符合「可以（非必须）多 1~3 种」的口径。
// 3) 赤铁矿（铁/钢的源头）补齐：希尔瓦硬要求浅层+深层都有；desolo/calidor/vesania/atrox
//    本地原无赤铁矿，深层矿井造价含铁/钢会卡死，统一在浅层+深层补少量赤铁矿（不能卡住）。
//    novus/glacio 原浅层/深层/地核已有赤铁矿，拆分后自动落入浅层与深层。
//
export const PLANETS = [
  {
    id: 'sylva',
    code: 'syl',
    nameCn: '希尔瓦',
    nameEn: 'Sylva',
    type: '类地行星',
    description: '宜居母星，资源丰富气候温和',
    orbit: {
      radius: 3,
      phase: 0,
    },
    layers: {
      surface: [
        {
          name: '有机质',
          amount: 5e6,
          abundance: 2,
        },
        {
          name: '石头',
          amount: 1e11,
          abundance: 15,
        },
        {
          name: '石墨',
          amount: 100000,
          abundance: 0.3,
        },
        {
          name: '粘土',
          amount: 500000,
          abundance: 0.5,
        },
        {
          name: '孔雀石',
          amount: 10000,
          abundance: 0.015,
        },
        {
          name: '水',
          amount: 1e10,
          abundance: 10,
        },
        {
          name: '泥土',
          amount: 1e9,
          abundance: 1,
        },
        {
          name: '二氧化硅',
          amount: 1e11,
          abundance: 15,
        },
      ],
      underground: [
        {
          name: '石头',
          amount: 4e11,
          abundance: 75,
        },
        {
          name: '红土',
          amount: 40000,
          abundance: 0.075,
        },
        {
          name: '闪锌矿',
          amount: 20000,
          abundance: 0.03,
        },
        {
          name: '石英',
          amount: 200000,
          abundance: 0.75,
        },
        {
          name: '有机质',
          amount: 2e6,
          abundance: 1,
        },
        {
          name: '石墨',
          amount: 40000,
          abundance: 1.5,
        },
        {
          name: '粘土',
          amount: 200000,
          abundance: 2.5,
        },
        {
          name: '孔雀石',
          amount: 4000,
          abundance: 0.075,
        },
        {
          name: '水',
          amount: 4e9,
          abundance: 5,
        },
        {
          name: '泥土',
          amount: 4e8,
          abundance: 0.5,
        },
        {
          name: '二氧化硅',
          amount: 4e10,
          abundance: 75,
        },
        {
          name: '软锰矿',
          amount: 20000,
          abundance: 0.045,
        },
        {
          name: '赤铁矿',
          amount: 50000,
          abundance: 0.045,
        },
      ],
      deep: [
        {
          name: '石头',
          amount: 6e11,
          abundance: 112.5,
        },
        {
          name: '红土',
          amount: 60000,
          abundance: 0.1125,
        },
        {
          name: '闪锌矿',
          amount: 30000,
          abundance: 0.045,
        },
        {
          name: '粗银',
          amount: 600,
          abundance: 2.25e-4,
        },
        {
          name: '粗金',
          amount: 300,
          abundance: 2.25e-6,
        },
        {
          name: '石英',
          amount: 300000,
          abundance: 1.125,
        },
        {
          name: '有机质',
          amount: 3e6,
          abundance: 1.5,
        },
        {
          name: '石墨',
          amount: 60000,
          abundance: 2.25,
        },
        {
          name: '粘土',
          amount: 300000,
          abundance: 3.75,
        },
        {
          name: '孔雀石',
          amount: 6000,
          abundance: 0.1125,
        },
        {
          name: '水',
          amount: 6e9,
          abundance: 7.5,
        },
        {
          name: '泥土',
          amount: 6e8,
          abundance: 0.75,
        },
        {
          name: '二氧化硅',
          amount: 6e10,
          abundance: 112.5,
        },
        {
          name: '软锰矿',
          amount: 30000,
          abundance: 0.0675,
        },
        {
          name: '赤铁矿',
          amount: 80000,
          abundance: 0.0675,
        },
      ],
      core: [
        {
          name: '石头',
          amount: 2e6,
          abundance: 375,
        },
        {
          name: '太空元素',
          amount: 1e6,
          abundance: 1.5e-4,
        },
        {
          name: '粗银',
          amount: 100000,
          abundance: 0.0015,
        },
        {
          name: '粗金',
          amount: 50000,
          abundance: 1.5e-5,
        },
        {
          name: '有机质',
          amount: 1e7,
          abundance: 5,
        },
        {
          name: '石墨',
          amount: 200000,
          abundance: 7.5,
        },
        {
          name: '粘土',
          amount: 1e6,
          abundance: 12.5,
        },
        {
          name: '孔雀石',
          amount: 20000,
          abundance: 0.375,
        },
        {
          name: '水',
          amount: 2e10,
          abundance: 25,
        },
        {
          name: '泥土',
          amount: 2e9,
          abundance: 2.5,
        },
        {
          name: '二氧化硅',
          amount: 2e11,
          abundance: 375,
        },
      ],
    },
    gases: [
      {
        name: '氮气',
        amount: 8e10,
        abundance: 1,
      },
      {
        name: '氧气',
        amount: 2e10,
        abundance: 1,
      },
      {
        name: '氨气',
        amount: 10000,
        abundance: 0.001,
      },
      {
        name: '甲烷',
        amount: 10000,
        abundance: 0.001,
      },
      {
        name: '二氧化碳',
        amount: 1000,
        abundance: 1e-5,
      },
    ],
    fuels: [
      {
        name: '碳',
        amount: 5e9,
        abundance: 1,
      },
      {
        name: '标准煤',
        amount: 1e9,
        abundance: 0.5,
      },
      {
        name: '甲烷',
        amount: 1e8,
        abundance: 0.01,
      },
      {
        name: '氢气',
        amount: 1e7,
        abundance: 0.001,
      },
      {
        name: '铀',
        amount: 100000,
        abundance: 1e-5,
      },
      {
        name: '钚',
        amount: 1000,
        abundance: 1e-8,
      },
    ],
    power: {
      totalEnergy: 1e14,
      hydro: 1.2,
      wind: 1.2,
      solar: 1.2,
    },
    initialTempC: 25,
    population: {
      total: 100,
      available: 90,
    },
    needsImmigration: false,
    happiness: 1,
    canRebel: false,
  },
  {
    id: 'desolo',
    code: 'des',
    nameCn: '德索罗',
    nameEn: 'Desolo',
    type: '类地卫星',
    description: '荒芜卫星，无大气昼夜极端',
    orbit: {
      radius: 3.6,
      phase: 0.898,
    },
    layers: {
      surface: [
        {
          name: '有机质',
          amount: 2e6,
          abundance: 1.5,
        },
        {
          name: '石头',
          amount: 8e10,
          abundance: 15,
        },
        {
          name: '石墨',
          amount: 80000,
          abundance: 0.3,
        },
        {
          name: '粘土',
          amount: 300000,
          abundance: 0.5,
        },
        {
          name: '闪锌矿',
          amount: 8000,
          abundance: 0.015,
        },
        {
          name: '钨锰铁矿',
          amount: 1000,
          abundance: 0.0015,
        },
        {
          name: '泥土',
          amount: 5e8,
          abundance: 1,
        },
        {
          name: '二氧化硅',
          amount: 8e10,
          abundance: 15,
        },
        {
          name: '铵',
          amount: 200000,
          abundance: 0.45,
        },
      ],
      underground: [
        {
          name: '石头',
          amount: 3.2e11,
          abundance: 75,
        },
        {
          name: '红土',
          amount: 32000,
          abundance: 0.075,
        },
        {
          name: '钨锰铁矿',
          amount: 24000,
          abundance: 0.03,
        },
        {
          name: '闪锌矿',
          amount: 16000,
          abundance: 0.075,
        },
        {
          name: '石英',
          amount: 160000,
          abundance: 0.75,
        },
        {
          name: '有机质',
          amount: 800000,
          abundance: 0.75,
        },
        {
          name: '石墨',
          amount: 32000,
          abundance: 1.5,
        },
        {
          name: '粘土',
          amount: 120000,
          abundance: 2.5,
        },
        {
          name: '泥土',
          amount: 2e8,
          abundance: 0.5,
        },
        {
          name: '二氧化硅',
          amount: 3.2e10,
          abundance: 75,
        },
        {
          name: '铵',
          amount: 80000,
          abundance: 2.25,
        },
        {
          name: '锂辉石',
          amount: 20000,
          abundance: 0.045,
        },
        {
          name: '黑钨矿',
          amount: 20000,
          abundance: 0.045,
        },
        {
          name: '赤铁矿',
          amount: 50000,
          abundance: 0.045,
        },
      ],
      deep: [
        {
          name: '石头',
          amount: 4.8e11,
          abundance: 112.5,
        },
        {
          name: '红土',
          amount: 48000,
          abundance: 0.1125,
        },
        {
          name: '钨锰铁矿',
          amount: 36000,
          abundance: 0.045,
        },
        {
          name: '闪锌矿',
          amount: 24000,
          abundance: 0.1125,
        },
        {
          name: '粗银',
          amount: 480,
          abundance: 2.25e-4,
        },
        {
          name: '粗金',
          amount: 240,
          abundance: 2.25e-6,
        },
        {
          name: '石英',
          amount: 240000,
          abundance: 1.125,
        },
        {
          name: '有机质',
          amount: 1.2e6,
          abundance: 1.125,
        },
        {
          name: '石墨',
          amount: 48000,
          abundance: 2.25,
        },
        {
          name: '粘土',
          amount: 180000,
          abundance: 3.75,
        },
        {
          name: '泥土',
          amount: 3e8,
          abundance: 0.75,
        },
        {
          name: '二氧化硅',
          amount: 4.8e10,
          abundance: 112.5,
        },
        {
          name: '铵',
          amount: 120000,
          abundance: 3.375,
        },
        {
          name: '锂辉石',
          amount: 30000,
          abundance: 0.0675,
        },
        {
          name: '黑钨矿',
          amount: 30000,
          abundance: 0.0675,
        },
        {
          name: '赤铁矿',
          amount: 80000,
          abundance: 0.0675,
        },
      ],
      core: [
        {
          name: '石头',
          amount: 2e6,
          abundance: 375,
        },
        {
          name: '太空元素',
          amount: 800000,
          abundance: 1.5e-4,
        },
        {
          name: '粗银',
          amount: 80000,
          abundance: 0.0015,
        },
        {
          name: '粗金',
          amount: 40000,
          abundance: 1.5e-5,
        },
        {
          name: '有机质',
          amount: 4e6,
          abundance: 3.75,
        },
        {
          name: '石墨',
          amount: 160000,
          abundance: 7.5,
        },
        {
          name: '粘土',
          amount: 600000,
          abundance: 12.5,
        },
        {
          name: '闪锌矿',
          amount: 16000,
          abundance: 0.375,
        },
        {
          name: '钨锰铁矿',
          amount: 2000,
          abundance: 0.15,
        },
        {
          name: '泥土',
          amount: 1e9,
          abundance: 2.5,
        },
        {
          name: '二氧化硅',
          amount: 2e11,
          abundance: 375,
        },
        {
          name: '铵',
          amount: 400000,
          abundance: 11.25,
        },
      ],
    },
    gases: [],
    fuels: [
      {
        name: '碳',
        amount: 1e6,
        abundance: 0.01,
      },
      {
        name: '铀',
        amount: 50000,
        abundance: 1e-5,
      },
      {
        name: '钚',
        amount: 500,
        abundance: 1e-8,
      },
    ],
    power: {
      totalEnergy: 7e13,
      hydro: 0.2,
      wind: 0.4,
      solar: 1.8,
    },
    initialTempC: -30,
    population: {
      total: 0,
      available: 0,
    },
    needsImmigration: true,
    happiness: 1,
    canRebel: true,
  },
  {
    id: 'calidor',
    code: 'cal',
    nameCn: '卡利多',
    nameEn: 'Calidor',
    type: '干旱行星',
    description: '干旱荒漠，烈日炎炎',
    orbit: {
      radius: 5,
      phase: 1.795,
    },
    layers: {
      surface: [
        {
          name: '有机质',
          amount: 1e6,
          abundance: 1,
        },
        {
          name: '石头',
          amount: 1e11,
          abundance: 15,
        },
        {
          name: '石墨',
          amount: 90000,
          abundance: 0.3,
        },
        {
          name: '粘土',
          amount: 600000,
          abundance: 0.75,
        },
        {
          name: '孔雀石',
          amount: 5000,
          abundance: 0.015,
        },
        {
          name: '钨锰铁矿',
          amount: 2000,
          abundance: 0.0015,
        },
        {
          name: '泥土',
          amount: 8e8,
          abundance: 1,
        },
        {
          name: '二氧化硅',
          amount: 1e11,
          abundance: 15,
        },
        {
          name: '铵',
          amount: 150000,
          abundance: 0.3,
        },
      ],
      underground: [
        {
          name: '石头',
          amount: 4e11,
          abundance: 75,
        },
        {
          name: '红土',
          amount: 48000,
          abundance: 0.075,
        },
        {
          name: '孔雀石',
          amount: 32000,
          abundance: 0.075,
        },
        {
          name: '钨锰铁矿',
          amount: 20000,
          abundance: 0.0225,
        },
        {
          name: '石英',
          amount: 180000,
          abundance: 0.75,
        },
        {
          name: '有机质',
          amount: 400000,
          abundance: 0.5,
        },
        {
          name: '石墨',
          amount: 36000,
          abundance: 1.5,
        },
        {
          name: '粘土',
          amount: 240000,
          abundance: 3.75,
        },
        {
          name: '泥土',
          amount: 3.2e8,
          abundance: 0.5,
        },
        {
          name: '二氧化硅',
          amount: 4e10,
          abundance: 75,
        },
        {
          name: '铵',
          amount: 60000,
          abundance: 1.5,
        },
        {
          name: '赤铁矿',
          amount: 60000,
          abundance: 0.03,
        },
      ],
      deep: [
        {
          name: '石头',
          amount: 6e11,
          abundance: 112.5,
        },
        {
          name: '红土',
          amount: 72000,
          abundance: 0.1125,
        },
        {
          name: '孔雀石',
          amount: 48000,
          abundance: 0.1125,
        },
        {
          name: '钨锰铁矿',
          amount: 30000,
          abundance: 0.03375,
        },
        {
          name: '粗银',
          amount: 360,
          abundance: 2.25e-4,
        },
        {
          name: '粗金',
          amount: 180,
          abundance: 2.25e-6,
        },
        {
          name: '石英',
          amount: 270000,
          abundance: 1.125,
        },
        {
          name: '有机质',
          amount: 600000,
          abundance: 0.75,
        },
        {
          name: '石墨',
          amount: 54000,
          abundance: 2.25,
        },
        {
          name: '粘土',
          amount: 360000,
          abundance: 5.625,
        },
        {
          name: '泥土',
          amount: 4.8e8,
          abundance: 0.75,
        },
        {
          name: '二氧化硅',
          amount: 6e10,
          abundance: 112.5,
        },
        {
          name: '铵',
          amount: 90000,
          abundance: 2.25,
        },
        {
          name: '赤铁矿',
          amount: 90000,
          abundance: 0.045,
        },
      ],
      core: [
        {
          name: '石头',
          amount: 2e6,
          abundance: 375,
        },
        {
          name: '太空元素',
          amount: 900000,
          abundance: 1.5e-4,
        },
        {
          name: '粗银',
          amount: 60000,
          abundance: 0.0015,
        },
        {
          name: '粗金',
          amount: 30000,
          abundance: 1.5e-5,
        },
        {
          name: '有机质',
          amount: 2e6,
          abundance: 2.5,
        },
        {
          name: '石墨',
          amount: 180000,
          abundance: 7.5,
        },
        {
          name: '粘土',
          amount: 1e6,
          abundance: 18.75,
        },
        {
          name: '孔雀石',
          amount: 10000,
          abundance: 0.375,
        },
        {
          name: '钨锰铁矿',
          amount: 4000,
          abundance: 0.1125,
        },
        {
          name: '泥土',
          amount: 2e9,
          abundance: 2.5,
        },
        {
          name: '二氧化硅',
          amount: 2e11,
          abundance: 375,
        },
        {
          name: '铵',
          amount: 300000,
          abundance: 7.5,
        },
        {
          name: '锂辉石',
          amount: 20000,
          abundance: 0.225,
        },
        {
          name: '金红石',
          amount: 20000,
          abundance: 0.225,
        },
      ],
    },
    gases: [
      {
        name: '氢气',
        amount: 1e11,
        abundance: 1,
      },
      {
        name: '硫磺气',
        amount: 5e10,
        abundance: 1,
      },
      {
        name: '氨气',
        amount: 1e8,
        abundance: 0.001,
      },
    ],
    fuels: [
      {
        name: '碳',
        amount: 2e6,
        abundance: 0.02,
      },
      {
        name: '氢气',
        amount: 5e10,
        abundance: 1,
      },
      {
        name: '甲烷',
        amount: 1e8,
        abundance: 0.005,
      },
      {
        name: '铀',
        amount: 100000,
        abundance: 1e-5,
      },
      {
        name: '钚',
        amount: 800,
        abundance: 1e-8,
      },
    ],
    power: {
      totalEnergy: 1e14,
      hydro: 0.2,
      wind: 0.4,
      solar: 2.2,
    },
    initialTempC: 55,
    population: {
      total: 0,
      available: 0,
    },
    needsImmigration: true,
    happiness: 1,
    canRebel: true,
  },
  {
    id: 'vesania',
    code: 'ves',
    nameCn: '弗沙尼亚',
    nameEn: 'Vesania',
    type: '奇异行星',
    description: '茂密森林异星，大气厚密',
    orbit: {
      radius: 6,
      phase: 2.693,
    },
    layers: {
      surface: [
        {
          name: '有机质',
          amount: 8e6,
          abundance: 2,
        },
        {
          name: '石头',
          amount: 9e10,
          abundance: 15,
        },
        {
          name: '石墨',
          amount: 100000,
          abundance: 0.3,
        },
        {
          name: '粘土',
          amount: 400000,
          abundance: 0.5,
        },
        {
          name: '锂',
          amount: 3000,
          abundance: 0.0015,
        },
        {
          name: '钛',
          amount: 2000,
          abundance: 0.0015,
        },
        {
          name: '泥土',
          amount: 6e8,
          abundance: 1,
        },
        {
          name: '二氧化硅',
          amount: 9e10,
          abundance: 15,
        },
        {
          name: '铵',
          amount: 300000,
          abundance: 0.45,
        },
      ],
      underground: [
        {
          name: '石头',
          amount: 3.6e11,
          abundance: 75,
        },
        {
          name: '红土',
          amount: 36000,
          abundance: 0.075,
        },
        {
          name: '锂',
          amount: 28000,
          abundance: 0.03,
        },
        {
          name: '钛',
          amount: 24000,
          abundance: 0.0225,
        },
        {
          name: '石英',
          amount: 168000,
          abundance: 0.75,
        },
        {
          name: '有机质',
          amount: 3.2e6,
          abundance: 1,
        },
        {
          name: '石墨',
          amount: 40000,
          abundance: 1.5,
        },
        {
          name: '粘土',
          amount: 160000,
          abundance: 2.5,
        },
        {
          name: '泥土',
          amount: 2.4e8,
          abundance: 0.5,
        },
        {
          name: '二氧化硅',
          amount: 3.6e10,
          abundance: 75,
        },
        {
          name: '铵',
          amount: 120000,
          abundance: 2.25,
        },
        {
          name: '软锰矿',
          amount: 20000,
          abundance: 0.045,
        },
        {
          name: '黑钨矿',
          amount: 20000,
          abundance: 0.045,
        },
        {
          name: '金红石',
          amount: 20000,
          abundance: 0.045,
        },
        {
          name: '赤铁矿',
          amount: 50000,
          abundance: 0.03,
        },
      ],
      deep: [
        {
          name: '石头',
          amount: 5.4e11,
          abundance: 112.5,
        },
        {
          name: '红土',
          amount: 54000,
          abundance: 0.1125,
        },
        {
          name: '锂',
          amount: 42000,
          abundance: 0.045,
        },
        {
          name: '钛',
          amount: 36000,
          abundance: 0.03375,
        },
        {
          name: '粗银',
          amount: 420,
          abundance: 2.25e-4,
        },
        {
          name: '粗金',
          amount: 210,
          abundance: 2.25e-6,
        },
        {
          name: '石英',
          amount: 252000,
          abundance: 1.125,
        },
        {
          name: '有机质',
          amount: 4.8e6,
          abundance: 1.5,
        },
        {
          name: '石墨',
          amount: 60000,
          abundance: 2.25,
        },
        {
          name: '粘土',
          amount: 240000,
          abundance: 3.75,
        },
        {
          name: '泥土',
          amount: 3.6e8,
          abundance: 0.75,
        },
        {
          name: '二氧化硅',
          amount: 5.4e10,
          abundance: 112.5,
        },
        {
          name: '铵',
          amount: 180000,
          abundance: 3.375,
        },
        {
          name: '软锰矿',
          amount: 30000,
          abundance: 0.0675,
        },
        {
          name: '黑钨矿',
          amount: 30000,
          abundance: 0.0675,
        },
        {
          name: '金红石',
          amount: 30000,
          abundance: 0.0675,
        },
        {
          name: '赤铁矿',
          amount: 80000,
          abundance: 0.045,
        },
      ],
      core: [
        {
          name: '石头',
          amount: 2e6,
          abundance: 375,
        },
        {
          name: '太空元素',
          amount: 950000,
          abundance: 1.5e-4,
        },
        {
          name: '粗银',
          amount: 70000,
          abundance: 0.0015,
        },
        {
          name: '粗金',
          amount: 35000,
          abundance: 1.5e-5,
        },
        {
          name: '有机质',
          amount: 2e7,
          abundance: 5,
        },
        {
          name: '石墨',
          amount: 200000,
          abundance: 7.5,
        },
        {
          name: '粘土',
          amount: 800000,
          abundance: 12.5,
        },
        {
          name: '锂',
          amount: 6000,
          abundance: 0.15,
        },
        {
          name: '钛',
          amount: 4000,
          abundance: 0.1125,
        },
        {
          name: '泥土',
          amount: 1e9,
          abundance: 2.5,
        },
        {
          name: '二氧化硅',
          amount: 2e11,
          abundance: 375,
        },
        {
          name: '铵',
          amount: 600000,
          abundance: 11.25,
        },
        {
          name: '软锰矿',
          amount: 20000,
          abundance: 0.225,
        },
      ],
    },
    gases: [
      {
        name: '氢气',
        amount: 9e10,
        abundance: 1,
      },
      {
        name: '氮气',
        amount: 8e10,
        abundance: 1,
      },
      {
        name: '氩气',
        amount: 5e10,
        abundance: 0.5,
      },
      {
        name: '氨气',
        amount: 2e8,
        abundance: 0.001,
      },
    ],
    fuels: [
      {
        name: '碳',
        amount: 8e9,
        abundance: 1,
      },
      {
        name: '标准煤',
        amount: 5e8,
        abundance: 0.3,
      },
      {
        name: '氢气',
        amount: 9e10,
        abundance: 1,
      },
      {
        name: '甲烷',
        amount: 1e9,
        abundance: 0.01,
      },
      {
        name: '铀',
        amount: 100000,
        abundance: 1e-5,
      },
      {
        name: '钚',
        amount: 600,
        abundance: 1e-8,
      },
    ],
    power: {
      totalEnergy: 1e14,
      hydro: 0.8,
      wind: 1.8,
      solar: 0.7,
    },
    initialTempC: 15,
    population: {
      total: 0,
      available: 0,
    },
    needsImmigration: true,
    happiness: 1,
    canRebel: true,
  },
  {
    id: 'novus',
    code: 'nov',
    nameCn: '诺福斯',
    nameEn: 'Novus',
    type: '奇异卫星',
    description: '稀薄雾霭卫星，气候温和',
    orbit: {
      radius: 6.5,
      phase: 3.59,
    },
    layers: {
      surface: [
        {
          name: '有机质',
          amount: 3e6,
          abundance: 1.5,
        },
        {
          name: '石头',
          amount: 7e10,
          abundance: 15,
        },
        {
          name: '石墨',
          amount: 80000,
          abundance: 0.3,
        },
        {
          name: '粘土',
          amount: 350000,
          abundance: 0.5,
        },
        {
          name: '赤铁矿',
          amount: 4000,
          abundance: 0.0015,
        },
        {
          name: '锂',
          amount: 2000,
          abundance: 0.0015,
        },
        {
          name: '泥土',
          amount: 5e8,
          abundance: 1,
        },
        {
          name: '二氧化硅',
          amount: 7e10,
          abundance: 15,
        },
        {
          name: '铵',
          amount: 200000,
          abundance: 0.45,
        },
      ],
      underground: [
        {
          name: '石头',
          amount: 2.8e11,
          abundance: 75,
        },
        {
          name: '红土',
          amount: 28000,
          abundance: 0.075,
        },
        {
          name: '赤铁矿',
          amount: 24000,
          abundance: 0.03,
        },
        {
          name: '锂',
          amount: 20000,
          abundance: 0.0225,
        },
        {
          name: '石英',
          amount: 152000,
          abundance: 0.75,
        },
        {
          name: '有机质',
          amount: 1.2e6,
          abundance: 0.75,
        },
        {
          name: '石墨',
          amount: 32000,
          abundance: 1.5,
        },
        {
          name: '粘土',
          amount: 140000,
          abundance: 2.5,
        },
        {
          name: '泥土',
          amount: 2e8,
          abundance: 0.5,
        },
        {
          name: '二氧化硅',
          amount: 2.8e10,
          abundance: 75,
        },
        {
          name: '铵',
          amount: 80000,
          abundance: 2.25,
        },
        {
          name: '黑钨矿',
          amount: 20000,
          abundance: 0.045,
        },
      ],
      deep: [
        {
          name: '石头',
          amount: 4.2e11,
          abundance: 112.5,
        },
        {
          name: '红土',
          amount: 42000,
          abundance: 0.1125,
        },
        {
          name: '赤铁矿',
          amount: 36000,
          abundance: 0.045,
        },
        {
          name: '锂',
          amount: 30000,
          abundance: 0.03375,
        },
        {
          name: '粗银',
          amount: 360,
          abundance: 2.25e-4,
        },
        {
          name: '粗金',
          amount: 180,
          abundance: 2.25e-6,
        },
        {
          name: '石英',
          amount: 228000,
          abundance: 1.125,
        },
        {
          name: '有机质',
          amount: 1.8e6,
          abundance: 1.125,
        },
        {
          name: '石墨',
          amount: 48000,
          abundance: 2.25,
        },
        {
          name: '粘土',
          amount: 210000,
          abundance: 3.75,
        },
        {
          name: '泥土',
          amount: 3e8,
          abundance: 0.75,
        },
        {
          name: '二氧化硅',
          amount: 4.2e10,
          abundance: 112.5,
        },
        {
          name: '铵',
          amount: 120000,
          abundance: 3.375,
        },
        {
          name: '黑钨矿',
          amount: 30000,
          abundance: 0.0675,
        },
      ],
      core: [
        {
          name: '石头',
          amount: 1e6,
          abundance: 375,
        },
        {
          name: '太空元素',
          amount: 850000,
          abundance: 1.5e-4,
        },
        {
          name: '粗银',
          amount: 60000,
          abundance: 0.0015,
        },
        {
          name: '粗金',
          amount: 30000,
          abundance: 1.5e-5,
        },
        {
          name: '有机质',
          amount: 6e6,
          abundance: 3.75,
        },
        {
          name: '石墨',
          amount: 160000,
          abundance: 7.5,
        },
        {
          name: '粘土',
          amount: 700000,
          abundance: 12.5,
        },
        {
          name: '赤铁矿',
          amount: 8000,
          abundance: 0.15,
        },
        {
          name: '锂',
          amount: 4000,
          abundance: 0.1125,
        },
        {
          name: '泥土',
          amount: 1e9,
          abundance: 2.5,
        },
        {
          name: '二氧化硅',
          amount: 1e11,
          abundance: 375,
        },
        {
          name: '铵',
          amount: 400000,
          abundance: 11.25,
        },
      ],
    },
    gases: [
      {
        name: '氢气',
        amount: 4e10,
        abundance: 1,
      },
      {
        name: '甲烷',
        amount: 8e10,
        abundance: 1,
      },
      {
        name: '氨气',
        amount: 2e8,
        abundance: 0.001,
      },
    ],
    fuels: [
      {
        name: '碳',
        amount: 3e9,
        abundance: 0.8,
      },
      {
        name: '标准煤',
        amount: 2e8,
        abundance: 0.2,
      },
      {
        name: '氢气',
        amount: 4e10,
        abundance: 1,
      },
      {
        name: '甲烷',
        amount: 1e11,
        abundance: 1,
      },
      {
        name: '铀',
        amount: 80000,
        abundance: 1e-5,
      },
      {
        name: '钚',
        amount: 400,
        abundance: 1e-8,
      },
    ],
    power: {
      totalEnergy: 8e13,
      hydro: 0.6,
      wind: 1.7,
      solar: 1.6,
    },
    initialTempC: 10,
    population: {
      total: 0,
      available: 0,
    },
    needsImmigration: true,
    happiness: 1,
    canRebel: true,
  },
  {
    id: 'glacio',
    code: 'gla',
    nameCn: '格拉西欧',
    nameEn: 'Glacio',
    type: '苔原行星',
    description: '极寒冰原，风蚀苔原',
    orbit: {
      radius: 8,
      phase: 4.488,
    },
    layers: {
      surface: [
        {
          name: '有机质',
          amount: 500000,
          abundance: 1,
        },
        {
          name: '石头',
          amount: 2e11,
          abundance: 15,
        },
        {
          name: '石墨',
          amount: 60000,
          abundance: 0.225,
        },
        {
          name: '粘土',
          amount: 200000,
          abundance: 0.25,
        },
        {
          name: '钛',
          amount: 5000,
          abundance: 0.0015,
        },
        {
          name: '赤铁矿',
          amount: 3000,
          abundance: 0.0015,
        },
        {
          name: '冰/水',
          amount: 5e9,
          abundance: 5,
        },
        {
          name: '泥土',
          amount: 2e8,
          abundance: 1,
        },
        {
          name: '二氧化硅',
          amount: 1e11,
          abundance: 15,
        },
        {
          name: '铵',
          amount: 100000,
          abundance: 0.3,
        },
      ],
      underground: [
        {
          name: '石头',
          amount: 4e11,
          abundance: 75,
        },
        {
          name: '红土',
          amount: 20000,
          abundance: 0.06,
        },
        {
          name: '钛',
          amount: 28000,
          abundance: 0.03,
        },
        {
          name: '赤铁矿',
          amount: 24000,
          abundance: 0.0225,
        },
        {
          name: '石英',
          amount: 200000,
          abundance: 0.75,
        },
        {
          name: '有机质',
          amount: 200000,
          abundance: 0.5,
        },
        {
          name: '石墨',
          amount: 24000,
          abundance: 1.125,
        },
        {
          name: '粘土',
          amount: 80000,
          abundance: 1.25,
        },
        {
          name: '冰/水',
          amount: 2e9,
          abundance: 2.5,
        },
        {
          name: '泥土',
          amount: 8e7,
          abundance: 0.5,
        },
        {
          name: '二氧化硅',
          amount: 4e10,
          abundance: 75,
        },
        {
          name: '铵',
          amount: 40000,
          abundance: 1.5,
        },
      ],
      deep: [
        {
          name: '石头',
          amount: 6e11,
          abundance: 112.5,
        },
        {
          name: '红土',
          amount: 30000,
          abundance: 0.09,
        },
        {
          name: '钛',
          amount: 42000,
          abundance: 0.045,
        },
        {
          name: '赤铁矿',
          amount: 36000,
          abundance: 0.03375,
        },
        {
          name: '粗银',
          amount: 300,
          abundance: 2.25e-4,
        },
        {
          name: '粗金',
          amount: 150,
          abundance: 2.25e-6,
        },
        {
          name: '石英',
          amount: 300000,
          abundance: 1.125,
        },
        {
          name: '有机质',
          amount: 300000,
          abundance: 0.75,
        },
        {
          name: '石墨',
          amount: 36000,
          abundance: 1.6875,
        },
        {
          name: '粘土',
          amount: 120000,
          abundance: 1.875,
        },
        {
          name: '冰/水',
          amount: 3e9,
          abundance: 3.75,
        },
        {
          name: '泥土',
          amount: 1.2e8,
          abundance: 0.75,
        },
        {
          name: '二氧化硅',
          amount: 6e10,
          abundance: 112.5,
        },
        {
          name: '铵',
          amount: 60000,
          abundance: 2.25,
        },
      ],
      core: [
        {
          name: '石头',
          amount: 3e6,
          abundance: 375,
        },
        {
          name: '太空元素',
          amount: 1e6,
          abundance: 1.5e-4,
        },
        {
          name: '粗银',
          amount: 50000,
          abundance: 0.0015,
        },
        {
          name: '粗金',
          amount: 25000,
          abundance: 1.5e-5,
        },
        {
          name: '有机质',
          amount: 1e6,
          abundance: 2.5,
        },
        {
          name: '石墨',
          amount: 120000,
          abundance: 5.625,
        },
        {
          name: '粘土',
          amount: 400000,
          abundance: 6.25,
        },
        {
          name: '钛',
          amount: 10000,
          abundance: 0.15,
        },
        {
          name: '赤铁矿',
          amount: 6000,
          abundance: 0.1125,
        },
        {
          name: '冰/水',
          amount: 1e10,
          abundance: 12.5,
        },
        {
          name: '泥土',
          amount: 4e8,
          abundance: 2.5,
        },
        {
          name: '二氧化硅',
          amount: 2e11,
          abundance: 375,
        },
        {
          name: '铵',
          amount: 200000,
          abundance: 7.5,
        },
      ],
    },
    gases: [
      {
        name: '氩气',
        amount: 1e11,
        abundance: 1,
      },
      {
        name: '氨气',
        amount: 1e8,
        abundance: 0.001,
      },
    ],
    fuels: [
      {
        name: '碳',
        amount: 1e9,
        abundance: 0.5,
      },
      {
        name: '氢气',
        amount: 1e9,
        abundance: 0.02,
      },
      {
        name: '甲烷',
        amount: 5e9,
        abundance: 0.05,
      },
      {
        name: '铀',
        amount: 60000,
        abundance: 1e-5,
      },
      {
        name: '钚',
        amount: 300,
        abundance: 1e-8,
      },
    ],
    power: {
      totalEnergy: 2e14,
      hydro: 1.5,
      wind: 2.2,
      solar: 0.4,
    },
    initialTempC: -60,
    population: {
      total: 0,
      available: 0,
    },
    needsImmigration: true,
    happiness: 1,
    canRebel: true,
  },
  {
    id: 'atrox',
    code: 'atr',
    nameCn: '阿特洛克斯',
    nameEn: 'Atrox',
    type: '辐射行星',
    description: '毒性废土，辐射弥漫',
    orbit: {
      radius: 9,
      phase: 5.385,
    },
    layers: {
      surface: [
        {
          name: '有机质',
          amount: 5e6,
          abundance: 1,
        },
        {
          name: '石头',
          amount: 1e11,
          abundance: 15,
        },
        {
          name: '石墨',
          amount: 100000,
          abundance: 0.3,
        },
        {
          name: '粘土',
          amount: 400000,
          abundance: 0.5,
        },
        {
          name: '硫磺',
          amount: 30000,
          abundance: 0.015,
        },
        {
          name: '铵',
          amount: 400000,
          abundance: 0.6,
        },
        {
          name: '泥土',
          amount: 3e8,
          abundance: 1,
        },
        {
          name: '二氧化硅',
          amount: 1e11,
          abundance: 15,
        },
      ],
      underground: [
        {
          name: '石头',
          amount: 4e11,
          abundance: 75,
        },
        {
          name: '红土',
          amount: 40000,
          abundance: 0.075,
        },
        {
          name: '硫磺',
          amount: 32000,
          abundance: 0.075,
        },
        {
          name: '石英',
          amount: 180000,
          abundance: 0.75,
        },
        {
          name: '有机质',
          amount: 2e6,
          abundance: 0.5,
        },
        {
          name: '石墨',
          amount: 40000,
          abundance: 1.5,
        },
        {
          name: '粘土',
          amount: 160000,
          abundance: 2.5,
        },
        {
          name: '铵',
          amount: 160000,
          abundance: 3,
        },
        {
          name: '泥土',
          amount: 1.2e8,
          abundance: 0.5,
        },
        {
          name: '二氧化硅',
          amount: 4e10,
          abundance: 75,
        },
        {
          name: '软锰矿',
          amount: 20000,
          abundance: 0.045,
        },
        {
          name: '赤铁矿',
          amount: 50000,
          abundance: 0.03,
        },
      ],
      deep: [
        {
          name: '石头',
          amount: 6e11,
          abundance: 112.5,
        },
        {
          name: '红土',
          amount: 60000,
          abundance: 0.1125,
        },
        {
          name: '硫磺',
          amount: 48000,
          abundance: 0.1125,
        },
        {
          name: '石英',
          amount: 270000,
          abundance: 1.125,
        },
        {
          name: '粗银',
          amount: 240,
          abundance: 2.25e-4,
        },
        {
          name: '粗金',
          amount: 120,
          abundance: 2.25e-6,
        },
        {
          name: '有机质',
          amount: 3e6,
          abundance: 0.75,
        },
        {
          name: '石墨',
          amount: 60000,
          abundance: 2.25,
        },
        {
          name: '粘土',
          amount: 240000,
          abundance: 3.75,
        },
        {
          name: '铵',
          amount: 240000,
          abundance: 4.5,
        },
        {
          name: '泥土',
          amount: 1.8e8,
          abundance: 0.75,
        },
        {
          name: '二氧化硅',
          amount: 6e10,
          abundance: 112.5,
        },
        {
          name: '软锰矿',
          amount: 30000,
          abundance: 0.0675,
        },
        {
          name: '赤铁矿',
          amount: 80000,
          abundance: 0.045,
        },
      ],
      core: [
        {
          name: '石头',
          amount: 2e6,
          abundance: 375,
        },
        {
          name: '太空元素',
          amount: 1e6,
          abundance: 1.5e-4,
        },
        {
          name: '粗银',
          amount: 40000,
          abundance: 0.0015,
        },
        {
          name: '粗金',
          amount: 20000,
          abundance: 1.5e-5,
        },
        {
          name: '有机质',
          amount: 1e7,
          abundance: 2.5,
        },
        {
          name: '石墨',
          amount: 200000,
          abundance: 7.5,
        },
        {
          name: '粘土',
          amount: 800000,
          abundance: 12.5,
        },
        {
          name: '硫磺',
          amount: 60000,
          abundance: 0.375,
        },
        {
          name: '铵',
          amount: 800000,
          abundance: 15,
        },
        {
          name: '泥土',
          amount: 6e8,
          abundance: 2.5,
        },
        {
          name: '二氧化硅',
          amount: 2e11,
          abundance: 375,
        },
      ],
    },
    gases: [
      {
        name: '氦气',
        amount: 3e10,
        abundance: 0.5,
      },
      {
        name: '甲烷',
        amount: 1e11,
        abundance: 1,
      },
      {
        name: '氮气',
        amount: 5e10,
        abundance: 1,
      },
      {
        name: '硫磺气',
        amount: 8e10,
        abundance: 1,
      },
      {
        name: '氨气',
        amount: 1e8,
        abundance: 0.001,
      },
    ],
    fuels: [
      {
        name: '碳',
        amount: 5e9,
        abundance: 0.6,
      },
      {
        name: '氢气',
        amount: 1e9,
        abundance: 0.02,
      },
      {
        name: '甲烷',
        amount: 5e10,
        abundance: 0.5,
      },
      {
        name: '铀',
        amount: 5e6,
        abundance: 1e-4,
      },
      {
        name: '钚',
        amount: 10000,
        abundance: 1e-6,
      },
    ],
    power: {
      totalEnergy: 1e14,
      hydro: 0.4,
      wind: 0.5,
      solar: 0.6,
    },
    initialTempC: 50,
    population: {
      total: 0,
      available: 0,
    },
    needsImmigration: true,
    happiness: 1,
    canRebel: true,
  },
];

# v0.0.6 施工图与接口契约

> 本文件是 v0.0.6 的**唯一协调基准**。并行的子代理必须严格按下面冻结的接口写代码，
> 不得擅自改名、改签名、改字段。任何接口要变，先改本文件再动手。
>
> 目标版本：`v0.0.6` / `VERSION_NUM = 60`

---

## 0. 项目铁律（违反会导致返工）

- 零构建原生 HTML/CSS/JS + ES modules。**禁止** npm 依赖、禁止 CDN、禁止任何打包工具。
- 三层分离：`js/data/*` 只放纯数据；`js/core/*` 放算法与状态；`js/ui/*` 只渲染。
- 数字/时间格式化一律走 `js/core/format.js` 的 `fmtNum` / `fmtRate` / `fmtTime` / `fmtSci`。
- 版本号唯一来源 `js/version.js`。**任何 UI 文件不得硬编码版本号字符串。**
- 改代码用 Edit 工具，**不要用 python 批量 replace**（本机已三次出现「打印 ok 但没落盘」）。
- 深空主题：深色底 + 冷色高亮。移动端点击区 ≥ 44px。
- 每个模块自己把 `<style>` 用 `document.createElement('style')` 内联注入，不去改共用的 css/。

### 建材可获得性铁律（防开局死锁）
一座建筑/设施只能用「解锁它的科技层级或更低」的材料。

| 层级 | 首次可获得 |
|---|---|
| T0 | 有机质、泥土、石头、水（开局露天采集，无需科技） |
| T1 | A1 深度采集：粘土、二氧化硅、石墨、孔雀石、石英、红土、硫磺 ／ B1 熔炉：木头、碳 |
| T2 | B2 高炉：铁、铜、锌、铝、玻璃、陶瓷、钢 |
| T4 | B3 电解池 / D1 化学实验室：钛、银、金、钨、锰、锂、铀、铱、钚、橡胶、塑料、铝合金、碳化钨、钛合金 |
| T6 | D3 自定义化工厂：石墨烯 |

科研所 / 建筑工厂 / 房屋 / 人力发电厂必须能用 **T0 材料**直接建造。

---

## 1. 冻结的接口契约

### 1.1 `js/core/power.js`（新建）

```js
// 星球能量池：惰性初始化自 planet.power.totalEnergy
// inst.energy = { total: number, max: number }
export function energyOf(inst)                       // → { total, max }（不存在则建）

// 设施槽与已装设施
// inst.facilities    = { [facilityId]: 已装座数 }
// inst.facilityStock = { [facilityId]: 已造好但未安装的座数 }
export function facilitySlots(inst)                  // → 储电站提供的槽位总数
export function usedSlots(inst)                      // → 已占槽位
export function freeSlotsPower(inst)                 // → 空闲槽位
export function installedFacilities(inst)            // → { facilityId: count }
export function facilityStockOf(inst)                // → inst.facilityStock（惰性初始化 {}）
export function installFacility(inst, facilityId, acc)  // → { ok, reason? }
export function uninstallFacility(inst, facilityId)     // → boolean（退回库存）
```

**两段式模型（设计者原话：「可在建造车间生产，可放置在飞船上或星球上，每个都有各自的造价，工作量」）**：

1. **生产**：建造车间（`fabricator`）选中一个带 `producesFacility` 的配方，
   完成一次就给 `inst.facilityStock[该设施 id] += 1`（允许小数，代表半成品进度）。
   **造价与工作量在这里付。**
2. **放置**：`installFacility` 只校验「有空闲槽 + 库存 ≥ 1」，从 `facilityStock` 扣 1、
   给 `facilities` 加 1，**不再收材料费**。
   `uninstallFacility` 把 1 座退回 `facilityStock`。

> 之所以要分开：如果安装时再收一次材料，等于玩家为同一件东西付两遍钱；
> 而且「在建造车间生产」这句话就完全落空了。

// 电力结算（每 tick 调一次）
// 返回 { gen, draw, ratio, storage, storageMax, storageRate, cleanDraw }
//   gen        总发电/秒（人力发电厂 + 设施发电）
//   draw       总耗电/秒（所有已投产建筑）
//   ratio      = clamp(gen / draw, 0, 1)；draw=0 时恒为 1
//   storage    当前储电量
//   storageMax 储电上限（电池提供）
//   storageRate 净充放电速率（正=在充，负=在放）
// 【缺电策略】按缺电比例全体降速：所有耗电建筑的有效产出 × ratio
export function computePower(inst, acc)              // → 上表

// 推进能量：太阳辐射回充 + 清洁能源从星球能量池扣减
export function tickPower(inst, dt)                  // → void
```

**储电模型**：`gen > draw` 时，盈余先充进 `storage`（上限 `storageMax`），充满则溢出浪费；
`gen < draw` 时，先用 `ratio` 降速，若仍有缺口则由 `storage` 放电补齐，
`storage` 见底后 `ratio` 再按 `(gen) / (draw)` 走。**储能单位是「能量」**，
与星球能量池同量纲（1:1）。设施槽里没电池时 `storageMax = 0`。

**清洁能源扣减**：太阳能板 / 风力发电机 的发电量从 `inst.energy.total` 扣除
（它们是「提取星球储存的能量」，而 `energy.total` 会因太阳辐射缓慢回充）。
人力发电厂、火力发电机**不扣**星球能量池（前者靠人力，后者烧燃料）。

**太阳辐射回充速率**：`+ (planet.power.solar || 0) × 1e9 / 秒`，上限 `inst.energy.max`。

### 1.2 `js/data/facilities.js`（新建）—— 电力设施 12 项

导出 `export const POWER_FACILITIES = [...]` 与 `export const POWER_FACILITY_BY_ID = {...}`。

字段：
```js
{
  id: 'battery_s',            // battery_* | solar_* | wind_* | thermal_*
  nameCn: '小型电池',
  kind: 'storage' | 'solar' | 'wind' | 'thermal',
  size: 's' | 'm' | 'l',
  sizeLabel: '小型' | '大型' | '超大型',
  baseCost: { '铁': 100, ... },   // 遵守建材铁律
  work: 600,                       // 建造车间生产一次的工作量（人·秒）
  capacity: 5e6,                   // storage：储电上限；其它 0
  powerOut: 50,                    // solar/wind/thermal：每座每秒发电（基准值，再乘星球系数）
  desc: '...',
}
```

尺寸倍率建议：`s=1, m=8, l=64`，造价与 work 同比（略超线性）。
- `battery_*`：T1 可造（粘土/石墨/铜？——注意铜是 T2，小型电池得用 T0/T1 材料，遵循铁律）
- `solar_*`、`wind_*`：T2~T4
- `thermal_*`：T3~T5

**关键**：`kind:'storage'` 的设施只提供 `capacity`，不发电；另三类只发电、不储电。

### 1.3 `js/data/recipes.js`（新建）—— 配方表

```js
export const RECIPES = [
  {
    id: 'r_furnace_wood',
    buildingId: 'furnace',        // 属于哪座建筑的「工作内容」
    nameCn: '有机质 → 木头',
    inputs:  { '有机质': 2 },      // 每完成一次配方消耗
    outputs: { '木头': 1 },        // 每完成一次配方产出
    work: 100,                    // 完成一次配方的「人·秒」
    desc: '...',
    byproductNote: '',            // 可选的副产物说明（只用于展示）
  },
  ...
];
export const RECIPE_BY_ID = Object.fromEntries(RECIPES.map(r => [r.id, r]));
export function recipesOfBuilding(buildingId)   // → RECIPES.filter(...)
export function getRecipe(id)                   // → RECIPE_BY_ID[id] || null
```

必须覆盖的建筑（`buildingId` 用 `js/data/buildings.js` 里的 id）：
`furnace`(熔炉)、`blast_furnace`(高炉)、`electrolyzer`(电解池)、`chem_lab`(化学实验室)、
`refinery`(精细加工厂)、`custom_chem`(自定义化工厂)、`farm`(农田)、`bio_factory`(生物工厂)、
`fabricator`(制造车间)。

每个建筑 **2~5 个配方**。配方里的输入输出**必须**是 `js/data/materials.js` 的 `nameCn`
或 `js/data/planets.js` 里出现过的资源名。原料链要自洽（不要出现「用石墨烯造第一台熔炉」这种倒挂）。

### 1.4 `js/core/production.js`（新建）

```js
// 玩家为每座加工建筑选定的「工作内容」：inst.recipes = { [buildingId]: recipeId }
export function selectedRecipeOf(inst, buildingId)     // → recipe 对象或 null
export function selectRecipe(inst, buildingId, recipeId)  // → boolean
export function clearRecipe(inst, buildingId)          // → boolean

// 取/建物品栏条目（配方产物可能不在星球原始资源里，如「木头」「铁」）
// 新建条目结构必须与 state.js 保持一致：
//   { mat, layer:'refined', owned, rate, reserve, remaining, abundance:1, locked:false }
export function ensureEntry(inst, matName, layer)

// 推进生产 dt 秒。powerRatio 由 power.js 的 computePower 给出（缺电全局降速）；
// 未选工作内容的建筑不运转（不耗电也不产出）。
export function tickProduction(inst, dt, powerRatio)   // → void

// 展示用：某建筑当前的产出速率 { [matName]: 个数/秒 }（已乘 powerRatio）
export function productionRates(inst, powerRatio)      // → { [buildingId]: {rate, recipe, active} }
```

**产出模型（唯一口径）**：
```
有效人力 = 该建筑下所有职业的 (人数 × 强度产出倍率) 之和
产出速率 = 有效人力 × powerRatio / recipe.work        // 单位：次/秒
每次产出 = recipe.outputs 各项 × 产出速率
每次消耗 = recipe.inputs  各项 × 产出速率（不足则按最紧缺的那项等比缩减）
```

材料不足时**按比例缩减**（和 `tickPopulation` 里营养的 `ratio` 口径一致），不要整体停摆。

### 1.5 `js/core/power.js` 与 `js/core/state.js` 的交界

`state.js` 的 `tick(dt)` 调用顺序（**已冻结**）：

```
const acc = currentAccount();
for (const inst of STATE.planets) {
  tickPower(inst, dt);                              // 1. 能量回充/扣减/储能结算
  const pw = computePower(inst, acc);               // 2. 电力结算，拿 ratio
  inst.powerInfo = pw;                              // 3. 挂到实例上给 UI 读
  advanceProduction(inst, dt, pw.ratio);            // 4. 采集（也吃电力降速）
  tickProduction(inst, dt, pw.ratio);               // 5. 加工生产（配方）
  advancePopulation(inst, dt);                      // 6. 人口与代谢
  advanceConstruction(inst, dt, pw.ratio);          // 7. 施工
  advanceResearch(inst, dt, pw.ratio);              // 8. 科研
}
```

> ⚠️ **字段命名铁律**：`inst.power` 是**星球静态数据**（`{ totalEnergy, hydro, wind, solar }`，
> 由 `js/data/planets.js` 经 `getPlanetInstance` 展开而来），**绝对不要覆写它**。
> 电力结算结果一律放在 **`inst.powerInfo`**；能量池一律放在 **`inst.energy`**
> （`{ total, max, stored }`）。UI 读 `inst.powerInfo`，读静态系数读 `inst.power`。

---

## 2. v0.0.6 需求清单与归属

| # | 需求 | 归属 | 主要文件 |
|---|---|---|---|
| R1 | 能量写进星球储量，清洁能源从里面扣，太阳辐射缓慢回充 | 核心 | `js/core/power.js`（新）+ `js/core/state.js` |
| R2 | 开局物资不要那么多 | 核心 | `js/core/state.js` `STARTING_ITEMS` |
| R3 | 未解锁 A1 也能挖地表所有资源 | 核心 | `js/core/state.js` + `js/data/techs.js` |
| R4 | 科技分支下的舰船设施全部移到「设施」分支 | 科研 | `js/ui/research.js` + `js/data/techs.js` |
| R5 | 研究点实时变化；研究效率改为 1/20（花费**不动**） | 科研 + 核心 | `js/ui/research.js` + `js/core/state.js` |
| R6 | 单存档无法删除 | 核心 | `js/ui/start.js` `handleOffline` |
| R7 | 人力发电厂开局解锁 | 核心 | `js/data/buildings.js` + `js/data/techs.js` |
| R8 | 没电时耗电工厂按比例降速 | 电力 | `js/core/power.js` |
| R9 | 物品栏加净产电与储电量 | 核心 | `js/ui/inventory.js` |
| R10 | 储电站建筑 + 12 项电力设施 | 电力 | `js/core/power.js` + `js/data/facilities.js` + `js/ui/power.js` + `js/data/buildings.js` |
| R11 | 呼吸气体排到大气 | 核心 | `js/core/state.js` + `js/core/population.js` |
| R12 | 工作强度对效率的提升略大于对消耗的提升 | 核心 | `js/core/population.js` |
| R13 | 建船坞后加「星球选择」管理殖民地 | 殖民地 | `js/ui/colony.js`（新）+ `js/ui/planet.js` |
| R14 | 工作时消耗略加大 | 核心 | `js/core/population.js` |
| R15 | 开局总人数调成 100 | 核心 | `js/data/planets.js` |
| R16 | 加工/建造类先选工作内容再开工 | 生产 | `js/data/recipes.js` + `js/core/production.js` + `js/ui/buildings.js` |

---

## 4. 追加需求（v0.0.6 收尾批）

设计者原话：
> 「你自行把所有复合资源的配方表设定一下吧，每个复合资源大概耗 8-16 个基础资源，
>  有的需要气体，因而提高高级复合材料的数值。自定义化工厂可以新建一种材料，
>  用自选的任意数目的原料，任意比例合成一种新材料，你根据比例和材料推算新材料数值，
>  精细加工厂可以选择任一种固体材料进行二合一，完成后直接发布 0.0.6」

### 4.1 复合资源配方表（10 项，每项 8~16 单位原料）

`js/data/materials.js` 里 `category === 'composite'` 的 10 项：
橡胶、塑料、铝合金、碳化钨、石墨烯、钻石、炸药粉、钢、钛合金、纳米碳合金。

规则：
- **每项配方的原料总量（各原料数量之和）必须落在 8~16 之间**。
- **「高级」复合材料必须用到气体**（氮气/氢气/甲烷/氧气/二氧化碳任一），
  这是它的难度门槛；相应地**提升它的数值**（强度/耐久）。
- 原料只能用 `js/data/materials.js` 或 `js/data/planets.js` 里真实存在的 `nameCn`。

### 4.2 自定义化工厂：新建材料

玩家自选任意数目原料、任意比例，合成一种**新材料**；数值由比例与原料推算。

**数据落点**：`inst.customMaterials = { [key]: { material, recipe } }`
- `material`：一个与 `js/data/materials.js` 同形状的对象
  （`id, nameCn, nameEn, category:'composite', strength, durability, density, fineness, molarHeatCapacity, meltingPointK, special, description, derivedFrom`）
- `recipe`：`{ id:'r_custom_' + key, buildingId:'custom_chem', nameCn, inputs, outputs, work, desc, custom:true }`

**推导公式（冻结，production.js 与 UI 必须用同一份）**：
```
frac_i = amt_i / Σamt          （Σfrac = 1）
n      = 原料种数
协同加成 S = 1 + 0.06 × (n − 1)         // 2 种 +6%，5 种 +24%
strength          = Σ(frac_i × strength_i)          × S
durability        = Σ(frac_i × durability_i)        × S
density           = Σ(frac_i × density_i)             // 不加成（体积直觉）
meltingPointK     = Σ(frac_i × meltingPointK_i)       // 折中，不加成
molarHeatCapacity = Σ(frac_i × molarHeatCapacity_i)
fineness          = 1 + floor(n / 3)                  // 3 种 +1，6 种 +2
```
所有结果取整（`strength`/`durability` 保留 2 位小数，`density` 2 位小数，
`meltingPointK`/`molarHeatCapacity` 取整）。

### 4.3 精细加工厂：任选固体材料二合一

`js/core/production.js` 的 `refinePair(matName)` 已存在（`id = 'refine_' + name`）。
现在要把它接成「玩家可对**任意固体材料**选一次二合一」。

**「固体材料」判定（冻结）**：`js/data/materials.js` 里 `category` 为
`natural` 或 `refined` 或 `composite`，且**不是气体**。气体名单（不算固体）：
`氮气、氧气、氨气、甲烷、二氧化碳、氢气`。

### 4.4 `js/core/production.js` 的动态配方解析（冻结接口）

```js
// 统一解析：内置配方 → 精炼配方（refine_*）→ 自定义配方（r_custom_*）
export function resolveRecipe(inst, recipeId)   // → recipe 对象或 null

// 纯函数：按 4.2 的冻结公式算数值。parts = [{ mat, amt }]
export function derivedStatsOf(parts)           // → { strength, durability, density, fineness, molarHeatCapacity, meltingPointK }

// 玩家可精炼的固体材料（owned >= 2 且是固体）
export function listRefinableMaterials(inst)    // → [{ mat, owned, stats }]

// 新建自定义材料。成功返回 { ok:true, material, recipe }；失败 { ok:false, reason:'中文' }
// parts = [{ mat, amt }]，至少要 2 种原料、每种 amt >= 1、
// 名字非空且不与现有材料/已有自定义材料重名、材料必须真实存在且玩家持有足够原料
export function makeCustomMaterial(inst, name, parts)

// 删除一个自定义材料（同时清掉指向它的 recipes 记录）
export function removeCustomMaterial(inst, key)  // → boolean
```

**`selectRecipe` / `tickProduction` / `productionRates` 一律改用 `resolveRecipe`**，
否则动态配方（`refine_*` / `r_custom_*`）会被现有的
`RECIPE_BY_ID[recipeId]` 校验直接拒掉。

---

## 5. 验收标准（v0.0.6 收尾批补充）

- 10 项复合资源**每项**都有配方，且原料总量 ∈ [8,16]
- 石墨烯 / 钻石 / 碳化钨 / 钛合金 / 纳米碳合金 的配方**含气体**
- 自定义材料：`makeCustomMaterial` 成功后，`selectRecipe` 能选中它并真的产出；
  推导数值与手算一致（自检里按公式复算一遍）
- 精细加工厂：对**任意**固体材料都能选中 `refine_<材料>` 并产出
- 三份自检全绿 + `docs/selfcheck_v006.mjs` 全绿

---

## 3. v0.0.6 基础验收标准

- `node docs/selfcheck_v005.mjs` → 0 失败
- `node docs/selfcheck_materials.mjs` → 自检通过
- `node docs/selfcheck_render.mjs` → 运行时异常 0
- 新增章节：电力结算、配方生产、能量池、工作强度、大气排放
- 发布：`workbuddy_sites_deploy`，目录 `C:\Users\11603\WorkBuddy\2026-09-16-20-56-32`，
  `updateExistingApp: true`

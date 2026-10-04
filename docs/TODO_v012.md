# TODO v0.1.2（施工契约；并行前已冻结，改契约必须先改本文）

版本：CACHE_TAG 仍是 **11.0**（发版前由 Lead 统一 bump 到 12.0）。
**所有 js/ 内部新增导入必须手写 `?v=11.0`**（照抄相邻行），**禁止**不带串或写别的串
（不同串 = 两份模块实例 → STATE 双份 → currentAccount() 恒 null）。
docs/ 下的探针同理：导入一律带 `?v=11.0`。

已拍板数值（用户确认）：
- 生产建筑效率 / 采集工效率：**×5**
- 农田工产有机质：**×5**
- 探索：**时长 ×5**，且**按距离扣燃料**
- 科研升级：**价格不变**，**效果**由等差改为**乘方**（底数 1.6）

---

## 文件归属（严禁越界，越界即丢盘）

| 工作组 | 独占文件 |
|---|---|
| Lead（主代理） | `js/core/state.js`、`js/main.js`、`js/version.js`、`docs/bump_imports.mjs`、自检、发布 |
| W-INV | `js/ui/inventory.js` |
| W-RECIPE | `js/data/recipes.js`、`js/data/materials.js` |
| W-PROD | `js/core/production.js`、`js/ui/population.js` |
| W-PLANET | `js/ui/colony.js`、`js/core/planetgen.js` |
| W-FLEET | `js/core/fleet.js`、`js/ui/fleet.js` |
| W-SHOP | `js/core/npc.js`、`js/core/shop.js` |
| W-RESEARCH | `js/data/upgrades.js`、`js/ui/research.js` |
| W-DESIGN | `js/ui/shipyard.js`、`js/ui/design.js`、`js/ui/planet.js` |

---

## 一、R1 物品栏资源简介打不开（W-INV）

根因已定位：`js/ui/inventory.js:27-32` 的 import 段**没有导入** `buildMaterialFlow()`（:397-439）
里用到的 6 个符号，点资源行 → `openDetail()` 走到构建简介时抛 ReferenceError，
抛在 `openModal()`(:550) 之前，所以表现为「点了没反应」。

缺少的导入（都在 `js/core/` 下，路径照抄同文件既有导入风格）：
- `productionRates` ← `js/core/production.js:930`
- `BUILDING_BY_ID` ← `js/data/buildings.js:423`
- `NUTRIENT_NAMES`、`METABOLITE_NAMES`、`consumptionPerSec`、`metabolitePerSec` ← `js/core/population.js`（:59 / :61 / :445 / :454）

要求：
1. 补齐 import（带 `?v=11.0`）；
2. `openDetail()` 用 try/catch 包住简介构建，失败时退化成「暂无来源/消耗明细」，**不允许再出现点了没反应**；
3. 自检：写一个 docs/_probe_inv.mjs（导入串 `?v=11.0`），走 render 桩或直接调 buildMaterialFlow 的等价路径，
   验证 6 个符号都能取到、openDetail 不抛异常。至少覆盖 3 种资源（气体 / 复合资源 / 天然矿）。

---

## 二、R2 呼吸耗氧不计入净增长（Lead）

`js/core/state.js:904-936 computeNetRates()`，:928-933 把氧气算进净增长负值。
呼吸扣氧走 `consumeGas`（state.js:723 → 262/272），扣的是**星球气体层**（remaining + atmosphere），
不碰物品栏，所以净增长里那一份是「凭空多出来的负项」。
改法：在 :930 处把氧气从净增长负值里剔除（只保留玩家/生产真实消耗的那部分）。

## 三、R3 离开时间每档独立推进（Lead）

现状：`acc.stats.lastSeen` 每档各自存（键 `astrix.save.<id>`），
但 `js/core/state.js:149` 只刷新**当前档**的时间戳，且 `js/main.js:82` 把**各档秒数求和**显示。
改法：
1. state.js：切档/存档时把**每个** acc 的 lastSeen 都刷一遍（而不是只刷当前档）；
2. main.js:82：面板显示**本档**的离开时长，不再求和；
3. 离线结算本身就按 acc 独立跑，确认没有被全局单例污染。

## 四、R4 舰船设计图从「舰船」挪到「设计」（W-DESIGN）

- 蓝图编辑器 `buildBlueprintEditor` 定义在 `js/ui/shipyard.js:435`，被挂在 `:399-404`（舰船分支）。
- 「设计」是**舰队下的子分支**：`js/ui/planet.js:259-260` 定义、`:272-283` 分发，`design` → `renderDesign`（`js/ui/design.js:96`）。
改法：把蓝图编辑器整块（:397-404 那一节）从 shipyard.js 的舰船分支迁到 design 分支
（`planet.js:277-279` 调 `renderDesign` 处），保证：
1. 「设计」页能看到并编辑蓝图、能点「建造」开 dock 线；
2. 「舰船/舰队」页**不再**出现蓝图编辑器，只保留舰船列表、造船线、编队；
3. 两边都要能正确读到 `acc.blueprint`（先 `ensureBlueprints(account)`，见 v0.1.1 的 id 铁律）。

## 五、R5/R7/R8 星球选择（W-PLANET，全部在 `js/ui/colony.js`）

### R5 只有同化 + 母星能进入
`colony.js:330-347` 的进入按钮：现在 `instanceOf`(colony.js:94) 命中就给「进入」。
改为门槛 `inst.isHome || modeOf(inst).id === 'territory'`（同化标志见 `planetgen.js:115`），
其余星球**只渲染概况**（名字/类型/资源摘要/发现状态），不给进入按钮（或给 disabled + 提示「未同化，仅可查看概况」）。

### R7 每个星球选管理方式
五种模式（`js/core/planetgen.js:24-46`）：free 自由 / cooperative 合作 / colonial 殖民 /
territory 领土（需同化，locked）/ exploitative 剥削。设置函数 `setManagement`（:65-77）。
现在唯一可设处是 `js/ui/fleet.js:568-584`（**不要动，那是 W-FLEET 的文件**）。
改法：在 `colony.js` 的 `buildRow`(:255-357) 给每个已殖民星球加一个 `<select>`，
选项 = 五种模式（territory 在未同化时 disabled），change 时调 `setManagement` 并重绘。

### R8 探索到的星球给初始人力，从母星扣
殖民确认弹窗 `buildConfirmBody`(:201-231) → `getPlanetInstance`(:222)。
在确认弹窗里加一个下拉：**调派人力 [0 / 10 / 25 / 50]**，确定后：
- 从**母星**实例扣掉这么多可用人力（走现有 `assignWorkers` / pop 接口，别硬改字段）；
- 在新星球实例上加上这么多人口/可用人力。
- 母星可用人力不足时该选项置灰并提示。

## 六、R6 探索时长 ×5 + 按距离扣燃料（W-FLEET，`js/core/fleet.js`）

现状：`:268-291`，`MISSION_DISTANCE.explore = 60000`，`duration = dist / 编队速度`，
clamp 30~1800 秒（:270-271）；**完全没有燃料消耗**（mission 只推进 elapsed :560）。
燃料存在**单船** `ship.state.fuelMol`（`core/shipyard.js:566`，扣减 :611-612 / :634），
**编队级没有燃料字段**。扣料函数 `spendOwned`（`fleet.js:188` 已在用）。

改法：
1. `:269` explore 距离 60000 → **300000**（×5）；clamp 上限 1800s → **9000s**，下限 30s → **150s**；
2. 新增导出常量 `EXPLORE_FUEL_PER_DIST`（发在 `js/core/fleet.js` 顶部），
   `startMission`(:310) 出发前按 `dist × EXPLORE_FUEL_PER_DIST` **预扣**编队各船燃料；
3. 系数自校准：先读一箱燃料大概多少 mol（shipyard.js 容量侧），
   让**单次探索消耗 ≈ 一箱燃料的 20%~50%**，把最终值写进常量注释；
4. 燃料不足时 `startMission` 返回失败原因「燃料不足（需要 X，编队仅有 Y）」，
   UI（`ui/fleet.js`，同一工作组）要显示这条原因。

## 七、R9 交易池（W-SHOP：core；W-FLEET：ui/fleet.js）

### W-SHOP（`js/core/npc.js` + `js/core/shop.js`）
- NPC 挂单 `npc.js:133-152`：每 12/25 秒一条、qty 5~45、只取自 `NPC_MATS_*`(:80-88)（**纯材料，无装备**）。
  改：**大幅提高挂单频率与同时在池条数**（listEvery 缩短、池上限提高，具体值你定并在注释写明前后对比），
  并给 `NPC_MATS_*` 补**装备类**商品（外壳/引擎/武器/设施部件，走 `__equipment` 键，与 v0.1.1 贡品契约同口径）。
- `shop.js:64 TRADABLES = MATERIALS.nameCn`，`buy`(:145) / `sell`(:169) 被它卡死 → 装备进不来。
  改：TRADABLES 扩展支持装备类（保持 buy/sell 的既有签名与返回结构不变，**别改调用方**）。
- 成交刷新 `shop.js:384 tickListings`（每秒 p = clamp(0.35 × 建议/挂牌)）保持不变。

### W-FLEET（`js/ui/fleet.js`）
删除 `:171-178` 的**直接购买**入口（它绕过挂单即时下单、未入库）。
购买一律走挂单 `buyListing`（`shop.js:334`，UI 在 `ui/fleet.js:263-274`）。
UI 上「买」按钮若现在直连 `shop.buy`，改为打开交易池列表选择。

## 八、R12 运输改成从物品栏选择（W-FLEET，`js/ui/fleet.js:612-620`）

现在是三个 `window.prompt`（目的地 :614 / **物资名 :616** / 数量 :618）。
改：物资名改成一个 `<select>`，数据源 = 当前星球 `inst.inventory` 里**持有 > 0** 的条目
（现成可复用的写法见 `ui/fleet.js:308-328` 的 `matSel`，遍历 `inst.inventory`）。
目的地与数量保留输入（数量加数字校验）。**不要**再出现 prompt 输物资名。

## 九、R10/R11/R15/R16 生产（W-PROD，`js/core/production.js` + `js/ui/population.js`）

### R10 农田工产率 ×5
`production.js:784-816`，配方 `recipes.js:346-356`（CO₂4 + 水2 → 有机质48，work=960），
标准档每人 0.05 有机质/秒。改：**work 960 → 192**（= 产率 ×5）。改 `recipes.js` 归 W-RECIPE，
所以由 W-PROD 把「960 → 192」这个数值写进契约，W-RECIPE 执行；
若你选择在 production.js 侧乘系数，**不要**两边都改（会变 ×25）。

### R11 只要原料有库存就最高效率生产
现状 `production.js:841-848`：`ratio = min over inputs of clamp01(have / (need × rate × dt))`
（农田同款 :796-804），缓存在 `:852 line._ratio`。
问题：have 只有一点点时 ratio 被压到接近 0，几乎不生产。
改为**整数批次口径**：
1. 对每个输入算 `batch = floor(have / need)`；
2. 任一输入 `batch === 0` → 本 tick 该线 `ratio = 0`（停）；
3. 否则 `ratio = 1`（满速），**实际扣料用 spendOwned 的返回值**（能扣多少扣多少），
   产出按「实际扣到的最小比例」计算 —— 绝不超扣、绝不凭空产出；
4. `line._ratio` 继续写，UI 读它展示降速原因的地方要能表达「原料耗尽」而不是小数比例。
5. 自检：have 恰好够 1 批次时 ratio 应为 1；have = 0 时 ratio 应为 0；库存充足时与旧口径一致。

### R15 精细加工厂从物品栏选材料
- 建筑 id `refinery`（`data/buildings.js:347-348`），配方 `buildingId:'refinery'`（`data/recipes.js:236-285`）。
- 选材料现在是**配方下拉**：`production.js:708-713` 对每种持有 ≥1 的固体材料生成 `refine_<材料>`（`refinePair` :979-989）。
- UI 第三步 `mSel`（`ui/population.js:390`）只在 `rec.materials` 存在时出现，而 `refine_*` 没有该字段。
改：给 `refinePair`(:979-989) 补 `materials`（候选材料列表）与 `choiceKind:'inventory'`，
让 `population.js:390` 的第三步下拉出现，候选来自 **inst.inventory 持有 > 0 的材料**，
并把选中的材料写进线的 `material` 字段（走现有 `addLine` 的 `opts.material`）。

### R16 生产线效率 ×5
`production.js` 侧：产线产出速率统一 ×5（新增导出常量 `V012_LINE_RATE_MUL = 5`，
乘在一处，不要散落多处）。
**农田除外**（R10 已经单独 ×5，别叠成 ×25）。
采集工那一半由 Lead 改 `state.js:223 BASE_COLLECT_RATE 0.1 → 0.5`，你不用管。

## 十、R13/R14/R17 配方（W-RECIPE，`js/data/recipes.js`）

### R13 去掉硫磺
硫磺（id `sulfur`，`materials.js:908-921`）**没有任何配方产出**，只作天然矿藏。
两处消耗（都在 chem_lab）：
- `:207 r_chem_rubber` 碳6 + 氢气4 + 硫磺2 → 橡胶1  ⇒ 改为 **碳8 + 氢气6 → 橡胶1**
- `:227 r_chem_explosive` 碳4 + 硫磺4 + 氮气4 → 炸药粉1 ⇒ 改为 **碳6 + 氮气8 → 炸药粉1**
硫磺本身保留（仍可采集），只是不再被配方消耗。

### R14 化学实验室补齐复合资源
chem_lab 现在只能产 5 个：钢(:71)、塑料(:197)、橡胶(:207)、铝合金(:217)、炸药粉(:227)。
复合资源共 10 个，**这 5 个没有 chem_lab 配方**（全挂在 `custom_chem` :291/301/311/321/331）：
**碳化钨 / 石墨烯 / 钻石 / 钛合金 / 纳米碳合金**。
改：为这 5 个各补一条 `buildingId:'chem_lab'` 的配方
（输入用现有基础资源，读 `materials.js` 里它们的 `refinedFrom`/成分来定，别凭空造资源），
原 `custom_chem` 配方**保留不动**（避免破坏已有存档）。

### R17 二氧化硅 → 玻璃
新增配方 `r_chem_silica_glass`：**二氧化硅 32 + 碳 1 → 玻璃 1**，`buildingId:'furnace'`
（与现有 `r_chem_glass`(:81-89，石英1+碳1→玻璃1) 同建筑），work 照抄 `r_chem_glass`。
注意：现有 `r_chem_glass` 名字带 chem 但实为炉类，**别把它误判成化学实验室**。
二氧化硅现在没有任何配方消耗它，加完之后就有了。

### R10 农田（W-RECIPE 执行）
`recipes.js:346-356` 农田配方 **work 960 → 192**（产率 ×5，对应 R10）。

## 十一、R18 科研升级效果改乘方（W-RESEARCH，`js/data/upgrades.js` + `js/ui/research.js`）

现状：价格**已经是几何级** `baseCost × growth^level`（growth 1.3~1.8，`upgrades.js:23-25`），
core 侧 `state.js:810`，UI 侧 `research.js:246/462/471`。
用户拍板：**价格不动，改「效果」为乘方**（现在是等差 +x/级）。

改法：
1. 给每项升级加 `effectPow`（底数，默认 **1.6**）；
2. 效果_n = 首级效果 × 底数^(n-1)（n 从 1 开始）；
3. 从 `js/data/upgrades.js` **导出** `upgradeMul(acc, key)`，返回该项当前的乘算系数
   （未购买返回 1，UI 与 core 都调它，避免两处各写一套公式）；
4. **不要改** `js/core/state.js`、`js/core/production.js`、`js/core/power.js` ——
   Lead 会在汇聚层统一接线；
5. `js/ui/research.js` 的升级卡要显示「当前 +X% / 下一级 +Y%」（用 `upgradeMul` 算，别手写公式）。

## 十二、R19 完成上版未完成项

1. **6 项升级买了没接线**（`upg_collect / refine / power / labor / research / build`）：
   W-RESEARCH 负责把 `upgradeMul` 导出齐，Lead 在 state.js 接线。
2. **造船扣材料**（`docs/DECISIONS.md:177` 待定）：蓝图建造时除装备外还要按部件扣**材料**。
   这块归 W-DESIGN（它独占 shipyard.js），扣料走 `spendOwned`，
   材料不足时给出明确提示「缺少 XX×N」，**不允许**扣一半还下水。
3. 其余 DECISIONS.md 待定项（在线云服务、军队/战争规则、居住容量上限、研究点节奏等）
   本版**不动**，继续留在 DECISIONS.md。

---

## 自检要求（每工作组）

1. 改完跑 `node --check` 逐文件语法检查；
2. 探针脚本放 `docs/_probe_<组名>.mjs`，**所有相对导入必须带 `?v=11.0`**；
3. 数值类改动必须有一个断言把新旧值都打印出来（便于 Lead 核验）；
4. **禁止**改 `js/version.js`、`docs/bump_imports.mjs`、`js/core/state.js`（Lead 独占）；
5. 完成后向 Lead 报告：改了哪些文件哪几行、探针通过数、以及**你没做的部分**。

## 恢复清单（上下文中断时）

顺序：本文件 → `docs/DECISIONS.md` → 各组独占文件 → Lead 的 `js/core/state.js` 接线。
发版前必跑：`node docs/bump_imports.mjs`（bump 到 12.0）、
`selfcheck_v005` / `selfcheck_v006` / `selfcheck_materials` / `selfcheck_render`。

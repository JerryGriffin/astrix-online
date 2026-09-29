# Astrix 长期约定（精简版；细节以代码+docs+日志为准）

## 工作流
- 改完即发布：每轮收尾必须发布（appId=astrix_a83qn1S1YtnqmhL6Wb2oF3、updateExistingApp:true、language:"static"，固定链接 https://github.com/JerryGriffin/astrix-online/）。云服务已激活。
- 需求批量合并进一个版本；设计决策（数值/公式/取舍）用选项式提问一次问清；中文+表格沟通。
- 上下文快满→停实现：写 docs/TODO_vX.md 自包含施工图（文件/行号/改法/验收/恢复清单）+当日日志。恢复顺序 TODO_*→DECISIONS.md→代码。

## 技术
- 零构建原生 ES modules，禁 npm/CDN。版本号唯一来源 js/version.js；CACHE_TAG=VERSION_NUM+'.'+REVISION。「版本不变只改内容」→REVISION+1。
- 发版必跑 node docs/bump_imports.mjs（js/ 与 **docs/*.mjs** 的相对导入全补 ?v=CACHE_TAG；H 组防回归）。**docs 里的自检脚本若漏补串，会与 UI 链形成两份模块实例（STATE 双份→currentAccount() 恒 null），表现为大面积级联失败**。用户报黑屏→让他复制启动守卫错误面板。
- 速率只走 format.js#fmtRate/fmtRateBody；禁 fmtNum(x)+'/s' 或 toFixed 拼「/分钟」（F 组扫）。fmtRateBody：≥1e3 用 k/m/g；非整数 toFixed(4) 不去尾零（0.2000）；<1e-4 科学记数；整数不带小数点；0→'0'。全站不显示单位（fmtTime 带 s）。
- data/ 纯表、core/ 算法、ui/ 渲染。深空主题；PC/移动 CSS 媒体查询；点击区≥44px。

## 核心铁律
- 死锁：建筑只能用≤解锁科技的层级材料；科研所/建筑工厂 T0；熔炉不耗外电；船坞不能用钛。改价必跑 v005 层级检测。
- inst.power 只读勿覆写；inst.energy 能量池；inst.powerInfo 每 tick 写。降速 ratio 只作用耗电生产（加工/深核采集/科研）；露天采集/施工与建造按钮 disabled 都不乘。
- 设施两段式：fabricator 造进 inst.facilityStock；installFacility 只扣库存不收材料。
- 生产线 inst.lines（接口在 core/production.js）：工位=同建筑各线 workers 和≤建筑数×jobs；炉类家族 STATION_FAMILY 共配方；part_<partId> 产出进 inst.equipment（key=partId@材料）。可用人力=getAvailable−lineWorkersTotal（UI 同）。动态配方必须 resolveRecipe。dock 造船线用 blueprintId，由 state.js#advanceShipLines 调 shipBuildTick 推进（production.js 显式跳过 dock）。
- 升级效果**唯一实现**在 `js/data/upgrades.js#upgradeMul(acc,key)`（v0.1.2 起乘方：累计效果=首级×1.6^(n-1)；价格字段不动）。UI 与 core 都调它，**禁另建模块导出同名函数**（v0.1.2 就出现过 core/upgradefx.js 与 data 侧双份，已删）。`upg_build` 特殊：系数 <1（减工作量），接线处提速 = 1/系数并夹 1~5 倍。
- 新增配方要同时满足 v006 的 **E1**（每项复合资源必须有 `chem_lab` 配方，原料总量 8~16）与 **E2**（高级复合材料必须含气体门槛，气体集 = 氮气/氧气/氨气/甲烷/二氧化碳/氢气）。
- 物品栏资源简介（`ui/inventory.js#openDetail`）：`buildMaterialFlow` 依赖 6 个导入符号（productionRates/BUILDING_BY_ID/NUTRIENT_NAMES/METABOLITE_NAMES/consumptionPerSec/metabolitePerSec），**补导入时漏一个就是「点了没反应」**（异常抛在 openModal 之前）。
- 物品栏不按名去重（key=层:资源名）；总量只用聚合 entriesOf/ownedOf/spendOwned/rateOf/ownedTotal/spendTotal，禁 inventory.find(mat)。氧气不在物品栏（gasAvailable/consumeGas）。netRates 在 tick 最后一步算。配色 +绿#9FE1CB/−红#f09595。
- 自定义材料公式冻结在 production.js#derivedStatsOf；UI 禁手写；原料总量 8~16 且≥2 种。
- 舰船：科技节点已全删（shipTechs 恒[]）；部件解锁只看 t_e3；基础部件 id 勿动；MARKS 仅 MKI，MK=全部件 mark 最大值。
- 净增长 netRates：呼吸耗氧**不计**（扣的是大气层 consumeGas，不碰物品栏）；只有真实扣物品栏的有机质/水才计负。
- 升级「效果」的唯一实现在 `js/data/upgrades.js#upgradeMul(acc,key)`——UI 与 core 都调它，别另建模块再写一份公式。
- 新增化学实验室配方要同时满足 v006 E1（原料总量 8~16）与 E2（高级复合材料必须含气体门槛）。
- 星球「进入」按钮依赖 `main.js → renderPlanet` 的 `onEnterPlanet` 回调；漏传就是恒 disabled。
- 版本号书写口径：用户写「1.2.0」按上轮「1.1→v0.1.1」的惯例解读为 **v0.1.2**（不是 v1.2.0）。
- 平衡：工位按建筑算、多职业共用池；建筑工/船坞工硬门槛；母星 HOME_HAPPINESS_FLOOR=0.88；吃饱+庇护+20℃+不过劳=0.90。数值以代码+自检为准，别信记忆旧值。
- **离线结算三条铁律**（v0.1.3 修）：① 结算后内存必须换成推进过的新实例（否则 UI 显示旧值、下次存档把成果覆盖）；② 必须先对 `loadPlanets()` 出的裸实例过一遍 `getPlanetInstance(code)` 补运行时字段（pop 缺失 → 强度倍率 0 → 产线恒不产出）；③ 读盘为空时用内存 prevPlanets，禁拿空数组 tick 再写回。
- **装备交易键 `partId@材料`**：shop.js 的 isEquipmentKey/isTradable/equipmentValue/priceOf/sell/listForSale/buyListing/deliverOrder 全支持；入库/扣库走 `inst.equipment`；UI 侧要用 `equipmentList(inst)`（shipyard.js 导出）才能把玩家自己的装备列进下拉。
- **编队燃料是共享油箱口径**（v0.1.4）：startMission 探索按 `totalHave >= totalNeed` 判定，再顺序从各船 `min(该船, 剩余)` 扣；`needPerShip` 用 `Math.round()` 消浮点残差。
- **殖民地报告契约**（v0.1.4）：planetgen `colonyReportsOf(acc)`（上限 60）、`COLONY_REPORT_INTERVAL_SEC=30`、per-inst `_reportTimer`/`_tributeCount`；报告 `{at,code,nameCn,modeId,modeNameCn,dev{popDelta,buildingsDelta,popTotal,buildingsTotal},tribute{mats,equip,ships}}`；舰船上供条件 `dock>=1 && acc.ships.length>=4`，每 3 次贡品调 1 艘回母星（不删除）。展示在 `js/ui/reports.js`（浮动提示条 + 历史），main.js 启 `startReportToasts(currentAccount)`。
- **星际云服务契约**（v0.2.0）：`js/core/cloud.js` 提供 `ensureCloudProfile`（Q1-1C 一键生成+可选绑邮箱）、`fetchGalaxyRegistry`（Q3-A 自动混入 7 大 NPC 星球兜底）、`sendGalaxyTrade`、`sendGalaxyRaid`（Q2-A 轻度掠夺 5~10% + 12 小时保护盾）与 `getInbox`。UI 在 `js/ui/galaxy.js`，主界面与母星船坞「星际」双入口。入库物品栏必须调 `addMaterial(inst, mat, amt)`（`ensureEntry` 第三参数是 layer 不是 amount）。
- **军队系统契约**（v0.2.0）：`js/core/army.js` 提供 `armyStatsOf(bpId)`、`canAssembleArmy`、`startArmyAssemble`、`cancelArmyAssemble`、`tickArmyBuildLines`、`stationedArmyPower`（加到母星要塞防御分）与 `disbandArmy`。制造车间（fabricator）自动支持 `ARMY_PARTS`（key=`partId@材料`，产出入 `inst.equipment`，`inst.equipment` 条目为 `{ partId, material, count }` 对象，读写必须判对象取 `.count`）。UI 位于 `js/ui/army.js`，通过 `planet.js` 菜单「军队」Tab 加载。

## 子代理与验证
- 并行前提：契约冻结进 TODO 文档；每代理独占不重叠文件；state.js 等汇聚层主代理独占。信 grep 不信报告，交付后逐条核验落盘。同文件多处编辑禁并行发（丢盘）。
- **工作组报「失败」≠ 它没改文件**。429/中断常发生在最后汇报一步，编辑已落盘（v0.1.2 的 w-design 就是这样，
  结果线上舰船页 ReferenceError）。**发布前必须由 Lead 自己跑完四套自检 + 浏览器冒烟**，
  不能拿工作组自报数字当验收；对「失败但可能已落盘」的组要额外做专项端到端验证。
- 自检每轮必跑：selfcheck_v005 / v006 / materials / render。改常量后搜自检硬编码；新需求在 v006 开新组。
- 端到端：playwright-core+msedge.exe（脚本 docs/_smoke_v011.mjs 可复用，起本地静态服务后逐级点进游戏）；iOS 用 webkit（390×844 hasTouch isMobile）。**脚本里 step() 回调在 Node 侧执行，里面不能用 document**（要取值先 evaluate 出来）。
- 环境坑：Bash 报 dirname/ls not found→命令前加 export PATH="/usr/bin:/bin:/c/Windows/System32:$PATH";；优先 Edit 禁 python 批量替换（三次丢盘）；部署无 Cache-Control→让用户强刷；render 桩缺 API 先补桩（querySelector 单数/classList/activeElement），step() 禁传 async。
- **Node 探针必须先注入内存 adapter**：`S.setAdapter({get,set,del})`（Node 无 localStorage，默认 adapter 的 get 恒 null、set 静默失败 → 持久化/离线链整条空转，会误判成「功能没生效」）。另外 `saveState()` 会把当前账号 `stats.lastSeen` 刷成 now，测离线要**先存档再改 lastSeen**。index.html 已加 no-cache meta（静态托管无 Cache-Control），数据表改了玩家仍看旧值＝缓存，REVISION+1 击穿。

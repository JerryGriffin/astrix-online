# Astrix v0.4.6 现状审计与更新方向

审计时间：2026-10-05
审计范围：v0.3.2（本地旧版）→ v0.4.6（远端最新，已下载并快进）
代码规模：52 个 js 文件 / 32,158 行 / 9 套自检脚本

---

## 一、下载结果

远端 `main` 比本地领先 **12 个提交**，已 fast-forward 合并完成。

| 项 | 旧（本地） | 新（已下载） |
|---|---|---|
| 版本 | v0.3.2 | **v0.4.6** |
| VERSION_NUM | 32 | 46 |
| REVISION / CACHE_TAG | 1 / 32.1 | 11 / **46.11** |
| js 文件数 | 47 | 52 |
| 总行数 | 26,620 | 32,158 |
| HEAD | 555fd9f | **c3e6786** |

新增模块：`js/core/battle.js`(1634)、`js/core/theater.js`(1005)、`js/core/treaty.js`、`js/ui/alloy.js`、`js/ui/treaty.js`

v0.3.3→v0.4.6 主要内容：行星战区地图（6×6）、补给网络 BFS、殖民地争夺、和平会议 6 种处置、自定义合金 UI、装备任意材料、军队多线并行产兵。

### 全量自检（已跑，全绿）

| 脚本 | 结果 |
|---|---|
| selfcheck_battle | 通过 100 / 失败 0 |
| selfcheck_theater | 通过 98 / 失败 0 |
| selfcheck_v045 | 通过 83 / 失败 0 |
| selfcheck_v046 | 通过 73 / 失败 0 |
| selfcheck_fixes | 通过 27 / 失败 0 |
| selfcheck_v005 | 通过 1388 / 失败 0 |
| selfcheck_v006 | 通过 258 / 失败 0 |
| selfcheck_materials | 通过 |
| selfcheck_render | 运行时异常 0 |

> 注意：自检全绿 ≠ 无缺陷。下列 P0 已逐条运行时证实，且**都在自检盲区里**。

---

## 二、存在的问题（按严重度，均已核实）

### 🔴 P0-1　敌方夹击 AI 100% 失效，且连带打断补给刷新

`js/core/theater.js:908,911,915`

```js
for (const p of plans) {
  if (activeCount >= BATTLE_MAX_PER_WAR) break;   // ← 两者都未声明
  ...
  if (r && r.ok) { opened++; activeCount++; }
}
if (opened > 1) { unshiftWarLog(acc, war, ...); }  // ← 也未声明
```

核实证据：
- `activeCount` 使用 2 次、**声明 0 次**
- `BATTLE_MAX_PER_WAR` 使用 1 次、声明 0 次（定义在 `battle.js:55`，但 theater.js 未 import）
- `unshiftWarLog` 使用 1 次、声明 0 次（定义在 `battle.js:1436`，未 export）
- theater.js 第 32 行只 import 了 `HOI_BY_ID, HOI_MAIN_NATIONS`

**触发条件必然满足**：`aiMood==='press'` 在 `progress <= 35` 时判定（theater.js:875），即**我方处于劣势时**——最常见战局。玩家刚开局 progress=0，必定走 press 分支。

**影响链**：
1. 第 908 行在 `try` 块**之外**，ReferenceError 冒泡到 `state.js:1258` 的空 catch
2. 敌方多路夹击（v0.4.3 核心卖点）**一次都不触发**
3. 崩溃点位于 `refreshSupply` 之后、`AI 扩张` 之前 → **补给网络刷新与敌方扩张全部跳过**，`tickTheaterAI` 后半段是死代码
4. 无任何 console 输出，完全不可见

**为什么自检没抓到**：`selfcheck_theater.mjs:486-499` 的 T14 用 `TH.aiFlankPlans()` + 直接调 `startBattle()` **自己复刻**了那段循环，从不调用 `tickTheaterAI`。

---

### 🔴 P0-2　"侦察突破"事件把敌方攻击力永久锁在 50%

`js/core/battle.js:684 → 837 → 783`

```js
// 684: 事件上下文初始化
foeAtkMul: null, mineAtkMul: null,
// 837: scout 事件
apply: (ctx) => { ctx.foeAtkMul = Math.min(ctx.foeAtkMul, 0.82); ... }
// 783: 消费
const evFoeAtk = (b.foeAtkMul == null) ? 1 : Math.max(0.5, b.foeAtkMul);
```

运行时实测：`Math.min(null, 0.82) === 0`（null 被强转 0）→ `Math.max(0.5, 0) === 0.5`

**影响**：scout 事件每小时 26% 概率触发（权重 1.0，最高频之一）。一旦触发，`b.foeAtkMul = 0`，敌方攻击力**永久**降至 50%。第 1003 行写回逻辑是"只在事件给新值时覆盖"，此后无任何地方重置回 1——**debuff 持续到战役结束**。而事件描述写的是"**暂时**下降"（836 行），实现是永久，注释与实现矛盾。

---

### 🔴 P0-3　40 处空 catch 把系统故障伪装成正常运行

`js/core/state.js` 有 **40 处** `catch (e) { /* 忽略 */ }`，无一处记录日志。危害最大的在 1247-1258：

```js
try {
  ensureTheater(acc); refreshSupply(acc); decayStrikePressure(acc, dt);
  tickRegions(acc, dt); tickTheaterAI(acc, dt, {...});   // ← P0-1 在此崩
} catch (e) { /* 地图层异常不拖垮心跳 */ }
```

一个 try 罩 5 个调用，任一抛错则**后 4 个全部不执行**且无日志。这正是 P0-1 不可诊断的直接原因，也是上一版 v0.3.2 多个"界面不显示"类 bug 的同一类根因。

---

### 🟡 P1-1　轨道控制变量 `_ctrl` 是死代码

`theater.js:811` 读 `t._ctrl`，全仓库**只有这一处出现，零处写入**。导致 `0.01 * ctrl` 恒为 0——玩家控制度 100% 与 0% 的轨道打击回充速度完全相同，与 UI 上"有轨道控制时恢复更快"的说明矛盾。

### 🟡 P1-2　敌方进攻地形用已废弃的地球地形

`hoi1936.js:942` 的 `pickFoeTerrain` 用 `['plain','forest','urban','mountain','desert']`，但 `battle.js:116-123` 的 `terrainList()` 只返回 7 项太空地貌，UI 下拉框里**根本没有 `plain`**。而 `hoi.js:43` 的 `_lineSel.terrain` 默认值就是 `'plain'`——玩家不选地形直接点"开辟战线"，必定被兜底成 `regolith`。默认值形同虚设。

### 🟡 P1-3　围城未满时"打赢但没占领"，战报仍记胜利

`captureRegion` 在穹顶战区未达围城线时返回 `{sieged:true}` 而**不改 `region.owner`**，但 `battle.js:1378` 的空 catch 吞掉现场，`sieged` 字段在 1389 行构造 `b.result` 时被整个丢弃。结果：玩家拿到 14% 推进 + 10 战争分数，战报记"战役胜利"，但战区易主没发生，且战后无从得知。

### 🟡 P1-4　`perMine` 死变量，矿场与殖民地同基数

`theater.js:504` 声明 `const perMine = 0.35 // 矿场` 后**从未被引用**。523 行用的是 `perColony * mul`，矿场与殖民地同取 0.60 基数，矿场的设计值被架空。

### 🟡 P1-5　无人机蜂群兵种是死配置

`battle.js:154-157` 的 `DIV_TEMPLATES.drone`（注释称"软攻极高"）永远不会被实例化——`kindOfDivision` 只返回 `armor|mech|infantry`，`takeFoe` 也只从这三者选。

---

### 🟠 P2 技术债（影响长期可维护性）

| 问题 | 位置 | 说明 |
|---|---|---|
| **`materialLookupFor` 有副作用** | shipyard.js:169-175 | 名为取值函数却改写模块级全局 `ACTIVE_LOOKUP`。深层路径（battle.js 军队战力、theater.js 战区结算）拿不到星球实例，会用**上一个星球**的合金表——这是 v0.4.6 声称修掉的"自定义合金静默 ×1.00"的**新变种** |
| **每次调用全量浅拷贝材料表** | shipyard.js:170 | `alloy.js:150` 在 `draft.parts.forEach` 内调用，24 种原料上限下每帧拷 24 次整表 |
| **14 份 `el()` 且有 2 种不兼容签名** | `el(tag,cls,text)` 9 个文件 vs `el(tag,attrs,children)` 5 个文件 | 跨文件复制粘贴必然引入 bug（v0.3.2 的"列强区块不显示"就是 `el('div','cls','text')` 用错签名） |
| **`clamp` 5 份 / `mulberry32` 2 份 / `hash32` 2 份** | 无 `core/util.js` | 第三处新增时无从复用 |
| **师战力推导三套写法** | battle.js:410 / 1616 / 1339 | 需手工保持同步，UI 显示值可能与实际入战战力不符 |
| **旧战后处置路径未删** | galaxy.js:29 仍 import `applyPostwarChoice` | 新旧两条路径产出不同战后状态，且都可达 |
| **229 处 `?v=47.1` 硬编码** | 36 个文件 | 全靠 `docs/bump_imports.mjs` 文本替换维持；漏跑即产生模块双实例（STATE 单例分裂） |

### 🟠 P2 性能

- `state.js:1262-1274` 每 tick 遍历 36 战区 × 产出表（约 144 次运算）+ `ensureEntry` 线性查找，且整体被空 catch 包裹——**任一材料名异常则所有战区产出静默归零**
- `battle.js:1491` 每 1.33 秒重算一次补给，内含遍历全部舰队 × 每支调 `fleetPowerOf`
- `hoi.js:1110` 每秒全量重绘，`buildTheaterMap` 与 `buildRegionPanel` 各调一次 `theaterView` → 同帧 2 次全图 BFS，纯重复
- `theater.js:346` 8 邻接用 `regions.find()` 线性查找 → `refreshSupply` 整体退化为 O(n²)
- `shipyard.js:707` 每造一艘船做一次 `JSON.parse(JSON.stringify(bp))` 深拷贝，且**结果进存档**

### 🟠 P2 平衡数值散落

约 30 处魔法数写在代码深处而不在 `data/` 表：补给压制 `myScore*0.004`、装备率 `sup>=0.5?1:sup*1.7`、轨道轰炸概率 `0.12+0.22*ctrl`、和平会议上贡率 `0.18/0.12`、合金协同 `1+0.06(n-1)` 等。

其中最可疑：`state.js:1308,1311` 的 `vas.tribute * 1000`——`tickVassals` 返回值已乘过 `dt`，再乘 1000 无任何注释依据。

UI 侧还有重复字面量：`treaty.js:84,165` 的 `×1.6`/`35%` 与 `theater.js:610-611` 的 `TREATY_COLONY_OUTPUT_MUL=1.6`/`GARRISON_MUL=0.35` 是同一组数值两份，改平衡要同时改三处；`treaty.js:45` 的迫降线 `60` 应引 `WAR_FORCE_SURRENDER_SCORE`；`hoi.js:785` 的 500 人写死在 UI。

---

## 三、建议的更新方向

### 方向 1：先止血——补 P0（建议作为 v0.4.7，半天工作量）

1. `theater.js:906` 补 `let activeCount = 0`；`BATTLE_MAX_PER_WAR`/`unshiftWarLog` 改为从 `ctx` 注入（沿用既有 `ctx.startBattle` 模式，避免反向 import 循环依赖）
2. `battle.js:684` 的 `foeAtkMul/mineAtkMul` 初值 `null` → `1`
3. `state.js` 关键路径 catch 补 `console.error`（至少 1247/1262 两处）
4. `selfcheck_theater.mjs` 增加一条**直接调用 `tickTheaterAI` 并断言不抛异常**的用例——这是防止同类问题复发的关键

### 方向 2：把"静默失败"变成显式可观测

40 处空 catch 是这个项目反复"界面不显示/功能没反应"的共同根因。建议引入统一的 `softFail(tag, e)` 工具：既不拖垮心跳，也留下可查日志。这是**投入最小、收益最大**的一项基建。

### 方向 3：抽公共模块，收敛重复实现

- 建 `js/core/util.js`：`clamp/mulberry32/hash32`
- 建 `js/ui/common.js`：统一 `el()` 为单一签名（先兼容两种旧写法，再逐步迁移）
- `materialLookupFor` 去掉写全局的副作用，改由调用方显式 `setActiveMaterialLookup`
- 删除 `applyPostwarChoice` 旧路径与 `perMine`/`drone` 死代码

### 方向 4：平衡数值迁入 `data/` 表 + 单一来源

把约 30 处散落的战斗/战区/条约/合金数值迁到 `js/data/` 下的表文件，UI 只读常量不写字面量。这一步能显著降低"改平衡要改五处"的回归风险。

### 方向 5：存档与性能

- `ship.blueprint` 深拷贝改为共享引用（存档体积大 N 倍）
- `neighborsIn` 的 `regions.find()` 改预建邻接表，消除 O(n²)
- `hoi.js` 同帧两次 `theaterView` 合并为一次
- `regionYieldOf` 产出表预聚合成 Map，避免每 tick 144 次线性查找

### 方向 6：存档迁移的自愈惯例（沿用已有做法）

v0.3.1/v0.3.2 的经验是"用户报'仍然坏'几乎总是老存档数据 + Pages 缓存"。新增的 theater/treaty/alloy 三套系统目前**未见自愈迁移入口**。建议按 `repairScenarioEstates` 的既有模式，为 1936 剧本老档补一份 `ensureTheater`/条约/合金表的幂等迁移。

---

## 四、结论

v0.4.6 的功能演进（战区地图 / 和平会议 / 自定义合金）设计完整、自检覆盖 9 套 2000+ 项且全绿。但存在**三个已运行时代码证实、且全部落在自检盲区**的 P0 缺陷：

- 敌方夹击 AI 与补给刷新 100% 失效（P0-1）
- 敌方攻击力被事件永久锁 50%（P0-2）
- 40 处空 catch 使上述故障不可见（P0-3，共同放大器）

建议**优先做方向 1（半天）**，这是当前投入产出比最高的一步；随后做方向 2（可观测性基建），能系统性降低这个项目"改完不知道有没有坏"的固有风险。

# Astrix v0.0.51 · 已完成并发布

> **状态：已全部落地**（2026-09-17）。以下内容保留作为问题定位的记录，
> 新的待办请看 `docs/DECISIONS.md` 的「仍待定」。
> 实现要点已并入 `docs/labor.md`（庇护 / 人口）与 `docs/DECISIONS.md`（房屋与庇护）。

# Astrix v0.0.51 · 开工说明（自包含，新会话只读这一个文件即可）

> 本文写于 2026-09-17，用户提出 v0.0.51 后**明确要求等子代理可用再开工**，
> 因此本文件是「下一个会话的施工图」：含精确定位、已查到的根因、验收标准与自检命令。
> 开工前请先读本文件 + `docs/DECISIONS.md`，再读代码。

---

## 〇、开工前先确认一件事

用户原文写的是「**版本0.0.51**」。上一版是 **v0.0.5**，有可能是：
- 笔误，本意是 **v0.0.6**；
- 或者确实想跳到 **v0.0.51**。

**建议开工第一句就问清楚**，再改 `js/version.js`。改版本号只需改 `js/version.js` 一处，
`index.html` 的 5 个 css 与 `js/main.js` 入口要同步把 `?v=0.0.5` 改成新版本号（击穿缓存）。

---

## 一、需求 1：离线模式描述改为「与电脑对抗」

| 项 | 内容 |
|---|---|
| 文件 | `js/ui/start.js` |
| 位置 | **第 54 行** |
| 现状 | `modeButton('离线模式', '全部是人机', () => handleOffline(ctx), true),` |
| 改成 | 副文案「全部是人机」→ **「与电脑对抗」**（建议 `'与电脑对抗'`，保留 4 字结构不撑破按钮） |
| 验收 | 开始界面第二个主按钮副文案显示「与电脑对抗」；`selfcheck_v005.mjs` 第一节有关 start 的断言若引用旧文案要同步改 |

> 注：这一条是「一行文案」，成本极低，本轮已经定位到位，开工时第一个改它。

---

## 二、需求 2：新增建筑「房屋」（造价低 · 每栋 100 庇护 · 开局 5 座）

### 2.1 数据表：`js/data/buildings.js`

新增一条（放在 `industry` 之外建议**新增一个类别 `housing`**，见下方说明）：

```js
{
  id: 'house',
  nameCn: '房屋',
  unlockTech: null,                 // 默认解锁（开局就要有 5 座）
  category: 'housing',              // 见 2.2：需要在 CATEGORIES 里补这个键
  baseCost: { '泥土': 200, '石头': 100 },   // 造价低，且必须是 T0 材料（见铁律）
  growth: 1.10,                     // 比发电类 1.12 还低 —— 房屋是最便宜的建筑
  work: 200,                        // 工作量低于人力发电厂（400）
  jobs: 0,                          // 不提供工位（它提供的是庇护）
  powerDraw: 0,
  powerOut: 0,
  shelter: 100,                     // ★ v0.0.5 新增字段：每栋提供的庇护量
  desc: '低成本居住建筑，每栋提供 100 点庇护。庇护不足会拉低幸福度、进而拖慢人口增长。',
}
```

**建材铁律（改前必读 `docs/buildings.md` 第〇节）**：房屋是默认解锁（层级低于 T0），
**只能用 T0 材料**（有机质 / 泥土 / 石头 / 水），否则开局死锁。

### 2.2 `CATEGORIES` 要补键

`js/data/buildings.js` 末尾的 `CATEGORIES` 对象里加一行：

```js
housing: '居住',
```

并在 `js/ui/buildings.js` 渲染顺序里确认新类别会出现（它遍历 `Object.keys(CATEGORIES)`）。

### 2.3 庇护总量计算（新函数）

建议在 `js/core/population.js` 或 `js/core/state.js` 里加：

```js
// 星球总庇护 = Σ (建筑座数 × 该建筑 shelter)
export function totalShelter(inst) {
  const counts = getBuildingCounts(inst);
  let n = 0;
  for (const id in counts) {
    const b = BUILDING_BY_ID[id];
    if (b && b.shelter) n += counts[id] * b.shelter;
  }
  return n;
}
// 庇护覆盖率 C ∈ [0,1]：1 = 人人有得住
export function shelterRatio(inst) {
  const total = inst.pop ? Math.floor(inst.pop.total) : 0;
  if (total <= 0) return 1;
  return Math.min(1, totalShelter(inst) / total);
}
```

### 2.4 接线到幸福度（这是这个建筑的**意义所在**）

现状：`js/core/state.js` 的 `advancePopulation()` 调用 `tickPopulation(inst.pop, dt, supply)`
时**没有传 `opts.shelter`**，所以 `computeHappiness` 里庇护项 `C` 一直取默认值 1（永远满庇护）。

改成：

```js
const r = tickPopulation(inst.pop, dt, supply, {
  shelter: shelterRatio(inst),
  // tempK 暂时仍用默认值（星球温度系统还没做）
});
```

这样「房屋不够住 → C < 1 → 幸福度下降 → 人口增长变慢」，房屋才有存在感。

### 2.5 开局 5 座

`js/core/state.js` 里星球实例初始化的位置（现在给开局的是 `{ workshop: 1 }`），
改成 `{ workshop: 1, house: 5 }`。

> 现状参考：`selfcheck_render.mjs` 里断言「开局只有 1 座建筑工厂，人力面板出现 2 个分组」。
> 加了房屋后：房屋 `jobs: 0` → **不会产生新职业**（`JOBS_BY_BUILDING['house']` 为空），
> 所以人力面板分组数不变，该断言仍然成立。但造价自检里「建筑数」会从 21 → **22**，
> `selfcheck_v005.mjs` 第一节与 `selfcheck_render.mjs` 的建筑面板断言要同步改。

### 2.6 验收标准

- [ ] `BUILDINGS.length === 22`
- [ ] 开局 `getBuildingCounts(inst)` = `{ workshop: 1, house: 5 }`
- [ ] `totalShelter(inst) === 500`（5 × 100）
- [ ] 1000 人时 `shelterRatio === 0.5`；把人口改小到 400 时 `=== 1`
- [ ] 庇护不足时 `computeHappiness(..., { shelter: 0.5 })` 明显低于 `shelter: 1`
- [ ] 房屋造价全部是 T0 材料（自检里的「建材层级倒挂检测」会覆盖）

---

## 三、需求 3：离线模式删除存档无法起效（已定位两个根因嫌疑）

### 3.1 现场代码

`js/ui/start.js` 第 97–128 行 `renderAccountList()`：

```js
const del = el('button', 'btn btn-sm btn-danger', '删除');
del.onclick = () => {
  actions.innerHTML = '';
  const yes = el('button', 'btn btn-sm btn-danger', '确认删除');
  const no  = el('button', 'btn btn-sm', '取消');
  yes.onclick = () => {
    deleteAccount(acc.id);                                  // 数据层删除
    if (STATE.accounts.length === 0) ctx.enterOffline();
    else renderAccountList(body, ctx);                      // ★ 嫌疑点 A
  };
  no.onclick = () => renderAccountList(body, ctx);
  actions.append(yes, no);
};
```

`openAccountPicker()` 是这么把 body 交给模态层的（第 91–95 行）：

```js
function openAccountPicker(ctx) {
  const body = document.createElement('div');   // detached 节点
  renderAccountList(body, ctx);
  ctx.openModal({ title: '选择存档', body, sheet: true });   // ★ modal 内部怎么用 body？
}
```

### 3.2 嫌疑点 A（最可能，先查这个）

**`body` 是 detached 的 `<div>`。如果 `openModal` 只是把它 append 进模态容器，那 `renderAccountList(body)` 重绘是有效的；
但如果 modal 层读的是 `body.innerHTML` 字符串、或克隆了节点，那重绘的就是那个 detached 的旧 div，
模态里显示的内容完全不刷新 → 玩家点了「确认删除」，界面纹丝不动，看起来就是「删除无效」。**

**查法**：读 `js/main.js` 里 `openModal` 的实现，看它是 `appendChild(body)` 还是 `innerHTML = body.innerHTML`。

**修法（任选）**：
- 让 `openModal` 支持刷新回调，例如 `ctx.openModal({ title, render: (container) => renderAccountList(container, ctx), sheet: true })`；
- 或在删除后**整个重开模态**：`ctx.closeModal(); openAccountPicker(ctx);`（比局部重绘稳，推荐）。

### 3.3 嫌疑点 B（数据层串档，确认存在）

`js/core/state.js` 第 150–158 行：

```js
export function deleteAccount(id) {
  STATE.accounts = STATE.accounts.filter((a) => a.id !== id);
  if (STATE.currentAccountId === id) {
    STATE.currentAccountId = STATE.accounts[0] ? STATE.accounts[0].id : null;
  }
  adapter.del(SAVE_PREFIX + id);
  adapter.del(PLANETS_KEY + id);
  saveState();          // ★ 此时 STATE.planets 还是「被删账号」的星球数据
}
```

删掉的是**当前**账号时，`STATE.planets` 里装的仍是那个已删账号的星球实例，
紧接着的 `saveState()` 会执行：

```js
if (STATE.currentAccountId) {
  adapter.set(PLANETS_KEY + STATE.currentAccountId, JSON.stringify(STATE.planets));
}
```

→ **把 A 的进度写进了 B（accounts[0]）名下**。删 A 反而把 A 的数据灌进 B。

**修法**：在切换 `currentAccountId` 之后、`saveState()` 之前，重载新账号的星球：

```js
if (STATE.currentAccountId === id) {
  STATE.currentAccountId = STATE.accounts[0] ? STATE.accounts[0].id : null;
  STATE.planets = STATE.currentAccountId ? loadPlanets(STATE.currentAccountId) : [];
}
```

（与 `switchAccount()` 里已经做对的写法保持一致。）

### 3.4 另外两个已知的边界问题（顺手一起修）

- **删除后没有回到「新建存档」流程的提示**：`STATE.accounts.length === 0` 时直接 `ctx.enterOffline()`，
  玩家不会看到「已删除，请新建存档」的反馈。
- **`handleOffline` 的分支**（第 86–89 行）：`STATE.accounts.length === 0` → 直接 `enterOffline()`；
  这个分支在删除最后一个存档后是对的，但**第一次点离线模式、还没建过存档时**也走这里，语义混在一起。
  建议改成显式判断「是不是刚删完」。

### 3.5 验收标准

- [ ] 建 2 个存档 A / B，各自 tick 不同时长 → 删掉当前 A → 列表只剩 B，且 **B 的进度没有被 A 覆盖**
- [ ] 删完列表立即刷新（不用关模态再点一次）
- [ ] 删掉最后一个存档 → 回到新建存档界面
- [ ] 刷新页面后，被删的存档不会复活
- [ ] `selfcheck_v005.mjs` 第十节「存档往返」里加一条：删除当前账号后，另一账号的 `planets` 未被污染

---

## 四、开工顺序建议（按依赖）

1. 问清版本号（0.0.6 还是 0.0.51）→ 改 `js/version.js` + `index.html`
2. 一行文案：离线模式「与电脑对抗」（最快见效）
3. 删档 bug：先读 `js/main.js` 的 `openModal` 确认嫌疑点 A，再改 `deleteAccount`（嫌疑点 B）
4. 房屋建筑：`buildings.js` 加条目 + `CATEGORIES` 补 `housing`
5. 庇护接线：`totalShelter` / `shelterRatio` → `advancePopulation` 传 `opts.shelter`
6. 开局 `buildings: { workshop: 1, house: 5 }`
7. 同步自检里的数量断言（21 → 22）
8. 跑全部自检 → 发布

---

## 五、自检命令（改完必跑）

```bash
# 数据层全量断言（当前 1258 项，会随新增断言增加）
"C:/Users/11603/.workbuddy/binaries/node/versions/22.22.2-3/node.exe" docs/selfcheck_v005.mjs

# 星球资源 × 材料表 × 建筑造价 三角交叉比对
"C:/Users/11603/.workbuddy/binaries/node/versions/22.22.2-3/node.exe" docs/selfcheck_materials.mjs

# 最小 DOM 桩跑全流程，抓运行时异常
"C:/Users/11603/.workbuddy/binaries/node/versions/22.22.2-3/node.exe" docs/selfcheck_render.mjs
```

Bash 偶发 `dirname: command not found` 时，命令前加
`export PATH="/usr/bin:/bin:/c/Windows/System32:$PATH";`；还不行就换 PowerShell。

---

## 六、恢复上下文需要读的文件（按优先级）

| 文件 | 作用 |
|---|---|
| `docs/TODO_v0.0.51.md` | **本文件**，施工图 |
| `docs/DECISIONS.md` | 全部设计决策与「仍待定」清单 |
| `docs/labor.md` | 人力系统说明书（营养/工位/幸福度公式，改庇护必读） |
| `docs/buildings.md` | 建筑与科技数据表 + **建材层级铁律** |
| `.workbuddy/memory/MEMORY.md` | 项目长期约定（工作流、技术约定、踩坑） |
| `.workbuddy/memory/2026-09-17.md` | 当日工作日志（v0.0.2 → v0.0.5 全过程） |

---

## 七、仍待定（承接 v0.0.5，未解决）

1. 研究点**能产不能花**（产点已接，扣点未接）
2. 配方/合成表未做 → 飞船建造仍不扣材料
3. 除 A1/A2/A3/D3 外研究点花费仍是占位值
4. 「建筑工厂是其他建筑的前置」目前只是施工硬门槛
5. **幸福度从不下降**（吃饱+有庇护+20℃ 目标恰好 0.90）—— **加「房屋 / 庇护」正好是这个问题的解法**，
   做完需求 2 后这条可以重新评估
6. 星球温度系统未做（`tempK` 目前一直取 293）

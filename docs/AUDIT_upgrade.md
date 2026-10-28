# 可更新项审计（ASTRIX v0.4.21）

- **审计基线**：`a4b8309`（origin/main，2026-10-08 最新提交，已从 GitHub 同步）
- **审计日期**：2026-10-28
- **代码规模**：`js/` 56 个文件 / 34,144 行 / 1,731,279 字节（gzip 550,542 字节）；`css/` 7 个文件 / 74 KB
- **运行时依赖**：零。`node_modules` 仅 `playwright-core`（自检探针用，不进产物）

**结论**：工程整体健康度高于同类零构建项目 —— 无 `var`、无 `innerHTML +=` 累计拼接、17 个定时器全部成对 `clearInterval`、`100dvh` 与 `env(safe-area-inset-*)` 均已有兜底。真正的可更新项集中在**一个依赖的版本治理缺陷**、**发版配置缺失**和**三处可量化的加载/主线程开销**，不需要引入构建工具。

---

## 优先级总览

| # | 项目 | 类型 | 影响范围 | 优先级 | 工作量 |
|---|---|---|---|---|---|
| 1 | 云 SDK 三源版本不一致 + 主源浮动 `@dev` | 依赖 | 全部在线玩家（登录/星系/贸易/战争） | **P0** | 0.5h |
| 2 | 3 个自检脚本硬编码他人机器路径 | 配置 | 自检在非原开发机上的可靠性 | **P0** | 0.2h |
| 3 | `version.js` 152 KB 更新日志进首屏主链路 | 代码 | 全部玩家首屏加载 | **P1** | 1.5h |
| 4 | `package.json` 缺 `scripts` / `engines` / `repository` | 配置 | 发版与协作可重复性 | **P1** | 0.3h |
| 5 | 版本号双源（`package.json` vs `version.js`）无校验 | 配置 | 发版一致性 | **P1** | 0.3h |
| 6 | `playwright-core` 1.63.0 → 1.64.1 | 依赖 | 仅本地自检 | **P1** | 0.5h + 回归 |
| 7 | 17 个独立 `setInterval` + 15 处重复可见性守卫 | 代码 | 后台 CPU 与代码重复 | **P2** | 2h |
| 8 | 每 10 秒三次同步全量序列化写 localStorage | 代码 | 后期存档主线程卡顿 | **P2** | 1h |
| 9 | 无 CI / 无 lint / 无 `.editorconfig` | 配置 | 回归保障 | **P2** | 2h |
| 10 | `?v=` 缓存串需改写 40 个文件 | 代码 | 发版摩擦（可选迁移 Import Map） | **P2** | 4h |
| 11 | `JSON.parse(JSON.stringify())` 深拷贝 | 代码 | 局部可读性 | **P3** | 5min |
| 12 | `execCommand('copy')` 优先于 Clipboard API | 代码 | 启动守卫复制按钮 | **P3** | 5min |
| 13 | 内置 SDK 缺 sourcemap / 缺页面元信息 | 配置 | 调试体验、分享预览 | **P3** | 0.5h |

---

## P0 — 需要优先处理

### 1. 云 SDK 三方版本不一致，且主源使用浮动标签

**证据**：`js/core/cloud.js:27` 与 `:53-57`

```js
const SDK_URL = 'https://cdn.jsdelivr.net/npm/@tencent-ai/workbuddy-cloud-sdk@dev/lib/index.global.js';
const SDK_URLS = [
  SDK_URL,                                                        // ① @dev 浮动
  '.../@tencent-ai/workbuddy-cloud-sdk@0.1.3/lib/index.global.js', // ② 固定 0.1.3
  'assets/vendor/workbuddy-cloud-sdk.js?v=' + CACHE_TAG,           // ③ 本地副本
];
```

**实测版本状况**：

- npm `dist-tags`：`latest = 0.1.4`，`dev = 0.1.4-dev.ca27990.202610161713`
- 仓库内置副本与 npm `0.1.3` **内容一致**（`cmp` 报差异仅在行尾：本地 62,063 字节 vs 发布 62,057 字节，差 6 个 CR，逐字节比对无其他分歧）
- 即：**主源跑 0.1.4-dev，兜底源跑 0.1.3**，两条路径行为可能不同

**风险**：

1. `@dev` 是浮动标签，上游任意一次预发布都会静默改变生产行为，构建不可复现 —— 这与项目「零构建、可长期维护」的定位冲突。
2. 首次加载失败会掉到 0.1.3，与主源跨一个 minor 版本；若 0.1.4 改了认证/RLS 相关行为，玩家会看到「同一账号在不同网络环境下行为不同」这类极难复现的问题。
3. jsDelivr 对 `@dev` 有 CDN 缓存，版本回滚不受仓库控制。

**建议**：三处统一到显式版本号（推荐先统一到 `0.1.3`，验证后再整体升 `0.1.4`），并在 `cloud.js` 顶部注释里写明「升级需同时改 CDN 主源、CDN 兜底、`assets/vendor` 副本」三步。

**影响面**：在线模式的全部功能（邮箱/账号登录、星系 registry、跨玩家事件、贸易与战争回执）。离线模式不受影响。

### 2. 自检脚本硬编码他人机器绝对路径

**证据**（3 处，均为原开发者账号 `11603`）：

- `docs/selfcheck_smoke_browser.mjs:34`
- `docs/selfcheck_v048.mjs:80`
- `docs/selfcheck_v049.mjs:46`

```js
() => createRequire('C:/Users/11603/.workbuddy/binaries/node/workspace/package.json')('playwright-core'),
```

**现状**：本机（`zhang`）能跑通，是因为第 ① 候选 `createRequire(import.meta.url)` 从 `docs/` 向上找到了仓库根的 `node_modules`，第 ③ 候选实际是**死路**。在第三台机器上（无本地 `node_modules`）三条候选全部失败。

**建议**：改为 `os.homedir()` 拼接，或统一走 `process.env.WORKBUDDY_NODE_WORKSPACE` 环境变量并给出缺省值。修完可用 `npm ci --ignore-scripts` + 删 `node_modules` 的干净环境验证一次。

**影响面**：仅开发期。但这是「自检本身加载失败」的同类事故来源 —— 上一轮 v048/v049 报 `MODULE_NOT_FOUND` 本质就是这个问题的另一半。

---

## P1 — 高性价比改进

### 3. `version.js` 把 152 KB 更新日志放在首屏主链路上

**数据**：

| 指标 | 数值 |
|---|---|
| `js/version.js` | 1,485 行 / 152,415 字节 |
| 占 `js/` 原文比例 | 8.8% |
| gzip 后 | 64,161 字节 / 占全部 JS gzip 体积 **11.7%** |
| `VERSIONS` 实际使用点 | 仅 `js/ui/start.js:281`（渲染更新日志列表） |

**问题**：`start.js:6` 静态导入 `VERSIONS`，而 `start.js` 在 `main.js:3` 被静态导入 → **玩家打开页面即下载完整更新日志**，即便从不点开「更新日志」。中文文本压缩率低（gzip 后仍有 64 KB），是当前首屏最大的单一模块之一（仅次于 `js/data/planets.js`）。

**建议**：把 `VERSIONS` 数组拆到 `js/data/changelog.js`，`start.js` 改为在打开日志面板时 `await import(...)` 动态加载。`VERSION` / `VERSION_NUM` / `CACHE_TAG` 留在原文件（被 40 个模块和 `cloud.js` 引用，必须保持轻量）。首屏可省约 64 KB gzip（约 12% 的 JS 传输量）。

**注意**：拆分后 `docs/bump_imports.mjs` 会为新文件的相对导入补 `?v=`，但动态 `import()` 的字符串必须同样带 `?v=${CACHE_TAG}`，否则缓存击穿会漏掉这一块 —— 这是本次改动唯一的真实风险点。

### 4. `package.json` 缺发版必要字段

当前 `package.json` 只有 `version` / `description` / `type` / `devDependencies`。缺失项：

| 字段 | 缺失后果 |
|---|---|
| `scripts` | 13 套自检 + `bump_imports` + 推送全部靠手敲命令，README 与口头约定维系 |
| `engines` | `playwright-core@1.63+` 要求 `node >= 20`，本机 22.22.2 满足，但无声明，CI 或新机器用 18 会得到晦涩报错 |
| `repository` | 便于 `npm repo` / 溯源 |

**建议**：加 `scripts.check`（依次跑 13 套）、`scripts.check:browser`、`scripts.bump`、`scripts.release`（bump → check → 提示推送）。`engines.node` 设为 `>=20`。

### 5. 版本号存在两个来源，且无一致性断言

- `package.json`: `"version": "0.4.21"`
- `js/version.js`: `export const VERSION = 'v0.4.21'`

当前一致，但 `docs/` 下 13 套自检**没有一处**校验 `package.json` 的版本（只有 `createRequire` 用到该文件路径）。项目已有「版本断言改为自洽性校验」的先例，此处是同一类隐患。

**建议**：在 `selfcheck_v006.mjs` 或新增一条断言：`package.json.version === VERSION.replace(/^v/, '')`。或者由 `bump_imports.mjs` 顺带同步写入，消除双源。

### 6. `playwright-core` 可升级 1.63.0 → 1.64.1

**证据**：`npm outdated` 输出 `Current 1.63.0 / Wanted 1.64.1 / Latest 1.64.1`；`package.json` 声明 `^1.63.0`，实际安装 1.63.0。

**影响**：仅自检探针与浏览器冒烟，**不进产物、不影响玩家**。因此优先级低于前四项。

**建议**：升级后必须全量回归（13 套 + 浏览器冒烟），因为 playwright 的 minor 升级偶尔改变选择器时序行为。若当前 13 套全绿，升级是低风险动作。

---

## P2 — 有量化收益，但需排期

### 7. 17 个独立定时器 + 15 处重复的可见性守卫

**证据**：`grep setInterval` 共 17 处（1 个心跳 + 13 个页面级 + `cloud.js` 轮询 + 2 个局部）；`grep "document.hidden"` 共 15 处，每处都是同一行模板：

```js
if (typeof document !== 'undefined' && document.hidden) return;   // v0.4.21：后台标签页不重绘
```

**问题**：v0.4.21 用「在 13 个定时器里各加一行守卫」解决了后台空转（正确且低风险的止血），但代价是 15 份重复分支 + 17 个各自唤醒的定时器。浏览器对同源标签页的定时器有合并策略，但每个 `setInterval` 仍是一次独立的宏任务调度与闭包驻留。

**建议**（渐进，不必一次做完）：

1. 先在 `ui/common.js` 加 `export function uiTick(fn, ms)`，内部统一做 `document.hidden` 判断、`isConnected` 判断与 `clearInterval` 注册，替换 15 处模板 → 净减约 45 行。
2. 若后续仍嫌唤醒多，再合并为单个 250 ms 调度器 + 各页面注册自己的节流周期（`inventory` 已是 250 ms，可作基准）。**不建议**改成 `requestAnimationFrame` —— 后台标签页 rAF 会完全暂停，虽然符合预期，但会连带影响回归刷新的时序假设。

**风险**：中等。定时器逻辑涉及「切页后旧容器残留刷新」这类已经踩过坑的地方（`inventory.js:63-66` 有历史注释），重构必须逐页验证。

### 8. 自动存档的三次同步全量序列化

**证据**：`js/core/state.js:192-213`，`AUTOSAVE_INTERVAL = 10`（第 98 行）

```js
adapter.set(keys.index, JSON.stringify(idx));
STATE.accounts.forEach((a) => adapter.set(keys.save + a.id, JSON.stringify(a)));
adapter.set(keys.planets + STATE.currentAccountId, JSON.stringify(STATE.planets));
```

**问题**：每 10 秒在主线程做 1+N 次 `JSON.stringify` + 同步 `localStorage.setItem`。`localStorage` 是同步阻塞 API，且 `STATE.planets` 随游戏进程单调增长（多星球、多战区、舰队与建筑实例）。前期无感，后期存档达到数百 KB 时单次可能产生数十毫秒的可感知卡顿 —— 而它恰好发生在游戏进行中而非加载期。

**建议**（按性价比排序）：

1. 加脏标记：仅当 `STATE` 实际变动时写盘（当前 tick 内数值每秒都在变，这条收益有限，但可跳过「暂停/后台」时段）。
2. 把 `saveState` 包进 `requestIdleCallback(..., { timeout: 2000 })`，避免与渲染帧争主线程。
3. 长期可评估 IndexedDB（异步、配额更大），但会牵动 `adapter` 抽象与 `settleOffline` 的读路径，属于结构性改动。

**注意**：`beforeunload` 里必须保留**同步**写盘路径（`main.js:253`），`requestIdleCallback` 在卸载时不会执行 —— 这两条要并存，不能简单替换。

### 9. 工程保障缺失：无 CI、无 lint、无编辑器约定

- 无 `.github/` 目录 → 13 套自检 + 浏览器冒烟全靠人工触发，且项目明确有「改代码后必须升版跑 bump」的强约定，最容易漏。
- 无 ESLint / Prettier 配置 → 34,144 行全靠人工风格约束。当前风格自律良好，但「函数被误删导致硬崩溃」在这份代码里已发生过多次（`v0.4.19` 修复了三处），静态检查（`no-undef`、`no-unused-vars`）能直接拦住一部分。
- 无 `.editorconfig` / `.nvmrc` → 行尾与 Node 版本靠 `.gitattributes` + 口头约定。

**建议**：最小可用方案是一个 GitHub Actions：`node --check` 全库语法 + 跑不依赖浏览器的 11 套自检。注意本机沙箱禁止 Node 派生子进程（`spawnSync` 一律 `EBUSY`），CI 上不受此限，但脚本若用 `execSync` 串行跑需确认退出码传递。

### 10. `?v=` 缓存串仍需改写 40 个文件

**证据**：`docs/bump_imports.mjs` 用正则改写 `js/` 下所有相对导入 + 根目录 `*.html` 的 css/js 引用；实测 40 个文件含 `?v=`。

**现状评估**：这套机制是**正确的**（静态托管无 `Cache-Control`，必须让整条 import 链 URL 变化），且已脚本化 + 幂等，风险低。列出它不是因为「错」，而是因为它是一笔持续成本：每加一个模块就要承担「忘记跑脚本 → 玩家拿不到新代码」的风险，且 import 语句里 40 处 `?v=61.12` 是纯噪声。

**可选迁移**：Import Maps。在 `index.html` 顶部声明一次映射：

```html
<script type="importmap">
{ "imports": { "./js/": "./js/" } }
</script>
```

**代价**：需要一次性改写 40 个文件的导入语句；浏览器要求 Chrome 89+ / Safari 16.4+ / Firefox 108+（2026 年已无障碍）；且 `?v=` 语义从「逐文件」变成「全量」，无法只击穿改动过的模块。

#### ✅ 最终结论（2026-10-28 实测后否决）

迁移评估做了，**决定不迁移**，理由是可验证的技术事实而非偏好：

1. **Import Map 无法把查询串注入到前缀映射里。** 映射 `"./js/": "./js/?v=61.12/"` 会把 `./js/core/state.js` 拼接成 `./js/?v=61.12/core/state.js`（路径中段插入），是坏 URL。前缀映射只能整体替换前缀，不能改文件名末尾。
2. **因此唯一可行形态是裸标识符**：把 244 处相对导入改成 `astrix/core/state` 这类名字，再手写 ~56 条映射（每条都要带 `?v=`）。发版时仍要**重新生成 56 条映射**，只是把「改写 40 个文件」换成「改写 56 行映射表」——**迁移后仍然需要脚本，且多了一层「名字对不对」的映射查找**，故障模式从「缓存串过期」变成「缓存串过期 + 拼错标识符」，并不更简单。
3. 现有机制的成本已被本次改动消掉：`npm run release` 一条命令内部先跑 `bump`，`selfcheck_v047` 又对「244 处导入 + index.html 8 处引用」逐条断言等于当前 `CACHE_TAG`。**忘记跑 bump 会在自检阶段直接变红**，不需要靠人记。

结论：不改。真正要解决的问题（发版漏跑脚本）已由「一条命令 + 断言」覆盖，代价远低于迁移。

---

## P3 — 顺手可改

| 项目 | 证据 | 建议 |
|---|---|---|
| JSON 深拷贝 | `js/core/shipyard.js:767` `JSON.parse(JSON.stringify(bp))` | 改 `structuredClone(bp)`；注意若 `bp` 含函数/类实例则行为不同，需确认是纯数据 |
| 复制按钮顺序颠倒 | `index.html:77-78` 先 `document.execCommand('copy')`（已废弃）再 `navigator.clipboard.writeText` | 顺序对调：现代 API 优先，`execCommand` 仅作降级兜底 |
| 内置 SDK 缺 sourcemap | `assets/vendor/workbuddy-cloud-sdk.js` 末尾指向 `index.global.js.map`，但 `.map` 未随包提供 | DevTools 会 404。要么补 `.map`，要么删掉该行注释 |
| 页面元信息 | `index.html` 无 `color-scheme` / `theme-color` / `description` / OG 标签 | 加 `<meta name="color-scheme" content="dark">` 让滚动条与表单控件跟随深空主题；加 OG 标签改善分享预览 |

---

## 已核查、确认无需改动

为避免下次重复排查，以下项已验证为**不是问题**：

| 检查项 | 结果 |
|---|---|
| 过时语法（`var` / `substr` / 无条件基 `parseInt`） | `parseInt` 全部带基数；`var` 仅出现在注释与 `version.js` 变更日志文本中 |
| `innerHTML +=` 循环拼接 | 0 处（`inventory.js` 已改为「事件委托 + 文本节点更新」） |
| 定时器泄漏 | 34 处 `clearInterval`，17 个 `setInterval` 全部成对清理，且带 `isMounted` 兜底 |
| `-webkit-backdrop-filter` | 5 处，Safari 仍需，保留正确 |
| `100vh` 移动端抖动 | `base.css:60` 与 `planet.css:6-7` 均已提供 `100dvh` 兜底 |
| `env(safe-area-inset-*)` | 4 处已适配刘海屏 |
| `@import` 阻塞 | 0 处，全部走 `<link>` 并行加载 |
| `!important` 滥用 | 全文 1 处（`hoi.css`），可接受 |
| GitHub API 版本头 | `2022-11-28` 实测仍返回 200，无需变更 |
| 运行时依赖 | 仍是零依赖，`node_modules` 未进入产物 —— 这是项目的核心资产，**不应引入打包器/框架来「升级」** |

---

## 建议的执行顺序

**第一批（当天可完成，风险低）**：第 2 项（路径）、第 4/5 项（包配置与版本断言）、第 11/12/13 项（顺手改）。

**第二批（需回归）**：第 6 项（playwright 升级）+ 全量 13 套自检 + 浏览器冒烟。

**第三批（需设计与排期）**：第 1 项（SDK 版本统一，需确认在线功能在三源一致后可正常工作）、第 3 项（更新日志拆分，注意动态 import 的 `?v=`）。

**第四批（观察项）**：第 7/8 项（定时器与存档，收益随存档增长而变大，可等玩家反馈卡顿再做）、第 9 项（CI）、第 10 项（Import Map，暂不执行）。

---

## 执行结果（2026-10-28，v0.4.22）

13 项已全部处理：12 项落地，1 项（Import Map）经技术评估后否决。

| # | 项目 | 结果 | 关键度量 |
|---|---|---|---|
| 1 | 云 SDK 三源统一 | ✅ 全部钉到 `0.1.4`，内置副本与 npm 产物 sha256 一致 | 原主源 `@dev`（0.1.4-dev）/ 兜底 0.1.3 → 全 0.1.4 |
| 2 | 自检硬编码路径 | ✅ 改 `os.homedir()`，支持环境变量覆盖 | 3 处 → 0 处 |
| 3 | 更新日志拆包 | ✅ 移到 `js/data/changelog.js`，点开才加载 | `version.js` 152,415 B → 3,038 B（gzip 64,161 → 1,489）；首屏 JS gzip 550.5 KB → 491.0 KB（−10.8%）；实测点击前 0 请求 |
| 4 | `package.json` 补全 | ✅ scripts / engines / repository | 新增 5 条脚本 |
| 5 | 版本双源 | ✅ `bump_imports` 自动写回 + 自检断言 | 由构造消除漂移 |
| 6 | playwright 升级 | ✅ 1.63.0 → 1.64.1 | 3 套浏览器自检 23/35/23 全过 |
| 7 | 定时器收敛 | ✅ 新增 `uiTick()`，13 处调用点迁移 | `setInterval` 17 → 4；`document.hidden` 守卫 15 → 1（助手内）+1 处冗余 |
| 8 | 存档移出关键帧 | ✅ `scheduleSave()` + `requestIdleCallback` | 心跳不再同步序列化；切档/卸载仍同步 |
| 9 | CI / 编辑器约定 | ⚠️ 部分落地 | `.editorconfig`、`.nvmrc`、`npm run check` 完成；`.github/workflows` 被令牌 scope 阻止（见下） |
| 10 | Import Map | ❌ 否决 | 见第 10 节结论：前缀映射无法注入查询串，裸标识符方案反而更脆 |
| 11 | `structuredClone` | ✅ | 1 处 |
| 12 | Clipboard 顺序 | ✅ 现代 API 优先，`execCommand` 降级 | 1 处 |
| 13 | 元信息 / sourcemap | ✅ `color-scheme`/`theme-color`/OG 已加；0.1.4 产物自带无 sourcemap 引用，404 隐患消失 | — |

**顺带修掉的真 bug**（审计时未发现，重构中暴露）：

- `js/ui/research.js` 的定时器**建表前没有清旧表**，而「科技集合变化 → 整块重绘」会在旧表仍在跑时再建一只 → 每完成一项科技就叠加一只每秒定时器。改用 `uiTick()` 后由构造消除；实测连续重绘 3 次定时器数不变。

**新增的发版护栏**：

- `selfcheck_v047` ④ 组：版本号三处自洽、更新日志首条与 `VERSION` 一致、**全库 244 处相对导入 + `index.html` 8 处引用的 `?v=` 必须等于当前 `CACHE_TAG`**、云 SDK 三源版本一致、`version.js` 不再内联 `VERSIONS`。
- `npm run check` / `check:browser` / `release`。

**唯一未落地项与原因**：GitHub 令牌 scope 为 `gist / read:org / repo`，**没有 `workflow`**。GitHub 会拒绝任何新增 `.github/workflows/*` 的推送（`git push` 与 Git Data API 两条路都会被挡），进而卡住整次发版。已把 CI 配置以可复制模板形式放在 `docs/ci_check.yml`，换用带 `workflow` scope 的令牌后 `git mv docs/ci_check.yml .github/workflows/check.yml` 即生效。

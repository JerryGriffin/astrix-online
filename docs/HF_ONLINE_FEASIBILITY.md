# HuggingFace 公网在线联机 — 可行性核查报告

- 核查日期：2026-09-30
- 核查版本：v0.2.2-rev16（CACHE_TAG `21.16`）
- 核查对象：本地工作区 / GitHub `JerryGriffin/astrix-online` / HF Space `Recapiut/astrix-online`

---

## 〇、结论摘要

| 事项 | 结论 |
|---|---|
| 本地 ↔ GitHub 同步 | ✅ **完全同步**（`36b435e`，工作树干净） |
| GitHub ↔ HF Space 同步 | ✅ **完全同步**（自动工作流最后一次运行成功，内容逐文件比对一致） |
| HF 公网**在线联机**可行性 | ⚠️ **技术上完全可行，当前被一项配置阻断**：Space 为 `sdk: static`，`/api/online/*` 全部 404 |
| 修复所需改动量 | **1 行**（Space README 前置元数据 `sdk: static` → `sdk: docker`） |
| 主要代价 | 免费层 48 小时无访问自动休眠（冷启动 30–90 秒）、重启后全服内存态清零 |

> **实施状态（rev17 已落地）**：本报告的结论已付诸实施 —— `README.md` 切为 `sdk: docker` + `app_port: 7860`，
> 并新增全服状态持久化层解决"重启清零"。配置与验证步骤见 **`docs/HF_STATE_PERSISTENCE.md`**，
> 本报告保留为当时的可行性论证与实测证据链。

后端本身**已实测可用**：在隔离端口实跑 `server.mjs`，8 条联机接口（心跳注册 / 全服注册表 / 公频收发 / 集市挂单 / 集市成交 / 跨玩家攻防 / 攻防信箱）全部返回预期结果并形成完整读写闭环。**问题不在代码，只在部署形态。**

---

## 一、三处仓库同步状态核验

### 1.1 本地工作区

```
分支        : main（跟踪 origin/main）
HEAD        : 36b435e58b8b4b92a5df8630f3a0536deacba357
工作树      : clean（nothing to commit）
其他分支    : deploy-to-space、hf-deploy（历史遗留，未跟踪远端）
```

### 1.2 GitHub `origin`

`github.com:443` 在当前网络下**仍被阻断**（`git fetch` 报 `Recv failure: Connection was reset`）。核查改用两条可用路径，结论一致：

- GitHub REST API（`api.github.com` 直连可达）：`refs/heads/main` = `36b435e58b8b4b92a5df8630f3a0536deacba357`
- `git ls-remote`（经本机 `127.0.0.1:10808` 代理）：`36b435e58b8b4b92a5df8630f3a0536deacba357`

**本地 HEAD == 远端 main，无待推送提交。**

### 1.3 HF Space `Recapiut/astrix-online`

| 项 | 值 |
|---|---|
| `sdk` | **`static`** |
| 可见性 | public（免费层强制公开） |
| 运行阶段 | `RUNNING`（replicas 1/1） |
| 最后修改 | `2026-09-30T02:15:40Z` |
| `refs/heads/main` | `0a8a2f13e0e0eb1e875d1d20d2a2da38cc289b2a` |

Space 侧 main 与本地 `36b435e` **SHA 不同属预期**：`sync_to_hf.yml` 每次都用 `git reset --soft space/main` + 重新提交，Space 侧是一条独立的压平历史。

**同步有效性用「内容比对」而非 SHA 比对验证**（按 Git blob 哈希，即忽略 CRLF/LF 差异）：

| 文件 | blob 哈希 | 结果 |
|---|---|---|
| `js/version.js` | `33992322bf` | IDENTICAL |
| `js/core/cloud.js` | `6b18b13553` | IDENTICAL |
| `js/main.js` | `4967328594` | IDENTICAL |
| `js/ui/inventory.js` | `1082da37b7` | IDENTICAL |
| `js/core/format.js` | `51b68a9ff4` | IDENTICAL |
| `index.html` | `177fad2252` | 仅差 HF 注入的一行：`<script>window.huggingface={variables:{...}};</script>` |

**结论：部署内容与本地逐字节一致（除平台自身注入），同步链路健康。**

自动同步工作流最近 11 次运行**全部 success**，其中第 11 次对应 `36b435e`（`2026-09-30T02:15:34Z` 触发），与 Space 的 `lastModified` 时间戳吻合。

---

## 二、联机链路实测（关键证据）

### 2.1 公网（HF static Space）

正确直连域名是 `recapiut-astrix-online.static.hf.space`（注意 `.static.` 段；不带该段会落到 HF 的 404 页）。

| 路径 | 结果 |
|---|---|
| `/index.html` | 200 text/html 5638 B |
| `/js/version.js` | 200 application/javascript 60957 B |
| `/js/core/cloud.js` | 200 application/javascript 29565 B |
| `/api/online/heartbeat` | **404** text/plain 15 B |
| `/api/online/commanders` | **404** |
| `/api/online/chat` | **404** |
| `/api/online/market` | **404** |
| `/api/health` | **404** |
| `/server.mjs` | 200 application/javascript 14030 B（被当作静态文件直接下载） |

静态托管只做文件分发，**没有任何进程执行 `server.mjs`**，因此所有 `/api/online/*` 一律 404。

### 2.2 本地实跑后端（隔离端口 8099，未干扰既有 8080 实例）

`node server.mjs` 启动后逐条验证：

| 接口 | 请求 | 实测结果 |
|---|---|---|
| `POST /api/online/heartbeat` | 注册「探针甲」「探针乙」 | `{"ok":true,"onlineCount":5}` → `6` |
| `GET /api/online/commanders` | 拉全服注册表 | 6 条，含两个探针 + 4 个 NPC 势力 |
| `POST /api/online/chat` | 发公频消息 | `{"ok":true,"message":{...}}` |
| `GET /api/online/chat` | 读公频 | 3 条，含刚发的那条 |
| `POST /api/online/market/list` | 挂单 50 铁锭 | `{"ok":true,"listing":{...}}` |
| `GET /api/online/market` | 读集市 | 4 条，含刚挂的单 |
| `POST /api/online/market/buy` | 探针乙买下探针甲的单 | `{"ok":true,"msg":"成功交割..."}`，列表回落至 3 条且卖方挂单消失 |
| `POST /api/online/raid` | 探针甲攻打探针乙 | `{"ok":true,"win":true,"targetDef":150,...}` |
| `GET /api/online/inbox?commanderId=probe-B` | 被攻击方信箱 | 收到「空袭警报」防御损失消息，含 12 小时免战力场保护 |

**八条链路全部打通，多客户端发现、异步攻防回执均已闭环。** 说明 Docker 形态一旦启用，公网联机立即可用。

### 2.3 客户端降级行为（断网/404 时）

`js/core/cloud.js` 中**所有**请求均为相对路径 `fetch('/api/online/...')`，**没有可配置的基址**：

- GET 请求走 `if (res.ok)` 判空，404 时静默回退到本地 NPC 星系（`fetchGalaxyRegistry` 等）。
- POST 请求直接 `await res.json()`，404 返回 `text/plain` 会抛异常并被 `catch` 吞掉，返回 `null` 或 `{ok:false, reason:'网络连接异常'}`。

即：**当前公网版本玩家拿到的是「单机 + NPC 势力」体验，全程无报错、无提示**——这与产品现状记录一致，属静默降级，不是崩溃。

---

## 三、可行性判定

### 3.1 技术可行性：**可行（高置信度）**

三项必要条件**已全部就位**，无需改动任何业务代码：

1. **端口契约已满足** — `Dockerfile`：`FROM node:22-alpine` + `EXPOSE 7860` + `ENV PORT=7860` + `CMD ["node","server.mjs"]`。HF Docker Space 默认要求监听 7860，完全吻合。
2. **零依赖满足** — `server.mjs` 只用 Node 原生 `http`/`fs`/`crypto`/`path`/`url`，无 npm 安装步骤，镜像构建约 1–2 分钟。
3. **同源要求满足** — Docker 模式下 `server.mjs` 同时托管静态资源与 `/api/*`，与客户端相对路径请求天然同源，不需改 `cloud.js`、不需处理 CORS。

**唯一缺口**：Space `README.md` 前置元数据 `sdk: static`。改为 `sdk: docker` 即完成切换（`app_port` 可省略，默认 7860）。

### 3.2 切换后的实际代价

| 代价 | 具体表现 | 影响程度 |
|---|---|---|
| **48 小时自动休眠** | 免费 CPU 层无访问 48h 后暂停，下次访问冷启动 30–90 秒 | 中。静态站无休眠，切换后是纯体验回退；但单机玩法完全不受影响 |
| **重启后全服状态清零** | `server.mjs` 的 `ONLINE_STORE` **纯内存**（已确认全文无 `writeFile`），休眠唤醒即重建 | 中高。注册表、公频、集市挂单、攻防记录全部丢失 |
| **无持久化磁盘** | 免费层 50 GB 为临时盘，重建即清空；持久化存储为付费项 | 与上一条同源 |
| **免费层仅公开 Space** | 免费层不支持私有 | 无影响（当前即公开） |
| **平台定位风险** | HF Spaces 面向 ML 应用；非 ML 内容虽无明文禁令（Content Policy 只约束违法/有害内容），但存在被判定为「非目标用途」的低概率风险 | 低，但非零 |

### 3.3 备选方案对比

| 方案 | 改动量 | 优点 | 缺点 |
|---|---|---|---|
| **A. Space 切 `sdk: docker`** | README 1 行 | 零代码改动、同源、自动同步链路不动 | 48h 休眠、内存态清零、冷启动 |
| B. 前端留 HF + API 另挂 Node 主机 | 需改 `cloud.js` 支持可配置基址 + CORS/跨域 | 前端仍静态常驻 | 引入第二个平台与运维面；与 rev14「联机收敛到 HF」的决策相悖 |
| C. 维持 static（现状） | 0 | 秒开、无常驻成本 | 公网无真联机，仅单机 + NPC |

**方案 A 是唯一零代码改动的路径**，与现有架构和 rev14 决策一致。若接受「世界状态每次唤醒重置」，可直接切；若要求状态存活，需要在 `server.mjs` 增加向 HF Dataset（需 `HF_TOKEN` secrets）定期落盘的能力，属新增开发工作量。

### 3.4 建议的验证步骤（切换后）

1. 改 HF Space README 前置元数据为 `sdk: docker`（`app_port` 默认 7860，可省略），推送到 GitHub `main`。
2. 等待 `sync_to_hf.yml` 成功 + Space 重新构建完成（Settings 页观察 Build 日志）。
3. 实测 `https://recapiut-astrix-online.hf.space/api/online/commanders` 应返回 **200 JSON**（不再是 404）。
4. 双端浏览器分别进入在线模式，互查对方星球并试发公频消息 / 集市挂单。
5. 回归单机流程，确认静态资源与离线存档不受影响。

---

## 四、核查过程附注（环境侧）

- `github.com:443` 与 `huggingface.co:443` 在本机分别被 **连接重置** 与 **SNI 握手重置** 阻断；`huggingface.co` 的 DNS 亦被污染（解析到 `199.96.62.75` 与 Facebook 网段 IPv6）。
- 但本机 `127.0.0.1:10808` 存在可用代理，`ALL_PROXY` / `https_proxy` 指向它后，**`git ls-remote origin`、`git ls-remote space` 均可正常完成**——这比既有的「GitHub Git Data API 兜底推送法」更省事，后续推送可优先尝试代理直推。
- `huggingface.co` 的真实 A 记录可经 `hf.co`（解析正常，指向 AWS 真实节点）间接获取。
- 静态 Space 的直连域名必须带 `.static` 段（`<owner>-<name>.static.hf.space`），不带该段会命中 HF 的 404 页，容易误判为「部署失败」。

---

## 五、待设计者决策

1. 是否将 Space 切回 `sdk: docker` 以恢复公网真联机？（本报告结论：可行，代价见 3.2）
2. 若切换，「全服世界状态在休眠/重启后清零」是否可接受？若不可接受，需立项开发 HF Dataset 落盘方案。

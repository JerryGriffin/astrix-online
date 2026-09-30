# HuggingFace 公网在线联机 — 可行性核查报告

- 核查日期：2026-09-30
- 核查版本：v0.2.2-rev16（CACHE_TAG `21.16`）
- 核查对象：本地工作区 / GitHub `JerryGriffin/astrix-online` / HF Space `Recapiut/astrix-online`

---

## ⚠️ 关键更正（2026-09-30 实测后补记，请先读这段）

本报告下文的技术结论（后端本身可用、只需切 `sdk: docker`）**在技术上成立，但漏掉了一道账户级硬门槛**：

> **HuggingFace 免费账号无法运行 Gradio / Docker Space，只能托管 Static Space。**
> 运行需要计算的 Space 必须付费（PRO）。官方论坛工作人员原话：
> 「Creating a Space that runs on compute (Gradio or Docker) requires a paid plan.
> This includes converting an existing Static Space to Gradio or Docker.」

**实测证据**：把 `README.md` 改为 `sdk: docker` + `app_port: 7860` 并推送后，HF 返回

```json
"errorMessage": "Quota exceeded for flavor cpu-basic (requested=1): current=0, limit=0"
```

Space 立即进入 `PAUSED`，`recapiut-astrix-online.hf.space` **全路径 503**（`/`、`/index.html`、`/api/online/*` 全不可用），
即公开站点被彻底打挂。随后已回滚 `README.md` 为 `sdk: static` 并验证恢复（`index.html` 200）。

**因此**：本报告的「HF 公网联机可行性 = 高」应修正为
**「技术可行，但免费额度下不可落地；需付费 PRO，或改用其他能跑 Node 的主机」**。
下面第一、二节的实测数据仍然有效（后端确实就绪、问题确实只在部署形态），只是「换一行就能开」这个结论不成立。

### → 后续：已用另一条路解决（rev17）

服务端路线确实堵死，但**联机本身没被堵死**。rev17 把「全服」从「一台服务器」改成
**「一组客户端共同维护的广播世界」**：站点保持纯静态，浏览器直连公共 MQTT 代理，
在线集市 / 星区公频 / 真实玩家名录 / 被真人进攻的实时战报与免战力场全部恢复，
**免费、无需账号、无需 API key**。设计、边界与运维见 **`docs/ONLINE_RELAY.md`**。

本报告保留为「为什么不能走服务端」的证据链；若日后升级到能跑 Node 的容器主机，
`server.mjs` 仍可零改动接管（客户端会自动选路，两条链路对 UI 完全一致）。

---

## 〇、结论摘要

| 事项 | 结论 |
|---|---|
| 本地 ↔ GitHub 同步 | ✅ **完全同步**（`36b435e`，工作树干净） |
| GitHub ↔ HF Space 同步 | ✅ **完全同步**（自动工作流最后一次运行成功，内容逐文件比对一致） |
| HF 公网**在线联机**可行性 | ❌ **免费额度下不可落地**：HF 免费账号无 cpu-basic 配额，Docker Space 一开就 503（见上方「关键更正」）。技术本身可行，但需付费 PRO 或换主机 |
| 修复所需改动量 | HF 路线：0 行代码（仅 README 一行）**但要付费 PRO**；其他主机路线：0 行代码（`server.mjs` 已满足单端口 HTTP 服务的全部要求，同源托管静态资源与 API） |
| 主要代价 | 免费层 48 小时无访问自动休眠（冷启动 30–90 秒）；全服状态在容器重启后清零（已由 `server.mjs` 的持久化层解决，见 `docs/HF_STATE_PERSISTENCE.md`） |

> **实施状态**：服务端的联机与持久化实现已全部落地（`server.mjs` 快照持久化层 + 往返自检 36 项全通），
> 但 Space 的 `sdk: docker` 切换**因免费账号无 cpu-basic 配额而回滚**（见上方「关键更正」）。
> 配置与验证步骤见 **`docs/HF_STATE_PERSISTENCE.md`**，本报告保留为可行性论证与实测证据链。

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

### 3.1 技术可行性：**可行（高置信度）**，但受账户配额阻断

三项必要条件**已全部就位**，无需改动任何业务代码：

1. **端口契约已满足** — `Dockerfile`：`FROM node:22-alpine` + `EXPOSE 7860` + `ENV PORT=7860` + `CMD ["node","server.mjs"]`。HF Docker Space 默认要求监听 7860，完全吻合。同一份 `server.mjs` 也满足任何通用单端口 HTTP 宿主的要求（读 `PORT`、绑 `0.0.0.0`、零依赖、`npm start` 可直接拉起）。
2. **零依赖满足** — `server.mjs` 只用 Node 原生 `http`/`fs`/`crypto`/`path`/`url`（快照持久化用内置 `fetch`），无 npm 安装步骤。
3. **同源要求满足** — `server.mjs` 同时托管静态资源与 `/api/*`，与客户端相对路径请求天然同源，不需改 `cloud.js`、不需处理 CORS。

**但落地被账户配额阻断**（见「关键更正」）：HF 免费账号的 `cpu-basic` 配额为 0，
Docker Space 无法启动。原判断「唯一缺口是 README 里的 `sdk: static`」**不完整** ——
真正的缺口是**该账号没有运行计算型 Space 的权限**，这不是改一行配置能解决的。

### 3.2 切换后的实际代价

| 代价 | 具体表现 | 影响程度 |
|---|---|---|
| **账户配额（决定性，先于下面所有条目）** | 免费账号 `cpu-basic` 配额为 0，Docker Space 直接 503 起不来 | **阻断**。要么付费 PRO（$9/月），要么换主机 |
| **48 小时自动休眠** | 免费 CPU 层无访问 48h 后暂停，下次访问冷启动 30–90 秒 | 中。静态站无休眠，切换后是纯体验回退；但单机玩法完全不受影响 |
| **重启后全服状态清零** | ~~`server.mjs` 的 `ONLINE_STORE` 纯内存~~ → **已解决**：新增快照持久化层（`hf` 数据集 / `file` 本地文件），见 `docs/HF_STATE_PERSISTENCE.md` | 已消除 |
| **无持久化磁盘** | 免费层 50 GB 为临时盘，重建即清空；持久化存储为付费项 | 与上一条同源 |
| **免费层仅公开 Space** | 免费层不支持私有 | 无影响（当前即公开） |
| **平台定位风险** | HF Spaces 面向 ML 应用；非 ML 内容虽无明文禁令（Content Policy 只约束违法/有害内容），但存在被判定为「非目标用途」的低概率风险 | 低，但非零 |

### 3.3 备选方案对比

| 方案 | 改动量 | 优点 | 缺点 |
|---|---|---|---|
| **A. Space 切 `sdk: docker`** | README 1 行 | 零代码改动、同源、自动同步链路不动 | ❌ **免费账号不可行**（cpu-basic 配额 0）；除非付费 PRO $9/月 |
| **B. 前端留 HF + 后端另挂 Node 主机** | 若主机同源托管整个项目则 **0 行改动**；若前后端分离则需给 `cloud.js` 加可配置基址 | 前端保持静态常驻（无休眠）；`server.mjs` 已满足单端口 HTTP 宿主要求；API 响应已带 `Access-Control-Allow-Origin: *`，跨域也现成 | 引入第二个平台与运维面；与 rev14「联机收敛到 HF」的决策相悖 |
| C. 维持 static（现状） | 0 | 秒开、无常驻成本、当前可用 | 公网无真联机，仅单机 + NPC |

**方案 A 已被实测排除**（账户配额）。真联机的现实路径是 **B**：把整个项目（静态资源 + `server.mjs`）部署到任一能跑 Node 的单端口 HTTP 主机——因为 `server.mjs` 本身同源托管全部内容，**前端一行都不用改**，`/api/online/*` 的相对路径请求直接成立。
本地 / 局域网则无需任何外部主机，`start_online.bat` 起的服务已经可玩且（新增持久化后）重启不丢世界。

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

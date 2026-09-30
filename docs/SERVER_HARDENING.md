# 服务端对外暴露面收敛（公网部署前的必要加固）

## 解决什么问题

把 `server.mjs` 放到任何**非受信网络**上（公网 Node 托管、局域网联机、反向代理后面），
它就同时是「游戏服务器」和「一台谁都能访问的文件服务器」。原实现采用**命中即发**策略：
只要文件存在于项目根目录下就直接发送，没有白名单、没有维护者概念。

实测（2026-09-30，`PORT=7860 node server.mjs`，经 `127.0.0.1` 与局域网 `192.168.1.6` 双向验证）
暴露了三个缺陷，其中两个达到「必须修完才可对外」的级别。

---

## 缺陷一：`.git/config` 凭据泄漏（最严重）

| | |
|---|---|
| 现象 | `GET /.git/config` → **200**，626 字节，与本地原件 `git hash-object` 完全一致 |
| 内容 | 含 **2 个带内嵌凭据的 remote URL**（`https://user:token@host/...`），即 GitHub 推送令牌 |
| 触发面 | **不需要公网**：`start_online.bat` 本身就把服务绑在 `0.0.0.0:8080`，同一局域网内任何人都能取走 |
| 同类 | `/.workbuddy/memory/*.md`（项目记忆，31 KB）、`/server.mjs`、`/docs/*`、`/node.exe`（67 MB）全部 200 |

这是本次最严重的一项：它不是「信息泄漏」，而是**可直接用于写入仓库的凭据**。

## 缺陷二：单请求远程 DoS（进程级）

```
GET /%   →   URIError: URI malformed
             at decodeURIComponent (server.mjs:698)
```

`decodeURIComponent` 对畸形百分号编码（`/%`、`/%E4%B8`、`/%zz`）**同步抛错**；而请求处理器是
`async` 函数，同步抛错会升级为**未处理的 Promise 拒绝**，Node 22 默认行为是**终止进程**。

实测：发出该请求后 `curl` 返回 `000`（连接被断），进程消失，之后所有请求全部失败。
**一条 `curl` 即可打挂整个全服世界**，且不需要任何凭据或前置条件。

## 缺陷三：路径包含性判定不严（前缀比较）

```js
if (!fullPath.startsWith(ROOT) ...) return 404;   // 修复前
```

字符串前缀比较无法表达「在目录内」：`ROOT` 为 `…/astra` 时，`…/astra-evil/secret` 同样以
`…/astra` 开头，可绕过守卫读到**相邻目录**。此类问题不会被白名单掩盖，属独立缺陷。

---

## 修复方案

三处改动都在 `server.mjs`，均在**服务端**，与客户端模块无关，故未 bump `REVISION`。

### 1. 静态资源白名单（替代「命中即发」）

```js
const PUBLIC_FILES = new Set(['/index.html']);
const PUBLIC_DIR_PREFIXES = ['/js/', '/css/'];
```

白名单范围由**实测的客户端真实依赖**确定，而非猜测：

- `index.html` 的全部引用只有 `css/*.css` 五个文件与 `js/main.js`；
- `js/` 内部所有 `import` 均为相对路径，**无一条越出 `js/`**（已用
  `grep -rhoE "from '[^']+'" js/` 全量核对）；
- 客户端运行时不再 `fetch` 任何其它静态文件（只有 `/api/online/*`）。

因此 `index.html` + `js/` + `css/` 就是完整的资源面。`config/applications.yaml` 属发布工具记录，
客户端不读取，一并排除。

### 2. 请求级异常隔离 + 进程守卫

- 整个请求处理移入 `handleRequest()`，由 `try/catch`（`.catch()`）包裹：任何同步或异步抛错
  只回 `500`，**绝不升级为进程退出**；
- `decodeURIComponent` 换成 `safeDecodePath()`，畸形编码返回 `null` → `404`；
- URL 解析失败回 `400`；
- 补 `unhandledRejection` / `uncaughtException` 最后一道守卫：**只记录、不退出**。
  取舍说明：对外服务把可用性置于 fail-fast 之上——全服世界不该因某个坏请求整体消失。
  正常情况下不会触发（请求级已兜住），一旦触发即代表有真实缺陷待修，故带 `[guard]` 前缀显式记录。

### 3. 正确的包含性判定

```js
const rel = path.relative(ROOT, fullPath);
if (!rel || rel.startsWith('..') || path.isAbsolute(rel)) return null;
```

### 附带

- 静态响应补 `X-Content-Type-Options: nosniff` 与准确的 `Content-Length`；
- 敏感路径一律回 **404**（而非 403），不确认其存在性。

---

## 修复前后对照（同一组请求）

| 请求 | 修复前 | 修复后 |
|---|---|---|
| `/`、`/index.html`、`/js/main.js`、`/js/core/cloud.js`、`/css/base.css` | 200 | 200 ✅ |
| `/.git/config` | **200（含凭据）** | **404** |
| `/.workbuddy/memory/MEMORY.md` | **200** | **404** |
| `/server.mjs`、`/package.json`、`/Dockerfile`、`/README.md` | **200** | **404** |
| `/docs/*`、`/config/applications.yaml`、`/node.exe` | **200** | **404** |
| `/js/../../.git/config` 等 9 种穿越变体 | 部分可达 | **全部 404** |
| `GET /%` | **进程崩溃** | 404，进程存活 |
| `/js/%`、`/js/%E4`、`/css/%`（白名单内的畸形编码） | — | 404，进程存活 |

凭据命中次数（跨 4 种取法求和）：**修复前 ≥1 → 修复后 0**。

---

## 自检

`docs/selfcheck_server_surface.mjs`（**66 项断言，全绿**）把上述结论钉死，防止回退。它不测函数，
而是**起真实服务**并断言 HTTP 行为，且刻意做了三件事让测试有效：

1. 以**临时目录为 cwd** 启动，顺带验证资源根由脚本自身位置解析、不依赖工作目录；
2. 畸形请求用例**必须包含白名单内的路径**（`/js/%` 等）——否则请求会在白名单那一步就被拒，
   根本走不到 `safeDecodePath`，等于没测到真正的修复点；
3. 断言日志中**不出现 `[guard]`**，即整轮攻击没有产生逃逸的未处理异常。

```bash
node docs/selfcheck_server_surface.mjs    # 66 项
node docs/selfcheck_online_state.mjs      # 36 项（持久化往返）
```

---

## 已知边界（不在本次修复范围内）

- **`serve.mjs` 是带同样缺陷的废弃文件**（当前**无任何代码引用**，项目入口是
  `start_online.bat → launch.mjs → server.mjs`）。为免被误用，已在文件头部加弃用告警，
  **未擅自删除**。若确认无人依赖，建议直接删掉——留着它等于留一份「同样漏凭据、同样能被一条
  请求打挂」的副本。
- **HuggingFace Static Space 仍会暴露仓库内文件**（`/docs/*.md`、`/package.json` 等直接可下载）。
  那是**文件服务器的信任模型**，与本服务器的白名单无关；这些文件本身也是有意入库的。
  若要让 HF 侧也收敛，只能把它们移出仓库——但 `docs/` 的版本化价值明显更高，不建议。
- 本加固解决的是**暴露面**与**健壮性**，不解决**身份认证**：任何知道接口的人都能以任意
  `commanderId` 发送心跳/挂单/攻防。这是当前玩法设计（无账号体系）的固有前提，属独立的
  产品决策项，改动量远大于本次。
- 未做速率限制（`/api/online/*` 无频率上限）。公网长期运行建议后续补一层。
